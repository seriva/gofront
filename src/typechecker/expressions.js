// TypeChecker expression-checking methods — installed as a mixin on TypeChecker.prototype.

import { constIntValue, realOfConst } from "./const-fold.js";
import { constValueText, exprText, operandKind } from "./operand-text.js";
import { newLabelScope } from "./statements.js";
import {
	EXCLUDED_STDLIB_MEMBERS,
	EXCLUDED_STDLIB_PACKAGES,
} from "./stdlib/excluded.js";
import { sharedInfo } from "./stdlib/shared.js";
import {
	ANY,
	anyKind,
	BASIC_TYPES,
	BOOL,
	BROWSER_GLOBALS,
	COMPLEX64,
	COMPLEX128,
	compositeLitMaxIndex,
	copyType,
	DECLARED_ANY,
	defaultType,
	displayTypeName,
	ERROR,
	embeddedFieldName,
	FLOAT32,
	FLOAT64,
	FMT_PRINT_FUNCS,
	INT,
	identical,
	is64BitInt,
	isAny,
	isArray,
	isBool,
	isComplex,
	isComplex64,
	isComplexOrNumeric,
	isInteger,
	isNil,
	isNumeric,
	isString,
	NIL,
	RUNE,
	Scope,
	SIZED_INT_NAMES,
	STRING,
	shadowsJsGlobal,
	TAINTED_ANY,
	typeStr,
	UINT8,
	UNTYPED_BOOL,
	UNTYPED_COMPLEX,
	UNTYPED_FLOAT,
	UNTYPED_INT,
	UNTYPED_RUNE,
	UNTYPED_STRING,
	VOID,
} from "./types.js";

// Operand kinds a `range` rejects outright (see `_notRangeable`).
const NOT_RANGEABLE_KINDS = new Set([
	"struct",
	"interface",
	"pointer",
	"namespace",
]);

// Scope binding kinds that name a value, not a type.
const VALUE_KINDS = new Set(["var", "const", "func"]);

const NILABLE_KINDS = new Set([
	"slice",
	"map",
	"pointer",
	"func",
	"interface",
	"chan",
]);

/** @typedef {import('./index.js').TypeChecker} TypeChecker */

// min/max: the type of the first typed operand; with only untyped constants,
// an untyped float if any operand is one (Go's "largest kind" rule).
function minMaxType(at) {
	const typed = at.find((t) => t && t.kind !== "untyped");
	if (typed) return typed;
	return (
		at.find((t) => t?.base === "float64") ??
		at.find((t) => t?.rune) ??
		at[0] ??
		ANY
	);
}

// The kind rank of an untyped constant: int < rune < float64.
function untypedRank(t) {
	return t?.base === "float64" ? 2 : t?.rune ? 1 : 0;
}

// Argument counts per builtin: [min, max] (max Infinity when variadic).
const BUILTIN_ARITY = {
	len: [1, 1],
	cap: [1, 1],
	append: [1, Infinity],
	copy: [2, 2],
	delete: [2, 2],
	make: [1, Infinity],
	new: [1, 1],
	panic: [1, 1],
	recover: [0, 0],
	min: [1, Infinity],
	max: [1, Infinity],
	clear: [1, 1],
	complex: [2, 2],
	real: [1, 1],
	imag: [1, 1],
};

// Dispatch table for builtin function type checking.
// Each value is (self, name, expr, argTypes, scope) => returnType.
const BUILTIN_CHECK = {
	len: (s, n, e, at) => s._checkBuiltinLen(n, e, at),
	cap: (s, n, e, at) => s._checkBuiltinLen(n, e, at),
	append: (s, _n, e, at, sc) => {
		const st = at[0] ?? ANY;
		if (s._rejectSpreadCount(2, e, "append")) return st;
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
		if (!s._appendOperandOk(st)) {
			s.err(
				`invalid append: argument must be a slice; have ${exprText(e.args[0])} (${s._capOperandKind(e.args[0], st)})`,
				e,
			);
			return st;
		}
		if (s._reportSliceElemMismatch("append", e.args[0], st, e)) return st;
		const sb = s._builtinSliceType(st, sc);
		if (sb?.kind === "slice") s._checkAppendArgs(sb, e, at);
		return st;
	},
	copy: (s, _n, e, at, sc) => s._checkBuiltinCopy(e, at, sc),
	delete: (s, _n, e, at, sc) => {
		const mt = s._checkDeleteOperand(e, at[0], sc);
		if (mt?.kind === "map" && e.args[1]) {
			s.assertAssignable(mt.key, at[1], e.args[1], "argument to delete");
			s._tagFloat32Const(s.resolveType(mt.key), at[1], e.args[1]);
			s._markIfaceKey(mt, e.args[1], at[1]);
		}
		return VOID;
	},
	make: (s, _n, e, _at, sc) => {
		if (e.args.length < 1) return ANY;
		const ta = e.args[0];
		const tn = ta.kind === "TypeExpr" ? ta.type : ta;
		const made = s.resolveTypeNode(tn, sc) ?? ANY;
		// `make(S, n)` with S a type parameter makes its core type.
		const core = made.kind === "typeParam" ? s._coreType(made, sc) : null;
		if (core) ta._coreType = core;
		s._checkMakeArity(e, core ?? made);
		for (const size of e.args.slice(1, 3))
			s._checkIntegerConstOperand(size, "size", sc);
		return made;
	},
	new: (s, _n, e, _at, sc) => {
		if (e.args.length < 1) return ANY;
		const ta = e.args[0];
		const inner = s.resolveTypeNode(ta.kind === "TypeExpr" ? ta.type : ta, sc);
		return { kind: "pointer", base: inner };
	},
	print: (s, n, e, at) => s._checkPrintArgs(n, e, at),
	println: (s, n, e, at) => s._checkPrintArgs(n, e, at),
	panic: (s, _n, e, at) => {
		// The operand converts to `any`, so a defined type keeps its identity.
		if (e.args[0] && at?.[0]) s._markIfaceBox(ANY, at[0], e.args[0]);
		return VOID;
	},
	recover: () => DECLARED_ANY,
	error: () => ERROR,
	min: (s, _n, e, at) => s._checkMinMax(e, at),
	max: (s, _n, e, at) => s._checkMinMax(e, at),
	clear: (s, _n, e, at) => {
		s._checkClearOperand(e, at[0]);
		return VOID;
	},
	complex: (s, _n, e, at) => s._checkBuiltinComplex(e, at),
	real: (s, n, e, at) => s._checkBuiltinRealImag(n, e, at),
	imag: (s, n, e, at) => s._checkBuiltinRealImag(n, e, at),
};

// Type kinds that are never valid as an index, slice bound or `make` size.
const NON_INTEGER_KINDS = new Set([
	"struct",
	"pointer",
	"slice",
	"map",
	"func",
	"array",
	"interface",
	"simd",
]);

// Basic types that are never valid as an index, slice bound or `make` size.
const NON_INTEGER_BASICS = new Set([
	"float32",
	"float64",
	"complex64",
	"complex128",
	"bool",
	"string",
]);

// JS-dynamic `any` indexes anything; a Go `any` needs a type assertion.
function nonIntegerBasic(u) {
	return isAny(u) ? anyKind(u) === "go" : NON_INTEGER_BASICS.has(u.name);
}

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

// Whether `t` is, or is built from, a type parameter.
function mentionsTypeParam(t, seen = new Set()) {
	if (!t || typeof t !== "object" || seen.has(t)) return false;
	if (t.kind === "typeParam") return true;
	seen.add(t);
	const any = (list) =>
		[...(list ?? [])].some((x) => mentionsTypeParam(x, seen));
	switch (t.kind) {
		case "pointer":
			return mentionsTypeParam(t.base, seen);
		case "slice":
		case "array":
			return mentionsTypeParam(t.elem, seen);
		case "map":
			return mentionsTypeParam(t.key, seen) || mentionsTypeParam(t.value, seen);
		case "named":
			return any(t.typeArgs);
		case "struct":
			return any(t.typeArgs) || any(t.fields?.values());
		case "func":
			return any(t.params) || any(t.returns);
		case "interface":
			return any(t.methods?.values());
		default:
			return false;
	}
}

