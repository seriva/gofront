// TypeChecker expression-checking methods — installed as a mixin on TypeChecker.prototype.

import {
	ANY,
	BOOL,
	COMPLEX128,
	ERROR,
	FLOAT64,
	INT,
	isAny,
	isArray,
	isBool,
	isComplex,
	isComplexOrNumeric,
	isNumeric,
	isString,
	NIL,
	Scope,
	STRING,
	typeStr,
	UNTYPED_BOOL,
	UNTYPED_COMPLEX,
	UNTYPED_FLOAT,
	UNTYPED_INT,
	UNTYPED_STRING,
	VOID,
} from "./types.js";

// Dispatch table for builtin function type checking.
// Each value is (self, name, expr, argTypes, scope) => returnType.
const BUILTIN_CHECK = {
	len: (s, n, e, at) => s._checkBuiltinLen(n, e, at),
	cap: (s, n, e, at) => s._checkBuiltinLen(n, e, at),
	append: (s, _n, e, at) => {
		const st = at[0] ?? ANY;
		if (isArray(st)) {
			s.err(`cannot append to array (type ${typeStr(st)})`, e);
			return st;
		}
		return st;
	},
	copy: () => INT,
	delete: () => VOID,
	make: (s, _n, e, _at, sc) => {
		if (e.args.length < 1) return ANY;
		const ta = e.args[0];
		const tn = ta.kind === "TypeExpr" ? ta.type : ta;
		return s.resolveTypeNode(tn, sc) ?? ANY;
	},
	new: (s, _n, e, _at, sc) => {
		if (e.args.length < 1) return ANY;
		const inner = s.resolveTypeNode(e.args[0], sc);
		return { kind: "pointer", base: inner };
	},
	print: () => VOID,
	println: () => VOID,
	panic: () => VOID,
	recover: () => ANY,
	error: () => ERROR,
	min: (_s, _n, _e, at) => at[0] ?? ANY,
	max: (_s, _n, _e, at) => at[0] ?? ANY,
	clear: () => VOID,
	complex: (s, _n, e, at) => s._checkBuiltinComplex(e, at),
	real: (s, n, e, at) => s._checkBuiltinRealImag(n, e, at),
	imag: (s, n, e, at) => s._checkBuiltinRealImag(n, e, at),
};

// Method-name dispatch for _checkExpr — string values add no static call edges.
const CHECK_EXPR_DELEGATE = {
	UnaryExpr: "_checkUnaryExpr",
	CallExpr: "checkCall",
	SelectorExpr: "_checkSelectorExpr",
	IndexExpr: "_checkIndexExpr",
	SliceExpr: "_checkSliceExpr",
	CompositeLit: "checkCompositeLit",
	FuncLit: "_checkFuncLit",
	TypeConversion: "_checkTypeConversion",
	TypeAssertExpr: "_checkTypeAssertExpr",
	RangeExpr: "_checkRangeExpr",
	InstantiationExpr: "_checkInstantiationExpr",
};

