// test/perf/stdlib-bench.js
// Sorting from the Go-source standard library (Task 4.3, Task 4.4):
//   - WASM `slices.Sort` of 200,000 ints
//   - JS `slices.SortFunc` and `sort.Slice` against `Array.prototype.sort`
//     with a comparator
// Run with `node test/perf/stdlib-bench.js`.

import assert from "node:assert";
import { performance } from "node:perf_hooks";
import { compile, compileWasm, runWasm } from "../unit/helpers.js";

const N = 200_000;

const src = `package main

import (
	"slices"
	"sort"
)

func fill(n int) []int {
	xs := make([]int, n)
	s := 12345
	for i := range xs {
		s = (s*48271 + 12345) % 2147483647
		xs[i] = s
	}
	return xs
}

func SortInts(n int) int {
	xs := fill(n)
	slices.Sort(xs)
	return xs[n/2]
}

func SortFuncInts(n int) int {
	xs := fill(n)
	slices.SortFunc(xs, func(a, b int) int { return a - b })
	return xs[n/2]
}

func SortSlice(n int) int {
	xs := fill(n)
	sort.Slice(xs, func(i, j int) bool { return xs[i] < xs[j] })
	return xs[n/2]
}

func main() {}
`;

const time = (fn) => {
	const t = performance.now();
	const v = fn();
	return [performance.now() - t, v];
};

// ── WASM ──
const wasmRes = compileWasm(src);
assert(wasmRes.wasm, `wasm compile failed: ${wasmRes.errors?.[0]?.message}`);
const { exports } = runWasm(wasmRes.wasm, {
	stringTable: wasmRes.stringTable,
});
exports.SortInts(1000n);
const [wasmMs] = time(() => exports.SortInts(BigInt(N)));
console.log(`stdlib-bench: wasm slices.Sort ${N} ints: ${wasmMs.toFixed(1)}ms`);
assert(
	wasmMs <= 100,
	`WASM slices.Sort took ${wasmMs.toFixed(1)}ms (bound 100ms)`,
);

// ── JS ──
const { js, errors } = compile(src, { strict: true, target: "both" });
assert.strictEqual(errors.length, 0, errors[0]?.message);
const fns = new Function(`${js}; return { SortFuncInts, SortSlice };`)();

const base = () => {
	const xs = [];
	let s = 12345;
	for (let i = 0; i < N; i++) {
		s = (s * 48271 + 12345) % 2147483647;
		xs.push(s);
	}
	return xs;
};
const ref = () => time(() => base().sort((a, b) => a - b))[0];

fns.SortFuncInts(1000);
fns.SortSlice(1000);
ref();
const reps = 3;
const best = (f) => Math.min(...Array.from({ length: reps }, () => f()));
const refMs = best(ref);
const funcMs = best(() => time(() => fns.SortFuncInts(N))[0]);
const sliceMs = best(() => time(() => fns.SortSlice(N))[0]);
console.log(
	`stdlib-bench: js Array.sort(cmp) ${refMs.toFixed(1)}ms, slices.SortFunc ${funcMs.toFixed(1)}ms (${(funcMs / refMs).toFixed(2)}x), sort.Slice ${sliceMs.toFixed(1)}ms (${(sliceMs / refMs).toFixed(2)}x)`,
);
assert(funcMs <= 2 * refMs, "slices.SortFunc exceeds 2x Array.prototype.sort");
assert(sliceMs <= 2 * refMs, "sort.Slice exceeds 2x Array.prototype.sort");
