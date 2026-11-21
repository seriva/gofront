// GoFront test suite — conformance audit against Go (test/fuzz/conformance-go.js)
// The marker, baseline and tagging checks need no Go toolchain; the tests
// that run Go's type checker are skipped when `go` is not on PATH.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	auditCases,
	compareBaseline,
	DOCUMENTED_RESTRICTION,
	defaultTag,
	extractMarkers,
	findMisses,
	formatBaseline,
	GOFRONT_ONLY,
	loadCases,
	parseBaseline,
} from "../../fuzz/conformance-go.js";
import {
	assert,
	assertContains,
	assertEqual,
	ROOT,
	section,
	test,
	withTempDir,
} from "../helpers.js";

const AUDIT = join(ROOT, "test", "fuzz", "conformance-go.js");
const BASELINE = join(ROOT, "test", "fuzz", "conformance-go-baseline.txt");
const HAS_GO = spawnSync("go", ["version"]).status === 0;

const go = (line, msg, extra = {}) => ({
	file: "main.go",
	line,
	msg,
	...extra,
});

section("Conformance audit — markers");

test("a marker is read with its line and its escaped quotes", () => {
	const source = [
		"package main",
		"",
		'var a int = "x" // ERROR "cannot use \\"x\\" (untyped string constant)"',
		"var b = 1",
		'var c int = nil // ERROR "cannot use nil"',
	].join("\n");
	const markers = extractMarkers(source);
	assertEqual(markers.length, 2);
	assertEqual(markers[0].line, 3);
	assertEqual(markers[0].text, 'cannot use "x" (untyped string constant)');
	assertEqual(markers[1].line, 5);
});

test("a marker is a hit when a Go message on its line contains it", () => {
	const markers = [{ line: 4, text: "cannot use x" }];
	const errors = [
		go(3, "something else"),
		go(4, "unrelated"),
		go(4, "cannot use x (variable of type int) as string value"),
	];
	assertEqual(findMisses(markers, errors).length, 0);
});

test("a marker Go does not say on its line is a miss, whatever the other lines say", () => {
	const markers = [{ line: 4, text: "Cannot assign int to string" }];
	const errors = [
		go(4, "cannot use x (variable of type int) as string value"),
		go(5, "Cannot assign int to string"),
		go(4, "Cannot assign int to string", { file: "sub/pkg.go" }),
	];
	const misses = findMisses(markers, errors);
	assertEqual(misses.length, 1);
	assertEqual(misses[0].line, 4);
	assertEqual(
		misses[0].said.join("|"),
		"cannot use x (variable of type int) as string value",
	);
});

test("a marker on a line Go accepts is a miss with nothing said", () => {
	const [miss] = findMisses([{ line: 2, text: "boom" }], []);
	assertEqual(miss.said.length, 0);
});

section("Conformance audit — baseline");

test("a baseline is read back with its tags and keeps edited tags on rewrite", () => {
	const text = "# header\na:3 # D1\nb:7 # excluded: gofront-only\n\n";
	const baseline = parseBaseline(text);
	assertEqual(baseline.get("a:3"), "D1");
	assertEqual(baseline.get("b:7"), "excluded: gofront-only");
	const written = formatBaseline(
		new Map([
			["b:7", "D2"],
			["a:3", "D3"],
			["a:10", "D3"],
			["c:1", ""],
		]),
		baseline,
	);
	const again = parseBaseline(written);
	assertEqual(again.get("a:3"), "D1");
	assertEqual(again.get("b:7"), "excluded: gofront-only");
	assertEqual(again.get("a:10"), "D3");
	assertEqual(again.get("c:1"), "untriaged");
	assert(written.indexOf("\na:3 ") < written.indexOf("\na:10 "), written);
});

test("a run judges both a miss missing from the baseline and a stale entry", () => {
	const baseline = parseBaseline("a:1 # D1\nb:2 # D2\n");
	assertEqual(compareBaseline(new Set(["a:1", "b:2"]), baseline).length, 0);
	const problems = compareBaseline(new Set(["a:1", "c:3"]), baseline);
	assertEqual(problems.length, 2);
	assertContains(
		problems[0],
		"baseline entry no longer occurs, remove it: b:2",
	);
	assertContains(problems[1], "new miss, not in the baseline: c:3");
});

section("Conformance audit — corpus");

test("a directory case carries its packages and a .d.ts case is Go-less", () => {
	withTempDir(
		{
			"plain.go": 'package main\n\nvar x int = "a" // ERROR "cannot use"\n',
			"dir/main.go":
				'package main\n\nimport "./sub"\n\nvar _ = 1 // ERROR "x"\n',
			"dir/sub/sub.go": "package sub\n",
			"dts/main.go": 'package main\n\nimport "js:lib.d.ts"\n',
			"dts/lib.d.ts": "export declare const a: number;\n",
			"multi/main.go": "package main\n",
			"multi/sub/a.go": "package sub\n",
			"multi/sub/b.go": "package sub\n",
		},
		(dir) => {
			const cases = new Map(loadCases(dir).map((c) => [c.name, c]));
			assertEqual(cases.size, 4);
			assertEqual(cases.get("plain").markers.length, 1);
			assertEqual(cases.get("plain").gofrontOnly, false);
			assertEqual(Object.keys(cases.get("dir").pkgs).join(), "./sub");
			assertEqual(cases.get("dir").gofrontOnly, false);
			assertEqual(cases.get("dts").gofrontOnly, true);
			assertEqual(cases.get("multi").gofrontOnly, true);
		},
	);
});