export const expressionCheckMethods = {
	checkExpr(expr, scope) {
		const t = this._checkExpr(expr, scope);
		expr._type = t;
		return t;
	},

	_checkExpr(expr, scope) {
		switch (expr.kind) {
			case "BasicLit": {
				switch (expr.litKind) {
					case "INT":
						return UNTYPED_INT;
					case "FLOAT":
						return UNTYPED_FLOAT;
					case "STRING":
						return UNTYPED_STRING;
					case "BOOL":
						return UNTYPED_BOOL;
					case "NIL":
						return NIL;
				}
				break;
			}
			case "ImagLit":
				return UNTYPED_COMPLEX;
			case "Ident": {
				const t = scope.lookup(expr.name);
				if (!t) return this.err(`Undefined: '${expr.name}'`, expr);
				if (this.types.has(expr.name)) expr._isTypeRef = true;
				return t;
			}
			case "BinaryExpr": {
				const lt = this.checkExpr(expr.left, scope);
				const rt = this.checkExpr(expr.right, scope);
				if (isAny(lt) || isAny(rt))
					return this.binaryResultType(expr.op, ANY, ANY, expr);
				return this.binaryResultType(expr.op, lt, rt, expr);
			}
			case "AwaitExpr":
				return this.checkExpr(expr.expr, scope);
			case "InstantiationExpr":
				return this._checkInstantiationExpr(expr, scope);
			default: {
				const m = CHECK_EXPR_DELEGATE[expr.kind];
				if (m) return this[m](expr, scope);
				return ANY;
			}
		}
		return ANY;
	},

	_checkDeref(ot, expr) {
		if (ot === ANY) return ANY;
		if (ot.kind === "pointer") return ot.base;
		if (ot.kind === "named" && ot.underlying?.kind === "pointer")
			return ot.underlying.base;
		this.err(`cannot dereference non-pointer type ${typeStr(ot)}`, expr);
		return ANY;
	},

	_checkBoolUnaryOp(ot, expr) {
		if (!isBool(ot) && !isAny(ot)) this.err("! requires bool", expr);
		return BOOL;
	},

	_checkNumericUnaryOp(ot, expr) {
		if (!isNumeric(ot) && !isComplex(ot) && !isAny(ot))
			this.err(`${expr.op} requires numeric`, expr);
		return ot;
	},

	_checkAddressOfExpr(expr, scope, ot) {
		if (expr.operand.kind === "Ident") {
			expr.operand._addressTaken = true;
			const sym = scope.lookup(expr.operand.name);
			if (sym) sym._addressTaken = true;
		}
		return { kind: "pointer", base: ot };
	},

	_checkUnaryExpr(expr, scope) {
		const ot = this.checkExpr(expr.operand, scope);
		if (expr.op === "!") return this._checkBoolUnaryOp(ot, expr);
		if (expr.op === "-" || expr.op === "+")
			return this._checkNumericUnaryOp(ot, expr);
		if (expr.op === "&") return this._checkAddressOfExpr(expr, scope, ot);
		if (expr.op === "*") return this._checkDeref(ot, expr);
		return ot;
	},

	_isStructOrNamedMethod(baseType, base, field) {
		return (
			(base?.kind === "struct" && base.methods?.has(field)) ||
			(baseType.kind === "named" && baseType.methods?.has(field))
		);
	},

	_resolveMethodExprType(baseType, base, field) {
		if (!this._isStructOrNamedMethod(baseType, base, field)) return null;
		return base?.methods?.get(field) ?? baseType.methods?.get(field);
	},

	_checkSelectorExpr(expr, scope) {
		const baseType = this.checkExpr(expr.expr, scope);
		if (expr.expr._isTypeRef) {
			let base = baseType.kind === "named" ? baseType.underlying : baseType;
			base = this.resolveType(base);
			const methodType = this._resolveMethodExprType(
				baseType,
				base,
				expr.field,
			);
			if (methodType) {
				expr._isMethodExpr = true;
				expr._methodExprRecv = baseType;
				return {
					kind: "func",
					params: [baseType, ...(methodType.params ?? [])],
					returns: methodType.returns ?? [],
					variadic: methodType.variadic,
				};
			}
		}
		const ft = this.fieldType(baseType, expr.field, expr);
		if (ft?.kind === "func") {
			let base = baseType.kind === "named" ? baseType.underlying : baseType;
			base = this.resolveType(base);
			if (this._isStructOrNamedMethod(baseType, base, expr.field))
				expr._isMethodValue = true;
		}
		return ft;
	},

	_checkArrayBoundsExpr(btu, bt, expr) {
		if (btu.kind !== "array" || btu.size == null) return;
		const idx = this._constIntValue(expr.index);
		if (idx === null) return;
		if (idx < 0)
			this.err(`invalid array index ${idx} (index must not be negative)`, expr);
		else if (idx >= btu.size)
			this.err(
				`invalid array index ${idx} (out of bounds for ${typeStr(bt)})`,
				expr,
			);
	},

	_checkIndexExpr(expr, scope) {
		const bt = this.checkExpr(expr.expr, scope);
		this.checkExpr(expr.index, scope);
		if (isAny(bt)) return ANY;
		const btu =
			bt.kind === "named"
				? (this.resolveType(bt.underlying) ?? bt.underlying)
				: bt;
		if (btu.kind === "slice" || btu.kind === "array") {
			this._checkArrayBoundsExpr(btu, bt, expr);
			return btu.elem;
		}
		if (btu.kind === "map") {
			expr._mapValueType = btu.value;
			return btu.value;
		}
		if (isString(bt)) return INT;
		return this.err(`Cannot index type ${typeStr(bt)}`, expr);
	},

	_checkSliceExpr(expr, scope) {
		const bt = this.checkExpr(expr.expr, scope);
		if (expr.low) this.checkExpr(expr.low, scope);
		if (expr.high) this.checkExpr(expr.high, scope);
		if (expr.max) this.checkExpr(expr.max, scope);
		if (isAny(bt)) return ANY;
		if (bt.kind === "slice" || bt.kind === "array")
			return { kind: "slice", elem: bt.elem };
		if (isString(bt)) return STRING;
		return this.err(`Cannot slice type ${typeStr(bt)}`, expr);
	},

	_checkFuncLit(expr, scope) {
		const inner = new Scope(scope);
		for (const p of expr.params)
			inner.define(p.name, p.type ? this.resolveTypeNode(p.type, scope) : ANY);
		const ret = expr.returnType
			? this.resolveTypeNode(expr.returnType, scope)
			: VOID;
		const savedDefer = this._deferCount;
		this._deferCount = 0;
		this.checkBlock(expr.body, inner, ret);
		this._reportUnused(inner, expr);
		if (this._deferCount > 0) expr.body._hasDefer = true;
		this._deferCount = savedDefer;
		const paramTypes = expr.params.map((p) =>
			p.type ? this.resolveTypeNode(p.type, scope) : ANY,
		);
		return {
			kind: "func",
			params: paramTypes,
			returns: [ret],
			async: expr.async,
		};
	},

	_checkElemTypeCompatible(tgtElem, srcElem, srcType, targetType, expr) {
		if (
			tgtElem &&
			srcElem &&
			!isAny(tgtElem) &&
			!isAny(srcElem) &&
			typeStr(tgtElem) !== typeStr(srcElem)
		)
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
	},

	_isMutualArraySlice(tgt, src) {
		return (
			(tgt?.kind === "array" && src?.kind === "slice") ||
			(tgt?.kind === "slice" && src?.kind === "array")
		);
	},

	_isInvalidArrayConv(tgt, src, srcType) {
		return tgt?.kind === "array" && src?.kind !== "array" && !isAny(srcType);
	},

	_checkTypeConversion(expr, scope) {
		const srcType = this.checkExpr(expr.expr, scope);
		const targetType = this.resolveTypeNode(expr.targetType, scope);
		const srcResolved =
			srcType?.kind === "named" ? srcType.underlying : srcType;
		const tgtResolved =
			targetType?.kind === "named" ? targetType.underlying : targetType;
		if (isNumeric(targetType) && isComplex(srcType)) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)} (use real() or imag())`,
				expr,
			);
		}
		if (
			isComplex(targetType) &&
			!isComplexOrNumeric(srcType) &&
			!isAny(srcType)
		) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
		}
		if (this._isMutualArraySlice(tgtResolved, srcResolved)) {
			this._checkElemTypeCompatible(
				tgtResolved.elem,
				srcResolved.elem,
				srcType,
				targetType,
				expr,
			);
			return targetType;
		}
		if (this._isInvalidArrayConv(tgtResolved, srcResolved, srcType)) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
		}
		return targetType;
	},

	_checkTypeAssertExpr(expr, scope) {
		const srcType = this.checkExpr(expr.expr, scope);
		const targetType = this.resolveTypeNode(expr.type, scope);

		// In Go, the source of a type assertion must be an interface type.
		// We allow `any` (which is GoFront's basic any) and interface types.
		if (srcType && !isAny(srcType)) {
			let underlying = srcType.kind === "named" ? srcType.underlying : srcType;
			underlying = this.resolveType(underlying);
			if (underlying?.kind !== "interface") {
				this.err(
					`invalid type assertion: ${typeStr(srcType)} is not an interface`,
					expr,
				);
			}
		}

		return targetType;
	},

	_rangeCollTypeTuple(resolved, collType) {
		if (isString(resolved)) return { kind: "tuple", types: [INT, INT] };
		if (resolved?.kind === "slice" || resolved?.kind === "array")
			return { kind: "tuple", types: [INT, resolved.elem ?? ANY] };
		if (resolved?.kind === "map")
			return {
				kind: "tuple",
				types: [resolved.key ?? ANY, resolved.value ?? ANY],
			};
		return { kind: "tuple", types: [collType] };
	},

	_checkRangeExpr(expr, scope) {
		const collType = this.checkExpr(expr.expr, scope);
		const resolved =
			collType?.kind === "named" ? collType.underlying : collType;
		return this._rangeCollTypeTuple(resolved, collType);
	},

	_checkInstantiationExpr(expr, scope) {
		// Generic instantiation: Foo[int] or Foo[int, string]
		const baseType = this.checkExpr(expr.expr, scope);
		if (baseType?.kind === "generic") {
			const typeArgs = expr.typeArgs.map((ta) =>
				this.resolveTypeNode(ta, scope),
			);
			// Check constraints
			for (
				let i = 0;
				i < baseType.typeParams.length && i < typeArgs.length;
				i++
			) {
				const tp = baseType.typeParams[i];
				const constraint = tp.constraint
					? this.resolveTypeNode(tp.constraint, scope)
					: null;
				if (constraint) this.checkConstraint(typeArgs[i], constraint, expr);
			}
			return this.instantiateGenericFunc(baseType, typeArgs);
		}
		return baseType;
	},

	_constIntValue(expr) {
		if (expr.kind === "BasicLit" && expr.litKind === "INT")
			return Number(expr.value);
		if (
			expr.kind === "UnaryExpr" &&
			expr.op === "-" &&
			expr.operand?.kind === "BasicLit" &&
			expr.operand.litKind === "INT"
		) {
			return -Number(expr.operand.value);
		}
		return null;
	},

	_resolveCallArgTypes(expr, scope) {
		if (expr.args.length === 1 && expr.args[0].kind === "CallExpr") {
			const argType = this.checkExpr(expr.args[0], scope);
			if (argType?.kind === "tuple") {
				expr._multiForward = true;
				return argType.types;
			}
			return [argType];
		}
		return expr.args.map((a) => this.checkExpr(a, scope));
	},

	_resolveCallFnType(fnType, argTypes, expr, scope) {
		if (fnType.kind === "named" && fnType.underlying?.kind === "func")
			fnType = fnType.underlying;
		if (fnType.kind === "generic") {
			const resolved = this._resolveGenericFnType(
				fnType,
				argTypes,
				expr,
				scope,
			);
			if (!resolved) return null;
			fnType = resolved;
		}
		return fnType;
	},

	checkCall(expr, scope) {
		let fnType = this.checkExpr(expr.func, scope);
		if (fnType.kind === "builtin") {
			const argTypes = expr.args.map((a, i) => {
				// new(T) — first arg is a type name, not a value expression
				if (fnType.name === "new" && i === 0) return ANY;
				return this.checkExpr(a, scope);
			});
			return this.checkBuiltin(fnType.name, expr, argTypes, scope);
		}

		const argTypes = this._resolveCallArgTypes(expr, scope);

		if (isAny(fnType)) return ANY;

		// Named type used as a constructor/conversion: Greeter(fn), NodeFunc(fn)
		// The callee is a type name, not a callable variable.
		if (fnType.kind === "named" && expr.func._isTypeRef) {
			expr._isTypeConversion = true;
			expr._conversionTargetType = fnType;
			return fnType;
		}

		fnType = this._resolveCallFnType(fnType, argTypes, expr, scope);
		if (!fnType) return ANY;
		if (fnType.kind !== "func") {
			return this.err(`Cannot call non-function type ${typeStr(fnType)}`, expr);
		}

		this._checkCallArgs(fnType, argTypes, expr);

		const ret = fnType.returns;
		if (!ret || ret.length === 0) return VOID;
		if (ret.length === 1) return ret[0];
		return { kind: "tuple", types: ret };
	},

	_resolveGenericFnType(fnType, argTypes, expr, scope) {
		const typeArgs = this.inferTypeArgs(fnType, argTypes);
		if (!typeArgs) {
			this.err(
				`Cannot infer type arguments for generic function '${fnType.name}'`,
				expr,
			);
			return null;
		}
		// Check constraints
		for (let i = 0; i < fnType.typeParams.length && i < typeArgs.length; i++) {
			const tp = fnType.typeParams[i];
			const constraint = tp.constraint
				? this.resolveTypeNode(tp.constraint, scope)
				: null;
			if (constraint) this.checkConstraint(typeArgs[i], constraint, expr);
		}
		return this.instantiateGenericFunc(fnType, typeArgs);
	},

	_checkArgCount(fnType, argTypes, expr) {
		const minArgs = fnType.params.filter(
			(_, i) => !fnType.variadic || i < fnType.params.length - 1,
		).length;
		if (argTypes.length < minArgs)
			this.err(
				`Too few arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
		if (!fnType.variadic && argTypes.length > fnType.params.length)
			this.err(
				`Too many arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
	},

	_checkCallArgs(fnType, argTypes, expr) {
		this._checkArgCount(fnType, argTypes, expr);
		for (let i = 0; i < fnType.params.length && i < argTypes.length; i++) {
			const paramIdx =
				fnType.variadic && i >= fnType.params.length - 1
					? fnType.params.length - 1
					: i;
			if (expr.args[i]?._spread) continue;
			this.assertAssignable(fnType.params[paramIdx], argTypes[i], expr.args[i]);
		}
	},

	checkBuiltin(name, expr, argTypes, scope) {
		const gen = BUILTIN_CHECK[name];
		return gen ? gen(this, name, expr, argTypes, scope) : ANY;
	},

	_constLenFromType(arg0) {
		if (arg0?.kind === "array" && arg0.size != null) return arg0.size;
		if (
			arg0?.kind === "named" &&
			arg0.underlying?.kind === "array" &&
			arg0.underlying.size != null
		)
			return arg0.underlying.size;
		return null;
	},

	_checkBuiltinLen(name, expr, argTypes) {
		if (name === "len") {
			const size = this._constLenFromType(argTypes[0]);
			if (size != null) expr._constLen = size;
		}
		return INT;
	},

	_checkBuiltinComplex(expr, argTypes) {
		if (expr.args.length !== 2) {
			this.err("complex() requires exactly 2 arguments", expr);
			return ANY;
		}
		const crt = argTypes[0];
		const cit = argTypes[1];
		if (!isNumeric(crt)) {
			this.err(`cannot use ${typeStr(crt)} as float in complex()`, expr);
			return ANY;
		}
		if (!isNumeric(cit)) {
			this.err(`cannot use ${typeStr(cit)} as float in complex()`, expr);
			return ANY;
		}
		if (crt.kind === "untyped" && cit.kind === "untyped")
			return UNTYPED_COMPLEX;
		return COMPLEX128;
	},

	_checkBuiltinRealImag(name, expr, argTypes) {
		if (expr.args.length !== 1) {
			this.err(`${name}() requires exactly 1 argument`, expr);
			return ANY;
		}
		const zt = argTypes[0];
		if (!isComplex(zt)) {
			this.err(`cannot use ${typeStr(zt)} as complex in ${name}()`, expr);
			return ANY;
		}
		if (zt.kind === "untyped") return UNTYPED_FLOAT;
		return FLOAT64;
	},

	_inferArraySize(expr, typeNode, base) {
		if (
			typeNode?.kind === "ArrayType" &&
			typeNode.inferLen &&
			base?.kind === "array"
		)
			base.size = computeMaxIndex(expr.elems) + 1;
	},

	_isSliceOrArray(base) {
		return base?.kind === "slice" || base?.kind === "array";
	},

	_checkUnknownCompositeLit(expr, scope, t) {
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") this.checkExpr(elem.value, scope);
			else this.checkExpr(elem, scope);
		}
		return t ?? ANY;
	},

	checkCompositeLit(expr, scope, hintType = null) {
		const t =
			expr.typeExpr === null
				? (hintType ?? ANY)
				: this.resolveTypeNode(expr.typeExpr, scope);
		const base = t.kind === "named" ? t.underlying : t;
		const typeNode = expr.typeExpr;
		this._inferArraySize(expr, typeNode, base);
		if (base?.kind === "struct")
			return this._checkStructCompositeLit(expr, scope, t, base);
		if (this._isSliceOrArray(base))
			return this._checkSliceArrayCompositeLit(expr, scope, t, base, typeNode);
		if (base?.kind === "map")
			return this._checkMapCompositeLit(expr, scope, t, base);
		return this._checkUnknownCompositeLit(expr, scope, t);
	},

	_checkStructPositionalElems(expr, scope, t, base) {
		const fieldNames = [...(base.fields?.keys() ?? [])];
		for (let i = 0; i < expr.elems.length; i++) {
			const elem = expr.elems[i];
			const fieldName = fieldNames[i];
			if (!fieldName) {
				this.err("too many values in struct literal", elem);
				continue;
			}
			const fieldType = base.fields.get(fieldName);
			const vt = this.checkExpr(elem, scope);
			if (fieldType) this.assertAssignable(fieldType, vt, elem);
			elem._positionalField = fieldName;
		}
		return t;
	},

	_checkStructKeyedElems(expr, scope, t, base) {
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				const keyName = elem.key.name;
				const fieldType = base.fields?.get(keyName);
				if (fieldType) {
					const vt = this.checkExpr(elem.value, scope);
					this.assertAssignable(fieldType, vt, elem.value);
				} else {
					const embed = base._embeds?.find(
						(e) => (e.kind === "named" ? e.name : null) === keyName,
					);
					if (embed) {
						const vt = this.checkExpr(elem.value, scope);
						this.assertAssignable(embed, vt, elem.value);
						elem._isEmbedInit = true;
					} else {
						this.err(`Unknown field '${keyName}'`, elem.key);
					}
				}
			} else {
				this.checkExpr(elem, scope);
			}
		}
		return t;
	},

	_checkStructCompositeLit(expr, scope, t, base) {
		const hasPositional = expr.elems.some((e) => e.kind !== "KeyValueExpr");
		const hasKeyed = expr.elems.some((e) => e.kind === "KeyValueExpr");
		if (hasPositional && hasKeyed)
			this.err("mixture of field:value and value initializers", expr);
		if (hasPositional)
			return this._checkStructPositionalElems(expr, scope, t, base);
		return this._checkStructKeyedElems(expr, scope, t, base);
	},

	_checkSliceArrayCompositeLit(expr, scope, t, base, typeNode) {
		for (const elem of expr.elems) {
			if (elem.kind === "CompositeLit" && elem.typeExpr === null) {
				const et = this.checkCompositeLit(elem, scope, base.elem);
				elem._type = et;
			} else if (elem.kind === "KeyValueExpr") {
				const vt = this.checkExpr(elem.value, scope);
				this.assertAssignable(base.elem, vt, elem.value);
			} else {
				const et = this.checkExpr(elem, scope);
				this.assertAssignable(base.elem, et, elem);
			}
		}

		// Composite literal element count validation for explicit-size arrays
		if (base.kind === "array" && base.size != null && !typeNode?.inferLen) {
			const maxIndex = computeMaxIndex(expr.elems);
			if (maxIndex >= base.size) {
				this.err(
					`array index ${maxIndex} out of bounds [0:${base.size}]`,
					expr,
				);
			}
		}

		return t;
	},

	_checkMapCompositeLit(expr, scope, t, base) {
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				const kt = this.checkExpr(elem.key, scope);
				// value may be an implicit composite lit
				let vt;
				if (
					elem.value.kind === "CompositeLit" &&
					elem.value.typeExpr === null
				) {
					vt = this.checkCompositeLit(elem.value, scope, base.value);
					elem.value._type = vt;
				} else {
					vt = this.checkExpr(elem.value, scope);
				}
				this.assertAssignable(base.key, kt, elem.key);
				this.assertAssignable(base.value, vt, elem.value);
			}
		}
		return t;
	},
};

function computeMaxIndex(elems) {
	let sequential = 0;
	let maxKeyed = -1;
	for (const e of elems) {
		if (e.kind === "KeyValueExpr" && e.key?.value !== undefined) {
			maxKeyed = Math.max(maxKeyed, Number(e.key.value));
		} else {
			sequential++;
		}
	}
	return Math.max(sequential - 1, maxKeyed);
}
