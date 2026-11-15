// test/unit/types/shadowing.test.js
// Task 0.9: browser globals and other predeclared names live in a universe
// scope below the package scope, so package and local declarations shadow
// them as in Go, in every target.

import {
	assert,
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertJsTargetsOutput,
	assertProgramOutput,
	compile,
	compileDir,
	compileHybrid,
	compileHybridProject,
	compileWasm,
	runInDom,
	runWasm,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("Predeclared-name shadowing");

const SHADOW_SRC = `
func Array() int { return 40 }

var document int = 2

func Main() int {
	len := 3
	return Array() + document*len - 6
}
`;

function noRedeclared(errors) {
	const msgs = (errors ?? []).map((e) => e.message).join("\n");
	assert(!msgs.includes("redeclared"), `unexpected redeclaration:\n${msgs}`);
	assertEqual(msgs, "");
}

test("js package: func Array, var document and local len shadow predeclared names", () => {
	const src = `package main\n${SHADOW_SRC}`;
	const { js, errors } = compile(src, { target: "js" });
	noRedeclared(errors);
	assert(
		js.includes("function Array$("),
		"package func Array is emitted as Array$",
	);
});

test("wasm package: shadowing compiles and runs", () => {
	const src = `//gofront:target wasm\npackage main\n${SHADOW_SRC}`;
	const { wasm, stringTable, errors } = compileWasm(src);
	noRedeclared(errors);
	const { exports } = runWasm(wasm, { stringTable });
	assertEqual(exports.Main(), 40n);
});

test("both package: shadowing gives the same result on both backends", () => {
	const res = compileHybrid(`package main\n${SHADOW_SRC}`).run("Main");
	assertEqual(res.jsRes, 40);
});

test("shadowed global is used in place of the browser global", () => {
	const src = `package main

var console int = 7

func Main() int { return console + 1 }
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 8);
});

test("redeclaring a package-level name is still an error", () => {
	const src = `package main
func Array() int { return 1 }
func Array() int { return 2 }
`;
	const { errors } = compile(src);
	assertErrorContains(errors, "Array redeclared in this block");
});

test("generated JS keeps reaching the real globals a package shadows", () => {
	const src = `package main

import "strings"

func Array() int { return 40 }

var Object = 1

func Main() int {
	n := 0
	for _, r := range "héllo" {
		n += int(r) % 2
	}
	m := map[string]int{"ab": 1}
	for k := range m {
		n += len(k)
	}
	return Array() + n + len(strings.Split("a,b", ",")) + Object
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 47);
});

for (const target of ["both", "wasm"]) {
	test(`importing a ${target} package that shadows browser globals`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `//gofront:target ${target}
package util

func Array() int { return 40 }

const Object = 2
`,
				"main.go": `package main

import "./util"

func Main() int {
	n := 0
	for _, r := range "ab" {
		n += int(r)
	}
	return util.Array() + util.Object + n
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 237);
	});
}

for (const target of ["js", "wasm"]) {
	test(`dot-importing a ${target} package that shadows browser globals`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `//gofront:target ${target}
package util

func Array() int { return 7 }
`,
				"main.go": `package main

import . "./util"

func Main() int { return Array() }
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 7);
	});
}

