// src/backend/js/stdlib/hex.js
// CodeGen for Go encoding/hex package.

export const hexMethods = {
	_genHex(fn, a) {
		this.useHelper("hex");
		this.useHelper("error");
		const args = a();
		if (fn === "EncodeToString") return `__hex_encode_to_string(${args[0]})`;
		if (fn === "DecodeString") return `__hex_decode_string(${args[0]})`;
		if (fn === "Encode") return `__hex_encode(${args[0]}, ${args[1]})`;
		if (fn === "Decode") return `__hex_decode(${args[0]}, ${args[1]})`;
		if (fn === "EncodedLen") return `(${args[0]} * 2)`;
		if (fn === "DecodedLen") return `Math.floor(${args[0]} / 2)`;
		return undefined;
	},
};
