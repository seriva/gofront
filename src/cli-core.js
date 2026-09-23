// CLI compilation core — extracted for direct import in tests.
// index.js retains only arg parsing, file I/O, watch mode, and process.exit.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { copyAssets } from "./asset-manager.js";
import { compileDir, compileSingleFile } from "./compiler.js";
import { minify } from "./minifier.js";
import { runTests } from "./test-runner.js";
import { bundleVendor } from "./vendor.js";

export function runCompile(inputPath, isDir, options) {
	const {
		sourceMap = false,
		outputFile = null,
		dumpTokens = false,
		dumpAst = false,
	} = options ?? {};

	if (isDir) {
		const outputDir = outputFile ? dirname(resolve(outputFile)) : resolve(".");
		return compileDir(inputPath, { sourceMap, outputDir });
	}

	return compileSingleFile(inputPath, {
		sourceMap,
		outputFile,
		dumpTokens,
		dumpAst,
	});
}

export function maybeMinify(js, options) {
	const {
		minify: doMinify = false,
		mangle = false,
		sourceMap = false,
	} = options ?? {};
	if (!doMinify) return js;
	if (sourceMap)
		throw new Error("--source-map and --minify cannot be used together");
	return minify(js, { mangle });
}

export function handleInit(targetDir) {
	try {
		mkdirSync(targetDir, { recursive: true });
	} catch (e) {
		throw new Error(`cannot create '${targetDir}': ${e.message}`);
	}

	const mainPath = join(targetDir, "main.go");
	if (existsSync(mainPath)) {
		throw new Error(`${mainPath} already exists — nothing written`);
	}

	const pkgName = basename(targetDir);
	const safePkg = pkgName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_");
	const template = `package ${safePkg}\n\nfunc main() {\n\tconsole.log("Hello from GoFront!")\n}\n`;

	try {
		writeFileSync(mainPath, template);
	} catch (e) {
		throw new Error(`cannot write '${mainPath}': ${e.message}`);
	}

	return { mainPath };
}

export async function handlePrep(targetDir, options = {}) {
	const resolvedTarget = resolve(targetDir);
	const assets = copyAssets(resolvedTarget, options.assetConfig);
	const vendor = await bundleVendor(resolvedTarget, options.vendorConfig);
	return { assets, vendor };
}

export function parsePrepArgs(argv) {
	const positional = argv.filter((a) => !a.startsWith("-"));
	return {
		targetDir: positional[0] ?? ".",
		vendorConfig: argv.includes("--minify") ? { minify: true } : {},
	};
}

export function formatPrepSummary({ assets, vendor }) {
	const lines = [];
	if (assets.copied > 0 || assets.skipped > 0) {
		lines.push(`copied ${assets.copied} assets (${assets.skipped} skipped)`);
	}
	if (vendor.bundled?.length > 0) {
		const dest = Array.isArray(vendor.dest)
			? vendor.dest.join(", ")
			: vendor.dest;
		const min = vendor.minify ? " (minified)" : "";
		lines.push(
			`bundled ${vendor.bundled.length} vendor dependencies → ${dest}${min}`,
		);
	}
	return lines;
}

export function parseTestArgs(argv) {
	let run = null;
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-run" || arg === "--run") {
			run = argv[++i] ?? null;
		} else if (arg.startsWith("-run=") || arg.startsWith("--run=")) {
			run = arg.slice(arg.indexOf("=") + 1);
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}
	return {
		targetDir: positional[0] ?? ".",
		verbose: argv.includes("-v"),
		dom: argv.includes("--dom"),
		run,
	};
}

export function handleTest(targetDir, options = {}) {
	return runTests(targetDir, options);
}
