// src/lower/ownership.js
// Tracks variable ownership, mutation and clone elision for Go value semantics.

export function rootIdentName(e) {
	while (e) {
		if (e.kind === "Ident") return e.name;
		if (e.kind === "SelectorExpr" || e.kind === "IndexExpr") e = e.expr;
		else if (e.kind === "UnaryExpr" && e.op === "*") e = e.operand;
		else return null;
	}
	return null;
}

// True when `node` itself (not its children) writes to variable `name`.
export function nodeWritesVar(node, name) {
	const root = (e) => rootIdentName(e) === name;
	switch (node.kind) {
		case "AssignStmt":
			return node.lhs.some(root);
		case "DefineStmt":
			return node.lhs.some((e) => e._redecl && e.name === name);
		case "IncDecStmt":
			return root(node.expr);
		case "SelectorExpr":
			return Boolean(
				node._isMethodValue && node._type?._ptrRecv && root(node.expr),
			);
		default:
			return false;
	}
}

// True when `node` may modify (or take the address of) the value held by variable `name`.
export function nodeMutatesVar(node, name, addrOnly = false) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node))
		return node.some((n) => nodeMutatesVar(n, name, addrOnly));
	if (
		node.kind === "UnaryExpr" &&
		node.op === "&" &&
		rootIdentName(node.operand) === name
	)
		return true;
	if (!addrOnly && nodeWritesVar(node, name)) return true;
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		if (nodeMutatesVar(node[key], name, addrOnly)) return true;
	}
	return false;
}

// Single-pass collector of all mutated or address-taken variables in an AST node.
export function collectMutatedVars(
	node,
	mutated = new Set(),
	addrOnly = false,
) {
	if (!node || typeof node !== "object") return mutated;
	if (Array.isArray(node)) {
		for (const item of node) collectMutatedVars(item, mutated, addrOnly);
		return mutated;
	}

	if (node.kind === "UnaryExpr" && node.op === "&") {
		const root = rootIdentName(node.operand);
		if (root) mutated.add(root);
	} else if (!addrOnly) {
		if (node.kind === "AssignStmt") {
			for (const e of node.lhs) {
				const root = rootIdentName(e);
				if (root) mutated.add(root);
			}
		} else if (node.kind === "DefineStmt") {
			for (const e of node.lhs) {
				if (e._redecl && e.name) mutated.add(e.name);
			}
		} else if (node.kind === "IncDecStmt") {
			const root = rootIdentName(node.expr);
			if (root) mutated.add(root);
		} else if (node.kind === "SelectorExpr") {
			if (node._isMethodValue && node._type?._ptrRecv) {
				const root = rootIdentName(node.expr);
				if (root) mutated.add(root);
			}
		}
	}

	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		collectMutatedVars(node[key], mutated, addrOnly);
	}
	return mutated;
}

export function fnMutates(body, name, addrOnly = false, cache = null) {
	if (!body) return true;
	const key = `${addrOnly ? "&" : ""}${name}`;
	if (cache) {
		if (!cache.has(key)) {
			cache.set(key, nodeMutatesVar(body, name, addrOnly));
		}
		return cache.get(key);
	}
	return nodeMutatesVar(body, name, addrOnly);
}

export function closureMutates(body, name, cache = null) {
	const key = `λ${name}`;
	if (cache?.has(key)) return cache.get(key);

	const walk = (node) => {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) return node.some(walk);
		if (node.kind === "FuncLit") return nodeMutatesVar(node.body, name);
		return Object.keys(node).some((k) => !k.startsWith("_") && walk(node[k]));
	};
	const res = walk(body);
	if (cache) cache.set(key, res);
	return res;
}

export class OwnershipContext {
	constructor(body) {
		this.body = body;
		this.mut = new Map();
		this.owned = new Set();
		this.borrowed = new Set();
	}

	markOwnership(name, owned) {
		if (!name || name === "_") return;
		(owned ? this.owned : this.borrowed).add(name);
	}

	fnMutates(name, addrOnly = false) {
		return fnMutates(this.body, name, addrOnly, this.mut);
	}

	closureMutates(name) {
		return closureMutates(this.body, name, this.mut);
	}
}
