// GoFront type system — shared type constants, predicates, and utilities
// used across the type-checker sub-modules.
//
// Type representation:
//   { kind: 'basic',     name: 'int'|'float64'|'string'|'bool'|'any'|'void' }
//   { kind: 'slice',     elem: Type }
//   { kind: 'array',     size: n, elem: Type }
//   { kind: 'map',       key: Type, value: Type }
//   { kind: 'struct',    name: string, fields: Map<string, Type>, methods: Map<string, FuncType> }
//   { kind: 'interface', name: string, methods: Map<string, FuncType> }
//   { kind: 'func',      params: Type[], returns: Type[]  }
//   { kind: 'tuple',     types: Type[] }   ← multiple return values
//   { kind: 'named',     name: string, underlying: Type }

export class TypeCheckError extends Error {
	constructor(msg, node, filename, sourceCode, hint = null) {
		const lineNum = node?.line || node?._line;
		const colNum = node?.col || node?._col;
		const loc = filename
			? lineNum
				? ` in ${filename} at line ${lineNum}:${colNum ?? 1}`
				: ` in ${filename}`
			: lineNum
				? ` at line ${lineNum}:${colNum ?? 1}`
				: "";
		const hintText = hint ? `\n  ${hint}` : "";
		let lineContext = "";
		if (lineNum && sourceCode) {
			const lines = sourceCode.split("\n");
			const lineStr = lines[lineNum - 1];
			if (lineStr !== undefined) {
				const prefix = `  ${lineNum} | `;
				const caretPad = " ".repeat((colNum ?? 1) - 1);
				lineContext = `\n${prefix}${lineStr}\n${" ".repeat(prefix.length)}${caretPad}^`;
			}
		}
		super(`Type error${loc}: ${msg}${hintText}${lineContext}`);
		this.line = lineNum;
		this.col = colNum;
	}
}

export const BROWSER_GLOBALS = new Set([
	"console",
	"document",
	"window",
	"navigator",
	"location",
	"history",
	"screen",
	"performance",
	"crypto",
	"indexedDB",
	"fetch",
	"setTimeout",
	"setInterval",
	"clearTimeout",
	"clearInterval",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"Math",
	"JSON",
	"Date",
	"RegExp",
	"Promise",
	"Error",
	"Symbol",
	"String",
	"Number",
	"Boolean",
	"Array",
	"Object",
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"encodeURIComponent",
	"decodeURIComponent",
	"atob",
	"btoa",
	"alert",
	"confirm",
	"prompt",
	"localStorage",
	"sessionStorage",
	"WebSocket",
	"Worker",
	"HTMLElement",
	"Element",
	"Event",
	"CustomEvent",
	"URL",
	"URLSearchParams",
	"FormData",
	"Headers",
	"Request",
	"Response",
	"Blob",
	"File",
	"FileReader",
	"TextEncoder",
	"TextDecoder",
]);

// Stdlib packages the WASM backend can emit. Extend as src/backend/wasm/stdlib/
// gains support; anything not listed is rejected at import with "not yet available in
// wasm packages".
export const WASM_SUPPORTED_STDLIB = new Set([
	"gofront/shared",
	"gofront/simd",
]);

export const STDLIB_PACKAGES = WASM_SUPPORTED_STDLIB;

// Per-namespace member subset the WASM backend implements. `null` means every
// member the checker knows about. Members outside the set are rejected in
// wasm/both packages with "'strings.Split' is not yet available in wasm packages".
export const WASM_STDLIB_MEMBERS = new Map();

export const VALID_TARGETS = new Set(["js", "wasm", "both"]);

