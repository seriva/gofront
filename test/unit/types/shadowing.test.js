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

section("User names that start with __");

test("var __append does not clash with the append helper (g09)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

var __append = 7

func main() {
	xs := []int{1}
	xs = append(xs, __append)
	fmt.Println(xs, __append)
}
`,
		"[1 7] 7\n",
	);
});

test("func __len does not clash with the len helper (n17)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func __len(x []int) int { return len(x) * 10 }

func main() {
	fmt.Println(__len([]int{1, 2}), len("ab"))
}
`,
		"20 2\n",
	);
});

test("local __append does not replace the append helper (n18)", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func main() {
	__append := 7
	xs := append([]int{1}, __append)
	fmt.Println(xs, __append)
}
`,
		"[1 7] 7\n",
	);
});

test("range-over-func with an assigned loop variable still works (synthesised yield names)", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"fmt"
	"iter"
)

func seq(yield func(int) bool) {
	for i := 0; i < 3; i++ {
		if !yield(i) {
			return
		}
	}
}

var _ iter.Seq[int] = seq

func main() {
	var k int
	for k = range seq {
		fmt.Println(k)
	}
	fmt.Println("last", k)
}
`,
		"0\n1\n2\nlast 2\n",
	);
});

test("locals named __r, recv and args keep working (n19)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	__r := 1
	recv := 2
	args := []int{3}
	args = append(args, __r+recv)
	fmt.Println(__r, recv, args)
}
`,
		"1 2 [3 3]\n",
	);
});

for (const target of ["both", "wasm"]) {
	test(`a ${target} package with func __len, __gfw_i64in and __w works from a js main (h07, h08)`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `//gofront:target ${target}
package util

func __len(x []int) int { return len(x) * 10 }

func __gfw_i64in(n int) int { return n + 1 }

func __w(n int) int { return n * 2 }

func Size(xs []int) int { return __len(xs) + __gfw_i64in(1) + __w(3) }
`,
				"main.go": `package main

import (
	"fmt"
	"./util"
)

func Main() string {
	return fmt.Sprint(util.Size([]int{1, 2}), len([]int{1}), len("abc"))
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), "28 1 3");
	});
}

test("types named with a __ prefix keep their class name in every use", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type __q struct{ A int }

func (q __q) Get() int { return q.A }
func (q *__q) Set(n int) { q.A = n }

type __n int

type __i interface{ Get() int }

type __g[T any] struct{ V T }

func conv(x int) __n { return __n(x) }

func main() {
	x := __q{1}
	y := x
	y.Set(5)
	var i __i = y
	var p *__q = &x
	n := conv(3)
	g := __g[int]{V: 4}
	var a any = x
	_, ok := a.(__q)
	switch v := a.(type) {
	case __q:
		fmt.Println("q", v.A)
	}
	m := map[__q]int{x: 1}
	s := []__q{{2}, {3}}
	fmt.Println(x, y == x, i.Get(), p.A, n, g, ok, m[x], s, new(__q).A, make([]__n, 2))
	fmt.Printf("%T %T\\n", x, n)
}
`,
		"q 1\n{1} false 5 1 3 {4} true 1 [{2} {3}] 0 [0 0]\nmain.__q main.__n\n",
	);
});

test("a local variable named after a declared type is not treated as the type", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type Proxy struct{ X int }

func main() {
	Proxy := 5
	fmt.Println(Proxy)
}
`,
		"5\n",
	);
	await assertJsTargetsOutput(
		`package main

import "fmt"

type __q struct{ A int }

func main() {
	__q := 7
	fmt.Println(__q)
}
`,
		"7\n",
	);
});

test("a local type does not stop another function's variable of that name being renamed", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

func other() int {
	type __q struct{ A int }
	return __q{2}.A
}

func main() {
	__q := 7
	fmt.Println(__q, other())
}
`,
		"7 2\n",
	);
});

test("a package named with a __ prefix keeps its namespace name", async () => {
	const { mod } = await compileHybridProject(
		{
			"util/u.go": `package util

func Answer() int { return 42 }
`,
			"main.go": `package main

import __u "./util"

func Main() int { return __u.Answer() }
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 42);
});

