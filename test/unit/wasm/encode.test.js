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

section("WASM Encoder — SIMD (0xFD) Instructions");

test("SIMD instruction encoding and execution (f32x4.splat, add, extract_lane)", () => {
	// (func (export "add_simd") (result f32)
	//   (f32x4.extract_lane 0
	//     (f32x4.add
	//       (f32x4.splat (f32.const 1.5))
	//       (f32x4.splat (f32.const 2.5)))))
	const mod = {
		types: [{ form: "func", params: [], results: ["f32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: [],
				body: [
					{ op: "f32.const", value: 1.5 },
					{ op: "f32x4.splat" },
					{ op: "f32.const", value: 2.5 },
					{ op: "f32x4.splat" },
					{ op: "f32x4.add" },
					{ op: "f32x4.extract_lane", lane: 0 },
				],
			},
		],
		exports: [{ name: "add_simd", kind: "func", index: 0 }],
	};

	const bytes = encodeModule(mod);
	assert(
		WebAssembly.validate(bytes),
		"SIMD module must pass WebAssembly.validate()",
	);
	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(instance.exports.add_simd(), 4.0);
});

test("SIMD v128.const, replace_lane, and f32x4 arithmetic opcodes", () => {
	// Tests LEB128 encoding of sub-opcodes > 127 (e.g. f32x4.add = 228 -> 0xE4 0x01)
	const mod = {
		types: [{ form: "func", params: [], results: ["f32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: ["v128"],
				body: [
					{ op: "v128.const", values: [1.0, 2.0, 3.0, 4.0] },
					{ op: "f32.const", value: 10.0 },
					{ op: "f32x4.replace_lane", lane: 2 },
					{ op: "local.tee", index: 0 },
					{ op: "local.get", index: 0 },
					{ op: "f32x4.mul" },
					{ op: "f32x4.extract_lane", lane: 2 },
				],
			},
		],
		exports: [{ name: "compute", kind: "func", index: 0 }],
	};

	const bytes = encodeModule(mod);
	assert(
		WebAssembly.validate(bytes),
		"SIMD v128.const module must pass validation",
	);
	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(instance.exports.compute(), 100.0);
});

test("SIMD v128.load and v128.store encode with memarg", () => {
	const mod = {
		memory: { min: 1, max: 1 },
		types: [{ form: "func", params: [], results: ["f32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: [],
				body: [
					// Store v128 at address 0
					{ op: "i32.const", value: 0 },
					{ op: "f32.const", value: 42.5 },
					{ op: "f32x4.splat" },
					{ op: "v128.store", align: 2, offset: 0 },
					// Load back from address 0
					{ op: "i32.const", value: 0 },
					{ op: "v128.load", align: 2, offset: 0 },
					{ op: "f32x4.extract_lane", lane: 1 },
				],
			},
		],
		exports: [{ name: "roundtrip", kind: "func", index: 0 }],
	};

	const bytes = encodeModule(mod);
	assert(
		WebAssembly.validate(bytes),
		"SIMD load/store module must pass validation",
	);
	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(instance.exports.roundtrip(), 42.5);
});

test("SIMD integer extract and replace lane encoding (i32x4, i16x8, i8x16)", () => {
	const mod = {
		types: [{ form: "func", params: [], results: ["i32"] }],
		funcs: [
			{
				typeIndex: 0,
				locals: [],
				body: [
					{ op: "v128.const", bytes: new Array(16).fill(0) },
					{ op: "i32.const", value: 123 },
					{ op: "i32x4.replace_lane", lane: 2 },
					{ op: "i32x4.extract_lane", lane: 2 },
				],
			},
		],
		exports: [{ name: "test_i32", kind: "func", index: 0 }],
	};

	const bytes = encodeModule(mod);
	assert(
		WebAssembly.validate(bytes),
		"i32x4 extract/replace module must pass validation",
	);
	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(instance.exports.test_i32(), 123);
});