test("an import alias named after a browser global keeps reaching the package", async () => {
	const { mod } = await compileHybridProject(
		{
			"util/u.go": `//gofront:target both
package util

func Answer() int { return 42 }
`,
			"main.go": `package main

import console "./util"

func Main() int { return console.Answer() }
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 42);
});

test("a package directory named after a browser global keeps reaching the package", async () => {
	const { mod } = await compileHybridProject(
		{
			"document/d.go": `//gofront:target both
package document

func Answer() int { return 42 }
`,
			"main.go": `package main

import "./document"

func Main() int { return document.Answer() }
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 42);
});

test("a := redeclaration of a browser-global name assigns the local", () => {
	const src = `package main

func Main() int {
	document := 1
	x, document := 2, 3
	return x + document
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.jsRes, 5);
});

section("Type declarations named after browser globals (Task 0.19d)");

test("js package: type Array struct{} is rejected", () => {
	const { errors } = compile(
		"package main\n\ntype Array struct{ N int }\n\nfunc main() { _ = Array{} }\n",
		{ target: "js" },
	);
	assertErrorContains(
		errors,
		"type Array shadows the JavaScript global Array; rename the type",
	);
});

test("both package: type Error struct{} is rejected", () => {
	const { errors } = compile(
		"//gofront:target both\npackage main\n\ntype Error struct{ Msg string }\n\nfunc Main() int { return len(Error{}.Msg) }\n",
	);
	assertErrorContains(
		errors,
		"type Error shadows the JavaScript global Error; rename the type",
	);
});

test("wasm package: type Array struct{} compiles (no JS class is emitted)", () => {
	const { wasm, errors } = compileWasm(`
package main

type Array struct{ N int }

func Main() int { return Array{N: 3}.N }
`);
	assertEqual(errors.length, 0);
	assertEqual(runWasm(wasm).exports.Main(), 3n);
});

test("type alias named after a browser global is allowed", () => {
	const { errors } = compile(
		"package main\n\ntype Object = map[string]int\n\nfunc main() { _ = Object{} }\n",
		{ target: "js" },
	);
	assertEqual(errors.length, 0);
});

test("named type with methods named after a JS built-in is rejected", () => {
	const { errors } = compile(
		'package main\n\ntype Set map[string]bool\n\nfunc (s Set) Has(k string) bool { return s[k] }\n\nfunc main() { _ = Set{}.Has("a") }\n',
		{ target: "js" },
	);
	assertErrorContains(
		errors,
		"type Set shadows the JavaScript global Set; rename the type",
	);
});

test("interfaces, method-less named types and DOM names are allowed", () => {
	const { js, errors } = compile(
		'package main\n\ntype Number interface{ ~int | ~float64 }\n\ntype Error interface{ Error() string }\n\ntype String string\n\ntype Element struct{ Tag string }\n\nfunc Twice[T Number](x T) T { return x + x }\n\nfunc main() { println(Twice(2), String("s"), Element{Tag: "p"}.Tag) }\n',
		{ target: "js" },
	);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	assert(js.includes("class Element"), "Element struct emitted");
});

section("Declarations that read the name they shadow");

test("comma-ok map lookup, switch init, for init and case body read the outer name", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func f(x int) int { return x * 3 }

func main() {
	m := map[int]int{4: 7}
	k := 4
	{
		k, ok := m[k]
		fmt.Println(k, ok)
	}
	x := 1
	switch x := x + 1; x {
	case 1:
		fmt.Println("one")
	case 2:
		fmt.Println("two")
	}
	n := 2
	for n := n; n < 4; n++ {
		fmt.Println("n", n)
	}
	switch y := 5; y {
	case 5:
		x := f(x)
		fmt.Println(x)
	}
}
`,
		"7 true\ntwo\nn 2\nn 3\n3\n",
	);
});

section("Comma-ok := that reuses a name");

test("type assertion comma-ok with a reused name", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type L struct{}
type N int
type T struct{}

func main() {
	var a, b any = 1, N(0)
	_, ok2 := a.(L)
	n, ok2 := b.(N)
	fmt.Println(n, ok2)
	var x any = 1
	var y any = &T{}
	p, ok := x.(int)
	q, ok := y.(*T)
	fmt.Println(p, ok, q != nil)
	var z any = "s"
	r, ok := z.(int)
	fmt.Println(r, ok)
}
`,
		"0 true\n1 true true\n0 false\n",
	);
});

test("map comma-ok with a reused ok", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	m := map[string]int{"a": 1}
	_, ok := m["z"]
	v, ok := m["a"]
	fmt.Println(v, ok)
}
`,
		"1 true\n",
	);
});

