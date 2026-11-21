// test/unit/wasm/data-section.test.js
// Passive data segments: the DataCount and Data sections, `array.new_data`,
// and their WAT form.

import {
	encodeModule,
	encodeU32LEB,
} from "../../../src/backend/wasm/encode.js";
import { ModuleEmitter } from "../../../src/backend/wasm/module-emitter.js";
import { emitWat } from "../../../src/backend/wasm/wat.js";
import { assert, assertEqual, section, test } from "../helpers.js";

// Section ids in module order (the header is 8 bytes).
function sectionIds(bytes) {
	const ids = [];
	let i = 8;
	while (i < bytes.length) {
		const id = bytes[i++];
		let size = 0;
		let shift = 0;
		for (;;) {
			const b = bytes[i++];
			size |= (b & 0x7f) << shift;
			if ((b & 0x80) === 0) break;
			shift += 7;
		}
		ids.push({ id, start: i, size });
		i += size;
	}
	return ids;
}

// The leading `gofront` custom section is left out.
const ids = (bytes) =>
	sectionIds(bytes)
		.map((s) => s.id)
		.slice(1);

// `get(i)`: byte `i` of a fresh `(array (mut i8))` copied from segment 0.
function moduleWith(data, extra = {}) {
	const len = data?.[0]?.bytes.length ?? 0;
	return {
		types: [
			{ form: "array", elemType: "i8", mutable: true },
			{ form: "func", params: ["i32"], results: ["i32"] },
		],
		funcs: [
			{
				typeIndex: 1,
				locals: [],
				body: [
					{ op: "i32.const", value: 0 },
					{ op: "i32.const", value: len },
					{ op: "array.new_data", typeIndex: 0, dataIndex: 0 },
					{ op: "local.get", index: 0 },
					{ op: "array.get_u", typeIndex: 0 },
				],
			},
		],
		exports: [{ name: "get", kind: "func", index: 0 }],
		data,
		...extra,
	};
}

section("WASM data section: encoding");

test("data-section: DataCount precedes code and Data follows it", () => {
	const bytes = encodeModule(moduleWith([{ bytes: [1, 2, 3] }]));
	const order = ids(bytes);
	assertEqual(order.join(), "1,3,7,12,10,11");
});

test("data-section: Data follows code before a trailing sourceMappingURL section", () => {
	const bytes = encodeModule(
		moduleWith([{ bytes: [1, 2, 3] }], { sourceMappingURL: "app.wasm.map" }),
	);
	assertEqual(ids(bytes).join(), "1,3,7,12,10,11,0");
});

test("data-section: segments are passive and carry their bytes", () => {
	const bytes = encodeModule(
		moduleWith([{ bytes: [9, 8, 7] }, { bytes: new Uint8Array([0, 255]) }]),
	);
	const data = sectionIds(bytes).find((s) => s.id === 11);
	const payload = [...bytes.slice(data.start, data.start + data.size)];
	assertEqual(
		JSON.stringify(payload),
		JSON.stringify([2, 1, 3, 9, 8, 7, 1, 2, 0, 255]),
	);
	const count = sectionIds(bytes).find((s) => s.id === 12);
	assertEqual(bytes[count.start], 2);
});

test("data-section: a segment longer than 127 bytes uses a multi-byte length", () => {
	const seg = Array.from({ length: 300 }, (_, i) => i & 255);
	const bytes = encodeModule(moduleWith([{ bytes: seg }]));
	const data = sectionIds(bytes).find((s) => s.id === 11);
	const head = [...bytes.slice(data.start, data.start + 4)];
	assertEqual(
		JSON.stringify(head),
		JSON.stringify([1, 1, ...encodeU32LEB(300)]),
	);
});

test("data-section: array.new_data is 0xfb 0x09 with type and data indexes", () => {
	const bytes = encodeModule(moduleWith([{ bytes: [1] }]));
	const code = sectionIds(bytes).find((s) => s.id === 10);
	const body = [...bytes.slice(code.start, code.start + code.size)];
	const at = body.findIndex((b, i) => b === 0xfb && body[i + 1] === 0x09);
	assert(at >= 0, "array.new_data not found");
	assertEqual(body[at + 2], 0);
	assertEqual(body[at + 3], 0);
});

