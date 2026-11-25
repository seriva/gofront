// Same-named types in different local packages.
//
// Local packages are inlined into one flat JS module, so `a.Pt` and `b.Pt`
// would both become `class Pt`.  A package that declares a type another
// package already owns gets that type renamed to `Pt$$b` before it is
// type-checked, the convention Go-source stdlib packages use: diagnostics and
// `%T` show it as `b.Pt`, and importers reach it through `b.Pt` as usual.

import {
	freshLocalName,
	renameLocalTypes,
	renameTypeRefs,
	valueNamesIn,
} from "../lower/local-types.js";
import {
	declaredTypeNames,
	forEachChild,
	forEachTemplGo,
} from "../lower/walk.js";
import { isExported } from "../typechecker/types.js";

export { renameLocalTypes } from "../lower/local-types.js";
export { declaredTypeNames } from "../lower/walk.js";

function topLevelTypeDecls(programs) {
	const decls = [];
	for (const p of programs)
		for (const d of p.decls ?? []) if (d.kind === "TypeDecl") decls.push(d);
	return decls;
}

function methodReceiverTypes(programs) {
	const names = new Set();
	for (const p of programs)
		for (const d of p.decls ?? [])
			if (d.kind === "MethodDecl") names.add(d.recvType?.name);
	return names;
}

// Whether a `js`/`both` package emits no JS class for the type: it is not a
// struct and has no methods.  The checker rejects a class named after a JS
// built-in, so only this case gets past it.  A name another package declares
// may be a struct, which is left to the checker.
function isClassFree(decl, decls, methodTypes) {
	if (decl.typeParams?.length > 0 || methodTypes.has(decl.name)) return false;
	let t = decl.type;
	for (let i = 0; i < 16 && t; i++) {
		if (t.kind === "StructType") return false;
		if (t.kind !== "TypeName") return true;
		const next = decls.find((d) => d.name === t.name && !d.isAlias);
		if (!next) return !t.name.includes(".");
		t = next.type;
	}
	return false;
}

// A package-level type whose bare name would shadow a JS built-in the
// generated code relies on: any type of a `wasm` package (its facade emits a
// class for it) and a method-less named non-struct type of a `js` or `both`
// package.  `shadows` is `{ target, builtins }`.
function jsBuiltinClash(decl, decls, methodTypes, shadows) {
	if (!shadows || decl.isAlias || !shadows.builtins.has(decl.name))
		return false;
	return shadows.target === "wasm" || isClassFree(decl, decls, methodTypes);
}

// Registers the package's type names in `owners` (name -> package key, shared
// with the package's value names, see pkg-names.js) and renames those another
// package registered first, to `Name` + `suffix` (`Name$$b`, see `pkgSuffix`).
// Returns Map<name, mangled> for the renamed types, empty when nothing
// collides.  A type named after a
// predeclared type (`type int32 = string`, `type any = int`) is renamed too:
// `predeclared` holds those names, and the checker and both backends key types
// by bare name, so the package's `int32` must not meet the predeclared one
// that other packages (the Go-source stdlib) spell.  It takes the local-type
// `Name__L<n>` form rather than `Name$$pkg`, which later stages read as a type
// of another package.  A type named after a JS built-in (see `jsBuiltinClash`)
// takes the suffix too, so the class it emits cannot shadow the built-in; it
// does not claim the bare name, which no output uses.
export function mangleCollidingTypes(
	programs,
	pkgKey,
	suffix,
	owners,
	predeclared = new Set(),
	shadows = null,
) {
	const renamed = new Map();
	const decls = topLevelTypeDecls(programs);
	const methodTypes = methodReceiverTypes(programs);
	let taken = null;
	for (const decl of decls) {
		const { name } = decl;
		if (predeclared.has(name)) {
			taken ??= new Set([
				...owners.keys(),
				...decls.map((d) => d.name),
				...valueNamesIn(programs),
			]);
			renamed.set(name, freshLocalName(name, taken));
			continue;
		}
		const clash = jsBuiltinClash(decl, decls, methodTypes, shadows);
		const owner = owners.get(name);
		if (owner === undefined && !clash) owners.set(name, pkgKey);
		else if (clash || owner !== pkgKey) renamed.set(name, `${name}${suffix}`);
	}
	if (renamed.size > 0)
		for (const p of programs)
			for (const d of p.decls ?? [])
				renameTypeRefs(d, renamed, new Set(), new Set());
	return renamed;
}

// A package compiled later that declares a type this package only declares
// inside a function is renamed by `mangleCollidingTypes`, so `Pt` of one package
// and a local `Pt` of another never meet in the flat module.
export function registerLocalTypeOwners(programs, pkgKey, owners) {
	if (!owners) return;
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(visit);
		if (node.kind === "TypeDecl" && !owners.has(node.name))
			owners.set(node.name, pkgKey);
		forEachChild(node, visit);
		forEachTemplGo(node, visit);
	};
	for (const p of programs) visit(p.decls);
}

// Importers name a renamed type by its declared name (`b.Pt`): `table` is one
// of the package's export tables (types, symbols or kinds), keyed by the
// mangled name, and gains an entry under the declared one.
export function withOriginalNames(table, renamed) {
	for (const [name, mangled] of renamed)
		if (table.has(mangled)) table.set(name, table.get(mangled));
	return table;
}

// A file that dot-imports a package spells a type the package renamed by its
// declared name (`Box`), but the build knows the type by the renamed one
// (`Box$$b`), and both backends look a type up by the name the source gives.
// Renames those spellings in `program` once, so every later stage sees the
// type's real name.  `renamed` is the package's declared -> renamed map; a
// name the file declares at package level is left.  A type declared in a
// function shadows the import only in its block, so it first takes a name of
// its own (`Box__L1`) that no type of the build (`owners`) spells, and joins
// `owners` under `pkgKey`, the importing package.  The new name is emitted at
// the top level, so it also avoids every name the package's files
// (`pkgPrograms`, `program` among them) spell, such as a package-level var,
// const or func of another file.
export function renameDotImportedTypes(
	program,
	renamed,
	owners,
	pkgKey,
	pkgPrograms = [program],
) {
	const own = new Set(topLevelTypeDecls([program]).map((d) => d.name));
	const refs = new Map(
		[...renamed].filter(([name]) => isExported(name) && !own.has(name)),
	);
	if (refs.size === 0) return;
	const inUse = new Set([
		...(owners?.keys() ?? []),
		...declaredTypeNames(pkgPrograms),
		...valueNamesIn(pkgPrograms),
	]);
	if (renameLocalTypes([program], new Set(refs.keys()), new Set(), inUse))
		registerLocalTypeOwners([program], pkgKey, owners);
	for (const d of program.decls ?? [])
		renameTypeRefs(d, refs, new Set(), new Set());
}
