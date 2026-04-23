// Templ lexer: tokenizes .templ files into a stream of tokens.
//
// A .templ file is a Go-like file where `templ Name(params) { ... }` declarations
// contain HTML bodies instead of Go statements. All other constructs (package,
// import, regular func, var, const, type) are lexed as normal Go.
//
// Token types produced (in addition to the standard Go token types from lexer.js):
//   TEMPL_KW       — the `templ` keyword
//   HTML_OPEN      — <tag attr...> (includes the `>`)
//   HTML_CLOSE     — </tag>
//   HTML_SELF      — <tag .../>
//   HTML_TEXT      — literal text between tags
//   TEMPL_EXPR     — { goExpr } inside HTML (the goExpr tokens are inlined)
//   TEMPL_COMP     — @Call(...) inside HTML
//   TEMPL_CHILDREN — { children... }
//
// The approach: scan the file character-by-character. Outside templ bodies, use
// the existing Lexer class to tokenise Go. Inside templ bodies, scan HTML.

import { Lexer, T, Token } from "./lexer.js";

export const TT = {
	TEMPL_KW: "templ",
	HTML_OPEN: "HTML_OPEN",
	HTML_CLOSE: "HTML_CLOSE",
	HTML_SELF: "HTML_SELF",
	HTML_TEXT: "HTML_TEXT",
	TEMPL_EXPR: "TEMPL_EXPR", // inline Go expression token stream
	TEMPL_COMP: "TEMPL_COMP", // @Component(args) call
	TEMPL_CHILDREN: "TEMPL_CHILDREN",
	TEMPL_IF: "TEMPL_IF",
	TEMPL_ELSE: "TEMPL_ELSE",
	TEMPL_FOR: "TEMPL_FOR",
	TEMPL_SWITCH: "TEMPL_SWITCH", // switch expr {
	TEMPL_CASE: "TEMPL_CASE", // case expr:
	TEMPL_DEFAULT: "TEMPL_DEFAULT", // default:
	TEMPL_END: "TEMPL_END", // closing } of if/for/switch/templ body
};

// Describes a parsed HTML attribute
// { kind: "static", name, value } | { kind: "expr", name, tokens } | { kind: "bool", name }

export class TemplLexer {
	constructor(source, filename = "<templ>") {
		this.src = source;
		this.pos = 0;
		this.line = 1;
		this.col = 1;
		this.filename = filename;
		this.tokens = [];
	}

	// ── Character primitives ────────────────────────────────────

	peek(n = 0) {
		return this.src[this.pos + n];
	}

	advance() {
		const ch = this.src[this.pos++];
		if (ch === "\n") {
			this.line++;
			this.col = 1;
		} else {
			this.col++;
		}
		return ch;
	}

	eof() {
		return this.pos >= this.src.length;
	}

	skipWhitespace() {
		while (!this.eof() && /[ \t\r\n]/.test(this.peek())) this.advance();
	}

	skipLineComment() {
		while (!this.eof() && this.peek() !== "\n") this.advance();
	}

	skipBlockComment() {
		while (!this.eof()) {
			if (this.peek() === "*" && this.peek(1) === "/") {
				this.advance();
				this.advance();
				return;
			}
			this.advance();
		}
		this.err("unterminated block comment");
	}

	err(msg) {
		throw new Error(`${this.filename}:${this.line}:${this.col}: ${msg}`);
	}

	// ── Main tokenise entry point ────────────────────────────────

	tokenize() {
		// Scan the entire file. We identify `templ Name(params) {` blocks
		// and handle their bodies in HTML mode; everything else is Go.
		while (!this.eof()) {
			this.skipWhitespace();
			if (this.eof()) break;

			// Skip Go-style comments
			if (this.peek() === "/" && this.peek(1) === "/") {
				this.skipLineComment();
				continue;
			}
			if (this.peek() === "/" && this.peek(1) === "*") {
				this.advance();
				this.advance();
				this.skipBlockComment();
				continue;
			}

			// Detect `templ` keyword at identifier boundaries
			if (this._matchKeyword("templ")) {
				this.tokens.push(new Token(TT.TEMPL_KW, "templ", this.line, this.col));
				this._lexTemplDecl();
				continue;
			}

			// Everything else: scan to end of top-level declaration using the
			// raw Go lexer, accumulating tokens until the next `templ` keyword
			// or EOF.
			this._lexGoChunk();
		}

		this.tokens.push(new Token(T.EOF, "", this.line, this.col));
		return this.tokens;
	}

