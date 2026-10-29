// test/unit/language/init-order.test.js
// Package variable initialisation order, shadowing and initialisation cycles.

import {
	assertContains,
	assertErrorContains,
	assertProgramOutput,
	compile,
	section,
	test,
} from "../helpers.js";

const prog = (decls, main) =>
	`package main\n\nimport "fmt"\n\n${decls}\n\nfunc main() {\n${main}\n}\n`;

section("Init order — shadowing is not a reference");

test("a func literal's parameter, local, range, type-switch and label names may repeat the variable", async () => {
	await assertProgramOutput(
		prog(
			`var handler = func(handler int) int { return handler + 1 }
var count = func() int { count := 3; return count }()
var blk = func() int { var blk = 2; return blk }()
var rng = func() int {
	t := 0
	for _, rng := range []int{1, 2} {
		t += rng
	}
	return t
}()
var ts = func(v any) int {
	switch ts := v.(type) {
	case int:
		return ts
	}
	return 0
}(5)
var lb = func() int {
lb:
	for {
		break lb
	}
	return 6
}()
var clo = func() int {
	return func(clo int) int { return clo * 2 }(7)
}()`,
			`fmt.Println(handler(2), count, blk, rng, ts, lb, clo)`,
		),
		"3 3 2 3 5 6 14\n",
	);
});

test("a function's or method's own parameters, results and locals may repeat a variable name", async () => {
	await assertProgramOutput(
		prog(
			`type T struct{}

func (late T) M(p int) (q int) { q = p + 1; return }
func f(a int) int  { b := a; return b }
func g() (a int)   { a = 5; return }

var a = f(1) + g() + T{}.M(2)
var late = 9`,
			`fmt.Println(a, late)`,
		),
		"9 9\n",
	);
});

test("a name used only as a struct literal field is not a reference", async () => {
	await assertProgramOutput(
		prog(
			`type T struct{ f, name int }

var f = T{f: 1, name: 2}
var name = f`,
			`fmt.Println(f, name)`,
		),
		"{1 2} {1 2}\n",
	);
});

section("Init order — true cycles are rejected");

test("cycles through functions, methods, closures and themselves are reported with a position and the chain", () => {
	const cases = [
		[
			"var a = f()\nfunc f() int { return a }",
			"initialization cycle for a: a refers to f refers to a",
			"line 4:5",
		],
		[
			"var x int = x + 1",
			"initialization cycle: x refers to itself",
			"line 4:5",
		],
		[
			"var a = func() int { return b }()\nvar b = a",
			"a refers to b refers to a",
			"line 4:5",
		],
		[
			"type T struct{}\nfunc (T) M() int { return a }\nvar a = T{}.M()",
			"a refers to T.M refers to a",
			"line 6:5",
		],
		[
			"var h = func(n int) int { return h(n) }",
			"initialization cycle: h refers to itself",
			"line 4:5",
		],
	];
	for (const [decls, msg, at] of cases) {
		for (const target of ["js", "wasm"]) {
			const { errors } = compile(
				`//gofront:target ${target}\npackage main\n\n${decls}\n\nfunc main() { println(1) }\n`,
			);
			assertErrorContains(errors, msg);
			assertErrorContains(errors, at);
		}
	}
});

test("a shadowed name inside a func literal does not hide a real cycle through another variable", () => {
	const { errors } = compile(
		`package main\n\nvar a = func(x int) int { return b + x }(1)\nvar b = a\n\nfunc main() { println(1) }\n`,
	);
	assertErrorContains(errors, "a refers to b refers to a");
});

section("Init order — map keys, promoted methods");

test("a map literal key naming a later variable is initialised first; a struct field key is not a reference", async () => {
	await assertProgramOutput(
		prog(
			`type T struct{ k int }

var m = map[string]int{k: 1}
var k = key()
var s = T{k: 7}
var arr = [2]int{idx: 5}
const idx = 1

func key() string { return "a" }`,
			`fmt.Println(m, s, arr, k)`,
		),
		"map[a:1] {7} [0 5] a\n",
	);
});

test("a struct field key repeating the variable it initialises is not a cycle", async () => {
	await assertProgramOutput(
		prog(`type T struct{ k int }\n\nvar k = T{k: 3}`, `fmt.Println(k)`),
		"{3}\n",
	);
});

test("a method promoted from an embedded type, value or pointer, is followed", async () => {
	await assertProgramOutput(
		prog(
			`type Base struct{}

func (Base) Hello() int { return late }

type PBase struct{}

func (*PBase) PH() int { return late2 }

type E struct{ Base }
type PE struct{ *PBase }

var emb = E{}.Hello()
var viaPtr = PE{&PBase{}}.PH()
var late = 42
var late2 = 43`,
			`fmt.Println(emb, viaPtr)`,
		),
		"42 43\n",
	);
});

test("method values and method expressions are followed", async () => {
	await assertProgramOutput(
		prog(
			`type Base struct{}

func (Base) Hello() int { return late }

type E struct{ Base }

var mv = E{}.Hello
var viaValue = mv()
var viaExpr = E.Hello(E{})
var late = 42`,
			`fmt.Println(viaValue, viaExpr)`,
		),
		"42 42\n",
	);
});

test("a generic type's method is followed", async () => {
	await assertProgramOutput(
		prog(
			`type Box[T any] struct{ v T }

func (b Box[T]) Get() int { return late }

var g = Box[int]{}.Get()
var late = 5`,
			`fmt.Println(g)`,
		),
		"5\n",
	);
});

test("a call through an interface adds no dependency, so it cannot form a cycle", async () => {
	await assertProgramOutput(
		prog(
			`type I interface{ M() int }
type Impl struct{}

func (Impl) M() int {
	if false {
		return u
	}
	return 1
}

var i I = Impl{}
var u = i.M()`,
			`fmt.Println(u)`,
		),
		"1\n",
	);
});

test("a promoted method that closes a cycle is reported", () => {
	const { errors } = compile(
		`package main\n\ntype Base struct{}\n\nfunc (Base) M() int { return a }\n\ntype E struct{ Base }\n\nvar a = E{}.M()\n\nfunc main() { println(1) }\n`,
	);
	assertContains(
		errors.map((e) => e.message).join("\n"),
		"initialization cycle",
	);
});
