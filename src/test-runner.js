// GoFront native test runner and harness generator.
// Handles test function discovery, test harness emission, and subprocess execution.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HELPER_SPRINTF, HELPER_TESTING } from "./backend/js/runtime.js";
import { colorEnabled, createColors, formatDiagnostic } from "./colors.js";
import {
	compilePackageTests,
	compilePackageTestsWasm,
	gwFilesIn,
} from "./compiler.js";

export function isTestFunc(decl) {
	if (decl.kind !== "FuncDecl") return false;
	if (!decl.name.startsWith("Test")) return false;
	if (decl.params?.length !== 1) return false;
	const pType = decl.params[0].type;
	if (pType?.kind === "PointerType" && pType.base?.name === "testing.T")
		return true;
	if (pType?.kind === "TypeName" && pType.name === "testing.T") return true;
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

export function generateTestHarness(bundleJs, testNames, options = {}) {
	const runRegex = options.run ? options.run : null;
	const verbose = Boolean(options.verbose);
	const dom = Boolean(options.dom);
	const color = Boolean(options.color);
	const pkgName = options.pkgName ?? "main";
	// The harness runs from stdin with cwd = project dir, so a bare "jsdom"
	// import only works if the project has it locally. Use the resolved path.
	const jsdomSpec = options.jsdomPath
		? pathToFileURL(options.jsdomPath).href
		: "jsdom";

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
globalThis.__gofront_verbose = ${verbose};
${
	options.wasmBytes
		? `
// ── WASM module (tests run inside app.wasm; *testing.T stays in JS) ──
${HELPER_SPRINTF}
${HELPER_TESTING}
globalThis.__GOFRONT_WASM_BYTES = Uint8Array.from(atob(${JSON.stringify(Buffer.from(options.wasmBytes).toString("base64"))}), (c) => c.charCodeAt(0));
`
		: ""
}
// ── Compiled Package Bundle ──
${bundleJs}
// ─────────────────────────────

async function __runGoFrontSuite() {
  const allTests = ${JSON.stringify(testNames)};
  const runFilter = ${runRegex ? `new RegExp(${JSON.stringify(runRegex)})` : "null"};
  const verbose = ${verbose};
  const pkgName = ${JSON.stringify(pkgName)};
  const paint = ${color}
    ? (code) => (s) => "\\x1b[" + code + "m" + s + "\\x1b[0m"
    : () => (s) => s;
  const red = paint(31), green = paint(32), yellow = paint(33), dim = paint(2), bold = paint(1);
  const PASS = green("PASS"), FAIL = bold(red("FAIL")), SKIP = yellow("SKIP");
  const okLine = (name, t) => console.log(green("ok  ") + "\\t" + name + "\\t" + dim(t + "s"));

  const testsToRun = runFilter
    ? allTests.filter((name) => runFilter.test(name))
    : allTests;

  if (testsToRun.length === 0) {
    if (allTests.length > 0 && runFilter) {
      console.log(yellow("testing: warning: no tests to run matching " + ${JSON.stringify(runRegex)}));
    }
    console.log(PASS);
    okLine(pkgName, "0.000");
    process.exit(0);
  }

  let totalFailures = 0;
  let totalSkipped = 0;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const suiteStart = now();

  // Go-style streaming report. In non-verbose mode only failures and skips are
  // shown, so the "=== RUN" header is emitted late for failures.
  const report = (t) => {
    const elapsed = dim("(" + ((now() - t._start) / 1000).toFixed(2) + "s)");
    if (t.skipped) {
      console.log("--- " + SKIP + ": " + t._name + " " + elapsed);
      for (const log of t._logs) console.log("    " + log);
    } else if (t.failed) {
      if (!verbose) console.log(dim("=== RUN   ") + t._name);
      for (const log of t._logs) console.log("    " + red(log));
      console.log("--- " + FAIL + ": " + t._name + " " + elapsed);
    } else if (verbose) {
      for (const log of t._logs) console.log("    " + log);
      console.log("--- " + PASS + ": " + t._name + " " + elapsed);
    }
  };

  // FailNow/SkipNow are control flow; anything else is a panic → failure.
  const recordTestError = (t, e) => {
    if (e instanceof __GoFront_FailNow || e instanceof __GoFront_SkipNow) return;
    t.Fail();
    t.Log("panic: " + (e?.message ?? String(e)));
  };

  globalThis.__onSubtestStart = (name) => {
    if (verbose) console.log(dim("=== RUN   ") + name);
  };
  globalThis.__onSubtestEnd = report;

  const __testRegistry = {
${testNames.map((n) => `    ${JSON.stringify(n)}: typeof ${n} !== "undefined" ? ${n} : null`).join(",\n")}
  };

  for (const name of testsToRun) {
    const fn = __testRegistry[name] ?? (typeof globalThis[name] === "function" ? globalThis[name] : null);
    if (typeof fn !== "function") {
      console.error(red("testing: cannot find test function " + name));
      totalFailures++;
      continue;
    }

    const t = new __GoFront_T(name);
    if (verbose) console.log(dim("=== RUN   ") + name);

    try {
      const res = fn(t);
      if (res && typeof res.then === "function") await res;
    } catch (e) {
      recordTestError(t, e);
    }

    if (t.skipped) totalSkipped++;
    else if (t.failed) totalFailures++;
    report(t);
  }

  const suiteElapsed = ((now() - suiteStart) / 1000).toFixed(3);

  if (totalFailures > 0) {
    console.log(FAIL);
    console.log(FAIL + "\\t" + pkgName + "\\t" + dim(suiteElapsed + "s"));
    process.exit(1);
  } else {
    console.log(PASS);
    okLine(pkgName, suiteElapsed);
    process.exit(0);
  }
}

__runGoFrontSuite();
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
async function runDualTarget(compiled, resolvedDir, runHarness, options) {
	let wasmCompiled;
	try {
		wasmCompiled = compilePackageTestsWasm(resolvedDir, options);
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

	let compiled;
	try {
		compiled = compilePackageTests(resolvedDir, options);
	} catch (err) {
		return reportBuildFailure(err, resolvedDir, options);
	}

	const { pkgName, js, programs } = compiled;
	const testNames = discoverTests(programs);

	if (testNames.length === 0) {
		return reportEmptyTests(pkgName, "no tests to run", options);
	}

	const runHarness = (bundleJs, label, wasmBytes) =>
		spawnTestRunner(
			resolvedDir,
			generateTestHarness(bundleJs, testNames, {
				...options,
				pkgName: label,
				jsdomPath,
				wasmBytes,
				color: colorsFor(options, options.stdout ?? process.stdout).enabled,
			}),
			testNames.length,
			options,
		);

	// `wasm` packages run inside the linked app.wasm.
	if (compiled.target === "both") {
		return runDualTarget(compiled, resolvedDir, runHarness, options);
	}
	return runHarness(
		js,
		pkgName,
		compiled.target === "wasm" ? compiled.wasm : null,
	);
}
