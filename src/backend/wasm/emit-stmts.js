// src/backend/wasm/emit-stmts.js
// FunctionEmitter mixin: statement emission (decls, assignment, control flow, return).

import { isIntRangeType, isRangeFor } from "../../lower/range.js";
import {
	getMapKeyValTypes,
	isArrayType,
	isFuncType,
	isInterfaceType,
	isMapType,
	isNonEmptyInterface,
	isPointerToStruct,
	isSliceType,
	isStringType,
	isStructType,
} from "./types.js";

export class StmtsEmitter {
	emitVarDecl(stmt) {
		const decls = stmt.decls ?? stmt.specs ?? [stmt];
		for (const spec of decls) {
			const names = spec.names ?? (spec.name ? [spec.name] : []);
			const values = spec.value ?? (spec.init ? [spec.init] : []);

			for (let i = 0; i < names.length; i++) {
				const name = names[i];
				const rawType = spec.type ?? values[i]?._type;
				const wType = this.toWasmType(rawType);
				const localIdx = this.allocLocal(name, wType, rawType);
				const localInfo = this.locals.get(name);
				if (values?.[i]) {
					const r = values[i];
					this.emitExpr(r, wType);
					this._emitCopyIfValueStruct(r, rawType, wType);
					if (localInfo?.isBoxed) {
						this.pushInstruction({
							op: "struct.new",
							typeIndex: localInfo.boxInfo.typeIndex,
						});
					}
					this.pushInstruction({ op: "local.set", index: localIdx });
				} else {
					this.emitZeroValue(rawType, wType);
					if (localInfo?.isBoxed) {
						this.pushInstruction({
							op: "struct.new",
							typeIndex: localInfo.boxInfo.typeIndex,
						});
					}
					this.pushInstruction({ op: "local.set", index: localIdx });
				}
			}
		}
	}

	emitDefineStmt(stmt) {
		const lhsNodes = Array.isArray(stmt.lhs) ? stmt.lhs : [stmt.lhs];
		const rhsNodes = Array.isArray(stmt.rhs) ? stmt.rhs : [stmt.rhs];

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "TypeAssertExpr"
		) {
			this._emitCommaOkTypeAssert(lhsNodes[0], lhsNodes[1], rhsNodes[0], true);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "IndexExpr" &&
			isMapType(
				rhsNodes[0].expr._type ?? this._resolveExprGoType(rhsNodes[0].expr),
				this.mod.checker,
			)
		) {
			this._emitCommaOkMapIndex(lhsNodes[0], lhsNodes[1], rhsNodes[0], true);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length > 1 &&
			rhsNodes[0]._type?.kind === "tuple"
		) {
			this._emitTupleDefine(lhsNodes, rhsNodes[0]);
			return;
		}

