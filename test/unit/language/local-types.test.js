// GoFront test suite — function-local types that share a name with a local value

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Local types — name shared with a local value");

test("a local value named like a local type is its own variable", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func a() {
	type Dup struct{ X int }
	Dup := 1
	fmt.Println(Dup)
}

func main() { a() }
`,
		"1\n",
	);
});

test("%T of a local type value keeps the Go name", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func a() {
	type Dup struct{ X int }
	d := Dup{}
	fmt.Println(fmt.Sprintf("%T", d))
	Dup := 1
	fmt.Println(Dup)
}

func b() {
	type Dup struct{ X int }
	fmt.Println(fmt.Sprintf("%T", Dup{}))
}

func main() { a(); b() }
`,
		"main.Dup\n1\nmain.Dup\n",
	);
});

test("value declared before the local type keeps both meanings", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func a() {
	Dup := 1
	fmt.Println(Dup)
	{
		type Dup struct{ X int }
		fmt.Println(fmt.Sprintf("%T", Dup{}))
	}
}

func main() { a() }
`,
		"1\nmain.Dup\n",
	);
});

test("a local value can be initialised from the type it shadows", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Dup struct{ X int }
	Dup := Dup{X: 42}
	fmt.Println(Dup.X)
}
`,
		"42\n",
	);
});

test("new of the shadowed local type in the shadowing declaration", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Dup struct{ X int }
	Dup := new(Dup)
	fmt.Println(Dup.X)
}
`,
		"0\n",
	);
});

test("conversion to the shadowed local type in the shadowing declaration", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type Dup int
	Dup := Dup(42)
	fmt.Println(Dup)
}
`,
		"42\n",
	);
});

for (const decl of ["type strings = int", "type strings int"]) {
	test(`a local \`${decl}\` does not hide the strings import`, async () => {
		await assertAllTargetsOutput(
			`package main

import (
	"fmt"
	"strings"
)

func other() int {
	${decl}
	var x strings = 3
	return int(x)
}

func main() { fmt.Println(other(), strings.ToUpper("ab")) }
`,
			"3 AB\n",
		);
	});
}

test("a local type named like an import works inside its own function", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"strings"
)

func other() string {
	type strings struct{ S string }
	v := strings{S: "q"}
	return v.S
}

func main() { fmt.Println(other(), strings.ToUpper("ab")) }
`,
		"q AB\n",
	);
});

test("a nested local alias of the same name keeps the outer one", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type T = string
	var a T = "hi"
	{
		type T = bool
		var b T = true
		_ = b
	}
	var c T = a
	fmt.Println(c)
}
`,
		"hi\n",
	);
});

test("a nested local defined type of the same name keeps the outer one", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	type T int
	var a T = 1
	if true {
		type T string
		var b T = "x"
		fmt.Print(b, " ")
	}
	fmt.Println(a)
}
`,
		"x 1\n",
	);
});

test("a local type is not renamed onto a sibling local value", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g() {
	type Q struct{ Y string }
	Q__L1 := 42
	fmt.Println(Q{"a"}.Y, Q__L1)
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	g()
	f()
}
`,
		"a 42\n1\n",
	);
});

test("a local type is not renamed onto a named result", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g() (Q__L1 int) {
	type Q struct{ Y string }
	fmt.Println(Q{"a"}.Y)
	return
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(g())
	f()
}
`,
		"a\n0\n1\n",
	);
});

test("a generic local type is not renamed onto a named result", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g[T any](v T) (Q__L1 int) {
	type Q struct{ X T }
	fmt.Println(Q{v}.X)
	return
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(g(5), g("hi"))
	f()
}
`,
		"5\nhi\n0 0\n1\n",
	);
});

test("a local type is not renamed onto a method's named result", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{}

func (S) g() (Q__L1 int) {
	type Q struct{ Y string }
	fmt.Println(Q{"a"}.Y)
	return
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(S{}.g())
	f()
}
`,
		"a\n0\n1\n",
	);
});

test("a local type is not renamed onto a func literal's named result", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g() int {
	h := func() (Q__L1 int) {
		type Q struct{ Y string }
		fmt.Println(Q{"a"}.Y)
		return
	}
	return h()
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(g())
	f()
}
`,
		"a\n0\n1\n",
	);
});