// Backend-provided implementations for body-less Go-source stdlib functions
// marked `//gofront:intrinsic <name>`: name -> required signature.  New
// intrinsics need a plan change.
export const INTRINSICS = new Map([
	// A uniformly distributed float64 in [0, 1) from the host source
	// (`Math.random`); the only entropy math/rand draws.
	["rand_source", "func() float64"],
	// The host clock in nanoseconds since the Unix epoch, and the offset in
	// seconds east of UTC of the host's time zone at a Unix time (time).
	["time_now", "func() int64"],
	["time_zone_offset", "func(int64) int"],
	// time (js only): suspend for a number of nanoseconds; the declaration is
	// `async`.
	["time_sleep", "func(int64) void"],
	// os: write a string to a file descriptor (0 stdin, 1 stdout, 2 stderr),
	// exit the process, and read and set environment variables.
	["os_write", "func(int, string) void"],
	["os_exit", "func(int) void"],
	["os_getenv", "func(string) string"],
	["os_setenv", "func(string, string) void"],
	// unicode: the host's answer for runes above ASCII, by class (the
	// constants of stdlib/unicode), and its case mappings.
	["unicode_is", "func(int32, int) bool"],
	["unicode_to_upper", "func(int32) int32"],
	["unicode_to_lower", "func(int32) int32"],
	// crypto/rand: four random bytes from the host's secure source.
	["crypto_rand_u32", "func() uint32"],
	// testing: a monotonic clock in nanoseconds, and an unanchored regular
	// expression match for -run and -bench patterns.
	["testing_nanotime", "func() int64"],
	["testing_match", "func(string, string) bool"],
	// testing (js only): call a test body and return what it returned (a
	// promise for an async body, otherwise nil).
	["testing_call", "func(any, any) any"],
	// fmt: a stable number for a pointer, function or other reference.
	["fmt_ptr_id", "func(any) uint64"],
	// math: IEEE-754 bit casts, and the host's `Math.*` (`%` for Mod).
	["math_float64bits", "func(float64) uint64"],
	["math_float64frombits", "func(uint64) float64"],
	["math_float32bits", "func(float32) uint32"],
	["math_float32frombits", "func(uint32) float32"],
	...[
		"sin",
		"cos",
		"tan",
		"asin",
		"acos",
		"atan",
		"sinh",
		"cosh",
		"tanh",
		"exp",
		"expm1",
		"log",
		"log1p",
		"log2",
		"log10",
		"cbrt",
	].map((f) => [`math_${f}`, "func(float64) float64"]),
	...["atan2", "pow", "hypot", "mod"].map((f) => [
		`math_${f}`,
		"func(float64, float64) float64",
	]),
]);

// The fmt functions whose calls the compiler wraps with a generated function
// (src/lower/fmt-formatters.js); a wrapped call may forward `f()`'s results.
export const FMT_PRINT_FUNCS = new Set([
	"Sprint",
	"Sprintln",
	"Print",
	"Println",
	"Fprint",
	"Fprintln",
	"Append",
	"Appendln",
	"Sprintf",
	"Printf",
	"Errorf",
	"Fprintf",
	"Appendf",
]);

