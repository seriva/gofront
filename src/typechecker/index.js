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
import { goFuncType, scanStores } from "./host-func.js";
import { orderPackageInits, orderVarSpecsForTyping } from "./init-order.js";
import { resolveMethods } from "./resolve.js";
import { newLabelScope, statementCheckMethods } from "./statements.js";
import { EXCLUDED_STDLIB_PACKAGES } from "./stdlib/excluded.js";
import { setupGlobals, universeTypeNames } from "./stdlib/index.js";
import { terminationMethods } from "./termination.js";
import {
	ANY,
	anyKind,
	BOOL,
	copyFieldOwner,
	copyType,
	declPackages,
	defaultType,
	displayTypeName,
	ERROR,
	INTRINSICS,
	isAny,
	isBool,
	isNil,
	isVoid,
	JS_BUILTIN_CLASSES,
	NATIVES,
	PackageScope,
	promotedMethods,
	Scope,
	signalOf,
	TAINTED_ANY,
	TypeCheckError,
	typeStr,
	VALID_TARGETS,
	VOID,
} from "./types.js";

// Checker method per templ body node kind (see _checkTemplNodes).
const EMBED_IMPORT_ERROR =
	'go:embed only allowed in Go files that import "embed"';
// The checked name of embed.FS (`stdlib/embed/embed.go`); no Go identifier
// can spell it, so no user type collides.
const EMBED_FS_TYPE = "FS$$embed";

