// Type resolution methods — resolveTypeNode, resolveType, fieldType, generics.
// Installed as a mixin on TypeChecker.prototype.

import { parseJsonTag } from "../parser/struct-tag.js";
import { foldConstExpr } from "./const-fold.js";
import { exprText, operandKind, typeNodeText } from "./operand-text.js";
import { EXCLUDED_STDLIB_MEMBERS } from "./stdlib/excluded.js";
import {
	ANY,
	BASIC_TYPES,
	COMPARABLE,
	DECLARED_ANY,
	declPackages,
	defaultType,
	displayTypeName,
	identical,
	isAmbiguousFieldSelector,
	isAmbiguousPromotion,
	isAny,
	isExported,
	isMethodPromotedOverField,
	isTypedArraySlice,
	Scope,
	TAINTED_ANY,
	typedArrayConstructorForElem,
	typeStr,
	underlyingOf,
	VOID,
	WASM_STDLIB_MEMBERS,
} from "./types.js";

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

// Dispatch table for substituteType — keyed by type.kind.
// Nesting depth of in-progress instances of one generic type before the
// instantiation is reported as a cycle.
const MAX_INSTANTIATION_DEPTH = 32;

// Type nodes in a constraint position, where a constraint interface may
// appear. A property of the AST node, so it is shared by every checker: an
// importing package resolves the constraints of the imported generics.
const CONSTRAINT_POS = new WeakSet();

// Two imported packages may both declare `Pt`, so the cache key of an
// instance tells declarations apart by identity instead of by display name.
const declIds = new WeakMap();
let nextDeclId = 0;
function declId(t) {
	if (!declIds.has(t)) declIds.set(t, ++nextDeclId);
	return declIds.get(t);
}

// Go infers T from the "largest" untyped constant kind (int < rune < float <
// complex), and a typed argument beats any untyped one.
const UNTYPED_RANK = { int: 0, int32: 1, float64: 2, complex128: 3 };
function untypedWins(prev, next) {
	if (prev.kind !== "untyped") return false;
	if (next.kind !== "untyped") return true;
	return (UNTYPED_RANK[next.base] ?? 0) > (UNTYPED_RANK[prev.base] ?? 0);
}

// Node count of a type, so a request that keeps growing can be told from one
// that merely repeats.
function typeSize(t) {
	switch (t?.kind) {
		case "named":
			return 1 + (t.typeArgs ?? []).reduce((n, a) => n + typeSize(a), 0);
		case "pointer":
			return 1 + typeSize(t.base);
		case "slice":
		case "array":
			return 1 + typeSize(t.elem);
		case "map":
			return 1 + typeSize(t.key) + typeSize(t.value);
		case "func":
			return (
				1 +
				[...(t.params ?? []), ...(t.returns ?? [])].reduce(
					(n, a) => n + typeSize(a),
					0,
				)
			);
		default:
			return 1;
	}
}

// Whether `t` mentions one of the type parameters `params` below its root.
function nestsTypeParam(t, params) {
	const mentions = (u) => {
		switch (u?.kind) {
			case "typeParam":
				return params.includes(u);
			case "pointer":
				return mentions(u.base);
			case "slice":
			case "array":
				return mentions(u.elem);
			case "map":
				return mentions(u.key) || mentions(u.value);
			case "func":
				return [...(u.params ?? []), ...(u.returns ?? [])].some(mentions);
			case "named":
				return (u.typeArgs ?? []).some(mentions);
			default:
				return false;
		}
	};
	return t?.kind !== "typeParam" && mentions(t);
}

// An anonymous struct is identified by its fields: names, embedded flags,
// tags and field types.
function structInstanceKey(t) {
	const fields =
		t._structFields ??
		[...t.fields].map(([n, ft]) => ({
			names: [n],
			type: ft,
		}));
	const parts = fields.map(
		(f) =>
			`${f.embedded ? "~" : ""}${(f.names ?? []).join("|")} ${instanceKey(f.type)}${f.tag ? ` ${JSON.stringify(f.tag)}` : ""}`,
	);
	return `struct{${parts.join("; ")}}`;
}

