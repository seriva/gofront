// src/backend/wasm/types.js
// Maps GoFront types to WasmGC types and manages type registry.

import { SHARED_KINDS } from "../../typechecker/stdlib/shared.js";
import {
	ERROR,
	embeddedFieldName,
	isComplex,
	isComplex64,
	STRING,
} from "../../typechecker/types.js";
import { namedBase, namedUnderlying } from "../shared/named-underlying.js";

export { isComplex, isComplex64 };

// The interface an uncaught `panic` value is tested against to print its
// `String()` (after `error`), and the dispatcher that calls it.
export const PANIC_STRINGER = {
	kind: "interface",
	methods: new Map([
		["String", { kind: "func", params: [], returns: [STRING], async: false }],
	]),
};
export const PANIC_STRINGER_DISPATCH = "__dispatch___panic_String";

// Name of the runtime's `*runtime.PanicNilError` struct, the value a
// `panic` with a nil interface raises (see `panicsWithNil`).
export const PANIC_NIL_STRUCT = "__panicNilError";
export const PANIC_NIL_TEXT = "panic called with nil argument";
export const PANIC_NIL_TYPE_NAME = "*runtime.PanicNilError";

// Name of the runtime's error struct (`errors.New`, `fmt.Errorf`, strconv).
export const ERROR_STRUCT = "__errorString";

