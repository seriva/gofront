// src/backend/wasm/boundary.js
// JS <-> WASM boundary: type classification, marshalling helpers (WASM IR)
// and the generated JS facade that exposes a wasm package to JS callers.
//
// Boundary v1 rules (plans/v1.5.0/wasm-mvp-plan.md, Phase 5):
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
//   - named non-empty interfaces (Task H5.2): wasm values reach JS as their
//     handle class / live view when the dynamic type is an exported `*T`,
//     otherwise as a facade whose methods call the wasm dispatchers.  Only
//     wasm-owned values (`__ref`) go back in; JS-implemented values are
//     rejected (no cross-boundary itab proxies).
//   - maps, anonymous interfaces, error, pointers to non-structs: rejected
//     with a compile error (planned for a later boundary version).
//   - `gofront/shared` buffers (Task H6.1): `(base, len)` views over the
//     module's exported linear memory; JS sees a zero-copy TypedArray over
//     `memory.buffer`.  Only TypedArrays that already alias that memory (ones
//     handed out by this facade) may be passed back in.
//   - `*testing.T`: the harness's JS test object, passed as an opaque
//     externref (test methods are routed back to JS via `env.testing_*`).

import { BROWSER_GLOBALS } from "../../typechecker/types.js";
import { HELPER_ERROR, HELPER_SPRINTF } from "../js/runtime.js";
import { FIXED_FLOAT_JS } from "../shared/fixed-float.js";
import {
	unicodeIsJs,
	unicodeToLowerJs,
	unicodeToUpperJs,
} from "../shared/host-unicode.js";
import {
	anonIfaceName,
	getInterfaceMethodList,
	getSharedInfo,
	isTestingT,
} from "./types.js";

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

// The facade and its wasm export names build identifiers from a struct's name,
// so the dot of a stdlib type (`strings.Builder`) becomes `$`.
function structDesc(info, ptr) {
	return {
		k: "struct",
		name: info.name.replaceAll(".", "$"),
		ptr,
		info,
		wType: toRef(info),
	};
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
		// `_variadic`: already desugared to a slice by variadic.js
		variadic: Boolean(
			t.params?.at(-1)?.variadic || t.params?.at(-1)?._variadic,
		),
	};
}

// Classifies a Go type (AST node or checker type) for boundary marshalling.
// Returns a descriptor `{ k, ... }`; `k === "unsupported"` carries `what`.
function classifyType(goType, mod) {
	if (!goType) return { k: "void" };
	if (isTestingT(goType)) return { k: "extern", wType: "externref" };

	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		if (goType.name === "error") return { k: "error", wType: "anyref" };
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
		case "shared":
			return classifyShared(t, mod);
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
		case "map":
			return classifyMap(t, mod);
		case "struct":
			return classifyStruct(t, mod);
		case "func":
			return classifyFunc(t, mod);
		case "interface":
			return classifyInterface(t, mod);
		case "simd":
			return classifySimd(t, mod);
		default:
			return {
				k: "unsupported",
				what: UNSUPPORTED_KINDS[t.kind] ?? `type kind '${t.kind}'`,
			};
	}
}

const UNSUPPORTED_KINDS = {
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
		case "MapType":
			return { kind: "map", key: t.key, val: t.value ?? t.elem };
		case "FuncType":
			return funcSigFromAst(t);
		case "InterfaceType":
			return {
				kind: "interface",
				name: t.name,
				methods: t.methods,
			};
		case "StructType":
			return {
				kind: "struct",
				name: t.name,
				fields: t.fields,
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
	error: { k: "error", wType: "anyref" },
};

function classifyBasic(n) {
	if (I32_INTS.has(n))
		return { k: "i32", unsigned: UNSIGNED.has(n), wType: "i32" };
	if (I64_INTS.has(n))
		return {
			k: "i64",
			unsigned: UNSIGNED.has(n),
			is64: n === "int64" || n === "uint64",
			wType: "i64",
		};
	const d = BASIC_DESCS[n];
	return d ? { ...d } : { k: "unsupported", what: `type '${n}'` };
}

function classifyNamed(t, mod) {
	if (
		t.name === "simd.F32x4" ||
		t.name === "F32x4" ||
		t.name === "simd.Mask32x4" ||
		t.name === "Mask32x4" ||
		t.underlying?.kind === "simd"
	) {
		return classifySimd(t.underlying ?? t, mod, t.name);
	}
	if (t.name === "error") return { k: "error", wType: "anyref" };
	const info = mod.getStructType(t.name);
	if (info) return structDesc(info, false);
	if (t.underlying) return classifyType(t.underlying, mod);
	return { k: "unsupported", what: `named type '${t.name}'` };
}

// F32x4 crosses as a copied 4-element Float32Array, Mask32x4 as a 4-element
// boolean array.  Both travel through the wasm boundary as a GC array of the
// four i32 lane words (`arr`), converted by __v128_from/__v128_to.
function classifySimd(t, mod, name = "") {
	const isMask = t.simd === "Mask32x4" || name.endsWith("Mask32x4");
	const arr = classifyArray(
		{ kind: "array", elem: { kind: "basic", name: "int32" }, size: 4 },
		mod,
	);
	return { k: isMask ? "mask4" : "f32x4", wType: "v128", arr };
}

function classifyAnonStruct(t, mod) {
	const rawFields = [];
	if (t.fields instanceof Map) {
		for (const [k, v] of t.fields.entries())
			rawFields.push({ name: k, goType: v });
	} else if (Array.isArray(t.fields)) {
		for (const f of t.fields) {
			const names = f.names ?? (f.name ? [f.name] : []);
			for (const n of names) rawFields.push({ name: n, goType: f.type });
		}
	}
	const info = mod.getAnonStructType(rawFields);
	const fields = [];
	for (const f of info.fields) {
		const fd = classifyType(f.goType, mod);
		if (fd.k === "unsupported") return fd;
		fields.push({ name: f.name, desc: fd });
	}
	return {
		k: "anon_struct",
		name: info.name,
		key: info.name,
		info,
		fields,
		wType: toRef(info),
	};
}

function classifyStruct(t, mod) {
	if (t.name) {
		const info = mod.getStructType(t.name);
		if (info) return structDesc(info, false);
	}
	return classifyAnonStruct(t, mod);
}

function classifyPointer(t, mod) {
	const base = classifyType(t.base, mod);
	if (base.k === "unsupported") return base;
	if (base.k === "struct" && !base.ptr) return { ...base, ptr: true };
	if (base.k === "anon_struct" && !base.ptr) return { ...base, ptr: true };
	const boxInfo = mod.getBoxType(t.base);
	const ptrInfo = mod.getPtrType ? mod.getPtrType(t.base) : null;
	const key = `${base.k}${base.unsigned ? "_u" : ""}${base.is64 ? "_64" : ""}_${boxInfo.typeIndex}`;
	return {
		k: "ptr_box",
		base,
		boxInfo,
		ptrInfo,
		key,
		wType: ptrInfo
			? {
					kind: "ref",
					nullable: true,
					typeIndex: ptrInfo.typeIndex,
					typeName: ptrInfo.name,
				}
			: { kind: "ref", nullable: true, typeIndex: boxInfo.typeIndex },
	};
}

function isAllowedMapKey(kDesc) {
	if (kDesc.k === "string" || kDesc.k === "bool") return true;
	if (
		kDesc.k === "i32" ||
		kDesc.k === "i64" ||
		kDesc.k === "f32" ||
		kDesc.k === "f64"
	)
		return true;
	return false;
}

function classifyMap(t, mod) {
	const keyType = t.key;
	const valType = t.val ?? t.value ?? t.elem;
	const keyDesc = classifyType(keyType, mod);
	if (keyDesc.k === "unsupported") return keyDesc;
	const valDesc = classifyType(valType, mod);
	if (valDesc.k === "unsupported") return valDesc;
	if (!isAllowedMapKey(keyDesc)) {
		return {
			k: "unsupported",
			what: `map with unsupported key type '${keyType?.name ?? keyDesc.k}'`,
		};
	}
	const mapInfo = mod.getMapType(keyType, valType);
	const keySliceDesc = classifySlice({ kind: "slice", elem: keyType }, mod);
	const valSliceDesc = classifySlice({ kind: "slice", elem: valType }, mod);
	const key = `m_${mapInfo.suffix}`;
	return {
		k: "map",
		key,
		mapInfo,
		keyDesc,
		valDesc,
		keySliceDesc,
		valSliceDesc,
		wType: mapInfo.wType,
	};
}

function classifyShared(t, mod) {
	const info = getSharedInfo(t, mod.checker);
	return {
		k: "shared",
		key: info.key,
		ctor: info.ctor,
		bytes: info.bytes,
		wType: mod.getSharedType().wType,
	};
}

function classifySlice(t, mod) {
	const elem = classifyType(t.elem, mod);
	if (elem.k === "unsupported") return elem;
	const sliceInfo = mod.getSliceType(t.elem);
	return {
		k: "slice",
		elem,
		sliceInfo,
		// []F32x4 and []Mask32x4 share a wasm slice type but cross differently,
		// so they get separate helper keys.
		key:
			wTypeKey(sliceInfo.elemWType) +
			(elem.k === "f32x4" || elem.k === "mask4"
				? `_${elem.k}`
				: elem.is64
					? "_i64"
					: ""),
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
		key: wTypeKey(arrInfo.elemWType) + (elem.is64 ? "_i64" : ""),
		wType: { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex },
	};
}

function classifySig(t, mod) {
	const params = (t.params ?? []).map((p) => classifyType(p, mod));
	const returns = (t.returns ?? [])
		.map((r) => classifyType(r, mod))
		.filter((d) => d.k !== "void");
	const bad = [...params, ...returns].find((d) => d.k === "unsupported");
	return bad ?? { params, returns };
}

function classifyFunc(t, mod) {
	// A variadic func value is a slice-taking closure in wasm but a rest-param
	// function in JS; no adapter yet, so it may not cross.
	if (t.variadic) return { k: "unsupported", what: "variadic func value" };
	const sig = classifySig(t, mod);
	if (sig.k === "unsupported") return sig;
	const closureInfo = mod.getClosureType(t);
	return {
		k: "func",
		params: sig.params,
		returns: sig.returns,
		closureInfo,
		key: `c${closureInfo.typeIndex}`,
		wType: { kind: "ref", nullable: true, typeIndex: closureInfo.typeIndex },
	};
}

function classifyInterface(t, mod) {
	if (t.name === "error") return { k: "error", wType: "anyref" };
	const mList = getInterfaceMethodList(t);
	if (mList.length === 0) return { k: "any", wType: "anyref" };
	mod._boundaryIfaces ??= new Map();
	if (t.name && t.methods instanceof Map) {
		return mod._boundaryIfaces.get(t.name) ?? classifyNamedInterface(t, mod);
	}
	return classifyAnonInterface(t, mod);
}

function classifyAnonInterface(t, mod) {
	const key = anonIfaceName(t, mod.checker, mod);
	if (mod._boundaryIfaces.has(key)) return mod._boundaryIfaces.get(key);
	const mList = getInterfaceMethodList(t);
	const desc = {
		k: "iface",
		name: key,
		key,
		wType: "anyref",
		methods: [],
		concrete: [],
		isAnon: true,
	};
	mod._boundaryIfaces.set(key, desc);
	for (const m of mList) {
		const sig = classifySig(
			{ kind: "func", params: m.params, returns: m.returns },
			mod,
		);
		if (sig.k === "unsupported") {
			const err = {
				k: "unsupported",
				what: `${sig.what} (in anonymous interface method ${m.name})`,
			};
			mod._boundaryIfaces.set(key, err);
			return err;
		}
		desc.methods.push({
			name: m.name,
			dispatch: `__dispatch_${key}_${m.name}`,
			...sig,
		});
	}
	return desc;
}

function classifyNamedInterface(t, mod) {
	const desc = {
		k: "iface",
		name: t.name,
		key: t.name.replaceAll(".", "_"),
		wType: "anyref",
		methods: [],
		concrete: [],
	};
	// Cached before the walk so self-referencing method signatures terminate.
	mod._boundaryIfaces.set(t.name, desc);
	for (const [mName, sigType] of t.methods) {
		const sig = classifySig(sigType, mod);
		if (sig.k === "unsupported") {
			const err = {
				k: "unsupported",
				what: `${sig.what} (in method ${t.name}.${mName})`,
			};
			mod._boundaryIfaces.set(t.name, err);
			return err;
		}
		desc.methods.push({
			name: mName,
			dispatch: `__dispatch_${t.name}_${mName}`,
			...sig,
		});
	}
	return desc;
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
		case "INT": {
			const raw = String(node.value);
			const clean = /^0[0-7]+$/.test(raw) ? `0o${raw.slice(1)}` : raw;
			const bi = BigInt(`${sign}${clean}`);
			return bi > 9007199254740991n || bi < -9007199254740991n
				? `${sign}${clean}n`
				: `${sign}${clean}`;
		}
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
	if (typeof what === "string" && what.includes("boundary")) {
		return `${where}: ${what}`;
	}
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
		vars: [], // exported package-level shared buffers of wasm packages
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
			} else if (d.kind === "VarDecl" && pkgTarget === "wasm") {
				collectVarDecl(d, meta, mod);
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
			if (value !== null) {
				meta.consts.push({ name, value, dynamic: false });
				continue;
			}
			const folded = meta._mod.constCache?.get(name);
			if (folded) {
				let val = null;
				if (folded.litKind === "INT") {
					const s = String(folded.value);
					const clean = /^0[0-7]+$/.test(s) ? `0o${s.slice(1)}` : s;
					const bi = BigInt(clean);
					val =
						bi > 9007199254740991n || bi < -9007199254740991n
							? `${clean}n`
							: clean;
				} else if (folded.litKind === "FLOAT") {
					val = folded.value;
				} else if (folded.litKind === "STRING") {
					val = JSON.stringify(String(folded.value));
				} else if (folded.litKind === "BOOL") {
					val = folded.value === "true" ? "true" : "false";
				}
				if (val !== null) {
					meta.consts.push({ name, value: val, dynamic: false });
					continue;
				}
			}
			const glob = meta._mod.resolveGlobal(name);
			const rawType = spec.type ?? spec.value?.[i]?._type ?? glob?.goType;
			let desc = rawType ? classifyType(rawType, meta._mod) : null;
			if (!desc || desc.k === "void") {
				if (glob?.type) {
					desc = { k: glob.type, wType: glob.type };
				}
			}
			if (!desc || desc.k === "unsupported") {
				errors.push(
					unsupportedMsg(`${pkgName}.${name}`, desc?.what ?? "unsupported"),
				);
			} else {
				meta.consts.push({ name, dynamic: true, desc });
			}
		}
	}
}

