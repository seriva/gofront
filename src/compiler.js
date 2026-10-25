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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
	buildSourceMap,
	buildWasmSourceMap,
	CodeGen,
} from "./backend/js/index.js";
import { compileWasmModule, optimizeWasm } from "./backend/wasm/index.js";
import { log } from "./colors.js";
import { parseDts } from "./dts-parser.js";
import { Lexer } from "./lexer.js";
import { lower } from "./lower/index.js";
import { reachableStdlibDecls } from "./lower/reachability.js";
import { forEachChild } from "./lower/walk.js";
import { Parser } from "./parser/index.js";
import {
	isBuiltinPackage,
	isLocalPath,
	resolveAll,
	resolveGwDir,
	resolveStdlibSource,
} from "./resolver.js";
import { TemplLexer } from "./templ-lexer.js";
import { TemplParser } from "./templ-parser.js";
import { TypeCheckError, TypeChecker } from "./typechecker/index.js";
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
	ast._path = resolve(filePath);
	// compileFiles overwrites `target` with the resolved one; keep the directive.
	ast._declaredTarget = ast.target;
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

const WASM_MAP_URL = "app.wasm.map";

// Function-level `app.wasm.map` (sources relative to the output dir).
function buildWasmMap(info, outputDir) {
	if (!info || info.mappings.length === 0) return null;
	return buildWasmSourceMap(
		info.sources.map((f) => relative(outputDir, f)),
		info.mappings,
	);
}