	// ── Go chunk lexing ──────────────────────────────────────────

	// Scan ahead to find the next `templ ` keyword at top level (not inside
	// braces/parens/strings/comments). Collect all source text up to that
	// point, lex it as normal Go, and append the tokens.
	_lexGoChunk() {
		const start = this.pos;
		let depth = 0; // brace depth

		while (!this.eof()) {
			// Check for `templ` keyword at top level (depth === 0)
			if (depth === 0 && this._peekKeyword("templ")) break;

			const ch = this.peek();

			// Strings (raw or interpreted)
			if (ch === '"' || ch === "'") {
				this._skipGoString(ch);
				continue;
			}
			if (ch === "`") {
				this._skipRawString();
				continue;
			}

			// Comments
			if (ch === "/" && this.peek(1) === "/") {
				this.skipLineComment();
				continue;
			}
			if (ch === "/" && this.peek(1) === "*") {
				this.advance();
				this.advance();
				this.skipBlockComment();
				continue;
			}

			if (ch === "{") depth++;
			else if (ch === "}") {
				if (depth === 0) break; // should not happen at top level, stop
				depth--;
			}
			this.advance();
		}

		if (this.pos === start) {
			// Nothing to lex; skip one char to avoid infinite loop
			this.advance();
			return;
		}

		const chunk = this.src.slice(start, this.pos);
		for (const t of this._goTokens(chunk)) this.tokens.push(t);
	}

	// ── Templ declaration lexing ─────────────────────────────────

	// Called right after consuming `templ` keyword.
	// Lexes: Name(params) { <HTML body> }
	_lexTemplDecl() {
		this.skipWhitespace();

		// Name
		const nameStart = this.pos;
		while (!this.eof() && /\w/.test(this.peek())) this.advance();
		const name = this.src.slice(nameStart, this.pos);
		if (!name) this.err("expected component name after 'templ'");
		this.tokens.push(new Token(T.IDENT, name, this.line, this.col));

		this.skipWhitespace();

		// Parameter list ( ... ) — lex as Go
		if (this.peek() !== "(") this.err("expected '(' after templ name");
		const paramStart = this.pos;
		this._skipBalanced("(", ")");
		const paramSrc = this.src.slice(paramStart, this.pos);
		for (const t of this._goTokens(paramSrc)) this.tokens.push(t);

		this.skipWhitespace();

		// Opening { of body
		if (this.peek() !== "{") this.err("expected '{' after templ params");
		this.advance(); // consume {
		this.tokens.push(new Token(T.LBRACE, "{", this.line, this.col));

		// HTML body
		this._lexHtmlBody(1);
	}

	// Lex the HTML body of a templ declaration.
	// depth: current brace depth (starts at 1 for the opening { of templ)
	_lexHtmlBody(depth) {
		while (!this.eof()) {
			this.skipWhitespace();
			if (this.eof()) break;

			const ch = this.peek();

			// Closing brace: if depth becomes 0, we're done
			if (ch === "}") {
				if (depth === 1) {
					this.advance(); // consume }
					this.tokens.push(new Token(T.RBRACE, "}", this.line, this.col));
					return;
				}
				// depth > 1 should not happen at the top of a templ body; treat as end
				this.advance();
				this.tokens.push(new Token(TT.TEMPL_END, "}", this.line, this.col));
				return;
			}

			this._lexHtmlNode();
		}
	}

	// Lex HTML nodes for a switch-case body until case/default/} without consuming
	// the terminator (the caller handles it).
	_lexCaseBody() {
		while (!this.eof()) {
			this.skipWhitespace();
			if (this.eof()) break;
			const ch = this.peek();
			if (ch === "}") break;
			if (this._peekKeyword("case") || this._peekKeyword("default")) break;
			this._lexHtmlNode();
		}
	}

