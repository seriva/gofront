// Parser statement methods — installed as a mixin on Parser.prototype.

import { T } from "../lexer/tokens.js";

// Statement keywords: none of them can appear inside a composite literal or a
// statement header's expressions.
const STMT_KEYWORDS = new Set([
	T.VAR,
	T.CONST,
	T.TYPE,
	T.IF,
	T.ELSE,
	T.FOR,
	T.RETURN,
	T.BREAK,
	T.CONTINUE,
	T.SWITCH,
	T.CASE,
	T.DEFAULT,
	T.SELECT,
	T.DEFER,
	T.GO,
	T.FALLTHROUGH,
]);

// Tokens that only appear in statements: a brace pair holding one at its top
// level is a block, not a composite literal.
const STMT_ONLY_TOKENS = new Set([
	...STMT_KEYWORDS,
	T.SEMICOLON,
	T.ASSIGN,
	T.DEFINE,
	T.PLUS_ASSIGN,
	T.MINUS_ASSIGN,
	T.STAR_ASSIGN,
	T.SLASH_ASSIGN,
	T.PERCENT_ASSIGN,
	T.AMP_ASSIGN,
	T.PIPE_ASSIGN,
	T.AND_NOT_ASSIGN,
	T.CARET_ASSIGN,
	T.LSHIFT_ASSIGN,
	T.RSHIFT_ASSIGN,
	T.INC,
	T.DEC,
]);

const OPEN_BRACKETS = new Set([T.LBRACE, T.LPAREN, T.LBRACKET]);
const CLOSE_BRACKETS = new Set([T.RBRACE, T.RPAREN, T.RBRACKET]);

function bracketDelta(tt) {
	if (OPEN_BRACKETS.has(tt)) return 1;
	return CLOSE_BRACKETS.has(tt) ? -1 : 0;
}

// Method-name dispatch for pure-delegation cases in _parseStmt.
const PARSE_STMT_DELEGATE = {
	[T.VAR]: "parseVarDecl",
	[T.CONST]: "parseConstDecl",
	[T.TYPE]: "parseTypeDecl",
	[T.RETURN]: "parseReturn",
	[T.DEFER]: "parseDefer",
	[T.IF]: "parseIf",
	[T.FOR]: "parseFor",
	[T.SWITCH]: "parseSwitch",
	[T.LBRACE]: "parseBlock",
};

const ASSIGN_OPS = new Set([
	T.ASSIGN,
	T.PLUS_ASSIGN,
	T.MINUS_ASSIGN,
	T.STAR_ASSIGN,
	T.SLASH_ASSIGN,
	T.PERCENT_ASSIGN,
	T.AMP_ASSIGN,
	T.PIPE_ASSIGN,
	T.AND_NOT_ASSIGN,
	T.CARET_ASSIGN,
	T.LSHIFT_ASSIGN,
	T.RSHIFT_ASSIGN,
]);

