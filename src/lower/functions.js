// src/lower/functions.js
// Analyzes function signatures, named returns and defer structures.

import { forEachChild, hasCallOrReceive, someChild } from "./walk.js";

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

// A constant argument (`2.5`, `"a"`, `nil`, `k` for a constant `k`, `-1`)
// has no value to capture at the `defer` statement, so it stays in the
// deferred call, where it takes the callee's parameter type exactly as in a
// direct call.  Hoisting it into a temporary would default its type (`float64`,
// `int`) and reject a defined-type, interface, pointer or generic parameter.
function isDeferConstant(arg) {
	if (arg?.kind === "BasicLit" && arg.litKind === "NIL") return true;
	if (arg?._type?.kind !== "untyped") return false;
	if (arg._const) return true;
	switch (arg.kind) {
		case "BasicLit":
		case "ImagLit":
			return true;
		case "ParenExpr":
			return isDeferConstant(arg.expr);
		case "UnaryExpr":
			return isDeferConstant(arg.operand);
		case "BinaryExpr":
			return isDeferConstant(arg.left) && isDeferConstant(arg.right);
		default:
			return false;
	}
}

// A package-level basic or defined type a temporary can be declared with by
// its name; other parameter types (qualified, generic, composite) are not
// hoisted with a declared type.
function isNamedScalarParam(t) {
	if (t?.kind === "basic")
		return t.name !== "any" && /^[A-Za-z_]\w*$/.test(t.name ?? "");
	return (
		t?.kind === "named" &&
		t.underlying?.kind === "basic" &&
		!t.typeArgs?.length &&
		/^[A-Za-z_]\w*$/.test(t.name ?? "")
	);
}

// A non-constant untyped expression (`1 << n`) the typechecker already gave
// its parameter's type: it is still untyped when the lowered code is checked
// again, so its temporary needs that type declared.
function isRetypedUntyped(e) {
	if (!e || e._const) return false;
	switch (e.kind) {
		case "ParenExpr":
			return isRetypedUntyped(e.expr);
		case "UnaryExpr":
			return isRetypedUntyped(e.operand);
		case "BinaryExpr":
			if (e.op === "<<" || e.op === ">>") return Boolean(e.left?._const);
			return isRetypedUntyped(e.left) || isRetypedUntyped(e.right);
		default:
			return false;
	}
}

// The type of the temporary that holds deferred argument `a`: an untyped
// non-constant value (a shift, a comparison) takes its basic or defined
// scalar parameter's type, as it does in a direct call.  A variadic call's
// trailing arguments take the element type.
function deferTempType(funcType, a, arg) {
	const argType = arg._type;
	if (argType?.kind !== "untyped" && !isRetypedUntyped(arg)) return argType;
	const params = funcType?.params;
	let param = params?.[a];
	if (funcType?.variadic && a >= params.length - 1) {
		// The last parameter's type is the element type (a slice only when
		// a table spells it that way).
		param = params[params.length - 1];
		if (!isNamedScalarParam(param)) param = param?.elem;
	}
	return isNamedScalarParam(param) ? param : argType;
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
			} else if (isDeferConstant(arg)) {
				tempIdents.push(arg);
			} else {
				defargCounter++;
				const tempName = `__defarg$${defargCounter}`;
				const tempType = deferTempType(call.func?._type, a, arg);
				tempIdents.push({
					kind: "Ident",
					name: tempName,
					_type: tempType,
					// A spread argument stays one: the call gets the slice itself.
					...(arg._spread && { _spread: true }),
				});
				tempStmts.push(
					tempType === arg._type &&
						!(isRetypedUntyped(arg) && isNamedScalarParam(tempType))
						? {
								kind: "DefineStmt",
								lhs: [{ kind: "Ident", name: tempName, _type: tempType }],
								rhs: [arg],
							}
						: {
								// Declared with the parameter's type so the lowered code
								// type-checks again with the constant converted.
								kind: "VarDecl",
								decls: [
									{
										names: [tempName],
										type: { kind: "TypeName", name: tempType.name },
										value: [arg],
									},
								],
							},
				);
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
		// A deferred native call runs the Go body, as on the JS backend.
		_noNative: true,
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

let fwdCounter = 0;

/**
 * Splits a multi-value call forwarded into interfaces into temps:
 * `return f()` where some result is an interface becomes
 * `__fwd$1, __fwd$2 := f(); return __fwd$1, __fwd$2`, and `g(f())` where
 * some parameter is an interface becomes `…; g(__fwd$1, __fwd$2)`.  The
 * typechecker records per-element interface-box marks in `call._fwdIface`;
 * each temp takes its element's marks, so both backends box it through their
 * ordinary per-value path.  Forwards with no interface element are left alone.
 *
 * `g(f())` is split only as the operand of a statement (expression
 * statement, single-value `:=`/`=`/`var`/`return`) whose callee evaluates
 * no call, so hoisting `f()` keeps Go's evaluation order.
 */
export function splitForwardedTuples(programOrPrograms) {
	fwdCounter = 0;
	const programs = Array.isArray(programOrPrograms)
		? programOrPrograms
		: [programOrPrograms];
	for (const program of programs)
		for (const d of program?.decls ?? []) splitForwardsIn(d);
}

function splitForwardsIn(node) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const item = node[i];
			splitForwardsIn(item);
			const defines = splitForwardsInStmt(item);
			node.splice(i, 0, ...defines);
			i += defines.length;
		}
		return;
	}
	forEachChild(node, splitForwardsIn);
}

