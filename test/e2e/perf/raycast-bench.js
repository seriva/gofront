// Raycast Go/No-Go Benchmark (v1.5.0, Phase 6b)
//
// Compiles a real Möller–Trumbore + octree raycast workload (a snapshot of
// simplefps `engine/mathx` + `engine/collision` under ./raycast/) twice —
// once with every package forced to JS, once as declared (`mathx` both,
// `collision` wasm) — and casts the same rays through both. Reports rays/s
// and V8 new-space growth per run, so the numbers decide whether the hybrid
// backend earns its keep.
//
//   node --expose-gc test/e2e/perf/raycast-bench.js [--tris 100352] [--rays 100000]
//        [--runs 5] [--mode js|hybrid|both] [--wasm-opt /path/to/wasm-opt] [--json]
//
// `--expose-gc` is optional; without it the allocation column is the smallest
// non-negative delta across runs (a scavenge mid-run shows up as a negative
// delta and is discarded). `--wasm-opt` runs Binaryen's `-O3` over the emitted
// module before loading it: that is the ceiling a peephole-optimised backend
// could reach, not what GoFront ships.

import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import v8 from "node:v8";
import { compileDir } from "../../../src/compiler.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "raycast");

// ── CLI ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? dflt : args[i + 1];
};
const TRIS_WANTED = Number(flag("tris", 100_352));
const RAYS = Number(flag("rays", 100_000));
const RUNS = Number(flag("runs", 5));
const MODE = flag("mode", "both");
const WASM_OPT = flag("wasm-opt", null);
const JSON_OUT = args.includes("--json");
const gc = globalThis.gc ?? null;

