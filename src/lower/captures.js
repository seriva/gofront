// src/lower/captures.js
// Identifies free variables captured by closures and determines which ones
// are mutated and thus require heap-allocated environment cells for WASM closures.

import { collectMutatedVars, nodeMutatesVar } from "./ownership.js";

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
	if (node.kind === "FuncLit") return names;

	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		collectDeclaredNames(node[key], names);
	}
	return names;
}

/**
 * Finds all identifier references in a node that are not shadowed by inner declarations.
 */
export function collectReferencedNames(node, localDecls, refs = new Set()) {
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
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			collectReferencedNames(node[key], innerLocals, refs);
		}
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
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		collectReferencedNames(node[key], localDecls, refs);
	}
	return refs;
}

/**
 * Analyzes a function or method declaration for closures and their captured variables.
 * @param {Object} fnDecl AST FuncDecl or FuncLit node
 * @returns {CaptureAnalysis}
 */
export function analyzeCaptures(fnDecl) {
	const result = new CaptureAnalysis();
	if (!fnDecl?.body) return result;

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

	// Traverse closures with lexical scope stack to properly handle arbitrary nesting
	const walkClosures = (node, scopeStack) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) walkClosures(item, scopeStack);
			return;
		}

		if (node.kind === "FuncLit") {
			const closureLocals = new Set();
			for (const p of node.params ?? []) {
				if (p.name && p.name !== "_") closureLocals.add(p.name);
			}
			for (const r of node.returnType?._namedReturns ?? []) {
				if (r.name && r.name !== "_") closureLocals.add(r.name);
			}
			collectDeclaredNames(node.body, closureLocals);

			// Visible outer variables from all enclosing ancestor scopes
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
				if (
					mutatedVars.has(varName) ||
					nodeMutatesVar(fnDecl.body, varName) ||
					nodeMutatesVar(node.body, varName)
				) {
					result.mutatedCaptures.add(varName);
				}
			}

			walkClosures(node.body, [...scopeStack, closureLocals]);
			return;
		}

		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			walkClosures(node[key], scopeStack);
		}
	};

	walkClosures(fnDecl.body, [rootScope]);
	return result;
}
