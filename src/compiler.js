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
//     exportedTypes:   Map<name, type>, // the package's own declared types
//     reachedTypes:    Map<name, type>, // types its imports registered (table only)
//     exportedKinds:   Map<name, kind>, // what each name is declared as (see Scope)
//   }
//
// Local imports (`import "./subpkg"`) are compiled recursively and bundled inline.
// Cross-package access uses the qualified form: `pkg.Foo`.  The codegen
// de-qualifies it because the dependency is inlined.

import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
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
import {
	clearParseCache,
	evictParseCache,
	freezeParseCache,
	parseCacheSize,
	parseGoFrontFile,
} from "./link/parse-cache.js";
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
	isExported,
	JS_BUILTIN_CLASSES,
	TypeCheckError,
	UnsupportedError,
	WASM_SUPPORTED_STDLIB,
} from "./typechecker/types.js";

// The parse cache lives in link/parse-cache.js; tests and the CLI reach it here.
export { clearParseCache, evictParseCache, freezeParseCache, parseCacheSize };

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

// The character class of a glob element that starts at `chars[i]` (just after
// its `[`): `{ neg, ranges, end }` with `end` the index of the closing `]`, or
// null when it is malformed.
function parseGlobClass(chars, i) {
	const cls = { neg: chars[i] === "^", ranges: [], end: 0 };
	if (cls.neg) i++;
	const bound = (c) => c !== undefined && c !== "-" && c !== "]";
	while (chars[i] !== "]" || cls.ranges.length === 0) {
		const lo = chars[i];
		let hi = lo;
		if (!bound(lo)) return null;
		i++;
		if (chars[i] === "-") {
			hi = chars[i + 1];
			if (!bound(hi)) return null;
			i += 2;
		}
		if (i >= chars.length) return null;
		cls.ranges.push([lo.codePointAt(0), hi.codePointAt(0)]);
	}
	cls.end = i;
	return cls;
}

// A glob element as path.Match reads it, as tokens: "*", "?", a literal
// character or a character class `{ neg, ranges }`. null when it is malformed.
function parseGlobElement(element) {
	const chars = Array.from(element);
	const tokens = [];
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		if (c === "*" || c === "?") tokens.push(c);
		else if (c !== "[") tokens.push({ lit: c });
		else {
			const cls = parseGlobClass(chars, i + 1);
			if (!cls) return null;
			tokens.push(cls);
			i = cls.end;
		}
	}
	return tokens;
}

// Whether `name` matches the parsed glob element `tokens` (path.Match for one
// path element: `*` never matches a slash because elements have none).
function globMatches(tokens, name) {
	const chars = Array.from(name);
	const at = (t, n) => {
		if (t === tokens.length) return n === chars.length;
		const tok = tokens[t];
		if (tok === "*") {
			for (let k = n; k <= chars.length; k++) if (at(t + 1, k)) return true;
			return false;
		}
		if (n === chars.length) return false;
		if (tok === "?") return at(t + 1, n + 1);
		if (tok.lit !== undefined) return tok.lit === chars[n] && at(t + 1, n + 1);
		const cp = chars[n].codePointAt(0);
		const hit = tok.ranges.some(([lo, hi]) => lo <= cp && cp <= hi);
		return hit !== tok.neg && at(t + 1, n + 1);
	};
	return at(0, 0);
}

