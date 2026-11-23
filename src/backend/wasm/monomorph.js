// src/backend/wasm/monomorph.js
// Monomorphises generic functions, types, and methods for the WebAssembly (WasmGC) target.
//
// In GoFront, the JS backend leaves generics erased because JS is dynamically typed.
// For WebAssembly, WasmGC requires concrete struct layouts and typed function signatures.
// This pass specializes all generic templates reachable from code into concrete Go declarations
// (e.g. Identity$int, Box$int, Stack$int.Push) and re-typechecks the monomorphised AST.

import { declaredTypeNames } from "../../lower/walk.js";
import { TypeChecker } from "../../typechecker/index.js";
import { embeddedFieldName, PackageScope } from "../../typechecker/types.js";
import { goTypeName } from "../shared/fmt-types.js";
import { goTypeKey } from "./types.js";

/**
 * Returns true if the AST contains any generic declarations.
 */
export function hasGenerics(programs) {
	const progs = Array.isArray(programs) ? programs : [programs];
	for (const p of progs) {
		for (const d of p?.decls ?? []) {
			if (d.kind === "FuncDecl" && d.typeParams && d.typeParams.length > 0)
				return true;
			if (d.kind === "TypeDecl" && d.typeParams && d.typeParams.length > 0)
				return true;
			if (
				d.kind === "MethodDecl" &&
				(d.recvType?.typeArgs?.length > 0 ||
					d.recvType?.kind === "GenericTypeName")
			)
				return true;
		}
	}
	return false;
}

/**
 * The identifier-safe key of a Go type or AST type node: the one `wasm` type
 * key, so an instance and a layout are shared exactly by identical types.
 */
const typeKey = goTypeKey;

/**
 * Converts a Go type representation or AST type node into a concrete AST type node.
 */
export function typeToTypeNode(t) {
	if (!t) return { kind: "TypeName", name: "any" };
	if (typeof t === "string") return { kind: "TypeName", name: t };
	if (
		t.kind === "TypeName" ||
		t.kind === "GenericTypeName" ||
		t.kind === "PointerType" ||
		t.kind === "SliceType" ||
		t.kind === "ArrayType" ||
		t.kind === "MapType" ||
		t.kind === "FuncType" ||
		t.kind === "StructType" ||
		t.kind === "InterfaceType"
	) {
		return cloneAst(t);
	}
	if (t.kind === "basic") return { kind: "TypeName", name: t.name };
	if (t.kind === "untyped") return { kind: "TypeName", name: t.base ?? "int" };
	if (t.kind === "named") {
		if (t.typeArgs && t.typeArgs.length > 0) {
			return {
				kind: "TypeName",
				name: `${t.name}$${t.typeArgs.map(typeKey).join("$")}`,
			};
		}
		return { kind: "TypeName", name: t.name };
	}
	if (t.kind === "pointer") {
		return { kind: "PointerType", base: typeToTypeNode(t.base) };
	}
	if (t.kind === "slice") {
		return { kind: "SliceType", elem: typeToTypeNode(t.elem) };
	}
	if (t.kind === "array") {
		return {
			kind: "ArrayType",
			size: {
				kind: "BasicLit",
				litKind: "INT",
				value: String(t.len ?? t.size ?? 0),
			},
			elem: typeToTypeNode(t.elem),
		};
	}
	if (t.kind === "map") {
		return {
			kind: "MapType",
			key: typeToTypeNode(t.key),
			value: typeToTypeNode(t.value),
		};
	}
	if (t.kind === "typeParam") return { kind: "TypeName", name: t.name };
	// Without this a func type argument fell through to `any`, so a
	// `map[string]V` built in `mk[func()]` was a `map[string]any`.
	if (t.kind === "func") return funcTypeNode(t);
	// Likewise an anonymous struct or interface argument stayed `any`, so the
	// instance had no fields or methods to select.
	if (t.kind === "struct" && !t.name) return structTypeNode(t);
	if (t.kind === "interface" && !t.name) return interfaceTypeNode(t);
	return { kind: "TypeName", name: t.name ?? "any" };
}

