// Type checker: walks the AST, resolves types for all expressions,
// and reports type errors at compile time.
//
// Split into sub-modules under typechecker/:
//   types.js        — shared type constants, predicates, Scope
//   stdlib.js       — browser globals + all built-in package registrations
//   statements.js   — checkBlock, checkStmt
//   expressions.js  — checkExpr, checkCall, checkBuiltin, checkCompositeLit

import { expressionCheckMethods } from "./typechecker/expressions.js";
import { statementCheckMethods } from "./typechecker/statements.js";
import { setupGlobals } from "./typechecker/stdlib.js";
import {
	ANY,
	BASIC_TYPES,
	BOOL,
	CMP_OPS,
	COMPLEX128,
	defaultType,
	ERROR,
	FLOAT64,
	INT,
	isAny,
	isComplex,
	isComplexOrNumeric,
	isNil,
	isNumeric,
	isPointer,
	isString,
	isUntyped,
	isVoid,
	LOG_OPS,
	Scope,
	STRING,
	TypeCheckError,
	typeStr,
	UNTYPED_COMPLEX,
	UNTYPED_FLOAT,
	UNTYPED_INT,
	VOID,
} from "./typechecker/types.js";

// Re-export for consumers that import from typechecker.js
export { TypeCheckError, typeStr };

// Untyped constant assignability: maps source.base → Set of compatible target.name values
// untyped int/float also coerce to complex (Go: var z complex128 = 5)
const UNTYPED_COMPAT = {
	int: new Set(["int", "float64", "complex128", "complex64"]),
	float64: new Set(["float64", "int", "complex128", "complex64"]),
	string: new Set(["string"]),
	bool: new Set(["bool"]),
	complex128: new Set(["complex128", "complex64"]),
};

export class TypeChecker {
	constructor() {
		this.types = new Map(); // named types
		this.globals = new Scope();
		this.errors = [];
		this._currentFile = null; // filename of file currently being checked
		this._currentSource = null;
		this._loopDepth = 0; // for break/continue validation
		this._switchDepth = 0; // for break/fallthrough validation
		this._typeSwitchDepth = 0; // for rejecting fallthrough in type switch
		this._deferCount = 0; // tracks defer usage in current function body
		this._imports = []; // tracked imports for unused-import detection
		this._setupGlobals();
		// Register error as a named type (interface)
		this.types.set("error", ERROR);
	}

	_setupGlobals() {
		setupGlobals(this.globals, this.types);
	}

	addDefinitions(types, values) {
		for (const [name, type] of types) {
			this.types.set(name, type);
		}
		for (const [name, type] of values) {
			this.globals.define(name, type);
		}
	}

	// Add an imported GoFront package as a qualified namespace.
	// e.g. addPackageNamespace('utils', symbolsMap, typesMap)
	// lets callers type-check `utils.Foo` via SelectorExpr.
	addPackageNamespace(pkgName, symbols, types) {
		const members = {};
		for (const [name, type] of symbols) members[name] = type;
		// _gofront: true marks this as a GoFront package — exported identifier rules apply
		this.globals.define(pkgName, {
			kind: "namespace",
			name: pkgName,
			members,
			_gofront: true,
		});
		for (const [name, type] of types) {
			this.types.set(name, type);
			this.types.set(`${pkgName}.${name}`, type);
		}
	}

	// Register an import for unused-import detection.
	// `name` is the package name or alias used in code.
	// `node` carries _line for error reporting.
	// `filename` / `source` identify the file containing the import.
	trackImport(name, node, filename, source) {
		this._imports.push({ name, node, filename, source });
	}

	// Report any tracked imports whose package name was never referenced.
	reportUnusedImports() {
		for (const { name, node, filename, source } of this._imports) {
			if (!this.globals._used.has(name)) {
				const saved = [this._currentFile, this._currentSource];
				this._currentFile = filename;
				this._currentSource = source;
				this.err(`'${name}' imported and not used`, node);
				[this._currentFile, this._currentSource] = saved;
			}
		}
	}

	// Return a snapshot of all user-defined globals (excludes built-ins).
	// Used by the compiler to expose a package's exports to importers.
	getExportedSymbols() {
		const out = new Map();
		for (const [name, type] of this.globals.symbols) {
			if (type?.kind === "builtin") continue; // skip built-ins
			if (type === ANY && !name[0].match(/[A-Z]/)) continue; // skip browser globals
			out.set(name, type);
		}
		return out;
	}

	getExportedTypes() {
		return new Map(this.types);
	}

	err(msg, node) {
		const e = new TypeCheckError(
			msg,
			node,
			this._currentFile,
			this._currentSource,
		);
		this.errors.push(e);
		return ANY; // recovery type
	}

	_reportUnused(scope, node) {
		for (const name of scope.unusedLocals()) {
			this.err(`'${name}' declared and not used`, node);
		}
	}

	_setCurrentFile(p) {
		this._currentFile = p._filename ?? null;
		this._currentSource = p._source ?? null;
	}

