// Parser statement methods — installed as a mixin on Parser.prototype.

import { T } from "../lexer.js";

export const statementParserMethods = {
	parseBlock() {
		this.expect(T.LBRACE);
		const stmts = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			stmts.push(this.parseStmt());
			this.semi();
		}
		this.expect(T.RBRACE);
		return { kind: "Block", stmts };
	},

	parseStmt() {
		const t = this.peek();
		const stmt = this._parseStmt(t);
		stmt._line = t.line;
		return stmt;
	},

	_parseStmt(t) {
		switch (t.type) {
			case T.VAR:
				return this.parseVarDecl();
			case T.CONST:
				return this.parseConstDecl();
			case T.TYPE:
				return this.parseTypeDecl();
			case T.RETURN:
				return this.parseReturn();
			case T.DEFER:
				return this.parseDefer();
			case T.BREAK:
				this.advance();
				if (this.check(T.IDENT)) {
					const label = this.advance().value;
					this.semi();
					return { kind: "BranchStmt", keyword: "break", label };
				}
				this.semi();
				return { kind: "BranchStmt", keyword: "break" };
			case T.CONTINUE:
				this.advance();
				if (this.check(T.IDENT)) {
					const label = this.advance().value;
					this.semi();
					return { kind: "BranchStmt", keyword: "continue", label };
				}
				this.semi();
				return { kind: "BranchStmt", keyword: "continue" };
			case T.FALLTHROUGH:
				this.advance();
				this.semi();
				return { kind: "BranchStmt", keyword: "fallthrough" };
			case T.IF:
				return this.parseIf();
			case T.FOR:
				return this.parseFor();
			case T.SWITCH:
				return this.parseSwitch();
			case T.LBRACE:
				return this.parseBlock();
			case T.IDENT:
				if (this.check2(T.COLON)) {
					const label = this.advance().value; // consume IDENT
					this.advance(); // consume COLON
					const body = this.parseStmt();
					return { kind: "LabeledStmt", label, body };
				}
				return this.parseSimpleStmt();
			default:
				return this.parseSimpleStmt();
		}
	},

	parseDefer() {
		this.expect(T.DEFER);
		const call = this.parseExpr();
		return { kind: "DeferStmt", call };
	},

	parseReturn() {
		this.expect(T.RETURN);
		if (this.check(T.SEMICOLON) || this.check(T.RBRACE)) {
			return { kind: "ReturnStmt", values: [] };
		}
		const values = this.parseExprList();
		return { kind: "ReturnStmt", values };
	},

	parseIf() {
		this.expect(T.IF);
		let init = null;
		let cond;
		// if init; cond { } — use noCompLit to avoid "{" being parsed as composite literal
		const first = this.parseSimpleStmtRaw(true);
		// Only treat as "init; cond" if semicolon is followed by a non-brace token
		if (this.check(T.SEMICOLON) && this.peek2().type !== T.LBRACE) {
			this.advance(); // consume ;
			init = first;
			cond = this.parseExpr(0, true);
		} else {
			this.match(T.SEMICOLON); // consume any auto-inserted ;
			cond = this.stmtToExpr(first);
		}
		const body = this.parseBlock();
		// Consume auto-inserted ; before else (Go allows "}\nelse")
		this.match(T.SEMICOLON);
		let elseBody = null;
		if (this.match(T.ELSE)) {
			elseBody = this.check(T.IF) ? this.parseIf() : this.parseBlock();
		}
		return { kind: "IfStmt", init, cond, body, elseBody };
	},

	parseFor() {
		this.expect(T.FOR);

		// for { } — infinite loop
		if (this.check(T.LBRACE)) {
			return {
				kind: "ForStmt",
				init: null,
				cond: null,
				post: null,
				body: this.parseBlock(),
			};
		}

		const first = this.parseSimpleStmtRaw(true);

		if (this.check(T.LBRACE)) {
			// for k, v := range expr { }  — range stmt ends right before {
			if (this.isRangeStmt(first)) {
				return {
					kind: "ForStmt",
					init: first,
					cond: null,
					post: null,
					body: this.parseBlock(),
				};
			}
			// for cond { }
			return {
				kind: "ForStmt",
				init: null,
				cond: this.stmtToExpr(first),
				post: null,
				body: this.parseBlock(),
			};
		}

		this.expect(T.SEMICOLON);

		// for init; cond; post { }
		let cond = null;
		if (!this.check(T.SEMICOLON)) cond = this.parseExpr(0, true);
		this.expect(T.SEMICOLON);
		let post = null;
		if (!this.check(T.LBRACE)) post = this.parseSimpleStmtRaw();
		const body = this.parseBlock();
		return { kind: "ForStmt", init: first, cond, post, body };
	},

	isRangeStmt(stmt) {
		if (!stmt) return false;
		if (stmt.kind !== "DefineStmt" && stmt.kind !== "AssignStmt") return false;
		return stmt.rhs?.[0]?.kind === "RangeExpr";
	},

	parseSwitch() {
		this.expect(T.SWITCH);
		let init = null;
		let tag = null;
		if (!this.check(T.LBRACE)) {
			const first = this.parseSimpleStmtRaw(true);
			if (this.match(T.SEMICOLON)) {
				init = first;
				if (!this.check(T.LBRACE))
					tag = this.stmtToExpr(this.parseSimpleStmtRaw(true));
			} else {
				tag = this.stmtToExpr(first);
			}
		}

		// Detect type switch: switch x.(type) or switch v := x.(type)
		if (tag?.kind === "TypeSwitchExpr") {
			return this._parseTypeSwitchBody(null, tag.expr);
		}
		if (tag?.kind === "DefineStmt" && tag.rhs[0]?.kind === "TypeSwitchExpr") {
			return this._parseTypeSwitchBody(
				tag.lhs[0]?.name ?? null,
				tag.rhs[0].expr,
			);
		}

		this.expect(T.LBRACE);
		const cases = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			if (this.check(T.CASE)) {
				this.advance();
				const list = this.parseExprList();
				this.expect(T.COLON);
				cases.push({ kind: "CaseClause", list, stmts: this._parseCaseBody() });
			} else if (this.check(T.DEFAULT)) {
				this.advance();
				this.expect(T.COLON);
				cases.push({
					kind: "CaseClause",
					list: null,
					stmts: this._parseCaseBody(),
				});
			} else {
				this.err("Expected case or default");
			}
		}
		this.expect(T.RBRACE);
		return { kind: "SwitchStmt", init, tag, cases };
	},

	_parseCaseBody() {
		const stmts = [];
		while (
			!this.check(T.CASE) &&
			!this.check(T.DEFAULT) &&
			!this.check(T.RBRACE)
		) {
			stmts.push(this.parseStmt());
			this.semi();
		}
		return stmts;
	},

	_parseTypeSwitchBody(assign, expr) {
		this.expect(T.LBRACE);
		const cases = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			if (this.check(T.CASE)) {
				this.advance();
				const types = this._parseTypeSwitchTypeList();
				this.expect(T.COLON);
				cases.push({ types, stmts: this._parseCaseBody() });
			} else if (this.check(T.DEFAULT)) {
				this.advance();
				this.expect(T.COLON);
				cases.push({ types: null, stmts: this._parseCaseBody() });
			} else {
				this.err("Expected case or default");
			}
		}
		this.expect(T.RBRACE);
		return { kind: "TypeSwitchStmt", assign, expr, cases };
	},

	_parseTypeSwitchTypeList() {
		const parseOne = () => {
			// nil is a keyword, not a type name, so handle it explicitly
			if (this.check(T.NIL)) {
				this.advance();
				return { kind: "TypeName", name: "nil" };
			}
			return this.parseType();
		};
		const types = [parseOne()];
		while (this.match(T.COMMA)) types.push(parseOne());
		return types;
	},

	// Parses a "simple statement": assignment, define, inc/dec, or expression.
	// Returns a statement node.
	parseSimpleStmt() {
		const s = this.parseSimpleStmtRaw();
		return s;
	},

	parseSimpleStmtRaw(noCompLit = false) {
		// Parse left-hand side (could be expr list for multi-assign)
		const first = this.parseExpr(0, noCompLit);
		const t = this.peek();

		// a, b, c := ...  or  x, y = ...
		if (t.type === T.COMMA) {
			const lhs = [first];
			while (this.match(T.COMMA)) lhs.push(this.parseExpr());
			const op = this.advance(); // := or =
			const rhs = this.parseExprList();
			if (op.type === T.DEFINE) return { kind: "DefineStmt", lhs, rhs };
			return { kind: "AssignStmt", lhs, op: "=", rhs };
		}

		// x := expr
		if (t.type === T.DEFINE) {
			this.advance();
			const rhs = this.parseExprList();
			return { kind: "DefineStmt", lhs: [first], rhs };
		}

		// x = expr  or  x += expr  etc.
		const assignOps = [
			T.ASSIGN,
			T.PLUS_ASSIGN,
			T.MINUS_ASSIGN,
			T.STAR_ASSIGN,
			T.SLASH_ASSIGN,
			T.PERCENT_ASSIGN,
			T.AMP_ASSIGN,
			T.PIPE_ASSIGN,
			T.CARET_ASSIGN,
			T.LSHIFT_ASSIGN,
			T.RSHIFT_ASSIGN,
		];
		if (assignOps.includes(t.type)) {
			const op = this.advance().value;
			const rhs = this.parseExprList();
			return { kind: "AssignStmt", lhs: [first], op, rhs };
		}

		// x++  x--
		if (t.type === T.INC || t.type === T.DEC) {
			const op = this.advance().value;
			return { kind: "IncDecStmt", expr: first, op };
		}

		// for range detection: "for k, v := range expr"
		// range keyword after :=
		if (first.kind === "Ident" && first.name === "range") {
			const expr = this.parseExpr();
			return { kind: "RangeExpr", expr };
		}

		return { kind: "ExprStmt", expr: first };
	},

	// Converts an ExprStmt back to its expression
	stmtToExpr(stmt) {
		if (!stmt) return null;
		if (stmt.kind === "ExprStmt") return stmt.expr;
		return stmt;
	},
};