for (const [comp, param] of [
	["Page", "__x"],
	["Page", "BigInt"],
]) {
	test(`templ case expressions after the first are renamed too (${param})`, () => {
		const document = templDom({
			"main.go": `package main
func main() {
	gom.Mount("#app", ${comp}("b"))
}`,
			"page.templ": `package main

templ ${comp}(${param} string) {
	switch "b" {
	case "a", ${param}:
		<p>hit</p>
	default:
		<p>miss</p>
	}
}`,
		});
		assertEqual(document.querySelector("#app p").textContent, "hit");
	});
}

section("Value bindings named after a type");

for (const [name, decl, init, use] of [
	["Proxy", "struct{ X int }", "Proxy{99}", "Proxy.X"],
	["__q", "struct{ A int }", "__q{42}", "__q.A"],
]) {
	const field = use.split(".")[1];
	test(`${name} := ${name}{...} reads the value after its declaration`, async () => {
		await assertJsTargetsOutput(
			`package main

import "fmt"

type ${name} ${decl}

func main() {
	${name} := ${init}
	fmt.Println(${use})
	${name}.${field} = 3
	fmt.Println(${name}.${field}, ${name})
}
`,
			`${init.includes("99") ? 99 : 42}\n3 {3}\n`,
		);
	});

	test(`func f(${name} ${name}) reads the parameter in its body`, async () => {
		await assertJsTargetsOutput(
			`package main

import "fmt"

type ${name} ${decl}

func f(${name} ${name}) int { return ${use} }

func main() {
	fmt.Println(f(${init}))
}
`,
			`${init.includes("99") ? 99 : 42}\n`,
		);
	});
}

test("var __n __n = 7 reads the variable after its declaration", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type __n int

func main() {
	var __n __n = 7
	fmt.Println(__n + 1)
}
`,
		"8\n",
	);
});

test("type switch binding, receiver and result named after a type are values", async () => {
	await assertJsTargetsOutput(
		`package main

import "fmt"

type __q struct{ A int }

func (__q __q) Get() int { return __q.A }

func g() (__q __q) {
	__q.A = 5
	return
}

func main() {
	var a any = __q{3}
	switch __q := a.(type) {
	case __q:
		fmt.Println(__q.A)
	}
	fmt.Println(__q{4}.Get(), g().A, __q{A: 1})
}
`,
		"3\n4 5 {1}\n",
	);
});

section("Packages named with a __ prefix");

const UNDERSCORE_PKG = `package __u

type T struct{ A int }

func (t T) Get() int { return t.A }

type __S struct{ B int }

type G[X any] struct{ V X }

func (g G[X]) Pick() X { return g.V }

func N(n int) int { return n * 2 }

func Answer() int { return 42 }
`;

for (const [label, pkgFile, importLine] of [
	["package __u", UNDERSCORE_PKG, 'import "./util"'],
	[
		"import __u",
		UNDERSCORE_PKG.replace("package __u", "package util"),
		'import __u "./util"',
	],
]) {
	test(`types of a __ prefixed package keep working (${label})`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": pkgFile,
				"main.go": `package main

${importLine}

func Main() int {
	v := __u.T{A: 10}
	s := __u.__S{B: 5}
	var a any = v
	_, ok := a.(__u.T)
	p := new(__u.T)
	g := __u.G[int]{V: 4}
	if !ok {
		return -1
	}
	return v.Get() + s.B + __u.Answer() + __u.N(5) + p.A + g.Pick()
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 71);
	});
}

