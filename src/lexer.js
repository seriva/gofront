// Lexer: tokenizes GoFront source into a flat token stream.
// Implements Go-style automatic semicolon insertion.

export const T = {
	// Literals
	INT: "INT",
	FLOAT: "FLOAT",
	STRING: "STRING",
	IDENT: "IDENT",

	IMAG: "IMAG",

	// Keywords
	FUNC: "func",
	VAR: "var",
	CONST: "const",
	TYPE: "type",
	STRUCT: "struct",
	INTERFACE: "interface",
	IF: "if",
	ELSE: "else",
	FOR: "for",
	RANGE: "range",
	RETURN: "return",
	PACKAGE: "package",
	IMPORT: "import",
	TRUE: "true",
	FALSE: "false",
	NIL: "nil",
	BREAK: "break",
	CONTINUE: "continue",
	SWITCH: "switch",
	CASE: "case",
	DEFAULT: "default",
	MAP: "map",
	NEW: "new",
	DEFER: "defer",
	ASYNC: "async",
	AWAIT: "await",
	GO: "go",
	CHAN: "chan",
	SELECT: "select",

	// Operators
	PLUS: "+",
	MINUS: "-",
	STAR: "*",
	SLASH: "/",
	PERCENT: "%",
	EQ: "==",
	NEQ: "!=",
	LT: "<",
	GT: ">",
	LTE: "<=",
	GTE: ">=",
	AND: "&&",
	OR: "||",
	NOT: "!",
	ASSIGN: "=",
	DEFINE: ":=",
	PLUS_ASSIGN: "+=",
	MINUS_ASSIGN: "-=",
	STAR_ASSIGN: "*=",
	SLASH_ASSIGN: "/=",
	PERCENT_ASSIGN: "%=",
	AMP_ASSIGN: "&=",
	PIPE_ASSIGN: "|=",
	CARET_ASSIGN: "^=",
	LSHIFT_ASSIGN: "<<=",
	RSHIFT_ASSIGN: ">>=",
	INC: "++",
	DEC: "--",
	AMP: "&",
	PIPE: "|",
	CARET: "^",
	AND_NOT: "&^",
	TILDE: "~",
	LSHIFT: "<<",
	RSHIFT: ">>",
	ELLIPSIS: "...",
	FALLTHROUGH: "fallthrough",

	// Delimiters
	LPAREN: "(",
	RPAREN: ")",
	LBRACE: "{",
	RBRACE: "}",
	LBRACKET: "[",
	RBRACKET: "]",
	COMMA: ",",
	DOT: ".",
	COLON: ":",
	SEMICOLON: ";",

	EOF: "EOF",
};

// Tokens where a trailing newline inserts a semicolon (Go spec §Semicolons)
const SEMI_TRIGGERS = new Set([
	T.IDENT,
	T.INT,
	T.FLOAT,
	T.IMAG,
	T.STRING,
	T.RPAREN,
	T.RBRACE,
	T.RBRACKET,
	T.INC,
	T.DEC,
	T.TRUE,
	T.FALSE,
	T.NIL,
	T.BREAK,
	T.CONTINUE,
	T.RETURN,
	T.FALLTHROUGH,
]);

const KEYWORDS = new Set([
	"func",
	"var",
	"const",
	"type",
	"struct",
	"interface",
	"if",
	"else",
	"for",
	"range",
	"return",
	"package",
	"import",
	"true",
	"false",
	"nil",
	"break",
	"continue",
	"switch",
	"case",
	"default",
	"map",
	"new",
	"fallthrough",
	"defer",
	"async",
	"await",
	"go",
	"chan",
	"select",
]);

