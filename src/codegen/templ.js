// Templ (.templ file) code-generation mixin for CodeGen.
// Mounts an HTML/expression tree onto a parent DOM node by emitting plain
// document.createElement / appendChild / setAttribute calls.

import { Parser } from "../parser/index.js";
import { T, Token } from "../tokens.js";

export const templGenMethods = {
	genTemplDecl(decl) {
		const params = decl.params
			.map((p, i) =>
				p.variadic && i === decl.params.length - 1 ? `...${p.name}` : p.name,
			)
			.join(", ");
		this.line(`function ${decl.name}(${params}) {`);
		this.indented(() => {
			this.line(`return {Mount(___p) {`);
			this.indented(() => {
				this._genTemplNodes(decl.body, "___p");
			});
			this.line(`}};`);
		});
		this.line("}");
	},

	// Emit mount statements for an array of TemplNodes into parent variable `p`.
	_genTemplNodes(nodes, p) {
		if (!nodes || nodes.length === 0) return;
		if (nodes.length === 1) {
			this._genTemplNodeMount(nodes[0], p);
			return;
		}
		// Wrap multiple root nodes in a fragment div? No — emit each directly.
		for (const node of nodes) {
			this._genTemplNodeMount(node, p);
		}
	},

	// Emit JS to mount a single TemplNode onto parent `p`.
	_genTemplNodeMount(node, p) {
		switch (node.kind) {
			case "TemplElement":
				return this._genTemplElement(node, p);
			case "TemplText":
				return this.line(
					`${p}.appendChild(document.createTextNode(${JSON.stringify(node.value)}));`,
				);
			case "TemplExpr":
				return this.line(
					`${p}.appendChild(document.createTextNode(String(${this._genTemplTokenExpr(node.tokens)})));`,
				);
			case "TemplComponent":
				return this._genTemplComponentMount(node, p);
			case "TemplChildren":
				// children is a variadic gom.Node param — mount each child
				return this.line(
					`if(typeof children!=="undefined")(Array.isArray(children)?children:[...children]).forEach(___c=>___c?.Mount?.(${p}));`,
				);
			case "TemplIf":
				return this._genTemplIf(node, p);
			case "TemplFor":
				return this._genTemplFor(node, p);
			case "TemplSwitch":
				return this._genTemplSwitch(node, p);
			default:
				break;
		}
	},

	_genTemplComponentMount(node, p) {
		// Special case: @templ.Raw(expr) → insertAdjacentHTML
		const toks = node.tokens;
		if (
			toks.length >= 4 &&
			toks[0]?.value === "templ" &&
			toks[1]?.type === T.DOT &&
			toks[2]?.value === "Raw" &&
			toks[3]?.type === T.LPAREN
		) {
			const argTokens = toks.slice(4, toks.length - 1);
			const argJs = this._genTemplTokenExpr(argTokens);
			return this.line(`${p}.insertAdjacentHTML("beforeend", ${argJs});`);
		}
		return this.line(
			`(${this._genTemplTokenCallExpr(node.tokens)}).Mount(${p});`,
		);
	},

	_genTemplElement(node, p) {
		const { tag, attrs, children } = node;
		const elVar = this._freshVar("e");
		this.line(
			`const ${elVar} = document.createElement(${JSON.stringify(tag)});`,
		);
		for (const attr of attrs) {
			this._genTemplAttr(attr, elVar);
		}
		this._genTemplNodes(children, elVar);
		this.line(`${p}.appendChild(${elVar});`);
	},

	_genTemplAttr(attr, el) {
		const { name } = attr;
		if (attr.kind === "static") {
			if (name === "class") {
				this.line(`${el}.className = ${JSON.stringify(attr.value)};`);
			} else {
				this.line(
					`${el}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(attr.value)});`,
				);
			}
		} else if (attr.kind === "expr") {
			const exprJs = this._genTemplTokenExpr(attr.tokens);
			if (name === "class") {
				this.line(`${el}.className = ${exprJs};`);
			} else {
				this.line(
					`${el}.setAttribute(${JSON.stringify(name)}, String(${exprJs}));`,
				);
			}
		} else if (attr.kind === "bool") {
			this.line(`${el}.setAttribute(${JSON.stringify(name)}, "");`);
		} else if (attr.kind === "cond-bool") {
			const exprJs = this._genTemplTokenExpr(attr.tokens);
			this.line(
				`if(${exprJs})${el}.setAttribute(${JSON.stringify(name)}, "");`,
			);
		}
	},

	_genTemplIf(node, p) {
		const condJs = this._genTemplCondTokens(node.condTokens);
		this.line(`if (${condJs}) {`);
		this.indented(() => this._genTemplNodes(node.then, p));
		this._genTemplIfElse(node.else_, p);
	},

	_genTemplIfElse(else_, p) {
		if (!else_ || else_.length === 0) {
			this.line(`}`);
			return;
		}
		if (else_.length === 1 && else_[0].kind === "TemplIf") {
			const elseIf = else_[0];
			this.line(`} else if (${this._genTemplCondTokens(elseIf.condTokens)}) {`);
			this.indented(() => this._genTemplNodes(elseIf.then, p));
			this._genTemplIfElse(elseIf.else_, p);
		} else {
			this.line(`} else {`);
			this.indented(() => this._genTemplNodes(else_, p));
			this.line(`}`);
		}
	},

	_genTemplSwitch(node, p) {
		const { exprTokens, cases } = node;
		if (cases.length === 0) return;
		const exprJs = this._genTemplTokenExpr(exprTokens);
		this.line(`switch (${exprJs}) {`);
		this.indented(() => {
			for (const c of cases) {
				const label =
					c.caseTokens === null
						? "default"
						: `case ${this._genTemplTokenExpr(c.caseTokens)}`;
				this.line(`${label}: {`);
				this.indented(() => this._genTemplNodes(c.body, p));
				this.line(`break; }`);
			}
		});
		this.line(`}`);
	},

	_genTemplFor(node, p) {
		// stmtTokens include the `for` keyword plus the range clause (no body).
		// Strip any trailing semicolons (inserted by the Go lexer on newlines),
		// then add a fake empty body `{ }` so the parser can complete the ForStmt.
		let tokens = node.stmtTokens;
		while (tokens.length > 0 && tokens[tokens.length - 1].type === T.SEMICOLON)
			tokens = tokens.slice(0, -1);
		const eofTok = new Token(T.EOF, "", 1, 1);
		const lbrace = new Token(T.LBRACE, "{", 1, 1);
		const rbrace = new Token(T.RBRACE, "}", 1, 1);
		const semi = new Token(T.SEMICOLON, ";", 1, 1);
		const withFor =
			tokens[0]?.type === T.FOR
				? [...tokens, lbrace, rbrace, semi, eofTok]
				: [
						new Token(T.FOR, "for", 1, 1),
						...tokens,
						lbrace,
						rbrace,
						semi,
						eofTok,
					];
		try {
			const p2 = new Parser(withFor);
			const forStmt = p2.parseFor();
			this._genTemplRangeFor(forStmt, node.body, p);
		} catch {
			// Fallback for non-range loops: emit a comment + skip
			this.line(`/* templ for: ${this._tokensToSource(tokens)} */`);
		}
	},

	_genTemplRangeFor(forStmt, templBody, mountParent) {
		const init = forStmt.init;
		if (!init?.rhs?.[0] || init.rhs[0].kind !== "RangeExpr") {
			// Plain for loop (cond-only or three-clause)
			const condJs = forStmt.cond ? this.genExpr(forStmt.cond) : "true";
			this.line(`while (${condJs}) {`);
			this.indented(() => this._genTemplNodes(templBody, mountParent));
			this.line("}");
			return;
		}
		// Range for: for key, val := range iter
		const range = init.rhs[0];
		const iterJs = this.genExpr(range.expr);
		const lhs = init.lhs.map((e) => e.name ?? "_");
		const keyName = lhs[0] ?? "_";
		const valName = lhs[1] ?? null;

		const loopHeader = this._genTemplRangeHeader(keyName, valName, iterJs);
		this.line(loopHeader);
		this.indented(() => this._genTemplNodes(templBody, mountParent));
		this.line("}");
	},

	_genTemplRangeHeader(keyName, valName, iterJs) {
		if (valName === null || valName === undefined) {
			return `for (const ${keyName === "_" ? "_$" : keyName} of ${iterJs}) {`;
		}
		if (keyName === "_" && valName === "_")
			return `for (const _$ of ${iterJs}) {`;
		if (keyName === "_") return `for (const ${valName} of ${iterJs}) {`;
		if (valName === "_")
			return `for (const [${keyName}] of Object.entries(${iterJs})) {`;
		// Default to .entries() for arrays, Object.entries for objects
		this._usesSliceGuard = true;
		return `for (const [${keyName}, ${valName}] of __s(${iterJs}).entries()) {`;
	},

	// Parse a token array as a Go expression and emit JS.
	_genTemplTokenExpr(tokens) {
		if (!tokens || tokens.length === 0) return '""';
		const eofTok = new Token(T.EOF, "", 1, 1);
		const p = new Parser([...tokens, eofTok]);
		const ast = p.parseExpr();
		return this.genExpr(ast);
	},

	// Parse a token array as a Go call expression and emit JS.
	_genTemplTokenCallExpr(tokens) {
		if (!tokens || tokens.length === 0) return "null";
		const eofTok = new Token(T.EOF, "", 1, 1);
		const p = new Parser([...tokens, eofTok]);
		const ast = p.parseExpr();
		return this.genExpr(ast);
	},

	// Extract condition JS from condTokens (which may start with `if`).
	_genTemplCondTokens(tokens) {
		if (!tokens || tokens.length === 0) return "false";
		let toks = tokens;
		if (toks[0]?.type === T.IF) toks = toks.slice(1); // skip `if` keyword
		const eofTok = new Token(T.EOF, "", 1, 1);
		const p = new Parser([...toks, eofTok]);
		const ast = p.parseExpr();
		return this.genExpr(ast);
	},

	_tokensToSource(tokens) {
		return tokens.map((t) => t.value).join(" ");
	},

	// Fresh variable name counter
	_freshVar(prefix = "v") {
		this._templVarCount = (this._templVarCount ?? 0) + 1;
		return `___${prefix}${this._templVarCount}`;
	},
};
