// test/unit/wasm/wat.test.js
// Tests for WAT text generator.

import { emitWat } from "../../../src/backend/wasm/wat.js";
import { assert, section, test } from "../helpers.js";

section("WASM WAT Writer");

test("Emits WAT for basic function", () => {
	const mod = {
		types: [{ form: "func", params: ["i32", "i32"], results: ["i32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: [],
				body: [
					{ op: "local.get", index: 0 },
					{ op: "local.get", index: 1 },
					{ op: "i32.add" },
				],
			},
		],
		exports: [{ name: "add", kind: "func", index: 0 }],
	};

	const wat = emitWat(mod);
	assert(wat.includes('(export "add")'), "WAT must include export add");
	assert(
		wat.includes("(param i32 i32) (result i32)"),
		"WAT must include signature",
	);
	assert(wat.includes("local.get 0"), "WAT must include local.get 0");
	assert(wat.includes("i32.add"), "WAT must include i32.add");
});

test("Emits WAT with struct and rec types", () => {
	const mod = {
		types: [
			{
				form: "struct",
				fields: [
					{ type: "i32", mutable: true },
					{ type: "f64", mutable: false },
				],
			},
			{
				form: "rec",
				types: [
					{
						form: "struct",
						fields: [
							{
								type: { kind: "ref", nullable: true, typeIndex: 1 },
								mutable: true,
							},
						],
					},
				],
			},
		],
		funcs: [],
	};

	const wat = emitWat(mod);
	assert(
		wat.includes("(struct (field (mut i32)) (field f64))"),
		"WAT struct fields",
	);
	assert(wat.includes("(rec"), "WAT recursive type");
});

test("Emits WAT for SIMD instructions (v128.const, f32x4.add, extract_lane)", () => {
	const mod = {
		memory: { min: 1, max: 1 },
		types: [{ form: "func", params: [], results: ["f32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: ["v128"],
				body: [
					{ op: "v128.const", values: [1.0, 2.0, 3.0, 4.0] },
					{ op: "local.set", index: 0 },
					{ op: "local.get", index: 0 },
					{ op: "local.get", index: 0 },
					{ op: "f32x4.add" },
					{ op: "f32x4.extract_lane", lane: 0 },
					{ op: "i32.const", value: 0 },
					{ op: "v128.load", offset: 16, align: 2 },
					{ op: "drop" },
				],
			},
		],
		exports: [{ name: "test_simd", kind: "func", index: 0 }],
	};

	const wat = emitWat(mod);
	assert(wat.includes("v128.const f32x4 1 2 3 4"), "WAT v128.const");
	assert(wat.includes("f32x4.add"), "WAT f32x4.add");
	assert(wat.includes("f32x4.extract_lane 0"), "WAT f32x4.extract_lane");
	assert(
		wat.includes("v128.load offset=16 align=4"),
		"WAT v128.load offset and align",
	);
});

test("Emits WAT for v128.const with partial bytes and integer extract_lane", () => {
	const mod = {
		types: [{ form: "func", params: [], results: ["i32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: [],
				body: [
					{ op: "v128.const", bytes: [1, 2] },
					{ op: "i32x4.extract_lane", lane: 0 },
				],
			},
		],
		exports: [{ name: "test_wat", kind: "func", index: 0 }],
	};

	const wat = emitWat(mod);
	assert(wat.includes("v128.const i32x4"), "WAT v128.const with short bytes");
	assert(wat.includes("i32x4.extract_lane 0"), "WAT i32x4.extract_lane");
});
