// CodeGen for `strings.Builder` and `bytes.Buffer` method calls.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const BUILDER_STR = {
	WriteString: (b, a) =>
		`((__s) => { ${b}._buf += __s; return [new TextEncoder().encode(__s).length, null]; })(${a[0]})`,
	WriteByte: (b, a) => `(${b}._buf += String.fromCodePoint(${a[0]}), null)`,
	WriteRune: (b, a) =>
		`((cp) => { const r = (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) ? 0xfffd : cp; const s = String.fromCodePoint(r); ${b}._buf += s; return [new TextEncoder().encode(s).length, null]; })(${a[0]})`,
	Write: (b, a) =>
		`(${b}._buf += new TextDecoder().decode(new Uint8Array(${a[0]})), [${a[0]}.length, null])`,
	String: (b) => `${b}._buf`,
	Reset: (b) => `(${b}._buf = "")`,
	Len: (b) => `new TextEncoder().encode(${b}._buf).length`,
	Cap: (b) =>
		`Math.max(${b}._cap ?? 0, new TextEncoder().encode(${b}._buf).length)`,
	Grow: (b, a) =>
		`((n) => { if (n < 0) throw new Error("strings.Builder.Grow: negative count"); ${b}._cap = Math.max(${b}._cap ?? 0, new TextEncoder().encode(${b}._buf).length) + n; })(${a[0]})`,
};
const BUILDER_BYTES = {
	WriteString: (b, a) =>
		`((buf, s) => { buf._lastOp = 0; const bytes = new TextEncoder().encode(s); for (let i = 0; i < bytes.length; i++) buf._buf.push(bytes[i]); return [bytes.length, null]; })(${b}, ${a[0]})`,
	WriteByte: (b, a) =>
		`((buf, c) => { buf._lastOp = 0; buf._buf.push(c); return null; })(${b}, ${a[0]})`,
	WriteRune: (b, a) =>
		`((buf, cp) => { buf._lastOp = 0; const r = (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) ? 0xfffd : cp; const bytes = new TextEncoder().encode(String.fromCodePoint(r)); for (let i = 0; i < bytes.length; i++) buf._buf.push(bytes[i]); return [bytes.length, null]; })(${b}, ${a[0]})`,
	Write: (b, a) =>
		`((buf, d) => { buf._lastOp = 0; for (let i = 0; i < d.length; i++) buf._buf.push(d[i]); return [d.length, null]; })(${b}, ${a[0]})`,
	String: (b) => `new TextDecoder().decode(new Uint8Array(${b}._buf))`,
	Reset: (b) => `(${b}._buf = [])`,
	Read: (b, a) =>
		`((buf, p) => { if (!buf._buf || buf._buf.length === 0) return [0, __io_eof]; const n = Math.min(p.length, buf._buf.length); for (let i = 0; i < n; i++) p[i] = buf._buf.shift(); if (n > 0) { buf._lastOp = 1; buf._lastByte = p[n - 1]; } else { buf._lastOp = 0; } return [n, null]; })(${b}, ${a[0]})`,
	ReadByte: (b) =>
		`((buf) => { if (!buf._buf || buf._buf.length === 0) return [0, __io_eof]; const c = buf._buf.shift(); buf._lastOp = 1; buf._lastByte = c; return [c, null]; })(${b})`,
	UnreadByte: (b) =>
		`((buf) => { if (buf._lastOp !== 1) return __error("bytes.Buffer: UnreadByte: previous operation was not a successful read"); buf._buf.unshift(buf._lastByte); buf._lastOp = 0; return null; })(${b})`,
	ReadRune: (b) =>
		`((buf) => { if (!buf._buf || buf._buf.length === 0) return [0, 0, __io_eof]; const u8 = new Uint8Array(buf._buf); const s = new TextDecoder().decode(u8); const cp = s.codePointAt(0); const runeStr = s.slice(0, cp > 0xffff ? 2 : 1); const sz = new TextEncoder().encode(runeStr).length; for (let i = 0; i < sz; i++) buf._buf.shift(); buf._lastOp = 2; buf._lastRune = runeStr; return [cp, sz, null]; })(${b})`,
	UnreadRune: (b) =>
		`((buf) => { if (buf._lastOp !== 2) return __error("bytes.Buffer: UnreadRune: previous operation was not a successful ReadRune"); const bts = new TextEncoder().encode(buf._lastRune); for (let i = bts.length - 1; i >= 0; i--) buf._buf.unshift(bts[i]); buf._lastOp = 0; return null; })(${b})`,
	ReadBytes: (b, a) =>
		`((buf, delim) => { const idx = buf._buf.indexOf(delim); if (idx < 0) { const rem = Uint8Array.from(buf._buf); buf._buf = []; return [rem, __io_eof]; } const line = Uint8Array.from(buf._buf.splice(0, idx + 1)); return [line, null]; })(${b}, ${a[0]})`,
	ReadString: (b, a) =>
		`((buf, delim) => { const idx = buf._buf.indexOf(delim); if (idx < 0) { const rem = new TextDecoder().decode(Uint8Array.from(buf._buf)); buf._buf = []; return [rem, __io_eof]; } const line = new TextDecoder().decode(Uint8Array.from(buf._buf.splice(0, idx + 1))); return [line, null]; })(${b}, ${a[0]})`,
	ReadFrom: (b, a) =>
		`((buf, r) => { let total = 0n; const tmp = new Uint8Array(4096); while (true) { const [n, err] = r.Read(tmp); if (n > 0) { for (let i = 0; i < n; i++) buf._buf.push(tmp[i]); total += BigInt(n); } if (err) { return [total, (err === __io_eof || err?.Error?.() === "EOF") ? null : err]; } } })(${b}, ${a[0]})`,
	WriteTo: (b, a) =>
		`((buf, w) => { if (!buf._buf || buf._buf.length === 0) return [0n, null]; const bytes = Uint8Array.from(buf._buf); const [n, err] = w.Write(bytes); if (n > 0) buf._buf.splice(0, n); return [BigInt(n), err]; })(${b}, ${a[0]})`,
	Next: (b, a) =>
		`((buf, n) => { const cnt = Math.min(Math.max(0, n), buf._buf.length); return Uint8Array.from(buf._buf.splice(0, cnt)); })(${b}, ${a[0]})`,
	Truncate: (b, a) =>
		`((buf, n) => { if (n < 0 || n > buf._buf.length) throw new Error("bytes.Buffer: truncation out of range"); buf._buf.length = n; })(${b}, ${a[0]})`,
	Available: (b) => `Math.max(0, (${b}._cap ?? 0) - ${b}._buf.length)`,
	AvailableBuffer: () => `new Uint8Array(0)`,
	Peek: (b, a) =>
		`((buf, n) => { if (n < 0) throw new Error("runtime error: slice bounds out of range"); if (n > buf._buf.length) return [Uint8Array.from(buf._buf), __io_eof]; return [Uint8Array.from(buf._buf.slice(0, n)), null]; })(${b}, ${a[0]})`,
};
const BUILDER_COMMON = {
	Bytes: (b) => `new Uint8Array(${b}._buf)`,
	Len: (b) => `${b}._buf.length`,
	Cap: (b) => `Math.max(${b}._cap ?? 0, ${b}._buf.length)`,
	Grow: (b, a) =>
		`((n) => { if (n < 0) throw new Error("bytes.Buffer.Grow: negative count"); ${b}._cap = Math.max(${b}._cap ?? 0, ${b}._buf.length) + n; })(${a[0]})`,
};

/** @type {ThisType<CodeGen>} */
export const builderMethods = {
	_genBuilderCall(typeName, method, expr) {
		const recv = expr.func.expr;
		const base = this._unboxWriter(this.genExpr(recv));
		const args = expr.args.map((a) => this.genExpr(a));
		if (
			method === "Read" ||
			method === "ReadByte" ||
			method === "ReadRune" ||
			method === "ReadBytes" ||
			method === "ReadString" ||
			method === "ReadFrom" ||
			method === "UnreadByte" ||
			method === "UnreadRune" ||
			method === "Peek"
		) {
			this.useHelper("ioEOF");
			this.useHelper("error");
		}
		const isStr = typeName === "strings.Builder";
		const table = isStr ? BUILDER_STR : BUILDER_BYTES;
		const gen = table[method] ?? BUILDER_COMMON[method];
		return gen ? gen(base, args) : undefined;
	},

	// Accepts a Builder/Buffer or a pointer box around one; evaluates `js` once.
	_unboxWriter(js) {
		if (/^[\w$.]+$/.test(js)) return `(${js}?.value ?? ${js})`;
		return `((__w) => __w?.value ?? __w)(${js})`;
	},
};
