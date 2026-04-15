// TypeChecker expression-checking methods — installed as a mixin on TypeChecker.prototype.

import {
	ANY,
	BOOL,
	ERROR,
	FLOAT64,
	INT,
	isAny,
	isBool,
	isNumeric,
	isString,
	NIL,
	Scope,
	STRING,
	typeStr,
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
						return INT;
					case "FLOAT":
						return FLOAT64;
					case "STRING":
						return STRING;
					case "BOOL":
						return BOOL;
					case "NIL":
						return NIL;
				}
				break;
			}

			case "Ident": {
				const t = scope.lookup(expr.name);
				if (!t) return this.err(`Undefined: '${expr.name}'`, expr);
				return t;
			}

			case "UnaryExpr": {
				const ot = this.checkExpr(expr.operand, scope);
				if (expr.op === "!") {
					if (!isBool(ot) && !isAny(ot)) this.err("! requires bool", expr);
					return BOOL;
				}
				if (expr.op === "-" || expr.op === "+") {
					if (!isNumeric(ot) && !isAny(ot))
						this.err(`${expr.op} requires numeric`, expr);
					return ot;
				}
				return ot;
			}

			case "BinaryExpr": {
				const lt = this.checkExpr(expr.left, scope);
				const rt = this.checkExpr(expr.right, scope);
				if (isAny(lt) || isAny(rt)) return this.binaryResultType(expr.op, ANY);
				return this.binaryResultType(expr.op, lt, rt, expr);
			}

			case "CallExpr": {
				return this.checkCall(expr, scope);
			}

			case "SelectorExpr": {
				const baseType = this.checkExpr(expr.expr, scope);
				return this.fieldType(baseType, expr.field, expr);
			}

			case "IndexExpr": {
				const bt = this.checkExpr(expr.expr, scope);
				this.checkExpr(expr.index, scope);
				if (isAny(bt)) return ANY;
				if (bt.kind === "slice" || bt.kind === "array") return bt.elem;
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
				this.checkExpr(expr.expr, scope);
				return this.resolveTypeNode(expr.targetType, scope);
			}

			case "TypeAssertExpr": {
				this.checkExpr(expr.expr, scope);
				return this.resolveTypeNode(expr.type, scope);
			}

			case "RangeExpr": {
				// Type-check the iterated expression so its _type is annotated
				return this.checkExpr(expr.expr, scope);
			}

			default:
				return ANY;
		}
		return ANY;
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

		const argTypes = expr.args.map((a) => this.checkExpr(a, scope));

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
			case "cap":
				return INT;
			case "append":
				return argTypes[0] ?? ANY;
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

		if (base?.kind === "struct") {
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
				} else if (elem.kind !== "KeyValueExpr") {
					const et = this.checkExpr(elem, scope);
					this.assertAssignable(base.elem, et, elem);
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