test("data-section: both sections are omitted without segments", () => {
	const plain = encodeModule(moduleWith(undefined));
	assertEqual(ids(plain).join(), "1,3,7,10");
	const empty = encodeModule(moduleWith([]));
	assertEqual(ids(empty).join(), "1,3,7,10");
	assertEqual(empty.length, plain.length);
});

test("data-section: codeOffsets stay exact with a DataCount section before code", () => {
	const mod = moduleWith([{ bytes: [1, 2, 3] }], {
		sourceMappingURL: "app.wasm.map",
	});
	const bytes = encodeModule(mod);
	assertEqual(mod.codeOffsets.length, 1);
	// The body's first instruction is `i32.const 0`.
	assertEqual(bytes[mod.codeOffsets[0]], 0x41);
	assertEqual(bytes[mod.codeOffsets[0] + 1], 0x00);
});

section("WASM data section: execution");

test("data-section: WebAssembly.validate accepts passive segments and array.new_data", () => {
	const bytes = encodeModule(moduleWith([{ bytes: [10, 20, 255] }]));
	assert(WebAssembly.validate(bytes), "module must validate");
	const { exports } = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(exports.get(0), 10);
	assertEqual(exports.get(1), 20);
	assertEqual(exports.get(2), 255);
});

test("data-section: each array.new_data builds a fresh array", () => {
	// `(array (mut i8))` copy, mutate it, copy again: the segment is untouched.
	const mod = {
		types: [
			{ form: "array", elemType: "i8", mutable: true },
			{ form: "func", params: [], results: ["i32"] },
		],
		funcs: [
			{
				typeIndex: 1,
				locals: [{ type: { kind: "ref", nullable: true, typeIndex: 0 } }],
				body: [
					{ op: "i32.const", value: 0 },
					{ op: "i32.const", value: 2 },
					{ op: "array.new_data", typeIndex: 0, dataIndex: 0 },
					{ op: "local.tee", index: 0 },
					{ op: "i32.const", value: 0 },
					{ op: "i32.const", value: 99 },
					{ op: "array.set", typeIndex: 0 },
					{ op: "i32.const", value: 0 },
					{ op: "i32.const", value: 2 },
					{ op: "array.new_data", typeIndex: 0, dataIndex: 0 },
					{ op: "i32.const", value: 0 },
					{ op: "array.get_u", typeIndex: 0 },
				],
			},
		],
		exports: [{ name: "first", kind: "func", index: 0 }],
		data: [{ bytes: [5, 6] }],
	};
	const bytes = encodeModule(mod);
	assert(WebAssembly.validate(bytes), "module must validate");
	const { exports } = new WebAssembly.Instance(new WebAssembly.Module(bytes));
	assertEqual(exports.first(), 5);
});

section("WASM data section: WAT");

test("data-section: --emit-wat prints segments and array.new_data", () => {
	const wat = emitWat(
		moduleWith([{ bytes: [0x68, 0x69, 0x00, 0x22, 0x5c, 0xff] }]),
	);
	assert(wat.includes('(data $d0 "hi\\00\\22\\5c\\ff")'), wat);
	assert(wat.includes("array.new_data $t0 $d0"), wat);
});

test("data-section: WAT has no data lines without segments", () => {
	assert(!emitWat(moduleWith(undefined)).includes("(data"));
});

section("WASM data section: module emitter");

test("data-section: equal contents share one segment", () => {
	const mod = new ModuleEmitter(null);
	const a = mod.internData(new Uint8Array([1, 2, 3]));
	const b = mod.internData([4]);
	assertEqual(mod.internData([1, 2, 3]), a);
	assertEqual(mod.internData(new Uint8Array([4])), b);
	assertEqual(mod.data.length, 2);
	assertEqual(a, 0);
	assertEqual(b, 1);
});
