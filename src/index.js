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

import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
	devReporters,
	formatPrepSummary,
	formatWrittenDesc,
	GOFRONT_VERSION,
	HELP_TEXT,
	handleBuild,
	handleCheck,
	handleDev,
	handleInit,
	handlePrep,
	handleTest,
	parseBuildArgs,
	parseCheckArgs,
	parseDevArgs,
	parseLegacyArgs,
	parsePrepArgs,
	parseTestArgs,
	reportBuild,
	reportCheck,
	runSingleShot,
} from "./cli/cli-core.js";
import { colors, log, stamp } from "./cli/colors.js";

// ── Parse CLI args ───────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === "--version" || args[0] === "-v") {
	console.log(`gofront ${GOFRONT_VERSION}`);
	process.exit(0);
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	console.log(HELP_TEXT);
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
	const { targetDir, forceTarget } = parseCheckArgs(args.slice(1));
	try {
		reportCheck(handleCheck(targetDir, { forceTarget }), targetDir);
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
		reportBuild(result);
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
			log.ok(`— wrote ${formatWrittenDesc(dev.written, dev.outputFile)}`);
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

const flags = parseLegacyArgs(args);
const {
	inputArg,
	outputFile,
	sourceMap,
	serve: serveMode,
	watch: watchMode,
	copyAssets: copyAssetsFlag,
	minify: minifyOutput,
	mangle: mangleOutput,
	port: servePort,
	forceTarget,
} = flags;

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
	process.exit(runSingleShot(inputPath, isDir, flags));
}

// ── Watch mode ───────────────────────────────────────────────

if (serveMode && !outputFile) {
	log.fail("--serve requires -o <output file>");
	process.exit(1);
}

const prefix = () => `${stamp()} ${colors.bold("gofront:")}`;

try {
	await handleDev(".", {
		srcDir: inputPath,
		outputFile,
		serve: serveMode,
		serveDir: outputFile ? dirname(resolve(outputFile)) : undefined,
		port: servePort,
		silent: false,
		sourceMap,
		minify: minifyOutput,
		mangle: mangleOutput,
		copyAssets: copyAssetsFlag,
		forceTarget,
		...devReporters({ outputFile, copyAssets: copyAssetsFlag }),
	});
} catch (e) {
	log.fail(e.message);
	process.exit(1);
}

console.error(`${prefix()} watching ${colors.cyan(inputArg)} ...`);
