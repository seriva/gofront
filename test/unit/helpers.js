// GoFront test helpers — shared across all test files
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { CodeGen } from "../../src/backend/js/index.js";
import { instantiateWasm } from "../../src/backend/wasm/glue.js";
import { compileWasm } from "../../src/backend/wasm/index.js";
import { compileDir } from "../../src/compiler.js";
import { DtsParser, parseDts } from "../../src/dts-parser.js";
import { Lexer } from "../../src/lexer.js";
import { normalizeDefers } from "../../src/lower/functions.js";
import { Parser } from "../../src/parser/index.js";
import { resolveAll } from "../../src/resolver.js";
import { TypeChecker } from "../../src/typechecker/index.js";

export {
	compileDir,
	compileWasm,
	DtsParser,
	instantiateWasm,
	join,
	Lexer,
	Parser,
	parseDts,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ROOT = resolve(__dirname, "../..");
export const FIXTURES = join(__dirname, "fixtures");

// ── Compiler ─────────────────────────────────────────────────

export function compile(
	source,
	{
		fromFile = join(FIXTURES, "_dummy.go"),
		strict = false,
		target = null,
	} = {},
) {
	const filename = fromFile.split("/").pop();
	const tokens = new Lexer(source, filename).tokenize();
	const ast = new Parser(tokens, filename, source).parse();

	const checker = new TypeChecker();
	const fromDir = dirname(resolve(fromFile));
	const jsImports = new Map();

	const pkgTarget = target ?? ast.target ?? "js";
	ast.target = pkgTarget;
	checker.target = pkgTarget;
	checker.pkgName = ast.pkg?.name ?? "main";

	for (const imp of ast.imports) {
		for (const { path } of imp.imports) {
			if (!path.startsWith("js:")) continue;
			const dtsPath = join(fromDir, path.slice(3));
			const { types, values } = parseDts(readFileSync(dtsPath, "utf8"));
			checker.addDefinitions(types, values);
		}
	}

	const resolved = resolveAll(ast.imports, fromFile, parseDts);
	for (const [path, info] of resolved) {
		if (!info) continue;
		checker.addDefinitions(info.types, info.values);
		jsImports.set(path, [...info.values.keys()]);
	}

	const errors = checker.check(ast);
	if (errors.length > 0) return { js: null, errors };

	const isStrict = Boolean(strict || pkgTarget === "both");
	normalizeDefers([ast]);
	const js = new CodeGen(checker, jsImports, new Set(), {
		target: pkgTarget,
		strict: isStrict,
	}).generate(ast);
	return { js, errors: [] };
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
	return lines.join("\n");
}

export function runInDom(
	js,
	html = "<!DOCTYPE html><html><body></body></html>",
) {
	const dom = new JSDOM(html);
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
	const lines = [];
	const { exports, instance, module } = instantiateWasm(wasmBytes, {
		stringTable,
		stdout: (msg) => lines.push(msg),
		extraImports,
	});
	return { exports, lines, instance, module };
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
				JSON,
				String,
				Number,
				Boolean,
				Array,
				Object,
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
				const { exports } = instantiateWasm(wasm, {
					stringTable,
					stdout: (msg) => wasmLines.push(msg),
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
// re-export from the bundle.

export async function compileHybridProject(files, { exports = [] } = {}) {
	const root = mkdtempSync(join(tmpdir(), "gofront-hybrid-"));
	for (const [rel, src] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, src);
	}
	const result = compileDir(root);
	const parts = [];
	if (result.wasm) {
		parts.push(
			`globalThis.__GOFRONT_WASM_BYTES = new Uint8Array([${Array.from(result.wasm).join(",")}]);`,
		);
	}
	parts.push("const __out = [];");
	// Module-scoped `console` shadow so concurrently running tests don't share output.
	parts.push(
		"const console = { log: (...a) => __out.push(a.map((x) => String(x)).join(' ')) };",
	);
	parts.push(stripImports(result.js));
	parts.push(`export const __lines = __out;`);
	if (exports.length > 0) parts.push(`export { ${exports.join(", ")} };`);
	const bundlePath = join(root, "bundle.mjs");
	writeFileSync(bundlePath, parts.join("\n"));
	const mod = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
	return { ...result, mod, lines: mod.__lines, root };
}

// ── Test harness ─────────────────────────────────────────────

let passed = 0,
	failed = 0;
const failures = [];
const pending = [];

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

export function test(name, fn) {
	const slot = reserveSlot();
	let result;
	try {
		result = fn();
	} catch (e) {
		reportFail(slot, name, e);
		return;
	}
	if (result && typeof result.then === "function") {
		pending.push(
			result.then(
				() => reportPass(slot, name),
				(e) => reportFail(slot, name, e),
			),
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
	if (substring && !msg.includes(substring))
		throw new Error(
			`expected error containing ${JSON.stringify(substring)}\ngot: ${JSON.stringify(msg)}`,
		);
}

export function assertErrorContains(errors, needle) {
	const msgs = errors.map((e) => e.message).join("\n");
	if (!msgs.includes(needle))
		throw new Error(
			`expected error containing ${JSON.stringify(needle)}\ngot: ${JSON.stringify(msgs)}`,
		);
}

export async function summarize() {
	await Promise.all(pending);
	const total = passed + failed;
	process.stdout.write(`\n${total} tests: \x1b[32m${passed} passed\x1b[0m`);
	if (failed > 0) {
		process.stdout.write(`, \x1b[31m${failed} failed\x1b[0m`);
		process.stdout.write("\n\nFailed tests:\n");
		for (const f of failures) process.stdout.write(`  • ${f.name}\n`);
	}
	process.stdout.write("\n");
	return failed;
}
