// src/backend/js/stdlib/sha256.js
// CodeGen for Go crypto/sha256 package.

export const sha256Methods = {
	_genSha256(fn, a) {
		this.useHelper("sha256");
		const args = a();
		if (fn === "Sum256") return `__sha256.Sum256(${args[0]})`;
		if (fn === "New") return "__sha256.New()";
		return undefined;
	},
};
