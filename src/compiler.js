// GoFront package compiler.
//
// compileSingleFile(path, options) — compile one .go file
// compileDir(dir, options)         — compile all *.go in a directory as one package
// compileFiles(files, options)     — compile an explicit list of .go files
//
// compileSingleFile returns: { js } (or { tokens } / { ast } for debug modes)
// compileDir / compileFiles return:
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
import { buildSourceMap, CodeGen } from "./backend/js/index.js";
import { compileWasmModule } from "./backend/wasm/index.js";
import { log } from "./colors.js";
import { parseDts } from "./dts-parser.js";
import { Lexer } from "./lexer.js";
import { lower } from "./lower/index.js";
import { Parser } from "./parser/index.js";
import {
	isBuiltinPackage,
	isLocalPath,
	resolveAll,
	resolveGwDir,
} from "./resolver.js";
import { TemplLexer } from "./templ-lexer.js";
import { TemplParser } from "./templ-parser.js";
import { TypeChecker } from "./typechecker/index.js";
import { WASM_SUPPORTED_STDLIB } from "./typechecker/types.js";

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

export function gwFilesIn(dir, { includeTests = false } = {}) {
	return readdirSync(dir)
		.filter((f) => {
			if (!f.endsWith(".go") && !f.endsWith(".templ")) return false;
			if (!includeTests && f.endsWith("_test.go")) return false;
			return true;
		})
		.sort() // deterministic order
		.map((f) => join(dir, f));
}

function normalizeChunk(c) {
	if (typeof c === "string") {
		return { js: c, sourceFiles: [], sourcesContent: [], mappings: [] };
	}
	return c;
}

function appendChunkMappings(dest, mappings, localToUnifiedIdx, lineOffset) {
	if (!mappings) return;
	for (const m of mappings) {
		dest.push({
			genLine: m.genLine + lineOffset,
			srcLine: m.srcLine,
			srcFileIdx: localToUnifiedIdx[m.srcFileIdx ?? 0] ?? 0,
		});
	}
}

function mergeCompilationChunks(chunks) {
	const activeChunks = chunks
		.filter(Boolean)
		.map(normalizeChunk)
		.filter((c) => c.js.length > 0);

	if (activeChunks.length === 0) {
		return { js: "", sourceFiles: [], sourcesContent: [], mappings: [] };
	}

	const unifiedSources = [];
	const unifiedSourcesContent = [];
	const fileIdxMap = new Map();

	function getOrAddFile(filePath, content) {
		const key = resolve(filePath);
		let idx = fileIdxMap.get(key);
		if (idx === undefined) {
			idx = unifiedSources.length;
			fileIdxMap.set(key, idx);
			unifiedSources.push(key);
			unifiedSourcesContent.push(content);
		}
		return idx;
	}

	const combinedJsParts = [];
	const mergedMappings = [];
	let currentLineOffset = 0;

	for (const chunk of activeChunks) {
		combinedJsParts.push(chunk.js);
		const localToUnifiedIdx = (chunk.sourceFiles ?? []).map((file, i) =>
			getOrAddFile(file, chunk.sourcesContent?.[i] ?? ""),
		);
		appendChunkMappings(
			mergedMappings,
			chunk.mappings,
			localToUnifiedIdx,
			currentLineOffset,
		);
		currentLineOffset += chunk.js.split("\n").length;
	}

	return {
		js: combinedJsParts.join("\n"),
		sourceFiles: unifiedSources,
		sourcesContent: unifiedSourcesContent,
		mappings: mergedMappings,
	};
}

function attachSourceMap(merged, outputDir) {
	const relativeSources = merged.sourceFiles.map((f) => relative(outputDir, f));
	const mapJson = buildSourceMap(
		relativeSources,
		merged.mappings,
		merged.sourcesContent,
	);
	const b64 = Buffer.from(mapJson).toString("base64");
	merged.js += `\n//# sourceMappingURL=data:application/json;base64,${b64}`;
}

