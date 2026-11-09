// CodeGen for Go `fmt` package — installed onto CodeGen.prototype via stdlibGenMethods.

import { structOwnFields } from "../../shared/fmt-types.js";

/** @typedef {import('../index.js').CodeGen} CodeGen */

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
};
