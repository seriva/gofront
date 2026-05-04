// CodeGen for Go `strings` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const STRINGS_M1 = {
	ToUpper: "toUpperCase",
	ToLower: "toLowerCase",
	TrimSpace: "trim",
	ToTitle: "toUpperCase",
};
const STRINGS_M2 = {
	Contains: "includes",
	HasPrefix: "startsWith",
	HasSuffix: "endsWith",
	Index: "indexOf",
	LastIndex: "lastIndexOf",
	Repeat: "repeat",
	Split: "split",
	Join: "join",
};
const STRINGS_DISPATCH = {
	Count: ([s, s2]) =>
		`((s, sep) => sep === "" ? s.length + 1 : s.split(sep).length - 1)(${s}, ${s2})`,
	Replace: ([s, s2, s3]) => `${s}.replace(${s2}, ${s3})`,
	ReplaceAll: ([s, s2, s3]) => `${s}.replaceAll(${s2}, ${s3})`,
	Trim: ([s, s2]) =>
		`${s}.replace(new RegExp(\`^[\${${s2}}]+|[\${${s2}}]+$\`, "g"), "")`,
	TrimPrefix: ([s, s2]) =>
		`((s, pre) => s.startsWith(pre) ? s.slice(pre.length) : s)(${s}, ${s2})`,
	TrimSuffix: ([s, s2]) =>
		`((s, suf) => !suf.length || !s.endsWith(suf) ? s : s.slice(0, -suf.length))(${s}, ${s2})`,
	TrimLeft: ([s, s2]) => `${s}.replace(new RegExp(\`^[\${${s2}}]+\`), "")`,
	TrimRight: ([s, s2]) => `${s}.replace(new RegExp(\`[\${${s2}}]+$\`), "")`,
	EqualFold: ([s, s2]) => `${s}.toLowerCase() === ${s2}.toLowerCase()`,
	Fields: ([s]) => `(${s}).trim() === '' ? [] : (${s}).trim().split(/\\s+/)`,
	Cut: ([s, s2]) =>
		`((s, sep) => { const i = s.indexOf(sep); return i < 0 ? [s, "", false] : [s.slice(0, i), s.slice(i + sep.length), true]; })(${s}, ${s2})`,
	CutPrefix: ([s, s2]) =>
		`(${s}).startsWith(${s2}) ? [(${s}).slice((${s2}).length), true] : [${s}, false]`,
	CutSuffix: ([s, s2]) =>
		`(${s}).endsWith(${s2}) ? [(${s}).slice(0, -(${s2}).length), true] : [${s}, false]`,
	SplitN: ([s, s2, s3]) =>
		`((s, sep, n) => { if (n === 0) return []; if (n < 0) return s.split(sep); const r = []; let cur = s; for (let i = 1; i < n && cur.length; i++) { const j = cur.indexOf(sep); if (j < 0) break; r.push(cur.slice(0, j)); cur = cur.slice(j + sep.length); } r.push(cur); return r; })(${s}, ${s2}, ${s3})`,
	SplitAfter: ([s, s2]) =>
		`((s, sep) => { if (sep === "") return [...s]; const r = []; let cur = s; while (cur.length) { const j = cur.indexOf(sep); if (j < 0) { r.push(cur); break; } r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } return r; })(${s}, ${s2})`,
	SplitAfterN: ([s, s2, s3]) =>
		`((s, sep, n) => { if (n === 0) return []; if (n < 0 || sep === "") return ((s, sep) => { if (sep === "") return [...s]; const r = []; let cur = s; while (cur.length) { const j = cur.indexOf(sep); if (j < 0) { r.push(cur); break; } r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } return r; })(s, sep); const r = []; let cur = s; for (let i = 1; i < n && cur.length; i++) { const j = cur.indexOf(sep); if (j < 0) break; r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } r.push(cur); return r; })(${s}, ${s2}, ${s3})`,
	IndexAny: ([s, s2]) =>
		`((s, chars) => { let m = -1; for (const c of chars) { const i = s.indexOf(c); if (i >= 0 && (m < 0 || i < m)) m = i; } return m; })(${s}, ${s2})`,
	LastIndexAny: ([s, s2]) =>
		`((s, chars) => { let m = -1; for (const c of chars) { const i = s.lastIndexOf(c); if (i > m) m = i; } return m; })(${s}, ${s2})`,
	ContainsAny: ([s, s2]) => `[...(${s2})].some(c => (${s}).includes(c))`,
	ContainsRune: ([s, s2]) => `(${s}).includes(String.fromCodePoint(${s2}))`,
	IndexRune: ([s, s2]) => `(${s}).indexOf(String.fromCodePoint(${s2}))`,
	IndexByte: ([s, s2]) => `(${s}).indexOf(String.fromCharCode(${s2}))`,
	LastIndexByte: ([s, s2]) => `(${s}).lastIndexOf(String.fromCharCode(${s2}))`,
	Map: ([s, s2]) =>
		`[...(${s2})].map(c => String.fromCodePoint((${s})(c.codePointAt(0)))).join("")`,
	Title: ([s]) => `(${s}).replace(/\\b\\w/g, c => c.toUpperCase())`,
	TrimFunc: ([s, s2]) =>
		`((s, f) => { let l = 0, r = s.length; while (l < r && f(s.codePointAt(l))) l++; while (r > l && f(s.codePointAt(r - 1))) r--; return s.slice(l, r); })(${s}, ${s2})`,
	TrimLeftFunc: ([s, s2]) =>
		`((s, f) => { let l = 0; while (l < s.length && f(s.codePointAt(l))) l++; return s.slice(l); })(${s}, ${s2})`,
	TrimRightFunc: ([s, s2]) =>
		`((s, f) => { let r = s.length; while (r > 0 && f(s.codePointAt(r - 1))) r--; return s.slice(0, r); })(${s}, ${s2})`,
	IndexFunc: ([s, s2]) =>
		`((s, f) => { for (let i = 0; i < s.length; i++) { const cp = s.codePointAt(i); if (f(cp)) return i; if (cp > 0xFFFF) i++; } return -1; })(${s}, ${s2})`,
	LastIndexFunc: ([s, s2]) =>
		`((s, f) => { for (let i = s.length - 1; i >= 0; i--) { const cp = s.codePointAt(i); if (f(cp)) return i; } return -1; })(${s}, ${s2})`,
	NewReader: ([s]) =>
		`{_src: ${s}, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src.charCodeAt(this._pos + i); this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(s) { this._src = s; this._pos = 0; }}`,
	NewReplacer: (args) =>
		`((...pairs) => { const p = []; for (let i = 0; i < pairs.length; i += 2) p.push([pairs[i], pairs[i+1]]); return { _p: p, Replace(s) { let r = s; for (const [o, n] of this._p) r = r.split(o).join(n); return r; } }; })(${args.join(", ")})`,
};

/** @type {ThisType<CodeGen>} */
export const stringsMethods = {
	_genStrings(fn, a) {
		const args = a();
		const [s, s2] = args;
		if (STRINGS_M1[fn]) return `${s}.${STRINGS_M1[fn]}()`;
		if (STRINGS_M2[fn]) return `${s}.${STRINGS_M2[fn]}(${s2})`;
		const gen = STRINGS_DISPATCH[fn];
		return gen ? gen(args) : undefined;
	},
};
