// src/lower/ownership.js
// Tracks variable ownership, mutation and clone elision for Go value semantics.

import { forEachChild, someChild } from "./walk.js";

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

// The variable whose address `node` takes without an explicit `&`, or null:
// a pointer-receiver method call or method value (`v.M()`, `v.M` with
// `func (*T) M`) takes `&v`, and slicing an array (`a[:]`) aliases it.
export function implicitAddrRoot(node) {
	if (node.kind === "SelectorExpr" && node._type?._ptrRecv === true)
		return rootIdentName(node.expr);
	if (node.kind === "SliceExpr" && isArrayTyped(node.expr?._type))
		return rootIdentName(node.expr);
	return null;
}

function isArrayTyped(t) {
	while (t?.kind === "named") t = t.underlying;
	return t?.kind === "array";
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
	if (addrOnly && implicitAddrRoot(node) === name) return true;
	if (!addrOnly && nodeWritesVar(node, name)) return true;
	return someChild(node, (child) => nodeMutatesVar(child, name, addrOnly));
}

// Single-pass collector of all mutated or address-taken variables in an AST node.
// With `addrOnly`, only address-taken ones, implicit address-taking included.
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
	} else if (addrOnly) {
		const root = implicitAddrRoot(node);
		if (root) mutated.add(root);
	} else {
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

	forEachChild(node, (child) => collectMutatedVars(child, mutated, addrOnly));
	return mutated;
}

export function fnMutates(body, name, addrOnly = false, cache = null) {
	if (!body) return true;
	if (cache) {
		const setKey = addrOnly ? "&*" : "*";
		let set = cache.get(setKey);
		if (!set) {
			set = collectMutatedVars(body, new Set(), addrOnly);
			cache.set(setKey, set);
		}
		return set.has(name);
	}
	return nodeMutatesVar(body, name, addrOnly);
}

function collectClosureMutatedVars(node, mutated = new Set()) {
	if (!node || typeof node !== "object") return mutated;
	if (Array.isArray(node)) {
		for (const item of node) collectClosureMutatedVars(item, mutated);
		return mutated;
	}
	if (node.kind === "FuncLit") {
		collectMutatedVars(node.body, mutated, false);
		return mutated;
	}
	forEachChild(node, (child) => collectClosureMutatedVars(child, mutated));
	return mutated;
}

export function closureMutates(body, name, cache = null) {
	if (!body) return false;
	if (cache) {
		let set = cache.get("λ*");
		if (!set) {
			set = collectClosureMutatedVars(body, new Set());
			cache.set("λ*", set);
		}
		return set.has(name);
	}

	const walk = (node) => {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) return node.some(walk);
		if (node.kind === "FuncLit") return nodeMutatesVar(node.body, name);
		return someChild(node, walk);
	};
	return walk(body);
}

// Names whose array value may be changed in place or aliased anywhere in
// `body` (closures included): every mutation or address-of counted by
// collectMutatedVars, plus slicing (`a[:]` aliases the array) and method
// calls on the variable (a pointer receiver may write through).
export function collectArrayAliasedVars(body) {
	const names = collectMutatedVars(body, new Set(), false);
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) walk(n);
			return;
		}
		if (node.kind === "SliceExpr") {
			const root = rootIdentName(node.expr);
			if (root) names.add(root);
		} else if (node.kind === "CallExpr" && node.func?.kind === "SelectorExpr") {
			const root = rootIdentName(node.func.expr);
			if (root) names.add(root);
		}
		forEachChild(node, walk);
	};
	walk(body);
	return names;
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

	// Clone elision for arrays: a copy between two local variables may share
	// the array when neither is ever changed in place or aliased in this
	// function (closures included), so no write can be observed through the
	// other name.  Conservative by name: a shadowing variable with the same
	// name that is mutated also blocks elision.
	arrayShareable(name) {
		if (!name || name === "_") return false;
		let set = this.mut.get("arr*");
		if (!set) {
			set = collectArrayAliasedVars(this.body);
			this.mut.set("arr*", set);
		}
		return !set.has(name);
	}

	closureMutates(name) {
		return closureMutates(this.body, name, this.mut);
	}
}
