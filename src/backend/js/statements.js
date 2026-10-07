import {
	bodyRedeclares,
	isIntRangeType,
	isMapRangeType,
	isRangeFor,
	isSimpleIntRange,
	isStringRangeType,
	nodeAssigns,
} from "../../lower/index.js";
import { isComplex } from "../../typechecker/types.js";

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
	_genCommaOkMapIndex(stmt, rhsNode, isDefine) {
		const mapExpr = this.genExpr(rhsNode.expr);
		const keyExpr = this.genExpr(rhsNode.index);
		const [vName, okName] = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
		const decl = isDefine ? "let " : "";
		if (isDefine && !this.strict) {
			if (vName !== "_") {
				this.line(`let ${vName} = ${mapExpr}[${keyExpr}];`);
			}
			if (okName !== "_") {
				this.line(`let ${okName} = (${keyExpr}) in ${mapExpr};`);
			}
			return;
		}
		const zero = rhsNode._mapValueType
			? this.zeroValueForType(rhsNode._mapValueType)
			: "undefined";
		this._tmpCounter = (this._tmpCounter ?? 0) + 1;
		const mTmp = `__m${this._tmpCounter}`;
		const kTmp = `__k${this._tmpCounter}`;
		this.line(`const ${mTmp} = ${mapExpr}, ${kTmp} = ${keyExpr};`);
		if (vName !== "_") {
			this.line(
				`${decl}${vName} = (${mTmp} && (${kTmp} in ${mTmp})) ? ${mTmp}[${kTmp}] : ${zero};`,
			);
		}
		if (okName !== "_") {
			this.line(`${decl}${okName} = Boolean(${mTmp} && (${kTmp} in ${mTmp}));`);
		}
	},

	genStmt(stmt) {
		// Record source mapping for the first line this statement produces
		const srcLine = stmt._line ?? null;
		const _line0 = this.out.length;
		switch (stmt.kind) {
			case "TypeDecl":
				this.genTypeDeclWithMethods(stmt, []);
				break;
			case "IncDecStmt": {
				if (stmt.expr.kind === "IndexExpr" && stmt.expr._mapValueType) {
					const zero = this.zeroValueForType(stmt.expr._mapValueType);
					const wrapField = this._namedWrapperField(
						stmt.expr.expr._type,
						stmt.expr.expr,
					);
					const base = wrapField
						? `${this.genExpr(stmt.expr.expr)}.${wrapField}`
						: this.genExpr(stmt.expr.expr);
					const idx = this.genExpr(stmt.expr.index);
					const op = stmt.op === "++" ? "+" : "-";
					if (
						this._hasCallExpr(stmt.expr.expr) ||
						this._hasCallExpr(stmt.expr.index)
					) {
						this.line(
							`((__m, __k) => { __m[__k] = (__m[__k] ?? ${zero}) ${op} 1; })(${base}, ${idx});`,
							srcLine,
						);
					} else {
						this.line(
							`${base}[${idx}] = (${base}[${idx}] ?? ${zero}) ${op} 1;`,
							srcLine,
						);
					}
					break;
				}
				if (
					this.strict &&
					this._genStrictCompound(
						stmt.expr,
						stmt.op === "++" ? "+" : "-",
						"1",
						srcLine,
					)
				)
					break;
				this.line(`${this.genExpr(stmt.expr)}${stmt.op};`, srcLine);
				break;
			}
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
			this._srcMappings.push({
				genLine: _line0,
				srcLine: srcLine - 1,
				srcFileIdx: this._currentSrcFileIdx,
			});
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
			this._tmpCounter = (this._tmpCounter ?? 0) + 1;
			const tmp = `__t${this._tmpCounter}`;
			this.line(`const ${tmp} = ${rhs[0]};`);
			for (let i = 0; i < lhs.length; i++) {
				if (lhs[i] === "_") continue;
				const prefix = redecls[i] ? "" : "let ";
				this.line(`${prefix}${lhs[i]} = ${tmp}[${i}];`);
			}
		} else {
			for (let i = 0; i < lhs.length; i++) {
				if (lhs[i] === "_") {
					this.line(`${rhs[i]};`);
					continue;
				}
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
		const paired = stmt.rhs.length === stmt.lhs.length;
		const rhs = stmt.rhs.map((e, i) => {
			const l = paired ? stmt.lhs[i] : null;
			if (!l || l.name === "_") return this.genExpr(e);
			if (l._redecl) return this.genValueExpr(e);
			return this._genDeclValue(l.name, e);
		});
		const lhs = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
		const redecls = stmt.lhs.map((e) => !!e._redecl);
		const anyRedecl = redecls.some((r) => r);
		if (lhs.length === 1) {
			this._genDefineSingleVar(lhs, rhs, redecls);
		} else if (!anyRedecl) {
			const rhsStr = rhs.length === 1 ? rhs[0] : `[${rhs.join(", ")}]`;
			const names = lhs.map((n) => (n === "_" ? "" : n));
			this.line(`let [${names.join(", ")}] = ${rhsStr};`);
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

	_isStructDerefAssign(stmt) {
		if (stmt.lhs.length !== 1 || stmt.rhs.length !== 1 || stmt.op !== "=")
			return false;
		const l = stmt.lhs[0];
		return (
			l.kind === "UnaryExpr" &&
			l.op === "*" &&
			this._isStructPointerType(l.operand?._type)
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
		if (this._isStructDerefAssign(stmt)) {
			this._genStructDerefAssign(stmt);
			return;
		}
		const paired = stmt.rhs.length === stmt.lhs.length && stmt.op === "=";
		const rhs = stmt.rhs.map((e, i) =>
			paired && stmt.lhs[i].name !== "_"
				? this.genValueExpr(e)
				: this.genExpr(e),
		);
		this._markIndexLvalues(stmt.lhs);
		const lhs = stmt.lhs.map((e) => this._genAssignLhsExpr(e));
		const pairs = lhs.map((l, i) => ({ l, r: rhs[i] ?? rhs[0] }));
		const active = pairs.filter((p) => p.l !== "_");
		if (active.length === 0) {
			if (rhs.length > 0) this.line(`${rhs[0]};`);
		} else if (lhs.length === 1) {
			if (
				stmt.op !== "=" &&
				stmt.lhs[0].kind === "IndexExpr" &&
				stmt.lhs[0]._mapValueType
			) {
				const zero = this.zeroValueForType(stmt.lhs[0]._mapValueType);
				const wrapField = this._namedWrapperField(
					stmt.lhs[0].expr._type,
					stmt.lhs[0].expr,
				);
				const base = wrapField
					? `${this.genExpr(stmt.lhs[0].expr)}.${wrapField}`
					: this.genExpr(stmt.lhs[0].expr);
				const idx = this.genExpr(stmt.lhs[0].index);
				const binOp = stmt.op.slice(0, -1);
				if (
					this._hasCallExpr(stmt.lhs[0].expr) ||
					this._hasCallExpr(stmt.lhs[0].index)
				) {
					this.line(
						`((__m, __k) => { __m[__k] = (__m[__k] ?? ${zero}) ${binOp} (${active[0].r}); })(${base}, ${idx});`,
					);
				} else {
					this.line(
						`${base}[${idx}] = (${base}[${idx}] ?? ${zero}) ${binOp} (${active[0].r});`,
					);
				}
				return;
			}
			if (
				this.strict &&
				stmt.op !== "=" &&
				this._genStrictCompound(
					stmt.lhs[0],
					stmt.op.slice(0, -1),
					active[0].r,
					null,
					active[0].l,
				)
			) {
				return;
			}
			this.line(`${active[0].l} ${stmt.op} ${active[0].r};`);
		} else {
			this._genAssignMulti(stmt, lhs, rhs, active, pairs);
		}
	},

	_genCommaOkTypeAssert(stmt) {
		const val = this.genExpr(stmt.rhs[0]);
		const [vName, okName] = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
		this._tmpCounter = (this._tmpCounter ?? 0) + 1;
		const tmp = `__ta${this._tmpCounter}`;
		this.line(`const ${tmp} = ${val};`);
		if (vName !== "_") this.line(`${vName} = ${tmp}[0];`);
		if (okName !== "_") this.line(`${okName} = ${tmp}[1];`);
	},

	_genStructDerefAssign(stmt) {
		const target = this.genExpr(stmt.lhs[0].operand);
		const rhsNode = stmt.rhs[0];
		const fields = this._aggregateBase(rhsNode._type)?.fields;
		const shallowOk =
			fields instanceof Map &&
			![...fields.values()].some((t) => this._aggregateBase(t));
		const source = shallowOk
			? this.genExpr(rhsNode)
			: this.genValueExpr(rhsNode);
		this.line(`Object.assign(${target}, ${source});`);
	},

	_genMultiAssignWithBlanks(stmt, lhs, rhs, rhsStr) {
		this._tmpCounter = (this._tmpCounter ?? 0) + 1;
		const tmp = `__t${this._tmpCounter}`;
		this.line(`const ${tmp} = ${rhsStr};`);
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
				? stmt.values.map((v) => this._genReturnValue(v))
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
		} else if (this.namedReturnVars?.length > 0) {
			const vars = this.namedReturnVars;
			if (stmt.values.length === 1 && vars.length === 1) {
				this.line(`${vars[0]} = ${this._genReturnValue(stmt.values[0])};`);
			} else if (stmt.values.length === 1 && vars.length > 1) {
				const val = this._genReturnValue(stmt.values[0]);
				this.line(`[${vars.join(", ")}] = ${val};`);
			} else if (stmt.values.length > 1 && stmt.values.length === vars.length) {
				const temps = stmt.values.map((v) => this._genReturnValue(v));
				this.line(`[${vars.join(", ")}] = [${temps.join(", ")}];`);
			}
			this.line(
				vars.length === 1
					? `return ${vars[0]};`
					: `return [${vars.join(", ")}];`,
			);
		} else if (stmt.values.length === 1) {
			this.line(`return ${this._genReturnValue(stmt.values[0])};`);
		} else {
			this.line(
				`return [${stmt.values.map((v) => this._genReturnValue(v)).join(", ")}];`,
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

	_rangeExprLimit(iterType, iteree) {
		if (this._isIntRangeType(iterType)) return iteree;
		if (this._isMapRangeType(iterType)) return `Object.keys(${iteree}).length`;
		return `(${iteree} ? ${iteree}.length : 0)`;
	},

	_genRangeExprFor(stmt) {
		if (stmt.cond._isIterator) {
			this.genIteratorForCond(stmt);
			return;
		}
		const iterType = stmt.cond.expr._type;
		const iteree = this.genExpr(stmt.cond.expr);
		const limit = this._rangeExprLimit(iterType, iteree);
		this.line(`for (let _$ = 0; _$ < ${limit}; _$++) {`);
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
		return isRangeFor(stmt);
	},

	_isIntRangeType(iterType) {
		return isIntRangeType(iterType);
	},

	_isMapRangeType(iterType) {
		return isMapRangeType(iterType);
	},

	_isStringRangeType(iterType) {
		return isStringRangeType(iterType);
	},

	_rangeVarTarget(e, isAssign) {
		if (e.kind === "Ident") {
			if (e.name === "_") return null;
			const boxed = this._boxedVars.has(e.name);
			if (isAssign) return boxed ? `${e.name}.value = ` : `${e.name} = `;
			return boxed ? { name: e.name, boxed } : { name: e.name };
		}
		this._markIndexLvalues([e]);
		return `${this._genAssignLhsExpr(e)} = `;
	},

	_emitRangeVar(e, valueJs, isAssign) {
		if (!e) return;
		const target = this._rangeVarTarget(e, isAssign);
		if (target === null) return;
		if (typeof target === "string") {
			this.line(`${target}${valueJs};`);
			return;
		}
		const v = target.boxed ? `{ value: ${valueJs} }` : valueJs;
		this.line(`let ${target.name} = ${v};`);
	},

	// True when the body re-declares one of `names` at its top level (legal Go shadowing).
	_bodyRedeclares(body, names) {
		return bodyRedeclares(body, names);
	},

	// Range value variable: aliases the element unless the body writes the variable or the collection.
	_rangeElemValue(stmt, valNode, js, isAssign) {
		const iterNode = stmt.init.rhs[0].expr;
		const iterType = iterNode._type;
		const base = iterType?.kind === "named" ? iterType.underlying : iterType;
		const elemType = base?.elem;
		if (!valNode || !this._aggregateBase(elemType)) return js;
		if (isAssign || valNode.kind !== "Ident")
			return this._cloneJs(elemType, js);
		if (valNode.name === "_") return js;
		const root = this._rootIdentName(iterNode);
		const mutated =
			this._fnMutates(valNode.name) ||
			(root !== null && this._nodeMutatesVar(stmt.body, root));
		this._markOwnership(valNode.name, mutated);
		return mutated ? this._cloneJs(elemType, js) : js;
	},

	_genSliceRangeFor(stmt, iteree, isAssign) {
		this._loopDepth = this._loopDepth ?? 0;
		const d = this._loopDepth++;
		const [idxNode, valNode] = stmt.init.lhs;
		const i = `__i${d}`;
		const arr = `__arr${d}`;
		const len = `__len${d}`;
		this.line(
			`for (let ${i} = 0, ${arr} = ${iteree}, ${len} = ${arr} ? ${arr}.length : 0; ${i} < ${len}; ${i}++) {`,
		);
		this.indented(() => {
			this._emitRangeVar(idxNode, i, isAssign);
			this._emitRangeVar(
				valNode,
				this._rangeElemValue(stmt, valNode, `${arr}[${i}]`, isAssign),
				isAssign,
			);
			const declared = isAssign
				? []
				: [idxNode, valNode]
						.filter((e) => e?.kind === "Ident" && e.name !== "_")
						.map((e) => e.name);
			if (this._bodyRedeclares(stmt.body, declared)) {
				this.line("{");
				this.indented(() => this.genBlock(stmt.body));
				this.line("}");
			} else {
				this.genBlock(stmt.body);
			}
		});
		this.line("}");
		this._loopDepth--;
	},

	// Whether `for i := range n` can be emitted as a plain `for (let i = 0; …)` without hidden registers.
	_isSimpleIntRange(stmt, name, isAssign) {
		return isSimpleIntRange(stmt, name, isAssign, this._boxedVars);
	},

	_genIntRangeBody(stmt, name, isAssign) {
		const wrap = !isAssign && name && this._bodyRedeclares(stmt.body, [name]);
		if (!wrap) return this.genBlock(stmt.body);
		this.line("{");
		this.indented(() => this.genBlock(stmt.body));
		this.line("}");
	},

	_genIntRangeFor(stmt, iteree, isAssign) {
		const varNode = stmt.init.lhs[0];
		const name = varNode?.kind === "Ident" ? varNode.name : null;
		if (this._isSimpleIntRange(stmt, name, isAssign)) {
			const v = !name || name === "_" ? "_$" : name;
			this.line(`for (let ${v} = 0; ${v} < ${iteree}; ${v}++) {`);
			this.indented(() => this.genBlock(stmt.body));
			this.line("}");
			return;
		}
		this._loopDepth = this._loopDepth ?? 0;
		const d = this._loopDepth++;
		const i = `__i${d}`;
		const n = `__n${d}`;
		this.line(`for (let ${i} = 0, ${n} = ${iteree}; ${i} < ${n}; ${i}++) {`);
		this.indented(() => {
			this._emitRangeVar(varNode, i, isAssign);
			this._genIntRangeBody(stmt, name, isAssign);
		});
		this.line("}");
		this._loopDepth--;
	},

	// True when `node` contains an assignment or ++/-- targeting identifier `name`.
	_nodeAssigns(node, name) {
		return nodeAssigns(node, name);
	},

	_genIterFor(init, iterType, iteree, lhs, body) {
		const iterExpr = this._genRangeIterExpr(iterType, iteree, lhs);
		const binding =
			lhs.length === 1
				? lhs[0] === "_"
					? "_$"
					: lhs[0]
				: `[${lhs.map((n) => (n === "_" ? "_$" : n)).join(", ")}]`;
		const kw = init.kind === "AssignStmt" ? "" : "let ";
		this.line(`for (${kw}${binding} of ${iterExpr}) {`);
		this.indented(() => this.genBlock(body));
		this.line("}");
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
			this._genIntRangeFor(stmt, iteree, init.kind === "AssignStmt");
			return;
		}

		if (!this._isMapRangeType(iterType) && !this._isStringRangeType(iterType)) {
			this._genSliceRangeFor(stmt, iteree, init.kind === "AssignStmt");
			return;
		}

		this._genIterFor(init, iterType, iteree, lhs, stmt.body);
	},

	_genRangeIterExpr(iterType, iteree, lhs) {
		if (this._isMapRangeType(iterType)) {
			if (lhs.length === 1) return `Object.keys(${iteree})`;
			return `Object.entries(${iteree})`;
		}
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
