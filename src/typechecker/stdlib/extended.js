// Extended standard library type definitions — gom, maps, regexp, rand, utf8,
// path, strings.Builder / bytes.Buffer types, and built-in functions.

import { ANY, BOOL, ERROR, FLOAT64, INT, STRING, VOID } from "../types.js";

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
		Mount: { kind: "func", params: [STRING, GOM_NODE_T], returns: [VOID] },
		MountTo: { kind: "func", params: [STRING, GOM_NODE_T], returns: [VOID] },
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

	const BYTE_SLICE_T = { kind: "slice", elem: INT };
	const _builderBase = [
		["WriteString", { kind: "func", params: [STRING], returns: [INT, ERROR] }],
		["WriteByte", { kind: "func", params: [INT], returns: [ERROR] }],
		["Write", { kind: "func", params: [BYTE_SLICE_T], returns: [INT, ERROR] }],
		["String", { kind: "func", params: [], returns: [STRING] }],
		["Len", { kind: "func", params: [], returns: [INT] }],
		["Reset", { kind: "func", params: [], returns: [VOID] }],
		["Grow", { kind: "func", params: [INT], returns: [VOID] }],
	];
	const _makeBuilderType = (name, extra = []) => ({
		kind: "named",
		name,
		underlying: {
			kind: "struct",
			fields: new Map(),
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
			["Bytes", { kind: "func", params: [], returns: [BYTE_SLICE_T] }],
		]),
	);

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
		},
	});

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
