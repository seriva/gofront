// CodeGen for Go `math/rand` package.

const RAND_DISPATCH = {
	Intn: (a) => `Math.floor(Math.random() * ${a[0]})`,
	Int63n: (a) => `Math.floor(Math.random() * ${a[0]})`,
	Int31n: (a) => `Math.floor(Math.random() * ${a[0]})`,
	Float64: () => "Math.random()",
	Float32: () => "Math.random()",
	Int: () => "Math.floor(Math.random() * 2147483647)",
	Int31: () => "Math.floor(Math.random() * 2147483647)",
	Int63: () => "Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)",
	Seed: () => "(void 0)",
	Shuffle: (a) =>
		`((n, f) => { for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); f(i, j); } })(${a[0]}, ${a[1]})`,
	Perm: (a) =>
		`((n) => { const a = Array.from({length: n}, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; })(${a[0]})`,
};

export const randMethods = {
	_genRand(fn, a) {
		const gen = RAND_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
