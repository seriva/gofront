// src/lower/range.js
// Classifies for-range loop shapes and variable scoping/redelcarations.

import { isNumeric, iteratorYieldParams } from "../typechecker/types.js";
import { someChild } from "./walk.js";

let iterStateCounter = 0;

export function isIteratorRangeFor(stmt) {
	if (stmt?.kind !== "ForStmt") return false;
	const rangeExpr =
		stmt.cond?.kind === "RangeExpr" ? stmt.cond : stmt.init?.rhs?.[0];
	if (rangeExpr?.kind !== "RangeExpr") return false;
	if (rangeExpr._isIterator) return true;
	const iterType = rangeExpr.expr?._type;
	return Boolean(iteratorYieldParams(iterType));
}

function buildYieldParamsAndAssignments(lhs, yieldTypes, isAssign) {
	const params = [];
	const assignStmts = [];
	for (let i = 0; i < yieldTypes.length; i++) {
		const yType = yieldTypes[i] ?? { kind: "basic", name: "any" };
		const lhsElem = lhs[i];
		if (!isAssign && lhsElem?.name && lhsElem.name !== "_") {
			params.push({ name: lhsElem.name, type: yType });
		} else {
			const paramName = `__yield_p${i}`;
			params.push({ name: paramName, type: yType });
			if (isAssign && lhsElem && lhsElem.name !== "_") {
				assignStmts.push({
					kind: "AssignStmt",
					lhs: [lhsElem],
					rhs: [{ kind: "Ident", name: paramName, _type: yType }],
					op: "=",
				});
			}
		}
	}
	return { params, assignStmts };
}

export function getOrCreateIteratorFuncLit(stmt) {
	if (stmt._yieldFuncLit) return stmt._yieldFuncLit;

	const rangeExpr =
		stmt.cond?.kind === "RangeExpr" ? stmt.cond : stmt.init?.rhs?.[0];
	const iterType = rangeExpr?.expr?._type;
	const info = iteratorYieldParams(iterType);
	const yieldTypes = rangeExpr?._yieldParams ?? info?.yieldParams ?? [];

	if (!stmt._iterStateName) {
		stmt._iterStateName = `__iterState$${++iterStateCounter}`;
	}

	const isAssign = stmt.init?.kind === "AssignStmt";
	const lhs = stmt.init?.lhs ?? [];
	const { params, assignStmts } = buildYieldParamsAndAssignments(
		lhs,
		yieldTypes,
		isAssign,
	);

	const rawStmts = stmt.body?.stmts ?? stmt.body?.list ?? [];
	const bodyStmts =
		assignStmts.length > 0 ? [...assignStmts, ...rawStmts] : rawStmts;

	const funcLit = {
		kind: "FuncLit",
		params,
		returnType: { kind: "basic", name: "bool" },
		body: {
			kind: "Block",
			stmts: bodyStmts,
			list: bodyStmts,
		},
		_type: {
			kind: "func",
			params: params.map((p) => p.type),
			returns: [{ kind: "basic", name: "bool" }],
		},
		_isYieldClosure: true,
		_iterStateName: stmt._iterStateName,
		_forStmt: stmt,
		_line: stmt._line,
	};

	stmt._yieldFuncLit = funcLit;
	return funcLit;
}

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
