// src/backend/wasm/boundary.js
// JS <-> WASM boundary: type classification, marshalling helpers (WASM IR)
// and the generated JS facade that exposes a wasm package to JS callers.
//
// Boundary v1 rules (docs/v1.5.0/wasm-mvp-plan.md, Phase 5):
//   - primitives: bool <-> i32, narrow ints <-> i32, int/int64 <-> f64 at the
//     boundary (i64 inside; exact for |v| <= 2^53, which the facade already
//     enforces, and keeps BigInt boxing off hot paths), floats direct,
//     string externref, any anyref (crossing as externref).
//   - every GC reference (struct/array/closure/anyref) crosses as externref
//     and exports are bound to module-level consts: V8 only inlines JS->wasm
//     calls (floats unboxed) for const callees with i32/i64/f32/f64/externref
//     signatures outside try/catch.  Panics are raised through `env.panic`
//     (a JS Error) rather than a wasm `throw`, so no guard wrapper is needed.
//   - struct values from `both` packages: copied field-by-field into the JS
//     copy class (`new T(...)`); `*T` params are copied in and written back.
//   - struct values from `wasm` packages: opaque handles with stable identity
//     (class `T` wrapping the WasmGC ref, WeakMap keyed registry).
//   - slices / arrays: element-wise copy (plain JS arrays on the JS side,
//     TypedArray inputs accepted). No copy-back for slices.
//   - func values: JS callbacks wrapped into wasm closures via thunks; wasm
//     closures exposed to JS as callable functions.
//   - maps, non-empty interfaces, error, pointers to non-structs: rejected
//     with a compile error (planned for a later boundary version).
//   - `*testing.T`: the harness's JS test object, passed as an opaque
//     externref (test methods are routed back to JS via `env.testing_*`).

import { isTestingT } from "./types.js";

// ── Type classification ──────────────────────────────────────

const I32_INTS = new Set([
	"int8",
	"int16",
	"int32",
	"uint8",
	"uint16",
	"uint32",
	"byte",
	"rune",
]);
const I64_INTS = new Set(["int", "uint", "int64", "uint64", "uintptr"]);
const UNSIGNED = new Set([
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
	"byte",
]);

export function wTypeKey(wType) {
	if (typeof wType === "string") return wType;
	if (wType && typeof wType.typeIndex === "number")
		return `r${wType.typeIndex}`;
	return `h${wType?.heapType ?? "any"}`;
}

function toRef(info) {
	return { kind: "ref", nullable: true, typeIndex: info.typeIndex };
}

function structDesc(info, ptr) {
	return { k: "struct", name: info.name, ptr, info, wType: toRef(info) };
}

function funcSigFromAst(t) {
	return {
		kind: "func",
		params: (t.params ?? []).map((p) => p.type ?? p),
		returns: t.returnType
			? t.returnType.kind === "TupleType" || t.returnType.kind === "tuple"
				? t.returnType.types
				: [t.returnType]
			: [],
	};
}

// Classifies a Go type (AST node or checker type) for boundary marshalling.
// Returns a descriptor `{ k, ... }`; `k === "unsupported"` carries `what`.
export function classifyType(goType, mod) {
	if (!goType) return { k: "void" };
	if (isTestingT(goType)) return { k: "extern", wType: "externref" };

	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const info = mod.getStructType(goType.name);
		if (info) return structDesc(info, false);
		const resolved = mod.checker?.types?.get(goType.name);
		if (resolved) return classifyType(resolved, mod);
		return classifyBasic(goType.name);
	}

	const t = normalizeAstType(goType);
	switch (t.kind) {
		case "named":
			return classifyNamed(t, mod);
		case "untyped":
			return classifyBasic(t.base);
		case "basic":
			return classifyBasic(t.name);
		case "pointer":
			return classifyPointer(t, mod);
		case "slice":
			return classifySlice(t, mod);
		case "array":
			return classifyArray(t, mod);
		case "func":
			return classifyFunc(t, mod);
		case "interface":
			return classifyInterface(t);
		default:
			return {
				k: "unsupported",
				what: UNSUPPORTED_KINDS[t.kind] ?? `type kind '${t.kind}'`,
			};
	}
}

const UNSUPPORTED_KINDS = {
	map: "map",
	MapType: "map",
	struct: "anonymous struct",
	StructType: "anonymous struct",
	InterfaceType: "interface",
	ChanType: "chan",
	chan: "chan",
};

// Maps parser AST type nodes onto the checker's type shapes.
function normalizeAstType(t) {
	switch (t.kind) {
		case "PointerType":
		case "StarExpr":
			return { kind: "pointer", base: t.base ?? t.expr ?? t.operand };
		case "SliceType":
			return { kind: "slice", elem: t.elem };
		case "ArrayType":
			return { kind: "array", elem: t.elem, size: t.size };
		case "FuncType":
			return funcSigFromAst(t);
		case "InterfaceType":
			return {
				kind: "interface",
				name: t.name,
				methods: new Set((t.methods ?? []).map((m) => m.name ?? m)),
			};
		default:
			return t;
	}
}

const BASIC_DESCS = {
	void: { k: "void" },
	bool: { k: "bool", wType: "i32" },
	float32: { k: "f32", wType: "f32" },
	float64: { k: "f64", wType: "f64" },
	string: { k: "string", wType: "externref" },
	any: { k: "any", wType: "anyref" },
	error: { k: "unsupported", what: "error" },
};

function classifyBasic(n) {
	if (I32_INTS.has(n))
		return { k: "i32", unsigned: UNSIGNED.has(n), wType: "i32" };
	if (I64_INTS.has(n))
		return { k: "i64", unsigned: UNSIGNED.has(n), wType: "i64" };
	const d = BASIC_DESCS[n];
	return d ? { ...d } : { k: "unsupported", what: `type '${n}'` };
}

function classifyNamed(t, mod) {
	const info = mod.getStructType(t.name);
	if (info) return structDesc(info, false);
	if (t.underlying) return classifyType(t.underlying, mod);
	return { k: "unsupported", what: `named type '${t.name}'` };
}

function classifyPointer(t, mod) {
	const base = classifyType(t.base, mod);
	if (base.k === "struct" && !base.ptr) return { ...base, ptr: true };
	const what = base.k === "unsupported" ? base.what : (t.base?.name ?? base.k);
	return { k: "unsupported", what: `pointer to ${what}` };
}

