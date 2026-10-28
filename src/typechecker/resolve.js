// Type resolution methods — resolveTypeNode, resolveType, fieldType, generics.
// Installed as a mixin on TypeChecker.prototype.

import { parseJsonTag } from "../parser/struct-tag.js";
import { foldConstExpr } from "./const-fold.js";
import { EXCLUDED_STDLIB_MEMBERS } from "./stdlib/excluded.js";
import {
	ANY,
	BASIC_TYPES,
	COMPARABLE,
	defaultType,
	displayTypeName,
	isAny,
	isTypedArraySlice,
	Scope,
	TAINTED_ANY,
	typedArrayConstructorForElem,
	typeStr,
	VOID,
	WASM_STDLIB_MEMBERS,
} from "./types.js";

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

// Dispatch table for substituteType — keyed by type.kind.
const SUBSTITUTE_DISPATCH = {
	basic: (_s, type) => type,
	untyped: (_s, type) => type,
	slice: (s, type, map) => ({
		kind: "slice",
		elem: s.substituteType(type.elem, map),
	}),
	array: (s, type, map) => ({
		kind: "array",
		size: type.size,
		elem: s.substituteType(type.elem, map),
	}),
	map: (s, type, map) => ({
		kind: "map",
		key: s.substituteType(type.key, map),
		value: s.substituteType(type.value, map),
	}),
	pointer: (s, type, map) => ({
		kind: "pointer",
		base: s.substituteType(type.base, map),
	}),
	tuple: (s, type, map) => ({
		kind: "tuple",
		types: type.types.map((t) => s.substituteType(t, map)),
	}),
	func: (s, type, map) => ({
		kind: "func",
		params: type.params.map((p) => s.substituteType(p, map)),
		returns: type.returns.map((r) => s.substituteType(r, map)),
		variadic: type.variadic,
		async: type.async,
	}),
	struct: (s, type, map) => {
		const fields = new Map();
		const methods = new Map();
		for (const [k, v] of type.fields) fields.set(k, s.substituteType(v, map));
		for (const [k, v] of type.methods) methods.set(k, s.substituteType(v, map));
		return {
			kind: "struct",
			name: type.name,
			fields,
			methods,
			_embeds: type._embeds,
			_structFields: type._structFields,
		};
	},
	interface: (s, type, map) => {
		const methods = new Map();
		for (const [k, v] of type.methods) methods.set(k, s.substituteType(v, map));
		return { kind: "interface", name: type.name, methods };
	},
	named: (s, type, map) => {
		// An instance of a generic type: re-instantiate with the substituted
		// arguments (through the instance cache) rather than copying its
		// possibly cyclic underlying type.
		if (type._genericOf)
			return s.instantiateGenericWithArgs(
				type._genericOf,
				type.typeArgs.map((t) => s.substituteType(t, map)),
			);
		return {
			kind: "named",
			name: type.name,
			...(type.typeArgs && {
				typeArgs: type.typeArgs.map((t) => s.substituteType(t, map)),
			}),
			underlying: s.substituteType(type.underlying, map),
		};
	},
};

