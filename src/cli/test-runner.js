// GoFront native test runner and harness generator.
// Handles test function discovery, test harness emission, and subprocess execution.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	compilePackageTests,
	compilePackageTestsWasm,
	gwFilesIn,
} from "../compiler.js";
import { colorEnabled, createColors, formatDiagnostic } from "./colors.js";

// WasmGC + exception handling (what the wasm backend emits) ship enabled by
// default from Node 22 (V8 11.9+). Older runtimes fail at instantiate time
// with an opaque CompileError, so check up front and explain.
export const MIN_WASM_NODE_MAJOR = 22;

export function checkWasmRuntime(version = process.version) {
	const major = Number.parseInt(version.replace(/^v/, ""), 10);
	if (Number.isNaN(major) || major >= MIN_WASM_NODE_MAJOR) return;
	throw new Error(
		`running wasm packages requires Node ${MIN_WASM_NODE_MAJOR}+ (WasmGC); found ${version}\n  hint: upgrade Node, or compile with --js-only to run the JS backend instead`,
	);
}

export function isTestFunc(decl) {
	if (decl.kind !== "FuncDecl") return false;
	if (!decl.name.startsWith("Test")) return false;
	if (decl.name === "TestMain") return false;
	if (decl.params?.length !== 1) return false;
	const pType = decl.params[0].type;
	if (
		pType?.kind === "PointerType" &&
		(pType.base?.name === "testing.T" || pType.base?.name === "T")
	)
		return true;
	if (
		pType?.kind === "TypeName" &&
		(pType.name === "testing.T" || pType.name === "T")
	)
		return true;
	return false;
}

export function isBenchmarkFunc(decl) {
	if (decl.kind !== "FuncDecl") return false;
	if (!decl.name.startsWith("Benchmark")) return false;
	if (decl.params?.length !== 1) return false;
	const pType = decl.params[0].type;
	if (
		pType?.kind === "PointerType" &&
		(pType.base?.name === "testing.B" || pType.base?.name === "B")
	)
		return true;
	if (
		pType?.kind === "TypeName" &&
		(pType.name === "testing.B" || pType.name === "B")
	)
		return true;
	return false;
}

export function isTestMainFunc(decl) {
	if (decl.kind !== "FuncDecl") return false;
	if (decl.name !== "TestMain") return false;
	if (decl.params?.length !== 1) return false;
	const pType = decl.params[0].type;
	if (
		pType?.kind === "PointerType" &&
		(pType.base?.name === "testing.M" || pType.base?.name === "M")
	)
		return true;
	if (
		pType?.kind === "TypeName" &&
		(pType.name === "testing.M" || pType.name === "M")
	)
		return true;
	return false;
}

// Only programs from *_test.go files are scanned, matching Go. Programs
// without a `_filename` (constructed by hand) are treated as test files.
export function discoverTests(programs) {
	const testNames = [];
	for (const p of programs) {
		if (p._filename && !p._filename.endsWith("_test.go")) continue;
		for (const d of p.decls) {
			if (isTestFunc(d) && !testNames.includes(d.name)) {
				testNames.push(d.name);
			}
		}
	}
	return testNames;
}

// The `async func Test…` names (js packages only).
export function discoverAsyncTests(programs) {
	const names = [];
	for (const p of programs) {
		if (p._filename && !p._filename.endsWith("_test.go")) continue;
		for (const d of p.decls) {
			if (isTestFunc(d) && (d.async || d.isAsync) && !names.includes(d.name))
				names.push(d.name);
		}
	}
	return names;
}

export function discoverBenchmarks(programs) {
	const benchNames = [];
	for (const p of programs) {
		if (p._filename && !p._filename.endsWith("_test.go")) continue;
		for (const d of p.decls) {
			if (isBenchmarkFunc(d) && !benchNames.includes(d.name)) {
				benchNames.push(d.name);
			}
		}
	}
	return benchNames;
}

export function discoverTestMain(programs) {
	for (const p of programs) {
		if (p._filename && !p._filename.endsWith("_test.go")) continue;
		for (const d of p.decls) {
			if (isTestMainFunc(d)) return d.name;
		}
	}
	return null;
}

// The Go source of the driver the runner compiles with a package's tests (see
// `testDriver` in compileFiles; it is never written to disk). `target` is the
// package's target: a `js` package is driven asynchronously so that async
// tests and subtests can be awaited; a TestMain gets the M and runs it
// itself.
export function generateTestDriver(
	pkgName,
	target,
	{ testNames, benchNames, testMain, asyncTests = [] },
) {
	if (testMain && asyncTests.length > 0) {
		throw new Error(
			`async test functions cannot be combined with TestMain (${asyncTests.join(", ")}): remove TestMain or make the tests synchronous`,
		);
	}
	const entries = (names, _type) =>
		names.map((n) => `\t\t{Name: ${JSON.stringify(n)}, F: ${n}},`).join("\n");
	const table = (type, names) =>
		names.length === 0
			? `[]testing.${type}{}`
			: `[]testing.${type}{\n${entries(names)}\n\t}`;
	const make = `\tm := testing.GofrontMain(${JSON.stringify(pkgName)}, run, bench, verbose, ${table("GofrontTest", testNames)}, ${table("GofrontBenchmark", benchNames)})`;
	let body;
	let head = "func";
	if (testMain) {
		body = `\tTestMain(m)\n\treturn m.ExitCode()`;
	} else if (target === "js") {
		head = "async func";
		body = "\treturn await m.RunAsync()";
	} else {
		body = "\treturn m.Run()";
	}
	return `package ${pkgName}

import "testing"

${head} GofrontRunTests(run, bench string, verbose bool) int {
${make}
${body}
}
`;
}

