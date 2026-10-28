// Go-source stdlib pipeline: packages under stdlib/<path>/ are parsed, checked
// twice (probe, then mangled), linked into app.wasm and spliced into the JS
// bundle.  compiler.js owns import resolution, so the functions that need it
// (and the parser/checker helpers it also exports) arrive through an injected
// `deps` argument: `{ gwFilesIn, resolveImports, TypeChecker }`.  Importing
// compiler.js from here would create a cycle.

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CodeGen } from "../backend/js/index.js";
import { Lexer } from "../lexer.js";
import { generateJsonCodecs } from "../lower/json-codecs.js";
import { reachableStdlibDecls } from "../lower/reachability.js";
import { forEachChild } from "../lower/walk.js";
import { Parser } from "../parser/index.js";
import {
	isBuiltinPackage,
	isLocalPath,
	resolveStdlibSource,
} from "../resolver.js";
import { lowerStdlibRefs, registerWasmUnit } from "./wasm.js";

// ── Go-source stdlib ──────────────────────────────────────────
//
// Packages under stdlib/<path>/ are GoFront Go.  Each is type-checked
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

function parseStdlibFiles(dir, deps) {
	return deps.gwFilesIn(dir).map((f) => {
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
export function mangleStdlibAst(programs, ctx) {
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

function checkStdlibPrograms(programs, pkgName, options, overlay, deps) {
	const checker = new deps.TypeChecker();
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
	deps.resolveImports(
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
// a location inside stdlib/.
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
function probeStdlibPackage(_importPath, dir, options, overlay, deps) {
	const programs = parseStdlibFiles(dir, deps);
	const pkgName = programs[0].pkg.name;
	const { values, types } = stdlibTopLevelNames(programs);
	for (const n of [...values, ...types])
		if (overlay && n in overlay.members)
			throw new Error(`overlay redeclares ${overlay.name}.${n}`);
	const probe = checkStdlibPrograms(programs, pkgName, options, overlay, deps);
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
function loadStdlibPackage(importPath, dir, options, deps) {
	const cache = options.stdlibCache;
	const cached = cache.get(importPath);
	if (cached === null)
		throw new Error(`import cycle in Go-source stdlib: ${importPath}`);
	if (cached instanceof Error) throw cached;
	if (cached) return cached;
	cache.set(importPath, null);
	try {
		const pkg = buildStdlibPackage(importPath, dir, options, deps);
		cache.set(importPath, pkg);
		return pkg;
	} catch (e) {
		cache.set(importPath, e);
		throw e;
	}
}

function buildStdlibPackage(importPath, dir, options, deps) {
	const cache = options.stdlibCache;
	const overlay = isBuiltinPackage(importPath)
		? new deps.TypeChecker().globals.lookup(importPath.split("/").at(-1))
		: null;
	const info = {
		...probeStdlibPackage(importPath, dir, options, overlay, deps),
		suffix: stdlibSuffix(importPath),
	};

	// Pass 2: mangle a fresh parse and check it again.
	const programs = parseStdlibFiles(dir, deps);
	mangleStdlibAst(programs, { ...info, overlay });
	const checker = checkStdlibPrograms(
		programs,
		info.pkgName,
		options,
		null,
		deps,
	);
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

// A Go-source package's JS is generated at the root compile, once every
// JS-emitted user program is known, so only reachable declarations are
// emitted (see lower/reachability.js).  Importers leave a marker line.
const STDLIB_MARKER_RE = /^\/\*__GOFRONT_STDLIB:([^*]*)\*\/$/;

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
	const spliced = new Set();
	for (const line of lines) {
		const path = line.match(STDLIB_MARKER_RE)?.[1];
		if (!path) {
			out.push(line);
			continue;
		}
		if (spliced.has(path)) continue;
		spliced.add(path);
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
export function finishStdlibJs(merged, options, programs, emitTarget) {
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

// Generates, imports and checks the codecs for the package's `encoding/json`
// calls as one more (wasm-only) file.  Returns the generated programs: none
// for a js package, a package with errors, or one that makes no json calls.
export function checkJsonCodecs(programs, checker, preambles, options, deps) {
	const wasm = checker.target === "wasm" || checker.target === "both";
	if (!wasm || checker.errors.length > 0) return [];
	const gen = generateJsonCodecs(programs, checker, checker.pkgName);
	if (!gen) return [];
	for (const { program, node, message, hint } of gen.diagnostics) {
		checker._setCurrentFile(program);
		checker.recordBlocker("unsupported stdlib member", message);
		checker.err(message, node, hint);
	}
	if (gen.diagnostics.length > 0) return [];
	const filename = "json_codecs.go";
	const ast = new Parser(
		new Lexer(gen.source, filename).tokenize(),
		filename,
		gen.source,
	).parse();
	ast._source = gen.source;
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
	const before = checker.errors.length;
	checker.checkAll([ast]);
	if (checker.errors.length > before) {
		const detail = checker.errors
			.slice(before)
			.map((e) => e.message)
			.join("\n");
		throw new Error(
			`internal error in the generated encoding/json codecs; please report\n${detail}`,
		);
	}
	return [ast];
}

export function importStdlibPackages(
	programs,
	checker,
	preambles,
	bundledDirs,
	options,
	deps,
) {
	for (const p of programs) {
		for (const spec of p.imports.flatMap((imp) => imp.imports)) {
			if (spec.path.startsWith("js:") || isLocalPath(spec.path)) continue;
			const dir = resolveStdlibSource(spec.path, options.stdlibRoot);
			if (!dir) continue;
			let pkg;
			try {
				pkg = loadStdlibPackage(spec.path, dir, options, deps);
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
