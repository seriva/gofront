// CodeGen for Go `sort` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const SORT_DISPATCH = {
	Ints: (a) => `${a[0]}.sort((a, b) => a - b)`,
	Float64s: (a) => `${a[0]}.sort((a, b) => a - b)`,
	Strings: (a) => `${a[0]}.sort()`,
	Slice: (a) => `__sortSlice(${a[0]}, ${a[1]})`,
	SliceStable: (a) => `__sortSlice(${a[0]}, ${a[1]})`,
	SliceIsSorted: (a) =>
		`((s, less) => { for (let i = (s?.length ?? 0) - 1; i > 0; i--) if (less(i, i - 1)) return false; return true; })(${a[0]}, ${a[1]})`,
	Search: (a) =>
		`((n, f) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >>> 1; if (f(mid)) hi = mid; else lo = mid + 1; } return lo; })(${a[0]}, ${a[1]})`,
	IntsAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
	Float64sAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
	StringsAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
};

/** @type {ThisType<CodeGen>} */
export const sortMethods = {
	_genSort(fn, a) {
		if (fn === "Slice" || fn === "SliceStable") this.useHelper("sortSlice");
		const gen = SORT_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
