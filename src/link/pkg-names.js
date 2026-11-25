// Names that local packages share.
//
// Every local package is inlined into one flat JS module and linked into one
// flat WebAssembly module, so two packages that declare the same top-level
// name (`helper`, `Make`, a var, a const, or a type) would collide.  The
// first package to declare a name keeps it; a later one gets the name renamed
// to `name$$suffix` before it is type-checked, the convention the Go-source
// stdlib uses: importers still write `b.Make`, and diagnostics and `%T` show
// the declared name.  `pkgSuffix` is the only producer of the suffix, and
// `suffixPackageName` (typechecker/types.js) reads it back.
//
// Also home of the Go-source stdlib's renamer, which renames a whole package
// from the references its first type-check recorded.

import { renameTypeRefs } from "../lower/local-types.js";
import { forEachChild } from "../lower/walk.js";
import { isExported } from "../typechecker/types.js";

// The suffix (`$$util`) of the local package in `pkgKey` (its directory)
// named `pkgName`.  `suffixes` is the build's table of the suffixes it handed
// out: the first package of a name takes the bare name and a later one in
// another directory gets `util__2`, so `p1/util` and `p2/util` stay apart.
export function pkgSuffix(suffixes, pkgKey, pkgName) {
	const known = suffixes.get(pkgKey);
	if (known) return known;
	const taken = new Set(suffixes.values());
	let suffix = `$$${pkgName}`;
	for (let n = 2; taken.has(suffix); n++) suffix = `$$${pkgName}__${n}`;
	suffixes.set(pkgKey, suffix);
	return suffix;
}

// The declarations that bind one name as a function: a function, a `templ`
// component and a `css` class.
const FUNC_KINDS = new Set(["FuncDecl", "TemplDecl", "CssDecl"]);

// The names the programs declare at package level as values: functions (not
// `init`), `templ` components, `css` classes, vars and consts, in source
// order.  Methods, types and `_` are not.
export function topLevelValueNames(programs) {
	const names = [];
	for (const p of programs)
		for (const d of p.decls ?? []) {
			if (FUNC_KINDS.has(d.kind) && d.name !== "init") names.push(d.name);
			else if (d.kind === "VarDecl" || d.kind === "ConstDecl")
				for (const spec of d.decls ?? [])
					for (const n of spec.names ?? []) if (n !== "_") names.push(n);
		}
	return names;
}

function topLevelTypeDecls(programs) {
	const decls = new Map();
	for (const p of programs)
		for (const d of p.decls ?? [])
			if (d.kind === "TypeDecl") decls.set(d.name, d);
	return decls;
}

// Renames the package-level values in `renamed` (name -> new name) that
// `decl` declares, and every reference to them under it.
function renameValues(decl, renamed, mode, declares) {
	if (declares) {
		if (FUNC_KINDS.has(decl.kind) && renamed.has(decl.name))
			decl.name = renamed.get(decl.name);
		else if (decl.kind === "VarDecl" || decl.kind === "ConstDecl")
			for (const spec of decl.decls ?? [])
				spec.names = spec.names.map((n) => renamed.get(n) ?? n);
	}
	// Package-level specs do not shadow one another the way a function's
	// locals do: every spec sees the whole package.
	if (decl.kind === "VarDecl" || decl.kind === "ConstDecl")
		for (const spec of decl.decls ?? [])
			renameTypeRefs(spec, renamed, new Set(), new Set(), mode);
	else renameTypeRefs(decl, renamed, new Set(), new Set(), mode);
}

// Registers the package's top-level value names in `owners` (name -> package
// key, shared with the type names) and renames those another package
// registered first to `name` + `suffix`.  Returns Map<name, renamed>, empty
// when nothing collides.  A value and a type share one name space across
// packages: `func Box()` in one package and `type Box` in another collide the
// way two functions do.
export function mangleCollidingValues(programs, pkgKey, suffix, owners) {
	const renamed = new Map();
	for (const name of topLevelValueNames(programs)) {
		const owner = owners.get(name);
		if (owner === undefined) owners.set(name, pkgKey);
		else if (owner !== pkgKey) renamed.set(name, `${name}${suffix}`);
	}
	if (renamed.size === 0) return renamed;
	const mode = { typeDecls: topLevelTypeDecls(programs) };
	for (const p of programs)
		for (const d of p.decls ?? []) renameValues(d, renamed, mode, true);
	return renamed;
}

