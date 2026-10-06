// test/unit/wasm/encode.test.js
// Tests for WebAssembly binary encoder (LEB128, sections, GC types, execution).

import {
	encodeF32,
	encodeF64,
	encodeI32LEB,
	encodeI64LEB,
	encodeModule,
	encodeU32LEB,
} from "../../../src/backend/wasm/encode.js";
import { assert, assertEqual, section, test } from "../helpers.js";

section("WASM Encoder — LEB128 and Floats");

function assertArrayEqual(actual, expected) {
	assertEqual(JSON.stringify(actual), JSON.stringify(expected));
}

test("LEB128 unsigned 32-bit golden bytes", () => {
	assertArrayEqual(encodeU32LEB(0), [0x00]);
	assertArrayEqual(encodeU32LEB(1), [0x01]);
	assertArrayEqual(encodeU32LEB(127), [0x7f]);
	assertArrayEqual(encodeU32LEB(128), [0x80, 0x01]);
	assertArrayEqual(encodeU32LEB(624485), [0xe5, 0x8e, 0x26]);
});

test("LEB128 signed 32-bit golden bytes", () => {
	assertArrayEqual(encodeI32LEB(0), [0x00]);
	assertArrayEqual(encodeI32LEB(-1), [0x7f]);
	assertArrayEqual(encodeI32LEB(1), [0x01]);
	assertArrayEqual(encodeI32LEB(-624485), [0x9b, 0xf1, 0x59]);
	assertArrayEqual(encodeI32LEB(624485), [0xe5, 0x8e, 0x26]);
});

test("LEB128 signed 64-bit golden bytes", () => {
	assertArrayEqual(encodeI64LEB(0n), [0x00]);
	assertArrayEqual(encodeI64LEB(-1n), [0x7f]);
	assertArrayEqual(encodeI64LEB(1n), [0x01]);
	assertArrayEqual(encodeI64LEB(-624485n), [0x9b, 0xf1, 0x59]);
	assertArrayEqual(encodeI64LEB(624485n), [0xe5, 0x8e, 0x26]);
});

test("Float 32 and Float 64 golden bytes", () => {
	const f32Zero = encodeF32(0);
	assertArrayEqual(f32Zero, [0, 0, 0, 0]);
	const f64Zero = encodeF64(0);
	assertArrayEqual(f64Zero, [0, 0, 0, 0, 0, 0, 0, 0]);

	// 1.0f32 in IEEE-754 little-endian: 0x00, 0x00, 0x80, 0x3F
	assertArrayEqual(encodeF32(1.0), [0x00, 0x00, 0x80, 0x3f]);
});

section("WASM Encoder — Module Validation & Execution");

test("Minimal valid module with add(i32, i32) -> i32", () => {
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

	const bytes = encodeModule(mod);
	assert(
		WebAssembly.validate(bytes),
		"module must pass WebAssembly.validate()",
	);
	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(instance.exports.add(10, 32), 42);
	assertEqual(instance.exports.add(-5, 5), 0);
});

test("Module with locals and loops", () => {
	// sum(n: i32) -> i32: computes sum of 1..n
	// local 0: n
	// local 1: sum (i32)
	// local 2: i (i32)
	const mod = {
		types: [{ form: "func", params: ["i32"], results: ["i32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: ["i32", "i32"],
				body: [
					{ op: "i32.const", value: 0 },
					{ op: "local.set", index: 1 }, // sum = 0
					{ op: "i32.const", value: 1 },
					{ op: "local.set", index: 2 }, // i = 1
					{ op: "block", blockType: "void" },
					{ op: "loop", blockType: "void" },
					// if i > n break
					{ op: "local.get", index: 2 },
					{ op: "local.get", index: 0 },
					{ op: "i32.gt_s" },
					{ op: "br_if", depth: 1 },
					// sum += i
					{ op: "local.get", index: 1 },
					{ op: "local.get", index: 2 },
					{ op: "i32.add" },
					{ op: "local.set", index: 1 },
					// i++
					{ op: "local.get", index: 2 },
					{ op: "i32.const", value: 1 },
					{ op: "i32.add" },
					{ op: "local.set", index: 2 },
					{ op: "br", depth: 0 },
					{ op: "end" }, // end loop
					{ op: "end" }, // end block
					{ op: "local.get", index: 1 },
					{ op: "return" },
				],
			},
		],
		exports: [{ name: "sum", kind: "func", index: 0 }],
	};

	const bytes = encodeModule(mod);
	assert(WebAssembly.validate(bytes), "loop module must pass validation");
	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(instance.exports.sum(10), 55);
	assertEqual(instance.exports.sum(0), 0);
});

test("WasmGC struct and recursive rec groups validate", () => {
	const mod = {
		types: [
			// Type 0: simple struct
			{
				form: "struct",
				fields: [
					{ type: "i32", mutable: true },
					{ type: "f32", mutable: true },
				],
			},
			// Type 1: rec group with self-referencing struct
			{
				form: "rec",
				types: [
					{
						form: "struct",
						fields: [
							{ type: "i32", mutable: true },
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
		exports: [],
	};

	const bytes = encodeModule(mod);
	assert(WebAssembly.validate(bytes), "GC rec group must pass validation");
});
