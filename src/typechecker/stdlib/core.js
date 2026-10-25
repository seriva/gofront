// Core standard library type definitions — browser globals, fmt, strings, bytes,
// strconv, sort, math, errors, time, unicode, os, slices, html, io.

import {
	ANY,
	BOOL,
	BROWSER_GLOBALS,
	ERROR,
	FLOAT32,
	FLOAT64,
	INT,
	INT32,
	INT64,
	STRING,
	UINT,
	UINT8,
	UINT16,
	UINT32,
	UINT64,
	UNTYPED_INT,
	VOID,
} from "../types.js";

const MONTH_T = {
	kind: "named",
	name: "time.Month",
	underlying: INT,
	methods: new Map([
		["String", { kind: "func", params: [], returns: [STRING] }],
	]),
};

const WEEKDAY_T = {
	kind: "named",
	name: "time.Weekday",
	underlying: INT,
	methods: new Map([
		["String", { kind: "func", params: [], returns: [STRING] }],
	]),
};

const LOCATION_T = {
	kind: "named",
	name: "time.Location",
	underlying: {
		kind: "struct",
		fields: new Map([
			["_name", STRING],
			["_offset", INT],
		]),
		methods: new Map([
			["String", { kind: "func", params: [], returns: [STRING] }],
		]),
	},
};
LOCATION_T.methods = LOCATION_T.underlying.methods;
const LOCATION_PTR_T = {
	kind: "pointer",
	base: LOCATION_T,
};

const DURATION_T = {
	kind: "named",
	name: "time.Duration",
	underlying: INT64,
	methods: new Map([
		["Nanoseconds", { kind: "func", params: [], returns: [INT64] }],
		["Microseconds", { kind: "func", params: [], returns: [INT64] }],
		["Milliseconds", { kind: "func", params: [], returns: [INT64] }],
		["Seconds", { kind: "func", params: [], returns: [FLOAT64] }],
		["Minutes", { kind: "func", params: [], returns: [FLOAT64] }],
		["Hours", { kind: "func", params: [], returns: [FLOAT64] }],
		["String", { kind: "func", params: [], returns: [STRING] }],
	]),
};
DURATION_T.methods.set("Truncate", {
	kind: "func",
	params: [DURATION_T],
	returns: [DURATION_T],
});
DURATION_T.methods.set("Round", {
	kind: "func",
	params: [DURATION_T],
	returns: [DURATION_T],
});
DURATION_T.methods.set("Abs", {
	kind: "func",
	params: [],
	returns: [DURATION_T],
});

const TIMER_T = {
	kind: "named",
	name: "time.Timer",
	underlying: {
		kind: "struct",
		fields: new Map(),
		methods: new Map([
			["Stop", { kind: "func", params: [], returns: [BOOL], _ptrRecv: true }],
			[
				"Reset",
				{ kind: "func", params: [DURATION_T], returns: [BOOL], _ptrRecv: true },
			],
		]),
	},
};
TIMER_T.methods = TIMER_T.underlying.methods;
const TIMER_PTR_T = {
	kind: "pointer",
	base: TIMER_T,
};

