// Code generator: walks the typed AST and emits clean JavaScript.
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

// ── Minimal VLQ / source-map helpers ─────────────────────────
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlqEncode(value) {
	// Signed VLQ: sign bit in LSB of first group, then 5-bit continuation chunks
	let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
	let result = "";
	do {
		let digit = vlq & 0x1f;
		vlq >>>= 5;
		if (vlq > 0) digit |= 0x20; // continuation bit
		result += B64[digit];
	} while (vlq > 0);
	return result;
}

function buildSourceMap(sourceName, mappings) {
	// mappings: Array<{ genLine: number, srcLine: number }>  (0-based)
	// Emits one segment per generated line, column 0 → source line (delta-encoded).
	const lines = [];
	let prevSrcLine = 0;
	const maxGen = mappings.reduce((m, e) => Math.max(m, e.genLine), -1);
	for (let g = 0; g <= maxGen; g++) {
		const entry = mappings.find((e) => e.genLine === g);
		if (entry) {
			const srcDelta = entry.srcLine - prevSrcLine;
			// Segment: [genCol=0, srcFileIdx=0, srcLineDelta, srcCol=0]
			lines.push(
				vlqEncode(0) + vlqEncode(0) + vlqEncode(srcDelta) + vlqEncode(0),
			);
			prevSrcLine = entry.srcLine;
		} else {
			lines.push(""); // no mapping for this generated line
		}
	}
	return JSON.stringify({
		version: 3,
		sources: [sourceName],
		names: [],
		mappings: lines.join(";"),
	});
}

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
					const saved = d.name;
					d.name = renamed;
					this.genFuncDecl(d);
					d.name = saved;
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
		if (this._usesSprintf)
			helpers.push(
				"function __sprintf(f,...a){let i=0;return f.replace(/%[sdvf%]/g,m=>{if(m==='%%')return'%';const v=a[i++];return m==='%f'?Number(v).toString():String(v==null?'<nil>':v);});}",
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

	genFuncDecl(decl) {
		const params = decl.params
			.map((p, i) =>
				p.variadic && i === decl.params.length - 1 ? `...${p.name}` : p.name,
			)
			.join(", ");
		const asyncPrefix = decl.async ? "async " : "";
		const srcLine = decl._line ?? null;
		this.line(
			`${asyncPrefix}function ${decl.name}(${params}) {`,
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
		if (!this._hasDefer(body)) {
			this.genBlock(body, true);
			return;
		}
		this.line("const __defers = [];");
		this.line("let __panic = null;");
		this.line("try {");
		this.indented(() => this.genBlock(body, true));
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

	// Recursively check if a block (or nested blocks) contains any DeferStmt.
	_hasDefer(block) {
		if (!block?.stmts) return false;
		for (const stmt of block.stmts) {
			if (stmt.kind === "DeferStmt") return true;
			if (stmt.kind === "Block" && this._hasDefer(stmt)) return true;
			if (
				stmt.kind === "IfStmt" &&
				(this._hasDefer(stmt.body) || this._hasDefer(stmt.elseBody))
			)
				return true;
			if (stmt.kind === "ForStmt" && this._hasDefer(stmt.body)) return true;
			if (
				stmt.kind === "SwitchStmt" &&
				stmt.cases.some((c) => c.stmts.some((s) => s.kind === "DeferStmt"))
			)
				return true;
		}
		return false;
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

	genBlock(block) {
		for (const stmt of block.stmts) this.genStmt(stmt);
	}

	genStmt(stmt) {
		// Record source mapping for the first line this statement produces
		const srcLine = stmt._line ?? null;
		const _line0 = this.out.length;
		switch (stmt.kind) {
			case "VarDecl":
				this.genVarDecl(stmt);
				break;
			case "ConstDecl":
				this.genConstDecl(stmt);
				break;
			case "TypeDecl":
				this.genTypeDeclWithMethods(stmt, []);
				break;

			case "DefineStmt": {
				// Map comma-ok: v, ok := m[key]  →  let v = m[key]; let ok = key in m;
				const rhsNode = stmt.rhs[0];
				if (
					stmt.rhs.length === 1 &&
					stmt.lhs.length === 2 &&
					rhsNode?.kind === "IndexExpr" &&
					rhsNode.expr?._type?.kind === "map"
				) {
					const mapExpr = this.genExpr(rhsNode.expr);
					const keyExpr = this.genExpr(rhsNode.index);
					const [vName, okName] = stmt.lhs.map(
						(e) => e.name ?? this.genExpr(e),
					);
					if (vName !== "_")
						this.line(`let ${vName} = ${mapExpr}[${keyExpr}];`);
					if (okName !== "_")
						this.line(`let ${okName} = (${keyExpr}) in ${mapExpr};`);
					break;
				}
				const rhs = stmt.rhs.map((e) => this.genExpr(e));
				const lhs = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
				const redecls = stmt.lhs.map((e) => !!e._redecl);
				const anyRedecl = redecls.some((r) => r);
				if (lhs.length === 1) {
					if (redecls[0]) {
						this.line(`${lhs[0]} = ${rhs[0]};`);
					} else {
						this.line(`let ${lhs[0]} = ${rhs[0]};`);
					}
				} else if (!anyRedecl) {
					// All new: let [a, b] = ...
					const rhsStr = rhs.length === 1 ? rhs[0] : `[${rhs.join(", ")}]`;
					this.line(`let [${lhs.join(", ")}] = ${rhsStr};`);
				} else {
					// Mixed new/existing: emit separate statements
					// First compute the tuple into a temp if needed
					if (rhs.length === 1 && lhs.length > 1) {
						const tmp = "__t";
						this.line(`let ${tmp} = ${rhs[0]};`);
						for (let i = 0; i < lhs.length; i++) {
							const prefix = redecls[i] ? "" : "let ";
							this.line(`${prefix}${lhs[i]} = ${tmp}[${i}];`);
						}
					} else {
						for (let i = 0; i < lhs.length; i++) {
							const prefix = redecls[i] ? "" : "let ";
							this.line(`${prefix}${lhs[i]} = ${rhs[i]};`);
						}
					}
				}
				break;
			}

			case "AssignStmt": {
				const rhs = stmt.rhs.map((e) => this.genExpr(e));
				for (const e of stmt.lhs) if (e.kind === "IndexExpr") e._lvalue = true;
				const lhs = stmt.lhs.map((e) => this.genExpr(e));
				if (lhs.length === 1) {
					this.line(`${lhs[0]} ${stmt.op} ${rhs[0]};`);
				} else {
					const rhsStr = rhs.length === 1 ? rhs[0] : `[${rhs.join(", ")}]`;
					this.line(`[${lhs.join(", ")}] = ${rhsStr};`);
				}
				break;
			}

			case "IncDecStmt":
				this.line(`${this.genExpr(stmt.expr)}${stmt.op};`);
				break;

			case "ExprStmt":
				this.line(`${this.genExpr(stmt.expr)};`);
				break;

			case "ReturnStmt": {
				if (stmt.values.length === 0) {
					// bare return — emit named return vars if present
					if (this.namedReturnVars?.length > 0) {
						const vars = this.namedReturnVars;
						this.line(
							vars.length === 1
								? `return ${vars[0]};`
								: `return [${vars.join(", ")}];`,
						);
					} else {
						this.line("return;");
					}
				} else if (stmt.values.length === 1) {
					this.line(`return ${this.genExpr(stmt.values[0])};`);
				} else {
					this.line(
						`return [${stmt.values.map((v) => this.genExpr(v)).join(", ")}];`,
					);
				}
				break;
			}

			case "IfStmt": {
				if (stmt.init) {
					// Wrap in a block so init variable is scoped
					this.line("{");
					this.indented(() => {
						this.genStmt(stmt.init);
						this._genIf(stmt);
					});
					this.line("}");
				} else {
					this._genIf(stmt);
				}
				break;
			}

			case "ForStmt":
				this.genFor(stmt);
				break;

			case "SwitchStmt":
				this.genSwitch(stmt);
				break;

			case "TypeSwitchStmt":
				this.genTypeSwitch(stmt);
				break;

			case "DeferStmt":
				this.line(`__defers.push(() => { ${this.genExpr(stmt.call)}; });`);
				break;

			case "LabeledStmt":
				this.line(`${stmt.label}:`);
				this.genStmt(stmt.body);
				break;

			case "BranchStmt":
				if (stmt.keyword !== "fallthrough")
					this.line(
						stmt.label ? `${stmt.keyword} ${stmt.label};` : `${stmt.keyword};`,
					);
				// fallthrough: omit — JS switch falls through naturally without a break
				break;

			case "Block":
				this.line("{");
				this.indented(() => this.genBlock(stmt));
				this.line("}");
				break;

			default:
				break;
		}
		// Record source mapping: first output line this statement produced
		if (srcLine != null && this.out.length > _line0) {
			this._srcMappings.push({ genLine: _line0, srcLine: srcLine - 1 });
		}
	}

	_genIf(stmt) {
		this.line(`if (${this.genExpr(stmt.cond)}) {`);
		this.indented(() => this.genBlock(stmt.body));
		this._genElse(stmt.elseBody);
	}

	_genElse(elseBody) {
		if (!elseBody) {
			this.line("}");
			return;
		}
		if (elseBody.kind === "IfStmt") {
			this.line(`} else if (${this.genExpr(elseBody.cond)}) {`);
			this.indented(() => this.genBlock(elseBody.body));
			this._genElse(elseBody.elseBody);
		} else {
			this.line("} else {");
			this.indented(() => this.genBlock(elseBody));
			this.line("}");
		}
	}

	genFor(stmt) {
		// Detect range: init is DefineStmt with rhs[0] being a RangeExpr
		if (this.isRangeFor(stmt)) {
			this.genRangeFor(stmt);
			return;
		}

		if (!stmt.init && !stmt.post) {
			if (!stmt.cond) {
				// infinite loop
				this.line("while (true) {");
			} else {
				this.line(`while (${this.genExpr(stmt.cond)}) {`);
			}
			this.indented(() => this.genBlock(stmt.body));
			this.line("}");
			return;
		}

		// Standard C-style for
		const init = stmt.init ? this.stmtInline(stmt.init) : "";
		const cond = stmt.cond ? this.genExpr(stmt.cond) : "";
		const post = stmt.post ? this.stmtInline(stmt.post) : "";
		this.line(`for (${init}; ${cond}; ${post}) {`);
		this.indented(() => this.genBlock(stmt.body));
		this.line("}");
	}

	isRangeFor(stmt) {
		if (!stmt.init) return false;
		const init = stmt.init;
		if (init.kind !== "DefineStmt" && init.kind !== "AssignStmt") return false;
		return init.rhs?.[0]?.kind === "RangeExpr";
	}

	genRangeFor(stmt) {
		const init = stmt.init;
		const range = init.rhs[0];
		const lhs = init.lhs.map((e) => e.name ?? this.genExpr(e));
		const iteree = this.genExpr(range.expr);
		const iterType = range.expr._type;

		let iterExpr;
		if (
			iterType?.kind === "map" ||
			(iterType?.kind === "named" && iterType.underlying?.kind === "map")
		) {
			// map: for k, v := range m  → for (const [k, v] of Object.entries(m))
			iterExpr = `Object.entries(${iteree})`;
		} else if (iterType?.kind === "basic" && iterType.name === "string") {
			// string: for i, ch := range s  → for (const [i, ch] of s.split('').entries())
			iterExpr =
				lhs.length === 1
					? `Array.from(${iteree}).keys()`
					: `Array.from(${iteree}).entries()`;
		} else {
			// slice/array: for i, v := range arr → for (const [i, v] of __s(arr).entries())
			// null-guard handles nil slices (zero value) gracefully.
			this._usesSliceGuard = true;
			if (lhs.length === 1) {
				iterExpr = `__s(${iteree}).keys()`;
			} else {
				iterExpr = `__s(${iteree}).entries()`;
			}
		}

		const binding =
			lhs.length === 1
				? lhs[0] === "_"
					? "_$"
					: lhs[0]
				: `[${lhs.map((n) => (n === "_" ? "_$" : n)).join(", ")}]`;

		this.line(`for (const ${binding} of ${iterExpr}) {`);
		this.indented(() => this.genBlock(stmt.body));
		this.line("}");
	}

	// Inline a statement as a for-init/post string (no semicolon)
	stmtInline(stmt) {
		switch (stmt.kind) {
			case "DefineStmt": {
				const rhs = stmt.rhs.map((e) => this.genExpr(e)).join(", ");
				const lhs = stmt.lhs.map((e) => e.name ?? this.genExpr(e)).join(", ");
				return `let ${lhs} = ${rhs}`;
			}
			case "AssignStmt": {
				const rhs = stmt.rhs.map((e) => this.genExpr(e)).join(", ");
				const lhs = stmt.lhs.map((e) => this.genExpr(e)).join(", ");
				return `${lhs} ${stmt.op} ${rhs}`;
			}
			case "IncDecStmt":
				return `${this.genExpr(stmt.expr)}${stmt.op}`;
			case "ExprStmt":
				return this.genExpr(stmt.expr);
			default:
				return "";
		}
	}

	genSwitch(stmt) {
		const genBody = () => {
			const tag = stmt.tag ? this.genExpr(stmt.tag) : "true";
			this.line(`switch (${tag}) {`);
			this.indented(() => {
				for (const c of stmt.cases) {
					if (c.list) {
						for (const e of c.list) this.line(`case ${this.genExpr(e)}:`);
					} else {
						this.line("default:");
					}
					// Wrap each case body in {} so `let` declarations don't bleed
					// across sibling cases (JS switch shares one block scope).
					this.line("{");
					this.indented(() => {
						for (const s of c.stmts) this.genStmt(s);
						// Go doesn't fall through by default — add break unless last stmt is return/break
						const last = c.stmts[c.stmts.length - 1];
						if (
							!last ||
							(last.kind !== "ReturnStmt" && last.kind !== "BranchStmt")
						) {
							this.line("break;");
						}
					});
					this.line("}");
				}
			});
			this.line("}");
		};

		if (stmt.init) {
			this.line("{");
			this.indented(() => {
				this.genStmt(stmt.init);
				genBody();
			});
			this.line("}");
		} else {
			genBody();
		}
	}

	genTypeSwitch(stmt) {
		this.line("{");
		this.indented(() => {
			const val = this.genExpr(stmt.expr);
			this.line(`const __tsw = ${val};`);
			if (stmt.assign) this.line(`let ${stmt.assign} = __tsw;`);

			let first = true;
			let hasDefault = false;
			for (const c of stmt.cases) {
				if (!c.types) {
					// default case — emit last
					hasDefault = c;
					continue;
				}
				const cond = c.types
					.map((t) => this._typeCheckExpr(t, "__tsw"))
					.join(" || ");
				this.line(`${first ? "if" : "else if"} (${cond}) {`);
				this.indented(() => {
					for (const s of c.stmts) this.genStmt(s);
				});
				this.line("}");
				first = false;
			}
			if (hasDefault) {
				this.line(first ? "{" : "else {");
				this.indented(() => {
					for (const s of hasDefault.stmts) this.genStmt(s);
				});
				this.line("}");
			}
		});
		this.line("}");
	}

	// ── Expressions ──────────────────────────────────────────────

	genExpr(expr) {
		switch (expr.kind) {
			case "BasicLit":
				if (expr.litKind === "STRING") return JSON.stringify(expr.value);
				return expr.value; // int, float, bool, nil(null)

			case "Ident":
				return expr.name;

			case "UnaryExpr": {
				const op = expr.op === "^" ? "~" : expr.op; // bitwise NOT
				// Dereference/address-of — transparent in JS
				if (op === "*" || op === "&") return this.genExpr(expr.operand);
				return `${op}${this.genExpr(expr.operand)}`;
			}

			case "BinaryExpr": {
				const l = this.genExpr(expr.left);
				const r = this.genExpr(expr.right);
				// Integer division: only when both sides are int
				if (
					expr.op === "/" &&
					this.isIntType(expr.left._type) &&
					this.isIntType(expr.right._type)
				) {
					return `Math.trunc(${l} / ${r})`;
				}
				// Go == and != are strict — map to JS === / !==
				const op =
					expr.op === "==" ? "===" : expr.op === "!=" ? "!==" : expr.op;
				return `${l} ${op} ${r}`;
			}

			case "CallExpr":
				return this.genCall(expr);

			case "SelectorExpr": {
				const base = this.genExpr(expr.expr);
				// Bundled GoFront packages are inlined — drop the qualifier.
				if (this.bundledPackages.has(base)) return expr.field;
				// Pointer types are wrapped as { value: T }; route through .value
				if (expr.expr._type?.kind === "pointer" && expr.field !== "value") {
					return `${base}.value.${expr.field}`;
				}
				return `${base}.${expr.field}`;
			}

			case "IndexExpr": {
				const base = this.genExpr(expr.expr);
				const idx = this.genExpr(expr.index);
				if (expr._mapValueType && !expr._lvalue) {
					const zero = this.zeroValueForType(expr._mapValueType);
					return `(${base}[${idx}] ?? ${zero})`;
				}
				return `${base}[${idx}]`;
			}

			case "SliceExpr": {
				const base = this.genExpr(expr.expr);
				const lo = expr.low ? this.genExpr(expr.low) : "";
				const hi = expr.high ? this.genExpr(expr.high) : "";
				if (!lo && !hi) return `${base}.slice()`;
				if (!hi) return `${base}.slice(${lo})`;
				return `${base}.slice(${lo}, ${hi})`;
			}

			case "CompositeLit":
				return this.genCompositeLit(expr);

			case "FuncLit": {
				const params = expr.params.map((p) => p.name).join(", ");
				const asyncPrefix = expr.async ? "async " : "";
				const saved = this.out;
				this.out = [];
				this.indented(() => this._genBody(expr.body));
				const body = this.out.join("\n");
				this.out = saved;
				return `${asyncPrefix}function(${params}) {\n${body}\n${"  ".repeat(this.indent)}}`;
			}

			case "TypeConversion": {
				const inner = this.genExpr(expr.expr);
				const t = expr.targetType;

				// Slice type conversions
				if (t?.kind === "SliceType") {
					const elem = t.elem?.name;
					// []byte(s) → UTF-8 byte array
					if (elem === "byte" || elem === "uint8") {
						return `Array.from(new TextEncoder().encode(${inner}))`;
					}
					// []rune(s) → Unicode code point array (only when source is a string)
					if (elem === "rune" || elem === "int32" || elem === "int") {
						const srcType = expr.expr._type;
						if (srcType?.kind === "basic" && srcType?.name === "string") {
							return `Array.from(${inner}, __c => __c.codePointAt(0))`;
						}
						return `Array.from(${inner})`;
					}
					return `Array.from(${inner})`;
				}

				const target = t?.name;
				switch (target) {
					case "string":
						return `String(${inner})`;
					case "int":
					case "byte":
					case "rune":
						return `Math.trunc(Number(${inner}))`;
					case "float64":
						return `Number(${inner})`;
					case "bool":
						return `Boolean(${inner})`;
					default:
						return inner;
				}
			}

			case "TypeAssertExpr": {
				const val = this.genExpr(expr.expr);
				if (!expr._commaOk) return val; // unsafe assertion — just pass value through
				// comma-ok: emit [value, runtimeTypeCheck]
				const check = this._typeCheckExpr(expr.type, val);
				return `[${val}, ${check}]`;
			}

			case "AwaitExpr":
				return `await ${this.genExpr(expr.expr)}`;

			case "RangeExpr":
				return this.genExpr(expr.expr);

			default:
				throw new Error(`CodeGen: unhandled expression kind '${expr.kind}'`);
		}
	}

	genCall(expr) {
		// Handle built-ins that need special JS translation
		if (expr.func.kind === "Ident") {
			switch (expr.func.name) {
				case "append":
					return this.genAppend(expr);
				case "len": {
					const arg = expr.args[0];
					const t = arg?._type;
					const js = this.genExpr(arg);
					if (t?.kind === "map") return `Object.keys(${js}).length`;
					this._usesLen = true;
					return `__len(${js})`;
				}
				case "cap":
					return `${this.genExpr(expr.args[0])}.length`;
				case "make":
					return this.genMake(expr);
				case "delete": {
					const [m, k] = expr.args.map((a) => this.genExpr(a));
					return `(delete ${m}[${k}])`;
				}
				case "copy": {
					const [dst, src] = expr.args.map((a) => this.genExpr(a));
					return `((__cd,__cs)=>{const n=Math.min(__cd.length,__cs.length);__cd.splice(0,n,...__cs.slice(0,n));return n;})(${dst},${src})`;
				}
				case "new": {
					const zero = this.zeroValueForExpr(expr.args[0]);
					return `{ value: ${zero} }`;
				}
				case "print":
				case "println": {
					const args = expr.args.map((a) => this.genExpr(a)).join(", ");
					return `console.log(${args})`;
				}
				case "panic": {
					const arg = this.genExpr(expr.args[0]);
					return `(() => { throw new Error(${arg}); })()`;
				}
				case "recover":
					return `(typeof __panic !== "undefined" && __panic !== null ? (() => { const __r = __panic.message ?? String(__panic); __panic = null; return __r; })() : null)`;
				case "error": {
					// errors are plain strings; nil (null) means no error
					const arg = this.genExpr(expr.args[0]);
					return arg;
				}
			}
		}

		// error.Error() → the error string itself (errors are plain strings at runtime)
		if (
			expr.func.kind === "SelectorExpr" &&
			expr.func.field === "Error" &&
			expr.func.expr._type?.name === "error"
		) {
			return this.genExpr(expr.func.expr);
		}

		// fmt.Sprintf / fmt.Printf / fmt.Println / fmt.Print / fmt.Errorf
		if (
			expr.func.kind === "SelectorExpr" &&
			expr.func.expr.kind === "Ident" &&
			expr.func.expr.name === "fmt"
		) {
			const fmtArgs = expr.args.map((a) => this.genExpr(a)).join(", ");
			switch (expr.func.field) {
				case "Sprintf":
					this._usesSprintf = true;
					return `__sprintf(${fmtArgs})`;
				case "Errorf":
					this._usesSprintf = true;
					return `__sprintf(${fmtArgs})`;
				case "Printf":
					this._usesSprintf = true;
					return `process?.stdout?.write(__sprintf(${fmtArgs}))`;
				case "Println":
					this._usesSprintf = true;
					return `console.log(__sprintf(${fmtArgs}))`;
				case "Print":
					this._usesSprintf = true;
					return `process?.stdout?.write(__sprintf(${fmtArgs}))`;
			}
		}

		const rawFn = this.genExpr(expr.func);
		// Wrap function literals in parens so `function(){}()` → `(function(){})()`
		const fn = expr.func.kind === "FuncLit" ? `(${rawFn})` : rawFn;
		const args = expr.args
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)))
			.join(", ");
		return `${fn}(${args})`;
	}

	genAppend(expr) {
		const slice = this.genExpr(expr.args[0]);
		const elems = expr.args
			.slice(1)
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)));
		if (elems.length === 0) return slice;
		this._usesAppend = true;
		return `__append(${slice}, ${elems.join(", ")})`;
	}

	genMake(expr) {
		// make([]T, n) or make([]T, n, cap) → new Array(n).fill(zero)
		// make(map[K]V) → {}
		const typeArg = expr.args[0];
		const typeNode = typeArg.kind === "TypeExpr" ? typeArg.type : typeArg;
		const resolvedKind = typeArg._type?.kind;
		if (typeNode.kind === "SliceType" || resolvedKind === "slice") {
			const n = expr.args[1] ? this.genExpr(expr.args[1]) : "0";
			// Use the proper zero value for the element type (e.g. new Point() not 0)
			const elemNode = typeNode.kind === "SliceType" ? typeNode.elem : null;
			const elemResolved =
				typeArg._type?.kind === "slice" ? typeArg._type.elem : null;
			let zero = "null";
			if (elemResolved) {
				zero = this.zeroValueForType(elemResolved);
			} else if (elemNode) {
				zero = this.zeroValueForTypeNode(elemNode);
			}
			// If zero value is a constructor call, use a factory function so each element is distinct
			if (zero.startsWith("new ")) {
				return `Array.from({length: ${n}}, () => ${zero})`;
			}
			return `new Array(${n}).fill(${zero})`;
		}
		// map or fallback
		return "{}";
	}

	// Render KeyValueExpr elements as a JS field list string.
	// Handles embedded-spread (_isEmbedInit) and plain key: value pairs.
	_genStructFields(elems) {
		return elems
			.filter((e) => e.kind === "KeyValueExpr")
			.map((e) =>
				e._isEmbedInit
					? `...${this.genExpr(e.value)}`
					: `${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`,
			)
			.join(", ");
	}

	genCompositeLit(expr) {
		const t = expr.typeExpr;

		// Implicit composite literal: {X: 1} inside a slice/map — type inferred from context
		if (t === null) {
			if (expr.elems.length > 0 && expr.elems[0]?.kind === "KeyValueExpr") {
				const typeName = expr._type?.name ?? expr._type?.underlying?.name;
				if (typeName && this.structNames.has(typeName)) {
					return `new ${typeName}({ ${this._genStructFields(expr.elems)} })`;
				}
				const fields = expr.elems
					.map(
						(e) =>
							`${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`,
					)
					.join(", ");
				return `{ ${fields} }`;
			}
			return `[${expr.elems.map((e) => this.genExpr(e)).join(", ")}]`;
		}

		const typeName = this.getTypeName(t);

		// Struct: new Foo({ X: 1, Y: 2 })
		if (typeName && this.structNames.has(typeName)) {
			return `new ${typeName}({ ${this._genStructFields(expr.elems)} })`;
		}

		// Slice/array: [1, 2, 3]
		if (t?.kind === "SliceType" || t?.kind === "ArrayType") {
			const elems = expr.elems
				.map((e) =>
					e.kind === "KeyValueExpr" ? this.genExpr(e.value) : this.genExpr(e),
				)
				.join(", ");
			return `[${elems}]`;
		}

		// Map: { key: value }
		if (t?.kind === "MapType") {
			const entries = expr.elems
				.map((e) => {
					if (e.kind === "KeyValueExpr") {
						const k =
							e.key.litKind === "STRING"
								? JSON.stringify(e.key.value)
								: `[${this.genExpr(e.key)}]`;
						return `${k}: ${this.genExpr(e.value)}`;
					}
					return this.genExpr(e);
				})
				.join(", ");
			return `{ ${entries} }`;
		}

		// Fallback: key-value pairs → plain object, positional → array
		if (expr.elems.length > 0 && expr.elems[0]?.kind === "KeyValueExpr") {
			const fields = expr.elems
				.map(
					(e) =>
						`${e.key.name ?? this.genExpr(e.key)}: ${this.genExpr(e.value)}`,
				)
				.join(", ");
			return `{ ${fields} }`;
		}
		return `[${expr.elems.map((e) => this.genExpr(e)).join(", ")}]`;
	}

	// ── Helpers ───────────────────────────────────────────────────

	getTypeName(typeNode) {
		if (!typeNode) return null;
		if (typeNode.kind === "TypeName") return typeNode.name;
		if (typeNode.kind === "Ident") return typeNode.name;
		if (typeNode.kind === "SelectorExpr") return typeNode.field;
		return null;
	}

	isIntType(t) {
		return t?.kind === "basic" && t.name === "int";
	}

	// Returns the JS zero-value literal for a basic type name, or null if not a basic type.
	_zeroForBasicName(name) {
		switch (name) {
			case "int":
			case "uint":
			case "int8":
			case "int16":
			case "int32":
			case "int64":
			case "uint8":
			case "uint16":
			case "uint32":
			case "uint64":
			case "uintptr":
			case "float32":
			case "float64":
			case "byte":
			case "rune":
				return "0";
			case "string":
				return '""';
			case "bool":
				return "false";
			default:
				return null;
		}
	}

	zeroValueForTypeNode(typeNode) {
		if (!typeNode) return "null";
		switch (typeNode.kind) {
			case "TypeName": {
				const basic = this._zeroForBasicName(typeNode.name);
				if (basic !== null) return basic;
				if (this.structNames.has(typeNode.name))
					return `new ${typeNode.name}()`;
				return "null";
			}
			case "SliceType":
				return "null";
			case "ArrayType":
				return "[]";
			case "MapType":
				return "{}";
			case "PointerType":
				return "null";
			default:
				return "null";
		}
	}

	// zeroValueForType operates on typechecker type objects (not AST type nodes).
	zeroValueForType(t) {
		if (!t) return "null";
		switch (t.kind) {
			case "basic": {
				const basic = this._zeroForBasicName(t.name);
				return basic !== null ? basic : "null";
			}
			case "slice":
				return "null";
			case "map":
				return "{}";
			case "named":
				if (this.structNames.has(t.name)) return `new ${t.name}()`;
				return "null";
			default:
				return "null";
		}
	}

	// Emit a JS boolean expression that checks whether `val` matches type node `t`.
	_typeCheckExpr(typeNode, val) {
		if (!typeNode) return "true";
		if (typeNode.kind === "TypeName") {
			switch (typeNode.name) {
				case "int":
				case "uint":
				case "int8":
				case "int16":
				case "int32":
				case "int64":
				case "uint8":
				case "uint16":
				case "uint32":
				case "uint64":
				case "uintptr":
				case "float32":
				case "float64":
				case "byte":
				case "rune":
					return `typeof ${val} === "number"`;
				case "string":
					return `typeof ${val} === "string"`;
				case "bool":
					return `typeof ${val} === "boolean"`;
				case "nil":
					return `${val} === null`;
				case "error":
					return `typeof ${val} === "string"`;
				default:
					if (this.structNames.has(typeNode.name))
						return `${val} instanceof ${typeNode.name}`;
					return "true"; // unknown type — can't check at runtime
			}
		}
		return "true";
	}

	zeroValueForExpr(expr) {
		// For new(T) calls
		if (expr.kind === "Ident") {
			switch (expr.name) {
				case "int":
				case "float64":
					return "0";
				case "string":
					return '""';
				case "bool":
					return "false";
				default:
					if (this.structNames.has(expr.name)) return `new ${expr.name}()`;
			}
		}
		return "null";
	}

	typeComment(typeNode) {
		if (!typeNode) return "unknown";
		switch (typeNode.kind) {
			case "TypeName":
				return typeNode.name;
			case "SliceType":
				return `[]${this.typeComment(typeNode.elem)}`;
			case "MapType":
				return `map[${this.typeComment(typeNode.key)}]${this.typeComment(typeNode.value)}`;
			default:
				return typeNode.kind;
		}
	}
}
