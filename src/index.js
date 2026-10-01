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

import { mkdirSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { copyAssets } from "./asset-manager.js";
import {
	formatBuildSummary,
	formatPrepSummary,
	handleBuild,
	handleCheck,
	handleDev,
	handleInit,
	handlePrep,
	handleTest,
	maybeMinify,
	parseBuildArgs,
	parseCheckArgs,
	parseDevArgs,
	parsePrepArgs,
	parseTestArgs,
	runCompile,
} from "./cli-core.js";
import { colors, formatDiagnostic, log, ms, stamp } from "./colors.js";
import { createDevServer } from "./dev-server.js";

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
  gofront dev [dir] [options]    Start dev server with live reload (default port 3000)
  gofront build [dir] [options]  Build production bundle (-o <dir>, --pwa, --minify)
  gofront check [dir|dir/...]    Type-check only (dir/... recurses into every package)
  gofront test [dir|dir/...] [--dom]  Run unit tests (-v verbose, -run <regex>)
  gofront prep [dir] [--minify]  Copy static assets and bundle vendor dependencies
  gofront init [dir]             Scaffold a new GoFront project
  gofront <file.go>              Compile single file and print to stdout
  gofront <dir>  (or gofront .)  Compile all *.go in directory as one bundle
  gofront <input> -o out.js      Compile and write to file
  gofront <input> --check        Type-check only
  gofront <input> --watch        Watch for changes and recompile
  gofront <input> -o out.js --serve          Watch + serve with live reload (default port 3000)
  gofront <input> -o out.js --serve --port 8080  Use a custom port
  gofront <input> -o out.js --copy-assets    Compile and synchronize static assets
  gofront <input> --source-map   Append inline source map to output
  gofront <input> --minify       Minify output
  gofront <input> --minify --mangle  Minify and mangle identifiers
  gofront <file.go> --ast        Dump AST (debug)
  gofront <file.go> --tokens     Dump tokens (debug)
  gofront --version              Print version
`.trim(),
	);
	process.exit(0);
}

// ── prep / vendor subcommand ──────────────────────────────────

if (args[0] === "prep" || args[0] === "vendor") {
	const { targetDir, vendorConfig } = parsePrepArgs(args.slice(1));
	try {
		const result = await handlePrep(resolve(targetDir), { vendorConfig });
		for (const line of formatPrepSummary(result)) log.info(line);
	} catch (e) {
		log.fail(e.message);
		process.exit(1);
	}
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
		log.fail(e.message);
		process.exit(1);
	}
	log.info(`created ${colors.cyan(mainPath)}`);
	log.info(
		`run  ${colors.cyan(`gofront ${targetArg === "." ? "main.go" : `${targetArg}/main.go`}`)}  to compile`,
	);
	process.exit(0);
}

// ── test subcommand ───────────────────────────────────────────

if (args[0] === "test") {
	const { targetDir, ...testOptions } = parseTestArgs(args.slice(1));
	try {
		const result = await handleTest(targetDir, testOptions);
		process.exit(result.exitCode);
	} catch (e) {
		log.fail(e.message);
		process.exit(1);
	}
}

// ── check subcommand ──────────────────────────────────────────

if (args[0] === "check") {
	const { targetDir } = parseCheckArgs(args.slice(1));
	try {
		const { elapsedMs, packages } = handleCheck(targetDir);
		const okLine = (label, t) =>
			log.info(`${colors.cyan(label)} — ${colors.green("OK")} ${ms(t)}`);
		if (packages) {
			for (const pkg of packages) {
				okLine(relative(process.cwd(), pkg.dir) || ".", pkg.elapsedMs);
			}
			log.info(
				`${colors.bold(`${packages.length} packages`)} — ${colors.bold(colors.green("OK"))} ${ms(elapsedMs)}`,
			);
		} else {
			okLine(targetDir, elapsedMs);
		}
		process.exit(0);
	} catch (e) {
		log.fail(e.message);
		process.exit(1);
	}
}

// ── build subcommand ──────────────────────────────────────────

if (args[0] === "build") {
	const buildOptions = parseBuildArgs(args.slice(1));
	try {
		const result = await handleBuild(buildOptions.targetDir, buildOptions);
		for (const line of formatBuildSummary(result)) {
			log.info(
				line
					.replace(/^build complete/, colors.green("build complete"))
					.replace(/\(([\d.]+ kB)\)$/, (_, s) => colors.dim(`(${s})`)),
			);
		}
		process.exit(0);
	} catch (e) {
		log.fail(e.message);
		process.exit(1);
	}
}

// ── dev subcommand ────────────────────────────────────────────

if (args[0] === "dev") {
	const devOptions = parseDevArgs(args.slice(1));
	try {
		const dev = await handleDev(devOptions.targetDir, devOptions);
		if (dev.initialError) {
			log.error(dev.initialError.message);
		} else {
			log.ok(`— wrote ${colors.cyan(dev.outputFile)}`);
		}
		log.info(
			`dev server running → ${colors.cyan(`http://localhost:${dev.port}`)}`,
		);
		log.info(`watching ${colors.cyan(dev.srcDir)} for changes...`);

		const shutdown = async () => {
			await dev.close();
			process.exit(0);
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
		await new Promise(() => {});
	} catch (e) {
		log.fail(e.message);
		process.exit(1);
	}
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
const copyAssetsFlag = args.includes("--copy-assets");
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
	log.fail(`cannot access '${inputArg}': ${e.message}`);
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
		log.fail(e.message);
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
		log.info(
			`${colors.cyan(inputArg)} — ${colors.green("OK")} ${ms(elapsedMs)}`,
		);
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
		log.fail(`minify failed: ${e.message}`);
		process.exit(1);
	}

	const elapsedMs = (performance.now() - startMs).toFixed(0);

	if (outputFile) {
		try {
			mkdirSync(dirname(resolve(outputFile)), { recursive: true });
			writeFileSync(outputFile, `${js}\n`);
			log.info(`wrote ${colors.cyan(outputFile)} ${ms(elapsedMs)}`);
		} catch (e) {
			log.fail(`cannot write '${outputFile}': ${e.message}`);
			process.exit(1);
		}
	} else {
		console.log(js);
	}

	if (copyAssetsFlag) {
		try {
			const projectDir = resolve(".");
			const { copied, skipped } = copyAssets(projectDir);
			if (copied > 0 || skipped > 0) {
				log.info(`copied ${copied} assets (${skipped} skipped)`);
			}
		} catch (e) {
			log.warn(`asset copy failed: ${e.message}`);
		}
	}

	process.exit(0);
}

// ── Watch mode ───────────────────────────────────────────────

// Start dev server before first build so the browser can connect immediately
let devServer = null;
if (serveMode) {
	if (!outputFile) {
		log.fail("--serve requires -o <output file>");
		process.exit(1);
	}
	const serveDir = dirname(resolve(outputFile));
	devServer = createDevServer(serveDir, servePort);
}

function buildOnce(changedFile = null) {
	try {
		const startMs = performance.now();
		const result = runCompile(inputPath, isDir, { sourceMap, outputFile });
		const js = maybeMinify(result.js, {
			minify: minifyOutput,
			mangle: mangleOutput,
			sourceMap,
		});
		const elapsedMs = (performance.now() - startMs).toFixed(0);
		const changeNote = changedFile ? ` — ${changedFile} changed` : "";
		const timing = colors.dim(`(${elapsedMs}ms${changeNote})`);
		if (outputFile) {
			writeFileSync(outputFile, `${js}\n`);
			console.error(
				`${stamp()} ${colors.bold("gofront:")} ${colors.green("OK")} — wrote ${colors.cyan(outputFile)} ${timing}`,
			);
		} else {
			// Clear screen then print
			process.stdout.write("\x1Bc");
			console.log(js);
			console.error(
				`${stamp()} ${colors.bold("gofront:")} ${colors.green("OK")} ${timing}`,
			);
		}

		if (copyAssetsFlag) {
			try {
				copyAssets(resolve("."));
			} catch (e) {
				log.warn(`asset copy failed: ${e.message}`);
			}
		}

		devServer?.notify();
	} catch (e) {
		console.error(
			`${stamp()} ${colors.bold("gofront:")} ${colors.bold(colors.red("ERROR"))}`,
		);
		for (const line of formatDiagnostic(e.message).split("\n"))
			console.error(`  ${line}`);
		devServer?.notifyError?.(e);
	}
}

// Initial build
buildOnce();

// Determine what to watch
const watchTarget = isDir ? inputPath : dirname(inputPath);

function handleCssWatch(filename) {
	if (copyAssetsFlag) {
		try {
			copyAssets(resolve("."));
		} catch (e) {
			log.warn(`asset copy failed: ${e.message}`);
		}
	}
	devServer?.notifyCss?.(filename);
}

let debounce = null;
let cssDebounce = null;
watch(watchTarget, { recursive: true }, (_event, filename) => {
	if (!filename) return;
	if (filename.endsWith(".css")) {
		clearTimeout(cssDebounce);
		cssDebounce = setTimeout(() => handleCssWatch(filename), 50);
		return;
	}
	if (!filename.endsWith(".go") && !filename.endsWith(".templ")) return;
	clearTimeout(debounce);
	debounce = setTimeout(() => buildOnce(filename), 80);
});

console.error(
	`${stamp()} ${colors.bold("gofront:")} watching ${colors.cyan(inputArg)} ...`,
);
