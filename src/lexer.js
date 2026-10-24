// Lexer: tokenizes GoFront source into a flat token stream.
// Implements Go-style automatic semicolon insertion.
//
// `T` and `Token` live in ./tokens.js (a pure-data leaf module shared by
// lexer, parser, and codegen). They are re-exported here for backward compat.

import { T, Token } from "./tokens.js";

export { T, Token };

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
	"goto",
	"defer",
	"async",
	"await",
	"go",
	"chan",
	"select",
]);

// Single-character punctuation: push a fixed token with no lookahead.
const PUNCT_TOKEN = {
	"~": [T.TILDE, "~"],
	"(": [T.LPAREN, "("],
	")": [T.RPAREN, ")"],
	"{": [T.LBRACE, "{"],
	"}": [T.RBRACE, "}"],
	"[": [T.LBRACKET, "["],
	"]": [T.RBRACKET, "]"],
	",": [T.COMMA, ","],
	";": [T.SEMICOLON, ";"],
};

// Operator + optional "=" compound form: [compoundType, compoundVal, baseType, baseVal]
const ASSIGN_OP = {
	"*": [T.STAR_ASSIGN, "*=", T.STAR, "*"],
	"/": [T.SLASH_ASSIGN, "/=", T.SLASH, "/"],
	"%": [T.PERCENT_ASSIGN, "%=", T.PERCENT, "%"],
	"=": [T.EQ, "==", T.ASSIGN, "="],
	"!": [T.NEQ, "!=", T.NOT, "!"],
	"^": [T.CARET_ASSIGN, "^=", T.CARET, "^"],
	":": [T.DEFINE, ":=", T.COLON, ":"],
};

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

const SIMPLE_ESCAPES = {
	a: 7,
	b: 8,
	f: 12,
	n: 10,
	r: 13,
	t: 9,
	v: 11,
	"\\": 92,
};

export class Lexer {
	constructor(source, filename = null) {
		this.src = source;
		this.pos = 0;
		this.line = 1;
		this.col = 1;
		this.tokens = [];
		this.filename = filename;
		this.target = null;
		this.targetDirective = null;
		this.intrinsics = new Map(); // line -> name of a //gofront:intrinsic
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
				const start = this.pos;
				const line = this.line,
					col = this.col;
				while (this.pos < this.src.length && this.peek() !== "\n")
					this.advance();
				const comment = this.src.slice(start, this.pos);
				const intrinsic = comment.match(/^\/\/gofront:intrinsic\s+(\S+)/);
				if (intrinsic) this.intrinsics.set(line, intrinsic[1]);
				const match = comment.match(/^\/\/gofront:target\s+(\S+)/);
				if (match) {
					this.target = match[1];
					this.targetDirective = {
						value: match[1],
						line,
						col,
						beforePackage: this.tokens.length === 0,
					};
				}
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
		let start = this.pos;
		let parts = null;
		while (this.pos < this.src.length) {
			const ch = this.src[this.pos];
			if (ch === '"') {
				if (parts === null) {
					const str = this.src.slice(start, this.pos);
					this.advance(); // closing "
					return str;
				}
				parts.push(this.src.slice(start, this.pos));
				this.advance(); // closing "
				return parts.join("");
			}
			if (ch === "\n") this.err("Unterminated string literal");
			if (ch === "\\") {
				if (parts === null) parts = [];
				if (this.pos > start) parts.push(this.src.slice(start, this.pos));
				this.advance(); // skip \
				parts.push(String.fromCodePoint(this.readEscape('"')));
				start = this.pos;
			} else {
				this.advance();
			}
		}
		throw new LexError("Unterminated string", l, c, this.filename, this.src);
	}

	// Reads the escape after a consumed backslash and returns its code point.
	// `quote` is the enclosing delimiter: `\'` is valid only in runes and
	// `\"` only in strings. `\xNN` and octal escapes give U+0000-U+00FF (see
	// plan §1.1: strings are JS strings, so \x80-\xff are code points, not raw bytes).
	readEscape(quote) {
		const l = this.line,
			c = this.col;
		const fail = (msg) => {
			throw new LexError(msg, l, c, this.filename, this.src);
		};
		const esc = this.advance();
		const simple = SIMPLE_ESCAPES[esc];
		if (simple !== undefined) return simple;
		if (esc === quote) return esc.charCodeAt(0);
		if (esc === "x") return this.readEscapeDigits(2, 16, fail);
		if (esc === "u" || esc === "U") {
			const v = this.readEscapeDigits(esc === "u" ? 4 : 8, 16, fail);
			if (v > 0x10ffff || (v >= 0xd800 && v < 0xe000))
				fail("escape is invalid Unicode code point");
			return v;
		}
		if (esc >= "0" && esc <= "7") {
			const v = Number(esc) * 64 + this.readEscapeDigits(2, 8, fail);
			if (v > 255) fail("octal escape value exceeds 255");
			return v;
		}
		return fail(`unknown escape sequence: \\${esc}`);
	}

