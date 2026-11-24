// Templ (.templ file) code-generation mixin for CodeGen.
// Mounts an HTML/expression tree onto a parent DOM node by emitting plain
// document.createElement / appendChild / setAttribute calls.

import { forEachChild } from "../../lower/walk.js";
import { signalOf, UnsupportedError } from "../../typechecker/types.js";

/** @typedef {import('./index.js').CodeGen} CodeGen */

// Whether evaluating `node` calls `Get` on a `gom.Signal` or `gom.Computed`.
// A function literal is only declared, not run, by the expression holding it.
function readsSignal(node) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node)) return node.some(readsSignal);
	if (node.kind === "FuncLit") return false;
	if (
		node.kind === "CallExpr" &&
		node.func?.kind === "SelectorExpr" &&
		node.func.field === "Get" &&
		signalOf(node.func.expr?._type)
	)
		return true;
	let found = false;
	forEachChild(node, (child) => {
		found ||= readsSignal(child);
	});
	return found;
}

/**
 * How a checked `.templ` expression depends on signals: "bare" when its value
 * is itself a `gom.Signal` or `gom.Computed` (read through `Get`), "reads"
 * when it calls `Get` on one, null when it reads none.
 */
export function templReactivity(expr) {
	if (signalOf(expr?._type)) return "bare";
	return readsSignal(expr) ? "reads" : null;
}

