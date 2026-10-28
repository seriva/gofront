// test/unit/wasm/encode.test.js
// Tests for WebAssembly binary encoder (LEB128, sections, GC types, execution).

import { readFileSync } from "node:fs";
import {
	encodeF32,
	encodeF64,
	encodeI32LEB,
	encodeI64LEB,
	encodeModule,
	encodeU32LEB,
	isGoFrontWasm,
} from "../../../src/backend/wasm/encode.js";
import * as wasmIndex from "../../../src/backend/wasm/index.js";
import {
	hasNativeWasmOpt,
	optimizeWasm,
} from "../../../src/backend/wasm/optimize.js";
import { compileWasm } from "../../../src/compiler.js";
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

section("WASM Encoder — SIMD comparisons, masks and rounding");

// Builds a module exporting f(a, b: f32) -> i32 with `body` reading the two
// params splatted into v128 values via locals 2 (a) and 3 (b).
function simdCompareModule(body, result = "i32") {
	return {
		types: [{ form: "func", params: ["f32", "f32"], results: [result] }],
		funcs: [
			{
				typeIndex: 0,
				locals: ["v128", "v128"],
				body: [
					{ op: "local.get", index: 0 },
					{ op: "f32x4.splat" },
					{ op: "local.set", index: 2 },
					{ op: "local.get", index: 1 },
					{ op: "f32x4.splat" },
					{ op: "local.set", index: 3 },
					...body,
				],
			},
		],
		exports: [{ name: "f", kind: "func", index: 0 }],
	};
}

const getA = { op: "local.get", index: 2 };
const getB = { op: "local.get", index: 3 };

test("SIMD f32x4 comparisons with bitmask (multi-byte LEB128 sub-opcodes)", () => {
	// i32x4.bitmask is sub-opcode 164 = 0xA4 0x01.
	const expected = {
		"f32x4.eq": (a, b) => a === b,
		"f32x4.ne": (a, b) => a !== b,
		"f32x4.lt": (a, b) => a < b,
		"f32x4.gt": (a, b) => a > b,
		"f32x4.le": (a, b) => a <= b,
		"f32x4.ge": (a, b) => a >= b,
	};
	for (const [op, ref] of Object.entries(expected)) {
		const bytes = encodeModule(
			simdCompareModule([getA, getB, { op }, { op: "i32x4.bitmask" }]),
		);
		assert(WebAssembly.validate(bytes), `${op} module must validate`);
		const f = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.f;
		for (const [a, b] of [
			[1, 2],
			[2, 2],
			[3, 2],
			[Number.NaN, 1],
			[0, -0],
		]) {
			assertEqual(f(a, b), ref(Math.fround(a), Math.fround(b)) ? 15 : 0);
		}
	}
	const sub = encodeModule(
		simdCompareModule([
			getA,
			getB,
			{ op: "f32x4.lt" },
			{ op: "i32x4.bitmask" },
		]),
	);
	assert(
		sub.join(",").includes("253,164,1"),
		"bitmask sub-opcode encodes as 0xFD 0xA4 0x01",
	);
});

test("SIMD any_true, all_true, bitselect, not and andnot", () => {
	const run = (body, a, b) => {
		const bytes = encodeModule(simdCompareModule(body));
		assert(WebAssembly.validate(bytes), "module must validate");
		return new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.f(
			a,
			b,
		);
	};
	const lt = [getA, getB, { op: "f32x4.lt" }];
	assertEqual(run([...lt, { op: "v128.any_true" }], 1, 2), 1);
	assertEqual(run([...lt, { op: "v128.any_true" }], 2, 1), 0);
	assertEqual(run([...lt, { op: "i32x4.all_true" }], 1, 2), 1);
	assertEqual(run([...lt, { op: "i32x4.all_true" }], 2, 1), 0);
	assertEqual(
		run([...lt, { op: "v128.not" }, { op: "i32x4.bitmask" }], 1, 2),
		0,
	);
	assertEqual(
		run([...lt, ...lt, { op: "v128.andnot" }, { op: "v128.any_true" }], 1, 2),
		0,
	);
	// bitselect(a, b, mask) picks a where mask is set: min(a, b) via lt mask.
	const select = [
		getA,
		getB,
		...lt,
		{ op: "v128.bitselect" },
		{ op: "f32x4.extract_lane", lane: 3 },
		{ op: "i32.trunc_f32_s" },
	];
	assertEqual(run(select, 1, 2), 1);
	assertEqual(run(select, 5, 2), 2);
});

