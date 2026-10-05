// src/backend/wasm/emit.js
// AST statements and expressions -> WebAssembly instructions.

import { isSigned, toWasmType } from "./types.js";

export class FunctionEmitter {
	constructor(moduleEmitter, funcDecl, funcIndex) {
		this.mod = moduleEmitter;
		this.funcDecl = funcDecl;
		this.funcIndex = funcIndex;

		this.locals = new Map(); // name -> { index, type, isParam }
		this.localTypes = []; // list of additional local types (beyond params)
		this.controlStack = []; // stack of { type: 'block'|'loop', label: string }
		this.body = []; // emitted instructions

		this.tempCounter = 0;

		this.returnTypes = [];
		if (this.funcDecl.returnType) {
			if (this.funcDecl.returnType.kind === "TupleType") {
				for (const t of this.funcDecl.returnType.types) {
					const wt = toWasmType(t, this.mod.checker);
					if (wt) this.returnTypes.push(wt);
				}
			} else {
				const wt = toWasmType(this.funcDecl.returnType, this.mod.checker);
				if (wt) this.returnTypes.push(wt);
			}
		}

		this._initParams();
	}

	_initParams() {
		for (const param of this.funcDecl.params ?? []) {
			const wType = toWasmType(param.type, this.mod.checker);
			const idx = this.locals.size;
			this.locals.set(param.name, { index: idx, type: wType, isParam: true });
		}
	}

