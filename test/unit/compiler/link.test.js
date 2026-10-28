// GoFront test suite — src/link/ (source-map merging, wasm unit linking,
// Go-source stdlib name mangling)

import { mergeCompilationChunks } from "../../../src/link/sourcemap.js";
import { assert, assertEqual, section, test } from "../helpers.js";

// ── Source-map merging ───────────────────────────────────────

section("Link — mergeCompilationChunks");

test("two chunks get offset mappings and a shared source table", () => {
	const merged = mergeCompilationChunks([
		{
			js: "a\nb",
			sourceFiles: ["/p/a.go"],
			sourcesContent: ["A"],
			mappings: [{ genLine: 1, srcLine: 1, srcFileIdx: 0 }],
		},
		{
			js: "c\nd",
			sourceFiles: ["/p/b.go", "/p/a.go"],
			sourcesContent: ["B", "A"],
			mappings: [
				{ genLine: 1, srcLine: 3, srcFileIdx: 0 },
				{ genLine: 2, srcLine: 7, srcFileIdx: 1 },
			],
		},
	]);
	assertEqual(merged.js, "a\nb\nc\nd");
	assertEqual(merged.sourceFiles.join(","), "/p/a.go,/p/b.go");
	assertEqual(merged.sourcesContent.join(","), "A,B");
	assertEqual(
		JSON.stringify(merged.mappings),
		JSON.stringify([
			{ genLine: 1, srcLine: 1, srcFileIdx: 0 },
			{ genLine: 3, srcLine: 3, srcFileIdx: 1 },
			{ genLine: 4, srcLine: 7, srcFileIdx: 0 },
		]),
	);
});

test("string and empty chunks are normalised or dropped", () => {
	const merged = mergeCompilationChunks([
		"x",
		null,
		{ js: "", sourceFiles: [], sourcesContent: [], mappings: [] },
		{
			js: "y",
			sourceFiles: ["/p/a.go"],
			sourcesContent: ["A"],
			mappings: [{ genLine: 1, srcLine: 2, srcFileIdx: 0 }],
		},
	]);
	assertEqual(merged.js, "x\ny");
	assertEqual(merged.mappings[0].genLine, 2);
	assert(
		mergeCompilationChunks([]).js === "",
		"no chunks gives an empty bundle",
	);
});
