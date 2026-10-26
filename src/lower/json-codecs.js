// src/lower/json-codecs.js
// encoding/json for wasm packages: per-type codecs generated as Go source.
//
// The WASM backend has no reflection, so every `json.Marshal` and
// `json.Unmarshal` call site gets codecs generated from the checked types.
// The generated functions are ordinary Go that calls internal/jsonrt (the
// scanner, the encoder state and the decoder state); they are parsed and
// checked as one extra file of the package and linked into app.wasm, never
// emitted as JS.  JSON field rules come from the checker's resolveJsonFields,
// which the JS backend uses too, so the two backends cannot drift.
//
// A call site whose argument has a concrete type gets an entry point for that
// type.  A call site with an interface-typed argument gets the dynamic entry,
// which switches over every type the program encodes or decodes anywhere.

import { resolveJsonFields } from "../typechecker/resolve.js";
import { defaultType } from "../typechecker/types.js";
import { forEachChild } from "./walk.js";

const JSON_PATH = "encoding/json";
const SITE_FUNCS = new Set(["Marshal", "MarshalIndent", "Unmarshal", "Valid"]);

const INT_KINDS = new Set(["int", "int8", "int16", "int32", "int64"]);
const UINT_KINDS = new Set([
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
]);
const FLOAT_KINDS = new Set(["float32", "float64"]);
const INT_BITS = {
	int: 64,
	int8: 8,
	int16: 16,
	int32: 32,
	int64: 64,
	uint: 64,
	uint8: 8,
	uint16: 16,
	uint32: 32,
	uint64: 64,
	uintptr: 64,
};
const ALIAS = { byte: "uint8", rune: "int32" };
const REFLECT_NAME = { any: "interface {}" };
// The types the dynamic entry always handles: what decoding into `any` yields
// plus the other basic kinds a program may store in an interface.
const DYNAMIC_BASICS = [
	"bool",
	"string",
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"float32",
	"float64",
];

const unalias = (n) => ALIAS[n] ?? n;
const q = (s) => JSON.stringify(s);

function under(t) {
	return t?.kind === "named" ? under(t.underlying) : t;
}

function isBasic(t, set) {
	const u = under(t);
	return u?.kind === "basic" && set.has(unalias(u.name));
}

const isRaw = (t) =>
	t?.kind === "named" &&
	(t.name === "json.RawMessage" || t.name === "encoding/json.RawMessage");

const isNumber = (t) =>
	t?.kind === "named" &&
	(t.name === "json.Number" ||
		t.name === "encoding/json.Number" ||
		t.name?.startsWith("Number$$") ||
		t.name?.endsWith(".Number") ||
		(t.name === "Number" && under(t)?.name === "string"));

function isBytes(t) {
	const u = under(t);
	return (
		u?.kind === "slice" && !isRaw(t) && unalias(under(u.elem)?.name) === "uint8"
	);
}

const isEmptyIface = (t) =>
	(t?.kind === "basic" && t.name === "any") ||
	(under(t)?.kind === "interface" && under(t).methods?.size === 0);

const isNilType = (t) =>
	t?.kind === "nil" || (t?.kind === "basic" && t.name === "nil");

const isInterface = (t) =>
	isNilType(t) ||
	isEmptyIface(t) ||
	(t?.kind !== "basic" && under(t)?.kind === "interface");

function methodOf(t, name) {
	if (t?.kind !== "named") return null;
	return t.methods?.get(name) ?? t.underlying?.methods?.get(name) ?? null;
}

// A method's results; a multi-value result is one tuple type.
function results(m) {
	const r = (m.returns ?? []).filter(
		(t) => !(t?.kind === "basic" && t.name === "void"),
	);
	return r.length === 1 && r[0]?.kind === "tuple" ? r[0].types : r;
}

// MarshalJSON() ([]byte, error)
function marshalerOf(t) {
	if (isRaw(t)) return null;
	const m = methodOf(t, "MarshalJSON");
	if (m?.params?.length !== 0 || results(m).length !== 2) return null;
	return m;
}

// UnmarshalJSON([]byte) error
function unmarshalerOf(t) {
	if (isRaw(t)) return null;
	const m = methodOf(t, "UnmarshalJSON");
	if (m?.params?.length !== 1 || results(m).length !== 1) return null;
	return m;
}

function isSimpleKey(s) {
	return /^[A-Za-z0-9_ .-]*$/.test(s);
}

