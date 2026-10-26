// GoFront test suite — stdlib coverage gate (stdlib/manifest.json)
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
import { goSignature } from "../../../src/typechecker/stdlib/signature.js";
import {
	ERROR,
	STDLIB_PACKAGES,
	WASM_STDLIB_MEMBERS,
	WASM_SUPPORTED_STDLIB,
} from "../../../src/typechecker/types.js";
import {
	assertEqual,
	assertErrorContains,
	compile,
	compileDir,
	ROOT,
	section,
	test,
	withTempDir,
} from "../helpers.js";

const GAPS_PATH = fileURLToPath(
	new URL("./stdlib-coverage.gaps.json", import.meta.url),
);
const STDLIB_SOURCE = join(ROOT, "stdlib");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const checker = new TypeChecker();

// The identifier a package is referenced by (`math/rand/v2` is `rand`).
const pkgIdent = (pkg) =>
	pkg
		.split("/")
		.filter((s) => !/^v\d+$/.test(s))
		.at(-1);

// ── What GoFront implements ─────────────────────────────────────────────

// A Go-source package (stdlib/<pkg>), type-checked as the loader
// does (an overlay sees its emitter members): its exported names, plus `T.M`
// methods and `T.F` struct fields, and its checker.
const goSourceCache = new Map();
function goSource(pkg) {
	if (goSourceCache.has(pkg)) return goSourceCache.get(pkg);
	const dir = join(STDLIB_SOURCE, pkg);
	const files = existsSync(dir)
		? readdirSync(dir).filter((f) => f.endsWith(".go"))
		: [];
	let src = null;
	if (files.length > 0) {
		const programs = files.map((f) => {
			const source = readFileSync(join(dir, f), "utf8");
			const ast = new Parser(
				new Lexer(source, f).tokenize(),
				f,
				source,
			).parse();
			ast.target = "both";
			return ast;
		});
		const names = new Set();
		for (const p of programs)
			for (const d of p.decls ?? []) collectDecl(d, names);
		const pkgChecker = new TypeChecker();
		pkgChecker.target = "both";
		pkgChecker.pkgName = programs[0].pkg.name;
		pkgChecker.isStdlib = true;
		if (STDLIB_PACKAGES.has(pkg))
			for (const [n, t] of Object.entries(namespace(pkg)?.members ?? {})) {
				pkgChecker.globals.define(n, t);
				if (t.kind === "interface" || t.kind === "named" || t.kind === "struct")
					pkgChecker.types.set(n, t);
			}
		for (const p of programs)
			for (const { path } of p.imports.flatMap((imp) => imp.imports))
				importGoSource(pkgChecker, path);
		const errors = pkgChecker.checkAll(programs);
		if (errors.length > 0)
			throw new Error(`${pkg}: ${errors.map((e) => e.message).join("; ")}`);
		src = { names, checker: pkgChecker };
	}
	goSourceCache.set(pkg, src);
	return src;
}

// Binds an imported Go-source package (`iter` in the slices overlay) as a
// namespace of its exported names.  Its types are renamed `iter.Seq`, as
// emitter-backed types are named, so signatures print them qualified.
function importGoSource(pkgChecker, path) {
	const dep = goSource(path);
	if (!dep) return;
	const id = pkgIdent(path);
	const baseMembers = STDLIB_PACKAGES.has(path)
		? (namespace(path)?.members ?? {})
		: {};
	const symbols = new Map(Object.entries(baseMembers));
	const types = new Map();
	const mangle = new Map();
	for (const n of dep.names) {
		if (n.includes(".")) continue;
		const t = dep.checker.globals.symbols.get(n);
		if (t !== undefined) symbols.set(n, t);
		mangle.set(n, n);
		if (dep.checker.types.has(n))
			types.set(n, qualifiedType(dep.checker.types.get(n), `${id}.${n}`));
	}
	const ns = {
		kind: "namespace",
		name: id,
		members: Object.fromEntries(symbols),
		_gofront: true,
		_target: "both",
		_mangle: mangle,
	};
	pkgChecker.globals.define(id, ns);
	for (const [name, type] of types) {
		pkgChecker.types.set(`${id}.${name}`, type);
	}
}

