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
//   compiler/ — multi-file packages, imports, targets, templ, lexer-parser, lower, link, minifier, layers, runner
//   cli/      — CLI, cli-core, dev server, test-runner, prep, pwa, assets, example build
//   wasm/     — WebAssembly backend, GC semantics, stdlib parity, optimizations

import { existsSync } from "node:fs";
import os from "node:os";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { HEAVIEST_TEST_FILES, TEST_FILES } from "./discover.js";
import { getTestStats, resetTestStats, waitForPending } from "./helpers.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export { HEAVIEST_TEST_FILES, TEST_FILES };

// helpers.js checks this when it fires its standalone exit hook.
globalThis.__GOFRONT_TEST_RUNNER = true;

// Usage: node test/unit/run.js [--grep <re>] [file...]
// Files are relative to the cwd or to test/unit/. TEST_GREP is the env form
// of --grep. TEST_TIMEOUT_MS bounds one async test and TEST_FILE_TIMEOUT_MS
// one file (parallel mode only).
function parseArgs(argv) {
	const files = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--grep") {
			if (i + 1 >= argv.length) usageError("--grep needs a pattern");
			process.env.TEST_GREP = argv[++i];
		} else if (arg.startsWith("--grep=")) {
			process.env.TEST_GREP = arg.slice("--grep=".length);
		} else if (arg.startsWith("-")) {
			usageError(`unknown option ${arg}`);
		} else {
			const found = [resolve(arg), resolve(__dirname, arg)].find(existsSync);
			if (!found) usageError(`test file not found: ${arg}`);
			files.push(found);
		}
	}
	return files;
}

function usageError(message) {
	process.stderr.write(`run.js: ${message}\n`);
	process.exit(2);
}

const requestedFiles = parseArgs(process.argv.slice(2));
const fileTimeoutMs = Number(process.env.TEST_FILE_TIMEOUT_MS) || 900_000;

const displayName = (path) => relative(__dirname, path).split("\\").join("/");

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const allFailures = [];
const fileTimings = [];

function recordFailures(file, failures = []) {
	for (const f of failures) allFailures.push({ ...f, file });
}

function finish() {
	const total = totalPassed + totalFailed;
	process.stdout.write(
		`\n${total} tests: \x1b[32m${totalPassed} passed\x1b[0m`,
	);
	if (totalFailed > 0) {
		process.stdout.write(`, \x1b[31m${totalFailed} failed\x1b[0m`);
	}
	if (totalSkipped > 0) process.stdout.write(`, ${totalSkipped} skipped`);
	if (totalFailed > 0) {
		process.stdout.write("\n\nFailed tests:\n");
		for (const f of allFailures) {
			process.stdout.write(`  • ${f.file} › ${f.name}\n`);
		}
	}
	process.stdout.write("\n");

	if (process.env.DEBUG_TIMINGS) {
		fileTimings.sort((a, b) => b.ms - a.ms);
		process.stdout.write("\nSlowest test files:\n");
		for (const t of fileTimings.slice(0, 10)) {
			process.stdout.write(`  ${t.ms}ms: ${t.file}\n`);
		}
	}

	if (total === 0 && process.env.TEST_GREP) {
		process.stderr.write(`no tests matched ${process.env.TEST_GREP}\n`);
		process.exit(1);
	}
	process.exit(totalFailed > 0 ? 1 : 0);
}

const queue =
	requestedFiles.length > 0
		? requestedFiles
		: [
				...HEAVIEST_TEST_FILES,
				...TEST_FILES.filter((f) => !HEAVIEST_TEST_FILES.includes(f)),
			].map((f) => resolve(__dirname, f));

// Sequential fallback for debugging or constrained single-thread environments
if (process.env.TEST_PARALLEL === "0") {
	for (const path of queue) {
		const file = displayName(path);
		resetTestStats();
		await import(path);
		await waitForPending();
		const stats = getTestStats();
		totalPassed += stats.passed;
		totalFailed += stats.failed;
		totalSkipped += stats.skipped;
		recordFailures(file, stats.failures);
	}
	finish();
}

// Parallel execution across CPU cores via a persistent worker pool
const workerPath = resolve(__dirname, "worker.js");
const concurrency = Math.max(
	1,
	os.availableParallelism?.() ?? os.cpus().length,
);

const workers = Array.from(
	{ length: Math.min(concurrency, queue.length) },
	() => {
		return new Worker(workerPath);
	},
);

async function runWorkerLoop(initialWorker) {
	let worker = initialWorker;
	while (queue.length > 0) {
		const fullPath = queue.shift();
		const file = displayName(fullPath);

		const t0 = performance.now();
		let workerDied = false;

		await new Promise((resolveTask) => {
			let timer;
			const cleanup = () => {
				clearTimeout(timer);
				worker.off("message", onMessage);
				worker.off("error", onError);
				worker.off("exit", onExit);
			};

			const die = (name, error, stderr) => {
				cleanup();
				workerDied = true;
				totalFailed++;
				allFailures.push({ file, name, error });
				if (stderr) process.stderr.write(stderr);
				resolveTask();
			};

			const onMessage = (msg) => {
				cleanup();

				if (msg.stdout) process.stdout.write(msg.stdout);
				if (msg.stderr) process.stderr.write(msg.stderr);

				fileTimings.push({ file, ms: Math.round(performance.now() - t0) });

				totalPassed += msg.ok ? msg.passed : 0;
				totalFailed += msg.ok ? msg.failed : msg.failed || 1;
				totalSkipped += msg.skipped || 0;
				recordFailures(file, msg.failures);
				resolveTask();
			};

			const onError = (err) =>
				die(
					"worker error",
					err?.stack || String(err),
					`Worker error in ${file}: ${err?.message}\n`,
				);

			const onExit = (code) => {
				if (code === 0) {
					cleanup();
					resolveTask();
					return;
				}
				die(
					"worker crashed",
					`Worker exited with code ${code}`,
					`Worker exited with code ${code} in ${file}\n`,
				);
			};

			timer = setTimeout(
				() =>
					die(
						"timed out",
						`file ran longer than ${fileTimeoutMs}ms`,
						`Timed out after ${fileTimeoutMs}ms in ${file}\n`,
					),
				fileTimeoutMs,
			);

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

finish();
