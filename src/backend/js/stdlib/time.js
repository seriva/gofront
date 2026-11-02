// CodeGen for the JavaScript-only part of Go `time`: `Sleep` and `AfterFunc`.
// Everything else in the package is Go source (stdlib/time).

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const timeMethods = {
	_genTime(fn, a) {
		if (fn === "Sleep")
			return `await new Promise(r => setTimeout(r, Number(${a()[0]}) / 1000000))`;
		if (fn === "AfterFunc") {
			this.useHelper("timer");
			const args = a();
			return `__timeAfterFunc(${args[0]}, ${args[1]})`;
		}
		return undefined;
	},
};
