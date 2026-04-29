// CodeGen for Go `strconv` package.

const STRCONV_DISPATCH = {
	Itoa: (a) => `String(${a[0]})`,
	Atoi: (a) =>
		`(Number.isNaN(Number(${a[0]})) ? [0, "invalid syntax"] : [Number(${a[0]}) | 0, null])`,
	FormatBool: (a) => `String(${a[0]})`,
	FormatInt: (a) => `(${a[0]}).toString(${a[1]})`,
	FormatFloat: (a) => `String(${a[0]})`,
	ParseFloat: (a) =>
		`(Number.isNaN(Number(${a[0]})) ? [0, "invalid syntax"] : [Number(${a[0]}), null])`,
	ParseInt: (a) =>
		`(Number.isNaN(parseInt(${a[0]}, ${a[1]} || 10)) ? [0, "invalid syntax"] : [parseInt(${a[0]}, ${a[1]} || 10), null])`,
	ParseBool: (a) =>
		`(${a[0]} === "true" || ${a[0]} === "1" ? [true, null] : ${a[0]} === "false" || ${a[0]} === "0" ? [false, null] : [false, "invalid syntax"])`,
	Quote: (a) => `JSON.stringify(${a[0]})`,
	Unquote: (a) =>
		`((s) => { try { const v = JSON.parse(s); return [v, null]; } catch(e) { return ["", "invalid syntax"]; } })(${a[0]})`,
	AppendInt: (a) =>
		`[...(${a[0]}), ...new TextEncoder().encode((${a[1]}).toString(${a[2]}))]`,
	AppendFloat: (a) =>
		`[...(${a[0]}), ...new TextEncoder().encode(${a[1]}.toFixed(${a[3]} < 0 ? 6 : ${a[3]}))]`,
};

export const strconvMethods = {
	_genStrconv(fn, a) {
		const gen = STRCONV_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
