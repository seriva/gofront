// GoFront test suite — test discovery in test/unit/discover.js

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	assertHeaviestPresent,
	discoverTestFiles,
	HEAVIEST_TEST_FILES,
	TEST_FILES,
} from "../discover.js";
import {
	assert,
	assertEqual,
	assertThrows,
	ROOT,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("Test runner — discovery");

test("TEST_FILES is every *.test.js under test/unit, sorted, without fixtures", () => {
	const found = execFileSync(
		"find",
		["test/unit", "-name", "*.test.js", "-not", "-path", "*/fixtures/*"],
		{ cwd: ROOT, encoding: "utf8" },
	)
		.split("\n")
		.filter(Boolean)
		.map((p) => `./${p.slice("test/unit/".length)}`)
		.sort();
	assertEqual(TEST_FILES.join("\n"), found.join("\n"));
});

test("discoverTestFiles walks nested directories and skips fixtures", () => {
	withTempDir((dir) => {
		for (const sub of ["b", "a/deep", "fixtures", "a/fixtures"]) {
			mkdirSync(join(dir, sub), { recursive: true });
		}
		for (const f of [
			"b/two.test.js",
			"a/deep/one.test.js",
			"a/zero.test.js",
			"a/helper.js",
			"fixtures/skipped.test.js",
			"a/fixtures/skipped.test.js",
		]) {
			writeFileSync(join(dir, f), "");
		}
		assertEqual(
			discoverTestFiles(dir).join(","),
			"./a/deep/one.test.js,./a/zero.test.js,./b/two.test.js",
		);
	});
});

test("discoverTestFiles sorts what the file system lists in any order", () => {
	withTempDir(
		{
			"a/one.test.js": "",
			"a/two.test.js": "",
			"b/three.test.js": "",
			"c.test.js": "",
		},
		(dir) => {
			const reversed = (p, o) =>
				readdirSync(p, o).sort((x, y) => (x.name < y.name ? 1 : -1));
			assertEqual(
				discoverTestFiles(dir, reversed).join(","),
				"./a/one.test.js,./a/two.test.js,./b/three.test.js,./c.test.js",
			);
		},
	);
});

section("Test runner — scheduling hint");

test("every HEAVIEST_TEST_FILES entry is a discovered test file", () => {
	for (const f of HEAVIEST_TEST_FILES) {
		assert(TEST_FILES.includes(f), `${f} is not in TEST_FILES`);
	}
});

test("a missing heaviest entry throws at startup", () => {
	assertThrows(
		() =>
			assertHeaviestPresent(["./a.test.js"], ["./a.test.js", "./gone.test.js"]),
		"HEAVIEST_TEST_FILES entry not found: ./gone.test.js",
	);
	assertHeaviestPresent(["./a.test.js"], ["./a.test.js"]);
});