export function toWasmType(goType, checker = null, mod = null) {
	if (!goType) return "i32";
	if (typeof goType === "string") {
		if (
			goType === "i32" ||
			goType === "i64" ||
			goType === "f32" ||
			goType === "f64" ||
			goType === "v128" ||
			goType === "anyref" ||
			goType === "externref" ||
			goType === "funcref"
		) {
			return goType;
		}
	}
	if (typeof goType === "object" && goType.kind === "ref") {
		return goType;
	}

	if (
		goType.kind === "simd" ||
		(goType.kind === "named" &&
			(goType.name === "simd.F32x4" ||
				goType.name === "F32x4" ||
				goType.underlying?.kind === "simd"))
	) {
		return "v128";
	}

	// Pointer AST nodes
	if (goType.kind === "PointerType") {
		return toWasmType({ kind: "pointer", base: goType.base }, checker, mod);
	}
	if (goType.kind === "StarExpr") {
		return toWasmType(
			{ kind: "pointer", base: goType.expr ?? goType.operand },
			checker,
			mod,
		);
	}

	// Slice, Array, and Map AST nodes
	if (goType.kind === "SliceType") {
		return toWasmType({ kind: "slice", elem: goType.elem }, checker, mod);
	}
	if (goType.kind === "ArrayType") {
		return toWasmType({ kind: "array", elem: goType.elem }, checker, mod);
	}
	if (goType.kind === "MapType") {
		return toWasmType(
			{ kind: "map", key: goType.key, value: goType.value ?? goType.elem },
			checker,
			mod,
		);
	}

	// TypeName AST node
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		if (goType.name === "simd.F32x4" || goType.name === "F32x4") {
			return "v128";
		}
		if (mod?.getStructType(goType.name)) {
			return {
				kind: "ref",
				nullable: true,
				typeIndex: mod.getStructType(goType.name).typeIndex,
			};
		}
		const resolved = checker?.types?.get(goType.name);
		if (resolved) {
			return toWasmType(resolved, checker, mod);
		}
		return toWasmType({ kind: "basic", name: goType.name }, checker, mod);
	}

	// Unwrap named types
	if (goType.kind === "named") {
		if (
			goType.name === "simd.F32x4" ||
			goType.name === "F32x4" ||
			goType.underlying?.kind === "simd"
		) {
			return "v128";
		}
		// An instance written `Box[int]` is the monomorphised struct `Box$int`.
		const instance = goType.typeArgs?.length
			? mod?.getStructType(`${goType.name}$${instanceArgsKey(goType.typeArgs)}`)
			: null;
		const struct = instance ?? mod?.getStructType(goType.name);
		if (struct) {
			return {
				kind: "ref",
				nullable: true,
				typeIndex: struct.typeIndex,
			};
		}
		if (goType.underlying) {
			return toWasmType(goType.underlying, checker, mod);
		}
		// A bare `{ kind: "named", name }` (method receivers): look it up.
		const under = namedUnderlying(goType, checker);
		if (under) return toWasmType(under, checker, mod);
	}

	// Untyped constants
	if (goType.kind === "untyped") {
		switch (goType.base) {
			case "int":
				return "i64"; // Default Go integer is int (i64 in WASM subset)
			case "float64":
				return "f64";
			case "string":
				return "externref";
			case "bool":
				return "i32";
			case "complex128":
				if (mod?.getComplexType) {
					const info = mod.getComplexType("complex128");
					return {
						kind: "ref",
						nullable: true,
						typeIndex: info.typeIndex,
						typeName: info.name,
					};
				}
				return { kind: "ref", nullable: true, heapType: "struct" };
			default:
				return "i64";
		}
	}

	if (goType.kind === "basic") {
		switch (goType.name) {
			case "bool":
			case "int8":
			case "int16":
			case "int32":
			case "uint8":
			case "uint16":
			case "uint32":
			case "byte":
			case "rune":
				return "i32";

			case "int":
			case "uint":
			case "int64":
			case "uint64":
			case "uintptr":
				return "i64";

			case "float32":
				return "f32";

			case "float64":
				return "f64";

			case "complex64": {
				if (mod?.getComplexType) {
					const info = mod.getComplexType("complex64");
					return {
						kind: "ref",
						nullable: true,
						typeIndex: info.typeIndex,
						typeName: info.name,
					};
				}
				return { kind: "ref", nullable: true, heapType: "struct" };
			}

			case "complex128": {
				if (mod?.getComplexType) {
					const info = mod.getComplexType("complex128");
					return {
						kind: "ref",
						nullable: true,
						typeIndex: info.typeIndex,
						typeName: info.name,
					};
				}
				return { kind: "ref", nullable: true, heapType: "struct" };
			}

			case "string":
				return "externref";

			case "any":
			case "error":
				return "anyref";

			case "void":
				return null;

			default:
				return "i64";
		}
	}

	if (goType.kind === "pointer") {
		// Struct pointer or boxed scalar
		if (goType.base) {
			const baseWType = toWasmType(goType.base, checker, mod);
			if (
				typeof baseWType === "object" &&
				baseWType !== null &&
				baseWType.kind === "ref" &&
				// A pointer to a slice or map goes through the scalar box:
				// the pointee is a replaceable reference value.
				!isReplaceableRef(goType.base, checker)
			) {
				return baseWType;
			}
			if (mod?.getPtrType) {
				const ptr = mod.getPtrType(goType.base);
				if (mod.getBoxType) mod.getBoxType(goType.base);
				if (ptr)
					return {
						kind: "ref",
						nullable: true,
						typeIndex: ptr.typeIndex,
						typeName: ptr.name,
					};
			} else if (mod?.getBoxType) {
				const box = mod.getBoxType(goType.base);
				if (box)
					return {
						kind: "ref",
						nullable: true,
						typeIndex: box.typeIndex,
						typeName: box.name,
					};
			}
		}
		return { kind: "ref", nullable: true, heapType: "any" };
	}

	if (goType.kind === "shared") {
		if (mod?.getSharedType)
			return {
				kind: "ref",
				nullable: true,
				typeIndex: mod.getSharedType().typeIndex,
			};
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (goType.kind === "slice") {
		if (mod?.getSliceType && goType.elem) {
			const sliceInfo = mod.getSliceType(goType.elem);
			return {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
		}
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (goType.kind === "array") {
		if (mod?.getArrayType && goType.elem) {
			const arrInfo = mod.getArrayType(goType.elem);
			return {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
		}
		return { kind: "ref", nullable: true, heapType: "array" };
	}

	if (goType.kind === "map") {
		const key = goType.key;
		const val = goType.value ?? goType.elem;
		if (mod?.getMapType && key && val) {
			const mapInfo = mod.getMapType(key, val);
			return {
				kind: "ref",
				nullable: true,
				typeIndex: mapInfo.typeIndex,
			};
		}
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (goType.kind === "struct" || goType.kind === "StructType") {
		if (goType.name && mod?.getStructType(goType.name)) {
			return {
				kind: "ref",
				nullable: true,
				typeIndex: mod.getStructType(goType.name).typeIndex,
			};
		}
		if (mod?.getAnonStructType && goType.fields) {
			const info = mod.getAnonStructType(structFieldList(goType, checker));
			return { kind: "ref", nullable: true, typeIndex: info.typeIndex };
		}
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (isFuncType(goType, checker)) {
		if (mod) {
			const closureInfo = mod.getClosureType(goType);
			return {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			};
		}
		return "funcref";
	}

	if (goType.kind === "interface" || goType.kind === "InterfaceType") {
		return "anyref";
	}

	return "i32";
}

export function getInterfaceMethodList(iface) {
	if (!iface) return [];
	if (iface.methods instanceof Map) {
		return Array.from(iface.methods.entries()).map(([name, sig]) => ({
			name,
			params: variadicAsSlice(
				(sig.params ?? []).map((p) => p.type ?? p),
				sig.variadic,
			),
			returns: (sig.returns ?? []).map((r) => r.type ?? r),
		}));
	}
	if (Array.isArray(iface.methods)) {
		return iface.methods.map((m) => ({
			name: m.name?.value ?? m.name ?? m,
			params: (m.params ?? []).map((p) =>
				p.variadic ? { kind: "SliceType", elem: p.type } : (p.type ?? p),
			),
			returns: m.returnType
				? m.returnType.kind === "TupleType" || m.returnType.kind === "tuple"
					? m.returnType.types
					: [m.returnType]
				: [],
		}));
	}
	return [];
}

// The type-argument part of a monomorphised name (see monomorph.js typeKey).
function instanceArgsKey(typeArgs) {
	return typeArgs.map(goTypeKey).join("$");
}

// The declared fields of a struct type, in order: { name, goType, embedded,
// typeName }. This is the one list every layout, key, hashability and boundary
// decision reads, so a struct built in one place is read correctly in another.
// It never holds promoted fields: an embedded field is one entry named after
// its type, with `typeName` the specialised struct name of a generic instance
// (`Inner$int`) or qualified type.
export function structFieldList(t, checker = null) {
	const out = [];
	const embeddedEntry = (type, name) => {
		const inner =
			type?.kind === "pointer" || type?.kind === "PointerType"
				? type.base
				: type;
		const ref = inner?.name;
		const bare = (name ?? ref ?? "").split("$")[0].split(".").pop();
		const typeName = (ref && checker?.types?.get(ref)?.name) ?? ref;
		return {
			name: bare,
			goType: type,
			embedded: true,
			typeName: typeName ?? bare,
		};
	};
	if (Array.isArray(t._structFields)) {
		for (const f of t._structFields) {
			if (f.embedded) {
				out.push(embeddedEntry(f.type, embeddedFieldName(f) || undefined));
			} else {
				for (const n of f.names ?? [])
					out.push({ name: n, goType: f.type, embedded: false });
			}
		}
	} else if (Array.isArray(t.fields)) {
		for (const f of t.fields) {
			if (f.embedded) {
				out.push(embeddedEntry(f.type, f.embeddedName ?? f.name));
			} else {
				const names = f.names ?? (f.name ? [f.name] : []);
				for (const n of names)
					out.push({ name: n, goType: f.type ?? f.goType, embedded: false });
			}
		}
	} else if (t.fields instanceof Map) {
		for (const [k, v] of t.fields.entries())
			out.push({ name: k, goType: v, embedded: false });
	}
	return out;
}

// A name inside a type key. Go identifiers are letters, digits and `_`, so
// doubling `_` frees a lone `_` to introduce the structural tokens below
// (`_s` separator, `_c` colon, `_o`/`_q` open/close, `_d` dot); any other
// character becomes `_x<hex>_`. A name that equals a constructor word (`sl`,
// `map`, ...) ends in `$`, which no Go name has, so a key reads back one way
// and two distinct types never share one. `$` itself is kept: it joins a
// generic instance to its type arguments (`Box$int`).
const KEY_WORDS = new Set([
	"ptr",
	"sl",
	"arr",
	"map",
	"fn",
	"fnv",
	"tup",
	"struct",
	"iface",
]);

function keyName(name) {
	let out = "";
	for (const ch of String(name)) {
		if (ch === "_") out += "__";
		else if (ch === ".") out += "_d";
		else if (/[A-Za-z0-9$]/.test(ch) || ch.charCodeAt(0) > 127) out += ch;
		else out += `_x${ch.codePointAt(0).toString(16)}_`;
	}
	return KEY_WORDS.has(out) ? `${out}$` : out;
}

const keyList = (keys) => `_o${keys.join("_s")}_q`;

// The key of a struct's field list, as `goTypeKey` builds it for a struct
// type; `getAnonStructType` names an anonymous struct's layout after it. Tags
// are not part of it.
export function structFieldsKey(fields) {
	return `struct${keyList(
		fields.map(
			(f) =>
				`${f.embedded ? "E" : "F"}${keyName(f.name)}_c${goTypeKey(f.goType)}`,
		),
	)}`;
}

function interfaceKey(t) {
	const methods = getInterfaceMethodList(t)
		.map(
			(m) =>
				`${keyName(m.name)}_c${keyList(m.params.map(goTypeKey))}${keyList(m.returns.map(goTypeKey))}`,
		)
		.sort();
	// A parsed interface lists embedded interfaces apart.
	const embeds = (t.embeds ?? []).map((e) => `E${goTypeKey(e)}`).sort();
	const all = [...methods, ...embeds];
	return all.length === 0 && !t.unionConstraint
		? "any"
		: `iface${keyList(all)}${t.unionConstraint ? "_u" : ""}`;
}

// The one key for a type on `wasm`: identical types give one key, distinct
// types distinct keys, and every key is a valid JS and wasm identifier. It
// names layouts and instances (`Box$sl_int`, `__anon_struct_o...`).
export function goTypeKey(t) {
	if (!t) return "any";
	if (typeof t === "string") {
		if (t === "byte") return "uint8";
		if (t === "rune") return "int32";
		return keyName(t);
	}
	if (t.kind === "basic" || t.kind === "TypeName" || t.kind === "Ident") {
		const name = t.name ?? "any";
		if (name === "byte") return "uint8";
		if (name === "rune") return "int32";
		return keyName(name);
	}
	if (t.kind === "untyped") {
		return keyName(t.base ?? "int");
	}
	if (t.kind === "pointer" || t.kind === "PointerType") {
		return `ptr_${goTypeKey(t.base)}`;
	}
	if (t.kind === "StarExpr") {
		return `ptr_${goTypeKey(t.expr ?? t.operand)}`;
	}
	if (t.kind === "slice" || t.kind === "SliceType") {
		return `sl_${goTypeKey(t.elem)}`;
	}
	if (t.kind === "array" || t.kind === "ArrayType") {
		const sz =
			typeof t.size === "number" ? t.size : (t.size?.value ?? t.len ?? "");
		return `arr_${sz}_${goTypeKey(t.elem)}`;
	}
	if (t.kind === "map" || t.kind === "MapType") {
		return `map_${goTypeKey(t.key ?? t.keyType)}_${goTypeKey(t.value ?? t.val ?? t.elem ?? t.valueType ?? t.valType)}`;
	}
	// Func types differ by signature (`[2]func()` is not `[2]func(int) bool`).
	// A checker func lists the element type of a variadic parameter, like a
	// parsed `FuncType`.
	if (t.kind === "func" || t.kind === "FuncType") {
		const parsed = t.kind === "FuncType";
		const params = (t.params ?? []).map((p) => goTypeKey(parsed ? p.type : p));
		const variadic = parsed ? t.params?.at(-1)?.variadic : t.variadic;
		let rets;
		if (parsed) {
			const rt = t.returnType;
			rets = !rt ? [] : rt.kind === "TupleType" ? rt.types : [rt];
		} else {
			rets = (t.returns ?? []).filter(
				(r) => !(r?.kind === "basic" && r.name === "void"),
			);
		}
		return `fn${variadic ? "v" : ""}${keyList(params)}${keyList(rets.map(goTypeKey))}`;
	}
	if (t.kind === "tuple" || t.kind === "TupleType")
		return `tup${keyList((t.types ?? []).map(goTypeKey))}`;
	if (t.kind === "struct" || t.kind === "StructType") {
		if (t.name) return keyName(t.name);
		return structFieldsKey(structFieldList(t));
	}
	if (t.kind === "interface" || t.kind === "InterfaceType") {
		if (t.name) return keyName(t.name);
		return interfaceKey(t);
	}
	// A parsed instance `Box[int]` is the monomorphised `Box$int`.
	if (t.kind === "GenericTypeName") {
		const args = instanceArgsKey(t.typeArgs ?? []);
		return args ? `${keyName(t.name)}$${args}` : keyName(t.name);
	}
	if (t.kind === "named") {
		// An instance of a generic type is the monomorphised `Box$int`.
		if (t.name && t.typeArgs?.length && !t.name.includes("$"))
			return `${keyName(t.name)}$${instanceArgsKey(t.typeArgs)}`;
		if (t.name) return keyName(t.name);
		return t.underlying ? goTypeKey(t.underlying) : "any";
	}
	if (t.name) return keyName(t.name);
	return keyName(t.kind ?? "any");
}

export function anonIfaceName(iface, _checker = null, _mod = null) {
	const methods = getInterfaceMethodList(iface);
	methods.sort((a, b) => a.name.localeCompare(b.name));
	const parts = methods.map((m) => {
		const ps = m.params.map((p) => goTypeKey(p)).join("_");
		const rs = m.returns.map((r) => goTypeKey(r)).join("_");
		return `${m.name}_${ps}_${rs}`;
	});
	const key = parts.join("__").replace(/[^a-zA-Z0-9_]/g, "_");
	return `anon_iface_${key}`;
}

export function isStructType(goType, checker = null, mod = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		if (mod?.getStructType?.(goType.name)) return true;
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isStructType(resolved, checker, mod);
	}
	if (goType.kind === "named") {
		if (mod?.getStructType?.(goType.name)) return true;
		if (goType.underlying) return isStructType(goType.underlying, checker, mod);
	}
	return goType.kind === "struct" || goType.kind === "StructType";
}

// The type a pointer type points at, looking through defined types
// (`type P *int`, `type PS *S`); null when `goType` is not a pointer type.
export function pointerBase(goType, checker = null) {
	const t = namedBase(goType, checker);
	if (t?.kind === "PointerType" || t?.kind === "pointer") return t.base ?? null;
	if (t?.kind === "StarExpr") return t.expr ?? t.operand ?? null;
	return null;
}

export function isPointerToStruct(goType, checker = null, mod = null) {
	if (!goType) return false;
	const base = pointerBase(goType, checker);
	return base != null && isStructType(base, checker, mod);
}

// Slices, maps and pointers are reference values that an assignment through a
// pointer replaces (a nil map becomes a new one, `*pp = q` repoints `p`),
// unlike structs and arrays, whose pointer is the value's own reference.
function isReplaceableRef(goType, checker) {
	let t = goType;
	if (t?.kind === "TypeName" && checker?.types?.has(t.name))
		t = checker.types.get(t.name);
	if (t?.kind === "named" && t.underlying) t = t.underlying;
	return (
		isSliceType(goType, checker) ||
		isMapType(goType, checker) ||
		isComplex(goType) ||
		t?.kind === "pointer" ||
		t?.kind === "PointerType"
	);
}

export function isScalarType(goType, checker = null, mod = null) {
	if (!goType) return false;
	// A slice or map is a pointee "scalar": the pointer to it is a
	// box, so the pointee can be replaced (`*p = make(...)`).
	if (isReplaceableRef(goType, checker)) return true;
	if (
		isStructType(goType, checker, mod) ||
		isArrayType(goType, checker) ||
		isMapType(goType, checker) ||
		isFuncType(goType, checker) ||
		isComplex(goType)
	) {
		return false;
	}
	const wType = toWasmType(goType, checker, mod);
	if (typeof wType === "object" && wType !== null && wType.kind === "ref") {
		return false;
	}
	return true;
}

export function isSliceType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isSliceType(resolved, checker);
	}
	if (goType.kind === "named") return isSliceType(namedBase(goType, checker));
	return goType.kind === "slice" || goType.kind === "SliceType";
}

// Element kinds whose slices share one WebAssembly representation (a slice of
// i32, or of i64 for the 64-bit integers), so `[]bool`, `[]byte`, `[]rune` and
// `[]int` vs `[]int64` cannot be told apart by `ref.test`.
const TAGGED_SLICE_ELEMS = new Set([
	"int",
	"int64",
	"uint",
	"uint64",
	"uintptr",
	"bool",
	"int8",
	"int16",
	"int32",
	"uint8",
	"uint16",
	"uint32",
	"byte",
	"rune",
]);

// True for a defined slice type, a slice of booleans or integers, or a slice
// of a method interface.  In an
// interface such a value carries a per-Go-type tag (see getTaggedSliceType).
export function isTaggedSliceType(goType, checker = null) {
	if (!isSliceType(goType, checker)) return false;
	// A defined slice type (`type S []int`) is tagged whatever its element, so
	// `case S` does not match an unnamed `[]int`.
	const declared =
		goType.kind === "TypeName" || goType.kind === "Ident"
			? (checker?.types?.get(goType.name) ?? goType)
			: goType;
	if (declared?.kind === "named") return true;
	let elem = getSliceElemType(goType, checker);
	// A source-level element (`uint8` in a case list) is a TypeName node.
	for (let i = 0; i < 16 && elem; i++) {
		if (elem.kind === "named") elem = namedBase(elem, checker);
		else if (elem.kind === "TypeName" || elem.kind === "Ident")
			elem = checker?.types?.get(elem.name) ?? {
				kind: "basic",
				name: elem.name,
			};
		else break;
	}
	// A slice of a method interface (`[]error`) is a slice of `anyref` like
	// `[]any`, and `[]fmt.Stringer` another one.  `[]any` and `[]interface{}`
	// are the same type, so neither is tagged.
	if (isNonEmptyInterface(elem, checker)) return true;
	return elem?.kind === "basic" && TAGGED_SLICE_ELEMS.has(elem.name);
}

export function getSliceElemType(t, checker = null) {
	if (!t) return null;
	if (t.elem) return t.elem;
	if (t.kind === "named") return getSliceElemType(namedBase(t, checker));
	if (t.underlying) return getSliceElemType(t.underlying, checker);
	if (t.kind === "TypeName" && checker?.types?.has(t.name)) {
		return getSliceElemType(checker.types.get(t.name), checker);
	}
	return null;
}

function _sliceElemBaseName(goType, checker = null) {
	if (!isSliceType(goType, checker)) return null;
	const elem = getSliceElemType(goType, checker);
	const resolved =
		(elem?.kind === "TypeName" || elem?.kind === "Ident") &&
		checker?.types?.has(elem.name)
			? checker.types.get(elem.name)
			: elem;
	return namedBase(resolved, checker)?.name ?? null;
}

// `[]byte` / `[]uint8` (also through named element/slice types).
export function isByteSlice(goType, checker = null) {
	const name = _sliceElemBaseName(goType, checker);
	return name === "byte" || name === "uint8";
}

// `[]rune` / `[]int32` (also through named element/slice types): target of `[]rune(s)`.
export function isRuneSlice(goType, checker = null) {
	const name = _sliceElemBaseName(goType, checker);
	return name === "rune" || name === "int32";
}

// `gofront/shared` linear-memory buffer: returns the SHARED_KINDS entry
// (elem, ctor, bytes, key) or null.
export function getSharedInfo(goType, checker = null) {
	if (!goType) return null;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		return resolved ? getSharedInfo(resolved, checker) : null;
	}
	if (goType.kind === "named" && goType.underlying)
		return getSharedInfo(goType.underlying, checker);
	if (goType.kind !== "shared") return null;
	return { name: goType.shared, ...SHARED_KINDS[goType.shared] };
}

export function isArrayType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isArrayType(resolved, checker);
	}
	if (goType.kind === "named") return isArrayType(namedBase(goType, checker));
	return goType.kind === "array" || goType.kind === "ArrayType";
}

