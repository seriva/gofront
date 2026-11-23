// Go-source stdlib pipeline: packages under stdlib/<path>/ are parsed, checked
// twice (probe, then mangled), linked into app.wasm and spliced into the JS
// bundle.  compiler.js owns import resolution, so the functions that need it
// (and the parser/checker helpers it also exports) arrive through an injected
// `deps` argument: `{ gwFilesIn, resolveImports, TypeChecker }`.  Importing
// compiler.js from here would create a cycle.

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CodeGen, helperPrelude } from "../backend/js/index.js";
import { Lexer } from "../lexer/lexer.js";
import { generateErrorsAs } from "../lower/errors-as.js";
import { generateFmtFormatters } from "../lower/fmt-formatters.js";
import { restoredTypeName } from "../lower/gen-types.js";
import { generateJsonCodecs } from "../lower/json-codecs.js";
import { BuildReach, checkedDecl, StdlibReach } from "../lower/reachability.js";
import { cloneAst, forEachChild } from "../lower/walk.js";
import { Parser } from "../parser/index.js";
import {
	declarationsCurrent,
	isLocalPath,
	resolveStdlibSource,
} from "../resolver.js";
import {
	filesSignature,
	freezeStdlibPackage,
	freezesStoredUnits,
} from "./package-cache.js";
import { spliceUserChunk, userMarkerKey } from "./user-js.js";
import { lowerStdlibRefs, registerWasmUnit } from "./wasm.js";

export {
	declaredTypeNames,
	mangleCollidingTypes,
	registerLocalTypeOwners,
	renameLocalTypes,
	withOriginalTypeNames,
} from "./type-names.js";

// ── Go-source stdlib ──────────────────────────────────────────
//
// Packages under stdlib/<path>/ are GoFront Go.  Each is type-checked
// and compiled once per build as a `both` package (strict numerics): its JS
// is bundled for js/both importers and its programs are linked into app.wasm
// for wasm/both importers, never through the boundary facade.  Top-level
// names are mangled to `Name$$path` so they cannot collide with user
// declarations in the flat JS bundle or the linked module.

function stdlibSuffix(importPath) {
	return `$$${importPath.replaceAll("/", "$")}`;
}

// Each file keeps its own `//gofront:target` (default `both`).  A package
// with `js` files is compiled whole for `js` importers (the `js` variant) and
// without those files for `wasm` and `both` importers (the `shared` variant).
function parseStdlibFiles(dir, deps, variant = "js", target = "both") {
	return deps
		.gwFilesIn(dir)
		.map((f) => {
			const source = readFileSync(f, "utf8");
			const filename = basename(f);
			const tokens = new Lexer(source, filename).tokenize();
			const ast = new Parser(tokens, filename, source).parse();
			ast._source = source;
			ast._path = resolve(f);
			ast._stdlib = true;
			ast._fileTarget = tokens.target ?? "both";
			return ast;
		})
		.filter((ast) => variant === "js" || ast._fileTarget !== "js")
		.map((ast) => Object.assign(ast, { target }));
}

// Targets of the package's files, read without parsing.  The answer is kept
// until a file of the package changes.
const targetsMemo = new Map();

function stdlibFileTargets(dir, deps) {
	const files = deps.gwFilesIn(dir);
	const sig = filesSignature(files);
	const memo = targetsMemo.get(dir);
	if (memo?.sig === sig) return memo.targets;
	const targets = files.map((f) => {
		const m = /^\/\/gofront:target\s+(\S+)/m.exec(readFileSync(f, "utf8"));
		return m?.[1] ?? "both";
	});
	targetsMemo.set(dir, { sig, targets });
	return targets;
}

// Exported names declared by the `js` files (what a `wasm` or `both` importer
// cannot use).
function stdlibJsOnlyNames(dir, deps) {
	const programs = parseStdlibFiles(dir, deps).filter(
		(p) => p._fileTarget === "js",
	);
	const { values, types } = stdlibTopLevelNames(programs);
	return new Set([...values, ...types].filter((n) => /^[A-Z]/.test(n)));
}

