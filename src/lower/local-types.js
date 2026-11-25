// Function-local type renaming.
//
// Function-local types are scoped to their block, but the checker and both
// backends key types by bare name, so same-named local types are renamed
// apart before type-checking (and again per instantiation after generics are
// monomorphised).  Lives in `lower` so the `wasm` backend and the linker share it.

import { forEachChild, forEachTemplGo } from "./walk.js";

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
// `inUse` holds names a fresh name must avoid besides those (the types other
// packages declared, local ones included).  Returns whether anything was
// renamed.
export function renameLocalTypes(
	programs,
	reserved = new Set(),
	keep = new Set(),
	inUse = new Set(),
) {
	const counts = new Map();
	const count = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(count);
		if (node.kind === "TypeDecl")
			counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
		forEachChild(node, count);
		forEachTemplGo(node, count);
	};
	for (const p of programs) count(p.decls);
	const values = valueNamesIn(programs);
	const dup = new Set(
		[...counts]
			.filter(([k, n]) => (n > 1 && !keep.has(k)) || reserved.has(k))
			.map(([k]) => k),
	);
	const taken = new Set([...counts.keys(), ...reserved, ...values, ...inUse]);
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
		// A type parameter is in scope in the whole function, so a nested local
		// type of the same name shadows it and is renamed apart.
		const here = FUNC_KINDS.has(node.kind)
			? withNames(visible, typeParamNames(node))
			: visible;
		walkScoped(node, here, scan);
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
		forEachTemplGo(node, visit);
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
// With `valueMode` (`{ typeDecls }`, the package's type declarations by name)
// `renamed` holds package-level values instead: every bare `Ident` that is not
// shadowed is renamed, and a composite literal's key is renamed unless it
// names a struct field.
export function renameTypeRefs(
	node,
	renamed,
	tparams,
	values,
	valueMode = null,
) {
	if (!node || typeof node !== "object") return;
	const walk = (child, vals, tp = tparams) =>
		renameTypeRefs(child, renamed, tp, vals, valueMode);
	if (Array.isArray(node)) {
		// A statement list: each declaration shadows the statements after it.
		let vals = values;
		for (const n of node) {
			walk(n, vals);
			if (n && typeof n === "object")
				vals = withNames(vals, declaredHere(n, valueMode));
		}
		return;
	}
	const tp = withTypeParams(node, tparams);
	const scoped = SCOPED_WALKS[node.kind];
	if (scoped) return scoped(node, values, (c, v) => walk(c, v, tp));
	if (valueMode && node.kind === "CompositeLit")
		return renameLiteral(node, null, (c) => walk(c, values, tp), valueMode);
	if (
		isRef(node, values, valueMode) &&
		renamed.has(node.name) &&
		!tp.has(node.name)
	) {
		// Diagnostics quote an expression as the source spells it.
		node._written ??= node.name;
		node.name = renamed.get(node.name);
	}
	forEachChild(node, (child) => {
		if (!isFieldKey(node, child)) walk(child, values, tp);
	});
	forEachTemplGo(node, (child) => walk(child, values, tp));
}

// The names a statement declares in its scope: values, and in `valueMode` a
// local type too, which shadows a package-level value of its name.
function declaredHere(stmt, valueMode) {
	return valueMode && stmt.kind === "TypeDecl" ? [stmt.name] : valueNames(stmt);
}

// Whether `node` names what `renameTypeRefs` renames: a type, or in
// `valueMode` a bare `Ident` no local shadows.
function isRef(node, values, valueMode) {
	if (valueMode) return node.kind === "Ident" && !values.has(node.name);
	return isTypeRef(node, values);
}

// A bare `Ident` key of a struct literal names a field, not a type; any other
// key (`Q{1}`, `Q(1)`, `[]Q{}`) is an expression that can use one.
function isFieldKey(node, child) {
	return (
		node.kind === "KeyValueExpr" && child === node.key && child.kind === "Ident"
	);
}

