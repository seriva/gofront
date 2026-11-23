// JS of the local (user) packages, generated at the root compile.
//
// A package's compile leaves a marker line where its code goes; once the
// build's reachability closure is known (see lower/reachability.js) the root
// compile generates JS for the declarations that were reached only and
// splices it in place of the marker.  The generated code is memoized per
// package by the reached declarations, so a rebuild that reaches the same
// ones reuses it.

import { resolve } from "node:path";
import { CodeGen } from "../backend/js/index.js";
import { log } from "../cli/colors.js";
import { cloneAst, forEachChild } from "../lower/walk.js";

const USER_MARKER_RE = /^\/\*__GOFRONT_USER:([^*]*)\*\/$/;

export function userMarker(key) {
	return `/*__GOFRONT_USER:${key}*/`;
}

// The package key a marker line names, else undefined.
export function userMarkerKey(line) {
	return line.startsWith("/*__GOFRONT_USER:")
		? line.match(USER_MARKER_RE)?.[1]
		: undefined;
}

// What the code generator needs of a package besides its programs.  It lives
// on the stored unit, so every build that reuses the unit shares the memo.
export function userEmitter(
	checker,
	jsImports,
	bundledPackages,
	options,
	programs,
) {
	return {
		checker,
		jsImports,
		bundledPackages,
		options,
		embedders: embeddingTypes(checker, programs),
		memo: new Map(),
	};
}

// The struct types the programs declare that embed another type, with the
// method names each could promote: `[name, names][]`.
function embeddingTypes(checker, programs) {
	const declared = new Set(
		programs.flatMap((p) =>
			p.decls.filter((d) => d.kind === "TypeDecl").map((d) => d.name),
		),
	);
	const out = [];
	for (const name of [...declared].sort()) {
		const t = checker.types.get(name);
		if (t?.kind !== "named" || !t.underlying?._embeds) continue;
		const promoted = [...(t.underlying.methods?.keys() ?? [])].filter(
			(n) => !t.methods?.has(n),
		);
		if (promoted.length > 0) out.push([name, promoted.sort()]);
	}
	return out;
}

// What of the build's method selection changes the promoted methods the
// unit's embedding structs get.
function promotionKey(emitter, reach) {
	return emitter.embedders
		.map(([name, promoted]) =>
			reach.escaped.has(name)
				? `${name}*`
				: `${name}:${promoted.filter((n) => reach.fields.has(n)).join("+")}`,
		)
		.join(",");
}

// A malformed expression in a `templ` body is parsed leniently and raised by
// the code generator (see parser/templ.js).  A component that is left out is
// never generated, so its error is raised here instead.
const templErrors = new WeakMap();

function templError(node) {
	if (!node || typeof node !== "object") return null;
	if (Array.isArray(node)) {
		for (const n of node) {
			const e = templError(n);
			if (e) return e;
		}
		return null;
	}
	if (node.forError || node.exprError) return node.forError ?? node.exprError;
	let found = null;
	forEachChild(node, (child) => {
		found ??= templError(child);
	});
	return found;
}

function checkOmittedTempl(decl) {
	if (!templErrors.has(decl)) templErrors.set(decl, templError(decl.body));
	const error = templErrors.get(decl);
	if (error) throw error;
}

// The programs of `unit` cut down to what `reach` reached: the same list of
// programs (file indexes stay put), each with its reached declarations and,
// of a `var` block, its reached specs.  Also the ids the cut is keyed by.
function reachedPrograms(unit, reach) {
	const ids = [];
	const programs = unit.programs.map((p, pi) => {
		const decls = [];
		p.decls.forEach((d, di) => {
			if (d.kind !== "VarDecl") {
				if (!reach.has(d)) {
					if (d.kind === "TemplDecl") checkOmittedTempl(d);
					return;
				}
				ids.push(`${pi}.${di}`);
				decls.push(d);
				return;
			}
			const specs = d.decls.filter((spec) => reach.has(spec));
			if (specs.length === 0) return;
			ids.push(`${pi}.${di}.${specs.map((s) => d.decls.indexOf(s)).join("+")}`);
			decls.push({ ...d, decls: specs });
		});
		return { ...p, decls };
	});
	return { programs, ids };
}

const EMPTY = { js: "", css: "", warnings: [], mappings: [] };

// The JS, CSS, warnings and source-map lines (relative to the first line of
// `js`) of `unit`'s reached code.
function userJs(unit, reach) {
	const emitter = unit.emitter;
	const { programs, ids } = reachedPrograms(unit, reach);
	if (ids.length === 0) return EMPTY;
	const key = `${ids.join(",")}|${promotionKey(emitter, reach)}`;
	const hit = emitter.memo.get(key);
	if (hit) return hit;
	const { target, strict, natives, isTest } = emitter.options;
	const codegen = new CodeGen(
		emitter.checker,
		emitter.jsImports,
		emitter.bundledPackages,
		{ target, strict, natives, keepMethods: reach.keepMethods() },
	);
	const js = codegen.generateAll(cloneAst(programs), { isTest });
	const out = {
		js,
		css: codegen.getCss(),
		warnings: codegen.warnings,
		mappings: codegen.getMappings(),
	};
	emitter.memo.set(key, out);
	return out;
}

// The code of the local package a marker names: `{ lines, mappings }` with
// the mappings pointing into the bundle's source files, relative to the first
// line.  The package's warnings are printed and its CSS is added to `css`.
export function spliceUserChunk(unit, reach, merged, css) {
	const out = userJs(unit, reach);
	for (const w of out.warnings) log.warn(w);
	if (out.css) css.push(out.css);
	const files = new Map(merged.sourceFiles.map((f, i) => [f, i]));
	const index = unit.programs.map((p) =>
		p._path ? (files.get(resolve(p._path)) ?? 0) : 0,
	);
	return {
		warnings: out.warnings,
		lines: out.js === "" ? [] : out.js.split("\n"),
		mappings: out.mappings.map((m) => ({
			genLine: m.genLine,
			srcLine: m.srcLine,
			srcFileIdx: index[m.srcFileIdx ?? 0] ?? 0,
		})),
	};
}
