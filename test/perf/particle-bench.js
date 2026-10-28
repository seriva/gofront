// Particle kinematics benchmark (gofront/simd)
//
// 65,536 particles integrated with gravity, damping and a box bounce in one
// release-built WASM module: a scalar loop against a 4-wide SoA loop that
// uses simd.Select for the bounce. Reports the speedup and the heap
// allocated per step (new-space growth over a timed run).
//
// Usage:
//   node --expose-gc test/perf/particle-bench.js [--n 65536] [--steps 200] [--runs 7] [--json]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";
import { compileDir } from "../../src/compiler.js";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? dflt : args[i + 1];
};
const N = Number(flag("n", 65_536));
const STEPS = Number(flag("steps", 200));
const RUNS = Number(flag("runs", 7));
const JSON_OUT = args.includes("--json");
const gc = globalThis.gc ?? null;

const SOURCE = `//gofront:target wasm
package particles

import (
	"gofront/shared"
	"gofront/simd"
)

const Max = ${N}

var X = shared.NewFloat32(Max)
var Y = shared.NewFloat32(Max)
var VX = shared.NewFloat32(Max)
var VY = shared.NewFloat32(Max)

const (
	gravity float32 = -9.8
	damping float32 = 0.999
	box     float32 = 100
)

func Seed() {
	seed := uint32(0x9e3779b9)
	next := func() float32 {
		seed ^= seed << 13
		seed ^= seed >> 17
		seed ^= seed << 5
		return float32(seed%10000) / 10000.0
	}
	for i := 0; i < Max; i++ {
		X[i] = next() * box
		Y[i] = next() * box
		VX[i] = (next() - 0.5) * 40
		VY[i] = (next() - 0.5) * 40
	}
}

func StepScalar(dt float32, steps int) {
	for s := 0; s < steps; s++ {
		for i := 0; i < Max; i++ {
			vx := VX[i] * damping
			vy := (VY[i] + gravity*dt) * damping
			x := X[i] + vx*dt
			y := Y[i] + vy*dt
			if x < 0 {
				x = -x
				vx = -vx
			} else if x > box {
				x = 2*box - x
				vx = -vx
			}
			if y < 0 {
				y = -y
				vy = -vy
			} else if y > box {
				y = 2*box - y
				vy = -vy
			}
			X[i] = x
			Y[i] = y
			VX[i] = vx
			VY[i] = vy
		}
	}
}

func StepSIMD(dt float32, steps int) {
	vdt := simd.Splat(dt)
	vg := simd.Splat(gravity * dt)
	vd := simd.Splat(damping)
	zero := simd.Splat(0)
	vbox := simd.Splat(box)
	vbox2 := simd.Splat(2 * box)
	for s := 0; s < steps; s++ {
		for i := 0; i < Max; i += 4 {
			vx := simd.LoadF32x4(VX, i).Mul(vd)
			vy := simd.LoadF32x4(VY, i).Add(vg).Mul(vd)
			x := simd.LoadF32x4(X, i).Add(vx.Mul(vdt))
			y := simd.LoadF32x4(Y, i).Add(vy.Mul(vdt))

			lo := x.Less(zero)
			x = simd.Select(lo, x.Neg(), x)
			vx = simd.Select(lo, vx.Neg(), vx)
			hi := x.Greater(vbox)
			x = simd.Select(hi, vbox2.Sub(x), x)
			vx = simd.Select(hi, vx.Neg(), vx)

			lo = y.Less(zero)
			y = simd.Select(lo, y.Neg(), y)
			vy = simd.Select(lo, vy.Neg(), vy)
			hi = y.Greater(vbox)
			y = simd.Select(hi, vbox2.Sub(y), y)
			vy = simd.Select(hi, vy.Neg(), vy)

			simd.StoreF32x4(X, i, x)
			simd.StoreF32x4(Y, i, y)
			simd.StoreF32x4(VX, i, vx)
			simd.StoreF32x4(VY, i, vy)
		}
	}
}

func Checksum() float32 {
	var sum float32
	for i := 0; i < Max; i++ {
		sum += X[i] + Y[i]
	}
	return sum
}
`;

