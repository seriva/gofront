// src/lower/captures.js
// Identifies free variables captured by closures and determines which ones
// are mutated and thus require heap-allocated environment cells for WASM closures.

import { collectMutatedVars } from "./ownership.js";
import { getOrCreateIteratorFuncLit, isIteratorRangeFor } from "./range.js";
import { forEachChild } from "./walk.js";

/**
 * Result of capture analysis on a function or closure.
 */
export class CaptureAnalysis {
	constructor() {
		// Map<FuncLit, Set<string>>: free variables captured by each closure
		this.capturesByClosure = new Map();
		// Set<string>: variables in the enclosing scope that are captured AND mutated
		this.mutatedCaptures = new Set();
	}
}

/**
 * Finds all variable declarations in a block or list of statements.
 */
export function collectDeclaredNames(node, names = new Set()) {
	if (!node || typeof node !== "object") return names;
	if (Array.isArray(node)) {
		for (const item of node) collectDeclaredNames(item, names);
		return names;
	}

	if (node.kind === "VarDecl" || node.kind === "ConstDecl") {
		for (const spec of node.decls ?? []) {
			for (const name of spec.names ?? []) names.add(name);
		}
	} else if (node.kind === "DefineStmt") {
		for (const lhs of node.lhs ?? []) {
			if (lhs.kind === "Ident") names.add(lhs.name);
		}
	} else if (node.kind === "TypeSwitchStmt" && node.assign) {
		names.add(node.assign);
	}

	// Do not descend into nested functions when collecting local declarations
	if (node.kind === "FuncLit" || isIteratorRangeFor(node)) return names;

	forEachChild(node, (child) => collectDeclaredNames(child, names));
	return names;
}

/**
 * Finds all identifier references in a node that are not shadowed by inner declarations.
 */
function collectReferencedNames(node, localDecls, refs = new Set()) {
	if (!node || typeof node !== "object") return refs;
	if (Array.isArray(node)) {
		for (const item of node) collectReferencedNames(item, localDecls, refs);
		return refs;
	}

	// In struct literals, field names in KeyValueExpr are not variable references
	if (node.kind === "KeyValueExpr") {
		collectReferencedNames(node.value, localDecls, refs);
		return refs;
	}

	if (node.kind === "FuncLit") {
		const innerLocals = new Set(localDecls);
		for (const p of node.params ?? []) {
			if (p.name && p.name !== "_") innerLocals.add(p.name);
		}
		for (const r of node.returnType?._namedReturns ?? []) {
			if (r.name && r.name !== "_") innerLocals.add(r.name);
		}
		collectDeclaredNames(node.body, innerLocals);
		forEachChild(node, (child) =>
			collectReferencedNames(child, innerLocals, refs),
		);
		return refs;
	}

	if (
		node.kind === "Ident" &&
		!localDecls.has(node.name) &&
		node.name !== "_"
	) {
		refs.add(node.name);
	}

	// For nested closures, free variables are also referenced
	forEachChild(node, (child) =>
		collectReferencedNames(child, localDecls, refs),
	);
	return refs;
}

function hasReturnInNode(n) {
	let found = false;
	const check = (x) => {
		if (!x || typeof x !== "object" || found) return;
		if (Array.isArray(x)) {
			for (const elem of x) check(elem);
			return;
		}
		if (x.kind === "ReturnStmt") {
			found = true;
			return;
		}
		if (x.kind === "FuncLit" && !x._isYieldClosure) return;
		for (const k of Object.keys(x)) {
			if (k.startsWith("_")) continue;
			check(x[k]);
		}
	};
	check(n);
	return found;
}

function hasIteratorWithReturn(body) {
	let found = false;
	const check = (x) => {
		if (!x || typeof x !== "object" || found) return;
		if (Array.isArray(x)) {
			for (const elem of x) check(elem);
			return;
		}
		if (x.kind === "FuncLit") return;
		if (isIteratorRangeFor(x)) {
			const lit = getOrCreateIteratorFuncLit(x);
			if (hasReturnInNode(lit?.body)) {
				found = true;
				return;
			}
		}
		for (const k of Object.keys(x)) {
			if (k.startsWith("_")) continue;
			check(x[k]);
		}
	};
	check(body);
	return found;
}

/**
 * Analyzes a function or method declaration for closures and their captured variables.
 * @param {Object} fnDecl AST FuncDecl or FuncLit node
 * @returns {CaptureAnalysis}
 */
