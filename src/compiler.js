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
//     exportedKinds:   Map<name, kind>, // what each name is declared as (see Scope)
//   }
//
// Local imports (`import "./subpkg"`) are compiled recursively and bundled inline.
// Cross-package access uses the qualified form: `pkg.Foo`.  The codegen
// de-qualifies it because the dependency is inlined.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { CodeGen } from "./backend/js/index.js";
import { compileWasmModule, optimizeWasm } from "./backend/wasm/index.js";
import { log } from "./cli/colors.js";
import { parseDts } from "./dts-parser.js";
import { Lexer } from "./lexer/lexer.js";
import { TemplLexer } from "./lexer/templ-lexer.js";
import {
	attachSourceMap,
	buildWasmMap,
	mergeCompilationChunks,
	WASM_MAP_URL,
} from "./link/sourcemap.js";
import {
	checkGeneratedGo,
	finishStdlibJs,
	importStdlibPackages,
	mangleCollidingTypes,
	registerLocalTypeOwners,
	renameLocalTypes,
	withOriginalTypeNames,
} from "./link/stdlib.js";
import {
	linkIntoBundle,
	registerPackageUnit,
	wasmMarker,
} from "./link/wasm.js";
import { lower, takesElementAddress } from "./lower/index.js";
import { ParseError, Parser } from "./parser/index.js";
import { TemplParser } from "./parser/templ.js";
import {
	bindUntypedImports,
	isBuiltinPackage,
	isLocalPath,
	resolveAll,
	resolveGwDir,
	resolveStdlibSource,
} from "./resolver.js";
import {
	EXCLUDED_STDLIB_PACKAGES,
	TypeChecker,
	universeTypeNames,
} from "./typechecker/index.js";
import {
	BASIC_TYPES,
	JS_BUILTIN_CLASSES,
	TypeCheckError,
	UnsupportedError,
	WASM_SUPPORTED_STDLIB,
} from "./typechecker/types.js";

// ── Parse cache ──────────────────────────────────────────────

// Map<filePath, { mtime: number, ast: object }>
const _parseCache = new Map();

// A cached AST keeps everything the build attached to it (checked types,
// lowered stdlib programs), so a build of a Go-source stdlib importer pins
// megabytes.  The cache is therefore bounded; the least recently used file goes
// first.
const PARSE_CACHE_LIMIT = 16;

// A user-code diagnostic (parse, package or type errors) as opposed to a
// compiler crash. `message` is the joined text the CLI prints; `errors`
// holds the individual error objects.
export class CompileError extends Error {
	constructor(errors) {
		super(errors.map((e) => e.message).join("\n"));
		this.name = "CompileError";
		this.errors = errors;
	}
}

const ISSUES_URL = "https://github.com/seriva/gofront/issues";

// A failure of the compiler itself (lowering, code generation, linking or the
// validity check of the emitted WebAssembly) as opposed to a problem in the
// user's program. `cause` holds the original error.
export class InternalCompilerError extends Error {
	constructor(cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super(
			`internal compiler error: ${detail}\nThis is a bug in GoFront, not in your program; please report it at ${ISSUES_URL}`,
			{ cause },
		);
		this.name = "InternalCompilerError";
	}
}

// Runs `fn` as a compiler stage that has no user diagnostics of its own: a
// `CompileError` passes through, an `UnsupportedError`, `TypeCheckError` or
// `ParseError` becomes one, and anything else is a compiler bug and becomes an
// `InternalCompilerError`.
export function asInternalError(fn) {
	try {
		return fn();
	} catch (e) {
		if (e instanceof CompileError || e instanceof InternalCompilerError)
			throw e;
		// A malformed templ expression is parsed leniently and raised by the
		// code generator.
		if (
			e instanceof UnsupportedError ||
			e instanceof TypeCheckError ||
			e instanceof ParseError
		)
			throw new CompileError([e]);
		throw new InternalCompilerError(e);
	}
}

