import {
	closureMutates,
	fnMutates,
	nodeMutatesVar,
	nodeWritesVar,
	rootIdentName,
	someChild,
} from "../../lower/index.js";
import { constIntValue } from "../../typechecker/const-fold.js";
import {
	BROWSER_GLOBALS,
	compositeLitIndices,
	ERROR,
	isAny,
	isComplex,
	isTypedArraySlice,
	typedArrayConstructorForElem,
	typeStr,
} from "../../typechecker/types.js";

// True when `node` compares the identifier `name` with nil (`l == nil`): a
// pointer-receiver method that does so is meant to run on a nil receiver.
export function comparesToNil(node, name) {
	if (Array.isArray(node)) return node.some((n) => comparesToNil(n, name));
	if (!node || typeof node !== "object") return false;
	if (node.kind === "BinaryExpr" && (node.op === "==" || node.op === "!=")) {
		const isRecv = (e) => e?.kind === "Ident" && e.name === name;
		const isNil = (e) =>
			(e?.kind === "Ident" && e.name === "nil") ||
			(e?.kind === "BasicLit" && e.litKind === "NIL");
		if (
			(isRecv(node.left) && isNil(node.right)) ||
			(isRecv(node.right) && isNil(node.left))
		)
			return true;
	}
	return someChild(node, (c) => comparesToNil(c, name));
}

/** @typedef {import('./index.js').CodeGen} CodeGen */

// True when type `t` mentions a type parameter anywhere.
export function mentionsTypeParam(t, depth = 0) {
	if (!t || depth > 16) return false;
	switch (t.kind) {
		case "typeParam":
			return true;
		case "slice":
		case "array":
			return mentionsTypeParam(t.elem, depth + 1);
		case "pointer":
			return mentionsTypeParam(t.base, depth + 1);
		case "map":
			return (
				mentionsTypeParam(t.key, depth + 1) ||
				mentionsTypeParam(t.value, depth + 1)
			);
		case "func":
			return [...t.params, ...t.returns].some((x) =>
				mentionsTypeParam(x, depth + 1),
			);
		case "named":
			return (t.typeArgs ?? []).some((x) => mentionsTypeParam(x, depth + 1));
		default:
			return false;
	}
}

// How an instance of a generic struct is identified at run time: the type
// arguments' printed form, kept after the zero-value factories in the
// instance's `__tz` array.  Null when an argument is a type parameter (the
// instantiation is not known inside erased generic code).
export function instanceId(typeArgs) {
	if (!typeArgs?.length || typeArgs.some((t) => mentionsTypeParam(t)))
		return null;
	return typeArgs.map(typeStr).join(",");
}

// Array literals longer than this that leave most slots zero are emitted as
// the zero array plus assignments (_genSparseArrayLit).
const SPARSE_ARRAY_MIN = 32;

