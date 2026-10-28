// Linking of `wasm`/`both` package units into one `app.wasm`: unit
// registration, collision checks, link-copy AST rewrites and the facade splice.

import { compileWasmModule } from "../backend/wasm/index.js";
import { lower } from "../lower/index.js";
import { reachableStdlibDecls } from "../lower/reachability.js";
import { forEachChild } from "../lower/walk.js";
import { TypeCheckError, TypeChecker } from "../typechecker/index.js";

// ── WASM linking ──────────────────────────────────────────────
//
// Every `wasm`/`both` package reached during a build registers a unit in the
// shared `options.wasmUnits` array.  The root compile links all units into a
// single `app.wasm` and splices the generated JS facade into the bundle where
// the first wasm package's JS would have been.

const WASM_MARKER_RE = /^\/\*__GOFRONT_WASM_UNIT:[^*]*\*\/$/m;

export function wasmMarker(pkgName) {
	return `/*__GOFRONT_WASM_UNIT:${pkgName}*/`;
}

export function registerWasmUnit(options, unit) {
	const units = options.wasmUnits;
	if (!units) return;
	if (units.some((u) => u.key === unit.key)) return;
	units.push(unit);
}

// Registers a `wasm`/`both` package as a link unit and returns the target the
// package's own code is emitted for.  `options.wasmTests` runs a `both`
// package's tests through the wasm backend (the package is then treated as
// `wasm` for linking so its test functions are exposed by the facade).
export function registerPackageUnit(options, unit) {
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

export function checkLinkCollisions(units) {
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
export function linkIntoBundle(
	options,
	merged,
	pkgTarget,
	{ sourceMappingURL } = {},
) {
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

// Turns `cmp.Compare` / `cmp.Ordered` references (marked `_stdName` by the
// checker) into plain identifiers with the mangled name, so WASM
// monomorphisation sees ordinary top-level references.  Only for ASTs that
// are not cached: a stdlib package's own parse and the WASM link copy (user
// ASTs are re-checked on the next build; the JS backend reads `_stdName`).
export function lowerStdlibRefs(node) {
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
	if (node.kind === "CallExpr" && node.func?._jsonStream) {
		const entry = node.func._jsonGen;
		node.args.unshift(node.func.expr);
		delete node.func.expr;
		delete node.func.field;
		delete node.func._jsonStream;
		delete node.func._jsonGen;
		node.func.kind = "Ident";
		node.func.name = entry;
	} else if (node._jsonGen && node.kind === "SelectorExpr") {
		delete node.expr;
		delete node.field;
		node.kind = "Ident";
		node.name = node._jsonGen;
	}
	forEachChild(node, lowerStdlibRefs);
}