// A composite literal of `valueMode` renaming: `type` is the type an elided
// literal (`{1, 2}` in `[]P{{1, 2}}`) inherits, `walk(node)` renames a node in
// the literal's scope.  A key `Ident` is a struct field unless the literal's
// type is a map, slice or array, whose keys are expressions.  When the renamer
// cannot tell (a type of another package, a dot-imported or a function-local
// one) the key is renamed and keeps its written spelling in `_fieldName`, which
// the checker puts back once it finds the literal is a struct's.
function renameLiteral(lit, type, walk, valueMode) {
	const own = lit.typeExpr ?? type;
	if (lit.typeExpr) walk(lit.typeExpr);
	const fields = literalIsStruct(own, valueMode.typeDecls);
	const sub = (node, inherited) =>
		node?.kind === "CompositeLit" && !node.typeExpr
			? renameLiteral(node, inherited, walk, valueMode)
			: walk(node);
	const elem = literalPart(own, valueMode.typeDecls, "elem");
	for (const e of lit.elems ?? []) {
		if (e?.kind !== "KeyValueExpr") sub(e, elem);
		else {
			const key = e.key;
			if (key?.kind !== "Ident" || fields === false)
				sub(key, literalPart(own, valueMode.typeDecls, "key"));
			else if (fields === null) {
				const name = key.name;
				walk(key);
				if (key.name !== name) key._fieldName ??= name;
			}
			sub(e.value, elem);
		}
	}
}

const LITERAL_TYPE_KINDS = new Set([
	"StructType",
	"MapType",
	"SliceType",
	"ArrayType",
]);

// The name a type expression spells (`P`, `P[int]`), or null for one that is
// not a bare name (`types.P`, `[]P`).
function literalTypeName(type) {
	if (type.kind === "Ident") return type.name;
	if (type.kind === "TypeName" || type.kind === "GenericTypeName")
		return type.name.includes(".") ? null : type.name;
	if (type.kind === "InstantiationExpr" || type.kind === "IndexExpr")
		return type.expr?.kind === "Ident" ? type.expr.name : null;
	return null;
}

// The struct, map, slice or array type node a type expression stands for
// after following the package's own top-level named types, or null for any
// other type (one the package does not declare at top level among them).
function literalUnderlying(type, typeDecls) {
	for (let hops = 0; hops < 16 && type; hops++) {
		if (LITERAL_TYPE_KINDS.has(type.kind)) return type;
		const name = literalTypeName(type);
		const decl = name === null ? null : typeDecls.get(name);
		if (!decl) return null;
		type = decl.type;
	}
	return null;
}

// Whether a literal of `type` has fields for keys: true for a struct, false
// for a map, slice or array, null when the renamer cannot tell (a type of
// another package, a dot-imported or function-local one, a type parameter).
function literalIsStruct(type, typeDecls) {
	const under = literalUnderlying(type, typeDecls);
	if (["MapType", "SliceType", "ArrayType"].includes(under?.kind)) return false;
	return under?.kind === "StructType" ? true : null;
}

// The key or element type node of a map, slice or array literal type.
function literalPart(type, typeDecls, part) {
	let under = literalUnderlying(type, typeDecls);
	if (part === "elem" && under?.kind === "MapType") return under.value;
	if (part === "key" && under?.kind === "MapType") return under.key;
	if (under?.kind === "SliceType" || under?.kind === "ArrayType") {
		under = under.elem;
		// `[]*P{{1}}` elides `&P`.
		return under?.kind === "PointerType" ? under.base : under;
	}
	return null;
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
	// A templ component's parameters are in scope in its body, and a templ
	// `for` header's names in the loop body.
	TemplDecl: walkFunc,
	TemplFor: (node, values, walk) => {
		walk(node.forStmt, values);
		const init = node.forStmt?.init;
		walk(node.body, withNames(values, init ? valueNames(init) : []));
	},
	// The new names are not in scope in their own initializers.
	DefineStmt: (node, values, walk) => walk(node.rhs, values),
	VarDecl: walkSpecs,
	ConstDecl: walkSpecs,
	// The init's names are in scope in the expression and clauses; the bound
	// name is in scope in each clause's body, not its type list.
	TypeSwitchStmt: (node, values, walk) => {
		walk(node.init, values);
		const header = withNames(values, node.init ? valueNames(node.init) : []);
		const inner = withNames(header, node.assign ? [node.assign] : []);
		walk(node.expr, header);
		for (const c of node.cases ?? []) {
			walk(c.types, header);
			walk(c.stmts, inner);
		}
	},
};

// Walks `node`'s children with the values in scope in each (parameters, named
// results, `if`/`for`/`switch` headers, a type switch's bound name), the same
// scoping `renameTypeRefs` uses.  The Go a `.templ` node holds is walked too.
function walkScoped(node, values, walk) {
	const scoped = SCOPED_WALKS[node.kind];
	if (scoped) return scoped(node, values, walk);
	forEachChild(node, (child) => walk(child, values));
	forEachTemplGo(node, (child) => walk(child, values));
}

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
