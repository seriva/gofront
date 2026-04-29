// CodeGen for Go `math` package.

const MATH1 = {
	Abs: "abs",
	Floor: "floor",
	Ceil: "ceil",
	Round: "round",
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
};
const MATH2 = {
	Pow: "pow",
	Min: "min",
	Max: "max",
	Atan2: "atan2",
	Hypot: "hypot",
};
const MATH_EXTRA = {
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
	Remainder: ([x, y]) => `(${x} - Math.round(${x} / ${y}) * ${y})`,
};

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