// A checker struct type as a `StructType` node: the declared fields, an
// embedded field named after its type.
function structTypeNode(t) {
	const fields = [];
	if (Array.isArray(t._structFields)) {
		for (const f of t._structFields) {
			const type = typeToTypeNode(f.type);
			if (f.embedded)
				fields.push({
					names: [],
					type,
					embedded: true,
					embeddedName: embeddedFieldName(f),
					tag: f.tag ?? null,
				});
			else fields.push({ names: [...f.names], type, tag: f.tag ?? null });
		}
	} else if (t.fields instanceof Map) {
		for (const [name, type] of t.fields)
			fields.push({ names: [name], type: typeToTypeNode(type), tag: null });
	}
	return { kind: "StructType", fields };
}

// A checker interface type as an `InterfaceType` node; the checker has
// already folded embedded interfaces into the method set.
function interfaceTypeNode(t) {
	const methods = [];
	for (const [name, sig] of t.methods ?? []) {
		const { params, returnType } = funcTypeNode(sig);
		methods.push({ name, params, returnType });
	}
	return { kind: "InterfaceType", methods, embeds: [] };
}

// A checker func type as a `FuncType` node (several results as a `TupleType`).
function funcTypeNode(t) {
	// A variadic func lists its last parameter by element type.
	const params = (t.params ?? []).map((p, i, all) => ({
		name: "_",
		type: typeToTypeNode(p),
		variadic: !!t.variadic && i === all.length - 1,
	}));
	const rets = (t.returns ?? []).filter(
		(r) => !(r?.kind === "basic" && r.name === "void"),
	);
	// Several results come as one tuple type or as a list.
	const results = rets.length === 1 && rets[0]?.types ? rets[0].types : rets;
	let returnType = null;
	if (results.length === 1) returnType = typeToTypeNode(results[0]);
	else if (results.length > 1)
		returnType = { kind: "TupleType", types: results.map(typeToTypeNode) };
	return { kind: "FuncType", params, returnType };
}

// Replaces the type parameters inside a checker type (`[]E`, `map[K]V`,
// `Box[E]`) by their type arguments; the result mixes checker types and the
// AST type nodes of the substitution, which `typeKey` and `typeToTypeNode`
// both accept.
function substituteInType(t, map) {
	if (!t || typeof t !== "object") return t;
	const sub = (x) => substituteInType(x, map);
	switch (t.kind) {
		case "typeParam":
			return map.has(t.name) ? map.get(t.name) : t;
		case "slice":
		case "array":
			return { ...t, elem: sub(t.elem) };
		case "pointer":
			return { ...t, base: sub(t.base) };
		case "map":
			return { ...t, key: sub(t.key), value: sub(t.value) };
		case "func":
			return {
				...t,
				params: (t.params ?? []).map(sub),
				returns: (t.returns ?? []).map(sub),
			};
		case "named":
			return t.typeArgs?.length ? { ...t, typeArgs: t.typeArgs.map(sub) } : t;
		case "struct":
			// A named struct keeps its declaration; an anonymous one is its fields.
			if (t.name) return t;
			return {
				...t,
				fields: new Map([...t.fields].map(([k, v]) => [k, sub(v)])),
				...(t._structFields && {
					_structFields: t._structFields.map((f) => ({
						...f,
						type: sub(f.type),
					})),
				}),
			};
		default:
			return t;
	}
}

// A partial instantiation (`Grow[S](nil, n)`) lists only the explicit type
// arguments; the checker recorded the complete list, which replaces it.
function completeTypeArgs(node, typeSubstMap) {
	if (node._typeArgs?.length > (node.typeArgs?.length ?? 0))
		return node._typeArgs.map((t) => substituteInType(t, typeSubstMap));
	return node.typeArgs;
}

function getSpecializedName(baseName, typeArgs) {
	if (!typeArgs || typeArgs.length === 0) return baseName;
	const keys = typeArgs.map(typeKey).join("$");
	return `${baseName}$${keys}`;
}

// `_structFields` is the field list of a checker struct type inside
// `_typeArgs`; without it the clone is a struct with no fields.
const KEPT_CLONE_KEYS = new Set([
	"_typeArgs",
	"_structFields",
	"_line",
	"_col",
	"_spread",
]);

