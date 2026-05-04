// CodeGen for Go `bytes` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const __bs = `(b => String.fromCharCode(...b))`;
const __sb = `(s => [...s].map(c => c.charCodeAt(0)))`;

const BYTES_DISPATCH = {
	Contains: (a) => `${__bs}(${a[0]}).includes(${__bs}(${a[1]}))`,
	HasPrefix: (a) =>
		`((b, p) => { for (let i = 0; i < p.length; i++) if (b[i] !== p[i]) return false; return b.length >= p.length; })(${a[0]}, ${a[1]})`,
	HasSuffix: (a) =>
		`((b, s) => { const off = b.length - s.length; if (off < 0) return false; for (let i = 0; i < s.length; i++) if (b[off + i] !== s[i]) return false; return true; })(${a[0]}, ${a[1]})`,
	Index: (a) => `${__bs}(${a[0]}).indexOf(${__bs}(${a[1]}))`,
	Count: (a) =>
		`((b, sep) => sep.length === 0 ? b.length + 1 : ${__bs}(b).split(${__bs}(sep)).length - 1)(${a[0]}, ${a[1]})`,
	Repeat: (a) => `${__sb}(${__bs}(${a[0]}).repeat(${a[1]}))`,
	Replace: (a) =>
		`((b, o, n, cnt) => { let s = ${__bs}(b), os = ${__bs}(o), ns = ${__bs}(n); if (cnt < 0) return ${__sb}(s.replaceAll(os, ns)); for (let i = 0; i < cnt; i++) s = s.replace(os, ns); return ${__sb}(s); })(${a[0]}, ${a[1]}, ${a[2]}, ${a[3]})`,
	ToUpper: (a) => `${__sb}(${__bs}(${a[0]}).toUpperCase())`,
	ToLower: (a) => `${__sb}(${__bs}(${a[0]}).toLowerCase())`,
	TrimSpace: (a) => `${__sb}(${__bs}(${a[0]}).trim())`,
	Trim: (a) =>
		`${__sb}(${__bs}(${a[0]}).replace(new RegExp(\`^[\${${a[1]}}]+|[\${${a[1]}}]+$\`, "g"), ""))`,
	Equal: (a) =>
		`((a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; })(${a[0]}, ${a[1]})`,
	Split: (a) => `${__bs}(${a[0]}).split(${__bs}(${a[1]})).map(p => ${__sb}(p))`,
	Join: (a) => `${__sb}(${a[0]}.map(p => ${__bs}(p)).join(${__bs}(${a[1]})))`,
	ReplaceAll: (a) =>
		`((b, o, n) => { const r = []; let i = 0; while (i <= b.length - o.length) { if (o.every((v, j) => b[i + j] === v)) { r.push(...n); i += o.length; } else r.push(b[i++]); } return r.concat(b.slice(i)); })(${a[0]}, ${a[1]}, ${a[2]})`,
	TrimPrefix: (a) =>
		`((b, p) => p.every((v, i) => b[i] === v) ? b.slice(p.length) : b.slice())(${a[0]}, ${a[1]})`,
	TrimSuffix: (a) =>
		`((b, s) => s.length && s.every((v, i) => b[b.length - s.length + i] === v) ? b.slice(0, -s.length) : b.slice())(${a[0]}, ${a[1]})`,
	TrimLeft: (a) =>
		`((b, c) => { let i = 0; while (i < b.length && c.includes(String.fromCharCode(b[i]))) i++; return b.slice(i); })(${a[0]}, ${a[1]})`,
	TrimRight: (a) =>
		`((b, c) => { let i = b.length; while (i > 0 && c.includes(String.fromCharCode(b[i - 1]))) i--; return b.slice(0, i); })(${a[0]}, ${a[1]})`,
	TrimFunc: (a) =>
		`((b, f) => { let l = 0, r = b.length; while (l < r && f(b[l])) l++; while (r > l && f(b[r - 1])) r--; return b.slice(l, r); })(${a[0]}, ${a[1]})`,
	IndexByte: (a) => `(${a[0]}).indexOf(${a[1]})`,
	LastIndex: (a) =>
		`((b, s) => { for (let i = b.length - s.length; i >= 0; i--) if (s.every((v, j) => b[i + j] === v)) return i; return -1; })(${a[0]}, ${a[1]})`,
	LastIndexByte: (a) => `(${a[0]}).lastIndexOf(${a[1]})`,
	Fields: (a) =>
		`((b) => { const s = String.fromCharCode(...b).trim(); return s === '' ? [] : s.split(/\\s+/).map(w => [...w].map(c => c.charCodeAt(0))); })(${a[0]})`,
	Cut: (a) =>
		`((b, sep) => { for (let i = 0; i <= b.length - sep.length; i++) if (sep.every((v, j) => b[i + j] === v)) return [b.slice(0, i), b.slice(i + sep.length), true]; return [b.slice(), [], false]; })(${a[0]}, ${a[1]})`,
	ContainsAny: (a) =>
		`[...(${a[1]})].some(c => (${a[0]}).includes(c.charCodeAt(0)))`,
	ContainsRune: (a) => `(${a[0]}).includes(${a[1]})`,
	Map: (a) => `(${a[1]}).map(v => (${a[0]})(v))`,
	SplitN: (a) =>
		`((b, sep, n) => { if (n === 0) return []; if (n < 0) return ((b, sep) => { const r = []; let i = 0; while (i <= b.length) { const j = b.findIndex((_, k) => k >= i && sep.every((v, l) => b[k + l] === sep[l])); if (j < 0 || j >= b.length) break; r.push(b.slice(i, j)); i = j + sep.length; } r.push(b.slice(i)); return r; })(b, sep); const r = []; let i = 0; for (let c = 1; c < n; c++) { const j = b.findIndex((_, k) => k >= i && sep.every((v, l) => b[k + l] === sep[l])); if (j < 0) break; r.push(b.slice(i, j)); i = j + sep.length; } r.push(b.slice(i)); return r; })(${a[0]}, ${a[1]}, ${a[2]})`,
	NewReader: (a) =>
		`{_src: ${a[0]}, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src[this._pos + i]; this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(b) { this._src = b; this._pos = 0; }}`,
};

/** @type {ThisType<CodeGen>} */
export const bytesMethods = {
	_genBytes(fn, a) {
		const gen = BYTES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
