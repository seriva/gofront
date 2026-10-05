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
