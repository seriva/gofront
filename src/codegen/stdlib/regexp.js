// CodeGen for Go `regexp` package and `*Regexp` methods.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const REGEXP_METHOD = {
	MatchString: (re, a) => `${re}.test(${a[0]})`,
	FindString: (re, a) => `(${re}.exec(${a[0]})?.[0] ?? "")`,
	FindStringIndex: (re, a) =>
		`((m => m ? [m.index, m.index + m[0].length] : null)(${re}.exec(${a[0]})))`,
	FindAllString: (re, a) =>
		`[...${a[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${a[1]} < 0 ? undefined : ${a[1]}).map(m => m[0])`,
	FindStringSubmatch: (re, a) => `[...(${re}.exec(${a[0]}) ?? [])]`,
	FindAllStringSubmatch: (re, a) =>
		`[...${a[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${a[1]} < 0 ? undefined : ${a[1]}).map(m => [...m])`,
	ReplaceAllString: (re, a) =>
		`${a[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${a[1]})`,
	ReplaceAllLiteralString: (re, a) =>
		`${a[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${a[1]}.replace(/\\$/g, '$$$$'))`,
	Split: (re, a) =>
		`${a[0]}.split(${re}).slice(0, ${a[1]} < 0 ? undefined : ${a[1]})`,
	String: (re) => `${re}.source`,
};

/** @type {ThisType<CodeGen>} */
export const regexpMethods = {
	_genRegexp(fn, a) {
		// Converts a Go regexp pattern string (which may contain inline flags like (?i))
		// into a JS RegExp, extracting the flags into the second constructor argument.
		const makeRegExp = (pat) =>
			`((p) => { const m = /^\\(\\?([gimsuy]+)\\)/.exec(p); return m ? new RegExp(p.slice(m[0].length), m[1]) : new RegExp(p); })(${pat})`;
		switch (fn) {
			case "MustCompile":
				return makeRegExp(a()[0]);
			case "Compile":
				return `[${makeRegExp(a()[0])}, null]`;
			case "MatchString": {
				const [pat, s] = a();
				return `[new RegExp(${pat}).test(${s}), null]`;
			}
			case "QuoteMeta":
				return `${a()[0]}.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')`;
		}
		return undefined;
	},

	_genRegexpMethodCall(method, expr) {
		const recv = expr.func.expr;
		// *Regexp is a plain JS RegExp — no .value boxing needed
		const re = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		const gen = REGEXP_METHOD[method];
		return gen ? gen(re, args) : undefined;
	},
};
