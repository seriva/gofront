// CodeGen for Go `fmt` package — installed onto CodeGen.prototype via stdlibGenMethods.

import { wrappedErrorfArgs } from "../../shared/errorf.js";
import {
	fmtDescHasFloat,
	fmtDescIsSeq,
	fmtPeelAny,
	fmtTypeDesc,
	fmtWantsTypes,
	structOwnFields,
} from "../../shared/fmt-types.js";

/** @typedef {import('../index.js').CodeGen} CodeGen */

const FMT_METHODS = ["Error", "String"];
const isExportedName = (n) => /^\p{Lu}/u.test(n);
// Descriptor of a struct value whose class has a pointer-receiver Error/String:
// a value element or field must not be taken for a pointer because an earlier
// &x tagged the same object (see isPointer in __sprintf).
const FMT_STRUCT_VALUE = "{ sv: 1 }";

// Print and Printf write the formatted text without a trailing newline.
function stdoutWrite(strJs) {
	return `((__s) => (typeof process !== "undefined" && process?.stdout?.write ? process.stdout.write(__s) : console.log(__s)))(${strJs})`;
}

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
	//   { s: 1 }         a slice that is an element or field: nil prints `[]`
	//   { k, v, sk }     keys and values of a map; sk: string keys
	//   { np: obj }      a *T whose Error/String has a pointer receiver: obj
	//                    stands in for a nil element (see _fmtNilPtrOperand)
	//   { m: 1, ... }    a map that is not boxed itself (a struct field or an
	//                    element): the object map carries no marker of its own
	//   `bare`: the value is the operand being boxed (a map is then marked by
	//   the boxing itself).
	_fmtDesc(t, seen = new Set(), bare = true) {
		t = this.checker?.resolveType?.(t) ?? t;
		if (!t || seen.has(t)) return null;
		const next = new Set(seen).add(t);
		if (t.kind === "named") return this._fmtNamedDesc(t, next, bare);
		if (t.kind === "slice" || t.kind === "array") {
			const e = this._fmtDesc(t.elem, next, false);
			// A nil slice that is not the operand itself (an element or a
			// struct field) is `null`; `s` tells fmt to print it as `[]`.
			const nil = t.kind === "slice" && !bare ? "s: 1" : null;
			const parts = [nil, e ? `e: ${e}` : null].filter(Boolean);
			return parts.length ? `{ ${parts.join(", ")} }` : null;
		}
		if (t.kind === "struct") return this._fmtAnonStructDesc(t, next);
		if (t.kind === "pointer") {
			if (bare) return null;
			const np = this._fmtNilPtrOperand(t);
			return np ? `{ np: ${np} }` : null;
		}
		if (t.kind !== "map") return null;
		const parts = [
			["k", this._fmtDesc(t.key, next, false)],
			["v", this._fmtDesc(t.value, next, false)],
		].filter(([, d]) => d);
		// String keys are told apart from numeric-looking ones when sorting.
		const ku = this._underlyingOf(t.key);
		if (ku?.kind === "basic" && ku.name === "string") parts.push(["sk", "1"]);
		if (!bare) parts.unshift(["m", "1"]);
		return parts.length
			? `{ ${parts.map(([n, d]) => `${n}: ${d}`).join(", ")} }`
			: null;
	},

	// An anonymous struct has no class to carry field descriptors: { ff } holds
	// them, keyed by field name.
	_fmtAnonStructDesc(st, seen) {
		const fields = [];
		for (const [fname, ftype] of structOwnFields(st)) {
			const desc = this._fmtDesc(ftype, seen, false);
			if (desc) fields.push(`${JSON.stringify(fname)}: ${desc}`);
		}
		return fields.length > 0 ? `{ ff: { ${fields.join(", ")} } }` : null;
	},

	_fmtNamedDesc(t, seen, bare = true) {
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
		return this._fmtDesc(u, seen, bare);
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
		const own = structOwnFields(st);
		// The class also carries a copy of every promoted field (see
		// _promotedPath); fmt lists only the fields the struct declares.
		if (own.length < st.fields.size)
			this.line(
				`Object.defineProperty(${name}.prototype, "__fk", { value: ${JSON.stringify(own.map(([n]) => n))} });`,
			);
		for (const [fname, ftype] of own) {
			const desc = this._fmtDesc(ftype, new Set(), false);
			// Unexported fields get no method dispatch, only the value marker
			// (and the map marker).
			if (
				desc &&
				(isExportedName(fname) ||
					desc === FMT_STRUCT_VALUE ||
					/\bm: 1\b/.test(desc))
			)
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
			// Instantiated generic methods are copies without _ptrRecv.
			const generic = base.typeArgs
				? this.checker?.types.get(base.name)?._generic
				: null;
			const ptrRecv = m?._ptrRecv ?? generic?.methods?.get(mn)?._ptrRecv;
			if (!m || !ptrRecv || m.params?.length > 0) continue;
			const cls = this._dequalify(base.name).replace(/\[.*$/, "");
			if (cls.includes(".")) return null;
			return `{ ${mn}() { try { return ${cls}.prototype.${mn}.call(null); } catch (e) { return "<nil>"; } }, __p: true, __nilp: true }`;
		}
		return null;
	},

	// `typed`: the format string needs operand types (`%T`, `%#v`, EXTRA, see
	// fmtWantsTypes), so the operand travels with its static type as
	// `__ft(value, descriptor)`; operands of interface type carry their dynamic
	// type and stay bare.
	_fmtArgJs(e, typed = false) {
		e = fmtPeelAny(e);
		// `xs...` passes each element as its own operand.
		if (e?._spread) return `...(${this.genExpr(e)} ?? [])`;
		// A multi-value call (`f()` returning a tuple) passes every result.
		if (e?._type?.kind === "tuple") return this._fmtTupleJs(e);
		const nilOperand = this._fmtNilPtrOperand(e?._type);
		if (nilOperand) return `(${this.genExpr(e)} ?? ${nilOperand})`;
		const js = this.genExpr(e);
		// An operand of a type parameter type: the type argument knows how fmt
		// should see it (a Stringer named type is boxed, a slice gets its elements).
		const tpf =
			e?._type?.kind === "typeParam"
				? this._typeParamZeroFactory(e._type.name)
				: null;
		if (tpf) {
			const boxed = `(${tpf}.fb ?? ${tpf}.b ?? ((__v) => __v))(${js})`;
			if (!typed) return boxed;
			this.useHelper("sprintf");
			return `__ft(${boxed}, ${tpf}.td ?? null)`;
		}
		const base =
			e?._type?.kind === "named" ? (e._type.underlying ?? e._type) : e?._type;
		const desc = fmtTypeDesc(
			e?._type,
			(t) => this.checker?.resolveType?.(t) ?? t,
		);
		if ((typed || fmtDescHasFloat(desc)) && desc && desc.k !== "i") {
			this.useHelper("sprintf");
			return `__ft(${js}, ${JSON.stringify(desc)})`;
		}
		return this._fmtNilValue(base, js, false);
	},

	// A nil slice or map operand prints as `[]` / `map[]`: coalesce the null
	// to an empty value.  Shared by the single-operand and the tuple path.
	// `unboxed`: the map still needs its marker (the caller boxes the result).
	_fmtNilValue(base, js, unboxed = true) {
		if (base?.kind === "slice") return `(${js} ?? [])`;
		if (unboxed && base?.kind === "map") return `(${js} ?? {})`;
		return js;
	},

	// `js` (a value of static type `t`) boxed as converting it to an `any` does,
	// with the same boxing the single-operand path gets from the checker
	// (_markIfaceBox): named types with methods, pointers, slices, maps, structs
	// and the fmt descriptor of Stringer elements.
	_fmtBoxValue(js, t) {
		const resolve = (x) => this.checker?.resolveType?.(x) ?? x;
		let base = resolve(t);
		if (base?.kind === "named") base = resolve(base.underlying);
		const meta = this.checker?._ifaceBoxMeta?.(t);
		if (meta?.type)
			return this._genNamedIfaceBox(js, meta.type, meta.box === "named_ptr");
		let out = this._fmtNilValue(base, js);
		if (meta) out = this._ifaceBoxWrap(out, meta.box, meta.ptrFields);
		const desc = this._fmtDesc(t);
		return desc ? this._fmtDescWrap(out, desc) : out;
	},

	// The results of a multi-value call as separate operands.  Each result is
	// boxed as if it were assigned to an `any`, so pointers print as `&{...}`
	// and floats keep their width.
	_fmtTupleJs(e) {
		return `...((__t) => [${this._fmtTupleParts(e, 0).join(", ")}])(${this.genExpr(e)})`;
	},

	// The results of tuple call `e` from index `from`, each boxed for fmt.
	_fmtTupleParts(e, from) {
		const resolve = (t) => this.checker?.resolveType?.(t) ?? t;
		return e._type.types.slice(from).map((t, j) => {
			const i = j + from;
			const nilOperand = this._fmtNilPtrOperand(t);
			const value = this._fmtBoxValue(`__t[${i}]`, t);
			const boxed = nilOperand
				? `(__t[${i}] == null ? ${nilOperand} : ${value})`
				: value;
			const desc = fmtTypeDesc(t, resolve);
			if (fmtDescHasFloat(desc) && desc.k !== "i") {
				this.useHelper("sprintf");
				return `__ft(${boxed}, ${JSON.stringify(desc)})`;
			}
			return boxed;
		});
	},

	// The operands of a Printf-style call whose format is args[fmtIdx].
	_fmtFormatArgsJs(args, fmtIdx) {
		// `Printf(f())`: the call supplies the format and every operand.
		if (args.length === fmtIdx + 1 && args[fmtIdx]?._type?.kind === "tuple") {
			const call = args[fmtIdx];
			const rest = this._fmtTupleParts(call, 1);
			return [
				...args.slice(0, fmtIdx).map((e) => this.genExpr(e)),
				`...((__t) => [__t[0], ${rest.join(", ")}])(${this.genExpr(call)})`,
			];
		}
		args = args.map((e, i) => (i > fmtIdx ? fmtPeelAny(e) : e));
		const lit = args[fmtIdx];
		const spread = args.some((e) => e?._spread);
		const resolve = (t) => this.checker?.resolveType?.(t) ?? t;
		const seqArgs = args
			.slice(fmtIdx + 1)
			.some((e) => fmtDescIsSeq(fmtTypeDesc(e?._type, resolve)));
		const typed =
			lit?.kind === "BasicLit" &&
			fmtWantsTypes(lit.value, spread ? -1 : args.length - fmtIdx - 1, seqArgs);
		if (typed) this.useHelper("sprintf");
		return args.map((e, idx) =>
			idx < fmtIdx
				? this.genExpr(e)
				: idx === fmtIdx
					? this.genExpr(e)
					: this._fmtArgJs(e, typed),
		);
	},

	_genFmt(fn, _a, expr) {
		const fmtArgs = ["Sprintf", "Printf", "Errorf"].includes(fn)
			? this._fmtFormatArgsJs(expr.args, 0).join(", ")
			: "";
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
				const restJs = (
					fn === "Appendf"
						? this._fmtFormatArgsJs(rest, 0)
						: rest.map((e) => this._fmtArgJs(e))
				).join(", ");
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
				const wrapped = wrappedErrorfArgs(fmtStr, expr.args);
				if (wrapped.length === 1) {
					return `__error(__sprintf(${fmtArgs}), ${this.genExpr(wrapped[0])})`;
				}
				if (wrapped.length > 1) {
					const causes = wrapped.map((e) => this.genExpr(e)).join(", ");
					return `__error(__sprintf(${fmtArgs}), [${causes}].filter((e) => e != null))`;
				}
				return `__error(__sprintf(${fmtArgs}))`;
			}
			case "Printf":
				this.useHelper("sprintf");
				return stdoutWrite(`__sprintf(${fmtArgs})`);
			case "Print":
				this.useHelper("sprintf");
				this.useHelper("sprint");
				return stdoutWrite(
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
			default:
				return undefined;
		}
	},

	_genFmtFprint(fn, expr) {
		this.useHelper("sprintf");
		if (expr.args.length === 1 && expr.args[0]._type?.kind === "tuple")
			return this._genFmtFprintTuple(fn, expr.args[0]);
		const writerArg = expr.args[0];
		const rest = expr.args.slice(1);
		const restJs = (
			fn === "Fprintf"
				? this._fmtFormatArgsJs(rest, 0)
				: rest.map((e) => this._fmtArgJs(e))
		).join(", ");
		const sprintfCall = this._buildFprintSprintfCall(fn, rest.length, restJs);
		// Any other io.Writer: Fprint* calls Write with the UTF-8 bytes.
		const w = this.genExpr(writerArg);
		return `((__w, __s) => __w.Write(new TextEncoder().encode(__s)))(${w}, ${sprintfCall})`;
	},

	// `Fprint(f())`: the call supplies the writer and the operands.
	_genFmtFprintTuple(fn, call) {
		const parts = this._fmtTupleParts(call, 1);
		const sprintfCall = this._buildFprintSprintfCall(
			fn,
			parts.length,
			parts.join(", "),
		);
		return `((__t) => ((__w, __s) => __w.Write(new TextEncoder().encode(__s)))(__t[0], ${sprintfCall}))(${this.genExpr(call)})`;
	},

	// Formats Print/Println operands with %v so the first operand is never
	// mistaken for a format string.
	_genPrintOperands(expr, sep, suffix) {
		const argc = expr.args.length;
		if (argc === 0) return JSON.stringify(suffix);
		if (expr.args.some((e) => e._spread || e._type?.kind === "tuple")) {
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
		if (fn === "Fprint") {
			this.useHelper("sprint");
			return `__sprint(false, ${restJs})`;
		}
		const sep = fn === "Fprintln" ? " " : "";
		const suffix = fn === "Fprintln" ? "\\n" : "";
		const fmt = Array(argc).fill("%v").join(sep) + suffix;
		return `__sprintf("${fmt}", ${restJs})`;
	},
};
