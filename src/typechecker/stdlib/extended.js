// Extended standard library type definitions — context, testing and built-in
// functions.

import {
	ANY,
	BOOL,
	ERROR,
	FLOAT64,
	INT,
	INT64,
	STRING,
	UINT8,
	UINT64,
	VOID,
} from "../types.js";

export function setupExtendedGlobals(globals, types) {
	const BYTE_SLICE_T = { kind: "slice", elem: UINT8 };
	const IO_WRITER = {
		kind: "interface",
		name: "io.Writer",
		methods: new Map([
			[
				"Write",
				{ kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] },
			],
		]),
	};

	// Time and Duration are declared by the Go source of the time package,
	// loaded after these definitions: they are looked up when first used
	// (`any` and `int64` while the package is not part of the build).
	const lateTime = () => types.get("time.Time") ?? ANY;
	const lateDuration = () => types.get("time.Duration") ?? INT64;
	const deadlineFunc = () => ({
		kind: "func",
		params: [],
		get returns() {
			return [lateTime(), BOOL];
		},
	});

	const CONTEXT_T = {
		kind: "named",
		name: "context.Context",
		underlying: {
			kind: "interface",
			methods: new Map([
				["Deadline", deadlineFunc()],
				["Err", { kind: "func", params: [], returns: [ERROR] }],
				["Value", { kind: "func", params: [ANY], returns: [ANY] }],
			]),
		},
	};
	types.set("context.Context", CONTEXT_T);

	const TESTING_T = {
		kind: "named",
		name: "testing.T",
		underlying: { kind: "struct", fields: new Map(), methods: new Map() },
	};
	const TESTING_PTR = { kind: "pointer", base: TESTING_T };

	TESTING_T.underlying.methods = new Map([
		["Error", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Errorf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Fatal", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Fatalf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Fail", { kind: "func", params: [], returns: [VOID] }],
		["Failed", { kind: "func", params: [], returns: [BOOL] }],
		["FailNow", { kind: "func", params: [], returns: [VOID] }],
		["Log", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Logf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Skip", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Skipf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Skipped", { kind: "func", params: [], returns: [BOOL] }],
		["Helper", { kind: "func", params: [], returns: [VOID] }],
		[
			"Run",
			{
				kind: "func",
				params: [
					STRING,
					{ kind: "func", params: [TESTING_PTR], returns: [VOID] },
				],
				returns: [BOOL],
			},
		],
		["Name", { kind: "func", params: [], returns: [STRING] }],
		[
			"Cleanup",
			{
				kind: "func",
				params: [{ kind: "func", params: [], returns: [VOID] }],
				returns: [VOID],
			},
		],
		["Setenv", { kind: "func", params: [STRING, STRING], returns: [VOID] }],
		["Deadline", deadlineFunc()],
		["Context", { kind: "func", params: [], returns: [CONTEXT_T] }],
		["Parallel", { kind: "func", params: [], returns: [VOID] }],
		["SkipNow", { kind: "func", params: [], returns: [VOID] }],
		["Attr", { kind: "func", params: [STRING, STRING], returns: [VOID] }],
		["Output", { kind: "func", params: [], returns: [IO_WRITER] }],
	]);

	const TESTING_B = {
		kind: "named",
		name: "testing.B",
		underlying: {
			kind: "struct",
			fields: new Map([["N", INT]]),
			methods: new Map(),
		},
	};
	const TESTING_B_PTR = { kind: "pointer", base: TESTING_B };

	TESTING_B.underlying.methods = new Map([
		[
			"Cleanup",
			{
				kind: "func",
				params: [{ kind: "func", params: [], returns: [VOID] }],
				returns: [VOID],
			},
		],
		["Error", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Errorf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Fatal", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Fatalf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Fail", { kind: "func", params: [], returns: [VOID] }],
		["Failed", { kind: "func", params: [], returns: [BOOL] }],
		["FailNow", { kind: "func", params: [], returns: [VOID] }],
		["Log", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Logf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Skip", { kind: "func", params: [ANY], returns: [VOID], variadic: true }],
		[
			"Skipf",
			{ kind: "func", params: [STRING, ANY], returns: [VOID], variadic: true },
		],
		["Skipped", { kind: "func", params: [], returns: [BOOL] }],
		["SkipNow", { kind: "func", params: [], returns: [VOID] }],
		["Helper", { kind: "func", params: [], returns: [VOID] }],
		["Name", { kind: "func", params: [], returns: [STRING] }],
		["Attr", { kind: "func", params: [STRING, STRING], returns: [VOID] }],
		["Context", { kind: "func", params: [], returns: [CONTEXT_T] }],
		[
			"Elapsed",
			{
				kind: "func",
				params: [],
				get returns() {
					return [lateDuration()];
				},
			},
		],
		["Loop", { kind: "func", params: [], returns: [BOOL] }],
		["Output", { kind: "func", params: [], returns: [IO_WRITER] }],
		["ReportAllocs", { kind: "func", params: [], returns: [VOID] }],
		[
			"ReportMetric",
			{ kind: "func", params: [FLOAT64, STRING], returns: [VOID] },
		],
		["ResetTimer", { kind: "func", params: [], returns: [VOID] }],
		[
			"Run",
			{
				kind: "func",
				params: [
					STRING,
					{ kind: "func", params: [TESTING_B_PTR], returns: [VOID] },
				],
				returns: [BOOL],
			},
		],
		["SetBytes", { kind: "func", params: [INT64], returns: [VOID] }],
		["Setenv", { kind: "func", params: [STRING, STRING], returns: [VOID] }],
		["StartTimer", { kind: "func", params: [], returns: [VOID] }],
		["StopTimer", { kind: "func", params: [], returns: [VOID] }],
	]);

	const TESTING_M = {
		kind: "named",
		name: "testing.M",
		underlying: {
			kind: "struct",
			fields: new Map(),
			methods: new Map([["Run", { kind: "func", params: [], returns: [INT] }]]),
		},
	};

	const TESTING_TB = {
		kind: "named",
		name: "testing.TB",
		underlying: {
			kind: "interface",
			methods: new Map([
				["Attr", { kind: "func", params: [STRING, STRING], returns: [VOID] }],
				[
					"Cleanup",
					{
						kind: "func",
						params: [{ kind: "func", params: [], returns: [VOID] }],
						returns: [VOID],
					},
				],
				["Context", { kind: "func", params: [], returns: [CONTEXT_T] }],
				[
					"Error",
					{ kind: "func", params: [ANY], returns: [VOID], variadic: true },
				],
				[
					"Errorf",
					{
						kind: "func",
						params: [STRING, ANY],
						returns: [VOID],
						variadic: true,
					},
				],
				["Fail", { kind: "func", params: [], returns: [VOID] }],
				["Failed", { kind: "func", params: [], returns: [BOOL] }],
				["FailNow", { kind: "func", params: [], returns: [VOID] }],
				[
					"Fatal",
					{ kind: "func", params: [ANY], returns: [VOID], variadic: true },
				],
				[
					"Fatalf",
					{
						kind: "func",
						params: [STRING, ANY],
						returns: [VOID],
						variadic: true,
					},
				],
				["Helper", { kind: "func", params: [], returns: [VOID] }],
				[
					"Log",
					{ kind: "func", params: [ANY], returns: [VOID], variadic: true },
				],
				[
					"Logf",
					{
						kind: "func",
						params: [STRING, ANY],
						returns: [VOID],
						variadic: true,
					},
				],
				["Name", { kind: "func", params: [], returns: [STRING] }],
				["Output", { kind: "func", params: [], returns: [IO_WRITER] }],
				["Setenv", { kind: "func", params: [STRING, STRING], returns: [VOID] }],
				[
					"Skip",
					{ kind: "func", params: [ANY], returns: [VOID], variadic: true },
				],
				[
					"Skipf",
					{
						kind: "func",
						params: [STRING, ANY],
						returns: [VOID],
						variadic: true,
					},
				],
				["SkipNow", { kind: "func", params: [], returns: [VOID] }],
				["Skipped", { kind: "func", params: [], returns: [BOOL] }],
			]),
		},
	};

	const BENCHMARK_RESULT_T = {
		kind: "named",
		name: "testing.BenchmarkResult",
		underlying: {
			kind: "struct",
			fields: new (class extends Map {
				get(key) {
					return key === "T" ? lateDuration() : super.get(key);
				}
			})([
				["N", INT],
				["T", INT64],
				["Bytes", INT64],
				["MemAllocs", UINT64],
				["MemBytes", UINT64],
				["Extra", { kind: "map", key: STRING, value: FLOAT64 }],
			]),
			methods: new Map([
				["AllocedBytesPerOp", { kind: "func", params: [], returns: [INT64] }],
				["AllocsPerOp", { kind: "func", params: [], returns: [INT64] }],
				["MemString", { kind: "func", params: [], returns: [STRING] }],
				["NsPerOp", { kind: "func", params: [], returns: [INT64] }],
				["String", { kind: "func", params: [], returns: [STRING] }],
			]),
		},
	};

	globals.define("testing", {
		kind: "namespace",
		name: "testing",
		members: {
			T: TESTING_T,
			B: TESTING_B,
			M: TESTING_M,
			TB: TESTING_TB,
			BenchmarkResult: BENCHMARK_RESULT_T,
			Benchmark: {
				kind: "func",
				params: [{ kind: "func", params: [TESTING_B_PTR], returns: [VOID] }],
				returns: [BENCHMARK_RESULT_T],
			},
			Init: { kind: "func", params: [], returns: [VOID] },
			Short: { kind: "func", params: [], returns: [BOOL] },
			Testing: { kind: "func", params: [], returns: [BOOL] },
			Verbose: { kind: "func", params: [], returns: [BOOL] },
		},
	});
	types.set("testing.T", TESTING_T);
	types.set("testing.B", TESTING_B);
	types.set("testing.M", TESTING_M);
	types.set("testing.TB", TESTING_TB);
	types.set("testing.BenchmarkResult", BENCHMARK_RESULT_T);

	const BYTE_SLICE = { kind: "slice", elem: UINT8 };

	// ── encoding/json ─────────────────────────────────────────────
	const RAW_MESSAGE_T = {
		kind: "named",
		name: "json.RawMessage",
		underlying: BYTE_SLICE,
		methods: new Map(),
	};
	globals.define("json", {
		kind: "namespace",
		name: "json",
		members: {
			Marshal: {
				kind: "func",
				params: [ANY],
				returns: [BYTE_SLICE, ERROR],
			},
			MarshalIndent: {
				kind: "func",
				params: [ANY, STRING, STRING],
				returns: [BYTE_SLICE, ERROR],
			},
			Unmarshal: {
				kind: "func",
				params: [BYTE_SLICE, ANY],
				returns: [ERROR],
			},
			Valid: {
				kind: "func",
				params: [BYTE_SLICE],
				returns: [BOOL],
			},
			RawMessage: RAW_MESSAGE_T,
		},
	});
	types.set("encoding/json.RawMessage", RAW_MESSAGE_T);
	types.set("json.RawMessage", RAW_MESSAGE_T);

	for (const name of [
		"append",
		"len",
		"cap",
		"make",
		"delete",
		"print",
		"println",
		"panic",
		"recover",
		"new",
		"copy",
		"error",
		"min",
		"max",
		"clear",
		"complex",
		"real",
		"imag",
	])
		globals.define(name, { kind: "builtin", name });
}
