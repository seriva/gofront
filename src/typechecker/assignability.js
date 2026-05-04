// Assignability, binary result types, and interface satisfaction.
// Installed as a mixin on TypeChecker.prototype.

import {
	ANY,
	BOOL,
	CMP_OPS,
	COMPLEX128,
	FLOAT64,
	INT,
	isAny,
	isComplex,
	isComplexOrNumeric,
	isNil,
	isNumeric,
	isPointer,
	isString,
	isUntyped,
	LOG_OPS,
	STRING,
	typeStr,
	UNTYPED_COMPLEX,
	UNTYPED_FLOAT,
	UNTYPED_INT,
} from "./types.js";

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

// Untyped constant assignability: maps source.base → Set of compatible target.name values
const UNTYPED_COMPAT = {
	int: new Set(["int", "float64", "complex128", "complex64"]),
	float64: new Set(["float64", "int", "complex128", "complex64"]),
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
		const lFloat = (lt.kind === "untyped" ? lt.base : lt.name) === "float64";
		const rFloat = (rt.kind === "untyped" ? rt.base : rt.name) === "float64";
		const isFloat = lFloat || rFloat;
		if (lt.kind === "untyped" && rt.kind === "untyped")
			return isFloat ? UNTYPED_FLOAT : UNTYPED_INT;
		if (lt.kind === "untyped")
			return isFloat && rt.name !== "float64" ? FLOAT64 : rt;
		if (rt.kind === "untyped")
			return isFloat && lt.name !== "float64" ? FLOAT64 : lt;
		return isFloat ? FLOAT64 : INT;
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
		if (typeStr(target) !== typeStr(source))
			this._assertAssignableTypeMismatch(target, source, node);
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
		if (target.kind !== "basic") return false;
		return (
			(UNTYPED_COMPAT[source.base]?.has(target.name) ?? false) ||
			(isComplex(target) &&
				(source.base === "int" || source.base === "float64"))
		);
	},

	_isNumericCoercible(target, source) {
		if (target.kind !== "basic" || source.kind !== "basic") return false;
		return (
			(target.name === "float64" && source.name === "int") ||
			(target.name === "int" && source.name === "float64")
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
		let base = srcType.kind === "named" ? srcType.underlying : srcType;
		base = this.resolveType(base);
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