function optimiseWasm(wasm) {
	if (!WASM_OPT || !wasm) return wasm;
	const dir = mkdtempSync(join(tmpdir(), "gofront-wasmopt-"));
	const input = join(dir, "in.wasm");
	const output = join(dir, "out.wasm");
	try {
		writeFileSync(input, wasm);
		execFileSync(WASM_OPT, [
			"-O3",
			"--enable-gc",
			"--enable-reference-types",
			"--enable-exception-handling",
			"--enable-multivalue",
			"--enable-nontrapping-float-to-int",
			"--enable-bulk-memory",
			"--enable-tail-call",
			input,
			"-o",
			output,
		]);
		return new Uint8Array(readFileSync(output));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── Compile both variants ────────────────────────────────────────
// Each variant gets its own copy of the fixture: the JS-only one with the
// `//gofront:target` directives stripped so every package lands in JS.
function compileVariant(forceJs) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-raycast-"));
	try {
		cpSync(FIXTURE, dir, { recursive: true });
		if (forceJs) {
			for (const pkg of readdirSync(dir)) {
				for (const f of readdirSync(join(dir, pkg))) {
					const p = join(dir, pkg, f);
					writeFileSync(
						p,
						readFileSync(p, "utf8").replace(/^\/\/gofront:target .*\n/, ""),
					);
				}
			}
		}
		return compileDir(join(dir, "collision"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// The facade awaits WASM instantiation at top level, so the bundle must be an
// ES module; `__GOFRONT_WASM_BYTES` short-circuits the loader's fetch.
async function loadVariant(forceJs) {
	const compiled = compileVariant(forceJs);
	const js = compiled.js;
	const wasm = optimiseWasm(compiled.wasm);
	const dir = mkdtempSync(join(tmpdir(), "gofront-raycast-"));
	const file = join(dir, "collision.mjs");
	const bytes = wasm
		? `new Uint8Array(${JSON.stringify([...wasm])})`
		: "undefined";
	writeFileSync(
		file,
		`globalThis.window = null; globalThis.document = null;
globalThis.__GOFRONT_WASM_BYTES = ${bytes};
${js}
export { NewTrimesh, NewRay, Vec3, RayModeClosest };`,
	);
	try {
		return {
			api: await import(pathToFileURL(file)),
			wasmBytes: wasm?.length ?? 0,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── Workload ─────────────────────────────────────────────────────
// A gently tilted floor: GRID×GRID quads, two triangles each. The octree files
// each triangle in the deepest node that fully contains it, so geometry that
// crosses a split plane stays at a shallow level and is tested by every ray
// passing through — with a wavy surface every y-plane crossing (a whole contour
// line) does that and the 4096-candidate cap makes rays miss. A power-of-two GRID
// keeps x/z planes on vertex rows and a monotonic tilt keeps y crossings to one
// column per node, which is what a real level mesh looks like to the tree.
// Rays start above the surface and point down with a small lateral jitter so
// every one hits.
const GRID = 2 ** Math.ceil(Math.log2(Math.max(1, Math.sqrt(TRIS_WANTED / 2))));
const TRIS = GRID * GRID * 2;
const CELL = 4;
const TILT = 0.05;

function buildMesh() {
	const verts = new Float32Array((GRID + 1) * (GRID + 1) * 3);
	let v = 0;
	for (let z = 0; z <= GRID; z++) {
		for (let x = 0; x <= GRID; x++) {
			verts[v++] = x * CELL;
			verts[v++] = x * CELL * TILT;
			verts[v++] = z * CELL;
		}
	}
	const indices = new Int32Array(TRIS * 3);
	let n = 0;
	for (let z = 0; z < GRID; z++) {
		for (let x = 0; x < GRID; x++) {
			const i = z * (GRID + 1) + x;
			indices[n++] = i;
			indices[n++] = i + GRID + 1;
			indices[n++] = i + 1;
			indices[n++] = i + 1;
			indices[n++] = i + GRID + 1;
			indices[n++] = i + GRID + 2;
		}
	}
	return { verts, indices };
}

// Deterministic ray set (LCG) so every variant and every run casts identical rays.
function buildRays() {
	const xs = new Float32Array(RAYS);
	const zs = new Float32Array(RAYS);
	const jx = new Float32Array(RAYS);
	const jz = new Float32Array(RAYS);
	let seed = 0x9e3779b9;
	const rnd = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	const span = GRID * CELL - 2;
	for (let i = 0; i < RAYS; i++) {
		xs[i] = 1 + rnd() * span;
		zs[i] = 1 + rnd() * span;
		jx[i] = (rnd() - 0.5) * 2;
		jz[i] = (rnd() - 0.5) * 2;
	}
	return { xs, zs, jx, jz };
}

const newSpaceUsed = () =>
	v8.getHeapSpaceStatistics().find((s) => s.space_name === "new_space")
		?.space_used_size ?? 0;

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[s.length >> 1];
};

async function bench(label, forceJs, mesh, rays) {
	const { api, wasmBytes } = await loadVariant(forceJs);
	const { NewTrimesh, NewRay, Vec3, RayModeClosest } = api;

	const t0 = performance.now();
	const tm = NewTrimesh(mesh.verts, mesh.indices, null);
	const buildMs = performance.now() - t0;

	const ray = NewRay(new Vec3(0, 200, 0), new Vec3(0, -50, 0));
	ray.Mode = RayModeClosest;
	const from = ray.From;
	const to = ray.To;
	const result = ray.Result;
	const { xs, zs, jx, jz } = rays;

	function sweep() {
		let hits = 0;
		for (let i = 0; i < RAYS; i++) {
			from.Set(xs[i], 200, zs[i]);
			to.Set(xs[i] + jx[i], -50, zs[i] + jz[i]);
			ray.UpdateDirection();
			result.Reset();
			ray.HasHit = false;
			ray.IntersectTrimesh(tm, null);
			if (ray.HasHit) hits++;
		}
		return hits;
	}

	// Warm up until the JIT has settled on the hot loop.
	for (let i = 0; i < 3; i++) sweep();

	const times = [];
	const deltas = [];
	let hits = 0;
	for (let r = 0; r < RUNS; r++) {
		gc?.();
		const before = newSpaceUsed();
		const start = performance.now();
		hits = sweep();
		times.push(performance.now() - start);
		deltas.push(newSpaceUsed() - before);
	}
	const positive = deltas.filter((d) => d >= 0);
	const allocBytes = gc
		? median(deltas)
		: positive.length
			? Math.min(...positive)
			: Number.NaN;
	const ms = median(times);
	return {
		label,
		wasmBytes,
		buildMs,
		hits,
		ms,
		raysPerSec: Math.round((RAYS / ms) * 1000),
		allocBytes,
		allocPerRay: allocBytes / RAYS,
	};
}

// ── Run ──────────────────────────────────────────────────────────
const mesh = buildMesh();
const rays = buildRays();
const results = [];
if (MODE === "js" || MODE === "both")
	results.push(await bench("js", true, mesh, rays));
if (MODE === "hybrid" || MODE === "both")
	results.push(await bench("hybrid", false, mesh, rays));

for (const r of results) {
	if (r.hits !== RAYS) {
		console.error(
			`${r.label}: ${r.hits}/${RAYS} rays hit — workload is broken`,
		);
		process.exitCode = 1;
	}
}

if (JSON_OUT) {
	console.log(
		JSON.stringify(
			{ tris: TRIS, rays: RAYS, runs: RUNS, gc: Boolean(gc), results },
			null,
			2,
		),
	);
} else {
	const fmt = (n, d = 0) =>
		n.toLocaleString("en-US", { maximumFractionDigits: d });
	console.log(
		`Raycast benchmark — ${fmt(TRIS)} triangles, ${fmt(RAYS)} rays × ${RUNS} runs (median)${gc ? "" : ", no --expose-gc"}`,
	);
	console.log(
		"mode     rays/s       ms/run   alloc/run    alloc/ray   build ms   wasm",
	);
	for (const r of results) {
		console.log(
			`${r.label.padEnd(8)} ${fmt(r.raysPerSec).padStart(10)}   ${fmt(r.ms, 1).padStart(7)}   ${(`${fmt(r.allocBytes)} B`).padStart(10)}   ${(`${fmt(r.allocPerRay, 3)} B`).padStart(9)}   ${fmt(r.buildMs, 0).padStart(8)}   ${r.wasmBytes ? `${fmt(r.wasmBytes / 1024, 1)} KB` : "-"}`,
		);
	}
	if (results.length === 2) {
		const [js, hy] = results;
		console.log(
			`speedup  ${(hy.raysPerSec / js.raysPerSec).toFixed(2)}× (hybrid vs js)`,
		);
	}
}
