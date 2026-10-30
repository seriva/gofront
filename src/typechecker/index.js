// Type checker: walks the AST, resolves types for all expressions,
// and reports type errors at compile time.
//
// Split into sub-modules under typechecker/:
//   types.js          — shared type constants, predicates, Scope
//   stdlib/index.js   — browser globals + all built-in package registrations
//   statements.js     — checkBlock, checkStmt
//   expressions.js    — checkExpr, checkCall, checkBuiltin, checkCompositeLit
//   termination.js    — _isTerminating* family
//   resolve.js        — resolveTypeNode, fieldType, generics
//   assignability.js  — assertAssignable, binaryResultType, implements

import { assignabilityMethods } from "./assignability.js";
import { constantCheckMethods } from "./constants.js";
import { expressionCheckMethods } from "./expressions.js";
import { orderPackageInits, orderVarSpecsForTyping } from "./init-order.js";
import { resolveMethods } from "./resolve.js";
import { statementCheckMethods } from "./statements.js";
import { EXCLUDED_STDLIB_PACKAGES } from "./stdlib/excluded.js";
import { setupGlobals } from "./stdlib/index.js";
import { terminationMethods } from "./termination.js";
import {
	ANY,
	defaultType,
	ERROR,
	INTRINSICS,
	isAny,
	isBool,
	isVoid,
	Scope,
	TAINTED_ANY,
	TypeCheckError,
	typeStr,
	VALID_TARGETS,
	VOID,
} from "./types.js";

// Checker method per templ body node kind (see _checkTemplNodes).
const TEMPL_NODE_CHECKS = {
	TemplElement: "_checkTemplElement",
	TemplExpr: "_checkTemplLeaf",
	TemplComponent: "_checkTemplLeaf",
	TemplIf: "_checkTemplIf",
	TemplFor: "_checkTemplFor",
	TemplSwitch: "_checkTemplSwitch",
};

function rootIdentName(e) {
	if (!e) return null;
	if (e.kind === "Ident") return e.name;
	if (e.kind === "SelectorExpr" || e.kind === "IndexExpr")
		return rootIdentName(e.expr);
	return null;
}

// Re-export for consumers that import from typechecker.js
export { EXCLUDED_STDLIB_PACKAGES, TypeCheckError, typeStr };

// JavaScript built-ins that generated JS relies on; a JS class of the same
// name in the bundle would shadow them (see _checkGlobalTypeNamesPass).
const JS_BUILTIN_CLASSES = new Set([
	"Array",
	"ArrayBuffer",
	"BigInt",
	"BigInt64Array",
	"BigUint64Array",
	"Boolean",
	"DataView",
	"Date",
	"Error",
	"Float32Array",
	"Float64Array",
	"Int16Array",
	"Int32Array",
	"Int8Array",
	"JSON",
	"Map",
	"Math",
	"Number",
	"Object",
	"Promise",
	"RangeError",
	"Reflect",
	"RegExp",
	"Set",
	"String",
	"Symbol",
	"TextDecoder",
	"TextEncoder",
	"TypeError",
	"Uint16Array",
	"Uint32Array",
	"Uint8Array",
	"Uint8ClampedArray",
	"WeakMap",
	"WebAssembly",
]);

export class TypeChecker {
	constructor() {
		this.types = new Map(); // named types
		// Go's universe scope: builtins, browser globals and built-in package
		// namespaces.  Package declarations live in `globals` above it, so they
		// shadow predeclared names (`func Array()`, `var document int`).
		this.universe = new Scope();
		this.globals = new Scope(this.universe);
		this.errors = [];
		this.warnings = []; // non-fatal diagnostics (e.g. boundary-call-in-loop hints)
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
		this._constExprs = new Map(); // name -> AST initializer expr
		this._importedConsts = new Map(); // dot-imported const name -> value
		this._externalNames = new Set(); // package-scope names from .d.ts / npm definitions
		this._setupGlobals();
		// Register error as a named type (interface)
		this.types.set("error", ERROR);
	}

	_setupGlobals() {
		setupGlobals(this.universe, this.types);
	}