export function isMapType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isMapType(resolved, checker);
	}
	if (goType.kind === "named") return isMapType(namedBase(goType, checker));
	return goType.kind === "map" || goType.kind === "MapType";
}

// Returns `{ keyType, valType }` (Go types) for a map type, or nulls.
export function getMapKeyValTypes(goType, checker = null) {
	if (!goType) return { keyType: null, valType: null };
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return getMapKeyValTypes(resolved, checker);
	}
	if (goType.kind === "named")
		return getMapKeyValTypes(namedBase(goType, checker), checker);
	if (goType.kind === "map" || goType.kind === "MapType") {
		const key = goType.key ?? goType.keyType;
		const val =
			goType.value ?? goType.elem ?? goType.valueType ?? goType.valType;
		return { keyType: key, valType: val };
	}
	return { keyType: null, valType: null };
}

export function isStringType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isStringType(resolved, checker);
		return goType.name === "string";
	}
	if (goType.kind === "named") {
		if (goType.name === "string") return true;
		// A bare `{ kind: "named", name }` (interface candidates) resolves by name.
		return isStringType(namedBase(goType, checker), checker);
	}
	if (goType.kind === "basic") return goType.name === "string";
	if (goType.kind === "untyped") return goType.base === "string";
	return false;
}

// Any interface type, however spelled: `any`, `interface{}`, a defined
// interface type, or a chain of them.  Same predicate as `isInterfaceType`.
export function isAnyType(goType, checker = null) {
	return isInterfaceType(goType, checker);
}

