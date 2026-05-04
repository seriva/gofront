// Type resolution methods — resolveTypeNode, resolveType, fieldType, generics.
// Installed as a mixin on TypeChecker.prototype.

import {
	ANY,
	BASIC_TYPES,
	defaultType,
	isAny,
	Scope,
	TAINTED_ANY,
	typeStr,
	VOID,
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
		};
	},
	interface: (s, type, map) => {
		const methods = new Map();
		for (const [k, v] of type.methods) methods.set(k, s.substituteType(v, map));
		return { kind: "interface", name: type.name, methods };
	},
	named: (s, type, map) => ({
		kind: "named",
		name: type.name,
		underlying: s.substituteType(type.underlying, map),
	}),
};

/** @type {ThisType<TypeChecker>} */
export const resolveMethods = {
	resolveTypeNode(node, scope) {
		if (!node) return ANY;
		switch (node.kind) {
			case "TypeName": {
				if (BASIC_TYPES[node.name]) return BASIC_TYPES[node.name];
				if (node.name === "comparable")
					return { kind: "basic", name: "comparable" };
				if (scope) {
					const fromScope = scope.lookup(node.name);
					if (fromScope?.kind === "typeParam") return fromScope;
				}
				const named = this.types.get(node.name);
				if (named) return named;
				return this.err(`Unknown type '${node.name}'`, node);
			}
			case "GenericTypeName": {
				const base = this.types.get(node.name);
				if (!base) return this.err(`Unknown type '${node.name}'`, node);
				if (base.kind === "named" && base._generic)
					return this.instantiateGenericType(
						base._generic,
						node.typeArgs,
						scope,
					);
				return this.err(`Type '${node.name}' is not generic`, node);
			}
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

	_resolveArrayTypeNode(node, scope) {
		return {
			kind: "array",
			size: node.inferLen
				? null
				: node.size?.value !== undefined
					? Number(node.size.value)
					: node.size,
			elem: this.resolveTypeNode(node.elem, scope),
		};
	},

	_resolveFuncTypeNode(node, scope) {
		const params = node.params.map((p) => this.resolveTypeNode(p.type, scope));
		const returns = node.returnType
			? [this.resolveTypeNode(node.returnType, scope)]
			: [VOID];
		return { kind: "func", params, returns };
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
		for (const f of node.fields) {
			const ft = this.resolveTypeNode(f.type, scope);
			if (f.embedded) {
				const base = ft.kind === "named" ? ft.underlying : ft;
				if (base?.kind === "struct") {
					for (const [k, v] of base.fields.entries()) fields.set(k, v);
				}
				embeds.push(ft);
			} else {
				for (const n of f.names) fields.set(n, ft);
			}
		}
		return { kind: "struct", fields, methods: new Map(), _embeds: embeds };
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
		if (node.embeds) {
			for (const embed of node.embeds) {
				const resolved = this.resolveTypeNode(embed, scope);
				const base =
					resolved?.kind === "named" ? resolved.underlying : resolved;
				if (base?.kind === "interface") {
					for (const [mName, mType] of base.methods) {
						if (!methods.has(mName)) methods.set(mName, mType);
					}
				} else if (!isAny(resolved)) {
					this.err(
						`cannot embed non-interface type ${typeStr(resolved)}`,
						embed,
					);
				}
			}
		}
		return { kind: "interface", methods };
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
		const map = new Map();
		const typeArgs = typeArgNodes.map((n) => this.resolveTypeNode(n, scope));
		for (let i = 0; i < generic.typeParams.length; i++)
			map.set(generic.typeParams[i].name, typeArgs[i] ?? ANY);
		const typeScope = new Scope(this.globals);
		for (const [name, type] of map) typeScope.define(name, type);
		const underlying = this.resolveTypeNode(generic.declNode.type, typeScope);
		const instantiated = this.substituteType(underlying, map);
		if (instantiated.kind === "struct") {
			instantiated.name = generic.declNode.name;
			if (!instantiated.methods) instantiated.methods = new Map();
			if (generic.methods) {
				for (const [mName, mType] of generic.methods)
					instantiated.methods.set(mName, this.substituteType(mType, map));
			}
		}
		return {
			kind: "named",
			name: generic.declNode.name,
			underlying: instantiated,
		};
	},

	inferTypeArgs(genericType, argTypes) {
		const map = new Map();
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
	},

	_inferFromPair(paramType, argType, map) {
		if (!paramType || !argType) return;
		if (paramType.kind === "typeParam") {
			if (!map.has(paramType.name)) map.set(paramType.name, argType);
			return;
		}
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
		return t;
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
			default:
				if (base && !isAny(base))
					return this._fieldTypeBadAccess(base, baseType, field, node);
				return ANY;
		}
	},

	_fieldTypeStruct(base, baseType, field, node) {
		if (base.fields?.has(field)) return base.fields.get(field);
		if (base.methods?.has(field)) return base.methods.get(field);
		return this.err(`No field '${field}' on ${typeStr(baseType)}`, node);
	},

	_fieldTypeInterface(base, baseType, field, node) {
		if (base.methods?.has(field)) return base.methods.get(field);
		return this.err(`No method '${field}' on ${typeStr(baseType)}`, node);
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
		if (field in base.members) return base.members[field];
		return this.err(`No member '${field}' in namespace ${base.name}`, node);
	},
};
