// GoFront test suite — //go:embed directives are lexed into patterns and
// attached to the package-level var they precede

import { fileURLToPath } from "node:url";
import { decodeRawBytes } from "../../../src/lexer/lexer.js";
import {
	assert,
	assertEqual,
	Lexer,
	Parser,
	section,
	summarize,
	test,
} from "../helpers.js";

function parse(source) {
	const tokens = new Lexer(source, "t.go").tokenize();
	return new Parser(tokens, "t.go", source).parse();
}

// Every VarSpec of the program's package-level `var` declarations.
function specs(ast) {
	return ast.decls.filter((d) => d.kind === "VarDecl").flatMap((d) => d.decls);
}

const patternsOf = (spec) => spec._embeds?.map((d) => d.patterns);

section("//go:embed: pattern extraction");

test("embed: a bare pattern is extracted with its position", () => {
	const ast = parse("package main\n\n//go:embed asset.txt\nvar s string\n");
	const [spec] = specs(ast);
	assertEqual(spec._embeds.length, 1);
	assertEqual(spec._embeds[0].patterns.join("|"), "asset.txt");
	assertEqual(spec._embeds[0].line, 3);
	assertEqual(spec._embeds[0].col, 1);
	assertEqual(ast._embedDirectives.length, 0);
});

test("embed: several patterns, double-quoted and back-quoted", () => {
	const ast = parse(
		'package main\n//go:embed asset.txt "b c.txt" `d e.txt` "q\\"uote"\nvar s string\n',
	);
	const [spec] = specs(ast);
	assertEqual(
		JSON.stringify(spec._embeds[0].patterns),
		JSON.stringify(["asset.txt", "b c.txt", "d e.txt", 'q"uote']),
	);
});

test("embed: double-quoted patterns decode Go escapes", () => {
	const ast = parse(
		'package main\n//go:embed "a\\tb" "\\u00e9.txt" "\\x41"\nvar s string\n',
	);
	const [spec] = specs(ast);
	assertEqual(
		JSON.stringify(spec._embeds[0].patterns),
		JSON.stringify(["a\tb", "\u00e9.txt", "A"]),
	);
});

test("embed: consecutive directives all attach, in order", () => {
	const ast = parse(
		"package main\n//go:embed a.txt\n//go:embed b.txt c.txt\nvar s string\n",
	);
	const [spec] = specs(ast);
	assertEqual(
		JSON.stringify(patternsOf(spec)),
		JSON.stringify([["a.txt"], ["b.txt", "c.txt"]]),
	);
});

test("embed: an empty directive records the usage error", () => {
	const ast = parse("package main\n//go:embed\nvar s string\n");
	const [spec] = specs(ast);
	assertEqual(spec._embeds[0].patterns.length, 0);
	assertEqual(spec._embeds[0].error, "usage: //go:embed pattern...");
});

test("embed: an unterminated quote records an error", () => {
	for (const src of [
		'//go:embed "abc',
		"//go:embed `abc",
		'//go:embed "abc"def',
	]) {
		const ast = parse(`package main\n${src}\nvar s string\n`);
		const [spec] = specs(ast);
		assert(
			spec._embeds[0].error?.startsWith("invalid quoted string in //go:embed"),
			`${src}: ${spec._embeds[0].error}`,
		);
	}
});

test("embed: //go:embed must start the line and be followed by a space", () => {
	const ast = parse(
		"package main\nvar a = 1 //go:embed x.txt\n//go:embedded y.txt\nvar s string\n",
	);
	assertEqual(ast._embedDirectives.length, 0);
	assertEqual(specs(ast).find((s) => s.names[0] === "s")._embeds, undefined);
});

test("embed: a directive in a raw string or block comment is not lexed", () => {
	const ast = parse(
		"package main\nvar s = `\n//go:embed x\n`\n/*\n//go:embed y\n*/\n",
	);
	assertEqual(ast._embedDirectives.length, 0);
});

