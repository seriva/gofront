// Static type descriptors for `fmt` (Task 3.1c), shared by the JS and WASM
// backends.  `%T` and `%#v` need the Go type of an operand, which the runtime
// values do not carry (an `int` and a `float64` holding 3 are both the number
// 3, a `Color` is a raw number inside a slice).  Where a format string is a
// literal that needs them (`fmtWantsTypes`), codegen passes the operand's
// static type next to its value as a plain JSON-compatible tree, which
// `__sprintf` reads (`__ft` on JS, `fmt_arg_type` on WASM).
//
// Descriptor shapes (`k`): `b` basic `{ n }`, `named` `{ n, u }` (a named
// non-struct type, `u` its underlying type), `struct` `{ n, f: [[name, T]] }`
// (`n` is "" for an anonymous struct), `ptr` `{ e }`, `slice` `{ e }`,
// `array` `{ e, len }`, `map` `{ key, val }`, `i` an interface `{ n }`,
// `func` `{ p, r }`, `chan` `{ e }`.  A type that is too deep or unknown is
// `null`; the runtime then derives a best-effort type from the value.

const MAX_DEPTH = 4;

const qualify = (name) =>
	name.split("[")[0].includes(".") ? name : `main.${name}`;

const PREDECLARED = new Set([
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
	"uintptr",
	"float32",
	"float64",
	"complex64",
	"complex128",
	"byte",
	"rune",
	"error",
]);

/**
 * Go's `reflect` spelling of a type used as a type argument: `int`,
 * `main.Foo`, `[]main.Foo`.  Takes checker types and parsed type nodes;
 * `specialized` maps the names of monomorphised instances to their spelling.
 * @param {any} t
 * @param {Map<string, string>} [specialized]
 * @returns {string}
 */
export function goTypeName(t, specialized = null) {
	const go = (x) => goTypeName(x, specialized);
	switch (t?.kind) {
		case "basic":
			return t.name === "any" ? "interface {}" : t.name;
		case "untyped":
			return t.base;
		case "TypeName":
		case "Ident":
			if (specialized?.has(t.name)) return qualify(specialized.get(t.name));
			if (t.name === "any") return "interface {}";
			return PREDECLARED.has(t.name) ? t.name : qualify(t.name);
		case "GenericTypeName":
			return qualify(`${t.name}[${t.typeArgs.map(go).join(",")}]`);
		case "named":
			return qualify(instanceName(t, specialized));
		case "interface":
			return t.name ? qualify(t.name) : "interface {}";
		case "pointer":
		case "PointerType":
			return `*${go(t.base)}`;
		case "slice":
		case "SliceType":
			return `[]${go(t.elem)}`;
		case "array":
		case "ArrayType":
			return `[${t.size ?? 0}]${go(t.elem)}`;
		case "map":
		case "MapType":
			return `map[${go(t.key)}]${go(t.value)}`;
		default:
			return "interface {}";
	}
}

// `Box[int]` for a generic instance: the checker's type arguments on JS, the
// spelling the monomorphiser recorded on WASM.
function instanceName(t, specialized = null) {
	if (t._goName) return t._goName;
	if (!t.typeArgs?.length) return t.name ?? "";
	return `${t.name}[${t.typeArgs.map((a) => goTypeName(a, specialized)).join(",")}]`;
}

/**
 * @param {any} t checker type
 * @param {(t: any) => any} [resolve] resolves a type reference
 * @param {number} [depth]
 * @returns {object | null}
 */
