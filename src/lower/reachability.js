// src/lower/reachability.js
// Reachability for Go-source stdlib packages: only declarations reachable
// from user code are emitted, so an imported but unused package costs zero
// bytes (JS output and dev-mode WASM, where Binaryen does not run).
//
// Stdlib top-level names are mangled (`Compare$$cmp`) and user references to
// them are plain identifiers after type-checking, so reachability is a
// closure over names.  A method is reachable when its receiver type is and
// its name is selected somewhere reachable, or is called implicitly.

import { isExported } from "../typechecker/types.js";
import { leavesGo, reachableTypeNames } from "./escapes.js";
import { forEachChild } from "./walk.js";

// Methods the runtime or emitter-backed stdlib call without a selector in
// GoFront code (fmt verbs and Fprint* writers, errors.Is/As/Unwrap,
// encoding/json).
const IMPLICIT_METHODS = new Set([
	"Error",
	"String",
	"Write",
	"GoString",
	"Format",
	"Unwrap",
	"Is",
	"As",
	"MarshalJSON",
	"UnmarshalJSON",
	"MarshalText",
	"UnmarshalText",
]);

function declNames(d) {
	if (d.kind === "FuncDecl" || d.kind === "TypeDecl") return [d.name];
	if (d.kind === "VarDecl" || d.kind === "ConstDecl")
		return (d.decls ?? []).flatMap((spec) => spec.names ?? []);
	return [];
}

// The Go expressions a `.templ` node holds sit on non-enumerable properties
// (see parser/templ.js), which `forEachChild` does not visit.
function forEachTemplExpr(node, fn) {
	if (node.kind === "TemplElement")
		for (const attr of node.attrs ?? []) fn(attr.expr);
	if (typeof node.kind !== "string" || !node.kind.startsWith("Templ")) return;
	fn(node.expr);
	fn(node.exprs);
	fn(node.forStmt);
}

// Notes the name, field or qualifier `node` itself stands for.
function noteRef(node, acc) {
	const { names, fields, quals } = acc;
	if (node._stdName) names.add(node._stdName); // `cmp.Compare` in user code
	// A call that the generated Go (`gofront_gen.go`) answers.
	if (node._genEntry) names.add(node._genEntry);
	switch (node.kind) {
		case "Ident":
			names.add(node.name);
			break;
		case "TypeName":
		case "GenericTypeName":
			names.add(node.name);
			if (node.name.includes(".")) quals.add(node.name);
			break;
		case "SelectorExpr":
			fields.add(node.field);
			if (node.expr?.kind === "Ident")
				quals.add(`${node.expr.name}.${node.field}`);
			break;
		// A reached interface needs its methods on the types that satisfy it.
		case "InterfaceType":
			for (const m of node.methods ?? []) fields.add(m.name);
			break;
		default:
			noteHandOver(node, acc.sites);
	}
}

// Notes where a Go value is handed over: as an argument of a call or as the
// right-hand side of an assignment, with the callee or target it goes to.  A
// build decides afterwards whether that leaves Go (see `BuildReach`).
function noteHandOver(node, sites) {
	if (node.kind === "CallExpr" && !node._isTypeConversion && node.args?.length)
		sites.push({ to: node.func, types: node.args.map((a) => a._type) });
	else if (node.kind === "AssignStmt" && node.lhs?.length === node.rhs?.length)
		for (let i = 0; i < node.lhs.length; i++)
			sites.push({
				to: null,
				dynamic: node.lhs[i],
				types: [node.rhs[i]._type],
			});
}

// Names (identifiers and type names), selected fields, `pkg.Name` qualifiers
// and hand-over sites used under `node`.  A user build resolves a qualifier
// against the local package the file imports under that name.
function collectRefs(node, acc) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) collectRefs(n, acc);
		return;
	}
	noteRef(node, acc);
	const visit = (child) => collectRefs(child, acc);
	forEachChild(node, visit);
	forEachTemplExpr(node, visit);
}

// What `node` uses, remembered per node: a stored unit's programs and a
// stdlib declaration never change, so a later build reads their references
// from here instead of walking them again.  A node is only passed in once
// its tree is final (checked, and never rewritten afterwards).
const refsMemo = new WeakMap();

function refsOf(node) {
	let refs = refsMemo.get(node);
	if (!refs) {
		refs = { names: new Set(), fields: new Set(), quals: new Set(), sites: [] };
		collectRefs(node, refs);
		refsMemo.set(node, refs);
	}
	return refs;
}

