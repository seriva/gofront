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
	Replace: ([s, s2, s3, n]) =>
		n === undefined
			? `${s}.replace(${s2}, ${s3})`
			: `((str, o, nw, cnt) => { if (cnt < 0) return str.replaceAll(o, nw); let r = ""; let i = 0; for (; cnt > 0; cnt--) { const j = str.indexOf(o, i); if (j < 0) break; r += str.slice(i, j) + nw; i = j + o.length; if (o.length === 0) { if (i >= str.length) break; r += str[i]; i++; } } return r + str.slice(i); })(${s}, ${s2}, ${s3}, ${n})`,
	ReplaceAll: ([s, s2, s3]) => `${s}.replaceAll(${s2}, ${s3})`,
	Trim: ([s, s2]) =>
		`((str, cut) => { const cs = new Set(cut); let i = 0, j = str.length; while (i < j && cs.has(str[i])) i++; while (j > i && cs.has(str[j - 1])) j--; return str.slice(i, j); })(${s}, ${s2})`,
	TrimPrefix: ([s, s2]) =>
		`((s, pre) => s.startsWith(pre) ? s.slice(pre.length) : s)(${s}, ${s2})`,
	TrimSuffix: ([s, s2]) =>
		`((s, suf) => !suf.length || !s.endsWith(suf) ? s : s.slice(0, -suf.length))(${s}, ${s2})`,
	TrimLeft: ([s, s2]) =>
		`((str, cut) => { const cs = new Set(cut); let i = 0; while (i < str.length && cs.has(str[i])) i++; return str.slice(i); })(${s}, ${s2})`,
	TrimRight: ([s, s2]) =>
		`((str, cut) => { const cs = new Set(cut); let j = str.length; while (j > 0 && cs.has(str[j - 1])) j--; return str.slice(0, j); })(${s}, ${s2})`,
	EqualFold: ([s, s2]) => `${s}.toLowerCase() === ${s2}.toLowerCase()`,
	Fields: ([s]) =>
		`(${s}).split(/[ \\t\\n\\v\\f\\r\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+/).filter(p => p !== "")`,
	FieldsFunc: ([s, f]) =>
		`((s, fn) => { const res = []; const runes = Array.from(s ?? ""); let cur = ""; for (const ch of runes) { const cp = ch.codePointAt(0); if (fn(cp)) { if (cur.length > 0) { res.push(cur); cur = ""; } } else { cur += ch; } } if (cur.length > 0) res.push(cur); return res; })(${s}, ${f})`,
	Cut: ([s, s2]) =>
		`((s, sep) => { const i = s.indexOf(sep); return i < 0 ? [s, "", false] : [s.slice(0, i), s.slice(i + sep.length), true]; })(${s}, ${s2})`,
	CutPrefix: ([s, s2]) =>
		`((str, pre) => str.startsWith(pre) ? [str.slice(pre.length), true] : [str, false])(${s}, ${s2})`,
	CutSuffix: ([s, s2]) =>
		`((str, suf) => { if (suf === "") return [str, true]; return str.endsWith(suf) ? [str.slice(0, -suf.length), true] : [str, false]; })(${s}, ${s2})`,
	SplitN: ([s, s2, s3]) =>
		`((s, sep, n) => {
			if (n === 0) return null;
			if (n < 0) return sep === "" ? [...s] : s.split(sep);
			if (sep === "") {
				const chars = [...s];
				if (chars.length <= n) return chars;
				const r = chars.slice(0, n - 1);
				r.push(chars.slice(n - 1).join(""));
				return r;
			}
			const r = [];
			let cur = s;
			for (let i = 1; i < n && cur.length; i++) {
				const j = cur.indexOf(sep);
				if (j < 0) break;
				r.push(cur.slice(0, j));
				cur = cur.slice(j + sep.length);
			}
			r.push(cur);
			return r;
		})(${s}, ${s2}, ${s3})`,
	SplitAfter: ([s, s2]) =>
		`((s, sep) => {
			if (sep === "") return [...s];
			const r = [];
			let cur = s;
			while (true) {
				const j = cur.indexOf(sep);
				if (j < 0) { r.push(cur); break; }
				r.push(cur.slice(0, j + sep.length));
				cur = cur.slice(j + sep.length);
			}
			return r;
		})(${s}, ${s2})`,
	SplitAfterN: ([s, s2, s3]) =>
		`((s, sep, n) => {
			if (n === 0) return null;
			if (sep === "") {
				const chars = [...s];
				if (n < 0 || chars.length <= n) return chars;
				const r = chars.slice(0, n - 1);
				r.push(chars.slice(n - 1).join(""));
				return r;
			}
			const r = [];
			let cur = s;
			for (let i = 1; (n < 0 || i < n) && cur.length; i++) {
				const j = cur.indexOf(sep);
				if (j < 0) break;
				r.push(cur.slice(0, j + sep.length));
				cur = cur.slice(j + sep.length);
			}
			r.push(cur);
			return r;
		})(${s}, ${s2}, ${s3})`,
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
		`((f, s) => { let out = ""; for (const c of s) { const r = f(c.codePointAt(0)); if (r >= 0) out += String.fromCodePoint(r); } return out; })(${s}, ${s2})`,
	Title: ([s]) => `(${s}).replace(/\\b\\w/g, c => c.toUpperCase())`,
	TrimFunc: ([s, s2]) =>
		`((s, f) => {
			let l = 0, r = s.length;
			while (l < r) {
				const cp = s.codePointAt(l);
				if (!f(cp)) break;
				l += cp > 0xFFFF ? 2 : 1;
			}
			while (r > l) {
				let cp, step;
				if (r > 1 && s.charCodeAt(r - 1) >= 0xDC00 && s.charCodeAt(r - 1) <= 0xDFFF &&
					s.charCodeAt(r - 2) >= 0xD800 && s.charCodeAt(r - 2) <= 0xDBFF) {
					cp = s.codePointAt(r - 2);
					step = 2;
				} else {
					cp = s.codePointAt(r - 1);
					step = 1;
				}
				if (!f(cp)) break;
				r -= step;
			}
			return s.slice(l, r);
		})(${s}, ${s2})`,
	TrimLeftFunc: ([s, s2]) =>
		`((s, f) => {
			let l = 0;
			while (l < s.length) {
				const cp = s.codePointAt(l);
				if (!f(cp)) break;
				l += cp > 0xFFFF ? 2 : 1;
			}
			return s.slice(l);
		})(${s}, ${s2})`,
	TrimRightFunc: ([s, s2]) =>
		`((s, f) => {
			let r = s.length;
			while (r > 0) {
				let cp, step;
				if (r > 1 && s.charCodeAt(r - 1) >= 0xDC00 && s.charCodeAt(r - 1) <= 0xDFFF &&
					s.charCodeAt(r - 2) >= 0xD800 && s.charCodeAt(r - 2) <= 0xDBFF) {
					cp = s.codePointAt(r - 2);
					step = 2;
				} else {
					cp = s.codePointAt(r - 1);
					step = 1;
				}
				if (!f(cp)) break;
				r -= step;
			}
			return s.slice(0, r);
		})(${s}, ${s2})`,
	IndexFunc: ([s, s2]) =>
		`((s, f) => { for (let i = 0; i < s.length; i++) { const cp = s.codePointAt(i); if (f(cp)) return i; if (cp > 0xFFFF) i++; } return -1; })(${s}, ${s2})`,
	LastIndexFunc: ([s, s2]) =>
		`((s, f) => { for (let i = s.length - 1; i >= 0; i--) { let cp = s.codePointAt(i); if (i > 0 && s.charCodeAt(i) >= 0xDC00 && s.charCodeAt(i) <= 0xDFFF && s.charCodeAt(i - 1) >= 0xD800 && s.charCodeAt(i - 1) <= 0xDBFF) { cp = s.codePointAt(i - 1); i--; } if (f(cp)) return i; } return -1; })(${s}, ${s2})`,
	ToValidUTF8: ([s, repl]) =>
		`(${s} ? ${s}.replace(/(?:[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])+/g, ${repl} ?? "") : (${s} ?? ""))`,
	NewReader: ([s]) =>
		`((s) => ({
			_bytes: new TextEncoder().encode(s ?? ""),
			_pos: 0,
			_prevRune: -1,
			Read(p) {
				if (this._pos >= this._bytes.length) return [0, __io_eof];
				const n = Math.min(p.length, this._bytes.length - this._pos);
				for (let i = 0; i < n; i++) p[i] = this._bytes[this._pos + i];
				this._pos += n;
				this._prevRune = -1;
				return [n, null];
			},
			ReadAt(b, off) {
				const o = Number(off);
				if (o < 0) return [0, __error("strings.Reader.ReadAt: negative offset")];
				if (o >= this._bytes.length) return [0, __io_eof];
				const n = Math.min(b.length, this._bytes.length - o);
				for (let i = 0; i < n; i++) b[i] = this._bytes[o + i];
				return [n, n < b.length ? __io_eof : null];
			},
			ReadByte() {
				if (this._pos >= this._bytes.length) return [0, __io_eof];
				this._prevRune = -1;
				return [this._bytes[this._pos++], null];
			},
			UnreadByte() {
				if (this._pos <= 0) return __error("strings.Reader.UnreadByte: at beginning of string");
				this._prevRune = -1;
				this._pos--;
				return null;
			},
			ReadRune() {
				if (this._pos >= this._bytes.length) return [0, 0, __io_eof];
				const rem = this._bytes.subarray(this._pos);
				const str = new TextDecoder().decode(rem);
				const cp = str.codePointAt(0);
				const runeStr = str.slice(0, cp > 0xffff ? 2 : 1);
				const sz = new TextEncoder().encode(runeStr).length;
				this._prevRune = this._pos;
				this._pos += sz;
				return [cp, sz, null];
			},
			UnreadRune() {
				if (this._prevRune === undefined || this._prevRune < 0 || this._prevRune >= this._pos) {
					return __error("strings.Reader.UnreadRune: previous operation was not ReadRune");
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
				else if (w === 2) newPos = BigInt(this._bytes.length) + off;
				else return [0n, __error("strings.Reader.Seek: invalid whence")];
				if (newPos < 0n) return [0n, __error("strings.Reader.Seek: negative position")];
				this._pos = Number(newPos);
				this._prevRune = -1;
				return [newPos, null];
			},
			Size() { return BigInt(this._bytes.length); },
			WriteTo(w) {
				if (this._pos >= this._bytes.length) return [0, null];
				const rem = this._bytes.subarray(this._pos);
				const [n, err] = w.Write(rem);
				this._pos += n;
				return [n, err];
			},
			Len() { return Math.max(0, this._bytes.length - this._pos); },
			Reset(s2) { this._bytes = new TextEncoder().encode(s2 ?? ""); this._pos = 0; this._prevRune = -1; }
		}))(${s})`,
	NewReplacer: (args) =>
		`((...pairs) => {
			const p = [];
			for (let i = 0; i < pairs.length; i += 2) {
				if (pairs[i] !== undefined && pairs[i+1] !== undefined) {
					p.push([pairs[i], pairs[i+1]]);
				}
			}
			return {
				_p: p,
				Replace(s) {
					s = s ?? "";
					if (!this._p || this._p.length === 0 || s === "") return s;
					let out = "";
					let i = 0;
					while (i < s.length) {
						let matched = false;
						for (let k = 0; k < this._p.length; k++) {
							const [oldStr, newStr] = this._p[k];
							if (oldStr.length > 0 && s.startsWith(oldStr, i)) {
								out += newStr;
								i += oldStr.length;
								matched = true;
								break;
							}
						}
						if (!matched) {
							out += s[i];
							i++;
						}
					}
					return out;
				}
			};
		})(${args.join(", ")})`,
};

/** @type {ThisType<CodeGen>} */
export const stringsMethods = {
	_genStrings(fn, a) {
		if (fn === "NewReader") {
			this.useHelper("ioEOF");
			this.useHelper("error");
		}
		const args = a();
		const [s, s2] = args;
		if (STRINGS_M1[fn]) return `${s}.${STRINGS_M1[fn]}()`;
		if (STRINGS_M2[fn]) return `${s}.${STRINGS_M2[fn]}(${s2})`;
		const gen = STRINGS_DISPATCH[fn];
		return gen ? gen(args) : undefined;
	},
};
