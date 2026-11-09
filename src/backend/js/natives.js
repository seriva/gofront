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

import { FIXED_FLOAT_JS } from "../shared/fixed-float.js";

export const JS_NATIVES = new Map();

// Runtime helper (a HELPER_MAP key) a native's template calls.
export const NATIVE_HELPERS = new Map();

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

// ── bytes ─────────────────────────────────────────────────────

// A nil slice reads as empty.
JS_NATIVES.set("bytes.IndexByte", (a) => `(${a[0]} ?? []).indexOf(${a[1]})`);
JS_NATIVES.set(
	"bytes.Equal",
	(a) =>
		`((a, b) => { a ??= []; b ??= []; if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; })(${a[0]}, ${a[1]})`,
);
JS_NATIVES.set(
	"bytes.Compare",
	(a) =>
		`((a, b) => { a ??= []; b ??= []; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return a.length < b.length ? -1 : a.length > b.length ? 1 : 0; })(${a[0]}, ${a[1]})`,
);

// ── strings ───────────────────────────────────────────────────
//
// GoFront strings are JS strings and offsets count UTF-16 units, so the host
// searches give the Go body's answers.  Runes are code points: a rune that
// is not one (negative, past U+10FFFF or a surrogate) is never found, and a
// lone surrogate in a cutset or chars string never matches.

const GO_SPACE =
	"[ \\t\\n\\v\\f\\r\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]";
const BAD_RUNE = "r < 0 || r > 0x10FFFF || (r >= 0xD800 && r <= 0xDFFF)";
const SURROGATE = "(v >= 0xD800 && v <= 0xDFFF)";

const strFn = (params, body) => (a) =>
	`((${params}) => ${body})(${a.join(", ")})`;

JS_NATIVES.set("strings.Index", (a) => `${a[0]}.indexOf(${a[1]})`);
JS_NATIVES.set("strings.LastIndex", (a) => `${a[0]}.lastIndexOf(${a[1]})`);
JS_NATIVES.set(
	"strings.IndexByte",
	(a) => `${a[0]}.indexOf(String.fromCharCode(${a[1]}))`,
);
JS_NATIVES.set(
	"strings.LastIndexByte",
	(a) => `${a[0]}.lastIndexOf(String.fromCharCode(${a[1]}))`,
);
JS_NATIVES.set(
	"strings.IndexRune",
	strFn("s, r", `${BAD_RUNE} ? -1 : s.indexOf(String.fromCodePoint(r))`),
);
JS_NATIVES.set(
	"strings.IndexAny",
	strFn(
		"s, cs",
		`{ let m = -1; for (const c of cs) { const v = c.codePointAt(0); if (${SURROGATE}) continue; const i = s.indexOf(c); if (i >= 0 && (m < 0 || i < m)) m = i; } return m; }`,
	),
);
JS_NATIVES.set(
	"strings.LastIndexAny",
	strFn(
		"s, cs",
		`{ let m = -1; for (const c of cs) { const v = c.codePointAt(0); if (${SURROGATE}) continue; const i = s.lastIndexOf(c); if (i > m) m = i; } return m; }`,
	),
);
JS_NATIVES.set("strings.Contains", (a) => `${a[0]}.includes(${a[1]})`);
JS_NATIVES.set(
	"strings.ContainsAny",
	strFn(
		"s, cs",
		`{ for (const c of cs) { const v = c.codePointAt(0); if (!${SURROGATE} && s.includes(c)) return true; } return false; }`,
	),
);
JS_NATIVES.set(
	"strings.ContainsRune",
	strFn("s, r", `!(${BAD_RUNE}) && s.includes(String.fromCodePoint(r))`),
);
JS_NATIVES.set("strings.HasPrefix", (a) => `${a[0]}.startsWith(${a[1]})`);
JS_NATIVES.set("strings.HasSuffix", (a) => `${a[0]}.endsWith(${a[1]})`);
// An empty substring counts the code points plus one, as in Go.
JS_NATIVES.set(
	"strings.Count",
	strFn(
		"s, t",
		`{ if (t === "") return [...s].length + 1; let n = 0; for (let i = s.indexOf(t); i !== -1; i = s.indexOf(t, i + t.length)) n++; return n; }`,
	),
);

