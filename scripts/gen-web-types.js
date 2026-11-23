// Generates the typed web declaration packages (`gofront/dom`,
// `gofront/canvas`, `gofront/fetch`, `gofront/websocket`, `gofront/webgpu`)
// from WebIDL (`@webref/idl`, parsed with `webidl2`) as `.d.ts`-form files
// under `stdlib/gofront/<package>/<package>.d.ts`, which the compiler loads
// through its `.d.ts` path (src/dts-parser.js).
//
//   node scripts/gen-web-types.js              write the published packages
//   node scripts/gen-web-types.js --check      exit 1 when one is out of date
//   node scripts/gen-web-types.js --package x  write package x (published or not)
//
// Which spec feeds which package, per-name exceptions, renames and the list of
// published packages are in scripts/web-types-overrides/. The output is a pure
// function of the IDL and those files: two runs are byte-identical.
//
// Mapping (WebIDL -> declaration):
//
//   interface A : B            interface A extends B   (B qualified when it is
//                              declared by another package: `dom.B`; a base no
//                              package declares is dropped)
//   mixins, partials           merged into the interface that includes them or
//                              is partially defined (specs in name order)
//   constructor(...)           `declare class A` with `new(...)` signatures
//   const X = 1                `readonly X: int`
//   attribute T x              `x: T` (`readonly x: T` when read-only)
//   operation T f(A a)         `f(a: A): T`; overloads merge into one signature
//                              taking the longest argument list, where an
//                              argument missing from an overload is optional and
//                              one whose type or result differs is `any`
//   static members, iterable, maplike, setlike, getter/setter/deleter without
//   a name, stringifier        not declared
//   dictionary D : E           `/** @dictionary */ interface D extends E`; a
//                              member that is not `required` is `x?: T`
//   namespace console          `interface Console` (a lower-case name is capitalised)
//   interface mixin            merged only
//   enum                       string
//   typedef                    the type it names
//   callback C = R (A a)       `(a: A) => R`
//   callback interface I       `(...) => R` when it has one operation
//   T?                         `T | null` (`any` stays `any`)
//   any, object, symbol        any
//   union (A or B)             any
//   record<K, V>               any
//   sequence<T>, FrozenArray<T>, ObservableArray<T>   `T[]`
//   Promise<T>                 `Promise<T>` (`Promise<void>` for undefined)
//   undefined                  void
//   every integer type         int
//   float, unrestricted float  float32
//   double, unrestricted double   number (float64)
//   DOMString, USVString, ByteString   string
//   boolean                    boolean
//   a type no package declares (typed arrays, BufferSource, ...)   any
//   a type declared by another package   `pkg.Type`, listed in a
//                              `/// <reference types="gofront/pkg" />` header
//
// Member names keep their JavaScript camelCase.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "webidl2";
import { ALIASES, PACKAGES, PUBLISHED } from "./web-types-overrides/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "stdlib", "gofront");

// IDL primitive type names and the declaration each one gets.
const PRIMITIVES = new Map([
	...[
		"byte",
		"octet",
		"short",
		"unsigned short",
		"long",
		"unsigned long",
		"long long",
		"unsigned long long",
	].map((n) => [n, "int"]),
	...["DOMString", "USVString", "ByteString", "CSSOMString"].map((n) => [
		n,
		"string",
	]),
	...["float", "unrestricted float"].map((n) => [n, "float32"]),
	...["double", "unrestricted double"].map((n) => [n, "number"]),
	["boolean", "boolean"],
]);
const SEQUENCES = new Set(["sequence", "FrozenArray", "ObservableArray"]);

// ── Collecting the definitions of every spec ─────────────────────────

// How each kind of top-level definition is stored: the map of `defs` (by
// name, with its partials) or what the other kinds need.
const DEFINITION_MAPS = {
	interface: "interfaces",
	"interface mixin": "mixins",
	dictionary: "dictionaries",
	namespace: "namespaces",
	"callback interface": "callbackInterfaces",
};