export class JsonCodecGen {
	constructor(checker, pkgName, qualifiers, programs = []) {
		this.programs = programs;
		this.checker = checker;
		this.pkgName = pkgName;
		this.qualifiers = qualifiers;
		this.prefix = `gfj_${String(pkgName).replace(/[^A-Za-z0-9_]/g, "_")}_`;
		this.enc = new Map(); // key -> { name, t, addr }
		this.dec = new Map();
		this.queue = [];
		this.out = [];
		this.entries = [];
		this.dynamic = false;
		this.dynamicDone = false;
		this.decTargets = [];
		this.counter = 0;
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
		};
		return (byKind[t.kind] ?? (() => `?${t.kind}`))();
	}

	structKey(t) {
		const fields = (t._structFields ?? []).map(
			(f) =>
				`${(f.names ?? []).join(",")}:${this.key(f.type)}:${f.tag ?? ""}:${f.embedded ? 1 : 0}`,
		);
		return `struct{${fields.join(";")}}`;
	}

	// Go source for the type.
	spell(t) {
		const sp = (x) => this.spell(x);
		const byKind = {
			basic: () => t.name,
			named: () => this.spellNamed(t),
			pointer: () => `*${sp(t.base)}`,
			slice: () => `[]${sp(t.elem)}`,
			array: () => `[${t.size}]${sp(t.elem)}`,
			map: () => `map[${sp(t.key)}]${sp(t.value)}`,
			struct: () => this.spellStruct(t),
			interface: () => "any",
			func: () => this.funcString(t, sp),
		};
		if (!byKind[t.kind])
			throw new Error(`json: cannot spell type kind ${t.kind}`);
		return byKind[t.kind]();
	}

	resolveImportAlias(modPath) {
		for (const p of this.programs) {
			for (const imp of p.imports ?? []) {
				for (const spec of imp.imports) {
					if (spec.path === modPath) {
						return spec.alias ?? spec.path.split("/").pop();
					}
				}
			}
		}
		return modPath.split("/").pop();
	}

	spellNamed(t) {
		let name = t.name;
		const at = name.indexOf("$$");
		if (at >= 0) {
			const orig = name.slice(0, at);
			const modPath = name.slice(at + 2).replaceAll("$", "/");
			const alias = this.resolveImportAlias(modPath);
			this.qualifiers.add(alias);
			name = `${alias}.${orig}`;
		}
		const base = this.qualified(name);
		return t.typeArgs?.length
			? `${base}[${t.typeArgs.map((a) => this.spell(a)).join(", ")}]`
			: base;
	}

	spellStruct(t) {
		const fields = (t._structFields ?? []).map((f) => {
			const tag = f.tag ? ` \`${f.tag}\`` : "";
			if (f.embedded) return `${this.spell(f.type)}${tag}`;
			return `${f.names.join(", ")} ${this.spell(f.type)}${tag}`;
		});
		return `struct { ${fields.join("; ")} }`;
	}

	qualified(name) {
		const dot = name.indexOf(".");
		if (dot > 0) this.qualifiers.add(name.slice(0, dot));
		return name;
	}

	// reflect's Type.String() of the type, for error messages.
	refl(t) {
		switch (t.kind) {
			case "basic":
				return REFLECT_NAME[t.name] ?? unalias(t.name);
			case "named": {
				let name = t.name;
				const at = name.indexOf("$$");
				if (at >= 0) {
					const orig = name.slice(0, at);
					const modPath = name.slice(at + 2).replaceAll("$", "/");
					name = `${modPath}.${orig}`;
				} else if (!name.includes(".")) {
					name = `${this.pkgName}.${name}`;
				}
				return t.typeArgs?.length
					? `${name}[${t.typeArgs.map((a) => this.refl(a)).join(",")}]`
					: name;
			}
			case "pointer":
				return `*${this.refl(t.base)}`;
			case "slice":
				return `[]${this.refl(t.elem)}`;
			case "array":
				return `[${t.size}]${this.refl(t.elem)}`;
			case "map":
				return `map[${this.refl(t.key)}]${this.refl(t.value)}`;
			case "interface":
				return "interface {}";
			case "func":
				return this.funcString(t, (x) => this.refl(x));
			default:
				return "struct {}";
		}
	}

	funcString(t, name) {
		const rs = results(t);
		const res =
			rs.length === 0
				? ""
				: rs.length === 1
					? ` ${name(rs[0])}`
					: ` (${rs.map(name).join(", ")})`;
		return `func(${t.params.map(name).join(", ")})${res}`;
	}

	// A struct's own name in decode errors.
	shortName(t) {
		return t?.kind === "named" ? t.name.split(".").pop() : "";
	}

	// ── Encoders ────────────────────────────────────────────────

	// True when encoding an addressable `t` differs from a plain value: it, or
	// a value field inside it, has a pointer-receiver MarshalJSON.
	needsAddr(t, seen = new Set()) {
		if (!t || seen.has(t)) return false;
		seen.add(t);
		const m = marshalerOf(t);
		if (m) return Boolean(m._ptrRecv);
		const u = under(t);
		if (u?.kind === "struct")
			return resolveJsonFields(u).some((f) => this.needsAddr(f.type, seen));
		if (u?.kind === "array") return this.needsAddr(u.elem, seen);
		return false;
	}

	encFn(t, addr = false) {
		const a = addr && this.needsAddr(t);
		const key = this.key(t) + (a ? "&" : "");
		let e = this.enc.get(key);
		if (!e) {
			e = { name: `${this.prefix}e${this.counter++}`, t, addr: a };
			this.enc.set(key, e);
			this.queue.push(() => this.genEnc(e));
		}
		return e.name;
	}

	flagDynamic() {
		this.dynamic = true;
	}

	genEnc({ name, t, addr }) {
		const body = this.encBody(t, addr).map((l) => `\t${l}`);
		this.out.push(
			`func ${name}(e *jsonrt.Enc, v ${this.spell(t)}) {\n${body.join("\n")}\n}`,
		);
	}

	// Statements that encode the Go expression `x` of type `t`.
	encValue(t, x, addr) {
		return [`${this.encFn(t, addr)}(e, ${x})`];
	}

	marshalCall(x, t) {
		return [
			`out, err := ${x}.MarshalJSON()`,
			`e.Marshaled(out, err, ${q(this.refl(t))})`,
		];
	}

	// Raw messages, marshalers, byte slices and interfaces encode specially.
	encSpecial(t, addr) {
		if (isRaw(t)) return ["e.Raw([]byte(v))"];
		if (isNumber(t)) return ["e.Number(string(v))"];
		const m = marshalerOf(t);
		if (m && (!m._ptrRecv || addr)) return this.marshalCall("v", t);
		if (isBytes(t)) return ["e.Bytes([]byte(v))"];
		if (isInterface(t)) {
			this.flagDynamic();
			return [`${this.prefix}encAny(e, v)`];
		}
		return null;
	}

	encBody(t, addr) {
		const special = this.encSpecial(t, addr);
		if (special) return special;
		const u = under(t);
		if (u.kind === "basic") return this.encScalar(t, "v");
		const byKind = {
			pointer: () => this.encPointer(t, u),
			slice: () => this.encSlice(u),
			array: () => this.encArray(u, addr),
			map: () => this.encMap(u),
			struct: () => this.encStruct(u, addr),
		};
		if (byKind[u.kind]) return byKind[u.kind]();
		return ["_ = v", `e.FailType(${q(this.refl(t))})`];
	}

	encPointer(t, u) {
		const lines = ["if v == nil {", "\te.Null()", "\treturn", "}"];
		if (marshalerOf(u.base)) lines.push(...this.marshalCall("v", t));
		else lines.push(...this.encValue(u.base, "*v", true));
		return lines;
	}

	encSlice(u) {
		return [
			"if v == nil {",
			"\te.Null()",
			"\treturn",
			"}",
			"e.Byte('[')",
			"for i := 0; i < len(v); i++ {",
			"\tif i > 0 {",
			"\t\te.Byte(',')",
			"\t}",
			...this.encValue(u.elem, "v[i]", true).map((l) => `\t${l}`),
			"}",
			"e.Byte(']')",
		];
	}

	encArray(u, addr) {
		return [
			"e.Byte('[')",
			`for i := 0; i < ${u.size}; i++ {`,
			"\tif i > 0 {",
			"\t\te.Byte(',')",
			"\t}",
			...this.encValue(u.elem, "v[i]", addr).map((l) => `\t${l}`),
			"}",
			"e.Byte(']')",
		];
	}

	// Scalars encode their value; `x` has type `t` (basic underlying).
	encScalar(t, x) {
		const u = under(t);
		const n = unalias(u.name);
		if (n === "bool") return [`e.Bool(bool(${x}))`];
		if (n === "string") return [`e.Str(string(${x}))`];
		if (INT_KINDS.has(n)) return [`e.Int(int64(${x}))`];
		if (UINT_KINDS.has(n)) return [`e.Uint(uint64(${x}))`];
		if (n === "float32") return [`e.Float(float64(${x}), 32)`];
		if (n === "float64") return [`e.Float(float64(${x}), 64)`];
		return [`_ = ${x}`, `e.FailType(${q(this.refl(t))})`];
	}

	encMap(u) {
		const kt = u.key;
		const strKey = isBasic(kt, new Set(["string"]));
		const intKey = isBasic(kt, INT_KINDS);
		const uintKey = isBasic(kt, UINT_KINDS);
		if (!strKey && !intKey && !uintKey) {
			return ["_ = v", `e.FailType(${q(this.refl(u))})`];
		}
		const conv = strKey
			? "string(k)"
			: intKey
				? "jsonrt.IntKey(int64(k))"
				: "jsonrt.UintKey(uint64(k))";
		return [
			"if v == nil {",
			"\te.Null()",
			"\treturn",
			"}",
			"keys := make([]string, 0, len(v))",
			`vals := make(map[string]${this.spell(u.value)}, len(v))`,
			"for k, x := range v {",
			`\tks := ${conv}`,
			"\tkeys = append(keys, ks)",
			"\tvals[ks] = x",
			"}",
			"jsonrt.SortStrings(keys)",
			"e.Byte('{')",
			"for i, k := range keys {",
			"\te.KeyStr(i, k)",
			...this.encValue(u.value, "vals[k]", false).map((l) => `\t${l}`),
			"}",
			"e.Byte('}')",
		];
	}

	// The expression for "x has its zero value" under omitempty.
	emptyExpr(t, x) {
		const u = under(t);
		if (t.kind === "pointer" || u.kind === "pointer" || isInterface(t))
			return `${x} == nil`;
		if (u.kind === "slice" || u.kind === "map") return `len(${x}) == 0`;
		if (u.kind === "array") return u.size === 0 ? "true" : "false";
		if (u.kind === "struct") return "false";
		const n = unalias(u.name);
		if (n === "bool") return `!${x}`;
		if (n === "string") return `${x} == ""`;
		return `${x} == 0`;
	}

	quotable(f) {
		if (!f.quoted) return false;
		const t = f.type.kind === "pointer" ? f.type.base : f.type;
		if (marshalerOf(t)) return false;
		const u = under(t);
		return u?.kind === "basic" && DYNAMIC_BASICS.includes(unalias(u.name));
	}

	encQuoted(f, x) {
		const isPtr = f.type.kind === "pointer";
		const t = isPtr ? f.type.base : f.type;
		const scalar =
			unalias(under(t).name) === "string"
				? [`e.QStr(string(${isPtr ? `*${x}` : x}))`]
				: [
						"e.Byte('\"')",
						...this.encScalar(t, isPtr ? `*${x}` : x),
						"e.Byte('\"')",
					];
		if (!isPtr) return scalar;
		return [
			`if ${x} == nil {`,
			"\te.Null()",
			"} else {",
			...scalar.map((l) => `\t${l}`),
			"}",
		];
	}

	encStruct(u, addr) {
		const fields = resolveJsonFields(u);
		if (fields.length === 0) return ["_ = v", "e.Byte('{')", "e.Byte('}')"];
		const lines = ["e.Byte('{')", "n := 0"];
		for (const f of fields) {
			const path = f.path ?? [{ name: f.goName, isPtr: false }];
			const guards = [];
			let cur = "v";
			for (let i = 0; i < path.length - 1; i++) {
				cur += `.${path[i].name}`;
				if (path[i].isPtr) guards.push(`${cur} != nil`);
			}
			const access = `${cur}.${path[path.length - 1].name}`;
			const inner = [`x := ${access}`];
			const emit = [];
			const keyName = f.jsonKey;
			emit.push(
				isSimpleKey(keyName)
					? `e.Key(n, ${q(keyName)})`
					: `e.KeyStr(n, ${q(keyName)})`,
			);
			emit.push("n++");
			emit.push(
				...(this.quotable(f)
					? this.encQuoted(f, "x")
					: this.encValue(f.type, "x", addr)),
			);
			if (f.omitempty) {
				inner.push(`if !(${this.emptyExpr(f.type, "x")}) {`);
				inner.push(...emit.map((l) => `\t${l}`));
				inner.push("}");
			} else {
				inner.push(...emit);
			}
			const block = guards.length
				? [`if ${guards.join(" && ")} {`, ...inner.map((l) => `\t${l}`), "}"]
				: ["{", ...inner.map((l) => `\t${l}`), "}"];
			lines.push(...block);
		}
		lines.push("e.Byte('}')");
		return lines;
	}

	// The dynamic encoder: a type switch over every type the program encodes.
	genEncAny() {
		const cases = [];
		const seen = new Set();
		for (const [key, e] of this.enc) {
			if (e.addr || seen.has(key)) continue;
			seen.add(key);
			if (isInterface(e.t)) continue;
			cases.push(`\tcase ${this.spell(e.t)}:\n\t\t${e.name}(e, x)`);
		}
		this.out.push(
			[
				`func ${this.prefix}encAny(e *jsonrt.Enc, v any) {`,
				"\tif v == nil {",
				"\t\te.Null()",
				"\t\treturn",
				"\t}",
				"\tswitch x := v.(type) {",
				...cases,
				"\tdefault:",
				"\t\t_ = x",
				'\t\te.FailType("unsupported dynamic type")',
				"\t}",
				"}",
			].join("\n"),
		);
	}

	// ── Decoders ────────────────────────────────────────────────
	//
	// A struct decodes in place through its pointer (`func(d, p *S)`); every
	// other type is a value-style `func(d, cur T) T` that returns the decoded
	// value, because the WASM backend cannot take the address of a field or
	// element that holds a pointer.

	decInPlace(t) {
		return under(t)?.kind === "struct";
	}

	decFn(t) {
		const key = this.key(t);
		let d = this.dec.get(key);
		if (!d) {
			d = { name: `${this.prefix}d${this.counter++}`, t };
			this.dec.set(key, d);
			this.queue.push(() => this.genDec(d));
		}
		return d.name;
	}

	genDec({ name, t }) {
		const body = this.decBody(t).map((l) => `\t${l}`);
		const sp = this.spell(t);
		const sig = this.decInPlace(t)
			? `(d *jsonrt.Dec, p *${sp})`
			: `(d *jsonrt.Dec, cur ${sp}) ${sp}`;
		this.out.push(`func ${name}${sig} {\n${body.join("\n")}\n}`);
	}

	// Statements that decode a value of type `t` into the addressable
	// expression `lv`, reading from decoder `dv`.
	decInto(t, lv, dv = "d") {
		const fn = this.decFn(t);
		return this.decInPlace(t)
			? [`${fn}(${dv}, &${lv})`]
			: [`${lv} = ${fn}(${dv}, ${lv})`];
	}

	// The scalar-or-reference forms return `cur` unchanged when the value does
	// not apply (null, or a type error that was recorded).
	decBody(t) {
		const typ = q(this.refl(t));
		const special = this.decSpecial(t, typ);
		if (special) return special;
		const u = under(t);
		if (u.kind === "basic" && !isEmptyIface(t))
			return this.decScalar(t, u, typ);
		const byKind = {
			pointer: () => this.decPointer(u, typ),
			slice: () => this.decSlice(u, t, typ),
			array: () => this.decArray(u, typ),
			map: () => this.decMap(u, t, typ),
			struct: () => this.decStruct(u, t, typ),
			interface: () =>
				isEmptyIface(t)
					? ["return d.Any()"]
					: [`d.Mismatch(${typ})`, "return cur"],
			basic: () => ["return d.Any()"],
		};
		return (byKind[u.kind] ?? (() => [`d.Mismatch(${typ})`, "return cur"]))();
	}

	decSpecial(t, typ) {
		if (isRaw(t)) return [`return ${this.spell(t)}(d.Raw())`];
		if (isNumber(t))
			return [
				`s, ok := d.Number(${typ})`,
				"if !ok {",
				"\treturn cur",
				"}",
				`return ${this.spell(t)}(s)`,
			];
		if (unmarshalerOf(t)) return this.decUnmarshaler(t);
		if (isBytes(t)) return this.decBytes(t, typ);
		return null;
	}

	decUnmarshaler(t) {
		const inPlace = this.decInPlace(t);
		const recv = inPlace ? "p" : "x";
		const call = [
			"raw := d.Raw()",
			`if err := ${recv}.UnmarshalJSON(raw); err != nil {`,
			"\td.Fatal(err)",
			"}",
		];
		return inPlace ? call : ["x := cur", ...call, "return x"];
	}

	decBytes(t, typ) {
		return [
			"if d.Null() {",
			"\treturn nil",
			"}",
			"if d.IsArray() {",
			...this.decElems(under(t), t, typ),
			"}",
			`if b, ok := d.Bytes(${typ}); ok {`,
			`\treturn ${this.spell(t)}(b)`,
			"}",
			"return cur",
		];
	}

	decScalar(t, u, typ) {
		const n = unalias(u.name);
		const sp = this.spell(t);
		let call;
		if (n === "bool") call = `d.Bool(${typ})`;
		else if (n === "string") call = `d.String(${typ})`;
		else if (INT_KINDS.has(n)) call = `d.Int(${INT_BITS[n]}, ${typ})`;
		else if (UINT_KINDS.has(n)) call = `d.Uint(${INT_BITS[n]}, ${typ})`;
		else if (FLOAT_KINDS.has(n))
			call = `d.Float(${n === "float32" ? 32 : 64}, ${typ})`;
		else return [`d.Mismatch(${typ})`, "return cur"];
		return [
			`if v, ok := ${call}; ok {`,
			`\treturn ${sp}(v)`,
			"}",
			"return cur",
		];
	}

	decPointer(u, typ) {
		const base = u.base;
		const lines = [
			"if d.Null() {",
			"\treturn nil",
			"}",
			"if cur == nil {",
			`\tcur = new(${this.spell(base)})`,
			"}",
		];
		if (under(base)?.kind === "pointer") {
			lines.push(`d.Mismatch(${typ})`);
		} else if (this.decInPlace(base)) {
			lines.push(`${this.decFn(base)}(d, cur)`);
		} else {
			lines.push(`*cur = ${this.decFn(base)}(d, *cur)`);
		}
		lines.push("return cur");
		return lines;
	}

	// Decodes the elements of the array at the cursor into a new slice `s`.
	decElems(u, t, typ) {
		return [
			`if !d.ArrBegin(${typ}) {`,
			"\treturn cur",
			"}",
			`s := make(${this.spell(t)}, 0)`,
			"for d.NextElem() {",
			`\tvar x ${this.spell(u.elem)}`,
			...this.decInto(u.elem, "x").map((l) => `\t${l}`),
			"\ts = append(s, x)",
			"}",
			"return s",
		];
	}

	decSlice(u, t, typ) {
		return ["if d.Null() {", "\treturn nil", "}", ...this.decElems(u, t, typ)];
	}

	decArray(u, typ) {
		return [
			"if d.Null() {",
			"\treturn cur",
			"}",
			`if !d.ArrBegin(${typ}) {`,
			"\treturn cur",
			"}",
			"i := 0",
			"for d.NextElem() {",
			`\tif i < ${u.size} {`,
			...this.decInto(u.elem, "cur[i]").map((l) => `\t\t${l}`),
			"\t} else {",
			"\t\td.Skip()",
			"\t}",
			"\ti++",
			"}",
			`for ; i < ${u.size}; i++ {`,
			`\tvar zero ${this.spell(u.elem)}`,
			"\tcur[i] = zero",
			"}",
			"return cur",
		];
	}

	decMap(u, t, typ) {
		const kt = u.key;
		const strKey = isBasic(kt, new Set(["string"]));
		const intKey = isBasic(kt, INT_KINDS);
		const uintKey = isBasic(kt, UINT_KINDS);
		if (!strKey && !intKey && !uintKey)
			return [`d.Mismatch(${typ})`, "return cur"];
		const ks = this.spell(kt);
		let keyLines;
		if (strKey) {
			keyLines = [`k := ${ks}(d.Key())`];
		} else {
			const n = unalias(under(kt).name);
			keyLines = [
				`kv, ok := d.KeyInt(${INT_BITS[n]}, ${intKey}, ${q(this.refl(kt))})`,
				"if !ok {",
				"\td.Skip()",
				"\tcontinue",
				"}",
				`k := ${ks}(kv)`,
			];
		}
		return [
			"if d.Null() {",
			"\treturn nil",
			"}",
			`if !d.ObjBegin(${typ}) {`,
			"\treturn cur",
			"}",
			"m := cur",
			"if m == nil {",
			`\tm = make(${this.spell(t)})`,
			"}",
			"for d.NextKey() {",
			...keyLines.map((l) => `\t${l}`),
			`\tvar x ${this.spell(u.value)}`,
			...this.decInto(u.value, "x").map((l) => `\t${l}`),
			"\tm[k] = x",
			"}",
			"return m",
		];
	}

	decStruct(u, t, typ) {
		const fields = resolveJsonFields(u);
		const sname = this.shortName(t);
		const lines = [
			"if d.Null() {",
			"\treturn",
			"}",
			`if !d.ObjBegin(${typ}) {`,
			"\treturn",
			"}",
			"for d.NextKey() {",
		];
		if (fields.length === 0) {
			lines.push(
				"\tif d.DisallowUnknownFields {",
				"\t\td.UnknownField(d.Key())",
				"\t} else {",
				"\t\td.Skip()",
				"\t}",
				"}",
			);
			return lines;
		}
		lines.push("\tk := d.Key()", "\ti := -1", "\tswitch k {");
		fields.forEach((f, i) => {
			lines.push(`\tcase ${q(f.jsonKey)}:`, `\t\ti = ${i}`);
		});
		lines.push("\tdefault:");
		fields.forEach((f, i) => {
			lines.push(
				`\t\t${i > 0 ? "} else " : ""}if jsonrt.EqualFold(k, ${q(f.jsonKey)}) {`,
				`\t\t\ti = ${i}`,
			);
		});
		lines.push("\t\t}", "\t}", "\tswitch i {");
		fields.forEach((f, i) => {
			lines.push(`\tcase ${i}:`);
			lines.push(`\t\td.Enter(${q(sname)}, ${q(f.jsonKey)})`);
			lines.push(...this.decFieldLines(u, f).map((l) => `\t\t${l}`));
			lines.push("\t\td.Leave()");
		});
		lines.push(
			"\tdefault:",
			"\t\tif d.DisallowUnknownFields {",
			"\t\t\td.UnknownField(k)",
			"\t\t} else {",
			"\t\t\td.Skip()",
			"\t\t}",
			"\t}",
			"}",
		);
		return lines;
	}

	// Allocates the embedded pointers on the path to the field, then decodes it.
	decFieldLines(u, f) {
		const path = f.path ?? [{ name: f.goName, isPtr: false }];
		const lines = [];
		let cur = "p";
		for (let j = 0; j < path.length - 1; j++) {
			cur += `.${path[j].name}`;
			if (!path[j].isPtr) continue;
			const segType = this.embedType(u, path.slice(0, j + 1));
			lines.push(
				`if ${cur} == nil {`,
				`\t${cur} = new(${this.spell(segType)})`,
				"}",
			);
		}
		lines.push(...this.decField(f, `${cur}.${path[path.length - 1].name}`));
		return lines;
	}

	// The base type of the embedded pointer reached by `path`.
	embedType(u, path) {
		let cur = u;
		let ty = null;
		for (const seg of path) {
			const fl = (cur._structFields ?? []).find(
				(f) => f.embedded && this.embeddedName(f) === seg.name,
			);
			ty = fl.type.kind === "pointer" ? fl.type.base : fl.type;
			cur = under(ty);
		}
		return ty;
	}

	embeddedName(f) {
		const t = f.type.kind === "pointer" ? f.type.base : f.type;
		return (f.astType?.name ?? f.astType?.base?.name ?? t.name ?? "")
			.split(".")
			.pop();
	}

	decField(f, lv) {
		if (!this.quotable(f)) return this.decInto(f.type, lv);
		const t = f.type.kind === "pointer" ? f.type.base : f.type;
		const un = unalias(under(t).name);
		const kind = un === "string" ? "string" : un === "bool" ? "bool" : "number";
		return [
			`if sub := d.Unquote(${q(this.refl(t))}, ${q(kind)}); sub != nil {`,
			...this.decInto(f.type, lv, "sub").map((l) => `\t${l}`),
			"\td.Merge(sub)",
			"}",
		];
	}

	// ── Entry points ────────────────────────────────────────────

	entryMarshal(argType) {
		const name = `${this.prefix}marshal${this.entries.length}`;
		const lines = [
			`func ${name}(v any) ([]byte, error) {`,
			"\te := jsonrt.NewEnc()",
		];
		if (!argType || isInterface(argType)) {
			this.flagDynamic();
			lines.push(`\t${this.prefix}encAny(e, v)`);
		} else {
			lines.push(
				`\tx, _ := v.(${this.spell(argType)})`,
				`\t${this.encFn(argType, false)}(e, x)`,
			);
		}
		lines.push("\tb, err := e.Result()", "\treturn b, err", "}");
		this.entries.push(lines.join("\n"));
		return name;
	}

	// Statements that decode into the pointer `x` of pointer type `pt`.
	rootDecode(pt, x) {
		const base = pt.base;
		return this.decInPlace(base)
			? [`${this.decFn(base)}(d, ${x})`]
			: [`*${x} = ${this.decFn(base)}(d, *${x})`];
	}

	entryMarshalIndent(argType) {
		const name = `${this.prefix}marshal_indent${this.entries.length}`;
		const lines = [
			`func ${name}(v any, prefix, indent string) ([]byte, error) {`,
			"\te := jsonrt.NewEnc()",
		];
		if (!argType || isInterface(argType)) {
			this.flagDynamic();
			lines.push(`\t${this.prefix}encAny(e, v)`);
		} else {
			lines.push(
				`\tx, _ := v.(${this.spell(argType)})`,
				`\t${this.encFn(argType, false)}(e, x)`,
			);
		}
		lines.push(
			"\tb, err := e.Result()",
			"\tif err != nil {",
			"\t\treturn nil, err",
			"\t}",
			"\treturn jsonrt.AppendIndent(nil, b, prefix, indent)",
			"}",
		);
		this.entries.push(lines.join("\n"));
		return name;
	}

	entryUnmarshal(argType) {
		const name = `${this.prefix}unmarshal${this.entries.length}`;
		const lines = [
			`func ${name}(data []byte, v any) error {`,
			"\td, err := jsonrt.NewDec(data)",
			"\tif err != nil {",
			"\t\treturn err",
			"\t}",
		];
		if (argType?.kind === "pointer" && !isInterface(argType)) {
			this.decTargets.push(argType);
			lines.push(
				`\tp, _ := v.(${this.spell(argType)})`,
				"\tif p == nil {",
				`\t\treturn &jsonrt.InvalidUnmarshalError{Type: ${q(this.refl(argType))}, IsPtr: true}`,
				"\t}",
				...this.rootDecode(argType, "p").map((l) => `\t${l}`),
				"\treturn d.Done()",
			);
		} else if (!argType || isInterface(argType)) {
			lines.push(`\treturn ${this.prefix}decAny(d, v)`);
			this.dynamicDecode = true;
		} else {
			lines.push(
				"\t_ = d",
				"\t_ = v",
				`\treturn &jsonrt.InvalidUnmarshalError{Type: ${q(this.refl(argType))}}`,
			);
		}
		lines.push("}");
		this.entries.push(lines.join("\n"));
		return name;
	}

	entryValid() {
		const name = `${this.prefix}valid${this.entries.length}`;
		this.entries.push(
			`func ${name}(data []byte) bool {\n\treturn jsonrt.Valid(data)\n}`,
		);
		return name;
	}

	entryEncode(argType) {
		this.qualified("json.Encoder");
		const name = `${this.prefix}encode${this.entries.length}`;
		const lines = [
			`func ${name}(enc *json.Encoder, v any) error {`,
			"\tif enc.Err() != nil {",
			"\t\treturn enc.Err()",
			"\t}",
			"\te := jsonrt.NewEnc()",
			"\te.EscapeHTML = enc.EscapeHTML()",
		];
		if (!argType || isInterface(argType)) {
			this.flagDynamic();
			lines.push(`\t${this.prefix}encAny(e, v)`);
		} else {
			lines.push(
				`\tx, _ := v.(${this.spell(argType)})`,
				`\t${this.encFn(argType, false)}(e, x)`,
			);
		}
		lines.push(
			"\tb, err := e.Result()",
			"\tif err != nil {",
			"\t\treturn err",
			"\t}",
			"\treturn enc.EncodeRaw(b)",
			"}",
		);
		this.entries.push(lines.join("\n"));
		return name;
	}

	entryDecode(argType) {
		this.qualified("json.Decoder");
		const name = `${this.prefix}decode${this.entries.length}`;
		const lines = [
			`func ${name}(dec *json.Decoder, v any) error {`,
			"\tdata, err := dec.ScanNext()",
			"\tif err != nil {",
			"\t\treturn err",
			"\t}",
			"\td, err := jsonrt.NewDec(data)",
			"\tif err != nil {",
			"\t\treturn err",
			"\t}",
			"\tdec.SetupDec(d)",
		];
		if (argType?.kind === "pointer" && !isInterface(argType)) {
			this.decTargets.push(argType);
			lines.push(
				`\tp, _ := v.(${this.spell(argType)})`,
				"\tif p == nil {",
				`\t\treturn &jsonrt.InvalidUnmarshalError{Type: ${q(this.refl(argType))}, IsPtr: true}`,
				"\t}",
				...this.rootDecode(argType, "p").map((l) => `\t${l}`),
				"\treturn d.Done()",
			);
		} else if (!argType || isInterface(argType)) {
			lines.push(`\treturn ${this.prefix}decAny(d, v)`);
			this.dynamicDecode = true;
		} else {
			lines.push(
				"\t_ = d",
				"\t_ = v",
				`\treturn &jsonrt.InvalidUnmarshalError{Type: ${q(this.refl(argType))}}`,
			);
		}
		lines.push("}");
		this.entries.push(lines.join("\n"));
		return name;
	}

	// The dynamic decode entry: every pointer type some call site decodes into.
	genDecAny() {
		const seen = new Set();
		const cases = [];
		const pointers = this.programTypes().filter(
			(t) =>
				t.kind === "pointer" && (isEmptyIface(t.base) || !isInterface(t.base)),
		);
		for (const pt of [...this.decTargets, ...pointers]) {
			const k = this.key(pt);
			if (seen.has(k)) continue;
			seen.add(k);
			cases.push(
				`\tcase ${this.spell(pt)}:`,
				"\t\tif x == nil {",
				`\t\t\treturn &jsonrt.InvalidUnmarshalError{Type: ${q(this.refl(pt))}, IsPtr: true}`,
				"\t\t} else {",
				...this.rootDecode(pt, "x").map((l) => `\t\t\t${l}`),
				"\t\t}",
			);
		}
		this.out.push(
			[
				`func ${this.prefix}decAny(d *jsonrt.Dec, v any) error {`,
				"\tswitch x := v.(type) {",
				...cases,
				"\tdefault:",
				"\t\t_ = x",
				"\t\treturn jsonrt.InvalidUnmarshal(v)",
				"\t}",
				"\treturn d.Done()",
				"}",
			].join("\n"),
		);
	}

	// Registers what the dynamic encoder handles, until nothing new appears.
	addDynamicTypes() {
		for (const n of DYNAMIC_BASICS) this.encFn({ kind: "basic", name: n });
		const anyT = { kind: "basic", name: "any" };
		this.encFn({ kind: "slice", elem: anyT });
		this.encFn({
			kind: "map",
			key: { kind: "basic", name: "string" },
			value: anyT,
		});
		for (const t of this.programTypes()) {
			this.encFn(t, false);
		}
		for (const [name, t] of this.checker.types) {
			if (t?.kind !== "named" || name.includes(".") || name.includes("$$"))
				continue;
			if (t.name !== name || t.typeArgs?.length || t._genericOf) continue;
			const u = under(t);
			if (!u || u.kind === "interface" || u.kind === "func") continue;
			this.encFn(t, false);
			this.encFn({ kind: "pointer", base: t }, false);
		}
	}

	// True when the type can be written as Go source in the generated file.
	spellable(t, depth = 0) {
		if (!t || depth > 8) return false;
		const ok = (x) => this.spellable(x, depth + 1);
		const byKind = {
			basic: () => t.name !== "void" && t.name !== "nil",
			named: () =>
				!t.name.includes("$$") &&
				!t.name.includes("[") &&
				(t.typeArgs ?? []).every(ok),
			pointer: () => ok(t.base),
			slice: () => ok(t.elem),
			array: () => ok(t.elem),
			map: () => ok(t.key) && ok(t.value),
			interface: () => true,
			struct: () => (t._structFields ?? []).every((f) => ok(f.type)),
			func: () => t.params.every(ok) && results(t).every(ok),
		};
		return byKind[t.kind]?.() ?? false;
	}

	// Types the program builds with composite literals, `&T{}`, make and new:
	// candidates for a value stored in an interface (an `any` map value, say).
	programTypes() {
		const found = new Map();
		for (const p of this.programs) {
			walkNodes(p.decls, (node) => {
				if (!buildsValue(node)) return;
				const t = defaultType(node._type);
				if (this.spellable(t) && under(t)?.kind !== "interface")
					found.set(this.key(t), t);
			});
		}
		return [...found.values()];
	}

	drain() {
		while (this.queue.length > 0) this.queue.shift()();
	}

	finish() {
		this.drain();
		while (this.dynamic && !this.dynamicDone) {
			this.dynamicDone = true;
			this.addDynamicTypes();
			this.drain();
		}
		if (this.dynamic) this.genEncAny();
		if (this.dynamicDecode) {
			this.genDecAny();
			this.drain();
		}
	}

	source(pkgName, imports) {
		const importLines = imports.map((p) => `\t${q(p)}`).join("\n");
		return [
			`package ${pkgName}`,
			"",
			`import (\n\t"internal/jsonrt"\n${importLines}\n)`,
			"",
			...this.entries,
			...this.out,
			"",
		].join("\n\n");
	}
}