// Shared tail of compileFiles / compileSingleFile: link `app.wasm`, run
// wasm-opt when requested and produce the wasm source map.
function finishWasm(options, merged, pkgTarget, outputDir) {
	const wantMap = Boolean(options.sourceMap && !options.isDependency);
	let { wasm, wat, sourceMapInfo } = linkIntoBundle(
		options,
		merged,
		pkgTarget,
		{
			sourceMappingURL: wantMap ? WASM_MAP_URL : null,
		},
	);
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
	return { wasm, wat, wasmOptInfo, wasmSourceMap };
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

function linkWasmUnits(
	units,
	{ emitWat = false, rootTarget = "js", sourceMappingURL = null } = {},
) {
	if (!units.some((u) => u.target === "wasm")) return null;
	checkLinkCollisions(units);

	const types = new Map();
	const bundledPackages = new Set();
	const programs = [];
	const stdlibPrograms = [];
	for (const u of units) {
		for (const b of u.bundledPackages) bundledPackages.add(b);
		const copies = u.programs.map((p) => cloneAstForWasm(p));
		programs.push(...copies);
		if (u.key.startsWith("stdlib:")) stdlibPrograms.push(...copies);
	}
	lowerStdlibRefs(programs);
	dequalifyBundledRefs(programs, bundledPackages);
	const keepType = pruneStdlibPrograms(programs, stdlibPrograms);
	for (const u of units)
		for (const [k, v] of u.types) if (keepType(v)) types.set(k, v);
	const checker = Object.assign(new TypeChecker(), {
		types,
		errors: [],
		err(msg, node) {
			const e = new TypeCheckError(
				msg,
				node,
				this._currentFile,
				this._currentSource,
			);
			this.errors.push(e);
			return e;
		},
	});
	const lowerRes = lower(programs, checker);
	return compileWasmModule(programs, checker, lowerRes, {
		boundary: true,
		bundledPackages,
		emitWat,
		callMain: rootTarget === "wasm",
		sourceMappingURL,
	});
}

// The WASM pipeline rewrites ASTs in place (package dequalification,
// monomorphisation, variadic desugaring).  Parsed ASTs are cached across
// builds and shared with JS codegen, so the link works on a structural copy;
// side tables (`_type`, …) are shared by reference.
function cloneAstForWasm(node, seen = new Map()) {
	if (!node || typeof node !== "object") return node;
	const prev = seen.get(node);
	if (prev) return prev;
	const copy = Array.isArray(node) ? [] : {};
	seen.set(node, copy);
	if (Array.isArray(node)) {
		for (const n of node) copy.push(cloneAstForWasm(n, seen));
		return copy;
	}
	for (const [k, v] of Object.entries(node)) {
		copy[k] = k.charCodeAt(0) === 95 ? v : cloneAstForWasm(v, seen);
	}
	return copy;
}

// Drops unreachable Go-source stdlib declarations from the link copy and
// returns a filter that drops their (mangled) named types.
function pruneStdlibPrograms(programs, stdlibPrograms) {
	if (stdlibPrograms.length === 0) return () => true;
	const std = new Set(stdlibPrograms);
	const reached = reachableStdlibDecls(
		programs.filter((p) => !std.has(p)),
		stdlibPrograms,
	);
	const types = new Set();
	for (const p of stdlibPrograms) {
		p.decls = p.decls.filter((d) => reached.has(d));
		for (const d of p.decls) if (d.kind === "TypeDecl") types.add(d.name);
	}
	return (t) => {
		const name = typeof t?.name === "string" ? t.name : "";
		return !name.includes("$$") || types.has(name.replace(/\[.*$/, ""));
	};
}

// The linked module is flat, so `util.Two` names the top-level `Two`.  Done on
// the link copy before monomorphisation, whose re-check of all programs has no
// package namespaces.  A local variable that shadows the package is typed and
// is left alone.
function isBundledSelector(node, bundled) {
	const base = node.expr;
	return (
		base?.kind === "Ident" &&
		bundled.has(base.name) &&
		(base._type == null || base._type.kind === "namespace")
	);
}

function dequalifyBundledRefs(node, bundled) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) dequalifyBundledRefs(n, bundled);
		return;
	}
	if (node.kind === "SelectorExpr" && isBundledSelector(node, bundled)) {
		node.kind = "Ident";
		node.name = node.field;
		delete node.expr;
		delete node.field;
	} else if (node.kind === "TypeName" || node.kind === "GenericTypeName") {
		const dot = node.name?.indexOf(".") ?? -1;
		if (dot > 0 && bundled.has(node.name.slice(0, dot)))
			node.name = node.name.slice(dot + 1);
	}
	forEachChild(node, (child) => dequalifyBundledRefs(child, bundled));
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
// facade into the merged bundle.  Returns `{ wasm, wat, sourceMapInfo }`
// (nulls when there is nothing to link).
function linkIntoBundle(options, merged, pkgTarget, { sourceMappingURL } = {}) {
	const none = { wasm: null, wat: null, sourceMapInfo: null };
	if (options.isDependency) return none;
	const linked = linkWasmUnits(options.wasmUnits, {
		emitWat: options.emitWat,
		rootTarget: pkgTarget,
		sourceMappingURL,
	});
	if (!linked) return none;
	spliceFacade(merged, linked.facade);
	return {
		wasm: linked.wasm,
		wat: linked.wat ?? null,
		sourceMapInfo: linked.sourceMapInfo ?? null,
	};
}

// ── Go-source stdlib ──────────────────────────────────────────
//
// Packages under runtime/stdlib/<path>/ are GoFront Go.  Each is type-checked
// and compiled once per build as a `both` package (strict numerics): its JS
// is bundled for js/both importers and its programs are linked into app.wasm
// for wasm/both importers, never through the boundary facade.  Top-level
// names are mangled to `Name$$path` so they cannot collide with user
// declarations in the flat JS bundle or the linked module.  A directory for an
// emitter-backed package (`errors`) is an overlay: its members join that
// namespace and unqualified references to emitter members become `errors.X`.

function stdlibSuffix(importPath) {
	return `$$${importPath.replaceAll("/", "$")}`;
}

function parseStdlibFiles(dir) {
	return gwFilesIn(dir).map((f) => {
		const source = readFileSync(f, "utf8");
		const filename = basename(f);
		const tokens = new Lexer(source, filename).tokenize();
		const ast = new Parser(tokens, filename, source).parse();
		ast._source = source;
		ast._path = resolve(f);
		ast.target = "both";
		return ast;
	});
}