function checkDesc(desc, where, errors) {
	if (desc.k === "unsupported") errors.push(unsupportedMsg(where, desc.what));
	return desc;
}

// Exported `var Buf = shared.NewFloat32(n)` globals are exposed to JS as
// TypedArray views (read once after instantiation; sizing is fixed).  Other
// exported vars of a supported boundary type are read once when the module
// loads, after package initialization (`var Limit = 40` is `Limit` in the
// facade); a var of an unsupported type is left out.
function collectVarDecl(d, meta, mod) {
	for (const spec of d.decls ?? d.specs ?? [d]) {
		const names = spec.names ?? (spec.name ? [spec.name] : []);
		const values = spec.value ?? (spec.init ? [spec.init] : []);
		for (let i = 0; i < names.length; i++) {
			const name = names[i];
			if (!isExported(name)) continue;
			const goType =
				spec.type ?? mod.resolveGlobal(name)?.goType ?? values[i]?._type;
			const shared = Boolean(getSharedInfo(goType, mod.checker));
			const desc = classifyType(goType, mod);
			if (!shared && (!desc || desc.k === "unsupported" || desc.k === "void"))
				continue;
			meta.vars.push({ name, desc, shared });
		}
	}
}

function collectMethodMeta(fn, meta, errors, mod) {
	if (!isExported(fn._methodName)) return;
	const s = meta.structByName.get(fn._recvTypeName);
	if (!s) return;
	const where = `${fn._recvTypeName}.${fn._methodName}`;
	s.methods.push({
		name: fn._methodName,
		exportName: fn._exportName,
		fnName: fn.name,
		ptrRecv: fn.params[0].type?.kind === "pointer",
		variadic: Boolean(fn.params.at(-1)?._variadic),
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
		variadic: Boolean(fn.params?.at(-1)?._variadic),
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
		case "anon_struct":
			if (needs.anonStructs.has(desc.name)) return;
			needs.anonStructs.set(desc.name, desc);
			for (const f of desc.fields) visitNeed(f.desc, needs, errors, mod);
			return;
		case "error":
			needs.error = true;
			return;
		case "f32x4":
		case "mask4":
			needs.simd = desc.arr;
			visitNeed(desc.arr, needs, errors, mod);
			return;
		case "slice":
		case "array": {
			const map = desc.k === "slice" ? needs.slices : needs.arrays;
			if (map.has(desc.key)) return;
			map.set(desc.key, desc);
			visitNeed(desc.elem, needs, errors, mod);
			return;
		}
		case "map":
			if (needs.maps.has(desc.key)) return;
			needs.maps.set(desc.key, desc);
			visitNeed(desc.keyDesc, needs, errors, mod);
			visitNeed(desc.valDesc, needs, errors, mod);
			visitNeed(desc.keySliceDesc, needs, errors, mod);
			visitNeed(desc.valSliceDesc, needs, errors, mod);
			return;
		case "ptr_box":
			if (needs.boxes.has(desc.key)) return;
			needs.boxes.set(desc.key, desc);
			visitNeed(desc.base, needs, errors, mod);
			return;
		case "func":
			if (needs.funcs.has(desc.key)) return;
			needs.funcs.set(desc.key, desc);
			visitSignatureNeeds(desc, needs, errors, mod);
			return;
		case "iface":
			if (needs.ifaces.has(desc.key)) return;
			needs.ifaces.set(desc.key, desc);
			for (const m of desc.methods) visitSignatureNeeds(m, needs, errors, mod);
			return;
		case "shared":
			needs.shared = true;
			return;
		default:
			return;
	}
}

// Exported `*T` types (already on the boundary surface) whose JS class exposes
// every interface method: such values reach JS as the handle / live view
// itself, so type switches and identity still work.  `__itag` matches by
// `ref.test`, so a struct is only chosen for values that really hold it.
function concreteCandidates(desc, needs, meta, mod) {
	const out = [];
	for (const [name, { info }] of needs.structs) {
		const both = info.pkgTarget === "both";
		const names = both
			? [...(mod.checker?.types?.get(name)?.underlying?.methods?.keys() ?? [])]
			: (meta.structByName.get(name)?.methods ?? []).map((m) => m.name);
		const have = new Set(names);
		if (!desc.methods.every((m) => have.has(m.name))) continue;
		out.push({ name, typeIndex: info.typeIndex, both });
	}
	return out;
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
		anonStructs: new Map(), // name -> desc
		slices: new Map(), // key -> desc
		arrays: new Map(), // key -> desc
		maps: new Map(), // key -> desc
		boxes: new Map(), // key -> desc
		funcs: new Map(), // key -> desc
		ifaces: new Map(), // interface name -> desc
		error: false,
		simd: null, // array desc carrying vectors across the boundary
		shared: false, // any shared buffer on the surface
	};
	const errors = [];
	for (const s of meta.structs) {
		if (s.pkgTarget === "wasm")
			visitNeed(structDesc(s.info, false), needs, errors, mod);
		for (const m of s.methods) visitSignatureNeeds(m, needs, errors, mod);
	}
	for (const f of meta.funcs) visitSignatureNeeds(f, needs, errors, mod);
	for (const v of meta.vars ?? []) visitNeed(v.desc, needs, errors, mod);
	for (const c of meta.consts ?? []) {
		if (c.dynamic) visitNeed(c.desc, needs, errors, mod);
	}
	if (errors.length > 0) throw new Error([...new Set(errors)].join("\n"));
	for (const desc of needs.ifaces.values())
		desc.concrete = concreteCandidates(desc, needs, meta, mod);
	return needs;
}

// ── WASM-side helpers ────────────────────────────────────────

