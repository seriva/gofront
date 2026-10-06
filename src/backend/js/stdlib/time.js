// CodeGen for Go `time` package — `time.Now`, `time.Since`, etc., plus `*Time` methods.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const TIME_METHOD_DISPATCH = {
	Year: (r) => `${r}._d.getFullYear()`,
	Month: (r) => `${r}._d.getMonth() + 1`,
	Day: (r) => `${r}._d.getDate()`,
	Hour: (r) => `${r}._d.getHours()`,
	Minute: (r) => `${r}._d.getMinutes()`,
	Second: (r) => `${r}._d.getSeconds()`,
	Weekday: (r) => `${r}._d.getDay()`,
	Unix: (r) => `Math.floor(${r}._d.getTime() / 1000)`,
	UnixMilli: (r) => `${r}._d.getTime()`,
	Add: (r, a) => `{_d: new Date(${r}._d.getTime() + (${a[0]}))}`,
	Sub: (r, a) => `${r}._d.getTime() - (${a[0]})._d.getTime()`,
	Before: (r, a) => `${r}._d < (${a[0]})._d`,
	After: (r, a) => `${r}._d > (${a[0]})._d`,
	Equal: (r, a) => `${r}._d.getTime() === (${a[0]})._d.getTime()`,
};

const TIME_DISPATCH = {
	Now: () => "{_d: new Date()}",
	Since: (a) => `(Date.now() - (${a[0]})._d.getTime())`,
	Sleep: (a) => `await new Promise(r => setTimeout(r, ${a[0]} / 1000000))`,
	Unix: (a) => `{_d: new Date((${a[0]}) * 1000)}`,
	Date: (a) =>
		`{_d: new Date(${a[0]}, ${a[1]} - 1, ${a[2]}, ${a[3]}, ${a[4]}, ${a[5]})}`,
};

/** @type {ThisType<CodeGen>} */
export const timeMethods = {
	_genTimeMethodCall(method, expr) {
		const recv = expr.func.expr;
		const recvJs = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		if (method === "Format") {
			this._usesTimeFmt = true;
			return `__timeFmt(${recvJs}._d, ${args[0]})`;
		}
		if (method === "String") {
			this._usesTimeFmt = true;
			return `__timeFmt(${recvJs}._d, "2006-01-02T15:04:05Z07:00")`;
		}
		const gen = TIME_METHOD_DISPATCH[method];
		return gen ? gen(recvJs, args) : undefined;
	},

	_genTime(fn, a) {
		if (fn === "Parse") {
			this._usesTimeParse = true;
			return `__timeParse(${a()[0]}, ${a()[1]})`;
		}
		const gen = TIME_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