// The package-relative paths `elements` (a pattern split at its slashes)
// matches below `realDir`, in directory order. An element without `*?[` is
// taken as written.
function globPaths(realDir, elements) {
	let found = [""];
	for (const element of elements) {
		const tokens = /[*?[]/.test(element) ? parseGlobElement(element) : null;
		const next = [];
		for (const base of found) {
			const join_ = (name) => (base === "" ? name : `${base}/${name}`);
			if (!tokens) {
				try {
					lstatSync(join(realDir, join_(element)));
					next.push(join_(element));
				} catch {}
				continue;
			}
			let names;
			try {
				names = readdirSync(join(realDir, base)).sort();
			} catch {
				continue;
			}
			for (const name of names)
				if (globMatches(tokens, name)) next.push(join_(name));
		}
		found = next;
	}
	return found;
}

// A path that does not leave `realDir`: `real` is its real path.
function insideDir(realDir, real) {
	const rel = relative(realDir, real);
	return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

// Adds the files of the directory `rel` to `files`, as Go does: names that
// start with `.` or `_` are left out unless `all`, and so are nested modules.
// A symlink or other irregular file is an error. Returns that error or null.
function walkEmbedDir(realDir, rel, all, files) {
	const entries = readdirSync(join(realDir, rel), { withFileTypes: true });
	for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const path = `${rel}/${entry.name}`;
		if (!all && (entry.name[0] === "." || entry.name[0] === "_")) continue;
		if (entry.isDirectory()) {
			if (existsSync(join(realDir, path, "go.mod"))) continue;
			const error = walkEmbedDir(realDir, path, all, files);
			if (error) return error;
		} else if (entry.isFile()) {
			files.set(path, readEmbedFile(realDir, path));
		} else return `cannot embed irregular file ${path}`;
	}
	return null;
}

const readEmbedFile = (realDir, path) => ({
	path,
	bytes: new Uint8Array(readFileSync(join(realDir, path))),
});

// Adds what the matched path `rel` names to `files`: a file, or the tree of a
// directory. Returns the error, or null.
function addEmbedMatch(realDir, rel, all, files) {
	let real;
	let st;
	try {
		real = realpathSync(join(realDir, rel));
		st = statSync(real);
	} catch {
		return `cannot embed irregular file ${rel}`;
	}
	if (!insideDir(realDir, real))
		return "embed pattern escapes package directory";
	if (st.isFile()) {
		files.set(rel, readEmbedFile(realDir, rel));
		return null;
	}
	if (!st.isDirectory()) return `cannot embed irregular file ${rel}`;
	const before = files.size;
	const error = walkEmbedDir(realDir, rel, all, files);
	if (error) return error;
	return files.size === before
		? `cannot embed directory ${rel}: contains no embeddable files`
		: null;
}

// The files `pattern` names below `realDir` (the real path of the package
// directory): `{ files: { path, bytes }[] }`, or `{ error }`. A pattern is a
// path.Match glob over the package tree, optionally prefixed with `all:`; a
// directory it matches contributes its tree. Containment is checked on the real
// path of every match, so a symlink pointing out of the package is refused.
function embedPatternFiles(realDir, pattern) {
	const escapes = { error: "embed pattern escapes package directory" };
	const all = pattern.startsWith("all:");
	const glob = all ? pattern.slice(4) : pattern;
	if (embedPatternEscapes(glob)) return escapes;
	const elements = glob.split("/");
	if (elements.some((e) => /[*?[]/.test(e) && !parseGlobElement(e)))
		return { error: `pattern ${pattern}: invalid pattern syntax` };
	const matches = globPaths(realDir, elements);
	if (matches.length === 0)
		return { error: `pattern ${pattern} matches no files` };
	const files = new Map();
	for (const rel of matches) {
		const error = addEmbedMatch(realDir, rel, all, files);
		if (error) return { error };
	}
	return { files: [...files.values()] };
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
						const f = embedPatternFiles(realDir, pattern);
						if (f.error)
							errors.push(
								new TypeCheckError(f.error, directive, p._filename, p._source),
							);
						else for (const file of f.files) files.set(file.path, file);
					}
					if (errors.length === before)
						directive._embedFiles = [...files.values()].sort((a, b) =>
							a.path < b.path ? -1 : 1,
						);
				}
			}
		}
	}
	return errors;
}

// ── Helpers ──────────────────────────────────────────────────

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
				for (const { path, alias, _line, _col, line, col } of imp.imports) {
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
						if (
							!isBuiltinPackage(path) &&
							resolved.get(path) === null &&
							alias !== "."
						) {
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

	// js: prefix — local .d.ts files, bound in the file that imports them
	const localDts = new Map();
	for (const p of programs) {
		for (const imp of p.imports) {
			for (const { path, alias } of imp.imports) {
				if (!path.startsWith("js:") || alias === "_") continue;
				const dtsPath = join(fromDir, path.slice(3));
				if (!localDts.has(dtsPath)) {
					try {
						localDts.set(dtsPath, parseDts(readFileSync(dtsPath, "utf8")));
					} catch (e) {
						throw new CompileError([
							new Error(`Cannot read '${dtsPath}': ${e.message}`),
						]);
					}
				}
				const { types, values } = localDts.get(dtsPath);
				checker.addDefinitions(types, values, { file: p._filename ?? null });
			}
		}
	}

	// npm packages with types, likewise bound per importing file
	for (const [path, info] of resolved) {
		if (info) jsImports.set(path, [...info.values.keys()]);
	}
	for (const p of programs) {
		for (const imp of p.imports) {
			for (const { path, alias } of imp.imports) {
				const info = alias === "_" ? null : resolved.get(path);
				if (info)
					checker.addDefinitions(info.types, info.values, {
						file: p._filename ?? null,
					});
			}
		}
	}
	bindUntypedImports(programs, resolved, checker);

	importStdlibPackages(
		programs,
		checker,
		preambles,
		bundledDirs,
		options,
		STDLIB_DEPS,
	);

	// local GoFront packages (./subdir), bound in each file that imports them;
	// a package reached through several files or paths is compiled once.
	for (const p of programs) {
		for (const imp of p.imports) {
			for (const { path, alias, _line, _col, line, col } of imp.imports) {
				if (!isLocalPath(path)) continue;
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
					// A dot import binds only what the package exports.
					const bind = p._generated ? (m) => m : exportedEntries;
					checker.addDefinitions(
						bind(dep.exportedTypes),
						bind(dep.exportedSymbols),
						{
							external: false,
							consts: bind(dep.exportedConsts),
							kinds: dep.exportedKinds,
							file: p._filename ?? null,
							reached: p._generated
								? dep.reachedTypes
								: withUnexportedTypes(dep),
						},
					);
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
					p._filename ?? null,
					dep.reachedTypes,
				);
				checker.trackImport(nameUsed, { _line }, p._filename, p._source);
			}
		}
	}
}

