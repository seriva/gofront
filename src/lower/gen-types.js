// src/lower/gen-types.js
// Spells checked types as Go source for the generated per-package file
// (src/lower/json-codecs.js, src/lower/errors-as.js,
// src/lower/fmt-formatters.js), and holds what those generators share: the
// imports the spelled code needs and the enumeration of the program's types.

import { defaultType } from "../typechecker/types.js";
import { forEachChild } from "./walk.js";

export function under(t) {
	return t?.kind === "named" ? under(t.underlying) : t;
}

export const isEmptyIface = (t) =>
	(t?.kind === "basic" && t.name === "any") ||
	(under(t)?.kind === "interface" && under(t).methods?.size === 0);

// Arrays and maps of these share one WebAssembly representation (and so one
// type-switch case), so only literals may register them: a `[2]byte` conversion
// must not shadow a `[2]int32` that is stored in an interface.  A slice of
// them is tagged with its Go type in an interface and registers like any other.
export const SHARED_REPR = new Set([
	"bool",
	"int8",
	"int16",
	"int32",
	"uint8",
	"uint16",
	"uint32",
	"byte",
	"rune",
]);

export function hasSharedRepr(t, depth = 0) {
	if (!t || depth > 8) return false;
	const u = under(t);
	if (u?.kind === "basic") return SHARED_REPR.has(u.name);
	if (u?.kind === "slice" || u?.kind === "array")
		return hasSharedRepr(u.elem, depth + 1);
	if (u?.kind === "map")
		return hasSharedRepr(u.key, depth + 1) || hasSharedRepr(u.value, depth + 1);
	return false;
}

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

// The last element of an import path: the package's name.
const canonicalName = (modPath) => modPath.split("/").pop();

// The names the programs declare at package level.
function declaredNames(programs) {
	const names = new Set();
	for (const p of programs)
		for (const d of p.decls ?? []) {
			if (d.kind === "TypeDecl" || d.kind === "FuncDecl") names.add(d.name);
			else if (d.kind === "VarDecl" || d.kind === "ConstDecl")
				for (const spec of d.decls ?? [])
					for (const n of spec.names ?? []) names.add(n);
		}
	return names;
}

// Every name an import answers to (its alias, its package name) -> its path.
function importPaths(programs) {
	const paths = new Map();
	for (const p of programs)
		for (const imp of p.imports ?? [])
			for (const spec of imp.imports) {
				if (spec.alias === "_" || spec.alias === ".") continue;
				paths.set(canonicalName(spec.path), spec.path);
				if (spec.alias) paths.set(spec.alias, spec.path);
			}
	return paths;
}

// The generated file's imports for the qualifiers (name -> path) its code
// spells: a path, or { path, alias } for a qualifier renamed to stay clear of
// a package-level name.
export function importsFor(qualifiers) {
	return [...qualifiers].map(([name, path]) =>
		name === canonicalName(path) ? path : { path, alias: name },
	);
}

// Every type a closed-world generator may need to describe: the entries
// { type, node, via } for the type arguments of generic calls (`typeArg`),
// the type of every expression (`expr`), the static type of every value
// converted to an interface (`boxed`) and the package's declared named types
// (`declared`, node null).
export function collectProgramTypes(programs, checker) {
	const found = [];
	for (const p of programs)
		walkNodes(p.decls, (node) => {
			for (const a of node._typeArgs ?? [])
				found.push({ type: defaultType(a), node, via: "typeArg" });
			if (node._type)
				found.push({ type: defaultType(node._type), node, via: "expr" });
			if (node._ifaceSrc)
				found.push({ type: defaultType(node._ifaceSrc), node, via: "boxed" });
		});
	for (const [name, t] of checker.types) {
		if (t?.kind !== "named" || t.name !== name) continue;
		if (name.includes(".") || name.includes("$$")) continue;
		if (t._genericOf || t.typeArgs?.length) continue;
		found.push({ type: t, node: null, via: "declared" });
	}
	return found;
}

export class TypeSpeller {
	// `qualifiers` receives name -> import path for each package the spelled
	// code names.
	constructor(pkgName, qualifiers, programs = []) {
		this.pkgName = pkgName;
		this.qualifiers = qualifiers;
		this.programs = programs;
		this.importPaths = importPaths(programs);
		this.declared = declaredNames(programs);
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

	// The package name `%T` and errors print for the bare-named type `t`: this
	// package, or the local package an importer reaches it through as `p.Name`.
	declaringPackage(t) {
		if (this.declared.has(t.name) || !this.checker) return this.pkgName;
		for (const [key, v] of this.checker.types) {
			const dot = key.indexOf(".");
			if (v !== t || dot <= 0 || key.slice(dot + 1) !== t.name) continue;
			const modPath = this.importPaths.get(key.slice(0, dot));
			if (modPath) return canonicalName(modPath);
		}
		return this.pkgName;
	}

	// The name the generated file uses for the package at `modPath`: its
	// package name, or `_gf_<name>` when the package declares that name itself
	// or another path took it.
	qualifierFor(modPath) {
		for (const [name, path] of this.qualifiers)
			if (path === modPath) return name;
		const base = canonicalName(modPath);
		const taken = (n) => this.declared.has(n) || this.qualifiers.has(n);
		let name = base;
		for (let i = 1; taken(name); i++) name = `_gf_${base}${i > 1 ? i : ""}`;
		this.qualifiers.set(name, modPath);
		return name;
	}

	spellNamed(t) {
		let name = t.name;
		const at = name.indexOf("$$");
		const dot = name.indexOf(".");
		if (at >= 0) {
			const orig = name.slice(0, at);
			const modPath = name.slice(at + 2).replaceAll("$", "/");
			name = `${this.qualifierFor(modPath)}.${orig}`;
		} else if (dot > 0) {
			const modPath = this.importPaths.get(name.slice(0, dot));
			if (modPath) name = `${this.qualifierFor(modPath)}${name.slice(dot)}`;
		}
		return t.typeArgs?.length
			? `${name}[${t.typeArgs.map((a) => this.spell(a)).join(", ")}]`
			: name;
	}

	spellStruct(t) {
		const fields = (t._structFields ?? []).map((f) => {
			const tag = f.tag ? ` \`${f.tag}\`` : "";
			if (f.embedded) return `${this.spell(f.type)}${tag}`;
			return `${f.names.join(", ")} ${this.spell(f.type)}${tag}`;
		});
		return `struct { ${fields.join("; ")} }`;
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

	// True when the type can be written as Go source in the generated file.
	// Subclasses decide what a named type, an interface and a struct field
	// need.
	spellable(t, depth = 0, seen = new Set()) {
		if (!t || depth > 8) return false;
		const ok = (x) => this.spellable(x, depth + 1, seen);
		const byKind = {
			basic: () => t.name !== "void" && t.name !== "nil",
			named: () => this.spellableNamed(t, ok, seen),
			// A JS-interop (.d.ts) type has no Go source to write.
			namespace: () => false,
			pointer: () => ok(t.base),
			slice: () => ok(t.elem),
			array: () => ok(t.elem),
			map: () => ok(t.key) && ok(t.value),
			interface: () => this.spellableInterface(t),
			struct: () => this.spellableStruct(t, ok),
			func: () => t.params.every(ok) && results(t).every(ok),
		};
		return byKind[t.kind]?.() ?? false;
	}

	spellableInterface(_t) {
		return true;
	}

	spellableStruct(t, ok) {
		return (t._structFields ?? []).every((f) => ok(f.type));
	}
}
