// CodeGen for Go `math` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const MATH1 = {
	Abs: "abs",
	Floor: "floor",
	Ceil: "ceil",
	Sqrt: "sqrt",
	Cbrt: "cbrt",
	Log: "log",
	Log1p: "log1p",
	Log2: "log2",
	Log10: "log10",
	Expm1: "expm1",
	Sin: "sin",
	Cos: "cos",
	Tan: "tan",
	Atan: "atan",
	Asin: "asin",
	Acos: "acos",
	Exp: "exp",
	Trunc: "trunc",
	Sinh: "sinh",
	Cosh: "cosh",
	Tanh: "tanh",
};
const MATH2 = {
	Pow: "pow",
	Min: "min",
	Max: "max",
	Atan2: "atan2",
	Hypot: "hypot",
};
const MATH_EXTRA = {
	// Go rounds half away from zero; Math.round rounds half toward +Infinity.
	Round: ([x]) => `(Math.sign(${x}) * Math.round(Math.abs(${x})))`,
	Mod: ([x, y]) => `${x} % ${y}`,
	Inf: ([x]) => `(${x} >= 0 ? Infinity : -Infinity)`,
	IsNaN: ([x]) => `Number.isNaN(${x})`,
	IsInf: ([x, y]) =>
		`(${y} > 0 ? ${x} === Infinity : ${y} < 0 ? ${x} === -Infinity : !Number.isFinite(${x}))`,
	NaN: () => "NaN",
	Exp2: ([x]) => `Math.pow(2, ${x})`,
	Signbit: ([x]) => `(${x} < 0 || Object.is(${x}, -0))`,
	Copysign: ([x, y]) =>
		`(Math.abs(${x}) * (${y} < 0 || Object.is(${y}, -0) ? -1 : 1))`,
	Dim: ([x, y]) => `Math.max(${x} - ${y}, 0)`,
	Remainder: ([x, y]) =>
		`((x, y) => { if (isNaN(x) || isNaN(y) || y === 0 || !isFinite(x)) return NaN; if (!isFinite(y)) return x; const q = x / y; const r = Math.round(q); const diff = Math.abs(q - r); const n = (diff === 0.5 && (r % 2 !== 0)) ? (r < q ? r + 1 : r - 1) : r; return x - n * y; })(${x}, ${y})`,
	Frexp: ([x]) =>
		`((f) => { if (f === 0 || !Number.isFinite(f)) return [f, 0]; const buf = new ArrayBuffer(8); const f64 = new Float64Array(buf); const u32 = new Uint32Array(buf); f64[0] = f; let hi = u32[1]; let exp = (hi >>> 20) & 0x7ff; if (exp === 0) { f64[0] = f * Math.pow(2, 54); hi = u32[1]; exp = ((hi >>> 20) & 0x7ff) - 54; } exp -= 1022; u32[1] = (hi & 0x800fffff) | 0x3fe00000; return [f64[0], exp]; })(${x})`,
	Ldexp: ([frac, exp]) =>
		`((frac, exp) => { if (frac === 0 || !Number.isFinite(frac)) return frac; if (exp > 1023) return frac < 0 ? -Infinity : Infinity; if (exp < -1074) return frac < 0 ? -0 : 0; if (exp >= -1022) return frac * Math.pow(2, exp); return frac * Math.pow(2, exp + 54) * Math.pow(2, -54); })(${frac}, ${exp})`,
	Modf: ([f]) =>
		`((x) => { if (Number.isNaN(x)) return [NaN, NaN]; if (!Number.isFinite(x)) return [x, NaN]; const i = Math.trunc(x); const frac = Object.is(x, -0) ? -0 : x - i; return [i, frac]; })(${f})`,
	FMA: ([x, y, z]) =>
		`((x, y, z) => { if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return NaN; if ((x === 0 && !Number.isFinite(y)) || (y === 0 && !Number.isFinite(x))) return NaN; const p = x * y; if (!Number.isFinite(p) && !Number.isFinite(z) && ((p > 0 && z < 0) || (p < 0 && z > 0))) return NaN; return p + z; })(${x}, ${y}, ${z})`,
	RoundToEven: ([x]) =>
		`((x) => { if (x === 0 || !Number.isFinite(x)) return x; const t = Math.trunc(x); const f = Math.abs(x - t); if (f < 0.5) return Object.is(t, 0) && (x < 0 || Object.is(x, -0)) ? -0 : t; if (f > 0.5) return x > 0 ? t + 1 : t - 1; const res = t % 2 === 0 ? t : (x > 0 ? t + 1 : t - 1); return Object.is(res, 0) && (x < 0 || Object.is(x, -0)) ? -0 : res; })(${x})`,
	Nextafter: ([x, y]) =>
		`((x, y) => { if (Number.isNaN(x) || Number.isNaN(y)) return NaN; if (x === y) return x; if (x === 0) { const s = Number.MIN_VALUE; return y > 0 ? s : -s; } const buf = new ArrayBuffer(8); const f64 = new Float64Array(buf); const i64 = new BigInt64Array(buf); f64[0] = x; let b = i64[0]; if ((x > 0 && y > x) || (x < 0 && y > x)) b = b + (x > 0 ? 1n : -1n); else b = b + (x > 0 ? -1n : 1n); i64[0] = b; return f64[0]; })(${x}, ${y})`,
	Nextafter32: ([x, y]) =>
		`((x, y) => { if (Number.isNaN(x) || Number.isNaN(y)) return NaN; if (x === y) return x; if (x === 0) { const s = 1.401298464324817e-45; return y > 0 ? s : -s; } const buf = new ArrayBuffer(4); const f32 = new Float32Array(buf); const i32 = new Int32Array(buf); f32[0] = x; let b = i32[0]; if ((x > 0 && y > x) || (x < 0 && y > x)) b = b + (x > 0 ? 1 : -1); else b = b + (x > 0 ? -1 : 1); i32[0] = b; return f32[0]; })(${x}, ${y})`,
	Float64bits: ([x]) =>
		`((f) => { const b = new ArrayBuffer(8); new Float64Array(b)[0] = f; return Number(new BigUint64Array(b)[0]); })(${x})`,
	Float64frombits: ([b]) =>
		`((u) => { const buf = new ArrayBuffer(8); new BigUint64Array(buf)[0] = BigInt(u); return new Float64Array(buf)[0]; })(${b})`,
	Float32bits: ([x]) =>
		`((f) => { const b = new ArrayBuffer(4); new Float32Array(b)[0] = f; return new Uint32Array(b)[0]; })(${x})`,
	Float32frombits: ([b]) =>
		`((u) => { const buf = new ArrayBuffer(4); new Uint32Array(buf)[0] = Number(u) >>> 0; return new Float32Array(buf)[0]; })(${b})`,
};

/** @type {ThisType<CodeGen>} */
export const mathMethods = {
	_genMath(fn, a) {
		const args = a();
		const [x, y] = args;
		if (MATH1[fn]) return `Math.${MATH1[fn]}(${x})`;
		if (MATH2[fn]) return `Math.${MATH2[fn]}(${x}, ${y})`;
		const gen = MATH_EXTRA[fn];
		return gen ? gen(args) : undefined;
	},
};