function instanceKey(t) {
	switch (t?.kind) {
		case "named":
			return t.typeArgs?.length
				? `${displayTypeName(t.name)}[${t.typeArgs.map(instanceKey).join(", ")}]`
				: `${typeStr(t)}#${declId(t)}`;
		case "struct":
			return t.name ? typeStr(t) : structInstanceKey(t);
		case "pointer":
			return `*${instanceKey(t.base)}`;
		case "slice":
			return `[]${instanceKey(t.elem)}`;
		case "array":
			return `[${t.size ?? "..."}]${instanceKey(t.elem)}`;
		case "map":
			return `map[${instanceKey(t.key)}]${instanceKey(t.value)}`;
		default:
			return typeStr(t);
	}
}

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
		// A method copied from a generic embedded struct keeps its receiver kind.
		...(Object.hasOwn(type, "_ptrRecv") && { _ptrRecv: type._ptrRecv }),
		// ... and the package that declared it.
		...(type._pkgId !== undefined && { _pkgId: type._pkgId }),
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
			...(type._fieldOwner && { _fieldOwner: type._fieldOwner }),
			// The JSON codecs read the field types from here.
			_structFields: type._structFields?.map((f) => ({
				...f,
				type: s.substituteType(f.type, map),
			})),
		};
	},
	interface: (s, type, map) => {
		const methods = new Map();
		for (const [k, v] of type.methods) methods.set(k, s.substituteType(v, map));
		const out = { kind: "interface", name: type.name, methods };
		// The type set follows the substitution (`interface{ ~[]E }` with E=int).
		if (type.unionConstraint)
			out.unionConstraint = {
				...type.unionConstraint,
				terms: type.unionConstraint.terms.map((term) => ({
					...term,
					resolved: s.substituteType(
						term.resolved ?? s.resolveTypeNode(term.type, type._unionScope),
						map,
					),
				})),
			};
		if (type._typeSetEmbeds)
			out._typeSetEmbeds = type._typeSetEmbeds.map((e) =>
				s.substituteType(e, map),
			);
		return out;
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
			...(type._pkgName && { _pkgName: type._pkgName }),
			// A copy is still the declaration it came from (see `identical`).
			_substOf: type._substOf ?? type,
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
				if (BASIC_TYPES[node.name])
					return node.name === "any" ? DECLARED_ANY : BASIC_TYPES[node.name];
				if (node.name === "comparable")
					return this._checkConstraintUse(COMPARABLE, node);
				if (scope) {
					const fromScope = scope.lookup(node.name);
					if (fromScope?.kind === "typeParam") return fromScope;
					if (fromScope?.kind === "aliasArg") return fromScope.type;
				}
				const named = this._typeOfName(node.name, node, scope);
				if (named) {
					this._useQualifiedTypeName(node, named);
					return this._checkConstraintUse(named, node);
				}
				const jsOnly = this._jsOnlyMember(node.name);
				if (jsOnly) return this._errJsOnly(jsOnly, node);
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
				this._markConstraintPos(node.constraint);
				const constraint = node.constraint
					? this.resolveTypeNode(node.constraint, scope)
					: ANY;
				return { kind: "typeParam", name: node.name, constraint };
			}
			case "UnionConstraint":
				// Terms such as `~[]E` resolve later in the scope that declares `E`.
				node._scope ??= scope;
				this._checkApproxTerms(node, scope);
				return node;
			case "SliceType":
				return { kind: "slice", elem: this.resolveTypeNode(node.elem, scope) };
			case "MapType": {
				const key = this.resolveTypeNode(node.key, scope);
				this._checkMapKey(key, node.key);
				return {
					kind: "map",
					key,
					value: this.resolveTypeNode(node.value, scope),
				};
			}
			case "PointerType":
				return {
					kind: "pointer",
					base: this.resolveTypeNode(node.base, scope),
				};
			case "StructType":
				return this._resolveStructType(node, scope);
			case "InterfaceType":
				return this._checkConstraintUse(
					this._resolveInterfaceType(node, scope),
					node,
				);
			case "UnaryExpr":
				// `new(*T)`: the parser reads the pointer type as a dereference.
				if (node.op !== "*") return ANY;
				return {
					kind: "pointer",
					base: this.resolveTypeNode(node.operand, scope),
				};
			case "Ident":
				// An Ident in a type position (`__q{1}`, `new(__q)`) never goes
				// through checkExpr, so tag it as the type reference it is.
				node._isTypeRef = true;
				this._tagDeclTypeIdent(node, scope);
				return this.resolveTypeNode(
					{ kind: "TypeName", name: node.name },
					scope,
				);
			case "SelectorExpr":
				// `pkg.T{}` composite literal — the parser keeps the type as a
				// SelectorExpr; resolve it like a qualified TypeName.
				return (
					this._resolveSelectorType(node, scope) ??
					// `pv.X{}`: a field or method value stands where a type must.
					this._notATypeSelector(node, scope)
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

	// ── Constraint interfaces outside constraints ───────────────────

	// Records a type node that sits in a constraint position (a type
	// parameter's constraint, an interface's embedded element or union term,
	// the right-hand side of a type declaration), where a constraint
	// interface is allowed.
	_markConstraintPos(node) {
		if (!node || typeof node !== "object") return;
		if (node.kind === "UnionConstraint") {
			for (const term of node.terms) this._markConstraintPos(term.type);
			return;
		}
		CONSTRAINT_POS.add(node);
	},

	// `inner` stands for `node` (a rewritten qualified name).
	_inheritConstraintPos(node, inner) {
		if (CONSTRAINT_POS.has(node)) CONSTRAINT_POS.add(inner);
	},

	// An interface's embedded elements and union terms are constraint positions.
	_markInterfaceElements(node) {
		for (const embed of node.embeds ?? []) this._markConstraintPos(embed);
		this._markConstraintPos(node.unionConstraint);
		for (const union of node.extraUnions ?? []) this._markConstraintPos(union);
	},

	// `~T` needs a `T` that is its own underlying type and not an interface.
	// Composite terms (`~[]E`) are their own underlying type and may mention
	// type parameters that are not in `scope`, so only a type name is checked.
	_checkApproxTerms(union, scope) {
		for (const term of union.terms)
			if (term.approx) this._checkApproxTerm(term, scope);
	},

	_checkApproxTerm(term, scope) {
		if (term.type?.kind === "GenericTypeName") {
			// `~Box[int]` names a defined type; a generic alias is its target.
			const g = this.types.get(term.type.name)?._generic;
			if (g && !g.isAlias)
				this.err("invalid use of ~ (an instantiated generic type)", term);
			return;
		}
		if (term.type?.kind !== "TypeName") return;
		const t = this.resolveTypeNode(term.type, scope);
		const base = this._deepUnderlying(t);
		if (!base || t._tainted || base._tainted) return;
		if (t.kind === "typeParam")
			this.err(
				`invalid use of ~ (type in term ~${typeStr(t)} cannot be a type parameter)`,
				term,
			);
		else if (base === COMPARABLE)
			this.err("invalid use of ~ (comparable is an interface)", term);
		else if (base.kind === "interface")
			this.err(`invalid use of ~ (${typeStr(t)} is an interface)`, term);
		else if (t.kind === "named" && !identical(base, t))
			this.err(
				`invalid use of ~ (underlying type of ${typeStr(t)} is ${typeStr(base)})`,
				term,
			);
	},

	// Marks the constraint positions of top-level declarations before any
	// type resolves (constraints resolve lazily from several places).
	_markConstraintPositions(programs) {
		for (const p of programs) {
			for (const d of p.decls) {
				if (d.kind === "TypeDecl") this._markConstraintPos(d.type);
				for (const tp of d.typeParams ?? [])
					this._markConstraintPos(tp.constraint);
			}
		}
	},

	// A constraint interface (one with a type set, or comparable) resolved
	// outside a constraint position is an error. A type whose declaration has
	// not resolved yet is judged once every package-level type has.
	_checkConstraintUse(type, node) {
		if (CONSTRAINT_POS.has(node)) return type;
		if (type?.kind === "named" && type.underlying == null) {
			this._pendingConstraintUses.push({
				type,
				node,
				file: this._currentFile,
				source: this._currentSource,
			});
			return type;
		}
		this._reportConstraintUse(type, node);
		return type;
	},

	_reportConstraintUse(type, node) {
		const u = this._deepUnderlying(type);
		if (u === COMPARABLE || (u?.kind === "interface" && u._comparable)) {
			this.err(
				`cannot use type ${typeStr(type)} outside a type constraint: interface is (or embeds) comparable`,
				node,
			);
		} else if (
			u?.kind === "interface" &&
			(u.unionConstraint || u._typeSetEmbeds)
		) {
			this.err(
				`cannot use type ${typeStr(type)} outside a type constraint: interface contains type constraints`,
				node,
			);
		}
	},

	_flushConstraintUses() {
		const pending = this._pendingConstraintUses;
		if (pending.length === 0) return;
		this._pendingConstraintUses = [];
		const file = this._currentFile;
		const source = this._currentSource;
		for (const u of pending) {
			this._currentFile = u.file;
			this._currentSource = u.source;
			if (u.mapKey) this._checkMapKey(u.mapKey, u.node);
			else this._reportConstraintUse(u.type, u.node);
		}
		this._currentFile = file;
		this._currentSource = source;
	},

	// `pkg.Name` when `pkg` is a Go-source package whose `js` files declare
	// Name and this package is wasm or both (those files are not loaded).
	_jsOnlyMember(qualified) {
		if (this.target !== "wasm" && this.target !== "both") return null;
		const dot = qualified.indexOf(".");
		if (dot < 0) return null;
		const ns = this.globals.lookup(qualified.slice(0, dot));
		return ns?._jsOnly?.has(qualified.slice(dot + 1)) ? qualified : null;
	},

	_errJsOnly(qualified, node) {
		this.recordBlocker("unsupported stdlib member", qualified);
		return this.err(
			`'${qualified}' is only available in js packages`,
			node,
			"move this call to a JS package",
		);
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

	// `pkg.T` as a composite literal's type (the parser keeps a SelectorExpr):
	// the resolved or error type, or undefined when `node` names no type.
	_resolveSelectorType(node, scope) {
		if (node.expr?.kind !== "Ident" || typeof node.field !== "string") return;
		const named = this._resolveQualifiedType(
			node.expr.name,
			node.field,
			this._positioned(node),
			scope,
			true,
		);
		if (!named || named._tainted) return named;
		// Never reaches checkExpr: tag the qualifier as the package name it is
		// so JS output does not rename it.
		node.expr._isNamespace = true;
		const inner = { kind: "TypeName", name: `${node.expr.name}.${node.field}` };
		this._inheritConstraintPos(node, inner);
		const resolved = this.resolveTypeNode(inner, scope);
		this._useQualifiedTypeName(node, resolved);
		return resolved;
	},

	// The type `name` names in a type position: a qualified name is decided by
	// what its qualifier is (see `_resolveQualifiedType`).
	_typeOfName(name, node, scope) {
		const dot = name.indexOf(".");
		return dot > 0
			? this._resolveQualifiedType(
					name.slice(0, dot),
					name.slice(dot + 1),
					node,
					scope,
				)
			: this._visibleType(name, scope);
	},

	// `qual.member` where a type is expected: what `qual` is in the file being
	// checked decides the answer. A package resolves `member` among the types
	// it declares (undefined when it has none); an untyped npm import is a
	// js-only value in a wasm or both package; any other value is no type.
	// Reports and returns the error type for the last two, else the type or
	// undefined. `literal` (a composite literal's type) also counts a
	// predeclared value such as `console`, which a type name leaves unknown.
	_resolveQualifiedType(qual, member, node, scope, literal = false) {
		const bad = this._qualifierNotAType(qual, member, node, scope, literal);
		return bad ?? this._visibleType(`${qual}.${member}`, scope);
	},

	_errNotExported(pkg, name, node) {
		return this.err(`name ${name} not exported by package ${pkg}`, node);
	},

	// Whether `name`, declared by another package, is hidden from this one. The
	// generated Go (see `_ungated`) reaches into any package it names.
	_unexportedForeign(name) {
		return this._ungated === 0 && name.length > 0 && !isExported(name);
	},

	_qualifierNotAType(qual, member, node, scope, literal) {
		if (this._ungated > 0) return null;
		const here = scope ?? this.globals;
		const owner = here.lookupScope(qual);
		const bound = owner?.object(qual);
		if (!bound || bound.type?.kind === "typeParam") return null;
		here.lookup(qual);
		if (this._isImportScope(owner) && this._untypedImports.has(qual))
			return this.target === "wasm" || this.target === "both"
				? this._errJsOnly(`${qual}.${member}`, node)
				: null;
		if (bound.type?._gofront && this._unexportedForeign(member))
			return this._errNotExported(qual, member, node);
		const isValue = !["pkg", "type"].includes(bound.kind);
		if (isValue && (literal || owner !== this.universe))
			return this.err(`${qual}.${member} is not a type`, node);
		return null;
	},

	// `[N]T` with a named constant (or constant expression) length folds to a number.
	_foldArrayLen(size, scope) {
		const resolve = (name, depth = 0) => {
			const e = depth < 16 ? scope.lookupConstExpr(name) : null;
			return e ? foldConstExpr(e, (n) => resolve(n, depth + 1)) : undefined;
		};
		let n = Number.NaN;
		try {
			const lit = foldConstExpr(size, resolve);
			n = lit ? Number(lit.value) : Number.NaN;
		} catch {
			// fall through to the checker's evaluator
		}
		// `[math.MaxInt8]T`: a package constant the AST folder cannot see.
		if (!Number.isInteger(n))
			n = this._constIntValue(size, scope) ?? Number.NaN;
		if (!Number.isInteger(n)) {
			this._reportNonConstantArrayLen(size, scope);
			return size;
		}
		this._useQualifiedConsts(size);
		if (n >= 0) return n;
		this.err(
			`invalid array length ${exprText(size)} (untyped int constant ${n})`,
			size,
		);
		return 0;
	},

	// A length that is not a constant at all (`[len(s)]T` with a slice, `[n]T`
	// with a variable) cannot size an array.  The operand's type is checked
	// first, so it counts as used.
	_reportNonConstantArrayLen(size, scope) {
		if (size._type === undefined) this.checkExpr(size, scope);
		this.err(
			`invalid array length ${exprText(size)} (${operandKind(size, typeStr(size._type), false)}): must be constant`,
			size,
		);
	},

	// An array length must be an integer constant: `[1 == 1]T`, `["a"]T`,
	// `[nil]T`, `[2.5]T`, `[2i]T` and a typed float constant are rejected.
	_reportNonIntegerArrayLen(size, scope) {
		const what = this._nonIntegerConst(size, scope);
		if (!what) return false;
		this.err(
			`invalid array length ${exprText(size)} (${what}): must be integer`,
			size,
		);
		return true;
	},

	// `pkg.K` inside a folded array length counts as using the import.
	_useQualifiedConsts(node) {
		if (!node || typeof node !== "object") return;
		if (node.kind === "SelectorExpr" && node.expr?.kind === "Ident")
			this.globals.lookup(node.expr.name);
		for (const key of ["expr", "left", "right", "operand"])
			this._useQualifiedConsts(node[key]);
		for (const arg of node.args ?? []) this._useQualifiedConsts(arg);
	},

	_resolveArrayTypeNode(node, scope) {
		if (
			!node.inferLen &&
			this._reportNonIntegerArrayLen(node._sizeExpr ?? node.size, scope)
		)
			return {
				kind: "array",
				size: 0,
				elem: this.resolveTypeNode(node.elem, scope),
			};
		// Fold in place so backends that read the type node see a literal length.
		// The node may come from the parse cache: keep the original expression so
		// a later compile of the same AST still counts `pkg.K` as using `pkg`
		// and still reports an invalid length.
		if (node._sizeExpr) this._foldArrayLen(node._sizeExpr, scope);
		else if (!node.inferLen && node.size?.value === undefined) {
			const n = this._foldArrayLen(node.size, scope);
			if (typeof n === "number") {
				node._sizeExpr = node.size;
				node.size = {
					kind: "BasicLit",
					litKind: "INT",
					value: String(n),
					_line: node.size._line,
					_col: node.size._col,
				};
			}
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
	// Marks an Ident in a type position by the binding it resolves to: JS output
	// emits a declared type under its Go name, and looks a type parameter up by
	// its name, so references to either keep it.  Basic types and alias
	// arguments name no declaration.
	_tagDeclTypeIdent(node, scope) {
		if (BASIC_TYPES[node.name] || node.name === "comparable") return;
		const owner = scope?.lookupScope(node.name);
		const bound = owner?.get(node.name);
		if (bound?.kind === "typeParam") node._namesTypeParam = true;
		else if (bound?.kind === "aliasArg") return;
		// Dot-imported and predeclared types are known by the type table only.
		else if (
			owner
				? owner.object(node.name).kind === "type"
				: this.types.has(node.name)
		)
			node._namesDeclType = true;
	},

	_notATypeSelector(node, scope) {
		if (!scope) return ANY;
		const before = this.errors.length;
		this.checkExpr(node, scope);
		if (this.errors.length === before)
			this.err(`${exprText(node)} is not a type`, this._positioned(node));
		return ANY;
	},

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
			? this._typeOfName(name, node, scope)
			: node.expr
				? this.resolveTypeNode(node.expr, scope)
				: null;
		if (base?._tainted) return base;
		if (!base) return this.err(`Unknown type '${name ?? "?"}'`, node);
		// `__G[int]{}`: the generic's name is an Ident that never reaches checkExpr.
		if (!qualified && node.expr?.kind === "Ident") {
			node.expr._isTypeRef = true;
			this._tagDeclTypeIdent(node.expr, scope);
		}
		if (qualified) {
			this.globals.lookup(sel.expr.name);
			sel.expr._isNamespace = true;
			// `iter.Seq[int](f)`: the selector names the mangled stdlib type.
			this._useQualifiedTypeName(sel, base);
		} else if (name)
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

	// The type `name` names where `scope` is checked: a type declared in a
	// function or block is not visible outside of it.
	_visibleType(name, scope) {
		if (
			!this._localTypesVisible &&
			this._localTypes.has(name) &&
			scope &&
			scope.lookupObject(name)?.kind !== "type"
		)
			return undefined;
		return this._typeNamed(name);
	},

	// The type the name `name` (a bare or `pkg.`-qualified type name written in
	// source) stands for in the file being checked. A name an import
	// registered resolves only in a file that binds it; the type table itself
	// spans the build. Resolving a declaration from another package (see
	// `_inDeclContext`) sees every name, as that package's own scope is not
	// this checker's.
	_typeNamed(name) {
		if (this._ungated === 0 && this._importKeys.has(name)) {
			const imported = this._importedType(this.globals.parent, name);
			if (imported) return imported;
			// No import of this file binds it: the package's own declaration of
			// the name stands, which another file's import does not hide.
			const own = this.types.get(name);
			return this._importBound.has(own) ? undefined : own;
		}
		return this.types.get(name);
	},

	// Runs `fn` to resolve the type nodes of `declNode`: in the scope of the
	// file that declares it, or with every import name visible when another
	// package declares it.
	_inDeclContext(declNode, fn) {
		const ownerPkg = this._ownerPkg;
		this._ownerPkg = declPackages.get(declNode) ?? this._pkgId;
		try {
			return this._inDeclFile(declNode, fn);
		} finally {
			this._ownerPkg = ownerPkg;
		}
	},

	_inDeclFile(declNode, fn) {
		const file = this._declFiles.get(declNode);
		if (file === undefined) {
			this._ungated++;
			try {
				return fn();
			} finally {
				this._ungated--;
			}
		}
		return this._atFile(file, () => {
			const ungated = this._ungated;
			this._ungated = 0;
			try {
				return fn();
			} finally {
				this._ungated = ungated;
			}
		});
	},

	resolveTypeNodeName(node, scope) {
		if (!node) return ANY;
		if (node.kind === "TypeName" || node.kind === "GenericTypeName") {
			const named = this._typeOfName(node.name, node, scope);
			if (named) return named;
		}
		return this.resolveTypeNode(node, scope);
	},

	_resolveStructType(node, scope) {
		const fields = new Map();
		const owners = new Map();
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
					f.embeddedName ??
					f.astType?.name ??
					f.type?.name ??
					f.type?.base?.name ??
					(inner.kind === "named" ? inner.name : "")
				)
					.split(".")
					.pop();
				if (embedName) {
					fields.set(embedName, ft);
					owners.set(embedName, this._ownerPkg);
				}
				const base = this._deepUnderlying(inner);
				if (base?.kind === "struct") {
					for (const [k, v] of base.fields.entries()) {
						fields.set(k, v);
						const owner = base._fieldOwner?.get(k);
						if (owner === undefined) owners.delete(k);
						else owners.set(k, owner);
					}
				}
				embeds.push(ft);
			} else {
				for (const n of f.names) {
					fields.set(n, ft);
					owners.set(n, this._ownerPkg);
				}
			}
		}
		return {
			kind: "struct",
			fields,
			_fieldOwner: owners,
			methods: new Map(),
			_embeds: embeds,
			_structFields: structFields,
		};
	},

	_resolveInterfaceType(node, scope) {
		this._markInterfaceElements(node);
		const methods = new Map();
		for (const m of node.methods) {
			const params = m.params.map((p) => this.resolveTypeNode(p.type, scope));
			const returns = m.returnType
				? [this.resolveTypeNode(m.returnType, scope)]
				: [VOID];
			const isVariadic =
				m.params.length > 0 && m.params[m.params.length - 1].variadic;
			const mType = { kind: "func", params, returns, _pkgId: this._ownerPkg };
			if (isVariadic) mType.variadic = true;
			methods.set(m.name, mType);
		}
		// Embedded interfaces that carry a type set (`interface{ Integer }`):
		// kept so type-parameter operator checks can follow them.
		const typeSetEmbeds = [];
		// `interface{ comparable; ... }`: the type set is restricted to
		// comparable types (directly or through an embedded constraint).
		let comparable = false;
		for (const embed of node.embeds ?? []) {
			if (this._mergeInterfaceEmbed(embed, scope, methods, typeSetEmbeds))
				comparable = true;
		}
		const result = { kind: "interface", methods };
		for (const union of [node.unionConstraint, ...(node.extraUnions ?? [])])
			if (union) this._checkApproxTerms(union, scope);
		if (node.unionConstraint) {
			result.unionConstraint = node.unionConstraint;
			result._unionText = typeNodeText(node.unionConstraint);
			result._unionScope = scope;
		}
		// A further union element is its own type set, intersected with the rest.
		for (const union of node.extraUnions ?? []) {
			typeSetEmbeds.push({
				kind: "interface",
				methods: new Map(),
				unionConstraint: union,
				_unionText: typeNodeText(union),
				_unionScope: scope,
			});
		}
		if (typeSetEmbeds.length > 0) result._typeSetEmbeds = typeSetEmbeds;
		if (comparable) result._comparable = true;
		return result;
	},

	// Folds one embedded element of an interface into `methods` and
	// `typeSetEmbeds`; returns true when it makes the interface comparable-only.
	_mergeInterfaceEmbed(embed, scope, methods, typeSetEmbeds) {
		const resolved = this.resolveTypeNode(embed, scope);
		const base = this._deepUnderlying(resolved);
		if (base === COMPARABLE) return true;
		if (base?.kind !== "interface") {
			if (!isAny(resolved))
				this.err(`cannot embed non-interface type ${typeStr(resolved)}`, embed);
			return false;
		}
		for (const [mName, mType] of base.methods) {
			if (!methods.has(mName)) methods.set(mName, mType);
		}
		if (base.unionConstraint || base._typeSetEmbeds) typeSetEmbeds.push(base);
		return Boolean(base._comparable);
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
		const key = typeArgs.map(instanceKey).join(",");
		generic._instances ??= new Map();
		const cached = generic._instances.get(key);
		if (cached) {
			this._syncInstanceMethods(generic, cached);
			return cached;
		}
		// `type T[X any] struct{ n *T[[]X] }` asks for T[[]X], then T[[][]X], and
		// so on: an instance still being built that keeps asking for a larger
		// one never settles.
		generic._building ??= [];
		generic._buildSizes ??= [];
		const building = generic._building;
		const size = typeArgs.reduce((n, a) => n + typeSize(a), 0);
		// A request for a larger instance while one is being built never
		// settles (`T[X]` containing `T[[]X]`), and doubling forms such as
		// `T[Pair[X, X]]` blow up long before a depth limit is reached.
		const top = generic._buildSizes[generic._buildSizes.length - 1];
		// Inside a method of `G[T]`, `G[[]T]` makes every instance ask for a
		// larger one, even if the method is never called.
		const growsReceiver =
			this._recvGeneric === generic &&
			typeArgs.some((a) => nestsTypeParam(a, generic.typeParams));
		if (
			growsReceiver ||
			building.length >= MAX_INSTANTIATION_DEPTH ||
			(generic._syncDepth ?? 0) >= MAX_INSTANTIATION_DEPTH ||
			(top !== undefined && size > top)
		) {
			if (!generic._cycleReported) {
				generic._cycleReported = true;
				this.err(
					`instantiation cycle: ${generic.declNode.name} instantiates itself with ever larger type arguments`,
					generic.declNode,
				);
			}
			return ANY;
		}
		const map = new Map();
		for (let i = 0; i < generic.typeParams.length; i++)
			map.set(generic.typeParams[i].name, typeArgs[i] ?? ANY);
		const pkgName = generic.declNode?._pkgName ?? generic._pkgName;
		const named = {
			kind: "named",
			name: generic.declNode.name,
			...(pkgName && { _pkgName: pkgName }),
			typeArgs,
			underlying: null,
			_genericOf: generic,
		};
		generic._instances.set(key, named);
		// Resolve the declaration with its type params in scope (as typeParams,
		// never as value symbols), then substitute the concrete arguments.
		const typeScope = new Scope(this.globals);
		for (const tp of generic.typeParams) typeScope.defineType(tp.name, tp);
		building.push(key);
		generic._buildSizes.push(size);
		let instantiated;
		try {
			const underlying = this._inDeclContext(generic.declNode, () =>
				this.resolveTypeNode(generic.declNode.type, typeScope),
			);
			instantiated = this.substituteType(underlying, map);
			// `type W[T any] V[T]`: W[int]'s underlying type is V[int]'s.
			if (instantiated.kind === "named")
				instantiated = this._underlyingOver(instantiated, generic.declNode);
			instantiated = this._definedEmptyInterface(
				instantiated,
				generic.declNode,
			);
		} finally {
			building.pop();
			generic._buildSizes.pop();
		}
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
		// `func (s Stack[T]) Wrap() Stack[[]T]` makes every instance's methods
		// ask for a larger instance: count the nesting to diagnose it.
		named._syncing = true;
		generic._syncDepth = (generic._syncDepth ?? 0) + 1;
		try {
			for (const [mName, mType] of generic.methods ?? [])
				if (!methods.has(mName))
					methods.set(mName, this.substituteType(mType, named._instMap));
			// Methods promoted from embedded structs (`Outer[T]` embedding `Base`).
			this._promoteEmbeddedInto(named.underlying);
		} finally {
			generic._syncDepth--;
			named._syncing = false;
		}
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
				this.checkConstraint(typeArgs[i], constraint, declNode, {
					typeParams,
					typeArgs,
					name: tp.name,
					scope: this.globals,
				});
			}
			aliasScope.define(tp.name, { kind: "aliasArg", type: typeArgs[i] });
		}
		return this._inDeclContext(declNode, () =>
			this.resolveTypeNode(declNode.type, aliasScope),
		);
	},

	// `explicit` seeds the leading type arguments of a partial instantiation
	// (`F[int](x)`); the rest are inferred from the call arguments.
	// `scope` resolves the type parameters of the calling function, so an
	// argument of type `S ~[]E` unifies through its core type.
	inferTypeArgs(genericType, argTypes, explicit = [], scope = null) {
		const map = new Map();
		const saved = this._inferScope;
		this._inferScope = scope;
		try {
			return this._inferTypeArgs(genericType, argTypes, explicit, map);
		} finally {
			this._inferScope = saved;
		}
	},

	_inferTypeArgs(genericType, argTypes, explicit, map) {
		for (let i = 0; i < explicit.length; i++)
			map.set(genericType.typeParams[i].name, explicit[i]);
		const params = genericType.underlying.params;
		for (let i = 0; i < params.length && i < argTypes.length; i++)
			this._inferFromPair(params[i], argTypes[i], map);
		this._inferFromCoreTypes(genericType.typeParams, map);
		for (const tp of genericType.typeParams) {
			if (!map.has(tp.name)) return null;
		}
		return genericType.typeParams.map((tp) => defaultType(map.get(tp.name)));
	},

	// Constraint type inference: a type parameter `S` constrained by `~[]E`
	// whose argument is known unifies `E` with that argument's element type.
	_inferFromCoreTypes(typeParams, map) {
		const scope = new Scope(this.globals);
		for (const tp of typeParams) scope.defineType(tp.name, tp);
		for (let round = 0; round < typeParams.length; round++) {
			const before = map.size;
			for (const tp of typeParams) {
				const arg = map.get(tp.name);
				if (!tp.constraint) continue;
				if (!arg) {
					this._inferFromPointerCore(tp, typeParams, map, scope);
					continue;
				}
				const terms = this._constraintTerms(tp.constraint, new Set(), scope);
				if (terms?.length !== 1) continue;
				const argUnder =
					this._coreOfTypeParam(arg) ??
					this._deepUnderlying(this.resolveType(arg));
				if (argUnder) this._inferFromPair(terms[0], argUnder, map);
			}
			if (map.size === before) break;
		}
	},

	// An unbound type parameter whose constraint has the single exact term
	// `*T` (`P interface{ *T; M() }`) is the pointer type, once `T` is known.
	_inferFromPointerCore(tp, typeParams, map, scope) {
		const terms = this._constraintTerms(tp.constraint, new Set(), scope);
		if (terms?.length !== 1 || terms[0]?.kind !== "pointer") return;
		const free = new Set(
			typeParams.filter((p) => !map.has(p.name)).map((p) => p.name),
		);
		const inferred = this.substituteType(terms[0], map);
		const mentionsFree = (t) =>
			t?.kind === "typeParam"
				? free.has(t.name)
				: t?.kind === "pointer"
					? mentionsFree(t.base)
					: false;
		if (!mentionsFree(inferred) && inferred.kind === "pointer")
			map.set(tp.name, inferred);
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
		if (paramType.kind === "array" && argType.kind === "array")
			this._inferFromPair(paramType.elem, argType.elem, map);
		if (paramType.kind === "pointer" && argType.kind === "pointer")
			this._inferFromPair(paramType.base, argType.base, map);
		if (paramType.kind === "map" && argType.kind === "map") {
			this._inferFromPair(paramType.key, argType.key, map);
			this._inferFromPair(paramType.value, argType.value, map);
		}
		if (paramType.kind === "func" && argType.kind === "func")
			this._inferFromFuncPair(paramType, argType, map);
		this._inferFromAggregatePair(paramType, argType, map);
	},

	_inferFromAggregatePair(paramType, argType, map) {
		if (paramType.kind === "tuple" && argType.kind === "tuple") {
			for (
				let i = 0;
				i < paramType.types.length && i < argType.types.length;
				i++
			)
				this._inferFromPair(paramType.types[i], argType.types[i], map);
		}
		if (paramType.kind === "struct" && argType.kind === "struct") {
			const [pf, af] = [paramType._structFields, argType._structFields];
			if (pf && af && pf.length === af.length)
				for (const [i, f] of pf.entries())
					this._inferFromPair(f.type, af[i].type, map);
		}
	},

	// An argument whose type is a type parameter of the calling function
	// (`S ~[]E`) unifies through its core type: that type, or null.
	// `paramType` (optional) is the parameter it is matched against; a bare
	// type parameter takes the argument as it is.
	_coreOfTypeParam(argType, paramType = null) {
		if (argType.kind !== "typeParam" || !this._inferScope) return null;
		if (paramType?.kind === "typeParam") return null;
		return this._coreType(argType, this._inferScope);
	},

	_inferFromPair(paramType, argType, map) {
		if (!paramType || !argType) return;
		argType = this._coreOfTypeParam(argType, paramType) ?? argType;
		if (paramType.kind === "typeParam") {
			const prev = map.get(paramType.name);
			if (!prev || untypedWins(prev, argType)) map.set(paramType.name, argType);
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
		if (typeArg?._tainted || this._unionAccepts(typeArg, constraint, new Set()))
			return;
		const pattern = this._lonePatternTerm(constraint);
		if (pattern) {
			const { name } = this._approxCtx;
			const text = `~${typeStr(pattern)}`;
			this.err(
				this._mentionsTypeParam(pattern)
					? `${name} (type ${typeStr(typeArg)}) does not satisfy ${text}`
					: `${typeStr(typeArg)} does not satisfy ${text}`,
				node,
			);
			return;
		}
		this.err(`type ${typeStr(typeArg)} does not satisfy constraint`, node);
	},

	// The one approximation term over a composite type that a constraint
	// consists of (`~[]E`), with the bound type arguments substituted; null for
	// any other constraint.
	_lonePatternTerm(union) {
		const ctx = this._approxCtx;
		const term = union.terms.length === 1 ? union.terms[0] : null;
		if (!ctx || !term?.approx || term.type?.kind === "TypeName") return null;
		return this._approxPattern(term, ctx);
	},

	_approxPattern(term, ctx) {
		const scope = new Scope(ctx.scope);
		for (const tp of ctx.typeParams) scope.defineType(tp.name, tp);
		return this.substituteType(
			this.resolveTypeNode(term.type, scope),
			ctx.bindings,
		);
	},

	_mentionsTypeParam(t) {
		if (!t || typeof t !== "object") return false;
		if (t.kind === "typeParam") return true;
		return [
			t.elem,
			t.key,
			t.value,
			t.base,
			...(t._structFields?.map((f) => f.type) ?? []),
			...(t.params ?? []),
			...(t.returns ?? []),
		].some((c) => this._mentionsTypeParam(c));
	},

	// Whether `arg` has the structure of `pattern`, where a type parameter in
	// the pattern that no type argument binds matches any type.
	_structMatches(arg, pattern) {
		if (!pattern || pattern.kind === "typeParam") return true;
		if (!this._mentionsTypeParam(pattern)) return identical(arg, pattern);
		return arg?.kind === pattern.kind && this._shapeMatches(arg, pattern);
	},

	_shapeMatches(arg, pattern) {
		const m = (a, p) => this._structMatches(a, p);
		switch (pattern.kind) {
			case "slice":
			case "pointer":
				return m(arg.elem ?? arg.base, pattern.elem ?? pattern.base);
			case "array":
				return arg.size === pattern.size && m(arg.elem, pattern.elem);
			case "chan":
				return arg.dir === pattern.dir && m(arg.elem, pattern.elem);
			case "map":
				return m(arg.key, pattern.key) && m(arg.value, pattern.value);
			case "func":
				return this._funcMatches(arg, pattern);
			case "struct":
				return this._structFieldsMatch(arg, pattern);
			default:
				return true;
		}
	},

	_funcMatches(arg, pattern) {
		const all = (xs, ys) =>
			xs.length === ys.length &&
			xs.every((x, i) => this._structMatches(x, ys[i]));
		return (
			Boolean(arg.variadic) === Boolean(pattern.variadic) &&
			all(arg.params, pattern.params) &&
			all(arg.returns, pattern.returns)
		);
	},

	_structFieldsMatch(arg, pattern) {
		const [af, pf] = [arg._structFields, pattern._structFields];
		if (!af || !pf || af.length !== pf.length) return false;
		const names = (f) => (f.names ?? []).join("|");
		return pf.every(
			(f, i) =>
				Boolean(f.embedded) === Boolean(af[i].embedded) &&
				names(f) === names(af[i]) &&
				this._structMatches(af[i].type, f.type),
		);
	},

	// Whether `typeArg` is in the type set of a union: some term holds it.
	// `scope` resolves the names its terms mention.
	_unionAccepts(typeArg, union, active, scope = this.globals) {
		return union.terms.some((term) => {
			// `~[]E` may mention a type parameter that is not in `scope`, so an
			// approximation term is resolved (and compared) only when it names
			// a type.
			if (!term.resolved && term.approx && term.type?.kind !== "TypeName") {
				const ctx = this._approxCtx;
				if (!ctx || typeArg?.kind === "typeParam") return true;
				const under = this._deepUnderlying(typeArg);
				return this._structMatches(under, this._approxPattern(term, ctx));
			}
			const t = term.resolved ?? this.resolveTypeNode(term.type, scope);
			return this._termAccepts(typeArg, t, term.approx, active);
		});
	},

	// One union term: a named interface contributes its own type set
	// (`S | U` with `type S interface{ ~int }`), `~T` any type with the
	// underlying type of `T`, and `T` exactly `T`.
	_termAccepts(typeArg, t, approx, active) {
		const base =
			t?.kind === "named"
				? (this.resolveType(t.underlying) ?? t.underlying)
				: t;
		if (base?.kind === "interface")
			return this._interfaceAccepts(typeArg, base, active);
		if (!approx) return identical(typeArg, t);
		const want = this._deepUnderlying(t);
		if (typeArg?.kind === "typeParam") return true;
		const under = this._deepUnderlying(typeArg);
		return want?.kind === "basic"
			? identical(under, want)
			: this._structMatches(under, want);
	},

	// An interface's type set is the intersection of its own union and the
	// type sets of the interfaces it embeds; one with neither holds every type.
	_interfaceAccepts(typeArg, iface, active) {
		if (active.has(iface)) return true;
		active.add(iface);
		const ok =
			(!iface.unionConstraint ||
				this._unionAccepts(
					typeArg,
					iface.unionConstraint,
					active,
					iface._unionScope ?? this.globals,
				)) &&
			(iface._typeSetEmbeds ?? []).every((e) =>
				this._interfaceAccepts(typeArg, e, active),
			);
		active.delete(iface);
		return ok;
	},

	// Go's comparability: slices, maps and funcs are not comparable, nor are
	// arrays and structs that contain them. A type parameter is comparable
	// only when every type in its constraint's type set is.
	_isComparable(t, seen = new Set()) {
		const base = this._deepUnderlying(t);
		if (!base || seen.has(base)) return true;
		seen.add(base);
		switch (base.kind) {
			case "typeParam":
				return this._typeSetComparable(base, seen);
			case "slice":
			case "map":
			case "func":
				return false;
			case "array":
				return this._isComparable(base.elem, seen);
			case "struct":
				// Declared fields only: base.fields also holds promoted fields and
				// collapses repeated blank names.
				return (
					base._structFields
						? base._structFields.map((f) => f.type)
						: [...(base.fields?.values() ?? [])]
				).every((f) => this._isComparable(f, seen));
			default:
				return true;
		}
	},

	// A type parameter is comparable when every type in its constraint's type
	// set is; without a type set the constraint must be `comparable`.
	_typeSetComparable(tp, seen) {
		const terms = this._constraintTerms(tp.constraint, new Set());
		if (terms?.length)
			return terms.every(
				(t) => t.name === "comparable" || this._isComparable(t, seen),
			);
		if (terms) return false;
		let c = tp.constraint;
		if (c?.kind === "TypeName" || c?.kind === "InterfaceType")
			c = this.resolveTypeNode(c, this.globals);
		while (c?.kind === "named") c = c.underlying;
		return c === COMPARABLE || Boolean(c?._comparable);
	},

	// `map[K]V` needs a comparable key: Go reports the key type, and for a type
	// parameter adds that it lacks the `comparable` constraint.
	_checkMapKey(key, node) {
		if (!key || key._tainted || key.kind === "untyped") return;
		// While package types are collected a key's fields may not have
		// resolved yet, so the check waits with the constraint-use checks.
		if (this._collectingTypes) {
			this._pendingConstraintUses.push({
				mapKey: key,
				node,
				file: this._currentFile,
				source: this._currentSource,
			});
			return;
		}
		if (this._isComparable(key)) return;
		this.err(
			`invalid map key type ${typeStr(key)}${key.kind === "typeParam" ? " (missing comparable constraint)" : ""}`,
			node,
		);
	},

	_checkInterfaceConstraint(typeArg, base, constraint, node) {
		if (base._comparable && !this._isComparable(typeArg)) {
			this.err(
				`type ${typeStr(typeArg)} does not satisfy constraint ${typeStr(constraint)}`,
				node,
			);
			return;
		}
		if (this._unsatisfiedInterface(typeArg, base, node))
			this.err(
				`type ${typeStr(typeArg)} does not satisfy constraint ${typeStr(constraint)}`,
				node,
			);
	},

	// Whether `typeArg` is outside the type set of `base` or lacks its methods.
	// A lone union reports its own, more precise, error and counts as satisfied.
	_unsatisfiedInterface(typeArg, base, node) {
		const embeds = base._typeSetEmbeds?.length ?? 0;
		const hasMethods = base.methods.size > 0;
		if (base.unionConstraint && !embeds && !hasMethods) {
			this._checkUnionConstraint(typeArg, base.unionConstraint, node);
			return false;
		}
		const inSet =
			!(base.unionConstraint || embeds) ||
			typeArg?._tainted ||
			this._interfaceAccepts(typeArg, base, new Set());
		return !inSet || (hasMethods && !this.implements(typeArg, base, node));
	},

	// `ctx` (`{ typeParams, typeArgs, name, scope }`) names the generic
	// function being instantiated, so a term such as `~[]E` is compared with
	// the type arguments substituted.
	checkConstraint(typeArg, constraint, node, ctx = null) {
		const saved = this._approxCtx;
		this._approxCtx = ctx && {
			...ctx,
			bindings: new Map(
				ctx.typeParams.flatMap((tp, i) =>
					ctx.typeArgs[i] ? [[tp.name, ctx.typeArgs[i]]] : [],
				),
			),
		};
		try {
			this._checkConstraint(typeArg, constraint, node);
		} finally {
			this._approxCtx = saved;
		}
	},

	_checkConstraint(typeArg, constraint, node) {
		if (!constraint || isAny(constraint)) return;
		if (constraint.kind === "basic" && constraint.name === "comparable") {
			if (!this._isComparable(typeArg))
				this.err(`${typeStr(typeArg)} does not satisfy comparable`, node);
			return;
		}
		if (constraint.kind === "UnionConstraint") {
			this._checkUnionConstraint(typeArg, constraint, node);
			return;
		}
		const base = this._deepUnderlying(constraint);
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
			// Two imported packages can both declare `Pt`; the bare name only
			// reaches the last one registered, so a declaration that came from
			// an import's own type table stays itself.
			if (found && !(t.underlying && this._ambiguousImported?.has(t)))
				return found;
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
		else {
			const pointee = this._definedPointerStruct(baseType, field);
			if (pointee)
				return this._fieldTypeDefinedPointer(baseType, pointee, field, node);
		}
		const param = this._typeParamOperand(baseType, field);
		if (param) return this._fieldTypeTypeParam(param, baseType, field, node);
		if (baseType.kind === "named" && baseType.methods?.has(field))
			return this._methodOf(baseType.methods.get(field), field, node);
		const base = this._deepUnderlying(baseType);
		return this._dispatchFieldType(base, baseType, field, node);
	},

	// The struct type behind `p` of a defined pointer type (`type PS *S`) for
	// a selector `p.f`; null for every other base.
	_definedPointerStruct(baseType, field) {
		if (baseType.kind !== "named" || field === "value") return null;
		const under = this._deepUnderlying(baseType);
		if (under?.kind !== "pointer") return null;
		const pointee = this.resolveType(under.base);
		return this._deepUnderlying(pointee)?.kind === "struct" ? pointee : null;
	},

	// `p.f` through a defined pointer type reads a field of the struct it
	// points at, direct or promoted, as through a plain `*S`. The defined type
	// has no methods of its own, and none of the struct's.
	_fieldTypeDefinedPointer(baseType, pointee, field, node) {
		const struct = this._deepUnderlying(pointee);
		if (struct.fields?.has(field) && !isMethodPromotedOverField(struct, field))
			return this._fieldTypeStruct(struct, pointee, field, node);
		return this._errUndefinedSelector(baseType, field, node);
	},

	_errUndefinedSelector(baseType, field, node) {
		return this.err(
			`${exprText(node?.expr)}.${field} undefined (type ${typeStr(baseType)} has no field or method ${field})`,
			node,
		);
	},

	// The type parameter a selector reads through: `t` or `*t`. Its fields
	// are never reachable, even when its core type is a struct.
	_typeParamOperand(baseType, field) {
		if (baseType.kind === "typeParam") return baseType;
		if (baseType.kind !== "pointer" || field === "value") return null;
		const base = this.resolveType(baseType.base);
		return base?.kind === "typeParam" ? base : null;
	},

	// A type parameter has the methods of its constraint and nothing else.
	_fieldTypeTypeParam(param, baseType, field, node) {
		const c = this._deepUnderlying(this.resolveType(param.constraint));
		if (c?._tainted || c?._isOpen) return ANY;
		if (baseType === param && c?.kind === "interface") {
			if (c.methods?.has(field))
				return this._methodOf(c.methods.get(field), field, node);
		}
		return this._errUndefinedSelector(baseType, field, node);
	},

	_isTransparentPointerField(baseType, field) {
		return (
			baseType.kind === "pointer" &&
			field !== "value" &&
			(baseType.base?.kind === "named" || baseType.base?.kind === "struct")
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
		if (base.fields?.has(field) && isMethodPromotedOverField(base, field))
			return this._methodOf(base.methods.get(field), field, node);
		if (base.fields?.has(field)) {
			if (isAmbiguousFieldSelector(base, field))
				return this._errAmbiguousSelector(baseType, field, node);
			return (
				this._foreignMember(
					base._fieldOwner?.get(field),
					field,
					"field",
					node,
				) ?? base.fields.get(field)
			);
		}
		if (base.methods?.has(field))
			return this._methodOf(base.methods.get(field), field, node);
		if (isAmbiguousPromotion(base, field))
			return this._errAmbiguousSelector(baseType, field, node);
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

	// The method type `mType` of a selector `x.field`, or the error when another
	// package declares it and does not export it.
	_methodOf(mType, field, node) {
		return this._foreignMember(mType?._pkgId, field, "method", node) ?? mType;
	},

	// The error for `x.field` when `field` (a "field" or a "method") was
	// declared by the package `owner`, another package, and is unexported
	// there; null when this package may use it, or `owner` is not known (types
	// the checker was given rather than read from Go source).
	_foreignMember(owner, field, kind, node) {
		if (owner === undefined || owner === this._pkgId) return null;
		if (!this._unexportedForeign(field)) return null;
		return this.err(
			`${exprText(node?.expr)}.${field} undefined (cannot refer to unexported ${kind} ${field})`,
			node,
		);
	},

	_errAmbiguousSelector(baseType, field, node) {
		const text = exprText(node?.expr);
		const recv = text === "expression" ? typeStr(baseType) : text;
		return this.err(`ambiguous selector ${recv}.${field}`, node);
	},

	_fieldTypeInterface(base, baseType, field, node) {
		if (base.methods?.has(field))
			return this._methodOf(base.methods.get(field), field, node);
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
				const underlying = this._deepUnderlying(taType);
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
		const badKinds = [
			"basic",
			"slice",
			"array",
			"map",
			"func",
			"tuple",
			"pointer",
		];
		if (badKinds.includes(base.kind))
			return this.err(
				`${typeStr(baseType ?? base)} has no field or method '${field}'`,
				node,
			);
		return ANY;
	},

	// An error for `field` when the namespace cannot offer it to this package:
	// an unexported name, or a member of a `js` file in a wasm or both package.
	_namespaceMemberError(base, field, node) {
		if (base._gofront && this._unexportedForeign(field))
			return this._errNotExported(base.name, field, node);
		const wasm = this.target === "wasm" || this.target === "both";
		return wasm && base._jsOnly?.has(field)
			? this._errJsOnly(`${base.name}.${field}`, node)
			: null;
	},

	_fieldTypeNamespace(base, field, node) {
		const bad = this._namespaceMemberError(base, field, node);
		if (bad) return bad;
		// Go-source stdlib member: backends emit the mangled top-level name.
		const mangled = base._mangle?.get(field);
		if (mangled) {
			node._stdName = mangled;
			// Lazy stdlib bodies: referencing a member checks what it reaches.
			const failure = base._reach?.(mangled);
			if (failure)
				this.err(
					`internal stdlib error in ${base._path}; please report`,
					node,
					failure,
				);
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
		// `pkg.T`, a type the import names: `_checkSelectorExpr` marks the node
		// a type reference, so `pkg.T(x)` converts.
		const named = this._typeNamed(`${base.name}.${field}`);
		if (named) return named;
		return this.err(`No member '${field}' in namespace ${base.name}`, node);
	},

	resolveJsonFields(structType) {
		return resolveJsonFields(structType);
	},
};

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
		const embedStruct = underlyingOf(inner);
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
	const underlying = underlyingOf(structType);
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