// Throws `InternalCompilerError` when the engine rejects `bytes` as a
// WebAssembly module: the compiler must never hand out a module the browser
// refuses to load.
export function validateWasm(bytes) {
	if (WebAssembly.validate(bytes)) return;
	let detail = "the module does not validate";
	try {
		new WebAssembly.Module(bytes);
	} catch (e) {
		detail = e.message;
	}
	throw new InternalCompilerError(
		new Error(`the generated WebAssembly is invalid: ${detail}`),
	);
}

export function clearParseCache() {
	_parseCache.clear();
}

// Drops one file, e.g. a throwaway source that was deleted after its build.
export function evictParseCache(filePath) {
	_parseCache.delete(resolve(filePath));
}

export function parseCacheSize() {
	return _parseCache.size;
}

// ── //go:embed ───────────────────────────────────────────────

// Whether `pattern` is not a plain path below the package directory: Go
// rejects absolute paths, `.` and `..` elements, leading or trailing
// slashes and backslashes.
function embedPatternEscapes(pattern) {
	if (pattern === "" || pattern.includes("\\") || isAbsolute(pattern))
		return true;
	if (pattern.startsWith("/") || pattern.endsWith("/")) return true;
	return pattern.split("/").some((e) => e === "" || e === "." || e === "..");
}

// The file `pattern` names below `realDir` (the real path of the package
// directory): `{ path, bytes }`, or `{ error }`. Containment is checked on the
// real path, so a symlink pointing out of the package is refused.
function embedPatternFile(realDir, pattern) {
	const escapes = { error: "embed pattern escapes package directory" };
	if (embedPatternEscapes(pattern)) return escapes;
	let real;
	try {
		real = realpathSync(join(realDir, pattern));
	} catch {
		return { error: `pattern ${pattern} matches no files` };
	}
	const rel = relative(realDir, real);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		return escapes;
	if (!statSync(real).isFile())
		return { error: `pattern ${pattern} matches no files` };
	return { path: pattern, bytes: new Uint8Array(readFileSync(real)) };
}

// Resolves the patterns of every `//go:embed` directive attached to a var to
// `_embedFiles: { path, bytes }[]`, relative to the directory of the file that
// declares it. It runs on every compile, because a cached AST must not keep
// the bytes of an earlier build. Returns the diagnostics for patterns that
// escape the package directory or match nothing.
export function resolveEmbedFiles(programs) {
	const errors = [];
	for (const p of programs) {
		if (!p._path) continue;
		let realDir = null;
		for (const d of p.decls) {
			if (d.kind !== "VarDecl") continue;
			for (const spec of d.decls) {
				for (const directive of spec._embeds ?? []) {
					directive._embedFiles = undefined;
					if (directive.error) continue;
					realDir ??= realpathSync(dirname(p._path));
					const files = new Map();
					const before = errors.length;
					for (const pattern of directive.patterns) {
						const f = embedPatternFile(realDir, pattern);
						if (f.error)
							errors.push(
								new TypeCheckError(f.error, directive, p._filename, p._source),
							);
						else files.set(f.path, f);
					}
					if (errors.length === before)
						directive._embedFiles = [...files.values()];
				}
			}
		}
	}
	return errors;
}

// ── Helpers ──────────────────────────────────────────────────

