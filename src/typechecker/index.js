// Type checker: walks the AST, resolves types for all expressions,
// and reports type errors at compile time.
//
// Split into sub-modules under typechecker/:
//   types.js          — shared type constants, predicates, Scope
//   stdlib.js         — browser globals + all built-in package registrations
//   statements.js     — checkBlock, checkStmt
//   expressions.js    — checkExpr, checkCall, checkBuiltin, checkCompositeLit
//   termination.js    — _isTerminating* family
//   resolve.js        — resolveTypeNode, fieldType, generics
//   assignability.js  — assertAssignable, binaryResultType, implements

import { assignabilityMethods } from "./assignability.js";
import { expressionCheckMethods } from "./expressions.js";
import { resolveMethods } from "./resolve.js";
import { statementCheckMethods } from "./statements.js";
import { setupGlobals } from "./stdlib.js";
import { terminationMethods } from "./termination.js";
import {
	ANY,
	defaultType,
	ERROR,
	isVoid,
	Scope,
	TypeCheckError,
	typeStr,
	VOID,
} from "./types.js";

// Re-export for consumers that import from typechecker.js
export { TypeCheckError, typeStr };

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
		this._injectTypeParams(decl, inner, outer);
		for (const p of decl.params) {
			inner.define(p.name, this.resolveTypeNode(p.type, inner));
		}
		const returnType = this._setupFuncReturnType(decl, inner, outer);
		this._runFuncBody(decl, inner, returnType);
		this._checkMissingReturn(decl, returnType, "function");
	}

	checkMethodDecl(decl, outer) {
		const inner = new Scope(outer);
		const recvTypeName =
			decl.recvType.kind === "GenericTypeName"
				? decl.recvType.name
				: decl.recvType.name;
		const recvNamedType = this.types.get(recvTypeName);
		this._injectGenericReceiverTypeParams(inner, recvNamedType);
		const recvType = this.resolveTypeNodeName(decl.recvType, outer);
		inner.define(decl.recvName, recvType);
		for (const p of decl.params) {
			inner.define(p.name, this.resolveTypeNode(p.type, inner));
		}
		const returnType = this._setupFuncReturnType(decl, inner, inner);
		this._runFuncBody(decl, inner, returnType);
		this._checkMissingReturn(decl, returnType, "method");
	}

	_injectTypeParams(decl, inner, outer) {
		if (!decl.typeParams) return;
		for (const tp of decl.typeParams) {
			const constraint = tp.constraint
				? this.resolveTypeNode(tp.constraint, outer)
				: ANY;
			inner.define(tp.name, { kind: "typeParam", name: tp.name, constraint });
		}
	}

	_injectGenericReceiverTypeParams(inner, recvNamedType) {
		if (!recvNamedType?._generic) return;
		for (const tp of recvNamedType._generic.typeParams) {
			inner.define(tp.name, tp);
		}
	}

	_setupFuncReturnType(decl, inner, outer) {
		let returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, inner)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(
			decl.returnType,
			inner,
			outer,
		);
		if (hasNamedReturns && returnType)
			returnType = { ...returnType, _hasNamedReturns: true };
		return returnType;
	}

	_runFuncBody(decl, inner, returnType) {
		const savedDefer = this._deferCount;
		this._deferCount = 0;
		this.checkBlock(decl.body, inner, returnType);
		this._reportUnused(inner, decl);
		if (this._deferCount > 0) decl.body._hasDefer = true;
		this._deferCount = savedDefer;
		decl._returnType = returnType;
	}

	_checkMissingReturn(decl, returnType, kind) {
		if (!isVoid(returnType) && !returnType._hasNamedReturns) {
			if (!this._isTerminating(decl.body)) {
				this.err(`missing return at end of ${kind} '${decl.name}'`, decl);
			}
		}
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
}

Object.assign(TypeChecker.prototype, statementCheckMethods);
Object.assign(TypeChecker.prototype, expressionCheckMethods);
Object.assign(TypeChecker.prototype, terminationMethods);
Object.assign(TypeChecker.prototype, resolveMethods);
Object.assign(TypeChecker.prototype, assignabilityMethods);
