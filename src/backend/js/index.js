// Code generator: walks the typed AST and emits clean JavaScript.
//
// Split into sub-modules under backend/js/:
//   source-map.js    — VLQ encoder and source map builder
//   statements.js    — genBlock, genStmt, genFor, genSwitch, etc.
//   expressions.js   — genExpr, genCall, genCompositeLit, helpers
//
// Key design choices:
//   - Structs          → ES6 classes with a single destructured-object constructor
//   - Methods          → class instance methods
//   - Multiple returns → JS arrays  e.g. return [a, b]
//   - Destructuring    → let [a, b] = f()
//   - nil              → null
//   - Slices           → JS arrays  (append → spread, len → .length)
//   - Maps             → plain JS objects  (map[string]T)
//   - make([]T, n)     → new Array(n).fill(zeroOf(T))
//   - make(map[K]V)    → {}
//   - for range        → for...of with .entries()

import {
	computeEmbeddedStubs,
	hasDirectRecover,
	isReferenceType,
	markInBoundsIndexes,
	normalizeDefers,
	scanAddressTaken,
} from "../../lower/index.js";
import {
	BROWSER_GLOBALS,
	isComplex,
	isNumeric,
} from "../../typechecker/types.js";
import { comparesToNil, expressionGenMethods } from "./expressions.js";
import {
	HELPER_APPEND,
	HELPER_BASE64,
	HELPER_BINARY,
	HELPER_BOUNDS,
	HELPER_CDIV,
	HELPER_CMUL,
	HELPER_CRYPTO_RAND,
	HELPER_DURATION,
	HELPER_EQUAL,
	HELPER_ERROR,
	HELPER_ERROR_AS,
	HELPER_ERROR_IS,
	HELPER_ERROR_JOIN,
	HELPER_GENERICS,
	HELPER_GEQ,
	HELPER_HEX,
	HELPER_IFACE_BOX,
	HELPER_IFD,
	HELPER_IFEQ,
	HELPER_INJECT_STYLES,
	HELPER_IO_EOF,
	HELPER_JSON,
	HELPER_LEN,
	HELPER_NIL_CALL,
	HELPER_NIL_MAP,
	HELPER_NM,
	HELPER_OS,
	HELPER_PANIC,
	HELPER_PATH_CLEAN,
	HELPER_PATH_ERROR,
	HELPER_PTREQ,
	HELPER_S,
	HELPER_SCLONE,
	HELPER_SHA256,
	HELPER_SHIFT,
	HELPER_SIMD,
	HELPER_SLICE,
	HELPER_SORT_SLICE,
	HELPER_SPRINT,
	HELPER_SPRINTF,
	HELPER_STRCONV,
	HELPER_STRCONV_ERROR,
	HELPER_SV,
	HELPER_SYNC,
	HELPER_TESTING,
	HELPER_TIME_FMT,
	HELPER_TIME_PARSE,
	HELPER_VA,
	HELPER_VCLONE,
} from "./runtime.js";
import { buildSourceMap, buildWasmSourceMap } from "./source-map.js";
import { statementGenMethods } from "./statements.js";
import { stdlibGenMethods } from "./stdlib/index.js";
import { templGenMethods } from "./templ.js";

export { buildSourceMap, buildWasmSourceMap };

// Valid Go identifiers that cannot be used as JS bindings; emitted with a `$` suffix.
const JS_RESERVED = new Set([
	"arguments",
	"await",
	"catch",
	"class",
	"debugger",
	"delete",
	"do",
	"enum",
	"eval",
	"export",
	"extends",
	"finally",
	"function",
	"implements",
	"in",
	"instanceof",
	"let",
	"new",
	"null",
	"private",
	"protected",
	"public",
	"static",
	"super",
	"this",
	"throw",
	"try",
	"typeof",
	"undefined",
	"void",
	"while",
	"with",
	"yield",
]);

const jsSafeName = (n) =>
	typeof n === "string" && JS_RESERVED.has(n) ? `${n}$` : n;

// Go declarations may shadow browser globals (Task 0.9).  The JS bundle is one
// flat module scope, so such a binding gets a `$` suffix: generated code and
// other packages keep reaching the real global (`Array.from`, `Object.keys`).
const jsBindingName = (n) =>
	typeof n === "string" && BROWSER_GLOBALS.has(n) ? `${n}$` : jsSafeName(n);

// Runtime helpers by registry name, in output order.  Mark one as needed with
// `this.useHelper(name)`; `_prependHelpers` emits every marked entry.
const HELPER_MAP = [
	["len", HELPER_LEN],
	["sv", HELPER_SV],
	["slice", HELPER_SLICE],
	["append", HELPER_APPEND],
	["sliceGuard", HELPER_S],
	["sclone", HELPER_SCLONE],
	["va", HELPER_VA],
	["vclone", HELPER_VCLONE],
	["ifaceBox", HELPER_IFACE_BOX],
	["ifd", HELPER_IFD],
	["equal", HELPER_EQUAL],
	["geq", HELPER_GEQ],
	["ptreq", HELPER_PTREQ],
	["ifeq", HELPER_IFEQ],
	["cmul", HELPER_CMUL],
	["cdiv", HELPER_CDIV],
	["panicRt", HELPER_PANIC],
	["shift", HELPER_SHIFT],
	["nilCall", HELPER_NIL_CALL],
	["bounds", HELPER_BOUNDS],
	["nilMap", HELPER_NIL_MAP],
	["nm", HELPER_NM],
	["generics", HELPER_GENERICS],
	["sprintf", HELPER_SPRINTF],
	["sprint", HELPER_SPRINT],
	["error", HELPER_ERROR],
	["errorIs", HELPER_ERROR_IS],
	["errorAs", HELPER_ERROR_AS],
	["errorJoin", HELPER_ERROR_JOIN],
	["strconvError", HELPER_STRCONV_ERROR],
	["pathError", HELPER_PATH_ERROR],
	["ioEOF", HELPER_IO_EOF],
	["os", HELPER_OS],
	["strconv", HELPER_STRCONV],
	["pathClean", HELPER_PATH_CLEAN],
	["sortSlice", HELPER_SORT_SLICE],
	["timeFmt", HELPER_TIME_FMT],
	["timeParse", HELPER_TIME_PARSE],
	["duration", HELPER_DURATION],
	["testing", HELPER_TESTING],
	["sync", HELPER_SYNC],
	["cryptoRand", HELPER_CRYPTO_RAND],
	["sha256", HELPER_SHA256],
	["binary", HELPER_BINARY],
	["hex", HELPER_HEX],
	["base64", HELPER_BASE64],
	["json", HELPER_JSON],
	["simd", HELPER_SIMD],
];

