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
// GoFront code (fmt verbs, errors.Is/As/Unwrap, encoding/json).
const IMPLICIT_METHODS = new Set([
	"Error",
	"String",
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
	"Number$$internal$jsonrt",
	"OptEscapeHTML$$internal$jsonrt",
	"OptUseNumber$$internal$jsonrt",
	"OptDisallowUnknownFields$$internal$jsonrt",
];

function addExtraRoots(names) {
	if (names.has("strconv")) names.add("NumError$$strconv");
	if (names.has("json")) {
		for (const n of JSON_NAMES) names.add(n);
	}
}

/**
 * Returns the set of declarations of `stdlibPrograms` reachable from
 * `rootPrograms` (all user code that is emitted).  A program's `init` is
 * kept when anything else in that program is reached.
 */
export function reachableStdlibDecls(rootPrograms, stdlibPrograms) {
	const { byName, methods, inits } = indexStdlib(stdlibPrograms);
	const reached = new Set();
	const names = new Set();
	const fields = new Set(IMPLICIT_METHODS);
	collectRefs(rootPrograms, names, fields);
	addExtraRoots(names);

	const pending = [...names];
	const reach = (d) => {
		if (reached.has(d)) return;
		reached.add(d);
		const local = new Set();
		collectRefs(d, local, fields);
		for (const n of local) {
			if (names.has(n)) continue;
			names.add(n);
			pending.push(n);
		}
	};
	let changed = true;
	while (changed) {
		while (pending.length > 0)
			for (const d of byName.get(pending.pop()) ?? []) reach(d);
		const size = reached.size;
		for (const m of methods)
			if (names.has(m.recv) && fields.has(m.decl.name)) reach(m.decl);
		for (const p of stdlibPrograms)
			if (p.decls.some((d) => reached.has(d)))
				for (const d of inits.get(p) ?? []) reach(d);
		changed = reached.size !== size || pending.length > 0;
	}
	return reached;
}