// Adds the references under `node` (nested arrays of nodes) to `names` and
// `fields`.
function collectTopRefs(node, names, fields) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) collectTopRefs(n, names, fields);
		return;
	}
	const refs = refsOf(node);
	for (const n of refs.names) names.add(n);
	for (const f of refs.fields) fields.add(f);
}

// The declaration with its body checked and mangled: a lazily checked
// declaration keeps its parsed form and hands out a checked copy.
export function checkedDecl(d) {
	return d._checked?.() ?? d;
}

function indexStdlib(stdlibPrograms) {
	const byName = new Map(); // name -> decls
	const methods = []; // { decl, recv }
	const inits = new Map(); // program -> init decls
	for (const p of stdlibPrograms) {
		for (const d of p.decls ?? []) {
			if (d.kind === "MethodDecl")
				methods.push({ decl: d, recv: d.recvType?.name });
			else if (d.kind === "FuncDecl" && d.name === "init")
				inits.set(p, [...(inits.get(p) ?? []), d]);
			for (const n of declNames(d)) {
				if (!byName.has(n)) byName.set(n, []);
				byName.get(n).push(d);
			}
		}
	}
	return { byName, methods, inits };
}

// Incremental closure over one or more Go-source stdlib packages.  A
// declaration's body may still be unchecked (lazy checking): `decl._ensure()`,
// when present, checks and mangles it first and returns an error text on
// failure, so the references collected from its checked copy
// (`checkedDecl`) are the mangled ones.  `reached` holds the stored
// declarations.  Failed
// declarations are listed in `failures`.
export class StdlibReach {
	constructor(stdlibPrograms) {
		this.programs = stdlibPrograms;
		const { byName, methods, inits } = indexStdlib(stdlibPrograms);
		this.byName = byName;
		this.methods = methods;
		this.inits = inits;
		this.reached = new Set();
		this.names = new Set();
		this.fields = new Set(IMPLICIT_METHODS);
		this.escaped = new Set(); // types whose values leave Go: all methods stay
		this.pending = [];
		this.failures = [];
	}

	// Adds `rootNodes` (AST that is emitted) and closes over what they use.
	add(rootNodes) {
		const roots = new Set();
		const knownFields = this.fields.size;
		collectTopRefs(rootNodes, roots, this.fields);
		for (const n of roots) this._name(n);
		// A reference to something already reached leaves the closure as it was.
		if (this.pending.length === 0 && this.fields.size === knownFields) return;
		this._close();
	}

	_name(n) {
		if (this.names.has(n)) return;
		this.names.add(n);
		this.pending.push(n);
	}

	_reach(d) {
		if (this.reached.has(d)) return;
		this.reached.add(d);
		const failure = d._ensure?.();
		if (failure) this.failures.push(failure);
		const local = new Set();
		collectTopRefs(checkedDecl(d), local, this.fields);
		for (const n of local) this._name(n);
	}

	_close() {
		let changed = true;
		while (changed) {
			while (this.pending.length > 0)
				for (const d of this.byName.get(this.pending.pop()) ?? [])
					this._reach(d);
			const size = this.reached.size;
			for (const m of this.methods)
				if (
					this.names.has(m.recv) &&
					(this.fields.has(m.decl.name) || this.escaped.has(m.recv))
				)
					this._reach(m.decl);
			for (const p of this.programs)
				if (p.decls.some((d) => this.reached.has(d)))
					for (const d of this.inits.get(p) ?? []) this._reach(d);
			changed = this.reached.size !== size || this.pending.length > 0;
		}
	}
}

/**
 * Returns the set of declarations of `stdlibPrograms` reachable from
 * `rootPrograms` (all user code that is emitted).  A program's `init` is
 * kept when anything else in that program is reached.  A reached body that
 * fails its (lazy) check throws.
 */
export function reachableStdlibDecls(rootPrograms, stdlibPrograms) {
	const reach = new StdlibReach(stdlibPrograms);
	reach.add(rootPrograms);
	if (reach.failures.length > 0) throw new Error(reach.failures[0]);
	return reach.reached;
}

// ── User code ────────────────────────────────────────────────

