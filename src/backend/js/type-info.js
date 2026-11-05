// src/backend/js/type-info.js
// Run-time type information for erased generics.  A generic function (or the
// instance of a generic type) receives one zero-value factory per type
// parameter; when its body needs to know the instantiated type (type
// assertions to a type parameter, conversions to it, `==` on it, building an
// instance of another generic type from it) the factory also carries the
// type's kind, identity and a type test (see `__ti` in HELPER_GENERICS).

import { forEachChild } from "../../lower/index.js";
import {
	isAny,
	isTypedArraySlice,
	typedArrayConstructorForElem,
	typeStr,
} from "../../typechecker/types.js";
import { fmtTypeDesc } from "../shared/fmt-types.js";
import { mentionsTypeParam } from "./expressions.js";

// True when type node `node` names one of the type parameters `names`.
function typeNodeMentions(node, names) {
	if (Array.isArray(node)) return node.some((n) => typeNodeMentions(n, names));
	if (!node || typeof node !== "object") return false;
	if (
		(node.kind === "TypeName" || node.kind === "Ident") &&
		names.has(node.name)
	)
		return true;
	let found = false;
	forEachChild(node, (c) => {
		if (!found && typeNodeMentions(c, names)) found = true;
	});
	return found;
}

function typeArgsMention(node) {
	const args = node._typeArgs ?? node._type?.typeArgs;
	return Array.isArray(args) && args.some((t) => mentionsTypeParam(t));
}

