// Compile-time folding of package-level constant expressions for the wasm
// backend.  Folds literals, other already-folded constants, unary/binary
// operators and `len("literal")` into a single BasicLit.  Anything it cannot
// reduce returns null and the caller falls back to a runtime-initialised
// global (see `_collectPackageConsts`).

const INT = "INT";
const FLOAT = "FLOAT";
const STRING = "STRING";
const BOOL = "BOOL";

function fromLit(lit) {
	switch (lit.litKind) {
		case INT:
			return { k: INT, v: BigInt(lit.value) };
		case FLOAT: {
			const n = Number(lit.value);
			return Number.isFinite(n) ? { k: FLOAT, v: n } : null;
		}
		case STRING:
			return { k: STRING, v: String(lit.value ?? "") };
		case BOOL:
			return { k: BOOL, v: lit.value === "true" };
		default:
			return null;
	}
}

function toLit(val) {
	switch (val.k) {
		case INT:
			return { kind: "BasicLit", litKind: INT, value: val.v.toString() };
		case FLOAT:
			return { kind: "BasicLit", litKind: FLOAT, value: String(val.v) };
		case STRING:
			return { kind: "BasicLit", litKind: STRING, value: val.v };
		default:
			return {
				kind: "BasicLit",
				litKind: BOOL,
				value: val.v ? "true" : "false",
			};
	}
}

function asFloat(val) {
	return val.k === INT ? Number(val.v) : val.v;
}

function foldUnary(op, x) {
	if (op === "-" && x.k === INT) return { k: INT, v: -x.v };
	if (op === "-" && x.k === FLOAT) return { k: FLOAT, v: -x.v };
	if (op === "+" && (x.k === INT || x.k === FLOAT)) return x;
	if (op === "!" && x.k === BOOL) return { k: BOOL, v: !x.v };
	if (op === "^" && x.k === INT) return { k: INT, v: ~x.v };
	return null;
}

function compare(op, a, b) {
	switch (op) {
		case "==":
			return a === b;
		case "!=":
			return a !== b;
		case "<":
			return a < b;
		case "<=":
			return a <= b;
		case ">":
			return a > b;
		case ">=":
			return a >= b;
		default:
			return null;
	}
}

function foldInts(op, a, b) {
	switch (op) {
		case "+":
			return { k: INT, v: a + b };
		case "-":
			return { k: INT, v: a - b };
		case "*":
			return { k: INT, v: a * b };
		case "/":
			if (b === 0n) throw new Error("division by zero");
			return { k: INT, v: a / b };
		case "%":
			if (b === 0n) throw new Error("division by zero");
			return { k: INT, v: a % b };
		case "&":
			return { k: INT, v: a & b };
		case "|":
			return { k: INT, v: a | b };
		case "^":
			return { k: INT, v: a ^ b };
		case "&^":
			return { k: INT, v: a & ~b };
		case "<<":
			if (b < 0n) throw new Error("negative shift count");
			return b > 1024n ? null : { k: INT, v: a << b };
		case ">>":
			if (b < 0n) throw new Error("negative shift count");
			return b > 1024n ? null : { k: INT, v: a >> b };
		default: {
			const r = compare(op, a, b);
			return r === null ? null : { k: BOOL, v: r };
		}
	}
}

function foldFloats(op, a, b) {
	let v;
	switch (op) {
		case "+":
			v = a + b;
			break;
		case "-":
			v = a - b;
			break;
		case "*":
			v = a * b;
			break;
		case "/":
			if (b === 0) throw new Error("division by zero");
			v = a / b;
			break;
		default: {
			const r = compare(op, a, b);
			return r === null ? null : { k: BOOL, v: r };
		}
	}
	return Number.isFinite(v) ? { k: FLOAT, v } : null;
}

function foldBinary(op, a, b) {
	if (a.k === BOOL && b.k === BOOL) {
		if (op === "&&") return { k: BOOL, v: a.v && b.v };
		if (op === "||") return { k: BOOL, v: a.v || b.v };
		const r = op === "==" || op === "!=" ? compare(op, a.v, b.v) : null;
		return r === null ? null : { k: BOOL, v: r };
	}
	if (a.k === STRING && b.k === STRING) {
		if (op === "+") return { k: STRING, v: a.v + b.v };
		const r = compare(op, a.v, b.v);
		return r === null ? null : { k: BOOL, v: r };
	}
	if (a.k === INT && b.k === INT) return foldInts(op, a.v, b.v);
	if (
		(a.k === INT || a.k === FLOAT) &&
		(b.k === INT || b.k === FLOAT) &&
		op !== "<<" &&
		op !== ">>"
	) {
		return foldFloats(op, asFloat(a), asFloat(b));
	}
	return null;
}

function foldExpr(expr, resolve) {
	switch (expr?.kind) {
		case "BasicLit":
			return fromLit(expr);
		case "Ident": {
			if (expr.name === "true" || expr.name === "false")
				return { k: BOOL, v: expr.name === "true" };
			const lit = resolve(expr.name);
			return lit ? fromLit(lit) : null;
		}
		case "UnaryExpr": {
			const x = foldExpr(expr.operand, resolve);
			return x ? foldUnary(expr.op, x) : null;
		}
		case "BinaryExpr": {
			const a = foldExpr(expr.left, resolve);
			const b = a ? foldExpr(expr.right, resolve) : null;
			return a && b ? foldBinary(expr.op, a, b) : null;
		}
		case "CallExpr": {
			if (expr.func?.kind !== "Ident" || expr.func.name !== "len") return null;
			if (expr.args?.length !== 1) return null;
			const s = foldExpr(expr.args[0], resolve);
			if (s?.k !== STRING) return null;
			// Gofront strings across JS and WASM runtime use UTF-16 code units (s.length).
			return { k: INT, v: BigInt(s.v.length) };
		}
		default:
			return null;
	}
}

// Folds `expr` into a BasicLit, or returns null when it needs the runtime.
// `resolve(name)` yields the BasicLit of an already-folded constant, if any.
export function foldConstExpr(expr, resolve) {
	const val = foldExpr(expr, resolve);
	return val ? toLit(val) : null;
}
