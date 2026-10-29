// TypeChecker expression-checking methods — installed as a mixin on TypeChecker.prototype.

import { EXCLUDED_STDLIB_MEMBERS } from "./stdlib/excluded.js";
import { sharedInfo } from "./stdlib/shared.js";
import {
	ANY,
	BOOL,
	BROWSER_GLOBALS,
	COMPLEX64,
	COMPLEX128,
	compositeLitMaxIndex,
	displayTypeName,
	ERROR,
	FLOAT32,
	FLOAT64,
	INT,
	isAny,
	isArray,
	isBool,
	isComplex,
	isComplex64,
	isComplexOrNumeric,
	isInteger,
	isNumeric,
	isString,
	NIL,
	RUNE,
	Scope,
	SIZED_INT_NAMES,
	STRING,
	TAINTED_ANY,
	typeStr,
	UNTYPED_BOOL,
	UNTYPED_COMPLEX,
	UNTYPED_FLOAT,
	UNTYPED_INT,
	UNTYPED_STRING,
	VOID,
} from "./types.js";

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

// min/max: the type of the first typed operand; with only untyped constants,
// an untyped float if any operand is one (Go's "largest kind" rule).
function minMaxType(at) {
	const typed = at.find((t) => t && t.kind !== "untyped");
	if (typed) return typed;
	return at.find((t) => t?.base === "float64") ?? at[0] ?? ANY;
}

// Dispatch table for builtin function type checking.
// Each value is (self, name, expr, argTypes, scope) => returnType.
const BUILTIN_CHECK = {
	len: (s, n, e, at) => s._checkBuiltinLen(n, e, at),
	cap: (s, n, e, at) => s._checkBuiltinLen(n, e, at),
	append: (s, _n, e, at) => {
		const st = at[0] ?? ANY;
		if (isArray(st)) {
			s.err(`cannot append to array (type ${typeStr(st)})`, e);
			return st;
		}
		if (sharedInfo(st)) {
			s.err(
				`cannot append to ${typeStr(st)}: shared buffers have a fixed size`,
				e,
			);
			return st;
		}
		const sb = s.resolveType(st?.kind === "named" ? st.underlying : st);
		if (sb?.kind === "slice") {
			for (let i = 1; i < e.args.length; i++) {
				if (e.args[i]._spread)
					s._rejectSeqAsSlice(at[i], e.args[i], "a spread argument");
				if (!e.args[i]._spread && at[i])
					s._markIfaceBox(
						s.resolveType(sb.elem),
						s.resolveType(at[i]),
						e.args[i],
					);
			}
		}
		return st;
	},
	copy: (s, _n, e, at) => s._checkBuiltinCopy(e, at),
	delete: () => VOID,
	make: (s, _n, e, _at, sc) => {
		if (e.args.length < 1) return ANY;
		const ta = e.args[0];
		const tn = ta.kind === "TypeExpr" ? ta.type : ta;
		return s.resolveTypeNode(tn, sc) ?? ANY;
	},
	new: (s, _n, e, _at, sc) => {
		if (e.args.length < 1) return ANY;
		const ta = e.args[0];
		const inner = s.resolveTypeNode(ta.kind === "TypeExpr" ? ta.type : ta, sc);
		return { kind: "pointer", base: inner };
	},
	print: (s, n, e, at) => s._checkPrintArgs(n, e, at),
	println: (s, n, e, at) => s._checkPrintArgs(n, e, at),
	panic: () => VOID,
	recover: () => ANY,
	error: () => ERROR,
	min: (_s, _n, _e, at) => minMaxType(at),
	max: (_s, _n, _e, at) => minMaxType(at),
	clear: () => VOID,
	complex: (s, _n, e, at) => s._checkBuiltinComplex(e, at),
	real: (s, n, e, at) => s._checkBuiltinRealImag(n, e, at),
	imag: (s, n, e, at) => s._checkBuiltinRealImag(n, e, at),
};

// Method-name dispatch for _checkExpr — string values add no static call edges.
const CHECK_EXPR_DELEGATE = {
	UnaryExpr: "_checkUnaryExpr",
	CallExpr: "checkCall",
	SelectorExpr: "_checkSelectorExpr",
	IndexExpr: "_checkIndexExpr",
	SliceExpr: "_checkSliceExpr",
	CompositeLit: "checkCompositeLit",
	FuncLit: "_checkFuncLit",
	TypeConversion: "_checkTypeConversion",
	TypeAssertExpr: "_checkTypeAssertExpr",
	RangeExpr: "_checkRangeExpr",
	InstantiationExpr: "_checkInstantiationExpr",
};

