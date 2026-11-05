// Core standard library type definitions — browser globals, fmt, strings, bytes,
// strconv, math, time, unicode, os, html, io.

import {
	ANY,
	BOOL,
	BROWSER_GLOBALS,
	ERROR,
	INT,
	INT64,
	STRING,
	UINT8,
	VOID,
} from "../types.js";

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
		},
	});

	// The type declared by Go source loaded after these definitions: looked
	// up when first used, `fallback` while the package is not imported.
	const late = (name, fallback) => types.get(name) ?? fallback;
	// time.Timer: the JavaScript-only part of the package.
	const TIMER_T = {
		kind: "named",
		name: "time.Timer",
		underlying: { kind: "struct", fields: new Map(), methods: new Map() },
	};
	const TIMER_PTR_T = { kind: "pointer", base: TIMER_T };
	TIMER_T.underlying.methods = new Map([
		["Stop", { kind: "func", params: [], returns: [BOOL], _ptrRecv: true }],
		[
			"Reset",
			{
				kind: "func",
				get params() {
					return [late("time.Duration", INT64)];
				},
				returns: [BOOL],
				_ptrRecv: true,
			},
		],
	]);
	TIMER_T.methods = TIMER_T.underlying.methods;

	// The Go source of the time package declares everything but these.
	globals.define("time", {
		kind: "namespace",
		name: "time",
		members: {
			Sleep: {
				kind: "func",
				get params() {
					return [late("time.Duration", INT64)];
				},
				returns: [VOID],
				async: true,
			},
			AfterFunc: {
				kind: "func",
				get params() {
					return [
						late("time.Duration", INT64),
						{ kind: "func", params: [], returns: [VOID] },
					];
				},
				returns: [TIMER_PTR_T],
			},
			Timer: TIMER_T,
		},
	});
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
