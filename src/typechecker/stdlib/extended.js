// Extended standard library type definitions — gom, maps, regexp, rand, utf8,
// path, strings.Builder type, and built-in functions.

import {
	ANY,
	BOOL,
	ERROR,
	FLOAT32,
	FLOAT64,
	INT,
	INT32,
	INT64,
	STRING,
	UINT8,
	UINT32,
	UINT64,
	VOID,
} from "../types.js";

export function setupExtendedGlobals(globals, types) {
	const GOM_NODE_T = {
		kind: "interface",
		methods: new Map([
			["Mount", { kind: "func", params: [ANY], returns: [VOID] }],
		]),
	};
	const GOM_NODE_FUNC_T = {
		kind: "named",
		name: "gom.NodeFunc",
		underlying: { kind: "func", params: [ANY], returns: [VOID] },
	};
	const GOM_GROUP_T = {
		kind: "named",
		name: "gom.Group",
		underlying: { kind: "slice", elem: GOM_NODE_T },
	};
	const gomEl = {
		kind: "func",
		params: [GOM_NODE_T],
		returns: [GOM_NODE_T],
		variadic: true,
	};
	const gomAttr1 = { kind: "func", params: [STRING], returns: [GOM_NODE_T] };
	const gomBoolAttr = { kind: "func", params: [], returns: [GOM_NODE_T] };
	const gomMembers = {
		Node: GOM_NODE_T,
		NodeFunc: GOM_NODE_FUNC_T,
		Group: GOM_GROUP_T,
		El: {
			kind: "func",
			params: [STRING, GOM_NODE_T],
			returns: [GOM_NODE_T],
			variadic: true,
		},
		Text: { kind: "func", params: [STRING], returns: [GOM_NODE_T] },
		Attr: { kind: "func", params: [STRING, STRING], returns: [GOM_NODE_T] },
		DataAttr: { kind: "func", params: [STRING, STRING], returns: [GOM_NODE_T] },
		If: { kind: "func", params: [BOOL, GOM_NODE_T], returns: [GOM_NODE_T] },
		Map: { kind: "func", params: [ANY, ANY], returns: [GOM_NODE_T] },
		Mount: {
			kind: "func",
			params: [STRING, GOM_NODE_T, ANY],
			variadic: true,
			returns: [VOID],
		},
		MountTo: {
			kind: "func",
			params: [STRING, GOM_NODE_T, ANY],
			variadic: true,
			returns: [VOID],
		},
	};
	for (const name of [
		"Div",
		"Section",
		"Article",
		"Aside",
		"Header",
		"Footer",
		"Main",
		"Nav",
		"Figure",
		"H1",
		"H2",
		"H3",
		"H4",
		"H5",
		"H6",
		"Span",
		"A",
		"Strong",
		"Em",
		"Code",
		"Pre",
		"Small",
		"Mark",
		"P",
		"Br",
		"Hr",
		"Ul",
		"Ol",
		"Li",
		"Dl",
		"Dt",
		"Dd",
		"Form",
		"Input",
		"Button",
		"Textarea",
		"Select",
		"Option",
		"Label",
		"Fieldset",
		"Legend",
		"Img",
		"Video",
		"Audio",
		"Canvas",
		"Table",
		"Thead",
		"Tbody",
		"Tfoot",
		"Tr",
		"Th",
		"Td",
	])
		gomMembers[name] = gomEl;
	for (const name of [
		"Class",
		"Type",
		"Href",
		"Src",
		"Placeholder",
		"Style",
		"For",
		"Name",
		"Value",
		"Target",
		"Rel",
		"Alt",
		"Title",
		"Lang",
		"Action",
		"Method",
		"AutoComplete",
		"Draggable",
		"Role",
		"AriaLabel",
		"StyleAttr",
	])
		gomMembers[name] = gomAttr1;
	for (const name of ["Disabled", "Checked", "Selected", "Readonly"])
		gomMembers[name] = gomBoolAttr;
	globals.define("gom", {
		kind: "namespace",
		name: "gom",
		members: gomMembers,
	});
	types.set("gom.Node", GOM_NODE_T);
	types.set("gom.NodeFunc", GOM_NODE_FUNC_T);
	types.set("gom.Group", GOM_GROUP_T);

	const REGEXP_T = {
		kind: "named",
		name: "regexp.Regexp",
		underlying: { kind: "struct", fields: new Map(), methods: new Map() },
	};
	const REGEXP_PTR = { kind: "pointer", base: REGEXP_T };
	const STR_SLICE = { kind: "slice", elem: STRING };
	const INT_SLICE = { kind: "slice", elem: INT };
	REGEXP_T.underlying.methods = new Map([
		["MatchString", { kind: "func", params: [STRING], returns: [BOOL] }],
		["FindString", { kind: "func", params: [STRING], returns: [STRING] }],
		[
			"FindStringIndex",
			{ kind: "func", params: [STRING], returns: [INT_SLICE] },
		],
		[
			"FindAllString",
			{ kind: "func", params: [STRING, INT], returns: [STR_SLICE] },
		],
		[
			"FindStringSubmatch",
			{ kind: "func", params: [STRING], returns: [STR_SLICE] },
		],
		[
			"FindAllStringSubmatch",
			{
				kind: "func",
				params: [STRING, INT],
				returns: [{ kind: "slice", elem: STR_SLICE }],
			},
		],
		[
			"ReplaceAllString",
			{ kind: "func", params: [STRING, STRING], returns: [STRING] },
		],
		[
			"ReplaceAllLiteralString",
			{ kind: "func", params: [STRING, STRING], returns: [STRING] },
		],
		["Split", { kind: "func", params: [STRING, INT], returns: [STR_SLICE] }],
		["String", { kind: "func", params: [], returns: [STRING] }],
	]);
	types.set("regexp.Regexp", REGEXP_T);
	globals.define("regexp", {
		kind: "namespace",
		name: "regexp",
		members: {
			MustCompile: { kind: "func", params: [STRING], returns: [REGEXP_PTR] },
			Compile: { kind: "func", params: [STRING], returns: [REGEXP_PTR, ERROR] },
			MatchString: {
				kind: "func",
				params: [STRING, STRING],
				returns: [BOOL, ERROR],
			},
			QuoteMeta: { kind: "func", params: [STRING], returns: [STRING] },
		},
	});

	const BYTE_SLICE_T = { kind: "slice", elem: UINT8 };
	const _builderBase = [
		["WriteString", { kind: "func", params: [STRING], returns: [INT, ERROR] }],
		["WriteByte", { kind: "func", params: [INT], returns: [ERROR] }],
		["Write", { kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] }],
		["String", { kind: "func", params: [], returns: [STRING] }],
		["Len", { kind: "func", params: [], returns: [INT] }],
		["Cap", { kind: "func", params: [], returns: [INT] }],
		["Reset", { kind: "func", params: [], returns: [VOID] }],
		["Grow", { kind: "func", params: [INT], returns: [VOID] }],
	];
	const STR_SLICE_T = { kind: "slice", elem: STRING };
	const _makeBuilderType = (name, extra = []) => ({
		kind: "named",
		name,
		underlying: {
			kind: "struct",
			fields: new Map(
				name === "strings.Builder"
					? [
							["_buf", STR_SLICE_T],
							["_len", INT],
							["_self", ANY],
						]
					: [],
			),
			methods: new Map([..._builderBase, ...extra]),
		},
	});
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

	types.set(
		"strings.Builder",
		_makeBuilderType("strings.Builder", [
			["WriteRune", { kind: "func", params: [INT], returns: [INT, ERROR] }],
		]),
	);
	// crypto/rand; math/rand is Go source (stdlib/math/rand).
	globals.define("rand", {
		kind: "namespace",
		name: "rand",
		members: {
			Read: {
				kind: "func",
				params: [{ kind: "slice", elem: UINT8 }],
				returns: [INT, ERROR],
			},
			Reader: {
				kind: "interface",
				name: "io.Reader",
				methods: new Map([
					[
						"Read",
						{
							kind: "func",
							params: [{ kind: "slice", elem: UINT8 }],
							returns: [INT, ERROR],
						},
					],
				]),
			},
		},
	});

	const TIME_TIME = types.get("time.Time");
	const TIME_DURATION = types.get("time.Duration");

	const CONTEXT_T = {
		kind: "named",
		name: "context.Context",
		underlying: {
			kind: "interface",
			methods: new Map([
				["Deadline", { kind: "func", params: [], returns: [TIME_TIME, BOOL] }],
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
		["Deadline", { kind: "func", params: [], returns: [TIME_TIME, BOOL] }],
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
		["Elapsed", { kind: "func", params: [], returns: [TIME_DURATION] }],
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
			fields: new Map([
				["N", INT],
				["T", TIME_DURATION],
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

	// ── encoding/binary ───────────────────────────────────────────
	// Read, Write and Size walk the fields of an `any`; byte orders and
	// varints are Go source (stdlib/encoding/binary).
	globals.define("binary", {
		kind: "namespace",
		name: "binary",
		members: {
			Read: {
				kind: "func",
				params: [ANY, ANY, ANY],
				returns: [ERROR],
			},
			Write: {
				kind: "func",
				params: [ANY, ANY, ANY],
				returns: [ERROR],
			},
			Size: { kind: "func", params: [ANY], returns: [INT] },
		},
	});

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
