// CLI compilation core — extracted for direct import in tests.
// index.js retains only arg parsing, file I/O, watch mode, and process.exit.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { compileDir, compileSingleFile } from "./compiler.js";
import { minify } from "./minifier.js";

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
