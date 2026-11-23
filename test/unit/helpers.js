// GoFront test helpers — shared across all test files
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { isMainThread } from "node:worker_threads";
import { checkSyntax } from "../../scripts/build-examples.js";
import { instantiateWasm } from "../../src/backend/wasm/glue.js";
import {
	CompileError,
	compileDir,
	compileFiles,
	compileWasm as compileWasmSource,
	evictParseCache,
} from "../../src/compiler.js";
import {
	DtsParser,
	parseDeclarationPackage,
	parseDts,
} from "../../src/dts-parser.js";
import { Lexer } from "../../src/lexer/lexer.js";
import { Parser } from "../../src/parser/index.js";
import { isBuiltinPackage, resolveStdlibSource } from "../../src/resolver.js";

export {
	checkSyntax,
	compileDir,
	DtsParser,
	instantiateWasm,
	join,
	Lexer,
	Parser,
	parseDeclarationPackage,
	parseDts,
};

export function withTempDir(files, fn) {
	if (typeof files === "function") {
		fn = files;
		files = {};
	}
	const dir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	const cleanup = () => {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	};
	try {
		if (files) {
			for (const [relPath, content] of Object.entries(files)) {
				const fullPath = join(dir, relPath);
				mkdirSync(dirname(fullPath), { recursive: true });
				writeFileSync(fullPath, content);
			}
		}
		const res = fn(dir);
		if (res && typeof res.then === "function") {
			return res.finally(cleanup);
		}
		cleanup();
		return res;
	} catch (err) {
		cleanup();
		throw err;
	}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ROOT = resolve(__dirname, "../..");
export const FIXTURES = join(__dirname, "fixtures");

// ── Compiler ─────────────────────────────────────────────────

// Whether the program imports a package that exists only as Go source under
// stdlib/ (no typechecker table).  The in-memory `compile` and `compileWasm`
// helpers do not link those; they go through `compileFiles` instead.
function importsGoSourceStdlib(ast, source = "") {
	// `fmt`, `gom` and `regexp` need no import in a js package.
	if (/\b(?:fmt|gom|regexp)\./.test(source)) return true;
	return ast.imports.some((imp) =>
		imp.imports.some(
			({ path }) =>
				!path.startsWith("js:") &&
				!path.startsWith(".") &&
				!isBuiltinPackage(path) &&
				resolveStdlibSource(path) !== null,
		),
	);
}

// Runs `fn`; a `CompileError` comes back as `{ res: null, errors }` and any
// other exception (a compiler crash) propagates so the test fails with it.
export function toCompileResult(fn) {
	try {
		return { res: fn(), errors: [] };
	} catch (e) {
		if (e instanceof CompileError) return { res: null, errors: e.errors };
		throw e;
	}
}

// `compileFiles` for one in-memory source, written as `fileName` in a fresh
// temp dir. Imports resolve from `options.fromDir` when given.
function compileSourceFile(source, target, options = {}) {
	const { fileName = "main.go", ...rest } = options;
	const dir = mkdtempSync(join(tmpdir(), "gofront-source-"));
	const goPath = join(dir, fileName);
	try {
		writeFileSync(goPath, source);
		return toCompileResult(() =>
			compileFiles([goPath], {
				...(target ? { forceTarget: target } : {}),
				...rest,
			}),
		);
	} finally {
		evictParseCache(goPath);
		rmSync(dir, { recursive: true, force: true });
	}
}

export function compileWasm(source, options = {}) {
	const ast = new Parser(
		new Lexer(source, "main.go").tokenize(),
		"main.go",
		source,
	).parse();
	if (!importsGoSourceStdlib(ast, source))
		return compileWasmSource(source, options);
	const { res, errors } = compileSourceFile(source, "wasm", {
		exportAll: options.exportAll ?? true,
		emitWat: options.emitWat,
	});
	return errors.length > 0
		? { wasm: null, errors }
		: { ...res, stringTable: res.stringTable ?? [], errors: [] };
}

export function compile(
	source,
	{
		fromFile = join(FIXTURES, "_dummy.go"),
		strict = false,
		target = null,
		jsRoots,
	} = {},
) {
	const { res, errors } = compileSourceFile(source, target, {
		strict,
		jsRoots,
		fileName: basename(fromFile),
		fromDir: dirname(resolve(fromFile)),
	});
	return errors.length > 0
		? { js: null, errors }
		: { js: res.js, errors: [], warnings: res.warnings };
}

// Compiles `source` (the one Go file of a package) next to `types.d.ts`,
// which the source imports as `js:./types.d.ts`.
export function compileDts(dts, source, options = {}) {
	return withTempDir({ "types.d.ts": dts, "main.go": source }, (dir) => {
		const { res, errors } = toCompileResult(() => compileDir(dir, options));
		return errors.length > 0
			? { js: null, errors }
			: { js: res.js, errors: [], warnings: res.warnings };
	});
}

export function compileFile(path) {
	return compile(readFileSync(path, "utf8"), { fromFile: path });
}

// ── Runners ──────────────────────────────────────────────────

function stripImports(js) {
	return js.replace(/^import\s[^;]+;\n?/gm, "");
}

export function runJs(js, extraGlobals = {}) {
	if (!js) throw new Error("runJs: js is null — compilation likely failed");
	const lines = [];
	const ctx = vm.createContext({
		Math,
		JSON,
		String,
		Number,
		Boolean,
		Array,
		Object,
		TextEncoder,
		TextDecoder,
		console: {
			log: (...args) => lines.push(args.map((a) => String(a)).join(" ")),
		},
		...extraGlobals,
	});
	try {
		vm.runInContext(stripImports(js), ctx);
	} catch (e) {
		throw new Error(`Runtime error in generated JS: ${e.message}`);
	}
	// A host without `process` prints whole lines; the partial last line of
	// os.Stdout (fmt.Print) is still buffered.
	if (ctx.__os_buf) lines.push(ctx.__os_buf);
	return lines.join("\n");
}

const _require = createRequire(import.meta.url);
let _JSDOM;

export function runInDom(
	js,
	html = "<!DOCTYPE html><html><body></body></html>",
) {
	if (!_JSDOM) {
		_JSDOM = _require("jsdom").JSDOM;
	}
	const dom = new _JSDOM(html);
	const { window } = dom;
	const lines = [];
	const ctx = vm.createContext({
		Math,
		JSON,
		String,
		Number,
		Boolean,
		Array,
		Object,
		TextDecoder,
		TextEncoder,
		document: window.document,
		console: {
			log: (...args) => lines.push(args.map((a) => String(a)).join(" ")),
		},
	});
	vm.runInContext(stripImports(js), ctx);
	return { lines, document: window.document };
}

export function runWasm(
	wasmBytes,
	{ stringTable = [], extraImports = {} } = {},
) {
	assertValidWasm(wasmBytes);
	const lines = [];
	const { exports, instance, module } = instantiateWasm(wasmBytes, {
		stringTable,
		stdout: (msg) => lines.push(msg),
		extraImports,
	});
	return { exports, lines, instance, module };
}

// Every module produced in tests must pass the engine's validator — a
// module that instantiates lazily could otherwise hide an encoding bug in a
// function the test never calls.
export function assertValidWasm(bytes) {
	if (!WebAssembly.validate(bytes)) {
		let detail = "";
		try {
			new WebAssembly.Module(bytes);
		} catch (e) {
			detail = `: ${e.message}`;
		}
		throw new Error(`WebAssembly.validate failed${detail}`);
	}
}

export function compileHybrid(source, options = {}) {
	const { js, errors: jsErrors } = compile(source, {
		strict: true,
		...options,
	});
	if (jsErrors && jsErrors.length > 0) {
		throw new Error(
			`JS compile failed:\n${jsErrors.map((e) => e.message).join("\n")}`,
		);
	}

	const {
		wasm,
		stringTable,
		wat,
		errors: wasmErrors,
	} = compileWasm(source, options);
	if (wasmErrors && wasmErrors.length > 0) {
		throw new Error(
			`WASM compile failed:\n${wasmErrors.map((e) => e.message).join("\n")}`,
		);
	}
	assertValidWasm(wasm);

	return {
		js,
		wasm,
		wat,
		stringTable,
		run(fnName = "Main", args = []) {
			const jsLines = [];
			let jsRes;
			let jsErr = null;
			let stdoutBuf = "";
			const jsCtx = vm.createContext({
				Math,
				Date,
				JSON,
				String,
				Number,
				Boolean,
				Array,
				Object,
				TextEncoder,
				TextDecoder,
				crypto: globalThis.crypto,
				get __GOFRONT_CLOCK() {
					return globalThis.__GOFRONT_CLOCK;
				},
				process: {
					stdout: {
						write: (s) => {
							stdoutBuf += s;
							if (stdoutBuf.includes("\n")) {
								const lines = stdoutBuf.split("\n");
								stdoutBuf = lines.pop();
								for (const l of lines) jsLines.push(l);
							}
						},
					},
				},
				console: {
					log: (...a) => {
						if (stdoutBuf) {
							jsLines.push(stdoutBuf + a.map(String).join(" "));
							stdoutBuf = "";
						} else {
							jsLines.push(a.map(String).join(" "));
						}
					},
				},
			});
			try {
				vm.runInContext(stripImports(js), jsCtx);
				if (typeof jsCtx[fnName] === "function") {
					jsRes = jsCtx[fnName](...args);
				}
				if (stdoutBuf) {
					jsLines.push(stdoutBuf);
					stdoutBuf = "";
				}
			} catch (e) {
				jsErr = e;
			}

			const wasmLines = [];
			let wasmRes;
			let wasmErr = null;
			try {
				// A linked module imports the facade's closure callers for the
				// exported functions that take or return a func.
				const env = {};
				for (const imp of WebAssembly.Module.imports(
					new WebAssembly.Module(wasm),
				))
					if (imp.module === "env" && imp.name.startsWith("__invoke$"))
						env[imp.name] = () => {
							throw new Error("a closure crossed the host boundary");
						};
				const { exports } = instantiateWasm(wasm, {
					stringTable,
					stdout: (msg) => wasmLines.push(msg),
					extraImports: { env },
				});
				if (typeof exports[fnName] === "function") {
					wasmRes = exports[fnName](...args);
				}
			} catch (e) {
				wasmErr = e;
			}

			if (jsErr || wasmErr) {
				if (!jsErr) {
					throw new Error(
						`WASM threw "${wasmErr.message}" but JS did not throw`,
					);
				}
				if (!wasmErr) {
					throw new Error(`JS threw "${jsErr.message}" but WASM did not throw`);
				}
				if (jsErr.message !== wasmErr.message) {
					throw new Error(
						`Error message mismatch:\n  JS:   ${jsErr.message}\n  WASM: ${wasmErr.message}`,
					);
				}
			} else {
				const jsOut = jsLines.join("\n");
				const wasmOut = wasmLines.join("\n");
				if (jsOut !== wasmOut) {
					throw new Error(
						`Output mismatch:\n  JS:   ${JSON.stringify(jsOut)}\n  WASM: ${JSON.stringify(wasmOut)}`,
					);
				}
				if (typeof jsRes === "number" && typeof wasmRes === "bigint") {
					if (BigInt(jsRes) !== wasmRes) {
						throw new Error(`Return mismatch: JS ${jsRes} vs WASM ${wasmRes}`);
					}
				} else if (jsRes !== wasmRes) {
					const fmt = (v) =>
						typeof v === "bigint" ? `${v}n` : JSON.stringify(v);
					throw new Error(
						`Return mismatch: JS ${fmt(jsRes)} vs WASM ${fmt(wasmRes)}`,
					);
				}
			}

			return {
				jsRes,
				wasmRes,
				output: wasmLines.join("\n"),
			};
		},
	};
}

// ── Hybrid projects (JS root + wasm/both packages) ───────────
//
// `files` maps relative paths (e.g. "mathx/vec.go", "main.go") to sources.
// Compiles the root directory through the real compiler pipeline, embeds the
// linked app.wasm bytes and imports the resulting ES module so the test can
// call the facade's exports directly.  `exports` lists the top-level names to
// re-export from the bundle; other options go to compileDir.

export async function compileHybridProject(
	files,
	{ exports = [], ...compileOptions } = {},
) {
	const root = mkdtempSync(join(tmpdir(), "gofront-hybrid-"));
	try {
		for (const [rel, src] of Object.entries(files)) {
			const full = join(root, rel);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, src);
		}
		// The bundle re-exports `exports`, so the build keeps them.
		const result = compileDir(root, { jsRoots: exports, ...compileOptions });
		const parts = [];
		if (result.wasm) {
			assertValidWasm(result.wasm);
			parts.push(
				`globalThis.__GOFRONT_WASM_BYTES = new Uint8Array([${Array.from(result.wasm).join(",")}]);`,
			);
		}
		parts.push("const __out = [];");
		// Module-scoped `console` shadow so concurrently running tests don't share output.
		parts.push(
			"const console = { log: (...a) => __out.push(a.map((x) => String(x)).join(' ')) };",
		);
		// os.Stdout (fmt.Print*) writes to the host's stream when there is one:
		// collect its whole lines like console.log's.
		parts.push(
			'let __buf = ""; const process = { stdout: { write: (s) => { __buf += String(s); let i; while ((i = __buf.indexOf("\\n")) >= 0) { __out.push(__buf.slice(0, i)); __buf = __buf.slice(i + 1); } } } };',
		);
		parts.push(stripImports(result.js));
		parts.push("if (__buf) __out.push(__buf);");
		parts.push(`export const __lines = __out;`);
		if (exports.length > 0) parts.push(`export { ${exports.join(", ")} };`);
		const bundlePath = join(root, "bundle.mjs");
		writeFileSync(bundlePath, parts.join("\n"));
		const mod = await import(
			`${pathToFileURL(bundlePath).href}?t=${Date.now()}`
		);
		return { ...result, mod, lines: mod.__lines, root };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// ── Whole-program parity (expected output captured from real Go) ──
//
// Compiles a `package main` program as a `both` package (JS backend) and as a
// `wasm` package (linked app.wasm behind the facade), runs `main` on each, and
// returns the stdout of both.  `assertProgramOutput` compares both with the
// text real Go printed for the same program.

const PROGRAM_SINKS = "__gofrontProgramSinks";
let nextProgramSink = 0;

async function runProgramModule(js, wasm) {
	const id = nextProgramSink++;
	let out = "";
	globalThis[PROGRAM_SINKS] ??= new Map();
	globalThis[PROGRAM_SINKS].set(id, (s) => {
		out += s;
	});
	const prelude = [
		`const __sink = globalThis.${PROGRAM_SINKS}.get(${id});`,
		"const process = { stdout: { write: (s) => __sink(String(s)) } };",
		'const console = { log: (...a) => __sink(a.map(String).join(" ") + "\\n") };',
		wasm
			? `const __wasmBytes = new Uint8Array(Buffer.from("${Buffer.from(wasm).toString("base64")}", "base64"));`
			: "",
	];
	const body = js
		.replace(/^import\s[^;]+;\n?/gm, "")
		.replaceAll("globalThis.__GOFRONT_WASM_BYTES", "__wasmBytes");
	const dir = mkdtempSync(join(tmpdir(), "gofront-program-"));
	try {
		const file = join(dir, "bundle.mjs");
		writeFileSync(file, `${prelude.join("\n")}\n${body}`);
		await import(pathToFileURL(file).href);
		return out;
	} finally {
		globalThis[PROGRAM_SINKS].delete(id);
		rmSync(dir, { recursive: true, force: true });
	}
}

// First line where `got` differs from `want`, as a ready-to-print message part:
// `line N: want "<x>", got "<y>"` (`<EOF>` when one side ends early).
export function firstDiff(want, got) {
	const w = want.split("\n");
	const g = got.split("\n");
	let i = 0;
	while (i < Math.max(w.length, g.length) && w[i] === g[i]) i++;
	return `line ${i + 1}: want ${JSON.stringify(w[i] ?? "<EOF>")}, got ${JSON.stringify(g[i] ?? "<EOF>")}`;
}

// Compiles `source` as one package `target` (`js`, `both` or `wasm`), runs
// `main` and returns its stdout.  `natives: false` compiles with the native
// registries off (the Go bodies of `//gofront:native` functions run);
// `stdlibRoot` swaps the stdlib directory; `files` are written next to
// `main.go` (data for `//go:embed`).
export async function runProgram(
	source,
	{ target = "both", natives = true, stdlibRoot, files = {} } = {},
) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-program-src-"));
	try {
		const goPath = join(dir, "main.go");
		for (const [rel, content] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, rel)), { recursive: true });
			writeFileSync(join(dir, rel), content);
		}
		writeFileSync(goPath, source);
		let res;
		try {
			res = compileFiles([goPath], {
				forceTarget: target,
				natives,
				...(stdlibRoot && { stdlibRoot }),
			});
		} catch (e) {
			throw new Error(`${target} compile failed:\n${e.message}`);
		}
		if (target === "wasm") assertValidWasm(res.wasm);
		return await runProgramModule(res.js, res.wasm ?? null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// `both` as the JS side, `wasm`, or a plain `js` package.
const TARGET_LABELS = { both: "js", wasm: "wasm", js: "js package" };

// Runs `source` on each of `targets` (default `both`, `wasm`) and for each
// `natives` setting (default on), and fails naming the first configuration
// (`js (natives on)`, `wasm (natives off)`, `js package (natives on)`) whose
// output differs from `expected`.
export async function assertOutput(
	source,
	expected,
	{ targets = ["both", "wasm"], natives = [true], stdlibRoot, files } = {},
) {
	for (const n of natives) {
		for (const target of targets) {
			const got = await runProgram(source, {
				target,
				natives: n,
				stdlibRoot,
				files,
			});
			if (got === expected) continue;
			throw new Error(
				`${TARGET_LABELS[target]} (natives ${n ? "on" : "off"}) output differs from real Go at ${firstDiff(expected, got)}`,
			);
		}
	}
}

export async function compileHybridProgram(source, options = {}) {
	return {
		js: await runProgram(source, { ...options, target: "both" }),
		wasm: await runProgram(source, { ...options, target: "wasm" }),
	};
}

// `both` (JS side) and `wasm` against the text real Go printed.
export const assertProgramOutput = (source, expected) =>
	assertOutput(source, expected);

// JS and WASM, each with natives on and off.
export const assertFourWay = (source, expected, options = {}) =>
	assertOutput(source, expected, { ...options, natives: [true, false] });

// `assertProgramOutput` plus the same program as a plain `js` package.
export const assertAllTargetsOutput = (source, expected) =>
	assertOutput(source, expected, { targets: ["both", "wasm", "js"] });

// A program only the JS side of a `both` package is expected to run.
export const assertJsProgramOutput = (source, expected) =>
	assertOutput(source, expected, { targets: ["both"] });

// A `js` package and the JS side of a `both` package.
export const assertJsTargetsOutput = (source, expected) =>
	assertOutput(source, expected, { targets: ["js", "both"] });

// A program only the WASM backend can run the way Go does.
export const assertWasmProgramOutput = (source, expected) =>
	assertOutput(source, expected, { targets: ["wasm"] });

// ── Test harness ─────────────────────────────────────────────

let passed = 0,
	failed = 0,
	skipped = 0;
const failures = [];
const pending = [];
let summarized = false;
let exitHookInstalled = false;

// Output is written in registration order: sync results print immediately,
// but once an async test is queued, later results wait for it to settle.
const slots = [];
let flushed = 0;

function flush() {
	while (flushed < slots.length && slots[flushed] !== null) {
		process.stdout.write(slots[flushed++]);
	}
}

function reserveSlot() {
	return slots.push(null) - 1;
}

function fillSlot(i, text) {
	slots[i] = text;
	flush();
}

function reportPass(slot, name) {
	passed++;
	fillSlot(slot, `  \x1b[32m✓\x1b[0m ${name}\n`);
}

function reportFail(slot, name, e) {
	const message = e?.message ?? String(e);
	failures.push({ name, error: message });
	failed++;
	fillSlot(
		slot,
		`  \x1b[31m✗\x1b[0m ${name}\n    ${message.split("\n").join("\n    ")}\n`,
	);
}

// The default is generous: a file's async tests all start together and share
// one thread, so under full-suite load one test can wait minutes for its turn.
// Both knobs are read per call: run.js sets TEST_GREP after this module has
// already been imported.
function testTimeoutMs() {
	const n = Number(process.env.TEST_TIMEOUT_MS);
	return n > 0 ? n : 600_000;
}

function matchesGrep(name) {
	const grep = process.env.TEST_GREP;
	return !grep || new RegExp(grep).test(name);
}

// A file run directly (no run.js, no footer) still reports and sets the exit
// code once the event loop drains. A file that already printed its summary
// only gets the exit code; one loaded by run.js is left alone.
function installExitHook() {
	if (exitHookInstalled || !isMainThread) return;
	exitHookInstalled = true;
	process.on("beforeExit", () => {
		if (globalThis.__GOFRONT_TEST_RUNNER) return;
		if (summarized) {
			if (failed > 0) process.exitCode = 1;
			return;
		}
		return summarize().then((n) => {
			process.exitCode = n > 0 ? 1 : 0;
		});
	});
}

export function test(name, fn) {
	installExitHook();
	if (!matchesGrep(name)) {
		skipped++;
		return;
	}
	const slot = reserveSlot();
	let result;
	try {
		result = fn();
	} catch (e) {
		reportFail(slot, name, e);
		return;
	}
	if (result && typeof result.then === "function") {
		const ms = testTimeoutMs();
		pending.push(
			new Promise((done) => {
				// The slot is filled once: a timed-out test that settles later
				// must not be counted again.
				let settled = false;
				const settle = (report) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					report();
					done();
				};
				const timer = setTimeout(
					() =>
						settle(() =>
							reportFail(slot, name, new Error(`timed out after ${ms}ms`)),
						),
					ms,
				);
				result.then(
					() => settle(() => reportPass(slot, name)),
					(e) => settle(() => reportFail(slot, name, e)),
				);
			}),
		);
		return;
	}
	reportPass(slot, name);
}

