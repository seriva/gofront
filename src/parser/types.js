// Parser type-expression methods — installed as a mixin on Parser.prototype.

import { T } from "../lexer/tokens.js";

// Token types that directly map to parseTypeName().
const TYPE_NAME_TOKENS = new Set([
	T.IDENT,
	"int",
	"float64",
	"string",
	"bool",
	"any",
	"byte",
	"rune",
	"error",
]);
// Method-name dispatch for the simple keyword cases in parseType().
const PARSE_TYPE_DELEGATE = {
	[T.LBRACKET]: "parseSliceOrArrayType",
	[T.MAP]: "parseMapType",
	[T.FUNC]: "parseFuncType",
	[T.STRUCT]: "parseStructType",
	[T.INTERFACE]: "parseInterfaceType",
};

export const typeParserMethods = {
	parseType() {
		const t = this.peek();
		const delegate = PARSE_TYPE_DELEGATE[t.type];
		if (delegate) return this[delegate]();
		if (TYPE_NAME_TOKENS.has(t.type)) return this.parseTypeName();
		if (t.type === T.STAR) {
			this.advance();
			return { kind: "PointerType", base: this.parseType() };
		}
		if (t.type === T.CHAN)
			return this.err("channels are not supported in GoFront");
		return this.err(`Expected type, got '${t.value}'`);
	},

	parseTypeName() {
		const t = this.advance();
		let name = t.value;
		// qualified: pkg.Type
		if (this.check(T.DOT)) {
			this.advance();
			name += `.${this.expect(T.IDENT).value}`;
		}
		// Generic type instantiation: Type[int, string]
		if (this.check(T.LBRACKET) && this._looksLikeTypeArgListInType()) {
			this.expect(T.LBRACKET);
			const typeArgs = [this.parseType()];
			while (this.match(T.COMMA)) typeArgs.push(this.parseType());
			this.expect(T.RBRACKET);
			return { kind: "GenericTypeName", name, typeArgs };
		}
		return { kind: "TypeName", name };
	},

	// Lookahead to distinguish Type[int] (generic) from [n]T (array) in type context.
	// Scans from [ to matching ] looking for only type-like tokens.
	_looksLikeTypeArgListInType() {
		let i = this.pos + 1; // skip [
		const src = this.tokens;
		let depth = 1;
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
			// Reject literals — it's an index/array expression
			if (tt === T.INT || tt === T.FLOAT || tt === T.STRING) return false;
			i++;
		}
		return depth === 0;
	},

	parseTypeParamList() {
		this.expect(T.LBRACKET);
		const params = [];
		while (!this.check(T.RBRACKET) && !this.check(T.EOF)) {
			const names = [this.expect(T.IDENT).value];
			while (this.match(T.COMMA)) {
				names.push(this.expect(T.IDENT).value);
			}
			const constraint = this.parseConstraint();
			for (const name of names) {
				params.push({ kind: "TypeParam", name, constraint });
			}
			if (!this.match(T.COMMA)) break;
		}
		this.expect(T.RBRACKET);
		return params;
	},

	parseConstraint() {
		// Union constraint: ~int | ~string or int | string
		if (
			this.check(T.TILDE) ||
			(this.check(T.IDENT) && this._looksLikeUnionConstraint())
		) {
			return this._parseUnionConstraint();
		}
		// Single constraint: any, comparable, or named type
		return this.parseType();
	},

	_looksLikeUnionConstraint() {
		// Check if after the identifier there's a | before the next , or ]
		let i = this.pos + 1;
		const src = this.tokens;
		while (i < src.length) {
			const tt = src[i].type;
			if (tt === T.PIPE) return true;
			if (
				tt === T.COMMA ||
				tt === T.RBRACKET ||
				tt === T.SEMICOLON ||
				tt === T.EOF
			)
				return false;
			i++;
		}
		return false;
	},

	_parseUnionConstraint() {
		const terms = [];
		do {
			const approx = this.match(T.TILDE);
			const type = this.parseType();
			terms.push({ approx, type });
		} while (this.match(T.PIPE));
		return { kind: "UnionConstraint", terms };
	},

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
	},

	parseMapType() {
		this.expect(T.MAP);
		this.expect(T.LBRACKET);
		const key = this.parseType();
		this.expect(T.RBRACKET);
		const value = this.parseType();
		return { kind: "MapType", key, value };
	},

	parseFuncType() {
		this.expect(T.FUNC);
		const params = this.parseParamList();
		const returnType = this.parseReturnType(true);
		return { kind: "FuncType", params, returnType };
	},

	parseStructType() {
		this.expect(T.STRUCT);
		this.expect(T.LBRACE);
		const fields = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			// Embedded pointer field: *Base or *pkg.Base
			if (this.check(T.STAR)) {
				this.advance();
				let typeName = this.expect(T.IDENT).value;
				if (this.check(T.DOT)) {
					this.advance();
					typeName += `.${this.expect(T.IDENT).value}`;
				}
				const type = {
					kind: "PointerType",
					base: { kind: "TypeName", name: typeName },
				};
				let tag = null;
				if (this.check(T.STRING)) {
					tag = this.advance().value;
				}
				fields.push({
					names: [],
					type,
					embedded: true,
					tag,
				});
				this.semi();
				continue;
			}

			const names = this.parseIdentList();
			// Check if this is a qualified embedded field: pkg.Base
			if (names.length === 1 && this.check(T.DOT)) {
				this.advance();
				const typeName = `${names[0]}.${this.expect(T.IDENT).value}`;
				let tag = null;
				if (this.check(T.STRING)) {
					tag = this.advance().value;
				}
				fields.push({
					names: [],
					type: { kind: "TypeName", name: typeName },
					embedded: true,
					tag,
				});
				this.semi();
				continue;
			}

			// Embedded field (just a type name, e.g. Base), optionally tagged
			if (
				names.length === 1 &&
				(this.check(T.SEMICOLON) ||
					this.check(T.RBRACE) ||
					this.check(T.STRING))
			) {
				const typeName = names[0];
				let tag = null;
				if (this.check(T.STRING)) {
					tag = this.advance().value;
				}
				fields.push({
					names: [],
					type: { kind: "TypeName", name: typeName },
					embedded: true,
					tag,
				});
				this.semi();
				continue;
			}

			const type = this.parseType();
			// Consume optional struct tag (backtick string), e.g. `json:"name"`
			let tag = null;
			if (this.check(T.STRING)) {
				tag = this.advance().value;
			}
			fields.push({ names, type, tag });
			this.semi();
		}
		this.expect(T.RBRACE);
		return { kind: "StructType", fields };
	},

	parseInterfaceType() {
		this.expect(T.INTERFACE);
		this.expect(T.LBRACE);
		const methods = [];
		const embeds = [];
		let unionConstraint = null;
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			// Union constraint element: ~int | ~string
			if (this.check(T.TILDE)) {
				unionConstraint = this._parseUnionConstraint();
				this.semi();
				continue;
			}
			const name = this.expect(T.IDENT).value;
			if (this.check(T.LPAREN)) {
				// Method signature: Name(params) returnType
				const params = this.parseParamList();
				const returnType = this.parseReturnType();
				methods.push({ name, params, returnType });
			} else if (this.check(T.PIPE) || this.check(T.TILDE)) {
				// Union constraint starting with a type name: int | string
				// We already consumed the first ident, build the union
				const terms = [{ approx: false, type: { kind: "TypeName", name } }];
				while (this.match(T.PIPE)) {
					const approx = this.match(T.TILDE);
					const type = this.parseType();
					terms.push({ approx, type });
				}
				unionConstraint = { kind: "UnionConstraint", terms };
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
		const node = { kind: "InterfaceType", methods, embeds };
		if (unionConstraint) node.unionConstraint = unionConstraint;
		return node;
	},
};
