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
} from "./codegen/runtime.js";
import { buildSourceMap } from "./codegen/source-map.js";
import { statementGenMethods } from "./codegen/statements.js";
import { stdlibGenMethods } from "./codegen/stdlib.js";
import { T, Token } from "./lexer.js";
import { Parser } from "./parser.js";
import { isComplex, isNumeric } from "./typechecker/types.js";

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

	generate(program) {
		// Collect struct names first (needed by zero-value helpers and genCompositeLit)
		for (const d of program.decls) {
			if (d.kind === "TypeDecl" && d.type.kind === "StructType") {
				this.structNames.add(d.name);
			}
		}

		// Build a map: typeName → [MethodDecl, ...]
		const methods = new Map();
		for (const d of program.decls) {
			if (d.kind === "MethodDecl") {
				const name = d.recvType.name;
				if (!methods.has(name)) methods.set(name, []);
				methods.get(name).push(d);
			}
		}

		// Collect named non-struct types that have methods (emitted as wrapper classes)
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

		// Emit ESM import statements for npm packages
		for (const [importPath, names] of this.jsImports) {
			if (names.length === 0) continue;
			this.line(`import { ${names.join(", ")} } from '${importPath}';`);
		}
		if (this.jsImports.size > 0) this.blank();

		for (const d of program.decls) {
			if (d.kind === "TypeDecl") {
				this._currentSrcFileIdx = d._srcFileIdx ?? 0;
				this.genTypeDeclWithMethods(d, methods.get(d.name) ?? []);
				this.blank();
			}
		}

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

		// Emit functions and templ components
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

		// Auto-call init() functions, then main()
		for (const name of initNames) this.line(`${name}();`);
		const hasMain = program.decls.some(
			(d) => d.kind === "FuncDecl" && d.name === "main",
		);
		if (hasMain) this.line("main();");

		// Prepend runtime helpers that were actually used
		const helpers = [];
		if (this._usesLen) helpers.push(HELPER_LEN);
		if (this._usesAppend) helpers.push(HELPER_APPEND);
		if (this._usesSliceGuard) helpers.push(HELPER_S);
		if (this._usesEqual) helpers.push(HELPER_EQUAL);
		if (this._usesCmul) helpers.push(HELPER_CMUL);
		if (this._usesCdiv) helpers.push(HELPER_CDIV);
		if (this._usesSprintf) helpers.push(HELPER_SPRINTF);
		if (this._usesError) helpers.push(HELPER_ERROR);
		if (this._usesErrorIs) helpers.push(HELPER_ERROR_IS);
		if (this._usesPathClean) helpers.push(HELPER_PATH_CLEAN);
		if (this._usesTimeFmt) helpers.push(HELPER_TIME_FMT);
		if (this._usesTimeParse) helpers.push(HELPER_TIME_PARSE);

		if (helpers.length > 0) this.out.unshift(...helpers, "");

		// Strip leading blank line
		while (this.out[0] === "") this.out.shift();
		return this.out.join("\n");
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

	// ── TemplDecl code generation ────────────────────────────────

	genTemplDecl(decl) {
		const params = decl.params
			.map((p, i) =>
				p.variadic && i === decl.params.length - 1 ? `...${p.name}` : p.name,
			)
			.join(", ");
		this.line(`function ${decl.name}(${params}) {`);
		this.indented(() => {
			this.line(`return {Mount(___p) {`);
			this.indented(() => {
				this._genTemplNodes(decl.body, "___p");
			});
			this.line(`}};`);
		});
		this.line("}");
	}

	// Emit mount statements for an array of TemplNodes into parent variable `p`.
	_genTemplNodes(nodes, p) {
		if (!nodes || nodes.length === 0) return;
		if (nodes.length === 1) {
			this._genTemplNodeMount(nodes[0], p);
			return;
		}
		// Wrap multiple root nodes in a fragment div? No — emit each directly.
		for (const node of nodes) {
			this._genTemplNodeMount(node, p);
		}
	}

	// Emit JS to mount a single TemplNode onto parent `p`.
	_genTemplNodeMount(node, p) {
		switch (node.kind) {
			case "TemplElement":
				return this._genTemplElement(node, p);
			case "TemplText":
				return this.line(
					`${p}.appendChild(document.createTextNode(${JSON.stringify(node.value)}));`,
				);
			case "TemplExpr":
				return this.line(
					`${p}.appendChild(document.createTextNode(String(${this._genTemplTokenExpr(node.tokens)})));`,
				);
			case "TemplComponent": {
				// Special case: @templ.Raw(expr) → insertAdjacentHTML
				const toks = node.tokens;
				if (
					toks.length >= 4 &&
					toks[0]?.value === "templ" &&
					toks[1]?.type === T.DOT &&
					toks[2]?.value === "Raw" &&
					toks[3]?.type === T.LPAREN
				) {
					const argTokens = toks.slice(4, toks.length - 1);
					const argJs = this._genTemplTokenExpr(argTokens);
					return this.line(`${p}.insertAdjacentHTML("beforeend", ${argJs});`);
				}
				return this.line(
					`(${this._genTemplTokenCallExpr(node.tokens)}).Mount(${p});`,
				);
			}
			case "TemplChildren":
				// children is a variadic gom.Node param — mount each child
				return this.line(
					`if(typeof children!=="undefined")(Array.isArray(children)?children:[...children]).forEach(___c=>___c?.Mount?.(${p}));`,
				);
			case "TemplIf":
				return this._genTemplIf(node, p);
			case "TemplFor":
				return this._genTemplFor(node, p);
			case "TemplSwitch":
				return this._genTemplSwitch(node, p);
			default:
				break;
		}
	}

	_genTemplElement(node, p) {
		const { tag, attrs, children } = node;
		const elVar = this._freshVar("e");
		this.line(
			`const ${elVar} = document.createElement(${JSON.stringify(tag)});`,
		);
		for (const attr of attrs) {
			this._genTemplAttr(attr, elVar);
		}
		this._genTemplNodes(children, elVar);
		this.line(`${p}.appendChild(${elVar});`);
	}

	_genTemplAttr(attr, el) {
		const { name } = attr;
		if (attr.kind === "static") {
			if (name === "class") {
				this.line(`${el}.className = ${JSON.stringify(attr.value)};`);
			} else {
				this.line(
					`${el}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(attr.value)});`,
				);
			}
		} else if (attr.kind === "expr") {
			const exprJs = this._genTemplTokenExpr(attr.tokens);
			if (name === "class") {
				this.line(`${el}.className = ${exprJs};`);
			} else {
				this.line(
					`${el}.setAttribute(${JSON.stringify(name)}, String(${exprJs}));`,
				);
			}
		} else if (attr.kind === "bool") {
			this.line(`${el}.setAttribute(${JSON.stringify(name)}, "");`);
		} else if (attr.kind === "cond-bool") {
			const exprJs = this._genTemplTokenExpr(attr.tokens);
			this.line(
				`if(${exprJs})${el}.setAttribute(${JSON.stringify(name)}, "");`,
			);
		}
	}

	_genTemplIf(node, p) {
		const condJs = this._genTemplCondTokens(node.condTokens);
		this.line(`if (${condJs}) {`);
		this.indented(() => this._genTemplNodes(node.then, p));
		this._genTemplIfElse(node.else_, p);
	}

	_genTemplIfElse(else_, p) {
		if (!else_ || else_.length === 0) {
			this.line(`}`);
			return;
		}
		if (else_.length === 1 && else_[0].kind === "TemplIf") {
			const elseIf = else_[0];
			this.line(`} else if (${this._genTemplCondTokens(elseIf.condTokens)}) {`);
			this.indented(() => this._genTemplNodes(elseIf.then, p));
			this._genTemplIfElse(elseIf.else_, p);
		} else {
			this.line(`} else {`);
			this.indented(() => this._genTemplNodes(else_, p));
			this.line(`}`);
		}
	}

	_genTemplSwitch(node, p) {
		const { exprTokens, cases } = node;
		if (cases.length === 0) return;
		const exprJs = this._genTemplTokenExpr(exprTokens);
		this.line(`switch (${exprJs}) {`);
		this.indented(() => {
			for (const c of cases) {
				const label =
					c.caseTokens === null
						? "default"
						: `case ${this._genTemplTokenExpr(c.caseTokens)}`;
				this.line(`${label}: {`);
				this.indented(() => this._genTemplNodes(c.body, p));
				this.line(`break; }`);
			}
		});
		this.line(`}`);
	}

	_genTemplFor(node, p) {
		// stmtTokens include the `for` keyword plus the range clause (no body).
		// Strip any trailing semicolons (inserted by the Go lexer on newlines),
		// then add a fake empty body `{ }` so the parser can complete the ForStmt.
		let tokens = node.stmtTokens;
		while (tokens.length > 0 && tokens[tokens.length - 1].type === T.SEMICOLON)
			tokens = tokens.slice(0, -1);
		const eofTok = new Token(T.EOF, "", 1, 1);
		const lbrace = new Token(T.LBRACE, "{", 1, 1);
		const rbrace = new Token(T.RBRACE, "}", 1, 1);
		const semi = new Token(T.SEMICOLON, ";", 1, 1);
		const withFor =
			tokens[0]?.type === T.FOR
				? [...tokens, lbrace, rbrace, semi, eofTok]
				: [
						new Token(T.FOR, "for", 1, 1),
						...tokens,
						lbrace,
						rbrace,
						semi,
						eofTok,
					];
		try {
			const p2 = new Parser(withFor);
			const forStmt = p2.parseFor();
			this._genTemplRangeFor(forStmt, node.body, p);
		} catch {
			// Fallback for non-range loops: emit a comment + skip
			this.line(`/* templ for: ${this._tokensToSource(tokens)} */`);
		}
	}

	_genTemplRangeFor(forStmt, templBody, mountParent) {
		const init = forStmt.init;
		if (!init?.rhs?.[0] || init.rhs[0].kind !== "RangeExpr") {
			// Plain for loop (cond-only or three-clause)
			const condJs = forStmt.cond ? this.genExpr(forStmt.cond) : "true";
			this.line(`while (${condJs}) {`);
			this.indented(() => this._genTemplNodes(templBody, mountParent));
			this.line("}");
			return;
		}
		// Range for: for key, val := range iter
		const range = init.rhs[0];
		const iterJs = this.genExpr(range.expr);
		const lhs = init.lhs.map((e) => e.name ?? "_");
		const keyName = lhs[0] ?? "_";
		const valName = lhs[1] ?? null;

		let loopHeader;
		if (valName === null || valName === undefined) {
			loopHeader = `for (const ${keyName === "_" ? "_$" : keyName} of ${iterJs}) {`;
		} else if (keyName === "_" && valName === "_") {
			loopHeader = `for (const _$ of ${iterJs}) {`;
		} else if (keyName === "_") {
			loopHeader = `for (const ${valName} of ${iterJs}) {`;
		} else if (valName === "_") {
			loopHeader = `for (const [${keyName}] of Object.entries(${iterJs})) {`;
		} else {
			// Default to .entries() for arrays, Object.entries for objects
			this._usesSliceGuard = true;
			loopHeader = `for (const [${keyName}, ${valName}] of __s(${iterJs}).entries()) {`;
		}
		this.line(loopHeader);
		this.indented(() => this._genTemplNodes(templBody, mountParent));
		this.line("}");
	}

	// Parse a token array as a Go expression and emit JS.
	_genTemplTokenExpr(tokens) {
		if (!tokens || tokens.length === 0) return '""';
		const eofTok = new Token(T.EOF, "", 1, 1);
		const p = new Parser([...tokens, eofTok]);
		const ast = p.parseExpr();
		return this.genExpr(ast);
	}

	// Parse a token array as a Go call expression and emit JS.
	_genTemplTokenCallExpr(tokens) {
		if (!tokens || tokens.length === 0) return "null";
		const eofTok = new Token(T.EOF, "", 1, 1);
		const p = new Parser([...tokens, eofTok]);
		const ast = p.parseExpr();
		return this.genExpr(ast);
	}

	// Extract condition JS from condTokens (which may start with `if`).
	_genTemplCondTokens(tokens) {
		if (!tokens || tokens.length === 0) return "false";
		let toks = tokens;
		if (toks[0]?.type === T.IF) toks = toks.slice(1); // skip `if` keyword
		const eofTok = new Token(T.EOF, "", 1, 1);
		const p = new Parser([...toks, eofTok]);
		const ast = p.parseExpr();
		return this.genExpr(ast);
	}

	_tokensToSource(tokens) {
		return tokens.map((t) => t.value).join(" ");
	}

	// Fresh variable name counter
	_freshVar(prefix = "v") {
		this._templVarCount = (this._templVarCount ?? 0) + 1;
		return `___${prefix}${this._templVarCount}`;
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
