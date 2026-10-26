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

export function generateTestHarness(bundleJs, testNames, options = {}) {
	const runRegex = options.run ? options.run : null;
	const benchRegex = options.bench
		? options.bench === true
			? "."
			: options.bench
		: null;
	const benchNames = options.benchNames ?? [];
	const testMainName = options.testMain ?? null;
	const verbose = Boolean(options.verbose);
	const dom = Boolean(options.dom);
	const color = Boolean(options.color);
	const pkgName = options.pkgName ?? "main";
	// The harness runs from stdin with cwd = project dir, so a bare "jsdom"
	// import only works if the project has it locally. Use the resolved path.
	const jsdomSpec = options.jsdomPath
		? pathToFileURL(options.jsdomPath).href
		: "jsdom";

	const allFuncNames = [
		...new Set([
			...testNames,
			...benchNames,
			...(testMainName ? [testMainName] : []),
		]),
	];

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
  const allBenchmarks = ${JSON.stringify(benchNames)};
  const testMainName = ${JSON.stringify(testMainName)};
  const runFilter = ${runRegex ? `new RegExp(${JSON.stringify(runRegex)})` : "null"};
  const benchFilter = ${benchRegex ? `new RegExp(${JSON.stringify(benchRegex)})` : "null"};
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

  const benchesToRun = benchFilter
    ? allBenchmarks.filter((name) => benchFilter.test(name))
    : [];

  if (testsToRun.length === 0 && benchesToRun.length === 0) {
    if (allTests.length > 0 && runFilter) {
      console.log(yellow("testing: warning: no tests to run matching " + ${JSON.stringify(runRegex)}));
    }
    if (allBenchmarks.length > 0 && benchFilter) {
      console.log(yellow("testing: warning: no benchmarks to run matching " + ${JSON.stringify(benchRegex)}));
    }
    console.log(PASS);
    okLine(pkgName, "0.000");
    process.exit(0);
  }

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

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

  const reportBenchmark = (b) => {
    if (b.skipped) {
      console.log("--- " + SKIP + ": " + b._name);
      for (const log of b._logs) console.log("    " + log);
      return;
    }
    if (b.failed) {
      console.log("--- " + FAIL + ": " + b._name);
      for (const log of b._logs) console.log("    " + red(log));
      return;
    }
    const elapsedNs = Number(b.Elapsed());
    const nsPerOp = b.N > 0 ? (elapsedNs / b.N).toFixed(0) : "0";
    let line = \`\${b._name.padEnd(20)}\\t\${String(b.N).padStart(8)}\\t\${nsPerOp.padStart(10)} ns/op\`;
    if (b._bytes > 0n && elapsedNs > 0) {
      const mbPerSec = (Number(b._bytes * BigInt(b.N)) / (elapsedNs / 1e9) / (1024 * 1024)).toFixed(2);
      line += \`\\t\${mbPerSec.padStart(8)} MB/s\`;
    }
    console.log(line);
    for (const log of b._logs) console.log("    " + log);
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
${allFuncNames.map((n) => `    ${JSON.stringify(n)}: typeof ${n} !== "undefined" ? ${n} : null`).join(",\n")}
  };

  function runAll() {
    let totalFailures = 0;
    let totalSkipped = 0;
    const suiteStart = now();

    const finish = () => {
      const suiteElapsed = ((now() - suiteStart) / 1000).toFixed(3);
      if (totalFailures > 0) {
        console.log(FAIL);
        console.log(FAIL + "\\t" + pkgName + "\\t" + dim(suiteElapsed + "s"));
        return 1;
      } else {
        console.log(PASS);
        okLine(pkgName, suiteElapsed);
        return 0;
      }
    };

    const runOneTest = (name) => {
      const fn = __testRegistry[name] ?? (typeof globalThis[name] === "function" ? globalThis[name] : null);
      if (typeof fn !== "function") {
        console.error(red("testing: cannot find test function " + name));
        totalFailures++;
        return null;
      }

      const t = new __GoFront_T(name);
      if (verbose) console.log(dim("=== RUN   ") + name);

      let res;
      try {
        res = fn(t);
      } catch (e) {
        recordTestError(t, e);
        t._runCleanups();
        if (t.skipped) totalSkipped++;
        else if (t.failed) totalFailures++;
        report(t);
        return null;
      }

      if (res && typeof res.then === "function") {
        return res
          .catch((e) => { recordTestError(t, e); })
          .finally(() => {
            t._runCleanups();
            if (t.skipped) totalSkipped++;
            else if (t.failed) totalFailures++;
            report(t);
          });
      }

      t._runCleanups();
      if (t.skipped) totalSkipped++;
      else if (t.failed) totalFailures++;
      report(t);
      return null;
    };

    const runOneBench = (name) => {
      const fn = __testRegistry[name] ?? (typeof globalThis[name] === "function" ? globalThis[name] : null);
      if (typeof fn !== "function") {
        console.error(red("testing: cannot find benchmark function " + name));
        totalFailures++;
        return null;
      }
      if (verbose) console.log(dim("=== RUN   ") + name);
      const b = new __GoFront_B(name);
      b._benchDurationNs = 1e8; // 100ms
      const runIters = () => {
        b.N = 1;
        b.ResetTimer();
        const res = fn(b);
        if (res && typeof res.then === "function") {
          return res.then(() => loopBench(b, fn));
        }
        return loopBench(b, fn);
      };
      const loopBench = (b, fn) => {
        if (!b._loopStarted && !b.failed && !b.skipped) {
          b.StopTimer();
          b._runCleanups();
          let n = 1;
          while (!b.failed && !b.skipped) {
            const elapsedNs = Number(b.Elapsed());
            if (elapsedNs >= b._benchDurationNs || n >= 1e9) break;
            let nextN;
            if (elapsedNs === 0) nextN = n * 100;
            else nextN = Math.max(n + 1, Math.min(1e9, Math.floor(n * (b._benchDurationNs / elapsedNs) * 1.2)));
            if (nextN <= n) break;
            n = nextN;
            const nextB = new __GoFront_B(name);
            nextB._benchDurationNs = b._benchDurationNs;
            nextB.N = n;
            nextB.ResetTimer();
            const res = fn(nextB);
            if (res && typeof res.then === "function") {
              return res.then(() => {
                nextB.StopTimer();
                nextB._runCleanups();
                b.N = nextB.N;
                b._elapsedMs = nextB._elapsedMs;
                b._timerRunning = false;
                b.failed = nextB.failed;
                b.skipped = nextB.skipped;
                b._logs = nextB._logs;
              });
            }
            nextB.StopTimer();
            nextB._runCleanups();
            b.N = nextB.N;
            b._elapsedMs = nextB._elapsedMs;
            b._timerRunning = false;
            b.failed = nextB.failed;
            b.skipped = nextB.skipped;
            b._logs = nextB._logs;
          }
        }
      };

      let res;
      try {
        res = runIters();
      } catch (e) {
        recordTestError(b, e);
        b._runCleanups();
        if (b.failed) totalFailures++;
        else if (b.skipped) totalSkipped++;
        reportBenchmark(b);
        return null;
      }

      if (res && typeof res.then === "function") {
        return res
          .catch((e) => { recordTestError(b, e); })
          .finally(() => {
            b._runCleanups();
            if (b.failed) totalFailures++;
            else if (b.skipped) totalSkipped++;
            reportBenchmark(b);
          });
      }

      b._runCleanups();
      if (b.failed) totalFailures++;
      else if (b.skipped) totalSkipped++;
      reportBenchmark(b);
      return null;
    };

    let ti = 0;
    while (ti < testsToRun.length) {
      const p = runOneTest(testsToRun[ti++]);
      if (p) {
        return p.then(async () => {
          while (ti < testsToRun.length) {
            const nextP = runOneTest(testsToRun[ti++]);
            if (nextP) await nextP;
          }
          for (const bName of benchesToRun) {
            const nextP = runOneBench(bName);
            if (nextP) await nextP;
          }
          return finish();
        });
      }
    }

    let bi = 0;
    while (bi < benchesToRun.length) {
      const p = runOneBench(benchesToRun[bi++]);
      if (p) {
        return p.then(async () => {
          while (bi < benchesToRun.length) {
            const nextP = runOneBench(benchesToRun[bi++]);
            if (nextP) await nextP;
          }
          return finish();
        });
      }
    }

    return finish();
  }

  if (testMainName) {
    const mainFn = __testRegistry[testMainName] ?? (typeof globalThis[testMainName] === "function" ? globalThis[testMainName] : null);
    if (typeof mainFn === "function") {
      let exitCode = 0;
      const m = new __GoFront_M(() => {
        const res = runAll();
        if (res && typeof res.then === "function") {
          return res.then((code) => { exitCode = code; return code; });
        }
        exitCode = res;
        return exitCode;
      });
      try {
        const res = mainFn(m);
        if (res && typeof res.then === "function") await res;
      } catch (e) {
        console.error(red("panic in TestMain: " + (e?.message ?? String(e))));
        process.exit(1);
      }
      if (m._promise) await m._promise;
      process.exit(exitCode);
    }
  }

  const res = runAll();
  const exitCode = res && typeof res.then === "function" ? await res : res;
  process.exit(exitCode);
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
	const benchNames = discoverBenchmarks(programs);
	const testMain = discoverTestMain(programs);

	if (testNames.length === 0 && benchNames.length === 0 && !testMain) {
		return reportEmptyTests(pkgName, "no tests to run", options);
	}

	const runHarness = (bundleJs, label, wasmBytes) =>
		spawnTestRunner(
			resolvedDir,
			generateTestHarness(bundleJs, testNames, {
				...options,
				benchNames,
				testMain,
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
		return runDualTarget(compiled, resolvedDir, runHarness, options);
	}
	return runHarness(js, pkgName, compiled.wasm ?? null);
}
