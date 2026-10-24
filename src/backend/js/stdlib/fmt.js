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

const FMT_METHODS = ["Error", "String"];
const isExportedName = (n) => /^\p{Lu}/u.test(n);
// Descriptor of a struct value whose class has a pointer-receiver Error/String:
// a value element or field must not be taken for a pointer because an earlier
// &x tagged the same object (see isPointer in __sprintf).
const FMT_STRUCT_VALUE = "{ sv: 1 }";

/** @type {ThisType<CodeGen>} */
export const fmtMethods = {
	// ── Stringer/error dispatch metadata (read by __sprintf) ─────────────
	//
	// Named non-struct values are raw numbers/strings/arrays inside slices,
	// maps and struct fields, and a struct and a pointer to it share one class.
	// The type is therefore carried two ways, both only where a method can be
	// called: a descriptor of the container's element types, attached when a
	// slice/array/map is converted to an interface (static type passing, see
	// __ifd), and per-class metadata for struct fields (__ff) and for
	// pointer-receiver Error/String methods (__pr).

	// JS source of the fmt descriptor for static type `t`, or null when no
	// value of the type needs one:
	//   { b: Class, n }  a raw value of a named type with a value-receiver
	//                    Error/String; Class boxes it, n: numeric (map keys)
	//   { sv: 1 }        a struct value with a pointer-receiver Error/String
	//   { e }            elements of a slice or array
	//   { k, v }         keys and values of a map
	_fmtDesc(t, seen = new Set()) {
		t = this.checker?.resolveType?.(t) ?? t;
		if (!t || seen.has(t)) return null;
		const next = new Set(seen).add(t);
		if (t.kind === "named") return this._fmtNamedDesc(t, next);
		if (t.kind === "slice" || t.kind === "array") {
			const e = this._fmtDesc(t.elem, next);
			return e ? `{ e: ${e} }` : null;
		}
		if (t.kind !== "map") return null;
		const parts = [
			["k", this._fmtDesc(t.key, next)],
			["v", this._fmtDesc(t.value, next)],
		].filter(([, d]) => d);
		return parts.length
			? `{ ${parts.map(([n, d]) => `${n}: ${d}`).join(", ")} }`
			: null;
	},

	_fmtNamedDesc(t, seen) {
		const u = this.checker?.resolveType?.(t.underlying) ?? t.underlying;
		const info = this._namedBoxInfo(t);
		if (
			info &&
			FMT_METHODS.some((m) => info.methods.get(m)?._ptrRecv === false)
		) {
			const numeric = u?.kind === "basic" && /^(u?int|float)/.test(u.name);
			return `{ b: ${info.cls}, n: ${numeric ? 1 : 0} }`;
		}
		if (u?.kind === "struct" && this._fmtHasPtrMethod(u))
			return FMT_STRUCT_VALUE;
		if (!u || u.kind === "struct" || u.kind === "interface") return null;
		return this._fmtDesc(u, seen);
	},

	// Whether struct `st` has a pointer-receiver Error/String, declared or
	// promoted from an embedded struct.
	_fmtHasPtrMethod(st, seen = new Set()) {
		if (seen.has(st)) return false;
		seen.add(st);
		if (FMT_METHODS.some((m) => st.methods?.get(m)?._ptrRecv)) return true;
		return (st._embeds ?? []).some((raw) => {
			const inner = (raw.kind === "pointer" ? raw.base : raw).underlying;
			return inner?.kind === "struct" && this._fmtHasPtrMethod(inner, seen);
		});
	},

	// Error/String promoted from embedded interface fields, as { method: field }.
	_fmtPromoted(st, methodDecls) {
		const out = {};
		for (const f of st._structFields ?? []) {
			if (!f.embedded) continue;
			const t = this.checker?.resolveType?.(f.type) ?? f.type;
			const it = t?.kind === "named" ? t.underlying : t;
			const key = (f.astType?.name ?? t?.name ?? "").split(".").pop();
			if (it?.kind !== "interface" || !key) continue;
			for (const mn of FMT_METHODS) {
				const m = it.methods?.get(mn);
				if (!m || m.params?.length > 0 || out[mn]) continue;
				if (methodDecls.some((d) => d.name === mn)) continue;
				out[mn] = key;
			}
		}
		return out;
	},

	// Per-class fmt metadata of a struct: which of Error/String have a pointer
	// receiver, and the descriptors of the exported fields that hold raw
	// Stringer values.
	_genFmtClassMeta(name, methodDecls) {
		const st = this.checker?.types.get(name)?.underlying;
		if (st?.kind !== "struct") return;
		const ptrRecv = FMT_METHODS.filter((mn) =>
			this._fmtPtrRecv(st, methodDecls, mn),
		);
		if (ptrRecv.length > 0)
			this.line(
				`Object.defineProperty(${name}.prototype, "__pr", { value: ${JSON.stringify(ptrRecv)} });`,
			);
		const promoted = this._fmtPromoted(st, methodDecls);
		if (Object.keys(promoted).length > 0)
			this.line(
				`Object.defineProperty(${name}.prototype, "__pe", { value: ${JSON.stringify(promoted)} });`,
			);
		const fields = [];
		for (const [fname, ftype] of st.fields.entries()) {
			const desc = this._fmtDesc(ftype);
			// Unexported fields get no method dispatch, only the value marker.
			if (desc && (isExportedName(fname) || desc === FMT_STRUCT_VALUE))
				fields.push(`${fname}: ${desc}`);
		}
		// A thunk: the descriptors name classes declared further down.
		if (fields.length > 0)
			this.line(
				`Object.defineProperty(${name}.prototype, "__ff", { value: () => ({ ${fields.join(", ")} }) });`,
			);
	},

	// Whether method `mn` of struct `st` has a pointer receiver: declared on it,
	// or promoted from an embedded struct (an embedded pointer promotes every
	// method to the value's method set).
	_fmtPtrRecv(st, methodDecls, mn) {
		const decl = methodDecls.find((d) => d.name === mn);
		if (decl) return Boolean(decl.recvPointer);
		for (const raw of st._embeds ?? []) {
			const isPtr = raw.kind === "pointer";
			const m = (isPtr ? raw.base : raw).underlying?.methods?.get(mn);
			if (m) return !isPtr && Boolean(m._ptrRecv);
		}
		return false;
	},

	// A nil `*T` whose Error/String has a pointer receiver still calls the method
	// (Go does; a panic in it, usually a nil dereference, prints <nil>).  The JS
	// source of a stand-in for the nil pointer, or null when `t` is not such a
	// pointer.  Only operands whose static type is the pointer are covered.
	_fmtNilPtrOperand(t) {
		t = this.checker?.resolveType?.(t) ?? t;
		if (t?.kind !== "pointer") return null;
		const base = this.checker?.resolveType?.(t.base) ?? t.base;
		const st =
			this.checker?.resolveType?.(base?.underlying) ?? base?.underlying;
		if (base?.kind !== "named" || st?.kind !== "struct" || !base.name)
			return null;
		for (const mn of FMT_METHODS) {
			const m = st.methods?.get(mn) ?? base.methods?.get(mn);
			if (!m?._ptrRecv || m.params?.length > 0) continue;
			const cls = this._dequalify(base.name);
			if (/[[.]/.test(cls)) return null;
			return `{ ${mn}() { try { return ${cls}.prototype.${mn}.call(null); } catch (e) { return "<nil>"; } }, __p: true, __nilp: true }`;
		}
		return null;
	},

	_fmtArgJs(e) {
		// `xs...` passes each element as its own operand.
		if (e?._spread) return `...(${this.genExpr(e)} ?? [])`;
		const nilOperand = this._fmtNilPtrOperand(e?._type);
		if (nilOperand) return `(${this.genExpr(e)} ?? ${nilOperand})`;
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
				// Like append: write in place only when the whole result fits in
				// dst's spare capacity, otherwise copy into one fresh array and
				// leave dst's backing array untouched (never chunk the write).
				this.useHelper("append");
				return `((d, s) => { const e = new TextEncoder().encode(s); if (d == null && e.length === 0) return null; const r = d ?? new Uint8Array(0); const n = r.length + e.length; const c = __tcap.get(r); if (c !== undefined && n <= c) { const v = new Uint8Array(r.buffer, r.byteOffset, n); v.set(e, r.length); if (c > n) __tcap.set(v, c); return v; } const v = new Uint8Array(n); v.set(r); v.set(e, r.length); return v; })(${this.genExpr(dst)}, ${str})`;
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
		if (expr.args.some((e) => e._spread)) {
			// The operand count is only known at run time: join with Sprint's rules.
			this.useHelper("sprint");
			const joined = `__sprint(${sep === " "}, ${expr.args.map((e) => this._fmtArgJs(e)).join(", ")})`;
			return sep === " " ? `${joined}.slice(0, -1)` : joined;
		}
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
