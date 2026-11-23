// The process-lifetime cache of compiled packages.
//
// A unit holds what one package's compile produced: its own JS chunk, the
// exports importers bind, the programs the backends read and the effects the
// compile had on the build around it.  A unit is stored once and never
// written again; a later build either reuses it as it is or compiles the
// package afresh and replaces it.  Go-source stdlib packages live in the same
// cache, one table per stdlib root.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import * as typeTable from "../typechecker/types.js";

const { isExported } = typeTable;

// Keeps the cache bounded in long-lived processes (the unit-test workers
// compile thousands of throwaway packages).
const DEFAULT_UNIT_LIMIT = 512;

export class PackageCache {
	constructor({ unitLimit = DEFAULT_UNIT_LIMIT } = {}) {
		this.unitLimit = unitLimit;
		this.units = new Map(); // key -> unit, least recently used first
		this.stdlibTables = new Map(); // stdlib root -> Map<key, package>
		this.stats = {
			unitHits: 0,
			unitMisses: 0,
			stdlibHits: 0,
			stdlibMisses: 0,
			stdlibJsHits: 0,
			stdlibJsMisses: 0,
			// per package directory
			packages: new Map(),
		};
	}

	// The table of Go-source stdlib packages built from `root` (undefined: the
	// bundled stdlib).
	stdlibFor(root) {
		const key = root ?? "";
		if (!this.stdlibTables.has(key)) this.stdlibTables.set(key, new Map());
		return this.stdlibTables.get(key);
	}

	getUnit(key) {
		const unit = this.units.get(key);
		if (unit) {
			this.units.delete(key);
			this.units.set(key, unit);
		}
		return unit;
	}

	setUnit(key, unit) {
		if (freezeStored) freezeUnit(unit);
		this.units.delete(key);
		this.units.set(key, unit);
		if (this.units.size > this.unitLimit)
			this.units.delete(this.units.keys().next().value);
	}

	// Counts a lookup of the package in `dir`.
	count(dir, hit) {
		const s = this.stats;
		if (hit) s.unitHits++;
		else s.unitMisses++;
		const per = s.packages.get(dir) ?? { hits: 0, misses: 0 };
		if (hit) per.hits++;
		else per.misses++;
		s.packages.set(dir, per);
	}

	clear() {
		this.units.clear();
		this.stdlibTables.clear();
		const s = this.stats;
		for (const k of Object.keys(s)) if (typeof s[k] === "number") s[k] = 0;
		s.packages.clear();
	}
}

// What `compileFiles` uses unless it is given another cache.
export const defaultPackageCache = new PackageCache();

// ── Freezing (a test flag) ───────────────────────────────────
//
// A stored unit is never written again.  With the flag on, every unit the
// default cache stores from now on (and those it holds) is deep-frozen, so a
// pass that writes to one throws instead of leaking into the next build.

let freezeStored = false;
let sharedTypeObjects = null;

// Everything the type table exports (`error`, `any`, the untyped kinds, ...):
// objects every compile in the process shares, which no unit owns.
function sharedObjects() {
	if (sharedTypeObjects) return sharedTypeObjects;
	const shared = new Set();
	const visit = (v) => {
		if (!v || typeof v !== "object" || shared.has(v)) return;
		shared.add(v);
		if (v instanceof Map) for (const e of v.values()) visit(e);
		else if (v instanceof Set) for (const e of v) visit(e);
		else for (const k of Object.keys(v)) visit(v[k]);
	};
	for (const v of Object.values(typeTable)) visit(v);
	sharedTypeObjects = shared;
	return shared;
}

const FROZEN_PROTOTYPES = new Set([
	Object.prototype,
	Array.prototype,
	Map.prototype,
	Set.prototype,
	null,
]);