// Names a standard-library function may carry in `//gofront:native <name>`:
// the function keeps its Go body, and a backend registry may replace calls to
// it with host code (or decline).  A closed set; new names need a plan change.
export const NATIVES = new Set([
	"slices.Contains",
	"slices.Index",
	"slices.Reverse",
	"slices.Clone",
	"bytes.Compare",
	"bytes.Equal",
	"bytes.IndexByte",
	"slices.Sort",
	"sort.Ints",
	"sort.Strings",
	"utf8.RuneCountInString",
	"strings.Index",
	"strings.LastIndex",
	"strings.IndexByte",
	"strings.LastIndexByte",
	"strings.IndexRune",
	"strings.IndexAny",
	"strings.LastIndexAny",
	"strings.Contains",
	"strings.ContainsAny",
	"strings.ContainsRune",
	"strings.HasPrefix",
	"strings.HasSuffix",
	"strings.Count",
	"strings.Repeat",
	"strings.Join",
	"strings.Replace",
	"strings.ReplaceAll",
	"strings.Split",
	"strings.Fields",
	"strings.ToUpper",
	"strings.ToLower",
	"strings.TrimSpace",
	"strings.Trim",
	"strings.TrimLeft",
	"strings.TrimRight",
	"strings.TrimPrefix",
	"strings.TrimSuffix",
	"strconv.shortest",
	"strconv.fixed",
	"strconv.parseDecimal",
	// internal/jsonrt: the encoder's writes into its output buffer.
	"jsonrt.putString",
	"jsonrt.putInt",
	"jsonrt.putUint",
	"jsonrt.putFloat",
	"jsonrt.putQuoted",
	"jsonrt.readStr",
	"jsonrt.readNum",
	"jsonrt.CheckValid",
	"jsonrt.LooksFloat32",
	// math: the functions with a single host expression or instruction.
	"math.IsNaN",
	"math.IsInf",
	"math.Inf",
	"math.NaN",
	"math.Signbit",
	"math.Copysign",
	"math.Abs",
	"math.Max",
	"math.Min",
	"math.Trunc",
	"math.Floor",
	"math.Ceil",
	"math.Round",
	"math.Sqrt",
	// math/bits: one host instruction per width (`Math.clz32`, WASM `clz`,
	// `ctz` and `popcnt`).
	...["Len", "LeadingZeros", "TrailingZeros", "OnesCount"].flatMap((f) =>
		["", "8", "16", "32", "64"].map((w) => `bits.${f}${w}`),
	),
]);

// ── Static operator sets (module-level for reuse) ────────────
export const CMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);
export const LOG_OPS = new Set(["&&", "||"]);

// ── Built-in types ───────────────────────────────────────────

export const INT = { kind: "basic", name: "int" };
export const INT8 = { kind: "basic", name: "int8" };
export const INT16 = { kind: "basic", name: "int16" };
export const INT32 = { kind: "basic", name: "int32" };
export const INT64 = { kind: "basic", name: "int64" };
export const UINT = { kind: "basic", name: "uint" };
export const UINT8 = { kind: "basic", name: "uint8" };
export const BYTE = UINT8;
export const UINT16 = { kind: "basic", name: "uint16" };
export const UINT32 = { kind: "basic", name: "uint32" };
export const UINT64 = { kind: "basic", name: "uint64" };
const UINTPTR = { kind: "basic", name: "uintptr" };
export const RUNE = INT32;
export const FLOAT32 = { kind: "basic", name: "float32" };
export const FLOAT64 = { kind: "basic", name: "float64" };
export const STRING = { kind: "basic", name: "string" };
export const BOOL = { kind: "basic", name: "bool" };
export const ANY = { kind: "basic", name: "any" };
// `any` written in source. Untyped JS interop also yields plain ANY, which stays
// freely assignable; only a declared `any` needs a type assertion.
export const DECLARED_ANY = { kind: "basic", name: "any", _declared: true };
export const TAINTED_ANY = { kind: "basic", name: "any", _tainted: true };
export const VOID = { kind: "basic", name: "void" };
export const NIL = { kind: "basic", name: "nil" };
export const ERROR = {
	kind: "interface",
	name: "error",
	methods: new Map([
		["Error", { kind: "func", params: [], returns: [STRING], async: false }],
	]),
};

// ── Untyped constant types (Go spec §Constants) ─────────────
// Untyped constants coerce to any compatible typed context.
export const UNTYPED_INT = { kind: "untyped", base: "int" };
export const UNTYPED_FLOAT = { kind: "untyped", base: "float64" };
export const UNTYPED_STRING = { kind: "untyped", base: "string" };
export const UNTYPED_BOOL = { kind: "untyped", base: "bool" };
// An untyped rune constant is an untyped integer whose default type is
// `rune`; every `base === "int"` rule applies to it unchanged.
export const UNTYPED_RUNE = { kind: "untyped", base: "int", rune: true };

