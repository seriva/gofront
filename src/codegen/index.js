// Code generator: walks the typed AST and emits clean JavaScript.
//
// Split into sub-modules under codegen/:
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

import { isComplex, isNumeric } from "../typechecker/types.js";
import { expressionGenMethods } from "./expressions.js";
import {
	HELPER_APPEND,
	HELPER_CDIV,
	HELPER_CMUL,
	HELPER_EQUAL,
	HELPER_ERROR,
	HELPER_ERROR_IS,
	HELPER_LEN,
	HELPER_PATH_CLEAN,
	HELPER_S,
	HELPER_SPRINTF,
	HELPER_TIME_FMT,
	HELPER_TIME_PARSE,
} from "./runtime.js";
import { buildSourceMap } from "./source-map.js";
import { statementGenMethods } from "./statements.js";
import { stdlibGenMethods } from "./stdlib/index.js";
import { templGenMethods } from "./templ.js";

export class CodeGen {
	// jsImports:       Map<importPath, string[]> — npm package imports to emit at top of file
	// bundledPackages: Set<string>               — GoFront package names bundled inline;
	//                                             SelectorExpr `pkg.Foo` → just `Foo`
	constructor(
		checker = null,
		jsImports = new Map(),
		bundledPackages = new Set(),
	) {
		this.checker = checker;
		this.out = [];
		this.indent = 0;
		this.structNames = new Set();
		this.namedWrapperNames = new Set();
		this.jsImports = jsImports;
		this.bundledPackages = bundledPackages;
		this.namedReturnVars = null; // names of current function's named return vars
		this._srcMappings = []; // { genLine, srcLine, srcFileIdx } for source map
		this._currentSrcFileIdx = 0; // updated as each top-level decl is generated
		this._boxedVars = new Set(); // address-taken scalar variables that need boxing
		// Runtime helper usage tracking — only emit helpers that are actually used
		this._usesLen = false;
		this._usesAppend = false;
		this._usesSliceGuard = false;
		this._usesSprintf = false;
		this._usesEqual = false;
		this._usesCmul = false;
		this._usesCdiv = false;
		this._usesError = false;
		this._usesErrorIs = false;
		this._usesPathClean = false;
		this._usesTimeFmt = false;
		this._usesTimeParse = false;
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
			if (d.kind === "VarDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genVarDecl(d);
				this.blank();
			}
			if (d.kind === "ConstDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genConstDecl(d);
				this.blank();
			}
		}
	}

	_callInitAndMain(initNames, program) {
		for (const name of initNames) this.line(`${name}();`);
		if (program.decls.some((d) => d.kind === "FuncDecl" && d.name === "main"))
			this.line("main();");
	}

	generate(program) {
		const methods = this._collectDecls(program);
		this._emitJsImports();
		this._emitTypeDecls(program, methods);
		this._emitVarConstDecls(program);
		const initNames = this._emitFuncDecls(program);
		this._callInitAndMain(initNames, program);
		this._prependHelpers();
		while (this.out[0] === "") this.out.shift();
		return this.out.join("\n");
	}

	// Emits FuncDecl and TemplDecl nodes; returns renamed init function names.
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
			}
		}
		return initNames;
	}

	// Collects struct names, method map, and named wrapper names from program decls.
	// Returns the method map (typeName → MethodDecl[]).
	_collectStructNames(program) {
		for (const d of program.decls) {
			if (d.kind === "TypeDecl" && d.type.kind === "StructType")
				this.structNames.add(d.name);
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

	_prependHelpers() {
		const HELPER_MAP = [
			[this._usesLen, HELPER_LEN],
			[this._usesAppend, HELPER_APPEND],
			[this._usesSliceGuard, HELPER_S],
			[this._usesEqual, HELPER_EQUAL],
			[this._usesCmul, HELPER_CMUL],
			[this._usesCdiv, HELPER_CDIV],
			[this._usesSprintf, HELPER_SPRINTF],
			[this._usesError, HELPER_ERROR],
			[this._usesErrorIs, HELPER_ERROR_IS],
			[this._usesPathClean, HELPER_PATH_CLEAN],
			[this._usesTimeFmt, HELPER_TIME_FMT],
			[this._usesTimeParse, HELPER_TIME_PARSE],
		];
		const helpers = HELPER_MAP.filter(([flag]) => flag).map(([, h]) => h);
		if (helpers.length > 0) this.out.unshift(...helpers, "");
	}

	// Generate a single bundle from multiple programs (same-package multi-file).
	// Annotates each decl with its source file index before merging.
	generateAll(programs) {
		for (let i = 0; i < programs.length; i++) {
			for (const decl of programs[i].decls) {
				decl._srcFileIdx = i;
			}
		}
		const merged = { decls: programs.flatMap((p) => p.decls) };
		return this.generate(merged);
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

	_genStructConstructor(fields) {
		if (fields.length === 0) {
			this.line("constructor() {}");
		} else {
			const params = fields.map((f) => `${f.name} = ${f.zero}`).join(", ");
			this.line(`constructor({ ${params} } = {}) {`);
			this.indented(() => {
				for (const f of fields) this.line(`this.${f.name} = ${f.name};`);
			});
			this.line("}");
		}
	}

	genStruct(name, structTypeAst, methodDecls) {
		const fields = this._collectStructFields(name, structTypeAst);
		this.line(`class ${name} {`);
		this.indented(() => {
			this._genStructConstructor(fields);
			for (const m of methodDecls) {
				this.blank();
				this.genMethod(m);
			}
			this._genEmbeddedMethodStubs(name, methodDecls);
		});
		this.line("}");
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
		if (!this.checker) return;
		const resolvedType = this.checker.types.get(name)?.underlying;
		if (resolvedType?.kind !== "struct" || !resolvedType._embeds) return;
		const declared = new Set(methodDecls.map((m) => m.name));
		for (const embed of resolvedType._embeds)
			this._genSingleEmbedStubs(embed, declared);
	}

	genMethod(decl, recvField = null) {
		const params = decl.params.map((p) => p.name).join(", ");
		const asyncPrefix = decl.async ? "async " : "";
		this.line(`${asyncPrefix}${decl.name}(${params}) {`);
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set();
		this._scanAddressTaken(decl.body);
		const prevUnwrapped = this._unwrappedRecv;
		this.indented(() => {
			if (decl.recvName && decl.recvName !== "_") {
				if (recvField) {
					this.line(`const ${decl.recvName} = this.${recvField};`);
					this._unwrappedRecv = decl.recvName;
				} else {
					this.line(`const ${decl.recvName} = this;`);
				}
			}
			this._withNamedReturns(decl, () => this._genBody(decl.body));
		});
		this._unwrappedRecv = prevUnwrapped;
		this._boxedVars = prevBoxed;
		this.line("}");
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
		this.line(
			`${asyncPrefix}function ${name}(${params}) {`,
			srcLine ? srcLine - 1 : null,
		);
		const prevBoxed = this._boxedVars;
		this._boxedVars = new Set();
		this._scanAddressTaken(decl.body);
		this.indented(() =>
			this._withNamedReturns(decl, () => this._genBody(decl.body)),
		);
		this._boxedVars = prevBoxed;
		this.line("}");
	}

	_withNamedReturns(decl, fn) {
		const named = decl.returnType?._namedReturns;
		const prev = this.namedReturnVars;
		if (named) {
			// Emit zero-value declarations for named return vars
			for (const { name, type } of named) {
				if (name)
					this.line(`let ${name} = ${this.zeroValueForTypeNode(type)};`);
			}
			this.namedReturnVars = named.map((r) => r.name).filter(Boolean);
		} else {
			this.namedReturnVars = null;
		}
		fn();
		this.namedReturnVars = prev;
	}

	// Emit a function body, wrapping in try/catch/finally for defer if needed.
	_genBody(body) {
		if (!body._hasDefer) {
			this.genBlock(body);
			return;
		}
		this.line("const __defers = [];");
		this.line("let __panic = null;");
		this.line("try {");
		this.indented(() => this.genBlock(body));
		this.line("} catch (__err) {");
		this.indented(() => this.line("__panic = __err;"));
		this.line("} finally {");
		this.indented(() => {
			this.line(
				"for (let __i = __defers.length - 1; __i >= 0; __i--) __defers[__i]();",
			);
			this.line("if (__panic !== null) throw __panic;");
		});
		this.line("}");
		// If a recover() cleared __panic, execution reaches here.
		// Return named return vars so deferred mutations are visible to the caller.
		if (this.namedReturnVars?.length > 0) {
			const vars = this.namedReturnVars;
			this.line(
				vars.length === 1
					? `return ${vars[0]};`
					: `return [${vars.join(", ")}];`,
			);
		}
	}

	// Scan AST node for _addressTaken idents on scalars and populate _boxedVars.
	_scanAddressTaken(node) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const child of node) this._scanAddressTaken(child);
			return;
		}
		// &x — the operand ident will have _addressTaken set by typechecker
		if (node.kind === "Ident" && node._addressTaken) {
			// Check if the type is a scalar (needs boxing) vs reference type (no boxing)
			const t = node._type;
			if (t && !this._isReferenceType(t)) {
				this._boxedVars.add(node.name);
			}
		}
		// Recurse into FuncLit too — closures may take address of outer vars
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			this._scanAddressTaken(node[key]);
		}
	}

	_isReferenceType(t) {
		if (!t) return false;
		const base = t.kind === "named" ? t.underlying : t;
		return (
			base?.kind === "struct" ||
			base?.kind === "slice" ||
			base?.kind === "map" ||
			base?.kind === "func" ||
			base?.kind === "interface"
		);
	}

	// ── Variable / const declarations ────────────────────────────

	genVarDecl(decl) {
		for (const spec of decl.decls) {
			if (spec.value) {
				const vals = spec.value.map((v) => {
					const js = this.genExpr(v);
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