const STRICT_NUMERIC_TYPES = new Set([
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

// Unsigned types narrower than 64 bits: `-x` and `^x` wrap back into range.
const SMALL_UNSIGNED_WRAP = {
	uint8: "& 0xFF",
	byte: "& 0xFF",
	uint16: "& 0xFFFF",
	uint32: ">>> 0",
};

// Signed types narrower than 64 bits: `-x` wraps back into range.
const SIGNED_NEG_WRAP = {
	int8: "<< 24 >> 24",
	int16: "<< 16 >> 16",
	int32: "| 0",
	rune: "| 0",
};

// Integer types whose JS shifts must follow Go's 64-bit semantics.
const WIDE_INT_NAMES = new Set(["int", "int64", "uint", "uint64", "uintptr"]);

const STRICT_OPS = new Set([
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

function collectFunctionLabels(node, labels = new Set()) {
	if (!node || typeof node !== "object") return labels;
	if (Array.isArray(node)) {
		for (const item of node) collectFunctionLabels(item, labels);
		return labels;
	}
	if (node.kind === "LabeledStmt" && node.label) labels.add(node.label);
	if (node.kind === "ForStmt" && node.label) labels.add(node.label);
	for (const k of Object.keys(node)) {
		if (k.startsWith("_")) continue;
		collectFunctionLabels(node[k], labels);
	}
	return labels;
}

const NAMED_ZERO_TABLE = {
	"time.Time": [null, "{ _d: new Date(0), _isZero: true }"],
	"strings.Builder": [null, '{ _buf: "" }'],
	"bytes.Buffer": [null, "{ _buf: [] }"],
	"strings.Replacer": [null, "{ _p: [], Replace(s) { return s; } }"],
	"sync.Mutex": ["sync", "__sync_mutex()"],
	"sync.RWMutex": ["sync", "__sync_rwmutex()"],
	"sync.Once": ["sync", "__sync_once()"],
	"sync.WaitGroup": ["sync", "__sync_waitgroup()"],
	"binary.LittleEndian": ["binary", "__binary_le"],
	"encoding/binary.LittleEndian": ["binary", "__binary_le"],
	"binary.BigEndian": ["binary", "__binary_be"],
	"encoding/binary.BigEndian": ["binary", "__binary_be"],
	"base64.Encoding": ["base64", "__base64_std"],
	"encoding/base64.Encoding": ["base64", "__base64_std"],
	"simd.F32x4": [null, "Object.freeze([0, 0, 0, 0])"],
	F32x4: [null, "Object.freeze([0, 0, 0, 0])"],
	"simd.Mask32x4": [null, "Object.freeze([false, false, false, false])"],
	Mask32x4: [null, "Object.freeze([false, false, false, false])"],
};

// gofront/simd receiver methods -> runtime helper; the receiver is passed first.
const SIMD_VECTOR_HELPERS = {
	Add: "__simd_add",
	Sub: "__simd_sub",
	Mul: "__simd_mul",
	Div: "__simd_div",
	Min: "__simd_min",
	Max: "__simd_max",
	MulAdd: "__simd_muladd",
	Neg: "__simd_neg",
	Abs: "__simd_abs",
	Sqrt: "__simd_sqrt",
	Floor: "__simd_floor",
	Ceil: "__simd_ceil",
	Trunc: "__simd_trunc",
	RoundToEven: "__simd_nearest",
	Dot3: "__simd_dot3",
	Dot4: "__simd_dot4",
	Sum: "__simd_sum",
	WithLane: "__simd_with_lane",
	Swizzle: "__simd_swizzle",
	Equal: "__simd_eq",
	NotEqual: "__simd_ne",
	Less: "__simd_lt",
	LessEqual: "__simd_le",
	Greater: "__simd_gt",
	GreaterEqual: "__simd_ge",
};

const SIMD_MASK_HELPERS = {
	And: "__simd_mask_and",
	Or: "__simd_mask_or",
	Xor: "__simd_mask_xor",
	AndNot: "__simd_mask_andnot",
	Not: "__simd_mask_not",
	Any: "__simd_mask_any",
	All: "__simd_mask_all",
	Bits: "__simd_mask_bits",
};

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
		Phi: "1.618033988749895",
		Sqrt2: "Math.SQRT2",
		SqrtE: "1.6487212707001282",
		SqrtPi: "1.7724538509055159",
		SqrtPhi: "1.272019649514069",
		Ln2: "Math.LN2",
		Log2E: "Math.LOG2E",
		Ln10: "Math.LN10",
		Log10E: "Math.LOG10E",
		MaxFloat32: "3.4028234663852886e38",
		SmallestNonzeroFloat32: "1.401298464324817e-45",
		MaxFloat64: "Number.MAX_VALUE",
		SmallestNonzeroFloat64: "Number.MIN_VALUE",
		MaxInt: "Number.MAX_SAFE_INTEGER",
		MinInt: "Number.MIN_SAFE_INTEGER",
		MaxInt8: "127",
		MinInt8: "-128",
		MaxInt16: "32767",
		MinInt16: "-32768",
		MaxInt32: "2147483647",
		MinInt32: "-2147483648",
		MaxInt64: "9223372036854775807",
		MinInt64: "-9223372036854775808",
		MaxUint8: "255",
		MaxUint16: "65535",
		MaxUint32: "4294967295",
		MaxUint: "18446744073709551615",
		MaxUint64: "18446744073709551615",
	},
	strconv: {
		ErrSyntax: "__strconv_err_syntax",
		ErrRange: "__strconv_err_range",
	},
	bits: {
		UintSize: "64",
	},
	path: {
		ErrBadPattern: "__path_err_bad_pattern",
	},
	filepath: {
		ErrBadPattern: "__path_err_bad_pattern",
	},
	io: {
		EOF: "__io_eof",
		Discard:
			"{ WriteString(s) { return [s.length, null]; }, Write(b) { return [b.length, null]; } }",
	},
	sha256: {
		Size: "32",
		BlockSize: "64",
	},
	hex: {
		ErrLength: '__error("encoding/hex: odd length hex string")',
	},
	base64: {
		StdPadding: "61",
		NoPadding: "-1",
		StdEncoding: "__base64_std",
		URLEncoding: "__base64_url",
		RawStdEncoding: "__base64_raw_std",
		RawURLEncoding: "__base64_raw_url",
	},
	binary: {
		LittleEndian: "__binary_le",
		BigEndian: "__binary_be",
	},
	rand: {
		Reader: "__crypto_rand_reader",
	},
	os: {
		Args: "process.argv",
		Stdout: "__os_stdout",
		Stderr: "__os_stderr",
		Stdin: "__os_stdin",
	},
	time: {
		Nanosecond: "1",
		Microsecond: "1000",
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

// Zero values with a shared factory in HELPER_GENERICS.
const SHARED_ZERO_FACTORIES = {
	null: "__zn",
	0: "__z0",
	'""': "__zs",
	false: "__zf",
};

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
	cap: (s, e) => {
		s.useHelper("slice");
		return `__cap(${s.genExpr(e.args[0])})`;
	},
	make: (s, e) => s.genMake(e),
	delete: (s, e) => {
		const [m, k] = e.args.map((a) => s.genExpr(a));
		return `(delete ${m}[${k}])`;
	},
	copy: (s, e) => {
		const dst = s.genExpr(e.args[0]);
		const src = s._genSliceSource(e.args[1]);
		// Array elements are values: the copied elements must not alias src.
		const t = e.args[1]._type;
		const elem = (t?.kind === "named" ? t.underlying : t)?.elem;
		const clone =
			s._aggregateBase(elem)?.kind === "array"
				? s._cloneJs(elem, "__e")
				: "__e";
		const items =
			clone === "__e"
				? "(__cs.slice ? __cs.slice(0, n) : __cs.subarray(0, n))"
				: `__cs.slice(0, n).map((__e) => ${clone})`;
		return `((__cd, __cs) => { if (!__cd || !__cs) return 0; const n = Math.min(__cd.length, __cs.length); if (__cd.set) { __cd.set(__cs.length === n ? __cs : (__cs.subarray ? __cs.subarray(0, n) : __cs.slice(0, n))); } else { __cd.splice(0, n, ...${items}); } return n; })(${dst}, ${src})`;
	},
	new: (s, e) => {
		const arg = e.args[0];
		const base = e._type?.kind === "pointer" ? e._type.base : null;
		if (base?.kind === "named" && base.typeArgs?.length) {
			const inst = s._genericStructNew(base.name, base.typeArgs);
			if (inst) return inst;
		}
		const typeName = arg.name ?? s.getTypeName(arg);
		if (typeName && s.structNames.has(typeName)) {
			return `new ${typeName}()`;
		}
		const t = arg._type;
		if (s._isStructType(t)) {
			const name = t.name ?? (t.kind === "named" ? t.name : null);
			if (name) return `new ${name}()`;
		}
		// `new([4]byte)`: the type argument is wrapped in a TypeExpr node.
		const zero = s.zeroValueForExpr(arg.kind === "TypeExpr" ? arg.type : arg);
		// Erased type parameter: a struct instantiation is its own pointer.
		if (base?.kind === "typeParam")
			return `((__v) => (${s._typeParamIsStructJs(base.name)} ? __v : { value: __v }))(${zero})`;
		return `{ value: ${zero} }`;
	},
	// `print` writes without a trailing newline (Go semantics); the wasm glue
	// buffers the same way, so output parity holds across backends.
	print: (s, e) =>
		`((__s) => (typeof process !== "undefined" && process?.stdout?.write ? process.stdout.write(__s) : console.log(__s)))([${e.args.map((a) => s.genExpr(a)).join(", ")}].map(String).join(" "))`,
	println: (s, e) =>
		`console.log(${e.args.map((a) => s.genExpr(a)).join(", ")})`,
	panic: (s, e) => `(() => { throw new Error(${s.genExpr(e.args[0])}); })()`,
	recover: (s) => {
		s.useHelper("panicRt");
		return `__recover(${s._recoverOkInScope ? "__recoverOk" : "false"})`;
	},
	error: (s, e) => {
		s.useHelper("error");
		return `__error(${s.genExpr(e.args[0])})`;
	},
	min: (s, e) => genMinMax(s, e, "min", "<"),
	max: (s, e) => genMinMax(s, e, "max", ">"),
	clear: (s, e) => s._genBuiltinClear(e),
	complex: (s, e) =>
		`{ re: ${s.genExpr(e.args[0])}, im: ${s.genExpr(e.args[1])} }`,
	real: (s, e) => `(${s.genExpr(e.args[0])}).re`,
	imag: (s, e) => `(${s.genExpr(e.args[0])}).im`,
};

// Math.min/max coerce strings to NaN, so string operands fold with `<`/`>`.
// A type parameter may be a string or a number: pick the form at run time
// (Math.min/max keeps NaN propagation and -0 for floats).
function genMinMax(s, e, fn, cmp) {
	const args = e.args.map((a) => s.genExpr(a));
	const fold = (xs) => `${xs}.reduce((a, b) => (b ${cmp} a ? b : a))`;
	if (args.length === 1) return args[0];
	if (e._type?.kind === "typeParam")
		return `((...v) => (typeof v[0] === "string" ? ${fold("v")} : Math.${fn}(...v)))(${args.join(", ")})`;
	if (!s._isStringExprType(e._type)) return `Math.${fn}(${args.join(", ")})`;
	return fold(`[${args.join(", ")}]`);
}

// Expression kinds whose folded constant value (`_const`, attached by the
// checker — see typechecker/const-fold.js) is emitted as a literal.  Literals
// and constant names already emit their value.
const FOLDED_CONST_KINDS = new Set([
	"UnaryExpr",
	"BinaryExpr",
	"ParenExpr",
	"CallExpr",
	"TypeConversion",
]);

const JS_SAFE_INT = 2n ** 53n;

// `-1.0` already emits its exact value; keep it as written.
const isSignedLit = (e) =>
	e.kind === "UnaryExpr" &&
	(e.op === "-" || e.op === "+") &&
	e.operand?.kind === "BasicLit";

// Negative literals are parenthesised so they splice safely into operators.
const signed = (n, text) => (n < 0 || Object.is(n, -0) ? `(${text})` : text);

// JS literal per folded constant kind; null when JS cannot represent it.
const CONST_LITS = {
	STRING: (v) => JSON.stringify(v),
	BOOL: (v) => (v ? "true" : "false"),
	FLOAT: (v) =>
		Number.isFinite(v) ? signed(v, Object.is(v, -0) ? "-0" : String(v)) : null,
	INT: (v) => {
		const n = Number(v);
		return Number.isFinite(n) ? signed(n, BigInt(n).toString()) : null;
	},
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
const stdIdent = (name, type) => ({ kind: "Ident", name, _type: type });

// True when a func type mentions a type parameter (a generic stdlib function).
function hasTypeParamType(t) {
	return JSON.stringify([t.params, t.returns], (k, v) =>
		k.startsWith("_") || k === "underlying" ? undefined : v,
	).includes('"typeParam"');
}

export const expressionGenMethods = {
	genExpr(expr) {
		if (expr._ifaceKeyDyn && !expr._ifaceKeying) {
			// A key typed by a type parameter: encode it for the instantiated type.
			const f = this._typeParamZeroFactory(expr._ifaceKeyParam);
			if (f) {
				expr._ifaceKeying = true;
				try {
					this.useHelper("structKey");
					const box = expr._ifaceKeyDyn === "box" ? ", true" : "";
					return `__ikt(${f}, ${this.genExpr(expr)}${box})`;
				} finally {
					expr._ifaceKeying = false;
				}
			}
		}
		if (expr._ifaceKey && !expr._ifaceKeying) {
			// A string key is its own property key; any other dynamic value is
			// encoded with its type (see HELPER_STRUCT_KEY).
			const plain =
				!this._isNamedBoxKind(expr) && this._isStringExprType(expr._type);
			if (!plain) {
				expr._ifaceKeying = true;
				try {
					this.useHelper("structKey");
					return `__ik(${this.genExpr(expr)})`;
				} finally {
					expr._ifaceKeying = false;
				}
			}
		}
		if (this._isNamedIfaceBox(expr)) return this._genNamedIfaceBoxExpr(expr);
		if (expr._ifaceSrc && !expr._fmtDescing && !this._isNamedBoxKind(expr)) {
			const desc = this._fmtDesc(expr._ifaceSrc);
			if (desc) {
				expr._fmtDescing = true;
				try {
					return this._fmtDescWrap(this.genExpr(expr), desc);
				} finally {
					expr._fmtDescing = false;
				}
			}
		}
		if (expr._ifaceBox && !expr._ifaceBoxing && !this._isNamedBoxKind(expr)) {
			expr._ifaceBoxing = true;
			try {
				this.useHelper("ifaceBox");
				return this._ifaceBoxWrap(
					this.genExpr(expr),
					expr._ifaceBox,
					expr._ifacePtrFields,
				);
			} finally {
				expr._ifaceBoxing = false;
			}
		}
		const folded = this._genFoldedConst(expr);
		if (folded !== null) return folded;
		switch (expr.kind) {
			case "BasicLit":
				if (expr.litKind === "STRING") return JSON.stringify(expr.value);
				if (expr._const?.k === "INT")
					this._warnConstPrecision(expr._const, expr);
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
				return this._genInstantiationExpr(expr);
			case "RangeExpr":
				return this.genExpr(expr.expr);
			default: {
				const m = EXPR_GEN_DELEGATE[expr.kind];
				if (m) return this[m](expr);
				throw new Error(`CodeGen: unhandled expression kind '${expr.kind}'`);
			}
		}
	},

	// The literal for a folded constant expression (`1 << 40` →
	// `1099511627776`), or null.  Integers outside ±2⁵³ emit the nearest
	// Number and a precision warning.
	_genFoldedConst(expr) {
		const val = expr._const;
		if (!val) return null;
		// Constant names emit themselves, but an integer use of one still warns
		// (an integer constant declared in this package warned at its declaration).
		if (expr.kind === "Ident" || expr.kind === "SelectorExpr") {
			const declared = expr.kind === "Ident" && val.k === "INT";
			if (expr._intConst && !declared) this._warnConstPrecision(val, expr);
			return null;
		}
		if (!FOLDED_CONST_KINDS.has(expr.kind) || isSignedLit(expr)) return null;
		if (val.k === "INT" || expr._intConst) this._warnConstPrecision(val, expr);
		return CONST_LITS[val.k]?.(val.v) ?? null;
	},

	// Warns when an integer constant outside ±2⁵³ has no exact Number (once
	// per node per generate run: some forms generate the same node more than
	// once, and cached ASTs are generated again by later compiles).
	_warnConstPrecision(val, expr) {
		const i = constIntValue(val);
		if (i === null || (i <= JS_SAFE_INT && i >= -JS_SAFE_INT)) return;
		if (BigInt(Number(i)) !== i && !this._precisionWarned.has(expr)) {
			this._precisionWarned.add(expr);
			this._warn(`constant ${i} exceeds JS Number precision`, expr);
		}
	},

	// `js` boxed as `box` (a checker _ifaceBoxMeta kind) for an interface.
	_ifaceBoxWrap(js, box, ptrFields) {
		this.useHelper("ifaceBox");
		const fn =
			{
				ptr: "__ifp",
				ptr_slice: "__ifps",
				ptr_map: "__ifpm",
				map: "__ifm",
				slice: "__ifs",
			}[box] ?? "__ifv";
		const extra = ptrFields?.length ? `, ${JSON.stringify(ptrFields)}` : "";
		return `${fn}(${js}${extra})`;
	},

	// `js` tagged with the fmt descriptor source `desc` (see _fmtDesc).
	_fmtDescWrap(js, desc) {
		this.useHelper("ifd");
		return `__ifd(${js}, ${desc})`;
	},

	_isNamedBoxKind(expr) {
		return expr._ifaceBox === "named" || expr._ifaceBox === "named_ptr";
	},

	_isNamedIfaceBox(expr) {
		return (
			this._isNamedBoxKind(expr) && !expr._ifaceBoxing && !expr._noNamedBox
		);
	},

	_genNamedIfaceBoxExpr(expr) {
		expr._ifaceBoxing = true;
		try {
			return this._genNamedIfaceBox(
				this.genExpr(expr),
				expr._ifaceNamedType,
				expr._ifaceBox === "named_ptr",
			);
		} finally {
			expr._ifaceBoxing = false;
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

	_isScalarPointerType(t) {
		if (!t) return false;
		const pt =
			t.kind === "named"
				? (t.underlying ?? this.checker?.types.get(t.name)?.underlying)
				: t;
		if (pt?.kind !== "pointer") return false;
		return !this._isStructType(pt.base);
	},

	_genPointerEquality(expr) {
		if (expr.op !== "==" && expr.op !== "!=") return null;
		if (
			!this._isScalarPointerType(expr.left._type) &&
			!this._isScalarPointerType(expr.right._type)
		) {
			return null;
		}
		this.useHelper("ptreq");
		const cmp = `__ptreq(${this.genExpr(expr.left)}, ${this.genExpr(expr.right)})`;
		return expr.op === "==" ? cmp : `!${cmp}`;
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

	// A value of type-parameter type is copied at run time when its type
	// argument is a struct or array (decision: runtime check on the zero-value
	// factory, so one erased function body serves every instantiation).
	_typeParamClone(t, js) {
		if (t?.kind !== "typeParam") return null;
		const factory = this._typeParamZeroFactory(t.name);
		if (!factory) return null;
		this.useHelper("vclone");
		return `__vclone(${factory}, ${js})`;
	},

	_cloneJs(t, js) {
		const tp = this._typeParamClone(t, js);
		if (tp) return tp;
		const base = this._aggregateBase(t);
		if (!base) return js;
		if (base.kind === "struct") {
			if (this._structClassName(t) || this._structClassName(base))
				return `${js}.__clone()`;
			this.useHelper("sclone");
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
		if (
			!(
				this._aggregateBase(expr._type) || this._typeParamClone(expr._type, js)
			) ||
			!this._isAddressableExpr(expr)
		)
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
		const prevLabels = this._functionLabels;
		const labels = collectFunctionLabels(
			body,
			new Set(this._functionLabels ?? []),
		);
		this._functionLabels = Array.from(labels);
		this._fnCtx = {
			body,
			mut: new Map(),
			owned: new Set(),
			borrowed: new Set(),
			// Parameters, receivers and named results, including the enclosing
			// functions' (closures): `x = x[lo:hi]` on them must not copy.
			params: new Set(prev?.params),
		};
		try {
			fn();
		} finally {
			this._fnCtx = prev;
			this._functionLabels = prevLabels;
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
			if (p.name) this._fnCtx?.params.add(p.name);
			if (p.variadic && p.name && p.name !== "_") {
				this.useHelper("va");
				// Only a function that tests the parameter against nil needs an
				// empty call to be nil; others keep an empty slice so stdlib
				// helpers and printing see `[]`.
				const nilTested = comparesToNil(this._fnCtx?.body, p.name);
				this.line(`${p.name} = __va(${p.name}${nilTested ? ", true" : ""});`);
			}
			if (p.variadic || !p.name || p.name === "_") continue;
			if (this._boxedVars.has(p.name)) {
				// Address-taken parameter: rebind it to a { value } box.
				this.line(`${p.name} = { value: ${p.name} };`);
				continue;
			}
			const t = this._typeFromNode(p.type);
			if (!t) continue;
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
			if (expr.operand.kind === "IndexExpr") {
				const obj = this.genExpr(expr.operand.expr);
				const idx = this.genExpr(expr.operand.index);
				const check = this._genStrictIndex(
					{ ...expr.operand, _lvalue: false },
					"__o",
					"__i",
				);
				// Erased generic element: a struct instantiation is its own
				// pointer, anything else gets the get/set wrapper.
				if (expr.operand._type?.kind === "typeParam")
					return `((__o, __i) => { ${check ? `${check}; ` : ""}if (${this._typeParamIsStructJs(expr.operand._type.name)}) return __o[__i]; return Object.defineProperties({ get value() { return __o[__i]; }, set value(v) { __o[__i] = v; } }, { __target: { value: __o }, __index: { value: __i } }); })(${obj}, ${idx})`;
				if (check)
					return `((__o, __i) => (${check}, Object.defineProperties({ get value() { return __o[__i]; }, set value(v) { __o[__i] = v; } }, { __target: { value: __o }, __index: { value: __i } })))(${obj}, ${idx})`;
				return `((__o, __i) => Object.defineProperties({ get value() { return __o[__i]; }, set value(v) { __o[__i] = v; } }, { __target: { value: __o }, __index: { value: __i } }))(${obj}, ${idx})`;
			}
			if (expr.operand.kind === "SelectorExpr") {
				const obj = this.genExpr(expr.operand.expr);
				const field = expr.operand.field;
				return `((__o) => Object.defineProperties({ get value() { return __o.${field}; }, set value(v) { __o.${field} = v; } }, { __target: { value: __o }, __index: { value: "${field}" } }))(${obj})`;
			}
			// For non-boxed vars (primitives, etc.), wrap in { value: x }
			return `{ value: ${this.genExpr(expr.operand)} }`;
		}
		// Dereference: *p
		if (op === "*") {
			if (this._isStructPointerType(expr.operand._type)) {
				return this._genNilChecked(this.genExpr(expr.operand));
			}
			if (expr.operand._type?.base?.kind === "typeParam") {
				if (expr._derefOpTarget) return `${this.genExpr(expr.operand)}.value`;
				return `((__p) => (${this._typeParamIsStructJs(expr.operand._type.base.name)} ? __p : __p.value))(${this.genExpr(expr.operand)})`;
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
		const wrap = this.strict
			? SMALL_UNSIGNED_WRAP[this._typeName(expr._type)]
			: null;
		if (wrap && (op === "-" || op === "~")) return `(${op}(${code}) ${wrap})`;
		// -MinInt wraps back to itself for signed narrow integers.
		const signedWrap =
			this.strict && op === "-"
				? SIGNED_NEG_WRAP[this._typeName(expr._type)]
				: null;
		if (signedWrap) return `(-(${code}) ${signedWrap})`;
		const needsParens =
			this._emittedBinaryOp(expr.operand) !== null ||
			((op === "-" || op === "+") && /^[-+]/.test(code));
		return needsParens ? `${op}(${code})` : `${op}${code}`;
	},

	_genSelectorExpr(expr) {
		// Go-source stdlib member: bundled under its mangled top-level name.
		if (expr._stdName) return expr._stdName;
		if (this._isStdlibFuncValue(expr)) return this._genStdlibFuncValue(expr);
		if (expr._isMethodExpr) {
			const namedExpr = this._namedMethodExprInfo(expr);
			if (namedExpr) return `${namedExpr.cls}.$${expr.field}`;
			return `((recv, ...args) => recv.${expr.field}(...args))`;
		}
		const namedValue = this._genNamedMethodValue(expr);
		if (namedValue !== undefined) return namedValue;
		if (expr.expr.kind === "Ident") {
			const nsConst = NS_CONSTANTS[expr.expr.name]?.[expr.field];
			if (nsConst !== undefined) {
				if (expr.expr.name === "strconv") {
					this.useHelper("strconvError");
				} else if (expr.expr.name === "path" || expr.expr.name === "filepath") {
					if (expr.field === "ErrBadPattern") this.useHelper("pathError");
				} else if (expr.expr.name === "io" && expr.field === "EOF") {
					this.useHelper("ioEOF");
				} else if (expr.expr.name === "binary") {
					this.useHelper("binary");
				} else if (expr.expr.name === "hex") {
					this.useHelper("hex");
					this.useHelper("error");
				} else if (expr.expr.name === "base64") {
					this.useHelper("base64");
				} else if (expr.expr.name === "rand" && expr.field === "Reader") {
					this.useHelper("cryptoRand");
				} else if (expr.expr.name === "sha256") {
					this.useHelper("sha256");
				} else if (expr.expr.name === "os") {
					this.useHelper("os");
				}
				return nsConst;
			}
		}
		const base = this.genExpr(expr.expr);
		// Bundled GoFront package member; browser-global names carry the `$`
		// suffix of their declaration (see jsBindingName).
		if (this.bundledPackages.has(base))
			return BROWSER_GLOBALS.has(expr.field) ? `${expr.field}$` : expr.field;
		if (expr.expr._type?.kind === "pointer" && expr.field !== "value")
			return this._genPointerSelectorField(expr, base);
		const sel = `${base}${this._promotedPath(expr)}.${this._jsMemberName(expr)}`;
		if (expr._isMethodValue && !expr._callee) {
			// A value receiver is copied when the method value is evaluated.
			const t = expr.expr._type;
			if (!expr._type?._ptrRecv && this._aggregateBase(t))
				return `((__r) => __r.${this._jsMemberName(expr)}.bind(__r))(${this._cloneJs(t, base)})`;
			return `${sel}.bind(${base})`;
		}
		return sel;
	},

	// `pkg.Fn` used as a value (not called): a stdlib function is inlined at
	// its call sites, so a value is an arrow function that makes that call.
	_isStdlibFuncValue(expr) {
		const t = expr._type;
		if (expr._callee || t?.kind !== "func" || expr._isMethodExpr) return false;
		const ns = expr.expr;
		if (ns?.kind !== "Ident" || ns._type?.kind !== "namespace") return false;
		return !this.bundledPackages.has(ns.name) && !hasTypeParamType(t);
	},

	_genStdlibFuncValue(expr) {
		const t = expr._type;
		const ps = t.params ?? [];
		const nFixed = t.variadic && ps.length > 0 ? ps.length - 1 : ps.length;
		const fixed = ps.slice(0, nFixed).map((p, i) => stdIdent(`__a${i}`, p));
		const names = fixed.map((a) => a.name);
		const callJs = (args) =>
			this.genExpr({
				kind: "CallExpr",
				func: { ...expr, _callee: true },
				args,
				_type: t.returns?.[0] ?? { kind: "basic", name: "void" },
			});
		if (nFixed === ps.length)
			return `((${names.join(", ")}) => ${callJs(fixed)})`;
		// Stdlib calls are inlined per operand count, so dispatch on it.
		const rest = `__a${nFixed}`;
		let body = `(() => { throw new Error("too many arguments in call to ${expr.expr.name}.${expr.field}"); })()`;
		for (let k = 8; k >= 0; k--) {
			const extra = Array.from({ length: k }, (_, i) =>
				stdIdent(`${rest}[${i}]`, ps[nFixed]),
			);
			body = `${rest}.length === ${k} ? ${callJs([...fixed, ...extra])} : ${body}`;
		}
		return `((${[...names, `...${rest}`].join(", ")}) => ${body})`;
	},

	// A promoted field (`o.A` with embedded `In`) lives on the embedded value:
	// the class also carries a flattened copy, so reads and writes go through
	// the embedded path (`.In`) to stay in sync.  Returns "" for direct fields.
	_promotedPath(expr) {
		if (expr._isMethodValue || expr._isMethodExpr) return "";
		let t = expr.expr._type;
		if (t?.kind === "pointer") t = t.base;
		const path = this._embedPath(t, expr.field, 0);
		return path ? path.map((n) => `.${n}`).join("") : "";
	},

	_embedPath(t, field, depth) {
		const st = t?.kind === "named" ? t.underlying : t;
		if (st?.kind !== "struct" || !st.fields?.has(field) || depth > 8)
			return null;
		const direct = (st._structFields ?? []).some(
			(sf) => !sf.embedded && sf.names?.includes(field),
		);
		if (direct) return null;
		for (const sf of st._structFields ?? []) {
			if (!sf.embedded) continue;
			const inner = sf.type?.kind === "pointer" ? sf.type.base : sf.type;
			if (inner?.kind !== "named" || !this.structNames.has(inner.name))
				continue;
			const name = inner.name;
			if (name === field) return null;
			const ist = inner.underlying;
			if (!ist?.fields?.has(field)) continue;
			const sub = this._embedPath(inner, field, depth + 1);
			const idirect = (ist._structFields ?? []).some(
				(x) => !x.embedded && x.names?.includes(field),
			);
			return idirect ? [name] : sub ? [name, ...sub] : null;
		}
		return null;
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

	// ── Named non-struct types with methods: raw values, static dispatch ──

	// Boxes a raw named value (or *T) entering an interface so dynamic dispatch works.
	_genNamedIfaceBox(js, type, isPtr) {
		const info = this._namedBoxInfo(type);
		if (!info) return js;
		return isPtr ? `new ${info.cls}$Ptr(${js})` : `new ${info.cls}(${js})`;
	},

	// Static target of `x.M` on a named non-struct type: its class and the
	// receiver argument (the { value } box for pointer receivers).
	_namedMethodTarget(sel) {
		const recvType = sel.expr?._type;
		const viaPtr = recvType?.kind === "pointer";
		const info = this._namedBoxInfo(viaPtr ? recvType.base : recvType);
		const method = info?.methods.get(sel.field);
		if (!method) return null;
		let recv;
		if (method._ptrRecv) {
			recv = viaPtr ? this.genExpr(sel.expr) : this._genAddressOfExpr(sel.expr);
		} else {
			recv = viaPtr
				? `${this.genExpr(sel.expr)}.value`
				: this.genExpr(sel.expr);
		}
		return {
			cls: info.cls,
			recv,
			byValue: !method._ptrRecv,
			recvType: viaPtr ? recvType.base : recvType,
		};
	},

	// `x.M` used as a value: binds the receiver now, as Go does.
	_genNamedMethodValue(expr) {
		if (!expr._isMethodValue || expr._callee) return undefined;
		const target = this._namedMethodTarget(expr);
		if (!target) return undefined;
		// A value receiver (a named array) is copied when the value is evaluated.
		const recv = target.byValue
			? this._cloneJs(target.recvType, target.recv)
			: target.recv;
		return `((__r) => (...__a) => ${target.cls}.$${expr.field}(__r, ...__a))(${recv})`;
	},

	_genAddressOfExpr(operand) {
		return this._genUnaryExpr({
			kind: "UnaryExpr",
			op: "&",
			operand,
			_type: { kind: "pointer", base: operand._type },
		});
	},

	// `T.M` method expression on a named non-struct type.
	_namedMethodExprInfo(sel) {
		const t =
			sel.expr?._type?.kind === "named"
				? sel.expr._type
				: this.checker?.types.get(sel.expr?.name);
		const info = this._namedBoxInfo(t);
		return info?.methods.has(sel.field) ? info : null;
	},

	_genNamedMethodCall(expr) {
		const sel = expr.func;
		if (sel._isMethodExpr) {
			const info = this._namedMethodExprInfo(sel);
			if (!info) return undefined;
			return `${info.cls}.$${sel.field}(${this._genCallArgs(expr)})`;
		}
		const target = this._namedMethodTarget(sel);
		if (!target) return undefined;
		const args = this._genCallArgs(expr);
		return `${target.cls}.$${sel.field}(${args ? `${target.recv}, ${args}` : target.recv})`;
	},

	// `F[int]` as a value is a function that passes F its zero-value factories.
	_genInstantiationExpr(expr) {
		const fn = this.genExpr(expr.expr);
		if (!expr._genericFnType || expr._callee) return fn;
		const { typeParams } = expr._genericFnType;
		const zeros = this._typeArgFactories(
			typeParams,
			expr._typeArgs,
			this._genericFnNeedsTypeInfo(expr._genericFnType),
		);
		return `((...a) => ${fn}(${zeros.join(", ")}, ...a))`;
	},

	_genCallArgs(expr) {
		if (expr._multiForward) return `...${this.genExpr(expr.args[0])}`;
		return expr.args
			.map((a, i) =>
				a._spread
					? this._genSpreadArg(expr, a)
					: this._callerCopiesArg(expr, i)
						? this.genValueExpr(a)
						: this.genExpr(a),
			)
			.join(", ");
	},

	// `f(xs...)`: a Go-compiled variadic callee receives the slice itself in a
	// marker (its prologue unwraps it); other callees get a JS spread.
	_genSpreadArg(call, arg) {
		const js = this.genExpr(arg);
		return this._calleeIsGoVariadic(call) ? `{ __sp: ${js} }` : `...${js}`;
	},

	_calleeIsGoVariadic(call) {
		const f = call.func;
		if (f.kind === "Ident") {
			if (this.variadicFns?.has(f.name)) return true;
			// A local func value (closure or parameter) compiled from Go source.
			const imported =
				this.checker?._externalNames?.has(f.name) ||
				BROWSER_GLOBALS.has(f.name) ||
				[...(this.jsImports?.values() ?? [])].some((names) =>
					names.includes(f.name),
				);
			return !imported && f._type?.kind === "func" && !!f._type.variadic;
		}
		if (f.kind !== "SelectorExpr" || f._isMethodExpr) return false;
		const recv = this._resolveRecvName(f.expr._type);
		return !!recv && !!this.variadicFns?.has(`${recv}.${f.field}`);
	},

	// A callee copies its mutated array and struct parameters on entry, except
	// when the parameter is a type parameter (generics are erased in JS) or
	// part of a variadic rest array.  For those the caller passes aggregate
	// (array and struct) arguments as copies.
	_callerCopiesArg(expr, i) {
		const argT = expr.args[i]._type;
		if (!this._aggregateBase(argT) && !this._typeParamClone(argT, ""))
			return false;
		let ft = expr.func?._type ?? expr.func?.expr?._type;
		if (ft?.kind === "generic") ft = ft.underlying;
		if (ft?.kind !== "func") return false;
		const params = ft.params ?? [];
		if (ft.variadic && i >= params.length - 1) return true;
		return params[i]?.kind === "typeParam";
	},

	_genPointerSelectorField(expr, base) {
		if (this._isStructPointerType(expr.expr._type)) {
			// Strict mode: a field of a nil struct pointer panics as in Go.
			const recv =
				this.strict && !expr._isMethodValue ? this._genNilChecked(base) : base;
			const sel = `${recv}${this._promotedPath(expr)}.${expr.field}`;
			if (expr._isMethodValue && !expr._callee) {
				// `p.M` with a value receiver binds a copy of `*p` now.
				if (expr._derefRecv) {
					const copy = this._cloneJs(
						expr.expr._type.base,
						this.strict ? this._genNilChecked(base) : base,
					);
					return `((__r) => __r.${expr.field}.bind(__r))(${copy})`;
				}
				return `${sel}.bind(${base})`;
			}
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
		if (expr._mapValueType) {
			if (!expr._lvalue) return this._genMapIndexExpr(expr, base, idx);
			return `${this._genMapWriteBase(base)}[${idx}]`;
		}
		const checked = this._genStrictIndex(expr, base, idx);
		if (checked) return checked;
		if (this._isStringExprType(exprType) && !expr._lvalue)
			return `${base}.charCodeAt(${idx})`;
		return `${base}[${idx}]`;
	},

	// `p` for a field access `p.F`, panicking with Go's message when nil.
	_genNilChecked(base) {
		this.useHelper("nilCall");
		return `__nilcall(${base})`;
	},

	// The map of a write `m[k] = v`: strict mode panics on a nil map.
	_genMapWriteBase(base) {
		if (!this.strict) return base;
		this.useHelper("nilMap");
		return `__mw(${base})`;
	},

	// Strict mode: `xs[i]` on a slice, array or string with Go's bounds check
	// (null when no check applies).  Reads of slices and arrays use `__at`;
	// lvalues and string reads use `base[__ix(base, i)]`, binding `base` to
	// `__lv` first when evaluating it twice could repeat a call.
	_genStrictIndex(expr, base, idx) {
		if (!this.strict || expr._inBounds) return null;
		const t = expr.expr._type;
		const u = t?.kind === "named" ? t.underlying : t;
		const isStr = this._isStringExprType(t);
		if (!isStr && u?.kind !== "slice" && u?.kind !== "array") return null;
		this.useHelper("bounds");
		if (!expr._lvalue && !isStr) return `__at(${base}, ${idx})`;
		const once = this._hasCallExpr(expr.expr);
		const obj = once ? `(__lv = ${base})` : base;
		const at = `__ix(${once ? "__lv" : base}, ${idx})`;
		return expr._lvalue ? `${obj}[${at}]` : `${obj}.charCodeAt(${at})`;
	},

	_genMapIndexExpr(expr, base, idx) {
		const zero = this.zeroValueForType(expr._mapValueType);
		if (this._hasCallExpr(expr.expr) || this._hasCallExpr(expr.index))
			return `((__m, __k) => __m[__k] ?? ${zero})(${base}, ${idx})`;
		return `(${base}[${idx}] ?? ${zero})`;
	},

	_isStringExprType(exprType) {
		const t = exprType?.kind === "named" ? exprType.underlying : exprType;
		return (
			(t?.kind === "basic" && t.name === "string") ||
			(t?.kind === "untyped" && t.base === "string")
		);
	},

	_genSliceExpr(expr) {
		const base = this.genExpr(expr.expr);
		const lo = expr.low ? this.genExpr(expr.low) : "0";
		const hi = expr.high ? this.genExpr(expr.high) : "undefined";
		if (this._isStringExprType(expr.expr._type))
			return expr.high ? `${base}.slice(${lo}, ${hi})` : `${base}.slice(${lo})`;
		// `b[:]`, `b[0:]` and `a[:]` have the operand's length and capacity:
		// the result is the operand itself.  Other bounds make a view sharing
		// the backing store (`__slice`, which checks the bounds against cap).
		const zeroLow = !expr.low || Number(expr.low._const?.v) === 0;
		if (zeroLow && !expr.high && !expr.max) return base;
		this.useHelper("slice");
		// `x = x[lo:hi]` (see `_markSelfReslice`) copies a plain array when
		// the result stays within `len(x)`; typed arrays always share.
		if (expr._selfReslice && !isTypedArraySlice(expr.expr._type))
			return `__reslice(${base}, ${lo}, ${hi})`;
		const max = expr.max ? `, ${this.genExpr(expr.max)}` : "";
		return `__slice(${base}, ${lo}, ${hi}${max})`;
	},

	_genFuncLit(expr) {
		const params = this._paramNames(expr.params).join(", ");
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
		// Named non-struct values sit in interfaces as boxes; the asserted value is raw.
		const out = this._assertedValueJs(expr.type, val);
		if (!expr._commaOk) {
			// plain assertion: panic if check fails (matches Go behavior)
			if (check === "true") return src; // can't check at runtime — pass through
			return wrap(
				`(${check} ? ${out} : (() => { throw new Error("interface conversion: type assertion failed"); })())`,
			);
		}
		// comma-ok: emit [value-or-zero, runtimeTypeCheck]; an asserted array
		// is a copy of the boxed value.
		const zero = this.zeroValueForTypeNode(expr.type);
		const arrT = this._typeFromNode(expr.type);
		const okOut = arrT?.kind === "array" ? this._cloneJs(arrT, out) : out;
		return wrap(`(${check} ? [${okOut}, true] : [${zero}, false])`);
	},

	// `csv.ParseError` names the class of the bundled Go-source package type.
	_qualifiedStructName(name) {
		if (!name.includes(".") || this.structNames.has(name)) return name;
		const cls = this.checker?.types.get(name)?.name;
		return cls && this.structNames.has(cls) ? cls : name;
	},

	_typeNameCheckExpr(typeName, val) {
		// A type parameter: the instantiated type's test travels with its factory.
		const factory = this._typeParamZeroFactory(typeName);
		if (factory) return `(${factory}?.is?.(${val}) ?? true)`;
		const name = this._qualifiedStructName(typeName);
		if (TYPEOF_NUMBER_NAMES.has(name)) return `typeof ${val} === "number"`;
		if (name === "string") return `typeof ${val} === "string"`;
		if (name === "bool") return `typeof ${val} === "boolean"`;
		if (name === "nil") return `${val} === null`;
		// F32x4 and Mask32x4 are both frozen 4-element arrays; lanes tell them apart.
		if (name === "simd.F32x4" || name === "F32x4")
			return `(Array.isArray(${val}) && ${val}.length === 4 && typeof ${val}[0] === "number")`;
		if (name === "simd.Mask32x4" || name === "Mask32x4")
			return `(Array.isArray(${val}) && ${val}.length === 4 && typeof ${val}[0] === "boolean")`;
		if (name === "error")
			return `(typeof ${val} === "object" && ${val} !== null && typeof ${val}.Error === "function")`;
		if (this.structNames.has(name))
			return `(${val} instanceof ${name} && ${val}.__p !== true)`;
		const named = this.checker?.types.get(name);
		const namedInfo = this._namedBoxInfo(named);
		if (namedInfo) return `(${val} instanceof ${namedInfo.cls})`;
		// User-declared interfaces: check the dynamic value has every method.
		if (!name.includes(".") && named?.underlying?.kind === "interface")
			return this._ifaceMethodCheck(
				val,
				[...named.underlying.methods.keys()],
				this._unwrapIsMulti(named.underlying.methods.get("Unwrap")),
			);
		return "true"; // unknown type — can't check at runtime
	},

	// Anonymous interfaces and pointers to named non-struct types; null otherwise.
	_namedOrIfaceCheckExpr(typeNode, val) {
		if (typeNode.kind === "InterfaceType" && !(typeNode.embeds?.length > 0))
			return this._ifaceMethodCheck(
				val,
				(typeNode.methods ?? []).map((m) => m.name),
				this._unwrapIsMulti(
					(typeNode.methods ?? []).find((m) => m.name === "Unwrap"),
				),
			);
		if (typeNode.kind === "PointerType" && typeNode.base?.kind === "TypeName") {
			const info = this._namedBoxInfo(
				this.checker?.types.get(typeNode.base.name),
			);
			if (info) return `(${val} instanceof ${info.cls}$Ptr)`;
		}
		return null;
	},

	// `Unwrap() []error` (errors.Join) and `Unwrap() error` share a name: the
	// JS function of a multi-error `Unwrap` is tagged `__multi`.  `method` is
	// a func type or an interface method AST; null when there is no `Unwrap`.
	_unwrapIsMulti(method) {
		if (!method) return null;
		const ret = method.returnType ?? method.returns?.[0];
		const u = ret?.kind === "named" ? ret.underlying : ret;
		return u?.kind === "slice" || u?.kind === "SliceType";
	},

	_ifaceMethodCheck(val, methodNames, multiUnwrap = null) {
		const checks = methodNames.map((m) =>
			m === "Unwrap" && multiUnwrap !== null
				? `typeof ${val}.${m} === "function" && (${val}.${m}.__multi === true) === ${multiUnwrap}`
				: `typeof ${val}.${m} === "function"`,
		);
		return `(${[`${val} != null`, ...checks].join(" && ")})`;
	},

	// The value an assertion to `typeNode` yields: raw, unboxed from the
	// interface's box for a named non-struct type (known only at run time
	// for a type parameter).
	_assertedValueJs(typeNode, val) {
		if (this._isNamedBoxTypeNode(typeNode)) return `${val}.__gfUnbox()`;
		const factory =
			typeNode?.kind === "TypeName"
				? this._typeParamZeroFactory(typeNode.name)
				: null;
		return factory ? `(${factory}?.u ? ${val}.__gfUnbox() : ${val})` : val;
	},

	_isNamedBoxTypeNode(typeNode) {
		if (typeNode?.kind === "TypeName")
			return Boolean(
				this._namedBoxInfo(this.checker?.types.get(typeNode.name)),
			);
		if (typeNode?.kind === "PointerType" && typeNode.base?.kind === "TypeName")
			return Boolean(
				this._namedBoxInfo(this.checker?.types.get(typeNode.base.name)),
			);
		return false;
	},

	// Converting a struct to a different defined struct type builds a copy in
	// the target's class (so its methods exist); null when not applicable.
	_genStructClassConversion(targetName, srcType, inner) {
		if (!targetName || targetName.includes("[")) return null;
		const target = this.checker?.types.get(targetName);
		if (target?.kind !== "named" || target.underlying?.kind !== "struct")
			return null;
		if (srcType?.name === targetName) return null;
		const srcU = srcType?.kind === "named" ? srcType.underlying : srcType;
		if (srcU?.kind !== "struct") return null;
		const cls = this._dequalify(targetName);
		return `Object.assign(new ${cls}(), ${this._cloneJs(srcType, inner)})`;
	},

	_genTypeConversionCall(expr) {
		const targetType = expr._conversionTargetType;
		const arg = this.genExpr(expr.args[0]);
		const viaParam = this._genTypeParamConversion(targetType?.name, arg);
		if (targetType?.kind === "typeParam" && viaParam) return viaParam;
		const structConv = this._genStructClassConversion(
			targetType?.kind === "named" ? targetType.name : undefined,
			expr.args[0]?._type,
			arg,
		);
		if (structConv) return structConv;
		const isRaw =
			targetType?.name === "json.RawMessage" ||
			targetType?.name === "encoding/json.RawMessage";
		const base =
			targetType?.kind === "named" ? targetType.underlying : targetType;
		if (
			targetType?.kind === "named" &&
			base?.kind === "basic" &&
			this._namedBoxInfo(targetType)
		)
			return this._genPrimitiveConversion(
				{ expr: expr.args[0] },
				arg,
				base.name,
			);
		if (base?.kind === "slice") {
			const elem = base.elem?.name;
			if (
				(elem === "byte" || elem === "uint8") &&
				this._isStringExprType(expr.args[0]?._type)
			) {
				const enc = `new TextEncoder().encode(${arg})`;
				return isRaw ? `((u) => { u.__raw = true; return u; })(${enc})` : enc;
			}
			if (isRaw) {
				return `((u) => { u.__raw = true; return u; })(${arg})`;
			}
		}
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

		const nilSafe = this._nilSafeMethodClass(expr.func);
		if (nilSafe) {
			// The method tests its receiver for nil: call it through the
			// prototype so a nil `this` reaches it instead of a TypeError.
			const recv = this.genExpr(expr.func.expr);
			const rest = this._genCallArgs(expr);
			return `${nilSafe}.prototype.${expr.func.field}.call(${rest ? `${recv}, ${rest}` : recv})`;
		}

		expr.func._callee = true;
		const rawFn = this.genExpr(expr.func);
		const fn = expr.func.kind === "FuncLit" ? `(${rawFn})` : rawFn;
		const args = this._genCallArgs(expr);
		const zeros = this._genericCallZeros(expr);
		if (!zeros) return `${fn}(${args})`;
		return `${fn}(${args ? `${zeros}, ${args}` : zeros})`;
	},

	// The class of a pointer-receiver struct method that accepts a nil receiver
	// when `func` selects it on a pointer of exactly that struct, else null.
	_nilSafeMethodClass(func) {
		if (func?.kind !== "SelectorExpr" || func._isMethodExpr) return null;
		const t = func.expr?._type;
		if (t?.kind !== "pointer" || t.base?.kind !== "named") return null;
		const cls = t.base.name;
		if (t.base.typeArgs?.length) return null;
		return this.nilSafeMethods?.has(`${cls}.${func.field}`) ? cls : null;
	},

	// The leading zero-value factories of a call to a generic function
	// (`F(x)` with inferred, `F[int](x)` with explicit type arguments), or null.
	_genericCallZeros(expr) {
		const site = expr._genericFnType
			? expr
			: expr.func.kind === "InstantiationExpr" && expr.func._genericFnType
				? expr.func
				: null;
		if (!site) return null;
		const { typeParams } = site._genericFnType;
		return this._typeArgFactories(
			typeParams,
			site._typeArgs,
			this._genericFnNeedsTypeInfo(site._genericFnType),
		).join(", ");
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

	_genJsonStreamCall(recvName, expr) {
		const isEnc = this._isJsonEncoderName(recvName);
		if (isEnc && expr.func.field === "Encode") {
			this.useHelper("json");
			const enc = this.genExpr(expr.func.expr);
			this._markJsonAnyEncoders();
			const argType = expr.args[0]?._type;
			const codec = this._getJsonEncoder(argType);
			const arg = this.genExpr(expr.args[0]);
			return `__json_encoder_encode(${enc}, ${codec}, ${arg})`;
		}
		const isDec =
			recvName === "json.Decoder" ||
			recvName === "encoding/json.Decoder" ||
			recvName?.startsWith("Decoder$$");
		if (isDec && expr.func.field === "Decode") {
			this.useHelper("json");
			const dec = this.genExpr(expr.func.expr);
			const targetType = expr.args[0]?._type;
			const codec = this._getJsonDecoder(targetType);
			const arg = this.genExpr(expr.args[0]);
			return `__json_decoder_decode(${dec}, ${codec}, ${arg}, ${this._jsonTargetArgs(targetType)})`;
		}
		return undefined;
	},

	_genReceiverTypeCall(recvName, expr) {
		const jsonStream = this._genJsonStreamCall(recvName, expr);
		if (jsonStream !== undefined) return jsonStream;
		if (recvName === "strings.Builder" || recvName === "bytes.Buffer")
			return this._genBuilderCall(recvName, expr.func.field, expr);
		if (recvName === "regexp.Regexp")
			return this._genRegexpMethodCall(expr.func.field, expr);
		if (recvName === "time.Time")
			return this._genTimeMethodCall(expr.func.field, expr);
		if (recvName === "time.Duration")
			return this._genDurationMethodCall(expr.func.field, expr);
		if (recvName === "time.Month") {
			this.useHelper("duration");
			return `__monthString(${this.genExpr(expr.func.expr)})`;
		}
		if (recvName === "time.Weekday") {
			this.useHelper("duration");
			return `__weekdayString(${this.genExpr(expr.func.expr)})`;
		}
		if (recvName === "time.Location") {
			const recv = this.genExpr(expr.func.expr);
			return `(${recv} ? ${recv}.String() : "UTC")`;
		}
		if (recvName === "time.Timer") {
			const recv = this.genExpr(expr.func.expr);
			if (expr.func.field === "Stop")
				return `(${recv} ? ${recv}.Stop() : false)`;
			if (expr.func.field === "Reset")
				return `(${recv} ? ${recv}.Reset(${this.genExpr(expr.args[0])}) : false)`;
		}
		if (
			recvName === "testing.T" ||
			recvName === "testing.B" ||
			recvName === "testing.M" ||
			recvName === "testing.TB"
		)
			return this._genTestingMethodCall(expr.func.field, expr);
		if (recvName === "strings.Replacer") {
			const recv = this.genExpr(expr.func.expr);
			if (expr.func.field === "WriteString") {
				const w = this.genExpr(expr.args[0]);
				const s = this.genExpr(expr.args[1]);
				return `((r,w,s) => { s = r ? r.Replace(s) : s; const x = w?.value ?? w; if (typeof x.WriteString === "function") return x.WriteString(s); if (typeof x._buf === "string") { x._buf += s; return [s.length, null]; } if (Array.isArray(x._buf)) { const bytes = new TextEncoder().encode(s); for (let i = 0; i < bytes.length; i++) x._buf.push(bytes[i]); return [bytes.length, null]; } if (typeof x.Write === "function") return x.Write(new TextEncoder().encode(s)); return [0, "strings.Replacer.WriteString: unsupported writer"]; })(${recv}, ${w}, ${s})`;
			}
			const arg = this.genExpr(expr.args[0]);
			return `(${recv} ? ${recv}.Replace(${arg}) : ${arg})`;
		}
		if (recvName?.startsWith("shared.") && expr.func.field === "Subarray") {
			const args = expr.args.map((a) => this.genExpr(a)).join(", ");
			return `${this.genExpr(expr.func.expr)}.subarray(${args})`;
		}
		if (/^(simd\.)?(F32x4|Mask32x4)$/.test(recvName ?? "")) {
			return this._genSimdReceiverCall(expr, recvName.endsWith("Mask32x4"));
		}
		if (recvName === "sync.Mutex" || recvName === "sync.RWMutex") {
			if (expr.func.field === "TryLock" || expr.func.field === "TryRLock")
				return "true";
			if (expr.func.field === "RLocker") return "({ Lock() {}, Unlock() {} })";
			return "(void 0)";
		}
		if (recvName === "sync.Once" && expr.func.field === "Do") {
			const recv = this.genExpr(expr.func.expr);
			const f = this.genExpr(expr.args[0]);
			return `((o, fn) => { if (!o.done) { o.done = 1; fn(); } })(${recv}, ${f})`;
		}
		if (recvName === "sync.WaitGroup") {
			const recv = this.genExpr(expr.func.expr);
			if (expr.func.field === "Add") {
				return `((wg, d) => { wg.counter = (wg.counter || 0) + d; })(${recv}, ${this.genExpr(expr.args[0])})`;
			}
			if (expr.func.field === "Done") {
				return `((wg) => { wg.counter = (wg.counter || 0) - 1; })(${recv})`;
			}
			if (expr.func.field === "Wait") return "(void 0)";
		}
		if (
			recvName === "binary.LittleEndian" ||
			recvName === "binary.BigEndian" ||
			recvName === "encoding/binary.LittleEndian" ||
			recvName === "encoding/binary.BigEndian" ||
			recvName === "binary.ByteOrder" ||
			recvName === "encoding/binary.ByteOrder"
		) {
			this.useHelper("binary");
			const recv = this.genExpr(expr.func.expr);
			const args = expr.args.map((a) => this.genExpr(a)).join(", ");
			return `${recv}.${expr.func.field}(${args})`;
		}
		if (
			recvName === "base64.Encoding" ||
			recvName === "encoding/base64.Encoding"
		) {
			this.useHelper("base64");
			const recv = this.genExpr(expr.func.expr);
			const args = expr.args.map((a) => this.genExpr(a)).join(", ");
			return `${recv}.${expr.func.field}(${args})`;
		}
		return undefined;
	},

	_genSimdReceiverCall(expr, isMask = false) {
		this.useHelper("simd");
		const method = expr.func.field;
		const recv = this.genExpr(expr.func.expr);
		const args = expr.args.map((a) => this.genExpr(a));
		if (method === "Lane") return `${recv}[${args[0]}]`;
		if (method === "Splat" && !isMask) return `__simd_splat(${args[0]})`;
		const helper = (isMask ? SIMD_MASK_HELPERS : SIMD_VECTOR_HELPERS)[method];
		return helper ? `${helper}(${[recv, ...args].join(", ")})` : undefined;
	},

	_genSelectorCall(expr) {
		if (this._isErrorMethodCall(expr)) {
			const recv = this.genExpr(expr.func.expr);
			if (!this.strict) return `${recv}.Error()`;
			this.useHelper("nilCall");
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
		const namedCall = this._genNamedMethodCall(expr);
		if (namedCall !== undefined) return namedCall;
		if (this.strict && this._isInterfaceType(recvType)) {
			// Go panics with a nil-dereference runtime error; JS would throw a
			// TypeError with a different message.
			this.useHelper("nilCall");
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
		this.useHelper("len");
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
		// A slice: every element goes back to its zero value (the length stays).
		const st = t?.kind === "named" ? t.underlying : t;
		const zero = this.zeroValueForType(st?.elem);
		if (/^(new |\{|\[|Array|__nm\()|\$z_/.test(zero))
			return `((__s) => { if (__s) for (let __i = 0; __i < __s.length; __i++) __s[__i] = ${zero}; })(${js})`;
		return `(${js})?.fill(${zero})`;
	},

	_genBuiltinIdent(name, expr) {
		const gen = BUILTIN_GEN[name];
		return gen ? gen(this, expr) : undefined;
	},

	// The source operand of `append(b, x...)` / `copy(b, x)`: a string
	// contributes its UTF-8 bytes.
	_genSliceSource(node) {
		const js = this.genExpr(node);
		return this._isStringExprType(node._type)
			? `new TextEncoder().encode(${js})`
			: js;
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
					a._spread
						? `...(${this._genSliceSource(a)} ?? [])`
						: this.genValueExpr(a),
				);
			if (elems.length === 0) return this.genExpr(expr.args[0]);
			this.useHelper("append");
			return `new ${retType.name}(__append(${sliceJS}, ${elems.join(", ")}))`;
		}
		const slice = this.genExpr(expr.args[0]);
		// Spread elements of array type are values: append copies them.
		const st = expr._type ?? expr.args[0]._type;
		const elemT = (st?.kind === "named" ? st.underlying : st)?.elem;
		const spreadOf = (a) =>
			this._aggregateBase(elemT)?.kind === "array"
				? `...(${this.genExpr(a)} ?? []).map((__e) => ${this._cloneJs(elemT, "__e")})`
				: `...(${this._genSliceSource(a)} ?? [])`;
		const elems = expr.args
			.slice(1)
			.map((a) => (a._spread ? spreadOf(a) : this.genValueExpr(a)));
		if (elems.length === 0) return slice;
		this.useHelper("append");
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
		// A defined type (`type S []int`) makes like its underlying type.
		const madeType =
			typeArg._type?.kind === "named"
				? typeArg._type.underlying
				: typeArg._type;
		const resolvedKind = madeType?.kind;
		if (typeNode.kind === "SliceType" || resolvedKind === "slice") {
			const n = expr.args[1] ? this.genExpr(expr.args[1]) : "0";
			const elemNode = typeNode.kind === "SliceType" ? typeNode.elem : null;
			const elemResolved = madeType?.kind === "slice" ? madeType.elem : null;
			const typedCtor =
				typedArrayConstructorForElem(elemResolved) ??
				(elemNode?.name
					? typedArrayConstructorForElem({
							kind: "basic",
							name: elemNode.name,
						})
					: null);
			// make([]T, n, cap) allocates cap elements and returns a view of
			// the first n (`__mkslice`), so append within cap shares them.
			const capArg = expr.args[2] ? this.genExpr(expr.args[2]) : null;
			if (capArg) this.useHelper("slice");
			const withCap = (alloc) =>
				capArg ? `__mkslice(${n}, ${alloc(capArg)})` : alloc(n);
			if (typedCtor) {
				return withCap((k) => `new ${typedCtor}(${k})`);
			}
			// Use the proper zero value for the element type (e.g. new Point() not 0)
			let zero = "null";
			if (elemResolved) {
				zero = this.zeroValueForType(elemResolved);
			} else if (elemNode) {
				zero = this.zeroValueForTypeNode(elemNode);
			}
			// If zero value is a constructor call, use a factory function so each element is distinct
			if (zero.startsWith("new ") || zero.includes("$z_")) {
				return withCap((k) => `Array.from({length: ${k}}, () => ${zero})`);
			}
			return withCap((k) => `new Array(${k}).fill(${zero})`);
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

	// The one place a map literal key becomes a JS property name: a plain
	// string literal stays as is, any other key is computed so that the key
	// encoding of `genExpr` (`__ik`, struct keys) applies.
	_genMapLitKey(key) {
		return key.litKind === "STRING"
			? JSON.stringify(key.value)
			: `[${this.genExpr(key)}]`;
	},

	_genMapLitEntries(elems) {
		return elems
			.map((e) =>
				e.kind === "KeyValueExpr"
					? `${this._genMapLitKey(e.key)}: ${this.genValueExpr(e.value)}`
					: this.genValueExpr(e),
			)
			.join(", ");
	},

	// A literal whose (possibly elided or named) type is a map type.
	_isMapLit(expr) {
		let t = expr._type;
		for (let i = 0; t?.kind === "named" && i < 32; i++) t = t.underlying;
		return t?.kind === "map";
	},

	_genFallbackCompositeLit(expr) {
		if (this._isMapLit(expr))
			return `{ ${this._genMapLitEntries(expr.elems)} }`;
		const at = this._litArrayType(expr);
		if (at) {
			// A named array type without methods (`type V [3]int; V{1}`).
			const elems = this._genArrayLitElems(at, expr);
			const ctor = typedArrayConstructorForElem(at.elem);
			return ctor ? `new ${ctor}([${elems}])` : `[${elems}]`;
		}
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
				? this.genValueExpr(match.kind === "KeyValueExpr" ? match.value : match)
				: fields[idx].zero;
		} else {
			const valExpr = this.genExpr(e.value);
			values[idx] =
				`(${valExpr} != null ? ${valExpr}.${ef} : ${fields[idx].zero})`;
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
				const embedIdx = fields.findIndex((f) => f.name === k);
				if (embedIdx >= 0) {
					values[embedIdx] = this.genValueExpr(e.value);
					if (embedIdx > maxIdx) maxIdx = embedIdx;
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
		const generic = this._genGenericStructLit(fields, expr);
		if (generic) return generic;
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
		const inst =
			maxExplicitIdx < 0
				? `new ${typeName}()`
				: `new ${typeName}(${values.slice(0, maxExplicitIdx + 1).join(", ")})`;
		return inst;
	},

	// `Box[int]{…}`: every field is passed (unset ones as undefined, so the
	// constructor starts them at their zero value) followed by the factories.
	_genGenericStructLit(fields, expr) {
		const t = expr._type;
		if (t?.kind !== "named" || !t.typeArgs?.length) return null;
		const values = fields.map(() => undefined);
		if (expr.elems.length > 0) {
			const hasPositional = expr.elems.some(
				(e) => e._positionalField || e.kind !== "KeyValueExpr",
			);
			if (hasPositional) this._fillPositionalStructElems(fields, expr, values);
			else this._fillKeyedStructElems(fields, expr, values);
		}
		return this._genericStructNew(t.name, t.typeArgs, values);
	},

	// The array type of a literal (through named types), or null.
	_litArrayType(expr) {
		let t = expr._type;
		while (t?.kind === "named") t = t.underlying;
		return t?.kind === "array" && typeof t.size === "number" ? t : null;
	},

	// Elements of a literal of array type `at` (or `{ size, elem }` for a
	// slice), placed at their (keyed) indices, with every other slot the
	// element zero value: `[3]int{1}` is `[1, 0, 0]` and `[5]int{2: 7}` is
	// `[0, 0, 7, 0, 0]`, as in Go.  Keys out of ascending order would
	// evaluate the elements out of source order, so the values are then
	// computed first and spread into place.
	_genArrayLitElems(at, expr) {
		const values = new Array(at.size).fill(null);
		const indices = compositeLitIndices(expr.elems);
		const src = expr.elems.map((e) =>
			this.genValueExpr(e.kind === "KeyValueExpr" ? e.value : e),
		);
		const ascending = indices.every((v, i) => i === 0 || v > indices[i - 1]);
		indices.forEach((idx, i) => {
			values[idx] = ascending ? src[i] : `v$[${i}]`;
		});
		for (let i = 0; i < values.length; i++)
			values[i] ??= this.zeroValueForType(at.elem);
		if (ascending) return values.join(", ");
		return `...((v$) => [${values.join(", ")}])([${src.join(", ")}])`;
	},

	// `{ size, elem }` for a slice or array literal (through named types).
	_litIndexedShape(expr) {
		const at = this._litArrayType(expr);
		if (at) return at;
		let t = expr._type;
		while (t?.kind === "named") t = t.underlying;
		if (t?.kind !== "slice") return null;
		// A loop, not a spread: huge literals would overflow the call stack.
		let max = -1;
		for (const i of compositeLitIndices(expr.elems)) if (i > max) max = i;
		const size = max + 1;
		return { size, elem: t.elem };
	},

	// A large array literal that leaves most slots zero (`[100000]byte{}`,
	// `[65536]int{1: 2}`) starts from the zero array, as `var a [N]T` does,
	// and assigns only the given elements instead of spelling out every
	// slot.  Small or mostly-filled literals stay inline (null).
	_genSparseArrayLit(expr) {
		const at = this._litArrayType(expr);
		if (!at || at.size <= SPARSE_ARRAY_MIN) return null;
		if (expr.elems.length * 2 >= at.size) return null;
		const zero = this.zeroValueForType(at);
		if (expr.elems.length === 0) return zero;
		const indices = compositeLitIndices(expr.elems);
		const sets = expr.elems.map((e, i) => {
			const v = this.genValueExpr(e.kind === "KeyValueExpr" ? e.value : e);
			return `a$[${indices[i]}] = (${v})`;
		});
		return `((a$) => (${sets.join(", ")}, a$))(${zero})`;
	},

	_genLitElems(expr) {
		const at = this._litIndexedShape(expr);
		if (at) return this._genArrayLitElems(at, expr);
		return expr.elems
			.map((e) => this.genValueExpr(e.kind === "KeyValueExpr" ? e.value : e))
			.join(", ");
	},

	_genSliceOrArrayLit(t, expr) {
		const sparse = this._genSparseArrayLit(expr);
		if (sparse) return sparse;
		const elems = this._genLitElems(expr);
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
	},

	genCompositeLit(expr) {
		const t = expr.typeExpr;
		if (t === null) return this._genImplicitCompositeLit(expr);
		const typeName = this.getTypeName(t);
		if (typeName === "bytes.Buffer" || typeName === "Buffer")
			return "{ _buf: [] }";
		if (typeName === "strings.Builder" || typeName === "Builder")
			return '{ _buf: "" }';
		if (typeName === "simd.Mask32x4" || typeName === "Mask32x4")
			return "Object.freeze([false, false, false, false])";
		if (typeName === "simd.F32x4" || typeName === "F32x4") {
			this.useHelper("simd");
			const a = expr.elems[0] ? this.genExpr(expr.elems[0]) : "0";
			const b = expr.elems[1] ? this.genExpr(expr.elems[1]) : "0";
			const c = expr.elems[2] ? this.genExpr(expr.elems[2]) : "0";
			const d = expr.elems[3] ? this.genExpr(expr.elems[3]) : "0";
			return `__simd_f32x4(${a}, ${b}, ${c}, ${d})`;
		}
		const aliasLit = this._genAliasLit(t, typeName, expr);
		if (aliasLit !== null) return aliasLit;
		if (typeName && this.structNames.has(typeName))
			return this._genPositionalStructLit(typeName, expr);
		if (typeName && this.namedWrapperNames.has(typeName))
			return this._genNamedWrapperLit(typeName, expr);
		if (expr.elems.some((e) => e._positionalField)) {
			if (typeName) return this._genPositionalStructLit(typeName, expr);
		}
		if (this._isSliceOrArrayType(t)) return this._genSliceOrArrayLit(t, expr);
		if (this._isMapTypeNode(t))
			return `{ ${this._genMapLitEntries(expr.elems)} }`;
		return this._genFallbackCompositeLit(expr);
	},

	// Literals whose type expression is not the class to construct: a generic
	// alias `A[X]{…}`, an anonymous `struct{…}{…}`, or `P{…}` for
	// `type P = struct{…}`. Null for every other literal.
	_genAliasLit(t, typeName, expr) {
		if (t.kind === "GenericTypeName" || t.kind === "InstantiationExpr")
			return this._genGenericAliasLit(typeName, expr);
		const anon =
			t.kind === "StructType" ||
			((t.kind === "TypeName" || t.kind === "Ident") &&
				this.checker?.types.get(t.name)?.kind === "struct");
		return anon ? this._genAnonStructLit(expr) : null;
	},

	// `A[X]{…}` for a generic alias `type A[P any] = T`: the literal has the
	// aliased type (expr._type), so dispatch on that instead of on `A`.
	_genGenericAliasLit(typeName, expr) {
		if (!this.checker?.types.get(typeName)?._generic?.isAlias) return null;
		const rt = expr._type;
		const base = rt?.kind === "named" ? rt.underlying : rt;
		if (rt?.kind === "named" && this.structNames.has(rt.name))
			return this._genPositionalStructLit(rt.name, expr);
		if (base?.kind === "map")
			return `{ ${this._genMapLitEntries(expr.elems)} }`;
		if (base?.kind === "struct") return this._genAnonStructLit(expr);
		return this._genImplicitCompositeLit(expr);
	},

	// A literal of an anonymous struct type: a plain object with every field,
	// the omitted ones set to their zero value.
	_genAnonStructLit(expr) {
		const st =
			expr._type?.kind === "named" ? expr._type.underlying : expr._type;
		if (st?.kind !== "struct" || !(st.fields instanceof Map))
			return this._genFallbackCompositeLit(expr);
		const values = new Map();
		for (const e of expr.elems) {
			if (e._positionalField)
				values.set(e._positionalField, this.genValueExpr(e));
			else if (e.kind === "KeyValueExpr")
				values.set(e.key.name, this.genValueExpr(e.value));
		}
		const fields = [...st.fields].map(
			([name, ft]) =>
				`${name}: ${values.get(name) ?? this.zeroValueForType(ft)}`,
		);
		return `{ ${fields.join(", ")} }`;
	},

	_genImplicitCompositeLit(expr) {
		// An elided `&T` (`[]*T{{1}}`) builds the struct; a struct pointer is the object.
		const lit = expr._type?.kind === "pointer" ? expr._type.base : expr._type;
		const typeName = lit?.name ?? lit?.underlying?.name;
		if (typeName && this.structNames.has(typeName)) {
			return this._genPositionalStructLit(typeName, expr);
		}
		if (this._isMapLit(expr))
			return `{ ${this._genMapLitEntries(expr.elems)} }`;
		const hasPositional = expr.elems.some((e) => e._positionalField);
		const hasKeyed = expr.elems.some((e) => e.kind === "KeyValueExpr");
		// `{2: 5}` inside `[2][3]int{…}` is an array, not an object.
		const indexed = this._litIndexedShape(expr) !== null;
		if (hasPositional || (hasKeyed && !indexed)) {
			const fields = expr.elems
				.map((e) => {
					if (e._positionalField)
						return `${e._positionalField}: ${this.genValueExpr(e)}`;
					return `${e.key.name ?? this.genExpr(e.key)}: ${this.genValueExpr(e.value)}`;
				})
				.join(", ");
			return `{ ${fields} }`;
		}
		const sparse = this._genSparseArrayLit(expr);
		if (sparse) return sparse;
		const elems = this._genLitElems(expr);
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
			return `{ ${this._genMapLitEntries(expr.elems)} }`;
		}
		// Default: slice or array
		return `[${this._genLitElems(expr)}]`;
	},

	// ── Helpers ───────────────────────────────────────────────────

	_genComplexOperand(expr) {
		if (isComplex(expr._type)) return this.genExpr(expr);
		return `{ re: ${this.genExpr(expr)}, im: 0 }`;
	},

	getTypeName(typeNode) {
		if (!typeNode) return null;
		if (typeNode._stdName) return typeNode._stdName;
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
	_hasCallExpr(node, seen = new Set()) {
		if (!node || typeof node !== "object") return false;
		if (seen.has(node)) return false;
		seen.add(node);
		if (node.kind === "CallExpr") return true;
		for (const [k, v] of Object.entries(node)) {
			if (k.startsWith("_") || k === "scope") continue;
			if (v && typeof v === "object" && this._hasCallExpr(v, seen)) return true;
		}
		return false;
	},

	// ── Generic zero values (see HELPER_GENERICS) ─────────────────

	// JS condition: type parameter `name` was instantiated with a struct (its
	// zero value is a struct object, which is its own pointer when erased; a
	// map's zero is a bare `{}`, so only a class instance or a populated
	// object counts).
	_typeParamIsStructJs(name) {
		const f = this._typeParamZeroFactory(name);
		return f
			? `((__z) => __z !== null && typeof __z === "object" && !Array.isArray(__z) && !ArrayBuffer.isView(__z) && (Object.getPrototypeOf(Object.getPrototypeOf(__z)) !== null || Object.keys(__z).length > 0))(${f}())`
			: "false";
	},

	// The zero-value factory bound to type parameter `name` in the code being
	// emitted (`$z_T`), or null outside a generic body.
	_typeParamZeroFactory(name) {
		return this._typeParamZeros?.get(name) ?? null;
	},

	// Runs `fn` with type parameters `names` bound to the factories `$z_<name>`.
	_withTypeParamZeros(names, fn) {
		const prev = this._typeParamZeros;
		this._typeParamZeros = names
			? new Map(names.map((n) => [n, `$z_${n}`]))
			: null;
		try {
			return fn();
		} finally {
			this._typeParamZeros = prev;
		}
	},

	// A factory `() => zero` for type `t`: what a generic callee receives for
	// one of its type parameters.
	zeroFactoryFor(t) {
		if (t?.kind === "typeParam") {
			const bound = this._typeParamZeroFactory(t.name);
			if (bound) return bound;
		}
		this.useHelper("generics");
		const zero = this.zeroValueForType(t);
		return Object.hasOwn(SHARED_ZERO_FACTORIES, zero)
			? SHARED_ZERO_FACTORIES[zero]
			: `() => (${zero})`;
	},

	// One factory per type parameter of generic function or type `generic`.
	// `withInfo`: the callee needs the instantiated types (see type-info.js).
	_typeArgFactories(typeParams, typeArgs, withInfo = false) {
		return typeParams.map((_, i) =>
			withInfo
				? this._typeInfoFactory(typeArgs?.[i])
				: this.zeroFactoryFor(typeArgs?.[i]),
		);
	},

	// `new Box(args…, [factories])` for an instance of generic struct `name`
	// with `typeArgs`; fields without an argument start at their zero value.
	// Null when `name` is not a generic struct.
	_genericStructNew(name, typeArgs, args = []) {
		const generic = this.checker?.types.get(name);
		const st = generic?.underlying;
		const cls = this._dequalify(name);
		if (!generic?._generic || generic._generic.isAlias) return null;
		if (st?.kind !== "struct") return null;
		if (!this.structNames.has(cls)) return null;
		const tps = generic._generic.typeParams;
		const vals = Array.from(
			{ length: st.fields.size },
			(_, i) => args[i] ?? "undefined",
		);
		const tz = this._typeArgFactories(
			tps,
			typeArgs,
			this._genericTypeNeedsTypeInfo(generic) ||
				typeArgs?.some((t) => mentionsTypeParam(t)),
		);
		const id = instanceId(typeArgs);
		if (id !== null) tz.push(JSON.stringify(id));
		else {
			const runtimeId = this._runtimeInstanceId(typeArgs);
			if (runtimeId) tz.push(runtimeId);
		}
		vals.push(`[${tz.join(", ")}]`);
		return `new ${cls}(${vals.join(", ")})`;
	},

	// Returns the JS zero-value literal for a basic type name, or null if not a basic type.
	_zeroForBasicName(name) {
		return Object.hasOwn(ZERO_FOR_BASIC, name) ? ZERO_FOR_BASIC[name] : null;
	},

	_zeroForNamedType(name) {
		const entry = NAMED_ZERO_TABLE[name];
		if (entry) {
			if (entry[0]) this.useHelper(entry[0]);
			return entry[1];
		}
		const named = this.checker?.types.get(name);
		const u = named?.kind === "named" ? named.underlying : null;
		if (
			u &&
			u.kind !== "struct" &&
			u.kind !== "interface" &&
			u.kind !== "named"
		)
			return this.zeroValueForType(u);
		if (named?.kind === "named" && u?.kind === "struct") {
			const clsName = named.name ?? this._dequalify(name);
			if (this.structNames.has(clsName)) return `new ${clsName}()`;
		}
		name = this._dequalify(name);
		if (this.structNames.has(name)) return `new ${name}()`;
		return "null";
	},

	zeroValueForTypeNode(typeNode) {
		if (!typeNode) return "null";
		switch (typeNode.kind) {
			case "Ident":
			case "TypeName": {
				const factory = this._typeParamZeroFactory(typeNode.name);
				if (factory) return `${factory}()`;
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
				return this._nilMapZero();
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
			case "GenericTypeName":
			case "InstantiationExpr":
				return (
					this._genericStructNew(
						this.getTypeName(typeNode),
						typeNode._typeArgs,
					) ?? "null"
				);
			default:
				return "null";
		}
	},

	// A nil map: a fresh tagged `{}` in js packages (`m == nil` holds while it
	// stays empty); in strict mode the frozen `__nilmap`, which panics on write.
	_nilMapZero() {
		this.useHelper(this.strict ? "nilMap" : "nm");
		return this.strict ? "__nilmap" : "__nm()";
	},

	_arrayZero(n, ctor, elemZero) {
		if (ctor) return `new ${ctor}(${n})`;
		if (n === 0) return "[]";
		if (/^(new |\{|\[|Array|__nm\()|\$z_/.test(elemZero))
			return `Array.from({ length: ${n} }, () => (${elemZero}))`;
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
				return this._nilMapZero();
			case "struct": {
				const fields = [...t.fields.entries()]
					.map(([name, ft]) => `${name}: ${this.zeroValueForType(ft)}`)
					.join(", ");
				return `{ ${fields} }`;
			}
			case "named":
				return (
					this._genericStructNew(t.name, t.typeArgs) ??
					this._zeroForNamedType(t.name)
				);
			case "typeParam": {
				const factory = this._typeParamZeroFactory(t.name);
				return factory ? `${factory}()` : "null";
			}
			default:
				return "null";
		}
	},

	// Emit a JS boolean expression that checks whether `val` matches type node `t`.
	_typeCheckExpr(typeNode, val) {
		if (!typeNode) return "true";
		if (typeNode.kind === "TypeName")
			return this._typeNameCheckExpr(typeNode.name, val);
		const generic = this._genericInstanceCheck(typeNode, val);
		if (generic) return generic;
		const extended = this._namedOrIfaceCheckExpr(typeNode, val);
		if (extended) return extended;
		if (
			typeNode.kind === "PointerType" &&
			typeNode.base?.kind === "TypeName" &&
			this.structNames.has(this._qualifiedStructName(typeNode.base.name))
		) {
			const name = this._qualifiedStructName(typeNode.base.name);
			return `(${val} instanceof ${name} && ${val}.__v !== true)`;
		}
		return "true";
	},

	// `Stack[int]` / `*Stack[int]`: the class test plus the instantiation
	// recorded on the instance (an instance without one matches any).
	_genericInstanceCheck(typeNode, val) {
		const isPtr = typeNode.kind === "PointerType";
		const base = isPtr ? typeNode.base : typeNode;
		if (base?.kind !== "GenericTypeName" || !base._typeArgs) return null;
		const cls = this._dequalify(base.name);
		if (!this.structNames.has(cls)) return null;
		const generic = this.checker?.types.get(base.name)?._generic;
		const id = instanceId(base._typeArgs);
		let check = isPtr
			? `${val} instanceof ${cls} && ${val}.__v !== true`
			: `${val} instanceof ${cls} && ${val}.__p !== true`;
		if (id !== null && generic) {
			this.useHelper("generics");
			const at = generic.typeParams.length;
			check += ` && (${val}[__tz]?.[${at}] ?? ${JSON.stringify(id)}) === ${JSON.stringify(id)}`;
		}
		return `(${check})`;
	},

	zeroValueForExpr(expr) {
		return this.zeroValueForTypeNode(expr);
	},

	_genSimdEquality(expr) {
		if (expr.op !== "==" && expr.op !== "!=") return null;
		if (!this._isSimdValueType(expr.left._type)) return null;
		this.useHelper("simd");
		const cmp = `__simd_equal(${this.genExpr(expr.left)}, ${this.genExpr(expr.right)})`;
		return expr.op === "==" ? cmp : `!${cmp}`;
	},

	_isSimdValueType(t) {
		const base = t?.kind === "named" ? t.underlying : t;
		return base?.kind === "simd";
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
				this.useHelper("cmul");
				return `__cmul(${l}, ${r})`;
			case "/":
				this.useHelper("cdiv");
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

		const simdEq = this._genSimdEquality(expr);
		if (simdEq !== null) return simdEq;

		if (this._isStructEquality(expr)) {
			this.useHelper("equal");
			const cmp = `__equal(${this.genExpr(expr.left)}, ${this.genExpr(expr.right)})`;
			return expr.op === "==" ? cmp : `!${cmp}`;
		}

		const nilMap = this._genNilMapCompare(expr);
		if (nilMap) return nilMap;

		const tpEq = this._genTypeParamEquality(expr);
		if (tpEq) return tpEq;

		if (this._isIfaceEquality(expr)) {
			this.useHelper("ifeq");
			const cmp = `__ifeq(${this._genIfaceOperand(expr.left)}, ${this._genIfaceOperand(expr.right)})`;
			return expr.op === "==" ? cmp : `!${cmp}`;
		}

		const ptrCmp = this._genPointerEquality(expr);
		if (ptrCmp !== null) return ptrCmp;

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

	// `m == nil` / `m != nil` on a map: true for a nil map (null, the strict
	// sentinel, or an untouched js-package zero map), false for `map[K]V{}`.
	_nilMapOperand(expr) {
		if (expr.op !== "==" && expr.op !== "!=") return null;
		const other = this._isNilLiteral(expr.right)
			? expr.left
			: this._isNilLiteral(expr.left)
				? expr.right
				: null;
		if (!other) return null;
		const t =
			other._type?.kind === "named" ? other._type.underlying : other._type;
		return t?.kind === "map" ? other : null;
	},

	_genNilMapCompare(expr) {
		const operand = this._nilMapOperand(expr);
		if (!operand) return null;
		this.useHelper(this.strict ? "nilMap" : "nm");
		const cmp = `__isnm(${this.genExpr(operand)})`;
		return expr.op === "==" ? cmp : `!${cmp}`;
	},

	// `a == b` on type-parameter operands: __geq compares structs and arrays by value.
	_genTypeParamEquality(expr) {
		if (expr.op !== "==" && expr.op !== "!=") return null;
		const t = expr.left._type;
		if (t?.kind !== "typeParam" || expr.right._type?.kind !== "typeParam")
			return null;
		const factory = this._typeParamZeroFactory(t.name);
		if (!factory) return null;
		this.useHelper("equal");
		this.useHelper("geq");
		const cmp = `__geq(${factory}, ${this.genExpr(expr.left)}, ${this.genExpr(expr.right)})`;
		return expr.op === "==" ? cmp : `!${cmp}`;
	},

	_isStructEquality(expr) {
		return (
			(expr.op === "==" || expr.op === "!=") &&
			this._isStructOrArrayType(expr.left._type)
		);
	},

	_isIfaceType(t) {
		return isAny(t) || this._isInterfaceType(t);
	},

	// Interface comparisons go through __ifeq so boxed named values compare by
	// dynamic type and value, as in Go (`err == ErrNotFound`).
	_isIfaceEquality(expr) {
		if (expr.op !== "==" && expr.op !== "!=") return false;
		if (this._isNilLiteral(expr.left) || this._isNilLiteral(expr.right))
			return false;
		return (
			this._isIfaceType(expr.left._type) || this._isIfaceType(expr.right._type)
		);
	},

	// A concrete operand compared with an interface is converted to an interface first.
	_genIfaceOperand(e) {
		if (e._ifaceBox || this._isIfaceType(e._type)) return this.genExpr(e);
		const isPtr = e._type?.kind === "pointer";
		const named = isPtr ? e._type.base : e._type;
		if (this._namedBoxInfo(named))
			return this._genNamedIfaceBox(this.genExpr(e), named, isPtr);
		return this.genExpr(e);
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
			(expr.kind === "BasicLit" && expr.litKind === "NIL")
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
		if (this._nilMapOperand(expr)) return null;
		if (this._isIfaceEquality(expr)) return null;
		if (expr.op === "&^") return "&";
		if (expr.op === "==" || expr.op === "!=") {
			if (this._isNilLiteral(expr.left) || this._isNilLiteral(expr.right))
				return expr.op;
			return expr.op === "==" ? "===" : "!==";
		}
		return expr.op;
	},

	// `T(x)` with T a type parameter: converts by the instantiated type.
	_genTypeParamConversion(name, inner) {
		const factory = name ? this._typeParamZeroFactory(name) : null;
		if (!factory) return null;
		this.useHelper("generics");
		return `__tconv(${factory}, ${inner})`;
	},

	_genTypeConversion(expr) {
		const inner = this.genExpr(expr.expr);
		const t = expr.targetType;
		const viaParam = this._genTypeParamConversion(t?.name, inner);
		if (viaParam) return viaParam;
		if (t?.name === "complex128" || t?.name === "complex64") {
			return isComplex(expr.expr._type) ? inner : `{ re: ${inner}, im: 0 }`;
		}
		if (t?.kind === "ArrayType")
			return this._genArrayTypeConversion(expr, inner, t);
		if (t?.kind === "SliceType")
			return this._genSliceTypeConversion(expr, inner, t);
		const target = t?.name;
		const structConv = this._genStructClassConversion(
			target,
			expr.expr._type,
			inner,
		);
		if (structConv) return structConv;
		if (target === "error") {
			// A boxed named value that implements error is already an error.
			if (this._isNamedBoxKind(expr.expr)) return inner;
			this.useHelper("error");
			return `__error(${inner})`;
		}
		if (target && this.namedWrapperNames.has(target)) {
			const named = this.checker?.types.get(target);
			const u = named?.underlying;
			return u?.kind === "basic"
				? this._genPrimitiveConversion(expr, inner, u.name)
				: inner;
		}
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
		// Array-to-array conversion yields a new array value.
		return this._cloneJs(expr.expr._type, inner);
	},

	_genSliceTypeConversion(expr, inner, t) {
		// `[]T(nil)` is the nil slice, not a copy of anything.
		if (this._isNilLiteral(expr.expr)) return "null";
		const elem = t.elem?.name;
		if (elem === "byte" || elem === "uint8") {
			if (this._isStringExprType(expr.expr._type))
				return `new TextEncoder().encode(${inner})`;
			if (isAny(expr.expr._type) || !expr.expr._type)
				return `(typeof ${inner} === "string" ? new TextEncoder().encode(${inner}) : new Uint8Array(${inner}))`;
			return `new Uint8Array(${inner})`;
		}
		const typedCtor = typedArrayConstructorForElem(
			t.elem ? { kind: "basic", name: t.elem.name } : null,
		);
		const fromString = this._isStringExprType(expr.expr._type);
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
		const base = srcType?.kind === "named" ? srcType.underlying : srcType;
		if (base && this.isIntType(base)) return `String.fromCodePoint(${inner})`;
		if (base?.kind === "slice") {
			const elem = base.elem?.name;
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
		if (op === "<<" || op === ">>")
			return WIDE_INT_NAMES.has(this._typeName(type));
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
		const divZero =
			'(() => { throw new Error("runtime error: integer divide by zero"); })()';
		if (tName === "int32" || tName === "rune" || tName === "uint32") {
			const signed = tName !== "uint32";
			const cast = signed ? "| 0" : ">>> 0";
			if (op === "*")
				return signed
					? `Math.imul(${l}, ${r})`
					: `(Math.imul(${l}, ${r}) >>> 0)`;
			if (op === "/")
				return `((${r}) === 0 ? ${divZero} : (Math.trunc((${l}) / (${r})) ${cast}))`;
			if (op === "%")
				return `((${r}) === 0 ? ${divZero} : (((${l}) % (${r})) ${cast}))`;
			if (op === "<<" || op === ">>") {
				const ovf = signed && op === ">>" ? `((${l}) < 0 ? -1 : 0)` : "0";
				const jsOp = !signed && op === ">>" ? ">>>" : op;
				return `(((${r}) >= 32 ? ${ovf} : ((${l}) ${jsOp} (${r}))) ${cast})`;
			}
			if (op === "&^") return `(((${l}) & ~(${r})) ${cast})`;
			return `((${l} ${op} ${r}) ${cast})`;
		}
		if (tName === "int8" || tName === "int16") {
			const bits = tName === "int8" ? 8 : 16;
			const sh = 32 - bits;
			if (op === "/")
				return `((${r}) === 0 ? ${divZero} : ((Math.trunc((${l}) / (${r})) << ${sh}) >> ${sh}))`;
			if (op === "%")
				return `((${r}) === 0 ? ${divZero} : (((((${l}) % (${r})) << ${sh}) >> ${sh})))`;
			if (op === "<<" || op === ">>") {
				return `((${r}) >= ${bits} ? (${op === ">>" ? `((${l}) < 0 ? -1 : 0)` : "0"}) : (((${l}) ${op} (${r})) << ${sh} >> ${sh}))`;
			}
			if (op === "&^") return `((((${l}) & ~(${r})) << ${sh}) >> ${sh})`;
			return `((((${l} ${op} ${r})) << ${sh}) >> ${sh})`;
		}
		if (tName === "uint8" || tName === "byte" || tName === "uint16") {
			const bits = tName === "uint16" ? 16 : 8;
			const mask = bits === 16 ? "0xFFFF" : "0xFF";
			if (op === "/")
				return `((${r}) === 0 ? ${divZero} : (Math.trunc((${l}) / (${r})) & ${mask}))`;
			if (op === "%")
				return `((${r}) === 0 ? ${divZero} : (((${l}) % (${r})) & ${mask}))`;
			if (op === "<<" || op === ">>") {
				const jsOp = op === ">>" ? ">>>" : "<<";
				return `((${r}) >= ${bits} ? 0 : (((${l}) ${jsOp} (${r})) & ${mask}))`;
			}
			if (op === "&^") return `(((${l}) & ~(${r})) & ${mask})`;
			return `((${l} ${op} ${r}) & ${mask})`;
		}
		if (op === "<<" || op === ">>") {
			// 64-bit semantics: operand first, then count (Go order); a negative
			// count panics and the result wraps to 64 bits.
			this.useHelper("shift");
			const unsigned = this._typeName(type).startsWith("u");
			if (op === "<<") return `__shl64(${l}, ${r}, ${unsigned})`;
			return `__shr64(${l}, ${r}, ${unsigned})`;
		}
		if (this.isIntType(type)) {
			if (op === "/")
				return `((${r}) === 0 ? ${divZero} : Math.trunc((${l}) / (${r})))`;
			if (op === "%") return `((${r}) === 0 ? ${divZero} : ((${l}) % (${r})))`;
		}
		return `${l} ${op} ${r}`;
	},
};
