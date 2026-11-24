// Function-local type renaming.
//
// Function-local types are scoped to their block, but the checker and both
// backends key types by bare name, so same-named local types are renamed
// apart before type-checking (and again per instantiation after generics are
// monomorphised).  Lives in `lower` so the `wasm` backend and the linker share it.

import { forEachChild } from "./walk.js";

// The first `Name__L<n>` (n counting up from 1) that is not in `taken`, which
// it joins. The number depends only on the names in play, never on how many
// packages this process compiled before, so a build is reproducible; `taken`
// holds the names of this package and of the other packages' types, so two
// packages never mint the same name in the flat module.
export function freshLocalName(name, taken) {
	for (let n = 1; ; n++) {
		const candidate = `${name}__L${n}`;
		if (taken.has(candidate)) continue;
		taken.add(candidate);
		return candidate;
	}
}

// Function-local types are scoped to their block, but the checker and both
// backends key types by bare name.  A local type whose name another type of the
// package also uses (a package-level type or a local of another function)
// is renamed to `Name__L<n>` for its scope; `%T` and diagnostics drop the
// suffix (see `displayTypeName`).  `reserved` holds type names other packages
// own: a local type spelled like one is renamed too, so it cannot clash with
// the imported type in the flat module.  It also holds the package-level
// var, const and func names: a local type spelled like one is renamed so it
// cannot take that value over inside its function.  Returns whether anything was renamed.
export function renameLocalTypes(programs, reserved = new Set()) {
	const counts = new Map();
	const count = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(count);
		if (node.kind === "TypeDecl")
			counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
		forEachChild(node, count);
	};
	for (const p of programs) count(p.decls);
	const dup = new Set(
		[...counts].filter(([k, n]) => n > 1 || reserved.has(k)).map(([k]) => k),
	);
	const taken = new Set([...counts.keys(), ...reserved]);
	let changed = false;
	// Inner scopes first, so an outer rename never touches a nested
	// declaration that already has its own name.  `visible` holds the value
	// names declared so far in the enclosing scopes.
	const scan = (node, visible) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			const seen = new Set(visible);
			// Renames wait until every nested block was scanned, so a nested
			// redeclaration of the name has its own name by then.
			const renames = [];
			for (let i = 0; i < node.length; i++) {
				const d = node[i];
				scan(d, seen);
				if (d?.kind === "TypeDecl") {
					// A value of the same name would clash with the type in JS.
					const stop = node.findIndex(
						(s, j) => j > i && declaresValue(s, d.name),
					);
					if (dup.has(d.name) || seen.has(d.name) || stop >= 0) {
						const renamed = new Map([[d.name, freshLocalName(d.name, taken)]]);
						const end = stop >= 0 ? stop : node.length - 1;
						renames.push(() => {
							for (let j = i; j <= end; j++) {
								// The shadowing declaration's own right-hand side and type
								// are evaluated before its new value is in scope.
								const target =
									j === stop && node[j].kind === "DefineStmt"
										? node[j].rhs
										: node[j];
								renameTypeRefs(target, renamed, new Set(), new Set());
							}
						});
						changed = true;
					}
				} else if (d) for (const n of valueNames(d)) seen.add(n);
			}
			for (const rename of renames) rename();
			return;
		}
		const here = FUNC_KINDS.has(node.kind)
			? new Set([...visible, ...declaredParams(node)])
			: visible;
		forEachChild(node, (c) => scan(c, here));
	};
	for (const p of programs)
		for (const d of p.decls ?? [])
			if (d.kind !== "TypeDecl") scan(d, new Set());
	return changed;
}

const VALUE_DECL_KINDS = new Set(["DefineStmt", "VarDecl", "ConstDecl"]);

// Names a statement declares as values in its own scope.
function valueNames(stmt) {
	return VALUE_DECL_KINDS.has(stmt.kind) ? declaredNames(stmt) : [];
}

function declaresValue(stmt, name) {
	return valueNames(stmt).includes(name);
}

function declaredParams(fn) {
	const names = (fn.params ?? []).map((p) => p.name).filter(Boolean);
	if (fn.recvName) names.push(fn.recvName);
	return names;
}

// `tparams` are type parameters in scope; `values` are names a function
// declares as parameters or locals, which shadow a same-spelled bare `Ident`.
export function renameTypeRefs(node, renamed, tparams, values) {
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
