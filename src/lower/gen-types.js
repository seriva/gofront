// src/lower/gen-types.js
// Spells checked types as Go source for the generated per-package file
// (src/lower/json-codecs.js, src/lower/errors-as.js,
// src/lower/fmt-formatters.js), and holds what those generators share: the
// imports the spelled code needs and the enumeration of the program's types.

import { defaultType, suffixPackageName } from "../typechecker/types.js";
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
	// templ bodies keep their Go expressions in non-enumerable properties
	// (see parser/templ.js), which forEachChild does not visit.
	for (const name of TEMPL_EXPR_PROPS) {
		const d = Object.getOwnPropertyDescriptor(root, name);
		if (d && !d.enumerable) walkNodes(d.value, fn);
	}
}

const TEMPL_EXPR_PROPS = ["expr", "exprs", "forStmt"];

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

// A qualifier whose path is `LOCAL_PACKAGE + pkgName` names a local package the
// build compiled rather than a package the generated file imports: the checker
// binds it to that package's types (`bindGeneratedPackage`).
export const LOCAL_PACKAGE = "@local:";

export const localPackageOf = (path) =>
	path.startsWith(LOCAL_PACKAGE) ? path.slice(LOCAL_PACKAGE.length) : null;

// The qualifier prefix the generated file gives a local package it reaches.
export const LOCAL_QUALIFIER = "_gf_pkg_";

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
			// A multi-value call forwarded into interfaces (`return f()`,
			// `g(f())`) keeps one mark holder per element until lowering
			// splits it.
			for (const h of node._fwdIface ?? [])
				if (h?._ifaceSrc)
					found.push({ type: defaultType(h._ifaceSrc), node, via: "boxed" });
		});
	for (const [name, t] of checker.types) {
		if (t?.kind !== "named" || t.name !== name) continue;
		if (name.includes(".") || name.includes("$$")) continue;
		if (t._genericOf || t.typeArgs?.length) continue;
		found.push({ type: t, node: null, via: "declared" });
	}
	return found;
}

// A type this package declared as `Name$$pkg` cannot be written in Go source;
// generated files spell it `Name__PKG_pkg` and `restoredTypeName` renames the
// parsed references back. The package name is any Go identifier, Unicode
// letters included (`package café`).
const STAND_IN = /^(.+)__PKG_([\p{L}\p{Nd}_]+)$/u;

export function renamedStandIn(name) {
	const at = name.indexOf("$$");
	return `${name.slice(0, at)}__PKG_${name.slice(at + 2)}`;
}

export function restoredTypeName(name) {
	const m = STAND_IN.exec(name);
	return m ? `${m[1]}$$${m[2]}` : name;
}

