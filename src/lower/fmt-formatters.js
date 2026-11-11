// src/lower/fmt-formatters.js
// The compile-time half of package fmt, as generated Go source.
//
// Go's fmt asks reflection for the type of every operand.  GoFront knows it
// statically, so for each call of the Print family this generator writes the
// description package fmt reads (`fmtrt.Arg`, see stdlib/internal/fmtrt):
//
//   - a call with an operand whose runtime representation does not tell its
//     type (a float64 that holds 3, an int8, a named type, a struct) is
//     redirected to a wrapper `gff_<pkg>_<Fn>_<n>` taking the operands with
//     their static types and passing each as a description;
//   - a package that stores values in interfaces that fmt prints registers a
//     lookup, `gff_<pkg>_value`, a type switch over the types it can build,
//     with `fmtrt.Register`.
//
// The functions are ordinary Go, parsed and checked as part of the package's
// generated file (src/link/stdlib.js), so both backends compile the same
// code.

import {
	ANY,
	defaultType,
	embeddedFieldName,
	FMT_PRINT_FUNCS,
	LOCAL_TYPE_SUFFIX,
} from "../typechecker/types.js";
import {
	collectProgramTypes,
	importsFor,
	isEmptyIface,
	mentionsTypeParam,
	results,
	TypeSpeller,
	under,
	walkNodes,
} from "./gen-types.js";
import { holdsFunc, isCompositeType, isFuncComposite } from "./json-codecs.js";

const FMT_PATH = "fmt";
const RT_PATH = "internal/fmtrt";
const JSON_PATH = "encoding/json";

// The Print family: fn -> what precedes the operands.
const PRINT_FUNCS = new Map([
	["Sprint", null],
	["Sprintln", null],
	["Print", null],
	["Println", null],
	["Fprint", "io.Writer"],
	["Fprintln", "io.Writer"],
	["Append", "[]byte"],
	["Appendln", "[]byte"],
	["Sprintf", null],
	["Printf", null],
	["Errorf", null],
	["Fprintf", "io.Writer"],
	["Appendf", "[]byte"],
]);

// The functions that take a format string after the prefix.
const isFormatted = (fn) => fn.endsWith("f");

const RESULT = {
	Sprint: "string",
	Sprintln: "string",
	Print: "(int, error)",
	Println: "(int, error)",
	Fprint: "(int, error)",
	Fprintln: "(int, error)",
	Append: "[]byte",
	Appendln: "[]byte",
	Sprintf: "string",
	Printf: "(int, error)",
	Errorf: "error",
	Fprintf: "(int, error)",
	Appendf: "[]byte",
};

// Where a wrapper registers the package's lookup (when it has one) before it
// formats: a package-level initialiser that prints runs before the file's own.
const ENSURE = "{{ensure}}";
// The key the lookup registers under: a hash of the generated source.
const KEY = "{{key}}";

const ALIAS = { byte: "uint8", rune: "int32" };
const unalias = (n) => ALIAS[n] ?? n;
const q = (s) => JSON.stringify(s);

const INT_KINDS = new Set(["int", "int8", "int16", "int32", "int64"]);
const UINT_KINDS = new Set([
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
]);
const FORMAT_METHODS = { Err: "Error", Str: "String", GoStr: "GoString" };

// A type of another package that has no exported name: the generated file
// cannot spell it.
function isUnexportedForeign(name) {
	const at = name.indexOf("$$");
	return at > 0 && !/^\p{Lu}/u.test(name);
}

// The types of package testing: the lookup of a package that logs through a
// *testing.T never describes the test state itself.
const HOST_TYPE = /^testing\.|\$\$testing$/;

const isInterface = (t) =>
	t?.kind === "nil" ||
	(t?.kind === "basic" && (t.name === "nil" || t.name === "any")) ||
	(t?.kind !== "basic" && under(t)?.kind === "interface");

// An interface whose dynamic values fmt formats through their own methods
// (error, Stringer), so no description of their type is needed.
function isMethodOnly(t) {
	const u = under(t);
	if (u?.kind !== "interface" || !u.methods || u.methods.size === 0)
		return false;
	return [...u.methods.keys()].every((m) => m in { Error: 1, String: 1 });
}

function methodOf(t, name) {
	if (t?.kind !== "named") return null;
	return t.methods?.get(name) ?? t.underlying?.methods?.get(name) ?? null;
}

