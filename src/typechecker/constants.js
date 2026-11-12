// TypeChecker constant evaluation — installed as a mixin on TypeChecker.prototype.
//
// Every constant expression gets its exact value from the shared folder
// (src/typechecker/const-fold.js) and carries it on the AST node as `_const`, so
// both backends emit the same value.  Typed constant overflow and constant
// division by zero are reported here.

import {
	constFromLit,
	constIntValue,
	convertConst,
	foldBinary,
	foldMinMax,
	foldUnary,
	INT_RANGES,
	intConst,
} from "./const-fold.js";
import {
	defaultType,
	isAny,
	isComplex,
	isComplex64,
	isUntyped,
	typeStr,
	VOID,
} from "./types.js";

// Basic type names usable as conversion functions (`int32(x)`).
const BASIC_CONVERSIONS = new Set([
	...Object.keys(INT_RANGES),
	"float32",
	"float64",
	"string",
	"bool",
]);

// Node kinds that can be constant expressions.
const CONST_KINDS = new Set([
	"BasicLit",
	"Ident",
	"ParenExpr",
	"UnaryExpr",
	"BinaryExpr",
	"CallExpr",
	"TypeConversion",
	"SelectorExpr",
]);

// Describes a constant that is not integer-valued (`float64 constant`), or
// null for an integer, an untyped float with an integer value, or a rune.
function nonIntegerConstKind(v) {
	if (v.k === "INT") return null;
	if (v.k === "FLOAT") {
		if (v.t) return `${v.t} constant`;
		return constIntValue(v) === null ? "untyped float constant" : null;
	}
	return `${v.k.toLowerCase()} constant`;
}

const NEGATIVE_SHIFT_ERROR = "invalid shift count: negative shift count";