// JS bodies of `//gofront:intrinsic` functions (names: INTRINSICS in
// typechecker/types.js).  The WASM backend keeps their empty body.
const JS_INTRINSICS = {};

export class CodeGen {
	// jsImports:       Map<importPath, string[]> — npm package imports to emit at top of file
	// bundledPackages: Set<string>               — GoFront package names bundled inline;
	//                                             SelectorExpr `pkg.Foo` → just `Foo`
	constructor(
		checker = null,
		jsImports = new Map(),
		bundledPackages = new Set(),
		options = {},
	) {
		this.checker = checker;
		this.target = options.target ?? "js";
		this.strict = Boolean(options.strict || this.target === "both");
		this.out = [];
		this.indent = 0;
		this.structNames = new Set();
		this.structFields = new Map();
		this.namedWrapperNames = new Set();
		this.collectedCss = [];
		this.warnings = []; // non-fatal diagnostics; the compiler prints them
		this._srcFileNames = []; // source file name per _srcFileIdx
		this.jsImports = jsImports;
		this.bundledPackages = bundledPackages;
		this.namedReturnVars = null; // names of current function's named return vars
		this._srcMappings = []; // { genLine, srcLine, srcFileIdx } for source map
		this._currentSrcFileIdx = 0; // updated as each top-level decl is generated
		this._boxedVars = new Set(); // address-taken scalar variables that need boxing
		this._jsonCodecs = new Map(); // memoized JSON encoders and decoders
		// Runtime helper usage tracking — only emit helpers that are actually used
		this._helpers = new Set();
		// Per-function context for Go value semantics (see _withFnCtx)
		this._fnCtx = null;
		// Iterator (range-over-func) context
		this._inIteratorBody = false;
		this._iterDepth = 0;
		this._iterBreakFlag = null;
		this._iterReturnFlag = null;
		this._iterReturnVar = null;
	}

	// ── Output helpers ───────────────────────────────────────────

	emit(s) {
		this.out.push(s);
	}
	line(s = "", srcLine = null) {
		if (srcLine != null) {
			this._srcMappings.push({
				genLine: this.out.length,
				srcLine: srcLine - 1, // 0-based
				srcFileIdx: this._currentSrcFileIdx,
			});
		}
		this.out.push("  ".repeat(this.indent) + s);
	}
	blank() {
		this.out.push("");
	}

	indented(fn) {
		this.indent++;
		fn();
		this.indent--;
	}

	_emitJsImports() {
		for (const [importPath, names] of this.jsImports) {
			if (names.length === 0) continue;
			this.line(`import { ${names.join(", ")} } from '${importPath}';`);
		}
		if (this.jsImports.size > 0) this.blank();
	}

	_emitTypeDecls(program, methods) {
		this._typeDeclsByName = new Map();
		for (const d of program.decls)
			if (d.kind === "TypeDecl") this._typeDeclsByName.set(d.name, d);
		for (const d of program.decls) {
			if (d.kind === "TypeDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genTypeDeclWithMethods(d, methods.get(d.name) ?? []);
				this.blank();
			}
		}
	}

	_emitVarConstDecls(program) {
		for (const d of program.decls) {
			if (d.kind === "ConstDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genConstDecl(d);
				this.blank();
			}
		}
		for (const d of program.decls) {
			if (d.kind === "VarDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genVarDecl(d);
				this.blank();
			}
		}
	}

	_callInitAndMain(initNames, program, isTest = false) {
		if (this.collectedCss.length > 0) {
			const uniqueCss = [...new Set(this.collectedCss)];
			this.line(`__injectStyles(${JSON.stringify(uniqueCss.join("\n\n"))});`);
		}
		for (const name of initNames) this.line(`${name}();`);
		if (
			!isTest &&
			program.decls.some((d) => d.kind === "FuncDecl" && d.name === "main")
		)
			this.line("main();");
	}

	generate(program, options = {}) {
		const isTest = options.isTest ?? false;
		// Defer lowering (argument/receiver hoisting, recover-target marking) is
		// idempotent and owned by the backends: the wasm path runs it via
		// `lower()`, the JS path here.
		normalizeDefers(program);
		// Strict mode: index checks the loop shape proves unnecessary are elided.
		if (this.strict) markInBoundsIndexes(program);
		if (program._filename) this._srcFileNames = [program._filename];
		// Ensure _pkgName is set on all decls (generateAll sets it for
		// multi-file; for single-file compiles we derive it from the AST).
		const pkgName = program.pkg?.name;
		if (pkgName) {
			this.pkgName = pkgName;
			for (const d of program.decls) {
				if (!d._pkgName) d._pkgName = pkgName;
			}
		}
		this._renameReservedIdents(program.decls);
		this._boxedGlobals = this._collectBoxedGlobals(program);
		this._boxedVars = new Set(this._boxedGlobals);
		this._collectResliceNames(program);
		const methods = this._collectDecls(program);
		this._emitJsImports();
		this._emitTypeDecls(program, methods);
		this._emitVarConstDecls(program);
		const initNames = this._emitFuncDecls(program);
		this._emitJsonCodecs();
		this._callInitAndMain(initNames, program, isTest);
		const prependedLines = this._prependHelpers(isTest);
		return this._finalizeOutput(prependedLines);
	}

