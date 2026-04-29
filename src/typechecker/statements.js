// TypeChecker statement-checking methods — installed as a mixin on TypeChecker.prototype.

import {
	ANY,
	BOOL,
	defaultType,
	isAny,
	isBool,
	isVoid,
	iteratorYieldParams,
	Scope,
} from "./types.js";

export const statementCheckMethods = {
	checkBlock(block, scope, returnType) {
		for (const stmt of block.stmts) {
			this.checkStmt(stmt, scope, returnType);
		}
	},

	checkStmt(stmt, scope, returnType) {
		switch (stmt.kind) {
			case "VarDecl":
				this.checkVarDecl(stmt, scope);
				break;
			case "ConstDecl":
				this.checkConstDecl(stmt, scope);
				break;
			case "TypeDecl":
				this.collectType(stmt);
				break;
			case "DefineStmt":
				this._checkDefineStmt(stmt, scope);
				break;
			case "AssignStmt":
				this._checkAssignStmt(stmt, scope);
				break;
			case "IncDecStmt":
				this.checkExpr(stmt.expr, scope);
				break;
			case "ExprStmt":
				this.checkExpr(stmt.expr, scope);
				break;
			case "ReturnStmt":
				this._checkReturnStmt(stmt, scope, returnType);
				break;
			case "IfStmt":
				this._checkIfStmt(stmt, scope, returnType);
				break;
			case "ForStmt":
				this._checkForStmt(stmt, scope, returnType);
				break;
			case "SwitchStmt":
				this._checkSwitchStmt(stmt, scope, returnType);
				break;
			case "TypeSwitchStmt":
				this._checkTypeSwitchStmt(stmt, scope, returnType);
				break;
			case "DeferStmt": {
				if (stmt.call.kind !== "CallExpr")
					this.err("defer requires a function call", stmt.call);
				this.checkExpr(stmt.call, scope);
				this._deferCount++;
				break;
			}
			case "LabeledStmt":
				this.checkStmt(stmt.body, scope, returnType);
				break;
			case "BranchStmt":
				this._checkBranchStmt(stmt);
				break;
			case "Block": {
				const blockScope = new Scope(scope);
				this.checkBlock(stmt, blockScope, returnType);
				this._reportUnused(blockScope, stmt);
				break;
			}
			default:
				break;
		}
	},

	_checkDefineCommaOkAssert(stmt, rhs, scope) {
		if (!stmt.rhs[0]?._commaOk) return false;
		const lhsNames = stmt.lhs.map((e) => e.name ?? e);
		if (lhsNames[0] !== "_") scope.defineLocal(lhsNames[0], rhs[0]);
		if (lhsNames[1] !== "_") scope.defineLocal(lhsNames[1], BOOL);
		stmt._rhsTypes = [rhs[0], BOOL];
		return true;
	},

	_declareDefineVars(stmt, rhsFlat, scope) {
		for (let i = 0; i < stmt.lhs.length; i++) {
			const name = stmt.lhs[i].name ?? stmt.lhs[i];
			if (name === "_") continue;
			if (scope.symbols.has(name)) stmt.lhs[i]._redecl = true;
			scope.defineLocal(name, defaultType(rhsFlat[i]) ?? ANY);
		}
	},

	_checkDefineStmt(stmt, scope) {
		// comma-ok type assertion: n, ok := x.(T)
		if (
			stmt.lhs.length === 2 &&
			stmt.rhs.length === 1 &&
			stmt.rhs[0].kind === "TypeAssertExpr"
		) {
			stmt.rhs[0]._commaOk = true;
		}
		const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
		const rhsFlat =
			rhs.length === 1 && rhs[0].kind === "tuple" ? rhs[0].types : rhs;
		if (this._checkDefineCommaOkAssert(stmt, rhs, scope)) return;
		this._declareDefineVars(stmt, rhsFlat, scope);
		const allRedecl = stmt.lhs.every((e) => e._redecl || (e.name ?? e) === "_");
		if (allRedecl && stmt.lhs.length > 0) {
			this.err("no new variables on left side of :=", stmt.lhs[0]);
		}
		stmt._rhsTypes = rhsFlat.map((t) => defaultType(t) ?? ANY);
	},

	_checkAssignCommaOkMap(stmt, scope) {
		if (
			stmt.lhs.length !== 2 ||
			stmt.rhs.length !== 1 ||
			stmt.rhs[0].kind !== "IndexExpr"
		)
			return false;
		const mapBaseType = this.checkExpr(stmt.rhs[0].expr, scope);
		const resolvedBase =
			mapBaseType?.kind === "named" ? mapBaseType.underlying : mapBaseType;
		if (resolvedBase?.kind !== "map") return false;
		this.checkExpr(stmt.rhs[0].index, scope);
		stmt._commaOkMap = true;
		stmt.rhs[0]._mapValueType = resolvedBase.value;
		return true;
	},

	_checkConstAssignment(stmt, scope) {
		for (const lhs of stmt.lhs) {
			if (lhs.kind === "Ident" && lhs.name !== "_") {
				const ownerScope = scope.lookupScope(lhs.name);
				if (ownerScope?.isConst(lhs.name))
					this.err(`cannot assign to const '${lhs.name}'`, lhs);
			}
		}
	},

	_isCommaOkTypeAssertAssign(stmt) {
		return (
			stmt.lhs.length === 2 &&
			stmt.rhs.length === 1 &&
			stmt.rhs[0].kind === "TypeAssertExpr"
		);
	},

	_checkAssignLhsType(e, scope) {
		if (e.kind === "Ident" && e.name === "_") return ANY;
		return this.checkExpr(e, scope);
	},

	_checkAssignTypes(stmt, rhsFlat, lhsTypes) {
		for (let i = 0; i < lhsTypes.length; i++) {
			if (stmt.lhs[i]?.kind === "Ident" && stmt.lhs[i]?.name === "_") continue;
			const r = rhsFlat[i] ?? ANY;
			if (!isAny(lhsTypes[i]) && !isAny(r))
				this.assertAssignable(lhsTypes[i], r, stmt.lhs[i]);
		}
	},

	_checkAssignStmt(stmt, scope) {
		if (this._checkAssignCommaOkMap(stmt, scope)) return;
		if (this._isCommaOkTypeAssertAssign(stmt)) stmt.rhs[0]._commaOk = true;
		this._checkConstAssignment(stmt, scope);
		const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
		const rhsFlat =
			rhs.length === 1 && rhs[0]?.kind === "tuple" ? rhs[0].types : rhs;
		const lhsTypes = stmt.lhs.map((e) => this._checkAssignLhsType(e, scope));
		this._checkAssignTypes(stmt, rhsFlat, lhsTypes);
	},

	_checkReturnStmt(stmt, scope, returnType) {
		const types = stmt.values.map((v) => this.checkExpr(v, scope));
		stmt._types = types;
		if (
			!isVoid(returnType) &&
			types.length === 0 &&
			!returnType?._hasNamedReturns
		) {
			this.err("Missing return value", stmt);
		}
		// Check each returned value is assignable to its declared type
		if (!isVoid(returnType) && types.length > 0) {
			const expected =
				returnType.kind === "tuple" ? returnType.types : [returnType];
			for (let i = 0; i < expected.length; i++) {
				if (types[i])
					this.assertAssignable(expected[i], types[i], stmt.values[i] ?? stmt);
			}
		}
	},

	_checkIfStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
		const ct = this.checkExpr(stmt.cond, inner);
		if (!isBool(ct) && !isAny(ct)) this.err("If condition must be bool", stmt);
		const bodyScope = new Scope(inner);
		this.checkBlock(stmt.body, bodyScope, returnType);
		this._reportUnused(bodyScope, stmt);
		if (stmt.elseBody) {
			if (stmt.elseBody.kind === "Block") {
				const elseScope = new Scope(inner);
				this.checkBlock(stmt.elseBody, elseScope, returnType);
				this._reportUnused(elseScope, stmt);
			} else this.checkStmt(stmt.elseBody, inner, returnType);
		}
		this._reportUnused(inner, stmt);
	},

	_checkForCond(stmt, inner) {
		if (stmt.cond.kind !== "RangeExpr") {
			const ct = this.checkExpr(stmt.cond, inner);
			if (!isBool(ct) && !isAny(ct))
				this.err("For condition must be bool", stmt);
		} else {
			const ct = this.checkExpr(stmt.cond.expr, inner);
			const info = iteratorYieldParams(ct);
			if (info) {
				stmt.cond._isIterator = true;
				stmt.cond._yieldParams = info.yieldParams;
			} else if (ct?.kind === "func") {
				this.err("cannot range over func: not an iterator function", stmt);
			}
		}
	},

	_checkForStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		let iterInfo = null;
		if (stmt.init?.rhs?.[0]?.kind === "RangeExpr") {
			iterInfo = this._checkRangeIterStmt(stmt.init, inner, returnType);
		}
		if (!iterInfo && stmt.init) this.checkStmt(stmt.init, inner, returnType);
		if (stmt.cond) this._checkForCond(stmt, inner);
		if (stmt.post) this.checkStmt(stmt.post, inner, returnType);
		this._loopDepth++;
		const bodyScope = new Scope(inner);
		this.checkBlock(stmt.body, bodyScope, returnType);
		this._reportUnused(bodyScope, stmt);
		this._loopDepth--;
		this._reportUnused(inner, stmt);
	},

	_checkSwitchStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
		if (stmt.tag) this.checkExpr(stmt.tag, inner);
		this._switchDepth++;
		for (const c of stmt.cases) {
			const caseScope = new Scope(inner);
			if (c.list) for (const e of c.list) this.checkExpr(e, caseScope);
			for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
			this._reportUnused(caseScope, stmt);
		}
		this._switchDepth--;
		this._reportUnused(inner, stmt);
	},

	_checkTypeSwitchStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		this.checkExpr(stmt.expr, inner);
		this._switchDepth++;
		this._typeSwitchDepth++;
		for (const c of stmt.cases) {
			const caseScope = new Scope(inner);
			if (stmt.assign) {
				// Bind the variable to the single case type, or any for multi/default
				const bindType =
					c.types?.length === 1 ? this.resolveTypeNode(c.types[0], inner) : ANY;
				caseScope.defineLocal(stmt.assign, bindType);
				// The capture variable is always considered used — it's the whole
				// point of the switch-with-assign form. Each case body uses its own
				// typed copy of the variable.
				caseScope.lookup(stmt.assign);
			}
			for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
			this._reportUnused(caseScope, stmt);
		}
		this._typeSwitchDepth--;
		this._switchDepth--;
	},

	_checkBranchStmt(stmt) {
		const kw = stmt.keyword;
		if (kw === "continue" && this._loopDepth === 0)
			this.err("continue statement outside for loop", stmt);
		else if (kw === "break" && this._loopDepth === 0 && this._switchDepth === 0)
			this.err("break statement outside for loop or switch", stmt);
		else if (kw === "fallthrough" && this._switchDepth === 0)
			this.err("fallthrough statement outside switch", stmt);
		else if (kw === "fallthrough" && this._typeSwitchDepth > 0)
			this.err("cannot fallthrough in type switch", stmt);
	},

	_checkRangeIterInvalidFunc(iterType, initStmt) {
		const underlying =
			iterType?.kind === "named" ? iterType.underlying : iterType;
		if (underlying?.kind === "func")
			this.err("cannot range over func: not an iterator function", initStmt);
	},

	_bindRangeIterDefineVars(lhs, info, scope) {
		for (let i = 0; i < lhs.length; i++) {
			const name = lhs[i].name ?? lhs[i];
			if (name === "_") continue;
			const varType = info.yieldParams[i] ?? ANY;
			scope.defineLocal(name, varType);
		}
	},

	_checkRangeIterAssignVars(lhs, scope) {
		for (const e of lhs) {
			if (e.kind === "Ident" && e.name !== "_") this.checkExpr(e, scope);
		}
	},

	_checkRangeIterStmt(initStmt, scope, _returnType) {
		const rangeExpr = initStmt.rhs[0];
		const iterType = this.checkExpr(rangeExpr.expr, scope);
		const info = iteratorYieldParams(iterType);
		if (!info) {
			this._checkRangeIterInvalidFunc(iterType, initStmt);
			return null;
		}

		const lhs = initStmt.lhs;
		if (lhs.length > info.yieldParams.length) {
			this.err(
				`range over iterator: too many loop variables (got ${lhs.length}, max ${info.yieldParams.length})`,
				initStmt,
			);
		}

		rangeExpr._isIterator = true;
		rangeExpr._yieldParams = info.yieldParams;

		if (initStmt.kind === "DefineStmt")
			this._bindRangeIterDefineVars(lhs, info, scope);
		else this._checkRangeIterAssignVars(lhs, scope);
		return info;
	},
};