test("members of a __ prefixed package keep working", async () => {
	const { mod } = await compileHybridProject(
		{
			"util/u.go": `package __u

func __Answer() int { return 42 }

var __V = 8
`,
			"main.go": `package main

import "./util"

func Main() int { return __u.__Answer() + __u.__V }
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), 50);
});

section("Dot-imported types that need a rename-safe name");

const DOT_TYPES_UTIL = `package __u

type __S struct{ B int }

type __G[X any] struct{ V X }

func (g __G[X]) Pick() X { return g.V }

func __Answer() int { return 42 }

var __V = 8
`;

for (const [label, body, want] of [
	[
		"composite literal, assertion and new of a __ type",
		`	s := __S{B: 5}
	var a any = s
	_, ok := a.(__S)
	p := new(__S)
	if !ok {
		return -1
	}
	return s.B + p.B + __Answer() + __V`,
		55,
	],
	[
		"a variable that shares its name with the dot-imported type",
		`	__S := __S{42}
	return __S.B`,
		42,
	],
	[
		"a generic __ type",
		`	g := __G[int]{V: 9}
	return g.Pick()`,
		9,
	],
	[
		"type switch case and conversion of dot-imported types",
		`	var a any = __S{B: 3}
	switch v := a.(type) {
	case __S:
		return v.B
	}
	return -1`,
		3,
	],
]) {
	test(`dot-imported package: ${label}`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": DOT_TYPES_UTIL,
				"main.go": `package main

import . "./util"

func Main() int {
${body}
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), want);
	});
}

section("Renames follow the binding a name resolves to");

for (const [name, decl, read] of [
	["Array", "type Array int", "int(Array)"],
	["Map", "type Map int", "int(Map)"],
	["Proxy", "type Proxy int", "int(Proxy)"],
	["__n", "type __n int", "int(__n)"],
]) {
	test(`package var ${name} of an imported type of the same name`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `package util\n\n${decl}\n`,
				"main.go": `package main

import "./util"

var ${name} util.${name} = 5

func Main() int { return ${read} }
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 5);
	});
}

for (const name of ["__A", "Proxy"]) {
	test(`package var ${name} of an imported struct type of the same name`, async () => {
		const { mod } = await compileHybridProject(
			{
				"util/u.go": `package util\n\ntype ${name} struct{ X int }\n`,
				"main.go": `package main

import "./util"

var ${name} = util.${name}{X: 5}

func Main() int { return ${name}.X }
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 5);
	});
}

for (const [name, local, pkg, want] of [
	["__A", 3, 7, 10],
	["Map", 1, 7, 8],
	["Proxy", 1, 7, 8],
]) {
	test(`package var ${name} next to a local type of the same name in another function`, async () => {
		const { mod } = await compileHybridProject(
			{
				"main.go": `package main

func other() int {
	type ${name} = int
	var x ${name} = ${local}
	return x
}

var ${name} = ${pkg}

func Main() int { return ${name} + other() }
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), want);
	});
}

section("Type parameters named like runtime helpers or JS globals");

for (const tp of ["__T", "Proxy", "Map", "BigInt", "delete"]) {
	test(`new(${tp}) of a type parameter`, async () => {
		const { mod } = await compileHybridProject(
			{
				"main.go": `package main

func f[${tp} any]() *${tp} { return new(${tp}) }

type Box[${tp} any] struct{ V ${tp} }

func (b Box[${tp}]) ZeroPtr() *${tp} { return new(${tp}) }

func Main() int {
	a := *f[string]() + "!"
	b := *(&Box[string]{V: "x"}).ZeroPtr() + "!"
	return len(a) + len(b) + *f[int]() - 2
}
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 0);
	});

	test(`composite and assertion forms of type parameter ${tp}`, async () => {
		const { mod } = await compileHybridProject(
			{
				"main.go": `package main

func g[${tp} comparable](x ${tp}) int {
	m := map[${tp}]int{x: 3}
	s := []${tp}{x, x}
	a := new([2]${tp})
	var i any = &x
	_, ok := i.(*${tp})
	var j any = s
	_, ok2 := j.([]${tp})
	p := (*${tp})(nil)
	n := 0
	if ok && ok2 && p == nil {
		n = 1
	}
	return m[x] + len(s) + len(a) + n
}

func Main() int { return g[int](4) }
`,
			},
			{ exports: ["Main"] },
		);
		assertEqual(mod.Main(), 8);
	});
}

section("__ members of wasm package structs");

test("a __ field and interface method of a wasm struct are reached from a js main", async () => {
	const { mod } = await compileHybridProject(
		{
			"util/u.go": `//gofront:target wasm
package util

type Rec struct {
	__t int
	N   int
}

func (r Rec) __twice() int { return r.__t * 2 }

type Sizer interface{ __twice() int }

func New(t, n int) *Rec { return &Rec{__t: t, N: n} }

func AsSizer(r *Rec) Sizer { return r }
`,
			"main.go": `package main

import (
	"fmt"
	"./util"
)

func Main() string {
	r := util.New(7, 8)
	r.__t = 9
	s := util.AsSizer(r)
	return fmt.Sprintf("%d %d %d", r.__t, r.N, s.__twice())
}
`,
		},
		{ exports: ["Main"] },
	);
	assertEqual(mod.Main(), "9 8 18");
});

section("Class names that are JS strict-mode words");

test("type named yield keeps its class declaration valid", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type yield struct{ X int }

func main() {
	y := yield{7}
	var a any = y
	_, ok := a.(yield)
	fmt.Println(y.X, ok)
	fmt.Printf("%T\\n", yield{})
}
`,
		"7 true\nmain.yield\n",
	);
});

test("type named arguments keeps its class declaration valid", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type arguments struct{ X int }

func main() {
	a := arguments{3}
	b := a
	b.X++
	fmt.Println(a.X, b.X)
}
`,
		"3 4\n",
	);
});

