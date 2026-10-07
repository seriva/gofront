// src/lower/functions.js
// Analyzes function signatures, named returns and defer structures.

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
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (walk(node[key])) return true;
		}
		return false;
	};

	return walk(body);
}

let defargCounter = 0;

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
	for (const program of programs) {
		for (const d of program?.decls ?? []) {
			if (d.kind === "FuncDecl") pkgFuncNames.add(d.name);
		}
	}

	for (const program of programs) {
		if (!program?.decls) continue;
		for (const d of program.decls) {
			if (d.body) normalizeBlockDefers(d.body, pkgFuncNames);
		}
	}
}

function normalizeBlockDefers(node, pkgFuncNames) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const item = node[i];
			if (item && item.kind === "DeferStmt") {
				const inserted = normalizeDeferStmt(item, node, i, pkgFuncNames);
				i += inserted;
			} else {
				normalizeBlockDefers(item, pkgFuncNames);
			}
		}
		return;
	}

	if (node.kind === "FuncLit") {
		normalizeBlockDefers(node.body, pkgFuncNames);
		return;
	}

	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		normalizeBlockDefers(node[key], pkgFuncNames);
	}
}

function normalizeDeferStmt(
	stmt,
	parentList = null,
	index = -1,
	pkgFuncNames = null,
) {
	if (stmt.call?.kind !== "CallExpr") return 0;
	const call = stmt.call;
	const isZeroArgFuncLit =
		call.func?.kind === "FuncLit" && (!call.args || call.args.length === 0);
	if (isZeroArgFuncLit) return 0;

	const tempStmts = [];
	let funcExpr = call.func;

	// Hoist method receiver if call.func is a method call (e.g. defer r.Close())
	if (
		parentList &&
		index >= 0 &&
		call.func?.kind === "SelectorExpr" &&
		call.func.expr?._type?.kind !== "namespace"
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
	};
	stmt.call = {
		kind: "CallExpr",
		func: synthFuncLit,
		args: [],
		_type: { kind: "basic", name: "void" },
	};

	return tempStmts.length;
}
