// GoFront test suite — checker differential fuzzer (test/fuzz/checkfuzz.js)
// The grid and baseline checks need no Go toolchain; the tests that run Go's
// type checker are skipped when `go` is not on PATH.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	assert,
	assertContains,
	assertEqual,
	ROOT,
	section,
	test,
	withTempDir,
} from "../helpers.js";

const FUZZ = join(ROOT, "test", "fuzz", "checkfuzz.js");
const GOCHECK = join(ROOT, "test", "fuzz", "gocheck");
const HAS_GO = spawnSync("go", ["version"]).status === 0;

function fuzz(...args) {
	return spawnSync(process.execPath, [FUZZ, ...args], {
		encoding: "utf8",
		timeout: 120000,
	});
}

function gocheck(cases) {
	const r = spawnSync("go", ["run", "."], {
		cwd: GOCHECK,
		input: JSON.stringify(cases),
		encoding: "utf8",
		env: { ...process.env, GOTOOLCHAIN: "local" },
		timeout: 120000,
	});
	assertEqual(r.status, 0, r.stderr);
	return JSON.parse(r.stdout);
}

const program = (stmt) => `package main\n\nfunc main() {\n\t${stmt}\n}\n`;

section("Checker differential fuzzer");

test("the grid parses, has unique keys, keeps the ledger repros and judges a baseline", () => {
	const r = fuzz("--self-test");
	assertEqual(r.status, 0, r.stderr);
	assertContains(r.stdout, "self-test ok (");
});

test("--show rejects a key that is not a case", () => {
	const r = fuzz("--show", "binary:+:nope,nope");
	assertEqual(r.status, 2);
	assertContains(r.stderr, "no case binary:+:nope,nope");
});

if (HAS_GO) {
	test("the Go oracle reports the first error of each program", () => {
		const [bad, good] = gocheck([
			{ id: "bad", src: program("_ = 1 && 2") },
			{ id: "good", src: program("_ = 1 + 2") },
		]);
		assertEqual(bad.id, "bad");
		assertEqual(bad.ok, false);
		assertEqual(bad.line, 4);
		assertEqual(bad.col, 6);
		assertContains(bad.msg, "operator && not defined");
		assertEqual(good.ok, true);
	});

	test("the Go oracle resolves a package the case carries", () => {
		const [res] = gocheck([
			{
				id: "dot",
				src: 'package main\n\nimport . "./sub"\n\nfunc main() {\n\tFn = nil\n}\n',
				pkgs: { "./sub": "package sub\n\nfunc Fn() {}\n" },
			},
		]);
		assertEqual(res.ok, false);
		assertContains(res.msg, "cannot assign to Fn");
	});

	test("the Go oracle marks a program it cannot parse", () => {
		const [res] = gocheck([{ id: "syntax", src: program("_ = 1 +") }]);
		assertEqual(res.ok, false);
		assertEqual(res.syntax, true);
	});

	test("a run fails on a stale baseline entry and on an unlisted disagreement", () => {
		withTempDir(
			{ "baseline.txt": "recv:decl:struct:go-reject/gf-accept # O6\n" },
			(dir) => {
				const r = fuzz(
					"--section",
					"recv",
					"--baseline",
					join(dir, "baseline.txt"),
				);
				assertEqual(r.status, 1, r.stderr);
				assertContains(
					r.stderr,
					"baseline entry no longer occurs, remove it: recv:decl:struct:go-reject/gf-accept",
				);
				assert(
					/new disagreement, not in the baseline: recv:decl:\S+/.test(r.stderr),
					r.stderr,
				);
			},
		);
	});

	test("the committed baseline matches a sample of the grid", () => {
		const r = fuzz("--sample", "400", "--seed", "7");
		assertEqual(r.status, 0, r.stderr);
	});
}
