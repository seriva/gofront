// Type checker: walks the AST, resolves types for all expressions,
// and reports type errors at compile time.
//
// Type representation:
//   { kind: 'basic',     name: 'int'|'float64'|'string'|'bool'|'any'|'void' }
//   { kind: 'slice',     elem: Type }
//   { kind: 'array',     size: n, elem: Type }
//   { kind: 'map',       key: Type, value: Type }
//   { kind: 'struct',    name: string, fields: Map<string, Type>, methods: Map<string, FuncType> }
//   { kind: 'interface', name: string, methods: Map<string, FuncType> }
//   { kind: 'func',      params: Type[], returns: Type[]  }
//   { kind: 'tuple',     types: Type[] }   ← multiple return values
//   { kind: 'named',     name: string, underlying: Type }

export class TypeCheckError extends Error {
	constructor(msg, node, filename, sourceCode) {
		const lineNum = node?.line || node?._line;
		const loc = filename
			? lineNum
				? ` in ${filename} at line ${lineNum}`
				: ` in ${filename}`
			: lineNum
				? ` at line ${lineNum}`
				: "";
		let lineContext = "";
		if (lineNum && sourceCode) {
			const lines = sourceCode.split("\n");
			const lineStr = lines[lineNum - 1];
			if (lineStr !== undefined) {
				lineContext = `\n  ${lineNum} | ${lineStr}`;
			}
		}
		super(`Type error${loc}: ${msg}${lineContext}`);
	}
}

// ── Static operator sets (module-level for reuse) ────────────
const CMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);
const LOG_OPS = new Set(["&&", "||"]);

// ── Built-in types ───────────────────────────────────────────

const INT = { kind: "basic", name: "int" };
const FLOAT64 = { kind: "basic", name: "float64" };
const STRING = { kind: "basic", name: "string" };
const BOOL = { kind: "basic", name: "bool" };
const ANY = { kind: "basic", name: "any" };
const VOID = { kind: "basic", name: "void" };
const NIL = { kind: "basic", name: "nil" };
const ERROR = { kind: "basic", name: "error" };

const BASIC_TYPES = {
	int: INT,
	float64: FLOAT64,
	string: STRING,
	bool: BOOL,
	any: ANY,
	byte: INT,
	rune: INT,
	error: ERROR,
	// Sized integer / float aliases — all map to int or float64 at runtime
	uint: INT,
	int8: INT,
	int16: INT,
	int32: INT,
	int64: INT,
	uint8: INT,
	uint16: INT,
	uint32: INT,
	uint64: INT,
	uintptr: INT,
	float32: FLOAT64,
};

function isNumeric(t) {
	return t.kind === "basic" && (t.name === "int" || t.name === "float64");
}
function isString(t) {
	return t.kind === "basic" && t.name === "string";
}
function isBool(t) {
	return t.kind === "basic" && t.name === "bool";
}
function isAny(t) {
	return t.kind === "basic" && t.name === "any";
}
function isNil(t) {
	return t.kind === "basic" && t.name === "nil";
}
function isVoid(t) {
	return t.kind === "basic" && t.name === "void";
}
function isError(t) {
	return t.kind === "basic" && t.name === "error";
}

export function typeStr(t) {
	if (!t) return "void";
	if (t.kind === "basic" && t.alias) return t.alias;
	switch (t.kind) {
		case "basic":
			return t.name;
		case "slice":
			return `[]${typeStr(t.elem)}`;
		case "array":
			return `[${t.size}]${typeStr(t.elem)}`;
		case "map":
			return `map[${typeStr(t.key)}]${typeStr(t.value)}`;
		case "struct":
			return t.name || "struct{...}";
		case "interface":
			return t.name || "interface{...}";
		case "namespace":
			return t.name || "namespace{...}";
		case "func":
			return `func(${t.params.map(typeStr).join(", ")}) ${typeStr(t.returns[0] ?? VOID)}`;
		case "tuple":
			return `(${t.types.map(typeStr).join(", ")})`;
		case "named":
			return t.name;
		case "pointer":
			return `*${typeStr(t.base)}`;
		default:
			return "?";
	}
}

// ── Scope / environment ──────────────────────────────────────

