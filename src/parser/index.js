// Recursive-descent parser.  Produces an AST from a GoFront token stream.
//
// Split into sub-modules under parser/:
//   declarations.js — top-level declarations (func, method, type, var, const)
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

import { T } from "../tokens.js";
import { declarationParseMethods } from "./declarations.js";
import { expressionParserMethods } from "./expressions.js";
import { statementParserMethods } from "./statements.js";
import { typeParserMethods } from "./types.js";

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
		return {
			kind: "Program",
			pkg,
			imports,
			decls,
			_filename: this.filename,
			_source: this.source,
		};
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
}

Object.assign(Parser.prototype, typeParserMethods);
Object.assign(Parser.prototype, statementParserMethods);
Object.assign(Parser.prototype, expressionParserMethods);
Object.assign(Parser.prototype, declarationParseMethods);
