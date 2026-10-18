// src/backend/js/stdlib/bits.js
// CodeGen for Go `math/bits` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const BITS_MAP = {
	LeadingZeros32: ([x]) => `Math.clz32((${x}) >>> 0)`,
	TrailingZeros32: ([x]) =>
		`((() => { const v = (${x}) >>> 0; return v === 0 ? 32 : 31 - Math.clz32(v & -v); })())`,
	OnesCount32: ([x]) =>
		`((() => { let v = (${x}) >>> 0; v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101)) >>> 24; })())`,
	RotateLeft32: ([x, k]) =>
		`((() => { const s = (${k}) & 31; const v = (${x}) >>> 0; return ((v << s) | (v >>> ((32 - s) & 31))) >>> 0; })())`,

	LeadingZeros64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, BigInt(${x})); if (v === 0n) return 64; const hi = Number(v >> 32n); return hi !== 0 ? Math.clz32(hi) : 32 + Math.clz32(Number(v & 0xffffffffn)); })())`,
	TrailingZeros64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, BigInt(${x})); if (v === 0n) return 64; const lo = Number(v & 0xffffffffn); if (lo !== 0) return 31 - Math.clz32(lo & -lo); const hi = Number((v >> 32n) & 0xffffffffn); return 32 + (31 - Math.clz32(hi & -hi)); })())`,
	OnesCount64: ([x]) =>
		`((() => { let v = BigInt.asUintN(64, BigInt(${x})); let c = 0; while (v > 0n) { if (v & 1n) c++; v >>= 1n; } return c; })())`,
	RotateLeft64: ([x, k]) =>
		`((() => { const s = BigInt(${k}) & 63n; const v = BigInt.asUintN(64, BigInt(${x})); return Number(BigInt.asUintN(64, (v << s) | (v >> ((64n - s) & 63n)))); })())`,

	Len32: ([x]) => `((v => 32 - Math.clz32(v >>> 0))(${x}))`,
	Len64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, BigInt(${x})); if (v === 0n) return 0; const hi = Number(v >> 32n); return hi !== 0 ? 64 - Math.clz32(hi) : 32 - Math.clz32(Number(v & 0xffffffffn)); })())`,
	ReverseBytes16: ([x]) =>
		`((v => ((v & 0xff) << 8) | ((v >>> 8) & 0xff))((${x}) & 0xffff))`,
	ReverseBytes32: ([x]) =>
		`((v => (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | ((v >>> 24) & 0xff)) >>> 0)((${x}) >>> 0))`,
	ReverseBytes64: ([x]) =>
		`((() => { const v = BigInt.asUintN(64, BigInt(${x})); let r = 0n; for (let i = 0n; i < 8n; i++) r = (r << 8n) | ((v >> (i * 8n)) & 0xffn); return Number(r); })())`,
	Reverse32: ([x]) =>
		`((() => { let v = (${x}) >>> 0; v = ((v >>> 1) & 0x55555555) | ((v & 0x55555555) << 1); v = ((v >>> 2) & 0x33333333) | ((v & 0x33333333) << 2); v = ((v >>> 4) & 0x0f0f0f0f) | ((v & 0x0f0f0f0f) << 4); v = ((v >>> 8) & 0x00ff00ff) | ((v & 0x00ff00ff) << 8); return ((v >>> 16) | (v << 16)) >>> 0; })())`,
	Reverse64: ([x]) =>
		`((() => { const rev32 = (v) => { v = ((v >>> 1) & 0x55555555) | ((v & 0x55555555) << 1); v = ((v >>> 2) & 0x33333333) | ((v & 0x33333333) << 2); v = ((v >>> 4) & 0x0f0f0f0f) | ((v & 0x0f0f0f0f) << 4); v = ((v >>> 8) & 0x00ff00ff) | ((v & 0x00ff00ff) << 8); return ((v >>> 16) | (v << 16)) >>> 0; }; const v = BigInt.asUintN(64, BigInt(${x})); const lo = Number(v & 0xffffffffn); const hi = Number((v >> 32n) & 0xffffffffn); return Number((BigInt(rev32(lo)) << 32n) | BigInt(rev32(hi))); })())`,
};

/** @type {ThisType<CodeGen>} */
export const bitsMethods = {
	_genBits(fn, a) {
		const args = a();
		const gen = BITS_MAP[fn];
		return gen ? gen(args) : undefined;
	},
};
