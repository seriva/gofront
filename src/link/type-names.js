// Same-named types in different local packages.
//
// Local packages are inlined into one flat JS module, so `a.Pt` and `b.Pt`
// would both become `class Pt`.  A package that declares a type another
// package already owns gets that type renamed to `Pt$$b` before it is
// type-checked, the convention Go-source stdlib packages use: diagnostics and
// `%T` show it as `b.Pt`, and importers reach it through `b.Pt` as usual.

import { forEachChild } from "../lower/walk.js";

function topLevelTypeNames(programs) {
	const names = [];
	for (const p of programs)
		for (const d of p.decls ?? [])
			if (d.kind === "TypeDecl") names.push(d.name);
	return names;
}

// Registers the package's type names in `owners` (name -> package key) and
// renames those another package registered first.  Returns Map<name, mangled>
// for the renamed types, empty when nothing collides.
export function mangleCollidingTypes(programs, pkgKey, pkgName, owners) {
	const renamed = new Map();
	for (const name of topLevelTypeNames(programs)) {
		const owner = owners.get(name);
		if (owner === undefined) owners.set(name, pkgKey);
		else if (owner !== pkgKey) renamed.set(name, `${name}$$${pkgName}`);
	}
	if (renamed.size > 0)
		for (const p of programs)
			for (const d of p.decls ?? [])
				renameTypeRefs(d, renamed, new Set(), new Set());
	return renamed;
}

// Function-local types are scoped to their block, but the checker and both
// backends key types by bare name.  A local type whose name another type of the
// package also uses (a package-level type or a local of another function)
// is renamed to `Name__L<n>` for its scope; `%T` and diagnostics drop the
// suffix (see `displayTypeName`).  Returns whether anything was renamed.
let localTypeCounter = 0;

export function renameLocalTypes(programs) {
	const counts = new Map();
	const count = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(count);
		if (node.kind === "TypeDecl")
			counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
		forEachChild(node, count);
	};
	for (const p of programs) count(p.decls);
	const dup = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
	if (dup.size === 0) return false;
	let changed = false;
	// Inner scopes first, so an outer rename never touches a nested
	// declaration that already has its own name.
	const scan = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			node.forEach(scan);
			for (let i = 0; i < node.length; i++) {
				const d = node[i];
				if (d?.kind !== "TypeDecl" || !dup.has(d.name)) continue;
				const renamed = new Map([
					[d.name, `${d.name}__L${++localTypeCounter}`],
				]);
				for (let j = i; j < node.length; j++)
					renameTypeRefs(node[j], renamed, new Set(), new Set());
				changed = true;
			}
			return;
		}
		forEachChild(node, scan);
	};
	for (const p of programs)
		for (const d of p.decls ?? []) if (d.kind !== "TypeDecl") scan(d);
	return changed;
}

// `tparams` are type parameters in scope; `values` are names a function
// declares as parameters or locals, which shadow a same-spelled bare `Ident`.
function renameTypeRefs(node, renamed, tparams, values) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) renameTypeRefs(n, renamed, tparams, values);
		return;
	}
	const tp = withTypeParams(node, tparams);
	const vals = FUNC_KINDS.has(node.kind) ? withLocals(node, values) : values;
	if (isTypeRef(node, vals) && renamed.has(node.name) && !tp.has(node.name))
		node.name = renamed.get(node.name);
	forEachChild(node, (child) => {
		if (node.kind === "KeyValueExpr" && child === node.key) return;
		renameTypeRefs(child, renamed, tp, vals);
	});
}

const FUNC_KINDS = new Set(["FuncDecl", "MethodDecl", "FuncLit"]);

// Adds every parameter and local name declared anywhere inside a function.
function withLocals(fn, values) {
	const out = new Set(values);
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(visit);
		for (const n of declaredNames(node)) out.add(n);
		forEachChild(node, visit);
	};
	visit(fn);
	return out;
}

function declaredNames(node) {
	const names = [];
	if (node.kind === "DefineStmt")
		for (const l of node.lhs) if (l.kind === "Ident") names.push(l.name);
	if (node.kind === "VarDecl" || node.kind === "ConstDecl")
		for (const d of node.decls ?? []) names.push(...(d.names ?? []));
	if (node.kind === "TypeSwitchStmt" && node.assign) names.push(node.assign);
	for (const p of node.params ?? []) if (p.name) names.push(p.name);
	if (node.recvName) names.push(node.recvName);
	return names;
}

function withTypeParams(node, tparams) {
	if (!(node.typeParams?.length > 0)) return tparams;
	return new Set([...tparams, ...node.typeParams.map((t) => t.name)]);
}

const TYPE_REF_KINDS = new Set([
	"TypeDecl",
	"TypeName",
	"GenericTypeName",
	"Ident",
]);

function isTypeRef(node, values) {
	if (node.kind === "Ident") return !values.has(node.name);
	return TYPE_REF_KINDS.has(node.kind);
}

// Importers name a renamed type by its declared name (`b.Pt`).
export function withOriginalTypeNames(types, renamed) {
	for (const [name, mangled] of renamed)
		if (types.has(mangled)) types.set(name, types.get(mangled));
	return types;
}