function parseGoFrontFile(filePath) {
	const key = resolve(filePath);
	const mtime = statSync(filePath).mtimeMs;
	const cached = _parseCache.get(key);
	if (cached && cached.mtime === mtime) {
		_parseCache.delete(key);
		_parseCache.set(key, cached);
		return cached.ast;
	}

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
	ast._path = resolve(filePath);
	// compileFiles overwrites `target` with the resolved one; keep the directive.
	ast._declaredTarget = ast.target;
	_parseCache.set(key, { mtime, ast });
	if (_parseCache.size > PARSE_CACHE_LIMIT)
		_parseCache.delete(_parseCache.keys().next().value);
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

// Shared tail of compileFiles / compileSingleFile: link `app.wasm`, run
// wasm-opt when requested and produce the wasm source map.
function finishWasm(options, merged, pkgTarget, outputDir) {
	const wantMap = Boolean(options.sourceMap && !options.isDependency);
	let { wasm, wat, sourceMapInfo, stringTable } = asInternalError(() =>
		linkIntoBundle(options, merged, pkgTarget, {
			sourceMappingURL: wantMap ? WASM_MAP_URL : null,
		}),
	);
	if (wasm) validateWasm(wasm);
	let wasmOptInfo = null;
	let wasmSourceMap =
		wantMap && wasm ? buildWasmMap(sourceMapInfo, outputDir) : null;

	if (wasm && options.wasmOpt) {
		const opt = optimizeWasm(wasm, {
			sourceMap: Boolean(wasmSourceMap),
			inputSourceMap: wasmSourceMap,
			sourceMapUrl: WASM_MAP_URL,
			emitWat: Boolean(options.emitWat),
			converge: Boolean(options.release),
		});
		wasm = opt.wasm;
		if (opt.wat) wat = opt.wat;
		wasmOptInfo = opt;
		if (opt.sourceMap) wasmSourceMap = opt.sourceMap;
	}
	return { wasm, wat, wasmOptInfo, wasmSourceMap, stringTable };
}

// Prints non-fatal diagnostics (e.g. JS Number precision of a constant).
function logWarnings(warnings) {
	for (const w of warnings) log.warn(w);
}

// ── Import resolution ─────────────────────────────────────────

// What link/stdlib.js needs from this module.  Injected rather than imported
// so that link/stdlib.js does not depend on compiler.js.
const STDLIB_DEPS = { gwFilesIn, resolveImports, TypeChecker };
//
// Shared by compileFiles (multi-file) and the single-file path in index.js.
// Mutates checker, jsImports, bundledPackages, and preambles in place.

function resolveImports(
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

	// npm packages — exclude side-effect imports from type resolution
	const allImportsNoSideEffect = allImports.map((imp) => ({
		...imp,
		imports: imp.imports.filter(({ alias }) => alias !== "_"),
	}));
	const resolved = resolveAll(
		allImportsNoSideEffect,
		fromFile,
		parseDts,
		options.stdlibRoot,
	);

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
					} else if (path === "gofront/shared" && pkgTarget === "both") {
						checker.err(
							"'gofront/shared' requires a wasm-only package (//gofront:target wasm): a both package has no linear memory on the JS side",
							impNode,
						);
					} else if (
						!isLocalPath(path) &&
						!EXCLUDED_STDLIB_PACKAGES.has(path) &&
						(isBuiltinPackage(path) ||
							!resolveStdlibSource(path, options.stdlibRoot))
					) {
						// An npm package without types is a dynamic global: the
						// checker reports it where the name is used.
						if (!isBuiltinPackage(path) && resolved.get(path) === null) {
							// deferred to Ident lookup
						} else if (!isBuiltinPackage(path)) {
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
				throw new CompileError([
					new Error(`Cannot read '${dtsPath}': ${e.message}`),
				]);
			}
		}
	}

	for (const [path, info] of resolved) {
		if (!info) continue;
		checker.addDefinitions(info.types, info.values);
		jsImports.set(path, [...info.values.keys()]);
	}
	bindUntypedImports(allImportsNoSideEffect, resolved, checker);

	importStdlibPackages(
		programs,
		checker,
		preambles,
		bundledDirs,
		options,
		STDLIB_DEPS,
	);

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
				// compiled once per build so its exported types keep their
				// identity across every importer, and emitted only once.
				const depKey = resolve(depDir);
				const alreadyBundled = bundledDirs.has(depKey);
				bundledDirs.add(depKey);
				const depCache = options.depCache ?? new Map();
				let dep = depCache.get(depKey);
				if (!dep) {
					try {
						dep = compileDir(depDir, {
							...options,
							bundledDirs,
							depCache,
							isDependency: true,
						});
					} catch (e) {
						// Tag the failing package (innermost wins) so callers can tell
						// a dependency's error from the importer's own.
						if (e instanceof CompileError && !e.packageDir)
							e.packageDir = depKey;
						throw e;
					}
					depCache.set(depKey, dep);
				}
				if (!alreadyBundled) preambles.push(dep);
				// A dependency that hands out `&xs[i]` makes whole-element
				// stores in this package write in place too.
				if (dep.elemAddrTaken) checker.depElemAddrTaken = true;

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
					checker.addDefinitions(dep.exportedTypes, dep.exportedSymbols, {
						external: false,
						consts: dep.exportedConsts,
						kinds: dep.exportedKinds,
					});
					continue;
				}
				const nameUsed = alias ?? dep.pkgName;
				bundledPackages.add(nameUsed);
				checker.addPackageNamespace(
					nameUsed,
					dep.exportedSymbols,
					dep.exportedTypes,
					dep.target,
					dep.exportedConsts,
					dep.exportedKinds,
				);
				checker.trackImport(nameUsed, { _line }, p._filename, p._source);
			}
		}
	}
}