export const typeInfoGenMethods = {
	// Whether the body of generic `decl` (a function or method declaration)
	// needs the instantiated types of `names`.
	_declNeedsTypeInfo(decl, names) {
		this._typeInfoMemo ??= new Map();
		this._typeInfoActive ??= new Set();
		if (this._typeInfoMemo.has(decl)) return this._typeInfoMemo.get(decl);
		if (this._typeInfoActive.has(decl)) {
			this._typeInfoCycle = true; // answer depends on an unfinished scan
			return false;
		}
		const outer = this._typeInfoCycle;
		this._typeInfoCycle = false;
		this._typeInfoActive.add(decl);
		const result = this._scanTypeInfoUse(decl.body, new Set(names));
		this._typeInfoActive.delete(decl);
		// A false that leaned on an in-progress scan is provisional: only cache
		// it once no scan is in progress, otherwise a mutually recursive
		// function would keep a stale answer.
		if (result || !this._typeInfoCycle || this._typeInfoActive.size === 0)
			this._typeInfoMemo.set(decl, result);
		this._typeInfoCycle = outer || this._typeInfoCycle;
		return result;
	},

	_scanTypeInfoUse(node, names) {
		if (Array.isArray(node))
			return node.some((n) => this._scanTypeInfoUse(n, names));
		if (!node || typeof node !== "object") return false;
		if (this._nodeUsesTypeInfo(node, names)) return true;
		let found = false;
		forEachChild(node, (c) => {
			if (!found && this._scanTypeInfoUse(c, names)) found = true;
		});
		return found;
	},

	// `x.M(...)` where x has a type parameter type: a raw value of a named
	// non-struct type argument must be boxed to reach its methods.
	_isTypeParamMethodCall(call, names) {
		const t = call.func?.expr?._type;
		return (
			call.func?.kind === "SelectorExpr" &&
			!call.func._isMethodExpr &&
			t?.kind === "typeParam" &&
			(!names || names.has(t.name))
		);
	},

	_nodeUsesTypeInfo(node, names) {
		if (node._ifaceKeyDyn && names.has(node._ifaceKeyParam)) return true;
		switch (node.kind) {
			case "TypeAssertExpr":
				return typeNodeMentions(node.type, names);
			case "TypeSwitchStmt":
				return node.cases.some((c) => typeNodeMentions(c.types, names));
			case "TypeConversion":
				return typeNodeMentions(node.targetType, names);
			case "BinaryExpr":
				return (
					((node.op === "==" || node.op === "!=") &&
						node.left._type?.kind === "typeParam") ||
					(node._type?.kind === "typeParam" && names.has(node._type.name))
				);
			case "AssignStmt":
				return (
					node.op !== "=" &&
					node.lhs?.[0]?._type?.kind === "typeParam" &&
					names.has(node.lhs[0]._type.name)
				);
			case "IncDecStmt":
				return (
					node.expr?._type?.kind === "typeParam" &&
					names.has(node.expr._type.name)
				);
			case "CallExpr":
				return this._callUsesTypeInfo(node, names);
			case "CompositeLit":
			case "GenericTypeName":
				return typeArgsMention(node);
			default:
				return false;
		}
	},

	_callUsesTypeInfo(call, names) {
		if (this._isTypeParamMethodCall(call, names)) return true;
		if (call._isTypeConversion)
			return call._conversionTargetType?.kind === "typeParam";
		// A fmt operand of a type parameter type is formatted by its instantiated
		// type (a Stringer type argument), see _fmtArgJs.
		if (
			call.func?.kind === "SelectorExpr" &&
			call.func.expr?.name === "fmt" &&
			call.args.some((a) => a?._type?.kind === "typeParam")
		)
			return true;
		const site = call._genericFnType ? call : call.func;
		if (!site?._genericFnType) return false;
		if (!site._typeArgs?.some((t) => mentionsTypeParam(t))) return false;
		return this._genericFnNeedsTypeInfo(site._genericFnType);
	},

	// Whether callers of generic function `generic` pass type information.
	_genericFnNeedsTypeInfo(generic) {
		const decl = generic?.declNode;
		if (!decl) return false;
		return this._declNeedsTypeInfo(
			decl,
			(decl.typeParams ?? []).map((tp) => tp.name),
		);
	},

	// Whether instances of generic type `named` carry type information: any
	// of its methods needs it.
	_genericTypeNeedsTypeInfo(named) {
		const generic = named?._generic;
		if (!generic?.methods) return false;
		const names = generic.typeParams.map((tp) => tp.name);
		for (const m of generic.methods.values())
			if (m?._decl && this._declNeedsTypeInfo(m._decl, names)) return true;
		return false;
	},

	// The factory a generic callee receives for type argument `t`, carrying
	// the type's kind, identity and type test.
	_typeInfoFactory(t) {
		if (t?.kind === "typeParam") {
			const bound = this._typeParamZeroFactory(t.name);
			if (bound) return bound;
		}
		this.useHelper("generics");
		const base = this.zeroFactoryFor(t);
		const u = this._underlyingOf(t);
		let k = "";
		if (isAny(u) || u?.kind === "interface") k = "iface";
		else if (u?.kind === "basic") k = u.name;
		const check = this._typeCheckForType(t, "__v");
		const is = check ? `(__v) => ${check}` : "null";
		const unbox = this._boxesInInterface(t) ? "true" : "false";
		const box = this._ifaceKeyBox(t);
		const fmtBox = this._fmtBoxFor(t);
		// The static type for fmt (`%T` of a type parameter operand).
		const td = mentionsTypeParam(t)
			? null
			: fmtTypeDesc(t, (x) => this.checker?.resolveType?.(x) ?? x);
		const tdJs = td && td.k !== "i" ? JSON.stringify(td) : null;
		const tail = tdJs
			? `, ${box ?? "null"}, ${fmtBox ?? "null"}, ${tdJs}`
			: fmtBox
				? `, ${box ?? "null"}, ${fmtBox}`
				: box
					? `, ${box}`
					: "";
		return `__ti(${base}, ${JSON.stringify(k)}, ${JSON.stringify(typeStr(t))}, ${is}, ${unbox}${tail})`;
	},

	// How `__ik` tells the dynamic type of an interface map key apart where
	// the JS value cannot: the numeric type name for types sharing a JS
	// representation with `int`/`float64`/`int64`, `*` for pointers (keyed by
	// identity) and `!type` for types Go cannot hash.
	_ifaceKeyTag(t) {
		if (!t || t.kind === "named" || mentionsTypeParam(t)) return null;
		if (t.kind === "pointer") return "*";
		if (t.kind === "slice" || t.kind === "map" || t.kind === "func")
			return `!${this._dynTypeName(t)}`;
		if (t.kind !== "basic") return null;
		const name = this._dynTypeName(t);
		if (["int", "float64", "int64", "string", "bool"].includes(name))
			return null;
		return /^(u?int\d*|uintptr|float32)$/.test(name) ? name : null;
	},

	// A function boxing a plain value of named basic type `t`, as converting
	// it to an interface does; null when `t` is not boxed.
	_ifaceKeyBox(t) {
		if (!this._boxesInInterface(t) || t?.kind !== "named") return null;
		return `(__v) => ${this._genNamedIfaceBox("__v", t, false)}`;
	},

	// A function giving a plain value of type `t` the type information fmt
	// needs once it is an `any` operand (see _fmtDesc); null when it needs none.
	_fmtBoxFor(t) {
		if (!t || t.kind === "typeParam" || mentionsTypeParam(t)) return null;
		if (this._ifaceKeyBox(t)) return null; // boxed by the key box already
		const u = this._underlyingOf(t);
		if (t.kind === "pointer" && this._underlyingOf(t.base)?.kind === "struct") {
			this.useHelper("ifaceBox");
			return "(__v) => __ifp(__v)";
		}
		const desc = this._fmtDesc(t);
		if (desc) this.useHelper("ifd");
		const tagged = (v) => (desc ? `__ifd(${v}, ${desc})` : v);
		if (u?.kind === "map") {
			this.useHelper("ifaceBox");
			return `(__v) => __ifm(${tagged("__v")})`;
		}
		if (u?.kind === "slice") return `(__v) => ${tagged("(__v ?? [])")}`;
		return desc ? `(__v) => ${tagged("__v")}` : null;
	},

	// The run-time type tag of an unnamed slice, map or non-struct pointer
	// entering an interface, or null when the value needs none.  The tag lets
	// assertions and type switches tell `[]int32` from `[]uint8`, `*int` from
	// `*string`, and a nil `*int` from the nil interface.
	_dynTypeTag(t) {
		if (!t || mentionsTypeParam(t)) return null;
		if (
			t.kind === "slice" ||
			t.kind === "map" ||
			t.kind === "array" ||
			t.kind === "struct" ||
			t.kind === "func"
		)
			return this._dynTypeName(t);
		if (this._isNamedComposite(t)) return t.name;
		if (t.kind === "pointer") {
			const base = t.base;
			if (base?.kind === "struct" && !base.name) return this._dynTypeName(t);
			if (this._underlyingOf(base)?.kind === "struct") return null;
			if (this._boxesInInterface(t)) return null;
			return this._dynTypeName(t);
		}
		return null;
	},

	// A named slice, array or map type: its values are plain JS arrays and
	// objects, told apart in an interface by a tag carrying the type's name.
	_isNamedComposite(t) {
		if (t?.kind !== "named" || this._namedBoxInfo(t)) return false;
		const kind = this._underlyingOf(t)?.kind;
		return kind === "slice" || kind === "array" || kind === "map";
	},

	// `typeStr` with the spellings of identical types unified.
	_dynTypeName(t) {
		return this._dynTypeStr(t)
			.replace(/\bbyte\b/g, "uint8")
			.replace(/\brune\b/g, "int32")
			.replace(/\bany\b/g, "interface {}")
			.replace(/interface\{\.\.\.\}/g, "interface {}");
	},

	// `typeStr`, but an unnamed struct lists its fields, so two anonymous
	// structs do not share a tag.
	_dynTypeStr(t) {
		const s = (x) => this._dynTypeStr(x);
		switch (t?.kind) {
			case "slice":
				return `[]${s(t.elem)}`;
			case "array":
				return `[${t.size?.value ?? t.size ?? "..."}]${s(t.elem)}`;
			case "map":
				return `map[${s(t.key)}]${s(t.value)}`;
			case "pointer":
				return `*${s(t.base)}`;
			case "struct":
				if (t.name || !t._structFields) return typeStr(t);
				return `struct{${t._structFields
					.map(
						(f) =>
							`${(f.names ?? []).join(",")} ${s(f.type)}${f.tag ? ` ${JSON.stringify(f.tag)}` : ""}${f.embedded ? " embedded" : ""}`,
					)
					.join("; ")}}`;
			default:
				return typeStr(t);
		}
	},

	// Run-time test that `val` holds a value of the unnamed composite type
	// (or named func type) of assertion target `typeNode`; null when the
	// checker recorded no type for it.
	_dynTypeCheck(typeNode, val) {
		const t = typeNode?._assertType;
		if (!t) return null;
		const u = this._underlyingOf(t);
		const shape = mentionsTypeParam(t);
		const tag = JSON.stringify(shape ? "" : this._dynTypeName(t));
		this.useHelper("ifaceBox");
		const args = (kind, ctor = "null", n = "0") =>
			`__isty(${val}, ${tag}, "${kind}", ${ctor}, ${n})`;
		if (u?.kind === "func") return args("func");
		if (t.kind === "named") return null;
		if (u?.kind === "map") return args("map");
		if (u?.kind === "struct") return args("struct");
		if (u?.kind === "array")
			return args("array", "null", String(u.size?.value ?? u.size ?? 0));
		if (u?.kind === "slice") {
			const ctor = isTypedArraySlice(u)
				? typedArrayConstructorForElem(u.elem)
				: null;
			return args("slice", ctor ?? "null");
		}
		if (u?.kind === "pointer") {
			if (u.base?.kind === "struct" && !u.base.name) return args("struct");
			if (this._underlyingOf(u.base)?.kind === "struct") return null;
			if (this._boxesInInterface(u)) return null;
			return args("ptr");
		}
		return null;
	},

	_underlyingOf(t) {
		let u = t;
		for (let i = 0; i < 8 && u?.kind === "named"; i++) u = u.underlying;
		return u;
	},

	// A named non-struct value (or pointer to one) is boxed in an interface.
	_boxesInInterface(t) {
		const base = t?.kind === "pointer" ? t.base : t;
		return Boolean(this._namedBoxInfo(base));
	},

	// JS test that `val` holds a value of type `t`, or null when it cannot be
	// told at run time.
	_typeCheckForType(t, val) {
		switch (t?.kind) {
			case "basic":
				return this._typeNameCheckExpr(t.name, val);
			case "named":
				return this._namedTypeCheck(t, val);
			case "pointer":
				return this._pointerTypeCheck(t.base, val);
			case "interface":
				return t.methods?.size
					? this._ifaceMethodCheck(
							val,
							[...t.methods.keys()],
							this._unwrapIsMulti(t.methods.get("Unwrap")),
						)
					: null;
			case "typeParam": {
				const f = this._typeParamZeroFactory(t.name);
				return f ? `(${f}?.is?.(${val}) ?? true)` : null;
			}
			default:
				return null;
		}
	},

	_namedTypeCheck(t, val) {
		if (t.typeArgs?.length) {
			const generic = this._genericInstanceCheck(
				{ kind: "GenericTypeName", name: t.name, _typeArgs: t.typeArgs },
				val,
			);
			if (generic) return generic;
		}
		const u = this._underlyingOf(t);
		if (u?.kind === "interface" && t.name !== "error")
			return this._ifaceMethodCheck(
				val,
				[...(u.methods?.keys() ?? [])],
				this._unwrapIsMulti(u.methods?.get("Unwrap")),
			);
		return this._typeNameCheckExpr(t.name, val);
	},

	_pointerTypeCheck(base, val) {
		if (base?.kind !== "named") return null;
		const node = base.typeArgs?.length
			? { kind: "GenericTypeName", name: base.name, _typeArgs: base.typeArgs }
			: { kind: "TypeName", name: base.name };
		const check = this._typeCheckExpr({ kind: "PointerType", base: node }, val);
		return check === "true" ? null : check;
	},

	// Runtime instance id of a generic type's instantiation `typeArgs` that
	// mention type parameters: the callee's type arguments joined as
	// `instanceId` prints them; null when it cannot be built.
	_runtimeInstanceId(typeArgs) {
		if (!typeArgs?.length) return null;
		const parts = [];
		for (const t of typeArgs) {
			if (!mentionsTypeParam(t)) {
				parts.push(JSON.stringify(typeStr(t)));
				continue;
			}
			const f =
				t.kind === "typeParam" ? this._typeParamZeroFactory(t.name) : null;
			if (!f) return null;
			parts.push(`${f}?.id`);
		}
		this.useHelper("generics");
		return `__tid(${parts.join(", ")})`;
	},
};
