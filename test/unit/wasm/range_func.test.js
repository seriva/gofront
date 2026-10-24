// test/unit/wasm/range_func.test.js
// Tests for Phase 0.2: Range-over-func in WASM (Go 1.23)

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertThrows,
	compileHybrid,
	compileHybridProject,
	runWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

// ── Task 0.2a — Basic correctness & yield signatures ─────────

section("Range-over-func WASM: basic iterator shapes");

test("range over 1-param iterator (Seq)", () => {
	const src = `
package main

func Main() int {
	sum := 0
	seq := func(yield func(int) bool) {
		yield(10)
		yield(20)
		yield(30)
	}
	for v := range seq {
		sum += v
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 60n);
	assertEqual(res.jsRes, 60);
});

test("range over 0-param iterator", () => {
	const src = `
package main

func Main() int {
	count := 0
	seq := func(yield func() bool) {
		yield()
		yield()
		yield()
	}
	for range seq {
		count++
	}
	return count
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 3n);
	assertEqual(res.jsRes, 3);
});

test("range over 2-param iterator (Seq2)", () => {
	const src = `
package main

func Main() int {
	total := 0
	seq2 := func(yield func(int, int) bool) {
		yield(1, 10)
		yield(2, 20)
		yield(3, 30)
	}
	for k, v := range seq2 {
		total += k * v
	}
	return total
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 140n);
	assertEqual(res.jsRes, 140);
});

test("range over slice elements with Seq2", () => {
	const src = `
package main

func Main() int {
	xs := []int{5, 15, 25}
	all := func(yield func(int, int) bool) {
		for i := 0; i < len(xs); i++ {
			if !yield(i, xs[i]) {
				return
			}
		}
	}
	sum := 0
	for i, v := range all {
		sum += (i + 1) * v
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 110n);
	assertEqual(res.jsRes, 110);
});

test("range over factory function returning iterator", () => {
	const src = `
package main

func Counter(n int) func(yield func(int) bool) {
	return func(yield func(int) bool) {
		for i := 1; i <= n; i++ {
			if !yield(i) {
				return
			}
		}
	}
}

func Main() int {
	sum := 0
	for v := range Counter(5) {
		sum += v
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 15n);
	assertEqual(res.jsRes, 15);
});

test("blank identifier _ in Seq2", () => {
	const src = `
package main

func Main() int {
	iter := func(yield func(int, int) bool) {
		yield(10, 100)
		yield(20, 200)
		yield(30, 300)
	}
	sum := 0
	for _, v := range iter {
		sum += v
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 600n);
	assertEqual(res.jsRes, 600);
});

test("assign form (without :=) in range iterator", () => {
	const src = `
package main

func Main() int {
	iter := func(yield func(int) bool) {
		yield(10)
		yield(20)
		yield(30)
	}
	v := 0
	for v = range iter {
	}
	return v
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 30n);
	assertEqual(res.jsRes, 30);
});

// ── Task 0.2a — Break and Continue ──────────────────────────

section("Range-over-func WASM: break and continue");

test("plain break stops iterator", () => {
	const src = `
package main

func Main() int {
	count := 0
	iter := func(yield func(int) bool) {
		for i := 1; i <= 100; i++ {
			if !yield(i) {
				return
			}
		}
	}
	sum := 0
	for v := range iter {
		count++
		if v == 3 {
			break
		}
		sum += v
	}
	return sum*1000 + count
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 3003n);
	assertEqual(res.jsRes, 3003);
});

test("plain continue skips body but continues iterator", () => {
	const src = `
package main

func Main() int {
	iter := func(yield func(int) bool) {
		for i := 1; i <= 6; i++ {
			if !yield(i) {
				return
			}
		}
	}
	sum := 0
	for v := range iter {
		if v%2 != 0 {
			continue
		}
		sum += v
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 12n);
	assertEqual(res.jsRes, 12);
});

test("break in inner loop does not break outer iterator loop", () => {
	const src = `
package main

func Main() int {
	outer := func(yield func(int) bool) {
		yield(1)
		yield(2)
		yield(3)
	}
	inner := func(yield func(int) bool) {
		for i := 10; i <= 50; i += 10 {
			if !yield(i) {
				return
			}
		}
	}
	total := 0
	for a := range outer {
		for b := range inner {
			if b == 30 {
				break
			}
			total += a * b
		}
	}
	return total
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 180n);
	assertEqual(res.jsRes, 180);
});

test("zero-element iterator never executes body", () => {
	const src = `
package main

func Main() int {
	iter := func(yield func(int) bool) {}
	ran := 0
	for v := range iter {
		_ = v
		ran = 1
	}
	return ran
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 0n);
	assertEqual(res.jsRes, 0);
});

// ── Task 0.2b — Labels, Return, Defer, Panic, Re-yield ────────

section("Range-over-func WASM: Task 0.2b edge cases");

test("labeled continue outer crosses yield closure", () => {
	const src = `
package main

func Main() int {
	sum := 0
Outer:
	for i := 0; i < 3; i++ {
		iter := func(yield func(int) bool) {
			if !yield(1) { return }
			if !yield(2) { return }
			if !yield(3) { return }
		}
		for v := range iter {
			if v == 2 {
				continue Outer
			}
			sum += v
		}
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 3n);
	assertEqual(res.jsRes, 3);
});

test("labeled break outer crosses yield closure", () => {
	const src = `
package main

func Main() int {
	sum := 0
Outer:
	for i := 0; i < 5; i++ {
		iter := func(yield func(int) bool) {
			if !yield(10) { return }
			if !yield(20) { return }
			if !yield(30) { return }
		}
		for v := range iter {
			if i == 1 && v == 20 {
				break Outer
			}
			sum += v
		}
	}
	return sum
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 70n);
	assertEqual(res.jsRes, 70);
});

test("return from iterator body returns from enclosing function", () => {
	const src = `
package main

func Find() int {
	iter := func(yield func(int) bool) {
		if !yield(10) { return }
		if !yield(20) { return }
		if !yield(30) { return }
	}
	for v := range iter {
		if v == 20 {
			return 200
		}
	}
	return 0
}

func Main() int {
	return Find()
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 200n);
	assertEqual(res.jsRes, 200);
});

test("defer in enclosing function runs once on return from iterator body", () => {
	const src = `
package main

func Find(log *int) int {
	defer func() {
		*log += 1
	}()
	iter := func(yield func(int) bool) {
		if !yield(10) { return }
		if !yield(20) { return }
		if !yield(30) { return }
	}
	for v := range iter {
		if v == 20 {
			return 200
		}
	}
	return 0
}

func Main() int {
	log := 0
	res := Find(&log)
	return res + log
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 201n);
	assertEqual(res.jsRes, 201);
});

test("panic in iterator body propagates through iterator to recover in enclosing function", () => {
	const src = `
package main

func Main() (recovered int) {
	defer func() {
		if r := recover(); r != nil {
			recovered = 1
		}
	}()
	iter := func(yield func(int) bool) {
		yield(1)
	}
	for v := range iter {
		if v == 1 {
			panic("boom")
		}
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("re-yield after body returned false panics with Go message", () => {
	const src = `
package main

func Main() {
	iter := func(yield func(int) bool) {
		yield(1)
		yield(2)
	}
	for v := range iter {
		if v == 1 {
			break
		}
	}
}
`;
	const hybrid = compileHybrid(src);
	assertThrows(() => {
		const { wasm, stringTable } = hybrid;
		runWasm(wasm, { stringTable }).exports.Main();
	}, "range function continued iteration after function for loop body returned false");
	hybrid.run("Main");
});

test("Seq2 with struct values copies values", () => {
	const src = `
package main

type Point struct { X int }

func Main() int {
	pt := Point{X: 10}
	iter := func(yield func(int, Point) bool) {
		yield(1, pt)
	}
	for _, p := range iter {
		p.X = 99
	}
	return pt.X
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 10n);
	assertEqual(res.jsRes, 10);
});

section("Range-over-func leftovers (Task 0.36)");

test("ranging directly over a func literal (P46)", () => {
	const src = `
package main

func Main() int {
	sum := 0
	k := 1
	for v := range func(yield func(int) bool) {
		yield(1)
		yield(1 + k)
	} {
		sum += v
	}
	return sum
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 3n);
	assertEqual(res.jsRes, 3);
});

test("iterator yielding a pointer to a struct (P47)", () => {
	const src = `
package main

type P struct{ A int }

func it(yield func(*P) bool) {
	p := &P{3}
	if !yield(p) {
		return
	}
	yield(&P{4})
}

func Main() int {
	s := 0
	for p := range it {
		s += p.A
	}
	return s
}
`;
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, 7n);
	assertEqual(res.jsRes, 7);
});

test("slices.Values over a slice of a generic struct (P40)", async () => {
	const res = await compileHybridProject({
		"lib/lib.go": `//gofront:target wasm
package lib

import "slices"

type Box[T any] struct{ V T }

func Run() int {
	bs := []Box[int]{{1}, {2}}
	s := 0
	for b := range slices.Values(bs) {
		s += b.V
	}
	return s
}
`,
		"main.go": `package main

import "./lib"

func main() { println(lib.Run()) }
`,
	});
	assertEqual(res.lines.join("\n"), "3");
});

test("range over a func literal inside a package-level initializer", () => {
	const src = `
package main

var f = func() int {
	t := 0
	for v := range func(y func(int) bool) {
		y(1)
		y(2)
	} {
		t += v
	}
	return t
}

func Main() int { return f() }
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 3n);
	assertEqual(jsRes, 3);
});

test("range over a named iterator inside a package-level initializer", () => {
	const src = `
package main

func it(y func(int) bool) {
	y(1)
	y(2)
}

var f = func() int {
	t := 0
	for v := range it {
		t += v
	}
	return t
}

func Main() int { return f() }
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 3n);
	assertEqual(jsRes, 3);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
