// CodeGen expression methods and helpers — installed as a mixin on CodeGen.prototype.

import { ERROR, isComplex } from "../typechecker/types.js";

// Namespace constants: pkg.Field → JS literal
const NS_CONSTANTS = {
	math: {
		Pi: "Math.PI",
		E: "Math.E",
		MaxFloat64: "Number.MAX_VALUE",
		SmallestNonzeroFloat64: "Number.MIN_VALUE",
		MaxInt: "Number.MAX_SAFE_INTEGER",
		MinInt: "Number.MIN_SAFE_INTEGER",
	},
	io: {
		EOF: '"EOF"',
		Discard:
			"{ WriteString(s) { return s.length; }, Write(b) { return b.length; } }",
	},
	os: { Args: "process.argv" },
	time: {
		Millisecond: "1000000",
		Second: "1000000000",
		Minute: "60000000000",
		Hour: "3600000000000",
		RFC3339: '"2006-01-02T15:04:05Z07:00"',
		RFC3339Nano: '"2006-01-02T15:04:05.999999999Z07:00"',
		DateOnly: '"2006-01-02"',
		TimeOnly: '"15:04:05"',
		DateTime: '"2006-01-02 15:04:05"',
		UTC: "null",
		Local: "null",
		January: "1",
		February: "2",
		March: "3",
		April: "4",
		May: "5",
		June: "6",
		July: "7",
		August: "8",
		September: "9",
		October: "10",
		November: "11",
		December: "12",
		Sunday: "0",
		Monday: "1",
		Tuesday: "2",
		Wednesday: "3",
		Thursday: "4",
		Friday: "5",
		Saturday: "6",
	},
	utf8: { RuneError: "0xFFFD", MaxRune: "0x10FFFF", UTFMax: "4" },
};

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

			case "BinaryExpr":
				return this._genBinaryExpr(expr);

			case "CallExpr":
				return this.genCall(expr);

			case "InstantiationExpr":
				return this.genExpr(expr.expr); // type erasure

			case "SelectorExpr": {
				if (expr._isMethodExpr) {
					return `((recv, ...args) => recv.${expr.field}(...args))`;
				}
				// Namespace constants: math.Pi, time.RFC3339, utf8.RuneError, etc.
				if (expr.expr.kind === "Ident") {
					const nsConst = NS_CONSTANTS[expr.expr.name]?.[expr.field];
					if (nsConst !== undefined) return nsConst;
				}
				const base = this.genExpr(expr.expr);
				if (this.bundledPackages.has(base)) return expr.field;
				if (expr.expr._type?.kind === "pointer" && expr.field !== "value") {
					const sel = `${base}.value.${expr.field}`;
					if (expr._isMethodValue && !expr._callee)
						return `${sel}.bind(${base}.value)`;
					return sel;
				}
				const sel = `${base}.${expr.field}`;
				if (expr._isMethodValue && !expr._callee) return `${sel}.bind(${base})`;
				return sel;
			}

			case "IndexExpr": {
				const exprType = expr.expr._type;
				const wrapField = this._namedWrapperField(exprType, expr.expr);
				const base = wrapField
					? `${this.genExpr(expr.expr)}.${wrapField}`
					: this.genExpr(expr.expr);
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
				if (!lo) return `${base}.slice(0, ${hi})`;
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

			case "TypeConversion":
				return this._genTypeConversion(expr);

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
		// Named type constructor call: Greeter(fn), NodeFunc(fn) → new Greeter(fn)
		if (expr._isTypeConversion) {
			const name = expr._conversionTargetType?.name;
			const arg = this.genExpr(expr.args[0]);
			if (name && this.namedWrapperNames.has(name)) {
				return `new ${name}(${arg})`;
			}
			return arg; // non-wrapper named types: identity
		}

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
					const wrapField = this._namedWrapperField(t, arg);
					if (wrapField) {
						return `${this.genExpr(arg)}.${wrapField}.length`;
					}
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
			(expr.func.expr._type === ERROR ||
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
			if (recvName === "time.Time") {
				return this._genTimeMethodCall(expr.func.field, expr);
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
		const retType = expr._type;
		const wrapField = this._namedWrapperField(retType, expr.args[0]);
		if (wrapField) {
			// Named slice wrapper: append(g, x) → new G(__append(g._items, x))
			const sliceJS = `${this.genExpr(expr.args[0])}.${wrapField}`;
			const elems = expr.args
				.slice(1)
				.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)));
			if (elems.length === 0) return this.genExpr(expr.args[0]);
			this._usesAppend = true;
			return `new ${retType.name}(__append(${sliceJS}, ${elems.join(", ")}))`;
		}
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

		// Named wrapper type: Group{a, b} → new Group([a, b])
		if (typeName && this.namedWrapperNames.has(typeName)) {
			const namedType = this.checker?.types.get(typeName);
			const u = namedType?.underlying;
			if (u?.kind === "map") {
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
				return `new ${typeName}({ ${entries} })`;
			}
			// Default: slice
			const elems = expr.elems
				.map((e) =>
					e.kind === "KeyValueExpr" ? this.genExpr(e.value) : this.genExpr(e),
				)
				.join(", ");
			return `new ${typeName}([${elems}])`;
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
		if (typeNode.kind === "SelectorExpr")
			return `${this.getTypeName(typeNode.expr)}.${typeNode.field}`;
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

	_zeroForNamedType(name) {
		if (name === "strings.Builder") return '{ _buf: "" }';
		if (name === "bytes.Buffer") return "{ _buf: [] }";
		if (this.structNames.has(name)) return `new ${name}()`;
		return "null";
	},

	zeroValueForTypeNode(typeNode) {
		if (!typeNode) return "null";
		switch (typeNode.kind) {
			case "TypeName": {
				const basic = this._zeroForBasicName(typeNode.name);
				if (basic !== null) return basic;
				return this._zeroForNamedType(typeNode.name);
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
				return this._zeroForNamedType(t.name);
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

	_genBinaryExpr(expr) {
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
		if (
			expr.op === "/" &&
			this.isIntType(expr.left._type) &&
			this.isIntType(expr.right._type)
		) {
			return `Math.trunc(${l} / ${r})`;
		}
		if (expr.op === "&^") return `${l} & ~${r}`;
		if (expr.op === "==" || expr.op === "!=") {
			if (this._isStructOrArrayType(expr.left._type)) {
				this._usesEqual = true;
				const cmp = `__equal(${l}, ${r})`;
				return expr.op === "==" ? cmp : `!${cmp}`;
			}
		}
		const op = expr.op === "==" ? "===" : expr.op === "!=" ? "!==" : expr.op;
		return `${l} ${op} ${r}`;
	},

	_genTypeConversion(expr) {
		const inner = this.genExpr(expr.expr);
		const t = expr.targetType;
		if (t?.name === "complex128" || t?.name === "complex64") {
			return isComplex(expr.expr._type) ? inner : `{ re: ${inner}, im: 0 }`;
		}
		if (t?.kind === "ArrayType") {
			const srcResolved =
				expr.expr._type?.kind === "named"
					? expr.expr._type.underlying
					: expr.expr._type;
			if (srcResolved?.kind === "slice") {
				const size =
					t.size?.value !== undefined ? Number(t.size.value) : t.size;
				return `${inner}.slice(0, ${size})`;
			}
			return inner;
		}
		if (t?.kind === "SliceType") {
			const elem = t.elem?.name;
			if (elem === "byte" || elem === "uint8")
				return `Array.from(new TextEncoder().encode(${inner}))`;
			if (elem === "rune" || elem === "int32" || elem === "int") {
				const srcType = expr.expr._type;
				if (
					(srcType?.kind === "basic" && srcType?.name === "string") ||
					(srcType?.kind === "untyped" && srcType?.base === "string")
				) {
					return `Array.from(${inner}, __c => __c.codePointAt(0))`;
				}
			}
			return `Array.from(${inner})`;
		}
		const target = t?.name;
		if (target === "error") {
			this._usesError = true;
			return `__error(${inner})`;
		}
		if (target && this.namedWrapperNames.has(target))
			return `new ${target}(${inner})`;
		switch (target) {
			case "string": {
				const srcType = expr.expr._type;
				if (srcType && this.isIntType(srcType))
					return `String.fromCodePoint(${inner})`;
				if (srcType?.kind === "slice" && srcType.elem?.name === "int")
					return `${inner}.map(c => String.fromCharCode(c)).join("")`;
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
	},
};