export const statementParserMethods = {
	parseBlock() {
		this.expect(T.LBRACE);
		const stmts = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			const result = this.parseStmt();
			if (Array.isArray(result)) stmts.push(...result);
			else stmts.push(result);
			this.semi();
		}
		this.expect(T.RBRACE);
		return { kind: "Block", stmts };
	},

	parseStmt() {
		const t = this.peek();
		const stmt = this._parseStmt(t);
		if (Array.isArray(stmt)) {
			for (const s of stmt) {
				s._line = t.line;
				s._col = t.col;
			}
			return stmt;
		}
		stmt._line = t.line;
		stmt._col = t.col;
		return stmt;
	},

	_parseStmt(t) {
		const delegate = PARSE_STMT_DELEGATE[t.type];
		if (delegate) return this[delegate]();

		switch (t.type) {
			case T.BREAK:
			case T.CONTINUE: {
				const keyword = this.advance().value;
				if (this.check(T.IDENT)) {
					const label = this.advance().value;
					this.semi();
					return { kind: "BranchStmt", keyword, label };
				}
				this.semi();
				return { kind: "BranchStmt", keyword };
			}
			case T.FALLTHROUGH:
				this.advance();
				this.semi();
				return { kind: "BranchStmt", keyword: "fallthrough" };
			case T.GOTO: {
				// Parsed so the checker can reject it with a targeted message.
				this.advance();
				const label = this.expect(T.IDENT).value;
				this.semi();
				return { kind: "BranchStmt", keyword: "goto", label };
			}
			case T.GO:
				return this.err("goroutines are not supported in GoFront");
			case T.SELECT:
				return this.err(
					"select statement is not supported in GoFront (no channels)",
				);
			case T.IDENT:
				if (this.check2(T.COLON)) {
					const label = this.advance().value;
					this.advance(); // consume COLON
					// A label may precede the end of a block: the statement is empty.
					const body =
						this.check(T.RBRACE) || this.check(T.CASE) || this.check(T.DEFAULT)
							? { kind: "Block", stmts: [] }
							: this.parseStmt();
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
		this._rejectHeaderCompositeLit("if", 0, first);
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

		let first = null;
		if (!this.check(T.SEMICOLON)) {
			first = this.parseSimpleStmtRaw(true);
			this._rejectHeaderCompositeLit("for", 1, first);

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
		}

		this.expect(T.SEMICOLON);

		// for init; cond; post { }
		let cond = null;
		if (!this.check(T.SEMICOLON)) cond = this.parseExpr(0, true);
		this.expect(T.SEMICOLON);
		let post = null;
		if (!this.check(T.LBRACE)) post = this.parseSimpleStmtRaw(true);
		const body = this.parseBlock();
		return { kind: "ForStmt", init: first, cond, post, body };
	},

	// `if s := &T{f: 1}; s.f > 0 {`: in a header, `{` after a type name opens
	// the body, so Go requires the literal to be parenthesized.  Reported when
	// the brace pair holds no statement tokens, is followed by an explicit `;`,
	// and the header then continues to its body `{` (with at most `semis`
	// further `;`, one for a `for` post statement).  A bare expression or a
	// range clause before the `{` (`if ok { f() };`) means it is the body.
	_rejectHeaderCompositeLit(keyword, semis, first) {
		if (!this.check(T.LBRACE)) return;
		if (first?.kind === "ExprStmt" || this.isRangeStmt(first)) return;
		const prev = this.tokens[this.pos - 1]?.type;
		if (prev !== T.IDENT && prev !== T.RBRACKET) return;
		const close = this._closingBrace(this.pos);
		if (close < 0) return;
		const semi = this.tokens[close + 1];
		if (semi?.type !== T.SEMICOLON || !this._isExplicitSemi(semi)) return;
		if (!this._headerContinues(close + 2, semis)) return;
		this.err(`composite literal in ${keyword} header must be parenthesized`);
	},

	// Index of the `}` matching the `{` at `open`, or -1 when the pair holds a
	// statement-only token at its top level (then it is a block).
	_closingBrace(open) {
		let depth = 0;
		for (let i = open; i < this.tokens.length; i++) {
			const tt = this.tokens[i].type;
			depth += bracketDelta(tt);
			if (depth === 0) return tt === T.RBRACE ? i : -1;
			if (tt === T.EOF || (depth === 1 && STMT_ONLY_TOKENS.has(tt))) return -1;
		}
		return -1;
	},

	_isExplicitSemi(tok) {
		if (!this.source) return false;
		this._sourceLines ??= this.source.split("\n");
		return this._sourceLines[tok.line - 1]?.[tok.col - 1] === ";";
	},

	// Whether the tokens from `i` reach a top-level `{` (the body) without a
	// statement keyword and with at most `semis` semicolons on the way.
	_headerContinues(i, semis) {
		let depth = 0;
		for (; i < this.tokens.length; i++) {
			const tt = this.tokens[i].type;
			if (tt === T.LBRACE && depth === 0) return true;
			depth += bracketDelta(tt);
			if (tt === T.SEMICOLON && depth === 0) semis--;
			if (depth < 0 || semis < 0) return false;
			if (tt === T.EOF || STMT_KEYWORDS.has(tt)) return false;
		}
		return false;
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
			this._rejectHeaderCompositeLit("switch", 0, first);
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
			const isCase = this.match(T.CASE);
			if (!isCase && !this.match(T.DEFAULT)) {
				this.err("Expected case or default");
			}
			const list = isCase ? this.parseExprList() : null;
			this.expect(T.COLON);
			cases.push({ kind: "CaseClause", list, stmts: this._parseCaseBody() });
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
			const isCase = this.match(T.CASE);
			if (!isCase && !this.match(T.DEFAULT)) {
				this.err("Expected case or default");
			}
			const types = isCase ? this._parseTypeSwitchTypeList() : null;
			this.expect(T.COLON);
			cases.push({ types, stmts: this._parseCaseBody() });
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
			while (this.match(T.COMMA)) lhs.push(this.parseExpr(0, noCompLit));
			const op = this.advance(); // := or =
			const rhs = this.parseExprList(noCompLit);
			if (op.type === T.DEFINE) return { kind: "DefineStmt", lhs, rhs };
			return { kind: "AssignStmt", lhs, op: "=", rhs };
		}

		// x := expr
		if (t.type === T.DEFINE) {
			this.advance();
			const rhs = this.parseExprList(noCompLit);
			return { kind: "DefineStmt", lhs: [first], rhs };
		}

		// x = expr  or  x += expr  etc.
		if (ASSIGN_OPS.has(t.type)) {
			const op = this.advance().value;
			const rhs = this.parseExprList(noCompLit);
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
