// src/backend/js/stdlib/base64.js
// CodeGen for Go encoding/base64 package.

export const base64Methods = {
	_genBase64(fn, a) {
		this.useHelper("base64");
		this.useHelper("error");
		const args = a();
		if (fn === "NewEncoding") return `__base64_make(${args[0]}, "=")`;
		return undefined;
	},
};
