// Core standard library type definitions — browser globals, fmt, strings, bytes,
// strconv, sort, math, errors, time, unicode, os, slices, html, io.

import { ANY, BOOL, ERROR, FLOAT64, INT, STRING, VOID } from "../types.js";

const TIME_T = { kind: "named", name: "time.Time", underlying: ANY };

export function setupCoreGlobals(globals, types) {
	const browserGlobals = [
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
		"ArrayBuffer",
		"Uint8Array",
		"TextEncoder",
		"TextDecoder",
		"WebGLRenderingContext",
		"WebGL2RenderingContext",
		"GPUDevice",
		"GPUAdapter",
	];
	for (const g of browserGlobals) globals.define(g, ANY);

	const fmtVariadic = (ret) => ({
		kind: "func",
		params: [STRING, ANY],
		returns: [ret],
		variadic: true,
	});
	globals.define("fmt", {
		kind: "namespace",
		name: "fmt",
		members: {
			Sprintf: fmtVariadic(STRING),
			Errorf: fmtVariadic(ERROR),
			Printf: fmtVariadic(VOID),
			Println: fmtVariadic(VOID),
			Print: fmtVariadic(VOID),
			Fprintf: {
				kind: "func",
				params: [ANY, STRING],
				returns: [INT, ERROR],
				variadic: true,
			},
			Fprintln: {
				kind: "func",
				params: [ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
			Fprint: {
				kind: "func",
				params: [ANY],
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
				returns: [ANY],
				variadic: true,
			},
			NewReader: { kind: "func", params: [STRING], returns: [ANY] },
		},
	});

	const BYTE_SLICE = { kind: "slice", elem: INT };
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
			FormatInt: { kind: "func", params: [INT, INT], returns: [STRING] },
			ParseFloat: {
				kind: "func",
				params: [STRING, INT],
				returns: [FLOAT64, ERROR],
			},
			ParseInt: {
				kind: "func",
				params: [STRING, INT, INT],
				returns: [INT, ERROR],
			},
			ParseBool: { kind: "func", params: [STRING], returns: [BOOL, ERROR] },
			Quote: { kind: "func", params: [STRING], returns: [STRING] },
			Unquote: { kind: "func", params: [STRING], returns: [STRING, ERROR] },
			AppendInt: {
				kind: "func",
				params: [{ kind: "slice", elem: INT }, INT, INT],
				returns: [{ kind: "slice", elem: INT }],
			},
			AppendFloat: {
				kind: "func",
				params: [{ kind: "slice", elem: INT }, FLOAT64, INT, INT, INT],
				returns: [{ kind: "slice", elem: INT }],
			},
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
			Log2: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Log10: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
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
			Pi: FLOAT64,
			E: FLOAT64,
			MaxFloat64: FLOAT64,
			SmallestNonzeroFloat64: FLOAT64,
			MaxInt: INT,
			MinInt: INT,
		},
	});

	globals.define("errors", {
		kind: "namespace",
		name: "errors",
		members: {
			New: { kind: "func", params: [STRING], returns: [ERROR] },
			Is: { kind: "func", params: [ERROR, ERROR], returns: [BOOL] },
			Unwrap: { kind: "func", params: [ERROR], returns: [ERROR] },
		},
	});

	globals.define("time", {
		kind: "namespace",
		name: "time",
		members: {
			Now: { kind: "func", params: [], returns: [TIME_T] },
			Since: { kind: "func", params: [TIME_T], returns: [INT] },
			Sleep: { kind: "func", params: [ANY], returns: [VOID], async: true },
			Parse: {
				kind: "func",
				params: [STRING, STRING],
				returns: [TIME_T, ERROR],
			},
			Unix: { kind: "func", params: [INT, INT], returns: [TIME_T] },
			Date: {
				kind: "func",
				params: [INT, INT, INT, INT, INT, INT, INT, ANY],
				returns: [TIME_T],
			},
			Millisecond: INT,
			Second: INT,
			Minute: INT,
			Hour: INT,
			RFC3339: STRING,
			RFC3339Nano: STRING,
			DateOnly: STRING,
			TimeOnly: STRING,
			DateTime: STRING,
			UTC: ANY,
			Local: ANY,
			January: INT,
			February: INT,
			March: INT,
			April: INT,
			May: INT,
			June: INT,
			July: INT,
			August: INT,
			September: INT,
			October: INT,
			November: INT,
			December: INT,
			Sunday: INT,
			Monday: INT,
			Tuesday: INT,
			Wednesday: INT,
			Thursday: INT,
			Friday: INT,
			Saturday: INT,
		},
	});
	types.set("time.Time", TIME_T);

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

	globals.define("os", {
		kind: "namespace",
		name: "os",
		members: {
			Exit: { kind: "func", params: [INT], returns: [VOID] },
			Args: { kind: "slice", elem: STRING },
			Getenv: { kind: "func", params: [STRING], returns: [STRING] },
			Stdout: ANY,
			Stderr: ANY,
			Stdin: ANY,
		},
	});

	globals.define("slices", {
		kind: "namespace",
		name: "slices",
		members: {
			Contains: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			Index: { kind: "func", params: [ANY, ANY], returns: [INT] },
			Equal: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			Compare: { kind: "func", params: [ANY, ANY], returns: [INT] },
			Sort: { kind: "func", params: [ANY], returns: [VOID] },
			SortFunc: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			SortStableFunc: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			IsSorted: { kind: "func", params: [ANY], returns: [BOOL] },
			IsSortedFunc: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			Reverse: { kind: "func", params: [ANY], returns: [VOID] },
			Max: { kind: "func", params: [ANY], returns: [ANY] },
			Min: { kind: "func", params: [ANY], returns: [ANY] },
			MaxFunc: { kind: "func", params: [ANY, ANY], returns: [ANY] },
			MinFunc: { kind: "func", params: [ANY, ANY], returns: [ANY] },
			Clone: { kind: "func", params: [ANY], returns: [ANY] },
			Compact: { kind: "func", params: [ANY], returns: [ANY] },
			CompactFunc: { kind: "func", params: [ANY, ANY], returns: [ANY] },
			Concat: { kind: "func", params: [ANY], returns: [ANY], variadic: true },
			Delete: { kind: "func", params: [ANY, INT, INT], returns: [ANY] },
			DeleteFunc: { kind: "func", params: [ANY, ANY], returns: [ANY] },
			Insert: {
				kind: "func",
				params: [ANY, INT, ANY],
				returns: [ANY],
				variadic: true,
			},
			Replace: {
				kind: "func",
				params: [ANY, INT, INT, ANY],
				returns: [ANY],
				variadic: true,
			},
			Grow: { kind: "func", params: [ANY, INT], returns: [ANY] },
			Clip: { kind: "func", params: [ANY], returns: [ANY] },
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

	const BYTE_SLICE_IO = { kind: "slice", elem: INT };
	globals.define("io", {
		kind: "namespace",
		name: "io",
		members: {
			Writer: ANY,
			Reader: ANY,
			EOF: ERROR,
			WriteString: {
				kind: "func",
				params: [ANY, STRING],
				returns: [INT, ERROR],
			},
			ReadAll: { kind: "func", params: [ANY], returns: [BYTE_SLICE_IO, ERROR] },
			Discard: ANY,
		},
	});
	types.set("io.Writer", ANY);
	types.set("io.Reader", ANY);
}
