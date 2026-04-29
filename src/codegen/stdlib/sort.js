// CodeGen for Go `sort` package.

const SORT_DISPATCH = {
	Ints: (a) => `${a[0]}.sort((a, b) => a - b)`,
	Float64s: (a) => `${a[0]}.sort((a, b) => a - b)`,
	Strings: (a) => `${a[0]}.sort()`,
	Slice: (a) =>
		`${a[0]}.sort((a, b) => ${a[1]}(a, b) ? -1 : ${a[1]}(b, a) ? 1 : 0)`,
	SliceStable: (a) =>
		`${a[0]}.sort((a, b) => ${a[1]}(a, b) ? -1 : ${a[1]}(b, a) ? 1 : 0)`,
	SliceIsSorted: (a) =>
		`${a[0]}.every((v, i, a) => i === 0 || ${a[1]}(a[i - 1], v))`,
	Search: (a) =>
		`((n, f) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >>> 1; if (f(mid)) hi = mid; else lo = mid + 1; } return lo; })(${a[0]}, ${a[1]})`,
	IntsAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
	Float64sAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
	StringsAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
};

export const sortMethods = {
	_genSort(fn, a) {
		const gen = SORT_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
