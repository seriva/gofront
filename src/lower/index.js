// src/lower/index.js
// Lowering step: analyzes AST and types to populate side-tables for backends (JS and WASM).

export * from "./boxing.js";
export * from "./captures.js";
export * from "./embedding.js";
export * from "./escape.js";
export * from "./functions.js";
export * from "./globals.js";
export * from "./ownership.js";
export * from "./range.js";
export * from "./walk.js";

import { scanAddressTaken } from "./boxing.js";
import { analyzeCaptures } from "./captures.js";
import { computeEmbeddedStubs } from "./embedding.js";
import { paramEscapes } from "./escape.js";
import { extractNamedReturns, hasDefer, normalizeDefers } from "./functions.js";
import { computeGlobalAnalysis } from "./globals.js";
import { OwnershipContext } from "./ownership.js";

class LowerResult {
	constructor() {
		// Map<ASTNode (FuncDecl, MethodDecl, FuncLit), Set<string>>
		this.boxedVars = new Map();
		// Map<ASTNode, OwnershipContext>
		this.ownership = new Map();
		// Map<ASTNode, Object>
		this.functions = new Map();
		// Map<string, Array<{ methodName: string, embedName: string }>>
		this.embeddedStubs = new Map();
		// Map<ASTNode, CaptureAnalysis>
		this.captures = new Map();
		// Map<ASTNode, Set<string>>
		this.escapes = new Map();
		// Set<string>
		this.neverAssignedGlobals = new Set();
		// Set<string>
		this.initPathFunctions = new Set();
		// Map<ASTNode, Array<string>>
		this.cachedGlobalsByFunc = new Map();
	}
}

/**
 * Runs lowering analyses across an AST or collection of programs, returning side-tables.
 * @param {Object} programOrPrograms
 * @param {Object} checker
 * @returns {LowerResult}
 */
export function lower(programOrPrograms, checker = null) {
	const res = new LowerResult();
	const programs = Array.isArray(programOrPrograms)
		? programOrPrograms
		: [programOrPrograms];

	normalizeDefers(programs);

	// 1. Aggregate methods across all files in the package
	const methodMap = new Map();
	for (const program of programs) {
		for (const d of program?.decls ?? []) {
			if (d.kind === "MethodDecl" && d.recvType?.name) {
				const recvTypeName = d.recvType.name;
				if (!methodMap.has(recvTypeName)) methodMap.set(recvTypeName, []);
				methodMap.get(recvTypeName).push(d);
			}
		}
	}

	// 2. Perform lowering passes
	for (const program of programs) {
		if (!program?.decls) continue;

		for (const d of program.decls) {
			if (d.kind === "FuncDecl" || d.kind === "MethodDecl") {
				if (d.body) {
					const boxed = scanAddressTaken(d.body, new Set());
					res.boxedVars.set(d, boxed);
					res.ownership.set(d, new OwnershipContext(d.body));
					res.functions.set(d, {
						hasDefer: hasDefer(d.body),
						namedReturns: extractNamedReturns(d),
					});
					res.captures.set(d, analyzeCaptures(d));

					const escapingParams = new Set();
					for (const p of d.params ?? []) {
						if (p.name && p.name !== "_" && paramEscapes(d.body, p.name)) {
							escapingParams.add(p.name);
						}
					}
					res.escapes.set(d, escapingParams);
				}
			}
		}

		// Compute embedded stubs for structs
		if (checker) {
			for (const d of program.decls) {
				if (d.kind === "TypeDecl" && d.type?.kind === "StructType") {
					const methods = methodMap.get(d.name) ?? [];
					const stubs = computeEmbeddedStubs(d.name, methods, checker);
					res.embeddedStubs.set(d.name, stubs);
				}
			}
		}
	}

	// 3. Compute package-level global analysis
	const { neverAssignedGlobals, initPathFunctions, cachedGlobalsByFunc } =
		computeGlobalAnalysis(programs, checker);
	res.neverAssignedGlobals = neverAssignedGlobals;
	res.initPathFunctions = initPathFunctions;
	res.cachedGlobalsByFunc = cachedGlobalsByFunc;

	return res;
}
