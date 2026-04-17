// Parser type-expression methods — installed as a mixin on Parser.prototype.

import { T } from "../lexer.js";

export const typeParserMethods = {
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
			case T.CHAN:
				return this.err("channels are not supported in GoFront");
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
		do {
			const name = this.expect(T.IDENT).value;
			const constraint = this.parseConstraint();
			params.push({ kind: "TypeParam", name, constraint });
		} while (this.match(T.COMMA));
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
