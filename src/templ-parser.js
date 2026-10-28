// Templ parser: extends the Go Parser to handle TemplDecl nodes.
//
// A .templ file is tokenised by TemplLexer into a mixed stream of standard Go
// tokens (T.*) and HTML/templ tokens (TT.*). This parser handles TT.TEMPL_KW
// in parseTopDecl; everything else is delegated to the base Parser.
//
// Produced AST additions:
//   TemplDecl   { kind, name, params, body: TemplNode[] }
//   TemplElement { kind, tag, attrs, children }
//   TemplText   { kind, value }
//   TemplExpr   { kind, tokens }          ← raw Go token array
//   TemplComponent { kind, tokens }       ← raw Go token array for call
//   TemplChildren  { kind }
//   TemplIf     { kind, condTokens, then: TemplNode[], else_: TemplNode[] | null }
//   TemplFor    { kind, stmtTokens, body: TemplNode[] }
//   TemplSwitch { kind, exprTokens, cases: TemplCase[] }
//   TemplCase   { kind, caseTokens: tokens | null (null = default), body: TemplNode[] }
//
// Go expressions embedded in templ (`{ expr }`, attribute values, `if`
// conditions, `switch` and `case` expressions, `@Comp(...)` calls) and `for`
// headers are also parsed here, so the code generator never runs the parser.
// The results sit on the node as non-enumerable properties (the generic AST
// walkers in rename/lowering visit enumerable keys only, and these ASTs have
// no type information):
//   expr       Expression AST, or null when there are no tokens to parse
//   exprError  The ParseError a malformed expression raised. The parser keeps
//              it instead of throwing, so the error still surfaces when the
//              code generator reads the node (after type-checking), as before
//   raw        TemplComponent only: `@templ.Raw(arg)`; `expr` is then `arg`
//   forStmt    TemplFor only: the parsed ForStmt, or null when the header does
//              not parse as a Go `for` clause
//   forTokens  TemplFor only: stmtTokens without trailing semicolons
//   attr.expr / attr.exprError on `expr` and `cond-bool` attributes

import { Parser } from "./parser/index.js";
import { TT } from "./templ-lexer.js";
import { T, Token } from "./tokens.js";

const VOID_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

function attach(node, props) {
	for (const [name, value] of Object.entries(props)) {
		Object.defineProperty(node, name, {
			value,
			enumerable: false,
			writable: true,
			configurable: true,
		});
	}
	return node;
}

// Parses `tokens` as one Go expression, ending at a synthetic EOF token.
function parseExprTokens(tokens) {
	if (!tokens || tokens.length === 0) return { expr: null };
	try {
		const eofTok = new Token(T.EOF, "", 1, 1);
		return { expr: new Parser([...tokens, eofTok]).parseExpr() };
	} catch (exprError) {
		return { expr: null, exprError };
	}
}

// Parses an `if` condition; the lexer may leave the `if` keyword in front.
function parseCondTokens(tokens) {
	if (!tokens || tokens.length === 0) return { expr: null };
	return parseExprTokens(tokens[0]?.type === T.IF ? tokens.slice(1) : tokens);
}

function isTemplRaw(toks) {
	return (
		toks.length >= 4 &&
		toks[0]?.value === "templ" &&
		toks[1]?.type === T.DOT &&
		toks[2]?.value === "Raw" &&
		toks[3]?.type === T.LPAREN
	);
}

// Strips the trailing semicolons the Go lexer inserts at a newline.
function trimSemicolons(tokens) {
	let end = tokens.length;
	while (end > 0 && tokens[end - 1].type === T.SEMICOLON) end--;
	return tokens.slice(0, end);
}

// Parses a `for` header (the `for` keyword plus the clause, no body) as a
// ForStmt, with a fake empty body `{ }` so the parser can complete it. Returns
// null when it is not a valid Go `for` clause.
function parseForHeader(tokens) {
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
		return new Parser(withFor).parseFor();
	} catch {
		return null;
	}
}

