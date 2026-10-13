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
	ToUpper: (a) =>
		`new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(${a[0]})).toUpperCase())`,
	ToLower: (a) =>
		`new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(${a[0]})).toLowerCase())`,
	TrimSpace: (a) =>
		`new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(${a[0]})).trim())`,
	Trim: (a) =>
		`((b, c) => { const s = new TextDecoder().decode(new Uint8Array(b)); const cs = new Set(Array.from(c)); const chars = Array.from(s); let l = 0, r = chars.length; while (l < r && cs.has(chars[l])) l++; while (r > l && cs.has(chars[r - 1])) r--; return new TextEncoder().encode(chars.slice(l, r).join("")); })(${a[0]}, ${a[1]})`,
	Equal: (a) =>
		`((a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; })(${a[0]}, ${a[1]})`,
	Split: (a) => `${__bs}(${a[0]}).split(${__bs}(${a[1]})).map(p => ${__sb}(p))`,
	Join: (a) => `${__sb}(${a[0]}.map(p => ${__bs}(p)).join(${__bs}(${a[1]})))`,
	ReplaceAll: (a) =>
		`((b, o, n) => { const r = []; let i = 0; while (i <= b.length - o.length) { if (o.length > 0 && o.every((v, j) => b[i + j] === v)) { r.push(...n); i += o.length; } else { r.push(b[i++]); } } for (; i < b.length; i++) r.push(b[i]); return ArrayBuffer.isView(b) ? new Uint8Array(r) : r; })(${a[0]}, ${a[1]}, ${a[2]})`,
	TrimPrefix: (a) =>
		`((b, p) => p.every((v, i) => b[i] === v) ? b.slice(p.length) : b.slice())(${a[0]}, ${a[1]})`,
	TrimSuffix: (a) =>
		`((b, s) => s.length && s.every((v, i) => b[b.length - s.length + i] === v) ? b.slice(0, -s.length) : b.slice())(${a[0]}, ${a[1]})`,
	TrimLeft: (a) =>
		`((b, c) => { const s = new TextDecoder().decode(new Uint8Array(b)); const cs = new Set(Array.from(c)); const chars = Array.from(s); let l = 0, r = chars.length; while (l < r && cs.has(chars[l])) l++; return new TextEncoder().encode(chars.slice(l, r).join("")); })(${a[0]}, ${a[1]})`,
	TrimRight: (a) =>
		`((b, c) => { const s = new TextDecoder().decode(new Uint8Array(b)); const cs = new Set(Array.from(c)); const chars = Array.from(s); let l = 0, r = chars.length; while (r > l && cs.has(chars[r - 1])) r--; return new TextEncoder().encode(chars.slice(l, r).join("")); })(${a[0]}, ${a[1]})`,
	TrimFunc: (a) =>
		`((b, f) => { const s = new TextDecoder().decode(new Uint8Array(b)); const chars = Array.from(s); let l = 0, r = chars.length; while (l < r && f(chars[l].codePointAt(0))) l++; while (r > l && f(chars[r - 1].codePointAt(0))) r--; return new TextEncoder().encode(chars.slice(l, r).join("")); })(${a[0]}, ${a[1]})`,
	IndexByte: (a) => `(${a[0]}).indexOf(${a[1]})`,
	LastIndex: (a) =>
		`((b, s) => { for (let i = b.length - s.length; i >= 0; i--) if (s.every((v, j) => b[i + j] === v)) return i; return -1; })(${a[0]}, ${a[1]})`,
	LastIndexByte: (a) => `(${a[0]}).lastIndexOf(${a[1]})`,
	Fields: (a) =>
		`((b) => { const s = String.fromCharCode(...b).trim(); return s === '' ? [] : s.split(/\\s+/).map(w => [...w].map(c => c.charCodeAt(0))); })(${a[0]})`,
	Cut: (a) =>
		`((b, sep) => { for (let i = 0; i <= b.length - sep.length; i++) if (sep.every((v, j) => b[i + j] === v)) return [b.slice(0, i), b.slice(i + sep.length), true]; return [b.slice(), [], false]; })(${a[0]}, ${a[1]})`,
	ContainsAny: (a) =>
		`((b, chars) => { const s = new TextDecoder().decode(new Uint8Array(b)); for (const c of chars) if (s.includes(c)) return true; return false; })(${a[0]}, ${a[1]})`,
	ContainsRune: (a) =>
		`((b, r) => { const s = new TextDecoder().decode(new Uint8Array(b)); return s.includes(String.fromCodePoint(r < 0 || r > 0x10ffff || (r >= 0xd800 && r <= 0xdfff) ? 0xfffd : r)); })(${a[0]}, ${a[1]})`,
	Map: (a) =>
		`((f, b) => { const s = new TextDecoder().decode(new Uint8Array(b)); let res = ""; for (const c of s) { const r = f(c.codePointAt(0)); if (r >= 0) res += String.fromCodePoint(r); } return new TextEncoder().encode(res); })(${a[0]}, ${a[1]})`,
	SplitN: (a) =>
		`((b, sep, n) => {
			if (n === 0) return null;
			if (sep.length === 0) {
				if (n < 0 || b.length <= n) {
					const r = [];
					for (let k = 0; k < b.length; k++) r.push(b.slice(k, k + 1));
					return r;
				}
				const r = [];
				for (let k = 0; k < n - 1; k++) r.push(b.slice(k, k + 1));
				r.push(b.slice(n - 1));
				return r;
			}
			const findNext = (start) => {
				for (let k = start; k <= b.length - sep.length; k++) {
					let match = true;
					for (let l = 0; l < sep.length; l++) {
						if (b[k + l] !== sep[l]) { match = false; break; }
					}
					if (match) return k;
				}
				return -1;
			};
			if (n < 0) {
				const r = [];
				let i = 0;
				while (i <= b.length) {
					const j = findNext(i);
					if (j < 0) break;
					r.push(b.slice(i, j));
					i = j + sep.length;
				}
				r.push(b.slice(i));
				return r;
			}
			const r = [];
			let i = 0;
			for (let c = 1; c < n; c++) {
				const j = findNext(i);
				if (j < 0) break;
				r.push(b.slice(i, j));
				i = j + sep.length;
			}
			r.push(b.slice(i));
			return r;
		})(${a[0]}, ${a[1]}, ${a[2]})`,
	NewReader: (a) =>
		`((b) => ({ _src: b, _pos: 0, Read(p) { if (this._pos >= this._src.length) return [0, __io_eof]; const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src[this._pos + i]; this._pos += n; return [n, null]; }, Len() { return Math.max(0, this._src.length - this._pos); }, Reset(b2) { this._src = b2; this._pos = 0; } }))(${a[0]})`,
};

/** @type {ThisType<CodeGen>} */
export const bytesMethods = {
	_genBytes(fn, a) {
		if (fn === "NewReader") this.useHelper("ioEOF");
		const gen = BYTES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