// ── Main entry points ─────────────────────────────────────────

// Package target after build-time overrides (Task H6.3): `forceTarget`
// (`--js-only`) compiles every package to JS; `targetOverrides` maps package
// directories relative to the root source dir (`"engine/physics"`, `"."` for
// the root) to a target, replacing the `//gofront:target` directive.
const PACKAGE_TARGETS = new Set(["js", "wasm", "both"]);

export function resolvePackageTarget(declared, pkgDir, options = {}) {
	if (options.forceTarget) return options.forceTarget;
	const overrides = options.targetOverrides;
	if (!overrides || !options.rootDir) return declared;
	const rel = relative(resolve(options.rootDir), resolve(pkgDir))
		.split(sep)
		.join("/");
	const key = rel === "" ? "." : rel;
	const t = overrides[key] ?? (key === "." ? overrides[""] : undefined);
	if (t === undefined) return declared;
	if (!PACKAGE_TARGETS.has(t))
		throw new CompileError([
			new Error(
				`gofront.json: invalid target '${t}' for package '${key}' (expected js, wasm or both)`,
			),
		]);
	return t;
}

export function compileSingleFile(inputPath, options = {}) {
	const { outputFile = null, dumpTokens = false, dumpAst = false } = options;

	if (dumpTokens || dumpAst) {
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
		ast._path = resolve(inputPath);
		return { ast };
	}

	return compileFiles([resolve(inputPath)], {
		...options,
		outputDir:
			options.outputDir ??
			(outputFile ? dirname(resolve(outputFile)) : resolve(".")),
	});
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
	const fromDir = options.fromDir ?? dirname(resolve(files[0]));
	options = {
		...options,
		wasmUnits: options.wasmUnits ?? [],
		stdlibCache: options.stdlibCache ?? new Map(),
		jsRootPrograms: options.jsRootPrograms ?? [],
		rootDir: options.rootDir ?? fromDir,
		bundledDirs: options.bundledDirs ?? new Set(),
		typeOwners: options.typeOwners ?? new Map(),
		jsonBuild: options.jsonBuild ?? { js: false, wasm: false },
	};
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
			parseErrors.push(e);
		}
	}
	if (parseErrors.length > 0) {
		throw new CompileError(parseErrors);
	}

	// Validate consistent package name
	const pkgNames = [...new Set(programs.map((p) => p.pkg.name))];
	if (pkgNames.length > 1)
		throw new CompileError([
			new Error(`Mixed package names in ${fromDir}: ${pkgNames.join(", ")}`),
		]);
	const pkgName = pkgNames[0];

	// Local packages share one flat JS module: a type name another package
	// already declared is renamed here (`Pt` -> `Pt$$b`).
	const renamedTypes = mangleLocalTypes(
		programs,
		resolve(fromDir),
		pkgName,
		options.typeOwners,
	);

	// Validate target directives across files in this package
	const declaredTargets = new Map();
	for (const p of programs) {
		const declared = p._declaredTarget;
		if (declared) {
			if (!declaredTargets.has(declared)) declaredTargets.set(declared, []);
			declaredTargets.get(declared).push(p._filename);
		}
	}
	if (declaredTargets.size > 1) {
		const list = [...declaredTargets.entries()]
			.map(([t, fList]) => `${t} (${fList.join(", ")})`)
			.join(" vs ");
		throw new CompileError([
			new Error(
				`Conflicting //gofront:target directives in package '${pkgName}': ${list}`,
			),
		]);
	}
	const pkgTarget = resolvePackageTarget(
		declaredTargets.size === 1
			? declaredTargets.keys().next().value
			: (options.target ?? "js"),
		fromDir,
		options,
	);
	for (const p of programs) p.target = pkgTarget;

	// The test runner's driver is a source that exists only in memory: it is
	// parsed and checked with the package but never written next to it.
	const driver = testDriverProgram(options, programs, pkgTarget, fromDir);
	if (driver) programs.push(driver);

	const embedErrors = resolveEmbedFiles(programs);
	if (embedErrors.length > 0) throw new CompileError(embedErrors);

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
		{ ...options, depCache: options.depCache ?? new Map(), outputDir },
	);

	// ── 3. Type-check ─────────────────────────────────────────────
	const errors = checker.checkAll(programs);
	const codecs = checkGeneratedGo(
		programs,
		checker,
		preambles,
		options,
		STDLIB_DEPS,
	);
	checker.reportUnusedImports();
	if (errors.length > 0) {
		throw new CompileError(errors);
	}
	for (const w of checker.warnings) log.warn(w);

	// ── 4. Code generation ────────────────────────────────────────
	const emitTarget = asInternalError(() =>
		registerPackageUnit(options, {
			key: resolve(fromDir),
			pkgName,
			pkgTarget,
			programs: [...programs, ...codecs],
			types: checker.types,
			bundledPackages,
		}),
	);

	const isStrict = Boolean(options.strict || pkgTarget === "both");
	const codegen = new CodeGen(checker, jsImports, bundledPackages, {
		target: pkgTarget,
		strict: isStrict,
		natives: options.natives,
	});
	const mainJs =
		emitTarget === "wasm"
			? wasmMarker(pkgName)
			: asInternalError(() =>
					codegen.generateAll([...programs, ...codecs], {
						isTest: options.isTest ?? false,
					}),
				);
	logWarnings(codegen.warnings);
	const warnings = [...checker.warnings, ...codegen.warnings];

	const mainChunk = {
		js: mainJs,
		sourceFiles: programs.map((p) => p._path),
		sourcesContent: programs.map((p) => p._source),
		mappings: emitTarget === "wasm" ? [] : codegen.getMappings(),
	};

	const merged = asInternalError(() => {
		const chunks = mergeCompilationChunks([...preambles, mainChunk]);
		finishStdlibJs(chunks, options, [...programs, ...codecs], emitTarget);
		return chunks;
	});
	const { wasm, wat, wasmOptInfo, wasmSourceMap, stringTable } = finishWasm(
		options,
		merged,
		pkgTarget,
		outputDir,
	);

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
		warnings,
		elemAddrTaken:
			checker.depElemAddrTaken === true ||
			programs.some((p) => takesElementAddress(p.decls)),
		js: merged.js,
		css: allCss,
		wasm,
		wat,
		wasmOptInfo,
		wasmSourceMap,
		stringTable,
		programs: driver ? programs.filter((p) => p !== driver) : programs,
		exportedSymbols: checker.getExportedSymbols(),
		exportedTypes: withOriginalTypeNames(
			checker.getExportedTypes(),
			renamedTypes,
		),
		exportedConsts: checker.getExportedConsts(),
		exportedKinds: checker.getExportedKinds(),
		sourceFiles: merged.sourceFiles,
		sourcesContent: merged.sourcesContent,
		mappings: merged.mappings,
	};
}