	_finalizeOutput(prependedLines) {
		let shiftedLines = 0;
		while (this.out[0] === "") {
			this.out.shift();
			shiftedLines++;
		}
		const netShift = prependedLines - shiftedLines;
		if (netShift !== 0) {
			for (const m of this._srcMappings) {
				m.genLine = Math.max(0, m.genLine + netShift);
			}
		}
		return this.out.join("\n");
	}

	// Emits FuncDecl, TemplDecl, and CssDecl nodes; returns renamed init function names.
	_emitFuncDecls(program) {
		let initCount = 0;
		const initNames = [];
		for (const d of program.decls) {
			if (d.kind === "FuncDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				if (d.name === "init") {
					const renamed = initCount === 0 ? "init" : `init$${initCount}`;
					initNames.push(renamed);
					this.genFuncDecl(d, renamed);
					initCount++;
				} else {
					this.genFuncDecl(d);
				}
				this.blank();
			} else if (d.kind === "TemplDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genTemplDecl(d);
				this.blank();
			} else if (d.kind === "CssDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genCssDecl(d);
				this.blank();
			}
		}
		return initNames;
	}

	_renameParams(params) {
		for (const p of params ?? []) p.name = jsBindingName(p.name);
	}

	_renameNamedReturns(node) {
		for (const r of node.returnType?._namedReturns ?? [])
			r.name = jsBindingName(r.name);
	}

	_renameSignature(node) {
		this._renameParams(node.params);
		this._renameNamedReturns(node);
	}

	_renameIdentNode(node) {
		if (node._isStructKey || node._type?.kind === "builtin") return;
		node.name = node._shadowsGlobal
			? jsBindingName(node.name)
			: jsSafeName(node.name);
	}

	_renameFuncDeclNode(node) {
		node.name = jsBindingName(node.name);
		this._renameSignature(node);
	}

	_renameMethodDeclNode(node) {
		node.recvName = jsBindingName(node.recvName);
		this._renameSignature(node);
	}

	_renameDeclSpecs(node) {
		for (const spec of node.decls ?? [])
			spec.names = spec.names.map(jsBindingName);
	}

	// `document := 1` declares a binding that shadows the browser global.  A
	// `:=` redeclaration (`x, document := 2, 3`) always targets a local of the
	// same scope, which carries the same suffix.
	_renameDefineNode(node) {
		for (const l of node.lhs ?? [])
			if (l.kind === "Ident") l.name = jsBindingName(l.name);
	}

	_renameTypeSwitchNode(node) {
		node.assign = jsBindingName(node.assign);
	}

	_markStructKeys(node) {
		const isStruct =
			this._isStructType(node._type) ||
			node.elems?.some((e) => e._positionalField);
		if (!isStruct) return;
		for (const e of node.elems ?? [])
			if (e.kind === "KeyValueExpr" && e.key?.kind === "Ident")
				e.key._isStructKey = true;
	}

	static _RENAME_HANDLERS = {
		Ident: "_renameIdentNode",
		FuncDecl: "_renameFuncDeclNode",
		MethodDecl: "_renameMethodDeclNode",
		FuncLit: "_renameSignature",
		TemplDecl: "_renameSignature",
		CssDecl: "_renameSignature",
		DefineStmt: "_renameDefineNode",
		VarDecl: "_renameDeclSpecs",
		ConstDecl: "_renameDeclSpecs",
		TypeSwitchStmt: "_renameTypeSwitchNode",
		CompositeLit: "_markStructKeys",
	};

	_renameReservedIdents(node) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) this._renameReservedIdents(n);
			return;
		}
		if (node._jsRenamed) return;
		node._jsRenamed = true;
		const handler = CodeGen._RENAME_HANDLERS[node.kind];
		if (handler) this[handler](node);
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			this._renameReservedIdents(node[key]);
		}
	}

	// Collects struct names, method map, and named wrapper names from program decls.
	// Returns the method map (typeName → MethodDecl[]).
	_collectStructNames(program) {
		// Go-compiled variadic functions and methods: a `f(xs...)` call to one
		// passes the slice itself (see `_genCallArgs`, `_emitParamCopies`).
		this.variadicFns = new Set();
		for (const d of program.decls) {
			const last = d.params?.[d.params.length - 1];
			if (!last?.variadic) continue;
			if (d.kind === "FuncDecl") this.variadicFns.add(d.name);
			else if (d.kind === "MethodDecl")
				this.variadicFns.add(`${d.recvType.name}.${d.name}`);
		}
		for (const d of program.decls) {
			if (d.kind === "TypeDecl" && d.type.kind === "StructType")
				this.structNames.add(d.name);
		}
		// Structs from bundled GoFront packages are inlined under their bare name.
		// Skip aliases (key differs from the type's own name) — no class is emitted for them.
		if (this.checker) {
			for (const [name, t] of this.checker.types) {
				if (name.includes(".") || t?.name !== name) continue;
				if (t.kind === "named" && t.underlying?.kind === "struct")
					this.structNames.add(name);
			}
		}
	}

	_collectMethodMap(program) {
		const methods = new Map();
		this.nilSafeMethods = new Set();
		for (const d of program.decls) {
			if (d.kind === "MethodDecl") {
				const name = d.recvType.name;
				if (!methods.has(name)) methods.set(name, []);
				methods.get(name).push(d);
				if (d.recvPointer && comparesToNil(d.body, d.recvName))
					this.nilSafeMethods.add(`${name}.${d.name}`);
			}
		}
		return methods;
	}

	_collectNamedWrappers(program, methods) {
		for (const d of program.decls) {
			if (
				d.kind === "TypeDecl" &&
				d.type.kind !== "StructType" &&
				d.type.kind !== "InterfaceType" &&
				(methods.get(d.name) ?? []).length > 0
			) {
				this.namedWrapperNames.add(d.name);
			}
		}
	}

	_collectDecls(program) {
		this._collectStructNames(program);
		const methods = this._collectMethodMap(program);
		this._collectNamedWrappers(program, methods);
		return methods;
	}

	/** Marks a runtime helper (key of HELPER_MAP) as needed by the output. */
	useHelper(name) {
		this._helpers.add(name);
		if (
			name === "strconvError" ||
			name === "pathError" ||
			name === "ioEOF" ||
			name === "base64" ||
			name === "hex" ||
			name === "json"
		) {
			this._helpers.add("error");
		}
		if (name === "json") {
			this.useHelper("base64");
		}
		if (name === "os") {
			this.useHelper("ioEOF");
			this._helpers.add("error");
		}
		if (name === "append") this.useHelper("slice");
		if (name === "sprint") this._helpers.add("sprintf");
		if (name === "slice") this._helpers.add("sv");
		if (name === "binary") {
			this.useHelper("ioEOF");
			this._helpers.add("error");
		}
	}

	_prependHelpers(isTest = false) {
		if (isTest || this._helpers.has("testing")) {
			this.useHelper("sprintf");
			this.useHelper("testing");
		}
		const helpers = [];
		if (this.collectedCss.length > 0) helpers.push(HELPER_INJECT_STYLES);
		for (const [name, src] of HELPER_MAP) {
			if (this._helpers.has(name)) helpers.push(src);
		}
		if (helpers.length > 0) {
			const helperLines = helpers.flatMap((h) => h.split("\n"));
			helperLines.push("");
			this.out.unshift(...helperLines);
			return helperLines.length;
		}
		return 0;
	}

	// Generate a single bundle from multiple programs (same-package multi-file).
	// Annotates each decl with its source file index before merging.
	generateAll(programs, options = {}) {
		this._srcFileNames = programs.map((p) => p._filename ?? null);
		for (let i = 0; i < programs.length; i++) {
			for (const decl of programs[i].decls) {
				decl._srcFileIdx = i;
				decl._pkgName = programs[i].pkg?.name;
			}
		}
		const merged = {
			pkg: programs[0]?.pkg,
			decls: programs.flatMap((p) => p.decls),
		};
		return this.generate(merged, options);
	}

	// Records a non-fatal diagnostic at `node` ("main.go at line 3:5: msg").
	_warn(msg, node) {
		const file = this._srcFileNames[this._currentSrcFileIdx ?? 0];
		const line = node?.line ?? node?._line;
		const at = line ? `at line ${line}:${node.col ?? node._col ?? 1}` : "";
		const loc = [file, at].filter(Boolean).join(" ");
		this.warnings.push(loc ? `${loc}: ${msg}` : msg);
	}

	getCss() {
		return [...new Set(this.collectedCss)].join("\n\n");
	}

	getMappings() {
		return this._srcMappings;
	}

	// Returns a source map JSON string for the last generate() call.
	// sources: string[] of source filenames (relative to the output file).
	// sourcesContent: string[] of original file contents (embedded for DevTools breakpoints).
	getSourceMap(sources, sourcesContent) {
		const srcArray = Array.isArray(sources) ? sources : [sources];
		return buildSourceMap(srcArray, this._srcMappings, sourcesContent);
	}

	// ── Type declarations ────────────────────────────────────────

	// `type S Base` with Base a struct declared in this package: the struct
	// AST S inherits its fields from, or null.
	_definedStructAst(decl) {
		if (decl.isAlias || decl.typeParams) return null;
		if (this.checker?.types.get(decl.name)?.underlying?.kind !== "struct")
			return null;
		let t = decl.type;
		for (let depth = 0; depth < 16 && t; depth++) {
			if (t.kind === "StructType") return t;
			if (t.kind !== "TypeName" && t.kind !== "Ident") return null;
			const next = this._typeDeclsByName?.get(t.name);
			if (!next || next.isAlias) return null;
			t = next.type;
		}
		return null;
	}

	genTypeDeclWithMethods(decl, methodDecls) {
		const definedStruct =
			decl.type.kind === "StructType" ? null : this._definedStructAst(decl);
		if (decl.type.kind === "StructType") {
			this.genStruct(decl.name, decl.type, methodDecls);
		} else if (definedStruct) {
			this.genStruct(decl.name, definedStruct, methodDecls);
		} else if (decl.type.kind === "InterfaceType") {
			// Interfaces are compile-time only — no JS output needed.
			this.line(`// interface ${decl.name} (compile-time only)`);
		} else if (methodDecls.length > 0) {
			// Named non-struct type with methods — emit an ES6 wrapper class.
			this.genNamedTypeClass(decl.name, methodDecls);
		} else {
			this.line(`// type ${decl.name} = ${this.typeComment(decl.type)}`);
		}
	}

	genNamedTypeClass(name, methodDecls) {
		const namedType = this.checker?.types.get(name);
		const field = this._namedBoxField(namedType?.underlying);
		// Values of the type stay raw (number, string, array, map, function); the
		// class is only the box used when a value is stored in an interface.
		// Methods are static (`T.$M(recv, ...)`) so raw values can call them.
		this.line(`class ${name} {`);
		this.indented(() => {
			this.line(`constructor(${field}) { this.${field} = ${field}; }`);
			this.line(`__gfUnbox() { return this.${field}; }`);
			for (const m of methodDecls) {
				this.blank();
				this.genMethod(m, { staticNamed: true });
				if (!m.recvPointer) {
					this.line(
						`${m.name}(...__a) { return ${name}.$${m.name}(this.${field}, ...__a); }`,
					);
				}
			}
		});
		this.line("}");
		// Box for *T in an interface. It also proxies `.value` to the pointer, so
		// helpers that write through a pointer argument (errors.As, json.Unmarshal)
		// keep working. Pointer methods get the { value } box, value methods its value.
		this.line(`class ${name}$Ptr {`);
		this.indented(() => {
			this.line("constructor(_p) { this._p = _p; }");
			this.line("__gfUnbox() { return this._p; }");
			this.line("get value() { return this._p.value; }");
			this.line("set value(v) { this._p.value = v; }");
			for (const m of methodDecls) {
				const recv = m.recvPointer ? "this._p" : "this._p.value";
				this.line(
					`${m.name}(...__a) { return ${name}.$${m.name}(${recv}, ...__a); }`,
				);
			}
		});
		this.line("}");
	}

	_namedBoxField(underlying) {
		if (underlying?.kind === "func") return "_fn";
		if (underlying?.kind === "map") return "_map";
		return "_items";
	}

	// Box/dispatch info for a named non-struct type with methods, or null.
	_namedBoxInfo(type) {
		if (type?.kind !== "named") return null;
		const u = type.underlying;
		if (!u || u.kind === "struct" || u.kind === "interface") return null;
		const methods = type.methods ?? type._generic?.methods;
		if (!methods || methods.size === 0) return null;
		if (![...methods.values()].some((m) => Object.hasOwn(m ?? {}, "_ptrRecv")))
			return null;
		const cls = this._dequalify(type.name).replace(/\[.*$/, "");
		return { cls, field: this._namedBoxField(u), methods };
	}

	_collectStructFields(name, structTypeAst) {
		const fields = [];
		if (this.checker) {
			const resolved = this.checker.types.get(name)?.underlying;
			if (resolved?.kind === "struct") {
				for (const [fName, fType] of resolved.fields.entries())
					fields.push({ name: fName, zero: this.zeroValueForType(fType) });
			}
		} else {
			for (const f of structTypeAst.fields) {
				if (f.embedded) continue;
				const zero = this.zeroValueForTypeNode(f.type);
				for (const n of f.names) fields.push({ name: n, zero });
			}
		}
		return fields;
	}

	getStructFields(typeName) {
		if (this.structFields.has(typeName)) return this.structFields.get(typeName);
		if (!this.checker) return [];
		const resolved = this.checker.types.get(typeName)?.underlying;
		if (resolved?.kind === "struct") {
			const fields = [];
			// Cached per type name, so never bound to the current generic body.
			this._withTypeParamZeros(null, () => {
				for (const [name, type] of resolved.fields.entries())
					fields.push({ name, zero: this.zeroValueForType(type) });
			});
			this.structFields.set(typeName, fields);
			return fields;
		}
		return [];
	}

	_genStructConstructor(fields) {
		if (fields.length === 0) {
			this.line("constructor() {}");
			return;
		}
		const binding = (f) => `${f.name}$`;
		const params = fields.map((f) => `${binding(f)} = ${f.zero}`).join(", ");
		this.line(`constructor(${params}) {`);
		this.indented(() => {
			const first = binding(fields[0]);
			// Legacy `new T({...})` support; only unambiguous when field 0 is a primitive.
			if (/^(0|""|false)$/.test(fields[0].zero)) {
				const pattern = fields
					.map((f) => `${f.name}: ${binding(f)} = ${f.zero}`)
					.join(", ");
				this.line(
					`if (arguments.length === 1 && typeof ${first} === "object" && ${first} !== null && ${first}.constructor === Object) ({ ${pattern} } = ${first});`,
				);
			}
			for (const f of fields) {
				this.line(`this.${f.name} = ${binding(f)};`);
			}
		});
		this.line("}");
	}

	// A generic struct's constructor takes the instance's zero-value factories
	// after the fields (see HELPER_GENERICS). A field whose zero value depends
	// on a type parameter starts at it when its argument is undefined.
	_genTypeParamBindings(tpNames, tz) {
		tpNames.forEach((n, i) => {
			this.line(`const $z_${n} = ${tz}?.[${i}] ?? __zn;`);
		});
	}

	_genGenericStructConstructor(fields, tpNames) {
		const usesTz = (f) => f.zero.includes("$z_");
		const params = fields.map((f) =>
			usesTz(f) ? `${f.name}$` : `${f.name}$ = ${f.zero}`,
		);
		this.line(`constructor(${[...params, "$tz"].join(", ")}) {`);
		this.indented(() => {
			this.line("this[__tz] = $tz;");
			if (fields.some(usesTz)) this._genTypeParamBindings(tpNames, "$tz");
			for (const f of fields) {
				const v = usesTz(f)
					? `${f.name}$ === undefined ? ${f.zero} : ${f.name}$`
					: `${f.name}$`;
				this.line(`this.${f.name} = ${v};`);
			}
		});
		this.line("}");
	}

	// JS object keys are strings: a struct used as a map key becomes its Go
	// `%v` text (`{1 x}`), so equal values share a key and fmt prints it as Go does.
	_genStructKeyString(name, fields) {
		if (fields.some((f) => f.name === "toString")) return;
		const resolved = this.checker?.types.get(name)?.underlying;
		const parts = fields.map((f) => {
			const base = this._aggregateBase(resolved?.fields?.get(f.name));
			return base?.kind === "array"
				? `"[" + this.${f.name}.join(" ") + "]"`
				: `this.${f.name}`;
		});
		this.line(
			`toString() { return "{" + [${parts.join(", ")}].join(" ") + "}"; }`,
		);
	}

	_genStructClone(name, structTypeAst, fields) {
		const resolved = this.checker?.types.get(name)?.underlying;
		const astTypes = new Map();
		for (const f of structTypeAst?.fields ?? [])
			for (const n of f.names ?? []) astTypes.set(n, f.type);
		const tpNames = this._genericTypeParamNames(name);
		const prevZeros = this._typeParamZeros;
		this._typeParamZeros = tpNames
			? new Map(tpNames.map((n, i) => [n, `this[__tz]?.[${i}]`]))
			: null;
		let args;
		try {
			args = fields.map((f) => {
				const t =
					resolved?.fields?.get(f.name) ??
					this._typeFromNode(astTypes.get(f.name));
				return this._cloneJs(t, `this.${f.name}`);
			});
		} finally {
			this._typeParamZeros = prevZeros;
		}
		if (tpNames) args.push("this[__tz]");
		this.blank();
		this.line(`__clone() { return new ${name}(${args.join(", ")}); }`);
	}

	_structDefinesValue(name, fields, methodDecls) {
		if (fields.some((f) => f.name === "value")) return true;
		if (methodDecls.some((m) => m.name === "value")) return true;
		const resolved = this.checker?.types.get(name)?.underlying;
		return Boolean(
			resolved?.fields?.has?.("value") || resolved?.methods?.has?.("value"),
		);
	}

	// Type parameter names of generic type `name`, or null.
	_genericTypeParamNames(name) {
		const generic = this.checker?.types.get(name)?._generic;
		if (!generic?.typeParams?.length || generic.isAlias) return null;
		return generic.typeParams.map((tp) => tp.name);
	}

	genStruct(name, structTypeAst, methodDecls) {
		const tpNames = this._genericTypeParamNames(name);
		if (tpNames) this.useHelper("generics");
		const fields = this._withTypeParamZeros(tpNames, () =>
			this._collectStructFields(name, structTypeAst),
		);
		this.structFields.set(
			name,
			tpNames
				? this._withTypeParamZeros(null, () =>
						this._collectStructFields(name, structTypeAst),
					)
				: fields,
		);
		this.line(`class ${name} {`);
		this.indented(() => {
			if (tpNames) this._genGenericStructConstructor(fields, tpNames);
			else this._genStructConstructor(fields);
			for (const m of methodDecls) {
				this.blank();
				this.genMethod(m);
			}
			this._genEmbeddedMethodStubs(name, methodDecls);
			this._genStructClone(name, structTypeAst, fields);
			this._genStructKeyString(name, fields);
		});
		this.line("}");
		// Lets generic `p.value` dereferences resolve to the struct itself.
		if (!this._structDefinesValue(name, fields, methodDecls)) {
			this.line(
				`Object.defineProperty(${name}.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });`,
			);
		}
		this._genFmtClassMeta(name, methodDecls);
	}

	_emitJsonCodecs() {
		if (!this._jsonCodecs || this._jsonCodecs.size === 0) return;
		for (const [, code] of this._jsonCodecs) {
			this.line(code);
			this.blank();
		}
	}

	// A promoted method runs on the embedded value (`this.In`), so it and the
	// outer struct's promoted-field accesses see the same storage.  Embedded
	// types that are not compiled Go structs keep the borrowed-`this` form.
	_embedStub(method, embedName) {
		const call = this.structNames.has(embedName)
			? `this.${embedName}.${method}(...__a)`
			: `${embedName}.prototype.${method}.call(this, ...__a)`;
		return `${method}(...__a) { return ${call}; }`;
	}

	_genSingleEmbedStubs(embed, declared) {
		const embedName = embed.kind === "named" ? embed.name : null;
		if (!embedName) return;
		const embedBase = embed.kind === "named" ? embed.underlying : embed;
		if (embedBase?.kind !== "struct" || !embedBase.methods) return;
		for (const [mName] of embedBase.methods.entries()) {
			if (!declared.has(mName)) {
				this.blank();
				this.line(this._embedStub(mName, embedName));
			}
		}
	}

	_genEmbeddedMethodStubs(name, methodDecls) {
		const stubs = computeEmbeddedStubs(name, methodDecls, this.checker);
		for (const stub of stubs) {
			this.blank();
			this.line(this._embedStub(stub.methodName, stub.embedName));
		}
	}

	genMethod(decl, opts = null) {
		const prevFileIdx = this._currentSrcFileIdx;
		if (decl._srcFileIdx != null) this._currentSrcFileIdx = decl._srcFileIdx;
		const staticNamed = Boolean(opts?.staticNamed);
		const recvParam =
			decl.recvName && decl.recvName !== "_" ? decl.recvName : "__recv";
		this.line(
			this._methodSignature(decl, staticNamed, recvParam),
			decl._line ?? null,
		);
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set(this._boxedGlobals);
		this._scanAddressTaken(decl.body);
		// Methods of a generic struct read its type arguments from the
		// instance; named non-struct types have no instance to carry them.
		const tpNames = staticNamed
			? null
			: this._genericTypeParamNames(decl.recvType?.name);
		this._withTypeParamZeros(tpNames, () =>
			this._genMethodBody(decl, staticNamed, recvParam, tpNames),
		);
		this._boxedVars = prevBoxed;
		this.line("}");
		this._currentSrcFileIdx = prevFileIdx;
	}

	_genMethodBody(decl, staticNamed, recvParam, tpNames) {
		this._withFnCtx(decl.body, () =>
			this.indented(() => {
				if (tpNames) this._genTypeParamBindings(tpNames, "this[__tz]");
				if (decl.recvName) this._fnCtx.params.add(decl.recvName);
				if (!staticNamed && decl.recvName && decl.recvName !== "_") {
					this.line(`let ${decl.recvName} = ${this._receiverValue(decl)};`);
				}
				if (staticNamed && this._boxedVars.has(recvParam)) {
					this.line(`${recvParam} = { value: ${recvParam} };`);
				}
				this._emitParamCopies(decl.params);
				this._withNamedReturns(decl, () => this._genBody(decl.body, decl));
			}),
		);
	}

	// JS parameter names; a variadic Go parameter is a rest parameter.
	_paramNames(params) {
		return params.map((p, i) =>
			p.variadic && i === params.length - 1 ? `...${p.name}` : p.name,
		);
	}

	// Static methods of named non-struct types take the receiver as first parameter.
	_methodSignature(decl, staticNamed, recvParam) {
		const params = this._paramNames(decl.params);
		const asyncPrefix = decl.async ? "async " : "";
		if (!staticNamed)
			return `${asyncPrefix}${decl.name}(${params.join(", ")}) {`;
		return `static ${asyncPrefix}$${decl.name}(${[recvParam, ...params].join(", ")}) {`;
	}

	// Value receivers are copies in Go; only materialize the copy when the body mutates it.
	_receiverValue(decl) {
		const name = decl.recvName;
		if (decl.recvPointer || !this.structNames.has(decl.recvType.name)) {
			this._markOwnership(name, false);
			return "this";
		}
		if (this._fnMutates(name)) {
			this._markOwnership(name, true);
			return "this.__clone()";
		}
		this._markOwnership(name, false);
		return "this";
	}

	// Named non-struct values are kept raw in the JS backend, so there is no
	// wrapper field to unwrap any more; kept for call-site compatibility.
	_namedWrapperField(_type, _expr = null) {
		return null;
	}

	// ── Function declarations ────────────────────────────────────

	genFuncDecl(decl, nameOverride) {
		const tpNames = decl.typeParams?.length
			? decl.typeParams.map((tp) => tp.name)
			: null;
		this._withTypeParamZeros(tpNames, () =>
			this._genFuncDecl(decl, nameOverride, tpNames),
		);
	}

	// A generic function takes one zero-value factory per type parameter
	// before its parameters (see HELPER_GENERICS).
	_genFuncDecl(decl, nameOverride, tpNames) {
		const name = nameOverride ?? decl.name;
		const params = [
			...(tpNames ?? []).map((n) => `$z_${n}`),
			...this._paramNames(decl.params),
		].join(", ");
		const asyncPrefix = decl.async ? "async " : "";
		const srcLine = decl._line ?? null;
		this.line(`${asyncPrefix}function ${name}(${params}) {`, srcLine);
		if (decl.intrinsic) {
			const args = decl.params.map((p) => p.name);
			this.indented(() => this.line(JS_INTRINSICS[decl.intrinsic](args)));
			this.line("}");
			return;
		}
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set(this._boxedGlobals);
		this._scanAddressTaken(decl.body);
		this._withFnCtx(decl.body, () =>
			this.indented(() => {
				this._emitParamCopies(decl.params);
				this._withNamedReturns(decl, () => this._genBody(decl.body, decl));
			}),
		);
		this._boxedVars = prevBoxed;
		this.line("}");
	}

	_withNamedReturns(decl, fn) {
		const prevDecl = this._currentDecl;
		this._currentDecl = decl;
		const named = decl.returnType?._namedReturns;
		const prev = this.namedReturnVars;
		if (named) {
			// Emit zero-value declarations for named return vars
			for (let i = 0; i < named.length; i++) {
				const { name, type } = named[i];
				const varName = !name || name === "_" ? `__ret_blank$${i}` : name;
				this._markOwnership(varName, true);
				this._fnCtx?.params.add(varName);
				this.line(`let ${varName} = ${this.zeroValueForTypeNode(type)};`);
			}
			this.namedReturnVars = named.map((r, i) =>
				!r.name || r.name === "_" ? `__ret_blank$${i}` : r.name,
			);
		} else {
			this.namedReturnVars = null;
		}
		fn();
		this.namedReturnVars = prev;
		this._currentDecl = prevDecl;
	}

	// Emit a function body, wrapping in try/catch/finally for defer if needed.
	// `fnNode` is the enclosing FuncDecl/MethodDecl/FuncLit; it decides whether
	// the recover-arming prologue is needed (see HELPER_PANIC).
	_genBody(body, fnNode = null) {
		const prevRecoverOk = this._recoverOkInScope;
		this._recoverOkInScope = false;
		const isTarget = Boolean(fnNode?._isDeferTarget);
		const forwards = isTarget && Boolean(fnNode._deferForward);
		if (!forwards && (isTarget || hasDirectRecover(body))) {
			this.useHelper("panicRt");
			this.line(
				"const __recoverOk = __gopanic.armed; __gopanic.armed = false;",
			);
			this._recoverOkInScope = true;
		}
		if (!body._hasDefer) {
			this.genBlock(body);
			this._recoverOkInScope = prevRecoverOk;
			return;
		}
		this.useHelper("panicRt");
		this.line("const __defers = [];");
		this.line("const __frame = { pn: null };");
		this.line("try {");
		this.indented(() => this.genBlock(body));
		this.line("} catch (__err) {");
		this.indented(() => {
			this.line("__frame.pn = { err: __err, recovered: false };");
			this.line("__gopanic.stack.push(__frame.pn);");
		});
		this.line("} finally {");
		this.indented(() => {
			// Runs defers LIFO and rethrows an unrecovered panic.
			this.line("__runDefers(__defers, __frame);");
			if (this.namedReturnVars?.length > 0) {
				const vars = this.namedReturnVars;
				this.line(
					vars.length === 1
						? `return ${vars[0]};`
						: `return [${vars.join(", ")}];`,
				);
			}
		});
		this.line("}");
		// If a recover() cleared the panic, execution reaches here.
		// Return named return vars so deferred mutations are visible to the caller.
		if (this.namedReturnVars?.length > 0) {
			const vars = this.namedReturnVars;
			this.line(
				vars.length === 1
					? `return ${vars[0]};`
					: `return [${vars.join(", ")}];`,
			);
		} else if (this._currentDecl?.returnType) {
			this.line(
				`return ${this.zeroValueForTypeNode(this._currentDecl.returnType)};`,
			);
		}
		this._recoverOkInScope = prevRecoverOk;
	}

	// Package-level variables whose address is taken anywhere (`&g`, `g.Inc()`
	// on a pointer-receiver method) are boxed like address-taken locals.
	_collectBoxedGlobals(program) {
		const names = new Set();
		for (const d of program.decls)
			if (d.kind === "VarDecl")
				for (const spec of d.decls) for (const n of spec.names) names.add(n);
		const boxed = new Set();
		if (names.size === 0) return boxed;
		for (const n of this._scanAddressTaken(program.decls, new Set()))
			if (names.has(n)) boxed.add(n);
		return boxed;
	}

	// Scan AST node for _addressTaken idents on scalars and populate _boxedVars.
	// A pointer-receiver method call on a named non-struct local (`l.Set(5)`)
	// takes the variable's address too, so the variable must be boxed.
	_scanAddressTaken(node, into = this._boxedVars) {
		scanAddressTaken(node, into);
		const visit = (n) => {
			if (!n || typeof n !== "object") return;
			if (Array.isArray(n)) {
				for (const item of n) visit(item);
				return;
			}
			if (n.kind === "CallExpr" && n.func?.kind === "SelectorExpr") {
				const recv = n.func.expr;
				if (
					recv?.kind === "Ident" &&
					this._namedPtrMethodOn(recv._type, n.func.field)
				)
					into.add(recv.name);
			}
			for (const key of Object.keys(n)) {
				if (key.startsWith("_") || key === "kind") continue;
				visit(n[key]);
			}
		};
		visit(node);
		return into;
	}

	_namedPtrMethodOn(type, method) {
		const info = this._namedBoxInfo(type);
		return Boolean(info?.methods.get(method)?._ptrRecv);
	}

	_isReferenceType(t) {
		return isReferenceType(t);
	}

	// ── Variable / const declarations ────────────────────────────

	genVarDecl(decl) {
		for (const spec of decl.decls) {
			if (spec.value) {
				const paired = spec.value.length === spec.names.length;
				const vals = spec.value.map((v, i) => {
					const js = paired
						? this._genDeclValue(spec.names[i], v)
						: this.genExpr(v);
					// Wrap numeric values assigned to complex-typed vars
					if (
						spec.type?.name === "complex128" ||
						spec.type?.name === "complex64"
					) {
						if (
							!isComplex(v._type) &&
							(isNumeric(v._type) || v._type?.kind === "untyped")
						) {
							return `{ re: ${js}, im: 0 }`;
						}
					}
					return js;
				});
				this._emitVarBindings(spec.names, vals, paired);
			} else {
				const zero = spec.type ? this.zeroValueForTypeNode(spec.type) : "null";
				for (const name of spec.names) {
					if (name === "_") continue;
					this._markOwnership(name, true);
					const val = this._boxedVars.has(name) ? `{ value: ${zero} }` : zero;
					this.line(`let ${name} = ${val};`);
				}
			}
		}
	}

	// `var a = v` / `var a, b = v1, v2` / `var a, b = f()`, boxing address-taken names.
	_emitVarBindings(names, vals, paired) {
		if (names.length === 1 && names[0] === "_") {
			// A blank binding only runs its initialiser (`var _ = f()` may repeat).
			this.line(`void (${vals[0]});`);
			return;
		}
		if (names.length === 1) {
			const val = this._boxedVars.has(names[0])
				? `{ value: ${vals[0]} }`
				: vals[0];
			this.line(`let ${names[0]} = ${val};`);
			return;
		}
		const rhs = paired ? `[${vals.join(", ")}]` : vals[0];
		const targets = names.map((n) => (n === "_" ? "" : n));
		this.line(`let [${targets.join(", ")}] = ${rhs};`);
		this._boxDeclaredNames(names);
	}

	genConstDecl(decl) {
		for (const spec of decl.decls) {
			const vals = spec.value.map((v) => this.genExpr(v));
			if (spec.names.length === 1) {
				this.line(`const ${spec.names[0]} = ${vals[0]};`);
			} else {
				this.line(`const [${spec.names.join(", ")}] = [${vals.join(", ")}];`);
			}
		}
	}

	// ── Statements ───────────────────────────────────────────────
}

Object.assign(CodeGen.prototype, statementGenMethods);
Object.assign(CodeGen.prototype, expressionGenMethods);
Object.assign(CodeGen.prototype, stdlibGenMethods);
Object.assign(CodeGen.prototype, templGenMethods);
