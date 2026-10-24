// src/backend/wasm/method-expr.js
// Method expressions (`T.M`, `(*T).M`) and method values (`x.M`) in WASM.
// A call through a method expression, `(*T).M(p, a)`, becomes the ordinary
// method call `p.M(a)`.  Any other use becomes a func literal that forwards
// to the method, `func(recv *T, a0 A) R { return recv.M(a0) }`, which the
// closure lifting then emits like any other func value.  A method value
// binds its receiver when it is evaluated (copying a value receiver, taking
// the address of an addressable one for a pointer receiver):
// `func(recv$ *T) func(A) R { return func(a0 A) R { return recv$.M(a0) } }(&x)`.  Runs after monomorphisation, so the
// receiver and method types are concrete, on the WASM pipeline's own copy of
// the programs.

import { typeToTypeNode as toNode } from "./monomorph.js";

// Func types stay semantic types: `typeToTypeNode` has no func form and
// would turn them into `any`.
function typeToTypeNode(t) {
	return t?.kind === "func" ? t : toNode(t);
}

function isVoid(t) {
	return !t || (t.kind === "basic" && t.name === "void");
}

function returnTypeNode(t) {
	if (isVoid(t)) return null;
	if (t.kind === "tuple")
		return { kind: "TupleType", types: t.types.map(typeToTypeNode) };
	return typeToTypeNode(t);
}

function ident(name, type, at) {
	return { kind: "Ident", name, _type: type, _line: at._line, _col: at._col };
}

// `recv.M(args)` for the method expression `sel` (type `func(recv, …)`).
function methodCall(sel, recvExpr, args, fnType) {
	const result = fnType.returns?.[0];
	return {
		kind: "CallExpr",
		func: {
			kind: "SelectorExpr",
			expr: recvExpr,
			field: sel.field,
			_type: {
				kind: "func",
				params: fnType.params.slice(1),
				returns: fnType.returns,
				variadic: fnType.variadic,
			},
			_line: sel._line,
			_col: sel._col,
		},
		args,
		_type: isVoid(result) ? { kind: "basic", name: "void" } : result,
		_line: sel._line,
		_col: sel._col,
	};
}

// Each method value's outer literal gets its own receiver name: captures are
// resolved by name, so two method values of different receiver types in one
// function must not share `recv$`.
let recvCounter = 0;
let bundled = null;

function forwardingFuncLit(sel, recvName = "recv$") {
	const fnType = sel._type;
	const [recvType, ...paramTypes] = fnType.params;
	const params = [
		{ name: recvName, type: typeToTypeNode(recvType) },
		...paramTypes.map((t, i) => ({
			name: `a$${i}`,
			type: typeToTypeNode(t),
			variadic: fnType.variadic && i === paramTypes.length - 1,
		})),
	];
	const args = paramTypes.map((t, i) => {
		const a = ident(`a$${i}`, t, sel);
		if (fnType.variadic && i === paramTypes.length - 1) a._spread = true;
		return a;
	});
	const call = methodCall(sel, ident(recvName, recvType, sel), args, fnType);
	const result = fnType.returns?.[0];
	const stmts = isVoid(result)
		? [{ kind: "ExprStmt", expr: call }]
		: [{ kind: "ReturnStmt", values: [call] }];
	return {
		kind: "FuncLit",
		params,
		returnType: returnTypeNode(result),
		body: { kind: "Block", stmts },
		_type: fnType,
		_line: sel._line,
		_col: sel._col,
	};
}

