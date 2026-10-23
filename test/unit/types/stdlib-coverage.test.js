// GoFront test suite — stdlib coverage gate (runtime/stdlib/manifest.json)
//
// Compares the manifest (Go's API, classified by the scope rule) with what
// GoFront implements:
//   - by name: every `js`/`wasm`/`both` member exists in the checker namespace
//     or a Go-source package, and `wasm`/`both` members are also available
//     in wasm packages (WASM_STDLIB_MEMBERS or Go source);
//   - exclusions: importing an excluded package or referencing an excluded
//     member reports the manifest's reason (its note, or its category).
//
// Members that are not there yet are listed in stdlib-coverage.gaps.json,
// grouped by check and package.  The gate fails on a gap that is not listed
// (a regression or an unclassified member) and on a listed gap that is gone
// (remove it from the file).  `node test/unit/types/stdlib-coverage.test.js
// --update-gaps` rewrites the file from the current tree.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_PATH } from "../../../scripts/stdlib-manifest.js";
import { Lexer } from "../../../src/lexer.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	STDLIB_PACKAGES,
	WASM_STDLIB_MEMBERS,
	WASM_SUPPORTED_STDLIB,
} from "../../../src/typechecker/types.js";
import { compile, ROOT, section, test } from "../helpers.js";

const GAPS_PATH = fileURLToPath(
	new URL("./stdlib-coverage.gaps.json", import.meta.url),
);
const STDLIB_SOURCE = join(ROOT, "runtime/stdlib");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const checker = new TypeChecker();

// The identifier a package is referenced by (`math/rand/v2` is `rand`).
const pkgIdent = (pkg) =>
	pkg
		.split("/")
		.filter((s) => !/^v\d+$/.test(s))
		.at(-1);

// ── What GoFront implements ─────────────────────────────────────────────

// Exported names of a Go-source package (runtime/stdlib/<pkg>): top-level
// declarations plus `T.M` methods and `T.F` struct fields.
const goSourceCache = new Map();
function goSourceMembers(pkg) {
	if (goSourceCache.has(pkg)) return goSourceCache.get(pkg);
	const dir = join(STDLIB_SOURCE, pkg);
	const files = existsSync(dir)
		? readdirSync(dir).filter((f) => f.endsWith(".go"))
		: [];
	const names = files.length > 0 ? new Set() : null;
	for (const f of files) {
		const source = readFileSync(join(dir, f), "utf8");
		const ast = new Parser(new Lexer(source, f).tokenize(), f, source).parse();
		for (const d of ast.decls ?? []) collectDecl(d, names);
	}
	goSourceCache.set(pkg, names);
	return names;
}

function collectDecl(d, names) {
	const exported = (n) => /^[A-Z]/.test(n);
	if (d.kind === "MethodDecl" && exported(d.name)) {
		names.add(`${d.recvType?.name}.${d.name}`);
	} else if (d.kind === "FuncDecl" && exported(d.name)) {
		names.add(d.name);
	} else if (d.kind === "TypeDecl" && exported(d.name)) {
		names.add(d.name);
		for (const f of d.type?.kind === "StructType" ? d.type.fields : [])
			for (const n of f.embedded ? [f.type.name] : f.names)
				names.add(`${d.name}.${n}`);
	} else if (d.kind === "VarDecl" || d.kind === "ConstDecl") {
		for (const spec of d.decls ?? [])
			for (const n of spec.names ?? []) if (exported(n)) names.add(n);
	}
}

// Does checker type `t` (a named type, struct, interface or pointer to one)
// have a method or field `member`?
function typeHas(t, member) {
	for (let x = t, depth = 0; x && depth < 6; depth++) {
		for (const set of [x.methods, x.fields])
			if (set instanceof Map && set.has(member)) return true;
		x = x.kind === "pointer" ? x.base : x.underlying;
	}
	return false;
}

// Is `name` (`X` or `T.M`) declared by the emitter-backed package?
function inChecker(pkg, name) {
	if (!STDLIB_PACKAGES.has(pkg)) return false;
	const ident = pkgIdent(pkg);
	const ns = checker.globals.lookup(ident);
	const [top, member] = name.split(".");
	if (member === undefined) return Boolean(ns?.members && top in ns.members);
	const t = checker.types.get(`${ident}.${top}`) ?? ns?.members?.[top];
	return Boolean(t) && typeHas(t, member);
}

function inGoSource(pkg, name) {
	return goSourceMembers(pkg)?.has(name) ?? false;
}

function inWasm(pkg, name) {
	if (inGoSource(pkg, name)) return true;
	if (!WASM_SUPPORTED_STDLIB.has(pkg)) return false;
	const allowed = WASM_STDLIB_MEMBERS.get(pkgIdent(pkg));
	return !allowed || allowed.has(name.split(".")[0]);
}

