// src/backend/wasm/emit.js
// AST statements and expressions -> WebAssembly instructions.

import { isIntRangeType, isRangeFor } from "../../lower/range.js";
import {
	isAnyType,
	isArrayType,
	isFuncType,
	isPointerToStruct,
	isSigned,
	isSliceType,
	isStringType,
	isStructType,
	toWasmType,
} from "./types.js";

export class FunctionEmitter {
	constructor(moduleEmitter, funcDecl, funcIndex) {
		this.mod = moduleEmitter;
		this.funcDecl = funcDecl;
		this.funcIndex = funcIndex;

		this.rootFuncDecl = this.funcDecl._rootFuncDecl ?? this.funcDecl;
		// Methods are normalized into synthetic FuncDecls; lower() keyed on the original MethodDecl.
		this.captureAnalysis =
			this.mod.lowerResult?.captures?.get(
				this.rootFuncDecl._sourceDecl ?? this.rootFuncDecl,
			) ?? null;
		this.mutatedCaptures = this.captureAnalysis?.mutatedCaptures ?? new Set();

		this.capturedNames = this.funcDecl._funcLit
			? Array.from(
					this.captureAnalysis?.capturesByClosure?.get(
						this.funcDecl._funcLit,
					) ?? [],
				).sort()
			: [];

		this.locals = new Map(); // name -> { index, type, goType, isParam, isBoxed, boxInfo }
		this.localTypes = []; // list of additional local types (beyond params)
		this.controlStack = []; // stack of { type: 'block'|'loop', label: string }
		this.body = []; // emitted instructions

		this.tempCounter = 0;

		this.returnTypes = [];
		if (this.funcDecl.returnType) {
			if (
				this.funcDecl.returnType.kind === "TupleType" ||
				this.funcDecl.returnType.kind === "tuple"
			) {
				for (const t of this.funcDecl.returnType.types) {
					const wt = this.toWasmType(t);
					if (wt) this.returnTypes.push(wt);
				}
			} else {
				const wt = this.toWasmType(this.funcDecl.returnType);
				if (wt) this.returnTypes.push(wt);
			}
		}

		this._initParams();
	}

	emitFunctionBody(body) {
		if (
			this.funcDecl._isClosure &&
			!this.funcDecl._isTrampoline &&
			this.capturedNames.length > 0
		) {
			this._unpackClosureEnv();
		}

		this._boxMutatedParams();

		this.emitBlock(body);
	}

	_findCapturedVarGoType(name) {
		for (const p of this.rootFuncDecl.params ?? []) {
			if (p.name === name) return p.type;
		}
		if (this.rootFuncDecl.recvName === name) {
			return this.rootFuncDecl.recvType;
		}
		for (const r of this.rootFuncDecl.returnType?._namedReturns ?? []) {
			if (r.name === name) return r.type;
		}
		const found = this._findGoTypeInAST(this.rootFuncDecl.body, name);
		if (found) return found;
		const global = this.mod.resolveGlobal(name);
		if (global?.goType) return global.goType;
		return { kind: "basic", name: "int" };
	}

	_findGoTypeInAST(node, varName) {
		if (!node || typeof node !== "object") return null;
		if (Array.isArray(node)) {
			for (const item of node) {
				const t = this._findGoTypeInAST(item, varName);
				if (t) return t;
			}
			return null;
		}
		if (node.kind === "VarDecl" || node.kind === "ConstDecl") {
			for (const spec of node.decls ?? node.specs ?? [node]) {
				const names = spec.names ?? (spec.name ? [spec.name] : []);
				const idx = names.indexOf(varName);
				if (idx !== -1) {
					if (spec.type) return spec.type;
					if (spec.value?.[idx]?._type) return spec.value[idx]._type;
					if (spec.init?.[idx]?._type) return spec.init[idx]._type;
				}
			}
		}
		if (node.kind === "DefineStmt") {
			const lhs = node.lhs ?? [];
			for (let i = 0; i < lhs.length; i++) {
				if (lhs[i].name === varName) {
					if (lhs[i]._type) return lhs[i]._type;
					if (node.rhs?.[i]?._type) return node.rhs[i]._type;
				}
			}
		}
		if (node.kind === "Ident" && node.name === varName && node._type) {
			return node._type;
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			const t = this._findGoTypeInAST(node[key], varName);
			if (t) return t;
		}
		return null;
	}

