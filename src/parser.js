// Recursive-descent parser.  Produces an AST from a GoFront token stream.
//
// Split into sub-modules under parser/:
//   types.js        — type expression parsing (slice, map, struct, interface, etc.)
//   statements.js   — block, control flow, simple statements
//   expressions.js  — operator precedence, unary, postfix, primary, literals
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
import { expressionParserMethods } from "./parser/expressions.js";
import { statementParserMethods } from "./parser/statements.js";
import { typeParserMethods } from "./parser/types.js";

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
		while (!this.check(T.EOF)) {
			const result = this.parseTopDecl();
			if (Array.isArray(result)) decls.push(...result);
			else decls.push(result);
		}
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
			const _line = this.peek().line;
			let alias = null;
			if (this.check(T.IDENT)) {
				alias = this.advance().value;
			} else if (this.check(T.DOT)) {
				alias = ".";
				this.advance();
			}
			const path = this.expect(T.STRING).value;
			return { path, alias, _line };
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
				this.check(T.IDENT) && !this.isReceiverTerminator(this.peek2())
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
		// generic function: func Name[T any, U Stringer](...) ...
		let typeParams = null;
		if (this.check(T.LBRACKET) && this._looksLikeTypeParamList()) {
			typeParams = this.parseTypeParamList();
		}
		const { params, returnType } = this.parseSignature();
		const body = this.parseBlock();
		this.semi();
		return {
			kind: "FuncDecl",
			name,
			typeParams,
			params,
			returnType,
			body,
			_line,
		};
	}

	parseAsyncFuncOrMethod() {
		this.expect(T.ASYNC);
		const decl = this.parseFuncOrMethod();
		decl.async = true;
		return decl;
	}

	// Returns true if tok is a receiver-list terminator (i.e. not a type name)
	isReceiverTerminator(tok) {
		return (
			tok &&
			(tok.type === T.RPAREN ||
				tok.type === T.COMMA ||
				tok.type === T.SEMICOLON ||
				tok.type === T.EOF)
		);
	}

	// Lookahead: does the [ ... ] after a func name or type name look like a type param list?
	// Type param lists contain IDENT followed by a constraint (another IDENT or keyword),
	// not expressions like integers or operators.
	_looksLikeTypeParamList() {
		const i = this.pos + 1; // skip [
		const src = this.tokens;
		// First token must be an IDENT (the type param name)
		if (!src[i] || src[i].type !== T.IDENT) return false;
		// Second token should be a constraint (IDENT like 'any', 'comparable', another type name)
		// or TILDE for union constraints
		const second = src[i + 1];
		if (!second) return false;
		if (second.type === T.IDENT) return true; // T any, T Stringer
		if (second.type === T.TILDE) return true; // T ~int
		if (second.type === T.INTERFACE) return true; // T interface{...}
		return false;
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
				if (this.check(T.IDENT) && this._isNamedParam()) {
					// named: a, b int  or  ns ...int
					names.push(this.advance().value);
					while (
						this.match(T.COMMA) &&
						this.check(T.IDENT) &&
						this._isNamedParam()
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

	// Lookahead: determine if current IDENT starts a named param (name type)
	// vs an unnamed param (just a type). Scans IDENT (COMMA IDENT)* and checks
	// if a type-start token follows — if so, the IDENTs are names; if ) or ,
	// follows, the IDENTs are themselves types.
	_isNamedParam() {
		let pos = this.pos + 1; // skip current IDENT
		while (
			this.tokens[pos]?.type === T.COMMA &&
			this.tokens[pos + 1]?.type === T.IDENT
		) {
			pos += 2;
		}
		const next = this.tokens[pos];
		if (!next) return false;
		return this.looksLikeType(next) || next.type === T.ELLIPSIS;
	}

	looksLikeType(tok) {
		return (
			tok.type === T.LBRACKET ||
			tok.type === T.STAR ||
			tok.type === T.MAP ||
			tok.type === T.FUNC ||
			tok.type === T.INTERFACE ||
			tok.type === T.STRUCT ||
			(tok.type === T.IDENT && tok.value !== "_")
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
		if (this.match(T.LPAREN)) {
			const decls = [];
			while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
				const name = this.expect(T.IDENT).value;
				const isAlias = this.match(T.ASSIGN);
				const type = this.parseType();
				decls.push({ kind: "TypeDecl", name, type, isAlias });
				this.semi();
			}
			this.expect(T.RPAREN);
			this.semi();
			return decls;
		}
		const name = this.expect(T.IDENT).value;
		// generic type: type Name[T any] struct { ... }
		let typeParams = null;
		if (this.check(T.LBRACKET) && this._looksLikeTypeParamList()) {
			typeParams = this.parseTypeParamList();
		}
		const isAlias = this.match(T.ASSIGN);
		const type = this.parseType();
		this.semi();
		return { kind: "TypeDecl", name, typeParams, type, isAlias };
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
			let prevRawExprs = null; // raw AST (with iota Idents) from the previous spec
			let prevType = null;
			while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
				const names = [this.expect(T.IDENT).value];
				while (this.match(T.COMMA)) names.push(this.expect(T.IDENT).value);
				let type = null;
				let rawExprs; // before iota substitution
				if (this.check(T.ASSIGN)) {
					this.advance();
					rawExprs = this.parseExprList();
					prevRawExprs = rawExprs;
					prevType = null;
				} else if (!this.check(T.SEMICOLON) && !this.check(T.RPAREN)) {
					// optional type annotation before =
					type = this.parseType();
					prevType = type;
					this.expect(T.ASSIGN);
					rawExprs = this.parseExprList();
					prevRawExprs = rawExprs;
				} else {
					// Omitted expression — repeat previous expression with updated iota
					rawExprs = prevRawExprs ?? [
						{ kind: "BasicLit", litKind: "INT", value: String(iotaVal) },
					];
					type = prevType ?? null;
				}
				// Substitute iota deeply in a cloned expression AST
				const value = rawExprs.map((v) => this._substituteIota(v, iotaVal));
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

	// Deep-clone an expression AST, replacing `iota` identifiers with the given integer.
	_substituteIota(node, val) {
		if (!node || typeof node !== "object") return node;
		if (node.kind === "Ident" && node.name === "iota") {
			return { kind: "BasicLit", litKind: "INT", value: String(val) };
		}
		// Shallow-clone the node, then recursively substitute in all child properties
		const clone = { ...node };
		for (const key of Object.keys(clone)) {
			const v = clone[key];
			if (Array.isArray(v)) {
				clone[key] = v.map((item) => this._substituteIota(item, val));
			} else if (v && typeof v === "object" && v.kind) {
				clone[key] = this._substituteIota(v, val);
			}
		}
		return clone;
	}
}

Object.assign(Parser.prototype, typeParserMethods);
Object.assign(Parser.prototype, statementParserMethods);
Object.assign(Parser.prototype, expressionParserMethods);