	check(program) {
		this._setCurrentFile(program);
		// Pass 1: collect type declarations
		for (const decl of program.decls) {
			if (decl.kind === "TypeDecl") this.collectType(decl);
		}
		// Pass 2: collect function / method signatures
		for (const decl of program.decls) {
			if (decl.kind === "FuncDecl" || decl.kind === "MethodDecl") {
				this.collectFunc(decl);
			} else if (decl.kind === "TemplDecl") {
				this._collectTemplDecl(decl);
			}
		}
		// Pass 2.1: Promote embedded methods
		this._promoteEmbeddedMethods();
		// Pass 3: check bodies
		for (const decl of program.decls) {
			this.checkTopDecl(decl, this.globals);
		}
		return this.errors;
	}

	// Pre-declare a package-level var so other files can reference its name
	// before we've type-checked its initializer.  Called in pass 2.5.
	collectVar(decl) {
		for (const spec of decl.decls) {
			const type = spec.type
				? this.resolveTypeNode(spec.type, this.globals)
				: ANY;
			for (const name of spec.names) this.globals.define(name, type);
		}
	}

	collectConst(decl) {
		for (const spec of decl.decls) {
			const type = spec.type
				? this.resolveTypeNode(spec.type, this.globals)
				: ANY;
			for (const name of spec.names) this.globals.defineConst(name, type);
		}
	}

	// Like check() but operates over multiple programs (same-package multi-file).
	// All passes run across all files before moving to the next pass,
	// so every file sees every other file's declarations.
	checkAll(programs) {
		this._collectTypesPass(programs);
		this._collectFuncsPass(programs);
		this._promoteEmbeddedMethods();
		this._collectVarsConstsPass(programs);
		this._checkTopDeclsPass(programs);
		return this.errors;
	}

	_collectTypesPass(programs) {
		for (const p of programs) {
			this._setCurrentFile(p);
			for (const d of p.decls) if (d.kind === "TypeDecl") this.collectType(d);
		}
	}

	_collectFuncsPass(programs) {
		for (const p of programs) {
			this._setCurrentFile(p);
			for (const d of p.decls) {
				if (d.kind === "FuncDecl" || d.kind === "MethodDecl")
					this.collectFunc(d);
				else if (d.kind === "TemplDecl") this._collectTemplDecl(d);
			}
		}
	}

	_collectVarsConstsPass(programs) {
		for (const p of programs) {
			this._setCurrentFile(p);
			for (const d of p.decls) {
				if (d.kind === "VarDecl") this.collectVar(d);
				if (d.kind === "ConstDecl") this.collectConst(d);
			}
		}
	}

	_checkTopDeclsPass(programs) {
		for (const p of programs) {
			this._setCurrentFile(p);
			for (const d of p.decls) this.checkTopDecl(d, this.globals);
		}
	}

	// ── Shared pass helpers ──────────────────────────────────────

	_promoteEmbeddedMethods() {
		for (const type of this.types.values()) {
			const struct = type.underlying;
			if (struct?.kind === "struct" && struct._embeds) {
				for (const embed of struct._embeds) {
					const base = embed.kind === "named" ? embed.underlying : embed;
					if (base?.kind !== "struct" || !base.methods) continue;
					for (const [mName, mType] of base.methods.entries()) {
						if (!struct.methods.has(mName)) struct.methods.set(mName, mType);
					}
				}
			}
		}
	}

	// ── Type collection ──────────────────────────────────────────

	collectType(decl) {
		if (decl.typeParams) {
			// Generic type — resolve underlying with type params as ANY for struct fields
			const typeScope = new Scope(this.globals);
			const typeParamTypes = decl.typeParams.map((tp) => {
				const t = {
					kind: "typeParam",
					name: tp.name,
					constraint: tp.constraint,
				};
				typeScope.define(tp.name, t);
				return t;
			});
			const underlying = this.resolveTypeNode(decl.type, typeScope);
			const named = {
				kind: "named",
				name: decl.name,
				underlying,
				_generic: {
					typeParams: typeParamTypes,
					declNode: decl,
				},
			};
			if (underlying.kind === "struct") {
				underlying.name = decl.name;
				underlying.methods = new Map();
			}
			this.types.set(decl.name, named);
			this.globals.define(decl.name, named);
			return;
		}
		const underlying = this.resolveTypeNode(decl.type, this.globals);
		if (decl.isAlias) {
			// type A = B — transparent alias, A and B are identical types
			this.types.set(decl.name, underlying);
			this.globals.define(decl.name, underlying);
			return;
		}
		const named = { kind: "named", name: decl.name, underlying };
		if (underlying.kind === "struct") {
			underlying.name = decl.name;
			underlying.methods = new Map();
		} else if (underlying.kind !== "interface") {
			named.methods = new Map();
		}
		if (underlying.kind === "interface") {
			underlying.name = decl.name;
		}
		this.types.set(decl.name, named);
		this.globals.define(decl.name, named);
	}

