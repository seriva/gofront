// src/backend/wasm/emit-builtins.js
// FunctionEmitter mixin: panic/recover, Go builtins (len, append, make, …) and
// call expression dispatch (static, method, closure, package).

import { hasCallOrReceive } from "../../lower/walk.js";
import { ERROR } from "../../typechecker/types.js";
import { goTypeName } from "../shared/fmt-types.js";
import { namedBase } from "../shared/named-underlying.js";
import { panicsWithNil } from "./prescan.js";
import {
	anonIfaceName,
	ERROR_STRUCT,
	getMapKeyValTypes,
	isArrayType,
	isComplex,
	isComplex64,
	isFuncType,
	isMapType,
	isNonEmptyInterface,
	isScalarType,
	isSigned,
	isSliceType,
	isStringType,
	isStructType,
	isUnhashableGoType,
	PANIC_NIL_STRUCT,
	PANIC_NIL_TEXT,
	PANIC_NIL_TYPE_NAME,
	PANIC_STRINGER,
	PANIC_STRINGER_DISPATCH,
	printOperandKind,
	toWasmType,
} from "./types.js";

export class BuiltinsEmitter {
	emitPanic(msg) {
		const strIdx = this.mod.internString(msg);
		const funcIdx = this.mod.getStringImportIndex();
		this.pushInstruction({ op: "i32.const", value: strIdx });
		this.pushInstruction({ op: "call", funcIndex: funcIdx });
		this.emitRuntimePanicThrow();
	}

	// Raises a Go runtime error from the externref message on the stack.  A
	// program that uses `error` recovers it as an `error` value (as Go's
	// `runtime.Error`); the host still reports the message text.
	emitRuntimePanicThrow() {
		if (!this.mod.hasErrorType) {
			this._emitTextPanic();
			return;
		}
		const msgTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.tee", index: msgTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
		this.emitPanicThrow(msgTmp);
		this.releaseTemp(msgTmp, "externref");
	}