export class TypeSpeller {
	// `qualifiers` receives name -> import path for each package the spelled
	// code names.
	constructor(pkgName, qualifiers, programs = [], checker = null) {
		this.pkgName = pkgName;
		this.checker = checker;
		this.qualifiers = qualifiers;
		this.programs = programs;
		this.importPaths = importPaths(programs);
		this.declared = declaredNames(programs);
		this.owners = new Map(); // type name -> `ownerOf` answer
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
			// A package's own `type error` is renamed before checking, so the
			// name is the universe interface and the spelling cannot be shadowed.
			interface: () => (t.name === "error" ? "error" : "any"),
			func: () => this.funcString(t, sp),
			namespace: () => this.spellNamespace(t),
		};
		if (!byKind[t.kind])
			throw new Error(`json: cannot spell type kind ${t.kind}`);
		return byKind[t.kind]();
	}

	// The package that declares the named type `t`, or null for a type the
	// generated file names bare: this package's own types (declared at package
	// level or in a function), and names no package owns (`.d.ts` types).
	// `{ pkgName, modPath }` otherwise: `modPath` is the import path of a
	// standard library package the generated file imports itself, and null for
	// a local package, which it reaches through a synthetic qualifier (see
	// `localQualifier`). Instances of a generic type belong to the package that
	// declares the template. This is the only place that scans the checker's
	// type table for a type's package.
	ownerOf(t) {
		if (t?.kind !== "named") return null;
		if (!this.owners.has(t.name)) this.owners.set(t.name, this.findOwner(t));
		return this.owners.get(t.name);
	}

	findOwner(t) {
		const { name } = t;
		if (this.declared.has(name) || this.checker?.isFunctionLocalType?.(name))
			return null;
		const at = name.indexOf("$$");
		if (at >= 0) return this.renamedOwner(t, at);
		const dot = name.indexOf(".");
		if (dot > 0) {
			const modPath = this.importPaths.get(name.slice(0, dot));
			return modPath ? { modPath, pkgName: canonicalName(modPath) } : null;
		}
		return this.checker && t._pkgName
			? { pkgName: t._pkgName, modPath: null }
			: null;
	}

	// The owner of a type declared as `Name$$pkg` because its bare name was
	// taken: a type of a local package, which this package's imports reach
	// directly (`q.Name`), through another package, or by dot import; or a
	// standard library type, which carries its import path in the name.
	renamedOwner(t, at) {
		const orig = t.name.slice(0, at);
		const suffix = t.name.slice(at + 2);
		const pkg = suffixPackageName(suffix);
		const stdlib = () => ({
			modPath: suffix.replaceAll("$", "/"),
			pkgName: pkg,
		});
		if (!this.checker) return stdlib();
		const local = { pkgName: t._pkgName ?? pkg, modPath: null };
		// Reached through another package (`mid.leaf.Num`), which may import it
		// under an alias (`mid.l.Num`): a local package's type keeps its package
		// clause as the suffix, where a standard library one has its path.
		const through = `.${pkg}.${orig}`;
		const viaAlias = (key) =>
			t._pkgName === pkg && key.slice(key.lastIndexOf(".") + 1) === orig;
		let indirect = false;
		for (const [key, v] of this.checker.types) {
			if (v !== t && !(t._genericOf && v?._generic === t._genericOf)) continue;
			const dot = key.indexOf(".");
			if (dot < 0 && key === orig) return local;
			if (dot <= 0) continue;
			if (key.slice(dot + 1) === orig) {
				const modPath = this.importPaths.get(key.slice(0, dot));
				if (!modPath || modPath.startsWith(".")) return local;
				return { modPath, pkgName: canonicalName(modPath) };
			}
			if (key.endsWith(through) || viaAlias(key)) indirect = true;
		}
		return indirect ? local : stdlib();
	}

	// The package name `%T` and errors print for the bare-named type `t`: this
	// package, or the package that declares it.
	declaringPackage(t) {
		return this.ownerOf(t)?.pkgName ?? this.pkgName;
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

	// The name the generated file uses for the local package `pkgName`: a
	// synthetic one no import or declaration of the build can shadow.
	localQualifier(pkgName) {
		const path = LOCAL_PACKAGE + pkgName;
		for (const [name, p] of this.qualifiers) if (p === path) return name;
		const base = LOCAL_QUALIFIER + pkgName.replace(/[^A-Za-z0-9_]/g, "_");
		const taken = (n) => this.declared.has(n) || this.qualifiers.has(n);
		let name = base;
		for (let i = 2; taken(name); i++) name = `${base}_${i}`;
		this.qualifiers.set(name, path);
		return name;
	}

	// How the generated file names the type `t`: bare for this package's own
	// types (a renamed one by its lexable stand-in, which `restoredTypeName`
	// turns back into the declared name once parsed), and qualified by its
	// package for any other.
	spellName(t) {
		const { name } = t;
		const renamed = name.includes("$$");
		const owner = this.declared.has(name) ? null : this.ownerOf(t);
		if (!owner) return renamed ? renamedStandIn(name) : name;
		if (owner.modPath) {
			const rest = renamed
				? name.slice(0, name.indexOf("$$"))
				: name.slice(name.indexOf(".") + 1);
			return `${this.qualifierFor(owner.modPath)}.${rest}`;
		}
		return `${this.localQualifier(owner.pkgName)}.${renamed ? renamedStandIn(name) : name}`;
	}

	spellNamed(t) {
		const name = this.spellName(t);
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
			// An unresolved `.d.ts` reference is a type no Go source names.
			basic: () => t.name !== "void" && t.name !== "nil" && !t.alias,
			named: () => this.spellableNamed(t, ok, seen),
			// A JS-interop (.d.ts) type has no Go source to write.
			namespace: () => this.spellableNamespace(t),
			promise: () => false,
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

	spellableNamespace(_t) {
		return false;
	}

	spellNamespace(_t) {
		throw new Error("json: cannot spell type kind namespace");
	}

	spellableStruct(t, ok) {
		return (t._structFields ?? []).every((f) => ok(f.type));
	}
}
