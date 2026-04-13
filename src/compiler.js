// Multi-file GoWeb package compiler.
//
// compileDir(dir, options)   — compile all *.go in a directory as one package
// compileFiles(files, options) — compile an explicit list of .go files
//
// Both return:
//   {
//     pkgName:         string,
//     js:              string,          // generated JS bundle (may include dep preamble)
//     exportedSymbols: Map<name, type>, // for importers to build a namespace
//     exportedTypes:   Map<name, type>,
//   }
//
// Local imports (`import "./subpkg"`) are compiled recursively and bundled inline.
// Cross-package access uses the qualified form: `pkg.Foo`.  The codegen
// de-qualifies it because the dependency is inlined.

import { readFileSync, readdirSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { TypeChecker } from "./typechecker.js";
import { CodeGen } from "./codegen.js";
import { parseDts } from "./dts-parser.js";
import { resolveAll, isLocalPath, resolveGwDir } from "./resolver.js";

// ── Helpers ──────────────────────────────────────────────────

function parseFile(filePath) {
	const source = readFileSync(filePath, "utf8");
	const filename = basename(filePath);
	const tokens = new Lexer(source, filename).tokenize();
	const ast = new Parser(tokens, filename, source).parse();
	ast._source = source;
	return ast;
}

function gwFilesIn(dir) {
	return readdirSync(dir)
		.filter((f) => f.endsWith(".go"))
		.sort() // deterministic order
		.map((f) => join(dir, f));
}

// ── Main entry points ─────────────────────────────────────────

export function compileDir(dir, options = {}) {
	const files = gwFilesIn(dir);
	if (files.length === 0) throw new Error(`No .go files found in ${dir}`);
	return compileFiles(files, { ...options, fromDir: dir });
}

export function compileFiles(files, options = {}) {
	const fromDir = options.fromDir ?? dirname(resolve(files[0]));

	// ── 1. Parse ─────────────────────────────────────────────────
	const parseErrors = [];
	const programs = [];
	for (const f of files) {
		try {
			programs.push(parseFile(f));
		} catch (e) {
			parseErrors.push(e.message);
		}
	}
	if (parseErrors.length > 0) {
		throw new Error(parseErrors.join("\n"));
	}

	// Validate consistent package name
	const pkgNames = [...new Set(programs.map((p) => p.pkg.name))];
	if (pkgNames.length > 1)
		throw new Error(
			`Mixed package names in ${fromDir}: ${pkgNames.join(", ")}`,
		);
	const pkgName = pkgNames[0];

	// ── 2. Resolve imports ────────────────────────────────────────
	const checker = new TypeChecker();
	const jsImports = new Map(); // npm imports → exported names (for ESM emit)
	const bundledPackages = new Set(); // package names whose code is inlined
	const preambles = []; // JS code from compiled sub-packages

	const allImports = programs.flatMap((p) => p.imports);
	const dummyFromFile = join(fromDir, "_dummy.go");

	// js: prefix — local .d.ts files
	for (const imp of allImports) {
		for (const path of imp.paths) {
			if (!path.startsWith("js:")) continue;
			const dtsPath = join(fromDir, path.slice(3));
			try {
				const { types, values } = parseDts(readFileSync(dtsPath, "utf8"));
				checker.addDefinitions(types, values);
			} catch (e) {
				throw new Error(`Cannot read '${dtsPath}': ${e.message}`);
			}
		}
	}

	// npm packages
	const resolved = resolveAll(allImports, dummyFromFile, parseDts);
	for (const [path, info] of resolved) {
		if (!info) continue;
		checker.addDefinitions(info.types, info.values);
		jsImports.set(path, [...info.values.keys()]);
	}

	// local GoWeb packages (./subdir)
	const seenLocalPaths = new Set();
	for (const imp of allImports) {
		for (const path of imp.paths) {
			if (!isLocalPath(path) || seenLocalPaths.has(path)) continue;
			seenLocalPaths.add(path);

			const depDir = resolveGwDir(path, dummyFromFile);
			if (!depDir) {
				console.error(
					`goweb: warning: cannot find local package '${path}' relative to ${fromDir}`,
				);
				continue;
			}

			// Recursively compile dependency
			const dep = compileDir(depDir);
			preambles.push(dep.js);
			bundledPackages.add(dep.pkgName);
			checker.addPackageNamespace(
				dep.pkgName,
				dep.exportedSymbols,
				dep.exportedTypes,
			);
		}
	}

	// ── 3. Type-check ─────────────────────────────────────────────
	const errors = checker.checkAll(programs);
	if (errors.length > 0) {
		const msgs = errors.map((e) => e.message).join("\n");
		throw new Error(msgs);
	}

	// ── 4. Code generation ────────────────────────────────────────
	const codegen = new CodeGen(checker, jsImports, bundledPackages);
	const mainJs = codegen.generateAll(programs);

	const js =
		preambles.length > 0 ? preambles.join("\n") + "\n" + mainJs : mainJs;

	return {
		pkgName,
		js,
		exportedSymbols: checker.getExportedSymbols(),
		exportedTypes: checker.getExportedTypes(),
	};
}
