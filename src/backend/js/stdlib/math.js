// CodeGen for Go `math` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const MATH1 = {
	Abs: "abs",
	Floor: "floor",
	Ceil: "ceil",
	Sqrt: "sqrt",
	Cbrt: "cbrt",
	Log: "log",
	Log2: "log2",
	Log10: "log10",
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
	Float64bits: ([x]) =>
		`((f) => { const b = new ArrayBuffer(8); new Float64Array(b)[0] = f; return new BigUint64Array(b)[0]; })(${x})`,
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
