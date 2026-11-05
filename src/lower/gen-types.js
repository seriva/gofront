// src/lower/gen-types.js
// Spells checked types as Go source for the generated per-package file
// (src/lower/json-codecs.js, src/lower/errors-as.js).

import { forEachChild } from "./walk.js";

// A method's results; a multi-value result is one tuple type.
export function results(m) {
	const r = (m.returns ?? []).filter(
		(t) => !(t?.kind === "basic" && t.name === "void"),
	);
	return r.length === 1 && r[0]?.kind === "tuple" ? r[0].types : r;
}

// Calls every `fn(node)` for the AST nodes under `root`.
export function walkNodes(root, fn) {
	if (!root || typeof root !== "object") return;
	if (Array.isArray(root)) {
		for (const n of root) walkNodes(n, fn);
		return;
	}
	fn(root);
	forEachChild(root, (c) => walkNodes(c, fn));
}

// True when `t` mentions a type parameter (a generic declaration, or a type
// built from one inside a generic function).
export function mentionsTypeParam(t, seen = new Set()) {
	if (!t || seen.has(t)) return false;
	seen.add(t);
	const m = (x) => mentionsTypeParam(x, seen);
	switch (t.kind) {
		case "typeParam":
			return true;
		case "named":
			return (t.typeArgs ?? []).some(m) || m(t.underlying);
		case "pointer":
			return m(t.base);
		case "slice":
		case "array":
			return m(t.elem);
		case "map":
			return m(t.key) || m(t.value);
		case "struct":
			return (t._structFields ?? []).some((f) => m(f.type));
		default:
			return false;
	}
}

export class TypeSpeller {
	constructor(pkgName, qualifiers, programs = []) {
		this.pkgName = pkgName;
		this.qualifiers = qualifiers;
		this.programs = programs;
	}

	// Go source for the type.
	spell(t) {
		const sp = (x) => this.spell(x);
		const byKind = {
			basic: () => t.name,
			named: () => this.spellNamed(t),
			pointer: () => `*${sp(t.base)}`,
			slice: () => `[]${sp(t.elem)}`,
			array: () => `[${t.size}]${sp(t.elem)}`,
			map: () => `map[${sp(t.key)}]${sp(t.value)}`,
			struct: () => this.spellStruct(t),
			interface: () => (t.name === "error" ? "error" : "any"),
			func: () => this.funcString(t, sp),
		};
		if (!byKind[t.kind])
			throw new Error(`json: cannot spell type kind ${t.kind}`);
		return byKind[t.kind]();
	}

	resolveImportAlias(modPath) {
		for (const p of this.programs) {
			for (const imp of p.imports ?? []) {
				for (const spec of imp.imports) {
					if (spec.path === modPath) {
						return spec.alias ?? spec.path.split("/").pop();
					}
				}
			}
		}
		return modPath.split("/").pop();
	}

	spellNamed(t) {
		let name = t.name;
		const at = name.indexOf("$$");
		if (at >= 0) {
			const orig = name.slice(0, at);
			const modPath = name.slice(at + 2).replaceAll("$", "/");
			const alias = this.resolveImportAlias(modPath);
			this.qualifiers.add(alias);
			name = `${alias}.${orig}`;
		}
		const base = this.qualified(name);
		return t.typeArgs?.length
			? `${base}[${t.typeArgs.map((a) => this.spell(a)).join(", ")}]`
			: base;
	}

	spellStruct(t) {
		const fields = (t._structFields ?? []).map((f) => {
			const tag = f.tag ? ` \`${f.tag}\`` : "";
			if (f.embedded) return `${this.spell(f.type)}${tag}`;
			return `${f.names.join(", ")} ${this.spell(f.type)}${tag}`;
		});
		return `struct { ${fields.join("; ")} }`;
	}

	qualified(name) {
		const dot = name.indexOf(".");
		if (dot > 0) this.qualifiers.add(name.slice(0, dot));
		return name;
	}

	funcString(t, name) {
		const rs = results(t);
		const res =
			rs.length === 0
				? ""
				: rs.length === 1
					? ` ${name(rs[0])}`
					: ` (${rs.map(name).join(", ")})`;
		// The signature keeps a variadic parameter's element type.
		const params = t.params.map((p, i) =>
			t.variadic && i === t.params.length - 1 ? `...${name(p)}` : name(p),
		);
		return `func(${params.join(", ")})${res}`;
	}
}
