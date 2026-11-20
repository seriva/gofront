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
	anyKind,
	BOOL,
	defaultType,
	is64BitInt,
	isAny,
	isBool,
	isComplexOrNumeric,
	isInteger,
	isNil,
	isString,
	isUntyped,
	isVoid,
	iteratorYieldParams,
	Scope,
	TAINTED_ANY,
	typeStr,
} from "./types.js";

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

// Labels are scoped to a function body: `defined` holds every label seen so
// far (to report a repeat) and `enclosing` the labeled statements around the
// statement being checked, which are the only ones `break` and `continue` reach.
export function newLabelScope() {
	return { defined: new Set(), enclosing: [] };
}

const BREAKABLE_BODIES = new Set(["ForStmt", "SwitchStmt", "TypeSwitchStmt"]);
const LABEL_BRANCHES = new Set(["break", "continue"]);
// The label property a branch keyword needs: `break` any breakable statement,
// `continue` a loop.
const LABEL_TARGET = { break: "breakable", continue: "loop" };

function newLabelEntry(stmt) {
	// Stacked labels (`a: b: for {}`) all name the statement they precede.
	let target = stmt.body;
	while (target.kind === "LabeledStmt") target = target.body;
	return {
		name: stmt.label,
		breakable: BREAKABLE_BODIES.has(target.kind),
		loop: target.kind === "ForStmt",
		used: false,
	};
}

// Tag kinds with no nil value: `case nil` against them cannot compile.
const NON_NILABLE_TAG_KINDS = new Set(["basic", "struct", "array"]);

// Builtins whose only effect is their result: invalid as a statement.
const VALUE_ONLY_BUILTINS = new Set([
	"append",
	"cap",
	"complex",
	"imag",
	"len",
	"make",
	"min",
	"max",
	"new",
	"real",
]);

// Whether an expression statement discards a value Go does not allow to be
// discarded: everything except a function or method call, an `await` of one,
// and a receive operation.
function isUnusedExprStmt(expr) {
	let e = expr;
	while (e.kind === "ParenExpr") e = e.expr;
	if (e.kind === "AwaitExpr") return false;
	if (e.kind === "UnaryExpr") return e.op !== "<-";
	if (e.kind !== "CallExpr") return true;
	if (e._isTypeConversion || e.func?._isTypeRef) return true;
	return VALUE_ONLY_BUILTINS.has(e._builtinName);
}