test("type named undefined works with type assertions", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type undefined struct{ X int }

func main() {
	var a any = undefined{1}
	_, ok := a.(undefined)
	fmt.Println(ok)
}
`,
		"true\n",
	);
});

test("named non-struct type named yield with methods", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type yield int

func (y yield) Dbl() yield { return y * 2 }

func main() {
	var a any = yield(4).Dbl()
	v, ok := a.(yield)
	fmt.Println(v, ok)
	p := new(yield)
	*p = 3
	fmt.Println(*p)
}
`,
		"8 true\n3\n",
	);
});

section("Locals named after their own type");

test("local named after its type calls static methods (F3)", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T int

func (t T) Dbl() T { return t * 2 }

func main() {
	var T T = 4
	fmt.Println(T.Dbl())
}
`,
		"8\n",
	);
});

test("parameter named after its type calls static methods", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T int

func (t T) Dbl() T { return t * 2 }

func g(T T) int { return int(T.Dbl()) }

func main() {
	fmt.Println(g(5))
}
`,
		"10\n",
	);
});

test("local struct named after its struct type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type R struct{ N int }

func (r R) M() int { return r.N + 1 }

func main() {
	var R R
	R.N = 4
	fmt.Println(R.M())
	var a any = R
	_, ok := a.(struct{ N int })
	fmt.Println(ok)
}
`,
		"5\nfalse\n",
	);
});

test("type switch binding and named result named after a type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T int

func (t T) Dbl() T { return t * 2 }

func f(x any) T {
	switch T := x.(type) {
	case T:
		return T.Dbl()
	}
	return 0
}

func h() (T T) {
	T = 6
	return T.Dbl()
}

func main() {
	fmt.Println(f(T(4)), h())
}
`,
		"8 12\n",
	);
});

test("a variable named after a defined struct type without methods", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Base struct{ X int }
type Sub Base

func main() {
	var Sub Sub
	Sub.X = 7
	fmt.Println(Sub.X)
}
`,
		"7\n",
	);
});

// ── Predeclared names shadowed by user declarations ──────────

const prog = (body) => `package main\n\nimport "fmt"\n\n${body}\n`;

test("a local type named error does not leak to other functions", async () => {
	await assertAllTargetsOutput(
		prog(`type MyErr struct{ Msg string }

func (MyErr) Error() string { return "e" }

func f1() {
	type error struct{ Msg string }
	_ = error{}
}

func f2() error { return MyErr{} }

func main() { fmt.Println(f2()) }`),
		"e\n",
	);
});

test("nested local types of one name keep their own scope", async () => {
	await assertAllTargetsOutput(
		prog(`type int32 = string

func main() {
	var a int32 = "hi"
	{
		type int32 = bool
		var b int32 = true
		_ = b
	}
	var c int32 = a
	fmt.Println(c)
}`),
		"hi\n",
	);
});

test("a package-level type int32 shadows the predeclared type", async () => {
	await assertAllTargetsOutput(
		prog(`type int32 = string

func main() {
	var x int32 = "a"
	fmt.Println(x)
}`),
		"a\n",
	);
});

test("a package-level type any shadows the predeclared alias", async () => {
	await assertAllTargetsOutput(
		prog(`type any = int

func main() {
	var x any = 3
	fmt.Println(x + 1)
}`),
		"4\n",
	);
});

test("a package-level type error prints through fmt.Println", async () => {
	await assertAllTargetsOutput(
		prog(`type error int

func main() {
	var e error = 3
	fmt.Println(e)
}`),
		"3\n",
	);
});

test("a package-level type error with fmt.Print compiles on every target", async () => {
	await assertAllTargetsOutput(
		prog(`type error int

func main() {
	var e error = 3
	_ = e
	fmt.Print("")
}`),
		"",
	);
});

test("an error-returning stdlib call still works next to a package-level type error", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"strconv"
)

type error int

func main() {
	var e error = 3
	_, err := strconv.Atoi("x")
	fmt.Println(e, err != nil)
	if err != nil {
		fmt.Println(err.Error())
	}
}
`,
		'3 true\nstrconv.Atoi: parsing "x": invalid syntax\n',
	);
});

