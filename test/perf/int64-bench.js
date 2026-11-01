// test/perf/int64-bench.js
// Measures performance ratio of int64 (BigInt) vs int (Number) in JS hot loops (Task 1.6).

import assert from "node:assert";
import { performance } from "node:perf_hooks";
import { compile } from "../unit/helpers.js";

const src = `package main

func BenchmarkInt(n int) int {
	s := 1
	for i := 0; i < n; i++ {
		s = s * 3 + i
	}
	return s
}

func BenchmarkInt64(n int) int64 {
	var s int64 = 1
	for i := 0; i < n; i++ {
		s = s * 3 + int64(i)
	}
	return s
}

func main() {}
`;

const { js, errors } = compile(src);
assert.strictEqual(errors.length, 0, "Compilation should have no errors");

const fn = new Function(`${js}; return { BenchmarkInt, BenchmarkInt64 };`);
const { BenchmarkInt, BenchmarkInt64 } = fn();

// Warmup
BenchmarkInt(100_000);
BenchmarkInt64(100_000);

const N = 10_000_000;
const t0 = performance.now();
BenchmarkInt(N);
const t1 = performance.now();
BenchmarkInt64(N);
const t2 = performance.now();

const intMs = t1 - t0;
const int64Ms = t2 - t1;
const ratio = int64Ms / intMs;

console.log(
	`int64-bench: int=${intMs.toFixed(2)}ms, int64=${int64Ms.toFixed(2)}ms, ratio=${ratio.toFixed(2)}x`,
);

assert(
	ratio <= 25,
	`int64 performance ratio ${ratio.toFixed(2)}x exceeds 25x bound`,
);
