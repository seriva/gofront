// src/backend/wasm/prescan.js
// Pre-scan helpers: walk the lowered AST to decide which imports, runtime helpers
// and interface dispatchers a module needs before emission starts.

import { prepareWasmNative } from "./natives.js";
import {
	anonIfaceName,
	getInterfaceMethodList,
	getReceiverTypeName,
	isAnyType,
	isBoolGoType,
	isInterfaceType,
	isNonEmptyInterface,
	isTestingT,
	printOperandKind,
	toWasmType,
} from "./types.js";

export function importsAnyOf(programs, pkgs) {
	const has = (p) => (pkgs instanceof Set ? pkgs.has(p) : pkgs.includes(p));
	return (programs ?? []).some((p) =>
		(p.imports ?? []).some((decl) =>
			(decl.imports ?? [decl]).some((imp) => has(imp.path)),
		),
	);
}

export function hasErrorUsage(programs) {
	return (programs ?? []).some((p) => {
		let found = false;
		const scan = (n) => {
			if (!n || found || typeof n !== "object") return;
			if (Array.isArray(n)) {
				for (const x of n) scan(x);
				return;
			}
			if (
				(n.kind === "Ident" ||
					n.kind === "TypeName" ||
					n.kind === "basic" ||
					n.kind === "interface") &&
				n.name === "error"
			) {
				found = true;
				return;
			}
			for (const k of Object.keys(n)) {
				if (!k.startsWith("_")) scan(n[k]);
			}
		};
		scan(p);
		return found;
	});
}

// Depth-first search over AST nodes (skipping `_`-prefixed annotations).
export function _someNode(node, pred) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node)) return node.some((n) => _someNode(n, pred));
	if (pred(node)) return true;
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		if (_someNode(node[key], pred)) return true;
	}
	return false;
}

export function _usesTestingRun(node) {
	return _someNode(
		node,
		(n) =>
			n.kind === "CallExpr" &&
			n.func?.kind === "SelectorExpr" &&
			n.func.field === "Run" &&
			isTestingT(n.func.expr?._type),
	);
}

export function _usesTestingCleanup(node) {
	return _someNode(
		node,
		(n) =>
			n.kind === "CallExpr" &&
			n.func?.kind === "SelectorExpr" &&
			n.func.field === "Cleanup" &&
			isTestingT(n.func.expr?._type),
	);
}

// `__any_eq` is only needed when some `==`/`!=` (or switch case) compares
// anyref operands, a struct with an anyref field is compared, or the error
// runtime (`errors.Is`) is present.  `_emitAnyEq` throws if this misses a
// site, so a gap surfaces as a compile error rather than a bad module.
export function _usesAnyEq(funcDecls, mod) {
	if (mod.hasErrorType) return true;
	for (const info of mod.mapTypes.values()) {
		if (isInterfaceType(info.keyGoType, mod.checker)) return true;
	}
	for (const info of mod.structTypes.values()) {
		if (info.fields?.some((f) => f.wType === "anyref")) return true;
	}
	const isAnyRef = (n) =>
		Boolean(n?._type) && toWasmType(n._type, mod.checker, mod) === "anyref";
	return funcDecls.some((fn) =>
		_someNode(fn.body, (n) => {
			if (n.kind === "BinaryExpr" && (n.op === "==" || n.op === "!="))
				return isAnyRef(n.left) || isAnyRef(n.right);
			if (n.kind === "SwitchStmt" && n.tag) return isAnyRef(n.tag);
			return false;
		}),
	);
}

// Whether an `any`/interface value is reachable through `t` as a slice or
// array element, a map key or a map value, or a struct field: such operands
// are formatted by dynamic type (`__any_fmt`, `__any_fmt_key`).
function typeHasIfaceInContainer(t, mod, seen = new Set(), depth = 0) {
	if (!t || typeof t !== "object" || seen.has(t) || depth > 6) return false;
	seen.add(t);
	const sub = (x) => typeHasIfaceInContainer(x, mod, seen, depth + 1);
	const isIface = (x) =>
		isAnyType(x, mod.checker) || isInterfaceType(x, mod.checker);
	switch (t.kind) {
		case "named":
			return sub(t.underlying);
		case "pointer":
			return sub(t.base);
		case "slice":
		case "array":
			return isIface(t.elem) || sub(t.elem);
		case "map":
			return isIface(t.key) || isIface(t.value) || sub(t.value);
		case "struct": {
			const fields =
				t.fields instanceof Map ? [...t.fields.values()] : t.fields;
			return (fields ?? []).some((f) => {
				const ft = f?.type ?? f;
				return isIface(ft) || sub(ft);
			});
		}
		default:
			return false;
	}
}

