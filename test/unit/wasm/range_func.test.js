// test/unit/wasm/range_func.test.js
// Tests for Phase 0.2: Range-over-func in WASM (Go 1.23)

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	compileHybrid,
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