const returnsString = (m) => {
	const r = results(m);
	return (
		m.params?.length === 0 &&
		r.length === 1 &&
		under(r[0])?.kind === "basic" &&
		under(r[0]).name === "string"
	);
};

class FmtGen extends TypeSpeller {
	constructor(checker, pkgName, qualifiers, programs, formatted = false) {
		super(pkgName, qualifiers, programs);
		this.checker = checker;
		// A package with a format call: %d and %+v call no methods, so an
		// error or Stringer in an interface is described by its type too.
		this.formatted = formatted;
		this.prefix = `gff_${String(pkgName).replace(/[^A-Za-z0-9_]/g, "_")}_`;
		this.builders = new Map(); // key -> function name
		this.wrappers = new Map(); // signature -> function name
		this.queue = [];
		this.out = [];
		this.counter = 0;
		this.needsLookup = false;
		this.uses = new Set(); // imports the generated code spells itself
		this.topLevel = new Set();
		for (const p of programs)
			for (const d of p.decls ?? [])
				if (d.kind === "TypeDecl") this.topLevel.add(d.name);
	}

	// ── Type naming ─────────────────────────────────────────────

	key(t) {
		if (!t) return "?";
		const k = (x) => this.key(x);
		const byKind = {
			basic: () => unalias(t.name),
			named: () =>
				t.typeArgs?.length
					? `${t.name}[${t.typeArgs.map(k).join(",")}]`
					: t.name,
			pointer: () => `*${k(t.base)}`,
			slice: () => `[]${k(t.elem)}`,
			array: () => `[${t.size}]${k(t.elem)}`,
			map: () => `map[${k(t.key)}]${k(t.value)}`,
			struct: () => this.structKey(t),
			interface: () => (isEmptyIface(t) ? "any" : `iface:${t.name ?? ""}`),
			func: () => this.funcString(t, k),
		};
		return (byKind[t.kind] ?? (() => `?${t.kind}`))();
	}

	structKey(t) {
		const fields = (t._structFields ?? []).map(
			(f) =>
				`${(f.names ?? []).join(",")}:${this.key(f.type)}:${f.embedded ? 1 : 0}`,
		);
		return `struct{${fields.join(";")}}`;
	}