// One closure over the packages of a build.  Go-source stdlib declarations are
// reached the way `StdlibReach` does; user code adds the declarations of the
// local packages ("units") that the roots reach:
//
//   - `main()` of the entry package, or every exported declaration of an entry
//     package without `main`; `GofrontRunTests` when the build runs tests;
//   - the exported signatures of `wasm` packages (the boundary facade names
//     their types in JS);
//   - `init()` and package-level initializers that call or receive, of every
//     package (the generated `gofront_gen.go` registers on demand instead);
//   - everything, when the entry package emits no JS (`prune: false`).
//
// A declaration is a function, type, `templ`/`css` component or `const` block
// (whole, so `iota` groups stay intact); a `var` block is reached spec by spec.
// A name resolves in its own package, in a package the file dot-imports, and
// as `pkg.Name` in the local package the file imports as `pkg`.

// The names a declaration binds in its package (`byName`) and the way it is
// kept: `init` functions and methods are not looked up by name.
function declaredAt(at) {
	const { node } = at;
	switch (node.kind) {
		case "FuncDecl":
			return node.name === "init" ? [] : [node.name];
		case "TypeDecl":
		case "TemplDecl":
		case "CssDecl":
			return [node.name];
		case "ConstDecl":
			return node.decls.flatMap((s) => s.names ?? []);
		default:
			return [];
	}
}

// The declarations of `unit` by name, and its methods by receiver type.
function indexUnit(unit) {
	const indexed = {
		...unit,
		byName: new Map(),
		methods: new Map(), // receiver type -> items
		inits: [],
		items: [],
	};
	const add = (item, names) => {
		indexed.items.push(item);
		for (const n of names) {
			if (n === "_") continue;
			if (!indexed.byName.has(n)) indexed.byName.set(n, []);
			indexed.byName.get(n).push(item);
		}
	};
	for (const program of unit.programs) {
		for (const node of program.decls ?? []) {
			const at = { node, unit: indexed, program };
			if (node.kind === "VarDecl")
				for (const spec of node.decls)
					add({ ...at, node: spec, spec: true }, spec.names ?? []);
			else if (node.kind === "MethodDecl") {
				const recv = node.recvType?.name;
				if (!indexed.methods.has(recv)) indexed.methods.set(recv, []);
				indexed.methods.get(recv).push(at);
				indexed.items.push(at);
			} else if (node.kind === "FuncDecl" && node.name === "init") {
				indexed.inits.push(at);
				indexed.items.push(at);
			} else add(at, declaredAt(at));
		}
	}
	return indexed;
}

// A package-level `var` spec whose initializer runs code: a call or a receive,
// not counting a function literal that is only declared.
function runsCode(spec) {
	const visit = (node) => {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) return node.some(visit);
		if (node.kind === "FuncLit") return false;
		if (node.kind === "CallExpr" && !node._isTypeConversion) return true;
		if (node.kind === "UnaryExpr" && node.op === "<-") return true;
		return someChildOf(node, visit);
	};
	return visit(spec.value);
}

function someChildOf(node, pred) {
	let found = false;
	forEachChild(node, (child) => {
		if (!found && pred(child)) found = true;
	});
	return found;
}

const REGISTER_FIELDS = { Register: "fmtrt", RegisterEncoder: "jsonrt" };

// What the registering `var _ = fmtrt.Register(...)` / `jsonrt.RegisterEncoder(...)`
// of a generated file is, else null.
function registration(item) {
	if (!item.spec || !item.program._generated) return null;
	const call = item.node.value?.[0];
	if (call?.kind !== "CallExpr" || call.func?.kind !== "SelectorExpr")
		return null;
	return REGISTER_FIELDS[call.func.field] ?? null;
}

export class BuildReach extends StdlibReach {
	/**
	 * `units`: the local packages of the build, `{ key, pkgName, programs,
	 * emitted }`; `entry`: the key of the package being built; `roots`: names
	 * of declarations (of any package) to keep as well; `isTest`: the
	 * build runs the entry package's tests; `prune: false` roots every
	 * declaration of the units that emit JS.
	 */
	constructor(
		stdlibPrograms,
		units,
		{ entry, isTest = false, prune = true, roots = [] },
	) {
		super(stdlibPrograms);
		this.entry = entry;
		this.extraRoots = roots;
		this.isTest = isTest;
		this.prune = prune;
		this.units = new Map(units.map((u) => [u.key, indexUnit(u)]));
		this.queue = [];
		this.registrations = [];
		this.typesByBase = null;
		this.external = new Set(); // names .d.ts and npm imports declare
		this.goTypes = new Set();
		for (const u of this.units.values()) {
			for (const n of u.emitter?.checker?._externalNames ?? [])
				this.external.add(n);
			for (const item of u.items)
				if (item.node.kind === "TypeDecl") this.goTypes.add(item.node.name);
		}
		this._seed();
		this._closeBuild();
	}

