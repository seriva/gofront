// src/backend/wasm/emit-builtins.js
// FunctionEmitter mixin: panic/recover, Go builtins (len, append, make, …) and
// call expression dispatch (static, method, closure, package).

import {
	getMapKeyValTypes,
	isArrayType,
	isMapType,
	isNonEmptyInterface,
	isSliceType,
	isStringType,
	isStructType,
	isTestingT,
	toWasmType,
} from "./types.js";

export class BuiltinsEmitter {
	emitPanic(msg) {
		const strIdx = this.mod.internString(msg);
		const funcIdx = this.mod.getStringImportIndex();
		this.pushInstruction({ op: "i32.const", value: strIdx });
		this.pushInstruction({ op: "call", funcIndex: funcIdx });
		this.pushInstruction("any.convert_extern");
		this.emitPanicThrow();
	}

	// Consumes the anyref message on the stack, pushes a PanicNode, and raises the panic via
	// `env.panic`; `unreachable` tells the validator control never returns.
	emitPanicThrow() {
		const panicNodeTypeIndex = this.mod.getPanicNodeTypeIndex();
		const panicGlobal = this.mod.getPanicGlobalIndex();
		const tmpVal = this.acquireTemp("anyref");
		this.pushInstruction({ op: "local.set", index: tmpVal });

		// Push PanicNode: (struct.new $PanicNode val (i32.const 0) (global.get panicGlobal))
		this.pushInstruction({ op: "local.get", index: tmpVal });
		this.pushInstruction({ op: "i32.const", value: 0 }); // recovered = 0
		this.pushInstruction({ op: "global.get", index: panicGlobal }); // prev
		this.pushInstruction({
			op: "struct.new",
			typeIndex: panicNodeTypeIndex,
		});
		this.pushInstruction({ op: "global.set", index: panicGlobal });

		// Prepare externref for env.panic
		this.pushInstruction({ op: "local.get", index: tmpVal });
		this.pushInstruction("extern.convert_any");
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getPanicImportIndex(),
		});
		this.pushInstruction("unreachable");
		this.releaseTemp(tmpVal, "anyref");
	}

	_getSliceElemType(t) {
		if (!t) return null;
		if (t.elem) return t.elem;
		if (t.underlying?.elem) return t.underlying.elem;
		if (t.kind === "SliceType") return t.elem;
		if (t.name && this.mod.checker?.types?.has(t.name)) {
			const resolved = this.mod.checker.types.get(t.name);
			return this._getSliceElemType(resolved);
		}
		return null;
	}

	_getArrayElemType(t) {
		if (!t) return null;
		if (t.elem) return t.elem;
		if (t.underlying?.elem) return t.underlying.elem;
		if (t.kind === "ArrayType") return t.elem;
		if (t.name && this.mod.checker?.types?.has(t.name)) {
			const resolved = this.mod.checker.types.get(t.name);
			return this._getArrayElemType(resolved);
		}
		return null;
	}

	_emitBuiltinLen(call, targetWasmType) {
		const arg = call.args[0];
		const argType = arg._type ?? this._resolveExprGoType(arg);
		if (this._sharedInfo(argType)) {
			this.emitSharedLen(arg, targetWasmType);
			return;
		}
		if (isMapType(argType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(argType, this.mod.checker);
			const mapInfo = this.mod.getMapType(keyType, valType);
			this.emitExpr(arg, mapInfo.wType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.lenFuncName),
			});
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (isSliceType(argType, this.mod.checker)) {
			const elemType = this._getSliceElemType(argType);
			const sliceInfo = this.mod.getSliceType(elemType);
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			this.emitExpr(arg, sliceWType);
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (
			isArrayType(argType, this.mod.checker) ||
			(argType?.kind === "pointer" &&
				isArrayType(argType.base, this.mod.checker))
		) {
			const elemType = this._getArrayElemType(argType?.base ?? argType);
			const arrInfo = this.mod.getArrayType(elemType);
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			this.emitExpr(arg, arrWType);
			this.pushInstruction("array.len");
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (isStringType(argType, this.mod.checker)) {
			this.emitExpr(arg, "externref");
			const lenIdx = this.mod.getStringLenImportIndex();
			this.pushInstruction({ op: "call", funcIndex: lenIdx });
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
	}

	_emitBuiltinString(call) {
		const arg = call.args[0];
		const argType = arg._type;
		const argWType = toWasmType(argType, this.mod.checker);
		if (argWType === "i64") {
			this.emitExpr(arg, "i64");
			this.pushInstruction("i32.wrap_i64");
		} else {
			this.emitExpr(arg, "i32");
		}
		const funcIdx = this.mod.getStringFromCodePointImportIndex();
		this.pushInstruction({ op: "call", funcIndex: funcIdx });
	}

	_emitBuiltinCap(call, targetWasmType) {
		const arg = call.args[0];
		const argType = arg._type;
		if (isSliceType(argType, this.mod.checker)) {
			const elemType = this._getSliceElemType(argType);
			const sliceInfo = this.mod.getSliceType(elemType);
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			this.emitExpr(arg, sliceWType);
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 3,
			});
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (
			isArrayType(argType, this.mod.checker) ||
			(argType?.kind === "pointer" &&
				isArrayType(argType.base, this.mod.checker))
		) {
			const elemType = this._getArrayElemType(argType?.base ?? argType);
			const arrInfo = this.mod.getArrayType(elemType);
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			this.emitExpr(arg, arrWType);
			this.pushInstruction("array.len");
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
	}

	_emitBuiltinMake(call) {
		const { args } = call;
		const typeArg = args[0];
		const targetMapType =
			call._type ??
			(typeArg.kind === "TypeExpr" ? typeArg.type : typeArg._type) ??
			typeArg;
		if (isMapType(targetMapType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(
				targetMapType,
				this.mod.checker,
			);
			const mapInfo = this.mod.getMapType(keyType, valType);
			if (args[1]) {
				const hintTmp = this.acquireTemp("i32");
				this._emitIndexExprToI32(args[1], hintTmp);
				this.pushInstruction({ op: "local.get", index: hintTmp });
				this.releaseTemp(hintTmp, "i32");
			} else {
				this.pushInstruction({ op: "i32.const", value: 0 });
			}
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.makeFuncName),
			});
			return;
		}
		const elemGoType =
			this._getSliceElemType(call._type) ??
			this._getSliceElemType(
				typeArg.kind === "TypeExpr" ? typeArg.type : typeArg,
			) ??
			this._getSliceElemType(typeArg._type);
		if (elemGoType) {
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = this.mod.getSliceType(elemGoType);

			const lenTmp = this.acquireTemp("i32");
			this._emitIndexExprToI32(args[1], lenTmp);

			const capTmp = this.acquireTemp("i32");
			if (args[2]) {
				this._emitIndexExprToI32(args[2], capTmp);
			} else {
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.set", index: capTmp });
			}

			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction({ op: "local.get", index: capTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "local.get", index: capTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.emitPanic("runtime error: makeslice: len out of range");
			this.pushInstruction("end");

			if (isStructType(elemGoType, this.mod.checker, this.mod)) {
				const arrTmp = this.acquireTemp({
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: arrTmp });

				const iTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.emitZeroValue(elemGoType, arrInfo.elemWType);
				this.pushInstruction({
					op: "array.set",
					typeIndex: arrInfo.typeIndex,
				});

				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.releaseTemp(iTmp, "i32");

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.releaseTemp(arrTmp, {
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				});
			} else {
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
			}

			this.releaseTemp(capTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
		}
	}

	// With `newLen` already computed: when it exceeds the old capacity, allocate
	// a doubled (min 2, at least newLen) backing array and copy the old elements
	// into it at offset 0; otherwise reuse the old array, offset and capacity.
	_emitGrowSlice({
		arrInfo,
		elemGoType,
		oldArrTmp,
		oldOffTmp,
		oldLenTmp,
		oldCapTmp,
		newArrTmp,
		newOffTmp,
		newLenTmp,
		newCapTmp,
	}) {
		this.pushInstruction({ op: "local.get", index: newLenTmp });
		this.pushInstruction({ op: "local.get", index: oldCapTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: oldCapTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.set", index: newCapTmp });

		this.pushInstruction({ op: "local.get", index: newLenTmp });
		this.pushInstruction({ op: "local.get", index: newCapTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newLenTmp });
		this.pushInstruction({ op: "local.set", index: newCapTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newCapTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.lt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction({ op: "local.set", index: newCapTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newCapTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: newOffTmp });

		this.pushInstruction({ op: "local.get", index: oldLenTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: oldArrTmp });
		this.pushInstruction({ op: "local.get", index: oldOffTmp });
		this.pushInstruction({ op: "local.get", index: oldLenTmp });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: oldArrTmp });
		this.pushInstruction({ op: "local.set", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: oldOffTmp });
		this.pushInstruction({ op: "local.set", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: oldCapTmp });
		this.pushInstruction({ op: "local.set", index: newCapTmp });
		this.pushInstruction("end");
	}

	_emitBuiltinAppend(call) {
		const { args } = call;
		const sNode = args[0];
		const sliceGoType = sNode._type ?? call._type;
		const elemGoType = this._getSliceElemType(sliceGoType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const sliceWType = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};

		const sTmp = this.acquireTemp(sliceWType);
		this.emitExpr(sNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: sTmp });

		const oldArrTmp = this.acquireTemp(arrWType);
		const oldOffTmp = this.acquireTemp("i32");
		const oldLenTmp = this.acquireTemp("i32");
		const oldCapTmp = this.acquireTemp("i32");

		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: oldArrTmp,
			off: oldOffTmp,
			len: oldLenTmp,
			cap: oldCapTmp,
		});
		this.releaseTemp(sTmp, sliceWType);

		const newArrTmp = this.acquireTemp(arrWType);
		const newOffTmp = this.acquireTemp("i32");
		const newCapTmp = this.acquireTemp("i32");
		const newLenTmp = this.acquireTemp("i32");
		const growArgs = {
			arrInfo,
			elemGoType,
			oldArrTmp,
			oldOffTmp,
			oldLenTmp,
			oldCapTmp,
			newArrTmp,
			newOffTmp,
			newLenTmp,
			newCapTmp,
		};

		if (args.length === 2 && args[1]._spread) {
			const s2Tmp = this.acquireTemp(sliceWType);
			this.emitExpr(args[1], sliceWType);
			this.pushInstruction({ op: "local.set", index: s2Tmp });

			const s2ArrTmp = this.acquireTemp(arrWType);
			const s2OffTmp = this.acquireTemp("i32");
			const s2LenTmp = this.acquireTemp("i32");

			this._emitSliceUnpack(s2Tmp, sliceInfo, {
				arr: s2ArrTmp,
				off: s2OffTmp,
				len: s2LenTmp,
			});
			this.releaseTemp(s2Tmp, sliceWType);

			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "local.get", index: s2LenTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: newLenTmp });

			this._emitGrowSlice(growArgs);

			this.pushInstruction({ op: "local.get", index: s2LenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: newArrTmp });
			this.pushInstruction({ op: "local.get", index: newOffTmp });
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: s2ArrTmp });
			this.pushInstruction({ op: "local.get", index: s2OffTmp });
			this.pushInstruction({ op: "local.get", index: s2LenTmp });
			this._emitArrayCopy(arrInfo, elemGoType);
			this.pushInstruction("end");

			this.releaseTemp(s2LenTmp, "i32");
			this.releaseTemp(s2OffTmp, "i32");
			this.releaseTemp(s2ArrTmp, arrWType);
		} else {
			const k = args.length - 1;
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "i32.const", value: k });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: newLenTmp });

			this._emitGrowSlice(growArgs);

			for (let i = 0; i < k; i++) {
				const elemNode = args[1 + i];

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: newOffTmp });
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction("i32.add");
				if (i > 0) {
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction("i32.add");
				}
				this.emitExpr(elemNode, arrInfo.elemWType);
				this._emitCopyIfValueStruct(elemNode, elemGoType, arrInfo.elemWType);
				this.pushInstruction({
					op: "array.set",
					typeIndex: arrInfo.typeIndex,
				});
			}
		}

		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: newLenTmp });
		this.pushInstruction({ op: "local.get", index: newCapTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newLenTmp, "i32");
		this.releaseTemp(newCapTmp, "i32");
		this.releaseTemp(newOffTmp, "i32");
		this.releaseTemp(newArrTmp, arrWType);
		this.releaseTemp(oldCapTmp, "i32");
		this.releaseTemp(oldLenTmp, "i32");
		this.releaseTemp(oldOffTmp, "i32");
		this.releaseTemp(oldArrTmp, arrWType);
	}

	_emitBuiltinCopy(call, targetWasmType) {
		const { args } = call;
		const dstNode = args[0];
		const srcNode = args[1];
		if (this._sharedInfo(dstNode._type) || this._sharedInfo(srcNode._type)) {
			this.emitSharedCopy(dstNode, srcNode, targetWasmType);
			return;
		}
		const elemGoType =
			this._getSliceElemType(dstNode._type) ??
			this._getSliceElemType(srcNode._type);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const sliceWType = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const dstTmp = this.acquireTemp(sliceWType);
		this.emitExpr(dstNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: dstTmp });

		const srcTmp = this.acquireTemp(sliceWType);
		this.emitExpr(srcNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: srcTmp });

		const nTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: nTmp });

		const dstLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: dstLenTmp });

		const srcLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: srcLenTmp });

		this.pushInstruction({ op: "local.get", index: dstLenTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i32.lt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: dstLenTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: nTmp });

		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(dstLenTmp, "i32");

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: nTmp });
		this._emitArrayCopy(arrInfo, elemGoType);

		this.pushInstruction("end");

		this.releaseTemp(srcTmp, sliceWType);
		this.releaseTemp(dstTmp, sliceWType);

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.releaseTemp(nTmp, "i32");
		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
	}

	_emitBuiltinDelete(call) {
		const { args } = call;
		const mArg = args[0];
		const kArg = args[1];
		const mType = mArg._type ?? this._resolveExprGoType(mArg);
		const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);
		this.emitExpr(mArg, mapInfo.wType);
		this.emitExpr(kArg, mapInfo.keyWType);
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.deleteFuncName),
		});
	}

	_emitBuiltinClear(call) {
		const { args } = call;
		const arg = args[0];
		const argType = arg._type ?? this._resolveExprGoType(arg);
		if (isMapType(argType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(argType, this.mod.checker);
			const mapInfo = this.mod.getMapType(keyType, valType);
			this.emitExpr(arg, mapInfo.wType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.clearFuncName),
			});
			return;
		}
		if (isSliceType(argType, this.mod.checker)) {
			this.emitSliceClear(arg, argType);
			return;
		}
	}

	_emitBuiltinPrint(call) {
		const { func, args } = call;
		const isPrintln = func.name === "println";
		if (args.length === 0 && isPrintln) {
			const logIdx = this.mod.getPrintlnEmptyIndex();
			this.pushInstruction({ op: "call", funcIndex: logIdx });
			return;
		}
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const isLast = i === args.length - 1 && isPrintln;
			const isBool =
				arg._type?.name === "bool" ||
				(arg.kind === "BasicLit" && arg.litKind === "BOOL");
			const wType = toWasmType(arg._type, this.mod.checker);
			this.emitExpr(arg, wType);
			const logFuncIdx = this.mod.getLogImportIndex(wType, isLast, isBool);
			this.pushInstruction({ op: "call", funcIndex: logFuncIdx });
		}
	}

	_emitBuiltinPanic(call) {
		const { args } = call;
		const arg = args?.[0];
		if (!arg) {
			const strIdx = this.mod.internString("");
			const funcIdx = this.mod.getStringImportIndex();
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			this.pushInstruction("any.convert_extern");
		} else {
			const goType = this._resolveExprGoType(arg);
			const wType = toWasmType(goType, this.mod.checker);
			if (
				isStringType(goType, this.mod.checker) ||
				(arg.kind === "BasicLit" && arg.litKind === "STRING") ||
				wType === "externref"
			) {
				this.emitExpr(arg, "externref");
				this.pushInstruction("any.convert_extern");
			} else if (wType === "i64") {
				this.emitExpr(arg, "i64");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrFromI64ImportIndex(),
				});
				this.pushInstruction("any.convert_extern");
			} else if (wType === "i32") {
				this.emitExpr(arg, "i32");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrFromI32ImportIndex(),
				});
				this.pushInstruction("any.convert_extern");
			} else if (wType === "f64" || wType === "f32") {
				if (wType === "f32") {
					this.emitExpr(arg, "f32");
					this.pushInstruction("f64.promote_f32");
				} else {
					this.emitExpr(arg, "f64");
				}
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrFromF64ImportIndex(),
				});
				this.pushInstruction("any.convert_extern");
			} else {
				this.emitExpr(arg, "anyref");
			}
		}
		this.emitPanicThrow();
	}

	_emitBuiltinRecover(_call, targetWasmType) {
		const panicNodeTypeIndex = this.mod.getPanicNodeTypeIndex();
		const panicGlobal = this.mod.getPanicGlobalIndex();
		const tmp = this.acquireTemp("anyref");

		// tmp = null
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: tmp });

		// if (__recoverOk && __panic != null)
		if (this.recoverOkLocalIndex != null) {
			this.pushInstruction({
				op: "local.get",
				index: this.recoverOkLocalIndex,
			});
		} else {
			// Not a deferred frame and no direct recover prologue: always nil.
			this.pushInstruction({ op: "i32.const", value: 0 });
		}
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({ op: "ref.is_null" });
		this.pushInstruction({ op: "i32.eqz" });
		this.pushInstruction({ op: "i32.and" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifHasPanicNode");

		// if (__panic.recovered == 0)
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 1, // recovered
		});
		this.pushInstruction({ op: "i32.eqz" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifNotYetRecovered");

		// __panic.recovered = 1
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 1,
		});

		// tmp = __panic.val
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 0, // val
		});
		this.pushInstruction({ op: "local.set", index: tmp });

		this.pushInstruction("end"); // ifNotYetRecovered

		this.pushInstruction("end"); // ifHasPanicNode

		this.pushInstruction({ op: "local.get", index: tmp });
		this.releaseTemp(tmp, "anyref");

		if (targetWasmType === "externref") {
			this.pushInstruction("extern.convert_any");
		}
	}

	_emitBuiltinCall(call, targetWasmType) {
		const { func } = call;
		if (func.kind !== "Ident") return false;
		switch (func.name) {
			case "len":
				this._emitBuiltinLen(call, targetWasmType);
				return true;
			case "string":
				this._emitBuiltinString(call);
				return true;
			case "cap":
				this._emitBuiltinCap(call, targetWasmType);
				return true;
			case "make":
				this._emitBuiltinMake(call);
				return true;
			case "append":
				this._emitBuiltinAppend(call);
				return true;
			case "copy":
				this._emitBuiltinCopy(call, targetWasmType);
				return true;
			case "delete":
				this._emitBuiltinDelete(call);
				return true;
			case "clear":
				this._emitBuiltinClear(call);
				return true;
			case "print":
			case "println":
				this._emitBuiltinPrint(call);
				return true;
			case "panic":
				this._emitBuiltinPanic(call);
				return true;
			case "recover":
				this._emitBuiltinRecover(call, targetWasmType);
				return true;
			default:
				return false;
		}
	}

	_emitPackageCall(call, targetWasmType) {
		const { func, args } = call;
		if (func.kind !== "SelectorExpr") return false;
		if (isTestingT(func.expr?._type)) {
			this.emitTestingCall(func, args);
			return true;
		}
		const pkgName = func.expr?.name;
		switch (pkgName) {
			case "math":
				this.emitMathCall(func.field, args);
				return true;
			case "bits":
				this.emitBitsCall(func.field, args);
				return true;
			case "maps":
				this.emitMapsCall(func.field, args, targetWasmType);
				return true;
			case "slices":
				this.emitSlicesCall(func.field, args, targetWasmType);
				return true;
			case "strings":
				this.emitStringsCall(func.field, args, targetWasmType);
				return true;
			case "strconv":
				this.emitStrconvCall(func.field, args);
				return true;
			case "fmt":
				this.emitFmtCall(func.field, args);
				return true;
			case "errors":
				this.emitErrorsCall(func.field, args);
				return true;
			case "utf8":
				this.emitUtf8Call(func.field, args, targetWasmType);
				return true;
			case "sort":
				this.emitSortCall(func.field, args, targetWasmType);
				return true;
			case "shared":
				this.emitSharedNew(func.field, args);
				return true;
			default:
				return false;
		}
	}

	_emitMethodCall(call) {
		const { func, args } = call;
		if (func.kind !== "SelectorExpr") return false;

		const recvType = func.expr._type ?? this._resolveExprGoType(func.expr);
		const recvShared = this._sharedInfo(recvType);
		if (recvShared && func.field === "Subarray") {
			this.emitSharedSubarray(func.expr, args, recvShared);
			return true;
		}
		const recvTypeName = this._getReceiverTypeName(recvType, func.expr);
		if (isNonEmptyInterface(recvType, this.mod.checker)) {
			const ifaceName = recvTypeName ?? "anon";
			const dispatchName = `__dispatch_${ifaceName}_${func.field}`;
			const targetFuncIdx = this.mod.resolveFuncIndex(dispatchName);
			if (targetFuncIdx !== null) {
				const targetParamTypes = this.mod.getFuncParamTypes(dispatchName);
				const paramGoTypes = this.mod.getFuncParamGoTypes(dispatchName);
				this.emitExpr(func.expr, "anyref");
				for (let i = 0; i < args.length; i++) {
					const pType = targetParamTypes[i + 1] ?? null;
					const pGoType = paramGoTypes[i + 1] ?? null;
					this.emitExpr(args[i], pType);
					this._emitCopyIfValueStruct(args[i], pGoType, pType);
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		if (recvTypeName) {
			const methodName = `${recvTypeName}.${func.field}`;
			let targetFuncIdx = this.mod.resolveFuncIndex(methodName);
			let targetParamTypes = this.mod.getFuncParamTypes(methodName);

			// If not found directly, check embedded structs
			if (targetFuncIdx === null) {
				const structInfo = this.mod.getStructType(recvTypeName);
				if (structInfo) {
					for (const embed of structInfo.embeds) {
						const embedMethodName = `${embed.name}.${func.field}`;
						const subIdx = this.mod.resolveFuncIndex(embedMethodName);
						if (subIdx !== null) {
							targetFuncIdx = subIdx;
							targetParamTypes = this.mod.getFuncParamTypes(embedMethodName);
							const baseWType = this.toWasmType(recvType);
							this.emitExpr(func.expr, baseWType);
							this.pushInstruction({
								op: "struct.get",
								typeIndex: structInfo.typeIndex,
								fieldIndex: embed.fieldIndex,
							});
							for (let i = 0; i < args.length; i++) {
								const pType = targetParamTypes[i + 1] ?? null;
								this.emitExpr(args[i], pType);
							}
							this.pushInstruction({
								op: "call",
								funcIndex: targetFuncIdx,
							});
							return true;
						}
					}
				}
			}

			if (targetFuncIdx !== null) {
				const recvWType = targetParamTypes[0] ?? null;
				const recvGoType = this.mod.getFuncParamGoTypes(methodName)[0] ?? null;
				this.emitExpr(func.expr, recvWType);
				this._emitCopyIfValueStruct(func.expr, recvGoType, recvWType);
				const paramGoTypes = this.mod.getFuncParamGoTypes(methodName);
				for (let i = 0; i < args.length; i++) {
					const pType = targetParamTypes[i + 1] ?? null;
					const pGoType = paramGoTypes[i + 1] ?? null;
					this.emitExpr(args[i], pType);
					this._emitCopyIfValueStruct(args[i], pGoType, pType);
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		return false;
	}

	_emitStaticCall(call) {
		const { func, args } = call;
		if (func.kind !== "Ident") return false;

		const isLocal = this.resolveLocal(func.name) !== null;
		if (!isLocal) {
			const targetFuncIdx = this.mod.resolveFuncIndex(func.name);
			if (targetFuncIdx !== null) {
				const paramTypes = this.mod.getFuncParamTypes(func.name);
				const paramGoTypes = this.mod.getFuncParamGoTypes(func.name);
				for (let i = 0; i < args.length; i++) {
					const arg = args[i];
					const pType = paramTypes[i] ?? null;
					const pGoType = paramGoTypes[i] ?? null;
					this.emitExpr(arg, pType);
					this._emitCopyIfValueStruct(arg, pGoType, pType);
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		return false;
	}

	_emitClosureCall(call) {
		const { func, args } = call;
		const funcGoType = this._resolveExprGoType(func) ?? func._type;
		const closureInfo = this.mod.getClosureType(funcGoType);
		const closureWType = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};

		const closureTmp = this.acquireTemp(closureWType);
		this.emitExpr(func, closureWType);
		this.pushInstruction({ op: "local.set", index: closureTmp });

		// Push param 0: env (anyref)
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});

		// Push user arguments
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const pWType = closureInfo.paramWTypes[i] ?? null;
			const pGoType = closureInfo.sig.params[i] ?? null;
			this.emitExpr(arg, pWType);
			this._emitCopyIfValueStruct(arg, pGoType, pWType);
		}

		// Push funcref
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});

		// Call via call_ref
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		this.releaseTemp(closureTmp, closureWType);
	}

	emitCallExpr(call, targetWasmType = null) {
		const deqFunc = this._dequalify(call.func);
		if (deqFunc) {
			this.emitCallExpr({ ...call, func: deqFunc }, targetWasmType);
			return;
		}

		if (this._emitBuiltinCall(call, targetWasmType)) {
			return;
		}

		if (this._emitPackageCall(call, targetWasmType)) {
			return;
		}

		if (this._emitMethodCall(call)) {
			return;
		}

		if (this._emitStaticCall(call)) {
			return;
		}

		this._emitClosureCall(call);
	}
}
