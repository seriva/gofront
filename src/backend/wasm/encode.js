// src/backend/wasm/encode.js
// Dependency-free WebAssembly binary encoder (Wasm 2.0, WasmGC, Exception Handling).

// ── LEB128 & Primitive Encoders ──────────────────────────────

export function encodeU32LEB(val) {
	let v = val >>> 0;
	const bytes = [];
	do {
		let byte = v & 0x7f;
		v >>>= 7;
		if (v !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (v !== 0);
	return bytes;
}

export function encodeI32LEB(val) {
	let v = val | 0;
	const bytes = [];
	let more = true;
	while (more) {
		let byte = v & 0x7f;
		v >>= 7;
		if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
			more = false;
		} else {
			byte |= 0x80;
		}
		bytes.push(byte);
	}
	return bytes;
}

export function encodeI64LEB(val) {
	let v = BigInt.asIntN(64, typeof val === "bigint" ? val : BigInt(val));
	const bytes = [];
	let more = true;
	while (more) {
		let byte = Number(v & 0x7fn);
		v >>= 7n;
		if (
			(v === 0n && (byte & 0x40) === 0) ||
			(v === -1n && (byte & 0x40) !== 0)
		) {
			more = false;
		} else {
			byte |= 0x80;
		}
		bytes.push(byte);
	}
	return bytes;
}

export function encodeF32(val) {
	const buf = new ArrayBuffer(4);
	new DataView(buf).setFloat32(0, Number(val), true); // little-endian
	return Array.from(new Uint8Array(buf));
}

export function encodeF64(val) {
	const buf = new ArrayBuffer(8);
	new DataView(buf).setFloat64(0, Number(val), true); // little-endian
	return Array.from(new Uint8Array(buf));
}

export function encodeString(str) {
	const utf8 = new TextEncoder().encode(str);
	return [...encodeU32LEB(utf8.length), ...utf8];
}

export function encodeVector(items, encodeItem) {
	const count = encodeU32LEB(items.length);
	const bytes = [];
	for (const item of items) {
		const chunk = encodeItem(item);
		for (let i = 0; i < chunk.length; i++) {
			bytes.push(chunk[i]);
		}
	}
	return [...count, ...bytes];
}

// ── Value Types & Heap Types ─────────────────────────────────

export const ValType = {
	i32: 0x7f,
	i64: 0x7e,
	f32: 0x7d,
	f64: 0x7c,
	v128: 0x7b,
	i8: 0x7a,
	i16: 0x79,
	funcref: 0x70,
	externref: 0x6f,
	anyref: 0x6e,
	eqref: 0x6d,
	i31ref: 0x6c,
	structref: 0x6b,
	arrayref: 0x6a,
	nullref: 0x71,
	nullfuncref: 0x73,
	nullexternref: 0x72,
};

export function encodeValType(type) {
	if (typeof type === "number") {
		return [type];
	}
	if (typeof type === "string") {
		if (ValType[type] !== undefined) return [ValType[type]];
		throw new Error(`Unknown value type: ${type}`);
	}
	if (typeof type === "object" && type !== null) {
		if (type.kind === "ref") {
			const opcode = type.nullable ? 0x63 : 0x64;
			if (typeof type.typeIndex === "number") {
				return [opcode, ...encodeI32LEB(type.typeIndex)];
			}
			if (typeof type.heapType === "string") {
				const ht = ValType[type.heapType] ?? ValType[`${type.heapType}ref`];
				if (ht !== undefined) return [opcode, ht];
			}
			if (typeof type.heapType === "number") {
				return [opcode, ...encodeI32LEB(type.heapType)];
			}
		}
	}
	throw new Error(`Invalid valtype specification: ${JSON.stringify(type)}`);
}

export function encodeBlockType(blockType) {
	if (!blockType || blockType === "void") {
		return [0x40];
	}
	if (typeof blockType === "string") {
		return encodeValType(blockType);
	}
	if (typeof blockType === "number") {
		// Type index for multi-value block: signed LEB128
		return encodeI32LEB(blockType);
	}
	return encodeValType(blockType);
}

// ── Instruction Encoders ─────────────────────────────────────

const OPCODES = {
	unreachable: 0x00,
	nop: 0x01,
	block: 0x02,
	loop: 0x03,
	if: 0x04,
	else: 0x05,
	throw: 0x08,
	end: 0x0b,
	br: 0x0c,
	br_if: 0x0d,
	br_table: 0x0e,
	return: 0x0f,
	call: 0x10,
	call_indirect: 0x11,
	return_call: 0x12,
	return_call_indirect: 0x13,
	call_ref: 0x14,
	return_call_ref: 0x15,
	drop: 0x1a,
	select: 0x1b,

	"local.get": 0x20,
	"local.set": 0x21,
	"local.tee": 0x22,
	"global.get": 0x23,
	"global.set": 0x24,

	"i32.const": 0x41,
	"i64.const": 0x42,
	"f32.const": 0x43,
	"f64.const": 0x44,

	"i32.eqz": 0x45,
	"i32.eq": 0x46,
	"i32.ne": 0x47,
	"i32.lt_s": 0x48,
	"i32.lt_u": 0x49,
	"i32.gt_s": 0x4a,
	"i32.gt_u": 0x4b,
	"i32.le_s": 0x4c,
	"i32.le_u": 0x4d,
	"i32.ge_s": 0x4e,
	"i32.ge_u": 0x4f,

	"i64.eqz": 0x50,
	"i64.eq": 0x51,
	"i64.ne": 0x52,
	"i64.lt_s": 0x53,
	"i64.lt_u": 0x54,
	"i64.gt_s": 0x55,
	"i64.gt_u": 0x56,
	"i64.le_s": 0x57,
	"i64.le_u": 0x58,
	"i64.ge_s": 0x59,
	"i64.ge_u": 0x5a,

	"f32.eq": 0x5b,
	"f32.ne": 0x5c,
	"f32.lt": 0x5d,
	"f32.gt": 0x5e,
	"f32.le": 0x5f,
	"f32.ge": 0x60,

	"f64.eq": 0x61,
	"f64.ne": 0x62,
	"f64.lt": 0x63,
	"f64.gt": 0x64,
	"f64.le": 0x65,
	"f64.ge": 0x66,

	"i32.clz": 0x67,
	"i32.ctz": 0x68,
	"i32.popcnt": 0x69,
	"i32.add": 0x6a,
	"i32.sub": 0x6b,
	"i32.mul": 0x6c,
	"i32.div_s": 0x6d,
	"i32.div_u": 0x6e,
	"i32.rem_s": 0x6f,
	"i32.rem_u": 0x70,
	"i32.and": 0x71,
	"i32.or": 0x72,
	"i32.xor": 0x73,
	"i32.shl": 0x74,
	"i32.shr_s": 0x75,
	"i32.shr_u": 0x76,
	"i32.rotl": 0x77,
	"i32.rotr": 0x78,

	"i64.clz": 0x79,
	"i64.ctz": 0x7a,
	"i64.popcnt": 0x7b,
	"i64.add": 0x7c,
	"i64.sub": 0x7d,
	"i64.mul": 0x7e,
	"i64.div_s": 0x7f,
	"i64.div_u": 0x80,
	"i64.rem_s": 0x81,
	"i64.rem_u": 0x82,
	"i64.and": 0x83,
	"i64.or": 0x84,
	"i64.xor": 0x85,
	"i64.shl": 0x86,
	"i64.shr_s": 0x87,
	"i64.shr_u": 0x88,
	"i64.rotl": 0x89,
	"i64.rotr": 0x8a,

	"f32.abs": 0x8b,
	"f32.neg": 0x8c,
	"f32.ceil": 0x8d,
	"f32.floor": 0x8e,
	"f32.trunc": 0x8f,
	"f32.nearest": 0x90,
	"f32.sqrt": 0x91,
	"f32.add": 0x92,
	"f32.sub": 0x93,
	"f32.mul": 0x94,
	"f32.div": 0x95,
	"f32.min": 0x96,
	"f32.max": 0x97,
	"f32.copysign": 0x98,

	"f64.abs": 0x99,
	"f64.neg": 0x9a,
	"f64.ceil": 0x9b,
	"f64.floor": 0x9c,
	"f64.trunc": 0x9d,
	"f64.nearest": 0x9e,
	"f64.sqrt": 0x9f,
	"f64.add": 0xa0,
	"f64.sub": 0xa1,
	"f64.mul": 0xa2,
	"f64.div": 0xa3,
	"f64.min": 0xa4,
	"f64.max": 0xa5,
	"f64.copysign": 0xa6,

	"i32.wrap_i64": 0xa7,
	"i32.trunc_f32_s": 0xa8,
	"i32.trunc_f32_u": 0xa9,
	"i32.trunc_f64_s": 0xaa,
	"i32.trunc_f64_u": 0xab,
	"i64.extend_i32_s": 0xac,
	"i64.extend_i32_u": 0xad,
	"i64.trunc_f32_s": 0xae,
	"i64.trunc_f32_u": 0xaf,
	"i64.trunc_f64_s": 0xb0,
	"i64.trunc_f64_u": 0xb1,
	"f32.convert_i32_s": 0xb2,
	"f32.convert_i32_u": 0xb3,
	"f32.convert_i64_s": 0xb4,
	"f32.convert_i64_u": 0xb5,
	"f32.demote_f64": 0xb6,
	"f64.convert_i32_s": 0xb7,
	"f64.convert_i32_u": 0xb8,
	"f64.convert_i64_s": 0xb9,
	"f64.convert_i64_u": 0xba,
	"f64.promote_f32": 0xbb,
	"i32.reinterpret_f32": 0xbc,
	"i64.reinterpret_f64": 0xbd,
	"f32.reinterpret_i32": 0xbe,
	"f64.reinterpret_i64": 0xbf,

	"i32.extend8_s": 0xc0,
	"i32.extend16_s": 0xc1,
	"i64.extend8_s": 0xc2,
	"i64.extend16_s": 0xc3,
	"i64.extend32_s": 0xc4,

	"ref.null": 0xd0,
	"ref.is_null": 0xd1,
	"ref.func": 0xd2,
	"ref.eq": 0xd3,
	"ref.as_non_null": 0xd4,
};

// 0xFC prefixed saturating truncations
const SAT_TRUNC_OPCODES = {
	"i32.trunc_sat_f32_s": 0x00,
	"i32.trunc_sat_f32_u": 0x01,
	"i32.trunc_sat_f64_s": 0x02,
	"i32.trunc_sat_f64_u": 0x03,
	"i64.trunc_sat_f32_s": 0x04,
	"i64.trunc_sat_f32_u": 0x05,
	"i64.trunc_sat_f64_s": 0x06,
	"i64.trunc_sat_f64_u": 0x07,
};

// 0xFB prefixed WasmGC instructions
const GC_OPCODES = {
	"struct.new": 0x00,
	"struct.new_default": 0x01,
	"struct.get": 0x02,
	"struct.get_s": 0x03,
	"struct.get_u": 0x04,
	"struct.set": 0x05,
	"array.new": 0x06,
	"array.new_default": 0x07,
	"array.new_fixed": 0x08,
	"array.get": 0x0b,
	"array.get_s": 0x0c,
	"array.get_u": 0x0d,
	"array.set": 0x0e,
	"array.len": 0x0f,
	"array.copy": 0x11,
	"ref.test": 0x14,
	"ref.test_null": 0x15,
	"ref.cast": 0x16,
	"ref.cast_null": 0x17,
	"any.convert_extern": 0x1a,
	"extern.convert_any": 0x1b,
};

export function encodeInstruction(inst) {
	if (typeof inst === "string") {
		inst = { op: inst };
	}
	const { op } = inst;

	// 1. Check saturating truncations (0xFC prefix)
	if (SAT_TRUNC_OPCODES[op] !== undefined) {
		return [0xfc, ...encodeU32LEB(SAT_TRUNC_OPCODES[op])];
	}

	// 2. Check WasmGC opcodes (0xFB prefix)
	if (GC_OPCODES[op] !== undefined) {
		const subOp = GC_OPCODES[op];
		const bytes = [0xfb, ...encodeU32LEB(subOp)];
		if (op === "array.copy") {
			bytes.push(...encodeU32LEB(inst.typeIndexDst ?? inst.typeIndex ?? 0));
			bytes.push(...encodeU32LEB(inst.typeIndexSrc ?? inst.typeIndex ?? 0));
			return bytes;
		}
		if (op === "array.new_fixed") {
			bytes.push(...encodeU32LEB(inst.typeIndex ?? 0));
			bytes.push(...encodeU32LEB(inst.size ?? inst.count ?? 0));
			return bytes;
		}
		if (
			op === "array.len" ||
			op === "any.convert_extern" ||
			op === "extern.convert_any"
		) {
			return bytes;
		}
		if (inst.typeIndex !== undefined) {
			bytes.push(...encodeU32LEB(inst.typeIndex));
		}
		if (inst.fieldIndex !== undefined) {
			bytes.push(...encodeU32LEB(inst.fieldIndex));
		}
		return bytes;
	}

	// 3. Standard opcodes
	if (OPCODES[op] !== undefined) {
		const byte = OPCODES[op];
		switch (op) {
			case "block":
			case "loop":
			case "if":
				return [byte, ...encodeBlockType(inst.blockType ?? inst.resultType)];

			case "br":
			case "br_if":
				return [byte, ...encodeU32LEB(inst.depth ?? inst.index ?? 0)];

			case "br_table": {
				const targets = inst.targets ?? [];
				const defaultTarget = inst.defaultTarget ?? 0;
				const count = encodeU32LEB(targets.length);
				const targetBytes = targets.flatMap((t) => encodeU32LEB(t));
				return [byte, ...count, ...targetBytes, ...encodeU32LEB(defaultTarget)];
			}

			case "throw":
				return [byte, ...encodeU32LEB(inst.tagIndex ?? inst.index ?? 0)];

			case "call":
			case "return_call":
				return [byte, ...encodeU32LEB(inst.funcIndex ?? inst.index ?? 0)];

			case "call_indirect":
			case "return_call_indirect":
				return [
					byte,
					...encodeU32LEB(inst.typeIndex ?? 0),
					...encodeU32LEB(inst.tableIndex ?? 0),
				];

			case "call_ref":
			case "return_call_ref":
				return [byte, ...encodeU32LEB(inst.typeIndex ?? 0)];

			case "ref.func":
				return [byte, ...encodeU32LEB(inst.funcIndex ?? inst.index ?? 0)];

			case "local.get":
			case "local.set":
			case "local.tee":
				return [byte, ...encodeU32LEB(inst.localIndex ?? inst.index ?? 0)];

			case "global.get":
			case "global.set":
				return [byte, ...encodeU32LEB(inst.globalIndex ?? inst.index ?? 0)];

			case "i32.const":
				return [byte, ...encodeI32LEB(inst.value ?? 0)];

			case "i64.const":
				return [byte, ...encodeI64LEB(inst.value ?? 0n)];

			case "f32.const":
				return [byte, ...encodeF32(inst.value ?? 0)];

			case "f64.const":
				return [byte, ...encodeF64(inst.value ?? 0)];

			case "ref.null": {
				const ht =
					inst.heapType !== undefined
						? inst.heapType
						: inst.typeIndex !== undefined
							? inst.typeIndex
							: "any";
				if (typeof ht === "number") {
					return [byte, ...encodeI32LEB(ht)];
				}
				const code = ValType[ht] ?? ValType[`${ht}ref`] ?? 0x6e;
				return [byte, code];
			}

			default:
				return [byte];
		}
	}

	throw new Error(`Unsupported WASM instruction opcode: '${op}'`);
}

// ── Section Encoders ─────────────────────────────────────────

function encodeSection(id, payload) {
	if (payload.length === 0) return [];
	return [id, ...encodeU32LEB(payload.length), ...payload];
}

export function encodeTypeEntry(t) {
	if (t.form === "rec") {
		// Recursive type group: 0x4E, count, types
		const count = encodeU32LEB(t.types.length);
		const innerBytes = t.types.flatMap((sub) => encodeTypeEntry(sub));
		return [0x4e, ...count, ...innerBytes];
	}

	if (t.form === "struct") {
		// Struct type: 0x5F, vector of fields [valtype, mutability]
		const fields = t.fields ?? [];
		return [
			0x5f,
			...encodeVector(fields, (f) => [
				...encodeValType(f.type),
				f.mutable ? 0x01 : 0x00,
			]),
		];
	}

	if (t.form === "array") {
		// Array type: 0x5E, field [valtype, mutability]
		return [
			0x5e,
			...encodeValType(t.elemType ?? t.type),
			t.mutable ? 0x01 : 0x00,
		];
	}

	// Function type: 0x60, params vector, results vector
	const params = t.params ?? [];
	const results = t.results ?? [];
	return [
		0x60,
		...encodeVector(params, encodeValType),
		...encodeVector(results, encodeValType),
	];
}

export function encodeTypeSection(types) {
	if (!types || types.length === 0) return [];
	return encodeSection(1, encodeVector(types, encodeTypeEntry));
}

export function encodeImportSection(imports) {
	if (!imports || imports.length === 0) return [];
	return encodeSection(
		2,
		encodeVector(imports, (imp) => {
			const mod = encodeString(imp.module);
			const name = encodeString(imp.name);
			let desc = [];
			switch (imp.kind) {
				case "func":
					desc = [0x00, ...encodeU32LEB(imp.typeIndex ?? 0)];
					break;
				case "table":
					desc = [
						0x01,
						...encodeValType(imp.elemType ?? "funcref"),
						imp.max !== undefined ? 0x01 : 0x00,
						...encodeU32LEB(imp.min ?? 0),
						...(imp.max !== undefined ? encodeU32LEB(imp.max) : []),
					];
					break;
				case "memory":
					desc = [
						0x02,
						imp.max !== undefined ? 0x01 : 0x00,
						...encodeU32LEB(imp.min ?? 1),
						...(imp.max !== undefined ? encodeU32LEB(imp.max) : []),
					];
					break;
				case "global":
					desc = [0x03, ...encodeValType(imp.type), imp.mutable ? 0x01 : 0x00];
					break;
				case "tag":
					desc = [0x04, 0x00, ...encodeU32LEB(imp.typeIndex ?? 0)];
					break;
				default:
					throw new Error(`Unknown import kind: ${imp.kind}`);
			}
			return [...mod, ...name, ...desc];
		}),
	);
}

export function encodeFunctionSection(funcs) {
	if (!funcs || funcs.length === 0) return [];
	return encodeSection(
		3,
		encodeVector(funcs, (fn) => encodeU32LEB(fn.typeIndex ?? 0)),
	);
}

export function encodeTagSection(tags) {
	if (!tags || tags.length === 0) return [];
	return encodeSection(
		13,
		encodeVector(tags, (tag) => [0x00, ...encodeU32LEB(tag.typeIndex ?? 0)]),
	);
}

export function encodeGlobalSection(globals) {
	if (!globals || globals.length === 0) return [];
	return encodeSection(
		6,
		encodeVector(globals, (g) => {
			const typeBytes = encodeValType(g.type);
			const mutByte = g.mutable ? 0x01 : 0x00;
			const initInsts = g.init ?? [{ op: "i32.const", value: 0 }];
			const exprBytes = [];
			for (const inst of initInsts) {
				const chunk = encodeInstruction(inst);
				for (let i = 0; i < chunk.length; i++) exprBytes.push(chunk[i]);
			}
			if (
				initInsts.length === 0 ||
				initInsts[initInsts.length - 1].op !== "end"
			) {
				exprBytes.push(0x0b);
			}
			return [...typeBytes, mutByte, ...exprBytes];
		}),
	);
}

export function encodeExportSection(exports) {
	if (!exports || exports.length === 0) return [];
	return encodeSection(
		7,
		encodeVector(exports, (exp) => {
			const name = encodeString(exp.name);
			let kindByte = 0x00;
			switch (exp.kind) {
				case "func":
					kindByte = 0x00;
					break;
				case "table":
					kindByte = 0x01;
					break;
				case "memory":
					kindByte = 0x02;
					break;
				case "global":
					kindByte = 0x03;
					break;
				case "tag":
					kindByte = 0x04;
					break;
				default:
					throw new Error(`Unknown export kind: ${exp.kind}`);
			}
			return [...name, kindByte, ...encodeU32LEB(exp.index ?? 0)];
		}),
	);
}

function sameValType(a, b) {
	if (a === b) return true;
	if (
		typeof a === "object" &&
		typeof b === "object" &&
		a !== null &&
		b !== null
	) {
		return (
			a.kind === b.kind &&
			a.nullable === b.nullable &&
			a.typeIndex === b.typeIndex &&
			a.heapType === b.heapType
		);
	}
	return false;
}

export function encodeElementSection(elements) {
	if (!elements || elements.length === 0) return [];
	const segment = [0x03, 0x00, ...encodeVector(elements, encodeU32LEB)];
	return encodeSection(
		9,
		encodeVector([segment], (bytes) => bytes),
	);
}

export function encodeCodeSection(funcs) {
	if (!funcs || funcs.length === 0) return [];
	return encodeSection(
		10,
		encodeVector(funcs, (fn) => {
			// Compress locals: [type1, type1, type2] -> [{ count: 2, type: type1 }, { count: 1, type: type2 }]
			const rawLocals = fn.locals ?? [];
			const compressedLocals = [];
			for (const loc of rawLocals) {
				const locType =
					typeof loc === "string"
						? loc
						: loc.type !== undefined
							? loc.type
							: loc;
				if (
					compressedLocals.length > 0 &&
					sameValType(
						compressedLocals[compressedLocals.length - 1].type,
						locType,
					)
				) {
					compressedLocals[compressedLocals.length - 1].count++;
				} else {
					compressedLocals.push({ count: 1, type: locType });
				}
			}

			const localsBytes = encodeVector(compressedLocals, (group) => [
				...encodeU32LEB(group.count),
				...encodeValType(group.type),
			]);

			const bodyInsts = fn.body ?? [];
			const bodyBytes = [];
			for (const inst of bodyInsts) {
				const chunk = encodeInstruction(inst);
				for (let i = 0; i < chunk.length; i++) bodyBytes.push(chunk[i]);
			}
			// Ensure terminating end opcode (0x0B)
			if (
				bodyInsts.length === 0 ||
				bodyInsts[bodyInsts.length - 1].op !== "end"
			) {
				bodyBytes.push(0x0b);
			}

			const fullBody = [...localsBytes, ...bodyBytes];
			return [...encodeU32LEB(fullBody.length), ...fullBody];
		}),
	);
}

// ── Top-level Module Encoder ─────────────────────────────────

// Custom section placed right after the header; `isGoFrontWasm` keys off it.
export const GOFRONT_SECTION_NAME = "gofront";
const GOFRONT_SECTION_BYTES = [
	0x00,
	...encodeU32LEB(1 + GOFRONT_SECTION_NAME.length),
	...encodeString(GOFRONT_SECTION_NAME),
];

// True when `bytes` start with the wasm header followed by our custom section.
export function isGoFrontWasm(bytes) {
	const expected = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
	expected.push(...GOFRONT_SECTION_BYTES);
	if (!bytes || bytes.length < expected.length) return false;
	for (let i = 0; i < expected.length; i++) {
		if (bytes[i] !== expected[i]) return false;
	}
	return true;
}

export function encodeModule(mod) {
	const magic = [0x00, 0x61, 0x73, 0x6d]; // \0asm
	const version = [0x01, 0x00, 0x00, 0x00]; // version 1

	const typeSec = encodeTypeSection(mod.types);
	const importSec = encodeImportSection(mod.imports);
	const funcSec = encodeFunctionSection(mod.funcs);
	const tagSec = encodeTagSection(mod.tags);
	const globalSec = encodeGlobalSection(mod.globals);
	const exportSec = encodeExportSection(mod.exports);
	const startSec =
		typeof mod.start === "number"
			? encodeSection(8, encodeU32LEB(mod.start))
			: [];
	const elemSec = encodeElementSection(mod.elements);
	const codeSec = encodeCodeSection(mod.funcs);

	const allBytes = [
		...magic,
		...version,
		...GOFRONT_SECTION_BYTES,
		...typeSec,
		...importSec,
		...funcSec,
		...tagSec,
		...globalSec,
		...exportSec,
		...startSec,
		...elemSec,
		...codeSec,
	];

	return new Uint8Array(allBytes);
}