test("the corpus has a case per reject fixture and every marker is judged", () => {
	const cases = loadCases();
	assert(cases.length > 300, `only ${cases.length} cases`);
	for (const c of cases)
		assert(c.markers.length > 0, `${c.name} has no // ERROR marker`);
});

section("Conformance audit — tags");

const miss = (name, text, extra = {}) => ({
	name,
	marker: { line: 1, text },
	said: [],
	goAccepted: false,
	gofrontOnly: false,
	...extra,
});

test("a miss is tagged by the root that explains it", () => {
	assertEqual(defaultTag(miss("x", "Cannot assign int to string")), "D3");
	assertEqual(
		defaultTag(miss("x", "Invalid operation: bool + untyped bool")),
		"D4",
	);
	assertEqual(
		defaultTag(miss("x", "cannot take address of expression[0]")),
		"D1",
	);
	assertEqual(
		defaultTag(
			miss("identity_x", "Cannot assign A to struct{...}", {
				goAccepted: true,
			}),
		),
		DOCUMENTED_RESTRICTION,
	);
	assertEqual(
		defaultTag(miss("x", "anything", { gofrontOnly: true })),
		GOFRONT_ONLY,
	);
});

test("an audit tags the misses of a case Go cannot check or parse as gofront-only", () => {
	const cases = [
		{
			name: "dts",
			src: "",
			pkgs: {},
			gofrontOnly: true,
			markers: [{ line: 5, text: "cannot assign to Widget" }],
		},
		{
			name: "syntax",
			src: "",
			pkgs: {},
			gofrontOnly: false,
			markers: [{ line: 2, text: "cannot use" }],
		},
		{
			name: "hit",
			src: "",
			pkgs: {},
			gofrontOnly: false,
			markers: [{ line: 2, text: "cannot use" }],
		},
	];
	const verdicts = new Map([
		[
			"syntax",
			{ ok: false, errors: [go(2, "expected ';'", { syntax: true })] },
		],
		["hit", { ok: false, errors: [go(2, "cannot use x")] }],
	]);
	const found = auditCases(cases, verdicts);
	assertEqual([...found.keys()].join(), "dts:5,syntax:2");
	assertEqual(found.get("dts:5").tag, GOFRONT_ONLY);
	assertEqual(found.get("syntax:2").tag, GOFRONT_ONLY);
});

section("Conformance audit — committed baseline");

test("every baseline entry names a marker line of a case and carries a root tag", () => {
	assert(
		existsSync(BASELINE),
		"test/fuzz/conformance-go-baseline.txt is missing",
	);
	const byName = new Map(loadCases().map((c) => [c.name, c]));
	for (const [entry, tag] of parseBaseline(readFileSync(BASELINE, "utf8"))) {
		const at = entry.lastIndexOf(":");
		const c = byName.get(entry.slice(0, at));
		assert(c, `${entry} names no case`);
		assert(
			c.markers.some((m) => m.line === Number(entry.slice(at + 1))),
			`${entry} is not a marker line`,
		);
		assert(tag && tag !== "untriaged", `${entry} has no root tag`);
	}
});

if (HAS_GO) {
	section("Conformance audit — Go");

	test("the Go oracle returns every error of a program in position order", () => {
		const r = spawnSync("go", ["run", "."], {
			cwd: join(ROOT, "test", "fuzz", "gocheck"),
			input: JSON.stringify([
				{
					id: "two",
					all: true,
					src: 'package main\n\nfunc main() {\n\tvar a int = "x"\n\tvar b string = 1\n\t_, _ = a, b\n}\n',
				},
				{
					id: "one",
					src: 'package main\n\nvar a int = "x"\nvar b string = 1\n',
				},
			]),
			encoding: "utf8",
			env: { ...process.env, GOTOOLCHAIN: "local" },
			timeout: 120000,
		});
		assertEqual(r.status, 0, r.stderr);
		const [two, one] = JSON.parse(r.stdout);
		assertEqual(two.errors.length, 2);
		assertEqual(two.errors[0].file, "main.go");
		assertEqual(two.errors[0].line, 4);
		assertEqual(two.errors[1].line, 5);
		assertContains(two.errors[1].msg, "cannot use 1");
		assertEqual(two.line, 4);
		assertEqual(one.errors, undefined);
	});

	test("the committed baseline matches the corpus", () => {
		const r = spawnSync(process.execPath, [AUDIT], {
			encoding: "utf8",
			timeout: 120000,
		});
		assertEqual(r.status, 0, r.stderr);
		assertContains(r.stdout, "not matching the baseline");
	});

	test("a run fails on a stale baseline entry and on an unlisted miss", () => {
		withTempDir({ "baseline.txt": "addr_lit_elem:99 # D1\n" }, (dir) => {
			const r = spawnSync(
				process.execPath,
				[AUDIT, "--baseline", join(dir, "baseline.txt")],
				{ encoding: "utf8", timeout: 120000 },
			);
			assertEqual(r.status, 1, r.stderr);
			assertContains(
				r.stderr,
				"baseline entry no longer occurs, remove it: addr_lit_elem:99",
			);
			assertContains(r.stderr, "new miss, not in the baseline: ");
		});
	});
}
