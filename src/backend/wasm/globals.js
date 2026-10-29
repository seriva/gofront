// src/backend/wasm/globals.js
// Package-level constants and variables: constant folding, zero values and the
// synthesised `__init_globals` start function; plus interface dispatcher synthesis.

import { foldConstExpr } from "../../typechecker/const-fold.js";
import { orderPackageInits } from "../../typechecker/init-order.js";
import { _someNode } from "./prescan.js";
import { isStructType, toWasmType, variadicAsSlice } from "./types.js";

// Package-level `const` declarations (iota is already substituted by the
// parser).  Literals and expressions the folder can reduce become BasicLits in
// `constCache`; whatever is left is recorded in `nonLiteralConsts` and later
// becomes a global initialised by the start function.
export function _collectPackageConsts(progs, mod, checker = null) {
	const entries = [];
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind !== "ConstDecl") continue;
			for (const spec of d.decls ?? []) {
				for (let i = 0; i < spec.names.length; i++) {
					if (spec.value?.[i])
						entries.push({
							name: spec.names[i],
							expr: spec.value[i],
							filename: p._filename,
							source: p._source,
						});
				}
			}
		}
	}
	const resolve = (name) => mod.constCache.get(name) ?? null;
	// Iterate to a fixpoint so a constant may refer to one declared later.
	let pending = entries;
	let progress = true;
	while (progress && pending.length > 0) {
		progress = false;
		const rest = [];
		for (const entry of pending) {
			let lit = null;
			try {
				lit = foldConstExpr(entry.expr, resolve);
			} catch (err) {
				if (checker?.err) {
					const savedFile = checker._currentFile;
					const savedSource = checker._currentSource;
					if (entry.filename) checker._currentFile = entry.filename;
					if (entry.source) checker._currentSource = entry.source;
					checker.err(err.message, entry.expr);
					checker._currentFile = savedFile;
					checker._currentSource = savedSource;
				} else {
					throw new Error(
						`Constant expression error for '${entry.name}': ${err.message}`,
					);
				}
				continue;
			}
			if (lit) {
				mod.constCache.set(entry.name, lit);
				progress = true;
			} else {
				rest.push(entry);
			}
		}
		pending = rest;
	}
	for (const entry of pending) mod.nonLiteralConsts.add(entry.name);
}

function _isPointerGoType(t, mod) {
	if (!t) return false;
	if (t.kind === "pointer" || t.kind === "PointerType" || t.kind === "StarExpr")
		return true;
	// `type P *T` used as a field type: look through the name.
	const named =
		t.kind === "named" || t.kind === "TypeName" || t.kind === "Ident";
	const under = named
		? (t.underlying ?? mod.checker?.types?.get(t.name)?.underlying)
		: null;
	return under ? _isPointerGoType(under, mod) : false;
}

// Constant-expression zero value of a struct global. Nested struct values are
// built in place: a null ref would trap on the first field access.
// Null when a nested array is too large to build as a constant expression.
function _zeroStructConst(structInfo, mod) {
	const out = [];
	for (const f of structInfo.fields) {
		const zero = _zeroFieldConst(f, mod);
		if (!zero) return null;
		out.push(...zero);
	}
	out.push({ op: "struct.new", typeIndex: structInfo.typeIndex });
	return out;
}

function _zeroFieldConst(f, mod) {
	const w = f.wType;
	if (w === "i64") return [{ op: "i64.const", value: 0n }];
	if (w === "f32" || w === "f64") return [{ op: `${w}.const`, value: 0 }];
	if (w === "externref") return [{ op: "ref.null", heapType: "extern" }];
	if (w === "anyref") return [{ op: "ref.null", heapType: "any" }];
	if (typeof w !== "object" || w === null)
		return [{ op: "i32.const", value: 0 }];
	const ti = w.typeIndex;
	const slice = typeof ti === "number" ? mod.getSliceTypeByIndex(ti) : null;
	if (slice) return [{ op: "global.get", index: slice.emptyGlobalIndex }];
	if (typeof ti === "number" && !_isPointerGoType(f.goType, mod)) {
		for (const s of mod.structTypes.values())
			if (s.typeIndex === ti) return _zeroStructConst(s, mod);
		// An array field is a value: a null ref would trap on first use.
		if (_arrayShape(f.goType, mod.checker))
			return _zeroArrayConst(f.goType, mod);
	}
	return [{ op: "ref.null", heapType: ti ?? "any" }];
}

// Length and element type of an array type (checker type, AST node or name).
function _arrayShape(t, checker) {
	if (!t) return null;
	if (t.kind === "array" || t.kind === "ArrayType") {
		const size = typeof t.size === "number" ? t.size : Number(t.size?.value);
		return Number.isInteger(size) ? { size, elem: t.elem } : null;
	}
	if (t.kind === "named" && t.underlying)
		return _arrayShape(t.underlying, checker);
	if (t.kind === "TypeName" || t.kind === "Ident")
		return _arrayShape(checker?.types?.get(t.name), checker);
	return null;
}

