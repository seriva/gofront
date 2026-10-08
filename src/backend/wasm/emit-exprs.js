// src/backend/wasm/emit-exprs.js
// FunctionEmitter mixin: expression emission (literals, operators, indexing, conversions).

import {
	getMapKeyValTypes,
	isAnyType,
	isArrayType,
	isFuncType,
	isMapType,
	isPointerToStruct,
	isSigned,
	isSliceType,
	isStringType,
	isStructType,
	toWasmType,
} from "./types.js";

export class ExprsEmitter {
	emitExpr(expr, targetWasmType = null) {
		if (!expr) return;

		if (targetWasmType === "anyref") {
			if (
				(expr.kind === "Ident" && expr.name === "nil") ||
				(expr.kind === "BasicLit" && expr.litKind === "NIL")
			) {
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				return;
			}

			const goType = this._resolveExprGoType(expr);
			if (isAnyType(goType, this.mod.checker)) {
				this._emitRawExpr(expr, "anyref");
				return;
			}

			if (
				isStringType(goType, this.mod.checker) ||
				(expr.kind === "BasicLit" && expr.litKind === "STRING")
			) {
				this._emitRawExpr(expr, "externref");
				this.pushInstruction("any.convert_extern");
				return;
			}

			// `*T` in an interface is the struct ref itself (no allocation: the
			// hot Go pattern `var c Collider = &tm`).  A struct *value* is a
			// cloned ref wrapped in a one-field box so T and *T stay distinct
			// for type switches and assertions.
			if (isPointerToStruct(goType, this.mod.checker, this.mod)) {
				this._emitRawExpr(expr, this.toWasmType(goType));
				return;
			}
			if (isStructType(goType, this.mod.checker, this.mod)) {
				const structWType = this.toWasmType(goType);
				this._emitRawExpr(expr, structWType);
				const isFresh =
					expr.kind === "CompositeLit" ||
					(expr.kind === "UnaryExpr" && expr.op === "*");
				if (!isFresh) {
					const sInfo =
						this._resolveStructInfo(expr) ??
						this.mod.getStructType(goType?.name);
					if (sInfo) {
						this.emitCloneStruct(sInfo, structWType);
					}
				}
				const box = this.mod.getBoxType(goType);
				this.pushInstruction({ op: "struct.new", typeIndex: box.typeIndex });
				return;
			}

			if (
				isSliceType(goType, this.mod.checker) ||
				isArrayType(goType, this.mod.checker) ||
				isFuncType(goType, this.mod.checker) ||
				isMapType(goType, this.mod.checker)
			) {
				const refWType = this.toWasmType(goType);
				this._emitRawExpr(expr, refWType);
				return;
			}

			// Scalar type -> box into struct
			const scalarType = goType ?? { kind: "basic", name: "int" };
			const box = this.mod.getBoxType(scalarType);
			this._emitRawExpr(expr, box.wType);
			this.pushInstruction({ op: "struct.new", typeIndex: box.typeIndex });
			return;
		}

		this._emitRawExpr(expr, targetWasmType);
	}

	_resolveExprGoType(expr) {
		if (expr._type) return expr._type;
		if (expr.kind === "BasicLit") {
			switch (expr.litKind) {
				case "INT":
					return { kind: "basic", name: "int" };
				case "FLOAT":
					return { kind: "basic", name: "float64" };
				case "STRING":
					return { kind: "basic", name: "string" };
				case "BOOL":
					return { kind: "basic", name: "bool" };
				case "NIL":
					return { kind: "nil", name: "nil" };
			}
		}
		if (expr.kind === "Ident") {
			const local = this.resolveLocal(expr.name);
			if (local) return local.goType;
			if (this.cachedGlobals.has(expr.name)) {
				return this.cachedGlobals.get(expr.name).globalInfo.goType;
			}
			const global = this.mod.resolveGlobal(expr.name);
			if (global) return global.goType;
		}
		return null;
	}

	_emitRawExpr(expr, targetWasmType = null) {
		switch (expr.kind) {
			case "BasicLit":
				this.emitBasicLit(expr, targetWasmType);
				break;

			case "Ident":
				this.emitIdent(expr, targetWasmType);
				break;

			case "UnaryExpr":
				this.emitUnaryExpr(expr, targetWasmType);
				break;

			case "BinaryExpr":
				this.emitBinaryExpr(expr, targetWasmType);
				break;

			case "CallExpr":
				this.emitCallExpr(expr, targetWasmType);
				break;

			case "TypeConversion":
				this.emitTypeConversion(expr);
				break;

			case "CompositeLit":
				this.emitCompositeLit(expr);
				break;

			case "SelectorExpr": {
				const deq = this._dequalify(expr);
				if (deq) this.emitIdent(deq, targetWasmType);
				else if (this._isMathConst(expr))
					this.emitMathConst(expr.field, targetWasmType);
				else this.emitSelectorExpr(expr);
				break;
			}

			case "IndexExpr":
				this.emitIndexExpr(expr, targetWasmType);
				break;

			case "SliceExpr":
				this.emitSliceExpr(expr);
				break;

			case "ParenExpr":
				this.emitExpr(expr.expr, targetWasmType);
				break;

			case "FuncLit":
				this.emitFuncLit(expr, targetWasmType);
				break;

			case "TypeAssertExpr": {
				const targetGoType = expr._type ?? expr.type;
				const targetWType = targetWasmType ?? this.toWasmType(targetGoType);
				const anyTmp = this.acquireTemp("anyref");
				this.emitExpr(expr.expr, "anyref");
				this.pushInstruction({ op: "local.set", index: anyTmp });

				this.pushInstruction({ op: "local.get", index: anyTmp });
				this._emitTypeTest(targetGoType);
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("interface conversion: type assertion failed");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: anyTmp });
				this._emitTypeCast(targetGoType, targetWType);
				this.releaseTemp(anyTmp, "anyref");
				break;
			}