export function isInterfaceType(goType, checker = null) {
	if (!goType) return false;
	if (
		goType.kind === "basic" &&
		(goType.name === "any" || goType.name === "interface{}")
	)
		return true;
	if (goType.kind === "interface" || goType.kind === "InterfaceType")
		return true;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		if (goType.name === "any" || goType.name === "interface{}") return true;
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isInterfaceType(resolved, checker);
	}
	if (goType.kind === "named") {
		if (goType.name === "any" || goType.name === "interface{}") return true;
		const under = namedUnderlying(goType, checker);
		if (under) return isInterfaceType(under, checker);
	}
	return false;
}

// `bool`, including the untyped boolean of a constant (`const ok = true`).
export function isBoolGoType(goType) {
	return (
		goType?.name === "bool" ||
		(goType?.kind === "untyped" && goType.base === "bool")
	);
}

// The built-in `error` interface (checker ERROR type or its name).  The name
// test covers AST type nodes and substituted copies of ERROR, and is safe:
// every user type spelled `error`, package-level or local, is renamed to
// `error__L<n>` before checking (`mangleCollidingTypes`, `renameLocalTypes`),
// so in the backend the bare name only ever denotes the universe interface.
// The other `name === "error"` tests in this backend rely on the same rename.
export function isErrorType(goType) {
	if (!goType) return false;
	if (goType === ERROR) return true;
	if (goType.kind === "interface") return goType.name === "error";
	if (
		(goType.kind === "named" ||
			goType.kind === "TypeName" ||
			goType.kind === "Ident") &&
		goType.name === "error"
	) {
		return true;
	}
	if (goType.kind === "named" && goType.underlying)
		return isErrorType(goType.underlying);
	return false;
}

