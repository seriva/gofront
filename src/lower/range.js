// src/lower/range.js
// Classifies for-range loop shapes and variable scoping/redelcarations.

import { isNumeric } from "../typechecker/types.js";
import { someChild } from "./walk.js";

export function isRangeFor(stmt) {
	if (!stmt?.init) return false;
	const init = stmt.init;
	if (init.kind !== "DefineStmt" && init.kind !== "AssignStmt") return false;
	return init.rhs?.[0]?.kind === "RangeExpr";
}

export function isIntRangeType(iterType) {
	return isNumeric(iterType);
}

export function isMapRangeType(iterType) {
	return (
		iterType?.kind === "map" ||
		(iterType?.kind === "named" && iterType.underlying?.kind === "map")
	);
}

export function isStringRangeType(iterType) {
	return (
		(iterType?.kind === "basic" && iterType.name === "string") ||
		(iterType?.kind === "untyped" && iterType.base === "string")
	);
}

// True when `node` contains an assignment or ++/-- targeting identifier `name`.
export function nodeAssigns(node, name) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node)) return node.some((n) => nodeAssigns(n, name));
	if (
		(node.kind === "AssignStmt" &&
			node.lhs.some((e) => e.kind === "Ident" && e.name === name)) ||
		(node.kind === "IncDecStmt" &&
			node.expr.kind === "Ident" &&
			node.expr.name === name)
	)
		return true;
	return someChild(node, (child) => nodeAssigns(child, name));
}

// True when the body re-declares one of `names` at its top level (legal Go shadowing).
export function bodyRedeclares(body, names) {
	if (!names || names.length === 0) return false;
	for (const s of body?.stmts ?? []) {
		if (s.kind === "DefineStmt" && s.lhs.some((e) => names.includes(e.name)))
			return true;
		if (
			(s.kind === "VarDecl" || s.kind === "ConstDecl") &&
			s.decls?.some((d) => d.names?.some((n) => names.includes(n)))
		)
			return true;
	}
	return false;
}

// Whether `for i := range n` can be emitted as a plain `for (let i = 0; …)` without hidden registers.
export function isSimpleIntRange(stmt, name, isAssign, boxedVars = new Set()) {
	if (isAssign) return false;
	if (!name || name === "_") return true;
	return !boxedVars.has(name) && !nodeAssigns(stmt.body, name);
}