test("a generic func literal's local type is not renamed onto its named result", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g[T any](v T) int {
	h := func() (Q__L1 int) {
		type Q struct{ Y T }
		fmt.Println(Q{v}.Y)
		return
	}
	return h()
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(g(1), g("s"))
	f()
}
`,
		"1\ns\n0 0\n1\n",
	);
});

test("a local type is not renamed onto a used type parameter", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g[Q__L1 any](x Q__L1) Q__L1 {
	type Q struct{ Y Q__L1 }
	_ = Q{x}
	return x
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(g(42))
	f()
}
`,
		"42\n1\n",
	);
});

test("a local type is not renamed onto a type parameter beside another", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g[T any, Q__L1 any](v T, x Q__L1) {
	type Q struct{ Y T }
	fmt.Println(Q{v}.Y, x)
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	g(42, "ok")
	f()
}
`,
		"42 ok\n1\n",
	);
});

test("a local type is not renamed onto an unused type parameter", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g[Q__L1 any]() {
	type Q struct{ Y int }
	fmt.Println(Q{3}.Y)
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	g[int]()
	f()
}
`,
		"3\n1\n",
	);
});

test("a method's local type is not renamed onto its generic type's parameter", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Box[Q__L1 any] struct{ v Q__L1 }

func (b Box[Q__L1]) M() Q__L1 {
	type Q struct{ Y Q__L1 }
	return Q{b.v}.Y
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(Box[int]{3}.M())
	f()
}
`,
		"3\n1\n",
	);
});

test("a method's local type is not renamed onto an unused generic type parameter", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Box[Q__L1 any] struct{ v int }

func (b Box[_]) M() int {
	type Q struct{ Y int }
	return Q{b.v}.Y
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	fmt.Println(Box[string]{3}.M())
	f()
}
`,
		"3\n1\n",
	);
});

test("a local type is not renamed onto a type parameter used as a type argument", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Pair[A any, B any] struct {
	a A
	b B
}

func g[Q__L1 any](x Q__L1) {
	type Q struct{ Y int }
	p := Pair[Q__L1, int]{x, 1}
	fmt.Println(Q{3}.Y, p.a)
}

func f() {
	type Q struct{ X int }
	fmt.Println(Q{1}.X)
}

func main() {
	g("s")
	f()
}
`,
		"3 s\n1\n",
	);
});

test("a package type named after a predeclared type is not renamed onto a parameter", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type int32 string

func g(int32__L1 int) int32 { return int32("p") }

func main() { fmt.Println(g(1)) }
`,
		"p\n",
	);
});

test("a package type named after a predeclared type is not renamed onto a func", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type int32 string

func int32__L1() int { return 4 }

func main() {
	var s int32 = "a"
	fmt.Println(s, int32__L1())
}
`,
		"a 4\n",
	);
});

test("a renamed local type is renamed in composite literal keys", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g() {
	type Q struct{ X int }
	m := map[Q]int{Q{1}: 2}
	fmt.Println(m[Q{1}])
}

func f() {
	type Q struct{ Y string }
	m := map[Q]int{Q{"a"}: 3}
	fmt.Println(m[Q{"a"}])
}

func main() { g(); f() }
`,
		"2\n3\n",
	);
});

test("a renamed local type is renamed in conversion keys", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g() {
	type Q int
	m := map[Q]int{Q(1): 2}
	fmt.Println(m[Q(1)])
}

func f() {
	type Q string
	m := map[Q]int{Q("a"): 3}
	fmt.Println(m[Q("a")])
}

func main() { g(); f() }
`,
		"2\n3\n",
	);
});

test("a struct literal field named like a renamed local type keeps its name", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ Q int }

func g() {
	type Q struct{ X int }
	fmt.Println(T{Q: 5}.Q, Q{1}.X)
}

func f() {
	type Q struct{ Y string }
	fmt.Println(Q{"a"}.Y)
}

func main() { g(); f() }
`,
		"5 1\na\n",
	);
});

test("a package type named after a predeclared type is not renamed onto a generic receiver's type parameter", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type int32 string

type Box[int32 any] struct{ v int32 }

func (b Box[int32]) M() int32 { return b.v }

func main() {
	var s int32 = "hi"
	fmt.Println(s, Box[int]{3}.M())
}
`,
		"hi 3\n",
	);
});

test("a nested local type may share a generic function's type parameter name", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g[Q any](x Q) {
	{
		type Q struct{ Y int }
		fmt.Println(Q{1}.Y)
	}
	fmt.Println(x)
}

func main() { g("hi") }
`,
		"1\nhi\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
