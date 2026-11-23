// GoFront test suite — cached ASTs survive consecutive builds untouched

import {
	clearParseCache,
	compileDir,
	freezeParseCache,
} from "../../../src/compiler.js";
import { cloneAst } from "../../../src/lower/walk.js";
import { assert, assertEqual, section, test, withTempDir } from "../helpers.js";

section("compiler.js — parse cache ASTs are never mutated");

// Runs `fn` with every AST the parse cache stores deep-frozen, so a write to a
// cached baseline throws instead of leaking into the next build.
function withFrozenParseCache(fn) {
	clearParseCache();
	freezeParseCache(true);
	try {
		return fn();
	} finally {
		freezeParseCache(false);
		clearParseCache();
	}
}

// Compiles `dir` twice on a frozen parse cache. Returns both results.
function compileTwice(dir, options = {}) {
	return withFrozenParseCache(() => [
		compileDir(dir, options),
		compileDir(dir, options),
	]);
}

test("function-local types compile twice on frozen cached ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
type Box struct{ n int }
func make1() int {
	type local struct{ a int }
	v := local{a: 1}
	return v.a
}
func make2() int {
	type local struct{ b string }
	v := local{b: "x"}
	return len(v.b)
}
func main() { println(make1(), make2(), Box{n: 1}.n) }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assert(a.js.includes("make1"), "compiled");
			assert(b.js.includes("make2"), "compiled again");
		},
	);
});

test("colliding type names across packages compile twice on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
import "./util"
type Pt struct{ X int }
func main() { p := Pt{X: 1}; q := util.NewPt(); println(p.X, q.X) }
`,
			"util/util.go": `package util
type Pt struct{ X int }
func NewPt() Pt { return Pt{X: 2} }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
			assert(a.js.includes("Pt$$"), "the colliding type is renamed");
		},
	);
});

test("folded array lengths and reserved identifiers on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
const N = 2 + 1
func main() {
	var arr [N]int
	class := 1
	arr[0] = class
	println(arr[0], len(arr))
}
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
			assert(!/\bclass\b\s*=/.test(a.js), "reserved identifier is renamed");
		},
	);
});

test("defer and forwarded multi-value calls on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
func f() (int, int) { return 1, 2 }
func g(a, b int) int { return a + b }
func run() int {
	defer func() { recover() }()
	return g(f())
}
func main() { println(run()) }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
		},
	);
});

test("strict-mode slice indexing on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
func sum(xs []int) int {
	t := 0
	for i := 0; i < len(xs); i++ { t += xs[i] }
	return t
}
func main() { println(sum([]int{1, 2, 3})) }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir, { strict: true });
			assertEqual(b.js, a.js);
		},
	);
});

test("go:embed directives compile twice on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
import _ "embed"
//go:embed note.txt
var note string
func main() { println(note) }
`,
			"note.txt": "hello embed",
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assert(a.js.includes("hello embed"), "embedded text");
			assertEqual(b.js, a.js);
		},
	);
});

test("templ components compile twice on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
func main() { gom.Mount("#app", Row([]string{"a", "b"})) }
`,
			"row.templ": `package main

templ Row(items []string) {
	<ul class={ "list" }>
		for _, it := range items {
			<li class={ it }>{ it }</li>
		}
	</ul>
}
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assert(a.js.includes("Row"), "templ compiled");
			assertEqual(b.js, a.js);
		},
	);
});

test("a cached build equals a build from a cold cache", () => {
	withTempDir(
		{
			"main.go": `package main
import "./util"
type Pt struct{ X int }
const N = 2
func main() { var a [N]int; class := 1; a[0] = class; println(a[0], util.NewPt().X, Pt{}.X) }
`,
			"util/util.go": `package util
type Pt struct{ X int }
func NewPt() Pt { return Pt{X: 2} }
`,
		},
		(dir) => {
			clearParseCache();
			const cold = compileDir(dir);
			const warm = compileDir(dir);
			clearParseCache();
			assertEqual(warm.js, cold.js);
		},
	);
});

section("lower/walk.js — cloneAst");

test("cloneAst copies nodes, shares side references and keeps identity", () => {
	const shared = { kind: "int" };
	const leaf = { kind: "Ident", name: "x", _type: shared };
	const ast = { kind: "Block", stmts: [leaf, leaf], _type: shared };
	const copy = cloneAst(ast);
	assert(copy !== ast && copy.stmts !== ast.stmts, "fresh shells");
	assert(copy.stmts[0] !== leaf, "children are cloned");
	assert(copy.stmts[0] === copy.stmts[1], "shared children stay shared");
	assert(copy._type === shared && copy.stmts[0]._type === shared, "side refs");
	copy.stmts[0].name = "y";
	assertEqual(leaf.name, "x");
});

test("cloneAst can copy parse-time side structures too", () => {
	const directive = { patterns: ["a"], _embedFiles: undefined };
	const ast = { kind: "Spec", _embeds: [directive], _line: 3 };
	const copy = cloneAst(ast, { cloneSide: true });
	assert(copy._embeds[0] !== directive, "side structure is cloned");
	assertEqual(copy._line, 3);
	copy._embeds[0]._embedFiles = [];
	assertEqual(directive._embedFiles, undefined);
});

test("cloneAst copies class instances and shares opaque built-ins", () => {
	class Tok {
		constructor(v) {
			this.v = v;
		}
	}
	const err = new Error("x");
	const ast = { kind: "N", tokens: [new Tok(1)], err };
	const copy = cloneAst(ast);
	assert(copy.tokens[0] !== ast.tokens[0], "token is a fresh object");
	assert(copy.tokens[0] instanceof Tok, "prototype is kept");
	assert(copy.err === err, "errors are shared");
});

test("cloneAst keeps non-enumerable properties hidden", () => {
	const ast = { kind: "TemplFor" };
	Object.defineProperty(ast, "forStmt", {
		value: { kind: "ForStmt" },
		enumerable: false,
		writable: true,
		configurable: true,
	});
	const copy = cloneAst(ast);
	assertEqual(Object.keys(copy).join(), "kind");
	assertEqual(copy.forStmt.kind, "ForStmt");
	assert(copy.forStmt !== ast.forStmt, "hidden child is cloned");
});