function cloneAst(node, open = new Set()) {
	if (!node || typeof node !== "object") return node;
	if (Array.isArray(node)) return node.map((n) => cloneAst(n, open));
	// A checker type may refer back to itself through a field; the reference
	// stays shared instead of recursing.
	if (open.has(node)) return node;
	open.add(node);
	const copy = cloneAstNode(node, open);
	open.delete(node);
	return copy;
}

function cloneAstNode(node, open) {
	if (node instanceof Map)
		return new Map([...node].map(([k, v]) => [k, cloneAst(v, open)]));
	const copy = {};
	for (const [k, v] of Object.entries(node)) {
		// Side tables are dropped, except source positions (for diagnostics in
		// the specialised body) and the inferred type arguments of a generic
		// call inside a generic body: substitution needs them to specialise the
		// callee (`isNaN(x)` inside `Compare[T]`).
		if (k.startsWith("_") && !KEPT_CLONE_KEYS.has(k)) continue;
		copy[k] = cloneAst(v, open);
	}
	// Named results hang off the return type node and alias its types; keep
	// just the names so `rebindNamedResults` can rebuild them after the types
	// are substituted.
	const named = node.returnType?._namedReturns;
	if (named) copy._resultNames = named.map((r) => r.name);
	return copy;
}

// Re-attaches named results (`(old *T)`) to every function in a cloned and
// substituted tree, pointing at the substituted type nodes.
function rebindNamedResults(node) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const n of node) rebindNamedResults(n);
		return;
	}
	if (node._resultNames && node.returnType) {
		const rt = node.returnType;
		rt._namedReturns = node._resultNames.map((name, i) => ({
			name,
			type: rt.kind === "TupleType" ? rt.types[i] : rt,
		}));
	}
	for (const [k, v] of Object.entries(node)) {
		if (!k.startsWith("_")) rebindNamedResults(v);
	}
}

/**
 * Replaces references to type parameters in AST nodes with concrete types.
 */
// The pointer type node a callee spelled `(*T)` or `(**T)` stands for when
// `T` is a type parameter in `typeSubstMap`, else null.
function pointerTypeOfParams(callee, typeSubstMap) {
	let n = callee;
	let stars = 0;
	for (;;) {
		if (n?.kind === "ParenExpr") n = n.expr;
		else if (n?.kind === "UnaryExpr" && n.op === "*") {
			stars++;
			n = n.operand;
		} else break;
	}
	if (stars === 0 || n?.kind !== "Ident" || !typeSubstMap.has(n.name))
		return null;
	let type = cloneAst(typeSubstMap.get(n.name));
	for (let i = 0; i < stars; i++) type = { kind: "PointerType", base: type };
	return type;
}

