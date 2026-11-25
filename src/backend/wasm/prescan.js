// src/backend/wasm/prescan.js
// Pre-scan helpers: walk the lowered AST to decide which imports, runtime helpers
// and interface dispatchers a module needs before emission starts.

import { prepareWasmNative } from "./natives.js";
import {
	anonIfaceName,
	getInterfaceMethodList,
	getReceiverTypeName,
	isInterfaceType,
	isNonEmptyInterface,
	printOperandKind,
	structFieldList,
	toWasmType,
} from "./types.js";

export function hasErrorUsage(programs) {
	return (programs ?? []).some((p) => {
		let found = false;
		const scan = (n) => {
			if (!n || found || typeof n !== "object") return;
			if (Array.isArray(n)) {
				for (const x of n) scan(x);
				return;
			}
			// `error` is the universe interface by name (see `isErrorType`).
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

// Whether `node` is a `panic` whose value may be a nil interface (the `nil`
// literal or an interface-typed operand), which Go turns into a
// `*runtime.PanicNilError`.
export function panicsWithNil(node, checker) {
	if (node.kind !== "CallExpr" || node._builtinName !== "panic") return false;
	const arg = node.args?.[0];
	if (!arg) return false;
	if (arg.kind === "BasicLit" && arg.litKind === "NIL") return true;
	const t = arg._type;
	return t?.kind === "nil" || t?.name === "nil" || isInterfaceType(t, checker);
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

export function hasPanicNilUsage(programs, checker) {
	return (programs ?? []).some((p) =>
		_someNode(p, (n) => panicsWithNil(n, checker)),
	);
}

// The kinds `forEachComponentType` descends into.  Equality and hashing see
// through arrays and struct fields only; a dispatcher can be reached through
// any type a value is built from.
export const COMPARABLE_COMPONENTS = new Set(["array", "struct"]);
export const ALL_COMPONENTS = new Set([
	"array",
	"struct",
	"slice",
	"map",
	"pointer",
	"func",
	"tuple",
]);

const elemOf = (t) => [t.elem];
const funcParts = (t) => [
	...(t.params ?? []).map((p) => (t.kind === "FuncType" ? p?.type : p)),
	...(t.kind === "FuncType" ? [t.returnType] : (t.returns ?? [])),
];
const COMPONENT_PARTS = {
	array: elemOf,
	slice: elemOf,
	pointer: (t) => [t.base],
	map: (t) => [t.key, t.value ?? t.elem],
	tuple: (t) => t.types ?? [],
	struct: (t, checker) => structFieldList(t, checker).map((f) => f.goType),
	func: funcParts,
};

// The component kind of a type node, AST (`ArrayType`) or checker (`array`).
const COMPONENT_KIND = {
	ArrayType: "array",
	StructType: "struct",
	SliceType: "slice",
	MapType: "map",
	PointerType: "pointer",
	FuncType: "func",
	TupleType: "tuple",
};
for (const k of Object.keys(COMPONENT_PARTS)) COMPONENT_KIND[k] = k;

// The type a defined-type reference stands for (`TypeName` through the
// checker's table, `named` through its underlying type); undefined for any
// other type, null when there is none.
function definedTarget(t, checker) {
	if (t.kind === "TypeName" || t.kind === "Ident") {
		const resolved = checker?.types?.get(t.name);
		return resolved && resolved !== t ? resolved : null;
	}
	if (t.kind === "named") return t.underlying ?? checker?.types?.get(t.name);
	return undefined;
}

// Calls `visit` on `goType` and on every type it is built from, looking
// through defined types (`TypeName`, `named`) and descending into the
// component kinds in `through`.  `visit` returning true skips that type's
// components.  Each type (and type name) is visited once, so recursive types
// terminate.
export function forEachComponentType(
	goType,
	checker,
	visit,
	{ through = COMPARABLE_COMPONENTS } = {},
) {
	const seen = new Set();
	const walk = (t) => {
		if (!t || typeof t !== "object" || seen.has(t)) return;
		seen.add(t);
		if (visit(t)) return;
		const target = definedTarget(t, checker);
		if (target !== undefined) {
			// A type name is resolved once, however many nodes spell it.
			if (t.kind !== "named") {
				if (seen.has(`ref:${t.name}`)) return;
				seen.add(`ref:${t.name}`);
			}
			walk(target);
			return;
		}
		const kind = COMPONENT_KIND[t.kind];
		if (!through.has(kind)) return;
		for (const c of COMPONENT_PARTS[kind](t, checker)) walk(c);
	};
	walk(goType);
}

// Whether a value of `goType` holds an interface that `==` or hashing must
// compare dynamically: the type itself, an array element or a struct field.
export function containsInterfaceType(goType, checker) {
	let found = false;
	forEachComponentType(goType, checker, (t) => {
		if (found) return true;
		if (isInterfaceType(t, checker)) found = true;
		return found;
	});
	return found;
}

// `__any_eq` is only needed when some `==`/`!=` (or switch case) compares
// operands that hold an interface (directly, or in an array element or struct
// field), a struct with an anyref field is compared, or the error runtime
// (`errors.Is`) is present.  `_emitAnyEq` throws if this misses a site, so a
// gap surfaces as a compile error rather than a bad module.
export function _usesAnyEq(funcDecls, mod) {
	if (mod.hasErrorType) return true;
	for (const info of mod.mapTypes.values()) {
		if (containsInterfaceType(info.keyGoType, mod.checker)) return true;
	}
	for (const info of mod.structTypes.values()) {
		if (info.fields?.some((f) => f.wType === "anyref")) return true;
	}
	const holdsAny = (n) =>
		Boolean(n?._type) &&
		(toWasmType(n._type, mod.checker, mod) === "anyref" ||
			containsInterfaceType(n._type, mod.checker));
	return funcDecls.some((fn) =>
		_someNode(fn.body, (n) => {
			if (n.kind === "BinaryExpr" && (n.op === "==" || n.op === "!="))
				return holdsAny(n.left) || holdsAny(n.right);
			// A tagless case of interface type compares `true == case`, and a
			// case of interface type against a concrete tag compares boxed values.
			if (n.kind === "SwitchStmt")
				return (
					(n.tag && holdsAny(n.tag)) ||
					n.cases.some((c) => (c.list ?? []).some(holdsAny))
				);
			return false;
		}),
	);
}

export function _scanImportsInBody(node, mod) {
	if (!node || typeof node !== "object") return;

	if (node.kind === "CallExpr") {
		const { func, args } = node;
		prepareWasmNative(mod, node);
		if (
			func.kind === "Ident" &&
			(node._builtinName === "print" || node._builtinName === "println")
		) {
			const isPrintln = node._builtinName === "println";
			if (args.length === 0 && isPrintln) {
				mod.getPrintlnEmptyIndex();
			}
			for (let i = 0; i < args.length; i++) {
				const isLast = i === args.length - 1 && isPrintln;
				const { wType, isBool } = printOperandKind(args[i], mod.checker);
				mod.getLogImportIndex(wType, isLast, isBool);
				if (!isPrintln) mod.getPrintResetIndex();
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
// when `t` names such an interface (or an unresolved qualified type), whose
// components need no further scan.
function _registerQualifiedIface(t, interfaceCalls, checker) {
	if (t.kind !== "TypeName" || !t.name?.includes(".")) return false;
	const resolved = checker?.types?.get(t.name);
	if (!resolved) return true;
	const iface = resolved.underlying ?? resolved;
	if (!isInterfaceType(iface, checker)) return false;
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

// Registers the dispatchers of an anonymous interface type
// (`interface{ M() int }`).  Returns true when `t` is one.
function _registerAnonIface(t, interfaceCalls, checker, mod) {
	if (!(t.kind === "InterfaceType" || (t.kind === "interface" && !t.name)))
		return false;
	const ifaceName = anonIfaceName(t, checker, mod);
	for (const m of getInterfaceMethodList(t)) {
		const key = `${ifaceName}.${m.name}`;
		if (interfaceCalls.has(key)) continue;
		interfaceCalls.set(key, {
			ifaceName,
			ifaceType: t,
			methodName: m.name,
			methodSig: { kind: "func", params: m.params, returns: m.returns },
		});
	}
	return true;
}

const isExportedName = (name) => /^[A-Z]/.test(name ?? "");

// The declared types of a package `var` declaration's exported names.
function exportedVarTypes(d) {
	const out = [];
	for (const spec of d.decls ?? d.specs ?? [d]) {
		const names = spec.names ?? (spec.name ? [spec.name] : []);
		const values = spec.value ?? (spec.init ? [spec.init] : []);
		names.forEach((name, i) => {
			if (isExportedName(name)) out.push(spec.type ?? values[i]?._type);
		});
	}
	return out;
}

// Anonymous and qualified interfaces a JS caller can hand the module or
// receive from it need dispatchers even when no Go code calls their methods:
// those in function signatures, and in the fields and types of exported
// type and `var` declarations, at any depth (`[]interface{ M() int }`,
// `struct{ V interface{ M() int } }`, `*Box[interface{ M() int }]`).  A named
// interface gets its dispatchers from its own declaration.
export function _scanFuncSigInterfaces(
	progs,
	funcDecls,
	interfaceCalls,
	checker,
	mod,
) {
	const visit = (t) =>
		_registerQualifiedIface(t, interfaceCalls, checker) ||
		_registerAnonIface(t, interfaceCalls, checker, mod) ||
		(definedTarget(t, checker) !== undefined && isInterfaceType(t, checker));
	const scanType = (t) =>
		forEachComponentType(t, checker, visit, { through: ALL_COMPONENTS });
	const scanSig = (fn) => {
		for (const p of fn.params ?? []) scanType(p.type);
		scanType(fn.returnType);
	};
	for (const fn of funcDecls) scanSig(fn);
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind === "FuncDecl") scanSig(d);
			else if (d.kind === "TypeDecl" && isExportedName(d.name))
				scanType(d.type);
			else if (d.kind === "VarDecl")
				for (const t of exportedVarTypes(d)) scanType(t);
		}
	}
}