			default:
				throw new Error(`Unsupported expression kind: ${expr.kind}`);
		}
	}

	emitFuncLit(funcLit) {
		const liftedFn = funcLit._liftedFn;
		const globalFuncIdx = liftedFn._globalFuncIndex;
		const closureInfo = this.mod.getClosureType(funcLit._type ?? funcLit);

		// 1. Function reference
		this.pushInstruction({ op: "ref.func", funcIndex: globalFuncIdx });

		// 2. Environment reference
		const capturedNames = Array.from(
			this.captureAnalysis?.capturesByClosure?.get(funcLit) ?? [],
		).sort();

		if (capturedNames.length === 0) {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		} else {
			const envFields = [];
			for (const name of capturedNames) {
				const isBoxed = this.mutatedCaptures.has(name);
				const goType = this._findCapturedVarGoType(name);
				if (isBoxed) {
					const boxInfo = this.mod.getBoxType(goType);
					envFields.push({
						name,
						goType,
						isBoxed: true,
						boxInfo,
						wType: {
							kind: "ref",
							nullable: true,
							typeIndex: boxInfo.typeIndex,
						},
					});
				} else {
					const wType = this.toWasmType(goType);
					envFields.push({
						name,
						goType,
						isBoxed: false,
						boxInfo: null,
						wType,
					});
				}
			}

			const envInfo = this.mod.getEnvType(envFields);

			for (const field of envFields) {
				const local = this.resolveLocal(field.name);
				if (!local) {
					throw new Error(
						`Captured variable '${field.name}' not found in locals`,
					);
				}
				this.pushInstruction({ op: "local.get", index: local.index });
			}

			this.pushInstruction({
				op: "struct.new",
				typeIndex: envInfo.typeIndex,
			});
		}

		// 3. Closure struct
		this.pushInstruction({
			op: "struct.new",
			typeIndex: closureInfo.typeIndex,
		});
	}

	emitCompositeLit(lit) {
		const litType = lit._type ?? lit.typeExpr?._type ?? lit.typeExpr;
		if (isMapType(litType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(litType, this.mod.checker);
			const mapInfo = this.mod.getMapType(keyType, valType);
			const count = lit.elems?.length ?? 0;
			this.pushInstruction({ op: "i32.const", value: count });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.makeFuncName),
			});
			if (count > 0) {
				const mTmp = this.acquireTemp(mapInfo.wType);
				this.pushInstruction({ op: "local.set", index: mTmp });
				for (const elem of lit.elems) {
					this.pushInstruction({ op: "local.get", index: mTmp });
					this.emitExpr(elem.key, mapInfo.keyWType);
					const isValStruct =
						isStructType(valType, this.mod.checker, this.mod) &&
						!isPointerToStruct(valType, this.mod.checker, this.mod);
					const isFresh =
						elem.value.kind === "CompositeLit" ||
						(elem.value.kind === "UnaryExpr" && elem.value.op === "*");
					this.emitExpr(elem.value, mapInfo.valWType);
					if (isValStruct && !isFresh) {
						const sInfo =
							this._resolveStructInfo(elem.value) ??
							this._resolveStructInfo({ _type: valType });
						if (sInfo) {
							this.emitCloneStruct(sInfo, mapInfo.valWType);
						}
					}
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
					});
				}
				this.pushInstruction({ op: "local.get", index: mTmp });
				this.releaseTemp(mTmp, mapInfo.wType);
			}
			return;
		}

		if (isSliceType(litType, this.mod.checker)) {
			const elemType = litType.elem;
			const sliceInfo = this.mod.getSliceType(elemType);
			const count = lit.elems?.length ?? 0;
			if (count === 0) {
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: sliceInfo.arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "i32.const", value: 0 }); // offset
				this.pushInstruction({ op: "i32.const", value: 0 }); // len
				this.pushInstruction({ op: "i32.const", value: 0 }); // cap
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				return;
			}
			for (const elem of lit.elems) {
				const isValStruct =
					isStructType(elem._type, this.mod.checker, this.mod) &&
					!isPointerToStruct(elem._type, this.mod.checker, this.mod);
				const isFresh =
					elem.kind === "CompositeLit" ||
					(elem.kind === "UnaryExpr" && elem.op === "*");
				this.emitExpr(elem, sliceInfo.elemWType);
				if (isValStruct && !isFresh) {
					const sInfo = this._resolveStructInfo(elem);
					if (sInfo) {
						this.emitCloneStruct(sInfo, sliceInfo.elemWType);
					}
				}
			}
			this.pushInstruction({
				op: "array.new_fixed",
				typeIndex: sliceInfo.arrInfo.typeIndex,
				size: count,
			});
			this.pushInstruction({ op: "i32.const", value: 0 }); // offset
			this.pushInstruction({ op: "i32.const", value: count }); // len
			this.pushInstruction({ op: "i32.const", value: count }); // cap
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			return;
		}

		if (isArrayType(litType, this.mod.checker)) {
			const elemType = litType.elem;
			const arrInfo = this.mod.getArrayType(elemType);
			const count = lit.elems?.length ?? 0;
			const targetSize = this._getArraySize(litType, count);
			for (const elem of lit.elems ?? []) {
				const isValStruct =
					isStructType(elem._type, this.mod.checker, this.mod) &&
					!isPointerToStruct(elem._type, this.mod.checker, this.mod);
				const isFresh =
					elem.kind === "CompositeLit" ||
					(elem.kind === "UnaryExpr" && elem.op === "*");
				this.emitExpr(elem, arrInfo.elemWType);
				if (isValStruct && !isFresh) {
					const sInfo = this._resolveStructInfo(elem);
					if (sInfo) {
						this.emitCloneStruct(sInfo, arrInfo.elemWType);
					}
				}
			}
			for (let i = count; i < targetSize; i++) {
				this.emitZeroValue(elemType, arrInfo.elemWType);
			}
			this.pushInstruction({
				op: "array.new_fixed",
				typeIndex: arrInfo.typeIndex,
				size: targetSize,
			});
			return;
		}

		const typeName =
			lit.typeExpr?.name ??
			(litType?.kind === "named" ? litType.name : litType?.name);
		const structInfo = this.mod.getStructType(typeName);
		if (!structInfo) {
			throw new Error(`Unknown struct in CompositeLit: ${typeName}`);
		}

		const fields = structInfo.fields;
		const map = new Map();
		let isKeyed = false;

		for (const elem of lit.elems ?? []) {
			if (elem.kind === "KeyValueExpr") {
				isKeyed = true;
				map.set(elem.key.name, elem.value);
			}
		}

		for (let i = 0; i < fields.length; i++) {
			const f = fields[i];
			if (isKeyed) {
				if (map.has(f.name)) {
					this.emitExpr(map.get(f.name), f.wType);
				} else {
					this.emitZeroValue(f.goType, f.wType);
				}
			} else {
				if (i < (lit.elems?.length ?? 0)) {
					this.emitExpr(lit.elems[i], f.wType);
				} else {
					this.emitZeroValue(f.goType, f.wType);
				}
			}
		}

		this.pushInstruction({
			op: "struct.new",
			typeIndex: structInfo.typeIndex,
		});
	}

	emitSelectorExpr(expr) {
		const structInfo = this._resolveStructInfo(expr.expr);
		if (!structInfo) {
			throw new Error(`Cannot resolve struct for selector: ${expr.field}`);
		}
		const path = this._resolveFieldPath(structInfo, expr.field);
		if (!path) {
			throw new Error(
				`Unknown field '${expr.field}' on struct '${structInfo.name}'`,
			);
		}

		const baseWType = this.toWasmType(expr.expr._type);
		this.emitExpr(expr.expr, baseWType);

		for (let i = 0; i < path.length; i++) {
			const step = path[i];
			this.pushInstruction({
				op: "struct.get",
				typeIndex: step.structInfo.typeIndex,
				fieldIndex: step.fieldIndex,
			});
		}
	}

	emitIndexExpr(expr, targetWasmType = null) {
		const baseNode = expr.expr;
		const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);

		if (isMapType(baseType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(
				baseType,
				this.mod.checker,
			);
			const mapInfo = this.mod.getMapType(keyType, valType);
			this.emitExpr(baseNode, mapInfo.wType);
			this.emitExpr(expr.index, mapInfo.keyWType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.getFuncName),
			});
			return;
		}

		const isSlice = isSliceType(baseType, this.mod.checker);
		const isArr = isArrayType(baseType, this.mod.checker);
		const isPtrToArr =
			baseType?.kind === "pointer" &&
			isArrayType(baseType.base, this.mod.checker);

		const isStr = isStringType(baseType, this.mod.checker);

		if (isStr) {
			const strTmp = this.acquireTemp("externref");
			this.emitExpr(baseNode, "externref");
			this.pushInstruction({ op: "local.tee", index: strTmp });

			this._emitCheckedIndex(expr.index, () => {
				this.pushInstruction({ op: "local.get", index: strTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringLenImportIndex(),
				});
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringGetImportIndex(),
			});

			this.releaseTemp(strTmp, "externref");

			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}

		if (!isSlice && !isArr && !isPtrToArr) {
			throw new Error(
				`Unsupported IndexExpr on type: ${JSON.stringify(baseType)}`,
			);
		}

		const elemGoType = isSlice
			? baseType.elem
			: isPtrToArr
				? baseType.base.elem
				: baseType.elem;
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

		this._emitElemAddr(baseNode, expr.index, sliceInfo, arrInfo);
		this.pushInstruction({
			op: "array.get",
			typeIndex: arrInfo.typeIndex,
		});
	}

	emitSliceExpr(expr) {
		const baseNode = expr.expr;
		const baseType = baseNode._type;
		const isSlice = isSliceType(baseType, this.mod.checker);
		const isArr = isArrayType(baseType, this.mod.checker);
		const isPtrToArr =
			baseType?.kind === "pointer" &&
			isArrayType(baseType.base, this.mod.checker);

		const isStr = isStringType(baseType, this.mod.checker);

		if (isStr) {
			const strTmp = this.acquireTemp("externref");
			this.emitExpr(baseNode, "externref");
			this.pushInstruction({ op: "local.set", index: strTmp });

			const srcLenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: srcLenTmp });

			const lowTmp = this.acquireTemp("i32");
			const highTmp = this.acquireTemp("i32");

			if (expr.low) {
				this._emitIndexExprToI32(expr.low, lowTmp);
			} else {
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: lowTmp });
			}

			if (expr.high) {
				this._emitIndexExprToI32(expr.high, highTmp);
			} else {
				this.pushInstruction({ op: "local.get", index: srcLenTmp });
				this.pushInstruction({ op: "local.set", index: highTmp });
			}

			// Bounds check: 0 <= low <= high <= srcLenTmp
			this.pushInstruction({ op: "local.get", index: lowTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "local.get", index: highTmp });
			this.pushInstruction({ op: "local.get", index: lowTmp });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.get", index: highTmp });
			this.pushInstruction({ op: "local.get", index: srcLenTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction("i32.or");

			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
			});
			this.pushInstruction("unreachable");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({ op: "local.get", index: lowTmp });
			this.pushInstruction({ op: "local.get", index: highTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringSliceImportIndex(),
			});

			this.releaseTemp(highTmp, "i32");
			this.releaseTemp(lowTmp, "i32");
			this.releaseTemp(srcLenTmp, "i32");
			this.releaseTemp(strTmp, "externref");
			return;
		}

		if (!isSlice && !isArr && !isPtrToArr) {
			throw new Error(
				`Unsupported SliceExpr on type: ${JSON.stringify(baseType)}`,
			);
		}

		const elemGoType = isSlice
			? baseType.elem
			: isPtrToArr
				? baseType.base.elem
				: baseType.elem;
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = this.mod.getSliceType(elemGoType);

		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const srcOffTmp = this.acquireTemp("i32");
		const srcLenTmp = this.acquireTemp("i32");
		const srcCapTmp = this.acquireTemp("i32");

		if (isSlice) {
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const sliceTmp = this.acquireTemp(sliceWType);
			this.emitExpr(baseNode, sliceWType);
			this.pushInstruction({ op: "local.set", index: sliceTmp });

			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: srcLenTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 3,
			});
			this.pushInstruction({ op: "local.set", index: srcCapTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.set", index: srcOffTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			this.emitExpr(baseNode, arrWType);
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("array.len");
			this.pushInstruction({ op: "local.tee", index: srcLenTmp });
			this.pushInstruction({ op: "local.set", index: srcCapTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: srcOffTmp });
		}

		const lowTmp = this.acquireTemp("i32");
		if (expr.low) {
			this._emitIndexExprToI32(expr.low, lowTmp);
		} else {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: lowTmp });
		}

		const highTmp = this.acquireTemp("i32");
		if (expr.high) {
			this._emitIndexExprToI32(expr.high, highTmp);
		} else {
			this.pushInstruction({ op: "local.get", index: srcLenTmp });
			this.pushInstruction({ op: "local.set", index: highTmp });
		}

		const maxTmp = this.acquireTemp("i32");
		if (expr.max) {
			this._emitIndexExprToI32(expr.max, maxTmp);
		} else {
			this.pushInstruction({ op: "local.get", index: srcCapTmp });
			this.pushInstruction({ op: "local.set", index: maxTmp });
		}

		// Bounds check: 0 <= low <= high <= max <= srcCap
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction({ op: "local.get", index: highTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "local.get", index: highTmp });
		this.pushInstruction({ op: "local.get", index: maxTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: maxTmp });
		this.pushInstruction({ op: "local.get", index: srcCapTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction("i32.or");

		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction("i32.add");

		this.pushInstruction({ op: "local.get", index: highTmp });
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction("i32.sub");

		this.pushInstruction({ op: "local.get", index: maxTmp });
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction("i32.sub");

		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(maxTmp, "i32");
		this.releaseTemp(highTmp, "i32");
		this.releaseTemp(lowTmp, "i32");
		this.releaseTemp(srcCapTmp, "i32");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
	}

	_emitArrayCopy(arrInfo, elemGoType) {
		const isValStruct =
			isStructType(elemGoType, this.mod.checker, this.mod) &&
			!isPointerToStruct(elemGoType, this.mod.checker, this.mod);

		if (!isValStruct) {
			this.pushInstruction({
				op: "array.copy",
				typeIndexDst: arrInfo.typeIndex,
				typeIndexSrc: arrInfo.typeIndex,
			});
			return;
		}

		const sInfo =
			this._resolveStructInfo({ _type: elemGoType }) ??
			this.mod.getStructType(
				elemGoType?.name ??
					(elemGoType?.kind === "named" ? elemGoType.name : null),
			);

		const lenTmp = this.acquireTemp("i32");
		const srcOffTmp = this.acquireTemp("i32");
		const srcArrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const dstOffTmp = this.acquireTemp("i32");
		const dstArrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.set", index: lenTmp });
		this.pushInstruction({ op: "local.set", index: srcOffTmp });
		this.pushInstruction({ op: "local.set", index: srcArrTmp });
		this.pushInstruction({ op: "local.set", index: dstOffTmp });
		this.pushInstruction({ op: "local.set", index: dstArrTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: dstArrTmp });
		this.pushInstruction({ op: "local.get", index: dstOffTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");

		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		if (sInfo) {
			this.emitCloneStruct(sInfo, arrInfo.elemWType);
		}

		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(dstArrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(dstOffTmp, "i32");
		this.releaseTemp(srcArrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
	}

	// True when `expr` can be evaluated as an i32 without losing information:
	// i32-backed locals (induction variables, narrow ints), small literals,
	// `len`/`cap`, +/-/* over such operands, or any expression whose Go type
	// already lowers to i32. Everything else goes through the i64 path.
	_isI32IndexExpr(expr) {
		if (!expr) return false;
		switch (expr.kind) {
			case "Ident": {
				const local = this.resolveLocal(expr.name);
				if (local) return local.type === "i32";
				break;
			}
			case "BasicLit":
				if (expr.litKind === "INT") {
					const v = BigInt(expr.value);
					return v >= 0n && v < 2147483648n;
				}
				break;
			case "ParenExpr":
				return this._isI32IndexExpr(expr.expr);
			case "BinaryExpr":
				if (
					(expr.op === "+" || expr.op === "-" || expr.op === "*") &&
					this._isI32IndexExpr(expr.left) &&
					this._isI32IndexExpr(expr.right)
				) {
					return true;
				}
				break;
			case "CallExpr":
				if (
					expr.func?.kind === "Ident" &&
					(expr.func.name === "len" || expr.func.name === "cap")
				) {
					return true;
				}
				break;
		}
		return this.toWasmType(expr._type) === "i32";
	}

	_emitBoundsBranch() {
		const oobDepth = this.resolveBranchDepthToOob();
		if (oobDepth !== null) {
			this.pushInstruction({ op: "br_if", depth: oobDepth });
		} else {
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getBoundsPanicFuncIndex(),
			});
			this.pushInstruction("unreachable");
			this.pushInstruction("end");
		}
	}

	// Pushes the bounds-checked i32 index onto the stack. `emitLen` must push
	// the i32 length. Constant and plain-local indexes are re-emitted instead
	// of spilled; everything else goes through one temp.
	_emitCheckedIndex(indexNode, emitLen) {
		const simple =
			(indexNode.kind === "BasicLit" && indexNode.litKind === "INT") ||
			(indexNode.kind === "Ident" && this.resolveLocal(indexNode.name));
		if (this._isI32IndexExpr(indexNode)) {
			this.emitExpr(indexNode, "i32");
			let tmp = null;
			if (simple) {
				this.emitExpr(indexNode, "i32");
			} else {
				tmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.tee", index: tmp });
				this.pushInstruction({ op: "local.get", index: tmp });
			}
			emitLen();
			this.pushInstruction("i32.ge_u");
			this._emitBoundsBranch();
			if (tmp !== null) this.releaseTemp(tmp, "i32");
			return;
		}

		const idx64 = this.acquireTemp("i64");
		this.emitExpr(indexNode, "i64");
		this.pushInstruction({ op: "local.tee", index: idx64 });
		emitLen();
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.ge_u");
		this._emitBoundsBranch();
		this.pushInstruction({ op: "local.get", index: idx64 });
		this.pushInstruction("i32.wrap_i64");
		this.releaseTemp(idx64, "i64");
	}

	// Leaves `[arr, off+idx]` on the stack for `base[idx]` over a slice or
	// (pointer to) array, with the bounds check already emitted.
	_emitElemAddr(baseNode, indexNode, sliceInfo, arrInfo) {
		if (sliceInfo) {
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const sliceTmp = this.acquireTemp(sliceWType);
			this.emitExpr(baseNode, sliceWType);
			this.pushInstruction({ op: "local.tee", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this._emitCheckedIndex(indexNode, () => {
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
			});
			this.pushInstruction("i32.add");
			this.releaseTemp(sliceTmp, sliceWType);
			return;
		}

		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const arrTmp = this.acquireTemp(arrWType);
		this.emitExpr(baseNode, arrWType);
		this.pushInstruction({ op: "local.tee", index: arrTmp });
		this._emitCheckedIndex(indexNode, () => {
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("array.len");
		});
		this.releaseTemp(arrTmp, arrWType);
	}

	_emitIndexExprToI32(node, tmp32) {
		if (this._isI32IndexExpr(node)) {
			this.emitExpr(node, "i32");
			this.pushInstruction({ op: "local.set", index: tmp32 });
			return;
		}
		const wType = this.toWasmType(node._type);
		if (wType === "i64") {
			this.emitExpr(node, "i64");
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction({ op: "local.set", index: tmp32 });
		} else {
			this.emitExpr(node, "i32");
			this.pushInstruction({ op: "local.set", index: tmp32 });
		}
	}

	emitBasicLit(lit, targetWasmType) {
		const wType =
			targetWasmType ??
			toWasmType(lit._type, this.mod.checker) ??
			(lit.litKind === "INT" ? "i64" : lit.litKind === "FLOAT" ? "f64" : "i32");

		if (lit.litKind === "INT") {
			const n = Number(lit.value);
			if (wType === "i32") {
				this.pushInstruction({ op: "i32.const", value: n | 0 });
			} else if (wType === "f64" || wType === "f32") {
				// Untyped integer constant in a float context (`x * 2`).
				this.pushInstruction({ op: `${wType}.const`, value: n });
			} else {
				this.pushInstruction({ op: "i64.const", value: BigInt(lit.value) });
			}
			return;
		}

		if (lit.litKind === "FLOAT") {
			const n = Number(lit.value);
			if (wType === "f32") {
				this.pushInstruction({ op: "f32.const", value: n });
			} else {
				this.pushInstruction({ op: "f64.const", value: n });
			}
			return;
		}

		if (lit.litKind === "BOOL") {
			this.pushInstruction({
				op: "i32.const",
				value: lit.value === "true" ? 1 : 0,
			});
			return;
		}

		if (lit.litKind === "NIL") {
			const effectiveType = targetWasmType ?? this.toWasmType(lit._type);
			if (
				(lit._type && isSliceType(lit._type, this.mod.checker)) ||
				(effectiveType &&
					typeof effectiveType === "object" &&
					typeof effectiveType.typeIndex === "number" &&
					this.mod.getSliceTypeByIndex(effectiveType.typeIndex))
			) {
				const elemType = lit._type ? this._getSliceElemType(lit._type) : null;
				const sliceInfo = elemType
					? this.mod.getSliceType(elemType)
					: this.mod.getSliceTypeByIndex(effectiveType.typeIndex);
				if (sliceInfo) {
					this.pushInstruction({
						op: "global.get",
						index: sliceInfo.emptyGlobalIndex,
					});
					return;
				}
			}
			const heapType =
				typeof effectiveType === "object" && effectiveType !== null
					? (effectiveType.typeIndex ?? effectiveType.heapType ?? "any")
					: "any";
			this.pushInstruction({ op: "ref.null", heapType });
			return;
		}

		if (lit.litKind === "STRING") {
			// Intern string in module string table
			const strVal = String(lit.value ?? "");
			const strIdx = this.mod.internString(strVal);
			const funcIdx = this.mod.getStringImportIndex();
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			return;
		}
	}

	emitIdent(ident, targetWasmType = null) {
		if (ident.name === "true") {
			this.pushInstruction({ op: "i32.const", value: 1 });
			return;
		}
		if (ident.name === "false") {
			this.pushInstruction({ op: "i32.const", value: 0 });
			return;
		}
		if (ident.name === "nil") {
			const effectiveType = targetWasmType ?? this.toWasmType(ident._type);
			if (
				(ident._type && isSliceType(ident._type, this.mod.checker)) ||
				(effectiveType &&
					typeof effectiveType === "object" &&
					typeof effectiveType.typeIndex === "number" &&
					this.mod.getSliceTypeByIndex(effectiveType.typeIndex))
			) {
				const elemType = ident._type
					? this._getSliceElemType(ident._type)
					: null;
				const sliceInfo = elemType
					? this.mod.getSliceType(elemType)
					: this.mod.getSliceTypeByIndex(effectiveType.typeIndex);
				if (sliceInfo) {
					this.pushInstruction({
						op: "global.get",
						index: sliceInfo.emptyGlobalIndex,
					});
					return;
				}
			}
			const heapType =
				typeof effectiveType === "object" && effectiveType !== null
					? (effectiveType.typeIndex ?? effectiveType.heapType ?? "any")
					: "any";
			this.pushInstruction({ op: "ref.null", heapType });
			return;
		}

		const localInfo = this.resolveLocal(ident.name);
		if (localInfo) {
			if (localInfo.isBoxed) {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: localInfo.boxInfo.typeIndex,
					fieldIndex: 0,
				});
			} else {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
			}
			if (localInfo.type === "i32" && targetWasmType === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			} else if (localInfo.type === "i64" && targetWasmType === "i32") {
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}

		if (this.cachedGlobals.has(ident.name)) {
			const cached = this.cachedGlobals.get(ident.name);
			this.pushInstruction({ op: "local.get", index: cached.index });
			if (cached.globalInfo.type === "i32" && targetWasmType === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			} else if (cached.globalInfo.type === "i64" && targetWasmType === "i32") {
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}

		const globalInfo = this.mod.resolveGlobal(ident.name);
		if (globalInfo) {
			this.pushInstruction({ op: "global.get", index: globalInfo.index });
			if (globalInfo.type === "i32" && targetWasmType === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			} else if (globalInfo.type === "i64" && targetWasmType === "i32") {
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}

		const constLit = this.mod.resolveConst(ident.name);
		if (constLit) {
			this.emitBasicLit(
				constLit,
				targetWasmType ?? this.toWasmType(ident._type),
			);
			return;
		}
		if (this.mod.isNonLiteralConst(ident.name)) {
			throw new Error(
				`constant '${ident.name}' has a non-literal value, which the wasm backend does not support yet (planned)`,
			);
		}

		const trampName = `_tramp$${ident.name}`;
		const trampFuncIdx = this.mod.resolveFuncIndex(trampName);
		if (trampFuncIdx !== null) {
			const targetFn = this.mod.topLevelFuncMap?.get(ident.name);
			const goType =
				ident._type ??
				(targetFn
					? {
							kind: "func",
							params: (targetFn.params ?? []).map((p) => p.type ?? p),
							returns: targetFn.returnType
								? targetFn.returnType.kind === "TupleType" ||
									targetFn.returnType.kind === "tuple"
									? targetFn.returnType.types
									: [targetFn.returnType]
								: [],
						}
					: null);
			const closureInfo = this.mod.getClosureType(goType);
			this.pushInstruction({ op: "ref.func", funcIndex: trampFuncIdx });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: closureInfo.typeIndex,
			});
			return;
		}

		throw new Error(`Unresolved identifier: ${ident.name}`);
	}

	emitUnaryExpr(expr, targetWasmType = null) {
		const { op, operand } = expr;

		// Optimize negative numeric literals directly
		if (op === "-" && operand.kind === "BasicLit") {
			if (operand.litKind === "INT" || operand.litKind === "FLOAT") {
				this.emitBasicLit(
					{ ...operand, value: `-${operand.value}` },
					targetWasmType,
				);
				return;
			}
		}

		const wType =
			targetWasmType ??
			toWasmType(expr._type, this.mod.checker) ??
			toWasmType(operand._type, this.mod.checker);

		switch (op) {
			case "+":
				this.emitExpr(operand, wType);
				break;

			case "-":
				if (wType === "i32") {
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.emitExpr(operand, wType);
					this.pushInstruction("i32.sub");
					this.emitNarrowIntWrap(operand._type);
				} else if (wType === "i64") {
					this.pushInstruction({ op: "i64.const", value: 0n });
					this.emitExpr(operand, wType);
					this.pushInstruction("i64.sub");
				} else if (wType === "f32") {
					this.emitExpr(operand, wType);
					this.pushInstruction("f32.neg");
				} else if (wType === "f64") {
					this.emitExpr(operand, wType);
					this.pushInstruction("f64.neg");
				}
				break;

			case "!":
				this.emitExpr(operand, "i32");
				this.pushInstruction("i32.eqz");
				break;

			case "^": // bitwise NOT
				this.emitExpr(operand, wType);
				if (wType === "i32") {
					this.pushInstruction({ op: "i32.const", value: -1 });
					this.pushInstruction("i32.xor");
					this.emitNarrowIntWrap(operand._type);
				} else if (wType === "i64") {
					this.pushInstruction({ op: "i64.const", value: -1n });
					this.pushInstruction("i64.xor");
				}
				break;

			case "&": {
				if (operand.kind === "CompositeLit") {
					this.emitExpr(operand);
					return;
				}
				const structInfo = this._resolveStructInfo(operand);
				if (structInfo) {
					this.emitExpr(operand);
					return;
				}
				const opWType = this.toWasmType(operand._type);
				const box = this.mod.getBoxType(operand._type);
				this.emitExpr(operand, opWType);
				this.pushInstruction({ op: "struct.new", typeIndex: box.typeIndex });
				return;
			}

			case "*": {
				const structInfo = this._resolveStructInfo(operand);
				if (structInfo) {
					const baseWType = this.toWasmType(operand._type);
					this.emitExpr(operand, baseWType);
					this.emitCloneStruct(structInfo, baseWType);
					return;
				}
				const box = this.mod.getBoxType(operand._type?.base ?? operand._type);
				const baseWType = {
					kind: "ref",
					nullable: true,
					typeIndex: box.typeIndex,
				};
				this.emitExpr(operand, baseWType);
				this.pushInstruction({
					op: "struct.get",
					typeIndex: box.typeIndex,
					fieldIndex: 0,
				});
				return;
			}

			default:
				throw new Error(`Unsupported unary operator: ${op}`);
		}
	}

	emitBinaryExpr(expr, targetWasmType = null) {
		const { op, left, right } = expr;

		// Short-circuiting logical operators
		if (op === "&&") {
			this.emitExpr(left, "i32");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.emitExpr(right, "i32");
			this.pushInstruction("else");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("end");
			return;
		}

		if (op === "||") {
			this.emitExpr(left, "i32");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("else");
			this.emitExpr(right, "i32");
			this.pushInstruction("end");
			return;
		}

		// Division & Modulo with zero-guard and overflow-guard
		if (op === "/" || op === "%") {
			this.emitDivRem(op, left, right, targetWasmType);
			return;
		}

		// Shifts with Go semantics
		if (op === "<<" || op === ">>") {
			this.emitShift(op, left, right, targetWasmType);
			return;
		}

		// Standard binary operators
		const isCmp =
			op === "==" ||
			op === "!=" ||
			op === "<" ||
			op === "<=" ||
			op === ">" ||
			op === ">=";

		const isNil = (n) =>
			(n.kind === "BasicLit" && n.litKind === "NIL") ||
			(n.kind === "Ident" && n.name === "nil");

		if ((op === "==" || op === "!=") && (isNil(left) || isNil(right))) {
			const nonNil = isNil(right) ? left : right;
			if (isSliceType(nonNil._type, this.mod.checker)) {
				const elemType = this._getSliceElemType(nonNil._type);
				const sliceInfo = this.mod.getSliceType(elemType);
				const sliceWType = {
					kind: "ref",
					nullable: true,
					typeIndex: sliceInfo.typeIndex,
				};
				this.emitExpr(nonNil, sliceWType);
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction("ref.is_null");
				if (op === "!=") {
					this.pushInstruction("i32.eqz");
				}
				return;
			}
			const nonNilWType = this.toWasmType(nonNil._type);
			this.emitExpr(nonNil, nonNilWType);
			this.pushInstruction("ref.is_null");
			if (op === "!=") {
				this.pushInstruction("i32.eqz");
			}
			return;
		}

		const leftType = left._type;
		const isLeftI32 = this._isI32IndexExpr(left);
		const isRightI32 = this._isI32IndexExpr(right);
		const leftGoType = left._type ?? this._resolveExprGoType(left);
		const isIntType =
			!leftGoType ||
			(leftGoType.kind === "basic" &&
				(leftGoType.name === "int" ||
					leftGoType.name === "untyped int" ||
					leftGoType.name === "int32" ||
					leftGoType.name === "uint32"));
		const cmpI32 = isIntType && isLeftI32 && isRightI32;

		const wType = isCmp
			? cmpI32
				? "i32"
				: this.toWasmType(leftType)
			: (targetWasmType ?? this.toWasmType(leftType));

		this.emitExpr(left, wType);
		this.emitExpr(right, wType);

		if (
			(op === "==" || op === "!=") &&
			isStructType(leftType, this.mod.checker, this.mod) &&
			!isPointerToStruct(leftType, this.mod.checker, this.mod)
		) {
			const sInfo =
				this._resolveStructInfo({ _type: leftType }) ??
				this.mod.getStructType(
					leftType?.name ?? (leftType?.kind === "named" ? leftType.name : null),
				);
			if (sInfo) {
				this._emitStructEq(sInfo);
				if (op === "!=") {
					this.pushInstruction("i32.eqz");
				}
				return;
			}
		}

		this.emitBinaryOp(op, wType, leftType);
	}

	_emitStructEq(structInfo) {
		const bTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
		const aTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bTmp });
		this.pushInstruction({ op: "local.set", index: aTmp });

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "block", blockType: "void" });

		for (let i = 0; i < structInfo.fields.length; i++) {
			const f = structInfo.fields[i];
			this.pushInstruction({ op: "local.get", index: aTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: i,
			});
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: i,
			});

			if (
				isStructType(f.goType, this.mod.checker, this.mod) &&
				!isPointerToStruct(f.goType, this.mod.checker, this.mod)
			) {
				const sInfo =
					this._resolveStructInfo({ _type: f.goType }) ??
					this.mod.getStructType(
						f.goType?.name ??
							(f.goType?.kind === "named" ? f.goType.name : null),
					);
				this._emitStructEq(sInfo);
			} else if (isStringType(f.goType, this.mod.checker)) {
				const cmpIdx = this.mod.getStringCmpImportIndex("==");
				this.pushInstruction({ op: "call", funcIndex: cmpIdx });
			} else if (
				f.wType === "anyref" ||
				(typeof f.wType === "object" && f.wType !== null)
			) {
				this.pushInstruction("ref.eq");
			} else {
				this.pushInstruction(`${f.wType}.eq`);
			}

			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: resTmp });
			this.pushInstruction({ op: "br", depth: 1 });
			this.pushInstruction("end");
		}
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(aTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
		this.releaseTemp(bTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
	}

	emitBinaryOp(op, wType, goType) {
		const signed = isSigned(goType);

		switch (op) {
			case "+":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const concatIdx = this.mod.getStringConcatImportIndex();
					this.pushInstruction({ op: "call", funcIndex: concatIdx });
					return;
				}
				this.pushInstruction(`${wType}.add`);
				this.emitNarrowIntWrap(goType);
				break;
			case "-":
				this.pushInstruction(`${wType}.sub`);
				this.emitNarrowIntWrap(goType);
				break;
			case "*":
				this.pushInstruction(`${wType}.mul`);
				this.emitNarrowIntWrap(goType);
				break;

			case "&":
				this.pushInstruction(`${wType}.and`);
				break;
			case "|":
				this.pushInstruction(`${wType}.or`);
				break;
			case "^":
				this.pushInstruction(`${wType}.xor`);
				break;
			case "&^": // AND NOT: a &^ b -> a & (~b)
				if (wType === "i32") {
					this.pushInstruction({ op: "i32.const", value: -1 });
					this.pushInstruction("i32.xor");
					this.pushInstruction("i32.and");
				} else if (wType === "i64") {
					this.pushInstruction({ op: "i64.const", value: -1n });
					this.pushInstruction("i64.xor");
					this.pushInstruction("i64.and");
				}
				break;

			// Comparisons
			case "==":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("==");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (
					wType === "anyref" ||
					(typeof wType === "object" && wType !== null)
				) {
					this.pushInstruction("ref.eq");
				} else {
					this.pushInstruction(`${wType}.eq`);
				}
				break;
			case "!=":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("!=");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (
					wType === "anyref" ||
					(typeof wType === "object" && wType !== null)
				) {
					this.pushInstruction("ref.eq");
					this.pushInstruction("i32.eqz");
				} else {
					this.pushInstruction(`${wType}.ne`);
				}
				break;
			case "<":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("<");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.lt`);
				} else {
					this.pushInstruction(`${wType}.lt_${signed ? "s" : "u"}`);
				}
				break;
			case "<=":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("<=");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.le`);
				} else {
					this.pushInstruction(`${wType}.le_${signed ? "s" : "u"}`);
				}
				break;
			case ">":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex(">");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.gt`);
				} else {
					this.pushInstruction(`${wType}.gt_${signed ? "s" : "u"}`);
				}
				break;
			case ">=":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex(">=");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.ge`);
				} else {
					this.pushInstruction(`${wType}.ge_${signed ? "s" : "u"}`);
				}
				break;

			default:
				throw new Error(`Unsupported binary operator: ${op}`);
		}
	}

	emitNarrowIntWrap(goType) {
		if (!goType) return;
		if (goType.kind === "TypeName" || goType.kind === "Ident") {
			return this.emitNarrowIntWrap({ kind: "basic", name: goType.name });
		}
		if (goType.kind === "named" && goType.underlying) {
			return this.emitNarrowIntWrap(goType.underlying);
		}
		if (goType.kind === "basic") {
			switch (goType.name) {
				case "int8":
					this.pushInstruction("i32.extend8_s");
					break;
				case "int16":
					this.pushInstruction("i32.extend16_s");
					break;
				case "uint8":
				case "byte":
					this.pushInstruction({ op: "i32.const", value: 0xff });
					this.pushInstruction("i32.and");
					break;
				case "uint16":
					this.pushInstruction({ op: "i32.const", value: 0xffff });
					this.pushInstruction("i32.and");
					break;
			}
		}
	}

	emitDivRem(op, left, right, targetWasmType = null) {
		const goType = left._type;
		const wType = targetWasmType ?? toWasmType(goType, this.mod.checker);

		if (wType === "f32" || wType === "f64") {
			this.emitExpr(left, wType);
			this.emitExpr(right, wType);
			this.pushInstruction(`${wType}.div`);
			return;
		}

		const signed = isSigned(goType);
		const tmpA = this.acquireTemp(wType);
		const tmpB = this.acquireTemp(wType);

		this.emitExpr(left, wType);
		this.pushInstruction({ op: "local.set", index: tmpA });

		this.emitExpr(right, wType);
		this.pushInstruction({ op: "local.set", index: tmpB });

		// Zero check
		this.pushInstruction({ op: "local.get", index: tmpB });
		this.pushInstruction(`${wType}.eqz`);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic("runtime error: integer divide by zero");
		this.pushInstruction("end");

		if (wType === "i32") {
			if (signed) {
				// MinInt32 / -1 wrap guard
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "i32.const", value: -2147483648 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction("i32.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "i32" });
				if (op === "/") {
					this.pushInstruction({ op: "i32.const", value: -2147483648 });
				} else {
					this.pushInstruction({ op: "i32.const", value: 0 });
				}
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i32.div_s" : "i32.rem_s");
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i32.div_u" : "i32.rem_u");
			}
			this.emitNarrowIntWrap(goType);
		} else if (wType === "i64") {
			if (signed) {
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({
					op: "i64.const",
					value: -9223372036854775808n,
				});
				this.pushInstruction("i64.eq");
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction({ op: "i64.const", value: -1n });
				this.pushInstruction("i64.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "i64" });
				if (op === "/") {
					this.pushInstruction({
						op: "i64.const",
						value: -9223372036854775808n,
					});
				} else {
					this.pushInstruction({ op: "i64.const", value: 0n });
				}
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i64.div_s" : "i64.rem_s");
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i64.div_u" : "i64.rem_u");
			}
		}

		this.releaseTemp(tmpB, wType);
		this.releaseTemp(tmpA, wType);
	}

	emitShift(op, left, right, targetWasmType = null) {
		const goType = left._type;
		const wType = targetWasmType ?? toWasmType(goType, this.mod.checker);
		const signed = isSigned(goType);
		const rightWType = toWasmType(right._type, this.mod.checker);

		const tmpVal = this.acquireTemp(wType);
		const tmpShift = this.acquireTemp(wType);

		this.emitExpr(left, wType);
		this.pushInstruction({ op: "local.set", index: tmpVal });

		this.emitExpr(right, rightWType);
		if (wType === "i64" && rightWType === "i32") {
			this.pushInstruction("i64.extend_i32_u");
		} else if (wType === "i32" && rightWType === "i64") {
			this.pushInstruction("i32.wrap_i64");
		}
		this.pushInstruction({ op: "local.set", index: tmpShift });

		if (wType === "i32") {
			this.pushInstruction({ op: "local.get", index: tmpShift });
			this.pushInstruction({ op: "i32.const", value: 32 });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "if", blockType: "i32" });

			if (op === ">>" && signed) {
				this.pushInstruction({ op: "local.get", index: tmpVal });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "i32.const", value: 0 });
			}

			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: tmpVal });
			this.pushInstruction({ op: "local.get", index: tmpShift });
			if (op === "<<") {
				this.pushInstruction("i32.shl");
			} else {
				this.pushInstruction(signed ? "i32.shr_s" : "i32.shr_u");
			}

			this.pushInstruction("end");
			this.emitNarrowIntWrap(goType);
		} else {
			this.pushInstruction({ op: "local.get", index: tmpShift });
			this.pushInstruction({ op: "i64.const", value: 64n });
			this.pushInstruction("i64.ge_u");
			this.pushInstruction({ op: "if", blockType: "i64" });

			if (op === ">>" && signed) {
				this.pushInstruction({ op: "local.get", index: tmpVal });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.lt_s");
				this.pushInstruction({ op: "if", blockType: "i64" });
				this.pushInstruction({ op: "i64.const", value: -1n });
				this.pushInstruction("else");
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "i64.const", value: 0n });
			}

			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: tmpVal });
			this.pushInstruction({ op: "local.get", index: tmpShift });
			if (op === "<<") {
				this.pushInstruction("i64.shl");
			} else {
				this.pushInstruction(signed ? "i64.shr_s" : "i64.shr_u");
			}

			this.pushInstruction("end");
		}

		this.releaseTemp(tmpShift, wType);
		this.releaseTemp(tmpVal, wType);
	}

	emitTypeConversion(conv) {
		const { targetType, expr } = conv;
		const fromType = expr._type;
		const fromWType = toWasmType(fromType, this.mod.checker);
		const toWType = toWasmType(targetType, this.mod.checker);

		this.emitExpr(expr, fromWType);

		if (fromWType === toWType) {
			this.emitNarrowIntWrap(targetType);
			return;
		}

		if (toWType === "externref") {
			if (fromWType === "i64") {
				this.pushInstruction("i32.wrap_i64");
			}
			const funcIdx = this.mod.getStringFromCodePointImportIndex();
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			return;
		}

		if (toWType === "anyref") {
			if (fromWType === "externref") {
				this.pushInstruction("any.convert_extern");
			}
			return;
		}

		if (fromWType === "i32" && toWType === "i64") {
			this.pushInstruction(
				isSigned(fromType) ? "i64.extend_i32_s" : "i64.extend_i32_u",
			);
		} else if (fromWType === "i64" && toWType === "i32") {
			this.pushInstruction("i32.wrap_i64");
			this.emitNarrowIntWrap(targetType);
		} else if (fromWType === "i32" && toWType === "f32") {
			this.pushInstruction(
				isSigned(fromType) ? "f32.convert_i32_s" : "f32.convert_i32_u",
			);
		} else if (fromWType === "i32" && toWType === "f64") {
			this.pushInstruction(
				isSigned(fromType) ? "f64.convert_i32_s" : "f64.convert_i32_u",
			);
		} else if (fromWType === "i64" && toWType === "f32") {
			this.pushInstruction(
				isSigned(fromType) ? "f32.convert_i64_s" : "f32.convert_i64_u",
			);
		} else if (fromWType === "i64" && toWType === "f64") {
			this.pushInstruction(
				isSigned(fromType) ? "f64.convert_i64_s" : "f64.convert_i64_u",
			);
		} else if (fromWType === "f32" && toWType === "f64") {
			this.pushInstruction("f64.promote_f32");
		} else if (fromWType === "f64" && toWType === "f32") {
			this.pushInstruction("f32.demote_f64");
		} else if (fromWType === "f64" && toWType === "i32") {
			this.pushInstruction(
				isSigned(targetType) ? "i32.trunc_sat_f64_s" : "i32.trunc_sat_f64_u",
			);
			this.emitNarrowIntWrap(targetType);
		} else if (fromWType === "f32" && toWType === "i32") {
			this.pushInstruction(
				isSigned(targetType) ? "i32.trunc_sat_f32_s" : "i32.trunc_sat_f32_u",
			);
			this.emitNarrowIntWrap(targetType);
		} else if (fromWType === "f64" && toWType === "i64") {
			this.pushInstruction(
				isSigned(targetType) ? "i64.trunc_sat_f64_s" : "i64.trunc_sat_f64_u",
			);
		} else if (fromWType === "f32" && toWType === "i64") {
			this.pushInstruction(
				isSigned(targetType) ? "i64.trunc_sat_f32_s" : "i64.trunc_sat_f32_u",
			);
		}
	}
}