// A file that dot-imports a package spells a value the package renamed by its
// declared name (`Make`), but the build knows it by the renamed one
// (`Make$$b`).  Renames those spellings in `program` once.  `renamed` is the
// package's declared -> renamed map of values; `pkgPrograms` are the importing
// package's files, whose own package-level names are left.  A local that
// shadows the name keeps it.
export function renameDotImportedValues(
	program,
	renamed,
	pkgPrograms = [program],
) {
	const own = new Set([
		...topLevelValueNames(pkgPrograms),
		...topLevelTypeDecls(pkgPrograms).keys(),
	]);
	const refs = new Map(
		[...renamed].filter(([name]) => isExported(name) && !own.has(name)),
	);
	if (refs.size === 0) return;
	const mode = { typeDecls: topLevelTypeDecls(pkgPrograms) };
	for (const d of program.decls ?? []) renameValues(d, refs, mode, false);
}

// ── Go-source stdlib ─────────────────────────────────────────

// Renames the package's top-level declarations and every reference to them.
// `refs` holds the `file:line:col` of identifiers the first type-check
// resolved to package scope; type names are resolved by name (GoFront types
// are package-flat) except where a type parameter shadows them.
// With `lazy`, function and method bodies are left alone: they are mangled
// by `mangleBody` once a lazily checked body is first reached.
export function mangleStdlibAst(programs, ctx, { lazy = false } = {}) {
	for (const p of programs) {
		for (const d of p.decls ?? []) mangleDeclNames(d, ctx);
		for (const d of p.decls ?? []) {
			const deferred =
				lazy && (d.kind === "FuncDecl" || d.kind === "MethodDecl");
			const body = d.body;
			if (deferred) d.body = null;
			mangleRefs(d, p._filename, new Set(), ctx);
			if (deferred) d.body = body;
		}
	}
}

export function mangleBody(decl, file, ctx) {
	const tparams = new Set((decl.typeParams ?? []).map((t) => t.name));
	mangleRefs(decl.body, file, tparams, ctx);
}

function mangleDeclNames(d, { suffix, values }) {
	if (d.kind === "TypeDecl" || (d.kind === "FuncDecl" && values.has(d.name))) {
		d.name += suffix;
	} else if (d.kind === "VarDecl" || d.kind === "ConstDecl") {
		for (const spec of d.decls ?? [])
			spec.names = spec.names.map((n) => (values.has(n) ? n + suffix : n));
	}
}

function mangleRefs(node, file, tparams, ctx) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) mangleRefs(n, file, tparams, ctx);
		return;
	}
	const tp =
		node.typeParams?.length > 0
			? new Set([...tparams, ...node.typeParams.map((t) => t.name)])
			: tparams;
	switch (node.kind) {
		case "TypeName":
		case "GenericTypeName":
			mangleTypeRef(node, tp, ctx);
			break;
		case "CompositeLit":
			if (node.typeExpr?.kind === "Ident")
				mangleTypeRef(node.typeExpr, tp, ctx);
			break;
		case "InstantiationExpr": // `Stack[T]{}`, `Pair[K, V](x)`
		case "IndexExpr":
			if (node.expr?.kind === "Ident") mangleTypeRef(node.expr, tp, ctx);
			break;
		case "CallExpr":
			if (
				(node.func?.name === "new" || node.func?.name === "make") &&
				node.args?.[0]?.kind === "Ident"
			) {
				mangleTypeRef(node.args[0], tp, ctx);
			}
			break;
		case "Ident":
			if (ctx.refs.has(`${file}:${node._line}:${node._col}`))
				mangleIdentRef(node, ctx);
			break;
	}
	forEachChild(node, (child) => mangleRefs(child, file, tp, ctx));
}

function mangleTypeRef(node, tparams, { suffix, types }) {
	if (types.has(node.name) && !tparams.has(node.name)) {
		node.name += suffix;
	}
}

// A package-scope identifier: a package declaration gets the suffix.
function mangleIdentRef(node, { suffix, values, types }) {
	if (values.has(node.name) || types.has(node.name)) {
		node.name += suffix;
	}
}
