// src/backend/js/stdlib/bits.js
// CodeGen for Go `math/bits` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

function toBig64(x) {
	const trimmed = String(x).trim();
	if (/^-?(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)n?$/.test(trimmed)) {
		return trimmed.endsWith("n") ? trimmed : `${trimmed}n`;
	}
	return `BigInt(${x})`;
}

const BITS_MAP = {
	Add32: ([x, y, c]) =>
		`((() => { const s = BigInt((${x}) >>> 0) + BigInt((${y}) >>> 0) + BigInt((${c}) >>> 0); return [Number(s & 0xffffffffn), Number(s >> 32n)]; })())`,
	Add64: ([x, y, c]) =>
		`((() => { const s = BigInt.asUintN(64, ${toBig64(x)}) + BigInt.asUintN(64, ${toBig64(y)}) + BigInt.asUintN(64, ${toBig64(c)}); return [BigInt.asUintN(64, s), Number(s >> 64n)]; })())`,
	Add: (args) => BITS_MAP.Add64(args),

	Sub32: ([x, y, b]) =>
		`((() => { const diff = BigInt((${x}) >>> 0) - BigInt((${y}) >>> 0) - BigInt((${b}) >>> 0); return [Number(BigInt.asUintN(32, diff)), diff < 0n ? 1 : 0]; })())`,
	Sub64: ([x, y, b]) =>
		`((() => { const diff = BigInt.asUintN(64, ${toBig64(x)}) - BigInt.asUintN(64, ${toBig64(y)}) - BigInt.asUintN(64, ${toBig64(b)}); return [BigInt.asUintN(64, diff), diff < 0n ? 1 : 0]; })())`,
	Sub: (args) => BITS_MAP.Sub64(args),

	Mul32: ([x, y]) =>
		`((() => { const p = BigInt((${x}) >>> 0) * BigInt((${y}) >>> 0); return [Number(p >> 32n), Number(p & 0xffffffffn)]; })())`,
	Mul64: ([x, y]) =>
		`((() => { const xB = BigInt.asUintN(64, ${toBig64(x)}); const yB = BigInt.asUintN(64, ${toBig64(y)}); const mask32 = 0xffffffffn; const x0 = xB & mask32, x1 = xB >> 32n; const y0 = yB & mask32, y1 = yB >> 32n; const w0 = x0 * y0; const t = x1 * y0 + (w0 >> 32n); const w1 = (t & mask32) + x0 * y1; const hi = x1 * y1 + (t >> 32n) + (w1 >> 32n); const lo = BigInt.asUintN(64, xB * yB); return [hi, lo]; })())`,
	Mul: (args) => BITS_MAP.Mul64(args),

	Div32: ([hi, lo, y]) =>
		`((() => { const yu = (${y}) >>> 0; if (yu === 0) throw new Error("runtime error: integer divide by zero"); const hiu = (${hi}) >>> 0; if (hiu >= yu) throw new Error("runtime error: integer overflow"); const z = (BigInt(hiu) << 32n) | BigInt((${lo}) >>> 0); const yB = BigInt(yu); return [Number(z / yB), Number(z % yB)]; })())`,
	Div64: ([hi, lo, y]) =>
		`((() => { const yB = BigInt.asUintN(64, ${toBig64(y)}); if (yB === 0n) throw new Error("runtime error: integer divide by zero"); const hiB = BigInt.asUintN(64, ${toBig64(hi)}); if (hiB >= yB) throw new Error("runtime error: integer overflow"); const loB = BigInt.asUintN(64, ${toBig64(lo)}); const z = (hiB << 64n) | loB; return [BigInt.asUintN(64, z / yB), BigInt.asUintN(64, z % yB)]; })())`,
	Div: (args) => BITS_MAP.Div64(args),

	Rem32: ([hi, lo, y]) =>
		`((() => { const yu = (${y}) >>> 0; if (yu === 0) throw new Error("runtime error: integer divide by zero"); const z = (BigInt((${hi}) >>> 0) << 32n) | BigInt((${lo}) >>> 0); return Number(z % BigInt(yu)); })())`,
	Rem64: ([hi, lo, y]) =>
		`((() => { const yB = BigInt.asUintN(64, ${toBig64(y)}); if (yB === 0n) throw new Error("runtime error: integer divide by zero"); const z = ((BigInt.asUintN(64, ${toBig64(hi)}) % yB) << 64n) | BigInt.asUintN(64, ${toBig64(lo)}); return BigInt.asUintN(64, z % yB); })())`,
	Rem: (args) => BITS_MAP.Rem64(args),

	LeadingZeros8: ([x]) =>
		`((() => { const v = (${x}) & 0xff; return v === 0 ? 8 : Math.clz32(v) - 24; })())`,
	LeadingZeros16: ([x]) =>
		`((() => { const v = (${x}) & 0xffff; return v === 0 ? 16 : Math.clz32(v) - 16; })())`,
	LeadingZeros32: ([x]) => `Math.clz32((${x}) >>> 0)`,
	LeadingZeros64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, ${toBig64(x)}); if (v === 0n) return 64; const hi = Number(v >> 32n); return hi !== 0 ? Math.clz32(hi) : 32 + Math.clz32(Number(v & 0xffffffffn)); })())`,
	LeadingZeros: (args) => BITS_MAP.LeadingZeros64(args),

	TrailingZeros8: ([x]) =>
		`((() => { const v = (${x}) & 0xff; return v === 0 ? 8 : 31 - Math.clz32(v & -v); })())`,
	TrailingZeros16: ([x]) =>
		`((() => { const v = (${x}) & 0xffff; return v === 0 ? 16 : 31 - Math.clz32(v & -v); })())`,
	TrailingZeros32: ([x]) =>
		`((() => { const v = (${x}) >>> 0; return v === 0 ? 32 : 31 - Math.clz32(v & -v); })())`,
	TrailingZeros64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, ${toBig64(x)}); if (v === 0n) return 64; const lo = Number(v & 0xffffffffn); if (lo !== 0) return 31 - Math.clz32(lo & -lo); const hi = Number((v >> 32n) & 0xffffffffn); return 32 + (31 - Math.clz32(hi & -hi)); })())`,
	TrailingZeros: (args) => BITS_MAP.TrailingZeros64(args),

	OnesCount8: ([x]) =>
		`((() => { let v = (${x}) & 0xff; v = v - ((v >>> 1) & 0x55); v = (v & 0x33) + ((v >>> 2) & 0x33); return (v + (v >>> 4)) & 0x0f; })())`,
	OnesCount16: ([x]) =>
		`((() => { let v = (${x}) & 0xffff; v = v - ((v >>> 1) & 0x5555); v = (v & 0x3333) + ((v >>> 2) & 0x3333); return ((Math.imul((v + (v >>> 4)) & 0x0f0f, 0x0101)) >>> 8) & 0xff; })())`,
	OnesCount32: ([x]) =>
		`((() => { let v = (${x}) >>> 0; v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101)) >>> 24; })())`,
	OnesCount64: ([x]) =>
		`((() => { let v = BigInt.asUintN(64, ${toBig64(x)}); let c = 0; while (v > 0n) { if (v & 1n) c++; v >>= 1n; } return c; })())`,
	OnesCount: (args) => BITS_MAP.OnesCount64(args),

	RotateLeft8: ([x, k]) =>
		`((() => { const s = (${k}) & 7; const v = (${x}) & 0xff; return ((v << s) | (v >>> ((8 - s) & 7))) & 0xff; })())`,
	RotateLeft16: ([x, k]) =>
		`((() => { const s = (${k}) & 15; const v = (${x}) & 0xffff; return ((v << s) | (v >>> ((16 - s) & 15))) & 0xffff; })())`,
	RotateLeft32: ([x, k]) =>
		`((() => { const s = (${k}) & 31; const v = (${x}) >>> 0; return ((v << s) | (v >>> ((32 - s) & 31))) >>> 0; })())`,
	RotateLeft64: ([x, k]) =>
		`((() => { const s = ${toBig64(k)} & 63n; const v = BigInt.asUintN(64, ${toBig64(x)}); return BigInt.asUintN(64, (v << s) | (v >> ((64n - s) & 63n))); })())`,
	RotateLeft: (args) => BITS_MAP.RotateLeft64(args),

	Len8: ([x]) =>
		`((() => { const v = (${x}) & 0xff; return v === 0 ? 0 : 32 - Math.clz32(v); })())`,
	Len16: ([x]) =>
		`((() => { const v = (${x}) & 0xffff; return v === 0 ? 0 : 32 - Math.clz32(v); })())`,
	Len32: ([x]) => `((v => 32 - Math.clz32(v >>> 0))(${x}))`,
	Len64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, ${toBig64(x)}); if (v === 0n) return 0; const hi = Number(v >> 32n); return hi !== 0 ? 64 - Math.clz32(hi) : 32 - Math.clz32(Number(v & 0xffffffffn)); })())`,
	Len: (args) => BITS_MAP.Len64(args),

	Reverse8: ([x]) =>
		`((() => { let v = (${x}) & 0xff; v = ((v >>> 1) & 0x55) | ((v & 0x55) << 1); v = ((v >>> 2) & 0x33) | ((v & 0x33) << 2); return (((v >>> 4) & 0x0f) | ((v & 0x0f) << 4)) & 0xff; })())`,
	Reverse16: ([x]) =>
		`((() => { let v = (${x}) & 0xffff; v = ((v >>> 1) & 0x5555) | ((v & 0x5555) << 1); v = ((v >>> 2) & 0x3333) | ((v & 0x3333) << 2); v = ((v >>> 4) & 0x0f0f) | ((v & 0x0f0f) << 4); return (((v >>> 8) & 0x00ff) | ((v & 0x00ff) << 8)) & 0xffff; })())`,
	Reverse32: ([x]) =>
		`((() => { let v = (${x}) >>> 0; v = ((v >>> 1) & 0x55555555) | ((v & 0x55555555) << 1); v = ((v >>> 2) & 0x33333333) | ((v & 0x33333333) << 2); v = ((v >>> 4) & 0x0f0f0f0f) | ((v & 0x0f0f0f0f) << 4); v = ((v >>> 8) & 0x00ff00ff) | ((v & 0x00ff00ff) << 8); return ((v >>> 16) | (v << 16)) >>> 0; })())`,
	Reverse64: ([x]) =>
		`((() => { const rev32 = (v) => { v = ((v >>> 1) & 0x55555555) | ((v & 0x55555555) << 1); v = ((v >>> 2) & 0x33333333) | ((v & 0x33333333) << 2); v = ((v >>> 4) & 0x0f0f0f0f) | ((v & 0x0f0f0f0f) << 4); v = ((v >>> 8) & 0x00ff00ff) | ((v & 0x00ff00ff) << 8); return ((v >>> 16) | (v << 16)) >>> 0; }; const v = BigInt.asUintN(64, ${toBig64(x)}); const lo = Number(v & 0xffffffffn); const hi = Number((v >> 32n) & 0xffffffffn); return (BigInt(rev32(lo)) << 32n) | BigInt(rev32(hi)); })())`,
	Reverse: (args) => BITS_MAP.Reverse64(args),

	ReverseBytes16: ([x]) =>
		`((v => ((v & 0xff) << 8) | ((v >>> 8) & 0xff))((${x}) & 0xffff))`,
	ReverseBytes32: ([x]) =>
		`((v => (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | ((v >>> 24) & 0xff)) >>> 0)((${x}) >>> 0))`,
	ReverseBytes64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, ${toBig64(x)}); let r = 0n; for (let i = 0n; i < 8n; i++) r = (r << 8n) | ((v >> (i * 8n)) & 0xffn); return r; })())`,
	ReverseBytes: (args) => BITS_MAP.ReverseBytes64(args),
};

/** @type {ThisType<CodeGen>} */
export const bitsMethods = {
	_genBits(fn, a) {
		const args = a();
		const gen = BITS_MAP[fn];
		return gen ? gen(args) : undefined;
	},
};
