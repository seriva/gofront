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
		`{_d: new Date(${r}._d.getTime() + Math.round(Number(${a[0]}) / 1000000)), _offset: ${r}._offset, _loc: ${r}._loc, _ns: ${r}._ns}`,
	Sub: (r, a) =>
		`Math.round((${r}._d.getTime() - (${a[0]})._d.getTime()) * 1000000)`,
	Before: (r, a) => `(${r}._d < (${a[0]})._d)`,
	After: (r, a) => `(${r}._d > (${a[0]})._d)`,
	Equal: (r, a) =>
		`(${r}._d.getTime() === (${a[0]})._d.getTime() && (${r}._ns || 0) === ((${a[0]})._ns || 0))`,
	IsZero: (r) =>
		`(!${r} || !${r}._d || ${r}._isZero === true || ${r}._d.getTime() === -62135596800000 || (${r}._d.getUTCFullYear() <= 1 && ${r}._d.getUTCMonth() === 0 && ${r}._d.getUTCDate() === 1 && ${r}._d.getUTCHours() === 0 && ${r}._d.getUTCMinutes() === 0 && ${r}._d.getUTCSeconds() === 0 && ${r}._d.getUTCMilliseconds() === 0))`,
	UnixNano: (r) =>
		`(${r}?._d ? Math.round(${r}._d.getTime() * 1000000) + (${r}._ns || 0) : 0)`,
	Nanosecond: (r) =>
		`(${r}?._d ? (${r}._offset === 0 ? ${r}._d.getUTCMilliseconds() : ${r}._d.getMilliseconds()) * 1000000 + (${r}._ns || 0) : 0)`,
	UTC: (r) =>
		`({_d: ${r}?._d ?? new Date(0), _offset: 0, _loc: null, _ns: ${r}?._ns || 0})`,
	Local: (r) =>
		`({_d: ${r}?._d ?? new Date(0), _offset: undefined, _loc: null, _ns: ${r}?._ns || 0})`,
	AddDate: (r, a) => `__timeAddDate(${r}, ${a[0]}, ${a[1]}, ${a[2]})`,
	Truncate: (r, a) => `__timeTruncate(${r}, ${a[0]})`,
	Round: (r, a) => `__timeRound(${r}, ${a[0]})`,
	Date: (r) =>
		`[${r}._offset === 0 ? ${r}._d.getUTCFullYear() : ${r}._d.getFullYear(), ${r}._offset === 0 ? ${r}._d.getUTCMonth() + 1 : ${r}._d.getMonth() + 1, ${r}._offset === 0 ? ${r}._d.getUTCDate() : ${r}._d.getDate()]`,
	Clock: (r) =>
		`[${r}._offset === 0 ? ${r}._d.getUTCHours() : ${r}._d.getHours(), ${r}._offset === 0 ? ${r}._d.getUTCMinutes() : ${r}._d.getMinutes(), ${r}._offset === 0 ? ${r}._d.getUTCSeconds() : ${r}._d.getSeconds()]`,
	YearDay: (r) => `__timeYearDay(${r})`,
	Compare: (r, a) =>
		`(${r}._d.getTime() < (${a[0]})._d.getTime() ? -1 : (${r}._d.getTime() > (${a[0]})._d.getTime() ? 1 : ((${r}._ns || 0) < ((${a[0]})._ns || 0) ? -1 : ((${r}._ns || 0) > ((${a[0]})._ns || 0) ? 1 : 0))))`,
	ISOWeek: (r) => `__timeISOWeek(${r})`,
	In: (r, a) =>
		`((() => { const _loc = ${a[0]}; const _off = _loc && typeof _loc._offset === "number" ? _loc._offset : 0; return { _d: ${r}._d, _offset: _off, _loc, _ns: ${r}._ns }; })())`,
	Location: (r) =>
		`(${r}._loc ?? (${r}._offset === 0 ? { _name: "UTC", _offset: 0, String() { return "UTC"; } } : { _name: "Local", _offset: -${r}._d.getTimezoneOffset() * 60, String() { return "Local"; } }))`,
	Zone: (r) =>
		`[${r}._loc ? ${r}._loc._name : (${r}._offset === 0 ? "UTC" : "LOCAL"), ${r}._loc ? ${r}._loc._offset : (${r}._offset === 0 ? 0 : -${r}._d.getTimezoneOffset() * 60)]`,
	MarshalJSON: (r) => `__timeMarshalJSON(${r})`,
	UnmarshalJSON: (r, a) => `__timeUnmarshalJSON(${r}, ${a[0]})`,
	MarshalText: (r) => `__timeMarshalText(${r})`,
	UnmarshalText: (r, a) => `__timeUnmarshalText(${r}, ${a[0]})`,
};

const DURATION_METHOD_DISPATCH = {
	Nanoseconds: (r) => `${r}`,
	Microseconds: (r) => `Math.trunc(Number(${r}) / 1000)`,
	Milliseconds: (r) => `Math.trunc(Number(${r}) / 1000000)`,
	Seconds: (r) => `(Number(${r}) / 1000000000)`,
	Minutes: (r) => `(Number(${r}) / 60000000000)`,
	Hours: (r) => `(Number(${r}) / 3600000000000)`,
	String: (r) => `__durationString(${r})`,
	Truncate: (r, a) => `(${a[0]} <= 0n ? ${r} : ${r} - (${r} % ${a[0]}))`,
	Round: (r, a) => `__durationRound(${r}, ${a[0]})`,
	Abs: (r) =>
		`(${r} >= 0n ? ${r} : (${r} === -9223372036854775808n ? 9223372036854775807n : -(${r})))`,
};

