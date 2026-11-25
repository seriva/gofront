import { createHash } from "node:crypto";
import { decodeRawBytes } from "../../lexer/lexer.js";
import {
	closureMutates,
	declaresVar,
	fnMutates,
	nodeMutatesVar,
	rootIdentName,
	someChild,
} from "../../lower/index.js";
import { hasCallOrReceive } from "../../lower/walk.js";
import { constIntValue } from "../../typechecker/const-fold.js";
import {
	BROWSER_GLOBALS,
	compositeLitIndices,
	ERROR,
	embeddedFieldName,
	is64BitInt,
	is64BitUnsigned,
	isAny,
	isComplex,
	isComplex64,
	isTypedArraySlice,
	typedArrayConstructorForElem,
	typeStr,
} from "../../typechecker/types.js";
import { derefOf } from "../shared/deref-operand.js";
import { goTypeName } from "../shared/fmt-types.js";
import { namedBase, namedUnderlying } from "../shared/named-underlying.js";
import { jsBindingName, jsClassName, jsMemberName } from "./names.js";
import { jsNativeCall, NATIVE_HELPERS } from "./natives.js";

// True when `node` compares the identifier `name` with nil (`l == nil`): a
// pointer-receiver method that does so is meant to run on a nil receiver.
export function comparesToNil(node, name) {
	if (Array.isArray(node)) return node.some((n) => comparesToNil(n, name));
	if (!node || typeof node !== "object") return false;
	if (node.kind === "BinaryExpr" && (node.op === "==" || node.op === "!=")) {
		const isRecv = (e) => e?.kind === "Ident" && e.name === name;
		// Receivers are scanned before the checker has turned `nil` into a literal.
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

// True when evaluating `node` reads through the receiver `name` (`r.f`,
// `r[i]`, `*r`), which panics on a nil receiver anyway. Calling a method of
// `safe` on it is not a read: that method accepts a nil receiver. A func
// literal's body is not evaluated where it appears, so it is not searched.
export function derefsReceiver(node, name, safe) {
	if (Array.isArray(node))
		return node.some((n) => derefsReceiver(n, name, safe));
	if (!node || typeof node !== "object" || node.kind === "FuncLit")
		return false;
	const isRecv = (e) => e?.kind === "Ident" && e.name === name;
	if (node.kind === "SelectorExpr" && isRecv(node.expr))
		return !safe.has(node.field);
	if (
		(node.kind === "IndexExpr" || node.kind === "SliceExpr") &&
		isRecv(node.expr)
	)
		return true;
	if (node.kind === "UnaryExpr" && node.op === "*" && isRecv(node.operand))
		return true;
	return someChild(node, (c) => derefsReceiver(c, name, safe));
}

// True when `stmts` (a method body) reads through the receiver `name` before
// anything could skip the read: only the statements that always run first
// count, up to the first branch, loop, return or rebinding of `name`. A
// method that does so panics on a nil receiver either way.
export function derefsReceiverFirst(stmts, name, safe) {
	return receiverPrefix(stmts, name, safe) === "deref";
}

// What one statement of a method body's unconditional prefix does with the
// receiver: "deref" reads through it, "stop" may skip the rest (a branch,
// loop, return, panic or rebinding of the name), "next" runs on.
const binds = (lhs, name) =>
	lhs.some((e) => e?.kind === "Ident" && e.name === name);
const branches = (reads, ...parts) => (parts.some(reads) ? "deref" : "stop");
const RECEIVER_STEP = {
	Block: (s, _reads, name, safe) => receiverPrefix(s.stmts, name, safe),
	IfStmt: (s, reads) => branches(reads, s.init, s.cond),
	ForStmt: (s, reads) => branches(reads, s.init, s.cond),
	SwitchStmt: (s, reads) => branches(reads, s.init, s.tag),
	TypeSwitchStmt: (s, reads) => branches(reads, s.init, s.expr),
	ReturnStmt: (s, reads) => branches(reads, s.values),
	ExprStmt: (s, reads) => {
		if (reads(s.expr)) return "deref";
		const panics =
			s.expr?.kind === "CallExpr" && s.expr._builtinName === "panic";
		return panics ? "stop" : "next";
	},
	DefineStmt: (s, reads, name) => {
		if (reads(s.rhs) || reads(s.lhs.filter((e) => e?.kind !== "Ident")))
			return "deref";
		return binds(s.lhs, name) ? "stop" : "next";
	},
	IncDecStmt: (s, reads) => (reads(s.expr) ? "deref" : "next"),
	VarDecl: (s, reads, name) => {
		if (s.decls.some((d) => reads(d.value))) return "deref";
		const named = (d) => d.names.some((n) => (n?.name ?? n) === name);
		return s.decls.some(named) ? "stop" : "next";
	},
};
RECEIVER_STEP.AssignStmt = RECEIVER_STEP.DefineStmt;

// "deref" when the unconditional prefix of `stmts` reads through the
// receiver, "stop" when something may skip the rest, else "next".
function receiverPrefix(stmts, name, safe) {
	const reads = (n) => derefsReceiver(n, name, safe);
	for (const s of stmts ?? []) {
		const step = RECEIVER_STEP[s?.kind];
		const r = step ? step(s, reads, name, safe) : "stop";
		if (r !== "next") return r;
	}
	return "next";
}

/** @typedef {import('./index.js').CodeGen} CodeGen */

// True for a map, slice or array type that mentions a type parameter: one
// that generic code boxes into an interface is tagged by its instantiated
// type.
export function isGenericComposite(t) {
	return (
		(t?.kind === "map" || t?.kind === "slice" || t?.kind === "array") &&
		mentionsTypeParam(t)
	);
}

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

// The strict types whose shift template checks the count against the width.
const NARROW_SHIFT_NAMES = new Set(
	[...STRICT_NUMERIC_TYPES].filter((n) => n !== "float32"),
);

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

const NAMED_ZERO_TABLE = {
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
	time: {
		Nanosecond: "1n",
		Microsecond: "1000n",
		Millisecond: "1000000n",
		Second: "1000000000n",
		Minute: "60000000000n",
		Hour: "3600000000000n",
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
	"0n": "__z64",
};

// Zero-value JS literals for basic Go types.
const ZERO_FOR_BASIC = {
	int: "0",
	uint: "0",
	int8: "0",
	int16: "0",
	int32: "0",
	int64: "0n",
	uint8: "0",
	uint16: "0",
	uint32: "0",
	uint64: "0n",
	uintptr: "0",
	float32: "0",
	float64: "0",
	byte: "0",
	rune: "0",
	complex64: "Object.freeze({ re: 0, im: 0 })",
	complex128: "Object.freeze({ re: 0, im: 0 })",
	string: '""',
	bool: "false",
};

// Set of all numeric type names (for type-assertion codegen).
const TYPEOF_NUMBER_NAMES = new Set([
	...[...INT_TYPE_NAMES].filter((n) => n !== "int64" && n !== "uint64"),
	"float32",
	"float64",
]);

// Builtin function codegen — keyed by builtin name, value is (self, expr) => string.
const BUILTIN_GEN = {
	append: (s, e) => s.genAppend(e),
	len: (s, e) => s._genBuiltinLen(e),
	cap: (s, e) => {
		if (e._constLen != null) return s._genConstLen(e);
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
		// Array and struct elements are values: the copied elements must not
		// alias src.
		const t = e.args[1]._type;
		const elem = (t?.kind === "named" ? t.underlying : t)?.elem;
		const clone = s._aggregateBase(elem) ? s._cloneJs(elem, "__e") : "__e";
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
		// A type parameter is not the package type of the same name: its zero
		// comes from the instance.
		if (base?.kind === "typeParam") return s._newOfTypeParam(base, arg);
		const typeName = arg.name ?? s.getTypeName(arg);
		if (typeName && s.structNames.has(typeName)) {
			return `new ${jsClassName(typeName)}()`;
		}
		const t = arg._type ?? base;
		// `new([4]byte)`: the type argument is wrapped in a TypeExpr node.
		const typeNode = arg.kind === "TypeExpr" ? arg.type : arg;
		if (s._isStructType(t)) {
			const name = t.name ?? (t.kind === "named" ? t.name : null);
			if (name) return `new ${jsClassName(name)}()`;
			return s.zeroValueForExpr(typeNode);
		}
		const zero = s.zeroValueForExpr(typeNode);
		return `{ value: ${zero} }`;
	},
	// `print` writes without a trailing newline (Go semantics); the wasm glue
	// buffers the same way, so output parity holds across backends.
	print: (s, e) =>
		`((__s) => (typeof process !== "undefined" && process?.stdout?.write ? process.stdout.write(__s) : console.log(__s)))([${e.args.map((a) => s.genExpr(a)).join(", ")}].map(String).join(""))`,
	println: (s, e) =>
		`console.log(${e.args.map((a) => s.genExpr(a)).join(", ")})`,
	panic: (s, e) => {
		const arg = s.genExpr(e.args[0]);
		s.useHelper("panicRt");
		return `__gopanicv(${arg})`;
	},
	recover: (s) => {
		s.useHelper("panicRt");
		return `__recover(${s._recoverOkInScope ? "__recoverOk" : "false"})`;
	},
	error: (s, e) => {
		// `error(x)` of an error (or nil) is the conversion: x itself.
		if (!s._isStringExprType(e.args[0]?._type)) return s.genExpr(e.args[0]);
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
	const is64 = s._is64BitInt(e._type);
	const args = e.args.map((a) => {
		const js = s.genExpr(a);
		if (
			is64 &&
			a._type?.kind === "untyped" &&
			!js.endsWith("n") &&
			/^-?\d+$/.test(js)
		) {
			return `${js}n`;
		}
		return js;
	});
	const fold = (xs) => `${xs}.reduce((a, b) => (b ${cmp} a ? b : a))`;
	if (args.length === 1) return args[0];
	if (e._type?.kind === "typeParam")
		return `((...v) => (typeof v[0] === "string" || typeof v[0] === "bigint" ? ${fold("v")} : Math.${fn}(...v)))(${args.join(", ")})`;
	if (is64 || s._isStringExprType(e._type)) return fold(`[${args.join(", ")}]`);
	return `Math.${fn}(${args.join(", ")})`;
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
	EmbedData: "_genEmbedData",
};

/** @type {ThisType<CodeGen>} */
const stdIdent = (name, type) => ({ kind: "Ident", name, _type: type });

// True when a func type mentions a type parameter (a generic stdlib function).
function hasTypeParamType(t) {
	return JSON.stringify([t.params, t.returns], (k, v) =>
		k.startsWith("_") || k === "underlying" ? undefined : v,
	).includes('"typeParam"');
}

// Complex constant arithmetic on [re, im] pairs.
const COMPLEX_CONST_OPS = {
	"+": (a, b) => [a[0] + b[0], a[1] + b[1]],
	"-": (a, b) => [a[0] - b[0], a[1] - b[1]],
	"*": (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
	"/": (a, b) => {
		const d = b[0] * b[0] + b[1] * b[1];
		if (d === 0) return null;
		return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
	},
};

// The [re, im] value of an untyped complex constant expression built from
// literals and named constants, or null.
function complexConstParts(e, depth = 0) {
	if (!e || typeof e !== "object" || depth > 32) return null;
	if (e.kind === "ParenExpr") return complexConstParts(e.expr, depth + 1);
	// A named complex constant has no folded value: fold its initializer.
	if (e._complexInit) return complexConstParts(e._complexInit, depth + 1);
	if (e.kind === "ImagLit") return [0, Number(e.value)];
	const val = e._const;
	if (val && (val.k === "FLOAT" || val.k === "INT")) return [Number(val.v), 0];
	if (e.kind === "UnaryExpr") return complexConstNeg(e, depth);
	const op = e.kind === "BinaryExpr" ? COMPLEX_CONST_OPS[e.op] : null;
	const a = op && complexConstParts(e.left, depth + 1);
	const b = a && complexConstParts(e.right, depth + 1);
	return b ? op(a, b) : null;
}

function complexConstNeg(e, depth) {
	if (e.op !== "-" && e.op !== "+") return null;
	const c = complexConstParts(e.operand, depth + 1);
	return c && e.op === "-" ? [0 - c[0], 0 - c[1]] : c;
}

export const expressionGenMethods = {
	genExpr(expr) {
		if (expr._asComplex && !expr._complexWrapping) {
			expr._complexWrapping = true;
			try {
				return `{ re: ${this.genExpr(expr)}, im: 0 }`;
			} finally {
				expr._complexWrapping = false;
			}
		}
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
					const tag = this._ifaceKeyTag(expr._ifaceKeyType);
					return `__ik(${this.genExpr(expr)}${tag ? `, ${JSON.stringify(tag)}` : ""})`;
				} finally {
					expr._ifaceKeying = false;
				}
			}
		}
		if (expr._mapKeyEnc && !expr._mapKeying) {
			// Array, anonymous struct and pointer keys: see HELPER_STRUCT_KEY.
			expr._mapKeying = true;
			try {
				this.useHelper("structKey");
				const enc = expr._mapKeyEnc === "pk" ? "__pk" : "__sk";
				return `${enc}(${this.genExpr(expr)})`;
			} finally {
				expr._mapKeying = false;
			}
		}
		if (
			expr._ifaceSrc?.kind === "pointer" &&
			expr._ifaceSrc.base?.kind === "typeParam" &&
			!expr._pbsWrapping
		) {
			// `&v` of a type parameter's variable is a box; a struct behind it
			// is its own pointer.
			expr._pbsWrapping = true;
			try {
				this.useHelper("ifaceBox");
				return `__pbs(${this.genExpr(expr)})`;
			} finally {
				expr._pbsWrapping = false;
			}
		}
		if (
			expr._ifaceSrc?.kind === "typeParam" &&
			!expr._tpBoxing &&
			!expr._ifaceKeyDyn &&
			this._typeParamZeroFactory(expr._ifaceSrc.name)
		) {
			// A type parameter's value entering an interface is boxed and
			// tagged by the instantiated type (see `__ti`).
			expr._tpBoxing = true;
			try {
				const f = this._typeParamZeroFactory(expr._ifaceSrc.name);
				return `(${f}.b ?? ${f}.fb ?? ((__v) => __v))(${this.genExpr(expr)})`;
			} finally {
				expr._tpBoxing = false;
			}
		}
		if (this._isNamedIfaceBox(expr)) return this._genNamedIfaceBoxExpr(expr);
		if (
			expr._ifaceSrc &&
			!expr._tfnTagging &&
			this._isTaggedFuncType(expr._ifaceSrc)
		) {
			// A value of a defined func type keeps that type in an interface.
			expr._tfnTagging = true;
			try {
				this.useHelper("ifaceBox");
				return `__tfn(${this.genExpr(expr)}, ${JSON.stringify(expr._ifaceSrc.name)})`;
			} finally {
				expr._tfnTagging = false;
			}
		}
		if (isGenericComposite(expr._ifaceSrc) && !expr._gmapTagging) {
			const tag = this._genericMapTag(expr._ifaceSrc);
			if (tag) {
				this.useHelper("ifaceBox");
				expr._gmapTagging = true;
				try {
					// An array is copied before it is tagged: a copy made after
					// `__ity` (`.map`) would drop the tag.
					return `__ity(${this.genValueExpr(expr)}, ${tag})`;
				} finally {
					expr._gmapTagging = false;
				}
			}
		}
		{
			const tag = this._ityTag(expr);
			if (tag) {
				this.useHelper("ifaceBox");
				expr._ityTagging = true;
				try {
					const ptr = this._dynTagFlags(expr._ifaceSrc);
					// An array is copied before it is tagged: the copy is the value
					// the interface holds, and it must keep the tag.
					return `__ity(${this.genValueExpr(expr)}, ${JSON.stringify(tag)}${ptr})`;
				} finally {
					expr._ityTagging = false;
				}
			}
		}
		if (expr._ifaceBox && !expr._ifaceBoxing && !this._isNamedBoxKind(expr)) {
			expr._ifaceBoxing = true;
			try {
				this.useHelper("ifaceBox");
				// `__ifv` copies an anonymous struct shallowly, so an addressable
				// one with array or struct fields is cloned field by field first.
				const own =
					this._isAnonAggregateStruct(expr._type) &&
					this._isAddressableExpr(expr);
				const boxed = this._ifaceBoxWrap(
					own
						? this._cloneJs(expr._type, this.genExpr(expr))
						: this.genExpr(expr),
					expr._ifaceBox,
					expr._ifacePtrFields,
					own || expr.kind === "CompositeLit",
				);
				return this._typedNilWrap(boxed, expr);
			} finally {
				expr._ifaceBoxing = false;
			}
		}
		const f32 = this._genFloat32Const(expr);
		if (f32 !== null) return f32;
		const c64 = this._genComplex64Const(expr);
		if (c64 !== null) return c64;
		const folded = this._genFoldedConst(expr);
		if (folded !== null) return folded;
		switch (expr.kind) {
			case "BasicLit":
				if (expr.litKind === "STRING") return JSON.stringify(expr.value);
				if (
					(this._is64BitInt(expr._type) || expr._is64Bit) &&
					(expr.litKind === "INT" || expr._const?.k === "INT")
				) {
					return `${expr.value}n`;
				}
				if (expr._const?.k === "INT")
					this._warnConstPrecision(expr._const, expr);
				return expr.value; // int, float, bool, nil(null)
			case "ImagLit":
				return `{ re: 0, im: ${expr.value} }`;
			case "Ident": {
				if (this._boxedVars.has(expr.name) && !expr._isAddressOf)
					return `${expr.name}.value`;
				// A named untyped constant used as an int64 operand: its
				// declaration holds a Number, so emit the exact BigInt.
				const lit64 =
					expr._is64Bit &&
					expr._const &&
					(expr._type?.kind === "untyped" || this._is64BitInt(expr._type))
						? this._gen64BitFoldedConst(expr, expr._const)
						: null;
				return lit64 ?? expr.name;
			}
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

	// `//go:embed` initialiser (see `lowerEmbeds`). A string is a literal; a
	// []byte decodes a base64 constant into a fresh Uint8Array, and the constant
	// of a file is declared once however many variables embed it. An embed.FS
	// holds its sorted names and one such array per file.
	_genEmbedData(node) {
		if (node.as === "fs") {
			const names = node._files.map((f) => JSON.stringify(f.path));
			const datas = node._files.map((f) => this._genEmbedBytes(f.bytes));
			return `new ${jsClassName(node._type.name)}([${names}], [${datas}])`;
		}
		const bytes = node._files[0]?.bytes ?? new Uint8Array(0);
		if (node.as === "string") return JSON.stringify(decodeRawBytes(bytes));
		return this._genEmbedBytes(bytes);
	},

	_genEmbedBytes(bytes) {
		this.useHelper("b64");
		const key = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
		const name = `__emb_${key}`;
		this._embedBlobs ??= new Set();
		if (!this._embedBlobs.has(name)) {
			this._embedBlobs.add(name);
			const b64 = Buffer.from(bytes).toString("base64").replace(/=+$/, "");
			this.line(`var ${name} = ${JSON.stringify(b64)};`);
		}
		return `__b64(${name})`;
	},

	_gen64BitFoldedConst(expr, val) {
		if (
			(this._is64BitInt(expr._type) || expr._is64Bit) &&
			(val.k === "INT" || expr._intConst)
		) {
			const n = constIntValue(val);
			if (n !== null) return n < 0n ? `(${n}n)` : `${n}n`;
		}
		return null;
	},

	// An untyped constant converted to float32 (`var c float32 = 0.01`) is
	// emitted as its float32 value, or null when that changes nothing.
	_genFloat32Const(expr) {
		const val = expr._const;
		if (!expr._f32Const || !val || (val.k !== "FLOAT" && val.k !== "INT"))
			return null;
		const n = Number(val.v);
		if (!Number.isFinite(n)) return null;
		const r = Math.fround(n);
		if (r === n) return null;
		return CONST_LITS.FLOAT(r);
	},

	// An untyped complex constant that takes type complex64
	// (`var c complex64 = 1 + 0.01i`) is emitted as its folded value with
	// float32 components, or null when it cannot be folded here.
	_genComplex64Const(expr) {
		if (!expr._c64Const) return null;
		const c = complexConstParts(expr);
		if (!c) return null;
		const re = CONST_LITS.FLOAT(Math.fround(c[0]));
		const im = CONST_LITS.FLOAT(Math.fround(c[1]));
		return re === null || im === null ? null : `{ re: ${re}, im: ${im} }`;
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
		const lit64 = this._gen64BitFoldedConst(expr, val);
		if (lit64 !== null) return lit64;
		if (val.k === "INT" || expr._intConst) this._warnConstPrecision(val, expr);
		return CONST_LITS[val.k]?.(val.v) ?? null;
	},

	// Warns when an integer constant outside ±2⁵³ has no exact Number (once
	// per node per generate run: some forms generate the same node more than
	// once, and cached ASTs are generated again by later compiles).
	_warnConstPrecision(val, expr) {
		if (this._is64BitInt(expr?._type) || expr?._is64Bit || expr?._floatConst)
			return;
		const i = constIntValue(val);
		if (i === null || (i <= JS_SAFE_INT && i >= -JS_SAFE_INT)) return;
		if (BigInt(Number(i)) !== i && !this._precisionWarned.has(expr)) {
			this._precisionWarned.add(expr);
			this._warn(`constant ${i} exceeds JS Number precision`, expr);
		}
	},

	// `js` boxed as `box` (a checker _ifaceBoxMeta kind) for an interface.
	// `fresh` marks a value nothing else refers to (a composite literal), which
	// a struct box then takes over instead of copying.
	_ifaceBoxWrap(js, box, ptrFields, fresh = false) {
		this.useHelper("ifaceBox");
		const fn =
			{
				ptr: "__ifp",
				ptr_slice: "__ifps",
				ptr_map: "__ifpm",
				map: "__ifm",
				slice: "__ifs",
			}[box] ?? "__ifv";
		// Field paths name JS properties, which `jsMemberName` may suffix.
		const fields = ptrFields?.length
			? JSON.stringify(
					ptrFields.map((f) => f.split(".").map(jsMemberName).join(".")),
				)
			: "";
		if (fn === "__ifv" && fresh)
			return `${fn}(${js}, ${fields || "null"}, true)`;
		return `${fn}(${js}${fields ? `, ${fields}` : ""})`;
	},

	// A nil `*T` entering an interface is a typed nil: it keeps T's methods
	// (callable with a nil receiver) and differs from the nil interface.
	_typedNilWrap(js, expr) {
		if (expr._ifaceBox !== "ptr") return js;
		const src = expr._ifaceSrc;
		const base = src?.kind === "pointer" ? src.base : null;
		if (base?.kind !== "named" || base.underlying?.kind !== "struct") return js;
		const cls = this._dequalify(base.name).replace(/\[.*$/, "");
		if (!this.structNames.has(cls)) return js;
		return `__ifn(${js}, ${jsClassName(cls)})`;
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
		const base = t.kind === "named" ? namedUnderlying(t, this.checker) : t;
		if (base?.name && this.structNames.has(base.name)) return true;
		return base?.kind === "struct";
	},

	_isStructPointerType(t) {
		if (!t) return false;
		const pt = t.kind === "named" ? namedUnderlying(t, this.checker) : t;
		if (pt?.kind !== "pointer") return false;
		return this._isStructType(pt.base);
	},

	_isScalarPointerType(t) {
		if (!t) return false;
		const pt = t.kind === "named" ? namedUnderlying(t, this.checker) : t;
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
		const b = t.kind === "named" ? namedUnderlying(t, this.checker) : t;
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
		if (node.kind === "TypeName" || node.kind === "SelectorExpr")
			return this._typeFromNameNode(node);
		if (node.kind === "ArrayType")
			return { kind: "array", elem: this._typeFromNode(node.elem) };
		if (node.kind === "StructType") return this._typeFromStructNode(node);
		return null;
	},

	_typeFromNameNode(node) {
		// `pkg.S` of a bundled package names the class `S`.
		const name = this.getTypeName(node);
		if (name && this.structNames.has(name))
			return { kind: "named", name, underlying: { kind: "struct" } };
		if (node.kind !== "TypeName") return null;
		if (this._typeParamZeroFactory(node.name))
			return { kind: "typeParam", name: node.name };
		// A defined array or struct type (`type Vec [2]int`).
		const named = this.checker?.types.get(node.name);
		if (named?.kind === "struct") return named; // alias of an anonymous struct
		return named?.kind === "named" && this._aggregateBase(named) ? named : null;
	},

	_typeFromStructNode(node) {
		const fields = new Map();
		for (const f of node.fields) {
			if (f.embedded) {
				const ft = this._typeFromNode(f.type);
				const en = f.type?.name ?? f.type?.base?.name;
				if (ft && en) fields.set(en, ft);
				continue;
			}
			for (const n of f.names ?? []) fields.set(n, this._typeFromNode(f.type));
		}
		return {
			kind: "struct",
			fields,
			_embeds: node.fields.filter((f) => f.embedded),
		};
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
			return this._cloneAnonStruct(base, js);
		}
		const elemClone = this._cloneJs(base.elem, "__e");
		return elemClone === "__e"
			? `${js}?.slice()`
			: `${js}?.map((__e) => ${elemClone})`;
	},

	// An anonymous struct type (no class) whose copy is made field by field.
	_isAnonAggregateStruct(t) {
		const base = this._aggregateBase(t);
		return (
			base?.kind === "struct" &&
			!this._structClassName(t) &&
			!this._structClassName(base) &&
			this._anonCloneFields(base).length > 0
		);
	},

	// Array and struct fields of an anonymous struct, embedded ones included.
	_anonCloneFields(base) {
		if (!(base.fields instanceof Map)) return [];
		return [...base.fields].filter(([, ft]) => this._aggregateBase(ft));
	},

	// Copy of an anonymous struct (no class). Array and struct fields are
	// cloned one by one, so the copy shares no storage with the original;
	// pointer, slice, map and other fields are copied as references.
	// `plain` forces a fresh plain object even when no field needs a deep copy,
	// for a source that may be an instance of a struct class.
	_cloneAnonStruct(base, js, plain = false) {
		const fields = this._anonCloneFields(base);
		if (fields.length === 0 && !plain) {
			this.useHelper("sclone");
			return `__sclone(${js})`;
		}
		const cloned = new Map(
			fields.map(([name, ft]) => [
				name,
				this._cloneJs(ft, `__v.${jsMemberName(name)}`),
			]),
		);
		const props = [...base.fields.keys()].map((name) =>
			cloned.has(name)
				? `${jsMemberName(name)}: ${cloned.get(name)}`
				: `${jsMemberName(name)}: __v.${jsMemberName(name)}`,
		);
		return `((__v) => ({ ${props.join(", ")} }))(${js})`;
	},

	_isAddressableExpr(e) {
		switch (e?.kind) {
			case "Ident":
				return (
					e.name !== "_" && (!e._isTypeRef || e._type?.kind === "typeParam")
				);
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

	// The type tag `expr` takes on entering an interface, or null.
	_ityTag(expr) {
		if (!expr._ifaceSrc || expr._ityTagging || this._isNamedBoxKind(expr))
			return null;
		return this._dynTypeTag(expr._ifaceSrc);
	},

	// Emits `expr` as a Go value: struct/array operands that alias existing storage are copied.
	genValueExpr(expr) {
		const tagged =
			Boolean(this._ityTag(expr)) ||
			(isGenericComposite(expr._ifaceSrc) &&
				!expr._gmapTagging &&
				Boolean(this._genericMapTag(expr._ifaceSrc)));
		const js = this.genExpr(expr);
		if (expr._ifaceBox || tagged) return js;
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

	// True when `node` may modify (or take the address of) the value held by variable `name`.
	_nodeMutatesVar(node, name, addrOnly = false) {
		return nodeMutatesVar(node, name, addrOnly);
	},

	_fnMutates(name, addrOnly = false) {
		const ctx = this._fnCtx;
		if (fnMutates(ctx?.body, name, addrOnly, ctx?.mut)) return true;
		// A captured variable whose address an enclosing function takes: a
		// whole-value store here must keep the variable's identity.
		if (!addrOnly || !ctx?.parent || ctx.ownParams?.has(name)) return false;
		if (declaresVar(ctx.body, name)) return false;
		const saved = this._fnCtx;
		this._fnCtx = ctx.parent;
		try {
			return this._fnMutates(name, addrOnly);
		} finally {
			this._fnCtx = saved;
		}
	},

	_withFnCtx(body, fn, ownParams = null) {
		const prev = this._fnCtx;
		// A function starts with no JS labels in scope (see
		// `_emitIterTargetDispatch`), outside any range-over-func body: a
		// closure in one returns from itself, not from the loop's function.
		const prevLabels = this._jsLabels;
		const prevInIter = this._inIteratorBody;
		this._jsLabels = [];
		this._inIteratorBody = false;
		this._fnCtx = {
			body,
			parent: prev,
			ownParams: ownParams ? new Set(ownParams) : null,
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
			this._jsLabels = prevLabels;
			this._inIteratorBody = prevInIter;
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
			// &(*p) is p itself, nil-checked: Go panics on a nil p.
			const deref = derefOf(expr.operand);
			if (deref) {
				const js = this.genExpr(deref.operand);
				return deref._nonNil ? js : this._genNilChecked(js);
			}
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
				const field = jsMemberName(expr.operand.field);
				return `((__o) => Object.defineProperties({ get value() { return __o.${field}; }, set value(v) { __o.${field} = v; } }, { __target: { value: __o }, __index: { value: "${field}" } }))(${obj})`;
			}
			// For non-boxed vars (primitives, etc.), wrap in { value: x }
			return `{ value: ${this.genExpr(expr.operand)} }`;
		}
		// Dereference: *p
		if (op === "*") {
			if (this._isStructPointerType(expr.operand._type)) {
				return expr._nonNil
					? this.genExpr(expr.operand)
					: this._genNilChecked(this.genExpr(expr.operand));
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
		if (this._is64BitInt(expr._type) || expr._is64Bit) {
			let operandCode = code;
			if (!operandCode.endsWith("n") && /^-?\d+$/.test(operandCode)) {
				operandCode = `${operandCode}n`;
			}
			if (op === "+") return operandCode;
			const wrap = this._is64BitUnsigned(expr._type)
				? "BigInt.asUintN"
				: "BigInt.asIntN";
			if (op === "-" || op === "~") return `${wrap}(64, ${op}(${operandCode}))`;
		}
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
		if (expr._stdName) {
			// An untyped constant used as an int64 operand: its declaration
			// holds a Number, so emit the exact BigInt (as for an Ident).
			const lit64 =
				expr._is64Bit && expr._type?.kind === "untyped" && expr._const
					? this._gen64BitFoldedConst(expr, expr._const)
					: null;
			return lit64 ?? expr._stdName;
		}
		if (this._isStdlibFuncValue(expr)) return this._genStdlibFuncValue(expr);
		if (expr._isMethodExpr) {
			const namedExpr = this._namedMethodExprInfo(expr);
			if (namedExpr) return `${namedExpr.cls}.$${expr.field}`;
			const rt = expr._methodExprRecv;
			// `(*MyInt).M` for a pointer-receiver method of a named non-struct
			// type: the static method takes the pointer, nil included.
			if (rt?.kind === "pointer") {
				const info = this._namedBoxInfo(rt.base);
				const decl = rt.base?.methods?.get(expr.field)?._methodDecl;
				if (info?.methods.has(expr.field) && decl?.recvPointer)
					return `${info.cls}.$${expr.field}`;
			}
			const protoCls = this._ptrMethodProtoClass(rt, expr.field);
			if (protoCls) {
				// A value-receiver method reads `*recv`, which panics on nil.
				let recv = "recv";
				if (rt.base.methods.get(expr.field)?._ptrRecv === false) {
					this.useHelper("nilCall");
					recv = "__nilcall(recv)";
				}
				return `((recv, ...args) => ${protoCls}.prototype.${jsMemberName(expr.field)}.call(${recv}, ...args))`;
			}
			return `((recv, ...args) => recv.${jsMemberName(expr.field)}(...args))`;
		}
		const namedValue = this._genNamedMethodValue(expr);
		if (namedValue !== undefined) return namedValue;
		if (expr.expr.kind === "Ident") {
			const nsConst = NS_CONSTANTS[expr.expr.name]?.[expr.field];
			if (nsConst !== undefined) {
				return nsConst;
			}
		}
		const base = this.genExpr(expr.expr);
		// Bundled GoFront package member; browser-global names carry the `$`
		// suffix of their declaration (see jsBindingName).
		if (this.bundledPackages.has(base)) return jsBindingName(expr.field);
		if (expr.expr._type?.kind === "pointer" && expr.field !== "value")
			return this._genPointerSelectorField(expr, base);
		const sel = `${base}${this._promotedPath(expr)}.${this._jsMemberName(expr)}`;
		if (this._isHostMethodValue(expr))
			return this._genHostMethodValue(sel, base);
		if (expr._isMethodValue && !expr._callee) {
			// A value receiver is copied when the method value is evaluated.
			const t = expr.expr._type;
			if (!expr._type?._ptrRecv && this._aggregateBase(t))
				return `((__r) => __r.${this._jsMemberName(expr)}.bind(__r))(${this._cloneJs(t, base)})`;
			return `${sel}.bind(${base})`;
		}
		return sel;
	},

	// `el.method`, `window.fn` or `MyNS.fn` read as a value: a function of a
	// `.d.ts` object or namespace (a callback-typed property is read as it is).
	_isHostMethodValue(expr) {
		const t = expr._type;
		return (
			!expr._callee &&
			t?._hostFunc === true &&
			!t._dts &&
			expr.expr?._type?.kind === "namespace"
		);
	},

	// The method bound to its object, which is evaluated once. A member the
	// host lacks stays `undefined`, so `window.matchMedia != nil` still tests
	// for it.
	_genHostMethodValue(sel, base) {
		// A plain name is read twice harmlessly; a member chain may be a getter.
		if (/^[\w$]+$/.test(base)) return `${sel}?.bind(${base})`;
		const m = sel.slice(base.length);
		return `((__r) => __r${m}?.bind(__r))(${base})`;
	},

	// `pkg.Fn` used as a value (not called): a stdlib function is inlined at
	// its call sites, so a value is an arrow function that makes that call.
	// `.d.ts` declaration values (`_dtsType`) are real JS objects, not inlined
	// stdlib packages, so `window.matchMedia != nil` must read the property.
	_isStdlibFuncValue(expr) {
		const t = expr._type;
		if (expr._callee || t?.kind !== "func" || expr._isMethodExpr) return false;
		// A function a `.d.ts` declares is JavaScript, never inlined.
		if (t._hostFunc) return false;
		const ns = expr.expr;
		if (
			ns?.kind !== "Ident" ||
			ns._type?.kind !== "namespace" ||
			ns._type._dtsType
		)
			return false;
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
		// A defined pointer type (`type PO *Outer`) reaches the same fields.
		const ptr = namedBase(t);
		if (ptr?.kind === "pointer") t = ptr.base;
		const path = this._embedPath(t, expr.field, 0);
		return path ? path.map((n) => `.${jsMemberName(n)}`).join("") : "";
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
			const name = embeddedFieldName(sf);
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
		return jsMemberName(f);
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
		return this._genCallArgList(expr).join(", ");
	},

	_genCallArgList(expr) {
		return expr.args.map((a, i) =>
			a._spread
				? this._genSpreadArg(expr, a)
				: a._boxTypeParam
					? this._genTypeParamBox(a)
					: this._callerCopiesArg(expr, i)
						? this.genValueExpr(a)
						: this.genExpr(a),
		);
	},

	// A type parameter operand of a Print-family fmt call (see
	// src/lower/fmt-formatters.js): a JS value does not know its Go type, so
	// the type argument boxes it as converting it to an `any` does.
	_genTypeParamBox(a) {
		// Boxed below: skip the boxing of a value entering an interface.
		const wasBoxing = a._tpBoxing;
		a._tpBoxing = true;
		const js = this.genExpr(a);
		a._tpBoxing = wasBoxing;
		const tpf = this._typeParamZeroFactory(a._type.name);
		return tpf ? `(${tpf}.b ?? ${tpf}.fb ?? ((__v) => __v))(${js})` : js;
	},

	// A direct call of a `//gofront:native` function: host code from the
	// registry, or null (declined, natives off, spread arguments) to call the
	// Go body.
	_genNativeCall(expr) {
		if (!this.natives || !expr._native) return null;
		if (expr._multiForward || expr.args.some((a) => a._spread)) return null;
		const typeArgs = expr._typeArgs ?? expr.func._typeArgs ?? [];
		const js = jsNativeCall(expr._native, this._genCallArgList(expr), typeArgs);
		if (js !== null && NATIVE_HELPERS.has(expr._native))
			this.useHelper(NATIVE_HELPERS.get(expr._native));
		return js;
	},

	// `f(xs...)`: a Go-compiled variadic callee receives the slice itself in a
	// marker (its prologue unwraps it); other callees get a JS spread, where a
	// nil slice spreads to no operands as it does in Go.
	_genSpreadArg(call, arg) {
		const js = this.genExpr(arg);
		if (!call.func._stdName && this._calleeIsGoVariadic(call))
			return `{ __sp: ${js} }`;
		return `...(${js} ?? [])`;
	},

	_calleeIsGoVariadic(call) {
		const f = call.func;
		if (f._type?._hostFunc === true) return false;
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
		if (this._calleeIsBrowserApi(expr)) return false;
		let ft = expr.func?._type ?? expr.func?.expr?._type;
		if (ft?.kind === "generic") ft = ft.underlying;
		if (ft?.kind !== "func") return false;
		const params = ft.params ?? [];
		if (ft.variadic && i >= params.length - 1) return true;
		return params[i]?.kind === "typeParam";
	},

	// A call of a browser API the `gofront/*` declarations type: a global
	// (`alert`), or a method of a value of a declared interface or class
	// (`console.log`, `el.classList.add`). Its callee is JavaScript, so it has no
	// rest array or type parameter to protect from the caller's aggregates.
	_calleeIsBrowserApi(call) {
		const f = call.func;
		// A stored one (`fn := console.log; fn(x)`) is still JavaScript.
		if (f._type?._hostFunc === true) return true;
		if (f.kind === "Ident")
			return BROWSER_GLOBALS.has(f.name) && !this.variadicFns?.has(f.name);
		if (f.kind !== "SelectorExpr" || f._isMethodExpr) return false;
		return f.expr?._type?._dtsType === true;
	},

	_genPointerSelectorField(expr, base) {
		if (this._isStructPointerType(expr.expr._type)) {
			// Strict mode: a field of a nil struct pointer panics as in Go.
			const recv =
				this.strict && !expr._isMethodValue && !expr._nonNil
					? this._genNilChecked(base)
					: base;
			const sel = `${recv}${this._promotedPath(expr)}.${jsMemberName(expr.field)}`;
			if (expr._isMethodValue && !expr._callee) {
				// `p.M` with a value receiver binds a copy of `*p` now.
				if (expr._derefRecv) {
					const copy = this._cloneJs(
						expr.expr._type.base,
						this.strict ? this._genNilChecked(base) : base,
					);
					return `((__r) => __r.${jsMemberName(expr.field)}.bind(__r))(${copy})`;
				}
				// A pointer receiver may be nil: bind through the prototype so
				// `s.M` on a nil pointer does not read `.M` off null.
				const protoCls = this._ptrMethodProtoClass(
					expr.expr._type,
					expr.field,
					expr,
				);
				if (protoCls)
					return `${protoCls}.prototype.${jsMemberName(expr.field)}.bind(${base})`;
				return `${sel}.bind(${base})`;
			}
			return sel;
		}
		const sel = `${base}.value.${jsMemberName(expr.field)}`;
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
		let idx = this.genExpr(expr.index);
		if (expr._mapValueType) {
			if (!expr._lvalue) return this._genMapIndexExpr(expr, base, idx);
			return `${this._genMapWriteBase(base)}[${idx}]`;
		}
		idx = this._asIndexNumber(idx, expr.index?._type);
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
			return `((__m, __k) => __m?.[__k] ?? ${zero})(${base}, ${idx})`;
		return `(${base}?.[${idx}] ?? ${zero})`;
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
		const lo = expr.low
			? this._asIndexNumber(this.genExpr(expr.low), expr.low._type)
			: "0";
		const hi = expr.high
			? this._asIndexNumber(this.genExpr(expr.high), expr.high._type)
			: "undefined";
		if (this._isStringExprType(expr.expr._type)) {
			// `both` packages panic on bad bounds; `js` packages keep `slice`.
			if (this.strict) {
				this.useHelper("sslice");
				return `__sslice(${base}, ${lo}${expr.high ? `, ${hi}` : ""})`;
			}
			return expr.high ? `${base}.slice(${lo}, ${hi})` : `${base}.slice(${lo})`;
		}
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
		const max = expr.max
			? `, ${this._asIndexNumber(this.genExpr(expr.max), expr.max._type)}`
			: "";
		// An array (or array pointer) is a JS array like a slice: the flag
		// makes a failed bounds check word its limit as a length.
		if (this._isArrayOperand(expr.expr._type))
			return `__slice(${base}, ${lo}, ${hi}${max || ", undefined"}, 1)`;
		return `__slice(${base}, ${lo}, ${hi}${max})`;
	},

	_isArrayOperand(t) {
		let u = this._underlyingOf(t);
		if (u?.kind === "pointer") u = this._underlyingOf(u.base);
		return u?.kind === "array";
	},

	_genFuncLit(expr) {
		const params = this._paramNames(expr.params).join(", ");
		const asyncPrefix = expr.async ? "async " : "";
		const saved = this.out;
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set(prevBoxed); // inherit parent's boxed vars (closures)
		this._scanAddressTaken(expr.body);
		this.out = [];
		this._withFnCtx(
			expr.body,
			() =>
				this.indented(() => {
					this._emitParamCopies(expr.params);
					this._withNamedReturns(expr, () => this._genBody(expr.body, expr));
				}),
			expr.params.map((p) => p.name),
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
			this.useHelper("ifaceBox");
			return wrap(
				`(${check} ? ${out} : (() => { throw ${this._typeAssertFailJs(expr, val)}; })())`,
			);
		}
		// comma-ok: emit [value-or-zero, runtimeTypeCheck]; an asserted struct
		// or array is a copy of the boxed value.
		const zero = this.zeroValueForTypeNode(expr.type);
		const valT = this._typeFromNode(expr.type);
		const okOut = this._aggregateBase(valT) ? this._cloneJs(valT, out) : out;
		return wrap(`(${check} ? [${okOut}, true] : [${zero}, false])`);
	},

	// The error a failed `x.(T)` throws: Go's `interface conversion: ...` text
	// naming the static interface type, the dynamic type and the target.
	_typeAssertFailJs(expr, val) {
		const target = expr._type;
		const u = this._underlyingOf(target);
		const methods =
			u?.kind === "interface" ? [...(u.methods?.keys() ?? [])] : [];
		const tName = this._assertTypeName(target) ?? goTypeName(expr.type);
		const src = this._assertTypeName(expr.expr?._type) ?? "interface {}";
		return `__tafail(${JSON.stringify(src)}, ${val}, ${JSON.stringify(tName)}, ${methods.length ? JSON.stringify(methods.sort()) : "null"})`;
	},

	// Go's spelling of the static type in a failed assertion message; null for
	// `any` (`interface {}`).
	_assertTypeName(t) {
		if (!t || isAny(t)) return null;
		return t.name === "error" ? "error" : goTypeName(t);
	},

	// `csv.ParseError` names the class of the bundled Go-source package type.
	// Declaration-package (`.d.ts`) namespaces are host interfaces, never Go
	// structs, even when a Go struct in the build shares the unqualified name.
	_qualifiedStructName(name) {
		if (!name.includes(".") || this.structNames.has(name)) return name;
		const t = this.checker?.types.get(name);
		if (!t || t.kind === "namespace" || t._dtsType) return name;
		const cls = t.name;
		return cls && this.structNames.has(cls) ? cls : name;
	},

	_simdCheckExpr(name, val) {
		if (name === "simd.F32x4" || name === "F32x4")
			return `(Array.isArray(${val}) && ${val}.length === 4 && typeof ${val}[0] === "number")`;
		if (name === "simd.Mask32x4" || name === "Mask32x4")
			return `(Array.isArray(${val}) && ${val}.length === 4 && typeof ${val}[0] === "boolean")`;
		return null;
	},

	_typeNameCheckExpr(typeName, val) {
		// A type parameter: the instantiated type's test travels with its factory.
		const factory = this._typeParamZeroFactory(typeName);
		if (factory) return `(${factory}?.is?.(${val}) ?? true)`;
		const name = this._qualifiedStructName(typeName);
		// int64 and uint64 share the BigInt: a value out of int64's range can
		// only be a uint64.
		if (name === "int64")
			return `(typeof ${val} === "bigint" && ${val} >= -9223372036854775808n && ${val} <= 9223372036854775807n)`;
		if (name === "uint64")
			return `(typeof ${val} === "bigint" && ${val} >= 0n)`;
		// Integer types share the JS number with the floats: only a whole
		// number is one, so a fraction or -0 in an `any` falls through to float64.
		if (INT_TYPE_NAMES.has(name))
			return `(Number.isSafeInteger(${val}) && !Object.is(${val}, -0))`;
		if (TYPEOF_NUMBER_NAMES.has(name)) return `typeof ${val} === "number"`;
		if (name === "complex128" || name === "complex64")
			return `(typeof ${val} === "object" && ${val} !== null && typeof ${val}.re === "number" && typeof ${val}.im === "number")`;
		if (name === "string") return `typeof ${val} === "string"`;
		if (name === "bool") return `typeof ${val} === "boolean"`;
		if (name === "nil") return `${val} === null`;
		if (name === "any") return `(${val} != null)`;
		const simd = this._simdCheckExpr(name, val);
		if (simd) return simd;
		if (name === "error")
			return `(typeof ${val} === "object" && ${val} !== null && typeof ${val}.Error === "function")`;
		if (this.structNames.has(name))
			return `(${val} instanceof ${jsClassName(name)} && ${val}.__p !== true)`;
		const named = this.checker?.types.get(name);
		const namedInfo = this._namedBoxInfo(named);
		if (namedInfo) return `(${val} instanceof ${namedInfo.cls})`;
		// User-declared interfaces (and aliases to any/interfaces): check the
		// dynamic value is non-nil and has every method.
		const under = this._underlyingOf(named);
		if (isAny(under)) return `(${val} != null)`;
		if (under?.kind === "interface" && name !== "error")
			return this._ifaceMethodCheck(
				val,
				[...(under.methods?.keys() ?? [])],
				this._unwrapIsMulti(under.methods?.get("Unwrap")),
			);
		if (this._isTaggedFuncType(named)) {
			this.useHelper("ifaceBox");
			return `__isty(${val}, ${JSON.stringify(name)}, "namedfunc")`;
		}
		if (this._isNamedComposite(named)) {
			this.useHelper("ifaceBox");
			return `__isty(${val}, ${JSON.stringify(name)}, "named")`;
		}
		// An alias of an anonymous struct: a plain object with its fields.
		if (named?.kind === "struct") {
			const fields = [...(named.fields?.keys() ?? [])].map(
				(f) => `${JSON.stringify(jsMemberName(f))} in ${val}`,
			);
			return `(typeof ${val} === "object" && ${val} !== null && !Array.isArray(${val})${fields.map((f) => ` && ${f}`).join("")})`;
		}
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
		const checks = methodNames.map((m) => {
			const jm = jsMemberName(m);
			const base =
				m === "Unwrap" && multiUnwrap !== null
					? `typeof ${val}.${jm} === "function" && (${val}.${jm}.__multi === true) === ${multiUnwrap}`
					: `typeof ${val}.${jm} === "function"`;
			// A struct value's method set lacks the pointer-receiver methods.
			return `${base} && !(${val}.__v === true && ${val}.constructor.__pm?.includes(${JSON.stringify(m)}))`;
		});
		return `(${[`${val} != null`, ...checks].join(" && ")})`;
	},

	// The value an assertion to `typeNode` yields: raw, unboxed from the
	// interface's box for a named non-struct type (known only at run time
	// for a type parameter).
	_assertedValueJs(typeNode, val) {
		if (this._isNamedBoxTypeNode(typeNode)) return `${val}.__gfUnbox()`;
		if (
			this._isStructPtrTypeNode(typeNode) ||
			(typeNode?.kind === "PointerType" && typeNode._assertType)
		) {
			this.useHelper("ifaceBox");
			return `__unnil(${val})`;
		}
		if (
			typeNode?._assertType?.kind === "slice" ||
			this._isNamedSliceTypeNode(typeNode)
		) {
			// A nil slice in an interface is a tagged empty array.
			this.useHelper("ifaceBox");
			return `__unnil(${val})`;
		}
		const factory =
			typeNode?.kind === "TypeName"
				? this._typeParamZeroFactory(typeNode.name)
				: null;
		return factory ? `(${factory}?.u ? ${val}.__gfUnbox() : ${val})` : val;
	},

	// A type name that denotes a defined slice type (`type S []int`).
	_isNamedSliceTypeNode(typeNode) {
		if (typeNode?.kind !== "TypeName") return false;
		const named = this.checker?.types.get(typeNode.name);
		return (
			this._isNamedComposite(named) &&
			this._underlyingOf(named)?.kind === "slice"
		);
	},

	_isStructPtrTypeNode(typeNode) {
		const base = typeNode?.kind === "PointerType" ? typeNode.base : null;
		const name =
			base?.kind === "TypeName"
				? base.name
				: base?.kind === "GenericTypeName"
					? this._dequalify(base.name)
					: null;
		return (
			name !== null && this.structNames.has(this._qualifiedStructName(name))
		);
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

	// Converting a struct to a defined struct type (its own type included)
	// builds a copy in the target's class (so its methods exist); null when
	// not applicable.
	// An instance of a generic target keeps its own type arguments, not the
	// source's.
	_genStructClassConversion(targetName, srcType, inner, targetType) {
		if (!targetName || targetName.includes("[")) return null;
		const target = this.checker?.types.get(targetName);
		if (target?.kind !== "named" || target.underlying?.kind !== "struct")
			return null;
		const srcU = srcType?.kind === "named" ? srcType.underlying : srcType;
		if (srcU?.kind !== "struct") return null;
		const cls = this._dequalify(targetName);
		const clone = this._cloneJs(srcType, inner);
		const typed = targetType?.typeArgs?.length
			? this._genericStructNew(targetName, targetType.typeArgs)
			: null;
		if (typed) {
			this.useHelper("generics");
			return `((s, o) => Object.assign(o, s, { [__tz]: o[__tz] }))(${clone}, ${typed})`;
		}
		return `Object.assign(new ${jsClassName(cls)}(), ${clone})`;
	},

	// Conversion to an anonymous struct type: the result is a plain object
	// holding a copy of the source's fields, never the source instance itself.
	_genAnonStructConversion(targetType, inner) {
		const base = targetType?.kind === "named" ? null : targetType;
		if (base?.kind !== "struct" || this._structClassName(base)) return null;
		if (!(base.fields instanceof Map)) return null;
		return this._cloneAnonStruct(base, inner, true);
	},

	_resolvedConversionTargetNode(base, srcExpr) {
		switch (base?.kind) {
			case "basic":
				return { kind: "TypeName", name: base.name };
			case "interface":
				return base.name === "error"
					? { kind: "TypeName", name: "error" }
					: null;
			case "array":
				return { kind: "ArrayType", size: base.size, elem: base.elem };
			case "map":
				return this._isNilLiteral(srcExpr) ? { kind: "MapType" } : null;
			case "slice": {
				// A string operand, or a type parameter with a string term,
				// is encoded into a new slice.
				const elem = this._underlyingOf(base.elem)?.name;
				const fromText =
					(this._isStringExprType(srcExpr?._type) ||
						this._convSourceKinds(srcExpr)?.has("string")) &&
					["byte", "uint8", "rune", "int32", "int"].includes(elem);
				return this._isNilLiteral(srcExpr) || fromText
					? { kind: "SliceType", elem: base.elem }
					: null;
			}
			default:
				return null;
		}
	},

	_genTypeConversionCall(expr) {
		const targetType = expr._conversionTargetType;
		const srcExpr = expr.args[0];
		const arg = this.genExpr(srcExpr);
		const anonConv = this._genAnonStructConversion(targetType, arg);
		if (anonConv) return anonConv;
		const viaParam = this._genTypeParamConversion(targetType?.name, arg);
		if (targetType?.kind === "typeParam" && viaParam) return viaParam;
		const structConv = this._genStructClassConversion(
			targetType?.kind === "named" ? targetType.name : undefined,
			srcExpr?._type,
			arg,
			targetType,
		);
		if (structConv) return structConv;
		if (this._isTaggedFuncType(targetType)) {
			this.useHelper("ifaceBox");
			return `__tfn(${arg}, ${JSON.stringify(targetType.name)})`;
		}
		const base =
			targetType?.kind === "named" ? targetType.underlying : targetType;
		const targetNode = this._resolvedConversionTargetNode(base, srcExpr);
		return targetNode
			? this._genTypeConversion(
					{ targetType: targetNode, expr: srcExpr, _type: expr._type },
					arg,
				)
			: arg;
	},

	// `json.Marshal(v)` / `enc.Encode(v)` call the generated codec entry
	// (see src/lower/json-codecs.js); a stream method takes its receiver first.
	_jsonEntryCall(expr) {
		const sel = expr.func;
		const func = { kind: "Ident", name: sel._genEntry, _type: sel._type };
		const args = sel._jsonStream ? [sel.expr, ...expr.args] : expr.args;
		return { ...expr, func, args };
	},

	// `min(f())`, `append(f())`: the builtin was checked against one operand
	// node per result of f (`expr._fwdArgs`); an arrow function takes f's
	// results as those operands.
	_genForwardedBuiltin(expr) {
		this._fwdBuiltinCounter = (this._fwdBuiltinCounter ?? 0) + 1;
		const args = expr._fwdArgs.map((o, i) => ({
			...o,
			kind: "Ident",
			name: `__fwdbi$${this._fwdBuiltinCounter}$${i}`,
		}));
		const body = this.genCall({ ...expr, args, _multiForward: false });
		const names = args.map((a) => a.name).join(", ");
		return `((${names}) => (${body}))(...${this.genExpr(expr.args[0])})`;
	},

	genCall(expr) {
		if (expr.func._genEntry) return this.genCall(this._jsonEntryCall(expr));
		if (expr._isTypeConversion) return this._genTypeConversionCall(expr);

		const native = this._genNativeCall(expr);
		if (native !== null) return native;

		const funcExpr =
			expr.func.kind === "InstantiationExpr" ? expr.func.expr : expr.func;
		if (funcExpr.kind === "Ident") {
			const builtin = this._genBuiltinIdent(expr._builtinName, expr);
			if (builtin !== undefined) return builtin;
		}

		const viaBox = this._genTypeParamMethodCall(expr);
		if (viaBox !== null) return viaBox;

		if (expr.func.kind === "SelectorExpr") {
			const result = this._genSelectorCall(expr);
			if (result !== undefined) return result;
		}

		const converted = this._convertedPointerMethodCall(expr);
		if (converted) return converted;

		const nilSafe = this._nilSafeMethodClass(expr.func);
		if (nilSafe) {
			// The method tests its receiver for nil: call it through the
			// prototype so a nil `this` reaches it instead of a TypeError.
			const recv = this.genExpr(expr.func.expr);
			const rest = this._genCallArgs(expr);
			const m = jsMemberName(expr.func.field);
			const viaProto = (r) =>
				`${nilSafe}.prototype.${m}.call(${rest ? `${r}, ${rest}` : r})`;
			// A non-nil variable keeps the direct (faster) call.
			if (/^[\w$]+$/.test(recv))
				return `(${recv} != null ? ${recv}.${m}(${rest}) : ${viaProto(recv)})`;
			return viaProto(recv);
		}

		expr.func._callee = true;
		const rawFn = this.genExpr(expr.func);
		const fn = expr.func.kind === "FuncLit" ? `(${rawFn})` : rawFn;
		const args = this._genCallArgs(expr);
		const zeros = this._genericCallZeros(expr);
		if (!zeros) return `${fn}(${args})`;
		return `${fn}(${args ? `${zeros}, ${args}` : zeros})`;
	},

	// `x.M(...)` on a type-parameter value: a raw value of a named non-struct
	// type argument is boxed (by the type's factory) to reach its methods.
	_genTypeParamMethodCall(expr) {
		if (!this._isTypeParamMethodCall(expr)) return null;
		const factory = this._typeParamZeroFactory(expr.func.expr._type.name);
		if (!factory) return null;
		this.useHelper("generics");
		let recv = `__tbox(${factory}, ${this.genExpr(expr.func.expr)})`;
		// `P(&v).M()` with `P interface{ *T; M() }`: a pointer to a boxed
		// type-parameter variable is the box, so reach the value it holds.
		if (this._hasPointerTypeSet(expr.func.expr._type))
			recv = `((__r) => typeof __r?.${jsMemberName(expr.func.field)} === "function" ? __r : __r?.value)(${recv})`;
		const args = this._genCallArgs(expr);
		return `${recv}.${jsMemberName(expr.func.field)}(${args})`;
	},

	// Whether type parameter `tp` is constrained to a single `*T` type-set term.
	_hasPointerTypeSet(tp) {
		const c = tp.constraint;
		const iface = c?.kind === "named" ? c.underlying : c;
		const terms = iface?.unionConstraint?.terms;
		return (
			terms?.length === 1 &&
			(terms[0].resolved?.kind === "pointer" ||
				terms[0].type?.kind === "PointerType")
		);
	},

	// `(*S)(p).M()` where `p` points at another struct type: the JS object keeps
	// its own class, so call S's prototype method on it.
	_convertedPointerMethodCall(expr) {
		const sel = expr.func;
		if (sel?.kind !== "SelectorExpr" || sel._isMethodExpr) return null;
		let recv = sel.expr;
		while (recv?.kind === "ParenExpr") recv = recv.expr;
		if (recv?._isTypeConversion !== true) return null;
		const target = recv._conversionTargetType;
		const from = recv.args?.[0]?._type;
		if (target?.kind !== "pointer" || target.base?.kind !== "named")
			return null;
		if (from?.kind !== "pointer" || from.base === target.base) return null;
		if (target.base.underlying?.kind !== "struct") return null;
		const cls = jsClassName(target.base.name);
		if (!target.base.methods?.has(sel.field)) return null;
		const rest = this._genCallArgs(expr);
		const obj = this.genExpr(recv.args[0]);
		return `${cls}.prototype.${jsMemberName(sel.field)}.call(${rest ? `${obj}, ${rest}` : obj})`;
	},

	// The class whose prototype holds pointer-receiver method `field`, for a
	// pointer to a struct type that declares it directly (not promoted), so a
	// method value or expression can reach it with a nil receiver; else null.
	_ptrMethodProtoClass(ptr, field, sel) {
		if (ptr?.kind !== "pointer" || ptr.base?.kind !== "named") return null;
		if (ptr.base.underlying?.kind !== "struct") return null;
		if (sel && this._promotedPath(sel)) return null;
		if (!ptr.base.methods?.has(field)) return null;
		return jsClassName(ptr.base.name);
	},

	// The class of a pointer-receiver struct method that accepts a nil receiver
	// when `func` selects it on a pointer of exactly that struct, else null.
	_nilSafeMethodClass(func) {
		if (func?.kind !== "SelectorExpr" || func._isMethodExpr) return null;
		const t = func.expr?._type;
		if (t?.kind !== "pointer" || t.base?.kind !== "named") return null;
		// An instance of a generic struct (`Gen[int]`) shares its class.
		const cls = t.base.typeArgs?.length
			? this._structClassName(t.base)
			: t.base.name;
		if (!cls) return null;
		if (
			t.base.underlying?.kind === "struct" &&
			!this._promotedPath(func) &&
			this.nilSafeMethods?.has(`${cls}.${func.field}`)
		)
			return jsClassName(cls);
		// A Go-source stdlib type (`Buffer$$bytes`) is declared outside this
		// package: its method decl tells whether it tests the receiver for nil.
		const decl = cls.includes("$$")
			? t.base.methods?.get(func.field)?._methodDecl
			: null;
		return decl?.recvPointer && comparesToNil(decl.body, decl.recvName)
			? jsClassName(cls)
			: null;
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

	_genReceiverTypeCall(recvName, expr) {
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
			if (result !== undefined) {
				if (this._is64BitInt(expr._type)) {
					return `((__r) => typeof __r === "number" ? BigInt(__r) : __r)(${result})`;
				}
				if (
					expr._type?.kind === "tuple" &&
					expr._type.types.some((t) => this._is64BitInt(t))
				) {
					const casts = expr._type.types.map((t, i) =>
						this._is64BitInt(t)
							? `typeof __r[${i}] === "number" ? BigInt(__r[${i}]) : __r[${i}]`
							: `__r[${i}]`,
					);
					return `((__r) => [${casts.join(", ")}])(${result})`;
				}
				return result;
			}
		}
		const recvType = expr.func.expr._type;
		const recvName = this._resolveRecvName(recvType);
		const typed = this._genReceiverTypeCall(recvName, expr);
		if (typed !== undefined) {
			if (this._is64BitInt(expr._type)) {
				return `((__r) => typeof __r === "number" ? BigInt(__r) : __r)(${typed})`;
			}
			if (
				expr._type?.kind === "tuple" &&
				expr._type.types.some((t) => this._is64BitInt(t))
			) {
				const casts = expr._type.types.map((t, i) =>
					this._is64BitInt(t)
						? `typeof __r[${i}] === "number" ? BigInt(__r[${i}]) : __r[${i}]`
						: `__r[${i}]`,
				);
				return `((__r) => [${casts.join(", ")}])(${typed})`;
			}
			return typed;
		}
		const namedCall = this._genNamedMethodCall(expr);
		if (namedCall !== undefined) return namedCall;
		if (this.strict && this._isInterfaceType(recvType)) {
			// Go panics with a nil-dereference runtime error; JS would throw a
			// TypeError with a different message.
			this.useHelper("nilCall");
			const recv = this.genExpr(expr.func.expr);
			const args = this._genCallArgs(expr);
			return `__nilcall(${recv}).${jsMemberName(expr.func.field)}(${args})`;
		}
		return undefined;
	},

	// `len`/`cap` of an array or array pointer is a constant, but an operand
	// containing a call or receive is still evaluated (and a nil pointer is
	// not dereferenced).
	_genConstLen(expr) {
		const arg = expr.args[0];
		if (arg && hasCallOrReceive(arg))
			return `(${this.genExpr(arg)}, ${expr._constLen})`;
		return String(expr._constLen);
	},

	_isInterfaceType(t) {
		if (!t) return false;
		if (t.kind === "interface") return true;
		return t.kind === "named" && t.underlying?.kind === "interface";
	},

	_genBuiltinLen(expr) {
		if (expr._constLen != null) return this._genConstLen(expr);
		const arg = expr.args[0];
		const t = arg?._type;
		const wrapField = this._namedWrapperField(t, arg);
		if (wrapField) return `${this.genExpr(arg)}.${wrapField}.length`;
		const js = this.genExpr(arg);
		if (t?.kind === "map") return `Object.keys(${js} ?? {}).length`;
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
		if (expr._fwdArgs && expr._multiForward)
			return this._genForwardedBuiltin(expr);
		const gen = BUILTIN_GEN[name];
		return gen ? gen(this, expr) : undefined;
	},

	// The source operand of `append(b, x...)` / `copy(b, x)`: a string
	// contributes its UTF-8 bytes.
	_genSliceSource(node) {
		const js = this.genExpr(node);
		if (!this._isStringExprType(node._type)) return js;
		this.useHelper("u8enc");
		return `__u8enc(${js})`;
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
			return `new ${jsClassName(retType.name)}(__append(${sliceJS}, ${elems.join(", ")}))`;
		}
		const slice = this.genExpr(expr.args[0]);
		// Spread elements of array type are values: append copies them.
		const st = expr._type ?? expr.args[0]._type;
		const elemT = (st?.kind === "named" ? st.underlying : st)?.elem;
		const spreadOf = (a) =>
			this._aggregateBase(elemT)
				? `...(${this.genExpr(a)} ?? []).map((__e) => ${this._cloneJs(elemT, "__e")})`
				: `...(${this._genSliceSource(a)} ?? [])`;
		const is64Elem = this._is64BitInt(elemT);
		const elems = expr.args.slice(1).map((a) => {
			if (a._spread) return spreadOf(a);
			const val = this.genValueExpr(a);
			if (
				is64Elem &&
				a._type?.kind === "untyped" &&
				!val.endsWith("n") &&
				/^-?\d+$/.test(val)
			) {
				return `${val}n`;
			}
			return val;
		});
		if (elems.length === 0) return slice;
		this.useHelper("append");
		const sliceType = expr._type ?? expr.args[0]._type;
		const typedCtor = isTypedArraySlice(sliceType)
			? typedArrayConstructorForElem(
					(sliceType.kind === "named" ? sliceType.underlying : sliceType).elem,
				)
			: null;
		if (typedCtor) {
			const single = expr.args.length === 2 && expr.args[1]._spread;
			// One source slice or string: append it as it is, not spread.
			if (single)
				return `__appendv((${slice}) ?? __tn(${typedCtor}), ${this._genSliceSource(expr.args[1])} ?? [])`;
			return `__append((${slice}) ?? __tn(${typedCtor}), ${elems.join(", ")})`;
		}
		// A json codec grows a slice it has just made and no one else holds:
		// pushing in place is O(1), where __append copies the whole slice.
		if (
			this._inJsonCodecFile() &&
			expr.args.length === 2 &&
			expr.args[0].kind === "Ident" &&
			!expr.args[1]._spread
		) {
			this.useHelper("pushs");
			return `__pushs(${slice}, ${elems[0]})`;
		}
		return `__append(${slice}, ${elems.join(", ")})`;
	},

	// A `make` length or capacity expression wrapped in its negative-value
	// check (a literal needs none).
	_guardMakeSize(code, guard) {
		if (/^\d+$/.test(code)) return code;
		this.useHelper("mklen");
		return `${guard}(${code})`;
	},

	genMake(expr) {
		// make([]T, n) or make([]T, n, cap) → new Array(n).fill(zero)
		// make(map[K]V) → {}
		const typeArg = expr.args[0];
		const typeNode = typeArg.kind === "TypeExpr" ? typeArg.type : typeArg;
		// A defined type (`type S []int`) makes like its underlying type.
		const madeType =
			typeArg._coreType ??
			(typeArg._type?.kind === "named"
				? typeArg._type.underlying
				: typeArg._type);
		const resolvedKind = madeType?.kind;
		if (typeNode.kind === "SliceType" || resolvedKind === "slice") {
			let n = expr.args[1] ? this.genExpr(expr.args[1]) : "0";
			if (expr.args[1]) n = this._asIndexNumber(n, expr.args[1]._type);
			// A negative length or capacity panics with Go's message.
			n = this._guardMakeSize(n, "__mkn");
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
			let capArg = expr.args[2] ? this.genExpr(expr.args[2]) : null;
			if (capArg && expr.args[2])
				capArg = this._asIndexNumber(capArg, expr.args[2]._type);
			if (capArg) {
				this.useHelper("slice");
				capArg = this._guardMakeSize(capArg, "__mkc");
			}
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
		// map or fallback.  The json codecs' maps hold decoded keys, among them
		// "__proto__": without a prototype that is an ordinary key.
		if (
			this._inJsonCodecFile() &&
			(resolvedKind === "map" || typeNode.kind === "MapType")
		)
			return "Object.create(null)";
		return "{}";
	},

	_inJsonCodecFile() {
		return this._jsonCodecFileIdx === (this._currentSrcFileIdx ?? 0);
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
				`(${valExpr} != null ? ${valExpr}.${jsMemberName(ef)} : ${fields[idx].zero})`;
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
			return `new ${jsClassName(typeName)}()`;
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
				? `new ${jsClassName(typeName)}()`
				: `new ${jsClassName(typeName)}(${values.slice(0, maxExplicitIdx + 1).join(", ")})`;
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
		const lt = expr._type?.kind === "pointer" ? expr._type.base : expr._type;
		const st = lt?.kind === "named" ? lt.underlying : lt;
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
				`${jsMemberName(name)}: ${values.get(name) ?? this.zeroValueForType(ft)}`,
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
		// An elided anonymous struct (`[]struct{ A [2]int }{{}}`) has every field.
		const litBase = lit?.kind === "named" ? lit.underlying : lit;
		if (litBase?.kind === "struct") return this._genAnonStructLit(expr);
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
		if (isComplex(expr._type) || expr._asComplex) return this.genExpr(expr);
		return `{ re: ${this.genExpr(expr)}, im: 0 }`;
	},

	getTypeName(typeNode) {
		if (!typeNode) return null;
		if (typeNode._stdName) return typeNode._stdName;
		if (typeNode.kind === "TypeName")
			return this._aliasTarget(this._dequalify(typeNode.name));
		if (typeNode.kind === "GenericTypeName") return typeNode.name;
		if (typeNode.kind === "Ident") return this._aliasTarget(typeNode.name);
		if (typeNode.kind === "InstantiationExpr")
			return this.getTypeName(typeNode.expr);
		if (typeNode.kind === "SelectorExpr") {
			const base = this.getTypeName(typeNode.expr);
			if (this.bundledPackages.has(base)) {
				// `p.A` for `type A = Base` in p: no class is emitted for A.
				const t = this.checker?.types.get(`${base}.${typeNode.field}`);
				return t?.kind === "named" && t.name && !t.name.includes("$$")
					? t.name
					: typeNode.field;
			}
			return `${base}.${typeNode.field}`;
		}
		return null;
	},

	// `type A = Base`: no class is emitted for A, so it names Base's.
	_aliasTarget(name) {
		const t = this.checker?.types.get(name);
		return t?.kind === "named" &&
			t.name &&
			t.name !== name &&
			!name.includes(".")
			? t.name
			: name;
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
	// zero value is a mutable struct object, which is its own pointer when
	// erased; maps are empty or frozen, and complex numbers are frozen).
	_typeParamIsStructJs(name) {
		const f = this._typeParamZeroFactory(name);
		return f
			? `((__z) => __z !== null && typeof __z === "object" && !Array.isArray(__z) && !ArrayBuffer.isView(__z) && !Object.isFrozen(__z) && (Object.getPrototypeOf(Object.getPrototypeOf(__z)) !== null || Object.keys(__z).length > 0))(${f}())`
			: "false";
	},

	// JS condition: type parameter `name` was instantiated with an array (its
	// zero value is a mutable array or typed array; a slice's zero is null,
	// and SIMD vectors are frozen arrays).  A pointer to it is a `{ value }`
	// box around the array.
	_typeParamIsArrayJs(name) {
		const f = this._typeParamZeroFactory(name);
		return f
			? `((__z) => (Array.isArray(__z) && !Object.isFrozen(__z)) || ArrayBuffer.isView(__z))(${f}())`
			: "false";
	},

	// The zero-value factory bound to type parameter `name` in the code being
	// emitted (`$z_T`), or null outside a generic body.
	_typeParamZeroFactory(name) {
		return this._typeParamZeros?.get(name) ?? null;
	},

	// Runs `fn` with type parameters `names` bound to the factories `$z_<name>`.
	_withoutNatives(fn) {
		const saved = this.natives;
		this.natives = false;
		try {
			return fn();
		} finally {
			this.natives = saved;
		}
	},

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
		if (this._is64BitUnsigned(t)) return "__zu64";
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
	// `new(T)` for a type parameter: erased, a struct instantiation is its own
	// pointer.
	_newOfTypeParam(base, arg) {
		const zero = this.zeroValueForExpr(
			arg.kind === "TypeExpr" ? arg.type : arg,
		);
		return `((__v) => (${this._typeParamIsStructJs(base.name)} ? __v : { value: __v }))(${zero})`;
	},

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
		return `new ${jsClassName(cls)}(${vals.join(", ")})`;
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
		// An alias of an anonymous struct resolves to the struct type itself.
		if (named?.kind === "struct") return this.zeroValueForType(named);
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
			if (this.structNames.has(clsName)) return `new ${jsClassName(clsName)}()`;
		}
		name = this._dequalify(name);
		if (this.structNames.has(name)) return `new ${jsClassName(name)}()`;
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
							`${f.names.map((n) => `${jsMemberName(n)}: ${this.zeroValueForTypeNode(f.type)}`).join(", ")}`,
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
					.map(
						([name, ft]) =>
							`${jsMemberName(name)}: ${this.zeroValueForType(ft)}`,
					)
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
		const dynamic = this._dynTypeCheck(typeNode, val);
		if (dynamic) return dynamic;
		const extended = this._namedOrIfaceCheckExpr(typeNode, val);
		if (extended) return extended;
		if (
			typeNode.kind === "PointerType" &&
			typeNode.base?.kind === "TypeName" &&
			this.structNames.has(this._qualifiedStructName(typeNode.base.name))
		) {
			const name = this._qualifiedStructName(typeNode.base.name);
			return `(${val} instanceof ${jsClassName(name)} && ${val}.__v !== true)`;
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
			? `${val} instanceof ${jsClassName(cls)} && ${val}.__v !== true`
			: `${val} instanceof ${jsClassName(cls)} && ${val}.__p !== true`;
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
			case "-":
			case "*":
			case "/":
				return this._genComplexArith(expr.op, l, r, isComplex64(expr._type));
			case "==":
				return this._genComplexEquality("===", "&&", l, r);
			case "!=":
				return this._genComplexEquality("!==", "||", l, r);
		}
	},

	// `l == r` / `l != r` on complex operands: each component reads both
	// operands, so an operand that calls a function is bound once first.
	_genComplexEquality(cmp, join, l, r) {
		const pure = (js) => !js.includes("(");
		if (pure(l) && pure(r))
			return `(${l}.re ${cmp} ${r}.re ${join} ${l}.im ${cmp} ${r}.im)`;
		return `((__a, __b) => __a.re ${cmp} __b.re ${join} __a.im ${cmp} __b.im)(${l}, ${r})`;
	},

	// `l op r` for complex operands.  A complex64 result has float32
	// components, as in Go (where the arithmetic runs in float64 and the
	// result is narrowed).
	_genComplexArith(op, l, r, is64) {
		let re;
		let im;
		let call = null;
		if (op === "+" || op === "-") {
			re = `${l}.re ${op} ${r}.re`;
			im = `${l}.im ${op} ${r}.im`;
		} else {
			const helper = op === "*" ? "cmul" : "cdiv";
			this.useHelper(helper);
			call = `__${helper}(${l}, ${r})`;
		}
		if (!is64) return call ?? `{ re: ${re}, im: ${im} }`;
		if (call)
			return `((__z) => ({ re: Math.fround(__z.re), im: Math.fround(__z.im) }))(${call})`;
		return `{ re: Math.fround(${re}), im: Math.fround(${im}) }`;
	},

	_genBinaryExpr(expr) {
		// An interface operand decides the comparison, also next to a complex
		// one: it is not complex arithmetic.
		if (this._isIfaceEquality(expr)) return this._genIfaceEquality(expr);

		if (
			isComplex(expr._type) ||
			isComplex(expr.left._type) ||
			isComplex(expr.right._type)
		)
			return this._genComplexBinary(expr);

		const simdEq = this._genSimdEquality(expr);
		if (simdEq !== null) return simdEq;

		const nilMap = this._genNilMapCompare(expr);
		if (nilMap) return nilMap;

		const anyNil = this._genAnyNilCompare(expr);
		if (anyNil) return anyNil;

		const tpEq = this._genTypeParamEquality(expr);
		if (tpEq) return tpEq;

		if (this._isStructEquality(expr)) {
			this.useHelper("equal");
			const cmp = `__equal(${this.genExpr(expr.left)}, ${this.genExpr(expr.right)})`;
			return expr.op === "==" ? cmp : `!${cmp}`;
		}

		const ptrCmp = this._genPointerEquality(expr);
		if (ptrCmp !== null) return ptrCmp;

		if (this._is64BitInt(expr._type)) return this._gen64BitBinaryExpr(expr);

		if (
			(this.strict || this._isFloat32(expr._type)) &&
			this._needsStrictOp(expr.op, expr._type)
		) {
			const l = this.genExpr(expr.left);
			const r = this.genExpr(expr.right);
			return this._genStrictBinary(
				expr.op,
				l,
				r,
				expr._type,
				expr.right._type,
				this._hasCallExpr(expr.left) || this._hasCallExpr(expr.right),
			);
		}

		return this._genStandardBinaryExpr(expr);
	},

	_gen64BitBinaryExpr(expr) {
		let l = this.genExpr(expr.left);
		let r = this.genExpr(expr.right);
		// An untyped operand is a literal (`3` -> `3n`) or a named constant,
		// which holds a Number.
		const lit = (js) => (/^-?\d+$/.test(js) ? `${js}n` : `BigInt(${js})`);
		if (expr.left._type?.kind === "untyped" && !l.endsWith("n")) l = lit(l);
		else if (!this._is64BitInt(expr.left?._type)) l = `BigInt(${l})`;
		if (expr.right._type?.kind === "untyped" && !r.endsWith("n")) r = lit(r);
		else if (!this._is64BitInt(expr.right?._type)) r = `BigInt(${r})`;
		return this._gen64BitBinary(expr.op, l, r, expr._type);
	},

	_tconvBinaryOperands(expr, l, r) {
		// A shift's operand never takes the type of its count.
		if (expr.op === "<<" || expr.op === ">>") return [l, r];
		if (
			expr.left._type?.kind === "typeParam" &&
			expr.right._type?.kind === "untyped"
		) {
			const factory = this._typeParamZeroFactory(expr.left._type.name);
			if (factory) {
				this.useHelper("generics");
				r = `__tconv(${factory}, ${r})`;
			}
		} else if (
			expr.right._type?.kind === "typeParam" &&
			expr.left._type?.kind === "untyped"
		) {
			const factory = this._typeParamZeroFactory(expr.right._type.name);
			if (factory) {
				this.useHelper("generics");
				l = `__tconv(${factory}, ${l})`;
			}
		}
		return [l, r];
	},

	_coerceUntyped64(expr, l, r, isLeft64, isRight64) {
		if (expr.op === "<<" || expr.op === ">>") return [l, r];
		if (isLeft64 && expr.right?._type?.kind === "untyped") {
			if (!r.endsWith("n") && /^-?\d+$/.test(r)) return [l, `${r}n`];
		} else if (isRight64 && expr.left?._type?.kind === "untyped") {
			if (!l.endsWith("n") && /^-?\d+$/.test(l)) return [`${l}n`, r];
		}
		return [l, r];
	},

	_coerceMixed64(expr, l, r, isLeft64, isRight64) {
		const isShift = expr.op === "<<" || expr.op === ">>";
		if (isLeft64 && !isRight64 && !isShift) r = `BigInt(${r})`;
		else if (isRight64 && !isLeft64 && !isShift) l = `BigInt(${l})`;
		if (isShift) r = this._looseShiftCount(r, expr.right?._type);
		return [l, r];
	},

	_wrapBinaryResult(expr, res, isLeft64, isRight64) {
		const isCmp =
			expr.op === "==" ||
			expr.op === "!=" ||
			expr.op === "<" ||
			expr.op === "<=" ||
			expr.op === ">" ||
			expr.op === ">=";
		return (isLeft64 || isRight64) && !isCmp ? `Number(${res})` : res;
	},

	_genStandardBinaryExpr(expr) {
		const jsOp = this._emittedBinaryOp(expr) ?? "/";
		const operand = (child, isRight) =>
			wrapForJsOp(
				this.genExpr(child),
				this._emittedBinaryOp(child),
				jsOp,
				isRight,
			);
		let [l, r] = this._tconvBinaryOperands(
			expr,
			operand(expr.left, false),
			operand(expr.right, true),
		);
		const isLeft64 = this._is64BitInt(expr.left?._type);
		const isRight64 = this._is64BitInt(expr.right?._type);
		[l, r] = this._coerceUntyped64(expr, l, r, isLeft64, isRight64);
		[l, r] = this._coerceMixed64(expr, l, r, isLeft64, isRight64);

		if (expr.op === "&^") {
			const rCode = this.genExpr(expr.right);
			const rP =
				this._emittedBinaryOp(expr.right) !== null ? `(${rCode})` : rCode;
			return this._wrapBinaryResult(expr, `${l} & ~${rP}`, isLeft64, isRight64);
		}
		if (this._isIntDivision(expr)) return `Math.trunc(${l} / ${r})`;
		return this._wrapBinaryResult(
			expr,
			`${l} ${jsOp} ${r}`,
			isLeft64,
			isRight64,
		);
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
		return t?.kind === "map" || other._coreType?.kind === "map" ? other : null;
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

	_genIfaceEquality(expr) {
		this.useHelper("ifeq");
		const cmp = `__ifeq(${this._genIfaceOperand(expr.left)}, ${this._genIfaceOperand(expr.right)})`;
		return expr.op === "==" ? cmp : `!${cmp}`;
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
			((this.isIntType(expr.left._type) && this.isIntType(expr.right._type)) ||
				// `x / 2.0` types as int when x is an integer.
				this.isIntType(expr._type))
		);
	},

	// The `any` operand of `x == nil` / `x != nil` (JS documents a nil slice
	// stored in an `any` as equal to nil, though it keeps a type tag), or null.
	_anyNilOperand(expr) {
		if (expr.op !== "==" && expr.op !== "!=") return null;
		const operand = this._isNilLiteral(expr.right)
			? expr.left
			: this._isNilLiteral(expr.left)
				? expr.right
				: null;
		return operand && this._isIfaceType(operand._type) ? operand : null;
	},

	_genAnyNilCompare(expr) {
		const operand = this._anyNilOperand(expr);
		if (!operand) return null;
		const test = `((__a) => __a == null || __a.__nils === true)(${this.genExpr(operand)})`;
		return expr.op === "==" ? test : `!${test}`;
	},

	_isNilLiteral(expr) {
		return expr.kind === "BasicLit" && expr.litKind === "NIL";
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
		if (this._anyNilOperand(expr)) return null;
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

	_genTypeConversion(expr, preInner = null) {
		const inner = preInner ?? this.genExpr(expr.expr);
		const t = expr.targetType;
		const viaParam = this._genTypeParamConversion(t?.name, inner);
		if (viaParam) return viaParam;
		if (t?.name === "complex128" || t?.name === "complex64") {
			return isComplex(expr.expr._type) ? inner : `{ re: ${inner}, im: 0 }`;
		}
		if (t?.kind === "StructType")
			return (
				this._genAnonStructConversion(expr._type, inner) ??
				this._cloneJs(expr._type, inner)
			);
		if (t?.kind === "ArrayType")
			return this._genArrayTypeConversion(expr, inner, t);
		if (t?.kind === "SliceType")
			return this._genSliceTypeConversion(expr, inner, t);
		// `map[K]V(nil)` is a nil map value, which stays distinct from the nil
		// interface once boxed in an `any`.
		if (t?.kind === "MapType" && this._isNilLiteral(expr.expr))
			return this._nilMapZero();
		const target = t?.name;
		const structConv = this._genStructClassConversion(
			target,
			expr.expr._type,
			inner,
			expr._type,
		);
		if (structConv) return structConv;
		if (target === "error") {
			// A boxed named value that implements error is already an error.
			if (this._isNamedBoxKind(expr.expr)) return inner;
			if (!this._isStringExprType(expr.expr._type)) return inner;
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
		// A slice (or a type parameter with a slice term, which may also have
		// array terms of the target's length) is copied by its first `size`
		// elements (a shorter slice panics); struct and array elements are
		// deep copies, so the result shares no storage with the source.
		const kinds = this._convSourceKinds(expr.expr);
		const fromParamSlice =
			kinds &&
			[...kinds].some((k) => k === "bytes" || k === "runes" || k === "slice");
		if (srcResolved?.kind === "slice" || fromParamSlice) {
			const size = t.size?.value !== undefined ? Number(t.size.value) : t.size;
			const target = this._aggregateBase(expr._type) ?? this._typeFromNode(t);
			const elemClone = this._cloneJs(target?.elem, "__e");
			this.useHelper("s2a");
			const head = `__s2a(${inner}, ${size})`;
			return elemClone === "__e" ? head : `${head}.map((__e) => ${elemClone})`;
		}
		// Array-to-array conversion yields a new array value.
		return this._cloneJs(expr.expr._type, inner);
	},

	_genSliceTypeConversion(expr, inner, t) {
		// `[]T(nil)` is the nil slice, not a copy of anything.
		if (this._isNilLiteral(expr.expr)) return "null";
		const elemType =
			t.elem?.kind === "TypeName"
				? (this.checker?.types.get(t.elem.name) ?? t.elem)
				: t.elem;
		const elem = this._underlyingOf(elemType)?.name;
		const typedCtor = typedArrayConstructorForElem(
			t.elem ? { kind: "basic", name: t.elem.name } : null,
		);
		// A slice-to-slice conversion (including from a type parameter whose
		// terms are all slices) shares the backing array and keeps a nil slice
		// nil; only a string or dynamic source builds a new slice.
		const kinds = this._convSourceKinds(expr.expr);
		if (
			this._underlyingOf(expr.expr._type)?.kind === "slice" ||
			(kinds && !kinds.has("string"))
		)
			return inner;
		if (kinds || this._isStringExprType(expr.expr._type)) {
			const enc = (s) => this._sliceFromStringJs(elem, typedCtor, s);
			// A type parameter with string and slice terms: decided by the
			// type argument at run time.
			return kinds?.size > 1
				? `((__s) => typeof __s === "string" ? ${enc("__s")} : __s)(${inner})`
				: enc(inner);
		}
		if (elem === "byte" || elem === "uint8") {
			if (isAny(expr.expr._type) || !expr.expr._type) {
				this.useHelper("u8enc");
				return `(typeof ${inner} === "string" ? __u8enc(${inner}) : new Uint8Array(${inner}))`;
			}
			return `new Uint8Array(${inner})`;
		}
		if (typedCtor) return `new ${typedCtor}(${inner})`;
		return `Array.from(${inner})`;
	},

	// `[]E(s)` of the string `s`: its UTF-8 bytes, or its code points.
	_sliceFromStringJs(elem, typedCtor, s) {
		if (elem === "byte" || elem === "uint8") {
			this.useHelper("u8enc");
			return `__u8enc(${s})`;
		}
		if (typedCtor) return `${typedCtor}.from(${s}, __c => __c.codePointAt(0))`;
		if (elem === "rune" || elem === "int32" || elem === "int")
			return `Array.from(${s}, __c => __c.codePointAt(0))`;
		return `Array.from(${s})`;
	},

	// What a conversion operand of type-parameter type can hold at run time,
	// one entry per kind of term in its type set (`string`, `bytes`, `runes`,
	// `slice`, `int`, `other`); null for any other operand.
	_convSourceKinds(node) {
		const terms = node?._convTerms;
		if (!terms) return null;
		const kinds = new Set();
		for (const u of terms) {
			if (u?.kind === "slice") {
				const e = this._underlyingOf(u.elem)?.name;
				kinds.add(
					e === "byte" || e === "uint8"
						? "bytes"
						: e === "rune" || e === "int32"
							? "runes"
							: "slice",
				);
			} else if (u?.kind === "basic" && u.name === "string")
				kinds.add("string");
			else if (u?.kind === "basic" && this.isIntType(u)) kinds.add("int");
			else kinds.add("other");
		}
		return kinds;
	},

	// `string(s)` with `s` of a type parameter: the conversion of each kind
	// of term, chosen by the type argument at run time when there are several
	// (a nil slice is the empty string).
	_genTypeParamStringConversion(kinds, inner) {
		const convs = [
			["string", (v) => `typeof ${v} === "string"`, (v) => v],
			[
				"int",
				(v) => `typeof ${v} === "number" || typeof ${v} === "bigint"`,
				(v) => {
					this.useHelper("runestr");
					return `__rstr(Number(${v}))`;
				},
			],
			[
				"bytes",
				(v) => `${v} instanceof Uint8Array`,
				(v) => {
					this.useHelper("u8dec");
					return `__u8dec(${v})`;
				},
			],
			[
				"runes",
				null,
				(v) => {
					this.useHelper("runestr");
					return `Array.from(${v} ?? [], c => __rstr(c)).join("")`;
				},
			],
		].filter(([k]) => kinds.has(k));
		if (convs.length !== kinds.size) return `String(${inner})`;
		if (convs.length === 1) return convs[0][2](inner);
		const last = convs.pop();
		const tests = convs.map(
			([, test, conv]) => `${test("__s")} ? ${conv("__s")} : `,
		);
		return `((__s) => ${tests.join("")}${last[2]("__s")})(${inner})`;
	},

	_genStringConversion(srcType, inner, kinds = null) {
		if (kinds) return this._genTypeParamStringConversion(kinds, inner);
		const base = srcType?.kind === "named" ? srcType.underlying : srcType;
		if (base && this.isIntType(base)) {
			this.useHelper("runestr");
			return `__rstr(${inner})`;
		}
		if (base?.kind === "slice") {
			const elem = this._underlyingOf(base.elem)?.name;
			if (elem === "byte" || elem === "uint8") {
				this.useHelper("u8dec");
				return `__u8dec(${inner})`;
			}
			if (elem === "rune" || elem === "int" || elem === "int32") {
				this.useHelper("runestr");
				return `Array.from(${inner} ?? [], c => __rstr(c)).join("")`;
			}
		}
		return `String(${inner})`;
	},

	_genPrimitiveConversion(expr, inner, target) {
		const srcType = expr.expr?._type;
		const isSrc64 = this._is64BitInt(srcType);
		switch (target) {
			case "string":
				return this._genStringConversion(
					srcType,
					isSrc64 ? `Number(${inner})` : inner,
					this._convSourceKinds(expr.expr),
				);
			case "int64": {
				this.useHelper("to64");
				return `__to_i64(${inner})`;
			}
			case "uint64": {
				this.useHelper("to64");
				return `__to_u64(${inner})`;
			}
			case "int":
			case "uint":
			case "uintptr":
				return isSrc64 ? `Number(${inner})` : `Math.trunc(Number(${inner}))`;
			case "int8":
				return isSrc64
					? `Number(BigInt.asIntN(8, ${inner}))`
					: `(Number(${inner}) << 24 >> 24)`;
			case "int16":
				return isSrc64
					? `Number(BigInt.asIntN(16, ${inner}))`
					: `(Number(${inner}) << 16 >> 16)`;
			case "int32":
			case "rune":
				return isSrc64
					? `Number(BigInt.asIntN(32, ${inner}))`
					: `(Number(${inner}) | 0)`;
			case "uint8":
			case "byte":
				return isSrc64
					? `Number(BigInt.asUintN(8, ${inner}))`
					: `(Number(${inner}) & 0xFF)`;
			case "uint16":
				return isSrc64
					? `Number(BigInt.asUintN(16, ${inner}))`
					: `(Number(${inner}) & 0xFFFF)`;
			case "uint32":
				return isSrc64
					? `Number(BigInt.asUintN(32, ${inner}))`
					: `(Number(${inner}) >>> 0)`;
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

	_is64BitInt(t) {
		return is64BitInt(t);
	},

	// Whether a value of type `t` can be a BigInt at run time: a 64-bit
	// integer, or a type parameter whose type set holds one (`~int | ~int64`).
	_mayBeBigInt(t) {
		if (t?.kind !== "typeParam") return is64BitInt(t);
		const terms = this.checker?._constraintTerms(t.constraint, new Set());
		return terms?.some(is64BitInt) === true;
	},

	// `code` as a JS number for an index, slice bound or `make` size.
	_asIndexNumber(code, t) {
		return this._mayBeBigInt(t) ? `Number(${code})` : code;
	},

	// float32 arithmetic rounds through Math.fround and arithmetic on a type
	// parameter wraps for the instantiated type (`__tar`) in every package kind.
	_isFloat32(t) {
		return (
			this._typeName(t) === "float32" ||
			(t?.kind === "typeParam" && this._typeParamZeroFactory(t.name) != null)
		);
	},

	_is64BitUnsigned(t) {
		return is64BitUnsigned(t);
	},

	_gen64BitBinary(op, l, r, type) {
		const unsigned = this._is64BitUnsigned(type);
		const wrap = unsigned ? "BigInt.asUintN" : "BigInt.asIntN";
		const divZero =
			'(() => { throw new Error("runtime error: integer divide by zero"); })()';
		if (op === "/" || op === "%") {
			// The divisor is read twice (zero check, division): bind both
			// operands once, left first, unless they are plain names or literals.
			const simple = /^[A-Za-z_$][\w$.]*$|^-?\d+n$/;
			if ((simple.test(l) && simple.test(r)) || /\b(await|yield)\b/.test(l + r))
				return `((${r}) === 0n ? ${divZero} : ${wrap}(64, (${l}) ${op} (${r})))`;
			return `((__a, __b) => __b === 0n ? ${divZero} : ${wrap}(64, __a ${op} __b))(${l}, ${r})`;
		}
		if (op === "<<" || op === ">>") {
			this.useHelper("shift");
			return op === "<<"
				? `__shl64(${l}, ${r}, ${unsigned})`
				: `__shr64(${l}, ${r}, ${unsigned})`;
		}
		if (op === "&^") return `${wrap}(64, (${l}) & ~(${r}))`;
		return `${wrap}(64, (${l}) ${op} (${r}))`;
	},

	// `uint` / `uintptr`: 64-bit unsigned values held as JS numbers.
	_isUintWord(type) {
		const name = this._typeName(type);
		return name === "uint" || name === "uintptr";
	},

	_needsStrictOp(op, type) {
		if (type?.kind === "typeParam")
			return (
				STRICT_OPS.has(op) && this._typeParamZeroFactory(type.name) != null
			);
		if (this._is64BitInt(type))
			return STRICT_OPS.has(op) || op === "<<" || op === ">>" || op === "&^";
		if (!STRICT_OPS.has(op)) return false;
		if (this._isStrictAtomicOp(op, this._typeName(type))) return true;
		if (op === "-" && this._isUintWord(type)) return true;
		if (op === "<<" || op === ">>")
			return WIDE_INT_NAMES.has(this._typeName(type));
		return this.isIntType(type) && (op === "/" || op === "%");
	},

	// Emits `lhs = strict(lhs op rhs)` for any lvalue shape; returns false when not applicable.
	// Indexed / nested targets are split into object + key temps so sub-expressions run once.
	_genStrictCompound(
		lhsNode,
		op,
		rhsJs,
		srcLine = null,
		lhsJs = null,
		countType = null,
		rhsNode = null,
	) {
		const type = lhsNode._type;
		if (!this._needsStrictOp(op, type)) return false;
		// A call on the right runs once, after the target's operands and before
		// the read of the target: only the right operand is bound, and the
		// template reads the target once the call has returned.
		const bind =
			this._hasCallExpr(rhsNode) && this._strictNeedsBinding(op, type);
		const compute = (target) =>
			bind
				? `((__b) => ${this._genStrictBinary(op, target, "__b", type, countType)})(${rhsJs})`
				: this._genStrictBinary(op, target, rhsJs, type, countType);
		if (lhsNode.kind === "IndexExpr" && lhsNode.expr?._type?.kind === "map")
			return false;
		const l = lhsJs ?? this._genAssignLhsExpr(lhsNode);
		if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(l)) {
			this.line(`${l} = ${compute(l)};`, srcLine);
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
				`{ const ${o} = ${split.obj}, ${k} = ${split.key}; ${target} = ${compute(target)}; }`,
				srcLine,
			);
		} else {
			const target = `${o}.${split.prop}`;
			this.line(
				`{ const ${o} = ${split.obj}; ${target} = ${compute(target)}; }`,
				srcLine,
			);
		}
		return true;
	},

	// A non-constant shift count as a JS number: a 64-bit count, or a type
	// parameter whose type set holds one, arrives as BigInt.
	_shiftCountNumber(r, countType) {
		return this._mayBeBigInt(countType) ? `Number(${r})` : r;
	},

	// A non-constant signed shift count (a signed integer, or a type parameter
	// whose type set holds one) is checked for a negative value (Go panics).
	// `r` is already a JS number (`_shiftCountNumber`).
	_guardShiftCount(r, countType) {
		if (!countType || countType.kind === "untyped") return r;
		const terms =
			countType.kind === "typeParam"
				? this.checker?._constraintTerms(countType.constraint, new Set())
				: [countType];
		if (!terms?.some((t) => this._isSignedName(this._typeName(t)))) return r;
		this.useHelper("shift");
		return `__shc(${r})`;
	},

	_isSignedName(name) {
		return !!name && !name.startsWith("u");
	},

	// The count of a shift emitted as the plain JS operator (`<<`, `<<=`): a
	// number, and checked for a negative value when it is a type parameter.
	_looseShiftCount(r, countType) {
		const n = this._shiftCountNumber(r, countType);
		return countType?.kind === "typeParam"
			? this._guardShiftCount(n, countType)
			: n;
	},

	// `/`, `%`, `<<` and `>>` on a narrow integer paste an operand into the
	// zero check or width check as well as the operation, and a shift skips
	// its left operand when the count is out of range.  The other forms
	// (`__shl64`, `Math.fround`, `__tar`, the BigInt path) use each operand once.
	_strictNeedsBinding(op, type) {
		if (op !== "/" && op !== "%" && op !== "<<" && op !== ">>") return false;
		if (type?.kind === "typeParam" || this._is64BitInt(type)) return false;
		const name = this._typeName(type);
		if (name === "float32") return false;
		if (op === "<<" || op === ">>") return NARROW_SHIFT_NAMES.has(name);
		return this.isIntType(type);
	},

	// `bind`: an operand contains a call, so both are evaluated once, left
	// first, as arguments of an arrow function that holds the template.
	_genStrictBinary(op, l, r, type, countType = null, bind = false) {
		if (bind && this._strictNeedsBinding(op, type)) {
			const body = this._genStrictBinary(op, "__a", "__b", type, countType);
			return `((__a, __b) => ${body})(${l}, ${r})`;
		}
		if (type?.kind === "typeParam") {
			this.useHelper("generics");
			return `__tar(${this._typeParamZeroFactory(type.name)}, "${op}", ${l}, ${r})`;
		}
		if (this._is64BitInt(type)) {
			return this._gen64BitBinary(op, l, r, type);
		}
		const tName = this._typeName(type);
		const isShift = op === "<<" || op === ">>";
		if (isShift) r = this._shiftCountNumber(r, countType);
		const rc = isShift ? this._guardShiftCount(r, countType) : r;
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
				return `(((${rc}) >= 32 ? ${ovf} : ((${l}) ${jsOp} (${r}))) ${cast})`;
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
				return `((${rc}) >= ${bits} ? (${op === ">>" ? `((${l}) < 0 ? -1 : 0)` : "0"}) : (((${l}) ${op} (${r})) << ${sh} >> ${sh}))`;
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
				return `((${rc}) >= ${bits} ? 0 : (((${l}) ${jsOp} (${r})) & ${mask}))`;
			}
			if (op === "&^") return `(((${l}) & ~(${r})) & ${mask})`;
			return `((${l} ${op} ${r}) & ${mask})`;
		}
		if (op === "-" && this._isUintWord(type))
			return `((__d) => __d < 0 ? __d + 2 ** 64 : __d)((${l}) - (${r}))`;
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