// Parses the in-memory driver source `options.testDriver(programs, target)`
// returns (null: no driver) as a `_test.go` file of the package.
function testDriverProgram(options, programs, pkgTarget, fromDir) {
	if (!options.testDriver || options.isDependency) return null;
	const source = options.testDriver(programs, pkgTarget);
	if (!source) return null;
	const filename = "gofront_testmain_test.go";
	const ast = new Parser(
		new Lexer(source, filename).tokenize(),
		filename,
		source,
	).parse();
	ast._source = source;
	ast._path = join(fromDir, filename);
	ast._declaredTarget = ast.target;
	ast.target = pkgTarget;
	return ast;
}

// The names the programs' imports can bind: the alias, or the last path
// element (the one before a `/v2` suffix).
function importedNames(programs) {
	const names = new Set();
	for (const p of programs)
		for (const decl of p.imports ?? [])
			for (const imp of decl.imports ?? []) {
				if (imp.alias && imp.alias !== ".") names.add(imp.alias);
				const parts = String(imp.path).split("/");
				names.add(parts.at(-1));
				if (/^v\d+$/.test(parts.at(-1)) && parts.length > 1)
					names.add(parts.at(-2));
			}
	return names;
}

// Predeclared names besides the basic types that a declared type may shadow.
const PREDECLARED_NAMES = ["error", "comparable", "true", "false", "nil"];

