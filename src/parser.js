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
}

Object.assign(Parser.prototype, typeParserMethods);
Object.assign(Parser.prototype, statementParserMethods);
Object.assign(Parser.prototype, expressionParserMethods);