/** @type {ThisType<TypeChecker>} */
export const statementCheckMethods = {
	checkBlock(block, scope, returnType) {
		for (const stmt of block.stmts) {
			this.checkStmt(stmt, scope, returnType);
		}
	},

	// Only calls and receive operations may stand alone as a statement. A
	// conversion and the builtins that only compute a value are calls that do
	// not qualify.
	_checkExprStmt(stmt, scope) {
		const type = this.checkExpr(stmt.expr, scope);
		if (!isUnusedExprStmt(stmt.expr)) return;
		if (type?._tainted) return;
		const untyped = type?.kind === "untyped" && type.base !== "nil";
		const what = untyped
			? `untyped ${type.base} value`
			: operandKind(stmt.expr, typeStr(type), false);
		this.err(`${exprText(stmt.expr)} (${what}) is not used`, stmt.expr);
	},

	checkStmt(stmt, scope, returnType) {
		switch (stmt.kind) {
			case "IncDecStmt":
				this._checkIncDecStmt(stmt, scope);
				break;
			case "ExprStmt":
				this._checkExprStmt(stmt, scope);
				break;
			case "DeferStmt":
				if (stmt.call.kind !== "CallExpr")
					this.err("defer requires a function call", stmt.call);
				// The arguments are evaluated at the defer, into temps of their
				// own type: they take no implicit struct conversion.
				else stmt.call._isDeferCall = true;
				this.checkExpr(stmt.call, scope);
				this._deferCount++;
				break;
			case "LabeledStmt":
				this._checkLabeledStmt(stmt, scope, returnType);
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
			stmt.rhs.length === stmt.lhs.length,
		);
		this._skipIfaceMark = false;
	},

	_declareDefineVars(stmt, rhsFlat, scope) {
		for (let i = 0; i < stmt.lhs.length; i++) {
			const name = stmt.lhs[i].name ?? stmt.lhs[i];
			if (name === "_" || !scope.has(name)) {
				if (
					stmt.rhs.length === stmt.lhs.length &&
					this._rejectUntypedNil(rhsFlat[i], stmt.rhs[i], "assignment")
				)
					rhsFlat[i] = ANY;
			}
			if (name === "_") continue;
			if (scope.has(name)) {
				stmt.lhs[i]._redecl = true;
				// Redeclared variables keep their type; the value must be assignable
				// (so nil is fine for nilable types, as in plain assignment).
				this._checkRedeclAssign(scope.get(name), rhsFlat[i], stmt, i);
				continue;
			}
			if (stmt.rhs.length === stmt.lhs.length)
				this._checkConstDefault(
					rhsFlat[i],
					stmt.rhs[i],
					"variable declaration",
				);
			scope.defineLocal(name, defaultType(rhsFlat[i]) ?? ANY, stmt.lhs[i]);
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

	_isCommaOkTypeAssertAssign(stmt) {
		return (
			stmt.lhs.length === 2 &&
			stmt.rhs.length === 1 &&
			stmt.rhs[0].kind === "TypeAssertExpr"
		);
	},

	_checkAssignLhsType(e, scope) {
		if (e.kind === "Ident" && e.name === "_") return ANY;
		this._targetOperand(e);
		const t = this.checkExpr(e, scope);
		this._checkAssignTarget(e, scope);
		return t;
	},

	// The left side of `=`, `op=`, `++` and `--` must be addressable or a map
	// index: not a string element, a constant, the result of a call, literal
	// or assertion, nor a field or array element of a map entry.
	// An assignment target or address operand that names no value is reported
	// by the addressability check, not as a name used as a value.
	_targetOperand(e) {
		let node = e;
		while (node.kind === "ParenExpr") node = node.expr;
		node._nameOk = true;
	},

	_checkAssignTarget(e, scope) {
		let node = e;
		while (node.kind === "ParenExpr") node = node.expr;
		if (node.kind === "Ident" && node.name === "_") return;
		// A target that already failed to check has been reported.
		if (node._type?._tainted) return;
		const bt = node.expr?._type;
		const b = this._coreUnderlying(bt, scope);
		if (node.kind === "IndexExpr" && b?.kind === "map") return;
		if (node.kind === "SelectorExpr" && this._isMapElementOperand(node, scope))
			this.err(
				`cannot assign to struct field ${exprText(node)} in map`,
				this._positioned(node),
			);
		else if (!this._isAddressable(node, scope))
			this.err(
				`cannot assign to ${exprText(node)} (neither addressable nor a map index expression)`,
				this._positioned(node),
			);
	},

	// A source-written `any` operand still goes through assertAssignable so a
	// concrete target reports `need type assertion`; interop `any` stays exempt.
	_needsAssignCheck(target, source) {
		return !isAny(target) && (!isAny(source) || !!source._declared);
	},

	// A range assignment (`for _, s = range xs`) stores each key and element
	// into an existing variable; one of interface type boxes the value as
	// any other conversion does. The box is recorded on a holder, not on the
	// target, which codegen also reads as an assignable expression.
	_markRangeAssignBox(stmt, i, target, source) {
		if (stmt.rhs[0]?.kind !== "RangeExpr") return;
		this._markRangeTargetBox(stmt.lhs[i], target, source);
	},

	_markRangeTargetBox(node, target, source) {
		if (!target || !source) return;
		const holder = {};
		this._markIfaceBox(
			this.resolveType(target),
			this.resolveType(source),
			holder,
		);
		if (holder._ifaceBox) node._rangeBox = holder;
	},

	// `x++` is `x + 1` and `x op= y` is `x op y`: both type through the same
	// path as a binary expression, on a synthetic node spelled as the statement.
	_operatorStmtNode(stmt, op, left, right, spelling) {
		return {
			kind: "BinaryExpr",
			op,
			left,
			right,
			_spelling: spelling,
			_line: stmt._line,
			_col: stmt._col,
			line: stmt.line,
			col: stmt.col,
		};
	},

	_checkIncDecStmt(stmt, scope) {
		this._targetOperand(stmt.expr);
		const t = this.checkExpr(stmt.expr, scope);
		this._checkAssignTarget(stmt.expr, scope);
		const lt = t && this.resolveType(t);
		if (!lt || lt._tainted) return;
		const numeric =
			lt.kind === "typeParam"
				? this._typeParamAllows(lt, (t) =>
						isComplexOrNumeric(this._deepUnderlying(t) ?? t),
					)
				: isAny(lt)
					? !lt._declared
					: isComplexOrNumeric(lt);
		if (!numeric) {
			this.err(
				`invalid operation: ${exprText(stmt.expr)}${stmt.op} (non-numeric type ${typeStr(lt)})`,
				stmt.expr,
			);
			return;
		}
		const one = { kind: "BasicLit", litKind: "INT", value: "1" };
		this._positionLike(one, stmt);
		const node = this._operatorStmtNode(
			stmt,
			stmt.op === "++" ? "+" : "-",
			stmt.expr,
			one,
			`${exprText(stmt.expr)}${stmt.op}`,
		);
		this._typeBinaryOperands(node, lt, this.checkExpr(one, scope), scope);
	},

	_positionLike(node, at) {
		node._line = at._line;
		node._col = at._col;
		node.line = at.line;
		node.col = at.col;
	},

	// `x op= y`: the operands type as `x op y`, so one statement reports one
	// error and a shift count is not converted to the left operand's type.
	_checkCompoundOperands(stmt, i, lhsType, r, scope) {
		const lt = lhsType && this.resolveType(lhsType);
		const op = stmt.op.slice(0, -1);
		const node = this._operatorStmtNode(
			stmt,
			op,
			stmt.lhs[i],
			stmt.rhs[i],
			`${exprText(stmt.lhs[i])} ${stmt.op} ${exprText(stmt.rhs[i])}`,
		);
		this._typeBinaryOperands(node, lt, r, scope);
	},

	_checkAssignTypes(stmt, rhsFlat, lhsTypes, scope) {
		for (let i = 0; i < lhsTypes.length; i++) {
			if (stmt.lhs[i]?.kind === "Ident" && stmt.lhs[i]?.name === "_") {
				if (stmt.op === "=" && stmt.rhs.length === lhsTypes.length) {
					this._rejectUntypedNil(rhsFlat[i], stmt.rhs[i], "assignment");
					this._checkConstDefault(
						rhsFlat[i],
						stmt.rhs[i],
						"assignment to _ identifier",
					);
				}
				continue;
			}
			const r = rhsFlat[i] ?? ANY;
			this._markRangeAssignBox(stmt, i, lhsTypes[i], r);
			if (stmt.rhs.length === lhsTypes.length && lhsTypes[i] && r)
				this._markIfaceBox(
					this.resolveType(lhsTypes[i]),
					this.resolveType(r),
					stmt.rhs[i],
				);
			if (stmt.op !== "=" && stmt.op !== ":=") {
				this._checkCompoundOperands(stmt, i, lhsTypes[i], r, scope);
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
					stmt.op === "=" && stmt.rhs.length === stmt.lhs.length,
				);
				this._skipIfaceMark = false;
			}
		}
	},

	_checkAssignStmt(stmt, scope) {
		const commaOkMapTypes = this._checkAssignCommaOkMap(stmt, scope);
		if (this._isCommaOkTypeAssertAssign(stmt)) stmt.rhs[0]._commaOk = true;
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
		// A rejected range index is not checked again as an ordinary value.
		if (this._checkRangeIndexAssign(stmt, lhsTypes))
			rhsFlat = [ANY, ...rhsFlat.slice(1)];
		this._checkAssignTypes(stmt, rhsFlat, lhsTypes, scope);
	},

	// The index of a string, slice or array range is a typed `int`: Go assigns
	// it only to `int` (or an interface), never to another integer type.
	_checkRangeIndexAssign(stmt, lhsTypes) {
		const range = stmt.rhs[0];
		const lhs = stmt.lhs[0];
		if (range?.kind !== "RangeExpr" || range._isIterator) return false;
		if (!lhs || (lhs.kind === "Ident" && lhs.name === "_")) return false;
		const target = lhsTypes[0];
		if (!target || isAny(target) || typeStr(target) === "int") return false;
		const coll = this.resolveType(range.expr._coreType ?? range.expr._type);
		const cu = this._deepUnderlying(coll);
		if (!isString(cu) && cu?.kind !== "slice" && cu?.kind !== "array")
			return false;
		const tu = this.resolveType(this._deepUnderlying(target));
		if (tu?.kind === "interface") return false;
		this.err(`Cannot assign int to ${typeStr(target)}`, lhs);
		return true;
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
		// `return f()` forwards every result of a multi-value call.
		const forwarded = types.length === 1 && types[0]?.kind === "tuple";
		if (isVoid(returnType)) {
			const shown = forwarded ? { have: typeStr(types[0]), want: "()" } : null;
			const have = forwarded ? types[0].types.length : types.length;
			if (this._reportReturnCount(stmt, have, 0, shown)) return;
		}
		// Check each returned value is assignable to its declared type
		if (!isVoid(returnType) && types.length > 0) {
			const expected =
				returnType.kind === "tuple" ? returnType.types : [returnType];
			if (forwarded) {
				const results = types[0].types;
				const shown = {
					have: typeStr(types[0]),
					want: `(${expected.map(typeStr).join(", ")})`,
				};
				if (
					this._reportReturnCount(stmt, results.length, expected.length, shown)
				)
					return;
				this._checkForwardedValues(
					expected,
					results,
					stmt.values[0],
					"return statement",
				);
				return;
			}
			if (this._reportReturnCount(stmt, types.length, expected.length)) return;
			for (let i = 0; i < expected.length; i++) {
				if (types[i])
					this.assertAssignable(
						expected[i],
						types[i],
						stmt.values[i] ?? stmt,
						"return statement",
						undefined,
						true,
					);
			}
		}
	},

	// `return 1, 2` in a one-result func, `return 1` in a two-result one.
	// A forwarded call (`return f()`) has no per-value expressions, so its
	// message lists the types (`shown`) and it reports at the call.
	_reportReturnCount(stmt, have, want, shown = null) {
		if (have === want || have === 0) return false;
		const many = have > want;
		this.err(
			`${many ? "too many" : "not enough"} return values (have ${shown?.have ?? have}, want ${shown?.want ?? want})`,
			many || shown ? (stmt.values[shown ? 0 : want] ?? stmt) : stmt,
		);
		return true;
	},

	// Checks each result of a forwarded multi-value call (`return f()`,
	// `g(f())`) against its target.  Every element gets its own interface-box
	// marks in `call._fwdIface` (null where nothing is boxed): tagging the
	// shared call node would give every element the marks of the last one.
	// Lowering splits such forwards into temps that carry these marks.
	_checkForwardedValues(expected, forwarded, call, ctx) {
		const skip = this._skipIfaceMark;
		this._skipIfaceMark = true;
		try {
			for (let i = 0; i < expected.length; i++)
				this.assertAssignable(expected[i], forwarded[i], call, ctx);
		} finally {
			this._skipIfaceMark = skip;
		}
		if (!skip) this._markForwardedElems(expected, forwarded, call);
	},

	// Records in `call._fwdIface` one interface-box mark holder per forwarded
	// element (null where the element is not boxed), or clears it when no
	// element enters an interface.
	_markForwardedElems(expected, forwarded, call) {
		const holders = expected.map((t, i) => {
			const holder = {};
			this._markIfaceBox(t, forwarded[i], holder);
			return "_ifaceSrc" in holder ? holder : null;
		});
		call._fwdIface = holders.some(Boolean) ? holders : undefined;
	},

	_checkIfStmt(stmt, scope, returnType) {
		const inner = new Scope(scope);
		if (stmt.init) this.checkStmt(stmt.init, inner, returnType);
		const ct = this.checkExpr(stmt.cond, inner);
		if (ct?._declared || (!isBool(ct) && !isAny(ct)))
			this.err("non-boolean condition in if statement", stmt.cond);
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
			if (ct?._declared || (!isBool(ct) && !isAny(ct)))
				this.err("non-boolean condition in for statement", stmt.cond);
		} else {
			const operand = this._derefArrayPtr(
				stmt.cond,
				"expr",
				this._checkRangeOperand(stmt.cond.expr, inner),
				inner,
			);
			const ct = this._rangeCore(operand, stmt.cond.expr, inner);
			if (operand?._declared || this._notRangeable(ct))
				this._rangeOperandError(stmt.cond.expr, operand);
			const info = iteratorYieldParams(ct);
			if (info) {
				stmt.cond._isIterator = true;
				stmt.cond._yieldParams = info.yieldParams;
			} else if (this._deepUnderlying(ct)?.kind === "func") {
				this.err(
					"cannot range over func: not an iterator function",
					stmt.cond.expr,
				);
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
		if (stmt.tag) {
			this.checkExpr(stmt.tag, inner);
			this._rejectUntypedNil(stmt.tag._type, stmt.tag, "switch expression");
			this._checkConstDefault(stmt.tag._type, stmt.tag, "switch expression");
			this._checkSwitchTag(stmt.tag);
		}
		const tagIs64 = stmt.tag && is64BitInt(stmt.tag._type);
		const seenCases = [];
		this._switchDepth++;
		for (const c of stmt.cases) {
			const caseScope = new Scope(inner);
			if (c.list) {
				for (const e of c.list) {
					this.checkExpr(e, caseScope);
					if (stmt.tag && !isUntyped(stmt.tag._type))
						this._retypeUntypedShift(
							this.resolveType(stmt.tag._type),
							e._type,
							e,
						);
					this._checkCaseValue(stmt.tag, e);
					if (this._isDuplicateConst(seenCases, e, stmt.tag?._type, false))
						this.err(`duplicate case ${exprText(e)} in expression switch`, e);
					if (stmt.tag) this._tagFloat32Const(stmt.tag._type, e._type, e);
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
		// An interface tag compares the constant as its default type.
		if (this._isInterfaceType(tag?._type))
			this._checkConstDefault(caseType, e, "switch case");
		if (!tag) {
			this._checkTaglessCase(e, caseType);
			return;
		}
		let tagType = this.resolveType(tag._type);
		// `switch "foo" {` compares as the constant's default type.
		if (isUntyped(tagType) && !isNil(tagType)) tagType = defaultType(tagType);
		if (this._caseValueUnchecked(tagType, caseType)) return;
		if (this._isComparedByOperator(tagType, caseType)) {
			this._checkCaseComparison(tag, e, tagType, caseType);
			return;
		}
		if (isNil(caseType)) {
			this.err(`cannot convert nil to type ${typeStr(tagType)}`, e);
			return;
		}
		if (isUntyped(caseType)) {
			if (this._isUntypedAssignable(tagType, caseType)) {
				this._checkConstOverflow(tagType, caseType, e, null);
				return;
			}
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

	// A tagless `switch` is `switch true`: each case is the comparison
	// `true == e` against typed `bool`, so `e` is `bool` or an interface that
	// `bool` implements. A defined bool or a type parameter is not.
	_checkTaglessCase(e, caseType) {
		if (!caseType || caseType._tainted) return;
		if (isNil(caseType)) {
			this.err(`cannot convert nil to type bool`, e);
			return;
		}
		if (isUntyped(caseType) && caseType.base === "bool") return;
		if (caseType.kind === "basic" && caseType.name === "bool") return;
		if (this._isInterfaceType(caseType)) {
			const u = this._deepUnderlying(caseType);
			if (anyKind(caseType) === "dynamic" || !(u?.methods?.size > 0)) return;
		}
		this.err(
			`invalid case ${exprText(e)} in switch on true (mismatched types ${typeStr(caseType)} and bool)`,
			e,
		);
	},

	// The tag of `switch x {` is compared with each case, so it must be
	// comparable: a type parameter needs a comparable type set, a struct or
	// array no slice, map or func inside. A bare slice, map or func tag
	// compares with `nil`, which the case checks judge.
	_checkSwitchTag(tag) {
		const t = tag._type;
		if (!t || t._tainted || isUntyped(t)) return;
		const isParam = t.kind === "typeParam";
		const kind = isParam ? null : this._deepUnderlying(t)?.kind;
		if (isParam) {
			if (this._typeParamComparable(t)) return;
		} else if (!["struct", "array"].includes(kind) || this._isComparable(t))
			return;
		const what = isParam
			? `type ${typeStr(t)} constrained by ${this._constraintText(t)}`
			: t.kind === "named"
				? `${kind} type ${typeStr(t)}`
				: `type ${typeStr(t)}`;
		this.err(
			`cannot switch on ${exprText(tag)} (${tag.kind === "Ident" ? "variable" : "value"} of ${what}) (${typeStr(t)} is not comparable)`,
			tag,
		);
	},

	// Operands whose comparison the checker cannot (or need not) judge: unknown
	// or recovered types, JS-dynamic `any`, untyped tags, and `nil` cases whose
	// tag has a nil value.
	_caseValueUnchecked(tagType, caseType) {
		if (!tagType || !caseType || tagType._tainted || caseType._tainted)
			return true;
		if (anyKind(tagType) === "dynamic" || anyKind(caseType) === "dynamic")
			return true;
		if (isUntyped(tagType)) return true;
		if (isNil(caseType) && this._isInterfaceType(tagType)) return true;
		if (tagType.kind === "typeParam")
			return isNil(caseType) && !this._isNilless(tagType);
		if (isNil(caseType)) return this._nilCaseOk(tagType);
		return false;
	},

	// Cases the operator rule judges: every typed case, and an untyped
	// constant against a type parameter or interface tag. An untyped constant
	// against another tag keeps the constant-fit check.
	_isComparedByOperator(tagType, caseType) {
		if (isNil(caseType)) return false;
		if (!isUntyped(caseType)) return true;
		return tagType.kind === "typeParam" || this._isInterfaceType(tagType);
	},

	// `case e:` is `tag == e`: run the operator rule and report its verdict as
	// Go's `invalid case`.
	_checkCaseComparison(tag, e, tagType, caseType) {
		const reports = [];
		const realErr = this.err;
		const outer = this.errors;
		// Only the rule's own reports are taken: a quiet probe inside it swaps
		// `errors` and keeps reporting to its own list.
		this.err = (msg, node, hint) => {
			if (this.errors !== outer) return realErr.call(this, msg, node, hint);
			reports.push(msg);
			return TAINTED_ANY;
		};
		try {
			const node = { kind: "BinaryExpr", op: "==", left: tag, right: e };
			this.binaryResultType("==", tagType, caseType, node);
		} finally {
			this.err = realErr;
		}
		for (const msg of reports) {
			const reason = /^invalid operation: .* \((.*)\)$/s.exec(msg)?.[1];
			if (isUntyped(caseType) && /^mismatched types/.test(reason ?? ""))
				this.err(
					`cannot convert ${exprText(e)} (${operandKind(e, caseType.base, true)}) to type ${typeStr(tagType)}`,
					e,
				);
			else if (reason)
				this.err(
					`invalid case ${exprText(e)} in switch on ${exprText(tag)} (${
						/^mismatched types/.test(reason)
							? `mismatched types ${this._operandTypeStr(caseType)} and ${this._operandTypeStr(tagType)}`
							: reason
					})`,
					e,
				);
			else this.err(msg, e);
		}
	},

	// `case nil` needs a tag with a nil value (pointer, slice, map, func,
	// chan, interface); a basic, struct or array tag makes the caller report
	// `cannot convert nil`.
	_nilCaseOk(tagType) {
		const kind = this._deepUnderlying(tagType)?.kind;
		return !NON_NILABLE_TAG_KINDS.has(kind);
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
		if (
			t.kind === "TypeName" &&
			(this._isUniverseNil(t, scope) || t.name === "error")
		)
			return;
		const resolved = this.resolveTypeNode(t, scope);
		const u = this.resolveType(this._deepUnderlying(resolved));
		if (u?.kind === "interface") t._type = resolved;
	},

	// `nil` named in a type position (`case nil:`) with no declaration of that
	// name in scope.
	_isUniverseNil(node, scope) {
		return (
			node?.kind === "TypeName" &&
			node.name === "nil" &&
			!scope.lookupScope("nil")
		);
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
		const at = stmt._assignNode ?? stmt;
		if (stmt.assign === "_") this.err("no new variable on left side of :=", at);
		this._switchDepth++;
		this._typeSwitchDepth++;
		// Each clause declares its own copy of the binding; Go reports it when
		// no clause uses it, once, at the binding.
		let bindingUsed = false;
		for (const c of stmt.cases) {
			const caseScope = new Scope(inner);
			this._checkTypeSwitchClauseTypes(stmt, c, inner);
			if (stmt.assign) this._bindTypeSwitchClause(stmt, c, caseScope, inner);
			for (const s of c.stmts) this.checkStmt(s, caseScope, returnType);
			if (this._takeTypeSwitchBindingUse(stmt, caseScope)) bindingUsed = true;
			this._reportUnused(caseScope, stmt);
		}
		if (stmt.assign && stmt.assign !== "_" && !bindingUsed)
			this.err(`'${stmt.assign}' declared and not used`, at);
		this._typeSwitchDepth--;
		this._switchDepth--;
	},

	// Resolve instantiated generic case types so backends can tell
	// `*Stack[int]` from `*Stack[string]`.
	_checkTypeSwitchClauseTypes(stmt, clause, inner) {
		for (const t of clause.types ?? []) {
			const base = t?.kind === "PointerType" ? t.base : t;
			if (base?.kind === "GenericTypeName") this.resolveTypeNode(t, inner);
			this._markInterfaceCaseType(t, inner);
			if (t && t.kind !== "TypeName" && t.kind !== "InterfaceType")
				this._markDynamicType(t, this.resolveTypeNode(t, inner));
			this._checkTypeSwitchCase(stmt.expr, t, inner);
		}
	},

	// Whether the clause's body used the binding; an unused one is marked used
	// so the clause does not report it (the switch judges all clauses together).
	_takeTypeSwitchBindingUse(stmt, caseScope) {
		if (!stmt.assign || stmt.assign === "_") return false;
		if (!caseScope.unusedLocals().includes(stmt.assign)) return true;
		caseScope.lookup(stmt.assign);
		return false;
	},

	// Binds the variable to the single case type, or the switch operand's type
	// for multi-type and default clauses, as Go does.
	// `case nil` binds the switch expression's own type, as in Go.
	_bindTypeSwitchClause(stmt, clause, caseScope, inner) {
		const only = clause.types?.length === 1 ? clause.types[0] : null;
		const isNilCase = this._isUniverseNil(only, inner);
		const bindType = isNilCase
			? (stmt.expr._type ?? ANY)
			: only
				? this.resolveTypeNode(only, inner)
				: (stmt.expr._type ?? ANY);
		caseScope.defineLocal(stmt.assign, bindType, stmt._assignNode);
	},

	// `case T:` in a switch on an interface value `x` needs a T that can be
	// the dynamic type of `x`.
	_checkTypeSwitchCase(operand, typeNode, scope) {
		const srcType = operand._type;
		if (!typeNode || !srcType || isAny(srcType) || srcType._tainted) return;
		if (this._isUniverseNil(typeNode, scope)) return;
		const target = this.resolveTypeNode(typeNode, scope);
		if (this._isImpossibleAssertion(srcType, target))
			this.err(
				`impossible type switch case: ${exprText(operand)} (${operandKind(operand, typeStr(srcType))}) cannot have dynamic type ${typeStr(target)}`,
				typeNode,
			);
	},

	_checkLabeledStmt(stmt, scope, returnType) {
		const labels = this._labels;
		if (labels.defined.has(stmt.label))
			this.err(`label ${stmt.label} already defined`, stmt);
		labels.defined.add(stmt.label);
		const entry = newLabelEntry(stmt);
		labels.enclosing.push(entry);
		this.checkStmt(stmt.body, scope, returnType);
		labels.enclosing.pop();
		if (!entry.used) this.err(`label ${stmt.label} defined and not used`, stmt);
	},

	// `break L` needs an enclosing labeled for, switch or select; `continue L`
	// an enclosing labeled for. Returns true when `stmt` carried a label.
	_checkBranchLabel(stmt) {
		if (!stmt.label || !LABEL_BRANCHES.has(stmt.keyword)) return false;
		const { keyword, label } = stmt;
		const entry = this._labels.enclosing.findLast((e) => e.name === label);
		if (entry) entry.used = true;
		if (!entry) this.err(`${keyword} label not defined: ${label}`, stmt);
		else if (!entry[LABEL_TARGET[keyword]])
			this.err(`invalid ${keyword} label ${label}`, stmt);
		return true;
	},

	_checkBranchStmt(stmt) {
		if (!this._checkBranchLabel(stmt)) this._checkBranchKeyword(stmt);
	},

	_checkBranchKeyword(stmt) {
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

	// Reported at the range operand, as Go does.
	_checkRangeIterInvalidFunc(iterType, operand) {
		if (this._deepUnderlying(iterType)?.kind !== "func") return false;
		this.err("cannot range over func: not an iterator function", operand);
		return true;
	},

	_bindRangeIterDefineVars(lhs, info, scope) {
		for (let i = 0; i < lhs.length; i++) {
			const name = lhs[i].name ?? lhs[i];
			if (name === "_") continue;
			const varType = info.yieldParams[i] ?? ANY;
			scope.defineLocal(name, varType, lhs[i]);
		}
	},

	// Each yielded value is stored into an existing variable; one of
	// interface type boxes the value as any other conversion does.
	_checkRangeIterAssignVars(lhs, scope, yieldParams = []) {
		lhs.forEach((e, i) => {
			if (e.kind === "Ident" && e.name === "_") return;
			this._targetOperand(e);
			const target = this.checkExpr(e, scope);
			this._checkAssignTarget(e, scope);
			this._markRangeTargetBox(e, target, yieldParams[i]);
			this._checkRangeIterAssignable(e, target, yieldParams[i]);
		});
	},

	// The yielded value is assigned to the target, so it must be assignable
	// to it (`for s = range seq` with `s string` and `seq` yielding `int`).
	// `float64 = int` is reported here in the plain "Cannot assign" form: the
	// yielded value has no expression to quote.
	_checkRangeIterAssignable(node, target, source) {
		if (!target || !source) return;
		const t = this.resolveType(target);
		const v = this.resolveType(source);
		if (this._isIntToFloat(t, v)) {
			this.err(`Cannot assign ${typeStr(v)} to ${typeStr(t)}`, node);
			return;
		}
		if (!this._needsAssignCheck(target, source)) return;
		this._skipIfaceMark = true;
		try {
			this.assertAssignable(target, source, node, "assignment");
		} finally {
			this._skipIfaceMark = false;
		}
	},

	// Ranging over an integer yields only the count: `for i, v := range n`
	// has no second value to bind.
	_checkRangeIntVars(lhs, operand, type, scope, written = type) {
		if (lhs.length < 2 || !type || type._tainted) return;
		const untyped = type.kind === "untyped";
		const u = untyped ? null : this._coreUnderlying(type, scope);
		const isInt = untyped
			? type.base === "int" || type.base === "rune"
			: u?.kind === "basic" && isInteger(u);
		if (!isInt) return;
		const via =
			written?.kind === "typeParam"
				? ` constrained by ${this._constraintText(written)}`
				: "";
		this.err(
			`range over ${exprText(operand)} (${operandKind(operand, untyped ? type.base : typeStr(written), untyped)}${via}) permits only one iteration variable`,
			lhs[1],
		);
	},

	_checkRangeIterStmt(initStmt, scope, _returnType) {
		const rangeExpr = initStmt.rhs[0];
		const operand = this.checkExpr(rangeExpr.expr, scope);
		const iterType = this._rangeCore(operand, rangeExpr.expr, scope);
		const info = iteratorYieldParams(iterType);
		if (!info) {
			this._checkRangeIntVars(
				initStmt.lhs,
				rangeExpr.expr,
				iterType,
				scope,
				operand,
			);
			const rejected = this._checkRangeIterInvalidFunc(
				iterType,
				rangeExpr.expr,
			);
			// A rejected operand is not checked again as an assignment source.
			if (rejected) {
				if (initStmt.kind === "DefineStmt")
					this._bindRangeIterDefineVars(
						initStmt.lhs,
						{ yieldParams: initStmt.lhs.map(() => TAINTED_ANY) },
						scope,
					);
				else this._checkRangeIterAssignVars(initStmt.lhs, scope);
				return { yieldParams: [], rejected };
			}
			return null;
		}

		const lhs = initStmt.lhs;
		if (lhs.length > info.yieldParams.length) {
			this.err(
				`range over iterator: too many loop variables (got ${lhs.length}, max ${info.yieldParams.length})`,
				lhs[info.yieldParams.length],
			);
		}

		rangeExpr._isIterator = true;
		rangeExpr._yieldParams = info.yieldParams;

		if (initStmt.kind === "DefineStmt")
			this._bindRangeIterDefineVars(lhs, info, scope);
		else this._checkRangeIterAssignVars(lhs, scope, info.yieldParams);
		return info;
	},
};
