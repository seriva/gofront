// GoFront test suite — orchestrator
// Runs unit tests across worker threads in parallel (or sequentially if TEST_PARALLEL=0).
//
// Test files are discovered by ./discover.js: every *.test.js below this
// directory except fixtures/. HEAVIEST_TEST_FILES there only schedules the slow
// files first.
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
import { HEAVIEST_TEST_FILES, TEST_FILES } from "./discover.js";
import { summarize, waitForPending } from "./helpers.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export { HEAVIEST_TEST_FILES, TEST_FILES };

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
