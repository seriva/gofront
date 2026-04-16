// CodeGen expression methods and helpers — installed as a mixin on CodeGen.prototype.

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

			case "Ident":
				return expr.name;

			case "UnaryExpr": {
				const op = expr.op === "^" ? "~" : expr.op; // bitwise NOT
				// Dereference/address-of — transparent in JS
				if (op === "*" || op === "&") return this.genExpr(expr.operand);
				return `${op}${this.genExpr(expr.operand)}`;
			}

			case "BinaryExpr": {
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
				// Go == and != are strict — map to JS === / !==
				const op =
					expr.op === "==" ? "===" : expr.op === "!=" ? "!==" : expr.op;
				return `${l} ${op} ${r}`;
			}

			case "CallExpr":
				return this.genCall(expr);

			case "SelectorExpr": {
				const base = this.genExpr(expr.expr);
				// Bundled GoFront packages are inlined — drop the qualifier.
				if (this.bundledPackages.has(base)) return expr.field;
				// Pointer types are wrapped as { value: T }; route through .value
				if (expr.expr._type?.kind === "pointer" && expr.field !== "value") {
					return `${base}.value.${expr.field}`;
				}
				return `${base}.${expr.field}`;
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
				this.out = [];
				this.indented(() => this._genBody(expr.body));
				const body = this.out.join("\n");
				this.out = saved;
				return `${asyncPrefix}function(${params}) {\n${body}\n${"  ".repeat(this.indent)}}`;
			}

			case "TypeConversion": {
				const inner = this.genExpr(expr.expr);
				const t = expr.targetType;

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
						if (srcType?.kind === "basic" && srcType?.name === "string") {
							return `Array.from(${inner}, __c => __c.codePointAt(0))`;
						}
						return `Array.from(${inner})`;
					}
					return `Array.from(${inner})`;
				}

				const target = t?.name;
				switch (target) {
					case "string":
						return `String(${inner})`;
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
				if (!expr._commaOk) return val; // unsafe assertion — just pass value through
				// comma-ok: emit [value, runtimeTypeCheck]
				const check = this._typeCheckExpr(expr.type, val);
				return `[${val}, ${check}]`;
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
		// Handle built-ins that need special JS translation
		if (expr.func.kind === "Ident") {
			switch (expr.func.name) {
				case "append":
					return this.genAppend(expr);
				case "len": {
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
					// errors are plain strings; nil (null) means no error
					const arg = this.genExpr(expr.args[0]);
					return arg;
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
			}
		}

		// error.Error() → the error string itself (errors are plain strings at runtime)
		if (
			expr.func.kind === "SelectorExpr" &&
			expr.func.field === "Error" &&
			expr.func.expr._type?.name === "error"
		) {
			return this.genExpr(expr.func.expr);
		}

		// fmt.Sprintf / fmt.Printf / fmt.Println / fmt.Print / fmt.Errorf
		if (
			expr.func.kind === "SelectorExpr" &&
			expr.func.expr.kind === "Ident" &&
			expr.func.expr.name === "fmt"
		) {
			const fmtArgs = expr.args.map((a) => this.genExpr(a)).join(", ");
			switch (expr.func.field) {
				case "Sprintf":
					this._usesSprintf = true;
					return `__sprintf(${fmtArgs})`;
				case "Errorf":
					this._usesSprintf = true;
					return `__sprintf(${fmtArgs})`;
				case "Printf":
					this._usesSprintf = true;
					return `process?.stdout?.write(__sprintf(${fmtArgs}))`;
				case "Println":
					this._usesSprintf = true;
					return `console.log(__sprintf(${fmtArgs}))`;
				case "Print":
					this._usesSprintf = true;
					return `process?.stdout?.write(__sprintf(${fmtArgs}))`;
			}
		}

		const rawFn = this.genExpr(expr.func);
		// Wrap function literals in parens so `function(){}()` → `(function(){})()`
		const fn = expr.func.kind === "FuncLit" ? `(${rawFn})` : rawFn;
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

	// Render KeyValueExpr elements as a JS field list string.
	// Handles embedded-spread (_isEmbedInit) and plain key: value pairs.
	_genStructFields(elems) {
		return elems
			.filter((e) => e.kind === "KeyValueExpr")
			.map((e) =>
				e._isEmbedInit
					? `...${this.genExpr(e.value)}`
					: `${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`,
			)
			.join(", ");
	},

	genCompositeLit(expr) {
		const t = expr.typeExpr;

		// Implicit composite literal: {X: 1} inside a slice/map — type inferred from context
		if (t === null) {
			if (expr.elems.length > 0 && expr.elems[0]?.kind === "KeyValueExpr") {
				const typeName = expr._type?.name ?? expr._type?.underlying?.name;
				if (typeName && this.structNames.has(typeName)) {
					return `new ${typeName}({ ${this._genStructFields(expr.elems)} })`;
				}
				const fields = expr.elems
					.map(
						(e) =>
							`${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`,
					)
					.join(", ");
				return `{ ${fields} }`;
			}
			return `[${expr.elems.map((e) => this.genExpr(e)).join(", ")}]`;
		}

		const typeName = this.getTypeName(t);

		// Struct: new Foo({ X: 1, Y: 2 })
		if (typeName && this.structNames.has(typeName)) {
			return `new ${typeName}({ ${this._genStructFields(expr.elems)} })`;
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

	getTypeName(typeNode) {
		if (!typeNode) return null;
		if (typeNode.kind === "TypeName") return typeNode.name;
		if (typeNode.kind === "Ident") return typeNode.name;
		if (typeNode.kind === "SelectorExpr") return typeNode.field;
		return null;
	},

	isIntType(t) {
		if (!t) return false;
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
			default:
				return "null";
		}
	},

	// zeroValueForType operates on typechecker type objects (not AST type nodes).
	zeroValueForType(t) {
		if (!t) return "null";
		switch (t.kind) {
			case "basic": {
				const basic = this._zeroForBasicName(t.name);
				return basic !== null ? basic : "null";
			}
			case "slice":
				return "null";
			case "map":
				return "{}";
			case "named":
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
					return `typeof ${val} === "string"`;
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
};