export function isNonEmptyInterface(goType, checker = null) {
	if (!goType) return false;
	if (goType.name === "any" || goType.name === "interface{}") return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isNonEmptyInterface(resolved, checker);
	}
	if (goType.kind === "named") {
		if (goType.name === "any" || goType.name === "interface{}") return false;
		const under = namedUnderlying(goType, checker);
		if (under) return isNonEmptyInterface(under, checker);
	}
	if (goType.kind === "interface" || goType.kind === "InterfaceType") {
		if (goType.methods instanceof Map) return goType.methods.size > 0;
		if (Array.isArray(goType.methods)) return goType.methods.length > 0;
		if (goType.methods instanceof Set) return goType.methods.size > 0;
		return false;
	}
	return false;
}

// An interface with no methods, in every spelling (`any`, `interface{}`, a
// defined type or chain of defined types over either).
export function isEmptyInterface(goType, checker = null) {
	return (
		isInterfaceType(goType, checker) && !isNonEmptyInterface(goType, checker)
	);
}

export function getReceiverTypeName(recvType, _node = null) {
	if (recvType) {
		let t = recvType;
		while (t.kind === "pointer") t = t.base;
		if (t.name) return t.name;
		if (t.kind === "named") return t.name;
		if (t.kind === "TypeName" || t.kind === "Ident") return t.name;
	}
	return null;
}

