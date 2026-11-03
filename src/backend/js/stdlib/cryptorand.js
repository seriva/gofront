// CodeGen for Go `crypto/rand`.  `math/rand` is Go source (stdlib/math/rand).

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const randMethods = {
	_genRand(fn, a) {
		if (fn !== "Read") return undefined;
		this.useHelper("cryptoRand");
		return `__crypto_rand_read(${a()[0]})`;
	},
};
