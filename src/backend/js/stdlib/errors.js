// CodeGen for Go `errors` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const errorsMethods = {
	_genErrors(fn, a) {
		const args = a();
		if (fn === "New") {
			this._usesError = true;
			return `__error(${args[0]})`;
		}
		if (fn === "Is") {
			this._usesErrorIs = true;
			return `__errorIs(${args[0]}, ${args[1]})`;
		}
		if (fn === "Unwrap") return `(${args[0]}?._cause ?? null)`;
		return undefined;
	},
};
