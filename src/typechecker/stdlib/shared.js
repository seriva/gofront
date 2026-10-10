// `gofront/shared` — fixed-size linear-memory buffers shared zero-copy between
// wasm packages and JS. Each `shared.Xxx` is a named type whose underlying kind
// is "shared" (not a slice): it supports indexing, len() and `.Subarray(lo, hi)`
// but not slicing, append or implicit conversion to GC slices.

import {
	FLOAT32,
	FLOAT64,
	INT,
	INT8,
	INT16,
	INT32,
	UINT8,
	UINT16,
	UINT32,
} from "../types.js";

// key → [elem type, JS TypedArray ctor, byte size]
export const SHARED_KINDS = {
	Float32: { elem: FLOAT32, ctor: "Float32Array", bytes: 4, key: "f32" },
	Float64: { elem: FLOAT64, ctor: "Float64Array", bytes: 8, key: "f64" },
	Int8: { elem: INT8, ctor: "Int8Array", bytes: 1, key: "i8" },
	Int16: { elem: INT16, ctor: "Int16Array", bytes: 2, key: "i16" },
	Int32: { elem: INT32, ctor: "Int32Array", bytes: 4, key: "i32" },
	Uint8: { elem: UINT8, ctor: "Uint8Array", bytes: 1, key: "u8" },
	Uint16: { elem: UINT16, ctor: "Uint16Array", bytes: 2, key: "u16" },
	Uint32: { elem: UINT32, ctor: "Uint32Array", bytes: 4, key: "u32" },
};

export function setupSharedGlobals(globals, types) {
	const members = {};
	for (const [name, info] of Object.entries(SHARED_KINDS)) {
		const t = {
			kind: "named",
			name: `shared.${name}`,
			underlying: { kind: "shared", elem: info.elem, shared: name },
		};
		t.underlying.methods = new Map([
			["Subarray", { kind: "func", params: [INT, INT], returns: [t] }],
		]);
		types.set(t.name, t);
		members[name] = t;
		members[`New${name}`] = { kind: "func", params: [INT], returns: [t] };
	}
	globals.define("shared", { kind: "namespace", name: "shared", members });
}

// Returns the SHARED_KINDS entry for a (possibly named) shared type, or null.
export function sharedInfo(t) {
	const u = t?.kind === "named" ? t.underlying : t;
	if (u?.kind !== "shared") return null;
	return { name: u.shared, ...SHARED_KINDS[u.shared] };
}