// Calls every `fn(node)` for the AST nodes under `root`.
function walkNodes(root, fn) {
	if (!root || typeof root !== "object") return;
	if (Array.isArray(root)) {
		for (const n of root) walkNodes(n, fn);
		return;
	}
	fn(root);
	forEachChild(root, (c) => walkNodes(c, fn));
}

// A composite literal, `&x`, make or new: an expression that builds a value.
function buildsValue(node) {
	if (node.kind === "CompositeLit") return true;
	if (node.kind === "UnaryExpr") return node.op === "&";
	return (
		node.kind === "CallExpr" &&
		node.func?.kind === "Ident" &&
		(node.func.name === "make" || node.func.name === "new")
	);
}

// The names the file imports `encoding/json` as.
function jsonAliases(program) {
	const aliases = new Set();
	for (const imp of program.imports ?? [])
		for (const spec of imp.imports)
			if (spec.path === JSON_PATH && spec.alias !== "_")
				aliases.add(spec.alias ?? "json");
	return aliases;
}

const isJsonCall = (node, aliases) =>
	node.kind === "CallExpr" &&
	node.func?.kind === "SelectorExpr" &&
	node.func.expr?.kind === "Ident" &&
	aliases.has(node.func.expr.name) &&
	SITE_FUNCS.has(node.func.field);

