// CodeGen for Go `strconv` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

// Parsers return [value, msg|null] from the shared __strconv_* helpers
// (runtime.js); the message becomes a Go error value.
const parsed = (call, toValue = "r[0]") =>
	`((r) => [${toValue}, r[1] === null ? null : __error(r[1], r[1].includes("invalid syntax") ? __strconv_err_syntax : r[1].includes("value out of range") ? __strconv_err_range : null)])(${call})`;

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
		`((s) => { if (typeof s === "string" && s.startsWith("\`") && s.endsWith("\`") && s.length >= 2) { if (s.slice(1, -1).includes("\`")) return ["", __strconv_err_syntax]; return [s.slice(1, -1), null]; } try { const v = JSON.parse(s); if (typeof v !== "string") throw 0; return [v, null]; } catch(e) { return ["", __strconv_err_syntax]; } })(${a[0]})`,
	AppendInt: (a) =>
		`[...(${a[0]} ?? []), ...new TextEncoder().encode((${a[1]}).toString(${a[2]}))]`,
	AppendUint: (a) =>
		`[...(${a[0]} ?? []), ...new TextEncoder().encode((BigInt.asUintN(64, BigInt(${a[1]}))).toString(${a[2]}))]`,
	AppendBool: (a) =>
		`[...(${a[0]} ?? []), ...new TextEncoder().encode(String(${a[1]}))]`,
	AppendFloat: (a) =>
		`[...(${a[0]} ?? []), ...new TextEncoder().encode(__strconv_format_float(${a[1]}, typeof (${a[2]}) === "string" ? (${a[2]}).charCodeAt(0) : (${a[2]}), ${a[3]}))]`,
	FormatUint: (a) => `(BigInt.asUintN(64, BigInt(${a[0]}))).toString(${a[1]})`,
	ParseUint: (a) =>
		parsed(`__strconv_parse_uint(${a[0]}, ${a[1]}, ${a[2] ?? 64})`, "r[0]"),
};

const USES_ERROR = new Set([
	"Atoi",
	"ParseFloat",
	"ParseInt",
	"ParseUint",
	"ParseBool",
	"Unquote",
]);
const USES_STRCONV = new Set([
	"Atoi",
	"ParseFloat",
	"ParseInt",
	"ParseUint",
	"ParseBool",
	"FormatFloat",
	"AppendFloat",
]);

/** @type {ThisType<CodeGen>} */
export const strconvMethods = {
	_genStrconv(fn, a) {
		const gen = STRCONV_DISPATCH[fn];
		if (gen && USES_ERROR.has(fn)) {
			this.useHelper("error");
			this.useHelper("strconvError");
		}
		if (gen && USES_STRCONV.has(fn)) this.useHelper("strconv");
		return gen ? gen(a()) : undefined;
	},
};
