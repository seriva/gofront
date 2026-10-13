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
				return `(${s}).replace(/&(?:quot|apos|#39|#34|gt|lt|amp|#(?:[0-9]+|[xX][0-9a-fA-F]+));/g, m => { switch (m) { case "&quot;": case "&#34;": return '"'; case "&apos;": case "&#39;": return "'"; case "&gt;": return ">"; case "&lt;": return "<"; case "&amp;": return "&"; default: { if (m.startsWith("&#")) { const raw = m.slice(2, -1); const cp = (raw.startsWith("x") || raw.startsWith("X")) ? parseInt(raw.slice(1), 16) : parseInt(raw, 10); return (cp >= 0 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF)) ? String.fromCodePoint(cp) : "\\uFFFD"; } return m; } } })`;
			}
		}
		return undefined;
	},
};