	// Lex a single HTML node at the current position.
	_lexHtmlNode() {
		const ch = this.peek();

		// HTML comment <!-- ... -->
		if (ch === "<" && this.src.startsWith("<!--", this.pos)) {
			this._skipHtmlComment();
			return;
		}
		// Closing tag </tag>
		if (ch === "<" && this.peek(1) === "/") {
			this._lexHtmlCloseTag();
			return;
		}
		// Opening tag <tag ...> or <tag .../>
		if (ch === "<") {
			this._lexHtmlOpenTag();
			return;
		}
		// @Component(args) call
		if (ch === "@") {
			this._lexTemplComponent();
			return;
		}
		// { children... } or { goExpr }
		if (ch === "{") {
			this._lexBraceExprOrControl();
			return;
		}
		// Control flow keywords
		if (this._peekKeyword("if")) {
			this._lexTemplIf();
			return;
		}
		if (this._peekKeyword("for")) {
			this._lexTemplFor();
			return;
		}
		if (this._peekKeyword("switch")) {
			this._lexTemplSwitch();
			return;
		}
		// Plain text content
		this._lexHtmlText();
	}

	// ── HTML element lexing ───────────────────────────────────────

	_lexHtmlOpenTag() {
		const line = this.line;
		const col = this.col;
		this.advance(); // consume <
		this.skipWhitespace();

		// Tag name
		const tagName = this._readHtmlName();
		if (!tagName) this.err("expected tag name");

		const attrs = [];
		let selfClose = false;

		// Attributes
		while (!this.eof()) {
			this.skipWhitespace();
			const c = this.peek();

			if (c === "/" && this.peek(1) === ">") {
				this.advance();
				this.advance(); // />
				selfClose = true;
				break;
			}
			if (c === ">") {
				this.advance(); // >
				break;
			}

			// Attribute name
			const attrName = this._readHtmlAttrName();
			if (!attrName) break;

			this.skipWhitespace();

			// Conditional boolean attribute: name?={expr}
			if (this.peek() === "?" && this.peek(1) === "=") {
				this.advance();
				this.advance(); // ?=
				this.skipWhitespace();
				if (this.peek() !== "{") this.err("expected '{' after ?=");
				const exprTokens = this._readGoExprInBraces();
				attrs.push({ kind: "cond-bool", name: attrName, tokens: exprTokens });
				continue;
			}

			if (this.peek() !== "=") {
				// Boolean attribute: no value
				attrs.push({ kind: "bool", name: attrName });
				continue;
			}
			this.advance(); // =
			this.skipWhitespace();

			if (this.peek() === "{") {
				// Expression attribute: name={ goExpr }
				const exprTokens = this._readGoExprInBraces();
				attrs.push({ kind: "expr", name: attrName, tokens: exprTokens });
			} else if (this.peek() === '"') {
				// Static string attribute
				const value = this._readQuotedString();
				attrs.push({ kind: "static", name: attrName, value });
			} else {
				// Unquoted attribute value
				let val = "";
				while (!this.eof() && !/[\s>]/.test(this.peek())) val += this.advance();
				attrs.push({ kind: "static", name: attrName, value: val });
			}
		}

		const kind = selfClose ? TT.HTML_SELF : TT.HTML_OPEN;
		this.tokens.push(new Token(kind, { tag: tagName, attrs }, line, col));
	}

	_lexHtmlCloseTag() {
		const line = this.line;
		this.advance(); // <
		this.advance(); // /
		this.skipWhitespace();
		const tagName = this._readHtmlName();
		this.skipWhitespace();
		if (this.peek() === ">") this.advance();
		this.tokens.push(new Token(TT.HTML_CLOSE, tagName, line, this.col));
	}

	_skipHtmlComment() {
		// <!-- ... -->
		this.pos += 4; // <!--
		while (!this.eof()) {
			if (this.src.startsWith("-->", this.pos)) {
				this.pos += 3;
				return;
			}
			if (this.peek() === "\n") {
				this.line++;
				this.col = 1;
			} else {
				this.col++;
			}
			this.pos++;
		}
	}

	// ── Expression / control flow inside HTML ─────────────────────

	_lexBraceExprOrControl() {
		// { children... }  →  TEMPL_CHILDREN
		// { goExpr }       →  TEMPL_EXPR
		const saveLine = this.line;
		const saveCol = this.col;

		this.advance(); // {
		this.skipWhitespace();

		// Check for children...
		if (this.src.startsWith("children...", this.pos)) {
			this.pos += "children...".length;
			this.skipWhitespace();
			if (this.peek() === "}") this.advance();
			this.tokens.push(new Token(TT.TEMPL_CHILDREN, null, saveLine, saveCol));
			return;
		}

		// Otherwise lex the Go expression inside the braces
		const exprTokens = this._readGoExprTokensUntilClose();
		this.tokens.push(new Token(TT.TEMPL_EXPR, exprTokens, saveLine, saveCol));
	}

