// test/unit/wasm/variadic.test.js
// Variadic functions in WASM: the parameter is a slice inside the body, calls
// pack their trailing arguments, and `f(s...)` passes the slice through.

import {
	assertContains,
	assertEqual,
	assertErrorContains,
	assertProgramOutput,
	compileDir,
	compileHybrid,
	compileHybridProject,
	compileWasm,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("WASM Variadic Functions");

test("variadic call packs arguments; len, index and range see a slice", () => {
	const src = `//gofront:target both
package main

func sum(xs ...int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t*100 + len(xs)*10 + xs[0]
}

func Main() int { return sum(1, 2, 3) }
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 631);
	assertEqual(jsRes, Number(wasmRes));
});

test("no trailing arguments, a spread slice, and leading fixed parameters", () => {
	const src = `//gofront:target both
package main

import "strings"

func join(sep string, parts ...string) string {
	return strings.Join(parts, sep) + "|" + string(rune('0'+len(parts)))
}

func Main() string {
	s := []string{"a", "b"}
	return join(",") + " " + join("-", s...) + " " + join("+", "x", "y", "z")
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "|0 a-b|2 x+y+z|3");
	assertEqual(jsRes, wasmRes);
});

test("variadic methods, closures and func values", () => {
	const src = `//gofront:target both
package main

type Acc struct{ n int }

func (a *Acc) Add(xs ...int) {
	for _, x := range xs {
		a.n += x
	}
}

func apply(f func(...int) int, xs ...int) int { return f(xs...) }

func Main() int {
	a := &Acc{}
	a.Add(1, 2)
	a.Add()
	count := func(xs ...int) int { return len(xs) }
	return a.n*100 + count(7, 8, 9)*10 + apply(count, 1, 2)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 332);
	assertEqual(jsRes, Number(wasmRes));
});

test("variadic interface method", () => {
	const src = `//gofront:target both
package main

type Summer interface{ Sum(xs ...int) int }

type S struct{}

func (S) Sum(xs ...int) int { return len(xs) }

func Main() int {
	var s Summer = S{}
	return s.Sum(1, 2, 3)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 3);
	assertEqual(jsRes, Number(wasmRes));
});

test("generic variadic function", () => {
	const src = `//gofront:target both
package main

func count[T any](xs ...T) int { return len(xs) }

func Main() int { return count("a", "b")*10 + count(1.5) }
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(Number(wasmRes), 21);
	assertEqual(jsRes, Number(wasmRes));
});

test("exported variadic wasm function called from JS through the facade", async () => {
	const res = await compileHybridProject({
		"lib/lib.go": `//gofront:target wasm
package lib

func Sum(xs ...int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t
}
`,
		"main.go": `package main

import "./lib"

func main() {
	s := []int{4, 5}
	println(lib.Sum(1, 2, 3), lib.Sum(), lib.Sum(s...))
}
`,
	});
	assertEqual(res.lines.join("\n"), "6 0 9");
});

test("linking app.wasm does not rewrite the cached ASTs used for JS", () => {
	withTempDir(
		{
			"lib/lib.go": `//gofront:target both
package lib

func Count[T any](xs ...T) int { return len(xs) }
`,
			"main.go": `//gofront:target wasm
package main

import "./lib"

func Main() int { return lib.Count(1, 2) }
`,
		},
		(dir) => {
			const first = compileDir(dir);
			const second = compileDir(dir);
			assertEqual(second.js, first.js);
		},
	);
});

test("a variadic func value may not cross the JS boundary", async () => {
	let msg = "";
	try {
		await compileHybridProject({
			"lib/lib.go": `//gofront:target wasm
package lib

func Call(f func(xs ...int) int) int { return f(1, 2, 3) }
`,
			"main.go": `package main

import "./lib"

func main() { println(lib.Call(func(xs ...int) int { return len(xs) })) }
`,
		});
	} catch (e) {
		msg = e.message;
	}
	assertContains(msg, "variadic func value is not yet supported");
});

test("multiple return values into a variadic call are rejected in wasm", () => {
	const { errors } = compileWasm(`//gofront:target both
package main

func g() (int, int) { return 3, 4 }

func f(xs ...int) int { return len(xs) }

func Main() int { return f(g()) }
`);
	assertErrorContains(
		errors,
		"passing multiple return values to a variadic function is not supported",
	);
});

test("multiple return values into another package's variadic call are rejected", async () => {
	let msg = "";
	try {
		await compileHybridProject({
			"lib/lib.go": `//gofront:target wasm
package lib

func F(xs ...int) int { return len(xs) }
`,
			"w/w.go": `//gofront:target wasm
package w

import "../lib"

func g() (int, int) { return 3, 4 }

func Run() int { return lib.F(g()) }
`,
			"main.go": `package main

import "./w"

func main() { println(w.Run()) }
`,
		});
	} catch (e) {
		msg = e.message;
	}
	assertContains(
		msg,
		"passing multiple return values to a variadic function is not supported",
	);
});

test("f(nilSlice...) passes a nil parameter (P08)", () => {
	const res = compileHybrid(`package main

func sum(xs ...int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t + len(xs)
}

func Main() int {
	var n []int
	return sum(n...)
}
`).run("Main");
	assertEqual(res.jsRes, 0);
	assertEqual(Number(res.wasmRes), 0);
});

test("f(a...) shares the caller's slice, so writes reach it (P09)", () => {
	const res = compileHybrid(`package main

func set(xs ...int) { xs[0] = 9 }

type T struct{}

func (T) put(xs ...int) { xs[1] = 7 }

func Main() int {
	a := []int{1, 2}
	set(a...)
	T{}.put(a...)
	set(1, 2)
	return a[0]*10 + a[1]
}
`).run("Main");
	assertEqual(res.jsRes, 97);
	assertEqual(Number(res.wasmRes), 97);
});

test("individual variadic arguments still build a fresh slice; append spread unchanged", () => {
	const res = compileHybrid(`package main

func first(xs ...int) []int { xs[0] = 5; return xs }

func Main() int {
	a := []int{1, 2}
	b := first(a[0], a[1])
	ys := append([]int{3}, a...)
	return a[0]*1000 + b[0]*100 + len(ys)*10 + ys[1]
}
`).run("Main");
	assertEqual(res.jsRes, 1000 + 500 + 30 + 1);
	assertEqual(Number(res.wasmRes), 1531);
});

section("Variadic spread");

test("empty variadic call keeps an empty slice for stdlib helpers", async () => {
	const src = `package main

import (
	"fmt"
	"slices"
	"sort"
)

func has(x int, xs ...int) bool { return slices.Contains(xs, x) }
func idx(xs ...int) int        { sort.Ints(xs); return slices.Index(xs, 3) }
func keep(xs ...int) map[string][]int { return map[string][]int{"a": xs} }

func main() {
	fmt.Println(has(1), idx(), keep())
}
`;
	await assertProgramOutput(src, "false -1 map[a:[]]\n");
});

test("spread aliases the slice, nil spread and empty call are nil", async () => {
	const src = `package main

import "fmt"

func nilp(xs ...int) bool { return xs == nil }

func main() {
	a := []int{1, 2, 3}
	set := func(xs ...int) { xs[0] = -1 }
	set(a[1:]...)
	fmt.Println(a)
	var nx []int
	set2 := func(xs ...int) { fmt.Println(len(xs)) }
	set2(nx...)
	fmt.Println(nilp(), nilp(nx...), nilp(a...))
	b := []int{5, 6}
	f := func(xs ...int) { xs[1] = 9 }
	f(b...)
	fmt.Println(b)
}
`;
	await assertProgramOutput(src, "[1 -1 3]\n0\ntrue true false\n[5 9]\n");
});