	// The names of the declarations of unit `key` that are reached (`T.M` for a
	// method), sorted; for tests and diagnostics.
	namesOf(key) {
		const out = [];
		for (const item of this.units.get(key)?.items ?? []) {
			if (!this.reached.has(item.node)) continue;
			const n = item.node;
			if (n.kind === "MethodDecl") out.push(`${n.recvType?.name}.${n.name}`);
			else if (item.spec || n.kind === "ConstDecl")
				out.push(...(item.spec ? n.names : n.decls.flatMap((s) => s.names)));
			else out.push(n.name);
		}
		return out.sort();
	}

	// Whether `node` (a declaration or `var` spec of a unit) is reached.
	has(node) {
		return this.reached.has(node);
	}

	_seed() {
		const emitting = [...this.units.values()].filter((u) => u.emitted);
		const entry = this.units.get(this.entry);
		const all = !this.prune || !entry?.emitted;
		for (const u of emitting) this._seedUnit(u, all);
		if (entry?.emitted) this._seedEntry(entry);
		// A host that calls declarations by name names them in `roots`.
		for (const u of emitting)
			for (const name of this.extraRoots)
				for (const item of u.byName.get(name) ?? []) this._expose(item);
		this._seedFacade();
	}

	// What every package runs: its `init`s and its calling initializers (all of
	// its code when `all`).
	_seedUnit(unit, all) {
		for (const item of unit.items) {
			if (all || unit.inits.includes(item)) this._item(item);
			else if (item.spec && !item.program._generated && runsCode(item.node))
				this._item(item);
			else if (registration(item)) this.registrations.push(item);
		}
	}

	// A test build runs `GofrontRunTests` of the driver; a program runs `main`;
	// a package without either exports its exported declarations.
	_seedEntry(entry) {
		const named = (n) =>
			(entry.byName.get(n) ?? []).filter((i) => i.node.kind === "FuncDecl");
		const driver = this.isTest ? named("GofrontRunTests") : [];
		const main = named("main");
		for (const item of [...driver, ...(driver.length === 0 ? main : [])])
			this._item(item);
		if (driver.length > 0 || main.length > 0) return;
		for (const [name, found] of entry.byName)
			if (isExported(name)) for (const item of found) this._expose(item);
	}

	// Reaches `item`, which code outside the build calls or reads by name: the
	// types in its signature leave Go.
	_expose(item) {
		this._item(item);
		const types = item.unit.emitter?.checker?.types;
		const { node } = item;
		if (!types) return;
		const names = new Set();
		if (node.kind === "TypeDecl") names.add(node.name);
		else
			collectRefs(
				node.kind === "FuncDecl" ? [node.params, node.returnType] : node.type,
				{
					names,
					fields: new Set(),
					quals: new Set(),
					sites: [],
				},
			);
		for (const n of names) reachableTypeNames(types.get(n), this.escaped);
	}

	// The boundary facade names the types in the signatures a `wasm` package
	// exports.
	_seedFacade() {
		for (const u of this.units.values()) {
			if (u.emitted || u.emitTarget !== "wasm") continue;
			for (const program of u.programs)
				for (const d of program.decls ?? []) {
					if (!isExported(d.name ?? "")) continue;
					const at = { node: d, unit: u, program };
					if (d.kind === "TypeDecl") this._sig(at, d.type);
					else if (d.kind === "FuncDecl" || d.kind === "MethodDecl")
						this._sig(at, [d.params, d.returnType]);
				}
		}
	}

	_sig(at, nodes) {
		const refs = { names: new Set(), fields: this.fields, quals: new Set() };
		collectRefs(nodes, { ...refs, sites: [] });
		for (const n of refs.names) this._name(n);
		this._resolve(at, refs);
	}

	// A package that emits no JS (`wasm`) contributes its types only: the
	// facade names them, while its functions run in the module.
	_item(item) {
		if (!item.unit.emitted && item.node.kind !== "TypeDecl") return;
		if (this.reached.has(item.node)) return;
		this.reached.add(item.node);
		// The component code the backend emits calls `Mount` without a selector.
		if (item.node.kind === "TemplDecl") this.fields.add("Mount");
		this.queue.push(item);
	}

