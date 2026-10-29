// Package initialisation order (Go spec, "Package initialization").
//
// A package-level variable is initialised once every variable its initialiser
// refers to has been, where "refers to" follows references to functions and
// methods transitively.  Each step picks the earliest variable in declaration
// order that is ready; a step with none left over is an initialisation cycle.
// Constants are folded by value, so they only need ordering among themselves
// (a constant may name one declared later).
//
// The checker reports cycles; both backends emit initialisers in this order.
// Shadowing is handled conservatively: a name declared anywhere in a function
// body (or as a parameter) is never counted as a reference to the package-level
// name inside that function, so the analysis can miss a dependency but never
// invents a cycle.

function forEachChildNode(node, fn) {
	for (const key of Object.keys(node)) {
		if (key.charCodeAt(0) === 95) continue; // "_" side tables
		const v = node[key];
		if (v && typeof v === "object") fn(v);
	}
}

// Names declared inside a function-like node (parameters, results, locals).
function declaredNames(node, out = new Set()) {
	if (!node || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const n of node) declaredNames(n, out);
		return out;
	}
	if (node.kind === "DefineStmt") {
		for (const l of [node.lhs].flat()) if (l?.kind === "Ident") out.add(l.name);
	} else if (node.kind === "VarDecl" || node.kind === "ConstDecl") {
		for (const spec of node.decls ?? []) for (const n of spec.names) out.add(n);
	} else if (node.kind === "RangeStmt" || node.kind === "ForRangeStmt") {
		for (const k of [node.key, node.value, node.keyVar, node.valueVar])
			if (k?.kind === "Ident") out.add(k.name);
		if (typeof node.key === "string") out.add(node.key);
		if (typeof node.value === "string") out.add(node.value);
	} else if (node.kind === "TypeSwitchStmt" && node.assign) {
		out.add(node.assign);
	}
	if (Array.isArray(node.params))
		for (const p of node.params) if (p?.name) out.add(p.name);
	if (node.recvName) out.add(node.recvName);
	for (const r of node.returnType?._namedReturns ?? [])
		if (r.name) out.add(r.name);
	forEachChildNode(node, (c) => declaredNames(c, out));
	return out;
}

function recvTypeNameOf(t) {
	let x = t;
	if (x?.kind === "pointer") x = x.base;
	return x?.kind === "named" ? x.name : null;
}

/**
 * Collects what `node` refers to: package-level names (`names`) and methods
 * (`Type.method` keys in `methods`).
 */
function collectRefs(node, shadow, pkgNames, out) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) collectRefs(n, shadow, pkgNames, out);
		return;
	}
	if (node.kind === "Ident") {
		if (pkgNames.has(node.name) && !shadow.has(node.name))
			out.names.add(node.name);
		return;
	}
	if (node.kind === "SelectorExpr") {
		const recv = recvTypeNameOf(node.expr?._type);
		if (recv) out.methods.add(`${recv}.${node.field}`);
	}
	if (node.kind === "KeyValueExpr" && node.key?.kind === "Ident") {
		// A struct literal field name is not a reference.
		collectRefs(node.value, shadow, pkgNames, out);
		if (node._isMapKey) collectRefs(node.key, shadow, pkgNames, out);
		return;
	}
	forEachChildNode(node, (c) => collectRefs(c, shadow, pkgNames, out));
}

const emptyRefs = () => ({ names: new Set(), methods: new Set() });

// Package-level specs and callable declarations of all files.
function collectDecls(programs) {
	const varEntries = [];
	const constEntries = [];
	const funcs = new Map(); // name | "Type.method" -> declaration
	for (const program of programs) {
		for (const d of program.decls ?? []) {
			if (d.kind === "VarDecl" || d.kind === "ConstDecl") {
				const into = d.kind === "VarDecl" ? varEntries : constEntries;
				for (const spec of d.decls ?? [])
					into.push({ decl: d, spec, names: spec.names ?? [], program });
			} else if (d.kind === "FuncDecl") {
				funcs.set(d.name, d);
			} else if (d.kind === "MethodDecl") {
				const t = d.recvType?.name ?? d.recvType?.base?.name;
				if (t) funcs.set(`${t}.${d.name}`, d);
			}
		}
	}
	return { varEntries, constEntries, funcs };
}

