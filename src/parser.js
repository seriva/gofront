// Recursive-descent parser.  Produces an AST from a GoFront token stream.
//
// Node kinds used throughout the compiler:
//   Program, PackageDecl, ImportDecl
//   FuncDecl, MethodDecl, VarDecl, ConstDecl, TypeDecl
//   StructType, InterfaceType, SliceType, MapType, FuncType, PointerType
//   Block, IfStmt, ForStmt, RangeStmt, ReturnStmt, BranchStmt
//   AssignStmt, DefineStmt, IncDecStmt, ExprStmt
//   SwitchStmt, CaseClause
//   Ident, BasicLit, UnaryExpr, BinaryExpr
//   CallExpr, SelectorExpr, IndexExpr, SliceExpr
//   CompositeLit, KeyValueExpr, FuncLit, AwaitExpr

import { T } from "./lexer.js";

export class ParseError extends Error {
	constructor(msg, token, filename, sourceCode) {
		const loc = filename
			? `${filename}:${token.line}:${token.col}`
			: `${token.line}:${token.col}`;
		let lineContext = "";
		if (token.line && sourceCode) {
			const lines = sourceCode.split("\n");
			const lineStr = lines[token.line - 1];
			if (lineStr !== undefined) {
				lineContext = `\n  ${token.line} | ${lineStr}`;
			}
		}
		super(
			`Parse error at ${loc}: ${msg} (got ${token.type} "${token.value}")${lineContext}`,
		);
		this.token = token;
	}
}

// Binary operator precedence (higher = binds tighter, matching Go spec)
const PREC = {
	[T.OR]: 1,
	[T.AND]: 2,
	[T.EQ]: 3,
	[T.NEQ]: 3,
	[T.LT]: 3,
	[T.GT]: 3,
	[T.LTE]: 3,
	[T.GTE]: 3,
	[T.PLUS]: 4,
	[T.MINUS]: 4,
	[T.PIPE]: 4,
	[T.CARET]: 4,
	[T.STAR]: 5,
	[T.SLASH]: 5,
	[T.PERCENT]: 5,
	[T.LSHIFT]: 5,
	[T.RSHIFT]: 5,
	[T.AMP]: 5,
};

export class Parser {
	constructor(tokens, filename = null, source = null) {
		this.tokens = tokens;
		this.pos = 0;
		this.filename = filename;
		this.source = source;
	}

	// ── Primitives ───────────────────────────────────────────────

	peek() {
		return this.tokens[this.pos];
	}
	peek2() {
		return this.tokens[this.pos + 1];
	}

	advance() {
		const t = this.tokens[this.pos];
		if (t.type !== T.EOF) this.pos++;
		return t;
	}

	check(type) {
		return this.peek().type === type;
	}
	check2(type) {
		return this.peek2().type === type;
	}

	match(...types) {
		for (const type of types) {
			if (this.check(type)) {
				this.advance();
				return true;
			}
		}
		return false;
	}

	expect(type) {
		if (!this.check(type))
			throw new ParseError(`expected '${type}'`, this.peek());
		return this.advance();
	}

	semi() {
		if (this.check(T.SEMICOLON)) this.advance();
	}

	err(msg) {
		throw new ParseError(msg, this.peek(), this.filename, this.source);
	}

	// ── Entry point ──────────────────────────────────────────────

	parse() {
		const pkg = this.parsePackage();
		const imports = [];
		while (this.check(T.IMPORT)) imports.push(this.parseImport());
		const decls = [];
		while (!this.check(T.EOF)) decls.push(this.parseTopDecl());
		return { kind: "Program", pkg, imports, decls, _filename: this.filename };
	}

	parsePackage() {
		this.expect(T.PACKAGE);
		const name = this.expect(T.IDENT).value;
		this.semi();
		return { kind: "PackageDecl", name };
	}

