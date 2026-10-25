// CodeGen for Go `bytes` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const __bs = `(b => typeof TextDecoder !== "undefined" ? new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b)) : String.fromCharCode.apply(null, b))`;
const __sb = `(s => typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : new Uint8Array([...s].map(c => c.charCodeAt(0))))`;

const BYTES_DISPATCH = {
	Contains: (a) =>
		`((b, sep) => {
			b = b || new Uint8Array(0);
			sep = sep || new Uint8Array(0);
			if (sep.length === 0) return true;
			if (sep.length === 1) return (b.indexOf ? b.indexOf(sep[0]) : Array.prototype.indexOf.call(b, sep[0])) >= 0;
			if (sep.length > b.length) return false;
			const first = sep[0];
			const last = sep[sep.length - 1];
			let i = 0;
			while (i <= b.length - sep.length) {
				const idx = b.indexOf ? b.indexOf(first, i) : Array.prototype.indexOf.call(b, first, i);
				if (idx < 0 || idx > b.length - sep.length) return false;
				if (b[idx + sep.length - 1] === last) {
					let match = true;
					for (let j = 1; j < sep.length - 1; j++) {
						if (b[idx + j] !== sep[j]) { match = false; break; }
					}
					if (match) return true;
				}
				i = idx + 1;
			}
			return false;
		})(${a[0]}, ${a[1]})`,
	HasPrefix: (a) =>
		`((b, p) => { for (let i = 0; i < p.length; i++) if (b[i] !== p[i]) return false; return b.length >= p.length; })(${a[0]}, ${a[1]})`,
	HasSuffix: (a) =>
		`((b, s) => { const off = b.length - s.length; if (off < 0) return false; for (let i = 0; i < s.length; i++) if (b[off + i] !== s[i]) return false; return true; })(${a[0]}, ${a[1]})`,
	Index: (a) =>
		`((b, sep) => {
			b = b || new Uint8Array(0);
			sep = sep || new Uint8Array(0);
			const n = b.length;
			const m = sep.length;
			if (m === 0) return 0;
			if (m === 1) return b.indexOf ? b.indexOf(sep[0]) : Array.prototype.indexOf.call(b, sep[0]);
			if (m > n) return -1;
			if (m === n) {
				for (let k = 0; k < m; k++) if (b[k] !== sep[k]) return -1;
				return 0;
			}
			const first = sep[0];
			const last = sep[m - 1];
			let i = 0;
			while (i <= n - m) {
				const idx = b.indexOf ? b.indexOf(first, i) : Array.prototype.indexOf.call(b, first, i);
				if (idx < 0 || idx > n - m) return -1;
				if (b[idx + m - 1] === last) {
					let match = true;
					for (let j = 1; j < m - 1; j++) {
						if (b[idx + j] !== sep[j]) { match = false; break; }
					}
					if (match) return idx;
				}
				i = idx + 1;
			}
			return -1;
		})(${a[0]}, ${a[1]})`,
	Count: (a) =>
		`((b, sep) => {
			b = b || new Uint8Array(0);
			sep = sep || new Uint8Array(0);
			if (sep.length === 0) {
				let runes = 0;
				for (let i = 0; i < b.length; i++) if ((b[i] & 0xc0) !== 0x80) runes++;
				return runes + 1;
			}
			let cnt = 0;
			if (sep.length === 1) {
				const c = sep[0];
				for (let i = 0; i < b.length; i++) if (b[i] === c) cnt++;
				return cnt;
			}
			let i = 0;
			const first = sep[0];
			const last = sep[sep.length - 1];
			while (i <= b.length - sep.length) {
				const idx = b.indexOf ? b.indexOf(first, i) : Array.prototype.indexOf.call(b, first, i);
				if (idx < 0 || idx > b.length - sep.length) break;
				if (b[idx + sep.length - 1] === last) {
					let match = true;
					for (let j = 1; j < sep.length - 1; j++) {
						if (b[idx + j] !== sep[j]) { match = false; break; }
					}
					if (match) {
						cnt++;
						i = idx + sep.length;
						continue;
					}
				}
				i = idx + 1;
			}
			return cnt;
		})(${a[0]}, ${a[1]})`,
	Repeat: (a) => `${__sb}(${__bs}(${a[0]}).repeat(${a[1]}))`,
	Replace: (a) =>
		`((b, o, n, cnt) => { let str = ${__bs}(b), os = ${__bs}(o), nw = ${__bs}(n); if (cnt < 0) return ${__sb}(str.replaceAll(os, () => nw)); let r = ""; let i = 0; for (; cnt > 0; cnt--) { const j = str.indexOf(os, i); if (j < 0) break; r += str.slice(i, j) + nw; i = j + os.length; if (os.length === 0) { if (i >= str.length) break; r += str[i]; i++; } } return ${__sb}(r + str.slice(i)); })(${a[0]}, ${a[1]}, ${a[2]}, ${a[3]})`,
	ToUpper: (a) =>
		`new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(${a[0]})).toUpperCase())`,
	ToLower: (a) =>
		`new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(${a[0]})).toLowerCase())`,
	ToTitle: (a) =>
		`new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(${a[0]})).toUpperCase())`,
	TrimSpace: (a) =>
		`new TextEncoder().encode(new TextDecoder().decode(new Uint8Array(${a[0]})).trim())`,
	Trim: (a) =>
		`((b, c) => { const s = new TextDecoder().decode(new Uint8Array(b)); const cs = new Set(Array.from(c)); const chars = Array.from(s); let l = 0, r = chars.length; while (l < r && cs.has(chars[l])) l++; while (r > l && cs.has(chars[r - 1])) r--; return new TextEncoder().encode(chars.slice(l, r).join("")); })(${a[0]}, ${a[1]})`,
	Equal: (a) =>
		`((a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; })(${a[0]}, ${a[1]})`,
	Split: (a) => `${__bs}(${a[0]}).split(${__bs}(${a[1]})).map(p => ${__sb}(p))`,
	Join: (a) => `${__sb}(${a[0]}.map(p => ${__bs}(p)).join(${__bs}(${a[1]})))`,
	ReplaceAll: (a) =>
		`((b, o, n) => { const r = []; let i = 0; while (i <= b.length - o.length) { if (o.length > 0 && o.every((v, j) => b[i + j] === v)) { r.push(...n); i += o.length; } else { r.push(b[i++]); } } for (; i < b.length; i++) r.push(b[i]); return new Uint8Array(r); })(${a[0]}, ${a[1]}, ${a[2]})`,
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
		`((b, sep) => {
			b = b || new Uint8Array(0);
			sep = sep || new Uint8Array(0);
			const n = b.length;
			const m = sep.length;
			if (m === 0) return n;
			if (m === 1) return b.lastIndexOf ? b.lastIndexOf(sep[0]) : Array.prototype.lastIndexOf.call(b, sep[0]);
			if (m > n) return -1;
			if (m === n) {
				for (let k = 0; k < m; k++) if (b[k] !== sep[k]) return -1;
				return 0;
			}
			const first = sep[0];
			const last = sep[m - 1];
			let i = n - m;
			while (i >= 0) {
				const idx = b.lastIndexOf ? b.lastIndexOf(first, i) : Array.prototype.lastIndexOf.call(b, first, i);
				if (idx < 0) return -1;
				if (b[idx + m - 1] === last) {
					let match = true;
					for (let j = 1; j < m - 1; j++) {
						if (b[idx + j] !== sep[j]) { match = false; break; }
					}
					if (match) return idx;
				}
				i = idx - 1;
			}
			return -1;
		})(${a[0]}, ${a[1]})`,
	LastIndexByte: (a) => `(${a[0]}).lastIndexOf(${a[1]})`,
	Fields: (a) =>
		`((b) => { const s = new TextDecoder().decode(new Uint8Array(b ?? [])); return s.split(/[ \\t\\n\\v\\f\\r\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+/).filter(p => p !== "").map(w => new TextEncoder().encode(w)); })(${a[0]})`,
	FieldsFunc: (a) =>
		`((b, fn) => { const s = new TextDecoder().decode(new Uint8Array(b ?? [])); const res = []; let cur = ""; for (const ch of s) { const cp = ch.codePointAt(0); if (fn(cp)) { if (cur.length > 0) { res.push(new TextEncoder().encode(cur)); cur = ""; } } else { cur += ch; } } if (cur.length > 0) res.push(new TextEncoder().encode(cur)); return res; })(${a[0]}, ${a[1]})`,
	Clone: (a) =>
		`(${a[0]} ? (${a[0]}.slice ? ${a[0]}.slice() : Array.from(${a[0]})) : null)`,
	Cut: (a) =>
		`((b, sep) => { for (let i = 0; i <= b.length - sep.length; i++) if (sep.every((v, j) => b[i + j] === v)) return [b.slice(0, i), b.slice(i + sep.length), true]; return [b.slice(), new Uint8Array(0), false]; })(${a[0]}, ${a[1]})`,
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
	NewBuffer: (a) => `({ _buf: Array.from(${a[0]} ?? []) })`,
	NewBufferString: (a) =>
		`({ _buf: Array.from(new TextEncoder().encode(${a[0]} ?? "")) })`,
	ToValidUTF8: (a) =>
		`((b, repl) => {
			if (!b) return new Uint8Array(0);
			repl = repl || new Uint8Array(0);
			const res = [];
			let i = 0;
			let inInvalid = false;
			while (i < b.length) {
				const b0 = b[i];
				let sz = 0;
				let valid = false;
				if (b0 < 0x80) {
					sz = 1;
					valid = true;
				} else if (b0 >= 0xC2 && b0 <= 0xDF) {
					if (i + 1 < b.length && (b[i+1] & 0xC0) === 0x80) {
						sz = 2;
						valid = true;
					}
				} else if (b0 >= 0xE0 && b0 <= 0xEF) {
					if (i + 2 < b.length && (b[i+1] & 0xC0) === 0x80 && (b[i+2] & 0xC0) === 0x80) {
						const r = ((b0 & 0x0F) << 12) | ((b[i+1] & 0x3F) << 6) | (b[i+2] & 0x3F);
						if (r >= 0x800 && (r < 0xD800 || r > 0xDFFF)) {
							sz = 3;
							valid = true;
						}
					}
				} else if (b0 >= 0xF0 && b0 <= 0xF4) {
					if (i + 3 < b.length && (b[i+1] & 0xC0) === 0x80 && (b[i+2] & 0xC0) === 0x80 && (b[i+3] & 0xC0) === 0x80) {
						const r = ((b0 & 0x07) << 18) | ((b[i+1] & 0x3F) << 12) | ((b[i+2] & 0x3F) << 6) | (b[i+3] & 0x3F);
						if (r >= 0x10000 && r <= 0x10FFFF) {
							sz = 4;
							valid = true;
						}
					}
				}
				if (valid) {
					if (inInvalid) {
						for (let k = 0; k < repl.length; k++) res.push(repl[k]);
						inInvalid = false;
					}
					for (let k = 0; k < sz; k++) res.push(b[i + k]);
					i += sz;
				} else {
					inInvalid = true;
					i += 1;
				}
			}
			if (inInvalid) {
				for (let k = 0; k < repl.length; k++) res.push(repl[k]);
			}
			return new Uint8Array(res);
		})(${a[0]}, ${a[1]})`,
	NewReader: (a) =>
		`((b) => ({
			_src: b,
			_pos: 0,
			_prevRune: -1,
			Read(p) {
				if (this._pos >= this._src.length) return [0, __io_eof];
				const n = Math.min(p.length, this._src.length - this._pos);
				for (let i = 0; i < n; i++) p[i] = this._src[this._pos + i];
				this._pos += n;
				this._prevRune = -1;
				return [n, null];
			},
			ReadAt(p, off) {
				const o = Number(off);
				if (o < 0) return [0, __error("bytes.Reader.ReadAt: negative offset")];
				if (o >= this._src.length) return [0, __io_eof];
				const n = Math.min(p.length, this._src.length - o);
				for (let i = 0; i < n; i++) p[i] = this._src[o + i];
				return [n, n < p.length ? __io_eof : null];
			},
			ReadByte() {
				if (this._pos >= this._src.length) return [0, __io_eof];
				this._prevRune = -1;
				return [this._src[this._pos++], null];
			},
			UnreadByte() {
				if (this._pos <= 0) return __error("bytes.Reader.UnreadByte: at beginning of slice");
				this._prevRune = -1;
				this._pos--;
				return null;
			},
			ReadRune() {
				if (this._pos >= this._src.length) return [0, 0, __io_eof];
				const rem = this._src.subarray ? this._src.subarray(this._pos) : new Uint8Array(this._src.slice(this._pos));
				const s = new TextDecoder().decode(rem);
				const cp = s.codePointAt(0);
				const runeStr = s.slice(0, cp > 0xffff ? 2 : 1);
				const sz = new TextEncoder().encode(runeStr).length;
				this._prevRune = this._pos;
				this._pos += sz;
				return [cp, sz, null];
			},
			UnreadRune() {
				if (this._prevRune === undefined || this._prevRune < 0 || this._prevRune >= this._pos) {
					return __error("bytes.Reader.UnreadRune: previous operation was not ReadRune");
				}
				this._pos = this._prevRune;
				this._prevRune = -1;
				return null;
			},
			Seek(offset, whence) {
				const off = BigInt(offset);
				const w = Number(whence);
				let newPos;
				if (w === 0) newPos = off;
				else if (w === 1) newPos = BigInt(this._pos) + off;
				else if (w === 2) newPos = BigInt(this._src.length) + off;
				else return [0n, __error("bytes.Reader.Seek: invalid whence")];
				if (newPos < 0n) return [0n, __error("bytes.Reader.Seek: negative position")];
				this._pos = Number(newPos);
				this._prevRune = -1;
				return [newPos, null];
			},
			Size() { return BigInt(this._src.length); },
			WriteTo(w) {
				if (this._pos >= this._src.length) return [0n, null];
				const rem = this._src.subarray ? this._src.subarray(this._pos) : new Uint8Array(this._src.slice(this._pos));
				const [n, err] = w.Write(rem);
				this._pos += n;
				return [BigInt(n), err];
			},
			Len() { return Math.max(0, this._src.length - this._pos); },
			Reset(b2) { this._src = b2; this._pos = 0; this._prevRune = -1; }
		}))(${a[0]})`,
};

/** @type {ThisType<CodeGen>} */
export const bytesMethods = {
	_genBytes(fn, a) {
		if (fn === "NewReader") {
			this.useHelper("ioEOF");
			this.useHelper("error");
		}
		const gen = BYTES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
