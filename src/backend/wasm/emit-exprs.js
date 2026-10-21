// src/backend/wasm/emit-exprs.js
// FunctionEmitter mixin: expression emission (literals, operators, indexing, conversions).

import { foldConstExpr } from "./const-fold.js";
import {
	getMapKeyValTypes,
	isAnyType,
	isArrayType,
	isComplex,
	isComplex64,
	isFuncType,
	isMapType,
	isPointerToStruct,
	isScalarType,
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
				this._emitBoxValue(this.mod.getIfaceBoxType(goType));
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
			const box = this.mod.getIfaceBoxType(scalarType);
			this._emitRawExpr(expr, box.wType);
			this._emitBoxValue(box);
			return;
		}

		this._emitRawExpr(expr, targetWasmType);
	}

	_emitBoxValue(box) {
		this.pushInstruction({
			op: "ref.null",
			heapType: box.tagTypeIndex,
		});
		this.pushInstruction({ op: "struct.new", typeIndex: box.typeIndex });
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
		if (expr.kind === "ImagLit") {
			return { kind: "untyped", base: "complex128" };
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
		if (expr.kind === "BinaryExpr" || expr.kind === "UnaryExpr") {
			const folded = foldConstExpr(expr, (name) =>
				this.mod.pkgConsts?.get(name),
			);
			if (folded) {
				folded._type = expr._type;
				this.emitBasicLit(folded, targetWasmType);
				return;
			}
		}

		switch (expr.kind) {
			case "BasicLit":
				this.emitBasicLit(expr, targetWasmType);
				break;

			case "ImagLit":
				this.emitImagLit(expr, targetWasmType);
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
				else if (this._isUtf8Const(expr))
					this.emitUtf8Const(expr.field, targetWasmType);
				else if (this._isStrconvConst(expr))
					this.emitStrconvConst(expr.field, targetWasmType);
				else if (this._isPathConst(expr))
					this.emitPathConst(expr.field, targetWasmType);
				else if (this._isIoConst(expr))
					this.emitIoConst(expr.field, targetWasmType);
				else if (this._isTimeConst(expr))
					this.emitTimeConst(expr.field, targetWasmType);
				else if (this._isExtendedPkgConst?.(expr))
					this.emitExtendedPkgConst(expr, targetWasmType);
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
			const envFields = this._buildEnvFields(capturedNames);
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
		if (
			litType?.kind === "simd" ||
			litType?.name === "simd.F32x4" ||
			litType?.underlying?.kind === "simd" ||
			(lit.typeExpr?.kind === "SelectorExpr" &&
				lit.typeExpr.field === "F32x4" &&
				lit.typeExpr.expr?.name === "simd")
		) {
			this.emitSimdCompositeLit(lit);
			return;
		}
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
					this.emitExpr(elem.value, mapInfo.valWType);
					this._emitCopyIfValueStruct(elem.value, valType, mapInfo.valWType);
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
				this.emitExpr(elem, sliceInfo.elemWType);
				this._emitCopyIfValueStruct(elem, elem._type, sliceInfo.elemWType);
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
				this.emitExpr(elem, arrInfo.elemWType);
				this._emitCopyIfValueStruct(elem, elem._type, arrInfo.elemWType);
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
		let structInfo = typeName ? this.mod.getStructType(typeName) : null;
		if (!structInfo) {
			structInfo = this._resolveStructInfo(lit);
		}
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

		const sharedInfo = this._sharedInfo(baseType);
		if (sharedInfo) {
			this.emitSharedIndexExpr(expr, sharedInfo, targetWasmType);
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

		// If copying within the same array and shifting right (dstOff > srcOff),
		// copy backwards to prevent clobbering overlapping elements.
		this.pushInstruction({ op: "local.get", index: dstArrTmp });
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "local.get", index: dstOffTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "if", blockType: "void" });

		// Backwards copy: i from lenTmp - 1 down to 0
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
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
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction("else");

		// Forwards copy: i from 0 up to lenTmp - 1
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

		const rawBaseType = baseNode._type ?? this._resolveExprGoType(baseNode);
		const baseType =
			rawBaseType?.kind === "pointer" ? rawBaseType.base : rawBaseType;
		const arrayLen =
			baseType?.kind === "array" ? (baseType.len ?? baseType.size) : null;
		let constIdx = null;
		if (indexNode.kind === "BasicLit" && indexNode.litKind === "INT") {
			try {
				const v = Number(indexNode.value);
				if (Number.isInteger(v)) constIdx = v;
			} catch {}
		}
		if (
			arrayLen !== null &&
			arrayLen !== undefined &&
			constIdx !== null &&
			constIdx >= 0 &&
			constIdx < arrayLen
		) {
			this.emitExpr(baseNode, arrWType);
			this.pushInstruction({ op: "i32.const", value: constIdx });
			return;
		}

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
		const isTargetComplex64 =
			lit._type?.name === "complex64" ||
			targetWasmType?.typeName === "$complex64";
		const isTargetComplex128 =
			lit._type?.name === "complex128" ||
			lit._type?.base === "complex128" ||
			targetWasmType?.typeName === "$complex128";
		if (isTargetComplex64 || isTargetComplex128) {
			const info = this.mod.getComplexType(
				isTargetComplex64 ? "complex64" : "complex128",
			);
			const s = String(lit.value);
			const clean = /^0[0-7]+$/.test(s) ? `0o${s.slice(1)}` : s;
			const n = Number(clean);
			this.pushInstruction({ op: `${info.elemWType}.const`, value: n });
			this.pushInstruction({ op: `${info.elemWType}.const`, value: 0.0 });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: info.typeIndex,
				typeName: info.name,
			});
			return;
		}

		const wType =
			targetWasmType ??
			toWasmType(lit._type, this.mod.checker) ??
			(lit.litKind === "INT" ? "i64" : lit.litKind === "FLOAT" ? "f64" : "i32");

		if (lit.litKind === "INT") {
			const s = String(lit.value);
			const clean = /^0[0-7]+$/.test(s) ? `0o${s.slice(1)}` : s;
			const n = Number(clean);
			if (wType === "i32") {
				this.pushInstruction({ op: "i32.const", value: n | 0 });
			} else if (wType === "f64" || wType === "f32") {
				// Untyped integer constant in a float context (`x * 2`).
				this.pushInstruction({ op: `${wType}.const`, value: n });
			} else {
				this.pushInstruction({ op: "i64.const", value: BigInt(clean) });
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
			this._emitNilValue(lit._type, targetWasmType);
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

	emitImagLit(lit, targetWasmType) {
		const is64 =
			lit._type?.name === "complex64" ||
			targetWasmType?.typeName === "$complex64";
		const complexName = is64 ? "complex64" : "complex128";
		const info = this.mod.getComplexType(complexName);
		const imVal = Number(lit.value);
		this.pushInstruction({ op: `${info.elemWType}.const`, value: 0.0 });
		this.pushInstruction({ op: `${info.elemWType}.const`, value: imVal });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: info.typeIndex,
			typeName: info.name,
		});
	}

	_emitNilValue(goType, targetWasmType) {
		const effectiveType = targetWasmType ?? this.toWasmType(goType);
		if (
			(goType && isSliceType(goType, this.mod.checker)) ||
			(effectiveType &&
				typeof effectiveType === "object" &&
				typeof effectiveType.typeIndex === "number" &&
				this.mod.getSliceTypeByIndex(effectiveType.typeIndex))
		) {
			const elemType = goType ? this._getSliceElemType(goType) : null;
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
	}

	_coerceIntWidth(srcType, targetWasmType) {
		if (srcType === "i32" && targetWasmType === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		} else if (srcType === "i64" && targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
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
			this._emitNilValue(ident._type, targetWasmType);
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
			this._coerceIntWidth(localInfo.type, targetWasmType);
			return;
		}

		if (this.cachedGlobals.has(ident.name)) {
			const cached = this.cachedGlobals.get(ident.name);
			this.pushInstruction({ op: "local.get", index: cached.index });
			this._coerceIntWidth(cached.globalInfo.type, targetWasmType);
			return;
		}

		const globalInfo = this.mod.resolveGlobal(ident.name);
		if (globalInfo) {
			this.pushInstruction({ op: "global.get", index: globalInfo.index });
			this._coerceIntWidth(globalInfo.type, targetWasmType);
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

		if (isComplex(expr._type) || isComplex(operand._type)) {
			this._emitComplexUnary(expr, op, operand, targetWasmType);
			return;
		}

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

			case "&":
				return this._emitAddressOf(operand);

			case "*":
				return this._emitDerefExpr(operand);

			default:
				throw new Error(`Unsupported unary operator: ${op}`);
		}
	}

	_emitComplexUnary(expr, op, operand, targetWasmType) {
		if (op === "+") {
			this.emitExpr(operand, targetWasmType);
			return;
		}
		if (op === "-") {
			if (operand.kind === "ImagLit") {
				this.emitImagLit(
					{ ...operand, value: `-${operand.value}` },
					targetWasmType,
				);
				return;
			}
			const is64 =
				isComplex64(expr._type) ||
				isComplex64(operand._type) ||
				targetWasmType?.typeName === "$complex64";
			const info = this.mod.getComplexType(is64 ? "complex64" : "complex128");
			const cWType = {
				kind: "ref",
				nullable: true,
				typeIndex: info.typeIndex,
				typeName: info.name,
			};
			const opTmp = this.acquireTemp(cWType);
			this.emitExpr(operand, cWType);
			this.pushInstruction({ op: "local.set", index: opTmp });

			for (let i = 0; i < 2; i++) {
				this.pushInstruction({ op: "local.get", index: opTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: info.typeIndex,
					typeName: info.name,
					fieldIndex: i,
				});
				this.pushInstruction(`${info.elemWType}.neg`);
			}

			this.pushInstruction({
				op: "struct.new",
				typeIndex: info.typeIndex,
				typeName: info.name,
			});
			this.releaseTemp(opTmp, cWType);
		}
	}

	_emitSelectorAddressOf(operand) {
		const baseStructInfo = this._resolveStructInfo(operand.expr);
		if (!baseStructInfo) return false;
		const path = this._resolveFieldPath(baseStructInfo, operand.field);
		if (!path || path.length === 0) return false;

		const lastStep = path[path.length - 1];
		if (!isScalarType(lastStep.field.goType, this.mod.checker, this.mod)) {
			return false;
		}
		const baseWType = this.toWasmType(operand.expr._type);
		this.emitExpr(operand.expr, baseWType);
		for (let i = 0; i < path.length - 1; i++) {
			this.pushInstruction({
				op: "struct.get",
				typeIndex: path[i].structInfo.typeIndex,
				typeName: path[i].structInfo.name,
				fieldIndex: path[i].fieldIndex,
			});
		}
		const h = this.mod.getStructAccessorHelpers(
			lastStep.structInfo,
			lastStep.fieldIndex,
		);
		this.pushInstruction({ op: "i32.const", value: lastStep.fieldIndex });
		const getIdx = this.mod.resolveFuncIndex(h.getterName);
		const setIdx = this.mod.resolveFuncIndex(h.setterName);
		this.pushInstruction({ op: "ref.func", funcIndex: getIdx });
		this.pushInstruction({ op: "ref.func", funcIndex: setIdx });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: h.accInfo.typeIndex,
			typeName: h.accInfo.name,
		});
		return true;
	}

	_emitIndexAddressOf(operand) {
		const baseNode = operand.expr;
		const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
		const isSlice = isSliceType(baseType, this.mod.checker);
		const isArr = isArrayType(baseType, this.mod.checker);
		const isPtrToArr =
			baseType?.kind === "pointer" &&
			isArrayType(baseType.base, this.mod.checker);
		if (!isSlice && !isArr && !isPtrToArr) return false;

		const elemGoType = isSlice
			? baseType.elem
			: isPtrToArr
				? baseType.base.elem
				: baseType.elem;
		if (!elemGoType || !isScalarType(elemGoType, this.mod.checker, this.mod)) {
			return false;
		}
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;
		this._emitElemAddr(baseNode, operand.index, sliceInfo, arrInfo);
		const h = this.mod.getElemAccessorHelpers(elemGoType);
		const getIdx = this.mod.resolveFuncIndex(h.getterName);
		const setIdx = this.mod.resolveFuncIndex(h.setterName);
		this.pushInstruction({ op: "ref.func", funcIndex: getIdx });
		this.pushInstruction({ op: "ref.func", funcIndex: setIdx });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: h.accInfo.typeIndex,
			typeName: h.accInfo.name,
		});
		return true;
	}

	_emitAddressOf(operand) {
		if (operand.kind === "Ident") {
			const loc = this.resolveLocal(operand.name);
			if (loc?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: loc.index });
				return;
			}
		}
		if (operand.kind === "CompositeLit") {
			this.emitExpr(operand);
			return;
		}
		const structInfo = this._resolveStructInfo(operand);
		if (structInfo) {
			this.emitExpr(operand);
			return;
		}
		if (
			operand.kind === "SelectorExpr" &&
			this._emitSelectorAddressOf(operand)
		) {
			return;
		}
		if (operand.kind === "IndexExpr" && this._emitIndexAddressOf(operand)) {
			return;
		}
		const opWType = this.toWasmType(operand._type);
		if (!isScalarType(operand._type, this.mod.checker, this.mod)) {
			this.emitExpr(operand, opWType);
			return;
		}
		const box = this.mod.getBoxType(operand._type);
		this.emitExpr(operand, opWType);
		this.pushInstruction({
			op: "struct.new",
			typeIndex: box.typeIndex,
			typeName: box.name,
		});
	}

	_emitDerefExpr(operand) {
		const structInfo = this._resolveStructInfo(operand);
		if (structInfo) {
			const baseWType = this.toWasmType(operand._type);
			this.emitExpr(operand, baseWType);
			this.emitCloneStruct(structInfo, baseWType);
			return;
		}
		const operandGoType =
			operand._type ??
			(operand.kind === "Ident"
				? this.resolveLocal(operand.name)?.goType
				: null) ??
			this._resolveExprGoType(operand);
		const baseGoType = operandGoType?.base ?? operandGoType;
		if (!isScalarType(baseGoType, this.mod.checker, this.mod)) {
			const baseWType = this.toWasmType(baseGoType);
			this.emitExpr(operand, baseWType);
			return;
		}
		const box = this.mod.getBoxType(baseGoType);
		const ptr = this.mod.getPtrType(baseGoType);
		const acc = this.mod.getAccType(baseGoType);
		const ptrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: ptr.typeIndex,
			typeName: ptr.name,
		};
		const pTmp = this.acquireTemp(ptrWType);
		this.emitExpr(operand, ptrWType);
		this.pushInstruction({ op: "local.set", index: pTmp });
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.test",
			typeIndex: box.typeIndex,
			typeName: box.name,
		});
		this.pushInstruction({ op: "if", blockType: box.wType });
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: box.typeIndex,
			typeName: box.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: box.typeIndex,
			typeName: box.name,
			fieldIndex: 0,
		});
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 2,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: acc.getFuncTypeIndex,
		});
		this.pushInstruction("end");
		this.releaseTemp(pTmp, ptrWType);
	}

	_emitComplexEq(aTmp, bTmp, info, f, op) {
		for (let i = 0; i < 2; i++) {
			this.pushInstruction({ op: "local.get", index: aTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: info.typeIndex,
				typeName: info.name,
				fieldIndex: i,
			});
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: info.typeIndex,
				typeName: info.name,
				fieldIndex: i,
			});
			this.pushInstruction(`${f}.eq`);
		}
		this.pushInstruction("i32.and");
		if (op === "!=") this.pushInstruction("i32.eqz");
	}

	_emitComplexAddSub(aTmp, bTmp, info, f, op) {
		const wasmOp = op === "+" ? `${f}.add` : `${f}.sub`;
		for (let i = 0; i < 2; i++) {
			this.pushInstruction({ op: "local.get", index: aTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: info.typeIndex,
				typeName: info.name,
				fieldIndex: i,
			});
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: info.typeIndex,
				typeName: info.name,
				fieldIndex: i,
			});
			this.pushInstruction(wasmOp);
		}
		this.pushInstruction({
			op: "struct.new",
			typeIndex: info.typeIndex,
			typeName: info.name,
		});
	}

	_emitComplexMul(aTmp, bTmp, info, f) {
		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction(`${f}.sub`);

		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction(`${f}.add`);

		this.pushInstruction({
			op: "struct.new",
			typeIndex: info.typeIndex,
			typeName: info.name,
		});
	}

	_emitComplexDiv(aTmp, bTmp, info, f) {
		const dTmp = this.acquireTemp(f);
		for (let i = 0; i < 2; i++) {
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: info.typeIndex,
				typeName: info.name,
				fieldIndex: i,
			});
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: info.typeIndex,
				typeName: info.name,
				fieldIndex: i,
			});
			this.pushInstruction(`${f}.mul`);
			if (i > 0) this.pushInstruction(`${f}.add`);
		}
		this.pushInstruction({ op: "local.set", index: dTmp });

		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction(`${f}.add`);
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction(`${f}.div`);

		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction({ op: "local.get", index: aTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: info.typeIndex,
			typeName: info.name,
			fieldIndex: 1,
		});
		this.pushInstruction(`${f}.mul`);
		this.pushInstruction(`${f}.sub`);
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction(`${f}.div`);

		this.pushInstruction({
			op: "struct.new",
			typeIndex: info.typeIndex,
			typeName: info.name,
		});
		this.releaseTemp(dTmp, f);
	}

	emitComplexBinary(expr, targetWasmType) {
		const { op, left, right } = expr;
		const is64 =
			isComplex64(expr._type) ||
			isComplex64(left._type) ||
			isComplex64(right._type) ||
			targetWasmType?.typeName === "$complex64";
		const info = this.mod.getComplexType(is64 ? "complex64" : "complex128");
		const f = info.elemWType;
		const cWType = {
			kind: "ref",
			nullable: true,
			typeIndex: info.typeIndex,
			typeName: info.name,
		};
		const aTmp = this.acquireTemp(cWType);
		const bTmp = this.acquireTemp(cWType);
		this.emitExpr(left, cWType);
		this.pushInstruction({ op: "local.set", index: aTmp });
		this.emitExpr(right, cWType);
		this.pushInstruction({ op: "local.set", index: bTmp });

		if (op === "==" || op === "!=") {
			this._emitComplexEq(aTmp, bTmp, info, f, op);
		} else if (op === "+" || op === "-") {
			this._emitComplexAddSub(aTmp, bTmp, info, f, op);
		} else if (op === "*") {
			this._emitComplexMul(aTmp, bTmp, info, f);
		} else if (op === "/") {
			this._emitComplexDiv(aTmp, bTmp, info, f);
		}
		this.releaseTemp(bTmp, cWType);
		this.releaseTemp(aTmp, cWType);
	}

	emitBinaryExpr(expr, targetWasmType = null) {
		const { op, left, right } = expr;

		if (
			isComplex(expr._type) ||
			isComplex(left._type) ||
			isComplex(right._type)
		) {
			this.emitComplexBinary(expr, targetWasmType);
			return;
		}

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

	_findScalarPtrByWType(wType, map) {
		if (!map) return null;
		for (const info of map.values()) {
			if (info.typeIndex === wType.typeIndex || info.name === wType.typeName) {
				return info;
			}
		}
		return null;
	}

	_getScalarPtrFromWType(wType) {
		if (!wType || typeof wType !== "object") return null;
		const ptr = this._findScalarPtrByWType(wType, this.mod.ptrTypes);
		if (ptr) {
			return {
				ptr,
				box: this.mod.getBoxType(ptr.goType),
				acc: this.mod.getAccType(ptr.goType),
			};
		}
		const box = this._findScalarPtrByWType(wType, this.mod.boxTypes);
		if (box) {
			return {
				ptr: this.mod.getPtrType(box.goType),
				box,
				acc: this.mod.getAccType(box.goType),
			};
		}
		const acc = this._findScalarPtrByWType(wType, this.mod.accTypes);
		if (acc) {
			return {
				ptr: this.mod.getPtrType(acc.goType),
				box: this.mod.getBoxType(acc.goType),
				acc,
			};
		}
		return null;
	}

	_getScalarPtrFromGoType(goType) {
		let g = goType;
		if (g?.kind === "TypeName" && this.mod.checker?.types?.has(g.name)) {
			g = this.mod.checker.types.get(g.name);
		}
		while (g?.kind === "named" && g.underlying) {
			g = g.underlying;
		}
		const isPtr =
			g?.kind === "pointer" ||
			g?.kind === "PointerType" ||
			g?.kind === "StarExpr";
		if (!isPtr || (!g.base && !g.elem)) return null;
		const base = g.base || g.elem;
		if (!isScalarType(base, this.mod.checker, this.mod)) {
			return null;
		}
		return {
			ptr: this.mod.getPtrType(base),
			box: this.mod.getBoxType(base),
			acc: this.mod.getAccType(base),
		};
	}

	_getScalarPtrInfo(wType, goType = null) {
		return (
			this._getScalarPtrFromGoType(goType) ?? this._getScalarPtrFromWType(wType)
		);
	}

	_isScalarPtrType(goType, wType = null) {
		return this._getScalarPtrInfo(wType, goType) !== null;
	}

	_emitScalarPtrEq(ptrInfo) {
		const ptrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: ptrInfo.ptr.typeIndex,
			typeName: ptrInfo.ptr.name,
		};
		const qTmp = this.acquireTemp(ptrWType);
		const pTmp = this.acquireTemp(ptrWType);
		this.pushInstruction({ op: "local.set", index: qTmp });
		this.pushInstruction({ op: "local.set", index: pTmp });

		const acc = ptrInfo.acc;

		// 1. Fast path: ref.eq(p, q)
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({ op: "local.get", index: qTmp });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("else");

		// 2. Else: test if both p and q are $acc_T
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.test",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: qTmp });
		this.pushInstruction({
			op: "ref.test",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({ op: "if", blockType: "i32" });

		// Both are $acc_T: cast and compare ref.eq(p.target, q.target)
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "ref.cast", heapType: "eq" });
		this.pushInstruction({ op: "local.get", index: qTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "ref.cast", heapType: "eq" });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "if", blockType: "i32" });

		// Compare i32.eq(p.index, q.index)
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: qTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 1,
		});
		this.pushInstruction("i32.eq");

		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("end"); // target eq if

		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("end"); // q is acc if

		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("end"); // p is acc if

		this.pushInstruction("end"); // fast path if

		this.releaseTemp(pTmp, ptrWType);
		this.releaseTemp(qTmp, ptrWType);
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
			} else if (f.wType === "anyref") {
				this._emitAnyEq();
			} else if (this._isScalarPtrType(f.goType, f.wType)) {
				const ptrInfo = this._getScalarPtrInfo(f.wType, f.goType);
				this._emitScalarPtrEq(ptrInfo);
			} else if (typeof f.wType === "object" && f.wType !== null) {
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
		if (isComplex(goType)) {
			const is64 = isComplex64(goType);
			const info = this.mod.getComplexType(is64 ? "complex64" : "complex128");
			const f = info.elemWType;
			const bTmp = this.acquireTemp(wType);
			const aTmp = this.acquireTemp(wType);
			this.pushInstruction({ op: "local.set", index: bTmp });
			this.pushInstruction({ op: "local.set", index: aTmp });
			if (op === "+" || op === "-") {
				this._emitComplexAddSub(aTmp, bTmp, info, f, op);
			} else if (op === "*") {
				this._emitComplexMul(aTmp, bTmp, info, f);
			} else if (op === "/") {
				this._emitComplexDiv(aTmp, bTmp, info, f);
			}
			this.releaseTemp(aTmp, wType);
			this.releaseTemp(bTmp, wType);
			return;
		}

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
			case "/":
				if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.div`);
				} else {
					this.pushInstruction(signed ? `${wType}.div_s` : `${wType}.div_u`);
					this.emitNarrowIntWrap(goType);
				}
				break;
			case "%":
				this.pushInstruction(signed ? `${wType}.rem_s` : `${wType}.rem_u`);
				this.emitNarrowIntWrap(goType);
				break;
			case "<<":
				this.pushInstruction(`${wType}.shl`);
				this.emitNarrowIntWrap(goType);
				break;
			case ">>":
				this.pushInstruction(signed ? `${wType}.shr_s` : `${wType}.shr_u`);
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
				} else if (wType === "anyref") {
					this._emitAnyEq();
				} else if (this._isScalarPtrType(goType, wType)) {
					const ptrInfo = this._getScalarPtrInfo(wType, goType);
					this._emitScalarPtrEq(ptrInfo);
				} else if (typeof wType === "object" && wType !== null) {
					this.pushInstruction("ref.eq");
				} else {
					this.pushInstruction(`${wType}.eq`);
				}
				break;
			case "!=":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("!=");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "anyref") {
					this._emitAnyEq();
					this.pushInstruction("i32.eqz");
				} else if (this._isScalarPtrType(goType, wType)) {
					const ptrInfo = this._getScalarPtrInfo(wType, goType);
					this._emitScalarPtrEq(ptrInfo);
					this.pushInstruction("i32.eqz");
				} else if (typeof wType === "object" && wType !== null) {
					this.pushInstruction("ref.eq");
					this.pushInstruction("i32.eqz");
				} else {
					this.pushInstruction(`${wType}.ne`);
				}
				break;
			case "<":
			case "<=":
			case ">":
			case ">=": {
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex(op);
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else {
					const name =
						op === "<" ? "lt" : op === "<=" ? "le" : op === ">" ? "gt" : "ge";
					const suffix =
						wType === "f32" || wType === "f64" ? "" : `_${signed ? "s" : "u"}`;
					this.pushInstruction(`${wType}.${name}${suffix}`);
				}
				break;
			}

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
		const is64 = wType === "i64";
		const divOp = `${wType}.${op === "/" ? "div" : "rem"}_${signed ? "s" : "u"}`;

		let constDivisor = null;
		if (right.kind === "BasicLit" && right.litKind === "INT") {
			try {
				constDivisor = BigInt(right.value);
			} catch {}
		}

		if (constDivisor !== null && constDivisor !== 0n && constDivisor !== -1n) {
			// Specialize unsigned powers-of-two to shifts or bitwise masks
			if (
				!signed &&
				constDivisor > 0n &&
				(constDivisor & (constDivisor - 1n)) === 0n
			) {
				let k = 0n;
				let temp = constDivisor;
				while (temp > 1n) {
					temp >>= 1n;
					k++;
				}
				if (op === "/") {
					this.emitExpr(left, wType);
					this.pushInstruction({
						op: `${wType}.const`,
						value: is64 ? k : Number(k),
					});
					this.pushInstruction(`${wType}.shr_u`);
				} else {
					this.emitExpr(left, wType);
					this.pushInstruction({
						op: `${wType}.const`,
						value: is64 ? constDivisor - 1n : Number(constDivisor - 1n),
					});
					this.pushInstruction(`${wType}.and`);
				}
				if (!is64) this.emitNarrowIntWrap(goType);
				return;
			}

			// Constant divisor != 0 and != -1: no dynamic zero or overflow check needed
			this.emitExpr(left, wType);
			this.emitExpr(right, wType);
			this.pushInstruction(divOp);
			if (!is64) this.emitNarrowIntWrap(goType);
			return;
		}

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

		if (wType === "i32" || wType === "i64") {
			if (signed) {
				const minVal = is64 ? -9223372036854775808n : -2147483648;
				const negOne = is64 ? -1n : -1;
				const zeroVal = is64 ? 0n : 0;
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: `${wType}.const`, value: minVal });
				this.pushInstruction(`${wType}.eq`);
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction({ op: `${wType}.const`, value: negOne });
				this.pushInstruction(`${wType}.eq`);
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: wType });
				this.pushInstruction({
					op: `${wType}.const`,
					value: op === "/" ? minVal : zeroVal,
				});
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(divOp);
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(divOp);
			}
			if (!is64) this.emitNarrowIntWrap(goType);
		}

		this.releaseTemp(tmpB, wType);
		this.releaseTemp(tmpA, wType);
	}

	emitShift(op, left, right, targetWasmType = null) {
		const goType = left._type;
		const wType = targetWasmType ?? toWasmType(goType, this.mod.checker);
		const signed = isSigned(goType);
		const rightWType = toWasmType(right._type, this.mod.checker);
		const is64 = wType === "i64";
		const zeroVal = is64 ? 0n : 0;
		const negOne = is64 ? -1n : -1;
		const widthVal = is64 ? 64n : 32;

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

		this.pushInstruction({ op: "local.get", index: tmpShift });
		this.pushInstruction({ op: `${wType}.const`, value: widthVal });
		this.pushInstruction(`${wType}.ge_u`);
		this.pushInstruction({ op: "if", blockType: wType });

		if (op === ">>" && signed) {
			this.pushInstruction({ op: "local.get", index: tmpVal });
			this.pushInstruction({ op: `${wType}.const`, value: zeroVal });
			this.pushInstruction(`${wType}.lt_s`);
			this.pushInstruction({ op: "if", blockType: wType });
			this.pushInstruction({ op: `${wType}.const`, value: negOne });
			this.pushInstruction("else");
			this.pushInstruction({ op: `${wType}.const`, value: zeroVal });
			this.pushInstruction("end");
		} else {
			this.pushInstruction({ op: `${wType}.const`, value: zeroVal });
		}

		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: tmpVal });
		this.pushInstruction({ op: "local.get", index: tmpShift });
		this.pushInstruction(
			op === "<<" ? `${wType}.shl` : `${wType}.shr_${signed ? "s" : "u"}`,
		);

		this.pushInstruction("end");
		if (!is64) this.emitNarrowIntWrap(goType);

		this.releaseTemp(tmpShift, wType);
		this.releaseTemp(tmpVal, wType);
	}

	emitTypeConversion(conv) {
		const { targetType, expr } = conv;
		const fromType = expr._type ?? this._resolveExprGoType(expr);
		const fromWType = this.toWasmType(fromType);
		const toWType = this.toWasmType(targetType);

		this.emitExpr(expr, fromWType);

		if (isComplex(targetType)) {
			this._emitComplexConversion(targetType, fromType, fromWType);
			return;
		}

		if (fromWType === toWType) {
			this.emitNarrowIntWrap(targetType);
			return;
		}

		if (
			fromWType === "externref" &&
			isSliceType(targetType, this.mod.checker) &&
			(targetType.elem?.name === "byte" || targetType.elem?.name === "uint8")
		) {
			this._emitStringToByteSlice(targetType);
			return;
		}

		if (
			toWType === "externref" &&
			isSliceType(fromType, this.mod.checker) &&
			(fromType.elem?.name === "byte" || fromType.elem?.name === "uint8")
		) {
			this._emitByteSliceToString(fromType);
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

		const srcSign = isSigned(fromType) ? "s" : "u";
		const dstSign = isSigned(targetType) ? "s" : "u";
		if (fromWType === "i32" && toWType === "i64") {
			this.pushInstruction(`i64.extend_i32_${srcSign}`);
		} else if (fromWType === "i64" && toWType === "i32") {
			this.pushInstruction("i32.wrap_i64");
			this.emitNarrowIntWrap(targetType);
		} else if (
			(fromWType === "i32" || fromWType === "i64") &&
			(toWType === "f32" || toWType === "f64")
		) {
			this.pushInstruction(`${toWType}.convert_${fromWType}_${srcSign}`);
		} else if (fromWType === "f32" && toWType === "f64") {
			this.pushInstruction("f64.promote_f32");
		} else if (fromWType === "f64" && toWType === "f32") {
			this.pushInstruction("f32.demote_f64");
		} else if (
			(fromWType === "f32" || fromWType === "f64") &&
			(toWType === "i32" || toWType === "i64")
		) {
			this.pushInstruction(`${toWType}.trunc_sat_${fromWType}_${dstSign}`);
			if (toWType === "i32") this.emitNarrowIntWrap(targetType);
		}
	}

	_emitComplexConversion(targetType, fromType, fromWType) {
		const isTarget64 = isComplex64(targetType);
		const targetInfo = this.mod.getComplexType(
			isTarget64 ? "complex64" : "complex128",
		);
		if (isComplex(fromType)) {
			const isFrom64 = isComplex64(fromType);
			if (isTarget64 === isFrom64) return;
			const fromInfo = this.mod.getComplexType(
				isFrom64 ? "complex64" : "complex128",
			);
			const fromWTypeRef = {
				kind: "ref",
				nullable: true,
				typeIndex: fromInfo.typeIndex,
				typeName: fromInfo.name,
			};
			const cTmp = this.acquireTemp(fromWTypeRef);
			this.pushInstruction({ op: "local.set", index: cTmp });

			for (let i = 0; i < 2; i++) {
				this.pushInstruction({ op: "local.get", index: cTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: fromInfo.typeIndex,
					typeName: fromInfo.name,
					fieldIndex: i,
				});
				this.pushInstruction(isTarget64 ? "f32.demote_f64" : "f64.promote_f32");
			}

			this.pushInstruction({
				op: "struct.new",
				typeIndex: targetInfo.typeIndex,
				typeName: targetInfo.name,
			});
			this.releaseTemp(cTmp, fromWTypeRef);
			return;
		}

		// From numeric scalar
		const targetF = targetInfo.elemWType;
		const srcSign = isSigned(fromType) ? "s" : "u";
		if (fromWType === "i32" || fromWType === "i64") {
			this.pushInstruction(`${targetF}.convert_${fromWType}_${srcSign}`);
		} else if (fromWType === "f32" && targetF === "f64") {
			this.pushInstruction("f64.promote_f32");
		} else if (fromWType === "f64" && targetF === "f32") {
			this.pushInstruction("f32.demote_f64");
		}
		this.pushInstruction({ op: `${targetF}.const`, value: 0.0 });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: targetInfo.typeIndex,
			typeName: targetInfo.name,
		});
	}

	_emitStringToByteSlice(targetType) {
		const elemGo = targetType.elem;
		const sliceInfo = this.mod.getSliceType(elemGo);
		const arrInfo = sliceInfo.arrInfo;
		const strTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.set", index: strTmp });
		const lenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: strTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStrToBytesImportIndex(),
		});
		this.pushInstruction({ op: "local.tee", index: lenTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });
		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStrByteAtImportIndex(),
		});
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(strTmp, "externref");
	}

	_emitByteSliceToString(fromType) {
		const elemGo = fromType.elem;
		const sliceInfo = this.mod.getSliceType(elemGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const sTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.set", index: sTmp });
		const arrTmp = this.acquireTemp(arrW);
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const capTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
			cap: capTmp,
		});
		this.releaseTemp(sTmp, sliceW);
		this.releaseTemp(capTmp, "i32");

		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getBytesToStrInitImportIndex(),
		});

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getBytesToStrPushImportIndex(),
		});

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getBytesToStrFinishImportIndex(),
		});

		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, arrW);
	}
}