	// Reaches what `item` names by `refs.names` and `refs.quals`.
	_resolve(item, refs) {
		for (const name of refs.names) this._resolveName(item, name);
		for (const qual of refs.quals) this._resolveQual(item, qual);
	}

	_resolveName({ unit, program }, name) {
		for (const found of unit.byName.get(name) ?? []) this._item(found);
		if (isExported(name))
			for (const key of program._dotImports ?? [])
				for (const found of this.units.get(key)?.byName.get(name) ?? [])
					this._item(found);
		if (program._generated)
			for (const found of this._typesNamed(name)) this._item(found);
	}

	// `pkg.Name`, where `pkg` is a local package the file imports.
	_resolveQual({ program }, qual) {
		const dot = qual.indexOf(".");
		const key = program._localImports?.get(qual.slice(0, dot));
		const dep = this.units.get(key);
		if (!dep) return;
		const field = qual.slice(dot + 1);
		for (const n of [field, `${field}$$${dep.pkgName}`])
			for (const found of dep.byName.get(n) ?? []) this._item(found);
	}

	// The generated Go names a type of another local package by its bare name.
	_typesNamed(name) {
		if (!this.typesByBase) {
			this.typesByBase = new Map();
			for (const u of this.units.values())
				for (const [n, found] of u.byName)
					for (const item of found) {
						if (item.node.kind !== "TypeDecl") continue;
						const base = n.split("$$")[0];
						if (!this.typesByBase.has(base)) this.typesByBase.set(base, []);
						this.typesByBase.get(base).push(item);
					}
		}
		return this.typesByBase.get(name) ?? [];
	}

	// Whether a method of a reached type is emitted: its name is selected
	// somewhere reached (a call, a method value or expression, a reached
	// interface, or an implicit caller such as `fmt`), or its type's values
	// leave Go (a package without `main` exports its types, so they do).
	_keepsMethod({ node }) {
		if (!this.prune || this.fields.has(node.name)) return true;
		return this.escaped.has(node.recvType?.name);
	}

	// What the code generator needs to leave unselected methods out of what a
	// struct promotes; null when every method is kept.
	keepMethods() {
		return this.prune ? { names: this.fields, escaped: this.escaped } : null;
	}

	_size() {
		return (
			this.reached.size +
			this.fields.size +
			this.escaped.size +
			this.pending.length
		);
	}

	// Notes the types of the values `refs` hands to something that is not Go.
	_noteHandOvers(refs) {
		const isGoType = (n) => this.goTypes.has(n);
		for (const site of refs.sites) {
			if (!leavesGo(site, this.external, isGoType)) continue;
			for (const t of site.types) reachableTypeNames(t, this.escaped);
		}
	}

	_closeBuild() {
		let before;
		do {
			before = this._size();
			while (this.queue.length > 0) {
				const item = this.queue.pop();
				const refs = refsOf(item.node);
				for (const n of refs.names) this._name(n);
				for (const f of refs.fields) this.fields.add(f);
				this._noteHandOvers(refs);
				this._resolve(item, refs);
			}
			this._close();
			this._reachMethods();
			this._reachRegistrations();
			if (this.failures.length > 0) break;
		} while (this._size() !== before || this.queue.length > 0);
	}

	_reachMethods() {
		for (const u of this.units.values()) {
			if (!u.emitted) continue;
			for (const [recv, methods] of u.methods) {
				const typeReached = (u.byName.get(recv) ?? []).some((i) =>
					this.reached.has(i.node),
				);
				if (typeReached)
					for (const m of methods) if (this._keepsMethod(m)) this._item(m);
			}
		}
	}

	_stdReached(pkg, pred = () => true) {
		return this.programs.some(
			(p) =>
				p._path?.includes(`/internal/${pkg}/`) &&
				p.decls.some((d) => this.reached.has(d) && pred(d)),
		);
	}

	// A generated file registers its formatters when `fmtrt` is reached and its
	// encoder when dynamic JSON encoding is.
	_reachRegistrations() {
		for (const item of this.registrations) {
			if (this.reached.has(item.node)) continue;
			const on =
				registration(item) === "fmtrt"
					? this._stdReached("fmtrt")
					: this._stdReached("jsonrt", (d) => d.name === "EncodeDynamic");
			if (on) this._item(item);
		}
	}
}
