// GoFront test suite — test discovery in test/unit/discover.js and the
// runner's filtering, timeouts and reporting

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
	assertHeaviestPresent,
	discoverTestFiles,
	HEAVIEST_TEST_FILES,
	TEST_FILES,
} from "../discover.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertThrows,
	FIXTURES,
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

section("Test runner — filtering, timeouts and reporting");

const RUN_JS = fileURLToPath(new URL("../run.js", import.meta.url));
const HARNESS = join(FIXTURES, "harness");
const strip = stripVTControlCharacters;

// Runs `node <args>` with a clean TEST_* environment and a 30 s kill switch.
function node(args, env = {}) {
	const clean = { ...process.env };
	for (const k of Object.keys(clean)) {
		if (k.startsWith("TEST_")) delete clean[k];
	}
	const r = spawnSync(process.execPath, args, {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 30_000,
		env: { ...clean, ...env },
	});
	return {
		status: r.status,
		out: strip(r.stdout ?? ""),
		err: strip(r.stderr ?? ""),
	};
}

const count = (text, needle) => text.split(needle).length - 1;

test("a file argument runs only that file", () => {
	const r = node([RUN_JS, "fixtures/harness/pass.test.js"]);
	assertEqual(r.status, 0);
	assertContains(r.out, "alpha passes");
	assertContains(r.out, "2 tests: 2 passed");
	assert(!r.out.includes("gamma"), "fail.test.js must not run");
});

test("file arguments resolve from the cwd as well as test/unit", () => {
	const r = node([RUN_JS, "test/unit/fixtures/harness/pass.test.js"]);
	assertEqual(r.status, 0);
	assertContains(r.out, "2 tests: 2 passed");
});

test("an unknown file argument exits 2", () => {
	const r = node([RUN_JS, "fixtures/harness/nope.test.js"]);
	assertEqual(r.status, 2);
	assertContains(r.err, "test file not found: fixtures/harness/nope.test.js");
});

test("--grep and TEST_GREP run only matching tests and count the rest as skipped", () => {
	const file = "fixtures/harness/pass.test.js";
	for (const r of [
		node([RUN_JS, "--grep", "alpha", file]),
		node([RUN_JS, file], { TEST_GREP: "alpha" }),
	]) {
		assertEqual(r.status, 0);
		assertContains(r.out, "alpha passes");
		assert(!r.out.includes("beta passes"), "beta must be skipped");
		assertContains(r.out, "1 tests: 1 passed, 1 skipped");
	}
});

test("a filter that matches nothing exits 1", () => {
	const r = node([
		RUN_JS,
		"--grep",
		"zzz-no-such-test",
		"fixtures/harness/pass.test.js",
	]);
	assertEqual(r.status, 1);
	assertContains(r.err, "no tests matched zzz-no-such-test");
});

test("the failure summary names the file, in parallel and sequential mode", () => {
	for (const env of [{}, { TEST_PARALLEL: "0" }]) {
		const r = node([RUN_JS, "fixtures/harness/fail.test.js"], env);
		assertEqual(r.status, 1);
		assertContains(
			r.out,
			"  • fixtures/harness/fail.test.js › delta fails on purpose",
		);
	}
});

test("a hung async test fails after TEST_TIMEOUT_MS and the rest still report", () => {
	const r = node([RUN_JS, "fixtures/harness/hang-async.test.js"], {
		TEST_TIMEOUT_MS: "200",
	});
	assertEqual(r.status, 1);
	assertContains(r.out, "✓ still reports");
	assertContains(r.out, "timed out after 200ms");
	assertContains(r.out, "› async hangs");
});

test("a file stuck in a sync loop is reported as timed out after TEST_FILE_TIMEOUT_MS", () => {
	const r = node([RUN_JS, "fixtures/harness/hang-sync.test.js"], {
		TEST_FILE_TIMEOUT_MS: "1000",
		HARNESS_HANG: "1",
	});
	assertEqual(r.status, 1);
	assertContains(r.out, "  • fixtures/harness/hang-sync.test.js › timed out");
});

test("a failing file run directly exits 1 and prints the summary once", () => {
	for (const f of ["fail", "fail-footer", "fail-bare"]) {
		const r = node([join(HARNESS, `${f}.test.js`)]);
		assertEqual(r.status, 1);
		assertEqual(count(r.out, " tests: "), 1);
		assertContains(r.out, "Failed tests:");
	}
});

test("a passing file run directly exits 0", () => {
	const r = node([join(HARNESS, "pass.test.js")]);
	assertEqual(r.status, 0);
	assertEqual(count(r.out, " tests: "), 1);
});

test("run.js prints one summary in sequential mode", () => {
	const r = node([RUN_JS, "fixtures/harness/fail.test.js"], {
		TEST_PARALLEL: "0",
	});
	assertEqual(count(r.out, " tests: "), 1);
});

test("a script that imports the helpers but never calls test() stays silent", () => {
	const r = node([join(HARNESS, "import-only.js")]);
	assertEqual(r.status, 0);
	assertEqual(r.out, "compiled with 0 errors\n");
});
