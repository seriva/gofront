// Parser expression methods — installed as a mixin on Parser.prototype.

import { T } from "../lexer.js";

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
	[T.AND_NOT]: 5,
};

const TYPE_KEYWORDS = new Set([
	"int",
	"float64",
	"string",
	"bool",
	"any",
	"byte",
	"rune",
	"error",
	"complex64",
	"complex128",
]);

const BUILTIN_KEYWORDS = new Set([
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
	"complex",
	"real",
	"imag",
]);

export const expressionParserMethods = {
	parseExprList() {
		const exprs = [this.parseExpr()];
		while (this.match(T.COMMA)) exprs.push(this.parseExpr());
		return exprs;
	},

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
	},

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
	},

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
				// Check if this looks like generic type args: Ident[Type](...)  or Ident[Type]{...}
				if (expr.kind === "Ident" && this.looksLikeTypeArgList()) {
					this.advance(); // consume [
					const typeArgs = [this.parseType()];
					while (this.match(T.COMMA)) typeArgs.push(this.parseType());
					this.expect(T.RBRACKET);
					expr = {
						kind: "InstantiationExpr",
						expr,
						typeArgs,
						_line: expr._line,
					};
				} else {
					this.advance();
					const low = this.check(T.COLON) ? null : this.parseExpr();
					if (this.match(T.COLON)) {
						const high =
							this.check(T.RBRACKET) || this.check(T.COLON)
								? null
								: this.parseExpr();
						let max = null;
						if (this.match(T.COLON)) {
							max = this.parseExpr();
						}
						this.expect(T.RBRACKET);
						expr = { kind: "SliceExpr", expr, low, high, max };
					} else {
						this.expect(T.RBRACKET);
						expr = { kind: "IndexExpr", expr, index: low };
					}
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
	},

	// Composite literals are only allowed after a type name (not arbitrary exprs)
	isCompositeLitContext(expr) {
		return (
			expr.kind === "Ident" ||
			expr.kind === "SelectorExpr" ||
			expr.kind === "TypeExpr" ||
			expr.kind === "StructType" ||
			expr.kind === "InstantiationExpr"
		);
	},

	// Lookahead: does the [ ... ] after an Ident look like generic type args?
	// Returns true if: only type-like tokens inside brackets, AND followed by a valid continuation
	looksLikeTypeArgList() {
		let i = this.pos + 1; // skip [
		const src = this.tokens;
		let depth = 1;
		let hasComma = false;
		let hasTypeKeyword = false;
		while (i < src.length && depth > 0) {
			const tt = src[i].type;
			if (tt === T.LBRACKET) {
				depth++;
				i++;
				continue;
			}
			if (tt === T.RBRACKET) {
				depth--;
				if (depth === 0) break;
				i++;
				continue;
			}
			// Reject literals — it's an index expression
			if (tt === T.INT || tt === T.FLOAT || tt === T.STRING) return false;
			// Reject binary operators that wouldn't appear in type args
			if (
				tt === T.PLUS ||
				tt === T.MINUS ||
				tt === T.PERCENT ||
				tt === T.SLASH ||
				tt === T.AND ||
				tt === T.OR ||
				tt === T.CARET ||
				tt === T.NOT ||
				tt === T.LT ||
				tt === T.GT ||
				tt === T.LTE ||
				tt === T.GTE ||
				tt === T.EQ ||
				tt === T.NEQ ||
				tt === T.LSHIFT ||
				tt === T.RSHIFT ||
				tt === T.AND_NOT ||
				tt === T.COLON ||
				tt === T.DEFINE ||
				tt === T.ASSIGN
			)
				return false;
			if (depth === 1) {
				if (tt === T.COMMA) hasComma = true;
				if (
					tt === T.STAR ||
					tt === T.MAP ||
					tt === T.FUNC ||
					tt === T.INTERFACE ||
					tt === T.STRUCT
				)
					hasTypeKeyword = true;
				// Check if it's a builtin type name
				if (tt === T.IDENT && TYPE_KEYWORDS.has(src[i].value))
					hasTypeKeyword = true;
			}
			i++;
		}
		if (depth !== 0) return false;
		// Check what follows ]
		const after = src[i + 1];
		if (!after) return false;
		// Call or composite lit — always valid as type args
		if (after.type === T.LPAREN || after.type === T.LBRACE) return true;
		// Function value in argument list: Identity[int], 99) — only if clearly a type
		if (after.type === T.COMMA || after.type === T.RPAREN) {
			return hasComma || hasTypeKeyword;
		}
		return false;
	},

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
	},

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
	},

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
	},

	parsePrimary() {
		const line = this.peek().line;
		const expr = this._parsePrimary();
		if (!expr._line) expr._line = line;
		return expr;
	},

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
		if (t.type === T.IMAG) {
			this.advance();
			return { kind: "ImagLit", value: t.value };
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
			if (this.isTypeKeyword(t) && this.check(T.LPAREN)) {
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

		// Anonymous struct composite literal: struct{Name string}{Name: "Alice"}
		if (t.type === T.STRUCT) {
			const typeExpr = this.parseStructType();
			return this.parseCompositeLit(typeExpr);
		}

		if (t.type === T.CHAN) {
			this.err("channels are not supported in GoFront");
		}

		this.err(`Unexpected token in expression: '${t.value}'`);
	},

	isTypeKeyword(t) {
		return TYPE_KEYWORDS.has(t.value);
	},

	isBuiltinKeyword(t) {
		return BUILTIN_KEYWORDS.has(t.value);
	},
};
