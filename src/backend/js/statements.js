import {
	bodyRedeclares,
	forEachChild,
	isIntRangeType,
	isMapRangeType,
	isRangeFor,
	isSimpleIntRange,
	isStringRangeType,
	loopVarsCapturedInLoop,
	nodeAssigns,
} from "../../lower/index.js";
import { isComplex, isTypedArraySlice } from "../../typechecker/types.js";

/** @typedef {import('./index.js').CodeGen} CodeGen */

// The same variable or field chain (`x`, `n.Children`) on both sides.
const sameChain = (a, b) =>
	a.kind === b.kind &&
	(a.kind === "Ident"
		? a.name === b.name && a.name !== "_"
		: a.kind === "SelectorExpr" &&
			a.field === b.field &&
			sameChain(a.expr, b.expr));

// `x = x[lo:hi]` (no max) with the same chain on both sides.
const isSelfResliceShape = (stmt) =>
	stmt.op === "=" &&
	stmt.lhs.length === 1 &&
	stmt.rhs.length === 1 &&
	stmt.rhs[0].kind === "SliceExpr" &&
	!stmt.rhs[0].max &&
	sameChain(stmt.lhs[0], stmt.rhs[0].expr);

// Pure index expressions that read the same value after the write as before
// it: literals, variables and fields not assigned by the statement, `len`
// and `cap`, and arithmetic over those.
const isStableIndex = (e, assigned) => {
	switch (e?.kind) {
		case "BasicLit":
			return true;
		case "Ident":
			return !assigned.has(e.name);
		case "SelectorExpr":
			return !e._isMethodValue && isStableIndex(e.expr, assigned);
		case "ParenExpr":
			return isStableIndex(e.expr, assigned);
		case "UnaryExpr":
			return e.op !== "<-" && isStableIndex(e.operand, assigned);
		case "BinaryExpr":
			return (
				isStableIndex(e.left, assigned) && isStableIndex(e.right, assigned)
			);
		case "CallExpr":
			return (
				e.func?.kind === "Ident" &&
				(e.func.name === "len" || e.func.name === "cap") &&
				e.args.every((a) => isStableIndex(a, assigned))
			);
		default:
			return false;
	}
};

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
		// An array map value is a copy, not the stored array.
		const valType = rhsNode._mapValueType;
		const copyVal = (js) =>
			this._aggregateBase(valType)?.kind === "array"
				? this._cloneJs(valType, js)
				: js;
		if (isDefine && !this.strict) {
			if (vName !== "_") {
				this.line(`let ${vName} = ${copyVal(`${mapExpr}[${keyExpr}]`)};`);
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
				`${decl}${vName} = (${mTmp} && (${kTmp} in ${mTmp})) ? ${copyVal(`${mTmp}[${kTmp}]`)} : ${zero};`,
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
		const syncs =
			stmt.kind === "AssignStmt"
				? this._resliceSyncs(stmt.lhs, stmt)
				: stmt.kind === "IncDecStmt"
					? this._resliceSyncs([stmt.expr], stmt)
					: null;
		switch (stmt.kind) {
			case "TypeDecl":
				this.genTypeDeclWithMethods(stmt, []);
				break;
			case "IncDecStmt": {
				this._markIndexLvalues([stmt.expr]);
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
							`((__m, __k) => { ${this._genMapWriteBase("__m")}[__k] = (__m[__k] ?? ${zero}) ${op} 1; })(${base}, ${idx});`,
							srcLine,
						);
					} else {
						this.line(
							`${this._genMapWriteBase(base)}[${idx}] = (${base}[${idx}] ?? ${zero}) ${op} 1;`,
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
				if (stmt.body && stmt.body.kind === "ForStmt") {
					stmt.body.label = stmt.label;
				}
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
		this._emitResliceSyncs(syncs);
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
		// `x, y := 2, x` reads the old `x`: evaluate every value first.
		this._tmpCounter = (this._tmpCounter ?? 0) + 1;
		const tmp = `__t${this._tmpCounter}`;
		const all = rhs.length === 1 ? rhs[0] : `[${rhs.join(", ")}]`;
		this.line(`const ${tmp} = ${all};`);
		for (let i = 0; i < lhs.length; i++) {
			if (lhs[i] === "_") continue;
			this._genDefineSingleVar([lhs[i]], [`${tmp}[${i}]`], [redecls[i]]);
		}
	},

	// Address-taken variables introduced by a destructuring declaration are
	// re-bound to their { value } box.
	_boxDeclaredNames(names) {
		for (const n of names) {
			if (n && n !== "_" && this._boxedVars.has(n))
				this.line(`${n} = { value: ${n} };`);
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
			this._boxDeclaredNames(names);
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

	// `x = x[lo:hi]` with the same variable or field chain on both sides:
	// the old value of `x` is replaced, so `_genSliceExpr` may copy instead
	// of building a slice view (`__reslice`).
	_markSelfReslice(stmt) {
		if (stmt.op !== "=" || stmt.lhs.length !== 1 || stmt.rhs.length !== 1)
			return;
		const r = stmt.rhs[0];
		if (r.kind !== "SliceExpr" || r.max) return;
		// A parameter or named result may alias the caller's slice: keep the
		// view.  Field chains (`n.Children = n.Children[:k]`) still copy.
		const lhs = stmt.lhs[0];
		if (lhs.kind === "Ident" && this._fnCtx?.params.has(lhs.name)) return;
		if (sameChain(stmt.lhs[0], r.expr)) r._selfReslice = true;
	},

	// Names of the variables and fields (`.F`) that some `x = x[lo:hi]` in the
	// program may turn into a `__reslice` copy (`_resliceSyncs`).
	_collectResliceNames(program) {
		const names = new Set();
		const visit = (n) => {
			if (Array.isArray(n)) {
				for (const c of n) visit(c);
				return;
			}
			if (!n || typeof n !== "object" || typeof n.kind !== "string") return;
			if (n.kind === "AssignStmt" && isSelfResliceShape(n)) {
				const l = n.lhs[0];
				names.add(l.kind === "Ident" ? l.name : `.${l.field}`);
			}
			forEachChild(n, visit);
		};
		visit(program.decls);
		this._resliceNames = names;
	},

	// Index writes in `lhs` whose slice may be a `__reslice` copy: each is
	// followed by `__rcs(x, i)` (`_emitResliceSyncs`), which writes the element
	// through to the copy's old array, so writes through the copy and through
	// other slices of that array keep Go's order.  An index that the write
	// could change, or that has a call, is first bound to a temporary (not in
	// `inline` for-clause statements, where the write-back on extension still
	// applies).  Not covered: writes through other references to the copy.
	_resliceSyncs(lhs, stmt, inline = false) {
		if (!this._resliceNames?.size) return null;
		const assigned = new Set();
		if (stmt.kind === "AssignStmt" && stmt.lhs.length > 1)
			for (const e of stmt.lhs) if (e.kind === "Ident") assigned.add(e.name);
		const out = [];
		for (const e of lhs) {
			if (!this._isResliceSyncTarget(e, assigned)) continue;
			if (!isStableIndex(e.index, assigned)) {
				if (inline) continue;
				this._tmpCounter = (this._tmpCounter ?? 0) + 1;
				const tmp = `__rci${this._tmpCounter}`;
				this.line(`const ${tmp} = ${this.genExpr(e.index)};`);
				e.index = { kind: "Ident", name: tmp, _type: e.index._type };
			}
			out.push(e);
		}
		if (out.length === 0) return null;
		this.useHelper("slice");
		return out.map((e) => {
			const wrapField = this._namedWrapperField(e.expr._type, e.expr);
			const base = wrapField
				? `${this.genExpr(e.expr)}.${wrapField}`
				: this.genExpr(e.expr);
			return `__rcs(${base}, ${this.genExpr(e.index)})`;
		});
	},

	// `x[i]` on a plain slice held by a chain in `_resliceNames` whose root
	// variable the statement does not reassign.
	_isResliceSyncTarget(e, assigned) {
		if (e.kind !== "IndexExpr" || e._mapValueType) return false;
		const c = e.expr;
		if (c.kind !== "Ident" && c.kind !== "SelectorExpr") return false;
		if (!this._resliceNames.has(c.kind === "Ident" ? c.name : `.${c.field}`))
			return false;
		const u = c._type?.kind === "named" ? c._type.underlying : c._type;
		if (u?.kind !== "slice" || isTypedArraySlice(c._type)) return false;
		let root = c;
		while (root.kind === "SelectorExpr") root = root.expr;
		return (
			root.kind === "Ident" &&
			!assigned.has(root.name) &&
			isStableIndex(c, assigned)
		);
	},

	_emitResliceSyncs(syncs) {
		if (syncs) for (const s of syncs) this.line(`${s};`);
	},

	_genAssignStmt(stmt) {
		this._markIndexLvalues(stmt.lhs);
		this._markSelfReslice(stmt);
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
						`((__m, __k) => { ${this._genMapWriteBase("__m")}[__k] = (__m[__k] ?? ${zero}) ${binOp} (${active[0].r}); })(${base}, ${idx});`,
					);
				} else {
					this.line(
						`${this._genMapWriteBase(base)}[${idx}] = (${base}[${idx}] ?? ${zero}) ${binOp} (${active[0].r});`,
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
			const targetL =
				active[0].l.startsWith("{") && !active[0].l.startsWith("({")
					? `(${active[0].l})`
					: active[0].l;
			this.line(`${targetL} ${stmt.op} ${active[0].r};`);
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
		const l = stmt.lhs[0];
		let lhsTarget;
		let lhsRead;
		if (l.kind === "IndexExpr" && l._mapValueType) {
			const wrapField = this._namedWrapperField(l.expr._type, l.expr);
			const base = wrapField
				? `${this.genExpr(l.expr)}.${wrapField}`
				: this.genExpr(l.expr);
			const idx = this.genExpr(l.index);
			lhsTarget = `${this._genMapWriteBase(base)}[${idx}]`;
			lhsRead = `(${base}[${idx}] ?? { re: 0, im: 0 })`;
		} else {
			lhsTarget = l.name ?? this.genExpr(l);
			lhsRead = lhsTarget;
		}
		const rhsExpr = this._genComplexOperand(stmt.rhs[0]);
		const baseOp = stmt.op.slice(0, -1); // "+=" → "+"
		let result;
		switch (baseOp) {
			case "+":
				result = `{ re: ${lhsRead}.re + ${rhsExpr}.re, im: ${lhsRead}.im + ${rhsExpr}.im }`;
				break;
			case "-":
				result = `{ re: ${lhsRead}.re - ${rhsExpr}.re, im: ${lhsRead}.im - ${rhsExpr}.im }`;
				break;
			case "*":
				this.useHelper("cmul");
				result = `__cmul(${lhsRead}, ${rhsExpr})`;
				break;
			case "/":
				this.useHelper("cdiv");
				result = `__cdiv(${lhsRead}, ${rhsExpr})`;
				break;
			default:
				throw new Error(
					`unsupported complex compound assignment operator: ${stmt.op}`,
				);
		}
		this.line(`${lhsTarget} = ${result};`);
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

	_genIteratorBranchStmt(stmt) {
		if (!stmt.label) {
			if (this._iterLoopDepth > 0) {
				if (stmt.keyword !== "fallthrough") this.line(`${stmt.keyword};`);
				return;
			}
			if (stmt.keyword === "break") {
				this.line(`${this._iterBreakFlag} = true; return false;`);
				return;
			}
			if (stmt.keyword === "continue") {
				this.line("return true;");
				return;
			}
			return;
		}
		if (this._innerLoopLabels?.has(stmt.label)) {
			if (stmt.keyword !== "fallthrough")
				this.line(`${stmt.keyword} ${stmt.label};`);
			return;
		}
		if (
			stmt.keyword === "continue" &&
			stmt.label === this._currentIterLoopLabel
		) {
			this.line("return true;");
			return;
		}
		this.line(
			`${this._iterTargetFlag} = "${stmt.keyword}$${stmt.label}"; return false;`,
		);
	},

	_genBranchStmt(stmt) {
		if (this._inIteratorBody) {
			this._genIteratorBranchStmt(stmt);
			return;
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
		const isInner = this._inIteratorBody;
		if (isInner) {
			this._iterLoopDepth = (this._iterLoopDepth ?? 0) + 1;
			if (stmt.label) {
				this._innerLoopLabels = this._innerLoopLabels ?? new Set();
				this._innerLoopLabels.add(stmt.label);
			}
		}
		try {
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
			const post = this._perIterationClones(
				stmt,
				stmt.post ? this.stmtInline(stmt.post) : "",
			);
			this.line(`for (${init}; ${cond}; ${post}) {`);
			this.indented(() => this.genBlock(stmt.body));
			this.line("}");
		} finally {
			if (isInner) {
				this._iterLoopDepth--;
				if (stmt.label) this._innerLoopLabels.delete(stmt.label);
			}
		}
	},

	isRangeFor(stmt) {
		return isRangeFor(stmt);
	},

	// Go 1.22 per-iteration loop variables.  `let` gives each iteration its
	// own binding, but a struct or array variable is a reference and an
	// address-taken scalar is a `{ value }` box: replace it at the start of
	// the post step (which runs in the next iteration's binding), so closures
	// and pointers from the finished iteration keep their own variable.
	_perIterationClones(stmt, post) {
		const clones = [];
		for (const name of loopVarsCapturedInLoop(stmt)) {
			const i = stmt.init.lhs.findIndex((e) => e.name === name);
			const t = stmt.init.lhs[i]?._type ?? stmt.init.rhs?.[i]?._type;
			if (this._boxedVars?.has(name)) {
				const v = `${name}.value`;
				const copy = this._aggregateBase(t) ? this._cloneJs(t, v) : v;
				clones.push(`${name} = { value: ${copy} }`);
				continue;
			}
			if (!this._aggregateBase(t)) continue;
			clones.push(`${name} = ${this._cloneJs(t, name)}`);
		}
		if (clones.length === 0) return post;
		const tail = post.replace(/;\s*$/, "");
		return tail ? `${clones.join(", ")}, ${tail}` : clones.join(", ");
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

	_genSliceRangeFor(stmt, iteree, isAssign, unwrapView = false) {
		this._loopDepth = this._loopDepth ?? 0;
		const d = this._loopDepth++;
		const [idxNode, valNode] = stmt.init.lhs;
		const i = `__i${d}`;
		const arr = `__arr${d}`;
		const len = `__len${d}`;
		let elem = `${arr}[${i}]`;
		if (unwrapView) {
			// A partial view of a plain array is a Proxy (`__slice`): read the
			// elements from its backing array `b` at offset `o` instead.
			this.useHelper("sv");
			const [v, b, o] = [`__v${d}`, `__b${d}`, `__o${d}`];
			this.line(
				`for (let ${i} = 0, ${arr} = ${iteree}, ${v} = ${arr}?.[__sv], ${b} = ${v} === undefined ? ${arr} : ${v}.b, ${o} = ${v} === undefined ? 0 : ${v}.o, ${len} = ${v} !== undefined ? ${v}.n : ${arr} ? ${arr}.length : 0; ${i} < ${len}; ${i}++) {`,
			);
			elem = `${b}[${o} + ${i}]`;
		} else {
			this.line(
				`for (let ${i} = 0, ${arr} = ${iteree}, ${len} = ${arr} ? ${arr}.length : 0; ${i} < ${len}; ${i}++) {`,
			);
		}
		this.indented(() => {
			this._emitRangeVar(idxNode, i, isAssign);
			this._emitRangeVar(
				valNode,
				this._rangeElemValue(stmt, valNode, elem, isAssign),
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

	_genStringRangeFor(stmt, iteree, isAssign) {
		this._loopDepth = this._loopDepth ?? 0;
		const d = this._loopDepth++;
		const [idxNode, valNode] = stmt.init.lhs;
		const s = `__s${d}`;
		const i = `__i${d}`;
		const cp = `__cp${d}`;
		this.line(
			`for (let ${i} = 0, ${s} = Array.from(${iteree} ?? ""); ${i} < ${s}.length; ${i}++) {`,
		);
		this.indented(() => {
			this._emitRangeVar(idxNode, i, isAssign);
			if (valNode && valNode.name !== "_") {
				this.line(`const ${cp} = ${s}[${i}].codePointAt(0);`);
				this._emitRangeVar(valNode, cp, isAssign);
			}
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
		this.indented(() => {
			this._cloneMapRangeValue(init, iterType, lhs[1]);
			this.genBlock(body);
		});
		this.line("}");
	},

	// A map range value of array or struct type is a copy: clone it when the
	// body may mutate it (it otherwise aliases the stored value).
	_cloneMapRangeValue(init, iterType, name) {
		if (!name || name === "_" || !this._isMapRangeType(iterType)) return;
		const base = iterType?.kind === "named" ? iterType.underlying : iterType;
		const valType = base?.value ?? base?.elem;
		if (!this._aggregateBase(valType)) return;
		if (init.kind !== "AssignStmt" && !this._fnMutates(name)) return;
		this.line(`${name} = ${this._cloneJs(valType, name)};`);
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

		if (this._isStringRangeType(iterType)) {
			this._genStringRangeFor(stmt, iteree, init.kind === "AssignStmt");
			return;
		}

		if (this._isMapRangeType(iterType)) {
			this._genIterFor(init, iterType, iteree, lhs, stmt.body);
			return;
		}

		// Go ranges over a copy of an array: the range expression is evaluated
		// once, so writes to the array inside the body do not reach `v`.
		const valNode = init.lhs[1];
		const rangesArrayValue =
			valNode &&
			valNode.name !== "_" &&
			this._aggregateBase(iterType)?.kind === "array";
		const iterBase =
			iterType?.kind === "named" ? iterType.underlying : iterType;
		const unwrapView =
			valNode?.name !== "_" &&
			!!valNode &&
			iterBase?.kind === "slice" &&
			!isTypedArraySlice(iterType);
		this._genSliceRangeFor(
			stmt,
			rangesArrayValue ? this._cloneJs(iterType, iteree) : iteree,
			init.kind === "AssignStmt",
			unwrapView,
		);
	},

	_genRangeIterExpr(iterType, iteree, lhs) {
		if (this._isMapRangeType(iterType)) {
			if (lhs.length === 1) return `Object.keys(${iteree})`;
			return `Object.entries(${iteree})`;
		}
		this.useHelper("sliceGuard");
		if (lhs.length === 1) return `__s(${iteree}).keys()`;
		return `__s(${iteree}).entries()`;
	},

	_emitIterTargetDispatch(targetFlag) {
		const labels = this._functionLabels ?? [];
		this.line(`if (${targetFlag}) {`);
		this.indented(() => {
			for (const lbl of labels) {
				this.line(`if (${targetFlag} === "break$${lbl}") break ${lbl};`);
				this.line(`if (${targetFlag} === "continue$${lbl}") continue ${lbl};`);
			}
			if (this._inIteratorBody) {
				this.line(`${this._iterTargetFlag} = ${targetFlag}; return false;`);
			}
		});
		this.line("}");
	},

	_genIteratorLoop(
		itereeExpr,
		paramsStr,
		body,
		assignPreamble = null,
		loopLabel = null,
	) {
		let iteree = this.genExpr(itereeExpr);
		if (itereeExpr.kind === "FuncLit") {
			iteree = `(${iteree})`;
		}

		const d = this._iterDepth++;
		const breakFlag = `__broke${d}`;
		const retFlag = `__returned${d}`;
		const retVar = `__retVal${d}`;
		const targetFlag = `__target${d}`;

		this.line("{");
		this.indented(() => {
			this.line(`let ${breakFlag} = false;`);
			this.line(`let ${retFlag} = false;`);
			this.line(`let ${retVar};`);
			this.line(`let ${targetFlag} = null;`);

			this.line(`${iteree}(function(${paramsStr}) {`);
			this.indented(() => {
				this.line(`if (${breakFlag} || ${retFlag} || ${targetFlag}) {`);
				this.indented(() => {
					if (this.strict) {
						this.line(
							`throw new Error("range function continued iteration after function for loop body returned false");`,
						);
					} else {
						this.line("return false;");
					}
				});
				this.line("}");
				const prev = {
					in: this._inIteratorBody,
					break: this._iterBreakFlag,
					ret: this._iterReturnFlag,
					retVar: this._iterReturnVar,
					target: this._iterTargetFlag,
					loopLabel: this._currentIterLoopLabel,
					loopDepth: this._iterLoopDepth,
				};
				this._inIteratorBody = true;
				this._iterBreakFlag = breakFlag;
				this._iterReturnFlag = retFlag;
				this._iterReturnVar = retVar;
				this._iterTargetFlag = targetFlag;
				this._currentIterLoopLabel = loopLabel;
				this._iterLoopDepth = 0;

				if (assignPreamble) assignPreamble();
				this.genBlock(body);

				this._inIteratorBody = prev.in;
				this._iterBreakFlag = prev.break;
				this._iterReturnFlag = prev.ret;
				this._iterReturnVar = prev.retVar;
				this._iterTargetFlag = prev.target;
				this._currentIterLoopLabel = prev.loopLabel;
				this._iterLoopDepth = prev.loopDepth;

				this.line("return true;");
			});
			this.line("});");
			this.line(`if (${retFlag}) return ${retVar};`);
			this._emitIterTargetDispatch(targetFlag);
		});
		this.line("}");
		this._iterDepth--;
	},

	genIteratorFor(stmt) {
		const range = stmt.init.rhs[0];
		const isAssign = stmt.init.kind === "AssignStmt";
		const lhs = stmt.init.lhs.map((e) => e.name ?? this.genExpr(e));
		const yieldTypes = range._yieldParams ?? [];
		if (isAssign) {
			const cbParams = lhs.map((_, i) => `__p${i}`);
			const params = yieldTypes.length === 0 ? "" : cbParams.join(", ");
			const assignPreamble = () => {
				for (let i = 0; i < lhs.length; i++) {
					if (lhs[i] !== "_") {
						const yType = yieldTypes[i];
						const isStruct =
							this._isStructType(yType) ||
							this._isStructType(stmt.init.lhs[i]?._type);
						if (isStruct) {
							this.useHelper("sclone");
							this.line(`${lhs[i]} = __sclone(${cbParams[i]});`);
						} else {
							this.line(`${lhs[i]} = ${cbParams[i]};`);
						}
					}
				}
			};
			this._genIteratorLoop(
				range.expr,
				params,
				stmt.body,
				assignPreamble,
				stmt.label ?? null,
			);
			return;
		}
		const cbParams = lhs.map((n, i) => (n === "_" ? `_$${i}` : n));
		const params = yieldTypes.length === 0 ? "" : cbParams.join(", ");
		const clonePreamble = () => {
			for (let i = 0; i < lhs.length; i++) {
				if (lhs[i] !== "_") {
					const yType = yieldTypes[i];
					const isStruct =
						this._isStructType(yType) ||
						this._isStructType(stmt.init.lhs[i]?._type);
					if (isStruct) {
						this.useHelper("sclone");
						this.line(`${cbParams[i]} = __sclone(${cbParams[i]});`);
					}
				}
			}
		};
		this._genIteratorLoop(
			range.expr,
			params,
			stmt.body,
			clonePreamble,
			stmt.label ?? null,
		);
	},

	// 0-param iterator: for range iter { body }
	genIteratorForCond(stmt) {
		this._genIteratorLoop(
			stmt.cond.expr,
			"",
			stmt.body,
			null,
			stmt.label ?? null,
		);
	},

	// Inline a statement as a for-init/post string (no semicolon)
	stmtInline(stmt) {
		switch (stmt.kind) {
			case "DefineStmt":
				return this._inlineDefine(stmt);
			case "AssignStmt":
				return this._withInlineSyncs(
					this._resliceSyncs(stmt.lhs, stmt, true),
					this._inlineAssign(stmt),
				);
			case "IncDecStmt": {
				const syncs = this._resliceSyncs([stmt.expr], stmt, true);
				this._markIndexLvalues([stmt.expr]);
				return this._withInlineSyncs(
					syncs,
					`${this.genExpr(stmt.expr)}${stmt.op}`,
				);
			}
			case "ExprStmt":
				return this.genExpr(stmt.expr);
			default:
				return "";
		}
	},

	_withInlineSyncs(syncs, js) {
		return syncs ? `${js}, ${syncs.join(", ")}` : js;
	},

	_inlineDefine(stmt) {
		const boxed =
			stmt.lhs.length === 1 &&
			stmt.rhs.length === 1 &&
			this._boxedVars.has(stmt.lhs[0].name);
		if (boxed)
			return `let ${stmt.lhs[0].name} = { value: ${this.genValueExpr(stmt.rhs[0])} }`;
		const rhs = stmt.rhs.map((e) => this.genExpr(e));
		const lhs = stmt.lhs.map((e) => e.name ?? this.genExpr(e));
		if (lhs.length === 1) return `let ${lhs[0]} = ${rhs[0]}`;
		// `for i, j := 0, 10`: one declarator per variable.
		if (rhs.length === lhs.length) {
			const decls = lhs.map((n, i) =>
				this._boxedVars.has(n)
					? `${n} = { value: ${rhs[i]} }`
					: `${n} = ${rhs[i]}`,
			);
			return `let ${decls.join(", ")}`;
		}
		return `let [${lhs.map((n) => (n === "_" ? "" : n)).join(", ")}] = ${rhs[0]}`;
	},

	_inlineAssign(stmt) {
		this._markIndexLvalues(stmt.lhs);
		const rhs = stmt.rhs.map((e) => this.genExpr(e));
		if (stmt.lhs.length === 1)
			return `${this.genExpr(stmt.lhs[0])} ${stmt.op} ${rhs[0]}`;
		// `i, j = i+1, j-1`: every right-hand side is evaluated first.
		const lhs = stmt.lhs.map((e) =>
			e.name === "_" ? "" : this._genAssignLhsExpr(e),
		);
		const r = rhs.length === 1 ? rhs[0] : `[${rhs.join(", ")}]`;
		return `[${lhs.join(", ")}] = ${r}`;
	},

	// Interface-typed tags may hold boxed named values; cases compare with __ifeq.
	_switchTagAndCases(stmt) {
		const tag = stmt.tag ? this.genExpr(stmt.tag) : "true";
		if (!stmt.tag || !this._isIfaceType(stmt.tag._type))
			return { tag, caseExpr: (e) => this.genExpr(e) };
		this.useHelper("ifeq");
		this._swCounter = (this._swCounter ?? 0) + 1;
		const tmp = `__sw${this._swCounter}`;
		this.line(`const ${tmp} = ${tag};`);
		return {
			tag: "true",
			caseExpr: (e) => `__ifeq(${tmp}, ${this._genIfaceOperand(e)})`,
		};
	},

	genSwitch(stmt) {
		const genBody = () => {
			const { tag, caseExpr } = this._switchTagAndCases(stmt);
			this.line(`switch (${tag}) {`);
			this.indented(() => {
				for (const c of stmt.cases) {
					if (c.list) {
						for (const e of c.list) this.line(`case ${caseExpr(e)}:`);
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
					// A single named non-struct case binds the unboxed value.
					if (
						stmt.assign &&
						c.types.length === 1 &&
						this._isNamedBoxTypeNode(c.types[0])
					)
						this.line(`const ${stmt.assign} = __tsw.__gfUnbox();`);
					// An array case binds a copy of the boxed value.
					else if (
						stmt.assign &&
						c.types.length === 1 &&
						this._typeFromNode(c.types[0])?.kind === "array"
					)
						this.line(
							`let ${stmt.assign} = ${this._cloneJs(this._typeFromNode(c.types[0]), "__tsw")};`,
						);
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