export function isSigned(goType) {
	if (!goType) return true;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		return isSigned({ kind: "basic", name: goType.name });
	}
	if (goType.kind === "named" && goType.underlying) {
		return isSigned(goType.underlying);
	}
	if (goType.kind === "basic") {
		return !goType.name.startsWith("uint") && goType.name !== "byte";
	}
	return true;
}

// How a builtin `print`/`println` operand is handed to the host.  The host
// prints an i32 or i64 as signed, so a uint32 widens to i64 and a uint64 uses
// its own unsigned import (`wType` "u64").
export function printOperandKind(arg, checker) {
	const isBool =
		isBoolGoType(arg._type) ||
		namedBasicName(arg._type) === "bool" ||
		(arg.kind === "BasicLit" && arg.litKind === "BOOL");
	let wType = toWasmType(arg._type, checker);
	let widen = false;
	if (!isBool && (wType === "i32" || wType === "i64") && !isSigned(arg._type)) {
		if (wType === "i64") wType = "u64";
		else if (namedBasicName(arg._type) === "uint32") {
			wType = "i64";
			widen = true;
		}
	}
	return { wType, isBool, widen };
}

export function namedBasicName(t) {
	while (t && (t.kind === "named" || t.kind === "TypeName") && t.underlying) {
		t = t.underlying;
	}
	return t?.name;
}

