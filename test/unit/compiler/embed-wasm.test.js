// GoFront test suite — //go:embed on `string` and `[]byte` variables in the
// wasm backend, and the same bytes on every target

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { optimizeWasm } from "../../../src/backend/wasm/optimize.js";
import { compileFiles } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	assertOutput,
	assertValidWasm,
	runProgram,
	section,
	summarize,
	test,
} from "../helpers.js";

const prog = (body, main = "") =>
	`package main\n\nimport _ "embed"\n\n${body}\nfunc main() {\n${main}\n}\n`;

const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

// Compiles `source` plus `files` as one `wasm` package and returns the result.
function buildWasm(files, source) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-embed-wasm-"));
	try {
		for (const [name, content] of Object.entries(files))
			writeFileSync(join(dir, name), content);
		const main = join(dir, "main.go");
		writeFileSync(main, source);
		return compileFiles([main], { forceTarget: "wasm", emitWat: true });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Section ids of a module (after the 8-byte header).
function sectionIds(bytes) {
	const ids = [];
	let i = 8;
	while (i < bytes.length) {
		ids.push(bytes[i++]);
		let size = 0;
		let shift = 0;
		for (;;) {
			const b = bytes[i++];
			size |= (b & 0x7f) << shift;
			if ((b & 0x80) === 0) break;
			shift += 7;
		}
		i += size;
	}
	return ids;
}

// Runs `source` on `wasm`, the JS side of a `both` package and a `js` package.
const everywhere = (source, expected, files) =>
	assertOutput(source, expected, {
		targets: ["wasm", "both", "js"],
		files,
	});

// A package that mutates its own embedded copy cannot be `both`.
const mutating = (source, expected, files) =>
	assertOutput(source, expected, { targets: ["wasm", "js"], files });

section("//go:embed: wasm representation");

test("embed-wasm: a []byte is a passive data segment read by array.new_data", () => {
	const res = buildWasm(
		{ "all.bin": ALL_BYTES },
		prog("//go:embed all.bin\nvar b []byte\n", "println(len(b))"),
	);
	assertValidWasm(res.wasm);
	assert(res.wat.includes("array.new_data"), "no array.new_data");
	assert(res.wat.includes("(data $d0"), "no data segment");
	assert(res.wat.includes("(array (mut i8))"), "no packed byte array");
	// No linear memory: the bytes never leave the data segment but into the GC array.
	assert(!sectionIds(res.wasm).includes(5), "memory section present");
	assert(sectionIds(res.wasm).includes(12), "no DataCount section");
	assert(sectionIds(res.wasm).includes(11), "no Data section");
});

test("embed-wasm: a string uses the string table and no data segment", () => {
	const res = buildWasm(
		{ "a.txt": "needle-text" },
		prog("//go:embed a.txt\nvar s string\n", "println(s)"),
	);
	assertValidWasm(res.wasm);
	assert(res.stringTable.includes("needle-text"), "string table entry");
	assert(!res.wat.includes("(data"), "data segment for a string");
	assert(!sectionIds(res.wasm).includes(11), "Data section for a string");
});

test("embed-wasm: a file embedded by two []byte variables is one segment", () => {
	const res = buildWasm(
		{ "a.txt": "abc" },
		prog(
			"//go:embed a.txt\nvar a []byte\n//go:embed a.txt\nvar b []byte\n",
			"println(len(a), len(b))",
		),
	);
	assertEqual(res.wat.split("(data $d").length - 1, 1);
});

test("embed-wasm: a program without //go:embed has no data sections", () => {
	const res = buildWasm({}, "package main\n\nfunc main() { println(1) }\n");
	assert(!sectionIds(res.wasm).includes(11));
	assert(!sectionIds(res.wasm).includes(12));
});

test("embed-wasm: a blank variable embeds nothing", () => {
	const res = buildWasm(
		{ "a.txt": "needle-text" },
		prog("//go:embed a.txt\nvar _ string\n", "println(1)"),
	);
	assertValidWasm(res.wasm);
	assert(!res.stringTable.includes("needle-text"));
});

test("embed-wasm: the module stays valid after wasm-opt", () => {
	let hasBinaryen = true;
	try {
		createRequire(import.meta.url).resolve("binaryen/bin/wasm-opt");
	} catch {
		hasBinaryen = false;
	}
	if (!hasBinaryen) return;
	const res = buildWasm(
		{ "all.bin": ALL_BYTES, "a.txt": "abc" },
		prog(
			"//go:embed all.bin\nvar b []byte\n//go:embed a.txt\nvar s string\n",
			"println(len(b), s)",
		),
	);
	const opt = optimizeWasm(res.wasm);
	assertValidWasm(opt.wasm);
});

section("//go:embed: same bytes on every target");

test("embed-wasm: all 256 byte values in a []byte", async () => {
	await everywhere(
		prog(
			"//go:embed all.bin\nvar b []byte\n",
			`bad := 0
for i, c := range b { if int(c) != i { bad++ } }
println(len(b), cap(b), bad)`,
		),
		"256 256 0\n",
		{ "all.bin": ALL_BYTES },
	);
});

test("embed-wasm: a string and its bytes", async () => {
	await everywhere(
		prog(
			"//go:embed a.txt\nvar s string\n",
			'println(s)\nprintln(len([]byte(s)))\nprintln(s == "héllo\\n")',
		),
		"héllo\n\n7\ntrue\n",
		{ "a.txt": "héllo\n" },
	);
});

test("embed-wasm: a non-UTF-8 string round-trips through []byte(s)", async () => {
	const raw = Buffer.from([
		0x61, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0xe2, 0x82, 0x62,
	]);
	await everywhere(
		prog(
			"//go:embed a.bin\nvar s string\n",
			"println(len(s))\nfor _, c := range []byte(s) { println(c) }",
		),
		`${[raw.length, ...raw].join("\n")}\n`,
		{ "a.bin": raw },
	);
});

test("embed-wasm: []uint8, aliases and an empty file", async () => {
	await everywhere(
		prog(
			`type B = []byte
//go:embed a.txt
var u []uint8
//go:embed a.txt
var b B
//go:embed empty.txt
var e []byte
//go:embed empty.txt
var es string
`,
			"println(string(u), string(b), len(e), e == nil, len(es))",
		),
		"abc abc 0 false 0\n",
		{ "a.txt": "abc", "empty.txt": "" },
	);
});

test("embed-wasm: a dependent var sees the embedded value and a blank var is fine", async () => {
	await everywhere(
		prog(
			`var n = len(data)
var m = len(text) * 2

//go:embed a.txt
var data []byte

//go:embed a.txt
var text string

//go:embed a.txt
var _ string
`,
			"println(n, m)",
		),
		"5 10\n",
		{ "a.txt": "hello" },
	);
});

test("embed-wasm: grouped embed variables and an init function", async () => {
	await everywhere(
		prog(
			`var (
	//go:embed a.txt
	a string
	//go:embed b.txt
	b []byte
)
var got string
func init() { got = a + string(b) }
`,
			"println(got)",
		),
		"alphabeta\n",
		{ "a.txt": "alpha", "b.txt": "beta" },
	);
});

test("embed-wasm: two []byte variables of one file mutate independently", async () => {
	await mutating(
		prog(
			"//go:embed a.txt\nvar a []byte\n//go:embed a.txt\nvar b []byte\n",
			"a[0] = 'X'\nprintln(string(a), string(b))",
		),
		"Xbc abc\n",
		{ "a.txt": "abc" },
	);
});

test("embed-wasm: a package imported by main embeds its own files", async () => {
	await everywhere(
		`package main

import "./assets"

func main() { println(assets.Text, assets.Len(), string(assets.Raw)) }
`,
		"from-package 12 from-package\n",
		{
			"assets/assets.go": `package assets

import _ "embed"

//go:embed data.txt
var Text string

//go:embed data.txt
var Raw []byte

func Len() int { return len(Raw) }
`,
			"assets/data.txt": "from-package",
		},
	);
});

test("embed-wasm: a large file embeds on wasm", async () => {
	const big = Buffer.alloc(300_000);
	for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
	let sum = 0;
	for (const c of big) sum += c;
	const got = await runProgram(
		prog(
			"//go:embed big.bin\nvar b []byte\n",
			"sum := 0\nfor _, c := range b { sum += int(c) }\nprintln(len(b), sum)",
		),
		{ target: "wasm", files: { "big.bin": big } },
	);
	assertEqual(got, `${big.length} ${sum}\n`);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