function substituteTypesInAst(
	node,
	typeSubstMap,
	onGenericUsage,
	genericTypes = null,
	genericFuncs = null,
) {
	if (!node || typeof node !== "object") return node;

	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			node[i] = substituteTypesInAst(
				node[i],
				typeSubstMap,
				onGenericUsage,
				genericTypes,
				genericFuncs,
			);
		}
		return node;
	}

	// 1. Plain TypeName reference: if it matches a type parameter name, replace with concrete type node
	if (node.kind === "TypeName" && typeSubstMap.has(node.name)) {
		const replacement = cloneAst(typeSubstMap.get(node.name));
		return replacement;
	}

	// 2. GenericTypeName: e.g. Box[T] or Box[int]
	if (node.kind === "GenericTypeName") {
		if (node.typeArgs) {
			node.typeArgs = node.typeArgs.map((ta) =>
				substituteTypesInAst(
					ta,
					typeSubstMap,
					onGenericUsage,
					genericTypes,
					genericFuncs,
				),
			);
		}
		const sName = getSpecializedName(node.name, node.typeArgs);
		if (onGenericUsage) {
			onGenericUsage({
				kind: "type",
				genericName: node.name,
				typeArgs: node.typeArgs,
				specializedName: sName,
			});
		}
		return { kind: "TypeName", name: sName };
	}

	// 3. InstantiationExpr: e.g. Identity[T] or Stack[int]
	if (node.kind === "InstantiationExpr") {
		if (node.typeArgs) {
			node.typeArgs = node.typeArgs.map((ta) =>
				substituteTypesInAst(
					ta,
					typeSubstMap,
					onGenericUsage,
					genericTypes,
					genericFuncs,
				),
			);
		}
		const baseName = node.expr?.name;
		if (baseName) {
			node.typeArgs = completeTypeArgs(node, typeSubstMap);
			const sName = getSpecializedName(baseName, node.typeArgs);
			const isType = genericTypes ? genericTypes.has(baseName) : false;
			if (onGenericUsage) {
				onGenericUsage({
					kind: isType ? "type" : "func",
					genericName: baseName,
					typeArgs: node.typeArgs,
					specializedName: sName,
				});
			}
			return isType
				? { kind: "TypeName", name: sName }
				: { kind: "Ident", name: sName };
		}
	}

	// 3b. CompositeLit
	if (node.kind === "CompositeLit") {
		const targetProp = node.typeExpr ? "typeExpr" : node.type ? "type" : null;
		// `S{a, b}` with S a type parameter: the type is a bare identifier.
		if (
			targetProp &&
			node[targetProp]?.kind === "Ident" &&
			typeSubstMap.has(node[targetProp].name)
		)
			node[targetProp] = cloneAst(typeSubstMap.get(node[targetProp].name));
		if (targetProp && node[targetProp]) {
			node[targetProp] = substituteTypesInAst(
				node[targetProp],
				typeSubstMap,
				onGenericUsage,
				genericTypes,
				genericFuncs,
			);
		}
	}

	// 4. CallExpr
	if (node.kind === "CallExpr") {
		// `(*T)(x)` with T a type parameter: the parser read the callee as a
		// dereference, so it becomes the conversion `(*int8)(x)`.
		const ptrTarget =
			node.args?.length === 1
				? pointerTypeOfParams(node.func, typeSubstMap)
				: null;
		if (ptrTarget) {
			return {
				kind: "TypeConversion",
				targetType: ptrTarget,
				expr: substituteTypesInAst(
					node.args[0],
					typeSubstMap,
					onGenericUsage,
					genericTypes,
					genericFuncs,
				),
				_line: node._line,
			};
		}
		// `T(x)` with T a type parameter becomes the conversion `int8(x)`.
		const conv =
			node.func?.kind === "Ident" ? typeSubstMap.get(node.func.name) : null;
		if (conv && node.args?.length === 1) {
			return {
				kind: "TypeConversion",
				targetType: cloneAst(conv),
				expr: substituteTypesInAst(
					node.args[0],
					typeSubstMap,
					onGenericUsage,
					genericTypes,
					genericFuncs,
				),
				_line: node._line,
			};
		}
		// `make(S, n)` / `new(S)`: the type argument is a bare identifier.
		if (
			node.func?.kind === "Ident" &&
			(node.func.name === "make" || node.func.name === "new") &&
			node.args?.[0]?.kind === "Ident" &&
			typeSubstMap.has(node.args[0].name)
		) {
			node.args[0] = {
				kind: "TypeExpr",
				type: cloneAst(typeSubstMap.get(node.args[0].name)),
			};
		}
		if (node.func?.kind === "Ident") {
			let typeArgs = node._typeArgs ?? node.func._typeArgs;
			if (typeArgs) {
				typeArgs = typeArgs.map((t) => {
					const name = t?.name ?? (t?.kind === "typeParam" ? t.name : null);
					if (name && typeSubstMap.has(name)) {
						return typeSubstMap.get(name);
					}
					return substituteInType(t, typeSubstMap);
				});
				const baseName = node.func.name;
				const sName = getSpecializedName(baseName, typeArgs);
				if (onGenericUsage) {
					onGenericUsage({
						kind: "func",
						genericName: baseName,
						typeArgs,
						specializedName: sName,
					});
				}
				node.func.name = sName;
			}
		}
	}

	// Recurse child properties
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		node[key] = substituteTypesInAst(
			node[key],
			typeSubstMap,
			onGenericUsage,
			genericTypes,
			genericFuncs,
		);
	}

	return node;
}

/**
 * Scans an AST tree for any generic type or function instantiations.
 */
