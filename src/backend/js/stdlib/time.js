// CodeGen for Go `time` package — `time.Now`, `time.Since`, etc., plus `*Time` methods.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const TIME_METHOD_DISPATCH = {
	Year: (r) =>
		`(${r}._offset === 0 ? ${r}._d.getUTCFullYear() : ${r}._d.getFullYear())`,
	Month: (r) =>
		`(${r}._offset === 0 ? ${r}._d.getUTCMonth() + 1 : ${r}._d.getMonth() + 1)`,
	Day: (r) => `(${r}._offset === 0 ? ${r}._d.getUTCDate() : ${r}._d.getDate())`,
	Hour: (r) =>
		`(${r}._offset === 0 ? ${r}._d.getUTCHours() : ${r}._d.getHours())`,
	Minute: (r) =>
		`(${r}._offset === 0 ? ${r}._d.getUTCMinutes() : ${r}._d.getMinutes())`,
	Second: (r) =>
		`(${r}._offset === 0 ? ${r}._d.getUTCSeconds() : ${r}._d.getSeconds())`,
	Weekday: (r) =>
		`(${r}._offset === 0 ? ${r}._d.getUTCDay() : ${r}._d.getDay())`,
	Unix: (r) => `Math.floor(${r}._d.getTime() / 1000)`,
	UnixMilli: (r) => `${r}._d.getTime()`,
	Add: (r, a) =>
		`{_d: new Date(${r}._d.getTime() + Math.round(Number(${a[0]}) / 1000000))}`,
	Sub: (r, a) =>
		`Math.round((${r}._d.getTime() - (${a[0]})._d.getTime()) * 1000000)`,
	Before: (r, a) => `(${r}._d < (${a[0]})._d)`,
	After: (r, a) => `(${r}._d > (${a[0]})._d)`,
	Equal: (r, a) => `(${r}._d.getTime() === (${a[0]})._d.getTime())`,
	IsZero: (r) =>
		`(!${r} || !${r}._d || ${r}._isZero === true || ${r}._d.getTime() === -62135596800000 || (${r}._d.getUTCFullYear() <= 1 && ${r}._d.getUTCMonth() === 0 && ${r}._d.getUTCDate() === 1 && ${r}._d.getUTCHours() === 0 && ${r}._d.getUTCMinutes() === 0 && ${r}._d.getUTCSeconds() === 0 && ${r}._d.getUTCMilliseconds() === 0))`,
	UnixNano: (r) => `(${r}?._d ? Math.round(${r}._d.getTime() * 1000000) : 0)`,
	Nanosecond: (r) =>
		`(${r}?._d ? (${r}._offset === 0 ? ${r}._d.getUTCMilliseconds() : ${r}._d.getMilliseconds()) * 1000000 : 0)`,
	UTC: (r) => `({_d: ${r}?._d ?? new Date(0), _offset: 0})`,
	Local: (r) => `({_d: ${r}?._d ?? new Date(0)})`,
	AddDate: (r, a) =>
		`({_d: new Date(${r}._d.getFullYear() + Number(${a[0]}), ${r}._d.getMonth() + Number(${a[1]}), ${r}._d.getDate() + Number(${a[2]}))})`,
	Truncate: (r, a) =>
		`({_d: new Date(Math.floor(${r}._d.getTime() / (Number(${a[0]}) / 1000000)) * (Number(${a[0]}) / 1000000))})`,
	Round: (r, a) =>
		`({_d: new Date(Math.round(${r}._d.getTime() / (Number(${a[0]}) / 1000000)) * (Number(${a[0]}) / 1000000))})`,
	Date: (r) =>
		`[${r}._offset === 0 ? ${r}._d.getUTCFullYear() : ${r}._d.getFullYear(), ${r}._offset === 0 ? ${r}._d.getUTCMonth() + 1 : ${r}._d.getMonth() + 1, ${r}._offset === 0 ? ${r}._d.getUTCDate() : ${r}._d.getDate()]`,
	Clock: (r) =>
		`[${r}._offset === 0 ? ${r}._d.getUTCHours() : ${r}._d.getHours(), ${r}._offset === 0 ? ${r}._d.getUTCMinutes() : ${r}._d.getMinutes(), ${r}._offset === 0 ? ${r}._d.getUTCSeconds() : ${r}._d.getSeconds()]`,
	YearDay: (r) =>
		`Math.floor((${r}._d - new Date(${r}._d.getFullYear(), 0, 0)) / 86400000)`,
	Compare: (r, a) =>
		`(${r}._d.getTime() < (${a[0]})._d.getTime() ? -1 : (${r}._d.getTime() > (${a[0]})._d.getTime() ? 1 : 0))`,
	In: (r) => `${r}`,
	Location: () => `null`,
	Zone: (r) =>
		`[${r}._offset === 0 ? "UTC" : "LOCAL", ${r}._offset === 0 ? 0 : -${r}._d.getTimezoneOffset() * 60]`,
};

