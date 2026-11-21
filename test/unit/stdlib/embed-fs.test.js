// GoFront test suite — package embed: FS and ReadFile, and the directive on
// an embed.FS variable

import { fileURLToPath } from "node:url";
import { clearParseCache } from "../../../src/compiler.js";
import {
	assertEqual,
	assertErrorContains,
	assertOutput,
	compileDir,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

const FILES = { "a.txt": "alpha", "b.txt": "beta" };

// Compiles `main.go` (plus the other files) as a package and returns its errors.
function check(main, target = null) {
	return withTempDir({ ...FILES, "main.go": main }, (dir) => {
		clearParseCache();
		const { errors } = toCompileResult(() =>
			compileDir(dir, target ? { forceTarget: target } : {}),
		);
		return errors;
	});
}

const prog = (body, imports = 'import "embed"\n') =>
	`package main\n\n${imports}\n${body}\nfunc main() {}\n`;

const everywhere = (source, expected, files) =>
	assertOutput(source, expected, {
		targets: ["wasm", "both", "js"],
		files,
	});

section("embed.FS: ReadFile");

test("embed-fs: ReadFile on a zero-value FS misses", async () => {
	await everywhere(
		`package main

import "embed"

var f embed.FS

func main() {
	data, err := f.ReadFile("a.txt")
	println(len(data), data == nil)
	println(err.Error())
}
`,
		"0 true\nopen a.txt: file does not exist\n",
	);
});

test("embed-fs: ReadFile through an aliased import and a pointer receiver", async () => {
	await assertOutput(
		`package main

import e "embed"

var f e.FS

func lookup(p *e.FS, name string) string {
	_, err := p.ReadFile(name)
	return err.Error()
}

func main() {
	println(lookup(&f, "x/y"))
}
`,
		"open x/y: file does not exist\n",
		// `&f` mutates a package variable, which a `both` package cannot do.
		{ targets: ["wasm", "js"] },
	);
});

section("embed.FS: directive");

test("embed-fs: a directive on an embed.FS variable compiles on every target", () => {
	for (const target of ["js", "wasm", "both"])
		assertEqual(
			check(prog("//go:embed a.txt b.txt\nvar files embed.FS\n"), target)
				.length,
			0,
		);
});

test("embed-fs: an aliased import and a type alias embed", () => {
	const errors = check(
		prog(
			"type Files = e.FS\n//go:embed a.txt\nvar files e.FS\n//go:embed b.txt\nvar more Files\n",
			'import e "embed"\n',
		),
	);
	assertEqual(errors.length, 0);
});

test("embed-fs: several files and a blank variable are fine", () => {
	const errors = check(
		prog(
			"//go:embed a.txt\n//go:embed b.txt\nvar files embed.FS\n//go:embed a.txt\nvar _ embed.FS\n",
		),
	);
	assertEqual(errors.length, 0);
});

test("embed-fs: a defined type over embed.FS cannot be embedded", () => {
	const errors = check(
		prog("type B embed.FS\n//go:embed a.txt\nvar files B\n"),
	);
	assertErrorContains(errors, "cannot embed into variable of type B");
});

test("embed-fs: embed.FS needs the embed import", () => {
	const errors = check(
		prog("//go:embed a.txt\nvar files embed.FS\n", 'import _ "embed"\n'),
	);
	assertErrorContains(errors, "embed");
});

test("embed-fs: a directive on embed.FS in a file without the import is rejected", () => {
	const errors = check(prog("//go:embed a.txt\nvar files embed.FS\n", ""));
	assertErrorContains(
		errors,
		'go:embed only allowed in Go files that import "embed"',
	);
});

section("embed.FS: excluded members");

for (const member of ["ReadDir", "Open"]) {
	test(`embed-fs: FS.${member} is a targeted compile error`, () => {
		for (const target of ["js", "wasm"]) {
			const errors = check(
				prog(`var f embed.FS\nfunc use() { _ = f.${member} }\n`).replace(
					"func main() {}",
					"func main() { use() }",
				),
				target,
			);
			assertErrorContains(errors, `embed.FS.${member} is not available`);
			assertErrorContains(errors, "ReadFile");
		}
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
