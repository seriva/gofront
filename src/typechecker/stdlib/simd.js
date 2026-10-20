// src/typechecker/stdlib/simd.js
// `gofront/simd` — WebAssembly SIMD types and vector operations.
//
// F32x4 is a 128-bit 4-wide float32 vector with Go value semantics:
// - Lowered to WASM v128 in wasm packages.
// - Lowered to a frozen 4-number array with Math.fround in js packages.

import { FLOAT32, INT } from "../types.js";

export function setupSimdGlobals(globals, types) {
	const f32x4Type = {
		kind: "named",
		name: "simd.F32x4",
		underlying: {
			kind: "simd",
			simd: "F32x4",
			elem: FLOAT32,
			lanes: 4,
		},
	};

	f32x4Type.underlying.methods = new Map([
		["Add", { kind: "func", params: [f32x4Type], returns: [f32x4Type] }],
		["Sub", { kind: "func", params: [f32x4Type], returns: [f32x4Type] }],
		["Mul", { kind: "func", params: [f32x4Type], returns: [f32x4Type] }],
		["Div", { kind: "func", params: [f32x4Type], returns: [f32x4Type] }],
		["Min", { kind: "func", params: [f32x4Type], returns: [f32x4Type] }],
		["Max", { kind: "func", params: [f32x4Type], returns: [f32x4Type] }],
		["Dot3", { kind: "func", params: [f32x4Type], returns: [FLOAT32] }],
		["Dot4", { kind: "func", params: [f32x4Type], returns: [FLOAT32] }],
		["Lane", { kind: "func", params: [INT], returns: [FLOAT32] }],
		[
			"WithLane",
			{ kind: "func", params: [INT, FLOAT32], returns: [f32x4Type] },
		],
		["Splat", { kind: "func", params: [FLOAT32], returns: [f32x4Type] }],
	]);

	types.set("simd.F32x4", f32x4Type);
	types.set("F32x4", f32x4Type);

	const sharedFloat32 = types.get("shared.Float32") ?? {
		kind: "named",
		name: "shared.Float32",
		underlying: { kind: "shared", elem: FLOAT32, shared: "Float32" },
	};

	const members = {
		F32x4: f32x4Type,
		NewF32x4: {
			kind: "func",
			params: [FLOAT32, FLOAT32, FLOAT32, FLOAT32],
			returns: [f32x4Type],
		},
		Splat: {
			kind: "func",
			params: [FLOAT32],
			returns: [f32x4Type],
		},
		LoadF32x4: {
			kind: "func",
			params: [sharedFloat32, INT],
			returns: [f32x4Type],
		},
		StoreF32x4: {
			kind: "func",
			params: [sharedFloat32, INT, f32x4Type],
			returns: [],
		},
	};

	globals.define("simd", { kind: "namespace", name: "simd", members });
}
