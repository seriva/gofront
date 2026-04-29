// CodeGen for Go `html` package.

export const htmlMethods = {
	_genHtml(fn, a) {
		switch (fn) {
			case "EscapeString": {
				const [s] = a();
				return `${s}.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;")`;
			}
			case "UnescapeString": {
				const [s] = a();
				return `${s}.replace(/&#39;/g,"'").replace(/&#34;/g,'"').replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&")`;
			}
		}
		return undefined;
	},
};