	// How %T prints the type.
	typeName(t) {
		const n = (x) => this.typeName(x);
		switch (t?.kind) {
			case "basic":
				return t.name === "any" ? "interface {}" : unalias(t.name);
			case "named": {
				let name = t.name.replace(LOCAL_TYPE_SUFFIX, "");
				const at = name.indexOf("$$");
				if (at >= 0)
					name = `${name
						.slice(at + 2)
						.split("$")
						.at(-1)}.${name.slice(0, at)}`;
				else if (!name.includes("."))
					name = `${this.declaringPackage(t)}.${name}`;
				return t.typeArgs?.length
					? `${name}[${t.typeArgs.map(n).join(",")}]`
					: name;
			}
			case "pointer":
				return `*${n(t.base)}`;
			case "slice":
				return `[]${n(t.elem)}`;
			case "array":
				return `[${t.size}]${n(t.elem)}`;
			case "map":
				return `map[${n(t.key)}]${n(t.value)}`;
			case "interface":
				return t.name === "error" || t.name ? t.name : "interface {}";
			case "func":
				return this.funcString(t, n).replace(/^func\(/, "func(");
			case "struct": {
				const fs = (t._structFields ?? []).map((f) =>
					f.embedded ? n(f.type) : `${f.names.join(", ")} ${n(f.type)}`,
				);
				return fs.length ? `struct { ${fs.join("; ")} }` : "struct {}";
			}
			default:
				return "?";
		}
	}

	// A type the generated file can name: declared at package level or by
	// another package, or a function-local type, which the checker keeps in
	// its type table under its name.
	isNamedInScope(t) {
		return (
			t.name.includes("$$") ||
			t.name.includes(".") ||
			this.topLevel.has(t.name) ||
			this.checker.types.get(t.name) === t
		);
	}

	spellableNamed(t, ok, seen) {
		if (
			t.name.includes("[") ||
			!(t.typeArgs ?? []).every(ok) ||
			!this.isNamedInScope(t) ||
			isUnexportedForeign(t.name) ||
			HOST_TYPE.test(t.name)
		)
			return false;
		// A named struct is as spellable as its fields (a type may hold itself).
		const u = under(t);
		if (u?.kind === "namespace") return false;
		if (u?.kind !== "struct" || seen.has(t)) return true;
		seen.add(t);
		return this.spellableStruct(u, ok);
	}

	spellableInterface(t) {
		return t.name === "error" || isEmptyIface(t);
	}

	// A field of an interface type is described by its value.
	spellableStruct(t, ok) {
		return (t._structFields ?? []).every(
			(f) => isInterface(f.type) || ok(f.type),
		);
	}

	// ── Descriptions ────────────────────────────────────────────

	// Whether a method declared on a generic type has a pointer receiver:
	// instances hold substituted copies that lose the flag.
	ptrRecv(base, m, name) {
		if (Object.hasOwn(m, "_ptrRecv")) return Boolean(m._ptrRecv);
		return Boolean(
			this.checker.types.get(base.name)?._generic?.methods?.get(name)?._ptrRecv,
		);
	}

	// How the method set of `t` (a type or a pointer to one) holds the
	// string-valued method `name`: null when it does not, otherwise the chain
	// of embedded fields to the interface the method is promoted from (the
	// checker does not treat such a type as implementing the interface), or
	// null in `path` when the type declares or promotes it from a struct.
	hasFormatMethod(t, name) {
		const isPtr = t?.kind === "pointer";
		return this.methodSetHas(isPtr ? t.base : t, name, isPtr, 0);
	}

	methodSetHas(base, name, isPtr, depth) {
		if (depth > 4 || !base) return null;
		const u = under(base);
		if (u?.kind === "interface") {
			const im = u.methods?.get(name);
			return im && returnsString(im) ? { path: [] } : null;
		}
		const m = methodOf(base, name);
		if (m) {
			if (!isPtr && this.ptrRecv(base, m, name)) return null;
			return returnsString(m) ? { path: null } : null;
		}
		if (u?.kind !== "struct") return null;
		for (const f of u._structFields ?? []) {
			if (!f.embedded) continue;
			const viaPtr = f.type?.kind === "pointer";
			const inner = viaPtr ? f.type.base : f.type;
			const found = this.methodSetHas(inner, name, isPtr || viaPtr, depth + 1);
			if (!found) continue;
			// Through an interface: the field names lead to it.
			return found.path
				? { path: [embeddedFieldName(f), ...found.path] }
				: found;
		}
		return null;
	}

	// The `Err`, `Str` and `GoStr` fields for a value of type `t`.
	methodFields(t, x) {
		let out = "";
		for (const [field, method] of Object.entries(FORMAT_METHODS)) {
			const found = this.hasFormatMethod(t, method);
			if (!found) continue;
			out += `, ${field}: ${found.path ? [x, ...found.path].join(".") : x}`;
		}
		return out;
	}

	// A Go expression of type fmtrt.Arg describing the value `x` of type `t`.
	describe(t, x) {
		t = defaultType(t);
		const T = q(this.typeName(t));
		if (isInterface(t) || t?.kind === "typeParam") {
			if (this.formatted || !isMethodOnly(t)) this.needsLookup = true;
			return `fmtrt.Arg{K: fmtrt.KInterface, V: ${x}}`;
		}
		const m = this.methodFields(t, x);
		const u = under(t);
		if (u?.kind === "basic") return this.describeBasic(u.name, T, x, m);
		return `${this.builder(t)}(${x})`;
	}

	describeBasic(name, T, x, m) {
		name = unalias(name);
		const head = (k, rest) => `fmtrt.Arg{K: fmtrt.${k}, T: ${T}, ${rest}${m}}`;
		if (name === "bool") return head("KBool", `B: bool(${x})`);
		if (name === "string") return head("KString", `S: string(${x})`);
		if (INT_KINDS.has(name)) return head("KInt", `I: int64(${x})`);
		if (UINT_KINDS.has(name)) return head("KUint", `U: uint64(${x})`);
		if (name === "float32" || name === "float64")
			return head(
				"KFloat",
				`Size: ${name === "float32" ? 32 : 64}, R: float64(${x})`,
			);
		if (name === "complex64" || name === "complex128")
			return head(
				"KComplex",
				`Size: ${name === "complex64" ? 64 : 128}, R: float64(real(${x})), Im: float64(imag(${x}))`,
			);
		return `fmtrt.Arg{K: fmtrt.KInterface, V: ${x}}`;
	}

	// The function describing values of the composite type `t`.
	builder(t) {
		const key = this.key(t);
		let name = this.builders.get(key);
		if (!name) {
			name = `${this.prefix}a${this.counter++}`;
			this.builders.set(key, name);
			this.queue.push(() => this.genBuilder(name, t));
		}
		return name;
	}

	genBuilder(name, t) {
		const T = q(this.typeName(t));
		const m = this.methodFields(t, "x");
		const u = under(t);
		const body = {
			struct: () => this.structArg(u, T, m),
			array: () => this.elemsArg("KArray", u, T, m, `${u.size}`),
			slice: () => this.elemsArg("KSlice", u, T, m, "len(x)"),
			simd: () => this.simdArg(u, T, m),
			map: () => this.mapArg(u, T, m),
			pointer: () => this.pointerArg(u, T, m),
			func: () =>
				`fmtrt.Arg{K: fmtrt.KFunc, T: ${T}, Nil: x == nil, Ptr: x${m}}`,
		}[u.kind];
		const expr = body ? body() : `fmtrt.Arg{K: fmtrt.KInterface, V: x}`;
		this.out.push(
			`func ${name}(x ${this.spell(t)}) fmtrt.Arg {\n\treturn ${expr}\n}`,
		);
	}

	structArg(u, T, m) {
		const cases = [];
		let n = 0;
		for (const f of u._structFields ?? []) {
			const names = f.embedded ? [embeddedFieldName(f)] : f.names;
			for (const name of names) {
				const sel = `x.${name}`;
				const desc = this.describe(f.type, sel);
				cases.push(`\t\tcase ${n}:\n\t\t\treturn ${q(name)}, ${desc}`);
				n++;
			}
		}
		const field =
			n === 0
				? "nil"
				: `func(i int) (string, fmtrt.Arg) {\n\t\tswitch i {\n${cases.join("\n")}\n\t\t}\n\t\treturn "", fmtrt.Arg{}\n\t}`;
		return `fmtrt.Arg{K: fmtrt.KStruct, T: ${T}, N: ${n}, Field: ${field}${m}}`;
	}

	// A vector prints as its lanes; Lane takes a constant index.
	simdArg(u, T, m) {
		const cases = [];
		for (let i = 0; i < u.lanes; i++)
			cases.push(
				`\t\tcase ${i}:\n\t\t\treturn ${this.describe(u.elem, `x.Lane(${i})`)}`,
			);
		return `fmtrt.Arg{K: fmtrt.KArray, T: ${T}, N: ${u.lanes}, Elem: func(i int) fmtrt.Arg {\n\t\tswitch i {\n${cases.join("\n")}\n\t\t}\n\t\treturn fmtrt.Arg{}\n\t}${m}}`;
	}

	elemsArg(kind, u, T, m, len) {
		const isBytes = u.elem.kind === "basic" && unalias(u.elem.name) === "uint8";
		const bytes = isBytes
			? kind === "KSlice"
				? ", IsBytes: true, Bytes: []byte(x)"
				: ", IsBytes: true, Bytes: x[:]"
			: "";
		const nil = kind === "KSlice" ? ", Nil: x == nil, Ptr: x" : "";
		return `fmtrt.Arg{K: fmtrt.${kind}, T: ${T}, N: ${len}${nil}${bytes}, Elem: func(i int) fmtrt.Arg {\n\t\treturn ${this.describe(u.elem, "x[i]")}\n\t}${m}}`;
	}

	mapArg(u, T, m) {
		const key = this.describe(u.key, "k");
		const val = this.describe(u.value, "v");
		return `fmtrt.Arg{K: fmtrt.KMap, T: ${T}, Nil: x == nil, Ptr: x, N: len(x), Entries: func() []fmtrt.Entry {\n\t\tif x == nil {\n\t\t\treturn nil\n\t\t}\n\t\tes := make([]fmtrt.Entry, 0, len(x))\n\t\tfor k, v := range x {\n\t\t\tes = append(es, fmtrt.Entry{Key: ${key}, Val: ${val}})\n\t\t}\n\t\treturn es\n\t}${m}}`;
	}

	pointerArg(u, T, m) {
		const k = under(u.base)?.kind;
		const inner =
			k === "struct" || k === "array" || k === "slice" || k === "map"
				? `, Inner: func() fmtrt.Arg {\n\t\treturn ${this.describe(u.base, "*x")}\n\t}`
				: "";
		const boxed = k !== "struct" && k !== "array" ? ", Boxed: true" : "";
		return `fmtrt.Arg{K: fmtrt.KPtr, T: ${T}, Nil: x == nil, Ptr: x${boxed}${inner}${m}}`;
	}

	// ── Call sites ──────────────────────────────────────────────

	// Whether an operand of static type `t` needs a description, or reaches
	// fmt in a form it understands: { wrap } or { bare, lookup }.
	classify(t, formatted = false) {
		t = defaultType(t);
		if (!t) return { bare: true, lookup: true };
		if (t.kind === "nil" || (t.kind === "basic" && t.name === "nil"))
			return { bare: true };
		if (mentionsTypeParam(t) || t.kind === "typeParam")
			return { bare: true, lookup: true };
		if (isInterface(t))
			return { bare: true, lookup: formatted || !isMethodOnly(t) };
		if (t.kind === "basic" && !t.alias) {
			if (t.name === "string" || t.name === "bool") return { bare: true };
			// A JS number holds an int exactly only up to 2^53: past it the
			// number reads as a float, so ints are described unless the
			// package is WebAssembly only.
			if (t.name === "int" && this.checker.target === "wasm")
				return { bare: true };
		}
		if (!this.spellable(t)) return { bare: true, lookup: true };
		// A named type whose value has String or Error answers to it as it is:
		// fmt asks the value.
		// (A string type is described: Print spaces only between operands that
		// are not strings, and a bare value does not say its kind.  So are
		// slices and maps, which WebAssembly does not box with their methods.)
		const declared = (m) => this.hasFormatMethod(t, m)?.path === null;
		// A format call may print it with %d or %+v, which call no methods, so
		// there it is described.
		if (
			!formatted &&
			t.kind === "named" &&
			(under(t)?.kind === "struct" ||
				(under(t)?.kind === "basic" && under(t).name !== "string")) &&
			(declared("Error") || declared("String"))
		)
			return { bare: true };
		return { wrap: true };
	}

	// The wrapper for a call with these operands.  A call that forwards the
	// results of another (`fmt.Println(f())`) is wrapped with every operand
	// typed exactly; null when one cannot be spelled.
	wrapper(fn, prefixType, operandTypes, kinds, exact) {
		const spelled = (t) => this.spell(defaultType(t));
		if (exact && !operandTypes.every((t) => this.spellable(defaultType(t))))
			return null;
		const sig = `${fn}|${prefixType ?? ""}|${exact ? "!" : ""}${operandTypes.map((t, i) => (exact || kinds[i].wrap ? this.key(defaultType(t)) : "any")).join(",")}`;
		let name = this.wrappers.get(sig);
		if (name) return name;
		name = `${this.prefix}${fn}_${this.wrappers.size}`;
		this.wrappers.set(sig, name);
		const params = [];
		if (prefixType) params.push(`p ${prefixType}`);
		if (isFormatted(fn)) params.push("format string");
		const args = [];
		operandTypes.forEach((t, i) => {
			const a = `a${i}`;
			if (kinds[i].wrap) {
				params.push(`${a} ${spelled(t)}`);
				args.push(this.describe(t, a));
			} else {
				params.push(`${a} ${exact ? spelled(t) : "any"}`);
				args.push(a);
			}
		});
		const callArgs = [
			...(prefixType ? ["p"] : []),
			...(isFormatted(fn) ? ["format"] : []),
			...args,
		].join(", ");
		this.out.push(
			`func ${name}(${params.join(", ")}) ${RESULT[fn]} {${ENSURE}\n\treturn fmt.${fn}(${callArgs})\n}`,
		);
		if (prefixType === "io.Writer") this.uses.add("io");
		return name;
	}

	drain() {
		while (this.queue.length > 0) this.queue.shift()();
	}

	// ── The lookup ──────────────────────────────────────────────

	// Types an interface may hold that fmt prints: the types of the
	// package's expressions, its named types, and a pointer to each.
	candidateTypes() {
		const found = new Map();
		const add = (t) => {
			if (!t || !this.usable(t)) return;
			found.set(this.key(t), t);
			if (t.kind === "named" && under(t)?.kind !== "func")
				found.set(this.key({ kind: "pointer", base: t }), {
					kind: "pointer",
					base: t,
				});
		};
		for (const { type, node, via } of collectProgramTypes(
			this.programs,
			this.checker,
		)) {
			// A member of a package (fmt.Println) is no value of its own.
			if (via === "expr" && node.expr?._type?.kind === "namespace") continue;
			if (via === "declared" && !this.topLevel.has(type.name)) continue;
			add(type);
		}
		// Only instances of generic types (and pointers to them), and maps a
		// generic body boxes into an interface: they are the types a package
		// never spells, and any other type here would take the place of the
		// dispatch a type parameter value already has.
		for (const { type, boxed } of this.genericBodyTypes()) {
			const base = type.kind === "pointer" ? type.base : type;
			if (
				(boxed && type.kind === "map") ||
				(base.kind === "named" && base.typeArgs?.length > 0)
			)
				add(type);
		}
		return [...found.values()];
	}

	// The types the bodies of generic functions build for each instantiation
	// the package makes: `Box[T]{v}` inside `wrap[T]` is a `Box[int]` once
	// `wrap(2)` is called, a type no expression of the package spells.
	genericBodyTypes() {
		const decls = new Map();
		for (const program of this.programs)
			for (const d of program.decls ?? [])
				if (d.kind === "FuncDecl" && !d.recv && d.typeParams?.length)
					decls.set(d.name, d);
		if (decls.size === 0) return [];
		const out = [];
		const seen = new Set();
		const queue = [];
		const request = (call, map) => {
			const inst = this.genericInstance(call, map, decls);
			if (!inst || seen.has(inst.id) || seen.size >= 512) return;
			seen.add(inst.id);
			queue.push(inst);
		};
		for (const program of this.programs)
			walkNodes(program.decls, (node) => request(node, new Map()));
		while (queue.length > 0) {
			const { decl, map } = queue.shift();
			walkNodes(decl.body, (node) => {
				out.push(...this.bodyNodeTypes(node, map));
				request(node, map);
			});
		}
		return out;
	}

	// The types a node of an instantiated generic body adds: the node's own
	// type once substituted (a type without a type parameter is found by the
	// walk of the package already), and a map it boxes into an interface,
	// which is a type of its own (a type parameter's value keeps its dispatch).
	bodyNodeTypes(node, map) {
		const sub = (t) => defaultType(this.checker.substituteType(t, map));
		const out = [];
		if (node._type && mentionsTypeParam(node._type))
			out.push({ type: sub(node._type) });
		const src = node._ifaceSrc;
		if (src?.kind === "map" && mentionsTypeParam(src))
			out.push({ type: sub(src), boxed: true });
		return out;
	}

	// The instantiation of a generic function that `call` makes, with its
	// type arguments substituted through `map` (the instantiation of the
	// function that contains the call), or null for any other node or one
	// whose type arguments are still open.
	genericInstance(call, map, decls) {
		const generic = call._genericFnType;
		const decl = generic && decls.get(generic.name);
		const args = call._typeArgs ?? call.func?._typeArgs;
		if (!decl || args?.length !== generic.typeParams?.length) return null;
		const sub = args.map((a) => this.checker.substituteType(a, map));
		if (sub.some((a) => mentionsTypeParam(a))) return null;
		return {
			decl,
			id: `${decl.name}|${sub.map((a) => this.key(a)).join(",")}`,
			map: new Map(generic.typeParams.map((tp, i) => [tp.name, sub[i]])),
		};
	}

	usable(t) {
		if (!this.spellable(t) || mentionsTypeParam(t)) return false;
		if (isInterface(t) || under(t)?.kind === "interface") return false;
		if (t.kind === "basic") return false;
		if (t.kind === "func") return true;
		// An unnamed array or map of small integers would shadow its look-alikes
		// in the type switch (see SHARED_REPR in json-codecs). One holding
		// funcs is still described, so `%T` names it.
		if (t.kind === "array" || t.kind === "map" || t.kind === "slice")
			return isCompositeType(t) || isFuncComposite(t);
		if (holdsFunc(t)) return false;
		return true;
	}

	genLookup() {
		const cases = [];
		const seen = new Set();
		for (const t of this.candidateTypes()) {
			const spelled = this.spell(t);
			if (seen.has(spelled)) continue;
			seen.add(spelled);
			cases.push(
				`\tcase ${spelled}:\n\t\treturn ${this.describe(t, "x")}, true`,
			);
		}
		this.drain();
		const name = `${this.prefix}value`;
		this.out.push(
			[
				`func ${name}(v any) (fmtrt.Arg, bool) {`,
				"\tswitch x := v.(type) {",
				...cases,
				"\t}",
				"\treturn fmtrt.Arg{}, false",
				"}",
				"",
				`func ${this.prefix}ensure() {`,
				`\tfmtrt.Register(${KEY}, ${name})`,
				"}",
				"",
				`var _ = fmtrt.Register(${KEY}, ${name})`,
			].join("\n"),
		);
	}
}

// FNV-1a of a string, in hex.
function hash(text) {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++)
		h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
	return h.toString(16);
}

