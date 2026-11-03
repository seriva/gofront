// test/perf/stdlib-bench.js
// Standard library from Go source:
//   - WASM `slices.Sort` of 200,000 ints
//   - JS `slices.SortFunc` and `sort.Slice` against `Array.prototype.sort`
//     with a comparator
//   - WASM `strings.Index` over 1 MB (the host search through a native)
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

// ── WASM strings.Index ──
// 20 searches of "ab" in "a" x (2^20 - 1) + "b".  The host search through
// the native took 145 ms when it was a hand-written emitter; the bound is
// 1.25x that.
const INDEX_BASELINE_MS = 145;
const indexSrc = `package main

import "strings"

var hay string

func Setup() {
	var b strings.Builder
	for i := 0; i < 1<<20-1; i++ {
		b.WriteByte('a')
	}
	b.WriteByte('b')
	hay = b.String()
}

func Search(n int) int {
	found := 0
	for i := 0; i < n; i++ {
		found += strings.Index(hay, "ab")
	}
	return found
}

func main() {}
`;
const indexRes = compileWasm(indexSrc);
assert(indexRes.wasm, `wasm compile failed: ${indexRes.errors?.[0]?.message}`);
const idx = runWasm(indexRes.wasm, { stringTable: indexRes.stringTable });
idx.exports.Setup();
idx.exports.Search(1n);
const indexMs = Math.min(
	...Array.from({ length: 3 }, () => time(() => idx.exports.Search(20n))[0]),
);
console.log(
	`stdlib-bench: wasm strings.Index 1 MB x 20: ${indexMs.toFixed(1)}ms (baseline ${INDEX_BASELINE_MS}ms)`,
);
assert(
	indexMs <= INDEX_BASELINE_MS * 1.25,
	`WASM strings.Index took ${indexMs.toFixed(1)}ms (bound ${INDEX_BASELINE_MS * 1.25}ms)`,
);