test("a labeled for whose init reads the outer name still continues the label", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	n := 1
outer:
	for n := n + 1; n < 5; n++ {
		for j := 0; j < 2; j++ {
			if j == 1 {
				continue outer
			}
			fmt.Println(n, j)
		}
	}
	fmt.Println(n)
}
`,
		"2 0\n3 0\n4 0\n1\n",
	);
});

section("Function-local types sharing a name");

test("same-named local types in two functions keep their own layout", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func a() { type Dup struct{ X int }; fmt.Println(Dup{1}) }
func b() { type Dup struct{ Y string }; fmt.Println(Dup{"y"}) }

func main() {
	a()
	b()
	type Dup struct{ Z bool }
	fmt.Printf("%T\\n", Dup{})
}
`,
		"{1}\n{y}\nmain.Dup\n",
	);
});

test("a local type shadows a package-level type of the same name", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type T struct{ A int }

func main() {
	type T struct{ B string }
	fmt.Println(T{"x"})
}
`,
		"{x}\n",
	);
});

section("Top-level names that shadow JS globals the output reads");

test("func Map keeps the runtime's Map (g01)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func Map(xs []int, f func(int) int) []int {
	out := make([]int, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func main() {
	fmt.Println(Map([]int{1, 2, 3}, func(x int) int { return x * 2 }))
}
`,
		"[2 4 6]\n",
	);
});

test("func BigInt keeps the runtime's BigInt (g03)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func BigInt(s string) int64 {
	var n int64
	for _, c := range s {
		n = n*10 + int64(c-'0')
	}
	return n
}

func main() {
	var x int64 = 1 << 40
	fmt.Println(BigInt("123"), x*3)
}
`,
		"123 3298534883328\n",
	);
});

test("func Uint8Array keeps the typed array constructor (g04)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func Uint8Array(n int) []byte {
	return make([]byte, n)
}

func main() {
	b := Uint8Array(3)
	b[1] = 7
	fmt.Println(b, len(b))
}
`,
		"[0 7 0] 3\n",
	);
});

test("var Reflect keeps slice views writable (n01)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

var Reflect = 3

func main() {
	xs := []int{1, 2, 3, 4, 5}
	v := xs[1:3]
	v[0] = 9
	fmt.Println(Reflect, xs, v, cap(v))
}
`,
		"3 [1 9 3 4 5] [9 3] 4\n",
	);
});

test("func Proxy keeps slice views iterable (n02)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func Proxy() int { return 5 }

func main() {
	xs := []int{1, 2, 3, 4, 5}
	v := xs[1:3]
	for i, y := range v {
		fmt.Println(i, y)
	}
	w := append([]int(nil), v...)
	fmt.Println(Proxy(), w, len(v))
}
`,
		"0 2\n1 3\n5 [2 3] 2\n",
	);
});

test("func WeakMap keeps typed slice capacity (n05)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func WeakMap() int { return 4 }

func main() {
	b := make([]byte, 6)
	c := b[1:3]
	fmt.Println(WeakMap(), len(c), cap(c))
}
`,
		"4 2 5\n",
	);
});

test("const NaN and var Infinity do not replace math.NaN and math.Inf (n06)", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"fmt"
	"math"
)

const NaN = 2.0

var Infinity = 3.0

func main() {
	fmt.Println(math.IsNaN(math.NaN()), math.Inf(1), NaN, Infinity)
}
`,
		"true +Inf 2 3\n",
	);
});

test("var globalThis is a plain variable (n07)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

var globalThis = 5

func main() {
	fmt.Println(globalThis)
}
`,
		"5\n",
	);
});

test("func Int32Array and Float64Array keep typed slices (n15)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func Int32Array() int { return 1 }
func Float64Array() int { return 2 }

func main() {
	xs := make([]int32, 2)
	ys := make([]float64, 2)
	fmt.Println(Int32Array(), Float64Array(), xs, ys)
}
`,
		"1 2 [0 0] [0 0]\n",
	);
});

test("func ArrayBuffer and DataView keep byte slices (n21)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func ArrayBuffer() int { return 8 }
func DataView() int    { return 9 }

func main() {
	xs := []byte{1, 2}
	fmt.Println(ArrayBuffer(), DataView(), xs)
}
`,
		"8 9 [1 2]\n",
	);
});

section("Locals that shadow JS globals the output reads");

test("local NaN does not replace math.NaN (g10)", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"fmt"
	"math"
)

func main() {
	NaN := 2.0
	fmt.Println(math.IsNaN(math.NaN()), NaN)
}
`,
		"true 2\n",
	);
});

