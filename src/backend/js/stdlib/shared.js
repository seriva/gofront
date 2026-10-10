// CodeGen for the `gofront/shared` package: in js packages a shared buffer is
// just a TypedArray (no linear memory is involved); in wasm packages the facade
// hands out zero-copy views onto the module memory.

import { SHARED_KINDS } from "../../../typechecker/stdlib/shared.js";

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const sharedMethods = {
	_genShared(fn, a) {
		if (!fn.startsWith("New")) return undefined;
		const info = SHARED_KINDS[fn.slice(3)];
		if (!info) return undefined;
		return `new ${info.ctor}(${a()[0]})`;
	},
};
