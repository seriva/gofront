import { T } from "../tokens.js";

export const declarationParseMethods = {
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
	},

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
			const recvPointer = Boolean(this.match(T.STAR));
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
				recvPointer,
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
		// `//gofront:intrinsic name` on the line before a body-less func: the
		// backend provides the implementation; every pass sees an empty body.
		const intrinsic = this.tokens?.intrinsics?.get(_line - 1) ?? null;
		const bodyless = intrinsic !== null && !this.check(T.LBRACE);
		const body = bodyless ? { kind: "Block", stmts: [] } : this.parseBlock();
		this.semi();
		return {
			kind: "FuncDecl",
			name,
			typeParams,
			params,
			returnType,
			body,
			...(intrinsic && { intrinsic, _bodyless: bodyless }),
			_line,
		};
	},

	parseAsyncFuncOrMethod() {
		this.expect(T.ASYNC);
		const decl = this.parseFuncOrMethod();
		decl.async = true;
		return decl;
	},

	// Returns true if tok is a receiver-list terminator (i.e. not a type name)
	isReceiverTerminator(tok) {
		return (
			tok &&
			(tok.type === T.RPAREN ||
				tok.type === T.COMMA ||
				tok.type === T.SEMICOLON ||
				tok.type === T.EOF)
		);
	},

	// Lookahead: does the [ ... ] after a func name or type name look like a type param list?
	// Type param lists contain IDENT followed by a constraint (another IDENT or keyword),
	// not expressions like integers or operators.
	_looksLikeTypeParamList() {
		let i = this.pos + 1; // skip [
		const src = this.tokens;
		if (!src[i] || src[i].type !== T.IDENT) return false;
		while (
			src[i] &&
			src[i].type === T.IDENT &&
			src[i + 1] &&
			src[i + 1].type === T.COMMA
		) {
			i += 2;
		}
		if (!src[i] || src[i].type !== T.IDENT) return false;
		const afterName = src[i + 1];
		if (!afterName) return false;
		if (afterName.type === T.IDENT) return true; // T any, T Stringer
		if (afterName.type === T.TILDE) return true; // T ~int
		if (afterName.type === T.INTERFACE) return true; // T interface{...}
		return false;
	},

	// `Name[…]` followed by `,` or `)` in a result list is an instantiated
	// generic type; a result name is followed by its type (`a []int`).
	_isGenericResultType() {
		if (this.peek2()?.type !== T.LBRACKET) return false;
		const src = this.tokens;
		let depth = 0;
		for (let i = this.pos + 1; i < src.length; i++) {
			const t = src[i].type;
			if (t === T.LBRACKET) depth++;
			else if (t === T.RBRACKET && --depth === 0) {
				const next = src[i + 1]?.type;
				return next === T.COMMA || next === T.RPAREN;
			} else if (t === T.EOF || t === T.LBRACE) return false;
		}
		return false;
	},

	parseSignature() {
		const params = this.parseParamList();
		const returnType = this.parseReturnType();
		return { params, returnType };
	},

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
	},

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
	},

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
	},

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
				// (`Box[int]` is an instantiated type, not a name followed by `[int]`).
				if (
					this.check(T.IDENT) &&
					this.looksLikeType(this.peek2()) &&
					!this._isGenericResultType()
				) {
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
	},

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
	},

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
	},

	parseVarSpec() {
		const names = this.parseIdentList();
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
	},

	parseConstDecl() {
		this.expect(T.CONST);
		const decls = [];
		if (this.match(T.LPAREN)) {
			let iotaVal = 0;
			let prevRawExprs = null; // raw AST (with iota Idents) from the previous spec
			let prevType = null;
			while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
				const names = this.parseIdentList();
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
			const names = this.parseIdentList();
			let type = null;
			if (!this.check(T.ASSIGN)) type = this.parseType();
			this.expect(T.ASSIGN);
			const value = this.parseExprList();
			decls.push({ names, type, value });
		}
		this.semi();
		return { kind: "ConstDecl", decls };
	},

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
	},
};
