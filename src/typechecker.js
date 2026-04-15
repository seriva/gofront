// Type checker: walks the AST, resolves types for all expressions,
// and reports type errors at compile time.
//
// Split into sub-modules under typechecker/:
//   types.js        — shared type constants, predicates, Scope
//   statements.js   — checkBlock, checkStmt
//   expressions.js  — checkExpr, checkCall, checkBuiltin, checkCompositeLit

import { expressionCheckMethods } from "./typechecker/expressions.js";
import { statementCheckMethods } from "./typechecker/statements.js";
import {
	ANY,
	BASIC_TYPES,
	BOOL,
	CMP_OPS,
	ERROR,
	FLOAT64,
	INT,
	isAny,
	isError,
	isNil,
	isNumeric,
	isString,
	LOG_OPS,
	Scope,
	STRING,
	TypeCheckError,
	typeStr,
	VOID,
} from "./typechecker/types.js";

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
		this._setupGlobals();
	}

	_setupGlobals() {
		// Browser globals — typed as 'any' so any access/call is permitted
		const browserGlobals = [
			"console",
			"document",
			"window",
			"navigator",
			"location",
			"history",
			"screen",
			"performance",
			"crypto",
			"indexedDB",
			"fetch",
			"setTimeout",
			"setInterval",
			"clearTimeout",
			"clearInterval",
			"requestAnimationFrame",
			"cancelAnimationFrame",
			"Math",
			"JSON",
			"Date",
			"RegExp",
			"Promise",
			"Error",
			"Symbol",
			"String",
			"Number",
			"Boolean",
			"Array",
			"Object",
			"parseInt",
			"parseFloat",
			"isNaN",
			"isFinite",
			"encodeURIComponent",
			"decodeURIComponent",
			"atob",
			"btoa",
			"alert",
			"confirm",
			"prompt",
			"localStorage",
			"sessionStorage",
			"WebSocket",
			"Worker",
			"HTMLElement",
			"Element",
			"Event",
			"CustomEvent",
			"URL",
			"URLSearchParams",
			"FormData",
			"Headers",
			"Request",
			"Response",
			"Blob",
			"File",
			"FileReader",
			"ArrayBuffer",
			"Uint8Array",
			"TextEncoder",
			"TextDecoder",
			"WebGLRenderingContext",
			"WebGL2RenderingContext",
			"GPUDevice",
			"GPUAdapter",
		];
		for (const g of browserGlobals) this.globals.define(g, ANY);

		// Built-in functions
		// fmt package — string formatting (variadic: format string + any args)
		const fmtVariadic = (ret) => ({
			kind: "func",
			params: [STRING, ANY],
			returns: [ret],
			variadic: true,
		});
		this.globals.define("fmt", {
			kind: "namespace",
			name: "fmt",
			members: {
				Sprintf: fmtVariadic(STRING),
				Errorf: fmtVariadic(ERROR),
				Printf: fmtVariadic(VOID),
				Println: fmtVariadic(VOID),
				Print: fmtVariadic(VOID),
			},
		});

		this.globals.define("append", { kind: "builtin", name: "append" });
		this.globals.define("len", { kind: "builtin", name: "len" });
		this.globals.define("cap", { kind: "builtin", name: "cap" });
		this.globals.define("make", { kind: "builtin", name: "make" });
		this.globals.define("delete", { kind: "builtin", name: "delete" });
		this.globals.define("print", { kind: "builtin", name: "print" });
		this.globals.define("println", { kind: "builtin", name: "println" });
		this.globals.define("panic", { kind: "builtin", name: "panic" });
		this.globals.define("recover", { kind: "builtin", name: "recover" });
		this.globals.define("new", { kind: "builtin", name: "new" });
		this.globals.define("copy", { kind: "builtin", name: "copy" });
		this.globals.define("error", { kind: "builtin", name: "error" });
		this.globals.define("min", { kind: "builtin", name: "min" });
		this.globals.define("max", { kind: "builtin", name: "max" });
		this.globals.define("clear", { kind: "builtin", name: "clear" });
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
		this.globals.define(pkgName, { kind: "namespace", name: pkgName, members });
		for (const [name, type] of types) this.types.set(name, type);
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

	check(program) {
		this._currentFile = program._filename ?? null;
		this._currentSource = program._source ?? null;
		// Pass 1: collect type declarations
		for (const decl of program.decls) {
			if (decl.kind === "TypeDecl") this.collectType(decl);
		}
		// Pass 2: collect function / method signatures
		for (const decl of program.decls) {
			if (decl.kind === "FuncDecl" || decl.kind === "MethodDecl") {
				this.collectFunc(decl);
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
		// Pass 1: collect type declarations
		for (const p of programs) {
			this._currentFile = p._filename ?? null;
			this._currentSource = p._source ?? null;
			for (const d of p.decls) if (d.kind === "TypeDecl") this.collectType(d);
		}

		// Pass 2: collect function / method signatures
		for (const p of programs) {
			this._currentFile = p._filename ?? null;
			this._currentSource = p._source ?? null;
			for (const d of p.decls)
				if (d.kind === "FuncDecl" || d.kind === "MethodDecl")
					this.collectFunc(d);
		}

		// Pass 2.1: Promote embedded methods
		this._promoteEmbeddedMethods();

		// Pass 2.5: pre-declare package-level vars and consts
		// This allows any file's function body to reference vars from other files.
		for (const p of programs) {
			this._currentFile = p._filename ?? null;
			this._currentSource = p._source ?? null;
			for (const d of p.decls) {
				if (d.kind === "VarDecl") this.collectVar(d);
				if (d.kind === "ConstDecl") this.collectConst(d);
			}
		}

		// Pass 3: check bodies (re-checks var/const decls with proper types)
		for (const p of programs) {
			this._currentFile = p._filename ?? null;
			this._currentSource = p._source ?? null;
			for (const d of p.decls) this.checkTopDecl(d, this.globals);
		}

		return this.errors;
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
		}
		if (underlying.kind === "interface") {
			underlying.name = decl.name;
		}
		this.types.set(decl.name, named);
		this.globals.define(decl.name, named);
	}

	collectFunc(decl) {
		const paramTypes = decl.params.map((p) =>
			this.resolveTypeNode(p.type, this.globals),
		);
		const returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, this.globals)
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
		if (decl.kind === "FuncDecl") {
			if (this.globals.symbols.has(decl.name) && decl.name !== "init") {
				this.err(`${decl.name} redeclared in this block`, decl);
			}
			this.globals.define(decl.name, funcType);
		} else {
			// Method: attach to struct type
			const recvType = this.resolveTypeNodeName(decl.recvType, this.globals);
			const base = recvType?.underlying ?? recvType;
			if (base?.kind === "struct") {
				base.methods.set(decl.name, funcType);
			}
		}
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
				break; // already collected
		}
	}

	checkFuncDecl(decl, outer) {
		const inner = new Scope(outer);
		for (const p of decl.params) {
			inner.define(p.name, this.resolveTypeNode(p.type, outer));
		}
		const returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, outer)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(
			decl.returnType,
			inner,
			outer,
		);
		if (hasNamedReturns && returnType) returnType._hasNamedReturns = true;
		this.checkBlock(decl.body, inner, returnType);
		decl._returnType = returnType;
	}

	checkMethodDecl(decl, outer) {
		const inner = new Scope(outer);
		const recvType = this.resolveTypeNodeName(decl.recvType, outer);
		inner.define(decl.recvName, recvType);
		for (const p of decl.params) {
			inner.define(p.name, this.resolveTypeNode(p.type, outer));
		}
		const returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, outer)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(
			decl.returnType,
			inner,
			outer,
		);
		if (hasNamedReturns && returnType) returnType._hasNamedReturns = true;
		this.checkBlock(decl.body, inner, returnType);
		decl._returnType = returnType;
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
				if (!type) type = valTypes[0] ?? ANY;
				for (let i = 0; i < spec.names.length; i++) {
					const vt = valTypes[i] ?? ANY;
					this.assertAssignable(type, vt, spec.value[i]);
				}
			}
			if (!type) type = ANY;
			for (const name of spec.names) scope.define(name, type);
		}
	}

	checkConstDecl(decl, scope) {
		for (const spec of decl.decls) {
			const valTypes = spec.value.map((v) => this.checkExpr(v, scope));
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
				const named = this.types.get(node.name);
				if (named) return named;
				return this.err(`Unknown type '${node.name}'`, node);
			}
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
			case "StructType": {
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
				const structType = {
					kind: "struct",
					fields,
					methods: new Map(),
					_embeds: embeds,
				};
				return structType;
			}
			case "InterfaceType": {
				const methods = new Map();
				for (const m of node.methods) {
					const params = m.params.map((p) =>
						this.resolveTypeNode(p.type, scope),
					);
					const returns = m.returnType
						? [this.resolveTypeNode(m.returnType, scope)]
						: [VOID];
					methods.set(m.name, { kind: "func", params, returns });
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
		return this.resolveTypeNode(node, scope);
	}

	// ── Helpers ───────────────────────────────────────────────────

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
		let base = baseType.kind === "named" ? baseType.underlying : baseType;
		base = this.resolveType(base);
		if (base?.kind === "struct") {
			if (base.fields?.has(field)) return base.fields.get(field);
			if (base.methods?.has(field)) return base.methods.get(field);
			return this.err(`No field '${field}' on ${typeStr(baseType)}`, node);
		}
		if (base?.kind === "namespace") {
			if (field in base.members) return base.members[field];
			return this.err(`No member '${field}' in namespace ${base.name}`, node);
		}
		// For explicitly typed non-any values, report the bad access rather than
		// silently returning any — this catches typos on structs and primitive misuse.
		if (base && !isAny(base)) {
			// error.Error() is valid — it returns the error string
			if (isError(base) && field === "Error")
				return { kind: "func", params: [], returns: [STRING], async: false };
			// pointer.value is the GoFront new(T) pattern
			if (base.kind === "pointer" && field === "value") return base.base ?? ANY;
			const badKinds = ["basic", "slice", "array", "map", "func", "tuple"];
			if (badKinds.includes(base.kind)) {
				return this.err(
					`${typeStr(baseType ?? base)} has no field or method '${field}'`,
					node,
				);
			}
		}
		return ANY; // unknown types (e.g. external .d.ts) — allow any access
	}

	binaryResultType(op, lt, rt, node) {
		if (CMP_OPS.has(op)) return BOOL;
		if (LOG_OPS.has(op)) return BOOL;
		if (isAny(lt) || isAny(rt)) return ANY;
		if (isNumeric(lt) && isNumeric(rt)) {
			// float64 is contagious
			return lt.name === "float64" || rt.name === "float64" ? FLOAT64 : INT;
		}
		if (isString(lt) && isString(rt) && op === "+") return STRING;
		if (node)
			this.err(`Invalid operation: ${typeStr(lt)} ${op} ${typeStr(rt)}`, node);
		return ANY;
	}

	assertAssignable(target, source, node) {
		if (!target || !source) return;
		target = this.resolveType(target);
		source = this.resolveType(source);
		if (isAny(target) || isAny(source)) return;
		if (isNil(source)) return; // nil is assignable to anything nullable

		// Go untyped constant promotion: int literals are assignable to float64
		if (target.kind === "basic" && source.kind === "basic") {
			if (target.name === "float64" && source.name === "int") return;
			if (target.name === "int" && source.name === "float64") return; // truncating
		}
		if (typeStr(target) !== typeStr(source)) {
			// Interface satisfaction check
			let tBase = target.kind === "named" ? target.underlying : target;
			let sBase = source.kind === "named" ? source.underlying : source;
			tBase = this.resolveType(tBase);
			sBase = this.resolveType(sBase);
			if (tBase?.kind === "interface") {
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
	}

	implements(srcType, iface, _node) {
		let base = srcType.kind === "named" ? srcType.underlying : srcType;
		base = this.resolveType(base);
		if (base?.kind !== "struct") return false;
		for (const [name, required] of iface.methods) {
			const actual = base.methods?.get(name);
			if (!actual) return false;
			// Check return type matches (params are not strictly checked — Go allows covariance)
			const reqRet = required.returns?.[0];
			const actRet = actual.returns?.[0];
			if (reqRet && actRet && typeStr(reqRet) !== typeStr(actRet)) return false;
		}
		return true;
	}
}

Object.assign(TypeChecker.prototype, statementCheckMethods);
Object.assign(TypeChecker.prototype, expressionCheckMethods);