// Stores definition `node` of spec `spec` in `defs`.
function addDefinition(defs, spec, node) {
	const mapName = DEFINITION_MAPS[node.type];
	if (mapName) {
		const entry = defs[mapName].get(node.name) ?? {
			spec: null,
			node: null,
			partials: [],
		};
		if (node.partial) entry.partials.push({ spec, node });
		else if (!entry.node) Object.assign(entry, { spec, node });
		defs[mapName].set(node.name, entry);
	} else if (node.type === "enum") defs.enums.add(node.name);
	else if (node.type === "typedef") defs.typedefs.set(node.name, node.idlType);
	else if (node.type === "callback") defs.callbacks.set(node.name, node);
	else if (node.type === "includes")
		defs.includes.push({ spec, target: node.target, mixin: node.includes });
}

// The merged definitions of `specs` ({ shortname: idl text }): everything is
// ordered by spec name, then by position, whatever order `specs` lists them.
function collect(specs) {
	const defs = {
		interfaces: new Map(), // name -> { spec, node, partials: [{ spec, node }] }
		mixins: new Map(),
		dictionaries: new Map(),
		namespaces: new Map(),
		callbackInterfaces: new Map(),
		enums: new Set(),
		typedefs: new Map(), // name -> idlType
		callbacks: new Map(), // name -> node
		includes: [], // { spec, target, mixin }
	};
	for (const spec of Object.keys(specs).sort())
		for (const node of parse(specs[spec])) addDefinition(defs, spec, node);
	return defs;
}

// ── Which package declares which type ────────────────────────────────

// The package each spec and each exceptional type name is assigned to.
function packageLookups(packages) {
	const bySpec = new Map();
	const byName = new Map();
	const put = (map, key, pkg, what) => {
		if (map.has(key))
			throw new Error(`${what} '${key}' is in ${map.get(key)} and ${pkg}`);
		map.set(key, pkg);
	};
	for (const [pkg, cfg] of Object.entries(packages)) {
		for (const spec of cfg.specs ?? []) put(bySpec, spec, pkg, "spec");
		for (const name of cfg.names ?? []) put(byName, name, pkg, "type");
	}
	return { bySpec, byName };
}

// The name `name` is declared as in package config `cfg`: renamed, or without
// the package's prefix (a name that is only the prefix keeps it).
function declaredName(name, cfg, isNamespace) {
	let out = cfg.renames?.[name] ?? name;
	const strip =
		!cfg.renames?.[name] &&
		cfg.prefix &&
		out.startsWith(cfg.prefix) &&
		out.length > cfg.prefix.length;
	if (strip) out = out.slice(cfg.prefix.length);
	return isNamespace && /^[a-z]/.test(out)
		? out[0].toUpperCase() + out.slice(1)
		: out;
}

// Where every declarable type goes: `{ owner: IDL name -> package, declared:
// IDL name -> its name in the package }`.
function assignPackages(defs, packages) {
	const { bySpec, byName } = packageLookups(packages);
	const owner = new Map();
	for (const map of [defs.interfaces, defs.dictionaries, defs.namespaces]) {
		for (const [name, entry] of map) {
			const pkg = entry.node && (byName.get(name) ?? bySpec.get(entry.spec));
			if (pkg && !owner.has(name)) owner.set(name, pkg);
		}
	}
	const declared = new Map();
	const taken = new Map(); // `${pkg}.${declared}` -> IDL name
	for (const [name, pkg] of owner) {
		const out = declaredName(name, packages[pkg], defs.namespaces.has(name));
		const key = `${pkg}.${out}`;
		if (taken.has(key))
			throw new Error(`${taken.get(key)} and ${name} are both ${key}`);
		taken.set(key, name);
		declared.set(name, out);
	}
	return { owner, declared };
}

// ── Types ────────────────────────────────────────────────────────────

class TypeWriter {
	constructor(defs, assignment, pkg, aliases) {
		this.defs = defs;
		this.owner = assignment.owner;
		this.declared = assignment.declared;
		this.pkg = pkg;
		this.aliases = aliases;
		this.references = new Set(); // other packages this one names
	}

	// The declaration of an IDL type: `inReturn` writes `undefined` as `void`.
	type(t, inReturn = false) {
		return orNull(t, this._body(t, inReturn));
	}

	_body(t, inReturn) {
		if (t.union) return "any";
		if (t.generic) return this._generic(t);
		return this.named(t.idlType, inReturn);
	}