export function section(title) {
	fillSlot(reserveSlot(), `\n\x1b[1m── ${title}\x1b[0m\n`);
}

export function assert(cond, msg) {
	if (!cond) throw new Error(msg ?? "assertion failed");
}

export function assertEqual(actual, expected) {
	if (typeof actual === "bigint" && typeof expected === "number") {
		if (actual === BigInt(expected)) return;
	} else if (typeof actual === "number" && typeof expected === "bigint") {
		if (BigInt(actual) === expected) return;
	}
	if (actual !== expected) {
		const fmt = (v) => (typeof v === "bigint" ? `${v}n` : JSON.stringify(v));
		throw new Error(`expected ${fmt(expected)}, got ${fmt(actual)}`);
	}
}

export function assertContains(haystack, needle) {
	if (!haystack.includes(needle))
		throw new Error(
			`expected output to contain ${JSON.stringify(needle)}\ngot: ${JSON.stringify(haystack)}`,
		);
}

export function assertThrows(fn, substring) {
	let threw = false;
	let msg = "";
	try {
		fn();
	} catch (e) {
		threw = true;
		msg = e.message ?? String(e);
	}
	if (!threw) throw new Error("expected function to throw, but it did not");
	if (substring) {
		const matches =
			substring instanceof RegExp
				? substring.test(msg)
				: msg.includes(substring);
		if (!matches) {
			throw new Error(
				`expected error containing ${String(substring)}\ngot: ${JSON.stringify(msg)}`,
			);
		}
	}
}

