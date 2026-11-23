// The dereference `*p` of an operand written `*p` or `(*p)`, or null when the
// operand is no dereference.  `&(*p)` and a pointer-receiver call on `(*p)`
// pass `p` itself (its `operand`), never a copy of what it points to.
export function derefOf(operand) {
	let e = operand;
	while (e?.kind === "ParenExpr") e = e.expr;
	return e?.kind === "UnaryExpr" && e.op === "*" ? e : null;
}