// Top-level value and type names declared by the package.
function stdlibTopLevelNames(programs) {
	const values = new Set();
	const types = new Set();
	for (const p of programs) {
		for (const d of p.decls ?? []) {
			if (d.kind === "TypeDecl") types.add(d.name);
			else if (d.kind === "FuncDecl" && d.name !== "init") values.add(d.name);
			else if (d.kind === "VarDecl" || d.kind === "ConstDecl")
				for (const spec of d.decls ?? [])
					for (const n of spec.names ?? []) if (n !== "_") values.add(n);
		}
	}
	return { values, types };
}

// Renames the package's top-level declarations and every reference to them.
// `refs` holds the `file:line:col` of identifiers the first type-check
// resolved to package scope; type names are resolved by name (GoFront types
// are package-flat) except where a type parameter shadows them.
function mangleStdlibAst(programs, ctx) {
	for (const p of programs) {
		for (const d of p.decls ?? []) mangleDeclNames(d, ctx);
		mangleRefs(p.decls, p._filename, new Set(), ctx);
	}
}

function mangleDeclNames(d, { suffix, values }) {
	if (d.kind === "TypeDecl" || (d.kind === "FuncDecl" && values.has(d.name))) {
		d.name += suffix;
	} else if (d.kind === "VarDecl" || d.kind === "ConstDecl") {
		for (const spec of d.decls ?? [])
			spec.names = spec.names.map((n) => (values.has(n) ? n + suffix : n));
	}
}

function mangleRefs(node, file, tparams, ctx) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) mangleRefs(n, file, tparams, ctx);
		return;
	}
	const tp =
		node.typeParams?.length > 0
			? new Set([...tparams, ...node.typeParams.map((t) => t.name)])
			: tparams;
	switch (node.kind) {
		case "TypeName":
		case "GenericTypeName":
			mangleTypeRef(node, tp, ctx);
			break;
		case "CompositeLit":
			if (node.typeExpr?.kind === "Ident")
				mangleTypeRef(node.typeExpr, tp, ctx);
			break;
		case "InstantiationExpr": // `Stack[T]{}`, `Pair[K, V](x)`
		case "IndexExpr":
			if (node.expr?.kind === "Ident") mangleTypeRef(node.expr, tp, ctx);
			break;
		case "Ident":
			if (ctx.refs.has(`${file}:${node._line}:${node._col}`))
				mangleIdentRef(node, ctx);
			break;
	}
	forEachChild(node, (child) => mangleRefs(child, file, tp, ctx));
}

function mangleTypeRef(node, tparams, { suffix, types, overlay }) {
	if (types.has(node.name) && !tparams.has(node.name)) {
		node.name += suffix;
	} else if (overlay && node.name in overlay.members) {
		node.name = `${overlay.name}.${node.name}`;
	}
}

// A package-scope identifier: a package declaration gets the suffix; in an
// overlay, an emitter member (`New` in errors) becomes `errors.New`.
function mangleIdentRef(node, { suffix, values, types, overlay }) {
	if (values.has(node.name) || types.has(node.name)) {
		node.name += suffix;
	} else if (overlay && node.name in overlay.members) {
		const field = node.name;
		delete node.name;
		Object.assign(node, {
			kind: "SelectorExpr",
			expr: { kind: "Ident", name: overlay.name, _line: node._line },
			field,
		});
	}
}

function checkStdlibPrograms(programs, pkgName, options, overlay) {
	const checker = new TypeChecker();
	checker.target = "both";
	checker.pkgName = pkgName;
	checker.isStdlib = true;
	if (overlay) {
		for (const [name, t] of Object.entries(overlay.members)) {
			checker.globals.define(name, t);
			if (t.kind === "interface" || t.kind === "named" || t.kind === "struct") {
				checker.types.set(name, t);
			}
		}
	}
	resolveImports(
		programs,
		programs[0]._path,
		checker,
		new Map(),
		new Set(),
		[],
		new Set(),
		options,
	);
	return checker;
}

