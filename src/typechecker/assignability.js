// Assignability, binary result types, and interface satisfaction.
// Installed as a mixin on TypeChecker.prototype.

import { constIntValue } from "./const-fold.js";
import { exprText, operandKind } from "./operand-text.js";
import { sharedInfo } from "./stdlib/shared.js";
import {
	ANY,
	anyKind,
	BOOL,
	CMP_OPS,
	COMPARABLE,
	FLOAT64,
	identical,
	is64BitInt,
	isAny,
	isBool,
	isComplex,
	isComplex64,
	isComplexOrNumeric,
	isInteger,
	isNil,
	isNumeric,
	isPointer,
	isString,
	isTypedArraySlice,
	isUntyped,
	isVoid,
	LOG_OPS,
	SIZED_FLOAT_NAMES,
	SIZED_INT_NAMES,
	typeStr,
	UNTYPED_BOOL,
	UNTYPED_COMPLEX,
	UNTYPED_FLOAT,
	UNTYPED_INT,
	UNTYPED_RUNE,
} from "./types.js";

// Unnamed type literal kinds for Go's "identical underlying types" assignability rule.
const TYPE_LITERAL_KINDS = new Set([
	"slice",
	"map",
	"func",
	"pointer",
	"array",
	"struct",
]);

// Operators defined on integer operands only.
// Basic types that are not number, string or bool types: JS-dynamic `any`,
// the types of `nil` and `void`, and the `comparable` constraint.
const NIL_LOOSE_BASICS = new Set(["any", "nil", "void", "comparable"]);
// Composite kinds that no untyped constant converts to.
const CONST_REJECTING_KINDS = new Set([
	"struct",
	"array",
	"slice",
	"map",
	"pointer",
	"func",
	"chan",
]);

const INTEGER_ONLY_OPS = new Set(["%", "&", "|", "^", "&^"]);

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

// `&&` and `||` of two untyped bools stay untyped; a typed operand (including
// a defined bool type) gives its type, as in Go.
// Two typed operands must have the same type, and the result has it.
function logicalResultType(lt, rt) {
	if (lt?.kind === "untyped" && rt?.kind === "untyped") return UNTYPED_BOOL;
	if (rt?.kind === "untyped" && isBool(lt)) return lt;
	if (lt?.kind === "untyped" && isBool(rt)) return rt;
	if (isBool(lt) && isBool(rt) && identical(lt, rt)) return lt;
	return BOOL;
}

// Two untyped numeric operands combine to the later of int, rune, float.
function untypedIntegerKind(isFloat, lt, rt) {
	if (isFloat) return UNTYPED_FLOAT;
	return lt.rune || rt.rune ? UNTYPED_RUNE : UNTYPED_INT;
}

// The kind class of an untyped constant: only constants of one class
// (bool, string or number) meet in an operator.
function untypedClass(t) {
	return t.base === "bool" || t.base === "string" ? t.base : "number";
}

// Which operand types an operator accepts, by operator class.
function opClass(op) {
	if (INTEGER_ONLY_OPS.has(op)) return "int";
	if (op === "+") return "add";
	if (op === "-" || op === "*" || op === "/") return "num";
	return "ord";
}

const TYPE_PARAM_OP_PREDICATES = {
	int: (t) => isInteger(t),
	add: (t) => isComplexOrNumeric(t) || isString(t),
	num: (t) => isComplexOrNumeric(t),
	ord: (t) => isNumeric(t) || isString(t),
};

