// src/lower/globals.js
// Identifies package-level globals that are never assigned outside init,
// and computes functions that participate in the package initialization call path.

import { isReferenceType } from "./boxing.js";

/**
 * Computes:
 * - neverAssignedGlobals: Set of package variable names that are never reassigned outside init.
 * - initPathFunctions: Set of function/method names reachable during package initialization.
 * - cachedGlobalsByFunc: Map of AST function declarations to list of global names to cache.
 *
 * @param {Array<Object>} programs
 * @param {Object} [_checker]
 * @returns {{ neverAssignedGlobals: Set<string>, initPathFunctions: Set<string>, cachedGlobalsByFunc: Map<Object, Array<string>> }}
 */
export function computeGlobalAnalysis(programs, _checker = null) {
	const progs = Array.isArray(programs) ? programs : [programs];
	const packageGlobals = collectPackageGlobals(progs);
	const reassigned = collectReassigned(progs, packageGlobals);

	const neverAssignedGlobals = new Set();
	for (const g of packageGlobals) {
		if (!reassigned.has(g)) neverAssignedGlobals.add(g);
	}

	const initPathFunctions = buildInitPathFunctions(progs);
	const cachedGlobalsByFunc = buildCachedGlobalsMap(
		progs,
		neverAssignedGlobals,
		initPathFunctions,
	);

	return { neverAssignedGlobals, initPathFunctions, cachedGlobalsByFunc };
}

function collectVarNames(spec, out) {
	const names = spec.names ?? (spec.name ? [spec.name] : []);
	for (const n of names) {
		const name = typeof n === "string" ? n : n?.name;
		if (name && name !== "_") out.add(name);
	}
}

function collectPackageGlobals(programs) {
	const out = new Set();
	for (const p of programs) {
		for (const d of p?.decls ?? []) {
			if (d.kind === "VarDecl") {
				for (const spec of d.decls ?? d.specs ?? [d]) {
					collectVarNames(spec, out);
				}
			}
		}
	}
	return out;
}

function collectReassigned(programs, packageGlobals) {
	const reassigned = new Set();
	for (const p of programs) {
		for (const d of p?.decls ?? []) {
			if (d.kind === "FuncDecl" || d.kind === "MethodDecl") {
				const isInit =
					d.kind === "FuncDecl" &&
					(d.name === "init" || d.name.startsWith("init$"));
				scanReassignments(d.body, packageGlobals, reassigned, isInit);
			}
		}
	}
	return reassigned;
}

function checkAssignLhs(lhs, packageGlobals, reassigned) {
	for (const l of lhs ?? []) {
		if (l.kind === "Ident" && packageGlobals.has(l.name)) {
			reassigned.add(l.name);
		}
	}
}

function checkIncDec(stmt, packageGlobals, reassigned) {
	if (stmt.expr?.kind === "Ident" && packageGlobals.has(stmt.expr.name)) {
		reassigned.add(stmt.expr.name);
	}
}

function checkAddressTaken(node, packageGlobals, reassigned) {
	if (
		node.kind === "Ident" &&
		node._addressTaken &&
		packageGlobals.has(node.name)
	) {
		if (!isReferenceType(node._type)) {
			reassigned.add(node.name);
		}
	}
}

function scanReassignments(node, packageGlobals, reassigned, insideInit) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const child of node) {
			scanReassignments(child, packageGlobals, reassigned, insideInit);
		}
		return;
	}
	if (node.kind === "FuncLit") {
		scanReassignments(node.body, packageGlobals, reassigned, false);
		return;
	}
	if (!insideInit) {
		if (node.kind === "AssignStmt" || node.kind === "CompoundAssignStmt") {
			checkAssignLhs(node.lhs, packageGlobals, reassigned);
		} else if (node.kind === "IncDecStmt") {
			checkIncDec(node, packageGlobals, reassigned);
		}
	}
	checkAddressTaken(node, packageGlobals, reassigned);
	for (const k of Object.keys(node)) {
		if (!k.startsWith("_")) {
			scanReassignments(node[k], packageGlobals, reassigned, insideInit);
		}
	}
}

function addCallTarget(call, called) {
	if (call.func?.kind === "Ident") {
		called.add(call.func.name);
		return;
	}
	if (call.func?.kind === "SelectorExpr") {
		const sel = call.func.sel ?? call.func.field;
		if (sel) called.add(sel);
		const typeName =
			call.func.expr?._type?.name ?? call.func.expr?._type?.base?.name;
		if (typeName && sel) called.add(`${typeName}.${sel}`);
	}
}

function findCalledFunctions(node, called = new Set()) {
	if (!node || typeof node !== "object") return called;
	if (Array.isArray(node)) {
		for (const child of node) findCalledFunctions(child, called);
		return called;
	}
	if (node.kind === "CallExpr") addCallTarget(node, called);
	for (const k of Object.keys(node)) {
		if (!k.startsWith("_")) findCalledFunctions(node[k], called);
	}
	return called;
}

