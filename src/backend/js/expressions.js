import {
	closureMutates,
	fnMutates,
	nodeMutatesVar,
	nodeWritesVar,
	rootIdentName,
} from "../../lower/index.js";
import {
	ERROR,
	isComplex,
	isTypedArraySlice,
	typedArrayConstructorForElem,
} from "../../typechecker/types.js";

/** @typedef {import('./index.js').CodeGen} CodeGen */

export const STRICT_NUMERIC_TYPES = new Set([
	"float32",
	"int8",
	"int16",
	"int32",
	"rune",
	"uint8",
	"byte",
	"uint16",
	"uint32",
]);

export const STRICT_OPS = new Set([
	"+",
	"-",
	"*",
	"/",
	"%",
	"&",
	"|",
	"^",
	"&^",
	"<<",
	">>",
]);

// Splits a generated JS lvalue at its outermost trailing access:
// `a.b[i]` → { obj: "a.b", key: "i" }, `a.b.c` → { obj: "a.b", prop: "c" }.
function splitLastAccess(js) {
	if (js.endsWith("]")) {
		let depth = 0;
		let quote = null;
		for (let i = js.length - 1; i >= 0; i--) {
			const ch = js[i];
			if (quote) {
				if (ch === quote && js[i - 1] !== "\\") quote = null;
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") quote = ch;
			else if (ch === "]" || ch === ")") depth++;
			else if (ch === "[" || ch === "(") {
				depth--;
				if (depth === 0 && ch === "[" && i > 0)
					return { obj: js.slice(0, i), key: js.slice(i + 1, -1) };
			}
		}
		return null;
	}
	const m = /^(.*[^.])\.([A-Za-z_$][\w$]*)$/s.exec(js);
	if (!m) return null;
	// Only split when the dot is at nesting depth 0, e.g. not inside `f(a.b)`.
	let depth = 0;
	for (const ch of m[1]) {
		if (ch === "(" || ch === "[") depth++;
		else if (ch === ")" || ch === "]") depth--;
	}
	return depth === 0 ? { obj: m[1], prop: m[2] } : null;
}

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

// JavaScript precedence of the operators emitted for Go binary expressions.
const JS_OP_PREC = {
	"||": 1,
	"&&": 2,
	"|": 3,
	"^": 4,
	"&": 5,
	"==": 6,
	"!=": 6,
	"===": 6,
	"!==": 6,
	"<": 7,
	">": 7,
	"<=": 7,
	">=": 7,
	"<<": 8,
	">>": 8,
	">>>": 8,
	"+": 9,
	"-": 9,
	"*": 10,
	"/": 10,
	"%": 10,
};

function wrapForJsOp(code, childOp, parentOp, isRight) {
	if (!childOp) return code;
	const p = JS_OP_PREC[parentOp];
	const c = JS_OP_PREC[childOp];
	return (isRight ? c <= p : c < p) ? `(${code})` : code;
}

const WEB_PASCAL_ALIAS_TYPES = new Set([
	"WebGLRenderingContext",
	"WebGL2RenderingContext",
	"GPUDevice",
	"GPUQueue",
	"GPUAdapter",
]);

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

// Zero-value JS literals for basic Go types.
const ZERO_FOR_BASIC = {
	int: "0",
	uint: "0",
	int8: "0",
	int16: "0",
	int32: "0",
	int64: "0",
	uint8: "0",
	uint16: "0",
	uint32: "0",
	uint64: "0",
	uintptr: "0",
	float32: "0",
	float64: "0",
	byte: "0",
	rune: "0",
	complex64: "{ re: 0, im: 0 }",
	complex128: "{ re: 0, im: 0 }",
	string: '""',
	bool: "false",
};

// Set of all numeric type names (for type-assertion codegen).
const TYPEOF_NUMBER_NAMES = new Set([...INT_TYPE_NAMES, "float32", "float64"]);

// Builtin function codegen — keyed by builtin name, value is (self, expr) => string.
const BUILTIN_GEN = {
	append: (s, e) => s.genAppend(e),
	len: (s, e) => s._genBuiltinLen(e),
	cap: (s, e) => `(${s.genExpr(e.args[0])}?.length ?? 0)`,
	make: (s, e) => s.genMake(e),
	delete: (s, e) => {
		const [m, k] = e.args.map((a) => s.genExpr(a));
		return `(delete ${m}[${k}])`;
	},
	copy: (s, e) => {
		const [dst, src] = e.args.map((a) => s.genExpr(a));
		return `((__cd, __cs) => { if (!__cd || !__cs) return 0; const n = Math.min(__cd.length, __cs.length); if (__cd.set) { __cd.set(__cs.length === n ? __cs : (__cs.subarray ? __cs.subarray(0, n) : __cs.slice(0, n))); } else { __cd.splice(0, n, ...(__cs.slice ? __cs.slice(0, n) : __cs.subarray(0, n))); } return n; })(${dst}, ${src})`;
	},
	new: (s, e) => {
		const arg = e.args[0];
		const typeName = arg.name ?? s.getTypeName(arg);
		if (typeName && s.structNames.has(typeName)) {
			return `new ${typeName}()`;
		}
		const t = arg._type;
		if (s._isStructType(t)) {
			const name = t.name ?? (t.kind === "named" ? t.name : null);
			if (name) return `new ${name}()`;
		}
		return `{ value: ${s.zeroValueForExpr(arg)} }`;
	},
	// `print` writes without a trailing newline (Go semantics); the wasm glue
	// buffers the same way, so output parity holds across backends.
	print: (s, e) =>
		`((__s) => (typeof process !== "undefined" && process?.stdout?.write ? process.stdout.write(__s) : console.log(__s)))([${e.args.map((a) => s.genExpr(a)).join(", ")}].map(String).join(" "))`,
	println: (s, e) =>
		`console.log(${e.args.map((a) => s.genExpr(a)).join(", ")})`,
	panic: (s, e) => `(() => { throw new Error(${s.genExpr(e.args[0])}); })()`,
	recover: (s) => {
		s._usesPanicRt = true;
		return `__recover(${s._recoverOkInScope ? "__recoverOk" : "false"})`;
	},
	error: (s, e) => {
		s._usesError = true;
		return `__error(${s.genExpr(e.args[0])})`;
	},
	min: (s, e) => `Math.min(${e.args.map((a) => s.genExpr(a)).join(", ")})`,
	max: (s, e) => `Math.max(${e.args.map((a) => s.genExpr(a)).join(", ")})`,
	clear: (s, e) => s._genBuiltinClear(e),
	complex: (s, e) =>
		`{ re: ${s.genExpr(e.args[0])}, im: ${s.genExpr(e.args[1])} }`,
	real: (s, e) => `(${s.genExpr(e.args[0])}).re`,
	imag: (s, e) => `(${s.genExpr(e.args[0])}).im`,
};

// Method-name dispatch for genExpr — string values add no static call edges.
const EXPR_GEN_DELEGATE = {
	UnaryExpr: "_genUnaryExpr",
	BinaryExpr: "_genBinaryExpr",
	CallExpr: "genCall",
	SelectorExpr: "_genSelectorExpr",
	IndexExpr: "_genIndexExpr",
	SliceExpr: "_genSliceExpr",
	CompositeLit: "genCompositeLit",
	FuncLit: "_genFuncLit",
	TypeConversion: "_genTypeConversion",
	TypeAssertExpr: "_genTypeAssertExpr",
};

/** @type {ThisType<CodeGen>} */
export const expressionGenMethods = {
	genExpr(expr) {
		if (expr._ifaceBox && !expr._ifaceBoxing) {
			expr._ifaceBoxing = true;
			try {
				this._usesIfaceBox = true;
				const fn = expr._ifaceBox === "ptr" ? "__ifp" : "__ifv";
				return `${fn}(${this.genExpr(expr)})`;
			} finally {
				expr._ifaceBoxing = false;
			}
		}
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
			case "AwaitExpr":
				return `await ${this.genExpr(expr.expr)}`;
			case "InstantiationExpr":
			case "RangeExpr":
				return this.genExpr(expr.expr);
			default: {
				const m = EXPR_GEN_DELEGATE[expr.kind];
				if (m) return this[m](expr);
				throw new Error(`CodeGen: unhandled expression kind '${expr.kind}'`);
			}
		}
	},

	_isStructType(t) {
		if (!t) return false;
		if (t.name && this.structNames.has(t.name)) return true;
		const base =
			t.kind === "named"
				? (t.underlying ?? this.checker?.types.get(t.name)?.underlying)
				: t;
		if (base?.name && this.structNames.has(base.name)) return true;
		return base?.kind === "struct";
	},

	_isStructPointerType(t) {
		if (!t) return false;
		const pt =
			t.kind === "named"
				? (t.underlying ?? this.checker?.types.get(t.name)?.underlying)
				: t;
		if (pt?.kind !== "pointer") return false;
		return this._isStructType(pt.base);
	},

	_isStructExpr(expr) {
		if (!expr) return false;
		if (expr.kind === "CompositeLit") {
			const typeName = expr.typeExpr ? this.getTypeName(expr.typeExpr) : null;
			if (typeName && this.structNames.has(typeName)) return true;
		}
		return this._isStructType(expr._type);
	},

	// ── Go value semantics for structs and arrays ─────────────────

	_aggregateBase(t) {
		if (!t) return null;
		const b =
			t.kind === "named"
				? (t.underlying ?? this.checker?.types.get(t.name)?.underlying)
				: t;
		return b?.kind === "struct" || b?.kind === "array" ? b : null;
	},

	_structClassName(t) {
		const name =
			typeof t?.name === "string" ? t.name.replace(/\[.*$/, "") : null;
		return name && this.structNames.has(name) ? name : null;
	},

	// Pseudo type object for an AST type node (used where no checker type is available).
	_typeFromNode(node) {
		if (!node) return null;
		if (node.kind === "TypeName" && this.structNames.has(node.name))
			return { kind: "named", name: node.name, underlying: { kind: "struct" } };
		if (node.kind === "ArrayType")
			return { kind: "array", elem: this._typeFromNode(node.elem) };
		return null;
	},

	_cloneJs(t, js) {
		const base = this._aggregateBase(t);
		if (!base) return js;
		if (base.kind === "struct") {
			if (this._structClassName(t) || this._structClassName(base))
				return `${js}.__clone()`;
			this._usesSClone = true;
			return `__sclone(${js})`;
		}
		const elemClone = this._cloneJs(base.elem, "__e");
		return elemClone === "__e"
			? `${js}?.slice()`
			: `${js}?.map((__e) => ${elemClone})`;
	},

	_isAddressableExpr(e) {
		switch (e?.kind) {
			case "Ident":
				return e.name !== "_" && !e._isTypeRef;
			case "SelectorExpr":
				return !e._isMethodValue && !e._isMethodExpr;
			case "IndexExpr":
				return true;
			case "UnaryExpr":
				return e.op === "*";
			case "TypeAssertExpr":
				return !e._commaOk;
			default:
				return false;
		}
	},

	// Emits `expr` as a Go value: struct/array operands that alias existing storage are copied.
	genValueExpr(expr) {
		const js = this.genExpr(expr);
		if (expr._ifaceBox) return js;
		if (!this._aggregateBase(expr._type) || !this._isAddressableExpr(expr))
			return js;
		return this._cloneJs(expr._type, js);
	},

	_rootIdentName(e) {
		return rootIdentName(e);
	},

	// True when `node` itself (not its children) writes to variable `name`.
	_nodeWritesVar(node, name) {
		return nodeWritesVar(node, name);
	},

	// True when `node` may modify (or take the address of) the value held by variable `name`.
	_nodeMutatesVar(node, name, addrOnly = false) {
		return nodeMutatesVar(node, name, addrOnly);
	},

	_fnMutates(name, addrOnly = false) {
		return fnMutates(this._fnCtx?.body, name, addrOnly, this._fnCtx?.mut);
	},

	_withFnCtx(body, fn) {
		const prev = this._fnCtx;
		this._fnCtx = {
			body,
			mut: new Map(),
			owned: new Set(),
			borrowed: new Set(),
		};
		try {
			fn();
		} finally {
			this._fnCtx = prev;
		}
	},

	_markOwnership(name, owned) {
		if (!this._fnCtx || !name || name === "_") return;
		(owned ? this._fnCtx.owned : this._fnCtx.borrowed).add(name);
	},

	// Value for a newly declared local: addressable aggregates are copied (Go value semantics).
	_genDeclValue(name, rhsNode) {
		this._markOwnership(name, true);
		return this.genValueExpr(rhsNode);
	},

	// Copies aggregate params/receivers that the function body mutates.
	_emitParamCopies(params) {
		for (const p of params) {
			if (p.variadic || !p.name || p.name === "_") continue;
			const t = this._typeFromNode(p.type);
			if (!t || this._boxedVars.has(p.name)) continue;
			if (this._fnMutates(p.name)) {
				this.line(`${p.name} = ${this._cloneJs(t, p.name)};`);
				this._markOwnership(p.name, true);
			} else {
				this._markOwnership(p.name, false);
			}
		}
	},

	// An owned local can be returned without a copy unless something else may still write it.
	_genReturnValue(v) {
		const ctx = this._fnCtx;
		if (
			v.kind === "Ident" &&
			ctx?.owned.has(v.name) &&
			!ctx.borrowed.has(v.name) &&
			!this._fnMutates(v.name, true) &&
			!this._closureMutates(v.name)
		)
			return this.genExpr(v);
		return this.genValueExpr(v);
	},

	_closureMutates(name) {
		return closureMutates(this._fnCtx?.body, name, this._fnCtx?.mut);
	},

	_genUnaryExpr(expr) {
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
			if (
				this._isStructType(expr.operand._type) ||
				this._isStructExpr(expr.operand)
			) {
				return this.genExpr(expr.operand);
			}
			// For non-boxed vars (primitives, etc.), wrap in { value: x }
			return `{ value: ${this.genExpr(expr.operand)} }`;
		}
		// Dereference: *p
		if (op === "*") {
			if (this._isStructPointerType(expr.operand._type)) {
				return this.genExpr(expr.operand);
			}
			return `${this.genExpr(expr.operand)}.value`;
		}
		// Unary minus/plus on complex
		if ((op === "-" || op === "+") && isComplex(expr.operand._type)) {
			const inner = this.genExpr(expr.operand);
			if (op === "-") return `{ re: -${inner}.re, im: -${inner}.im }`;
			return inner;
		}
		const code = this.genExpr(expr.operand);
		const needsParens =
			this._emittedBinaryOp(expr.operand) !== null ||
			((op === "-" || op === "+") && /^[-+]/.test(code));
		return needsParens ? `${op}(${code})` : `${op}${code}`;
	},

	_genSelectorExpr(expr) {
		if (expr._isMethodExpr) {
			return `((recv, ...args) => recv.${expr.field}(...args))`;
		}
		if (expr.expr.kind === "Ident") {
			const nsConst = NS_CONSTANTS[expr.expr.name]?.[expr.field];
			if (nsConst !== undefined) return nsConst;
		}
		const base = this.genExpr(expr.expr);
		if (this.bundledPackages.has(base)) return expr.field;
		if (expr.expr._type?.kind === "pointer" && expr.field !== "value")
			return this._genPointerSelectorField(expr, base);
		const sel = `${base}.${this._jsMemberName(expr)}`;
		if (expr._isMethodValue && !expr._callee) return `${sel}.bind(${base})`;
		return sel;
	},

	// PascalCase aliases of Web API methods (gl.ClearColor) map to the real camelCase member.
	_jsMemberName(expr) {
		const f = expr.field;
		const t = expr.expr._type;
		if (
			t?.kind === "named" &&
			WEB_PASCAL_ALIAS_TYPES.has(t.name) &&
			/^[A-Z]/.test(f) &&
			/[a-z]/.test(f)
		) {
			const camel = f[0].toLowerCase() + f.slice(1);
			if (t.underlying?.methods?.has(camel)) return camel;
		}
		return f;
	},

	_genPointerSelectorField(expr, base) {
		if (this._isStructPointerType(expr.expr._type)) {
			const sel = `${base}.${expr.field}`;
			if (expr._isMethodValue && !expr._callee) return `${sel}.bind(${base})`;
			return sel;
		}
		const sel = `${base}.value.${expr.field}`;
		if (expr._isMethodValue && !expr._callee)
			return `${sel}.bind(${base}.value)`;
		return sel;
	},

	_genIndexExpr(expr) {
		const exprType = expr.expr._type;
		const wrapField = this._namedWrapperField(exprType, expr.expr);
		const base = wrapField
			? `${this.genExpr(expr.expr)}.${wrapField}`
			: this.genExpr(expr.expr);
		const idx = this.genExpr(expr.index);
		if (expr._mapValueType && !expr._lvalue)
			return this._genMapIndexExpr(expr, base, idx);
		if (this._isStringExprType(exprType) && !expr._lvalue)
			return `${base}.charCodeAt(${idx})`;
		return `${base}[${idx}]`;
	},

	_genMapIndexExpr(expr, base, idx) {
		const zero = this.zeroValueForType(expr._mapValueType);
		if (this._hasCallExpr(expr.expr) || this._hasCallExpr(expr.index))
			return `((__m, __k) => __m[__k] ?? ${zero})(${base}, ${idx})`;
		return `(${base}[${idx}] ?? ${zero})`;
	},

	_isStringExprType(exprType) {
		return (
			(exprType?.kind === "basic" && exprType.name === "string") ||
			(exprType?.kind === "untyped" && exprType.base === "string")
		);
	},

	_genSliceExpr(expr) {
		const base = this.genExpr(expr.expr);
		const lo = expr.low ? this.genExpr(expr.low) : "";
		const hi = expr.high ? this.genExpr(expr.high) : "";
		const method = isTypedArraySlice(expr.expr._type) ? "subarray" : "slice";
		if (!lo && !hi) return `${base}.${method}()`;
		if (!hi) return `${base}.${method}(${lo})`;
		if (!lo) return `${base}.${method}(0, ${hi})`;
		return `${base}.${method}(${lo}, ${hi})`;
	},

	_genFuncLit(expr) {
		const params = expr.params.map((p) => p.name).join(", ");
		const asyncPrefix = expr.async ? "async " : "";
		const saved = this.out;
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set(prevBoxed); // inherit parent's boxed vars (closures)
		this._scanAddressTaken(expr.body);
		this.out = [];
		this._withFnCtx(expr.body, () =>
			this.indented(() => {
				this._emitParamCopies(expr.params);
				this._genBody(expr.body, expr);
			}),
		);
		const body = this.out.join("\n");
		this.out = saved;
		this._boxedVars = prevBoxed;
		return `${asyncPrefix}function(${params}) {\n${body}\n${"  ".repeat(this.indent)}}`;
	},

	_genTypeAssertExpr(expr) {
		const src = this.genExpr(expr.expr);
		// The operand appears in both the check and the result; hoist calls so
		// they run once.
		const hoist = this._hasCallExpr(expr.expr);
		const val = hoist ? "__v" : src;
		const check = this._typeCheckExpr(expr.type, val);
		const wrap = (body) => (hoist ? `((__v) => ${body})(${src})` : body);
		if (!expr._commaOk) {
			// plain assertion: panic if check fails (matches Go behavior)
			if (check === "true") return src; // can't check at runtime — pass through
			return wrap(
				`(${check} ? ${val} : (() => { throw new Error("interface conversion: type assertion failed"); })())`,
			);
		}
		// comma-ok: emit [value-or-zero, runtimeTypeCheck]
		const zero = this.zeroValueForTypeNode(expr.type);
		return wrap(`(${check} ? [${val}, true] : [${zero}, false])`);
	},

	_genTypeConversionCall(expr) {
		const name = expr._conversionTargetType?.name;
		const arg = this.genExpr(expr.args[0]);
		if (name && this.namedWrapperNames.has(name)) return `new ${name}(${arg})`;
		return arg;
	},

	genCall(expr) {
		if (expr._isTypeConversion) return this._genTypeConversionCall(expr);

		const funcExpr =
			expr.func.kind === "InstantiationExpr" ? expr.func.expr : expr.func;
		if (funcExpr.kind === "Ident") {
			const builtin = this._genBuiltinIdent(funcExpr.name, expr);
			if (builtin !== undefined) return builtin;
		}

		if (expr.func.kind === "SelectorExpr") {
			const result = this._genSelectorCall(expr);
			if (result !== undefined) return result;
		}

		expr.func._callee = true;
		const rawFn = this.genExpr(expr.func);
		const fn = expr.func.kind === "FuncLit" ? `(${rawFn})` : rawFn;
		if (expr._multiForward) return `${fn}(...${this.genExpr(expr.args[0])})`;
		const args = expr.args
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)))
			.join(", ");
		return `${fn}(${args})`;
	},

	_isErrorInterfaceType(t) {
		return t?.kind === "named" && t?.underlying?.kind === "interface";
	},

	_isErrorType(t) {
		return (
			t && (t === ERROR || t?.name === "error" || this._isErrorInterfaceType(t))
		);
	},

	_isErrorMethodCall(expr) {
		if (expr.func.field !== "Error") return false;
		return this._isErrorType(expr.func.expr._type);
	},

	_resolveRecvName(recvType) {
		return recvType?.name ?? recvType?.base?.name;
	},

	_genReceiverTypeCall(recvName, expr) {
		if (recvName === "strings.Builder" || recvName === "bytes.Buffer")
			return this._genBuilderCall(recvName, expr.func.field, expr);
		if (recvName === "regexp.Regexp")
			return this._genRegexpMethodCall(expr.func.field, expr);
		if (recvName === "time.Time")
			return this._genTimeMethodCall(expr.func.field, expr);
		if (recvName === "testing.T")
			return this._genTestingMethodCall(expr.func.field, expr);
		return undefined;
	},

	_genSelectorCall(expr) {
		if (this._isErrorMethodCall(expr)) {
			const recv = this.genExpr(expr.func.expr);
			if (!this.strict) return `${recv}.Error()`;
			this._usesNilCall = true;
			return `__nilcall(${recv}).Error()`;
		}
		if (expr.func.expr.kind === "Ident") {
			const ns = expr.func.expr.name;
			const fn = expr.func.field;
			const result = this._genStdlibCall(ns, fn, expr);
			if (result !== undefined) return result;
		}
		const recvType = expr.func.expr._type;
		const recvName = this._resolveRecvName(recvType);
		const typed = this._genReceiverTypeCall(recvName, expr);
		if (typed !== undefined) return typed;
		if (this.strict && this._isInterfaceType(recvType)) {
			// Go panics with a nil-dereference runtime error; JS would throw a
			// TypeError with a different message.
			this._usesNilCall = true;
			const recv = this.genExpr(expr.func.expr);
			const args = expr.args
				.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)))
				.join(", ");
			return `__nilcall(${recv}).${expr.func.field}(${args})`;
		}
		return undefined;
	},

	_isInterfaceType(t) {
		if (!t) return false;
		if (t.kind === "interface") return true;
		return t.kind === "named" && t.underlying?.kind === "interface";
	},

	_genBuiltinLen(expr) {
		if (expr._constLen != null) return String(expr._constLen);
		const arg = expr.args[0];
		const t = arg?._type;
		const wrapField = this._namedWrapperField(t, arg);
		if (wrapField) return `${this.genExpr(arg)}.${wrapField}.length`;
		const js = this.genExpr(arg);
		if (t?.kind === "map") return `Object.keys(${js}).length`;
		this._usesLen = true;
		return `__len(${js})`;
	},

	_genBuiltinClear(expr) {
		const arg = expr.args[0];
		const t = arg?._type;
		const js = this.genExpr(arg);
		if (
			t?.kind === "map" ||
			(t?.kind === "named" && t.underlying?.kind === "map")
		)
			return `((__m) => { for (const __k in __m) delete __m[__k]; })(${js})`;
		return `(${js}).length = 0`;
	},

	_genBuiltinIdent(name, expr) {
		const gen = BUILTIN_GEN[name];
		return gen ? gen(this, expr) : undefined;
	},

	genAppend(expr) {
		const retType = expr._type;
		const wrapField = this._namedWrapperField(retType, expr.args[0]);
		if (wrapField) {
			// Named slice wrapper: append(g, x) → new G(__append(g._items, x))
			const sliceJS = `${this.genExpr(expr.args[0])}.${wrapField}`;
			const elems = expr.args
				.slice(1)
				.map((a) =>
					a._spread ? `...${this.genExpr(a)}` : this.genValueExpr(a),
				);
			if (elems.length === 0) return this.genExpr(expr.args[0]);
			this._usesAppend = true;
			return `new ${retType.name}(__append(${sliceJS}, ${elems.join(", ")}))`;
		}
		const slice = this.genExpr(expr.args[0]);
		const elems = expr.args
			.slice(1)
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genValueExpr(a)));
		if (elems.length === 0) return slice;
		this._usesAppend = true;
		const sliceType = expr._type ?? expr.args[0]._type;
		const typedCtor = isTypedArraySlice(sliceType)
			? typedArrayConstructorForElem(
					(sliceType.kind === "named" ? sliceType.underlying : sliceType).elem,
				)
			: null;
		if (typedCtor)
			return `__append((${slice}) ?? new ${typedCtor}(0), ${elems.join(", ")})`;
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
			const elemNode = typeNode.kind === "SliceType" ? typeNode.elem : null;
			const elemResolved =
				typeArg._type?.kind === "slice" ? typeArg._type.elem : null;
			const typedCtor =
				typedArrayConstructorForElem(elemResolved) ??
				(elemNode?.name
					? typedArrayConstructorForElem({
							kind: "basic",
							name: elemNode.name,
						})
					: null);
			if (typedCtor) {
				return `new ${typedCtor}(${n})`;
			}
			// Use the proper zero value for the element type (e.g. new Point() not 0)
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

	_isSliceOrArrayType(t) {
		return t?.kind === "SliceType" || t?.kind === "ArrayType";
	},

	_isMapTypeNode(t) {
		return t?.kind === "MapType";
	},

	_genMapLitEntries(elems) {
		return elems
			.map((e) => {
				if (e.kind === "KeyValueExpr") {
					const k =
						e.key.litKind === "STRING"
							? JSON.stringify(e.key.value)
							: `[${this.genExpr(e.key)}]`;
					return `${k}: ${this.genValueExpr(e.value)}`;
				}
				return this.genValueExpr(e);
			})
			.join(", ");
	},

	_genFallbackCompositeLit(expr) {
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

	_fillPositionalStructElems(fields, expr, values) {
		let maxIdx = -1;
		for (let i = 0; i < expr.elems.length; i++) {
			const e = expr.elems[i];
			const name =
				e._positionalField ??
				(e.kind === "KeyValueExpr"
					? (e.key.name ?? this.genExpr(e.key))
					: null);
			const idx = name ? fields.findIndex((f) => f.name === name) : i;
			if (idx >= 0 && idx < fields.length) {
				values[idx] = this.genValueExpr(
					e.kind === "KeyValueExpr" ? e.value : e,
				);
				if (idx > maxIdx) maxIdx = idx;
			}
		}
		return maxIdx;
	},

	_fillEmbedField(fields, ef, e, values) {
		const idx = fields.findIndex((f) => f.name === ef);
		if (idx < 0) return -1;
		if (e.value.kind === "CompositeLit") {
			const match = e.value.elems.find(
				(ce) => (ce._positionalField ?? ce.key?.name) === ef,
			);
			values[idx] = match
				? this.genValueExpr(match.value ?? match)
				: fields[idx].zero;
		} else {
			values[idx] = `${this.genExpr(e.value)}.${ef}`;
		}
		return idx;
	},

	_fillKeyedStructElems(fields, expr, values) {
		let maxIdx = -1;
		for (const e of expr.elems) {
			if (e.kind !== "KeyValueExpr") continue;
			const k = e.key.name ?? this.genExpr(e.key);
			if (e._isEmbedInit) {
				const embedType = this.checker?.types.get(k)?.underlying;
				const embedFields =
					embedType?.kind === "struct" ? [...embedType.fields.keys()] : [];
				for (const ef of embedFields) {
					const idx = this._fillEmbedField(fields, ef, e, values);
					if (idx > maxIdx) maxIdx = idx;
				}
			} else {
				const idx = fields.findIndex((f) => f.name === k);
				if (idx >= 0) {
					values[idx] = this.genValueExpr(e.value);
					if (idx > maxIdx) maxIdx = idx;
				}
			}
		}
		return maxIdx;
	},

	_genPositionalStructLit(typeName, expr) {
		const fields = this.getStructFields(typeName);
		if (!fields || fields.length === 0 || expr.elems.length === 0) {
			return `new ${typeName}()`;
		}
		const values = fields.map((f) => f.zero);
		const hasPositional = expr.elems.some(
			(e) => e._positionalField || e.kind !== "KeyValueExpr",
		);
		const maxExplicitIdx = hasPositional
			? this._fillPositionalStructElems(fields, expr, values)
			: this._fillKeyedStructElems(fields, expr, values);
		if (maxExplicitIdx < 0) {
			return `new ${typeName}()`;
		}
		const args = values.slice(0, maxExplicitIdx + 1);
		return `new ${typeName}(${args.join(", ")})`;
	},

	genCompositeLit(expr) {
		const t = expr.typeExpr;
		if (t === null) return this._genImplicitCompositeLit(expr);
		const typeName = this.getTypeName(t);
		if (typeName && this.structNames.has(typeName))
			return this._genPositionalStructLit(typeName, expr);
		if (typeName && this.namedWrapperNames.has(typeName))
			return this._genNamedWrapperLit(typeName, expr);
		if (expr.elems.some((e) => e._positionalField)) {
			if (typeName) return this._genPositionalStructLit(typeName, expr);
		}
		if (this._isSliceOrArrayType(t)) {
			const elems = expr.elems
				.map((e) => this.genValueExpr(e.kind === "KeyValueExpr" ? e.value : e))
				.join(", ");
			const elemNode =
				t.kind === "SliceType" || t.kind === "ArrayType" ? t.elem : null;
			const elemResolved =
				expr._type?.kind === "slice" || expr._type?.kind === "array"
					? expr._type.elem
					: null;
			const typedCtor =
				typedArrayConstructorForElem(elemResolved) ??
				(elemNode?.name
					? typedArrayConstructorForElem({
							kind: "basic",
							name: elemNode.name,
						})
					: null);
			if (typedCtor) {
				return `new ${typedCtor}([${elems}])`;
			}
			return `[${elems}]`;
		}
		if (this._isMapTypeNode(t))
			return `{ ${this._genMapLitEntries(expr.elems)} }`;
		return this._genFallbackCompositeLit(expr);
	},

	_genImplicitCompositeLit(expr) {
		const typeName = expr._type?.name ?? expr._type?.underlying?.name;
		if (typeName && this.structNames.has(typeName)) {
			return this._genPositionalStructLit(typeName, expr);
		}
		const hasPositional = expr.elems.some((e) => e._positionalField);
		const hasKeyed = expr.elems.some((e) => e.kind === "KeyValueExpr");
		if (hasPositional || hasKeyed) {
			const fields = expr.elems
				.map((e) => {
					if (e._positionalField)
						return `${e._positionalField}: ${this.genValueExpr(e)}`;
					return `${e.key.name ?? this.genExpr(e.key)}: ${this.genValueExpr(e.value)}`;
				})
				.join(", ");
			return `{ ${fields} }`;
		}
		const elems = expr.elems.map((e) => this.genValueExpr(e)).join(", ");
		if (isTypedArraySlice(expr._type)) {
			const typedCtor = typedArrayConstructorForElem(expr._type.elem);
			if (typedCtor) return `new ${typedCtor}([${elems}])`;
		}
		return `[${elems}]`;
	},

	_genNamedWrapperLit(typeName, expr) {
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
						return `${k}: ${this.genValueExpr(e.value)}`;
					}
					return this.genValueExpr(e);
				})
				.join(", ");
			return `new ${typeName}({ ${entries} })`;
		}
		// Default: slice
		const elems = expr.elems
			.map((e) => this.genValueExpr(e.kind === "KeyValueExpr" ? e.value : e))
			.join(", ");
		return `new ${typeName}([${elems}])`;
	},

	// ── Helpers ───────────────────────────────────────────────────

	_genComplexOperand(expr) {
		if (isComplex(expr._type)) return this.genExpr(expr);
		return `{ re: ${this.genExpr(expr)}, im: 0 }`;
	},

	getTypeName(typeNode) {
		if (!typeNode) return null;
		if (typeNode.kind === "TypeName") return this._dequalify(typeNode.name);
		if (typeNode.kind === "GenericTypeName") return typeNode.name;
		if (typeNode.kind === "Ident") return typeNode.name;
		if (typeNode.kind === "InstantiationExpr")
			return this.getTypeName(typeNode.expr);
		if (typeNode.kind === "SelectorExpr") {
			const base = this.getTypeName(typeNode.expr);
			if (this.bundledPackages.has(base)) return typeNode.field;
			return `${base}.${typeNode.field}`;
		}
		return null;
	},

	// Bundled GoFront packages are inlined, so `pkg.T` names the class `T`.
	_dequalify(name) {
		const dot = name.indexOf(".");
		if (dot < 0) return name;
		return this.bundledPackages.has(name.slice(0, dot))
			? name.slice(dot + 1)
			: name;
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
		return Object.hasOwn(ZERO_FOR_BASIC, name) ? ZERO_FOR_BASIC[name] : null;
	},

	_zeroForNamedType(name) {
		if (name === "strings.Builder") return '{ _buf: "" }';
		if (name === "bytes.Buffer") return "{ _buf: [] }";
		name = this._dequalify(name);
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
			case "ArrayType": {
				const n = Number(typeNode.size?.value ?? 0) || 0;
				const ctor = typeNode.elem?.name
					? typedArrayConstructorForElem({
							kind: "basic",
							name: typeNode.elem.name,
						})
					: null;
				return this._arrayZero(
					n,
					ctor,
					this.zeroValueForTypeNode(typeNode.elem),
				);
			}
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

	_arrayZero(n, ctor, elemZero) {
		if (ctor) return `new ${ctor}(${n})`;
		if (n === 0) return "[]";
		if (/^(new |\{|\[|Array)/.test(elemZero))
			return `Array.from({ length: ${n} }, () => ${elemZero})`;
		return `new Array(${n}).fill(${elemZero})`;
	},

	// zeroValueForType operates on typechecker type objects (not AST type nodes).
	zeroValueForType(t) {
		if (!t) return "null";
		switch (t.kind) {
			case "basic":
				return this._zeroForBasicName(t.name) ?? "null";
			case "slice":
				return "null";
			case "array":
				return this._arrayZero(
					Number(t.size ?? 0) || 0,
					typedArrayConstructorForElem(t.elem),
					this.zeroValueForType(t.elem),
				);
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
			const name = typeNode.name;
			if (TYPEOF_NUMBER_NAMES.has(name)) return `typeof ${val} === "number"`;
			if (name === "string") return `typeof ${val} === "string"`;
			if (name === "bool") return `typeof ${val} === "boolean"`;
			if (name === "nil") return `${val} === null`;
			if (name === "error")
				return `(typeof ${val} === "object" && ${val} !== null && typeof ${val}.Error === "function")`;
			if (this.structNames.has(name))
				return `(${val} instanceof ${name} && ${val}.__p !== true)`;
			return "true"; // unknown type — can't check at runtime
		}
		if (
			typeNode.kind === "PointerType" &&
			typeNode.base?.kind === "TypeName" &&
			this.structNames.has(typeNode.base.name)
		) {
			const name = typeNode.base.name;
			return `(${val} instanceof ${name} && ${val}.__v !== true)`;
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

	_genComplexBinary(expr) {
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
	},

	_genBinaryExpr(expr) {
		if (
			isComplex(expr._type) ||
			isComplex(expr.left._type) ||
			isComplex(expr.right._type)
		)
			return this._genComplexBinary(expr);

		if (this._isStructEquality(expr)) {
			this._usesEqual = true;
			const cmp = `__equal(${this.genExpr(expr.left)}, ${this.genExpr(expr.right)})`;
			return expr.op === "==" ? cmp : `!${cmp}`;
		}

		if (this.strict && this._needsStrictOp(expr.op, expr._type)) {
			const l = this.genExpr(expr.left);
			const r = this.genExpr(expr.right);
			return this._genStrictBinary(expr.op, l, r, expr._type);
		}

		const jsOp = this._emittedBinaryOp(expr) ?? "/";
		const operand = (child, isRight) =>
			wrapForJsOp(
				this.genExpr(child),
				this._emittedBinaryOp(child),
				jsOp,
				isRight,
			);
		const l = operand(expr.left, false);

		if (expr.op === "&^") {
			const rCode = this.genExpr(expr.right);
			const r =
				this._emittedBinaryOp(expr.right) !== null ? `(${rCode})` : rCode;
			return `${l} & ~${r}`;
		}
		const r = operand(expr.right, true);
		if (this._isIntDivision(expr)) return `Math.trunc(${l} / ${r})`;
		return `${l} ${jsOp} ${r}`;
	},

	_isStructEquality(expr) {
		return (
			(expr.op === "==" || expr.op === "!=") &&
			this._isStructOrArrayType(expr.left._type)
		);
	},

	_isIntDivision(expr) {
		return (
			expr.op === "/" &&
			this.isIntType(expr.left._type) &&
			this.isIntType(expr.right._type)
		);
	},

	_isNilLiteral(expr) {
		return (
			(expr.kind === "Ident" && expr.name === "nil") ||
			(expr.kind === "BasicLit" && expr.value === "null")
		);
	},

	// Top-level JS operator a BinaryExpr compiles to, or null when the output is atomic.
	_emittedBinaryOp(expr) {
		if (expr?.kind !== "BinaryExpr") return null;
		if (
			isComplex(expr._type) ||
			isComplex(expr.left._type) ||
			isComplex(expr.right._type)
		)
			return null;
		if (this._isStructEquality(expr) || this._isIntDivision(expr)) return null;
		if (expr.op === "&^") return "&";
		if (expr.op === "==" || expr.op === "!=") {
			if (this._isNilLiteral(expr.left) || this._isNilLiteral(expr.right))
				return expr.op;
			return expr.op === "==" ? "===" : "!==";
		}
		return expr.op;
	},

	_genTypeConversion(expr) {
		const inner = this.genExpr(expr.expr);
		const t = expr.targetType;
		if (t?.name === "complex128" || t?.name === "complex64") {
			return isComplex(expr.expr._type) ? inner : `{ re: ${inner}, im: 0 }`;
		}
		if (t?.kind === "ArrayType")
			return this._genArrayTypeConversion(expr, inner, t);
		if (t?.kind === "SliceType")
			return this._genSliceTypeConversion(expr, inner, t);
		const target = t?.name;
		if (target === "error") {
			this._usesError = true;
			return `__error(${inner})`;
		}
		if (target && this.namedWrapperNames.has(target))
			return `new ${target}(${inner})`;
		return this._genPrimitiveConversion(expr, inner, target);
	},

	_genArrayTypeConversion(expr, inner, t) {
		const srcResolved =
			expr.expr._type?.kind === "named"
				? expr.expr._type.underlying
				: expr.expr._type;
		if (srcResolved?.kind === "slice") {
			const size = t.size?.value !== undefined ? Number(t.size.value) : t.size;
			return `${inner}.slice(0, ${size})`;
		}
		return inner;
	},

	_isStringSource(srcType) {
		return (
			(srcType?.kind === "basic" && srcType?.name === "string") ||
			(srcType?.kind === "untyped" && srcType?.base === "string")
		);
	},

	_genSliceTypeConversion(expr, inner, t) {
		const elem = t.elem?.name;
		if (elem === "byte" || elem === "uint8") {
			if (this._isStringSource(expr.expr._type))
				return `new TextEncoder().encode(${inner})`;
			return `new Uint8Array(${inner})`;
		}
		const typedCtor = typedArrayConstructorForElem(
			t.elem ? { kind: "basic", name: t.elem.name } : null,
		);
		const fromString = this._isStringSource(expr.expr._type);
		if (typedCtor) {
			return fromString
				? `${typedCtor}.from(${inner}, __c => __c.codePointAt(0))`
				: `new ${typedCtor}(${inner})`;
		}
		if ((elem === "rune" || elem === "int32" || elem === "int") && fromString)
			return `Array.from(${inner}, __c => __c.codePointAt(0))`;
		return `Array.from(${inner})`;
	},

	_genStringConversion(srcType, inner) {
		if (srcType && this.isIntType(srcType))
			return `String.fromCodePoint(${inner})`;
		if (srcType?.kind === "slice") {
			const elem = srcType.elem?.name;
			if (elem === "byte" || elem === "uint8")
				return `new TextDecoder().decode(new Uint8Array(${inner}))`;
			if (elem === "rune" || elem === "int" || elem === "int32")
				return `Array.from(${inner}, c => String.fromCodePoint(c)).join("")`;
		}
		return `String(${inner})`;
	},

	_genPrimitiveConversion(expr, inner, target) {
		switch (target) {
			case "string":
				return this._genStringConversion(expr.expr._type, inner);
			case "int":
			case "int64":
			case "uint":
			case "uint64":
			case "uintptr":
				return `Math.trunc(Number(${inner}))`;
			case "int8":
				return `(Number(${inner}) << 24 >> 24)`;
			case "int16":
				return `(Number(${inner}) << 16 >> 16)`;
			case "int32":
			case "rune":
				return `(Number(${inner}) | 0)`;
			case "uint8":
			case "byte":
				return `(Number(${inner}) & 0xFF)`;
			case "uint16":
				return `(Number(${inner}) & 0xFFFF)`;
			case "uint32":
				return `(Number(${inner}) >>> 0)`;
			case "float32":
				return `Math.fround(Number(${inner}))`;
			case "float64":
				return `Number(${inner})`;
			case "bool":
				return `Boolean(${inner})`;
			default:
				return inner;
		}
	},

	_typeName(t) {
		if (!t) return null;
		if (t.kind === "untyped") return t.base;
		if (t.kind === "named") return this._typeName(t.underlying);
		if (t.kind === "basic") return t.name;
		return null;
	},

	_isStrictAtomicOp(_op, typeName) {
		return STRICT_NUMERIC_TYPES.has(typeName);
	},

	_needsStrictOp(op, type) {
		if (!STRICT_OPS.has(op)) return false;
		if (this._isStrictAtomicOp(op, this._typeName(type))) return true;
		return this.isIntType(type) && (op === "/" || op === "%");
	},

	// Emits `lhs = strict(lhs op rhs)` for any lvalue shape; returns false when not applicable.
	// Indexed / nested targets are split into object + key temps so sub-expressions run once.
	_genStrictCompound(lhsNode, op, rhsJs, srcLine = null, lhsJs = null) {
		const type = lhsNode._type;
		if (!this._needsStrictOp(op, type)) return false;
		if (lhsNode.kind === "IndexExpr" && lhsNode.expr?._type?.kind === "map")
			return false;
		const l = lhsJs ?? this._genAssignLhsExpr(lhsNode);
		if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(l)) {
			this.line(
				`${l} = ${this._genStrictBinary(op, l, rhsJs, type)};`,
				srcLine,
			);
			return true;
		}
		const split = splitLastAccess(l);
		if (!split) return false;
		this._tmpCounter = (this._tmpCounter ?? 0) + 1;
		const o = `__o${this._tmpCounter}`;
		if (split.key != null) {
			const k = `__k${this._tmpCounter}`;
			const target = `${o}[${k}]`;
			this.line(
				`{ const ${o} = ${split.obj}, ${k} = ${split.key}; ${target} = ${this._genStrictBinary(op, target, rhsJs, type)}; }`,
				srcLine,
			);
		} else {
			const target = `${o}.${split.prop}`;
			this.line(
				`{ const ${o} = ${split.obj}; ${target} = ${this._genStrictBinary(op, target, rhsJs, type)}; }`,
				srcLine,
			);
		}
		return true;
	},

	_genStrictBinary(op, l, r, type) {
		const tName = this._typeName(type);
		if (tName === "float32") {
			return `Math.fround(${l} ${op} ${r})`;
		}
		if (tName === "int32" || tName === "rune") {
			if (op === "*") return `Math.imul(${l}, ${r})`;
			if (op === "/")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (Math.trunc((${l}) / (${r})) | 0))`;
			if (op === "%")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (((${l}) % (${r})) | 0))`;
			if (op === "<<" || op === ">>") {
				return `((${r}) >= 32 ? (${op === ">>" ? `((${l}) < 0 ? -1 : 0)` : "0"}) : ((${l}) ${op} (${r}))) | 0`;
			}
			if (op === "&^") return `((${l}) & ~(${r})) | 0`;
			return `((${l} ${op} ${r}) | 0)`;
		}
		if (tName === "uint32") {
			if (op === "/")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (Math.trunc((${l}) / (${r})) >>> 0))`;
			if (op === "%")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (((${l}) % (${r})) >>> 0))`;
			if (op === "<<" || op === ">>") {
				const jsOp = op === ">>" ? ">>>" : "<<";
				return `((${r}) >= 32 ? 0 : ((${l}) ${jsOp} (${r}))) >>> 0`;
			}
			if (op === "&^") return `((${l}) & ~(${r})) >>> 0`;
			return `((${l} ${op} ${r}) >>> 0)`;
		}
		if (tName === "int8") {
			if (op === "/")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : ((Math.trunc((${l}) / (${r})) << 24) >> 24))`;
			if (op === "%")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (((((${l}) % (${r})) << 24) >> 24)))`;
			if (op === "<<" || op === ">>") {
				return `((${r}) >= 8 ? (${op === ">>" ? `((${l}) < 0 ? -1 : 0)` : "0"}) : (((${l}) ${op} (${r})) << 24 >> 24))`;
			}
			if (op === "&^") return `((((${l}) & ~(${r})) << 24) >> 24)`;
			return `((((${l} ${op} ${r})) << 24) >> 24)`;
		}
		if (tName === "int16") {
			if (op === "/")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : ((Math.trunc((${l}) / (${r})) << 16) >> 16))`;
			if (op === "%")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (((((${l}) % (${r})) << 16) >> 16)))`;
			if (op === "<<" || op === ">>") {
				return `((${r}) >= 16 ? (${op === ">>" ? `((${l}) < 0 ? -1 : 0)` : "0"}) : (((${l}) ${op} (${r})) << 16 >> 16))`;
			}
			if (op === "&^") return `((((${l}) & ~(${r})) << 16) >> 16)`;
			return `((((${l} ${op} ${r})) << 16) >> 16)`;
		}
		if (tName === "uint8" || tName === "byte") {
			if (op === "/")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (Math.trunc((${l}) / (${r})) & 0xFF))`;
			if (op === "%")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (((${l}) % (${r})) & 0xFF))`;
			if (op === "<<" || op === ">>") {
				const jsOp = op === ">>" ? ">>>" : "<<";
				return `((${r}) >= 8 ? 0 : (((${l}) ${jsOp} (${r})) & 0xFF))`;
			}
			if (op === "&^") return `(((${l}) & ~(${r})) & 0xFF)`;
			return `((${l} ${op} ${r}) & 0xFF)`;
		}
		if (tName === "uint16") {
			if (op === "/")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (Math.trunc((${l}) / (${r})) & 0xFFFF))`;
			if (op === "%")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : (((${l}) % (${r})) & 0xFFFF))`;
			if (op === "<<" || op === ">>") {
				const jsOp = op === ">>" ? ">>>" : "<<";
				return `((${r}) >= 16 ? 0 : (((${l}) ${jsOp} (${r})) & 0xFFFF))`;
			}
			if (op === "&^") return `(((${l}) & ~(${r})) & 0xFFFF)`;
			return `((${l} ${op} ${r}) & 0xFFFF)`;
		}
		if (this.isIntType(type)) {
			if (op === "/")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : Math.trunc((${l}) / (${r})))`;
			if (op === "%")
				return `((${r}) === 0 ? (() => { throw new Error("runtime error: integer divide by zero"); })() : ((${l}) % (${r})))`;
		}
		return `${l} ${op} ${r}`;
	},
};
