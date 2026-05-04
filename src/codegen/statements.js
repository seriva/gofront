// CodeGen statement methods — installed as a mixin on CodeGen.prototype.

import { isComplex } from "../typechecker/types.js";

/** @typedef {import('./index.js').CodeGen} CodeGen */

// Method-name dispatch for genStmt — string values add no static call edges.
const STMT_GEN_DELEGATE = {
	VarDecl: "genVarDecl",
	ConstDecl: "genConstDecl",
	DefineStmt: "_genDefineStmt",
	AssignStmt: "_genAssignStmt",
	ReturnStmt: "_genReturnStmt",
	ForStmt: "genFor",
	SwitchStmt: "genSwitch",
	TypeSwitchStmt: "genTypeSwitch",
	BranchStmt: "_genBranchStmt",
};

/** @type {ThisType<CodeGen>} */
export const statementGenMethods = {
	genBlock(block) {
		for (const stmt of block.stmts) this.genStmt(stmt);
	},

	// Shared helper for comma-ok map index in both DefineStmt and AssignStmt.
	// isDefine=true  → emit `let v = m[k]; let ok = k in m;`
	// isDefine=false → emit `v = k in m ? m[k] : zero; ok = k in m;`
	_genCommaOkMapIndex(stmt, rhsNode, isDefine) {
		const mapExpr = this.genExpr(rhsNode.expr);
		const keyExpr = this.genExpr(rhsNode.index);
		const [vName, okName] = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
		const decl = isDefine ? "let " : "";
		if (vName !== "_") {
			if (isDefine) {
				this.line(`let ${vName} = ${mapExpr}[${keyExpr}];`);
			} else {
				const zero = rhsNode._mapValueType
					? this.zeroValueForType(rhsNode._mapValueType)
					: "undefined";
				this.line(
					`${vName} = (${keyExpr}) in ${mapExpr} ? ${mapExpr}[${keyExpr}] : ${zero};`,
				);
			}
		}
		if (okName !== "_")
			this.line(`${decl}${okName} = (${keyExpr}) in ${mapExpr};`);
	},

	genStmt(stmt) {
		// Record source mapping for the first line this statement produces
		const srcLine = stmt._line ?? null;
		const _line0 = this.out.length;
		switch (stmt.kind) {
			case "TypeDecl":
				this.genTypeDeclWithMethods(stmt, []);
				break;
			case "IncDecStmt":
				this.line(`${this.genExpr(stmt.expr)}${stmt.op};`);
				break;
			case "ExprStmt":
				this.line(`${this.genExpr(stmt.expr)};`);
				break;
			case "IfStmt":
				if (stmt.init) {
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
			case "DeferStmt":
				this.line(`__defers.push(() => { ${this.genExpr(stmt.call)}; });`);
				break;
			case "LabeledStmt":
				this.line(`${stmt.label}:`);
				this.genStmt(stmt.body);
				break;
			case "Block":
				this.line("{");
				this.indented(() => this.genBlock(stmt));
				this.line("}");
				break;
			default: {
				const m = STMT_GEN_DELEGATE[stmt.kind];
				if (m) {
					this[m](stmt);
					break;
				}
				throw new Error(`CodeGen: unhandled statement kind '${stmt.kind}'`);
			}
		}
		// Record source mapping: first output line this statement produced
		if (srcLine != null && this.out.length > _line0) {
			this._srcMappings.push({ genLine: _line0, srcLine: srcLine - 1 });
		}
	},

	_isCommaOkMapExpr(stmt, rhsNode) {
		return (
			stmt.rhs.length === 1 &&
			stmt.lhs.length === 2 &&
			rhsNode?.kind === "IndexExpr" &&
			rhsNode.expr?._type?.kind === "map"
		);
	},

	_genDefineSingleVar(lhs, rhs, redecls) {
		const isBoxed = this._boxedVars.has(lhs[0]);
		const val = isBoxed && !redecls[0] ? `{ value: ${rhs[0]} }` : rhs[0];
		if (redecls[0]) {
			if (isBoxed) this.line(`${lhs[0]}.value = ${rhs[0]};`);
			else this.line(`${lhs[0]} = ${val};`);
		} else {
			this.line(`let ${lhs[0]} = ${val};`);
		}
	},

	_genDefineMixedRedecl(lhs, rhs, redecls) {
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
	},

	_genDefineStmt(stmt) {
		const rhsNode = stmt.rhs[0];
		if (this._isCommaOkMapExpr(stmt, rhsNode)) {
			this._genCommaOkMapIndex(stmt, rhsNode, true);
			return;
		}
		const rhs = stmt.rhs.map((e) => this.genExpr(e));
		const lhs = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
		const redecls = stmt.lhs.map((e) => !!e._redecl);
		const anyRedecl = redecls.some((r) => r);
		if (lhs.length === 1) {
			this._genDefineSingleVar(lhs, rhs, redecls);
		} else if (!anyRedecl) {
			const rhsStr = rhs.length === 1 ? rhs[0] : `[${rhs.join(", ")}]`;
			this.line(`let [${lhs.join(", ")}] = ${rhsStr};`);
		} else {
			this._genDefineMixedRedecl(lhs, rhs, redecls);
		}
	},

	_isComplexCompoundAssign(stmt) {
		return (
			stmt.op !== "=" &&
			stmt.lhs.length === 1 &&
			stmt.rhs.length === 1 &&
			isComplex(stmt.lhs[0]._type)
		);
	},

	_isCommaOkAssertStmt(stmt) {
		return (
			stmt.lhs.length === 2 && stmt.rhs.length === 1 && stmt.rhs[0]._commaOk
		);
	},

	_genAssignLhsExpr(e) {
		if (e.kind === "Ident" && e.name !== "_" && this._boxedVars.has(e.name))
			return `${e.name}.value`;
		return e.name ?? this.genExpr(e);
	},

	_markIndexLvalues(exprs) {
		for (const e of exprs) if (e.kind === "IndexExpr") e._lvalue = true;
	},

	_genAssignMulti(stmt, lhs, rhs, active, pairs) {
		const rhsStr = rhs.length === 1 ? rhs[0] : `[${rhs.join(", ")}]`;
		if (active.length === pairs.length) {
			this.line(`[${lhs.join(", ")}] = ${rhsStr};`);
		} else {
			this._genMultiAssignWithBlanks(stmt, lhs, rhs, rhsStr);
		}
	},

	_genAssignStmt(stmt) {
		if (this._isComplexCompoundAssign(stmt)) {
			this._genComplexCompoundAssign(stmt);
			return;
		}
		if (stmt._commaOkMap) {
			this._genCommaOkMapIndex(stmt, stmt.rhs[0], false);
			return;
		}
		if (this._isCommaOkAssertStmt(stmt)) {
			this._genCommaOkTypeAssert(stmt);
			return;
		}
		const rhs = stmt.rhs.map((e) => this.genExpr(e));
		this._markIndexLvalues(stmt.lhs);
		const lhs = stmt.lhs.map((e) => this._genAssignLhsExpr(e));
		const pairs = lhs.map((l, i) => ({ l, r: rhs[i] ?? rhs[0] }));
		const active = pairs.filter((p) => p.l !== "_");
		if (active.length === 0) {
			if (rhs.length > 0) this.line(`${rhs[0]};`);
		} else if (lhs.length === 1) {
			this.line(`${active[0].l} ${stmt.op} ${active[0].r};`);
		} else {
			this._genAssignMulti(stmt, lhs, rhs, active, pairs);
		}
	},

	_genCommaOkTypeAssert(stmt) {
		const val = this.genExpr(stmt.rhs[0]);
		const [vName, okName] = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
		const tmp = "__ta";
		this.line(`let ${tmp} = ${val};`);
		if (vName !== "_") this.line(`${vName} = ${tmp}[0];`);
		if (okName !== "_") this.line(`${okName} = ${tmp}[1];`);
	},

	_genMultiAssignWithBlanks(stmt, lhs, rhs, rhsStr) {
		const tmp = "__t";
		this.line(`let ${tmp} = ${rhsStr};`);
		for (let i = 0; i < lhs.length; i++) {
			if (lhs[i] !== "_") {
				const src = rhs.length === 1 ? `${tmp}[${i}]` : rhs[i];
				this.line(`${lhs[i]} ${stmt.op} ${src};`);
			}
		}
	},

	_genComplexCompoundAssign(stmt) {
		const lhsStr = stmt.lhs[0].name ?? this.genExpr(stmt.lhs[0]);
		const rhsExpr = this._genComplexOperand(stmt.rhs[0]);
		const baseOp = stmt.op.slice(0, -1); // "+=" → "+"
		let result;
		switch (baseOp) {
			case "+":
				result = `{ re: ${lhsStr}.re + ${rhsExpr}.re, im: ${lhsStr}.im + ${rhsExpr}.im }`;
				break;
			case "-":
				result = `{ re: ${lhsStr}.re - ${rhsExpr}.re, im: ${lhsStr}.im - ${rhsExpr}.im }`;
				break;
			case "*":
				this._usesCmul = true;
				result = `__cmul(${lhsStr}, ${rhsExpr})`;
				break;
			case "/":
				this._usesCdiv = true;
				result = `__cdiv(${lhsStr}, ${rhsExpr})`;
				break;
			default:
				throw new Error(
					`unsupported complex compound assignment operator: ${stmt.op}`,
				);
		}
		this.line(`${lhsStr} = ${result};`);
	},

	_genIteratorReturn(stmt) {
		if (stmt.values.length === 0 && !this.namedReturnVars?.length) {
			this.line(`${this._iterReturnFlag} = true; return false;`);
			return;
		}
		const vals =
			stmt.values.length > 0
				? stmt.values.map((v) => this.genExpr(v))
				: (this.namedReturnVars ?? []);
		const stored = vals.length === 1 ? vals[0] : `[${vals.join(", ")}]`;
		this.line(
			`${this._iterReturnFlag} = true; ${this._iterReturnVar} = ${stored}; return false;`,
		);
	},

	_genReturnStmt(stmt) {
		if (this._inIteratorBody) {
			this._genIteratorReturn(stmt);
			return;
		}
		if (stmt.values.length === 0) {
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
	},

	_genBranchStmt(stmt) {
		if (this._inIteratorBody && !stmt.label) {
			if (stmt.keyword === "break") {
				this.line(`${this._iterBreakFlag} = true; return false;`);
				return;
			}
			if (stmt.keyword === "continue") {
				this.line("return true;");
				return;
			}
		}
		if (stmt.keyword !== "fallthrough")
			this.line(
				stmt.label ? `${stmt.keyword} ${stmt.label};` : `${stmt.keyword};`,
			);
		// fallthrough: omit — JS switch falls through naturally without a break
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

	_genRangeExprFor(stmt) {
		if (stmt.cond._isIterator) {
			this.genIteratorForCond(stmt);
			return;
		}
		const iteree = this.genExpr(stmt.cond.expr);
		this.line(`for (let _$ = 0; _$ < ${iteree}; _$++) {`);
		this.indented(() => this.genBlock(stmt.body));
		this.line("}");
	},

	_genSimpleWhileFor(stmt) {
		if (!stmt.cond) {
			this.line("while (true) {");
		} else {
			this.line(`while (${this.genExpr(stmt.cond)}) {`);
		}
		this.indented(() => this.genBlock(stmt.body));
		this.line("}");
	},

	genFor(stmt) {
		if (this.isRangeFor(stmt)) {
			if (stmt.init.rhs[0]._isIterator) this.genIteratorFor(stmt);
			else this.genRangeFor(stmt);
			return;
		}
		if (stmt.cond?.kind === "RangeExpr") {
			this._genRangeExprFor(stmt);
			return;
		}
		if (!stmt.init && !stmt.post) {
			this._genSimpleWhileFor(stmt);
			return;
		}
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

	_isIntRangeType(iterType) {
		return (
			(iterType?.kind === "basic" &&
				(iterType.name === "int" || iterType.name === "float64")) ||
			(iterType?.kind === "untyped" &&
				(iterType.base === "int" || iterType.base === "float64"))
		);
	},

	_isMapRangeType(iterType) {
		return (
			iterType?.kind === "map" ||
			(iterType?.kind === "named" && iterType.underlying?.kind === "map")
		);
	},

	_isStringRangeType(iterType) {
		return (
			(iterType?.kind === "basic" && iterType.name === "string") ||
			(iterType?.kind === "untyped" && iterType.base === "string")
		);
	},

	genRangeFor(stmt) {
		const init = stmt.init;
		const range = init.rhs[0];
		const lhs = init.lhs.map((e) => e.name ?? this.genExpr(e));
		const iterType = range.expr._type;
		const wrapField = this._namedWrapperField(iterType, range.expr);
		const iteree = wrapField
			? `${this.genExpr(range.expr)}.${wrapField}`
			: this.genExpr(range.expr);

		if (lhs.length <= 1 && this._isIntRangeType(iterType)) {
			const v = lhs[0] === "_" ? "_$" : lhs[0];
			this.line(`for (let ${v} = 0; ${v} < ${iteree}; ${v}++) {`);
			this.indented(() => this.genBlock(stmt.body));
			this.line("}");
			return;
		}
		const iterExpr = this._genRangeIterExpr(iterType, iteree, lhs);
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

	_genRangeIterExpr(iterType, iteree, lhs) {
		if (this._isMapRangeType(iterType)) return `Object.entries(${iteree})`;
		if (this._isStringRangeType(iterType)) {
			if (lhs.length === 1) return `Array.from(${iteree}).keys()`;
			return `Array.from(${iteree}, (__c, __i) => [__i, __c.codePointAt(0)])`;
		}
		this._usesSliceGuard = true;
		if (lhs.length === 1) return `__s(${iteree}).keys()`;
		return `__s(${iteree}).entries()`;
	},

	genIteratorFor(stmt) {
		const range = stmt.init.rhs[0];
		const lhs = stmt.init.lhs.map((e) => e.name ?? this.genExpr(e));
		let iteree = this.genExpr(range.expr);
		const yieldParams = range._yieldParams;

		// Wrap bare function expressions to avoid "Function statements require a name"
		if (range.expr.kind === "FuncLit") {
			iteree = `(${iteree})`;
		}

		const d = this._iterDepth++;
		const breakFlag = `__broke${d}`;
		const retFlag = `__returned${d}`;
		const retVar = `__retVal${d}`;

		// Yield callback param names (blank vars get _$N to avoid JS syntax error)
		const cbParams = lhs.map((n, i) => (n === "_" ? `_$${i}` : n));

		this.line("{");
		this.indented(() => {
			this.line(`let ${breakFlag} = false;`);
			this.line(`let ${retFlag} = false;`);
			this.line(`let ${retVar};`);

			const params = yieldParams.length === 0 ? "" : cbParams.join(", ");
			this.line(`${iteree}(function(${params}) {`);
			this.indented(() => {
				this.line(`if (${breakFlag}) return false;`);
				const prev = {
					in: this._inIteratorBody,
					break: this._iterBreakFlag,
					ret: this._iterReturnFlag,
					retVar: this._iterReturnVar,
				};
				this._inIteratorBody = true;
				this._iterBreakFlag = breakFlag;
				this._iterReturnFlag = retFlag;
				this._iterReturnVar = retVar;

				this.genBlock(stmt.body);

				this._inIteratorBody = prev.in;
				this._iterBreakFlag = prev.break;
				this._iterReturnFlag = prev.ret;
				this._iterReturnVar = prev.retVar;

				this.line("return true;");
			});
			this.line("});");
			this.line(`if (${retFlag}) return ${retVar};`);
		});
		this.line("}");
		this._iterDepth--;
	},

	// 0-param iterator: for range iter { body }
	genIteratorForCond(stmt) {
		const range = stmt.cond;
		let iteree = this.genExpr(range.expr);

		if (range.expr.kind === "FuncLit") {
			iteree = `(${iteree})`;
		}

		const d = this._iterDepth++;
		const breakFlag = `__broke${d}`;
		const retFlag = `__returned${d}`;
		const retVar = `__retVal${d}`;

		this.line("{");
		this.indented(() => {
			this.line(`let ${breakFlag} = false;`);
			this.line(`let ${retFlag} = false;`);
			this.line(`let ${retVar};`);

			this.line(`${iteree}(function() {`);
			this.indented(() => {
				this.line(`if (${breakFlag}) return false;`);
				const prev = {
					in: this._inIteratorBody,
					break: this._iterBreakFlag,
					ret: this._iterReturnFlag,
					retVar: this._iterReturnVar,
				};
				this._inIteratorBody = true;
				this._iterBreakFlag = breakFlag;
				this._iterReturnFlag = retFlag;
				this._iterReturnVar = retVar;

				this.genBlock(stmt.body);

				this._inIteratorBody = prev.in;
				this._iterBreakFlag = prev.break;
				this._iterReturnFlag = prev.ret;
				this._iterReturnVar = prev.retVar;

				this.line("return true;");
			});
			this.line("});");
			this.line(`if (${retFlag}) return ${retVar};`);
		});
		this.line("}");
		this._iterDepth--;
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
