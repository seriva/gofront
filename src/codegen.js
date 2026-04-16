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

import { expressionGenMethods } from "./codegen/expressions.js";
import { buildSourceMap } from "./codegen/source-map.js";
import { statementGenMethods } from "./codegen/statements.js";

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
		this.jsImports = jsImports;
		this.bundledPackages = bundledPackages;
		this.namedReturnVars = null; // names of current function's named return vars
		this._srcMappings = []; // { genLine, srcLine } for source map
		// Runtime helper usage tracking — only emit helpers that are actually used
		this._usesLen = false;
		this._usesAppend = false;
		this._usesSliceGuard = false;
		this._usesSprintf = false;
		this._usesEqual = false;
	}

	// ── Output helpers ───────────────────────────────────────────

	emit(s) {
		this.out.push(s);
	}
	line(s = "", srcLine = null) {
		if (srcLine != null) {
			this._srcMappings.push({
				genLine: this.out.length,
				srcLine: srcLine - 1,
			}); // 0-based
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

	generate(program) {
		// Collect struct names first (needed by zero-value helpers and genCompositeLit)
		for (const d of program.decls) {
			if (d.kind === "TypeDecl" && d.type.kind === "StructType") {
				this.structNames.add(d.name);
			}
		}

		// Build a map: structName → [MethodDecl, ...]
		const methods = new Map();
		for (const d of program.decls) {
			if (d.kind === "MethodDecl") {
				const name = d.recvType.name;
				if (!methods.has(name)) methods.set(name, []);
				methods.get(name).push(d);
			}
		}

		// Emit ESM import statements for npm packages
		for (const [importPath, names] of this.jsImports) {
			if (names.length === 0) continue;
			this.line(`import { ${names.join(", ")} } from '${importPath}';`);
		}
		if (this.jsImports.size > 0) this.blank();

		for (const d of program.decls) {
			if (d.kind === "TypeDecl") {
				this.genTypeDeclWithMethods(d, methods.get(d.name) ?? []);
				this.blank();
			}
		}

		for (const d of program.decls) {
			if (d.kind === "VarDecl") {
				this.genVarDecl(d);
				this.blank();
			}
			if (d.kind === "ConstDecl") {
				this.genConstDecl(d);
				this.blank();
			}
		}

		// Emit functions — rename duplicate init() to init$0, init$1, etc.
		let initCount = 0;
		const initNames = [];
		for (const d of program.decls) {
			if (d.kind === "FuncDecl") {
				if (d.name === "init") {
					const renamed = initCount === 0 ? "init" : `init$${initCount}`;
					initNames.push(renamed);
					this.genFuncDecl(d, renamed);
					initCount++;
				} else {
					this.genFuncDecl(d);
				}
				this.blank();
			}
		}

		// Auto-call init() functions, then main()
		for (const name of initNames) this.line(`${name}();`);
		const hasMain = program.decls.some(
			(d) => d.kind === "FuncDecl" && d.name === "main",
		);
		if (hasMain) this.line("main();");

		// Prepend runtime helpers that were actually used
		const helpers = [];
		if (this._usesLen)
			helpers.push("function __len(a) { return a?.length ?? 0; }");
		if (this._usesAppend)
			helpers.push(
				"function __append(a, ...b) { return a ? [...a, ...b] : b; }",
			);
		if (this._usesSliceGuard)
			helpers.push("function __s(a) { return a || []; }");
		if (this._usesEqual)
			helpers.push(
				'function __equal(a,b){if(a===b)return true;if(a===null||b===null)return false;if(Array.isArray(a)&&Array.isArray(b)){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!__equal(a[i],b[i]))return false;return true;}if(typeof a==="object"&&typeof b==="object"){const ka=Object.keys(a),kb=Object.keys(b);if(ka.length!==kb.length)return false;for(const k of ka)if(!__equal(a[k],b[k]))return false;return true;}return false;}',
			);
		if (this._usesSprintf)
			helpers.push(
				[
					"function __sprintf(f,...a){let i=0;return f.replace(/%([#+\\- 0]*)([0-9]*)\\.?([0-9]*)[sdvftxXqobeEgG%]/g,(m)=>{",
					"if(m==='%%')return'%';const fl=m.slice(1,-1),verb=m.slice(-1),v=a[i++];",
					"const pad=(s,w,z)=>{w=parseInt(w)||0;if(!w)return s;const p=(z?'0':' ').repeat(Math.max(0,w-s.length));return fl.includes('-')?s+p:p+s;};",
					"const [,flags,width,prec]=m.match(/^%([#+\\- 0]*)([0-9]*)\\.?([0-9]*)/)||[];",
					"const zero=flags?.includes('0')&&!flags?.includes('-');",
					"switch(verb){",
					"case's':return pad(String(v==null?'<nil>':v),width,false);",
					"case'd':return pad(String(Math.trunc(Number(v))),width,zero);",
					"case'v':return pad(String(v==null?'<nil>':v),width,false);",
					"case'f':{const n=Number(v),p=prec!==''?parseInt(prec):6;return pad(n.toFixed(p),width,zero);}",
					"case't':return pad(String(!!v),width,false);",
					"case'x':return pad((Number(v)>>>0).toString(16),width,zero);",
					"case'X':return pad((Number(v)>>>0).toString(16).toUpperCase(),width,zero);",
					"case'o':return pad((Number(v)>>>0).toString(8),width,zero);",
					"case'b':return pad((Number(v)>>>0).toString(2),width,zero);",
					"case'q':return pad('\"'+String(v==null?'':v).replace(/\\\\/g,'\\\\\\\\').replace(/\"/g,'\\\\\"')+'\"',width,false);",
					"case'e':case'E':{const n=Number(v),p=prec!==''?parseInt(prec):6;return pad(n.toExponential(p),width,zero);}",
					"case'g':case'G':{const n=Number(v);return pad(prec!==''?n.toPrecision(parseInt(prec)):String(n),width,zero);}",
					"default:return m;}});",
					"}",
				].join(""),
			);

		if (helpers.length > 0) this.out.unshift(...helpers, "");

		// Strip leading blank line
		while (this.out[0] === "") this.out.shift();
		return this.out.join("\n");
	}

	// Generate a single bundle from multiple programs (same-package multi-file).
	// Merges all decls and generates as if it were one program.
	generateAll(programs) {
		const merged = { decls: programs.flatMap((p) => p.decls) };
		return this.generate(merged);
	}

	// Returns a source map JSON string for the last generate() call.
	// sourceName: the .go filename to reference in the map.
	getSourceMap(sourceName) {
		return buildSourceMap(sourceName, this._srcMappings);
	}

	// ── Type declarations ────────────────────────────────────────

	genTypeDeclWithMethods(decl, methodDecls) {
		if (decl.type.kind === "StructType") {
			this.genStruct(decl.name, decl.type, methodDecls);
		} else if (decl.type.kind === "InterfaceType") {
			// Interfaces are compile-time only — no JS output needed.
			this.line(`// interface ${decl.name} (compile-time only)`);
		} else {
			// Type alias — no JS equivalent needed unless it's used as a constructor.
			// e.g. type MyInt int → just a comment
			this.line(`// type ${decl.name} = ${this.typeComment(decl.type)}`);
		}
	}

	genStruct(name, structTypeAst, methodDecls) {
		const fields = [];
		if (this.checker) {
			const resolved = this.checker.types.get(name)?.underlying;
			if (resolved?.kind === "struct") {
				for (const [fName, fType] of resolved.fields.entries()) {
					fields.push({ name: fName, zero: this.zeroValueForType(fType) });
				}
			}
		} else {
			// Fallback (e.g. tests without typechecker)
			for (const f of structTypeAst.fields) {
				if (f.embedded) continue; // Can't resolve here
				const zero = this.zeroValueForTypeNode(f.type);
				for (const n of f.names) fields.push({ name: n, zero });
			}
		}

		this.line(`class ${name} {`);
		this.indented(() => {
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

			// Methods
			for (const m of methodDecls) {
				this.blank();
				this.genMethod(m);
			}

			// Delegation stubs for promoted embedded methods
			if (this.checker) {
				const resolvedType = this.checker.types.get(name)?.underlying;
				if (resolvedType?.kind === "struct" && resolvedType._embeds) {
					const declared = new Set(methodDecls.map((m) => m.name));
					for (const embed of resolvedType._embeds) {
						const embedName = embed.kind === "named" ? embed.name : null;
						if (!embedName) continue;
						const embedBase = embed.kind === "named" ? embed.underlying : embed;
						if (embedBase?.kind !== "struct" || !embedBase.methods) continue;
						for (const [mName] of embedBase.methods.entries()) {
							if (!declared.has(mName)) {
								this.blank();
								this.line(
									`${mName}(...__a) { return ${embedName}.prototype.${mName}.call(this, ...__a); }`,
								);
							}
						}
					}
				}
			}
		});
		this.line("}");
	}

	genMethod(decl) {
		const params = decl.params.map((p) => p.name).join(", ");
		const asyncPrefix = decl.async ? "async " : "";
		this.line(`${asyncPrefix}${decl.name}(${params}) {`);
		this.indented(() => {
			if (decl.recvName && decl.recvName !== "_") {
				this.line(`const ${decl.recvName} = this;`);
			}
			this._withNamedReturns(decl, () => this._genBody(decl.body));
		});
		this.line("}");
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
		this.indented(() =>
			this._withNamedReturns(decl, () => this._genBody(decl.body)),
		);
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

	// ── Variable / const declarations ────────────────────────────

	genVarDecl(decl) {
		for (const spec of decl.decls) {
			if (spec.value) {
				const vals = spec.value.map((v) => this.genExpr(v));
				if (spec.names.length === 1) {
					this.line(`let ${spec.names[0]} = ${vals[0]};`);
				} else {
					// let [a, b] = [v1, v2]
					this.line(`let [${spec.names.join(", ")}] = [${vals.join(", ")}];`);
				}
			} else {
				const zero = spec.type ? this.zeroValueForTypeNode(spec.type) : "null";
				for (const name of spec.names) this.line(`let ${name} = ${zero};`);
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