// The module the test child process runs: the compiled package (with its
// driver), then one call to GofrontRunTests. Everything else (running,
// filtering, reporting) happens inside the package.
export function generateTestHarness(bundleJs, options = {}) {
	const verbose = Boolean(options.verbose);
	const dom = Boolean(options.dom);
	const color = Boolean(options.color);
	const pkgName = options.pkgName ?? "main";
	// The harness runs from stdin with cwd = project dir, so a bare "jsdom"
	// import only works if the project has it locally. Use the resolved path.
	const jsdomSpec = options.jsdomPath
		? pathToFileURL(options.jsdomPath).href
		: "jsdom";
	const run = options.run ?? "";
	const bench = options.bench
		? options.bench === true
			? "."
			: options.bench
		: "";

	return `
${
	dom
		? `import { JSDOM } from ${JSON.stringify(jsdomSpec)};
const __dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
globalThis.window = __dom.window;
globalThis.document = __dom.window.document;
try {
  Object.defineProperty(globalThis, "navigator", {
    value: __dom.window.navigator,
    configurable: true,
    writable: true,
  });
} catch {
  try { globalThis.navigator = __dom.window.navigator; } catch {}
}
globalThis.location = __dom.window.location;
globalThis.history = __dom.window.history;
globalThis.HTMLElement = __dom.window.HTMLElement;
globalThis.Element = __dom.window.Element;
globalThis.Node = __dom.window.Node;
globalThis.customElements = __dom.window.customElements;
`
		: `globalThis.window = globalThis.window ?? null;
globalThis.document = globalThis.document ?? null;
`
}
// The package line and colours the testing package prints come from here.
process.env.GOFRONT_TEST_LABEL = ${JSON.stringify(pkgName)};
process.env.GOFRONT_TEST_COLOR = ${color ? '"1"' : '"0"'};
${
	options.wasmBytes
		? `globalThis.__GOFRONT_WASM_BYTES = Uint8Array.from(atob(${JSON.stringify(Buffer.from(options.wasmBytes).toString("base64"))}), (c) => c.charCodeAt(0));
`
		: ""
}
// ── Compiled Package Bundle ──
${bundleJs}
// ─────────────────────────────

let __exitCode = 1;
try {
  __exitCode = Number(await GofrontRunTests(${JSON.stringify(run)}, ${JSON.stringify(bench)}, ${verbose}));
} catch (e) {
  console.error("panic: " + (e?.message ?? String(e)));
}
process.exit(__exitCode);
`;
}

// Project-local jsdom wins; fall back to the one next to GoFront (global/npx installs).
export function resolveJsdomPath(projectDir) {
	for (const from of [join(projectDir, "dummy.js"), import.meta.url]) {
		try {
			return createRequire(from).resolve("jsdom");
		} catch {}
	}
	return null;
}

function validateTestOptions(options, resolvedDir) {
	if (options.run) {
		try {
			new RegExp(options.run);
		} catch (e) {
			throw new Error(`gofront: invalid regex for -run: ${e.message}`);
		}
	}

	let jsdomPath = null;
	if (options.dom) {
		jsdomPath = resolveJsdomPath(resolvedDir);
		if (!jsdomPath) {
			throw new Error(
				"gofront: --dom requires 'jsdom' to be installed. Run 'npm install --save-dev jsdom' to enable DOM testing.",
			);
		}
	}
	return { jsdomPath };
}

function reportEmptyTests(label, reason, options) {
	const out = `?   \t${label}\t[${reason}]\n`;
	if (options.captureOutput) {
		return { exitCode: 0, stdout: out, stderr: "", noTests: true };
	}
	const dest = options.stdout ?? process.stdout;
	dest.write(colorsFor(options, dest).dim(out));
	return { exitCode: 0, noTests: true };
}

// Color is decided here because the harness child writes to a pipe, not a TTY.
function colorsFor(options, stream) {
	const enabled =
		options.color ?? (!options.captureOutput && colorEnabled(stream));
	return createColors(enabled);
}