// The names the file imports `fmt` as.
function fmtAliases(program) {
	const aliases = new Set();
	for (const imp of program.imports ?? [])
		for (const spec of imp.imports)
			if (spec.path === FMT_PATH && spec.alias !== "_")
				aliases.add(spec.alias ?? "fmt");
	return aliases;
}

const isFmtRef = (node, aliases) =>
	node.kind === "SelectorExpr" &&
	node.expr?.kind === "Ident" &&
	node.expr._type?.kind === "namespace" &&
	aliases.has(node.expr.name) &&
	FMT_PRINT_FUNCS.has(node.field);

// The methods of *testing.T, *testing.B and testing.TB that format their
// operands like Print (Log, Error, Fatal, Skip) or like Printf (the f forms).
const TESTING_FORMATS = new Set(
	["Log", "Error", "Fatal", "Skip"].flatMap((m) => [m, `${m}f`]),
);
const TESTING_RECEIVER = /^(T|B|TB)\$\$testing$|^testing\.(T|B|TB)$/;

// Whether the package logs operands through testing's methods, and whether
// any of those calls is formatted. The operands reach fmt as `any` values, so
// the package needs the lookup (and, for a format call, the description of
// Stringers and errors) as for a forwarded Print call.
function findTestingCalls(programs) {
	const found = { calls: false, formatted: false };
	for (const program of programs)
		walkNodes(program.decls, (node) => {
			if (node.kind !== "CallExpr" || node.func?.kind !== "SelectorExpr")
				return;
			if (!TESTING_FORMATS.has(node.func.field)) return;
			let recv = node.func.expr?._type;
			if (recv?.kind === "pointer") recv = recv.base;
			if (!TESTING_RECEIVER.test(recv?.name ?? "")) return;
			found.calls = true;
			if (isFormatted(node.func.field)) found.formatted = true;
		});
	return found;
}