function methodValueLit(sel) {
	const fnType = sel._type;
	let recvType = sel.expr._type;
	let recvArg = sel.expr;
	if (fnType._ptrRecv && recvType?.kind !== "pointer") {
		recvType = { kind: "pointer", base: recvType };
		recvArg = {
			kind: "UnaryExpr",
			op: "&",
			operand: sel.expr,
			_type: recvType,
			_line: sel._line,
			_col: sel._col,
		};
	} else if (sel._derefRecv && recvType?.kind === "pointer") {
		// `p.M` with a value receiver binds a copy of `*p` now.
		recvType = recvType.base;
		recvArg = {
			kind: "UnaryExpr",
			op: "*",
			operand: sel.expr,
			_type: recvType,
			_line: sel._line,
			_col: sel._col,
		};
	}
	const params = fnType.params ?? [];
	const recvName = `recv$${recvCounter++}`;
	const inner = forwardingFuncLit(
		{
			...sel,
			_type: { ...fnType, params: [recvType, ...params] },
		},
		recvName,
	);
	// The receiver is the outer parameter; the inner literal takes the rest.
	inner.params = inner.params.slice(1);
	inner._type = fnType;
	const outerType = { kind: "func", params: [recvType], returns: [fnType] };
	return {
		kind: "CallExpr",
		func: {
			kind: "FuncLit",
			params: [{ name: recvName, type: typeToTypeNode(recvType) }],
			returnType: typeToTypeNode(fnType),
			body: {
				kind: "Block",
				stmts: [{ kind: "ReturnStmt", values: [inner] }],
			},
			_type: outerType,
			_line: sel._line,
			_col: sel._col,
		},
		args: [recvArg],
		_type: fnType,
		_line: sel._line,
		_col: sel._col,
	};
}

// True for a stdlib function used as a value: `pkg.Fn` on an imported
// package that is not bundled GoFront source (those resolve as plain
// functions), with a concrete (non-generic) func type.
function isStdlibFuncValue(node) {
	if (node?.kind !== "SelectorExpr" || node._type?.kind !== "func")
		return false;
	const ns = node.expr;
	if (ns?.kind !== "Ident" || ns._type?.kind !== "namespace") return false;
	return !bundled?.has(ns.name) && !hasTypeParam(node._type);
}

function hasTypeParam(t) {
	const text = JSON.stringify([t.params, t.returns], (k, v) =>
		k.startsWith("_") || k === "underlying" ? undefined : v,
	);
	return text.includes('"typeParam"') || text.includes('"typeparam"');
}

// Largest number of variadic operands a forwarded stdlib function value
// accepts: stdlib emitters take their operands unpacked, so the forwarder
// dispatches on the operand count.
const MAX_FORWARDED_VARIADIC = 8;

const INT_TYPE = { kind: "basic", name: "int" };

function intLit(n, at) {
	return {
		kind: "BasicLit",
		litKind: "INT",
		value: String(n),
		_type: INT_TYPE,
		_line: at._line,
		_col: at._col,
	};
}

function lineInfo(at) {
	return { _line: at._line, _col: at._col };
}

function typedCall(func, args, type, at) {
	return { kind: "CallExpr", func, args, _type: type, ...lineInfo(at) };
}

// The statements calling `sel(args)` and returning its result.
function callStmts(sel, args) {
	const result = sel._type.returns?.[0];
	const type = isVoid(result) ? { kind: "basic", name: "void" } : result;
	const call = typedCall(sel, args, type, sel);
	return isVoid(result)
		? [
				{ kind: "ExprStmt", expr: call },
				{ kind: "ReturnStmt", values: [] },
			]
		: [{ kind: "ReturnStmt", values: [call] }];
}

// `if len(rest) == k { return pkg.Fn(fixed..., rest[0..k-1]) }` for one k.
function operandCountBranch(sel, fixed, rest, elemType, k) {
	const at = sel;
	const elems = Array.from({ length: k }, (_, i) => ({
		kind: "IndexExpr",
		expr: rest,
		index: intLit(i, at),
		_type: elemType,
		...lineInfo(at),
	}));
	const len = typedCall(ident("len", null, at), [rest], INT_TYPE, at);
	const body = callStmts(sel, [...fixed, ...elems]);
	return {
		kind: "IfStmt",
		init: null,
		cond: {
			kind: "BinaryExpr",
			left: len,
			op: "==",
			right: intLit(k, at),
			_type: { kind: "basic", name: "bool" },
			...lineInfo(at),
		},
		body: { kind: "Block", stmts: body, list: body },
		elseBody: null,
	};
}