test("a local type any = int still works", async () => {
	await assertAllTargetsOutput(
		prog(`func main() {
	type any = int
	var x any = 3
	fmt.Println(x + 1)
}`),
		"4\n",
	);
});

test("func len shadows the builtin", async () => {
	await assertAllTargetsOutput(
		prog(`func len() int { return 1 }

func main() { fmt.Println(len()) }`),
		"1\n",
	);
});

test("a local len closure shadows the builtin", async () => {
	await assertAllTargetsOutput(
		prog(`func main() {
	len := func() int { return 1 }
	fmt.Println(len())
}`),
		"1\n",
	);
});

test("func max shadows the builtin", async () => {
	await assertAllTargetsOutput(
		prog(`func max(a, b int) int { return a }

func main() { fmt.Println(max(1, 2)) }`),
		"1\n",
	);
});

test("func append shadows the builtin", async () => {
	await assertAllTargetsOutput(
		prog(`func append(x int) int { return x + 1 }

func main() { fmt.Println(append(1)) }`),
		"2\n",
	);
});

test("func println shadows the builtin", async () => {
	await assertAllTargetsOutput(
		`package main

func println(s string) {}

func main() { println("x") }
`,
		"",
	);
});

test("parameter len and locals named copy and new are plain values", async () => {
	await assertAllTargetsOutput(
		prog(`func f(len int) int { return len + 1 }

func main() {
	copy := 5
	new := 2
	fmt.Println(f(1), copy, new)
}`),
		"2 5 2\n",
	);
});

// ── Defined package-level types named after predeclared types ──

test("a defined type int32 string prints with %T and %v", async () => {
	await assertAllTargetsOutput(
		prog(`type int32 string

func main() {
	var x int32 = "hi"
	fmt.Printf("%T %v\\n", x, x)
}`),
		"main.int32 hi\n",
	);
});

test("a defined type int32 int supports arithmetic and printing", async () => {
	await assertAllTargetsOutput(
		prog(`type int32 int

func main() {
	var v int32 = 7
	fmt.Println(v + 1)
}`),
		"8\n",
	);
});

test("a defined struct type any prints its fields", async () => {
	await assertAllTargetsOutput(
		prog(`type any struct{ X int }

func main() {
	v := any{X: 7}
	fmt.Println(v)
}`),
		"{7}\n",
	);
});