function findSites(programs) {
	const sites = [];
	const values = []; // uses that are not calls: the operands are unknown
	for (const program of programs) {
		const aliases = fmtAliases(program);
		if (aliases.size === 0) continue;
		const callees = new Set();
		const refs = [];
		walkNodes(program.decls, (node) => {
			if (node.kind === "CallExpr" && isFmtRef(node.func, aliases)) {
				sites.push({ call: node, program });
				callees.add(node.func);
			} else if (isFmtRef(node, aliases)) {
				refs.push(node);
			}
		});
		for (const node of refs) if (!callees.has(node)) values.push(node);
	}
	return { sites, values };
}

// `fmt.Println(any(x))` formats x: the conversion hides the static type the
// description is made from, and drops nothing else.
function unwrapInterfaceConversions(call, skip) {
	const args = call.args ?? [];
	for (let i = skip; i < args.length; i++) {
		const a = args[i];
		if (a?.kind !== "TypeConversion" || !isInterface(a._type)) continue;
		const inner = a.expr;
		const t = defaultType(inner?._type);
		if (t && t.kind !== "tuple" && !isInterface(t) && !inner._spread)
			args[i] = inner;
	}
}

// Whether the package passes json.Unmarshal or a Decode call a target that is
// not statically a pointer (an `any` that may hold a value): the decoder then
// reports the target's type, which only a registered lookup can name.
function hasJsonTargetNotPointer(programs) {
	let found = false;
	for (const program of programs) {
		if (
			!(program.imports ?? []).some((imp) =>
				imp.imports.some((spec) => spec.path === JSON_PATH),
			)
		)
			continue;
		walkNodes(program.decls, (node) => {
			if (found || node.kind !== "CallExpr") return;
			const f = node.func;
			if (f?.kind !== "SelectorExpr") return;
			const at = f.field === "Unmarshal" ? 1 : f.field === "Decode" ? 0 : -1;
			const arg = node.args?.[at];
			if (at < 0 || !arg?._type) return;
			if (under(defaultType(arg._type))?.kind !== "pointer") found = true;
		});
	}
	return found;
}

