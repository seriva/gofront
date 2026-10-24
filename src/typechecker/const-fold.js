// Backend-independent evaluation of Go constant expressions.
//
// A constant value is `{ k, v, t, i }`:
//   k — "INT" | "FLOAT" | "STRING" | "BOOL"
//   v — BigInt (INT), Number (FLOAT), string or boolean
//   t — basic type name of a typed constant ("int8", "float64", …); absent
//       for untyped constants, which are exact (BigInt) and may exceed every
//       Go type until they are converted or assigned
//   i — for an untyped integral FLOAT, its exact BigInt value, so that
//       `1e18 + 1` stays exact when it later becomes an integer
//
// The checker evaluates constant expressions with these helpers and attaches
// the result to the AST node (`_const`); both backends emit that value.
// `foldConstExpr` folds an AST directly (the WASM backend uses it for
// package-level constants).

const INT = "INT";
const FLOAT = "FLOAT";
const STRING = "STRING";
const BOOL = "BOOL";

// Shift counts beyond this are left to the runtime (Go allows larger shifts
// of untyped constants, but no program needs a 4096-bit intermediate).
const MAX_SHIFT = 4096n;

// Value ranges of the integer types.
export const INT_RANGES = {
	int8: [-(2n ** 7n), 2n ** 7n - 1n],
	int16: [-(2n ** 15n), 2n ** 15n - 1n],
	int32: [-(2n ** 31n), 2n ** 31n - 1n],
	rune: [-(2n ** 31n), 2n ** 31n - 1n],
	int64: [-(2n ** 63n), 2n ** 63n - 1n],
	int: [-(2n ** 63n), 2n ** 63n - 1n],
	uint8: [0n, 2n ** 8n - 1n],
	byte: [0n, 2n ** 8n - 1n],
	uint16: [0n, 2n ** 16n - 1n],
	uint32: [0n, 2n ** 32n - 1n],
	uint64: [0n, 2n ** 64n - 1n],
	uint: [0n, 2n ** 64n - 1n],
	uintptr: [0n, 2n ** 64n - 1n],
};

const FLOAT_TYPES = new Set(["float32", "float64"]);

// Untyped integer constants of package `math` (Go declares them untyped).
// `MaxInt`, `MinInt` and `MaxUint` are left out: the JS backend maps them to
// the safe-integer range on purpose.
export const MATH_INT_CONSTS = {
	MaxInt8: 2n ** 7n - 1n,
	MinInt8: -(2n ** 7n),
	MaxInt16: 2n ** 15n - 1n,
	MinInt16: -(2n ** 15n),
	MaxInt32: 2n ** 31n - 1n,
	MinInt32: -(2n ** 31n),
	MaxInt64: 2n ** 63n - 1n,
	MinInt64: -(2n ** 63n),
	MaxUint8: 2n ** 8n - 1n,
	MaxUint16: 2n ** 16n - 1n,
	MaxUint32: 2n ** 32n - 1n,
	MaxUint64: 2n ** 64n - 1n,
};

export const intConst = (v) => ({ k: INT, v });

// Exact integer value of a decimal float literal (`1e18`, `2.50e1`), or null.
function exactIntOfFloatText(text) {
	const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
	if (!m) return null;
	const frac = m[2] ?? "";
	const digits = `${m[1]}${frac}` || "0";
	const exp = Number(m[3] ?? 0) - frac.length;
	if (exp > 400) return null;
	if (exp >= 0) return BigInt(digits) * 10n ** BigInt(exp);
	const cut = digits.length + exp;
	if (!/^0*$/.test(digits.slice(Math.max(cut, 0)))) return null;
	return cut > 0 ? BigInt(digits.slice(0, cut)) : 0n;
}

export function constFromLit(lit) {
	switch (lit.litKind) {
		case INT: {
			const s = String(lit.value).replaceAll("_", "");
			const clean = /^0[0-7]+$/.test(s) ? `0o${s.slice(1)}` : s;
			return { k: INT, v: BigInt(clean) };
		}
		case FLOAT: {
			const s = String(lit.value).replaceAll("_", "");
			const n = Number(s);
			if (!Number.isFinite(n)) return null;
			const i = exactIntOfFloatText(s);
			return i === null ? { k: FLOAT, v: n } : { k: FLOAT, v: n, i };
		}
		case STRING:
			return { k: STRING, v: String(lit.value ?? "") };
		case BOOL:
			return { k: BOOL, v: lit.value === "true" || lit.value === true };
		default:
			return null;
	}
}