function classifySlice(t, mod) {
	const elem = classifyType(t.elem, mod);
	if (elem.k === "unsupported") return elem;
	const sliceInfo = mod.getSliceType(t.elem);
	return {
		k: "slice",
		elem,
		sliceInfo,
		key: wTypeKey(sliceInfo.elemWType),
		wType: { kind: "ref", nullable: true, typeIndex: sliceInfo.typeIndex },
	};
}

function arraySize(t) {
	if (typeof t.size === "number") return t.size;
	if (t.size?.value !== undefined) return Number(t.size.value);
	return t.len ?? 0;
}

function classifyArray(t, mod) {
	const elem = classifyType(t.elem, mod);
	if (elem.k === "unsupported") return elem;
	const arrInfo = mod.getArrayType(t.elem);
	return {
		k: "array",
		elem,
		size: arraySize(t),
		arrInfo,
		key: wTypeKey(arrInfo.elemWType),
		wType: { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex },
	};
}

function classifyFunc(t, mod) {
	const params = (t.params ?? []).map((p) => classifyType(p, mod));
	const returns = (t.returns ?? [])
		.map((r) => classifyType(r, mod))
		.filter((d) => d.k !== "void");
	const bad = [...params, ...returns].find((d) => d.k === "unsupported");
	if (bad) return bad;
	const closureInfo = mod.getClosureType(t);
	return {
		k: "func",
		params,
		returns,
		closureInfo,
		key: `c${closureInfo.typeIndex}`,
		wType: { kind: "ref", nullable: true, typeIndex: closureInfo.typeIndex },
	};
}

function classifyInterface(t) {
	if (t.name === "error") return { k: "unsupported", what: "error" };
	if (!t.methods || t.methods.size === 0) return { k: "any", wType: "anyref" };
	return {
		k: "unsupported",
		what: `interface${t.name ? ` '${t.name}'` : ""}`,
	};
}

// ── Export metadata ──────────────────────────────────────────

function isExported(name) {
	return name[0] >= "A" && name[0] <= "Z";
}

function returnDescs(returnType, mod) {
	if (!returnType) return [];
	const list =
		returnType.kind === "TupleType" || returnType.kind === "tuple"
			? returnType.types
			: [returnType];
	return list.map((t) => classifyType(t, mod)).filter((d) => d.k !== "void");
}

function literalConst(spec, i) {
	let node = spec.value?.[i];
	let sign = "";
	if (node?.kind === "UnaryExpr" && node.op === "-" && node.operand) {
		node = node.operand;
		sign = "-";
	}
	if (node?.kind !== "BasicLit") return null;
	switch (node.litKind) {
		case "INT":
		case "FLOAT":
			return `${sign}${node.value}`;
		case "STRING":
			return JSON.stringify(String(node.value));
		case "BOOL":
			return node.value === "true" ? "true" : "false";
		default:
			return null;
	}
}

function unsupportedMsg(where, what) {
	return `${where}: ${what} is not yet supported across the wasm boundary (planned)`;
}

// Builds the boundary metadata for every exported symbol of `wasm`-target
// packages (plus struct descriptors of `both` packages they expose).
// Throws a compile error for unsupported boundary types.
export function collectBoundaryMeta(progs, funcDecls, mod) {
	const meta = {
		structs: [],
		funcs: [],
		consts: [],
		structByName: new Map(),
		_mod: mod,
	};
	const errors = [];

	for (const p of progs) {
		const pkgName = p.pkg?.name ?? "main";
		const pkgTarget = p.target ?? "wasm";
		for (const d of p.decls ?? []) {
			if (d.kind === "TypeDecl" && d.type?.kind === "StructType") {
				collectStructDecl(d, pkgName, pkgTarget, meta, mod);
			} else if (d.kind === "ConstDecl" && pkgTarget === "wasm") {
				collectConstDecl(d, pkgName, meta, errors);
			}
		}
	}

	for (const fn of funcDecls) {
		if (fn._isClosure || fn._pkgTarget !== "wasm") continue;
		if (fn._isMethod) collectMethodMeta(fn, meta, errors, mod);
		else collectFuncMeta(fn, meta, errors, mod);
	}

	if (errors.length > 0) throw new Error([...new Set(errors)].join("\n"));
	return meta;
}

function collectStructDecl(d, pkgName, pkgTarget, meta, mod) {
	if (!isExported(d.name) || meta.structByName.has(d.name)) return;
	const info = mod.getStructType(d.name);
	if (!info) return;
	const s = { name: d.name, pkgName, pkgTarget, info, methods: [] };
	meta.structs.push(s);
	meta.structByName.set(d.name, s);
}

function collectConstDecl(d, pkgName, meta, errors) {
	for (const spec of d.decls ?? []) {
		for (let i = 0; i < spec.names.length; i++) {
			const name = spec.names[i];
			if (!isExported(name)) continue;
			const value = literalConst(spec, i);
			if (value !== null) meta.consts.push({ name, value });
			else
				errors.push(
					unsupportedMsg(
						`${pkgName}.${name}`,
						"a constant with a non-literal value",
					),
				);
		}
	}
}

function checkDesc(desc, where, errors) {
	if (desc.k === "unsupported") errors.push(unsupportedMsg(where, desc.what));
	return desc;
}

function collectMethodMeta(fn, meta, errors, mod) {
	if (!isExported(fn._methodName)) return;
	const s = meta.structByName.get(fn._recvTypeName);
	if (!s) return;
	const where = `${fn._recvTypeName}.${fn._methodName}`;
	s.methods.push({
		name: fn._methodName,
		exportName: fn._exportName,
		ptrRecv: fn.params[0].type?.kind === "pointer",
		params: fn.params
			.slice(1)
			.map((p) => checkDesc(classifyType(p.type, mod), where, errors)),
		returns: returnDescs(fn.returnType, mod).map((d) =>
			checkDesc(d, where, errors),
		),
	});
}

function collectFuncMeta(fn, meta, errors, mod) {
	if (!isExported(fn.name)) return;
	const where = `${fn._pkgName}.${fn.name}`;
	meta.funcs.push({
		name: fn.name,
		exportName: fn.name,
		pkgName: fn._pkgName,
		params: (fn.params ?? []).map((p) =>
			checkDesc(classifyType(p.type, mod), where, errors),
		),
		returns: returnDescs(fn.returnType, mod).map((d) =>
			checkDesc(d, where, errors),
		),
	});
}

