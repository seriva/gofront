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

// Valid Go that the compile target does not support yet (as opposed to a bug
// in the compiler). A backend throws it where it would otherwise throw a bare
// `Error`; the compiler reports it as a user error, not an internal one.
export class UnsupportedError extends Error {
	constructor(msg) {
		super(msg);
		this.name = "UnsupportedError";
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

// The ECMAScript built-ins among `BROWSER_GLOBALS`. WebIDL does not define
// them, so they stay JS-dynamic `any`; every other entry is a Web API global
// typed from the generated `gofront/*` declarations (see `_webGlobalType`).
export const ES_BUILTIN_GLOBALS = new Set([
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
]);

// ES and host globals that generated code, runtime helpers and the wasm
// loader read but that Go programs may legally declare (`func Map`, `NaN :=
// 2.0`).  Rename-only: the names are never predeclared, so adding one cannot
// change what compiles.  See `shadowsJsGlobal`.
export const JS_RESERVED_GLOBALS = new Set([
	"ArrayBuffer",
	"BigInt",
	"BigInt64Array",
	"BigUint64Array",
	"DataView",
	"Float32Array",
	"Float64Array",
	"Function",
	"Infinity",
	"Int16Array",
	"Int32Array",
	"Int8Array",
	"Iterator",
	"Map",
	"NaN",
	"Proxy",
	"RangeError",
	"Reflect",
	"ReferenceError",
	"Set",
	"SyntaxError",
	"TypeError",
	"Uint16Array",
	"Uint32Array",
	"Uint8Array",
	"Uint8ClampedArray",
	"WeakMap",
	"WeakRef",
	"WeakSet",
	"WebAssembly",
	"escape",
	"global",
	"globalThis",
	"process",
	"queueMicrotask",
	"structuredClone",
	"undefined",
]);

// True when a Go declaration of `name` must be emitted under a `$`-suffixed
// binding so it does not shadow a global the generated code relies on.
export const shadowsJsGlobal = (name) =>
	BROWSER_GLOBALS.has(name) || JS_RESERVED_GLOBALS.has(name);

// JavaScript built-ins that generated JS relies on; a JS class of the same
// name in the bundle would shadow them (see _checkGlobalTypeNamesPass).
// Rejecting a type name is breaking, so this set does not grow.
export const JS_BUILTIN_CLASSES = new Set([
	"Array",
	"ArrayBuffer",
	"BigInt",
	"BigInt64Array",
	"BigUint64Array",
	"Boolean",
	"DataView",
	"Date",
	"Error",
	"Float32Array",
	"Float64Array",
	"Int16Array",
	"Int32Array",
	"Int8Array",
	"JSON",
	"Map",
	"Math",
	"Number",
	"Object",
	"Promise",
	"RangeError",
	"Reflect",
	"RegExp",
	"Set",
	"String",
	"Symbol",
	"TextDecoder",
	"TextEncoder",
	"TypeError",
	"Uint16Array",
	"Uint32Array",
	"Uint8Array",
	"Uint8ClampedArray",
	"WeakMap",
	"WebAssembly",
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

// Underlying type with chains of defined types followed through. A declared
// type's `underlying` is never a defined type; only a type whose declaration
// is still being collected (or an invalid cycle) leaves one in place.
export function underlyingOf(t) {
	let u = t;
	for (let i = 0; u?.kind === "named" && i < 32; i++) u = u.underlying;
	return u;
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
	const base = underlyingOf(type);
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
// How an empty interface behaves.  "dynamic": a JS-dynamic value (browser
// global, ECMAScript built-in, `.d.ts` value) that every operation accepts;
// "go": a Go `any` (written as `any`, `interface{}`, or a defined type over
// either) that needs a type assertion first; "tainted": the error-recovery
// type that hides follow-up diagnostics; null: anything else.
export function anyKind(t) {
	let named = false;
	for (let depth = 0; t && depth < 32; depth++) {
		if (t.kind === "interface") return emptyInterfaceKind(t, named);
		if (t.kind === "basic" && t.name === "any")
			return t._tainted ? "tainted" : t._declared ? "go" : "dynamic";
		if (t.kind !== "named") return null;
		named = true;
		t = t.underlying;
	}
	return null;
}

// A defined interface carries its own name; a literal has none.
function emptyInterfaceKind(t, viaNamed) {
	if (!viaNamed && t.name) return null;
	const empty = t.methods.size === 0 && !t.unionConstraint;
	return empty && !t._typeSetEmbeds && !t._comparable ? "go" : null;
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

// Unnamed struct and interface types print in full, spelled as `go/types`
// does (`struct{X int; Y string}`, `interface{M() int}`, `interface{~int |
// ~float64}`). A literal met again while it is being printed prints `{…}`.
const printing = new Set();

function literalTypeStr(t) {
	if (printing.has(t)) return `${t.kind}{…}`;
	printing.add(t);
	try {
		const parts = t.kind === "struct" ? structParts(t) : interfaceParts(t);
		return `${t.kind}{${parts.join("; ")}}`;
	} finally {
		printing.delete(t);
	}
}

function structParts(t) {
	const fields =
		t._structFields ??
		[...t.fields].map(([name, type]) => ({ names: [name], type }));
	return fields.flatMap((f) => {
		const tag = f.tag ? ` ${JSON.stringify(f.tag)}` : "";
		if (f.embedded || !f.names?.length) return [`${typeStr(f.type)}${tag}`];
		return f.names.map((name) => `${name} ${typeStr(f.type)}${tag}`);
	});
}

function interfaceParts(t) {
	const methods = [...t.methods].map(
		([name, m]) => `${name}${signatureStr(m)}`,
	);
	return [
		...methods,
		...(t._comparable ? ["comparable"] : []),
		...unionParts(t),
	];
}

// The type-set elements of an interface: its own union, then each embedded
// constraint's, one `; `-separated element apiece (`~int | ~string`).
function unionParts(t) {
	const terms = t.unionConstraint?.terms ?? [];
	// Terms the checker substituted are types; the rest keep the text the
	// resolver recorded from their source.
	const own =
		terms.length > 0 && terms.every((term) => term.resolved)
			? terms
					.map((term) => `${term.approx ? "~" : ""}${typeStr(term.resolved)}`)
					.join(" | ")
			: t._unionText;
	return [
		...(own ? [own] : []),
		...(t._typeSetEmbeds ?? []).flatMap(unionParts),
	];
}

// `(int, string) bool`: a method's parameters and results without `func`;
// a `void` result is not written.
function signatureStr(f) {
	const params = f.params.map((p, i) =>
		f.variadic && i === f.params.length - 1 ? `...${typeStr(p)}` : typeStr(p),
	);
	const results = f.returns.filter((r) => !isVoid(r));
	const ret =
		results.length === 0
			? ""
			: results.length === 1
				? ` ${typeStr(results[0])}`
				: ` (${results.map(typeStr).join(", ")})`;
	return `(${params.join(", ")})${ret}`;
}

export function typeStr(t) {
	if (!t) return "void";
	// An unresolved `.d.ts` reference prints as the name written in Go
	// (`dom.Node`), not as its internal `gofront/dom.Node` table key.
	if (t.kind === "basic" && t.alias) return t.alias.replace(/^gofront\//, "");
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
				: t.name || literalTypeStr(t);
		case "interface":
			return t.name || literalTypeStr(t);
		case "namespace":
			// A declaration package's type shows its package (`dom.Element`).
			return t._pkg ? `${t._pkg}.${t.name}` : t.name || "namespace{...}";
		case "func": {
			const retStr =
				t.returns.length > 1
					? `(${t.returns.map(typeStr).join(", ")})`
					: typeStr(t.returns[0] ?? VOID);
			return `func(${t.params.map(typeStr).join(", ")}) ${retStr}`;
		}
		case "tuple":
			return `(${t.types.map(typeStr).join(", ")})`;
		case "promise":
			return `Promise<${typeStr(t.elem)}>`;
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

// ── Type identity (Go spec §Type identity) ──────────────────
// `typeStr` is for messages only: it prints every anonymous struct and
// interface the same way, and drops the `__L<n>` suffix that tells shadowing
// local types apart.  Decisions about whether two types are the same type
// go through `identical`.

// `any`, in each of its spellings, and the empty interface literal.
function isAnyLike(t) {
	if (isAny(t)) return true;
	return (
		t?.kind === "interface" &&
		!t.name &&
		t.methods.size === 0 &&
		!t.unionConstraint &&
		!t._typeSetEmbeds &&
		!t._comparable
	);
}

// The result list of a func type without its `void` placeholder.
function funcResults(t) {
	const out = [];
	for (const r of t.returns ?? []) {
		if (r?.kind === "tuple") out.push(...r.types);
		else if (r && !isVoid(r)) out.push(r);
	}
	return out;
}

// A struct's fields in declaration order: { name, type, tag, embedded }.
function structFieldList(t) {
	if (t._structFields)
		return t._structFields.flatMap((f) =>
			f.embedded
				? [
						{
							name: embeddedFieldName(f),
							type: f.type,
							tag: f.tag,
							embedded: true,
						},
					]
				: (f.names ?? []).map((name) => ({
						name,
						type: f.type,
						tag: f.tag,
						embedded: false,
					})),
		);
	return [...t.fields].map(([name, type]) => ({
		name,
		type,
		tag: null,
		embedded: false,
	}));
}

const sameList = (xs, ys, seen) =>
	xs.length === ys.length && xs.every((x, i) => identicalIn(x, ys[i], seen));

// The declaration a named type comes from.  A package a program imports along
// several paths, or a standard library package compiled for both targets, is
// checked once per path, so the same declaration can have several type
// objects.
function declOf(t) {
	return t._declNode ?? t._genericOf?.declNode ?? t._generic?.declNode;
}

// Whether two type objects are the same named type: a copy of one object, a
// type from one declaration, or one of the several objects built for a type
// whose declaration is parsed again per compilation.  Those carry no shared
// declaration: the built-in types (DOM and WebGL classes, `.d.ts` classes) are
// told apart by name, and standard library types by their mangled name
// (`Time$$time`), which includes the package.
function identicalNamed(a, b, seen) {
	if ((a._substOf ?? a) === (b._substOf ?? b)) return true;
	const decl = declOf(a);
	const sameName = a.name === b.name;
	if (decl !== declOf(b)) {
		if (!sameName || !String(a.name).includes("$$")) return false;
	} else if (!decl && !sameName) return false;
	return sameList(a.typeArgs ?? [], b.typeArgs ?? [], seen);
}

// Struct tags matter for identity but not for conversions (`ignoreTags`).
function sameTag(x, y, seen) {
	return seen.ignoreTags || (x.tag ?? null) === (y.tag ?? null);
}

function identicalStruct(a, b, seen) {
	const xs = structFieldList(a);
	const ys = structFieldList(b);
	return (
		xs.length === ys.length &&
		xs.every((x, i) => {
			const y = ys[i];
			return (
				x.name === y.name &&
				x.embedded === y.embedded &&
				sameTag(x, y, seen) &&
				identicalIn(x.type, y.type, seen)
			);
		})
	);
}

function identicalInterface(a, b, seen) {
	if (a.unionConstraint || b.unionConstraint) return false;
	if (a._typeSetEmbeds || b._typeSetEmbeds) return false;
	if (Boolean(a._comparable) !== Boolean(b._comparable)) return false;
	if (a.methods.size !== b.methods.size) return false;
	for (const [name, m] of a.methods) {
		const other = b.methods.get(name);
		if (!other || !identicalIn(m, other, seen)) return false;
	}
	return true;
}

function identicalFunc(a, b, seen) {
	return (
		Boolean(a.variadic) === Boolean(b.variadic) &&
		sameList(a.params ?? [], b.params ?? [], seen) &&
		sameList(funcResults(a), funcResults(b), seen)
	);
}

// Compares the structure of two types of the same kind.
function identicalShape(a, b, seen) {
	switch (a.kind) {
		case "basic":
			return a.name === b.name;
		case "untyped":
			return a.base === b.base && Boolean(a.rune) === Boolean(b.rune);
		case "slice":
			return identicalIn(a.elem, b.elem, seen);
		case "array":
			return (
				(a.size ?? null) === (b.size ?? null) &&
				identicalIn(a.elem, b.elem, seen)
			);
		case "map":
			return (
				identicalIn(a.key, b.key, seen) && identicalIn(a.value, b.value, seen)
			);
		case "pointer":
			return identicalIn(a.base, b.base, seen);
		case "tuple":
			return sameList(a.types, b.types, seen);
		case "promise":
			return identicalIn(a.elem, b.elem, seen);
		case "shared":
			return a.shared === b.shared;
		case "func":
			return identicalFunc(a, b, seen);
		case "struct":
			return identicalStruct(a, b, seen);
		case "interface":
			return identicalInterface(a, b, seen);
		case "named":
			return identicalNamed(a, b, seen);
		case "typeParam":
		case "generic":
			return a.name === b.name;
		case "namespace":
			// A declaration package's type is its own: `p1.Buffer` is not `p2.Buffer`,
			// nor a consumer `.d.ts` interface of the same bare name.
			return a.name === b.name && a._pkg === b._pkg;
		default:
			return false;
	}
}

function identicalIn(a, b, seen) {
	if (a === b) return true;
	if (!a || !b) return (!a || isVoid(a)) && (!b || isVoid(b));
	if (isAnyLike(a) || isAnyLike(b)) return isAnyLike(a) && isAnyLike(b);
	if (a.kind !== b.kind) return false;
	// A pair already being compared is assumed identical, which ends the
	// recursion through a type that mentions itself.
	let pending = seen.get(a);
	if (!pending) {
		pending = new Set();
		seen.set(a, pending);
	}
	if (pending.has(b)) return true;
	pending.add(b);
	try {
		return identicalShape(a, b, seen);
	} finally {
		pending.delete(b);
	}
}

// A shallow copy of `t` with `extra` added.  A copy of a named type is still
// that type, which `identical` follows through `_substOf`.
export function copyType(t, extra = {}) {
	if (t?.kind !== "named") return { ...t, ...extra };
	return { ...t, ...extra, _substOf: t._substOf ?? t };
}

// Whether `a` and `b` are the same type.  Basic types match by name; a named
// type only matches itself (or an instance of the same generic declaration
// with identical type arguments); composite types match element by element;
// the three kinds of `any` match each other.
// With `ignoreTags`, struct tags are not compared (the rule for conversions).
export function identical(a, b, { ignoreTags = false } = {}) {
	const seen = new Map();
	seen.ignoreTags = ignoreTags;
	return identicalIn(a, b, seen);
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
		const st = underlyingOf(inner);
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

// Go's export rule: a name is exported when its first character is a Unicode
// uppercase letter (`_` and `__Name` are not).
export function isExported(name) {
	return typeof name === "string" && /^\p{Lu}/u.test(name);
}

// The package (a checker's `_pkgId`) declaring each AST declaration. Shared by
// every checker: an importing package resolves the declarations of imported
// generic types, and their members belong to the package that wrote them.
export const declPackages = new WeakMap();

// A struct records the package that declared each of its fields in
// `_fieldOwner`, promoted ones included, so an unexported field stays
// unreachable from another package however it is reached.
export function copyFieldOwner(struct, from, name) {
	const owner = from._fieldOwner?.get(name);
	if (owner === undefined) return;
	struct._fieldOwner ??= new Map();
	struct._fieldOwner.set(name, owner);
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
	const fn = underlyingOf(t);
	if (fn?.kind !== "func") return null;
	if (fn.params.length !== 1) return null;
	const yieldFn = underlyingOf(fn.params[0]);
	if (yieldFn?.kind !== "func") return null;
	if (yieldFn.returns.length !== 1 || !isBool(yieldFn.returns[0])) return null;
	if (yieldFn.params.length > 2) return null;
	return { yieldParams: yieldFn.params };
}

// ── Scope / environment ──────────────────────────────────────

// What a name is bound to, as in Go: a variable (also a parameter or
// result), a constant, a type, a declared function, an imported package or a
// builtin. A scope maps each name it declares to one object
// `{ kind, type, node, local }`: `kind` is "var", "const", "type", "func",
// "pkg" or "builtin"; `type` is the type of the value, or the type itself for
// a type name; `node` the declaring node, when one was given; `local` marks a
// `var` or `:=` declaration, which must be used.
export class Scope {
	constructor(parent = null) {
		this.parent = parent;
		this.objects = new Map(); // name -> object declared in this scope
		this._constExprs = new Map(); // name -> AST initializer expr
		this._used = new Set(); // names referenced in this scope
	}
	_bind(name, kind, type, node = null, local = false) {
		this.objects.set(name, { kind, type, node, local });
	}
	// Binds `name` to a value: a variable, parameter or result.
	define(name, type) {
		this._bind(name, "var", type);
	}
	// Binds `name` to a value whose type `typeOf()` supplies on first use, so a
	// type that is costly to build is built only for a program that reads it.
	// `typeOf` returns null while there is nothing to supply yet; the binding
	// then reads as `fallback`.
	defineLazy(name, typeOf, fallback) {
		this._bind(name, "var", fallback);
		const obj = this.objects.get(name);
		let resolved = null;
		Object.defineProperty(obj, "type", {
			get() {
				resolved ??= typeOf();
				return resolved ?? fallback;
			},
		});
	}
	// Binds `name` to a predeclared function such as `len`.
	defineBuiltin(name, type) {
		this._bind(name, "builtin", type);
	}
	// Binds `name` to a declared function (`func name(...)`), which is a value
	// but not a variable.
	defineFunc(name, type, node = null) {
		this._bind(name, "func", type, node);
	}
	// Binds `name` to an imported package's namespace (not a variable).
	definePackage(name, ns) {
		this._bind(name, "pkg", ns);
	}
	// Binds `name` to a type declaration (`type T ...`, `type T = ...`): a
	// reference to it names a type, whatever other bindings share its name.
	defineType(name, type) {
		this._bind(name, "type", type);
	}
	// True when the binding `name` resolves to is a type declaration, not a
	// variable, constant, function, parameter or package that shares the name.
	bindsType(name) {
		return this.lookupObject(name)?.kind === "type";
	}
	// `node` (optional) carries the position of the declaring identifier.
	defineLocal(name, type, node = null) {
		const at = node && typeof node === "object" ? node : null;
		this._bind(name, "var", type, at, name !== "_");
	}
	// The node a local was declared at, or null when none was recorded.
	localNode(name) {
		const obj = this.objects.get(name);
		return obj?.local ? obj.node : null;
	}
	defineConst(name, type, expr = null) {
		this._bind(name, "const", type);
		if (expr) this._constExprs.set(name, expr);
	}
	lookupConstExpr(name) {
		if (this._constExprs.has(name)) return this._constExprs.get(name);
		if (this.parent) return this.parent.lookupConstExpr(name);
		return null;
	}
	isConst(name) {
		// Don't walk parent — shadowing a const with a var in a child scope is valid
		return this.objects.get(name)?.kind === "const";
	}
	// Whether this scope itself declares `name`.
	has(name) {
		return this.objects.has(name);
	}
	// The type `name` is bound to in this scope itself, if it declares it.
	get(name) {
		return this.objects.get(name)?.type;
	}
	// The object `name` is bound to in this scope itself, if it declares it.
	object(name) {
		return this.objects.get(name);
	}
	// Names this scope declares as `kind`.
	*names(kind) {
		for (const [name, obj] of this.objects) if (obj.kind === kind) yield name;
	}
	lookup(name) {
		const obj = this.objects.get(name);
		if (obj) {
			this._used.add(name);
			return obj.type;
		}
		if (this.parent) return this.parent.lookup(name);
		return null;
	}
	// The object `name` resolves to from this scope, or null. Unlike `lookup`
	// this does not count as a use of the name.
	lookupObject(name) {
		return this.lookupScope(name)?.objects.get(name) ?? null;
	}
	// Lookup which scope owns the name (to check const flag)
	lookupScope(name) {
		if (this.objects.has(name)) return this;
		if (this.parent) return this.parent.lookupScope(name);
		return null;
	}
	// Returns local variable names that were never referenced
	unusedLocals() {
		const unused = [];
		for (const [name, obj] of this.objects) {
			if (obj.local && !this._used.has(name)) unused.push(name);
		}
		return unused;
	}
}

// The package-level scope of several linked packages checked together (the
// monomorphised program). Types and exported or instance-mangled (`$`)
// declarations are shared, but a package's unexported `func`, `var` or
// `const` is visible only while that package's files are being checked, so it
// cannot shadow a predeclared builtin the other packages call. The same holds
// for an unexported type named like a builtin function (`type append int`);
// other unexported types stay shared, as do `error`-like predeclared type names.
export class PackageScope extends Scope {
	constructor(parent = null) {
		super(parent);
		this.currentPackage = null; // package whose file is being checked
	}
	_bind(name, kind, type, node = null, local = false) {
		super._bind(name, kind, type, node, local);
		this.objects.get(name).pkg = this.currentPackage;
	}
	// True when `name` is a predeclared builtin function (`append`, `len`), not
	// a predeclared type such as `error`, which is bound as a builtin too.
	_shadowsBuiltinFunc(name) {
		return name !== "error" && this.parent?.lookup(name)?.kind === "builtin";
	}
	_hidden(name) {
		const obj = this.objects.get(name);
		return (
			this.currentPackage != null &&
			obj?.pkg != null &&
			obj.pkg !== this.currentPackage &&
			(obj.kind !== "type" || this._shadowsBuiltinFunc(name)) &&
			!name.includes("$") &&
			!/^\p{Lu}/u.test(name)
		);
	}
	has(name) {
		return this.objects.has(name) && !this._hidden(name);
	}
	get(name) {
		return this._hidden(name) ? undefined : super.get(name);
	}
	object(name) {
		return this._hidden(name) ? undefined : super.object(name);
	}
	isConst(name) {
		return !this._hidden(name) && super.isConst(name);
	}
	lookup(name) {
		if (this._hidden(name)) return this.parent?.lookup(name) ?? null;
		return super.lookup(name);
	}
	lookupConstExpr(name) {
		if (this._hidden(name)) return this.parent?.lookupConstExpr(name) ?? null;
		return super.lookupConstExpr(name);
	}
	lookupScope(name) {
		if (this._hidden(name)) return this.parent?.lookupScope(name) ?? null;
		return super.lookupScope(name);
	}
}