	allocLocal(name, wasmType) {
		const idx = (this.funcDecl.params?.length ?? 0) + this.localTypes.length;
		this.localTypes.push(wasmType);
		if (name && name !== "_") {
			this.locals.set(name, { index: idx, type: wasmType, isParam: false });
		}
		return idx;
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
				throw new Error("WASM backend does not yet support switch statements");

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
				const wType = toWasmType(rawType, this.mod.checker);
				const localIdx = this.allocLocal(name, wType);
				if (values?.[i]) {
					this.emitExpr(values[i], wType);
					this.pushInstruction({ op: "local.set", index: localIdx });
				} else {
					// Initialize to zero value
					if (wType === "i32") {
						this.pushInstruction({ op: "i32.const", value: 0 });
					} else if (wType === "i64") {
						this.pushInstruction({ op: "i64.const", value: 0n });
					} else if (wType === "f32") {
						this.pushInstruction({ op: "f32.const", value: 0.0 });
					} else if (wType === "f64") {
						this.pushInstruction({ op: "f64.const", value: 0.0 });
					} else {
						this.pushInstruction({ op: "ref.null", heapType: "any" });
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
		const wType = toWasmType(r._type, this.mod.checker);
		const idx = this.allocLocal(l.name, wType);
		this.emitExpr(r, wType);
		this.pushInstruction({ op: "local.set", index: idx });
	}

	_emitTupleDefine(lhsNodes, rhsNode) {
		const tupleTypes = rhsNode._type.types;
		const localIndices = [];
		for (let i = 0; i < lhsNodes.length; i++) {
			const l = lhsNodes[i];
			const wType = toWasmType(tupleTypes[i], this.mod.checker);
			const idx =
				l.kind === "Ident" && l.name !== "_"
					? this.allocLocal(l.name, wType)
					: null;
			localIndices.push(idx);
		}

		this.emitExpr(rhsNode);

		for (let i = lhsNodes.length - 1; i >= 0; i--) {
			const idx = localIndices[i];
			if (idx !== null) {
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
		if (!r || l.kind !== "Ident") return;
		if (l.name === "_") {
			this.emitExpr(r);
			this.pushInstruction("drop");
			return;
		}
		let localInfo = this.resolveLocal(l.name);
		if (!localInfo && op === ":=") {
			const wType = toWasmType(r._type, this.mod.checker);
			const idx = this.allocLocal(l.name, wType);
			localInfo = { index: idx, type: wType };
		}
		if (localInfo) {
			this.emitExpr(r, localInfo.type);
			this.pushInstruction({ op: "local.set", index: localInfo.index });
		} else {
			const globalInfo = this.mod.resolveGlobal(l.name);
			if (globalInfo) {
				this.emitExpr(r, globalInfo.type);
				this.pushInstruction({
					op: "global.set",
					index: globalInfo.index,
				});
			}
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
					const wType = toWasmType(tupleTypes[i], this.mod.checker);
					const idx = this.allocLocal(l.name, wType);
					localInfo = { index: idx, type: wType };
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
				if (this.resolveLocal(lhsNodes[i].name)) {
					this.pushInstruction({ op: "local.set", index: dest.index });
				} else {
					this.pushInstruction({ op: "global.set", index: dest.index });
				}
			} else {
				this.pushInstruction("drop");
			}
		}
	}

	_emitCompoundAssign(lhs, rhs, op) {
		const baseOp = op.slice(0, -1);
		const l = Array.isArray(lhs) ? lhs[0] : lhs;
		const r = Array.isArray(rhs) ? rhs[0] : rhs;
		if (l.kind !== "Ident") return;

		const localInfo = this.resolveLocal(l.name);
		const globalInfo = !localInfo ? this.mod.resolveGlobal(l.name) : null;
		if (!localInfo && !globalInfo) return;

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
		if (expr.kind === "Ident") {
			const localInfo = this.resolveLocal(expr.name);
			const globalInfo = !localInfo ? this.mod.resolveGlobal(expr.name) : null;
			if (!localInfo && !globalInfo) return;

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

	emitForStmt(stmt) {
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

	emitBranchStmt(stmt) {
		const isContinue = stmt.keyword === "continue";
		const depth = this.resolveBranchDepth(stmt.label, isContinue);
		this.pushInstruction({ op: "br", depth });
	}

	emitReturnStmt(stmt) {
		const values = stmt.values ?? [];
		for (let i = 0; i < values.length; i++) {
			const targetWType = this.returnTypes[i] ?? null;
			this.emitExpr(values[i], targetWType);
		}
		this.pushInstruction("return");
	}

	emitExprStmt(stmt) {
		this.emitExpr(stmt.expr);
		const goType = stmt.expr._type;
		const wType = toWasmType(goType, this.mod.checker);
		if (wType) {
			this.pushInstruction("drop");
		}
	}

	// ── Expressions ────────────────────────────────────────────

	emitExpr(expr, targetWasmType = null) {
		if (!expr) return;

		switch (expr.kind) {
			case "BasicLit":
				this.emitBasicLit(expr, targetWasmType);
				break;

			case "Ident":
				this.emitIdent(expr);
				break;

			case "UnaryExpr":
				this.emitUnaryExpr(expr, targetWasmType);
				break;

			case "BinaryExpr":
				this.emitBinaryExpr(expr, targetWasmType);
				break;

			case "CallExpr":
				this.emitCallExpr(expr);
				break;

			case "TypeConversion":
				this.emitTypeConversion(expr);
				break;

			default:
				throw new Error(`Unsupported expression kind: ${expr.kind}`);
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

	emitIdent(ident) {
		if (ident.name === "true") {
			this.pushInstruction({ op: "i32.const", value: 1 });
			return;
		}
		if (ident.name === "false") {
			this.pushInstruction({ op: "i32.const", value: 0 });
			return;
		}

		const localInfo = this.resolveLocal(ident.name);
		if (localInfo) {
			this.pushInstruction({ op: "local.get", index: localInfo.index });
			return;
		}

		const globalInfo = this.mod.resolveGlobal(ident.name);
		if (globalInfo) {
			this.pushInstruction({ op: "global.get", index: globalInfo.index });
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

		const leftType = left._type;
		const wType = isCmp
			? toWasmType(leftType, this.mod.checker)
			: (targetWasmType ?? toWasmType(leftType, this.mod.checker));

		this.emitExpr(left, wType);
		this.emitExpr(right, wType);
		this.emitBinaryOp(op, wType, leftType);
	}

	emitBinaryOp(op, wType, goType) {
		const signed = isSigned(goType);

		switch (op) {
			case "+":
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
				if (
					wType === "externref" ||
					wType === "anyref" ||
					(typeof wType === "object" && wType !== null)
				) {
					this.pushInstruction("ref.eq");
				} else {
					this.pushInstruction(`${wType}.eq`);
				}
				break;
			case "!=":
				if (
					wType === "externref" ||
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
				if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.lt`);
				} else {
					this.pushInstruction(`${wType}.lt_${signed ? "s" : "u"}`);
				}
				break;
			case "<=":
				if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.le`);
				} else {
					this.pushInstruction(`${wType}.le_${signed ? "s" : "u"}`);
				}
				break;
			case ">":
				if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.gt`);
				} else {
					this.pushInstruction(`${wType}.gt_${signed ? "s" : "u"}`);
				}
				break;
			case ">=":
				if (wType === "f32" || wType === "f64") {
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
				this.pushInstruction("i64.and");
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

	emitCallExpr(call) {
		const { func, args } = call;

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

		// 5. User-defined function call
		if (func.kind === "Ident") {
			const targetFuncIdx = this.mod.resolveFuncIndex(func.name);
			if (targetFuncIdx !== null) {
				const paramTypes = this.mod.getFuncParamTypes(func.name);
				for (let i = 0; i < args.length; i++) {
					const arg = args[i];
					const pType = paramTypes[i] ?? null;
					this.emitExpr(arg, pType);
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return;
			}
		}

		throw new Error(
			`Unsupported function call: ${func.name ?? func.field ?? "unknown"}`,
		);
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