const DURATION_METHOD_DISPATCH = {
	Nanoseconds: (r) => `${r}`,
	Microseconds: (r) => `Math.trunc(Number(${r}) / 1000)`,
	Milliseconds: (r) => `Math.trunc(Number(${r}) / 1000000)`,
	Seconds: (r) => `(Number(${r}) / 1000000000)`,
	Minutes: (r) => `(Number(${r}) / 60000000000)`,
	Hours: (r) => `(Number(${r}) / 3600000000000)`,
	String: (r) => `__durationString(${r})`,
};

const TIME_DISPATCH = {
	Now: () =>
		'(typeof globalThis.__GOFRONT_CLOCK === "function" ? {_d: new Date(globalThis.__GOFRONT_CLOCK())} : {_d: new Date()})',
	Since: (a) =>
		`(Math.round(((typeof globalThis.__GOFRONT_CLOCK === "function" ? globalThis.__GOFRONT_CLOCK() : Date.now()) - (${a[0]})._d.getTime()) * 1000000))`,
	Sleep: (a) => `await new Promise(r => setTimeout(r, ${a[0]} / 1000000))`,
	Unix: (a) =>
		`{_d: new Date(Number(${a[0]}) * 1000 + Math.round(Number(${a[1] || 0}) / 1000000))}`,
	UnixMicro: (a) => `{_d: new Date(Math.round(Number(${a[0]}) / 1000))}`,
	UnixMilli: (a) => `{_d: new Date(Number(${a[0]}))}`,
	Date: (a) =>
		`{_d: new Date(${a[0]}, ${a[1]} - 1, ${a[2]}, ${a[3]}, ${a[4]}, ${a[5]}, Math.round(Number(${a[6] || 0}) / 1000000))}`,
};

/** @type {ThisType<CodeGen>} */
export const timeMethods = {
	_genTimeMethodCall(method, expr) {
		const recv = expr.func.expr;
		const recvJs = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		if (method === "Format") {
			this.useHelper("timeFmt");
			return `__timeFmt(${recvJs}, ${args[0]})`;
		}
		if (method === "String") {
			this.useHelper("timeFmt");
			return `__timeFmt(${recvJs}, "2006-01-02 15:04:05.999999999 -0700 MST")`;
		}
		const gen = TIME_METHOD_DISPATCH[method];
		return gen ? gen(recvJs, args) : undefined;
	},

	_genDurationMethodCall(method, expr) {
		const recv = expr.func.expr;
		const recvJs = this.genExpr(recv);
		if (method === "String") {
			this.useHelper("duration");
		}
		const gen = DURATION_METHOD_DISPATCH[method];
		return gen ? gen(recvJs) : undefined;
	},

	_genTime(fn, a, expr) {
		if (fn === "Parse") {
			this.useHelper("timeParse");
			return `__timeParse(${a()[0]}, ${a()[1]})`;
		}
		if (fn === "Date") {
			const args = a();
			const locArg = expr?.args?.[7];
			const isUtc =
				(locArg?.kind === "SelectorExpr" &&
					(locArg.sel?.name === "UTC" || locArg.field === "UTC")) ||
				(locArg?.kind === "Ident" && locArg.name === "UTC") ||
				args[7] === '"UTC"';
			if (isUtc) {
				return `{_d: new Date(Date.UTC(${args[0]}, ${args[1]} - 1, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, Math.round(Number(${args[6] || 0}) / 1000000))), _offset: 0}`;
			}
			return `{_d: new Date(${args[0]}, ${args[1]} - 1, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, Math.round(Number(${args[6] || 0}) / 1000000))}`;
		}
		const gen = TIME_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