	_unpackClosureEnv() {
		const envFields = [];
		for (const name of this.capturedNames) {
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
		this.envInfo = envInfo;
		this.envFields = envFields;

		const envCastTmp = this.allocLocal(
			null,
			{
				kind: "ref",
				nullable: true,
				typeIndex: envInfo.typeIndex,
			},
			null,
			true,
		);

		this.pushInstruction({ op: "local.get", index: 0 }); // __env
		this.pushInstruction({
			op: "ref.cast_null",
			typeIndex: envInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: envCastTmp });

		for (let i = 0; i < envFields.length; i++) {
			const f = envFields[i];
			const locIdx = this.allocLocal(f.name, f.wType, f.goType, true);
			this.pushInstruction({ op: "local.get", index: envCastTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: envInfo.typeIndex,
				fieldIndex: i,
			});
			this.pushInstruction({ op: "local.set", index: locIdx });

			this.locals.set(f.name, {
				index: locIdx,
				type: f.wType,
				goType: f.goType,
				isParam: false,
				isBoxed: f.isBoxed,
				boxInfo: f.boxInfo,
			});
		}
	}

	_boxMutatedParams() {
		for (const param of this.funcDecl.params ?? []) {
			if (
				param.name &&
				param.name !== "_" &&
				param.name !== "__env" &&
				this.mutatedCaptures.has(param.name)
			) {
				const pInfo = this.locals.get(param.name);
				if (!pInfo || pInfo.isBoxed) continue;
				const boxInfo = this.mod.getBoxType(pInfo.goType);
				const boxWType = {
					kind: "ref",
					nullable: true,
					typeIndex: boxInfo.typeIndex,
				};
				const boxLocalIdx = this.allocLocal(null, boxWType, pInfo.goType, true);

				this.pushInstruction({ op: "local.get", index: pInfo.index });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: boxInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: boxLocalIdx });

				this.locals.set(param.name, {
					index: boxLocalIdx,
					type: boxWType,
					goType: pInfo.goType,
					isParam: false,
					isBoxed: true,
					boxInfo,
				});
			}
		}
	}

	toWasmType(t) {
		return toWasmType(t, this.mod.checker, this.mod);
	}

	_initParams() {
		for (const param of this.funcDecl.params ?? []) {
			const wType = this.toWasmType(param.type);
			const idx = this.locals.size;
			this.locals.set(param.name, {
				index: idx,
				type: wType,
				goType: param.type,
				isParam: true,
				isBoxed: false,
			});
		}
	}

	allocLocal(name, wasmType, goType = null, forceRaw = false) {
		const isMutatedCapture =
			!forceRaw &&
			Boolean(name && name !== "_" && this.mutatedCaptures.has(name));
		let finalWasmType = wasmType;
		let boxInfo = null;

		if (isMutatedCapture) {
			boxInfo = this.mod.getBoxType(goType ?? { kind: "basic", name: "int" });
			finalWasmType = {
				kind: "ref",
				nullable: true,
				typeIndex: boxInfo.typeIndex,
			};
		}

		const idx = (this.funcDecl.params?.length ?? 0) + this.localTypes.length;
		this.localTypes.push(finalWasmType);
		if (name && name !== "_") {
			this.locals.set(name, {
				index: idx,
				type: finalWasmType,
				goType,
				isParam: false,
				isBoxed: isMutatedCapture,
				boxInfo,
			});
		}
		return idx;
	}

	_resolveStructInfo(expr) {
		if (!expr) return null;
		let t = expr._type;
		if (!t && expr.kind === "Ident") {
			const local = this.resolveLocal(expr.name);
			if (local) t = local.goType;
		}
		if (!t) return null;
		while (
			t.kind === "pointer" ||
			t.kind === "PointerType" ||
			t.kind === "StarExpr"
		) {
			t = t.base ?? t.expr ?? t.operand;
		}
		const name = t.name ?? (t.kind === "named" ? t.name : null);
		if (name && this.mod.structTypes.has(name)) {
			return this.mod.structTypes.get(name);
		}
		if (t.kind === "TypeName" || t.kind === "Ident") {
			if (this.mod.structTypes.has(t.name))
				return this.mod.structTypes.get(t.name);
		}
		return null;
	}

	_resolveFieldPath(structInfo, fieldName) {
		if (!structInfo) return null;
		if (structInfo.fieldIndexMap.has(fieldName)) {
			const idx = structInfo.fieldIndexMap.get(fieldName);
			return [{ structInfo, fieldIndex: idx, field: structInfo.fields[idx] }];
		}
		for (const embed of structInfo.embeds) {
			const embedInfo = this.mod.structTypes.get(embed.name);
			if (embedInfo) {
				const sub = this._resolveFieldPath(embedInfo, fieldName);
				if (sub) {
					return [
						{
							structInfo,
							fieldIndex: embed.fieldIndex,
							field: structInfo.fields[embed.fieldIndex],
						},
						...sub,
					];
				}
			}
		}
		return null;
	}

	_emitNilCheck(wType) {
		const tmp = this.acquireTemp(wType);
		this.pushInstruction({ op: "local.tee", index: tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(
			"runtime error: invalid memory address or nil pointer dereference",
		);
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: tmp });
		this.releaseTemp(tmp, wType);
	}

	emitCloneStruct(structInfo, baseWType) {
		const tmp = this.acquireTemp(baseWType);
		this.pushInstruction({ op: "local.set", index: tmp });
		for (let i = 0; i < structInfo.fields.length; i++) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: i,
			});
		}
		this.pushInstruction({
			op: "struct.new",
			typeIndex: structInfo.typeIndex,
		});
		this.releaseTemp(tmp, baseWType);
	}

	_getReceiverTypeName(recvType, node = null) {
		if (recvType) {
			let t = recvType;
			while (t.kind === "pointer") t = t.base;
			if (t.name) return t.name;
			if (t.kind === "named") return t.name;
			if (t.kind === "TypeName" || t.kind === "Ident") return t.name;
		}
		if (node && node.kind === "Ident") {
			const loc = this.resolveLocal(node.name);
			if (loc?.goType) {
				return this._getReceiverTypeName(loc.goType);
			}
		}
		return null;
	}

	_getArraySize(t, defaultSize = 0) {
		if (!t) return defaultSize;
		if (typeof t.size === "number") return t.size;
		if (t.size?.value !== undefined) return Number(t.size.value);
		if (typeof t.len === "number") return t.len;
		if (t.len?.value !== undefined) return Number(t.len.value);
		if (t.underlying) return this._getArraySize(t.underlying, defaultSize);
		return defaultSize;
	}

	emitZeroValue(goType, wType) {
		if (wType === "i32") {
			this.pushInstruction({ op: "i32.const", value: 0 });
		} else if (wType === "i64") {
			this.pushInstruction({ op: "i64.const", value: 0n });
		} else if (wType === "f32") {
			this.pushInstruction({ op: "f32.const", value: 0.0 });
		} else if (wType === "f64") {
			this.pushInstruction({ op: "f64.const", value: 0.0 });
		} else if (
			typeof wType === "object" &&
			wType !== null &&
			wType.kind === "ref"
		) {
			if (
				goType &&
				goType.kind !== "pointer" &&
				isStructType(goType, this.mod.checker)
			) {
				const sName =
					goType.name ?? (goType.kind === "named" ? goType.name : null);
				const structInfo = this.mod.getStructType(sName);
				if (structInfo) {
					for (const f of structInfo.fields) {
						this.emitZeroValue(f.goType, f.wType);
					}
					this.pushInstruction({
						op: "struct.new",
						typeIndex: structInfo.typeIndex,
					});
					return;
				}
			}
			if (
				goType &&
				goType.kind !== "pointer" &&
				isArrayType(goType, this.mod.checker)
			) {
				const elemType = goType.elem;
				const arrInfo = this.mod.getArrayType(elemType);
				const size = this._getArraySize(goType);
				if (isStructType(elemType, this.mod.checker, this.mod)) {
					for (let i = 0; i < size; i++) {
						this.emitZeroValue(elemType, arrInfo.elemWType);
					}
					this.pushInstruction({
						op: "array.new_fixed",
						typeIndex: arrInfo.typeIndex,
						size,
					});
				} else {
					this.pushInstruction({ op: "i32.const", value: size });
					this.pushInstruction({
						op: "array.new_default",
						typeIndex: arrInfo.typeIndex,
					});
				}
				return;
			}
			this.pushInstruction({
				op: "ref.null",
				heapType: wType.typeIndex ?? "any",
			});
		} else if (
			wType === "externref" ||
			isStringType(goType, this.mod?.checker)
		) {
			const strIdx = this.mod.internString("");
			const funcIdx = this.mod.getStringImportIndex();
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
		} else if (wType === "anyref") {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		} else {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
	}

	allocTemp(wasmType) {
		return this.acquireTemp(wasmType);
	}

	acquireTemp(wasmType) {
		if (!this.freeTemps) this.freeTemps = new Map();
		const list = this.freeTemps.get(wasmType);
		if (list && list.length > 0) {
			return list.pop();
		}
		return this.allocLocal(null, wasmType);
	}

	releaseTemp(idx, wasmType) {
		if (!this.freeTemps) this.freeTemps = new Map();
		let list = this.freeTemps.get(wasmType);
		if (!list) {
			list = [];
			this.freeTemps.set(wasmType, list);
		}
		list.push(idx);
	}

	resolveLocal(name) {
		return this.locals.get(name) ?? null;
	}

	pushInstruction(inst) {
		this.body.push(typeof inst === "string" ? { op: inst } : inst);
	}

	// ── Control Stack ──────────────────────────────────────────

	pushControl(role, label = null) {
		this.controlStack.push({ role, label });
	}

	popControl() {
		return this.controlStack.pop();
	}

	resolveBranchDepth(targetLabel, isContinue = false) {
		const targetRole = isContinue ? "continue" : "break";
		if (!targetLabel) {
			// Innermost break or continue
			for (let i = this.controlStack.length - 1; i >= 0; i--) {
				const ctrl = this.controlStack[i];
				if (ctrl.role === targetRole) {
					return this.controlStack.length - 1 - i;
				}
			}
			return 0;
		}

		for (let i = this.controlStack.length - 1; i >= 0; i--) {
			const ctrl = this.controlStack[i];
			if (ctrl.label === targetLabel && ctrl.role === targetRole) {
				return this.controlStack.length - 1 - i;
			}
		}
		return 0;
	}

	// ── Statements ─────────────────────────────────────────────

	emitBlock(block) {
		for (const stmt of block.stmts ?? []) {
			this.emitStmt(stmt);
		}
	}

	emitStmt(stmt) {
		if (!stmt) return;
		switch (stmt.kind) {
			case "Block":
				this.emitBlock(stmt);
				break;

			case "VarDecl":
				this.emitVarDecl(stmt);
				break;

			case "DefineStmt":
				this.emitDefineStmt(stmt);
				break;

			case "AssignStmt":
				this.emitAssignStmt(stmt);
				break;

			case "IncDecStmt":
				this.emitIncDecStmt(stmt);
				break;

			case "IfStmt":
				this.emitIfStmt(stmt);
				break;

			case "ForStmt":
				this.emitForStmt(stmt);
				break;

			case "ReturnStmt":
				this.emitReturnStmt(stmt);
				break;

			case "BranchStmt":
				this.emitBranchStmt(stmt);
				break;

			case "ExprStmt":
				this.emitExprStmt(stmt);
				break;

			case "LabeledStmt":
				if (stmt.body) {
					if (stmt.body.kind === "ForStmt") {
						stmt.body.label = stmt.label;
					}
					this.emitStmt(stmt.body);
				}
				break;

			case "SwitchStmt":
				this.emitSwitchStmt(stmt);
				break;

			case "TypeSwitchStmt":
				this.emitTypeSwitchStmt(stmt);
				break;

			default:
				// ignore comments or unsupported stmts
				break;
		}
	}

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
					const isValStruct =
						isStructType(rawType, this.mod.checker, this.mod) &&
						!isPointerToStruct(rawType, this.mod.checker, this.mod);
					const isFresh =
						r.kind === "CompositeLit" ||
						(r.kind === "UnaryExpr" && r.op === "*");
					this.emitExpr(r, wType);
					if (isValStruct && !isFresh) {
						const sInfo =
							this._resolveStructInfo(r) ??
							this.mod.getStructType(rawType?.name);
						if (sInfo) {
							this.emitCloneStruct(sInfo, wType);
						}
					}
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
		const isValStruct =
			isStructType(r._type, this.mod.checker, this.mod) &&
			!isPointerToStruct(r._type, this.mod.checker, this.mod);
		const isFresh =
			r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");
		this.emitExpr(r, wType);
		if (isValStruct && !isFresh) {
			const sInfo = this._resolveStructInfo(r);
			if (sInfo) {
				this.emitCloneStruct(sInfo, wType);
			}
		}
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
				const idx = this.allocLocal(l.name, wType, r._type);
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
				const isValStruct =
					isStructType(localInfo.goType, this.mod.checker, this.mod) &&
					!isPointerToStruct(localInfo.goType, this.mod.checker, this.mod);
				const isFresh =
					r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");
				this.emitExpr(r, localInfo.type);
				if (isValStruct && !isFresh) {
					const sInfo =
						this._resolveStructInfo(r) ?? this._resolveStructInfo(l);
					if (sInfo) {
						this.emitCloneStruct(sInfo, localInfo.type);
					}
				}
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				const globalInfo = this.mod.resolveGlobal(l.name);
				if (globalInfo) {
					const isValStruct =
						isStructType(globalInfo.goType, this.mod.checker, this.mod) &&
						!isPointerToStruct(globalInfo.goType, this.mod.checker, this.mod);
					const isFresh =
						r.kind === "CompositeLit" ||
						(r.kind === "UnaryExpr" && r.op === "*");
					this.emitExpr(r, globalInfo.type);
					if (isValStruct && !isFresh) {
						const sInfo =
							this._resolveStructInfo(r) ?? this._resolveStructInfo(l);
						if (sInfo) {
							this.emitCloneStruct(sInfo, globalInfo.type);
						}
					}
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
			if (l.expr._type?.kind === "pointer") {
				this._emitNilCheck(baseWType);
			}
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			const isValStruct =
				isStructType(lastStep.field.goType, this.mod.checker, this.mod) &&
				!isPointerToStruct(lastStep.field.goType, this.mod.checker, this.mod);
			const isFresh =
				r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");
			this.emitExpr(r, lastStep.field.wType);
			if (isValStruct && !isFresh) {
				const sInfo =
					this._resolveStructInfo(r) ??
					this.mod.getStructType(lastStep.field.goType?.name);
				if (sInfo) {
					this.emitCloneStruct(sInfo, lastStep.field.wType);
				}
			}
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
				this._emitNilCheck(baseWType);
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
			this._emitNilCheck(baseWType);
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
			const baseType = baseNode._type;
			const isSlice = isSliceType(baseType, this.mod.checker);
			const isArr = isArrayType(baseType, this.mod.checker);
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

			const arrTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");

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
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: offTmp });
				this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.set", index: offTmp });
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction("end");
				this.releaseTemp(sliceTmp, sliceWType);
			} else {
				const arrWType = {
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				};
				this.emitExpr(baseNode, arrWType);
				if (isPtrToArr) {
					this._emitNilCheck(arrWType);
				}
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction("array.len");
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: offTmp });
			}

			const idxTmp = this.acquireTemp("i32");
			this._emitIndexValAndBoundsCheck(l.index, lenTmp, idxTmp);

			const targetIdxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: targetIdxTmp });

			const isValStruct =
				isStructType(elemGoType, this.mod.checker, this.mod) &&
				!isPointerToStruct(elemGoType, this.mod.checker, this.mod);
			const isFresh =
				r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");

			const valTmp = this.acquireTemp(arrInfo.elemWType);
			this.emitExpr(r, arrInfo.elemWType);
			if (isValStruct && !isFresh) {
				const sInfo = this._resolveStructInfo(r) ?? this._resolveStructInfo(l);
				if (sInfo) {
					this.emitCloneStruct(sInfo, arrInfo.elemWType);
				}
			}
			this.pushInstruction({ op: "local.set", index: valTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});

			this.releaseTemp(valTmp, arrInfo.elemWType);
			this.releaseTemp(targetIdxTmp, "i32");
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, {
				kind: "ref",
				nullable: true,
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
					const idx = this.allocLocal(l.name, wType, tupleTypes[i]);
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

		const isStruct =
			isStructType(targetGoType, this.mod.checker, this.mod) &&
			!isPointerToStruct(targetGoType, this.mod.checker, this.mod);
		if (isStruct) {
			const sName =
				targetGoType?.name ??
				(targetGoType?.kind === "named"
					? targetGoType.name
					: targetGoType?.kind === "Ident" || targetGoType?.kind === "TypeName"
						? targetGoType.name
						: null);
			const sInfo = this.mod.getStructType(sName);
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

		const isStruct =
			isStructType(targetGoType, this.mod.checker, this.mod) &&
			!isPointerToStruct(targetGoType, this.mod.checker, this.mod);
		if (isStruct) {
			const sName =
				targetGoType?.name ??
				(targetGoType?.kind === "named"
					? targetGoType.name
					: targetGoType?.kind === "Ident" || targetGoType?.kind === "TypeName"
						? targetGoType.name
						: null);
			const sInfo = this.mod.getStructType(sName);
			if (sInfo) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: sInfo.typeIndex,
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
			if (l.expr._type?.kind === "pointer") {
				this._emitNilCheck(baseWType);
			}
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
			const baseType = baseNode._type;
			const isSlice = isSliceType(baseType, this.mod.checker);
			const isArr = isArrayType(baseType, this.mod.checker);
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

			const arrTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");

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
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: offTmp });
				this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.set", index: offTmp });
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction("end");
				this.releaseTemp(sliceTmp, sliceWType);
			} else {
				const arrWType = {
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				};
				this.emitExpr(baseNode, arrWType);
				if (isPtrToArr) {
					this._emitNilCheck(arrWType);
				}
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction("array.len");
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: offTmp });
			}

			const idxTmp = this.acquireTemp("i32");
			this._emitIndexValAndBoundsCheck(l.index, lenTmp, idxTmp);

			const targetIdxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: targetIdxTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
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
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});
			return;
		}

		if (l.kind !== "Ident") return;

		const localInfo = this.resolveLocal(l.name);
		const globalInfo = !localInfo ? this.mod.resolveGlobal(l.name) : null;
		if (!localInfo && !globalInfo) return;

		if (localInfo && localInfo.isBoxed) {
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
			if (expr.expr._type?.kind === "pointer") {
				this._emitNilCheck(baseWType);
			}
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
			const baseType = baseNode._type;
			const isSlice = isSliceType(baseType, this.mod.checker);
			const isArr = isArrayType(baseType, this.mod.checker);
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

			const arrTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");

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
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: offTmp });
				this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.set", index: offTmp });
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction("end");
				this.releaseTemp(sliceTmp, sliceWType);
			} else {
				const arrWType = {
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				};
				this.emitExpr(baseNode, arrWType);
				if (isPtrToArr) {
					this._emitNilCheck(arrWType);
				}
				this.pushInstruction({ op: "local.set", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction("array.len");
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: offTmp });
			}

			const idxTmp = this.acquireTemp("i32");
			this._emitIndexValAndBoundsCheck(expr.index, lenTmp, idxTmp);

			const targetIdxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: targetIdxTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
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
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});
			return;
		}

		if (expr.kind === "Ident") {
			const localInfo = this.resolveLocal(expr.name);
			const globalInfo = !localInfo ? this.mod.resolveGlobal(expr.name) : null;
			if (!localInfo && !globalInfo) return;

			if (localInfo && localInfo.isBoxed) {
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
		this.popControl();
	}

	emitRangeForStmt(stmt) {
		const rangeExpr =
			stmt.cond?.kind === "RangeExpr" ? stmt.cond : stmt.init.rhs[0];
		const isAssign = stmt.init?.kind === "AssignStmt";
		const lhs = stmt.init?.lhs ?? [];
		const iterExpr = rangeExpr.expr;
		const iterType = iterExpr._type;

		if (isIntRangeType(iterType)) {
			const limitTmp = this.acquireTemp("i32");
			this._emitIndexExprToI32(iterExpr, limitTmp);

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

			// Emit body
			const bodyBlock = stmt.body ?? stmt.block;
			if (bodyBlock) {
				this.emitBlock(bodyBlock);
			}

			// End continue
			this.pushInstruction("end");
			this.popControl();

			// Post: idx++
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: idxTmp });

			// Loop back
			this.pushInstruction({ op: "br", depth: 0 });

			// End loop
			this.pushInstruction("end");
			this.popControl();

			// End break
			this.pushInstruction("end");
			this.popControl();

			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(limitTmp, "i32");
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
			this.popControl();

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
			this.popControl();

			// End break block
			this.pushInstruction("end");
			this.popControl();

			this.releaseTemp(runeTmp, "i32");
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(strTmp, "externref");
			return;
		}

		// Slice or Array range
		const isSlice = isSliceType(iterType, this.mod.checker);
		const isArr = isArrayType(iterType, this.mod.checker);
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

			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: offTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: lenTmp });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.set", index: offTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: lenTmp });
			this.pushInstruction("end");
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			this.emitExpr(iterExpr, arrWType);
			if (isPtrToArr) {
				this._emitNilCheck(arrWType);
			}
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
				const lIdx = this.allocLocal(lhs[0].name, "i64", {
					kind: "basic",
					name: "int",
				});
				idxLocalInfo = { index: lIdx, type: "i64" };
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
			this.pushInstruction("i64.extend_i32_s");
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
		this.popControl();

		// Post: idx++
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: idxTmp });

		// Loop back
		this.pushInstruction({ op: "br", depth: 0 });

		// End loop
		this.pushInstruction("end");
		this.popControl();

		// End break
		this.pushInstruction("end");
		this.popControl();

		this.releaseTemp(idxTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, arrWType);
	}

	emitForStmt(stmt) {
		if (isRangeFor(stmt) || stmt.cond?.kind === "RangeExpr") {
			this.emitRangeForStmt(stmt);
			return;
		}

		if (stmt.init) this.emitStmt(stmt.init);

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
		this.popControl();

		if (stmt.post) {
			this.emitStmt(stmt.post);
		}

		// Repeat loop: branch back to loop block
		this.pushInstruction({ op: "br", depth: 0 });

		// End loop
		this.pushInstruction("end");
		this.popControl();

		// End outer break block
		this.pushInstruction("end");
		this.popControl();
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
		this.popControl();
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
		this.popControl();
	}

	emitBranchStmt(stmt) {
		const isContinue = stmt.keyword === "continue";
		const depth = this.resolveBranchDepth(stmt.label, isContinue);
		this.pushInstruction({ op: "br", depth });
	}

	emitReturnStmt(stmt) {
		const values = stmt.values ?? [];
		for (let i = 0; i < values.length; i++) {
			const val = values[i];
			const targetWType = this.returnTypes[i] ?? null;
			const isValStruct =
				isStructType(val._type, this.mod.checker, this.mod) &&
				!isPointerToStruct(val._type, this.mod.checker, this.mod);
			const isFresh =
				val.kind === "CompositeLit" ||
				(val.kind === "UnaryExpr" && val.op === "*");
			this.emitExpr(val, targetWType);
			if (isValStruct && !isFresh) {
				const sInfo = this._resolveStructInfo(val);
				if (sInfo) {
					this.emitCloneStruct(sInfo, targetWType);
				}
			}
		}
		this.pushInstruction("return");
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

	// ── Expressions ────────────────────────────────────────────

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

			if (isStructType(goType, this.mod.checker, this.mod)) {
				const isVal = !isPointerToStruct(goType, this.mod.checker, this.mod);
				const structWType = this.toWasmType(goType);
				this._emitRawExpr(expr, structWType);
				const isFresh =
					expr.kind === "CompositeLit" ||
					(expr.kind === "UnaryExpr" && expr.op === "*");
				if (isVal && !isFresh) {
					const sInfo =
						this._resolveStructInfo(expr) ??
						this.mod.getStructType(goType?.name);
					if (sInfo) {
						this.emitCloneStruct(sInfo, structWType);
					}
				}
				return;
			}

			if (
				isSliceType(goType, this.mod.checker) ||
				isArrayType(goType, this.mod.checker) ||
				isFuncType(goType, this.mod.checker)
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

			case "SelectorExpr":
				this.emitSelectorExpr(expr);
				break;

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
		const litType = lit._type ?? lit.typeExpr?._type;
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

		this.pushInstruction({ op: "struct.new", typeIndex: structInfo.typeIndex });
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
		if (expr.expr._type?.kind === "pointer") {
			this._emitNilCheck(baseWType);
		}

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

			const lenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: lenTmp });

			const idxTmp = this.acquireTemp("i32");
			this._emitIndexValAndBoundsCheck(expr.index, lenTmp, idxTmp);

			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringGetImportIndex(),
			});

			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
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

		if (isSlice) {
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const sliceTmp = this.acquireTemp(sliceWType);
			this.emitExpr(baseNode, sliceWType);
			this.pushInstruction({ op: "local.set", index: sliceTmp });

			const lenTmp = this.acquireTemp("i32");
			const offTmp = this.acquireTemp("i32");
			const arrTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});

			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: lenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: offTmp });
			this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: lenTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.set", index: offTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction("end");

			const idxTmp = this.acquireTemp("i32");
			this._emitIndexValAndBoundsCheck(expr.index, lenTmp, idxTmp);

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});

			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(arrTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			const arrTmp = this.acquireTemp(arrWType);
			this.emitExpr(baseNode, arrWType);
			if (isPtrToArr) {
				this._emitNilCheck(arrWType);
			}
			this.pushInstruction({ op: "local.set", index: arrTmp });

			const lenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("array.len");
			this.pushInstruction({ op: "local.set", index: lenTmp });

			const idxTmp = this.acquireTemp("i32");
			this._emitIndexValAndBoundsCheck(expr.index, lenTmp, idxTmp);

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});

			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(arrTmp, arrWType);
		}
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
			this.emitPanic("runtime error: slice bounds out of range");
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
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: srcLenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: srcCapTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: srcOffTmp });
			this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction("else");
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
			this.pushInstruction("end");
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			this.emitExpr(baseNode, arrWType);
			if (isPtrToArr) {
				this._emitNilCheck(arrWType);
			}
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
		this.emitPanic("runtime error: slice bounds out of range");
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

	_emitIndexValAndBoundsCheck(indexNode, lenTmp, idxTmp32) {
		const idxGoType = indexNode._type;
		const idxWType = this.toWasmType(idxGoType);
		if (idxWType === "i64") {
			const idx64 = this.acquireTemp("i64");
			this.emitExpr(indexNode, "i64");
			this.pushInstruction({ op: "local.set", index: idx64 });

			this.pushInstruction({ op: "local.get", index: idx64 });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i64.extend_i32_u");
			this.pushInstruction("i64.ge_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.emitPanic("runtime error: index out of range");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: idx64 });
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction({ op: "local.set", index: idxTmp32 });
			this.releaseTemp(idx64, "i64");
		} else {
			this.emitExpr(indexNode, "i32");
			this.pushInstruction({ op: "local.set", index: idxTmp32 });

			this.pushInstruction({ op: "local.get", index: idxTmp32 });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.emitPanic("runtime error: index out of range");
			this.pushInstruction("end");
		}
	}

	_emitIndexExprToI32(node, tmp32) {
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
				return;
			}
			this.pushInstruction({ op: "local.get", index: localInfo.index });
			return;
		}

		const globalInfo = this.mod.resolveGlobal(ident.name);
		if (globalInfo) {
			this.pushInstruction({ op: "global.get", index: globalInfo.index });
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
					this._emitNilCheck(baseWType);
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
				this._emitNilCheck(baseWType);
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
			const nonNilWType = this.toWasmType(nonNil._type);
			this.emitExpr(nonNil, nonNilWType);
			this.pushInstruction("ref.is_null");
			if (op === "!=") {
				this.pushInstruction("i32.eqz");
			}
			return;
		}

		const leftType = left._type;
		const wType = isCmp
			? this.toWasmType(leftType)
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

	emitPanic(msg) {
		const strIdx = this.mod.internString(msg);
		const funcIdx = this.mod.getStringImportIndex();
		this.pushInstruction({ op: "i32.const", value: strIdx });
		this.pushInstruction({ op: "call", funcIndex: funcIdx });
		this.pushInstruction({ op: "throw", tagIndex: 0 });
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

	emitCallExpr(call, targetWasmType = null) {
		const { func, args } = call;

		// Built-in len
		if (func.kind === "Ident" && func.name === "len") {
			const arg = args[0];
			const argType = arg._type;
			if (isSliceType(argType, this.mod.checker)) {
				const elemType = this._getSliceElemType(argType);
				const sliceInfo = this.mod.getSliceType(elemType);
				const sliceWType = {
					kind: "ref",
					nullable: true,
					typeIndex: sliceInfo.typeIndex,
				};
				const sliceTmp = this.acquireTemp(sliceWType);
				this.emitExpr(arg, sliceWType);
				this.pushInstruction({ op: "local.set", index: sliceTmp });

				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
				this.pushInstruction("end");
				this.releaseTemp(sliceTmp, sliceWType);
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
				if (argType?.kind === "pointer") {
					this._emitNilCheck(arrWType);
				}
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

		// Built-in string conversion: string(x)
		if (func.kind === "Ident" && func.name === "string") {
			const arg = args[0];
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
			return;
		}

		// Built-in cap
		if (func.kind === "Ident" && func.name === "cap") {
			const arg = args[0];
			const argType = arg._type;
			if (isSliceType(argType, this.mod.checker)) {
				const elemType = this._getSliceElemType(argType);
				const sliceInfo = this.mod.getSliceType(elemType);
				const sliceWType = {
					kind: "ref",
					nullable: true,
					typeIndex: sliceInfo.typeIndex,
				};
				const sliceTmp = this.acquireTemp(sliceWType);
				this.emitExpr(arg, sliceWType);
				this.pushInstruction({ op: "local.set", index: sliceTmp });

				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 3,
				});
				this.pushInstruction("end");
				this.releaseTemp(sliceTmp, sliceWType);
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
				if (argType?.kind === "pointer") {
					this._emitNilCheck(arrWType);
				}
				this.pushInstruction("array.len");
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_u");
				}
				return;
			}
		}

		if (func.kind === "Ident" && func.name === "make") {
			const typeArg = args[0];
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
				return;
			}
		}

		// Built-in append
		if (func.kind === "Ident" && func.name === "append") {
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

			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: oldArrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: oldOffTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: oldLenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: oldCapTmp });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: oldArrTmp });
			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.set", index: oldOffTmp });
			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: oldLenTmp });
			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 3,
			});
			this.pushInstruction({ op: "local.set", index: oldCapTmp });
			this.pushInstruction("end");
			this.releaseTemp(sTmp, sliceWType);

			const newArrTmp = this.acquireTemp(arrWType);
			const newOffTmp = this.acquireTemp("i32");
			const newCapTmp = this.acquireTemp("i32");
			const newLenTmp = this.acquireTemp("i32");

			if (args.length === 2 && args[1]._spread) {
				const s2Tmp = this.acquireTemp(sliceWType);
				this.emitExpr(args[1], sliceWType);
				this.pushInstruction({ op: "local.set", index: s2Tmp });

				const s2ArrTmp = this.acquireTemp(arrWType);
				const s2OffTmp = this.acquireTemp("i32");
				const s2LenTmp = this.acquireTemp("i32");

				this.pushInstruction({ op: "local.get", index: s2Tmp });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: s2ArrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: s2OffTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: s2LenTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: s2Tmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction({ op: "local.set", index: s2ArrTmp });
				this.pushInstruction({ op: "local.get", index: s2Tmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.set", index: s2OffTmp });
				this.pushInstruction({ op: "local.get", index: s2Tmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
				this.pushInstruction({ op: "local.set", index: s2LenTmp });
				this.pushInstruction("end");
				this.releaseTemp(s2Tmp, sliceWType);

				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction({ op: "local.get", index: s2LenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: newLenTmp });

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

				for (let i = 0; i < k; i++) {
					const elemNode = args[1 + i];
					const isValStruct =
						isStructType(elemGoType, this.mod.checker, this.mod) &&
						!isPointerToStruct(elemGoType, this.mod.checker, this.mod);
					const isFresh =
						elemNode.kind === "CompositeLit" ||
						(elemNode.kind === "UnaryExpr" && elemNode.op === "*");

					this.pushInstruction({ op: "local.get", index: newArrTmp });
					this.pushInstruction({ op: "local.get", index: newOffTmp });
					this.pushInstruction({ op: "local.get", index: oldLenTmp });
					this.pushInstruction("i32.add");
					if (i > 0) {
						this.pushInstruction({ op: "i32.const", value: i });
						this.pushInstruction("i32.add");
					}
					this.emitExpr(elemNode, arrInfo.elemWType);
					if (isValStruct && !isFresh) {
						const sInfo = this._resolveStructInfo(elemNode);
						if (sInfo) {
							this.emitCloneStruct(sInfo, arrInfo.elemWType);
						}
					}
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
			return;
		}

		// Built-in copy
		if (func.kind === "Ident" && func.name === "copy") {
			const dstNode = args[0];
			const srcNode = args[1];
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

			this.pushInstruction({ op: "local.get", index: dstTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "local.get", index: srcTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction("else");

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
			this.pushInstruction("end");

			this.releaseTemp(srcTmp, sliceWType);
			this.releaseTemp(dstTmp, sliceWType);

			this.pushInstruction({ op: "local.get", index: nTmp });
			this.releaseTemp(nTmp, "i32");
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}

		// 1. Built-in print / println
		if (
			func.kind === "Ident" &&
			(func.name === "print" || func.name === "println")
		) {
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
			return;
		}

		// 2. Built-in panic
		if (func.kind === "Ident" && func.name === "panic") {
			const arg = args[0];
			if (!arg) {
				const strIdx = this.mod.internString("");
				const funcIdx = this.mod.getStringImportIndex();
				this.pushInstruction({ op: "i32.const", value: strIdx });
				this.pushInstruction({ op: "call", funcIndex: funcIdx });
			} else if (
				(arg.kind === "BasicLit" && arg.litKind === "STRING") ||
				toWasmType(arg._type, this.mod.checker) === "externref"
			) {
				this.emitExpr(arg, "externref");
			} else {
				const strVal = arg.value !== undefined ? String(arg.value) : "panic";
				const strIdx = this.mod.internString(strVal);
				const funcIdx = this.mod.getStringImportIndex();
				this.pushInstruction({ op: "i32.const", value: strIdx });
				this.pushInstruction({ op: "call", funcIndex: funcIdx });
			}
			this.pushInstruction({ op: "throw", tagIndex: 0 });
			return;
		}

		// 3. Math package functions
		if (func.kind === "SelectorExpr" && func.expr?.name === "math") {
			this.emitMathCall(func.field, args);
			return;
		}

		// 4. math/bits package functions
		if (func.kind === "SelectorExpr" && func.expr?.name === "bits") {
			this.emitBitsCall(func.field, args);
			return;
		}

		// 5. Method call on struct or pointer: receiver.Method(args...)
		if (func.kind === "SelectorExpr") {
			const recvType = func.expr._type;
			const recvTypeName = this._getReceiverTypeName(recvType, func.expr);
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
								if (recvType?.kind === "pointer") {
									this._emitNilCheck(baseWType);
								}
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
								return;
							}
						}
					}
				}

				if (targetFuncIdx !== null) {
					const recvWType = targetParamTypes[0] ?? null;
					const recvGoType =
						this.mod.getFuncParamGoTypes(methodName)[0] ?? null;
					const isValRecv =
						isStructType(recvGoType, this.mod.checker, this.mod) &&
						!isPointerToStruct(recvGoType, this.mod.checker, this.mod);
					const isFreshRecv =
						func.expr.kind === "CompositeLit" ||
						(func.expr.kind === "UnaryExpr" && func.expr.op === "*");
					this.emitExpr(func.expr, recvWType);
					if (
						recvType?.kind === "pointer" ||
						recvType?.kind === "PointerType"
					) {
						this._emitNilCheck(recvWType);
					}
					if (isValRecv && !isFreshRecv) {
						const sInfo = this._resolveStructInfo(func.expr);
						if (sInfo) {
							this.emitCloneStruct(sInfo, recvWType);
						}
					}
					const paramGoTypes = this.mod.getFuncParamGoTypes(methodName);
					for (let i = 0; i < args.length; i++) {
						const pType = targetParamTypes[i + 1] ?? null;
						const pGoType = paramGoTypes[i + 1] ?? null;
						const isValParam =
							isStructType(pGoType, this.mod.checker, this.mod) &&
							!isPointerToStruct(pGoType, this.mod.checker, this.mod);
						const isFreshArg =
							args[i].kind === "CompositeLit" ||
							(args[i].kind === "UnaryExpr" && args[i].op === "*");
						this.emitExpr(args[i], pType);
						if (isValParam && !isFreshArg) {
							const sInfo = this._resolveStructInfo(args[i]);
							if (sInfo) {
								this.emitCloneStruct(sInfo, pType);
							}
						}
					}
					this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
					return;
				}
			}
		}

		// 6. User-defined static function call
		if (func.kind === "Ident") {
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
						const isValParam =
							isStructType(pGoType, this.mod.checker, this.mod) &&
							!isPointerToStruct(pGoType, this.mod.checker, this.mod);
						const isFreshArg =
							arg.kind === "CompositeLit" ||
							(arg.kind === "UnaryExpr" && arg.op === "*");
						this.emitExpr(arg, pType);
						if (isValParam && !isFreshArg) {
							const sInfo = this._resolveStructInfo(arg);
							if (sInfo) {
								this.emitCloneStruct(sInfo, pType);
							}
						}
					}
					this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
					return;
				}
			}
		}

		// 7. Function value / closure call
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

		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(
			"runtime error: invalid memory address or nil pointer dereference",
		);
		this.pushInstruction("end");

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
			const isValParam =
				isStructType(pGoType, this.mod.checker, this.mod) &&
				!isPointerToStruct(pGoType, this.mod.checker, this.mod);
			const isFreshArg =
				arg.kind === "CompositeLit" ||
				(arg.kind === "UnaryExpr" && arg.op === "*");
			this.emitExpr(arg, pWType);
			if (isValParam && !isFreshArg) {
				const sInfo = this._resolveStructInfo(arg);
				if (sInfo) {
					this.emitCloneStruct(sInfo, pWType);
				}
			}
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

	emitMathCall(name, args) {
		// Native WASM instructions
		switch (name) {
			case "Sqrt":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.sqrt");
				return;
			case "Floor":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.floor");
				return;
			case "Ceil":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.ceil");
				return;
			case "Trunc":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.trunc");
				return;
			case "Abs":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.abs");
				return;
			case "Min":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.min");
				return;
			case "Max":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.max");
				return;
			case "Copysign":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.copysign");
				return;
		}

		// Imported JS Math functions
		const jsMathMap = {
			Sin: "sin",
			Cos: "cos",
			Tan: "tan",
			Asin: "asin",
			Acos: "acos",
			Atan: "atan",
			Atan2: "atan2",
			Pow: "pow",
			Exp: "exp",
			Log: "log",
			Log2: "log2",
			Log10: "log10",
			Round: "round",
		};

		if (jsMathMap[name]) {
			const jsName = jsMathMap[name];
			const isBinary = name === "Atan2" || name === "Pow";
			this.emitExpr(args[0], "f64");
			if (isBinary) this.emitExpr(args[1], "f64");
			const funcIdx = this.mod.getMathImportIndex(jsName, isBinary);
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			return;
		}

		throw new Error(`Unsupported math function: math.${name}`);
	}

	emitBitsCall(name, args) {
		switch (name) {
			case "LeadingZeros32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.clz");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "TrailingZeros32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.ctz");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "OnesCount32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.popcnt");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "RotateLeft32": {
				this.emitExpr(args[0], "i32");
				const arg1WType = toWasmType(args[1]?._type, this.mod.checker);
				if (arg1WType === "i64") {
					this.emitExpr(args[1], "i64");
					this.pushInstruction("i32.wrap_i64");
				} else {
					this.emitExpr(args[1], "i32");
				}
				this.pushInstruction("i32.rotl");
				return;
			}

			case "LeadingZeros64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.clz");
				return;
			case "TrailingZeros64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.ctz");
				return;
			case "OnesCount64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.popcnt");
				return;
			case "RotateLeft64": {
				this.emitExpr(args[0], "i64");
				const arg1WType = toWasmType(args[1]?._type, this.mod.checker);
				if (arg1WType === "i32") {
					this.emitExpr(args[1], "i32");
					this.pushInstruction("i64.extend_i32_s");
				} else {
					this.emitExpr(args[1], "i64");
				}
				this.pushInstruction("i64.rotl");
				return;
			}

			default:
				throw new Error(`Unsupported bits function: bits.${name}`);
		}
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