export function analyzeCaptures(fnDecl) {
	const result = new CaptureAnalysis();
	if (!fnDecl?.body) return result;

	// Synthesize named returns if not already present, so iterator returns can share boxed slots
	if (
		fnDecl.returnType &&
		!fnDecl.returnType._namedReturns &&
		hasIteratorWithReturn(fnDecl.body)
	) {
		const ret = fnDecl.returnType;
		if (ret.name !== "void") {
			const types =
				ret.kind === "TupleType" || ret.kind === "tuple" ? ret.types : [ret];
			if (types && types.length > 0) {
				fnDecl.returnType._namedReturns = types.map((t, i) => ({
					name: `__retVal$${i}`,
					type: { ...t, _namedReturns: undefined },
					_synthesized: true,
				}));
			}
		}
	}

	// Collect parameters, receiver and named returns of the root function
	const rootScope = new Set();
	if (fnDecl.recvName && fnDecl.recvName !== "_") {
		rootScope.add(fnDecl.recvName);
	}
	for (const p of fnDecl.params ?? []) {
		if (p.name && p.name !== "_") rootScope.add(p.name);
	}
	for (const r of fnDecl.returnType?._namedReturns ?? []) {
		if (r.name && r.name !== "_") rootScope.add(r.name);
	}
	collectDeclaredNames(fnDecl.body, rootScope);

	// Fast pre-collected set of all mutated variables in the entire function
	const mutatedVars = collectMutatedVars(fnDecl.body);

	const handleIteratorRange = (node, scopeStack) => {
		const funcLit = getOrCreateIteratorFuncLit(node);
		if (node._iterStateName) {
			rootScope.add(node._iterStateName);
			result.mutatedCaptures.add(node._iterStateName);
		}
		const rootNamed = fnDecl.returnType?._namedReturns ?? [];
		const hasRet = hasReturnInNode(funcLit.body);
		if (hasRet && rootNamed.length > 0) {
			for (const r of rootNamed) {
				if (r.name && r.name !== "_") {
					rootScope.add(r.name);
					result.mutatedCaptures.add(r.name);
				}
			}
		}
		walkClosures(funcLit, scopeStack);
		const captured = result.capturesByClosure.get(funcLit) ?? new Set();
		if (node._iterStateName) {
			captured.add(node._iterStateName);
		}
		if (hasRet && rootNamed.length > 0) {
			for (const r of rootNamed) {
				if (r.name && r.name !== "_") {
					captured.add(r.name);
				}
			}
		}
		result.capturesByClosure.set(funcLit, captured);
	};

	const handleFuncLit = (node, scopeStack) => {
		const closureLocals = new Set();
		for (const p of node.params ?? []) {
			if (p.name && p.name !== "_") closureLocals.add(p.name);
		}
		for (const r of node.returnType?._namedReturns ?? []) {
			if (r.name && r.name !== "_") closureLocals.add(r.name);
		}
		collectDeclaredNames(node.body, closureLocals);

		const allOuterScope = new Set();
		for (const scope of scopeStack) {
			for (const name of scope) allOuterScope.add(name);
		}

		const allRefs = collectReferencedNames(node.body, closureLocals);
		const captured = new Set();
		for (const ref of allRefs) {
			if (allOuterScope.has(ref)) {
				captured.add(ref);
			}
		}
		result.capturesByClosure.set(node, captured);

		for (const varName of captured) {
			if (mutatedVars.has(varName)) {
				result.mutatedCaptures.add(varName);
			}
		}

		walkClosures(node.body, [...scopeStack, closureLocals]);
	};

	// Traverse closures with lexical scope stack to properly handle arbitrary nesting
	const walkClosures = (node, scopeStack) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) walkClosures(item, scopeStack);
			return;
		}

		if (isIteratorRangeFor(node)) {
			handleIteratorRange(node, scopeStack);
			return;
		}

		if (node.kind === "FuncLit") {
			handleFuncLit(node, scopeStack);
			return;
		}

		forEachChild(node, (child) => walkClosures(child, scopeStack));
	};

	walkClosures(fnDecl.body, [rootScope]);
	return result;
}

/**
 * Go 1.22 per-iteration loop variables: the names declared by a three-clause
 * `for` init (`for i := …`) that a closure inside the loop (body, cond or
 * post) refers to.  Conservative by name.  Only these need a fresh copy per
 * iteration; the others stay plain locals.
 */
export function loopVarsCapturedInLoop(stmt) {
	const out = new Set();
	if (stmt?.init?.kind !== "DefineStmt") return out;
	const names = new Set(
		(stmt.init.lhs ?? [])
			.filter((l) => l.kind === "Ident" && l.name !== "_")
			.map((l) => l.name),
	);
	if (names.size === 0) return out;
	const walk = (node, inClosure) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) walk(n, inClosure);
			return;
		}
		if (inClosure && node.kind === "Ident" && names.has(node.name))
			out.add(node.name);
		const nowIn = inClosure || node.kind === "FuncLit";
		forEachChild(node, (child) => walk(child, nowIn));
	};
	walk([stmt.cond, stmt.post, stmt.body], false);
	return out;
}
