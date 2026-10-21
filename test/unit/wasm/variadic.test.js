// test/unit/wasm/variadic.test.js
// Variadic functions in WASM: the parameter is a slice inside the body, calls
// pack their trailing arguments, and `f(s...)` passes the slice through.

import {
	assertContains,
	assertEqual,
	assertErrorContains,
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