// ── Exclusion diagnostics ───────────────────────────────────────────────

// A program that uses the excluded entry, or null when it has no form.
function exclusionProbe(e) {
	const id = pkgIdent(e.pkg);
	const head = `package main\n\nimport "${e.pkg}"\n\n`;
	if (e.kind === "package")
		return `package main\n\nimport _ "${e.pkg}"\n\nfunc main() {}\n`;
	const [top, member] = e.name.split(".");
	if (e.kind === "type") return `${head}var _ ${id}.${top}\n\nfunc main() {}\n`;
	if (member === undefined) return `${head}func main() { _ = ${id}.${top} }\n`;
	const ptr = e.recv?.startsWith("*") ? "*" : "";
	return `${head}func use(x ${ptr}${id}.${top}) { _ = x.${member} }\n\nfunc main() {}\n`;
}

// The compile errors of `source` as a js package.  An exclusion is a
// targeted error, so warnings ("cannot find types for …") do not count; they
// are kept off the console.
function compileErrors(source) {
	const { warn, error } = console;
	console.warn = console.error = () => {};
	try {
		return compile(source)
			.errors.map((x) => x.message)
			.join("\n");
	} catch (err) {
		return String(err?.message ?? err);
	} finally {
		Object.assign(console, { warn, error });
	}
}

function reportsExclusion(e) {
	const reason = e.note ?? e.status.slice("excluded:".length);
	return compileErrors(exclusionProbe(e)).includes(reason);
}

// ── Gaps ────────────────────────────────────────────────────────────────

// { missing, wasm, exclusion }: check -> pkg -> sorted member names.
function currentGaps() {
	const gaps = { missing: {}, wasm: {}, exclusion: {} };
	const add = (check, e) => {
		const list = gaps[check][e.pkg] ?? [];
		gaps[check][e.pkg] = list;
		const name = e.kind === "package" ? "*" : e.name;
		if (!list.includes(name)) list.push(name);
	};
	for (const e of manifest.entries) {
		if (e.status.startsWith("excluded:")) {
			if (!reportsExclusion(e)) add("exclusion", e);
			continue;
		}
		if (!["js", "wasm", "both"].includes(e.status)) continue;
		if (!inChecker(e.pkg, e.name) && !inGoSource(e.pkg, e.name))
			add("missing", e);
		else if (e.status !== "js" && !inWasm(e.pkg, e.name)) add("wasm", e);
	}
	for (const byPkg of Object.values(gaps))
		for (const list of Object.values(byPkg)) list.sort();
	return gaps;
}

const flatten = (gaps, check) =>
	Object.entries(gaps[check] ?? {}).flatMap(([pkg, names]) =>
		names.map((n) => `${pkg}.${n}`),
	);

const gaps = currentGaps();

if (process.argv.includes("--update-gaps")) {
	writeFileSync(GAPS_PATH, `${JSON.stringify(gaps, null, "\t")}\n`);
	// Biome's layout, so `npm run format` leaves the file alone.
	execFileSync(join(ROOT, "node_modules/.bin/biome"), [
		"format",
		"--write",
		GAPS_PATH,
	]);
	console.log(`wrote ${GAPS_PATH}`);
}

const known = JSON.parse(readFileSync(GAPS_PATH, "utf8"));

// Fails on unlisted gaps (with the list) and on listed gaps that are gone.
function checkGaps(check, label) {
	const now = new Set(flatten(gaps, check));
	const listed = new Set(flatten(known, check));
	const unlisted = [...now].filter((n) => !listed.has(n));
	const fixed = [...listed].filter((n) => !now.has(n));
	const parts = [];
	if (unlisted.length > 0)
		parts.push(`${unlisted.length} ${label}:\n  ${unlisted.join("\n  ")}`);
	if (fixed.length > 0)
		parts.push(
			`${fixed.length} gaps are fixed; remove them from stdlib-coverage.gaps.json (--update-gaps):\n  ${fixed.join("\n  ")}`,
		);
	if (parts.length > 0) throw new Error(parts.join("\n"));
}

section("Stdlib coverage gate: by name");

test("every js/wasm/both member exists in the checker or Go source", () => {
	checkGaps("missing", "members missing from GoFront");
});

test("every wasm/both member is available in wasm packages", () => {
	checkGaps("wasm", "members missing in wasm packages");
});

test("every excluded package and member reports its exclusion reason", () => {
	checkGaps("exclusion", "exclusions without their diagnostic");
});

test("the known gaps only name manifest entries", () => {
	const names = new Set(
		manifest.entries.map(
			(e) => `${e.pkg}.${e.kind === "package" ? "*" : e.name}`,
		),
	);
	for (const check of ["missing", "wasm", "exclusion"])
		for (const n of flatten(known, check))
			if (!names.has(n))
				throw new Error(`${check}: ${n} is not in the manifest`);
});