	parseImport() {
		this.expect(T.IMPORT);
		const imports = [];
		const parseOne = () => {
			const alias = this.check(T.IDENT) ? this.advance().value : null;
			const path = this.expect(T.STRING).value;
			return { path, alias };
		};
		if (this.match(T.LPAREN)) {
			while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
				imports.push(parseOne());
				this.semi();
			}
			this.expect(T.RPAREN);
		} else {
			imports.push(parseOne());
		}
		this.semi();
		return { kind: "ImportDecl", imports };
	}

	// ── Top-level declarations ───────────────────────────────────

	parseTopDecl() {
		const t = this.peek();
		switch (t.type) {
			case T.ASYNC:
				return this.parseAsyncFuncOrMethod();
			case T.FUNC:
				return this.parseFuncOrMethod();
			case T.TYPE:
				return this.parseTypeDecl();
			case T.VAR:
				return this.parseVarDecl();
			case T.CONST:
				return this.parseConstDecl();
			default:
				this.err("Expected top-level declaration");
		}
	}

	parseFuncOrMethod() {
		const _line = this.peek().line;
		this.expect(T.FUNC);
		// method: func (recv Type) Name(...)
		if (this.check(T.LPAREN)) {
			this.expect(T.LPAREN);
			const recvName =
				this.check(T.IDENT) && !this.isTypeName(this.peek2())
					? this.advance().value
					: "_";
			this.match(T.STAR); // pointer receiver: (c *Counter) — strip *, treat same as value receiver
			const recvType = this.parseTypeName();
			this.expect(T.RPAREN);
			const name = this.expect(T.IDENT).value;
			const { params, returnType } = this.parseSignature();
			const body = this.parseBlock();
			this.semi();
			return {
				kind: "MethodDecl",
				recvName,
				recvType,
				name,
				params,
				returnType,
				body,
				_line,
			};
		}
		// plain function
		const name = this.expect(T.IDENT).value;
		const { params, returnType } = this.parseSignature();
		const body = this.parseBlock();
		this.semi();
		return { kind: "FuncDecl", name, params, returnType, body, _line };
	}

	parseAsyncFuncOrMethod() {
		this.expect(T.ASYNC);
		const decl = this.parseFuncOrMethod();
		decl.async = true;
		return decl;
	}

	// Returns true if tok looks like a type name token (for receiver parsing)
	isTypeName(tok) {
		return (
			tok &&
			(tok.type === T.RPAREN ||
				tok.type === T.COMMA ||
				tok.type === T.SEMICOLON ||
				tok.type === T.EOF)
		);
	}

	parseSignature() {
		const params = this.parseParamList();
		const returnType = this.parseReturnType();
		return { params, returnType };
	}

	// Parses (a, b int, c string) style param list
	parseParamList() {
		this.expect(T.LPAREN);
		const params = [];
		if (!this.check(T.RPAREN)) {
			do {
				if (this.check(T.RPAREN)) break;
				// Collect names, then type
				const names = [];
				if (this.check(T.IDENT) && this.isParamType(this.peek2())) {
					// named: a, b int  or  ns ...int
					names.push(this.advance().value);
					while (
						this.match(T.COMMA) &&
						this.check(T.IDENT) &&
						this.isParamType(this.peek2())
					) {
						names.push(this.advance().value);
					}
					// variadic: name ...T
					const variadic = this.match(T.ELLIPSIS);
					const type = this.parseType();
					for (const n of names) params.push({ name: n, type, variadic });
				} else {
					// unnamed: just a type (possibly variadic: ...T)
					const variadic = this.match(T.ELLIPSIS);
					const type = this.parseType();
					params.push({ name: "_", type, variadic });
				}
			} while (this.match(T.COMMA));
		}
		this.expect(T.RPAREN);
		return params;
	}

	// Heuristic: peek2 is a param-name separator if it's a comma, rparen, or a type token
	isParamType(tok) {
		if (!tok) return false;
		// T.RPAREN is intentionally excluded: when peek2 is ")", the current IDENT
		// is the type of an unnamed param (e.g. func(int)), not a param name.
		return (
			tok.type === T.COMMA || tok.type === T.ELLIPSIS || this.looksLikeType(tok)
		);
	}

	looksLikeType(tok) {
		return (
			tok.type === T.LBRACKET ||
			tok.type === T.STAR ||
			tok.type === T.MAP ||
			tok.type === T.FUNC ||
			tok.type === T.INTERFACE ||
			tok.type === T.STRUCT ||
			(tok.type === T.IDENT && tok.value !== "_") ||
			[
				"int",
				"float64",
				"string",
				"bool",
				"any",
				"byte",
				"rune",
				"error",
			].includes(tok.value)
		);
	}

	parseReturnType(inTypeExpr = false) {
		// No return type
		if (
			this.check(T.LBRACE) ||
			this.check(T.RBRACE) ||
			this.check(T.SEMICOLON) ||
			this.check(T.EOF)
		)
			return null;
		// Inside a type expression (e.g. func type in a tuple), `,` and `)` also end the type
		if (inTypeExpr && (this.check(T.COMMA) || this.check(T.RPAREN)))
			return null;
		// Multiple return values: (int, string) or named (result int, ok bool)
		if (this.check(T.LPAREN)) {
			this.advance();
			const types = [];
			const names = []; // non-null if named returns
			let isNamed = false;
			do {
				// Named returns: only treat IDENT as a name if peek2 is an actual type token
				if (this.check(T.IDENT) && this.looksLikeType(this.peek2())) {
					names.push(this.advance().value);
					isNamed = true;
				} else {
					names.push(null);
				}
				types.push(this.parseType());
			} while (this.match(T.COMMA));
			this.expect(T.RPAREN);
			const typeNode =
				types.length === 1 ? types[0] : { kind: "TupleType", types };
			// Attach named return info so typechecker can inject them into scope
			if (isNamed)
				typeNode._namedReturns = names.map((n, i) => ({
					name: n,
					type: types[i],
				}));
			return typeNode;
		}
		return this.parseType();
	}

	parseTypeDecl() {
		this.expect(T.TYPE);
		const name = this.expect(T.IDENT).value;
		const isAlias = this.match(T.ASSIGN);
		const type = this.parseType();
		this.semi();
		return { kind: "TypeDecl", name, type, isAlias };
	}

	parseVarDecl() {
		this.expect(T.VAR);
		const decls = [];
		if (this.match(T.LPAREN)) {
			while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
				decls.push(this.parseVarSpec());
				this.semi();
			}
			this.expect(T.RPAREN);
		} else {
			decls.push(this.parseVarSpec());
		}
		this.semi();
		return { kind: "VarDecl", decls };
	}

	parseVarSpec() {
		const names = [this.expect(T.IDENT).value];
		while (this.match(T.COMMA)) names.push(this.expect(T.IDENT).value);
		let type = null;
		let value = null;
		if (
			!this.check(T.ASSIGN) &&
			!this.check(T.SEMICOLON) &&
			!this.check(T.RPAREN)
		) {
			type = this.parseType();
		}
		if (this.match(T.ASSIGN)) value = this.parseExprList();
		return { names, type, value };
	}

	parseConstDecl() {
		this.expect(T.CONST);
		const decls = [];
		if (this.match(T.LPAREN)) {
			let iotaVal = 0;
			while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
				const names = [this.expect(T.IDENT).value];
				while (this.match(T.COMMA)) names.push(this.expect(T.IDENT).value);
				let type = null;
				let value;
				if (this.check(T.ASSIGN)) {
					this.advance();
					value = this.parseExprList();
				} else if (!this.check(T.SEMICOLON) && !this.check(T.RPAREN)) {
					// optional type annotation before =
					type = this.parseType();
					this.expect(T.ASSIGN);
					value = this.parseExprList();
				} else {
					// implicit iota
					value = [
						{ kind: "BasicLit", litKind: "INT", value: String(iotaVal) },
					];
				}
				// Replace iota identifier with current counter value
				value = value.map((v) =>
					v.kind === "Ident" && v.name === "iota"
						? { kind: "BasicLit", litKind: "INT", value: String(iotaVal) }
						: v,
				);
				decls.push({ names, type, value });
				iotaVal++;
				this.semi();
			}
			this.expect(T.RPAREN);
		} else {
			const names = [this.expect(T.IDENT).value];
			while (this.match(T.COMMA)) names.push(this.expect(T.IDENT).value);
			let type = null;
			if (!this.check(T.ASSIGN)) type = this.parseType();
			this.expect(T.ASSIGN);
			const value = this.parseExprList();
			decls.push({ names, type, value });
		}
		this.semi();
		return { kind: "ConstDecl", decls };
	}

	// ── Types ────────────────────────────────────────────────────

	parseType() {
		const t = this.peek();
		switch (t.type) {
			case T.LBRACKET:
				return this.parseSliceOrArrayType();
			case T.MAP:
				return this.parseMapType();
			case T.FUNC:
				return this.parseFuncType();
			case T.STRUCT:
				return this.parseStructType();
			case T.INTERFACE:
				return this.parseInterfaceType();
			case T.STAR:
				this.advance();
				return { kind: "PointerType", base: this.parseType() };
			case T.IDENT:
			case "int":
			case "float64":
			case "string":
			case "bool":
			case "any":
			case "byte":
			case "rune":
			case "error":
				return this.parseTypeName();
			default:
				this.err(`Expected type, got '${t.value}'`);
		}
	}

	parseTypeName() {
		const t = this.advance();
		let name = t.value;
		// qualified: pkg.Type
		if (this.check(T.DOT)) {
			this.advance();
			name += `.${this.expect(T.IDENT).value}`;
		}
		return { kind: "TypeName", name };
	}

	parseSliceOrArrayType() {
		this.expect(T.LBRACKET);
		if (this.check(T.RBRACKET)) {
			// slice type: []T
			this.advance();
			return { kind: "SliceType", elem: this.parseType() };
		}
		if (this.match(T.ELLIPSIS)) {
			// [...]T — array with inferred length from composite literal
			this.expect(T.RBRACKET);
			return { kind: "ArrayType", inferLen: true, elem: this.parseType() };
		}
		// fixed array: [n]T — treated as slice for JS purposes
		const size = this.parseExpr();
		this.expect(T.RBRACKET);
		return { kind: "ArrayType", size, elem: this.parseType() };
	}

	parseMapType() {
		this.expect(T.MAP);
		this.expect(T.LBRACKET);
		const key = this.parseType();
		this.expect(T.RBRACKET);
		const value = this.parseType();
		return { kind: "MapType", key, value };
	}

	parseFuncType() {
		this.expect(T.FUNC);
		const params = this.parseParamList();
		const returnType = this.parseReturnType(true);
		return { kind: "FuncType", params, returnType };
	}

	parseStructType() {
		this.expect(T.STRUCT);
		this.expect(T.LBRACE);
		const fields = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			const names = [this.expect(T.IDENT).value];
			while (this.match(T.COMMA)) names.push(this.expect(T.IDENT).value);
			// Check if this is an embedded field (just a type name)
			// e.g., type T struct { Base }
			if (this.check(T.SEMICOLON) || this.check(T.RBRACE)) {
				const typeName = names[0]; // assuming no comma list for embedded
				fields.push({
					names: [],
					type: { kind: "TypeName", name: typeName },
					embedded: true,
				});
				this.semi();
				continue;
			}
			const type = this.parseType();
			// Consume optional struct tag (backtick string), e.g. `json:"name"`
			if (this.check(T.STRING)) this.advance();
			fields.push({ names, type });
			this.semi();
		}
		this.expect(T.RBRACE);
		return { kind: "StructType", fields };
	}

	parseInterfaceType() {
		this.expect(T.INTERFACE);
		this.expect(T.LBRACE);
		const methods = [];
		const embeds = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			const name = this.expect(T.IDENT).value;
			if (this.check(T.LPAREN)) {
				// Method signature: Name(params) returnType
				const params = this.parseParamList();
				const returnType = this.parseReturnType();
				methods.push({ name, params, returnType });
			} else {
				// Embedded interface: TypeName or pkg.TypeName
				let typeName = name;
				if (this.check(T.DOT)) {
					this.advance();
					typeName += `.${this.expect(T.IDENT).value}`;
				}
				embeds.push({ kind: "TypeName", name: typeName });
			}
			this.semi();
		}
		this.expect(T.RBRACE);
		return { kind: "InterfaceType", methods, embeds };
	}

	// ── Statements ───────────────────────────────────────────────

	parseBlock() {
		this.expect(T.LBRACE);
		const stmts = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			stmts.push(this.parseStmt());
			this.semi();
		}
		this.expect(T.RBRACE);
		return { kind: "Block", stmts };
	}

	parseStmt() {
		const t = this.peek();
		const stmt = this._parseStmt(t);
		stmt._line = t.line;
		return stmt;
	}

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
	}

	parseDefer() {
		this.expect(T.DEFER);
		const call = this.parseExpr();
		return { kind: "DeferStmt", call };
	}

	parseReturn() {
		this.expect(T.RETURN);
		if (this.check(T.SEMICOLON) || this.check(T.RBRACE)) {
			return { kind: "ReturnStmt", values: [] };
		}
		const values = this.parseExprList();
		return { kind: "ReturnStmt", values };
	}

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
	}

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
	}

	isRangeStmt(stmt) {
		if (!stmt) return false;
		if (stmt.kind !== "DefineStmt" && stmt.kind !== "AssignStmt") return false;
		return stmt.rhs?.[0]?.kind === "RangeExpr";
	}

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
	}

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
	}

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
	}

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
	}

	// Parses a "simple statement": assignment, define, inc/dec, or expression.
	// Returns a statement node.
	parseSimpleStmt() {
		const s = this.parseSimpleStmtRaw();
		return s;
	}

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
	}

	// Converts an ExprStmt back to its expression
	stmtToExpr(stmt) {
		if (!stmt) return null;
		if (stmt.kind === "ExprStmt") return stmt.expr;
		return stmt;
	}

	// ── Expressions ──────────────────────────────────────────────

	parseExprList() {
		const exprs = [this.parseExpr()];
		while (this.match(T.COMMA)) exprs.push(this.parseExpr());
		return exprs;
	}

	// noCompLit=true disables composite literal parsing in if/for/switch conditions
	// to resolve the ambiguity between "if x {" and "if Type{ } {"
	parseExpr(minPrec = 0, noCompLit = false) {
		let left = this.parseUnary(noCompLit);
		while (true) {
			const prec = PREC[this.peek().type];
			if (!prec || prec <= minPrec) break;
			const op = this.advance().value;
			const right = this.parseExpr(prec, noCompLit);
			left = { kind: "BinaryExpr", left, op, right };
		}
		return left;
	}

	parseUnary(noCompLit = false) {
		const t = this.peek();
		if (
			t.type === T.NOT ||
			t.type === T.MINUS ||
			t.type === T.PLUS ||
			t.type === T.CARET ||
			t.type === T.AMP ||
			t.type === T.STAR
		) {
			const op = this.advance().value;
			return { kind: "UnaryExpr", op, operand: this.parseUnary(noCompLit) };
		}
		if (t.type === T.AWAIT) {
			this.advance();
			return { kind: "AwaitExpr", expr: this.parseUnary(noCompLit) };
		}
		return this.parsePostfix(noCompLit);
	}

	parsePostfix(noCompLit = false) {
		let expr = this.parsePrimary();
		while (true) {
			const t = this.peek();
			if (t.type === T.DOT) {
				this.advance();
				// type assertion: expr.(Type)
				if (this.check(T.LPAREN)) {
					this.advance();
					// x.(type) — type switch guard expression
					if (this.check(T.TYPE)) {
						this.advance();
						this.expect(T.RPAREN);
						expr = { kind: "TypeSwitchExpr", expr };
					} else {
						const type = this.parseType();
						this.expect(T.RPAREN);
						expr = { kind: "TypeAssertExpr", expr, type };
					}
				} else {
					const field = this.advance().value;
					expr = { kind: "SelectorExpr", expr, field };
				}
			} else if (t.type === T.LBRACKET) {
				this.advance();
				const low = this.check(T.COLON) ? null : this.parseExpr();
				if (this.match(T.COLON)) {
					const high = this.check(T.RBRACKET) ? null : this.parseExpr();
					this.expect(T.RBRACKET);
					expr = { kind: "SliceExpr", expr, low, high };
				} else {
					this.expect(T.RBRACKET);
					expr = { kind: "IndexExpr", expr, index: low };
				}
			} else if (t.type === T.LPAREN) {
				expr = this.parseCall(expr);
			} else if (
				t.type === T.LBRACE &&
				!noCompLit &&
				this.isCompositeLitContext(expr)
			) {
				expr = this.parseCompositeLit(expr);
			} else {
				break;
			}
		}
		return expr;
	}

	// Composite literals are only allowed after a type name (not arbitrary exprs)
	isCompositeLitContext(expr) {
		return (
			expr.kind === "Ident" ||
			expr.kind === "SelectorExpr" ||
			expr.kind === "TypeExpr"
		);
	}

	parseCall(fn) {
		this.expect(T.LPAREN);
		const args = [];
		if (!this.check(T.RPAREN)) {
			do {
				if (this.check(T.RPAREN)) break;
				// map[K]V and []T as call args must be parsed as types, not expressions,
				// when they are NOT followed by { (which would make them composite literals).
				// Needed for make(map[K]V), make([]T, n), new(T), etc.
				const t = this.peek();
				const isSliceOrArrayType =
					t.type === T.LBRACKET &&
					(this.peek2()?.type === T.RBRACKET || // []T
						this.peek2()?.type === T.INT); // [n]T
				if (
					(t.type === T.MAP || isSliceOrArrayType) &&
					!this.looksLikeCompositeLitArg()
				) {
					const typeNode = this.parseType();
					// []byte(s) / []rune(s) used as a call argument — it's a type conversion
					if (this.check(T.LPAREN)) {
						this.advance();
						const convExpr = this.parseExpr();
						this.expect(T.RPAREN);
						args.push({
							kind: "TypeConversion",
							targetType: typeNode,
							expr: convExpr,
						});
					} else {
						args.push({ kind: "TypeExpr", type: typeNode });
					}
				} else {
					const arg = this.parseExpr();
					if (this.match(T.ELLIPSIS)) arg._spread = true;
					args.push(arg);
				}
			} while (this.match(T.COMMA));
		}
		this.expect(T.RPAREN);
		return { kind: "CallExpr", func: fn, args };
	}

	// Returns true if the current position looks like a composite literal argument,
	// e.g. []int{1,2,3} or map[string]int{"a":1}.  We scan ahead past the type
	// tokens to check whether a { follows, without advancing this.pos permanently.
	looksLikeCompositeLitArg() {
		let i = this.pos;
		const src = this.tokens;
		// Skip over the type tokens: [, ], map, [, K, ], V, ident, etc.
		// Simple approach: skip until we hit something that can't be part of a type
		let depth = 0;
		while (i < src.length) {
			const tt = src[i].type;
			if (tt === T.LBRACKET) {
				depth++;
				i++;
				continue;
			}
			if (tt === T.RBRACKET) {
				depth--;
				i++;
				continue;
			}
			if (depth > 0) {
				i++;
				continue;
			}
			if (
				tt === T.MAP ||
				tt === T.IDENT ||
				tt === T.STAR ||
				tt === T.INT ||
				tt === T.FLOAT ||
				tt === T.STRING
			) {
				i++;
				continue;
			}
			break;
		}
		// Skip whitespace tokens (shouldn't exist post-lex, but be safe)
		while (i < src.length && src[i].type === T.SEMICOLON) i++;
		return i < src.length && src[i].type === T.LBRACE;
	}

	parseCompositeLit(typeExpr) {
		this.expect(T.LBRACE);
		const elems = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			// Implicit composite literal: {X: 1} inside []Point{{X:1}} or map[string]Point{"a": {X:1}}
			if (this.check(T.LBRACE)) {
				elems.push(this.parseCompositeLit(null)); // null typeExpr = inferred
			} else {
				const first = this.parseExpr();
				if (this.match(T.COLON)) {
					// Map key: value — value may also be an implicit composite lit
					const val = this.check(T.LBRACE)
						? this.parseCompositeLit(null)
						: this.parseExpr();
					elems.push({ kind: "KeyValueExpr", key: first, value: val });
				} else {
					elems.push(first);
				}
			}
			this.match(T.COMMA);
		}
		this.expect(T.RBRACE);
		return { kind: "CompositeLit", typeExpr, elems };
	}

	parsePrimary() {
		const line = this.peek().line;
		const expr = this._parsePrimary();
		if (!expr._line) expr._line = line;
		return expr;
	}

	_parsePrimary() {
		const t = this.peek();

		// Literals
		if (t.type === T.INT) {
			this.advance();
			return { kind: "BasicLit", litKind: "INT", value: t.value };
		}
		if (t.type === T.FLOAT) {
			this.advance();
			return { kind: "BasicLit", litKind: "FLOAT", value: t.value };
		}
		if (t.type === T.STRING) {
			this.advance();
			return { kind: "BasicLit", litKind: "STRING", value: t.value };
		}
		if (t.type === T.TRUE) {
			this.advance();
			return { kind: "BasicLit", litKind: "BOOL", value: "true" };
		}
		if (t.type === T.FALSE) {
			this.advance();
			return { kind: "BasicLit", litKind: "BOOL", value: "false" };
		}
		if (t.type === T.NIL) {
			this.advance();
			return { kind: "BasicLit", litKind: "NIL", value: "null" };
		}

		// Parenthesised expression
		if (t.type === T.LPAREN) {
			this.advance();
			const expr = this.parseExpr();
			this.expect(T.RPAREN);
			return expr;
		}

		// Function literal (sync or async)
		if (t.type === T.FUNC || t.type === T.ASYNC) {
			const isAsync = t.type === T.ASYNC;
			this.advance();
			if (isAsync) this.expect(T.FUNC);
			const params = this.parseParamList();
			const returnType = this.parseReturnType();
			const body = this.parseBlock();
			return { kind: "FuncLit", params, returnType, body, async: isAsync };
		}

		// range expression (only valid inside a for statement)
		if (t.type === T.RANGE) {
			this.advance();
			// Always use noCompLit here: "range slice {" — { is the for body, not a composite lit
			return { kind: "RangeExpr", expr: this.parseExpr(0, true) };
		}

		// Builtin / identifier
		if (
			t.type === T.IDENT ||
			this.isTypeKeyword(t) ||
			this.isBuiltinKeyword(t)
		) {
			this.advance();
			// Type conversion or composite lit: Type(expr) or Type{...}
			if (this.isTypeKeyword(t) || this.check(T.LPAREN)) {
				if (this.check(T.LPAREN) && this.isTypeKeyword(t)) {
					// type conversion: int(x), string(x), etc.
					this.advance();
					const expr = this.parseExpr();
					this.expect(T.RPAREN);
					return {
						kind: "TypeConversion",
						targetType: { kind: "TypeName", name: t.value },
						expr,
					};
				}
			}
			return { kind: "Ident", name: t.value };
		}

		// Slice/array/map composite literals or type conversions:
		//   []int{1,2}           → CompositeLit
		//   []byte(s), []rune(s) → TypeConversion
		if (t.type === T.LBRACKET || t.type === T.MAP) {
			const typeExpr = this.parseType();
			if (this.check(T.LPAREN)) {
				this.advance();
				const expr = this.parseExpr();
				this.expect(T.RPAREN);
				return { kind: "TypeConversion", targetType: typeExpr, expr };
			}
			return this.parseCompositeLit(typeExpr);
		}

		this.err(`Unexpected token in expression: '${t.value}'`);
	}

	isTypeKeyword(t) {
		return [
			"int",
			"float64",
			"string",
			"bool",
			"any",
			"byte",
			"rune",
			"error",
		].includes(t.value);
	}

	isBuiltinKeyword(t) {
		return [
			"new",
			"make",
			"len",
			"cap",
			"append",
			"delete",
			"copy",
			"print",
			"println",
			"panic",
			"error",
		].includes(t.value);
	}
}