// Parses the `expr` and `cond-bool` attribute expressions of an element.
function parseAttrExprs(attrs) {
	for (const attr of attrs) {
		if (attr.kind === "expr" || attr.kind === "cond-bool")
			attach(attr, parseExprTokens(attr.tokens));
	}
	return attrs;
}

export class TemplParser extends Parser {
	// ── Top-level declaration override ───────────────────────────

	parseTopDecl() {
		if (this.check(TT.TEMPL_KW)) return this.parseTemplDecl();
		if (this.check(TT.CSS_KW)) return this.parseCssDecl();
		return super.parseTopDecl();
	}

	// ── CssDecl ───────────────────────────────────────────────────

	_parseDecl(kind, bodyFn) {
		const _line = this.peek().line;
		this.advance();
		const name = this.expect(T.IDENT).value;
		const params = this.parseParamList();
		this.semi();
		this.expect(T.LBRACE);
		const extra = bodyFn();
		this.semi();
		return { kind, name, params, ...extra, _line };
	}

	parseCssDecl() {
		return this._parseDecl("CssDecl", () => {
			const bodyToken = this.expect(TT.CSS_BODY);
			const cssText = bodyToken.value;
			this.expect(T.RBRACE);
			return { cssText };
		});
	}

	parseTemplDecl() {
		return this._parseDecl("TemplDecl", () => ({
			body: this.parseHtmlChildren(),
		}));
	}

	// ── HTML node parsing ─────────────────────────────────────────

