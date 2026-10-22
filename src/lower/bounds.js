// src/lower/bounds.js
// Index-check elision for strict mode (`both` packages in JS).  Marks an
// IndexExpr `_inBounds` when its index is provably within the operand's
// length, so the backend emits a plain `xs[i]` instead of `__at`/`__ix`:
//
//   - `for i := range xs { … xs[i] … }`
//   - `for i := K; i < len(xs); i++ { … xs[i] … }` with a constant K >= 0
//   - a constant index into an array (the checker rejects out-of-range ones)
//
// The loop forms need `xs` to be a local slice or array that the body never
// assigns or shadows, `i` to be written only by the loop, and neither to be
// address-taken, used as a method receiver, or assigned inside any closure
// in the function.  Indexes inside func literals in the body are not marked:
// a closure may run after the loop, when `xs` has changed.

import { constIntValue } from "../typechecker/const-fold.js";
import { forEachChild } from "./walk.js";

function underlying(t) {
	return t?.kind === "named" ? underlying(t.underlying) : t;
}

function isSliceOrArray(t) {
	const u = underlying(t);
	return u?.kind === "slice" || u?.kind === "array";
}

function constInt(node) {
	const v = node?._const ? constIntValue(node._const) : null;
	return typeof v === "bigint" ? v : null;
}

function isIdent(node, name) {
	return node?.kind === "Ident" && (name === undefined || node.name === name);
}

// Names a node makes unsafe to reason about: taken by address, or used as a
// selector base (a possible pointer-receiver method call).
function unsafeNamesOf(node) {
	if (node.kind === "UnaryExpr" && node.op === "&" && isIdent(node.operand))
		return [node.operand.name];
	if (node.kind === "SelectorExpr" && isIdent(node.expr))
		return [node.expr.name];
	return [];
}

// Names that are unsafe anywhere in the function: see unsafeNamesOf, plus
// every name assigned inside a closure.
function collectUnsafeNames(fnBody) {
	const unsafe = new Set();
	const visit = (node, inClosure) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) visit(n, inClosure);
			return;
		}
		const names = inClosure
			? [...unsafeNamesOf(node), ...assignedNames(node)]
			: unsafeNamesOf(node);
		for (const n of names) unsafe.add(n);
		forEachChild(node, (c) => visit(c, inClosure || node.kind === "FuncLit"));
	};
	visit(fnBody, false);
	return unsafe;
}

// Identifiers a single node assigns to (not declarations).
function assignedNames(node) {
	if (node.kind === "AssignStmt")
		return node.lhs.filter((l) => isIdent(l)).map((l) => l.name);
	if (node.kind === "IncDecStmt" && isIdent(node.expr)) return [node.expr.name];
	return [];
}

// Identifiers a single node declares.
function declaredNames(node) {
	switch (node.kind) {
		case "DefineStmt":
			return node.lhs.filter((l) => isIdent(l)).map((l) => l.name);
		case "VarDecl":
			return (node.decls ?? []).flatMap((d) =>
				(d.names ?? []).map((n) => (typeof n === "string" ? n : n?.name)),
			);
		case "FuncLit":
			return (node.params ?? []).map((p) => p.name).filter(Boolean);
		default:
			return [];
	}
}

// True when `body` assigns or redeclares any of `names`.
function touches(body, names) {
	let hit = false;
	const visit = (node) => {
		if (hit || !node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) visit(n);
			return;
		}
		for (const n of [...assignedNames(node), ...declaredNames(node)])
			if (names.includes(n)) hit = true;
		forEachChild(node, visit);
	};
	visit(body);
	return hit;
}

// Marks `xs[i]` in `body`, outside func literals.
function markIndexes(body, xs, i) {
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) visit(n);
			return;
		}
		if (node.kind === "FuncLit") return;
		if (
			node.kind === "IndexExpr" &&
			isIdent(node.expr, xs) &&
			isIdent(node.index, i)
		)
			node._inBounds = true;
		forEachChild(node, visit);
	};
	visit(body);
}

// `len(xs)` over a slice or array identifier: its name, or null.
function lenOfName(node) {
	const ok =
		node?.kind === "CallExpr" &&
		isIdent(node.func, "len") &&
		node.args?.length === 1 &&
		isIdent(node.args[0]) &&
		isSliceOrArray(node.args[0]._type);
	return ok ? node.args[0].name : null;
}