	_generic(t) {
		const inner = t.idlType[0];
		if (SEQUENCES.has(t.generic)) {
			const elem = this.type(inner);
			return `${elem.includes(" ") ? `(${elem})` : elem}[]`;
		}
		if (t.generic === "Promise") {
			const elem = this.type(inner, true);
			return `Promise<${elem}>`;
		}
		return "any";
	}

	// A type written as a name. `seen` stops a typedef that names itself.
	named(name, inReturn = false, seen = new Set()) {
		if (PRIMITIVES.has(name)) return PRIMITIVES.get(name);
		if (name === "undefined") return inReturn ? "void" : "any";
		if (this.aliases[name])
			return this.named(this.aliases[name], inReturn, seen);
		if (this.defs.enums.has(name)) return "string";
		if (this.defs.typedefs.has(name) && !seen.has(name))
			return this._typedef(name, inReturn, seen.add(name));
		const callback = this.defs.callbacks.get(name);
		if (callback)
			return this.signature(callback.arguments, callback.idlType, "=>");
		const iface = this.defs.callbackInterfaces.get(name);
		if (iface?.node) return this._callbackInterface(iface);
		return this.reference(name);
	}

	_typedef(name, inReturn, seen) {
		const target = this.defs.typedefs.get(name);
		if (target.union) return "any";
		if (target.generic) return this.type(target, inReturn);
		return orNull(target, this.named(target.idlType, inReturn, seen));
	}

	// A callback interface with one operation is that operation as a function.
	_callbackInterface({ node }) {
		const ops = node.members.filter((m) => m.type === "operation" && m.name);
		if (ops.length !== 1) return "any";
		return this.signature(ops[0].arguments, ops[0].idlType, "=>");
	}

	// The declared name of a type some package declares, qualified when it is
	// another package's; `any` for a type no package declares.
	reference(name) {
		const pkg = this.owner.get(name);
		if (!pkg) return "any";
		const declared = this.declared.get(name);
		if (pkg === this.pkg) return declared;
		this.references.add(pkg);
		return `${pkg}.${declared}`;
	}

	params(args) {
		return args.map((a) => ({
			name: a.name,
			type: this.type(a.idlType),
			optional: a.optional,
			variadic: a.variadic,
		}));
	}

	// `(a: A, b?: B) => R` or, with `:`, `(a: A, b?: B): R`.
	signature(args, ret, arrow) {
		const params = writeParams(this.params(args));
		const result = this.type(ret, true);
		return arrow === "=>"
			? `(${params}) => ${result}`
			: `(${params}): ${result}`;
	}
}

// `body` (the declaration of the IDL type `t`) as `T | null` when `t` is
// nullable; `any` and `void` already hold nil.
function orNull(t, body) {
	if (!t.nullable || body === "any" || body === "void") return body;
	return `${body.includes("=>") ? `(${body})` : body} | null`;
}

function writeParams(params) {
	return params
		.map((p) =>
			p.variadic
				? `...${p.name}: ${p.type}[]`
				: `${p.name}${p.optional ? "?" : ""}: ${p.type}`,
		)
		.join(", ");
}

// One signature for the overloads `sigs` ({ params, ret }): see the header.
function mergeOverloads(sigs) {
	if (sigs.length === 1) return sigs[0];
	const longest = sigs.reduce((a, b) =>
		b.params.length > a.params.length ? b : a,
	);
	const same = (xs) => (xs.every((x) => x === xs[0]) ? xs[0] : "any");
	// A rest parameter is last: it takes the place of every parameter from the
	// earliest one any overload has as a rest parameter, which a call may omit.
	const rest = Math.min(
		...sigs
			.map((s) => s.params.findIndex((p) => p.variadic))
			.map((i) => (i < 0 ? Number.POSITIVE_INFINITY : i)),
	);
	const params = longest.params.slice(0, rest + 1).map((p, i) => {
		const at = sigs.map((s) => s.params[i]);
		if (i === rest)
			return {
				name: sigs.map((s) => s.params[rest]).find((a) => a?.variadic).name,
				type: same(
					sigs.flatMap((s) => s.params.slice(rest)).map((a) => a.type),
				),
				variadic: true,
			};
		return {
			name: p.name,
			type: same(at.filter(Boolean).map((a) => a.type)),
			optional: at.some((a) => !a || a.optional),
		};
	});
	return { params, ret: same(sigs.map((s) => s.ret)) };
}

