// CodeGen for Go `fmt` package — installed onto CodeGen.prototype via stdlibGenMethods.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const _SSCAN_LOOP =
	`let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { ` +
	`const t = tokens[i]; const p = ptrs[i]; ` +
	`if (typeof p.value === "number") { const v = Number(t); p.value = Number.isNaN(v) ? 0 : v; } ` +
	`else if (typeof p.value === "boolean") p.value = t === "true"; ` +
	`else p.value = t; n++; }`;

/** @type {ThisType<CodeGen>} */
export const fmtMethods = {
	_genFmt(fn, _a, expr) {
		const fmtArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
		switch (fn) {
			case "Sprintf":
				this.useHelper("sprintf");
				return `__sprintf(${fmtArgs})`;
			case "Errorf": {
				this.useHelper("sprintf");
				this.useHelper("error");
				const fmtStr = expr.args[0];
				if (fmtStr?.kind === "BasicLit" && fmtStr.value?.includes("%w")) {
					const lastArg = this.genExpr(expr.args[expr.args.length - 1]);
					return `__error(__sprintf(${fmtArgs}), ${lastArg})`;
				}
				return `__error(__sprintf(${fmtArgs}))`;
			}
			case "Printf":
				this.useHelper("sprintf");
				return this._genStdoutWrite(`__sprintf(${fmtArgs})`);
			case "Print":
				this.useHelper("sprintf");
				return this._genStdoutWrite(this._genPrintOperands(expr, "", ""));
			case "Println":
				this.useHelper("sprintf");
				// console.log supplies the trailing newline.
				return `console.log(${this._genPrintOperands(expr, " ", "")})`;
			case "Fprintf":
			case "Fprintln":
			case "Fprint":
				return this._genFmtFprint(fn, expr);
			case "Sscan": {
				this.useHelper("error");
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, n < ptrs.length ? __error("unexpected EOF") : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanln": {
				this.useHelper("error");
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const tokens = str.split("\\n")[0].trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, n < ptrs.length ? __error("unexpected EOF") : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanf": {
				this.useHelper("error");
				const strArg = this.genExpr(expr.args[0]);
				const fmtArg = this.genExpr(expr.args[1]);
				const restArgs = expr.args
					.slice(2)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, _fmt, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, n < ptrs.length ? __error("unexpected EOF") : null]; })(${strArg}, ${fmtArg}, ${restArgs})`;
			}
			default:
				return undefined;
		}
	},

	_genFmtFprint(fn, expr) {
		this.useHelper("sprintf");
		const writerArg = expr.args[0];
		const rest = expr.args.slice(1);
		const restJs = rest.map((e) => this.genExpr(e)).join(", ");
		const writerType = writerArg._type;
		const targetTypeName =
			writerType?.name ??
			(writerType?.kind === "pointer" ? writerType.base?.name : null);
		const sprintfCall = this._buildFprintSprintfCall(fn, rest.length, restJs);
		if (targetTypeName === "strings.Builder") {
			const w = this.genExpr(writerArg);
			const base = this._unboxWriter(w);
			return `((__b, __s) => { __b._buf += __s; return [__s.length, null]; })(${base}, ${sprintfCall})`;
		}
		if (targetTypeName === "bytes.Buffer") {
			const w = this.genExpr(writerArg);
			const base = this._unboxWriter(w);
			return `((__b, __s) => { const __bytes = new TextEncoder().encode(__s); for (let i = 0; i < __bytes.length; i++) __b._buf.push(__bytes[i]); return [__bytes.length, null]; })(${base}, ${sprintfCall})`;
		}
		// Generic io.Writer fallback — call .WriteString if available
		const w = this.genExpr(writerArg);
		return `((__w, __s) => typeof __w.WriteString === "function" ? __w.WriteString(__s) : __w.Write(new TextEncoder().encode(__s)))(${w}, ${sprintfCall})`;
	},

	_genStdoutWrite(strJs) {
		return `((__s) => (typeof process !== "undefined" && process?.stdout?.write ? process.stdout.write(__s) : console.log(__s)))(${strJs})`;
	},

	// Formats Print/Println operands with %v so the first operand is never
	// mistaken for a format string.
	_genPrintOperands(expr, sep, suffix) {
		const argc = expr.args.length;
		if (argc === 0) return JSON.stringify(suffix);
		const fmt = Array(argc).fill("%v").join(sep) + suffix;
		const args = expr.args.map((e) => this.genExpr(e)).join(", ");
		return `__sprintf(${JSON.stringify(fmt)}, ${args})`;
	},

	_buildFprintSprintfCall(fn, argc, restJs) {
		if (fn === "Fprintf") return `__sprintf(${restJs})`;
		if (argc === 0) return fn === "Fprintln" ? '"\\n"' : '""';
		const sep = fn === "Fprintln" ? " " : "";
		const suffix = fn === "Fprintln" ? "\\n" : "";
		const fmt = Array(argc).fill("%v").join(sep) + suffix;
		return `__sprintf("${fmt}", ${restJs})`;
	},
};