test("a defined type int32 works as a struct field under json.Marshal", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type int32 string

type S struct{ X int32 }

func main() {
	b, _ := json.Marshal(S{X: "hi"})
	fmt.Println(string(b))
}
`,
		'{"X":"hi"}\n',
	);
});

test("a defined type int32 as a function result", async () => {
	await assertAllTargetsOutput(
		prog(`type int32 string

func f() int32 { return "ok" }

func main() { fmt.Println(f()) }`),
		"ok\n",
	);
});

test("a package-level type comparable shadows the predeclared constraint", async () => {
	await assertAllTargetsOutput(
		prog(`type comparable = int

func main() {
	var x comparable = 7
	fmt.Println(x + 1)
}`),
		"8\n",
	);
});

test("a local type comparable shadows the predeclared constraint", async () => {
	await assertAllTargetsOutput(
		prog(`func main() {
	type comparable = int
	var x comparable = 7
	fmt.Println(x + 1)
}`),
		"8\n",
	);
});

// ── Calls to user declarations spelled like builtins ─────────

test("a user len in an index expression is an ordinary call", async () => {
	await assertAllTargetsOutput(
		prog(`func len() int { return 1 }

func main() {
	xs := []int{10, 20, 30}
	fmt.Println(xs[len()])
}`),
		"20\n",
	);
});

test("a user len as a loop bound is an ordinary call", async () => {
	await assertAllTargetsOutput(
		prog(`func len() int { return 3 }

func main() {
	xs := []int{1, 2, 3, 4, 5}
	s := 0
	for i := 0; i < len(); i++ {
		s += xs[i]
	}
	fmt.Println(s)
}`),
		"6\n",
	);
});

test("a user panic does not terminate a function", () => {
	const { errors } = compile(
		prog(`func panic() {}

func f() int { panic() }

func main() { fmt.Println(f()) }`),
	);
	assertErrorContains(errors, "missing return");
});

test("a user println that recovers catches a deferred panic", async () => {
	await assertAllTargetsOutput(
		prog(`func println() { _ = recover() }

func f() {
	defer println()
	panic("boom")
}

func main() {
	f()
	fmt.Println("done")
}`),
		"done\n",
	);
});

test("a user panic statement is not a terminating builtin in JS output", async () => {
	await assertAllTargetsOutput(
		prog(`func panic(s string) { fmt.Println("p", s) }

func main() {
	xs := []int{1}
	i := 0
	panic("a")
	fmt.Println(xs[i])
}`),
		"p a\n1\n",
	);
});

test("deferred builtins are called directly, not hoisted into a variable", async () => {
	await assertAllTargetsOutput(
		prog(`func main() {
	m := map[string]int{"a": 1}
	defer fmt.Println(len(m))
	defer delete(m, "a")
}`),
		"1\n",
	);
	await assertAllTargetsOutput(
		prog(`func f() (s string) {
	defer func() { s = fmt.Sprint(recover()) }()
	defer panic("boom")
	return "no"
}

func main() { fmt.Println(f()) }`),
		"boom\n",
	);
});

test("true, false and nil can be declared as locals", async () => {
	await assertAllTargetsOutput(
		prog(`func main() {
	true := 1
	fmt.Println(true)
	nil := 2
	fmt.Println(nil)
	false := "f"
	fmt.Println(false)
}`),
		"1\n2\nf\n",
	);
});

test("true, false and nil keep their universe meaning without a declaration", async () => {
	await assertAllTargetsOutput(
		prog(`func main() {
	x := true
	var y error = nil
	var z *int = nil
	fmt.Println(x, false, y == nil, z == nil)
	switch v := any(1).(type) {
	case nil:
		fmt.Println("nil", v)
	default:
		fmt.Println("other")
	}
}`),
		"true false true true\nother\n",
	);
});

test("a local true does not leak to the next function", async () => {
	await assertAllTargetsOutput(
		prog(`func f() int {
	true := 5
	return true
}

func main() {
	fmt.Println(f(), true)
}`),
		"5 true\n",
	);
});

test("every declaration form accepts true, false and nil", async () => {
	await assertAllTargetsOutput(
		prog(`type S struct{ nil int }

func f(false int) int { return false }

var true = 5

const nil = 7

func main() {
	s := S{nil: 3}
	fmt.Println(f(4), true, nil, s.nil)
	n := 0
	for nil := range 2 {
		n += nil + 10
	}
	fmt.Println(n)
}`),
		"4 5 7 3\n21\n",
	);
});

test("a local type named true or false is mangled and does not leak", async () => {
	for (const n of ["true", "false"])
		await assertAllTargetsOutput(
			prog(`func f() int {
	type ${n} int
	var x ${n} = 7
	{
		type ${n} string
		var y ${n} = "s"
		_ = y
	}
	return int(x)
}

func main() { fmt.Println(f(), ${n}) }`),
			`7 ${n}\n`,
		);
});

test("a local type named nil does not break nil", async () => {
	for (const decl of ["type nil int", "type nil = int"])
		await assertAllTargetsOutput(
			prog(`func f() int {
	${decl}
	var x nil = 1
	return int(x)
}

func main() {
	var p *int = nil
	fmt.Println(f(), p == nil)
}`),
			"1 true\n",
		);
});

test("a package-level type named nil keeps generated code working", async () => {
	await assertAllTargetsOutput(
		prog(`type nil struct{ X int }

func main() {
	v := nil{X: 7}
	fmt.Println(v, []int{1, 2})
}`),
		"{7} [1 2]\n",
	);
});

test("array lengths of unshadowed true, false and nil are non-integer constants", () => {
	const cases = [
		[
			"const a = true\ntype A [a]int",
			"invalid array length a (bool constant): must be integer",
		],
		[
			"type A [true]int",
			"invalid array length true (bool constant): must be integer",
		],
		["type A [true == true]int", "(bool constant): must be integer"],
		[
			"type A [nil]int",
			"invalid array length nil (untyped nil): must be integer",
		],
	];
	for (const [decl, msg] of cases) {
		const { errors } = compile(`package main\n${decl}\nfunc main() {}\n`, {
			target: "js",
		});
		assertErrorContains(errors, msg);
	}
});

test("nil in a type assertion or type switch honours a declared nil", async () => {
	await assertAllTargetsOutput(
		prog(`type nil int

func main() {
	var v any = nil(5)
	x, ok := v.(nil)
	fmt.Println(x, ok)
}`),
		"5 true\n",
	);
	await assertAllTargetsOutput(
		prog(`type nil int

func main() {
	switch x := any(nil(3)).(type) {
	case nil:
		fmt.Println("matched nil type:", x)
	}
}`),
		"matched nil type: 3\n",
	);
	await assertAllTargetsOutput(
		prog(`type nil interface{ M() }
type S struct{}

func (S) M() {}

func main() {
	switch x := any(S{}).(type) {
	case nil:
		x.M()
		fmt.Println("matched")
	}
}`),
		"matched\n",
	);
	const { errors } = compile(
		prog(`func main() {
	nil := 1
	fmt.Println(nil)
	switch any(1).(type) {
	case nil:
	}
}`),
		{ target: "js" },
	);
	assertErrorContains(errors, "Unknown type 'nil'");
});

test("labels and branches named true or false compile", async () => {
	await assertAllTargetsOutput(
		prog(`func main() {
true:
	for {
		break true
	}
false:
	for i := 0; i < 2; i++ {
		continue false
	}
	fmt.Println("ok")
}`),
		"ok\n",
	);
});

for (const target of ["js", "wasm"]) {
	test(`a local type does not change a dot-imported variable of the same name (${target})`, async () => {
		const { mod } = await compileHybridProject(
			{
				"dot/d.go": `//gofront:target ${target}
package dot

var Q int = 4
`,
				"main.go": `package main

import . "./dot"

func Main() int {
	type Q struct{ X int }
	q := Q{X: 3}
	return q.X
}

func Outer() int { return Q + 1 }
`,
			},
			{ exports: ["Main", "Outer"] },
		);
		assertEqual(mod.Main(), 3);
		assertEqual(mod.Outer(), 5);
	});
}

test("a block-scoped type is unknown outside its block, a function-local one outside its function", () => {
	for (const body of [
		"func f() { type Q struct{ X int }; _ = Q{} }\nfunc main() { var q Q; _ = q }",
		"func main() { { type Q int; _ = Q(1) }; var q Q; _ = q }",
	]) {
		const { errors } = compile(`package main\n${body}\n`, { target: "js" });
		assertErrorContains(errors, "Unknown type 'Q'");
	}
});

test("each block and function keeps its own type of the same name", async () => {
	await assertAllTargetsOutput(
		prog(`type Q string
func a() {
	type Q struct{ X int }
	fmt.Println(Q{1})
}
func main() {
	a()
	{
		type Q float64
		fmt.Println(Q(2.5))
	}
	var q Q = "pkg"
	fmt.Println(q)
}`),
		"{1}\n2.5\npkg\n",
	);
});
