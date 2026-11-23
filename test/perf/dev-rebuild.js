// Dev rebuild benchmark
//
// Measures what `gofront dev` does on a save: one file of the example's
// package is edited and the build reruns against the cache the earlier builds
// filled.  Gate: the median rebuild of `example/gom` and `example/simple`
// (JS target, source maps on, output written) takes under 35 ms.
//
// Usage:
//   node test/perf/dev-rebuild.js [--runs 20] [--json]

import {
	appendFileSync,
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { runDevBuild } from "../../src/cli/cli-core.js";
import { PackageCache } from "../../src/link/package-cache.js";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(flag("runs", 20));
const JSON_OUT = args.includes("--json");
const GATE_MS = 35;
const WARMUP = 3;
const EXAMPLES = ["gom", "simple"];

const exampleDir = (name) =>
	fileURLToPath(new URL(`../../example/${name}/`, import.meta.url));

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
};

// Rebuilds a copy of the example after appending a comment to `main.go`, the
// way a save changes a file: new size and a new modification time.
function measure(name) {
	const work = mkdtempSync(join(tmpdir(), "gofront-dev-rebuild-"));
	try {
		const srcDir = join(work, "src");
		cpSync(join(exampleDir(name), "src"), srcDir, { recursive: true });
		const edited = join(srcDir, "main.go");
		const config = {
			srcDir,
			isDir: true,
			outputFile: join(work, "app.js"),
			sourceMap: true,
			minify: false,
			mangle: false,
			forceTarget: "js",
			packageCache: new PackageCache(),
		};
		const coldStart = performance.now();
		runDevBuild(config);
		const coldMs = performance.now() - coldStart;
		const times = [];
		let clock = Date.now() + 10_000;
		for (let i = 0; i < WARMUP + RUNS; i++) {
			appendFileSync(edited, `\n// edit ${i}\n`);
			clock += 1000;
			utimesSync(edited, new Date(clock), new Date(clock));
			const start = performance.now();
			runDevBuild(config, "main.go");
			const ms = performance.now() - start;
			if (i >= WARMUP) times.push(ms);
		}
		const warm = readFileSync(config.outputFile, "utf8");
		return { name, coldMs, medianMs: median(times), bytes: warm.length };
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

const results = EXAMPLES.map(measure);
if (JSON_OUT) {
	console.log(JSON.stringify(results));
} else {
	console.log("Dev rebuild (median of warm rebuilds, JS target)");
	for (const r of results)
		console.log(
			`  ${r.name.padEnd(8)} ${r.medianMs.toFixed(1).padStart(6)} ms  (cold ${r.coldMs.toFixed(0)} ms)`,
		);
}
const slow = results.filter((r) => r.medianMs >= GATE_MS);
if (slow.length > 0) {
	console.error(
		`FAIL: median rebuild must stay under ${GATE_MS} ms: ${slow.map((r) => `${r.name} ${r.medianMs.toFixed(1)} ms`).join(", ")}`,
	);
	process.exit(1);
}