// ── Members ──────────────────────────────────────────────────────────

// The members of interface `name` from its own definition, its partials and
// the mixins it includes (and their partials).
function memberNodes(defs, entry, name) {
	const nodes = [...entry.node.members];
	for (const p of entry.partials) nodes.push(...p.node.members);
	const seen = new Set();
	const addMixins = (target) => {
		const mixins = defs.includes
			.filter((i) => i.target === target)
			.map((i) => i.mixin)
			.sort();
		for (const mixin of mixins) {
			if (seen.has(mixin)) continue;
			seen.add(mixin);
			const m = defs.mixins.get(mixin);
			if (!m?.node) continue;
			nodes.push(...m.node.members);
			for (const p of m.partials) nodes.push(...p.node.members);
			addMixins(mixin);
		}
	};
	addMixins(name);
	return nodes;
}

// Adds member `m` to `out` (member name -> `{ line }`, or `{ sigs }` for the
// overloads of an operation); a name an earlier member took stays with it. A
// name that is not an identifier (the `margin-top` of `CSSPageDescriptors`)
// cannot be written as a property of a declaration, so the member is left out.
function addMember(out, m, tw) {
	if (m.name && !/^[A-Za-z_$][\w$]*$/.test(m.name)) return;
	if (m.type === "const") {
		if (!out.has(m.name))
			out.set(m.name, { line: `readonly ${m.name}: ${tw.type(m.idlType)};` });
	} else if (m.type === "attribute") {
		if (m.special === "static" || out.has(m.name)) return;
		const ro = m.readonly ? "readonly " : "";
		out.set(m.name, { line: `${ro}${m.name}: ${tw.type(m.idlType)};` });
	} else if (m.type === "operation") {
		if (!m.name || m.special === "static") return;
		const prior = out.get(m.name);
		if (prior && !prior.sigs) return; // an attribute or constant of that name
		const sig = {
			params: tw.params(m.arguments),
			ret: tw.type(m.idlType, true),
		};
		if (prior) prior.sigs.push(sig);
		else out.set(m.name, { sigs: [sig] });
	}
}

// The lines declaring `nodes` (members of an interface or namespace) and its
// constructor signatures: `{ members: [line], constructors: [line] }`.
function writeMembers(nodes, tw, selfName) {
	const out = new Map();
	const constructors = nodes
		.filter((m) => m.type === "constructor")
		.map((m) => `new(${writeParams(tw.params(m.arguments))}): ${selfName};`);
	for (const m of nodes) addMember(out, m, tw);
	const members = [...out].map(([name, e]) => {
		if (e.line) return e.line;
		const sig = mergeOverloads(e.sigs);
		return `${name}(${writeParams(sig.params)}): ${sig.ret};`;
	});
	return { members, constructors };
}

function writeInterface(name, entry, defs, tw) {
	const declared = tw.declared.get(name);
	const nodes = memberNodes(defs, entry, name);
	const { members, constructors } = writeMembers(nodes, tw, declared);
	const parent = entry.node.inheritance;
	const base = parent && tw.owner.has(parent) ? tw.reference(parent) : null;
	const isClass = constructors.length > 0;
	const head = `${isClass ? "declare class" : "interface"} ${declared}${base ? ` extends ${base}` : ""}`;
	const lines = [...constructors, ...members].map((l) => `\t${l}`);
	return `${head} {\n${lines.join("\n")}${lines.length ? "\n" : ""}}`;
}

function writeDictionary(name, entry, tw) {
	const declared = tw.declared.get(name);
	const parent = entry.node.inheritance;
	const base = parent && tw.owner.has(parent) ? tw.reference(parent) : null;
	const fields = new Map();
	for (const node of [entry.node, ...entry.partials.map((p) => p.node)])
		for (const f of node.members)
			if (!fields.has(f.name))
				fields.set(
					f.name,
					`${f.name}${f.required ? "" : "?"}: ${tw.type(f.idlType)};`,
				);
	const lines = [...fields.values()].map((l) => `\t${l}`);
	return `/** @dictionary */\ninterface ${declared}${base ? ` extends ${base}` : ""} {\n${lines.join("\n")}${lines.length ? "\n" : ""}}`;
}

