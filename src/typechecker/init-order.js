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

// The `Type.method` key of the declaration `name` selects on a value of type
// `t`, found the way the checker finds it: on the type itself, else on an
// embedded type (through pointers too).  Interface methods have no body to
// follow, so a call through an interface adds no dependency (Go does the same).
function methodKeyOf(t, name, funcs, depth = 0) {
	let x = t;
	if (x?.kind === "pointer") x = x.base;
	if (x?.kind !== "named" || depth > 8) return null;
	for (const typeName of [x.name, x._generic?.name]) {
		const key = `${typeName}.${name}`;
		if (typeName && funcs.has(key)) return key;
	}
	for (const e of x.underlying?._embeds ?? []) {
		const key = methodKeyOf(e, name, funcs, depth + 1);
		if (key) return key;
	}
	return null;
}

// Whether the keys of a composite literal are expressions (map, slice and
// array literals) rather than field names (struct literals).  Before the
// literal is checked its written type decides; an unnamed one stays ambiguous
// and its keys are skipped.
function litHasExprKeys(lit) {
	let t = lit._type;
	for (let i = 0; t && i < 8; i++) {
		if (t.kind === "named") t = t.underlying;
		else if (t.kind === "pointer") t = t.base;
		else break;
	}
	if (t?.kind) return ["map", "slice", "array"].includes(t.kind);
	return ["MapType", "SliceType", "ArrayType"].includes(lit.typeExpr?.kind);
}

function walkRefs(node, shadow, ctx, out) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) walkRefs(n, shadow, ctx, out);
		return;
	}
	if (node.kind === "Ident") {
		if (ctx.pkgNames.has(node.name) && !shadow.has(node.name))
			out.names.add(node.name);
		return;
	}
	if (node.kind === "SelectorExpr") {
		const key = methodKeyOf(node.expr?._type, node.field, ctx.funcs);
		if (key) out.methods.add(key);
	}
	if (node.kind === "CompositeLit") {
		const exprKeys = litHasExprKeys(node);
		for (const el of node.elems ?? []) {
			if (el?.kind !== "KeyValueExpr") walkRefs(el, shadow, ctx, out);
			else {
				// A struct literal's key is a field name, not a reference.
				if (exprKeys || el.key?.kind !== "Ident")
					walkRefs(el.key, shadow, ctx, out);
				walkRefs(el.value, shadow, ctx, out);
			}
		}
		walkRefs(node.typeExpr, shadow, ctx, out);
		return;
	}
	forEachChildNode(node, (c) => walkRefs(c, shadow, ctx, out));
}

/**
 * Collects what `root` (an initialiser expression or a function declaration)
 * refers to: package-level names (`names`) and declarations selected as methods
 * (`methods`, keyed `Type.method`).  The single place shadowing is decided:
 * a name declared anywhere inside `root` never counts as the package-level one.
 */
function collectRefs(root, ctx, out) {
	walkRefs(root, declaredNames(root), ctx, out);
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
	const ctx = { pkgNames, funcs };
	const funcRefs = new Map();
	const refsOfFunc = (key) => {
		if (funcRefs.has(key)) return funcRefs.get(key);
		const decl = funcs.get(key);
		const out = emptyRefs();
		funcRefs.set(key, out);
		if (decl) collectRefs(decl, ctx, out);
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
		for (const v of entry.spec.value ?? []) collectRefs(v, ctx, refs);
		visit(refs, []);
		return deps;
	};
	return new Map(varEntries.map((e) => [e, depsOf(e)]));
}

// A chain of names leading from `start` back to itself through the specs in
// `pending`, e.g. ["a", "f", "b", "a"]; null when `start` is on no cycle.
function findCycle(start, depsOf, pending) {
	const visited = new Set();
	const walk = (entry, chain) => {
		for (const [dep, path] of depsOf.get(entry)) {
			const next = [...chain, ...path];
			if (dep === start) return next;
			if (!pending.has(dep) || visited.has(dep)) continue;
			visited.add(dep);
			const found = walk(dep, next);
			if (found) return found;
		}
		return null;
	};
	const chain = walk(start, [start.names[0]]);
	return chain && chain.length === 2 ? [chain[0]] : chain;
}

function cycleMessage(entry, chain) {
	const name = entry.names[0];
	if (!chain) return `initialization cycle for ${name}`;
	if (chain.length === 1)
		return `initialization cycle: ${name} refers to itself`;
	return `initialization cycle for ${name}: ${chain.join(" refers to ")}`;
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
			// Everything left is on or behind a cycle: report the first spec
			// that is on one.
			const pending = new Set(remaining);
			let culprit = remaining[0];
			let chain = null;
			for (const e of remaining) {
				chain = findCycle(e, depsOf, pending);
				if (chain) {
					culprit = e;
					break;
				}
			}
			vars.push(...remaining);
			return {
				vars,
				cycles: [{ spec: culprit.spec, message: cycleMessage(culprit, chain) }],
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
	const ctx = { pkgNames: constNames, funcs: new Map() };
	const owner = new Map();
	for (const e of constEntries) for (const n of e.names) owner.set(n, e);
	const consts = [];
	const state = new Set();
	const visit = (e) => {
		if (state.has(e)) return;
		state.add(e);
		const refs = emptyRefs();
		for (const v of e.spec.value ?? []) collectRefs(v, ctx, refs);
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
	const ctx = { pkgNames: new Set(owner.keys()), funcs: new Map() };
	const out = [];
	const state = new Set();
	const visit = (e) => {
		if (state.has(e)) return;
		state.add(e);
		if (!e.spec.type) {
			const refs = emptyRefs();
			for (const v of e.spec.value ?? []) collectRefs(v, ctx, refs);
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