const TIME_DISPATCH = {
	Now: () =>
		'(typeof globalThis.__GOFRONT_CLOCK === "function" ? {_d: new Date(globalThis.__GOFRONT_CLOCK())} : {_d: new Date()})',
	Since: (a) =>
		`(Math.round(((typeof globalThis.__GOFRONT_CLOCK === "function" ? globalThis.__GOFRONT_CLOCK() : Date.now()) - (${a[0]})._d.getTime()) * 1000000))`,
	Sleep: (a) => `await new Promise(r => setTimeout(r, ${a[0]} / 1000000))`,
	Unix: (a) =>
		`{_d: new Date(Number(${a[0]}) * 1000 + Math.round(Number(${a[1] || 0}) / 1000000)), _ns: Math.round(Number(${a[1] || 0}) % 1000000)}`,
	UnixMicro: (a) =>
		`{_d: new Date(Math.round(Number(${a[0]}) / 1000)), _ns: Math.round((Number(${a[0]}) % 1000) * 1000)}`,
	UnixMilli: (a) => `{_d: new Date(Number(${a[0]}))}`,
	Date: (a) =>
		`{_d: new Date(${a[0]}, ${a[1]} - 1, ${a[2]}, ${a[3]}, ${a[4]}, ${a[5]}, Math.round(Number(${a[6] || 0}) / 1000000)), _ns: Math.round(Number(${a[6] || 0}) % 1000000)}`,
	ParseDuration: (a) => `__timeParseDuration(${a[0]})`,
	FixedZone: (a) =>
		`({ _name: ${a[0]}, _offset: ${a[1]}, String() { return this._name; } })`,
	AfterFunc: (a) => `__timeAfterFunc(${a[0]}, ${a[1]})`,
};

/** @type {ThisType<CodeGen>} */
export const timeMethods = {
	_genTimeMethodCall(method, expr) {
		const recv = expr.func.expr;
		const recvJs = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		this.useHelper("timeFmt");
		this.useHelper("duration");
		this.useHelper("timeParse");
		if (method === "Format") {
			return `__timeFmt(${recvJs}, ${args[0]})`;
		}
		if (method === "String") {
			return `__timeFmt(${recvJs}, "2006-01-02 15:04:05.999999999 -0700 MST")`;
		}
		const gen = TIME_METHOD_DISPATCH[method];
		return gen ? gen(recvJs, args) : undefined;
	},

	_genDurationMethodCall(method, expr) {
		const recv = expr.func.expr;
		const recvJs = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		this.useHelper("duration");
		const gen = DURATION_METHOD_DISPATCH[method];
		return gen ? gen(recvJs, args) : undefined;
	},

	_genTimeDate(args, expr) {
		this.useHelper("timeFmt");
		const locArg = expr?.args?.[7];
		const isUtc =
			(locArg?.kind === "SelectorExpr" &&
				(locArg.sel?.name === "UTC" || locArg.field === "UTC")) ||
			(locArg?.kind === "Ident" && locArg.name === "UTC") ||
			args[7] === '"UTC"';
		if (isUtc) {
			return `{_d: new Date(Date.UTC(${args[0]}, ${args[1]} - 1, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, Math.floor(Number(${args[6] || 0}) / 1000000))), _offset: 0, _loc: null, _ns: Math.floor(Number(${args[6] || 0}) % 1000000)}`;
		}
		return `((() => { const _loc = ${args[7]}; const _off = _loc && typeof _loc._offset === "number" ? _loc._offset : undefined; const _ms = Math.floor(Number(${args[6] || 0}) / 1000000); const _remNs = Math.floor(Number(${args[6] || 0}) % 1000000); if (_off !== undefined) { const _d = new Date(Date.UTC(${args[0]}, ${args[1]} - 1, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, _ms) - _off * 1000); return { _d, _offset: _off, _loc, _ns: _remNs }; } return { _d: new Date(${args[0]}, ${args[1]} - 1, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, _ms), _offset: undefined, _loc: null, _ns: _remNs }; })())`;
	},

	_genTime(fn, a, expr) {
		if (fn === "Date") return this._genTimeDate(a(), expr);
		if (fn === "Parse") {
			this.useHelper("timeParse");
			this.useHelper("timeFmt");
			return `__timeParse(${a()[0]}, ${a()[1]})`;
		}
		if (fn === "ParseDuration") {
			this.useHelper("duration");
			return `__timeParseDuration(${a()[0]})`;
		}
		if (fn === "FixedZone") {
			this.useHelper("timeFmt");
			const args = a();
			return `({ _name: ${args[0]}, _offset: ${args[1]}, String() { return this._name; } })`;
		}
		if (fn === "AfterFunc") {
			this.useHelper("timeFmt");
			const args = a();
			return `__timeAfterFunc(${args[0]}, ${args[1]})`;
		}
		const gen = TIME_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
