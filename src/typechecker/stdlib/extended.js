// Extended standard library type definitions — encoding/json and built-in
// functions.

import { ANY, BOOL, ERROR, STRING, UINT8 } from "../types.js";

export function setupExtendedGlobals(globals, types) {
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