/** @type {ThisType<CodeGen>} */
export const templGenMethods = {
	genTemplDecl(decl) {
		const params = decl.params
			.map((p, i) =>
				p.variadic && i === decl.params.length - 1 ? `...${p.name}` : p.name,
			)
			.join(", ");
		this.line(`function ${decl.name}(${params}) {`);
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set(this._boxedGlobals);
		this.indented(() => {
			// `@W(xs...)` passes `{ __sp: xs }` like any Go variadic call.
			const last = decl.params[decl.params.length - 1];
			if (last?.variadic && last.name && last.name !== "_") {
				this.useHelper("va");
				this.line(`${last.name} = __va(${last.name});`);
			}
			this.line(`return {Mount(___p, ___refs) {`);
			this.indented(() => {
				this._genTemplNodes(decl.body, "___p");
			});
			this.line(`}};`);
		});
		this._boxedVars = prevBoxed;
		this.line("}");
	},

	genCssDecl(decl) {
		if (decl.params && decl.params.length > 0) {
			throw new UnsupportedError(
				`css ${decl.name}: parameterized css declarations are not yet supported`,
			);
		}
		const className = this.getCssClassName(decl);
		const scopedCss = `.${className} {\n${decl.cssText.trim()}\n}`;
		this.collectedCss.push(scopedCss);

		this.line(`function ${decl.name}() {`);
		this.indented(() => {
			this.line(`return ${JSON.stringify(className)};`);
		});
		this.line("}");
	},

	getCssClassName(decl) {
		if (decl._className) return decl._className;
		let h = 2166136261 >>> 0;
		const goName = decl._goName ?? decl.name;
		const str = `${decl._pkgName || ""}_${goName}_${decl.cssText}`;
		for (let i = 0; i < str.length; i++) {
			h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
		}
		const hash = (h >>> 0).toString(36);
		decl._className = `gfc_${goName}_${hash}`;
		return decl._className;
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
				return this._genTemplText(node, p);
			case "TemplComponent":
				return this._genTemplComponentMount(node, p);
			case "TemplChildren": {
				// `{ name... }`: mount each node of a variadic gom.Node parameter
				// (nil mounts nothing). `children` may also be absent altogether.
				const slot =
					node.name === "children"
						? `(typeof children!=="undefined"?children:null)`
						: this._genTemplExpr(node, "null");
				return this.line(
					`for (const ___c of ${slot} ?? []) ___c?.Mount?.(${p});`,
				);
			}
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

	// `{ expr }` as text. An expression that reads a signal gets its own text
	// node that an Effect rewrites whenever the signal changes.
	_genTemplText(node, p) {
		const { js, reactive } = this._genTemplValue(node, '""');
		if (!reactive)
			return this.line(
				`${p}.appendChild(document.createTextNode(String(${js})));`,
			);
		const t = this._freshVar("t");
		this.line(`const ${t} = document.createTextNode("");`);
		this.line(`${p}.appendChild(${t});`);
		this._genTemplEffect(`${t}.data = String(${js});`);
	},

	_genTemplComponentMount(node, p) {
		// Special case: @templ.Raw(expr) → insertAdjacentHTML
		if (node.raw) {
			const argJs = this._genTemplExpr(node, '""');
			return this.line(`${p}.insertAdjacentHTML("beforeend", ${argJs});`);
		}
		return this.line(
			`(${this._genTemplExpr(node, "null")}).Mount(${p}, ___refs);`,
		);
	},

	_genTemplElement(node, p) {
		const { tag, attrs, children } = node;
		const elVar = this._freshVar("e");
		// <svg> and its descendants must be created in the SVG namespace.
		const isSvg = tag === "svg" || this._templSvgDepth > 0;
		if (isSvg) {
			this.line(
				`const ${elVar} = document.createElementNS("http://www.w3.org/2000/svg", ${JSON.stringify(tag)});`,
			);
		} else {
			this.line(
				`const ${elVar} = document.createElement(${JSON.stringify(tag)});`,
			);
		}
		this._templSvgDepth = (this._templSvgDepth || 0) + (isSvg ? 1 : 0);
		for (const attr of attrs) {
			this._genTemplAttr(attr, elVar, isSvg);
		}
		this._genTemplNodes(children, elVar);
		if (isSvg) this._templSvgDepth--;
		this.line(`${p}.appendChild(${elVar});`);
	},

	_genTemplAttr(attr, el, isSvg) {
		const { name } = attr;
		// SVGElement.className is a read-only SVGAnimatedString.
		const setClass = (js) =>
			isSvg
				? `${el}.setAttribute("class", ${js});`
				: `${el}.className = ${js};`;
		if (attr.kind === "ref") {
			// ref="key" — capture element into the refs map at mount time
			this.line(`if(___refs)___refs[${JSON.stringify(attr.value)}]=${el};`);
		} else if (attr.kind === "static") {
			if (name === "class") {
				this.line(setClass(JSON.stringify(attr.value)));
			} else {
				this.line(
					`${el}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(attr.value)});`,
				);
			}
		} else if (attr.kind === "expr") {
			const exprJs = this._genTemplExpr(attr, '""');
			if (name === "class") {
				this.line(setClass(exprJs));
			} else {
				this.line(
					`${el}.setAttribute(${JSON.stringify(name)}, String(${exprJs}));`,
				);
			}
		} else if (attr.kind === "bool") {
			this.line(`${el}.setAttribute(${JSON.stringify(name)}, "");`);
		} else if (attr.kind === "cond-bool") {
			const exprJs = this._genTemplExpr(attr, '""');
			this.line(
				`if(${exprJs})${el}.setAttribute(${JSON.stringify(name)}, "");`,
			);
		}
	},

	// Runs `stmt` now and again whenever a signal it reads changes. The Effect
	// belongs to the root being mounted into, so mounting that root again
	// stops it.
	_genTemplEffect(stmt) {
		this.line(`Effect$$gom(function() { ${stmt} });`);
	},

	// The JS of the Go expression of `node` and whether it reads a signal. A
	// bare `gom.Signal` or `gom.Computed` is read through its `Get`.
	_genTemplValue(node, emptyJs) {
		const js = this._genTemplExpr(node, emptyJs);
		const how = node.expr ? templReactivity(node.expr) : null;
		return {
			js: how === "bare" ? `(${js}).Get()` : js,
			reactive: how !== null,
		};
	},

	_genTemplIf(node, p) {
		const condJs = this._genTemplExpr(node, "false");
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
			this.line(`} else if (${this._genTemplExpr(elseIf, "false")}) {`);
			this.indented(() => this._genTemplNodes(elseIf.then, p));
			this._genTemplIfElse(elseIf.else_, p);
		} else {
			this.line(`} else {`);
			this.indented(() => this._genTemplNodes(else_, p));
			this.line(`}`);
		}
	},

	_genTemplSwitch(node, p) {
		const { cases } = node;
		if (cases.length === 0) return;
		// `switch { case cond: }` compares each condition with `true`.
		const exprJs = this._genTemplExpr(node, "true");
		this.line(`switch (${exprJs}) {`);
		this.indented(() => {
			for (const c of cases) {
				if (c.caseTokens === null) this.line("default: {");
				else {
					// One JS label per value of `case a, b:`.
					if (c.exprError) throw c.exprError;
					const labels = (c.exprs ?? []).map((e) => `case ${this.genExpr(e)}:`);
					this.line(`${labels.join(" ") || 'case "":'} {`);
				}
				this.indented(() => this._genTemplNodes(c.body, p));
				this.line(`break; }`);
			}
		});
		this.line(`}`);
	},

	// The header is a parsed Go `for` statement, so it goes through the regular
	// loop generator; its body is a statement that mounts the templ nodes.
	_genTemplFor(node, p) {
		if (node.forError) throw node.forError;
		if (!node.forStmt)
			throw new Error("templ for header was not parsed by TemplParser");
		const mount = { kind: "TemplMount", parent: p };
		// Hidden from the generic AST walkers: they know no templ node kinds.
		Object.defineProperty(mount, "nodes", { value: node.body });
		this.genFor({
			...node.forStmt,
			body: { kind: "Block", stmts: [mount] },
		});
	},

	_genTemplMountStmt(stmt) {
		this._genTemplNodes(stmt.nodes, stmt.parent);
	},

	// Emit JS for the Go expression TemplParser parsed onto `node`. `emptyJs` is
	// the value when the node holds no tokens. A parse error is raised here,
	// not in the parser, so it surfaces at the same point as it always did.
	_genTemplExpr(node, emptyJs) {
		if (node.exprError) throw node.exprError;
		if (node.expr === undefined)
			throw new Error("templ expression was not parsed by TemplParser");
		return node.expr ? this.genExpr(node.expr) : emptyJs;
	},

	// Rename handlers for `_renameReservedIdents`: templ bodies keep their Go
	// expressions in non-enumerable props (see parser/templ.js), which its
	// generic walk does not visit, so `class` in `{ class }` would stay unsafe.
	_renameTemplExprNode(node) {
		this._renameReservedIdents(node.expr);
		// `case a, b:` keeps every expression in `exprs`, not only the first.
		this._renameReservedIdents(node.exprs);
	},

	_renameTemplForNode(node) {
		this._renameReservedIdents(node.forStmt);
	},

	_renameTemplElementNode(node) {
		for (const attr of node.attrs ?? []) this._renameReservedIdents(attr.expr);
	},

	// Fresh variable name counter
	_freshVar(prefix = "v") {
		this._templVarCount = (this._templVarCount ?? 0) + 1;
		return `___${prefix}${this._templVarCount}`;
	},
};