export function isFloat(goType) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		return isFloat({ kind: "basic", name: goType.name });
	}
	if (goType.kind === "named" && goType.underlying) {
		return isFloat(goType.underlying);
	}
	if (goType.kind === "untyped") return goType.base === "float64";
	return (
		goType.kind === "basic" &&
		(goType.name === "float32" || goType.name === "float64")
	);
}

export function isFuncType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isFuncType(resolved, checker);
	}
	if (goType.kind === "named" && goType.underlying) {
		return isFuncType(goType.underlying, checker);
	}
	return (
		goType.kind === "func" ||
		goType.kind === "FuncType" ||
		goType.kind === "FuncLit" ||
		goType.kind === "FuncDecl"
	);
}

export function getFuncSignature(goType, checker = null) {
	if (!goType) return { params: [], returns: [] };
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return getFuncSignature(resolved, checker);
	}
	if (goType.kind === "named" && goType.underlying) {
		return getFuncSignature(goType.underlying, checker);
	}
	if (
		goType.kind === "FuncType" ||
		goType.kind === "FuncLit" ||
		goType.kind === "FuncDecl"
	) {
		const params = (goType.params ?? []).map((p) =>
			p.variadic ? { kind: "SliceType", elem: p.type } : (p.type ?? p),
		);
		const returns = [];
		if (goType.returnType) {
			if (
				goType.returnType.kind === "TupleType" ||
				goType.returnType.kind === "tuple"
			) {
				returns.push(...(goType.returnType.types ?? []));
			} else {
				returns.push(goType.returnType);
			}
		} else if (goType.returns) {
			for (const r of goType.returns) {
				if ((r?.kind === "tuple" || r?.kind === "TupleType") && r.types) {
					returns.push(...r.types);
				} else {
					returns.push(r);
				}
			}
		}
		return { params, returns };
	}
	if (goType.kind === "func") {
		const rawReturns =
			goType.returns ?? (goType.returnType ? [goType.returnType] : []);
		const returns = [];
		for (const r of rawReturns) {
			if ((r?.kind === "tuple" || r?.kind === "TupleType") && r.types) {
				returns.push(...r.types);
			} else {
				returns.push(r);
			}
		}
		return {
			params: variadicAsSlice(goType.params ?? [], goType.variadic),
			returns,
		};
	}
	return { params: [], returns: [] };
}

