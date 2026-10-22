// src/backend/wasm/emit-stmts.js
// FunctionEmitter mixin: statement emission (decls, assignment, control flow, return).

import { loopVarsCapturedInLoop } from "../../lower/captures.js";
import { rootIdentName } from "../../lower/ownership.js";
import {
	getOrCreateIteratorFuncLit,
	isIntRangeType,
	isIteratorRangeFor,
	isRangeFor,
} from "../../lower/range.js";
import { someChild } from "../../lower/walk.js";
import {
	getMapKeyValTypes,
	isArrayType,
	isComplex,
	isComplex64,
	isFuncType,
	isInterfaceType,
	isMapType,
	isNonEmptyInterface,
	isPointerToStruct,
	isScalarType,
	isSliceType,
	isStringType,
	isStructType,
} from "./types.js";

function hasReturnInBlock(n) {
	let found = false;
	const check = (x) => {
		if (!x || typeof x !== "object" || found) return;
		if (Array.isArray(x)) {
			for (const elem of x) check(elem);
			return;
		}
		if (x.kind === "ReturnStmt") {
			found = true;
			return;
		}
		if (x.kind === "FuncLit" && !x._isYieldClosure) return;
		for (const k of Object.keys(x)) {
			if (k.startsWith("_")) continue;
			check(x[k]);
		}
	};
	check(n);
	return found;
}

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
					this._emitCopyIfValue(r, rawType, wType);
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

		const rhsVals = this._parallelAssignValues(lhsNodes, rhsNodes, true);
		for (let i = 0; i < lhsNodes.length; i++) {
			this._emitDefineSingle(lhsNodes[i], rhsVals[i]);
		}
		this._releaseParallelTemps(rhsVals, rhsNodes);
	}

	_emitDefineSingle(l, r) {
		if (!r || l.kind !== "Ident") return;
		if (l.name === "_") {
			this.emitExpr(r);
			this.pushInstruction("drop");
			return;
		}
		if (l._redecl && this.resolveLocal(l.name)) {
			this._emitAssignSingle(l, r, "=");
			return;
		}
		const wType = this.toWasmType(r._type);
		// The value is computed before the new name exists: `x := x * 2`
		// in an inner block reads the outer `x`.
		this.emitExpr(r, wType);
		if (!this._arrayCopyElidable(r, l.name))
			this._emitCopyIfValue(r, r._type, wType);
		const idx = this.allocLocal(l.name, wType, r._type);
		const localInfo = this.locals.get(l.name);
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

		const rhsVals = this._parallelAssignValues(lhsNodes, rhsNodes);
		for (let i = 0; i < lhsNodes.length; i++) {
			this._emitAssignSingle(lhsNodes[i], rhsVals[i], op);
		}
		this._releaseParallelTemps(rhsVals, rhsNodes);
	}

	// `x, y = y, x`: Go evaluates every right-hand side before assigning.
	// When a later value could see an earlier assignment, every value that
	// is not pure is stored in a temporary first (in source order, so side
	// effects keep their order).  Pure values stay inline, so `i, n = 0,
	// len(xs)` is unchanged.  A definition only exposes its redeclared
	// names: a new name is not visible to the values being assigned to it.
	_parallelAssignValues(lhsNodes, rhsNodes, define = false) {
		if (lhsNodes.length < 2 || rhsNodes.length !== lhsNodes.length)
			return rhsNodes;
		const roots = new Set(
			lhsNodes.map((l) => rootIdentName(l)).filter((n) => n && n !== "_"),
		);
		const pure = rhsNodes.map((r) => this._independentOf(r, roots));
		const redecl = lhsNodes.some((l) => l._redecl);
		const observes = (r, i) =>
			define ? this._mentions(r, roots) || (redecl && !pure[i]) : !pure[i];
		if (!rhsNodes.some((r, i) => i > 0 && observes(r, i))) return rhsNodes;
		const inPlace = lhsNodes.some((l) => this._isInPlaceArrayStore(l));
		return rhsNodes.map((r, i) => {
			if (pure[i]) return r;
			const goType = r._type ?? this._resolveExprGoType(r);
			const wType = this.toWasmType(goType);
			const name = `__par_tmp_${this.tempCounter++}`;
			const idx = this.allocLocal(name, wType, goType, true);
			this.emitExpr(r, wType);
			// An array temp must snapshot the value when a target is stored in
			// place (`a, b = b, a` with `p := &a`): the store would otherwise
			// change what the temp holds.  The snapshot is already a fresh
			// copy, so assigning from the temp does not copy it again.
			const snapshot =
				inPlace &&
				this._isValueArray(goType) &&
				!this._arrayCopyElidable(r, null);
			if (snapshot) this._emitCopyIfValue(r, goType, wType);
			this.pushInstruction({ op: "local.set", index: idx });
			return {
				kind: "Ident",
				name,
				_type: goType,
				_parTmp: true,
				_freshArray: snapshot,
			};
		});
	}

	// True when assigning to `l` writes into an existing array object (so an
	// earlier-read array value sharing that object would see the write): a
	// boxed (address-taken) array local, `*p` on an array pointer, or an
	// element of an array.
	_isInPlaceArrayStore(l) {
		if (l.kind === "Ident") {
			const info = this.resolveLocal(l.name);
			return !!info?.isBoxed && this._isValueArray(info.goType);
		}
		if ((l.kind === "UnaryExpr" && l.op === "*") || l.kind === "StarExpr") {
			const t = (l.operand ?? l.expr)?._type;
			return this._isValueArray(t?.base ?? t);
		}
		if (l.kind === "IndexExpr") {
			const t = l.expr._type ?? this._resolveExprGoType(l.expr);
			return (
				this._isValueArray(t) ||
				(t?.kind === "pointer" && this._isValueArray(t.base))
			);
		}
		return false;
	}

	_mentions(node, names) {
		if (!node || typeof node !== "object") return false;
		if (node.kind === "Ident" && names.has(node.name)) return true;
		return someChild(node, (child) => this._mentions(child, names));
	}

	_releaseParallelTemps(rhsVals, rhsNodes) {
		if (rhsVals === rhsNodes) return;
		for (const r of rhsVals) if (r?._parTmp) this.locals.delete(r.name);
	}

	// True when evaluating `node` cannot observe an assignment to `roots`
	// (or through a pointer) and has no side effects.
	_independentOf(node, roots) {
		if (!node || typeof node !== "object") return true;
		switch (node.kind) {
			case "BasicLit":
				return true;
			case "Ident":
				return this._independentIdent(node, roots);
			case "BinaryExpr":
				return (
					this._independentOf(node.left, roots) &&
					this._independentOf(node.right, roots)
				);
			case "UnaryExpr":
				return (
					node.op !== "*" &&
					node.op !== "&" &&
					this._independentOf(node.operand, roots)
				);
			case "CallExpr":
				return this._isPureLenCall(node, roots);
			default:
				return false;
		}
	}

	_independentIdent(node, roots) {
		if (node._const || node.name === "nil") return true;
		if (roots.has(node.name)) return false;
		const local = this.resolveLocal(node.name);
		return !!local && !local.isBoxed;
	}

	// `len`/`cap` of a pure operand.
	_isPureLenCall(node, roots) {
		const fn = node.func;
		if (fn?.kind !== "Ident" || (fn.name !== "len" && fn.name !== "cap"))
			return false;
		if (this.resolveLocal(fn.name) || node.args?.length !== 1) return false;
		return this._independentOf(node.args[0], roots);
	}

	_emitAssignToTarget(target, wasmType, goType, emitValue) {
		const tempName = `__assign_tmp_${this.tempCounter++}`;
		const effectiveGoType = goType ??
			target._type ?? {
				kind: "basic",
				name: wasmType === "i64" ? "int64" : "int",
			};
		const effectiveWasmType = wasmType ?? this.toWasmType(effectiveGoType);
		const tempIdx = this.allocLocal(
			tempName,
			effectiveWasmType,
			effectiveGoType,
			true,
		);
		emitValue();
		this.pushInstruction({ op: "local.set", index: tempIdx });
		const rNode = {
			kind: "Ident",
			name: tempName,
			_type: effectiveGoType,
		};
		this._emitAssignSingle(target, rNode, "=");
		this.locals.delete(tempName);
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
				if (localInfo.isBoxed && this._isValueArray(localInfo.goType)) {
					// Pointers to the array (`&a`) hold its reference: write in place.
					this._emitArrayStoreInto(localInfo.goType, r, () => {
						this.pushInstruction({ op: "local.get", index: localInfo.index });
						this.pushInstruction({
							op: "struct.get",
							typeIndex: localInfo.boxInfo.typeIndex,
							fieldIndex: 0,
						});
					});
					return;
				}
				if (localInfo.isBoxed) {
					this.pushInstruction({ op: "local.get", index: localInfo.index });
					this.emitExpr(r, localInfo.boxInfo.wType);
					if (isArrayType(localInfo.goType, this.mod.checker))
						this._emitCopyIfValue(r, localInfo.goType, localInfo.boxInfo.wType);
					this.pushInstruction({
						op: "struct.set",
						typeIndex: localInfo.boxInfo.typeIndex,
						fieldIndex: 0,
					});
					return;
				}
				this.emitExpr(r, localInfo.type);
				if (!this._arrayCopyElidable(r, l.name))
					this._emitCopyIfValue(r, localInfo.goType, localInfo.type);
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				const globalInfo = this.mod.resolveGlobal(l.name);
				if (globalInfo) {
					this.emitExpr(r, globalInfo.type);
					this._emitCopyIfValue(r, globalInfo.goType, globalInfo.type);
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
			const exprGoType =
				l.expr._type ??
				this.resolveLocal(l.expr.name)?.goType ??
				this._resolveExprGoType(l.expr);
			const baseWType = this.toWasmType(exprGoType);

			this.emitExpr(l.expr, baseWType);
			this._emitNilCheck(exprGoType);
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			this.emitExpr(r, lastStep.field.wType);
			this._emitCopyIfValue(r, lastStep.field.goType, lastStep.field.wType);
			this.pushInstruction({
				op: "struct.set",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			return;
		}

		if ((l.kind === "UnaryExpr" && l.op === "*") || l.kind === "StarExpr") {
			this._emitDerefAssign(l, r);
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
				this._emitCopyIfValue(r, valType, mapInfo.valWType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});
				return;
			}

			const sharedInfo = this._sharedInfo(baseType);
			if (sharedInfo) {
				this.emitSharedIndexAssign(l, r, sharedInfo);
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = this._getArrayElemType(
				isPtrToArr ? baseType.base : baseType,
			);
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

			this._emitElemAddr(baseNode, l.index, sliceInfo, arrInfo);

			this.emitExpr(r, arrInfo.elemWType);
			this._emitCopyIfValue(r, elemGoType, arrInfo.elemWType);

			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});
			return;
		}
	}

	// A range variable that a closure captures and mutates lives in a box,
	// but the loop writes the plain value each iteration.  It gets a raw
	// local here, and `_emitRangeBoxes` (at the top of the body) wraps the
	// value in a fresh box per iteration, so each iteration's closures keep
	// their own variable (Go 1.22) and the loop never stores a raw value
	// into a box local.
	_allocRangeVar(name, wType, goType) {
		if (!this.mutatedCaptures.has(name))
			return this.allocLocal(name, wType, goType);
		const idx = this.allocLocal(name, wType, goType, true);
		if (!this._pendingRangeBoxes) this._pendingRangeBoxes = [];
		this._pendingRangeBoxes.push({ name, idx, wType, goType });
		return idx;
	}

	_emitRangeBoxes() {
		const pending = this._pendingRangeBoxes ?? [];
		this._pendingRangeBoxes = [];
		for (const { name, idx, wType, goType } of pending) {
			const boxIdx = this.allocLocal(name, wType, goType);
			const info = this.locals.get(name);
			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: info.boxInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: boxIdx });
		}
	}

	// The struct that holds the last field of `path`: a promoted field
	// (`o.N` on an embedded `Inner`) lives on the embedded struct.
	_fieldHolderWType(path, baseWType) {
		if (path.length <= 1) return baseWType;
		const holder = path[path.length - 1].structInfo;
		return { kind: "ref", nullable: true, typeIndex: holder.typeIndex };
	}

	// Copy the array value `r` into the existing array that `emitDst` pushes,
	// so every pointer to that array sees the new elements.
	_emitArrayStoreInto(goType, r, emitDst) {
		const arrInfo = this.mod.getArrayType(this._getArrayElemType(goType));
		const wType = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const dst = this.acquireTemp(wType);
		emitDst();
		this.pushInstruction({ op: "local.tee", index: dst });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.emitExpr(r, wType);
		this._emitCopyIfValue(r, goType, wType);
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction("array.len");
		this.pushInstruction({
			op: "array.copy",
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(dst, wType);
	}

	_emitStructDerefAssign(operand, r, structInfo) {
		const baseWType = this.toWasmType(operand._type);
		const tmpL = this.acquireTemp(baseWType);
		const tmpR = this.acquireTemp(baseWType);
		this.emitExpr(operand, baseWType);
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
	}

	_emitDerefAssign(l, r) {
		const operand = l.operand ?? l.expr;
		const structInfo = this._resolveStructInfo(operand);
		if (structInfo) {
			this._emitStructDerefAssign(operand, r, structInfo);
			return;
		}
		const operandGoType =
			operand._type ??
			(operand.kind === "Ident"
				? this.resolveLocal(operand.name)?.goType
				: null) ??
			this._resolveExprGoType(operand);
		const baseGoType = operandGoType?.base ?? operandGoType;
		if (this._isValueArray(baseGoType)) {
			this._emitArrayStoreInto(baseGoType, r, () => {
				this.emitExpr(operand);
				this._emitNilCheck(operandGoType);
			});
			return;
		}
		if (!isScalarType(baseGoType, this.mod.checker, this.mod)) {
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
		const ptrTmp = this.acquireTemp(ptrWType);
		const valTmp = this.acquireTemp(box.wType);
		this.emitExpr(operand, ptrWType);
		this.pushInstruction({ op: "local.set", index: ptrTmp });
		this.emitExpr(r, box.wType);
		this.pushInstruction({ op: "local.set", index: valTmp });

		this.pushInstruction({ op: "local.get", index: ptrTmp });
		this.pushInstruction({
			op: "ref.test",
			typeIndex: box.typeIndex,
			typeName: box.name,
		});
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: ptrTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: box.typeIndex,
			typeName: box.name,
		});
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: box.typeIndex,
			typeName: box.name,
			fieldIndex: 0,
		});
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: ptrTmp });
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
		this.pushInstruction({ op: "local.get", index: ptrTmp });
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
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({ op: "local.get", index: ptrTmp });
		this.pushInstruction({
			op: "ref.cast",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: acc.typeIndex,
			typeName: acc.name,
			fieldIndex: 3,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: acc.setFuncTypeIndex,
		});
		this.pushInstruction("end");

		this.releaseTemp(valTmp, box.wType);
		this.releaseTemp(ptrTmp, ptrWType);
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

		this._emitStoreLhsFromTemp(
			valLhs,
			valTmp,
			targetWType,
			targetGoType,
			isDefine,
		);
		this._emitStoreLhsFromTemp(
			okLhs,
			okTmp,
			"i32",
			{ kind: "basic", name: "bool" },
			isDefine,
		);

		this.releaseTemp(valTmp, targetWType);
		this.releaseTemp(okTmp, "i32");
	}

	// Pushes a comma-ok result (map value / asserted value).  An array is a
	// value: the stored one must not alias the map entry or boxed interface.
	_emitGetTempValue(tempIdx, goType) {
		this.pushInstruction({ op: "local.get", index: tempIdx });
		if (goType?.kind !== "pointer" && isArrayType(goType, this.mod.checker))
			this.emitCopyArray(goType);
	}

	_emitStoreLhsFromTemp(lhsNode, tempIdx, wType, goType, isDefine) {
		if (lhsNode.kind !== "Ident" || lhsNode.name === "_") return;
		if (isDefine) {
			const idx = this.allocLocal(lhsNode.name, wType, goType);
			const local = this.locals.get(lhsNode.name);
			this._emitGetTempValue(tempIdx, goType);
			if (local?.isBoxed) {
				this.pushInstruction({
					op: "struct.new",
					typeIndex: local.boxInfo.typeIndex,
				});
			}
			this.pushInstruction({ op: "local.set", index: idx });
			return;
		}
		const local = this.resolveLocal(lhsNode.name);
		if (local) {
			if (local.isBoxed) {
				this.pushInstruction({ op: "local.get", index: local.index });
				this._emitGetTempValue(tempIdx, goType);
				this.pushInstruction({
					op: "struct.set",
					typeIndex: local.boxInfo.typeIndex,
					fieldIndex: 0,
				});
			} else {
				this._emitGetTempValue(tempIdx, goType);
				this.pushInstruction({ op: "local.set", index: local.index });
			}
		} else {
			const global = this.mod.resolveGlobal(lhsNode.name);
			this._emitGetTempValue(tempIdx, goType);
			this.pushInstruction({ op: "global.set", index: global.index });
		}
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

		this._emitStoreLhsFromTemp(
			valLhs,
			valTmp,
			mapInfo.valWType,
			valType,
			isDefine,
		);
		this._emitStoreLhsFromTemp(
			okLhs,
			okTmp,
			"i32",
			{ kind: "basic", name: "bool" },
			isDefine,
		);

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
		const box = this.mod.getIfaceBoxType(targetGoType);
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
			const box = this.mod.getIfaceBoxType(targetGoType);
			if (sInfo && box) {
				this._emitUnbox(box);
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
		const box = this.mod.getIfaceBoxType(targetGoType);
		if (box) {
			this._emitUnbox(box);
			return;
		}
	}

	_emitUnbox(box) {
		this.pushInstruction({
			op: "ref.cast_null",
			typeIndex: box.typeIndex,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: box.typeIndex,
			fieldIndex: 0,
		});
	}

	_emitCompoundAssign(lhs, rhs, op) {
		const baseOp = op.slice(0, -1);
		const l = Array.isArray(lhs) ? lhs[0] : lhs;
		const r = Array.isArray(rhs) ? rhs[0] : rhs;

		if (isComplex(l._type)) {
			const synthBinary = {
				kind: "BinaryExpr",
				op: baseOp,
				left: l,
				right: r,
				_type: l._type,
			};
			const is64 = isComplex64(l._type);
			const info = this.mod.getComplexType(is64 ? "complex64" : "complex128");
			const cWType = {
				kind: "ref",
				nullable: true,
				typeIndex: info.typeIndex,
				typeName: info.name,
			};
			if (l.kind === "Ident") {
				const localInfo = this.resolveLocal(l.name);
				const globalInfo = !localInfo ? this.mod.resolveGlobal(l.name) : null;
				if (localInfo?.isBoxed) {
					this.pushInstruction({ op: "local.get", index: localInfo.index });
					this.emitComplexBinary(synthBinary, cWType);
					this.pushInstruction({
						op: "struct.set",
						typeIndex: localInfo.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else if (localInfo) {
					this.emitComplexBinary(synthBinary, cWType);
					this.pushInstruction({ op: "local.set", index: localInfo.index });
				} else if (globalInfo) {
					this.emitComplexBinary(synthBinary, cWType);
					this.pushInstruction({ op: "global.set", index: globalInfo.index });
				}
				return;
			}
		}

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
			const holderWType = this._fieldHolderWType(path, baseWType);

			const baseTmp = this.acquireTemp(holderWType);
			this.emitExpr(l.expr, baseWType);
			this._emitNilCheck(l.expr._type);
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
			this.releaseTemp(baseTmp, holderWType);
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

			const sharedInfo = this._sharedInfo(baseType);
			if (sharedInfo) {
				this.emitSharedIndexUpdate(l, sharedInfo, (elemW, elemGoType) => {
					this.emitExpr(r, elemW);
					this.emitBinaryOp(baseOp, elemW, elemGoType);
				});
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = this._getArrayElemType(
				isPtrToArr ? baseType.base : baseType,
			);
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

		if ((l.kind === "UnaryExpr" && l.op === "*") || l.kind === "StarExpr") {
			const operand = l.operand ?? l.expr;
			const operandGoType =
				operand._type ??
				(operand.kind === "Ident"
					? this.resolveLocal(operand.name)?.goType
					: null) ??
				this._resolveExprGoType(operand);
			const baseGoType = operandGoType?.base ?? operandGoType;
			if (!isScalarType(baseGoType, this.mod.checker, this.mod)) return;
			const box = this.mod.getBoxType(baseGoType);
			const ptr = this.mod.getPtrType(baseGoType);
			const acc = this.mod.getAccType(baseGoType);
			if (box && ptr && acc) {
				const ptrWType = {
					kind: "ref",
					nullable: true,
					typeIndex: ptr.typeIndex,
					typeName: ptr.name,
				};
				const targetType = box.wType;
				const ptrTmp = this.acquireTemp(ptrWType);
				this.emitExpr(operand, ptrWType);
				this.pushInstruction({ op: "local.set", index: ptrTmp });

				this.pushInstruction({ op: "local.get", index: ptrTmp });
				this.pushInstruction({
					op: "ref.test",
					typeIndex: box.typeIndex,
					typeName: box.name,
				});
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: ptrTmp });
				this.pushInstruction({
					op: "ref.cast",
					typeIndex: box.typeIndex,
					typeName: box.name,
				});
				this.pushInstruction({ op: "local.get", index: ptrTmp });
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
				this.emitExpr(r, targetType);
				this.emitBinaryOp(baseOp, targetType, l._type ?? baseGoType);
				this.pushInstruction({
					op: "struct.set",
					typeIndex: box.typeIndex,
					typeName: box.name,
					fieldIndex: 0,
				});

				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: ptrTmp });
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
				this.pushInstruction({ op: "local.get", index: ptrTmp });
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
				this.pushInstruction({ op: "local.get", index: ptrTmp });
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
				this.pushInstruction({ op: "local.get", index: ptrTmp });
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
				this.pushInstruction({ op: "local.get", index: ptrTmp });
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
				this.emitExpr(r, targetType);
				this.emitBinaryOp(baseOp, targetType, l._type ?? baseGoType);
				this.pushInstruction({ op: "local.get", index: ptrTmp });
				this.pushInstruction({
					op: "ref.cast",
					typeIndex: acc.typeIndex,
					typeName: acc.name,
				});
				this.pushInstruction({
					op: "struct.get",
					typeIndex: acc.typeIndex,
					typeName: acc.name,
					fieldIndex: 3,
				});
				this.pushInstruction({
					op: "call_ref",
					typeIndex: acc.setFuncTypeIndex,
				});
				this.pushInstruction("end");

				this.releaseTemp(ptrTmp, ptrWType);
				return;
			}
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

		if (
			(expr.kind === "UnaryExpr" && expr.op === "*") ||
			expr.kind === "StarExpr"
		) {
			const operand = expr.operand ?? expr.expr;
			const structInfo = this._resolveStructInfo(operand);
			if (!structInfo) {
				const operandGoType =
					operand._type ??
					(operand.kind === "Ident"
						? this.resolveLocal(operand.name)?.goType
						: null) ??
					this._resolveExprGoType(operand);
				const baseGoType = operandGoType?.base ?? operandGoType;
				if (!isScalarType(baseGoType, this.mod.checker, this.mod)) return;
				const box = this.mod.getBoxType(baseGoType);
				const ptr = this.mod.getPtrType(baseGoType);
				const acc = this.mod.getAccType(baseGoType);
				if (box && ptr && acc) {
					const ptrWType = {
						kind: "ref",
						nullable: true,
						typeIndex: ptr.typeIndex,
						typeName: ptr.name,
					};
					const ptrTmp = this.acquireTemp(ptrWType);
					this.emitExpr(operand, ptrWType);
					this.pushInstruction({ op: "local.set", index: ptrTmp });

					this.pushInstruction({ op: "local.get", index: ptrTmp });
					this.pushInstruction({
						op: "ref.test",
						typeIndex: box.typeIndex,
						typeName: box.name,
					});
					this.pushInstruction({ op: "if", blockType: "void" });
					this.pushInstruction({ op: "local.get", index: ptrTmp });
					this.pushInstruction({
						op: "ref.cast",
						typeIndex: box.typeIndex,
						typeName: box.name,
					});
					this.pushInstruction({ op: "local.get", index: ptrTmp });
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
					this._emitIncDecStep(op, box.wType, baseGoType);
					this.pushInstruction({
						op: "struct.set",
						typeIndex: box.typeIndex,
						typeName: box.name,
						fieldIndex: 0,
					});

					this.pushInstruction("else");
					this.pushInstruction({ op: "local.get", index: ptrTmp });
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
					this.pushInstruction({ op: "local.get", index: ptrTmp });
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
					this.pushInstruction({ op: "local.get", index: ptrTmp });
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
					this.pushInstruction({ op: "local.get", index: ptrTmp });
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
					this.pushInstruction({ op: "local.get", index: ptrTmp });
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
					this._emitIncDecStep(op, box.wType, baseGoType);
					this.pushInstruction({ op: "local.get", index: ptrTmp });
					this.pushInstruction({
						op: "ref.cast",
						typeIndex: acc.typeIndex,
						typeName: acc.name,
					});
					this.pushInstruction({
						op: "struct.get",
						typeIndex: acc.typeIndex,
						typeName: acc.name,
						fieldIndex: 3,
					});
					this.pushInstruction({
						op: "call_ref",
						typeIndex: acc.setFuncTypeIndex,
					});
					this.pushInstruction("end");

					this.releaseTemp(ptrTmp, ptrWType);
					return;
				}
			}
		}

		if (expr.kind === "SelectorExpr") {
			const structInfo = this._resolveStructInfo(expr.expr);
			if (!structInfo) return;
			const path = this._resolveFieldPath(structInfo, expr.field);
			if (!path) return;
			const lastStep = path[path.length - 1];
			const targetType = lastStep.field.wType;
			const baseWType = this.toWasmType(expr.expr._type);
			const holderWType = this._fieldHolderWType(path, baseWType);

			const baseTmp = this.acquireTemp(holderWType);
			this.emitExpr(expr.expr, baseWType);
			this._emitNilCheck(expr.expr._type);
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

			this._emitIncDecStep(op, targetType, expr._type);

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

				this._emitIncDecStep(op, mapInfo.valWType, valType);

				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});

				this.releaseTemp(kTmp, mapInfo.keyWType);
				this.releaseTemp(mTmp, mapInfo.wType);
				return;
			}

			const sharedInfo = this._sharedInfo(baseType);
			if (sharedInfo) {
				this.emitSharedIndexUpdate(expr, sharedInfo, (elemW) => {
					if (elemW === "f32" || elemW === "f64") {
						this.pushInstruction({ op: `${elemW}.const`, value: 1.0 });
					} else {
						this.pushInstruction({ op: "i32.const", value: 1 });
					}
					this.pushInstruction(`${elemW}.${op === "++" ? "add" : "sub"}`);
				});
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = this._getArrayElemType(
				isPtrToArr ? baseType.base : baseType,
			);
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

			this._emitIncDecStep(op, targetType, elemGoType);

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
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				this._emitIncDecStep(op, boxInfo.wType, localInfo.goType);
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

			this._emitIncDecStep(op, targetType, expr._type);

			if (localInfo) {
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.set", index: globalInfo.index });
			}
		}
	}

	_emitIncDecStep(op, targetType, goType) {
		const isAdd = op === "++";
		if (targetType === "i64") {
			this.pushInstruction({ op: "i64.const", value: 1n });
			this.pushInstruction(isAdd ? "i64.add" : "i64.sub");
		} else if (targetType === "f32" || targetType === "f64") {
			this.pushInstruction({ op: `${targetType}.const`, value: 1.0 });
			this.pushInstruction(`${targetType}.${isAdd ? "add" : "sub"}`);
		} else {
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction(isAdd ? "i32.add" : "i32.sub");
			this.emitNarrowIntWrap(goType);
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
					const lIdx = this._allocRangeVar(lhs[0].name, wType, {
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
				this._emitRangeBoxes();
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
					const lIdx = this._allocRangeVar(lhs[0].name, "i64", {
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
					const lIdx = this._allocRangeVar(lhs[1].name, "i32", {
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
				this._emitRangeBoxes();
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
					const lIdx = this._allocRangeVar(
						lhs[0].name,
						mapInfo.keyWType,
						keyType,
					);
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
					const lIdx = this._allocRangeVar(
						lhs[1].name,
						mapInfo.valWType,
						valType,
					);
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
				} else if (
					valType?.kind !== "pointer" &&
					isArrayType(valType, this.mod.checker)
				) {
					this.emitCopyArray(valType);
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
				this._emitRangeBoxes();
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

		const sharedInfo = this._sharedInfo(iterType);
		if (sharedInfo) {
			this._emitSharedRange(stmt, iterExpr, sharedInfo, lhs, isAssign);
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
			: this._getArrayElemType(isPtrToArr ? iterType.base : iterType);
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const hasVal = Boolean(lhs[1] && lhs[1].name !== "_");
		const arrTmp = hasVal ? this.acquireTemp(arrWType) : null;
		const offTmp = hasVal ? this.acquireTemp("i32") : null;
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

			if (hasVal) {
				this._emitSliceUnpack(sliceTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
				});
			} else {
				this._emitSliceUnpack(sliceTmp, sliceInfo, {
					len: lenTmp,
				});
			}
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			this.emitExpr(iterExpr, arrWType);
			// Go ranges over a copy of an array (the range expression is
			// evaluated once), so body writes to the array do not reach `v`.
			if (hasVal && !isPtrToArr && !this._arrayCopyElidable(iterExpr, null))
				this._emitCopyIfValue(iterExpr, iterType, arrWType);
			if (hasVal) {
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: offTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
			}
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
				const lIdx = this._allocRangeVar(lhs[0].name, wType, {
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
				const lIdx = this._allocRangeVar(
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
			} else if (
				elemGoType?.kind !== "pointer" &&
				isArrayType(elemGoType, this.mod.checker)
			) {
				this.emitCopyArray(elemGoType);
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
			this._emitRangeBoxes();
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
		if (offTmp !== null) this.releaseTemp(offTmp, "i32");
		if (arrTmp !== null) this.releaseTemp(arrTmp, arrWType);

		restoreShadowed();
	}

	_initIterState(stmt) {
		if (!stmt._iterStateName) return;
		let stateLoc = this.resolveLocal(stmt._iterStateName);
		if (!stateLoc) {
			this.allocLocal(stmt._iterStateName, "i64", {
				kind: "basic",
				name: "int",
			});
			stateLoc = this.resolveLocal(stmt._iterStateName);
		}
		if (stateLoc?.isBoxed) {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: stateLoc.boxInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: stateLoc.index });
		}
	}

	_emitIteratorRange(stmt, rangeExpr) {
		const funcLit = getOrCreateIteratorFuncLit(stmt);
		const iterExpr = rangeExpr.expr;
		const iterType = this._resolveExprGoType(iterExpr) ?? iterExpr._type;
		const iterInfo = this.mod.getClosureType(iterType);
		const iterWType = {
			kind: "ref",
			nullable: true,
			typeIndex: iterInfo.typeIndex,
		};

		this._initIterState(stmt);

		const iterTmp = this.acquireTemp(iterWType);
		this.emitExpr(iterExpr, iterWType);
		this.pushInstruction({ op: "local.set", index: iterTmp });

		const yieldClosureInfo = this.mod.getClosureType(funcLit._type ?? funcLit);
		const yieldClosureWType = {
			kind: "ref",
			nullable: true,
			typeIndex: yieldClosureInfo.typeIndex,
		};
		const yieldTmp = this.acquireTemp(yieldClosureWType);
		this.emitFuncLit(funcLit);
		this.pushInstruction({ op: "local.set", index: yieldTmp });

		// Outer block for break
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		// Push env of iterTmp (param 0)
		this.pushInstruction({ op: "local.get", index: iterTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: iterInfo.typeIndex,
			fieldIndex: 1,
		});

		// Push yield callback closure (param 1)
		this.pushInstruction({ op: "local.get", index: yieldTmp });

		// Push funcref of iterTmp
		this.pushInstruction({ op: "local.get", index: iterTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: iterInfo.typeIndex,
			fieldIndex: 0,
		});

		// Call iterator via call_ref
		this.pushInstruction({
			op: "call_ref",
			typeIndex: iterInfo.funcTypeIndex,
		});

		// If iterator returned any values, drop them
		for (let i = 0; i < (iterInfo.returnWTypes?.length ?? 0); i++) {
			this.pushInstruction("drop");
		}

		this.pushInstruction("end");

		this.releaseTemp(yieldTmp, yieldClosureWType);
		this.releaseTemp(iterTmp, iterWType);

		this._emitIteratorUnwind(stmt);
	}

	emitForStmt(stmt) {
		if (isIteratorRangeFor(stmt)) {
			const rangeExpr =
				stmt.cond?.kind === "RangeExpr" ? stmt.cond : stmt.init.rhs[0];
			this._emitIteratorRange(stmt, rangeExpr);
			return;
		}
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

		this._emitPerIterationBoxes(stmt);

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

	// Go 1.22 per-iteration loop variables.  For each three-clause `for`
	// variable that a closure in this loop captures, give the next iteration a
	// fresh copy before the post statement: closures created in this
	// iteration keep their own variable, the post statement (and the next
	// iteration) work on the new one, which starts from the current value.
	// A boxed scalar gets a new box; a value struct or array (a ref) is also
	// cloned.  Uncaptured variables stay plain locals with no allocation.
	_emitPerIterationBoxes(stmt) {
		for (const name of loopVarsCapturedInLoop(stmt)) {
			const info = this.locals.get(name);
			if (!info) continue;
			const goType = info.goType;
			const cloneValue = (wType) => {
				if (goType?.kind === "pointer") return;
				if (isArrayType(goType, this.mod.checker)) {
					this.emitCopyArray(goType);
				} else if (isStructType(goType, this.mod.checker, this.mod)) {
					const sInfo = this._resolveStructInfo({ _type: goType });
					if (sInfo) this.emitCloneStruct(sInfo, wType);
				}
			};
			this.pushInstruction({ op: "local.get", index: info.index });
			if (info.isBoxed) {
				this.pushInstruction({
					op: "struct.get",
					typeIndex: info.boxInfo.typeIndex,
					fieldIndex: 0,
				});
				cloneValue(info.boxInfo.wType);
				this.pushInstruction({
					op: "struct.new",
					typeIndex: info.boxInfo.typeIndex,
				});
			} else {
				cloneValue(info.type);
			}
			this.pushInstruction({ op: "local.set", index: info.index });
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
		const nonDefaultCases = (stmt.cases ?? []).filter(
			(c) => getCaseVals(c).length > 0,
		);
		const defaultCase = (stmt.cases ?? []).find(
			(c) => getCaseVals(c).length === 0,
		);

		let tagGoType = null;
		let tagWType = null;
		let tagTmp = -1;
		if (stmt.tag) {
			tagGoType = stmt.tag._type ?? this._resolveExprGoType(stmt.tag);
			tagWType = this.toWasmType(tagGoType);
			tagTmp = this.acquireTemp(tagWType);
			this.emitExpr(stmt.tag, tagWType);
			this.pushInstruction({ op: "local.set", index: tagTmp });
		}

		let ifCount = 0;
		for (const c of nonDefaultCases) {
			const vals = getCaseVals(c);
			for (let i = 0; i < vals.length; i++) {
				if (stmt.tag) {
					this.pushInstruction({ op: "local.get", index: tagTmp });
					this.emitExpr(vals[i], tagWType);
					this.emitBinaryOp("==", tagWType, tagGoType);
				} else {
					this.emitExpr(vals[i], "i32");
				}
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
		if (stmt.tag) {
			this.releaseTemp(tagTmp, tagWType);
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
					// The bound array is a copy of the boxed value.
					if (
						targetGoType?.kind !== "pointer" &&
						isArrayType(targetGoType, this.mod.checker)
					)
						this.emitCopyArray(targetGoType);
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

	_propagateYieldExit(tag) {
		if (this.funcDecl._iterStateName) {
			const outerLoc = this.resolveLocal(this.funcDecl._iterStateName);
			if (outerLoc?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: outerLoc.index });
				this.pushInstruction({ op: "i64.const", value: tag });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: outerLoc.boxInfo.typeIndex,
					fieldIndex: 0,
				});
			}
		}
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "return" });
	}

	_unwindIteratorReturn() {
		if (this.funcDecl._isYieldClosure) {
			this._propagateYieldExit(2n);
			return;
		}
		if (this.hasDefer) {
			const depth = this.resolveBranchDepthToRole("runDefers");
			this.pushInstruction({ op: "br", depth });
			return;
		}
		const rootNamed = this.funcDecl.returnType?._namedReturns ?? [];
		for (const nr of rootNamed) {
			const loc = this.locals.get(nr.name);
			if (loc?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: loc.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: loc.boxInfo.typeIndex,
					fieldIndex: 0,
				});
			} else if (loc) {
				this.pushInstruction({ op: "local.get", index: loc.index });
			}
		}
		this.pushInstruction({ op: "return" });
	}

	_unwindIteratorTargets(stmt, stateTmp, labelTargets) {
		for (const target of labelTargets) {
			this.pushInstruction({ op: "local.get", index: stateTmp });
			this.pushInstruction({ op: "i64.const", value: BigInt(target.tag) });
			this.pushInstruction("i64.eq");
			this.pushInstruction({ op: "if", blockType: "void" });
			if (target.role !== "break" || stmt.label !== target.label) {
				if (this.funcDecl._isYieldClosure) {
					this._propagateYieldExit(BigInt(target.tag));
				} else {
					const depth = this.resolveBranchDepth(
						target.label,
						target.role === "continue",
					);
					this.pushInstruction({ op: "br", depth });
				}
			}
			this.pushInstruction("end");
		}
	}

	_emitIteratorUnwind(stmt) {
		if (!stmt._iterStateName) return;
		const stateLoc = this.resolveLocal(stmt._iterStateName);
		if (!stateLoc?.isBoxed) return;

		const funcLit = getOrCreateIteratorFuncLit(stmt);
		const hasRet = hasReturnInBlock(funcLit?.body);
		const labelTargets = Array.from(
			this.rootFuncDecl?._labelTargets?.values() ?? [],
		);
		if (!hasRet && labelTargets.length === 0) return;

		const stateTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: stateLoc.index });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: stateLoc.boxInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: stateTmp });

		if (hasRet) {
			this.pushInstruction({ op: "local.get", index: stateTmp });
			this.pushInstruction({ op: "i64.const", value: 2n });
			this.pushInstruction("i64.eq");
			this.pushInstruction({ op: "if", blockType: "void" });
			this._unwindIteratorReturn();
			this.pushInstruction("end");
		}

		this._unwindIteratorTargets(stmt, stateTmp, labelTargets);
		this.releaseTemp(stateTmp, "i64");
	}

	_tryEmitYieldBranch(stmt) {
		if (!this.funcDecl._isYieldClosure) return false;
		const isContinue = stmt.keyword === "continue";
		const targetRole = isContinue ? "continue" : "break";
		const hasInnerTarget = this.controlStack.some((c) =>
			stmt.label
				? c.label === stmt.label && c.role === targetRole
				: c.role === targetRole,
		);
		if (hasInnerTarget) return false;

		if (!stmt.label) {
			if (stmt.keyword === "break") {
				this._propagateYieldExit(1n);
				return true;
			}
			if (stmt.keyword === "continue") {
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction({ op: "return" });
				return true;
			}
			return false;
		}

		if (
			stmt.keyword === "continue" &&
			stmt.label === this.funcDecl._forStmt?.label
		) {
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "return" });
			return true;
		}

		const target = this._findLabelTarget(stmt.label, targetRole);
		const tag = target ? BigInt(target.tag) : 1n;
		this._propagateYieldExit(tag);
		return true;
	}

	_emitYieldReturn(stmt) {
		const values = stmt.values ?? [];
		const rootNamed = this.rootFuncDecl?.returnType?._namedReturns ?? [];
		if (values.length === 1 && rootNamed.length > 1) {
			this.emitExpr(values[0]);
			for (let i = rootNamed.length - 1; i >= 0; i--) {
				this._assignToNamedReturnVar(rootNamed[i]);
			}
		} else if (values.length > 0 && rootNamed.length > 0) {
			const temps = [];
			for (let i = 0; i < values.length; i++) {
				const val = values[i];
				const nr = rootNamed[i];
				const targetWType = this.toWasmType(nr?.type ?? val._type);
				this.emitExpr(val, targetWType);
				this._emitCopyIfValue(val, val._type, targetWType);
				const tmp = this.acquireTemp(targetWType);
				this.pushInstruction({ op: "local.set", index: tmp });
				temps.push({ tmp, type: targetWType });
			}
			for (let i = 0; i < temps.length; i++) {
				this.pushInstruction({ op: "local.get", index: temps[i].tmp });
				this._assignToNamedReturnVar(rootNamed[i]);
				this.releaseTemp(temps[i].tmp, temps[i].type);
			}
		}

		if (this.funcDecl._iterStateName) {
			const stateLoc = this.resolveLocal(this.funcDecl._iterStateName);
			if (stateLoc?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: stateLoc.index });
				this.pushInstruction({ op: "i64.const", value: 2n });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: stateLoc.boxInfo.typeIndex,
					fieldIndex: 0,
				});
			}
		}
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "return" });
	}

	emitBranchStmt(stmt) {
		if (this._tryEmitYieldBranch(stmt)) return;
		const isContinue = stmt.keyword === "continue";
		const depth = this.resolveBranchDepth(stmt.label, isContinue);
		this.pushInstruction({ op: "br", depth });
	}

	emitReturnStmt(stmt) {
		if (this.funcDecl._isYieldClosure) {
			this._emitYieldReturn(stmt);
			return;
		}
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
						this._emitCopyIfValue(val, val._type, targetWType);
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
						this._emitCopyIfValue(val, val._type, targetWType);
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
			this._emitCopyIfValue(val, val._type, targetWType);
		}
		this.pushInstruction("return");
	}

	_assignToNamedReturnVar(nr) {
		if (!nr?.name || nr.name === "_") {
			this.pushInstruction("drop");
			return;
		}
		const loc = this.locals.get(nr.name);
		if (!loc) {
			this.pushInstruction("drop");
			return;
		}
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