// ── Descriptor walk ──────────────────────────────────────────

function visitStructNeed(desc, needs, errors, mod) {
	if (needs.structs.has(desc.name)) return;
	const entry = { info: desc.info, fields: [] };
	needs.structs.set(desc.name, entry);
	for (const f of desc.info.fields) {
		const fd = classifyType(f.goType, mod);
		if (fd.k === "unsupported")
			errors.push(unsupportedMsg(`${desc.name}.${f.name}`, fd.what));
		entry.fields.push({ name: f.name, desc: fd });
		visitNeed(fd, needs, errors, mod);
	}
}

function visitNeed(desc, needs, errors, mod) {
	if (!desc || desc.k === "void") return;
	switch (desc.k) {
		case "struct":
			visitStructNeed(desc, needs, errors, mod);
			return;
		case "slice":
		case "array": {
			const map = desc.k === "slice" ? needs.slices : needs.arrays;
			if (map.has(desc.key)) return;
			map.set(desc.key, desc);
			visitNeed(desc.elem, needs, errors, mod);
			return;
		}
		case "func":
			if (needs.funcs.has(desc.key)) return;
			needs.funcs.set(desc.key, desc);
			visitSignatureNeeds(desc, needs, errors, mod);
			return;
		default:
			return;
	}
}

function visitSignatureNeeds(sig, needs, errors, mod) {
	for (const p of sig.params) visitNeed(p, needs, errors, mod);
	for (const r of sig.returns) visitNeed(r, needs, errors, mod);
}

// Collects every descriptor reachable from the exported surface so helpers are
// emitted once per struct / slice key / array key / closure key.
function collectNeeds(meta) {
	const mod = meta._mod;
	const needs = {
		structs: new Map(), // name -> { info, fields: [{ name, desc }] }
		slices: new Map(), // key -> desc
		arrays: new Map(), // key -> desc
		funcs: new Map(), // key -> desc
	};
	const errors = [];
	for (const s of meta.structs) {
		if (s.pkgTarget === "wasm")
			visitNeed(structDesc(s.info, false), needs, errors, mod);
		for (const m of s.methods) visitSignatureNeeds(m, needs, errors, mod);
	}
	for (const f of meta.funcs) visitSignatureNeeds(f, needs, errors, mod);
	if (errors.length > 0) throw new Error([...new Set(errors)].join("\n"));
	return needs;
}

// ── WASM-side helpers ────────────────────────────────────────

// Pre-lock: registers env imports for JS callbacks (`__invoke$<key>`).
export function scanBoundaryImports(mod, meta) {
	const needs = collectNeeds(meta);
	meta._needs = needs;
	for (const [key, desc] of needs.funcs) {
		mod.getOrAddFuncImport(
			"env",
			`__invoke$${key}`,
			["externref", ...desc.closureInfo.paramWTypes.map(extType)],
			desc.closureInfo.returnWTypes.map(extType),
		);
	}
}

// Boundary representation of a wasm value type.  i64 crosses as f64 so JS
// never sees (or allocates) a BigInt for Go `int`; every GC reference (struct,
// array, closure, anyref) crosses as externref.  V8 only inlines the
// JS→wasm wrapper (passing f32/f64 unboxed) when the signature holds nothing
// but i32/i64/f32/f64/externref: a single anyref or `(ref $T)` in the
// signature costs a 16-byte HeapNumber per float argument and result.
function isGcRef(wType) {
	return wType === "anyref" || (typeof wType === "object" && wType !== null);
}
function extType(wType) {
	if (wType === "i64") return "f64";
	if (isGcRef(wType)) return "externref";
	return wType;
}
function needsConv(wTypes) {
	return wTypes.some((w) => w === "i64" || isGcRef(w));
}
// Instructions converting the value on the stack from its boundary form.
function fromExt(wType) {
	if (wType === "i64") return [{ op: "i64.trunc_sat_f64_s" }];
	if (wType === "anyref") return [{ op: "any.convert_extern" }];
	if (isGcRef(wType)) {
		const out = [{ op: "any.convert_extern" }];
		if (wType.typeIndex !== undefined)
			out.push({ op: "ref.cast_null", typeIndex: wType.typeIndex });
		return out;
	}
	return [];
}
// Instructions converting the value on the stack to its boundary form.
function toExt(wType) {
	if (wType === "i64") return [{ op: "f64.convert_i64_s" }];
	if (isGcRef(wType)) return [{ op: "extern.convert_any" }];
	return [];
}
// Rewrites the values on top of the stack (types `wTypes`) with `conv`,
// spilling through locals starting at `localBase` when more than one.
function convertResults(wTypes, conv, localBase) {
	if (wTypes.length === 0 || !needsConv(wTypes)) return [];
	if (wTypes.length === 1) return conv(wTypes[0]);
	const out = [];
	for (let i = wTypes.length - 1; i >= 0; i--)
		out.push({ op: "local.set", index: localBase + i });
	for (let i = 0; i < wTypes.length; i++)
		out.push({ op: "local.get", index: localBase + i }, ...conv(wTypes[i]));
	return out;
}

function zeroInstr(wType) {
	if (wType === "i64") return { op: "i64.const", value: 0n };
	if (wType === "f32" || wType === "f64")
		return { op: `${wType}.const`, value: 0 };
	if (typeof wType === "object" && wType !== null) {
		return {
			op: "ref.null",
			heapType: wType.typeIndex ?? wType.heapType ?? "any",
		};
	}
	if (wType === "externref") return { op: "ref.null", heapType: "extern" };
	if (wType === "anyref") return { op: "ref.null", heapType: "any" };
	return { op: "i32.const", value: 0 };
}

// Type entry at a flat type index (rec groups hold several entries each).
function typeAt(mod, index) {
	if (index === undefined) return null;
	let i = 0;
	for (const entry of mod.types) {
		const group = entry.form === "rec" ? entry.types : [entry];
		if (index < i + group.length) return group[index - i];
		i += group.length;
	}
	return null;
}

