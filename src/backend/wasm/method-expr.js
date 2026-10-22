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

function forwardingFuncLit(sel) {
	const fnType = sel._type;
	const [recvType, ...paramTypes] = fnType.params;
	const params = [
		{ name: "recv$", type: typeToTypeNode(recvType) },
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
	const call = methodCall(sel, ident("recv$", recvType, sel), args, fnType);
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
	}
	const params = fnType.params ?? [];
	const inner = forwardingFuncLit({
		...sel,
		_type: { ...fnType, params: [recvType, ...params] },
	});
	// The receiver is the outer parameter; the inner literal takes the rest.
	inner.params = inner.params.slice(1);
	inner._type = fnType;
	const outerType = { kind: "func", params: [recvType], returns: [fnType] };
	return {
		kind: "CallExpr",
		func: {
			kind: "FuncLit",
			params: [{ name: "recv$", type: typeToTypeNode(recvType) }],
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

function rewrite(node, isCallee) {
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
export function desugarMethodExprs(node) {
	if (!node || typeof node !== "object") return false;
	let changed = false;
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const r = rewrite(node[i]);
			if (r) {
				node[i] = r;
				changed = true;
			}
			changed = desugarMethodExprs(node[i]) || changed;
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
		changed = desugarMethodExprs(node[key]) || changed;
	}
	return changed;
}