/** @type {ThisType<TypeChecker>} */
export const resolveMethods = {
	resolveTypeNode(node, scope) {
		if (!node) return ANY;
		switch (node.kind) {
			case "TypeName": {
				if (BASIC_TYPES[node.name]) return BASIC_TYPES[node.name];
				if (node.name === "comparable") return COMPARABLE;
				if (scope) {
					const fromScope = scope.lookup(node.name);
					if (fromScope?.kind === "typeParam") return fromScope;
					if (fromScope?.kind === "aliasArg") return fromScope.type;
				}
				const named = this.types.get(node.name);
				if (named) {
					const wasmErr = this._checkWasmStdlibTypeMember(node);
					if (wasmErr) return wasmErr;
					this._useQualifiedTypeName(node, named);
					return named;
				}
				if (EXCLUDED_STDLIB_MEMBERS.has(node.name)) {
					return this.err(
						`${node.name} is not available: ${EXCLUDED_STDLIB_MEMBERS.get(node.name)}`,
						node,
					);
				}
				return this.err(`Unknown type '${node.name}'`, node);
			}
			case "GenericTypeName":
			case "InstantiationExpr":
			case "IndexExpr":
				return this._resolveGenericTypeName(node, scope);
			case "TypeParam": {
				const constraint = node.constraint
					? this.resolveTypeNode(node.constraint, scope)
					: ANY;
				return { kind: "typeParam", name: node.name, constraint };
			}
			case "UnionConstraint":
				return node;
			case "SliceType":
				return { kind: "slice", elem: this.resolveTypeNode(node.elem, scope) };
			case "MapType":
				return {
					kind: "map",
					key: this.resolveTypeNode(node.key, scope),
					value: this.resolveTypeNode(node.value, scope),
				};
			case "PointerType":
				return {
					kind: "pointer",
					base: this.resolveTypeNode(node.base, scope),
				};
			case "StructType":
				return this._resolveStructType(node, scope);
			case "InterfaceType":
				return this._resolveInterfaceType(node, scope);
			case "Ident":
				return this.resolveTypeNode(
					{ kind: "TypeName", name: node.name },
					scope,
				);
			case "SelectorExpr":
				// `pkg.T{}` composite literal — the parser keeps the type as a
				// SelectorExpr; resolve it like a qualified TypeName.
				if (node.expr?.kind === "Ident" && typeof node.field === "string") {
					const qualified = `${node.expr.name}.${node.field}`;
					if (this.types.has(qualified)) {
						const resolved = this.resolveTypeNode(
							{ kind: "TypeName", name: qualified },
							scope,
						);
						this._useQualifiedTypeName(node, resolved);
						return resolved;
					}
				}
				return ANY;
			case "ArrayType":
				return this._resolveArrayTypeNode(node, scope);
			case "FuncType":
				return this._resolveFuncTypeNode(node, scope);
			case "TupleType":
				return {
					kind: "tuple",
					types: node.types.map((t) => this.resolveTypeNode(t, scope)),
				};
			default:
				return ANY;
		}
	},

	_checkWasmStdlibTypeMember(node) {
		if (this.target !== "wasm" && this.target !== "both") return null;
		const dot = node.name.indexOf(".");
		if (dot === -1) return null;
		const pkg = node.name.slice(0, dot);
		if (pkg !== "time") return null;
		const field = node.name.slice(dot + 1);
		const allowed = WASM_STDLIB_MEMBERS.get(pkg);
		if (allowed && !allowed.has(field)) {
			this.recordBlocker("unsupported stdlib member", node.name);
			return this.err(
				`'${node.name}' is not yet available in wasm packages`,
				node,
				"move this call to a JS package, or use a supported alternative",
			);
		}
		return null;
	},

	// `pkg.T` in a type position counts as using the import; a Go-source
	// stdlib type is emitted under its mangled name.
	_useQualifiedTypeName(node, named) {
		const name =
			node.name ?? (node.expr ? `${node.expr.name}.${node.field}` : "");
		const dot = name.indexOf(".");
		if (dot <= 0) return;
		this.globals.lookup(name.slice(0, dot));
		if (named.name?.includes("$$")) node._stdName = named.name;
	},

	// `[N]T` with a named constant (or constant expression) length folds to a number.
	_foldArrayLen(size, scope) {
		const resolve = (name, depth = 0) => {
			const e = depth < 16 ? scope.lookupConstExpr(name) : null;
			return e ? foldConstExpr(e, (n) => resolve(n, depth + 1)) : undefined;
		};
		try {
			const lit = foldConstExpr(size, resolve);
			const n = lit ? Number(lit.value) : Number.NaN;
			return Number.isInteger(n) && n >= 0 ? n : size;
		} catch {
			return size;
		}
	},

	_resolveArrayTypeNode(node, scope) {
		// Fold in place so backends that read the type node see a literal length.
		if (!node.inferLen && node.size?.value === undefined) {
			const n = this._foldArrayLen(node.size, scope);
			if (typeof n === "number")
				node.size = {
					kind: "BasicLit",
					litKind: "INT",
					value: String(n),
					_line: node.size._line,
					_col: node.size._col,
				};
		}
		return {
			kind: "array",
			size: node.inferLen
				? null
				: node.size?.value !== undefined
					? Number(node.size.value)
					: this._foldArrayLen(node.size, scope),
			elem: this.resolveTypeNode(node.elem, scope),
		};
	},

	// `G[X]`: instantiate a generic named type, or expand a generic alias.
	_resolveGenericTypeName(node, scope) {
		const sel = node.expr?.kind === "SelectorExpr" ? node.expr : null;
		const qualified =
			sel?.expr?.kind === "Ident" ? `${sel.expr.name}.${sel.field}` : null;
		const name =
			node.name ??
			(node.expr?.kind === "Ident" ? node.expr.name : null) ??
			qualified;
		const typeArgs = node.typeArgs ?? (node.index ? [node.index] : []);
		const base = name
			? this.types.get(name)
			: node.expr
				? this.resolveTypeNode(node.expr, scope)
				: null;
		if (!base) return this.err(`Unknown type '${name ?? "?"}'`, node);
		if (qualified) this.globals.lookup(sel.expr.name);
		else if (name)
			this._useQualifiedTypeName(node.name ? node : node.expr, base);
		if (base.kind === "named" && base._generic?.isAlias) {
			const aliasArgs = typeArgs.map((n) => this.resolveTypeNode(n, scope));
			node._typeArgs = aliasArgs;
			return this._instantiateGenericAlias(base._generic, aliasArgs);
		}
		if (base.kind === "named" && base._generic) {
			const res = this.instantiateGenericType(base._generic, typeArgs, scope);
			node._typeArgs = res.typeArgs;
			node._genericType = base;
			return res;
		}
		return this.err(`Type '${name ?? "?"}' is not generic`, node);
	},

	_resolveFuncTypeNode(node, scope) {
		const params = node.params.map((p) => this.resolveTypeNode(p.type, scope));
		const returns = node.returnType
			? [this.resolveTypeNode(node.returnType, scope)]
			: [VOID];
		const fn = { kind: "func", params, returns };
		if (node.params.at(-1)?.variadic) fn.variadic = true;
		return fn;
	},

	resolveTypeNodeName(node, scope) {
		if (!node) return ANY;
		if (node.kind === "TypeName" || node.kind === "GenericTypeName") {
			const named = this.types.get(node.name);
			if (named) return named;
		}
		return this.resolveTypeNode(node, scope);
	},

	_resolveStructType(node, scope) {
		const fields = new Map();
		const embeds = [];
		const structFields = [];
		for (const f of node.fields) {
			const ft = this.resolveTypeNode(f.type, scope);
			structFields.push({
				names: f.names,
				type: ft,
				tag: f.tag ?? null,
				embedded: Boolean(f.embedded),
				astType: f.type,
			});
			if (f.embedded) {
				const inner = ft.kind === "pointer" ? ft.base : ft;
				const embedName = (
					f.astType?.name ??
					f.type?.name ??
					f.type?.base?.name ??
					(inner.kind === "named" ? inner.name : "")
				)
					.split(".")
					.pop();
				if (embedName) fields.set(embedName, ft);
				const base = inner.kind === "named" ? inner.underlying : inner;
				if (base?.kind === "struct") {
					for (const [k, v] of base.fields.entries()) fields.set(k, v);
				}
				embeds.push(ft);
			} else {
				for (const n of f.names) fields.set(n, ft);
			}
		}
		return {
			kind: "struct",
			fields,
			methods: new Map(),
			_embeds: embeds,
			_structFields: structFields,
		};
	},

	_resolveInterfaceType(node, scope) {
		const methods = new Map();
		for (const m of node.methods) {
			const params = m.params.map((p) => this.resolveTypeNode(p.type, scope));
			const returns = m.returnType
				? [this.resolveTypeNode(m.returnType, scope)]
				: [VOID];
			const isVariadic =
				m.params.length > 0 && m.params[m.params.length - 1].variadic;
			const mType = { kind: "func", params, returns };
			if (isVariadic) mType.variadic = true;
			methods.set(m.name, mType);
		}
		// Embedded interfaces that carry a type set (`interface{ Integer }`):
		// kept so type-parameter operator checks can follow them.
		const typeSetEmbeds = [];
		if (node.embeds) {
			for (const embed of node.embeds) {
				const resolved = this.resolveTypeNode(embed, scope);
				const base =
					resolved?.kind === "named" ? resolved.underlying : resolved;
				if (base?.kind === "interface") {
					for (const [mName, mType] of base.methods) {
						if (!methods.has(mName)) methods.set(mName, mType);
					}
					if (base.unionConstraint || base._typeSetEmbeds)
						typeSetEmbeds.push(base);
				} else if (!isAny(resolved)) {
					this.err(
						`cannot embed non-interface type ${typeStr(resolved)}`,
						embed,
					);
				}
			}
		}
		const result = { kind: "interface", methods };
		if (node.unionConstraint) result.unionConstraint = node.unionConstraint;
		if (typeSetEmbeds.length > 0) result._typeSetEmbeds = typeSetEmbeds;
		return result;
	},

	// ── Generics — substitution, instantiation, inference ────────────

	substituteType(type, map) {
		if (!type) return type;
		if (type.kind === "typeParam") return map.get(type.name) ?? type;
		const gen = SUBSTITUTE_DISPATCH[type.kind];
		return gen ? gen(this, type, map) : type;
	},

	instantiateGenericFunc(genericType, typeArgs) {
		const map = new Map();
		for (let i = 0; i < genericType.typeParams.length; i++)
			map.set(genericType.typeParams[i].name, typeArgs[i] ?? ANY);
		return this.substituteType(genericType.underlying, map);
	},

	instantiateGenericType(generic, typeArgNodes, scope) {
		const typeArgs = typeArgNodes.map((n) => this.resolveTypeNode(n, scope));
		return this.instantiateGenericWithArgs(generic, typeArgs);
	},

	// One instance per type-argument list.  The instance is cached before its
	// fields are resolved, so a field that names the instance again (`Next
	// *List[T]`, `Children []Tree[T]`, or a cycle through another generic type)
	// reaches the same object instead of recursing forever.
	instantiateGenericWithArgs(generic, typeArgs) {
		const key = typeArgs.map(typeStr).join(",");
		generic._instances ??= new Map();
		const cached = generic._instances.get(key);
		if (cached) {
			this._syncInstanceMethods(generic, cached);
			return cached;
		}
		const map = new Map();
		for (let i = 0; i < generic.typeParams.length; i++)
			map.set(generic.typeParams[i].name, typeArgs[i] ?? ANY);
		const named = {
			kind: "named",
			name: generic.declNode.name,
			typeArgs,
			underlying: null,
			_genericOf: generic,
		};
		generic._instances.set(key, named);
		// Resolve the declaration with its type params in scope (as typeParams,
		// never as value symbols), then substitute the concrete arguments.
		const typeScope = new Scope(this.globals);
		for (const tp of generic.typeParams) typeScope.define(tp.name, tp);
		const underlying = this.resolveTypeNode(generic.declNode.type, typeScope);
		const instantiated = this.substituteType(underlying, map);
		if (instantiated.kind === "struct") {
			instantiated.name = generic.declNode.name;
			instantiated.typeArgs = typeArgs;
			if (!instantiated.methods) instantiated.methods = new Map();
		}
		named.underlying = instantiated;
		named.methods = instantiated.methods;
		named._instMap = map;
		this._syncInstanceMethods(generic, named);
		return named;
	},

	// Methods are collected after types, so an instance created earlier picks
	// up the methods declared since.
	_syncInstanceMethods(generic, named) {
		const methods = named.methods;
		if (!methods || !named._instMap || named._syncing) return;
		// A method signature that names the instance reaches this again.
		named._syncing = true;
		for (const [mName, mType] of generic.methods ?? [])
			if (!methods.has(mName))
				methods.set(mName, this.substituteType(mType, named._instMap));
		// Methods promoted from embedded structs (`Outer[T]` embedding `Base`).
		this._promoteEmbeddedInto(named.underlying);
		named._syncing = false;
	},

	// A[X] for `type A[P any] = T`: resolve T with each P bound to the
	// concrete X, so A[int] is exactly T[int] (generic named types inside T
	// are instantiated normally and keep their identity).
	_instantiateGenericAlias(generic, typeArgs) {
		const { typeParams, declNode } = generic;
		if (typeArgs.length !== typeParams.length) {
			return this.err(
				`got ${typeArgs.length} type arguments but ${declNode.name} has ${typeParams.length} type parameters`,
				declNode,
			);
		}
		const aliasScope = new Scope(this.globals);
		for (let i = 0; i < typeParams.length; i++) {
			const tp = typeParams[i];
			if (tp.constraint) {
				const constraint = this.resolveTypeNode(tp.constraint, this.globals);
				this.checkConstraint(typeArgs[i], constraint, declNode);
			}
			aliasScope.define(tp.name, { kind: "aliasArg", type: typeArgs[i] });
		}
		return this.resolveTypeNode(declNode.type, aliasScope);
	},

	// `explicit` seeds the leading type arguments of a partial instantiation
	// (`F[int](x)`); the rest are inferred from the call arguments.
	inferTypeArgs(genericType, argTypes, explicit = []) {
		const map = new Map();
		for (let i = 0; i < explicit.length; i++)
			map.set(genericType.typeParams[i].name, explicit[i]);
		const params = genericType.underlying.params;
		for (let i = 0; i < params.length && i < argTypes.length; i++)
			this._inferFromPair(params[i], argTypes[i], map);
		for (const tp of genericType.typeParams) {
			if (!map.has(tp.name)) return null;
		}
		return genericType.typeParams.map((tp) => defaultType(map.get(tp.name)));
	},

	_inferFromFuncPair(paramType, argType, map) {
		for (
			let i = 0;
			i < paramType.params.length && i < argType.params.length;
			i++
		)
			this._inferFromPair(paramType.params[i], argType.params[i], map);
		for (
			let i = 0;
			i < paramType.returns.length && i < argType.returns.length;
			i++
		)
			this._inferFromPair(paramType.returns[i], argType.returns[i], map);
	},

	_inferFromStructuredPair(paramType, argType, map) {
		if (paramType.kind === "slice" && argType.kind === "slice")
			this._inferFromPair(paramType.elem, argType.elem, map);
		if (paramType.kind === "map" && argType.kind === "map") {
			this._inferFromPair(paramType.key, argType.key, map);
			this._inferFromPair(paramType.value, argType.value, map);
		}
		if (paramType.kind === "func" && argType.kind === "func")
			this._inferFromFuncPair(paramType, argType, map);
		if (paramType.kind === "tuple" && argType.kind === "tuple") {
			for (
				let i = 0;
				i < paramType.types.length && i < argType.types.length;
				i++
			)
				this._inferFromPair(paramType.types[i], argType.types[i], map);
		}
	},

	_inferFromPair(paramType, argType, map) {
		if (!paramType || !argType) return;
		if (paramType.kind === "typeParam") {
			if (!map.has(paramType.name)) map.set(paramType.name, argType);
			return;
		}
		if (paramType.kind === "named" && paramType.typeArgs) {
			// `iter.Seq[E]` against `iter.Seq[int]`: unify the type arguments;
			// against any other type, its underlying type.
			if (argType.kind === "named" && argType.name === paramType.name) {
				const args = argType.typeArgs ?? [];
				for (let i = 0; i < paramType.typeArgs.length; i++)
					this._inferFromPair(paramType.typeArgs[i], args[i], map);
				return;
			}
			paramType = paramType.underlying;
		}
		if (argType.kind === "named" && argType.underlying)
			argType = argType.underlying;
		this._inferFromStructuredPair(paramType, argType, map);
	},

	_checkUnionConstraint(typeArg, constraint, node) {
		for (const term of constraint.terms) {
			if (term.approx) return;
			const termType = this.resolveTypeNode(term.type, this.globals);
			if (typeStr(typeArg) === typeStr(termType)) return;
		}
		this.err(`type ${typeStr(typeArg)} does not satisfy constraint`, node);
	},

	_checkInterfaceConstraint(typeArg, base, constraint, node) {
		if (base.methods.size === 0 && !base.unionConstraint) return;
		if (base.unionConstraint) {
			this.checkConstraint(typeArg, base.unionConstraint, node);
			return;
		}
		if (!this.implements(typeArg, base, node))
			this.err(
				`type ${typeStr(typeArg)} does not satisfy constraint ${typeStr(constraint)}`,
				node,
			);
	},

	checkConstraint(typeArg, constraint, node) {
		if (!constraint || isAny(constraint)) return;
		if (constraint.kind === "basic" && constraint.name === "comparable") return;
		if (constraint.kind === "UnionConstraint") {
			this._checkUnionConstraint(typeArg, constraint, node);
			return;
		}
		const base =
			constraint.kind === "named" ? constraint.underlying : constraint;
		if (base?.kind === "interface")
			this._checkInterfaceConstraint(typeArg, base, constraint, node);
	},

	resolveType(t) {
		if (!t) return ANY;
		if (t.kind === "basic" && t.alias) {
			const found = this.types.get(t.alias);
			if (found) return found;
		}
		if (
			t.kind === "named" &&
			(!t.typeArgs || t.typeArgs.length === 0) &&
			(!t.underlying || !t.methods)
		) {
			const found = this.types.get(t.name);
			if (found) return found;
		}
		if (t.kind === "named" && t.typeArgs?.length)
			return this._withGenericMethods(t);
		return t;
	},

	// A substituted generic instance (e.g. Stack[int] from an inferred call)
	// drops the methods map; re-derive it from the generic declaration.
	_withGenericMethods(t) {
		const decl = this.types.get(t.name);
		const generic = decl?._generic;
		// Struct generics only: codegen has no receiver support for generic
		// slice/map/func named types, so those keep the baseline diagnostics.
		if (this.resolveType(decl?.underlying)?.kind !== "struct") return t;
		if (!generic?.methods || generic.methods.size === 0) return t;
		if (t.methods && generic.methods.size <= t.methods.size) return t;
		const map = new Map();
		for (let i = 0; i < generic.typeParams.length; i++)
			map.set(generic.typeParams[i].name, t.typeArgs[i] ?? ANY);
		const methods = new Map(t.methods);
		for (const [name, mType] of generic.methods)
			if (!methods.has(name))
				methods.set(name, this.substituteType(mType, map));
		return { ...t, methods };
	},

	// ── Field type lookup ─────────────────────────────────────────────

	fieldType(baseType, field, node) {
		baseType = this.resolveType(baseType);
		if (!baseType || isAny(baseType))
			return baseType?._tainted ? TAINTED_ANY : ANY;
		if (this._isTransparentPointerField(baseType, field))
			baseType = this.resolveType(baseType.base);
		if (baseType.kind === "named" && baseType.methods?.has(field))
			return baseType.methods.get(field);
		let base = baseType.kind === "named" ? baseType.underlying : baseType;
		base = this.resolveType(base);
		return this._dispatchFieldType(base, baseType, field, node);
	},

	_isTransparentPointerField(baseType, field) {
		return (
			baseType.kind === "pointer" &&
			field !== "value" &&
			baseType.base?.kind === "named"
		);
	},

	_dispatchFieldType(base, baseType, field, node) {
		switch (base?.kind) {
			case "struct":
				return this._fieldTypeStruct(base, baseType, field, node);
			case "interface":
				return this._fieldTypeInterface(base, baseType, field, node);
			case "namespace":
				return this._fieldTypeNamespace(base, field, node);
			case "shared":
			case "simd":
				if (base.methods?.has(field)) return base.methods.get(field);
				return this.err(`No method '${field}' on ${typeStr(baseType)}`, node);
			case "slice":
				if (isTypedArraySlice(base)) {
					return this._fieldTypeTypedArraySlice(base, baseType, field, node);
				}
				break;
			default:
				break;
		}
		if (base && !isAny(base))
			return this._fieldTypeBadAccess(base, baseType, field, node);
		return ANY;
	},

	_fieldTypeStruct(base, baseType, field, node) {
		if (base.fields?.has(field)) {
			if (
				field.startsWith("_") &&
				(baseType?.name?.startsWith("strings.") ||
					baseType?.name?.startsWith("bytes."))
			) {
				return this.err(
					`Cannot refer to unexported field '${field}' on ${typeStr(baseType)}`,
					node,
				);
			}
			return base.fields.get(field);
		}
		if (base.methods?.has(field)) return base.methods.get(field);
		const typeName = baseType?.name || base.name;
		if (typeName) {
			const dName = displayTypeName(typeName);
			const shortName = typeName.includes("$$")
				? typeName.split("$$")[0]
				: typeName.includes(".")
					? typeName.split(".").pop()
					: typeName;
			for (const key of [
				`${dName}.${field}`,
				`${typeName}.${field}`,
				`${shortName}.${field}`,
			]) {
				if (EXCLUDED_STDLIB_MEMBERS.has(key)) {
					return this.err(
						`${dName}.${field} is not available: ${EXCLUDED_STDLIB_MEMBERS.get(key)}`,
						node,
					);
				}
			}
		}
		return this.err(`No field '${field}' on ${typeStr(baseType)}`, node);
	},

	_fieldTypeInterface(base, baseType, field, node) {
		if (base.methods?.has(field)) return base.methods.get(field);
		if (base.fields?.has(field)) return base.fields.get(field);
		const typeName = baseType?.name || base.name;
		if (typeName) {
			const dName = displayTypeName(typeName);
			const shortName = typeName.includes("$$")
				? typeName.split("$$")[0]
				: typeName.includes(".")
					? typeName.split(".").pop()
					: typeName;
			for (const key of [
				`${dName}.${field}`,
				`${typeName}.${field}`,
				`${shortName}.${field}`,
			]) {
				if (EXCLUDED_STDLIB_MEMBERS.has(key)) {
					return this.err(
						`${dName}.${field} is not available: ${EXCLUDED_STDLIB_MEMBERS.get(key)}`,
						node,
					);
				}
			}
		}
		if (base._excluded?.has(field))
			return this.err(`No member '${field}' on ${typeStr(baseType)}`, node);
		if (base._isOpen) return ANY;
		return this.err(`No method '${field}' on ${typeStr(baseType)}`, node);
	},

	_fieldTypeTypedArraySlice(base, baseType, field, node) {
		const taName = typedArrayConstructorForElem(base.elem);
		if (taName) {
			const taType = this.types.get(taName);
			if (taType) {
				const underlying = taType.kind === "named" ? taType.underlying : taType;
				if (underlying?.fields?.has(field)) return underlying.fields.get(field);
				if (underlying?.methods?.has(field)) {
					const m = underlying.methods.get(field);
					if (field === "subarray" || field === "slice") {
						return {
							kind: "func",
							params: m.params,
							returns: [baseType],
							variadic: m.variadic,
						};
					}
					return m;
				}
			}
		}
		return this._fieldTypeBadAccess(base, baseType, field, node);
	},

	_fieldTypeBadAccess(base, baseType, field, node) {
		if (base.kind === "pointer" && field === "value") return base.base ?? ANY;
		const badKinds = ["basic", "slice", "array", "map", "func", "tuple"];
		if (badKinds.includes(base.kind))
			return this.err(
				`${typeStr(baseType ?? base)} has no field or method '${field}'`,
				node,
			);
		return ANY;
	},

	_fieldTypeNamespace(base, field, node) {
		if (base._gofront && field.length > 0 && field[0] >= "a" && field[0] <= "z")
			return this.err(
				`cannot refer to unexported name ${base.name}.${field}`,
				node,
			);
		// Go-source stdlib member: backends emit the mangled top-level name.
		const mangled = base._mangle?.get(field);
		if (mangled) {
			node._stdName = mangled;
			return base.members[field];
		}
		if (field in base.members) {
			if (
				(this.target === "wasm" || this.target === "both") &&
				WASM_STDLIB_MEMBERS.has(base.name)
			) {
				const allowed = WASM_STDLIB_MEMBERS.get(base.name);
				if (allowed && !allowed.has(field)) {
					const name = `${base.name}.${field}`;
					this.recordBlocker("unsupported stdlib member", name);
					return this.err(
						`'${name}' is not yet available in wasm packages`,
						node,
						"move this call to a JS package, or use a supported alternative",
					);
				}
			}
			return base.members[field];
		}
		const excluded = EXCLUDED_STDLIB_MEMBERS.get(`${base.name}.${field}`);
		if (excluded)
			return this.err(
				`${base.name}.${field} is not available: ${excluded}`,
				node,
			);
		return this.err(`No member '${field}' in namespace ${base.name}`, node);
	},

	resolveJsonFields(structType) {
		return resolveJsonFields(structType);
	},
};

