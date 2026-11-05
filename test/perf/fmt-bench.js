// fmt Benchmark
//
// 100k mixed fmt.Sprintf calls (ints, floats, strings, a %v struct, %q and a
// Stringer), timed inside the program with time.Now so the figure covers only
// formatting. Run on the JS backend and on WASM.
//
// Gate: each backend must stay at or under its recorded baseline times the
// configured factor. The default gate is the baseline itself (factor 1.0).
//
// Usage:
//   node test/perf/fmt-bench.js [--runs 3] [--calls 100000] [--json]

import { compileHybridProgram } from "../unit/helpers.js";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(flag("runs", 5));
const CALLS = Number(flag("calls", 100_000));
const JSON_OUT = args.includes("--json");

// Baselines measured on the hand-written engine (the last commit before fmt
// moved to Go source). Gate factors: JS <= 2.0x, WASM <= 1.0x.
export const BASELINE_MS = { js: 790, wasm: 1200 };
export const GATE_FACTOR = { js: 1.0, wasm: 1.0 };

const src = `package main

import (
	"fmt"
	"time"
)

type P struct {
	X, Y int
}

type Celsius float64

func (c Celsius) String() string { return fmt.Sprintf("%.1f°C", float64(c)) }

func main() {
	n := ${CALLS}
	total := 0
	start := time.Now()
	for i := 0; i < n; i++ {
		s := fmt.Sprintf("%d-%s %v %q %.2f %v", i, "x", P{i, i + 1}, "q", float64(i)/3, Celsius(i))
		total += len(s)
	}
	elapsed := time.Since(start).Milliseconds()
	fmt.Println(total, elapsed)
}
`;

const parse = (out) => {
	const [total, ms] = out.trim().split(" ").map(Number);
	return { total, ms };
};

const results = { js: [], wasm: [] };
let total = 0;
for (let r = 0; r < RUNS; r++) {
	const out = await compileHybridProgram(src);
	for (const k of ["js", "wasm"]) {
		const p = parse(out[k]);
		total = p.total;
		results[k].push(p.ms);
	}
}
const best = (xs) => Math.min(...xs);
const summary = {
	calls: CALLS,
	bytes: total,
	js: best(results.js),
	wasm: best(results.wasm),
};
if (JSON_OUT) console.log(JSON.stringify(summary));
else
	console.log(
		`fmt-bench: ${CALLS} Sprintf calls: js ${summary.js}ms, wasm ${summary.wasm}ms`,
	);

let failed = false;
for (const k of ["js", "wasm"]) {
	const limit = BASELINE_MS[k] * GATE_FACTOR[k];
	if (limit > 0 && summary[k] > limit) {
		console.error(
			`fmt-bench: ${k} took ${summary[k]}ms (limit ${limit.toFixed(0)}ms)`,
		);
		failed = true;
	}
}
if (failed) process.exit(1);