test("SIMD ceil, floor, trunc and nearest", () => {
	const ops = ["f32x4.ceil", "f32x4.floor", "f32x4.trunc", "f32x4.nearest"];
	const inputs = [1.5, -1.5, 2.5, 2];
	for (const op of ops) {
		const lanes = [0, 1, 2, 3].map((lane) => {
			const bytes = encodeModule({
				types: [{ form: "func", params: [], results: ["f32"] }],
				funcs: [
					{
						typeIndex: 0,
						locals: [],
						body: [
							{ op: "v128.const", values: inputs },
							{ op },
							{ op: "f32x4.extract_lane", lane },
						],
					},
				],
				exports: [{ name: "f", kind: "func", index: 0 }],
			});
			assert(WebAssembly.validate(bytes), `${op} must validate`);
			return new WebAssembly.Instance(
				new WebAssembly.Module(bytes),
			).exports.f();
		});
		const ref = {
			"f32x4.ceil": inputs.map(Math.ceil),
			"f32x4.floor": inputs.map(Math.floor),
			"f32x4.trunc": inputs.map(Math.trunc),
			"f32x4.nearest": [2, -2, 2, 2],
		}[op];
		assertEqual(JSON.stringify(lanes), JSON.stringify(ref));
	}
});

test("SIMD comparison and rounding opcodes pass Binaryen optimized and unoptimized", async () => {
	const { optimizeWithBinaryen } = await import(
		"../../../src/backend/wasm/optimize.js"
	);
	const bytes = encodeModule(
		simdCompareModule([
			getA,
			getB,
			{ op: "f32x4.lt" },
			{ op: "v128.any_true" },
			getA,
			{ op: "f32x4.floor" },
			getB,
			{ op: "f32x4.nearest" },
			{ op: "f32x4.ceil" },
			{ op: "f32x4.trunc" },
			getA,
			getB,
			{ op: "f32x4.ge" },
			{ op: "v128.bitselect" },
			{ op: "f32x4.extract_lane", lane: 0 },
			{ op: "i32.trunc_f32_s" },
			{ op: "i32.add" },
		]),
	);
	for (const level of [0, 3]) {
		const res = optimizeWithBinaryen(bytes, { level });
		assert(WebAssembly.validate(res.wasm), `Binaryen -O${level} output valid`);
		const f = new WebAssembly.Instance(new WebAssembly.Module(res.wasm)).exports
			.f;
		const ref = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports
			.f;
		assertEqual(f(1.5, 2.5), ref(1.5, 2.5));
	}
});

section("WASM Backend — module layout");

test("compileWasm is exported from src/compiler.js", () => {
	assertEqual(typeof compileWasm, "function");
	const res = compileWasm("package main\nfunc main() {}\n");
	assertEqual(res.errors.length, 0);
	assert(res.wasm instanceof Uint8Array, "compileWasm returns wasm bytes");
});

test("wasm/index.js export list is unchanged", () => {
	assertArrayEqual(Object.keys(wasmIndex).sort(), [
		"compileWasmModule",
		"hasNativeWasmOpt",
		"isGoFrontWasm",
		"optimizeWasm",
	]);
	assertEqual(wasmIndex.hasNativeWasmOpt, hasNativeWasmOpt);
	assertEqual(wasmIndex.isGoFrontWasm, isGoFrontWasm);
	assertEqual(wasmIndex.optimizeWasm, optimizeWasm);
	assertEqual(typeof wasmIndex.compileWasmModule, "function");
});

test("wasm/index.js does not import the lexer, parser or typechecker", () => {
	const src = readFileSync(
		new URL("../../../src/backend/wasm/index.js", import.meta.url),
		"utf8",
	);
	for (const m of src.matchAll(/^import[^;]*?from\s+"([^"]+)";/gms)) {
		const spec = m[1];
		assert(!/lexer/.test(spec), `index.js must not import ${spec}`);
		assert(!/\/parser\//.test(spec), `index.js must not import ${spec}`);
		assert(
			!/typechecker\/index\.js$/.test(spec),
			`index.js must not import ${spec}`,
		);
	}
});