// Errors in stdlib source are compiler bugs; the importer reports them at its
// import (see reportStdlibLoadError), so only the message text is kept, never
// a location inside runtime/stdlib/.
function throwStdlibErrors(errors) {
	if (errors.length === 0) return;
	const detail = (e) =>
		e.message
			.split("\n")[0]
			.replace(/^Type error(?: in \S+)?(?: at line \d+:\d+)?:\s*/, "");
	throw new Error([...new Set(errors.map(detail))].join("; "));
}

// Pass 1: type-check the package as written and record which identifiers
// refer to package scope.  An overlay sees its emitter members unqualified.
function probeStdlibPackage(_importPath, dir, options, overlay) {
	const programs = parseStdlibFiles(dir);
	const pkgName = programs[0].pkg.name;
	const { values, types } = stdlibTopLevelNames(programs);
	for (const n of [...values, ...types])
		if (overlay && n in overlay.members)
			throw new Error(`overlay redeclares ${overlay.name}.${n}`);
	const probe = checkStdlibPrograms(programs, pkgName, options, overlay);
	probe._pkgRefs = new Set();
	throwStdlibErrors(probe.checkAll(programs));
	return { pkgName, values, types, refs: probe._pkgRefs };
}

// Exported members as seen by importers (original name -> type) and the
// original -> mangled name map; an overlay keeps the emitter members too.
function stdlibNamespace(checker, { pkgName, values, types, suffix }, overlay) {
	const members = overlay ? { ...overlay.members } : {};
	const mangle = new Map();
	for (const name of [...values, ...types]) {
		const t = checker.globals.symbols.get(name + suffix);
		if (!/^[A-Z]/.test(name) || t === undefined) continue;
		members[name] = t;
		mangle.set(name, name + suffix);
	}
	return {
		...(overlay ?? {}),
		kind: "namespace",
		name: pkgName,
		members,
		_gofront: !overlay,
		_target: "both",
		_mangle: mangle,
	};
}

// Mangled type names (needed by the backends) plus `pkg.T` for exported ones.
function stdlibExportedTypes(checker, { pkgName, suffix }) {
	const out = new Map();
	for (const [k, t] of checker.types) {
		const at = k.indexOf("$$");
		if (at < 0) continue;
		out.set(k, t);
		const orig = k.slice(0, at);
		if (k === orig + suffix && /^[A-Z]/.test(orig))
			out.set(`${pkgName}.${orig}`, t);
	}
	return out;
}

// Loads (once per build) and compiles the Go-source package at `dir`.  A
// failure is cached too, so every importer reports it.
function loadStdlibPackage(importPath, dir, options) {
	const cache = options.stdlibCache;
	const cached = cache.get(importPath);
	if (cached === null)
		throw new Error(`import cycle in Go-source stdlib: ${importPath}`);
	if (cached instanceof Error) throw cached;
	if (cached) return cached;
	cache.set(importPath, null);
	try {
		const pkg = buildStdlibPackage(importPath, dir, options);
		cache.set(importPath, pkg);
		return pkg;
	} catch (e) {
		cache.set(importPath, e);
		throw e;
	}
}

function buildStdlibPackage(importPath, dir, options) {
	const cache = options.stdlibCache;
	const overlay = isBuiltinPackage(importPath)
		? new TypeChecker().globals.lookup(importPath.split("/").at(-1))
		: null;
	const info = {
		...probeStdlibPackage(importPath, dir, options, overlay),
		suffix: stdlibSuffix(importPath),
	};

	// Pass 2: mangle a fresh parse and check it again.
	const programs = parseStdlibFiles(dir);
	mangleStdlibAst(programs, { ...info, overlay });
	const checker = checkStdlibPrograms(programs, info.pkgName, options, null);
	throwStdlibErrors(checker.checkAll(programs));
	lowerStdlibRefs(programs);

	const pkg = {
		importPath,
		checker,
		pkgName: info.pkgName,
		overlay,
		namespace: stdlibNamespace(checker, info, overlay),
		exportedTypes: stdlibExportedTypes(checker, info),
		deps: programs
			.flatMap((p) => p.imports.flatMap((imp) => imp.imports))
			.map(({ path }) => cache.get(path))
			.filter(Boolean),
		unit: {
			key: `stdlib:${importPath}`,
			pkgName: info.pkgName,
			target: "both",
			programs,
			types: checker.types,
			bundledPackages: new Set(),
		},
	};
	return pkg;
}

