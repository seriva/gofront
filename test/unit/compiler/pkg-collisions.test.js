// GoFront test suite — top-level functions, vars, consts, types and init() that
// local packages declare under the same name

import {
	assertContains,
	assertEqual,
	assertErrorContains,
	compileDir,
	compileHybridProject,
	runInDom,
	section,
	test,
	withTempDir,
} from "../helpers.js";

const TARGETS = ["js", "both", "wasm"];

// Compiles `files` for each target and checks the program's output.
async function allTargets(files, expected, { targets = TARGETS } = {}) {
	for (const target of targets) {
		const { lines } = await compileHybridProject(files, { target });
		assertEqual(`${target}: ${lines.join("|")}`, `${target}: ${expected}`);
	}
}

async function compileError(files, needle, target = "js") {
	let msg = "";
	try {
		await compileHybridProject(files, { target });
	} catch (e) {
		msg = e.message;
	}
	assertErrorContains([{ message: msg }], needle);
}

section("Package collisions — functions");

test("three packages declare the same unexported function", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./other"
	"./util"
)

func helper() int { return 5 }

func main() { fmt.Println(util.Get(), other.Get(), helper()) }
`,
			"util/util.go": `package util

func helper() int { return 2 }
func Get() int  { return helper() }
`,
			"other/other.go": `package other

func helper() int { return 1 }
func Get() int  { return helper() }
`,
		},
		"2 1 5",
	));

test("two packages export the same function, called and taken as a value", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

func main() {
	f, g := a.Make, b.Make
	fmt.Println(a.Make(), b.Make(), f(), g())
}
`,
			"a/a.go": `package a

func Make() int { return 1 }
`,
			"b/b.go": `package b

func Make() int { return 2 }
`,
		},
		"1 2 1 2",
	));

test("a colliding function keeps its variadic and generic forms", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

func Sum(xs ...int) int { return -1 }
func Id[T any](x T) T   { return x }

func main() {
	s := []int{1, 2, 3}
	fmt.Println(a.Sum(s...), b.Sum(1, 2), Sum(5))
	fmt.Println(a.Id(1), b.Id("s"), Id(2.5))
}
`,
			"a/a.go": `package a

func Sum(xs ...int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t
}
func Id[T any](x T) T { return x }
`,
			"b/b.go": `package b

func Sum(xs ...int) int { return len(xs) * 100 }
func Id[T any](x T) T   { return x }
`,
		},
		"6 200 -1|1 s 2.5",
	));

test("a colliding package keeps methods and type names", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

func New() int { return 0 }

func main() {
	x, y := a.New(), b.New()
	fmt.Println(New(), x.Get(), y.Get(), a.Count(), b.Count())
}
`,
			"a/a.go": `package a

var count int

type T struct{ v int }

func New() *T         { count++; return &T{1} }
func (t *T) Get() int { return t.v }
func Count() int      { return count }
`,
			"b/b.go": `package b

var count int

type T struct{ v int }

func New() *T         { count += 10; return &T{2} }
func (t *T) Get() int { return t.v }
func Count() int      { return count }
`,
		},
		"0 1 2 1 10",
		// A `both` package may not mutate a package variable.
		{ targets: ["js", "wasm"] },
	));

section("Package collisions — vars and consts");

test("packages declare the same vars and consts, exported and not", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

const k = 7

var x = 9

func main() {
	fmt.Println(a.K, b.K, a.X, b.X, k, x, a.Get(), b.Get())
}
`,
			"a/a.go": `package a

const (
	k = 1
	K = 10
)

var (
	x = 2
	X = 20
)

func Get() int { return k + x }
`,
			"b/b.go": `package b

const k, K = 3, 30

var x, X = 4, 40

func Get() int { return k + x }
`,
		},
		"10 30 20 40 7 9 3 7",
	));

test("package-level vars initialise from the package's own names", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
)

var x = 1
var y = x + 1

func main() { fmt.Println(x, y, a.Y) }
`,
			"a/a.go": `package a

var x = 10
var Y = x + 1
`,
		},
		"1 2 11",
	));