/** @type {ThisType<TypeChecker>} */
export const assignabilityMethods = {
	// ── Binary result types ───────────────────────────────────────────

	binaryResultType(op, lt, rt, node) {
		if (lt?.kind === "typeParam" || rt?.kind === "typeParam") {
			// `x == nil` with a type parameter takes the same nil rule.
			if (node && CMP_OPS.has(op) && !this.convertUntyped(lt, rt, node))
				return UNTYPED_BOOL;
			return this._binaryResultTypeTypeParam(op, lt, rt, node);
		}
		if (CMP_OPS.has(op)) return this._binaryResultTypeCmp(op, lt, rt, node);
		if (LOG_OPS.has(op)) {
			this._checkLogicalOperands(lt, rt, node);
			return logicalResultType(lt, rt);
		}
		return this._binaryResultTypeNonComplex(op, lt, rt, node);
	},

	// `B && bool` mixes two distinct bool types, which Go rejects.
	_checkLogicalOperands(lt, rt, node) {
		if (!node) return;
		if (lt?.kind === "untyped" || rt?.kind === "untyped") {
			this.convertUntyped(lt, rt, node);
			return;
		}
		if (!isBool(lt) || !isBool(rt) || identical(lt, rt)) return;
		this.err(
			`invalid operation: ${exprText(node)} (mismatched types ${typeStr(lt)} and ${typeStr(rt)})`,
			node,
		);
	},

	_binaryResultTypeTypeParam(op, lt, rt, node) {
		const isShift = op === "<<" || op === ">>";
		if (!isShift && !this._matchTypeParamOperands(op, lt, rt, node))
			return CMP_OPS.has(op)
				? UNTYPED_BOOL
				: lt?.kind === "typeParam"
					? lt
					: rt;
		if (CMP_OPS.has(op)) {
			this._checkTypeParamOperator(op, lt, rt, node);
			return UNTYPED_BOOL;
		}
		if (LOG_OPS.has(op)) {
			this._checkTypeParamOperator(op, lt, rt, node);
			return lt?.kind === "typeParam"
				? lt
				: rt?.kind === "typeParam" && lt?.kind === "untyped"
					? rt
					: BOOL;
		}
		this._checkTypeParamOperator(op, lt, rt, node);
		if (isShift && lt?.kind !== "typeParam" && lt?.kind !== "untyped")
			return lt;
		return lt?.kind === "typeParam" ? lt : rt;
	},

	// The operands of a non-shift operator on a type parameter get one type
	// first, as in Go: an untyped constant converts to the type parameter and
	// a typed operand must be identical to it (`a + b` with `b int` is a
	// mismatch). A comparison with an interface or `nil` operand follows the
	// comparison rules instead. Reports and returns false on a mismatch.
	_matchTypeParamOperands(op, lt, rt, node) {
		if (!node) return true;
		if (isNil(lt) || isNil(rt)) {
			if (CMP_OPS.has(op)) return true;
			this._reportMismatch(lt, rt, node);
			return false;
		}
		if (lt?.kind === "untyped")
			return this._convertUntypedToTypeParam(rt, lt, node.left, node);
		if (rt?.kind === "untyped")
			return this._convertUntypedToTypeParam(lt, rt, node.right, node);
		if (identical(lt, rt)) return true;
		const other = lt?.kind === "typeParam" ? rt : lt;
		if (!other || other._tainted || isAny(other)) return true;
		if (CMP_OPS.has(op) && this._deepUnderlying(other)?.kind === "interface")
			return true;
		this._reportMismatch(lt, rt, node);
		return false;
	},

	// An untyped constant `c` (operand `cNode`) meets type parameter `tp`. Go
	// converts it only when its kind (number, bool, string) is the kind of
	// every type in the type set, else the types are mismatched; the constant
	// must then be representable in every type of the set.
	_convertUntypedToTypeParam(tp, c, cNode, node) {
		const [lt, rt] = node.left === cNode ? [c, tp] : [tp, c];
		const cls = untypedClass(c);
		const all = (pred) =>
			this._typeParamAllows(tp, (t) => pred(this._deepUnderlying(t) ?? t));
		if (
			all(isComplexOrNumeric) !== (cls === "number") ||
			all(isBool) !== (cls === "bool") ||
			all(isString) !== (cls === "string")
		) {
			this._reportMismatch(lt, rt, node);
			return false;
		}
		const terms = this._constraintTerms(tp.constraint, new Set()) ?? [];
		if (terms.every((t) => this._untypedFitsTerm(c, cNode, t))) return true;
		this.err(
			`cannot convert ${this._untypedConstText(c, cNode)} to type ${typeStr(tp)}`,
			cNode,
		);
		return false;
	},

	// Whether untyped constant `c` converts to `term` of a type set: a complex
	// constant needs a complex type and a known value must be representable.
	_untypedFitsTerm(c, cNode, term) {
		const u = this._deepUnderlying(term) ?? term;
		if (c.base === "complex128") return isComplex(u);
		const v = cNode?._const;
		if (!v || isComplex(u) || u?.kind !== "basic") return true;
		const r = this._convertConstTo(v, u);
		return !!r && !r.overflow;
	},

	// `1.5 (untyped float constant)`, `half (untyped float constant 0.5)`: Go
	// adds the value when the operand's text is not the value itself.
	_untypedConstText(c, cNode) {
		const base = c.rune ? "rune" : c.base === "complex128" ? "complex" : c.base;
		const kind = operandKind(cNode, base, true);
		const text = exprText(cNode);
		const v = cNode?._const;
		const value = v && (v.k === "INT" || v.k === "FLOAT") ? String(v.v) : null;
		return value === null || value === text
			? `${text} (${kind})`
			: `${text} (${kind} ${value})`;
	},

	// An operator on a type parameter needs every type in its constraint's
	// type set to support it; a constraint without a type set supports none.
	// A shifted operand is the left one and a shift count any integer.
	_checkTypeParamOperator(op, lt, rt, node) {
		if (!node) return;
		if (op === "==" || op === "!=") {
			this._checkTypeParamComparable(op, lt, rt, node);
			return;
		}
		const isShift = op === "<<" || op === ">>";
		if (isShift) this._checkTypeParamShiftCount(rt, node);
		const left = lt?.kind === "typeParam";
		if (isShift && !left) {
			if (lt?.kind !== "untyped" && !isInteger(lt))
				this.err(
					`invalid operation: shifted operand ${exprText(node.left)} (${operandKind(node.left, typeStr(lt), false)}) must be integer`,
					node.left,
				);
			return;
		}
		const tp = left ? lt : rt;
		const operand = left ? node.left : node.right;
		const isLog = LOG_OPS.has(op);
		const pred = isLog
			? (t) => isBool(t)
			: TYPE_PARAM_OP_PREDICATES[isShift ? "int" : opClass(op)];
		if (this._typeParamAllows(tp, (t) => pred(this._deepUnderlying(t) ?? t)))
			return;
		const kind = `${operandKind(operand, typeStr(tp), false)} constrained by ${this._constraintText(tp)}`;
		if (CMP_OPS.has(op))
			this.err(
				`invalid operation: ${exprText(node)} (type parameter ${typeStr(tp)} cannot use operator ${op})`,
				node,
			);
		else if (isShift)
			this.err(
				`invalid operation: shifted operand ${exprText(operand)} (${kind}) must be integer`,
				operand,
			);
		else
			this.err(
				`invalid operation: operator ${op} not defined on ${exprText(operand)} (${kind})`,
				operand,
			);
	},

	// The count of a shift whose operand involves a type parameter: an integer
	// constant or a value whose every type is an integer.
	_checkTypeParamShiftCount(rt, node) {
		if (rt?.kind !== "typeParam") {
			this.checkShiftCount(rt, node.right);
			return;
		}
		if (
			!this._typeParamAllows(rt, (t) => isInteger(this._deepUnderlying(t) ?? t))
		)
			this.err(
				`invalid operation: shift count ${exprText(node.right)} (${operandKind(node.right, typeStr(rt), false)} constrained by ${this._constraintText(rt)}) must be integer`,
				node.right,
			);
	},

	// `==` and `!=` need every type in the type set to be comparable; a
	// constraint without a type set must itself be `comparable`. A comparison
	// with `nil` follows the nil rule instead.
	_checkTypeParamComparable(op, lt, rt, node) {
		if (isNil(lt) || isNil(rt)) return;
		for (const [t, operand] of [
			[lt, node.left],
			[rt, node.right],
		]) {
			if (t?.kind !== "typeParam" || this._typeParamComparable(t)) continue;
			this.err(
				`invalid operation: ${exprText(node)} (incomparable types in type set)`,
				operand,
			);
			return;
		}
	},

	_typeParamComparable(tp) {
		const terms = this._constraintTerms(tp.constraint, new Set());
		if (terms?.length)
			return terms.every(
				(t) => t.name === "comparable" || this._isComparable(t),
			);
		if (terms) return true;
		let c = tp.constraint;
		if (c?.kind === "TypeName" || c?.kind === "InterfaceType")
			c = this.resolveTypeNode(c, this.globals);
		while (c?.kind === "named") c = c.underlying;
		return c === COMPARABLE || Boolean(c?._comparable);
	},

	_constraintText(tp) {
		const c = tp.constraint;
		if (!c || isAny(c)) return "any";
		if (c.kind === "TypeName") return c.name;
		try {
			return typeStr(c);
		} catch {
			return "its constraint";
		}
	},

	_binaryResultTypeNonComplex(op, lt, rt, node) {
		if (isAny(lt) || isAny(rt)) return ANY;
		if (isComplex(lt) || isComplex(rt))
			return this._binaryResultTypeComplex(op, lt, rt, node);
		if ((op === "<<" || op === ">>") && isNumeric(lt) && isNumeric(rt))
			return this._binaryResultTypeShift(op, lt, rt, node);
		if (isNumeric(lt) && isNumeric(rt))
			return this._binaryResultTypeNumeric(op, lt, rt, node);
		if (isString(lt) && isString(rt) && op === "+")
			return this._binaryResultTypeString(lt, rt, node);
		if (node && lt.kind !== "untyped" && identical(lt, rt)) {
			// `b + b` on bool: the operator is not defined for the type.
			const left = node.left;
			this.err(
				`invalid operation: operator ${op} not defined on ${exprText(left)} (${operandKind(left, typeStr(lt), false)})`,
				left,
			);
		} else if (node)
			this.err(`Invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
		return ANY;
	},

	// A shift has the type of its left operand; the count may be any integer
	// type or an untyped constant representable as uint.
	_binaryResultTypeShift(_op, lt, rt, node) {
		if (node) this.checkShiftCount(rt, node.right);
		if (node && lt.kind !== "untyped" && !isInteger(lt))
			this.err(
				`invalid operation: shifted operand ${exprText(node.left)} (${operandKind(node.left, typeStr(lt), false)}) must be integer`,
				node.left,
			);
		return lt;
	},

	// Reports a shift count that is not an integer or is a negative constant.
	checkShiftCount(rt, countExpr) {
		const v = this._constValue(countExpr);
		if (v) {
			const n = constIntValue(v);
			if (rt && rt.kind !== "untyped" && !isInteger(rt)) {
				this.err(
					`invalid shift count: ${typeStr(rt)} is not an integer type`,
					countExpr,
				);
			} else if (n === null) {
				this.err(
					`invalid shift count ${typeStr(rt)} constant: not an integer`,
					countExpr,
				);
			} else if (n < 0n) {
				this.err(`invalid shift count: ${n} is negative`, countExpr);
			} else if (n > 0xffffffffffffffffn) {
				this.err(
					`${exprText(countExpr)} (${this._operandTypeStr(rt)} constant) overflows uint`,
					countExpr,
				);
			} else if (rt?.kind === "untyped" && rt.base === "float64") {
				// `x << 1.0`: the count is converted to an integer constant.
				countExpr._type = UNTYPED_INT;
			}
			return;
		}
		if (!isInteger(rt))
			this.err(
				`invalid shift count: ${typeStr(rt)} is not an integer type`,
				countExpr,
			);
	},

	// The result keeps the defined type of the typed operand (`S + S` is `S`);
	// two typed operands must have identical types.
	_binaryResultTypeString(lt, rt, node) {
		if (lt.kind === "untyped" && rt.kind === "untyped") return lt;
		if (lt.kind === "untyped") return rt;
		if (rt.kind === "untyped") return lt;
		this._checkIdenticalOperands(lt, rt, node);
		return lt;
	},

	_binaryResultTypeCmp(op, lt, rt, node) {
		if (this._checkComplexCmpOp(op, lt, rt, node)) return ANY;
		this._checkCmpOperandTypes(lt, rt, node);
		this._checkEqualityComparable(op, lt, rt, node);
		// A comparison is an untyped bool: it also fits a defined bool type.
		return UNTYPED_BOOL;
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
		if (node && !this.convertUntyped(lt, rt, node)) return ANY;
		if (lt.kind === "untyped") return rt;
		if (rt.kind === "untyped") return lt;
		this._checkIdenticalOperands(lt, rt, node);
		return lt;
	},

	_binaryResultTypeNumeric(op, lt, rt, node) {
		if (!this._checkIdenticalOperands(lt, rt, node)) return lt;
		this._checkIntegerOnlyOperator(op, lt, rt, node);
		const lName = lt.kind === "untyped" ? lt.base : lt.name;
		const rName = rt.kind === "untyped" ? rt.base : rt.name;
		const lFloat = lName === "float32" || lName === "float64";
		const rFloat = rName === "float32" || rName === "float64";
		const isFloat = lFloat || rFloat;
		if (lt.kind === "untyped" && rt.kind === "untyped")
			return untypedIntegerKind(isFloat, lt, rt);
		// An untyped constant takes the type of the typed operand.
		if (lt.kind === "untyped") return rt;
		if (rt.kind === "untyped") return lt;
		if (lt.name === "float32" && rt.name === "float32") return lt;
		return isFloat ? FLOAT64 : lt;
	},

	// Two typed operands of an arithmetic operator must have identical types
	// (`int + float64`, `Meters + Feet`); untyped constants adapt to either
	// side. Returns false after reporting a mismatch.
	_checkIdenticalOperands(lt, rt, node) {
		if (!node || lt.kind === "untyped" || rt.kind === "untyped") return true;
		if (identical(lt, rt)) return true;
		this.err(
			`invalid operation: ${exprText(node)} (mismatched types ${typeStr(lt)} and ${typeStr(rt)})`,
			node,
		);
		return false;
	},

	// `%`, `&`, `|`, `^` and `&^` are defined on integers only. The typed
	// operand decides; two untyped constants are integers unless one is a
	// float constant (`5.5 % 2.0`).
	_checkIntegerOnlyOperator(op, lt, rt, node) {
		if (!node || !INTEGER_ONLY_OPS.has(op)) return;
		const operands = [
			[lt, node.left],
			[rt, node.right],
		];
		const typed = operands.find(([t]) => t.kind !== "untyped");
		const bad = (typed ? [typed] : operands).find(([t]) => !isInteger(t));
		if (bad) this._reportIntegerOnly(op, bad[0], bad[1]);
	},

	// A Go `any` (written in source) has no operators besides `==` and `!=`:
	// the value needs a type assertion first. JS-dynamic and recovered `any`
	// types are not Go `any` and stay permissive.
	_checkDeclaredAnyOperator(op, type, operand) {
		if (anyKind(type) !== "go" || !operand) return null;
		return this.err(
			`invalid operation: operator ${op} not defined on ${exprText(operand)} (${operandKind(operand, typeStr(type))})`,
			operand,
		);
	},

	// `v + 1` with `v` a Go `any`: the left operand is reported first.
	_checkDeclaredAnyBinary(op, lt, rt, node) {
		if (op === "==" || op === "!=") return null;
		return (
			this._checkDeclaredAnyOperator(op, lt, node.left) ??
			this._checkDeclaredAnyOperator(op, rt, node.right)
		);
	},

	_reportIntegerOnly(op, type, operand) {
		const isConst = type.kind === "untyped";
		const kind = operandKind(
			operand,
			isConst ? type.base : typeStr(type),
			isConst,
		);
		this.err(
			`invalid operation: operator ${op} not defined on ${exprText(operand)} (${kind})`,
			operand,
		);
	},

	// Comparing two typed operands of basic types needs identical types
	// (`float64 == int`, `Celsius == Fahrenheit`, `S == string`): neither is
	// assignable to the other. An untyped constant or `nil` is converted to
	// the other operand's type first (`convertUntyped`); interface and
	// JS-dynamic operands adapt to either side.
	_checkCmpOperandTypes(lt, rt, node) {
		if (!node) return;
		if (!this.convertUntyped(lt, rt, node)) return;
		if (!this._isTypedBasicOperand(lt)) return;
		if (!this._isTypedBasicOperand(rt) || identical(lt, rt)) return;
		this.err(
			`invalid operation: ${exprText(node)} (mismatched types ${typeStr(lt)} and ${typeStr(rt)})`,
			node,
		);
	},

	// The one conversion step for an untyped constant or `nil` operand of the
	// binary expression `node`: it takes the other operand's type, and the
	// kind must fit (`string == 'a'`, `int == nil`, `float64 + 1i`). Reports
	// and returns false on a mismatch; true when nothing is wrong or there is
	// nothing to convert.
	convertUntyped(lt, rt, node) {
		const ln = isNil(lt);
		const rn = isNil(rt);
		if (ln && rn) {
			this.err(
				`invalid operation: ${exprText(node)} (operator ${node.op} not defined on untyped nil)`,
				node,
			);
			return false;
		}
		let fits = true;
		if (lt?.kind === "untyped" && rt?.kind === "untyped" && !ln && !rn)
			fits = untypedClass(lt) === untypedClass(rt);
		else if (ln || rn) fits = !this._nilMismatch(ln ? rt : lt);
		else if (lt?.kind === "untyped" && rt?.kind !== "untyped")
			return this._convertUntypedConst(rt, lt, node.left, lt, rt, node);
		else if (rt?.kind === "untyped" && lt?.kind !== "untyped")
			return this._convertUntypedConst(lt, rt, node.right, lt, rt, node);
		if (!fits) this._reportMismatch(lt, rt, node);
		return fits;
	},

	_nilMismatch(other) {
		return !!other && !other._tainted && this._isNilless(other);
	},

	_reportMismatch(lt, rt, node) {
		this.err(
			`invalid operation: ${exprText(node)} (mismatched types ${this._operandTypeStr(lt)} and ${this._operandTypeStr(rt)})`,
			node,
		);
	},

	_operandTypeStr(t) {
		if (isNil(t)) return "untyped nil";
		if (t?.kind === "untyped" && t.base === "float64") return "untyped float";
		if (t?.kind === "untyped" && t.base === "complex128")
			return "untyped complex";
		return typeStr(t);
	},

	// An untyped constant `untyped` (operand `untypedNode`) meets the typed
	// operand `typed`: its kind must be one the type can hold.
	_convertUntypedConst(typed, untyped, untypedNode, lt, rt, node) {
		const u = this._deepUnderlying(typed);
		if (!u || typed._tainted || typed.kind === "typeParam") return true;
		let fits = !CONST_REJECTING_KINDS.has(u.kind);
		if (u.kind === "basic") {
			if (NIL_LOOSE_BASICS.has(u.name)) return true;
			if (u.name === "string") fits = untyped.base === "string";
			else if (u.name === "bool") fits = untyped.base === "bool";
			else fits = untyped.base !== "string" && untyped.base !== "bool";
			// Imaginary constants are not tracked by value: any non-complex
			// target is reported as an overflow.
			if (fits && untyped.base === "complex128" && !isComplex(u)) {
				this.err(
					`${exprText(untypedNode)} (untyped complex constant) overflows ${typeStr(typed)}`,
					untypedNode,
				);
				return false;
			}
		}
		if (!fits) this._reportMismatch(lt, rt, node);
		return fits;
	},

	// `x := nil`, `var x = nil`: untyped `nil` has no default type, so it
	// cannot give a variable its type. Reports and returns true for `nil`.
	_rejectUntypedNil(t, node, ctx) {
		if (!isNil(t)) return false;
		this.err(`use of untyped nil in ${ctx}`, node);
		return true;
	},

	// Whether `nil` has no value in `t`: a struct, array, number, string or
	// bool, or a type parameter whose constraint admits such a type or has no
	// type set. JS-dynamic `any` and the loosely modelled kinds keep `nil`.
	_isNilless(t) {
		if (!t) return false;
		if (t.kind === "typeParam")
			return !this._typeParamAllows(
				t,
				(term) => term.name !== "comparable" && !this._isNilless(term),
			);
		const u = this._deepUnderlying(t);
		return (
			u?.kind === "struct" ||
			u?.kind === "array" ||
			(u?.kind === "basic" && !NIL_LOOSE_BASICS.has(u.name))
		);
	},

	// A typed value whose underlying type is a number, string or bool.
	_isTypedBasicOperand(t) {
		if (!t || t.kind === "untyped" || isAny(t) || isNil(t)) return false;
		const u = this._deepUnderlying(t);
		return u?.kind === "basic" && !isAny(u) && !isNil(u) && !isVoid(u);
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
		const base = this._deepUnderlying(t);
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

	_tag64BitNode(target, node) {
		if (node && typeof node === "object" && is64BitInt(target)) {
			node._is64Bit = true;
			if (node.kind === "KeyValueExpr" && node.value)
				node.value._is64Bit = true;
			if (node.kind === "UnaryExpr" && node.operand)
				node.operand._is64Bit = true;
			if (node.kind === "ParenExpr" && node.expr) node.expr._is64Bit = true;
		}
	},

	// An untyped numeric constant that takes type float32 is rounded to
	// float32 in JS output (`var c float32 = 0.01`, `v == 0.01`).
	_tagFloat32Const(target, source, node) {
		if (!node || typeof node !== "object" || !node._const) return;
		if (!isUntyped(source) || this._float32Base(target) !== "float32") return;
		node._f32Const = true;
	},

	_float32Base(t) {
		const r = this._deepUnderlying(t);
		return r?.kind === "basic" || r?.kind === "untyped" ? r.name : null;
	},

	// `var m uint64 = (1 << k) - 1`: a non-constant shift whose left operand is
	// an untyped constant takes the type its context gives it, so codegen
	// computes it in that type (BigInt for 64-bit integers).
	_retypeUntypedShift(target, source, valueNode) {
		if (!isUntyped(source) || !isInteger(target)) return;
		this._retypeShiftTree(valueNode, target);
	},

	_retypeShiftTree(e, target) {
		if (!e || typeof e !== "object" || e._type?.kind !== "untyped") return;
		if (e.kind === "ParenExpr") this._retypeShiftTree(e.expr, target);
		else if (e.kind === "UnaryExpr") this._retypeShiftTree(e.operand, target);
		else if (e.kind === "BinaryExpr" && !this._constValue(e)) {
			const isShift = e.op === "<<" || e.op === ">>";
			this._retypeShiftTree(e.left, target);
			if (isShift && e.left._type?.kind === "untyped") {
				e.left._type = target;
				if (is64BitInt(target)) e.left._is64Bit = true;
			} else if (!isShift) this._retypeShiftTree(e.right, target);
		} else return;
		if (this._constValue(e)) return;
		e._type = target;
		if (is64BitInt(target)) e._is64Bit = true;
	},

	// An untyped real constant flowing into a complex type becomes a complex
	// value in codegen.
	_tagComplexConst(target, source, valueNode) {
		if (
			valueNode &&
			typeof valueNode === "object" &&
			isComplex(target) &&
			isUntyped(source) &&
			!isComplex(source)
		)
			valueNode._asComplex = true;
		this._tagComplex64Const(target, source, valueNode);
	},

	// An untyped constant that takes type complex64 is rounded to float32 in
	// JS output: a real constant through `_f32Const`, a complex constant
	// (`1 + 0.01i`) through `_c64Const`.
	_tagComplex64Const(target, source, node) {
		if (!node || typeof node !== "object") return;
		if (!isComplex64(target) || !isUntyped(source)) return;
		if (isComplex(source)) node._c64Const = true;
		else if (node._const) node._f32Const = true;
	},

	// `operand` is the expression whose value flows in, when `node` (the
	// position and codegen tag) is not that expression. `structCopy` is set
	// only by the contexts that accept the implicit conversion between a
	// defined struct type and an identical struct literal type (see
	// `_markStructCopy`); every other context rejects it.
	assertAssignable(
		target,
		source,
		node,
		ctx = "assignment",
		operand = node,
		structCopy = false,
	) {
		if (!target || !source) return;
		if (this._checkConstOverflow(target, source, node, ctx)) return;
		target = this.resolveType(target);
		source = this.resolveType(source);
		this._tag64BitNode(target, node);
		this._tagFloat32Const(target, source, operand ?? node);
		this._retypeUntypedShift(target, source, operand ?? node);
		this._tagComplexConst(target, source, operand ?? node);
		this._markIfaceBox(target, source, node);
		this._checkWasmIfaceProvider(target, source, node);
		// The results of a forwarded call (`g(f())`) have no node of their own:
		// errors report at the call that yields them, as Go does. The rewrites
		// above and `_markStructCopy` never see it, since they would tag or
		// rewrite that one call once per result.
		const at = node ?? this._forwardedCall;
		if (this._checkIfaceToConcrete(target, source, at, ctx, operand ?? at))
			return;
		if (this._assertAssignableEarlyReturn(target, source, operand ?? node, ctx))
			return;
		if (isPointer(target) && isPointer(source)) {
			this._assertNestedAssignable(
				target.base ?? target.underlying?.base,
				source.base ?? source.underlying?.base,
				at,
			);
			return;
		}
		if (isUntyped(source) && this._isUntypedAssignable(target, source)) return;
		if (this._checkNumericCoercion(target, source, at, ctx, operand ?? at))
			return;
		if (this._checkArrayAssignable(target, source, at)) return;
		if (this._checkTypedArrayAssignable(target, source, at)) return;
		if (this._checkFuncAssignable(target, source, at)) return;
		if (!identical(target, source))
			this._assertAssignableTypeMismatch(
				target,
				source,
				at,
				operand ?? node,
				structCopy,
			);
	},

	// The element of an array or the base of a pointer: a struct type and a
	// defined type over an identical struct are not interchangeable there,
	// since the two do not share a representation.
	_assertNestedAssignable(target, source, node) {
		const t = this.resolveType(target);
		const s = this.resolveType(source);
		if (
			t &&
			s &&
			(t.kind === "struct") !== (s.kind === "struct") &&
			this._deepUnderlying(t)?.kind === "struct" &&
			this._deepUnderlying(s)?.kind === "struct" &&
			!identical(t, s)
		) {
			this.err(`Cannot assign ${typeStr(s)} to ${typeStr(t)}`, node);
			return;
		}
		if (this._distinctEmptyInterfaces(t, s)) {
			this.err(`cannot use ${typeStr(s)} as ${typeStr(t)} value`, node);
			return;
		}
		this.assertAssignable(target, source, node);
	},

	// `*B` and `*any` differ when `B` is a defined empty interface.
	_distinctEmptyInterfaces(t, s) {
		return (
			anyKind(t) === "go" &&
			anyKind(s) === "go" &&
			(t.kind === "named" || s.kind === "named") &&
			!identical(t, s)
		);
	},

	// Tags struct values / struct pointers flowing into an interface so codegen can
	// tell `T` from `*T` at runtime (both compile to the same class instance).
	_markIfaceBox(target, source, node) {
		if (
			this._skipIfaceMark ||
			!node ||
			typeof node !== "object" ||
			!target ||
			!source
		)
			return;
		if (target.kind === "typeParam") return;
		let tBase = this.resolveType(target);
		tBase = this._deepUnderlying(tBase);
		if (!isAny(target) && tBase?.kind !== "interface") return;
		// The static type behind the interface value: codegen derives the
		// fmt metadata (Stringer elements of slices and maps) from it.
		node._ifaceSrc = source;
		const meta = this._ifaceBoxMeta(source);
		if (!meta) return;
		node._ifaceBox = meta.box;
		if (meta.type) node._ifaceNamedType = meta.type;
		if (meta.ptrFields) node._ifacePtrFields = meta.ptrFields;
	},

	// How a value of static type `source` is boxed on entering an interface:
	// { box, type? (named kinds), ptrFields? }, or null when it stays raw.
	// Shared by _markIfaceBox and the JS backend's multi-value fmt operands.
	_ifaceBoxMeta(source) {
		const named = this._namedMethodBoxSource(source);
		if (named)
			return { box: named.ptr ? "named_ptr" : "named", type: named.type };
		const sBase = this.resolveType(this._deepUnderlying(source));
		const info = this._classifyIfaceBox(sBase);
		if (!info) return null;
		return { box: info.box, ptrFields: info.ptrFields };
	},

	// A named non-struct type with methods (or a pointer to one) entering an
	// interface: the JS backend keeps such values raw and boxes them here so
	// dynamic method dispatch works.
	_namedMethodBoxSource(source) {
		const isPtr = source?.kind === "pointer";
		let t = isPtr ? source.base : source;
		if (t?.kind === "TypeName" || t?.kind === "Ident") t = this.resolveType(t);
		if (t?.kind !== "named") return null;
		const u = this._deepUnderlying(t);
		if (!u || u.kind === "struct" || u.kind === "interface") return null;
		const methods = t.methods ?? t._generic?.methods;
		// A user-declared named basic type without methods is boxed as well, so
		// a type assertion to its underlying type fails like Go.
		if (
			u.kind === "basic" &&
			!t._generic &&
			t.methods instanceof Map &&
			t.methods.size === 0 &&
			t._target !== undefined &&
			t._target !== "wasm"
		)
			return { type: t, ptr: isPtr };
		if (!methods || methods.size === 0) return null;
		// Only user-declared types (methods carry _ptrRecv); stdlib named types
		// such as strings.Builder have no box class.
		if (![...methods.values()].some((m) => Object.hasOwn(m ?? {}, "_ptrRecv")))
			return null;
		return { type: t, ptr: isPtr };
	},

	_getStructPtrFields(st, prefix = "", seen = new Set()) {
		if (st?.kind !== "struct" || !st?.fields) return [];
		if (seen.has(st)) return [];
		const nextSeen = new Set(seen);
		nextSeen.add(st);
		const ptrs = [];
		for (const [fname, ftype] of st.fields.entries()) {
			const full = prefix ? `${prefix}.${fname}` : fname;
			const rf = this.resolveType(ftype);
			const bf = this._deepUnderlying(rf);
			if (isPointer(bf)) {
				ptrs.push(full);
			} else if (bf?.kind === "struct") {
				ptrs.push(...this._getStructPtrFields(bf, full, nextSeen));
			}
		}
		return ptrs;
	},

	_classifyIfaceBox(sBase) {
		if (sBase?.kind === "struct") {
			const pf = this._getStructPtrFields(sBase);
			return { box: "value", ptrFields: pf.length > 0 ? pf : null };
		}
		if (sBase?.kind === "pointer") {
			const st = this.resolveType(this._deepUnderlying(sBase.base));
			if (st?.kind === "struct") {
				const pf = this._getStructPtrFields(st);
				return { box: "ptr", ptrFields: pf.length > 0 ? pf : null };
			}
			return null;
		}
		if (sBase?.kind === "map") {
			const valType = this.resolveType(sBase.value ?? sBase.val ?? sBase.elem);
			const keyType = this.resolveType(sBase.key);
			return {
				box: isPointer(valType) || isPointer(keyType) ? "ptr_map" : "map",
			};
		}
		if (sBase?.kind === "slice") {
			const elemType = this.resolveType(sBase.elem);
			if (isPointer(elemType)) return { box: "ptr_slice" };
			const elemBase =
				elemType?.kind === "named"
					? this.resolveType(elemType.underlying)
					: elemType;
			const pf =
				elemBase?.kind === "struct" ? this._getStructPtrFields(elemBase) : [];
			return pf.length > 0 ? { box: "slice", ptrFields: pf } : null;
		}
		return null;
	},

	// A js package cannot provide an implementation of a wasm interface: the
	// value would cross into wasm, and JS-implemented proxies are not supported.
	_checkWasmIfaceProvider(target, source, node) {
		if (this.target !== "js" || target?.kind !== "named") return;
		if (target._target !== "wasm" || !source) return;
		const iface = this.resolveType(target.underlying);
		if (iface?.kind !== "interface" || !(iface.methods?.size > 0)) return;
		const ptr = source.kind === "pointer";
		const src = ptr ? this.resolveType(source.base) : source;
		if (src?.kind !== "named" || src._target === "wasm") return;
		if (this.resolveType(src.underlying)?.kind === "interface") return;
		if (!this.implements(source, iface, node)) return;
		this.err(
			`type '${ptr ? "*" : ""}${src.name}' (${src._target ?? "js"}) cannot implement wasm interface '${target.name}' across the boundary; implement it in a wasm package or pass a func callback`,
			node,
		);
	},

	// An interface-typed operand needs an explicit type assertion before it can
	// flow into a concrete (non-interface) type, or into an interface with
	// methods (`var e error = b` with `b any`).
	_checkIfaceToConcrete(target, source, node, ctx, operand) {
		if (anyKind(source) !== "go" || !operand || typeof operand !== "object")
			return false;
		if (!this._isConcreteTarget(target) && !this._isMethodIfaceTarget(target))
			return false;
		this.err(
			`cannot use ${exprText(operand)} (${operandKind(operand, typeStr(source))}) as ${typeStr(target)} value in ${ctx}: need type assertion`,
			node,
		);
		return true;
	},

	// `int(x)`, `(*T)(x)` and `I(x)` (I with methods) with a source-written
	// `any` operand need an assertion.
	_checkIfaceConversion(srcType, targetType, expr, operand) {
		if (anyKind(srcType) !== "go" || !operand) return false;
		if (
			!this._isConcreteTarget(targetType) &&
			!this._isMethodIfaceTarget(targetType)
		)
			return false;
		this.err(
			`cannot convert ${exprText(operand)} (${operandKind(operand, typeStr(srcType))}) to type ${typeStr(targetType)}: need type assertion`,
			expr,
		);
		return true;
	},

	// An interface type (named or literal) with at least one method.
	_isMethodIfaceTarget(target) {
		if (!target || isAny(target)) return false;
		const base = this.resolveType(this._deepUnderlying(target));
		return base?.kind === "interface" && base.methods?.size > 0;
	},

	_isConcreteTarget(target) {
		if (!target || target.kind === "typeParam" || isAny(target)) return false;
		if (isNil(target) || isUntyped(target)) return false;
		const base = this.resolveType(this._deepUnderlying(target));
		return !!base && base.kind !== "interface" && base.kind !== "typeParam";
	},

	// `nil` only has a value in a pointer, slice, map, func, chan, interface or
	// type-parameter type. JS-dynamic `any` and the other kinds the checker
	// models loosely (`shared`, `simd`) keep accepting it.
	_checkNilTarget(target, node, ctx) {
		if (this._isNilless(target))
			this.err(`cannot use nil as ${typeStr(target)} value in ${ctx}`, node);
	},

	_assertAssignableEarlyReturn(target, source, node, ctx) {
		if (isNil(source)) this._checkNilTarget(target, node, ctx);
		return (
			target?.kind === "typeParam" ||
			source?.kind === "typeParam" ||
			isAny(target) ||
			isAny(source) ||
			isNil(source)
		);
	},

	_assertAssignableTypeMismatch(
		target,
		source,
		node,
		operand = node,
		structCopy = false,
	) {
		let tBase = this._deepUnderlying(target);
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
		const sBase = this.resolveType(this._deepUnderlying(source));
		if (sharedInfo(source) && tBase?.kind === "slice") {
			this.err(
				`cannot use ${typeStr(source)} as ${typeStr(target)}: a linear-memory buffer cannot be passed as a GC slice without an explicit copy`,
				node,
			);
			return;
		}
		if (tBase?.kind === "shared" && sBase?.kind === "slice") {
			this.err(
				`cannot use ${typeStr(source)} as ${typeStr(target)}: a GC slice cannot be used as a shared buffer; copy its elements into one allocated with shared.New${tBase.shared}`,
				node,
			);
			return;
		}
		if (this._identicalUnderlyingLiteral(target, source, tBase, sBase)) {
			if (
				this._markStructCopy(target, source, tBase, sBase, operand, structCopy)
			)
				return;
			this.err(
				`Cannot assign ${typeStr(source)} to ${typeStr(target)} here: convert it explicitly with ${typeStr(target)}(v)`,
				node,
			);
			return;
		}
		this.err(
			`Cannot assign ${typeStr(source)} to ${typeStr(target)}`,
			node,
			this._seqToSliceHint(source, tBase, node),
		);
	},

	// A struct value assigned between a defined struct type and an identical
	// struct literal type is rewritten, in place, into the explicit conversion
	// `T(v)`, so every backend sees exactly what the program could have
	// written (a copy in the target's representation). The rewrite replaces
	// the expression producing the value, so it applies only when that
	// expression yields exactly this one value; a forwarded multi-value call,
	// a comma-ok form, a range clause or a missing operand has no such
	// expression and returns false (the caller rejects the assignment).
	// Structs with an embedded field are not converted either: wasm lays out
	// an anonymous struct without its embeds. The conversion is an allow-list:
	// only the contexts that pass `allowed` (variable initializers,
	// assignments with one value per target, struct fields, composite literal
	// elements, plain call arguments and returns) get it; a map key, a range
	// clause, a switch case or a deferred call's argument needs the explicit
	// conversion.
	_markStructCopy(target, source, tBase, sBase, operand, allowed = false) {
		if (tBase?.kind !== "struct") return true;
		if (target.kind === "pointer" || source.kind === "pointer") return true;
		if (!allowed) return false;
		if ([tBase, sBase].some((b) => b?._structFields?.some((f) => f.embedded)))
			return false;
		if (!operand || typeof operand !== "object" || !operand._type) return false;
		// A node this rule already rewrote, reached again with its old type.
		if (
			operand._implicitStructConv &&
			identical(this.resolveType(operand._type), target)
		)
			return true;
		if (!identical(this.resolveType(operand._type), source)) return false;
		const typeNode = this._conversionTypeNode(target);
		if (!typeNode) return false;
		const inner = { ...operand };
		for (const k of Object.keys(operand)) delete operand[k];
		Object.assign(operand, {
			kind: "TypeConversion",
			targetType: typeNode,
			expr: inner,
			_type: target,
			_implicitStructConv: true,
			_line: inner._line,
			_col: inner._col,
		});
		return true;
	},

	// The type node spelling `type` in a conversion, built from the resolved
	// type so it needs no scope; null when the type has no such spelling here
	// (a generic instance, a type parameter, a func or interface type, an
	// embedded field, a mangled standard library name).
	_conversionTypeNode(type) {
		const t = this.resolveType(type);
		if (!t) return null;
		switch (t.kind) {
			case "basic":
				return t.name ? { kind: "TypeName", name: t.name } : null;
			case "named":
				return !t.typeArgs?.length &&
					!t._generic &&
					!t.name.includes("$") &&
					this.types.get(t.name) === (t._substOf ?? t)
					? { kind: "TypeName", name: t.name }
					: null;
			case "pointer": {
				const base = this._conversionTypeNode(t.base);
				return base && { kind: "PointerType", base };
			}
			case "slice": {
				const elem = this._conversionTypeNode(t.elem);
				return elem && { kind: "SliceType", elem };
			}
			case "array": {
				const elem = this._conversionTypeNode(t.elem);
				return (
					elem &&
					Number.isInteger(t.size) && {
						kind: "ArrayType",
						size: { kind: "BasicLit", litKind: "INT", value: String(t.size) },
						elem,
					}
				);
			}
			case "map": {
				const key = this._conversionTypeNode(t.key);
				const value = this._conversionTypeNode(t.value);
				return key && value && { kind: "MapType", key, value };
			}
			case "struct":
				return this._structConversionTypeNode(t);
			default:
				return null;
		}
	},

	_structConversionTypeNode(t) {
		if (!t._structFields) return null;
		const fields = [];
		for (const f of t._structFields) {
			const type = f.embedded ? null : this._conversionTypeNode(f.type);
			if (!type) return null;
			fields.push({ names: f.names, type, embedded: false, tag: f.tag });
		}
		return { kind: "StructType", fields };
	},

	// maps.Keys/Values (and every iter.Seq) no longer return a slice: point the
	// slice-expecting caller at slices.Collect.
	_seqToSliceHint(source, tBase, node) {
		if (tBase?.kind !== "slice" || !this._isIterSeq(source)) return null;
		return this._seqCollectHint(node);
	},

	_isIterSeq(t) {
		return t?.kind === "named" && /^iter\.Seq\d*\[/.test(typeStr(t));
	},

	_seqCollectHint(node) {
		const f = node?.kind === "CallExpr" ? node.func : null;
		if (
			f?.kind === "SelectorExpr" &&
			f.expr?.kind === "Ident" &&
			f.expr.name === "maps" &&
			(f.field === "Keys" || f.field === "Values")
		)
			return `use slices.Collect(maps.${f.field}(m)) for a slice`;
		return "use slices.Collect(seq) for a slice";
	},

	// len/cap, spread and slice conversion are lenient on func types, and an
	// iter.Seq value is one: reject it there instead of miscompiling.
	_rejectSeqAsSlice(type, node, use) {
		if (!this._isIterSeq(type)) return;
		this.err(
			`cannot use ${typeStr(type)} in ${use}`,
			node,
			this._seqCollectHint(node),
		);
	},

	// Identical underlying types are assignable when one side is an unnamed
	// type literal (`var n Names = []string{...}`), as in Go.
	_identicalUnderlyingLiteral(target, source, tBase, sBase) {
		if ((target.kind === "named") === (source.kind === "named")) return false;
		const unnamed = target.kind === "named" ? source : target;
		return TYPE_LITERAL_KINDS.has(unnamed.kind) && identical(tBase, sBase);
	},

	_isUntypedAssignable(target, source) {
		if (isUntyped(target)) return true;
		// Named types with a basic underlying type (`type Mode string`) accept
		// untyped constants of that kind, as in Go.
		target = this._deepUnderlying(target);
		if (target?.kind !== "basic") return false;
		return (
			(UNTYPED_COMPAT[source.base]?.has(target.name) ?? false) ||
			(isComplex(target) &&
				(source.base === "int" || source.base === "float64"))
		);
	},

	// Go has no implicit conversion between `int` and `float64`: only an
	// untyped constant (handled earlier) or an explicit `float64(n)` /
	// `int(x)` crosses. Returns true when the pair was handled.
	_checkNumericCoercion(target, source, node, ctx, operand) {
		if (
			!this._isIntToFloat(target, source) &&
			!this._isFloatToInt(target, source)
		)
			return false;
		this.err(
			`cannot use ${exprText(operand)} (${operandKind(operand, typeStr(source))}) as ${typeStr(target)} value in ${ctx}`,
			node,
		);
		return true;
	},

	_isIntToFloat(target, source) {
		return (
			target.kind === "basic" &&
			source.kind === "basic" &&
			target.name === "float64" &&
			source.name === "int"
		);
	},

	_isFloatToInt(target, source) {
		return (
			target.kind === "basic" &&
			source.kind === "basic" &&
			target.name === "int" &&
			source.name === "float64"
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
			else this._assertNestedAssignable(target.elem, source.elem, node);
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
			if (isTypedArraySlice(slice) && identical(taElem, slice.elem))
				return true;
			this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
			return true;
		}

		if (targetTa && sourceTa) {
			const tElem = target.underlying?._elemType ?? target._elemType;
			const sElem = source.underlying?._elemType ?? source._elemType;
			if (identical(tElem, sElem)) return true;
			this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
			return true;
		}

		return false;
	},

	_checkFuncAssignable(target, source, node) {
		const tFunc = this._deepUnderlying(target);
		const sFunc = this._deepUnderlying(source);
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
			if (!identical(reqList[i], actList[i])) return false;
		}
		return true;
	},

	_unpackReturns(rList) {
		if (
			rList.length === 1 &&
			(rList[0]?.kind === "tuple" || rList[0]?.kind === "TupleType") &&
			rList[0].types
		) {
			return rList[0].types;
		}
		return rList;
	},

	_implementsMethod(required, actual) {
		if (!actual) return false;
		const rp = required.params ?? [],
			ap = actual.params ?? [];
		const rr = this._unpackReturns(required.returns ?? []),
			ar = this._unpackReturns(actual.returns ?? []);
		if (!this._sigParamsMatch(rp, ap)) return false;
		if (!!required.variadic !== !!actual.variadic) return false;
		return this._sigParamsMatch(rr, ar);
	},

	implements(srcType, iface, _node) {
		const isPtr = srcType?.kind === "pointer";
		// *T has the full method set of T (value + pointer receivers).
		if (srcType?.kind === "pointer") srcType = this.resolveType(srcType.base);
		let base = this._deepUnderlying(srcType);
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
				? base.methods?.size
					? base.methods
					: srcType.methods || base.methods
				: srcType.kind === "named"
					? srcType.methods
					: null;
		if (!methodMap) return false;
		for (const [name, required] of iface.methods) {
			const actual = methodMap.get(name);
			if (!actual) return false;
			if (!isPtr && actual._ptrRecv) return false;
			if (!this._implementsMethod(required, actual)) return false;
		}
		return true;
	},
};