const TIME_BYTES = { kind: "slice", elem: UINT8 };
const TIME_T = {
	kind: "named",
	name: "time.Time",
	underlying: {
		kind: "struct",
		fields: new Map(),
		methods: new Map(),
	},
};
TIME_T.underlying.fields.set("_unixNano", INT64);
TIME_T.underlying.fields.set("_offset", INT32);
TIME_T.underlying.fields.set("_loc", ANY);
TIME_T.underlying.methods = new Map([
	["Format", { kind: "func", params: [STRING], returns: [STRING] }],
	["String", { kind: "func", params: [], returns: [STRING] }],
	["Year", { kind: "func", params: [], returns: [INT] }],
	["Month", { kind: "func", params: [], returns: [MONTH_T] }],
	["Day", { kind: "func", params: [], returns: [INT] }],
	["Hour", { kind: "func", params: [], returns: [INT] }],
	["Minute", { kind: "func", params: [], returns: [INT] }],
	["Second", { kind: "func", params: [], returns: [INT] }],
	["Weekday", { kind: "func", params: [], returns: [WEEKDAY_T] }],
	["Unix", { kind: "func", params: [], returns: [INT64] }],
	["UnixMilli", { kind: "func", params: [], returns: [INT64] }],
	["UnixNano", { kind: "func", params: [], returns: [INT64] }],
	["Nanosecond", { kind: "func", params: [], returns: [INT] }],
	["IsZero", { kind: "func", params: [], returns: [BOOL] }],
	["UTC", { kind: "func", params: [], returns: [TIME_T] }],
	["Local", { kind: "func", params: [], returns: [TIME_T] }],
	["Add", { kind: "func", params: [DURATION_T], returns: [TIME_T] }],
	["Sub", { kind: "func", params: [TIME_T], returns: [DURATION_T] }],
	["Before", { kind: "func", params: [TIME_T], returns: [BOOL] }],
	["After", { kind: "func", params: [TIME_T], returns: [BOOL] }],
	["Equal", { kind: "func", params: [TIME_T], returns: [BOOL] }],
	["AddDate", { kind: "func", params: [INT, INT, INT], returns: [TIME_T] }],
	["Truncate", { kind: "func", params: [DURATION_T], returns: [TIME_T] }],
	["Round", { kind: "func", params: [DURATION_T], returns: [TIME_T] }],
	["Date", { kind: "func", params: [], returns: [INT, INT, INT] }],
	["Clock", { kind: "func", params: [], returns: [INT, INT, INT] }],
	["YearDay", { kind: "func", params: [], returns: [INT] }],
	["ISOWeek", { kind: "func", params: [], returns: [INT, INT] }],
	["Compare", { kind: "func", params: [TIME_T], returns: [INT] }],
	["In", { kind: "func", params: [ANY], returns: [TIME_T] }],
	["Location", { kind: "func", params: [], returns: [LOCATION_PTR_T] }],
	["Zone", { kind: "func", params: [], returns: [STRING, INT] }],
	["MarshalJSON", { kind: "func", params: [], returns: [TIME_BYTES, ERROR] }],
	[
		"UnmarshalJSON",
		{ kind: "func", params: [TIME_BYTES], returns: [ERROR], _ptrRecv: true },
	],
	["MarshalText", { kind: "func", params: [], returns: [TIME_BYTES, ERROR] }],
	[
		"UnmarshalText",
		{ kind: "func", params: [TIME_BYTES], returns: [ERROR], _ptrRecv: true },
	],
]);
TIME_T.methods = TIME_T.underlying.methods;
const REPLACER_T = {
	kind: "pointer",
	base: { kind: "named", name: "strings.Replacer" },
};