// The `:=` statements to insert before `stmt` (in order) after rewriting its
// forwarded calls to read the temps.
function splitForwardsInStmt(stmt) {
	const defines = [];
	const operand = statementOperand(stmt);
	if (
		operand?.kind === "CallExpr" &&
		operand._multiForward &&
		operand.args?.length === 1 &&
		!hasCallOrReceive(operand.func)
	) {
		const split = forwardTemps(operand.args[0]);
		if (split) {
			operand.args = split.operands;
			operand._multiForward = false;
			defines.push(split.define);
		}
	}
	if (stmt?.kind === "ReturnStmt") {
		const define = splitForwardedReturn(stmt);
		if (define) defines.push(define);
	}
	return defines;
}

// The single expression a statement evaluates last, or null.
function statementOperand(stmt) {
	switch (stmt?.kind) {
		case "ExprStmt":
			return stmt.expr;
		case "DefineStmt":
		case "AssignStmt":
			return stmt.rhs?.length === 1 &&
				stmt.lhs?.every((e) => e.kind === "Ident")
				? stmt.rhs[0]
				: null;
		case "ReturnStmt":
			return stmt.values?.length === 1 ? stmt.values[0] : null;
		case "VarDecl":
			return stmt.decls?.length === 1 && stmt.decls[0].value?.length === 1
				? stmt.decls[0].value[0]
				: null;
		default:
			return null;
	}
}

// Splits one forwarded call into temps: returns the `:=` statement defining
// them and the operand idents (carrying each element's interface-box marks),
// or null when the call needs no split.
function forwardTemps(call) {
	const holders = call?._fwdIface;
	const types = call?._type?.types;
	if (!holders || !Array.isArray(types) || types.length !== holders.length)
		return null;
	const names = types.map(() => `__fwd$${++fwdCounter}`);
	const define = {
		kind: "DefineStmt",
		lhs: names.map((name, i) => ({ kind: "Ident", name, _type: types[i] })),
		rhs: [call],
	};
	// The call is no longer a forward; a cached AST must not split it again.
	call._fwdIface = undefined;
	const operands = names.map((name, i) => ({
		kind: "Ident",
		name,
		_type: types[i],
		...holders[i],
	}));
	return { define, operands };
}

function splitForwardedReturn(stmt) {
	if (stmt.values?.length !== 1) return null;
	const split = forwardTemps(stmt.values[0]);
	if (!split) return null;
	stmt.values = split.operands;
	if (Array.isArray(stmt._types))
		stmt._types = split.operands.map((o) => o._type);
	return split.define;
}