// ── Complex types ────────────────────────────────────────────
export const COMPLEX128 = { kind: "basic", name: "complex128" };
export const COMPLEX64 = { kind: "basic", name: "complex64" };
export const UNTYPED_COMPLEX = { kind: "untyped", base: "complex128" };

export const BASIC_TYPES = {
	int: INT,
	int8: INT8,
	int16: INT16,
	int32: INT32,
	int64: INT64,
	uint: UINT,
	uint8: UINT8,
	uint16: UINT16,
	uint32: UINT32,
	uint64: UINT64,
	uintptr: UINTPTR,
	byte: UINT8,
	rune: RUNE,
	float32: FLOAT32,
	float64: FLOAT64,
	complex64: COMPLEX64,
	complex128: COMPLEX128,
	string: STRING,
	bool: BOOL,
	any: ANY,
};

export const COMPARABLE = { kind: "basic", name: "comparable" };

export const SIZED_INT_NAMES = [
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
	"byte",
	"rune",
];

export const SIZED_FLOAT_NAMES = ["float32", "float64"];

function makeBasicPredicate(...names) {
	const set = new Set(names);
	const pred = (t) => {
		if (!t) return false;
		if (t.kind === "untyped") return set.has(t.base);
		if (t.kind === "basic") return set.has(t.name);
		if (t.kind === "named") return pred(t.underlying);
		return false;
	};
	return pred;
}

export const isNumeric = makeBasicPredicate(
	...SIZED_INT_NAMES,
	...SIZED_FLOAT_NAMES,
);
export const isInteger = makeBasicPredicate(...SIZED_INT_NAMES);
export const isFloat = makeBasicPredicate(...SIZED_FLOAT_NAMES);
export const isString = makeBasicPredicate("string");
export const isBool = makeBasicPredicate("bool");

// True when type t represents an int64 or uint64 (including named types like time.Duration).
export function is64BitInt(t) {
	if (!t) return false;
	if (t.kind === "untyped") return t.base === "int64" || t.base === "uint64";
	let cur = t;
	while (cur?.kind === "named") cur = cur.underlying;
	return (
		cur?.kind === "basic" && (cur.name === "int64" || cur.name === "uint64")
	);
}

export function is64BitSigned(t) {
	if (!t) return false;
	if (t.kind === "untyped") return t.base === "int64";
	let cur = t;
	while (cur?.kind === "named") cur = cur.underlying;
	return cur?.kind === "basic" && cur.name === "int64";
}

export function is64BitUnsigned(t) {
	if (!t) return false;
	if (t.kind === "untyped") return t.base === "uint64";
	let cur = t;
	while (cur?.kind === "named") cur = cur.underlying;
	return cur?.kind === "basic" && cur.name === "uint64";
}

// ── TypedArray mappings ──────────────────────────────────────
// []float64 deliberately stays a plain Array for JSON / JS-library interop.
const TYPED_ARRAY_CONSTRUCTORS = {
	float32: "Float32Array",
	uint8: "Uint8Array",
	byte: "Uint8Array",
	int8: "Int8Array",
	uint16: "Uint16Array",
	int16: "Int16Array",
	uint32: "Uint32Array",
	int32: "Int32Array",
	rune: "Int32Array",
};

// Element indices of an array or slice literal (Go spec): `i: v` puts v at
// index i, any other element goes right after the previous one, so
// `[5]int{1, 3: 4, 5}` fills indices 0, 3 and 4.  Array literal keys are
// resolved by the type checker (`_index`, which handles named constants and
// constant expressions); otherwise only integer-literal keys are known and
// another key is treated as a positional element.
export function compositeLitIndices(elems) {
	const out = [];
	let next = 0;
	for (const e of elems) {
		if (e.kind === "KeyValueExpr" && e._index !== undefined) next = e._index;
		else if (e.kind === "KeyValueExpr" && e.key?.value !== undefined)
			next = Number(e.key.value);
		out.push(next++);
	}
	return out;
}

