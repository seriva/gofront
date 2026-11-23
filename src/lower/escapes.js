// src/lower/escapes.js
// Values of user types that leave Go.  JavaScript reaches into such a value by
// member name (`el.addEventListener("click", handler)` calls `handler.Handle`),
// so every method of the types involved stays in the bundle.  A value leaves Go
// when it is handed to a JS-dynamic value or to a declaration from a `.d.ts`
// file or npm package.

import { anyKind } from "../typechecker/types.js";

// The named types a value of type `t` can hold or reach: through pointers,
// elements, keys and fields.  Adds their names to `out`.
export function reachableTypeNames(t, out, seen = new Set()) {
	if (!t || typeof t !== "object" || seen.has(t)) return;
	seen.add(t);
	switch (t.kind) {
		case "pointer":
			return reachableTypeNames(t.base, out, seen);
		case "slice":
		case "array":
		case "chan":
			return reachableTypeNames(t.elem, out, seen);
		case "map":
			reachableTypeNames(t.key, out, seen);
			return reachableTypeNames(t.value, out, seen);
		case "named":
			if (t.name) out.add(t.name);
			return reachableTypeNames(t.underlying, out, seen);
		case "struct":
			for (const f of t._structFields ?? [])
				reachableTypeNames(f.type, out, seen);
	}
}

// Whether a receiver of type `t` is something other than Go code: a JS-dynamic
// value or a named type that no Go package declares (a `.d.ts` interface).
function foreignReceiver(t, isGoType) {
	const base = t?.kind === "pointer" ? t.base : t;
	if (!base) return false;
	if (anyKind(base) === "dynamic") return true;
	if (base.kind !== "named" || !base.name) return false;
	return !(base.name.includes("$$") || isGoType(base.name));
}

// Whether the callee `to` of a hand-over site is not Go code.  `external` holds
// the names `.d.ts` and npm imports declare; `isGoType` tells the types the
// build's Go packages declare.
function calleeIsForeign(to, external, isGoType) {
	if (!to) return false;
	if (anyKind(to._type) === "dynamic") return true;
	if (to.kind === "Ident") return external.has(to.name);
	if (to.kind !== "SelectorExpr") return false;
	const base = to.expr?._type;
	if (base?.kind === "namespace") return !base._gofront;
	return foreignReceiver(base, isGoType);
}

// Whether the values of hand-over `site` leave Go: it is a call of, or an
// assignment to, something that is not Go code.
export function leavesGo(site, external, isGoType) {
	if (site.dynamic) return anyKind(site.dynamic._type) === "dynamic";
	return calleeIsForeign(site.to, external, isGoType);
}
