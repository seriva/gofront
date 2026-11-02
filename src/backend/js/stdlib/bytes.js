// CodeGen for Go `bytes` package constructors of `bytes.Buffer`.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const BYTES_DISPATCH = {
	NewBuffer: (a) => `({ _buf: Array.from(${a[0]} ?? []) })`,
	NewBufferString: (a) =>
		`({ _buf: Array.from(new TextEncoder().encode(${a[0]} ?? "")) })`,
};

/** @type {ThisType<CodeGen>} */
export const bytesMethods = {
	_genBytes(fn, a) {
		const gen = BYTES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
