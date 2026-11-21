// GoFront test suite — embed.FS file table: ReadFile on js, wasm and both

import { fileURLToPath } from "node:url";
import { minify } from "../../../src/cli/minifier.js";
import { clearParseCache } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	assertOutput,
	compileDir,
	runJs,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

const prog = (body, main = "", imports = 'import "embed"') =>
	`package main\n\n${imports}\n\n${body}\nfunc main() {\n${main}\n}\n`;

const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

// Runs `source` on `wasm`, the JS side of a `both` package and a `js` package.
const everywhere = (source, expected, files) =>
	assertOutput(source, expected, {
		targets: ["wasm", "both", "js"],
		files,
	});

// Builds `files` plus `main.go` as a `js` package and returns the JS.
function buildJs(files, source) {
	return withTempDir({ ...files, "main.go": source }, (dir) => {
		clearParseCache();
		return compileDir(dir).js;
	});
}

section("embed.FS: ReadFile");

test("embed-manifest: ReadFile returns the bytes of file, glob and directory patterns", async () => {
	await everywhere(
		prog(
			`//go:embed top.txt shaders/*.wgsl assets
var files embed.FS

func show(name string) {
	data, err := files.ReadFile(name)
	if err != nil {
		println(err.Error())
		return
	}
	println(name, len(data), string(data))
}
`,
			`show("top.txt")
show("shaders/light.wgsl")
show("shaders/shadow.wgsl")
show("assets/a.txt")
show("assets/sub/b.txt")
show("assets/.hidden")
show("shaders/readme.txt")
show("missing")
show("")`,
		),
		[
			"top.txt 3 top",
			"shaders/light.wgsl 5 light",
			"shaders/shadow.wgsl 6 shadow",
			"assets/a.txt 1 a",
			"assets/sub/b.txt 1 b",
			"open assets/.hidden: file does not exist",
			"open shaders/readme.txt: file does not exist",
			"open missing: file does not exist",
			"open : file does not exist",
			"",
		].join("\n"),
		{
			"top.txt": "top",
			"shaders/light.wgsl": "light",
			"shaders/shadow.wgsl": "shadow",
			"shaders/readme.txt": "readme",
			"assets/a.txt": "a",
			"assets/sub/b.txt": "b",
			"assets/.hidden": "h",
		},
	);
});

test("embed-manifest: all: embeds dot and underscore files", async () => {
	await everywhere(
		prog(
			`//go:embed all:assets
var files embed.FS
`,
			`for _, n := range []string{"assets/.hidden", "assets/_x/y", "assets/a.txt"} {
	data, err := files.ReadFile(n)
	println(n, len(data), err == nil)
}`,
		),
		"assets/.hidden 1 true\nassets/_x/y 1 true\nassets/a.txt 1 true\n",
		{ "assets/.hidden": "h", "assets/_x/y": "y", "assets/a.txt": "a" },
	);
});

test("embed-manifest: ReadFile returns a fresh copy each time", async () => {
	await everywhere(
		prog(
			`//go:embed a.txt
var files embed.FS
`,
			`first, _ := files.ReadFile("a.txt")
first[0] = 'X'
first = append(first, '!')
second, _ := files.ReadFile("a.txt")
println(string(first), string(second))`,
		),
		"Xbc! abc\n",
		{ "a.txt": "abc" },
	);
});

test("embed-manifest: all 256 byte values and a non-UTF-8 name round-trip", async () => {
	await everywhere(
		prog(
			`//go:embed all.bin
var files embed.FS
`,
			`data, err := files.ReadFile("all.bin")
sum := 0
for i, c := range data {
	if int(c) != i { println("mismatch", i) }
	sum += int(c)
}
println(len(data), sum, err == nil)`,
		),
		"256 32640 true\n",
		{ "all.bin": ALL_BYTES },
	);
});

test("embed-manifest: an empty file reads as an empty slice, not a miss", async () => {
	await everywhere(
		prog(
			`//go:embed empty.txt
var files embed.FS
`,
			`data, err := files.ReadFile("empty.txt")
println(len(data), err == nil)`,
		),
		"0 true\n",
		{ "empty.txt": "" },
	);
});

test("embed-manifest: lookups find every file whatever its name's characters", async () => {
	const names = [
		"a.txt",
		"a-b/x",
		"a/y",
		"é.txt",
		"日本.txt",
		"😀.txt",
		"｡.txt",
		"Z",
	];
	const files = Object.fromEntries(names.map((n, i) => [n, `v${i}`]));
	await everywhere(
		prog(
			`//go:embed a.txt a-b a Z é.txt 日本.txt 😀.txt ｡.txt
var files embed.FS
`,
			`for _, n := range []string{${names.map((n) => JSON.stringify(n)).join(", ")}, "b", "é"} {
	data, err := files.ReadFile(n)
	println(n, string(data), err == nil)
}`,
		),
		`${names.map((n, i) => `${n} v${i} true`).join("\n")}\nb  false\né  false\n`,
		files,
	);
});

