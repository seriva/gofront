// src/lower/functions.js
// Analyzes function signatures, named returns and defer structures.

import { forEachChild, someChild } from "./walk.js";

export function extractNamedReturns(decl) {
	const named = decl?.returnType?._namedReturns;
	if (!named || named.length === 0) return null;
	return {
		entries: named, // [{ name, type }]
		names: named.map((r) => r.name).filter(Boolean),
	};
}

export function hasDefer(body) {
	if (!body) return false;
	if (body._hasDefer != null) return Boolean(body._hasDefer);

	const walk = (node) => {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) return node.some(walk);
		if (node.kind === "DeferStmt") return true;
		if (node.kind === "FuncLit") return false; // separate function boundary
		return someChild(node, walk);
	};

	return walk(body);
}

let defargCounter = 0;

/**
 * True when `body` contains a direct `recover()` call (not nested inside a
 * FuncLit).  Used to decide which functions may legitimately observe an
 * in-flight panic: Go only honours recover() when it is called directly by
 * a deferred function.
 */
export function hasDirectRecover(body) {
	if (!body) return false;
	if (body._hasDirectRecover != null) return Boolean(body._hasDirectRecover);
	const walk = (node) => {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) return node.some(walk);
		if (node.kind === "FuncLit") return false;
		if (
			node.kind === "CallExpr" &&
			node.func?.kind === "Ident" &&
			node.func.name === "recover"
		)
			return true;
		return someChild(node, walk);
	};
	const result = walk(body);
	body._hasDirectRecover = result;
	return result;
}

const BUILTIN_FUNC_NAMES = new Set([
	"println",
	"print",
	"panic",
	"recover",
	"make",
	"new",
	"len",
	"cap",
	"append",
	"copy",
	"delete",
	"close",
	"clear",
	"min",
	"max",
]);

export function normalizeDefers(programOrPrograms) {
	defargCounter = 0;
	const programs = Array.isArray(programOrPrograms)
		? programOrPrograms
		: [programOrPrograms];

	const pkgFuncNames = new Set(BUILTIN_FUNC_NAMES);
	// Package-level funcs/methods whose body calls recover() directly.  A
	// `defer f()` whose callee is one of these must keep recover armed when the
	// synthesized wrapper forwards the call.
	const recoverFuncs = new Set();
	for (const program of programs) {
		for (const d of program?.decls ?? []) {
			if (d.kind === "FuncDecl") pkgFuncNames.add(d.name);
			if (
				(d.kind === "FuncDecl" || d.kind === "MethodDecl") &&
				hasDirectRecover(d.body)
			)
				recoverFuncs.add(d.name);
		}
	}
	const ctx = { pkgFuncNames, recoverFuncs };

	for (const program of programs) {
		if (!program?.decls) continue;
		for (const d of program.decls) {
			if (d.body) normalizeBlockDefers(d.body, ctx);
		}
	}
}

function normalizeBlockDefers(node, ctx) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const item = node[i];
			if (item && item.kind === "DeferStmt") {
				const inserted = normalizeDeferStmt(item, node, i, ctx);
				i += inserted;
			} else {
				normalizeBlockDefers(item, ctx);
			}
		}
		return;
	}

	if (node.kind === "FuncLit") {
		normalizeBlockDefers(node.body, ctx);
		return;
	}

	forEachChild(node, (child) => normalizeBlockDefers(child, ctx));
}

// Does the deferred callee possibly call recover() directly?  Known package
// funcs/methods are looked up; unknown callees (closure variables, func
// values) are assumed to, so recover stays armed through the wrapper.
function deferCalleeMayRecover(funcExpr, ctx) {
	if (!ctx) return false;
	if (funcExpr.kind === "Ident") {
		if (BUILTIN_FUNC_NAMES.has(funcExpr.name)) return false;
		if (ctx.pkgFuncNames.has(funcExpr.name))
			return ctx.recoverFuncs.has(funcExpr.name);
		return true;
	}
	if (funcExpr.kind === "SelectorExpr") {
		if (funcExpr.expr?._type?.kind === "namespace") return false;
		return ctx.recoverFuncs.has(funcExpr.field);
	}
	if (funcExpr.kind === "FuncLit") return hasDirectRecover(funcExpr.body);
	return true;
}

