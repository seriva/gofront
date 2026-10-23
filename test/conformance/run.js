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