export async function assertRejects(fn, substring) {
	let threw = false;
	let msg = "";
	try {
		await fn();
	} catch (e) {
		threw = true;
		msg = e.message ?? String(e);
	}
	if (!threw) throw new Error("expected function to reject, but it did not");
	if (substring) {
		const matches =
			substring instanceof RegExp
				? substring.test(msg)
				: msg.includes(substring);
		if (!matches) {
			throw new Error(
				`expected error containing ${String(substring)}\ngot: ${JSON.stringify(msg)}`,
			);
		}
	}
}

export function assertErrorContains(errors, needle) {
	const msgs = errors.map((e) => e.message).join("\n");
	if (!msgs.includes(needle))
		throw new Error(
			`expected error containing ${JSON.stringify(needle)}\ngot: ${JSON.stringify(msgs)}`,
		);
}

export async function waitForPending() {
	await Promise.all(pending);
	flush();
}

export function resetTestStats() {
	passed = 0;
	failed = 0;
	skipped = 0;
	failures.length = 0;
	pending.length = 0;
	slots.length = 0;
	flushed = 0;
}

export function getTestStats() {
	return { passed, failed, skipped, failures: [...failures] };
}

export async function summarize() {
	summarized = true;
	await waitForPending();
	const total = passed + failed;
	process.stdout.write(`\n${total} tests: \x1b[32m${passed} passed\x1b[0m`);
	if (failed > 0) {
		process.stdout.write(`, \x1b[31m${failed} failed\x1b[0m`);
		if (skipped > 0) process.stdout.write(`, ${skipped} skipped`);
		process.stdout.write("\n\nFailed tests:\n");
		for (const f of failures) process.stdout.write(`  • ${f.name}\n`);
	}
	if (failed === 0 && skipped > 0) {
		process.stdout.write(`, ${skipped} skipped`);
	}
	process.stdout.write("\n");
	return failed;
}