test("embed-manifest: several FS variables hold their own files", async () => {
	await everywhere(
		prog(
			`//go:embed a.txt
var one embed.FS

//go:embed b.txt
var two embed.FS

func has(f embed.FS, n string) bool { _, err := f.ReadFile(n); return err == nil }
`,
			'println(has(one, "a.txt"), has(one, "b.txt"), has(two, "a.txt"), has(two, "b.txt"))',
		),
		"true false false true\n",
		{ "a.txt": "a", "b.txt": "b" },
	);
});

test("embed-manifest: a variable initialised from an FS sees it ready", async () => {
	await everywhere(
		prog(
			`var size = func() int { d, _ := files.ReadFile("a.txt"); return len(d) }()

//go:embed a.txt
var files embed.FS
`,
			"println(size)",
		),
		"5\n",
		{ "a.txt": "hello" },
	);
});

test("embed-manifest: an aliased import, a type alias and a pointer receiver", async () => {
	await assertOutput(
		prog(
			`type Files = e.FS

//go:embed a.txt
var files Files

func read(p *e.FS) string { d, _ := p.ReadFile("a.txt"); return string(d) }
`,
			"println(read(&files))",
			'import e "embed"',
		),
		"abc\n",
		{ targets: ["wasm", "js"], files: { "a.txt": "abc" } },
	);
});

test("embed-manifest: a package imported by main embeds its own FS", async () => {
	await everywhere(
		`package main

import "./assets"

func main() { println(assets.Read("data.txt")) }
`,
		"from-package\n",
		{
			"assets/assets.go": `package assets

import "embed"

//go:embed data.txt
var files embed.FS

func Read(n string) string { d, _ := files.ReadFile(n); return string(d) }
`,
			"assets/data.txt": "from-package",
		},
	);
});

test("embed-manifest: a blank embed.FS variable embeds nothing", () => {
	const js = buildJs(
		{ "a.txt": "needle-text" },
		prog("//go:embed a.txt\nvar _ embed.FS\n", "println(1)"),
	);
	assert(!js.includes("bmVlZGxl"), "blank var embedded the file");
});

section("embed.FS: storage");

test("embed-manifest: a file embedded by two variables is stored once in JS", () => {
	const js = buildJs(
		{ "a.txt": "abc", "b.txt": "xyz" },
		prog(
			`//go:embed a.txt b.txt
var one embed.FS

//go:embed a.txt
var two embed.FS

//go:embed a.txt
var raw []byte
`,
			"println(len(raw))",
		),
	);
	assertEqual(js.split("var __emb_").length - 1, 2);
	assertEqual(
		js.split(
			JSON.stringify(Buffer.from("abc").toString("base64").replace(/=+$/, "")),
		).length - 1,
		1,
	);
});

test("embed-manifest: a file embedded by two variables is one wasm segment", async () => {
	const { compileFiles } = await import("../../../src/compiler.js");
	const res = withTempDir(
		{
			"a.txt": "abc",
			"b.txt": "xyz",
			"main.go": prog(
				`//go:embed a.txt b.txt
var one embed.FS

//go:embed a.txt
var two embed.FS

//go:embed a.txt
var raw []byte
`,
				"println(len(raw))",
			),
		},
		(dir) =>
			compileFiles([`${dir}/main.go`], { forceTarget: "wasm", emitWat: true }),
	);
	assertEqual(res.wat.split("(data $d").length - 1, 2);
});

test("embed-manifest: JS output after --minify --mangle behaves the same", () => {
	const js = buildJs(
		{ "a.txt": "hello", "d/b.bin": ALL_BYTES },
		prog(
			`//go:embed a.txt d
var files embed.FS
`,
			`a, _ := files.ReadFile("a.txt")
b, err := files.ReadFile("d/b.bin")
sum := 0
for _, c := range b { sum += int(c) }
println(string(a), len(b), sum, err == nil)
_, err = files.ReadFile("nope")
println(err.Error())`,
		),
	);
	const plain = runJs(js);
	assertEqual(plain, "hello 256 32640 true\nopen nope: file does not exist");
	assertEqual(runJs(minify(js, { mangle: true })), plain);
	assertEqual(runJs(minify(js)), plain);
});

test("embed-manifest: a program without embed.FS emits no file table", () => {
	const js = buildJs({}, "package main\n\nfunc main() { println(1) }\n");
	assert(!js.includes("FS$$embed"));
	assert(!js.includes("__emb_"));
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