// Whether every file of the package is `js`-only.
export function stdlibIsJsOnly(dir, deps) {
	const targets = stdlibFileTargets(dir, deps);
	return targets.length > 0 && targets.every((t) => t === "js");
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
// With `lazy`, function and method bodies are left alone: they are mangled
// by `mangleBody` once a lazily checked body is first reached.
export function mangleStdlibAst(programs, ctx, { lazy = false } = {}) {
	for (const p of programs) {
		for (const d of p.decls ?? []) mangleDeclNames(d, ctx);
		for (const d of p.decls ?? []) {
			const deferred =
				lazy && (d.kind === "FuncDecl" || d.kind === "MethodDecl");
			const body = d.body;
			if (deferred) d.body = null;
			mangleRefs(d, p._filename, new Set(), ctx);
			if (deferred) d.body = body;
		}
	}
}

function mangleBody(decl, file, ctx) {
	const tparams = new Set((decl.typeParams ?? []).map((t) => t.name));
	mangleRefs(decl.body, file, tparams, ctx);
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
		case "CallExpr":
			if (
				(node.func?.name === "new" || node.func?.name === "make") &&
				node.args?.[0]?.kind === "Ident"
			) {
				mangleTypeRef(node.args[0], tp, ctx);
			}
			break;
		case "Ident":
			if (ctx.refs.has(`${file}:${node._line}:${node._col}`))
				mangleIdentRef(node, ctx);
			break;
	}
	forEachChild(node, (child) => mangleRefs(child, file, tp, ctx));
}

function mangleTypeRef(node, tparams, { suffix, types }) {
	if (types.has(node.name) && !tparams.has(node.name)) {
		node.name += suffix;
	}
}

// A package-scope identifier: a package declaration gets the suffix.
function mangleIdentRef(node, { suffix, values, types }) {
	if (values.has(node.name) || types.has(node.name)) {
		node.name += suffix;
	}
}

function checkStdlibPrograms(programs, pkgName, options, deps, target) {
	const checker = new deps.TypeChecker();
	checker.target = target;
	checker.pkgName = pkgName;
	checker.isStdlib = true;
	checker.lazyBodies = true;
	// The package's own imports are not the importer's.
	deps.resolveImports(
		programs,
		programs[0]._path,
		checker,
		new Map(),
		new Set(),
		[],
		new Set(),
		{ ...options, importTokens: null },
	);
	return checker;
}

// Errors in stdlib source are compiler bugs; the importer reports them at its
// import (see reportStdlibLoadError), so only the message text is kept, never
// a location inside stdlib/.
function stdlibErrorText(errors) {
	const detail = (e) =>
		e.message
			.split("\n")[0]
			.replace(/^Type error(?: in \S+)?(?: at line \d+:\d+)?:\s*/, "");
	return [...new Set(errors.map(detail))].join("; ");
}

function throwStdlibErrors(errors) {
	if (errors.length === 0) return;
	throw new Error(stdlibErrorText(errors));
}

// Pass 1: type-check the package as written and record which identifiers
// refer to package scope.
function probeStdlibPackage(_importPath, dir, options, deps, v) {
	const programs = parseStdlibFiles(dir, deps, v.variant, v.target);
	const pkgName = programs[0].pkg.name;
	const { values, types } = stdlibTopLevelNames(programs);
	const probe = checkStdlibPrograms(programs, pkgName, options, deps, v.target);
	probe._pkgRefs = new Set();
	throwStdlibErrors(probe.checkAll(programs));
	return {
		pkgName,
		values,
		types,
		refs: probe._pkgRefs,
		probe,
		probePrograms: programs,
	};
}

