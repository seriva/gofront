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

import { T } from "./lexer.js";
import { Parser } from "./parser.js";
import { TT } from "./templ-lexer.js";

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

export class TemplParser extends Parser {
	// ── Top-level declaration override ───────────────────────────

	parseTopDecl() {
		if (this.check(TT.TEMPL_KW)) return this.parseTemplDecl();
		return super.parseTopDecl();
	}

	// ── TemplDecl ─────────────────────────────────────────────────

	parseTemplDecl() {
		const _line = this.peek().line;
		this.advance(); // consume TEMPL_KW

		const name = this.expect(T.IDENT).value;

		// Parse parameter list (standard Go params: LPAREN...RPAREN)
		const params = this.parseParamList();

		// Optional semicolon between ) and {
		this.semi();

		// Consume the opening { of the HTML body
		this.expect(T.LBRACE);

		// Parse the HTML body; parseHtmlChildren consumes the closing RBRACE
		const body = this.parseHtmlChildren();

		this.semi();

		return { kind: "TemplDecl", name, params, body, _line };
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
					attrs: t.value.attrs,
					children: [],
				};
			}
			case TT.HTML_TEXT:
				this.advance();
				return { kind: "TemplText", value: t.value };
			case TT.TEMPL_EXPR:
				this.advance();
				return { kind: "TemplExpr", tokens: t.value };
			case TT.TEMPL_COMP:
				this.advance();
				return { kind: "TemplComponent", tokens: t.value };
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

	// Parse children of an element until the matching close tag.
	parseHtmlElement() {
		const openTok = this.advance(); // HTML_OPEN
		const { tag, attrs } = openTok.value;
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
		return { kind: "TemplIf", condTokens, then, else_ };
	}

	// Parse a TemplFor node. `tok` is the TEMPL_FOR token (already advanced).
	parseTemplFor(tok) {
		const stmtTokens = tok.value;
		const body = this.parseHtmlChildren();
		return { kind: "TemplFor", stmtTokens, body };
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
			if (this.check(TT.TEMPL_CASE)) {
				const caseTok = this.advance();
				const body = this.parseTemplCaseBody();
				cases.push({ kind: "TemplCase", caseTokens: caseTok.value, body });
			} else if (this.check(TT.TEMPL_DEFAULT)) {
				this.advance();
				const body = this.parseTemplCaseBody();
				cases.push({ kind: "TemplCase", caseTokens: null, body });
			} else {
				this.advance(); // skip unexpected
			}
		}
		if (this.check(TT.TEMPL_END)) this.advance(); // consume closing }
		return { kind: "TemplSwitch", exprTokens, cases };
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