	// Consumes the anyref value on the stack, pushes a PanicNode, and raises the
	// panic via `env.panic` (with the externref message in `hostMsgTmp`, else
	// the value's text from `__panic_text`); `unreachable` tells the validator
	// control never returns.
	emitPanicThrow(hostMsgTmp = null) {
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
		if (hostMsgTmp !== null) {
			this.pushInstruction({ op: "local.get", index: hostMsgTmp });
		} else {
			this.pushInstruction({ op: "local.get", index: tmpVal });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__panic_text"),
			});
		}
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
		if (t.kind === "named")
			return this._getSliceElemType(namedBase(t, this.mod.checker));
		if (t.kind === "SliceType") return t.elem;
		if (t.kind === "TypeName" && this.mod.checker?.types?.has(t.name)) {
			return this._getSliceElemType(this.mod.checker.types.get(t.name));
		}
		return null;
	}

	// `len`/`cap` of an array or array pointer: the constant length.  An
	// operand containing a call or receive is still evaluated, and its value
	// (a nil array pointer included) is dropped without being dereferenced.
	_emitConstArrayLen(call, targetWasmType) {
		const arg = call.args[0];
		if (hasCallOrReceive(arg)) {
			this.emitExpr(
				arg,
				this.toWasmType(arg._type ?? this._resolveExprGoType(arg)),
			);
			this.pushInstruction("drop");
		}
		this.pushInstruction({ op: "i32.const", value: call._constLen });
		if ((targetWasmType ?? "i64") === "i64")
			this.pushInstruction("i64.extend_i32_u");
	}

	_emitBuiltinLen(call, targetWasmType) {
		const arg = call.args[0];
		const argType = arg._type ?? this._resolveExprGoType(arg);
		// `len` of an array (or a pointer to one) is a constant, and the
		// operand is not evaluated unless it contains a call or a receive.
		if (call._constLen != null) {
			this._emitConstArrayLen(call, targetWasmType);
			return;
		}
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
		} else if (isSliceType(argType, this.mod.checker)) {
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
		} else if (
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
		} else if (isStringType(argType, this.mod.checker)) {
			this.emitExpr(arg, "externref");
			const lenIdx = this.mod.getStringLenImportIndex();
			this.pushInstruction({ op: "call", funcIndex: lenIdx });
		}
		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_u");
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
		if (call._constLen != null) {
			this._emitConstArrayLen(call, targetWasmType);
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
				fieldIndex: 3,
			});
		} else if (
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
		}
		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_u");
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
				const hint = this._emitIndexExprToI32(args[1], hintTmp);
				if (hint.unproven) {
					// The hint only sizes the table: an unrepresentable one is no hint.
					this.pushInstruction({ op: "local.get", index: hintTmp });
					this.pushInstruction({ op: "i32.const", value: 0x3fffffff });
					this.pushInstruction("i32.gt_u");
					this.pushInstruction({ op: "if", blockType: "void" });
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.pushInstruction({ op: "local.set", index: hintTmp });
					this.pushInstruction("end");
				}
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
			const lenBound = this._emitIndexExprToI32(args[1], lenTmp);

			const capTmp = this.acquireTemp("i32");
			let capBound = null;
			if (args[2]) {
				capBound = this._emitIndexExprToI32(args[2], capTmp);
			} else {
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.set", index: capTmp });
			}

			// Go: a negative len is a len panic; otherwise cap < len is a cap panic.
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.emitPanic("runtime error: makeslice: len out of range");
			this.pushInstruction("end");
			// A size a 64-bit operand saturated (at or above 2^31 - 1) cannot be
			// allocated: a WasmGC array holds fewer elements.
			const unallocatable = (tmp, what) => {
				this.pushInstruction({ op: "local.get", index: tmp });
				this.pushInstruction({ op: "i32.const", value: 0x7fffffff });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic(`runtime error: makeslice: ${what} out of range`);
				this.pushInstruction("end");
			};
			if (!capBound && lenBound.unproven) unallocatable(lenTmp, "len");
			this.pushInstruction({ op: "local.get", index: capTmp });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.emitPanic("runtime error: makeslice: cap out of range");
			this.pushInstruction("end");
			if (capBound?.unproven) unallocatable(capTmp, "cap");

			if (
				isStructType(elemGoType, this.mod.checker, this.mod) ||
				isComplex(elemGoType) ||
				(elemGoType?.kind !== "pointer" &&
					isArrayType(elemGoType, this.mod.checker))
			) {
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
				this._emitNewArray(elemGoType, arrInfo, () =>
					this.pushInstruction({ op: "local.get", index: capTmp }),
				);
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

	_emitBuiltinNew(call) {
		const targetType =
			call._type?.base ??
			(call.args[0]?.kind === "TypeExpr"
				? call.args[0].type
				: call.args[0]?._type) ??
			call.args[0];
		if (isStructType(targetType, this.mod.checker, this.mod)) {
			let structInfo = this._resolveStructInfo({ _type: targetType });
			if (!structInfo) {
				const typeName =
					targetType.kind === "named" ? targetType.name : targetType.name;
				if (typeName) structInfo = this.mod.getStructType(typeName);
			}
			if (!structInfo) {
				throw new Error(
					`Unknown struct in new: ${targetType.name ?? targetType}`,
				);
			}
			for (const f of structInfo.fields) {
				this.emitZeroValue(f.goType, f.wType);
			}
			this.pushInstruction({
				op: "struct.new",
				typeIndex: structInfo.typeIndex,
			});
			return;
		}
		if (isArrayType(targetType, this.mod.checker)) {
			const wType = this.toWasmType(targetType);
			this.emitZeroValue(targetType, wType);
			return;
		}
		const box = this.mod.getBoxType(targetType);
		const valWType = this.toWasmType(targetType);
		this.emitZeroValue(targetType, valWType);
		this.pushInstruction({
			op: "struct.new",
			typeIndex: box.typeIndex,
			typeName: box.name,
		});
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

		this._emitNewArray(elemGoType, arrInfo, () =>
			this.pushInstruction({ op: "local.get", index: newCapTmp }),
		);
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

	// The source operand of `append(b, x...)` and `copy(b, x)`: a string
	// (the only non-slice form Go allows) is converted to a fresh byte slice.
	_emitSliceOperand(node, elemGoType, sliceWType) {
		if (isStringType(node._type, this.mod.checker)) {
			this.emitExpr(node, "externref");
			this._emitStringToByteSlice({ kind: "slice", elem: elemGoType });
			return;
		}
		this.emitExpr(node, sliceWType);
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
			this._emitSliceOperand(args[1], elemGoType, sliceWType);
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
				this._emitCopyIfValue(elemNode, elemGoType, arrInfo.elemWType);
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
		this._emitSliceOperand(srcNode, elemGoType, sliceWType);
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
		const isPrintln = call._builtinName === "println";
		if (args.length === 0 && isPrintln) {
			const logIdx = this.mod.getPrintlnEmptyIndex();
			this.pushInstruction({ op: "call", funcIndex: logIdx });
			return;
		}
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const isLast = i === args.length - 1 && isPrintln;
			const { wType, isBool, widen } = printOperandKind(arg, this.mod.checker);
			this.emitExpr(
				arg,
				widen ? "i32" : toWasmType(arg._type, this.mod.checker),
			);
			if (widen) this.pushInstruction("i64.extend_i32_u");
			const logFuncIdx = this.mod.getLogImportIndex(wType, isLast, isBool);
			this.pushInstruction({ op: "call", funcIndex: logFuncIdx });
			// `print` never separates operands; `println` always does.
			if (!isPrintln) {
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getPrintResetIndex(),
				});
			}
		}
	}

	_emitBuiltinPanic(call) {
		const arg = call.args?.[0];
		if (!arg) {
			this._pushStringConst("");
			this._emitTextPanic();
			return;
		}
		const goType = this._resolveExprGoType(arg);
		const wType = toWasmType(goType, this.mod.checker);
		// A defined string type keeps its identity (and methods) in the panic
		// value, so `recover()` returns it, not the bare string.  Every value
		// that is not a plain string (or host reference) reaches the host with
		// the text `__panic_text` gives its dynamic type, as in `var a any = v`.
		const plainString =
			isStringType(goType, this.mod.checker) ||
			(arg.kind === "BasicLit" && arg.litKind === "STRING") ||
			wType === "externref";
		if (plainString && goType?.kind !== "named") {
			this.emitExpr(arg, "externref");
			this._emitTextPanic();
			return;
		}
		this.emitExpr(arg, "anyref");
		if (this.mod.usesPanicNil && panicsWithNil(call, this.mod.checker))
			this._emitPanicNilGuard();
		this.emitPanicThrow();
	}

	// The anyref value on the stack, or a fresh `*runtime.PanicNilError` when
	// it is nil: Go's `panic(nil)` panics with that error.
	_emitPanicNilGuard() {
		const nilError = this.mod.getStructType(PANIC_NIL_STRUCT);
		const valTmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "local.tee", index: valTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "anyref" });
		this.pushInstruction({ op: "struct.new", typeIndex: nilError.typeIndex });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("end");
		this.releaseTemp(valTmp, "anyref");
	}

	// Raises the panic whose value and host message are the externref string
	// on the stack.
	_emitTextPanic() {
		const textTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.tee", index: textTmp });
		this.pushInstruction("any.convert_extern");
		this.emitPanicThrow(textTmp);
		this.releaseTemp(textTmp, "externref");
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

	_emitBuiltinComplex(call, targetWasmType) {
		const arg0 = call.args[0];
		const arg1 = call.args[1];
		const callType = call._type;
		const is64 =
			callType?.name === "complex64" ||
			arg0._type?.name === "float32" ||
			arg1._type?.name === "float32" ||
			this._isComplex64Target(targetWasmType);
		const complexName = is64 ? "complex64" : "complex128";
		const info = this.mod.getComplexType(complexName);
		this.emitExpr(arg0, info.elemWType);
		this.emitExpr(arg1, info.elemWType);
		this.pushInstruction({
			op: "struct.new",
			typeIndex: info.typeIndex,
			typeName: info.name,
		});
	}

	_emitBuiltinReal(call, targetWasmType) {
		const arg = call.args[0];
		const argType = arg._type ?? this._resolveExprGoType(arg);
		const is64 = isComplex64(argType);
		const complexName = is64 ? "complex64" : "complex128";
		const info = this.mod.getComplexType(complexName);
		const complexWType = {
			kind: "ref",
			nullable: true,
			typeIndex: info.typeIndex,
			typeName: info.name,
		};
		this.emitExpr(arg, complexWType);
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		if (targetWasmType && targetWasmType !== info.elemWType) {
			if (info.elemWType === "f32" && targetWasmType === "f64") {
				this.pushInstruction("f64.promote_f32");
			} else if (info.elemWType === "f64" && targetWasmType === "f32") {
				this.pushInstruction("f32.demote_f64");
			}
		}
	}

	_emitBuiltinImag(call, targetWasmType) {
		const arg = call.args[0];
		const argType = arg._type ?? this._resolveExprGoType(arg);
		const is64 = isComplex64(argType);
		const complexName = is64 ? "complex64" : "complex128";
		const info = this.mod.getComplexType(complexName);
		const complexWType = {
			kind: "ref",
			nullable: true,
			typeIndex: info.typeIndex,
			typeName: info.name,
		};
		this.emitExpr(arg, complexWType);
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		if (targetWasmType && targetWasmType !== info.elemWType) {
			if (info.elemWType === "f32" && targetWasmType === "f64") {
				this.pushInstruction("f64.promote_f32");
			} else if (info.elemWType === "f64" && targetWasmType === "f32") {
				this.pushInstruction("f32.demote_f64");
			}
		}
	}

	// min/max fold left over the operands: floats use f32/f64.min/max (NaN
	// propagates, -0 < +0), integers `select` on lt/gt, strings compare via the
	// string import.  A single operand is the result itself.
	_emitBuiltinMinMax(call, targetWasmType) {
		const isMin = call._builtinName === "min";
		const goType = call._type ?? this._resolveExprGoType(call.args[0]);
		const wType =
			goType?.kind === "untyped" && typeof targetWasmType === "string"
				? targetWasmType
				: toWasmType(goType, this.mod.checker);
		const [first, ...rest] = call.args;
		this.emitExpr(first, wType);
		if (rest.length === 0) return;
		const acc = this.acquireTemp(wType);
		const next = this.acquireTemp(wType);
		const isStr = isStringType(goType, this.mod.checker);
		const isFloatType = wType === "f32" || wType === "f64";
		const cmp = isMin ? "lt" : "gt";
		for (const arg of rest) {
			this.pushInstruction({ op: "local.set", index: acc });
			this.emitExpr(arg, wType);
			this.pushInstruction({ op: "local.set", index: next });
			if (isFloatType) {
				this.pushInstruction({ op: "local.get", index: acc });
				this.pushInstruction({ op: "local.get", index: next });
				this.pushInstruction(`${wType}.${isMin ? "min" : "max"}`);
				continue;
			}
			if (isStr) {
				// next < acc (min) / next > acc (max) ? next : acc
				this.pushInstruction({ op: "local.get", index: next });
				this.pushInstruction({ op: "local.get", index: acc });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCmpImportIndex(isMin ? "<" : ">"),
				});
				this.pushInstruction({ op: "if", blockType: wType });
				this.pushInstruction({ op: "local.get", index: next });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: acc });
				this.pushInstruction("end");
				continue;
			}
			this.pushInstruction({ op: "local.get", index: next });
			this.pushInstruction({ op: "local.get", index: acc });
			this.pushInstruction({ op: "local.get", index: next });
			this.pushInstruction({ op: "local.get", index: acc });
			this.pushInstruction(`${wType}.${cmp}_${isSigned(goType) ? "s" : "u"}`);
			this.pushInstruction("select");
		}
		this.releaseTemp(next, wType);
		this.releaseTemp(acc, wType);
	}

	_emitBuiltinCall(call, targetWasmType) {
		const { func } = call;
		if (func.kind !== "Ident") return false;
		const split = this._splitForwardedBuiltin(call);
		if (split) return this._emitBuiltinCall(split, targetWasmType);
		// The checker names a call to the predeclared builtin; a user
		// declaration spelled `len` or `max` is an ordinary call.
		const name = func.name === "string" ? "string" : call._builtinName;
		switch (name) {
			case "len":
				this._emitBuiltinLen(call, targetWasmType);
				return true;
			case "string":
				this._emitBuiltinString(call);
				return true;
			case "cap":
				this._emitBuiltinCap(call, targetWasmType);
				return true;
			case "new":
				this._emitBuiltinNew(call);
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
			case "complex":
				this._emitBuiltinComplex(call, targetWasmType);
				return true;
			case "real":
				this._emitBuiltinReal(call, targetWasmType);
				return true;
			case "imag":
				this._emitBuiltinImag(call, targetWasmType);
				return true;
			case "min":
			case "max":
				this._emitBuiltinMinMax(call, targetWasmType);
				return true;
			default:
				return false;
		}
	}

	_emitPackageCall(call, targetWasmType) {
		const { func, args } = call;
		if (func.kind !== "SelectorExpr") return false;
		if (
			func.expr?.name &&
			(this.resolveLocal(func.expr.name) ||
				this.mod.resolveGlobal(func.expr.name))
		)
			return false;
		const pkgName = func.expr?.name;
		switch (pkgName) {
			case "shared":
				this.emitSharedNew(func.field, args);
				return true;
			case "simd":
				this.emitSimdPackageCall(func.field, args, targetWasmType);
				return true;
			default:
				return false;
		}
	}

	_emitMethodCall(call, targetWasmType = null) {
		const { func, args } = call;
		if (func.kind !== "SelectorExpr") return false;

		const recvType = func.expr._type ?? this._resolveExprGoType(func.expr);
		const recvShared = this._sharedInfo(recvType);
		if (recvShared && func.field === "Subarray") {
			this.emitSharedSubarray(func.expr, args, recvShared);
			return true;
		}
		const recvTypeName = this._getReceiverTypeName(recvType, func.expr);
		if (
			recvTypeName === "simd.F32x4" ||
			recvTypeName === "gofront/simd.F32x4" ||
			recvType?.kind === "simd" ||
			recvType?.underlying?.kind === "simd" ||
			recvType?.name === "simd.F32x4"
		) {
			return this.emitSimdMethodCall(
				func.field,
				func.expr,
				args,
				targetWasmType,
				recvTypeName === "simd.Mask32x4" ||
					recvType?.underlying?.simd === "Mask32x4" ||
					recvType?.simd === "Mask32x4",
			);
		}
		if (isNonEmptyInterface(recvType, this.mod.checker)) {
			const ifaceName = recvTypeName ?? anonIfaceName(recvType);
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
					this._emitCopyIfValue(args[i], pGoType, pType);
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		if (recvTypeName) {
			const methodName = `${recvTypeName}.${func.field}`;
			const targetFuncIdx = this.mod.resolveFuncIndex(methodName);
			const targetParamTypes = this.mod.getFuncParamTypes(methodName);

			// If not found directly, check embedded structs
			if (
				targetFuncIdx === null &&
				this._emitEmbeddedMethodCall(recvTypeName, func, args, recvType)
			) {
				return true;
			}

			if (targetFuncIdx !== null) {
				const recvWType = targetParamTypes[0] ?? null;
				const recvGoType = this.mod.getFuncParamGoTypes(methodName)[0] ?? null;
				this.emitExpr(this._recvOperand(func, recvGoType), recvWType);
				// `p.M()` with a value receiver reads `*p`: a nil `p` panics here.
				if (
					recvGoType?.kind !== "pointer" &&
					isStructType(recvGoType, this.mod.checker, this.mod)
				)
					this._emitNilCheck(func.expr._type);
				this._emitCopyIfValue(func.expr, recvGoType, recvWType);
				const paramGoTypes = this.mod.getFuncParamGoTypes(methodName);
				for (let i = 0; i < args.length; i++) {
					const pType = targetParamTypes[i + 1] ?? null;
					const pGoType = paramGoTypes[i + 1] ?? null;
					this.emitExpr(args[i], pType);
					this._emitCopyIfValue(args[i], pGoType, pType);
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		return false;
	}

	// The receiver operand of a method call: `p.Get()` with a value receiver
	// and `p *N` (a named scalar or slice) passes `*p`.
	_recvOperand(func, recvGoType) {
		const t = func.expr._type;
		// A pointer receiver on `*p` gets `p` itself, so the method mutates *p.
		if (recvGoType?.kind === "pointer") {
			const pointer = this._structDerefPointer(func.expr);
			if (pointer) return pointer;
		}
		if (
			t?.kind === "pointer" &&
			recvGoType?.kind !== "pointer" &&
			(isScalarType(t.base, this.mod.checker, this.mod) ||
				isSliceType(t.base, this.mod.checker))
		)
			return { kind: "UnaryExpr", op: "*", operand: func.expr, _type: t.base };
		return this._ptrRecvOperand(func);
	}

	// `x.M()` with a pointer receiver on a named scalar value passes `&x`
	// (the typechecker boxed `x`).
	_ptrRecvOperand(func) {
		const t = func.expr._type;
		if (!func._type?._ptrRecv || t?.kind !== "named") return func.expr;
		if (
			!isScalarType(t, this.mod.checker, this.mod) &&
			!isSliceType(t, this.mod.checker)
		)
			return func.expr;
		return {
			kind: "UnaryExpr",
			op: "&",
			operand: func.expr,
			_type: { kind: "pointer", base: t },
		};
	}

	// The embedded struct (possibly several levels down) that declares or
	// forwards `method`: the chain of embeds to follow and the method's name.
	_findEmbeddedMethod(structInfo, method, seen = new Set()) {
		if (seen.has(structInfo)) return null;
		seen.add(structInfo);
		for (const embed of structInfo.embeds ?? []) {
			const typeName = embed.typeName ?? embed.name;
			const methodName = `${typeName}.${method}`;
			const ifaceType = structInfo.fields[embed.fieldIndex]?.goType;
			if (this.mod.embeddedInterfaceHas(ifaceType, method))
				return { chain: [{ structInfo, embed }], ifaceType };
			if (this.mod.resolveFuncIndex(methodName) !== null)
				return { chain: [{ structInfo, embed }], methodName };
			const inner = this.mod.getStructType(typeName);
			const deeper = inner && this._findEmbeddedMethod(inner, method, seen);
			if (deeper)
				return {
					...deeper,
					chain: [{ structInfo, embed }, ...deeper.chain],
				};
		}
		return null;
	}

	_emitEmbeddedMethodCall(recvTypeName, func, args, recvType) {
		const structInfo = this.mod.getStructType(recvTypeName);
		if (!structInfo) return false;
		const found = this._findEmbeddedMethod(structInfo, func.field);
		if (!found) return false;
		const { chain, methodName, ifaceType } = found;
		// A method promoted from an embedded interface is dispatched on the
		// interface value the last embed holds.
		const dispatchName = ifaceType
			? `__dispatch_${this._getReceiverTypeName(ifaceType)}_${func.field}`
			: null;
		const subName = dispatchName ?? methodName;
		const subIdx = this.mod.resolveFuncIndex(subName);
		if (subIdx === null)
			throw new Error(`internal: no interface dispatcher ${subName}`);
		const targetParamTypes = this.mod.getFuncParamTypes(subName);
		const valueRecv =
			!ifaceType &&
			this.mod.getFuncParamGoTypes(methodName)[0]?.kind !== "pointer";
		this.emitExpr(func.expr, this.toWasmType(recvType));
		this._emitNilCheck(func.expr._type);
		for (const [i, { structInfo: owner, embed }] of chain.entries()) {
			this.pushInstruction({
				op: "struct.get",
				typeIndex: owner.typeIndex,
				fieldIndex: embed.fieldIndex,
			});
			// Reading through an embedded nil pointer (to the next embedded
			// struct, or as a value receiver) is a recoverable nil dereference.
			const ft = owner.fields[embed.fieldIndex]?.goType;
			const isPtr = ft?.kind === "pointer" || ft?.kind === "PointerType";
			if (isPtr && (i < chain.length - 1 || valueRecv)) this._emitNilBranch();
		}
		for (let i = 0; i < args.length; i++) {
			const pType = targetParamTypes[i + 1] ?? null;
			this.emitExpr(args[i], pType);
		}
		this.pushInstruction({
			op: "call",
			funcIndex: subIdx,
		});
		return true;
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
				if (call._multiForward) {
					// `f(g())`: g's results are f's arguments as they come.
					this.emitExpr(args[0], null);
					this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
					return true;
				}
				for (let i = 0; i < args.length; i++) {
					const arg = args[i];
					const pType = paramTypes[i] ?? null;
					const pGoType = paramGoTypes[i] ?? null;
					this.emitExpr(arg, pType);
					this._emitCopyIfValue(arg, pGoType, pType);
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
		// Calling a nil func value panics like a nil pointer dereference.
		this._emitNilBranch();
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
			this._emitCopyIfValue(arg, pGoType, pWType);
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

	// `g(f())` that lowering left unsplit (it splits only statement operands):
	// f's results go into locals, and g is called with idents carrying each
	// element's interface-box marks, so each is boxed like any argument. Also
	// used for method calls, whose argument path expects one value per
	// parameter. Only when g's callee evaluates no call, so f() still runs
	// before anything else the call evaluates.
	_splitForwardedArgs(call) {
		if (!call._multiForward || call.args?.length !== 1) return null;
		const inner = call.args[0];
		const types = inner?._type?.types;
		if (!Array.isArray(types) || types.length === 0) return null;
		const holders =
			inner._fwdIface?.length === types.length ? inner._fwdIface : null;
		const isMethod =
			call.func?.kind === "SelectorExpr" &&
			call.func.expr?._type?.kind !== "namespace";
		if (!holders && !isMethod) return null;
		if (hasCallOrReceive(call.func)) return null;
		const args = this._spillForwardedResults(
			inner,
			types,
			holders ?? [],
			"__fwdarg",
		);
		return { ...call, args, _multiForward: false };
	}

	// `min(f())`, `append(f())`: the builtin was checked against one operand
	// node per result (`call._fwdArgs`); f's results go into locals and the
	// builtin is emitted over those operands.
	_splitForwardedBuiltin(call) {
		const operands = call._fwdArgs;
		if (!call._multiForward || !operands) return null;
		const types = operands.map((o) => o._type);
		const args = this._spillForwardedResults(
			call.args[0],
			types,
			operands,
			"__fwdbi",
		);
		return { ...call, args, _multiForward: false };
	}

	// Evaluates the multi-value call `inner` into fresh locals and returns one
	// ident per result, each carrying that element's checker marks (`marks`).
	_spillForwardedResults(inner, types, marks, prefix) {
		this.emitExpr(inner, null);
		this._fwdArgCounter = (this._fwdArgCounter ?? 0) + 1;
		const names = types.map((_, i) => `${prefix}$${this._fwdArgCounter}$${i}`);
		const locals = types.map((t, i) =>
			this.allocLocal(names[i], this.toWasmType(t), t, true),
		);
		for (let i = locals.length - 1; i >= 0; i--)
			this.pushInstruction({ op: "local.set", index: locals[i] });
		return names.map((name, i) => ({
			...(marks[i] ?? {}),
			kind: "Ident",
			name,
			_type: types[i],
		}));
	}

	emitCallExpr(call, targetWasmType = null) {
		if (call._isTypeConversion) {
			this.emitTypeConversion({
				targetType: call._conversionTargetType,
				expr: call.args[0],
			});
			return;
		}

		const deqFunc = this._dequalify(call.func);
		if (deqFunc) {
			this.emitCallExpr({ ...call, func: deqFunc }, targetWasmType);
			return;
		}

		if (this._emitBuiltinCall(call, targetWasmType)) {
			return;
		}

		const forwarded = this._splitForwardedArgs(call);
		if (forwarded) {
			this.emitCallExpr(forwarded, targetWasmType);
			return;
		}

		if (this._emitPackageCall(call, targetWasmType)) {
			return;
		}

		if (this._emitMethodCall(call, targetWasmType)) {
			return;
		}

		if (this._emitStaticCall(call)) {
			return;
		}

		this._emitClosureCall(call);
	}

	emitSliceClear(arg, argType) {
		const elemGoType = this._getSliceElemType(argType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(arg, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const iLoc = this.acquireTemp("i32");

		this._emitSliceUnpack(sliceTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.emitZeroValue(elemGoType, arrInfo.elemWType);
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end");
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	// Pushes an integer-ish argument as i32 (Go ints are i64 in this backend).
	_emitI32Arg(arg) {
		const wType = toWasmType(arg?._type, this.mod.checker);
		if (wType === "i64") {
			this.emitExpr(arg, "i64");
			this.pushInstruction("i32.wrap_i64");
		} else {
			this.emitExpr(arg, "i32");
		}
	}

	// `a == b` for two anyref operands (interface values).  `ref.eq` only
	// accepts eqref, so host strings (internalised externs) are compared via
	// `str_eq` and anything else by identity.
	_emitAnyEq() {
		const idx = this.mod.resolveFuncIndex("__any_eq");
		if (idx === null) {
			throw new Error(
				"internal: anyref equality emitted but __any_eq was not declared (usesAnyEq scan missed a site)",
			);
		}
		this.pushInstruction({ op: "call", funcIndex: idx });
	}

	// Every `[wasm type index, Go type name]` an `any` can hold in this module,
	// more specific types last so they overwrite their supertypes.
	_dynamicTypeNames() {
		const mod = this.mod;
		const names = [];
		for (const s of mod.sliceTypes.values())
			names.push([
				s.typeIndex,
				goTypeName({ kind: "slice", elem: s.elemGoType }),
			]);
		for (const m of mod.mapTypes.values())
			names.push([
				m.typeIndex,
				goTypeName({ kind: "map", key: m.keyGoType, value: m.valGoType }),
			]);
		for (const info of new Set(mod.structTypes.values())) {
			if (info.isAnon) continue;
			names.push([
				info.typeIndex,
				info.name === ERROR_STRUCT
					? "*errors.errorString"
					: info.name === PANIC_NIL_STRUCT
						? PANIC_NIL_TYPE_NAME
						: `*${goTypeName({
								kind: "named",
								name: info.name,
								_pkgName: info.pkgName,
							})}`,
			]);
		}
		for (const c of mod.closureTypes.values())
			names.push([
				c.typeIndex,
				goTypeName({
					kind: "func",
					params: c.sig.params,
					returns: c.sig.returns,
				}),
			]);
		for (const box of mod.ifaceBoxTypes.values())
			names.push([box.typeIndex, goTypeName(box.goType)]);
		for (const info of mod.taggedSliceTypes.values())
			names.push([info.typeIndex, goTypeName(info.goType)]);
		for (const info of mod.nilBoxTypes.values())
			names.push([info.typeIndex, goTypeName(info.goType)]);
		return names;
	}

	// Body of `__ta_fail(v any, src string, target string, iface int32)`: panics
	// with Go's failed type assertion message, naming the dynamic type of `v`
	// from the types the module knows (`src` is the static interface type, or
	// the first method the target interface needs when `iface` is 1).
	_emitTypeAssertFail() {
		const strConst = (text) => {
			this.pushInstruction({
				op: "i32.const",
				value: this.mod.internString(text),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
		};
		const concat = () =>
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringConcatImportIndex(),
			});
		const dyn = this.allocLocal(null, "externref");
		strConst("interface {}");
		this.pushInstruction({ op: "local.set", index: dyn });
		const when = (typeIndex, text) => {
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction({ op: "ref.test", typeIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			strConst(text);
			this.pushInstruction({ op: "local.set", index: dyn });
			this.pushInstruction("end");
		};
		for (const [typeIndex, text] of this._dynamicTypeNames())
			when(typeIndex, text);
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getIsStringImportIndex(),
		});
		this.pushInstruction({ op: "if", blockType: "void" });
		strConst("string");
		this.pushInstruction({ op: "local.set", index: dyn });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		strConst("nil");
		this.pushInstruction({ op: "local.set", index: dyn });
		this.pushInstruction("end");

		// An interface target: `<dyn> is not <target>: missing method <M>`.
		this.pushInstruction({ op: "local.get", index: 3 });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		strConst("interface conversion: interface is nil, not ");
		this.pushInstruction({ op: "local.get", index: 2 });
		concat();
		this.emitRuntimePanicThrow();
		this.pushInstruction("end");
		strConst("interface conversion: ");
		this.pushInstruction({ op: "local.get", index: dyn });
		concat();
		strConst(" is not ");
		concat();
		this.pushInstruction({ op: "local.get", index: 2 });
		concat();
		strConst(": missing method ");
		concat();
		this.pushInstruction({ op: "local.get", index: 1 });
		concat();
		this.emitRuntimePanicThrow();
		this.pushInstruction("end");

		strConst("interface conversion: ");
		this.pushInstruction({ op: "local.get", index: 1 });
		concat();
		strConst(" is ");
		concat();
		this.pushInstruction({ op: "local.get", index: dyn });
		concat();
		strConst(", not ");
		concat();
		this.pushInstruction({ op: "local.get", index: 2 });
		concat();
		this.emitRuntimePanicThrow();
	}

	// Body of `__panic_text(v any) string`: the text the host shows for an
	// uncaught panic with the value `v`, as Go's `printpanicval` builds it from
	// the dynamic type: a string as is, `Error()` of an `error`, else
	// `String()` of a `Stringer`, a boxed basic value by its type (unsigned
	// widths unsigned, `bool` as `true`/`false`, complex as `(re+imi)`), a
	// defined basic type as `<pkg>.T(v)` (a string quoted), anything else as
	// `[panic object]`.
	_emitPanicText() {
		const emit = (ins) => this.pushInstruction(ins);
		const text = (s) => this._pushStringConst(s);
		const concat = () =>
			emit({
				op: "call",
				funcIndex: this.mod.getStringConcatImportIndex(),
			});
		emit({ op: "local.get", index: 0 });
		emit({ op: "call", funcIndex: this.mod.getIsStringImportIndex() });
		emit({ op: "if", blockType: "void" });
		emit({ op: "local.get", index: 0 });
		emit("extern.convert_any");
		emit("return");
		emit("end");
		// `error` before `Stringer`, as Go prints a value with both.
		this._emitPanicMethodArm(ERROR, "__dispatch_error_Error");
		this._emitPanicMethodArm(PANIC_STRINGER, PANIC_STRINGER_DISPATCH);
		for (const box of this.mod.ifaceBoxTypes.values()) {
			const kind = this._panicBoxKind(box);
			if (!kind) continue;
			const isComplexKind = kind === "complex64" || kind === "complex128";
			emit({ op: "local.get", index: 0 });
			emit({ op: "ref.test", typeIndex: box.typeIndex });
			emit({ op: "if", blockType: "void" });
			const defined = box.goType.kind === "named";
			if (defined || isComplexKind)
				text(
					`${defined ? goTypeName(box.goType) : ""}(${kind === "string" ? '"' : ""}`,
				);
			emit({ op: "local.get", index: 0 });
			emit({ op: "ref.cast", typeIndex: box.typeIndex });
			emit({ op: "struct.get", typeIndex: box.typeIndex, fieldIndex: 0 });
			this._emitPanicScalarText(kind, box.wType);
			if (defined || isComplexKind) {
				concat();
				text(kind === "string" ? '")' : ")");
				concat();
			}
			emit("return");
			emit("end");
		}
		text("[panic object]");
		emit("return");
	}

	// Returns the string `dispatch` makes of the value in local 0 when its
	// dynamic type implements `ifaceType`.
	_emitPanicMethodArm(ifaceType, dispatch) {
		if (
			!this.mod.funcMap.has(dispatch) ||
			this.mod.getTypesImplementingInterface(ifaceType).length === 0
		)
			return;
		this.pushInstruction({ op: "local.get", index: 0 });
		this._emitInterfaceTypeTest(ifaceType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(dispatch),
		});
		this.pushInstruction("return");
		this.pushInstruction("end");
	}

	// How a boxed value prints in a panic message: its `kind` is `bool`,
	// `int`, `uint`, `float`, `complex64`, `complex128`, or `string`; null for
	// a box `printpanicval` shows by address or `[panic object]`.
	_panicBoxKind(box) {
		// An untyped constant is boxed under its untyped kind (`panic(42)`).
		const base =
			box.goType.kind === "untyped"
				? { kind: "basic", name: box.goType.base }
				: namedBase(box.goType, this.mod.checker);
		const name = base?.kind === "basic" ? base.name : null;
		if (name === "bool") return "bool";
		if (name === "string") return "string";
		if (name === "float32" || name === "float64") return "float";
		if (name === "complex64" || name === "complex128") return name;
		if (name === "byte" || name?.startsWith("uint")) return "uint";
		if (name === "rune" || /^int(8|16|32|64)?$/.test(name ?? "")) return "int";
		return null;
	}

	// The boxed basic value on the stack, of wasm type `wType`, as text.
	_emitPanicScalarText(kind, wType) {
		const emit = (ins) => this.pushInstruction(ins);
		const mod = this.mod;
		const call = (funcIndex) => emit({ op: "call", funcIndex });
		switch (kind) {
			case "string":
				return;
			case "bool":
				emit({ op: "if", blockType: "externref" });
				this._pushStringConst("true");
				emit("else");
				this._pushStringConst("false");
				emit("end");
				return;
			case "float":
				if (wType === "f32") emit("f64.promote_f32");
				call(mod.getStrFromF64ImportIndex());
				return;
			case "complex64":
			case "complex128":
				this._emitPanicComplexText(kind, wType);
				return;
			case "uint":
				if (wType === "i32") emit("i64.extend_i32_u");
				call(mod.getStrFromU64ImportIndex());
				return;
			default:
				call(
					wType === "i64"
						? mod.getStrFromI64ImportIndex()
						: mod.getStrFromI32ImportIndex(),
				);
		}
	}

	// Formats the complex struct on the stack as `re+imi` (without outer
	// parentheses, which `_emitPanicText` supplies).
	_emitPanicComplexText(kind, wType) {
		const emit = (ins) => this.pushInstruction(ins);
		const mod = this.mod;
		const info = mod.getComplexType(kind);
		const cTmp = this.acquireTemp(wType);
		const reTmp = this.acquireTemp("f64");
		const imTmp = this.acquireTemp("f64");
		const outTmp = this.acquireTemp("externref");

		emit({ op: "local.set", index: cTmp });
		emit({ op: "local.get", index: cTmp });
		emit("ref.is_null");
		emit({ op: "if", blockType: "void" });
		emit({ op: "f64.const", value: 0 });
		emit({ op: "local.set", index: reTmp });
		emit({ op: "f64.const", value: 0 });
		emit({ op: "local.set", index: imTmp });
		emit("else");
		for (const [fieldIndex, dst] of [
			[0, reTmp],
			[1, imTmp],
		]) {
			emit({ op: "local.get", index: cTmp });
			emit({ op: "struct.get", typeIndex: info.typeIndex, fieldIndex });
			if (info.elemWType === "f32") emit("f64.promote_f32");
			emit({ op: "local.set", index: dst });
		}
		emit("end");

		emit({ op: "local.get", index: reTmp });
		emit({ op: "call", funcIndex: mod.getStrFromF64ImportIndex() });
		emit({ op: "local.set", index: outTmp });

		// Prefix `+` unless `im` is `+Inf` (already `+Inf`) or a non-NaN value
		// with its sign bit set (`-0`, negative finite, `-Inf`).
		emit({ op: "local.get", index: imTmp });
		emit({ op: "local.get", index: imTmp });
		emit("f64.eq");
		emit({ op: "local.get", index: imTmp });
		emit("i64.reinterpret_f64");
		emit({ op: "i64.const", value: 0n });
		emit("i64.lt_s");
		emit("i32.and");
		emit({ op: "local.get", index: imTmp });
		emit({ op: "f64.const", value: Infinity });
		emit("f64.eq");
		emit("i32.or");
		emit("i32.eqz");
		emit({ op: "if", blockType: "void" });
		emit({ op: "local.get", index: outTmp });
		this._pushStringConst("+");
		emit({ op: "call", funcIndex: mod.getStringConcatImportIndex() });
		emit({ op: "local.set", index: outTmp });
		emit("end");

		emit({ op: "local.get", index: outTmp });
		emit({ op: "local.get", index: imTmp });
		emit({ op: "call", funcIndex: mod.getStrFromF64ImportIndex() });
		emit({ op: "call", funcIndex: mod.getStringConcatImportIndex() });
		this._pushStringConst("i");
		emit({ op: "call", funcIndex: mod.getStringConcatImportIndex() });

		this.releaseTemp(outTmp, "externref");
		this.releaseTemp(imTmp, "f64");
		this.releaseTemp(reTmp, "f64");
		this.releaseTemp(cTmp, wType);
	}

	// `any_eq` arm for two arrays of one wasm array type (an array stored in
	// an interface is the array ref itself): equal lengths and elements.
	_emitAnyArrayEqArm(arrInfo) {
		const ref = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		for (const idx of [0, 1]) {
			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({ op: "ref.test", typeIndex: arrInfo.typeIndex });
		}
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "if", blockType: "void" });
		const a1 = this.allocLocal(null, ref);
		const a2 = this.allocLocal(null, ref);
		for (const [src, dst] of [
			[0, a1],
			[1, a2],
		]) {
			this.pushInstruction({ op: "local.get", index: src });
			this.pushInstruction({ op: "ref.cast", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: dst });
		}
		const len = this.allocLocal(null, "i32");
		this.pushInstruction({ op: "local.get", index: a1 });
		this.pushInstruction("array.len");
		this.pushInstruction({ op: "local.tee", index: len });
		this.pushInstruction({ op: "local.get", index: a2 });
		this.pushInstruction("array.len");
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("return");
		this.pushInstruction("end");
		const i = this.allocLocal(null, "i32");
		const e1 = this.allocLocal(null, arrInfo.elemWType);
		const e2 = this.allocLocal(null, arrInfo.elemWType);
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_u");
		this.pushInstruction({ op: "br_if", depth: 1 });
		for (const [arr, dst] of [
			[a1, e1],
			[a2, e2],
		]) {
			this.pushInstruction({ op: "local.get", index: arr });
			this.pushInstruction({ op: "local.get", index: i });
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: dst });
		}
		this.emitKeyEq(e1, e2, arrInfo.elemGoType);
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("return");
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("return");
		this.pushInstruction("end");
	}

	// `any_hash` arm for an array: the wasm array type, then each element,
	// as `emitKeyHash` combines a static array key (so equal arrays under
	// `any_eq` hash equal).
	_emitAnyArrayHashArm(arrInfo) {
		const ref = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "ref.test", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "if", blockType: "void" });
		const arr = this.allocLocal(null, ref);
		const h = this.allocLocal(null, "i32");
		const i = this.allocLocal(null, "i32");
		const e = this.allocLocal(null, arrInfo.elemWType);
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "ref.cast", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: arr });
		this.pushInstruction({ op: "i32.const", value: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: h });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction("array.len");
		this.pushInstruction("i32.ge_u");
		this.pushInstruction({ op: "br_if", depth: 1 });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: e });
		this.pushInstruction({ op: "local.get", index: h });
		this.pushInstruction({ op: "i32.const", value: 31 });
		this.pushInstruction("i32.mul");
		this.emitKeyHash(e, arrInfo.elemGoType);
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: h });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: h });
		this.pushInstruction("return");
		this.pushInstruction("end");
	}

	emitRuntimeHelper(fn) {
		const errInfo = this.mod.getStructType(ERROR_STRUCT);
		switch (fn._isRuntimeHelper) {
			case "any_eq": {
				const bothNull = () => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction("ref.is_null");
					this.pushInstruction({ op: "local.get", index: 1 });
					this.pushInstruction("ref.is_null");
				};
				bothNull();
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("return");
				this.pushInstruction("end");
				bothNull();
				this.pushInstruction("i32.or");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Check unhashable / uncomparable types
				const checkUncomparable = (typeIndex) => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction({ op: "local.get", index: 1 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction("i32.or");
					this.pushInstruction({ op: "if", blockType: "void" });
					this.emitPanic("runtime error: comparing uncomparable type");
					this.pushInstruction("end");
				};
				for (const s of this.mod.sliceTypes.values())
					checkUncomparable(s.typeIndex);
				for (const m of this.mod.mapTypes.values())
					checkUncomparable(m.typeIndex);
				for (const c of this.mod.closureTypes.values())
					checkUncomparable(c.typeIndex);
				for (const b of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(b.goType, this.mod.checker))
						checkUncomparable(b.typeIndex);
				}
				for (const a of this.mod.arrayTypes.values()) {
					if (isUnhashableGoType(a.elemGoType, this.mod.checker))
						checkUncomparable(a.typeIndex);
				}

				// Boxed values compare by value (Go: any(3) == any(3), struct values, etc.).
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker)) continue;
					for (const idx of [0, 1]) {
						this.pushInstruction({ op: "local.get", index: idx });
						this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					}
					this.pushInstruction("i32.and");
					this.pushInstruction({ op: "if", blockType: "void" });
					const f1 = this.allocLocal(null, box.wType);
					const f2 = this.allocLocal(null, box.wType);
					for (const [src, dst] of [
						[0, f1],
						[1, f2],
					]) {
						this.pushInstruction({ op: "local.get", index: src });
						this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
						this.pushInstruction({
							op: "struct.get",
							typeIndex: box.typeIndex,
							fieldIndex: 0,
						});
						this.pushInstruction({ op: "local.set", index: dst });
					}
					this.emitKeyEq(f1, f2, box.goType);
					this.pushInstruction("return");
					this.pushInstruction("end");
				}

				// Arrays compare element by element.
				for (const a of [...this.mod.arrayTypes.values()]) {
					if (!isUnhashableGoType(a.elemGoType, this.mod.checker))
						this._emitAnyArrayEqArm(a);
				}

				// Strings
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCmpImportIndex("=="),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Heap reference equality
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction("ref.eq");
				this.pushInstruction("return");
				this.pushInstruction("end");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				return;
			}
			case "any_ref": {
				// A tagged slice is a fresh header on each conversion to an `any`:
				// its backing array is the identity every copy shares.
				for (const info of this.mod.taggedSliceTypes.values()) {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex: info.typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.cast", typeIndex: info.typeIndex });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: info.typeIndex,
						fieldIndex: 0,
					});
					this.pushInstruction("return");
					this.pushInstruction("end");
				}
				// A boxed defined map or func value: the reference inside the box.
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (
						!isMapType(box.goType, this.mod.checker) &&
						!isFuncType(box.goType, this.mod.checker)
					)
						continue;
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: box.typeIndex,
						fieldIndex: 0,
					});
					this.pushInstruction("return");
					this.pushInstruction("end");
				}
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("return");
				return;
			}
			case "any_hash": {
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Check unhashable types.  `goType` names the dynamic type in the
				// panic, as Go does (`main.S`, `main.L`, `func()`).
				const checkUnhashable = (typeIndex, goType) => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					this.emitPanic(
						goType
							? `runtime error: hash of unhashable type ${goTypeName(goType)}`
							: "runtime error: hash of unhashable type",
					);
					this.pushInstruction("end");
				};
				// A slice type first built from source syntax (a `TypeName`) names
				// its element as written.
				const spelled = (t) =>
					t?.kind === "TypeName" ? { kind: "basic", name: t.name } : t;
				// Tagged slices (a defined slice type in an interface) are subtypes
				// of the plain slice type, so they are tested first.
				for (const info of this.mod.taggedSliceTypes.values())
					checkUnhashable(info.typeIndex, info.goType);
				for (const sliceInfo of this.mod.sliceTypes.values())
					checkUnhashable(sliceInfo.typeIndex, {
						kind: "slice",
						elem: spelled(sliceInfo.elemGoType),
					});
				for (const mapInfo of this.mod.mapTypes.values())
					checkUnhashable(mapInfo.typeIndex, {
						kind: "map",
						key: mapInfo.keyGoType,
						value: mapInfo.valGoType,
					});
				for (const closureInfo of this.mod.closureTypes.values())
					checkUnhashable(closureInfo.typeIndex, {
						kind: "func",
						params: closureInfo.sig.params,
						returns: closureInfo.sig.returns,
					});
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker))
						checkUnhashable(box.typeIndex, box.goType);
				}
				for (const arrInfo of this.mod.arrayTypes.values()) {
					if (isUnhashableGoType(arrInfo.elemGoType, this.mod.checker))
						checkUnhashable(arrInfo.typeIndex);
				}

				// Check boxed values (scalars, struct values)
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker)) continue;
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					const valLoc = this.allocLocal(null, box.wType);
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: box.typeIndex,
						fieldIndex: 0,
					});
					this.pushInstruction({ op: "local.set", index: valLoc });
					this.pushInstruction({ op: "i32.const", value: box.typeIndex });
					this.pushInstruction({ op: "i32.const", value: 31 });
					this.pushInstruction("i32.mul");
					this.emitKeyHash(valLoc, box.goType);
					this.pushInstruction("i32.add");
					this.pushInstruction("return");
					this.pushInstruction("end");
				}

				// Arrays hash element by element.
				for (const a of [...this.mod.arrayTypes.values()]) {
					if (!isUnhashableGoType(a.elemGoType, this.mod.checker))
						this._emitAnyArrayHashArm(a);
				}

				// Check string
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringHashImportIndex(),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				return;
			}
			case "ta_fail":
				this._emitTypeAssertFail();
				return;
			case "panic_text":
				this._emitPanicText();
				return;
			case "panic_nil_text":
			case "panic_nil_type_name":
				this._pushStringConst(
					fn._isRuntimeHelper === "panic_nil_text"
						? PANIC_NIL_TEXT
						: PANIC_NIL_TYPE_NAME,
				);
				this.pushInstruction("return");
				return;
			case "error_msg":
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: errInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction("return");
				return;
			case "mk_error":
				// nil message (strconv success) → nil error
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("any.convert_extern");
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction("return");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: errInfo.typeIndex,
				});
				this.pushInstruction("return");
				return;
			case "error_str":
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({
					op: "i32.const",
					value: this.mod.internString("<nil>"),
				});
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringImportIndex(),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__dispatch_error_Error"),
				});
				this.pushInstruction("return");
				return;
			default:
				throw new Error(`Unknown runtime helper: ${fn._isRuntimeHelper}`);
		}
	}
}