// Post user functions: appends marshalling helper functions and exports them.
export function addBoundaryHelpers(mod, meta) {
	const needs = meta._needs ?? collectNeeds(meta);
	const importFuncCount = mod.imports.filter((i) => i.kind === "func").length;

	const addFunc = (
		name,
		params,
		results,
		body,
		exported = true,
		locals = [],
	) => {
		const idx = importFuncCount + mod.funcs.length;
		const typeIndex = mod.getTypeIndex(params, results);
		mod.funcs.push({
			typeIndex,
			locals,
			body: [...body, { op: "return" }],
		});
		mod.funcMap.set(name, idx);
		if (exported) mod.exports.push({ name, kind: "func", index: idx });
		return idx;
	};
	const get = (i) => ({ op: "local.get", index: i });
	// Parameter `i` converted from its boundary form.
	const getIn = (i, wType) => [get(i), ...fromExt(wType)];
	const EXT = "externref";

	for (const [name, { info }] of needs.structs) {
		const ref = toRef(info);
		const ti = info.typeIndex;
		const fieldWTypes = info.fields.map((f) => f.wType);
		addFunc(
			`__new_${name}`,
			fieldWTypes.map(extType),
			[EXT],
			[
				...fieldWTypes.flatMap((w, i) => getIn(i, w)),
				{ op: "struct.new", typeIndex: ti },
				...toExt(ref),
			],
		);
		addFunc(
			`__zero_${name}`,
			[],
			[EXT],
			[
				...fieldWTypes.map((w) => zeroInstr(w)),
				{ op: "struct.new", typeIndex: ti },
				...toExt(ref),
			],
		);
		addFunc(
			`__clone_${name}`,
			[EXT],
			[EXT],
			[
				...fieldWTypes.flatMap((_, i) => [
					...getIn(0, ref),
					{ op: "struct.get", typeIndex: ti, fieldIndex: i },
				]),
				{ op: "struct.new", typeIndex: ti },
				...toExt(ref),
			],
		);
		for (let i = 0; i < info.fields.length; i++) {
			const f = info.fields[i];
			addFunc(
				`__get_${name}_${f.name}`,
				[EXT],
				[extType(f.wType)],
				[
					...getIn(0, ref),
					{ op: "struct.get", typeIndex: ti, fieldIndex: i },
					...toExt(f.wType),
				],
			);
			addFunc(
				`__set_${name}_${f.name}`,
				[EXT, extType(f.wType)],
				[],
				[
					...getIn(0, ref),
					...getIn(1, f.wType),
					{ op: "struct.set", typeIndex: ti, fieldIndex: i },
				],
			);
		}
	}

	for (const [key, desc] of needs.arrays) {
		const { arrInfo } = desc;
		const ref = desc.wType;
		addFunc(
			`__array_new_${key}`,
			["i32"],
			[EXT],
			[
				get(0),
				{ op: "array.new_default", typeIndex: arrInfo.typeIndex },
				...toExt(ref),
			],
		);
		addFunc(
			`__array_len_${key}`,
			[EXT],
			["i32"],
			[...getIn(0, ref), { op: "array.len" }],
		);
		addFunc(
			`__array_get_${key}`,
			[EXT, "i32"],
			[extType(arrInfo.elemWType)],
			[
				...getIn(0, ref),
				get(1),
				{ op: "array.get", typeIndex: arrInfo.typeIndex },
				...toExt(arrInfo.elemWType),
			],
		);
		addFunc(
			`__array_set_${key}`,
			[EXT, "i32", extType(arrInfo.elemWType)],
			[],
			[
				...getIn(0, ref),
				get(1),
				...getIn(2, arrInfo.elemWType),
				{ op: "array.set", typeIndex: arrInfo.typeIndex },
			],
		);
	}

	for (const [key, desc] of needs.slices) {
		const { sliceInfo } = desc;
		const ref = desc.wType;
		const arrTI = sliceInfo.arrInfo.typeIndex;
		const sTI = sliceInfo.typeIndex;
		const elemAddr = [
			...getIn(0, ref),
			{ op: "struct.get", typeIndex: sTI, fieldIndex: 0 },
			...getIn(0, ref),
			{ op: "struct.get", typeIndex: sTI, fieldIndex: 1 },
			get(1),
			{ op: "i32.add" },
		];
		addFunc(
			`__slice_new_${key}`,
			["i32"],
			[EXT],
			[
				get(0),
				{ op: "array.new_default", typeIndex: arrTI },
				{ op: "i32.const", value: 0 },
				get(0),
				get(0),
				{ op: "struct.new", typeIndex: sTI },
				...toExt(ref),
			],
		);
		addFunc(
			`__slice_len_${key}`,
			[EXT],
			["i32"],
			[...getIn(0, ref), { op: "struct.get", typeIndex: sTI, fieldIndex: 2 }],
		);
		addFunc(
			`__slice_get_${key}`,
			[EXT, "i32"],
			[extType(sliceInfo.elemWType)],
			[
				...elemAddr,
				{ op: "array.get", typeIndex: arrTI },
				...toExt(sliceInfo.elemWType),
			],
		);
		addFunc(
			`__slice_nil_${key}`,
			[],
			[EXT],
			[{ op: "global.get", index: sliceInfo.emptyGlobalIndex }, ...toExt(ref)],
		);
		addFunc(
			`__slice_is_nil_${key}`,
			[EXT],
			["i32"],
			[
				...getIn(0, ref),
				{ op: "struct.get", typeIndex: sTI, fieldIndex: 0 },
				{ op: "ref.is_null" },
			],
		);
		addFunc(
			`__slice_set_${key}`,
			[EXT, "i32", extType(sliceInfo.elemWType)],
			[],
			[
				...elemAddr,
				...getIn(2, sliceInfo.elemWType),
				{ op: "array.set", typeIndex: arrTI },
			],
		);
	}

	for (const [key, desc] of needs.funcs) {
		const ci = desc.closureInfo;
		const invokeIdx = mod.importCache.get(`env.__invoke$${key}`);
		const nParams = ci.paramWTypes.length;
		// Thunk: wasm closure body calling the JS callback (boundary forms out, back in).
		const thunkIdx = addFunc(
			`__jsthunk$${key}`,
			["anyref", ...ci.paramWTypes],
			ci.returnWTypes,
			[
				get(0),
				{ op: "extern.convert_any" },
				...ci.paramWTypes.flatMap((w, i) => [get(i + 1), ...toExt(w)]),
				{ op: "call", funcIndex: invokeIdx },
				...convertResults(ci.returnWTypes, fromExt, nParams + 1),
			],
			false,
			ci.returnWTypes.length > 1 ? ci.returnWTypes.map(extType) : [],
		);
		mod.addRefFuncElement(thunkIdx);
		addFunc(
			`__wrap_fn$${key}`,
			[EXT],
			[EXT],
			[
				{ op: "ref.func", funcIndex: thunkIdx },
				get(0),
				{ op: "any.convert_extern" },
				{ op: "struct.new", typeIndex: ci.typeIndex },
				...toExt(desc.wType),
			],
		);
		// JS calling a wasm closure (boundary forms in, results out).
		addFunc(
			`__call_fn$${key}`,
			[EXT, ...ci.paramWTypes.map(extType)],
			ci.returnWTypes.map(extType),
			[
				...getIn(0, desc.wType),
				{ op: "struct.get", typeIndex: ci.typeIndex, fieldIndex: 1 },
				...ci.paramWTypes.flatMap((w, i) => getIn(i + 1, w)),
				...getIn(0, desc.wType),
				{ op: "struct.get", typeIndex: ci.typeIndex, fieldIndex: 0 },
				{ op: "call_ref", typeIndex: ci.funcTypeIndex },
				...convertResults(ci.returnWTypes, toExt, nParams + 1),
			],
			true,
			ci.returnWTypes.length > 1 ? ci.returnWTypes : [],
		);
	}

	// Exported user functions / methods whose signature carries i64 or GC refs
	// get a trampoline (`__x_<export>`) with the boundary signature; the facade
	// calls that instead of the raw export.
	const addTrampoline = (entry) => {
		const fnIdx = mod.funcMap.get(entry.exportName);
		if (fnIdx === undefined) return;
		const sig = typeAt(mod, mod.funcs[fnIdx - importFuncCount]?.typeIndex);
		if (sig?.form !== "func") return;
		const paramW = sig.params;
		const resultW = sig.results;
		if (!needsConv(paramW) && !needsConv(resultW)) return;
		entry.callName = `__x_${entry.exportName}`;
		addFunc(
			entry.callName,
			paramW.map(extType),
			resultW.map(extType),
			[
				...paramW.flatMap((w, i) => getIn(i, w)),
				{ op: "call", funcIndex: fnIdx },
				...convertResults(resultW, toExt, paramW.length),
			],
			true,
			resultW.length > 1 ? resultW : [],
		);
	};
	for (const s of meta.structs) for (const m of s.methods) addTrampoline(m);
	for (const f of meta.funcs) addTrampoline(f);
}