function isStreamCall(node) {
	if (node.kind !== "CallExpr" || node.func?.kind !== "SelectorExpr")
		return null;
	const recvType = node.func.expr?._type;
	const recvName = recvType?.name ?? recvType?.base?.name ?? "";
	const isEnc =
		recvName === "json.Encoder" ||
		recvName === "encoding/json.Encoder" ||
		recvName.startsWith("Encoder$$");
	if (isEnc && node.func.field === "Encode") return "Encode";
	const isDec =
		recvName === "json.Decoder" ||
		recvName === "encoding/json.Decoder" ||
		recvName.startsWith("Decoder$$");
	if (isDec && node.func.field === "Decode") return "Decode";
	return null;
}

// Finds `json.Marshal/Unmarshal/Valid` call sites in the checked programs.
function findSites(programs) {
	const sites = [];
	for (const p of programs) {
		const aliases = jsonAliases(p);
		walkNodes(p.decls, (node) => {
			if (isJsonCall(node, aliases)) {
				sites.push({ call: node, fn: node.func.field, program: p });
			} else {
				const streamFn = isStreamCall(node);
				if (streamFn) sites.push({ call: node, fn: streamFn, program: p });
			}
		});
	}
	return sites;
}

function selectCodecEntry(gen, fn, argType) {
	if (fn === "Marshal") return gen.entryMarshal(argType(0));
	if (fn === "MarshalIndent") return gen.entryMarshalIndent(argType(0));
	if (fn === "Unmarshal") return gen.entryUnmarshal(argType(1));
	if (fn === "Encode") return gen.entryEncode(argType(0));
	if (fn === "Decode") return gen.entryDecode(argType(0));
	return gen.entryValid();
}

