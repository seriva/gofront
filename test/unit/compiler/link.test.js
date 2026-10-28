// GoFront test suite — src/link/ (source-map merging, wasm unit linking,
// Go-source stdlib name mangling)

import { Lexer } from "../../../src/lexer/lexer.js";
import { mergeCompilationChunks } from "../../../src/link/sourcemap.js";
import { mangleStdlibAst } from "../../../src/link/stdlib.js";
import { checkLinkCollisions } from "../../../src/link/wasm.js";
import { forEachChild } from "../../../src/lower/walk.js";
import { Parser } from "../../../src/parser/index.js";
import {
	assert,
	assertEqual,
	assertThrows,
	section,
	test,
} from "../helpers.js";

// ── Source-map merging ───────────────────────────────────────

section("Link — mergeCompilationChunks");

test("two chunks get offset mappings and a shared source table", () => {
	const merged = mergeCompilationChunks([
		{
			js: "a\nb",
			sourceFiles: ["/p/a.go"],
			sourcesContent: ["A"],
			mappings: [{ genLine: 1, srcLine: 1, srcFileIdx: 0 }],
		},
		{
			js: "c\nd",
			sourceFiles: ["/p/b.go", "/p/a.go"],
			sourcesContent: ["B", "A"],
			mappings: [
				{ genLine: 1, srcLine: 3, srcFileIdx: 0 },
				{ genLine: 2, srcLine: 7, srcFileIdx: 1 },
			],
		},
	]);
	assertEqual(merged.js, "a\nb\nc\nd");
	assertEqual(merged.sourceFiles.join(","), "/p/a.go,/p/b.go");
	assertEqual(merged.sourcesContent.join(","), "A,B");
	assertEqual(
		JSON.stringify(merged.mappings),
		JSON.stringify([
			{ genLine: 1, srcLine: 1, srcFileIdx: 0 },
			{ genLine: 3, srcLine: 3, srcFileIdx: 1 },
			{ genLine: 4, srcLine: 7, srcFileIdx: 0 },
		]),
	);
});

test("string and empty chunks are normalised or dropped", () => {
	const merged = mergeCompilationChunks([
		"x",
		null,
		{ js: "", sourceFiles: [], sourcesContent: [], mappings: [] },
		{
			js: "y",
			sourceFiles: ["/p/a.go"],
			sourcesContent: ["A"],
			mappings: [{ genLine: 1, srcLine: 2, srcFileIdx: 0 }],
		},
	]);
	assertEqual(merged.js, "x\ny");
	assertEqual(merged.mappings[0].genLine, 2);
	assert(
		mergeCompilationChunks([]).js === "",
		"no chunks gives an empty bundle",
	);
});

// ── WASM unit linking ────────────────────────────────────────

section("Link — checkLinkCollisions");

const unit = (pkgName, decls) => ({ pkgName, programs: [{ decls }] });
const fn = (name) => ({ kind: "FuncDecl", name });

test("a duplicate top-level name across two units is rejected", () => {
	assertThrows(
		() =>
			checkLinkCollisions([
				unit("a", [fn("Run"), fn("OnlyA")]),
				unit("b", [fn("Run")]),
			]),
		"cannot link wasm packages: 'Run' is declared in both 'a' and 'b' (linked wasm packages share one namespace)",
	);
});

test("distinct names, `_`, and repeats inside one unit are accepted", () => {
	checkLinkCollisions([
		unit("a", [
			fn("One"),
			fn("One"),
			{ kind: "VarDecl", decls: [{ names: ["_"] }] },
		]),
		unit("b", [fn("Two"), { kind: "VarDecl", decls: [{ names: ["_"] }] }]),
	]);
});

test("methods are keyed by receiver type", () => {
	const m = (recv, name) => ({
		kind: "MethodDecl",
		name,
		recvType: { name: recv },
	});
	checkLinkCollisions([unit("a", [m("T", "Get")]), unit("b", [m("U", "Get")])]);
	assertThrows(
		() =>
			checkLinkCollisions([
				unit("a", [m("T", "Get")]),
				unit("b", [m("T", "Get")]),
			]),
		"'T.Get' is declared in both 'a' and 'b'",
	);
});