// Checker func types keep a variadic parameter's element type; in WASM the
// parameter is a slice (see variadic.js).
export function variadicAsSlice(params, variadic) {
	if (!variadic || params.length === 0) return params;
	const last = params[params.length - 1];
	return [...params.slice(0, -1), { kind: "slice", elem: last }];
}

export function isUnhashableGoType(goType, checker = null, seen = new Set()) {
	if (!goType) return false;
	if (seen.has(goType)) return false;
	seen.add(goType);
	if (
		isSliceType(goType, checker) ||
		isMapType(goType, checker) ||
		isFuncType(goType, checker)
	) {
		return true;
	}
	if (isArrayType(goType, checker)) {
		const elem = goType.elem ?? namedUnderlying(goType, checker)?.elem;
		return isUnhashableGoType(elem, checker, seen);
	}
	if (goType.kind === "struct" || goType.kind === "StructType") {
		for (const f of structFieldList(goType, checker)) {
			if (isUnhashableGoType(f.goType, checker, seen)) return true;
		}
	}
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved && resolved !== goType) {
			return isUnhashableGoType(resolved, checker, seen);
		}
	}
	if (goType.kind === "named" && goType.underlying) {
		return isUnhashableGoType(goType.underlying, checker, seen);
	}
	return false;
}