function collectGenericUsages(node, genericFuncs, genericTypes, onUsage) {
	if (!node || typeof node !== "object") return;

	if (Array.isArray(node)) {
		for (const item of node)
			collectGenericUsages(item, genericFuncs, genericTypes, onUsage);
		return;
	}

	if (node.kind === "GenericTypeName" && genericTypes.has(node.name)) {
		const typeArgs = node._typeArgs ?? node.typeArgs;
		if (typeArgs && typeArgs.length > 0) {
			const sName = getSpecializedName(node.name, typeArgs);
			onUsage({
				kind: "type",
				genericName: node.name,
				typeArgs,
				specializedName: sName,
			});
		}
	} else if (
		node.kind === "InstantiationExpr" &&
		(genericFuncs.has(node.expr?.name) || genericTypes.has(node.expr?.name))
	) {
		const typeArgs = node._typeArgs ?? node.typeArgs;
		if (typeArgs && typeArgs.length > 0) {
			const isType = genericTypes.has(node.expr.name);
			const sName = getSpecializedName(node.expr.name, typeArgs);
			onUsage({
				kind: isType ? "type" : "func",
				genericName: node.expr.name,
				typeArgs,
				specializedName: sName,
			});
		}
	} else if (node.kind === "CompositeLit") {
		const tNode = node.typeExpr ?? node.type;
		if (tNode) collectGenericUsages(tNode, genericFuncs, genericTypes, onUsage);
	} else if (node.kind === "CallExpr") {
		if (node.func?.kind === "Ident" && genericFuncs.has(node.func.name)) {
			const typeArgs = node._typeArgs ?? node.func._typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				const sName = getSpecializedName(node.func.name, typeArgs);
				onUsage({
					kind: "func",
					genericName: node.func.name,
					typeArgs,
					specializedName: sName,
				});
			}
		} else if (
			node.func?.kind === "InstantiationExpr" &&
			genericFuncs.has(node.func.expr?.name)
		) {
			const typeArgs = node.func._typeArgs ?? node.func.typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				const sName = getSpecializedName(node.func.expr.name, typeArgs);
				onUsage({
					kind: "func",
					genericName: node.func.expr.name,
					typeArgs,
					specializedName: sName,
				});
			}
		} else if (
			node.func?.kind === "SelectorExpr" &&
			genericFuncs.has(node.func.field)
		) {
			const typeArgs = node._typeArgs ?? node.func._typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				const sName = getSpecializedName(node.func.field, typeArgs);
				onUsage({
					kind: "func",
					genericName: node.func.field,
					typeArgs,
					specializedName: sName,
				});
			}
		}
	}

	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		collectGenericUsages(node[key], genericFuncs, genericTypes, onUsage);
	}
}

/**
 * Rewrites generic call sites and type expressions to reference their specialized names.
 */
