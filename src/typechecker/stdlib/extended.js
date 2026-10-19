// Extended standard library type definitions — gom, maps, regexp, rand, utf8,
// path, strings.Builder / bytes.Buffer types, and built-in functions.

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
	UINT16,
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

	globals.define("maps", {
		kind: "namespace",
		name: "maps",
		members: {
			Keys: {
				kind: "func",
				params: [ANY],
				returns: [ANY],
				_derivedReturn: "keysOfArg0",
			},
			Values: {
				kind: "func",
				params: [ANY],
				returns: [ANY],
				_derivedReturn: "valuesOfArg0",
			},
			Clone: {
				kind: "func",
				params: [ANY],
				returns: [ANY],
				_derivedReturn: "arg0",
			},
			Copy: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			Equal: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			EqualFunc: { kind: "func", params: [ANY, ANY, ANY], returns: [BOOL] },
			Delete: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			DeleteFunc: { kind: "func", params: [ANY, ANY], returns: [VOID] },
		},
	});

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
					: name === "bytes.Buffer"
						? [["_buf", BYTE_SLICE_T]]
						: [],
			),
			methods: new Map([..._builderBase, ...extra]),
		},
	});
	types.set(
		"strings.Builder",
		_makeBuilderType("strings.Builder", [
			["WriteRune", { kind: "func", params: [INT], returns: [INT, ERROR] }],
		]),
	);
	types.set(
		"bytes.Buffer",
		_makeBuilderType("bytes.Buffer", [
			["WriteRune", { kind: "func", params: [INT], returns: [INT, ERROR] }],
			["Bytes", { kind: "func", params: [], returns: [BYTE_SLICE_T] }],
			["Read", { kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] }],
		]),
	);
	types.set("strings.Replacer", {
		kind: "named",
		name: "strings.Replacer",
		underlying: {
			kind: "struct",
			fields: new Map([["_pairs", STR_SLICE_T]]),
			methods: new Map([
				["Replace", { kind: "func", params: [STRING], returns: [STRING] }],
			]),
		},
	});
	const _makeReaderType = (name, srcType, resetArgType = srcType) => ({
		kind: "named",
		name,
		underlying: {
			kind: "struct",
			fields: new Map([
				["_src", srcType],
				["_pos", INT],
			]),
			methods: new Map([
				[
					"Read",
					{ kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] },
				],
				["Len", { kind: "func", params: [], returns: [INT] }],
				["Reset", { kind: "func", params: [resetArgType], returns: [VOID] }],
			]),
		},
	});
	types.set(
		"strings.Reader",
		_makeReaderType("strings.Reader", BYTE_SLICE_T, STRING),
	);
	types.set("bytes.Reader", _makeReaderType("bytes.Reader", BYTE_SLICE_T));
	types.set("io.discard", {
		kind: "named",
		name: "io.discard",
		underlying: {
			kind: "struct",
			fields: new Map(),
			methods: new Map([
				[
					"Write",
					{ kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] },
				],
				[
					"WriteString",
					{ kind: "func", params: [STRING], returns: [INT, ERROR] },
				],
			]),
		},
	});
	const ioPkg = globals.lookup("io");
	const IO_READER = ioPkg?.members?.Reader ?? {
		kind: "interface",
		name: "io.Reader",
	};
	types.set("io.LimitedReader", {
		kind: "named",
		name: "io.LimitedReader",
		underlying: {
			kind: "struct",
			fields: new Map([
				["R", IO_READER],
				["N", INT64],
			]),
			methods: new Map([
				[
					"Read",
					{ kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] },
				],
			]),
		},
	});
	if (ioPkg?.members) {
		ioPkg.members.LimitedReader = types.get("io.LimitedReader");
	}
	const stringsPkg = globals.lookup("strings");
	if (stringsPkg?.members) {
		stringsPkg.members.NewReader = {
			kind: "func",
			params: [STRING],
			returns: [{ kind: "pointer", base: types.get("strings.Reader") }],
		};
		stringsPkg.members.Reader = types.get("strings.Reader");
	}
	const bytesPkg = globals.lookup("bytes");
	if (bytesPkg?.members) {
		bytesPkg.members.NewReader = {
			kind: "func",
			params: [BYTE_SLICE_T],
			returns: [{ kind: "pointer", base: types.get("bytes.Reader") }],
		};
		bytesPkg.members.Reader = types.get("bytes.Reader");
	}

	globals.define("rand", {
		kind: "namespace",
		name: "rand",
		members: {
			Intn: { kind: "func", params: [INT], returns: [INT] },
			Float64: { kind: "func", params: [], returns: [FLOAT64] },
			Float32: { kind: "func", params: [], returns: [FLOAT32] },
			Int: { kind: "func", params: [], returns: [INT] },
			Int63: { kind: "func", params: [], returns: [INT] },
			Int63n: { kind: "func", params: [INT], returns: [INT] },
			Int31: { kind: "func", params: [], returns: [INT] },
			Int31n: { kind: "func", params: [INT], returns: [INT] },
			Seed: { kind: "func", params: [INT], returns: [VOID] },
			Shuffle: { kind: "func", params: [INT, ANY], returns: [VOID] },
			Perm: {
				kind: "func",
				params: [INT],
				returns: [{ kind: "slice", elem: INT }],
			},
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

	globals.define("utf8", {
		kind: "namespace",
		name: "utf8",
		members: {
			RuneCountInString: { kind: "func", params: [STRING], returns: [INT] },
			RuneLen: { kind: "func", params: [INT], returns: [INT] },
			ValidString: { kind: "func", params: [STRING], returns: [BOOL] },
			ValidRune: { kind: "func", params: [INT], returns: [BOOL] },
			DecodeRuneInString: {
				kind: "func",
				params: [STRING],
				returns: [INT, INT],
			},
			DecodeLastRuneInString: {
				kind: "func",
				params: [STRING],
				returns: [INT, INT],
			},
			FullRuneInString: { kind: "func", params: [STRING], returns: [BOOL] },
			RuneError: INT,
			MaxRune: INT,
			UTFMax: INT,
		},
	});

	globals.define("path", {
		kind: "namespace",
		name: "path",
		members: {
			Base: { kind: "func", params: [STRING], returns: [STRING] },
			Dir: { kind: "func", params: [STRING], returns: [STRING] },
			Ext: { kind: "func", params: [STRING], returns: [STRING] },
			Join: {
				kind: "func",
				params: [STRING],
				returns: [STRING],
				variadic: true,
			},
			Clean: { kind: "func", params: [STRING], returns: [STRING] },
			IsAbs: { kind: "func", params: [STRING], returns: [BOOL] },
			Split: { kind: "func", params: [STRING], returns: [STRING, STRING] },
			Match: { kind: "func", params: [STRING, STRING], returns: [BOOL, ERROR] },
			ErrBadPattern: ERROR,
		},
	});

	globals.define("filepath", {
		kind: "namespace",
		name: "filepath",
		members: globals.lookup("path").members,
	});

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
	]);

	globals.define("testing", {
		kind: "namespace",
		name: "testing",
		members: {
			T: TESTING_T,
			Short: { kind: "func", params: [], returns: [BOOL] },
			Verbose: { kind: "func", params: [], returns: [BOOL] },
		},
	});
	types.set("testing.T", TESTING_T);

	// ── sync ──────────────────────────────────────────────────────
	const MUTEX_T = {
		kind: "named",
		name: "sync.Mutex",
		underlying: { kind: "struct", fields: new Map([["state", INT32]]) },
		methods: new Map([
			["Lock", { kind: "func", params: [], returns: [VOID] }],
			["Unlock", { kind: "func", params: [], returns: [VOID] }],
			["TryLock", { kind: "func", params: [], returns: [BOOL] }],
		]),
	};
	const RWMUTEX_T = {
		kind: "named",
		name: "sync.RWMutex",
		underlying: { kind: "struct", fields: new Map([["state", INT32]]) },
		methods: new Map([
			["Lock", { kind: "func", params: [], returns: [VOID] }],
			["Unlock", { kind: "func", params: [], returns: [VOID] }],
			["RLock", { kind: "func", params: [], returns: [VOID] }],
			["RUnlock", { kind: "func", params: [], returns: [VOID] }],
			["TryLock", { kind: "func", params: [], returns: [BOOL] }],
			["TryRLock", { kind: "func", params: [], returns: [BOOL] }],
		]),
	};
	const ONCE_T = {
		kind: "named",
		name: "sync.Once",
		underlying: { kind: "struct", fields: new Map([["done", UINT32]]) },
		methods: new Map([
			[
				"Do",
				{
					kind: "func",
					params: [{ kind: "func", params: [], returns: [VOID] }],
					returns: [VOID],
				},
			],
		]),
	};
	const WAITGROUP_T = {
		kind: "named",
		name: "sync.WaitGroup",
		underlying: { kind: "struct", fields: new Map([["counter", INT]]) },
		methods: new Map([
			["Add", { kind: "func", params: [INT], returns: [VOID] }],
			["Done", { kind: "func", params: [], returns: [VOID] }],
			["Wait", { kind: "func", params: [], returns: [VOID] }],
		]),
	};
	const LOCKER_T = {
		kind: "interface",
		name: "sync.Locker",
		methods: new Map([
			["Lock", { kind: "func", params: [], returns: [VOID] }],
			["Unlock", { kind: "func", params: [], returns: [VOID] }],
		]),
	};
	globals.define("sync", {
		kind: "namespace",
		name: "sync",
		members: {
			Mutex: MUTEX_T,
			RWMutex: RWMUTEX_T,
			Once: ONCE_T,
			WaitGroup: WAITGROUP_T,
			Locker: LOCKER_T,
		},
	});
	types.set("sync.Mutex", MUTEX_T);
	types.set("sync.RWMutex", RWMUTEX_T);
	types.set("sync.Once", ONCE_T);
	types.set("sync.WaitGroup", WAITGROUP_T);
	types.set("sync.Locker", LOCKER_T);

	// ── crypto/sha256 ─────────────────────────────────────────────
	const BYTE_SLICE = { kind: "slice", elem: UINT8 };
	const HASH_T = {
		kind: "interface",
		methods: new Map([
			["Write", { kind: "func", params: [BYTE_SLICE], returns: [INT, ERROR] }],
			["Sum", { kind: "func", params: [BYTE_SLICE], returns: [BYTE_SLICE] }],
			["Reset", { kind: "func", params: [], returns: [VOID] }],
			["Size", { kind: "func", params: [], returns: [INT] }],
			["BlockSize", { kind: "func", params: [], returns: [INT] }],
		]),
	};
	const SHA256_DIGEST_T = {
		kind: "named",
		name: "sha256.digest",
		underlying: { kind: "struct", fields: new Map([["buf", BYTE_SLICE]]) },
		methods: new Map([
			["Write", { kind: "func", params: [BYTE_SLICE], returns: [INT, ERROR] }],
			["Sum", { kind: "func", params: [BYTE_SLICE], returns: [BYTE_SLICE] }],
			["Reset", { kind: "func", params: [], returns: [VOID] }],
			["Size", { kind: "func", params: [], returns: [INT] }],
			["BlockSize", { kind: "func", params: [], returns: [INT] }],
		]),
	};
	globals.define("sha256", {
		kind: "namespace",
		name: "sha256",
		members: {
			Size: INT,
			BlockSize: INT,
			Sum256: {
				kind: "func",
				params: [BYTE_SLICE],
				returns: [{ kind: "array", size: 32, elem: UINT8 }],
			},
			New: { kind: "func", params: [], returns: [HASH_T] },
		},
	});
	types.set("hash.Hash", HASH_T);
	types.set("sha256.digest", SHA256_DIGEST_T);
	types.set("crypto/sha256.digest", SHA256_DIGEST_T);

	// ── encoding/binary ───────────────────────────────────────────
	const BYTE_ORDER_METHODS = [
		["Uint16", { kind: "func", params: [BYTE_SLICE], returns: [UINT16] }],
		["Uint32", { kind: "func", params: [BYTE_SLICE], returns: [UINT32] }],
		["Uint64", { kind: "func", params: [BYTE_SLICE], returns: [UINT64] }],
		[
			"PutUint16",
			{ kind: "func", params: [BYTE_SLICE, UINT16], returns: [VOID] },
		],
		[
			"PutUint32",
			{ kind: "func", params: [BYTE_SLICE, UINT32], returns: [VOID] },
		],
		[
			"PutUint64",
			{ kind: "func", params: [BYTE_SLICE, UINT64], returns: [VOID] },
		],
		["String", { kind: "func", params: [], returns: [STRING] }],
	];
	const BYTE_ORDER_T = {
		kind: "interface",
		methods: new Map(BYTE_ORDER_METHODS),
	};
	const LITTLE_ENDIAN_METHODS = new Map([
		...BYTE_ORDER_METHODS,
		[
			"AppendUint16",
			{ kind: "func", params: [BYTE_SLICE, UINT16], returns: [BYTE_SLICE] },
		],
		[
			"AppendUint32",
			{ kind: "func", params: [BYTE_SLICE, UINT32], returns: [BYTE_SLICE] },
		],
		[
			"AppendUint64",
			{ kind: "func", params: [BYTE_SLICE, UINT64], returns: [BYTE_SLICE] },
		],
	]);
	const LITTLE_ENDIAN_T = {
		kind: "named",
		name: "binary.LittleEndian",
		underlying: {
			kind: "struct",
			fields: new Map([["order", INT32]]),
			methods: LITTLE_ENDIAN_METHODS,
		},
		methods: LITTLE_ENDIAN_METHODS,
	};
	const BIG_ENDIAN_METHODS = new Map([
		...BYTE_ORDER_METHODS,
		[
			"AppendUint16",
			{ kind: "func", params: [BYTE_SLICE, UINT16], returns: [BYTE_SLICE] },
		],
		[
			"AppendUint32",
			{ kind: "func", params: [BYTE_SLICE, UINT32], returns: [BYTE_SLICE] },
		],
		[
			"AppendUint64",
			{ kind: "func", params: [BYTE_SLICE, UINT64], returns: [BYTE_SLICE] },
		],
	]);
	const BIG_ENDIAN_T = {
		kind: "named",
		name: "binary.BigEndian",
		underlying: {
			kind: "struct",
			fields: new Map([["order", INT32]]),
			methods: BIG_ENDIAN_METHODS,
		},
		methods: BIG_ENDIAN_METHODS,
	};
	globals.define("binary", {
		kind: "namespace",
		name: "binary",
		members: {
			ByteOrder: BYTE_ORDER_T,
			LittleEndian: LITTLE_ENDIAN_T,
			BigEndian: BIG_ENDIAN_T,
			Read: {
				kind: "func",
				params: [ANY, BYTE_ORDER_T, ANY],
				returns: [ERROR],
			},
			Write: {
				kind: "func",
				params: [ANY, BYTE_ORDER_T, ANY],
				returns: [ERROR],
			},
			Size: { kind: "func", params: [ANY], returns: [INT] },
			AppendUint16: {
				kind: "func",
				params: [BYTE_SLICE, UINT16],
				returns: [BYTE_SLICE],
			},
			AppendUint32: {
				kind: "func",
				params: [BYTE_SLICE, UINT32],
				returns: [BYTE_SLICE],
			},
			AppendUint64: {
				kind: "func",
				params: [BYTE_SLICE, UINT64],
				returns: [BYTE_SLICE],
			},
		},
	});
	types.set("encoding/binary.ByteOrder", BYTE_ORDER_T);
	types.set("binary.ByteOrder", BYTE_ORDER_T);
	types.set("encoding/binary.LittleEndian", LITTLE_ENDIAN_T);
	types.set("binary.LittleEndian", LITTLE_ENDIAN_T);
	types.set("encoding/binary.BigEndian", BIG_ENDIAN_T);
	types.set("binary.BigEndian", BIG_ENDIAN_T);

	// ── encoding/hex ──────────────────────────────────────────────
	globals.define("hex", {
		kind: "namespace",
		name: "hex",
		members: {
			EncodeToString: { kind: "func", params: [BYTE_SLICE], returns: [STRING] },
			DecodeString: {
				kind: "func",
				params: [STRING],
				returns: [BYTE_SLICE, ERROR],
			},
			Encode: {
				kind: "func",
				params: [BYTE_SLICE, BYTE_SLICE],
				returns: [INT],
			},
			Decode: {
				kind: "func",
				params: [BYTE_SLICE, BYTE_SLICE],
				returns: [INT, ERROR],
			},
			EncodedLen: { kind: "func", params: [INT], returns: [INT] },
			DecodedLen: { kind: "func", params: [INT], returns: [INT] },
			ErrLength: ERROR,
		},
	});

	// ── encoding/base64 ───────────────────────────────────────────
	const BASE64_ENCODING_METHODS = new Map([
		[
			"EncodeToString",
			{ kind: "func", params: [BYTE_SLICE], returns: [STRING] },
		],
		[
			"DecodeString",
			{ kind: "func", params: [STRING], returns: [BYTE_SLICE, ERROR] },
		],
		[
			"Encode",
			{ kind: "func", params: [BYTE_SLICE, BYTE_SLICE], returns: [VOID] },
		],
		[
			"Decode",
			{ kind: "func", params: [BYTE_SLICE, BYTE_SLICE], returns: [INT, ERROR] },
		],
		["EncodedLen", { kind: "func", params: [INT], returns: [INT] }],
		["DecodedLen", { kind: "func", params: [INT], returns: [INT] }],
		["WithPadding", { kind: "func", params: [INT], returns: [ANY] }],
	]);
	const BASE64_ENCODING_T = {
		kind: "named",
		name: "base64.Encoding",
		underlying: {
			kind: "struct",
			fields: new Map([["mode", INT32]]),
			methods: BASE64_ENCODING_METHODS,
		},
		methods: BASE64_ENCODING_METHODS,
	};
	globals.define("base64", {
		kind: "namespace",
		name: "base64",
		members: {
			Encoding: BASE64_ENCODING_T,
			StdEncoding: BASE64_ENCODING_T,
			URLEncoding: BASE64_ENCODING_T,
			RawStdEncoding: BASE64_ENCODING_T,
			RawURLEncoding: BASE64_ENCODING_T,
			NewEncoding: {
				kind: "func",
				params: [STRING],
				returns: [BASE64_ENCODING_T],
			},
			StdPadding: INT,
			NoPadding: INT,
		},
	});
	types.set("encoding/base64.Encoding", BASE64_ENCODING_T);
	types.set("base64.Encoding", BASE64_ENCODING_T);

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