function isExported(name) {
	if (!name || typeof name !== "string") return false;
	const code = name.charCodeAt(0);
	return code >= 65 && code <= 90;
}

function _processJsonField(
	f,
	depth,
	path,
	visited,
	queue,
	candidates,
	index,
	pos,
) {
	const tagInfo = parseJsonTag(f.tag);
	if (tagInfo.ignored) return;

	if (f.embedded) {
		const isPtr = f.type.kind === "pointer" || f.type.kind === "PointerType";
		const inner = isPtr ? f.type.base : f.type;
		const embedStruct = inner.kind === "named" ? inner.underlying : inner;
		const embedName = (
			f.astType?.name ??
			f.astType?.base?.name ??
			inner.name ??
			""
		)
			.split(".")
			.pop();

		if (tagInfo.name !== null) {
			if (isExported(embedName)) {
				candidates.push({
					jsonKey: tagInfo.name,
					goName: embedName,
					type: f.type,
					omitempty: tagInfo.omitempty,
					depth,
					tagged: true,
					isEmbedded: true,
					index: [...index, pos],
					path: [...path, { name: embedName, isPtr, typeName: embedName }],
				});
			}
		} else if (embedStruct?.kind === "struct") {
			if (!visited.has(embedStruct)) {
				const nextVisited = new Set(visited);
				nextVisited.add(embedStruct);
				queue.push({
					struct: embedStruct,
					depth: depth + 1,
					index: [...index, pos],
					path: [...path, { name: embedName, isPtr, typeName: embedName }],
					visited: nextVisited,
				});
			}
		}
		return;
	}

	for (const [i, name] of f.names.entries()) {
		if (!isExported(name)) continue;
		candidates.push({
			index: [...index, pos + i],
			jsonKey: tagInfo.name !== null ? tagInfo.name : name,
			goName: name,
			type: f.type,
			omitempty: tagInfo.omitempty,
			quoted: tagInfo.options.includes("string"),
			depth,
			tagged: tagInfo.name !== null,
			path: [...path, { name, isPtr: false }],
		});
	}
}

