// src/lower/reachability.js
// Reachability for Go-source stdlib packages: only declarations reachable
// from user code are emitted, so an imported but unused package costs zero
// bytes (JS output and dev-mode WASM, where Binaryen does not run).
//
// Stdlib top-level names are mangled (`Compare$$cmp`) and user references to
// them are plain identifiers after type-checking, so reachability is a
// closure over names.  A method is reachable when its receiver type is and
// its name is selected somewhere reachable, or is called implicitly.

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

// Names (identifiers and type names) and selected fields used under `node`.
function collectRefs(node, names, fields) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) collectRefs(n, names, fields);
		return;
	}
	if (node._stdName) names.add(node._stdName); // `cmp.Compare` in user code
	if (
		node.kind === "Ident" ||
		node.kind === "TypeName" ||
		node.kind === "GenericTypeName"
	)
		names.add(node.name);
	else if (node.kind === "SelectorExpr") fields.add(node.field);
	// A reached interface needs its methods on the types that satisfy it.
	else if (node.kind === "InterfaceType")
		for (const m of node.methods ?? []) fields.add(m.name);
	forEachChild(node, (child) => collectRefs(child, names, fields));
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

const JSON_NAMES = [
	"SyntaxError$$internal$jsonrt",
	"UnmarshalTypeError$$internal$jsonrt",
	"InvalidUnmarshalError$$internal$jsonrt",
	"UnsupportedValueError$$internal$jsonrt",
	"UnsupportedTypeError$$internal$jsonrt",
	"MarshalerError$$internal$jsonrt",
	"CheckValid$$internal$jsonrt",
	"EncodeBytes$$internal$jsonrt",
	"DecodeBytes$$internal$jsonrt",
	"Number$$internal$jsonrt",
	"OptEscapeHTML$$internal$jsonrt",
	"OptUseNumber$$internal$jsonrt",
	"OptDisallowUnknownFields$$internal$jsonrt",
];

function addExtraRoots(names) {
	// testing and context return time.Time and time.Duration values.
	for (const n of names)
		if (/^(testing|context)(\.|$)/.test(n)) {
			names.add("Time$$time");
			names.add("Duration$$time");
			break;
		}
	// The emitter-backed errors.As walks the list errors.flatten builds.
	if (names.has("errors")) names.add("flatten$$errors");
	if (names.has("json")) {
		for (const n of JSON_NAMES) names.add(n);
	}
}

// Incremental closure over one or more Go-source stdlib packages.  A
// declaration's body may still be unchecked (lazy checking): `decl._ensure()`,
// when present, checks and mangles it first and returns an error text on
// failure, so the references collected from it are the mangled ones.  Failed
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
		this.pending = [];
		this.failures = [];
	}

	// Adds `rootNodes` (AST that is emitted) and closes over what they use.
	add(rootNodes) {
		const roots = new Set();
		collectRefs(rootNodes, roots, this.fields);
		addExtraRoots(roots);
		for (const n of roots) this._name(n);
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
		collectRefs(d, local, this.fields);
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
				if (this.names.has(m.recv) && this.fields.has(m.decl.name))
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