export function setupCoreGlobals(globals, types) {
	for (const g of BROWSER_GLOBALS) globals.define(g, ANY);

	const fmtVariadic = (ret) => ({
		kind: "func",
		params: [STRING, ANY],
		returns: [ret],
		variadic: true,
	});
	const FMT_BYTES = { kind: "slice", elem: UINT8 };
	const fmtPrintVariadic = (ret) => ({
		kind: "func",
		params: [ANY],
		returns: [ret],
		variadic: true,
	});
	const FMT_STRINGER = {
		kind: "interface",
		name: "fmt.Stringer",
		methods: new Map([
			["String", { kind: "func", params: [], returns: [STRING] }],
		]),
	};
	globals.define("fmt", {
		kind: "namespace",
		name: "fmt",
		members: {
			Stringer: FMT_STRINGER,
			Sprintf: fmtVariadic(STRING),
			Sprint: fmtPrintVariadic(STRING),
			Sprintln: fmtPrintVariadic(STRING),
			Append: {
				kind: "func",
				params: [FMT_BYTES, ANY],
				returns: [FMT_BYTES],
				variadic: true,
			},
			Appendf: {
				kind: "func",
				params: [FMT_BYTES, STRING, ANY],
				returns: [FMT_BYTES],
				variadic: true,
			},
			Appendln: {
				kind: "func",
				params: [FMT_BYTES, ANY],
				returns: [FMT_BYTES],
				variadic: true,
			},
			Errorf: fmtVariadic(ERROR),
			Printf: fmtVariadic(VOID),
			Println: fmtPrintVariadic(VOID),
			Print: fmtPrintVariadic(VOID),
			Fprintf: {
				kind: "func",
				params: [ANY, STRING, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Fprintln: {
				kind: "func",
				params: [ANY, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Fprint: {
				kind: "func",
				params: [ANY, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Sscan: {
				kind: "func",
				params: [STRING, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Sscanln: {
				kind: "func",
				params: [STRING, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Sscanf: {
				kind: "func",
				params: [STRING, STRING, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
		},
	});

	const strFn1 = (ret) => ({ kind: "func", params: [STRING], returns: [ret] });
	const strFn2 = (p2, ret) => ({
		kind: "func",
		params: [STRING, p2],
		returns: [ret],
	});
	const strFn3 = (p2, p3, ret) => ({
		kind: "func",
		params: [STRING, p2, p3],
		returns: [ret],
	});
	globals.define("strings", {
		kind: "namespace",
		name: "strings",
		members: {
			Contains: strFn2(STRING, BOOL),
			HasPrefix: strFn2(STRING, BOOL),
			HasSuffix: strFn2(STRING, BOOL),
			Index: strFn2(STRING, INT),
			LastIndex: strFn2(STRING, INT),
			Count: strFn2(STRING, INT),
			Repeat: strFn2(INT, STRING),
			Replace: {
				kind: "func",
				params: [STRING, STRING, STRING, INT],
				returns: [STRING],
			},
			ReplaceAll: strFn3(STRING, STRING, STRING),
			ToUpper: strFn1(STRING),
			ToLower: strFn1(STRING),
			TrimSpace: strFn1(STRING),
			Trim: strFn2(STRING, STRING),
			TrimPrefix: strFn2(STRING, STRING),
			TrimSuffix: strFn2(STRING, STRING),
			TrimLeft: strFn2(STRING, STRING),
			TrimRight: strFn2(STRING, STRING),
			Split: strFn2(STRING, { kind: "slice", elem: STRING }),
			Join: {
				kind: "func",
				params: [{ kind: "slice", elem: STRING }, STRING],
				returns: [STRING],
			},
			EqualFold: strFn2(STRING, BOOL),
			Fields: strFn1({ kind: "slice", elem: STRING }),
			FieldsFunc: strFn2(ANY, { kind: "slice", elem: STRING }),
			Cut: {
				kind: "func",
				params: [STRING, STRING],
				returns: [STRING, STRING, BOOL],
			},
			CutPrefix: {
				kind: "func",
				params: [STRING, STRING],
				returns: [STRING, BOOL],
			},
			CutSuffix: {
				kind: "func",
				params: [STRING, STRING],
				returns: [STRING, BOOL],
			},
			SplitN: strFn3(STRING, INT, { kind: "slice", elem: STRING }),
			SplitAfter: strFn2(STRING, { kind: "slice", elem: STRING }),
			SplitAfterN: strFn3(STRING, INT, { kind: "slice", elem: STRING }),
			IndexAny: strFn2(STRING, INT),
			LastIndexAny: strFn2(STRING, INT),
			ContainsAny: strFn2(STRING, BOOL),
			ContainsRune: strFn2(INT, BOOL),
			IndexRune: strFn2(INT, INT),
			IndexByte: strFn2(INT, INT),
			LastIndexByte: strFn2(INT, INT),
			Map: {
				kind: "func",
				params: [ANY, STRING],
				returns: [STRING],
			},
			Title: strFn1(STRING),
			ToTitle: strFn1(STRING),
			TrimFunc: { kind: "func", params: [STRING, ANY], returns: [STRING] },
			TrimLeftFunc: { kind: "func", params: [STRING, ANY], returns: [STRING] },
			TrimRightFunc: { kind: "func", params: [STRING, ANY], returns: [STRING] },
			IndexFunc: { kind: "func", params: [STRING, ANY], returns: [INT] },
			LastIndexFunc: { kind: "func", params: [STRING, ANY], returns: [INT] },
			NewReplacer: {
				kind: "func",
				params: [STRING],
				returns: [REPLACER_T],
				variadic: true,
			},
			NewReader: { kind: "func", params: [STRING], returns: [ANY] },
			Builder: ANY,
		},
	});

	const BYTE_SLICE = { kind: "slice", elem: UINT8 };
	const byFn1 = (ret) => ({
		kind: "func",
		params: [BYTE_SLICE],
		returns: [ret],
	});
	const byFn2 = (p2, ret) => ({
		kind: "func",
		params: [BYTE_SLICE, p2],
		returns: [ret],
	});
	globals.define("bytes", {
		kind: "namespace",
		name: "bytes",
		members: {
			Contains: byFn2(BYTE_SLICE, BOOL),
			HasPrefix: byFn2(BYTE_SLICE, BOOL),
			HasSuffix: byFn2(BYTE_SLICE, BOOL),
			Index: byFn2(BYTE_SLICE, INT),
			Count: byFn2(BYTE_SLICE, INT),
			Repeat: byFn2(INT, BYTE_SLICE),
			Replace: {
				kind: "func",
				params: [BYTE_SLICE, BYTE_SLICE, BYTE_SLICE, INT],
				returns: [BYTE_SLICE],
			},
			ToUpper: byFn1(BYTE_SLICE),
			ToLower: byFn1(BYTE_SLICE),
			ToTitle: byFn1(BYTE_SLICE),
			TrimSpace: byFn1(BYTE_SLICE),
			Trim: byFn2(STRING, BYTE_SLICE),
			Equal: byFn2(BYTE_SLICE, BOOL),
			Split: byFn2(BYTE_SLICE, { kind: "slice", elem: BYTE_SLICE }),
			Join: {
				kind: "func",
				params: [{ kind: "slice", elem: BYTE_SLICE }, BYTE_SLICE],
				returns: [BYTE_SLICE],
			},
			ReplaceAll: {
				kind: "func",
				params: [BYTE_SLICE, BYTE_SLICE, BYTE_SLICE],
				returns: [BYTE_SLICE],
			},
			TrimPrefix: byFn2(BYTE_SLICE, BYTE_SLICE),
			TrimSuffix: byFn2(BYTE_SLICE, BYTE_SLICE),
			TrimLeft: byFn2(STRING, BYTE_SLICE),
			TrimRight: byFn2(STRING, BYTE_SLICE),
			TrimFunc: {
				kind: "func",
				params: [BYTE_SLICE, ANY],
				returns: [BYTE_SLICE],
			},
			IndexByte: byFn2(INT, INT),
			LastIndex: byFn2(BYTE_SLICE, INT),
			LastIndexByte: byFn2(INT, INT),
			Fields: byFn1({ kind: "slice", elem: BYTE_SLICE }),
			FieldsFunc: byFn2(ANY, { kind: "slice", elem: BYTE_SLICE }),
			Clone: byFn1(BYTE_SLICE),
			Cut: {
				kind: "func",
				params: [BYTE_SLICE, BYTE_SLICE],
				returns: [BYTE_SLICE, BYTE_SLICE, BOOL],
			},
			ContainsAny: byFn2(STRING, BOOL),
			ContainsRune: byFn2(INT, BOOL),
			Map: { kind: "func", params: [ANY, BYTE_SLICE], returns: [BYTE_SLICE] },
			SplitN: {
				kind: "func",
				params: [BYTE_SLICE, BYTE_SLICE, INT],
				returns: [{ kind: "slice", elem: BYTE_SLICE }],
			},
			NewReader: { kind: "func", params: [BYTE_SLICE], returns: [ANY] },
			Buffer: ANY,
		},
	});

	globals.define("strconv", {
		kind: "namespace",
		name: "strconv",
		members: {
			Itoa: { kind: "func", params: [INT], returns: [STRING] },
			Atoi: { kind: "func", params: [STRING], returns: [INT, ERROR] },
			FormatFloat: {
				kind: "func",
				params: [FLOAT64, INT, INT, INT],
				returns: [STRING],
			},
			FormatBool: { kind: "func", params: [BOOL], returns: [STRING] },
			FormatInt: { kind: "func", params: [INT64, INT], returns: [STRING] },
			FormatUint: { kind: "func", params: [UINT64, INT], returns: [STRING] },
			ParseFloat: {
				kind: "func",
				params: [STRING, INT],
				returns: [FLOAT64, ERROR],
			},
			ParseInt: {
				kind: "func",
				params: [STRING, INT, INT],
				returns: [INT64, ERROR],
			},
			ParseUint: {
				kind: "func",
				params: [STRING, INT, INT],
				returns: [UINT64, ERROR],
			},
			ParseBool: { kind: "func", params: [STRING], returns: [BOOL, ERROR] },
			Quote: { kind: "func", params: [STRING], returns: [STRING] },
			Unquote: { kind: "func", params: [STRING], returns: [STRING, ERROR] },
			AppendInt: {
				kind: "func",
				params: [BYTE_SLICE, INT64, INT],
				returns: [BYTE_SLICE],
			},
			AppendUint: {
				kind: "func",
				params: [BYTE_SLICE, UINT64, INT],
				returns: [BYTE_SLICE],
			},
			AppendFloat: {
				kind: "func",
				params: [BYTE_SLICE, FLOAT64, INT, INT, INT],
				returns: [BYTE_SLICE],
			},
			AppendBool: {
				kind: "func",
				params: [BYTE_SLICE, BOOL],
				returns: [BYTE_SLICE],
			},
			ErrSyntax: ERROR,
			ErrRange: ERROR,
		},
	});

	globals.define("sort", {
		kind: "namespace",
		name: "sort",
		members: {
			Ints: {
				kind: "func",
				params: [{ kind: "slice", elem: INT }],
				returns: [VOID],
			},
			Float64s: {
				kind: "func",
				params: [{ kind: "slice", elem: FLOAT64 }],
				returns: [VOID],
			},
			Strings: {
				kind: "func",
				params: [{ kind: "slice", elem: STRING }],
				returns: [VOID],
			},
			Slice: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			SliceStable: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			SliceIsSorted: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			Search: { kind: "func", params: [INT, ANY], returns: [INT] },
			IntsAreSorted: {
				kind: "func",
				params: [{ kind: "slice", elem: INT }],
				returns: [BOOL],
			},
			Float64sAreSorted: {
				kind: "func",
				params: [{ kind: "slice", elem: FLOAT64 }],
				returns: [BOOL],
			},
			StringsAreSorted: {
				kind: "func",
				params: [{ kind: "slice", elem: STRING }],
				returns: [BOOL],
			},
		},
	});

	globals.define("math", {
		kind: "namespace",
		name: "math",
		members: {
			Abs: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Floor: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Ceil: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Round: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Sqrt: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Cbrt: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Pow: { kind: "func", params: [FLOAT64, FLOAT64], returns: [FLOAT64] },
			Log: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Log1p: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Log2: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Log10: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Expm1: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Sin: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Cos: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Tan: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Min: { kind: "func", params: [FLOAT64, FLOAT64], returns: [FLOAT64] },
			Max: { kind: "func", params: [FLOAT64, FLOAT64], returns: [FLOAT64] },
			Mod: { kind: "func", params: [FLOAT64, FLOAT64], returns: [FLOAT64] },
			Inf: { kind: "func", params: [INT], returns: [FLOAT64] },
			IsNaN: { kind: "func", params: [FLOAT64], returns: [BOOL] },
			IsInf: { kind: "func", params: [FLOAT64, INT], returns: [BOOL] },
			NaN: { kind: "func", params: [], returns: [FLOAT64] },
			Atan: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Atan2: { kind: "func", params: [FLOAT64, FLOAT64], returns: [FLOAT64] },
			Asin: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Acos: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Exp: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Exp2: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Trunc: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Hypot: { kind: "func", params: [FLOAT64, FLOAT64], returns: [FLOAT64] },
			Signbit: { kind: "func", params: [FLOAT64], returns: [BOOL] },
			Copysign: {
				kind: "func",
				params: [FLOAT64, FLOAT64],
				returns: [FLOAT64],
			},
			Dim: { kind: "func", params: [FLOAT64, FLOAT64], returns: [FLOAT64] },
			Remainder: {
				kind: "func",
				params: [FLOAT64, FLOAT64],
				returns: [FLOAT64],
			},
			Float64bits: { kind: "func", params: [FLOAT64], returns: [UINT64] },
			Float64frombits: { kind: "func", params: [UINT64], returns: [FLOAT64] },
			Float32bits: { kind: "func", params: [FLOAT32], returns: [UINT32] },
			Float32frombits: { kind: "func", params: [UINT32], returns: [FLOAT32] },
			Sinh: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Cosh: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Tanh: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Pi: FLOAT64,
			E: FLOAT64,
			Phi: FLOAT64,
			Sqrt2: FLOAT64,
			SqrtE: FLOAT64,
			SqrtPi: FLOAT64,
			SqrtPhi: FLOAT64,
			Ln2: FLOAT64,
			Log2E: FLOAT64,
			Ln10: FLOAT64,
			Log10E: FLOAT64,
			MaxFloat32: FLOAT32,
			SmallestNonzeroFloat32: FLOAT32,
			MaxFloat64: FLOAT64,
			SmallestNonzeroFloat64: FLOAT64,
			MaxInt: INT,
			MinInt: INT,
			// Untyped integer constants, as in Go (`var x int64 = math.MaxUint64 >> 1`).
			MaxInt8: UNTYPED_INT,
			MinInt8: UNTYPED_INT,
			MaxInt16: UNTYPED_INT,
			MinInt16: UNTYPED_INT,
			MaxInt32: UNTYPED_INT,
			MinInt32: UNTYPED_INT,
			MaxInt64: UNTYPED_INT,
			MinInt64: UNTYPED_INT,
			MaxUint8: UNTYPED_INT,
			MaxUint16: UNTYPED_INT,
			MaxUint32: UNTYPED_INT,
			MaxUint: UINT,
			MaxUint64: UNTYPED_INT,
		},
	});

	globals.define("bits", {
		kind: "namespace",
		name: "bits",
		members: {
			Add: { kind: "func", params: [UINT, UINT, UINT], returns: [UINT, UINT] },
			Add32: {
				kind: "func",
				params: [UINT32, UINT32, UINT32],
				returns: [UINT32, UINT32],
			},
			Add64: {
				kind: "func",
				params: [UINT64, UINT64, UINT64],
				returns: [UINT64, UINT64],
			},
			Sub: { kind: "func", params: [UINT, UINT, UINT], returns: [UINT, UINT] },
			Sub32: {
				kind: "func",
				params: [UINT32, UINT32, UINT32],
				returns: [UINT32, UINT32],
			},
			Sub64: {
				kind: "func",
				params: [UINT64, UINT64, UINT64],
				returns: [UINT64, UINT64],
			},
			Mul: { kind: "func", params: [UINT, UINT], returns: [UINT, UINT] },
			Mul32: {
				kind: "func",
				params: [UINT32, UINT32],
				returns: [UINT32, UINT32],
			},
			Mul64: {
				kind: "func",
				params: [UINT64, UINT64],
				returns: [UINT64, UINT64],
			},
			Div: { kind: "func", params: [UINT, UINT, UINT], returns: [UINT, UINT] },
			Div32: {
				kind: "func",
				params: [UINT32, UINT32, UINT32],
				returns: [UINT32, UINT32],
			},
			Div64: {
				kind: "func",
				params: [UINT64, UINT64, UINT64],
				returns: [UINT64, UINT64],
			},
			Rem: { kind: "func", params: [UINT, UINT, UINT], returns: [UINT] },
			Rem32: {
				kind: "func",
				params: [UINT32, UINT32, UINT32],
				returns: [UINT32],
			},
			Rem64: {
				kind: "func",
				params: [UINT64, UINT64, UINT64],
				returns: [UINT64],
			},
			LeadingZeros: { kind: "func", params: [UINT], returns: [INT] },
			LeadingZeros8: { kind: "func", params: [UINT8], returns: [INT] },
			LeadingZeros16: { kind: "func", params: [UINT16], returns: [INT] },
			LeadingZeros32: { kind: "func", params: [UINT32], returns: [INT] },
			LeadingZeros64: { kind: "func", params: [UINT64], returns: [INT] },
			TrailingZeros: { kind: "func", params: [UINT], returns: [INT] },
			TrailingZeros8: { kind: "func", params: [UINT8], returns: [INT] },
			TrailingZeros16: { kind: "func", params: [UINT16], returns: [INT] },
			TrailingZeros32: { kind: "func", params: [UINT32], returns: [INT] },
			TrailingZeros64: { kind: "func", params: [UINT64], returns: [INT] },
			OnesCount: { kind: "func", params: [UINT], returns: [INT] },
			OnesCount8: { kind: "func", params: [UINT8], returns: [INT] },
			OnesCount16: { kind: "func", params: [UINT16], returns: [INT] },
			OnesCount32: { kind: "func", params: [UINT32], returns: [INT] },
			OnesCount64: { kind: "func", params: [UINT64], returns: [INT] },
			RotateLeft: { kind: "func", params: [UINT, INT], returns: [UINT] },
			RotateLeft8: { kind: "func", params: [UINT8, INT], returns: [UINT8] },
			RotateLeft16: { kind: "func", params: [UINT16, INT], returns: [UINT16] },
			RotateLeft32: { kind: "func", params: [UINT32, INT], returns: [UINT32] },
			RotateLeft64: { kind: "func", params: [UINT64, INT], returns: [UINT64] },
			Reverse: { kind: "func", params: [UINT], returns: [UINT] },
			Reverse8: { kind: "func", params: [UINT8], returns: [UINT8] },
			Reverse16: { kind: "func", params: [UINT16], returns: [UINT16] },
			Reverse32: { kind: "func", params: [UINT32], returns: [UINT32] },
			Reverse64: { kind: "func", params: [UINT64], returns: [UINT64] },
			ReverseBytes: { kind: "func", params: [UINT], returns: [UINT] },
			ReverseBytes16: { kind: "func", params: [UINT16], returns: [UINT16] },
			ReverseBytes32: { kind: "func", params: [UINT32], returns: [UINT32] },
			ReverseBytes64: { kind: "func", params: [UINT64], returns: [UINT64] },
			Len: { kind: "func", params: [UINT], returns: [INT] },
			Len8: { kind: "func", params: [UINT8], returns: [INT] },
			Len16: { kind: "func", params: [UINT16], returns: [INT] },
			Len32: { kind: "func", params: [UINT32], returns: [INT] },
			Len64: { kind: "func", params: [UINT64], returns: [INT] },
			UintSize: UNTYPED_INT,
		},
	});

	globals.define("errors", {
		kind: "namespace",
		name: "errors",
		members: {
			New: { kind: "func", params: [STRING], returns: [ERROR] },
			Is: { kind: "func", params: [ERROR, ERROR], returns: [BOOL] },
			Unwrap: { kind: "func", params: [ERROR], returns: [ERROR] },
			As: { kind: "func", params: [ERROR, ANY], returns: [BOOL] },
			Join: {
				kind: "func",
				params: [ERROR],
				returns: [ERROR],
				variadic: true,
			},
		},
	});

	globals.define("time", {
		kind: "namespace",
		name: "time",
		members: {
			Now: { kind: "func", params: [], returns: [TIME_T] },
			Since: { kind: "func", params: [TIME_T], returns: [DURATION_T] },
			Sleep: { kind: "func", params: [ANY], returns: [VOID], async: true },
			Parse: {
				kind: "func",
				params: [STRING, STRING],
				returns: [TIME_T, ERROR],
			},
			ParseDuration: {
				kind: "func",
				params: [STRING],
				returns: [DURATION_T, ERROR],
			},
			Unix: { kind: "func", params: [INT64, INT64], returns: [TIME_T] },
			UnixMicro: { kind: "func", params: [INT64], returns: [TIME_T] },
			UnixMilli: { kind: "func", params: [INT64], returns: [TIME_T] },
			Date: {
				kind: "func",
				params: [INT, ANY, INT, INT, INT, INT, INT, ANY],
				returns: [TIME_T],
			},
			FixedZone: {
				kind: "func",
				params: [STRING, INT],
				returns: [LOCATION_PTR_T],
			},
			AfterFunc: {
				kind: "func",
				params: [DURATION_T, { kind: "func", params: [], returns: [VOID] }],
				returns: [TIMER_PTR_T],
			},
			Duration: DURATION_T,
			Nanosecond: DURATION_T,
			Microsecond: DURATION_T,
			Millisecond: DURATION_T,
			Second: DURATION_T,
			Minute: DURATION_T,
			Hour: DURATION_T,
			Time: TIME_T,
			Month: MONTH_T,
			Weekday: WEEKDAY_T,
			Location: LOCATION_T,
			Timer: TIMER_T,
			RFC3339: STRING,
			RFC3339Nano: STRING,
			DateOnly: STRING,
			TimeOnly: STRING,
			DateTime: STRING,
			UTC: ANY,
			Local: ANY,
			January: MONTH_T,
			February: MONTH_T,
			March: MONTH_T,
			April: MONTH_T,
			May: MONTH_T,
			June: MONTH_T,
			July: MONTH_T,
			August: MONTH_T,
			September: MONTH_T,
			October: MONTH_T,
			November: MONTH_T,
			December: MONTH_T,
			Sunday: WEEKDAY_T,
			Monday: WEEKDAY_T,
			Tuesday: WEEKDAY_T,
			Wednesday: WEEKDAY_T,
			Thursday: WEEKDAY_T,
			Friday: WEEKDAY_T,
			Saturday: WEEKDAY_T,
		},
	});
	types.set("time.Duration", DURATION_T);
	types.set("time.Time", TIME_T);
	types.set("time.Month", MONTH_T);
	types.set("time.Weekday", WEEKDAY_T);
	types.set("time.Location", LOCATION_T);
	types.set("time.Timer", TIMER_T);

	const runeToStr = { kind: "func", params: [INT], returns: [BOOL] };
	const runeTrans = { kind: "func", params: [INT], returns: [INT] };
	globals.define("unicode", {
		kind: "namespace",
		name: "unicode",
		members: {
			IsLetter: runeToStr,
			IsDigit: runeToStr,
			IsSpace: runeToStr,
			IsUpper: runeToStr,
			IsLower: runeToStr,
			IsPunct: runeToStr,
			IsControl: runeToStr,
			IsPrint: runeToStr,
			IsGraphic: runeToStr,
			ToUpper: runeTrans,
			ToLower: runeTrans,
		},
	});

	const BYTE_SLICE_IO = { kind: "slice", elem: UINT8 };
	const OS_FILE = {
		kind: "named",
		name: "os.File",
		underlying: {
			kind: "struct",
			fields: new Map([["fd", INT]]),
			methods: new Map([
				[
					"Write",
					{
						kind: "func",
						params: [BYTE_SLICE_IO],
						returns: [INT, ERROR],
						_ptrRecv: true,
					},
				],
				[
					"WriteString",
					{
						kind: "func",
						params: [STRING],
						returns: [INT, ERROR],
						_ptrRecv: true,
					},
				],
				[
					"Read",
					{
						kind: "func",
						params: [BYTE_SLICE_IO],
						returns: [INT, ERROR],
						_ptrRecv: true,
					},
				],
				[
					"Close",
					{
						kind: "func",
						params: [],
						returns: [ERROR],
						_ptrRecv: true,
					},
				],
			]),
		},
	};
	const OS_FILE_PTR = { kind: "pointer", base: OS_FILE };
	types.set("os.File", OS_FILE);

	globals.define("os", {
		kind: "namespace",
		name: "os",
		members: {
			File: OS_FILE,
			Exit: { kind: "func", params: [INT], returns: [VOID] },
			Args: { kind: "slice", elem: STRING },
			Getenv: { kind: "func", params: [STRING], returns: [STRING] },
			Stdout: OS_FILE_PTR,
			Stderr: OS_FILE_PTR,
			Stdin: OS_FILE_PTR,
		},
	});

	// Slice helpers that return a slice of the same type as their first argument.
	const sameSlice = (params, extra = {}) => ({
		kind: "func",
		params,
		returns: [ANY],
		_derivedReturn: "arg0",
		...extra,
	});
	globals.define("slices", {
		kind: "namespace",
		name: "slices",
		members: {
			Contains: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			ContainsFunc: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			Index: { kind: "func", params: [ANY, ANY], returns: [INT] },
			IndexFunc: { kind: "func", params: [ANY, ANY], returns: [INT] },
			BinarySearch: { kind: "func", params: [ANY, ANY], returns: [INT, BOOL] },
			BinarySearchFunc: {
				kind: "func",
				params: [ANY, ANY, ANY],
				returns: [INT, BOOL],
			},
			Equal: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			Compare: { kind: "func", params: [ANY, ANY], returns: [INT] },
			Sort: { kind: "func", params: [ANY], returns: [VOID] },
			SortFunc: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			SortStableFunc: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			IsSorted: { kind: "func", params: [ANY], returns: [BOOL] },
			IsSortedFunc: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			Reverse: { kind: "func", params: [ANY], returns: [VOID] },
			Max: {
				kind: "func",
				params: [ANY],
				returns: [ANY],
				_derivedReturn: "elemOfArg0",
			},
			Min: {
				kind: "func",
				params: [ANY],
				returns: [ANY],
				_derivedReturn: "elemOfArg0",
			},
			MaxFunc: {
				kind: "func",
				params: [ANY, ANY],
				returns: [ANY],
				_derivedReturn: "elemOfArg0",
			},
			MinFunc: {
				kind: "func",
				params: [ANY, ANY],
				returns: [ANY],
				_derivedReturn: "elemOfArg0",
			},
			Clone: sameSlice([ANY]),
			Compact: sameSlice([ANY]),
			CompactFunc: sameSlice([ANY, ANY]),
			Concat: sameSlice([ANY], { variadic: true }),
			Delete: sameSlice([ANY, INT, INT]),
			DeleteFunc: sameSlice([ANY, ANY]),
			Insert: sameSlice([ANY, INT, ANY], { variadic: true }),
			Replace: sameSlice([ANY, INT, INT, ANY], { variadic: true }),
			Grow: sameSlice([ANY, INT]),
			Clip: sameSlice([ANY]),
		},
	});

	globals.define("html", {
		kind: "namespace",
		name: "html",
		members: {
			EscapeString: { kind: "func", params: [STRING], returns: [STRING] },
			UnescapeString: { kind: "func", params: [STRING], returns: [STRING] },
		},
	});

	const IO_WRITER = {
		kind: "interface",
		name: "io.Writer",
		methods: new Map([
			[
				"Write",
				{ kind: "func", params: [BYTE_SLICE_IO], returns: [INT, ERROR] },
			],
		]),
	};
	const IO_READER = {
		kind: "interface",
		name: "io.Reader",
		methods: new Map([
			[
				"Read",
				{ kind: "func", params: [BYTE_SLICE_IO], returns: [INT, ERROR] },
			],
		]),
	};
	const IO_CLOSER = {
		kind: "interface",
		name: "io.Closer",
		methods: new Map([
			["Close", { kind: "func", params: [], returns: [ERROR] }],
		]),
	};
	const IO_READWRITER = {
		kind: "interface",
		name: "io.ReadWriter",
		methods: new Map([
			[
				"Read",
				{ kind: "func", params: [BYTE_SLICE_IO], returns: [INT, ERROR] },
			],
			[
				"Write",
				{ kind: "func", params: [BYTE_SLICE_IO], returns: [INT, ERROR] },
			],
		]),
	};
	globals.define("io", {
		kind: "namespace",
		name: "io",
		members: {
			Writer: IO_WRITER,
			Reader: IO_READER,
			Closer: IO_CLOSER,
			ReadWriter: IO_READWRITER,
			EOF: ERROR,
			WriteString: {
				kind: "func",
				params: [IO_WRITER, STRING],
				returns: [INT, ERROR],
			},
			ReadAll: {
				kind: "func",
				params: [IO_READER],
				returns: [BYTE_SLICE_IO, ERROR],
			},
			LimitReader: {
				kind: "func",
				params: [IO_READER, INT64],
				returns: [IO_READER],
			},
			Copy: {
				kind: "func",
				params: [IO_WRITER, IO_READER],
				returns: [INT64, ERROR],
			},
			CopyN: {
				kind: "func",
				params: [IO_WRITER, IO_READER, INT64],
				returns: [INT64, ERROR],
			},
			Discard: IO_WRITER,
		},
	});
	types.set("fmt.Stringer", FMT_STRINGER);
	types.set("io.Writer", IO_WRITER);
	types.set("io.Reader", IO_READER);
	types.set("io.Closer", IO_CLOSER);
	types.set("io.ReadWriter", IO_READWRITER);
}