test("a local, a parameter and a struct field keep the name of a renamed package value", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
)

func helper() int { return 100 }

var cfg = map[string]int{"a": 1}

type S struct{ helper int }

func main() {
	helper := 3
	s := S{helper: 4}
	m := map[int]int{}
	fmt.Println(a.Run(), s.helper, helper, cfg["a"], len(m))
}
`,
			"a/a.go": `package a

type S struct{ helper int }

var cfg = map[string]int{"a": 2}

func helper() int { return 7 }

var tbl = map[int]int{helper(): 1}
var k = 5
var tk = map[int]string{k: "x"}

func Run() int {
	s := S{helper: 2}
	fn := func(helper int) int { return helper }
	return helper() + s.helper + fn(1) + cfg["a"] + len(tbl) + len(tk) + tbl[7]
}
`,
		},
		"15 4 3 1 0",
	));

test("a map or slice literal key naming a renamed value is renamed", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
)

var k = 1
var n = 2

func main() { fmt.Println(k, n, a.Sum()) }
`,
			"a/a.go": `package a

type Registry map[int]string

type P struct{ k int }

var k = 3

const n = 4

var reg = Registry{k: "k"}
var ps = []P{{k: 5}}
var arr = [...]string{n: "n"}

func Sum() int { return len(reg) + ps[0].k + len(arr) + k }
`,
		},
		"1 2 14",
	));

test("a literal key naming a renamed value is renamed for an imported map type", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
)

var k = 1

func main() { fmt.Println(k, a.Get()) }
`,
			"types/types.go": `package types

type Registry map[int]string

type P struct{ k int }

type Pt struct{ K int }
`,
			"a/a.go": `package a

import "../types"

var k = 3

var reg = types.Registry{k: "ok"}
var ps = []types.Pt{{K: k}}
var m = map[string]types.Pt{"x": {K: 4}}

func Get() string { return reg[3] + string(rune('0'+ps[0].K+m["x"].K)) }
`,
		},
		"1 ok7",
	));

test("a literal key naming a renamed value is renamed for a function-local map type", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

func main() { fmt.Println(a.K(), b.F()) }
`,
			"a/a.go": `package a

var k = 100

func K() int { return k }
`,
			"b/b.go": `package b

var k = 200

type S struct{ k int }

func F() string {
	type M map[int]string
	type L struct{ k int }
	m := M{k: "ok"}
	s := S{k: 1}
	l := L{k: 2}
	return m[200] + string(rune('0'+s.k+l.k))
}
`,
		},
		"100 ok3",
	));

test("a dot-imported map type's key naming a renamed value reads its own package's", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	. "./b"
	. "./types"
)

func main() {
	r := Registry{K: "ok"}
	p := Pt{K: 2}
	fmt.Println(r[3], r, a.K, p.K)
}
`,
			"types/types.go": `package types

type Registry map[int]string

type Pt struct{ K int }
`,
			"a/a.go": `package a

var K = 1
`,
			"b/b.go": `package b

var K = 3
`,
		},
		"ok map[3:ok] 1 2",
	));

test("packages declare the same blank constant", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

const _ = 9

func main() { fmt.Println(a.A, a.B, b.A2, b.B2) }
`,
			"a/a.go": `package a

const (
	A = iota
	_
	B
)
`,
			"b/b.go": `package b

const (
	A2 = iota
	_
	B2
)

const _, _ = 1, 2
`,
		},
		"0 2 0 2",
	));

section("Package collisions — types and values");

test("a function or var of one package and a type of another share a name", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./sub"
)

func Box() int { return 5 }

var MyInt = 6

func main() {
	var b sub.Box
	b.V = 3
	var m sub.MyInt = 4
	fmt.Println(Box(), MyInt, b.V, m)
}
`,
			"sub/s.go": `package sub

type Box struct{ V int }
type MyInt int
`,
		},
		"5 6 3 4",
	));

test("a type of one package and a function or var of another share a name", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./sub"
)

type Box struct{ V int }
type MyInt int

func main() {
	var b Box
	b.V = 3
	var m MyInt = 4
	fmt.Println(b.V, m, sub.Box(), sub.MyInt)
}
`,
			"sub/s.go": `package sub

func Box() int { return 5 }

var MyInt = 6
`,
		},
		"3 4 5 6",
	));

