// src/lower/escape.js
// Analyzes pointer retention / escaping for arguments across the WASM boundary.
// In GoFront's hybrid model, `*T` where T is a `both` type (e.g. `*mathx.Vec3`) uses
// copy-in/copy-out per call. If the WASM side retains the pointer beyond the call,
// it is flagged as an escape error.

import { collectDeclaredNames } from "./captures.js";
import { rootIdentName } from "./ownership.js";

/**
 * Checks whether an expression evaluates to one of the target pointer variables
 * (or an interior pointer into them).
 *
 * @param {Object} expr AST expression node
 * @param {Set<string>} targetNames Set of identifier names being tracked
 * @returns {boolean}
 */
export function evaluatesToPointer(expr, targetNames) {
	if (!expr || typeof expr !== "object") return false;
	if (expr.kind === "Ident") {
		return targetNames.has(expr.name);
	}
	if (expr.kind === "ParenExpr" || expr.kind === "TypeAssertExpr") {
		return evaluatesToPointer(expr.expr, targetNames);
	}
	// Type conversions: (*Vec3)(p)
	if (expr.kind === "CallExpr" && expr.args?.length === 1) {
		return evaluatesToPointer(expr.args[0], targetNames);
	}
	// Interior pointer: &p.Field or &p[i] retains a pointer into p, or &CompositeLit holding p
	if (expr.kind === "UnaryExpr" && expr.op === "&") {
		const root = rootIdentName(expr.operand);
		if (root != null && targetNames.has(root)) return true;
		return evaluatesToPointer(expr.operand, targetNames);
	}
	// Composite literal holding pointer: Holder{ P: p } or []*Vec{ p }
	if (expr.kind === "CompositeLit") {
		for (const elem of expr.elems ?? []) {
			const val = elem.kind === "KeyValueExpr" ? elem.value : elem;
			if (evaluatesToPointer(val, targetNames)) return true;
		}
	}
	return false;
}

/**
 * Checks if a parameter identifier escapes or is retained in `body`.
 * A parameter `name` is considered retained if it:
 * - is returned from the function
 * - is assigned to a package global or external object field
 * - is stored into a struct field or slice/map element (e.g., `obj.field = p`, `arr[i] = p`)
 * - is captured by a closure that outlives or is returned from the function
 *
 * @param {Object} body AST block of the function
 * @param {string} paramName Name of the parameter to check
 * @returns {boolean} True if param escapes/is retained, false if only used locally in-place
 */
export function paramEscapes(body, paramName) {
	if (!body || !paramName || paramName === "_") return false;

	const aliases = new Set([paramName]);
	const localNames = new Set([paramName]);
	collectDeclaredNames(body, localNames);

	let escapes = false;

	const walk = (node) => {
		if (escapes || !node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}

		// 1. Returning the pointer
		if (node.kind === "ReturnStmt") {
			for (const res of node.values ?? node.results ?? []) {
				if (evaluatesToPointer(res, aliases)) {
					escapes = true;
					return;
				}
			}
		}

		// 2. Assigning the pointer:
		// Storing into a field, index, or package-level global escapes.
		// Storing into a local variable aliases the pointer.
		if (node.kind === "AssignStmt") {
			for (let i = 0; i < node.lhs.length; i++) {
				const lhs = node.lhs[i];
				const rhs = node.rhs?.[i];
				if (!rhs) continue;
				if (evaluatesToPointer(rhs, aliases)) {
					// Storing into a field or index: `target.field = p` or `arr[i] = p`
					if (lhs.kind === "SelectorExpr" || lhs.kind === "IndexExpr") {
						escapes = true;
						return;
					}
					// If LHS is not a local variable declared in body, it's package-level / global
					if (lhs.kind === "Ident") {
						if (!localNames.has(lhs.name)) {
							escapes = true;
							return;
						}
						aliases.add(lhs.name);
					}
				}
			}
		}

		// 3. Short variable definition: local alias `tmp := p`
		if (node.kind === "DefineStmt") {
			for (let i = 0; i < node.lhs.length; i++) {
				const lhs = node.lhs[i];
				const rhs = node.rhs?.[i];
				if (rhs && evaluatesToPointer(rhs, aliases)) {
					if (lhs.kind === "Ident") {
						aliases.add(lhs.name);
					}
				}
			}
		}

		// 4. Storing into append call: `slice = append(slice, p)`
		const fnName = node.func?.name ?? node.fun?.name;
		if (node.kind === "CallExpr" && fnName === "append") {
			for (const arg of node.args?.slice(1) ?? []) {
				if (evaluatesToPointer(arg, aliases)) {
					escapes = true;
					return;
				}
			}
		}

		// 5. Storing into a closure (FuncLit)
		if (node.kind === "FuncLit") {
			let captured = false;
			const checkClosure = (cNode) => {
				if (captured || !cNode || typeof cNode !== "object") return;
				if (Array.isArray(cNode)) {
					for (const item of cNode) checkClosure(item);
					return;
				}
				if (cNode.kind === "Ident" && aliases.has(cNode.name)) {
					captured = true;
					return;
				}
				for (const k of Object.keys(cNode)) {
					if (k.startsWith("_")) continue;
					checkClosure(cNode[k]);
				}
			};
			checkClosure(node.body);
			if (captured) {
				escapes = true;
				return;
			}
			// Do not descend redundantly into closure body
			return;
		}

		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			walk(node[key]);
		}
	};

	walk(body);
	return escapes;
}
