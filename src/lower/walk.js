// src/lower/walk.js
// Shared AST child traversal for the lowering passes.  Side-table fields
// (`_type`, `_boxed`, …) start with "_" and are never AST children.

/** True for a side-table key that traversal must skip. */
function isSideTableKey(key) {
	return key.charCodeAt(0) === 95; // "_"
}

/** Calls `fn(child)` for every non-side-table property of `node`. */
export function forEachChild(node, fn) {
	for (const key of Object.keys(node)) {
		if (isSideTableKey(key)) continue;
		fn(node[key]);
	}
}

/** True when `pred(child)` holds for some non-side-table property of `node`. */
export function someChild(node, pred) {
	for (const key of Object.keys(node)) {
		if (isSideTableKey(key)) continue;
		if (pred(node[key])) return true;
	}
	return false;
}

/**
 * True when evaluating `node` runs a call or a channel receive (conversions
 * excluded), the only operands Go still evaluates for a constant `len`.
 */
export function hasCallOrReceive(node) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node)) return node.some(hasCallOrReceive);
	if (node.kind === "CallExpr" && !node._isTypeConversion) return true;
	if (node.kind === "UnaryExpr" && node.op === "<-") return true;
	return someChild(node, hasCallOrReceive);
}