	// `external` marks values as real JS names (.d.ts / npm definitions) that
	// must not be renamed; dot-imported GoFront packages pass false so their
	// browser-global-named members get the same `$` renaming as local ones.
	// `consts` (dot-imported GoFront packages) maps constant names to their
	// folded values.
	addDefinitions(types, values, { external = true, consts = null } = {}) {
		for (const [name, type] of types) {
			this.types.set(name, type);
		}
		for (const [name, type] of values) {
			this.globals.define(name, type);
			if (external) this._externalNames.add(name);
		}
		for (const [name, v] of consts ?? []) {
			if (!v || !values.has(name)) continue;
			this.globals._consts.add(name);
			this._importedConsts.set(name, v);
		}
	}

	// Add an imported GoFront package as a qualified namespace.
	// e.g. addPackageNamespace('utils', symbolsMap, typesMap)
	// lets callers type-check `utils.Foo` via SelectorExpr.
	// `target` is the imported package's compile target ("js"/"wasm"/"both").
	// `consts` maps the package's constant names to their folded value (see
	// typechecker/const-fold.js), or null when the folder cannot evaluate one.
	addPackageNamespace(pkgName, symbols, types, target = null, consts = null) {
		const members = {};
		for (const [name, type] of symbols) members[name] = type;
		// _gofront: true marks this as a GoFront package — exported identifier rules apply
		this.globals.define(pkgName, {
			kind: "namespace",
			name: pkgName,
			members,
			_gofront: true,
			_target: target,
			_consts: consts,
		});
		for (const [name, type] of types) {
			const prior = this.types.get(name);
			if (prior && prior !== type && prior.kind === "named") {
				this._ambiguousImported ??= new WeakSet();
				this._ambiguousImported.add(prior);
				this._ambiguousImported.add(type);
			}
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
			if (!this.globals._used.has(name) && !this.universe._used.has(name)) {
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

	getExportedConsts() {
		const out = new Map();
		for (const name of this.globals._consts) {
			if (!this.globals.lookupConstExpr(name)) continue;
			out.set(name, this._constValue({ kind: "Ident", name }, this.globals));
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

	// Non-fatal diagnostic: formatted like an error but collected separately so
	// the build still succeeds. The compiler prints these as warnings.
	warn(msg, node, hint = null) {
		const e = new TypeCheckError(
			msg,
			node,
			this._currentFile,
			this._currentSource,
			hint,
		);
		// `log.warn` adds the "warning:" label, so strip the error one here:
		// "Type error in main.go at line 3:5: msg" → "main.go at line 3:5: msg".
		this.warnings.push(e.message.replace(/^Type error(?: in)?[: ]\s*/, ""));
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
			for (let i = 0; i < spec.names.length; i++) {
				const name = spec.names[i];
				const expr = spec.value?.[i] ?? spec.value?.[0] ?? null;
				this.globals.defineConst(name, type, expr);
			}
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

		this._checkDirectivesAndImportsPass(programs);
		this._registerConstExprs(programs);
		this._collectTypesPass(programs);
		this._collectFuncsPass(programs);
		this._checkGlobalTypeNamesPass(programs);
		this._promoteEmbeddedMethods();
		this._collectVarsConstsPass(programs);
		this._checkTopDeclsPass(programs);
		this._reportInitCycles(programs);

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

	_checkEmbedDirectives(directives) {
		for (const { line, col } of directives ?? []) {
			this.err("//go:embed is not supported yet", { line, col });
		}
	}

	_checkDirectivesAndImportsPass(programs) {
		this._importedPaths = new Set();
		this._fileImports = new Map();
		for (const p of programs) {
			this._setCurrentFile(p);
			const names = new Map();
			this._fileImports.set(this._currentFile, names);
			this._checkEmbedDirectives(p._embedDirectives);
			for (const imp of p.imports ?? []) {
				for (const spec of imp.imports ?? []) {
					this._importedPaths.add(spec.path);
					names.set(
						spec.alias ??
							spec.path
								.split("/")
								.filter((s) => !/^v\d+$/.test(s))
								.at(-1),
						spec.path,
					);
					if (EXCLUDED_STDLIB_PACKAGES.has(spec.path)) {
						this.err(
							`package '${spec.path}' is not available: ${EXCLUDED_STDLIB_PACKAGES.get(spec.path)}`,
							spec,
						);
					}
				}
			}
		}
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
					// A generic type is known to be generic before any field resolves,
					// so types declared earlier can instantiate it.
					if (d.typeParams) {
						placeholder._generic = {
							typeParams: d.typeParams.map((tp) => ({
								kind: "typeParam",
								name: tp.name,
								constraint: tp.constraint,
							})),
							declNode: d,
						};
					}
					this.types.set(d.name, placeholder);
					this.globals.define(d.name, placeholder);
				}
			}
		}
		const all = [];
		for (const p of programs) {
			for (const d of p.decls) if (d.kind === "TypeDecl") all.push({ p, d });
		}
		this._expandGenericStructDefs(all.map((x) => x.d));
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

	// `type S[T any] Base` with `Base` a struct declared in the package: S is a
	// new struct type with Base's fields (and none of its methods), so its
	// declaration becomes a copy of Base's struct type.
	_expandGenericStructDefs(decls) {
		const byName = new Map(decls.map((d) => [d.name, d]));
		for (const d of decls) {
			if (!d.typeParams || d.isAlias) continue;
			let target = d.type;
			for (let i = 0; i < 16 && target?.kind === "TypeName"; i++) {
				const base = byName.get(target.name);
				if (!base || base.typeParams || base.isAlias) break;
				target = base.type;
			}
			// A struct written in place is already this declaration's own copy;
			// cloning it would also choke on an AST a previous target pass
			// annotated with cycles.
			if (target?.kind === "StructType" && target !== d.type)
				d.type = JSON.parse(JSON.stringify(target));
		}
	}

	// A struct type, or a named type with methods, becomes a JS class of the
	// same name in `js` and `both` packages.  Functions and variables that
	// shadow a browser global get a `$` suffix, but type names reach the
	// output through the checker's types (class declarations, `new T`,
	// `instanceof T`, static methods), so a class named after a JavaScript
	// built-in the generated code calls (`Array.isArray`, `new Error`) is
	// rejected instead.  Interfaces and method-less named types emit no class.
	_checkGlobalTypeNamesPass(programs) {
		if (this.target === "wasm" || this.isStdlib) return;
		for (const p of programs) {
			for (const d of p.decls) {
				if (
					d.kind !== "TypeDecl" ||
					d.isAlias ||
					!JS_BUILTIN_CLASSES.has(d.name)
				)
					continue;
				const t = this.types.get(d.name);
				const isClass =
					t?.underlying?.kind === "struct" || (t?.methods?.size ?? 0) > 0;
				if (!isClass) continue;
				this._setCurrentFile(p);
				this.err(
					`type ${d.name} shadows the JavaScript global ${d.name}; rename the type`,
					d,
				);
			}
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

	// Constant initializers are known before types are resolved, so an array
	// length may name a constant declared later (`[N]int`, `[N + 1]T`).
	_registerConstExprs(programs) {
		for (const p of programs) {
			for (const d of p.decls) {
				if (d.kind !== "ConstDecl") continue;
				for (const spec of d.decls) {
					spec.names.forEach((name, i) => {
						const expr = spec.value?.[i] ?? spec.value?.[0] ?? null;
						if (expr) this.globals._constExprs.set(name, expr);
					});
				}
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

	// Go rejects package variables whose initialisers depend on each other.
	_reportInitCycles(programs) {
		if (this.errors.length > 0) return;
		const { cycles } = orderPackageInits(programs);
		for (const c of cycles) {
			const owner = programs.find((p) =>
				p.decls?.some((d) => d.kind === "VarDecl" && d.decls?.includes(c.spec)),
			);
			if (owner) this._setCurrentFile(owner);
			this.err(c.message, c.spec);
		}
	}

	_checkTopDeclsPass(programs) {
		// A constant may name one declared later, so each is typed after those.
		for (const e of orderPackageInits(programs).consts) {
			this._setCurrentFile(e.program);
			this.checkTopDecl({ ...e.decl, decls: [e.spec] }, this.globals);
		}
		// A variable's type may come from one declared later (`var a = b + 1;
		// var b = f()`), so initialisers are typed after what they name.
		for (const e of orderVarSpecsForTyping(programs)) {
			this._setCurrentFile(e.program);
			this.checkTopDecl({ ...e.decl, decls: [e.spec] }, this.globals);
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
			this._promoteEmbeddedInto(type.underlying);
			for (const inst of type._generic?._instances?.values() ?? [])
				this._promoteEmbeddedInto(inst.underlying);
		}
	}

	_promoteEmbeddedInto(struct) {
		if (struct?.kind !== "struct" || !struct._embeds) return;
		for (const embed of struct._embeds) {
			const inner = embed.kind === "pointer" ? embed.base : embed;
			const base = inner.kind === "named" ? inner.underlying : inner;
			if (base?.kind !== "struct" || !base.methods) continue;
			for (const [mName, mType] of base.methods.entries()) {
				if (!struct.methods.has(mName)) struct.methods.set(mName, mType);
			}
		}
	}

	// ── Type collection ──────────────────────────────────────────

	collectType(decl) {
		if (decl.typeParams && decl.isAlias) {
			this._collectGenericAlias(decl);
			return;
		}
		if (decl.typeParams) {
			// Generic type — resolve underlying with type params as ANY for struct fields
			const typeScope = new Scope(this.globals);
			const preset = this.types.get(decl.name)?._generic;
			const typeParamTypes = decl.typeParams.map((tp, i) => {
				const t =
					preset?.declNode === decl
						? preset.typeParams[i]
						: {
								kind: "typeParam",
								name: tp.name,
								constraint: tp.constraint,
							};
				typeScope.define(tp.name, t);
				return t;
			});
			const existing = this.types.get(decl.name);
			const named =
				existing?.kind === "named"
					? existing
					: { kind: "named", name: decl.name };
			// Registered before the fields resolve so `Next *List[T]` finds the
			// generic declaration it is part of.
			if (preset?.declNode === decl) named._generic = preset;
			else named._generic = { typeParams: typeParamTypes, declNode: decl };
			this.types.set(decl.name, named);
			const underlying = this.resolveTypeNode(decl.type, typeScope);
			named.underlying = underlying;
			named._target = this.target;
			if (underlying.kind === "struct") {
				underlying.name = decl.name;
				underlying.methods = new Map();
			}
			this.types.set(decl.name, named);
			this.globals.define(decl.name, named);
			return;
		}
		let underlying = this.resolveTypeNode(decl.type, this.globals);
		// `type W V` with V a named array: W's underlying type is V's array.
		if (!decl.isAlias && underlying.kind === "named") {
			const inner = this._deepUnderlying(underlying);
			if (inner?.kind === "array") underlying = inner;
			// `type S Base` with Base a struct: S gets its own copy of the fields.
			else if (inner?.kind === "struct")
				underlying = { ...inner, name: decl.name, methods: new Map() };
		}
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
		named._target = this.target;
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

	// type A[P any] = T[P] — Go 1.24 generic alias. The declaration is a
	// template only: each instantiation A[X] substitutes X into the aliased
	// type and resolves to exactly that type (no new named type).
	_collectGenericAlias(decl) {
		const typeScope = new Scope(this.globals);
		const typeParamTypes = decl.typeParams.map((tp) => {
			const t = { kind: "typeParam", name: tp.name, constraint: tp.constraint };
			typeScope.define(tp.name, t);
			return t;
		});
		// Resolve once with the parameters in scope to report errors in the
		// aliased type at the declaration.
		const underlying = this.resolveTypeNode(decl.type, typeScope);
		const alias = {
			kind: "named",
			name: decl.name,
			underlying,
			_generic: { typeParams: typeParamTypes, declNode: decl, isAlias: true },
		};
		this.types.set(decl.name, alias);
		this.globals.define(decl.name, alias);
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
				declNode: decl,
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
			base.methods ??= new Map();
			base.methods.set(decl.name, funcType);
		}
		if (recvType?.kind === "named") {
			recvType.methods ??= new Map();
			recvType.methods.set(decl.name, funcType);
		}
	}

	_attachMethod(decl, funcType) {
		funcType._ptrRecv = Boolean(decl.recvPointer);
		funcType._decl = decl;
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
				this._checkTemplDecl(decl, scope);
				break;
		}
	}

	// A templ body is checked like a function body whose parameters are the
	// templ's: every Go expression TemplParser attached to a node (`expr`,
	// attribute `expr`, `forStmt`) is type-checked in the enclosing scope.
	_checkTemplDecl(decl, outer) {
		const inner = new Scope(outer);
		for (const p of decl.params)
			inner.define(p.name, this._paramType(p, inner));
		this._checkTemplNodes(decl.body, inner);
	}

	_checkTemplNodes(nodes, scope) {
		for (const n of nodes ?? []) {
			const m = TEMPL_NODE_CHECKS[n.kind];
			if (m) this[m](n, scope);
		}
	}

	// A malformed expression has no AST: the code generator reports its parse
	// error. Its names count as used so that error is not preceded by a
	// misleading `declared and not used`.
	_checkTemplExpr(node, tokens, scope) {
		if (node.exprError) {
			this._markTokensUsed(tokens, scope);
			return null;
		}
		return node.expr ? this.checkExpr(node.expr, scope) : null;
	}

	_checkTemplElement(n, scope) {
		for (const a of n.attrs ?? []) {
			if (a.kind === "expr" || a.kind === "cond-bool")
				this._checkTemplExpr(a, a.tokens, scope);
		}
		this._checkTemplNodes(n.children, scope);
	}

	_checkTemplLeaf(n, scope) {
		this._checkTemplExpr(n, n.tokens, scope);
	}

	_checkTemplIf(n, scope) {
		const ct = this._checkTemplExpr(n, n.condTokens, scope);
		if (ct && !isBool(ct) && !isAny(ct))
			this.err("If condition must be bool", n.expr);
		this._checkTemplNodes(n.then, scope);
		this._checkTemplNodes(n.else_, scope);
	}

	_checkTemplSwitch(n, scope) {
		this._checkTemplExpr(n, n.exprTokens, scope);
		for (const c of n.cases ?? []) {
			this._checkTemplExpr(c, c.caseTokens, scope);
			this._checkTemplNodes(c.body, scope);
		}
	}

	// A header that did not parse is reported by the code generator; its body
	// is not checked, since the loop variables it would declare are unknown.
	_checkTemplFor(n, scope) {
		if (!n.forStmt) {
			this._markTokensUsed(n.stmtTokens, scope);
			this._markTemplNodesUsed(n.body, scope);
			return;
		}
		this._checkForStmt(n.forStmt, scope, VOID, (bodyScope) =>
			this._checkTemplNodes(n.body, bodyScope),
		);
	}

	_markTokensUsed(tokens, scope) {
		if (!tokens) return;
		for (const t of tokens) {
			if (t.type === "IDENT" || t.type?.name === "IDENT") {
				scope.lookup(t.value);
			}
		}
	}

	_markTemplNodesUsed(nodes, scope) {
		if (!nodes) return;
		for (const n of nodes) {
			if (n.kind === "TemplElement") {
				for (const a of n.attrs || []) {
					if (a.tokens) this._markTokensUsed(a.tokens, scope);
				}
				this._markTemplNodesUsed(n.children, scope);
			} else if (n.kind === "TemplExpr" || n.kind === "TemplComponent") {
				this._markTokensUsed(n.tokens, scope);
			} else if (n.kind === "TemplIf") {
				this._markTokensUsed(n.condTokens, scope);
				this._markTemplNodesUsed(n.then, scope);
				this._markTemplNodesUsed(n.else_, scope);
			} else if (n.kind === "TemplFor") {
				this._markTokensUsed(n.stmtTokens, scope);
				this._markTemplNodesUsed(n.body, scope);
			} else if (n.kind === "TemplSwitch") {
				this._markTokensUsed(n.exprTokens, scope);
				for (const c of n.cases || []) {
					this._markTokensUsed(c.caseTokens, scope);
					this._markTemplNodesUsed(c.body, scope);
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

	_checkIntrinsic(decl) {
		const want = INTRINSICS.get(decl.intrinsic);
		if (!want) return this.err(`unknown intrinsic '${decl.intrinsic}'`, decl);
		if (!decl._bodyless)
			return this.err(
				`intrinsic '${decl.intrinsic}' must not have a body`,
				decl,
			);
		const got = typeStr(this.globals.symbols.get(decl.name));
		if (got !== want)
			this.err(
				`intrinsic '${decl.intrinsic}' must have type ${want}, not ${got}`,
				decl,
			);
	}

	checkFuncDecl(decl, outer) {
		if (decl.intrinsic) this._checkIntrinsic(decl);
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
			inner.define(p.name, this._paramType(p, inner));
		}
		const returnType = this._setupFuncReturnType(decl, inner);
		const savedSharedAlloc = this._sharedAllocOk;
		this._sharedAllocOk = decl.name === "init";
		this._runFuncBody(decl, inner, returnType);
		this._sharedAllocOk = savedSharedAlloc;
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
		const recvType = this._methodReceiverType(decl, recvNamedType, outer);
		inner.define(
			decl.recvName,
			decl.recvPointer ? { kind: "pointer", base: recvType } : recvType,
		);
		for (const p of decl.params) {
			inner.define(p.name, this._paramType(p, inner));
		}
		const returnType = this._setupFuncReturnType(decl, inner);
		this._runFuncBody(decl, inner, returnType);
		this._checkMissingReturn(decl, returnType, "method");
	}

	// A variadic parameter `xs ...T` is a `[]T` inside the body (the signature
	// keeps the element type plus the `variadic` flag).
	_paramType(p, scope) {
		const t = this.resolveTypeNode(p.type, scope);
		return p.variadic ? { kind: "slice", elem: t } : t;
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

	// Inside a method of `G[T]` the receiver is the instance `G[T]` over the
	// receiver's own type parameters, so it is assignable to results and locals
	// written as `G[T]`.
	_methodReceiverType(decl, recvNamedType, outer) {
		const generic = recvNamedType?._generic;
		if (!generic || generic.isAlias || !generic.typeParams?.length)
			return this.resolveTypeNodeName(decl.recvType, outer);
		return this.instantiateGenericWithArgs(generic, generic.typeParams);
	}

	_injectGenericReceiverTypeParams(inner, recvNamedType) {
		if (!recvNamedType?._generic) return;
		for (const tp of recvNamedType._generic.typeParams) {
			inner.define(tp.name, tp);
		}
	}

	_setupFuncReturnType(decl, inner) {
		let returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, inner)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(decl.returnType, inner);
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

	// Named result types resolve in the function scope, so a result of a type
	// parameter's type (`(r T)`) sees T.
	_injectNamedReturns(returnTypeNode, scope) {
		if (!returnTypeNode?._namedReturns) return false;
		for (const { name, type } of returnTypeNode._namedReturns) {
			if (name) scope.define(name, this.resolveTypeNode(type, scope));
		}
		return true;
	}

	checkVarDecl(decl, scope) {
		const savedSharedAlloc = this._sharedAllocOk;
		this._sharedAllocOk = scope === this.globals;
		for (const spec of decl.decls) {
			let type = spec.type ? this.resolveTypeNode(spec.type, scope) : null;
			if (spec.value) {
				const valTypes = spec.value.map((v) => this.checkExpr(v, scope));
				const isTuple = valTypes.length === 1 && valTypes[0]?.kind === "tuple";
				const valTypesFlat = isTuple ? valTypes[0].types : valTypes;
				if (spec.names.length !== valTypesFlat.length) {
					const vars =
						spec.names.length === 1
							? "1 variable"
							: `${spec.names.length} variables`;
					const vals = isTuple
						? `returns ${valTypesFlat.length} values`
						: valTypesFlat.length === 1
							? "1 value"
							: `${valTypesFlat.length} values`;
					this.err(`assignment mismatch: ${vars} but ${vals}`, spec);
				}
				for (let i = 0; i < spec.names.length; i++) {
					const vt = valTypesFlat[i] ?? ANY;
					const varType = type ?? defaultType(vt) ?? ANY;
					if (!type && spec.names.length === spec.value.length)
						this._checkConstDefault(vt, spec.value[i], "variable declaration");
					if (type)
						this.assertAssignable(
							type,
							vt,
							spec.value[i] ?? spec.value[0],
							"variable declaration",
						);
					scope.defineLocal(spec.names[i], varType);
				}
			} else {
				if (!type) type = ANY;
				for (const name of spec.names) scope.defineLocal(name, type);
			}
		}
		this._sharedAllocOk = savedSharedAlloc;
	}

	checkConstDecl(decl, scope) {
		for (const spec of decl.decls) {
			const valTypes = spec.value.map((v) => this.checkExpr(v, scope));
			// Explicit type annotation → typed constant; otherwise preserve untyped
			const type = spec.type
				? this.resolveTypeNode(spec.type, scope)
				: (valTypes[0] ?? ANY);
			for (let i = 0; i < spec.names.length; i++) {
				const name = spec.names[i];
				const expr = spec.value?.[i] ?? spec.value?.[0] ?? null;
				if (spec.type && expr)
					this._checkConstOverflow(
						type,
						valTypes[i] ?? valTypes[0],
						expr,
						"constant declaration",
					);
				scope.defineConst(name, type, expr);
			}
		}
	}

	// ── Statement checking ───────────────────────────────────────
}

Object.assign(TypeChecker.prototype, statementCheckMethods);
Object.assign(TypeChecker.prototype, expressionCheckMethods);
Object.assign(TypeChecker.prototype, terminationMethods);
Object.assign(TypeChecker.prototype, resolveMethods);
Object.assign(TypeChecker.prototype, assignabilityMethods);
Object.assign(TypeChecker.prototype, constantCheckMethods);
