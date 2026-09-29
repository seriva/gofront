// Zero-Allocation Verification Benchmark (v1.3.0)
// Measures heap allocations in Node.js for hot execution loops and out-parameters.

import assert from "node:assert";
import v8 from "node:v8";
import { compile } from "../../unit/helpers.js";

const { js, errors } = compile(`package main

type Vec3 struct {
	X float32
	Y float32
	Z float32
}

type Ray struct {
	Origin Vec3
	Dir    Vec3
}

type Triangle struct {
	V0 Vec3
	V1 Vec3
	V2 Vec3
}

type HitResult struct {
	Hit  bool
	Dist float32
}

func (t *Triangle) Intersect(ray *Ray, out *HitResult) bool {
	out.Hit = true
	out.Dist = ray.Origin.X + t.V0.X
	return out.Hit
}

var tri = Triangle{
	V0: Vec3{X: 0, Y: 0, Z: 0},
	V1: Vec3{X: 1, Y: 0, Z: 0},
	V2: Vec3{X: 0, Y: 1, Z: 0},
}
var ray = Ray{
	Origin: Vec3{X: 0, Y: 0, Z: -1},
	Dir:    Vec3{X: 0, Y: 0, Z: 1},
}
var hit = HitResult{}

func BenchmarkSweep(iterations int, items []int) int {
	triPtr := &tri
	rayPtr := &ray
	hitPtr := &hit
	count := 0

	// Hot loop: struct out-parameter mutations and zero-allocation slice iteration
	for i := 0; i < iterations; i++ {
		for _, v := range items {
			if triPtr.Intersect(rayPtr, hitPtr) {
				count += v
			}
		}
	}
	return count
}

func main() {}
`);

assert.strictEqual(
	errors.length,
	0,
	`Compilation errors: ${errors.map((e) => e.message).join("\n")}`,
);

const fn = new Function(`${js}\nreturn BenchmarkSweep;`);
const BenchmarkSweep = fn();

const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Warm up JIT
BenchmarkSweep(100, items);

const getNewSpaceUsed = () =>
	v8.getHeapSpaceStatistics().find((s) => s.space_name === "new_space")
		?.space_used_size ?? 0;

const before = getNewSpaceUsed();
// 10,000 outer * 10 inner = 100,000 iterations
const result = BenchmarkSweep(10000, items);
const after = getNewSpaceUsed();

const delta = after - before;
console.log(
	`Benchmark completed: 100,000 iterations, result=${result}, memory delta=${delta} bytes`,
);
// In V8, a delta under 64KB across 100,000 iterations confirms 0 per-iteration heap allocations (no GC sweeps triggered)
assert(
	delta >= 0 && delta < 65536,
	`Expected near-zero allocation (<64KB), but got ${delta} bytes`,
);
console.log("✓ Zero-allocation verification benchmark passed");
