// CodeGen for Go `slices` package.

const SLICES_DISPATCH = {
	Contains: (a) => `${a[0]}.includes(${a[1]})`,
	Index: (a) => `${a[0]}.indexOf(${a[1]})`,
	Compare: (a) =>
		`((a, b) => { for (let i = 0; i < a.length && i < b.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return a.length - b.length; })(${a[0]}, ${a[1]})`,
	Sort: (a) => `${a[0]}.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)`,
	SortFunc: (a) => `${a[0]}.sort(${a[1]})`,
	SortStableFunc: (a) => `${a[0]}.sort(${a[1]})`,
	IsSorted: (a) =>
		`((s) => { for (let i = 1; i < s.length; i++) { if (s[i] < s[i-1]) return false; } return true; })(${a[0]})`,
	IsSortedFunc: (a) =>
		`((s, f) => { for (let i = 1; i < s.length; i++) { if (f(s[i], s[i-1]) < 0) return false; } return true; })(${a[0]}, ${a[1]})`,
	Reverse: (a) => `${a[0]}.reverse()`,
	Max: (a) => `Math.max(...${a[0]})`,
	Min: (a) => `Math.min(...${a[0]})`,
	MaxFunc: (a) =>
		`((s, f) => s.reduce((m, x) => f(x, m) > 0 ? x : m))(${a[0]}, ${a[1]})`,
	MinFunc: (a) =>
		`((s, f) => s.reduce((m, x) => f(x, m) < 0 ? x : m))(${a[0]}, ${a[1]})`,
	Clone: (a) => `${a[0]}.slice()`,
	Compact: (a) =>
		`((s) => s.filter((v, i) => i === 0 || v !== s[i-1]))(${a[0]})`,
	CompactFunc: (a) =>
		`((s, f) => s.filter((v, i) => i === 0 || !f(v, s[i-1])))(${a[0]}, ${a[1]})`,
	Concat: (a) => `[].concat(${a.join(", ")})`,
	Delete: (a) => `[...${a[0]}.slice(0, ${a[1]}), ...${a[0]}.slice(${a[2]})]`,
	DeleteFunc: (a) => `${a[0]}.filter((v) => !${a[1]}(v))`,
	Insert: (a) =>
		`[...${a[0]}.slice(0, ${a[1]}), ${a.slice(2).join(", ")}, ...${a[0]}.slice(${a[1]})]`,
	Replace: (a) =>
		`[...${a[0]}.slice(0, ${a[1]}), ${a.slice(3).join(", ")}, ...${a[0]}.slice(${a[2]})]`,
	Grow: (a) => `${a[0]}.slice()`,
	Clip: (a) => `${a[0]}.slice()`,
};

export const slicesMethods = {
	_genSlices(fn, a) {
		if (fn === "Equal") {
			this._usesEqual = true;
			const [a1, b1] = a();
			return `__equal(${a1}, ${b1})`;
		}
		const gen = SLICES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