// Constant-expression zero value of a package-level array global (a null ref
// would trap on the first element access); null when it cannot be built.
function _zeroArrayConst(goType, mod, depth = 0) {
	const checker = mod.checker;
	if (!goType || goType.kind === "pointer" || depth > 4) return null;
	const shape = _arrayShape(goType, checker);
	if (!shape) return null;
	const { size, elem } = shape;
	const arrInfo = mod.getArrayType(elem);
	const elemW = toWasmType(elem, checker, mod);
	let one = null;
	if (_arrayShape(elem, checker)) {
		one = _zeroArrayConst(elem, mod, depth + 1);
		if (!one) return null;
	} else if (
		elem?.kind !== "pointer" &&
		elem?.kind !== "StarExpr" &&
		typeof elemW === "object" &&
		isStructType(elem, checker, mod)
	) {
		const info = Array.from(mod.structTypes.values()).find(
			(x) => x.typeIndex === elemW.typeIndex,
		);
		if (!info) return null;
		one = _zeroStructConst(info, mod);
		if (!one) return null;
	}
	if (!one)
		return [
			{ op: "i32.const", value: size },
			{ op: "array.new_default", typeIndex: arrInfo.typeIndex },
		];
	if (size > 64) return null;
	const out = [];
	for (let i = 0; i < size; i++) out.push(...one);
	out.push({ op: "array.new_fixed", typeIndex: arrInfo.typeIndex, size });
	return out;
}

export function _collectPackageGlobals(progs, mod, checker) {
	const pending = []; // non-constant initializers, run by the start function
	const pendingConsts = []; // unfoldable consts; they run before any var
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			const isConst = d.kind === "ConstDecl";
			if (d.kind !== "VarDecl" && !isConst) continue;
			for (const spec of d.decls ?? d.specs ?? [d]) {
				const names = spec.names ?? (spec.name ? [spec.name] : []);
				const values = spec.value ?? (spec.init ? [spec.init] : []);
				for (let i = 0; i < names.length; i++) {
					const name = names[i];
					// Foldable consts live in `constCache`, not in a global.
					if (isConst && !mod.isNonLiteralConst(name)) continue;
					const rawType =
						spec.type ??
						(values.length === 1 && names.length > 1
							? values[0]?._type?.types?.[i]
							: values[i]?._type);
					const wType = toWasmType(rawType, checker, mod);
					const gIdx = mod.globals.length;
					let needsRuntimeZero = false;
					let initInsts = [{ op: `${wType}.const`, value: 0 }];
					if (wType === "i64") initInsts = [{ op: "i64.const", value: 0n }];
					else if (wType === "f32" || wType === "f64")
						initInsts = [{ op: `${wType}.const`, value: 0.0 }];
					else if (
						wType === "externref" ||
						wType === "anyref" ||
						typeof wType === "object"
					) {
						const sliceInfo =
							typeof wType === "object" && typeof wType.typeIndex === "number"
								? mod.getSliceTypeByIndex(wType.typeIndex)
								: null;
						if (sliceInfo) {
							initInsts = [
								{ op: "global.get", index: sliceInfo.emptyGlobalIndex },
							];
						} else if (
							typeof wType === "object" &&
							typeof wType.typeIndex === "number" &&
							rawType?.kind !== "pointer"
						) {
							const structInfo = Array.from(mod.structTypes.values()).find(
								(s) => s.typeIndex === wType.typeIndex,
							);
							const arrZero = structInfo ? null : _zeroArrayConst(rawType, mod);
							const structZero = structInfo
								? _zeroStructConst(structInfo, mod)
								: null;
							if (structZero) {
								initInsts = structZero;
							} else if (arrZero) {
								initInsts = arrZero;
							} else if (
								(structInfo || _arrayShape(rawType, checker)) &&
								!values[i]
							) {
								// Too large for a constant expression: the start
								// function builds the zero value.
								needsRuntimeZero = true;
								initInsts = [
									{ op: "ref.null", heapType: wType.typeIndex ?? "any" },
								];
							} else {
								initInsts = [
									{ op: "ref.null", heapType: wType.typeIndex ?? "any" },
								];
							}
						} else {
							initInsts = [
								{
									op: "ref.null",
									heapType:
										typeof wType === "object"
											? (wType.heapType ?? wType.typeIndex ?? "any")
											: wType.replace("ref", ""),
								},
							];
						}
					}

					let litNode = values?.[i];
					let sign = 1;
					if (
						litNode &&
						litNode.kind === "UnaryExpr" &&
						litNode.op === "-" &&
						litNode.operand?.kind === "BasicLit"
					) {
						litNode = litNode.operand;
						sign = -1;
					}

					let isConstInit = false;
					if (litNode && litNode.kind === "BasicLit") {
						if (litNode.litKind === "INT") {
							isConstInit = true;
							const s = String(litNode.value);
							const clean = /^0[0-7]+$/.test(s) ? `0o${s.slice(1)}` : s;
							initInsts = [
								wType === "i64"
									? {
											op: "i64.const",
											value: BigInt(sign) * BigInt(clean),
										}
									: {
											op: "i32.const",
											value: (sign * Number(clean)) | 0,
										},
							];
						} else if (litNode.litKind === "FLOAT") {
							isConstInit = true;
							initInsts = [
								{
									op: `${wType}.const`,
									value: sign * Number(litNode.value),
								},
							];
						} else if (litNode.litKind === "BOOL") {
							isConstInit = true;
							initInsts = [
								{
									op: "i32.const",
									value: litNode.value === "true" ? 1 : 0,
								},
							];
						}
					}
					if (needsRuntimeZero) pending.push({ name, zeroType: rawType });
					if (!isConst && i === 0 && values.length === 1 && names.length > 1) {
						// `var q, r = pair()`: one call fills every name.
						pending.push({ name, names, expr: values[0] });
					}
					if (values[i] && !isConstInit && names.length === values.length) {
						(isConst ? pendingConsts : pending).push({
							name,
							expr: values[i],
						});
					}
					mod.globals.push({
						type: wType,
						mutable: true,
						init: initInsts,
					});
					mod.globalCache.set(name, {
						index: gIdx,
						type: wType,
						goType: rawType,
					});
				}
			}
		}
	}
	// Initialisers run in dependency order (Go spec), not declaration order.
	const rank = new Map();
	for (const e of orderPackageInits(progs).vars)
		for (const n of e.names) rank.set(n, rank.size);
	pending.sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0));
	return [..._orderConstInits(pendingConsts), ...pending];
}

