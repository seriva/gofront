// src/backend/wasm/monomorph.js
// Monomorphises generic functions, types, and methods for the WebAssembly (WasmGC) target.
//
// In GoFront, the JS backend leaves generics erased because JS is dynamically typed.
// For WebAssembly, WasmGC requires concrete struct layouts and typed function signatures.
// This pass specializes all generic templates reachable from code into concrete Go declarations
// (e.g. Identity$int, Box$int, Stack$int.Push) and re-typechecks the monomorphised AST.

import { TypeChecker } from "../../typechecker/index.js";

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
 * Returns a stable identifier-safe string key for any Go type or AST type node.
 */
export function typeKey(t) {
	if (!t) return "any";
	if (typeof t === "string") return t;
	if (t.kind === "basic") return t.name;
	if (t.kind === "untyped") return t.base ?? "int";
	if (t.kind === "TypeName" || t.kind === "Ident") return t.name;
	if (t.kind === "GenericTypeName") {
		const args = (t.typeArgs ?? []).map(typeKey).join("$");
		return args ? `${t.name}$${args}` : t.name;
	}
	if (t.kind === "named") {
		if (t.typeArgs && t.typeArgs.length > 0) {
			const args = t.typeArgs.map(typeKey).join("$");
			return `${t.name}$${args}`;
		}
		return t.name;
	}
	if (t.kind === "pointer" || t.kind === "PointerType") {
		return `ptr_${typeKey(t.base ?? t.expr ?? t.operand)}`;
	}
	if (t.kind === "StarExpr") {
		return `ptr_${typeKey(t.expr ?? t.operand)}`;
	}
	if (t.kind === "slice" || t.kind === "SliceType") {
		return `slice_${typeKey(t.elem)}`;
	}
	if (t.kind === "array" || t.kind === "ArrayType") {
		const len = t.len ?? t.size ?? "";
		return `arr_${len}_${typeKey(t.elem)}`;
	}
	if (t.kind === "map" || t.kind === "MapType") {
		return `map_${typeKey(t.key)}_${typeKey(t.value)}`;
	}
	if (t.kind === "func" || t.kind === "FuncType") {
		const params = (t.params ?? []).map(typeKey).join("_");
		const rets = (t.returns ?? []).map(typeKey).join("_");
		return `fn_${params}_ret_${rets}`;
	}
	if (t.name) return t.name;
	return "val";
}

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
		t.kind === "FuncType"
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
			len: t.len ?? t.size ?? 0,
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
	return { kind: "TypeName", name: t.name ?? "any" };
}

export function getSpecializedName(baseName, typeArgs) {
	if (!typeArgs || typeArgs.length === 0) return baseName;
	const keys = typeArgs.map(typeKey).join("$");
	return `${baseName}$${keys}`;
}

export function cloneAst(node) {
	if (!node || typeof node !== "object") return node;
	if (Array.isArray(node)) return node.map(cloneAst);
	const copy = {};
	for (const [k, v] of Object.entries(node)) {
		copy[k] = cloneAst(v);
	}
	return copy;
}

/**
 * Replaces references to type parameters in AST nodes with concrete types.
 */
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
		if (node.func?.kind === "Ident") {
			let typeArgs = node._typeArgs ?? node.func._typeArgs;
			if (typeArgs) {
				typeArgs = typeArgs.map((t) => {
					const name = t?.name ?? (t?.kind === "typeParam" ? t.name : null);
					if (name && typeSubstMap.has(name)) {
						return typeSubstMap.get(name);
					}
					return t;
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

	for (const p of progs) {
		for (const d of p?.decls ?? []) {
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
			specializedTypes.set(item.specializedName, monoTypeDecl);

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
				const mKey = `${item.specializedName}.${monoMethod.name}`;
				specializedMethods.set(mKey, monoMethod);
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
			specializedFuncs.set(item.specializedName, monoFuncDecl);
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
		targetProg.decls.push(...specializedTypes.values());
		targetProg.decls.push(...specializedMethods.values());
		targetProg.decls.push(...specializedFuncs.values());
	}

	// 6. Typecheck the monomorphised program to annotate all concrete types
	const monoChecker = new TypeChecker();
	monoChecker.target = "wasm";
	monoChecker.pkgName = targetProg?.pkg?.name ?? "main";
	if (checker?.types) {
		for (const [name, type] of checker.types.entries()) {
			if (!monoChecker.types.has(name)) {
				monoChecker.types.set(name, type);
			}
		}
	}

	for (const p of progs) {
		monoChecker.check(p);
	}

	return { programs: progs, checker: monoChecker };
}
