// GoFront test suite — differential fuzzer generator (test/fuzz/difffuzz.js)
// These tests need no Go toolchain: they run the fuzzer's own checks.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	assert,
	assertContains,
	assertEqual,
	ROOT,
	section,
	test,
} from "../helpers.js";

const FUZZ = join(ROOT, "test", "fuzz", "difffuzz.js");

function fuzz(...args) {
	return spawnSync(process.execPath, [FUZZ, ...args], {
		encoding: "utf8",
		timeout: 60000,
	});
}

section("Differential fuzzer");

test("generated statements never name what a called closure changes", () => {
	const r = fuzz("--self-test", "--stmts", "6");
	assertEqual(r.status, 0, r.stderr);
	assertContains(r.stdout, "self-test ok (2000 cases");
});

test("the same seed generates the same program", () => {
	// --self-test renders seed 7000 twice and compares the text.
	const r = fuzz("--self-test");
	assertEqual(r.status, 0, r.stderr);
});

test("a generated batch declares ks before the closures that may call it", () => {
	const r = fuzz(
		"--mode",
		"order",
		"--stmts",
		"12",
		"--case",
		"6873:0",
		"--print",
	);
	assertEqual(r.status, 0, r.stderr);
	const ks = r.stdout.indexOf("ks := func");
	assert(ks >= 0, "ks is declared");
	for (const f of ["f0", "f1", "f2"])
		assert(ks < r.stdout.indexOf(`${f} := func`), `ks is declared before ${f}`);
	assert(!/ks := func[^\n]*ks\(/.test(r.stdout), "ks does not call itself");
});

test("conflict detection follows calls into closure bodies", () => {
	// Statement `xs[(f1(-4))&1] = a`: f1 only calls ks, and ks changes a.
	const r = fuzz("--self-test", "--stmts", "6");
	assertEqual(r.status, 0, r.stderr);
	assertContains(r.stdout, "transitive conflicts ok");
});

test("--replay on a missing file exits non-zero with ENOENT", () => {
	const r = fuzz("--replay", join(ROOT, "no-such-file.go"));
	assertEqual(r.status, 1);
	assertContains(r.stderr, "ENOENT");
});

test("--case rejects a malformed value", () => {
	const r = fuzz("--case", "nope");
	assertEqual(r.status, 2);
	assertContains(r.stderr, "--case needs SEED:N");
});