const TEMPL_NODE_CHECKS = {
	TemplElement: "_checkTemplElement",
	TemplExpr: "_checkTemplLeaf",
	TemplChildren: "_checkTemplChildren",
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
export { EXCLUDED_STDLIB_PACKAGES, TypeCheckError, typeStr, universeTypeNames };

// The promoted-method entry for candidate `cand`, reusing `prev` when
// nothing changed so the method keeps its identity across passes. A pointer
// method reached through an embedded pointer is in the value method set.
function promotedEntry(cand, prev) {
	if (cand.ambiguous) return { depth: cand.depth, ambiguous: true };
	if (
		!prev?.ambiguous &&
		prev?.source === cand.source &&
		prev.viaPtr === cand.viaPtr &&
		prev.depth === cand.depth
	)
		return prev;
	const mType =
		cand.viaPtr && cand.source?._ptrRecv
			? { ...cand.source, _ptrRecv: false }
			: cand.source;
	return { ...cand, mType };
}

// Offers every method of the embedded interface `iface` at depth 1.
function offerInterfaceMethods(iface, offer) {
	for (const [mName, mType] of iface.methods ?? [])
		offer(mName, 1, mType, false);
}

// Replaces the promoted methods `old` with `next` in `methods`, leaving
// the struct's own methods alone; returns whether anything changed.
function applyPromotions(methods, old, next, isOwn) {
	let changed = old.size !== next.size;
	for (const [mName, prev] of old) {
		const entry = next.get(mName);
		if (entry?.mType) continue;
		if (prev.mType && !isOwn(mName)) methods.delete(mName);
		if (entry?.ambiguous !== prev.ambiguous || entry?.depth !== prev.depth)
			changed = true;
	}
	for (const [mName, entry] of next) {
		if (entry.ambiguous) continue;
		if (old.get(mName)?.mType !== entry.mType) changed = true;
		methods.set(mName, entry.mType);
	}
	return changed;
}

let nextPkgId = 0;

// The declaration packages that declare the classes among the Web API globals.
const WEB_CLASS_PACKAGES = ["dom", "fetch", "websocket"];

export class TypeChecker {
	constructor() {
		// The identity of the package this checker checks: stamped on the
		// methods and struct fields it declares, so another package reading one
		// can tell it is unexported there (see `_foreignMember`). Each checker
		// has its own, also for two packages that share a name.
		this._pkgId = ++nextPkgId;
		// The package whose declaration is being resolved: this one, except
		// while resolving a declaration of an imported generic type.
		this._ownerPkg = this._pkgId;
		this.types = new Map(); // named types
		// Instantiation state per generic type (see `_instState`).
		this._genericState = new Map();
		// Go's universe scope: builtins, browser globals and built-in package
		// namespaces.  Package declarations live in `globals` above it, so they
		// shadow predeclared names (`func Array()`, `var document int`).
		this.universe = new Scope();
		this.globals = new Scope(this.universe);
		this.errors = [];
		this._reportedAt = new WeakMap();
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
		this._labels = newLabelScope(); // labels of the current function body
		this._imports = []; // tracked imports for unused-import detection
		// Imports are bound per file, as in Go: each file's scope holds its own
		// package qualifiers, `.d.ts` bindings and dot-imported names, and sits
		// between `globals` (the package's own declarations) and the universe
		// while that file is checked (see `_setCurrentFile`). The scope under
		// the key `null` is shared by every file: bindings made with no file.
		this.fileScopes = new Map();
		this._importScopes = new Set();
		// Type-table keys an import registered (`pkg.T`, or a bare `T`): the
		// table spans the build, so a name resolves only where the file's scope
		// binds it (see `_visibleType`).
		this._importKeys = new Set();
		this._importBound = new WeakSet(); // types an import registered (never reused by a local declaration)
		this._ungated = 0; // > 0 while resolving a declaration from another package
		this._declFiles = new WeakMap(); // generic declaration -> its file
		this._constFiles = new Map(); // package const name -> file declaring it
		// Lazy body checking (Go-source stdlib): with `lazyBodies` set, checkAll
		// types declarations only and `checkBody` types a function or method
		// body when it is first reached.
		this.lazyBodies = false;
		this.stats = { bodiesChecked: 0 };
		this._lazyBodies = new Map(); // FuncDecl/MethodDecl -> its program
		this._constExprs = new Map(); // name -> AST initializer expr
		this._importedConsts = new Map(); // dot-imported const name -> value
		this._externalNames = new Set(); // package-scope names from .d.ts / npm definitions
		this._untypedImports = new Set(); // names bound by npm imports without types
		this._localTypes = new Set(); // names of types declared in a function or block
		this._localTypesVisible = false; // checking the generated Go, which names any local type
		this._importedTypes = new WeakSet(); // named types reached through an imported package
		this._pendingConstraintUses = []; // constraint-interface checks waiting on a type declaration
		this._setupGlobals();
		// Register error as a named type (interface)
		this.types.set("error", ERROR);
		// Predeclared universe types (error, simd.*, shared.*, web globals)
		// are not declared by this package and must not be exported.
		this._universeTypes = new Map(this.types);
	}

	_setupGlobals() {
		setupGlobals(this.universe, this.types, (name) =>
			this._webGlobalType(name),
		);
	}

	// `external` marks values as real JS names (.d.ts / npm definitions) that
	// must not be renamed; dot-imported GoFront packages pass false so their
	// browser-global-named members get the same `$` renaming as local ones.
	// `consts` (dot-imported GoFront packages) maps constant names to their
	// folded values.
	// `kinds` (dot-imported GoFront packages) maps each name to what the
	// package declares it as (see Scope); without it a value that is its
	// type-table entry counts as a type and any other value as a variable.
	addDefinitions(
		types,
		values,
		{
			external = true,
			consts = null,
			kinds = null,
			file = null,
			reached = null,
		} = {},
	) {
		const scope = this._fileScope(file);
		for (const [name, type] of types) this._bindImportedType(file, name, type);
		for (const [name, type] of reached ?? [])
			this._bindImportedType(file, name, type, false);
		for (const [name, type] of values) {
			const kind = kinds?.get(name);
			if (kinds ? kind === "type" : types.get(name) === type)
				scope.defineType(name, type);
			else if (type?.kind === "namespace" && type.name === name)
				scope.definePackage(name, type);
			else if (kind === "func") scope.defineFunc(name, type);
			else if (kind === "const") scope.defineConst(name, type);
			else scope.define(name, type);
			if (external) this._externalNames.add(name);
		}
		for (const [name, v] of consts ?? []) {
			if (!v || !values.has(name)) continue;
			scope.defineConst(name, values.get(name));
			this._importedConsts.set(name, v);
		}
	}

	// The scope holding the imports of `file` (null: those of every file).
	_fileScope(file = null) {
		const key = file ?? null;
		let scope = this.fileScopes.get(key);
		if (!scope) {
			scope = new Scope(key === null ? this.universe : this._fileScope(null));
			scope.importedTypes = new Map(); // type-table key -> type, as imported
			this.fileScopes.set(key, scope);
			this._importScopes.add(scope);
		}
		return scope;
	}

	// Whether `scope` holds a file's imports (an import is never part of the
	// package's own declarations in `globals`).
	_isImportScope(scope) {
		return this._importScopes.has(scope);
	}

	// Runs `fn` with `file`'s imports in scope.
	_atFile(file, fn) {
		const parent = this.globals.parent;
		this.globals.parent = this._fileScope(file);
		try {
			return fn();
		} finally {
			this.globals.parent = parent;
		}
	}

	// Registers the type `type` an import of `file` names `key`: the type table
	// (the build's registry, which backends and `resolveType` read) knows it,
	// and only `file` resolves the name.
	// `visible` false registers it for the table only: no file resolves the name.
	_bindImportedType(file, key, type, visible = true) {
		// A predeclared type (`error`) an importer's table also lists is no import.
		if (this.types.get(key) === type && !this._importKeys.has(key)) return;
		this.types.set(key, type);
		this._importKeys.add(key);
		this._importBound.add(type);
		if (visible) this._fileScope(file).importedTypes.set(key, type);
	}

	// The generated Go names a local package by the qualifier an importing file
	// gave it, in expression position too (`sub.T(v)`). Binds in `file` each
	// package qualifier any other file imports, unless `file` binds the name.
	bindReachedPackages(file) {
		const scope = this._fileScope(file);
		for (const [key, other] of this.fileScopes) {
			if (key === file) continue;
			for (const name of other.names("pkg"))
				if (!scope.has(name)) scope.definePackage(name, other.get(name));
		}
	}

	// The type an import in `scope` (a file's scope) or in the scope shared by
	// every file names `key`.
	_importedType(scope, key) {
		return (
			scope?.importedTypes?.get(key) ??
			this._fileScope(null).importedTypes.get(key)
		);
	}

	// Bind the name of an npm import that has no type declarations in `file`.
	// It is a JS-dynamic `any` global; a wasm or both package reports it on
	// use. With `at` ({ node, source }, the import's position) the import is
	// tracked, so an unused one is reported like any other.
	defineUntypedImport(name, file = null, at = null) {
		this._fileScope(file).define(name, ANY);
		this._externalNames.add(name);
		this._untypedImports.add(name);
		if (at) this.trackImport(name, at.node, file, at.source);
	}

	// Add an imported GoFront package as a qualified namespace.
	// e.g. addPackageNamespace('utils', symbolsMap, typesMap)
	// lets callers type-check `utils.Foo` via SelectorExpr.
	// `target` is the imported package's compile target ("js"/"wasm"/"both").
	// `consts` maps the package's constant names to their folded value (see
	// typechecker/const-fold.js), or null when the folder cannot evaluate one.
	// `kinds` maps each member to what the package declares it as (see Scope).
	addPackageNamespace(
		pkgName,
		symbols,
		types,
		target = null,
		consts = null,
		kinds = null,
		file = null,
		reached = null,
	) {
		const members = {};
		for (const [name, type] of symbols) members[name] = type;
		// _gofront: true marks this as a GoFront package — exported identifier rules apply
		this._fileScope(file).definePackage(pkgName, {
			kind: "namespace",
			name: pkgName,
			members,
			_gofront: true,
			_target: target,
			_consts: consts,
			_kinds: kinds,
		});
		const register = (name, type, visible) => {
			const prior = this.types.get(name);
			if (prior && prior !== type && prior.kind === "named") {
				this._ambiguousImported ??= new WeakSet();
				this._ambiguousImported.add(prior);
				this._ambiguousImported.add(type);
			}
			// A renamed type (`Pt` declared as `Pt$$b`) never takes the bare name:
			// another package owns it, and this package's own declaration would
			// otherwise reuse the imported placeholder. It is reached as `pkg.Pt`.
			// The bare name is the build's registry only; no file resolves it
			// (a dot import binds it in its file, see `addDefinitions`).
			if (type.name === name && prior !== type) {
				this.types.set(name, type);
				this._importKeys.add(name);
			}
			this._bindImportedType(file, `${pkgName}.${name}`, type, visible);
			this._importedTypes.add(type);
		};
		for (const [name, type] of types) register(name, type, true);
		// Types the package reached through its own imports (see `getReachedTypes`).
		for (const [name, type] of reached ?? []) register(name, type, false);
	}

	// The compiler supplies how a declaration package is found: `loader(name)`
	// returns the parsed package `name` (see `parseDeclarationPackage`) or null.
	setDeclarationLoader(loader) {
		this._declLoader = loader;
	}

	// The declaration package `name` and the packages it references, loaded
	// through the declaration loader and registered on first use (see
	// `addDeclarationPackage`); null when there is no such package.
	useDeclarationPackage(name) {
		this._declByName ??= new Map();
		if (this._declByName.has(name)) return this._declByName.get(name);
		const pkg = this._declLoader?.(name) ?? null;
		this._declByName.set(name, pkg);
		if (pkg) {
			this.addDeclarationPackage(pkg);
			for (const required of pkg.requires) this.useDeclarationPackage(required);
		}
		return pkg;
	}

	// The type of the Web API global `name`: its `Window` member (`document`,
	// `fetch`, `setTimeout`), `console`, or the class it names (`WebSocket`,
	// `Response`), read from the generated declarations, which load now. Null
	// when no declaration loader is set (a checker built without a compiler).
	_webGlobalType(name) {
		const dom = this._declLoader && this.useDeclarationPackage("dom");
		if (!dom) return null;
		const typeOf = (type) =>
			dom.keys.has(type)
				? this.resolveType(this._dtsTypeRef(dom.keys.get(type)))
				: null;
		const member = typeOf("Window")?.members[name];
		if (member) return this.resolveType(member);
		if (name === "console") return typeOf("Console");
		for (const pkg of WEB_CLASS_PACKAGES) {
			const declared = this.useDeclarationPackage(pkg);
			if (declared?.keys.has(name))
				return this.resolveType(this._dtsTypeRef(declared.keys.get(name)));
		}
		return null;
	}

	// Registers a declaration package (`gofront/dom`, see `parseDeclarationPackage`
	// in dts-parser.js: `{ name, types, values, keys }` whose type references
	// are qualified) in the type table under `pkg.keys`, once per checker. The key cannot be a Go package's qualifier, so a program's own
	// package named `dom` never replaces it. No file resolves those names until
	// `bindDeclarationPackage` binds the package; the package's own references
	// (and another package's qualified ones) reach them through the table, so a
	// bare `T` is never taken.
	addDeclarationPackage(pkg) {
		this._declPackages ??= new Set();
		if (this._declPackages.has(pkg)) return;
		this._declPackages.add(pkg);
		for (const [name, type] of pkg.types)
			this._bindImportedType(null, pkg.keys.get(name), type, false);
	}

	// Binds the qualifier `as` of declaration package `pkg` in `file` (null:
	// every file): `as.T` names its types and `as.v` its values. Like any
	// import it is gated per file.
	bindDeclarationPackage(pkg, as = pkg.name, file = null) {
		this.addDeclarationPackage(pkg);
		this._fileScope(file).definePackage(as, {
			kind: "namespace",
			name: as,
			members: Object.fromEntries(pkg.values),
			_dtsPackage: true,
		});
		for (const [name, type] of pkg.types)
			this._bindImportedType(file, `${as}.${name}`, type);
	}

	// Register an import for unused-import detection.
	// `name` is the package name or alias used in code.
	// `node` carries _line for error reporting.
	// `filename` / `source` identify the file containing the import.
	trackImport(name, node, filename, source) {
		this._imports.push({ name, node, filename, source });
	}

	// Report any tracked imports whose package name was never referenced in
	// the file that imports it.
	reportUnusedImports() {
		for (const { name, node, filename, source } of this._imports) {
			if (!this._importUsed(name, filename)) {
				const saved = [this._currentFile, this._currentSource];
				this._currentFile = filename;
				this._currentSource = source;
				this.err(`'${name}' imported and not used`, node);
				[this._currentFile, this._currentSource] = saved;
			}
		}
	}

	_importUsed(name, filename) {
		return this._fileScope(filename)._used.has(name);
	}

	// Return a snapshot of all user-defined globals (excludes built-ins).
	// Used by the compiler to expose a package's exports to importers.
	getExportedSymbols() {
		const out = new Map();
		for (const [name, { type }] of this.globals.objects) {
			if (type?.kind === "builtin") continue; // skip built-ins
			if (type === ANY && !name[0].match(/[A-Z]/)) continue; // skip browser globals
			out.set(name, type);
		}
		return out;
	}

	getExportedConsts() {
		const out = new Map();
		for (const name of this.globals.names("const")) {
			if (!this.globals.lookupConstExpr(name)) continue;
			out.set(name, this.constValueOf(name));
		}
		return out;
	}

	// The folded value of the package constant `name`, evaluated where it is
	// declared: its initializer may name an import of that file only.
	constValueOf(name) {
		return this._atFile(this._constFiles.get(name) ?? null, () =>
			this._constValue({ kind: "Ident", name }, this.globals),
		);
	}

	// What the package declares each of its names as (see Scope), for
	// importers: a member reached through the package keeps its kind.
	getExportedKinds() {
		const out = new Map();
		for (const [name, { kind }] of this.globals.objects) out.set(name, kind);
		return out;
	}

	// The types the package declares. A type an import registered (`leaf.T`,
	// or `T` through a dot import) belongs to the imported package, so an
	// importer of this package does not see it by name; a local declaration of
	// the same name replaces the entry in the table and stays.
	getExportedTypes() {
		const out = new Map();
		for (const [key, type] of this.types) {
			if (this._universeTypes.get(key) === type) continue;
			if (!this._isImportRegistered(key, type)) out.set(key, type);
		}
		return out;
	}

	// The types an import registered in the table (see `getExportedTypes`). An
	// importer keeps them in its own table, no file resolving them by name:
	// the generated Go spells a type it reaches through this package from them.
	getReachedTypes() {
		const out = new Map();
		for (const [key, type] of this.types)
			if (this._isImportRegistered(key, type)) out.set(key, type);
		return out;
	}

	_isImportRegistered(key, type) {
		return this._importKeys.has(key) && this._importBound.has(type);
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
		// One diagnostic per root cause: a node revisited by a later pass (a
		// signature resolved at declaration and again in the body) reports once.
		if (node && typeof node === "object") {
			const seen = this._reportedAt.get(node) ?? new Set();
			this._reportedAt.set(node, seen);
			if (seen.has(msg)) return TAINTED_ANY;
			seen.add(msg);
		}
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
			this.err(
				`'${name}' declared and not used`,
				scope.localNode(name) ?? node,
			);
		}
	}

	_setCurrentFile(p) {
		this._currentFile = p._filename ?? null;
		this._currentSource = p._source ?? null;
		// Names resolve against the imports of the file being checked. The
		// generated Go names types of any package the program reaches, however
		// the user's files import it.
		this.globals.parent = this._fileScope(this._currentFile);
		this._ungated = p._generated ? 1 : 0;
		this._currentPkgName = p?.pkg?.name ?? this.pkgName ?? null;
		// The generated Go sits at package level and names any local type; they
		// are unique by then (`renameLocalTypes`).
		this._localTypesVisible = !!p._generated;
		this._fileImportsEmbed = p.imports?.some((imp) =>
			imp.imports?.some((spec) => spec.path === "embed"),
		);
		// Their builtin calls reach the universe, not a user's shadow of it.
		this._builtinsFromUniverse = !!(p._generated || p._stdlib);
		if (this.globals instanceof PackageScope)
			this.globals.currentPackage = p.pkg?.name ?? null;
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
		this._programs = programs;
		this._programAssigned = null;
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
		this._registerVarSpecs(programs);
		this._markConstraintPositions(programs);
		this._collectingTypes = true;
		this._collectTypesPass(programs);
		this._collectingTypes = false;
		this._flushConstraintUses();
		this._collectFuncsPass(programs);
		this._checkGlobalTypeNamesPass(programs);
		this._promoteEmbeddedMethods();
		this._collectVarsConstsPass(programs);
		this._checkTopDeclsPass(programs);
		this._reportInitCycles(programs);
		this._flushConstraintUses();

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

	// Directives that took no package-level var: a malformed one, one before
	// a local var or anything else that is not a single `var` spec.
	_checkEmbedDirectives(directives) {
		for (const d of directives ?? []) {
			if (d.error) this.err(d.error, d);
			else if (!this._fileImportsEmbed) this.err(EMBED_IMPORT_ERROR, d);
			else if (d.inFunc)
				this.err("go:embed cannot apply to var inside func", d);
			else this.err("misplaced go:embed directive", d);
		}
	}

	// Go's rules for `//go:embed` on the package-level var spec: the file
	// imports "embed", one name, no initializer, a string or []byte type with
	// one file.
	_checkEmbedSpec(spec, type) {
		const directives = spec._embeds;
		spec._embedKind = spec._embedType = undefined;
		const malformed = directives.find((d) => d.error);
		const at = malformed ?? directives[0];
		const fail = (msg) => this.err(msg, at);
		if (malformed) return fail(malformed.error);
		if (!this._fileImportsEmbed) return fail(EMBED_IMPORT_ERROR);
		if (spec.names.length > 1)
			return fail("go:embed cannot apply to multiple vars");
		if (spec.value)
			return fail("go:embed cannot apply to var with initializer");
		const kind = this._embedKind(type);
		if (type?._tainted) return;
		if (!kind)
			return fail(`cannot embed into variable of type ${typeStr(type)}`);
		// Read by `lowerEmbeds`, which has no scope to resolve the type node.
		spec._embedKind = kind;
		spec._embedType = type;
		if (kind === "fs") return;
		const paths = new Set(
			directives.flatMap((d) => (d._embedFiles ?? []).map((f) => f.path)),
		);
		if (paths.size > 1) fail(`multiple files for type ${typeStr(type)}`);
	}

	// What a `//go:embed` variable of `type` holds: "string", "bytes" or "fs"
	// (an embed.FS, through any alias but not a defined type over it); null for
	// a type Go cannot embed into.
	_embedKind(type) {
		const t = this.resolveType(type);
		if (t?.kind === "named" && t.name === EMBED_FS_TYPE) return "fs";
		const u = this._deepUnderlying(this.resolveType(type));
		if (u?.kind === "basic" && u.name === "string") return "string";
		if (u?.kind === "slice") {
			const elem = this._deepUnderlying(this.resolveType(u.elem));
			if (elem?.kind === "basic" && elem.name === "uint8") return "bytes";
		}
		return null;
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
				if (d.kind === "TypeDecl") {
					this._declFiles.set(d, p._filename ?? null);
					declPackages.set(d, this._pkgId);
				}
				if (d.kind === "TypeDecl" && !d.isAlias && !this.types.has(d.name)) {
					const placeholder = {
						kind: "named",
						name: d.name,
						underlying: null,
						...(p.pkg?.name && { _pkgName: p.pkg.name }),
					};
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
							...(p.pkg?.name && { _pkgName: p.pkg.name }),
						};
					}
					this.types.set(d.name, placeholder);
					this.globals.defineType(d.name, placeholder);
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
						this._constFiles.set(name, p._filename ?? null);
					});
				}
			}
		}
	}

	// Package variables by name, so an array length such as `[len(base)]T`
	// can use the type of one that is declared later.
	_registerVarSpecs(programs) {
		this._pkgVarSpecs = new Map();
		for (const p of programs)
			for (const d of p.decls)
				if (d.kind === "VarDecl")
					for (const spec of d.decls)
						spec.names.forEach((name, index) => {
							this._pkgVarSpecs.set(name, { spec, index, busy: false });
						});
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
				p.decls?.some(
					(d) =>
						(d.kind === "VarDecl" || d.kind === "ConstDecl") &&
						d.decls?.includes(c.spec),
				),
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
					this.lazyBodies &&
					(d.kind === "FuncDecl" || d.kind === "MethodDecl")
				)
					this._deferBody(d, p);
				else if (
					d.kind === "FuncDecl" ||
					d.kind === "MethodDecl" ||
					d.kind === "TemplDecl"
				) {
					this.checkTopDecl(d, this.globals);
				}
			}
		}
	}

	// Lazy mode: validate what does not need the body now, check it on demand.
	_deferBody(decl, program) {
		if (decl.intrinsic) this._checkIntrinsic(decl);
		if (decl.native) this._checkNative(decl);
		// The constraints are part of the signature: importers resolve these
		// nodes through the function's type, so they are settled now rather
		// than when the body is first checked (on a copy of the declaration).
		if (decl.kind === "FuncDecl")
			this._injectTypeParams(decl, new Scope(this.globals), this.globals);
		this._lazyBodies.set(decl, program);
	}

	// Types the body of a function or method deferred by `lazyBodies`; a
	// declaration checked already (or not deferred) is left alone.  `decl` may
	// be a copy of the deferred declaration `key`, so the original stays as
	// parsed.
	checkBody(decl, key = decl) {
		const program = this._lazyBodies.get(key);
		if (!program) return;
		this._lazyBodies.delete(key);
		this._setCurrentFile(program);
		// Constraint positions are marked per node, so a copy needs its own.
		if (decl !== key) this._markConstraintPositions([{ decls: [decl] }]);
		this.checkTopDecl(decl, this.globals);
	}

	// ── Shared pass helpers ──────────────────────────────────────

	// Instances made while types were collected (`struct{ Inner[int] }`) have
	// no methods yet, and a type embedding another embedder (`Deep` over `E`
	// over `Base`) needs the inner promotion first, so repeat until nothing
	// new is promoted.
	_promoteEmbeddedMethods() {
		const structs = [];
		for (const type of this.types.values()) {
			structs.push(type.underlying);
			const instances = this._genericState.get(type._generic)?.instances;
			for (const inst of instances?.values() ?? []) {
				this._syncInstanceMethods(type._generic, inst);
				structs.push(inst.underlying);
			}
		}
		const count = () =>
			structs.reduce((n, st) => n + (st?.fields?.size ?? 0), 0);
		let before;
		let changed;
		do {
			before = count();
			changed = false;
			for (const st of structs)
				if (this._promoteEmbeddedInto(st)) changed = true;
		} while (changed || count() !== before);
	}

	// Recomputes the methods `struct` gets from its embedded fields, as Go's
	// method set: the shallowest method of each name wins, a method declared
	// on the struct itself shadows every promoted one, and a pointer method
	// reached through an embedded pointer belongs to the value method set.
	// Returns whether the promoted methods changed.
	_promoteEmbeddedInto(struct) {
		if (struct?.kind !== "struct" || !struct._embeds) return false;
		const old = promotedMethods.get(struct) ?? new Map();
		const best = new Map();
		for (const embed of struct._embeds)
			this._offerEmbedMethods(struct, embed, best);
		if (best.size === 0 && old.size === 0) return false;
		struct.methods ??= new Map();
		// A method declared on the struct (or set since the last pass) is
		// not one this pass promoted.
		const isOwn = (mName) =>
			struct.methods.has(mName) &&
			struct.methods.get(mName) !== old.get(mName)?.mType;
		const next = new Map();
		for (const [mName, cand] of best)
			if (!isOwn(mName)) next.set(mName, promotedEntry(cand, old.get(mName)));
		promotedMethods.set(struct, next);
		return applyPromotions(struct.methods, old, next, isOwn);
	}

	// Adds the methods one embedded field offers to `best` (name -> the
	// shallowest candidate), and copies its fields into the embedder.
	_offerEmbedMethods(struct, embed, best) {
		const isPtr = embed.kind === "pointer";
		const inner = isPtr ? embed.base : embed;
		const base = this._deepUnderlying(inner);
		// Two candidates at the same depth make the name ambiguous, as does
		// an ambiguous name of the embedded type.
		const offer = (name, depth, source, viaPtr, ambiguous = false) => {
			const cur = best.get(name);
			if (!cur || depth < cur.depth)
				best.set(name, { depth, source, viaPtr, ambiguous });
			else if (depth === cur.depth) cur.ambiguous = true;
		};
		if (base?.kind === "struct") {
			this._offerStructEmbed(struct, base, isPtr, offer);
			return;
		}
		// An embedded interface (named, literal or `error`) promotes every
		// method of its method set, as a value method.
		if (base?.kind === "interface") {
			if (!isPtr) offerInterfaceMethods(base, offer);
			return;
		}
		// A named non-struct type (`time.Duration`) keeps its methods on the
		// named type itself.
		if (inner.kind === "named")
			for (const [mName, mType] of inner.methods ?? [])
				offer(mName, 1, mType, isPtr);
	}

	// Offers the methods of the embedded struct `base`, and copies its fields
	// into the embedder.
	_offerStructEmbed(struct, base, isPtr, offer) {
		// Fields of an embedded type declared after the embedder were not
		// there when the embedder's fields were collected.
		if (struct.fields)
			for (const [k, v] of base.fields)
				if (!struct.fields.has(k)) {
					struct.fields.set(k, v);
					copyFieldOwner(struct, base, k);
				}
		const innerPromoted = promotedMethods.get(base);
		for (const [mName, mType] of base.methods ?? []) {
			const p = innerPromoted?.get(mName);
			offer(
				mName,
				1 + (p?.depth ?? 0),
				p?.source ?? mType,
				isPtr || Boolean(p?.viaPtr),
			);
		}
		for (const [mName, p] of innerPromoted ?? [])
			if (p.ambiguous) offer(mName, 1 + p.depth, null, false, true);
	}

	// ── Type collection ──────────────────────────────────────────

	collectType(decl, scope = null) {
		this._declFiles.set(decl, this._currentFile);
		declPackages.set(decl, this._pkgId);
		// `type N interface{ ~int }` and `type D N` declare constraints.
		this._markConstraintPos(decl.type);
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
				typeScope.defineType(tp.name, t);
				return t;
			});
			const pkgName = this._currentPkgName ?? this.pkgName;
			const existing = this.types.get(decl.name);
			const named =
				existing?.kind === "named"
					? existing
					: { kind: "named", name: decl.name };
			if (!named._pkgName && pkgName) named._pkgName = pkgName;
			// Registered before the fields resolve so `Next *List[T]` finds the
			// generic declaration it is part of.
			named._declNode = decl;
			if (preset?.declNode === decl) named._generic = preset;
			else
				named._generic = {
					typeParams: typeParamTypes,
					declNode: decl,
					...(named._pkgName && { _pkgName: named._pkgName }),
				};
			this.types.set(decl.name, named);
			let underlying = this.resolveTypeNode(decl.type, typeScope);
			// `type W[T any] V[T]`: W's underlying type is V[T]'s.
			if (underlying.kind === "named")
				underlying = this._underlyingOver(underlying, decl);
			underlying = this._definedEmptyInterface(underlying, decl);
			named.underlying = underlying;
			named._target = this.target;
			if (underlying.kind === "struct") {
				underlying.name = decl.name;
				underlying.methods = new Map();
			}
			this.types.set(decl.name, named);
			this._defineTypeBinding(decl.name, named, scope);
			return;
		}
		// A type declared inside a function is registered before its fields
		// resolve so `next *L` finds it; package-level types already are.
		this._registerLocalTypePlaceholder(decl, scope);
		let underlying = this.resolveTypeNode(decl.type, scope ?? this.globals);
		// `type W V` with V a defined type: W's underlying type is V's.
		if (!decl.isAlias && underlying.kind === "named")
			underlying = this._underlyingOver(underlying, decl);
		underlying = this._definedEmptyInterface(underlying, decl);
		if (decl.isAlias) {
			// type A = B — transparent alias, A and B are identical types
			this.types.set(decl.name, underlying);
			this._defineTypeBinding(decl.name, underlying, scope);
			return;
		}
		const pkgName = this._currentPkgName ?? this.pkgName;
		const existing = this.types.get(decl.name);
		// An imported package's type is never reused: a local declaration of
		// the same name gets its own type and leaves `pkg.T` untouched.
		const named =
			existing?.kind === "named" && !this._importBound.has(existing)
				? existing
				: { kind: "named", name: decl.name };
		if (!named._pkgName && pkgName) named._pkgName = pkgName;
		named.underlying = underlying;
		named._declNode = decl;
		named._target = this.target;
		if (underlying.kind === "struct") {
			underlying.name = decl.name;
			if (named._pkgName) underlying._pkgName = named._pkgName;
			underlying.methods = new Map();
		} else if (underlying.kind !== "interface") {
			named.methods = new Map();
		}
		if (underlying.kind === "interface") {
			underlying.name = decl.name;
			if (named._pkgName) underlying._pkgName = named._pkgName;
		}
		this.types.set(decl.name, named);
		this._defineTypeBinding(decl.name, named, scope);
	}

	// The underlying type of a type declared over the defined type `base`
	// (`type W V`): V's underlying type, followed through every defined type V
	// is itself declared over, so the underlying type of a defined type is
	// not a defined type again. A struct or interface type carries the name of its declaration, so W gets its own
	// copy (and none of V's methods). `base` is returned as it is while a type
	// on the way is not collected yet, which only an invalid cycle
	// (`type A B; type B A`) leaves behind.
	_underlyingOver(base, decl) {
		let inner = base;
		for (let i = 0; inner?.kind === "named" && i < 32; i++)
			inner = this.resolveType(inner).underlying;
		if (!inner || inner.kind === "named") return base;
		if (inner.kind === "struct")
			return { ...inner, name: decl.name, methods: new Map() };
		if (inner.kind === "interface") return { ...inner, name: decl.name };
		return inner;
	}

	// `type MyAny any` is a defined empty interface, like `type B interface{}`.
	_definedEmptyInterface(underlying, decl) {
		if (decl.isAlias) return underlying;
		const inner =
			underlying.kind === "named"
				? this._deepUnderlying(underlying)
				: underlying;
		if (inner?.kind !== "basic" || anyKind(inner) !== "go") return underlying;
		return { kind: "interface", methods: new Map() };
	}

	// Binds a declared type's name.  A type declared in a function or block
	// binds the name in that block's scope only (`_localTypes` lets type
	// resolution tell it from a package-level type); the package scope is never
	// touched, so a package-level name of any kind stays what it is.
	_defineTypeBinding(name, type, scope) {
		if (scope && scope !== this.globals) this._localTypes.add(name);
		(scope ?? this.globals).defineType(name, type);
	}

	_registerLocalTypePlaceholder(decl, scope) {
		const prior = this.types.get(decl.name);
		if (decl.isAlias || (prior && !this._importBound.has(prior))) return;
		const pkgName = this._currentPkgName ?? this.pkgName;
		const placeholder = {
			kind: "named",
			name: decl.name,
			underlying: null,
			...(pkgName && { _pkgName: pkgName }),
		};
		this.types.set(decl.name, placeholder);
		this._defineTypeBinding(decl.name, placeholder, scope);
	}

	// type A[P any] = T[P] — Go 1.24 generic alias. The declaration is a
	// template only: each instantiation A[X] substitutes X into the aliased
	// type and resolves to exactly that type (no new named type).
	_collectGenericAlias(decl) {
		const typeScope = new Scope(this.globals);
		const typeParamTypes = decl.typeParams.map((tp) => {
			const t = { kind: "typeParam", name: tp.name, constraint: tp.constraint };
			typeScope.defineType(tp.name, t);
			return t;
		});
		// Resolve once with the parameters in scope to report errors in the
		// aliased type at the declaration.
		const underlying = this.resolveTypeNode(decl.type, typeScope);
		const pkgName = this._currentPkgName ?? this.pkgName;
		const alias = {
			kind: "named",
			name: decl.name,
			underlying,
			...(pkgName && { _pkgName: pkgName }),
			_generic: { typeParams: typeParamTypes, declNode: decl, isAlias: true },
		};
		this.types.set(decl.name, alias);
		this.globals.defineType(decl.name, alias);
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
				resolveScope.defineType(tp.name, t);
				return t;
			});
		}
		if (decl.kind === "MethodDecl") {
			const recvNamedType = this.types.get(decl.recvType.name);
			if (recvNamedType?._generic) {
				resolveScope = new Scope(this.globals);
				for (const tp of recvNamedType._generic.typeParams)
					resolveScope.defineType(tp.name, tp);
			}
		}
		return { resolveScope, typeParamTypes };
	}

	_registerFuncDecl(decl, funcType, typeParamTypes) {
		if (this.globals.has(decl.name) && decl.name !== "init")
			this.err(`${decl.name} redeclared in this block`, decl);
		if (decl.native) funcType.native = decl.native;
		if (typeParamTypes) {
			this.globals.defineFunc(
				decl.name,
				{
					kind: "generic",
					name: decl.name,
					typeParams: typeParamTypes,
					underlying: funcType,
					declNode: decl,
				},
				decl,
			);
		} else {
			this.globals.defineFunc(decl.name, funcType, decl);
		}
	}

	// A named type owned by another package: imported through a package
	// object, or a linked Go-source stdlib type mangled `Name$$pkg`.
	_isNonLocalNamed(t, spelled) {
		if (this._importedTypes.has(t)) return true;
		// A stdlib package names its own `Name$$pkg` types by that mangled
		// name; any other spelling (an alias, say) reaches another package's.
		return String(t.name).includes("$$") && spelled !== t.name;
	}

	// `type C = *P; func (c C) M()` declares M on P with a pointer receiver:
	// rewrite the receiver to `*P` before anything keys off its name.
	_unwrapPointerAliasReceiver(decl) {
		const node = decl.recvType;
		if (decl.recvPointer || node.kind !== "TypeName") return;
		if (node.name.includes(".")) return;
		const t = this.resolveTypeNodeName(node, this.globals);
		const base = t?.kind === "pointer" ? t.base : null;
		if (base?.kind !== "named" || this.types.get(base.name) !== base) return;
		if (this._isNonLocalNamed(base, node.name)) return;
		decl.recvType = { ...node, name: base.name };
		decl.recvPointer = true;
	}

	collectFunc(decl) {
		if (decl.kind === "MethodDecl") this._unwrapPointerAliasReceiver(decl);
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
		// Codegen of an importing package reads the body of a Go-source
		// method (does it accept a nil receiver?).
		funcType._methodDecl = decl;
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

	// A receiver's base type is a defined, non-pointer, non-interface type
	// declared in this package.
	_checkReceiverType(decl) {
		const node = decl.recvType;
		const isName = node.kind === "TypeName" || node.kind === "GenericTypeName";
		if (!isName) {
			const t = this.resolveTypeNode(node, this.globals);
			const stars = node.kind === "PointerType" && decl.recvPointer ? "*" : "";
			return this.err(`invalid receiver type ${stars}${typeStr(t)}`, decl);
		}
		const resolved = this.resolveTypeNodeName(node, this.globals);
		if (resolved.kind === "basic" && resolved.name === "any")
			return this.err(`invalid receiver type ${node.name}`, decl);
		// `type C = *pkg.T` is a pointer to another package's type.
		const t =
			resolved.kind === "pointer" && resolved.base?.kind === "named"
				? resolved.base
				: resolved;
		if (
			t.kind === "basic" ||
			t === ERROR ||
			node.name.includes(".") ||
			this._isNonLocalNamed(t, node.name)
		)
			return this.err(
				`cannot define new methods on non-local type ${displayTypeName(
					t.kind === "named" ? t.name : node.name,
				)}`,
				decl,
			);
		if (resolved.kind !== "named") {
			return this.err(`invalid receiver type ${node.name}`, decl);
		}
		const u = t.underlying;
		if (u?.kind === "pointer" || u?.kind === "interface")
			this.err(
				`invalid receiver type ${node.name} (pointer or interface type)`,
				decl,
			);
	}

	_attachMethod(decl, funcType) {
		this._checkReceiverType(decl);
		funcType._ptrRecv = Boolean(decl.recvPointer);
		funcType._pkgId = this._pkgId;
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
			if (a.kind === "expr") this._checkTemplExpr(a, a.tokens, scope);
			else if (a.kind === "cond-bool") this._checkTemplCondAttr(a, scope);
		}
		this._checkTemplNodes(n.children, scope);
	}

	// `name?={ cond }` sets the attribute when `cond` is true.
	_checkTemplCondAttr(a, scope) {
		const raw = this._checkTemplExpr(a, a.tokens, scope);
		// A `gom.Signal[bool]` or `gom.Computed[bool]` stands for its value.
		const t = signalOf(raw)?.elem ?? raw;
		this._requireTemplBool(
			t,
			a.expr,
			"conditional attribute",
			`Conditional attribute '${a.name}' must be bool`,
		);
	}

	// A templ condition is a bool or a JS-dynamic value; a Go `any` needs an
	// assertion first.
	_requireTemplBool(t, node, where, msg) {
		if (anyKind(t) === "go")
			this.err(`non-boolean condition in ${where}`, node);
		else if (t && !isBool(t) && !isAny(t)) this.err(msg, node);
	}

	// `{ name... }` names a variadic parameter. A templ without a `children`
	// parameter may still write `{ children... }` (it mounts nothing).
	_checkTemplChildren(n, scope) {
		if (n.name === "children" && !scope.lookup("children")) return;
		this._checkTemplExpr(n, [], scope);
	}

	_checkTemplLeaf(n, scope) {
		this._checkTemplExpr(n, n.tokens, scope);
	}

	_checkTemplIf(n, scope) {
		const ct = this._checkTemplExpr(n, n.condTokens, scope);
		this._requireTemplBool(
			ct,
			n.expr,
			"if statement",
			"non-boolean condition in if statement",
		);
		this._checkTemplNodes(n.then, scope);
		this._checkTemplNodes(n.else_, scope);
	}

	_checkTemplSwitch(n, scope) {
		this._checkTemplExpr(n, n.exprTokens, scope);
		// A tag that failed to parse leaves `n.expr` unset: not a tagless switch.
		const tagless = !n.exprTokens?.length;
		for (const c of n.cases ?? []) {
			this._checkTemplExpr(c, c.caseTokens, scope);
			for (const e of c.exprs?.slice(1) ?? []) this.checkExpr(e, scope);
			if (n.expr || tagless)
				for (const e of c.exprs ?? []) this._checkCaseValue(n.expr, e);
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
		if (this.globals.has(decl.name) && decl.name !== "init") {
			this.err(`${decl.name} redeclared in this block`, decl);
		}
		this.globals.defineFunc(decl.name, funcType, decl);
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
		if (this.globals.has(decl.name) && decl.name !== "init") {
			this.err(`${decl.name} redeclared in this block`, decl);
		}
		this.globals.defineFunc(decl.name, funcType, decl);
	}

	_checkIntrinsic(decl) {
		const want = INTRINSICS.get(decl.intrinsic);
		if (!want) return this.err(`unknown intrinsic '${decl.intrinsic}'`, decl);
		if (!decl._bodyless)
			return this.err(
				`intrinsic '${decl.intrinsic}' must not have a body`,
				decl,
			);
		const got = typeStr(this.globals.get(decl.name));
		if (got !== want)
			this.err(
				`intrinsic '${decl.intrinsic}' must have type ${want}, not ${got}`,
				decl,
			);
	}

	_checkNative(decl) {
		if (!this.isStdlib && !this.nativesChecked)
			return this.err(
				"//gofront:native is reserved for the standard library",
				decl,
			);
		if (decl.kind !== "FuncDecl")
			return this.err(
				`native '${decl.native}' must mark a function, not a method`,
				decl,
			);
		if (!NATIVES.has(decl.native))
			return this.err(`unknown native '${decl.native}'`, decl);
		if (decl._bodyless)
			this.err(`native '${decl.native}' must have a Go body`, decl);
	}

	checkFuncDecl(decl, outer) {
		this.stats.bodiesChecked++;
		if (decl.intrinsic) this._checkIntrinsic(decl);
		if (decl.native) this._checkNative(decl);
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
		this.stats.bodiesChecked++;
		if (decl.native) this._checkNative(decl);
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
		const savedRecvGeneric = this._recvGeneric;
		this._recvGeneric = recvNamedType?._generic;
		try {
			this._runFuncBody(decl, inner, returnType);
		} finally {
			this._recvGeneric = savedRecvGeneric;
		}
		this._checkMissingReturn(decl, returnType, "method");
	}

	// A variadic parameter `xs ...T` is a `[]T` inside the body (the signature
	// keeps the element type plus the `variadic` flag).
	_paramType(p, scope) {
		const t = this.resolveTypeNode(p.type, scope);
		return p.variadic ? { kind: "slice", elem: t } : t;
	}

	_injectTypeParams(decl, inner, _outer) {
		if (!decl.typeParams) return;
		// Declare every parameter first so a constraint may mention one that
		// comes later in the list (`[S ~[]E, E any]`).
		const params = decl.typeParams.map((tp) => {
			const t = { kind: "typeParam", name: tp.name, constraint: ANY };
			inner.defineType(tp.name, t);
			return t;
		});
		decl.typeParams.forEach((tp, i) => {
			if (tp.constraint)
				params[i].constraint = this.resolveTypeNode(tp.constraint, inner);
		});
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
			inner.defineType(tp.name, tp);
		}
	}

	_setupFuncReturnType(decl, inner) {
		let returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, inner)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(decl.returnType, inner);
		if (hasNamedReturns && returnType)
			returnType = copyType(returnType, { _hasNamedReturns: true });
		return returnType;
	}

	_runFuncBody(decl, inner, returnType) {
		const savedDefer = this._deferCount;
		const savedLabels = this._labels;
		const savedAssigned = this._bodyAssigned;
		this._deferCount = 0;
		this._labels = newLabelScope();
		this._bodyAssigned = scanStores(decl.body);
		this.checkBlock(decl.body, inner, returnType);
		this._bodyAssigned = savedAssigned;
		this._reportUnused(inner, decl);
		if (this._deferCount > 0) decl.body._hasDefer = true;
		this._deferCount = savedDefer;
		this._labels = savedLabels;
		decl._returnType = returnType;
	}

	_checkMissingReturn(decl, returnType, kind) {
		if (
			!decl._bodyless &&
			!isVoid(returnType) &&
			!returnType._hasNamedReturns
		) {
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

	// The type of a variable declared without one from a value of type `t`.
	// One that holds a function JavaScript implements keeps calling it as
	// JavaScript does unless a Go value may be stored into it.
	_inferredVarType(t, name, scope) {
		if (t?._hostFunc !== true) return t;
		const scan =
			scope !== this.globals && this._bodyAssigned
				? this._bodyAssigned
				: this._assignedInPackage();
		return this._storesOnlyHost(name, scope, scan, new Set([name]))
			? t
			: goFuncType(t);
	}

	// Whether everything stored into the variable `name` is `nil` or a function
	// JavaScript implements. `seen` holds the variables under test, so stores
	// that pass a value around a cycle (`a = b; b = a`) add nothing.
	_storesOnlyHost(name, scope, scan, seen) {
		return (scan.stores.get(name) ?? []).every((v) =>
			this._isHostValue(v, scope, scan, seen),
		);
	}

	// Whether the expression `v`, stored into a variable, is `nil` or a
	// function JavaScript implements: a name or a member chain (`console.warn`)
	// whose root resolves to one. A plain name that one declaration of the
	// scanned code binds is that declaration's variable, found by its value, as
	// it may be declared after the variable stored into; any other root
	// resolves in the scope where that variable is declared.
	_isHostValue(v, scope, scan, seen) {
		const chain = [];
		let root = v;
		while (root?.kind === "SelectorExpr") {
			chain.unshift(root.field);
			root = root.expr;
		}
		if (root?.kind !== "Ident") return false;
		const name = root.name;
		if (root === v && name === "nil") return !scan.bound.has("nil");
		const bound = scan.bound.get(name) ?? 0;
		if (bound > 1) return false;
		const def = bound === 1 ? scan.defs.get(name) : undefined;
		if (def && !chain.length) {
			if (seen.has(name)) return true;
			seen.add(name);
			return (
				this._isHostValue(def, scope, scan, seen) &&
				this._storesOnlyHost(name, scope, scan, seen)
			);
		}
		const errorCount = this.errors.length;
		const base = def
			? this._declaredRootType(def, scope, scan, new Set([name]))
			: scope.lookup(name);
		let t = this._resolveDtsAlias(base);
		for (const field of chain) if (t) t = this.fieldType(t, field, {});
		this.errors.length = errorCount;
		return t?._hostFunc === true;
	}

	// The type of the value `def` that declares the root of a member chain
	// (`c := console`), found without the declaration being in scope yet.
	// Null when it cannot be told: a root bound more than once, or a value
	// that is not a name or a member chain.
	_declaredRootType(def, scope, scan, seen) {
		const chain = [];
		let root = def;
		while (root?.kind === "SelectorExpr") {
			chain.unshift(root.field);
			root = root.expr;
		}
		if (root?.kind !== "Ident") return null;
		const bound = scan.bound.get(root.name) ?? 0;
		if (bound > 1 || seen.has(root.name)) return null;
		const inner = bound === 1 ? scan.defs.get(root.name) : undefined;
		const errorCount = this.errors.length;
		let t = this._resolveDtsAlias(
			inner
				? this._declaredRootType(inner, scope, scan, seen.add(root.name))
				: scope.lookup(root.name),
		);
		for (const field of chain) if (t) t = this.fieldType(t, field, {});
		this.errors.length = errorCount;
		return t;
	}

	_assignedInPackage() {
		this._programAssigned ??= scanStores(
			(this._programs ?? []).map((p) => p.decls),
		);
		return this._programAssigned;
	}

	checkVarDecl(decl, scope) {
		const savedSharedAlloc = this._sharedAllocOk;
		this._sharedAllocOk = scope === this.globals;
		for (const spec of decl.decls) {
			let type = spec.type ? this.resolveTypeNode(spec.type, scope) : null;
			if (spec._embeds && scope === this.globals)
				this._checkEmbedSpec(spec, type ?? ANY);
			if (spec.value) {
				const valTypesFlat = this._varSpecValueTypes(spec, scope);
				for (let i = 0; i < spec.names.length; i++) {
					let vt = valTypesFlat[i] ?? ANY;
					if (
						!type &&
						spec.names.length === spec.value.length &&
						this._rejectUntypedNil(vt, spec.value[i], "variable declaration")
					)
						vt = ANY;
					const varType =
						type ??
						this._inferredVarType(defaultType(vt), spec.names[i], scope) ??
						ANY;
					if (!type && spec.names.length === spec.value.length)
						this._checkConstDefault(vt, spec.value[i], "variable declaration");
					if (type)
						this.assertAssignable(
							type,
							vt,
							spec.value[i] ?? spec.value[0],
							"variable declaration",
							undefined,
							spec.names.length === spec.value.length,
						);
					scope.defineLocal(spec.names[i], varType, spec._namePos?.[i]);
				}
			} else {
				if (!type) type = ANY;
				for (let i = 0; i < spec.names.length; i++)
					scope.defineLocal(spec.names[i], type, spec._namePos?.[i]);
			}
		}
		this._sharedAllocOk = savedSharedAlloc;
	}

	// The type of each value a `var` spec binds (a multi-value call or a
	// comma-ok form spreads over several names); reports a count mismatch.
	_varSpecValueTypes(spec, scope) {
		const commaOk = this._checkVarCommaOk(spec, scope);
		const valTypes = commaOk ?? spec.value.map((v) => this.checkExpr(v, scope));
		const isTuple =
			!commaOk && valTypes.length === 1 && valTypes[0]?.kind === "tuple";
		const flat = isTuple ? valTypes[0].types : valTypes;
		if (spec.names.length !== flat.length && !flat.some((t) => t?._tainted))
			this._reportAssignMismatch(spec.names.length, flat.length, isTuple, spec);
		return flat;
	}

	_reportAssignMismatch(nameCount, valueCount, isTuple, node) {
		const vars = nameCount === 1 ? "1 variable" : `${nameCount} variables`;
		const vals = isTuple
			? `returns ${valueCount} values`
			: valueCount === 1
				? "1 value"
				: `${valueCount} values`;
		this.err(`assignment mismatch: ${vars} but ${vals}`, node);
	}

	// `var v, ok = m[k]` / `var v, ok = x.(T)`: the comma-ok forms yield the
	// value and a bool. Returns their types, or null for any other spec.
	_checkVarCommaOk(spec, scope) {
		if (spec.names.length !== 2 || spec.value.length !== 1) return null;
		const value = spec.value[0];
		if (value.kind === "TypeAssertExpr") {
			value._commaOk = true;
			spec._commaOk = true;
			return [this.checkExpr(value, scope), BOOL];
		}
		const stmt = { lhs: spec.names, rhs: spec.value };
		const types = this._checkAssignCommaOkMap(stmt, scope);
		if (types) spec._commaOk = true;
		return types;
	}

	checkConstDecl(decl, scope) {
		for (const spec of decl.decls) {
			const valTypes = spec.value.map((v) => this.checkExpr(v, scope));
			spec.value.forEach((v, i) => {
				if (isNil(valTypes[i])) {
					this.err("nil is not constant", v);
					valTypes[i] = ANY;
				}
			});
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
				// `const D Duration = 1` is a BigInt in JS.
				if (spec.type && expr) this._tag64BitNode(this.resolveType(type), expr);
				if (spec.type && expr)
					this._tagFloat32Const(
						this.resolveType(type),
						valTypes[i] ?? valTypes[0],
						expr,
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
