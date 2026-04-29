// Token type table and Token class — pure data leaves used by every layer
// (lexer, parser, codegen). Putting these in their own module lets parser
// and codegen depend only on `tokens.js` instead of the full `lexer.js`.

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