// Turns `cmp.Compare` / `cmp.Ordered` references (marked `_stdName` by the
// checker) into plain identifiers with the mangled name, so WASM
// monomorphisation sees ordinary top-level references.  Only for ASTs that
// are not cached: a stdlib package's own parse and the WASM link copy (user
// ASTs are re-checked on the next build; the JS backend reads `_stdName`).
function lowerStdlibRefs(node) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) lowerStdlibRefs(n);
		return;
	}
	if (node._stdName) {
		if (node.kind === "SelectorExpr") {
			delete node.expr;
			delete node.field;
			node.kind = "Ident";
		}
		node.name = node._stdName;
		delete node._stdName;
	}
	forEachChild(node, lowerStdlibRefs);
}

// A Go-source package's JS is generated at the root compile, once every
// JS-emitted user program is known, so only reachable declarations are
// emitted (see lower/reachability.js).  Importers leave a marker line.
const STDLIB_MARKER_RE = /^\/\*__GOFRONT_STDLIB:([^*]*)\*\/$/;

// Prints non-fatal diagnostics (e.g. JS Number precision of a constant).
function logWarnings(warnings) {
	for (const w of warnings) log.warn(w);
}

function stdlibMarker(importPath) {
	return `/*__GOFRONT_STDLIB:${importPath}*/`;
}

function stdlibJs(pkg, reached) {
	const programs = pkg.unit.programs.map((p) => ({
		...p,
		decls: p.decls.filter((d) => reached.has(d)),
	}));
	if (programs.every((p) => p.decls.length === 0)) return "";
	return new CodeGen(pkg.checker, new Map(), new Set(), {
		target: "both",
		strict: true,
	}).generateAll(programs, { isTest: false });
}

// The API a wasm package exposes to JS through the facade: exported func and
// method signatures and exported type declarations.
function wasmExportedSignatures(units) {
	const out = [];
	for (const u of units) {
		if (u.target !== "wasm" || u.key.startsWith("stdlib:")) continue;
		for (const d of u.programs.flatMap((p) => p.decls ?? [])) {
			if (!/^[A-Z]/.test(d.name ?? "")) continue;
			if (d.kind === "TypeDecl") out.push(d.type);
			else if (d.kind === "FuncDecl" || d.kind === "MethodDecl")
				out.push(d.params, d.returnType);
		}
	}
	return out;
}

// Replaces each marker with the package's reachable code (no line at all when
// nothing is reachable) and shifts the source-map lines that follow.
function spliceStdlibJs(merged, options) {
	const lines = merged.js.split("\n");
	const pkgs = lines
		.map((l) => l.match(STDLIB_MARKER_RE)?.[1])
		.filter(Boolean)
		.map((path) => options.stdlibCache.get(path));
	if (pkgs.length === 0) return;
	const reached = reachableStdlibDecls(
		[options.jsRootPrograms, wasmExportedSignatures(options.wasmUnits)],
		pkgs.flatMap((pkg) => pkg.unit.programs),
	);
	const out = [];
	for (const line of lines) {
		const path = line.match(STDLIB_MARKER_RE)?.[1];
		if (!path) {
			out.push(line);
			continue;
		}
		const js = stdlibJs(options.stdlibCache.get(path), reached);
		const code = js === "" ? [] : js.split("\n");
		const delta = code.length - 1;
		for (const m of merged.mappings)
			if (m.genLine > out.length) m.genLine += delta;
		out.push(...code);
	}
	merged.js = out.join("\n");
}

