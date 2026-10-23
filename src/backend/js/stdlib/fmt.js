// CodeGen for Go `fmt` package — installed onto CodeGen.prototype via stdlibGenMethods.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const _SSCAN_LOOP =
	`let n = 0, err = null; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { ` +
	`const item = tokens[i]; const t = typeof item === "object" && item !== null ? item.t : item; const verb = item?.verb; const p = ptrs[i]; ` +
	`if (verb === "%c") { p.value = t.codePointAt ? t.codePointAt(0) : t; } ` +
	`else if (verb === "%x" || verb === "%X") { const clean = t.replace(/^0[xX]/, ""); const v = parseInt(clean, 16); if (isNaN(v)) { err = __error("expected hex number"); break; } p.value = typeof p.value === "bigint" ? BigInt("0x" + clean) : v; } ` +
	`else if (verb === "%o") { const clean = t.replace(/^0[oO]?/, ""); const v = parseInt(clean, 8); if (isNaN(v)) { err = __error("expected octal number"); break; } p.value = typeof p.value === "bigint" ? BigInt("0o" + clean) : v; } ` +
	`else if (verb === "%b") { const clean = t.replace(/^0[bB]/, ""); const v = parseInt(clean, 2); if (isNaN(v)) { err = __error("expected binary number"); break; } p.value = typeof p.value === "bigint" ? BigInt("0b" + clean) : v; } ` +
	`else if (typeof p.value === "number") { const v = Number(t); if (Number.isNaN(v) || !/^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$/.test(t)) { err = __error("expected number"); break; } p.value = v; } ` +
	`else if (typeof p.value === "bigint") { try { if (!/^[+-]?\\d+$/.test(t)) throw 1; p.value = BigInt(t); } catch { err = __error("expected integer"); break; } } ` +
	`else if (typeof p.value === "boolean") { const tl = String(t).toLowerCase(); if (tl === "true" || tl === "1" || tl === "t") p.value = true; else if (tl === "false" || tl === "0" || tl === "f") p.value = false; else { err = __error("expected boolean"); break; } } ` +
	`else p.value = t; n++; }`;