export function fmtTypeDesc(t, resolve = (x) => x, depth = 0) {
	t = resolve(t) ?? t;
	if (!t) return null;
	const sub = (x) => fmtTypeDesc(x, resolve, depth + 1);
	switch (t.kind) {
		case "basic":
			if (t.name === "any") return { k: "i", n: "interface {}" };
			if (t.name === "nil" || t.name === "void") return null;
			return { k: "b", n: t.name };
		case "untyped":
			return { k: "b", n: t.base };
		case "interface":
			return { k: "i", n: t.name ? qualify(t.name) : "interface {}" };
		case "named":
			return namedDesc(t, resolve, depth, sub);
		case "struct":
			return depth > MAX_DEPTH ? null : structDesc("", t, sub);
		case "pointer":
			return depth > MAX_DEPTH ? null : { k: "ptr", e: sub(t.base) };
		case "slice":
			return depth > MAX_DEPTH ? null : { k: "slice", e: sub(t.elem) };
		case "array":
			return depth > MAX_DEPTH
				? null
				: { k: "array", e: sub(t.elem), len: t.size ?? 0 };
		case "map":
			return depth > MAX_DEPTH
				? null
				: { k: "map", key: sub(t.key), val: sub(t.value) };
		case "func":
			return {
				k: "func",
				p: (t.params ?? []).map(sub),
				r: (t.returns ?? [])
					.filter((r) => !(r?.kind === "basic" && r.name === "void"))
					.map(sub),
				v: Boolean(t.variadic),
			};
		case "chan":
			return { k: "chan", e: sub(t.elem) };
		default:
			return null;
	}
}

/**
 * The fields a struct declares itself, in declaration order: named fields and
 * one entry per embedded type.  Fields promoted from an embedded struct are
 * not listed (`fields` also holds them for selector lookup).
 * @param {any} st checker struct type
 * @returns {[string, any][]}
 */
export function structOwnFields(st) {
	if (!st._structFields) return [...(st.fields ?? [])];
	const own = [];
	for (const sf of st._structFields) {
		if (!sf.embedded) {
			for (const n of sf.names) own.push([n, st.fields.get(n)]);
			continue;
		}
		const inner = sf.type?.kind === "pointer" ? sf.type.base : sf.type;
		const name = (
			sf.embeddedName ??
			sf.astType?.name ??
			sf.type?.name ??
			sf.type?.base?.name ??
			(inner?.kind === "named" ? inner.name : "")
		)
			.split(".")
			.pop();
		if (name) own.push([name, st.fields.get(name) ?? sf.type]);
	}
	return own;
}

function structDesc(n, st, sub) {
	const f = [];
	for (const [name, ft] of structOwnFields(st)) f.push([name, sub(ft)]);
	return { k: "struct", n, f };
}

function namedDesc(t, resolve, depth, sub) {
	const n = qualify(instanceName(t));
	const u = resolve(t.underlying) ?? t.underlying;
	if (!u) return { k: "named", n, u: null };
	if (u.kind === "struct")
		return depth > MAX_DEPTH
			? { k: "struct", n, f: null }
			: structDesc(n, u, sub);
	if (u.kind === "interface") return { k: "i", n };
	return { k: "named", n, u: depth > MAX_DEPTH ? null : sub(u) };
}

/**
 * Whether a type descriptor mentions a float32 or float64.  Such operands
 * travel with their static type: a number alone cannot tell `float64(1e6)`
 * (Go prints 1e+06) from an `int`, or a float32 from the float64 holding the
 * same bits.
 * @param {any} desc result of fmtTypeDesc
 * @returns {boolean}
 */
export function fmtDescHasFloat(desc) {
	if (!desc || typeof desc !== "object") return false;
	switch (desc.k) {
		case "b":
			return desc.n === "float32" || desc.n === "float64";
		case "named":
			return fmtDescHasFloat(desc.u);
		case "struct":
			return (desc.f ?? []).some(([, ft]) => fmtDescHasFloat(ft));
		case "ptr":
		case "slice":
		case "array":
			return fmtDescHasFloat(desc.e);
		case "map":
			return fmtDescHasFloat(desc.key) || fmtDescHasFloat(desc.val);
		default:
			return false;
	}
}

/**
 * The operand of `any(x)` seen by fmt as `x` with its static type: the
 * conversion would hide the concrete type from `%T`, `%v` of a float32 and
 * typed nil pointers.  Conversions to a non-empty interface (`error(e)`) and
 * of an operand that is already an interface or nil stay as they are.
 * @param {any} e call operand
 * @returns {any}
 */
export function fmtPeelAny(e) {
	if (e?.kind !== "TypeConversion" || !e.expr || e._spread) return e;
	const to = e._type;
	if (!(to?.kind === "basic" && to.name === "any")) return e;
	const from = e.expr._type;
	if (!from || from.kind === "interface" || from.kind === "tuple") return e;
	if (from.kind === "basic" && (from.name === "any" || from.name === "nil"))
		return e;
	if (from.kind === "untyped" && from.base === "nil") return e;
	return e.expr;
}
