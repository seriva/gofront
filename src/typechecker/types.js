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

// Stdlib packages the WASM backend can emit. Extend as src/backend/wasm/emit-stdlib.js
// gains support; anything not listed is rejected at import with "not yet available in
// wasm packages".
export const WASM_SUPPORTED_STDLIB = new Set([
	"math",
	"math/bits",
	"math/rand",
	"errors",
	"fmt",
	"strings",
	"bytes",
	"strconv",
	"unicode",
	"unicode/utf8",
	"slices",
	"maps",
	"sort",
	"path",
	"path/filepath",
	"html",
	"io",
	"time",
	"testing",
	"gofront/shared",
	"gofront/simd",
	"sync",
	"crypto/rand",
	"crypto/sha256",
	"encoding/binary",
	"encoding/hex",
	"encoding/base64",
	"os",
	"encoding/json",
]);

export const STDLIB_PACKAGES = new Set([
	...WASM_SUPPORTED_STDLIB,
	"gom",
	"regexp",
]);

// Per-namespace member subset the WASM backend implements. `null` means every
// member the checker knows about. Members outside the set are rejected in
// wasm/both packages with "'strings.Split' is not yet available in wasm packages".
export const WASM_STDLIB_MEMBERS = new Map([
	["os", new Set(["Stdout", "Stderr", "Stdin", "File"])],
	[
		"math",
		new Set([
			"Sqrt",
			"Floor",
			"Ceil",
			"Trunc",
			"Abs",
			"Min",
			"Max",
			"Copysign",
			"Dim",
			"Inf",
			"NaN",
			"IsNaN",
			"IsInf",
			"Signbit",
			"Sin",
			"Cos",
			"Tan",
			"Asin",
			"Acos",
			"Atan",
			"Atan2",
			"Pow",
			"Mod",
			"Hypot",
			"Cbrt",
			"Exp",
			"Exp2",
			"Log",
			"Log1p",
			"Log2",
			"Log10",
			"Expm1",
			"Round",
			"Remainder",
			"Float64bits",
			"Float64frombits",
			"Float32bits",
			"Float32frombits",
			"Sinh",
			"Cosh",
			"Tanh",
			// constants
			"E",
			"Pi",
			"Phi",
			"Sqrt2",
			"SqrtE",
			"SqrtPi",
			"SqrtPhi",
			"Ln2",
			"Log2E",
			"Ln10",
			"Log10E",
			"MaxFloat32",
			"SmallestNonzeroFloat32",
			"MaxFloat64",
			"SmallestNonzeroFloat64",
			"MaxInt",
			"MinInt",
			"MaxInt8",
			"MinInt8",
			"MaxInt16",
			"MinInt16",
			"MaxInt32",
			"MinInt32",
			"MaxInt64",
			"MinInt64",
			"MaxUint8",
			"MaxUint16",
			"MaxUint32",
			"MaxUint",
			"MaxUint64",
		]),
	],
	[
		"bits",
		new Set([
			"Add",
			"Add32",
			"Add64",
			"Sub",
			"Sub32",
			"Sub64",
			"Mul",
			"Mul32",
			"Mul64",
			"Div",
			"Div32",
			"Div64",
			"Rem",
			"Rem32",
			"Rem64",
			"LeadingZeros",
			"LeadingZeros8",
			"LeadingZeros16",
			"LeadingZeros32",
			"LeadingZeros64",
			"TrailingZeros",
			"TrailingZeros8",
			"TrailingZeros16",
			"TrailingZeros32",
			"TrailingZeros64",
			"OnesCount",
			"OnesCount8",
			"OnesCount16",
			"OnesCount32",
			"OnesCount64",
			"RotateLeft",
			"RotateLeft8",
			"RotateLeft16",
			"RotateLeft32",
			"RotateLeft64",
			"Reverse",
			"Reverse8",
			"Reverse16",
			"Reverse32",
			"Reverse64",
			"ReverseBytes",
			"ReverseBytes16",
			"ReverseBytes32",
			"ReverseBytes64",
			"Len",
			"Len8",
			"Len16",
			"Len32",
			"Len64",
			"UintSize",
		]),
	],
	["errors", new Set(["New", "Is", "Unwrap", "As", "Join"])],
	[
		"utf8",
		new Set([
			"RuneCountInString",
			"RuneLen",
			"ValidString",
			"ValidRune",
			"DecodeRuneInString",
			"DecodeLastRuneInString",
			"FullRuneInString",
			"RuneError",
			"MaxRune",
			"UTFMax",
			"RuneSelf",
			"EncodeRune",
			"AppendRune",
			"DecodeRune",
			"DecodeLastRune",
			"RuneCount",
			"FullRune",
			"Valid",
			"RuneStart",
		]),
	],
	[
		"sort",
		new Set([
			"Ints",
			"Float64s",
			"Strings",
			"Slice",
			"SliceStable",
			"SliceIsSorted",
			"Search",
			"IntsAreSorted",
			"Float64sAreSorted",
			"StringsAreSorted",
		]),
	],
	[
		"fmt",
		new Set([
			"Sprintf",
			"Sprint",
			"Sprintln",
			"Append",
			"Appendf",
			"Appendln",
			"Errorf",
			"Printf",
			"Println",
			"Print",
			"Fprintf",
			"Fprintln",
			"Fprint",
			"Sscan",
			"Sscanln",
			"Sscanf",
			"Stringer",
		]),
	],
	[
		"strings",
		new Set([
			"Contains",
			"ContainsAny",
			"ContainsRune",
			"HasPrefix",
			"HasSuffix",
			"Index",
			"IndexAny",
			"IndexByte",
			"IndexRune",
			"LastIndex",
			"LastIndexByte",
			"Count",
			"Repeat",
			"Replace",
			"ReplaceAll",
			"ToUpper",
			"ToLower",
			"Title",
			"ToTitle",
			"TrimSpace",
			"Trim",
			"TrimLeft",
			"TrimRight",
			"TrimPrefix",
			"TrimSuffix",
			"EqualFold",
			"Split",
			"Fields",
			"Join",
			"Cut",
			"CutPrefix",
			"CutSuffix",
			"SplitN",
			"SplitAfter",
			"SplitAfterN",
			"LastIndexAny",
			"Map",
			"IndexFunc",
			"LastIndexFunc",
			"TrimFunc",
			"TrimLeftFunc",
			"TrimRightFunc",
			"FieldsFunc",
			"NewReplacer",
			"Replacer",
			"Builder",
			"NewReader",
			"Reader",
			"ToValidUTF8",
		]),
	],
	[
		"strconv",
		new Set([
			"Itoa",
			"Atoi",
			"FormatInt",
			"FormatUint",
			"FormatFloat",
			"FormatBool",
			"ParseInt",
			"ParseUint",
			"ParseFloat",
			"ParseBool",
			"Quote",
			"Unquote",
			"AppendInt",
			"AppendUint",
			"AppendFloat",
			"AppendBool",
			"ErrSyntax",
			"ErrRange",
			"IntSize",
			"NumError",
			"QuoteRune",
			"QuoteToASCII",
			"QuoteRuneToASCII",
			"AppendQuote",
			"AppendQuoteToASCII",
			"AppendQuoteRune",
			"AppendQuoteRuneToASCII",
			"CanBackquote",
			"UnquoteChar",
			"QuotedPrefix",
			"IsPrint",
			"IsGraphic",
		]),
	],
	[
		"slices",
		new Set([
			"Sort",
			"Reverse",
			"Contains",
			"Index",
			"IndexFunc",
			"ContainsFunc",
			"BinarySearch",
			"BinarySearchFunc",
			"Equal",
			"Clone",
			"Compare",
			"SortFunc",
			"SortStableFunc",
			"IsSorted",
			"IsSortedFunc",
			"Min",
			"Max",
			"MinFunc",
			"MaxFunc",
			"Compact",
			"CompactFunc",
			"Concat",
			"Delete",
			"DeleteFunc",
			"Insert",
			"Replace",
			"Grow",
			"Clip",
		]),
	],
	[
		"maps",
		new Set(["Clone", "Copy", "Equal", "EqualFunc", "Delete", "DeleteFunc"]),
	],
	[
		"unicode",
		new Set([
			"IsLetter",
			"IsDigit",
			"IsSpace",
			"IsUpper",
			"IsLower",
			"IsPunct",
			"IsControl",
			"IsPrint",
			"IsGraphic",
			"ToUpper",
			"ToLower",
		]),
	],
	[
		"rand",
		new Set([
			"Intn",
			"Float64",
			"Float32",
			"Int",
			"Int63",
			"Int63n",
			"Int31",
			"Int31n",
			"Seed",
			"Shuffle",
			"Perm",
			"Read",
			"Reader",
		]),
	],
	[
		"bytes",
		new Set([
			"Contains",
			"HasPrefix",
			"HasSuffix",
			"Index",
			"Count",
			"Repeat",
			"Replace",
			"ReplaceAll",
			"ToUpper",
			"ToLower",
			"TrimSpace",
			"Trim",
			"Equal",
			"Split",
			"Join",
			"TrimPrefix",
			"TrimSuffix",
			"TrimLeft",
			"TrimRight",
			"TrimFunc",
			"IndexByte",
			"LastIndex",
			"LastIndexByte",
			"Fields",
			"FieldsFunc",
			"Clone",
			"Cut",
			"ToTitle",
			"ContainsAny",
			"ContainsRune",
			"Map",
			"SplitN",
			"Buffer",
			"NewBuffer",
			"NewBufferString",
			"NewReader",
			"Reader",
			"ToValidUTF8",
		]),
	],
	[
		"path",
		new Set([
			"Base",
			"Dir",
			"Ext",
			"Join",
			"Clean",
			"IsAbs",
			"Split",
			"Match",
			"ErrBadPattern",
		]),
	],
	[
		"filepath",
		new Set([
			"Base",
			"Dir",
			"Ext",
			"Join",
			"Clean",
			"IsAbs",
			"Split",
			"Match",
			"ErrBadPattern",
		]),
	],
	["html", new Set(["EscapeString", "UnescapeString"])],
	[
		"io",
		new Set([
			"Writer",
			"Reader",
			"ReadWriter",
			"Closer",
			"EOF",
			"ReadAll",
			"Discard",
			"WriteString",
			"LimitReader",
			"Copy",
			"CopyN",
		]),
	],
	[
		"time",
		new Set([
			"Now",
			"Since",
			"Parse",
			"ParseDuration",
			"Unix",
			"UnixMicro",
			"UnixMilli",
			"Date",
			"FixedZone",
			"Duration",
			"Nanosecond",
			"Microsecond",
			"Millisecond",
			"Second",
			"Minute",
			"Hour",
			"RFC3339",
			"RFC3339Nano",
			"DateOnly",
			"TimeOnly",
			"DateTime",
			"UTC",
			"Local",
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
			"Time",
			"Month",
			"Weekday",
			"Location",
		]),
	],
	["testing", new Set(["T", "B", "M", "TB", "BenchmarkResult"])],
	["sync", new Set(["Mutex", "RWMutex", "Once", "WaitGroup", "Locker"])],
	["sha256", new Set(["Sum256", "New", "Size", "BlockSize"])],
	[
		"binary",
		new Set([
			"LittleEndian",
			"BigEndian",
			"ByteOrder",
			"Read",
			"Write",
			"Size",
			"AppendUint16",
			"AppendUint32",
			"AppendUint64",
		]),
	],
	[
		"hex",
		new Set([
			"EncodeToString",
			"DecodeString",
			"Encode",
			"Decode",
			"EncodedLen",
			"DecodedLen",
			"ErrLength",
		]),
	],
	[
		"base64",
		new Set([
			"StdEncoding",
			"URLEncoding",
			"RawStdEncoding",
			"RawURLEncoding",
			"Encoding",
			"NewEncoding",
			"StdPadding",
			"NoPadding",
		]),
	],
]);

export const VALID_TARGETS = new Set(["js", "wasm", "both"]);

// Backend-provided implementations for body-less Go-source stdlib functions
// marked `//gofront:intrinsic <name>`: name -> required signature.  New
// intrinsics need a plan change.
export const INTRINSICS = new Map([]);

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
			return INT;
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
			return `untyped ${t.base}`;
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

// Go-source stdlib names are mangled to `Name$$path` (`List$$container$list`);
// diagnostics show them qualified, as Go does (`list.List`).
export function displayTypeName(name) {
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