// For each var spec, the other var specs its initialiser depends on (through
// functions and methods too), with the name chain leading to each.
function buildVarDeps({ varEntries, constEntries, funcs }) {
	const varOwner = new Map(); // var name -> entry
	for (const e of varEntries) for (const n of e.names) varOwner.set(n, e);
	const pkgNames = new Set([
		...varOwner.keys(),
		...funcs.keys(),
		...constEntries.flatMap((e) => e.names),
	]);
	const funcRefs = new Map();
	const refsOfFunc = (key) => {
		if (funcRefs.has(key)) return funcRefs.get(key);
		const decl = funcs.get(key);
		const out = emptyRefs();
		funcRefs.set(key, out);
		if (decl) collectRefs(decl.body, declaredNames(decl), pkgNames, out);
		return out;
	};
	const depsOf = (entry) => {
		const deps = new Map(); // owner entry -> path of names
		const seen = new Set();
		const follow = (key, path) => {
			if (!funcs.has(key) || seen.has(key)) return;
			seen.add(key);
			visit(refsOfFunc(key), [...path, key]);
		};
		const visit = (refs, path) => {
			for (const name of refs.names) {
				const owner = varOwner.get(name);
				if (owner) {
					if (!deps.has(owner)) deps.set(owner, [...path, name]);
				} else follow(name, path);
			}
			for (const m of refs.methods) follow(m, path);
		};
		const refs = emptyRefs();
		for (const v of entry.spec.value ?? [])
			collectRefs(v, new Set(), pkgNames, refs);
		visit(refs, []);
		return deps;
	};
	return new Map(varEntries.map((e) => [e, depsOf(e)]));
}

function cycleMessage(entry, deps) {
	const name = entry.names[0];
	const selfPath = deps.get(entry);
	if (!selfPath) return `initialization cycle for ${name}`;
	if (selfPath.length === 1)
		return `initialization cycle: ${name} refers to itself`;
	return `initialization cycle for ${name}: ${[name, ...selfPath].join(" refers to ")}`;
}

// Go's rule: repeatedly take the earliest spec whose dependencies are done.
function orderVars(varEntries, depsOf) {
	const done = new Set();
	const vars = [];
	const ready = (e) => {
		for (const dep of depsOf.get(e).keys()) {
			if (dep === e && e.names.length > 1) continue;
			if (!done.has(dep)) return false;
		}
		return true;
	};
	const remaining = varEntries.slice();
	while (remaining.length > 0) {
		const idx = remaining.findIndex(ready);
		if (idx === -1) {
			// Everything left is on or behind a cycle: report the first
			// self-referencing spec, else the first one.
			const culprit =
				remaining.find((e) => depsOf.get(e).has(e)) ?? remaining[0];
			vars.push(...remaining);
			return {
				vars,
				cycles: [
					{
						spec: culprit.spec,
						message: cycleMessage(culprit, depsOf.get(culprit)),
					},
				],
			};
		}
		const [e] = remaining.splice(idx, 1);
		done.add(e);
		vars.push(e);
	}
	return { vars, cycles: [] };
}

// Constants depend on other constants only.
function orderConsts(constEntries) {
	const constNames = new Set(constEntries.flatMap((e) => e.names));
	const owner = new Map();
	for (const e of constEntries) for (const n of e.names) owner.set(n, e);
	const consts = [];
	const state = new Set();
	const visit = (e) => {
		if (state.has(e)) return;
		state.add(e);
		const refs = emptyRefs();
		for (const v of e.spec.value ?? [])
			collectRefs(v, new Set(), constNames, refs);
		for (const n of refs.names) if (owner.has(n)) visit(owner.get(n));
		consts.push(e);
	};
	for (const e of constEntries) visit(e);
	return consts;
}

/**
 * @param {object[]} programs parsed (and, for method resolution, checked) files
 * @returns {{ consts: object[], vars: object[], cycles: object[] }}
 *   `consts` / `vars`: entries `{ decl, spec, names, program }` in initialisation
 *   order; `cycles`: `{ spec, message }` for each initialisation cycle.
 */
export function orderPackageInits(programs) {
	const decls = collectDecls(programs);
	const depsOf = buildVarDeps(decls);
	const { vars, cycles } = orderVars(decls.varEntries, depsOf);
	return { consts: orderConsts(decls.constEntries), vars, cycles };
}

/**
 * Package-level `var` specs in the order their initialisers must be *typed*:
 * a spec that names another package variable (directly, even inside a func
 * literal) comes after it, since `var a = b + 1; var b = f()` infers `a` from
 * `b`.  Declaration order is kept otherwise.
 */
export function orderVarSpecsForTyping(programs) {
	const entries = [];
	for (const program of programs)
		for (const d of program.decls ?? [])
			if (d.kind === "VarDecl")
				for (const spec of d.decls ?? [])
					entries.push({ program, decl: d, spec });
	const owner = new Map();
	for (const e of entries) for (const n of e.spec.names) owner.set(n, e);
	const names = new Set(owner.keys());
	const out = [];
	const state = new Set();
	const visit = (e) => {
		if (state.has(e)) return;
		state.add(e);
		if (!e.spec.type) {
			const refs = emptyRefs();
			for (const v of e.spec.value ?? [])
				collectRefs(v, declaredNames(v), names, refs);
			for (const n of refs.names) {
				const o = owner.get(n);
				if (o && o !== e) visit(o);
			}
		}
		out.push(e);
	};
	for (const e of entries) visit(e);
	return out;
}
