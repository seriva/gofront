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
	MATH_INT_CONSTS,
} from "./const-fold.js";
import { defaultType, isAny, typeStr, VOID } from "./types.js";

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

/** @type {ThisType<import('./index.js').TypeChecker>} */
export const constantCheckMethods = {
	// The value of a constant expression, or null when `expr` is not one (or
	// is an overflowing or erroneous one).
	_constValue(expr, scope = null) {
		const raw = this._constRaw(expr, scope ?? this.globals);
		return raw && !raw.overflow && !raw.error ? raw : null;
	},

	// Integer value of an integer (or untyped integral float) constant as a
	// Number, or null.
	_constIntValue(expr, scope = null) {
		const v = this._constValue(expr, scope);
		if (!v || (v.k === "FLOAT" && v.t)) return null;
		const i = constIntValue(v);
		return i === null ? null : Number(i);
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
		const raw = this._constRaw(expr, scope);
		expr._const = raw && !raw.overflow && !raw.error ? raw : null;
		if (!raw || expr._constReported) return;
		if (raw.error) {
			expr._constReported = true;
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

	// `pkg.K` (an imported GoFront package) and the integer `math` constants.
	_evalConstSelector(expr, scope) {
		if (expr.expr?.kind !== "Ident") return null;
		const ns = scope.lookup(expr.expr.name);
		if (ns?.kind !== "namespace") return null;
		if (ns._gofront) return ns._consts?.get(expr.field) ?? null;
		const m = ns.name === "math" ? MATH_INT_CONSTS[expr.field] : undefined;
		return m === undefined ? null : intConst(m);
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
		const range = i === null ? null : this._intRange(target);
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
