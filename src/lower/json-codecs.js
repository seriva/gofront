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
import { defaultType, LOCAL_TYPE_SUFFIX } from "../typechecker/types.js";
import {
	collectProgramTypes,
	hasSharedRepr,
	importsFor,
	isEmptyIface,
	mentionsTypeParam,
	results,
	SHARED_REPR,
	TypeSpeller,
	under,
	walkNodes,
} from "./gen-types.js";

const JSON_PATH = "encoding/json";
const SITE_FUNCS = new Set(["Marshal", "MarshalIndent", "Unmarshal"]);

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

function isBasic(t, set) {
	const u = under(t);
	return u?.kind === "basic" && set.has(unalias(u.name));
}

const isRaw = (t) =>
	t?.kind === "named" && t.name === "RawMessage$$encoding$json";

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

// MarshalJSON() ([]byte, error)
function marshalerOf(t) {
	if (isRaw(t)) return null;
	const m = methodOf(t, "MarshalJSON");
	if (m?.params?.length !== 0 || results(m).length !== 2) return null;
	return m;
}

// MarshalText() ([]byte, error), used when the type has no MarshalJSON.
function textMarshalerOf(t) {
	if (isRaw(t) || marshalerOf(t)) return null;
	const m = methodOf(t, "MarshalText");
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

const isNamedOrPointer = (t) =>
	t.kind === "named" || (t.kind === "pointer" && t.base?.kind === "named");

export class JsonCodecGen extends TypeSpeller {
	constructor(checker, pkgName, qualifiers, programs = []) {
		super(pkgName, qualifiers, programs);
		this.checker = checker;
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
			func: () => this.funcString(t, k),
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

	// reflect's Type.String() of the type, for error messages.
	refl(t) {
		switch (t.kind) {
			case "basic":
				return REFLECT_NAME[t.name] ?? unalias(t.name);
			case "named": {
				let name = t.name.replace(LOCAL_TYPE_SUFFIX, "");
				const at = name.indexOf("$$");
				if (at >= 0) {
					const orig = name.slice(0, at);
					const modPath = name.slice(at + 2).replaceAll("$", "/");
					name = `${modPath}.${orig}`;
				} else if (!name.includes(".")) {
					name = `${this.declaringPackage(t)}.${name}`;
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
				return t.name === "error" ? "error" : "interface {}";
			case "func":
				return this.funcString(t, (x) => this.refl(x));
			default:
				return "struct {}";
		}
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
		const m = marshalerOf(t) ?? textMarshalerOf(t);
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

	// `mt` is the type that declares the method (the pointee for a pointer).
	marshalCall(x, t, mt = t) {
		if (!marshalerOf(mt) && textMarshalerOf(mt))
			return [
				`out, err := ${x}.MarshalText()`,
				`e.TextMarshaled(out, err, ${q(this.refl(t))})`,
			];
		return [
			`out, err := ${x}.MarshalJSON()`,
			`e.Marshaled(out, err, ${q(this.refl(t))})`,
		];
	}

	// Raw messages, marshalers, byte slices and interfaces encode specially.
	encSpecial(t, addr) {
		if (isRaw(t)) return ["e.Raw([]byte(v))"];
		if (isNumber(t)) return ["e.Number(string(v))"];
		const m = marshalerOf(t) ?? textMarshalerOf(t);
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
		if (marshalerOf(u.base) || textMarshalerOf(u.base))
			lines.push(...this.marshalCall("v", t, u.base));
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
		const f32 = this.enc.get("float32")?.name;
		for (const [key, e] of this.enc) {
			if (e.addr || seen.has(key)) continue;
			seen.add(key);
			if (isInterface(e.t)) continue;
			// A package that only lends its encoder knows its named types.
			if (this.registerOnly && !isNamedOrPointer(e.t)) continue;
			// Where one run-time shape serves both float sizes, a float64 that a
			// float32 holds exactly encodes as the float32 it most likely is.
			const body =
				f32 && e.t.kind === "basic" && e.t.name === "float64"
					? `\t\tif jsonrt.LooksFloat32(x) {\n\t\t\t${f32}(e, float32(x))\n\t\t} else {\n\t\t\t${e.name}(e, x)\n\t\t}`
					: `\t\t${e.name}(e, x)`;
			cases.push({
				t: e.t,
				src: `\tcase ${this.spell(e.t)}:\n${body}\n\t\treturn true`,
			});
		}
		// JS numbers do not tell an int from a float64 or float32: whole numbers
		// take the int cases, then float64, then float32.
		const rank = ({ t }) =>
			t.name === "float64" ? 1 : t.name === "float32" ? 2 : 0;
		cases.sort((a, b) => rank(a) - rank(b));
		const known = `${this.prefix}encKnown`;
		this.out.push(
			[
				`func ${known}(e *jsonrt.Enc, v any) bool {`,
				"\tif v == nil {",
				"\t\te.Null()",
				"\t\treturn true",
				"\t}",
				"\tswitch x := v.(type) {",
				...cases.map((c) => c.src),
				"\tdefault:",
				"\t\t_ = x",
				"\t\treturn false",
				"\t}",
				"}",
				// Every package with codecs lends its dynamic encoder to the others,
				// so a value of a type another package declares still encodes.
				`var _ = jsonrt.RegisterEncoder(${known})`,
				`func ${this.prefix}encAny(e *jsonrt.Enc, v any) {`,
				`\tif !${known}(e, v) {`,
				"\t\te.EncodeDynamic(v)",
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
			pointer: () => this.decPointer(u),
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

	decPointer(u) {
		const base = u.base;
		const lines = [
			"if d.Null() {",
			"\treturn nil",
			"}",
			"if cur == nil {",
			`\tcur = new(${this.spell(base)})`,
			"}",
		];
		if (this.decInPlace(base)) {
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
			"\tout, err := jsonrt.AppendIndent(nil, b, prefix, indent)",
			"\treturn out, err",
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

	entryEncode(argType) {
		const json = this.qualifierFor(JSON_PATH);
		const name = `${this.prefix}encode${this.entries.length}`;
		const lines = [
			`func ${name}(enc *${json}.Encoder, v any) error {`,
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
		const json = this.qualifierFor(JSON_PATH);
		const name = `${this.prefix}decode${this.entries.length}`;
		const lines = [
			`func ${name}(dec *${json}.Decoder, v any) error {`,
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
		// A pointer to a type parameter's variable names no type in JavaScript:
		// it decodes by its pointee's shape (see __isty), so these always exist.
		const shapes = ["any", "float64", "string", "bool", "int64"].map((n) => ({
			kind: "pointer",
			base: { kind: "basic", name: n },
		}));
		for (const pt of [...this.decTargets, ...pointers, ...shapes]) {
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
		const anyT = { kind: "basic", name: "any" };
		if (!this.registerOnly) {
			for (const n of DYNAMIC_BASICS) this.encFn({ kind: "basic", name: n });
			this.encFn({ kind: "slice", elem: anyT });
			this.encFn({
				kind: "map",
				key: { kind: "basic", name: "string" },
				value: anyT,
			});
		}
		for (const t of this.programTypes()) {
			this.encFn(t, false);
		}
		for (const { type: t, via } of this.collectedTypes()) {
			if (via !== "declared" || mentionsTypeParam(t)) continue;
			const u = under(t);
			if (!u || u.kind === "interface" || u.kind === "func") continue;
			this.encFn(t, false);
			this.encFn({ kind: "pointer", base: t }, false);
		}
	}

	spellableNamed(t, ok) {
		return (
			isJsonValue(t) ||
			(!t.name.includes("$$") &&
				!t.name.includes("[") &&
				(t.typeArgs ?? []).every(ok))
		);
	}

	addTypeArg(found, a) {
		const t = defaultType(a);
		if (!t || mentionsTypeParam(t) || !this.spellable(t) || isInterface(t))
			return;
		// An array or map of small integers would shadow its look-alikes in the
		// type switch (see SHARED_REPR).
		const ambiguous = !isCompositeType(t) && hasSharedRepr(t);
		if (holdsFunc(t) || ambiguous) return;
		found.set(this.key(t), t);
		const p = { kind: "pointer", base: t };
		found.set(this.key(p), p);
	}

	collectedTypes() {
		this.collected ??= collectProgramTypes(this.programs, this.checker);
		return this.collected;
	}

	// Types the program builds with composite literals, `&T{}`, make and new:
	// candidates for a value stored in an interface (an `any` map value, say).
	programTypes() {
		const found = new Map();
		for (const { type: t, node, via } of this.collectedTypes()) {
			// A generic call's type arguments are what its body encodes and
			// decodes through `T` and `&v`.
			if (via === "typeArg") this.addTypeArg(found, t);
			if (via !== "expr" || !t) continue;
			// A func literal in an interface reports its own type.
			if (node.kind === "FuncLit" && this.spellable(t)) {
				found.set(this.key(t), t);
				continue;
			}
			// Slices, arrays and maps reach an interface from any expression
			// (a function result, a variable), not only from a literal
			if (!buildsValue(node) && !isCompositeType(t) && !isJsonValue(t))
				continue;
			if (this.spellable(t) && under(t)?.kind !== "interface")
				found.set(this.key(t), t);
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

	// The generated declarations (the spine adds the header and imports).
	body() {
		return [...this.entries, ...this.out].join("\n\n");
	}
}

// A slice of booleans or small integers carries a tag of its Go type inside an
// interface, so it never shadows another slice type in the type switch.
const isTaggedSlice = (t) =>
	under(t)?.kind === "slice" && isBasic(under(t).elem, SHARED_REPR);

// json.RawMessage and json.Number values can reach an interface from any
// expression (a conversion, a field read).
const isJsonValue = (t) => isRaw(t) || isNumber(t);

export const isCompositeType = (t) => {
	const k = under(t)?.kind;
	return (
		(k === "slice" || k === "array" || k === "map") &&
		!holdsFunc(t) &&
		(isTaggedSlice(t) || !hasSharedRepr(t))
	);
};

// Func values are not JSON-encodable, and `case []func():` does not parse.
export function holdsFunc(t, depth = 0) {
	if (!t || depth > 8) return false;
	const u = under(t);
	if (u?.kind === "func") return true;
	if (u?.kind === "slice" || u?.kind === "array")
		return holdsFunc(u.elem, depth + 1);
	if (u?.kind === "map")
		return holdsFunc(u.key, depth + 1) || holdsFunc(u.value, depth + 1);
	return false;
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

// `json.Marshal`-style selector on the imported package (not a local that
// shadows its name).
const isJsonRef = (node, aliases) =>
	node.kind === "SelectorExpr" &&
	node.expr?.kind === "Ident" &&
	node.expr._type?.kind === "namespace" &&
	aliases.has(node.expr.name) &&
	SITE_FUNCS.has(node.field);

const isJsonCall = (node, aliases) =>
	node.kind === "CallExpr" && isJsonRef(node.func, aliases);

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

// Finds `json.Marshal/MarshalIndent/Unmarshal` call sites in the checked
// programs, and a diagnostic for each use of them that is not a call.
function findSites(programs) {
	const sites = [];
	const diagnostics = [];
	for (const p of programs) {
		const aliases = jsonAliases(p);
		const callees = new Set();
		const refs = [];
		walkNodes(p.decls, (node) => {
			if (isJsonCall(node, aliases)) {
				sites.push({ call: node, fn: node.func.field, program: p });
				callees.add(node.func);
			} else if (isJsonRef(node, aliases)) {
				refs.push(node);
			} else {
				const streamFn = isStreamCall(node);
				if (streamFn) sites.push({ call: node, fn: streamFn, program: p });
			}
		});
		for (const node of refs)
			if (!callees.has(node))
				diagnostics.push({
					program: p,
					node: node.expr,
					message: `json.${node.field} cannot be used as a value`,
					hint: `call json.${node.field} directly`,
				});
	}
	return { sites, diagnostics };
}

function selectCodecEntry(gen, fn, argType) {
	if (fn === "Marshal") return gen.entryMarshal(argType(0));
	if (fn === "MarshalIndent") return gen.entryMarshalIndent(argType(0));
	if (fn === "Unmarshal") return gen.entryUnmarshal(argType(1));
	if (fn === "Encode") return gen.entryEncode(argType(0));
	if (fn === "Decode") return gen.entryDecode(argType(0));
}

// Records that the build uses `json` when this package calls it; returns
// whether the package has call sites (or misuses) of its own. One without
// them still lends its types to the dynamic encoder once `json` is in use.
function noteJsonUse(options, sites, diagnostics) {
	if (sites.length > 0 && options.jsonBuild) options.jsonBuild.used = true;
	return sites.length + diagnostics.length > 0;
}

// Generates the codec file for a package's `json` call sites.  Returns null
// when it has none; otherwise { body, imports, diagnostics } and marks each call's
// SelectorExpr with `_genEntry`, the entry point the WASM link calls instead.
export function generateJsonCodecs(programs, checker, pkgName, options = {}) {
	const { sites, diagnostics } = findSites(programs);
	const registerOnly = !noteJsonUse(options, sites, diagnostics);
	if (registerOnly && !options.jsonBuild?.used) return null;
	const qualifiers = new Map();
	const gen = new JsonCodecGen(checker, pkgName, qualifiers, programs);
	if (registerOnly) {
		gen.registerOnly = true;
		gen.flagDynamic();
	}
	const pending = [];
	for (const { call, fn, program } of sites) {
		// A site inside a generic function is shared by every instance, so a type
		// that mentions a type parameter takes the dynamic entry.
		const argType = (i) => {
			const t = defaultType(call.args[i]?._type);
			return mentionsTypeParam(t) ? null : t;
		};
		if (
			fn === "Unmarshal" &&
			checker.target !== "js" &&
			argType(1)?.base?.kind === "pointer"
		)
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
	if (registerOnly && !gen.out.some((o) => o.includes("RegisterEncoder")))
		return null;
	for (const [sel, entry, isStream] of pending) {
		sel._genEntry = entry;
		if (isStream) sel._jsonStream = true;
	}
	return {
		body: gen.body(),
		imports: ["internal/jsonrt", ...importsFor(qualifiers)],
		diagnostics,
	};
}