// ── WASM linking ──────────────────────────────────────────────
//
// Every `wasm`/`both` package reached during a build registers a unit in the
// shared `options.wasmUnits` array.  The root compile links all units into a
// single `app.wasm` and splices the generated JS facade into the bundle where
// the first wasm package's JS would have been.

const WASM_MARKER_RE = /^\/\*__GOFRONT_WASM_UNIT:[^*]*\*\/$/m;

function wasmMarker(pkgName) {
	return `/*__GOFRONT_WASM_UNIT:${pkgName}*/`;
}

function registerWasmUnit(options, unit) {
	const units = options.wasmUnits;
	if (!units) return;
	if (units.some((u) => u.key === unit.key)) return;
	units.push(unit);
}

// Registers a `wasm`/`both` package as a link unit and returns the target the
// package's own code is emitted for.  `options.wasmTests` runs a `both`
// package's tests through the wasm backend (the package is then treated as
// `wasm` for linking so its test functions are exposed by the facade).
function registerPackageUnit(options, unit) {
	const { pkgTarget, programs } = unit;
	if (pkgTarget !== "wasm" && pkgTarget !== "both") return pkgTarget;
	const emitTarget =
		options.wasmTests && options.isTest && pkgTarget === "both"
			? "wasm"
			: pkgTarget;
	registerWasmUnit(options, {
		...unit,
		target: emitTarget,
		programs:
			emitTarget === pkgTarget
				? programs
				: programs.map((p) => ({ ...p, target: emitTarget })),
	});
	return emitTarget;
}

function linkWasmUnits(units, { emitWat = false, rootTarget = "js" } = {}) {
	if (!units.some((u) => u.target === "wasm")) return null;
	checkLinkCollisions(units);

	const types = new Map();
	const bundledPackages = new Set();
	const programs = [];
	for (const u of units) {
		for (const [k, v] of u.types) types.set(k, v);
		for (const b of u.bundledPackages) bundledPackages.add(b);
		programs.push(...u.programs);
	}
	const checker = { types };
	const lowerRes = lower(programs, checker);
	return compileWasmModule(programs, checker, lowerRes, {
		boundary: true,
		bundledPackages,
		emitWat,
		callMain: rootTarget === "wasm",
	});
}

// The linked module is one flat namespace (like the JS bundle), so a top-level
// name declared by two different packages would silently resolve to whichever
// was emitted last.  Reject it up front.
function topLevelDeclNames(decl) {
	switch (decl.kind) {
		case "FuncDecl":
			return [decl.name];
		case "MethodDecl":
			return [`${decl.recvType?.name ?? "?"}.${decl.name}`];
		case "TypeDecl":
			return [decl.name];
		case "VarDecl":
		case "ConstDecl":
			return (decl.decls ?? []).flatMap((spec) => spec.names ?? []);
		default:
			return [];
	}
}

function checkLinkCollisions(units) {
	const owner = new Map(); // name -> pkgName
	const errors = [];
	for (const u of units) {
		for (const p of u.programs) {
			for (const d of p.decls ?? []) {
				for (const name of topLevelDeclNames(d)) {
					if (name === "_") continue;
					const prev = owner.get(name);
					if (prev === undefined) owner.set(name, u.pkgName);
					else if (prev !== u.pkgName)
						errors.push(
							`cannot link wasm packages: '${name}' is declared in both '${prev}' and '${u.pkgName}' (linked wasm packages share one namespace)`,
						);
				}
			}
		}
	}
	if (errors.length > 0) throw new Error([...new Set(errors)].join("\n"));
}

// Replaces the first wasm marker with the facade (dropping the others) and
// shifts source-map lines that follow it.
function spliceFacade(merged, facade) {
	const lines = merged.js.split("\n");
	const first = lines.findIndex((l) => WASM_MARKER_RE.test(l));
	if (first < 0) {
		merged.js = `${facade}\n${merged.js}`;
		const shift = facade.split("\n").length;
		for (const m of merged.mappings) m.genLine += shift;
		return;
	}
	const facadeLines = facade.split("\n");
	const delta = facadeLines.length - 1;
	for (const m of merged.mappings) {
		if (m.genLine > first) m.genLine += delta;
	}
	const out = [...lines.slice(0, first), ...facadeLines];
	for (let i = first + 1; i < lines.length; i++) {
		if (!WASM_MARKER_RE.test(lines[i])) out.push(lines[i]);
	}
	merged.js = out.join("\n");
}