function normalizeDeferStmt(stmt, parentList = null, index = -1, ctx = null) {
	if (stmt.call?.kind !== "CallExpr") return 0;
	const call = stmt.call;
	const isZeroArgFuncLit =
		call.func?.kind === "FuncLit" && (!call.args || call.args.length === 0);
	if (isZeroArgFuncLit) {
		// The FuncLit itself is the deferred function: recover() inside it is
		// honoured.
		call.func._isDeferTarget = true;
		normalizeBlockDefers(call.func.body, ctx);
		return 0;
	}
	const pkgFuncNames = ctx?.pkgFuncNames ?? null;

	const tempStmts = [];
	let funcExpr = call.func;

	// Hoist method receiver if call.func is a method call (e.g. defer r.Close()).
	// Skipped for pointer-receiver methods on an addressable (non-pointer)
	// operand: Go evaluates `&recv` at defer time, so the deferred call must
	// observe later mutations of the original variable — copying the struct
	// into a temp would break that.  The receiver expression itself is then
	// re-evaluated at run time, which matches Go for the common `defer x.M()`
	// / `defer s.f.M()` cases.
	const recvIsAddressableValue =
		call.func?._type?._ptrRecv === true &&
		call.func.expr?._type?.kind !== "pointer";
	if (
		parentList &&
		index >= 0 &&
		call.func?.kind === "SelectorExpr" &&
		call.func.expr?._type?.kind !== "namespace" &&
		!recvIsAddressableValue
	) {
		const recv = call.func.expr;
		defargCounter++;
		const recvName = `__defrecv$${defargCounter}`;
		const recvIdent = {
			kind: "Ident",
			name: recvName,
			_type: recv._type,
		};
		tempStmts.push({
			kind: "DefineStmt",
			lhs: [{ kind: "Ident", name: recvName, _type: recv._type }],
			rhs: [recv],
		});
		funcExpr = {
			...call.func,
			expr: recvIdent,
		};
	} else if (
		parentList &&
		index >= 0 &&
		call.func?.kind === "Ident" &&
		pkgFuncNames &&
		!pkgFuncNames.has(call.func.name)
	) {
		// Hoist local function variable (e.g. fn := f1; defer fn(); fn = f2)
		defargCounter++;
		const fnName = `__deffn$${defargCounter}`;
		const fnIdent = {
			kind: "Ident",
			name: fnName,
			_type: call.func._type,
		};
		tempStmts.push({
			kind: "DefineStmt",
			lhs: [{ kind: "Ident", name: fnName, _type: call.func._type }],
			rhs: [call.func],
		});
		funcExpr = fnIdent;
	}

	const args = call.args ?? [];
	const tempIdents = [];

	if (parentList && index >= 0 && args.length > 0) {
		for (let a = 0; a < args.length; a++) {
			const arg = args[a];
			if (arg._type?.kind === "tuple" && Array.isArray(arg._type.types)) {
				const tupleTypes = arg._type.types;
				const tupleLhs = [];
				for (let t = 0; t < tupleTypes.length; t++) {
					defargCounter++;
					const tempName = `__defarg$${defargCounter}`;
					const ident = {
						kind: "Ident",
						name: tempName,
						_type: tupleTypes[t],
					};
					tempIdents.push(ident);
					tupleLhs.push(ident);
				}
				tempStmts.push({
					kind: "DefineStmt",
					lhs: tupleLhs,
					rhs: [arg],
				});
			} else {
				defargCounter++;
				const tempName = `__defarg$${defargCounter}`;
				tempIdents.push({
					kind: "Ident",
					name: tempName,
					_type: arg._type,
				});
				tempStmts.push({
					kind: "DefineStmt",
					lhs: [{ kind: "Ident", name: tempName, _type: arg._type }],
					rhs: [arg],
				});
			}
		}
	}

	if (parentList && index >= 0 && tempStmts.length > 0) {
		parentList.splice(index, 0, ...tempStmts);
	}

	const callArgs = tempIdents.length > 0 ? tempIdents : args;
	const innerCall = {
		...call,
		func: funcExpr,
		args: callArgs,
		_multiForward: tempIdents.length > 0 ? false : call._multiForward,
	};
	const synthFuncLit = {
		kind: "FuncLit",
		params: [],
		returnType: null,
		body: {
			kind: "Block",
			stmts: [{ kind: "ExprStmt", expr: innerCall }],
			list: [{ kind: "ExprStmt", expr: innerCall }],
			_hasDefer: false,
		},
		_type: { kind: "FuncType", params: [], returnType: null },
		_isDeferTarget: true,
		// The wrapper only forwards to the real deferred callee; when that
		// callee may call recover() directly, recover must stay armed across
		// the wrapper frame.
		_deferForward: deferCalleeMayRecover(call.func, ctx),
	};
	if (call.func?.kind === "FuncLit") normalizeBlockDefers(call.func.body, ctx);
	stmt.call = {
		kind: "CallExpr",
		func: synthFuncLit,
		args: [],
		_type: { kind: "basic", name: "void" },
	};

	return tempStmts.length;
}
