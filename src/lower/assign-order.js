// src/lower/assign-order.js
// The left-hand operand rule shared by both backends.  Go evaluates the
// operands of every index, field and pointer-dereference target before any
// store of the same statement; a backend that stores target by target must
// bind those operands to temporaries first.  This module decides which
// operand slots to bind; the backends own the emission and the slot swap.

import { hasCallOrReceive, someChild } from "./walk.js";

/**
 * Returns, in source order, the `{ node, key }` operand slots of `lhs` to
 * evaluate into temporaries before the right-hand side.  `node[key]` is the
 * operand expression.  Never mutates the AST.
 *
 * - `single`: a one-target statement is still considered (default needs two).
 * - `callOnly`: plain-variable operands are read after the right-hand side;
 *   only operands with a call or receive (or one that mentions a variable
 *   the statement assigns) are bound.
 * - `isConst(node)`: the operand needs no binding when a call forces order.
 * - `isAggregate(node)`: the operand is a struct or array value naming
 *   storage; the operands inside it are considered instead.
 */
export function lhsOperandBinds(
	lhs,
	rhs,
	{ single = false, callOnly = false, isConst, isAggregate },
) {
	if (lhs.length < 2 && !single) return [];
	const ordered = hasCallOrReceive(rhs) || hasCallOrReceive(lhs);
	const assigned = new Set(
		lhs.filter((l) => l.kind === "Ident" && l.name !== "_").map((l) => l.name),
	);
	if (assigned.size === 0 && !ordered) return [];
	const mentions = (n) =>
		!!n &&
		typeof n === "object" &&
		((n.kind === "Ident" && assigned.has(n.name)) || someChild(n, mentions));
	const needsTemp = (n) => {
		if (!ordered) return mentions(n);
		if (callOnly) return hasCallOrReceive(n) || mentions(n);
		return !isConst(n);
	};
	const binds = [];
	const visit = (l) => {
		let keys;
		if (l.kind === "IndexExpr") keys = ["expr", "index"];
		else if (l.kind === "SelectorExpr" && !l._isMethodExpr) keys = ["expr"];
		else if (l.kind === "UnaryExpr" && l.op === "*") keys = ["operand"];
		else return;
		for (const key of keys) {
			const operand = l[key];
			if (!needsTemp(operand)) continue;
			if (key === "expr" && isAggregate(operand)) {
				visit(operand);
				continue;
			}
			binds.push({ node: l, key });
		}
	};
	for (const l of lhs) visit(l);
	return binds;
}
