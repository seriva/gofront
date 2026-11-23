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

section("Differential fuzzer: stores mode");

let storesProgram = null;
const storesBatch = () => {
	storesProgram ??= fuzz(
		"--mode",
		"stores",
		"--print",
		"--seed",
		"1",
		"--cases",
		"150",
		"--stmts",
		"12",
	).stdout;
	return storesProgram;
};

const STORE_SHAPES = {
	"comma-ok map into *p": /\*ps2?, ok = ms\[/,
	"comma-ok map into a generic target": /ok = setOK\(/,
	"comma-ok assertion into *p": /\*ps2?, ok = ia\.\(S\)/,
	"comma-ok assertion into a generic target": /ok = setAssert\(/,
	"range-over-func =": /for [^;\n]* = range seq[SAPI]\(/,
	"range-over-func = with a key": /for [^;\n]* = range kseq[SAPI]\(/,
	"range = over a slice": /for _, [^;\n]* = range \[\]/,
	"range = over a map": /for _, [^;\n]* = range map\[int\]/,
	"generic range =": /setRange\(/,
	"for init comma-ok :=": /for x, ok2 := m[sapi]\[kf\(\)\]; ok2; ok2 = false/,
	"for post comma-ok": /for t := 0; t < 1; [^;\n]*, ok = m[sapi]\[/,
	"for post struct tuple": /for t := 0; t < 2; \*?[\w.[\]]+, t = \(S\{/,
	"for post complex +=": /for t := 0; t < 2; c \+= z/,
	"closure-captured struct": /f\d := func\(\) \{[^}]*\b(v|w|s|wv)\b[.=]/,
	"embedded field": /v\.P = s\.P/,
	"literal value-struct field": /W\{Q: q\}/,
	"address-taken sliced array": /sl := arr\[:\]/,
};

for (const [name, re] of Object.entries(STORE_SHAPES))
	test(`--mode stores generates ${name}`, () => {
		assert(re.test(storesBatch()), `no statement matches ${re}`);
	});

test("--mode stores is deterministic and differs between seeds", () => {
	const a = fuzz("--mode", "stores", "--print", "--seed", "3", "--cases", "5");
	const b = fuzz("--mode", "stores", "--print", "--seed", "3", "--cases", "5");
	const c = fuzz("--mode", "stores", "--print", "--seed", "4", "--cases", "5");
	assertEqual(a.status, 0, a.stderr);
	assertEqual(a.stdout, b.stdout);
	assert(a.stdout !== c.stdout, "seeds 3 and 4 gave the same program");
});