export function constToLit(val) {
	switch (val.k) {
		case INT:
			return { kind: "BasicLit", litKind: INT, value: val.v.toString() };
		case FLOAT:
			return {
				kind: "BasicLit",
				litKind: FLOAT,
				value: Object.is(val.v, -0) ? "-0" : String(val.v),
			};
		case STRING:
			return { kind: "BasicLit", litKind: STRING, value: val.v };
		default:
			return {
				kind: "BasicLit",
				litKind: BOOL,
				value: val.v ? "true" : "false",
			};
	}
}

// Exact integer value of an INT or integral FLOAT, else null.
export function constIntValue(val) {
	if (val?.k === INT) return val.v;
	if (val?.k !== FLOAT) return null;
	if (val.i !== undefined) return val.i;
	return Number.isInteger(val.v) ? BigInt(val.v) : null;
}

function asFloat(val) {
	return val.k === INT ? Number(val.v) : val.v;
}

// An integer result typed `t` that does not fit is an overflow.
function typedInt(v, t) {
	const range = t ? INT_RANGES[t] : null;
	if (range && (v < range[0] || v > range[1]))
		return { k: INT, v, t, overflow: true };
	return t ? { k: INT, v, t } : { k: INT, v };
}

function typedFloat(v, t) {
	if (!Number.isFinite(v)) return null;
	const r = t === "float32" ? Math.fround(v) : v;
	return t ? { k: FLOAT, v: r, t } : { k: FLOAT, v: r };
}

export function foldUnary(op, x) {
	if (op === "+" && (x.k === INT || x.k === FLOAT)) return x;
	if (op === "!" && x.k === BOOL) return { ...x, v: !x.v };
	if (op === "-" && x.k === INT) return typedInt(-x.v, x.t);
	if (op === "-" && x.k === FLOAT) {
		const r = typedFloat(-x.v, x.t);
		return r && x.i !== undefined ? { ...r, i: -x.i } : r;
	}
	if (op === "^" && x.k === INT) {
		// Unsigned: flip the bits of the type's width; otherwise -x-1.
		const range = x.t ? INT_RANGES[x.t] : null;
		if (range && range[0] === 0n) return { k: INT, v: range[1] ^ x.v, t: x.t };
		return typedInt(~x.v, x.t);
	}
	return null;
}

function compare(op, a, b) {
	switch (op) {
		case "==":
			return a === b;
		case "!=":
			return a !== b;
		case "<":
			return a < b;
		case "<=":
			return a <= b;
		case ">":
			return a > b;
		case ">=":
			return a >= b;
		default:
			return null;
	}
}

function foldInts(op, a, b, t) {
	switch (op) {
		case "+":
			return typedInt(a + b, t);
		case "-":
			return typedInt(a - b, t);
		case "*":
			return typedInt(a * b, t);
		case "/":
			if (b === 0n) throw new Error("invalid operation: division by zero");
			return typedInt(a / b, t);
		case "%":
			if (b === 0n) throw new Error("invalid operation: division by zero");
			return typedInt(a % b, t);
		case "&":
			return typedInt(a & b, t);
		case "|":
			return typedInt(a | b, t);
		case "^":
			return typedInt(a ^ b, t);
		case "&^":
			return typedInt(a & ~b, t);
		default: {
			const r = compare(op, a, b);
			return r === null ? null : { k: BOOL, v: r };
		}
	}
}

function foldFloats(op, a, b, t) {
	// Untyped integral operands stay exact for + - * (`1e18 + 1`).
	const ai = t ? null : constIntValue(a);
	const bi = t ? null : constIntValue(b);
	if (ai !== null && bi !== null && (op === "+" || op === "-" || op === "*")) {
		const i = op === "+" ? ai + bi : op === "-" ? ai - bi : ai * bi;
		return { k: FLOAT, v: Number(i), i };
	}
	const x = asFloat(a);
	const y = asFloat(b);
	switch (op) {
		case "+":
			return typedFloat(x + y, t);
		case "-":
			return typedFloat(x - y, t);
		case "*":
			return typedFloat(x * y, t);
		case "/":
			if (y === 0) throw new Error("invalid operation: division by zero");
			return typedFloat(x / y, t);
		default: {
			const r = compare(op, x, y);
			return r === null ? null : { k: BOOL, v: r };
		}
	}
}

