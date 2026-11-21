// GoFront test suite — //go:embed on `string` and `[]byte` variables in the
// JS backend

import { fileURLToPath } from "node:url";
import { minify } from "../../../src/cli/minifier.js";
import { clearParseCache } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	compileDir,
	runJs,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

const prog = (body, main = "") =>
	`package main\n\nimport _ "embed"\n\n${body}\nfunc main() {\n${main}\n}\n`;

// Builds `files` plus `main.go` as a package for `target` and returns the JS.
function build(files, source, options = {}) {
	return withTempDir({ ...files, "main.go": source }, (dir) => {
		clearParseCache();
		return compileDir(dir, options).js;
	});
}

const run = (files, source, options) => runJs(build(files, source, options));

const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

section("//go:embed: string");

test("embed-js: a string holds the file's text", () => {
	const out = run(
		{ "a.txt": 'hello\n"world" \\ é 日本 😀\n' },
		prog(
			"//go:embed a.txt\nvar s string\n",
			'println(len([]byte(s)))\nprintln(s == "hello\\n\\"world\\" \\\\ é 日本 😀\\n")',
		),
	);
	assertEqual(
		out,
		`${Buffer.byteLength('hello\n"world" \\ é 日本 😀\n')}\ntrue`,
	);
});

test("embed-js: an empty file is the empty string", () => {
	const out = run(
		{ "a.txt": "" },
		prog("//go:embed a.txt\nvar s string\n", "println(len(s))"),
	);
	assertEqual(out, "0");
});

test("embed-js: aliases and defined string types embed", () => {
	const out = run(
		{ "a.txt": "abc" },
		prog(
			"type S = string\ntype Named string\n//go:embed a.txt\nvar s S\n//go:embed a.txt\nvar n Named\n",
			"println(s, string(n))",
		),
	);
	assertEqual(out, "abc abc");
});

test("embed-js: a non-UTF-8 string round-trips through []byte(s)", () => {
	const raw = Buffer.from([
		0x61, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0xe2, 0x82, 0x62,
	]);
	const out = run(
		{ "a.bin": raw },
		prog(
			"//go:embed a.bin\nvar s string\n",
			"println(len(s))\nfor _, c := range []byte(s) { println(c) }",
		),
	);
	assertEqual(out, [raw.length, ...raw].join("\n"));
});

section("//go:embed: []byte");

test("embed-js: a []byte keeps all 256 byte values", () => {
	const out = run(
		{ "all.bin": ALL_BYTES },
		prog(
			"//go:embed all.bin\nvar b []byte\n",
			`bad := 0
for i, c := range b { if int(c) != i { bad++ } }
println(len(b), cap(b), bad)`,
		),
	);
	assertEqual(out, "256 256 0");
});

test("embed-js: []uint8 and aliases of []byte embed", () => {
	const out = run(
		{ "a.txt": "abc" },
		prog(
			"type B = []byte\n//go:embed a.txt\nvar u []uint8\n//go:embed a.txt\nvar b B\n",
			"println(string(u), string(b))",
		),
	);
	assertEqual(out, "abc abc");
});

test("embed-js: two []byte variables of one file share one stored copy but not memory", () => {
	const source = prog(
		"//go:embed a.txt\nvar a []byte\n//go:embed a.txt\nvar b []byte\n",
		"a[0] = 'X'\nprintln(string(a), string(b))",
	);
	const js = build({ "a.txt": "abc" }, source);
	assertEqual(runJs(js), "Xbc abc");
	const stored = Buffer.from("abc").toString("base64").replace(/=+$/, "");
	assertEqual(js.split(`"${stored}"`).length - 1, 1);
});

test("embed-js: an empty file is an empty []byte", () => {
	const out = run(
		{ "a.txt": "" },
		prog("//go:embed a.txt\nvar b []byte\n", "println(len(b))"),
	);
	assertEqual(out, "0");
});

test("embed-js: files of every length modulo three decode", () => {
	for (const n of [1, 2, 3, 4, 5, 6, 7]) {
		const raw = Buffer.from(Array.from({ length: n }, (_, i) => 250 - i * 7));
		const out = run(
			{ "a.bin": raw },
			prog(
				"//go:embed a.bin\nvar b []byte\n",
				"for _, c := range b { println(c) }",
			),
		);
		assertEqual(out, [...raw].join("\n"));
	}
});

section("//go:embed: initialization");

test("embed-js: a variable that depends on an embedded one sees it initialized", () => {
	const out = run(
		{ "a.txt": "hello" },
		prog(
			`var n = len(data)
var m = len(text) * 2

//go:embed a.txt
var data []byte

//go:embed a.txt
var text string
`,
			"println(n, m)",
		),
	);
	assertEqual(out, "5 10");
});

test("embed-js: an init function reads embedded variables", () => {
	const out = run(
		{ "a.txt": "hi" },
		prog(
			"//go:embed a.txt\nvar s string\nvar got string\nfunc init() { got = s }\n",
			"println(got)",
		),
	);
	assertEqual(out, "hi");
});

test("embed-js: grouped embed variables", () => {
	const out = run(
		{ "a.txt": "alpha", "b.txt": "beta" },
		prog(
			"var (\n\t//go:embed a.txt\n\ta string\n\t//go:embed b.txt\n\tb []byte\n)\n",
			"println(a, string(b))",
		),
	);
	assertEqual(out, "alpha beta");
});

test("embed-js: a blank variable compiles and emits nothing for the file", () => {
	const js = build(
		{ "a.txt": "needle-in-output" },
		prog("//go:embed a.txt\nvar _ string\n", "println(1)"),
	);
	assertEqual(runJs(js), "1");
	assert(!js.includes("needle-in-output"), "blank var stores the file");
});

test("embed-js: &s of an embedded string and []byte", () => {
	const out = run(
		{ "a.txt": "abc" },
		prog(
			"//go:embed a.txt\nvar s string\n//go:embed a.txt\nvar b []byte\n",
			`p := &s
*p = *p + "!"
q := &b
(*q)[0] = 'X'
println(s, string(b))`,
		),
	);
	assertEqual(out, "abc! Xbc");
});

test("embed-js: a package with no embed variable has no embed helper", () => {
	const js = build({}, "package main\n\nfunc main() { println(1) }\n");
	assert(!js.includes("__b64"), "helper emitted without an embed");
	assert(!js.includes("__emb"), "embed data emitted without an embed");
});

test("embed-js: the base64 helper is emitted only for a []byte embed", () => {
	const asString = build(
		{ "a.txt": "abc" },
		prog("//go:embed a.txt\nvar s string\n", "println(s)"),
	);
	assert(!asString.includes("__b64"), "string embed pulls the decoder");
	const asBytes = build(
		{ "a.txt": "abc" },
		prog("//go:embed a.txt\nvar b []byte\n", "println(len(b))"),
	);
	assert(asBytes.includes("__b64"), "[]byte embed lacks the decoder");
});

test("embed-js: output after --minify --mangle behaves the same", () => {
	const raw = Buffer.concat([ALL_BYTES, Buffer.from("tail é")]);
	const source = prog(
		`//go:embed all.bin
var b []byte

//go:embed all.bin
var s string

var n = len(b)
`,
		`sum := 0
for _, c := range b { sum += int(c) }
println(n, sum, len(s), string(b[256:]) == s[256:])`,
	);
	const js = build({ "all.bin": raw }, source);
	const plain = runJs(js);
	assert(plain.length > 0);
	assertEqual(runJs(minify(js, { mangle: true })), plain);
	assertEqual(runJs(minify(js)), plain);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