// ── JS facade generation ─────────────────────────────────────

const P = "__gfw_"; // facade helper prefix

// JS expression converting JS value `v` into the wasm representation.
function inExpr(desc, v) {
	switch (desc.k) {
		case "bool":
			return `(${v} ? 1 : 0)`;
		case "i32":
			return `(${v} | 0)`;
		case "i64":
			return `${P}i64in(${v})`;
		case "f32":
		case "f64":
			return `(+${v})`;
		case "string":
			return `${P}strin(${v})`;
		case "any":
			return `(${v} === undefined ? null : ${v})`;
		case "struct":
			if (desc.info.pkgTarget === "both")
				return `${P}to_${desc.name}(${v}, ${desc.ptr ? "false" : "true"})`;
			return desc.ptr ? `${P}href(${v})` : `${P}hval_${desc.name}(${v})`;
		case "slice":
			return `${P}slin_${desc.key}(${v})`;
		case "array":
			return `${P}arrin_${desc.key}(${v})`;
		case "func":
			return `${P}fnin_${desc.key}(${v})`;
		default:
			return v;
	}
}

// JS expression converting wasm value `v` into the JS representation.
function outExpr(desc, v) {
	switch (desc.k) {
		case "bool":
			return `(${v} !== 0)`;
		case "i32":
			return desc.unsigned ? `(${v} >>> 0)` : v;
		case "i64":
			return desc.unsigned ? `${P}u64out(${v})` : `${P}i64out(${v})`;
		case "string":
			return `(${v} ?? "")`;
		case "struct":
			return desc.info.pkgTarget === "both"
				? `${P}from_${desc.name}(${v})`
				: `${desc.name}.__wrap(${v})`;
		case "slice":
			return `${P}slout_${desc.key}(${v})`;
		case "array":
			return `${P}arrout_${desc.key}(${v})`;
		case "func":
			return `${P}fnout_${desc.key}(${v})`;
		default:
			return v;
	}
}

function zeroExpr(desc) {
	switch (desc.k) {
		case "bool":
			return "false";
		case "i32":
		case "i64":
		case "f32":
		case "f64":
			return "0";
		case "string":
			return '""';
		case "struct":
			return desc.ptr ? "null" : `new ${desc.name}()`;
		case "array":
			return `${P}arrzero_${desc.key}(${desc.size})`;
		default:
			return "null";
	}
}

// JS expression exposing wasm storage `v` reached through a handle field as a
// *live* JS value: aggregate fields alias the wasm object instead of copying
// it, so `h.Pos.X = 1` and `h.Items[0] = 2` reach wasm like they do in Go.
function viewExpr(desc, v) {
	switch (desc.k) {
		case "struct":
			return desc.info.pkgTarget === "both"
				? `${P}view_${desc.name}(${v})`
				: `${desc.name}.__wrap(${v})`;
		case "slice":
			return `${P}slview_${desc.key}(${v})`;
		case "array":
			return `${P}arrview_${desc.key}(${v})`;
		default:
			return outExpr(desc, v);
	}
}

function isPtrBoth(d) {
	return d.k === "struct" && d.ptr && d.info.pkgTarget === "both";
}

function isBothStruct(d) {
	return d.k === "struct" && d.info.pkgTarget === "both";
}

function returnLines(returns, resultExpr) {
	if (returns.length === 0) return [];
	if (returns.length === 1)
		return [`\treturn ${outExpr(returns[0], resultExpr)};`];
	return [
		`\treturn [${returns.map((d, i) => outExpr(d, `${resultExpr}[${i}]`)).join(", ")}];`,
	];
}