export class Token {
	constructor(type, value, line, col) {
		this.type = type;
		this.value = value;
		this.line = line;
		this.col = col;
	}
	toString() {
		return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.col})`;
	}
}

export class LexError extends Error {
	constructor(msg, line, col, filename, sourceCode) {
		const loc = filename ? `${filename}:${line}:${col}` : `${line}:${col}`;
		let lineContext = "";
		if (line && sourceCode) {
			const lines = sourceCode.split("\n");
			const lineStr = lines[line - 1];
			if (lineStr !== undefined) {
				lineContext = `\n  ${line} | ${lineStr}`;
			}
		}
		super(`Lex error at ${loc}: ${msg}${lineContext}`);
		this.line = line;
		this.col = col;
	}
}

export class Lexer {
	constructor(source, filename = null) {
		this.src = source;
		this.pos = 0;
		this.line = 1;
		this.col = 1;
		this.tokens = [];
		this.filename = filename;
	}

	// ── Primitives ──────────────────────────────────────────────

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

	match(ch) {
		if (this.src[this.pos] === ch) {
			this.advance();
			return true;
		}
		return false;
	}

	err(msg) {
		throw new LexError(msg, this.line, this.col, this.filename, this.src);
	}

	// ── Skip whitespace and comments ────────────────────────────

	skip() {
		while (this.pos < this.src.length) {
			const ch = this.peek();
			if (ch === " " || ch === "\t" || ch === "\r") {
				this.advance();
			} else if (ch === "/" && this.peek(1) === "/") {
				while (this.pos < this.src.length && this.peek() !== "\n")
					this.advance();
			} else if (ch === "/" && this.peek(1) === "*") {
				const startLine = this.line,
					startCol = this.col;
				this.advance();
				this.advance();
				let closed = false;
				while (this.pos < this.src.length) {
					if (this.peek() === "*" && this.peek(1) === "/") {
						this.advance();
						this.advance();
						closed = true;
						break;
					}
					this.advance();
				}
				if (!closed)
					throw new LexError(
						"Unterminated block comment",
						startLine,
						startCol,
						this.filename,
						this.src,
					);
			} else {
				break;
			}
		}
	}

	// ── Literals ─────────────────────────────────────────────────

	readString() {
		const l = this.line,
			c = this.col;
		this.advance(); // opening "
		let s = "";
		while (this.pos < this.src.length && this.peek() !== '"') {
			if (this.peek() === "\n") this.err("Unterminated string literal");
			if (this.peek() === "\\") {
				this.advance();
				const esc = this.advance();
				switch (esc) {
					case "n":
						s += "\n";
						break;
					case "t":
						s += "\t";
						break;
					case "r":
						s += "\r";
						break;
					case '"':
						s += '"';
						break;
					case "\\":
						s += "\\";
						break;
					case "0":
						s += "\0";
						break;
					default:
						s += `\\${esc}`;
				}
			} else {
				s += this.advance();
			}
		}
		if (this.pos >= this.src.length)
			throw new LexError("Unterminated string", l, c, this.filename, this.src);
		this.advance(); // closing "
		return s;
	}

	readRawString() {
		const l = this.line,
			c = this.col;
		this.advance(); // opening `
		let s = "";
		while (this.pos < this.src.length && this.peek() !== "`")
			s += this.advance();
		if (this.pos >= this.src.length)
			throw new LexError(
				"Unterminated raw string",
				l,
				c,
				this.filename,
				this.src,
			);
		this.advance(); // closing `
		return s;
	}

	readRuneLiteral() {
		const l = this.line,
			c = this.col;
		this.advance(); // opening '
		let code;
		if (this.peek() === "\\") {
			this.advance();
			const esc = this.advance();
			switch (esc) {
				case "n":
					code = 10;
					break;
				case "t":
					code = 9;
					break;
				case "r":
					code = 13;
					break;
				case "'":
					code = 39;
					break;
				case "\\":
					code = 92;
					break;
				case "0":
					code = 0;
					break;
				default:
					throw new LexError(
						`Unknown escape in rune literal: \\${esc}`,
						l,
						c,
						this.filename,
						this.src,
					);
			}
		} else if (this.peek() !== "'") {
			code = this.src.codePointAt(this.pos);
			this.advance();
		} else {
			throw new LexError("Empty rune literal", l, c, this.filename, this.src);
		}
		if (this.peek() !== "'")
			throw new LexError(
				"Rune literal must contain exactly one character",
				l,
				c,
				this.filename,
				this.src,
			);
		this.advance(); // closing '
		return String(code);
	}

	readNumber() {
		let n = "";
		let isFloat = false;

		// Check for prefix: 0b, 0o, 0x
		const first = this.advance();
		n += first;
		if (first === "0") {
			const p = this.peek();
			if (p === "b" || p === "B") {
				n += this.advance();
				while (this.pos < this.src.length && /[01_]/.test(this.peek())) {
					const ch = this.advance();
					if (ch !== "_") n += ch;
				}
				return { n, isFloat: false };
			}
			if (p === "o" || p === "O") {
				n += this.advance();
				while (this.pos < this.src.length && /[0-7_]/.test(this.peek())) {
					const ch = this.advance();
					if (ch !== "_") n += ch;
				}
				return { n, isFloat: false };
			}
			if (p === "x" || p === "X") {
				n += this.advance();
				while (this.pos < this.src.length && /[0-9a-fA-F_]/.test(this.peek())) {
					const ch = this.advance();
					if (ch !== "_") n += ch;
				}
				// Hex float: 0x1.Fp10 or 0xAp-2
				if (this.peek() === "." || this.peek() === "p" || this.peek() === "P") {
					let frac = "";
					if (this.peek() === ".") {
						this.advance(); // skip the dot (don't add to n)
						while (
							this.pos < this.src.length &&
							/[0-9a-fA-F_]/.test(this.peek())
						) {
							const ch = this.advance();
							if (ch !== "_") frac += ch;
						}
					}
					if (this.peek() === "p" || this.peek() === "P") {
						this.advance(); // skip p/P
						let exp = "";
						if (this.peek() === "+" || this.peek() === "-")
							exp += this.advance();
						while (this.pos < this.src.length && /[0-9]/.test(this.peek()))
							exp += this.advance();
						// Evaluate: JS can't parse hex floats, so convert manually
						// n is "0x1" (integer hex part), frac is hex fractional digits
						let mantissa = Number(n);
						if (frac) {
							mantissa += Number.parseInt(frac, 16) / 16 ** frac.length;
						}
						const value = mantissa * 2 ** Number(exp);
						return { n: String(value), isFloat: true };
					}
				}
				return { n, isFloat: false };
			}
		}

		while (this.pos < this.src.length && /[0-9_]/.test(this.peek())) {
			const ch = this.advance();
			if (ch !== "_") n += ch;
		}
		if (this.peek() === "." && /[0-9]/.test(this.peek(1))) {
			isFloat = true;
			n += this.advance();
			while (this.pos < this.src.length && /[0-9_]/.test(this.peek())) {
				const ch = this.advance();
				if (ch !== "_") n += ch;
			}
		}
		if (this.peek() === "e" || this.peek() === "E") {
			isFloat = true;
			n += this.advance();
			if (this.peek() === "+" || this.peek() === "-") n += this.advance();
			while (this.pos < this.src.length && /[0-9_]/.test(this.peek())) {
				const ch = this.advance();
				if (ch !== "_") n += ch;
			}
		}
		return { n, isFloat };
	}

	readIdent() {
		let s = "";
		while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.peek()))
			s += this.advance();
		return s;
	}

	// ── Semicolon insertion ──────────────────────────────────────

	shouldSemi() {
		if (!this.tokens.length) return false;
		return SEMI_TRIGGERS.has(this.tokens[this.tokens.length - 1].type);
	}

	push(type, value, line, col) {
		this.tokens.push(new Token(type, value, line, col));
	}

	// ── Main tokenize loop ───────────────────────────────────────

	tokenize() {
		while (this.pos < this.src.length) {
			this.skip();
			if (this.pos >= this.src.length) break;

			const l = this.line,
				c = this.col,
				ch = this.peek();

			// Newline → maybe semicolon
			if (ch === "\n") {
				if (this.shouldSemi()) this.push(T.SEMICOLON, ";", l, c);
				this.advance();
				continue;
			}

			// String literals
			if (ch === '"') {
				this.push(T.STRING, this.readString(), l, c);
				continue;
			}
			if (ch === "`") {
				this.push(T.STRING, this.readRawString(), l, c);
				continue;
			}
			if (ch === "'") {
				this.push(T.INT, this.readRuneLiteral(), l, c);
				continue;
			}

			// Numbers
			if (/[0-9]/.test(ch)) {
				const { n, isFloat } = this.readNumber();
				if (this.src[this.pos] === "i") {
					this.pos++;
					this.col++;
					this.push(T.IMAG, n, l, c);
				} else {
					this.push(isFloat ? T.FLOAT : T.INT, n, l, c);
				}
				continue;
			}

			// Identifiers & keywords
			if (/[a-zA-Z_]/.test(ch)) {
				const id = this.readIdent();
				this.push(KEYWORDS.has(id) ? id : T.IDENT, id, l, c);
				continue;
			}

			// Operators & punctuation
			this.advance();
			switch (ch) {
				case "+":
					if (this.match("+")) this.push(T.INC, "++", l, c);
					else if (this.match("=")) this.push(T.PLUS_ASSIGN, "+=", l, c);
					else this.push(T.PLUS, "+", l, c);
					break;
				case "-":
					if (this.match("-")) this.push(T.DEC, "--", l, c);
					else if (this.match("=")) this.push(T.MINUS_ASSIGN, "-=", l, c);
					else this.push(T.MINUS, "-", l, c);
					break;
				case "*":
					if (this.match("=")) this.push(T.STAR_ASSIGN, "*=", l, c);
					else this.push(T.STAR, "*", l, c);
					break;
				case "/":
					if (this.match("=")) this.push(T.SLASH_ASSIGN, "/=", l, c);
					else this.push(T.SLASH, "/", l, c);
					break;
				case "%":
					if (this.match("=")) this.push(T.PERCENT_ASSIGN, "%=", l, c);
					else this.push(T.PERCENT, "%", l, c);
					break;
				case "=":
					if (this.match("=")) this.push(T.EQ, "==", l, c);
					else this.push(T.ASSIGN, "=", l, c);
					break;
				case "!":
					if (this.match("=")) this.push(T.NEQ, "!=", l, c);
					else this.push(T.NOT, "!", l, c);
					break;
				case "<":
					if (this.match("<")) {
						if (this.match("=")) this.push(T.LSHIFT_ASSIGN, "<<=", l, c);
						else this.push(T.LSHIFT, "<<", l, c);
					} else if (this.match("=")) this.push(T.LTE, "<=", l, c);
					else this.push(T.LT, "<", l, c);
					break;
				case ">":
					if (this.match(">")) {
						if (this.match("=")) this.push(T.RSHIFT_ASSIGN, ">>=", l, c);
						else this.push(T.RSHIFT, ">>", l, c);
					} else if (this.match("=")) this.push(T.GTE, ">=", l, c);
					else this.push(T.GT, ">", l, c);
					break;
				case "&":
					if (this.match("&")) this.push(T.AND, "&&", l, c);
					else if (this.match("^")) this.push(T.AND_NOT, "&^", l, c);
					else if (this.match("=")) this.push(T.AMP_ASSIGN, "&=", l, c);
					else this.push(T.AMP, "&", l, c);
					break;
				case "|":
					if (this.match("|")) this.push(T.OR, "||", l, c);
					else if (this.match("=")) this.push(T.PIPE_ASSIGN, "|=", l, c);
					else this.push(T.PIPE, "|", l, c);
					break;
				case "^":
					if (this.match("=")) this.push(T.CARET_ASSIGN, "^=", l, c);
					else this.push(T.CARET, "^", l, c);
					break;
				case "~":
					this.push(T.TILDE, "~", l, c);
					break;
				case ":":
					if (this.match("=")) this.push(T.DEFINE, ":=", l, c);
					else this.push(T.COLON, ":", l, c);
					break;
				case ".":
					if (this.peek() === "." && this.peek(1) === ".") {
						this.advance();
						this.advance();
						this.push(T.ELLIPSIS, "...", l, c);
					} else {
						this.push(T.DOT, ".", l, c);
					}
					break;
				case "(":
					this.push(T.LPAREN, "(", l, c);
					break;
				case ")":
					this.push(T.RPAREN, ")", l, c);
					break;
				case "{":
					this.push(T.LBRACE, "{", l, c);
					break;
				case "}":
					this.push(T.RBRACE, "}", l, c);
					break;
				case "[":
					this.push(T.LBRACKET, "[", l, c);
					break;
				case "]":
					this.push(T.RBRACKET, "]", l, c);
					break;
				case ",":
					this.push(T.COMMA, ",", l, c);
					break;
				case ";":
					this.push(T.SEMICOLON, ";", l, c);
					break;
				default:
					this.err(`Unexpected character: '${ch}'`);
			}
		}

		if (this.shouldSemi()) this.push(T.SEMICOLON, ";", this.line, this.col);
		this.push(T.EOF, "", this.line, this.col);
		return this.tokens;
	}
}