// Root compiles only: link every registered unit into app.wasm and splice the
// facade into the merged bundle.  Returns `{ wasm, wat }` (nulls when there
// is nothing to link).
function linkIntoBundle(options, merged, pkgTarget) {
	if (options.isDependency) return { wasm: null, wat: null };
	const linked = linkWasmUnits(options.wasmUnits, {
		emitWat: options.emitWat,
		rootTarget: pkgTarget,
	});
	if (!linked) return { wasm: null, wat: null };
	spliceFacade(merged, linked.facade);
	return { wasm: linked.wasm, wat: linked.wat ?? null };
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
	bundledDirs = new Set(),
	options = {},
) {
	const fromDir = dirname(resolve(fromFile));
	const allImports = programs.flatMap((p) => p.imports);
	const pkgTarget = checker.target ?? "js";
	const pkgName = checker.pkgName ?? programs[0]?.pkg?.name ?? "main";

	// Validate target rules on non-local imports
	if (pkgTarget === "wasm" || pkgTarget === "both") {
		for (const p of programs) {
			const saved = [checker._currentFile, checker._currentSource];
			checker._currentFile = p._filename ?? null;
			checker._currentSource = p._source ?? null;
			for (const imp of p.imports) {
				for (const { path, _line, _col, line, col } of imp.imports) {
					const impNode = {
						_line,
						_col,
						line: line ?? _line,
						col: col ?? _col ?? 1,
					};
					if (path.startsWith("js:")) {
						checker.recordBlocker("js: import", path);
						checker.err(
							"js: imports are not allowed in wasm packages",
							impNode,
						);
					} else if (path === "gom") {
						checker.recordBlocker("gom usage", "gom");
						checker.err(
							"package 'gom' is not available in wasm packages",
							impNode,
						);
					} else if (!isLocalPath(path)) {
						if (!isBuiltinPackage(path)) {
							checker.recordBlocker("js: import", path);
							checker.err(
								"js: imports are not allowed in wasm packages",
								impNode,
							);
						} else if (!WASM_SUPPORTED_STDLIB.has(path)) {
							checker.recordBlocker("unsupported stdlib import", path);
							checker.err(
								`'${path}' is not yet available in wasm packages`,
								impNode,
							);
						}
					}
				}
			}
			[checker._currentFile, checker._currentSource] = saved;
		}
	}

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
			for (const { path, alias, _line, _col, line, col } of imp.imports) {
				if (!isLocalPath(path) || seenLocalPaths.has(path)) continue;
				seenLocalPaths.add(path);
				const depDir = resolveGwDir(path, fromFile);
				if (!depDir) {
					log.warn(
						`cannot find local package '${path}' relative to ${fromDir}`,
					);
					continue;
				}
				// Diamond imports: a package reached through several paths is
				// compiled for its symbols each time but emitted only once.
				const depKey = resolve(depDir);
				const alreadyBundled = bundledDirs.has(depKey);
				bundledDirs.add(depKey);
				const dep = compileDir(depDir, {
					...options,
					bundledDirs,
					isDependency: true,
				});
				if (!alreadyBundled) preambles.push(dep);

				// Target import rules for local packages
				const impNode = {
					_line,
					_col,
					line: line ?? _line,
					col: col ?? _col ?? 1,
				};
				if (pkgTarget === "wasm" && dep.target === "js") {
					const saved = [checker._currentFile, checker._currentSource];
					checker._currentFile = p._filename ?? null;
					checker._currentSource = p._source ?? null;
					checker.recordBlocker("js package import", dep.pkgName);
					checker.err(
						`package '${pkgName}' (wasm) cannot import '${dep.pkgName}' (js)`,
						impNode,
					);
					[checker._currentFile, checker._currentSource] = saved;
				} else if (pkgTarget === "both") {
					const saved = [checker._currentFile, checker._currentSource];
					checker._currentFile = p._filename ?? null;
					checker._currentSource = p._source ?? null;
					if (dep.target === "js") {
						checker.recordBlocker("js package import", dep.pkgName);
						checker.err(
							`package '${pkgName}' (both) cannot import '${dep.pkgName}' (js)`,
							impNode,
						);
					} else if (dep.target === "wasm") {
						checker.recordBlocker("wasm package import", dep.pkgName);
						checker.err(
							`package '${pkgName}' (both) can only import 'both' packages; '${dep.pkgName}' is wasm`,
							impNode,
						);
					}
					[checker._currentFile, checker._currentSource] = saved;
				}

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

export function compileSingleFile(inputPath, options = {}) {
	const {
		sourceMap = false,
		outputFile = null,
		dumpTokens = false,
		dumpAst = false,
	} = options;
	options = { ...options, wasmUnits: options.wasmUnits ?? [] };

	let source;
	try {
		source = readFileSync(inputPath, "utf8");
	} catch (e) {
		throw new Error(`cannot read '${inputPath}': ${e.message}`);
	}

	const tokens = new Lexer(source, basename(inputPath)).tokenize();
	if (dumpTokens) return { tokens };

	const ast = new Parser(tokens, basename(inputPath), source).parse();
	ast._source = source;
	if (dumpAst) return { ast };

	const outputDir =
		options.outputDir ??
		(outputFile ? dirname(resolve(outputFile)) : resolve("."));

	const checker = new TypeChecker();
	const jsImports = new Map();
	const bundledPackages = new Set();
	const preambles = [];

	const pkgTarget = ast.target ?? options.target ?? "js";
	ast.target = pkgTarget;
	checker.target = pkgTarget;
	checker.pkgName = ast.pkg?.name ?? "main";

	resolveImports(
		[ast],
		inputPath,
		checker,
		jsImports,
		bundledPackages,
		preambles,
		options.bundledDirs ?? new Set(),
		{ ...options, outputDir },
	);

	const errors = checker.check(ast);
	checker.reportUnusedImports();
	if (errors.length > 0) {
		throw new Error(errors.map((e) => e.message).join("\n"));
	}

	if (pkgTarget === "wasm" || pkgTarget === "both") {
		registerWasmUnit(options, {
			key: resolve(inputPath),
			pkgName: checker.pkgName,
			target: pkgTarget,
			programs: [ast],
			types: checker.types,
			bundledPackages,
		});
	}

	const isStrict = Boolean(options.strict || pkgTarget === "both");
	const cg = new CodeGen(checker, jsImports, bundledPackages, {
		target: pkgTarget,
		strict: isStrict,
	});
	const mainJs =
		pkgTarget === "wasm" ? wasmMarker(checker.pkgName) : cg.generate(ast);

	const mainChunk = {
		js: mainJs,
		sourceFiles: [resolve(inputPath)],
		sourcesContent: [source],
		mappings: pkgTarget === "wasm" ? [] : cg.getMappings(),
	};

	const merged = mergeCompilationChunks([...preambles, mainChunk]);
	const { wasm, wat } = linkIntoBundle(options, merged, pkgTarget);

	if (sourceMap && !options.isDependency) {
		attachSourceMap(merged, outputDir);
	}

	return { js: merged.js, css: cg.getCss(), target: pkgTarget, wasm, wat };
}

export function compileDir(dir, options = {}) {
	const files = gwFilesIn(dir, { includeTests: options.includeTests ?? false });
	if (files.length === 0) throw new Error(`No .go files found in ${dir}`);
	return compileFiles(files, { ...options, fromDir: dir });
}

export function compilePackageTests(dir, options = {}) {
	const files = gwFilesIn(dir, { includeTests: true });
	if (files.length === 0) throw new Error(`No .go files found in ${dir}`);
	return compileFiles(files, { ...options, fromDir: dir, isTest: true });
}

// Compiles a `both` package's tests through the wasm backend (the JS run uses
// compilePackageTests).  Returns null for packages that are not `both`.
export function compilePackageTestsWasm(dir, options = {}) {
	const res = compilePackageTests(dir, { ...options, wasmTests: true });
	return res.target === "both" ? res : null;
}

export function compileFiles(files, options = {}) {
	options = { ...options, wasmUnits: options.wasmUnits ?? [] };
	const fromDir = options.fromDir ?? dirname(resolve(files[0]));
	const outputDir =
		options.outputDir ??
		(options.outputFile ? dirname(resolve(options.outputFile)) : fromDir);

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

	// Validate target directives across files in this package
	const declaredTargets = new Map();
	for (const p of programs) {
		if (p.target) {
			if (!declaredTargets.has(p.target)) declaredTargets.set(p.target, []);
			declaredTargets.get(p.target).push(p._filename);
		}
	}
	if (declaredTargets.size > 1) {
		const list = [...declaredTargets.entries()]
			.map(([t, fList]) => `${t} (${fList.join(", ")})`)
			.join(" vs ");
		throw new Error(
			`Conflicting //gofront:target directives in package '${pkgName}': ${list}`,
		);
	}
	const pkgTarget =
		declaredTargets.size === 1
			? declaredTargets.keys().next().value
			: (options.target ?? "js");
	for (const p of programs) p.target = pkgTarget;

	// ── 2. Resolve imports ────────────────────────────────────────
	const checker = new TypeChecker();
	checker.target = pkgTarget;
	checker.pkgName = pkgName;
	const jsImports = new Map(); // npm imports → exported names (for ESM emit)
	const bundledPackages = new Set(); // package names whose code is inlined
	const preambles = []; // JS code / chunks from compiled sub-packages

	const dummyFromFile = join(fromDir, "_dummy.go");
	resolveImports(
		programs,
		dummyFromFile,
		checker,
		jsImports,
		bundledPackages,
		preambles,
		options.bundledDirs ?? new Set(),
		{ ...options, outputDir },
	);

	// ── 3. Type-check ─────────────────────────────────────────────
	const errors = checker.checkAll(programs);
	checker.reportUnusedImports();
	if (errors.length > 0) {
		const msgs = errors.map((e) => e.message).join("\n");
		throw new Error(msgs);
	}

	// ── 4. Code generation ────────────────────────────────────────
	const emitTarget = registerPackageUnit(options, {
		key: resolve(fromDir),
		pkgName,
		pkgTarget,
		programs,
		types: checker.types,
		bundledPackages,
	});

	const isStrict = Boolean(options.strict || pkgTarget === "both");
	const codegen = new CodeGen(checker, jsImports, bundledPackages, {
		target: pkgTarget,
		strict: isStrict,
	});
	const mainJs =
		emitTarget === "wasm"
			? wasmMarker(pkgName)
			: codegen.generateAll(programs, {
					isTest: options.isTest ?? false,
				});

	const mainChunk = {
		js: mainJs,
		sourceFiles: files.map((f) => resolve(f)),
		sourcesContent: files.map((f) => readFileSync(f, "utf8")),
		mappings: emitTarget === "wasm" ? [] : codegen.getMappings(),
	};

	const merged = mergeCompilationChunks([...preambles, mainChunk]);
	const { wasm, wat } = linkIntoBundle(options, merged, pkgTarget);

	if (options.sourceMap && !options.isDependency) {
		attachSourceMap(merged, outputDir);
	}

	const mainCss = codegen.getCss();
	const allCss = [...preambles.map((p) => p.css).filter(Boolean), mainCss]
		.filter(Boolean)
		.join("\n\n");

	return {
		pkgName,
		target: pkgTarget,
		js: merged.js,
		css: allCss,
		wasm,
		wat,
		programs,
		exportedSymbols: checker.getExportedSymbols(),
		exportedTypes: checker.getExportedTypes(),
		sourceFiles: merged.sourceFiles,
		sourcesContent: merged.sourcesContent,
		mappings: merged.mappings,
	};
}
