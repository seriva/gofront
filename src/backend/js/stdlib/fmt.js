// CodeGen for Go `fmt` package — installed onto CodeGen.prototype via stdlibGenMethods.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const _SSCAN_LOOP =
	`let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { ` +
	`const t = tokens[i]; const p = ptrs[i]; ` +
	`if (typeof p.value === "number") p.value = Number(t); ` +
	`else if (typeof p.value === "boolean") p.value = t === "true"; ` +
	`else p.value = t; n++; }`;

/** @type {ThisType<CodeGen>} */
export const fmtMethods = {
	_genFmt(fn, _a, expr) {
		const fmtArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
		switch (fn) {
			case "Sprintf":
				this._usesSprintf = true;
				return `__sprintf(${fmtArgs})`;
			case "Errorf": {
				this._usesSprintf = true;
				this._usesError = true;
				const fmtStr = expr.args[0];
				if (fmtStr?.kind === "BasicLit" && fmtStr.value?.includes("%w")) {
					const lastArg = this.genExpr(expr.args[expr.args.length - 1]);
					return `__error(__sprintf(${fmtArgs}), ${lastArg})`;
				}
				return `__error(__sprintf(${fmtArgs}))`;
			}
			case "Printf":
				this._usesSprintf = true;
				return this._genStdoutWrite(`__sprintf(${fmtArgs})`);
			case "Print":
				this._usesSprintf = true;
				return this._genStdoutWrite(this._genPrintOperands(expr, "", ""));
			case "Println":
				this._usesSprintf = true;
				// console.log supplies the trailing newline.
				return `console.log(${this._genPrintOperands(expr, " ", "")})`;
			case "Fprintf":
			case "Fprintln":
			case "Fprint":
				return this._genFmtFprint(fn, expr);
			case "Sscan": {
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, n < ptrs.length ? "unexpected EOF" : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanln": {
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const tokens = str.split("\\n")[0].trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, n < ptrs.length ? "unexpected EOF" : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanf": {
				const strArg = this.genExpr(expr.args[0]);
				const fmtArg = this.genExpr(expr.args[1]);
				const restArgs = expr.args
					.slice(2)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, _fmt, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, n < ptrs.length ? "input does not match format" : null]; })(${strArg}, ${fmtArg}, ${restArgs})`;
			}
			default:
				return undefined;
		}
	},

	_genFmtFprint(fn, expr) {
		this._usesSprintf = true;
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
			return `(${base}._buf += ${sprintfCall})`;
		}
		if (targetTypeName === "bytes.Buffer") {
			const w = this.genExpr(writerArg);
			const base = this._unboxWriter(w);
			return `((__b,__s)=>{ __b._buf.push(...new TextEncoder().encode(__s)); })(${base}, ${sprintfCall})`;
		}
		// Generic io.Writer fallback — call .WriteString if available
		const w = this.genExpr(writerArg);
		return `${w}.WriteString(${sprintfCall})`;
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