	_lexTemplComponent() {
		const line = this.line;
		const col = this.col;
		this.advance(); // @

		// Read the call expression (Go tokens until end of balanced parens)
		const nameStart = this.pos;
		while (!this.eof() && /[\w.]/.test(this.peek())) this.advance();
		const name = this.src.slice(nameStart, this.pos);
		if (!name) this.err("expected component name after @");

		this.skipWhitespace();
		if (this.peek() !== "(") this.err("expected '(' after @component name");

		const argsStart = this.pos;
		this._skipBalanced("(", ")");
		const argsSrc = name + this.src.slice(argsStart, this.pos);

		const callTokens = this._goTokens(argsSrc);
		this.tokens.push(new Token(TT.TEMPL_COMP, callTokens, line, col));
	}

	_lexTemplIf() {
		const line = this.line;
		const condTokens = this._lexGoExprBeforeBrace();
		this.tokens.push(new Token(TT.TEMPL_IF, condTokens, line, this.col));
		this._lexHtmlBody(1);

		// Check for else
		this.skipWhitespace();
		if (this._peekKeyword("else")) {
			this._readWord(); // consume `else`
			this.skipWhitespace();
			this.tokens.push(new Token(TT.TEMPL_ELSE, null, this.line, this.col));
			if (this._peekKeyword("if")) {
				// else if
				this._lexTemplIf();
			} else {
				// else block
				if (this.peek() !== "{") this.err("expected '{' after else");
				this.advance(); // {
				this._lexHtmlBody(1);
			}
		}
	}

	_lexTemplFor() {
		const line = this.line;
		const stmtTokens = this._lexGoExprBeforeBrace();
		this.tokens.push(new Token(TT.TEMPL_FOR, stmtTokens, line, this.col));
		this._lexHtmlBody(1);
	}

	_lexTemplSwitch() {
		const line = this.line;
		this._readWord(); // consume "switch"
		this.skipWhitespace();
		const exprTokens = this._lexGoExprBeforeBrace();
		this.tokens.push(new Token(TT.TEMPL_SWITCH, exprTokens, line, this.col));

		// Lex case/default entries until the closing }
		while (!this.eof()) {
			this.skipWhitespace();
			if (this.eof()) break;

			if (this.peek() === "}") {
				this.advance(); // consume }
				this.tokens.push(new Token(TT.TEMPL_END, "}", this.line, this.col));
				return;
			}

			if (this._peekKeyword("case")) {
				const caseLine = this.line;
				this._readWord(); // consume "case"
				this.skipWhitespace();
				// Read case expression up to ":"
				const caseExprStart = this.pos;
				// Skip to the colon, handling string literals
				while (!this.eof() && this.peek() !== ":") {
					const c = this.peek();
					if (c === '"' || c === "'") {
						this._skipGoString(c);
					} else if (c === "`") {
						this._skipRawString();
					} else {
						this.advance();
					}
				}
				const caseExprSrc = this.src.slice(caseExprStart, this.pos).trimEnd();
				if (this.peek() === ":") this.advance(); // :
				const caseTokens = this._goTokens(caseExprSrc);
				this.tokens.push(
					new Token(TT.TEMPL_CASE, caseTokens, caseLine, this.col),
				);
				this._lexCaseBody();
			} else if (this._peekKeyword("default")) {
				const defaultLine = this.line;
				this._readWord(); // consume "default"
				this.skipWhitespace();
				if (this.peek() === ":") this.advance(); // :
				this.tokens.push(
					new Token(TT.TEMPL_DEFAULT, null, defaultLine, this.col),
				);
				this._lexCaseBody();
			} else {
				// Unexpected token inside switch body — skip to avoid infinite loop
				this.advance();
			}
		}
	}

	// ── HTML text content ─────────────────────────────────────────

	_lexHtmlText() {
		let text = "";
		const line = this.line;
		while (!this.eof()) {
			const c = this.peek();
			if (c === "<" || c === "{" || c === "@" || c === "}") break;
			// Detect control-flow keywords at line start
			if (
				(c === "i" && this._peekKeyword("if")) ||
				(c === "f" && this._peekKeyword("for")) ||
				(c === "s" && this._peekKeyword("switch")) ||
				(c === "c" && this._peekKeyword("case")) ||
				(c === "d" && this._peekKeyword("default"))
			)
				break;
			text += this.advance();
		}
		const trimmed = text.trim();
		if (trimmed)
			this.tokens.push(new Token(TT.HTML_TEXT, trimmed, line, this.col));
	}