// A copy of named type `t` named `name` (a generic type's instances take
// the name of its declaration).
function qualifiedType(t, name) {
	if (t?.kind !== "named") return t;
	t.name = name;
	if (t._generic) t._generic.declNode = { ...t._generic.declNode, name };
	return t;
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

const namespace = (pkg) => checker.globals.lookup(pkgIdent(pkg));

// The type of method or field `member` of checker type `t` (a named type,
// struct, interface or pointer to one), or undefined.
function memberOf(t, member) {
	for (let x = t, depth = 0; x && depth < 6; depth++) {
		for (const set of [x.methods, x.fields])
			if (set instanceof Map && set.has(member)) return set.get(member);
		x = x.kind === "pointer" ? x.base : x.underlying;
	}
	return undefined;
}

// `{ t, owner }` for `name` (`X` or `T.M`) as the emitter-backed package
// declares it, or null.
function emitterMember(pkg, name) {
	if (!STDLIB_PACKAGES.has(pkg)) return null;
	const ns = namespace(pkg);
	const [top, member] = name.split(".");
	const owner =
		checker.types.get(`${pkgIdent(pkg)}.${top}`) ?? ns?.members?.[top];
	if (member === undefined) {
		if (ns?.members && top in ns.members)
			return { t: ns.members[top], owner: null };
		const named = checker.types.get(`${pkgIdent(pkg)}.${top}`);
		return named ? { t: named, owner: null } : null;
	}
	const t = memberOf(owner, member);
	return t === undefined ? null : { t, owner };
}

function goSourceMember(pkg, name) {
	const src = goSource(pkg);
	if (!src?.names.has(name)) return null;
	const { checker: c } = src;
	const [top, member] = name.split(".");
	const owner = c.types.get(top) ?? null;
	if (member === undefined)
		return { t: c.globals.symbols.get(top) ?? owner, owner: null };
	return { t: memberOf(owner, member), owner };
}

const findMember = (pkg, name) =>
	goSourceMember(pkg, name) ?? emitterMember(pkg, name);

function inWasm(pkg, name) {
	if (goSourceMember(pkg, name)) return true;
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
// A package with Go source (stdlib/<pkg>) is only loaded by a
// directory build, whose errors are thrown.
function compileErrors(source, goSourcePkg) {
	const { warn, error } = console;
	console.warn = console.error = () => {};
	try {
		if (goSourcePkg)
			return withTempDir({ "main.go": source }, (dir) => {
				try {
					compileDir(dir);
					return "";
				} catch (err) {
					return err.message;
				}
			});
		return compile(source)
			.errors.map((x) => x.message)
			.join("\n");
	} catch {
		return ""; // a crash is never a diagnostic
	} finally {
		Object.assign(console, { warn, error });
	}
}

function reportsExclusion(e) {
	const reason = e.note ?? e.status.slice("excluded:".length);
	// Strip quoted package paths (`"runtime/debug"`, `'runtime/debug'`) so the
	// import path itself cannot satisfy `reason`, while keeping `reason` text.
	const text = compileErrors(exclusionProbe(e), goSource(e.pkg) !== null)
		.split(`"${e.pkg}"`)
		.join("")
		.split(`'${e.pkg}'`)
		.join("");
	return text.includes(reason);
}

// ── Signatures ──────────────────────────────────────────────────────────

// GoFront's signature of manifest entry `e`, in the manifest's notation.
function signatureOf(e, { t, owner }) {
	const sig = goSignature(e.kind, t, pkgIdent(e.pkg), owner);
	return e.signature.startsWith("embedded ") ? `embedded ${sig}` : sig;
}

// ── Gaps ────────────────────────────────────────────────────────────────

// { missing, wasm, exclusion }: check -> pkg -> sorted member names.
function currentGaps() {
	const gaps = { missing: {}, wasm: {}, exclusion: {}, signature: {} };
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
		const found = findMember(e.pkg, e.name);
		if (!found) {
			add("missing", e);
			continue;
		}
		if (e.status !== "js" && !inWasm(e.pkg, e.name)) add("wasm", e);
		const sig = signatureOf(e, found);
		if (sig !== e.signature) {
			gaps.signature[e.pkg] ??= {};
			gaps.signature[e.pkg][e.name] = sig;
		}
	}
	for (const check of ["missing", "wasm", "exclusion"])
		for (const list of Object.values(gaps[check])) list.sort();
	for (const [pkg, sigs] of Object.entries(gaps.signature))
		gaps.signature[pkg] = Object.fromEntries(
			Object.entries(sigs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
		);
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

section("Stdlib coverage gate: by signature");

const entryOf = new Map(manifest.entries.map((e) => [`${e.pkg}.${e.name}`, e]));

// Fails on a mismatch that is not listed, or listed with another GoFront
// signature, and on a listed mismatch that is gone.
test("every member present in GoFront has Go's signature", () => {
	const flat = (g) =>
		new Map(
			Object.entries(g.signature ?? {}).flatMap(([pkg, sigs]) =>
				Object.entries(sigs).map(([n, sig]) => [`${pkg}.${n}`, sig]),
			),
		);
	const now = flat(gaps);
	const listed = flat(known);
	const lines = [];
	for (const [n, sig] of now)
		if (listed.get(n) !== sig)
			lines.push(`${n}: GoFront ${sig}, Go ${entryOf.get(n).signature}`);
	const fixed = [...listed.keys()].filter((n) => !now.has(n));
	const parts = [];
	if (lines.length > 0)
		parts.push(
			`${lines.length} signature mismatches:\n  ${lines.join("\n  ")}`,
		);
	if (fixed.length > 0)
		parts.push(
			`${fixed.length} mismatches are fixed; remove them from stdlib-coverage.gaps.json (--update-gaps):\n  ${fixed.join("\n  ")}`,
		);
	if (parts.length > 0) throw new Error(parts.join("\n"));
});

test("signature printer: funcs, variadics and results", () => {
	const B = (name) => ({ kind: "basic", name });
	const fn = (params, returns, variadic = false) => ({
		kind: "func",
		params,
		returns,
		variadic,
	});
	assertEqual(
		goSignature(
			"func",
			fn([B("string"), B("int"), B("int")], [B("int64"), ERROR]),
			"strconv",
		),
		"func(string, int, int) (int64, error)",
	);
	assertEqual(
		goSignature(
			"func",
			fn([B("string"), B("any")], [B("string")], true),
			"fmt",
		),
		"func(string, ...interface{}) string",
	);
	assertEqual(goSignature("func", fn([], [B("void")]), "x"), "func()");
	assertEqual(
		goSignature(
			"var",
			{ kind: "pointer", base: { kind: "named", name: "time.Location" } },
			"time",
		),
		"*Location",
	);
	assertEqual(
		goSignature("var", { kind: "named", name: "io.Writer" }, "fmt"),
		"io.Writer",
	);
	assertEqual(
		goSignature("const", { kind: "untyped", base: "float64" }, "math"),
		"ideal-float",
	);
	assertEqual(
		goSignature(
			"field",
			{
				kind: "map",
				key: B("string"),
				value: { kind: "slice", elem: B("uint8") },
			},
			"x",
		),
		"map[string][]uint8",
	);
});

test("signature printer: generics, methods and type definitions", () => {
	const tp = (name, constraint) => ({
		kind: "typeParam",
		name,
		constraint: { kind: "TypeName", name: constraint },
	});
	const T = tp("T", "comparable");
	const or = {
		kind: "generic",
		typeParams: [T],
		underlying: { kind: "func", params: [T], returns: [T], variadic: true },
	};
	assertEqual(goSignature("func", or, "cmp"), "func[$0 comparable](...$0) $0");
	const V = tp("V", "any");
	const seq = {
		kind: "named",
		name: "Seq",
		underlying: {
			kind: "func",
			params: [
				{
					kind: "func",
					params: [V],
					returns: [{ kind: "basic", name: "bool" }],
				},
			],
			returns: [],
		},
		_generic: { typeParams: [V] },
	};
	assertEqual(
		goSignature("type", seq, "iter"),
		"[$0 interface{}] func(func($0) bool)",
	);
	// A method of a generic type uses the receiver's type parameters.
	const load = {
		kind: "func",
		params: [],
		returns: [{ kind: "pointer", base: V }],
	};
	assertEqual(goSignature("method", load, "atomic", seq), "func() *$0");
	const iface = {
		kind: "named",
		name: "sort.Interface",
		underlying: {
			kind: "interface",
			methods: new Map([
				["Swap", {}],
				["Len", {}],
				["Less", {}],
			]),
		},
	};
	assertEqual(
		goSignature("type", iface, "sort"),
		"interface { Len, Less, Swap }",
	);
	assertEqual(
		goSignature(
			"type",
			{
				kind: "named",
				name: "time.Duration",
				underlying: { kind: "basic", name: "int64" },
			},
			"time",
		),
		"int64",
	);
});

test("signature printer: real checker types of a Go-source package", () => {
	const source = [
		"package box",
		"type Box[T any] struct { v T }",
		"func (b *Box[T]) Clone() *Box[T] { return nil }",
		"func (b *Box[T]) Get() (T, error) { return b.v, nil }",
		"func Use(b *Box[int]) {}",
		"func Two() (int, error) { return 0, nil }",
		"func Index[S ~[]E, E comparable](s S, v E) int { return 0 }",
		"func Sum[N ~int | ~string](a N) N { return a }",
		"",
	].join("\n");
	const ast = new Parser(
		new Lexer(source, "box.go").tokenize(),
		"box.go",
		source,
	).parse();
	ast.target = "both";
	const c = new TypeChecker();
	c.target = "both";
	c.pkgName = "box";
	assertEqual(c.checkAll([ast]).length, 0);
	const fn = (n) => goSignature("func", c.globals.symbols.get(n), "box");
	assertEqual(fn("Two"), "func() (int, error)");
	assertEqual(fn("Use"), "func(*Box[int])");
	assertEqual(
		fn("Index"),
		"func[$0 interface{ ~[]$1 }, $1 comparable]($0, $1) int",
	);
	assertEqual(fn("Sum"), "func[$0 interface{ ~int | ~string }]($0) $0");
	const box = c.types.get("Box");
	const method = (m) => goSignature("method", memberOf(box, m), "box", box);
	assertEqual(method("Clone"), "func() *Box[$0]");
	assertEqual(method("Get"), "func() ($0, error)");
});

test("strconv.ParseInt returns int64, as in Go", () => {
	const src = (decl) =>
		`package main\n\nimport "strconv"\n\nfunc main() {\n\tn, _ := strconv.ParseInt("7", 10, 64)\n\t${decl}\n\tprintln(x)\n}\n`;
	assertEqual(compile(src("var x int64 = n")).errors.length, 0);
	assertErrorContains(
		compile(src("var x int = n")).errors,
		"Cannot assign int64 to int",
	);
});

test("the known gaps only name manifest entries", () => {
	const names = new Set(
		manifest.entries.map(
			(e) => `${e.pkg}.${e.kind === "package" ? "*" : e.name}`,
		),
	);
	for (const n of Object.entries(known.signature ?? {}).flatMap(([pkg, sigs]) =>
		Object.keys(sigs).map((k) => `${pkg}.${k}`),
	))
		if (!names.has(n))
			throw new Error(`signature: ${n} is not in the manifest`);
	for (const check of ["missing", "wasm", "exclusion"])
		for (const n of flatten(known, check))
			if (!names.has(n))
				throw new Error(`${check}: ${n} is not in the manifest`);
});