function rewriteGenericReferences(node, genericFuncs, genericTypes) {
	if (!node || typeof node !== "object") return;

	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			const child = node[i];
			if (child?.kind === "GenericTypeName" && genericTypes.has(child.name)) {
				const typeArgs = child._typeArgs ?? child.typeArgs;
				if (typeArgs && typeArgs.length > 0) {
					const sName = getSpecializedName(child.name, typeArgs);
					node[i] = { kind: "TypeName", name: sName };
					continue;
				}
			}
			if (
				child?.kind === "InstantiationExpr" &&
				(genericFuncs.has(child.expr?.name) ||
					genericTypes.has(child.expr?.name))
			) {
				const typeArgs = child._typeArgs ?? child.typeArgs;
				if (typeArgs && typeArgs.length > 0) {
					const isType = genericTypes.has(child.expr.name);
					const sName = getSpecializedName(child.expr.name, typeArgs);
					node[i] = isType
						? { kind: "TypeName", name: sName }
						: { kind: "Ident", name: sName };
					continue;
				}
			}
			rewriteGenericReferences(child, genericFuncs, genericTypes);
		}
		return;
	}

	// Object children
	if (node.kind === "CallExpr") {
		if (node.func?.kind === "Ident" && genericFuncs.has(node.func.name)) {
			const typeArgs = node._typeArgs ?? node.func._typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				node.func.name = getSpecializedName(node.func.name, typeArgs);
			}
		} else if (
			node.func?.kind === "InstantiationExpr" &&
			genericFuncs.has(node.func.expr?.name)
		) {
			const typeArgs = node.func._typeArgs ?? node.func.typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				const sName = getSpecializedName(node.func.expr.name, typeArgs);
				node.func = { kind: "Ident", name: sName };
			}
		} else if (
			node.func?.kind === "SelectorExpr" &&
			genericFuncs.has(node.func.field)
		) {
			const typeArgs = node._typeArgs ?? node.func._typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				node.func.field = getSpecializedName(node.func.field, typeArgs);
			}
		}
	} else if (node.kind === "CompositeLit" && (node.typeExpr || node.type)) {
		const targetProp = node.typeExpr ? "typeExpr" : "type";
		const tNode = node[targetProp];
		if (tNode?.kind === "GenericTypeName" && genericTypes.has(tNode.name)) {
			const typeArgs = tNode._typeArgs ?? tNode.typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				const sName = getSpecializedName(tNode.name, typeArgs);
				node[targetProp] = { kind: "TypeName", name: sName };
			}
		} else if (
			tNode?.kind === "InstantiationExpr" &&
			genericTypes.has(tNode.expr?.name)
		) {
			const typeArgs = tNode._typeArgs ?? tNode.typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				const sName = getSpecializedName(tNode.expr.name, typeArgs);
				node[targetProp] = { kind: "TypeName", name: sName };
			}
		}
	}

	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		const child = node[key];
		if (child?.kind === "GenericTypeName" && genericTypes.has(child.name)) {
			const typeArgs = child._typeArgs ?? child.typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				node[key] = {
					kind: "TypeName",
					name: getSpecializedName(child.name, typeArgs),
				};
				continue;
			}
		}
		if (
			child?.kind === "InstantiationExpr" &&
			(genericFuncs.has(child.expr?.name) || genericTypes.has(child.expr?.name))
		) {
			const typeArgs = child._typeArgs ?? child.typeArgs;
			if (typeArgs && typeArgs.length > 0) {
				const isType = genericTypes.has(child.expr.name);
				const sName = getSpecializedName(child.expr.name, typeArgs);
				node[key] = isType
					? { kind: "TypeName", name: sName }
					: { kind: "Ident", name: sName };
				continue;
			}
		}
		rewriteGenericReferences(child, genericFuncs, genericTypes);
	}
}

/**
 * Main monomorphisation entry point.
 * Given AST programs and typechecker, returns monomorphised programs and an updated TypeChecker.
 */