// Highest element index of an array or slice literal (-1 when empty).  A
// loop, not `Math.max(...)`: spreading a huge literal overflows the stack.
export function compositeLitMaxIndex(elems) {
	let max = -1;
	for (const i of compositeLitIndices(elems)) if (i > max) max = i;
	return max;
}

export function typedArrayConstructorForElem(elemType) {
	if (!elemType) return null;
	const name = elemType.kind === "basic" ? elemType.name : null;
	return name ? (TYPED_ARRAY_CONSTRUCTORS[name] ?? null) : null;
}

export function isTypedArraySlice(type) {
	if (!type) return false;
	const base = type.kind === "named" ? type.underlying : type;
	if (base?.kind !== "slice") return false;
	return typedArrayConstructorForElem(base.elem) !== null;
}

export function isComplex(t) {
	if (!t) return false;
	if (
		(t.kind === "basic" || t.kind === "TypeName" || t.kind === "Ident") &&
		(t.name === "complex128" || t.name === "complex64")
	)
		return true;
	if (t.kind === "untyped" && t.base === "complex128") return true;
	if (t.kind === "named") return isComplex(t.underlying);
	return false;
}
export function isComplex64(t) {
	if (!t) return false;
	if (
		(t.kind === "basic" || t.kind === "TypeName" || t.kind === "Ident") &&
		t.name === "complex64"
	)
		return true;
	if (t.kind === "untyped" && t.base === "complex64") return true;
	if (t.kind === "named") return isComplex64(t.underlying);
	if (t.name === "complex64") return true;
	if (t.underlying) return isComplex64(t.underlying);
	return false;
}
export function isComplexOrNumeric(t) {
	return isNumeric(t) || isComplex(t);
}
export function isAny(t) {
	return t?.kind === "basic" && t.name === "any";
}
export function isNil(t) {
	return t?.kind === "basic" && t.name === "nil";
}
export function isVoid(t) {
	return t?.kind === "basic" && t.name === "void";
}
export function isPointer(t) {
	if (!t) return false;
	if (t.kind === "pointer") return true;
	if (t.kind === "named") return t.underlying?.kind === "pointer";
	return false;
}
export function isArray(t) {
	if (!t) return false;
	if (t.kind === "array") return true;
	if (t.kind === "named") return t.underlying?.kind === "array";
	return false;
}
export function isUntyped(t) {
	return t?.kind === "untyped";
}

/** Materialize an untyped type to its default concrete type. */
export function defaultType(t) {
	if (t?.kind !== "untyped") return t;
	switch (t.base) {
		case "int":
			return t.rune ? RUNE : INT;
		case "float64":
			return FLOAT64;
		case "string":
			return STRING;
		case "bool":
			return BOOL;
		case "complex128":
			return COMPLEX128;
		default:
			return ANY;
	}
}

export function typeStr(t) {
	if (!t) return "void";
	if (t.kind === "basic" && t.alias) return t.alias;
	switch (t.kind) {
		case "basic":
			return t.name;
		case "untyped":
			return t.rune ? "untyped rune" : `untyped ${t.base}`;
		case "slice":
			return `[]${typeStr(t.elem)}`;
		case "shared":
			return `shared.${t.shared}`;
		case "array":
			return `[${t.size ?? "..."}]${typeStr(t.elem)}`;
		case "map":
			return `map[${typeStr(t.key)}]${typeStr(t.value)}`;
		case "struct":
			return t.typeArgs && t.typeArgs.length > 0
				? `${t.name || "struct"}[${t.typeArgs.map(typeStr).join(", ")}]`
				: t.name || "struct{...}";
		case "interface":
			return t.name || "interface{...}";
		case "namespace":
			return t.name || "namespace{...}";
		case "func": {
			const retStr =
				t.returns.length > 1
					? `(${t.returns.map(typeStr).join(", ")})`
					: typeStr(t.returns[0] ?? VOID);
			return `func(${t.params.map(typeStr).join(", ")}) ${retStr}`;
		}
		case "tuple":
			return `(${t.types.map(typeStr).join(", ")})`;
		case "named": {
			const name = displayTypeName(t.name);
			return t.typeArgs && t.typeArgs.length > 0
				? `${name}[${t.typeArgs.map(typeStr).join(", ")}]`
				: name;
		}
		case "pointer":
			return `*${typeStr(t.base)}`;
		case "typeParam":
			return t.name;
		case "generic":
			return t.name || `generic(${typeStr(t.underlying)})`;
		default:
			return "?";
	}
}