// Freezes `value` and what it holds, entries of maps and sets included.
// Class instances (a checker's scopes) are live checker state and stay as
// they are.
function deepFreeze(value, seen = new Set(sharedObjects())) {
	if (!value || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	if (!FROZEN_PROTOTYPES.has(Object.getPrototypeOf(value))) return;
	Object.freeze(value);
	if (value instanceof Map)
		for (const [k, v] of value) {
			deepFreeze(k, seen);
			deepFreeze(v, seen);
		}
	else if (value instanceof Set) for (const v of value) deepFreeze(v, seen);
	for (const k of Object.getOwnPropertyNames(value))
		deepFreeze(Object.getOwnPropertyDescriptor(value, k).value, seen);
}

export function freezeUnit(unit) {
	deepFreeze(unit);
}

// What a stored Go-source stdlib package hands to its importers.
export function freezeStdlibPackage(pkg) {
	deepFreeze(pkg.unit.programs);
	deepFreeze(pkg.exportedTypes);
	deepFreeze(pkg.namespace);
}

export function freezesStoredUnits() {
	return freezeStored;
}

// Turns freezing on or off; turning it on freezes what the default cache
// holds already.
export function freezePackageCache(on) {
	freezeStored = on;
	if (!on) return;
	for (const unit of defaultPackageCache.units.values()) freezeUnit(unit);
	for (const table of defaultPackageCache.stdlibTables.values())
		for (const pkg of table.values())
			if (pkg && !(pkg instanceof Error)) freezeStdlibPackage(pkg);
}

// Empties the default cache (tests that need a cold start).
export function resetPackageCache() {
	defaultPackageCache.clear();
}

// ── Keys ─────────────────────────────────────────────────────

// `path:mtime:size` of each file; a file that is gone says so.
export function filesSignature(paths) {
	return paths
		.map((path) => {
			try {
				const st = statSync(path);
				return `${path}:${st.mtimeMs}:${st.size}`;
			} catch {
				return `${path}:missing`;
			}
		})
		.join("|");
}

// The options that change what a package's own compile produces, with the
// package's resolved target.
export function optionsSignature(options, pkgTarget) {
	return JSON.stringify([
		pkgTarget,
		options.sourceMap ?? false,
		options.forceTarget ?? null,
		options.targetOverrides ?? null,
		options.rootDir ?? null,
		options.natives ?? null,
		options.stdlibRoot ?? null,
		options.strict ?? false,
		options.isTest ?? false,
		options.wasmTests ?? false,
		options.includeTests ?? false,
	]);
}

// The files `//go:embed` directives matched, with a digest of their bytes.
export function embedSignature(programs) {
	const parts = [];
	for (const p of programs)
		for (const d of p.decls ?? []) {
			if (d.kind !== "VarDecl") continue;
			for (const spec of d.decls ?? [])
				for (const directive of spec._embeds ?? []) {
					parts.push(directive.patterns?.join(" ") ?? "");
					for (const f of directive._embedFiles ?? [])
						parts.push(
							`${f.path}:${createHash("sha1").update(f.bytes).digest("hex")}`,
						);
				}
		}
	return parts.join("|");
}

// Whether the file at `path` can be read (the `.d.ts` files a package names).
export function readableSignature(path) {
	try {
		return createHash("sha1").update(readFileSync(path)).digest("hex");
	} catch {
		return "missing";
	}
}

// ── Summaries ────────────────────────────────────────────────

// Keys that carry source positions: moving a declaration must not look like
// changing its type.
const POSITION_KEYS = new Set(["line", "col", "_line", "_col"]);

const PLAIN_PROTOTYPES = new Set([Object.prototype, Array.prototype, null]);

// The entries of `map` an importer can name: the exported ones.
function exportedOnly(map) {
	return new Map([...map].filter(([name]) => isExported(name)));
}

// A digest of what importers can observe of a compiled package: its target,
// exports (types, symbols, constants and kinds), reached types and whether it
// hands out element addresses.  Two compiles of a package that differ only
// where importers cannot tell (function bodies, unexported functions,
// comments, positions) have the same digest, so importers need no re-check.
export function summaryHash(res) {
	const ids = new Map();
	const out = [];
	const walk = (v) => {
		if (v === null || v === undefined) return out.push(String(v));
		const t = typeof v;
		if (t === "function") return out.push("fn");
		if (t !== "object") return out.push(`${t[0]}${String(v)}`);
		const seen = ids.get(v);
		if (seen !== undefined) return out.push(`#${seen}`);
		ids.set(v, ids.size);
		if (v instanceof Map) {
			out.push("M{");
			for (const [k, e] of [...v].sort(([a], [b]) =>
				String(a) < String(b) ? -1 : 1,
			)) {
				walk(k);
				walk(e);
			}
			return out.push("}");
		}
		if (v instanceof Set) {
			out.push("S{");
			for (const e of v) walk(e);
			return out.push("}");
		}
		if (Array.isArray(v)) {
			out.push("[");
			for (const e of v) walk(e);
			return out.push("]");
		}
		// A class instance is live checker state (a scope), not a type.
		if (!PLAIN_PROTOTYPES.has(Object.getPrototypeOf(v))) return out.push("obj");
		out.push("{");
		for (const k of Object.keys(v).sort()) {
			if (POSITION_KEYS.has(k)) continue;
			out.push(k);
			walk(v[k]);
		}
		return out.push("}");
	};
	walk([
		res.pkgName,
		res.target,
		res.elemAddrTaken,
		exportedOnly(res.exportedSymbols),
		res.exportedTypes,
		res.reachedTypes,
		exportedOnly(res.exportedConsts),
		exportedOnly(res.exportedKinds),
	]);
	return createHash("sha1").update(out.join(",")).digest("hex");
}

// Keyed on the unit's link record, which every reuse of a stored unit shares.
const summaries = new WeakMap();

// The digest of a stored unit, computed when the first importer asks for it.
export function unitSummary(unit) {
	let summary = summaries.get(unit.link);
	if (summary === undefined) {
		summary = summaryHash({
			pkgName: unit.link.pkgName,
			target: unit.link.pkgTarget,
			elemAddrTaken: unit.elemAddrTaken,
			...unit,
		});
		summaries.set(unit.link, summary);
	}
	return summary;
}