// The renamed ASTs must not be reused from the parse cache by a later build.
function mangleLocalTypes(programs, pkgKey, pkgName, owners) {
	const predeclared = new Set([
		...Object.keys(BASIC_TYPES),
		...PREDECLARED_NAMES,
	]);
	const renamed = mangleCollidingTypes(
		programs,
		pkgKey,
		pkgName,
		owners,
		predeclared,
	);
	// A local type named after a JS built-in would shadow it in the bundle.
	// A local type named after a universe type (`GPUDevice`) must not reuse it.
	const foreign = new Set([...JS_BUILTIN_CLASSES, ...universeTypeNames()]);
	// A local type that shadows a predeclared type (`type int32 = string`)
	// gets its own name, so `int32` keeps meaning the predeclared type
	// everywhere else.
	for (const name of predeclared) foreign.add(name);
	for (const [name, owner] of owners ?? [])
		if (owner !== pkgKey) foreign.add(name);
	// A local type spelled like an import would hide the package in the other
	// functions of the file.
	for (const name of importedNames(programs)) foreign.add(name);
	// A local type spelled like a package-level var, const or func would take
	// over that value inside its function.
	for (const p of programs)
		for (const d of p.decls ?? []) {
			if (d.kind === "FuncDecl") foreign.add(d.name);
			else if (d.kind === "VarDecl" || d.kind === "ConstDecl")
				for (const spec of d.decls ?? [])
					for (const n of spec.names ?? []) foreign.add(n);
		}
	const locals = renameLocalTypes(programs, foreign);
	registerLocalTypeOwners(programs, pkgKey, owners);
	if (renamed.size > 0 || locals)
		for (const p of programs) _parseCache.delete(p._path);
	return renamed;
}

export function compileWasm(source, options = {}) {
	const filename = options.filename ?? "main.go";
	const tokens = new Lexer(source, filename).tokenize();
	const ast = new Parser(tokens, filename, source).parse();

	const checker = new TypeChecker();
	checker.target = "wasm";
	checker.pkgName = ast.pkg?.name ?? "main";

	const errors = checker.check(ast);
	if (errors.length > 0) {
		return { wasm: null, errors };
	}

	const res = asInternalError(() => {
		const lowerRes = lower([ast], checker);
		return compileWasmModule([ast], checker, lowerRes, {
			...options,
			exportAll: options.exportAll ?? true,
		});
	});

	if (checker.errors?.length > 0) {
		return { wasm: null, errors: checker.errors };
	}

	if (res?.wasm) validateWasm(res.wasm);
	return { ...res, errors: [] };
}
