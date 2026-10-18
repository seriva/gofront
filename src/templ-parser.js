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

import { Parser } from "./parser/index.js";
import { TT } from "./templ-lexer.js";
import { T } from "./tokens.js";

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
			if (this.check(TT.TEMPL_CASE) || this.check(TT.TEMPL_DEFAULT)) {
				const isDefault = this.check(TT.TEMPL_DEFAULT);
				const caseTok = this.advance();
				const body = this.parseTemplCaseBody();
				cases.push({
					kind: "TemplCase",
					caseTokens: isDefault ? null : caseTok.value,
					body,
				});
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
