// Multi-file GoFront package compiler.
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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CodeGen } from "./codegen.js";
import { parseDts } from "./dts-parser.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { isLocalPath, resolveAll, resolveGwDir } from "./resolver.js";
import { TemplLexer } from "./templ-lexer.js";
import { TemplParser } from "./templ-parser.js";
import { TypeChecker } from "./typechecker.js";

// ── Parse cache ──────────────────────────────────────────────

// Map<filePath, { mtime: number, ast: object }>
const _parseCache = new Map();

export function clearParseCache() {
	_parseCache.clear();
}

export function parseCacheSize() {
	return _parseCache.size;
}

// ── Helpers ──────────────────────────────────────────────────

function parseGoFrontFile(filePath) {
	const mtime = statSync(filePath).mtimeMs;
	const cached = _parseCache.get(filePath);
	if (cached && cached.mtime === mtime) return cached.ast;

	const source = readFileSync(filePath, "utf8");
	const filename = basename(filePath);
	const isTempl = filePath.endsWith(".templ");
	const tokens = isTempl
		? new TemplLexer(source, filename).tokenize()
		: new Lexer(source, filename).tokenize();
	const ast = isTempl
		? new TemplParser(tokens, filename, source).parse()
		: new Parser(tokens, filename, source).parse();
	ast._source = source;
	_parseCache.set(filePath, { mtime, ast });
	return ast;
}

function gwFilesIn(dir) {
	return readdirSync(dir)
		.filter((f) => f.endsWith(".go") || f.endsWith(".templ"))
		.sort() // deterministic order
		.map((f) => join(dir, f));
}

// ── Import resolution ─────────────────────────────────────────
//
// Shared by compileFiles (multi-file) and the single-file path in index.js.
// Mutates checker, jsImports, bundledPackages, and preambles in place.

export function resolveImports(
	programs,
	fromFile,
	checker,
	jsImports,
	bundledPackages,
	preambles,
) {
	const fromDir = dirname(resolve(fromFile));
	const allImports = programs.flatMap((p) => p.imports);

	// js: prefix — local .d.ts files
	for (const imp of allImports) {
		for (const { path, alias } of imp.imports) {
			if (!path.startsWith("js:")) continue;
			if (alias === "_") continue;
			const dtsPath = join(fromDir, path.slice(3));
			try {
				const { types, values } = parseDts(readFileSync(dtsPath, "utf8"));
				checker.addDefinitions(types, values);
			} catch (e) {
				throw new Error(`Cannot read '${dtsPath}': ${e.message}`);
			}
		}
	}

	// npm packages — exclude side-effect imports from type resolution
	const allImportsNoSideEffect = allImports.map((imp) => ({
		...imp,
		imports: imp.imports.filter(({ alias }) => alias !== "_"),
	}));
	const resolved = resolveAll(allImportsNoSideEffect, fromFile, parseDts);
	for (const [path, info] of resolved) {
		if (!info) continue;
		checker.addDefinitions(info.types, info.values);
		jsImports.set(path, [...info.values.keys()]);
	}

	// local GoFront packages (./subdir)
	const seenLocalPaths = new Set();
	for (const p of programs) {
		for (const imp of p.imports) {
			for (const { path, alias, _line } of imp.imports) {
				if (!isLocalPath(path) || seenLocalPaths.has(path)) continue;
				seenLocalPaths.add(path);
				const depDir = resolveGwDir(path, fromFile);
				if (!depDir) {
					console.error(
						`gofront: warning: cannot find local package '${path}' relative to ${fromDir}`,
					);
					continue;
				}
				const dep = compileDir(depDir);
				preambles.push(dep.js);
				if (alias === "_") continue;
				if (alias === ".") {
					checker.addDefinitions(dep.exportedTypes, dep.exportedSymbols);
					continue;
				}
				const nameUsed = alias ?? dep.pkgName;
				bundledPackages.add(nameUsed);
				checker.addPackageNamespace(
					nameUsed,
					dep.exportedSymbols,
					dep.exportedTypes,
				);
				checker.trackImport(nameUsed, { _line }, p._filename, p._source);
			}
		}
	}
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
			programs.push(parseGoFrontFile(f));
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

	const dummyFromFile = join(fromDir, "_dummy.go");
	resolveImports(
		programs,
		dummyFromFile,
		checker,
		jsImports,
		bundledPackages,
		preambles,
	);

	// ── 3. Type-check ─────────────────────────────────────────────
	const errors = checker.checkAll(programs);
	checker.reportUnusedImports();
	if (errors.length > 0) {
		const msgs = errors.map((e) => e.message).join("\n");
		throw new Error(msgs);
	}

	// ── 4. Code generation ────────────────────────────────────────
	const codegen = new CodeGen(checker, jsImports, bundledPackages);
	const mainJs = codegen.generateAll(programs);

	let js = preambles.length > 0 ? `${preambles.join("\n")}\n${mainJs}` : mainJs;

	if (options.sourceMap) {
		const outputDir = options.outputDir ?? fromDir;
		const sourceFiles = files.map((f) => relative(outputDir, f));
		const sourcesContent = files.map((f) => readFileSync(f, "utf8"));
		const map = codegen.getSourceMap(sourceFiles, sourcesContent);
		const b64 = Buffer.from(map).toString("base64");
		js += `\n//# sourceMappingURL=data:application/json;base64,${b64}`;
	}

	return {
		pkgName,
		js,
		exportedSymbols: checker.getExportedSymbols(),
		exportedTypes: checker.getExportedTypes(),
	};
}