// Function and method bodies are checked when first reached (see
// `StdlibReach`), in both passes: the probe records which identifiers in the
// body name package scope, the body is mangled with them, and the mangled
// body is checked.  `decl._ensure()` does all three once and returns the
// error text, or null.
//
// The stored declarations stay as the build left them (a later build may
// freeze them): the passes run on copies, and `decl._checked()` returns the
// checked copy (the declaration itself until it has been checked).  A copy
// carries no hooks of its own, so copies of it (a link copy, the JS emitter's
// input) are plain finished ASTs.
function installLazyBodies(info, programs, checker) {
	const { probe, probePrograms } = info;
	programs.forEach((p, pi) => {
		p.decls.forEach((decl, di) => {
			if (decl.kind !== "FuncDecl" && decl.kind !== "MethodDecl") return;
			const probeDecl = probePrograms[pi].decls[di];
			let result;
			let checked = null;
			decl._checked = () => checked ?? decl;
			decl._ensure = () => {
				if (result !== undefined) return result;
				result = null; // a body that reaches itself is in progress
				checked = cloneAst(decl);
				delete checked._ensure;
				delete checked._checked;
				const probed = cloneAst(probeDecl);
				const before = [probe.errors.length, checker.errors.length];
				probe.checkBody(probed, probeDecl);
				if (probe.errors.length === before[0]) {
					mangleBody(checked, p._filename, info);
					checker.checkBody(checked, decl);
					lowerStdlibRefs(checked);
				}
				const errors = [
					...probe.errors.slice(before[0]),
					...checker.errors.slice(before[1]),
				];
				if (errors.length > 0) result = stdlibErrorText(errors);
				return result;
			};
		});
	});
}

