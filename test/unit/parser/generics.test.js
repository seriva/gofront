// GoFront test suite — generic instantiation lookahead in call arguments

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertEqual,
	assertProgramOutput,
	compile,
	Lexer,
	Parser,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

function parse(source) {
	const tokens = new Lexer(source, "t.go").tokenize();
	return new Parser(tokens, "t.go", source).parse();
}

// First CallExpr to `name` found anywhere under `node`.
function findCall(node, name) {
	if (!node || typeof node !== "object") return null;
	if (node.kind === "CallExpr" && node.func?.name === name) return node;
	for (const v of Object.values(node)) {
		const hit = findCall(v, name);
		if (hit) return hit;
	}
	return null;
}

section("Parser — index expressions inside call arguments");

test("nested selector indexing in an argument is an IndexExpr", () => {
	const ast = parse(`package main
type E struct{ Index int }
type S struct{ Meshes []int; Entries []E }
func Add(x int) {}
func Test(s S, i int) { Add(s.Meshes[s.Entries[i].Index]) }
`);
	const call = findCall(ast, "Add");
	assertEqual(call.args[0].kind, "IndexExpr");
	assertEqual(call.args[0].index.kind, "SelectorExpr");
});

test("nested selector indexing compiles and runs", () => {
	const { js, errors } = compile(`package main
type E struct{ Index int }
type S struct{ Meshes []int; Entries []E }
func Add(x int) int { return x + 1 }
func Test(s S, i int) int { return Add(s.Meshes[s.Entries[i].Index]) }
func main() {
	s := S{Meshes: []int{10, 20}, Entries: []E{{Index: 1}}}
	println(Test(s, 0))
}
`);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	assertEqual(runJs(js), "21");
});

test("explicit instantiation arguments still parse", () => {
	const ast = parse(`package main
func Id[T any](x T) T { return x }
func Test() { f(Id[int], Id[[]int](nil)) }
`);
	assertEqual(findCall(ast, "f").args[0].kind, "InstantiationExpr");
});

section("Parser — type-literal type arguments");

// Kind of the first expression statement's or var initialiser's node.
function firstInit(body) {
	const ast = parse(`package main\n${body}\n`);
	const fn = ast.decls?.find((d) => d.kind === "FuncDecl");
	const stmt = fn ? fn.body.stmts[0] : null;
	return stmt?.rhs?.[0] ?? stmt?.expr ?? stmt;
}

for (const [name, src, typeArgs] of [
	["Id[[]int, int]", "func g() { f := Id[[]int, int]; _ = f }", 2],
	[
		"slices.Index[[]int, int]",
		"func g() { f := slices.Index[[]int, int]; _ = f }",
		2,
	],
	["slices.Sort[[]int]", "func g() { f := slices.Sort[[]int]; _ = f }", 1],
	[
		"Keys[map[string]int, string, int]",
		"func g() { f := Keys[map[string]int, string, int]; _ = f }",
		3,
	],
	[
		"Id[func(int) int, int]",
		"func g() { f := Id[func(int) int, int]; _ = f }",
		2,
	],
	["Id[*T, int]", "func g() { f := Id[*T, int]; _ = f }", 2],
]) {
	test(`${name} parses as an instantiation`, () => {
		const node = firstInit(src);
		assertEqual(node.kind, "InstantiationExpr");
		assertEqual(node.typeArgs.length, typeArgs);
	});
}

test("index by a composite literal is still an index", () => {
	const node = firstInit("func g() { x := a[[]int{1}[0]]; _ = x }");
	assertEqual(node.kind, "IndexExpr");
	assertEqual(node.index.kind, "IndexExpr");
});

test("index by a conversion or dereference is still an index", () => {
	assertEqual(
		firstInit("func g() { x := a[[]byte(s)[0]]; _ = x }").kind,
		"IndexExpr",
	);
	assertEqual(firstInit("func g() { x := a[*p]; _ = x }").kind, "IndexExpr");
});

test("an index before the block of an if or for stays an index", () => {
	const ast = parse(
		"package p\nfunc f(s []int, v int) int { for i := 0; i < len(s); i++ { if v == s[i] { return i } }; for range s[v] { }; return -1 }",
	);
	const text = JSON.stringify(ast);
	assertEqual(text.includes('"InstantiationExpr"'), false);
});

section("Parser — generic instances in func-type parameters");

test("a generic instance as the only parameter of a func type compiles and runs", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type Stack[T any] struct{ items []T }

type A int

func call(f func(Stack[int]) int, s Stack[int]) int {
	if f == nil {
		return 0
	}
	return f(s)
}

func two(f func(A, Stack[int]) int) int { return 1 }

func pair(f func(Stack[int], Stack[string]) int) int { return 2 }

func arr(f func(xs [2]int, ys []int) int) int { return 3 }

func main() {
	fmt.Println(call(nil, Stack[int]{}))
	fmt.Println(call(func(s Stack[int]) int { return len(s.items) + 7 }, Stack[int]{}))
	fmt.Println(two(nil), pair(nil), arr(nil))
	x := Stack[[2]int]{}
	fmt.Println(len(x.items))
}
`,
		"0\n7\n1 2 3\n0\n",
	);
});

test("generic instantiation with a lone pointer type argument", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func Id[T any](x T) T { return x }

func main() {
	x := 4
	f := Id[*int]
	fmt.Println(*f(&x))
	fmt.Println(*Id[*int](&x))
}
`,
		"4\n4\n",
	);
});

section("Parser — struct tags and array lengths inside generic type arguments");

test("L2/L2p/L2h/L2f: struct tags inside generic type arguments compile and run on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Box[T any] struct{ V T }

var pkgVar Box[struct{ X int \`json:"x"\` }]

func Z[T any]() T {
	var zero T
	return zero
}

func main() {
	var localVar Box[struct{ X int \`json:"x"\` }]
	shortVar := Box[struct{ X int \`json:"x"\` }]{}
	fnRes := Z[struct{ X int \`json:"x"\` }]()
	fmt.Println(localVar.V.X, pkgVar.V.X, shortVar.V.X, fnRes.X)
}
`,
		"0 0 0 0\n",
	);
});

test("L2g: struct with array field inside generic type argument compiles and runs on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func Z[T any]() T {
	var zero T
	return zero
}

func main() {
	fmt.Println(Z[struct{ A [2]int }](), Z[[2]int]())
}
`,
		"{[0 0]} [0 0]\n",
	);
});

test("string index, composite-literal field index, and map string index stay IndexExpr", () => {
	const ast = parse(`package main
type S struct{ X int }
func take(x int) int { return x }
func f(xs []int, m map[string]int, i string) int {
	a := m["k"]
	b := xs[S{1}.X]
	c := m[i]
	d := take(xs[S{1}.X])
	e := take(xs[struct{ X int }{1}.X])
	return a + b + c + d + e
}
func g(fns []func() int, idx []int, m map[string]int) int {
	return fns[idx[0]]() + fns[m["k"]]()
}
`);
	const text = JSON.stringify(ast);
	assertEqual(text.includes('"InstantiationExpr"'), false);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
