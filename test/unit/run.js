// GoFront test suite — orchestrator
// Runs unit tests across worker threads in parallel (or sequentially if TEST_PARALLEL=0).
//
// Test directories:
//   language/ — core language features, control flow, declarations, expressions, structs
//   types/    — type errors, type checks, type inference, generics, typed arrays
//   builtins/ — built-in functions, operators, stdlib shims, bytes, gom, dom
//   compiler/ — multi-file packages, CLI, test-runner, templ, lexer-parser, lower, minifier
//   wasm/     — WebAssembly backend, GC semantics, stdlib parity, optimizations

import os from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { summarize, waitForPending } from "./helpers.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const TEST_FILES = [
	"./language/core.test.js",
	"./language/control-flow.test.js",
	"./language/declarations.test.js",
	"./language/expressions.test.js",
	"./language/range-iter.test.js",
	"./language/loops.test.js",
	"./language/pointers.test.js",
	"./language/struct_unboxing.test.js",
	"./language/value-semantics.test.js",
	"./language/codegen-regressions.test.js",
	"./language/named-type-methods.test.js",
	"./language/structs.test.js",
	"./language/constants.test.js",
	"./language/parity-matrix.test.js",
	"./types/errors.test.js",
	"./types/checks.test.js",
	"./types/inference.test.js",
	"./types/arrays.test.js",
	"./types/shadowing.test.js",
	"./types/complex.test.js",
	"./types/generics.test.js",
	"./types/typedarrays.test.js",
	"./types/stdlib-coverage.test.js",
	"./types/webgl.test.js",
	"./builtins/core.test.js",
	"./builtins/operators.test.js",
	"./builtins/stdlib.test.js",
	"./builtins/bytes.test.js",
	"./builtins/iter.test.js",
	"./builtins/json.test.js",
	"./builtins/gom.test.js",
	"./builtins/dom.test.js",
	"./compiler/packages.test.js",
	"./compiler/cli.test.js",
	"./compiler/cli-core.test.js",
	"./compiler/imports.test.js",
	"./compiler/dev-server.test.js",
	"./compiler/asset-manager.test.js",
	"./compiler/prep.test.js",
	"./compiler/pwa.test.js",
	"./compiler/test-runner.test.js",
	"./compiler/targets.test.js",
	"./compiler/strict-mode.test.js",
	"./compiler/strict-panics.test.js",
	"./compiler/templ.test.js",
	"./compiler/lexer-parser.test.js",
	"./compiler/minifier.test.js",
	"./compiler/lower.test.js",
	"./compiler/optimize-build.test.js",
	"./compiler/semantics.test.js",
	"./compiler/stdlib-go.test.js",
	"./compiler/manifest.test.js",
	"./compiler/conformance.test.js",
	"./wasm/encode.test.js",
	"./wasm/wat.test.js",
	"./wasm/scalars.test.js",
	"./wasm/traps.test.js",
	"./wasm/structs.test.js",
	"./wasm/slices.test.js",
	"./wasm/strings_any.test.js",
	"./wasm/closures.test.js",
	"./wasm/boundary.test.js",
	"./wasm/interfaces.test.js",
	"./wasm/generics.test.js",
	"./wasm/variadic.test.js",
	"./wasm/maps.test.js",
	"./wasm/defer_recover.test.js",
	"./wasm/go_semantics.test.js",
	"./wasm/optimize.test.js",
	"./wasm/shared.test.js",
	"./wasm/simd.test.js",
	"./wasm/pointers.test.js",
	"./wasm/arrays.test.js",
	"./wasm/range_func.test.js",
	"./wasm/complex.test.js",
	"./wasm/stdlib.test.js",
	"./wasm/golden.test.js",
];

// Sequential fallback for debugging or constrained single-thread environments
if (process.env.TEST_PARALLEL === "0") {
	for (const file of TEST_FILES) {
		await import(file);
		await waitForPending();
	}
	process.exit((await summarize()) > 0 ? 1 : 0);
}