class Scope {
	constructor(parent = null) {
		this.parent = parent;
		this.symbols = new Map();
		this._consts = new Set(); // names declared as const in this scope
	}
	define(name, type) {
		this.symbols.set(name, type);
	}
	defineConst(name, type) {
		this.symbols.set(name, type);
		this._consts.add(name);
	}
	isConst(name) {
		if (this._consts.has(name)) return true;
		// Don't walk parent — shadowing a const with a var in a child scope is valid
		return false;
	}
	lookup(name) {
		if (this.symbols.has(name)) return this.symbols.get(name);
		if (this.parent) return this.parent.lookup(name);
		return null;
	}
	// Lookup which scope owns the name (to check const flag)
	lookupScope(name) {
		if (this.symbols.has(name)) return this;
		if (this.parent) return this.parent.lookupScope(name);
		return null;
	}
}

// ── Type checker ─────────────────────────────────────────────

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

	checkBlock(block, scope, returnType) {
		for (const stmt of block.stmts) {
			this.checkStmt(stmt, scope, returnType);
		}
	}

	checkStmt(stmt, scope, returnType) {
		switch (stmt.kind) {
			case "VarDecl":
				this.checkVarDecl(stmt, scope);
				break;
			case "ConstDecl":
				this.checkConstDecl(stmt, scope);
				break;
			case "TypeDecl":
				this.collectType(stmt);
				break;

			case "DefineStmt": {
				// comma-ok type assertion: n, ok := x.(T)
				if (
					stmt.lhs.length === 2 &&
					stmt.rhs.length === 1 &&
					stmt.rhs[0].kind === "TypeAssertExpr"
				) {
					stmt.rhs[0]._commaOk = true;
				}
				const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
				// Flatten tuple returns
				const rhsFlat =
					rhs.length === 1 && rhs[0].kind === "tuple" ? rhs[0].types : rhs;
				// comma-ok type assertion returns [assertedType, bool]
				if (stmt.rhs[0]?._commaOk) {
					const lhsNames = stmt.lhs.map((e) => e.name ?? e);
					if (lhsNames[0] !== "_") scope.define(lhsNames[0], rhs[0]);
					if (lhsNames[1] !== "_") scope.define(lhsNames[1], BOOL);
					stmt._rhsTypes = [rhs[0], BOOL];
					break;
				}
				for (let i = 0; i < stmt.lhs.length; i++) {
					const name = stmt.lhs[i].name ?? stmt.lhs[i];
					if (name === "_") continue;
					// Short variable re-declaration: mark vars that already exist
					// in the current (not parent) scope as redeclared.
					if (scope.symbols.has(name)) {
						stmt.lhs[i]._redecl = true;
					}
					scope.define(name, rhsFlat[i] ?? ANY);
				}
				// Go requires at least one new variable in :=
				const allRedecl = stmt.lhs.every(
					(e) => e._redecl || (e.name ?? e) === "_",
				);
				if (allRedecl && stmt.lhs.length > 0) {
					this.err("no new variables on left side of :=", stmt.lhs[0]);
				}
				stmt._rhsTypes = rhsFlat;
				break;
			}

			case "AssignStmt": {
				// Check for const reassignment before evaluating RHS
				for (const lhs of stmt.lhs) {
					if (lhs.kind === "Ident") {
						const ownerScope = scope.lookupScope(lhs.name);
						if (ownerScope?.isConst(lhs.name))
							this.err(`cannot assign to const '${lhs.name}'`, lhs);
					}
				}
				const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
				const rhsFlat =
					rhs.length === 1 && rhs[0]?.kind === "tuple" ? rhs[0].types : rhs;
				const lhsTypes = stmt.lhs.map((e) => this.checkExpr(e, scope));
				for (let i = 0; i < lhsTypes.length; i++) {
					const r = rhsFlat[i] ?? ANY;
					if (!isAny(lhsTypes[i]) && !isAny(r)) {
						this.assertAssignable(lhsTypes[i], r, stmt.lhs[i]);
					}
				}
				break;
			}

			case "IncDecStmt":
				this.checkExpr(stmt.expr, scope);
				break;

			case "ExprStmt":
				this.checkExpr(stmt.expr, scope);
				break;

			case "ReturnStmt": {
				const types = stmt.values.map((v) => this.checkExpr(v, scope));
				stmt._types = types;
				if (
					!isVoid(returnType) &&
					types.length === 0 &&
					!returnType?._hasNamedReturns
				) {
					this.err("Missing return value", stmt);
				}
				// Check each returned value is assignable to its declared type
				if (!isVoid(returnType) && types.length > 0) {
					const expected =
						returnType.kind === "tuple" ? returnType.types : [returnType];
					for (let i = 0; i < expected.length; i++) {
						if (types[i])
							this.assertAssignable(
								expected[i],
								types[i],
								stmt.values[i] ?? stmt,
							);
					}
				}
				break;
			}

			case "IfStmt": {
				const inner = new Scope(scope);
				if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
				const ct = this.checkExpr(stmt.cond, inner);
				if (!isBool(ct) && !isAny(ct))
					this.err("If condition must be bool", stmt);
				this.checkBlock(stmt.body, new Scope(inner), returnType);
				if (stmt.elseBody) {
					if (stmt.elseBody.kind === "Block")
						this.checkBlock(stmt.elseBody, new Scope(inner), returnType);
					else this.checkStmt(stmt.elseBody, inner, returnType);
				}
				break;
			}

			case "ForStmt": {
				const inner = new Scope(scope);
				if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
				if (stmt.cond) {
					const ct = this.checkExpr(stmt.cond, inner);
					if (!isBool(ct) && !isAny(ct))
						this.err("For condition must be bool", stmt);
				}
				if (stmt.post) this.checkStmt(stmt.post, inner, returnType);
				this._loopDepth++;
				this.checkBlock(stmt.body, new Scope(inner), returnType);
				this._loopDepth--;
				break;
			}

			case "SwitchStmt": {
				const inner = new Scope(scope);
				if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
				if (stmt.tag) this.checkExpr(stmt.tag, inner);
				this._switchDepth++;
				for (const c of stmt.cases) {
					const caseScope = new Scope(inner);
					if (c.list) for (const e of c.list) this.checkExpr(e, caseScope);
					for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
				}
				this._switchDepth--;
				break;
			}

			case "TypeSwitchStmt": {
				const inner = new Scope(scope);
				this.checkExpr(stmt.expr, inner);
				this._switchDepth++;
				for (const c of stmt.cases) {
					const caseScope = new Scope(inner);
					if (stmt.assign) {
						// Bind the variable to the single case type, or any for multi/default
						const bindType =
							c.types?.length === 1
								? this.resolveTypeNode(c.types[0], inner)
								: ANY;
						caseScope.define(stmt.assign, bindType);
					}
					for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
				}
				this._switchDepth--;
				break;
			}

			case "DeferStmt": {
				if (stmt.call.kind !== "CallExpr")
					this.err("defer requires a function call", stmt.call);
				this.checkExpr(stmt.call, scope);
				break;
			}

			case "LabeledStmt":
				this.checkStmt(stmt.body, scope, returnType);
				break;

			case "BranchStmt": {
				const kw = stmt.keyword;
				if (stmt.label) break; // labeled branch — target checked by JS
				if (kw === "continue" && this._loopDepth === 0)
					this.err("continue statement outside for loop", stmt);
				else if (
					kw === "break" &&
					this._loopDepth === 0 &&
					this._switchDepth === 0
				)
					this.err("break statement outside for loop or switch", stmt);
				else if (kw === "fallthrough" && this._switchDepth === 0)
					this.err("fallthrough statement outside switch", stmt);
				break;
			}
			case "Block":
				this.checkBlock(stmt, new Scope(scope), returnType);
				break;
			default:
				break;
		}
	}

	// ── Expression checking (returns type) ───────────────────────

	checkExpr(expr, scope) {
		const t = this._checkExpr(expr, scope);
		expr._type = t;
		return t;
	}

	_checkExpr(expr, scope) {
		switch (expr.kind) {
			case "BasicLit": {
				switch (expr.litKind) {
					case "INT":
						return INT;
					case "FLOAT":
						return FLOAT64;
					case "STRING":
						return STRING;
					case "BOOL":
						return BOOL;
					case "NIL":
						return NIL;
				}
				break;
			}

			case "Ident": {
				const t = scope.lookup(expr.name);
				if (!t) return this.err(`Undefined: '${expr.name}'`, expr);
				return t;
			}

			case "UnaryExpr": {
				const ot = this.checkExpr(expr.operand, scope);
				if (expr.op === "!") {
					if (!isBool(ot) && !isAny(ot)) this.err("! requires bool", expr);
					return BOOL;
				}
				if (expr.op === "-" || expr.op === "+") {
					if (!isNumeric(ot) && !isAny(ot))
						this.err(`${expr.op} requires numeric`, expr);
					return ot;
				}
				return ot;
			}

			case "BinaryExpr": {
				const lt = this.checkExpr(expr.left, scope);
				const rt = this.checkExpr(expr.right, scope);
				if (isAny(lt) || isAny(rt)) return this.binaryResultType(expr.op, ANY);
				return this.binaryResultType(expr.op, lt, rt, expr);
			}

			case "CallExpr": {
				return this.checkCall(expr, scope);
			}

			case "SelectorExpr": {
				const baseType = this.checkExpr(expr.expr, scope);
				return this.fieldType(baseType, expr.field, expr);
			}

			case "IndexExpr": {
				const bt = this.checkExpr(expr.expr, scope);
				this.checkExpr(expr.index, scope);
				if (isAny(bt)) return ANY;
				if (bt.kind === "slice" || bt.kind === "array") return bt.elem;
				if (bt.kind === "map") {
					expr._mapValueType = bt.value; // for codegen zero-value fallback
					return bt.value;
				}
				if (isString(bt)) return INT; // byte
				return this.err(`Cannot index type ${typeStr(bt)}`, expr);
			}

			case "SliceExpr": {
				const bt = this.checkExpr(expr.expr, scope);
				if (expr.low) this.checkExpr(expr.low, scope);
				if (expr.high) this.checkExpr(expr.high, scope);
				if (isAny(bt)) return ANY;
				if (bt.kind === "slice" || bt.kind === "array")
					return { kind: "slice", elem: bt.elem };
				if (isString(bt)) return STRING;
				return this.err(`Cannot slice type ${typeStr(bt)}`, expr);
			}

			case "CompositeLit": {
				return this.checkCompositeLit(expr, scope);
			}

			case "FuncLit": {
				const inner = new Scope(scope);
				for (const p of expr.params)
					inner.define(
						p.name,
						p.type ? this.resolveTypeNode(p.type, scope) : ANY,
					);
				const ret = expr.returnType
					? this.resolveTypeNode(expr.returnType, scope)
					: VOID;
				this.checkBlock(expr.body, inner, ret);
				const paramTypes = expr.params.map((p) =>
					p.type ? this.resolveTypeNode(p.type, scope) : ANY,
				);
				return {
					kind: "func",
					params: paramTypes,
					returns: [ret],
					async: expr.async,
				};
			}

			case "AwaitExpr": {
				// await unwraps whatever the expression produces — no Promise type modelling
				return this.checkExpr(expr.expr, scope);
			}

			case "TypeConversion": {
				this.checkExpr(expr.expr, scope);
				return this.resolveTypeNode(expr.targetType, scope);
			}

			case "TypeAssertExpr": {
				this.checkExpr(expr.expr, scope);
				return this.resolveTypeNode(expr.type, scope);
			}

			case "RangeExpr": {
				// Type-check the iterated expression so its _type is annotated
				return this.checkExpr(expr.expr, scope);
			}

			default:
				return ANY;
		}
		return ANY;
	}

	checkCall(expr, scope) {
		const fnType = this.checkExpr(expr.func, scope);
		const argTypes = expr.args.map((a) => this.checkExpr(a, scope));

		// Built-in handling
		if (fnType.kind === "builtin") {
			return this.checkBuiltin(fnType.name, expr, argTypes, scope);
		}

		if (isAny(fnType)) return ANY;

		if (fnType.kind !== "func") {
			return this.err(`Cannot call non-function type ${typeStr(fnType)}`, expr);
		}

		// Check arg count (allow variadic slack)
		const minArgs = fnType.params.filter(
			(_, i) => !fnType.variadic || i < fnType.params.length - 1,
		).length;
		if (argTypes.length < minArgs) {
			this.err(
				`Too few arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
		}
		if (!fnType.variadic && argTypes.length > fnType.params.length) {
			this.err(
				`Too many arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
		}

		// Check each argument is assignable to its parameter type
		for (let i = 0; i < fnType.params.length && i < argTypes.length; i++) {
			const paramIdx =
				fnType.variadic && i >= fnType.params.length - 1
					? fnType.params.length - 1
					: i;
			// Spread arg (f(slice...)) passes a whole slice into a variadic — skip per-element check
			if (expr.args[i]?._spread) continue;
			this.assertAssignable(fnType.params[paramIdx], argTypes[i], expr.args[i]);
		}

		const ret = fnType.returns;
		if (!ret || ret.length === 0) return VOID;
		if (ret.length === 1) return ret[0];
		return { kind: "tuple", types: ret };
	}

	checkBuiltin(name, expr, argTypes, scope) {
		switch (name) {
			case "len":
			case "cap":
				return INT;
			case "append":
				return argTypes[0] ?? ANY;
			case "copy":
				return INT;
			case "delete":
				return VOID;
			case "make": {
				if (expr.args.length < 1) return ANY;
				const typeArg = expr.args[0];
				const typeNode = typeArg.kind === "TypeExpr" ? typeArg.type : typeArg;
				return this.resolveTypeNode(typeNode, scope) ?? ANY;
			}
			case "new": {
				if (expr.args.length < 1) return ANY;
				const inner = this.resolveTypeNode(expr.args[0], scope);
				return { kind: "pointer", base: inner };
			}
			case "print":
			case "println":
			case "panic":
				return VOID;
			case "recover":
				return ANY;
			case "error":
				return ERROR;
			default:
				return ANY;
		}
	}

	checkCompositeLit(expr, scope, hintType = null) {
		// null typeExpr = implicit lit inside a slice/map: {X:1} in []Point{{X:1}}
		const t =
			expr.typeExpr === null
				? (hintType ?? ANY)
				: this.resolveTypeNode(expr.typeExpr, scope);
		const base = t.kind === "named" ? t.underlying : t;

		if (base?.kind === "struct") {
			for (const elem of expr.elems) {
				if (elem.kind === "KeyValueExpr") {
					const keyName = elem.key.name;
					const fieldType = base.fields?.get(keyName);
					if (fieldType) {
						const vt = this.checkExpr(elem.value, scope);
						this.assertAssignable(fieldType, vt, elem.value);
					} else {
						// Check if it's an embedded type name (e.g. Dog{Animal: Animal{...}})
						const embed = base._embeds?.find(
							(e) => (e.kind === "named" ? e.name : null) === keyName,
						);
						if (embed) {
							const vt = this.checkExpr(elem.value, scope);
							this.assertAssignable(embed, vt, elem.value);
							elem._isEmbedInit = true;
						} else {
							this.err(`Unknown field '${keyName}'`, elem.key);
						}
					}
				} else {
					this.checkExpr(elem, scope);
				}
			}
			return t;
		}

		if (base?.kind === "slice") {
			for (const elem of expr.elems) {
				if (elem.kind === "CompositeLit" && elem.typeExpr === null) {
					const et = this.checkCompositeLit(elem, scope, base.elem);
					elem._type = et;
				} else if (elem.kind !== "KeyValueExpr") {
					const et = this.checkExpr(elem, scope);
					this.assertAssignable(base.elem, et, elem);
				}
			}
			return t;
		}

		if (base?.kind === "map") {
			for (const elem of expr.elems) {
				if (elem.kind === "KeyValueExpr") {
					const kt = this.checkExpr(elem.key, scope);
					// value may be an implicit composite lit
					let vt;
					if (
						elem.value.kind === "CompositeLit" &&
						elem.value.typeExpr === null
					) {
						vt = this.checkCompositeLit(elem.value, scope, base.value);
						elem.value._type = vt;
					} else {
						vt = this.checkExpr(elem.value, scope);
					}
					this.assertAssignable(base.key, kt, elem.key);
					this.assertAssignable(base.value, vt, elem.value);
				}
			}
			return t;
		}

		// Unknown type context — still check elements
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				this.checkExpr(elem.value, scope);
			} else {
				this.checkExpr(elem, scope);
			}
		}
		return t ?? ANY;
	}

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
					size: node.size,
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
