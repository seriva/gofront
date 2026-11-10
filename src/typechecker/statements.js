// TypeChecker statement-checking methods — installed as a mixin on TypeChecker.prototype.

// Method-name dispatch for checkStmt — string values add no static call edges.
const CHECK_STMT_DELEGATE = {
	VarDecl: "checkVarDecl",
	ConstDecl: "checkConstDecl",
	TypeDecl: "collectType",
	DefineStmt: "_checkDefineStmt",
	AssignStmt: "_checkAssignStmt",
	ReturnStmt: "_checkReturnStmt",
	IfStmt: "_checkIfStmt",
	ForStmt: "_checkForStmt",
	SwitchStmt: "_checkSwitchStmt",
	TypeSwitchStmt: "_checkTypeSwitchStmt",
	BranchStmt: "_checkBranchStmt",
};

import { exprText, operandKind } from "./operand-text.js";
import {
	ANY,
	BOOL,
	defaultType,
	is64BitInt,
	isAny,
	isBool,
	isNil,
	isUntyped,
	isVoid,
	iteratorYieldParams,
	Scope,
	typeStr,
} from "./types.js";

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

/** @type {ThisType<TypeChecker>} */
export const statementCheckMethods = {
	checkBlock(block, scope, returnType) {
		for (const stmt of block.stmts) {
			this.checkStmt(stmt, scope, returnType);
		}
	},

	checkStmt(stmt, scope, returnType) {
		switch (stmt.kind) {
			case "IncDecStmt":
			case "ExprStmt":
				this.checkExpr(stmt.expr, scope);
				break;
			case "DeferStmt":
				if (stmt.call.kind !== "CallExpr")
					this.err("defer requires a function call", stmt.call);
				this.checkExpr(stmt.call, scope);
				this._deferCount++;
				break;
			case "LabeledStmt":
				this.checkStmt(stmt.body, scope, returnType);
				break;
			case "Block": {
				const blockScope = new Scope(scope);
				this.checkBlock(stmt, blockScope, returnType);
				this._reportUnused(blockScope, stmt);
				break;
			}
			default: {
				const m = CHECK_STMT_DELEGATE[stmt.kind];
				if (m) this[m](stmt, scope, returnType);
				break;
			}
		}
	},

	_checkDefineCommaOkAssert(stmt, rhs, scope) {
		if (!stmt.rhs[0]?._commaOk) return false;
		this._declareDefineVars(stmt, [rhs[0], BOOL], scope);
		if (stmt.lhs.every((e) => e._redecl || (e.name ?? e) === "_"))
			this.err("no new variables on left side of :=", stmt.lhs[0]);
		stmt._rhsTypes = [rhs[0], BOOL];
		return true;
	},

	_assignOperand(stmt, i) {
		if (stmt.rhs.length === stmt.lhs.length) return stmt.rhs[i];
		return stmt.rhs.length === 1 ? stmt.rhs[0] : undefined;
	},

	_checkRedeclAssign(target, source, stmt, i) {
		if (!target || !source || !this._needsAssignCheck(target, source)) return;
		this._skipIfaceMark = true;
		this.assertAssignable(
			target,
			source,
			stmt.lhs[i],
			"assignment",
			this._assignOperand(stmt, i),
		);
		this._skipIfaceMark = false;
	},

	_declareDefineVars(stmt, rhsFlat, scope) {
		for (let i = 0; i < stmt.lhs.length; i++) {
			const name = stmt.lhs[i].name ?? stmt.lhs[i];
			if (name === "_") continue;
			if (scope.symbols.has(name)) {
				stmt.lhs[i]._redecl = true;
				// Redeclared variables keep their type; the value must be assignable.
				this._checkRedeclAssign(scope.symbols.get(name), rhsFlat[i], stmt, i);
				continue;
			}
			if (stmt.rhs.length === stmt.lhs.length)
				this._checkConstDefault(
					rhsFlat[i],
					stmt.rhs[i],
					"variable declaration",
				);
			scope.defineLocal(name, defaultType(rhsFlat[i]) ?? ANY);
		}
	},

	_checkDefineCommaOkMap(stmt, scope) {
		if (
			stmt.lhs.length !== 2 ||
			stmt.rhs.length !== 1 ||
			stmt.rhs[0].kind !== "IndexExpr"
		)
			return false;
		const mapBaseType = this.checkExpr(stmt.rhs[0].expr, scope);
		const resolvedBase = this._underlyingOrCore(mapBaseType, scope);
		if (resolvedBase?.kind !== "map") return false;
		const keyType = this.checkExpr(stmt.rhs[0].index, scope);
		this.assertAssignable(resolvedBase.key, keyType, stmt.rhs[0].index);
		this._markIfaceKey(resolvedBase, stmt.rhs[0].index, keyType);
		stmt._commaOkMap = true;
		stmt.rhs[0]._mapValueType = resolvedBase.value;
		this._declareDefineVars(stmt, [resolvedBase.value, BOOL], scope);
		const allRedecl = stmt.lhs.every((e) => e._redecl || (e.name ?? e) === "_");
		if (allRedecl && stmt.lhs.length > 0) {
			this.err("no new variables on left side of :=", stmt.lhs[0]);
		}
		stmt._rhsTypes = [resolvedBase.value, BOOL];
		return true;
	},

	_checkDefineStmt(stmt, scope) {
		// comma-ok type assertion: n, ok := x.(T)
		if (
			stmt.lhs.length === 2 &&
			stmt.rhs.length === 1 &&
			stmt.rhs[0].kind === "TypeAssertExpr"
		) {
			stmt.rhs[0]._commaOk = true;
		}
		if (this._checkDefineCommaOkMap(stmt, scope)) return;
		const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
		const isTuple = rhs.length === 1 && rhs[0]?.kind === "tuple";
		const rhsFlat = isTuple ? rhs[0].types : rhs;
		if (this._checkDefineCommaOkAssert(stmt, rhs, scope)) return;
		if (
			stmt.rhs[0]?.kind !== "RangeExpr" &&
			stmt.lhs.length !== rhsFlat.length &&
			!rhsFlat.some((t) => t?._tainted)
		) {
			const vars =
				stmt.lhs.length === 1 ? "1 variable" : `${stmt.lhs.length} variables`;
			const vals = isTuple
				? `returns ${rhsFlat.length} values`
				: rhsFlat.length === 1
					? "1 value"
					: `${rhsFlat.length} values`;
			this.err(`assignment mismatch: ${vars} but ${vals}`, stmt);
		}
		this._declareDefineVars(stmt, rhsFlat, scope);
		const allRedecl = stmt.lhs.every((e) => e._redecl || (e.name ?? e) === "_");
		if (allRedecl && stmt.lhs.length > 0) {
			this.err("no new variables on left side of :=", stmt.lhs[0]);
		}
		stmt._rhsTypes = rhsFlat.map((t) => defaultType(t) ?? ANY);
	},

	_checkAssignCommaOkMap(stmt, scope) {
		if (
			stmt.lhs.length !== 2 ||
			stmt.rhs.length !== 1 ||
			stmt.rhs[0].kind !== "IndexExpr"
		)
			return null;
		const mapBaseType = this.checkExpr(stmt.rhs[0].expr, scope);
		const resolvedBase = this._underlyingOrCore(mapBaseType, scope);
		if (resolvedBase?.kind !== "map") return null;
		const keyType = this.checkExpr(stmt.rhs[0].index, scope);
		this.assertAssignable(resolvedBase.key, keyType, stmt.rhs[0].index);
		this._markIfaceKey(resolvedBase, stmt.rhs[0].index, keyType);
		stmt._commaOkMap = true;
		stmt.rhs[0]._mapValueType = resolvedBase.value;
		return [resolvedBase.value, BOOL];
	},

	_checkConstAssignment(stmt, scope) {
		for (const lhs of stmt.lhs) {
			if (lhs.kind === "Ident" && lhs.name !== "_") {
				const ownerScope = scope.lookupScope(lhs.name);
				if (ownerScope?.isConst(lhs.name))
					this.err(`cannot assign to const '${lhs.name}'`, lhs);
			}
		}
	},

	_isCommaOkTypeAssertAssign(stmt) {
		return (
			stmt.lhs.length === 2 &&
			stmt.rhs.length === 1 &&
			stmt.rhs[0].kind === "TypeAssertExpr"
		);
	},

	_checkAssignLhsType(e, scope) {
		if (e.kind === "Ident" && e.name === "_") return ANY;
		return this.checkExpr(e, scope);
	},

	// A source-written `any` operand still goes through assertAssignable so a
	// concrete target reports `need type assertion`; interop `any` stays exempt.
	_needsAssignCheck(target, source) {
		return !isAny(target) && (!isAny(source) || !!source._declared);
	},

	_checkAssignTypes(stmt, rhsFlat, lhsTypes) {
		for (let i = 0; i < lhsTypes.length; i++) {
			if (stmt.lhs[i]?.kind === "Ident" && stmt.lhs[i]?.name === "_") continue;
			const r = rhsFlat[i] ?? ANY;
			if (stmt.rhs.length === lhsTypes.length && lhsTypes[i] && r)
				this._markIfaceBox(
					this.resolveType(lhsTypes[i]),
					this.resolveType(r),
					stmt.rhs[i],
				);
			// A shift count is not converted to the left operand's type.
			if (stmt.op === "<<=" || stmt.op === ">>=") {
				if (r && !isAny(r)) this.checkShiftCount(r, stmt.rhs[i]);
				continue;
			}
			if (
				stmt.rhs.length === lhsTypes.length &&
				this._checkConstOverflow(lhsTypes[i], r, stmt.rhs[i], "assignment")
			)
				continue;
			if (this._needsAssignCheck(lhsTypes[i], r)) {
				this._skipIfaceMark = true;
				this.assertAssignable(
					lhsTypes[i],
					r,
					stmt.lhs[i],
					"assignment",
					this._assignOperand(stmt, i),
				);
				this._skipIfaceMark = false;
			}
		}
	},

	_checkAssignStmt(stmt, scope) {
		const commaOkMapTypes = this._checkAssignCommaOkMap(stmt, scope);
		if (this._isCommaOkTypeAssertAssign(stmt)) stmt.rhs[0]._commaOk = true;
		this._checkConstAssignment(stmt, scope);
		let rhsFlat;
		if (commaOkMapTypes) {
			rhsFlat = commaOkMapTypes;
		} else {
			const rhs = stmt.rhs.map((e) => this.checkExpr(e, scope));
			const isTuple = rhs.length === 1 && rhs[0]?.kind === "tuple";
			rhsFlat = isTuple ? rhs[0].types : rhs;
			if (
				!stmt.rhs[0]?._commaOk &&
				stmt.rhs[0]?.kind !== "RangeExpr" &&
				stmt.lhs.length !== rhsFlat.length &&
				!rhsFlat.some((t) => t?._tainted)
			) {
				const vars =
					stmt.lhs.length === 1 ? "1 variable" : `${stmt.lhs.length} variables`;
				const vals = isTuple
					? `returns ${rhsFlat.length} values`
					: rhsFlat.length === 1
						? "1 value"
						: `${rhsFlat.length} values`;
				this.err(`assignment mismatch: ${vars} but ${vals}`, stmt);
			}
			if (stmt.rhs[0]?._commaOk) {
				rhsFlat = [rhs[0], BOOL];
			}
		}
		const lhsTypes = stmt.lhs.map((e) => this._checkAssignLhsType(e, scope));
		this._checkAssignTypes(stmt, rhsFlat, lhsTypes);
	},

	_checkReturnStmt(stmt, scope, returnType) {
		const types = stmt.values.map((v) => this.checkExpr(v, scope));
		stmt._types = types;
		if (
			!isVoid(returnType) &&
			types.length === 0 &&
			!returnType?._hasNamedReturns
		) {
			this.err("Missing return value", stmt);
		}
		// Check each returned value is assignable to its declared type
		if (!isVoid(returnType) && types.length > 0) {
			const expected =
				returnType.kind === "tuple" ? returnType.types : [returnType];
			// `return f()` forwards every result of a multi-value call.
			if (types.length === 1 && types[0]?.kind === "tuple") {
				const forwarded = types[0].types;
				if (forwarded.length !== expected.length) {
					this.err(
						`return count mismatch: have ${forwarded.length} values, want ${expected.length}`,
						stmt,
					);
					return;
				}
				for (let i = 0; i < expected.length; i++) {
					this.assertAssignable(
						expected[i],
						forwarded[i],
						stmt.values[0],
						"return statement",
					);
				}
				return;
			}
			for (let i = 0; i < expected.length; i++) {
				if (types[i])
					this.assertAssignable(
						expected[i],
						types[i],
						stmt.values[i] ?? stmt,
						"return statement",
					);
			}
		}
	},

	_checkIfStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
		const ct = this.checkExpr(stmt.cond, inner);
		if (!isBool(ct) && !isAny(ct)) this.err("If condition must be bool", stmt);
		const bodyScope = new Scope(inner);
		this.checkBlock(stmt.body, bodyScope, returnType);
		this._reportUnused(bodyScope, stmt);
		if (stmt.elseBody) {
			if (stmt.elseBody.kind === "Block") {
				const elseScope = new Scope(inner);
				this.checkBlock(stmt.elseBody, elseScope, returnType);
				this._reportUnused(elseScope, stmt);
			} else this.checkStmt(stmt.elseBody, inner, returnType);
		}
		this._reportUnused(inner, stmt);
	},

	_checkForCond(stmt, inner) {
		if (stmt.cond.kind !== "RangeExpr") {
			const ct = this.checkExpr(stmt.cond, inner);
			if (!isBool(ct) && !isAny(ct))
				this.err("For condition must be bool", stmt);
		} else {
			const ct = this.checkExpr(stmt.cond.expr, inner);
			const core = ct?.kind === "typeParam" ? this._coreType(ct, inner) : null;
			if (core) stmt.cond.expr._coreType = core;
			const info = iteratorYieldParams(ct);
			if (info) {
				stmt.cond._isIterator = true;
				stmt.cond._yieldParams = info.yieldParams;
			} else if (ct?.kind === "func") {
				this.err("cannot range over func: not an iterator function", stmt);
			}
		}
	},

	// `checkBody(bodyScope)` checks the loop body; templ `for` loops pass one
	// that checks their HTML nodes in place of the header's empty block.
	_checkForStmt(
		stmt,
		scope,
		returnType,
		checkBody = (s) => this.checkBlock(stmt.body, s, returnType),
	) {
		const inner = new Scope(scope);
		let iterInfo = null;
		if (stmt.init?.rhs?.[0]?.kind === "RangeExpr") {
			iterInfo = this._checkRangeIterStmt(stmt.init, inner, returnType);
		}
		if (!iterInfo && stmt.init) this.checkStmt(stmt.init, inner, returnType);
		if (stmt.cond) this._checkForCond(stmt, inner);
		if (stmt.post) this.checkStmt(stmt.post, inner, returnType);
		this._loopDepth++;
		const bodyScope = new Scope(inner);
		checkBody(bodyScope);
		this._reportUnused(bodyScope, stmt);
		this._loopDepth--;
		this._reportUnused(inner, stmt);
	},

	_checkSwitchStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
		if (stmt.tag) this.checkExpr(stmt.tag, inner);
		const tagIs64 = stmt.tag && is64BitInt(stmt.tag._type);
		this._switchDepth++;
		for (const c of stmt.cases) {
			const caseScope = new Scope(inner);
			if (c.list) {
				for (const e of c.list) {
					this.checkExpr(e, caseScope);
					this._checkCaseValue(stmt.tag, e);
					if (tagIs64 && e._type?.kind === "untyped") e._is64Bit = true;
				}
			}
			for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
			this._reportUnused(caseScope, stmt);
		}
		this._switchDepth--;
		this._reportUnused(inner, stmt);
	},

	// `case e:` compares `tag == e`, so `e` must convert to the tag's type
	// (or the other way round for typed values).
	_checkCaseValue(tag, e) {
		const caseType = this.resolveType(e._type);
		if (!tag) {
			this._checkTaglessCase(e, caseType);
			return;
		}
		let tagType = this.resolveType(tag._type);
		// `switch "foo" {` compares as the constant's default type.
		if (isUntyped(tagType) && !isNil(tagType)) tagType = defaultType(tagType);
		if (this._caseValueUnchecked(tagType, caseType)) return;
		if (isUntyped(caseType)) {
			if (this._isUntypedAssignable(tagType, caseType)) return;
			this.err(
				`cannot convert ${exprText(e)} (${operandKind(e, caseType.base, true)}) to type ${typeStr(tagType)}`,
				e,
			);
			return;
		}
		if (
			this._assignableQuietly(tagType, caseType) ||
			this._assignableQuietly(caseType, tagType)
		)
			return;
		this.err(
			`invalid case ${exprText(e)} in switch on ${exprText(tag)} (mismatched types ${typeStr(caseType)} and ${typeStr(tagType)})`,
			e,
		);
	},

	// A tagless `switch` is `switch true`, so every case must be boolean.
	_checkTaglessCase(e, caseType) {
		if (!caseType || caseType._tainted || caseType.kind === "typeParam") return;
		if (isNil(caseType)) {
			this.err(`cannot convert nil to type bool`, e);
			return;
		}
		if (isAny(caseType) || isBool(caseType)) return;
		if (isUntyped(caseType) && caseType.base === "bool") return;
		const under = this.resolveType(caseType.underlying ?? caseType);
		if (isBool(under)) return;
		this.err(
			`invalid case ${exprText(e)} in switch (mismatched types ${typeStr(caseType)} and bool)`,
			e,
		);
	},

	// Operands whose comparison the checker cannot (or need not) judge: unknown
	// or recovered types, `any`/interface tags, nil cases, type parameters.
	_caseValueUnchecked(tagType, caseType) {
		if (!tagType || !caseType || tagType._tainted || caseType._tainted)
			return true;
		if (isAny(tagType) || isAny(caseType) || isNil(caseType)) return true;
		if (isUntyped(tagType) || tagType.kind === "typeParam") return true;
		return (
			this.resolveType(tagType.underlying ?? tagType)?.kind === "interface"
		);
	},

	// Whether assertAssignable(target, source) reports nothing.
	_assignableQuietly(target, source) {
		const saved = this.errors;
		const savedSkip = this._skipIfaceMark;
		this.errors = [];
		this._skipIfaceMark = true;
		this.assertAssignable(target, source, null);
		const ok = this.errors.length === 0;
		this.errors = saved;
		this._skipIfaceMark = savedSkip;
		return ok;
	},

	// A case naming an interface (literal or declared) records the resolved
	// type so backends test its method set.
	_markInterfaceCaseType(t, scope) {
		if (!t || (t.kind !== "InterfaceType" && t.kind !== "TypeName")) return;
		if (t.kind === "TypeName" && (t.name === "nil" || t.name === "error"))
			return;
		const resolved = this.resolveTypeNode(t, scope);
		const u = this.resolveType(
			resolved?.kind === "named" ? resolved.underlying : resolved,
		);
		if (u?.kind === "interface") t._type = resolved;
	},

	// Records the resolved type of a composite type node used as an assertion
	// or type-switch target (`[]int`, `map[string]any`, `*int`, `iter.Seq[int]`)
	// so the backend can match it against the dynamic type of an interface value.
	_markDynamicType(node, resolved) {
		const kind = node?.kind;
		if (
			kind === "SliceType" ||
			kind === "ArrayType" ||
			kind === "MapType" ||
			kind === "PointerType" ||
			kind === "FuncType" ||
			kind === "StructType" ||
			kind === "GenericTypeName"
		)
			node._assertType = resolved;
	},

	_checkTypeSwitchStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		this.checkExpr(stmt.expr, inner);
		this._switchDepth++;
		this._typeSwitchDepth++;
		for (const c of stmt.cases) {
			const caseScope = new Scope(inner);
			// Resolve instantiated generic case types so backends can tell
			// `*Stack[int]` from `*Stack[string]`.
			for (const t of c.types ?? []) {
				const base = t?.kind === "PointerType" ? t.base : t;
				if (base?.kind === "GenericTypeName") this.resolveTypeNode(t, inner);
				this._markInterfaceCaseType(t, inner);
				if (t && t.kind !== "TypeName" && t.kind !== "InterfaceType")
					this._markDynamicType(t, this.resolveTypeNode(t, inner));
			}
			if (stmt.assign) {
				// Bind the variable to the single case type, or any for multi/default.
				// `case nil` binds the switch expression's own type, as in Go.
				const only = c.types?.length === 1 ? c.types[0] : null;
				const isNilCase = only?.kind === "TypeName" && only.name === "nil";
				const bindType = isNilCase
					? (stmt.expr._type ?? ANY)
					: only
						? this.resolveTypeNode(only, inner)
						: ANY;
				caseScope.defineLocal(stmt.assign, bindType);
				// The capture variable is always considered used — it's the whole
				// point of the switch-with-assign form. Each case body uses its own
				// typed copy of the variable.
				caseScope.lookup(stmt.assign);
			}
			for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
			this._reportUnused(caseScope, stmt);
		}
		this._typeSwitchDepth--;
		this._switchDepth--;
	},

	_checkBranchStmt(stmt) {
		const kw = stmt.keyword;
		if (kw === "goto")
			this.err(
				"goto is not supported; restructure with labeled break/continue",
				stmt,
			);
		else if (kw === "continue" && this._loopDepth === 0)
			this.err("continue statement outside for loop", stmt);
		else if (kw === "break" && this._loopDepth === 0 && this._switchDepth === 0)
			this.err("break statement outside for loop or switch", stmt);
		else if (kw === "fallthrough" && this._switchDepth === 0)
			this.err("fallthrough statement outside switch", stmt);
		else if (kw === "fallthrough" && this._typeSwitchDepth > 0)
			this.err("cannot fallthrough in type switch", stmt);
	},

	_checkRangeIterInvalidFunc(iterType, initStmt) {
		const underlying =
			iterType?.kind === "named" ? iterType.underlying : iterType;
		if (underlying?.kind === "func")
			this.err("cannot range over func: not an iterator function", initStmt);
	},

	_bindRangeIterDefineVars(lhs, info, scope) {
		for (let i = 0; i < lhs.length; i++) {
			const name = lhs[i].name ?? lhs[i];
			if (name === "_") continue;
			const varType = info.yieldParams[i] ?? ANY;
			scope.defineLocal(name, varType);
		}
	},

	_checkRangeIterAssignVars(lhs, scope) {
		for (const e of lhs) {
			if (e.kind === "Ident" && e.name !== "_") this.checkExpr(e, scope);
		}
	},

	_checkRangeIterStmt(initStmt, scope, _returnType) {
		const rangeExpr = initStmt.rhs[0];
		const iterType = this.checkExpr(rangeExpr.expr, scope);
		const info = iteratorYieldParams(iterType);
		if (!info) {
			this._checkRangeIterInvalidFunc(iterType, initStmt);
			return null;
		}

		const lhs = initStmt.lhs;
		if (lhs.length > info.yieldParams.length) {
			this.err(
				`range over iterator: too many loop variables (got ${lhs.length}, max ${info.yieldParams.length})`,
				initStmt,
			);
		}

		rangeExpr._isIterator = true;
		rangeExpr._yieldParams = info.yieldParams;

		if (initStmt.kind === "DefineStmt")
			this._bindRangeIterDefineVars(lhs, info, scope);
		else this._checkRangeIterAssignVars(lhs, scope);
		return info;
	},
};
