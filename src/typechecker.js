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
	defaultType,
	ERROR,
	FLOAT64,
	INT,
	isAny,
	isError,
	isNil,
	isNumeric,
	isString,
	isUntyped,
	isVoid,
	LOG_OPS,
	Scope,
	STRING,
	TypeCheckError,
	typeStr,
	UNTYPED_FLOAT,
	UNTYPED_INT,
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
		this._typeSwitchDepth = 0; // for rejecting fallthrough in type switch
		this._deferCount = 0; // tracks defer usage in current function body
		this._imports = []; // tracked imports for unused-import detection
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

		// strings package
		const strFn1 = (ret) => ({
			kind: "func",
			params: [STRING],
			returns: [ret],
		});
		const strFn2 = (p2, ret) => ({
			kind: "func",
			params: [STRING, p2],
			returns: [ret],
		});
		const strFn3 = (p2, p3, ret) => ({
			kind: "func",
			params: [STRING, p2, p3],
			returns: [ret],
		});
		this.globals.define("strings", {
			kind: "namespace",
			name: "strings",
			members: {
				Contains: strFn2(STRING, BOOL),
				HasPrefix: strFn2(STRING, BOOL),
				HasSuffix: strFn2(STRING, BOOL),
				Index: strFn2(STRING, INT),
				LastIndex: strFn2(STRING, INT),
				Count: strFn2(STRING, INT),
				Repeat: strFn2(INT, STRING),
				Replace: {
					kind: "func",
					params: [STRING, STRING, STRING, INT],
					returns: [STRING],
				},
				ReplaceAll: strFn3(STRING, STRING, STRING),
				ToUpper: strFn1(STRING),
				ToLower: strFn1(STRING),
				TrimSpace: strFn1(STRING),
				Trim: strFn2(STRING, STRING),
				TrimPrefix: strFn2(STRING, STRING),
				TrimSuffix: strFn2(STRING, STRING),
				TrimLeft: strFn2(STRING, STRING),
				TrimRight: strFn2(STRING, STRING),
				Split: strFn2(STRING, { kind: "slice", elem: STRING }),
				Join: {
					kind: "func",
					params: [{ kind: "slice", elem: STRING }, STRING],
					returns: [STRING],
				},
				EqualFold: strFn2(STRING, BOOL),
			},
		});

		// strconv package
		this.globals.define("strconv", {
			kind: "namespace",
			name: "strconv",
			members: {
				Itoa: { kind: "func", params: [INT], returns: [STRING] },
				Atoi: {
					kind: "func",
					params: [STRING],
					returns: [INT, ERROR],
				},
				FormatFloat: {
					kind: "func",
					params: [FLOAT64, INT, INT, INT],
					returns: [STRING],
				},
				FormatBool: { kind: "func", params: [BOOL], returns: [STRING] },
				FormatInt: { kind: "func", params: [INT, INT], returns: [STRING] },
				ParseFloat: {
					kind: "func",
					params: [STRING, INT],
					returns: [FLOAT64, ERROR],
				},
				ParseInt: {
					kind: "func",
					params: [STRING, INT, INT],
					returns: [INT, ERROR],
				},
				ParseBool: {
					kind: "func",
					params: [STRING],
					returns: [BOOL, ERROR],
				},
			},
		});

		// sort package
		this.globals.define("sort", {
			kind: "namespace",
			name: "sort",
			members: {
				Ints: {
					kind: "func",
					params: [{ kind: "slice", elem: INT }],
					returns: [VOID],
				},
				Float64s: {
					kind: "func",
					params: [{ kind: "slice", elem: FLOAT64 }],
					returns: [VOID],
				},
				Strings: {
					kind: "func",
					params: [{ kind: "slice", elem: STRING }],
					returns: [VOID],
				},
				Slice: {
					kind: "func",
					params: [ANY, ANY],
					returns: [VOID],
				},
				SliceStable: {
					kind: "func",
					params: [ANY, ANY],
					returns: [VOID],
				},
				SliceIsSorted: {
					kind: "func",
					params: [ANY, ANY],
					returns: [BOOL],
				},
			},
		});

		// math package
		this.globals.define("math", {
			kind: "namespace",
			name: "math",
			members: {
				Abs: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Floor: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Ceil: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Round: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Sqrt: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Cbrt: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Pow: {
					kind: "func",
					params: [FLOAT64, FLOAT64],
					returns: [FLOAT64],
				},
				Log: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Log2: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Log10: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Sin: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Cos: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Tan: { kind: "func", params: [FLOAT64], returns: [FLOAT64] },
				Min: {
					kind: "func",
					params: [FLOAT64, FLOAT64],
					returns: [FLOAT64],
				},
				Max: {
					kind: "func",
					params: [FLOAT64, FLOAT64],
					returns: [FLOAT64],
				},
				Mod: {
					kind: "func",
					params: [FLOAT64, FLOAT64],
					returns: [FLOAT64],
				},
				Inf: { kind: "func", params: [INT], returns: [FLOAT64] },
				IsNaN: { kind: "func", params: [FLOAT64], returns: [BOOL] },
				IsInf: {
					kind: "func",
					params: [FLOAT64, INT],
					returns: [BOOL],
				},
				NaN: { kind: "func", params: [], returns: [FLOAT64] },
				// Constants (typed as func with no params for namespace member access)
				Pi: FLOAT64,
				E: FLOAT64,
				MaxFloat64: FLOAT64,
				SmallestNonzeroFloat64: FLOAT64,
				MaxInt: INT,
				MinInt: INT,
			},
		});

		// errors package
		this.globals.define("errors", {
			kind: "namespace",
			name: "errors",
			members: {
				New: { kind: "func", params: [STRING], returns: [ERROR] },
			},
		});

		// time package (partial — JS-friendly subset)
		this.globals.define("time", {
			kind: "namespace",
			name: "time",
			members: {
				Now: { kind: "func", params: [], returns: [ANY] },
				Since: { kind: "func", params: [ANY], returns: [ANY] },
				Sleep: { kind: "func", params: [ANY], returns: [VOID], async: true },
				Millisecond: INT,
				Second: INT,
				Minute: INT,
				Hour: INT,
			},
		});

		// unicode package
		const runeToStr = { kind: "func", params: [INT], returns: [BOOL] };
		const runeTrans = { kind: "func", params: [INT], returns: [INT] };
		this.globals.define("unicode", {
			kind: "namespace",
			name: "unicode",
			members: {
				IsLetter: runeToStr,
				IsDigit: runeToStr,
				IsSpace: runeToStr,
				IsUpper: runeToStr,
				IsLower: runeToStr,
				IsPunct: runeToStr,
				IsControl: runeToStr,
				IsPrint: runeToStr,
				IsGraphic: runeToStr,
				ToUpper: runeTrans,
				ToLower: runeTrans,
			},
		});

		// os package (JS-friendly subset)
		this.globals.define("os", {
			kind: "namespace",
			name: "os",
			members: {
				Exit: { kind: "func", params: [INT], returns: [VOID] },
				Args: { kind: "slice", elem: STRING },
				Getenv: { kind: "func", params: [STRING], returns: [STRING] },
				Stdout: ANY,
				Stderr: ANY,
				Stdin: ANY,
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
		// _gofront: true marks this as a GoFront package — exported identifier rules apply
		this.globals.define(pkgName, {
			kind: "namespace",
			name: pkgName,
			members,
			_gofront: true,
		});
		for (const [name, type] of types) this.types.set(name, type);
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
		let returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, outer)
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
		const recvType = this.resolveTypeNodeName(decl.recvType, outer);
		inner.define(decl.recvName, recvType);
		for (const p of decl.params) {
			inner.define(p.name, this.resolveTypeNode(p.type, outer));
		}
		let returnType = decl.returnType
			? this.resolveTypeNode(decl.returnType, outer)
			: VOID;
		const hasNamedReturns = this._injectNamedReturns(
			decl.returnType,
			inner,
			outer,
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
	_isTerminating(stmt) {
		if (!stmt) return false;
		switch (stmt.kind) {
			case "ReturnStmt":
				return true;
			case "BranchStmt":
				// panic() is in ExprStmt, not BranchStmt — but "goto" could be here
				return false;
			case "ExprStmt":
				// panic(...) is a terminating call
				if (
					stmt.expr?.kind === "CallExpr" &&
					stmt.expr?.func?.kind === "Ident" &&
					stmt.expr?.func?.name === "panic"
				)
					return true;
				return false;
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
		if (CMP_OPS.has(op)) {
			// Reject slice/map/func comparisons unless one side is nil (Go spec)
			if (op === "==" || op === "!=") {
				const lNil = isNil(lt);
				const rNil = isNil(rt);
				if (!lNil && !rNil) {
					for (const t of [lt, rt]) {
						const base = t?.kind === "named" ? t.underlying : t;
						if (
							base?.kind === "slice" ||
							base?.kind === "map" ||
							base?.kind === "func"
						) {
							this.err(`operator ${op} not defined on ${typeStr(t)}`, node);
						}
					}
				}
			}
			return BOOL;
		}
		if (LOG_OPS.has(op)) return BOOL;
		if (isAny(lt) || isAny(rt)) return ANY;
		if (isNumeric(lt) && isNumeric(rt)) {
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
		if (isString(lt) && isString(rt) && op === "+") {
			if (lt.kind === "untyped" && rt.kind === "untyped") return lt;
			if (lt.kind === "untyped") return rt;
			if (rt.kind === "untyped") return lt;
			return STRING;
		}
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

		// Untyped constants coerce to any compatible typed target
		if (isUntyped(source)) {
			if (isUntyped(target)) return; // untyped → untyped always OK
			if (target.kind === "basic") {
				// untyped int → int or float64
				if (
					source.base === "int" &&
					(target.name === "int" || target.name === "float64")
				)
					return;
				// untyped float → float64 (and int for compatibility)
				if (
					source.base === "float64" &&
					(target.name === "float64" || target.name === "int")
				)
					return;
				// untyped string → string
				if (source.base === "string" && target.name === "string") return;
				// untyped bool → bool
				if (source.base === "bool" && target.name === "bool") return;
			}
		}

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
	}

	implements(srcType, iface, _node) {
		let base = srcType.kind === "named" ? srcType.underlying : srcType;
		base = this.resolveType(base);
		if (base?.kind !== "struct") return false;
		for (const [name, required] of iface.methods) {
			const actual = base.methods?.get(name);
			if (!actual) return false;

			// Check parameter count matches
			const reqParams = required.params ?? [];
			const actParams = actual.params ?? [];
			if (reqParams.length !== actParams.length) return false;

			// Check each parameter type matches
			for (let i = 0; i < reqParams.length; i++) {
				if (typeStr(reqParams[i]) !== typeStr(actParams[i])) return false;
			}

			// Check variadic flag matches
			if (!!required.variadic !== !!actual.variadic) return false;

			// Check return types match (count and each type)
			const reqRets = required.returns ?? [];
			const actRets = actual.returns ?? [];
			if (reqRets.length !== actRets.length) return false;
			for (let i = 0; i < reqRets.length; i++) {
				if (typeStr(reqRets[i]) !== typeStr(actRets[i])) return false;
			}
		}
		return true;
	}
}

Object.assign(TypeChecker.prototype, statementCheckMethods);
Object.assign(TypeChecker.prototype, expressionCheckMethods);
