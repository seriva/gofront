// CodeGen for `strings.Builder` and `bytes.Buffer` method calls.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const BUILDER_STR = {
	WriteString: (b, a) => `(${b}._buf += ${a[0]}, [${a[0]}.length, null])`,
	WriteByte: (b, a) => `(${b}._buf += String.fromCodePoint(${a[0]}))`,
	Write: (b, a) => `(${b}._buf += String.fromCharCode(...${a[0]}))`,
	String: (b) => `${b}._buf`,
	Reset: (b) => `(${b}._buf = "")`,
};
const BUILDER_BYTES = {
	WriteString: (b, a) =>
		`(${b}._buf.push(...new TextEncoder().encode(${a[0]})), [${a[0]}.length, null])`,
	WriteByte: (b, a) => `${b}._buf.push(${a[0]})`,
	Write: (b, a) => `(${b}._buf.push(...${a[0]}), [${a[0]}.length, null])`,
	String: (b) => `new TextDecoder().decode(new Uint8Array(${b}._buf))`,
	Reset: (b) => `(${b}._buf = [])`,
};
const BUILDER_COMMON = {
	WriteRune: (b, a) => `(${b}._buf += String.fromCodePoint(${a[0]}))`,
	Bytes: (b) => `${b}._buf.slice()`,
	Len: (b) => `${b}._buf.length`,
	Grow: () => "undefined",
};

/** @type {ThisType<CodeGen>} */
export const builderMethods = {
	_genBuilderCall(typeName, method, expr) {
		const recv = expr.func.expr;
		const isPtr = recv._type?.kind === "pointer";
		const base = isPtr ? `${this.genExpr(recv)}.value` : this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		const isStr = typeName === "strings.Builder";
		const table = isStr ? BUILDER_STR : BUILDER_BYTES;
		const gen = table[method] ?? BUILDER_COMMON[method];
		return gen ? gen(base, args) : undefined;
	},
};
