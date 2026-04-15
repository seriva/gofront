// CodeGen statement methods — installed as a mixin on CodeGen.prototype.

export const statementGenMethods = {
	genBlock(block) {
		for (const stmt of block.stmts) this.genStmt(stmt);
	},

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
	},

	_genIf(stmt) {
		this.line(`if (${this.genExpr(stmt.cond)}) {`);
		this.indented(() => this.genBlock(stmt.body));
		this._genElse(stmt.elseBody);
	},

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
	},

	genFor(stmt) {
		// Detect range: init is DefineStmt with rhs[0] being a RangeExpr
		if (this.isRangeFor(stmt)) {
			this.genRangeFor(stmt);
			return;
		}

		// for range N { } — no variable, just repeat N times
		if (stmt.cond?.kind === "RangeExpr") {
			const iteree = this.genExpr(stmt.cond.expr);
			this.line(`for (let _$ = 0; _$ < ${iteree}; _$++) {`);
			this.indented(() => this.genBlock(stmt.body));
			this.line("}");
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
	},

	isRangeFor(stmt) {
		if (!stmt.init) return false;
		const init = stmt.init;
		if (init.kind !== "DefineStmt" && init.kind !== "AssignStmt") return false;
		return init.rhs?.[0]?.kind === "RangeExpr";
	},

	genRangeFor(stmt) {
		const init = stmt.init;
		const range = init.rhs[0];
		const lhs = init.lhs.map((e) => e.name ?? this.genExpr(e));
		const iteree = this.genExpr(range.expr);
		const iterType = range.expr._type;

		let iterExpr;
		if (
			lhs.length <= 1 &&
			iterType?.kind === "basic" &&
			(iterType.name === "int" || iterType.name === "float64")
		) {
			// integer range (Go 1.22): for i := range n  → C-style for loop
			const v = lhs[0] === "_" ? "_$" : lhs[0];
			this.line(`for (let ${v} = 0; ${v} < ${iteree}; ${v}++) {`);
			this.indented(() => this.genBlock(stmt.body));
			this.line("}");
			return;
		}
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
	},

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
	},

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
	},

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
	},
};