// The field an embedded type declares is named after the type as written, so
// an alias (`type A = Base; struct{ A }`) gives the field `A`.
// Per struct type, the methods promoted into its method set from embedded
// fields: name -> { depth, viaPtr, source, mType }. `depth` counts embeds
// from the struct, `viaPtr` is set when an embed on the path is a pointer
// and `source` is the method as declared. Kept outside the struct object so
// a copy of the struct (`type S Base`) does not share it.
export const promotedMethods = new WeakMap();

// Two embedded fields at the same, shallowest depth declare method `name`,
// so it is in neither method set of `struct` and selecting it is an error.
export function isAmbiguousPromotion(struct, name) {
	return promotedMethods.get(struct)?.get(name)?.ambiguous === true;
}

// The ambiguous method names of `struct` (see isAmbiguousPromotion).
export function ambiguousPromotions(struct) {
	const names = [];
	for (const [name, p] of promotedMethods.get(struct) ?? [])
		if (p.ambiguous) names.push(name);
	return names;
}

export function embeddedFieldName(f) {
	const ast = f.astType?.kind === "PointerType" ? f.astType.base : f.astType;
	const t = f.type?.kind === "pointer" ? f.type.base : f.type;
	return (ast?.name ?? t?.name ?? "")
		.split(".")
		.pop()
		.replace(/\$\$.*$/, "");
}

// Whether `st` declares `name` itself: a field of that name or an embedded
// field named after its type.
function declaresField(st, name) {
	return (st._structFields ?? []).some((f) =>
		f.embedded ? embeddedFieldName(f) === name : f.names?.includes(name),
	);
}

// The shallowest depth at which `struct` promotes a field `name` from its
// embedded types, and how many promotion paths reach it at that depth:
// { depth, count }, or null when no embedded type offers one.
function promotedFieldDepth(struct, name, path = new Set()) {
	if (path.has(struct)) return null;
	path.add(struct);
	let best = null;
	for (const e of struct._embeds ?? []) {
		const inner = e?.kind === "pointer" ? e.base : e;
		const st = inner?.kind === "named" ? inner.underlying : inner;
		if (st?.kind !== "struct" || !st._structFields) continue;
		const sub = declaresField(st, name)
			? { depth: 0, count: 1 }
			: promotedFieldDepth(st, name, path);
		if (!sub) continue;
		const depth = 1 + sub.depth;
		if (!best || depth < best.depth) best = { depth, count: sub.count };
		else if (depth === best.depth) best.count += sub.count;
	}
	path.delete(struct);
	return best;
}

// Whether selecting `name` on `struct`, whose flattened field map has it, is
// ambiguous: two promotion paths reach a field of that name at the same
// shallowest depth, or a field and a method promoted at that depth do. A
// field declared on the struct itself and a method declared on it always win.
export function isAmbiguousFieldSelector(struct, name) {
	if (declaresField(struct, name)) return false;
	const promoted = promotedMethods.get(struct)?.get(name);
	if (struct.methods?.has(name) && promoted?.mType !== struct.methods.get(name))
		return false;
	const field = promotedFieldDepth(struct, name);
	if (!field) return false;
	if (!promoted || field.depth < promoted.depth) return field.count > 1;
	return field.depth === promoted.depth || promoted.ambiguous === true;
}

