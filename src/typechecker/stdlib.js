// stdlib.js — built-in namespace and browser-global registration for the GoFront type
// checker. Called once from TypeChecker._setupGlobals() during construction.
//
// Exports a single function:
//   setupGlobals(globals, types)
//     globals — the root Scope instance (TypeChecker.globals)
//     types   — the named-type Map   (TypeChecker.types)

import { ANY, BOOL, ERROR, FLOAT64, INT, STRING, VOID } from "./types.js";

// time.Time named type — used by the time package
const TIME_T = { kind: "named", name: "time.Time", underlying: ANY };

export function setupGlobals(globals, types) {
	// Browser globals — typed as 'any' so any access/call is permitted
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

	// fmt package — string formatting (variadic: format string + any args)
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

	// strings package
	const strFn1 = (ret) => ({
		kind: "func",
		params: [STRING],
		returns: [ret],
	});
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
			TrimFunc: {
				kind: "func",
				params: [STRING, ANY],
				returns: [STRING],
			},
			TrimLeftFunc: {
				kind: "func",
				params: [STRING, ANY],
				returns: [STRING],
			},
			TrimRightFunc: {
				kind: "func",
				params: [STRING, ANY],
				returns: [STRING],
			},
			IndexFunc: {
				kind: "func",
				params: [STRING, ANY],
				returns: [INT],
			},
			LastIndexFunc: {
				kind: "func",
				params: [STRING, ANY],
				returns: [INT],
			},
			NewReplacer: {
				kind: "func",
				params: [STRING],
				returns: [ANY],
				variadic: true,
			},
			NewReader: { kind: "func", params: [STRING], returns: [ANY] },
		},
	});

	// bytes package — operates on []byte (JS arrays of numbers)
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
			Map: {
				kind: "func",
				params: [ANY, BYTE_SLICE],
				returns: [BYTE_SLICE],
			},
			SplitN: {
				kind: "func",
				params: [BYTE_SLICE, BYTE_SLICE, INT],
				returns: [{ kind: "slice", elem: BYTE_SLICE }],
			},
			NewReader: {
				kind: "func",
				params: [BYTE_SLICE],
				returns: [ANY],
			},
		},
	});

	// strconv package
	globals.define("strconv", {
		kind: "namespace",
		name: "strconv",
		members: {
			Itoa: { kind: "func", params: [INT], returns: [STRING] },
			Atoi: {
				kind: "func",
				params: [STRING],
				returns: [INT, ERROR],
			},
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
			ParseBool: {
				kind: "func",
				params: [STRING],
				returns: [BOOL, ERROR],
			},
			Quote: { kind: "func", params: [STRING], returns: [STRING] },
			Unquote: {
				kind: "func",
				params: [STRING],
				returns: [STRING, ERROR],
			},
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

	// sort package
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
			Slice: {
				kind: "func",
				params: [ANY, ANY],
				returns: [VOID],
			},
			SliceStable: {
				kind: "func",
				params: [ANY, ANY],
				returns: [VOID],
			},
			SliceIsSorted: {
				kind: "func",
				params: [ANY, ANY],
				returns: [BOOL],
			},
			Search: {
				kind: "func",
				params: [INT, ANY],
				returns: [INT],
			},
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

	// math package
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
			Pow: {
				kind: "func",
				params: [FLOAT64, FLOAT64],
				returns: [FLOAT64],
			},
			Log: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Log2: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Log10: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Sin: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Cos: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Tan: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
			Min: {
				kind: "func",
				params: [FLOAT64, FLOAT64],
				returns: [FLOAT64],
			},
			Max: {
				kind: "func",
				params: [FLOAT64, FLOAT64],
				returns: [FLOAT64],
			},
			Mod: {
				kind: "func",
				params: [FLOAT64, FLOAT64],
				returns: [FLOAT64],
			},
			Inf: { kind: "func", params: [INT], returns: [FLOAT64] },
			IsNaN: { kind: "func", params: [FLOAT64], returns: [BOOL] },
			IsInf: {
				kind: "func",
				params: [FLOAT64, INT],
				returns: [BOOL],
			},
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
			// Constants
			Pi: FLOAT64,
			E: FLOAT64,
			MaxFloat64: FLOAT64,
			SmallestNonzeroFloat64: FLOAT64,
			MaxInt: INT,
			MinInt: INT,
		},
	});

	// errors package
	globals.define("errors", {
		kind: "namespace",
		name: "errors",
		members: {
			New: { kind: "func", params: [STRING], returns: [ERROR] },
			Is: { kind: "func", params: [ERROR, ERROR], returns: [BOOL] },
			Unwrap: { kind: "func", params: [ERROR], returns: [ERROR] },
		},
	});

	// time package (partial — JS-friendly subset)
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
			// Layout constants
			RFC3339: STRING,
			RFC3339Nano: STRING,
			DateOnly: STRING,
			TimeOnly: STRING,
			DateTime: STRING,
			// Location constants
			UTC: ANY,
			Local: ANY,
			// Month constants
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
			// Weekday constants
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

	// unicode package
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

	// os package (JS-friendly subset)
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

	// slices package (Go 1.21)
	// Functions are generic — use ANY for slice params so any concrete slice type
	// is accepted without an assignability error (same pattern as sort.Slice).
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

	// html package
	globals.define("html", {
		kind: "namespace",
		name: "html",
		members: {
			EscapeString: { kind: "func", params: [STRING], returns: [STRING] },
			UnescapeString: { kind: "func", params: [STRING], returns: [STRING] },
		},
	});

	// io package — Writer interface + WriteString
	// io.Writer is typed as ANY so GoFront's built-in writer types (strings.Builder,
	// bytes.Buffer) are accepted without explicit interface-satisfaction registration.
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
			ReadAll: {
				kind: "func",
				params: [ANY],
				returns: [BYTE_SLICE_IO, ERROR],
			},
			Discard: ANY,
		},
	});
	// Register io.Writer as a type alias so it resolves in parameter/field annotations.
	types.set("io.Writer", ANY);
	types.set("io.Reader", ANY);

	// gom package — browser-native component built-in
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
		// Core types
		Node: GOM_NODE_T,
		NodeFunc: GOM_NODE_FUNC_T,
		Group: GOM_GROUP_T,
		// Core functions
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
		Mount: { kind: "func", params: [STRING, GOM_NODE_T], returns: [VOID] },
		MountTo: { kind: "func", params: [STRING, GOM_NODE_T], returns: [VOID] },
	};
	for (const name of [
		// Block elements
		"Div",
		"Section",
		"Article",
		"Aside",
		"Header",
		"Footer",
		"Main",
		"Nav",
		"Figure",
		// Headings
		"H1",
		"H2",
		"H3",
		"H4",
		"H5",
		"H6",
		// Inline elements
		"Span",
		"A",
		"Strong",
		"Em",
		"Code",
		"Pre",
		"Small",
		"Mark",
		// Text-level
		"P",
		"Br",
		"Hr",
		// Lists
		"Ul",
		"Ol",
		"Li",
		"Dl",
		"Dt",
		"Dd",
		// Forms
		"Form",
		"Input",
		"Button",
		"Textarea",
		"Select",
		"Option",
		"Label",
		"Fieldset",
		"Legend",
		// Media / table
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

	// maps package (Go 1.21)
	globals.define("maps", {
		kind: "namespace",
		name: "maps",
		members: {
			Keys: { kind: "func", params: [ANY], returns: [ANY] },
			Values: { kind: "func", params: [ANY], returns: [ANY] },
			Clone: { kind: "func", params: [ANY], returns: [ANY] },
			Copy: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			Equal: { kind: "func", params: [ANY, ANY], returns: [BOOL] },
			EqualFunc: { kind: "func", params: [ANY, ANY, ANY], returns: [BOOL] },
			Delete: { kind: "func", params: [ANY, ANY], returns: [VOID] },
			DeleteFunc: { kind: "func", params: [ANY, ANY], returns: [VOID] },
		},
	});

	// regexp package
	const REGEXP_T = {
		kind: "named",
		name: "regexp.Regexp",
		underlying: { kind: "struct", fields: new Map(), methods: new Map() },
	};
	const REGEXP_PTR = { kind: "pointer", base: REGEXP_T };
	const STR_SLICE = { kind: "slice", elem: STRING };
	const INT_SLICE = { kind: "slice", elem: INT };
	const regexpMethods = new Map([
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
	REGEXP_T.underlying.methods = regexpMethods;
	types.set("regexp.Regexp", REGEXP_T);
	globals.define("regexp", {
		kind: "namespace",
		name: "regexp",
		members: {
			MustCompile: { kind: "func", params: [STRING], returns: [REGEXP_PTR] },
			Compile: {
				kind: "func",
				params: [STRING],
				returns: [REGEXP_PTR, ERROR],
			},
			MatchString: {
				kind: "func",
				params: [STRING, STRING],
				returns: [BOOL, ERROR],
			},
			QuoteMeta: { kind: "func", params: [STRING], returns: [STRING] },
		},
	});

	// strings.Builder
	const BYTE_SLICE_T = { kind: "slice", elem: INT };
	const strBuilderMethods = new Map([
		["WriteString", { kind: "func", params: [STRING], returns: [INT, ERROR] }],
		["WriteByte", { kind: "func", params: [INT], returns: [ERROR] }],
		["WriteRune", { kind: "func", params: [INT], returns: [INT, ERROR] }],
		["Write", { kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] }],
		["String", { kind: "func", params: [], returns: [STRING] }],
		["Len", { kind: "func", params: [], returns: [INT] }],
		["Reset", { kind: "func", params: [], returns: [VOID] }],
		["Grow", { kind: "func", params: [INT], returns: [VOID] }],
	]);
	types.set("strings.Builder", {
		kind: "named",
		name: "strings.Builder",
		underlying: {
			kind: "struct",
			fields: new Map(),
			methods: strBuilderMethods,
		},
	});

	// bytes.Buffer
	const bytesBufferMethods = new Map([
		["WriteString", { kind: "func", params: [STRING], returns: [INT, ERROR] }],
		["WriteByte", { kind: "func", params: [INT], returns: [ERROR] }],
		["Write", { kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] }],
		["String", { kind: "func", params: [], returns: [STRING] }],
		["Bytes", { kind: "func", params: [], returns: [BYTE_SLICE_T] }],
		["Len", { kind: "func", params: [], returns: [INT] }],
		["Reset", { kind: "func", params: [], returns: [VOID] }],
		["Grow", { kind: "func", params: [INT], returns: [VOID] }],
	]);
	types.set("bytes.Buffer", {
		kind: "named",
		name: "bytes.Buffer",
		underlying: {
			kind: "struct",
			fields: new Map(),
			methods: bytesBufferMethods,
		},
	});

	// math/rand package — import "math/rand" → local name "rand"
	globals.define("rand", {
		kind: "namespace",
		name: "rand",
		members: {
			Intn: { kind: "func", params: [INT], returns: [INT] },
			Float64: { kind: "func", params: [], returns: [FLOAT64] },
			Float32: { kind: "func", params: [], returns: [FLOAT64] },
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
		},
	});

	// unicode/utf8 package — import "unicode/utf8" → local name "utf8"
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
			// Constants
			RuneError: INT,
			MaxRune: INT,
			UTFMax: INT,
		},
	});

	// path package — import "path" or "path/filepath" → local name "path"
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
		},
	});

	// Built-in functions
	globals.define("append", { kind: "builtin", name: "append" });
	globals.define("len", { kind: "builtin", name: "len" });
	globals.define("cap", { kind: "builtin", name: "cap" });
	globals.define("make", { kind: "builtin", name: "make" });
	globals.define("delete", { kind: "builtin", name: "delete" });
	globals.define("print", { kind: "builtin", name: "print" });
	globals.define("println", { kind: "builtin", name: "println" });
	globals.define("panic", { kind: "builtin", name: "panic" });
	globals.define("recover", { kind: "builtin", name: "recover" });
	globals.define("new", { kind: "builtin", name: "new" });
	globals.define("copy", { kind: "builtin", name: "copy" });
	globals.define("error", { kind: "builtin", name: "error" });
	globals.define("min", { kind: "builtin", name: "min" });
	globals.define("max", { kind: "builtin", name: "max" });
	globals.define("clear", { kind: "builtin", name: "clear" });
	globals.define("complex", { kind: "builtin", name: "complex" });
	globals.define("real", { kind: "builtin", name: "real" });
	globals.define("imag", { kind: "builtin", name: "imag" });
}
