// Assignability, binary result types, and interface satisfaction.
// Installed as a mixin on TypeChecker.prototype.

import {
	ANY,
	BOOL,
	CMP_OPS,
	COMPLEX128,
	FLOAT64,
	isAny,
	isComplex,
	isComplexOrNumeric,
	isNil,
	isNumeric,
	isPointer,
	isString,
	isTypedArraySlice,
	isUntyped,
	LOG_OPS,
	SIZED_FLOAT_NAMES,
	SIZED_INT_NAMES,
	STRING,
	typeStr,
	UNTYPED_COMPLEX,
	UNTYPED_FLOAT,
	UNTYPED_INT,
} from "./types.js";

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

// Untyped constant assignability: maps source.base → Set of compatible target.name values
const UNTYPED_COMPAT = {
	int: new Set([
		...SIZED_INT_NAMES,
		...SIZED_FLOAT_NAMES,
		"complex128",
		"complex64",
	]),
	float64: new Set([
		...SIZED_FLOAT_NAMES,
		...SIZED_INT_NAMES,
		"complex128",
		"complex64",
	]),
	string: new Set(["string"]),
	bool: new Set(["bool"]),
	complex128: new Set(["complex128", "complex64"]),
};

/** @type {ThisType<TypeChecker>} */
export const assignabilityMethods = {
	// ── Binary result types ───────────────────────────────────────────

	binaryResultType(op, lt, rt, node) {
		if (lt?.kind === "typeParam" || rt?.kind === "typeParam")
			return this._binaryResultTypeTypeParam(op, lt, rt);
		if (CMP_OPS.has(op)) return this._binaryResultTypeCmp(op, lt, rt, node);
		if (LOG_OPS.has(op)) return BOOL;
		return this._binaryResultTypeNonComplex(op, lt, rt, node);
	},

	_binaryResultTypeTypeParam(op, lt, rt) {
		if (CMP_OPS.has(op) || LOG_OPS.has(op)) return BOOL;
		return lt?.kind === "typeParam" ? lt : rt;
	},

	_binaryResultTypeNonComplex(op, lt, rt, node) {
		if (isAny(lt) || isAny(rt)) return ANY;
		if (isComplex(lt) || isComplex(rt))
			return this._binaryResultTypeComplex(op, lt, rt, node);
		if (isNumeric(lt) && isNumeric(rt))
			return this._binaryResultTypeNumeric(lt, rt);
		if (isString(lt) && isString(rt) && op === "+")
			return this._binaryResultTypeString(lt, rt);
		if (node)
			this.err(`Invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
		return ANY;
	},

	_binaryResultTypeString(lt, rt) {
		if (lt.kind === "untyped" && rt.kind === "untyped") return lt;
		if (lt.kind === "untyped") return rt;
		if (rt.kind === "untyped") return lt;
		return STRING;
	},

	_binaryResultTypeCmp(op, lt, rt, node) {
		if (this._checkComplexCmpOp(op, lt, rt, node)) return ANY;
		this._checkEqualityComparable(op, lt, rt, node);
		return BOOL;
	},

	_binaryResultTypeComplex(op, lt, rt, node) {
		if (!isComplexOrNumeric(lt) || !isComplexOrNumeric(rt)) {
			this.err(`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
			return ANY;
		}
		if (op !== "+" && op !== "-" && op !== "*" && op !== "/") {
			this.err(`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
			return ANY;
		}
		if (lt.kind === "untyped" && rt.kind === "untyped") return UNTYPED_COMPLEX;
		return COMPLEX128;
	},

	_binaryResultTypeNumeric(lt, rt) {
		const lName = lt.kind === "untyped" ? lt.base : lt.name;
		const rName = rt.kind === "untyped" ? rt.base : rt.name;
		const lFloat = lName === "float32" || lName === "float64";
		const rFloat = rName === "float32" || rName === "float64";
		const isFloat = lFloat || rFloat;
		if (lt.kind === "untyped" && rt.kind === "untyped")
			return isFloat ? UNTYPED_FLOAT : UNTYPED_INT;
		if (lt.kind === "untyped")
			return isFloat && rt.name !== "float64" && rt.name !== "float32"
				? FLOAT64
				: rt;
		if (rt.kind === "untyped")
			return isFloat && lt.name !== "float64" && lt.name !== "float32"
				? FLOAT64
				: lt;
		if (lt.name === "float32" && rt.name === "float32") return lt;
		return isFloat ? FLOAT64 : lt;
	},

	_checkComplexCmpOp(op, lt, rt, node) {
		if (isComplex(lt) || isComplex(rt)) {
			if (op !== "==" && op !== "!=") {
				this.err(
					`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`,
					node,
				);
				return true;
			}
		}
		return false;
	},

	_isNonComparableKind(t) {
		const base = t?.kind === "named" ? t.underlying : t;
		return (
			base?.kind === "slice" || base?.kind === "map" || base?.kind === "func"
		);
	},

	_checkEqualityComparable(op, lt, rt, node) {
		if (op !== "==" && op !== "!=") return;
		if (isNil(lt) || isNil(rt)) return;
		for (const t of [lt, rt]) {
			if (this._isNonComparableKind(t))
				this.err(`operator ${op} not defined on ${typeStr(t)}`, node);
		}
	},

	// ── Assignability ─────────────────────────────────────────────────

	assertAssignable(target, source, node) {
		if (!target || !source) return;
		target = this.resolveType(target);
		source = this.resolveType(source);
		this._markIfaceBox(target, source, node);
		if (this._assertAssignableEarlyReturn(target, source)) return;
		if (isPointer(target) && isPointer(source)) {
			this.assertAssignable(
				target.base ?? target.underlying?.base,
				source.base ?? source.underlying?.base,
				node,
			);
			return;
		}
		if (isUntyped(source) && this._isUntypedAssignable(target, source)) return;
		if (this._isNumericCoercible(target, source)) return;
		if (this._checkArrayAssignable(target, source, node)) return;
		if (this._checkTypedArrayAssignable(target, source, node)) return;
		if (this._checkFuncAssignable(target, source, node)) return;
		if (typeStr(target) !== typeStr(source))
			this._assertAssignableTypeMismatch(target, source, node);
	},

	// Tags struct values / struct pointers flowing into an interface so codegen can
	// tell `T` from `*T` at runtime (both compile to the same class instance).
	_markIfaceBox(target, source, node) {
		if (this._skipIfaceMark) return;
		if (!node || typeof node !== "object" || !target || !source) return;
		if (target.kind === "typeParam") return;
		const tBase = this.resolveType(
			target.kind === "named" ? target.underlying : target,
		);
		if (!isAny(target) && tBase?.kind !== "interface") return;
		const structOf = (t) => {
			const r = this.resolveType(t);
			const b = r?.kind === "named" ? this.resolveType(r.underlying) : r;
			return b?.kind === "struct";
		};
		const sBase = this.resolveType(
			source.kind === "named" ? source.underlying : source,
		);
		if (sBase?.kind === "struct") node._ifaceBox = "value";
		else if (sBase?.kind === "pointer" && structOf(sBase.base))
			node._ifaceBox = "ptr";
	},

	_assertAssignableEarlyReturn(target, source) {
		return (
			target?.kind === "typeParam" ||
			source?.kind === "typeParam" ||
			isAny(target) ||
			isAny(source) ||
			isNil(source)
		);
	},

	_assertAssignableTypeMismatch(target, source, node) {
		let tBase = target.kind === "named" ? target.underlying : target;
		tBase = this.resolveType(tBase);
		if (tBase?.kind === "interface") {
			if (tBase.methods.size === 0) return;
			if (!this.implements(source, tBase, node))
				this.err(
					`${typeStr(source)} does not implement ${typeStr(target)}`,
					node,
				);
			return;
		}
		this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
	},

	_isUntypedAssignable(target, source) {
		if (isUntyped(target)) return true;
		// Named types with a basic underlying type (`type Mode string`) accept
		// untyped constants of that kind, as in Go.
		if (target.kind === "named") target = this.resolveType(target.underlying);
		if (target?.kind !== "basic") return false;
		return (
			(UNTYPED_COMPAT[source.base]?.has(target.name) ?? false) ||
			(isComplex(target) &&
				(source.base === "int" || source.base === "float64"))
		);
	},

	_isNumericCoercible(target, source) {
		if (target.kind !== "basic" || source.kind !== "basic") return false;
		const pair = `${target.name}:${source.name}`;
		return (
			pair === "float64:int" ||
			pair === "int:float64" ||
			// rune was historically int in GoFront; keep rune/int interchangeable.
			pair === "int:int32" ||
			pair === "int32:int"
		);
	},

	_checkArrayAssignable(target, source, node) {
		if (target.kind === "array" && source.kind === "array") {
			if (
				target.size != null &&
				source.size != null &&
				target.size !== source.size
			)
				this.err(
					`Cannot assign ${typeStr(source)} to ${typeStr(target)} (different array lengths)`,
					node,
				);
			else this.assertAssignable(target.elem, source.elem, node);
			return true;
		}
		if (
			(target.kind === "array" && source.kind === "slice") ||
			(target.kind === "slice" && source.kind === "array")
		) {
			this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
			return true;
		}
		return false;
	},

	_checkTypedArrayAssignable(target, source, node) {
		const isTa = (t) => t?.underlying?._isTypedArray || t?._isTypedArray;
		const getSlice = (t) =>
			t?.kind === "slice"
				? t
				: t?.underlying?.kind === "slice"
					? t.underlying
					: null;
		const targetTa = isTa(target);
		const sourceTa = isTa(source);
		const targetSlice = getSlice(target);
		const sourceSlice = getSlice(source);

		if ((targetTa && sourceSlice) || (targetSlice && sourceTa)) {
			const taElem = targetTa
				? (target.underlying?._elemType ?? target._elemType)
				: (source.underlying?._elemType ?? source._elemType);
			const slice = targetSlice ?? sourceSlice;
			if (isTypedArraySlice(slice) && typeStr(taElem) === typeStr(slice.elem))
				return true;
			this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
			return true;
		}

		if (targetTa && sourceTa) {
			const tElem = target.underlying?._elemType ?? target._elemType;
			const sElem = source.underlying?._elemType ?? source._elemType;
			if (typeStr(tElem) === typeStr(sElem)) return true;
			this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
			return true;
		}

		return false;
	},

	_checkFuncAssignable(target, source, node) {
		const tFunc = target.kind === "named" ? target.underlying : target;
		const sFunc = source.kind === "named" ? source.underlying : source;
		if (tFunc?.kind === "func" && sFunc?.kind === "func") {
			if (!this._implementsMethod(tFunc, sFunc)) {
				this.err(
					`Cannot assign ${typeStr(source)} to ${typeStr(target)}`,
					node,
				);
			}
			return true;
		}
		return false;
	},

	// ── Interface satisfaction ────────────────────────────────────────

	_sigParamsMatch(reqList, actList) {
		if (reqList.length !== actList.length) return false;
		for (let i = 0; i < reqList.length; i++) {
			if (typeStr(reqList[i]) !== typeStr(actList[i])) return false;
		}
		return true;
	},

	_implementsMethod(required, actual) {
		if (!actual) return false;
		const rp = required.params ?? [],
			ap = actual.params ?? [];
		const rr = required.returns ?? [],
			ar = actual.returns ?? [];
		if (!this._sigParamsMatch(rp, ap)) return false;
		if (!!required.variadic !== !!actual.variadic) return false;
		return this._sigParamsMatch(rr, ar);
	},

	implements(srcType, iface, _node) {
		// *T has the full method set of T (value + pointer receivers).
		if (srcType?.kind === "pointer") srcType = this.resolveType(srcType.base);
		let base = srcType.kind === "named" ? srcType.underlying : srcType;
		base = this.resolveType(base);
		// Interface → interface: the source's method set must cover the target's.
		if (base?.kind === "interface") {
			for (const [name, required] of iface.methods) {
				if (!this._implementsMethod(required, base.methods.get(name)))
					return false;
			}
			return true;
		}
		const methodMap =
			base?.kind === "struct"
				? base.methods
				: srcType.kind === "named"
					? srcType.methods
					: null;
		if (!methodMap) return false;
		for (const [name, required] of iface.methods) {
			if (!this._implementsMethod(required, methodMap.get(name))) return false;
		}
		return true;
	},
};
