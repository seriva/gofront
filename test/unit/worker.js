// test/unit/worker.js
// Persistent worker thread for parallel test execution.
import { pathToFileURL } from "node:url";
import { parentPort } from "node:worker_threads";
import { getTestStats, resetTestStats, waitForPending } from "./helpers.js";

// Intercept stdout and stderr so each test file's output is buffered per test file
let capturedStdout = "";
let capturedStderr = "";

process.stdout.write = (chunk, _enc, cb) => {
	capturedStdout += typeof chunk === "string" ? chunk : chunk.toString();
	if (typeof cb === "function") cb();
	return true;
};

process.stderr.write = (chunk, _enc, cb) => {
	capturedStderr += typeof chunk === "string" ? chunk : chunk.toString();
	if (typeof cb === "function") cb();
	return true;
};

parentPort.on("message", async (msg) => {
	if (msg.done) {
		process.exit(0);
	}

	const { file } = msg;
	capturedStdout = "";
	capturedStderr = "";
	resetTestStats();

	try {
		await import(pathToFileURL(file).href);
		await waitForPending();
		const stats = getTestStats();
		parentPort.postMessage({
			ok: true,
			file,
			stdout: capturedStdout,
			stderr: capturedStderr,
			...stats,
		});
	} catch (error) {
		parentPort.postMessage({
			ok: false,
			file,
			stdout: capturedStdout,
			stderr: `${capturedStderr + (error?.stack || String(error))}\n`,
			passed: 0,
			failed: 1,
			failures: [{ name: file, error: error?.stack || String(error) }],
		});
	}
});
