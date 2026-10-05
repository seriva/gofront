// GoFront test helpers — shared across all test files
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { instantiateWasm } from "../../src/backend/wasm/glue.js";
import { compileWasm } from "../../src/backend/wasm/index.js";
import { CodeGen } from "../../src/codegen/index.js";
import { compileDir } from "../../src/compiler.js";
import { DtsParser, parseDts } from "../../src/dts-parser.js";
import { Lexer } from "../../src/lexer.js";
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
			const jsCtx = vm.createContext({
				Math,
				JSON,
				String,
				Number,
				Boolean,
				Array,
				Object,
				console: {
					log: (...a) => jsLines.push(a.map(String).join(" ")),
				},
			});
			try {
				vm.runInContext(stripImports(js), jsCtx);
				if (typeof jsCtx[fnName] === "function") {
					jsRes = jsCtx[fnName](...args);
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
					throw new Error(
						`Return mismatch: JS ${JSON.stringify(jsRes)} vs WASM ${JSON.stringify(wasmRes)}`,
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
	if (actual !== expected)
		throw new Error(
			`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
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