// Exported members as seen by importers (original name -> type) and the
// original -> mangled name map.
function stdlibNamespace(checker, { pkgName, values, types, suffix }, jsOnly) {
	const members = {};
	const mangle = new Map();
	const consts = new Map();
	const kinds = new Map();
	for (const name of [...values, ...types]) {
		const obj = checker.globals.object(name + suffix);
		if (!/^[A-Z]/.test(name) || obj?.type === undefined) continue;
		members[name] = obj.type;
		kinds.set(name, obj.kind);
		mangle.set(name, name + suffix);
		// An exported constant's folded value, so importers fold `pkg.Name`.
		if (obj.kind === "const") {
			const v = checker.constValueOf(name + suffix);
			if (v) consts.set(name, v);
		}
	}
	return {
		kind: "namespace",
		name: pkgName,
		members,
		_gofront: true,
		_target: "both",
		_jsOnly: jsOnly,
		_mangle: mangle,
		_consts: consts,
		_kinds: kinds,
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

// The compilation a package gets for an importer: `js` importers see every
// file, `wasm` and `both` importers only the files for both targets (cached
// as `<path>#shared` when that differs).  Returns { key, variant, target }.
function stdlibVariant(importPath, dir, importerTarget, deps) {
	const hasJs = stdlibFileTargets(dir, deps).includes("js");
	importerTarget ??= "js";
	if (!hasJs) return { key: importPath, variant: "js", target: "both" };
	if (importerTarget === "js")
		return { key: importPath, variant: "js", target: "js" };
	return { key: `${importPath}#shared`, variant: "shared", target: "both" };
}

// Whether the stored package still matches its sources and the packages it was
// built against.  `checked` holds the keys already vouched for in this build.
function stdlibCurrent(pkg, table, deps, checked) {
	if (checked.has(pkg.key)) return true;
	const current =
		pkg.sig === filesSignature(deps.gwFilesIn(pkg.dir)) &&
		declarationsCurrent([...(pkg.checker.declarationStamps ?? [])]) &&
		pkg.deps.every(
			(d) => table.get(d.key) === d && stdlibCurrent(d, table, deps, checked),
		);
	if (current) checked.add(pkg.key);
	return current;
}

let stdlibIds = 0;

// Loads (once per build) and compiles the Go-source package at `dir`.  A
// failure is cached too, so every importer reports it.  With a package cache
// a stored package outlives the build: it is reused while its sources are
// unchanged, and a failure is never carried into another build.
function loadStdlibPackage(
	importPath,
	dir,
	options,
	deps,
	importerTarget = "js",
) {
	const v = stdlibVariant(importPath, dir, importerTarget, deps);
	const cache = options.stdlibCache;
	const stats = options.cacheStats;
	const checked = options.stdlibChecked;
	let cached = cache.get(v.key);
	if (cached && options.packageCache && !checked.has(v.key)) {
		if (
			cached instanceof Error ||
			!stdlibCurrent(cached, cache, deps, checked)
		) {
			cache.delete(v.key);
			cached = undefined;
		} else checked.add(v.key);
	}
	if (cached === null)
		throw new Error(`import cycle in Go-source stdlib: ${importPath}`);
	if (cached instanceof Error) throw cached;
	if (cached) {
		if (stats) stats.stdlibHits++;
		return cached;
	}
	if (stats) stats.stdlibMisses++;
	cache.set(v.key, null);
	try {
		const pkg = buildStdlibPackage(importPath, dir, options, deps, v);
		if (options.packageCache && freezesStoredUnits()) freezeStdlibPackage(pkg);
		cache.set(v.key, pkg);
		checked?.add(v.key);
		return pkg;
	} catch (e) {
		cache.set(v.key, e);
		checked?.add(v.key);
		throw e;
	}
}

function buildStdlibPackage(importPath, dir, options, deps, v) {
	const cache = options.stdlibCache;
	const info = {
		...probeStdlibPackage(importPath, dir, options, deps, v),
		suffix: stdlibSuffix(importPath),
	};

	// Pass 2: mangle a fresh parse and check it again.
	const programs = parseStdlibFiles(dir, deps, v.variant, v.target);
	mangleStdlibAst(programs, info, { lazy: true });
	const checker = checkStdlibPrograms(
		programs,
		info.pkgName,
		options,
		deps,
		v.target,
	);
	throwStdlibErrors(checker.checkAll(programs));
	lowerStdlibRefs(programs);
	installLazyBodies(info, programs, checker);

	// A user reference to a member checks the bodies it reaches, so a type
	// error in the standard library surfaces at the call.  Failures from other
	// packages' bodies surface when the output is assembled.
	const reach = new StdlibReach(programs);
	const jsOnly =
		v.variant === "shared" ? stdlibJsOnlyNames(dir, deps) : new Set();
	const namespace = stdlibNamespace(checker, info, jsOnly);
	namespace._path = importPath;
	namespace._reach = (name) => {
		const seen = reach.failures.length;
		reach.add([{ kind: "Ident", name }]);
		return reach.failures[seen] ?? null;
	};

	const pkg = {
		importPath,
		key: v.key,
		id: ++stdlibIds,
		dir,
		sig: filesSignature(deps.gwFilesIn(dir)),
		checker,
		pkgName: info.pkgName,
		namespace,
		exportedTypes: stdlibExportedTypes(checker, info),
		jsMemo: new Map(),
		deps: programs
			.flatMap((p) => p.imports.flatMap((imp) => imp.imports))
			.map(({ path }) =>
				v.variant === "shared"
					? (cache.get(`${path}#shared`) ?? cache.get(path))
					: cache.get(path),
			)
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

// A Go-source package's JS is generated at the root compile, once every
// JS-emitted user program is known, so only reachable declarations are
// emitted (see lower/reachability.js).  Importers leave a marker line.
const STDLIB_MARKER_RE = /^\/\*__GOFRONT_STDLIB:([^*]*)\*\/$/;

function stdlibMarker(key) {
	return `/*__GOFRONT_STDLIB:${key}*/`;
}

// The package key a marker line names, else undefined.
function markerKey(line) {
	return line.startsWith("/*__GOFRONT_STDLIB:")
		? line.match(STDLIB_MARKER_RE)?.[1]
		: undefined;
}

// The package's emitted JS for a reached set, memoized per package by the
// reached declarations and `natives`.  Stored declarations are frozen-safe:
// code generation rewrites its input, so it gets a copy of the checked
// declarations.  `stats` counts the memo's hits and misses when given.  The
// result is `{ js, helpers }`: the runtime helpers the code needs are left to
// the root compile (see `helperPrelude`).
function stdlibJs(pkg, reached, natives, stats) {
	const ids = [];
	pkg.unit.programs.forEach((p, pi) => {
		p.decls.forEach((d, di) => {
			if (reached.has(d)) ids.push(`${pi}.${di}`);
		});
	});
	if (ids.length === 0) return NO_JS;
	const key = `${natives !== false}|${ids.join(",")}`;
	const hit = pkg.jsMemo.get(key);
	if (hit !== undefined) {
		if (stats) stats.stdlibJsHits = (stats.stdlibJsHits ?? 0) + 1;
		return hit;
	}
	if (stats) stats.stdlibJsMisses = (stats.stdlibJsMisses ?? 0) + 1;
	const programs = cloneAst(
		pkg.unit.programs.map((p) => ({
			...p,
			decls: p.decls.filter((d) => reached.has(d)).map(checkedDecl),
		})),
	);
	const codegen = new CodeGen(pkg.checker, new Map(), new Set(), {
		target: pkg.checker.target,
		strict: true,
		natives,
		deferHelpers: true,
	});
	const js = codegen.generateAll(programs, { isTest: false });
	const out = { js, helpers: codegen.helperNames() };
	pkg.jsMemo.set(key, out);
	return out;
}

const NO_JS = { js: "", helpers: [] };

// Replaces each marker with the package's reachable code (no line at all when
// nothing is reachable) and shifts the source-map lines that follow.  The
// markers of local packages and of Go-source stdlib packages are replaced in
// one pass, once the closure over all of them is known.
function spliceStdlibJs(merged, options) {
	const lines = merged.js.split("\n");
	const pkgs = lines
		.map(markerKey)
		.filter(Boolean)
		.map((key) => options.stdlibCache.get(key));
	const users = new Map(options.userUnits.map((u) => [u.key, u]));
	if (pkgs.length === 0 && !lines.some(userMarkerKey)) return;
	// The whole package carries everything its shared variant has.
	const keys = new Set(pkgs.map((pkg) => pkg.key));
	const emitted = (pkg) =>
		pkg.key.endsWith("#shared") ? !keys.has(pkg.importPath) : true;
	const reach = reachOfBuild(
		options,
		pkgs.filter(emitted).flatMap((pkg) => pkg.unit.programs),
	);
	const css = [];
	const out = [];
	const helpers = new Set();
	const spliced = new Set();
	const place = (code, mappings = []) => {
		const delta = code.length - 1;
		for (const m of merged.mappings)
			if (m.genLine > out.length) m.genLine += delta;
		for (const m of mappings)
			merged.mappings.push({ ...m, genLine: m.genLine + out.length });
		out.push(...code);
	};
	for (const line of lines) {
		const path = markerKey(line);
		const userKey = userMarkerKey(line);
		if (!path && userKey === undefined) {
			out.push(line);
			continue;
		}
		if (spliced.has(path ?? userKey)) continue;
		spliced.add(path ?? userKey);
		if (path) {
			const pkg = options.stdlibCache.get(path);
			const chunk = emitted(pkg)
				? stdlibJs(pkg, reach.reached, options.natives, options.cacheStats)
				: NO_JS;
			for (const h of chunk.helpers) helpers.add(h);
			place(chunk.js === "" ? [] : chunk.js.split("\n"));
			continue;
		}
		const chunk = spliceUserChunk(users.get(userKey), reach, merged, css);
		for (const h of chunk.helpers) helpers.add(h);
		if (userKey === options.rootKey) merged.rootWarnings = chunk.warnings;
		place(chunk.lines, chunk.mappings);
	}
	// The runtime helpers every chunk needs, defined once ahead of them all.
	const prelude = helperPrelude(helpers);
	for (const m of merged.mappings) m.genLine += prelude.length;
	merged.js = [...prelude, ...out].join("\n");
	merged.css = css.join("\n\n");
}

// The closure over the build's local packages and the Go-source stdlib
// packages `stdlibPrograms`; a reached body that fails its (lazy) check throws.
// `options.userUnits` lists the local packages compiled so far; `prune: false`
// roots all of their code instead of what the entry package reaches.
export function reachOfBuild(options, stdlibPrograms, { prune = true } = {}) {
	const reach = new BuildReach(stdlibPrograms, options.userUnits, {
		entry: options.rootKey,
		isTest: options.isTest ?? false,
		roots: options.jsRoots,
		prune,
	});
	if (reach.failures.length > 0) throw new Error(reach.failures[0]);
	return reach;
}

// Records a package as part of the build; the root compile then splices in
// the stdlib code the local packages reach.
export function finishStdlibJs(merged, options, unit) {
	options.userUnits.push({
		key: unit.link.key,
		pkgName: unit.link.pkgName,
		programs: unit.rootPrograms,
		emitTarget: unit.emitTarget,
		emitted: unit.emitTarget !== "wasm",
		emitter: unit.emitter,
	});
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
	const key = `${pkg.key}:js`;
	if (!bundledDirs.has(key)) {
		bundledDirs.add(key);
		preambles.push(stdlibMarker(pkg.key));
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
	const ns = { ...pkg.namespace, name };
	const file = p._filename ?? null;
	checker._fileScope(file).definePackage(name, ns);
	for (const [k, t] of pkg.exportedTypes) {
		const dot = k.indexOf(".");
		if (dot < 0) checker.types.set(k, t);
		else checker._bindImportedType(file, `${name}${k.slice(dot)}`, t);
	}
	if (!spec._implicit)
		checker.trackImport(name, importNode(spec), p._filename, p._source);
}

// The generators behind the package's `gofront_gen.go`: each scans the
// checked programs for its call sites, marks them with `_genEntry` and returns
// null (no sites) or { body, imports, diagnostics }.
const GENERATORS = [
	generateJsonCodecs,
	generateErrorsAs,
	generateFmtFormatters,
];

// The generated Go names the package's own `Name$$pkg` types with a lexable
// stand-in (see `renamedStandIn`); the parsed references get the declared
// name back.
function restoreRenamedTypes(node) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) return node.forEach(restoreRenamedTypes);
	if (typeof node.name === "string" && RENAMEABLE.has(node.kind))
		node.name = restoredTypeName(node.name);
	forEachChild(node, restoreRenamedTypes);
}

const RENAMEABLE = new Set(["TypeName", "GenericTypeName", "Ident"]);

// Generates, imports and checks the package's generated Go (json codecs,
// `errors.As` functions) as one more file.  Returns the generated programs:
// none for a package with errors or one with no generated call sites.
export function checkGeneratedGo(
	programs,
	checker,
	preambles,
	options,
	deps,
	generators = GENERATORS,
) {
	if (checker.errors.length > 0) return [];
	const parts = generators
		.map((gen) => gen(programs, checker, checker.pkgName, options))
		.filter(Boolean);
	if (parts.length === 0) return [];
	let failed = false;
	for (const { diagnostics } of parts)
		for (const { program, node, message, hint } of diagnostics) {
			failed = true;
			checker._setCurrentFile(program);
			checker.recordBlocker("unsupported stdlib member", message);
			checker.err(message, node, hint);
		}
	if (failed) return [];
	// An import is a path or { path, alias }.
	const specs = new Map();
	for (const imp of parts.flatMap((p) => p.imports)) {
		const { path, alias } = typeof imp === "string" ? { path: imp } : imp;
		specs.set(`${alias ?? ""} ${path}`, { path, alias });
	}
	const imports = [...specs.values()];
	const source = [
		`package ${checker.pkgName}`,
		...(imports.length > 0
			? [
					`import (\n${imports.map(({ path, alias }) => `\t${alias ? `${alias} ` : ""}${JSON.stringify(path)}`).join("\n")}\n)`,
				]
			: []),
		...parts.map((p) => p.body),
		"",
	].join("\n\n");
	const filename = "gofront_gen.go";
	const ast = new Parser(
		new Lexer(source, filename).tokenize(),
		filename,
		source,
	).parse();
	restoreRenamedTypes(ast.decls);
	ast._source = source;
	ast._generated = true;
	ast._path = join(dirname(programs[0]._path ?? "."), filename);
	ast.target = checker.target;
	importStdlibPackages(
		[ast],
		checker,
		preambles,
		options.bundledDirs ?? new Set(),
		options,
		deps,
	);
	checker.bindReachedPackages(filename);
	const before = checker.errors.length;
	checker.checkAll([ast]);
	if (checker.errors.length > before) {
		const detail = checker.errors
			.slice(before)
			.map((e) => e.message)
			.join("\n");
		throw new Error(
			`internal error in the generated Go; please report\n${detail}`,
		);
	}
	for (const { link } of parts) link?.(checker);
	return [ast];
}

// Packages a `js` package may use without importing them, as the compiler
// has always allowed: a program that selects from the identifier (or, for
// `gom`, declares a templ component, typed as `gom.Node`) without declaring
// or importing it gets the import.
const IMPLICIT_PACKAGES = ["fmt", "gom", "regexp"];

function implicitImports(p, programs) {
	const topLevel = stdlibTopLevelNames(programs).values;
	const declared = (name) =>
		p.imports.some((imp) =>
			imp.imports.some((s) => s.path === name || s.alias === name),
		) || topLevel.has(name);
	const used = new Set();
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(visit);
		if (node.kind === "TemplDecl") used.add("gom");
		else if (
			node.kind === "SelectorExpr" &&
			IMPLICIT_PACKAGES.includes(node.expr?.name)
		)
			used.add(node.expr.name);
		else if (typeof node.name === "string" && node.kind?.endsWith("TypeName"))
			for (const name of IMPLICIT_PACKAGES)
				if (node.name.startsWith(`${name}.`)) used.add(name);
		forEachChild(node, visit);
	};
	visit(p.decls);
	return [...used]
		.filter((name) => !declared(name))
		.map((path) => ({ path, _line: 1, _col: 1, _implicit: true }));
}

// Packages that keep their own wording for the unavailable-in-wasm error.
const NOT_IN_WASM = new Map([["gom", "gom usage"]]);

// Reports an import of a `js`-only package from a `wasm` or `both` package.
function errJsOnlyImport(checker, p, spec) {
	// Its uses are not a second root cause.
	checker._unavailableImports ??= new Set();
	checker._unavailableImports.add(spec.alias ?? spec.path.split("/").at(-1));
	const category = NOT_IN_WASM.get(spec.path);
	if (category) {
		checker.recordBlocker(category, spec.path);
		const msg = `package '${spec.path}' is not available in wasm packages`;
		return errAtImport(checker, p, spec, msg);
	}
	checker.recordBlocker("unsupported stdlib import", spec.path);
	const msg = `package '${spec.path}' is only available in js packages`;
	errAtImport(checker, p, spec, msg, "move this code to a js package");
}

// Loads and binds one import of program `p`.
function importStdlibSpec(
	p,
	spec,
	checker,
	preambles,
	bundledDirs,
	options,
	deps,
) {
	if (spec.path.startsWith("js:") || isLocalPath(spec.path)) return;
	const dir = resolveStdlibSource(spec.path, options.stdlibRoot);
	if (!dir) return;
	const wasmImporter = checker.target === "wasm" || checker.target === "both";
	if (wasmImporter && stdlibIsJsOnly(dir, deps))
		return errJsOnlyImport(checker, p, spec);
	let pkg;
	try {
		pkg = loadStdlibPackage(spec.path, dir, options, deps, checker.target);
	} catch (e) {
		const msg = `internal stdlib error in ${spec.path}; please report`;
		return errAtImport(checker, p, spec, msg, e.message);
	}
	options.importTokens?.push(`std:${pkg.key}@${pkg.id}`);
	emitStdlibPackage(pkg, checker.target, preambles, bundledDirs, options);
	bindStdlibImport(checker, p, spec, pkg);
}

export function importStdlibPackages(
	programs,
	checker,
	preambles,
	bundledDirs,
	options,
	deps,
) {
	const wasmImporter = checker.target === "wasm" || checker.target === "both";
	for (const p of programs) {
		const specs = p.imports.flatMap((imp) => imp.imports);
		if (!wasmImporter) specs.push(...implicitImports(p, programs));
		for (const spec of specs)
			importStdlibSpec(p, spec, checker, preambles, bundledDirs, options, deps);
	}
}
