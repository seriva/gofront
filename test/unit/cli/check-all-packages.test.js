// GoFront test suite — `gofront check` reports every package and test file

import { join, relative } from "node:path";
import {
	handleCheck,
	parseLegacyArgs,
	reportCheck,
	runSingleShot,
} from "../../../src/cli/cli-core.js";
import {
	assertContains,
	assertEqual,
	assertThrows,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("cli-core — check reports every package");

// Run fn while capturing stderr output written through console.error.
function capture(fn) {
	const err = [];
	const orig = console.error;
	console.error = (...a) => err.push(a.join(" "));
	try {
		return { code: fn(), err: err.join("\n") };
	} finally {
		console.error = orig;
	}
}

const bad = (name, v = "s") => `package ${name}\nvar x int = "${v}"\n`;
const clean = (name) => `package ${name}\nvar X = 1\n`;
const statusOf = (res, name) =>
	res.packages.find((p) => p.dir.endsWith(`/${name}`))?.status;
const count = (text, needle) => text.split(needle).length - 1;

test("handleCheck pattern collects every failing package and exits 1", () => {
	withTempDir(
		{
			"a/x.go": bad("a"),
			"b/x.go": bad("b"),
			"ok/ok.go": clean("ok"),
		},
		(dir) => {
			const res = handleCheck(`${dir}/...`);
			assertEqual(res.failed, true);
			assertEqual(statusOf(res, "a"), "fail");
			assertEqual(statusOf(res, "b"), "fail");
			assertEqual(statusOf(res, "ok"), "ok");
			assertContains(res.packages[0].errors, "x.go");
			const out = capture(() => reportCheck(res, dir));
			assertEqual(out.code, 1);
			assertContains(
				out.err,
				`FAIL ${relative(process.cwd(), join(dir, "a"))}`,
			);
			assertContains(
				out.err,
				`FAIL ${relative(process.cwd(), join(dir, "b"))}`,
			);
			assertContains(out.err, "3 packages — 1 ok, 2 failed, 0 skipped");
		},
	);
});

test("reportCheck returns 0 when every package is ok", () => {
	withTempDir({ "a/a.go": clean("a") }, (dir) => {
		const res = handleCheck(`${dir}/...`);
		assertEqual(res.failed, false);
		const out = capture(() => reportCheck(res, dir));
		assertEqual(out.code, 0);
		assertContains(out.err, "1 packages — 1 ok, 0 failed, 0 skipped");
	});
});

test("a package whose only error is in a _test.go file fails check", () => {
	const files = {
		"p/p.go": clean("p"),
		"p/p_test.go": "package p\nvar y string = 1\n",
	};
	withTempDir(files, (dir) => {
		assertThrows(() => handleCheck(join(dir, "p")), "p_test.go");
		const res = handleCheck(`${dir}/...`);
		assertEqual(statusOf(res, "p"), "fail");
		assertContains(res.packages[0].errors, "p_test.go");
		const flags = parseLegacyArgs([join(dir, "p"), "--check"]);
		const out = capture(() =>
			runSingleShot(join(dir, "p"), true, {
				...flags,
				inputArg: join(dir, "p"),
				checkOnly: true,
			}),
		);
		assertEqual(out.code, 1);
		assertContains(out.err, "p_test.go");
	});
});

test("a test-only directory is checked, not rejected", () => {
	withTempDir({ "t/t_test.go": clean("t") }, (dir) => {
		assertEqual(handleCheck(`${dir}/...`).failed, false);
		assertEqual(handleCheck(join(dir, "t")).elapsedMs !== undefined, true);
	});
	withTempDir({ "t/t_test.go": "package t\nvar y string = 1\n" }, (dir) => {
		const res = handleCheck(`${dir}/...`);
		assertEqual(statusOf(res, "t"), "fail");
		assertContains(res.packages[0].errors, "t_test.go");
	});
});

test("check never runs a test function", () => {
	withTempDir(
		{
			"p/p.go": "package p\nfunc F() int { return 1 }\n",
			"p/p_test.go": `package p
import "testing"
func TestX(t *testing.T) { panic("ran") }
`,
		},
		(dir) => {
			const out = capture(() => handleCheck(join(dir, "p")) && 0);
			assertEqual(out.code, 0);
			assertEqual(out.err, "");
		},
	);
});

test("dependent of a failed package is skipped and errors print once", () => {
	withTempDir(
		{
			"a/a.go": bad("a"),
			"c/c.go": 'package c\nimport "../a"\nvar Z = a.X\n',
		},
		(dir) => {
			const res = handleCheck(`${dir}/...`);
			assertEqual(statusOf(res, "a"), "fail");
			assertEqual(statusOf(res, "c"), "skipped");
			const out = capture(() => reportCheck(res, dir));
			assertEqual(count(out.err, "a.go"), 1);
			assertContains(out.err, "skipped (");
			assertContains(out.err, "a failed)");
		},
	);
});

test("dependent sorting before its failing dependency is skipped", () => {
	withTempDir(
		{
			"zz/z.go": bad("zz"),
			"aa/a.go": 'package aa\nimport "../zz"\nvar Z = zz.X\n',
		},
		(dir) => {
			const res = handleCheck(`${dir}/...`);
			assertEqual(statusOf(res, "aa"), "skipped");
			assertEqual(statusOf(res, "zz"), "fail");
			const out = capture(() => reportCheck(res, dir));
			assertEqual(count(out.err, "z.go"), 1);
			assertContains(out.err, "zz failed)");
		},
	);
});

test("diamond dependents are both skipped and the error prints once", () => {
	withTempDir(
		{
			"a/a.go": bad("a"),
			"c/c.go": 'package c\nimport "../a"\nvar Z = a.X\n',
			"d/d.go": 'package d\nimport "../a"\nvar Z = a.X\n',
		},
		(dir) => {
			const res = handleCheck(`${dir}/...`);
			assertEqual(statusOf(res, "c"), "skipped");
			assertEqual(statusOf(res, "d"), "skipped");
			const out = capture(() => reportCheck(res, dir));
			assertEqual(count(out.err, "a.go"), 1);
		},
	);
});

test("transitive dependents name the innermost failed package", () => {
	withTempDir(
		{
			"a/a.go": bad("a"),
			"b/b.go": 'package b\nimport "../a"\nvar Z = a.X\n',
			"c/c.go": 'package c\nimport "../b"\nvar Z = b.Z\n',
		},
		(dir) => {
			const res = handleCheck(`${dir}/...`);
			assertEqual(
				res.packages.find((p) => p.dir.endsWith("/b")).dep.endsWith("/a"),
				true,
			);
			assertEqual(
				res.packages.find((p) => p.dir.endsWith("/c")).dep.endsWith("/a"),
				true,
			);
			const out = capture(() => reportCheck(res, dir));
			assertEqual(count(out.err, "a.go"), 1);
			assertEqual(count(out.err, "a failed)"), 2);
		},
	);
});

test("a failing dependency outside the pattern root prints once", () => {
	withTempDir(
		{
			"shared/s.go": bad("shared"),
			"app/src/one/o.go":
				'package one\nimport "../../../shared"\nvar Z = shared.X\n',
			"app/src/two/t.go":
				'package two\nimport "../../../shared"\nvar Z = shared.X\n',
		},
		(dir) => {
			const res = handleCheck(`${join(dir, "app/src")}/...`);
			assertEqual(res.failed, true);
			assertEqual(statusOf(res, "one"), "skipped");
			assertEqual(statusOf(res, "two"), "skipped");
			const out = capture(() => reportCheck(res, dir));
			assertEqual(count(out.err, "s.go"), 1);
			assertContains(
				out.err,
				`FAIL ${relative(process.cwd(), join(dir, "shared"))}`,
			);
		},
	);
});