function spawnTestRunner(resolvedDir, harnessJs, testCount, options) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(process.execPath, ["--input-type=module", "-"], {
			cwd: resolvedDir,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			const str = chunk.toString();
			if (options.captureOutput) {
				stdout += str;
			} else {
				(options.stdout ?? process.stdout).write(str);
			}
		});

		child.stderr.on("data", (chunk) => {
			const str = chunk.toString();
			if (options.captureOutput) {
				stderr += str;
			} else {
				(options.stderr ?? process.stderr).write(str);
			}
		});

		child.on("error", (err) => {
			rejectPromise(err);
		});

		child.on("close", (exitCode) => {
			resolvePromise({
				exitCode: exitCode ?? 0,
				stdout,
				stderr,
				testCount,
			});
		});

		child.stdin.on("error", () => {});
		child.stdin.end(harnessJs);
	});
}

function reportBuildFailure(err, resolvedDir, options) {
	const msg = err?.message ?? String(err);
	if (options.captureOutput) {
		const out = `FAIL\t${basename(resolvedDir)} [build failed]\n${msg}\n`;
		return { exitCode: 1, stdout: "", stderr: out };
	}
	const dest = options.stderr ?? process.stderr;
	const c = colorsFor(options, dest);
	dest.write(
		`${c.bold(c.red("FAIL"))}\t${basename(resolvedDir)} ${c.red("[build failed]")}\n${formatDiagnostic(msg, c)}\n`,
	);
	return { exitCode: 1 };
}

// `both` packages run twice (JS and wasm) so the two backends are kept in
// agreement; output of both runs is concatenated.
async function runDualTarget(
	compiled,
	resolvedDir,
	runHarness,
	compileOptions,
	options,
) {
	let wasmCompiled;
	try {
		wasmCompiled = compilePackageTestsWasm(resolvedDir, compileOptions);
	} catch (err) {
		return reportBuildFailure(err, resolvedDir, options);
	}
	const label = compiled.pkgName;
	const jsRun = await runHarness(compiled.js, `${label} [js]`, null);
	const wasmRun = await runHarness(
		wasmCompiled.js,
		`${label} [wasm]`,
		wasmCompiled.wasm,
	);
	return {
		exitCode: jsRun.exitCode !== 0 ? jsRun.exitCode : wasmRun.exitCode,
		stdout: jsRun.stdout + wasmRun.stdout,
		stderr: jsRun.stderr + wasmRun.stderr,
		testCount: jsRun.testCount + wasmRun.testCount,
	};
}

export async function runTests(targetDir, options = {}) {
	let resolvedDir = resolve(targetDir);
	try {
		if (statSync(resolvedDir).isFile()) {
			resolvedDir = dirname(resolvedDir);
		}
	} catch {}
	const { jsdomPath } = validateTestOptions(options, resolvedDir);

	const allFiles = gwFilesIn(resolvedDir, { includeTests: true });
	if (allFiles.length === 0) {
		throw new Error(`No .go files found in ${targetDir}`);
	}

	const testFiles = allFiles.filter((f) => f.endsWith("_test.go"));
	if (testFiles.length === 0) {
		return reportEmptyTests(basename(resolvedDir), "no test files", options);
	}

	// The driver is generated while the package compiles, once its files are
	// parsed and its target is known.
	let testNames = [];
	let benchNames = [];
	let testMain = null;
	const compileOptions = {
		...options,
		testDriver: (programs, target) => {
			testNames = discoverTests(programs);
			benchNames = discoverBenchmarks(programs);
			testMain = discoverTestMain(programs);
			if (testNames.length === 0 && benchNames.length === 0 && !testMain)
				return null;
			return generateTestDriver(programs[0].pkg.name, target, {
				testNames,
				benchNames,
				testMain,
				asyncTests: discoverAsyncTests(programs),
			});
		},
	};
	let compiled;
	try {
		compiled = compilePackageTests(resolvedDir, compileOptions);
	} catch (err) {
		return reportBuildFailure(err, resolvedDir, options);
	}

	const { pkgName, js } = compiled;
	if (testNames.length === 0 && benchNames.length === 0 && !testMain) {
		return reportEmptyTests(pkgName, "no tests to run", options);
	}

	const runHarness = (bundleJs, label, wasmBytes) =>
		spawnTestRunner(
			resolvedDir,
			generateTestHarness(bundleJs, {
				...options,
				pkgName: label,
				jsdomPath,
				wasmBytes,
				color: colorsFor(options, options.stdout ?? process.stdout).enabled,
			}),
			testNames.length + benchNames.length,
			options,
		);

	// `wasm` packages run inside the linked app.wasm; `js` packages that import
	// wasm packages need the linked module too (hybrid packages).
	if (compiled.target === "both" || compiled.wasm) {
		try {
			checkWasmRuntime();
		} catch (err) {
			return reportBuildFailure(err, resolvedDir, options);
		}
	}
	if (compiled.target === "both") {
		return runDualTarget(
			compiled,
			resolvedDir,
			runHarness,
			compileOptions,
			options,
		);
	}
	return runHarness(js, pkgName, compiled.wasm ?? null);
}
