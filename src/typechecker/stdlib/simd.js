// src/typechecker/stdlib/simd.js
// `gofront/simd` — WebAssembly SIMD types and vector operations.
//
// F32x4 is a 128-bit 4-wide float32 vector with Go value semantics:
// - Lowered to WASM v128 in wasm packages.
// - Lowered to a frozen 4-number array with Math.fround in js packages.

import { BOOL, FLOAT32, INT } from "../types.js";

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

	const mask32x4Type = {
		kind: "named",
		name: "simd.Mask32x4",
		underlying: {
			kind: "simd",
			simd: "Mask32x4",
			elem: BOOL,
			lanes: 4,
		},
	};

	const fn = (params, returns) => ({ kind: "func", params, returns });
	const unary = fn([], [f32x4Type]);
	const binary = fn([f32x4Type], [f32x4Type]);
	const compare = fn([f32x4Type], [mask32x4Type]);

	f32x4Type.underlying.methods = new Map([
		["Add", binary],
		["Sub", binary],
		["Mul", binary],
		["Div", binary],
		["Min", binary],
		["Max", binary],
		["MulAdd", fn([f32x4Type, f32x4Type], [f32x4Type])],
		["Neg", unary],
		["Abs", unary],
		["Sqrt", unary],
		["Floor", unary],
		["Ceil", unary],
		["Trunc", unary],
		["RoundToEven", unary],
		["Dot3", fn([f32x4Type], [FLOAT32])],
		["Dot4", fn([f32x4Type], [FLOAT32])],
		["Sum", fn([], [FLOAT32])],
		["Lane", fn([INT], [FLOAT32])],
		["WithLane", fn([INT, FLOAT32], [f32x4Type])],
		["Splat", fn([FLOAT32], [f32x4Type])],
		["Swizzle", fn([INT, INT, INT, INT], [f32x4Type])],
		["Equal", compare],
		["NotEqual", compare],
		["Less", compare],
		["LessEqual", compare],
		["Greater", compare],
		["GreaterEqual", compare],
	]);

	const maskBinary = fn([mask32x4Type], [mask32x4Type]);
	mask32x4Type.underlying.methods = new Map([
		["And", maskBinary],
		["Or", maskBinary],
		["Xor", maskBinary],
		["AndNot", maskBinary],
		["Not", fn([], [mask32x4Type])],
		["Any", fn([], [BOOL])],
		["All", fn([], [BOOL])],
		["Bits", fn([], [INT])],
		["Lane", fn([INT], [BOOL])],
	]);

	types.set("simd.F32x4", f32x4Type);
	types.set("F32x4", f32x4Type);
	types.set("simd.Mask32x4", mask32x4Type);
	types.set("Mask32x4", mask32x4Type);

	const sharedFloat32 = types.get("shared.Float32") ?? {
		kind: "named",
		name: "shared.Float32",
		underlying: { kind: "shared", elem: FLOAT32, shared: "Float32" },
	};

	const members = {
		F32x4: f32x4Type,
		Mask32x4: mask32x4Type,
		Select: fn([mask32x4Type, f32x4Type, f32x4Type], [f32x4Type]),
		Shuffle: fn([f32x4Type, f32x4Type, INT, INT, INT, INT], [f32x4Type]),
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
