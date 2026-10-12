// CodeGen for Go `math/rand` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const RAND_DISPATCH = {
	Intn: (a) =>
		`((n) => { if (n <= 0) throw new Error("invalid argument to Intn"); return Math.floor(Math.random() * n); })(${a[0]})`,
	Int63n: (a) =>
		`((n) => { if (n <= 0) throw new Error("invalid argument to Int63n"); return Math.floor(Math.random() * n); })(${a[0]})`,
	Int31n: (a) =>
		`((n) => { if (n <= 0) throw new Error("invalid argument to Int31n"); return Math.floor(Math.random() * n); })(${a[0]})`,
	Float64: () => "Math.random()",
	Float32: () => "Math.random()",
	Int: () => "Math.floor(Math.random() * 2147483647)",
	Int31: () => "Math.floor(Math.random() * 2147483647)",
	Int63: () => "Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)",
	Seed: () => "(void 0)",
	Shuffle: (a) =>
		`((n, f) => { if (n < 0) throw new Error("invalid argument to Shuffle"); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); f(i, j); } })(${a[0]}, ${a[1]})`,
	Perm: (a) =>
		`((n) => { if (n < 0) throw new Error("invalid argument to Perm"); const a = Array.from({length: n}, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; })(${a[0]})`,
};

/** @type {ThisType<CodeGen>} */
export const randMethods = {
	_genRand(fn, a) {
		const gen = RAND_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