function foldShift(op, a, b) {
	const n = constIntValue(b);
	const x = constIntValue(a);
	if (n === null || x === null) return null;
	if (n < 0n) throw new Error("invalid shift count: negative shift count");
	if (n > MAX_SHIFT) return null;
	return typedInt(op === "<<" ? x << n : x >> n, a.t);
}

function foldBools(op, a, b) {
	if (op === "&&") return { k: BOOL, v: a.v && b.v };
	if (op === "||") return { k: BOOL, v: a.v || b.v };
	const r = op === "==" || op === "!=" ? compare(op, a.v, b.v) : null;
	return r === null ? null : { k: BOOL, v: r };
}

function foldStrings(op, a, b) {
	if (op === "+") return { k: STRING, v: a.v + b.v, t: a.t ?? b.t };
	const r = compare(op, a.v, b.v);
	return r === null ? null : { k: BOOL, v: r };
}

export function foldBinary(op, a, b) {
	if (op === "<<" || op === ">>") return foldShift(op, a, b);
	if (a.k === BOOL && b.k === BOOL) return foldBools(op, a, b);
	if (a.k === STRING && b.k === STRING) return foldStrings(op, a, b);
	const t = a.t ?? b.t;
	const numeric = (x) => x.k === INT || x.k === FLOAT;
	if (!numeric(a) || !numeric(b)) return null;
	if (FLOAT_TYPES.has(t) || (!t && (a.k === FLOAT || b.k === FLOAT)))
		return foldFloats(op, a, b, t);
	const ai = constIntValue(a);
	const bi = constIntValue(b);
	if (ai === null || bi === null) return foldFloats(op, a, b, t);
	return foldInts(op, ai, bi, t);
}

// Converts `val` to the basic type `name`.  Returns the typed value, a value
// with `overflow: true` when an integer does not fit, or null when the
// conversion is not a constant one this folder handles.
export function convertConst(val, name) {
	if (INT_RANGES[name]) {
		const i = constIntValue(val);
		return i === null ? null : typedInt(i, name);
	}
	if (FLOAT_TYPES.has(name)) {
		if (val.k !== INT && val.k !== FLOAT) return null;
		return typedFloat(asFloat(val), name);
	}
	if (name === "string") {
		if (val.k === STRING) return { k: STRING, v: val.v, t: name };
		const i = constIntValue(val);
		if (val.k !== INT || i === null) return null;
		const valid = i >= 0n && i <= 0x10ffffn && !(i >= 0xd800n && i <= 0xdfffn);
		return {
			k: STRING,
			v: valid ? String.fromCodePoint(Number(i)) : "�",
			t: name,
		};
	}
	if (name === "bool" && val.k === BOOL) return { k: BOOL, v: val.v, t: name };
	return null;
}

// min/max over constants of one kind.
export function foldMinMax(isMin, vals) {
	let best = vals[0];
	for (const x of vals.slice(1)) {
		const less = foldBinary("<", x, best);
		if (!less) return null;
		if (less.v === isMin) best = x;
	}
	return best;
}

function foldExpr(expr, resolve) {
	switch (expr?.kind) {
		case "BasicLit":
			return constFromLit(expr);
		case "Ident": {
			if (expr.name === "true" || expr.name === "false")
				return { k: BOOL, v: expr.name === "true" };
			const lit = resolve(expr.name);
			return lit ? constFromLit(lit) : null;
		}
		case "ParenExpr":
			return foldExpr(expr.expr, resolve);
		case "UnaryExpr": {
			const x = foldExpr(expr.operand, resolve);
			return x ? foldUnary(expr.op, x) : null;
		}
		case "BinaryExpr": {
			const a = foldExpr(expr.left, resolve);
			const b = a ? foldExpr(expr.right, resolve) : null;
			return a && b ? foldBinary(expr.op, a, b) : null;
		}
		case "CallExpr": {
			if (expr.func?.kind !== "Ident" || expr.func.name !== "len") return null;
			if (expr.args?.length !== 1) return null;
			const s = foldExpr(expr.args[0], resolve);
			if (s?.k !== STRING) return null;
			// Gofront strings across JS and WASM runtime use UTF-16 code units (s.length).
			return { k: INT, v: BigInt(s.v.length) };
		}
		default:
			return null;
	}
}

// Folds `expr` into a BasicLit, or returns null when it needs the runtime.
// `resolve(name)` yields the BasicLit of an already-folded constant, if any.
// Throws on a constant division by zero or a negative shift count.
export function foldConstExpr(expr, resolve) {
	const val = foldExpr(expr, resolve);
	return val && !val.overflow ? constToLit(val) : null;
}