function _resolveCandidateCollisions(candidates) {
	const byKey = new Map();
	for (const cand of candidates) {
		if (!byKey.has(cand.jsonKey)) byKey.set(cand.jsonKey, []);
		byKey.get(cand.jsonKey).push(cand);
	}

	const winningFields = [];
	for (const [, group] of byKey.entries()) {
		let minDepth = Infinity;
		for (const c of group) {
			if (c.depth < minDepth) minDepth = c.depth;
		}

		const atMin = group.filter((c) => c.depth === minDepth);
		if (atMin.length === 1) {
			winningFields.push(atMin[0]);
		} else {
			const tagged = atMin.filter((c) => c.tagged);
			if (tagged.length === 1) winningFields.push(tagged[0]);
		}
	}

	// Go orders the fields of a struct by their index sequence, so a promoted
	// field sits where its embedded struct is declared.
	winningFields.sort((a, b) => compareIndex(a.index, b.index));
	return winningFields;
}

function compareIndex(a, b) {
	for (let i = 0; i < a.length && i < b.length; i++)
		if (a[i] !== b[i]) return a[i] - b[i];
	return a.length - b.length;
}

export function resolveJsonFields(structType) {
	if (!structType) return [];
	const underlying =
		structType.kind === "named" ? structType.underlying : structType;
	if (underlying?.kind !== "struct") return [];
	if (underlying._jsonFields) return underlying._jsonFields;

	const queue = [
		{
			struct: underlying,
			depth: 0,
			path: [],
			index: [],
			visited: new Set([underlying]),
		},
	];
	const candidates = [];

	while (queue.length > 0) {
		const { struct: curr, depth, path, index, visited } = queue.shift();
		if (curr?.kind !== "struct") continue;

		// Each name of a `A, B int` field is its own field, as in Go.
		let pos = 0;
		for (const f of curr._structFields || []) {
			_processJsonField(f, depth, path, visited, queue, candidates, index, pos);
			pos += f.embedded ? 1 : (f.names?.length ?? 1);
		}
	}

	const winning = _resolveCandidateCollisions(candidates);
	underlying._jsonFields = winning;
	return winning;
}
