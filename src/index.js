#!/usr/bin/env node
// GoFront compiler CLI
//
// Usage:
//   gofront <file.go>              — compile single file, print JS to stdout
//   gofront <dir>                  — compile all *.go in directory as one package
//   gofront .                      — compile current directory
//   gofront <file.go> -o out.js    — write to file
//   gofront <dir>    -o out.js     — write bundle to file
//   gofront <file.go> --check      — type-check only (no output)
//   gofront <file.go> --watch      — watch and recompile on change
//   gofront <file.go> --ast        — dump AST of first file (debug)
//   gofront <file.go> --tokens     — dump tokens of first file (debug)
//   gofront init [dir]             — scaffold a new GoFront project

import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json");

import { statSync, watch, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { handleInit, maybeMinify, runCompile } from "./cli-core.js";
import { createDevServer, liveReloadClient } from "./dev-server.js";

// ── Parse CLI args ───────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === "--version" || args[0] === "-v") {
	console.log(`gofront ${version}`);
	process.exit(0);
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	console.log(
		`
GoFront — a Go-inspired language that compiles to JavaScript

Usage:
  gofront <file.go>              Compile single file and print to stdout
  gofront <dir>  (or gofront .)    Compile all *.go in directory as one bundle
  gofront <input> -o out.js      Compile and write to file
  gofront <input> --check        Type-check only
  gofront <input> --watch        Watch for changes and recompile
  gofront <input> -o out.js --serve          Watch + serve with live reload (default port 3000)
  gofront <input> -o out.js --serve --port 8080  Use a custom port
  gofront <input> --source-map   Append inline source map to output
  gofront <input> --minify       Minify output
  gofront <input> --minify --mangle  Minify and mangle identifiers
  gofront <file.go> --ast        Dump AST (debug)
  gofront <file.go> --tokens     Dump tokens (debug)
  gofront init [dir]             Scaffold a new GoFront project
  gofront --version              Print version
`.trim(),
	);
	process.exit(0);
}

// ── init subcommand ──────────────────────────────────────────

if (args[0] === "init") {
	const targetArg = args[1] ?? ".";
	const targetDir = resolve(targetArg);
	let mainPath;
	try {
		({ mainPath } = handleInit(targetDir));
	} catch (e) {
		console.error(`gofront: ${e.message}`);
		process.exit(1);
	}
	console.error(`gofront: created ${mainPath}`);
	console.error(
		`gofront: run  gofront ${targetArg === "." ? "main.go" : `${targetArg}/main.go`}  to compile`,
	);
	process.exit(0);
}

const inputArg = args[0];
const outputFlag = args.indexOf("-o");
const outputFile = outputFlag !== -1 ? args[outputFlag + 1] : null;
const checkOnly = args.includes("--check");
const dumpAst = args.includes("--ast");
const dumpTokens = args.includes("--tokens");
const sourceMap = args.includes("--source-map");
const serveMode = args.includes("--serve");
const watchMode = args.includes("--watch") || serveMode;
const minifyOutput = args.includes("--minify");
const mangleOutput = args.includes("--mangle");
const portFlag = args.indexOf("--port");
const servePort = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : 3000;

// ── Determine input mode ─────────────────────────────────────

const inputPath = resolve(inputArg);
let isDir = false;
try {
	isDir = statSync(inputPath).isDirectory();
} catch (e) {
	console.error(`gofront: cannot access '${inputArg}': ${e.message}`);
	process.exit(1);
}

// ── Single-shot mode ─────────────────────────────────────────

if (!watchMode) {
	let result;
	const startMs = performance.now();
	try {
		result = runCompile(inputPath, isDir, {
			sourceMap,
			outputFile,
			dumpTokens,
			dumpAst,
		});
	} catch (e) {
		console.error(`gofront: ${e.message}`);
		process.exit(1);
	}

	if (result.tokens) {
		for (const tok of result.tokens) console.log(tok.toString());
		process.exit(0);
	}
	if (result.ast) {
		console.log(JSON.stringify(result.ast, null, 2));
		process.exit(0);
	}

	if (checkOnly) {
		const elapsedMs = (performance.now() - startMs).toFixed(0);
		console.error(`gofront: ${inputArg} — OK (${elapsedMs}ms)`);
		process.exit(0);
	}

	let js;
	try {
		js = maybeMinify(result.js, {
			minify: minifyOutput,
			mangle: mangleOutput,
			sourceMap,
		});
	} catch (e) {
		console.error(`gofront: minify failed: ${e.message}`);
		process.exit(1);
	}

	const elapsedMs = (performance.now() - startMs).toFixed(0);

	if (outputFile) {
		try {
			writeFileSync(outputFile, `${js}\n`);
			console.error(`gofront: wrote ${outputFile} (${elapsedMs}ms)`);
		} catch (e) {
			console.error(`gofront: cannot write '${outputFile}': ${e.message}`);
			process.exit(1);
		}
	} else {
		console.log(js);
	}
	process.exit(0);
}

// ── Watch mode ───────────────────────────────────────────────

function timestamp() {
	return new Date().toLocaleTimeString();
}

// Start dev server before first build so the browser can connect immediately
let devServer = null;
if (serveMode) {
	if (!outputFile) {
		console.error("gofront: --serve requires -o <output file>");
		process.exit(1);
	}
	const serveDir = dirname(resolve(outputFile));
	devServer = createDevServer(serveDir, servePort);
}

function buildOnce(changedFile = null) {
	try {
		const startMs = performance.now();
		const result = runCompile(inputPath, isDir, { sourceMap, outputFile });
		let js = maybeMinify(result.js, {
			minify: minifyOutput,
			mangle: mangleOutput,
			sourceMap,
		});
		if (serveMode) {
			// Insert live reload client before the source map comment so it stays last
			const smIdx = js.lastIndexOf("\n//# sourceMappingURL=");
			if (smIdx !== -1) {
				js = `${js.slice(0, smIdx)}\n${liveReloadClient}${js.slice(smIdx)}`;
			} else {
				js += `\n${liveReloadClient}`;
			}
		}
		const elapsedMs = (performance.now() - startMs).toFixed(0);
		const changeNote = changedFile ? ` — ${changedFile} changed` : "";
		if (outputFile) {
			writeFileSync(outputFile, `${js}\n`);
			console.error(
				`[${timestamp()}] gofront: OK — wrote ${outputFile} (${elapsedMs}ms${changeNote})`,
			);
		} else {
			// Clear screen then print
			process.stdout.write("\x1Bc");
			console.log(js);
			console.error(
				`[${timestamp()}] gofront: OK (${elapsedMs}ms${changeNote})`,
			);
		}
		devServer?.notify();
	} catch (e) {
		console.error(`[${timestamp()}] gofront: ERROR`);
		for (const line of e.message.split("\n")) console.error(`  ${line}`);
	}
}

// Initial build
buildOnce();

// Determine what to watch
const watchTarget = isDir ? inputPath : dirname(inputPath);

let debounce = null;
watch(watchTarget, { recursive: true }, (_event, filename) => {
	if (filename && !filename.endsWith(".go") && !filename.endsWith(".templ"))
		return;
	clearTimeout(debounce);
	debounce = setTimeout(() => buildOnce(filename), 80);
});

console.error(`[${timestamp()}] gofront: watching ${inputArg} ...`);