// The types `dep` reaches (table only) plus its unexported ones: a dot import
// does not bind them, but the importer's generated Go names the unexported
// type of a value an exported function returns.
function withUnexportedTypes(dep) {
	const hidden = [...dep.exportedTypes].filter(([name]) => !isExported(name));
	return new Map([...hidden, ...dep.reachedTypes]);
}

// The entries of `map` whose name is exported (Go's export rule).
function exportedEntries(map) {
	return new Map([...map].filter(([name]) => isExported(name)));
}

// ── Package dependency graph ──────────────────────────────────

// The local imports of the package in `pkgDir`: `{ dir, program, spec }` for
// each import whose directory resolveImports will find.
function* localImports(programs, pkgDir) {
	const fromFile = join(pkgDir, "_dummy.go");
	for (const program of programs)
		for (const imp of program.imports ?? [])
			for (const spec of imp.imports) {
				if (!isLocalPath(spec.path)) continue;
				const dir = resolveGwDir(spec.path, fromFile);
				if (dir) yield { dir: resolve(dir), program, spec };
			}
}

// The parsed files of the dependency in `dir`, as compileDir would read them;
// null when it has none or does not parse (compiling it reports that).
function parseDependency(dir, options) {
	try {
		const files = gwFilesIn(dir, {
			includeTests: options.includeTests ?? false,
		});
		return files.length > 0 ? files.map(parseGoFrontFile) : null;
	} catch {
		return null;
	}
}

// `import cycle not allowed` for the cycle `trail` (the packages from the
// first member of the cycle down to the importer) closes by importing
// `closing`. It is reported at the import that leaves the first member.
function importCycleError(trail, closing, names, rootKey) {
	const keys = [...trail.map((f) => f.key), closing];
	const named = keys.map((k) => names.get(k));
	const label =
		new Set(named).size === new Set(keys).size
			? named
			: keys.map((k) => relative(rootKey, k).split(sep).join("/") || ".");
	const { program, spec } = trail[0].via;
	return new CompileError([
		new TypeCheckError(
			`import cycle not allowed: ${label.join(" imports ")}`,
			{ line: spec.line ?? spec._line, col: spec.col ?? spec._col ?? 1 },
			program._filename,
			program._source,
		),
	]);
}

// The graph of the local packages `rootPrograms` (the package in `rootKey`)
// imports, directly or not: `{ edges: Map<dir, Set<dir>> }`. Throws the
// CompileError of the first import cycle, before any package is checked. The
// root counts as a member, so a package that a dependency imports back is a
// cycle even when the root's own test files start it. A package reached
// through several paths is visited once.
function buildPackageGraph(rootKey, rootPrograms, options) {
	const edges = new Map();
	const names = new Map();
	const trail = [];
	const visit = (key, programs) => {
		const deps = new Set();
		edges.set(key, deps);
		names.set(key, programs[0]?.pkg?.name ?? basename(key));
		const frame = { key, via: null };
		trail.push(frame);
		for (const imp of localImports(programs, key)) {
			frame.via = imp;
			const at = trail.findIndex((f) => f.key === imp.dir);
			if (at >= 0)
				throw importCycleError(trail.slice(at), imp.dir, names, rootKey);
			deps.add(imp.dir);
			if (edges.has(imp.dir)) continue;
			const dep = parseDependency(imp.dir, options);
			if (dep) visit(imp.dir, dep);
		}
		trail.pop();
	};
	visit(rootKey, rootPrograms);
	return { edges };
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

	// The first compile of a build (the root) walks the local imports once;
	// every dependency it compiles inherits the graph.  `packageCompiles`, when
	// given, counts the compiles per package directory.
	options.packageGraph ??= buildPackageGraph(
		resolve(fromDir),
		programs,
		options,
	);
	if (options.packageCompiles) {
		const key = resolve(fromDir);
		options.packageCompiles.set(
			key,
			(options.packageCompiles.get(key) ?? 0) + 1,
		);
	}

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

	// Local packages share one flat JS module: a type name another package
	// already declared, or a JS built-in (`Map`), is renamed here
	// (`Pt` -> `Pt$$b`).
	const renamedTypes = mangleLocalTypes(
		programs,
		resolve(fromDir),
		pkgName,
		options.typeOwners,
		pkgTarget,
	);

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
		reachedTypes: checker.getReachedTypes(),
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

// Renames the programs' local types in place. They are this build's copies of
// the cached ASTs, so a later build starts from the unrenamed baseline.
function mangleLocalTypes(programs, pkgKey, pkgName, owners, pkgTarget) {
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
		{ target: pkgTarget, builtins: JS_BUILTIN_CLASSES },
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
	renameLocalTypes(programs, foreign);
	registerLocalTypeOwners(programs, pkgKey, owners);
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
