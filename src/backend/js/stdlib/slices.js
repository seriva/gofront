// CodeGen for Go `slices` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const SLICES_DISPATCH = {
	Contains: (a) => `${a[0]}.includes(${a[1]})`,
	Index: (a) => `${a[0]}.indexOf(${a[1]})`,
	Compare: (a) =>
		`((a, b) => { a = a || []; b = b || []; for (let i = 0; i < a.length && i < b.length; i++) { const x = a[i], y = b[i]; const xN = typeof x === "number" && isNaN(x), yN = typeof y === "number" && isNaN(y); if (xN && yN) continue; if (xN) return -1; if (yN) return 1; if (x < y) return -1; if (x > y) return 1; } return a.length < b.length ? -1 : a.length > b.length ? 1 : 0; })(${a[0]}, ${a[1]})`,
	Sort: (a) =>
		`(${a[0]} ? ${a[0]}.sort((a, b) => a < b ? -1 : a > b ? 1 : 0) : null)`,
	SortFunc: (a) => `(${a[0]} ? ${a[0]}.sort(${a[1]}) : null)`,
	SortStableFunc: (a) => `(${a[0]} ? ${a[0]}.sort(${a[1]}) : null)`,
	IsSorted: (a) =>
		`((s) => { s = s || []; for (let i = 0; i < s.length; i++) { if (typeof s[i] === "number" && isNaN(s[i])) return false; if (i > 0 && s[i] < s[i-1]) return false; } return true; })(${a[0]})`,
	IsSortedFunc: (a) =>
		`((s, f) => { s = s || []; for (let i = 1; i < s.length; i++) { if (f(s[i], s[i-1]) < 0) return false; } return true; })(${a[0]}, ${a[1]})`,
	Reverse: (a) => `(${a[0]} ? ${a[0]}.reverse() : null)`,
	Max: (a) =>
		`((s) => { if (!s || s.length === 0) throw new Error("slices.Max: empty list"); let m = s[0]; for (let i = 1; i < s.length; i++) { const x = s[i]; if ((typeof x === "number" && isNaN(x)) || x > m || (x === 0 && m === 0 && Object.is(m, -0) && !Object.is(x, -0))) m = x; } return m; })(${a[0]})`,
	Min: (a) =>
		`((s) => { if (!s || s.length === 0) throw new Error("slices.Min: empty list"); let m = s[0]; for (let i = 1; i < s.length; i++) { const x = s[i]; if ((typeof x === "number" && isNaN(x)) || x < m || (x === 0 && m === 0 && Object.is(x, -0))) m = x; } return m; })(${a[0]})`,
	MaxFunc: (a) =>
		`((s, f) => { if (!s || s.length === 0) throw new Error("slices.MaxFunc: empty list"); return s.reduce((m, x) => f(x, m) > 0 ? x : m); })(${a[0]}, ${a[1]})`,
	MinFunc: (a) =>
		`((s, f) => { if (!s || s.length === 0) throw new Error("slices.MinFunc: empty list"); return s.reduce((m, x) => f(x, m) < 0 ? x : m); })(${a[0]}, ${a[1]})`,
	Clone: (a) => `(${a[0]} ? ${a[0]}.slice() : null)`,
	Compact: (a) =>
		`((s) => { s = s || []; let i = 1; while (i < s.length) { if (s[i] === s[i-1]) { s.splice(i, 1); } else { i++; } } return s; })(${a[0]})`,
	CompactFunc: (a) =>
		`((s, f) => { s = s || []; let i = 1; while (i < s.length) { if (f(s[i], s[i-1])) { s.splice(i, 1); } else { i++; } } return s; })(${a[0]}, ${a[1]})`,
	Concat: (a) =>
		a.length === 0
			? "null"
			: `[].concat(${a.map((x) => `(${x} || [])`).join(", ")})`,
	Delete: (a) =>
		`((s, i, j) => { s = s || []; if (i < 0 || j < i || j > s.length) throw new Error("runtime error: slice bounds out of range"); s.splice(i, j - i); return s; })(${a[0]}, ${a[1]}, ${a[2]})`,
	DeleteFunc: (a) =>
		`((s, f) => { s = s || []; let i = 0; while (i < s.length) { if (f(s[i])) { s.splice(i, 1); } else { i++; } } return s; })(${a[0]}, ${a[1]})`,
	Insert: (a) => {
		const items = a.slice(2);
		return `((s, i, ...v) => { s = s || []; if (i < 0 || i > s.length) throw new Error("runtime error: slice bounds out of range"); s.splice(i, 0, ...v); return s; })(${a[0]}, ${a[1]}${items.length ? `, ${items.join(", ")}` : ""})`;
	},
	Replace: (a) => {
		const items = a.slice(3);
		return `((s, i, j, ...v) => { s = s || []; if (i < 0 || j < i || j > s.length) throw new Error("runtime error: slice bounds out of range"); s.splice(i, j - i, ...v); return s; })(${a[0]}, ${a[1]}, ${a[2]}${items.length ? `, ${items.join(", ")}` : ""})`;
	},
	Grow: (a) =>
		`((s, n) => { if (n < 0) throw new Error("runtime error: makeslice: len out of range"); return s ? s.slice() : []; })(${a[0]}, ${a[1]})`,
	Clip: (a) => `(${a[0]} ? ${a[0]}.slice() : null)`,
};

/** @type {ThisType<CodeGen>} */
export const slicesMethods = {
	_genSlices(fn, a) {
		if (fn === "Equal") {
			this.useHelper("equal");
			const [a1, b1] = a();
			return `__equal(${a1}, ${b1})`;
		}
		const gen = SLICES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