		for (let i = 0; i < lhsNodes.length; i++) {
			this._emitDefineSingle(lhsNodes[i], rhsNodes[i]);
		}
	}

	_emitDefineSingle(l, r) {
		if (!r || l.kind !== "Ident") return;
		if (l.name === "_") {
			this.emitExpr(r);
			this.pushInstruction("drop");
			return;
		}
		const wType = this.toWasmType(r._type);
		const idx = this.allocLocal(l.name, wType, r._type);
		const localInfo = this.locals.get(l.name);
		this.emitExpr(r, wType);
		this._emitCopyIfValueStruct(r, r._type, wType);
		if (localInfo?.isBoxed) {
			this.pushInstruction({
				op: "struct.new",
				typeIndex: localInfo.boxInfo.typeIndex,
			});
		}
		this.pushInstruction({ op: "local.set", index: idx });
	}

	_emitTupleDefine(lhsNodes, rhsNode) {
		const tupleTypes = rhsNode._type.types;
		const localIndices = [];
		for (let i = 0; i < lhsNodes.length; i++) {
			const l = lhsNodes[i];
			const wType = this.toWasmType(tupleTypes[i]);
			const idx =
				l.kind === "Ident" && l.name !== "_"
					? this.allocLocal(l.name, wType, tupleTypes[i])
					: null;
			localIndices.push(idx);
		}

		this.emitExpr(rhsNode);

		for (let i = lhsNodes.length - 1; i >= 0; i--) {
			const idx = localIndices[i];
			if (idx !== null) {
				const localInfo = this.locals.get(lhsNodes[i].name);
				if (localInfo?.isBoxed) {
					this.pushInstruction({
						op: "struct.new",
						typeIndex: localInfo.boxInfo.typeIndex,
					});
				}
				this.pushInstruction({ op: "local.set", index: idx });
			} else {
				this.pushInstruction("drop");
			}
		}
	}

	emitAssignStmt(stmt) {
		const { lhs, rhs, op } = stmt;
		if (op === ":=" || op === "=") {
			this._emitAssign(lhs, rhs, op);
		} else {
			this._emitCompoundAssign(lhs, rhs, op);
		}
	}

	_emitAssign(lhs, rhs, op) {
		const lhsNodes = Array.isArray(lhs) ? lhs : [lhs];
		const rhsNodes = Array.isArray(rhs) ? rhs : [rhs];

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "TypeAssertExpr"
		) {
			this._emitCommaOkTypeAssert(
				lhsNodes[0],
				lhsNodes[1],
				rhsNodes[0],
				op === ":=",
			);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "IndexExpr" &&
			isMapType(
				rhsNodes[0].expr._type ?? this._resolveExprGoType(rhsNodes[0].expr),
				this.mod.checker,
			)
		) {
			this._emitCommaOkMapIndex(
				lhsNodes[0],
				lhsNodes[1],
				rhsNodes[0],
				op === ":=",
			);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length > 1 &&
			rhsNodes[0]._type?.kind === "tuple"
		) {
			this._emitTupleAssign(lhsNodes, rhsNodes[0], op);
			return;
		}

		for (let i = 0; i < lhsNodes.length; i++) {
			this._emitAssignSingle(lhsNodes[i], rhsNodes[i], op);
		}
	}

	_emitAssignSingle(l, r, op) {
		if (!r) return;
		if (l.kind === "Ident") {
			if (l.name === "_") {
				this.emitExpr(r);
				this.pushInstruction("drop");
				return;
			}
			let localInfo = this.resolveLocal(l.name);
			if (!localInfo && op === ":=") {
				const wType = this.toWasmType(r._type);
				this.allocLocal(l.name, wType, r._type);
				localInfo = this.locals.get(l.name);
			}
			if (localInfo) {
				if (localInfo.isBoxed) {
					this.pushInstruction({ op: "local.get", index: localInfo.index });
					this.emitExpr(r, localInfo.boxInfo.wType);
					this.pushInstruction({
						op: "struct.set",
						typeIndex: localInfo.boxInfo.typeIndex,
						fieldIndex: 0,
					});
					return;
				}
				this.emitExpr(r, localInfo.type);
				this._emitCopyIfValueStruct(r, localInfo.goType, localInfo.type);
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				const globalInfo = this.mod.resolveGlobal(l.name);
				if (globalInfo) {
					this.emitExpr(r, globalInfo.type);
					this._emitCopyIfValueStruct(r, globalInfo.goType, globalInfo.type);
					this.pushInstruction({
						op: "global.set",
						index: globalInfo.index,
					});
				}
			}
			return;
		}

		if (l.kind === "SelectorExpr") {
			const structInfo = this._resolveStructInfo(l.expr);
			if (!structInfo) {
				throw new Error(
					`Cannot resolve struct for selector assignment: ${l.field}`,
				);
			}
			const path = this._resolveFieldPath(structInfo, l.field);
			if (!path) {
				throw new Error(
					`Unknown field '${l.field}' on struct '${structInfo.name}'`,
				);
			}
			const lastStep = path[path.length - 1];
			const baseWType = this.toWasmType(l.expr._type);

			this.emitExpr(l.expr, baseWType);
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			this.emitExpr(r, lastStep.field.wType);
			this._emitCopyIfValueStruct(
				r,
				lastStep.field.goType,
				lastStep.field.wType,
			);
			this.pushInstruction({
				op: "struct.set",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			return;
		}

		if (l.kind === "UnaryExpr" && l.op === "*") {
			const structInfo = this._resolveStructInfo(l.operand);
			if (structInfo) {
				const baseWType = this.toWasmType(l.operand._type);
				const tmpL = this.acquireTemp(baseWType);
				const tmpR = this.acquireTemp(baseWType);
				this.emitExpr(l.operand, baseWType);
				this.pushInstruction({ op: "local.set", index: tmpL });
				this.emitExpr(r, baseWType);
				this.pushInstruction({ op: "local.set", index: tmpR });
				for (let i = 0; i < structInfo.fields.length; i++) {
					this.pushInstruction({ op: "local.get", index: tmpL });
					this.pushInstruction({ op: "local.get", index: tmpR });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: structInfo.typeIndex,
						fieldIndex: i,
					});
					this.pushInstruction({
						op: "struct.set",
						typeIndex: structInfo.typeIndex,
						fieldIndex: i,
					});
				}
				this.releaseTemp(tmpR, baseWType);
				this.releaseTemp(tmpL, baseWType);
				return;
			}
			const box = this.mod.getBoxType(l.operand._type?.base ?? l.operand._type);
			const baseWType = {
				kind: "ref",
				nullable: true,
				typeIndex: box.typeIndex,
			};
			const boxTmp = this.acquireTemp(baseWType);
			this.emitExpr(l.operand, baseWType);
			this.pushInstruction({ op: "local.set", index: boxTmp });
			this.pushInstruction({ op: "local.get", index: boxTmp });
			this.emitExpr(r, box.wType);
			this.pushInstruction({
				op: "struct.set",
				typeIndex: box.typeIndex,
				fieldIndex: 0,
			});
			this.releaseTemp(boxTmp, baseWType);
			return;
		}

		if (l.kind === "IndexExpr") {
			const baseNode = l.expr;
			const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
			if (isMapType(baseType, this.mod.checker)) {
				const { keyType, valType } = getMapKeyValTypes(
					baseType,
					this.mod.checker,
				);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(baseNode, mapInfo.wType);
				this.emitExpr(l.index, mapInfo.keyWType);
				this.emitExpr(r, mapInfo.valWType);
				this._emitCopyIfValueStruct(r, valType, mapInfo.valWType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = isSlice
				? baseType.elem
				: isPtrToArr
					? baseType.base.elem
					: baseType.elem;
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

			this._emitElemAddr(baseNode, l.index, sliceInfo, arrInfo);

			this.emitExpr(r, arrInfo.elemWType);
			this._emitCopyIfValueStruct(r, elemGoType, arrInfo.elemWType);

			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});
			return;
		}
	}

	_emitTupleAssign(lhsNodes, rhsNode, op) {
		const tupleTypes = rhsNode._type.types;
		const dests = [];
		for (let i = 0; i < lhsNodes.length; i++) {
			const l = lhsNodes[i];
			if (l.kind === "Ident" && l.name !== "_") {
				let localInfo = this.resolveLocal(l.name);
				if (!localInfo && op === ":=") {
					const wType = this.toWasmType(tupleTypes[i]);
					this.allocLocal(l.name, wType, tupleTypes[i]);
					localInfo = this.locals.get(l.name);
				}
				dests.push(localInfo ?? this.mod.resolveGlobal(l.name) ?? null);
			} else {
				dests.push(null);
			}
		}

		this.emitExpr(rhsNode);

		for (let i = lhsNodes.length - 1; i >= 0; i--) {
			const dest = dests[i];
			if (dest && typeof dest.index === "number") {
				if (dest.isBoxed) {
					const valTmp = this.acquireTemp(dest.boxInfo.wType);
					this.pushInstruction({ op: "local.set", index: valTmp });
					this.pushInstruction({ op: "local.get", index: dest.index });
					this.pushInstruction({ op: "local.get", index: valTmp });
					this.pushInstruction({
						op: "struct.set",
						typeIndex: dest.boxInfo.typeIndex,
						fieldIndex: 0,
					});
					this.releaseTemp(valTmp, dest.boxInfo.wType);
				} else if (this.resolveLocal(lhsNodes[i].name)) {
					this.pushInstruction({ op: "local.set", index: dest.index });
				} else {
					this.pushInstruction({ op: "global.set", index: dest.index });
				}
			} else {
				this.pushInstruction("drop");
			}
		}
	}

	_emitCommaOkTypeAssert(valLhs, okLhs, assertExpr, isDefine) {
		const targetGoType = assertExpr._type ?? assertExpr.type;
		const targetWType = this.toWasmType(targetGoType);
		const anyTmp = this.acquireTemp("anyref");
		this.emitExpr(assertExpr.expr, "anyref");
		this.pushInstruction({ op: "local.set", index: anyTmp });

		const okTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: anyTmp });
		this._emitTypeTest(targetGoType);
		this.pushInstruction({ op: "local.set", index: okTmp });

		const valTmp = this.acquireTemp(targetWType);
		this.pushInstruction({ op: "local.get", index: okTmp });
		this.pushInstruction({ op: "if", blockType: targetWType });
		this.pushInstruction({ op: "local.get", index: anyTmp });
		this._emitTypeCast(targetGoType, targetWType);
		this.pushInstruction("else");
		this.emitZeroValue(targetGoType, targetWType);
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: valTmp });

		this.releaseTemp(anyTmp, "anyref");

		// Assign val to valLhs
		if (isDefine && valLhs.kind === "Ident" && valLhs.name !== "_") {
			const idx = this.allocLocal(valLhs.name, targetWType, targetGoType);
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction({ op: "local.set", index: idx });
		} else if (valLhs.kind === "Ident" && valLhs.name !== "_") {
			const local = this.resolveLocal(valLhs.name);
			this.pushInstruction({ op: "local.get", index: valTmp });
			if (local) {
				this.pushInstruction({ op: "local.set", index: local.index });
			} else {
				const global = this.mod.resolveGlobal(valLhs.name);
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		// Assign ok to okLhs
		if (isDefine && okLhs.kind === "Ident" && okLhs.name !== "_") {
			const idx = this.allocLocal(okLhs.name, "i32", {
				kind: "basic",
				name: "bool",
			});
			this.pushInstruction({ op: "local.get", index: okTmp });
			this.pushInstruction({ op: "local.set", index: idx });
		} else if (okLhs.kind === "Ident" && okLhs.name !== "_") {
			const local = this.resolveLocal(okLhs.name);
			this.pushInstruction({ op: "local.get", index: okTmp });
			if (local) {
				this.pushInstruction({ op: "local.set", index: local.index });
			} else {
				const global = this.mod.resolveGlobal(okLhs.name);
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		this.releaseTemp(valTmp, targetWType);
		this.releaseTemp(okTmp, "i32");
	}

	_emitCommaOkMapIndex(valLhs, okLhs, indexExpr, isDefine) {
		const baseNode = indexExpr.expr;
		const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
		const { keyType, valType } = getMapKeyValTypes(baseType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		this.emitExpr(baseNode, mapInfo.wType);
		this.emitExpr(indexExpr.index, mapInfo.keyWType);
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.getOkFuncName),
		});

		const okTmp = this.acquireTemp("i32");
		const valTmp = this.acquireTemp(mapInfo.valWType);
		this.pushInstruction({ op: "local.set", index: okTmp });
		this.pushInstruction({ op: "local.set", index: valTmp });

		// Assign val to valLhs
		if (isDefine && valLhs.kind === "Ident" && valLhs.name !== "_") {
			const idx = this.allocLocal(valLhs.name, mapInfo.valWType, valType);
			const local = this.locals.get(valLhs.name);
			if (local?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: valTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: local.boxInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: idx });
			} else {
				this.pushInstruction({ op: "local.get", index: valTmp });
				this.pushInstruction({ op: "local.set", index: idx });
			}
		} else if (valLhs.kind === "Ident" && valLhs.name !== "_") {
			const local = this.resolveLocal(valLhs.name);
			if (local) {
				if (local.isBoxed) {
					this.pushInstruction({ op: "local.get", index: local.index });
					this.pushInstruction({ op: "local.get", index: valTmp });
					this.pushInstruction({
						op: "struct.set",
						typeIndex: local.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: valTmp });
					this.pushInstruction({ op: "local.set", index: local.index });
				}
			} else {
				const global = this.mod.resolveGlobal(valLhs.name);
				this.pushInstruction({ op: "local.get", index: valTmp });
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		// Assign ok to okLhs
		if (isDefine && okLhs.kind === "Ident" && okLhs.name !== "_") {
			const idx = this.allocLocal(okLhs.name, "i32", {
				kind: "basic",
				name: "bool",
			});
			const local = this.locals.get(okLhs.name);
			if (local?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: okTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: local.boxInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: idx });
			} else {
				this.pushInstruction({ op: "local.get", index: okTmp });
				this.pushInstruction({ op: "local.set", index: idx });
			}
		} else if (okLhs.kind === "Ident" && okLhs.name !== "_") {
			const local = this.resolveLocal(okLhs.name);
			if (local) {
				if (local.isBoxed) {
					this.pushInstruction({ op: "local.get", index: local.index });
					this.pushInstruction({ op: "local.get", index: okTmp });
					this.pushInstruction({
						op: "struct.set",
						typeIndex: local.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: okTmp });
					this.pushInstruction({ op: "local.set", index: local.index });
				}
			} else {
				const global = this.mod.resolveGlobal(okLhs.name);
				this.pushInstruction({ op: "local.get", index: okTmp });
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		this.releaseTemp(valTmp, mapInfo.valWType);
		this.releaseTemp(okTmp, "i32");
	}

	_structNameOf(goType) {
		if (!goType) return null;
		if (goType.kind === "PointerType" || goType.kind === "pointer")
			return this._structNameOf(goType.base);
		if (goType.kind === "StarExpr")
			return this._structNameOf(goType.expr ?? goType.operand);
		return goType.name ?? null;
	}

	_emitTypeTest(targetGoType) {
		if (!targetGoType) {
			this.pushInstruction("drop");
			this.pushInstruction({ op: "i32.const", value: 1 });
			return;
		}

		if (targetGoType.name === "nil" || targetGoType.kind === "nil") {
			this.pushInstruction("ref.is_null");
			return;
		}

		if (targetGoType.name === "any" || targetGoType.name === "interface{}") {
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");
			return;
		}

		if (isNonEmptyInterface(targetGoType, this.mod.checker)) {
			const candidates = this.mod.getTypesImplementingInterface(targetGoType);
			if (candidates.length === 0) {
				this.pushInstruction("drop");
				this.pushInstruction({ op: "i32.const", value: 0 });
				return;
			}
			const anyTmp = this.acquireTemp("anyref");
			this.pushInstruction({ op: "local.set", index: anyTmp });

			this.pushInstruction({ op: "local.get", index: anyTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");

			for (let i = 0; i < candidates.length; i++) {
				this.pushInstruction({ op: "local.get", index: anyTmp });
				this.pushInstruction({
					op: "ref.test",
					typeIndex: candidates[i].typeIndex,
				});
				if (i > 0) {
					this.pushInstruction("i32.or");
				}
			}
			this.pushInstruction("i32.and");
			this.releaseTemp(anyTmp, "anyref");
			return;
		}

		if (isStringType(targetGoType, this.mod.checker)) {
			const isStrIdx = this.mod.getIsStringImportIndex();
			this.pushInstruction({ op: "call", funcIndex: isStrIdx });
			return;
		}

		if (isFuncType(targetGoType, this.mod.checker)) {
			const closureInfo = this.mod.getClosureType(targetGoType);
			this.pushInstruction({
				op: "ref.test",
				typeIndex: closureInfo.typeIndex,
			});
			return;
		}

		// `*T` lives in `any` as the bare struct ref; a `T` value as a boxed
		// clone (see emitExpr).  Fall through to the scalar box for values.
		if (isPointerToStruct(targetGoType, this.mod.checker, this.mod)) {
			const sInfo = this.mod.getStructType(this._structNameOf(targetGoType));
			if (sInfo) {
				this.pushInstruction({ op: "ref.test", typeIndex: sInfo.typeIndex });
				return;
			}
		}

		if (isSliceType(targetGoType, this.mod.checker)) {
			const elem = this._getSliceElemType(targetGoType);
			const sInfo = this.mod.getSliceType(elem);
			if (sInfo) {
				this.pushInstruction({ op: "ref.test", typeIndex: sInfo.typeIndex });
				return;
			}
		}

		if (isArrayType(targetGoType, this.mod.checker)) {
			const elem = this._getArrayElemType(targetGoType);
			const aInfo = this.mod.getArrayType(elem);
			if (aInfo) {
				this.pushInstruction({ op: "ref.test", typeIndex: aInfo.typeIndex });
				return;
			}
		}

		// Scalar types
		const box = this.mod.getBoxType(targetGoType);
		if (box) {
			this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
			return;
		}

		this.pushInstruction("drop");
		this.pushInstruction({ op: "i32.const", value: 1 });
	}

	_emitTypeCast(targetGoType, targetWType) {
		if (isInterfaceType(targetGoType, this.mod.checker)) {
			return;
		}

		if (isStringType(targetGoType, this.mod.checker)) {
			this.pushInstruction("extern.convert_any");
			return;
		}

		if (isFuncType(targetGoType, this.mod.checker)) {
			const closureInfo = this.mod.getClosureType(targetGoType);
			this.pushInstruction({
				op: "ref.cast_null",
				typeIndex: closureInfo.typeIndex,
			});
			return;
		}

		if (isPointerToStruct(targetGoType, this.mod.checker, this.mod)) {
			const sInfo = this.mod.getStructType(this._structNameOf(targetGoType));
			if (sInfo) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: sInfo.typeIndex,
				});
				return;
			}
		}
		if (isStructType(targetGoType, this.mod.checker, this.mod)) {
			const sInfo = this.mod.getStructType(this._structNameOf(targetGoType));
			const box = this.mod.getBoxType(targetGoType);
			if (sInfo && box) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: box.typeIndex,
				});
				this.pushInstruction({
					op: "struct.get",
					typeIndex: box.typeIndex,
					fieldIndex: 0,
				});
				this.emitCloneStruct(sInfo, targetWType);
				return;
			}
		}

		if (isSliceType(targetGoType, this.mod.checker)) {
			const elem = this._getSliceElemType(targetGoType);
			const sInfo = this.mod.getSliceType(elem);
			if (sInfo) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: sInfo.typeIndex,
				});
				return;
			}
		}

		if (isArrayType(targetGoType, this.mod.checker)) {
			const elem = this._getArrayElemType(targetGoType);
			const aInfo = this.mod.getArrayType(elem);
			if (aInfo) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: aInfo.typeIndex,
				});
				return;
			}
		}

		// Scalar types
		const box = this.mod.getBoxType(targetGoType);
		if (box) {
			this.pushInstruction({
				op: "ref.cast_null",
				typeIndex: box.typeIndex,
			});
			this.pushInstruction({
				op: "struct.get",
				typeIndex: box.typeIndex,
				fieldIndex: 0,
			});
			return;
		}
	}

	_emitCompoundAssign(lhs, rhs, op) {
		const baseOp = op.slice(0, -1);
		const l = Array.isArray(lhs) ? lhs[0] : lhs;
		const r = Array.isArray(rhs) ? rhs[0] : rhs;

		if (l.kind === "SelectorExpr") {
			const structInfo = this._resolveStructInfo(l.expr);
			if (!structInfo) {
				throw new Error(
					`Cannot resolve struct for compound selector: ${l.field}`,
				);
			}
			const path = this._resolveFieldPath(structInfo, l.field);
			if (!path) {
				throw new Error(
					`Unknown field '${l.field}' on struct '${structInfo.name}'`,
				);
			}
			const lastStep = path[path.length - 1];
			const targetType = lastStep.field.wType;
			const baseWType = this.toWasmType(l.expr._type);

			const baseTmp = this.acquireTemp(baseWType);
			this.emitExpr(l.expr, baseWType);
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			this.pushInstruction({ op: "local.set", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			this.emitExpr(r, targetType);
			this.emitBinaryOp(baseOp, targetType, l._type);

			this.pushInstruction({
				op: "struct.set",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			this.releaseTemp(baseTmp, baseWType);
			return;
		}

		if (l.kind === "IndexExpr") {
			const baseNode = l.expr;
			const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
			if (isMapType(baseType, this.mod.checker)) {
				const { keyType, valType } = getMapKeyValTypes(
					baseType,
					this.mod.checker,
				);
				const mapInfo = this.mod.getMapType(keyType, valType);
				const mTmp = this.acquireTemp(mapInfo.wType);
				const kTmp = this.acquireTemp(mapInfo.keyWType);
				this.emitExpr(baseNode, mapInfo.wType);
				this.pushInstruction({ op: "local.set", index: mTmp });
				this.emitExpr(l.index, mapInfo.keyWType);
				this.pushInstruction({ op: "local.set", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.getFuncName),
				});

				this.emitExpr(r, mapInfo.valWType);
				this.emitBinaryOp(baseOp, mapInfo.valWType, valType);

				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});

				this.releaseTemp(kTmp, mapInfo.keyWType);
				this.releaseTemp(mTmp, mapInfo.wType);
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = isSlice
				? baseType.elem
				: isPtrToArr
					? baseType.base.elem
					: baseType.elem;
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;
			const targetType = arrInfo.elemWType;
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};

			this._emitElemAddr(baseNode, l.index, sliceInfo, arrInfo);
			const arrTmp = this.acquireTemp(arrWType);
			const targetIdxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: targetIdxTmp });
			this.pushInstruction({ op: "local.tee", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});

			this.emitExpr(r, targetType);
			this.emitBinaryOp(baseOp, targetType, elemGoType);

			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});

			this.releaseTemp(targetIdxTmp, "i32");
			this.releaseTemp(arrTmp, arrWType);
			return;
		}

		if (l.kind !== "Ident") return;

		const localInfo = this.resolveLocal(l.name);
		const globalInfo = !localInfo ? this.mod.resolveGlobal(l.name) : null;
		if (!localInfo && !globalInfo) return;

		if (localInfo?.isBoxed) {
			const boxInfo = localInfo.boxInfo;
			const targetType = boxInfo.wType;
			if (baseOp === "/" || baseOp === "%") {
				const resTmp = this.acquireTemp(targetType);
				this.emitDivRem(baseOp, l, r, targetType);
				this.pushInstruction({ op: "local.set", index: resTmp });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: resTmp });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				this.releaseTemp(resTmp, targetType);
			} else if (baseOp === "<<" || baseOp === ">>") {
				const resTmp = this.acquireTemp(targetType);
				this.emitShift(baseOp, l, r, targetType);
				this.pushInstruction({ op: "local.set", index: resTmp });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: resTmp });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				this.releaseTemp(resTmp, targetType);
			} else {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				this.emitExpr(r, targetType);
				this.emitBinaryOp(baseOp, targetType, l._type);
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
			}
			return;
		}

		const targetType = localInfo ? localInfo.type : globalInfo.type;

		if (baseOp === "/" || baseOp === "%") {
			this.emitDivRem(baseOp, l, r, targetType);
		} else if (baseOp === "<<" || baseOp === ">>") {
			this.emitShift(baseOp, l, r, targetType);
		} else {
			if (localInfo) {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.get", index: globalInfo.index });
			}
			this.emitExpr(r, targetType);
			this.emitBinaryOp(baseOp, targetType, l._type);
		}

		if (localInfo) {
			this.pushInstruction({ op: "local.set", index: localInfo.index });
		} else {
			this.pushInstruction({ op: "global.set", index: globalInfo.index });
		}
	}

	emitIncDecStmt(stmt) {
		const { expr, op } = stmt;

		if (expr.kind === "SelectorExpr") {
			const structInfo = this._resolveStructInfo(expr.expr);
			if (!structInfo) return;
			const path = this._resolveFieldPath(structInfo, expr.field);
			if (!path) return;
			const lastStep = path[path.length - 1];
			const targetType = lastStep.field.wType;
			const baseWType = this.toWasmType(expr.expr._type);

			const baseTmp = this.acquireTemp(baseWType);
			this.emitExpr(expr.expr, baseWType);
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			this.pushInstruction({ op: "local.set", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});

			if (targetType === "i64") {
				this.pushInstruction({ op: "i64.const", value: 1n });
				this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
			} else if (targetType === "f32") {
				this.pushInstruction({ op: "f32.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
			} else if (targetType === "f64") {
				this.pushInstruction({ op: "f64.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
			} else {
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
				this.emitNarrowIntWrap(expr._type);
			}

			this.pushInstruction({
				op: "struct.set",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			this.releaseTemp(baseTmp, baseWType);
			return;
		}

		if (expr.kind === "IndexExpr") {
			const baseNode = expr.expr;
			const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
			if (isMapType(baseType, this.mod.checker)) {
				const { keyType, valType } = getMapKeyValTypes(
					baseType,
					this.mod.checker,
				);
				const mapInfo = this.mod.getMapType(keyType, valType);
				const mTmp = this.acquireTemp(mapInfo.wType);
				const kTmp = this.acquireTemp(mapInfo.keyWType);
				this.emitExpr(baseNode, mapInfo.wType);
				this.pushInstruction({ op: "local.set", index: mTmp });
				this.emitExpr(expr.index, mapInfo.keyWType);
				this.pushInstruction({ op: "local.set", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.getFuncName),
				});

				if (mapInfo.valWType === "i64") {
					this.pushInstruction({ op: "i64.const", value: 1n });
					this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
				} else if (mapInfo.valWType === "f32") {
					this.pushInstruction({ op: "f32.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
				} else if (mapInfo.valWType === "f64") {
					this.pushInstruction({ op: "f64.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
				} else {
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
					this.emitNarrowIntWrap(valType);
				}

				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});

				this.releaseTemp(kTmp, mapInfo.keyWType);
				this.releaseTemp(mTmp, mapInfo.wType);
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = isSlice
				? baseType.elem
				: isPtrToArr
					? baseType.base.elem
					: baseType.elem;
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;
			const targetType = arrInfo.elemWType;
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};

			this._emitElemAddr(baseNode, expr.index, sliceInfo, arrInfo);
			const arrTmp = this.acquireTemp(arrWType);
			const targetIdxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: targetIdxTmp });
			this.pushInstruction({ op: "local.tee", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});

			if (targetType === "i64") {
				this.pushInstruction({ op: "i64.const", value: 1n });
				this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
			} else if (targetType === "f32") {
				this.pushInstruction({ op: "f32.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
			} else if (targetType === "f64") {
				this.pushInstruction({ op: "f64.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
			} else {
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
				this.emitNarrowIntWrap(elemGoType);
			}

			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});

			this.releaseTemp(targetIdxTmp, "i32");
			this.releaseTemp(arrTmp, arrWType);
			return;
		}

		if (expr.kind === "Ident") {
			const localInfo = this.resolveLocal(expr.name);
			const globalInfo = !localInfo ? this.mod.resolveGlobal(expr.name) : null;
			if (!localInfo && !globalInfo) return;

			if (localInfo?.isBoxed) {
				const boxInfo = localInfo.boxInfo;
				const innerWType = boxInfo.wType;
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				if (innerWType === "i64") {
					this.pushInstruction({ op: "i64.const", value: 1n });
					this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
				} else if (innerWType === "f32") {
					this.pushInstruction({ op: "f32.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
				} else if (innerWType === "f64") {
					this.pushInstruction({ op: "f64.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
				} else {
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
					this.emitNarrowIntWrap(localInfo.goType);
				}
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				return;
			}

			const targetType = localInfo ? localInfo.type : globalInfo.type;

			if (localInfo) {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.get", index: globalInfo.index });
			}

			if (targetType === "i64") {
				this.pushInstruction({ op: "i64.const", value: 1n });
				this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
			} else if (targetType === "f32") {
				this.pushInstruction({ op: "f32.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
			} else if (targetType === "f64") {
				this.pushInstruction({ op: "f64.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
			} else {
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
				this.emitNarrowIntWrap(expr._type);
			}

			if (localInfo) {
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.set", index: globalInfo.index });
			}
		}
	}

	emitIfStmt(stmt) {
		if (stmt.init) this.emitStmt(stmt.init);

		this.emitExpr(stmt.cond, "i32");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("if");

		const thenBlock = stmt.body ?? stmt.then;
		if (thenBlock) this.emitBlock(thenBlock);
		const elseBlock = stmt.elseBody ?? stmt.else;
		if (elseBlock) {
			this.pushInstruction("else");
			if (elseBlock.kind === "Block") {
				this.emitBlock(elseBlock);
			} else {
				this.emitStmt(elseBlock);
			}
		}
		this.pushInstruction("end");
	}

	emitRangeForStmt(stmt) {
		const rangeExpr =
			stmt.cond?.kind === "RangeExpr" ? stmt.cond : stmt.init.rhs[0];
		const isAssign = stmt.init?.kind === "AssignStmt";
		const lhs = stmt.init?.lhs ?? [];
		const iterExpr = rangeExpr.expr;
		const iterType = iterExpr._type;

		// `for i := range` shadows any outer `i`; restore the outer binding afterwards.
		const shadowed = isAssign
			? []
			: lhs
					.filter((l) => l && l.name !== "_")
					.map((l) => [l.name, this.locals.get(l.name)]);
		const restoreShadowed = () => {
			for (const [name, prev] of shadowed) {
				if (prev) this.locals.set(name, prev);
				else this.locals.delete(name);
			}
		};

		if (isIntRangeType(iterType)) {
			const limitTmp = this.acquireTemp("i32");
			this._emitIndexExprToI32(iterExpr, limitTmp);

			const idxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: idxTmp });

			let idxLocalInfo = null;
			if (lhs[0] && lhs[0].name !== "_") {
				if (!isAssign) {
					const bodyBlock = stmt.body ?? stmt.block;
					const isNonEscaping =
						!this.mutatedCaptures?.has(lhs[0].name) &&
						!this.capturedNames?.includes(lhs[0].name) &&
						!this._varMutatesOrEscapes(bodyBlock, lhs[0].name);
					const wType = isNonEscaping ? "i32" : "i64";
					const lIdx = this.allocLocal(lhs[0].name, wType, {
						kind: "basic",
						name: "int",
					});
					idxLocalInfo = { index: lIdx, type: wType };
				} else {
					idxLocalInfo =
						this.resolveLocal(lhs[0].name) ??
						this.mod.resolveGlobal(lhs[0].name);
				}
			}

			// Outer block for break
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("break", stmt.label);

			// Middle loop
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushControl("loop", stmt.label);

			// Condition: idx >= limit -> break
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "local.get", index: limitTmp });
			this.pushInstruction("i32.ge_s");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });

			// Inner block for continue
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("continue", stmt.label);

			// Assign loop var if present
			if (idxLocalInfo) {
				this.pushInstruction({ op: "local.get", index: idxTmp });
				if (idxLocalInfo.type === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				if (this.resolveLocal(lhs[0].name)) {
					this.pushInstruction({
						op: "local.set",
						index: idxLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: idxLocalInfo.index,
					});
				}
			}

			// Emit body
			const bodyBlock = stmt.body ?? stmt.block;
			if (bodyBlock) {
				this.emitBlock(bodyBlock);
			}

			// End continue
			this.pushInstruction("end");

			// Post: idx++
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: idxTmp });

			// Loop back
			this.pushInstruction({ op: "br", depth: 0 });

			// End loop
			this.pushInstruction("end");

			// End break
			this.pushInstruction("end");

			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(limitTmp, "i32");
			restoreShadowed();
			return;
		}

		if (isStringType(iterType, this.mod.checker)) {
			const strTmp = this.acquireTemp("externref");
			this.emitExpr(iterExpr, "externref");
			this.pushInstruction({ op: "local.set", index: strTmp });

			const lenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: lenTmp });

			const idxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: idxTmp });

			let idxLocalInfo = null;
			if (lhs[0] && lhs[0].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[0].name, "i64", {
						kind: "basic",
						name: "int",
					});
					idxLocalInfo = { index: lIdx, type: "i64" };
				} else {
					idxLocalInfo =
						this.resolveLocal(lhs[0].name) ??
						this.mod.resolveGlobal(lhs[0].name);
				}
			}

			let valLocalInfo = null;
			if (lhs[1] && lhs[1].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[1].name, "i32", {
						kind: "basic",
						name: "rune",
					});
					valLocalInfo = { index: lIdx, type: "i32" };
				} else {
					valLocalInfo =
						this.resolveLocal(lhs[1].name) ??
						this.mod.resolveGlobal(lhs[1].name);
				}
			}

			// Outer block for break
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("break", stmt.label);

			// Middle loop
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushControl("loop", stmt.label);

			// Condition: idx >= len -> break
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i32.ge_s");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });

			// Inner block for continue
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("continue", stmt.label);

			const runeTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringCodePointAtImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: runeTmp });

			// Assign index variable
			if (idxLocalInfo) {
				this.pushInstruction({ op: "local.get", index: idxTmp });
				this.pushInstruction("i64.extend_i32_s");
				if (this.resolveLocal(lhs[0].name)) {
					this.pushInstruction({
						op: "local.set",
						index: idxLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: idxLocalInfo.index,
					});
				}
			}

			// Assign rune variable
			if (valLocalInfo) {
				this.pushInstruction({ op: "local.get", index: runeTmp });
				if (valLocalInfo.type === "i64") {
					this.pushInstruction("i64.extend_i32_u");
				}
				if (this.resolveLocal(lhs[1].name)) {
					this.pushInstruction({
						op: "local.set",
						index: valLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: valLocalInfo.index,
					});
				}
			}

			// Body
			const bodyBlock = stmt.body ?? stmt.block;
			if (bodyBlock) {
				this.emitBlock(bodyBlock);
			}

			// End continue block
			this.pushInstruction("end");

			// Advance idxTmp: idx += (rune > 0xffff ? 2 : 1)
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "local.get", index: runeTmp });
			this.pushInstruction({ op: "i32.const", value: 65535 });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("else");
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("end");
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: idxTmp });

			// Repeat loop
			this.pushInstruction({ op: "br", depth: 0 });

			// End loop
			this.pushInstruction("end");

			// End break block
			this.pushInstruction("end");

			this.releaseTemp(runeTmp, "i32");
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(strTmp, "externref");
			restoreShadowed();
			return;
		}

		if (isMapType(iterType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(
				iterType,
				this.mod.checker,
			);
			const mapInfo = this.mod.getMapType(keyType, valType);

			const mapTmp = this.acquireTemp(mapInfo.wType);
			this.emitExpr(iterExpr, mapInfo.wType);
			this.pushInstruction({ op: "local.set", index: mapTmp });

			// Outer block for break
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("break", stmt.label);

			// If map is nil: break immediately
			this.pushInstruction({ op: "local.get", index: mapTmp });
			this.pushInstruction("ref.is_null");
			const earlyBreakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: earlyBreakDepth });

			const currIdxTmp = this.acquireTemp("i32");
			const nextIdxTmp = this.acquireTemp("i32");
			const entryTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: mapInfo.entryTypeIndex,
			});

			// currIdx = map.head (field 5)
			this.pushInstruction({ op: "local.get", index: mapTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.typeIndex,
				fieldIndex: 5,
			});
			this.pushInstruction({ op: "local.set", index: currIdxTmp });

			let keyLocalInfo = null;
			if (lhs[0] && lhs[0].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[0].name, mapInfo.keyWType, keyType);
					keyLocalInfo = { index: lIdx, type: mapInfo.keyWType };
				} else {
					keyLocalInfo =
						this.resolveLocal(lhs[0].name) ??
						this.mod.resolveGlobal(lhs[0].name);
				}
			}

			let valLocalInfo = null;
			if (lhs[1] && lhs[1].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[1].name, mapInfo.valWType, valType);
					valLocalInfo = { index: lIdx, type: mapInfo.valWType };
				} else {
					valLocalInfo =
						this.resolveLocal(lhs[1].name) ??
						this.mod.resolveGlobal(lhs[1].name);
				}
			}

			// Loop block
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushControl("loop", stmt.label);

			// Condition: currIdx == -1 -> break
			this.pushInstruction({ op: "local.get", index: currIdxTmp });
			this.pushInstruction({ op: "i32.const", value: -1 });
			this.pushInstruction("i32.eq");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });

			// entry = map.entries[currIdx]
			this.pushInstruction({ op: "local.get", index: mapTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.get", index: currIdxTmp });
			this.pushInstruction({
				op: "array.get",
				typeIndex: mapInfo.entriesTypeIndex,
			});
			this.pushInstruction({ op: "local.set", index: entryTmp });

			// nextIdx = entry.order_next (field 4)
			this.pushInstruction({ op: "local.get", index: entryTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.entryTypeIndex,
				fieldIndex: 4,
			});
			this.pushInstruction({ op: "local.set", index: nextIdxTmp });

			// If entry.active == 0 (field 5): currIdx = nextIdx; br 0 (continue next iteration)
			this.pushInstruction({ op: "local.get", index: entryTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.entryTypeIndex,
				fieldIndex: 5,
			});
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.eq");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: nextIdxTmp });
			this.pushInstruction({ op: "local.set", index: currIdxTmp });
			this.pushInstruction({ op: "br", depth: 1 });
			this.pushInstruction("end");

			// Inner block for continue
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("continue", stmt.label);

			// Assign key variable
			if (keyLocalInfo) {
				this.pushInstruction({ op: "local.get", index: entryTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: mapInfo.entryTypeIndex,
					fieldIndex: 0,
				});
				if (this.resolveLocal(lhs[0].name)) {
					this.pushInstruction({
						op: "local.set",
						index: keyLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: keyLocalInfo.index,
					});
				}
			}

			// Assign val variable
			if (valLocalInfo) {
				this.pushInstruction({ op: "local.get", index: entryTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: mapInfo.entryTypeIndex,
					fieldIndex: 1,
				});
				const isValStruct =
					isStructType(valType, this.mod.checker, this.mod) &&
					!isPointerToStruct(valType, this.mod.checker, this.mod);
				if (isValStruct) {
					const sInfo = this._resolveStructInfo({ _type: valType });
					if (sInfo) {
						this.emitCloneStruct(sInfo, mapInfo.valWType);
					}
				}
				if (this.resolveLocal(lhs[1].name)) {
					this.pushInstruction({
						op: "local.set",
						index: valLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: valLocalInfo.index,
					});
				}
			}

			// Body
			const bodyBlock = stmt.body ?? stmt.block;
			if (bodyBlock) {
				this.emitBlock(bodyBlock);
			}

			// End continue block
			this.pushInstruction("end");

			// Advance: currIdx = nextIdx
			this.pushInstruction({ op: "local.get", index: nextIdxTmp });
			this.pushInstruction({ op: "local.set", index: currIdxTmp });

			// Loop back
			this.pushInstruction({ op: "br", depth: 0 });

			// End loop
			this.pushInstruction("end");

			// End break
			this.pushInstruction("end");

			this.releaseTemp(entryTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: mapInfo.entryTypeIndex,
			});
			this.releaseTemp(nextIdxTmp, "i32");
			this.releaseTemp(currIdxTmp, "i32");
			this.releaseTemp(mapTmp, mapInfo.wType);
			restoreShadowed();
			return;
		}

		// Slice or Array range
		const isSlice = isSliceType(iterType, this.mod.checker);
		const isPtrToArr =
			iterType?.kind === "pointer" &&
			isArrayType(iterType.base, this.mod.checker);

		const elemGoType = isSlice
			? iterType.elem
			: isPtrToArr
				? iterType.base.elem
				: iterType.elem;
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const arrTmp = this.acquireTemp(arrWType);
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");

		if (isSlice) {
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const sliceTmp = this.acquireTemp(sliceWType);
			this.emitExpr(iterExpr, sliceWType);
			this.pushInstruction({ op: "local.set", index: sliceTmp });

			this._emitSliceUnpack(sliceTmp, sliceInfo, {
				arr: arrTmp,
				off: offTmp,
				len: lenTmp,
			});
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			this.emitExpr(iterExpr, arrWType);
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: offTmp });
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("array.len");
			this.pushInstruction({ op: "local.set", index: lenTmp });
		}

		const idxTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: idxTmp });

		let idxLocalInfo = null;
		if (lhs[0] && lhs[0].name !== "_") {
			if (!isAssign) {
				const bodyBlock = stmt.body ?? stmt.block;
				const isNonEscaping =
					!this.mutatedCaptures?.has(lhs[0].name) &&
					!this.capturedNames?.includes(lhs[0].name) &&
					!this._varMutatesOrEscapes(bodyBlock, lhs[0].name);
				const wType = isNonEscaping ? "i32" : "i64";
				const lIdx = this.allocLocal(lhs[0].name, wType, {
					kind: "basic",
					name: "int",
				});
				idxLocalInfo = { index: lIdx, type: wType };
			} else {
				idxLocalInfo =
					this.resolveLocal(lhs[0].name) ?? this.mod.resolveGlobal(lhs[0].name);
			}
		}

		let valLocalInfo = null;
		if (lhs[1] && lhs[1].name !== "_") {
			if (!isAssign) {
				const lIdx = this.allocLocal(
					lhs[1].name,
					arrInfo.elemWType,
					elemGoType,
				);
				valLocalInfo = { index: lIdx, type: arrInfo.elemWType };
			} else {
				valLocalInfo =
					this.resolveLocal(lhs[1].name) ?? this.mod.resolveGlobal(lhs[1].name);
			}
		}

		// Outer block for break
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		// Middle loop
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushControl("loop", stmt.label);

		// Condition: idx >= len -> break
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		const breakDepth = this.resolveBranchDepth(stmt.label, false);
		this.pushInstruction({ op: "br_if", depth: breakDepth });

		// Inner block for continue
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("continue", stmt.label);

		// Assign idx
		if (idxLocalInfo) {
			this.pushInstruction({ op: "local.get", index: idxTmp });
			if (idxLocalInfo.type === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			}
			if (this.resolveLocal(lhs[0].name)) {
				this.pushInstruction({ op: "local.set", index: idxLocalInfo.index });
			} else {
				this.pushInstruction({
					op: "global.set",
					index: idxLocalInfo.index,
				});
			}
		}

		// Assign val
		if (valLocalInfo) {
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});
			if (
				isStructType(elemGoType, this.mod.checker, this.mod) &&
				!isPointerToStruct(elemGoType, this.mod.checker, this.mod)
			) {
				const sInfo = this._resolveStructInfo({ _type: elemGoType });
				if (sInfo) {
					this.emitCloneStruct(sInfo, arrInfo.elemWType);
				}
			}
			if (this.resolveLocal(lhs[1].name)) {
				this.pushInstruction({ op: "local.set", index: valLocalInfo.index });
			} else {
				this.pushInstruction({
					op: "global.set",
					index: valLocalInfo.index,
				});
			}
		}

		// Body
		const bodyBlock = stmt.body ?? stmt.block;
		if (bodyBlock) {
			this.emitBlock(bodyBlock);
		}

		// End continue
		this.pushInstruction("end");

		// Post: idx++
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: idxTmp });

		// Loop back
		this.pushInstruction({ op: "br", depth: 0 });

		// End loop
		this.pushInstruction("end");

		// End break
		this.pushInstruction("end");

		this.releaseTemp(idxTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, arrWType);

		restoreShadowed();
	}

	emitForStmt(stmt) {
		if (isRangeFor(stmt) || stmt.cond?.kind === "RangeExpr") {
			this.emitRangeForStmt(stmt);
			return;
		}

		const iv = this._detectInductionVar(stmt);
		let prevLocal = null;
		let ivLocalInfo = null;

		if (iv) {
			prevLocal = this.locals.get(iv.name);
			const lIdx = this.allocLocal(
				iv.name,
				"i32",
				{ kind: "basic", name: "int" },
				false,
			);
			ivLocalInfo = this.locals.get(iv.name);
			ivLocalInfo.isInductionVar = true;
			this.emitExpr(iv.initExpr, "i32");
			this.pushInstruction({ op: "local.set", index: lIdx });
		} else if (stmt.init) {
			this.emitStmt(stmt.init);
		}

		// Outer block for break
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		// Middle loop for repeating iterations
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushControl("loop", stmt.label);

		if (stmt.cond) {
			this.emitExpr(stmt.cond, "i32");
			this.pushInstruction("i32.eqz");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });
		}

		// Inner block for continue
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("continue", stmt.label);

		const bodyBlock = stmt.body ?? stmt.block;
		if (bodyBlock) {
			this.emitBlock(bodyBlock);
		}

		// End inner continue block
		this.pushInstruction("end");

		if (iv) {
			this.pushInstruction({ op: "local.get", index: ivLocalInfo.index });
			this.pushInstruction({ op: "i32.const", value: iv.step });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: ivLocalInfo.index });
		} else if (stmt.post) {
			this.emitStmt(stmt.post);
		}

		// Repeat loop: branch back to loop block
		this.pushInstruction({ op: "br", depth: 0 });

		// End loop
		this.pushInstruction("end");

		// End outer break block
		this.pushInstruction("end");

		if (iv) {
			if (prevLocal) {
				this.locals.set(iv.name, prevLocal);
			} else {
				this.locals.delete(iv.name);
			}
		}
	}

	_detectInductionVar(stmt) {
		if (stmt.init?.kind !== "DefineStmt") return null;
		const lhs = stmt.init.lhs ?? [];
		if (lhs.length !== 1 || lhs[0].kind !== "Ident") return null;
		const varName = lhs[0].name;
		if (!varName || varName === "_") return null;

		const rhs = stmt.init.rhs ?? [];
		if (rhs.length !== 1) return null;
		const initRhs = rhs[0];

		// Initial value must be a non-negative integer literal < 2^31 or i32 expr
		let initOk = false;
		if (initRhs.kind === "BasicLit" && initRhs.litKind === "INT") {
			const val = BigInt(initRhs.value);
			if (val >= 0n && val < 2147483648n) initOk = true;
		} else if (this.toWasmType(initRhs._type) === "i32") {
			initOk = true;
		}
		if (!initOk) return null;

		// Post statement must increment varName by a constant > 0
		let step = null;
		if (stmt.post) {
			if (
				stmt.post.kind === "IncDecStmt" &&
				stmt.post.expr?.kind === "Ident" &&
				stmt.post.expr.name === varName &&
				stmt.post.op === "++"
			) {
				step = 1;
			} else if (
				stmt.post.kind === "CompoundAssignStmt" &&
				stmt.post.lhs?.length === 1 &&
				stmt.post.lhs[0].kind === "Ident" &&
				stmt.post.lhs[0].name === varName &&
				stmt.post.op === "+=" &&
				stmt.post.rhs?.length === 1 &&
				stmt.post.rhs[0].kind === "BasicLit" &&
				stmt.post.rhs[0].litKind === "INT"
			) {
				const sVal = BigInt(stmt.post.rhs[0].value);
				if (sVal > 0n && sVal < 2147483648n) step = Number(sVal);
			}
		}
		if (step === null) return null;

		// Condition must bound varName (< bound or <= bound) where bound < 2^31
		const boundNode = this._findInductionBound(stmt.cond, varName);
		if (!boundNode) return null;
		// The last `i += step` must not wrap i32: i can reach bound + step - 1.
		if (
			boundNode.kind === "BasicLit" &&
			BigInt(boundNode.value) + BigInt(step) > 2147483647n
		) {
			return null;
		}

		// Check escaping and mutation in body
		if (this.mutatedCaptures?.has(varName)) return null;
		if (this.capturedNames?.includes(varName)) return null;

		const bodyBlock = stmt.body ?? stmt.block;
		if (bodyBlock && this._varMutatesOrEscapes(bodyBlock, varName)) {
			return null;
		}

		return { name: varName, initExpr: initRhs, step };
	}

	_findInductionBound(cond, varName) {
		if (!cond) return null;
		if (cond.kind === "BinaryExpr") {
			if (
				(cond.op === "<" || cond.op === "<=") &&
				cond.left?.kind === "Ident" &&
				cond.left.name === varName
			) {
				const right = cond.right;
				if (
					right?.kind === "CallExpr" &&
					right.func?.kind === "Ident" &&
					(right.func.name === "len" || right.func.name === "cap")
				) {
					return right;
				}
				if (right?.kind === "BasicLit" && right.litKind === "INT") {
					const val = BigInt(right.value);
					if (val >= 0n && val < 2147483648n) return right;
					return null;
				}
				if (this.toWasmType(right?._type) === "i32") {
					return right;
				}
				return null;
			}
			if (cond.op === "&&") {
				return (
					this._findInductionBound(cond.left, varName) ??
					this._findInductionBound(cond.right, varName)
				);
			}
		}
		return null;
	}

	_varMutatesOrEscapes(node, varName) {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) {
			return node.some((item) => this._varMutatesOrEscapes(item, varName));
		}
		if (
			node.kind === "UnaryExpr" &&
			node.op === "&" &&
			node.operand?.kind === "Ident" &&
			node.operand.name === varName
		) {
			return true;
		}
		if (node.kind === "FuncLit") {
			if (this._findIdentInAST(node, varName)) return true;
		}
		if (node.kind === "AssignStmt" || node.kind === "CompoundAssignStmt") {
			const lhs = node.lhs ?? [];
			for (const l of lhs) {
				if (l.kind === "Ident" && l.name === varName) return true;
			}
		}
		if (node.kind === "IncDecStmt") {
			if (node.expr?.kind === "Ident" && node.expr.name === varName)
				return true;
		}
		if (node.kind === "DefineStmt") {
			const lhs = node.lhs ?? [];
			for (const l of lhs) {
				if (l.kind === "Ident" && l.name === varName) return true;
			}
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (this._varMutatesOrEscapes(node[key], varName)) return true;
		}
		return false;
	}

	_findIdentInAST(node, name) {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) {
			return node.some((item) => this._findIdentInAST(item, name));
		}
		if (node.kind === "Ident" && node.name === name) return true;
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (this._findIdentInAST(node[key], name)) return true;
		}
		return false;
	}

	emitSwitchStmt(stmt) {
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		if (stmt.init) this.emitStmt(stmt.init);

		const getCaseVals = (c) => c.list ?? c.values ?? [];

		if (stmt.tag) {
			const tagGoType = stmt.tag._type ?? this._resolveExprGoType(stmt.tag);
			const tagWType = this.toWasmType(tagGoType);
			const tagTmp = this.acquireTemp(tagWType);
			this.emitExpr(stmt.tag, tagWType);
			this.pushInstruction({ op: "local.set", index: tagTmp });

			const nonDefaultCases = (stmt.cases ?? []).filter(
				(c) => getCaseVals(c).length > 0,
			);
			const defaultCase = (stmt.cases ?? []).find(
				(c) => getCaseVals(c).length === 0,
			);

			let ifCount = 0;
			for (const c of nonDefaultCases) {
				const vals = getCaseVals(c);
				for (let i = 0; i < vals.length; i++) {
					this.pushInstruction({ op: "local.get", index: tagTmp });
					this.emitExpr(vals[i], tagWType);
					this.emitBinaryOp("==", tagWType, tagGoType);
					if (i > 0) this.pushInstruction("i32.or");
				}
				this.pushInstruction({ op: "if", blockType: "void" });
				ifCount++;

				for (const s of c.stmts ?? []) this.emitStmt(s);
				this.pushInstruction("else");
			}

			if (defaultCase) {
				for (const s of defaultCase.stmts ?? []) this.emitStmt(s);
			}

			for (let i = 0; i < ifCount; i++) {
				this.pushInstruction("end");
			}
			this.releaseTemp(tagTmp, tagWType);
		} else {
			const nonDefaultCases = (stmt.cases ?? []).filter(
				(c) => getCaseVals(c).length > 0,
			);
			const defaultCase = (stmt.cases ?? []).find(
				(c) => getCaseVals(c).length === 0,
			);

			let ifCount = 0;
			for (const c of nonDefaultCases) {
				const vals = getCaseVals(c);
				for (let i = 0; i < vals.length; i++) {
					this.emitExpr(vals[i], "i32");
					if (i > 0) this.pushInstruction("i32.or");
				}
				this.pushInstruction({ op: "if", blockType: "void" });
				ifCount++;

				for (const s of c.stmts ?? []) this.emitStmt(s);
				this.pushInstruction("else");
			}

			if (defaultCase) {
				for (const s of defaultCase.stmts ?? []) this.emitStmt(s);
			}

			for (let i = 0; i < ifCount; i++) {
				this.pushInstruction("end");
			}
		}

		this.pushInstruction("end");
	}

	emitTypeSwitchStmt(stmt) {
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		const prevAssignLocal = stmt.assign ? this.locals.get(stmt.assign) : null;

		const tswTmp = this.acquireTemp("anyref");
		this.emitExpr(stmt.expr, "anyref");
		this.pushInstruction({ op: "local.set", index: tswTmp });

		const getCaseTypes = (c) => c.types ?? c.list ?? [];

		const nonDefaultCases = (stmt.cases ?? []).filter(
			(c) => getCaseTypes(c).length > 0,
		);
		const defaultCase = (stmt.cases ?? []).find(
			(c) => getCaseTypes(c).length === 0,
		);

		let ifCount = 0;
		for (const c of nonDefaultCases) {
			const types = getCaseTypes(c);
			for (let i = 0; i < types.length; i++) {
				this.pushInstruction({ op: "local.get", index: tswTmp });
				this._emitTypeTest(types[i]._type ?? types[i]);
				if (i > 0) {
					this.pushInstruction("i32.or");
				}
			}
			this.pushInstruction({ op: "if", blockType: "void" });
			ifCount++;

			if (stmt.assign) {
				const targetGoType =
					types.length === 1
						? (types[0]._type ?? types[0])
						: { kind: "basic", name: "any" };
				const targetWType = this.toWasmType(targetGoType);
				const assignLocal = this.allocLocal(
					stmt.assign,
					targetWType,
					targetGoType,
				);
				if (types.length === 1) {
					this.pushInstruction({ op: "local.get", index: tswTmp });
					this._emitTypeCast(targetGoType, targetWType);
				} else {
					this.pushInstruction({ op: "local.get", index: tswTmp });
				}
				this.pushInstruction({ op: "local.set", index: assignLocal });
			}

			for (const s of c.stmts ?? []) {
				this.emitStmt(s);
			}

			this.pushInstruction("else");
		}

		if (defaultCase) {
			if (stmt.assign) {
				const assignLocal = this.allocLocal(stmt.assign, "anyref", {
					kind: "basic",
					name: "any",
				});
				this.pushInstruction({ op: "local.get", index: tswTmp });
				this.pushInstruction({ op: "local.set", index: assignLocal });
			}
			for (const s of defaultCase.stmts ?? []) {
				this.emitStmt(s);
			}
		}

		for (let i = 0; i < ifCount; i++) {
			this.pushInstruction("end");
		}

		this.releaseTemp(tswTmp, "anyref");

		if (prevAssignLocal) {
			this.locals.set(stmt.assign, prevAssignLocal);
		} else if (stmt.assign) {
			this.locals.delete(stmt.assign);
		}

		this.pushInstruction("end");
	}

	emitBranchStmt(stmt) {
		const isContinue = stmt.keyword === "continue";
		const depth = this.resolveBranchDepth(stmt.label, isContinue);
		this.pushInstruction({ op: "br", depth });
	}

	emitReturnStmt(stmt) {
		const values = stmt.values ?? [];
		if (this.hasDefer) {
			if (this.namedReturnVars?.length > 0) {
				if (values.length === 0) {
					// Naked return: named return vars already hold their values
				} else if (values.length === 1 && this.namedReturnVars.length > 1) {
					// Multi-value call: leaves results on stack
					this.emitExpr(values[0]);
					for (let i = this.namedReturnVars.length - 1; i >= 0; i--) {
						this._assignToNamedReturnVar(this.namedReturnVars[i]);
					}
				} else {
					// Evaluate all values into temporary locals first
					const temps = [];
					for (let i = 0; i < values.length; i++) {
						const val = values[i];
						const targetWType = this.returnTypes[i] ?? null;
						this.emitExpr(val, targetWType);
						this._emitCopyIfValueStruct(val, val._type, targetWType);
						const tmp = this.acquireTemp(targetWType);
						this.pushInstruction({ op: "local.set", index: tmp });
						temps.push({ tmp, type: targetWType });
					}
					for (let i = 0; i < temps.length; i++) {
						this.pushInstruction({ op: "local.get", index: temps[i].tmp });
						this._assignToNamedReturnVar(this.namedReturnVars[i]);
						this.releaseTemp(temps[i].tmp, temps[i].type);
					}
				}
			} else if (this.returnTempLocals?.length > 0) {
				if (values.length === 1 && this.returnTempLocals.length > 1) {
					this.emitExpr(values[0]);
					for (let i = this.returnTempLocals.length - 1; i >= 0; i--) {
						this.pushInstruction({
							op: "local.set",
							index: this.returnTempLocals[i],
						});
					}
				} else {
					for (let i = 0; i < values.length; i++) {
						const val = values[i];
						const targetWType = this.returnTypes[i] ?? null;
						this.emitExpr(val, targetWType);
						this._emitCopyIfValueStruct(val, val._type, targetWType);
						this.pushInstruction({
							op: "local.set",
							index: this.returnTempLocals[i],
						});
					}
				}
			}
			const depth = this.resolveBranchDepthToRole("runDefers");
			this.pushInstruction({ op: "br", depth });
			return;
		}

		if (values.length === 0 && this.namedReturnVars?.length > 0) {
			for (const nr of this.namedReturnVars) {
				const loc = this.locals.get(nr.name);
				if (loc.isBoxed) {
					this.pushInstruction({ op: "local.get", index: loc.index });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: loc.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: loc.index });
				}
			}
			this.pushInstruction("return");
			return;
		}

		for (let i = 0; i < values.length; i++) {
			const val = values[i];
			const targetWType = this.returnTypes[i] ?? null;
			this.emitExpr(val, targetWType);
			this._emitCopyIfValueStruct(val, val._type, targetWType);
		}
		this.pushInstruction("return");
	}

	_assignToNamedReturnVar(nr) {
		const loc = this.locals.get(nr.name);
		if (loc.isBoxed) {
			const valTmp = this.acquireTemp(loc.boxInfo.wType);
			this.pushInstruction({ op: "local.set", index: valTmp });
			this.pushInstruction({ op: "local.get", index: loc.index });
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: loc.boxInfo.typeIndex,
				fieldIndex: 0,
			});
			this.releaseTemp(valTmp, loc.boxInfo.wType);
		} else {
			this.pushInstruction({ op: "local.set", index: loc.index });
		}
	}

	emitExprStmt(stmt) {
		this.emitExpr(stmt.expr);
		const goType = stmt.expr._type;
		if (!goType || goType.name === "void") return;
		if (goType.kind === "tuple" || goType.kind === "TupleType") {
			for (const _ of goType.types ?? []) {
				this.pushInstruction("drop");
			}
			return;
		}
		const wType = this.toWasmType(goType);
		if (wType) {
			this.pushInstruction("drop");
		}
	}
}