/** @type {ThisType<CodeGen>} */
export const fmtMethods = {
	_fmtArgJs(e) {
		const js = this.genExpr(e);
		const base =
			e?._type?.kind === "named" ? (e._type.underlying ?? e._type) : e?._type;
		return base?.kind === "slice" ? `(${js} ?? [])` : js;
	},

	_genFmt(fn, _a, expr) {
		const fmtArgs = expr.args
			.map((e, idx) => (idx === 0 ? this.genExpr(e) : this._fmtArgJs(e)))
			.join(", ");
		switch (fn) {
			case "Sprintf":
				this.useHelper("sprintf");
				return `__sprintf(${fmtArgs})`;
			case "Sprint":
			case "Sprintln":
				this.useHelper("sprint");
				return `__sprint(${fn === "Sprintln"}${expr.args.map((e) => `, ${this._fmtArgJs(e)}`).join("")})`;
			case "Append":
			case "Appendln":
			case "Appendf": {
				this.useHelper("sprint");
				const [dst, ...rest] = expr.args;
				const restJs = rest
					.map((e, idx) =>
						fn === "Appendf" && idx === 0 ? this.genExpr(e) : this._fmtArgJs(e),
					)
					.join(", ");
				const str =
					fn === "Appendf"
						? `__sprintf(${restJs})`
						: `__sprint(${fn === "Appendln"}${restJs ? `, ${restJs}` : ""})`;
				// __append reuses spare capacity of dst like append; chunked so a
				// long string cannot overflow the argument limit of the spread.
				this.useHelper("append");
				return `((d, s) => { const e = new TextEncoder().encode(s); let r = d ?? new Uint8Array(0); for (let i = 0; i < e.length; i += 8192) r = __append(r, ...e.subarray(i, i + 8192)); return r; })(${this.genExpr(dst)}, ${str})`;
			}
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
				this.useHelper("sprint");
				return this._genStdoutWrite(
					`__sprint(false${expr.args.map((e) => `, ${this._fmtArgJs(e)}`).join("")})`,
				);
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
				return `((str, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, err ? err : (n < ptrs.length ? __error("unexpected EOF") : null)]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanln": {
				this.useHelper("error");
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const tokens = str.split("\\n")[0].trim().split(/\\s+/).filter(Boolean); ${_SSCAN_LOOP} return [n, err ? err : (n < ptrs.length ? __error("unexpected EOF") : null)]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanf": {
				this.useHelper("error");
				const strArg = this.genExpr(expr.args[0]);
				const fmtArg = this.genExpr(expr.args[1]);
				const restArgs = expr.args
					.slice(2)
					.map((e) => this.genExpr(e))
					.join(", ");
				return (
					`((str, fmt, ...ptrs) => { ` +
					`const s = String(str); const f = String(fmt); ` +
					`let si = 0, fi = 0; const tokens = []; let parseErr = null; ` +
					`while (fi < f.length) { ` +
					`if (/\\s/.test(f[fi])) { ` +
					`while (fi < f.length && /\\s/.test(f[fi])) fi++; ` +
					`while (si < s.length && /\\s/.test(s[si])) si++; ` +
					`continue; ` +
					`} ` +
					`if (f[fi] === "%") { ` +
					`if (fi + 1 < f.length && f[fi + 1] === "%") { ` +
					`if (s[si] !== "%") { parseErr = __error("input does not match format"); break; } ` +
					`si++; fi += 2; continue; ` +
					`} ` +
					`const vm = f.slice(fi).match(/^%[vdsfqtxXbcoeEfFgG]/); ` +
					`if (vm) { ` +
					`const verb = vm[0]; fi += verb.length; ` +
					`if (verb !== "%c") { while (si < s.length && /\\s/.test(s[si])) si++; } ` +
					`if (si >= s.length) break; ` +
					`let tokRe = /^\\S+/; ` +
					`if (verb === "%d" || verb === "%i") tokRe = /^[+-]?\\d+/; ` +
					`else if (verb === "%o") tokRe = /^[+-]?(?:0[oO])?[0-7]+/; ` +
					`else if (verb === "%b") tokRe = /^[+-]?(?:0[bB])?[01]+/; ` +
					`else if (verb === "%f" || verb === "%F" || verb === "%e" || verb === "%E" || verb === "%g" || verb === "%G") tokRe = /^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?/; ` +
					`else if (verb === "%t") tokRe = /^(?:true|false|1|0|t|f|T|F|TRUE|FALSE)/; ` +
					`else if (verb === "%x" || verb === "%X") tokRe = /^[+-]?(?:0x)?[0-9a-fA-F]+/; ` +
					`else if (verb === "%c") tokRe = /^[\\s\\S]/; ` +
					`const m = s.slice(si).match(tokRe); ` +
					`if (!m) { parseErr = __error("input does not match format"); break; } ` +
					`tokens.push({ t: m[0], verb }); si += m[0].length; continue; ` +
					`} ` +
					`} ` +
					`if (si >= s.length) break; ` +
					`if (s[si] !== f[fi]) { parseErr = __error("input does not match format"); break; } ` +
					`si++; fi++; ` +
					`} ` +
					`${_SSCAN_LOOP} ` +
					`return [n, parseErr || err || (n < ptrs.length ? __error("unexpected EOF") : null)]; ` +
					`})(${strArg}, ${fmtArg}, ${restArgs})`
				);
			}
			default:
				return undefined;
		}
	},

	_genFmtFprint(fn, expr) {
		this.useHelper("sprintf");
		const writerArg = expr.args[0];
		const rest = expr.args.slice(1);
		const restJs = rest.map((e) => this._fmtArgJs(e)).join(", ");
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
		const args = expr.args.map((e) => this._fmtArgJs(e)).join(", ");
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
