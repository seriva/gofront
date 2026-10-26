// src/backend/js/stdlib/simd.js
// CodeGen for the `gofront/simd` package in JS packages.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const simdMethods = {
	_genSimd(fn, a) {
		this.useHelper("simd");
		const args = a();
		switch (fn) {
			case "Splat":
				return `__simd_splat(${args[0]})`;
			case "NewF32x4":
				return `__simd_f32x4(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`;
			case "Select":
				return `__simd_select(${args[0]}, ${args[1]}, ${args[2]})`;
			case "Shuffle":
				return `__simd_shuffle(${args.join(", ")})`;
			case "LoadF32x4":
				return `__simd_load(${args[0]}, ${args[1]})`;
			case "StoreF32x4":
				return `__simd_store(${args[0]}, ${args[1]}, ${args[2]})`;
			default:
				return undefined;
		}
	},
};