JS_NATIVES.set(
	"strings.Repeat",
	strFn(
		"s, n",
		`{ if (n < 0) throw new Error("strings: negative Repeat count"); return s.repeat(n); }`,
	),
);
JS_NATIVES.set("strings.Join", (a) => `(${a[0]} ?? []).join(${a[1]})`);
// The replacement is a function so `$&` and friends stay literal.  An empty
// old string matches before every code point and at the end.
const replaceFn = (n) =>
	`(s, o, w${n === null ? ", n" : ""}) => { ${n === null ? "" : `const n = ${n}; `}if (o === w || n === 0) return s; if (o !== "") { if (n < 0) return s.replaceAll(o, () => w); let r = "", i = 0; for (let k = n; k > 0; k--) { const j = s.indexOf(o, i); if (j < 0) break; r += s.slice(i, j) + w; i = j + o.length; } return r + s.slice(i); } const cs = [...s]; const m = n < 0 || n > cs.length + 1 ? cs.length + 1 : n; let r = ""; for (let k = 0; k < m; k++) r += (k > 0 ? cs[k - 1] : "") + w; return r + cs.slice(m - 1).join(""); }`;
JS_NATIVES.set(
	"strings.Replace",
	(a) => `(${replaceFn(null)})(${a.join(", ")})`,
);
JS_NATIVES.set(
	"strings.ReplaceAll",
	(a) => `(${replaceFn(-1)})(${a.join(", ")})`,
);
JS_NATIVES.set(
	"strings.Split",
	strFn("s, sep", `sep === "" ? [...s] : s.split(sep)`),
);
JS_NATIVES.set(
	"strings.Fields",
	(a) => `${a[0]}.split(/${GO_SPACE}+/).filter((p) => p !== "")`,
);

// Case mapping goes letter by letter through the first code point of the
// host's mapping, as the Go body does through `unicode.ToUpper`; ASCII text
// takes the whole-string fast path. A letter whose upper case spans several
// code points (ß) stays as it is, as in Go's single-rune tables.
const caseNative = (method) =>
	strFn(
		"s",
		`/^[\\x00-\\x7f]*$/.test(s) ? s.${method}() : Array.from(s, (c) => { const m = c.${method}(); const r = String.fromCodePoint(m.codePointAt(0)); return m.length > r.length && "${method}" === "toUpperCase" ? c : r; }).join("")`,
	);
JS_NATIVES.set("strings.ToUpper", caseNative("toUpperCase"));
JS_NATIVES.set("strings.ToLower", caseNative("toLowerCase"));
JS_NATIVES.set(
	"strings.TrimSpace",
	strFn(
		"s",
		`{ const sp = /${GO_SPACE}/; let i = 0, j = s.length; while (i < j && sp.test(s[i])) i++; while (j > i && sp.test(s[j - 1])) j--; return s.slice(i, j); }`,
	),
);
const TRIM_FN =
	'(s, cs, l, r) => { if (s === "" || cs === "") return s; const set = new Set(cs); let i = 0, j = s.length; if (l) while (i < j) { const c = s.codePointAt(i); if (!set.has(String.fromCodePoint(c))) break; i += c > 0xFFFF ? 2 : 1; } if (r) while (j > i) { let k = j - 1; const lo = s.charCodeAt(k); if (lo >= 0xDC00 && lo <= 0xDFFF && k > i) { const hi = s.charCodeAt(k - 1); if (hi >= 0xD800 && hi <= 0xDBFF) k--; } if (!set.has(s.slice(k, j))) break; j = k; } return s.slice(i, j); }';
const trimNative = (l, r) => (a) =>
	`(${TRIM_FN})(${a[0]}, ${a[1]}, ${l}, ${r})`;
JS_NATIVES.set("strings.Trim", trimNative(true, true));
JS_NATIVES.set("strings.TrimLeft", trimNative(true, false));
JS_NATIVES.set("strings.TrimRight", trimNative(false, true));
JS_NATIVES.set(
	"strings.TrimPrefix",
	strFn("s, p", "s.startsWith(p) ? s.slice(p.length) : s"),
);
JS_NATIVES.set(
	"strings.TrimSuffix",
	strFn("s, p", "s.endsWith(p) ? s.slice(0, s.length - p.length) : s"),
);

// ── strconv ───────────────────────────────────────────────────
//
// The host number printer gives the shortest digits that read back as the
// float64 and `Number` converts a decimal with correct rounding; both agree
// with the Go bodies.

JS_NATIVES.set("strconv.shortest", (a) => `${a[0]}.toExponential()`);
JS_NATIVES.set("strconv.fixed", (a) => `(${FIXED_FLOAT_JS})(${a[0]}, ${a[1]})`);
JS_NATIVES.set(
	"strconv.parseDecimal",
	(a) => `Number(${a[0]}.replaceAll("_", ""))`,
);

// ── math/bits ─────────────────────────────────────────────────
//
// Only the 8, 16 and 32 bit forms: their operands are Numbers that
// `Math.clz32` reads exactly.  The 64 bit and `uint` forms hold BigInts or
// imprecise Numbers, so they decline and run the Go body.

