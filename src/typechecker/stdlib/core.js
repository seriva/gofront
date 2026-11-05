// Core standard library type definitions — browser globals and fmt.

import {
	ANY,
	BROWSER_GLOBALS,
	ERROR,
	INT,
	STRING,
	UINT8,
	VOID,
} from "../types.js";

export function setupCoreGlobals(globals, _types) {
	for (const g of BROWSER_GLOBALS) globals.define(g, ANY);

	const fmtVariadic = (ret) => ({
		kind: "func",
		params: [STRING, ANY],
		returns: [ret],
		variadic: true,
	});
	const FMT_BYTES = { kind: "slice", elem: UINT8 };
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
			Sprintf: fmtVariadic(STRING),
			Appendf: {
				kind: "func",
				params: [FMT_BYTES, STRING, ANY],
				returns: [FMT_BYTES],
				variadic: true,
			},
			Errorf: fmtVariadic(ERROR),
			Printf: fmtVariadic(VOID),
			Fprintf: {
				kind: "func",
				params: [FMT_WRITER, STRING, ANY],
				returns: [INT, ERROR],
				variadic: true,
			},
		},
	});
}