// Pre-lock: registers env imports for JS callbacks (`__invoke$<key>`).
export function scanBoundaryImports(mod, meta) {
	const needs = collectNeeds(meta);
	meta._needs = needs;
	for (const [key, desc] of needs.funcs) {
		const paramDescs = desc.params ?? [];
		const returnDescs = desc.returns ?? [];
		mod.getOrAddFuncImport(
			"env",
			`__invoke$${key}`,
			[
				"externref",
				...desc.closureInfo.paramWTypes.map((w, i) =>
					extType(w, paramDescs[i]?.is64),
				),
			],
			desc.closureInfo.returnWTypes.map((w, i) =>
				extType(w, returnDescs[i]?.is64),
			),
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
// A v128 crosses as an externref holding a GC array of its four i32 lanes;
// the converting helpers are registered first thing in addBoundaryHelpers.
const v128Conv = { from: null, to: null };

function extType(wType, is64 = false) {
	if (wType === "v128") return "externref";
	if (wType === "i64") return is64 ? "i64" : "f64";
	if (isGcRef(wType)) return "externref";
	return wType;
}
function needsConv(wTypes, descs = []) {
	return wTypes.some(
		(w, i) => (w === "i64" && !descs[i]?.is64) || w === "v128" || isGcRef(w),
	);
}
// Instructions converting the value on the stack from its boundary form.
function fromExt(wType, is64 = false) {
	if (wType === "v128") return [{ op: "call", funcIndex: v128Conv.from }];
	if (wType === "i64") return is64 ? [] : [{ op: "i64.trunc_sat_f64_s" }];
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
function toExt(wType, is64 = false) {
	if (wType === "v128") return [{ op: "call", funcIndex: v128Conv.to }];
	if (wType === "i64") return is64 ? [] : [{ op: "f64.convert_i64_s" }];
	if (isGcRef(wType)) return [{ op: "extern.convert_any" }];
	return [];
}
// Rewrites the values on top of the stack (types `wTypes`) with `conv`,
// spilling through locals starting at `localBase` when more than one.
function convertResults(wTypes, conv, localBase, descs = []) {
	if (wTypes.length === 0 || !needsConv(wTypes, descs)) return [];
	if (wTypes.length === 1) return conv(wTypes[0], descs[0]?.is64);
	const out = [];
	for (let i = wTypes.length - 1; i >= 0; i--)
		out.push({ op: "local.set", index: localBase + i });
	for (let i = 0; i < wTypes.length; i++)
		out.push(
			{ op: "local.get", index: localBase + i },
			...conv(wTypes[i], descs[i]?.is64),
		);
	return out;
}

function zeroInstr(wType) {
	if (wType === "v128")
		return { op: "v128.const", bytes: new Array(16).fill(0) };
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
	if (needs.simd) {
		const { arrInfo } = needs.simd;
		const arrRef = needs.simd.wType;
		v128Conv.to = addFunc(
			"__v128_to",
			["v128"],
			["externref"],
			[
				...[0, 1, 2, 3].flatMap((lane) => [
					get(0),
					{ op: "i32x4.extract_lane", lane },
				]),
				{ op: "array.new_fixed", typeIndex: arrInfo.typeIndex, size: 4 },
				{ op: "extern.convert_any" },
			],
			false,
		);
		v128Conv.from = addFunc(
			"__v128_from",
			["externref"],
			["v128"],
			[
				get(0),
				{ op: "any.convert_extern" },
				{ op: "ref.cast_null", typeIndex: arrInfo.typeIndex },
				{ op: "local.set", index: 1 },
				get(1),
				{ op: "i32.const", value: 0 },
				{ op: "array.get", typeIndex: arrInfo.typeIndex },
				{ op: "i32x4.splat" },
				...[1, 2, 3].flatMap((lane) => [
					get(1),
					{ op: "i32.const", value: lane },
					{ op: "array.get", typeIndex: arrInfo.typeIndex },
					{ op: "i32x4.replace_lane", lane },
				]),
			],
			false,
			[arrRef],
		);
	}
	// Parameter `i` converted from its boundary form.
	const getIn = (i, wType, is64 = false) => [get(i), ...fromExt(wType, is64)];
	const EXT = "externref";

	for (const [name, { info, fields }] of needs.structs) {
		const ref = toRef(info);
		const ti = info.typeIndex;
		const fieldWTypes = info.fields.map((f) => f.wType);
		addFunc(
			`__new_${name}`,
			fieldWTypes.map((w, i) => extType(w, fields[i]?.desc?.is64)),
			[EXT],
			[
				...fieldWTypes.flatMap((w, i) => getIn(i, w, fields[i]?.desc?.is64)),
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
			const is64 = Boolean(fields[i]?.desc?.is64);
			addFunc(
				`__get_${name}_${f.name}`,
				[EXT],
				[extType(f.wType, is64)],
				[
					...getIn(0, ref),
					{ op: "struct.get", typeIndex: ti, fieldIndex: i },
					...toExt(f.wType, is64),
				],
			);
			addFunc(
				`__set_${name}_${f.name}`,
				[EXT, extType(f.wType, is64)],
				[],
				[
					...getIn(0, ref),
					...getIn(1, f.wType, is64),
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
		const is64 = Boolean(desc.elem?.is64);
		addFunc(
			`__array_get_${key}`,
			[EXT, "i32"],
			[extType(arrInfo.elemWType, is64)],
			[
				...getIn(0, ref),
				get(1),
				{ op: "array.get", typeIndex: arrInfo.typeIndex },
				...toExt(arrInfo.elemWType, is64),
			],
		);
		addFunc(
			`__array_set_${key}`,
			[EXT, "i32", extType(arrInfo.elemWType, is64)],
			[],
			[
				...getIn(0, ref),
				get(1),
				...getIn(2, arrInfo.elemWType, is64),
				{ op: "array.set", typeIndex: arrInfo.typeIndex },
			],
		);
	}

	for (const [key, desc] of needs.slices) {
		const { sliceInfo } = desc;
		const ref = desc.wType;
		const arrTI = sliceInfo.arrInfo.typeIndex;
		const sTI = sliceInfo.typeIndex;
		const is64 = Boolean(desc.elem?.is64);
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
			[extType(sliceInfo.elemWType, is64)],
			[
				...elemAddr,
				{ op: "array.get", typeIndex: arrTI },
				...toExt(sliceInfo.elemWType, is64),
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
			[EXT, "i32", extType(sliceInfo.elemWType, is64)],
			[],
			[
				...elemAddr,
				...getIn(2, sliceInfo.elemWType, is64),
				{ op: "array.set", typeIndex: arrTI },
			],
		);
	}

	for (const [key, desc] of needs.funcs) {
		const ci = desc.closureInfo;
		const invokeIdx = mod.importCache.get(`env.__invoke$${key}`);
		const nParams = ci.paramWTypes.length;
		const paramDescs = desc.params ?? [];
		const returnDescs = desc.returns ?? [];
		// Thunk: wasm closure body calling the JS callback (boundary forms out, back in).
		const thunkIdx = addFunc(
			`__jsthunk$${key}`,
			["anyref", ...ci.paramWTypes],
			ci.returnWTypes,
			[
				get(0),
				{ op: "extern.convert_any" },
				...ci.paramWTypes.flatMap((w, i) => [
					get(i + 1),
					...toExt(w, paramDescs[i]?.is64),
				]),
				{ op: "call", funcIndex: invokeIdx },
				...convertResults(ci.returnWTypes, fromExt, nParams + 1, returnDescs),
			],
			false,
			ci.returnWTypes.length > 1
				? ci.returnWTypes.map((w, i) => extType(w, returnDescs[i]?.is64))
				: [],
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
			[EXT, ...ci.paramWTypes.map((w, i) => extType(w, paramDescs[i]?.is64))],
			ci.returnWTypes.map((w, i) => extType(w, returnDescs[i]?.is64)),
			[
				...getIn(0, desc.wType),
				{ op: "struct.get", typeIndex: ci.typeIndex, fieldIndex: 1 },
				...ci.paramWTypes.flatMap((w, i) =>
					getIn(i + 1, w, paramDescs[i]?.is64),
				),
				...getIn(0, desc.wType),
				{ op: "struct.get", typeIndex: ci.typeIndex, fieldIndex: 0 },
				{ op: "call_ref", typeIndex: ci.funcTypeIndex },
				...convertResults(ci.returnWTypes, toExt, nParams + 1, returnDescs),
			],
			true,
			ci.returnWTypes.length > 1 ? ci.returnWTypes : [],
		);
	}

	// Exported user functions / methods whose signature carries i64 or GC refs
	// get a trampoline (`__x_<export>`) with the boundary signature; the facade
	// calls that instead of the raw export.
	const addTrampoline = (entry) => {
		// Methods are keyed `T.M` in funcMap but exported as `T_M`.
		const fnIdx = mod.funcMap.get(entry.fnName ?? entry.exportName);
		if (fnIdx === undefined) return;
		const sig = typeAt(mod, mod.funcs[fnIdx - importFuncCount]?.typeIndex);
		if (sig?.form !== "func") return;
		const paramW = sig.params;
		const resultW = sig.results;
		const paramDescs = entry.params ?? [];
		const resultDescs = entry.returns ?? [];
		if (!needsConv(paramW, paramDescs) && !needsConv(resultW, resultDescs))
			return;
		// Exported names become JS identifiers: no dot of a qualified type.
		entry.callName = `__x_${entry.exportName}`.replaceAll(".", "_");
		addFunc(
			entry.callName,
			paramW.map((w, i) => extType(w, paramDescs[i]?.is64)),
			resultW.map((w, i) => extType(w, resultDescs[i]?.is64)),
			[
				...paramW.flatMap((w, i) => getIn(i, w, paramDescs[i]?.is64)),
				{ op: "call", funcIndex: fnIdx },
				...convertResults(resultW, toExt, paramW.length, resultDescs),
			],
			true,
			resultW.length > 1 ? resultW : [],
		);
	};
	for (const s of meta.structs) for (const m of s.methods) addTrampoline(m);
	for (const f of meta.funcs) addTrampoline(f);
	for (const desc of needs.ifaces.values())
		addIfaceHelpers(desc, mod, addFunc, addTrampoline);

	if (needs.shared) {
		const { wType, typeIndex } = mod.getSharedType();
		addFunc(
			"__shared_base",
			[EXT],
			["i32"],
			[...getIn(0, wType), { op: "struct.get", typeIndex, fieldIndex: 0 }],
		);
		addFunc(
			"__shared_len",
			[EXT],
			["i32"],
			[...getIn(0, wType), { op: "struct.get", typeIndex, fieldIndex: 1 }],
		);
		// JS-side views (e.g. a `subarray`) go back in as a fresh (base, len).
		addFunc(
			"__shared_make",
			["i32", "i32"],
			[EXT],
			[get(0), get(1), { op: "struct.new", typeIndex }, ...toExt(wType)],
		);
		for (const v of meta.vars ?? []) {
			const g = v.shared ? mod.resolveGlobal(v.name) : null;
			if (!g) continue;
			addFunc(
				`__var_${v.name}`,
				[],
				[EXT],
				[{ op: "global.get", index: g.index }, ...toExt(wType)],
			);
		}
	}

	for (const [name, desc] of needs.anonStructs) {
		const { info, fields } = desc;
		const ref = desc.wType;
		const ti = info.typeIndex;
		const fieldWTypes = info.fields.map((f) => f.wType);
		addFunc(
			`__new_${name}`,
			fieldWTypes.map((w, i) => extType(w, fields[i]?.desc?.is64)),
			[EXT],
			[
				...fieldWTypes.flatMap((w, i) => getIn(i, w, fields[i]?.desc?.is64)),
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
		for (let i = 0; i < info.fields.length; i++) {
			const f = info.fields[i];
			const is64 = Boolean(fields[i]?.desc?.is64);
			addFunc(
				`__get_${name}_${f.name}`,
				[EXT],
				[extType(f.wType, is64)],
				[
					...getIn(0, ref),
					{ op: "struct.get", typeIndex: ti, fieldIndex: i },
					...toExt(f.wType, is64),
				],
			);
			addFunc(
				`__set_${name}_${f.name}`,
				[EXT, extType(f.wType, is64)],
				[],
				[
					...getIn(0, ref),
					...getIn(1, f.wType, is64),
					{ op: "struct.set", typeIndex: ti, fieldIndex: i },
				],
			);
		}
	}

	for (const [key, desc] of needs.boxes) {
		const { boxInfo, base } = desc;
		const ref = desc.wType;
		const ti = boxInfo.typeIndex;
		const w = boxInfo.wType;
		const is64 = Boolean(base?.is64);
		addFunc(
			`__box_new_${key}`,
			[extType(w, is64)],
			[EXT],
			[
				...getIn(0, w, is64),
				{ op: "struct.new", typeIndex: ti },
				...toExt(ref),
			],
		);
		const cast = {
			op: "ref.cast",
			typeIndex: boxInfo.typeIndex,
			typeName: boxInfo.name,
		};
		addFunc(
			`__box_get_${key}`,
			[EXT],
			[extType(w, is64)],
			[
				...getIn(0, ref),
				cast,
				{ op: "struct.get", typeIndex: ti, fieldIndex: 0 },
				...toExt(w, is64),
			],
		);
		addFunc(
			`__box_set_${key}`,
			[EXT, extType(w, is64)],
			[],
			[
				...getIn(0, ref),
				cast,
				...getIn(1, w, is64),
				{ op: "struct.set", typeIndex: ti, fieldIndex: 0 },
			],
		);
	}

	for (const [key, desc] of needs.maps) {
		const { mapInfo, keySliceDesc, valSliceDesc, keyDesc, valDesc } = desc;
		const makeIdx = mod.resolveFuncIndex(mapInfo.makeFuncName);
		addFunc(
			`__map_new_${key}`,
			["i32"],
			[EXT],
			[get(0), { op: "call", funcIndex: makeIdx }, ...toExt(desc.wType)],
		);
		const setIdx = mod.resolveFuncIndex(mapInfo.setFuncName);
		addFunc(
			`__map_set_${key}`,
			[
				EXT,
				extType(mapInfo.keyWType, keyDesc?.is64),
				extType(mapInfo.valWType, valDesc?.is64),
			],
			[],
			[
				...getIn(0, desc.wType),
				...getIn(1, mapInfo.keyWType, keyDesc?.is64),
				...getIn(2, mapInfo.valWType, valDesc?.is64),
				{ op: "call", funcIndex: setIdx },
			],
		);
		const keysIdx = mod.resolveFuncIndex(mapInfo.keysFuncName);
		addFunc(
			`__map_keys_${key}`,
			[EXT],
			[EXT],
			[
				...getIn(0, desc.wType),
				{ op: "call", funcIndex: keysIdx },
				...toExt(keySliceDesc.wType),
			],
		);
		const valuesIdx = mod.resolveFuncIndex(mapInfo.valuesFuncName);
		addFunc(
			`__map_values_${key}`,
			[EXT],
			[EXT],
			[
				...getIn(0, desc.wType),
				{ op: "call", funcIndex: valuesIdx },
				...toExt(valSliceDesc.wType),
			],
		);
	}

	if (needs.error) {
		const errDispatcherIdx = mod.funcMap.get("__dispatch_error_Error");
		if (errDispatcherIdx !== undefined) {
			addFunc(
				"__error_msg",
				[EXT],
				[EXT],
				[
					get(0),
					{ op: "ref.is_null" },
					{ op: "if", blockType: "externref" },
					{ op: "ref.null", heapType: "extern" },
					{ op: "else" },
					...getIn(0, "anyref"),
					{ op: "call", funcIndex: errDispatcherIdx },
					...toExt("externref"),
					{ op: "end" },
				],
			);
		}
		const errCandidates = mod
			.findInterfaceCandidates(null, "Error")
			.map((c) => c.testTypeIndex);
		addFunc(
			"__is_error",
			[EXT],
			["i32"],
			refTestChain(errCandidates, () => 1),
		);
	}

	for (const c of meta.consts ?? []) {
		if (!c.dynamic) continue;
		const g = mod.resolveGlobal(c.name);
		if (!g) continue;
		const is64 = Boolean(c.desc?.is64);
		addFunc(
			`__const_${c.name}`,
			[],
			[extType(c.desc.wType, is64)],
			[{ op: "global.get", index: g.index }, ...toExt(c.desc.wType, is64)],
		);
	}
	for (const v of meta.vars ?? []) {
		const g = v.shared ? null : mod.resolveGlobal(v.name);
		if (!g) continue;
		const is64 = Boolean(v.desc?.is64);
		addFunc(
			`__var_${v.name}`,
			[],
			[extType(v.desc.wType, is64)],
			[{ op: "global.get", index: g.index }, ...toExt(v.desc.wType, is64)],
		);
	}
}

// `(externref) -> i32`: `ref.test`s param 0 against each type index and
// returns `resultFor(i)` for the first match, 0 otherwise.
function refTestChain(typeIndices, resultFor) {
	const body = typeIndices.flatMap((ti, i) => [
		{ op: "local.get", index: 0 },
		{ op: "any.convert_extern" },
		{ op: "ref.test", typeIndex: ti },
		{ op: "if", blockType: "void" },
		{ op: "i32.const", value: resultFor(i) },
		{ op: "return" },
		{ op: "end" },
	]);
	body.push({ op: "i32.const", value: 0 });
	return body;
}

// Type indices (incl. unexported and boxed-value types) whose method set
// covers the interface, from the same candidate search the dispatchers use.
function implementingTypeIndices(desc, mod) {
	let acc = null;
	for (const m of desc.methods) {
		const have = new Set(
			mod.findInterfaceCandidates(null, m.name).map((c) => c.testTypeIndex),
		);
		acc = acc === null ? have : new Set([...acc].filter((t) => have.has(t)));
	}
	return [...(acc ?? [])];
}

// Interfaces: method calls go through the existing `ref.test` dispatchers;
// `__impl$<I>` tells whether a wasm value implements I (guards JS inputs);
// `__itag$<I>` reports which exported `*T` (1-based) a value holds, 0 if none.
function addIfaceHelpers(desc, mod, addFunc, addTrampoline) {
	for (const m of desc.methods) {
		const entry = { exportName: m.dispatch };
		addTrampoline(entry);
		if (!entry.callName)
			throw new Error(
				`internal: no wasm dispatcher for interface method ${desc.name}.${m.name}`,
			);
		m.callName = entry.callName;
	}
	addFunc(
		`__impl$${desc.key}`,
		["externref"],
		["i32"],
		refTestChain(implementingTypeIndices(desc, mod), () => 1),
	);
	if (desc.concrete.length === 0) return;
	addFunc(
		`__itag$${desc.key}`,
		["externref"],
		["i32"],
		refTestChain(
			desc.concrete.map((c) => c.typeIndex),
			(i) => i + 1,
		),
	);
}

// ── JS facade generation ─────────────────────────────────────

const P = "__gfw_"; // facade helper prefix

// Pieces of the strings host imports (written for use inside the templates
// below, where a backslash escape must be doubled).
const GO_SPACE =
	"[ \\t\\n\\v\\f\\r\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]";
const BAD_RUNE = "r < 0 || r > 0x10FFFF || (r >= 0xD800 && r <= 0xDFFF)";
const SURROGATE = "(v >= 0xD800 && v <= 0xDFFF)";

// JS expression converting JS value `v` into the wasm representation.
function inExpr(desc, v) {
	switch (desc.k) {
		case "bool":
			return `(${v} ? 1 : 0)`;
		case "i32":
			return `(${v} | 0)`;
		case "i64":
			return desc.is64 ? `BigInt(${v})` : `${P}i64in(${v})`;
		case "f32":
		case "f64":
			return `(+${v})`;
		case "string":
			return `${P}strin(${v})`;
		case "any":
			return `(${v} === undefined ? null : ${v})`;
		case "error":
			return `${P}errin(${v})`;
		case "f32x4":
			return `${P}f32x4in(${v})`;
		case "mask4":
			return `${P}mask4in(${v})`;
		case "map":
			return `${P}mapin_${desc.key}(${v})`;
		case "ptr_box":
			return `${P}boxin_${desc.key}(${v})`;
		case "anon_struct":
			return desc.ptr
				? `(${v} == null ? null : ${P}to_${desc.name}(${v}))`
				: `${P}to_${desc.name}(${v})`;
		case "struct":
			if (desc.info.pkgTarget === "both")
				return `${P}to_${desc.name}(${v}, ${desc.ptr ? "false" : "true"})`;
			return desc.ptr
				? `${P}href_${desc.name}(${v})`
				: `${P}hval_${desc.name}(${v})`;
		case "slice":
			return `${P}slin_${desc.key}(${v})`;
		case "array":
			return `${P}arrin_${desc.key}(${v})`;
		case "func":
			return `${P}fnin_${desc.key}(${v})`;
		case "iface":
			return `${P}ifin_${desc.key}(${v})`;
		case "shared":
			return `${P}shin(${v}, ${desc.ctor})`;
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
			if (desc.is64)
				return desc.unsigned
					? `BigInt.asUintN(64, ${v})`
					: `BigInt.asIntN(64, ${v})`;
			return desc.unsigned ? `${P}u64out(${v})` : `${P}i64out(${v})`;
		case "string":
			return `(${v} ?? "")`;
		case "error":
			return `${P}errout(${v})`;
		case "f32x4":
			return `${P}f32x4out(${v})`;
		case "mask4":
			return `${P}mask4out(${v})`;
		case "map":
			return `${P}mapout_${desc.key}(${v})`;
		case "ptr_box":
			return `${P}boxout_${desc.key}(${v})`;
		case "anon_struct":
			return desc.ptr
				? `(${v} == null ? null : ${P}from_${desc.name}(${v}))`
				: `${P}from_${desc.name}(${v})`;
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
		case "iface":
			return `${P}ifout_${desc.key}(${v})`;
		case "shared":
			return `${P}shout(${v}, ${desc.ctor})`;
		default:
			return v;
	}
}

function zeroExpr(desc) {
	switch (desc.k) {
		case "bool":
			return "false";
		case "i32":
		case "f32":
		case "f64":
			return "0";
		case "i64":
			return desc.is64 ? "0n" : "0";
		case "string":
			return '""';
		case "f32x4":
			return "new Float32Array(4)";
		case "mask4":
			return "[false, false, false, false]";
		case "error":
		case "map":
		case "ptr_box":
			return "null";
		case "anon_struct":
			return desc.ptr
				? "null"
				: `{ ${desc.fields.map((f) => `"${f.name}": ${zeroExpr(f.desc)}`).join(", ")} }`;
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

function isPtrWriteBack(d) {
	return isPtrBoth(d) || d.k === "ptr_box" || (d.k === "anon_struct" && d.ptr);
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
	const writeBack = params.some(isPtrWriteBack);
	if (params.some(isPtrBoth)) lines.push("\tconst __m = new Map();");
	for (let i = 0; i < params.length; i++) {
		const d = params[i];
		if (isPtrBoth(d)) {
			lines.push(`\tconst __p${i} = ${P}to_${d.name}(a${i}, false, __m);`);
			argExprs.push(`__p${i}`);
		} else if (d.k === "ptr_box") {
			lines.push(`\tconst __p${i} = ${P}boxin_${d.key}(a${i});`);
			argExprs.push(`__p${i}`);
		} else if (d.k === "anon_struct" && d.ptr) {
			lines.push(
				`\tconst __p${i} = a${i} == null ? null : ${P}to_${d.name}(a${i});`,
			);
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
			const d = params[i];
			if (isPtrBoth(d)) lines.push(`\t\t${P}back_${d.name}(__p${i}, a${i});`);
			else if (d.k === "ptr_box")
				lines.push(`\t\t${P}boxback_${d.key}(__p${i}, a${i});`);
			else if (d.k === "anon_struct" && d.ptr)
				lines.push(`\t\t${P}back_${d.name}(__p${i}, a${i});`);
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
	// Each instance numbers its pointers and funcs from 1 (see __fmtid).
	if (typeof __fmtptr !== "undefined") __fmtptr = { m: new WeakMap(), n: 1 };
	let lineBuf = "";
	let targs = [];
	let fmtStructMap = new WeakMap();
	// Numbers for the references fmt_ptr_id is asked about.
	const fmtIds = { m: new WeakMap(), n: 1 };
	// A value whose type has String()/Error(): the method already ran in WASM.
	// __gfUnbox hands fmt the raw value for the other verbs.
	class FmtStr { constructor(r, s) { this.r = r; this.s = s; } __gfUnbox() { return this.r; } String() { return this.s; } }
	class FmtErr { constructor(r, s) { this.r = r; this.s = s; } __gfUnbox() { return this.r; } Error() { return this.s; } }
	// A value whose type has GoString(): %#v prints it. Wraps the value as the
	// String/Error layer (if any) left it, so the other verbs are unchanged.
	class FmtGo {
		constructor(r, s) {
			this.r = r;
			this.s = s;
			if (r !== null && typeof r === "object") {
				if (typeof r.String === "function") this.String = () => r.String();
				if (typeof r.Error === "function") this.Error = () => r.Error();
			}
		}
		__gfUnbox() { return this.r !== null && typeof this.r === "object" && typeof this.r.__gfUnbox === "function" ? this.r.__gfUnbox() : this.r; }
		GoString() { return this.s; }
	}
	const late = { exports: null };
	// Go separates operands with a space unconditionally, so track whether the
	// current line already holds an operand (an empty string leaves lineBuf empty).
	let started = false;
	const flush = () => { write(lineBuf); lineBuf = ""; started = false; };
	const print = (v) => {
		const s = Object.is(v, -0) ? "-0" : String(v);
		if (started) lineBuf += " ";
		started = true;
		lineBuf += s;
	};
	const println = (v) => {
		print(v);
		flush();
	};
	const targ = (v) => { targs.push(v); };
	let utf8Encoded = null;
	let convBytes = null, convPos = 0;
	const env = {
		"panicTag": tag,
		"panic": (msg) => {
			let str;
			try {
				str = String(msg);
			} catch {
				str = "[panic object]";
			}
			const err = new Error(str);
			err.__gfp = true;
			throw err;
		},
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
		"str_from_code_point": (c) => String.fromCodePoint(c >= 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? c : 0xfffd),
		"str_code_point_at": (s, i) => (s ? s.codePointAt(i) : 0),
		"str_hash": (s) => {
			if (!s) return 0;
			let h = 0;
			for (let i = 0; i < s.length; i++) {
				h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
			}
			return h;
		},
		"str_to_upper": (s) => ${P}mapCase(s ?? "", "toUpperCase"),
		"str_to_lower": (s) => ${P}mapCase(s ?? "", "toLowerCase"),
		"str_trim_space": (s) => {
			s = s ?? "";
			const sp = /${GO_SPACE}/;
			let i = 0, j = s.length;
			while (i < j && sp.test(s[i])) i++;
			while (j > i && sp.test(s[j - 1])) j--;
			return s.slice(i, j);
		},
		"str_contains": (s, sub) => ((s ?? "").includes(sub ?? "") ? 1 : 0),
		"str_has_prefix": (s, pre) => ((s ?? "").startsWith(pre ?? "") ? 1 : 0),
		"str_has_suffix": (s, suf) => ((s ?? "").endsWith(suf ?? "") ? 1 : 0),
		"os_write": (fd, s) => {
			lineBuf += s ?? "";
			const nl = lineBuf.lastIndexOf("\\n");
			if (nl >= 0) { write(lineBuf.slice(0, nl)); lineBuf = lineBuf.slice(nl + 1); }
		},
		"os_exit": (code) => {
			if (lineBuf !== "") { write(lineBuf); lineBuf = ""; }
			if (typeof process !== "undefined" && process.exit) process.exit(code);
			throw new Error("os.Exit(" + code + ")");
		},
		"os_getenv": (k) => (typeof process !== "undefined" && process.env ? process.env : (globalThis.__os_env ??= {}))[k ?? ""] ?? "",
		"os_setenv": (k, v) => { (typeof process !== "undefined" && process.env ? process.env : (globalThis.__os_env ??= {}))[k ?? ""] = v ?? ""; },
		"unicode_is": (r, k) => { ${unicodeIsJs("r", "k")} },
		"unicode_to_upper": (r) => { ${unicodeToUpperJs("r")} },
		"unicode_to_lower": (r) => { ${unicodeToLowerJs("r")} },
		"fmt_ptr_id": (o) => {
			if (o === null || o === undefined || (typeof o !== "object" && typeof o !== "function")) return 0;
			// The numbering Printf's %p uses, when this module has it.
			if (typeof __fmtid === "function") return __fmtid(o);
			let id = fmtIds.m.get(o);
			if (!id) { id = fmtIds.n++; fmtIds.m.set(o, id); }
			return id;
		},
		"crypto_rand_u32": () => {
			const c = typeof crypto !== "undefined" ? crypto : globalThis.crypto;
			return c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0] | 0 : (Math.random() * 4294967296) | 0;
		},
		"strconv_shortest": (f) => f.toExponential(),
		"strconv_fixed": ${FIXED_FLOAT_JS},
		"strconv_parse_decimal": (s) => Number((s ?? "").replaceAll("_", "")),
		"str_index": (s, sub) => (s ?? "").indexOf(sub ?? ""),
		"str_last_index": (s, sub) => (s ?? "").lastIndexOf(sub ?? ""),
		"str_index_byte": (s, b) => (s ?? "").indexOf(String.fromCharCode(b)),
		"str_last_index_byte": (s, b) => (s ?? "").lastIndexOf(String.fromCharCode(b)),
		"str_index_rune": (s, r) => (${BAD_RUNE} ? -1 : (s ?? "").indexOf(String.fromCodePoint(r))),
		"str_contains_rune": (s, r) => (!(${BAD_RUNE}) && (s ?? "").includes(String.fromCodePoint(r)) ? 1 : 0),
		"str_index_any": (s, cs) => {
			s = s ?? "";
			let m = -1;
			for (const c of (cs ?? "")) {
				const v = c.codePointAt(0);
				if (${SURROGATE}) continue;
				const i = s.indexOf(c);
				if (i >= 0 && (m < 0 || i < m)) m = i;
			}
			return m;
		},
		"str_last_index_any": (s, cs) => {
			s = s ?? "";
			let m = -1;
			for (const c of (cs ?? "")) {
				const v = c.codePointAt(0);
				if (${SURROGATE}) continue;
				const i = s.lastIndexOf(c);
				if (i > m) m = i;
			}
			return m;
		},
		"str_contains_any": (s, cs) => {
			s = s ?? "";
			for (const c of (cs ?? "")) {
				const v = c.codePointAt(0);
				if (!${SURROGATE} && s.includes(c)) return 1;
			}
			return 0;
		},
		"str_count": (s, t) => {
			s = s ?? ""; t = t ?? "";
			if (t === "") return [...s].length + 1;
			let n = 0;
			for (let i = s.indexOf(t); i !== -1; i = s.indexOf(t, i + t.length)) n++;
			return n;
		},
		"str_replace": (s, o, w, n) => ${P}replace(s ?? "", o ?? "", w ?? "", n),
		"str_replace_all": (s, o, w) => ${P}replace(s ?? "", o ?? "", w ?? "", -1),
		"str_trim": (s, c) => ${P}trim(s ?? "", c ?? "", true, true),
		"str_trim_left": (s, c) => ${P}trim(s ?? "", c ?? "", true, false),
		"str_trim_right": (s, c) => ${P}trim(s ?? "", c ?? "", false, true),
		"str_trim_prefix": (s, p) => ((s ?? "").startsWith(p ?? "") ? (s ?? "").slice((p ?? "").length) : (s ?? "")),
		"str_trim_suffix": (s, p) => ((s ?? "").endsWith(p ?? "") ? (s ?? "").slice(0, (s ?? "").length - (p ?? "").length) : (s ?? "")),
		"str_from_i64": (n) => String(n),
		"str_from_i32": (n) => String(n),
		"str_from_f64": (f) => (Object.is(f, -0) ? "-0" : String(f)),
		"is_string": (v) => (typeof v === "string" ? 1 : 0),
		"str_to_bytes": (s) => {
			utf8Encoded = ${P}u8enc(s ?? "");
			return utf8Encoded.length;
		},
		"str_byte_at": (i) => (utf8Encoded ? (utf8Encoded[i] ?? 0) : 0),
		"bytes_to_str_init": (len) => {
			convBytes = new Uint8Array(len);
			convPos = 0;
		},
		"bytes_to_str_push": (b) => {
			if (convBytes && convPos < convBytes.length) {
				convBytes[convPos++] = b & 0xFF;
			}
		},
		"bytes_to_str_finish": () => {
			const res = convBytes ? new TextDecoder().decode(convBytes) : "";
			convBytes = null;
			return res;
		},
		"print_i32": print, "print_i64": print, "print_f32": print, "print_f64": print,
		"print_str": print, "print_any": print,
		"print_u64": (v) => print(BigInt.asUintN(64, v)),
		"println_u64": (v) => println(BigInt.asUintN(64, v)),
		"print_reset": () => { started = false; },
		"print_bool": (b) => print(b !== 0 ? "true" : "false"),
		"println_i32": println, "println_i64": println, "println_f32": println, "println_f64": println,
		"println_str": println, "println_any": println,
		"println_bool": (b) => println(b !== 0 ? "true" : "false"),
		"println_empty": flush,
		"fmt_new_array": () => [],
		"fmt_array_push": (arr, v) => { arr.push(v); },
		"fmt_new_map": () => new Map(),
		"fmt_map_set": (m, k, v) => { m.set(k, v); },
		"fmt_new_struct": (ref, isPtr) => {
			// One object per struct and per kind: a value and a pointer to it
			// in the same call (fmt.Println(&s, s)) must stay distinct.
			const slot = isPtr;
			if (isPtr === 3) {
				const fn = function () {};
				Object.defineProperty(fn, "__pid", { value: __fmtid(ref) });
				return fn;
			}
			if (isPtr === 2) {
				const seenBox = ref !== null && ref !== undefined && typeof ref === "object" ? fmtStructMap.get(ref) : undefined;
				if (seenBox?.[2]) return seenBox[2];
				const b = { value: null, __p: true, __box: true };
				if (ref !== null && ref !== undefined && typeof ref === "object") {
					Object.defineProperty(b, "__pid", { value: __fmtid(ref) });
					if (seenBox) seenBox[2] = b;
					else fmtStructMap.set(ref, [undefined, undefined, b]);
				}
				return b;
			}
			const isRef = ref !== null && ref !== undefined && typeof ref === "object";
			const seen = isRef ? fmtStructMap.get(ref) : undefined;
			if (seen?.[slot]) return seen[slot];
			const o = {};
			Object.defineProperty(o, "__struct", { value: true, configurable: true });
			if (isPtr !== 0) {
				Object.defineProperty(o, "__p", { value: true, configurable: true });
				if (isRef) Object.defineProperty(o, "__pid", { value: __fmtid(ref) });
			}
			if (isRef) {
				if (seen) seen[slot] = o;
				else fmtStructMap.set(ref, slot ? [undefined, o] : [o, undefined]);
			}
			return o;
		},
		"fmt_struct_type": (o, i) => { Object.defineProperty(o, "__tn", { value: stringTable[i], configurable: true }); },
		"fmt_struct_set": (o, k, v) => { o[typeof k === "number" ? stringTable[k] : k] = v; },
		"fmt_box_i32": (v) => v,
		"fmt_box_i64": (v) => (v > ${P}MAX || v < -${P}MAX ? v : Number(v)),
		"fmt_box_u64": (v) => { v = BigInt.asUintN(64, v); return v > ${P}MAX ? v : Number(v); },
		"fmt_box_f64": (v) => v,
		"fmt_box_bool": (v) => v !== 0,
		"fmt_new_stringer": (r, s, kind) => (kind === 2 ? new FmtGo(r, s) : kind !== 0 ? new FmtErr(r, s) : new FmtStr(r, s)),
		"fmt_new_box": () => ({ value: null, __p: true, __box: true }),
		"testing_arg_i32": targ, "testing_arg_f32": targ, "testing_arg_f64": targ,
		"testing_arg_str": targ, "testing_arg_any": targ,
		"testing_arg_i64": (v) => targ(v > ${P}MAX || v < -${P}MAX ? v : Number(v)),
		"testing_arg_bool": (v) => targ(v !== 0),
		"testing_arg_u64": (v) => { v = BigInt.asUintN(64, v); targ(v > ${P}MAX ? v : Number(v)); },
		"fmt_arg_type": (i) => { if (targs.length > 0) targs[targs.length - 1] = __ft(targs[targs.length - 1], JSON.parse(stringTable[i])); },
		"testing_arg_spread": (a) => { if (a) for (const v of a) targs.push(v); },
		"testing_arg_err": (s) => targ(s === null ? null : { Error() { return s; } }),
		"testing_call": (t, i) => { const a = targs; targs = []; fmtStructMap = new WeakMap(); t[stringTable[i]](...a); },
		"testing_name": (t) => t.Name(),
		"testing_flag": (t, i) => Number(t[stringTable[i]]()),
		"testing_n": (t) => BigInt(t.N ?? 0),
		"testing_elapsed": (t) => BigInt(t.Elapsed()),
		"testing_context": (t) => t.Context(),
		"testing_output": (t) => t.Output(),
	};
	// Stdlib imports (strings/strconv/utf8/fmt/t.Run) are a separate block so
	// modules that never call them do not ship it (see WASM_STDLIB_JS).
	if (typeof ${P}stdlib === "function") {
		Object.assign(env, ${P}stdlib(stringTable, {
			"take": () => { const a = targs; targs = []; fmtStructMap = new WeakMap(); return a; },
			"printf": (s) => {
				lineBuf += s;
				const nl = lineBuf.lastIndexOf("\\n");
				if (nl >= 0) { write(lineBuf.slice(0, nl)); lineBuf = lineBuf.slice(nl + 1); }
			},
			"late": late,
		}));
	}
	Object.assign(env, extraEnv);
	// A host import that throws raises a Go panic: the module's panic stack
	// gets the message (as env.panic does through __push_panic) before the
	// error unwinds, so recover() in a calling frame sees it.  Errors already
	// pushed (env.panic, nested calls into the module) are marked and pass
	// through; traps and wasm exceptions are not host panics.
	const hostPanic = (e) => {
		if (e !== null && typeof e === "object") {
			if (e.__gfp === true) return;
			if (typeof WebAssembly !== "undefined" && (e instanceof WebAssembly.Exception || e instanceof WebAssembly.RuntimeError)) return;
			try { e.__gfp = true; } catch {}
		}
		const push = late.exports && late.exports.__push_panic;
		if (push) push(String(e !== null && typeof e === "object" && e.message !== undefined ? e.message : e));
	};
	for (const k of Object.keys(env)) {
		const fn = env[k];
		if (typeof fn !== "function" || k === "panic" || k === "panicTag") continue;
		env[k] = function () {
			try { return fn.apply(this, arguments); } catch (e) { hostPanic(e); throw e; }
		};
	}
	const m = {};
	for (const k of ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "pow", "exp", "log", "log2", "log10", "cbrt", "hypot", "random", "sinh", "cosh", "tanh", "log1p", "expm1"]) m[k] = Math[k];
	m.mod = (x, y) => x % y;
	// Go rounds half away from zero; Math.round rounds half toward +Infinity.
	m.round = (x) => Math.sign(x) * Math.round(Math.abs(x));
	// Exports are needed by imports that call back into the module (t.Run).
	return { "env": env, "Math": m, "__bind": (ex) => { late.exports = ex; } };
}
// string -> bytes: UTF-8, except that a lone surrogate U+DC80-U+DCFF (a raw
// byte from a \\xNN escape in the source) encodes as that single byte.
function ${P}u8enc(s) {
	const e = new TextEncoder();
	if (s.isWellFormed()) return e.encode(s);
	const out = [];
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xdc80 && c <= 0xdcff && !(i > 0 && (s.charCodeAt(i - 1) & 0xfc00) === 0xd800)) { out.push(c - 0xdc00); continue; }
		const cp = s.codePointAt(i);
		if (cp > 0xffff) i++;
		for (const b of e.encode(String.fromCodePoint(cp))) out.push(b);
	}
	return Uint8Array.from(out);
}
// strings.ToUpper/ToLower: letter by letter through the first code point of
// the host's mapping, as unicode.ToUpper/ToLower do; ASCII text maps whole.
function ${P}mapCase(s, method) {
	if (/^[\\x00-\\x7f]*$/.test(s)) return s[method]();
	return Array.from(s, (c) => {
		const m = c[method]();
		const r = String.fromCodePoint(m.codePointAt(0));
		// A letter whose upper case spans several code points (ß) stays as is.
		return method === "toUpperCase" && m.length > r.length ? c : r;
	}).join("");
}
// Code-point-aware Trim/TrimLeft/TrimRight of strings.
function ${P}trim(s, cutset, left, right) {
	if (s === "" || cutset === "") return s;
	const set = new Set(cutset);
	let i = 0, j = s.length;
	if (left) while (i < j) {
		const c = s.codePointAt(i);
		if (!set.has(String.fromCodePoint(c))) break;
		i += c > 0xFFFF ? 2 : 1;
	}
	if (right) while (j > i) {
		let k = j - 1;
		const lo = s.charCodeAt(k);
		if (lo >= 0xDC00 && lo <= 0xDFFF && k > i) {
			const hi = s.charCodeAt(k - 1);
			if (hi >= 0xD800 && hi <= 0xDBFF) k--;
		}
		if (!set.has(s.slice(k, j))) break;
		j = k;
	}
	return s.slice(i, j);
}
// strings.Replace: an empty old string matches before every code point and at
// the end; the replacement is literal.
function ${P}replace(s, o, w, n) {
	if (o === w || n === 0) return s;
	if (o !== "") {
		if (n < 0) return s.replaceAll(o, () => w);
		let r = "", i = 0;
		for (let k = n; k > 0; k--) {
			const j = s.indexOf(o, i);
			if (j < 0) break;
			r += s.slice(i, j) + w;
			i = j + o.length;
		}
		return r + s.slice(i);
	}
	const cs = [...s];
	const m = n < 0 || n > cs.length + 1 ? cs.length + 1 : n;
	let r = "";
	for (let k = 0; k < m; k++) r += (k > 0 ? cs[k - 1] : "") + w;
	return r + cs.slice(m - 1).join("");
}`;

// JS side of the STDLIB_IMPORTS table (index.js); emitted only when the
// module imports one of the packages that use it.
export const WASM_STDLIB_JS = `${HELPER_ERROR}
${HELPER_SPRINTF}
function ${P}stdlib_fmt(stringTable, io) {
	return {
		"testing_run": (t, name, fn) => (t.Run(name, (sub) => { io.late.exports.__testing_run_cb(fn, sub); }) ? 1 : 0),
		"testing_cleanup": (t, fn) => { t.Cleanup(() => { io.late.exports.__testing_cleanup_cb(fn); }); },
		"testing_n": (t) => BigInt(t.N ?? 0),
		"testing_elapsed": (t) => BigInt(t.Elapsed()),
		"testing_context": (t) => t.Context(),
		"testing_output": (t) => t.Output(),
		"fmt_sprintf": (f) => __sprintf(f ?? "", ...io.take()),
		"fmt_printf": (f) => { io.printf(__sprintf(f ?? "", ...io.take())); },
		"fmt_format_v": (v) => { const res = __sprintf("%v", v); io.take(); return res; },
	};
}
function ${P}stdlib_sys(stringTable, io) {
	let trimStart = 0, trimEnd = 0;
	return {
		// bytes trim
		"bytes_trim": (s, cutset, left, right) => {
			const cs = new Set(Array.from(cutset ?? ""));
			const chars = Array.from(s ?? "");
			let a = 0, b = chars.length;
			if (left) while (a < b && cs.has(chars[a])) a++;
			if (right) while (b > a && cs.has(chars[b - 1])) b--;
			const enc = new TextEncoder();
			trimStart = a === 0 ? 0 : enc.encode(chars.slice(0, a).join("")).length;
			trimEnd = b === chars.length ? enc.encode(s ?? "").length : enc.encode(chars.slice(0, b).join("")).length;
		},
		"bytes_trim_start": () => trimStart,
		"bytes_trim_end": () => trimEnd,
		// time
		"time_now_ms": () => (typeof globalThis.__GOFRONT_CLOCK === "function" ? globalThis.__GOFRONT_CLOCK() : Date.now()),
		"time_timezone_offset": (ms) => (-new Date(ms).getTimezoneOffset() * 60) | 0,
	};
}
function ${P}stdlib(stringTable, io) {
	return Object.assign(
		{},
		${P}stdlib_fmt(stringTable, io),
		${P}stdlib_sys(stringTable, io),
	);
}`;

// Runtime loader emitted at the top of the facade.
const wasmLoaderJs = (stdlibEnv) => `${WASM_IMPORTS_JS}
${stdlibEnv ? WASM_STDLIB_JS : ""}
async function ${P}fetch(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error("GoFront: failed to fetch " + url + " (" + res.status + ")");
	return res.arrayBuffer();
}
async function ${P}instantiate(imports) {
	const bytes = globalThis.__GOFRONT_WASM_BYTES;
	if (bytes) return WebAssembly.instantiate(bytes, imports);
	// Resolve relative to the bundle so the app works from any page path.
	const url = globalThis.__GOFRONT_WASM_URL ?? new URL("app.wasm", import.meta.url).href;
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
	imports.__bind(result.instance.exports);
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
// Tags a struct pointer held in an interface (same marker as the JS backend's __ifp).
const ${P}ptag = (h) => {
	if (h !== null && h.__p !== true && Object.isExtensible(h)) Object.defineProperty(h, "__p", { "value": true, "configurable": true });
	return h;
};
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
// A facade binding for a Go name that shadows a browser global carries the
// same `$` suffix as JS output uses (see jsBindingName in backend/js), so the
// flat bundle keeps reaching the real global.
function facadeName(name) {
	return BROWSER_GLOBALS.has(name) ? `${name}$` : name;
}

export function generateFacade(
	meta,
	{ stringTable = [], callMain = false, stdlibEnv = true } = {},
) {
	const needs = meta._needs ?? collectNeeds(meta);
	const out = [wasmLoaderJs(stdlibEnv)];

	// JS callback imports (registered before instantiation; bodies run after).
	out.push(`const ${P}env = {};`);
	for (const [key, desc] of needs.funcs) {
		const names = desc.params.map((_, i) => `a${i}`);
		const hasPtrBox = desc.params.some((d) => d.k === "ptr_box");
		let body;
		if (hasPtrBox) {
			const argVars = desc.params.map((_, i) => `__arg${i}`);
			const decls = desc.params.map(
				(d, i) =>
					`const __arg${i} = ${isPtrBoth(d) ? `${P}view_${d.name}(${names[i]})` : outExpr(d, names[i])};`,
			);
			const call = `fn(${argVars.join(", ")})`;
			const writebacks = desc.params
				.map((d, i) =>
					d.k === "ptr_box"
						? `if (__arg${i} && __arg${i}.value !== undefined) __w.__box_set_${d.key}(${names[i]}, ${inExpr(d.base, `__arg${i}.value`)});`
						: "",
				)
				.filter(Boolean);
			if (desc.returns.length === 0) {
				body = `${decls.join(" ")} ${call}; ${writebacks.join(" ")}`;
			} else if (desc.returns.length === 1) {
				body = `${decls.join(" ")} const __r = ${call}; ${writebacks.join(" ")} return ${inExpr(desc.returns[0], "__r")};`;
			} else {
				body = `${decls.join(" ")} const __r = ${call}; ${writebacks.join(" ")} return [${desc.returns.map((d, i) => inExpr(d, `__r[${i}]`)).join(", ")}];`;
			}
		} else {
			const args = desc.params.map((d, i) =>
				isPtrBoth(d) ? `${P}view_${d.name}(${names[i]})` : outExpr(d, names[i]),
			);
			const call = `fn(${args.join(", ")})`;
			if (desc.returns.length === 0) body = `${call};`;
			else if (desc.returns.length === 1)
				body = `return ${inExpr(desc.returns[0], call)};`;
			else
				body = `const __r = ${call}; return [${desc.returns
					.map((d, i) => inExpr(d, `__r[${i}]`))
					.join(", ")}];`;
		}
		const sig = ["fn", ...names].join(", ");
		out.push(
			`${P}env["__invoke$${key}"] = (${sig}) => { try { ${body} } catch (__e) { if (__w && __w.__push_panic && !(__e && __e.__gfp === true)) { __w.__push_panic(__e.message ?? String(__e)); try { __e.__gfp = true; } catch {} } throw __e; } };`,
		);
	}
	out.push(
		`const __w = await ${P}load(${JSON.stringify(stringTable)}, ${P}env);`,
	);

	for (const [name, { info, fields }] of needs.structs) {
		if (info.pkgTarget === "both") genBothStruct(out, name, fields);
		else {
			const methods = meta.structByName.get(name)?.methods ?? [];
			const promoted = promotedMethods(info, fields, methods, meta);
			genHandleStruct(out, name, fields, methods, promoted);
		}
	}
	genGenericClasses(out, needs, meta._mod);

	for (const [name, desc] of needs.anonStructs) {
		out.push(`function ${P}to_${name}(o) {
	if (o == null) return __w.__zero_${name}();
	return __w.__new_${name}(${desc.fields.map((f) => inExpr(f.desc, `(o.${f.name} ?? ${zeroExpr(f.desc)})`)).join(", ")});
}
function ${P}from_${name}(r) {
	if (r == null) return null;
	return {
${desc.fields.map((f) => `\t\t"${f.name}": ${outExpr(f.desc, `__w.__get_${name}_${f.name}(r)`)}`).join(",\n")}
	};
}
function ${P}back_${name}(r, o) {
	if (r == null || o == null) return;
${desc.fields.map((f) => `\to.${f.name} = ${outExpr(f.desc, `__w.__get_${name}_${f.name}(r)`)};`).join("\n")}
}`);
	}

	for (const [key, desc] of needs.boxes) {
		out.push(`function ${P}boxin_${key}(b) {
	if (b == null) return null;
	if (b.__ref) return b.__ref;
	const v = b.value !== undefined ? b.value : ${zeroExpr(desc.base)};
	return __w.__box_new_${key}(${inExpr(desc.base, "v")});
}
function ${P}boxout_${key}(r) {
	if (r == null) return null;
	return {
		__ref: r,
		get value() { return ${outExpr(desc.base, `__w.__box_get_${key}(r)`)}; },
		set value(v) { __w.__box_set_${key}(r, ${inExpr(desc.base, "v")}); }
	};
}
function ${P}boxback_${key}(r, b) {
	if (r == null || b == null) return;
	b.value = ${outExpr(desc.base, `__w.__box_get_${key}(r)`)};
}`);
	}

	for (const [key, desc] of needs.slices) {
		if (desc.elem.k === "f32x4") {
			// []F32x4 travels as one Float32Array of 4n lanes.
			out.push(`function ${P}slin_${key}(arr) {
	if (arr == null) return __w.__slice_nil_${key}();
	const n = arr.length >> 2;
	const s = __w.__slice_new_${key}(n);
	for (let i = 0; i < n; i++) __w.__slice_set_${key}(s, i, ${P}f32x4in(arr.subarray ? arr.subarray(4 * i, 4 * i + 4) : arr.slice(4 * i, 4 * i + 4)));
	return s;
}
function ${P}slout_${key}(s) {
	if (s == null || __w.__slice_is_nil_${key}(s)) return null;
	const n = __w.__slice_len_${key}(s);
	const out = new Float32Array(4 * n);
	for (let i = 0; i < n; i++) out.set(${P}f32x4out(__w.__slice_get_${key}(s, i)), 4 * i);
	return out;
}
function ${P}slview_${key}(s) {
	return ${P}slout_${key}(s);
}`);
			continue;
		}
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
} `);
	}

	if (needs.maps.size > 0) {
		// GoFront JS code reads a map as a plain object (`m["a"]`, `len(m)`), so
		// each entry is also an own property of the returned Map unless that name
		// is one the Map already has.
		out.push(`function ${P}mapprop(m, k, v) {
	const p = String(k);
	if (!(p in m)) m[p] = v;
}`);
	}
	for (const [key, desc] of needs.maps) {
		out.push(`function ${P}mapin_${key}(m) {
	if (m == null) return null;
	const entries = m instanceof Map ? m.entries() : Object.entries(m);
	const size = m instanceof Map ? m.size : Object.keys(m).length;
	const r = __w.__map_new_${key}(size);
	for (const [k, v] of entries) {
		__w.__map_set_${key}(r, ${desc.keyDesc.k === "bool" ? `(k === "true" || k === true ? 1 : 0)` : inExpr(desc.keyDesc, "k")}, ${inExpr(desc.valDesc, "v")});
	}
	return r;
}
function ${P}mapout_${key}(m) {
	if (m == null) return null;
	const ks = ${P}slout_${desc.keySliceDesc.key}(__w.__map_keys_${key}(m));
	const vs = ${P}slout_${desc.valSliceDesc.key}(__w.__map_values_${key}(m));
	const out = new Map();
	if (ks) {
		for (let i = 0; i < ks.length; i++) {
			out.set(ks[i], vs[i]);
			${P}mapprop(out, ks[i], vs[i]);
		}
	}
	return out;
}`);
	}

	if (needs.simd) {
		const k = needs.simd.key;
		out.push(`function ${P}v4in(words) {
	const a = __w.__array_new_${k}(4);
	for (let i = 0; i < 4; i++) __w.__array_set_${k}(a, i, words[i]);
	return a;
}
function ${P}v4out(a) {
	const words = new Int32Array(4);
	for (let i = 0; i < 4; i++) words[i] = __w.__array_get_${k}(a, i);
	return words;
}
function ${P}f32x4in(v) {
	return ${P}v4in(new Int32Array(new Float32Array(v ?? 4).buffer));
}
function ${P}f32x4out(a) {
	return new Float32Array(${P}v4out(a).buffer);
}
function ${P}mask4in(v) {
	const w = new Int32Array(4);
	if (v) for (let i = 0; i < 4; i++) w[i] = v[i] ? -1 : 0;
	return ${P}v4in(w);
}
function ${P}mask4out(a) {
	return Array.from(${P}v4out(a), (w) => w !== 0);
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
} `);
	}

	for (const [key, desc] of needs.funcs) {
		const { names, body } = genFuncBody(
			`__call_fn$${key}`,
			desc.params,
			desc.returns,
			["c"],
		);
		out.push(`const ${P}fn_j2w_${key} = new WeakMap();
const ${P}fn_w2j_${key} = new WeakMap();
function ${P}fnin_${key}(fn) {
	if (fn == null) return null;
	let c = ${P}fn_j2w_${key}.get(fn);
	if (!c) {
		c = __w.__wrap_fn$${key}(fn);
		${P}fn_j2w_${key}.set(fn, c);
		${P}fn_w2j_${key}.set(c, fn);
	}
	return c;
}
function ${P}fnout_${key}(c) {
	if (c == null) return null;
	let fn = ${P}fn_w2j_${key}.get(c);
	if (!fn) {
		fn = (${names.join(", ")}) => {
${indent(body, "\t")}
		};
		fn.__ref = c;
		${P}fn_w2j_${key}.set(c, fn);
		${P}fn_j2w_${key}.set(fn, c);
	}
	return fn;
}`);
	}

	for (const [key, desc] of needs.ifaces) genIfaceFacade(out, key, desc);

	if (needs.error) {
		out.push(`class ${P}Error extends Error {
	constructor(msg, ref) {
		super(msg);
		this.name = "GoError";
		this._msg = msg;
		this.__ref = ref;
	}
	Error() {
		return this.message;
	}
}
const ${P}err_w2j = new WeakMap();
function ${P}errout(r) {
	if (r == null) return null;
	let e = ${P}err_w2j.get(r);
	if (!e) {
		const msg = __w.__error_msg ? (__w.__error_msg(r) ?? "") : "";
		e = new ${P}Error(msg, r);
		${P}err_w2j.set(r, e);
	}
	return e;
}
function ${P}errin(e) {
	if (e == null) return null;
	if (e.__ref === undefined) throw new TypeError("GoFront: expected a WASM-owned error");
	if (!__w.__is_error(e.__ref)) throw new TypeError("GoFront: value does not implement error");
	return e.__ref;
}`);
	}

	if (needs.shared) {
		// Zero-copy TypedArray views over the exported memory.  Memory never
		// grows after the start function (allocation is startup-only), but the
		// cached view is still re-validated against the live buffer.
		out.push(`const ${P}shc = new WeakMap();
function ${P}shout(r, Ctor) {
	if (r == null) return null;
	let v = ${P}shc.get(r);
	if (!v || v.buffer !== __w.memory.buffer) {
		v = new Ctor(__w.memory.buffer, __w.__shared_base(r), __w.__shared_len(r));
		${P}shc.set(r, v);
	}
	return v;
}
function ${P}shin(v, Ctor) {
	if (v == null) return null;
	if (!(v instanceof Ctor) || v.buffer !== __w.memory.buffer) throw new TypeError("GoFront: expected a " + Ctor.name + " view over the wasm shared memory");
	return __w.__shared_make(v.byteOffset, v.length);
}`);
	}

	for (const c of meta.consts) {
		if (c.dynamic) {
			out.push(
				`const ${facadeName(c.name)} = ${outExpr(c.desc, `__w.__const_${c.name}()`)};`,
			);
		} else {
			out.push(`const ${facadeName(c.name)} = ${c.value};`);
		}
	}
	for (const v of meta.vars ?? [])
		out.push(
			v.shared
				? `const ${facadeName(v.name)} = ${P}shout(__w.__var_${v.name}(), ${v.desc.ctor});`
				: `const ${facadeName(v.name)} = ${outExpr(v.desc, `__w.__var_${v.name}()`)};`,
		);

	for (const f of meta.funcs) {
		const { names, body } = genFuncBody(
			f.callName ?? f.exportName,
			f.params,
			f.returns,
		);
		out.push(
			`function ${facadeName(f.name)}(${restParams(names, f.variadic)}) {\n${body}\n}`,
		);
	}

	if (callMain) out.push("__w.main();");
	return bindExports(out.join("\n"));
}

// A variadic Go function is a slice parameter in wasm; JS callers pass the
// trailing arguments spread, so the facade collects them with a rest param.
function restParams(names, variadic) {
	if (!variadic || names.length === 0) return names.join(", ");
	return [...names.slice(0, -1), `...${names.at(-1)}`].join(", ");
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
	// The one conversion `time.Time` has beyond the ordinary struct rules: JS
	// code may pass a Date (or an object holding one in `_d`), and a Time
	// handed to JS also reads as a Date through `_d`.
	const isTime = name === "Time$$time";
	if (isTime)
		out.push(`function ${P}time_in(o) {
	const d = o instanceof Date ? o : o?._d instanceof Date ? o._d : null;
	if (d === null) return o;
	const ms = d.getTime();
	const off = typeof o._offset === "number" ? o._offset : -d.getTimezoneOffset() * 60;
	const sec = Math.floor(ms / 1000);
	return new Time$$time(BigInt(sec) + 62135596800n, (ms - sec * 1000) * 1000000, new Location$$time("", off, 0));
}
function ${P}time_out(t) {
	Object.defineProperty(t, "_d", { configurable: true, get() { return new Date(Number(this.sec - 62135596800n) * 1000 + Math.floor(this.nsec / 1000000)); } });
	Object.defineProperty(t, "_offset", { configurable: true, get() { return this.loc ? this.loc.offset : 0; } });
	return t;
}`);
	out.push(`function ${P}to_${name}(o, isValue, m) {
${isTime ? `\to = ${P}time_in(o);\n` : ""}	if (o == null) return isValue ? __w.__zero_${name}() : null;
	if (m) { const hit = m.get(o); if (hit) return hit; }
	const r = __w.__new_${name}(${toArgs.join(", ")});
	if (m) m.set(o, r);
	return r;
}
function ${P}from_${name}(r) {
	if (r == null) return null;
	return ${isTime ? `${P}time_out(new ${name}(${fromArgs.join(", ")}))` : `new ${name}(${fromArgs.join(", ")})`};
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

function genIfaceFacade(out, key, desc) {
	const methods = desc.methods.map((m) => {
		const { names, body } = genFuncBody(m.callName, m.params, m.returns, [
			"this.__ref",
		]);
		return `\t${m.name}(${names.join(", ")}) {\n${indent(body, "\t")}\n\t}`;
	});
	const cases = desc.concrete.map((c, i) => {
		const wrap = c.both ? `${P}view_${c.name}(r)` : `${c.name}.__wrap(r)`;
		return `\t\tcase ${i + 1}: return ${P}ptag(${wrap});`;
	});
	const tag =
		cases.length > 0
			? `\tswitch (__w.__itag$${key}(r)) {\n${cases.join("\n")}\n\t}\n`
			: "";
	const msg = `GoFront: a JS-implemented value cannot cross into wasm as interface '${desc.name}'; implement it in a wasm package or pass a func callback`;
	const implMsg = `GoFront: wasm value does not implement interface '${desc.name}'`;
	out.push(`class ${P}I_${key} {
	constructor(r) { this.__ref = r; }
${methods.join("\n")}
}
const ${P}ic_${key} = new WeakMap();
function ${P}ifout_${key}(r) {
	if (r == null) return null;
${tag}	let o = ${P}ic_${key}.get(r);
	if (!o) { o = new ${P}I_${key}(r); ${P}ic_${key}.set(r, o); }
	return o;
}
function ${P}ifin_${key}(v) {
	if (v == null) return null;
	if (v.__ref === undefined) throw new TypeError(${JSON.stringify(msg)});
	if (!__w.__impl$${key}(v.__ref)) throw new TypeError(${JSON.stringify(implMsg)});
	return v.__ref;
}`);
}

// Methods a struct gets from its embedded structs, shallowest first (a name
// found twice at one depth is ambiguous and left out).  Each is forwarded
// through the embedded field's getter: `{ name, via, params, variadic }`.
function promotedMethods(info, fields, methods, meta) {
	const taken = new Set([
		...methods.map((m) => m.name),
		...fields.map((f) => f.name),
	]);
	const promoted = [];
	const seen = new Set([info]);
	let level = [{ info, via: "" }];
	while (level.length > 0) {
		const next = [];
		const found = new Map();
		for (const { info: owner, via } of level) {
			for (const e of owner.embeds ?? []) {
				const typeName = e.typeName ?? e.name;
				const path = `${via}.${e.name}`;
				const inner = meta._mod.getStructType(typeName);
				const innerMethods =
					meta.structByName.get(typeName.replaceAll(".", "$"))?.methods ?? [];
				for (const m of innerMethods) {
					if (!found.has(m.name)) found.set(m.name, []);
					found.get(m.name).push({
						name: m.name,
						via: path,
						params: m.params,
						variadic: m.variadic,
					});
				}
				if (inner && !seen.has(inner)) {
					seen.add(inner);
					next.push({ info: inner, via: path });
				}
			}
		}
		for (const [n, c] of found) {
			if (!taken.has(n) && c.length === 1) promoted.push(c[0]);
			taken.add(n);
		}
		level = next;
	}
	return promoted;
}

// A generic struct is built in a js main as `new Box(V, [...zeroFactories,
// "int"])`; the facade only has the instances (`Box$int`).  `Box` picks the
// instance named by the last type-argument entry (the printed type arguments).
function genGenericClasses(out, needs, mod) {
	const groups = new Map();
	for (const [name, { info }] of needs.structs) {
		if (info.pkgTarget === "both") continue;
		const goName = mod?.checker?.types?.get(info.name)?._goName;
		const m = goName ? /^([^[]+)\[(.*)\]$/s.exec(goName) : null;
		if (!m) continue;
		if (!groups.has(m[1])) groups.set(m[1], new Map());
		// The js caller keys instances by the unqualified printed arguments.
		groups
			.get(m[1])
			.set(m[2].replaceAll(" ", "").replace(/(?<![\w.])main\./g, ""), name);
	}
	for (const [base, instances] of groups) {
		const table = [...instances]
			.map(([id, cls]) => `${JSON.stringify(id)}: ${cls}`)
			.join(", ");
		out.push(`class ${facadeName(base)} {
	constructor(...a) {
		const tz = a.at(-1);
		const id = Array.isArray(tz) && typeof tz.at(-1) === "string" ? tz.at(-1).replaceAll(" ", "") : undefined;
		const C = id === undefined ? ${instances.size === 1 ? `${[...instances.values()][0]}` : "undefined"} : { ${table} }[id];
		if (!C) throw new TypeError("GoFront: no ${base} instance for the type arguments " + id + " in the wasm package");
		return new C(...(Array.isArray(tz) ? a.slice(0, -1) : a));
	}
}`);
	}
}

function genHandleStruct(out, name, fields, methods, promoted = []) {
	// `$`-suffixed params keep the mangler from renaming the matching getters.
	const ctorParams = fields.map((f) => `${f.name}$ = ${zeroExpr(f.desc)}`);
	const ctorArgs = fields.map((f) => inExpr(f.desc, `${f.name}$`));
	const fromArgs = fields.map((f) => `o.${f.name}`);
	const ptrMsg = `GoFront: expected a ${name} handle for a *${name} parameter (use ${name}.from(obj) to create one)`;
	const lines = [
		`const ${P}h_${name} = new WeakMap();
function ${P}hval_${name}(h) {
	if (h == null) return __w.__zero_${name}();
	if (h.__ref !== undefined) return __w.__clone_${name}(h.__ref);
	return ${name}.from(h).__ref;
}
function ${P}href_${name}(h) {
	if (h == null) return null;
	if (h.__ref !== undefined) return h.__ref;
	throw new TypeError(${JSON.stringify(ptrMsg)});
}
class ${name} {
	constructor(${ctorParams.join(", ")}) {
		this.__ref = __w.__new_${name}(${ctorArgs.join(", ")});
		${P}h_${name}.set(this.__ref, this);
	}
	static from(o) { return new ${name}(${fromArgs.join(", ")}); }
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
			`\t${m.name}(${restParams(names, m.variadic)}) {\n${indent(body, "\t")}\n\t}`,
		);
	}
	for (const m of promoted) {
		const names = m.params.map((_, i) => `a${i}`);
		lines.push(
			`\t${m.name}(${restParams(names, m.variadic)}) { return this${m.via}.${m.name}(${restParams(names, m.variadic)}); }`,
		);
	}
	lines.push("}");
	out.push(lines.join("\n"));
}
