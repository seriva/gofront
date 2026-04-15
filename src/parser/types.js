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
		return { kind: "TypeName", name };
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
	},
};