section("Package collisions — same package name, different directories");

const SAME_NAME = {
	"main.go": `package main

import (
	"fmt"
	u1 "./p1/util"
	u2 "./p2/util"
)

type Box struct{ Z int }

func main() {
	b1, b2, b := u1.Make(), u2.Make(), Box{3}
	fmt.Println(u1.Get(), u2.Get(), b1.V, b2.S, b.Z)
	fmt.Printf("%T %T %T\\n", b1, b2, b)
}
`,
	"p1/util/u.go": `package util

type Box struct{ V int }

var x = 1

func Make() Box { return Box{V: x} }
func Get() int  { return x }
`,
	"p2/util/u.go": `package util

type Box struct{ S string }

var x = 2

func Make() Box { return Box{S: "x"} }
func Get() int  { return x }
`,
};

test("p1/util and p2/util declare the same vars, functions and types", () =>
	allTargets(SAME_NAME, "1 2 1 x 3|util.Box util.Box main.Box"));

test("p1/util and p2/util share a name in a wasm and a js package", async () => {
	const files = {
		...SAME_NAME,
		"p2/util/u.go": `//gofront:target wasm\n${SAME_NAME["p2/util/u.go"]}`,
	};
	await allTargets(files, "1 2 1 x 3|util.Box util.Box main.Box", {
		targets: ["js"],
	});
});

test("fmt and json handle generic and plain types of same-named packages", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"encoding/json"
	"fmt"
	u1 "./p1/util"
	u2 "./p2/util"
)

type W struct {
	A u1.Pair[int]
	B u2.Pair[string]
	C u2.Box
}

func main() {
	w := W{u1.Pair[int]{A: 1, B: 2}, u2.Pair[string]{A: "x", B: "y"}, u2.Box{V: 3}}
	fmt.Printf("%T %T %T\\n", w.A, w.B, w.C)
	b, err := json.Marshal(w)
	fmt.Println(string(b), err)
	var w2 W
	fmt.Println(json.Unmarshal(b, &w2), w2)
}
`,
			"p1/util/u.go": `package util

type Pair[T any] struct{ A, B T }
type Box struct{ V int }
`,
			"p2/util/u.go": `package util

type Pair[T any] struct{ A, B T }
type Box struct{ V int }
`,
		},
		'util.Pair[int] util.Pair[string] util.Box|{"A":{"A":1,"B":2},"B":{"A":"x","B":"y"},"C":{"V":3}} <nil>|<nil> {{1 2} {x y} {3}}',
	));

section("Package collisions — init");

test("init functions of several packages run in dependency order", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

var order []string

func init() { order = append(order, "main") }
func init() { order = append(order, "main2") }

func main() { fmt.Println(order, a.Order(), b.Order()) }
`,
			"a/a.go": `package a

import "../c"

var order []string

func init() { order = append(order, "a", c.Name()) }

func Order() []string { return order }
`,
			"b/b.go": `package b

var order []string

func init() { order = append(order, "b") }
func init() { order = append(order, "b2") }

func Order() []string { return order }
`,
			"c/c.go": `package c

func Name() string { return "c" }

func init() { println("c init") }
`,
		},
		"c init|[main main2] [a c] [b b2]",
	));

test("two init functions of one package still run in source order", () =>
	allTargets(
		{
			"main.go": `package main

import "fmt"

var n int

func init() { n = n*10 + 1 }
func init() { n = n*10 + 2 }

func main() { fmt.Println(n) }
`,
		},
		"12",
	));

section("Package collisions — dot imports");

test("a dot import reaches renamed functions, vars and consts", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	. "./b"
)

func main() {
	f := Make
	fmt.Println(Make(), K, X, f())
}
`,
			"a/a.go": `package a

func Make() int { return 1 }

const K = 10

var X = 20
`,
			"b/b.go": `package b