/** @type {ThisType<TypeChecker>} */
export const expressionCheckMethods = {
	checkExpr(expr, scope) {
		const t = this._checkExpr(expr, scope);
		expr._type = t;
		this._noteConst(expr, scope);
		return t;
	},

	_checkExpr(expr, scope) {
		switch (expr.kind) {
			case "BasicLit": {
				switch (expr.litKind) {
					case "INT":
						return UNTYPED_INT;
					case "FLOAT":
						return UNTYPED_FLOAT;
					case "STRING":
						return UNTYPED_STRING;
					case "BOOL":
						return UNTYPED_BOOL;
					case "NIL":
						return NIL;
				}
				break;
			}
			case "ImagLit":
				return UNTYPED_COMPLEX;
			case "Ident": {
				const t = scope.lookup(expr.name);
				if (!t) return this.err(`Undefined: '${expr.name}'`, expr);
				if (this.types.has(expr.name) || t.kind === "typeParam")
					expr._isTypeRef = true;
				// A Go declaration that shadows a browser global: JS output renames
				// it so generated code keeps reaching the real global.  Package
				// namespaces (`import console "./util"`) are never renamed: JS
				// selects their members directly (bundledPackages).
				if (BROWSER_GLOBALS.has(expr.name) && t.kind !== "namespace") {
					const owner = scope.lookupScope(expr.name);
					if (
						owner !== this.universe &&
						!(owner === this.globals && this._externalNames.has(expr.name))
					)
						expr._shadowsGlobal = true;
				}
				// Go-source stdlib loading: record package-scope references so the
				// loader can mangle them (see compiler.js loadStdlibPackage).
				if (this._pkgRefs && scope.lookupScope(expr.name) === this.globals)
					this._pkgRefs.add(`${this._currentFile}:${expr._line}:${expr._col}`);
				if (
					(this.target === "wasm" || this.target === "both") &&
					BROWSER_GLOBALS.has(expr.name) &&
					scope.lookupScope(expr.name) === this.universe
				) {
					this.recordBlocker("browser global", expr.name);
					this.err(
						`'${expr.name}' is not available in wasm packages`,
						expr,
						`(package '${this.pkgName}' is //gofront:target ${this.target} — browser globals are only available in js packages)`,
					);
				}
				if (
					(this.target === "wasm" || this.target === "both") &&
					expr.name === "gom" &&
					scope.lookup(expr.name) === this.globals.lookup(expr.name)
				) {
					this.recordBlocker("gom usage", "gom");
					this.err("package 'gom' is not available in wasm packages", expr);
				}
				return t;
			}
			case "BinaryExpr": {
				const lt = this.checkExpr(expr.left, scope);
				const rt = this.checkExpr(expr.right, scope);
				if (lt?._tainted || rt?._tainted) return TAINTED_ANY;
				if (isAny(lt) || isAny(rt))
					return this.binaryResultType(expr.op, ANY, ANY, expr);
				this._checkConstOperands(expr.op, lt, rt, expr);
				return this.binaryResultType(expr.op, lt, rt, expr);
			}
			case "AwaitExpr": {
				if (this.target === "wasm" || this.target === "both") {
					this.recordBlocker("async function");
					this.err(
						"async functions are not supported in wasm packages; keep async code in a js package",
						expr,
					);
				}
				return this.checkExpr(expr.expr, scope);
			}
			case "InstantiationExpr":
				return this._checkInstantiationExpr(expr, scope);
			case "TypeName":
				// A type in expression position: monomorphisation rewrites
				// `Box[int]` in `(*Box[int]).Set` to the TypeName `Box$int`.
				expr._isTypeRef = true;
				return this._typeRefOperand(expr, this.resolveTypeNode(expr, scope));
			default: {
				const m = CHECK_EXPR_DELEGATE[expr.kind];
				if (m) return this[m](expr, scope);
				return ANY;
			}
		}
		return ANY;
	},

	// A type ref (`*T`, `Box[int]`) is a value only as the base of a method
	// expression (`(*T).M`), a conversion callee or the operand of `*`.
	_typeRefOperand(expr, t) {
		if (expr._typeRefOk) return t;
		return this.err(`${typeStr(t)} (type) is not an expression`, expr);
	},

	_checkDeref(ot, expr) {
		if (ot === ANY) return ANY;
		if (ot.kind === "pointer") return ot.base;
		if (ot.kind === "named" && ot.underlying?.kind === "pointer")
			return ot.underlying.base;
		this.err(`cannot dereference non-pointer type ${typeStr(ot)}`, expr);
		return ANY;
	},

	_checkBoolUnaryOp(ot, expr) {
		if (!isBool(ot) && !isAny(ot)) this.err("! requires bool", expr);
		return BOOL;
	},

	_checkNumericUnaryOp(ot, expr) {
		if (ot?.kind === "typeParam") {
			if (!this._typeParamAllows(ot, isComplexOrNumeric))
				this.err(`${expr.op} requires numeric`, expr);
			return ot;
		}
		if (!isNumeric(ot) && !isComplex(ot) && !isAny(ot))
			this.err(`${expr.op} requires numeric`, expr);
		return ot;
	},

	// `^x` on a type parameter needs every type in its constraint to be an
	// integer.  Other operands keep the existing (unchecked) behaviour.
	_checkComplementUnaryOp(ot, expr) {
		if (ot?.kind === "typeParam" && !this._typeParamAllows(ot, isInteger))
			this.err("^ requires integer", expr);
		return ot;
	},

	// Whether every type in the type set of type parameter `tp`'s constraint
	// satisfies `pred`.  A constraint without a type set (any, comparable,
	// method-only interfaces) allows nothing.
	_typeParamAllows(tp, pred) {
		const terms = this._constraintTerms(tp.constraint, new Set());
		return terms !== null && terms.length > 0 && terms.every(pred);
	},

	_constraintTerms(c, seen) {
		if (!c || seen.has(c)) return null;
		seen.add(c);
		// Receiver type parameters keep their constraint as an AST node.
		if (c.kind === "TypeName" || c.kind === "InterfaceType")
			return this._constraintTerms(this.resolveTypeNode(c, this.globals), seen);
		if (c.kind === "named") return this._constraintTerms(c.underlying, seen);
		if (c.kind === "interface") return this._interfaceTerms(c, seen);
		if (c.kind === "typeParam")
			return this._constraintTerms(c.constraint, seen);
		if (c.kind !== "UnionConstraint") return isAny(c) ? null : [c];
		const out = [];
		for (const term of c.terms) {
			const t = this.resolveTypeNode(term.type, this.globals);
			const inner =
				t?.kind === "named" && t.underlying?.kind === "interface"
					? this._constraintTerms(t, seen)
					: [t];
			if (inner === null) return null;
			out.push(...inner);
		}
		return out;
	},

	// An interface's type set is the intersection of its own union and the
	// type sets of the interfaces it embeds; null when it has none.
	_interfaceTerms(iface, seen) {
		const sets = [iface.unionConstraint, ...(iface._typeSetEmbeds ?? [])]
			.filter(Boolean)
			.map((s) => this._constraintTerms(s, new Set(seen)));
		if (sets.length === 0 || sets.includes(null)) return null;
		const [first, ...rest] = sets;
		return first.filter((t) =>
			rest.every((set) => set.some((u) => typeStr(u) === typeStr(t))),
		);
	},

	// Only structs and arrays are their own managed objects in wasm; every other
	// value (numbers, strings, slices, maps, interfaces, pointers, funcs, SIMD
	// vectors) lives inline in its parent struct, array or global, so wasm has
	// no stable address for it.  Type parameters are checked per instantiation.
	_isScalarStorageType(t) {
		const u = this.resolveType(t?.kind === "named" ? t.underlying : t) ?? t;
		const k = u?.kind;
		if (!k || u._tainted) return false;
		return k !== "struct" && k !== "array" && k !== "typeParam";
	},

	// True when `operand` is a struct field, array/slice element or package-level
	// variable holding a scalar, in a package compiled to wasm.
	_isScalarInteriorOperand(operand, type, scope) {
		if (!this._isWasmPackage()) return false;
		let node = operand;
		while (node?.kind === "ParenExpr") node = node.expr;
		if (!node) return false;
		if (node.kind === "Ident") {
			if (scope.lookupScope(node.name) !== this.globals) return false;
			if (scope.isConst?.(node.name)) return false;
			const sym = this.globals.symbols.get(node.name);
			if (sym?.kind === "func" || sym?.kind === "namespace") return false;
		} else if (node.kind !== "SelectorExpr" && node.kind !== "IndexExpr") {
			return false;
		}
		if (node.kind === "SelectorExpr" && node.expr?._isTypeRef) return false;
		if (node.kind === "SelectorExpr" && node.expr?._type?.kind === "namespace")
			return false;
		return this._isScalarStorageType(type);
	},

	// Postfix selectors and index expressions carry no position; report at
	// their innermost positioned operand.
	_positioned(node) {
		let at = node;
		while (at && !at._line && !at.line) at = at.operand ?? at.expr;
		return at ?? node;
	},

	_errScalarInteriorAddress(node, type) {
		return this.err(
			`cannot take the address of a field, element or package-level variable of type ${typeStr(type)} in a ${this.target} package; only struct and array values have a stable address in WebAssembly. Pass the parent struct pointer or the index instead, or copy the value to a local variable`,
			this._positioned(node),
		);
	},

	// Go: map elements are not addressable, nor are fields and array elements
	// reached from one by value (`&m[k]`, `&m[k].f`, `&m[k][i]` on an array).
	_isMapElementOperand(operand) {
		let node = operand;
		while (node?.kind === "ParenExpr") node = node.expr;
		if (node?.kind !== "SelectorExpr" && node?.kind !== "IndexExpr")
			return false;
		const bt = node.expr?._type;
		const b = this.resolveType(bt?.kind === "named" ? bt.underlying : bt) ?? bt;
		if (node.kind === "IndexExpr" && b?.kind === "map") return true;
		if (b?.kind === "pointer" || b?.kind === "slice") return false;
		if (node.kind === "SelectorExpr" && b?.kind !== "struct") return false;
		if (
			node.kind === "SelectorExpr" &&
			this._promotedThroughPointer(bt, node.field)
		)
			return false;
		return this._isMapElementOperand(node.expr);
	},

	// Whether field or method `name` of struct type `t` is promoted through an
	// embedded pointer, so selecting it dereferences and is addressable.
	_promotedThroughPointer(t, name) {
		return this._selectorPath(t, name, 0) === "pointer";
	},

	// "pointer" when `name` is reached through an embedded pointer, "value"
	// when it is found without one, null when `t` has no such member.
	_selectorPath(t, name, depth) {
		if (!t || depth > 8) return null;
		if (t.kind === "named" && t.methods?.has(name)) return "value";
		const st = this.resolveType(t.kind === "named" ? t.underlying : t) ?? t;
		if (st?.kind !== "struct") return null;
		for (const f of st._structFields ?? [])
			if (!f.embedded && f.names?.includes(name)) return "value";
		for (const e of st._embeds ?? []) {
			const found = this._selectorPath(
				e.kind === "pointer" ? e.base : e,
				name,
				depth + 1,
			);
			if (found) return e.kind === "pointer" ? "pointer" : found;
		}
		return null;
	},

	_errMapElementAddress(node) {
		return this.err(
			"cannot take the address of a map element; copy it to a local variable, or store pointers in the map",
			this._positioned(node),
		);
	},

	_isWasmPackage() {
		return this.target === "wasm" || this.target === "both";
	},

	_isFuncType(t) {
		const u = this.resolveType(t?.kind === "named" ? t.underlying : t) ?? t;
		return u?.kind === "func";
	},

	// The WASM backend represents a func value by its closure reference and has
	// no box for it, so a pointer to a func variable would lose writes.
	_errFuncAddress(node, type) {
		return this.err(
			`cannot take the address of a variable of func type ${typeStr(type)} in a ${this.target} package; return the new func, or pass a pointer to a struct that holds it`,
			this._positioned(node),
		);
	},

	_checkAddressOfExpr(expr, scope, ot) {
		if (this._isMapElementOperand(expr.operand)) {
			this._errMapElementAddress(expr);
			return { kind: "pointer", base: ot };
		}
		if (this._isScalarInteriorOperand(expr.operand, ot, scope)) {
			this._errScalarInteriorAddress(expr, ot);
			return { kind: "pointer", base: ot };
		}
		if (this._isWasmPackage() && this._isFuncType(ot)) {
			this._errFuncAddress(expr, ot);
			return { kind: "pointer", base: ot };
		}
		if (expr.operand.kind === "Ident") {
			expr.operand._addressTaken = true;
			const sym = scope.lookup(expr.operand.name);
			if (sym) sym._addressTaken = true;
		}
		return { kind: "pointer", base: ot };
	},

	_checkUnaryExpr(expr, scope) {
		if (expr.op === "*") expr.operand._typeRefOk = true;
		const ot = this.checkExpr(expr.operand, scope);
		if (expr.op === "!") return this._checkBoolUnaryOp(ot, expr);
		if (expr.op === "-" || expr.op === "+")
			return this._checkNumericUnaryOp(ot, expr);
		if (expr.op === "^") return this._checkComplementUnaryOp(ot, expr);
		if (expr.op === "&") return this._checkAddressOfExpr(expr, scope, ot);
		if (expr.op === "*") {
			// `(*T).M`: the operand names a type, so `*T` is the pointer type
			// of a method expression, not a dereference.
			if (expr.operand._isTypeRef) {
				expr._isTypeRef = true;
				return this._typeRefOperand(expr, { kind: "pointer", base: ot });
			}
			return this._checkDeref(ot, expr);
		}
		return ot;
	},

	_isStructOrNamedMethod(baseType, base, field) {
		return (
			(base?.kind === "struct" && base.methods?.has(field)) ||
			(base?.kind === "simd" && base.methods?.has(field)) ||
			(baseType.kind === "named" && baseType.methods?.has(field))
		);
	},

	_resolveMethodExprType(baseType, base, field) {
		if (!this._isStructOrNamedMethod(baseType, base, field)) return null;
		return base?.methods?.get(field) ?? baseType.methods?.get(field);
	},

	// Instantiated generic methods are substituted copies without `_ptrRecv`,
	// so read it from the generic declaration's method.
	_methodExprPtrRecv(recvBase, methodType, field) {
		if (!methodType) return false;
		if (Object.hasOwn(methodType, "_ptrRecv")) return methodType._ptrRecv;
		const generic = recvBase.typeArgs
			? this.types.get(recvBase.name)?._generic
			: null;
		return Boolean(generic?.methods?.get(field)?._ptrRecv);
	},

	// `x.M` or `x.M()` with a pointer receiver on a named scalar or slice local takes
	// `&x`, so `x` must be boxed like an explicit `&x`.
	_markPtrRecvAddress(expr, base, ft, scope) {
		if (!ft._ptrRecv) return;
		if (
			!this._promotedThroughPointer(expr.expr._type, expr.field) &&
			this._isMapElementOperand(expr.expr)
		) {
			this._errMapElementAddress(expr.expr);
			return;
		}
		const k = base?.kind;
		if (k !== "basic" && k !== "slice" && k !== "map" && k !== "func") return;
		if (this._isScalarInteriorOperand(expr.expr, expr.expr._type, scope)) {
			this._errScalarInteriorAddress(expr, expr.expr._type);
			return;
		}
		if (k === "func" && this._isWasmPackage()) {
			this._errFuncAddress(expr, expr.expr._type);
			return;
		}
		if (expr.expr.kind !== "Ident") return;
		expr.expr._addressTaken = true;
		const sym = scope.lookup(expr.expr.name);
		if (sym) sym._addressTaken = true;
	},

	// Resolved per file from the import path, so a local package sharing an
	// identifier with a stdlib one (or a stdlib import in another file) never matches.
	_checkExcludedNamespaceMember(expr, baseType) {
		const pkgPath = this._fileImports
			?.get(this._currentFile)
			?.get(baseType.name);
		if (!pkgPath || pkgPath.startsWith(".")) return null;
		const key = `${pkgPath}.${expr.field}`;
		if (!EXCLUDED_STDLIB_MEMBERS.has(key)) return null;
		return this.err(
			`${baseType.name}.${expr.field} is not available: ${EXCLUDED_STDLIB_MEMBERS.get(key)}`,
			expr,
		);
	},

	_checkExcludedSelectorExpr(expr, baseType) {
		if (baseType?.kind === "namespace") {
			return this._checkExcludedNamespaceMember(expr, baseType);
		}
		const recvCheck =
			baseType?.kind === "pointer"
				? (this.resolveType(baseType.base) ?? baseType.base)
				: baseType;
		const recvName = recvCheck?.name;
		// Stdlib named types are qualified (`pkg.T` or mangled `T$$pkg`); a
		// bare name is a user type and never matches the exclusion table.
		if (!recvName || !/[.$]/.test(recvName)) return null;
		const dName = displayTypeName(recvName);
		const reason =
			EXCLUDED_STDLIB_MEMBERS.get(`${dName}.${expr.field}`) ??
			EXCLUDED_STDLIB_MEMBERS.get(`${recvName}.${expr.field}`);
		if (!reason) return null;
		return this.err(`${dName}.${expr.field} is not available: ${reason}`, expr);
	},

	_checkMethodExprSelector(expr, baseType) {
		const recvBase = baseType.kind === "pointer" ? baseType.base : baseType;
		const base = this.resolveType(
			recvBase.kind === "named" ? recvBase.underlying : recvBase,
		);
		const methodType = this._resolveMethodExprType(recvBase, base, expr.field);
		if (
			this._methodExprPtrRecv(recvBase, methodType, expr.field) &&
			baseType.kind !== "pointer"
		) {
			const t = typeStr(baseType);
			return this.err(
				`invalid method expression ${t}.${expr.field} (needs pointer receiver (*${t}).${expr.field})`,
				expr,
			);
		}
		if (!methodType) return null;
		expr._isMethodExpr = true;
		expr._methodExprRecv = baseType;
		return {
			kind: "func",
			params: [baseType, ...(methodType.params ?? [])],
			returns: methodType.returns ?? [],
			variadic: methodType.variadic,
		};
	},

	_markMethodValueSelector(expr, baseType, ft, scope) {
		const recvT =
			baseType.kind === "pointer"
				? (this.resolveType(baseType.base) ?? baseType.base)
				: baseType;
		const base = this.resolveType(
			recvT?.kind === "named" ? recvT.underlying : recvT,
		);
		if (!recvT || !this._isStructOrNamedMethod(recvT, base, expr.field)) return;
		expr._isMethodValue = true;
		if (baseType.kind === "pointer")
			expr._derefRecv = !this._methodExprPtrRecv(recvT, ft, expr.field);
		else this._markPtrRecvAddress(expr, base, ft, scope);
	},

	_checkSelectorExpr(expr, scope) {
		expr.expr._typeRefOk = true;
		const baseType = this.checkExpr(expr.expr, scope);
		if (baseType?._tainted) return TAINTED_ANY;
		const exclErr = this._checkExcludedSelectorExpr(expr, baseType);
		if (exclErr) return exclErr;
		if (expr.expr._isTypeRef) {
			const mExpr = this._checkMethodExprSelector(expr, baseType);
			if (mExpr) return mExpr;
		}
		const ft = this.fieldType(baseType, expr.field, expr);
		if (ft?.kind === "func")
			this._markMethodValueSelector(expr, baseType, ft, scope);
		if (
			baseType?.kind === "namespace" &&
			this.types.has(`${baseType.name}.${expr.field}`) &&
			baseType.name !== "binary"
		) {
			expr._isTypeRef = true;
		}
		return ft;
	},

	_checkArrayBoundsExpr(btu, bt, expr, scope) {
		if (btu.kind !== "array" || btu.size == null) return;
		const idx = this._constIntValue(expr.index, scope);
		if (idx === null) return;
		if (idx < 0)
			this.err(`invalid array index ${idx} (index must not be negative)`, expr);
		else if (idx >= btu.size)
			this.err(
				`invalid array index ${idx} (out of bounds for ${typeStr(bt)})`,
				expr,
			);
	},

	// `Box[int]` in an expression (the receiver of a method expression such
	// as `Box[int].Get` or `(*Box[int]).Set`) names the instantiated type.
	// The node becomes an InstantiationExpr so monomorphisation rewrites it.
	_genericTypeRef(expr, scope) {
		const base = expr.expr;
		let t;
		if (base?.kind === "SelectorExpr" && base.expr?.kind === "Ident") {
			// `iter.Seq[int]`: a generic type behind a package qualifier.
			if (scope.lookup(base.expr.name)?.kind !== "namespace") return null;
			t = this.types.get(`${base.expr.name}.${base.field}`);
			if (!t?._generic || t._generic.isAlias) return null;
		} else {
			if (base?.kind !== "Ident") return null;
			t = this.types.get(base.name);
			if (!t?._generic || t._generic.isAlias || scope.lookup(base.name) !== t)
				return null;
		}
		if (expr.kind === "IndexExpr") {
			if (expr.index?.kind !== "Ident") return null;
			expr.kind = "InstantiationExpr";
			expr.typeArgs = [{ kind: "TypeName", name: expr.index.name }];
			delete expr.index;
		}
		const resolved = this.resolveTypeNode(expr, scope);
		expr._isTypeRef = true;
		return this._typeRefOperand(expr, resolved);
	},

	// Underlying type with chains of defined types followed through
	// (`type W V` where `V` is itself a named array).
	_deepUnderlying(t) {
		let u = t;
		for (let i = 0; u?.kind === "named" && i < 32; i++)
			u = this.resolveType(u.underlying) ?? u.underlying;
		return u;
	},

	_checkIndexExpr(expr, scope) {
		const typeRef = this._genericTypeRef(expr, scope);
		if (typeRef) return typeRef;
		const bt = this._derefArrayPtr(
			expr,
			"expr",
			this.checkExpr(expr.expr, scope),
		);
		if (bt?.kind === "generic") {
			const inst = this._genericFuncValueAsInstantiation(expr);
			if (inst) return this._checkInstantiationExpr(inst, scope);
		}
		this.checkExpr(expr.index, scope);
		if (bt?._tainted) return TAINTED_ANY;
		if (isAny(bt)) return ANY;
		const btu = this._deepUnderlying(bt);
		if (btu.kind === "slice" || btu.kind === "array") {
			this._checkArrayBoundsExpr(btu, bt, expr, scope);
			return btu.elem;
		}
		if (btu.kind === "map") {
			expr._mapValueType = btu.value;
			return btu.value;
		}
		if (btu.kind === "shared") {
			expr._sharedElem = btu.elem;
			const idx = this._constIntValue(expr.index, scope);
			if (idx !== null && idx < 0)
				this.err(`invalid index ${idx} (index must not be negative)`, expr);
			return btu.elem;
		}
		if (isString(bt)) return INT;
		return this.err(`Cannot index type ${typeStr(bt)}`, expr);
	},

	// `Id[int]` used as a value reaches the typechecker as an IndexExpr (the
	// parser only commits to type arguments before a call or literal).  The
	// node becomes an InstantiationExpr so both backends specialise it.
	_genericFuncValueAsInstantiation(expr) {
		const toTypeNode = (n) => {
			if (n?.kind === "TypeExpr") return n.type;
			const parts = [];
			let cur = n;
			while (cur?.kind === "SelectorExpr") {
				parts.unshift(cur.field);
				cur = cur.expr;
			}
			if (cur?.kind !== "Ident") return null;
			parts.unshift(cur.name);
			return { kind: "TypeName", name: parts.join("."), _line: n._line };
		};
		const typeArg = toTypeNode(expr.index);
		if (!typeArg) return null;
		expr.kind = "InstantiationExpr";
		expr.typeArgs = [typeArg];
		delete expr.index;
		return expr;
	},

	// copy(dst, src): element types must be identical when either side is a
	// shared buffer (the wasm emitter uses one element type for both sides).
	_checkBuiltinCopy(e, at) {
		const elemOf = (t) => {
			const u = this.resolveType(t?.kind === "named" ? t.underlying : t);
			return u?.kind === "slice" || u?.kind === "shared" ? u.elem : null;
		};
		const [dt, st] = at;
		if (!sharedInfo(dt) && !sharedInfo(st)) return INT;
		const de = elemOf(dt);
		const se = elemOf(st);
		if (!de || !se) {
			this.err(
				`copy: cannot copy between ${typeStr(dt)} and ${typeStr(st)}`,
				e,
			);
		} else if (typeStr(de) !== typeStr(se)) {
			this.err(
				`copy: element types differ (${typeStr(dt)} vs ${typeStr(st)})`,
				e,
			);
		}
		return INT;
	},

	// Go's shorthand for pointers to arrays: `p[i]`, `p[lo:hi]`, `len(p)` and
	// `range p` mean `(*p)[i]` and so on.  The operand is rewritten to an
	// explicit dereference so every backend sees the array.
	_derefArrayPtr(holder, key, t) {
		if (t?.kind !== "pointer") return t;
		const base = t.base?.kind === "named" ? this.resolveType(t.base) : t.base;
		const under = base?.kind === "named" ? base.underlying : base;
		if (under?.kind !== "array") return t;
		holder[key] = { kind: "UnaryExpr", op: "*", operand: holder[key] };
		holder[key]._type = t.base;
		return t.base;
	},

	_checkSliceExpr(expr, scope) {
		const bt = this._derefArrayPtr(
			expr,
			"expr",
			this.checkExpr(expr.expr, scope),
		);
		if (expr.low) this.checkExpr(expr.low, scope);
		if (expr.high) this.checkExpr(expr.high, scope);
		if (expr.max) this.checkExpr(expr.max, scope);
		if (bt?._tainted) return TAINTED_ANY;
		if (isAny(bt)) return ANY;
		const btu = this._deepUnderlying(bt);
		if (btu.kind === "slice" || btu.kind === "array")
			return { kind: "slice", elem: btu.elem };
		if (isString(bt)) return STRING;
		if (sharedInfo(bt))
			return this.err(
				`Cannot slice type ${typeStr(bt)}: use .Subarray(lo, hi) to create a view of a shared buffer`,
				expr,
			);
		return this.err(`Cannot slice type ${typeStr(bt)}`, expr);
	},

	_checkFuncLit(expr, scope) {
		const savedSharedAlloc = this._sharedAllocOk;
		this._sharedAllocOk = false;
		try {
			return this._checkFuncLitBody(expr, scope);
		} finally {
			this._sharedAllocOk = savedSharedAlloc;
		}
	},

	_checkFuncLitBody(expr, scope) {
		if (
			(this.target === "wasm" || this.target === "both") &&
			(expr.async || expr.isAsync)
		) {
			this.recordBlocker("async function");
			this.err(
				"async functions are not supported in wasm packages; keep async code in a js package",
				expr,
			);
		}
		const inner = new Scope(scope);
		for (const p of expr.params)
			inner.define(p.name, p.type ? this._paramType(p, scope) : ANY);
		const ret = expr.returnType
			? this.resolveTypeNode(expr.returnType, scope)
			: VOID;
		const savedDefer = this._deferCount;
		this._deferCount = 0;
		this.checkBlock(expr.body, inner, ret);
		this._reportUnused(inner, expr);
		if (this._deferCount > 0) expr.body._hasDefer = true;
		this._deferCount = savedDefer;
		const paramTypes = expr.params.map((p) =>
			p.type ? this.resolveTypeNode(p.type, scope) : ANY,
		);
		return {
			kind: "func",
			params: paramTypes,
			returns: [ret],
			variadic: expr.params.at(-1)?.variadic === true,
			async: expr.async,
		};
	},

	_checkElemTypeCompatible(tgtElem, srcElem, srcType, targetType, expr) {
		if (
			tgtElem &&
			srcElem &&
			!isAny(tgtElem) &&
			!isAny(srcElem) &&
			typeStr(tgtElem) !== typeStr(srcElem)
		)
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
	},

	_isMutualArraySlice(tgt, src) {
		return (
			(tgt?.kind === "array" && src?.kind === "slice") ||
			(tgt?.kind === "slice" && src?.kind === "array")
		);
	},

	// Struct types with identical field names and types convert to each other.
	_sameStructFields(a, b) {
		if (a?.kind !== "struct" || b?.kind !== "struct") return false;
		if (a.fields.size !== b.fields.size) return false;
		const bf = [...b.fields];
		let i = 0;
		for (const [name, type] of a.fields) {
			const [bn, bt] = bf[i++];
			if (name !== bn || typeStr(type) !== typeStr(bt)) return false;
		}
		return true;
	},

	_isInvalidArrayConv(tgt, src, srcType) {
		return tgt?.kind === "array" && src?.kind !== "array" && !isAny(srcType);
	},

	_checkTypeConversion(expr, scope) {
		const srcType = this.checkExpr(expr.expr, scope);
		const targetType = this.resolveTypeNode(expr.targetType, scope);
		const srcResolved =
			srcType?.kind === "named" ? srcType.underlying : srcType;
		const tgtResolved =
			targetType?.kind === "named" ? targetType.underlying : targetType;
		if (isNumeric(targetType) && isComplex(srcType)) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)} (use real() or imag())`,
				expr,
			);
		}
		if (
			isComplex(targetType) &&
			!isComplexOrNumeric(srcType) &&
			!isAny(srcType)
		) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
		}
		if (tgtResolved?.kind === "slice")
			this._rejectSeqAsSlice(srcType, expr.expr, "a slice conversion");
		if (this._isMutualArraySlice(tgtResolved, srcResolved)) {
			this._checkElemTypeCompatible(
				tgtResolved.elem,
				srcResolved.elem,
				srcType,
				targetType,
				expr,
			);
			return targetType;
		}
		if (this._isInvalidArrayConv(tgtResolved, srcResolved, srcType)) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
		}
		return targetType;
	},

	_checkConversionValidity(srcType, targetType, expr) {
		if (!srcType || !targetType || isAny(srcType) || isAny(targetType)) return;
		const srcResolved = srcType.kind === "named" ? srcType.underlying : srcType;
		const tgtResolved =
			targetType.kind === "named" ? targetType.underlying : targetType;

		if (isNumeric(targetType) && isComplex(srcType)) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)} (use real() or imag())`,
				expr,
			);
			return;
		}
		if (isComplex(targetType) && !isComplexOrNumeric(srcType)) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
			return;
		}
		if (tgtResolved?.kind === "slice")
			this._rejectSeqAsSlice(srcType, expr.args?.[0], "a slice conversion");
		if (this._isMutualArraySlice(tgtResolved, srcResolved)) {
			this._checkElemTypeCompatible(
				tgtResolved.elem,
				srcResolved.elem,
				srcType,
				targetType,
				expr,
			);
			return;
		}
		if (this._isInvalidArrayConv(tgtResolved, srcResolved, srcType)) {
			this.err(
				`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
				expr,
			);
			return;
		}
		if (typeStr(srcResolved) === typeStr(tgtResolved)) return;
		if (this._sameStructFields(srcResolved, tgtResolved)) return;
		if (isNumeric(srcResolved) && isNumeric(tgtResolved)) return;
		if (isString(srcResolved) && isString(tgtResolved)) return;
		if (isBool(srcResolved) && isBool(tgtResolved)) return;
		if (
			(isComplex(srcResolved) || isNumeric(srcResolved)) &&
			isComplex(tgtResolved)
		)
			return;
		if (
			isString(srcResolved) &&
			tgtResolved?.kind === "slice" &&
			(tgtResolved.elem?.name === "byte" ||
				tgtResolved.elem?.name === "rune" ||
				tgtResolved.elem?.name === "uint8" ||
				tgtResolved.elem?.name === "int32")
		)
			return;
		if (
			isString(tgtResolved) &&
			(isNumeric(srcResolved) ||
				(srcResolved?.kind === "slice" &&
					(srcResolved.elem?.name === "byte" ||
						srcResolved.elem?.name === "rune" ||
						srcResolved.elem?.name === "uint8" ||
						srcResolved.elem?.name === "int32")))
		)
			return;
		if (srcResolved?.kind === "pointer" && tgtResolved?.kind === "pointer") {
			const sBase =
				srcResolved.base?.kind === "named"
					? srcResolved.base.underlying
					: srcResolved.base;
			const tBase =
				tgtResolved.base?.kind === "named"
					? tgtResolved.base.underlying
					: tgtResolved.base;
			if (typeStr(sBase) === typeStr(tBase)) return;
		}
		this.err(
			`cannot convert ${typeStr(srcType)} to ${typeStr(targetType)}`,
			expr,
		);
	},

	_checkTypeAssertExpr(expr, scope) {
		const srcType = this.checkExpr(expr.expr, scope);
		const targetType = this.resolveTypeNode(expr.type, scope);

		// In Go, the source of a type assertion must be an interface type.
		// We allow `any` (which is GoFront's basic any) and interface types.
		if (srcType && !isAny(srcType)) {
			let underlying = srcType.kind === "named" ? srcType.underlying : srcType;
			underlying = this.resolveType(underlying);
			if (underlying?.kind !== "interface") {
				this.err(
					`invalid type assertion: ${typeStr(srcType)} is not an interface`,
					expr,
				);
			}
		}

		return targetType;
	},

	_rangeCollTypeTuple(resolved, collType) {
		if (isString(resolved)) return { kind: "tuple", types: [INT, RUNE] };
		if (
			resolved?.kind === "slice" ||
			resolved?.kind === "array" ||
			resolved?.kind === "shared"
		)
			return { kind: "tuple", types: [INT, resolved.elem ?? ANY] };
		if (resolved?.kind === "map")
			return {
				kind: "tuple",
				types: [resolved.key ?? ANY, resolved.value ?? ANY],
			};
		return { kind: "tuple", types: [collType] };
	},

	_checkRangeExpr(expr, scope) {
		const collType = this._derefArrayPtr(
			expr,
			"expr",
			this.checkExpr(expr.expr, scope),
		);
		const resolved =
			collType?.kind === "named" ? collType.underlying : collType;
		return this._rangeCollTypeTuple(resolved, collType);
	},

	_checkInstantiationExpr(expr, scope) {
		const typeRef = this._genericTypeRef(expr, scope);
		if (typeRef) return typeRef;
		// Generic instantiation: Foo[int] or Foo[int, string]
		const baseType = this.checkExpr(expr.expr, scope);
		if (baseType?.kind === "generic") {
			const typeArgs = expr.typeArgs.map((ta) =>
				this.resolveTypeNode(ta, scope),
			);
			if (typeArgs.length > baseType.typeParams.length) {
				return this.err(
					`got ${typeArgs.length} type arguments but ${baseType.name ?? "function"} has ${baseType.typeParams.length} type parameters`,
					expr,
				);
			}
			// Check constraints
			for (
				let i = 0;
				i < baseType.typeParams.length && i < typeArgs.length;
				i++
			) {
				const tp = baseType.typeParams[i];
				const constraint = tp.constraint
					? this.resolveTypeNode(tp.constraint, scope)
					: null;
				if (constraint) this.checkConstraint(typeArgs[i], constraint, expr);
			}
			expr._typeArgs = typeArgs;
			if (expr.expr) expr.expr._typeArgs = typeArgs;
			expr._genericFnType = baseType;
			return this.instantiateGenericFunc(baseType, typeArgs);
		}
		// The parser's type-arg heuristic mistakes `xs[d.Field]` (uppercase field
		// selector as index) for a generic instantiation. When the base is an
		// indexable value and the sole "type arg" is a plain/qualified name,
		// rewrite the node in place into an IndexExpr and check that instead.
		const indexExpr = this._instantiationAsIndex(expr, baseType);
		if (indexExpr) return this._checkIndexExpr(indexExpr, scope);
		if (baseType?.kind === "func" && !this._isPseudoGenericStdFunc(baseType))
			return this.err(
				`cannot instantiate ${this._calleeName(expr.expr)}: not a generic function`,
				expr,
			);
		return baseType;
	},

	// Emitter-backed stdlib helpers (`slices.Sort`, `maps.Keys`) take `any`
	// parameters in place of type parameters and accept (and ignore) explicit
	// type arguments; a stdlib function with concrete parameters does not.
	_isPseudoGenericStdFunc(fnType) {
		return (fnType.params ?? []).some((p) => isAny(p));
	},

	_calleeName(node) {
		if (node?.kind === "Ident") return node.name;
		if (node?.kind === "SelectorExpr")
			return `${this._calleeName(node.expr)}.${node.field}`;
		return "expression";
	},

	_instantiationAsIndex(expr, baseType) {
		if (!baseType || expr.typeArgs.length !== 1) return null;
		const ta = expr.typeArgs[0];
		if (ta.kind !== "TypeName") return null;
		const btu =
			baseType.kind === "named"
				? (this.resolveType(baseType.underlying) ?? baseType.underlying)
				: baseType;
		const indexable =
			btu?.kind === "slice" ||
			btu?.kind === "array" ||
			btu?.kind === "map" ||
			isString(baseType);
		if (!indexable) return null;
		const parts = ta.name.split(".");
		let index = { kind: "Ident", name: parts[0], _line: expr._line };
		for (let i = 1; i < parts.length; i++)
			index = { kind: "SelectorExpr", expr: index, field: parts[i] };
		expr.kind = "IndexExpr";
		expr.index = index;
		delete expr.typeArgs;
		return expr;
	},

	// `int(K)`, `uint8(K)`, `MyInt(K)`: a conversion to an integer type.
	_isIntConversion(expr) {
		if (expr.args?.length !== 1) return false;
		const target = expr._conversionTargetType;
		if (expr._isTypeConversion && target)
			return isInteger(target.kind === "named" ? target.underlying : target);
		return (
			expr.func?.kind === "Ident" && SIZED_INT_NAMES.includes(expr.func.name)
		);
	},

	// Keyed array literal indices (Go spec): each key must be a non-negative
	// integer constant, and no index may appear twice.  The resolved index is
	// stored on the KeyValueExpr as `_index` for compositeLitIndices.
	_checkArrayLitKeys(expr, scope) {
		const seen = new Set();
		let next = 0;
		let unknown = false;
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				this.checkExpr(elem.key, scope);
				const idx = this._constIntValue(elem.key, scope);
				const text = constKeyText(elem.key);
				if (idx === null && this._isConstExpr(elem.key, scope)) {
					// A constant key the folder cannot evaluate (`len(arr)`) keeps
					// the literal/positional index of compositeLitIndices; later
					// indices are not duplicate-checked.
					unknown = true;
					next++;
					continue;
				}
				if (idx === null)
					this.err(`index ${text} must be integer constant`, elem.key);
				else if (idx < 0)
					this.err(
						`index ${text} must be non-negative integer constant`,
						elem.key,
					);
				else next = idx;
				elem._index = next;
			}
			if (!unknown && seen.has(next))
				this.err(`duplicate index ${next} in array or slice literal`, elem);
			seen.add(next);
			next++;
		}
	},

	// Whether `e` is a constant expression (whose value the folder may not
	// know): literals, constants, operators, conversions and builtin calls.
	_isConstExpr(e, scope) {
		switch (e?.kind) {
			case "BasicLit":
				return true;
			case "ParenExpr":
				return this._isConstExpr(e.expr, scope);
			case "UnaryExpr":
				return (
					["-", "+", "^", "!"].includes(e.op) &&
					this._isConstExpr(e.operand, scope)
				);
			case "BinaryExpr":
				return (
					this._isConstExpr(e.left, scope) && this._isConstExpr(e.right, scope)
				);
			case "Ident":
				return !!(scope ?? this.globals)
					.lookupScope(e.name)
					?._consts.has(e.name);
			case "SelectorExpr": {
				// Package members: constant unless the package says otherwise.
				const ns =
					e.expr?.kind === "Ident"
						? (scope ?? this.globals).lookup(e.expr.name)
						: null;
				if (ns?.kind !== "namespace") return false;
				return ns._consts ? ns._consts.has(e.field) : true;
			}
			case "TypeConversion":
				return this._isConstExpr(e.expr, scope);
			case "CallExpr":
				if (e._isTypeConversion || this._isIntConversion(e))
					return this._isConstExpr(e.args?.[0], scope);
				return (
					e.func?.kind === "Ident" &&
					CONST_BUILTINS.has(e.func.name) &&
					(scope ?? this.globals).lookup(e.func.name)?.kind === "builtin"
				);
			default:
				return false;
		}
	},

	_resolveCallArgTypes(expr, scope) {
		if (expr.args.length === 1 && expr.args[0].kind === "CallExpr") {
			const argType = this.checkExpr(expr.args[0], scope);
			if (argType?.kind === "tuple") {
				expr._multiForward = true;
				return argType.types;
			}
			return [argType];
		}
		return expr.args.map((a) => this.checkExpr(a, scope));
	},

	_resolveCallFnType(fnType, argTypes, expr, scope) {
		if (fnType.kind === "named" && fnType.underlying?.kind === "func")
			fnType = fnType.underlying;
		if (fnType.kind === "generic") {
			const resolved = this._resolveGenericFnType(
				fnType,
				argTypes,
				expr,
				scope,
			);
			if (!resolved) return null;
			fnType = resolved;
		}
		return this._completePartialInstantiation(expr, argTypes) ?? fnType;
	},

	// `F[int](x)` with fewer explicit type arguments than type parameters:
	// infer the rest from the call arguments and record the full list.
	_completePartialInstantiation(expr, argTypes) {
		const inst = expr.func;
		const generic = inst?.kind === "InstantiationExpr" && inst._genericFnType;
		if (!generic || inst._typeArgs.length >= generic.typeParams.length)
			return null;
		const typeArgs = this.inferTypeArgs(
			generic,
			this._inferArgTypes(expr, argTypes),
			inst._typeArgs,
		);
		if (!typeArgs) {
			this.err(
				`Cannot infer type arguments for generic function '${generic.name}'`,
				expr,
			);
			return null;
		}
		inst._typeArgs = typeArgs;
		if (inst.expr) inst.expr._typeArgs = typeArgs;
		return this.instantiateGenericFunc(generic, typeArgs);
	},

	// `T(x)` with T a type parameter: only a numeric x converts (the constraint
	// decides the target at instantiation).
	_checkTypeParamConversion(tp, argTypes, expr) {
		expr._isTypeConversion = true;
		expr._conversionTargetType = tp;
		if (expr.args.length !== 1) {
			return this.err(
				`cannot convert ${expr.args.length} arguments to type ${typeStr(tp)}`,
				expr,
			);
		}
		if (isNumeric(argTypes[0]) && !this._constraintHasTypeSet(tp.constraint))
			return this.err(
				`cannot convert ${typeStr(argTypes[0])} to type ${typeStr(tp)}: ${typeStr(tp)} is not constrained to a set of convertible types`,
				expr,
			);
		if (
			!isNumeric(argTypes[0]) &&
			!isAny(argTypes[0]) &&
			argTypes[0]?.kind !== "typeParam"
		)
			this.err(
				`cannot convert ${typeStr(argTypes[0])} to ${typeStr(tp)}`,
				expr,
			);
		return tp;
	},

	// A conversion to a type parameter needs a constraint that lists types
	// (`~int | ~float64`, or an interface embedding such a union); `any`,
	// `comparable` and method-only constraints allow every type argument.
	_constraintHasTypeSet(constraint) {
		if (!constraint) return true;
		if (constraint.kind === "UnionConstraint") return true;
		const c = this.resolveType(constraint);
		const base = c?.kind === "named" ? this.resolveType(c.underlying) : c;
		if (base?.kind !== "interface") return false;
		if (base.unionConstraint) return true;
		return (base._typeSetEmbeds ?? []).some((e) =>
			this._constraintHasTypeSet(e),
		);
	},

	checkCall(expr, scope) {
		expr.func._typeRefOk = true;
		let fnType = this.checkExpr(expr.func, scope);
		// `slices.Sort[[]int](xs)` on an emitter-backed (non-generic) stdlib
		// function: the type arguments are inferred, so call it as `slices.Sort(xs)`.
		if (
			expr.func.kind === "InstantiationExpr" &&
			!expr.func._genericFnType &&
			expr.func.expr?.kind === "SelectorExpr" &&
			fnType?.kind === "func"
		)
			expr.func = expr.func.expr;
		this._checkSharedAllocSite(expr, scope);
		this._checkBoundaryCallInLoop(expr, scope);
		if (fnType.kind === "builtin") {
			const argTypes = expr.args.map((a, i) => {
				// new(T) — first arg is a type name, not a value expression
				if (fnType.name === "new" && i === 0) return ANY;
				return this.checkExpr(a, scope);
			});
			return this.checkBuiltin(fnType.name, expr, argTypes, scope);
		}

		const argTypes = this._resolveCallArgTypes(expr, scope);

		if (fnType?._tainted) return TAINTED_ANY;
		if (isAny(fnType)) return ANY;

		// Named type used as a constructor/conversion: Greeter(fn), NodeFunc(fn)
		// The callee is a type name, not a callable variable.
		if (fnType.kind === "named" && expr.func._isTypeRef) {
			expr._isTypeConversion = true;
			expr._conversionTargetType = fnType;
			if (expr.args.length !== 1) {
				return this.err(
					`cannot convert ${expr.args.length} arguments to type ${typeStr(fnType)}`,
					expr,
				);
			}
			const argType = argTypes[0];
			this._checkConversionValidity(argType, fnType, expr);
			return fnType;
		}

		if (fnType.kind === "typeParam" && expr.func._isTypeRef) {
			return this._checkTypeParamConversion(fnType, argTypes, expr);
		}

		fnType = this._resolveCallFnType(fnType, argTypes, expr, scope);
		if (!fnType) return ANY;
		if (fnType.kind !== "func") {
			return this.err(`Cannot call non-function type ${typeStr(fnType)}`, expr);
		}

		this._checkCallArgs(fnType, argTypes, expr, scope);

		// Pseudo-generic stdlib helpers (maps.Keys, slices.Clone, ...) declare
		// how their result derives from the first argument.
		if (fnType._derivedReturn) {
			const derived = this._derivedReturnType(fnType._derivedReturn, argTypes);
			if (derived) return derived;
		}

		const ret = fnType.returns;
		if (!ret || ret.length === 0) return VOID;
		if (ret.length === 1) return ret[0];
		return { kind: "tuple", types: ret };
	},

	// `shared.NewXxx(n)` allocates from a linear memory that is sized once at
	// startup (no memory.grow → no detached TypedArray views on the JS side).
	// Allocation is therefore only legal in package-level var initializers and
	// init(), which both run inside the module start function.
	// JS→WASM calls copy non-shared arguments across the boundary on every
	// call. Inside a loop that dominates the per-iteration cost, so hint that
	// the loop belongs on the WASM side (or the data in gofront/shared).
	_checkBoundaryCallInLoop(expr, scope) {
		if (this._loopDepth === 0 || this.target !== "js") return;
		const fn = expr.func;
		if (fn.kind !== "SelectorExpr" || fn.expr.kind !== "Ident") return;
		const ns = scope.lookup(fn.expr.name);
		if (ns?.kind !== "namespace" || ns._target !== "wasm") return;
		const member = ns.members[fn.field];
		if (member?.kind !== "func") return;
		this.warn(
			`'${fn.expr.name}.${fn.field}' crosses the JS→WASM boundary inside a loop`,
			fn.expr, // CallExpr nodes carry no position; the callee Ident does
			"hint: each call copies its arguments; move the loop into the wasm package or pass gofront/shared buffers",
		);
	},

	_checkSharedAllocSite(expr, scope) {
		const f = expr.func;
		if (
			f.kind !== "SelectorExpr" ||
			f.expr.kind !== "Ident" ||
			f.expr.name !== "shared" ||
			!f.field.startsWith("New") ||
			scope.lookup("shared") !== this.globals.lookup("shared")
		)
			return;
		if (this._sharedAllocOk) return;
		const why =
			this.target === "wasm"
				? "shared buffers are allocated once at startup"
				: "shared buffers are allocated once at startup so the code stays portable to wasm packages";
		this.err(
			`shared.${f.field} must be called from a package-level var initializer or init(); ${why}`,
			expr,
		);
	},

	_derivedReturnType(mode, argTypes) {
		const arg = argTypes[0];
		const under = arg?.kind === "named" ? arg.underlying : arg;
		switch (mode) {
			case "arg0":
				return under ? arg : null;
			case "elemOfArg0":
				return under?.elem ?? null;
			default:
				return null;
		}
	},

	// Argument types for inference: a spread argument `xs...` stands for its
	// elements, which is what the variadic parameter type describes.
	_inferArgTypes(expr, argTypes) {
		return argTypes.map((t, i) => {
			if (!expr.args?.[i]?._spread) return t;
			const u = this.resolveType(t?.kind === "named" ? t.underlying : t);
			return u?.kind === "slice" ? u.elem : t;
		});
	},

	_resolveGenericFnType(fnType, argTypes, expr, scope) {
		const typeArgs = this.inferTypeArgs(
			fnType,
			this._inferArgTypes(expr, argTypes),
		);
		if (!typeArgs) {
			this.err(
				`Cannot infer type arguments for generic function '${fnType.name}'`,
				expr,
			);
			return null;
		}
		// Check constraints
		for (let i = 0; i < fnType.typeParams.length && i < typeArgs.length; i++) {
			const tp = fnType.typeParams[i];
			const constraint = tp.constraint
				? this.resolveTypeNode(tp.constraint, scope)
				: null;
			if (constraint) this.checkConstraint(typeArgs[i], constraint, expr);
		}
		expr._typeArgs = typeArgs;
		if (expr.func) expr.func._typeArgs = typeArgs;
		expr._genericFnType = fnType;
		if (expr.func) expr.func._genericFnType = fnType;
		return this.instantiateGenericFunc(fnType, typeArgs);
	},

	_checkArgCount(fnType, argTypes, expr) {
		const minArgs = fnType.params.filter(
			(_, i) => !fnType.variadic || i < fnType.params.length - 1,
		).length;
		if (argTypes.length < minArgs)
			this.err(
				`Too few arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
		if (!fnType.variadic && argTypes.length > fnType.params.length)
			this.err(
				`Too many arguments: expected ${fnType.params.length}, got ${argTypes.length}`,
				expr,
			);
	},

	// WASM packs a variadic call's trailing arguments into a slice, which it
	// cannot do for `f(g())` yet.  Emitter-backed stdlib calls (`fmt.X`) are
	// not packed; GoFront and Go-source package functions are.
	_checkMultiForwardVariadic(fnType, expr) {
		if (!expr._multiForward || !fnType.variadic) return;
		if (this.target !== "wasm" && this.target !== "both") return;
		const ns =
			expr.func?.kind === "SelectorExpr" ? expr.func.expr?._type : null;
		const emitterBacked =
			ns?.kind === "namespace" &&
			!ns._gofront &&
			!ns._mangle?.has(expr.func.field);
		if (emitterBacked) return;
		this.err(
			"passing multiple return values to a variadic function is not supported in wasm packages; assign them to variables first",
			expr,
		);
	},

	_checkCallArgs(fnType, argTypes, expr, scope = null) {
		this._checkArgCount(fnType, argTypes, expr);
		this._checkMultiForwardVariadic(fnType, expr);
		const maxLen = fnType.variadic
			? argTypes.length
			: Math.min(fnType.params.length, argTypes.length);
		for (let i = 0; i < maxLen; i++) {
			const paramIdx =
				fnType.variadic && i >= fnType.params.length - 1
					? fnType.params.length - 1
					: i;
			if (expr.args[i]?._spread) {
				this._rejectSeqAsSlice(argTypes[i], expr.args[i], "a spread argument");
				continue;
			}
			const targetParam = fnType.params[paramIdx];
			const node = expr._multiForward ? null : expr.args[i];
			this.assertAssignable(targetParam, argTypes[i], node, "argument");
		}

		this._checkSimdLaneArgs(expr, scope);
	},

	// Lane, WithLane, Swizzle and Shuffle take constant lane indices.
	_checkSimdLaneArgs(expr, scope) {
		if (expr.func?.kind !== "SelectorExpr") return;
		const recv = expr.func.expr?._type;
		const field = expr.func.field;
		let first = 0;
		let count = 0;
		let max = 3;
		if (recv?.kind === "namespace" && recv.members?.Mask32x4) {
			if (field !== "Shuffle") return;
			first = 2;
			count = 4;
			max = 7;
		} else if (this._isSimdType(recv)) {
			if (field === "Lane" || field === "WithLane") count = 1;
			else if (field === "Swizzle") count = 4;
			else return;
		} else {
			return;
		}
		for (let i = first; i < first + count; i++) {
			const arg = expr.args[i];
			if (!arg) continue;
			const idx = this._constIntValue(arg, scope);
			if (idx !== null) arg._constInt = idx;
			if (idx === null || idx < 0 || idx > max) {
				this.err(
					`lane index must be a constant integer in range [0, ${max}]`,
					arg,
				);
			}
		}
	},

	_isSimdType(t) {
		return (
			t?.name === "simd.F32x4" ||
			t?.name === "F32x4" ||
			t?.name === "simd.Mask32x4" ||
			t?.name === "Mask32x4" ||
			t?.underlying?.kind === "simd" ||
			t?.kind === "simd"
		);
	},

	checkBuiltin(name, expr, argTypes, scope) {
		const gen = BUILTIN_CHECK[name];
		return gen ? gen(this, name, expr, argTypes, scope) : ANY;
	},

	_constLenFromType(arg0) {
		if (arg0?.kind === "array" && arg0.size != null) return arg0.size;
		if (
			arg0?.kind === "named" &&
			arg0.underlying?.kind === "array" &&
			arg0.underlying.size != null
		)
			return arg0.underlying.size;
		return null;
	},

	_checkBuiltinLen(name, expr, argTypes) {
		this._rejectSeqAsSlice(argTypes[0], expr.args?.[0], `${name}()`);
		if (expr.args?.length === 1)
			argTypes[0] = this._derefArrayPtr(expr.args, 0, argTypes[0]);
		if (name === "len") {
			const size = this._constLenFromType(argTypes[0]);
			if (size != null) expr._constLen = size;
		} else if (sharedInfo(argTypes[0])) {
			this.err(
				`cannot use cap() on ${typeStr(argTypes[0])}: shared buffers have a fixed size; use len()`,
				expr,
			);
		}
		return INT;
	},

	_checkBuiltinComplex(expr, argTypes) {
		if (expr.args.length !== 2) {
			this.err("complex() requires exactly 2 arguments", expr);
			return ANY;
		}
		const crt = argTypes[0];
		const cit = argTypes[1];
		if (!isNumeric(crt)) {
			this.err(`cannot use ${typeStr(crt)} as float in complex()`, expr);
			return ANY;
		}
		if (!isNumeric(cit)) {
			this.err(`cannot use ${typeStr(cit)} as float in complex()`, expr);
			return ANY;
		}
		if (crt.kind === "untyped" && cit.kind === "untyped")
			return UNTYPED_COMPLEX;
		if (crt.name === "float32" && cit.name === "float32") return COMPLEX64;
		if (crt.name === "float64" && cit.name === "float64") return COMPLEX128;
		if (crt.name === "float32" || cit.name === "float32") {
			if (crt.name === "float64" || cit.name === "float64") {
				this.err(
					`invalid complex call: mismatched float types (${typeStr(crt)} and ${typeStr(cit)})`,
					expr,
				);
			}
			return COMPLEX64;
		}
		return COMPLEX128;
	},

	_checkBuiltinRealImag(name, expr, argTypes) {
		if (expr.args.length !== 1) {
			this.err(`${name}() requires exactly 1 argument`, expr);
			return ANY;
		}
		const zt = argTypes[0];
		if (!isComplex(zt)) {
			this.err(`cannot use ${typeStr(zt)} as complex in ${name}()`, expr);
			return ANY;
		}
		if (zt.kind === "untyped") return UNTYPED_FLOAT;
		if (isComplex64(zt)) return FLOAT32;
		return FLOAT64;
	},

	_inferArraySize(expr, typeNode, base) {
		if (
			typeNode?.kind === "ArrayType" &&
			typeNode.inferLen &&
			base?.kind === "array"
		)
			base.size = computeMaxIndex(expr.elems) + 1;
	},

	_isSliceOrArray(base) {
		return base?.kind === "slice" || base?.kind === "array";
	},

	_checkUnknownCompositeLit(expr, scope, t) {
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") this.checkExpr(elem.value, scope);
			else this.checkExpr(elem, scope);
		}
		return t ?? ANY;
	},

	checkCompositeLit(expr, scope, hintType = null) {
		const t =
			expr.typeExpr === null
				? (hintType ?? ANY)
				: this.resolveTypeNode(expr.typeExpr, scope);
		const base = t.kind === "named" ? t.underlying : t;
		const typeNode = expr.typeExpr;
		if (expr.typeExpr === null && hintType && base?.kind === "basic") {
			this.err(`invalid composite literal type ${typeStr(t)}`, expr);
			return t;
		}
		if (this._isSliceOrArray(base)) this._checkArrayLitKeys(expr, scope);
		this._inferArraySize(expr, typeNode, base);
		if (base?.kind === "struct")
			return this._checkStructCompositeLit(expr, scope, t, base);
		if (base?.kind === "simd")
			return this._checkSimdCompositeLit(expr, scope, t, base);
		if (this._isSliceOrArray(base))
			return this._checkSliceArrayCompositeLit(expr, scope, t, base, typeNode);
		if (base?.kind === "map")
			return this._checkMapCompositeLit(expr, scope, t, base);
		return this._checkUnknownCompositeLit(expr, scope, t);
	},

	_checkSimdCompositeLit(expr, scope, t, base) {
		if (base.simd === "Mask32x4") {
			if (expr.elems.length > 0)
				this.err("simd.Mask32x4 literal cannot have values", expr);
			return t;
		}
		if (expr.elems.length > 4) {
			this.err("too many values in simd.F32x4 literal", expr);
		}
		for (const elem of expr.elems) {
			const vt = this.checkExpr(elem, scope);
			this.assertAssignable(base.elem ?? FLOAT32, vt, elem);
		}
		return t;
	},

	_checkStructPositionalElems(expr, scope, t, base) {
		const fieldNames = base._structFields
			? base._structFields.flatMap((f) =>
					f.embedded
						? [
								(
									(f.type?.kind === "pointer"
										? f.type.base?.name
										: f.type?.name) ?? ""
								)
									.split(".")
									.pop(),
							]
						: f.names,
				)
			: [...(base.fields?.keys() ?? [])];
		for (let i = 0; i < expr.elems.length; i++) {
			const elem = expr.elems[i];
			const fieldName = fieldNames[i];
			if (!fieldName) {
				this.err("too many values in struct literal", elem);
				continue;
			}
			const fieldType = base.fields.get(fieldName);
			const vt = this.checkExpr(elem, scope);
			if (fieldType) this.assertAssignable(fieldType, vt, elem);
			elem._positionalField = fieldName;
		}
		return t;
	},

	_checkStructKeyedElems(expr, scope, t, base) {
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				const keyName = elem.key.name;
				const embed = base._embeds?.find((e) => {
					const inner = e.kind === "pointer" ? e.base : e;
					const name =
						inner.kind === "named" ? inner.name.split(".").pop() : null;
					return name === keyName;
				});
				if (embed) elem._isEmbedInit = true;
				const fieldType = base.fields?.get(keyName) ?? embed;
				if (fieldType) {
					const vt = this.checkExpr(elem.value, scope);
					this.assertAssignable(fieldType, vt, elem.value);
				} else {
					this.err(`Unknown field '${keyName}'`, elem.key);
				}
			} else {
				this.checkExpr(elem, scope);
			}
		}
		return t;
	},

	_checkStructCompositeLit(expr, scope, t, base) {
		const hasPositional = expr.elems.some((e) => e.kind !== "KeyValueExpr");
		const hasKeyed = expr.elems.some((e) => e.kind === "KeyValueExpr");
		if (hasPositional && hasKeyed)
			this.err("mixture of field:value and value initializers", expr);
		if (hasPositional)
			return this._checkStructPositionalElems(expr, scope, t, base);
		return this._checkStructKeyedElems(expr, scope, t, base);
	},

	_checkSliceArrayCompositeLit(expr, scope, t, base, typeNode) {
		for (const elem of expr.elems) {
			if (elem.kind === "CompositeLit" && elem.typeExpr === null) {
				const et = this.checkCompositeLit(elem, scope, base.elem);
				elem._type = et;
			} else if (elem.kind === "KeyValueExpr") {
				if (
					elem.value.kind === "CompositeLit" &&
					elem.value.typeExpr === null
				) {
					elem.value._type = this.checkCompositeLit(
						elem.value,
						scope,
						base.elem,
					);
				} else {
					const vt = this.checkExpr(elem.value, scope);
					this.assertAssignable(base.elem, vt, elem.value);
				}
			} else {
				const et = this.checkExpr(elem, scope);
				this.assertAssignable(base.elem, et, elem);
			}
		}

		// Composite literal element count validation for explicit-size arrays
		if (base.kind === "array" && base.size != null && !typeNode?.inferLen) {
			const maxIndex = computeMaxIndex(expr.elems);
			if (maxIndex >= base.size) {
				this.err(
					`array index ${maxIndex} out of bounds [0:${base.size}]`,
					expr,
				);
			}
		}

		return t;
	},

	_checkMapCompositeLit(expr, scope, t, base) {
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				let kt;
				if (elem.key.kind === "CompositeLit" && elem.key.typeExpr === null) {
					kt = this.checkCompositeLit(elem.key, scope, base.key);
					elem.key._type = kt;
				} else {
					kt = this.checkExpr(elem.key, scope);
				}
				// value may be an implicit composite lit
				let vt;
				if (
					elem.value.kind === "CompositeLit" &&
					elem.value.typeExpr === null
				) {
					vt = this.checkCompositeLit(elem.value, scope, base.value);
					elem.value._type = vt;
				} else {
					vt = this.checkExpr(elem.value, scope);
				}
				this.assertAssignable(base.key, kt, elem.key);
				this.assertAssignable(base.value, vt, elem.value);
			}
		}
		return t;
	},
};

// Builtins whose calls may be constant expressions (`len("abc")`).
const CONST_BUILTINS = new Set([
	"len",
	"cap",
	"real",
	"imag",
	"complex",
	"min",
	"max",
]);

// Source-like text of a literal key for diagnostics (`k`, `-1`, `K + 1`).
function constKeyText(e) {
	switch (e?.kind) {
		case "Ident":
			return e.name;
		case "BasicLit":
			return String(e.value);
		case "UnaryExpr":
			return `${e.op}${constKeyText(e.operand)}`;
		case "BinaryExpr":
			return `${constKeyText(e.left)} ${e.op} ${constKeyText(e.right)}`;
		case "ParenExpr":
			return `(${constKeyText(e.expr)})`;
		case "SelectorExpr":
			return `${constKeyText(e.expr)}.${e.field}`;
		default:
			return "expression";
	}
}

function computeMaxIndex(elems) {
	return compositeLitMaxIndex(elems);
}
