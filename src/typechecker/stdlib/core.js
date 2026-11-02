// Core standard library type definitions — browser globals, fmt, strings, bytes,
// strconv, math, errors, time, unicode, os, html, io.

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
	// The writer of Fprint*: any value with Write([]byte) (int, error), as io.Writer.
	const FMT_WRITER = {
		kind: "interface",
		name: "io.Writer",
		methods: new Map([
			[
				"Write",
				{
					kind: "func",
					params: [{ kind: "slice", elem: UINT8 }],
					returns: [INT, ERROR],
				},
			],
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
				params: [FMT_WRITER, STRING, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Fprintln: {
				kind: "func",
				params: [FMT_WRITER, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Fprint: {
				kind: "func",
				params: [FMT_WRITER, ANY],
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

	// The Go source of the strings package declares everything but Builder.
	globals.define("strings", {
		kind: "namespace",
		name: "strings",
		members: { Builder: ANY },
	});

	const BYTE_SLICE = { kind: "slice", elem: UINT8 };

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

	globals.define("errors", {
		kind: "namespace",
		name: "errors",
		members: {
			As: { kind: "func", params: [ERROR, ANY], returns: [BOOL] },
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

	types.set("fmt.Stringer", FMT_STRINGER);
}