function tooManyOperands(sel) {
	const msg = {
		kind: "BasicLit",
		litKind: "STRING",
		value: `too many arguments in call to ${sel.expr.name}.${sel.field}`,
		_type: { kind: "basic", name: "string" },
	};
	const panic = typedCall(
		ident("panic", null, sel),
		[msg],
		{ kind: "basic", name: "void" },
		sel,
	);
	return [{ kind: "ExprStmt", expr: panic }];
}

function variadicDispatch(sel, fixed, elemType) {
	const rest = ident(
		`a$${fixed.length}`,
		{ kind: "slice", elem: elemType },
		sel,
	);
	const stmts = [];
	for (let k = 0; k <= MAX_FORWARDED_VARIADIC; k++)
		stmts.push(operandCountBranch(sel, fixed, rest, elemType, k));
	return [...stmts, ...tooManyOperands(sel)];
}

// `func(a0 A, a1 B) R { return pkg.Fn(a0, a1) }` for the stdlib function
// value `pkg.Fn`.  A variadic one dispatches on the operand count:
// `if len(rest) == 0 { return pkg.Fn(a0) }; if len(rest) == 1 { ... }`.
function stdlibFuncLit(sel) {
	const fnType = sel._type;
	const ps = fnType.params ?? [];
	const nFixed = fnType.variadic ? ps.length - 1 : ps.length;
	const params = ps.map((t, i) => ({
		name: `a$${i}`,
		type: typeToTypeNode(t),
		variadic: i === nFixed,
	}));
	const fixed = ps.slice(0, nFixed).map((t, i) => ident(`a$${i}`, t, sel));
	const stmts = fnType.variadic
		? variadicDispatch(sel, fixed, ps[nFixed])
		: callStmts(sel, fixed);
	return {
		kind: "FuncLit",
		params,
		returnType: returnTypeNode(fnType.returns?.[0]),
		body: { kind: "Block", stmts, list: stmts },
		_type: fnType,
		...lineInfo(sel),
	};
}

function rewrite(node, isCallee) {
	return rewriteMethods(node, isCallee) ?? rewriteStdlibValue(node, isCallee);
}

function rewriteStdlibValue(node, isCallee) {
	return !isCallee && isStdlibFuncValue(node) ? stdlibFuncLit(node) : null;
}

function rewriteMethods(node, isCallee) {
	if (node?.kind === "SelectorExpr" && node._isMethodExpr && node._type)
		return forwardingFuncLit(node);
	if (
		node?.kind === "SelectorExpr" &&
		node._isMethodValue &&
		node._type?.kind === "func" &&
		!isCallee
	)
		return methodValueLit(node);
	if (
		node?.kind === "CallExpr" &&
		node.func?.kind === "SelectorExpr" &&
		node.func._isMethodExpr &&
		node.func._type &&
		node.args?.length > 0 &&
		!node._multiForward
	) {
		const [recv, ...rest] = node.args;
		const call = methodCall(node.func, recv, rest, node.func._type);
		call._type = node._type;
		return call;
	}
	return null;
}

/** Rewrites method expressions in place; true if anything changed. */
export function desugarMethodExprs(node, bundledPackages = null) {
	recvCounter = 0;
	bundled = bundledPackages;
	return desugar(node);
}

function desugar(node) {
	if (!node || typeof node !== "object") return false;
	let changed = false;
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const r = rewrite(node[i]);
			if (r) {
				node[i] = r;
				changed = true;
			}
			changed = desugar(node[i]) || changed;
		}
		return changed;
	}
	for (const key of Object.keys(node)) {
		if (key.charCodeAt(0) === 95) continue; // "_" side tables
		const r = rewrite(node[key], node.kind === "CallExpr" && key === "func");
		if (r) {
			node[key] = r;
			changed = true;
		}
		changed = desugar(node[key]) || changed;
	}
	return changed;
}
