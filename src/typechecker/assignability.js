// Assignability, binary result types, and interface satisfaction.
// Installed as a mixin on TypeChecker.prototype.

import { constIntValue, floatConstOf, realOfConst } from "./const-fold.js";
import { constValueText, exprText, operandKind } from "./operand-text.js";
import { operandKindOf, operatorDefined } from "./operators.js";
import { sharedInfo } from "./stdlib/shared.js";
import {
	ANY,
	anyKind,
	BOOL,
	CMP_OPS,
	defaultType,
	FLOAT64,
	identical,
	is64BitInt,
	isAny,
	isBool,
	isComplex,
	isComplex64,
	isComplexOrNumeric,
	isFloat,
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
	TAINTED_ANY,
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
	"namespace",
]);

// Operand kinds Go names in a comparison error (`not defined on struct`);
// any other operand is named by its type.
const CMP_KIND_NAMES = new Set([
	"pointer",
	"struct",
	"array",
	"slice",
	"map",
	"func",
	"chan",
	"interface",
]);

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
	complex128: new Set([
		...SIZED_INT_NAMES,
		...SIZED_FLOAT_NAMES,
		"complex128",
		"complex64",
	]),
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
			if (!this._checkLogicalOperands(lt, rt, node)) return TAINTED_ANY;
			return logicalResultType(lt, rt);
		}
		return this._binaryResultTypeNonComplex(op, lt, rt, node);
	},

	// `&&` and `||` need boolean operands of one type: `B && bool` mixes two
	// distinct bool types, `1 && 2` and `x || x` with an `int` have no boolean.
	// Returns false after reporting.
	_checkLogicalOperands(lt, rt, node) {
		if (!node) return true;
		if (!this.convertUntyped(lt, rt, node)) return false;
		if (!this._checkIdenticalOperands(lt, rt, node)) return false;
		return this._checkOperatorDefined(node.op, lt, rt, node);
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
		// A shift has its left operand's type: `1 << s` stays an untyped
		// integer that its context types, never the count's type.
		if (isShift)
			return !node || this._isShiftableUntyped(lt, node.left)
				? lt
				: TAINTED_ANY;
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
	_convertUntypedToTypeParam(
		tp,
		c,
		cNode,
		node,
		report = this._reportMismatch,
	) {
		const [lt, rt] = node.left === cNode ? [c, tp] : [tp, c];
		const cls = untypedClass(c);
		const all = (pred) =>
			this._typeParamAllows(tp, (t) => pred(this._deepUnderlying(t) ?? t));
		if (
			all(isComplexOrNumeric) !== (cls === "number") ||
			all(isBool) !== (cls === "bool") ||
			all(isString) !== (cls === "string")
		) {
			report.call(this, lt, rt, node);
			return false;
		}
		const terms = this._constraintTerms(tp.constraint, new Set()) ?? [];
		if (terms.every((t) => this._untypedFitsTerm(c, cNode, t))) {
			this._realizeForRealTerms(cNode, terms);
			return true;
		}
		this.err(
			`cannot convert ${this._untypedConstText(c, cNode)} to type ${typeStr(tp)}`,
			cNode,
		);
		return false;
	},

	// Whether untyped constant `c` converts to `term` of a type set: a complex
	// constant needs a complex type and a known value must be representable.
	// An integral complex constant meeting a type set of real types is its
	// real part (`T ~int | ~float64`, `a + (1 + 0i)`).
	_realizeForRealTerms(cNode, terms) {
		if (!cNode?._cconst) return;
		if (terms.some((t) => isComplex(this._deepUnderlying(t) ?? t))) return;
		const re = realOfConst(cNode._cconst);
		if (re) this._realizeComplexNode(cNode, re);
	},

	_untypedFitsTerm(c, cNode, term) {
		const u = this._deepUnderlying(term) ?? term;
		const v = cNode?._cconst ?? cNode?._const;
		if (!v || u?.kind !== "basic")
			return c.base !== "complex128" || isComplex(u);
		return this._constFitsType(v, u);
	},

	// `1.5 (untyped float constant)`, `half (untyped float constant 0.5)`: Go
	// adds the value when the operand's text is not the value itself (see
	// `operandKind`).
	_untypedConstText(c, cNode) {
		const base = c.rune ? "rune" : c.base === "complex128" ? "complex" : c.base;
		return `${exprText(cNode)} (${operandKind(cNode, base, true)})`;
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
		const left = lt?.kind === "typeParam";
		if (isShift && !left) {
			if (this._checkShiftedOperand(lt, node.left))
				this._checkTypeParamShiftCount(rt, node);
			return;
		}
		const tp = left ? lt : rt;
		const operand = left ? node.left : node.right;
		if (isShift) {
			// The shifted operand first: a bad operand with a bad count
			// reports once.
			if (!this._operatorDefined(op, tp)) {
				this.err(
					`invalid operation: shifted operand ${exprText(operand)} (${operandKind(operand, typeStr(tp), false)} constrained by ${this._constraintText(tp)}) must be integer`,
					operand,
				);
				return;
			}
			this._checkTypeParamShiftCount(rt, node);
			return;
		}
		if (this._operatorDefined(op, tp)) return;
		if (CMP_OPS.has(op))
			this.err(
				`invalid operation: ${exprText(node)} (type parameter ${typeStr(tp)} cannot use operator ${op})`,
				node,
			);
		else this._reportOperatorUndefined(op, tp, operand);
	},

	// Whether operator `op` (the one-operand form when `unary`) is defined on
	// operands of type `t`: the operand-kind table of `operators.js`, with a
	// type parameter's type set read from its constraint.
	_operatorDefined(op, t, unary = false) {
		return operatorDefined(op, t, {
			unary,
			under: (u) => this._deepUnderlying(u),
			terms: (tp) => this._constraintTerms(tp.constraint, new Set()),
		});
	},

	// Go's `operator OP not defined on X (KIND)`, the one report of an
	// operator the operand's type does not have.
	_reportOperatorUndefined(op, t, operand) {
		let what;
		if (isNil(t)) what = "nil";
		else if (t?.kind === "untyped") what = this._untypedConstText(t, operand);
		else if (t?.kind === "typeParam")
			what = `${exprText(operand)} (${operandKind(operand, typeStr(t), false)} constrained by ${this._constraintText(t)})`;
		else
			what = `${exprText(operand)} (${operandKind(operand, typeStr(t), false)})`;
		this.err(
			`invalid operation: operator ${op} not defined on ${what}`,
			operand,
		);
	},

	// The binary operator `node.op` on operands that already match: the typed
	// operand decides, two untyped constants the first operand the operator
	// rejects (`5.5 % 2.0`, `true + true`). Reports and returns false.
	_checkOperatorDefined(op, lt, rt, node) {
		if (!node) return true;
		const operands = [
			[lt, node.left],
			[rt, node.right],
		];
		const typed = operands.find(([t]) => t.kind !== "untyped");
		const bad = (typed ? [typed] : operands).find(
			([t]) => !this._operatorDefined(op, t),
		);
		if (!bad) return true;
		this._reportOperatorUndefined(op, bad[0], bad[1]);
		return false;
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
			if (t?.kind !== "typeParam" || this._isComparable(t)) continue;
			const empty =
				this._constraintTerms(t.constraint, new Set())?.length === 0;
			this.err(
				`invalid operation: ${exprText(node)} (${empty ? "empty type set" : "incomparable types in type set"})`,
				operand,
			);
			return;
		}
	},

	_constraintText(tp) {
		const c = tp.constraint;
		if (!c || isAny(c)) return "any";
		if (c.kind === "TypeName") return c.name;
		try {
			// An inline union (`[T ~bool | ~int]`) keeps its terms as AST nodes.
			if (c.kind === "UnionConstraint")
				return c.terms
					.map(
						(t) =>
							`${t.approx ? "~" : ""}${typeStr(t.resolved ?? this.resolveTypeNode(t.type, c._scope ?? this.globals))}`,
					)
					.join(" | ");
			return typeStr(c);
		} catch {
			return "its constraint";
		}
	},

	_binaryResultTypeNonComplex(op, lt, rt, node) {
		if (isAny(lt) || isAny(rt)) return ANY;
		if (op === "<<" || op === ">>")
			return this._binaryResultTypeShift(op, lt, rt, node);
		if (isComplex(lt) || isComplex(rt))
			return this._binaryResultTypeComplex(op, lt, rt, node);
		if (isNumeric(lt) && isNumeric(rt))
			return this._binaryResultTypeNumeric(op, lt, rt, node);
		if (isString(lt) && isString(rt))
			return this._binaryResultTypeString(op, lt, rt, node);
		return this._binaryResultTypeOther(op, lt, rt, node);
	},

	// Operands no arithmetic rule above takes (`b + b`, `p - p`, `1 + "a"`):
	// the operands must still match before the operator is judged, so Go
	// reports a mismatch where the types differ and the operator where they
	// are one type it is not defined on.
	_binaryResultTypeOther(op, lt, rt, node) {
		if (!node) return ANY;
		if (!this.convertUntyped(lt, rt, node)) return ANY;
		if (!this._checkIdenticalOperands(lt, rt, node)) return ANY;
		this._checkOperatorDefined(op, lt, rt, node);
		return ANY;
	},

	// A shift has the type of its left operand; the count may be any integer
	// type or an untyped constant representable as uint.
	_binaryResultTypeShift(_op, lt, rt, node) {
		if (!node) return lt;
		// The operand first: a bad operand with a bad count reports once.
		const operandOk = this._checkShiftedOperand(lt, node.left);
		if (operandOk) this.checkShiftCount(rt, node.right);
		// `"a" << s` was reported: the result has no type to check further.
		if (!this._isShiftableUntyped(lt, node.left)) return TAINTED_ANY;
		// A constant shift of an untyped constant is an untyped integer.
		const nonInteger = lt?.base === "complex128" || lt?.base === "float64";
		return nonInteger && this._constValue(node) ? UNTYPED_INT : lt;
	},

	// The shifted operand of a shift whose operand is not a type parameter: an
	// integer, or an untyped constant representable as an integer (`1.0 << s`
	// is valid, `1.5 << s` and `"a" << s` are not). An imaginary constant has
	// no tracked value and is left alone.
	// Returns whether the operand is valid.
	_checkShiftedOperand(lt, left) {
		if (lt?.kind !== "untyped") {
			if (isInteger(lt)) return true;
			this.err(
				`invalid operation: shifted operand ${exprText(left)} (${operandKind(left, typeStr(lt), false)}) must be integer`,
				left,
			);
			return false;
		}
		if (this._isShiftableUntyped(lt, left)) return true;
		this.err(
			`invalid operation: shifted operand ${this._untypedConstText(lt, left)} must be integer`,
			left,
		);
		return false;
	},

	_isShiftableUntyped(lt, left) {
		if (lt?.kind !== "untyped" || isNil(lt)) return true;
		// An imaginary constant is shiftable when it is integral (`1 + 0i`).
		if (lt.base === "complex128")
			return constIntValue(left?._cconst ?? left?._const) !== null;
		const v = left?._const;
		return (
			lt.base === "int" ||
			(lt.base === "float64" && (!v || constIntValue(v) !== null))
		);
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
			} else if (rt?.kind === "untyped" && rt.base !== "int") {
				// `x << 1.0`, `x << (1 + 0i)`: the count is converted to an integer
				// constant.
				if (countExpr._cconst)
					this._realizeComplexNode(countExpr, floatConstOf(Number(n)));
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
	_binaryResultTypeString(op, lt, rt, node) {
		if (!this._checkIdenticalOperands(lt, rt, node)) return lt;
		if (!this._checkOperatorDefined(op, lt, rt, node)) return ANY;
		if (lt.kind === "untyped" && rt.kind === "untyped") return lt;
		if (lt.kind === "untyped") return rt;
		return lt;
	},

	_binaryResultTypeCmp(op, lt, rt, node) {
		if (node && !this._checkComparison(op, lt, rt, node)) return TAINTED_ANY;
		if (node) this._markComparedAggregate(op, lt, rt, node);
		// A comparison is an untyped bool: it also fits a defined bool type.
		return UNTYPED_BOOL;
	},

	_binaryResultTypeComplex(op, lt, rt, node) {
		if (!isComplexOrNumeric(lt) || !isComplexOrNumeric(rt)) {
			if (node) this._reportMismatch(lt, rt, node);
			return ANY;
		}
		const bothUntyped = lt.kind === "untyped" && rt.kind === "untyped";
		if (!bothUntyped && node && !this.convertUntyped(lt, rt, node)) return ANY;
		if (!this._checkIdenticalOperands(lt, rt, node)) return lt;
		if (!this._checkOperatorDefined(op, lt, rt, node)) return ANY;
		if (bothUntyped) return UNTYPED_COMPLEX;
		return lt.kind === "untyped" ? rt : lt;
	},

	_binaryResultTypeNumeric(op, lt, rt, node) {
		if (!this._checkIdenticalOperands(lt, rt, node)) return lt;
		if (!this._checkOperatorDefined(op, lt, rt, node)) return TAINTED_ANY;
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

	// `v + 1` with `v` a Go `any`: the left operand is reported first, in
	// Go's words for the operator: a shift names its operand or count, an
	// ordering operator names `interface`, two operands of one type (or a
	// JS-dynamic one, which adapts to either side) name the operator, and any
	// other pair is a mismatch.
	_checkDeclaredAnyBinary(op, lt, rt, node) {
		if (op === "==" || op === "!=") return null;
		const leftAny = anyKind(lt) === "go";
		if (!leftAny && anyKind(rt) !== "go") return null;
		const [bad, type] = leftAny ? [node.left, lt] : [node.right, rt];
		const kind = `${exprText(bad)} (${operandKind(bad, typeStr(type))})`;
		let what;
		if (op === "<<" || op === ">>")
			what = `${leftAny ? "shifted operand" : "shift count"} ${kind} must be integer`;
		else if (CMP_OPS.has(op))
			what = `${exprText(node)} (operator ${op} not defined on interface)`;
		else if (identical(lt, rt) || anyKind(leftAny ? rt : lt) === "dynamic")
			what = `operator ${op} not defined on ${kind}`;
		else
			what = `${exprText(node)} (mismatched types ${this._mismatchTypeStr(lt)} and ${this._mismatchTypeStr(rt)})`;
		return this.err(`invalid operation: ${what}`, bad);
	},

	// An untyped string or bool meeting an interface operand has already taken
	// its default type in Go's message (`any and string`); a number stays untyped.
	_mismatchTypeStr(t) {
		if (t?.kind === "untyped" && (t.base === "string" || t.base === "bool"))
			return t.base;
		return this._operandTypeStr(t);
	},

	// The comparison rule (spec *Comparison operators*) for every operand
	// kind: an untyped constant or `nil` converts to the other operand's type
	// (`convertUntyped`), then one operand must be assignable to the other's
	// type (`float64 == int`, `Celsius == Fahrenheit` and `i == p` for a `p`
	// that does not implement `i` are mismatches), and the operator must be
	// defined on that type. Reports the first failure only and returns false;
	// JS-dynamic and recovered operands adapt to either side.
	_checkComparison(op, lt, rt, node) {
		if (!this.convertUntyped(lt, rt, node)) return false;
		if (!this._comparisonTypesMatch(lt, rt, node)) return false;
		const isEquality = op === "==" || op === "!=";
		// Any nil-able operand compares with `nil`.
		if (isEquality && (isNil(lt) || isNil(rt))) return true;
		for (const t of this._comparedTypes(lt, rt)) {
			if (this._operatorDefined(op, t)) continue;
			this._reportCmpUndefined(op, t, node, isEquality);
			return false;
		}
		return !isEquality || this._comparableOperands(lt, rt, node);
	},

	// `==` on a struct or array needs comparable fields or elements: Go names
	// the first field type that is not comparable, or the array type itself.
	_comparableOperands(lt, rt, node) {
		for (const [t, operand] of [
			[lt, node.left],
			[rt, node.right],
		]) {
			if (!t || t._tainted || t.kind === "untyped") continue;
			const u = this._deepUnderlying(t);
			if (!["struct", "array"].includes(u?.kind) || this._isComparable(t))
				continue;
			const bad =
				u.kind === "struct"
					? [
							...(u._structFields
								? u._structFields.map((f) => f.type)
								: (u.fields?.values() ?? [])),
						].find((f) => !this._isComparable(f))
					: null;
			this.err(
				`invalid operation: ${exprText(node)} (${bad ? `struct containing ${typeStr(bad)}` : typeStr(t)} cannot be compared)`,
				operand,
			);
			return false;
		}
		return true;
	},

	// A struct or array compared with an interface enters it as in an
	// assignment, so codegen boxes it with its dynamic type.
	_markComparedAggregate(op, lt, rt, node) {
		if (op !== "==" && op !== "!=") return;
		const isAgg = (t) =>
			["struct", "array"].includes(
				this.resolveType(this._deepUnderlying(t))?.kind,
			);
		const isIface = (t) =>
			t?.kind !== "untyped" &&
			(isAny(t) ||
				this.resolveType(this._deepUnderlying(t))?.kind === "interface");
		if (isIface(lt) && isAgg(rt)) this._markIfaceBox(lt, rt, node.right);
		else if (isIface(rt) && isAgg(lt)) this._markIfaceBox(rt, lt, node.left);
	},

	// The types an operator is judged on: an untyped complex constant that
	// converted to a real number type (`1 + 0i < n`) has that type.
	_comparedTypes(lt, rt) {
		const real = (t) => (this._isRealBasic(t) ? t : null);
		const asReal = (t, other) =>
			t?.kind === "untyped" && t.base === "complex128" ? (real(other) ?? t) : t;
		return [asReal(lt, rt), asReal(rt, lt)];
	},

	_isRealBasic(t) {
		const u = t?.kind === "untyped" ? null : this._deepUnderlying(t);
		return u?.kind === "basic" && isNumeric(u) && !isComplex(u);
	},

	_comparisonTypesMatch(lt, rt, node) {
		for (const t of [lt, rt])
			if (!t || t.kind === "untyped" || isNil(t) || anyKind(t) === "dynamic")
				return true;
		if (lt._tainted || rt._tainted || identical(lt, rt)) return true;
		if (this._assignableQuietly(lt, rt) || this._assignableQuietly(rt, lt))
			return true;
		// A defined type and a type literal of its underlying type are
		// assignable in Go even where a value copy would need `T(v)`.
		const [lu, ru] = [lt, rt].map((t) =>
			this.resolveType(this._deepUnderlying(t)),
		);
		if (this._identicalUnderlyingLiteral(lt, rt, lu, ru)) return true;
		this._reportMismatch(lt, rt, node);
		return false;
	},

	// `invalid operation: a < b (operator < not defined on struct)`; a slice,
	// map or func is comparable only to `nil`.
	_reportCmpUndefined(op, t, node, isEquality) {
		const kind = operandKindOf(t, (u) => this._deepUnderlying(u));
		const what =
			isEquality && (kind === "slice" || kind === "map" || kind === "func")
				? `${kind} can only be compared to nil`
				: `operator ${op} not defined on ${CMP_KIND_NAMES.has(kind) ? kind : this._operandTypeStr(t)}`;
		return this.err(`invalid operation: ${exprText(node)} (${what})`, node);
	},

	// The one conversion step for an untyped constant or `nil` operand of the
	// binary expression `node`: it takes the other operand's type, and the
	// kind must fit (`string == 'a'`, `int == nil`, `float64 + 1i`). Reports
	// and returns false on a mismatch; true when nothing is wrong or there is
	// nothing to convert.
	convertUntyped(lt, rt, node, report = this._reportMismatch) {
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
			return this._convertUntypedConst(rt, lt, node.left, lt, rt, node, report);
		else if (rt?.kind === "untyped" && lt?.kind !== "untyped")
			return this._convertUntypedConst(
				lt,
				rt,
				node.right,
				lt,
				rt,
				node,
				report,
			);
		if (!fits) report.call(this, lt, rt, node);
		return fits;
	},

	// `nil` converts to no constant, and not to a type without a nil value.
	_nilMismatch(other) {
		if (other?.kind === "untyped") return true;
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
	_convertUntypedConst(
		typed,
		untyped,
		untypedNode,
		lt,
		rt,
		node,
		report = this._reportMismatch,
	) {
		const u = this._deepUnderlying(typed);
		if (!u || typed._tainted || typed.kind === "typeParam") return true;
		if (u.kind === "interface" && u.methods?.size > 0)
			return this._convertUntypedToInterface(
				u,
				untyped,
				untypedNode,
				[lt, rt, node],
				report,
			);
		let fits = !CONST_REJECTING_KINDS.has(u.kind);
		if (u.kind === "basic") {
			if (NIL_LOOSE_BASICS.has(u.name)) return true;
			if (u.name === "string") fits = untyped.base === "string";
			else if (u.name === "bool") fits = untyped.base === "bool";
			else fits = untyped.base !== "string" && untyped.base !== "bool";
		}
		if (!fits) report.call(this, lt, rt, node);
		return fits;
	},

	// An untyped constant meets an interface with methods: a basic value has
	// none, so no constant converts. Go reports a number as a type mismatch
	// and a string or bool as a failed conversion to the interface literal.
	_convertUntypedToInterface(u, untyped, untypedNode, operands, report) {
		if (untyped.base !== "string" && untyped.base !== "bool") {
			report.call(this, ...operands);
			return false;
		}
		this.err(
			`cannot convert ${this._untypedConstText(untyped, untypedNode)} to type ${this._interfaceLiteralText(u)}`,
			untypedNode,
		);
		return false;
	},

	// `interface{Error() string}`: an interface spelled as a literal.
	_interfaceLiteralText(u) {
		const methods = [...u.methods]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([name, m]) => {
				const ret = m.returns ?? [];
				const rets =
					ret.length === 0
						? ""
						: ret.length === 1
							? ` ${typeStr(ret[0])}`
							: ` (${ret.map(typeStr).join(", ")})`;
				return `${name}(${(m.params ?? []).map(typeStr).join(", ")})${rets}`;
			});
		return `interface{${methods.join("; ")}}`;
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
			(u?.kind === "basic" && !NIL_LOOSE_BASICS.has(u.name) && !u._nullable)
		);
	},

	// A typed value whose underlying type is a number, string or bool.
	_isTypedBasicOperand(t) {
		if (!t || t.kind === "untyped" || isAny(t) || isNil(t)) return false;
		const u = this._deepUnderlying(t);
		return u?.kind === "basic" && !isAny(u) && !isNil(u) && !isVoid(u);
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
		if (!isUntyped(source)) return;
		if (!isInteger(target)) {
			this._checkShiftContext(this._shiftHeldType(target, source), valueNode);
			return;
		}
		// Only a tree holding a non-constant shift is retyped.
		if (this._untypedShiftOperand(valueNode))
			this._retypeShiftTree(valueNode, target);
	},

	// The type an untyped shift operand takes in a context of type `target`:
	// an interface holds the operand's default type.
	_shiftHeldType(target, source) {
		return this._isInterfaceType(target) ? defaultType(source) : target;
	},

	_isInterfaceType(t) {
		if (!t || t.kind === "typeParam") return false;
		return isAny(t) || this._deepUnderlying(t)?.kind === "interface";
	},

	// The untyped operand of a non-constant shift takes its context's type,
	// which must be an integer (`var f float64 = 1 << s`). An interface or
	// other non-numeric context keeps the `int` default.
	_checkShiftContext(target, e) {
		if (target?.kind === "untyped") return;
		const tp = target?.kind === "typeParam";
		const r = tp ? target : this._deepUnderlying(target);
		if (!tp && !isFloat(r) && !isComplex(r)) return;
		if (tp) {
			// A constraint without a type set is left to the assignability error.
			const terms = this._constraintTerms(target.constraint, new Set());
			if (
				!terms?.length ||
				terms.every((t) => isInteger(this._deepUnderlying(t) ?? t))
			)
				return;
		}
		const left = this._untypedShiftOperand(e);
		if (!left) return;
		const where = tp ? ` constrained by ${this._constraintText(target)}` : "";
		this.err(
			`invalid operation: shifted operand ${exprText(left)} (type ${typeStr(target)}${where}) must be integer`,
			left,
		);
	},

	// The first untyped left operand of a non-constant shift in `e`.
	_untypedShiftOperand(e) {
		if (!e || typeof e !== "object" || e._type?.kind !== "untyped") return null;
		if (e.kind === "ParenExpr") return this._untypedShiftOperand(e.expr);
		if (e.kind === "UnaryExpr") return this._untypedShiftOperand(e.operand);
		if (e.kind !== "BinaryExpr" || this._constValue(e)) return null;
		if (e.op === "<<" || e.op === ">>")
			return e.left._type?.kind === "untyped" ? e.left : null;
		return (
			this._untypedShiftOperand(e.left) ?? this._untypedShiftOperand(e.right)
		);
	},

	_retypeShiftTree(e, target) {
		if (!e || typeof e !== "object" || e._type?.kind !== "untyped") return;
		if (e.kind === "ParenExpr") this._retypeShiftTree(e.expr, target);
		else if (e.kind === "UnaryExpr") this._retypeShiftTree(e.operand, target);
		else if (e.kind === "BinaryExpr" && !this._constValue(e)) {
			const isShift = e.op === "<<" || e.op === ">>";
			this._retypeShiftTree(e.left, target);
			if (isShift && e.left._type?.kind === "untyped") {
				this._retypeShiftOperand(e.left, target);
			} else if (!isShift) this._retypeShiftTree(e.right, target);
		} else return;
		if (this._constValue(e)) return;
		e._type = target;
		if (is64BitInt(target)) e._is64Bit = true;
	},

	// The untyped left operand of a non-constant shift takes `target`;
	// `(1 + 0i) << s` shifts the integer 1.
	_retypeShiftOperand(left, target) {
		// `var x int = 1e40 << s`: the constant must be an integer of that type.
		if (left._const) this._checkConstOverflow(target, left._type, left, null);
		if (left._cconst)
			this._realizeComplexNode(
				left,
				floatConstOf(Number(constIntValue(left._cconst))),
			);
		left._type = target;
		if (is64BitInt(target)) left._is64Bit = true;
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
		if (
			this._assertAssignableEarlyReturn(target, source, operand ?? at, ctx, at)
		)
			return;
		const mismatch = () =>
			this._assertAssignableTypeMismatch(
				target,
				source,
				at,
				operand ?? node,
				structCopy,
				ctx,
			);
		if (isPointer(target) && isPointer(source)) {
			this._assertNestedAssignable(
				target.base ?? target.underlying?.base,
				source.base ?? source.underlying?.base,
				mismatch,
			);
			return;
		}
		if (isUntyped(source) && this._isUntypedAssignable(target, source)) return;
		if (this._checkNumericCoercion(target, source, at, ctx, operand ?? at))
			return;
		if (this._checkArrayAssignable(target, source, at, mismatch)) return;
		if (this._checkTypedArrayAssignable(target, source, at, operand ?? at, ctx))
			return;
		if (this._checkFuncAssignable(target, source, mismatch)) return;
		this._checkNominalAssignable(target, source, operand ?? node, mismatch);
	},

	// Identical types, a `.d.ts` interface whose chain of `extends` reaches
	// the target, or a value a `.d.ts` dictionary takes; anything else is a
	// mismatch.
	_checkNominalAssignable(target, source, operand, mismatch) {
		if (identical(target, source) || this._dtsDerivesFrom(source, target))
			return;
		if (!this._checkDtsDictionary(target, source, operand)) mismatch();
	},

	// A `.d.ts` dictionary (see src/dts-parser.js) takes a `map[string]any`
	// literal and a field-only struct whose names are its members. Returns
	// false when `source` is neither, else checks the members (reporting
	// what is wrong) and returns true.
	_checkDtsDictionary(target, source, operand) {
		if (!target?._dictionary) return false;
		const src = this.resolveType(this._deepUnderlying(source));
		let lit = operand;
		while (lit?.kind === "ParenExpr") lit = lit.expr;
		if (src?.kind === "map" && lit?.kind === "CompositeLit") {
			this._checkDictionaryLiteral(target, lit);
			return true;
		}
		if (src?.kind === "struct" && !this._structHasMethods(source)) {
			this._checkDictionaryStruct(target, src, operand);
			return true;
		}
		return false;
	},

	_structHasMethods(t) {
		return t?.kind === "named" && (t.methods?.size ?? 0) > 0;
	},

	// The type of the member `name` of dictionary `dict`, its own or
	// inherited; undefined when it has none.
	_dictionaryMember(dict, name) {
		if (Object.hasOwn(dict.members, name)) return dict.members[name];
		return this._dtsInheritedMember(dict, name);
	},

	_checkDictionaryLiteral(dict, lit) {
		for (const elem of lit.elems) {
			if (elem.kind !== "KeyValueExpr") continue;
			const key = elem.key._const;
			if (typeof key?.v !== "string") {
				this.err("dictionary key must be a constant string", elem.key);
				continue;
			}
			const memberType = this._dictionaryMember(dict, key.v);
			if (memberType === undefined) {
				this.err(
					`unknown member '${key.v}' in dictionary ${typeStr(dict)}`,
					elem.key,
				);
				continue;
			}
			this.assertAssignable(
				memberType,
				elem.value._type,
				elem.value,
				`member ${key.v} of dictionary ${typeStr(dict)}`,
			);
		}
	},

	_checkDictionaryStruct(dict, struct, operand) {
		for (const [name, fieldType] of struct.fields ?? []) {
			const memberType = this._dictionaryMember(dict, name);
			if (memberType === undefined) {
				this.err(
					`unknown field '${name}' in dictionary ${typeStr(dict)}`,
					operand,
				);
				continue;
			}
			if (!this._assignableQuietly(memberType, fieldType))
				this.err(
					`cannot use field '${name}' (type ${typeStr(fieldType)}) as ${typeStr(this.resolveType(memberType))} in dictionary ${typeStr(dict)}`,
					operand,
				);
		}
	},

	// The element of an array or the base of a pointer must be identical to
	// the target's (spec *Assignability*: the two types are identical, or
	// share an underlying type with one of them unnamed, which is a property
	// of the whole type). A struct type and a defined type over an identical
	// struct are not interchangeable there either, since the two do not share
	// a representation. `mismatch` reports the whole-type mismatch.
	_assertNestedAssignable(target, source, mismatch) {
		const t = this.resolveType(target);
		const s = this.resolveType(source);
		if (!t || !s || t._tainted || s._tainted) return;
		// JS-dynamic `any` stays unchecked.
		if (anyKind(t) === "dynamic" || anyKind(s) === "dynamic") return;
		if (!identical(t, s)) mismatch();
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
		// An `any` the generated Web API declarations spell (`console.log`'s
		// argument, `setTimeout`'s handler) hands the value to the browser as
		// it is, never as a Go interface value.
		if (target._hostAny) return;
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
		this._convertError(
			expr,
			operand,
			srcType,
			targetType,
			": need type assertion",
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
	_checkNilTarget(target, at, ctx) {
		if (this._isNilless(target))
			this.err(`cannot use nil as ${typeStr(target)} value in ${ctx}`, at);
	},

	// `node` is the operand whose value flows in; `at` is where an error is
	// reported (an operand with no position of its own, like a range value,
	// still reports at the statement).
	_assertAssignableEarlyReturn(target, source, node, ctx, at = node) {
		if (isNil(source)) this._checkNilTarget(target, at, ctx);
		if (target?.kind === "typeParam" || source?.kind === "typeParam") {
			if (!isNil(source) && !this._typeParamAssignable(target, source, node))
				this._reportTypeParamAssign(target, source, node, ctx, at);
			return true;
		}
		return isAny(target) || isAny(source) || isNil(source);
	},

	// Whether a value of `source` is assignable where `target` is wanted, one
	// of them being a type parameter (Go's assignability: identical types, an
	// untyped constant every type of the type set represents, a value of a
	// type parameter to an unnamed type or an interface its type set
	// satisfies, or a value to a type parameter every type of whose set takes
	// it). JS-dynamic `any` stays unchecked.
	_typeParamAssignable(target, source, node) {
		if (identical(target, source)) return true;
		if (anyKind(source) !== "go" && isAny(source)) return true;
		if (source._tainted || target._tainted) return true;
		if (target.kind === "typeParam")
			return this._toTypeParamOk(target, source, node);
		return this._fromTypeParamOk(target, source);
	},

	_toTypeParamOk(target, source, node) {
		const terms = this._constraintTerms(target.constraint, new Set());
		if (!terms || terms.length === 0) return false;
		if (source.kind === "untyped") {
			const fits = terms.every((t) => this._untypedFitsKind(source, node, t));
			if (fits) this._realizeForRealTerms(node, terms);
			return fits;
		}
		if (source.kind === "typeParam" || this._isNamedType(source)) return false;
		return terms.every((t) => this._assignableQuietly(t, source));
	},

	// Whether untyped constant `source` converts to `term`: same kind (number,
	// bool, string) and, for a known value, representable.
	_untypedFitsKind(source, node, term) {
		const u = this._deepUnderlying(term) ?? term;
		const cls = untypedClass(source);
		const kindOk =
			cls === "number"
				? isComplexOrNumeric(u)
				: cls === "bool"
					? isBool(u)
					: isString(u);
		return kindOk && this._untypedFitsTerm(source, node, term);
	},

	_fromTypeParamOk(target, source) {
		if (isAny(target)) return true;
		const base = this.resolveType(this._deepUnderlying(target));
		if (base?.kind === "interface") {
			if (base.methods.size === 0) return true;
			const c = this._typeParamConstraintIface(source);
			return !!c && this.implements(c, base, null);
		}
		if (this._isNamedType(target)) return false;
		const terms = this._constraintTerms(source.constraint, new Set());
		if (!terms || terms.length === 0) return false;
		return terms.every((t) => this._assignableQuietly(target, t));
	},

	// Whether `t` is a defined type: a named type or a predeclared basic type.
	// A type parameter is not (it is checked on its own).
	_isNamedType(t) {
		return t.kind === "named" || t.kind === "basic" || isAny(t);
	},

	// The interface a type parameter's constraint spells, or null.
	_typeParamConstraintIface(tp) {
		let c = tp.constraint;
		if (c && !c.kind) return null;
		if (
			c?.kind === "TypeName" ||
			c?.kind === "InterfaceType" ||
			c?.kind === "GenericTypeName" ||
			c?.kind === "InstantiationExpr" ||
			c?.kind === "IndexExpr"
		)
			c = this.resolveTypeNode(c, this.globals);
		const u = this.resolveType(this._deepUnderlying(c));
		return u?.kind === "interface" ? u : null;
	},

	_reportTypeParamAssign(target, source, node, ctx, at = node) {
		let what;
		if (source.kind === "untyped") {
			const cmp = node?.kind === "BinaryExpr" && CMP_OPS.has(node.op);
			what = cmp ? "untyped bool value" : operandKind(node, source.base, true);
		} else {
			const named =
				source.kind === "typeParam"
					? `${typeStr(source)} constrained by ${this._constraintText(source)}`
					: typeStr(source);
			what = operandKind(node, named, false);
		}
		this.err(
			`cannot use ${exprText(node)} (${what}) as ${typeStr(target)} value in ${ctx}`,
			at,
		);
	},

	// The one report of a value that is not assignable, as Go words it: `cannot
	// use x (variable of type T) as U value in <ctx>`. `operand` is the
	// expression whose value flows in (a forwarded call result has the call);
	// `node` is where the error is reported.
	_assignError(source, target, operand, ctx, node, hint) {
		const what = isUntyped(source)
			? operandKind(operand, source.base, true)
			: operandKind(operand, typeStr(source), false);
		this.err(
			`cannot use ${exprText(operand)} (${what}) as ${typeStr(target)} value in ${ctx}`,
			node,
			hint,
		);
	},

	_assertAssignableTypeMismatch(
		target,
		source,
		node,
		operand = node,
		structCopy = false,
		ctx = "assignment",
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
		this._assignError(
			source,
			target,
			operand ?? node,
			ctx,
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
		this._assignError(source, target, operand, ctx, node);
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

	_checkArrayAssignable(target, source, node, mismatch) {
		if (target.kind === "array" && source.kind === "array") {
			if (
				target.size != null &&
				source.size != null &&
				target.size !== source.size
			)
				mismatch();
			else this._assertNestedAssignable(target.elem, source.elem, mismatch);
			return true;
		}
		if (
			(target.kind === "array" && source.kind === "slice") ||
			(target.kind === "slice" && source.kind === "array")
		) {
			mismatch();
			return true;
		}
		return false;
	},

	_checkTypedArrayAssignable(target, source, node, operand, ctx) {
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
			this._assignError(source, target, operand, ctx, node);
			return true;
		}

		if (targetTa && sourceTa) {
			const tElem = target.underlying?._elemType ?? target._elemType;
			const sElem = source.underlying?._elemType ?? source._elemType;
			if (identical(tElem, sElem)) return true;
			this._assignError(source, target, operand, ctx, node);
			return true;
		}

		return false;
	},

	_checkFuncAssignable(target, source, mismatch) {
		const tFunc = this._deepUnderlying(target);
		const sFunc = this._deepUnderlying(source);
		if (tFunc?.kind === "func" && sFunc?.kind === "func") {
			const ok = tFunc._dts
				? this._dtsCallbackOk(tFunc, sFunc)
				: this._implementsMethod(tFunc, sFunc);
			if (!ok) mismatch();
			return true;
		}
		return false;
	},

	// Whether a Go func `source` may be passed where the `.d.ts` callback type
	// `target` is wanted. JavaScript calls it with the target's arguments and
	// ignores what it does not take, so `source` may take fewer parameters and
	// may return nothing where the callback's result is `void`, `undefined`,
	// `any`, nullable or a `Promise<void>`.
	_dtsCallbackOk(target, source) {
		const tp = target.params ?? [];
		const sp = source.params ?? [];
		if (sp.length > tp.length && !target.variadic) return false;
		for (const [i, s] of sp.entries()) {
			const t = tp[Math.min(i, tp.length - 1)];
			if (!this._dtsCallbackParamOk(t, s)) return false;
		}
		return this._dtsCallbackResultOk(target, source);
	},

	// A parameter the callback's caller passes as `t` and `source` takes as
	// `s`: the same type, a `.d.ts` interface on the same `extends` chain (so
	// `func(e MouseEvent)` serves an `Event` callback), or `any` on either
	// side.
	_dtsCallbackParamOk(t, s) {
		const target = this.resolveType(t);
		const source = this.resolveType(s);
		if (isAny(target) || isAny(source) || identical(target, source))
			return true;
		return (
			this._dtsDerivesFrom(source, target) ||
			this._dtsDerivesFrom(target, source)
		);
	},

	_dtsCallbackResultOk(target, source) {
		const results = (f) =>
			this._unpackReturns(f.returns ?? []).filter(
				(r) => r && !isVoid(r) && !isNil(r),
			);
		const want = results(target);
		const got = results(source);
		if (want.length === 0) return true;
		if (got.length === 0) return want.every((t) => this._mayReturnNothing(t));
		return (
			want.length === got.length &&
			want.every((t, i) =>
				this._assignableQuietly(this._awaitedType(t), got[i]),
			)
		);
	},

	// Whether a callback result of type `t` may be left out: JavaScript yields
	// `undefined`, which `any`, a nullable type and `Promise<void>` hold.
	_mayReturnNothing(t) {
		if (isAny(t) || t._nullable) return true;
		return t.kind === "promise" && isVoid(this._awaitedType(t));
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