for (const n of [8, 16, 32]) {
	JS_NATIVES.set(`bits.Len${n}`, (a) => `(32 - Math.clz32(${a[0]}))`);
	JS_NATIVES.set(
		`bits.LeadingZeros${n}`,
		(a) => `(Math.clz32(${a[0]}) - ${32 - n})`,
	);
	JS_NATIVES.set(
		`bits.TrailingZeros${n}`,
		(a) => `(${a[0]} === 0 ? ${n} : 31 - Math.clz32(${a[0]} & -${a[0]}))`,
	);
	JS_NATIVES.set(
		`bits.OnesCount${n}`,
		(a) =>
			`((v) => { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24; })(${a[0]})`,
	);
}

// ── math ──────────────────────────────────────────────────────
//
// Host `Math.*` where it agrees with Go.  An infinity beats a NaN in Go's
// `Max` and `Min`; `Math.round` rounds half toward +Inf where Go rounds half
// away from zero; the sign of a NaN is not observed.

JS_NATIVES.set("math.Abs", (a) => `Math.abs(${a[0]})`);
JS_NATIVES.set("math.Floor", (a) => `Math.floor(${a[0]})`);
JS_NATIVES.set("math.Ceil", (a) => `Math.ceil(${a[0]})`);
JS_NATIVES.set("math.Trunc", (a) => `Math.trunc(${a[0]})`);
JS_NATIVES.set("math.Sqrt", (a) => `Math.sqrt(${a[0]})`);
JS_NATIVES.set(
	"math.Round",
	(a) => `(Math.sign(${a[0]}) * Math.round(Math.abs(${a[0]})))`,
);
JS_NATIVES.set(
	"math.Max",
	(a) =>
		`(${a[0]} === Infinity || ${a[1]} === Infinity ? Infinity : Math.max(${a[0]}, ${a[1]}))`,
);
JS_NATIVES.set(
	"math.Min",
	(a) =>
		`(${a[0]} === -Infinity || ${a[1]} === -Infinity ? -Infinity : Math.min(${a[0]}, ${a[1]}))`,
);
JS_NATIVES.set("math.IsNaN", (a) => `Number.isNaN(${a[0]})`);
JS_NATIVES.set(
	"math.IsInf",
	(a) =>
		`(${a[1]} > 0 ? ${a[0]} === Infinity : ${a[1]} < 0 ? ${a[0]} === -Infinity : Math.abs(${a[0]}) === Infinity)`,
);
JS_NATIVES.set("math.Inf", (a) => `(${a[0]} >= 0 ? Infinity : -Infinity)`);
JS_NATIVES.set("math.NaN", () => "NaN");
JS_NATIVES.set(
	"math.Signbit",
	(a) => `(${a[0]} < 0 || Object.is(${a[0]}, -0))`,
);
JS_NATIVES.set(
	"math.Copysign",
	(a) =>
		`(Math.abs(${a[0]}) * (${a[1]} < 0 || Object.is(${a[1]}, -0) ? -1 : 1))`,
);

// ── internal/jsonrt ───────────────────────────────────────────
//
// The encoder writes into a byte buffer it owns (`buf`, `n`); these calls
// append to it without the per-write slice headers Go's append would make.

const JSONRT_CALLS = {
	putString: "__jput",
	putInt: "__jint",
	putUint: "__jint",
	putFloat: "__jfloat",
	putQuoted: "__jquote",
};
for (const [name, helper] of Object.entries(JSONRT_CALLS)) {
	JS_NATIVES.set(`jsonrt.${name}`, (a) => `${helper}(${a.join(", ")})`);
	NATIVE_HELPERS.set(`jsonrt.${name}`, "jsonrt");
}

// The decoder reads straight from its input bytes (`data`, `pos`); a string
// with escapes goes to the Go `unquote`, and input the host's JSON parser
// rejects goes to the Go scanner, which words the error.
JS_NATIVES.set(
	"jsonrt.readStr",
	(a) => `__jrstr(${a[0]}, unquote$$internal$jsonrt)`,
);
JS_NATIVES.set("jsonrt.readNum", (a) => `__jrnum(${a[0]})`);
JS_NATIVES.set(
	"jsonrt.CheckValid",
	(a) => `(__jvalid(${a[0]}) ? null : CheckValid$$internal$jsonrt(${a[0]}))`,
);
JS_NATIVES.set(
	"jsonrt.LooksFloat32",
	(a) => `(Math.fround(${a[0]}) === ${a[0]})`,
);
for (const n of ["readStr", "readNum", "CheckValid"])
	NATIVE_HELPERS.set(`jsonrt.${n}`, "jsonrt");