// The operand types of a call, or null when it cannot be wrapped.
function operandTypes(call, skip) {
	const args = call.args ?? [];
	if (args.some((a) => a?._spread)) return null;
	if (call._multiForward) {
		const types = args[0]?._type?.types;
		return types ? types.slice(skip) : null;
	}
	return args.slice(skip).map((a) => a?._type);
}

// Marks `call` to call the generated wrapper `name`, which takes the
// operands with their static types (every operand, for a forwarded call) and
// is not variadic.
function markCall(call, { name, kinds, skip, types, exact }) {
	const orig = call.func._type;
	const operand = (t, i) => (exact || kinds[i].wrap ? defaultType(t) : ANY);
	call.func._genEntry = name;
	call.func._type = {
		kind: "func",
		params: [...orig.params.slice(0, skip), ...types.map(operand)],
		returns: orig.returns,
		variadic: false,
	};
	if (exact) return;
	kinds.forEach((k, i) => {
		if (!k.wrap) return;
		const arg = call.args[skip + i];
		arg._ifaceBox = undefined;
		arg._ifaceSrc = undefined;
		arg._ifaceNamedType = undefined;
		arg._ifacePtrFields = undefined;
	});
}

// Generates the formatters for a package's Print-family calls.  Returns null
// when it needs none; otherwise { body, imports, diagnostics } and redirects
// each call that needs a wrapper with `_genEntry`.
export function generateFmtFormatters(programs, checker, pkgName) {
	const { sites, values } = findSites(programs);
	// encoding/json names the type of a target that is not a pointer with %T,
	// an operand that arrives through an interface.
	const usesJson = hasJsonTargetNotPointer(programs);
	const testing = findTestingCalls(programs);
	if (sites.length + values.length === 0 && !usesJson && !testing.calls)
		return null;
	const qualifiers = new Map();
	const gen = new FmtGen(
		checker,
		pkgName,
		qualifiers,
		programs,
		testing.formatted || sites.some((s) => isFormatted(s.call.func.field)),
	);
	const diagnostics = [];
	const marks = [];
	let lookup = values.length > 0 || usesJson || testing.calls;
	for (const { call, program } of sites) {
		// Parsed trees outlive a build: forget how an earlier build wrapped it.
		delete call.func._genEntry;
		for (const a of call.args ?? []) if (a) delete a._boxTypeParam;
		const fn = call.func.field;
		const prefix = PRINT_FUNCS.get(fn);
		const formatted = isFormatted(fn);
		const skip = (prefix ? 1 : 0) + (formatted ? 1 : 0);
		if (!call._multiForward) unwrapInterfaceConversions(call, skip);
		const types = operandTypes(call, skip);
		if (!types) {
			lookup = true;
			continue;
		}
		const kinds = types.map((t) => gen.classify(t, formatted));
		if (kinds.some((k) => k.lookup)) lookup = true;
		// A type parameter value is boxed by its type argument (JS backend).
		if (!call._multiForward)
			types.forEach((t, i) => {
				if (t?.kind === "typeParam") call.args[skip + i]._boxTypeParam = true;
			});
		if (!kinds.some((k) => k.wrap || k.lookup) && !call._multiForward) continue;
		const exact = Boolean(call._multiForward);
		let prefixType = prefix;
		if (exact && prefix) {
			const t = defaultType(call.args[0]._type.types[0]);
			prefixType = gen.spellable(t) ? gen.spell(t) : null;
		}
		const name =
			exact && prefix && !prefixType
				? null
				: gen.wrapper(fn, prefixType, types, kinds, exact);
		if (!name) {
			diagnostics.push({
				program,
				node: call.func.expr,
				message:
					"passing multiple return values to a variadic function is not supported in wasm packages; assign them to variables first",
			});
			continue;
		}
		marks.push({ call, name, kinds, skip, types, exact });
	}
	if (lookup) gen.needsLookup = true;
	gen.drain();
	if (gen.needsLookup) gen.genLookup();
	gen.drain();
	if (gen.out.length === 0 && diagnostics.length === 0) return null;
	for (const mark of marks) markCall(mark.call, mark);
	const ensure = gen.needsLookup ? `\n\t${gen.prefix}ensure()` : "";
	const source = gen.out.join("\n\n").replaceAll(ENSURE, ensure);
	const body = source.replaceAll(
		KEY,
		JSON.stringify(`${pkgName}:${hash(source)}`),
	);
	const imports = new Set(gen.uses);
	if (
		body.includes("fmt.Sprint") ||
		body.includes("fmt.Print") ||
		body.includes("fmt.Fprint") ||
		body.includes("fmt.Append") ||
		body.includes("fmt.Errorf")
	)
		imports.add(FMT_PATH);
	if (body.includes("fmtrt.")) imports.add(RT_PATH);
	for (const p of importsFor(qualifiers)) imports.add(p);
	return { body, imports: [...imports], diagnostics };
}
