// GoFront test helpers — shared across all test files
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { CodeGen } from "../src/codegen.js";
import { compileDir } from "../src/compiler.js";
import { DtsParser, parseDts } from "../src/dts-parser.js";
import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { resolveAll } from "../src/resolver.js";
import { TypeChecker } from "../src/typechecker.js";

export { compileDir, DtsParser, join, Lexer, Parser, parseDts };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ROOT = resolve(__dirname, "..");
export const FIXTURES = join(__dirname, "fixtures");

// ── Compiler ─────────────────────────────────────────────────

export function compile(
	source,
	{ fromFile = join(FIXTURES, "_dummy.go") } = {},
) {
	const filename = fromFile.split("/").pop();
	const tokens = new Lexer(source, filename).tokenize();
	const ast = new Parser(tokens, filename).parse();

	const checker = new TypeChecker();
	const fromDir = dirname(resolve(fromFile));
	const jsImports = new Map();

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

	const js = new CodeGen(checker, jsImports).generate(ast);
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
	vm.runInContext(stripImports(js), ctx);
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

// ── Test harness ─────────────────────────────────────────────

let passed = 0,
	failed = 0;
const failures = [];

export function test(name, fn) {
	try {
		fn();
		process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
		passed++;
	} catch (e) {
		process.stdout.write(
			`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message.split("\n").join("\n    ")}\n`,
		);
		failures.push({ name, error: e.message });
		failed++;
	}
}

export function section(title) {
	process.stdout.write(`\n\x1b[1m── ${title}\x1b[0m\n`);
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

export function assertErrorContains(errors, needle) {
	const msgs = errors.map((e) => e.message).join("\n");
	if (!msgs.includes(needle))
		throw new Error(
			`expected error containing ${JSON.stringify(needle)}\ngot: ${JSON.stringify(msgs)}`,
		);
}

export function summarize() {
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