// Whether selecting `name` on `struct`, whose flattened field map has it,
// reaches a method promoted at a shallower depth than the field (Go's depth
// rule): the method is selected and the deeper field is shadowed.
export function isMethodPromotedOverField(struct, name) {
	if (declaresField(struct, name)) return false;
	const promoted = promotedMethods.get(struct)?.get(name);
	if (!promoted?.mType || promoted.ambiguous) return false;
	if (struct.methods?.get(name) !== promoted.mType) return false;
	const field = promotedFieldDepth(struct, name);
	return field !== null && promoted.depth < field.depth;
}

// A function-local type shadowed by another type is renamed `Name__L<n>`.
export const LOCAL_TYPE_SUFFIX = /__L\d+/;

// Go-source stdlib names are mangled to `Name$$path` (`List$$container$list`);
// diagnostics show them qualified, as Go does (`list.List`).
export function displayTypeName(name) {
	if (typeof name === "string") name = name.replace(LOCAL_TYPE_SUFFIX, "");
	const i = typeof name === "string" ? name.indexOf("$$") : -1;
	if (i < 0) return name;
	return `${name
		.slice(i + 2)
		.split("$")
		.at(-1)}.${name.slice(0, i)}`;
}

// ── Iterator function detection (Go 1.23 range-over-func) ───

/**
 * Returns null if t is not an iterator function.
 * Returns { yieldParams: Type[] } if it is, where yieldParams are the
 * types the range variables will be bound to (0, 1, or 2 elements).
 *
 * An iterator is func(yield func(...) bool) — single param that is a
 * func returning bool with 0-2 params.
 */
export function iteratorYieldParams(t) {
	const fn = t?.kind === "named" ? t.underlying : t;
	if (fn?.kind !== "func") return null;
	if (fn.params.length !== 1) return null;
	const yieldFn =
		fn.params[0]?.kind === "named" ? fn.params[0].underlying : fn.params[0];
	if (yieldFn?.kind !== "func") return null;
	if (yieldFn.returns.length !== 1 || !isBool(yieldFn.returns[0])) return null;
	if (yieldFn.params.length > 2) return null;
	return { yieldParams: yieldFn.params };
}

// ── Scope / environment ──────────────────────────────────────

export class Scope {
	constructor(parent = null) {
		this.parent = parent;
		this.symbols = new Map();
		this._consts = new Set(); // names declared as const in this scope
		this._constExprs = new Map(); // name -> AST initializer expr
		this._locals = new Set(); // names declared as local variables (var / :=)
		this._used = new Set(); // names referenced in this scope
	}
	define(name, type) {
		this.symbols.set(name, type);
	}
	defineLocal(name, type) {
		this.symbols.set(name, type);
		if (name !== "_") this._locals.add(name);
	}
	defineConst(name, type, expr = null) {
		this.symbols.set(name, type);
		this._consts.add(name);
		if (expr) this._constExprs.set(name, expr);
	}
	lookupConstExpr(name) {
		if (this._constExprs.has(name)) return this._constExprs.get(name);
		if (this.parent) return this.parent.lookupConstExpr(name);
		return null;
	}
	isConst(name) {
		if (this._consts.has(name)) return true;
		// Don't walk parent — shadowing a const with a var in a child scope is valid
		return false;
	}
	lookup(name) {
		if (this.symbols.has(name)) {
			this._used.add(name);
			return this.symbols.get(name);
		}
		if (this.parent) return this.parent.lookup(name);
		return null;
	}
	// Lookup which scope owns the name (to check const flag)
	lookupScope(name) {
		if (this.symbols.has(name)) return this;
		if (this.parent) return this.parent.lookupScope(name);
		return null;
	}
	// Returns local variable names that were never referenced
	unusedLocals() {
		const unused = [];
		for (const name of this._locals) {
			if (!this._used.has(name)) unused.push(name);
		}
		return unused;
	}
}