// ── A package ────────────────────────────────────────────────────────

function writePackage(pkg, defs, assignment, version, aliases) {
	const tw = new TypeWriter(defs, assignment, pkg, aliases);
	const declared = (map) =>
		[...map]
			.filter(([name, e]) => e.node && assignment.owner.get(name) === pkg)
			.sort((a, b) =>
				cmp(assignment.declared.get(a[0]), assignment.declared.get(b[0])),
			);
	const blocks = [];
	for (const [name, e] of declared(defs.interfaces))
		blocks.push([
			assignment.declared.get(name),
			writeInterface(name, e, defs, tw),
		]);
	for (const [name, e] of declared(defs.namespaces))
		blocks.push([
			assignment.declared.get(name),
			writeInterface(name, e, defs, tw),
		]);
	for (const [name, e] of declared(defs.dictionaries))
		blocks.push([assignment.declared.get(name), writeDictionary(name, e, tw)]);
	blocks.sort((a, b) => cmp(a[0], b[0]));
	const refs = [...tw.references]
		.sort()
		.map((r) => `/// <reference types="gofront/${r}" />`);
	return `${[
		`// Code generated by scripts/gen-web-types.js from @webref/idl ${version}; DO NOT EDIT.`,
		...refs,
		"",
		blocks.map((b) => b[1]).join("\n\n"),
	].join("\n")}\n`;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The declaration file text of every package in `packages` (default: the ones
// in scripts/web-types-overrides) from `specs` ({ shortname: idl text }):
// `Map<package, text>`.
export function generate(
	specs,
	{ packages = PACKAGES, aliases = ALIASES, version = "" } = {},
) {
	const defs = collect(specs);
	const assignment = assignPackages(defs, packages);
	const out = new Map();
	for (const pkg of Object.keys(packages).sort())
		out.set(pkg, writePackage(pkg, defs, assignment, version, aliases));
	return out;
}

// ── Command line ─────────────────────────────────────────────────────

// The IDL of every spec in @webref/idl and the package's version.
async function loadWebref() {
	const require = createRequire(import.meta.url);
	const idl = require("@webref/idl");
	const { version } = require("@webref/idl/package.json");
	const files = await idl.listAll();
	const specs = {};
	for (const [name, file] of Object.entries(files))
		specs[name] = await file.text();
	return { specs, version };
}

const filePath = (pkg) => join(OUT_DIR, pkg, `${pkg}.d.ts`);

// Writes `text` as package `pkg`'s file, or with `check` reports it stale;
// returns whether the file was out of date.
function sync(pkg, text, check) {
	const path = filePath(pkg);
	if ((existsSync(path) ? readFileSync(path, "utf8") : null) === text)
		return false;
	if (check) {
		console.error(
			`gen-web-types: ${path} is out of date; run node scripts/gen-web-types.js`,
		);
		return true;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
	console.log(`gen-web-types: wrote ${path}`);
	return false;
}

async function main(argv) {
	const check = argv.includes("--check");
	const at = argv.indexOf("--package");
	const only = at >= 0 ? (argv[at + 1] ?? "") : null;
	if (only !== null && !PACKAGES[only]) {
		console.error(
			only === ""
				? "gen-web-types: --package needs a package name"
				: `gen-web-types: unknown package '${only}'`,
		);
		return 1;
	}
	const { specs, version } = await loadWebref();
	const out = generate(specs, { version });
	const wanted = only ? [only] : PUBLISHED;
	let stale = wanted.filter((pkg) => sync(pkg, out.get(pkg), check)).length;
	// A committed file of a package that is not published is out of date too.
	for (const pkg of Object.keys(PACKAGES).filter((p) => !wanted.includes(p))) {
		if (!check || !existsSync(filePath(pkg))) continue;
		console.error(
			`gen-web-types: ${filePath(pkg)} exists but '${pkg}' is not published in scripts/web-types-overrides/index.js`,
		);
		stale++;
	}
	if (check && stale === 0)
		console.log(
			`gen-web-types: ${out.size} packages generate, ${wanted.length} published and up to date`,
		);
	return stale > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	process.exit(await main(process.argv.slice(2)));