	// Parse zero or more HTML nodes until RBRACE (end of body) or EOF.
	// Consumes the RBRACE.
	parseHtmlChildren() {
		const nodes = [];
		while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
			if (this.check(TT.TEMPL_ELSE)) break; // handled by caller (parseTemplIf)
			const node = this.parseHtmlNode();
			if (node) nodes.push(node);
		}
		if (this.check(T.RBRACE)) this.advance(); // consume }
		return nodes;
	}

	// Parse a single HTML node from the current token.
	parseHtmlNode() {
		const t = this.peek();
		switch (t.type) {
			case TT.HTML_OPEN:
				return this.parseHtmlElement();
			case TT.HTML_SELF: {
				this.advance();
				return {
					kind: "TemplElement",
					tag: t.value.tag,
					attrs: parseAttrExprs(t.value.attrs),
					children: [],
				};
			}
			case TT.HTML_TEXT:
				this.advance();
				return { kind: "TemplText", value: t.value };
			case TT.TEMPL_EXPR:
				this.advance();
				return attach(
					{ kind: "TemplExpr", tokens: t.value },
					parseExprTokens(t.value),
				);
			case TT.TEMPL_COMP:
				this.advance();
				return this.templComponent(t.value);
			case TT.TEMPL_CHILDREN:
				this.advance();
				return { kind: "TemplChildren" };
			case TT.TEMPL_IF: {
				this.advance();
				return this.parseTemplIf(t);
			}
			case TT.TEMPL_FOR: {
				this.advance();
				return this.parseTemplFor(t);
			}
			case TT.TEMPL_SWITCH: {
				this.advance();
				return this.parseTemplSwitch(t);
			}
			default:
				// Unknown token inside HTML body — skip it to avoid infinite loops
				this.advance();
				return null;
		}
	}

	// `@templ.Raw(arg)` parses `arg`; any other component parses the whole call.
	templComponent(tokens) {
		const raw = isTemplRaw(tokens);
		const parsed = parseExprTokens(raw ? tokens.slice(4, -1) : tokens);
		return attach({ kind: "TemplComponent", tokens }, { raw, ...parsed });
	}

	// Parse children of an element until the matching close tag.
	parseHtmlElement() {
		const openTok = this.advance(); // HTML_OPEN
		const { tag } = openTok.value;
		const attrs = parseAttrExprs(openTok.value.attrs);

		// Void elements have no children and no close tag even without />
		if (VOID_ELEMENTS.has(tag)) {
			return { kind: "TemplElement", tag, attrs, children: [] };
		}

		const children = [];
		while (!this.check(T.EOF) && !this.check(T.RBRACE)) {
			if (this.check(TT.HTML_CLOSE)) break;
			// Also break on a close tag for a different ancestor (shouldn't happen in
			// well-formed HTML, but prevents infinite loops on malformed input)
			if (this.check(TT.TEMPL_ELSE)) break;
			const node = this.parseHtmlNode();
			if (node) children.push(node);
		}
		if (this.check(TT.HTML_CLOSE)) {
			const closeTag = this.peek().value;
			if (closeTag !== tag) {
				throw new Error(
					`${this.filename ?? "<templ>"}:${this.peek().line}: unclosed tag <${tag}>, got </${closeTag}>`,
				);
			}
			this.advance(); // consume HTML_CLOSE
		} else if (!VOID_ELEMENTS.has(tag)) {
			// Non-void element with no close tag — parse error
			throw new Error(
				`${this.filename ?? "<templ>"}:${openTok.line}: unclosed tag <${tag}>`,
			);
		}
		return { kind: "TemplElement", tag, attrs, children };
	}

	// Parse a TemplIf node. `tok` is the TEMPL_IF token (already advanced).
	parseTemplIf(tok) {
		const condTokens = tok.value; // array of Go tokens
		const then = this.parseHtmlChildren(); // reads body until RBRACE
		let else_ = null;
		if (this.check(TT.TEMPL_ELSE)) {
			this.advance(); // consume TEMPL_ELSE
			if (this.check(TT.TEMPL_IF)) {
				const t2 = this.advance();
				else_ = [this.parseTemplIf(t2)]; // else if → wrap in array
			} else {
				else_ = this.parseHtmlChildren(); // else body until RBRACE
			}
		}
		return attach(
			{ kind: "TemplIf", condTokens, then, else_ },
			parseCondTokens(condTokens),
		);
	}

	// Parse a TemplFor node. `tok` is the TEMPL_FOR token (already advanced).
	parseTemplFor(tok) {
		const stmtTokens = tok.value;
		const body = this.parseHtmlChildren();
		const forTokens = trimSemicolons(stmtTokens);
		return attach(
			{ kind: "TemplFor", stmtTokens, body },
			{ forTokens, forStmt: parseForHeader(forTokens) },
		);
	}

	// Parse a TemplSwitch node. `tok` is the TEMPL_SWITCH token (already advanced).
	parseTemplSwitch(tok) {
		const exprTokens = tok.value;
		const cases = [];
		while (
			!this.check(TT.TEMPL_END) &&
			!this.check(T.RBRACE) &&
			!this.check(T.EOF)
		) {
			if (this.check(TT.TEMPL_CASE) || this.check(TT.TEMPL_DEFAULT)) {
				const isDefault = this.check(TT.TEMPL_DEFAULT);
				const caseTok = this.advance();
				const body = this.parseTemplCaseBody();
				const caseTokens = isDefault ? null : caseTok.value;
				cases.push(
					attach(
						{ kind: "TemplCase", caseTokens, body },
						isDefault ? { expr: null } : parseExprTokens(caseTokens),
					),
				);
			} else {
				this.advance(); // skip unexpected
			}
		}
		if (this.check(TT.TEMPL_END)) this.advance(); // consume closing }
		return attach(
			{ kind: "TemplSwitch", exprTokens, cases },
			parseExprTokens(exprTokens),
		);
	}

	// Parse HTML nodes for a switch case body — stops at CASE/DEFAULT/END/RBRACE.
	parseTemplCaseBody() {
		const nodes = [];
		while (
			!this.check(TT.TEMPL_CASE) &&
			!this.check(TT.TEMPL_DEFAULT) &&
			!this.check(TT.TEMPL_END) &&
			!this.check(T.RBRACE) &&
			!this.check(T.EOF)
		) {
			if (this.check(TT.TEMPL_ELSE)) break;
			const node = this.parseHtmlNode();
			if (node) nodes.push(node);
		}
		return nodes;
	}
}
