// GoFront test suite — architecture layer guard (scripts/check-layers.js)

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	ALLOW,
	ALLOW_CROSS,
	findCrossBackendImports,
	findLayerGaps,
	findStaleExemptions,
	PENDING_CROSS,
} from "../../../scripts/check-layers.js";
import {
	assert,
	assertContains,
	assertEqual,
	ROOT,
	section,
	test,
	withTempDir,
} from "../helpers.js";

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

test("flags a dynamic import written as a template literal", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/js/a.js": "const m = await import(`../wasm/emit.js`);\n",
		},
		[],
	);
	assertEqual(found.length, 1);
	assertEqual(found[0].to, "src/backend/wasm/emit.js");
});

test("flags shared code that imports a backend", () => {
	const found = findCrossBackendImports(
		{
			"src/backend/shared/x.js": 'import { H } from "../js/runtime.js";\n',
			"src/backend/shared/y.js": 'export { E } from "../wasm/emit.js";\n',
		},
		[],
	);
	assertEqual(
		found.map((x) => `${x.from} -> ${x.to}`).join(","),
		"src/backend/shared/x.js -> src/backend/js/runtime.js,src/backend/shared/y.js -> src/backend/wasm/emit.js",
	);
});

test("shared code may import shared code", () => {
	const found = findCrossBackendImports(
		{ "src/backend/shared/x.js": 'import { y } from "./y.js";\n' },
		[],
	);
	assertEqual(found.length, 0);
});

// ── findStaleExemptions ──────────────────────────────────────

section("Layer guard — findStaleExemptions");

test("an ALLOW key for a missing file is stale", () => {
	const stale = findStaleExemptions({
		tomlText: TOML,
		files: ["src/a.js"],
		sources: {},
		allow: { "stdlib/gone.go": "reason" },
		allowCross: [],
	});
	assertEqual(
		stale.join("\n"),
		"ALLOW entry for a missing file: stdlib/gone.go",
	);
});

test("an ALLOW key for a file a layer now covers is stale", () => {
	const stale = findStaleExemptions({
		tomlText: TOML,
		files: ["src/a.js"],
		sources: {},
		allow: { "src/a.js": "reason" },
		allowCross: [],
	});
	assertEqual(
		stale.join("\n"),
		"ALLOW entry for a file a layer already covers: src/a.js",
	);
});

test("a PENDING_CROSS pair with no matching import is stale", () => {
	const stale = findStaleExemptions({
		tomlText: TOML,
		files: [],
		sources: { "src/backend/js/a.js": 'import { x } from "./b.js";\n' },
		allow: {},
		allowCross: [["src/backend/js/a.js", "src/backend/wasm/b.js"]],
	});
	assertEqual(
		stale.join("\n"),
		"cross-backend allowlist entry with no matching import: src/backend/js/a.js -> src/backend/wasm/b.js",
	);
});

test("used exemptions are not stale", () => {
	const stale = findStaleExemptions({
		tomlText: TOML,
		files: ["src/a.js", "stdlib/math/extra.go"],
		sources: {
			"src/backend/wasm/boundary.js": 'import { H } from "../js/runtime.js";\n',
		},
		allow: { "stdlib/math/extra.go": "reason" },
		allowCross: [["src/backend/wasm/boundary.js", "src/backend/js/runtime.js"]],
	});
	assertEqual(stale.length, 0);
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

// With fmt-types.js in src/backend/shared/, the only cross-backend import
// left in the repo is the allowlisted boundary.js -> js/runtime.js edge.
test("cross-backend imports: only the allowlisted boundary edge remains", () => {
	const sources = Object.fromEntries(
		repoFiles
			.filter((f) => f.startsWith("src/backend/"))
			.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]),
	);
	const found = findCrossBackendImports(sources, []);
	assertEqual(
		found.map((x) => `${x.from} -> ${x.to}`).join("\n"),
		"src/backend/wasm/boundary.js -> src/backend/js/runtime.js",
	);
	assertEqual(findCrossBackendImports(sources).length, 0);
	assertEqual(PENDING_CROSS.length, 0);
});

test("no exemption in the real repository is stale", () => {
	const sources = Object.fromEntries(
		repoFiles
			.filter((f) => f.startsWith("src/backend/"))
			.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]),
	);
	const stale = findStaleExemptions({
		tomlText: rules,
		files: repoFiles,
		sources,
	});
	assertEqual(stale.join("\n"), "");
});

test("the guard script fails on each fixture and passes on the real tree", () => {
	const run = (root) =>
		spawnSync(
			process.execPath,
			[join(ROOT, "scripts", "check-layers.js"), ...(root ? [root] : [])],
			{ encoding: "utf8" },
		);
	const real = run();
	assertEqual(real.status, 0);
	const base = {
		".sentrux/rules.toml":
			'[[layers]]\nname = "all"\npaths = ["src/**", "stdlib/**"]\norder = 1\n',
		"src/backend/js/ok.js": 'import { y } from "../shared/y.js";\n',
		"src/backend/shared/y.js": "export const y = 1;\n",
		"stdlib/a/a.go": "package a\n",
	};
	for (const [name, extra, needle] of [
		[
			"template-literal import",
			{ "src/backend/js/t.js": "await import(`../wasm/emit.js`);\n" },
			"cross-backend import: src/backend/js/t.js -> src/backend/wasm/emit.js",
		],
		[
			"shared importing a backend",
			{ "src/backend/shared/x.js": 'import { H } from "../js/runtime.js";\n' },
			"cross-backend import: src/backend/shared/x.js -> src/backend/js/runtime.js",
		],
	]) {
		withTempDir({ ...base, ...extra }, (dir) => {
			const r = run(dir);
			assertEqual(r.status, 1, name);
			assertContains(r.stderr, needle);
		});
	}
	withTempDir(base, (dir) => {
		const r = run(dir);
		assertEqual(r.status, 1, "stale fixture");
		assertContains(
			r.stderr,
			"ALLOW entry for a missing file: stdlib/math/extra.go",
		);
		assertContains(
			r.stderr,
			"cross-backend allowlist entry with no matching import: src/backend/wasm/boundary.js -> src/backend/js/runtime.js",
		);
	});
});