const MAIN = `package main

import "./particles"

func Setup() { particles.Seed() }
func RunScalar(dt float32, steps int) { particles.StepScalar(dt, steps) }
func RunSIMD(dt float32, steps int) { particles.StepSIMD(dt, steps) }
func Sum() float32 { return particles.Checksum() }
func main() {}
`;

async function load() {
	const root = mkdtempSync(join(tmpdir(), "gofront-particles-"));
	try {
		mkdirSync(join(root, "particles"));
		writeFileSync(join(root, "particles", "particles.go"), SOURCE);
		writeFileSync(join(root, "main.go"), MAIN);
		const out = compileDir(root, { release: true, wasmOpt: true });
		const file = join(root, "bundle.mjs");
		const js = out.js.replace(/^import .*$/gm, "");
		writeFileSync(
			file,
			`globalThis.window = null; globalThis.document = null;
globalThis.__GOFRONT_WASM_BYTES = new Uint8Array(${JSON.stringify([...out.wasm])});
${js}
export { Setup, RunScalar, RunSIMD, Sum };`,
		);
		return {
			api: await import(pathToFileURL(file).href),
			wasmBytes: out.wasm.length,
		};
	} finally {
		// Imported modules are already evaluated, so the directory can go.
		rmSync(root, { recursive: true, force: true });
	}
}

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const newSpaceUsed = () =>
	v8.getHeapSpaceStatistics().find((s) => s.space_name === "new_space")
		?.space_used_size ?? 0;

function measure(api, step) {
	api.Setup();
	step(1 / 60, 5);
	const times = [];
	const allocs = [];
	for (let r = 0; r < RUNS; r++) {
		gc?.();
		const before = newSpaceUsed();
		const t0 = performance.now();
		step(1 / 60, STEPS);
		times.push(performance.now() - t0);
		allocs.push(newSpaceUsed() - before);
	}
	const positive = allocs.filter((a) => a >= 0);
	const alloc = gc
		? median(allocs)
		: positive.length
			? Math.min(...positive)
			: Number.NaN;
	return { ms: median(times), allocPerStep: alloc / STEPS };
}

const { api, wasmBytes } = await load();
const scalar = measure(api, api.RunScalar);
const scalarSum = api.Sum();
const simdRes = measure(api, api.RunSIMD);
const simdSum = api.Sum();
const speedup = scalar.ms / simdRes.ms;
const parity = Math.abs(scalarSum - simdSum) <= 1e-3 * Math.abs(scalarSum);

if (JSON_OUT) {
	console.log(
		JSON.stringify(
			{
				particles: N,
				steps: STEPS,
				runs: RUNS,
				wasmBytes,
				scalarMs: Number(scalar.ms.toFixed(2)),
				simdMs: Number(simdRes.ms.toFixed(2)),
				speedup: Number(speedup.toFixed(2)),
				scalarAllocPerStep: scalar.allocPerStep,
				simdAllocPerStep: simdRes.allocPerStep,
				parity,
			},
			null,
			2,
		),
	);
} else {
	console.log(
		`Particle kinematics: ${N} particles x ${STEPS} steps x ${RUNS} runs (median, release build, ${wasmBytes} bytes)${gc ? "" : ", no --expose-gc"}`,
	);
	console.log("| Variant | Time (ms) | Alloc / step (bytes) |");
	console.log("|---|---|---|");
	console.log(
		`| scalar | ${scalar.ms.toFixed(2)} | ${scalar.allocPerStep.toFixed(1)} |`,
	);
	console.log(
		`| simd | ${simdRes.ms.toFixed(2)} | ${simdRes.allocPerStep.toFixed(1)} |`,
	);
	console.log(
		`\nSpeedup: ${speedup.toFixed(2)}x (gate >= 1.30x with zero allocations per step)`,
	);
	console.log(
		`Parity: ${parity ? "ok" : "MISMATCH"} (${scalarSum} vs ${simdSum})`,
	);
}
if (!parity) process.exitCode = 1;
