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
};
const BUILDER_BYTES = {
	WriteString: (b, a) =>
		`((__s) => { const __b = new TextEncoder().encode(__s); ${b}._buf.push(...__b); return [__b.length, null]; })(${a[0]})`,
	WriteByte: (b, a) => `(${b}._buf.push(${a[0]}), null)`,
	WriteRune: (b, a) =>
		`((cp) => { const r = (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) ? 0xfffd : cp; const bytes = new TextEncoder().encode(String.fromCodePoint(r)); ${b}._buf.push(...bytes); return [bytes.length, null]; })(${a[0]})`,
	Write: (b, a) => `(${b}._buf.push(...${a[0]}), [${a[0]}.length, null])`,
	String: (b) => `new TextDecoder().decode(new Uint8Array(${b}._buf))`,
	Reset: (b) => `(${b}._buf = [])`,
};
const BUILDER_COMMON = {
	Bytes: (b) => `${b}._buf.slice()`,
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