section("//go:embed: attachment");

test("embed: comments and blank lines between directive and var still attach", () => {
	const ast = parse(
		"package main\n//go:embed a.txt\n\n// docs\n/* more */\n\nvar s string\n",
	);
	assertEqual(JSON.stringify(patternsOf(specs(ast)[0])), '[["a.txt"]]');
	assertEqual(ast._embedDirectives.length, 0);
});

test("embed: specs inside a grouped var attach to their own spec", () => {
	const ast = parse(
		"package main\nvar (\n\t//go:embed a.txt\n\ta string\n\n\tb string\n\t//go:embed c.txt\n\tc []byte\n)\n",
	);
	const [a, b, c] = specs(ast);
	assertEqual(JSON.stringify(patternsOf(a)), '[["a.txt"]]');
	assertEqual(b._embeds, undefined);
	assertEqual(JSON.stringify(patternsOf(c)), '[["c.txt"]]');
	assertEqual(ast._embedDirectives.length, 0);
});

test("embed: a directive before `var (` stays unattached", () => {
	const ast = parse(
		"package main\n//go:embed a.txt\nvar (\n\ta string\n)\nvar b string\n",
	);
	assertEqual(specs(ast)[0]._embeds, undefined);
	assertEqual(specs(ast)[1]._embeds, undefined);
	assertEqual(ast._embedDirectives.length, 1);
	assertEqual(ast._embedDirectives[0].line, 2);
});

test("embed: directives before other declarations or at EOF stay unattached", () => {
	const ast = parse(
		"package main\n//go:embed a.txt\nfunc f() {}\n//go:embed b.txt\ntype T int\n//go:embed c.txt\nconst k = 1\nvar s string\n//go:embed d.txt\n",
	);
	assertEqual(specs(ast)[0]._embeds, undefined);
	assertEqual(ast._embedDirectives.map((d) => d.line).join(","), "2,4,6,9");
});

test("embed: a directive after imports attaches to the first var", () => {
	const ast = parse(
		'package main\nimport _ "embed"\n//go:embed a.txt\nvar s string\n',
	);
	assertEqual(JSON.stringify(patternsOf(specs(ast)[0])), '[["a.txt"]]');
});

test("embed: a directive stays with the var it precedes, not a later one", () => {
	const ast = parse(
		"package main\nfunc f() {\n\t//go:embed in.txt\n}\nvar s string\n",
	);
	assertEqual(specs(ast)[0]._embeds, undefined);
	assertEqual(ast._embedDirectives.length, 1);
});

test("embed: a local var keeps its directive, flagged inFunc", () => {
	const ast = parse(
		"package main\nfunc f() {\n\t//go:embed in.txt\n\tvar s string\n\t_ = s\n}\n",
	);
	assertEqual(ast._embedDirectives.length, 1);
	assertEqual(ast._embedDirectives[0].inFunc, true);
	assertEqual(ast._embedDirectives[0].patterns.join("|"), "in.txt");
});

test("embed: top-level directives are not flagged inFunc", () => {
	const ast = parse("package main\n//go:embed a.txt\nfunc f() {}\n");
	assertEqual(ast._embedDirectives[0].inFunc, undefined);
});

test("embed: the spec keeps its names, type and no initializer", () => {
	const ast = parse("package main\n//go:embed a.txt\nvar a, b string\n");
	const [spec] = specs(ast);
	assertEqual(spec.names.join(","), "a,b");
	assertEqual(spec.value, null);
});

section("//go:embed: decodeRawBytes export");

test("embed: decodeRawBytes maps invalid UTF-8 bytes to lone surrogates", () => {
	assertEqual(decodeRawBytes([0x68, 0x69]), "hi");
	assertEqual(decodeRawBytes([0xff, 0x41]), "\udcff" + "A");
	assertEqual(decodeRawBytes([0xe2, 0x82, 0xac]), "\u20ac");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