// Generates the codec file for a package's `json` call sites.  Returns null
// when it has none; otherwise { source, imports } and marks each call's
// SelectorExpr with `_jsonGen`, the entry point the WASM link calls instead.
export function generateJsonCodecs(programs, checker, pkgName) {
	const sites = findSites(programs);
	if (sites.length === 0) return null;
	const qualifiers = new Set();
	const gen = new JsonCodecGen(checker, pkgName, qualifiers, programs);
	const pending = [];
	const diagnostics = [];
	for (const { call, fn, program } of sites) {
		const argType = (i) => defaultType(call.args[i]?._type);
		if (fn === "Unmarshal" && argType(1)?.base?.kind === "pointer")
			diagnostics.push({
				program,
				node: call.func.expr,
				message:
					"json.Unmarshal into a pointer to a pointer is not yet available in wasm packages",
				hint: "declare the value and pass its address, or pass the pointer itself",
			});
		const entry = selectCodecEntry(gen, fn, argType);
		pending.push([call.func, entry, fn === "Encode" || fn === "Decode"]);
	}
	gen.finish();
	for (const [sel, entry, isStream] of pending) {
		sel._jsonGen = entry;
		if (isStream) sel._jsonStream = true;
	}
	const importPaths = new Map();
	for (const p of programs)
		for (const imp of p.imports ?? [])
			for (const spec of imp.imports) {
				const last = spec.path.split("/").pop();
				importPaths.set(spec.alias ?? last, spec.path);
			}
	const imports = [...qualifiers]
		.map((qn) => importPaths.get(qn))
		.filter(Boolean);
	return { source: gen.source(pkgName, imports), diagnostics };
}