function addCallees(callGraph, caller, callees) {
	let set = callGraph.get(caller);
	if (!set) {
		set = new Set();
		callGraph.set(caller, set);
	}
	for (const c of callees) set.add(c);
}

function buildInitSeeds(programs) {
	const seeds = new Set(["init", "__init_globals"]);
	for (const p of programs) {
		for (const d of p?.decls ?? []) {
			if (
				d.kind === "FuncDecl" &&
				(d.name === "init" || d.name.startsWith("init$"))
			) {
				seeds.add(d.name);
			}
			if (d.kind === "VarDecl") {
				for (const spec of d.decls ?? d.specs ?? [d]) {
					const values = spec.value ?? (spec.init ? [spec.init] : []);
					for (const val of values) findCalledFunctions(val, seeds);
				}
			}
		}
	}
	return seeds;
}

function buildCallGraph(programs) {
	const callGraph = new Map();
	for (const p of programs) {
		for (const d of p?.decls ?? []) {
			if ((d.kind === "FuncDecl" || d.kind === "MethodDecl") && d.body) {
				const callees = findCalledFunctions(d.body);
				addCallees(callGraph, d.name, callees);
				if (d.kind === "MethodDecl" && d.recvType?.name) {
					addCallees(callGraph, `${d.recvType.name}.${d.name}`, callees);
				}
			}
		}
	}
	return callGraph;
}

function buildInitPathFunctions(programs) {
	const seeds = buildInitSeeds(programs);
	const callGraph = buildCallGraph(programs);
	const initPath = new Set(seeds);
	const worklist = Array.from(seeds);
	while (worklist.length > 0) {
		const caller = worklist.pop();
		const callees = callGraph.get(caller);
		if (callees) {
			for (const callee of callees) {
				if (!initPath.has(callee)) {
					initPath.add(callee);
					worklist.push(callee);
				}
			}
		}
	}
	return initPath;
}

// Idents read anywhere in the function, nested closures included: the emitter
// narrows the list per emitted body (root vs. each lifted closure).
function scanReadIdents(node, readSet) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const c of node) scanReadIdents(c, readSet);
		return;
	}
	if (node.kind === "SelectorExpr") {
		scanReadIdents(node.expr, readSet);
		return;
	}
	if (node.kind === "DefineStmt") {
		scanReadIdents(node.rhs, readSet);
		return;
	}
	if (node.kind === "AssignStmt" || node.kind === "CompoundAssignStmt") {
		for (const l of node.lhs ?? []) {
			if (l.kind !== "Ident") scanReadIdents(l, readSet);
		}
		scanReadIdents(node.rhs, readSet);
		return;
	}
	if (node.kind === "Ident" && typeof node.name === "string") {
		readSet.add(node.name);
		return;
	}
	for (const k of Object.keys(node)) {
		if (!k.startsWith("_")) scanReadIdents(node[k], readSet);
	}
}

function isLocallyDeclared(node, name) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node)) return node.some((c) => isLocallyDeclared(c, name));
	if (node.kind === "FuncLit") return false;
	if (node.kind === "DefineStmt") {
		return Boolean(
			node.lhs?.some((l) => l.kind === "Ident" && l.name === name),
		);
	}
	if (node.kind === "VarDecl") {
		for (const s of node.decls ?? node.specs ?? []) {
			const names = s.names ?? (s.name ? [s.name] : []);
			if (names.some((n) => (typeof n === "string" ? n : n.name) === name))
				return true;
		}
	}
	for (const k of Object.keys(node)) {
		if (!k.startsWith("_") && isLocallyDeclared(node[k], name)) return true;
	}
	return false;
}

function getGlobalsToCache(fn, neverAssignedGlobals, initPathFunctions) {
	if (!fn.body || neverAssignedGlobals.size === 0) return [];
	if (fn._isGlobalInit || fn.name === "init" || fn.name.startsWith("init$"))
		return [];
	if (initPathFunctions.has(fn.name)) return [];
	if (fn._methodName && initPathFunctions.has(fn._methodName)) return [];
	if (
		fn.recvType?.name &&
		initPathFunctions.has(`${fn.recvType.name}.${fn.name}`)
	)
		return [];

	const paramNames = new Set((fn.params ?? []).map((p) => p.name));
	if (fn.recvName) paramNames.add(fn.recvName);

	const reads = new Set();
	scanReadIdents(fn.body, reads);

	const result = [];
	for (const name of Array.from(neverAssignedGlobals).sort()) {
		if (
			reads.has(name) &&
			!paramNames.has(name) &&
			!isLocallyDeclared(fn.body, name)
		) {
			result.push(name);
		}
	}
	return result;
}

function buildCachedGlobalsMap(
	programs,
	neverAssignedGlobals,
	initPathFunctions,
) {
	const map = new Map();
	for (const p of programs) {
		for (const d of p?.decls ?? []) {
			if ((d.kind === "FuncDecl" || d.kind === "MethodDecl") && d.body) {
				const globals = getGlobalsToCache(
					d,
					neverAssignedGlobals,
					initPathFunctions,
				);
				if (globals.length > 0) map.set(d, globals);
			}
		}
	}
	return map;
}