	readEscapeDigits(n, radix, fail) {
		let v = 0;
		for (let i = 0; i < n; i++) {
			const d = Number.parseInt(this.src[this.pos] ?? "", radix);
			if (Number.isNaN(d)) fail("invalid character in escape sequence");
			v = v * radix + d;
			this.advance();
		}
		return v;
	}

	readRawString() {
		const l = this.line,
			c = this.col;
		this.advance(); // opening `
		const start = this.pos;
		while (this.pos < this.src.length && this.peek() !== "`") this.advance();
		if (this.pos >= this.src.length)
			throw new LexError(
				"Unterminated raw string",
				l,
				c,
				this.filename,
				this.src,
			);
		const raw = this.src.slice(start, this.pos);
		this.advance(); // closing `
		return raw;
	}

	readRuneLiteral() {
		const l = this.line,
			c = this.col;
		this.advance(); // opening '
		let code;
		if (this.peek() === "\\") {
			this.advance();
			code = this.readEscape("'");
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
		const first = this.advance();
		const n = first;
		if (first === "0") {
			const p = this.peek();
			if (p === "b" || p === "B") return this._readBinaryNumber(n);
			if (p === "o" || p === "O") return this._readOctalNumber(n);
			if (p === "x" || p === "X") return this._readHexNumber(n);
		}
		return this._readDecimalNumber(n);
	}

	_readBinaryNumber(n) {
		n += this.advance(); // consume b/B
		while (this.pos < this.src.length && /[01_]/.test(this.peek())) {
			const ch = this.advance();
			if (ch !== "_") n += ch;
		}
		return { n, isFloat: false };
	}

	_readOctalNumber(n) {
		n += this.advance(); // consume o/O
		while (this.pos < this.src.length && /[0-7_]/.test(this.peek())) {
			const ch = this.advance();
			if (ch !== "_") n += ch;
		}
		return { n, isFloat: false };
	}

	_readHexFrac() {
		let frac = "";
		this.advance(); // skip the dot
		while (this.pos < this.src.length && /[0-9a-fA-F_]/.test(this.peek())) {
			const ch = this.advance();
			if (ch !== "_") frac += ch;
		}
		return frac;
	}

	_readHexFloatExp(n, frac) {
		this.advance(); // skip p/P
		let exp = "";
		if (this.peek() === "+" || this.peek() === "-") exp += this.advance();
		while (this.pos < this.src.length && /[0-9]/.test(this.peek()))
			exp += this.advance();
		let mantissa = Number(n);
		if (frac) mantissa += Number.parseInt(frac, 16) / 16 ** frac.length;
		return { n: String(mantissa * 2 ** Number(exp)), isFloat: true };
	}

	_readHexNumber(n) {
		n += this.advance(); // consume x/X
		while (this.pos < this.src.length && /[0-9a-fA-F_]/.test(this.peek())) {
			const ch = this.advance();
			if (ch !== "_") n += ch;
		}
		if (this.peek() === "." || this.peek() === "p" || this.peek() === "P") {
			let frac = "";
			if (this.peek() === ".") frac = this._readHexFrac();
			if (this.peek() === "p" || this.peek() === "P")
				return this._readHexFloatExp(n, frac);
		}
		return { n, isFloat: false };
	}

	_readDecimalExponent(n) {
		n += this.advance(); // consume e/E
		if (this.peek() === "+" || this.peek() === "-") n += this.advance();
		while (this.pos < this.src.length) {
			const c = this.src.charCodeAt(this.pos);
			if (c >= 48 && c <= 57) {
				n += this.advance();
			} else if (c === 95) {
				this.advance();
			} else {
				break;
			}
		}
		return n;
	}

	_readDecimalNumber(n) {
		let isFloat = false;
		while (this.pos < this.src.length) {
			const c = this.src.charCodeAt(this.pos);
			if (c >= 48 && c <= 57) {
				n += this.advance();
			} else if (c === 95) {
				this.advance(); // skip _
			} else {
				break;
			}
		}
		if (
			this.pos + 1 < this.src.length &&
			this.src.charCodeAt(this.pos) === 46
		) {
			const next = this.src.charCodeAt(this.pos + 1);
			if (next >= 48 && next <= 57) {
				isFloat = true;
				n += this.advance();
				while (this.pos < this.src.length) {
					const c = this.src.charCodeAt(this.pos);
					if (c >= 48 && c <= 57) {
						n += this.advance();
					} else if (c === 95) {
						this.advance(); // skip _
					} else {
						break;
					}
				}
			}
		}
		if (this.pos < this.src.length) {
			const c = this.src.charCodeAt(this.pos);
			if (c === 101 || c === 69) {
				isFloat = true;
				n = this._readDecimalExponent(n);
			}
		}
		return { n, isFloat };
	}

	readIdent() {
		const start = this.pos;
		while (this.pos < this.src.length) {
			const code = this.src.charCodeAt(this.pos);
			if (
				(code >= 97 && code <= 122) ||
				(code >= 65 && code <= 90) ||
				(code >= 48 && code <= 57) ||
				code === 95
			) {
				this.pos++;
			} else {
				break;
			}
		}
		this.col += this.pos - start;
		return this.src.slice(start, this.pos);
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
			this._readOperator(ch, l, c);
		}

		if (this.shouldSemi()) this.push(T.SEMICOLON, ";", this.line, this.col);
		this.push(T.EOF, "", this.line, this.col);
		this.tokens.target = this.target;
		this.tokens.targetDirective = this.targetDirective;
		this.tokens.intrinsics = this.intrinsics;
		return this.tokens;
	}
	_readPlusOp(l, c) {
		if (this.match("+")) this.push(T.INC, "++", l, c);
		else if (this.match("=")) this.push(T.PLUS_ASSIGN, "+=", l, c);
		else this.push(T.PLUS, "+", l, c);
	}