// for i := range xs / for i, v := range xs
function rangeLoop(init, i) {
	const rhs = init.rhs?.[0];
	if (!isIdent(rhs.expr) || !isSliceOrArray(rhs.expr._type)) return null;
	return { xs: rhs.expr.name, i };
}

// for i := K; i < len(xs); i++ with a constant K >= 0
function countingLoop(stmt, i) {
	const { init, cond, post } = stmt;
	const k = constInt(init.rhs?.[0]);
	if (init.lhs.length !== 1 || k === null || k < 0n) return null;
	if (cond?.kind !== "BinaryExpr" || cond.op !== "<" || !isIdent(cond.left, i))
		return null;
	const xs = lenOfName(cond.right);
	const step =
		post?.kind === "IncDecStmt" && post.op === "++" && isIdent(post.expr, i);
	return xs && step ? { xs, i } : null;
}

// The (slice name, index name) a for statement proves in range, or null.
function inBoundsLoop(stmt) {
	const init = stmt.init;
	if (init?.kind !== "DefineStmt" || !isIdent(init.lhs?.[0])) return null;
	const i = init.lhs[0].name;
	return init.rhs?.[0]?.kind === "RangeExpr"
		? rangeLoop(init, i)
		: countingLoop(stmt, i);
}

// Marks the loop's `xs[i]` when its slice is a local the loop cannot change.
function markLoop(stmt, scope, unsafe) {
	const loop = inBoundsLoop(stmt);
	if (!loop || !scope.has(loop.xs) || scope.has("len")) return;
	if (unsafe.has(loop.xs) || unsafe.has(loop.i)) return;
	if (touches(stmt.body, [loop.xs, loop.i])) return;
	markIndexes(stmt.body, loop.xs, loop.i);
}

const SCOPE_KINDS = new Set([
	"Block",
	"ForStmt",
	"IfStmt",
	"FuncLit",
	"CaseClause",
]);

function analyzeFunc(params, body) {
	const unsafe = collectUnsafeNames(body);
	// Walk in source order with a scope chain of local names, so `xs` counts
	// as local only when a declaration in an enclosing scope precedes the loop.
	const visit = (node, scope) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) visit(n, scope);
			return;
		}
		if (node.kind === "IndexExpr") markConstArrayIndex(node);
		if (node.kind === "ForStmt") markLoop(node, scope, unsafe);
		const inner = SCOPE_KINDS.has(node.kind) ? scope.child() : scope;
		const declared = declaredNames(node);
		// Func literal parameters belong to its body; other declarations
		// follow the node in its enclosing scope.
		const target = node.kind === "FuncLit" ? inner : null;
		if (target) for (const n of declared) target.add(n);
		forEachChild(node, (c) => visit(c, inner));
		if (!target) for (const n of declared) scope.add(n);
	};
	const root = new LocalScope(null);
	for (const n of params) root.add(n);
	visit(body, root);
}

function markConstArrayIndex(node) {
	const u = underlying(node.expr?._type);
	if (u?.kind !== "array" || typeof u.size !== "number") return;
	const k = constInt(node.index);
	if (k !== null && k >= 0n && k < BigInt(u.size)) node._inBounds = true;
}

class LocalScope {
	constructor(parent) {
		this.parent = parent;
		this.names = new Set();
	}
	child() {
		return new LocalScope(this);
	}
	add(name) {
		if (name && name !== "_") this.names.add(name);
	}
	has(name) {
		return this.names.has(name) || (this.parent?.has(name) ?? false);
	}
}

function paramNames(decl) {
	const names = (decl.params ?? []).map((p) => p.name);
	if (decl.recvName) names.push(decl.recvName);
	for (const r of decl.returnType?._namedReturns ?? [])
		names.push(typeof r === "string" ? r : r?.name);
	return names;
}

/** Marks provably in-range IndexExprs `_inBounds` in every function. */
export function markInBoundsIndexes(program) {
	for (const d of program?.decls ?? []) {
		if ((d.kind === "FuncDecl" || d.kind === "MethodDecl") && d.body)
			analyzeFunc(paramNames(d), d.body);
	}
}
