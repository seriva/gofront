// CodeGen for Go `strconv` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

// Parsers return [value, msg|null] from the shared __strconv_* helpers
// (runtime.js); the message becomes a Go error value.
const parsed = (call, toValue = "r[0]") =>
	`((r) => [${toValue}, r[1] === null ? null : __error(r[1])])(${call})`;

const STRCONV_DISPATCH = {
	Itoa: (a) => `String(${a[0]})`,
	Atoi: (a) => parsed(`__strconv_atoi(${a[0]})`, "Number(r[0])"),
	FormatBool: (a) => `String(${a[0]})`,
	FormatInt: (a) => `(${a[0]}).toString(${a[1]})`,
	FormatFloat: (a) =>
		a.length < 3
			? `String(${a[0]})`
			: `__strconv_format_float(${a[0]}, ${a[1]}, ${a[2]})`,
	ParseFloat: (a) => parsed(`__strconv_parse_float(${a[0]})`),
	ParseInt: (a) =>
		parsed(
			`__strconv_parse_int(${a[0]}, ${a[1]}, ${a[2] ?? 64})`,
			"Number(r[0])",
		),
	ParseBool: (a) => parsed(`__strconv_parse_bool(${a[0]})`),
	Quote: (a) => `JSON.stringify(${a[0]})`,
	Unquote: (a) =>
		`((s) => { try { const v = JSON.parse(s); return [v, null]; } catch(e) { return ["", __error("invalid syntax")]; } })(${a[0]})`,
	AppendInt: (a) =>
		`[...(${a[0]}), ...new TextEncoder().encode((${a[1]}).toString(${a[2]}))]`,
	AppendFloat: (a) =>
		`[...(${a[0]}), ...new TextEncoder().encode(${a[1]}.toFixed(${a[3]} < 0 ? 6 : ${a[3]}))]`,
};

const USES_ERROR = new Set([
	"Atoi",
	"ParseFloat",
	"ParseInt",
	"ParseBool",
	"Unquote",
]);
const USES_STRCONV = new Set([
	"Atoi",
	"ParseFloat",
	"ParseInt",
	"ParseBool",
	"FormatFloat",
]);

/** @type {ThisType<CodeGen>} */
export const strconvMethods = {
	_genStrconv(fn, a) {
		const gen = STRCONV_DISPATCH[fn];
		if (gen && USES_ERROR.has(fn)) this.useHelper("error");
		if (gen && USES_STRCONV.has(fn)) this.useHelper("strconv");
		return gen ? gen(a()) : undefined;
	},
};
