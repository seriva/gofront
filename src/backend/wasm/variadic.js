// src/backend/wasm/variadic.js
// WASM has no rest parameters.  A variadic `xs ...T` becomes an ordinary
// `[]T` parameter, and every call to a GoFront function, method or closure
// packs its trailing arguments into a `[]T` literal (`f(s...)` passes `s`
// through).  Emitter-backed stdlib calls keep their raw arguments.  Runs
// after monomorphisation, so callee types are concrete, on the WASM
// pipeline's own copy of the programs.

import { typeToTypeNode } from "./monomorph.js";

function variadicFuncType(t) {
	const fn = t?.kind === "named" ? t.underlying : t;
	return fn?.kind === "func" && fn.variadic ? fn : null;
}

// `fmt.Sprintf(...)` or a method of an emitter-backed type (`t.Errorf(...)`
// on `*testing.T`): those emitters take the arguments unpacked.  Emitter
// types are the dotted names; GoFront and Go-source types are not.
function isStdlibCall(call) {
	const f = call.func;
	if (f?.kind !== "SelectorExpr") return false;
	let recv = f.expr?._type;
	if (recv?.kind === "namespace") return true;
	if (recv?.kind === "pointer") recv = recv.base;
	return typeof recv?.name === "string" && recv.name.includes(".");
}

function packCallArgs(call) {
	if (call._multiForward || isStdlibCall(call)) return false;
	const fn = variadicFuncType(call.func?._type);
	if (!fn) return false;
	const n = fn.params.length;
	const args = call.args ?? [];
	if (args.length === n && args[n - 1]?._spread) {
		args[n - 1]._spread = false;
		return true;
	}
	if (args.length < n - 1) return false;
	const elem = fn.params[n - 1];
	const sliceType = { kind: "slice", elem };
	// No variadic arguments: the parameter is the nil slice, as in Go.
	const rest = args.slice(n - 1);
	const packed =
		rest.length === 0
			? {
					kind: "TypeConversion",
					targetType: sliceType,
					expr: { kind: "Ident", name: "nil" },
					_type: sliceType,
					_line: call._line,
					_col: call._col,
				}
			: null;
	call.args = [
		...args.slice(0, n - 1),
		packed ?? {
			kind: "CompositeLit",
			typeExpr: { kind: "SliceType", elem: typeToTypeNode(elem) },
			elems: args.slice(n - 1),
			_type: sliceType,
			_line: call._line,
			_col: call._col,
		},
	];
	return true;
}

function sliceVariadicParam(params) {
	const last = params?.[params.length - 1];
	if (!last?.variadic) return false;
	last.type = { kind: "SliceType", elem: last.type };
	last.variadic = false;
	last._variadic = true; // the JS facade keeps a rest parameter
	return true;
}

/** Rewrites variadic declarations and calls in place; true if anything changed. */
export function desugarVariadics(node) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node)) {
		let changed = false;
		for (const n of node) changed = desugarVariadics(n) || changed;
		return changed;
	}
	let changed = false;
	if (Array.isArray(node.params)) changed = sliceVariadicParam(node.params);
	if (node.kind === "CallExpr") changed = packCallArgs(node) || changed;
	for (const key of Object.keys(node)) {
		if (key.charCodeAt(0) === 95) continue; // "_" side tables
		changed = desugarVariadics(node[key]) || changed;
	}
	return changed;
}