	_readMinusOp(l, c) {
		if (this.match("-")) this.push(T.DEC, "--", l, c);
		else if (this.match("=")) this.push(T.MINUS_ASSIGN, "-=", l, c);
		else this.push(T.MINUS, "-", l, c);
	}

	_readLessOp(l, c) {
		if (this.match("<")) {
			if (this.match("=")) this.push(T.LSHIFT_ASSIGN, "<<=", l, c);
			else this.push(T.LSHIFT, "<<", l, c);
		} else if (this.match("=")) this.push(T.LTE, "<=", l, c);
		else this.push(T.LT, "<", l, c);
	}

	_readGreaterOp(l, c) {
		if (this.match(">")) {
			if (this.match("=")) this.push(T.RSHIFT_ASSIGN, ">>=", l, c);
			else this.push(T.RSHIFT, ">>", l, c);
		} else if (this.match("=")) this.push(T.GTE, ">=", l, c);
		else this.push(T.GT, ">", l, c);
	}

	_readAmpOp(l, c) {
		if (this.match("&")) this.push(T.AND, "&&", l, c);
		else if (this.match("^")) this.push(T.AND_NOT, "&^", l, c);
		else if (this.match("=")) this.push(T.AMP_ASSIGN, "&=", l, c);
		else this.push(T.AMP, "&", l, c);
	}

	_readOperator(ch, l, c) {
		const punct = PUNCT_TOKEN[ch];
		if (punct) {
			this.push(punct[0], punct[1], l, c);
			return;
		}

		const assign = ASSIGN_OP[ch];
		if (assign) {
			if (this.match("=")) this.push(assign[0], assign[1], l, c);
			else this.push(assign[2], assign[3], l, c);
			return;
		}

		switch (ch) {
			case "+":
				this._readPlusOp(l, c);
				break;
			case "-":
				this._readMinusOp(l, c);
				break;
			case "<":
				this._readLessOp(l, c);
				break;
			case ">":
				this._readGreaterOp(l, c);
				break;
			case "&":
				this._readAmpOp(l, c);
				break;
			case "|":
				if (this.match("|")) this.push(T.OR, "||", l, c);
				else if (this.match("=")) this.push(T.PIPE_ASSIGN, "|=", l, c);
				else this.push(T.PIPE, "|", l, c);
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
			default:
				this.err(`Unexpected character: '${ch}'`);
		}
	}
}
