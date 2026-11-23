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

/**
 * The names of every type the programs declare, nested declarations (a type
 * declared in a function) included, in source order.
 */
export function declaredTypeNames(programs) {
	const names = [];
	const visit = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(visit);
		if (node.kind === "TypeDecl") names.push(node.name);
		forEachChild(node, visit);
	};
	for (const p of programs) visit(p.decls);
	return names;
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

// Built-in objects with internal state that a property copy would lose.
const OPAQUE = [Error, Map, Set, WeakMap, WeakSet, RegExp, Date, ArrayBuffer];

function isOpaque(value) {
	return ArrayBuffer.isView(value) || OPAQUE.some((c) => value instanceof c);
}

// Side-table keys that hold AST the passes rewrite in place (the parser's
// named results), so a copy owns them like any child.
const STRUCTURAL_SIDE_KEYS = new Set(["_namedReturns"]);

/**
 * A structural copy of `node`: fresh shells for every node and list, so a
 * pass that rewrites the copy in place never touches the original. A node
 * reached twice stays one node in the copy. Side-table values (`_type`, …)
 * are shared by reference, unless `cloneSide` asks for them to be copied as
 * well (the parse-time structures of a pristine AST, e.g. `_embeds`). Values
 * that hold internal state (an `Error`, a `Map`, …) are shared; other class
 * instances (tokens) are copied with their prototype.
 */
export function cloneAst(node, { cloneSide = false } = {}, seen = new Map()) {
	if (!node || typeof node !== "object") return node;
	const prev = seen.get(node);
	if (prev) return prev;
	const isArray = Array.isArray(node);
	if (!isArray && isOpaque(node)) return node;
	const copy = isArray ? [] : Object.create(Object.getPrototypeOf(node));
	seen.set(node, copy);
	if (isArray) {
		for (const n of node) copy.push(cloneAst(n, { cloneSide }, seen));
		return copy;
	}
	// Own non-enumerable properties (templ nodes keep their parsed Go
	// expressions there) are copied too, and stay hidden.
	for (const k of Object.getOwnPropertyNames(node)) {
		const d = Object.getOwnPropertyDescriptor(node, k);
		const v =
			isSideTableKey(k) && !cloneSide && !STRUCTURAL_SIDE_KEYS.has(k)
				? d.value
				: cloneAst(d.value, { cloneSide }, seen);
		if (d.enumerable) copy[k] = v;
		else
			Object.defineProperty(copy, k, {
				value: v,
				enumerable: false,
				writable: true,
				configurable: true,
			});
	}
	return copy;
}