	_buildCollectFuncScope(decl) {
		let resolveScope = this.globals;
		let typeParamTypes = null;
		if (decl.typeParams) {
			resolveScope = new Scope(this.globals);
			typeParamTypes = decl.typeParams.map((tp) => {
				const t = {
					kind: "typeParam",
					name: tp.name,
					constraint: tp.constraint,
				};
				resolveScope.define(tp.name, t);
				return t;
			});
		}
		if (decl.kind === "MethodDecl") {
			const recvNamedType = this.types.get(decl.recvType.name);
			if (recvNamedType?._generic) {
				resolveScope = new Scope(this.globals);
				for (const tp of recvNamedType._generic.typeParams)
					resolveScope.define(tp.name, tp);
			}
		}
		return { resolveScope, typeParamTypes };
	}

	_registerFuncDecl(decl, funcType, typeParamTypes) {
		if (this.globals.symbols.has(decl.name) && decl.name !== "init")
			this.err(`${decl.name} redeclared in this block`, decl);
		if (typeParamTypes) {
			this.globals.define(decl.name, {
				kind: "generic",
				name: decl.name,
				typeParams: typeParamTypes,
				underlying: funcType,
			});
		} else {
			this.globals.define(decl.name, funcType);
		}
	}

	collectFunc(decl) {
		const { resolveScope, typeParamTypes } = this._buildCollectFuncScope(decl);
		const paramTypes = decl.params.map((p) =>
			this.resolveTypeNode(p.type, resolveScope),
		);
		const returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, resolveScope)
			: VOID;
		const isVariadic =
			decl.params.length > 0 && decl.params[decl.params.length - 1].variadic;
		const funcType = {
			kind: "func",
			params: paramTypes,
			returns: [returnType],
			variadic: isVariadic,
			async: decl.async ?? false,
		};
		if (decl.kind === "FuncDecl")
			this._registerFuncDecl(decl, funcType, typeParamTypes);
		else this._attachMethod(decl, funcType);
	}

	_attachGenericMethod(recvNamedType, decl, funcType) {
		if (!recvNamedType._generic.methods)
			recvNamedType._generic.methods = new Map();
		recvNamedType._generic.methods.set(decl.name, funcType);
		const base = recvNamedType.underlying;
		if (base?.kind === "struct") base.methods.set(decl.name, funcType);
	}

	_attachNonGenericMethod(decl, funcType) {
		const recvType = this.resolveTypeNodeName(decl.recvType, this.globals);
		const base = recvType?.underlying ?? recvType;
		if (base?.kind === "struct") {
			base.methods.set(decl.name, funcType);
		} else if (recvType?.kind === "named" && recvType.methods) {
			recvType.methods.set(decl.name, funcType);
		}
	}

	_attachMethod(decl, funcType) {
		const recvNamedType = this.types.get(decl.recvType.name);
		if (recvNamedType?._generic)
			this._attachGenericMethod(recvNamedType, decl, funcType);
		else this._attachNonGenericMethod(decl, funcType);
	}

	// ── Top-level checker ────────────────────────────────────────

	checkTopDecl(decl, scope) {
		switch (decl.kind) {
			case "FuncDecl":
				this.checkFuncDecl(decl, scope);
				break;
			case "MethodDecl":
				this.checkMethodDecl(decl, scope);
				break;
			case "VarDecl":
				this.checkVarDecl(decl, scope);
				break;
			case "ConstDecl":
				this.checkConstDecl(decl, scope);
				break;
			case "TypeDecl":
			case "TemplDecl":
				break; // already collected / no body to check
		}
	}

	_collectTemplDecl(decl) {
		const paramTypes = decl.params.map((p) =>
			this.resolveTypeNode(p.type, this.globals),
		);
		const gomNodeType = this.types.get("gom.Node") ?? {
			kind: "basic",
			name: "any",
		};
		const isVariadic =
			decl.params.length > 0 && decl.params[decl.params.length - 1].variadic;
		const funcType = {
			kind: "func",
			params: paramTypes,
			returns: [gomNodeType],
			variadic: isVariadic,
			async: false,
		};
		if (this.globals.symbols.has(decl.name) && decl.name !== "init") {
			this.err(`${decl.name} redeclared in this block`, decl);
		}
		this.globals.define(decl.name, funcType);
	}

	checkFuncDecl(decl, outer) {
		const inner = new Scope(outer);
		// Inject type params into scope for generic functions
		if (decl.typeParams) {
			for (const tp of decl.typeParams) {
				const constraint = tp.constraint
					? this.resolveTypeNode(tp.constraint, outer)
					: ANY;
				inner.define(tp.name, { kind: "typeParam", name: tp.name, constraint });
			}
		}
		for (const p of decl.params) {
			inner.define(p.name, this.resolveTypeNode(p.type, inner));
		}
		let returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, inner)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(
			decl.returnType,
			inner,
			outer,
		);
		// Wrap the return type to avoid mutating the shared singleton
		if (hasNamedReturns && returnType)
			returnType = { ...returnType, _hasNamedReturns: true };
		const savedDefer = this._deferCount;
		this._deferCount = 0;
		this.checkBlock(decl.body, inner, returnType);
		this._reportUnused(inner, decl);
		if (this._deferCount > 0) decl.body._hasDefer = true;
		this._deferCount = savedDefer;
		decl._returnType = returnType;
		// Missing return check: non-void functions must terminate on all paths
		if (!isVoid(returnType) && !returnType._hasNamedReturns) {
			if (!this._isTerminating(decl.body)) {
				this.err(`missing return at end of function '${decl.name}'`, decl);
			}
		}
	}

	checkMethodDecl(decl, outer) {
		const inner = new Scope(outer);
		// For generic receiver types (e.g. Stack[T]), inject type params
		const recvTypeName =
			decl.recvType.kind === "GenericTypeName"
				? decl.recvType.name
				: decl.recvType.name;
		const recvNamedType = this.types.get(recvTypeName);
		if (recvNamedType?._generic) {
			for (const tp of recvNamedType._generic.typeParams) {
				inner.define(tp.name, tp);
			}
		}
		const recvType = this.resolveTypeNodeName(decl.recvType, outer);
		inner.define(decl.recvName, recvType);
		for (const p of decl.params) {
			inner.define(p.name, this.resolveTypeNode(p.type, inner));
		}
		let returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, inner)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(
			decl.returnType,
			inner,
			inner,
		);
		if (hasNamedReturns && returnType)
			returnType = { ...returnType, _hasNamedReturns: true };
		const savedDefer = this._deferCount;
		this._deferCount = 0;
		this.checkBlock(decl.body, inner, returnType);
		this._reportUnused(inner, decl);
		if (this._deferCount > 0) decl.body._hasDefer = true;
		this._deferCount = savedDefer;
		decl._returnType = returnType;
		// Missing return check
		if (!isVoid(returnType) && !returnType._hasNamedReturns) {
			if (!this._isTerminating(decl.body)) {
				this.err(`missing return at end of method '${decl.name}'`, decl);
			}
		}
	}

	// Go spec §Terminating statements — returns true if the statement always terminates.
	_isPanicCall(expr) {
		return (
			expr?.kind === "CallExpr" &&
			expr?.func?.kind === "Ident" &&
			expr?.func?.name === "panic"
		);
	}

	_isTerminating(stmt) {
		if (!stmt) return false;
		switch (stmt.kind) {
			case "ReturnStmt":
				return true;
			case "BranchStmt":
				// panic() is in ExprStmt, not BranchStmt — but "goto" could be here
				return false;
			case "ExprStmt":
				return this._isPanicCall(stmt.expr);
			case "Block":
				return this._isTerminatingBlock(stmt);
			case "IfStmt":
				// Terminating if: has else, and both branches terminate
				if (!stmt.elseBody) return false;
				return (
					this._isTerminatingBlock(stmt.body) &&
					(stmt.elseBody.kind === "Block"
						? this._isTerminatingBlock(stmt.elseBody)
						: this._isTerminating(stmt.elseBody))
				);
			case "ForStmt":
				// Infinite loop (no condition) with no break — terminating
				if (!stmt.cond && !this._blockHasBreak(stmt.body)) return true;
				return false;
			case "SwitchStmt":
				// Terminating switch: has default and every case terminates
				return this._isTerminatingSwitch(stmt);
			case "TypeSwitchStmt":
				return this._isTerminatingTypeSwitch(stmt);
			case "LabeledStmt":
				return this._isTerminating(stmt.body);
			default:
				return false;
		}
	}

	_isTerminatingBlock(block) {
		if (!block?.stmts?.length) return false;
		return this._isTerminating(block.stmts[block.stmts.length - 1]);
	}

	_blockHasBreak(block) {
		if (!block?.stmts) return false;
		for (const s of block.stmts) {
			if (s.kind === "BranchStmt" && s.keyword === "break") return true;
		}
		return false;
	}

	_isTerminatingSwitch(stmt) {
		let hasDefault = false;
		for (const c of stmt.cases ?? []) {
			if (!c.list) hasDefault = true;
			if (!c.stmts?.length) return false;
			const last = c.stmts[c.stmts.length - 1];
			if (!this._isTerminating(last)) return false;
		}
		return hasDefault;
	}

	_isTerminatingTypeSwitch(stmt) {
		let hasDefault = false;
		for (const c of stmt.cases ?? []) {
			if (!c.types) hasDefault = true;
			if (!c.stmts?.length) return false;
			const last = c.stmts[c.stmts.length - 1];
			if (!this._isTerminating(last)) return false;
		}
		return hasDefault;
	}

	_injectNamedReturns(returnTypeNode, scope, outer) {
		if (!returnTypeNode?._namedReturns) return false;
		for (const { name, type } of returnTypeNode._namedReturns) {
			if (name) scope.define(name, this.resolveTypeNode(type, outer));
		}
		return true;
	}

	checkVarDecl(decl, scope) {
		for (const spec of decl.decls) {
			let type = spec.type ? this.resolveTypeNode(spec.type, scope) : null;
			if (spec.value) {
				const valTypes = spec.value.map((v) => this.checkExpr(v, scope));
				if (!type) type = defaultType(valTypes[0]) ?? ANY;
				for (let i = 0; i < spec.names.length; i++) {
					const vt = valTypes[i] ?? ANY;
					this.assertAssignable(type, vt, spec.value[i]);
				}
			}
			if (!type) type = ANY;
			for (const name of spec.names) scope.defineLocal(name, type);
		}
	}

	checkConstDecl(decl, scope) {
		for (const spec of decl.decls) {
			const valTypes = spec.value.map((v) => this.checkExpr(v, scope));
			// Explicit type annotation → typed constant; otherwise preserve untyped
			const type = spec.type
				? this.resolveTypeNode(spec.type, scope)
				: (valTypes[0] ?? ANY);
			for (const name of spec.names) scope.defineConst(name, type);
		}
	}

	// ── Statement checking ───────────────────────────────────────

	// ── Type resolution ──────────────────────────────────────────

	resolveTypeNode(node, scope) {
		if (!node) return ANY;
		switch (node.kind) {
			case "TypeName": {
				if (BASIC_TYPES[node.name]) return BASIC_TYPES[node.name];
				if (node.name === "comparable")
					return { kind: "basic", name: "comparable" };
				// Check scope for type params before checking this.types
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
				if (base.kind === "named" && base._generic) {
					return this.instantiateGenericType(
						base._generic,
						node.typeArgs,
						scope,
					);
				}
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
				return {
					kind: "slice",
					elem: this.resolveTypeNode(node.elem, scope),
				};
			case "ArrayType":
				return {
					kind: "array",
					// inferLen: true means [...]T — size is determined by composite literal
					size: node.inferLen
						? null
						: node.size?.value !== undefined
							? Number(node.size.value)
							: node.size,
					elem: this.resolveTypeNode(node.elem, scope),
				};
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
			case "FuncType": {
				const params = node.params.map((p) =>
					this.resolveTypeNode(p.type, scope),
				);
				const returns = node.returnType
					? [this.resolveTypeNode(node.returnType, scope)]
					: [VOID];
				return { kind: "func", params, returns };
			}
			case "StructType":
				return this._resolveStructType(node, scope);
			case "InterfaceType":
				return this._resolveInterfaceType(node, scope);
			case "TupleType": {
				return {
					kind: "tuple",
					types: node.types.map((t) => this.resolveTypeNode(t, scope)),
				};
			}
			// Expression used as type (e.g. in make/new calls)
			case "Ident":
				return this.resolveTypeNode(
					{ kind: "TypeName", name: node.name },
					scope,
				);
			default:
				return ANY;
		}
	}

	resolveTypeNodeName(node, scope) {
		if (!node) return ANY;
		if (node.kind === "TypeName") {
			const named = this.types.get(node.name);
			if (named) return named;
		}
		if (node.kind === "GenericTypeName") {
			const named = this.types.get(node.name);
			if (named) return named;
		}
		return this.resolveTypeNode(node, scope);
	}

	_resolveStructType(node, scope) {
		const fields = new Map();
		const embeds = []; // track embedded types to merge methods later
		for (const f of node.fields) {
			const ft = this.resolveTypeNode(f.type, scope);
			if (f.embedded) {
				// Flatten embedded struct fields
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
	}

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
		// Flatten embedded interface methods
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
	}

	// ── Helpers ───────────────────────────────────────────────────

	// ── Generics — instantiation, inference, substitution ────────

	substituteType(type, map) {
		if (!type) return type;
		if (type.kind === "typeParam") {
			const bound = map.get(type.name);
			return bound ?? type;
		}
		switch (type.kind) {
			case "basic":
			case "untyped":
				return type;
			case "slice":
				return { kind: "slice", elem: this.substituteType(type.elem, map) };
			case "array":
				return {
					kind: "array",
					size: type.size,
					elem: this.substituteType(type.elem, map),
				};
			case "map":
				return {
					kind: "map",
					key: this.substituteType(type.key, map),
					value: this.substituteType(type.value, map),
				};
			case "func": {
				return {
					kind: "func",
					params: type.params.map((p) => this.substituteType(p, map)),
					returns: type.returns.map((r) => this.substituteType(r, map)),
					variadic: type.variadic,
					async: type.async,
				};
			}
			case "struct": {
				const fields = new Map();
				for (const [k, v] of type.fields)
					fields.set(k, this.substituteType(v, map));
				const methods = new Map();
				for (const [k, v] of type.methods)
					methods.set(k, this.substituteType(v, map));
				return {
					kind: "struct",
					name: type.name,
					fields,
					methods,
					_embeds: type._embeds,
				};
			}
			case "interface": {
				const methods = new Map();
				for (const [k, v] of type.methods)
					methods.set(k, this.substituteType(v, map));
				return { kind: "interface", name: type.name, methods };
			}
			case "named":
				return {
					kind: "named",
					name: type.name,
					underlying: this.substituteType(type.underlying, map),
				};
			case "pointer":
				return { kind: "pointer", base: this.substituteType(type.base, map) };
			case "tuple":
				return {
					kind: "tuple",
					types: type.types.map((t) => this.substituteType(t, map)),
				};
			default:
				return type;
		}
	}

	instantiateGenericFunc(genericType, typeArgs) {
		const map = new Map();
		for (let i = 0; i < genericType.typeParams.length; i++) {
			map.set(genericType.typeParams[i].name, typeArgs[i] ?? ANY);
		}
		return this.substituteType(genericType.underlying, map);
	}

	instantiateGenericType(generic, typeArgNodes, scope) {
		const map = new Map();
		const typeArgs = typeArgNodes.map((n) => this.resolveTypeNode(n, scope));
		for (let i = 0; i < generic.typeParams.length; i++) {
			map.set(generic.typeParams[i].name, typeArgs[i] ?? ANY);
		}
		// Resolve the underlying type from the decl node using a scope with type params bound
		const typeScope = new Scope(this.globals);
		for (const [name, type] of map) typeScope.define(name, type);
		const underlying = this.resolveTypeNode(generic.declNode.type, typeScope);
		const instantiated = this.substituteType(underlying, map);
		if (instantiated.kind === "struct") {
			instantiated.name = generic.declNode.name;
			if (!instantiated.methods) instantiated.methods = new Map();
			// Copy and substitute methods from the generic
			if (generic.methods) {
				for (const [mName, mType] of generic.methods) {
					instantiated.methods.set(mName, this.substituteType(mType, map));
				}
			}
		}
		return {
			kind: "named",
			name: generic.declNode.name,
			underlying: instantiated,
		};
	}

	inferTypeArgs(genericType, argTypes) {
		const map = new Map();
		const params = genericType.underlying.params;
		for (let i = 0; i < params.length && i < argTypes.length; i++) {
			this._inferFromPair(params[i], argTypes[i], map);
		}
		// Check all type params are resolved
		for (const tp of genericType.typeParams) {
			if (!map.has(tp.name)) return null;
		}
		// Apply defaultType to resolve untyped constants
		const result = [];
		for (const tp of genericType.typeParams) {
			result.push(defaultType(map.get(tp.name)));
		}
		return result;
	}

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
	}

	_inferFromStructuredPair(paramType, argType, map) {
		if (paramType.kind === "slice" && argType.kind === "slice")
			this._inferFromPair(paramType.elem, argType.elem, map);
		if (paramType.kind === "map" && argType.kind === "map") {
			this._inferFromPair(paramType.key, argType.key, map);
			this._inferFromPair(paramType.value, argType.value, map);
		}
		if (paramType.kind === "func" && argType.kind === "func")
			this._inferFromFuncPair(paramType, argType, map);
	}

	_inferFromPair(paramType, argType, map) {
		if (!paramType || !argType) return;
		if (paramType.kind === "typeParam") {
			if (!map.has(paramType.name)) map.set(paramType.name, argType);
			return;
		}
		this._inferFromStructuredPair(paramType, argType, map);
	}

	_checkUnionConstraint(typeArg, constraint, node) {
		for (const term of constraint.terms) {
			if (term.approx) return;
			const termType = this.resolveTypeNode(term.type, this.globals);
			if (typeStr(typeArg) === typeStr(termType)) return;
		}
		this.err(`type ${typeStr(typeArg)} does not satisfy constraint`, node);
	}

	_checkInterfaceConstraint(typeArg, base, constraint, node) {
		if (base.methods.size === 0 && !base.unionConstraint) return;
		if (base.unionConstraint) {
			this.checkConstraint(typeArg, base.unionConstraint, node);
			return;
		}
		if (!this.implements(typeArg, base, node)) {
			this.err(
				`type ${typeStr(typeArg)} does not satisfy constraint ${typeStr(constraint)}`,
				node,
			);
		}
	}

	checkConstraint(typeArg, constraint, node) {
		if (!constraint) return;
		if (isAny(constraint)) return;
		if (constraint.kind === "basic" && constraint.name === "comparable") return;
		if (constraint.kind === "UnionConstraint") {
			this._checkUnionConstraint(typeArg, constraint, node);
			return;
		}
		const base =
			constraint.kind === "named" ? constraint.underlying : constraint;
		if (base?.kind === "interface")
			this._checkInterfaceConstraint(typeArg, base, constraint, node);
	}

	resolveType(t) {
		if (!t) return ANY;
		if (t.kind === "basic" && t.alias) {
			const found = this.types.get(t.alias);
			if (found) return found;
		}
		return t;
	}

	fieldType(baseType, field, node) {
		baseType = this.resolveType(baseType);
		if (!baseType || isAny(baseType)) return ANY;
		// Transparent pointer dereference for named-type method calls: (*T).Method works like T.Method
		// (only unwrap when the pointer's base is a named type that has methods)
		if (
			baseType.kind === "pointer" &&
			field !== "value" &&
			baseType.base?.kind === "named"
		) {
			baseType = this.resolveType(baseType.base);
		}
		// Check methods on named type itself (for non-struct named types)
		if (baseType.kind === "named" && baseType.methods?.has(field)) {
			return baseType.methods.get(field);
		}
		let base = baseType.kind === "named" ? baseType.underlying : baseType;
		base = this.resolveType(base);
		if (base?.kind === "struct")
			return this._fieldTypeStruct(base, baseType, field, node);
		if (base?.kind === "interface")
			return this._fieldTypeInterface(base, baseType, field, node);
		if (base?.kind === "namespace")
			return this._fieldTypeNamespace(base, field, node);
		if (base && !isAny(base))
			return this._fieldTypeBadAccess(base, baseType, field, node);
		return ANY;
	}

	_fieldTypeStruct(base, baseType, field, node) {
		if (base.fields?.has(field)) return base.fields.get(field);
		if (base.methods?.has(field)) return base.methods.get(field);
		return this.err(`No field '${field}' on ${typeStr(baseType)}`, node);
	}

	_fieldTypeInterface(base, baseType, field, node) {
		if (base.methods?.has(field)) return base.methods.get(field);
		return this.err(`No method '${field}' on ${typeStr(baseType)}`, node);
	}

	_fieldTypeBadAccess(base, baseType, field, node) {
		if (base.kind === "pointer" && field === "value") return base.base ?? ANY;
		const badKinds = ["basic", "slice", "array", "map", "func", "tuple"];
		if (badKinds.includes(base.kind))
			return this.err(
				`${typeStr(baseType ?? base)} has no field or method '${field}'`,
				node,
			);
		return ANY;
	}

	_fieldTypeNamespace(base, field, node) {
		// Enforce exported identifier rule for GoFront packages only
		if (
			base._gofront &&
			field.length > 0 &&
			field[0] >= "a" &&
			field[0] <= "z"
		) {
			return this.err(
				`cannot refer to unexported name ${base.name}.${field}`,
				node,
			);
		}
		if (field in base.members) return base.members[field];
		return this.err(`No member '${field}' in namespace ${base.name}`, node);
	}

	_binaryResultTypeTypeParam(op, lt, rt) {
		if (CMP_OPS.has(op)) return BOOL;
		if (LOG_OPS.has(op)) return BOOL;
		return lt?.kind === "typeParam" ? lt : rt;
	}

	_binaryResultTypeString(lt, rt) {
		if (lt.kind === "untyped" && rt.kind === "untyped") return lt;
		if (lt.kind === "untyped") return rt;
		if (rt.kind === "untyped") return lt;
		return STRING;
	}

	binaryResultType(op, lt, rt, node) {
		if (lt?.kind === "typeParam" || rt?.kind === "typeParam")
			return this._binaryResultTypeTypeParam(op, lt, rt);
		if (CMP_OPS.has(op)) return this._binaryResultTypeCmp(op, lt, rt, node);
		if (LOG_OPS.has(op)) return BOOL;
		if (isAny(lt) || isAny(rt)) return ANY;
		if (isComplex(lt) || isComplex(rt))
			return this._binaryResultTypeComplex(op, lt, rt, node);
		if (isNumeric(lt) && isNumeric(rt))
			return this._binaryResultTypeNumeric(lt, rt);
		if (isString(lt) && isString(rt) && op === "+")
			return this._binaryResultTypeString(lt, rt);
		if (node)
			this.err(`Invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
		return ANY;
	}

	_checkComplexCmpOp(op, lt, rt, node) {
		if (isComplex(lt) || isComplex(rt)) {
			if (op !== "==" && op !== "!=") {
				this.err(
					`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`,
					node,
				);
				return true;
			}
		}
		return false;
	}

	_isNonComparableKind(t) {
		const base = t?.kind === "named" ? t.underlying : t;
		return (
			base?.kind === "slice" || base?.kind === "map" || base?.kind === "func"
		);
	}

	_checkEqualityComparable(op, lt, rt, node) {
		if (op !== "==" && op !== "!=") return;
		if (isNil(lt) || isNil(rt)) return;
		for (const t of [lt, rt]) {
			if (this._isNonComparableKind(t))
				this.err(`operator ${op} not defined on ${typeStr(t)}`, node);
		}
	}

	_binaryResultTypeCmp(op, lt, rt, node) {
		if (this._checkComplexCmpOp(op, lt, rt, node)) return ANY;
		this._checkEqualityComparable(op, lt, rt, node);
		return BOOL;
	}

	_binaryResultTypeComplex(op, lt, rt, node) {
		if (!isComplexOrNumeric(lt) || !isComplexOrNumeric(rt)) {
			this.err(`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
			return ANY;
		}
		if (op !== "+" && op !== "-" && op !== "*" && op !== "/") {
			this.err(`invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
			return ANY;
		}
		if (lt.kind === "untyped" && rt.kind === "untyped") return UNTYPED_COMPLEX;
		return COMPLEX128;
	}

	_binaryResultTypeNumeric(lt, rt) {
		const lFloat = (lt.kind === "untyped" ? lt.base : lt.name) === "float64";
		const rFloat = (rt.kind === "untyped" ? rt.base : rt.name) === "float64";
		const isFloat = lFloat || rFloat;
		// Both untyped → result is untyped
		if (lt.kind === "untyped" && rt.kind === "untyped")
			return isFloat ? UNTYPED_FLOAT : UNTYPED_INT;
		// One typed, one untyped → typed wins
		if (lt.kind === "untyped")
			return isFloat && rt.name !== "float64" ? FLOAT64 : rt;
		if (rt.kind === "untyped")
			return isFloat && lt.name !== "float64" ? FLOAT64 : lt;
		// Both typed
		return isFloat ? FLOAT64 : INT;
	}

	_isNumericCoercible(target, source) {
		if (target.kind !== "basic" || source.kind !== "basic") return false;
		return (
			(target.name === "float64" && source.name === "int") ||
			(target.name === "int" && source.name === "float64")
		);
	}

	_assertAssignableEarlyReturn(target, source) {
		if (target?.kind === "typeParam" || source?.kind === "typeParam")
			return true;
		if (isAny(target) || isAny(source)) return true;
		if (isNil(source)) return true;
		return false;
	}

	_isPointerPair(target, source) {
		return isPointer(target) && isPointer(source);
	}

	_assertPointerAssignable(target, source, node) {
		this.assertAssignable(
			target.base ?? target.underlying?.base,
			source.base ?? source.underlying?.base,
			node,
		);
	}

	assertAssignable(target, source, node) {
		if (!target || !source) return;
		target = this.resolveType(target);
		source = this.resolveType(source);
		if (this._assertAssignableEarlyReturn(target, source)) return;
		if (this._isPointerPair(target, source)) {
			this._assertPointerAssignable(target, source, node);
			return;
		}
		if (isUntyped(source) && this._isUntypedAssignable(target, source)) return;
		if (this._isNumericCoercible(target, source)) return;
		if (this._checkArrayAssignable(target, source, node)) return;
		if (typeStr(target) !== typeStr(source))
			this._assertAssignableTypeMismatch(target, source, node);
	}

	_assertAssignableTypeMismatch(target, source, node) {
		let tBase = target.kind === "named" ? target.underlying : target;
		tBase = this.resolveType(tBase);
		if (tBase?.kind === "interface") {
			// Empty interface (interface{}) accepts any type
			if (tBase.methods.size === 0) return;
			if (!this.implements(source, tBase, node)) {
				this.err(
					`${typeStr(source)} does not implement ${typeStr(target)}`,
					node,
				);
			}
			return;
		}
		this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
	}

	// Returns true if untyped source is assignable to target (no error needed).
	_isUntypedAssignable(target, source) {
		if (isUntyped(target)) return true; // untyped → untyped always OK
		if (target.kind !== "basic") return false;
		return (
			(UNTYPED_COMPAT[source.base]?.has(target.name) ?? false) ||
			(isComplex(target) &&
				(source.base === "int" || source.base === "float64"))
		);
	}

	// Handles array/array, array/slice, slice/array assignability checks.
	// Returns true if the case was handled (caller should return), false to continue.
	_checkArrayAssignable(target, source, node) {
		if (target.kind === "array" && source.kind === "array") {
			if (
				target.size != null &&
				source.size != null &&
				target.size !== source.size
			) {
				this.err(
					`Cannot assign ${typeStr(source)} to ${typeStr(target)} (different array lengths)`,
					node,
				);
				return true;
			}
			this.assertAssignable(target.elem, source.elem, node);
			return true;
		}
		if (target.kind === "array" && source.kind === "slice") {
			this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
			return true;
		}
		if (target.kind === "slice" && source.kind === "array") {
			this.err(`Cannot assign ${typeStr(source)} to ${typeStr(target)}`, node);
			return true;
		}
		return false;
	}

	_sigParamsMatch(reqList, actList) {
		if (reqList.length !== actList.length) return false;
		for (let i = 0; i < reqList.length; i++) {
			if (typeStr(reqList[i]) !== typeStr(actList[i])) return false;
		}
		return true;
	}

	_implementsMethod(required, actual) {
		if (!actual) return false;
		const rp = required.params ?? [],
			ap = actual.params ?? [];
		const rr = required.returns ?? [],
			ar = actual.returns ?? [];
		if (!this._sigParamsMatch(rp, ap)) return false;
		if (!!required.variadic !== !!actual.variadic) return false;
		return this._sigParamsMatch(rr, ar);
	}

	implements(srcType, iface, _node) {
		let base = srcType.kind === "named" ? srcType.underlying : srcType;
		base = this.resolveType(base);
		const methodMap =
			base?.kind === "struct"
				? base.methods
				: srcType.kind === "named"
					? srcType.methods
					: null;
		if (!methodMap) return false;
		for (const [name, required] of iface.methods) {
			if (!this._implementsMethod(required, methodMap.get(name))) return false;
		}
		return true;
	}
}

Object.assign(TypeChecker.prototype, statementCheckMethods);
Object.assign(TypeChecker.prototype, expressionCheckMethods);