import "../a"

func Make() int { return 2 + a.Make() }

const K = 30

var X = 40
`,
		},
		"3 30 40 3",
	));

test("a local that shadows a dot-imported renamed value keeps its name", () =>
	allTargets(
		{
			"main.go": `package main

import (
	"fmt"
	. "./b"
)

func Use(Make int) int { return Make }

func main() {
	type K struct{ N int }
	fmt.Println(Make(), Use(9), K{N: 1}.N)
}
`,
			"a/a.go": `package a

func Make() int { return 1 }
func K() int { return 2 }
`,
			"b/b.go": `package b

import "../a"

func Make() int { return 2 + a.Make() }
func K() int { return 4 + a.K() }
`,
		},
		"3 9 1",
	));

section("Package collisions — output");

test("a name no other package declares keeps its name", () => {
	withTempDir(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

func main() { fmt.Println(a.Solo(), a.Both(), b.Both()) }
`,
			"a/a.go": `package a

func Solo() int { return 1 }
func Both() int { return 2 }
`,
			"b/b.go": `package b

func Both() int { return 3 }
`,
		},
		(dir) => {
			const { js } = compileDir(dir);
			assertContains(js, "function Solo(");
			assertContains(js, "function Both(");
			assertContains(js, "function Both$$b(");
		},
	);
});

test("an unused function of a colliding name is not emitted, a used one is", () => {
	withTempDir(
		{
			"main.go": `package main

import (
	"fmt"
	"./a"
	"./b"
)

func helper() int { return 1 }

func main() { fmt.Println(helper(), a.Make(), b.Make()) }
`,
			"a/a.go": `package a

func Make() int  { return 1 }
func Extra() int { return 2 }
`,
			"b/b.go": `package b

func helper() int { return 3 }
func Make() int   { return helper() }
func Extra() int  { return 4 }
func Unused() int { return helper() }
`,
		},
		(dir) => {
			const { js } = compileDir(dir);
			assertContains(js, "function Make$$b(");
			assertContains(js, "function helper$$b(");
			assertEqual(js.includes("Extra"), false);
			assertEqual(js.includes("Unused"), false);
		},
	);
});

test("a diagnostic in a renamed function quotes the declared name", async () => {
	const files = (src) => ({
		"main.go": `package main

import (
	"fmt"
	"./util"
)

func helper() int { return 5 }

func main() { fmt.Println(util.Get(), helper()) }
`,
		"util/u.go": src,
	});
	await compileError(
		files(`package util

func helper() int { }
func Get() int    { return helper() }
`),
		"missing return at end of function 'helper'",
	);
	await compileError(
		files(`package util

func helper() int { return 1 }
func helper() int { return 2 }
func Get() int    { return 1 }
`),
		"helper redeclared in this block",
	);
});

section("Package collisions — templ components and css classes");

test("packages declare the same templ component and css class", () => {
	const { js } = withTempDir(
		{
			"main.go": `package main

func helper() int { return 100 }

func main() { gom.Mount("#app", View()) }
`,
			"view.templ": `package main

import "./a"

css card() {
	color: red;
}

templ View() {
	<p class={ card() }>{ a.Label() }{ helper() }</p>
	@a.Item()
	@Item()
}

templ Item() { <i>main</i> }
`,
			"a/a.go": `package a

func helper() int { return 1 }

func Label() string { return "A" }
`,
			"a/a.templ": `package a

css card() {
	color: blue;
}

templ Item() { <b class={ card() }>{ helper() }</b> }
`,
		},
		(dir) => compileDir(dir),
	);
	const { document } = runInDom(js, '<div id="app"></div>');
	const html = document.querySelector("#app").innerHTML;
	assertContains(html, "A100</p>");
	assertContains(html, "<b");
	assertContains(html, ">1</b>");
	assertContains(html, "<i>main</i>");
	const classes = [...html.matchAll(/class="(gfc_card_\w+)"/g)].map(
		(m) => m[1],
	);
	assertEqual(new Set(classes).size, 2);
	assertEqual(html.includes("$"), false);
});
