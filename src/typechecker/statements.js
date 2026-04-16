// TypeChecker statement-checking methods — installed as a mixin on TypeChecker.prototype.

import { ANY, BOOL, isAny, isBool, isVoid, Scope } from "./types.js";

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

			case "DefineStmt": {
				// comma-ok type assertion: n, ok := x.(T)
				if (
					stmt.lhs.length === 2 &&
					stmt.rhs.length === 1 &&
					stmt.rhs[0].kind === "TypeAssertExpr"
				) {
					stmt.rhs[0]._commaOk = true;
				}
				const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
				// Flatten tuple returns
				const rhsFlat =
					rhs.length === 1 && rhs[0].kind === "tuple" ? rhs[0].types : rhs;
				// comma-ok type assertion returns [assertedType, bool]
				if (stmt.rhs[0]?._commaOk) {
					const lhsNames = stmt.lhs.map((e) => e.name ?? e);
					if (lhsNames[0] !== "_") scope.defineLocal(lhsNames[0], rhs[0]);
					if (lhsNames[1] !== "_") scope.defineLocal(lhsNames[1], BOOL);
					stmt._rhsTypes = [rhs[0], BOOL];
					break;
				}
				for (let i = 0; i < stmt.lhs.length; i++) {
					const name = stmt.lhs[i].name ?? stmt.lhs[i];
					if (name === "_") continue;
					// Short variable re-declaration: mark vars that already exist
					// in the current (not parent) scope as redeclared.
					if (scope.symbols.has(name)) {
						stmt.lhs[i]._redecl = true;
					}
					scope.defineLocal(name, rhsFlat[i] ?? ANY);
				}
				// Go requires at least one new variable in :=
				const allRedecl = stmt.lhs.every(
					(e) => e._redecl || (e.name ?? e) === "_",
				);
				if (allRedecl && stmt.lhs.length > 0) {
					this.err("no new variables on left side of :=", stmt.lhs[0]);
				}
				stmt._rhsTypes = rhsFlat;
				break;
			}

			case "AssignStmt": {
				// Check for const reassignment before evaluating RHS
				for (const lhs of stmt.lhs) {
					if (lhs.kind === "Ident") {
						const ownerScope = scope.lookupScope(lhs.name);
						if (ownerScope?.isConst(lhs.name))
							this.err(`cannot assign to const '${lhs.name}'`, lhs);
					}
				}
				const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
				const rhsFlat =
					rhs.length === 1 && rhs[0]?.kind === "tuple" ? rhs[0].types : rhs;
				const lhsTypes = stmt.lhs.map((e) => this.checkExpr(e, scope));
				for (let i = 0; i < lhsTypes.length; i++) {
					const r = rhsFlat[i] ?? ANY;
					if (!isAny(lhsTypes[i]) && !isAny(r)) {
						this.assertAssignable(lhsTypes[i], r, stmt.lhs[i]);
					}
				}
				break;
			}

			case "IncDecStmt":
				this.checkExpr(stmt.expr, scope);
				break;

			case "ExprStmt":
				this.checkExpr(stmt.expr, scope);
				break;

			case "ReturnStmt": {
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
							this.assertAssignable(
								expected[i],
								types[i],
								stmt.values[i] ?? stmt,
							);
					}
				}
				break;
			}

			case "IfStmt": {
				const inner = new Scope(scope);
				if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
				const ct = this.checkExpr(stmt.cond, inner);
				if (!isBool(ct) && !isAny(ct))
					this.err("If condition must be bool", stmt);
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
				break;
			}

			case "ForStmt": {
				const inner = new Scope(scope);
				if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
				if (stmt.cond) {
					// for range N { } — RangeExpr as condition is valid (Go 1.22 int range)
					if (stmt.cond.kind !== "RangeExpr") {
						const ct = this.checkExpr(stmt.cond, inner);
						if (!isBool(ct) && !isAny(ct))
							this.err("For condition must be bool", stmt);
					} else {
						this.checkExpr(stmt.cond.expr, inner);
					}
				}
				if (stmt.post) this.checkStmt(stmt.post, inner, returnType);
				this._loopDepth++;
				const bodyScope = new Scope(inner);
				this.checkBlock(stmt.body, bodyScope, returnType);
				this._reportUnused(bodyScope, stmt);
				this._loopDepth--;
				this._reportUnused(inner, stmt);
				break;
			}

			case "SwitchStmt": {
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
				break;
			}

			case "TypeSwitchStmt": {
				const inner = new Scope(scope);
				this.checkExpr(stmt.expr, inner);
				this._switchDepth++;
				this._typeSwitchDepth++;
				for (const c of stmt.cases) {
					const caseScope = new Scope(inner);
					if (stmt.assign) {
						// Bind the variable to the single case type, or any for multi/default
						const bindType =
							c.types?.length === 1
								? this.resolveTypeNode(c.types[0], inner)
								: ANY;
						caseScope.defineLocal(stmt.assign, bindType);
					}
					for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
					this._reportUnused(caseScope, stmt);
				}
				this._typeSwitchDepth--;
				this._switchDepth--;
				break;
			}

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

			case "BranchStmt": {
				const kw = stmt.keyword;
				if (kw === "continue" && this._loopDepth === 0)
					this.err("continue statement outside for loop", stmt);
				else if (
					kw === "break" &&
					this._loopDepth === 0 &&
					this._switchDepth === 0
				)
					this.err("break statement outside for loop or switch", stmt);
				else if (kw === "fallthrough" && this._switchDepth === 0)
					this.err("fallthrough statement outside switch", stmt);
				else if (kw === "fallthrough" && this._typeSwitchDepth > 0)
					this.err("cannot fallthrough in type switch", stmt);
				break;
			}
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
};