// Generates the body of a JS wrapper calling `__w.<exportName>(leadArgs..., params...)`.
function genFuncBody(exportName, params, returns, leadArgs = []) {
	const names = params.map((_, i) => `a${i}`);
	const lines = [];
	const argExprs = [...leadArgs];
	const writeBack = params.some(isPtrBoth);
	if (writeBack) lines.push("\tconst __m = new Map();");
	for (let i = 0; i < params.length; i++) {
		const d = params[i];
		if (isPtrBoth(d)) {
			lines.push(`\tconst __p${i} = ${P}to_${d.name}(a${i}, false, __m);`);
			argExprs.push(`__p${i}`);
		} else {
			argExprs.push(inExpr(d, names[i]));
		}
	}
	const call = `__w.${exportName}(${argExprs.join(", ")})`;
	lines.push("\ttry {");
	if (!writeBack) {
		if (returns.length === 0) lines.push(`\t\t${call};`);
		else if (returns.length === 1)
			lines.push(...returnLines(returns, call).map((l) => `\t${l}`));
		else {
			lines.push(`\t\tconst __r = ${call};`);
			lines.push(...returnLines(returns, "__r").map((l) => `\t${l}`));
		}
	} else {
		lines.push(`\t\tconst __r = ${call};`);
		for (let i = 0; i < params.length; i++) {
			if (isPtrBoth(params[i]))
				lines.push(`\t\t${P}back_${params[i].name}(__p${i}, a${i});`);
		}
		lines.push(...returnLines(returns, "__r").map((l) => `\t${l}`));
	}
	lines.push(`\t} catch (e) { throw ${P}mapTrap(e); }`);
	return { names, body: lines.join("\n") };
}

function indent(text, prefix) {
	return text.replace(/^/gm, prefix);
}

// Runtime import table shared by the facade and glue.js (single source so
// the tests exercise the same env the shipped bundle uses).  Written to
// survive the built-in mangler: no shorthand destructuring, import keys
// quoted, helpers prefixed with `__`.
export const WASM_IMPORTS_JS = `const ${P}MAX = 9007199254740991n;
function ${P}imports(stringTable, extraEnv, tag, write) {
	let buf = [];
	let targs = [];
	const flush = () => { const s = buf.join(" "); buf = []; write(s); };
	const print = (v) => { buf.push(String(v)); };
	const println = (v) => { buf.push(String(v)); flush(); };
	const targ = (v) => { targs.push(v); };
	const env = {
		"panicTag": tag,
		"panic": (msg) => { throw new Error(String(msg)); },
		"str": (i) => stringTable[i] ?? "",
		"str_len": (s) => (s ? s.length : 0),
		"str_concat": (a, b) => (a ?? "") + (b ?? ""),
		"str_eq": (a, b) => (a === b ? 1 : 0),
		"str_ne": (a, b) => (a !== b ? 1 : 0),
		"str_lt": (a, b) => ((a ?? "") < (b ?? "") ? 1 : 0),
		"str_le": (a, b) => ((a ?? "") <= (b ?? "") ? 1 : 0),
		"str_gt": (a, b) => ((a ?? "") > (b ?? "") ? 1 : 0),
		"str_ge": (a, b) => ((a ?? "") >= (b ?? "") ? 1 : 0),
		"str_get": (s, i) => (s ? s.charCodeAt(i) : 0),
		"str_slice": (s, a, b) => (s ? s.slice(a, b) : ""),
		"str_from_code_point": (c) => String.fromCodePoint(c),
		"str_code_point_at": (s, i) => (s ? s.codePointAt(i) : 0),
		"is_string": (v) => (typeof v === "string" ? 1 : 0),
		"print_i32": print, "print_i64": print, "print_f32": print, "print_f64": print,
		"print_str": print, "print_any": print,
		"print_bool": (b) => print(b !== 0 ? "true" : "false"),
		"println_i32": println, "println_i64": println, "println_f32": println, "println_f64": println,
		"println_str": println, "println_any": println,
		"println_bool": (b) => println(b !== 0 ? "true" : "false"),
		"println_empty": flush,
		"testing_arg_i32": targ, "testing_arg_f32": targ, "testing_arg_f64": targ,
		"testing_arg_str": targ, "testing_arg_any": targ,
		"testing_arg_i64": (v) => targ(v > ${P}MAX || v < -${P}MAX ? v : Number(v)),
		"testing_arg_bool": (v) => targ(v !== 0),
		"testing_call": (t, i) => { const a = targs; targs = []; t[stringTable[i]](...a); },
		"testing_name": (t) => t.Name(),
		"testing_flag": (t, i) => (t[stringTable[i]]() ? 1 : 0),
	};
	Object.assign(env, extraEnv);
	const m = {};
	for (const k of ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "pow", "exp", "log", "log2", "log10", "round"]) m[k] = Math[k];
	return { "env": env, "Math": m };
}`;

