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
		`((() => { const s = BigInt(${k}) & 63n; const v = BigInt.asUintN(64, BigInt(${x})); return BigInt.asUintN(64, (v << s) | (v >> ((64n - s) & 63n))); })())`,
};

/** @type {ThisType<CodeGen>} */
export const bitsMethods = {
	_genBits(fn, a) {
		const args = a();
		const gen = BITS_MAP[fn];
		return gen ? gen(args) : undefined;
	},
};