// Parallel execution across CPU cores via a persistent worker pool
const workerPath = resolve(__dirname, "worker.js");
const concurrency = Math.max(
	1,
	os.availableParallelism?.() ?? os.cpus().length,
);

let totalPassed = 0;
let totalFailed = 0;
const allFailures = [];
const fileTimings = [];

const HEAVIEST_TEST_FILES = [
	"./wasm/optimize.test.js",
	"./compiler/optimize-build.test.js",
	"./builtins/gom.test.js",
	"./compiler/templ.test.js",
	"./builtins/dom.test.js",
	"./compiler/test-runner.test.js",
	"./compiler/prep.test.js",
	"./wasm/boundary.test.js",
	"./compiler/cli.test.js",
	"./wasm/stdlib.test.js",
	"./compiler/cli-core.test.js",
	"./builtins/stdlib.test.js",
	"./compiler/packages.test.js",
];
const heaviestSet = new Set(HEAVIEST_TEST_FILES);

const queue = [
	...HEAVIEST_TEST_FILES,
	...TEST_FILES.filter((f) => !heaviestSet.has(f)),
];

const workers = Array.from(
	{ length: Math.min(concurrency, queue.length) },
	() => {
		return new Worker(workerPath);
	},
);

async function runWorkerLoop(initialWorker) {
	let worker = initialWorker;
	while (queue.length > 0) {
		const file = queue.shift();
		const fullPath = resolve(__dirname, file);

		const t0 = performance.now();
		let workerDied = false;

		await new Promise((resolveTask) => {
			const cleanup = () => {
				worker.off("message", onMessage);
				worker.off("error", onError);
				worker.off("exit", onExit);
			};

			const onMessage = (msg) => {
				cleanup();

				if (msg.stdout) process.stdout.write(msg.stdout);
				if (msg.stderr) process.stderr.write(msg.stderr);

				fileTimings.push({ file, ms: Math.round(performance.now() - t0) });

				if (msg.ok) {
					totalPassed += msg.passed;
					totalFailed += msg.failed;
					if (msg.failures) allFailures.push(...msg.failures);
				} else {
					totalFailed += msg.failed || 1;
					if (msg.failures) allFailures.push(...msg.failures);
				}
				resolveTask();
			};

			const onError = (err) => {
				cleanup();
				workerDied = true;
				totalFailed++;
				allFailures.push({ name: file, error: err?.stack || String(err) });
				process.stderr.write(`Worker error in ${file}: ${err?.message}\n`);
				resolveTask();
			};

			const onExit = (code) => {
				cleanup();
				if (code !== 0) {
					workerDied = true;
					totalFailed++;
					allFailures.push({
						name: file,
						error: `Worker exited with code ${code}`,
					});
					process.stderr.write(`Worker exited with code ${code} in ${file}\n`);
				}
				resolveTask();
			};

			worker.on("message", onMessage);
			worker.on("error", onError);
			worker.on("exit", onExit);
			worker.postMessage({ file: fullPath });
		});

		if (workerDied) {
			try {
				worker.terminate();
			} catch {}
			if (queue.length > 0) {
				worker = new Worker(workerPath);
			} else {
				return;
			}
		}
	}
	try {
		worker.postMessage({ done: true });
	} catch {}
}

await Promise.all(workers.map(runWorkerLoop));

const total = totalPassed + totalFailed;
process.stdout.write(`\n${total} tests: \x1b[32m${totalPassed} passed\x1b[0m`);
if (totalFailed > 0) {
	process.stdout.write(`, \x1b[31m${totalFailed} failed\x1b[0m`);
	process.stdout.write("\n\nFailed tests:\n");
	for (const f of allFailures) process.stdout.write(`  • ${f.name}\n`);
}
process.stdout.write("\n");

if (process.env.DEBUG_TIMINGS) {
	fileTimings.sort((a, b) => b.ms - a.ms);
	process.stdout.write("\nSlowest test files:\n");
	for (const t of fileTimings.slice(0, 10)) {
		process.stdout.write(`  ${t.ms}ms: ${t.file}\n`);
	}
}

process.exit(totalFailed > 0 ? 1 : 0);