test("local Infinity does not replace math.Inf (g11)", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"fmt"
	"math"
)

func main() {
	Infinity := 3.0
	fmt.Println(math.Inf(1), math.IsInf(Infinity, 0))
}
`,
		"+Inf false\n",
	);
});

test("local BigInt keeps int64 multiplication (n09)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	var x int64 = 1 << 40
	BigInt := 2
	y := x * int64(BigInt)
	fmt.Println(y)
}
`,
		"2199023255552\n",
	);
});

test("parameter Uint8Array keeps make([]byte, n) (n10)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func f(Uint8Array int) []byte {
	return make([]byte, Uint8Array)
}

func main() {
	fmt.Println(f(3))
}
`,
		"[0 0 0]\n",
	);
});

test("named results and parameters NaN and Infinity (n13)", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"fmt"
	"math"
)

func f() (NaN, Infinity float64) {
	NaN = 1.5
	Infinity = 2.5
	fmt.Println(math.IsNaN(math.NaN()), math.Inf(1))
	return
}

func g(NaN float64) float64 {
	fmt.Println(math.IsNaN(math.NaN()))
	return NaN * 2
}

func main() {
	a, b := f()
	fmt.Println(a, b, g(4))
}
`,
		"true +Inf\ntrue\n1.5 2.5 8\n",
	);
});

test("range, type-switch, closure-parameter and for bindings named after globals", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"fmt"
	"math"
)

func main() {
	for NaN, BigInt := range []float64{1, 2} {
		fmt.Println(NaN, BigInt)
	}
	var v any = 3
	switch Infinity := v.(type) {
	case int:
		fmt.Println(Infinity + 1)
	}
	f := func(Uint8Array int) []byte { return make([]byte, Uint8Array) }
	fmt.Println(f(2), math.IsNaN(math.NaN()), math.Inf(1))
	for Map := 0; Map < 2; Map++ {
		fmt.Println(Map)
	}
	var x int64 = 1 << 40
	for BigInt := int64(2); BigInt < 3; BigInt++ {
		fmt.Println(x * BigInt)
	}
}
`,
		"0 1\n1 2\n4\n[0 0] true +Inf\n0\n1\n2199023255552\n",
	);
});

section("Variadic user functions named after JS globals");

test("func Map(xs ...int) called with ys... passes the slice", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func Map(xs ...int) int { return len(xs) }

func main() {
	ys := []int{1, 2, 3}
	fmt.Println(Map(ys...), Map(1, 2), Map())
}
`,
		"3 2 0\n",
	);
});

section("templ and css components named after JS globals");

function templDom(files) {
	const { js } = withTempDir(files, (dir) => compileDir(dir));
	return runInDom(js, '<div id="app"></div>').document;
}

test("templ Map keeps the runtime's Map (t02)", () => {
	const document = templDom({
		"main.go": `package main
type K struct{ A, B int }
func main() {
	seen := map[K]bool{{1, 2}: true}
	if seen[K{1, 2}] {
		gom.Mount("#app", Page())
	}
}`,
		"page.templ": `package main
templ Map(msg string) {
	<p>{ msg }</p>
}
templ Page() {
	<div>
		@Map("a")
		@Map("b")
	</div>
}`,
	});
	const ps = document.querySelectorAll("#app p");
	assertEqual(ps.length, 2);
	assertEqual(ps[0].textContent, "a");
	assertEqual(ps[1].textContent, "b");
});

test("templ Array and css Object() keep Object.defineProperty (t01)", () => {
	const document = templDom({
		"main.go": `package main
func main() {
	gom.Mount("#app", Array("hi"))
}`,
		"page.templ": `package main

css Object() {
	color: red;
}

templ Array(msg string) {
	<span class={ Object() }>{ msg }</span>
}`,
	});
	const el = document.querySelector("#app span");
	assertEqual(el.textContent, "hi");
	assert(el.className.startsWith("gfc_Object_"), el.className);
});

section("Names that need no rename keep working");