// A `*testing.T` method call with an `any`/interface operand or a `xs...`
// spread needs `__any_fmt`.  (`fmt` is Go source and never reaches it.)
export function _usesTestingAny(funcDecls, mod) {
	return funcDecls.some((fn) =>
		_someNode(
			fn.body,
			(n) =>
				n.kind === "CallExpr" &&
				n.func?.kind === "SelectorExpr" &&
				isTestingT(n.func.expr?._type) &&
				n.args?.some((a) =>
					(a._type?.kind === "tuple" ? a._type.types : [a._type]).some(
						(t) =>
							a._spread ||
							isAnyType(t, mod.checker) ||
							isInterfaceType(t, mod.checker) ||
							typeHasIfaceInContainer(t, mod),
					),
				),
		),
	);
}

// Whether a value of this static type may hold a 64-bit unsigned integer
// (directly, inside a container or struct, or behind `any`/an interface when
// `viaIface` is set).  Without `viaIface` an `any` holds none: the value that
// reaches it has its own, more specific static type at its origin.
export function typeMayHoldU64(
	t,
	mod,
	seen = new Set(),
	depth = 0,
	viaIface = true,
) {
	if (!t || typeof t !== "object" || seen.has(t) || depth > 8) return false;
	seen.add(t);
	if (isAnyType(t, mod.checker) || isInterfaceType(t, mod.checker))
		return viaIface;
	const sub = (x) => typeMayHoldU64(x, mod, seen, depth + 1, viaIface);
	switch (t.kind) {
		case "basic":
			return t.name === "uint64" || t.name === "uint" || t.name === "uintptr";
		case "TypeName":
		case "Ident":
			return sub(
				mod.checker?.resolveType?.(t) ?? { kind: "basic", name: t.name },
			);
		case "named":
			return sub(t.underlying);
		case "tuple":
			return (t.types ?? []).some(sub);
		case "pointer":
			return sub(t.base);
		case "slice":
		case "array":
			return sub(t.elem);
		case "map":
			return sub(t.key) || sub(t.value);
		case "struct":
			return [...(t.fields?.values?.() ?? [])].some(sub);
		default:
			return false;
	}
}

export function _scanImportsInBody(node, mod) {
	if (!node || typeof node !== "object") return;

	// `fmt_box_u64` prints a uint64 that reaches an `any`/interface operand or
	// a fmt container.  Such a value starts as an expression whose static type
	// holds a 64-bit unsigned integer, so a program without one skips it.
	if (node._type && typeMayHoldU64(node._type, mod, new Set(), 0, false)) {
		mod.getFmtBoxU64Index();
	}

	if (node.kind === "CallExpr") {
		const { func, args } = node;
		prepareWasmNative(mod, node);
		if (
			func.kind === "Ident" &&
			(func.name === "print" || func.name === "println")
		) {
			const isPrintln = func.name === "println";
			if (args.length === 0 && isPrintln) {
				mod.getPrintlnEmptyIndex();
			}
			for (let i = 0; i < args.length; i++) {
				const isLast = i === args.length - 1 && isPrintln;
				const { wType, isBool } = printOperandKind(args[i], mod.checker);
				mod.getLogImportIndex(wType, isLast, isBool);
				if (!isPrintln) mod.getPrintResetIndex();
			}
		} else if (
			func.kind === "SelectorExpr" &&
			isTestingT(func.expr?._type) &&
			func.field
		) {
			mod.internString(func.field);
			if (func.field === "Name") mod.getTestingNameImportIndex();
			else if (func.field === "Failed" || func.field === "Skipped")
				mod.getTestingFlagImportIndex();
			else if (func.field === "Run") {
				// closure type for func(*testing.T) must exist before bodies are emitted
				mod.getTestingRunClosureType();
			} else if (func.field === "Cleanup") {
				mod.getTestingCleanupClosureType();
			} else {
				mod.getTestingCallImportIndex();
				for (const arg of args) {
					mod.getTestingArgImportIndex(
						toWasmType(arg._type, mod.checker),
						isBoolGoType(arg._type) ||
							(arg.kind === "BasicLit" && arg.litKind === "BOOL"),
					);
				}
			}
		}
	}

	if (node.kind === "BasicLit" && node.litKind === "STRING") {
		mod.getStringImportIndex();
		const strVal = String(node.value ?? "");
		mod.internString(strVal);
	}

	// Recurse child properties
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		const child = node[key];
		if (Array.isArray(child)) {
			for (const item of child) _scanImportsInBody(item, mod);
		} else if (child && typeof child === "object") {
			_scanImportsInBody(child, mod);
		}
	}
}