/** @type {ThisType<TypeChecker>} */
export const expressionCheckMethods = {
	checkExpr(expr, scope) {
		let t = this._checkExpr(expr, scope);
		if (t?.kind === "generic" && !expr._genericOk)
			t = this._genericValueError(expr);
		expr._type = t;
		this._noteConst(expr, scope);
		return t;
	},

	// A generic function is a value only once instantiated: its callee (type
	// arguments inferred from the arguments) and `F[T]` are the two places it
	// may stand uninstantiated, and they mark their operand `_genericOk`.
	_genericValueError(expr) {
		return this.err(
			`cannot use generic function ${exprText(expr)} without instantiation`,
			expr,
		);
	},

	_checkExpr(expr, scope) {
		switch (expr.kind) {
			case "BasicLit": {
				switch (expr.litKind) {
					case "INT":
						return expr.rune ? UNTYPED_RUNE : UNTYPED_INT;
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
				// A declaration package named like a browser global
				// (`import "gofront/fetch"`) is a qualifier, never the global:
				// where no member is selected (`fetch(url)`) the name is the
				// global again, so the import can supply types while the call
				// keeps working. That name is not a use of the package, so the
				// global is read without marking the file scope's name used.
				const globalObj =
					!expr._universe &&
					!expr._selectorBase &&
					BROWSER_GLOBALS.has(expr.name) &&
					scope.lookupObject(expr.name)?.type?._dtsPackage
						? this.universe.object(expr.name)
						: null;
				let t;
				if (globalObj) {
					scope = this.universe;
					t = globalObj.type;
				} else {
					t = expr._universe
						? this.universe.lookup(expr.name)
						: scope.lookup(expr.name);
				}
				// Generated and stdlib Go resolves every property of the name
				// from the universe, never from the user's scope.
				if (expr._universe) scope = this.universe;
				// `true`, `false` and `nil` are universe constants: with no
				// declaration in scope the identifier is the literal.
				if (!t && Object.hasOwn(UNIVERSE_LITERALS, expr.name)) {
					const { litKind, value } = UNIVERSE_LITERALS[expr.name];
					delete expr.name;
					Object.assign(expr, { kind: "BasicLit", litKind, value });
					return this._checkExpr(expr, scope);
				}
				// `(*int)(nil)`: a predeclared type named where a type may stand.
				if (!t && Object.hasOwn(BASIC_TYPES, expr.name)) {
					return this._basicTypeName(expr);
				}
				if (!t) {
					// The import of an excluded package already reported; its
					// uses are not a second root cause.
					const imported = this._fileImports
						?.get(this._currentFile)
						?.get(expr.name);
					if (imported && EXCLUDED_STDLIB_PACKAGES.has(imported))
						return TAINTED_ANY;
					if (this._unavailableImports?.has(expr.name)) return TAINTED_ANY;
					// `gom` needs no import in a js package; wasm packages get
					// the same answer as an `import "gom"`.
					if (
						expr.name === "gom" &&
						(this.target === "wasm" || this.target === "both")
					) {
						this.recordBlocker("gom usage", "gom");
						return this.err(
							"package 'gom' is not available in wasm packages",
							expr,
						);
					}
					return this.err(`Undefined: '${expr.name}'`, expr);
				}
				// A value whose type is a type parameter is not the type parameter.
				if (
					this._namesType(expr.name, t, scope) ||
					(t.kind === "typeParam" && scope.bindsType(expr.name))
				)
					expr._isTypeRef = true;
				const notValue = this._notAValue(expr, scope);
				if (notValue) return this.err(notValue, expr);
				// JS output keeps the Go name of what names a type: a type is a
				// class under that name, and a type parameter is looked up by it.
				// Decided from the binding the name resolves to, so a variable,
				// function or parameter is never one, whatever its type is.
				if (t.kind === "typeParam") expr._namesTypeParam = true;
				else if (scope.bindsType(expr.name)) expr._namesDeclType = true;
				// A Go declaration that shadows a browser global: JS output renames
				// it so generated code keeps reaching the real global.  Package
				// namespaces (`import console "./util"`) are never renamed: JS
				// selects their members directly (bundledPackages).
				if (
					shadowsJsGlobal(expr.name) &&
					(t.kind !== "namespace" || t._dtsType)
				) {
					const owner = scope.lookupScope(expr.name);
					if (
						owner !== this.universe &&
						!(this._isImportScope(owner) && this._externalNames.has(expr.name))
					)
						expr._shadowsGlobal = true;
				}
				// Go-source stdlib loading: record package-scope references so the
				// loader can mangle them (see compiler.js loadStdlibPackage).
				if (this._pkgRefs && scope.lookupScope(expr.name) === this.globals)
					this._pkgRefs.add(`${this._currentFile}:${expr._line}:${expr._col}`);
				if (
					(this.target === "wasm" || this.target === "both") &&
					this._untypedImports.has(expr.name) &&
					this._isImportScope(scope.lookupScope(expr.name))
				)
					return this._errJsOnly(expr.name, expr);
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
				return this._resolveDtsAlias(t);
			}
			case "BinaryExpr": {
				const lt = this.checkExpr(expr.left, scope);
				const rt = this.checkExpr(expr.right, scope);
				return this._typeBinaryOperands(expr, lt, rt, scope);
			}
			case "AwaitExpr": {
				if (this.target === "wasm" || this.target === "both") {
					this.recordBlocker("async function");
					this.err(
						"async functions are not supported in wasm packages; keep async code in a js package",
						expr,
					);
				}
				return this._awaitedType(this.checkExpr(expr.expr, scope));
			}
			case "InstantiationExpr":
				return this._checkInstantiationExpr(expr, scope);
			case "TypeName":
				// A type in expression position: monomorphisation rewrites
				// `Box[int]` in `(*Box[int]).Set` to the TypeName `Box$int`.
				expr._isTypeRef = true;
				return this._typeRefOperand(expr, this.resolveTypeNode(expr, scope));
			case "TypeExpr":
				expr._isTypeRef = true;
				return this._typeRefOperand(
					expr,
					this.resolveTypeNode(expr.type, scope),
				);
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

	_checkDeref(ot, expr, scope) {
		// JS-dynamic values dereference freely; an error-recovery type has
		// already been reported.
		if (anyKind(ot) === "dynamic") return ANY;
		if (anyKind(ot) === "tainted") return TAINTED_ANY;
		if (ot.kind === "pointer") return ot.base;
		if (ot.kind === "typeParam") {
			const core = this._coreType(ot, scope);
			if (core?.kind === "pointer") return core.base;
		}
		const ou = this._deepUnderlying(ot);
		if (ou?.kind === "pointer") return ou.base;
		this.err(`cannot dereference non-pointer type ${typeStr(ot)}`, expr);
		return ANY;
	},

	// A unary operator needs an operand its operand-kind table entry accepts
	// (`!` booleans, `+`/`-` numbers, `^` integers). A type parameter needs
	// every type in its type set to accept it. Returns whether it is defined,
	// after reporting when it is not.
	_checkUnaryDefined(ot, expr) {
		if (this._operatorDefined(expr.op, ot, true)) return true;
		this._reportOperatorUndefined(expr.op, ot, expr.operand);
		return false;
	},

	// `!` keeps the operand's untyped or defined bool type.
	_checkBoolUnaryOp(ot, expr) {
		if (!this._checkUnaryDefined(ot, expr)) return TAINTED_ANY;
		return ot?.kind === "typeParam" || isBool(ot) ? ot : BOOL;
	},

	_checkNumericUnaryOp(ot, expr) {
		return this._checkUnaryDefined(ot, expr) ? ot : TAINTED_ANY;
	},

	_checkComplementUnaryOp(ot, expr) {
		return this._checkUnaryDefined(ot, expr) ? ot : TAINTED_ANY;
	},

	// Whether every type in the type set of type parameter `tp`'s constraint
	// satisfies `pred`.  A constraint without a type set (any, comparable,
	// method-only interfaces) allows nothing.
	_typeParamAllows(tp, pred) {
		const terms = this._constraintTerms(tp.constraint, new Set());
		return terms !== null && terms.length > 0 && terms.every(pred);
	},

	// Whether `pred` holds for `t`, or for every type in its type set when `t`
	// is a type parameter (the builtins' operand rule).
	_typeSetOk(t, pred) {
		return t?.kind === "typeParam" ? this._typeParamAllows(t, pred) : pred(t);
	},

	// `scope` resolves the type parameters a term mentions (`~[]E`); it
	// defaults to the package scope.
	_constraintTerms(c, seen, scope = this.globals) {
		if (!c || seen.has(c)) return null;
		seen.add(c);
		// Receiver type parameters keep their constraint as an AST node.
		if (
			c.kind === "TypeName" ||
			c.kind === "InterfaceType" ||
			c.kind === "GenericTypeName" ||
			c.kind === "InstantiationExpr" ||
			c.kind === "IndexExpr"
		)
			return this._constraintTerms(this.resolveTypeNode(c, scope), seen, scope);
		if (c.kind === "named")
			return this._constraintTerms(c.underlying, seen, scope);
		if (c.kind === "interface") return this._interfaceTerms(c, seen, scope);
		if (c.kind === "typeParam")
			return this._constraintTerms(c.constraint, seen, scope);
		if (c.kind !== "UnionConstraint") return isAny(c) ? null : [c];
		scope = c._scope ?? scope;
		const out = [];
		for (const term of c.terms) {
			const t = term.resolved ?? this.resolveTypeNode(term.type, scope);
			const inner =
				this._deepUnderlying(t)?.kind === "interface"
					? this._constraintTerms(t, seen, scope)
					: [t];
			if (inner === null) return null;
			out.push(...inner);
		}
		return out;
	},

	// An interface's type set is the intersection of its own union and the
	// type sets of the interfaces it embeds; null when it has none.
	_interfaceTerms(iface, seen, outer) {
		// Terms such as `~[]E` resolve in the scope that declared `E`.
		const scope = iface._unionScope ?? outer;
		const sets = [iface.unionConstraint, ...(iface._typeSetEmbeds ?? [])]
			.filter(Boolean)
			.map((s) => this._constraintTerms(s, new Set(seen), scope));
		if (sets.length === 0 || sets.includes(null)) return null;
		const [first, ...rest] = sets;
		return first.filter((t) =>
			rest.every((set) => set.some((u) => identical(u, t))),
		);
	},

	// Only structs and arrays are their own managed objects in wasm; every other
	// value (numbers, strings, slices, maps, interfaces, pointers, funcs, SIMD
	// vectors) lives inline in its parent struct, array or global, so wasm has
	// no stable address for it.  Type parameters are checked per instantiation.
	_isScalarStorageType(t) {
		const u = this.resolveType(this._deepUnderlying(t)) ?? t;
		const k = u?.kind;
		if (!k || u._tainted) return false;
		return k !== "struct" && k !== "array" && k !== "typeParam";
	},

	// Whether `scope` holds package-level names: the package's own declarations
	// or the imports of one of its files.
	_isPackageScope(scope) {
		return scope === this.globals || this._isImportScope(scope);
	},

	// True when `operand` is a struct field, array/slice element or package-level
	// variable holding a scalar, in a package compiled to wasm.
	_isScalarInteriorOperand(operand, type, scope) {
		if (!this._isWasmPackage()) return false;
		let node = operand;
		while (node?.kind === "ParenExpr") node = node.expr;
		if (!node) return false;
		if (node.kind === "Ident") {
			const owner = scope.lookupScope(node.name);
			if (!this._isPackageScope(owner)) return false;
			if (scope.isConst?.(node.name)) return false;
			const sym = owner.get(node.name);
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

	// One operator typing path for `x op y`, `x op= y` and `x++` (the latter two
	// pass a synthetic BinaryExpr): operand checks, result type and the
	// constant retyping codegen reads.
	_typeBinaryOperands(expr, lt, rt, scope) {
		if (lt?._tainted || rt?._tainted) return TAINTED_ANY;
		this._checkConstOperands(expr.op, lt, rt, expr);
		if (isAny(lt) || isAny(rt)) {
			const res =
				this._checkDeclaredAnyBinary(expr.op, lt, rt, expr) ??
				this._checkAnyEquality(expr, lt, rt) ??
				this.binaryResultType(expr.op, ANY, ANY, expr);
			if (res?._tainted) return res;
			if (
				(expr.op === "==" || expr.op === "!=") &&
				!this._comparableOperands(lt, rt, expr)
			)
				return TAINTED_ANY;
			this._markComparedAggregate(expr.op, lt, rt, expr);
			return res;
		}
		// A defined empty interface (`type MyAny any`, `interface{}`) is a Go
		// `any` too.
		const goAnyError = this._checkDeclaredAnyBinary(expr.op, lt, rt, expr);
		if (goAnyError) return goAnyError;
		this._markTypeParamMapNil(expr, lt, rt, scope);
		const res = this.binaryResultType(expr.op, lt, rt, expr);
		if (expr.op !== "<<" && expr.op !== ">>") {
			this._retypeUntypedShift(lt, rt, expr.right);
			this._retypeUntypedShift(rt, lt, expr.left);
		}
		this._tagFloat32Const(lt, rt, expr.right);
		this._tagFloat32Const(rt, lt, expr.left);
		this._tagComplex64Const(lt, rt, expr.right);
		this._tagComplex64Const(rt, lt, expr.left);
		this._markUntyped64Operands(expr, lt, rt);
		return res;
	},

	// `any == x` needs a comparable `x` (a slice, map or func is comparable
	// only to `nil`). The operands are otherwise treated as `any` pairs.
	_checkAnyEquality(expr, lt, rt) {
		if (expr.op !== "==" && expr.op !== "!=") return null;
		if (lt?.kind === "typeParam" || rt?.kind === "typeParam") {
			this._checkTypeParamComparable(expr.op, lt, rt, expr);
			return null;
		}
		// Only a Go `any` beside a typed value is checked; a JS-dynamic operand
		// beside a typed one stays dynamic.
		const ltGo = anyKind(lt) === "go";
		if (ltGo === (anyKind(rt) === "go")) return null;
		const other = ltGo ? rt : lt;
		if (!other || other.kind === "untyped" || isNil(other) || isAny(other))
			return null;
		if (this._operatorDefined(expr.op, other)) return null;
		return this._reportCmpUndefined(expr.op, other, expr, true);
	},

	// An untyped operand beside a 64-bit integer is emitted as a BigInt on
	// JS.  A shift's operand never takes the type of its count.
	_markUntyped64Operands(expr, lt, rt) {
		if (expr.op === "<<" || expr.op === ">>") return;
		if (is64BitInt(lt) && rt?.kind === "untyped" && expr.right)
			expr.right._is64Bit = true;
		if (is64BitInt(rt) && lt?.kind === "untyped" && expr.left)
			expr.left._is64Bit = true;
	},

	// Go: map elements are not addressable, nor are fields and array elements
	// reached from one by value (`&m[k]`, `&m[k].f`, `&m[k][i]` on an array).
	_isMapElementOperand(operand, scope) {
		let node = operand;
		while (node?.kind === "ParenExpr") node = node.expr;
		if (node?.kind !== "SelectorExpr" && node?.kind !== "IndexExpr")
			return false;
		const bt = node.expr?._type;
		const b = this._coreUnderlying(bt, scope) ?? bt;
		if (node.kind === "IndexExpr" && b?.kind === "map") return true;
		if (b?.kind === "pointer" || b?.kind === "slice") return false;
		if (node.kind === "SelectorExpr" && b?.kind !== "struct") return false;
		if (
			node.kind === "SelectorExpr" &&
			this._promotedThroughPointer(bt, node.field)
		)
			return false;
		return this._isMapElementOperand(node.expr, scope);
	},

	// An identifier is addressable when it names a variable: not a constant,
	// type, declared function, package or builtin (see Scope). A variable
	// typed with a namespace-shaped declaration (`var Widget Widget`) is still
	// a variable, and shadowing any other name with a variable makes it one.
	_isAddressableIdent(n, scope) {
		const obj = scope?.lookupObject(n.name);
		if (!obj) return !BUILTIN_IDENTS.has(n.name);
		return obj.kind === "var";
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
		const st = this.resolveType(this._deepUnderlying(t)) ?? t;
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
		const u = this.resolveType(this._deepUnderlying(t)) ?? t;
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

	// `&x` needs an addressable operand, or a composite literal (`&T{}`).
	_errUnaddressableOperand(expr, ot) {
		const o = expr.operand;
		const u = this._deepUnderlying(ot);
		const kind =
			o.kind !== "Ident" && u?.kind === "struct" && ot?.kind === "named"
				? `value of struct type ${typeStr(ot)}`
				: operandKind(o, typeStr(ot));
		return this.err(
			`invalid operation: cannot take address of ${exprText(o)} (${kind})`,
			this._positioned(expr),
		);
	},

	_checkAddressOfExpr(expr, scope, ot) {
		if (this._isMapElementOperand(expr.operand, scope)) {
			this._errMapElementAddress(expr);
			return { kind: "pointer", base: ot };
		}
		let target = expr.operand;
		while (target?.kind === "ParenExpr") target = target.expr;
		if (
			target?.kind !== "CompositeLit" &&
			!this._isAddressable(target, scope)
		) {
			this._errUnaddressableOperand(expr, ot);
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
		}
		return { kind: "pointer", base: ot };
	},

	// Go constants have no negative zero: `-0.0` is plain 0, so it is rewritten
	// to a unary plus that both backends compile to +0.
	_foldNegativeZeroLiteral(expr) {
		const o = expr.operand;
		if (expr.op !== "-" || o?.kind !== "BasicLit") return;
		if (o.litKind !== "INT" && o.litKind !== "FLOAT") return;
		if (Number(String(o.value).replaceAll("_", "")) === 0) expr.op = "+";
	},

	// `*T` may name a type; `&P` is reported by the addressability check.
	_markUnaryOperand(expr) {
		if (expr.op === "*") expr.operand._typeRefOk = true;
		if (expr.op === "&") this._targetOperand(expr.operand);
	},

	_checkUnaryExpr(expr, scope) {
		this._foldNegativeZeroLiteral(expr);
		this._markUnaryOperand(expr);
		const ot = this.checkExpr(expr.operand, scope);
		if (expr.op === "*" && anyKind(ot) === "go" && !expr.operand._isTypeRef)
			return this.err(
				`invalid operation: cannot indirect ${exprText(expr.operand)} (${operandKind(expr.operand, typeStr(ot))})`,
				expr.operand,
			);
		if (expr.op !== "&" && expr.op !== "*" && anyKind(ot) === "go")
			return this._checkDeclaredAnyOperator(expr.op, ot, expr.operand);
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
			return this._checkDeref(ot, expr, scope);
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

	// A pointer-receiver method needs `&recv`: a map element or the result of
	// a call, conversion, literal or assertion has no address. A receiver that
	// reaches the method through an embedded pointer needs none.
	_reportUnaddressableRecv(expr, scope) {
		if (this.receiversChecked) return false;
		const recv = expr.expr;
		if (this._promotedThroughPointer(recv._type, expr.field)) return false;
		if (this._isMapElementOperand(recv, scope)) {
			this._errMapElementAddress(recv);
			return true;
		}
		if (this._isAddressable(recv, scope)) return false;
		this.err(
			`cannot call pointer method ${expr.field} on ${typeStr(recv._type)}`,
			this._positioned(expr),
		);
		return true;
	},

	// Go's addressability rule: a variable, a pointer indirection, a slice
	// element, a field of an addressable struct (or of any pointer), or an
	// element of an addressable array (or of any pointer to an array).
	// Constants, call results, literals, assertions, string and map elements,
	// and fields or array elements of those are not. Operands whose type the
	// checker does not model (JavaScript values, type parameters) count as
	// addressable.
	_isAddressable(node, scope) {
		let n = node;
		while (n?.kind === "ParenExpr") n = n.expr;
		if (!n) return false;
		if (n.kind === "Ident") return this._isAddressableIdent(n, scope);
		if (n.kind === "UnaryExpr") return n.op === "*";
		if (n.kind === "IndexExpr") return this._isAddressableIndex(n, scope);
		if (n.kind === "SelectorExpr") return this._isAddressableSelector(n, scope);
		return false;
	},

	_isAddressableIndex(n, scope) {
		const b = this._coreUnderlying(n.expr?._type, scope) ?? n.expr?._type;
		if (b?.kind === "slice" || b?.kind === "pointer") return true;
		if (b?.kind === "map" || isString(b)) return false;
		return b?.kind === "array" ? this._isAddressable(n.expr, scope) : true;
	},

	_isAddressableSelector(n, scope) {
		// Method values and method expressions are values, not variables.
		if (n._isMethodValue || n._isMethodExpr) return false;
		const bt = n.expr?._type;
		if (bt?.kind === "namespace") return this._isNamespaceVariable(bt, n.field);
		const b = this._coreUnderlying(bt, scope) ?? bt;
		if (b?.kind !== "struct") return true;
		if (this._promotedThroughPointer(bt, n.field)) return true;
		return this._isAddressable(n.expr, scope);
	},

	// Whether member `field` of namespace `ns` is a variable. A package says
	// what each member is (`_kinds`, see Scope): only its variables are. A
	// member a JavaScript declaration does not classify is a property, which
	// may be assigned unless it is a constant.
	_isNamespaceVariable(ns, field) {
		const kind = ns._kinds?.get(field);
		if (kind) return kind === "var";
		return !ns._consts?.has(field);
	},

	// `x.M` or `x.M()` with a pointer receiver on a named scalar or slice local takes
	// `&x`, so `x` must be boxed like an explicit `&x`.
	_markPtrRecvAddress(expr, base, ft, scope, recvT) {
		if (!this._methodExprPtrRecv(recvT, ft, expr.field)) return;
		if (this._reportUnaddressableRecv(expr, scope)) return;
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
		const base = this.resolveType(this._deepUnderlying(recvBase));
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
		const hidden = this._foreignMember(
			methodType._pkgId,
			expr.field,
			"method",
			expr,
		);
		if (hidden) return hidden;
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
		const base = this.resolveType(this._deepUnderlying(recvT));
		if (base?.kind === "interface" && base.methods?.has(expr.field)) {
			// `i.M` binds the interface value; the call dispatches when it runs.
			expr._isMethodValue = true;
			return;
		}
		if (!recvT || !this._isStructOrNamedMethod(recvT, base, expr.field)) return;
		expr._isMethodValue = true;
		if (baseType.kind === "pointer")
			expr._derefRecv = !this._methodExprPtrRecv(recvT, ft, expr.field);
		else this._markPtrRecvAddress(expr, base, ft, scope, recvT);
	},

	// Whether the identifier `name`, which resolved to `t`, names a type.  A
	// local variable or parameter that shares its name with a type of the
	// build (the type table spans packages) is a value.
	_namesType(name, t, scope) {
		if (!this.types.has(name)) return false;
		const owner = scope.lookupScope(name);
		const kind = owner?.object(name).kind;
		if (kind === "type") return true;
		// An import that declares a variable, constant or function beside a
		// type of that name (`declare var Foo: Foo`) binds the value.
		if (this._isImportScope(owner) && VALUE_KINDS.has(kind)) return false;
		// A binding the source declared as a variable, constant, function,
		// parameter or package is a value, whatever its type is.
		if (owner && owner !== this.universe && !this._externalNames.has(name))
			return false;
		// An imported name keeps meaning the type only where the import bound it:
		// a local variable of that type (`var Widget Widget`) is a value too.
		if (owner && owner !== this.universe && !this._isImportScope(owner))
			return false;
		return this._isImportScope(owner) || this.types.get(name) === t;
	},

	// What a name that is no value says when it stands where a value does:
	// a type, a builtin or a package is allowed only as the callee of a call
	// or conversion, the operand of `*` or the base of a selector, which set
	// `_typeRefOk` on it.
	_notAValue(expr, scope) {
		// A predeclared type is no value even as an assignment target.
		if (expr._typeRefOk || (expr._nameOk && scope)) return null;
		const kind = scope?.lookupObject(expr.name)?.kind;
		if (kind === "builtin") return `${expr.name} (built-in) must be called`;
		if (kind === "pkg") return `use of package ${expr.name} not in selector`;
		if (expr._isTypeRef) return `${expr.name} (type) is not an expression`;
		return null;
	},

	// A predeclared type named where a type may stand, or by mistake as a value.
	_basicTypeName(expr) {
		expr._isTypeRef = true;
		const notValue = this._notAValue(expr, null);
		if (notValue) return this.err(notValue, expr);
		return expr.name === "any" ? DECLARED_ANY : BASIC_TYPES[expr.name];
	},

	_checkSelectorExpr(expr, scope) {
		expr.expr._typeRefOk = true;
		expr.expr._selectorBase = true;
		const baseType = this.checkExpr(expr.expr, scope);
		if (baseType?._tainted) return TAINTED_ANY;
		const exclErr = this._checkExcludedSelectorExpr(expr, baseType);
		if (exclErr) return exclErr;
		if (
			expr.expr.kind === "Ident" &&
			scope?.lookupObject(expr.expr.name)?.kind === "builtin"
		)
			return this.err(
				`invalid use of ${expr.expr.name} (built-in) in selector expression`,
				expr,
			);
		if (expr.expr._isTypeRef) {
			const valueErr = this._checkDtsTypeSelector(expr, baseType);
			if (valueErr) return valueErr;
			const mExpr = this._checkMethodExprSelector(expr, baseType);
			if (mExpr) return mExpr;
			if (
				baseType?.kind !== "namespace" &&
				this._isFieldOfType(baseType, expr.field)
			)
				return this.err(
					`${exprText(expr)} undefined (type ${typeStr(baseType)} has no method ${expr.field})`,
					expr,
				);
		}
		const ft = this.fieldType(baseType, expr.field, expr);
		if (ft?.kind === "func")
			this._markMethodValueSelector(expr, baseType, ft, scope);
		if (
			baseType?.kind === "namespace" &&
			this.types.has(`${baseType.name}.${expr.field}`)
		) {
			expr._isTypeRef = true;
			if (!expr._typeRefOk && !expr._nameOk)
				return this.err(`${exprText(expr)} (type) is not an expression`, expr);
		}
		return ft;
	},

	// `dom.Element.id`: a `.d.ts` type has no methods or fields to select, it is
	// not a value. `(*MyEl).id` over a defined type of one has no method either.
	_checkDtsTypeSelector(expr, baseType) {
		const viaPointer = baseType?.kind === "pointer";
		const base = this._deepUnderlying(
			viaPointer ? this.resolveType(baseType.base) : baseType,
		);
		if (base?.kind !== "namespace" || !base._dtsType) return null;
		if (viaPointer)
			return this.err(
				`${exprText(expr)} undefined (type ${typeStr(baseType)} has no method ${expr.field})`,
				expr,
			);
		return this.err(
			`${exprText(expr.expr)} (type) is not an expression`,
			expr.expr,
		);
	},

	// `S.X` where X is a struct field: a type has methods, not fields.
	_isFieldOfType(t, field) {
		const u = this._deepUnderlying(t?.kind === "pointer" ? t.base : t);
		return u?.kind === "struct" && !!u.fields?.has(field);
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
			t = this._typeNamed(`${base.expr.name}.${base.field}`);
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

	// Core type of type parameter `tp`: the one underlying type shared by every
	// type in its constraint (`~[]E`, `~map[K]V`), or null when there is none.
	_coreType(tp, scope) {
		if (tp?.kind !== "typeParam") return null;
		const terms = this._constraintTerms(tp.constraint, new Set(), scope);
		if (!terms || terms.length === 0) return null;
		const unders = terms.map((t) => this._deepUnderlying(this.resolveType(t)));
		if (unders.some((u) => !u || !identical(u, unders[0]))) return null;
		return unders[0];
	},

	// `m == nil` on a type parameter whose core type is a map: the backends
	// compare it as a map, so record the core type on the operand.
	_markTypeParamMapNil(expr, lt, rt, scope) {
		if (expr.op !== "==" && expr.op !== "!=") return;
		const [operand, other] =
			rt === NIL
				? [expr.left, lt]
				: lt === NIL
					? [expr.right, rt]
					: [null, null];
		if (!operand || other?.kind !== "typeParam") return;
		const core = this._coreType(other, scope);
		if (core?.kind === "map") operand._coreType = core;
	},

	// Underlying type of `t` for indexing, slicing, ranging and the like; a
	// type parameter stands for its core type.
	_coreUnderlying(t, scope) {
		if (t?.kind === "typeParam") return this._coreType(t, scope) ?? t;
		return this._deepUnderlying(t);
	},

	// One step of underlying type, or the core type for a type parameter.
	_underlyingOrCore(t, scope) {
		if (t?.kind === "typeParam") return this._coreType(t, scope) ?? t;
		return this._deepUnderlying(t);
	},

	_markCompositeKey(key, kb, node, srcType) {
		if (!node || !srcType || isAny(key) || kb?.kind === "interface")
			return false;
		// Arrays, anonymous structs and pointers are not JS property names: the
		// backend encodes them by value (`sk`) or by identity (`pk`).
		if (kb?.kind === "pointer") node._mapKeyEnc = "pk";
		else if (kb?.kind === "array" || (key?.kind === "struct" && kb === key))
			node._mapKeyEnc = "sk";
		return true;
	},

	// A key of an interface-keyed map (`map[any]T`): the backend encodes it
	// with its dynamic type, so `L("1")`, `N(1)`, `"1"` and `1` stay distinct.
	// A named basic value is boxed first, exactly as in any interface
	// conversion; other values are keyed as they are.
	// Untyped constant operands take the result type, so a float32 result
	// rounds them like the typed operands.
	// `clear` takes a map or a slice (every type in a type parameter's type
	// set).
	_checkClearOperand(e, t) {
		if (!t || t._tainted || anyKind(t) === "dynamic") return;
		const ok = (u) => {
			const kind = this._deepUnderlying(u)?.kind;
			return kind === "map" || kind === "slice";
		};
		if (this._typeSetOk(t, ok)) return;
		this.err(
			`invalid argument: cannot clear ${exprText(e.args[0])} (${this._capOperandKind(e.args[0], t)}): argument must be (or constrained by) map or slice`,
			e,
		);
	},

	// `min` and `max` take ordered operands: numbers and strings.
	// A type parameter needs every type in its type set to be ordered.
	_orderedOperandOk(t) {
		if (!t || t._tainted) return true;
		if (t.kind === "typeParam")
			return this._typeParamAllows(t, (u) => this._orderedOperandOk(u));
		if (t.kind === "untyped")
			return (
				t.base !== "bool" && t.base !== "nil" && !t.base.startsWith("complex")
			);
		if (anyKind(t) === "go") return false;
		const u = this._deepUnderlying(t);
		if (!u || isAny(u)) return true;
		return (
			u.kind === "basic" && !/^(bool|nil|void|complex(64|128))$/.test(u.name)
		);
	},

	_checkMinMax(e, at) {
		for (let i = 0; i < e.args.length; i++) {
			if (this._orderedOperandOk(at[i])) continue;
			const what = isNil(at[i])
				? "nil"
				: `${exprText(e.args[i])} (${this._capOperandKind(e.args[i], at[i])})`;
			this.err(`invalid argument: ${what} cannot be ordered`, e);
			return ANY;
		}
		if (!this._unifyMinMaxArgs(e, at)) return ANY;
		const rt = minMaxType(at);
		for (let i = 0; i < e.args.length; i++)
			this._tagFloat32Const(rt, at[i], e.args[i]);
		return rt;
	},

	// The arguments meet one at a time, as the operands of a binary operator
	// do: typed arguments are identical, an untyped constant converts to the
	// typed type, and untyped constants share a kind class. Returns false
	// after reporting a mismatch.
	// The untyped constant argument `j` meets the typed type `tt` (argument
	// `i` is the later of the two and names the mismatch).
	_fitMinMaxConst(e, ut, j, tt, tNode, i, untypedFirst) {
		const uNode = e.args[j];
		const report = (lt, rt) => this._reportMinMaxMismatch(lt, rt, e.args[i]);
		const node = untypedFirst
			? { op: e.func?.name, left: uNode, right: tNode }
			: { op: e.func?.name, left: tNode, right: uNode };
		if (tt.kind === "typeParam")
			return this._convertUntypedToTypeParam(tt, ut, uNode, node, report);
		const [lt, rt] = untypedFirst ? [ut, tt] : [tt, ut];
		if (!this.convertUntyped(lt, rt, node, report)) return false;
		return !this._checkConstOverflow(tt, ut, uNode);
	},

	_unifyMinMaxArgs(e, at) {
		let typed = null;
		let typedNode = null;
		let acc = null; // the untyped constants seen so far, as one type
		const pending = []; // untyped arguments before the first typed one
		for (let i = 0; i < e.args.length; i++) {
			const cur = at[i];
			const report = (lt, rt) => this._reportMinMaxMismatch(lt, rt, e.args[i]);
			if (cur?.kind !== "untyped") {
				if (typed && !this._minMaxIdentical(typed, cur)) {
					report(typed, cur);
					return false;
				}
				if (!typed) {
					typed = cur;
					typedNode = e.args[i];
					for (const j of pending)
						if (!this._fitMinMaxConst(e, at[j], j, typed, typedNode, i, true))
							return false;
				}
				continue;
			}
			if (typed) {
				if (!this._fitMinMaxConst(e, cur, i, typed, typedNode, i, false))
					return false;
				continue;
			}
			const node = { op: e.func?.name, left: e.args[0], right: e.args[i] };
			if (acc && !this.convertUntyped(acc, cur, node, report)) return false;
			if (!acc || untypedRank(cur) > untypedRank(acc)) acc = cur;
			pending.push(i);
		}
		return true;
	},

	_minMaxIdentical(lt, rt) {
		if (lt?._tainted || rt?._tainted || isAny(lt) || isAny(rt)) return true;
		if (lt.kind !== "typeParam" && !this._isTypedBasicOperand(lt)) return true;
		if (rt.kind !== "typeParam" && !this._isTypedBasicOperand(rt)) return true;
		return identical(lt, rt);
	},

	_reportMinMaxMismatch(lt, rt, arg) {
		this.err(
			`invalid argument: mismatched types ${this._operandTypeStr(lt)} (previous argument) and ${this._operandTypeStr(rt)} (type of ${exprText(arg)})`,
			arg,
		);
	},

	_markIfaceKey(mapType, node, srcType) {
		const key = this.resolveType(mapType.key);
		const kb = this._deepUnderlying(key);
		const src = srcType && this.resolveType(srcType);
		if (node && src?.kind === "typeParam") {
			// Generic code: whether the key is boxed depends on the type argument,
			// so the backend decides at run time (`__ikt`).
			if (key?.kind === "typeParam" || isAny(key) || kb?.kind === "interface") {
				node._ifaceKeyDyn = key?.kind === "typeParam" ? "same" : "box";
				node._ifaceKeyParam = src.name;
			}
			return;
		}
		if (this._markCompositeKey(key, kb, node, srcType)) return;
		if (!node || !srcType || (!isAny(key) && kb?.kind !== "interface")) return;
		node._ifaceKey = true;
		node._ifaceKeyType = src;
		this._markIfaceBox(key, this.resolveType(srcType), node);
		if (node._ifaceBox === "named" || node._ifaceBox === "named_ptr") return;
		node._ifaceBox = undefined;
		node._ifaceSrc = undefined;
		node._ifacePtrFields = undefined;
	},

	_checkIndexExpr(expr, scope) {
		const typeRef = this._genericTypeRef(expr, scope);
		if (typeRef) return typeRef;
		expr.expr._genericOk = true;
		const bt = this._derefArrayPtr(
			expr,
			"expr",
			this.checkExpr(expr.expr, scope),
		);
		if (bt?.kind === "generic") {
			const inst = this._genericFuncValueAsInstantiation(expr);
			if (inst) return this._checkInstantiationExpr(inst, scope);
		}
		const indexType = this.checkExpr(expr.index, scope);
		if (bt?._tainted) return TAINTED_ANY;
		if (bt?._declared) return this._declaredAnyOperand("index", expr.expr, bt);
		if (isAny(bt)) return ANY;
		const btu = this._coreUnderlying(bt, scope);
		if (btu.kind !== "map")
			this._checkIntegerConstOperand(expr.index, "index", scope);
		if (btu.kind === "slice" || btu.kind === "array") {
			this._checkArrayBoundsExpr(btu, bt, expr, scope);
			return btu.elem;
		}
		if (btu.kind === "map") {
			expr._mapValueType = btu.value;
			this.assertAssignable(btu.key, indexType, expr.index, "map index");
			this._markIfaceKey(btu, expr.index, indexType);
			return btu.value;
		}
		if (btu.kind === "shared") {
			expr._sharedElem = btu.elem;
			const idx = this._constIntValue(expr.index, scope);
			if (idx !== null && idx < 0)
				this.err(`invalid index ${idx} (index must not be negative)`, expr);
			return btu.elem;
		}
		if (isString(bt)) return UINT8;
		return this.err(`Cannot index type ${typeStr(bt)}`, expr);
	},

	// `Id[int]` used as a value reaches the typechecker as an IndexExpr (the
	// parser only commits to type arguments before a call or literal).  The
	// node becomes an InstantiationExpr so both backends specialise it.
	_genericFuncValueAsInstantiation(expr) {
		const toTypeNode = (n) => {
			if (n?.kind === "TypeExpr") return n.type;
			// `Id[*int]`: the parser sees a dereference; on a generic function
			// it is a pointer type argument.
			if (n?.kind === "UnaryExpr" && n.op === "*") {
				const base = toTypeNode(n.operand);
				return base && { kind: "PointerType", base, _line: n._line };
			}
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
	// `copy` takes slices; a string may be the source.
	// Element type of a copy destination slice or shared buffer.
	_copyElem(t) {
		const u = this._coreUnderlying(t);
		return u?.kind === "slice" || u?.kind === "shared"
			? this.resolveType(u.elem)
			: null;
	},

	_checkCopyOperands(e, dt, st) {
		// A string source (or a type parameter whose type set holds strings and
		// byte slices) copies into a `[]byte`; strings mixed with other slices
		// leave no single source element type.
		const ok = (t, i) => {
			const tpElem =
				t?.kind === "typeParam" ? this._typeSetPart(t, "slice", "elem") : null;
			const strOk =
				!tpElem?.type ||
				(tpElem.type.kind === "basic" && tpElem.type.name === "uint8");
			return this._typeSetOk(
				t,
				(u) =>
					(i === 1 &&
						strOk &&
						this._isStringIntoBytes(this._copyElem(dt), u)) ||
					this._appendOperandOk(u),
			);
		};
		for (const [i, t] of [dt, st].entries()) {
			if (!ok(t, i)) {
				this.err(
					`invalid copy: argument must be a slice; have ${exprText(e.args[i])} (${this._capOperandKind(e.args[i], t)})`,
					e,
				);
				return false;
			}
			if (this._reportSliceElemMismatch("copy", e.args[i], t, e)) return false;
		}
		return true;
	},

	// `append` and `copy` on a type parameter need one element type across
	// the slices in its type set; reports and returns true when they differ.
	_reportSliceElemMismatch(builtin, operand, t, e) {
		if (t?.kind !== "typeParam") return false;
		const { type, other } = this._typeSetPart(t, "slice", "elem");
		if (!other) return false;
		this.err(
			`invalid ${builtin}: mismatched slice element types ${typeStr(type)} and ${typeStr(other)} in ${exprText(operand)} (${this._capOperandKind(operand, t)})`,
			e,
		);
		return true;
	},

	// The `part` ("elem" or "key") that the `kind` ("slice" or "map") types in
	// type parameter `t`'s type set share: `{ type, other }`, where `other` is
	// the first one that differs from `type` (undefined when they all agree).
	_typeSetPart(t, kind, part, scope) {
		const parts = (this._constraintTerms(t.constraint, new Set(), scope) ?? [])
			.map((u) => this._deepUnderlying(this.resolveType(u)))
			.filter((u) => u?.kind === kind)
			.map((u) => this.resolveType(u[part]));
		return {
			type: parts[0],
			other: parts.find((p) => !identical(p, parts[0])),
		};
	},

	// The slice (or shared buffer) type `append` and `copy` check an operand
	// against; a type parameter stands for a slice of the element type its
	// type set shares.
	_builtinSliceType(t, scope) {
		if (t?.kind === "typeParam") {
			const { type, other } = this._typeSetPart(t, "slice", "elem", scope);
			return type && !other ? { kind: "slice", elem: type } : null;
		}
		const u = this.resolveType(this._deepUnderlying(t));
		return u?.kind === "slice" || u?.kind === "shared" ? u : null;
	},

	_checkBuiltinCopy(e, at, scope) {
		const elemOf = (t) => this._builtinSliceType(t, scope)?.elem ?? null;
		const [dt, st] = at;
		if (!this._checkCopyOperands(e, dt, st)) return INT;
		const de = elemOf(dt);
		const se = elemOf(st);
		if (!sharedInfo(dt) && !sharedInfo(st)) {
			if (de && se && !isAny(de) && !isAny(se) && !identical(de, se))
				this.err(
					`invalid copy: arguments ${exprText(e.args[0])} (${this._capOperandKind(e.args[0], dt)}) and ${exprText(e.args[1])} (${this._capOperandKind(e.args[1], st)}) have different element types ${typeStr(this.resolveType(de))} and ${typeStr(this.resolveType(se))}`,
					e,
				);
			return INT;
		}
		if (!de || !se) {
			this.err(
				`copy: cannot copy between ${typeStr(dt)} and ${typeStr(st)}`,
				e,
			);
		} else if (!identical(de, se)) {
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
	// With `scope`, a type parameter whose core type is such a pointer counts.
	_derefArrayPtr(holder, key, t, scope) {
		if (scope && t?.kind === "typeParam") {
			const core = this._coreType(t, scope);
			if (core?.kind !== "pointer") return t;
			const under = this._deepUnderlying(core.base);
			if (under?.kind !== "array") return t;
			holder[key] = { kind: "UnaryExpr", op: "*", operand: holder[key] };
			holder[key]._type = core.base;
			return core.base;
		}
		// A defined pointer type (`type PA *[3]int`) shorthands like its pointer.
		const ptr = t?.kind === "named" ? this._deepUnderlying(t) : t;
		if (ptr?.kind !== "pointer") return t;
		const base =
			ptr.base?.kind === "named" ? this.resolveType(ptr.base) : ptr.base;
		const under = this._deepUnderlying(base);
		if (under?.kind !== "array") return t;
		holder[key] = { kind: "UnaryExpr", op: "*", operand: holder[key] };
		holder[key]._type = ptr.base;
		return ptr.base;
	},

	// An index, slice bound or `make` size that is a constant must be an
	// integer (`s[1 == 1]`, `make([]int, "a")`).
	// A typed operand must have an integer type too (`s[f]` with `f float64`).
	_checkIntegerConstOperand(operand, what, scope) {
		// An integral complex constant is its real part: the backends must see
		// a real number.
		if (operand?._cconst && constIntValue(operand._cconst) !== null)
			this._realizeComplexNode(operand, realOfConst(operand._cconst));
		const kind = this._nonIntegerConst(operand, scope);
		if (kind) {
			this.err(
				`invalid argument: ${what} ${exprText(operand)} (${kind}) must be integer`,
				operand,
			);
			return;
		}
		const t = operand?._type;
		if (!this._isNonIntegerType(t, scope)) return;
		this.err(
			`invalid argument: ${what} ${exprText(operand)} (${operandKind(operand, typeStr(t), false)}) must be integer`,
			operand,
		);
	},

	// Whether `t` is a type (or a defined type over one) that is not an
	// integer: a float, complex, bool, string, `any`, struct, pointer, slice,
	// map, func, array, interface, simd vector or a type parameter whose type
	// set is not all integers.  Untyped constants are judged by
	// `_nonIntegerConst`, so only untyped non-integers that reach here
	// (`s[a == b]`) count.
	_isNonIntegerType(t, scope) {
		if (!t || t._tainted) return false;
		// A type parameter is an integer only when every type in its type set
		// is (`~int | ~uint8`); `any`, `comparable` and method-only
		// constraints have no integer type set.
		if (t.kind === "typeParam") {
			const terms = this._constraintTerms(t.constraint, new Set(), scope);
			return !(terms?.length > 0 && terms.every(isInteger));
		}
		if (t.kind === "untyped")
			return (
				t.base === "bool" || t.base === "string" || t.base === "complex128"
			);
		const u = this._deepUnderlying(t);
		if (u?.kind === "basic") return nonIntegerBasic(u);
		return NON_INTEGER_KINDS.has(u?.kind);
	},

	_checkSliceExpr(expr, scope) {
		const bt = this._derefArrayPtr(
			expr,
			"expr",
			this.checkExpr(expr.expr, scope),
		);
		for (const bound of [expr.low, expr.high, expr.max]) {
			if (!bound) continue;
			this.checkExpr(bound, scope);
			this._checkIntegerConstOperand(bound, "index", scope);
		}
		if (bt?._tainted) return TAINTED_ANY;
		if (bt?._declared) return this._declaredAnyOperand("slice", expr.expr, bt);
		if (isAny(bt)) return ANY;
		const btu = this._coreUnderlying(bt, scope);
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
		const bodyRet = this._injectNamedReturns(expr.returnType, inner)
			? copyType(ret, { _hasNamedReturns: true })
			: ret;
		const savedDefer = this._deferCount;
		const savedLabels = this._labels;
		this._deferCount = 0;
		this._labels = newLabelScope();
		this.checkBlock(expr.body, inner, bodyRet);
		this._reportUnused(inner, expr);
		if (this._deferCount > 0) expr.body._hasDefer = true;
		this._deferCount = savedDefer;
		this._labels = savedLabels;
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

	// A complex operand converts to a real type only as an untyped constant
	// with no imaginary part (`int(1 + 0i)`, reported when it does not fit);
	// any other complex value needs `real()` or `imag()`.
	_rejectComplexToReal(srcType, targetType, expr, node) {
		if (srcType?.kind === "untyped" && node?._cconst) {
			this._complexConstUnfit(targetType, node, null, true);
			return;
		}
		this._convertError(expr, node, srcType, targetType);
	},

	// Go's `cannot convert x (variable of type S) to type T`, the one place
	// every conversion failure with an operand is worded. `suffix` carries a
	// reason (`: need type assertion`, ` (truncated)`).
	_convertText(operand, srcType, targetType, suffix = "") {
		let what;
		if (isNil(srcType)) what = "nil";
		else if (srcType?.kind === "untyped")
			what = this._untypedConstText(srcType, operand);
		else
			what = `${exprText(operand)} (${this._convOperandKind(operand, srcType)})`;
		return `cannot convert ${what} to type ${typeStr(targetType)}${suffix}`;
	},

	_convertError(expr, operand, srcType, targetType, suffix = "") {
		return this.err(
			this._convertText(operand, srcType, targetType, suffix),
			expr,
		);
	},

	_checkTypeConversion(expr, scope) {
		const srcType = this.checkExpr(expr.expr, scope);
		const targetType = this.resolveTypeNode(expr.targetType, scope);
		this._retypeUntypedShift(targetType, srcType, expr.expr);
		this._checkConstConversion(srcType, targetType, expr.expr);
		// `any(x)` / `error(x)`: box x as an implicit conversion would.
		this._markIfaceBox(targetType, srcType, expr.expr);
		this._rejectNilConversion(srcType, targetType, expr);
		if (this._checkIfaceConversion(srcType, targetType, expr, expr.expr))
			return targetType;
		if (
			srcType &&
			targetType &&
			!isAny(srcType) &&
			!isAny(targetType) &&
			this._checkConvTarget(srcType, targetType, expr, expr.expr, scope)
		)
			return targetType;
		// `complex64(1 + 0.01i)`: the constant's components round to float32.
		this._tagComplex64Const(targetType, srcType, expr.expr);
		this._checkConversionForm(srcType, targetType, expr, expr.expr);
		return targetType;
	},

	// The rules both conversion forms (`T(x)` as a type conversion node and as
	// a call of a type name) share: a complex operand reaching a real type, a
	// slice target the operand may not feed, then `_convertible`.
	_checkConversionForm(srcType, targetType, expr, operand) {
		// `nil` converts to any type that has a nil value.
		if (
			isNil(srcType) &&
			NILABLE_KINDS.has(this._deepUnderlying(targetType)?.kind)
		)
			return;
		if (isNumeric(targetType) && isComplex(srcType)) {
			this._rejectComplexToReal(srcType, targetType, expr, operand);
			return;
		}
		if (this._deepUnderlying(targetType)?.kind === "slice")
			this._rejectSeqAsSlice(srcType, operand, "a slice conversion");
		if (this._convertible(srcType, targetType, expr, operand)) return;
		const fraction = this._truncatesToInteger(srcType, targetType, operand);
		this._convertError(
			expr,
			operand,
			srcType,
			targetType,
			fraction ? " (truncated)" : "",
		);
	},

	// An untyped constant with a fractional part converting to an integer type.
	_truncatesToInteger(srcType, targetType, operand) {
		const v = operand?._const;
		return (
			srcType?.kind === "untyped" &&
			v != null &&
			isInteger(this._deepUnderlying(targetType)) &&
			constIntValue(v) === null
		);
	},

	// Spec *Conversions*: whether a value of `srcType` (or the untyped constant
	// `operand`) converts to `targetType`. A JS-dynamic or unresolved type on
	// either side, and an interface target (settled by its method set), pass here.
	_convertible(srcType, targetType, expr, operand) {
		if (!srcType || !targetType || isAny(srcType) || isAny(targetType))
			return true;
		const s = this.resolveType(this._deepUnderlying(srcType));
		const t = this.resolveType(this._deepUnderlying(targetType));
		if (!s || !t || s._tainted || t._tainted) return true;
		if (t.kind === "interface") return true;
		if (s.kind === "interface") return false;
		if (srcType.kind === "untyped")
			return this._untypedConvertible(srcType, t, operand);
		if (identical(s, t, { ignoreTags: true })) return true;
		if (s.kind === "pointer" && t.kind === "pointer")
			return (
				// Only unnamed pointer types convert by their base types.
				this.resolveType(srcType)?.kind === "pointer" &&
				this.resolveType(targetType)?.kind === "pointer" &&
				this._pointerConversionOk(s, t, srcType, targetType, expr, operand)
			);
		if (s.kind === "basic" && t.kind === "basic")
			return this._basicConvertible(s, t);
		if (t.kind === "basic" && isString(t) && s.kind === "slice")
			return this._isByteOrRune(s.elem);
		if (s.kind === "basic" && isString(s) && t.kind === "slice")
			return this._isByteOrRune(t.elem);
		if (s.kind === "slice" && t.kind === "array")
			return identical(s.elem, t.elem);
		if (s.kind === "slice" && t.kind === "pointer") {
			const arr = this.resolveType(this._deepUnderlying(t.base));
			if (arr?.kind !== "array" || !identical(s.elem, arr.elem)) return false;
			if (this._isWasmPackage()) this._errSliceArrayPointer(expr);
			return true;
		}
		return false;
	},

	// WasmGC has no array of its own behind a slice with an offset or spare
	// capacity, so a pointer to its elements cannot alias the slice.
	_errSliceArrayPointer(node) {
		return this.err(
			"cannot convert a slice to an array pointer in a wasm package; convert to an array ([N]T(s)) instead",
			this._positioned(node),
		);
	},

	_isByteOrRune(elem) {
		const u = this.resolveType(this._deepUnderlying(elem));
		return (
			u?.kind === "basic" && ["uint8", "byte", "int32", "rune"].includes(u.name)
		);
	},

	// Between two basic types: numeric to numeric, complex to complex, string
	// to string, bool to bool, and an integer to a string.
	_basicConvertible(s, t) {
		if (isNumeric(s) && isNumeric(t)) return true;
		if (isComplex(s) && isComplex(t)) return true;
		if (isString(s) && isString(t)) return true;
		if (isBool(s) && isBool(t)) return true;
		return isInteger(s) && isString(t);
	},

	// A constant converts by its class: a number to a number (a fractional
	// value not to an integer type), an integer to a string, a string to a
	// string or byte/rune slice, a bool to a bool.
	_untypedConvertible(src, t, operand) {
		const rune = src.base === "int";
		if (src.base === "string")
			return isString(t) || (t.kind === "slice" && this._isByteOrRune(t.elem));
		if (src.base === "bool") return isBool(t);
		if (t.kind !== "basic") return false;
		if (isString(t)) return rune;
		if (isBool(t)) return false;
		if (isComplex(t)) return true;
		return !this._truncatesToInteger(src, t, operand);
	},

	// Composite types convert only when identical, and a type parameter inside
	// one is identical to itself alone. Reports and returns true on a mismatch.
	_rejectTypeParamComposite(srcType, targetType, expr, operand) {
		const src = this._deepUnderlying(srcType);
		const tgt = this._deepUnderlying(targetType);
		if (
			src?.kind !== tgt?.kind ||
			!["slice", "map", "array"].includes(src?.kind) ||
			identical(src, tgt) ||
			!(mentionsTypeParam(src) || mentionsTypeParam(tgt))
		)
			return false;
		this._convertError(expr, operand, srcType, targetType);
		return true;
	},

	// `int(nil)`: only a type with a nil value converts from `nil`.
	_rejectNilConversion(srcType, targetType, expr) {
		if (!isNil(srcType) || !targetType || isAny(targetType)) return;
		if (targetType.kind === "typeParam") return;
		const kind = this._deepUnderlying(targetType)?.kind;
		if (!kind || NILABLE_KINDS.has(kind)) return;
		this._convertError(expr, null, srcType, targetType);
	},

	// Unnamed pointers convert when their base types share an underlying type
	// (ignoring struct tags).
	_pointerConversionOk(srcPtr, tgtPtr, srcType, targetType, expr, operand) {
		const sBase = this._deepUnderlying(srcPtr.base);
		const tBase = this._deepUnderlying(tgtPtr.base);
		// `interface{}` and `any` are one type, whatever declares them.
		const emptyIfaces =
			anyKind(srcPtr.base) === "go" && anyKind(tgtPtr.base) === "go";
		if (!emptyIfaces && !identical(sBase, tBase, { ignoreTags: true }))
			return false;
		// Two struct types are one wasm type only when they are one declaration.
		if (
			sBase?.kind !== "struct" ||
			(identical(sBase, tBase) && sBase?.name === tBase?.name)
		)
			return true;
		// WebAssembly struct types are nominal: the two pointers could not
		// share one object.
		if (this.target === "wasm" || this.target === "both") {
			this.recordBlocker("pointer conversion between struct types");
			this._convertError(
				expr,
				operand,
				srcType,
				targetType,
				" in a wasm package: pointers to distinct struct types cannot share storage; keep this code in a js package",
			);
		}
		return true;
	},

	// Conversions whose target or operand type is settled by its type set or
	// method set: an interface target or a type parameter on either side.
	_checkConvTarget(srcType, targetType, expr, operand, scope) {
		return (
			this._checkIfaceTargetConversion(srcType, targetType, operand) ||
			this._checkTypeParamConv(srcType, targetType, expr, operand, scope) ||
			this._rejectTypeParamComposite(srcType, targetType, expr, operand)
		);
	},

	// `I(x)` with I an interface type converts exactly when x is assignable to
	// I, so the method-set check (and its wording) is the assignment one.
	_checkIfaceTargetConversion(srcType, targetType, operand) {
		// `error("msg")` builds an error value (GoFront extension).
		if (targetType === ERROR && isString(srcType)) return false;
		const base = this.resolveType(this._deepUnderlying(targetType));
		if (base?.kind !== "interface" || !operand) return false;
		this.assertAssignable(targetType, srcType, operand, "conversion");
		return true;
	},

	_checkConversionValidity(srcType, targetType, expr) {
		this._retypeUntypedShift(targetType, srcType, expr.args?.[0]);
		this._checkConstConversion(srcType, targetType, expr.args?.[0]);
		if (this._checkIfaceConversion(srcType, targetType, expr, expr.args?.[0]))
			return;
		if (!srcType || !targetType || isAny(srcType) || isAny(targetType)) return;
		if (this._checkConvTarget(srcType, targetType, expr, expr.args?.[0]))
			return;
		this._checkConversionForm(srcType, targetType, expr, expr.args?.[0]);
	},

	_checkTypeAssertExpr(expr, scope) {
		const srcType = this.checkExpr(expr.expr, scope);
		const targetType = this.resolveTypeNode(expr.type, scope);
		this._markDynamicType(expr.type, targetType);

		// In Go, the source of a type assertion must be an interface type.
		// We allow `any` (which is GoFront's basic any) and interface types.
		if (srcType && !isAny(srcType)) {
			let underlying = this._deepUnderlying(srcType);
			underlying = this.resolveType(underlying);
			if (this._isDtsAssertion(underlying, targetType)) return targetType;
			if (underlying?.kind !== "interface") {
				this.err(
					`invalid type assertion: ${typeStr(srcType)} is not an interface`,
					expr,
				);
			} else if (this._isImpossibleAssertion(srcType, targetType)) {
				this.err(
					`impossible type assertion: ${exprText(expr.expr)}.(${typeStr(targetType)})\n\t${typeStr(targetType)} does not implement ${typeStr(srcType)}`,
					expr,
				);
			}
		}

		return targetType;
	},

	// What `await` yields: T for a `Promise<T>` from a `.d.ts` declaration (no
	// value for `Promise<void>`), else the operand's own type (an `async`
	// function's call already has its declared result).
	_awaitedType(t) {
		if (t?.kind !== "promise") return t;
		return this.resolveType(t.elem);
	},

	// `x.(T)` with `x` a `.d.ts` interface or class value and `T` one too:
	// JavaScript has no runtime type to test, so the assertion passes the
	// value through (a GoFront package namespace is not such a type).
	_isDtsAssertion(srcType, targetType) {
		return (
			srcType?._dtsType === true &&
			this.resolveType(targetType)?._dtsType === true
		);
	},

	// `x.(T)` with a concrete T can only succeed when T has every method of
	// x's interface type. An interface T, an empty interface, a type parameter
	// and JS-dynamic or unresolved types are never judged.
	_isImpossibleAssertion(ifaceType, targetType) {
		if (!targetType || targetType._tainted || isAny(targetType)) return false;
		const iface = this.resolveType(this._deepUnderlying(ifaceType));
		if (iface?.kind !== "interface" || !iface.methods?.size) return false;
		const target = this.resolveType(targetType);
		if (!target || target.kind === "typeParam" || target.kind === "interface")
			return false;
		if (this._deepUnderlying(target)?.kind === "interface") return false;
		return !this.implements(target, iface, null);
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

	// `cannot index v (variable of type any)`: a Go `any` needs a type
	// assertion before it can be indexed or sliced.
	_declaredAnyOperand(verb, operand, type) {
		return this.err(
			`invalid operation: cannot ${verb} ${exprText(operand)} (${operandKind(operand, typeStr(type))})`,
			operand,
		);
	},

	_rangeOperandError(node, type) {
		const untyped = type?.kind === "untyped";
		const via =
			type?.kind === "typeParam"
				? ` constrained by ${this._constraintText(type)}`
				: "";
		return this.err(
			`cannot range over ${exprText(node)} (${operandKind(node, untyped ? type.base : typeStr(type), untyped)}${via})`,
			node,
		);
	},

	// A range operand of a kind Go rejects: bool, float or complex values,
	// structs, interfaces, `.d.ts` types, non-array pointers, nil, and a type
	// parameter with no core type (`_rangeCore` resolves one that has it
	// first). JS-dynamic `any` and kinds the checker models loosely are left
	// alone.
	_notRangeable(type) {
		if (!type || type._tainted || isAny(type)) return false;
		if (type.kind === "typeParam") return true;
		if (type.kind === "untyped")
			return !(
				type.base === "string" ||
				type.base === "int" ||
				type.base === "rune"
			);
		const u = this._deepUnderlying(type);
		if (u?.kind === "basic") return !(isInteger(u) || isString(u) || isAny(u));
		if (u?.kind === "pointer" && type._viaCore)
			return this._deepUnderlying(u.base)?.kind !== "array";
		return NOT_RANGEABLE_KINDS.has(u?.kind);
	},

	// The type a `range` operand is read as: a type parameter stands for its
	// core type, which is recorded on the operand for the backends. A type
	// parameter without one stays as it is, and `_notRangeable` rejects it.
	_rangeCore(type, operand, scope) {
		if (type?.kind !== "typeParam") return type;
		const core = this._coreType(type, scope);
		if (!core) return type;
		operand._coreType = core;
		return core.kind === "pointer" ? { ...core, _viaCore: true } : core;
	},

	// The operand of a `range` clause; a constant takes its default type, so
	// `range 1 << 63` must fit an `int`.
	_checkRangeOperand(operand, scope) {
		const t = this.checkExpr(operand, scope);
		this._checkConstDefault(t, operand, "range clause");
		return t;
	},

	_checkRangeExpr(expr, scope) {
		const collType = this._derefArrayPtr(
			expr,
			"expr",
			this._checkRangeOperand(expr.expr, scope),
			scope,
		);
		const core = this._rangeCore(collType, expr.expr, scope);
		if (collType?._declared || this._notRangeable(core)) {
			const bad = this._rangeOperandError(expr.expr, collType);
			return { kind: "tuple", types: [bad, bad] };
		}
		return this._rangeCollTypeTuple(
			this._underlyingOrCore(core, scope),
			collType,
		);
	},

	_checkInstantiationExpr(expr, scope) {
		const typeRef = this._genericTypeRef(expr, scope);
		if (typeRef) return typeRef;
		// Generic instantiation: Foo[int] or Foo[int, string]
		expr.expr._genericOk = true;
		const baseType = this.checkExpr(expr.expr, scope);
		if (baseType?.kind === "generic") {
			if (this._rejectWasmGenericFromJs(baseType, expr)) return TAINTED_ANY;
			const typeArgs = expr.typeArgs.map((ta) =>
				this.resolveTypeNode(ta, scope),
			);
			if (typeArgs.length > baseType.typeParams.length) {
				return this.err(
					`got ${typeArgs.length} type arguments but ${baseType.name ?? "function"} has ${baseType.typeParams.length} type parameters`,
					expr,
				);
			}
			const errorsBefore = this.errors.length;
			this._checkTypeArgConstraints(baseType, typeArgs, scope, expr);
			// A rejected explicit argument already explains the call.
			if (this.errors.length > errorsBefore) return TAINTED_ANY;
			const allArgs = this._inferRemainingTypeArgs(baseType, typeArgs, scope);
			// As a value (not a callee) every type parameter must be known.
			if (allArgs.length < baseType.typeParams.length && !expr._genericOk) {
				return this.err(
					`cannot infer ${baseType.typeParams[allArgs.length].name} in ${exprText(expr)}`,
					expr,
				);
			}
			this._checkTypeArgConstraints(
				baseType,
				allArgs,
				scope,
				expr,
				typeArgs.length,
			);
			expr._typeArgs = allArgs;
			if (expr.expr) expr.expr._typeArgs = allArgs;
			expr._genericFnType = baseType;
			return this.instantiateGenericFunc(baseType, allArgs);
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

	// `slices.Sort[[]int]` as a value: the type parameters the explicit
	// arguments leave out, when a constraint determines them (`S ~[]E`), are
	// inferred like in a call. The result is the longest inferable prefix.
	// `scope` resolves the calling function's type parameters, so an explicit
	// argument `S ~[]E` unifies through its core type.
	_inferRemainingTypeArgs(fnType, typeArgs, scope) {
		const params = fnType.typeParams;
		if (typeArgs.length >= params.length) return typeArgs;
		const map = new Map();
		typeArgs.forEach((t, i) => {
			map.set(params[i].name, t);
		});
		const saved = this._inferScope;
		this._inferScope = scope;
		try {
			this._inferFromCoreTypes(params, map);
		} finally {
			this._inferScope = saved;
		}
		const out = [...typeArgs];
		for (let i = typeArgs.length; i < params.length; i++) {
			const t = map.get(params[i].name);
			if (!t) break;
			out.push(t);
		}
		return out;
	},

	// Checks `typeArgs[from..]` against the constraints of `fnType`'s type
	// parameters.
	_checkTypeArgConstraints(fnType, typeArgs, scope, node, from = 0) {
		for (
			let i = from;
			i < fnType.typeParams.length && i < typeArgs.length;
			i++
		) {
			const tp = fnType.typeParams[i];
			const constraint = tp.constraint
				? this.resolveTypeNode(
						tp.constraint,
						this._typeArgScope(fnType.typeParams, typeArgs, scope),
					)
				: null;
			if (constraint)
				this.checkConstraint(typeArgs[i], constraint, node, {
					typeParams: fnType.typeParams,
					typeArgs,
					name: tp.name,
					scope,
				});
		}
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
			return isInteger(this._deepUnderlying(target));
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
				return (scope ?? this.globals).lookupObject(e.name)?.kind === "const";
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
		return expr.args.map((a) => this._checkSingleValueArg(a, scope));
	},

	// An argument next to others is one value: a multi-value call there is
	// an error, as in Go (only a sole call argument forwards its results).
	_checkSingleValueArg(arg, scope) {
		const type = this.checkExpr(arg, scope);
		if (type?.kind !== "tuple") return type;
		return this.err(
			`multiple-value ${exprText(arg)} (${operandKind(arg, typeStr(type))}) in single-value context`,
			arg,
		);
	},

	_resolveCallFnType(fnType, argTypes, expr, scope) {
		if (
			fnType.kind === "named" &&
			this._deepUnderlying(fnType)?.kind === "func"
		)
			fnType = this._deepUnderlying(fnType);
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
		return this._completePartialInstantiation(expr, argTypes, scope) ?? fnType;
	},

	// `F[int](x)` with fewer explicit type arguments than type parameters:
	// infer the rest from the call arguments and record the full list.
	_completePartialInstantiation(expr, argTypes, scope) {
		const inst = expr.func;
		const generic = inst?.kind === "InstantiationExpr" && inst._genericFnType;
		if (!generic || inst._typeArgs.length >= generic.typeParams.length)
			return null;
		const typeArgs = this.inferTypeArgs(
			generic,
			this._inferArgTypes(expr, argTypes),
			inst._typeArgs,
			scope,
		);
		if (!typeArgs) {
			this.err(
				`Cannot infer type arguments for generic function '${generic.name}'`,
				expr,
			);
			return null;
		}
		this._checkTypeArgConstraints(
			generic,
			typeArgs,
			scope,
			expr,
			inst._typeArgs.length,
		);
		inst._typeArgs = typeArgs;
		if (inst.expr) inst.expr._typeArgs = typeArgs;
		return this.instantiateGenericFunc(generic, typeArgs);
	},

	// `T(x)` with T a type parameter: only a numeric x converts (the constraint
	// decides the target at instantiation).
	_checkTypeParamConversion(tp, argTypes, expr, scope) {
		expr._isTypeConversion = true;
		expr._conversionTargetType = tp;
		if (this._rejectConversionSpread(tp, expr)) return tp;
		if (expr.args.length !== 1) {
			return this.err(
				`cannot convert ${expr.args.length} arguments to type ${typeStr(tp)}`,
				expr,
			);
		}
		this._retypeUntypedShift(tp, argTypes[0], expr.args[0]);
		this._checkTypeParamConv(argTypes[0], tp, expr, expr.args[0], scope);
		return tp;
	},

	// A conversion with a type parameter on either side holds when the value
	// of every type in the source's type set converts to every type in the
	// target's (a plain type is its own set; a constraint without a type set
	// has none). Reports and returns true when either side is a type
	// parameter, whether or not the conversion is valid.
	_checkTypeParamConv(src, tgt, expr, operand, scope = this.globals) {
		if (src?.kind !== "typeParam" && tgt?.kind !== "typeParam") return false;
		if (!this._needsTypeParamConvCheck(src, tgt)) return true;
		const head = operand
			? this._convertText(operand, src, tgt)
			: `cannot convert ${typeStr(src)} to type ${typeStr(tgt)}`;
		if (isNil(src)) {
			if (this._isNilless(tgt))
				this.err(`cannot convert nil to type ${typeStr(tgt)}`, expr);
			return true;
		}
		if (anyKind(src) === "go" && tgt.kind === "typeParam") {
			this.err(`${head}: need type assertion`, expr);
			return true;
		}
		const sTerms = this._convTerms(src, scope);
		const tTerms = this._convTerms(tgt, scope);
		if (!sTerms.length || !tTerms.length) {
			const noSet = tTerms.length ? src : tgt;
			this.err(
				`${head}: ${typeStr(noSet)} is not constrained to a set of convertible types`,
				expr,
			);
			return true;
		}
		const bad = this._firstUnconvertible(sTerms, tTerms, expr, operand);
		if (bad) this.err(`${head}: ${this._termConvText(src, tgt, bad)}`, expr);
		else this._realizeForRealTerms(operand, tTerms);
		return true;
	},

	// `cannot convert int (in T) to type bool`: the pair of set members that
	// does not convert, tagged with the type parameter each belongs to.
	_termConvText(src, tgt, [s, t]) {
		const inTp = (side) =>
			side.kind === "typeParam" ? ` (in ${typeStr(side)})` : "";
		return `cannot convert ${typeStr(s)}${inTp(src)} to type ${typeStr(t)}${inTp(tgt)}`;
	},

	// False when the conversion needs no judging: identical types, a JS-dynamic
	// or recovered operand, or a target of `any`.
	_needsTypeParamConvCheck(src, tgt) {
		if (!src || !tgt || identical(src, tgt) || isAny(tgt)) return false;
		if (src._tainted || tgt._tainted) return false;
		const kind = anyKind(src);
		return kind !== "dynamic" && kind !== "tainted";
	},

	// The first (source type, target type) pair of two type sets that does not
	// convert, or null.
	_firstUnconvertible(sTerms, tTerms, expr, operand) {
		for (const s of sTerms)
			for (const t of tTerms)
				if (!this._termConvertible(s, t, expr, operand)) return [s, t];
		return null;
	},

	_convOperandKind(operand, src) {
		if (src.kind === "untyped") return operandKind(operand, src.base, true);
		return src.kind === "typeParam"
			? operandKind(
					operand,
					`${typeStr(src)} constrained by ${this._constraintText(src)}`,
				)
			: operandKind(operand, typeStr(src));
	},

	// The types a conversion operand or target ranges over.
	_convTerms(t, scope) {
		if (t.kind !== "typeParam") return [t];
		return this._constraintTerms(t.constraint, new Set(), scope) ?? [];
	},

	// Whether a value of type `s` (or the untyped constant `operand`) converts
	// to `t`, judged without reporting.
	_termConvertible(s, t, expr, operand) {
		if (s.kind === "untyped") {
			const u = this._deepUnderlying(t) ?? t;
			if (this._isRealNumberType(u) && s.base !== "string" && s.base !== "bool")
				return this._untypedFitsTerm(s, operand, t);
			s = defaultType(s);
		}
		const saved = this.errors;
		this.errors = [];
		this._checkConversionValidity(s, t, expr);
		const ok = this.errors.length === 0;
		this.errors = saved;
		return ok;
	},

	_isRealNumberType(u) {
		return u?.kind === "basic" && isNumeric(u) && !isComplex(u);
	},

	// A conversion to a type parameter needs a constraint that lists types
	// (`~int | ~float64`, or an interface embedding such a union); `any`,
	// `comparable` and method-only constraints allow every type argument.
	_constraintHasTypeSet(constraint, scope = this.globals) {
		if (!constraint) return true;
		if (constraint.kind === "UnionConstraint") return true;
		// Receiver type parameters keep their constraint as an AST node.
		const c = this.resolveType(
			constraint.kind === "TypeName" || constraint.kind === "InterfaceType"
				? this.resolveTypeNode(constraint, scope)
				: constraint,
		);
		const base = this._deepUnderlying(c);
		if (base?.kind !== "interface") return false;
		if (base.unionConstraint) return true;
		return (base._typeSetEmbeds ?? []).some((e) =>
			this._constraintHasTypeSet(e, scope),
		);
	},

	// A direct call of a `//gofront:native` function is marked `_native` so a
	// backend may substitute host code.  A function used as a value (`f :=
	// str.Index; f(a, b)`) is not a direct reference and calls the Go body.
	_markNativeCall(expr, fnType, scope) {
		const callee =
			expr.func.kind === "InstantiationExpr" ? expr.func.expr : expr.func;
		const native = fnType?.native ?? fnType?.underlying?.native ?? null;
		const direct =
			callee.kind === "Ident"
				? scope.lookupScope(callee.name) === this.globals &&
					this.globals.object(callee.name).kind === "func"
				: callee.kind === "SelectorExpr" && Boolean(callee._stdName);
		expr._native = native && direct ? native : null;
	},

	// The operand types of a builtin call.  A multi-value call that is the only
	// argument (`min(f())`) supplies its results as the operands: the builtin
	// is checked against one operand node per result (`expr._fwdArgs`), which
	// the backends read to emit it.
	_resolveBuiltinArgTypes(name, expr, scope) {
		const only = expr.args[0];
		if (
			expr.args.length === 1 &&
			only.kind === "CallExpr" &&
			name !== "make" &&
			name !== "new"
		) {
			const type = this.checkExpr(only, scope);
			if (type?.kind !== "tuple") return [type];
			expr._multiForward = true;
			const text = exprText(only);
			expr._fwdArgs = type.types.map((t) => ({
				kind: "Ident",
				name: text,
				line: only.line,
				col: only.col,
				_type: t,
			}));
			return type.types;
		}
		return expr.args.map((a, i) => this._checkBuiltinArg(name, a, i, scope));
	},

	_checkBuiltinArg(name, arg, i, scope) {
		// new(T) — first arg is a type name, not a value expression
		if (name === "new" && i === 0) return ANY;
		// make(T, ...) names the type to make.
		if (name === "make" && i === 0) arg._typeRefOk = true;
		return this._checkSingleValueArg(arg, scope);
	},

	// Name of a predeclared type (`int`, `string`, `any`, `error`, …) when
	// `fn` is an `Ident` with no shadowing declaration in `scope`, else null.
	_unshadowedPredeclaredType(fn, scope) {
		if (fn?.kind !== "Ident") return null;
		const { name } = fn;
		if (!Object.hasOwn(BASIC_TYPES, name) && name !== "error") return null;
		if (fn._universe) return name;
		const owner = scope.lookupScope(name);
		return !owner || owner === this.universe ? name : null;
	},

	checkCall(expr, scope) {
		// The generated Go and the stdlib's Go source call the builtins `len`,
		// `append`, `make`, ... and predeclared type conversions: a declaration
		// of that name in the user's package must not capture them.
		if (
			this._builtinsFromUniverse &&
			expr.func.kind === "Ident" &&
			(this.universe.lookup(expr.func.name)?.kind === "builtin" ||
				Object.hasOwn(BASIC_TYPES, expr.func.name))
		)
			expr.func._universe = true;
		const predeclared = this._unshadowedPredeclaredType(expr.func, scope);
		if (predeclared) {
			if (expr.args.length === 1 && !expr.args[0]._spread) {
				const arg = expr.args[0];
				delete expr.func;
				delete expr.args;
				expr.kind = "TypeConversion";
				expr.targetType = { kind: "TypeName", name: predeclared };
				expr.expr = arg;
				return this._checkTypeConversion(expr, scope);
			}
			this._resolveCallArgTypes(expr, scope);
			const target =
				predeclared === "error"
					? ERROR
					: predeclared === "any"
						? DECLARED_ANY
						: BASIC_TYPES[predeclared];
			if (this._rejectConversionSpread(target, expr)) return target;
			return this.err(
				`cannot convert ${expr.args.length} arguments to type ${typeStr(target)}`,
				expr,
			);
		}
		expr.func._typeRefOk = true;
		expr.func._genericOk = true;
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
			expr._builtinName = fnType.name;
			const argTypes = this._resolveBuiltinArgTypes(fnType.name, expr, scope);
			// Only `append` takes `xs...`; Go rejects it on every other builtin.
			if (fnType.name !== "append" && expr.args.some((a) => a._spread)) {
				this.err(
					`invalid operation: invalid use of ... with built-in ${fnType.name}`,
					expr,
				);
				return ANY;
			}
			return this.checkBuiltin(fnType.name, expr, argTypes, scope);
		}

		this._markNativeCall(expr, fnType, scope);
		const argTypes = this._resolveCallArgTypes(expr, scope);

		if (fnType?._tainted) return TAINTED_ANY;
		// `any(x)` / `error(x)` / `Iface(x)`: box x as an implicit conversion would.
		if (expr.func._isTypeRef && expr.args.length === 1 && argTypes[0])
			this._markIfaceBox(fnType, argTypes[0], expr.args[0]);
		if (anyKind(fnType) === "go" && !expr.func._isTypeRef)
			return this.err(
				`invalid operation: cannot call non-function ${exprText(expr.func)} (${operandKind(expr.func, typeStr(fnType))})`,
				expr,
			);
		// `(any)(x)` / `type A = any; A(x)` convert like `any(x)`.
		if (isAny(fnType) && !(fnType._declared && expr.func._isTypeRef)) {
			if (expr.func._isTypeRef) this._rejectConversionSpread(fnType, expr);
			return ANY;
		}

		// Any type named by the callee (`MyInt(x)`, `type A = []int; A(nil)`,
		// `(([]int))(nil)`): type conversion rather than a function call.
		if (expr.func._isTypeRef) {
			if (fnType.kind === "typeParam") {
				return this._checkTypeParamConversion(fnType, argTypes, expr, scope);
			}
			expr._isTypeConversion = true;
			expr._conversionTargetType = fnType;
			if (this._rejectConversionSpread(fnType, expr)) return fnType;
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

		fnType = this._resolveCallFnType(fnType, argTypes, expr, scope);
		if (!fnType) return ANY;
		if (fnType.kind !== "func") {
			return this.err(`Cannot call non-function type ${typeStr(fnType)}`, expr);
		}

		this._checkCallArgs(fnType, argTypes, expr, scope);

		const ret = fnType.returns;
		if (!ret || ret.length === 0) return VOID;
		if (ret.length === 1) return this._resolveDtsAlias(ret[0]);
		return this._resolveDtsAlias({ kind: "tuple", types: ret });
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

	// Argument types for inference: a spread argument `xs...` stands for its
	// elements, which is what the variadic parameter type describes.
	_inferArgTypes(expr, argTypes) {
		return argTypes.map((t, i) => {
			if (!expr.args?.[i]?._spread) return t;
			const u = this.resolveType(this._deepUnderlying(t));
			return u?.kind === "slice" ? u.elem : t;
		});
	},

	// Scope where each type parameter name stands for its type argument, so a
	// constraint that mentions another parameter (`S ~[]E`) resolves.
	_typeArgScope(typeParams, typeArgs, scope) {
		const out = new Scope(scope);
		typeParams.forEach((tp, i) => {
			if (typeArgs[i])
				out.define(tp.name, { kind: "aliasArg", type: typeArgs[i] });
		});
		return out;
	},

	// WebAssembly monomorphises generics over the `wasm` units only, so a
	// `js` package has no instance of a `wasm` package's generic function to
	// call. Reports the error and returns true.
	_rejectWasmGenericFromJs(fnType, expr) {
		if (this.target !== "js" || fnType._target !== "wasm") return false;
		const declared = displayTypeName(fnType.name);
		const name = declared.includes(".")
			? declared
			: `${fnType._pkgName}.${declared}`;
		this.err(
			`generic function ${name} is declared in a wasm package and cannot be called from a js package; wrap it in a non-generic function in the wasm package, or move it to a 'both' package`,
			expr,
		);
		return true;
	},

	_resolveGenericFnType(fnType, argTypes, expr, scope) {
		if (this._rejectWasmGenericFromJs(fnType, expr)) return null;
		if (fnType.underlying && this._rejectSpreadCall(fnType.underlying, expr))
			return null;
		const typeArgs = this.inferTypeArgs(
			fnType,
			this._inferArgTypes(expr, argTypes),
			[],
			scope,
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
				? this.resolveTypeNode(
						tp.constraint,
						this._typeArgScope(fnType.typeParams, typeArgs, scope),
					)
				: null;
			if (constraint)
				this.checkConstraint(typeArgs[i], constraint, expr, {
					typeParams: fnType.typeParams,
					typeArgs,
					name: tp.name,
					scope,
				});
		}
		expr._typeArgs = typeArgs;
		if (expr.func) expr.func._typeArgs = typeArgs;
		expr._genericFnType = fnType;
		if (expr.func) expr.func._genericFnType = fnType;
		return this.instantiateGenericFunc(fnType, typeArgs);
	},

	_checkArgCount(fnType, argTypes, expr) {
		// A `.d.ts` signature with optional parameters records how many a call
		// must pass (`minArgs`).
		const optional = fnType.minArgs !== undefined;
		const minArgs =
			fnType.minArgs ??
			fnType.params.filter(
				(_, i) => !fnType.variadic || i < fnType.params.length - 1,
			).length;
		if (argTypes.length < minArgs)
			this.err(
				`Too few arguments: expected ${optional ? "at least " : ""}${minArgs}, got ${argTypes.length}`,
				expr,
			);
		if (!fnType.variadic && argTypes.length > fnType.params.length)
			this.err(
				`Too many arguments: expected ${optional ? "at most " : ""}${fnType.params.length}, got ${argTypes.length}`,
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
		// The generated wrapper of a Print-family call takes the results as
		// separate parameters (src/lower/fmt-formatters.js).
		if (ns?.name === "fmt" && FMT_PRINT_FUNCS.has(expr.func.field)) return;
		this.err(
			"passing multiple return values to a variadic function is not supported in wasm packages; assign them to variables first",
			expr,
		);
	},

	// `f(xs...)` needs a variadic `f`, which takes `xs` as its whole variadic
	// parameter. Reports and returns true when the call cannot be.
	_rejectSpreadCall(fnType, expr) {
		if (fnType.variadic || !expr.args.some((a) => a._spread)) return false;
		this.err(
			`cannot use ... in call to non-variadic ${exprText(expr.func)}`,
			expr,
		);
		return true;
	},

	// `T(xs...)`: a conversion takes one plain operand.
	_rejectConversionSpread(target, expr) {
		if (!expr.args.some((a) => a._spread)) return false;
		this.err(`invalid use of ... in conversion to ${typeStr(target)}`, expr);
		return true;
	},

	// `f(a, xs...)` fills every parameter, the variadic one with `xs`: any
	// other count is an error, and `...` may only follow the last argument.
	// Reports and returns true when it is wrong.
	_rejectSpreadCount(wanted, expr, callee) {
		const given = expr.args.length;
		const early = expr.args.findIndex((a, i) => a._spread && i < given - 1);
		if (early >= 0) {
			this.err(
				`can only use ... with final argument in call to ${callee}`,
				expr.args[early],
			);
			return true;
		}
		if (given === wanted || !expr.args.some((a) => a._spread)) return false;
		const what = given > wanted ? "too many" : "not enough";
		this.err(`${what} arguments in call to ${callee}`, expr);
		return true;
	},

	_checkCallArgs(fnType, argTypes, expr, scope = null) {
		if (this._rejectSpreadCall(fnType, expr)) return;
		if (
			this._rejectSpreadCount(fnType.params.length, expr, exprText(expr.func))
		)
			return;
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
				// `f(xs...)` passes xs as the whole variadic slice.
				if (fnType.variadic && paramIdx === fnType.params.length - 1)
					this.assertAssignable(
						{ kind: "slice", elem: fnType.params[paramIdx] },
						this._deepUnderlying(argTypes[i]),
						expr.args[i],
						`argument to ${exprText(expr.func)}`,
					);
				continue;
			}
			const targetParam = fnType.params[paramIdx];
			const node = expr._multiForward ? null : expr.args[i];
			// A forwarded call carries no per-argument node: report at the call
			// that yields the results (`f()` in `g(f())`).
			this._forwardedCall = expr._multiForward ? expr.args[0] : null;
			this.assertAssignable(
				targetParam,
				argTypes[i],
				node,
				`argument to ${exprText(expr.func)}`,
				undefined,
				!expr._isDeferCall,
			);
			this._forwardedCall = null;
		}
		// `g(f())`: per-element box marks for lowering to split the forward.
		if (
			expr._multiForward &&
			!fnType.variadic &&
			!this._skipIfaceMark &&
			fnType.params.length === argTypes.length
		)
			this._markForwardedElems(fnType.params, argTypes, expr.args[0]);

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

	// `make` takes a size (and a capacity) for a slice, an optional size for
	// a map or channel.
	_checkMakeArity(e, t) {
		const kind = this._deepUnderlying(t)?.kind;
		const [lo, hi] = kind === "slice" ? [2, 3] : [1, 2];
		if (!["slice", "map", "chan"].includes(kind)) {
			if (t && t !== ANY && !t._tainted)
				this.err(
					`invalid argument: cannot make ${typeStr(t)}: type must be slice, map, or channel`,
					e,
				);
			return;
		}
		if (e.args.length >= lo && e.args.length <= hi) return;
		this.err(
			`invalid operation: make(${[typeStr(t), ...e.args.slice(1).map(exprText)].join(", ")}) expects ${lo} or ${hi} arguments; found ${e.args.length}`,
			e,
		);
	},

	// Go reports a wrong argument count before looking at any operand.
	_checkBuiltinArity(name, expr) {
		const range = BUILTIN_ARITY[name];
		if (!range) return true;
		const found = expr._fwdArgs?.length ?? expr.args.length;
		const [min, max] = range;
		if (found >= min && found <= max) return true;
		const [what, expected] =
			found < min ? ["not enough", min] : ["too many", max];
		this.err(
			`${what} arguments for ${exprText(expr)} (expected ${expected}, found ${found})`,
			expr,
		);
		return false;
	},

	checkBuiltin(name, expr, argTypes, scope) {
		if (!this._checkBuiltinArity(name, expr)) return ANY;
		const gen = BUILTIN_CHECK[name];
		// The checks read `args` as written: show them one node per result.
		const view = expr._fwdArgs ? { ...expr, args: expr._fwdArgs } : expr;
		return gen ? gen(this, name, view, argTypes, scope) : ANY;
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

	_capOperandKind(operand, type) {
		const untypedConst = type?.kind === "untyped" && type.base !== "nil";
		if (untypedConst) return operandKind(operand, type.base, true);
		const kind = operandKind(operand, typeStr(type), false);
		return type?.kind === "typeParam"
			? `${kind} constrained by ${this._constraintText(type)}`
			: kind;
	},

	// `cap` takes a slice or an array (a pointer to an array is dereferenced
	// before this check); a type parameter needs one for every type in its
	// type set, where `~*[N]E` also counts. Unknown and `any` operands (JS
	// interop) are not judged.
	_capOperandOk(t) {
		if (!t || t._tainted || anyKind(t) === "dynamic") return true;
		if (t.kind === "typeParam")
			return this._typeParamAllows(t, (u) => {
				const b = this._deepUnderlying(u);
				if (b?.kind === "pointer")
					return this._deepUnderlying(b.base)?.kind === "array";
				return b?.kind === "slice" || b?.kind === "array";
			});
		const kind = this._deepUnderlying(t)?.kind;
		return kind === "slice" || kind === "array";
	},

	// `len` takes a string, array (or pointer to one), slice or map, for every
	// type in a type parameter's type set; a Go `any` needs a type assertion
	// first, while a JS-dynamic value is not judged.
	_lenOperandOk(t) {
		if (!t || t._tainted || anyKind(t) === "dynamic") return true;
		if (t.kind === "typeParam")
			return this._typeParamAllows(t, (u) => this._lenOperandOk(u));
		if (t.kind === "untyped") return t.base === "string";
		if (anyKind(t) === "go") return false;
		const u = this._deepUnderlying(t);
		// A pointer counts only when it points to an array.
		if (u?.kind === "pointer")
			return this._deepUnderlying(u.base)?.kind === "array";
		if (u?.kind === "basic") return u.name === "string";
		return (
			u?.kind === "array" ||
			u?.kind === "slice" ||
			u?.kind === "map" ||
			u?.kind === "shared"
		);
	},

	// `delete` takes a map (every type in a type parameter's type set, all
	// with one key type); a JS-dynamic value is not judged. Returns the map
	// type the key is checked against (for a type parameter, a map of the
	// shared key type), or null.
	_checkDeleteOperand(expr, t, scope) {
		if (!t || t._tainted || anyKind(t) === "dynamic")
			return this._deepUnderlying(t);
		const arg = expr.args[0];
		if (!this._typeSetOk(t, (u) => this._deepUnderlying(u)?.kind === "map")) {
			this.err(
				`invalid argument: ${exprText(arg)} (${this._capOperandKind(arg, t)}) is not a map`,
				expr,
			);
			return null;
		}
		if (t.kind !== "typeParam") return this._deepUnderlying(t);
		const { type, other } = this._typeSetPart(t, "map", "key", scope);
		if (!other) return { kind: "map", key: type };
		this.err(
			`invalid argument: maps of ${exprText(arg)} (${this._capOperandKind(arg, t)}) must have identical key types`,
			expr,
		);
		return null;
	},

	// `append` takes a slice (every type in a type parameter's type set); a
	// JS-dynamic value is not judged, and arrays and shared buffers have their
	// own messages.
	_appendOperandOk(t) {
		if (!t || t._tainted) return true;
		if (t.kind === "typeParam")
			return this._typeParamAllows(t, (u) => this._appendOperandOk(u));
		if (anyKind(t) === "go") return false;
		const u = this._deepUnderlying(t);
		if (!u || isAny(u)) return true;
		return u.kind === "slice" || u.kind === "shared";
	},

	// Each appended element must be assignable to the slice's element type;
	// `xs...` must be assignable to the slice type, except that a string
	// spreads into a `[]byte`.
	_checkAppendArgs(sliceType, e, at) {
		const elem = this.resolveType(sliceType.elem);
		const is64 = is64BitInt(sliceType.elem);
		for (let i = 1; i < e.args.length; i++) {
			const arg = e.args[i];
			if (!at[i]) continue;
			if (arg._spread) {
				this._rejectSeqAsSlice(at[i], arg, "a spread argument");
				if (!this._isStringIntoBytes(elem, at[i]))
					this.assertAssignable(
						{ kind: "slice", elem: sliceType.elem },
						this._deepUnderlying(at[i]),
						arg,
						"argument to append",
					);
				continue;
			}
			if (is64) arg._is64Bit = true;
			this.assertAssignable(elem, at[i], arg, "argument to append", arg, true);
		}
	},

	_isStringIntoBytes(elem, t) {
		const u = this._deepUnderlying(t);
		const isString =
			t?.kind === "untyped" ? t.base === "string" : u?.name === "string";
		return isString && elem?.kind === "basic" && elem.name === "uint8";
	},

	_checkBuiltinLen(name, expr, argTypes) {
		this._rejectSeqAsSlice(argTypes[0], expr.args?.[0], `${name}()`);
		if (name === "len" && !this._lenOperandOk(argTypes[0]))
			this.err(
				`invalid argument: ${exprText(expr.args?.[0])} (${this._capOperandKind(expr.args?.[0], argTypes[0])}) for built-in len`,
				expr,
			);
		const operand = expr.args?.[0];
		if (expr.args?.length === 1)
			argTypes[0] = this._derefArrayPtr(expr.args, 0, argTypes[0]);
		// `len` and `cap` of an array (or pointer to one) are its length.
		const size = this._constLenFromType(argTypes[0]);
		if (size != null) {
			expr._constLen = size;
			// The operand is not dereferenced: a nil `*[N]T` has length N.
			if (expr.args.length === 1) expr.args[0] = operand;
		}
		if (name === "cap") {
			if (sharedInfo(argTypes[0])) {
				this.err(
					`cannot use cap() on ${typeStr(argTypes[0])}: shared buffers have a fixed size; use len()`,
					expr,
				);
			} else if (!this._capOperandOk(argTypes[0])) {
				this.err(
					`invalid argument: ${exprText(expr.args?.[0])} (${this._capOperandKind(expr.args?.[0], argTypes[0])}) for cap`,
					expr,
				);
			}
		}
		return INT;
	},

	_checkBuiltinComplex(expr, argTypes) {
		// `complex(1 + 0i, 0)`: an integral complex constant is a real part.
		const [crt, cit] = argTypes.map((t, i) =>
			t?.kind === "untyped" &&
			expr.args[i]?._cconst &&
			!this._complexConstUnfit(FLOAT64, expr.args[i], null)
				? expr.args[i]._type
				: t,
		);
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
			// An untyped operand takes type float32 (`complex(f, 0.01)`).
			this._tagFloat32Const(FLOAT32, crt, expr.args[0]);
			this._tagFloat32Const(FLOAT32, cit, expr.args[1]);
			return COMPLEX64;
		}
		return COMPLEX128;
	},

	_checkBuiltinRealImag(name, expr, argTypes) {
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

	// The type a literal builds, as the struct, array, slice, map or simd type
	// that holds its elements (`lit`) with the type to name in a diagnostic
	// (`type`). An elided `{...}` stands for its hint, or for what a hint of
	// `*T` points at (one level: `[]**T{{}}` has no literal to elide). A type
	// parameter stands for its core type. A basic, `.d.ts`, func or interface
	// type is not one of those and yields `lit: null`, as does a type that
	// already failed to resolve (it has its error).
	_literalType(expr, t, scope) {
		let type = t;
		let base = this._deepUnderlying(t);
		if (expr.typeExpr === null && base?.kind === "pointer") {
			type = this.resolveType(base.base);
			base = this._deepUnderlying(type);
		}
		const lit = base?.kind === "typeParam" ? this._coreType(base, scope) : base;
		if (["struct", "array", "slice", "map", "simd"].includes(lit?.kind))
			return { type, lit };
		return { type, lit: null, tainted: !!(t?._tainted || base?._tainted) };
	},

	// Go gives an elided literal its type from the element or key type of the
	// enclosing array, slice or map literal only. Anywhere else (a struct
	// field, a call argument) there is none to take.
	_checkUntypedCompositeLit(expr, scope) {
		this.err("missing type in composite literal", expr);
		return this._checkUnknownCompositeLit(expr, scope, TAINTED_ANY);
	},

	checkCompositeLit(expr, scope, hintType = null) {
		if (expr.typeExpr === null && !hintType)
			return this._checkUntypedCompositeLit(expr, scope);
		const t =
			expr.typeExpr === null
				? hintType
				: this.resolveTypeNode(expr.typeExpr, scope);
		const typeNode = expr.typeExpr;
		const { type, lit: base, tainted } = this._literalType(expr, t, scope);
		if (tainted) return this._checkUnknownCompositeLit(expr, scope, t);
		if (!base) {
			this.err(`invalid composite literal type ${typeStr(t)}`, expr);
			return t;
		}
		if (this._isSliceOrArray(base)) this._checkArrayLitKeys(expr, scope);
		this._inferArraySize(expr, typeNode, base);
		this._checkLiteralElems(expr, scope, type, base, typeNode);
		return t;
	},

	// Checks the elements of a literal of `type` (its holder is `base`) and
	// leaves the type the literal was given to the caller.
	_checkLiteralElems(expr, scope, type, base, typeNode) {
		if (base.kind === "struct")
			this._checkStructCompositeLit(expr, scope, type, base);
		else if (base.kind === "simd")
			this._checkSimdCompositeLit(expr, scope, type, base);
		else if (this._isSliceOrArray(base))
			this._checkSliceArrayCompositeLit(expr, scope, type, base, typeNode);
		else this._checkMapCompositeLit(expr, scope, type, base);
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
					f.embedded ? [embeddedFieldName(f)] : f.names,
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
			this._checkLiteralField(
				base,
				fieldName,
				t,
				elem,
				"implicit assignment to",
			);
			const vt = this.checkExpr(elem, scope);
			if (fieldType)
				this.assertAssignable(
					fieldType,
					vt,
					elem,
					"struct literal",
					undefined,
					true,
				);
			elem._positionalField = fieldName;
		}
		if (expr.elems.length < fieldNames.length)
			this.err(`too few values in struct literal of type ${typeStr(t)}`, expr);
		return t;
	},

	// A struct literal of a type another package declares cannot set a field
	// that package does not export (`action` is "implicit assignment to" for a
	// positional element, "cannot refer to" for a key).
	_checkLiteralField(base, name, t, node, action) {
		const owner = base._fieldOwner?.get(name);
		if (owner === undefined || owner === this._pkgId) return;
		if (!this._unexportedForeign(name)) return;
		const type = t?._pkgName ? `${t._pkgName}.${typeStr(t)}` : typeStr(t);
		this.err(
			`${action} unexported field ${name} in struct literal of type ${type}`,
			node,
		);
	},

	_checkStructKeyedElems(expr, scope, t, base) {
		for (const elem of expr.elems) {
			if (elem.kind === "KeyValueExpr") {
				const keyName = elem.key.name;
				const embed = base._structFields?.find(
					(f) => f.embedded && embeddedFieldName(f) === keyName,
				)?.type;
				if (embed) elem._isEmbedInit = true;
				this._checkLiteralField(base, keyName, t, elem.key, "cannot refer to");
				const fieldType = base.fields?.get(keyName) ?? embed;
				if (fieldType) {
					const vt = this.checkExpr(elem.value, scope);
					this.assertAssignable(
						fieldType,
						vt,
						elem.value,
						"struct literal",
						undefined,
						true,
					);
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
					this.assertAssignable(
						base.elem,
						vt,
						elem.value,
						"array or slice literal",
						undefined,
						true,
					);
				}
			} else {
				const et = this.checkExpr(elem, scope);
				this.assertAssignable(
					base.elem,
					et,
					elem,
					"array or slice literal",
					undefined,
					true,
				);
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
		const seenKeys = [];
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
				this.assertAssignable(base.key, kt, elem.key, "map literal");
				if (this._isDuplicateConst(seenKeys, elem.key, base.key, true))
					this.err(
						`duplicate key ${constValueText(elem.key._const) ?? exprText(elem.key)} in map literal`,
						elem.key,
					);
				this._markIfaceKey(base, elem.key, kt);
				this.assertAssignable(
					base.value,
					vt,
					elem.value,
					"map literal",
					undefined,
					true,
				);
			}
		}
		return t;
	},
};

// The universe constants, as the literal each stands for.
const UNIVERSE_LITERALS = {
	true: { litKind: "BOOL", value: "true" },
	false: { litKind: "BOOL", value: "false" },
	nil: { litKind: "NIL", value: "null" },
};

// Predeclared identifiers that are not variables.
const BUILTIN_IDENTS = new Set([
	...Object.keys(BUILTIN_CHECK),
	"nil",
	"true",
	"false",
	"iota",
]);

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
