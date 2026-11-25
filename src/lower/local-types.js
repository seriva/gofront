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
// cannot take that value over inside its function.  `keep` holds names whose
// several declarations are the same type (the clones of a generic body's local
// type that does not depend on a type parameter): they share one name.
// Returns whether anything was renamed.
export function renameLocalTypes(
	programs,
	reserved = new Set(),
	keep = new Set(),
) {
	const counts = new Map();
	const count = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(count);
		if (node.kind === "TypeDecl")
			counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
		forEachChild(node, count);
	};
	for (const p of programs) count(p.decls);
	const values = valueNamesIn(programs);
	const dup = new Set(
		[...counts]
			.filter(([k, n]) => (n > 1 && !keep.has(k)) || reserved.has(k))
			.map(([k]) => k),
	);
	const taken = new Set([...counts.keys(), ...reserved, ...values]);
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
		// A type parameter is in scope in the whole body, so a nested local
		// type of the same name shadows it and is renamed apart.
		const here = FUNC_KINDS.has(node.kind)
			? new Set([...visible, ...declaredNames(node), ...typeParamNames(node)])
			: visible;
		forEachChild(node, (c) => scan(c, here));
	};
	for (const p of programs)
		for (const d of p.decls ?? [])
			if (d.kind !== "TypeDecl") scan(d, new Set());
	return changed;
}

// Names of values (funcs, vars, consts, parameters, named results, locals)
// and of type parameters the programs declare or use: a fresh type name must
// not spell one, or it would take that value (or type parameter) over.
export function valueNamesIn(programs) {
	const names = new Set();
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(visit);
		if (
			(node.kind === "FuncDecl" ||
				node.kind === "Ident" ||
				node.kind === "TypeParam") &&
			node.name
		)
			names.add(node.name);
		for (const n of declaredNames(node)) names.add(n);
		forEachChild(node, visit);
	};
	for (const p of programs) visit(p.decls);
	return names;
}

const VALUE_DECL_KINDS = new Set(["DefineStmt", "VarDecl", "ConstDecl"]);

// Names a statement declares as values in its own scope.
function valueNames(stmt) {
	return VALUE_DECL_KINDS.has(stmt.kind) ? declaredNames(stmt) : [];
}

function declaresValue(stmt, name) {
	return valueNames(stmt).includes(name);
}

// `tparams` are type parameters in scope; `values` are the parameter and local
// names in scope, which shadow a same-spelled bare `Ident`.  A value is in
// scope the way Go scopes it: from just after its declaration to the end of
// its innermost block (a function body, a block, or the implicit block of an
// `if`, `for`, `switch` or case clause), so a use before a later shadowing
// declaration still names the type.
export function renameTypeRefs(node, renamed, tparams, values) {
	if (!node || typeof node !== "object") return;
	const walk = (child, vals, tp = tparams) =>
		renameTypeRefs(child, renamed, tp, vals);
	if (Array.isArray(node)) {
		// A statement list: each declaration shadows the statements after it.
		let vals = values;
		for (const n of node) {
			walk(n, vals);
			if (n && typeof n === "object") vals = withNames(vals, valueNames(n));
		}
		return;
	}
	const tp = withTypeParams(node, tparams);
	const scoped = SCOPED_WALKS[node.kind];
	if (scoped) return scoped(node, values, (c, v) => walk(c, v, tp));
	if (isTypeRef(node, values) && renamed.has(node.name) && !tp.has(node.name))
		node.name = renamed.get(node.name);
	forEachChild(node, (child) => {
		// A bare `Ident` key of a struct literal names a field, not a type; any
		// other key (`Q{1}`, `Q(1)`, `[]Q{}`) is an expression that can use one.
		if (
			node.kind === "KeyValueExpr" &&
			child === node.key &&
			child.kind === "Ident"
		)
			return;
		walk(child, values, tp);
	});
}

const FUNC_KINDS = new Set(["FuncDecl", "MethodDecl", "FuncLit"]);

function withNames(values, names) {
	return names.length === 0 ? values : new Set([...values, ...names]);
}

// Walks a function: its signature sees the enclosing scope, its body the
// parameters, receiver and named results too.
function walkFunc(node, values, walk) {
	const inner = withNames(values, declaredNames(node));
	forEachChild(node, (child) =>
		walk(child, child === node.body ? inner : values),
	);
}

// Walks a node whose `header` statement (an `if`/`for`/`switch` init) declares
// names for the rest of the node.
function walkWithHeader(header) {
	return (node, values, walk) => {
		walk(node[header], values);
		const inner = withNames(
			values,
			node[header] ? valueNames(node[header]) : [],
		);
		forEachChild(node, (child) => {
			if (child !== node[header]) walk(child, inner);
		});
	};
}

// Nodes that open a scope or declare names, walked so each name shadows only
// what follows it in its scope.
const SCOPED_WALKS = {
	FuncDecl: walkFunc,
	MethodDecl: walkFunc,
	FuncLit: walkFunc,
	IfStmt: walkWithHeader("init"),
	ForStmt: walkWithHeader("init"),
	SwitchStmt: walkWithHeader("init"),
	// The new names are not in scope in their own initializers.
	DefineStmt: (node, values, walk) => walk(node.rhs, values),
	VarDecl: walkSpecs,
	ConstDecl: walkSpecs,
	// The bound name is in scope in each clause's body, not its type list.
	TypeSwitchStmt: (node, values, walk) => {
		const inner = withNames(values, node.assign ? [node.assign] : []);
		walk(node.expr, values);
		for (const c of node.cases ?? []) {
			walk(c.types, values);
			walk(c.stmts, inner);
		}
	},
};

// `var (a = 1; b = a)`: each spec's names are in scope from the next spec.
function walkSpecs(node, values, walk) {
	let vals = values;
	for (const d of node.decls ?? []) {
		walk(d, vals);
		vals = withNames(vals, d.names ?? []);
	}
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
	// Named results live on the return type's side table, which child
	// traversal skips.
	for (const r of node.returnType?._namedReturns ?? [])
		if (r.name) names.push(r.name);
	return names;
}

// The type parameters a declaration introduces: a function's own, or for a
// method those its receiver names (`func (b Box[T]) M()` declares `T`).
function typeParamNames(node) {
	const names = (node.typeParams ?? []).map((t) => t.name);
	if (node.kind === "MethodDecl")
		for (const a of node.recvType?.typeArgs ?? [])
			if (a.kind === "TypeName") names.push(a.name);
	return names;
}

function withTypeParams(node, tparams) {
	const names = typeParamNames(node);
	if (names.length === 0) return tparams;
	return new Set([...tparams, ...names]);
}

export const TYPE_REF_KINDS = new Set([
	"TypeDecl",
	"TypeName",
	"GenericTypeName",
	"Ident",
]);

function isTypeRef(node, values) {
	if (node.kind === "Ident") return !values.has(node.name);
	return TYPE_REF_KINDS.has(node.kind);
}
