// GoFront conformance runner.
//
// Every test/conformance/<pkg>/<name>.go is a plain Go program. It is compiled
// as a `both` package, its `main` runs on the JS backend and on the WASM
// backend, and each stdout must equal <name>.out byte for byte. The .out files
// are captured from real Go by `npm run conformance:update` (update.js).
//
//   node test/conformance/run.js [dir]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { instantiateWasm } from "../../src/backend/wasm/glue.js";
import { compileWasm } from "../../src/backend/wasm/index.js";
import { Lexer } from "../../src/lexer.js";
import { assertValidWasm, compile } from "../unit/helpers.js";

export const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url));

// <dir>/<pkg>/<name>.go, sorted by relative path.
export function findFixtures(dir = CONFORMANCE_DIR) {
	const out = [];
	for (const pkg of readdirSync(dir).sort()) {
		const pkgDir = join(dir, pkg);
		if (!statSync(pkgDir).isDirectory()) continue;
		for (const f of readdirSync(pkgDir).sort())
			if (f.endsWith(".go")) out.push(join(pkgDir, f));
	}
	return out;
}

function compileErrors(kind, errors) {
	return new Error(
		`${kind} compile failed:\n${errors.map((e) => e.message).join("\n")}`,
	);
}

function runJs(js) {
	let out = "";
	const ctx = vm.createContext({
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
		process: { stdout: { write: (s) => (out += s) } },
		console: { log: (...a) => (out += `${a.map(String).join(" ")}\n`) },
	});
	// The generated module calls main() itself.
	vm.runInContext(js.replace(/^import\s[^;]+;\n?/gm, ""), ctx);
	return out;
}

function runWasm(wasm, stringTable) {
	let out = "";
	// WASM stdout is line-buffered: each call is one line without its "\n".
	const { exports } = instantiateWasm(wasm, {
		stringTable,
		stdout: (line) => (out += `${line}\n`),
	});
	exports.main();
	return out;
}

// GoFront strings are JS strings on both backends: len, indexing and range
// count UTF-16 code units, Go counts UTF-8 bytes (portable-go plan §1.1).
const STRING_HINT =
	"GoFront strings are JavaScript strings, so len, indexing and range count UTF-16 code units where Go counts UTF-8 bytes; use []byte(s) or []rune(s) instead (docs/v1.8.0/portable-go-plan.md §1.1)";

// Escapes in an interpreted literal that produce a byte >= 0x80.
const NON_ASCII_ESCAPE =
	/(?:^|[^\\])(?:\\\\)*\\(?:x[89a-fA-F][0-9a-fA-F]|[2-3][0-7]{2}|u(?!00[0-7])[0-9a-fA-F]{4}|U(?!000000[0-7])[0-9a-fA-F]{8})/;

function isNonAsciiLiteral(tok, lines) {
	if (tok?.type !== "STRING") return false;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII range
	if (/[^\x00-\x7f]/.test(tok.value)) return true;
	// The token value has escapes partly decoded, so read the source text.
	const line = lines[tok.line - 1] ?? "";
	if (line[tok.col - 1] !== '"') return false; // raw string: no escapes
	let j = tok.col;
	while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
	return NON_ASCII_ESCAPE.test(line.slice(tok.col, j));
}

// Rejects len(), indexing and range applied to a non-ASCII string literal.
// Returns one message per offending use; `[]byte(...)`/`[]rune(...)` forms
// are not string literals and pass.
export function lintFixture(source, name) {
	const toks = new Lexer(source, name).tokenize();
	const lines = source.split("\n");
	const errs = [];
	const report = (tok, what) =>
		errs.push(
			`${name}:${tok.line}: ${what} a non-ASCII string literal: ${STRING_HINT}`,
		);
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i];
		if (
			t.type === "IDENT" &&
			t.value === "len" &&
			toks[i + 1]?.type === "(" &&
			isNonAsciiLiteral(toks[i + 2], lines) &&
			toks[i + 3]?.type === ")"
		)
			report(t, "len() of");
		else if (t.type === "range" && isNonAsciiLiteral(toks[i + 1], lines))
			report(t, "range over");
		else if (isNonAsciiLiteral(t, lines) && toks[i + 1]?.type === "[")
			report(t, "indexing");
	}
	return errs;
}

// Compiles one fixture as a `both` package and returns the stdout of each backend.
export function runFixture(goPath) {
	const source = readFileSync(goPath, "utf8");
	const js = compile(source, { fromFile: goPath, target: "both" });
	if (js.errors.length > 0) throw compileErrors("JS", js.errors);
	const wasm = compileWasm(source, { filename: goPath.split("/").pop() });
	if (wasm.errors?.length > 0) throw compileErrors("WASM", wasm.errors);
	assertValidWasm(wasm.wasm);
	return {
		js: runJs(js.js),
		wasm: runWasm(wasm.wasm, wasm.stringTable),
	};
}

// First differing line between two outputs, for the failure message.
function firstDiff(want, got) {
	const w = want.split("\n");
	const g = got.split("\n");
	for (let i = 0; i < Math.max(w.length, g.length); i++) {
		if (w[i] !== g[i])
			return `line ${i + 1}: want ${JSON.stringify(w[i] ?? "<EOF>")}, got ${JSON.stringify(g[i] ?? "<EOF>")}`;
	}
	return "outputs differ";
}

// Runs a fixture and compares both backends with its .out file.
// Returns { ok, message }; message lists every problem found.
export function checkFixture(goPath, root = dirname(dirname(goPath))) {
	const name = relative(root, goPath);
	const outPath = goPath.replace(/\.go$/, ".out");
	const outName = relative(root, outPath);
	if (!existsSync(outPath))
		return {
			ok: false,
			message: `missing ${outName}: capture it from real Go with \`npm run conformance:update\``,
		};
	const want = readFileSync(outPath);
	let got;
	try {
		const lint = lintFixture(readFileSync(goPath, "utf8"), name);
		if (lint.length > 0) return { ok: false, message: lint.join("\n") };
		got = runFixture(goPath);
	} catch (e) {
		return { ok: false, message: `${name}: ${e.message}` };
	}
	const problems = [];
	for (const [backend, out] of [
		["JS", got.js],
		["WASM", got.wasm],
	]) {
		if (Buffer.from(out, "utf8").equals(want)) continue;
		problems.push(
			`${backend} output differs from ${outName}: ${firstDiff(want.toString("utf8"), out)}`,
		);
	}
	return { ok: problems.length === 0, message: problems.join("\n") };
}

function main(dir) {
	const fixtures = findFixtures(dir);
	let failed = 0;
	for (const f of fixtures) {
		const name = relative(dir, f);
		const res = checkFixture(f, dir);
		if (res.ok) {
			process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
			continue;
		}
		failed++;
		process.stdout.write(
			`  \x1b[31m✗\x1b[0m ${name}\n    ${res.message.split("\n").join("\n    ")}\n`,
		);
	}
	process.stdout.write(
		`\nconformance: ${fixtures.length - failed} passed, ${failed} failed\n`,
	);
	return failed === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv[2] ?? CONFORMANCE_DIR);
}