export function _scanInterfaceCallNodes(node, interfaceCalls, checker) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node)
			_scanInterfaceCallNodes(item, interfaceCalls, checker);
		return;
	}
	if (node.kind === "CallExpr" && node.func?.kind === "SelectorExpr") {
		const recvType = node.func.expr?._type;
		if (isNonEmptyInterface(recvType, checker)) {
			const ifaceName =
				getReceiverTypeName(recvType, node.func.expr) ||
				anonIfaceName(recvType);
			const methodName = node.func.field;
			const key = `${ifaceName}.${methodName}`;
			if (!interfaceCalls.has(key)) {
				interfaceCalls.set(key, {
					ifaceName,
					ifaceType: recvType,
					methodName,
					callNode: node,
				});
			}
		}
	}
	for (const key of Object.keys(node)) {
		if (!key.startsWith("_"))
			_scanInterfaceCallNodes(node[key], interfaceCalls, checker);
	}
}

export function _scanInterfaceTypeDecls(progs, interfaceCalls, checker) {
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind !== "TypeDecl") continue;
			const resolved = checker?.types?.get(d.name) ?? d.type;
			const underlying =
				resolved?.kind === "named"
					? resolved.underlying
					: d.type?.kind === "InterfaceType"
						? d.type
						: resolved;
			if (!isNonEmptyInterface(underlying, checker)) continue;
			const methods =
				underlying.methods instanceof Map
					? Array.from(underlying.methods.entries())
					: Array.isArray(underlying.methods)
						? underlying.methods.map((m) => [m.name ?? m, m])
						: [];
			for (const [mName, mSig] of methods) {
				const key = `${d.name}.${mName}`;
				if (!interfaceCalls.has(key)) {
					interfaceCalls.set(key, {
						ifaceName: d.name,
						ifaceType: resolved,
						methodName: mName,
						methodSig: mSig,
					});
				}
			}
		}
	}
}

// A qualified interface (`fmt.Stringer`) in a signature is a boundary type
// when the function is exported, so its dispatchers must exist.  Returns true
// when `t` names such a type.
function _registerQualifiedIface(t, interfaceCalls, checker) {
	if (t.kind !== "TypeName" || !t.name?.includes(".")) return false;
	const resolved = checker?.types?.get(t.name);
	const iface = resolved?.underlying ?? resolved;
	if (!resolved || !isNonEmptyInterface(iface, checker)) return true;
	for (const m of getInterfaceMethodList(iface)) {
		const key = `${t.name}.${m.name}`;
		if (interfaceCalls.has(key)) continue;
		interfaceCalls.set(key, {
			ifaceName: t.name,
			ifaceType: resolved,
			methodName: m.name,
			methodSig: { kind: "func", params: m.params, returns: m.returns },
		});
	}
	return true;
}

export function _scanFuncSigInterfaces(
	progs,
	funcDecls,
	interfaceCalls,
	checker,
	mod,
) {
	const scanType = (t) => {
		if (!t) return;
		if (_registerQualifiedIface(t, interfaceCalls, checker)) return;
		if (t.kind === "InterfaceType" || (t.kind === "interface" && !t.name)) {
			const mList = getInterfaceMethodList(t);
			if (mList.length === 0) return;
			const ifaceName = anonIfaceName(t, checker, mod);
			for (const m of mList) {
				const key = `${ifaceName}.${m.name}`;
				if (!interfaceCalls.has(key)) {
					interfaceCalls.set(key, {
						ifaceName,
						ifaceType: t,
						methodName: m.name,
						methodSig: {
							kind: "func",
							params: m.params,
							returns: m.returns,
						},
					});
				}
			}
		}
	};
	for (const fn of funcDecls) {
		for (const p of fn.params ?? []) scanType(p.type);
		scanType(fn.returnType);
	}
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind === "FuncDecl") {
				for (const param of d.params ?? []) scanType(param.type);
				scanType(d.returnType);
			}
		}
	}
}