// Records a package's JS-emitted programs as reachability roots; the root
// compile then splices in the stdlib code they reach.
function finishStdlibJs(merged, options, programs, emitTarget) {
	if (emitTarget !== "wasm") options.jsRootPrograms.push(...programs);
	if (!options.isDependency) spliceStdlibJs(merged, options);
}

// Adds a loaded package (and, first, its Go-source dependencies) to the
// importer's output: JS for js/both importers, a link unit for wasm/both.
function emitStdlibPackage(
	pkg,
	importerTarget,
	preambles,
	bundledDirs,
	options,
) {
	for (const dep of pkg.deps)
		emitStdlibPackage(dep, importerTarget, preambles, bundledDirs, options);
	// Every importer leaves a JS marker: the facade of a wasm package may
	// expose a stdlib type; unreachable code splices to nothing.
	const key = `${pkg.unit.key}:js`;
	if (!bundledDirs.has(key)) {
		bundledDirs.add(key);
		preambles.push(stdlibMarker(pkg.importPath));
	}
	if (importerTarget !== "js") registerWasmUnit(options, pkg.unit);
}

function importNode({ _line, _col, line, col }) {
	return { _line, _col, line: line ?? _line, col: col ?? _col ?? 1 };
}

// Reports `msg` at an import spec of program `p`.
function errAtImport(checker, p, spec, msg, hint = null) {
	const saved = [checker._currentFile, checker._currentSource];
	checker._currentFile = p._filename ?? null;
	checker._currentSource = p._source ?? null;
	checker.err(msg, importNode(spec), hint);
	[checker._currentFile, checker._currentSource] = saved;
}

// Defines the import's namespace (and `pkg.T` type names) in the importer.
function bindStdlibImport(checker, p, spec, pkg) {
	const { path, alias } = spec;
	if (alias === "_") return;
	if (alias === ".") {
		errAtImport(checker, p, spec, `dot-import of '${path}' is not supported`);
		return;
	}
	const name = alias ?? pkg.pkgName;
	// Emitter-backed members are emitted by package name, so an overlaid
	// package cannot be renamed (aliases of emitter packages never worked).
	if (pkg.overlay && name !== pkg.pkgName) {
		errAtImport(
			checker,
			p,
			spec,
			`import alias for '${path}' is not supported`,
		);
		return;
	}
	checker.globals.define(name, { ...pkg.namespace, name });
	for (const [k, t] of pkg.exportedTypes) {
		const dot = k.indexOf(".");
		checker.types.set(dot < 0 ? k : `${name}${k.slice(dot)}`, t);
	}
	if (!pkg.overlay)
		checker.trackImport(name, importNode(spec), p._filename, p._source);
}

function importStdlibPackages(
	programs,
	checker,
	preambles,
	bundledDirs,
	options,
) {
	for (const p of programs) {
		for (const spec of p.imports.flatMap((imp) => imp.imports)) {
			if (spec.path.startsWith("js:") || isLocalPath(spec.path)) continue;
			const dir = resolveStdlibSource(spec.path, options.stdlibRoot);
			if (!dir) continue;
			let pkg;
			try {
				pkg = loadStdlibPackage(spec.path, dir, options);
			} catch (e) {
				const msg = `internal stdlib error in ${spec.path}; please report`;
				errAtImport(checker, p, spec, msg, e.message);
				continue;
			}
			emitStdlibPackage(pkg, checker.target, preambles, bundledDirs, options);
			bindStdlibImport(checker, p, spec, pkg);
		}
	}
}