// ── Go-source stdlib mangling ────────────────────────────────

section("Link — mangleStdlibAst");

const DEMO_SRC = `package demo

type Box struct{ v int }
type T struct{}

func helper() int { return 1 }
func Id[T any](x T) T { return x }
func Make() Box { var b Box; return b }
func Wrap() int { return New() }

var Count = helper()
`;

function parseDemo() {
	const ast = new Parser(
		new Lexer(DEMO_SRC, "demo.go").tokenize(),
		"demo.go",
		DEMO_SRC,
	).parse();
	// Stand-in for the probe check: every identifier naming a package-scope
	// declaration counts as a package reference.
	const refs = new Set();
	const visit = (n) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach(visit);
		if (n.kind === "Ident") refs.add(`${ast._filename}:${n._line}:${n._col}`);
		forEachChild(n, visit);
	};
	visit(ast.decls);
	return { ast, refs };
}

const names = (ast) =>
	ast.decls.map((d) =>
		d.kind === "VarDecl" ? d.decls[0].names.join(",") : d.name,
	);

test("top-level declarations get the package suffix", () => {
	const { ast, refs } = parseDemo();
	const values = new Set(["helper", "Id", "Make", "Wrap", "Count"]);
	const types = new Set(["Box", "T"]);
	mangleStdlibAst([ast], {
		suffix: "$$demo",
		values,
		types,
		refs,
		overlay: null,
	});
	assertEqual(
		names(ast).join(" "),
		"Box$$demo T$$demo helper$$demo Id$$demo Make$$demo Wrap$$demo Count$$demo",
	);
	const make = ast.decls.find((d) => d.name === "Make$$demo");
	assertEqual(make.returnType.name, "Box$$demo");
	const count = ast.decls.find((d) => d.kind === "VarDecl");
	assertEqual(count.decls[0].value[0].func.name, "helper$$demo");
});

test("a type parameter that shadows a package type is left alone", () => {
	const { ast, refs } = parseDemo();
	const values = new Set(["helper", "Id", "Make", "Wrap", "Count"]);
	const types = new Set(["Box", "T"]);
	mangleStdlibAst([ast], {
		suffix: "$$demo",
		values,
		types,
		refs,
		overlay: null,
	});
	const id = ast.decls.find((d) => d.name === "Id$$demo");
	assertEqual(id.typeParams[0].name, "T");
	assertEqual(id.params[0].type.name, "T");
	assertEqual(id.returnType.name, "T");
});

test("an overlay member reference becomes a package selector", () => {
	const { ast, refs } = parseDemo();
	const values = new Set(["helper", "Id", "Make", "Wrap", "Count"]);
	const types = new Set(["Box", "T"]);
	const overlay = { name: "errors", members: { New: { kind: "func" } } };
	mangleStdlibAst([ast], { suffix: "$$demo", values, types, refs, overlay });
	const wrap = ast.decls.find((d) => d.name === "Wrap$$demo");
	const callee = wrap.body.stmts[0].values[0].func;
	assertEqual(callee.kind, "SelectorExpr");
	assertEqual(callee.expr.name, "errors");
	assertEqual(callee.field, "New");
});

test("without an overlay an unknown package-scope name is untouched", () => {
	const { ast, refs } = parseDemo();
	const values = new Set(["helper", "Id", "Make", "Wrap", "Count"]);
	const types = new Set(["Box", "T"]);
	mangleStdlibAst([ast], {
		suffix: "$$demo",
		values,
		types,
		refs,
		overlay: null,
	});
	const wrap = ast.decls.find((d) => d.name === "Wrap$$demo");
	assertEqual(wrap.body.stmts[0].values[0].func.name, "New");
});
