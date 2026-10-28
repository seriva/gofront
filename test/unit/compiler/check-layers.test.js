// GoFront test suite — architecture layer guard (scripts/check-layers.js)

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	ALLOW,
	ALLOW_CROSS,
	findCrossBackendImports,
	findLayerGaps,
	PERMANENT_CROSS,
} from "../../../scripts/check-layers.js";
import { assert, assertEqual, ROOT, section, test } from "../helpers.js";

const TOML = `
[[layers]]
name  = "top"
paths = ["src/a.js", "src/pkg/*"]
order = 1

[[layers]]
name  = "deep"
paths = ["stdlib/enc/**", "stdlib/flat/*"]
order = 2
`;

// ── findLayerGaps ────────────────────────────────────────────

section("Layer guard — findLayerGaps");

test("a fully layered file list has no gaps", () => {
	const gaps = findLayerGaps(TOML, [
		"src/a.js",
		"src/pkg/b.js",
		"stdlib/enc/x/y.go",
		"stdlib/flat/z.go",
	]);
	assertEqual(gaps.unlayered.length, 0);
	assertEqual(gaps.dead.length, 0);
});

test("flags an unlayered file", () => {
	const gaps = findLayerGaps(TOML, ["src/a.js", "src/orphan.js"]);
	assertEqual(gaps.unlayered.join(","), "src/orphan.js");
});

test("flags a dead glob", () => {
	const gaps = findLayerGaps(TOML, ["src/a.js", "src/pkg/b.js"]);
	assert(gaps.dead.includes("stdlib/enc/**"), "stdlib/enc/** is dead");
	assert(gaps.dead.includes("stdlib/flat/*"), "stdlib/flat/* is dead");
	assert(!gaps.dead.includes("src/a.js"), "src/a.js matches a file");
});

test("a single * matches one directory level only", () => {
	const files = ["src/a.js", "src/pkg/b.js", "src/pkg/sub/c.js"];
	const gaps = findLayerGaps(TOML, files);
	assertEqual(gaps.unlayered.join(","), "src/pkg/sub/c.js");
});

test("** matches nested directories", () => {
	const gaps = findLayerGaps(TOML, [
		"stdlib/enc/a.go",
		"stdlib/enc/b/c.go",
		"stdlib/enc/b/d/e.go",
		"stdlib/flat/f.go",
		"src/a.js",
		"src/pkg/b.js",
	]);
	assertEqual(gaps.unlayered.length, 0);
});

test("ALLOW exempts an unlayered file", () => {
	const gaps = findLayerGaps(
		TOML,
		["src/a.js", "src/pkg/b.js", "stdlib/math/extra.go"],
		{ "stdlib/math/extra.go": "imports math/bits" },
	);
	assertEqual(gaps.unlayered.length, 0);
});

test("a glob only matches the exact path, not a substring", () => {
	const gaps = findLayerGaps(TOML, ["src/a.js", "src/a.jsx", "xsrc/a.js"]);
	assertEqual(gaps.unlayered.sort().join(","), "src/a.jsx,xsrc/a.js");
});

// ── findCrossBackendImports ──────────────────────────────────

section("Layer guard — findCrossBackendImports");

test("flags a js to wasm import", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/js/x.js": 'import { f } from "../wasm/y.js";\n',
		},
		[],
	);
	assertEqual(found.length, 1);
	assertEqual(found[0].from, "src/backend/js/x.js");
	assertEqual(found[0].to, "src/backend/wasm/y.js");
});

test("flags a wasm to js import that is not allowlisted", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/wasm/stdlib/q.js":
				'import { f } from "../../js/other.js";\n',
		},
		[],
	);
	assertEqual(found.length, 1);
	assertEqual(found[0].to, "src/backend/js/other.js");
});

test("passes the boundary.js to js/runtime.js edge", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/wasm/boundary.js": 'import { H } from "../js/runtime.js";\n',
		},
		ALLOW_CROSS,
	);
	assertEqual(found.length, 0);
});

test("only the exact allowlisted pair passes", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/wasm/boundary.js": 'import { H } from "../js/emit.js";\n',
		},
		ALLOW_CROSS,
	);
	assertEqual(found.length, 1);
});

test("shared and same-backend imports are fine", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/js/a.js":
				'import { x } from "./b.js";\nimport { y } from "../shared/z.js";\n',
			"src/backend/wasm/a.js":
				'export { q } from "./b.js";\nimport("../shared/z.js");\n',
			"src/lower/a.js": 'import { x } from "../backend/wasm/b.js";\n',
		},
		[],
	);
	assertEqual(found.length, 0);
});

test("detects re-exports and dynamic imports", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/js/a.js": 'export * from "../wasm/b.js";\n',
			"src/backend/wasm/a.js": 'const m = await import("../js/b.js");\n',
		},
		[],
	);
	assertEqual(found.length, 2);
});

test("bare package specifiers are ignored", () => {
	const found = findCrossBackendImports(
		{ "src/backend/js/a.js": 'import fs from "node:fs";\n' },
		[],
	);
	assertEqual(found.length, 0);
});

// ── Real repository ──────────────────────────────────────────

section("Layer guard — real repository");

function walk(dir, exts, out = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, exts, out);
		else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
	}
	return out;
}

const rel = (p) => relative(ROOT, p).split("\\").join("/");
const rules = readFileSync(join(ROOT, ".sentrux/rules.toml"), "utf8");
const repoFiles = [
	...walk(join(ROOT, "src"), [".js"]),
	...walk(join(ROOT, "stdlib"), [".go"]),
].map(rel);

test("every src and stdlib file is in a Sentrux layer", () => {
	const gaps = findLayerGaps(rules, repoFiles);
	assertEqual(gaps.unlayered.join("\n"), "");
});

test("no Sentrux layer glob is dead", () => {
	const gaps = findLayerGaps(rules, repoFiles);
	assertEqual(gaps.dead.join("\n"), "");
});

test("only documented files are exempt from layering", () => {
	assertEqual(
		Object.keys(ALLOW).sort().join(","),
		"stdlib/internal/jsonrt/dec.go,stdlib/internal/jsonrt/enc.go,stdlib/math/extra.go",
	);
});

// Task 5.1 moves fmt-types.js to src/backend/shared/. Until then the one
// known edge is the only cross-backend import beyond the allowlisted one.
test("cross-backend imports: only the known fmt-types edge remains", () => {
	const sources = Object.fromEntries(
		repoFiles
			.filter((f) => f.startsWith("src/backend/"))
			.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]),
	);
	const found = findCrossBackendImports(sources, PERMANENT_CROSS);
	assertEqual(
		found.map((x) => `${x.from} -> ${x.to}`).join("\n"),
		"src/backend/wasm/stdlib/core.js -> src/backend/js/fmt-types.js",
	);
});