// Runtime loader emitted at the top of the facade.
export const WASM_LOADER_JS = `${WASM_IMPORTS_JS}
async function ${P}fetch(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error("GoFront: failed to fetch " + url + " (" + res.status + ")");
	return res.arrayBuffer();
}
async function ${P}instantiate(imports) {
	const bytes = globalThis.__GOFRONT_WASM_BYTES;
	if (bytes) return WebAssembly.instantiate(bytes, imports);
	const url = globalThis.__GOFRONT_WASM_URL ?? "app.wasm";
	if (typeof WebAssembly.instantiateStreaming === "function") {
		try { return await WebAssembly.instantiateStreaming(fetch(url), imports); }
		catch { /* fall through: wrong MIME type or no streaming support */ }
	}
	return WebAssembly.instantiate(await ${P}fetch(url), imports);
}
async function ${P}load(stringTable, extraEnv) {
	if (typeof WebAssembly === "undefined" || typeof WebAssembly.Tag !== "function") {
		throw new Error("GoFront: this runtime lacks the WebAssembly GC / exception support required by app.wasm");
	}
	const tag = new WebAssembly.Tag({ "parameters": ["externref"] });
	const imports = ${P}imports(stringTable, extraEnv, tag, (s) => console.log(s));
	// Panics arrive as plain JS Errors thrown by env.panic (also from the
	// start function while package-level initializers run), so exports are
	// returned raw: no try/catch wrapper, which keeps JS→wasm calls inlinable.
	const result = await ${P}instantiate(imports);
	return result.instance.exports;
}
// Go int/int64 cross the boundary as f64 (exact within the safe-integer range).
const ${P}i64in = (v) => (typeof v === "bigint" ? Number(v) : +v);
const ${P}i64out = (v) => {
	if (v > ${P}MAX || v < -${P}MAX) throw new RangeError("GoFront: int64 value " + v + " exceeds the safe JS integer range");
	return v;
};
const ${P}u64out = (v) => {
	if (v < 0 || v > ${P}MAX) throw new RangeError("GoFront: uint64 value exceeds the safe JS integer range");
	return v;
};
const ${P}strin = (v) => (v == null ? "" : String(v));
const ${P}href = (h) => (h == null ? null : h.__ref);
const ${P}NIL_DEREF_PATTERNS = [
	"dereferencing a null pointer", // V8
	"dereferencing null pointer", // SpiderMonkey
	"null pointer dereference", // SpiderMonkey
	"null dereference", // JavaScriptCore
];
function ${P}mapTrap(e) {
	if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError) {
		const msg = e.message || "";
		for (const p of ${P}NIL_DEREF_PATTERNS) {
			if (msg.includes(p)) {
				return new Error("runtime error: invalid memory address or nil pointer dereference");
			}
		}
	}
	return e;
}
// Live index view over a wasm array/slice (reads and writes go through to wasm).
function ${P}idxview(n, getAt, setAt) {
	const inRange = (k) => { if (typeof k !== "string") return -1; const i = +k; return i === (i | 0) && i >= 0 && i < n ? i : -1; };
	return new Proxy(new Array(n), {
		"get": (t, k, r) => { const i = inRange(k); return i < 0 ? Reflect.get(t, k, r) : getAt(i); },
		"set": (t, k, v, r) => { const i = inRange(k); if (i < 0) return Reflect.set(t, k, v, r); setAt(i, v); return true; },
		"has": (t, k) => inRange(k) >= 0 || Reflect.has(t, k),
		"getOwnPropertyDescriptor": (t, k) => {
			const i = inRange(k);
			if (i < 0) return Reflect.getOwnPropertyDescriptor(t, k);
			return { "value": getAt(i), "writable": true, "enumerable": true, "configurable": true };
		},
		"ownKeys": (t) => { const keys = []; for (let i = 0; i < n; i++) keys.push(String(i)); keys.push("length"); return keys; },
	});
}`;

// Generates the JS facade for the linked wasm module.
export function generateFacade(
	meta,
	{ stringTable = [], callMain = false } = {},
) {
	const needs = meta._needs ?? collectNeeds(meta);
	const out = [WASM_LOADER_JS];

	// JS callback imports (registered before instantiation; bodies run after).
	out.push(`const ${P}env = {};`);
	for (const [key, desc] of needs.funcs) {
		const names = desc.params.map((_, i) => `a${i}`);
		const call = `fn(${desc.params.map((d, i) => outExpr(d, names[i])).join(", ")})`;
		let body;
		if (desc.returns.length === 0) body = `${call};`;
		else if (desc.returns.length === 1)
			body = `return ${inExpr(desc.returns[0], call)};`;
		else
			body = `const __r = ${call}; return [${desc.returns
				.map((d, i) => inExpr(d, `__r[${i}]`))
				.join(", ")}];`;
		const sig = ["fn", ...names].join(", ");
		out.push(`${P}env["__invoke$${key}"] = (${sig}) => { ${body} };`);
	}
	out.push(
		`const __w = await ${P}load(${JSON.stringify(stringTable)}, ${P}env);`,
	);

	for (const [name, { info, fields }] of needs.structs) {
		if (info.pkgTarget === "both") genBothStruct(out, name, fields);
		else {
			const methods = meta.structByName.get(name)?.methods ?? [];
			genHandleStruct(out, name, fields, methods);
		}
	}

	for (const [key, desc] of needs.slices) {
		out.push(`function ${P}slin_${key}(arr) {
	if (arr == null) return __w.__slice_nil_${key}();
	const n = arr.length;
	const s = __w.__slice_new_${key}(n);
	for (let i = 0; i < n; i++) __w.__slice_set_${key}(s, i, ${inExpr(desc.elem, "arr[i]")});
	return s;
}
function ${P}slout_${key}(s) {
	if (s == null || __w.__slice_is_nil_${key}(s)) return null;
	const n = __w.__slice_len_${key}(s);
	const out = new Array(n);
	for (let i = 0; i < n; i++) out[i] = ${outExpr(desc.elem, `__w.__slice_get_${key}(s, i)`)};
	return out;
}
function ${P}slview_${key}(s) {
	if (s == null || __w.__slice_is_nil_${key}(s)) return null;
	return ${P}idxview(__w.__slice_len_${key}(s), (i) => ${viewExpr(desc.elem, `__w.__slice_get_${key}(s, i)`)}, (i, v) => __w.__slice_set_${key}(s, i, ${inExpr(desc.elem, "v")}));
}`);
	}
	for (const [key, desc] of needs.arrays) {
		out.push(`function ${P}arrzero_${key}(n) {
	const out = new Array(n);
	for (let i = 0; i < n; i++) out[i] = ${zeroExpr(desc.elem)};
	return out;
}
function ${P}arrin_${key}(arr) {
	if (arr == null) return null;
	const n = arr.length;
	const a = __w.__array_new_${key}(n);
	for (let i = 0; i < n; i++) __w.__array_set_${key}(a, i, ${inExpr(desc.elem, "arr[i]")});
	return a;
}
function ${P}arrout_${key}(a) {
	if (a == null) return null;
	const n = __w.__array_len_${key}(a);
	const out = new Array(n);
	for (let i = 0; i < n; i++) out[i] = ${outExpr(desc.elem, `__w.__array_get_${key}(a, i)`)};
	return out;
}
function ${P}arrview_${key}(a) {
	if (a == null) return null;
	return ${P}idxview(__w.__array_len_${key}(a), (i) => ${viewExpr(desc.elem, `__w.__array_get_${key}(a, i)`)}, (i, v) => __w.__array_set_${key}(a, i, ${inExpr(desc.elem, "v")}));
}`);
	}

	for (const [key, desc] of needs.funcs) {
		const { names, body } = genFuncBody(
			`__call_fn$${key}`,
			desc.params,
			desc.returns,
			["c"],
		);
		out.push(`const ${P}fnmap_${key} = new WeakMap();
function ${P}fnin_${key}(fn) {
	if (fn == null) return null;
	let c = ${P}fnmap_${key}.get(fn);
	if (!c) { c = __w.__wrap_fn$${key}(fn); ${P}fnmap_${key}.set(fn, c); }
	return c;
}
function ${P}fnout_${key}(c) {
	if (c == null) return null;
	return (${names.join(", ")}) => {
${indent(body, "\t")}
	};
}`);
	}

	for (const c of meta.consts) out.push(`const ${c.name} = ${c.value};`);

	for (const f of meta.funcs) {
		const { names, body } = genFuncBody(
			f.callName ?? f.exportName,
			f.params,
			f.returns,
		);
		out.push(`function ${f.name}(${names.join(", ")}) {\n${body}\n}`);
	}

	if (callMain) out.push("__w.main();");
	return bindExports(out.join("\n"));
}

