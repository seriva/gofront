// JS natives: host code that replaces a call to a `//gofront:native` stdlib
// function.  The Go body is the specification and is always emitted when
// reachable; an implementation either returns a JS expression for the call or
// `null` to decline, in which case the call goes to the Go body.
//
// An implementation is `(args, typeArgs) => string | null`.  `args` are the
// call's argument expressions (opaque strings) and `typeArgs` the instantiated
// type arguments of a generic function.  It must return a primary expression
// or parenthesise its own result, and must reproduce Go's behaviour (strict
// bounds panics, wrapping, nil slices) for every instantiation it accepts.
// The framework evaluates each argument once, in order, however many times the
// template mentions it.

export const JS_NATIVES = new Map();

// Marks an argument position inside a template.
const MARK = (i) => `\u00ab${i}\u00bb`;
const MARK_RE = /\u00ab(\d+)\u00bb/g;

// Arguments that are safe to repeat or reorder: names, member chains and
// plain literals have no side effects and are cheap to evaluate twice.
const SIMPLE_ARG =
	/^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|-?\d+(?:\.\d+)?n?|"(?:[^"\\]|\\.)*")$/;

// The JS for a call of native `name`, or null when it is not registered or
// declines this instantiation.  `args` are the already-generated argument
// expressions.
export function jsNativeCall(name, args, typeArgs) {
	const impl = JS_NATIVES.get(name);
	if (!impl) return null;
	const template = impl(
		args.map((_, i) => MARK(i)),
		typeArgs,
	);
	if (template == null) return null;
	const wrap = (a) => (SIMPLE_ARG.test(a) ? a : `(${a})`);
	const seq = [...template.matchAll(MARK_RE)].map((m) => Number(m[1]));
	const inOrder = seq.length === args.length && seq.every((v, i) => v === i);
	if (inOrder || args.every((a) => SIMPLE_ARG.test(a)))
		return template.replace(MARK_RE, (_, i) => wrap(args[Number(i)]));
	// An argument with effects is repeated, dropped or reordered: evaluate
	// every argument once, in order, into a temporary.
	const names = args.map((_, i) => `$n${i}`);
	const body = template.replace(MARK_RE, (_, i) => names[Number(i)]);
	return `((${names.join(", ")}) => ${body})(${args.join(", ")})`;
}

// ── slices and sort ───────────────────────────────────────────
//
// Element types where JS `===`, `indexOf` and the default array methods
// agree with Go's `==` on a raw element: numbers, bigints, strings and
// booleans, named or not.  Slices of other elements (structs, arrays,
// interfaces, pointers) decline and run the Go body.

const PRIMITIVE_KINDS = new Set([
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
	"string",
	"bool",
]);

function baseType(t) {
	let u = t;
	for (let i = 0; u?.kind === "named" && i < 32; i++) u = u.underlying;
	return u;
}

// The element type argument of `slices.F[S, E]` when it is a primitive.
function primitiveElem(typeArgs) {
	const e = baseType(typeArgs?.[1]);
	return e?.kind === "basic" && PRIMITIVE_KINDS.has(e.name) ? e : null;
}

// `Contains` uses `indexOf`: `includes` would find a NaN, which Go never does.
JS_NATIVES.set("slices.Index", (a, targs) =>
	primitiveElem(targs) ? `(${a[0]} ?? []).indexOf(${a[1]})` : null,
);
JS_NATIVES.set("slices.Contains", (a, targs) =>
	primitiveElem(targs) ? `((${a[0]} ?? []).indexOf(${a[1]}) !== -1)` : null,
);
JS_NATIVES.set("slices.Reverse", (a, targs) =>
	primitiveElem(targs) ? `(${a[0]} ?? []).reverse()` : null,
);
JS_NATIVES.set("slices.Clone", (a, targs) =>
	primitiveElem(targs) ? `(${a[0]}?.slice() ?? null)` : null,
);

// Sorting is only native for `int` and `string`, where equal elements cannot
// be told apart and the host order is Go's.
const SORT_ORDER = {
	int: "(a, b) => a - b",
	string: "(a, b) => (a < b ? -1 : a > b ? 1 : 0)",
};
function sortNative(elem, arg) {
	const cmp = SORT_ORDER[elem?.name];
	return cmp ? `(${arg} ?? []).sort(${cmp})` : null;
}
JS_NATIVES.set("slices.Sort", (a, targs) => {
	const e = targs?.[1];
	return e?.kind === "basic" ? sortNative(e, a[0]) : null;
});
JS_NATIVES.set("sort.Ints", (a) => sortNative({ name: "int" }, a[0]));
JS_NATIVES.set("sort.Strings", (a) => sortNative({ name: "string" }, a[0]));

// ── unicode/utf8 ──────────────────────────────────────────────

// A string iterates by code point, as Go's `range` does.
JS_NATIVES.set("utf8.RuneCountInString", (a) => `[...${a[0]}].length`);
