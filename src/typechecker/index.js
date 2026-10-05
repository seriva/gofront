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
	TAINTED_ANY,
	TypeCheckError,
	typeStr,
	VALID_TARGETS,
	VOID,
} from "./types.js";

function rootIdentName(e) {
	if (!e) return null;
	if (e.kind === "Ident") return e.name;
	if (e.kind === "SelectorExpr" || e.kind === "IndexExpr")
		return rootIdentName(e.expr);
	return null;
}

// Re-export for consumers that import from typechecker.js
export { TypeCheckError, typeStr };

export class TypeChecker {
	constructor() {
		this.types = new Map(); // named types
		this.globals = new Scope();
		this.errors = [];
		this.target = "js";
		this.pkgName = null;
		this.blockers = new Map();
		this.summary = null;
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

	recordBlocker(category, item = null) {
		if (!this.blockers.has(category)) {
			this.blockers.set(category, []);
		}
		this.blockers.get(category).push(item);
	}

	getSummary() {
		if (this.blockers.size === 0) return null;
		let total = 0;
		const parts = [];
		for (const [category, items] of this.blockers) {
			const uniqueItems = [
				...new Set(items.filter((x) => x != null && x !== "")),
			];
			const count = uniqueItems.length > 0 ? uniqueItems.length : items.length;
			total += count;
			const itemsStr =
				uniqueItems.length > 0 ? ` (${uniqueItems.join(", ")})` : "";
			// "gom usage" is a mass noun; everything else pluralises on the last word.
			const label =
				count === 1 || category === "gom usage" ? category : `${category}s`;
			parts.push(`${count} ${label}${itemsStr}`);
		}
		const noun = total === 1 ? "blocker" : "blockers";
		const what = this.target === "both" ? "both" : "wasm";
		return `package '${this.pkgName}' cannot be ${what}: ${total} ${noun} — ${parts.join(", ")}`;
	}

	err(msg, node, hint = null) {
		const e = new TypeCheckError(
			msg,
			node,
			this._currentFile,
			this._currentSource,
			hint,
		);
		this.errors.push(e);
		return TAINTED_ANY; // tainted recovery type — suppresses downstream cascade errors
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
		return this.checkAll([program]);
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

	checkAll(programs) {
		for (const p of programs) {
			const d = p._targetDirective;
			if (!d) continue;
			this._setCurrentFile(p);
			if (!VALID_TARGETS.has(d.value)) {
				this.err(
					`unknown //gofront:target '${d.value}' (expected js, wasm or both)`,
					d,
				);
				p.target = null;
				if (this.target === d.value) this.target = "js";
			} else if (!d.beforePackage) {
				this.err("//gofront:target must appear before the package clause", d);
			}
		}
		if (programs.length > 0) {
			if (!this.target || this.target === "js") {
				const pTarget = programs.find((p) => p.target)?.target;
				if (pTarget) this.target = pTarget;
			}
			if (!this.pkgName) {
				this.pkgName = programs[0].pkg?.name ?? null;
			}
		}

		if (this.target === "wasm" || this.target === "both") {
			for (const p of programs) {
				if (p._filename?.endsWith(".templ")) {
					this._setCurrentFile(p);
					const fileName = p._filename.split("/").pop();
					this.recordBlocker(".templ file", fileName);
					this.err(
						`.templ files are not allowed in wasm packages; move '${fileName}' to a js package`,
						p.pkg,
					);
				}
			}
		}

		this._collectTypesPass(programs);
		this._collectFuncsPass(programs);
		this._promoteEmbeddedMethods();
		this._collectVarsConstsPass(programs);
		this._checkTopDeclsPass(programs);

		if (this.target === "both") {
			this._checkMutablePackageVars(programs);
		}

		if (this.blockers.size > 0) {
			const summaryLine = this.getSummary();
			this.summary = summaryLine;
			const summaryErr = new Error(summaryLine);
			summaryErr.isSummary = true;
			this.errors.push(summaryErr);
		}

		return this.errors;
	}

	_checkMutablePackageVars(programs) {
		const pkgVars = new Set();
		for (const p of programs) {
			for (const d of p.decls) {
				if (d.kind === "VarDecl") {
					for (const spec of d.decls) {
						for (const name of spec.names) {
							if (name !== "_") pkgVars.add(name);
						}
					}
				}
			}
		}
		if (pkgVars.size === 0) return;

		const SCOPE_KINDS = new Set([
			"Block",
			"FuncLit",
			"ForStmt",
			"IfStmt",
			"SwitchStmt",
			"TypeSwitchStmt",
			"CaseClause",
		]);

		const report = (root, node) => {
			this.recordBlocker("mutable package variable", root);
			this.err(
				`package-level variable '${root}' is mutated; not allowed in 'both' packages (each target gets its own copy)`,
				node,
			);
		};

		const checkBody = (body, initialLocals) => {
			const scopes = [new Set(initialLocals)];
			const isLocal = (name) => scopes.some((s) => s.has(name));
			const declare = (name) => {
				if (name && name !== "_") scopes[scopes.length - 1].add(name);
			};
			const flag = (e, node) => {
				const root = rootIdentName(e);
				if (root && pkgVars.has(root) && !isLocal(root)) report(root, node);
			};

			const walk = (node) => {
				if (!node || typeof node !== "object") return;
				if (Array.isArray(node)) {
					for (const item of node) walk(item);
					return;
				}
				const opensScope = SCOPE_KINDS.has(node.kind);
				if (opensScope) scopes.push(new Set());
				switch (node.kind) {
					case "FuncLit":
						for (const p of node.params ?? []) declare(p.name);
						for (const r of node.returnType?._namedReturns ?? [])
							declare(r.name);
						break;
					case "VarDecl":
						for (const spec of node.decls ?? [])
							for (const name of spec.names ?? []) declare(name);
						break;
					case "DefineStmt":
						for (const e of node.lhs ?? [])
							if (e.kind === "Ident") declare(e.name);
						break;
					case "TypeSwitchStmt":
						declare(node.assign);
						break;
					case "AssignStmt":
						for (const e of node.lhs) flag(e, node);
						break;
					case "IncDecStmt":
						flag(node.expr, node);
						break;
					case "UnaryExpr":
						if (node.op === "&") flag(node.operand, node);
						break;
					case "SelectorExpr":
						// Pointer-receiver method call or value: `G.Bump()` mutates G.
						if (node._isMethodValue && node._type?._ptrRecv)
							flag(node.expr, node);
						break;
				}
				for (const key of Object.keys(node)) {
					if (key.startsWith("_")) continue;
					walk(node[key]);
				}
				if (opensScope) scopes.pop();
			};
			walk(body);
		};

		for (const p of programs) {
			if (p._filename?.endsWith("_test.go")) continue;
			this._currentFile = p._filename;
			this._currentSource = p._source;
			for (const d of p.decls) {
				if ((d.kind === "FuncDecl" || d.kind === "MethodDecl") && d.body) {
					if (d.name === "init" && d.kind === "FuncDecl") continue;
					const locals = [];
					if (d.recvName) locals.push(d.recvName);
					for (const prm of d.params ?? []) if (prm.name) locals.push(prm.name);
					for (const r of d.returnType?._namedReturns ?? [])
						if (r.name) locals.push(r.name);
					checkBody(d.body, locals);
				} else if (d.kind === "VarDecl") {
					// Closures in package-level initializers run after init.
					for (const spec of d.decls ?? []) checkBody(spec.value, []);
				}
			}
		}
	}

	_collectTypesPass(programs) {
		for (const p of programs) {
			for (const d of p.decls) {
				if (d.kind === "TypeDecl" && !d.isAlias && !this.types.has(d.name)) {
					const placeholder = { kind: "named", name: d.name, underlying: null };
					this.types.set(d.name, placeholder);
					this.globals.define(d.name, placeholder);
				}
			}
		}
		const all = [];
		for (const p of programs) {
			for (const d of p.decls) if (d.kind === "TypeDecl") all.push({ p, d });
		}
		// Collect in dependency order so aliases, generics, embedded and by-value
		// field types declared later (or in other files) are ready when needed.
		let pending = all;
		while (pending.length > 0) {
			const pendingNames = new Map(pending.map((x) => [x.d.name, x.d]));
			const ready = pending.filter(
				(x) => !this._typeDeclBlocked(x.d, pendingNames),
			);
			const batch = ready.length > 0 ? ready : pending;
			for (const { p, d } of batch) {
				this._setCurrentFile(p);
				this.collectType(d);
			}
			pending =
				ready.length > 0 ? pending.filter((x) => !ready.includes(x)) : [];
		}
	}

	_typeDeclBlocked(decl, pendingNames) {
		const visit = (node, indirect) => {
			if (!node || typeof node !== "object") return false;
			if (Array.isArray(node)) return node.some((n) => visit(n, indirect));
			if (
				(node.kind === "TypeName" || node.kind === "GenericTypeName") &&
				node.name !== decl.name
			) {
				const dep = pendingNames.get(node.name);
				if (dep && (!indirect || dep.isAlias || dep.typeParams)) return true;
			}
			const nextIndirect =
				indirect ||
				[
					"PointerType",
					"SliceType",
					"MapType",
					"FuncType",
					"ChanType",
				].includes(node.kind);
			return Object.keys(node).some(
				(k) => !k.startsWith("_") && visit(node[k], nextIndirect),
			);
		};
		return visit(decl.type, false);
	}

	_collectFuncsPass(programs) {
		for (const p of programs) {
			this._setCurrentFile(p);
			for (const d of p.decls) {
				if (d.kind === "FuncDecl" || d.kind === "MethodDecl")
					this.collectFunc(d);
				else if (d.kind === "TemplDecl") this._collectTemplDecl(d);
				else if (d.kind === "CssDecl") this._collectCssDecl(d);
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
			for (const d of p.decls) {
				if (d.kind === "VarDecl" || d.kind === "ConstDecl") {
					this.checkTopDecl(d, this.globals);
				}
			}
		}
		for (const p of programs) {
			this._setCurrentFile(p);
			for (const d of p.decls) {
				if (
					d.kind === "FuncDecl" ||
					d.kind === "MethodDecl" ||
					d.kind === "TemplDecl"
				) {
					this.checkTopDecl(d, this.globals);
				}
			}
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
			const existing = this.types.get(decl.name);
			const named =
				existing?.kind === "named"
					? existing
					: { kind: "named", name: decl.name };
			named.underlying = underlying;
			named._generic = {
				typeParams: typeParamTypes,
				declNode: decl,
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
		const existing = this.types.get(decl.name);
		const named =
			existing?.kind === "named"
				? existing
				: { kind: "named", name: decl.name };
		named.underlying = underlying;
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
		funcType._ptrRecv = Boolean(decl.recvPointer);
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
			case "CssDecl":
				break;
			case "TemplDecl":
				this._markTemplNodesUsed(decl.body);
				break;
		}
	}

	_markTokensUsed(tokens) {
		if (!tokens) return;
		for (const t of tokens) {
			if (t.type === "IDENT" || t.type?.name === "IDENT") {
				this.globals.lookup(t.value);
			}
		}
	}

	_markTemplNodesUsed(nodes) {
		if (!nodes) return;
		for (const n of nodes) {
			if (n.kind === "TemplElement") {
				for (const a of n.attrs || []) {
					if (a.tokens) this._markTokensUsed(a.tokens);
				}
				this._markTemplNodesUsed(n.children);
			} else if (n.kind === "TemplExpr" || n.kind === "TemplComponent") {
				this._markTokensUsed(n.tokens);
			} else if (n.kind === "TemplIf") {
				this._markTokensUsed(n.condTokens);
				this._markTemplNodesUsed(n.then);
				this._markTemplNodesUsed(n.else_);
			} else if (n.kind === "TemplFor") {
				this._markTokensUsed(n.stmtTokens);
				this._markTemplNodesUsed(n.body);
			} else if (n.kind === "TemplSwitch") {
				this._markTokensUsed(n.exprTokens);
				for (const c of n.cases || []) {
					this._markTokensUsed(c.caseTokens);
					this._markTemplNodesUsed(c.body);
				}
			}
		}
	}

	_collectCssDecl(decl) {
		if (this.target === "wasm" || this.target === "both") {
			this.recordBlocker("css declaration");
			this.err("css declarations are not allowed in wasm packages", decl);
		}
		const paramTypes = (decl.params || []).map((p) =>
			this.resolveTypeNode(p.type, this.globals),
		);
		const stringType = this.types.get("string") ?? {
			kind: "basic",
			name: "string",
		};
		const funcType = {
			kind: "func",
			params: paramTypes,
			returns: [stringType],
			variadic: false,
			async: false,
		};
		if (this.globals.symbols.has(decl.name) && decl.name !== "init") {
			this.err(`${decl.name} redeclared in this block`, decl);
		}
		this.globals.define(decl.name, funcType);
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
		if (
			(this.target === "wasm" || this.target === "both") &&
			(decl.async || decl.isAsync)
		) {
			this.recordBlocker("async function", decl.name);
			this.err(
				"async functions are not supported in wasm packages; keep async code in a js package",
				decl,
			);
		}
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
		if (
			(this.target === "wasm" || this.target === "both") &&
			(decl.async || decl.isAsync)
		) {
			this.recordBlocker("async function", decl.name);
			this.err(
				"async functions are not supported in wasm packages; keep async code in a js package",
				decl,
			);
		}
		const inner = new Scope(outer);
		const recvTypeName =
			decl.recvType.kind === "GenericTypeName"
				? decl.recvType.name
				: decl.recvType.name;
		const recvNamedType = this.types.get(recvTypeName);
		this._injectGenericReceiverTypeParams(inner, recvNamedType);
		const recvType = this.resolveTypeNodeName(decl.recvType, outer);
		inner.define(
			decl.recvName,
			decl.recvPointer ? { kind: "pointer", base: recvType } : recvType,
		);
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