// Rewrites `__w.name(...)` into calls through module-level `const` bindings.
// V8 only inlines a JS→wasm call (and so passes f32/f64 arguments unboxed)
// when the callee is a compile-time constant; a property load off the exports
// object is not, and every float argument then costs a 16-byte HeapNumber.
function bindExports(src) {
	const loadLine = "const __w = await ";
	const at = src.indexOf(loadLine);
	if (at < 0) return src;
	const eol = src.indexOf("\n", at);
	const head = src.slice(0, eol + 1);
	let tail = src.slice(eol + 1);
	const names = new Set();
	tail = tail.replace(/__w\.([A-Za-z_$][\w$]*)/g, (_, n) => {
		names.add(n);
		return `__w$${n}`;
	});
	const binds = [...names].map((n) => `const __w$${n} = __w.${n};`).join("\n");
	return `${head}${binds}\n${tail}`;
}

function genBothStruct(out, name, fields) {
	const toArgs = fields.map((f) => {
		const v = `o.${f.name}`;
		if (isBothStruct(f.desc))
			return `${P}to_${f.desc.name}(${v}, ${f.desc.ptr ? "false" : "true"}, m)`;
		return inExpr(f.desc, v);
	});
	const backLines = fields.map((f) => {
		const got = `__w.__get_${name}_${f.name}(r)`;
		if (isBothStruct(f.desc))
			return `\t${P}back_${f.desc.name}(${got}, o.${f.name});`;
		return `\to.${f.name} = ${outExpr(f.desc, got)};`;
	});
	const fromArgs = fields.map((f) =>
		outExpr(f.desc, `__w.__get_${name}_${f.name}(r)`),
	);
	const viewProps = fields.map((f) => {
		const got = `__w.__get_${name}_${f.name}(this.__ref)`;
		return `"${f.name}": { "enumerable": true, "get"() { return ${viewExpr(f.desc, got)}; }, "set"(v) { __w.__set_${name}_${f.name}(this.__ref, ${inExpr(f.desc, "v")}); } }`;
	});
	out.push(`function ${P}to_${name}(o, isValue, m) {
	if (o == null) return isValue ? __w.__zero_${name}() : null;
	if (m) { const hit = m.get(o); if (hit) return hit; }
	const r = __w.__new_${name}(${toArgs.join(", ")});
	if (m) m.set(o, r);
	return r;
}
function ${P}from_${name}(r) {
	if (r == null) return null;
	return new ${name}(${fromArgs.join(", ")});
}
// Live views share one prototype and are cached per wasm object so hot paths
// (\`h.Pos.X = 1\` in a frame loop) do not allocate a wrapper per access.  The
// prototype is built on first use: the facade may precede the \`both\`
// package's own JS (and so the \`${name}\` class) in the bundle.
let ${P}vp_${name} = null;
const ${P}vc_${name} = new WeakMap();
function ${P}view_${name}(r) {
	if (r == null) return null;
	let o = ${P}vc_${name}.get(r);
	if (!o) {
		if (${P}vp_${name} === null) ${P}vp_${name} = Object.create(${name}.prototype, { ${viewProps.join(", ")} });
		o = Object.create(${P}vp_${name}); o.__ref = r; ${P}vc_${name}.set(r, o);
	}
	return o;
}
function ${P}back_${name}(r, o) {
	if (r == null || o == null) return;
${backLines.join("\n")}
}`);
}

function genHandleStruct(out, name, fields, methods) {
	// `$`-suffixed params keep the mangler from renaming the matching getters.
	const ctorParams = fields.map((f) => `${f.name}$ = ${zeroExpr(f.desc)}`);
	const ctorArgs = fields.map((f) => inExpr(f.desc, `${f.name}$`));
	const lines = [
		`const ${P}h_${name} = new WeakMap();
function ${P}hval_${name}(h) {
	if (h == null) return __w.__zero_${name}();
	return __w.__clone_${name}(h.__ref);
}
class ${name} {
	constructor(${ctorParams.join(", ")}) {
		this.__ref = __w.__new_${name}(${ctorArgs.join(", ")});
		${P}h_${name}.set(this.__ref, this);
	}
	static __wrap(ref) {
		if (ref == null) return null;
		let h = ${P}h_${name}.get(ref);
		if (!h) { h = Object.create(${name}.prototype); h.__ref = ref; ${P}h_${name}.set(ref, h); }
		return h;
	}
	__clone() { return ${name}.__wrap(__w.__clone_${name}(this.__ref)); }`,
	];
	for (const f of fields) {
		const got = `__w.__get_${name}_${f.name}(this.__ref)`;
		lines.push(`\tget ${f.name}() { return ${viewExpr(f.desc, got)}; }`);
		lines.push(
			`\tset ${f.name}(v) { __w.__set_${name}_${f.name}(this.__ref, ${inExpr(f.desc, "v")}); }`,
		);
	}
	for (const m of methods) {
		const recv = m.ptrRecv ? "this.__ref" : `__w.__clone_${name}(this.__ref)`;
		const { names, body } = genFuncBody(
			m.callName ?? m.exportName,
			m.params,
			m.returns,
			[recv],
		);
		lines.push(
			`\t${m.name}(${names.join(", ")}) {\n${indent(body, "\t")}\n\t}`,
		);
	}
	lines.push("}");
	out.push(lines.join("\n"));
}