// Orders runtime-initialised consts so each runs after the consts it
// references (Go allows a constant to use one declared later).
export function _orderConstInits(entries) {
	const byName = new Map(entries.map((e) => [e.name, e]));
	const ordered = [];
	const state = new Map();
	const visit = (entry) => {
		if (state.has(entry.name)) return;
		state.set(entry.name, true);
		_someNode(entry.expr, (n) => {
			if (n.kind === "Ident" && byName.has(n.name)) visit(byName.get(n.name));
			return false;
		});
		ordered.push(entry);
	};
	for (const e of entries) visit(e);
	return ordered;
}

// Synthesises `__init_globals()` assigning every non-constant package-level
// initializer in declaration order and invoking package `init()` functions;
// registered as the module start function.
export function _makeGlobalInitFunc(pending, initNames = []) {
	const stmts = pending.map(({ name, names, expr, zeroType }) =>
		zeroType
			? { kind: "GlobalZeroInit", name, goType: zeroType }
			: {
					kind: "AssignStmt",
					lhs: names
						? names.map((n, i) => ({
								kind: "Ident",
								name: n,
								_type: expr._type?.types?.[i],
							}))
						: [{ kind: "Ident", name, _type: expr._type }],
					op: "=",
					rhs: [expr],
				},
	);
	for (const initName of initNames) {
		stmts.push({
			kind: "ExprStmt",
			expr: {
				kind: "CallExpr",
				func: { kind: "Ident", name: initName },
				args: [],
			},
		});
	}
	stmts.push({ kind: "ReturnStmt", values: [] });
	return {
		kind: "FuncDecl",
		name: "__init_globals",
		params: [],
		returnType: null,
		body: { kind: "Block", stmts, list: stmts },
		_isGlobalInit: true,
	};
}

export function _makeInterfaceDispatcher(info, checker) {
	let methodSig = info.methodSig;
	if (!methodSig) {
		const raw =
			info.ifaceType?.kind === "named" && info.ifaceType.underlying
				? info.ifaceType.underlying
				: info.ifaceType;
		const ifaceResolved = checker?.resolveType?.(raw) ?? raw;
		const methods =
			ifaceResolved?.methods ?? ifaceResolved?.underlying?.methods;
		if (methods instanceof Map) {
			methodSig = methods.get(info.methodName);
		} else if (Array.isArray(methods)) {
			methodSig = methods.find((m) => (m.name ?? m) === info.methodName);
		}
	}

	const params = [{ name: "__recv", type: { kind: "basic", name: "any" } }];
	if (methodSig?.params) {
		const sigParams = variadicAsSlice(methodSig.params, methodSig.variadic);
		for (let p = 0; p < sigParams.length; p++) {
			params.push({ name: `__arg${p}`, type: sigParams[p] });
		}
	} else if (info.callNode?.args) {
		for (let p = 0; p < info.callNode.args.length; p++) {
			params.push({
				name: `__arg${p}`,
				type: info.callNode.args[p]._type ?? {
					kind: "basic",
					name: "any",
				},
			});
		}
	}

	let returnType = info.callNode?._type ?? null;
	if (methodSig?.returns) {
		returnType =
			methodSig.returns.length === 1
				? methodSig.returns[0]
				: methodSig.returns.length > 1
					? { kind: "tuple", types: methodSig.returns }
					: null;
	}

	return {
		kind: "FuncDecl",
		name: `__dispatch_${info.ifaceName}_${info.methodName}`,
		params,
		returnType,
		body: { kind: "Block", stmts: [], list: [] },
		_isInterfaceDispatcher: true,
		_ifaceName: info.ifaceName,
		_ifaceType: info.ifaceType,
		_methodName: info.methodName,
		_rootFuncDecl: null,
	};
}