/** @type {ThisType<import('./index.js').TypeChecker>} */
export const constantCheckMethods = {
	// The value of a constant expression, or null when `expr` is not one (or
	// is an overflowing or erroneous one).
	_constValue(expr, scope = null) {
		const raw = this._constRaw(expr, scope ?? this.globals);
		return raw && !raw.overflow && !raw.error ? raw : null;
	},

	// What makes `expr` a constant that cannot be an array length, index or
	// size (`untyped bool constant`, `untyped nil`), or null when it is an
	// integer constant or not a constant at all.
	_nonIntegerConst(expr, scope = null) {
		let e = expr;
		while (e?.kind === "ParenExpr") e = e.expr;
		if (e?.kind === "ImagLit") return "untyped complex constant";
		if (e?.kind === "BasicLit" && e.litKind === "NIL") return "untyped nil";
		let v = null;
		try {
			v = this._constValue(expr, scope);
		} catch {
			// not a constant the evaluator understands
		}
		return v ? nonIntegerConstKind(v) : null;
	},

	// Integer value of an integer (or untyped integral float) constant as a
	// Number, or null.
	_constIntValue(expr, scope = null) {
		const v = this._constValue(expr, scope);
		if (!v || (v.k === "FLOAT" && v.t)) return null;
		const i = constIntValue(v);
		return i === null ? null : Number(i);
	},

	// A named untyped complex constant has no folded value (`_const`): its
	// initializer goes on the identifier as `_complexInit`, so the backends
	// can fold it where it takes type complex64.
	// A named `complex64` constant is tagged `_c64Const` as well, so a use
	// takes float32 components as in Go.
	_noteComplexConstInit(expr, scope) {
		if (expr.kind !== "Ident") return;
		const typed64 = !isUntyped(expr._type) && isComplex64(expr._type);
		if (!typed64 && !(isUntyped(expr._type) && isComplex(expr._type))) return;
		const owner = scope.lookupScope(expr.name);
		if (!owner?._consts.has(expr.name)) return;
		const init = owner.lookupConstExpr(expr.name);
		if (!init) return;
		expr._complexInit = init;
		if (typed64) expr._c64Const = true;
	},

	// Raw evaluation result, memoized on checked nodes: a value, a value with
	// `overflow`, `{ error }`, or null.
	_constRaw(expr, scope) {
		if (!expr || typeof expr !== "object" || !CONST_KINDS.has(expr.kind))
			return null;
		if (expr._constRaw !== undefined) return expr._constRaw;
		if (expr._constBusy) return null; // cyclic constant
		expr._constBusy = true;
		let raw;
		try {
			raw = this._evalConst(expr, scope);
		} catch (err) {
			raw = { error: err.message };
		} finally {
			expr._constBusy = false;
		}
		// Conversions are only resolved once the node has been checked.
		if (expr._type !== undefined) expr._constRaw = raw;
		return raw;
	},

	// Called by checkExpr after typing `expr`: attaches `_const` and reports
	// overflow / division by zero once per node.
	_noteConst(expr, scope) {
		if (!CONST_KINDS.has(expr.kind)) return;
		this._noteComplexConstInit(expr, scope ?? this.globals);
		const raw = this._constRaw(expr, scope);
		expr._const = raw && !raw.overflow && !raw.error ? raw : null;
		if (!raw || expr._constReported) return;
		if (raw.error) {
			expr._constReported = true;
			// checkShiftCount already reports a negative count at its operand.
			if (raw.error === NEGATIVE_SHIFT_ERROR) return;
			this.err(raw.error, expr);
		} else if (raw.overflow) {
			expr._constReported = true;
			this.err(`constant ${raw.v} overflows ${raw.typeName ?? raw.t}`, expr);
		}
	},

	_evalConst(expr, scope) {
		switch (expr.kind) {
			case "BasicLit":
				return constFromLit(expr);
			case "ParenExpr":
				return this._constValue(expr.expr, scope);
			case "UnaryExpr": {
				const x = this._constValue(expr.operand, scope);
				return x ? foldUnary(expr.op, x) : null;
			}
			case "BinaryExpr": {
				const a = this._constValue(expr.left, scope);
				const b = a ? this._constValue(expr.right, scope) : null;
				return a && b ? foldBinary(expr.op, a, b) : null;
			}
			case "Ident":
				return this._evalConstIdent(expr, scope);
			case "SelectorExpr":
				return this._evalConstSelector(expr, scope);
			case "TypeConversion": {
				const v = this._constValue(expr.expr, scope);
				const target = v ? this.resolveTypeNode(expr.targetType, scope) : null;
				return target ? this._convertConstTo(v, target) : null;
			}
			default:
				return this._evalConstCall(expr, scope);
		}
	},

	_evalConstIdent(expr, scope) {
		const owner = scope.lookupScope(expr.name);
		if (!owner?._consts.has(expr.name)) return null;
		const init = owner.lookupConstExpr(expr.name);
		const v = init
			? this._constValue(init, owner)
			: (this._importedConsts?.get(expr.name) ?? null);
		if (!v) return null;
		const declared = owner.symbols.get(expr.name);
		if (!declared || declared.kind === "untyped" || declared.kind === "any")
			return v;
		const typed = this._convertConstTo(v, declared);
		return typed?.overflow ? null : typed;
	},

	// `pkg.K` of an imported GoFront package.
	_evalConstSelector(expr, scope) {
		if (expr.expr?.kind !== "Ident") return null;
		const ns = scope.lookup(expr.expr.name);
		if (ns?.kind !== "namespace") return null;
		return ns._gofront ? (ns._consts?.get(expr.field) ?? null) : null;
	},

	// Conversions, `len` of a constant string, and `min`/`max` of constants.
	_evalConstCall(expr, scope) {
		const target = this._constConversionTarget(expr, scope);
		if (target) {
			const v = this._constValue(expr.args[0], scope);
			return v ? this._convertConstTo(v, target) : null;
		}
		const fn = expr.func;
		if (fn?.kind !== "Ident" || scope.lookup(fn.name)?.kind !== "builtin")
			return null;
		const vals = (expr.args ?? []).map((a) => this._constValue(a, scope));
		if (vals.length === 0 || vals.some((v) => !v)) return null;
		if (fn.name === "min" || fn.name === "max")
			return foldMinMax(fn.name === "min", vals);
		// GoFront strings use UTF-16 code units on both backends.
		const isLen = fn.name === "len" && vals[0].k === "STRING";
		return isLen ? intConst(BigInt(vals[0].v.length)) : null;
	},

	// Target type of a conversion call (`MyInt(x)`, `int32(x)`), or null.
	_constConversionTarget(expr, scope) {
		if (expr.args?.length !== 1) return null;
		if (expr._isTypeConversion) return expr._conversionTargetType ?? null;
		const fn = expr.func;
		if (fn?.kind !== "Ident" || !BASIC_CONVERSIONS.has(fn.name)) return null;
		const owner = scope.lookupScope(fn.name);
		return !owner || owner === this.universe
			? { kind: "basic", name: fn.name }
			: null;
	},

	// Converts a constant to Go type `t` (basic or named over a basic type).
	_convertConstTo(v, t) {
		const u = this.resolveType(t?.kind === "named" ? t.underlying : t);
		if (u?.kind !== "basic") return null;
		const r = convertConst(v, u.name);
		return r?.overflow ? { ...r, typeName: typeStr(t) } : r;
	},

	// `var x int8 = 200`: an untyped integer constant must fit the target.  An
	// interface target takes the constant's default type (`var v any = 1 << 64`).
	// A null `ctx` reports an operand converted to the other operand's type.
	_checkConstOverflow(target, source, node, ctx) {
		if (source?.kind !== "untyped" || !node?._const) return false;
		const base = this.resolveType(
			target?.kind === "named" ? target.underlying : target,
		);
		if (base?.kind === "interface" || isAny(base)) target = defaultType(source);
		const i = constIntValue(node._const);
		const range = this._intRange(target);
		if (i === null && range)
			return this._reportTruncatedConst(target, node, ctx);
		// A float or complex target holds the constant as a Number: Go rounds
		// the same way, so the JS backend has nothing to warn about.
		if (!range && node.kind) {
			const u = this.resolveType(
				target?.kind === "named" ? target.underlying : target,
			);
			if (u?.kind === "basic" && /^(float|complex)/.test(u.name))
				node._floatConst = true;
		}
		if (!range) return false;
		if (i >= range[0] && i <= range[1]) {
			node._intConst = true; // the JS backend's precision warning reads this
			return false;
		}
		const isInt = node._const.k === "INT";
		const text = isInt ? String(i) : String(node._const.v);
		const what = `untyped ${isInt ? "int" : "float"} constant`;
		const shown =
			node.kind === "BasicLit"
				? `${node.value} (${what})`
				: `${text} (${what} ${text})`;
		this.err(
			ctx
				? `cannot use ${shown} as ${typeStr(target)} value in ${ctx} (overflows)`
				: `${shown} overflows ${typeStr(target)}`,
			node,
		);
		return true;
	},

	// `var i int = 1.5`: an untyped float constant with a fractional part
	// cannot become an integer.
	_reportTruncatedConst(target, node, ctx) {
		const c = node._const;
		if (c.k !== "FLOAT" || c.t) return false;
		const shown =
			node.kind === "BasicLit"
				? `${node.value} (untyped float constant)`
				: `${c.v} (untyped float constant ${c.v})`;
		this.err(
			ctx
				? `cannot use ${shown} as ${typeStr(target)} value in ${ctx} (truncated)`
				: `${shown} truncated to ${typeStr(target)}`,
			node,
		);
		return true;
	},

	// `x := 1 << 63`, `println(1 << 64)`: the constant takes its default type.
	_checkConstDefault(source, node, ctx) {
		return this._checkConstOverflow(defaultType(source), source, node, ctx);
	},

	// print/println arguments take their default type.
	_checkPrintArgs(name, expr, argTypes) {
		for (let i = 0; i < expr.args.length; i++)
			this._checkConstDefault(
				argTypes[i],
				expr.args[i],
				`argument to built-in ${name}`,
			);
		return VOID;
	},

	// `x + 300` with `x int8`: the untyped operand is converted to the other
	// operand's type.
	_checkConstOperands(op, lt, rt, expr) {
		if (op === "<<" || op === ">>" || op === "&&" || op === "||") return;
		if (rt?.kind === "untyped" && lt?.kind !== "untyped")
			this._checkConstOverflow(lt, rt, expr.right, null);
		else if (lt?.kind === "untyped" && rt?.kind !== "untyped")
			this._checkConstOverflow(rt, lt, expr.left, null);
	},

	_intRange(t) {
		const u = this.resolveType(t?.kind === "named" ? t.underlying : t);
		return u?.kind === "basic" ? (INT_RANGES[u.name] ?? null) : null;
	},
};
