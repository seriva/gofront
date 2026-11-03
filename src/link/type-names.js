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
			for (const d of p.decls ?? []) renameTypeRefs(d, renamed, new Set());
	return renamed;
}

function renameTypeRefs(node, renamed, tparams) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) renameTypeRefs(n, renamed, tparams);
		return;
	}
	const tp = withTypeParams(node, tparams);
	if (isTypeRef(node) && renamed.has(node.name) && !tp.has(node.name))
		node.name = renamed.get(node.name);
	forEachChild(node, (child) => renameTypeRefs(child, renamed, tp));
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

function isTypeRef(node) {
	return TYPE_REF_KINDS.has(node.kind);
}

// Importers name a renamed type by its declared name (`b.Pt`).
export function withOriginalTypeNames(types, renamed) {
	for (const [name, mangled] of renamed)
		if (types.has(mangled)) types.set(name, types.get(mangled));
	return types;
}
