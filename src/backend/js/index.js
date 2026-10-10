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
	normalizeDefers,
	scanAddressTaken,
} from "../../lower/index.js";
import { isComplex, isNumeric } from "../../typechecker/types.js";
import { expressionGenMethods } from "./expressions.js";
import {
	HELPER_APPEND,
	HELPER_CDIV,
	HELPER_CMUL,
	HELPER_EQUAL,
	HELPER_ERROR,
	HELPER_ERROR_IS,
	HELPER_IFACE_BOX,
	HELPER_INJECT_STYLES,
	HELPER_LEN,
	HELPER_NIL_CALL,
	HELPER_PANIC,
	HELPER_PATH_CLEAN,
	HELPER_S,
	HELPER_SCLONE,
	HELPER_SORT_SLICE,
	HELPER_SPRINTF,
	HELPER_STRCONV,
	HELPER_TESTING,
	HELPER_TIME_FMT,
	HELPER_TIME_PARSE,
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

// Runtime helpers by registry name, in output order.  Mark one as needed with
// `this.useHelper(name)`; `_prependHelpers` emits every marked entry.
const HELPER_MAP = [
	["len", HELPER_LEN],
	["append", HELPER_APPEND],
	["sliceGuard", HELPER_S],
	["sclone", HELPER_SCLONE],
	["ifaceBox", HELPER_IFACE_BOX],
	["equal", HELPER_EQUAL],
	["cmul", HELPER_CMUL],
	["cdiv", HELPER_CDIV],
	["panicRt", HELPER_PANIC],
	["nilCall", HELPER_NIL_CALL],
	["sprintf", HELPER_SPRINTF],
	["error", HELPER_ERROR],
	["errorIs", HELPER_ERROR_IS],
	["strconv", HELPER_STRCONV],
	["pathClean", HELPER_PATH_CLEAN],
	["sortSlice", HELPER_SORT_SLICE],
	["timeFmt", HELPER_TIME_FMT],
	["timeParse", HELPER_TIME_PARSE],
	["testing", HELPER_TESTING],
];

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
		this.jsImports = jsImports;
		this.bundledPackages = bundledPackages;
		this.namedReturnVars = null; // names of current function's named return vars
		this._srcMappings = []; // { genLine, srcLine, srcFileIdx } for source map
		this._currentSrcFileIdx = 0; // updated as each top-level decl is generated
		this._boxedVars = new Set(); // address-taken scalar variables that need boxing
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
		// Ensure _pkgName is set on all decls (generateAll sets it for
		// multi-file; for single-file compiles we derive it from the AST).
		const pkgName = program.pkg?.name;
		if (pkgName) {
			for (const d of program.decls) {
				if (!d._pkgName) d._pkgName = pkgName;
			}
		}
		this._renameReservedIdents(program.decls);
		const methods = this._collectDecls(program);
		this._emitJsImports();
		this._emitTypeDecls(program, methods);
		this._emitVarConstDecls(program);
		const initNames = this._emitFuncDecls(program);
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
		for (const p of params ?? []) p.name = jsSafeName(p.name);
	}

	_renameNamedReturns(node) {
		for (const r of node.returnType?._namedReturns ?? [])
			r.name = jsSafeName(r.name);
	}

	_renameSignature(node) {
		this._renameParams(node.params);
		this._renameNamedReturns(node);
	}

	_renameIdentNode(node) {
		if (!node._isStructKey && node._type?.kind !== "builtin")
			node.name = jsSafeName(node.name);
	}

	_renameFuncDeclNode(node) {
		node.name = jsSafeName(node.name);
		this._renameSignature(node);
	}

	_renameMethodDeclNode(node) {
		node.recvName = jsSafeName(node.recvName);
		this._renameSignature(node);
	}

	_renameDeclSpecs(node) {
		for (const spec of node.decls ?? [])
			spec.names = spec.names.map(jsSafeName);
	}

	_renameTypeSwitchNode(node) {
		node.assign = jsSafeName(node.assign);
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
		for (const d of program.decls) {
			if (d.kind === "MethodDecl") {
				const name = d.recvType.name;
				if (!methods.has(name)) methods.set(name, []);
				methods.get(name).push(d);
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
		for (let i = 0; i < programs.length; i++) {
			for (const decl of programs[i].decls) {
				decl._srcFileIdx = i;
				decl._pkgName = programs[i].pkg?.name;
			}
		}
		const merged = { decls: programs.flatMap((p) => p.decls) };
		return this.generate(merged, options);
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

	genTypeDeclWithMethods(decl, methodDecls) {
		if (decl.type.kind === "StructType") {
			this.genStruct(decl.name, decl.type, methodDecls);
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
		const underlying = namedType?.underlying;
		let field, ctorDefault;
		if (underlying?.kind === "func") {
			field = "_fn";
			ctorDefault = "null";
		} else if (underlying?.kind === "map") {
			field = "_map";
			ctorDefault = "{}";
		} else {
			field = "_items";
			ctorDefault = "[]";
		}
		this.line(`class ${name} {`);
		this.indented(() => {
			this.line(
				`constructor(${field} = ${ctorDefault}) { this.${field} = ${field}; }`,
			);
			for (const m of methodDecls) {
				this.blank();
				this.genMethod(m, field);
			}
		});
		this.line("}");
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
			for (const [name, type] of resolved.fields.entries()) {
				fields.push({ name, zero: this.zeroValueForType(type) });
			}
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
					`if (typeof ${first} === "object" && ${first} !== null && ${first}.constructor === Object) ({ ${pattern} } = ${first});`,
				);
			}
			for (const f of fields) {
				this.line(`this.${f.name} = ${binding(f)};`);
			}
		});
		this.line("}");
	}

	_genStructClone(name, structTypeAst, fields) {
		const resolved = this.checker?.types.get(name)?.underlying;
		const astTypes = new Map();
		for (const f of structTypeAst?.fields ?? [])
			for (const n of f.names ?? []) astTypes.set(n, f.type);
		const args = fields.map((f) => {
			const t =
				resolved?.fields?.get(f.name) ??
				this._typeFromNode(astTypes.get(f.name));
			return this._cloneJs(t, `this.${f.name}`);
		});
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

	genStruct(name, structTypeAst, methodDecls) {
		const fields = this._collectStructFields(name, structTypeAst);
		this.structFields.set(name, fields);
		this.line(`class ${name} {`);
		this.indented(() => {
			this._genStructConstructor(fields);
			for (const m of methodDecls) {
				this.blank();
				this.genMethod(m);
			}
			this._genEmbeddedMethodStubs(name, methodDecls);
			this._genStructClone(name, structTypeAst, fields);
		});
		this.line("}");
		// Lets generic `p.value` dereferences resolve to the struct itself.
		if (!this._structDefinesValue(name, fields, methodDecls)) {
			this.line(
				`Object.defineProperty(${name}.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });`,
			);
		}
	}

	_genSingleEmbedStubs(embed, declared) {
		const embedName = embed.kind === "named" ? embed.name : null;
		if (!embedName) return;
		const embedBase = embed.kind === "named" ? embed.underlying : embed;
		if (embedBase?.kind !== "struct" || !embedBase.methods) return;
		for (const [mName] of embedBase.methods.entries()) {
			if (!declared.has(mName)) {
				this.blank();
				this.line(
					`${mName}(...__a) { return ${embedName}.prototype.${mName}.call(this, ...__a); }`,
				);
			}
		}
	}

	_genEmbeddedMethodStubs(name, methodDecls) {
		const stubs = computeEmbeddedStubs(name, methodDecls, this.checker);
		for (const stub of stubs) {
			this.blank();
			this.line(
				`${stub.methodName}(...__a) { return ${stub.embedName}.prototype.${stub.methodName}.call(this, ...__a); }`,
			);
		}
	}

	genMethod(decl, recvField = null) {
		const prevFileIdx = this._currentSrcFileIdx;
		if (decl._srcFileIdx != null) this._currentSrcFileIdx = decl._srcFileIdx;
		const params = decl.params.map((p) => p.name).join(", ");
		const asyncPrefix = decl.async ? "async " : "";
		this.line(`${asyncPrefix}${decl.name}(${params}) {`, decl._line ?? null);
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set();
		this._scanAddressTaken(decl.body);
		const prevUnwrapped = this._unwrappedRecv;
		this._withFnCtx(decl.body, () =>
			this.indented(() => {
				if (decl.recvName && decl.recvName !== "_") {
					if (recvField) {
						this.line(`const ${decl.recvName} = this.${recvField};`);
						this._unwrappedRecv = decl.recvName;
					} else {
						this.line(`const ${decl.recvName} = ${this._receiverValue(decl)};`);
					}
				}
				this._emitParamCopies(decl.params);
				this._withNamedReturns(decl, () => this._genBody(decl.body, decl));
			}),
		);
		this._unwrappedRecv = prevUnwrapped;
		this._boxedVars = prevBoxed;
		this.line("}");
		this._currentSrcFileIdx = prevFileIdx;
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

	// Returns the wrapper field name ("_fn", "_items", "_map") if `type` is a named
	// non-struct type emitted as a wrapper class, or null otherwise.
	// Pass `expr` so we can skip unwrapping when the expression is the method receiver
	// (which was already unwrapped to `this.<field>` at the top of the method body).
	_namedWrapperField(type, expr = null) {
		if (type?.kind !== "named") return null;
		if (!this.namedWrapperNames.has(type.name)) return null;
		if (expr?.kind === "Ident" && expr.name === this._unwrappedRecv)
			return null;
		const u = type.underlying;
		if (u?.kind === "func") return "_fn";
		if (u?.kind === "map") return "_map";
		return "_items";
	}

	// ── Function declarations ────────────────────────────────────

	genFuncDecl(decl, nameOverride) {
		const name = nameOverride ?? decl.name;
		const params = decl.params
			.map((p, i) =>
				p.variadic && i === decl.params.length - 1 ? `...${p.name}` : p.name,
			)
			.join(", ");
		const asyncPrefix = decl.async ? "async " : "";
		const srcLine = decl._line ?? null;
		this.line(`${asyncPrefix}function ${name}(${params}) {`, srcLine);
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set();
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

	// Scan AST node for _addressTaken idents on scalars and populate _boxedVars.
	_scanAddressTaken(node) {
		scanAddressTaken(node, this._boxedVars);
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
				if (spec.names.length === 1) {
					this.line(`let ${spec.names[0]} = ${vals[0]};`);
				} else {
					// let [a, b] = [v1, v2]
					this.line(`let [${spec.names.join(", ")}] = [${vals.join(", ")}];`);
				}
			} else {
				const zero = spec.type ? this.zeroValueForTypeNode(spec.type) : "null";
				for (const name of spec.names) {
					this._markOwnership(name, true);
					const val = this._boxedVars.has(name) ? `{ value: ${zero} }` : zero;
					this.line(`let ${name} = ${val};`);
				}
			}
		}
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