	// ── Helpers ───────────────────────────────────────────────────

	_goTokens(src) {
		return new Lexer(src, this.filename)
			.tokenize()
			.filter((t) => t.type !== T.EOF);
	}

	// Consume text up to the opening `{`, advance past it, and return Go tokens.
	_lexGoExprBeforeBrace() {
		const start = this.pos;
		this._skipToOpenBrace();
		const src = this.src.slice(start, this.pos).trimEnd();
		this.advance(); // consume {
		return src ? this._goTokens(src) : [];
	}

	// Read Go expression tokens until the closing }
	_readGoExprInBraces() {
		this.advance(); // {
		return this._readGoExprTokensUntilClose();
	}

	_readGoExprTokensUntilClose() {
		const start = this.pos;
		let depth = 1;
		while (!this.eof() && depth > 0) {
			const c = this.peek();
			if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) break;
			} else if (c === '"' || c === "'") {
				this._skipGoString(c);
				continue;
			} else if (c === "`") {
				this._skipRawString();
				continue;
			}
			this.advance();
		}
		const exprSrc = this.src.slice(start, this.pos).trim();
		if (this.peek() === "}") this.advance(); // consume }
		if (!exprSrc) return [];
		return this._goTokens(exprSrc);
	}

	_readHtmlName() {
		let name = "";
		while (!this.eof() && /[a-zA-Z0-9_-]/.test(this.peek()))
			name += this.advance();
		return name;
	}

	_readHtmlAttrName() {
		let name = "";
		while (!this.eof() && /[a-zA-Z0-9_:.-]/.test(this.peek()))
			name += this.advance();
		return name;
	}

	_readQuotedString() {
		this.advance(); // opening "
		let s = "";
		while (!this.eof() && this.peek() !== '"') {
			if (this.peek() === "\\") {
				this.advance();
				s += this.advance();
			} else s += this.advance();
		}
		if (this.peek() === '"') this.advance();
		return s;
	}

	_readWord() {
		let w = "";
		while (!this.eof() && /\w/.test(this.peek())) w += this.advance();
		return w;
	}

	_skipToOpenBrace() {
		// Skip text until we hit an unbalanced {, tracking parens/brackets
		let paren = 0,
			bracket = 0;
		while (!this.eof()) {
			const c = this.peek();
			if (c === "(") paren++;
			else if (c === ")") paren--;
			else if (c === "[") bracket++;
			else if (c === "]") bracket--;
			else if (c === "{" && paren === 0 && bracket === 0) return;
			else if (c === '"' || c === "'") {
				this._skipGoString(c);
				continue;
			} else if (c === "`") {
				this._skipRawString();
				continue;
			}
			this.advance();
		}
	}

	_skipBalanced(open, close) {
		let depth = 0;
		while (!this.eof()) {
			const c = this.peek();
			if (c === '"' || c === "'") {
				this._skipGoString(c);
				continue;
			}
			if (c === "`") {
				this._skipRawString();
				continue;
			}
			if (c === open) depth++;
			else if (c === close) {
				depth--;
				if (depth === 0) {
					this.advance();
					return;
				}
			}
			this.advance();
		}
	}

	_skipGoString(quote) {
		this.advance(); // opening quote
		while (!this.eof()) {
			const c = this.peek();
			if (c === "\\") {
				this.advance();
				this.advance();
				continue;
			}
			if (c === quote) {
				this.advance();
				return;
			}
			this.advance();
		}
	}

	_skipRawString() {
		this.advance(); // `
		while (!this.eof() && this.peek() !== "`") this.advance();
		if (!this.eof()) this.advance();
	}

	// Returns true if src[pos..] starts with `word` followed by a non-word char
	_peekKeyword(word) {
		if (!this.src.startsWith(word, this.pos)) return false;
		const after = this.src[this.pos + word.length];
		return !after || /\W/.test(after);
	}

	// Consume a keyword word
	_matchKeyword(word) {
		if (!this._peekKeyword(word)) return false;
		for (let i = 0; i < word.length; i++) this.advance();
		return true;
	}
}
