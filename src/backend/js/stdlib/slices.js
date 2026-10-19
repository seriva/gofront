import { isTypedArraySlice } from "../../../typechecker/types.js";

/** @typedef {import('../index.js').CodeGen} CodeGen */

const SLICES_DISPATCH = {
	Contains: (a) => `${a[0]}.includes(${a[1]})`,
	ContainsFunc: (a) =>
		`((s, f) => { s = s || []; for (let i = 0; i < s.length; i++) { if (f(s[i])) return true; } return false; })(${a[0]}, ${a[1]})`,
	Index: (a) => `${a[0]}.indexOf(${a[1]})`,
	IndexFunc: (a) =>
		`((s, f) => { s = s || []; for (let i = 0; i < s.length; i++) { if (f(s[i])) return i; } return -1; })(${a[0]}, ${a[1]})`,
	BinarySearch: (a) =>
		`((s, target) => { s = s || []; let i = 0, j = s.length; while (i < j) { const h = (i + j) >>> 1; if (s[h] < target) i = h + 1; else j = h; } return [i, i < s.length && s[i] === target]; })(${a[0]}, ${a[1]})`,
	BinarySearchFunc: (a) =>
		`((s, target, cmp) => { s = s || []; let i = 0, j = s.length; while (i < j) { const h = (i + j) >>> 1; if (cmp(s[h], target) < 0) i = h + 1; else j = h; } return [i, i < s.length && cmp(s[i], target) === 0]; })(${a[0]}, ${a[1]}, ${a[2]})`,
	Compare: (a) =>
		`((a, b) => { a = a || []; b = b || []; for (let i = 0; i < a.length && i < b.length; i++) { const x = a[i], y = b[i]; const xN = typeof x === "number" && isNaN(x), yN = typeof y === "number" && isNaN(y); if (xN && yN) continue; if (xN) return -1; if (yN) return 1; if (x < y) return -1; if (x > y) return 1; } return a.length < b.length ? -1 : a.length > b.length ? 1 : 0; })(${a[0]}, ${a[1]})`,
	Sort: (a) =>
		`((s) => s ? s.sort((a, b) => a < b ? -1 : a > b ? 1 : 0) : null)(${a[0]})`,
	SortFunc: (a) => `((s, f) => s ? s.sort(f) : null)(${a[0]}, ${a[1]})`,
	SortStableFunc: (a) => `((s, f) => s ? s.sort(f) : null)(${a[0]}, ${a[1]})`,
	IsSorted: (a) =>
		`((s) => { s = s || []; for (let i = 0; i < s.length; i++) { if (typeof s[i] === "number" && isNaN(s[i])) return false; if (i > 0 && s[i] < s[i-1]) return false; } return true; })(${a[0]})`,
	IsSortedFunc: (a) =>
		`((s, f) => { s = s || []; for (let i = 1; i < s.length; i++) { if (f(s[i], s[i-1]) < 0) return false; } return true; })(${a[0]}, ${a[1]})`,
	Reverse: (a) => `((s) => s ? s.reverse() : null)(${a[0]})`,
	Max: (a) =>
		`((s) => { if (!s || s.length === 0) throw new Error("slices.Max: empty list"); let m = s[0]; for (let i = 1; i < s.length; i++) { const x = s[i]; if ((typeof x === "number" && isNaN(x)) || x > m || (x === 0 && m === 0 && Object.is(m, -0) && !Object.is(x, -0))) m = x; } return m; })(${a[0]})`,
	Min: (a) =>
		`((s) => { if (!s || s.length === 0) throw new Error("slices.Min: empty list"); let m = s[0]; for (let i = 1; i < s.length; i++) { const x = s[i]; if ((typeof x === "number" && isNaN(x)) || x < m || (x === 0 && m === 0 && Object.is(x, -0))) m = x; } return m; })(${a[0]})`,
	MaxFunc: (a) =>
		`((s, f) => { if (!s || s.length === 0) throw new Error("slices.MaxFunc: empty list"); return s.reduce((m, x) => f(x, m) > 0 ? x : m); })(${a[0]}, ${a[1]})`,
	MinFunc: (a) =>
		`((s, f) => { if (!s || s.length === 0) throw new Error("slices.MinFunc: empty list"); return s.reduce((m, x) => f(x, m) < 0 ? x : m); })(${a[0]}, ${a[1]})`,
	Clone: (a) => `((s) => s ? s.slice() : null)(${a[0]})`,
	Compact: (a) =>
		`((s) => { if (!s || s.length === 0) return s; let k = 1; for (let i = 1; i < s.length; i++) { if (s[i] !== s[k - 1]) s[k++] = s[i]; } return ArrayBuffer.isView(s) ? s.subarray(0, k) : (s.length = k, s); })(${a[0]})`,
	CompactFunc: (a) =>
		`((s, f) => { if (!s || s.length === 0) return s; let k = 1; for (let i = 1; i < s.length; i++) { if (!f(s[i], s[k - 1])) s[k++] = s[i]; } return ArrayBuffer.isView(s) ? s.subarray(0, k) : (s.length = k, s); })(${a[0]}, ${a[1]})`,
	Concat: (a) =>
		a.length === 0
			? "null"
			: `((...slices) => { const nonNull = slices.filter(Boolean); if (nonNull.length === 0) return slices[0] === null ? null : []; if (ArrayBuffer.isView(nonNull[0])) { const totalLen = nonNull.reduce((sum, s) => sum + s.length, 0); const out = new nonNull[0].constructor(totalLen); let off = 0; for (const s of nonNull) { out.set(s, off); off += s.length; } return out; } return [].concat(...slices.map(s => s ? (ArrayBuffer.isView(s) ? Array.from(s) : s) : [])); })(${a.map((x) => `(${x})`).join(", ")})`,
	Delete: (a) =>
		`((s, i, j) => { if (!s && i === 0 && j === 0) return s; s = s || []; if (i < 0 || j < i || j > s.length) throw new Error("runtime error: slice bounds out of range"); if (ArrayBuffer.isView(s)) { s.copyWithin(i, j); return s.subarray(0, s.length - (j - i)); } s.splice(i, j - i); return s; })(${a[0]}, ${a[1]}, ${a[2]})`,
	DeleteFunc: (a) =>
		`((s, f) => { if (!s || s.length === 0) return s; let k = 0; for (let i = 0; i < s.length; i++) { if (!f(s[i])) s[k++] = s[i]; } return ArrayBuffer.isView(s) ? s.subarray(0, k) : (s.length = k, s); })(${a[0]}, ${a[1]})`,
	Insert: (a, isTyped) => {
		const items = a.slice(2);
		const nilInit = isTyped ? "new Uint8Array(0)" : "[]";
		return `((s, i, ...v) => { if (!s && i === 0) s = ${nilInit}; if (!s || i < 0 || i > s.length) throw new Error("runtime error: slice bounds out of range"); if (ArrayBuffer.isView(s)) { const res = new s.constructor(s.length + v.length); res.set(s.subarray(0, i), 0); res.set(v, i); res.set(s.subarray(i), i + v.length); return res; } s.splice(i, 0, ...v); return s; })(${a[0]}, ${a[1]}${items.length ? `, ${items.join(", ")}` : ""})`;
	},
	Replace: (a, isTyped) => {
		const items = a.slice(3);
		const nilInit = isTyped ? "new Uint8Array(0)" : "[]";
		return `((s, i, j, ...v) => { if (!s && i === 0 && j === 0) s = ${nilInit}; if (!s || i < 0 || j < i || j > s.length) throw new Error("runtime error: slice bounds out of range"); if (ArrayBuffer.isView(s)) { const res = new s.constructor(s.length - (j - i) + v.length); res.set(s.subarray(0, i), 0); res.set(v, i); res.set(s.subarray(j), i + v.length); return res; } s.splice(i, j - i, ...v); return s; })(${a[0]}, ${a[1]}, ${a[2]}${items.length ? `, ${items.join(", ")}` : ""})`;
	},
	Grow: (a, isTyped) => {
		const nilInit = isTyped ? "new Uint8Array(0)" : "[]";
		return `((s, n) => { if (n < 0) throw new Error("runtime error: makeslice: len out of range"); if (!s) return ${nilInit}; return s.slice(); })(${a[0]}, ${a[1]})`;
	},
	Clip: (a) => `((s) => s ? s.slice() : null)(${a[0]})`,
};

/** @type {ThisType<CodeGen>} */
export const slicesMethods = {
	_genSlices(fn, a, expr) {
		if (fn === "Equal") {
			this.useHelper("equal");
			const [a1, b1] = a();
			return `__equal(${a1}, ${b1})`;
		}
		const isTyped = isTypedArraySlice(expr?.args?.[0]?._type);
		const gen = SLICES_DISPATCH[fn];
		return gen ? gen(a(), isTyped) : undefined;
	},
};
