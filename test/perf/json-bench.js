// JSON Benchmark (Phase 5.2, Task 5.6)
//
// Encodes and decodes a ~1 MB JSON corpus in WASM and in the JS backend.
// Gate: WASM <= 2x JS execution time.
//
// Usage:
//   node test/perf/json-bench.js [--runs 5] [--items 18000] [--json]

import { performance } from "node:perf_hooks";
import { compileHybridProject } from "../unit/helpers.js";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(flag("runs", 5));
const ITEMS = Number(flag("items", 18_000));
const JSON_OUT = args.includes("--json");

const makeBenchLib = (target) => `//gofront:target ${target}
package bench

import (
	"encoding/json"
	"strconv"
)

type Item struct {
	ID     int     \`json:"id"\`
	Name   string  \`json:"name"\`
	Score  float64 \`json:"score"\`
	Active bool    \`json:"active"\`
}

func MakeItems(count int) []Item {
	items := make([]Item, count)
	for i := 0; i < count; i++ {
		items[i] = Item{
			ID:     i,
			Name:   "item-" + strconv.Itoa(i),
			Score:  float64(i) * 1.5,
			Active: i%2 == 0,
		}
	}
	return items
}

var corpus []Item
var jsonBytes []byte

func InitCorpus(count int) int {
	corpus = MakeItems(count)
	var err error
	jsonBytes, err = json.Marshal(corpus)
	if err != nil {
		panic(err)
	}
	return len(jsonBytes)
}

func BenchEncode() int {
	b, _ := json.Marshal(corpus)
	return len(b)
}

func BenchDecode() int {
	var dec []Item
	_ = json.Unmarshal(jsonBytes, &dec)
	return len(dec)
}
`;

function median(arr) {
	const sorted = arr.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
}

async function benchmarkTarget(target, items, runs) {
	const res = await compileHybridProject(
		{
			"bench/bench.go": makeBenchLib(target),
			"main.go": `package main
import "./bench"

func Init(count int) int { return bench.InitCorpus(count) }
func RunEncode() int { return bench.BenchEncode() }
func RunDecode() int { return bench.BenchDecode() }
func main() {}
`,
		},
		{ exports: ["Init", "RunEncode", "RunDecode"] },
	);

	const byteLength = res.mod.Init(items);

	// Warmup runs
	res.mod.RunEncode();
	res.mod.RunDecode();

	// Measure Encode
	const encTimes = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		const n = res.mod.RunEncode();
		const dt = performance.now() - t0;
		if (n === 0) throw new Error("encode returned empty output");
		encTimes.push(dt);
	}

	// Measure Decode
	const decTimes = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		const n = res.mod.RunDecode();
		const dt = performance.now() - t0;
		if (n !== items)
			throw new Error(`decode returned ${n} items, want ${items}`);
		decTimes.push(dt);
	}

	const encMed = median(encTimes);
	const decMed = median(decTimes);
	const totalMed = encMed + decMed;
	const mb = byteLength / (1024 * 1024);

	return {
		target,
		byteLength,
		mb,
		encMed,
		decMed,
		totalMed,
		encMBs: mb / (encMed / 1000),
		decMBs: mb / (decMed / 1000),
		totalMBs: mb / (totalMed / 1000),
	};
}

async function main() {
	if (!JSON_OUT) {
		console.log(`JSON Benchmark (Corpus ~${ITEMS} items, ${RUNS} runs)`);
		console.log("Compiling and measuring JS backend...");
	}
	const jsStats = await benchmarkTarget("js", ITEMS, RUNS);

	if (!JSON_OUT) {
		console.log("Compiling and measuring WASM backend...");
	}
	const wasmStats = await benchmarkTarget("wasm", ITEMS, RUNS);

	const encRatio = wasmStats.encMed / jsStats.encMed;
	const decRatio = wasmStats.decMed / jsStats.decMed;
	const totalRatio = wasmStats.totalMed / jsStats.totalMed;
	const passed = totalRatio <= 2.0;

	if (JSON_OUT) {
		console.log(
			JSON.stringify(
				{
					corpusBytes: jsStats.byteLength,
					corpusMB: Number(jsStats.mb.toFixed(3)),
					runs: RUNS,
					js: {
						encodeMs: Number(jsStats.encMed.toFixed(2)),
						encodeMBs: Number(jsStats.encMBs.toFixed(1)),
						decodeMs: Number(jsStats.decMed.toFixed(2)),
						decodeMBs: Number(jsStats.decMBs.toFixed(1)),
						totalMs: Number(jsStats.totalMed.toFixed(2)),
					},
					wasm: {
						encodeMs: Number(wasmStats.encMed.toFixed(2)),
						encodeMBs: Number(wasmStats.encMBs.toFixed(1)),
						decodeMs: Number(wasmStats.decMed.toFixed(2)),
						decodeMBs: Number(wasmStats.decMBs.toFixed(1)),
						totalMs: Number(wasmStats.totalMed.toFixed(2)),
					},
					ratio: {
						encode: Number(encRatio.toFixed(2)),
						decode: Number(decRatio.toFixed(2)),
						total: Number(totalRatio.toFixed(2)),
					},
					gatePassed: passed,
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(
		`\nCorpus: ${jsStats.byteLength} bytes (${jsStats.mb.toFixed(2)} MB)\n`,
	);
	console.log(
		"| Backend | Encode (ms) | Encode (MB/s) | Decode (ms) | Decode (MB/s) | Total (ms) |",
	);
	console.log(
		"|---------|-------------|---------------|-------------|---------------|------------|",
	);
	console.log(
		`| JS      | ${jsStats.encMed.toFixed(2).padStart(11)} | ${jsStats.encMBs.toFixed(1).padStart(13)} | ${jsStats.decMed.toFixed(2).padStart(11)} | ${jsStats.decMBs.toFixed(1).padStart(13)} | ${jsStats.totalMed.toFixed(2).padStart(10)} |`,
	);
	console.log(
		`| WASM    | ${wasmStats.encMed.toFixed(2).padStart(11)} | ${wasmStats.encMBs.toFixed(1).padStart(13)} | ${wasmStats.decMed.toFixed(2).padStart(11)} | ${wasmStats.decMBs.toFixed(1).padStart(13)} | ${wasmStats.totalMed.toFixed(2).padStart(10)} |`,
	);
	console.log("");
	console.log(`WASM / JS Ratio:`);
	console.log(`  Encode: ${encRatio.toFixed(2)}x`);
	console.log(`  Decode: ${decRatio.toFixed(2)}x`);
	console.log(`  Total:  ${totalRatio.toFixed(2)}x (Gate: <= 2.00x)`);
	console.log("");

	if (passed) {
		console.log("✓ Gate passed: WASM <= 2x JS execution time");
	} else {
		console.log(
			"✗ Gate missed: WASM > 2x JS execution time (documented follow-up)",
		);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