// ── Import resolution ─────────────────────────────────────────
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
					} else if (path === "gofront/shared" && pkgTarget === "both") {
						checker.err(
							"'gofront/shared' requires a wasm-only package (//gofront:target wasm): a both package has no linear memory on the JS side",
							impNode,
						);
					} else if (
						!isLocalPath(path) &&
						(isBuiltinPackage(path) ||
							!resolveStdlibSource(path, options.stdlibRoot))
					) {
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
	const resolved = resolveAll(
		allImportsNoSideEffect,
		fromFile,
		parseDts,
		options.stdlibRoot,
	);
	for (const [path, info] of resolved) {
		if (!info) continue;
		checker.addDefinitions(info.types, info.values);
		jsImports.set(path, [...info.values.keys()]);
	}

	importStdlibPackages(programs, checker, preambles, bundledDirs, options);

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
					checker.addDefinitions(dep.exportedTypes, dep.exportedSymbols, {
						external: false,
						consts: dep.exportedConsts,
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
		throw new Error(
			`gofront.json: invalid target '${t}' for package '${key}' (expected js, wasm or both)`,
		);
	return t;
}

export function compileSingleFile(inputPath, options = {}) {
	const {
		sourceMap = false,
		outputFile = null,
		dumpTokens = false,
		dumpAst = false,
	} = options;
	options = {
		...options,
		wasmUnits: options.wasmUnits ?? [],
		stdlibCache: options.stdlibCache ?? new Map(),
		jsRootPrograms: options.jsRootPrograms ?? [],
	};

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
	if (dumpAst) return { ast };

	const outputDir =
		options.outputDir ??
		(outputFile ? dirname(resolve(outputFile)) : resolve("."));

	const checker = new TypeChecker();
	const jsImports = new Map();
	const bundledPackages = new Set();
	const preambles = [];

	const pkgTarget = resolvePackageTarget(
		ast.target ?? options.target ?? "js",
		dirname(resolve(inputPath)),
		options,
	);
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
	for (const w of checker.warnings) log.warn(w);

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
	logWarnings(cg.warnings);

	const mainChunk = {
		js: mainJs,
		sourceFiles: [resolve(inputPath)],
		sourcesContent: [source],
		mappings: pkgTarget === "wasm" ? [] : cg.getMappings(),
	};

	const merged = mergeCompilationChunks([...preambles, mainChunk]);
	finishStdlibJs(merged, options, [ast], pkgTarget);
	const { wasm, wat, wasmOptInfo, wasmSourceMap } = finishWasm(
		{ ...options, sourceMap },
		merged,
		pkgTarget,
		outputDir,
	);

	if (sourceMap && !options.isDependency) {
		attachSourceMap(merged, outputDir);
	}

	return {
		js: merged.js,
		css: cg.getCss(),
		target: pkgTarget,
		wasm,
		wat,
		wasmOptInfo,
		wasmSourceMap,
	};
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
		throw new Error(
			`Conflicting //gofront:target directives in package '${pkgName}': ${list}`,
		);
	}
	const pkgTarget = resolvePackageTarget(
		declaredTargets.size === 1
			? declaredTargets.keys().next().value
			: (options.target ?? "js"),
		fromDir,
		options,
	);
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
	for (const w of checker.warnings) log.warn(w);

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
	logWarnings(codegen.warnings);

	const mainChunk = {
		js: mainJs,
		sourceFiles: programs.map((p) => p._path),
		sourcesContent: programs.map((p) => p._source),
		mappings: emitTarget === "wasm" ? [] : codegen.getMappings(),
	};

	const merged = mergeCompilationChunks([...preambles, mainChunk]);
	finishStdlibJs(merged, options, programs, emitTarget);
	const { wasm, wat, wasmOptInfo, wasmSourceMap } = finishWasm(
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
		js: merged.js,
		css: allCss,
		wasm,
		wat,
		wasmOptInfo,
		wasmSourceMap,
		programs,
		exportedSymbols: checker.getExportedSymbols(),
		exportedTypes: checker.getExportedTypes(),
		exportedConsts: checker.getExportedConsts(),
		sourceFiles: merged.sourceFiles,
		sourcesContent: merged.sourcesContent,
		mappings: merged.mappings,
	};
}
