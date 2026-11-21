// GoFront test suite — type-checking of //go:embed variables and the `embed`
// import

import { fileURLToPath } from "node:url";
import { clearParseCache } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compileDir,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

const FILES = { "a.txt": "alpha", "b.txt": "beta" };

// Compiles `main.go` (plus the other files) as a package and returns its errors.
function check(main, extra = {}, target = null) {
	return withTempDir({ ...FILES, ...extra, "main.go": main }, (dir) => {
		clearParseCache();
		const { errors } = toCompileResult(() =>
			compileDir(dir, target ? { forceTarget: target } : {}),
		);
		return errors;
	});
}

const prog = (body, imports = 'import _ "embed"\n') =>
	`package main\n\n${imports}\n${body}\nfunc main() {}\n`;

const messages = (errors) => errors.map((e) => e.message).join("\n");

section("//go:embed: valid variables");

test("embed-check: string and []byte variables compile on every target", () => {
	for (const target of ["js", "wasm", "both"]) {
		const errors = check(
			prog("//go:embed a.txt\nvar s string\n//go:embed b.txt\nvar b []byte\n"),
			{},
			target,
		);
		assertEqual(errors.length, 0);
	}
});

test("embed-check: []uint8, aliases, defined types and blank vars are accepted", () => {
	const errors = check(
		prog(
			`type S = string
type B = []byte
type Named string
//go:embed a.txt
var u []uint8
//go:embed a.txt
var s S
//go:embed a.txt
var b B
//go:embed a.txt
var n Named
//go:embed a.txt
var _ string
`,
		),
	);
	assertEqual(errors.length, 0);
});

test("embed-check: grouped vars take a directive per spec", () => {
	const errors = check(
		prog(
			"var (\n\t//go:embed a.txt\n\ta string\n\t//go:embed b.txt\n\tb []byte\n)\n",
		),
	);
	assertEqual(errors.length, 0);
});

test("embed-check: several directives and patterns on a []byte are one file each", () => {
	assertEqual(
		check(prog("//go:embed a.txt\n//go:embed a.txt\nvar b []byte\n")).length,
		0,
	);
});

test("embed-check: `//go:embed is not supported yet` is gone", () => {
	const errors = check(prog("//go:embed a.txt\nvar s string\n"));
	assert(!messages(errors).includes("not supported yet"));
});

section("//go:embed: rejected variables");

test("embed-check: a variable of another type is rejected", () => {
	for (const [type, shown] of [
		["int", "int"],
		["[]string", "[]string"],
		["map[string]string", "map[string]string"],
		["*string", "*string"],
		["any", "any"],
	]) {
		const errors = check(prog(`//go:embed a.txt\nvar x ${type}\n`));
		assertErrorContains(errors, `cannot embed into variable of type ${shown}`);
	}
});

test("embed-check: an initializer is rejected", () => {
	assertErrorContains(
		check(prog('//go:embed a.txt\nvar s string = "x"\n')),
		"go:embed cannot apply to var with initializer",
	);
	assertErrorContains(
		check(prog('//go:embed a.txt\nvar s = "x"\n')),
		"go:embed cannot apply to var with initializer",
	);
});

test("embed-check: several names are rejected", () => {
	assertErrorContains(
		check(prog("//go:embed a.txt\nvar a, b string\n")),
		"go:embed cannot apply to multiple vars",
	);
});

test("embed-check: more than one file for a string or []byte is rejected", () => {
	assertErrorContains(
		check(prog("//go:embed a.txt b.txt\nvar s string\n")),
		"multiple files for type string",
	);
	assertErrorContains(
		check(prog("//go:embed a.txt\n//go:embed b.txt\nvar s string\n")),
		"multiple files for type string",
	);
	assertErrorContains(
		check(prog("//go:embed a.txt b.txt\nvar s []byte\n")),
		"multiple files for type []",
	);
});

test("embed-check: a file reached by two patterns still counts once", () => {
	assertEqual(
		check(prog('//go:embed a.txt "a.txt"\nvar s string\n')).length,
		0,
	);
});

section("//go:embed: misplaced directives");

test("embed-check: a directive before `var (` is misplaced", () => {
	assertErrorContains(
		check(prog("//go:embed a.txt\nvar (\n\ts string\n)\n")),
		"misplaced go:embed directive",
	);
});

test("embed-check: a directive before a non-var declaration or at EOF is misplaced", () => {
	for (const body of [
		"//go:embed a.txt\nfunc f() {}\n",
		"//go:embed a.txt\ntype T int\n",
		"//go:embed a.txt\nconst k = 1\n",
	]) {
		assertErrorContains(check(prog(body)), "misplaced go:embed directive");
	}
	assertErrorContains(
		check(`package main\nimport _ "embed"\nfunc main() {}\n//go:embed a.txt\n`),
		"misplaced go:embed directive",
	);
});

test("embed-check: an empty directive reports the usage", () => {
	assertErrorContains(
		check(prog("//go:embed\nvar s string\n")),
		"usage: //go:embed pattern...",
	);
	assertErrorContains(
		check(prog("//go:embed\nfunc f() {}\n")),
		"usage: //go:embed pattern...",
	);
});

test("embed-check: a malformed quoted pattern is reported", () => {
	assertErrorContains(
		check(prog('//go:embed "a.txt\nvar s string\n')),
		"invalid quoted string in //go:embed",
	);
});

test("embed-check: a local var in a func is rejected", () => {
	assertErrorContains(
		check(
			`package main\nimport _ "embed"\nfunc main() {\n\t//go:embed a.txt\n\tvar s string\n\t_ = s\n}\n`,
		),
		"go:embed cannot apply to var inside func",
	);
});

section("//go:embed: the embed import");

test("embed-check: a file without the embed import is rejected", () => {
	assertErrorContains(
		check(prog("//go:embed a.txt\nvar s string\n", "")),
		'go:embed only allowed in Go files that import "embed"',
	);
});

test("embed-check: the import is required per file, not per package", () => {
	const errors = check(prog("//go:embed a.txt\nvar s string\n"), {
		"other.go": `package main\n\n//go:embed b.txt\nvar t string\n`,
	});
	assertErrorContains(
		errors,
		'go:embed only allowed in Go files that import "embed"',
	);
	assertEqual(
		errors.filter((e) => e.message.includes("only allowed")).length,
		1,
	);
	assert(messages(errors).includes("other.go"));
});

test("embed-check: an aliased import counts", () => {
	assertEqual(
		check(
			prog("//go:embed a.txt\nvar s string\n", 'import e "embed"\n'),
		).filter((e) => e.message.includes("only allowed")).length,
		0,
	);
});

test('embed-check: import _ "embed" compiles with no directive on every target', () => {
	for (const target of ["js", "wasm", "both"])
		assertEqual(check(prog(""), {}, target).length, 0);
});

test("embed-check: embed is no longer an excluded package", () => {
	const msgs = messages(check(prog("")));
	assert(!msgs.includes("not supported"), msgs);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