test("func Set, String, Object, Array and TypeError coexist with struct-key maps (n04, n16, n20)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func Set(xs []int) int { return len(xs) }

func String() string  { return "s" }
func Number() int     { return 1 }
func Boolean() bool   { return true }
func Object() int     { return 2 }
func Array() int      { return 3 }
func TypeError() int  { return 4 }
func RangeError() int { return 5 }

type K struct{ A, B int }

func main() {
	seen := map[K]bool{{1, 2}: true}
	fmt.Println(Set([]int{1, 2}), String(), Number(), Boolean(), Object(), Array(), TypeError(), RangeError(), len(seen))
}
`,
		"2 s 1 true 2 3 4 5 1\n",
	);
});

test("methods and fields named Map, Set and Reflect stay properties (n22)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type Box struct {
	Map []int
	Set map[string]int
}

func (b Box) Size() int { return len(b.Map) + len(b.Set) }
func (b Box) Reflect() int { return 7 }

func main() {
	b := Box{Map: []int{1, 2}, Set: map[string]int{"a": 1}}
	fmt.Println(b.Size(), b.Reflect(), b.Map, b.Set)
}
`,
		"3 7 [1 2] map[a:1]\n",
	);
});

test("a type parameter Map and a label Set are not renamed (n23)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func Keys[Map comparable](xs ...Map) int {
	m := map[Map]bool{}
	for _, x := range xs {
		m[x] = true
	}
	return len(m)
}

func main() {
Set:
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if j == 1 {
				continue Set
			}
			fmt.Println(i, j)
		}
	}
	fmt.Println(Keys(1, 2, 2))
}
`,
		"0 0\n1 0\n2 0\n2\n",
	);
});

test("locals named Map, Object, Array, String, Number, Math, Error, Promise, undefined (n08, n11, n12, n14, g12)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	Map := 1
	Object := 2
	Array := []int{3}
	String := "s"
	Number := 4
	Math := 5
	Error := 6
	Promise := 7
	undefined := 8
	x := make([]byte, 2)
	fmt.Println(Map, Object, Array, String, Number, Math, Error, Promise, undefined, x)
}
`,
		"1 2 [3] s 4 5 6 7 8 [0 0]\n",
	);
});

section("Packages that export names shadowing JS globals");

const GLOBALS_UTIL = (target) => `//gofront:target ${target}
package util

func Map(n int) int { return n * 2 }

func Set(n int) int { return n + 1 }

func BigInt(n int) int64 { return int64(n) << 40 }

const NaN = 2.5

const Infinity = 7
`;

for (const target of ["js", "both", "wasm"]) {
	test(`qualified use of a ${target} package exporting Map, Set, BigInt, NaN and Infinity`, async () => {
		const { mod, js } = await compileHybridProject(
			{
				"util/u.go": GLOBALS_UTIL(target),
				"main.go": `package main

import (
	"fmt"
	"math"
	"./util"
)

func Main() string {
	return fmt.Sprint(util.Map(3), util.Set(3), util.BigInt(3), util.NaN, util.Infinity,
		math.IsNaN(math.NaN()), math.Inf(1))
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), "6 4 3298534883328 2.5 7 true +Inf");
		assert(js.includes("Map$"), "the exported Map is bound as Map$");
	});

	test(`dot-importing a ${target} package exporting Map, Set, BigInt, NaN and Infinity`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": GLOBALS_UTIL(target),
				"main.go": `package main

import (
	"fmt"
	"math"
	. "./util"
)

func Main() string {
	return fmt.Sprint(Map(3), Set(3), BigInt(3), NaN, Infinity,
		math.IsNaN(math.NaN()), math.Inf(1))
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), "6 4 3298534883328 2.5 7 true +Inf");
	});
}

for (const target of ["js"]) {
	test(`a ${target} package var named after a global is readable and writable from main`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `//gofront:target ${target}
package util

var Set = 3

var Proxy = []int{1, 2}

func Bump() { Set++ }
`,
				"main.go": `package main

import (
	"fmt"
	"./util"
)

func Main() string {
	util.Bump()
	util.Set += 10
	return fmt.Sprint(util.Set, util.Proxy, len(util.Proxy[:1]))
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), "14 [1 2] 1");
	});
}
