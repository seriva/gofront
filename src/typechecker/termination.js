// Termination analysis — determines whether a statement/block always returns.
// Installed as a mixin on TypeChecker.prototype.

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

/** @type {ThisType<TypeChecker>} */
export const terminationMethods = {
	_isPanicCall(expr) {
		return (
			expr?.kind === "CallExpr" &&
			expr?.func?.kind === "Ident" &&
			expr?.func?.name === "panic"
		);
	},

	_isTerminating(stmt) {
		if (!stmt) return false;
		switch (stmt.kind) {
			case "ReturnStmt":
				return true;
			case "BranchStmt":
				return stmt.keyword === "goto";
			case "ExprStmt":
				return this._isPanicCall(stmt.expr);
			case "LabeledStmt":
				return this._isTerminating(stmt.body);
			case "Block":
				return this._isTerminatingBlock(stmt);
			case "SwitchStmt":
				return this._isTerminatingSwitch(stmt);
			case "TypeSwitchStmt":
				return this._isTerminatingTypeSwitch(stmt);
			case "ForStmt":
				return !stmt.cond && !this._blockHasBreak(stmt.body);
			case "IfStmt":
				return this._isTerminatingIfStmt(stmt);
			default:
				return false;
		}
	},

	_isTerminatingIfStmt(stmt) {
		if (!stmt.elseBody) return false;
		return (
			this._isTerminatingBlock(stmt.body) &&
			(stmt.elseBody.kind === "Block"
				? this._isTerminatingBlock(stmt.elseBody)
				: this._isTerminating(stmt.elseBody))
		);
	},

	_isTerminatingBlock(block) {
		if (!block?.stmts?.length) return false;
		return this._isTerminating(block.stmts[block.stmts.length - 1]);
	},

	_blockHasBreak(block) {
		if (!block?.stmts) return false;
		for (const s of block.stmts) {
			if (s.kind === "BranchStmt" && s.keyword === "break") return true;
		}
		return false;
	},

	_isTerminatingSwitch(stmt) {
		let hasDefault = false;
		const cases = stmt.cases ?? [];
		for (let i = 0; i < cases.length; i++) {
			const c = cases[i];
			if (!c.list) hasDefault = true;
			if (!c.stmts?.length) return false;
			const last = c.stmts[c.stmts.length - 1];
			// `fallthrough` hands control to the next clause, which is checked
			// on its own; the final clause has none to fall into.
			if (this._isFallthrough(last) && i < cases.length - 1) continue;
			if (!this._isTerminating(last)) return false;
		}
		return hasDefault;
	},

	_isFallthrough(stmt) {
		return stmt?.kind === "BranchStmt" && stmt.keyword === "fallthrough";
	},

	_isTerminatingTypeSwitch(stmt) {
		let hasDefault = false;
		for (const c of stmt.cases ?? []) {
			if (!c.types) hasDefault = true;
			if (!c.stmts?.length) return false;
			const last = c.stmts[c.stmts.length - 1];
			if (!this._isTerminating(last)) return false;
		}
		return hasDefault;
	},
};
