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
const FLAGS = "#+\\- 0";
const VERBS = "vTtcdoObxXUeEfFgGsqp";

const qualify = (name) => (name.includes(".") ? name : `main.${name}`);

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
				r: (t.returns ?? []).map(sub),
				v: Boolean(t.variadic),
			};
		case "chan":
			return { k: "chan", e: sub(t.elem) };
		default:
			return null;
	}
}

function structDesc(n, st, sub) {
	const f = [];
	for (const [name, ft] of st.fields ?? []) f.push([name, sub(ft)]);
	return { k: "struct", n, f };
}

function namedDesc(t, resolve, depth, sub) {
	const n = qualify(t.name ?? "");
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
 * Whether a call with this literal format string needs operand types: `%T`,
 * `%#v`, an unknown verb (`%!z(int=5)`), or more operands than verbs
 * (`%!(EXTRA int=1)`).
 * @param {unknown} format
 * @param {number} nargs operand count, -1 when not known statically
 */
export function fmtWantsTypes(format, nargs) {
	if (typeof format !== "string") return false;
	const re = new RegExp(
		`%([${FLAGS}]*)((?:\\[\\d+\\])?(?:\\*|\\d+)?(?:\\.(?:\\[\\d+\\])?(?:\\*|\\d*))?(?:\\[\\d+\\])?)([^]?)`,
		"g",
	);
	let count = 0;
	let indexed = false;
	for (const m of format.matchAll(re)) {
		const verb = m[3];
		if (verb === "%") continue;
		if (verb === "T" || verb === "p") return true;
		if (verb === "v" && m[1].includes("#")) return true;
		if (verb !== "" && !VERBS.includes(verb) && verb !== "w") return true;
		if (/[[*]/.test(m[2])) indexed = true;
		count++;
	}
	return nargs >= 0 && !indexed && nargs > count;
}
