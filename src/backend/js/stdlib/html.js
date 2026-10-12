// CodeGen for Go `html` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const htmlMethods = {
	_genHtml(fn, a) {
		switch (fn) {
			case "EscapeString": {
				const [s] = a();
				return `${s}.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;")`;
			}
			case "UnescapeString": {
				const [s] = a();
				return `(${s}).replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (_, c) => String.fromCodePoint(c.startsWith("x") || c.startsWith("X") ? parseInt(c.slice(1), 16) : parseInt(c, 10))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&#34;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")`;
			}
		}
		return undefined;
	},
};
