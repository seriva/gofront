// CodeGen expression methods and helpers — installed as a mixin on CodeGen.prototype.

import { ERROR, isComplex } from "../typechecker/types.js";

const globalError = ERROR;

const INT_TYPE_NAMES = new Set([
	"int",
	"uint",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
	"byte",
	"rune",
]);

export const expressionGenMethods = {
	genExpr(expr) {
		switch (expr.kind) {
			case "BasicLit":
				if (expr.litKind === "STRING") return JSON.stringify(expr.value);
				return expr.value; // int, float, bool, nil(null)

			case "ImagLit":
				return `{ re: 0, im: ${expr.value} }`;

			case "Ident":
				if (this._boxedVars.has(expr.name) && !expr._isAddressOf)
					return `${expr.name}.value`;
				return expr.name;

			case "UnaryExpr": {
				const op = expr.op === "^" ? "~" : expr.op; // bitwise NOT
				// Address-of: &x
				if (op === "&") {
					if (expr.operand.kind === "Ident") {
						// Mark so Ident codegen does NOT append .value
						expr.operand._isAddressOf = true;
						// For boxed vars, &x returns the box itself
						if (this._boxedVars.has(expr.operand.name)) {
							return this.genExpr(expr.operand);
						}
					}
					// For non-boxed vars (structs, etc.), wrap in { value: x }
					return `{ value: ${this.genExpr(expr.operand)} }`;
				}
				// Dereference: *p → p.value
				if (op === "*") {
					return `${this.genExpr(expr.operand)}.value`;
				}
				// Unary minus/plus on complex
				if ((op === "-" || op === "+") && isComplex(expr.operand._type)) {
					const inner = this.genExpr(expr.operand);
					if (op === "-") return `{ re: -${inner}.re, im: -${inner}.im }`;
					return inner;
				}
				return `${op}${this.genExpr(expr.operand)}`;
			}

			case "BinaryExpr": {
				// Complex binary operations
				if (
					isComplex(expr._type) ||
					isComplex(expr.left._type) ||
					isComplex(expr.right._type)
				) {
					const l = this._genComplexOperand(expr.left);
					const r = this._genComplexOperand(expr.right);
					switch (expr.op) {
						case "+":
							return `{ re: ${l}.re + ${r}.re, im: ${l}.im + ${r}.im }`;
						case "-":
							return `{ re: ${l}.re - ${r}.re, im: ${l}.im - ${r}.im }`;
						case "*":
							this._usesCmul = true;
							return `__cmul(${l}, ${r})`;
						case "/":
							this._usesCdiv = true;
							return `__cdiv(${l}, ${r})`;
						case "==":
							return `(${l}.re === ${r}.re && ${l}.im === ${r}.im)`;
						case "!=":
							return `(${l}.re !== ${r}.re || ${l}.im !== ${r}.im)`;
					}
				}
				const l = this.genExpr(expr.left);
				const r = this.genExpr(expr.right);
				// Integer division: only when both sides are int
				if (
					expr.op === "/" &&
					this.isIntType(expr.left._type) &&
					this.isIntType(expr.right._type)
				) {
					return `Math.trunc(${l} / ${r})`;
				}
				// Go &^ (bit clear / AND NOT) → JS & ~
				if (expr.op === "&^") {
					return `${l} & ~${r}`;
				}
				// Struct/array equality: use __equal for value comparison
				if (expr.op === "==" || expr.op === "!=") {
					const lt = expr.left._type;
					if (this._isStructOrArrayType(lt)) {
						this._usesEqual = true;
						const cmp = `__equal(${l}, ${r})`;
						return expr.op === "==" ? cmp : `!${cmp}`;
					}
				}
				// Go == and != are strict — map to JS === / !==
				const op =
					expr.op === "==" ? "===" : expr.op === "!=" ? "!==" : expr.op;
				return `${l} ${op} ${r}`;
			}

			case "CallExpr":
				return this.genCall(expr);

			case "InstantiationExpr":
				return this.genExpr(expr.expr); // type erasure

			case "SelectorExpr": {
				// Method expression: TypeName.MethodName → (recv, ...args) => recv.method(...args)
				if (expr._isMethodExpr) {
					const method = expr.field;
					return `((recv, ...args) => recv.${method}(...args))`;
				}
				// math constants
				if (expr.expr.kind === "Ident" && expr.expr.name === "math") {
					switch (expr.field) {
						case "Pi":
							return "Math.PI";
						case "E":
							return "Math.E";
						case "MaxFloat64":
							return "Number.MAX_VALUE";
						case "SmallestNonzeroFloat64":
							return "Number.MIN_VALUE";
						case "MaxInt":
							return "Number.MAX_SAFE_INTEGER";
						case "MinInt":
							return "Number.MIN_SAFE_INTEGER";
					}
				}
				// os constants/vars
				if (expr.expr.kind === "Ident" && expr.expr.name === "os") {
					switch (expr.field) {
						case "Args":
							return "process.argv";
					}
				}
				// time constants (nanosecond durations)
				if (expr.expr.kind === "Ident" && expr.expr.name === "time") {
					switch (expr.field) {
						case "Millisecond":
							return "1000000";
						case "Second":
							return "1000000000";
						case "Minute":
							return "60000000000";
						case "Hour":
							return "3600000000000";
					}
				}
				const base = this.genExpr(expr.expr);
				// Bundled GoFront packages are inlined — drop the qualifier.
				if (this.bundledPackages.has(base)) return expr.field;
				// Pointer types: route through .value
				if (expr.expr._type?.kind === "pointer" && expr.field !== "value") {
					const sel = `${base}.value.${expr.field}`;
					if (expr._isMethodValue && !expr._callee)
						return `${sel}.bind(${base}.value)`;
					return sel;
				}
				const sel = `${base}.${expr.field}`;
				// Method used as value (not called) — bind the receiver
				if (expr._isMethodValue && !expr._callee) return `${sel}.bind(${base})`;
				return sel;
			}

			case "IndexExpr": {
				const base = this.genExpr(expr.expr);
				const idx = this.genExpr(expr.index);
				if (expr._mapValueType && !expr._lvalue) {
					const zero = this.zeroValueForType(expr._mapValueType);
					// Use an IIFE to avoid double-evaluating base/key when either
					// could be a function call or other expression with side effects.
					if (this._hasCallExpr(expr.expr) || this._hasCallExpr(expr.index)) {
						return `((__m, __k) => __m[__k] ?? ${zero})(${base}, ${idx})`;
					}
					return `(${base}[${idx}] ?? ${zero})`;
				}
				// String indexing returns a byte (charCodeAt), not a JS character
				const exprType = expr.expr._type;
				const isStr =
					(exprType?.kind === "basic" && exprType.name === "string") ||
					(exprType?.kind === "untyped" && exprType.base === "string");
				if (isStr && !expr._lvalue) {
					return `${base}.charCodeAt(${idx})`;
				}
				return `${base}[${idx}]`;
			}

			case "SliceExpr": {
				const base = this.genExpr(expr.expr);
				const lo = expr.low ? this.genExpr(expr.low) : "";
				const hi = expr.high ? this.genExpr(expr.high) : "";
				if (!lo && !hi) return `${base}.slice()`;
				if (!hi) return `${base}.slice(${lo})`;
				return `${base}.slice(${lo}, ${hi})`;
			}

			case "CompositeLit":
				return this.genCompositeLit(expr);

			case "FuncLit": {
				const params = expr.params.map((p) => p.name).join(", ");
				const asyncPrefix = expr.async ? "async " : "";
				const saved = this.out;
				const prevBoxed = this._boxedVars;
				this._boxedVars = new Set(prevBoxed); // inherit parent's boxed vars (closures)
				this._scanAddressTaken(expr.body);
				this.out = [];
				this.indented(() => this._genBody(expr.body));
				const body = this.out.join("\n");
				this.out = saved;
				this._boxedVars = prevBoxed;
				return `${asyncPrefix}function(${params}) {\n${body}\n${"  ".repeat(this.indent)}}`;
			}

			case "TypeConversion": {
				const inner = this.genExpr(expr.expr);
				const t = expr.targetType;

				// Complex type conversions
				if (t?.name === "complex128" || t?.name === "complex64") {
					const srcType = expr.expr._type;
					if (isComplex(srcType)) return inner; // complex→complex identity
					return `{ re: ${inner}, im: 0 }`; // numeric→complex
				}

				// Array type conversion: [N]T(slice) → slice(0, N)
				if (t?.kind === "ArrayType") {
					const srcType = expr.expr._type;
					const srcResolved =
						srcType?.kind === "named" ? srcType.underlying : srcType;
					if (srcResolved?.kind === "slice") {
						const size =
							t.size?.value !== undefined ? Number(t.size.value) : t.size;
						return `${inner}.slice(0, ${size})`;
					}
					return inner;
				}

				// Slice type conversions
				if (t?.kind === "SliceType") {
					const elem = t.elem?.name;
					// []byte(s) → UTF-8 byte array
					if (elem === "byte" || elem === "uint8") {
						return `Array.from(new TextEncoder().encode(${inner}))`;
					}
					// []rune(s) → Unicode code point array (only when source is a string)
					if (elem === "rune" || elem === "int32" || elem === "int") {
						const srcType = expr.expr._type;
						if (
							(srcType?.kind === "basic" && srcType?.name === "string") ||
							(srcType?.kind === "untyped" && srcType?.base === "string")
						) {
							return `Array.from(${inner}, __c => __c.codePointAt(0))`;
						}
						return `Array.from(${inner})`;
					}
					return `Array.from(${inner})`;
				}

				const target = t?.name;
				// error("msg") → __error("msg")
				if (target === "error") {
					this._usesError = true;
					return `__error(${inner})`;
				}
				switch (target) {
					case "string": {
						// Go string(65) → "A" (Unicode code point), not "65"
						const srcType = expr.expr._type;
						if (srcType && this.isIntType(srcType)) {
							return `String.fromCodePoint(${inner})`;
						}
						// string([]byte) → decode byte array to string
						if (
							srcType &&
							srcType.kind === "slice" &&
							srcType.elem?.name === "int"
						) {
							return `${inner}.map(c => String.fromCharCode(c)).join("")`;
						}
						return `String(${inner})`;
					}
					case "int":
					case "byte":
					case "rune":
						return `Math.trunc(Number(${inner}))`;
					case "float64":
						return `Number(${inner})`;
					case "bool":
						return `Boolean(${inner})`;
					default:
						return inner;
				}
			}

			case "TypeAssertExpr": {
				const val = this.genExpr(expr.expr);
				const check = this._typeCheckExpr(expr.type, val);
				if (!expr._commaOk) {
					// plain assertion: panic if check fails (matches Go behavior)
					if (check === "true") return val; // can't check at runtime — pass through
					return `(${check} ? ${val} : (() => { throw new Error("interface conversion: type assertion failed"); })())`;
				}
				// comma-ok: emit [value-or-zero, runtimeTypeCheck]
				const zero = this.zeroValueForTypeNode(expr.type);
				return `(${check} ? [${val}, true] : [${zero}, false])`;
			}

			case "AwaitExpr":
				return `await ${this.genExpr(expr.expr)}`;

			case "RangeExpr":
				return this.genExpr(expr.expr);

			default:
				throw new Error(`CodeGen: unhandled expression kind '${expr.kind}'`);
		}
	},

	genCall(expr) {
		// Unwrap InstantiationExpr for function calls: Foo[int](42) → Foo(42)
		const funcExpr =
			expr.func.kind === "InstantiationExpr" ? expr.func.expr : expr.func;
		// Handle built-ins that need special JS translation
		if (funcExpr.kind === "Ident") {
			switch (funcExpr.name) {
				case "append":
					return this.genAppend(expr);
				case "len": {
					if (expr._constLen != null) return String(expr._constLen);
					const arg = expr.args[0];
					const t = arg?._type;
					const js = this.genExpr(arg);
					if (t?.kind === "map") return `Object.keys(${js}).length`;
					this._usesLen = true;
					return `__len(${js})`;
				}
				case "cap":
					return `${this.genExpr(expr.args[0])}.length`;
				case "make":
					return this.genMake(expr);
				case "delete": {
					const [m, k] = expr.args.map((a) => this.genExpr(a));
					return `(delete ${m}[${k}])`;
				}
				case "copy": {
					const [dst, src] = expr.args.map((a) => this.genExpr(a));
					return `((__cd,__cs)=>{const n=Math.min(__cd.length,__cs.length);__cd.splice(0,n,...__cs.slice(0,n));return n;})(${dst},${src})`;
				}
				case "new": {
					const zero = this.zeroValueForExpr(expr.args[0]);
					return `{ value: ${zero} }`;
				}
				case "print":
				case "println": {
					const args = expr.args.map((a) => this.genExpr(a)).join(", ");
					return `console.log(${args})`;
				}
				case "panic": {
					const arg = this.genExpr(expr.args[0]);
					return `(() => { throw new Error(${arg}); })()`;
				}
				case "recover":
					return `(typeof __panic !== "undefined" && __panic !== null ? (() => { const __r = __panic.message ?? String(__panic); __panic = null; return __r; })() : null)`;
				case "error": {
					this._usesError = true;
					const arg = this.genExpr(expr.args[0]);
					return `__error(${arg})`;
				}
				case "min": {
					const args = expr.args.map((a) => this.genExpr(a)).join(", ");
					return `Math.min(${args})`;
				}
				case "max": {
					const args = expr.args.map((a) => this.genExpr(a)).join(", ");
					return `Math.max(${args})`;
				}
				case "clear": {
					const arg = expr.args[0];
					const t = arg?._type;
					const js = this.genExpr(arg);
					if (
						t?.kind === "map" ||
						(t?.kind === "named" && t.underlying?.kind === "map")
					) {
						return `((__m) => { for (const __k in __m) delete __m[__k]; })(${js})`;
					}
					return `(${js}).length = 0`;
				}
				case "complex": {
					const re = this.genExpr(expr.args[0]);
					const im = this.genExpr(expr.args[1]);
					return `{ re: ${re}, im: ${im} }`;
				}
				case "real":
					return `(${this.genExpr(expr.args[0])}).re`;
				case "imag":
					return `(${this.genExpr(expr.args[0])}).im`;
			}
		}

		// error.Error() → real method call
		if (
			expr.func.kind === "SelectorExpr" &&
			expr.func.field === "Error" &&
			expr.func.expr._type &&
			(expr.func.expr._type === globalError ||
				expr.func.expr._type?.name === "error" ||
				(expr.func.expr._type?.kind === "named" &&
					expr.func.expr._type?.underlying?.kind === "interface"))
		) {
			return `${this.genExpr(expr.func.expr)}.Error()`;
		}

		// fmt.Sprintf / fmt.Printf / fmt.Println / fmt.Print / fmt.Errorf
		// Standard library namespace dispatch — all follow the pattern:
		// pkg.Func(args) → inline JS
		if (expr.func.kind === "SelectorExpr" && expr.func.expr.kind === "Ident") {
			const ns = expr.func.expr.name;
			const fn = expr.func.field;
			const result = this._genStdlibCall(ns, fn, expr);
			if (result !== undefined) return result;
		}

		// strings.Builder / bytes.Buffer / regexp.Regexp method dispatch
		if (expr.func.kind === "SelectorExpr") {
			const recvType = expr.func.expr._type;
			const recvName = recvType?.name ?? recvType?.base?.name;
			if (recvName === "strings.Builder" || recvName === "bytes.Buffer") {
				const typeName = recvType?.name ?? recvType?.base?.name;
				return this._genBuilderCall(typeName, expr.func.field, expr);
			}
			if (recvName === "regexp.Regexp") {
				return this._genRegexpMethodCall(expr.func.field, expr);
			}
		}

		// Mark the callee so SelectorExpr knows it's being called, not used as a value
		expr.func._callee = true;
		const rawFn = this.genExpr(expr.func);
		// Wrap function literals in parens so `function(){}()` → `(function(){})()`
		const fn = expr.func.kind === "FuncLit" ? `(${rawFn})` : rawFn;
		// Multi-value forwarding: f(g()) where g() returns multiple values → f(...g())
		if (expr._multiForward) {
			return `${fn}(...${this.genExpr(expr.args[0])})`;
		}
		const args = expr.args
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)))
			.join(", ");
		return `${fn}(${args})`;
	},

	genAppend(expr) {
		const slice = this.genExpr(expr.args[0]);
		const elems = expr.args
			.slice(1)
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)));
		if (elems.length === 0) return slice;
		this._usesAppend = true;
		return `__append(${slice}, ${elems.join(", ")})`;
	},

	genMake(expr) {
		// make([]T, n) or make([]T, n, cap) → new Array(n).fill(zero)
		// make(map[K]V) → {}
		const typeArg = expr.args[0];
		const typeNode = typeArg.kind === "TypeExpr" ? typeArg.type : typeArg;
		const resolvedKind = typeArg._type?.kind;
		if (typeNode.kind === "SliceType" || resolvedKind === "slice") {
			const n = expr.args[1] ? this.genExpr(expr.args[1]) : "0";
			// Use the proper zero value for the element type (e.g. new Point() not 0)
			const elemNode = typeNode.kind === "SliceType" ? typeNode.elem : null;
			const elemResolved =
				typeArg._type?.kind === "slice" ? typeArg._type.elem : null;
			let zero = "null";
			if (elemResolved) {
				zero = this.zeroValueForType(elemResolved);
			} else if (elemNode) {
				zero = this.zeroValueForTypeNode(elemNode);
			}
			// If zero value is a constructor call, use a factory function so each element is distinct
			if (zero.startsWith("new ")) {
				return `Array.from({length: ${n}}, () => ${zero})`;
			}
			return `new Array(${n}).fill(${zero})`;
		}
		// map or fallback
		return "{}";
	},

	// Render struct elements as a JS field list string.
	// Handles positional (_positionalField), embedded-spread (_isEmbedInit), and keyed (KeyValueExpr).
	_genStructFields(elems) {
		return elems
			.map((e) => {
				if (e._positionalField) {
					return `${e._positionalField}: ${this.genExpr(e)}`;
				}
				if (e.kind !== "KeyValueExpr") return null;
				if (e._isEmbedInit) return `...${this.genExpr(e.value)}`;
				return `${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`;
			})
			.filter((s) => s !== null)
			.join(", ");
	},

	genCompositeLit(expr) {
		const t = expr.typeExpr;

		// Implicit composite literal: {X: 1} or {1, 2} inside a slice/map — type inferred from context
		if (t === null) {
			const typeName = expr._type?.name ?? expr._type?.underlying?.name;
			const hasPositional = expr.elems.some((e) => e._positionalField);
			const hasKeyed = expr.elems.some((e) => e.kind === "KeyValueExpr");
			if (hasPositional || hasKeyed) {
				if (typeName && this.structNames.has(typeName)) {
					return `new ${typeName}({ ${this._genStructFields(expr.elems)} })`;
				}
				const fields = expr.elems
					.map((e) => {
						if (e._positionalField)
							return `${e._positionalField}: ${this.genExpr(e)}`;
						return `${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`;
					})
					.join(", ");
				return `{ ${fields} }`;
			}
			return `[${expr.elems.map((e) => this.genExpr(e)).join(", ")}]`;
		}

		const typeName = this.getTypeName(t);

		// Struct: new Foo({ X: 1, Y: 2 }) — keyed or positional
		if (typeName && this.structNames.has(typeName)) {
			return `new ${typeName}({ ${this._genStructFields(expr.elems)} })`;
		}

		// Fallback: named type that's not a struct but has positional elements → treat as struct
		if (expr.elems.some((e) => e._positionalField)) {
			if (typeName) {
				return `new ${typeName}({ ${this._genStructFields(expr.elems)} })`;
			}
		}

		// Slice/array: [1, 2, 3]
		if (t?.kind === "SliceType" || t?.kind === "ArrayType") {
			const elems = expr.elems
				.map((e) =>
					e.kind === "KeyValueExpr" ? this.genExpr(e.value) : this.genExpr(e),
				)
				.join(", ");
			return `[${elems}]`;
		}

		// Map: { key: value }
		if (t?.kind === "MapType") {
			const entries = expr.elems
				.map((e) => {
					if (e.kind === "KeyValueExpr") {
						const k =
							e.key.litKind === "STRING"
								? JSON.stringify(e.key.value)
								: `[${this.genExpr(e.key)}]`;
						return `${k}: ${this.genExpr(e.value)}`;
					}
					return this.genExpr(e);
				})
				.join(", ");
			return `{ ${entries} }`;
		}

		// Fallback: key-value pairs → plain object, positional → array
		if (expr.elems.length > 0 && expr.elems[0]?.kind === "KeyValueExpr") {
			const fields = expr.elems
				.map(
					(e) =>
						`${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`,
				)
				.join(", ");
			return `{ ${fields} }`;
		}
		return `[${expr.elems.map((e) => this.genExpr(e)).join(", ")}]`;
	},

	// ── Helpers ───────────────────────────────────────────────────

	_genComplexOperand(expr) {
		if (isComplex(expr._type)) return this.genExpr(expr);
		return `{ re: ${this.genExpr(expr)}, im: 0 }`;
	},

	getTypeName(typeNode) {
		if (!typeNode) return null;
		if (typeNode.kind === "TypeName") return typeNode.name;
		if (typeNode.kind === "GenericTypeName") return typeNode.name;
		if (typeNode.kind === "Ident") return typeNode.name;
		if (typeNode.kind === "InstantiationExpr")
			return this.getTypeName(typeNode.expr);
		if (typeNode.kind === "SelectorExpr") return typeNode.field;
		return null;
	},

	isIntType(t) {
		if (!t) return false;
		if (t.kind === "untyped") return t.base === "int";
		const base = t.kind === "named" ? t.underlying : t;
		return base?.kind === "basic" && INT_TYPE_NAMES.has(base.name);
	},

	// Returns true if the AST node contains a function call (side-effect risk).
	_hasCallExpr(node) {
		if (!node || typeof node !== "object") return false;
		if (node.kind === "CallExpr") return true;
		for (const v of Object.values(node)) {
			if (v && typeof v === "object" && this._hasCallExpr(v)) return true;
		}
		return false;
	},

	// Returns the JS zero-value literal for a basic type name, or null if not a basic type.
	_zeroForBasicName(name) {
		switch (name) {
			case "int":
			case "uint":
			case "int8":
			case "int16":
			case "int32":
			case "int64":
			case "uint8":
			case "uint16":
			case "uint32":
			case "uint64":
			case "uintptr":
			case "float32":
			case "float64":
			case "byte":
			case "rune":
				return "0";
			case "complex64":
			case "complex128":
				return "{ re: 0, im: 0 }";
			case "string":
				return '""';
			case "bool":
				return "false";
			default:
				return null;
		}
	},

	zeroValueForTypeNode(typeNode) {
		if (!typeNode) return "null";
		switch (typeNode.kind) {
			case "TypeName": {
				const basic = this._zeroForBasicName(typeNode.name);
				if (basic !== null) return basic;
				if (typeNode.name === "strings.Builder") return '{ _buf: "" }';
				if (typeNode.name === "bytes.Buffer") return "{ _buf: [] }";
				if (this.structNames.has(typeNode.name))
					return `new ${typeNode.name}()`;
				return "null";
			}
			case "SliceType":
				return "null";
			case "ArrayType":
				return "[]";
			case "MapType":
				return "{}";
			case "PointerType":
				return "null";
			case "StructType": {
				const fields = typeNode.fields
					.filter((f) => !f.embedded && f.names.length > 0)
					.map(
						(f) =>
							`${f.names.map((n) => `${n}: ${this.zeroValueForTypeNode(f.type)}`).join(", ")}`,
					)
					.join(", ");
				return `{ ${fields} }`;
			}
			default:
				return "null";
		}
	},

	// zeroValueForType operates on typechecker type objects (not AST type nodes).
	zeroValueForType(t) {
		if (!t) return "null";
		switch (t.kind) {
			case "basic":
				return this._zeroForBasicName(t.name) ?? "null";
			case "slice":
				return "null";
			case "map":
				return "{}";
			case "struct": {
				const fields = [...t.fields.entries()]
					.map(([name, ft]) => `${name}: ${this.zeroValueForType(ft)}`)
					.join(", ");
				return `{ ${fields} }`;
			}
			case "named":
				if (t.name === "strings.Builder") return '{ _buf: "" }';
				if (t.name === "bytes.Buffer") return "{ _buf: [] }";
				if (this.structNames.has(t.name)) return `new ${t.name}()`;
				return "null";
			default:
				return "null";
		}
	},

	// Emit a JS boolean expression that checks whether `val` matches type node `t`.
	_typeCheckExpr(typeNode, val) {
		if (!typeNode) return "true";
		if (typeNode.kind === "TypeName") {
			switch (typeNode.name) {
				case "int":
				case "uint":
				case "int8":
				case "int16":
				case "int32":
				case "int64":
				case "uint8":
				case "uint16":
				case "uint32":
				case "uint64":
				case "uintptr":
				case "float32":
				case "float64":
				case "byte":
				case "rune":
					return `typeof ${val} === "number"`;
				case "string":
					return `typeof ${val} === "string"`;
				case "bool":
					return `typeof ${val} === "boolean"`;
				case "nil":
					return `${val} === null`;
				case "error":
					return `(typeof ${val} === "object" && ${val} !== null && typeof ${val}.Error === "function")`;
				default:
					if (this.structNames.has(typeNode.name))
						return `${val} instanceof ${typeNode.name}`;
					return "true"; // unknown type — can't check at runtime
			}
		}
		return "true";
	},

	zeroValueForExpr(expr) {
		// For new(T) calls
		if (expr.kind === "Ident") {
			switch (expr.name) {
				case "int":
				case "float64":
					return "0";
				case "string":
					return '""';
				case "bool":
					return "false";
				default:
					if (this.structNames.has(expr.name)) return `new ${expr.name}()`;
			}
		}
		return "null";
	},

	// Returns true if the type is a struct or array (uses value comparison with __equal).
	_isStructOrArrayType(t) {
		if (!t) return false;
		const base = t.kind === "named" ? t.underlying : t;
		return base?.kind === "struct" || base?.kind === "array";
	},

	_genBuilderCall(typeName, method, expr) {
		// Resolve the receiver — may be a direct var or a &var (pointer)
		const recv = expr.func.expr;
		const isPtr = recv._type?.kind === "pointer";
		const base = isPtr ? `${this.genExpr(recv)}.value` : this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));

		if (typeName === "strings.Builder") {
			switch (method) {
				case "WriteString":
					return `(${base}._buf += ${args[0]}, [${args[0]}.length, null])`;
				case "WriteByte":
				case "WriteRune":
					return `(${base}._buf += String.fromCodePoint(${args[0]}))`;
				case "Write":
					return `(${base}._buf += String.fromCharCode(...${args[0]}))`;
				case "String":
					return `${base}._buf`;
				case "Len":
					return `${base}._buf.length`;
				case "Reset":
					return `(${base}._buf = "")`;
				case "Grow":
					return "undefined";
			}
		}

		if (typeName === "bytes.Buffer") {
			switch (method) {
				case "WriteString":
					return `(${base}._buf.push(...new TextEncoder().encode(${args[0]})), [${args[0]}.length, null])`;
				case "WriteByte":
					return `${base}._buf.push(${args[0]})`;
				case "Write":
					return `(${base}._buf.push(...${args[0]}), [${args[0]}.length, null])`;
				case "String":
					return `new TextDecoder().decode(new Uint8Array(${base}._buf))`;
				case "Bytes":
					return `${base}._buf.slice()`;
				case "Len":
					return `${base}._buf.length`;
				case "Reset":
					return `(${base}._buf = [])`;
				case "Grow":
					return "undefined";
			}
		}

		return undefined;
	},

	_genRegexp(fn, a) {
		switch (fn) {
			case "MustCompile":
				return `new RegExp(${a()[0]})`;
			case "Compile":
				return `[new RegExp(${a()[0]}), null]`;
			case "MatchString": {
				const [pat, s] = a();
				return `[new RegExp(${pat}).test(${s}), null]`;
			}
			case "QuoteMeta":
				return `${a()[0]}.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')`;
		}
		return undefined;
	},

	_genRegexpMethodCall(method, expr) {
		const recv = expr.func.expr;
		// *Regexp is a plain JS RegExp — no .value boxing needed
		const re = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));

		switch (method) {
			case "MatchString":
				return `${re}.test(${args[0]})`;
			case "FindString":
				return `(${re}.exec(${args[0]})?.[0] ?? "")`;
			case "FindStringIndex":
				return `((m => m ? [m.index, m.index + m[0].length] : null)(${re}.exec(${args[0]})))`;
			case "FindAllString":
				return `[...${args[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${args[1]} < 0 ? undefined : ${args[1]}).map(m => m[0])`;
			case "FindStringSubmatch":
				return `[...(${re}.exec(${args[0]}) ?? [])]`;
			case "FindAllStringSubmatch":
				return `[...${args[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${args[1]} < 0 ? undefined : ${args[1]}).map(m => [...m])`;
			case "ReplaceAllString":
				return `${args[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${args[1]})`;
			case "ReplaceAllLiteralString":
				return `${args[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${args[1]}.replace(/\\$/g, '$$$$'))`;
			case "Split":
				return `${args[0]}.split(${re}).slice(0, ${args[1]} < 0 ? undefined : ${args[1]})`;
			case "String":
				return `${re}.source`;
		}
		return undefined;
	},

	_genSlices(fn, a) {
		switch (fn) {
			case "Contains": {
				const [s, v] = a();
				return `${s}.includes(${v})`;
			}
			case "Index": {
				const [s, v] = a();
				return `${s}.indexOf(${v})`;
			}
			case "Equal": {
				this._usesEqual = true;
				const [a1, b1] = a();
				return `__equal(${a1}, ${b1})`;
			}
			case "Compare": {
				const [a1, b1] = a();
				return `((a, b) => { for (let i = 0; i < a.length && i < b.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return a.length - b.length; })(${a1}, ${b1})`;
			}
			case "Sort": {
				const [s] = a();
				return `${s}.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)`;
			}
			case "SortFunc": {
				const [s, cmp] = a();
				return `${s}.sort(${cmp})`;
			}
			case "SortStableFunc": {
				const [s, cmp] = a();
				return `${s}.sort(${cmp})`;
			}
			case "IsSorted": {
				const [s] = a();
				return `((s) => { for (let i = 1; i < s.length; i++) { if (s[i] < s[i-1]) return false; } return true; })(${s})`;
			}
			case "IsSortedFunc": {
				const [s, cmp] = a();
				return `((s, f) => { for (let i = 1; i < s.length; i++) { if (f(s[i], s[i-1]) < 0) return false; } return true; })(${s}, ${cmp})`;
			}
			case "Reverse": {
				const [s] = a();
				return `${s}.reverse()`;
			}
			case "Max": {
				const [s] = a();
				return `Math.max(...${s})`;
			}
			case "Min": {
				const [s] = a();
				return `Math.min(...${s})`;
			}
			case "MaxFunc": {
				const [s, cmp] = a();
				return `((s, f) => s.reduce((m, x) => f(x, m) > 0 ? x : m))(${s}, ${cmp})`;
			}
			case "MinFunc": {
				const [s, cmp] = a();
				return `((s, f) => s.reduce((m, x) => f(x, m) < 0 ? x : m))(${s}, ${cmp})`;
			}
			case "Clone": {
				const [s] = a();
				return `${s}.slice()`;
			}
			case "Compact": {
				const [s] = a();
				return `((s) => s.filter((v, i) => i === 0 || v !== s[i-1]))(${s})`;
			}
			case "CompactFunc": {
				const [s, eq] = a();
				return `((s, f) => s.filter((v, i) => i === 0 || !f(v, s[i-1])))(${s}, ${eq})`;
			}
			case "Concat": {
				const args = a();
				return `[].concat(${args.join(", ")})`;
			}
			case "Delete": {
				const [s, i, j] = a();
				return `[...${s}.slice(0, ${i}), ...${s}.slice(${j})]`;
			}
			case "DeleteFunc": {
				const [s, fn2] = a();
				return `${s}.filter((v) => !${fn2}(v))`;
			}
			case "Insert": {
				const args = a();
				const s = args[0];
				const i = args[1];
				const vs = args.slice(2);
				return `[...${s}.slice(0, ${i}), ${vs.join(", ")}, ...${s}.slice(${i})]`;
			}
			case "Replace": {
				const args = a();
				const s = args[0];
				const i = args[1];
				const j = args[2];
				const vs = args.slice(3);
				return `[...${s}.slice(0, ${i}), ${vs.join(", ")}, ...${s}.slice(${j})]`;
			}
			case "Grow":
			case "Clip": {
				const [s] = a();
				return `${s}.slice()`;
			}
		}
		return undefined;
	},

	_genMaps(fn, a) {
		switch (fn) {
			case "Keys": {
				const [m] = a();
				return `Object.keys(${m})`;
			}
			case "Values": {
				const [m] = a();
				return `Object.values(${m})`;
			}
			case "Clone": {
				const [m] = a();
				return `({...${m}})`;
			}
			case "Copy": {
				const [dst, src] = a();
				return `Object.assign(${dst}, ${src})`;
			}
			case "Equal": {
				this._usesEqual = true;
				const [a1, b1] = a();
				return `__equal(${a1}, ${b1})`;
			}
			case "EqualFunc": {
				const [m1, m2, eq] = a();
				return `((a, b, f) => { const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false; return ka.every(k => k in b && f(a[k], b[k])); })(${m1}, ${m2}, ${eq})`;
			}
			case "Delete": {
				const [m, k] = a();
				return `(delete ${m}[${k}], undefined)`;
			}
			case "DeleteFunc": {
				const [m, fn2] = a();
				return `Object.keys(${m}).forEach(k => { if (${fn2}(k, ${m}[k])) delete ${m}[k]; })`;
			}
		}
		return undefined;
	},

	typeComment(typeNode) {
		if (!typeNode) return "unknown";
		switch (typeNode.kind) {
			case "TypeName":
				return typeNode.name;
			case "SliceType":
				return `[]${this.typeComment(typeNode.elem)}`;
			case "MapType":
				return `map[${this.typeComment(typeNode.key)}]${this.typeComment(typeNode.value)}`;
			default:
				return typeNode.kind;
		}
	},

	// Dispatch table for stdlib namespace calls (pkg.Func → inline JS).
	// Returns the generated JS string, or undefined if not handled.
	_genStdlibCall(ns, fn, expr) {
		const a = () => expr.args.map((e) => this.genExpr(e));
		switch (ns) {
			case "fmt":
				return this._genFmt(fn, a, expr);
			case "strings":
				return this._genStrings(fn, a);
			case "bytes":
				return this._genBytes(fn, a);
			case "strconv":
				return this._genStrconv(fn, a);
			case "sort":
				return this._genSort(fn, a);
			case "math":
				return this._genMath(fn, a);
			case "unicode":
				return this._genUnicode(fn, a);
			case "os":
				return this._genOs(fn, a);
			case "errors":
				return this._genErrors(fn, a);
			case "time":
				return this._genTime(fn, a);
			case "regexp":
				return this._genRegexp(fn, a);
			case "slices":
				return this._genSlices(fn, a);
			case "maps":
				return this._genMaps(fn, a);
			case "html":
				return this._genHtml(fn, a);
			default:
				return undefined;
		}
	},

	_genFmt(fn, _a, expr) {
		const fmtArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
		switch (fn) {
			case "Sprintf":
				this._usesSprintf = true;
				return `__sprintf(${fmtArgs})`;
			case "Errorf": {
				this._usesSprintf = true;
				this._usesError = true;
				const fmtStr = expr.args[0];
				if (fmtStr?.kind === "BasicLit" && fmtStr.value?.includes("%w")) {
					const lastArg = this.genExpr(expr.args[expr.args.length - 1]);
					return `__error(__sprintf(${fmtArgs}), ${lastArg})`;
				}
				return `__error(__sprintf(${fmtArgs}))`;
			}
			case "Printf":
			case "Print":
				this._usesSprintf = true;
				return `process?.stdout?.write(__sprintf(${fmtArgs}))`;
			case "Println":
				this._usesSprintf = true;
				return `console.log(__sprintf(${fmtArgs}))`;
			case "Fprintf":
			case "Fprintln":
			case "Fprint": {
				this._usesSprintf = true;
				const writerArg = expr.args[0];
				const rest = expr.args.slice(1);
				const restJs = rest.map((e) => this.genExpr(e)).join(", ");
				// Resolve the writer to its underlying buffer expression
				const writerType = writerArg._type;
				const targetTypeName =
					writerType?.name ??
					(writerType?.kind === "pointer" ? writerType.base?.name : null);
				let buf;
				if (targetTypeName === "strings.Builder") {
					const w = this.genExpr(writerArg);
					buf =
						writerType?.kind === "pointer" ? `${w}.value._buf` : `${w}._buf`;
				} else if (targetTypeName === "bytes.Buffer") {
					const w = this.genExpr(writerArg);
					const base = writerType?.kind === "pointer" ? `${w}.value` : w;
					buf = null;
					if (fn === "Fprintf") {
						return `((__b,__s)=>{ __b._buf.push(...new TextEncoder().encode(__s)); })(${base}, __sprintf(${restJs}))`;
					}
					const valJs =
						fn === "Fprintln"
							? `__sprintf("%v\\n", ${restJs})`
							: `__sprintf("%v", ${restJs})`;
					return `((__b,__s)=>{ __b._buf.push(...new TextEncoder().encode(__s)); })(${base}, ${valJs})`;
				} else {
					// Generic io.Writer fallback — call .WriteString if available
					const w = this.genExpr(writerArg);
					const formatted =
						fn === "Fprintf"
							? `__sprintf(${restJs})`
							: fn === "Fprintln"
								? `__sprintf("%v\\n", ${restJs})`
								: `__sprintf("%v", ${restJs})`;
					return `${w}.WriteString(${formatted})`;
				}
				// strings.Builder path
				if (fn === "Fprintf") return `(${buf} += __sprintf(${restJs}))`;
				if (fn === "Fprintln")
					return `(${buf} += __sprintf("%v\\n", ${restJs}))`;
				return `(${buf} += __sprintf("%v", ${restJs}))`;
			}
			default:
				return undefined;
		}
	},

	_genStrings(fn, a) {
		const args = a();
		switch (fn) {
			case "Contains":
				return `${args[0]}.includes(${args[1]})`;
			case "HasPrefix":
				return `${args[0]}.startsWith(${args[1]})`;
			case "HasSuffix":
				return `${args[0]}.endsWith(${args[1]})`;
			case "Index":
				return `${args[0]}.indexOf(${args[1]})`;
			case "LastIndex":
				return `${args[0]}.lastIndexOf(${args[1]})`;
			case "Count":
				return `${args[0]}.split(${args[1]}).length - 1`;
			case "Repeat":
				return `${args[0]}.repeat(${args[1]})`;
			case "Replace":
				return `${args[0]}.replace(${args[1]}, ${args[2]})`;
			case "ReplaceAll":
				return `${args[0]}.replaceAll(${args[1]}, ${args[2]})`;
			case "ToUpper":
				return `${args[0]}.toUpperCase()`;
			case "ToLower":
				return `${args[0]}.toLowerCase()`;
			case "TrimSpace":
				return `${args[0]}.trim()`;
			case "Trim":
				return `${args[0]}.replace(new RegExp(\`^[\${${args[1]}}]+|[\${${args[1]}}]+$\`, "g"), "")`;
			case "TrimPrefix":
				return `(${args[0]}.startsWith(${args[1]}) ? ${args[0]}.slice(${args[1]}.length) : ${args[0]})`;
			case "TrimSuffix":
				return `(${args[0]}.endsWith(${args[1]}) ? ${args[0]}.slice(0, -${args[1]}.length) : ${args[0]})`;
			case "TrimLeft":
				return `${args[0]}.replace(new RegExp(\`^[\${${args[1]}}]+\`), "")`;
			case "TrimRight":
				return `${args[0]}.replace(new RegExp(\`[\${${args[1]}}]+$\`), "")`;
			case "Split":
				return `${args[0]}.split(${args[1]})`;
			case "Join":
				return `${args[0]}.join(${args[1]})`;
			case "EqualFold":
				return `${args[0]}.toLowerCase() === ${args[1]}.toLowerCase()`;
			default:
				return undefined;
		}
	},

	_genBytes(fn, a) {
		const __bs = `(b => String.fromCharCode(...b))`;
		const __sb = `(s => [...s].map(c => c.charCodeAt(0)))`;
		const args = a();
		switch (fn) {
			case "Contains":
				return `${__bs}(${args[0]}).includes(${__bs}(${args[1]}))`;
			case "HasPrefix":
				return `((b, p) => { for (let i = 0; i < p.length; i++) if (b[i] !== p[i]) return false; return b.length >= p.length; })(${args[0]}, ${args[1]})`;
			case "HasSuffix":
				return `((b, s) => { const off = b.length - s.length; if (off < 0) return false; for (let i = 0; i < s.length; i++) if (b[off + i] !== s[i]) return false; return true; })(${args[0]}, ${args[1]})`;
			case "Index":
				return `${__bs}(${args[0]}).indexOf(${__bs}(${args[1]}))`;
			case "Count":
				return `${__bs}(${args[0]}).split(${__bs}(${args[1]})).length - 1`;
			case "Repeat":
				return `${__sb}(${__bs}(${args[0]}).repeat(${args[1]}))`;
			case "Replace":
				return `((b, o, n, cnt) => { let s = ${__bs}(b), os = ${__bs}(o), ns = ${__bs}(n); if (cnt < 0) return ${__sb}(s.replaceAll(os, ns)); for (let i = 0; i < cnt; i++) s = s.replace(os, ns); return ${__sb}(s); })(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`;
			case "ToUpper":
				return `${__sb}(${__bs}(${args[0]}).toUpperCase())`;
			case "ToLower":
				return `${__sb}(${__bs}(${args[0]}).toLowerCase())`;
			case "TrimSpace":
				return `${__sb}(${__bs}(${args[0]}).trim())`;
			case "Trim":
				return `${__sb}(${__bs}(${args[0]}).replace(new RegExp(\`^[\${${args[1]}}]+|[\${${args[1]}}]+$\`, "g"), ""))`;
			case "Equal":
				return `((a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; })(${args[0]}, ${args[1]})`;
			case "Split":
				return `${__bs}(${args[0]}).split(${__bs}(${args[1]})).map(p => ${__sb}(p))`;
			case "Join":
				return `${__sb}(${args[0]}.map(p => ${__bs}(p)).join(${__bs}(${args[1]})))`;
			default:
				return undefined;
		}
	},

	_genStrconv(fn, a) {
		const args = a();
		switch (fn) {
			case "Itoa":
				return `String(${args[0]})`;
			case "Atoi":
				return `(Number.isNaN(Number(${args[0]})) ? [0, "invalid syntax"] : [Number(${args[0]}) | 0, null])`;
			case "FormatBool":
				return `String(${args[0]})`;
			case "FormatInt":
				return `(${args[0]}).toString(${args[1]})`;
			case "FormatFloat":
				return `String(${args[0]})`;
			case "ParseFloat":
				return `(Number.isNaN(Number(${args[0]})) ? [0, "invalid syntax"] : [Number(${args[0]}), null])`;
			case "ParseInt":
				return `(Number.isNaN(parseInt(${args[0]}, ${args[1]} || 10)) ? [0, "invalid syntax"] : [parseInt(${args[0]}, ${args[1]} || 10), null])`;
			case "ParseBool":
				return `(${args[0]} === "true" || ${args[0]} === "1" ? [true, null] : ${args[0]} === "false" || ${args[0]} === "0" ? [false, null] : [false, "invalid syntax"])`;
			default:
				return undefined;
		}
	},

	_genSort(fn, a) {
		const args = a();
		switch (fn) {
			case "Ints":
			case "Float64s":
				return `${args[0]}.sort((a, b) => a - b)`;
			case "Strings":
				return `${args[0]}.sort()`;
			case "Slice":
			case "SliceStable":
				return `${args[0]}.sort((a, b) => ${args[1]}(a, b) ? -1 : ${args[1]}(b, a) ? 1 : 0)`;
			case "SliceIsSorted":
				return `${args[0]}.every((v, i, a) => i === 0 || ${args[1]}(a[i - 1], v))`;
			default:
				return undefined;
		}
	},

	_genMath(fn, a) {
		const args = a();
		switch (fn) {
			case "Abs":
				return `Math.abs(${args[0]})`;
			case "Floor":
				return `Math.floor(${args[0]})`;
			case "Ceil":
				return `Math.ceil(${args[0]})`;
			case "Round":
				return `Math.round(${args[0]})`;
			case "Sqrt":
				return `Math.sqrt(${args[0]})`;
			case "Cbrt":
				return `Math.cbrt(${args[0]})`;
			case "Pow":
				return `Math.pow(${args[0]}, ${args[1]})`;
			case "Log":
				return `Math.log(${args[0]})`;
			case "Log2":
				return `Math.log2(${args[0]})`;
			case "Log10":
				return `Math.log10(${args[0]})`;
			case "Sin":
				return `Math.sin(${args[0]})`;
			case "Cos":
				return `Math.cos(${args[0]})`;
			case "Tan":
				return `Math.tan(${args[0]})`;
			case "Min":
				return `Math.min(${args[0]}, ${args[1]})`;
			case "Max":
				return `Math.max(${args[0]}, ${args[1]})`;
			case "Mod":
				return `${args[0]} % ${args[1]}`;
			case "Inf":
				return `(${args[0]} >= 0 ? Infinity : -Infinity)`;
			case "IsNaN":
				return `Number.isNaN(${args[0]})`;
			case "IsInf":
				return `(${args[1]} > 0 ? ${args[0]} === Infinity : ${args[1]} < 0 ? ${args[0]} === -Infinity : !Number.isFinite(${args[0]}))`;
			case "NaN":
				return "NaN";
			default:
				return undefined;
		}
	},

	_genUnicode(fn, a) {
		const args = a();
		const cp = `String.fromCodePoint(${args[0]})`;
		switch (fn) {
			case "IsLetter":
				return `/\\p{L}/u.test(${cp})`;
			case "IsDigit":
				return `/\\p{Nd}/u.test(${cp})`;
			case "IsSpace":
				return `/\\s/.test(${cp})`;
			case "IsUpper":
				return `((__c) => __c === __c.toUpperCase() && /\\p{L}/u.test(__c))(${cp})`;
			case "IsLower":
				return `((__c) => __c === __c.toLowerCase() && /\\p{L}/u.test(__c))(${cp})`;
			case "IsPunct":
				return `/\\p{P}/u.test(${cp})`;
			case "IsControl":
				return `/\\p{Cc}/u.test(${cp})`;
			case "IsPrint":
				return `!/\\p{Cc}/u.test(${cp})`;
			case "IsGraphic":
				return `!/\\p{Cc}/u.test(${cp})`;
			case "ToUpper":
				return `${cp}.toUpperCase().codePointAt(0)`;
			case "ToLower":
				return `${cp}.toLowerCase().codePointAt(0)`;
			default:
				return undefined;
		}
	},

	_genOs(fn, a) {
		const args = a();
		switch (fn) {
			case "Exit":
				return `process.exit(${args[0]})`;
			case "Getenv":
				return `(process.env[${args[0]}] ?? "")`;
			default:
				return undefined;
		}
	},

	_genErrors(fn, a) {
		const args = a();
		switch (fn) {
			case "New":
				this._usesError = true;
				return `__error(${args[0]})`;
			case "Is":
				this._usesErrorIs = true;
				return `__errorIs(${args[0]}, ${args[1]})`;
			case "Unwrap":
				return `(${args[0]}?._cause ?? null)`;
			default:
				return undefined;
		}
	},

	_genTime(fn, a) {
		const args = a();
		switch (fn) {
			case "Now":
				return "Date.now()";
			case "Since":
				return `(Date.now() - ${args[0]})`;
			case "Sleep":
				return `await new Promise(r => setTimeout(r, ${args[0]} / 1000000))`;
			default:
				return undefined;
		}
	},
};
