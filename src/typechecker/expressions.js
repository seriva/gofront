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
				// Mark type-name identifiers so SelectorExpr can detect method expressions
				if (this.types.has(expr.name)) expr._isTypeRef = true;
				return t;
			}

			case "UnaryExpr": {
				const ot = this.checkExpr(expr.operand, scope);
				if (expr.op === "!") {
					if (!isBool(ot) && !isAny(ot)) this.err("! requires bool", expr);
					return BOOL;
				}
				if (expr.op === "-" || expr.op === "+") {
					if (!isNumeric(ot) && !isComplex(ot) && !isAny(ot))
						this.err(`${expr.op} requires numeric`, expr);
					return ot;
				}
				if (expr.op === "&") {
					// Mark the operand as address-taken for codegen
					if (expr.operand.kind === "Ident") {
						expr.operand._addressTaken = true;
						const sym = scope.lookup(expr.operand.name);
						if (sym) sym._addressTaken = true;
					}
					return { kind: "pointer", base: ot };
				}
				if (expr.op === "*") {
					if (ot === ANY) return ANY;
					if (ot.kind === "pointer") return ot.base;
					if (ot.kind === "named" && ot.underlying?.kind === "pointer")
						return ot.underlying.base;
					this.err(`cannot dereference non-pointer type ${typeStr(ot)}`, expr);
					return ANY;
				}
				return ot;
			}

			case "BinaryExpr": {
				const lt = this.checkExpr(expr.left, scope);
				const rt = this.checkExpr(expr.right, scope);
				if (isAny(lt) || isAny(rt))
					return this.binaryResultType(expr.op, ANY, ANY, expr);
				return this.binaryResultType(expr.op, lt, rt, expr);
			}

			case "CallExpr": {
				return this.checkCall(expr, scope);
			}

			case "SelectorExpr": {
				const baseType = this.checkExpr(expr.expr, scope);
				// Method expression: TypeName.MethodName → func(ReceiverType, ...params) ret
				if (expr.expr._isTypeRef) {
					let base = baseType.kind === "named" ? baseType.underlying : baseType;
					base = this.resolveType(base);
					if (base?.kind === "struct" && base.methods?.has(expr.field)) {
						const methodType = base.methods.get(expr.field);
						// Return a func type with the receiver prepended to params
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
				// Mark method selectors so codegen can emit .bind() when used as a value
				if (ft?.kind === "func") {
					let base = baseType.kind === "named" ? baseType.underlying : baseType;
					base = this.resolveType(base);
					if (base?.kind === "struct" && base.methods?.has(expr.field)) {
						expr._isMethodValue = true;
					}
				}
				return ft;
			}

			case "IndexExpr": {
				const bt = this.checkExpr(expr.expr, scope);
				this.checkExpr(expr.index, scope);
				if (isAny(bt)) return ANY;
				if (bt.kind === "slice" || bt.kind === "array") {
					// Compile-time bounds checking for arrays
					if (bt.kind === "array" && bt.size != null) {
						const idx = this._constIntValue(expr.index);
						if (idx !== null) {
							if (idx < 0) {
								this.err(
									`invalid array index ${idx} (index must not be negative)`,
									expr,
								);
							} else if (idx >= bt.size) {
								this.err(
									`invalid array index ${idx} (out of bounds for ${typeStr(bt)})`,
									expr,
								);
							}
						}
					}
					return bt.elem;
				}
				if (bt.kind === "map") {
					expr._mapValueType = bt.value; // for codegen zero-value fallback
					return bt.value;
				}
				if (isString(bt)) return INT; // byte
				return this.err(`Cannot index type ${typeStr(bt)}`, expr);
			}

			case "SliceExpr": {
				const bt = this.checkExpr(expr.expr, scope);
				if (expr.low) this.checkExpr(expr.low, scope);
				if (expr.high) this.checkExpr(expr.high, scope);
				if (expr.max) this.checkExpr(expr.max, scope);
				if (isAny(bt)) return ANY;
				if (bt.kind === "slice" || bt.kind === "array")
					return { kind: "slice", elem: bt.elem };
				if (isString(bt)) return STRING;
				return this.err(`Cannot slice type ${typeStr(bt)}`, expr);
			}

			case "CompositeLit": {
				return this.checkCompositeLit(expr, scope);
			}

			case "FuncLit": {
				const inner = new Scope(scope);
				for (const p of expr.params)
					inner.define(
						p.name,
						p.type ? this.resolveTypeNode(p.type, scope) : ANY,
					);
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
			}

			case "AwaitExpr": {
				// await unwraps whatever the expression produces — no Promise type modelling
				return this.checkExpr(expr.expr, scope);
			}

			case "TypeConversion": {
				const srcType = this.checkExpr(expr.expr, scope);
				const targetType = this.resolveTypeNode(expr.targetType, scope);
				const srcResolved =
					srcType?.kind === "named" ? srcType.underlying : srcType;
				const tgtResolved =
					targetType?.kind === "named" ? targetType.underlying : targetType;
				// Reject float64(complex) — must use real()/imag()
				if (isNumeric(targetType) && isComplex(srcType)) {
					this.err(
						`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)} (use real() or imag())`,
						expr,
					);
				}
				// Allow complex128/64(numeric) and complex128/64(complex)
				if (isComplex(targetType)) {
					if (!isComplexOrNumeric(srcType) && !isAny(srcType)) {
						this.err(
							`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
							expr,
						);
					}
				}
				// Slice → array conversion: [N]T(slice)
				if (tgtResolved?.kind === "array" && srcResolved?.kind === "slice") {
					const tgtElem = tgtResolved.elem;
					const srcElem = srcResolved.elem;
					if (
						tgtElem &&
						srcElem &&
						!isAny(tgtElem) &&
						!isAny(srcElem) &&
						typeStr(tgtElem) !== typeStr(srcElem)
					) {
						this.err(
							`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
							expr,
						);
					}
					return targetType;
				}
				// Array → slice conversion: []T(array)
				if (tgtResolved?.kind === "slice" && srcResolved?.kind === "array") {
					const tgtElem = tgtResolved.elem;
					const srcElem = srcResolved.elem;
					if (
						tgtElem &&
						srcElem &&
						!isAny(tgtElem) &&
						!isAny(srcElem) &&
						typeStr(tgtElem) !== typeStr(srcElem)
					) {
						this.err(
							`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
							expr,
						);
					}
					return targetType;
				}
				// Reject conversions between array and incompatible types
				if (tgtResolved?.kind === "array" && srcResolved?.kind !== "array") {
					if (!isAny(srcType)) {
						this.err(
							`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
							expr,
						);
					}
				}
				return targetType;
			}

			case "TypeAssertExpr": {
				const srcType = this.checkExpr(expr.expr, scope);
				const targetType = this.resolveTypeNode(expr.type, scope);

				// In Go, the source of a type assertion must be an interface type.
				// We allow `any` (which is GoFront's basic any) and interface types.
				if (srcType && !isAny(srcType)) {
					let underlying =
						srcType.kind === "named" ? srcType.underlying : srcType;
					underlying = this.resolveType(underlying);
					if (underlying?.kind !== "interface") {
						this.err(
							`invalid type assertion: ${typeStr(srcType)} is not an interface`,
							expr,
						);
					}
				}

				return targetType;
			}

			case "RangeExpr": {
				// Type-check the iterated expression so its _type is annotated
				const collType = this.checkExpr(expr.expr, scope);
				const resolved =
					collType?.kind === "named" ? collType.underlying : collType;
				// Return a tuple of (index/key type, value type) so DefineStmt can
				// assign the correct types to range variables.
				const isString =
					(resolved?.kind === "basic" && resolved.name === "string") ||
					(resolved?.kind === "untyped" && resolved.base === "string");
				if (isString) {
					// string range: (int index, rune value) — rune is an alias for int
					return { kind: "tuple", types: [INT, INT] };
				}
				if (resolved?.kind === "slice" || resolved?.kind === "array") {
					return { kind: "tuple", types: [INT, resolved.elem ?? ANY] };
				}
				if (resolved?.kind === "map") {
					return {
						kind: "tuple",
						types: [resolved.key ?? ANY, resolved.value ?? ANY],
					};
				}
				// integer range or unknown — return single-element tuple
				return { kind: "tuple", types: [collType] };
			}

			default:
				return ANY;
		}
		return ANY;
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

	checkCall(expr, scope) {
		const fnType = this.checkExpr(expr.func, scope);

		// Handle built-ins before evaluating args; some (e.g. new) take type names as
		// arguments, which would otherwise produce false "Undefined" errors.
		if (fnType.kind === "builtin") {
			const argTypes = expr.args.map((a, i) => {
				// new(T) — first arg is a type name, not a value expression
				if (fnType.name === "new" && i === 0) return ANY;
				return this.checkExpr(a, scope);
			});
			return this.checkBuiltin(fnType.name, expr, argTypes, scope);
		}

		// Multi-value forwarding: f(g()) where g() returns multiple values
		// When a single argument is a multi-return call, flatten its tuple into args.
		let argTypes;
		if (expr.args.length === 1 && expr.args[0].kind === "CallExpr") {
			const argType = this.checkExpr(expr.args[0], scope);
			if (argType?.kind === "tuple") {
				expr._multiForward = true; // flag for codegen
				argTypes = argType.types;
			} else {
				argTypes = [argType];
			}
		} else {
			argTypes = expr.args.map((a) => this.checkExpr(a, scope));
		}

		if (isAny(fnType)) return ANY;

		if (fnType.kind !== "func") {
			return this.err(`Cannot call non-function type ${typeStr(fnType)}`, expr);
		}

		// Check arg count (allow variadic slack)
		const minArgs = fnType.params.filter(
			(_, i) => !fnType.variadic || i < fnType.params.length - 1,
		).length;
		if (argTypes.length < minArgs) {
			this.err(
				`Too few arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
		}
		if (!fnType.variadic && argTypes.length > fnType.params.length) {
			this.err(
				`Too many arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
		}

		// Check each argument is assignable to its parameter type
		for (let i = 0; i < fnType.params.length && i < argTypes.length; i++) {
			const paramIdx =
				fnType.variadic && i >= fnType.params.length - 1
					? fnType.params.length - 1
					: i;
			// Spread arg (f(slice...)) passes a whole slice into a variadic — skip per-element check
			if (expr.args[i]?._spread) continue;
			this.assertAssignable(fnType.params[paramIdx], argTypes[i], expr.args[i]);
		}

		const ret = fnType.returns;
		if (!ret || ret.length === 0) return VOID;
		if (ret.length === 1) return ret[0];
		return { kind: "tuple", types: ret };
	},

	checkBuiltin(name, expr, argTypes, scope) {
		switch (name) {
			case "len":
			case "cap": {
				// Compile-time len() for fixed arrays
				if (
					name === "len" &&
					argTypes[0]?.kind === "array" &&
					argTypes[0].size != null
				) {
					expr._constLen = argTypes[0].size;
				} else if (
					name === "len" &&
					argTypes[0]?.kind === "named" &&
					argTypes[0].underlying?.kind === "array" &&
					argTypes[0].underlying.size != null
				) {
					expr._constLen = argTypes[0].underlying.size;
				}
				return INT;
			}
			case "append": {
				const sliceType = argTypes[0] ?? ANY;
				if (isArray(sliceType)) {
					this.err(`cannot append to array (type ${typeStr(sliceType)})`, expr);
					return sliceType;
				}
				return sliceType;
			}
			case "copy":
				return INT;
			case "delete":
				return VOID;
			case "make": {
				if (expr.args.length < 1) return ANY;
				const typeArg = expr.args[0];
				const typeNode = typeArg.kind === "TypeExpr" ? typeArg.type : typeArg;
				return this.resolveTypeNode(typeNode, scope) ?? ANY;
			}
			case "new": {
				if (expr.args.length < 1) return ANY;
				const inner = this.resolveTypeNode(expr.args[0], scope);
				return { kind: "pointer", base: inner };
			}
			case "print":
			case "println":
			case "panic":
				return VOID;
			case "recover":
				return ANY;
			case "error":
				return ERROR;
			case "min":
			case "max":
				return argTypes[0] ?? ANY;
			case "clear":
				return VOID;
			case "complex": {
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
			}
			case "real":
			case "imag": {
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
			}
			default:
				return ANY;
		}
	},

	checkCompositeLit(expr, scope, hintType = null) {
		// null typeExpr = implicit lit inside a slice/map: {X:1} in []Point{{X:1}}
		const t =
			expr.typeExpr === null
				? (hintType ?? ANY)
				: this.resolveTypeNode(expr.typeExpr, scope);
		const base = t.kind === "named" ? t.underlying : t;

		// [...]T size inference: count elements and set size
		const typeNode = expr.typeExpr;
		if (
			typeNode?.kind === "ArrayType" &&
			typeNode.inferLen &&
			base?.kind === "array"
		) {
			const maxIndex = computeMaxIndex(expr.elems);
			base.size = maxIndex + 1;
			// If t is a named type wrapping the array, the underlying is already base
			// If t === base, it's the same object
		}

		if (base?.kind === "struct") {
			// Detect positional (unkeyed) literal: all elements must be non-KeyValueExpr
			const hasPositional = expr.elems.some((e) => e.kind !== "KeyValueExpr");
			const hasKeyed = expr.elems.some((e) => e.kind === "KeyValueExpr");
			if (hasPositional && hasKeyed) {
				this.err("mixture of field:value and value initializers", expr);
			}
			if (hasPositional) {
				// Map positional elements to struct fields by declaration order
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
					// Annotate for codegen
					elem._positionalField = fieldName;
				}
				return t;
			}
			for (const elem of expr.elems) {
				if (elem.kind === "KeyValueExpr") {
					const keyName = elem.key.name;
					const fieldType = base.fields?.get(keyName);
					if (fieldType) {
						const vt = this.checkExpr(elem.value, scope);
						this.assertAssignable(fieldType, vt, elem.value);
					} else {
						// Check if it's an embedded type name (e.g. Dog{Animal: Animal{...}})
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
		}

		if (base?.kind === "slice" || base?.kind === "array") {
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
		}

		if (base?.kind === "map") {
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
		}

		// Unknown type context — still check elements
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				this.checkExpr(elem.value, scope);
			} else {
				this.checkExpr(elem, scope);
			}
		}
		return t ?? ANY;
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