export function monomorphise(programs, checker) {
	const progs = Array.isArray(programs) ? programs : [programs];
	if (!hasGenerics(progs)) {
		return { programs: progs, checker };
	}

	// 1. Identify all generic definitions
	const genericFuncs = new Map();
	const genericTypes = new Map();
	const genericMethods = new Map(); // recvBaseName -> Array<MethodDecl>
	// Template declaration -> its program; a specialization joins the program
	// of its template, so a wasm package's instances stay wasm-package
	// declarations even when a Go-source stdlib package is linked first.
	const homeOf = new Map();

	for (const p of progs) {
		for (const d of p?.decls ?? []) {
			homeOf.set(d, p);
			if (d.kind === "FuncDecl" && d.typeParams && d.typeParams.length > 0) {
				genericFuncs.set(d.name, d);
			} else if (
				d.kind === "TypeDecl" &&
				d.typeParams &&
				d.typeParams.length > 0
			) {
				genericTypes.set(d.name, d);
			} else if (d.kind === "MethodDecl") {
				const recvName = d.recvType?.name;
				if (
					d.recvType?.typeArgs?.length > 0 ||
					d.recvType?.kind === "GenericTypeName" ||
					genericTypes.has(recvName)
				) {
					if (!genericMethods.has(recvName)) genericMethods.set(recvName, []);
					genericMethods.get(recvName).push(d);
				}
			}
		}
	}

	const worklist = [];
	const seen = new Set();

	function enqueue(item) {
		if (!item || seen.has(item.specializedName)) return;
		worklist.push(item);
	}

	// 2. Collect initial usages in non-generic code
	for (const p of progs) {
		for (const d of p?.decls ?? []) {
			const isGenericFunc =
				d.kind === "FuncDecl" && d.typeParams && d.typeParams.length > 0;
			const isGenericType =
				d.kind === "TypeDecl" && d.typeParams && d.typeParams.length > 0;
			const isGenericMethod =
				d.kind === "MethodDecl" &&
				(d.recvType?.typeArgs?.length > 0 ||
					d.recvType?.kind === "GenericTypeName" ||
					genericTypes.has(d.recvType?.name));

			if (!isGenericFunc && !isGenericType && !isGenericMethod) {
				collectGenericUsages(d, genericFuncs, genericTypes, enqueue);
			}
		}
	}

	const typeInstances = new Map();
	const specializedFuncs = new Map();
	const specializedTypes = new Map();
	const specializedMethods = new Map();

	// 3. Process worklist until all reachable specializations are emitted
	let iterations = 0;
	const MAX_ITERATIONS = 512;

	while (worklist.length > 0) {
		if (++iterations > MAX_ITERATIONS) {
			throw new Error("Monomorphisation exceeded maximum iteration limit");
		}
		const item = worklist.shift();
		if (seen.has(item.specializedName)) continue;
		seen.add(item.specializedName);

		if (item.kind === "type") {
			const genDecl = genericTypes.get(item.genericName);
			if (!genDecl) continue;

			const typeSubstMap = new Map();
			for (let i = 0; i < genDecl.typeParams.length; i++) {
				const tp = genDecl.typeParams[i];
				const concrete = item.typeArgs[i];
				typeSubstMap.set(tp.name, typeToTypeNode(concrete));
			}

			typeInstances.set(item.specializedName, item);
			const monoTypeDecl = cloneAst(genDecl);
			monoTypeDecl.name = item.specializedName;
			monoTypeDecl.typeParams = null;
			substituteTypesInAst(
				monoTypeDecl,
				typeSubstMap,
				enqueue,
				genericTypes,
				genericFuncs,
			);
			rebindNamedResults(monoTypeDecl);
			specializedTypes.set(item.specializedName, monoTypeDecl);
			homeOf.set(monoTypeDecl, homeOf.get(genDecl));

			// Specialize all methods declared on this generic type
			const methods = genericMethods.get(item.genericName) ?? [];
			for (const m of methods) {
				const monoMethod = cloneAst(m);
				monoMethod.recvType = {
					kind: "TypeName",
					name: item.specializedName,
				};
				substituteTypesInAst(
					monoMethod,
					typeSubstMap,
					enqueue,
					genericTypes,
					genericFuncs,
				);
				rebindNamedResults(monoMethod);
				const mKey = `${item.specializedName}.${monoMethod.name}`;
				specializedMethods.set(mKey, monoMethod);
				homeOf.set(monoMethod, homeOf.get(m));
			}
		} else if (item.kind === "func") {
			const genDecl = genericFuncs.get(item.genericName);
			if (!genDecl) continue;

			const typeSubstMap = new Map();
			for (let i = 0; i < genDecl.typeParams.length; i++) {
				const tp = genDecl.typeParams[i];
				const concrete = item.typeArgs[i];
				typeSubstMap.set(tp.name, typeToTypeNode(concrete));
			}

			const monoFuncDecl = cloneAst(genDecl);
			monoFuncDecl.name = item.specializedName;
			monoFuncDecl.typeParams = null;
			substituteTypesInAst(
				monoFuncDecl,
				typeSubstMap,
				enqueue,
				genericTypes,
				genericFuncs,
			);
			rebindNamedResults(monoFuncDecl);
			specializedFuncs.set(item.specializedName, monoFuncDecl);
			homeOf.set(monoFuncDecl, homeOf.get(genDecl));
		}
	}

	// 4. Rewrite all generic references across ASTs
	for (const p of progs) {
		for (const d of p?.decls ?? []) {
			const isGenericFunc =
				d.kind === "FuncDecl" && d.typeParams && d.typeParams.length > 0;
			const isGenericType =
				d.kind === "TypeDecl" && d.typeParams && d.typeParams.length > 0;
			const isGenericMethod =
				d.kind === "MethodDecl" &&
				(d.recvType?.typeArgs?.length > 0 ||
					d.recvType?.kind === "GenericTypeName" ||
					genericTypes.has(d.recvType?.name));

			if (!isGenericFunc && !isGenericType && !isGenericMethod) {
				rewriteGenericReferences(d, genericFuncs, genericTypes);
			}
		}
	}
	for (const fn of specializedFuncs.values()) {
		rewriteGenericReferences(fn, genericFuncs, genericTypes);
	}
	for (const t of specializedTypes.values()) {
		rewriteGenericReferences(t, genericFuncs, genericTypes);
	}
	for (const m of specializedMethods.values()) {
		rewriteGenericReferences(m, genericFuncs, genericTypes);
	}

	// 5. Update program declarations: remove generic templates, add specializations
	for (const p of progs) {
		p.decls = (p.decls ?? []).filter((d) => {
			if (d.kind === "FuncDecl" && d.typeParams && d.typeParams.length > 0)
				return false;
			if (d.kind === "TypeDecl" && d.typeParams && d.typeParams.length > 0)
				return false;
			if (
				d.kind === "MethodDecl" &&
				(d.recvType?.typeArgs?.length > 0 ||
					d.recvType?.kind === "GenericTypeName" ||
					genericTypes.has(d.recvType?.name))
			)
				return false;
			return true;
		});
	}

	const targetProg = progs[0];
	if (targetProg) {
		for (const group of [
			specializedTypes,
			specializedMethods,
			specializedFuncs,
		])
			for (const d of group.values())
				(homeOf.get(d) ?? targetProg).decls.push(d);
	}

	// 6. Typecheck the monomorphised program to annotate all concrete types
	const monoChecker = new TypeChecker();
	monoChecker.target = "wasm";
	// Linked packages share one scope, but a package's unexported values
	// (including a shadow of `append`) stay its own.
	monoChecker.globals = new PackageScope(monoChecker.universe);
	monoChecker.pkgName = targetProg?.pkg?.name ?? "main";
	// The programs were checked once already, where `//gofront:native` is
	// limited to the standard library; this pass only re-annotates them.
	monoChecker.nativesChecked = true;
	// Likewise the receivers of pointer methods: the first check decided which
	// are addressable, so a mangled instance name never reports one here.
	monoChecker.receiversChecked = true;
	if (checker?.types) {
		// Linking must not write to the types the packages stored, so what the
		// programs declare gets types of its own here: a package-level type is
		// collected afresh, and a function-local type (named by the generated
		// code before the function that declares it is checked) starts from a
		// copy that collecting then fills in.
		const topLevel = new Set(
			progs.flatMap((p) =>
				p.decls.filter((d) => d.kind === "TypeDecl").map((d) => d.name),
			),
		);
		const local = new Set(declaredTypeNames(progs));
		for (const [name, type] of checker.types.entries()) {
			if (monoChecker.types.has(name) || topLevel.has(name)) continue;
			monoChecker.types.set(name, local.has(name) ? { ...type } : type);
		}
	}

	// One pass over all programs: declarations of every linked package are
	// visible to the others (cross-package references are dequalified).
	monoChecker.checkAll(progs);
	nameInstances(monoChecker, typeInstances);

	return { programs: progs, checker: monoChecker };
}

// Records Go's spelling of each generic instance (`Box[int]`) on its
// monomorphised type, which is named `Box$int`; `%T` prints the spelling, and
// `_instanceKey` keeps the unqualified form the JS facade caller passes.
function nameInstances(checker, instances) {
	const spell = (qualifyNames) => {
		const map = {
			has: (name) => instances.has(name),
			get: (name) => {
				const { genericName, typeArgs } = instances.get(name);
				return `${genericName}[${typeArgs.map((a) => goTypeName(a, map, qualifyNames)).join(",")}]`;
			},
		};
		return map;
	};
	const qualified = spell(true);
	const unqualified = spell(false);
	for (const name of instances.keys()) {
		const type = checker.types.get(name);
		if (type) {
			type._goName = qualified.get(name);
			type._instanceKey = unqualified.get(name);
		}
	}
}
