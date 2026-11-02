// src/backend/wasm/stdlib/core.js
// FunctionEmitter mixin: core stdlib packages implemented natively (math,
// maps, slices, strings, strconv, fmt, errors, sort, unicode/utf8,
// testing) plus the runtime helper bodies they rely on.

import { wrappedErrorfIndices } from "../../shared/errorf.js";
import {
	fmtDescHasFloat,
	fmtDescIsSeq,
	fmtTypeDesc,
	fmtWantsTypes,
} from "../../shared/fmt-types.js";
import {
	ERROR_STRUCT,
	getMapKeyValTypes,
	getSliceElemType,
	goTypeKey,
	isAnyType,
	isArrayType,
	isBoolGoType,
	isComplex,
	isComplex64,
	isErrorType,
	isFuncType,
	isMapType,
	isNonEmptyInterface,
	isPointerToStruct,
	isSigned,
	isSliceType,
	isStructType,
	isUnhashableGoType,
	toWasmType,
	WRAP_ERRORS_STRUCT,
} from "../types.js";

function _isPointerKind(t) {
	return (
		t?.kind === "pointer" || t?.kind === "PointerType" || t?.kind === "StarExpr"
	);
}

// Whether `sig` is `Error() string` / `String() string` and in the method set
// of the operand (a pointer receiver needs a pointer operand).
function _isFmtMethodSig(sig, isPtr) {
	if (!sig || sig.params?.length || sig.variadic) return false;
	if (sig._ptrRecv && !isPtr) return false;
	const ret = sig.returns ?? [];
	return ret.length === 1 && ret[0]?.name === "string";
}

function _isUint32(goType) {
	let t = goType;
	while (t && (t.kind === "named" || t.kind === "TypeName") && t.underlying) {
		t = t.underlying;
	}
	return t?.name === "uint32";
}

function _isSimplePrimitive(t) {
	const n = t?.name ?? t;
	return n === "string" || n === "bool";
}

function _getStructOrComplexInfo(mod, emitter, goType) {
	if (isComplex(goType)) {
		const is64 = isComplex64(goType);
		return mod.getComplexType(is64 ? "complex64" : "complex128");
	}
	return (
		emitter._resolveStructInfo({ _type: goType }) ??
		(goType?.name ? mod.getStructType(goType.name) : null)
	);
}

// `unicode/utf8` package constants.
const UTF8_CONSTS = {
	RuneError: 0xfffd,
	MaxRune: 0x10ffff,
	UTFMax: 4,
	RuneSelf: 0x80,
};

// Go `math` package constants; BigInt entries are integer-typed.  Float
// literals are the shortest decimal that round-trips to Go's float64 value.
const MATH_CONSTS = {
	E: Math.E,
	Pi: Math.PI,
	Phi: 1.618033988749895,
	Sqrt2: Math.SQRT2,
	SqrtE: 1.6487212707001282,
	SqrtPi: 1.7724538509055159,
	SqrtPhi: 1.272019649514069,
	Ln2: Math.LN2,
	Log2E: Math.LOG2E,
	Ln10: Math.LN10,
	Log10E: Math.LOG10E,
	MaxFloat32: 3.4028234663852886e38,
	SmallestNonzeroFloat32: 1.401298464324817e-45,
	MaxFloat64: Number.MAX_VALUE,
	SmallestNonzeroFloat64: Number.MIN_VALUE,
	MaxInt: 9223372036854775807n,
	MinInt: -9223372036854775808n,
	MaxInt8: 127n,
	MinInt8: -128n,
	MaxInt16: 32767n,
	MinInt16: -32768n,
	MaxInt32: 2147483647n,
	MinInt32: -2147483648n,
	MaxInt64: 9223372036854775807n,
	MinInt64: -9223372036854775808n,
	MaxUint8: 255n,
	MaxUint16: 65535n,
	MaxUint32: 4294967295n,
	MaxUint: 18446744073709551615n,
	MaxUint64: 18446744073709551615n,
};

// `math` functions that map 1:1 onto a single-operand f64 instruction.
const MATH_F64_UNARY = {
	Sqrt: "f64.sqrt",
	Floor: "f64.floor",
	Ceil: "f64.ceil",
	Trunc: "f64.trunc",
	Abs: "f64.abs",
};

// Imported `Math.*` functions taking two f64 operands.
export const BINARY_MATH_IMPORTS = new Set(["atan2", "pow", "mod", "hypot"]);

export class StdlibCoreEmitter {
	_isMathConst(expr) {
		return (
			this._isPkgExpr(expr, "math") && MATH_CONSTS[expr.field] !== undefined
		);
	}

	_isUtf8Const(expr) {
		return (
			this._isPkgExpr(expr, "utf8") && UTF8_CONSTS[expr.field] !== undefined
		);
	}

	emitUtf8Const(name, targetWasmType) {
		const v = UTF8_CONSTS[name];
		if ((targetWasmType ?? "i32") === "i64") {
			this.pushInstruction({ op: "i64.const", value: BigInt(v) });
		} else {
			this.pushInstruction({ op: "i32.const", value: v });
		}
	}

	emitMathConst(name, targetWasmType) {
		const v = MATH_CONSTS[name];
		const wType = targetWasmType ?? (typeof v === "bigint" ? "i64" : "f64");
		switch (wType) {
			case "i32":
				this.pushInstruction({ op: "i32.const", value: Number(v) | 0 });
				return;
			case "i64":
				this.pushInstruction({
					op: "i64.const",
					value: BigInt.asIntN(
						64,
						typeof v === "bigint" ? v : BigInt(Math.trunc(v)),
					),
				});
				return;
			case "f32":
				this.pushInstruction({
					op: "f32.const",
					value: Math.fround(Number(v)),
				});
				return;
			default:
				this.pushInstruction({ op: "f64.const", value: Number(v) });
		}
	}

	_isStrconvConst(expr) {
		return (
			this._isPkgExpr(expr, "strconv") &&
			(expr.field === "ErrSyntax" || expr.field === "ErrRange")
		);
	}

	_emitLazyErrorGlobal(gIdx, msg) {
		this.pushInstruction({ op: "global.get", index: gIdx });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		const strIdx = this.mod.internString(msg);
		this.pushInstruction({ op: "i32.const", value: strIdx });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
		this.pushInstruction({ op: "global.set", index: gIdx });
		this.pushInstruction("end");
		this.pushInstruction({ op: "global.get", index: gIdx });
	}

	emitStrconvConst(field, _targetWasmType) {
		this._emitLazyErrorGlobal(
			this.mod.getStrconvErrGlobalIndex(field),
			field === "ErrRange" ? "value out of range" : "invalid syntax",
		);
	}

	emitMathCall(name, args) {
		// Native WASM instructions
		const unaryOp = MATH_F64_UNARY[name];
		if (unaryOp) {
			this.emitExpr(args[0], "f64");
			this.pushInstruction(unaryOp);
			return;
		}
		switch (name) {
			case "Min":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.min");
				return;
			case "Max":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.max");
				return;
			case "Copysign":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.copysign");
				return;
			case "Dim":
				// max(x-y, 0)
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.sub");
				this.pushInstruction({ op: "f64.const", value: 0 });
				this.pushInstruction("f64.max");
				return;
			case "Remainder": {
				const xTmp = this.acquireTemp("f64");
				const yTmp = this.acquireTemp("f64");
				this.emitExpr(args[0], "f64");
				this.pushInstruction({ op: "local.set", index: xTmp });
				this.emitExpr(args[1], "f64");
				this.pushInstruction({ op: "local.set", index: yTmp });

				// If y is +-Inf and x is finite, return x
				this.pushInstruction({ op: "local.get", index: yTmp });
				this.pushInstruction("f64.abs");
				this.pushInstruction({ op: "f64.const", value: Infinity });
				this.pushInstruction("f64.eq");
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction("f64.eq"); // x is not NaN
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction("f64.abs");
				this.pushInstruction({ op: "f64.const", value: Infinity });
				this.pushInstruction("f64.ne"); // x is not Inf
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "f64" });
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction("else");

				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction({ op: "local.get", index: yTmp });
				this.pushInstruction("f64.div");
				this.pushInstruction("f64.nearest");
				this.pushInstruction({ op: "local.get", index: yTmp });
				this.pushInstruction("f64.mul");
				this.pushInstruction("f64.sub");
				this.pushInstruction("end");

				this.releaseTemp(yTmp, "f64");
				this.releaseTemp(xTmp, "f64");
				return;
			}
			case "Signbit":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("i64.reinterpret_f64");
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.lt_s");
				return;
			case "Exp2":
				this.pushInstruction({ op: "f64.const", value: 2 });
				this.emitExpr(args[0], "f64");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getMathImportIndex("pow", true),
				});
				return;
			case "Inf":
				// Go: Inf(sign) is +Inf when sign >= 0; copysign with the converted
				// sign gives exactly that (0 converts to +0.0).
				this.pushInstruction({ op: "f64.const", value: Infinity });
				this.emitExpr(args[0], "i64");
				this.pushInstruction("f64.convert_i64_s");
				this.pushInstruction("f64.copysign");
				return;
			case "NaN":
				this.pushInstruction({ op: "f64.const", value: NaN });
				return;
			case "IsNaN": {
				const tmp = this.acquireTemp("f64");
				this.emitExpr(args[0], "f64");
				this.pushInstruction({ op: "local.tee", index: tmp });
				this.pushInstruction({ op: "local.get", index: tmp });
				this.pushInstruction("f64.ne");
				this.releaseTemp(tmp, "f64");
				return;
			}
			case "IsInf": {
				// IsInf(f, sign): sign > 0 → f == +Inf, sign < 0 → f == -Inf, else |f| == Inf.
				const f = this.acquireTemp("f64");
				const s = this.acquireTemp("i64");
				this.emitExpr(args[0], "f64");
				this.pushInstruction({ op: "local.set", index: f });
				this.emitExpr(args[1], "i64");
				this.pushInstruction({ op: "local.set", index: s });
				// (s >= 0 && f == +Inf) || (s <= 0 && f == -Inf)
				this.pushInstruction({ op: "local.get", index: s });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.ge_s");
				this.pushInstruction({ op: "local.get", index: f });
				this.pushInstruction({ op: "f64.const", value: Infinity });
				this.pushInstruction("f64.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "local.get", index: s });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.le_s");
				this.pushInstruction({ op: "local.get", index: f });
				this.pushInstruction({ op: "f64.const", value: -Infinity });
				this.pushInstruction("f64.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction("i32.or");
				this.releaseTemp(s, "i64");
				this.releaseTemp(f, "f64");
				return;
			}
			case "Float64bits":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("i64.reinterpret_f64");
				return;
			case "Float64frombits":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("f64.reinterpret_i64");
				return;
			case "Float32bits":
				this.emitExpr(args[0], "f32");
				this.pushInstruction("i32.reinterpret_f32");
				return;
			case "Float32frombits":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("f32.reinterpret_i32");
				return;
		}

		// Imported JS Math functions
		const jsMathMap = {
			Sin: "sin",
			Cos: "cos",
			Tan: "tan",
			Asin: "asin",
			Acos: "acos",
			Atan: "atan",
			Atan2: "atan2",
			Pow: "pow",
			Mod: "mod",
			Hypot: "hypot",
			Cbrt: "cbrt",
			Exp: "exp",
			Log: "log",
			Log1p: "log1p",
			Log2: "log2",
			Log10: "log10",
			Expm1: "expm1",
			Round: "round",
			Sinh: "sinh",
			Cosh: "cosh",
			Tanh: "tanh",
		};

		if (jsMathMap[name]) {
			const jsName = jsMathMap[name];
			const isBinary = BINARY_MATH_IMPORTS.has(jsName);
			this.emitExpr(args[0], "f64");
			if (isBinary) this.emitExpr(args[1], "f64");
			const funcIdx = this.mod.getMathImportIndex(jsName, isBinary);
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			return;
		}

		throw new Error(`Unsupported math function: math.${name}`);
	}

	// `t.Method(args...)` on a `*testing.T`: the receiver is a JS object held
	// as externref.  Arguments are pushed to a JS-side buffer one at a time
	// (typed imports), then `testing_call(t, nameIdx)` dispatches by name.
	emitTestingCall(func, args) {
		const method = func.field;
		const nameIdx = this.mod.internString(method);
		if (method === "Run" && args.length > 0) {
			this.emitExpr(func.expr, "externref");
			this.emitExpr(args[0], "externref");
			this.emitExpr(args[1], "anyref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStdlibImportIndex("testing_run"),
			});
			return;
		}
		if (method === "Cleanup") {
			this.emitExpr(func.expr, "externref");
			this.emitExpr(args[0], "anyref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStdlibImportIndex("testing_cleanup"),
			});
			return;
		}
		if (method === "Name") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingNameImportIndex(),
			});
			return;
		}
		if (method === "Loop") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({ op: "i32.const", value: nameIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingFlagImportIndex(),
			});
			return;
		}
		if (method === "Run" && args.length === 0) {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({ op: "i32.const", value: nameIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingFlagImportIndex(),
			});
			this.pushInstruction("i64.extend_i32_s");
			return;
		}
		if (method === "Elapsed") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStdlibImportIndex("testing_elapsed"),
			});
			return;
		}
		if (method === "Context") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStdlibImportIndex("testing_context"),
			});
			this.pushInstruction("any.convert_extern");
			return;
		}
		if (method === "Output") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStdlibImportIndex("testing_output"),
			});
			this.pushInstruction("any.convert_extern");
			return;
		}
		if (method === "Deadline") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction("drop");
			const timeType = this.mod.checker?.types?.get("time.Time");
			const timeWType = this.toWasmType(timeType);
			this.emitZeroValue(timeType, timeWType);
			this.pushInstruction({ op: "i32.const", value: 0 });
			return;
		}
		if (method === "Failed" || method === "Skipped") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({ op: "i32.const", value: nameIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingFlagImportIndex(),
			});
			return;
		}
		const temps = this._emitArgBuffer(args);
		this.emitExpr(func.expr, "externref");
		this.pushInstruction({ op: "i32.const", value: nameIdx });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getTestingCallImportIndex(),
		});
		this._releaseArgBuffer(temps);
	}

	// Evaluates every argument into a temp first, then pushes them in order via
	// the typed `testing_arg_*` imports.  Anything that may run user code (the
	// argument itself, or `Error()` on an `error` operand) happens in the first
	// phase: such code can call Sprintf and reset the JS-side argument buffer,
	_isCompositeGoType(goType) {
		if (!goType || _isSimplePrimitive(goType)) return false;
		if (isErrorType(goType) && this.mod.hasErrorType) return false;
		return (
			isComplex(goType) ||
			toWasmType(goType, this.mod.checker, this.mod) === "v128" ||
			isSliceType(goType, this.mod.checker) ||
			isArrayType(goType, this.mod.checker) ||
			isMapType(goType, this.mod.checker) ||
			isStructType(goType, this.mod.checker, this.mod) ||
			isPointerToStruct(goType, this.mod.checker, this.mod) ||
			_isPointerKind(goType)
		);
	}

	_isFmtExternOperand(goType) {
		const name = goType?.name;
		if (name === "time.Duration") {
			return true;
		}
		return (
			isFuncType(goType, this.mod.checker) ||
			isAnyType(goType, this.mod.checker) ||
			this._isCompositeGoType(goType) ||
			this._fmtMethodOf(goType) !== null
		);
	}

	// Pushes `arg` as the externref the fmt host helpers format.
	_emitOperandExternref(arg, goType, allowNil = false) {
		if (goType?.name === "time.Duration") {
			// The raw count stays available for %d; %v and %s use the string.
			const durTmp = this.acquireTemp("i64");
			this.emitExpr(arg, "i64");
			this.pushInstruction({ op: "local.set", index: durTmp });
			this.pushInstruction({ op: "local.get", index: durTmp });
			this._emitToExternrefPlain({ kind: "basic", name: "int64" });
			this.pushInstruction({ op: "local.get", index: durTmp });
			this._callStdlib("time_duration_string");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtNewStringerIndex(),
			});
			this.releaseTemp(durTmp, "i64");
			return;
		}
		if (isAnyType(goType, this.mod.checker)) {
			this.emitExpr(arg, "anyref");
			this._emitAnyToExternref();
			return;
		}
		if (isFuncType(goType, this.mod.checker)) {
			// A func value has no address in WebAssembly: a nil one prints
			// <nil>, any other prints a fixed address-style text.
			this.emitExpr(arg, toWasmType(goType, this.mod.checker, this.mod));
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "externref" });
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
			this.pushInstruction("else");
			this.pushInstruction({
				op: "i32.const",
				value: this.mod.internString("0x1"),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			this.pushInstruction("end");
			return;
		}
		this.emitExpr(arg, toWasmType(goType, this.mod.checker, this.mod));
		this.emitToExternref(goType, false, new Set(), allowNil);
	}

	// Turns the `any` on the stack into the externref the fmt host helpers
	// format: strings pass through, scalars are boxed by their dynamic type,
	// anything else (and nil) becomes a null externref.
	_emitAnyToExternref() {
		const helper = this.mod.resolveFuncIndex("__any_fmt");
		if (helper !== null && helper !== undefined) {
			this.pushInstruction({ op: "call", funcIndex: helper });
			return;
		}
		this._emitAnyScalarsToExternref();
	}

	_emitAnyScalarsToExternref() {
		const tmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "local.set", index: tmp });
		const kinds = [
			"string",
			"bool",
			"int",
			"int8",
			"int16",
			"int32",
			"int64",
			"uint",
			"uint8",
			"uint16",
			"uint32",
			"uint64",
			"float32",
			"float64",
		];
		for (const name of kinds) {
			const t = { kind: "basic", name };
			this.pushInstruction({ op: "local.get", index: tmp });
			this._emitTypeTest(t);
			this.pushInstruction({ op: "if", blockType: "externref" });
			this.pushInstruction({ op: "local.get", index: tmp });
			this._emitTypeCast(t, toWasmType(t, this.mod.checker, this.mod));
			this.emitToExternref(t, false);
			this.pushInstruction("else");
		}
		this.pushInstruction({ op: "ref.null", heapType: "extern" });
		for (let i = 0; i < kinds.length; i++) this.pushInstruction("end");
		this.releaseTemp(tmp, "anyref");
	}

	_emitScalarToExternref(goType, valTmp, valW) {
		if (goType?.name === "string" || goType === "string") {
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.releaseTemp(valTmp, valW);
			return true;
		}
		if (isBoolGoType(goType) || goType === "bool") {
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtBoxBoolIndex(),
			});
			this.releaseTemp(valTmp, valW);
			return true;
		}
		if (isErrorType(goType) && this.mod.hasErrorType) {
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__error_str"),
			});
			this.releaseTemp(valTmp, valW);
			return true;
		}
		if ((valW === "i32" || valW === "i64") && !isSigned(goType)) {
			// Unsigned operands are widened (uint32) or reinterpreted by the
			// host (uint64), so the top bit is not read as a sign.
			this.pushInstruction({ op: "local.get", index: valTmp });
			if (valW === "i32") {
				if (_isUint32(goType)) {
					this.pushInstruction("i64.extend_i32_u");
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getFmtBoxI64Index(),
					});
				} else {
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getFmtBoxI32Index(),
					});
				}
			} else {
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getFmtBoxU64Index(),
				});
			}
			this.releaseTemp(valTmp, valW);
			return true;
		}
		if (valW === "i32" || valW === "i64") {
			this.pushInstruction({ op: "local.get", index: valTmp });
			const funcIndex =
				valW === "i32"
					? this.mod.getFmtBoxI32Index()
					: this.mod.getFmtBoxI64Index();
			this.pushInstruction({ op: "call", funcIndex });
			this.releaseTemp(valTmp, valW);
			return true;
		}
		if (valW === "f32" || valW === "f64") {
			this.pushInstruction({ op: "local.get", index: valTmp });
			if (valW === "f32") this.pushInstruction("f64.promote_f32");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtBoxF64Index(),
			});
			this.releaseTemp(valTmp, valW);
			return true;
		}
		return false;
	}

	_emitSliceToExternref(
		goType,
		valTmp,
		valW,
		inCycle,
		nextSeen,
		allowNil = false,
	) {
		const elemGoType = this._getSliceElemType(goType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = this.mod.getArrayType(elemGoType);
		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const resTmp = this.acquireTemp("externref");
		const arrTmp = this.acquireTemp(arrWType);
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const idxTmp = this.acquireTemp("i32");

		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewArrayIndex(),
		});
		this.pushInstruction({ op: "local.set", index: resTmp });

		if (inCycle) {
			this.pushInstruction({ op: "local.get", index: resTmp });
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrWType);
			this.releaseTemp(resTmp, "externref");
			this.releaseTemp(valTmp, valW);
			return;
		}

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		if (allowNil) {
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
			this.pushInstruction({ op: "local.set", index: resTmp });
		}
		this.pushInstruction("else");

		this._emitSliceUnpack(valTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

		if (allowNil) {
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
			this.pushInstruction({ op: "local.set", index: resTmp });
			this.pushInstruction("end");
		}

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({
			op: "array.get",
			typeIndex: arrInfo.typeIndex,
		});

		this.emitToExternref(elemGoType, true, nextSeen);

		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtArrayPushIndex(),
		});

		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.releaseTemp(idxTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, arrWType);
		this.releaseTemp(resTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	// F32x4 and Mask32x4 print like a [4]float32 / [4]bool array.
	_emitSimdToExternref(goType, valTmp, valW) {
		const isMask =
			goType?.name === "simd.Mask32x4" ||
			goType?.simd === "Mask32x4" ||
			goType?.underlying?.simd === "Mask32x4";
		const resTmp = this.acquireTemp("externref");
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewArrayIndex(),
		});
		this.pushInstruction({ op: "local.set", index: resTmp });
		for (let lane = 0; lane < 4; lane++) {
			this.pushInstruction({ op: "local.get", index: resTmp });
			this.pushInstruction({ op: "local.get", index: valTmp });
			if (isMask) {
				this.pushInstruction({ op: "i32x4.extract_lane", lane });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.ne");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getFmtBoxBoolIndex(),
				});
			} else {
				this.pushInstruction({ op: "f32x4.extract_lane", lane });
				this.pushInstruction("f64.promote_f32");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getFmtBoxF64Index(),
				});
			}
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtArrayPushIndex(),
			});
		}
		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	_emitArrayToExternref(goType, valTmp, valW, inCycle, nextSeen) {
		const elemGoType = this._getArrayElemType(goType);
		const arrInfo = this.mod.getArrayType(elemGoType);
		const resTmp = this.acquireTemp("externref");
		const lenTmp = this.acquireTemp("i32");
		const idxTmp = this.acquireTemp("i32");

		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewArrayIndex(),
		});
		this.pushInstruction({ op: "local.set", index: resTmp });

		if (inCycle) {
			this.pushInstruction({ op: "local.get", index: resTmp });
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(resTmp, "externref");
			this.releaseTemp(valTmp, valW);
			return;
		}

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "ref.null", heapType: "extern" });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("array.len");
		this.pushInstruction({ op: "local.set", index: lenTmp });

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({
			op: "array.get",
			typeIndex: arrInfo.typeIndex,
		});

		this.emitToExternref(elemGoType, true, nextSeen);

		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtArrayPushIndex(),
		});

		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.releaseTemp(idxTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(resTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	_emitMapToExternref(
		goType,
		valTmp,
		valW,
		inCycle,
		nextSeen,
		allowNil = false,
	) {
		const { keyType, valType } = getMapKeyValTypes(goType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);
		const resTmp = this.acquireTemp("externref");
		const currIdxTmp = this.acquireTemp("i32");
		const entryTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});

		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewMapIndex(),
		});
		this.pushInstruction({ op: "local.set", index: resTmp });

		if (inCycle) {
			this.pushInstruction({ op: "local.get", index: resTmp });
			this.releaseTemp(entryTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: mapInfo.entryTypeIndex,
			});
			this.releaseTemp(currIdxTmp, "i32");
			this.releaseTemp(resTmp, "externref");
			this.releaseTemp(valTmp, valW);
			return;
		}

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		if (allowNil) {
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
			this.pushInstruction({ op: "local.set", index: resTmp });
		}
		this.pushInstruction("else");

		// currIdx = map.head (field 5)
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: currIdxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: currIdxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: currIdxTmp });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.emitToExternref(keyType, true, nextSeen);

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.emitToExternref(valType, true, nextSeen);

		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtMapSetIndex(),
		});

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: currIdxTmp });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.releaseTemp(entryTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.releaseTemp(currIdxTmp, "i32");
		this.releaseTemp(resTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	_emitScalarPtrToExternref(valTmp, valW) {
		const resTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "ref.null", heapType: "extern" });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction("else");
		// Kind 2 is a pointer to a scalar: the host keeps one box per target,
		// so the same pointer formatted twice (%p) gets the same id.
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewStructIndex(),
		});
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	_emitStructToExternref(
		goType,
		valTmp,
		valW,
		isPtr,
		isNested,
		inCycle,
		nextSeen,
	) {
		const structInfo = _getStructOrComplexInfo(this.mod, this, goType);
		const resTmp = this.acquireTemp("externref");

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		if (isPtr) {
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
			this.pushInstruction({ op: "local.set", index: resTmp });
		} else {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtNewStructIndex(),
			});
			this.pushInstruction({ op: "local.set", index: resTmp });
		}
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({ op: "i32.const", value: isPtr ? 1 : 0 });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewStructIndex(),
		});
		this.pushInstruction({ op: "local.set", index: resTmp });
		// The Go type name, for `%T` and `%#v` of an `any` holding the struct.
		const tdesc = fmtTypeDesc(
			isPtr ? (goType.base ?? goType.elem) : goType,
			(t) => this.mod.checker?.resolveType?.(t) ?? t,
		);
		if (tdesc?.k === "struct" && tdesc.n) {
			this.pushInstruction({ op: "local.get", index: resTmp });
			this.pushInstruction({
				op: "i32.const",
				value: this.mod.internString(tdesc.n),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtStructTypeImportIndex(),
			});
		}

		if ((!isPtr || !isNested) && !inCycle && structInfo?.fields) {
			for (let i = 0; i < structInfo.fields.length; i++) {
				const f = structInfo.fields[i];
				const fieldIndex =
					structInfo.fieldIndexMap?.get(f.name) ?? f.fieldIndex ?? i;
				this.pushInstruction({ op: "local.get", index: resTmp });
				const strIdx = this.mod.internString(f.name);
				this.pushInstruction({ op: "i32.const", value: strIdx });

				this.pushInstruction({ op: "local.get", index: valTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: structInfo.typeIndex,
					fieldIndex,
				});

				this.emitToExternref(f.goType, true, nextSeen);

				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getFmtStructSetIndex(),
				});
			}
		}

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.releaseTemp(resTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	// The `String() string` / `Error() string` method fmt calls on a value of
	// static type `goType` (Error first, as in Go), or null.  A pointer-receiver
	// method applies to pointers only; interfaces are dispatched on the dynamic
	// type (`__any_fmt`).
	_fmtMethodOf(goType) {
		if (!goType || isAnyType(goType, this.mod.checker)) return null;
		const checker = this.mod.checker;
		const isPtr = _isPointerKind(goType);
		const named = this._fmtNamed(isPtr ? (goType.base ?? goType.elem) : goType);
		if (
			!named ||
			named.name === ERROR_STRUCT ||
			named.name === WRAP_ERRORS_STRUCT
		)
			return null;
		// Elements of an `any`-held container share a wasm type across Go types
		// (`[]Color` and `[]int`), so scalar-backed named types are not dispatched.
		if (
			this._fmtNoScalarMethods &&
			!isPtr &&
			!isStructType(goType, checker, this.mod)
		)
			return null;
		// Linked projects use a stub checker (no `implements`), so look the
		// method up on the named type directly.
		const methodMap = this._fmtMethodMap(named);
		for (const method of ["Error", "String"]) {
			const sig = methodMap?.get(method);
			if (!_isFmtMethodSig(sig, isPtr)) continue;
			const found = this._fmtMethodFunc(named, method);
			if (found) return { method, isPtr, ...found };
		}
		return null;
	}

	// The named type behind `t` (type names resolve through the checker), or null.
	_fmtNamed(t) {
		if (t?.kind === "TypeName" || t?.kind === "Ident")
			t = this.mod.checker?.types?.get(t.name) ?? t;
		return t?.kind === "named" && t.name ? t : null;
	}

	_fmtMethodMap(named) {
		const resolved = this.mod.checker?.types?.get(named.name) ?? named;
		const under = resolved?.kind === "named" ? resolved.underlying : resolved;
		if (under?.kind === "interface") return null;
		return resolved?.methods?.size
			? resolved.methods
			: (under?.methods ?? null);
	}

	_fmtMethodFunc(named, method) {
		const names = [`${named.name}.${method}`];
		if (named.pkg) names.unshift(`${named.pkg}.${named.name}.${method}`);
		for (const n of names) {
			const funcIndex = this.mod.resolveFuncIndex(n);
			if (funcIndex === null || funcIndex === undefined) continue;
			const recv = this.mod.getFuncParamGoTypes(n)[0];
			return { funcIndex, valueRecv: !_isPointerKind(recv) };
		}
		return null;
	}

	// A struct that embeds `error` and declares no Error/String itself prints
	// the embedded error's text (the checker does not promote interface
	// methods, so only fmt sees this).
	_fmtEmbeddedError(goType) {
		if (!this.mod.hasErrorType) return null;
		let t = _isPointerKind(goType) ? (goType.base ?? goType.elem) : goType;
		if (t?.kind === "TypeName" || t?.kind === "Ident")
			t = this.mod.checker?.types?.get(t.name) ?? t;
		if (
			t?.kind !== "named" ||
			t.name === ERROR_STRUCT ||
			t.name === WRAP_ERRORS_STRUCT
		)
			return null;
		const sInfo = this.mod.getStructType(t.name);
		const field = sInfo?.fields?.find(
			(f) => f.embedded && isErrorType(f.goType),
		);
		if (!field) return null;
		return {
			typeIndex: sInfo.typeIndex,
			fieldIndex: sInfo.fieldIndexMap.get(field.name),
		};
	}

	_emitEmbeddedErrorToExternref(goType, emb, isNested, seen) {
		const valW = toWasmType(goType, this.mod.checker, this.mod);
		const valTmp = this.acquireTemp(valW);
		const rawTmp = this.acquireTemp("externref");
		const errTmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "local.tee", index: valTmp });
		this._emitToExternrefPlain(goType, isNested, seen);
		this.pushInstruction({ op: "local.set", index: rawTmp });
		// nil struct pointer or nil embedded error: print the struct as is.
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "externref" });
		this.pushInstruction({ op: "local.get", index: rawTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: emb.typeIndex,
			fieldIndex: emb.fieldIndex,
		});
		this.pushInstruction({ op: "local.tee", index: errTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "externref" });
		this.pushInstruction({ op: "local.get", index: rawTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: rawTmp });
		this.pushInstruction({ op: "local.get", index: errTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__error_str"),
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewStringerIndex(),
		});
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(errTmp, "anyref");
		this.releaseTemp(rawTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	emitToExternref(
		goType,
		isNested = false,
		seen = new Set(),
		allowNil = false,
	) {
		const m = this._fmtMethodOf(goType);
		if (!m) {
			const emb = this._fmtEmbeddedError(goType);
			if (emb) {
				this._emitEmbeddedErrorToExternref(goType, emb, isNested, seen);
				return;
			}
			this._emitToExternrefPlain(goType, isNested, seen, allowNil);
			return;
		}
		const valW = toWasmType(goType, this.mod.checker, this.mod);
		const valTmp = this.acquireTemp(valW);
		const rawTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.tee", index: valTmp });
		this._emitToExternrefPlain(goType, isNested, seen, allowNil);
		this.pushInstruction({ op: "local.set", index: rawTmp });
		const nilGuard = m.isPtr && m.valueRecv;
		if (nilGuard) {
			// A nil pointer with a value receiver prints <nil>.
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "externref" });
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
			this.pushInstruction("else");
		}
		this.pushInstruction({ op: "local.get", index: rawTmp });
		this.pushInstruction({ op: "local.get", index: valTmp });
		if (nilGuard && !isPointerToStruct(goType, this.mod.checker, this.mod)) {
			// A pointer to a scalar is a box; the value receiver takes the scalar.
			const box = this.mod.getBoxType(goType.base ?? goType.elem);
			this.pushInstruction({
				op: "ref.cast",
				typeIndex: box.typeIndex,
				typeName: box.name,
			});
			this.pushInstruction({
				op: "struct.get",
				typeIndex: box.typeIndex,
				typeName: box.name,
				fieldIndex: 0,
			});
		}
		this.pushInstruction({ op: "call", funcIndex: m.funcIndex });
		this.pushInstruction({
			op: "i32.const",
			value: m.method === "Error" ? 1 : 0,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewStringerIndex(),
		});
		if (nilGuard) this.pushInstruction("end");
		this.releaseTemp(rawTmp, "externref");
		this.releaseTemp(valTmp, valW);
	}

	_emitToExternrefPlain(
		goType,
		isNested = false,
		seen = new Set(),
		allowNil = false,
	) {
		const valW = toWasmType(goType, this.mod.checker, this.mod);
		const valTmp = this.acquireTemp(valW);
		this.pushInstruction({ op: "local.set", index: valTmp });

		if (isAnyType(goType, this.mod.checker)) {
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.releaseTemp(valTmp, valW);
			this._emitAnyToExternref();
			return;
		}

		if (this._emitScalarToExternref(goType, valTmp, valW)) return;

		if (valW === "v128") {
			this._emitSimdToExternref(goType, valTmp, valW);
			return;
		}

		const tKey = goType ? goTypeKey(goType) : null;
		const inCycle = tKey !== null && seen.has(tKey);
		const nextSeen = tKey !== null ? new Set(seen).add(tKey) : seen;

		if (isSliceType(goType, this.mod.checker)) {
			this._emitSliceToExternref(
				goType,
				valTmp,
				valW,
				inCycle,
				nextSeen,
				allowNil,
			);
			return;
		}

		if (isArrayType(goType, this.mod.checker)) {
			this._emitArrayToExternref(goType, valTmp, valW, inCycle, nextSeen);
			return;
		}

		if (isMapType(goType, this.mod.checker)) {
			this._emitMapToExternref(
				goType,
				valTmp,
				valW,
				inCycle,
				nextSeen,
				allowNil,
			);
			return;
		}

		const isStructPtr = isPointerToStruct(goType, this.mod.checker, this.mod);
		const isStruct =
			isStructType(goType, this.mod.checker, this.mod) ||
			isStructPtr ||
			isComplex(goType);
		const isScalarPtr = !isStructPtr && _isPointerKind(goType);

		if (isScalarPtr) {
			this._emitScalarPtrToExternref(valTmp, valW);
			return;
		}

		if (isStruct) {
			this._emitStructToExternref(
				goType,
				valTmp,
				valW,
				isStructPtr,
				isNested,
				inCycle,
				nextSeen,
			);
			return;
		}

		if (valW !== "externref") {
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
		} else {
			this.pushInstruction({ op: "local.get", index: valTmp });
		}
		this.releaseTemp(valTmp, valW);
	}

	// `xs...` (xs []any: the host appends each element) and a bare `nil`
	// operand; returns the buffer entry, or null for an ordinary operand.
	_emitSpecialFmtOperand(arg, goType) {
		const spread = arg._spread && isSliceType(goType, this.mod.checker);
		const isNil =
			(arg.kind === "Ident" && arg.name === "nil") ||
			goType?.name === "nil" ||
			goType?.kind === "nil";
		if (!spread && !isNil) return null;
		const tmp = this.acquireTemp("externref");
		if (spread) {
			this.emitExpr(arg, toWasmType(goType, this.mod.checker, this.mod));
			this.emitToExternref(goType, false);
		} else {
			this.pushInstruction({ op: "ref.null", heapType: "extern" });
		}
		this.pushInstruction({ op: "local.set", index: tmp });
		return { tmp, wType: "externref", isBool: false, errTmp: null, spread };
	}

	// Evaluates every argument into a temp first, then pushes them in order via
	// the typed `testing_arg_*` imports.  Anything that may run user code (the
	// argument itself, or `Error()` on an `error` operand) happens in the first
	// phase: such code can call Sprintf and reset the JS-side argument buffer,
	// so nothing may be pushed until every operand is fully evaluated.
	// Returns the temps so the caller can still read an argument (fmt.Errorf's
	// %w cause keeps the original error value in `errTmp`).
	// `markErrors` (Sprint/Print/Append) pushes error operands through
	// `testing_arg_err`, so the host sees a non-string like Go does.
	// `typed` (a Printf-style call whose format needs operand types, see
	// fmtWantsTypes) tags each operand of a concrete static type with that
	// type through `fmt_arg_type`, so the host can print `%T` and `%#v`.
	_emitArgBuffer(args, markErrors = false, typed = false) {
		const temps = [];
		for (const arg of args) {
			const goType = arg._type ?? this._resolveExprGoType(arg);
			const isBool =
				isBoolGoType(goType) ||
				(arg.kind === "BasicLit" && arg.litKind === "BOOL");
			const isErr =
				this.mod.hasErrorType &&
				(isErrorType(goType) ||
					Boolean(
						this.mod.checker?.implements?.(
							goType,
							this.mod.checker?.types?.get("error"),
						),
					));
			const special = this._emitSpecialFmtOperand(arg, goType);
			if (special) {
				temps.push(special);
				continue;
			}
			const valW = toWasmType(goType, this.mod.checker, this.mod);
			if (isErr) {
				const errTmp = this.acquireTemp("anyref");
				const tmp = this.acquireTemp("externref");
				this.emitExpr(arg, "anyref");
				this.pushInstruction({ op: "local.tee", index: errTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__error_str"),
				});
				this.pushInstruction({ op: "local.set", index: tmp });
				temps.push({
					tmp,
					wType: "externref",
					isBool: false,
					errTmp,
					markErr: markErrors,
				});
				continue;
			}
			if (this._isFmtExternOperand(goType)) {
				const tmp = this.acquireTemp("externref");
				this._emitOperandExternref(arg, goType, typed);
				this.pushInstruction({ op: "local.set", index: tmp });
				temps.push({ tmp, wType: "externref", isBool: false, errTmp: null });
				continue;
			}
			// An unsigned 32-bit operand widens to i64; an unsigned 64-bit one
			// stays i64 and is reinterpreted by the host (`testing_arg_u64`), as
			// f64 cannot hold every uint64 exactly.
			let wType = valW;
			const u64 = !isSigned(goType) && valW === "i64";
			if (!isSigned(goType) && valW === "i32") wType = "i64";
			const tmp = this.acquireTemp(wType);
			this.emitExpr(arg, valW);
			if (!isSigned(goType) && valW === "i32") {
				this.pushInstruction("i64.extend_i32_u");
			}
			this.pushInstruction({ op: "local.set", index: tmp });
			temps.push({ tmp, wType, isBool, errTmp: null, u64 });
		}
		for (const [i, temp] of temps.entries()) {
			const { tmp, wType, isBool, markErr, spread, u64 } = temp;
			this.pushInstruction({ op: "local.get", index: tmp });
			let funcIndex = this.mod.getTestingArgImportIndex(wType, isBool);
			if (u64) funcIndex = this.mod.getTestingArgU64ImportIndex();
			if (markErr) funcIndex = this.mod.getTestingArgErrImportIndex();
			if (spread) funcIndex = this.mod.getTestingArgSpreadImportIndex();
			this.pushInstruction({ op: "call", funcIndex });
			if (!spread && (typed || this._fmtOperandHasFloat(args[i])))
				this._emitOperandType(args[i], temp.errTmp);
		}
		return temps;
	}

	// Operands the per-argument Println imports cannot print: spreads, a bare
	// nil, floats (static type), and unsigned 32/64-bit integers, whose
	// signedness only the argument buffer preserves.
	_fmtOperandNeedsBuffer(arg) {
		if (arg._spread || this._fmtOperandHasFloat(arg)) return true;
		const goType = arg._type ?? this._resolveExprGoType(arg);
		if (
			(arg.kind === "Ident" && arg.name === "nil") ||
			goType?.name === "nil" ||
			goType?.kind === "nil"
		) {
			return true;
		}
		if (isSigned(goType)) return false;
		const valW = toWasmType(goType, this.mod.checker, this.mod);
		return valW === "i64" || (valW === "i32" && _isUint32(goType));
	}

	// Whether the operand's static type mentions a float: those travel with
	// their type so the host prints float32 and Go's %v exponent forms.
	_fmtOperandHasFloat(arg) {
		const goType = arg._type ?? this._resolveExprGoType(arg);
		return fmtDescHasFloat(
			fmtTypeDesc(goType, (t) => this.mod.checker?.resolveType?.(t) ?? t),
		);
	}

	// An error-interface operand carries its dynamic type; any other operand
	// its static one (see _emitFmtArgType).
	_emitOperandType(arg, errTmp) {
		const goType = arg._type ?? this._resolveExprGoType(arg);
		const isIface =
			fmtTypeDesc(goType, (t) => this.mod.checker?.resolveType?.(t) ?? t)?.k ===
			"i";
		if (isIface && errTmp !== null && errTmp !== undefined) {
			this._emitErrorDynamicType(errTmp);
		} else {
			this._emitFmtArgType(arg);
		}
	}

	// Tags the operand just pushed with its static type (see _emitArgBuffer).
	// Interface-typed operands carry their dynamic type and stay untagged.
	_emitFmtArgType(arg) {
		const goType = arg._type ?? this._resolveExprGoType(arg);
		const desc = fmtTypeDesc(
			goType,
			(t) => this.mod.checker?.resolveType?.(t) ?? t,
		);
		if (!desc || desc.k === "i") return;
		this.pushInstruction({
			op: "i32.const",
			value: this.mod.internString(JSON.stringify(desc)),
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtArgTypeImportIndex(),
		});
	}

	// Tags the error operand just pushed with the type its value holds, so
	// `%T` prints `*errors.errorString` rather than the message's type.
	_emitErrorDynamicType(errTmp) {
		const checker = this.mod.checker;
		const tag = (desc) => {
			this.pushInstruction({
				op: "i32.const",
				value: this.mod.internString(JSON.stringify(desc)),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtArgTypeImportIndex(),
			});
		};
		const when = (typeIndex, body) => {
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({ op: "ref.test", typeIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			body();
			this.pushInstruction("end");
		};
		const ptrTo = (name) => ({
			k: "ptr",
			e: { k: "struct", n: name, f: [] },
		});
		const errInfo = this.mod.getStructType(ERROR_STRUCT);
		const wrapInfo = this.mod.getStructType(WRAP_ERRORS_STRUCT);
		when(wrapInfo.typeIndex, () => tag(ptrTo("fmt.wrapErrors")));
		when(errInfo.typeIndex, () => {
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({ op: "ref.cast", typeIndex: errInfo.typeIndex });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: errInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			tag(ptrTo("errors.errorString"));
			this.pushInstruction("else");
			tag(ptrTo("fmt.wrapError"));
			this.pushInstruction("end");
		});
		const errIface = checker?.types?.get("error");
		const candidates = errIface
			? this.mod.getTypesImplementingInterface(errIface)
			: [];
		for (const c of candidates) {
			const isPtr = c.name.startsWith("*");
			const base = checker.types.get(isPtr ? c.name.slice(1) : c.name);
			if (!base) continue;
			const desc = fmtTypeDesc(
				isPtr ? { kind: "pointer", base } : base,
				(t) => checker.resolveType?.(t) ?? t,
			);
			if (desc) when(c.typeIndex, () => tag(desc));
		}
	}

	// Whether a Printf-style call's operands need their static types: the
	// format must be a literal that uses `%T`, `%#v` or has surplus operands.
	_fmtNeedsTypes(format, operands) {
		if (format?.kind !== "BasicLit") return false;
		const spread = operands.some((a) => a._spread);
		const seqArgs = operands.some((a) =>
			fmtDescIsSeq(
				fmtTypeDesc(
					a._type ?? this._resolveExprGoType(a),
					(t) => this.mod.checker?.resolveType?.(t) ?? t,
				),
			),
		);
		return fmtWantsTypes(format.value, spread ? -1 : operands.length, seqArgs);
	}

	_releaseArgBuffer(temps) {
		for (let i = temps.length - 1; i >= 0; i--) {
			this.releaseTemp(temps[i].tmp, temps[i].wType);
			if (temps[i].errTmp !== null) this.releaseTemp(temps[i].errTmp, "anyref");
		}
	}

	emitSliceClear(arg, argType) {
		const elemGoType = this._getSliceElemType(argType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(arg, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const iLoc = this.acquireTemp("i32");

		this._emitSliceUnpack(sliceTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.emitZeroValue(elemGoType, arrInfo.elemWType);
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end");
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	// bytes.Clone (emitted until `bytes` moves to Go): a copy of a slice that keeps
	// nil as nil.
	emitSlicesClone(args) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(sNode, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({
			op: "if",
			blockType: {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			},
		});
		this.pushInstruction({ op: "ref.null", heapType: sliceInfo.typeIndex });
		this.pushInstruction("else");

		const lenTmp = this.acquireTemp("i32");
		const newArrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.tee", index: lenTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newArrTmp });

		// array.copy (newArr, 0, srcArr, srcOff, len)
		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this._emitArrayCopy(arrInfo, elemGoType);

		// struct.new slice (newArr, 0, len, len)
		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newArrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(lenTmp, "i32");
		this.pushInstruction("end"); // end if

		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	_callStdlib(name) {
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStdlibImportIndex(name),
		});
	}

	// Pushes an integer-ish argument as i32 (Go ints are i64 in this backend).
	_emitI32Arg(arg) {
		const wType = toWasmType(arg?._type, this.mod.checker);
		if (wType === "i64") {
			this.emitExpr(arg, "i64");
			this.pushInstruction("i32.wrap_i64");
		} else {
			this.emitExpr(arg, "i32");
		}
	}

	emitStrconvCall(name, args) {
		switch (name) {
			case "Itoa": {
				const argWType = toWasmType(args[0]?._type, this.mod.checker);
				if (argWType === "i64") {
					this.emitExpr(args[0], "i64");
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getStrFromI64ImportIndex(),
					});
				} else {
					this.emitExpr(args[0], "i32");
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getStrFromI32ImportIndex(),
					});
				}
				return;
			}
			case "FormatInt": {
				this.emitExpr(args[0], "i64");
				this._emitI32Arg(args[1]);
				this._callStdlib("strconv_format_int");
				return;
			}
			case "FormatUint": {
				this.emitExpr(args[0], "i64");
				this._emitI32Arg(args[1]);
				this._callStdlib("strconv_format_uint");
				return;
			}
			case "FormatBool": {
				// bool → "true"/"false" via the string table
				this.emitExpr(args[0], "i32");
				this.pushInstruction({ op: "if", blockType: "externref" });
				this.pushInstruction({
					op: "i32.const",
					value: this.mod.internString("true"),
				});
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringImportIndex(),
				});
				this.pushInstruction("else");
				this.pushInstruction({
					op: "i32.const",
					value: this.mod.internString("false"),
				});
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringImportIndex(),
				});
				this.pushInstruction("end");
				return;
			}
			case "FormatFloat": {
				this.emitExpr(args[0], "f64");
				this._emitI32Arg(args[1]);
				this._emitI32Arg(args[2]);
				this._emitI32Arg(args[3]);
				this._callStdlib("strconv_format_float");
				return;
			}
			case "Quote": {
				this.emitExpr(args[0], "externref");
				this._callStdlib("strconv_quote");
				return;
			}
			case "Unquote": {
				this.emitExpr(args[0], "externref");
				this._callStdlib("strconv_unquote");
				this._emitStrconvError();
				return;
			}
			case "AppendInt": {
				this.emitExpr(args[1], "i64");
				this._emitI32Arg(args[2]);
				this._callStdlib("strconv_format_int");
				const strTmp = this.acquireTemp("externref");
				this.pushInstruction({ op: "local.set", index: strTmp });
				this._emitAppendStringToByteSlice(args[0], strTmp);
				this.releaseTemp(strTmp, "externref");
				return;
			}
			case "AppendUint": {
				this.emitExpr(args[1], "i64");
				this._emitI32Arg(args[2]);
				this._callStdlib("strconv_format_uint");
				const strTmp = this.acquireTemp("externref");
				this.pushInstruction({ op: "local.set", index: strTmp });
				this._emitAppendStringToByteSlice(args[0], strTmp);
				this.releaseTemp(strTmp, "externref");
				return;
			}
			case "AppendBool": {
				this.emitStrconvCall("FormatBool", [args[1]]);
				const strTmp = this.acquireTemp("externref");
				this.pushInstruction({ op: "local.set", index: strTmp });
				this._emitAppendStringToByteSlice(args[0], strTmp);
				this.releaseTemp(strTmp, "externref");
				return;
			}
			case "AppendFloat": {
				this.emitExpr(args[1], "f64");
				this._emitI32Arg(args[2]);
				this._emitI32Arg(args[3]);
				this._emitI32Arg(args[4]);
				this._callStdlib("strconv_format_float");
				const strTmp = this.acquireTemp("externref");
				this.pushInstruction({ op: "local.set", index: strTmp });
				this._emitAppendStringToByteSlice(args[0], strTmp);
				this.releaseTemp(strTmp, "externref");
				return;
			}
			case "ParseUint": {
				const sTmp = this.acquireTemp("externref");
				this.emitExpr(args[0], "externref");
				this.pushInstruction({ op: "local.tee", index: sTmp });
				this._emitI32Arg(args[1]);
				this._emitI32Arg(args[2]);
				this._callStdlib("strconv_parse_uint");
				this._emitStrconvError("ParseUint", sTmp);
				this.releaseTemp(sTmp, "externref");
				return;
			}
			case "Atoi":
			case "ParseInt":
			case "ParseFloat":
			case "ParseBool": {
				// (value, error): the JS side records a failure message that
				// `strconv_err` returns (null on success) → runtime error value.
				const sTmp = this.acquireTemp("externref");
				this.emitExpr(args[0], "externref");
				this.pushInstruction({ op: "local.tee", index: sTmp });
				if (name === "Atoi") this._callStdlib("strconv_atoi");
				else if (name === "ParseInt") {
					this._emitI32Arg(args[1]);
					this._emitI32Arg(args[2]);
					this._callStdlib("strconv_parse_int");
				} else if (name === "ParseFloat")
					this._callStdlib("strconv_parse_float");
				else this._callStdlib("strconv_parse_bool");
				this._emitStrconvError(name, sTmp);
				this.releaseTemp(sTmp, "externref");
				return;
			}
			default:
				throw new Error(`Unsupported strconv function: strconv.${name}`);
		}
	}

	_emitStrconvError(fnName = null, sTmp = null) {
		this._callStdlib("strconv_err");
		const msgTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.set", index: msgTmp });

		this._callStdlib("strconv_err_kind");
		const kindTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.set", index: kindTmp });

		const causeTmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: causeTmp });

		this.pushInstruction({ op: "local.get", index: kindTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitStrconvConst("ErrSyntax");
		this.pushInstruction({ op: "local.set", index: causeTmp });
		this.pushInstruction({ op: "else" });
		this.pushInstruction({ op: "local.get", index: kindTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitStrconvConst("ErrRange");
		this.pushInstruction({ op: "local.set", index: causeTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		const numErrInfo =
			this.mod.getStructType("NumError$$strconv") ??
			this.mod.getStructType("strconv.NumError");

		this.pushInstruction({ op: "local.get", index: msgTmp });
		this.pushInstruction("any.convert_extern");
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "anyref" });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "else" });
		if (numErrInfo && fnName && sTmp !== null) {
			const fnStrIdx = this.mod.internString(fnName);
			this.pushInstruction({ op: "i32.const", value: fnStrIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction({ op: "local.get", index: causeTmp });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: numErrInfo.typeIndex,
			});
		} else {
			this.pushInstruction({ op: "local.get", index: msgTmp });
			this.pushInstruction({ op: "local.get", index: causeTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__mk_error"),
			});
		}
		this.pushInstruction("end");

		this.releaseTemp(causeTmp, "anyref");
		this.releaseTemp(kindTmp, "i32");
		this.releaseTemp(msgTmp, "externref");
	}

	_emitAppendStringToByteSlice(dstNode, sTmp) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const dstTmp = this.acquireTemp(sliceW);
		this.emitExpr(dstNode, sliceW);
		this.pushInstruction({ op: "local.set", index: dstTmp });

		const oldArrTmp = this.acquireTemp(arrW);
		const oldOffTmp = this.acquireTemp("i32");
		const oldLenTmp = this.acquireTemp("i32");
		const oldCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(dstTmp, sliceInfo, {
			arr: oldArrTmp,
			off: oldOffTmp,
			len: oldLenTmp,
			cap: oldCapTmp,
		});
		this.releaseTemp(dstTmp, sliceW);

		const sLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: sLenTmp });

		const newLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: oldLenTmp });
		this.pushInstruction({ op: "local.get", index: sLenTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: newLenTmp });

		const newArrTmp = this.acquireTemp(arrW);
		const newOffTmp = this.acquireTemp("i32");
		const newCapTmp = this.acquireTemp("i32");

		this._emitGrowSlice({
			arrInfo,
			elemGoType: byteGo,
			oldArrTmp,
			oldOffTmp,
			oldLenTmp,
			oldCapTmp,
			newArrTmp,
			newOffTmp,
			newLenTmp,
			newCapTmp,
		});

		const kTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: kTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: sLenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: oldLenTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");

		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringCodePointAtImportIndex(),
		});
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// struct.new sliceInfo (newArr, newOff, newLen, newCap)
		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: newLenTmp });
		this.pushInstruction({ op: "local.get", index: newCapTmp });
		this.pushInstruction({ op: "struct.new", typeIndex: sliceInfo.typeIndex });

		this.releaseTemp(kTmp, "i32");
		this.releaseTemp(newCapTmp, "i32");
		this.releaseTemp(newOffTmp, "i32");
		this.releaseTemp(newArrTmp, arrW);
		this.releaseTemp(newLenTmp, "i32");
		this.releaseTemp(sLenTmp, "i32");
		this.releaseTemp(oldCapTmp, "i32");
		this.releaseTemp(oldLenTmp, "i32");
		this.releaseTemp(oldOffTmp, "i32");
		this.releaseTemp(oldArrTmp, arrW);
	}

	emitBuilderMethodCall(method, recvExpr, args, targetWasmType) {
		const structInfo = this.mod.getStructType("strings.Builder");
		const builderW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const bTmp = this.acquireTemp(builderW);
		this.emitExpr(recvExpr, builderW);
		this.pushInstruction({ op: "local.set", index: bTmp });

		const strGo = { kind: "basic", name: "string" };
		const sliceInfo = this.mod.getSliceType(strGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		// Helper to emit copy check on write
		const emitCopyCheck = () => {
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "ref.cast", heapType: "eq" });
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction("ref.eq");
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.emitPanic(
				"strings: illegal use of non-zero Builder copied by value",
			);
			this.pushInstruction("end");
			this.pushInstruction("end");
		};

		// Helper to append a single externref string to b._buf and add sLen to b._len
		const appendString = (sValTmp, sLenValTmp) => {
			const oldSliceTmp = this.acquireTemp(sliceW);
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: oldSliceTmp });

			const oldArrTmp = this.acquireTemp(arrW);
			const oldOffTmp = this.acquireTemp("i32");
			const oldLenTmp = this.acquireTemp("i32");
			const oldCapTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(oldSliceTmp, sliceInfo, {
				arr: oldArrTmp,
				off: oldOffTmp,
				len: oldLenTmp,
				cap: oldCapTmp,
			});
			this.releaseTemp(oldSliceTmp, sliceW);

			const newArrTmp = this.acquireTemp(arrW);
			const newOffTmp = this.acquireTemp("i32");
			const newCapTmp = this.acquireTemp("i32");
			const newLenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: newLenTmp });

			this._emitGrowSlice({
				arrInfo,
				elemGoType: strGo,
				oldArrTmp,
				oldOffTmp,
				oldLenTmp,
				oldCapTmp,
				newArrTmp,
				newOffTmp,
				newLenTmp,
				newCapTmp,
			});

			this.pushInstruction({ op: "local.get", index: newArrTmp });
			this.pushInstruction({ op: "local.get", index: newOffTmp });
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: sValTmp });
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

			// b._buf = struct.new sliceInfo (newArr, newOff, newLen, newCap)
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({ op: "local.get", index: newArrTmp });
			this.pushInstruction({ op: "local.get", index: newOffTmp });
			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});

			// b._len += sLen
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.get", index: sLenValTmp });
			this.pushInstruction("i64.extend_i32_u");
			this.pushInstruction("i64.add");
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 1,
			});

			this.releaseTemp(newLenTmp, "i32");
			this.releaseTemp(newCapTmp, "i32");
			this.releaseTemp(newOffTmp, "i32");
			this.releaseTemp(newArrTmp, arrW);
			this.releaseTemp(oldCapTmp, "i32");
			this.releaseTemp(oldLenTmp, "i32");
			this.releaseTemp(oldOffTmp, "i32");
			this.releaseTemp(oldArrTmp, arrW);
		};

		switch (method) {
			case "WriteString": {
				emitCopyCheck();
				const strTmp = this.acquireTemp("externref");
				this.emitExpr(args[0], "externref");
				this.pushInstruction({ op: "local.set", index: strTmp });

				const lenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: strTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrToBytesImportIndex(),
				});
				this.pushInstruction({ op: "local.set", index: lenTmp });

				appendString(strTmp, lenTmp);

				// return (int, error) -> [i64, ref.null any]
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "ref.null", heapType: "any" });

				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(strTmp, "externref");
				this.releaseTemp(bTmp, builderW);
				return;
			}
			case "WriteByte": {
				emitCopyCheck();
				const cpTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: cpTmp });

				const strTmp = this.acquireTemp("externref");
				this.pushInstruction({ op: "local.get", index: cpTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringFromCodePointImportIndex(),
				});
				this.pushInstruction({ op: "local.set", index: strTmp });

				const oneTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction({ op: "local.set", index: oneTmp });

				appendString(strTmp, oneTmp);

				// return error -> [ref.null any]
				this.pushInstruction({ op: "ref.null", heapType: "any" });

				this.releaseTemp(oneTmp, "i32");
				this.releaseTemp(strTmp, "externref");
				this.releaseTemp(cpTmp, "i32");
				this.releaseTemp(bTmp, builderW);
				return;
			}
			case "WriteRune": {
				emitCopyCheck();
				const cpTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: cpTmp });

				const strTmp = this.acquireTemp("externref");
				this.pushInstruction({ op: "local.get", index: cpTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringFromCodePointImportIndex(),
				});
				this.pushInstruction({ op: "local.set", index: strTmp });

				// runeLen: cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
				const rLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: cpTmp });
				this.pushInstruction({ op: "i32.const", value: 128 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: cpTmp });
				this.pushInstruction({ op: "i32.const", value: 2048 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 2 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: cpTmp });
				this.pushInstruction({ op: "i32.const", value: 65536 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 3 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "i32.const", value: 4 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.set", index: rLenTmp });

				appendString(strTmp, rLenTmp);

				// return (int, error) -> [i64, ref.null any]
				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "ref.null", heapType: "any" });

				this.releaseTemp(rLenTmp, "i32");
				this.releaseTemp(strTmp, "externref");
				this.releaseTemp(cpTmp, "i32");
				this.releaseTemp(bTmp, builderW);
				return;
			}
			case "Write": {
				emitCopyCheck();
				const byteElemGo = { kind: "basic", name: "byte" };
				const byteSliceInfo = this.mod.getSliceType(byteElemGo);
				const byteSliceW = {
					kind: "ref",
					nullable: true,
					typeIndex: byteSliceInfo.typeIndex,
				};
				const byteArrW = {
					kind: "ref",
					nullable: true,
					typeIndex: byteSliceInfo.arrInfo.typeIndex,
				};

				const pTmp = this.acquireTemp(byteSliceW);
				this.emitExpr(args[0], byteSliceW);
				this.pushInstruction({ op: "local.set", index: pTmp });

				const pArrTmp = this.acquireTemp(byteArrW);
				const pOffTmp = this.acquireTemp("i32");
				const pLenTmp = this.acquireTemp("i32");
				const pCapTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(pTmp, byteSliceInfo, {
					arr: pArrTmp,
					off: pOffTmp,
					len: pLenTmp,
					cap: pCapTmp,
				});
				this.releaseTemp(pCapTmp, "i32");
				this.releaseTemp(pTmp, byteSliceW);

				// convert p bytes to externref string
				this.pushInstruction({ op: "local.get", index: pLenTmp });
				this._callStdlib("bytes_to_str_init");

				const kTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: kTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "local.get", index: pLenTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: pArrTmp });
				this.pushInstruction({ op: "local.get", index: pOffTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({
					op: "array.get",
					typeIndex: byteSliceInfo.arrInfo.typeIndex,
				});
				this._callStdlib("bytes_to_str_push");

				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: kTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				const strTmp = this.acquireTemp("externref");
				this._callStdlib("bytes_to_str_finish");
				this.pushInstruction({ op: "local.set", index: strTmp });

				appendString(strTmp, pLenTmp);

				// return (int, error) -> [i64, ref.null any]
				this.pushInstruction({ op: "local.get", index: pLenTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "ref.null", heapType: "any" });

				this.releaseTemp(kTmp, "i32");
				this.releaseTemp(strTmp, "externref");
				this.releaseTemp(pLenTmp, "i32");
				this.releaseTemp(pOffTmp, "i32");
				this.releaseTemp(pArrTmp, byteArrW);
				this.releaseTemp(bTmp, builderW);
				return;
			}
			case "String": {
				const bufSliceTmp = this.acquireTemp(sliceW);
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction({ op: "local.set", index: bufSliceTmp });

				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(bufSliceTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(bufSliceTmp, sliceW);

				const accTmp = this.acquireTemp("externref");
				this.pushInstruction({
					op: "i32.const",
					value: this.mod.internString(""),
				});
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringImportIndex(),
				});
				this.pushInstruction({ op: "local.set", index: accTmp });

				const iTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: accTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringConcatImportIndex(),
				});
				this.pushInstruction({ op: "local.set", index: accTmp });

				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: accTmp });

				this.releaseTemp(iTmp, "i32");
				this.releaseTemp(accTmp, "externref");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, builderW);
				return;
			}
			case "Cap":
			case "Len": {
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 1,
				});
				if (targetWasmType === "i32") {
					this.pushInstruction("i32.wrap_i64");
				}
				this.releaseTemp(bTmp, builderW);
				return;
			}
			case "Reset": {
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({
					op: "global.get",
					index: sliceInfo.emptyGlobalIndex,
				});
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});

				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 1,
				});

				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 2,
				});

				this.releaseTemp(bTmp, builderW);
				return;
			}
			case "Grow": {
				this.releaseTemp(bTmp, builderW);
				return;
			}
			default:
				this.releaseTemp(bTmp, builderW);
				throw new Error(`Unsupported Builder method: ${method}`);
		}
	}

	// `fmt.Println(f())` with a multi-value `f`: every result becomes its own
	// operand, held in a hidden local so the usual operand paths apply.
	_expandTupleFmtArgs(args) {
		const tuple = args.length === 1 ? args[0]._type : null;
		if (tuple?.kind !== "tuple") return args;
		const types = tuple.types;
		this._fmtTupleSeq = (this._fmtTupleSeq ?? 0) + 1;
		const names = types.map((_, i) => `__fmt_tuple_${this._fmtTupleSeq}_${i}`);
		const idxs = types.map((t, i) =>
			this.allocLocal(names[i], this.toWasmType(t), t, true),
		);
		this.emitExpr(args[0]);
		for (let i = types.length - 1; i >= 0; i--) {
			this.pushInstruction({ op: "local.set", index: idxs[i] });
		}
		return types.map((t, i) => ({ kind: "Ident", name: names[i], _type: t }));
	}

	emitFmtCall(name, args) {
		args = this._expandTupleFmtArgs(args);
		if (name === "Print" || name === "Sprint" || name === "Sprintln") {
			// Operands travel through the argument buffer; the host joins them
			// with Go's spacing rule (a space only between two non-strings).
			const temps = this._emitArgBuffer(args, true);
			this.pushInstruction({
				op: "i32.const",
				value: name === "Sprintln" ? 1 : 0,
			});
			this._callStdlib(name === "Print" ? "fmt_print" : "fmt_sprint");
			this._releaseArgBuffer(temps);
			return;
		}
		if (name === "Append" || name === "Appendln" || name === "Appendf") {
			const [dst, ...rest] = args;
			const strTmp = this.acquireTemp("externref");
			if (name === "Appendf") {
				const [format, ...operands] = rest;
				const temps = this._emitArgBuffer(
					operands,
					false,
					this._fmtNeedsTypes(format, operands),
				);
				this.emitExpr(format, "externref");
				this._callStdlib("fmt_sprintf");
				this._releaseArgBuffer(temps);
			} else {
				const temps = this._emitArgBuffer(rest, true);
				this.pushInstruction({
					op: "i32.const",
					value: name === "Appendln" ? 1 : 0,
				});
				this._callStdlib("fmt_sprint");
				this._releaseArgBuffer(temps);
			}
			this.pushInstruction({ op: "local.set", index: strTmp });
			this._emitAppendStringToByteSlice(dst, strTmp);
			this.releaseTemp(strTmp, "externref");
			return;
		}
		if (name === "Println") {
			const isPrintln = true;
			if (args.length === 0 && isPrintln) {
				const logIdx = this.mod.getPrintlnEmptyIndex();
				this.pushInstruction({ op: "call", funcIndex: logIdx });
				return;
			}
			// Float operands need their static type (float32, Go's exponent
			// forms), which only the argument buffer carries.
			if (args.some((a) => this._fmtOperandNeedsBuffer(a))) {
				const temps = this._emitArgBuffer(args, true);
				this.pushInstruction({ op: "i32.const", value: 1 });
				this._callStdlib("fmt_print");
				this._releaseArgBuffer(temps);
				return;
			}
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				const isLast = i === args.length - 1 && isPrintln;
				const goType = arg._type ?? this._resolveExprGoType(arg);
				const isBool =
					isBoolGoType(goType) ||
					(arg.kind === "BasicLit" && arg.litKind === "BOOL");
				if (isErrorType(goType) && this.mod.hasErrorType) {
					this.emitExpr(arg, "anyref");
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.resolveFuncIndex("__error_str"),
					});
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getLogImportIndex("externref", isLast, false),
					});
					continue;
				}
				if (this._isFmtExternOperand(goType)) {
					this._emitOperandExternref(arg, goType);
					this._callStdlib("fmt_format_v");
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getLogImportIndex("externref", isLast, false),
					});
					continue;
				}
				const wType = toWasmType(goType, this.mod.checker);
				this.emitExpr(arg, wType);
				const logFuncIdx = this.mod.getLogImportIndex(wType, isLast, isBool);
				this.pushInstruction({ op: "call", funcIndex: logFuncIdx });
			}
			return;
		}
		if (name === "Sprintf" || name === "Printf" || name === "Errorf") {
			const [format, ...rest] = args;
			const temps = this._emitArgBuffer(
				rest,
				false,
				this._fmtNeedsTypes(format, rest),
			);
			this.emitExpr(format, "externref");
			if (name === "Printf") {
				this._callStdlib("fmt_printf");
				this._releaseArgBuffer(temps);
				return;
			}
			this._callStdlib("fmt_sprintf");
			if (name === "Errorf") this._emitErrorfResult(format, temps);
			this._releaseArgBuffer(temps);
			return;
		}
		throw new Error(`Unsupported fmt function: fmt.${name}`);
	}

	// With the formatted message on the stack: makes the error value, wrapping
	// the operands of the format's `%w` verbs (one cause, or several as a
	// `[]error`).
	_emitErrorfResult(format, temps) {
		const causeOf = (i) => temps[i]?.errTmp ?? temps[i]?.tmp ?? null;
		const causes = wrappedErrorfIndices(format)
			.map(causeOf)
			.filter((t) => t !== null);
		if (causes.length > 1) {
			this._emitWrapErrors(causes);
			return;
		}
		if (causes.length === 1) {
			this.pushInstruction({ op: "local.get", index: causes[0] });
		} else {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
	}

	// With the formatted message on the stack: wraps the `causes` (temps
	// holding the `%w` operands) in a runtime error whose `Unwrap` returns
	// them as a `[]error`.
	_emitWrapErrors(causes) {
		const sliceInfo = this.mod.getSliceType({
			kind: "interface",
			name: "error",
		});
		for (const t of causes) this.pushInstruction({ op: "local.get", index: t });
		this.pushInstruction({
			op: "array.new_fixed",
			typeIndex: sliceInfo.arrInfo.typeIndex,
			size: causes.length,
		});
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: causes.length });
		this.pushInstruction({ op: "i32.const", value: causes.length });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_wrap_errors"),
		});
	}

	emitErrorsCall(name, args) {
		if (name === "As") {
			this._emitErrorsAs(args);
			return;
		}
		throw new Error(`Unsupported errors function: errors.${name}`);
	}

	// `errors.As` with an interface target: stores the first error in the chain
	// that implements it.  The caller's `block`/`loop` are depth 2 away.
	_emitErrorsAsInterface(
		ifaceType,
		{ targetLocal, targetTmp, box, errTmp, resLoc },
	) {
		// An interface target takes the first error that implements it.
		this.pushInstruction({ op: "local.get", index: errTmp });
		this._emitTypeTest(ifaceType);
		this.pushInstruction({ op: "if", blockType: "void" });
		if (targetLocal?.isBoxed) {
			this.pushInstruction({ op: "local.get", index: targetLocal.index });
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: targetLocal.boxInfo.typeIndex,
				fieldIndex: 0,
			});
		} else if (targetLocal) {
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({ op: "local.set", index: targetLocal.index });
		} else if (box && targetTmp !== null) {
			this.pushInstruction({ op: "local.get", index: targetTmp });
			this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: box.typeIndex,
				fieldIndex: 0,
			});
		}
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");
	}

	// What `errors.As` looks for: the pointee type of the target argument, its
	// struct layout and, for a struct value target, the box a value-typed error
	// sits in (a pointer target matches the bare struct ref).
	_errorsAsTarget(target) {
		const targetGoType = target._type ?? this._resolveExprGoType(target);
		const baseGoType = targetGoType?.base ?? targetGoType;
		const concreteGoType = baseGoType?.base ?? baseGoType;
		const sName = concreteGoType?.name;
		const sInfo = sName
			? (this.mod.getStructType(sName) ??
				(concreteGoType.pkg
					? this.mod.getStructType(`${concreteGoType.pkg}.${sName}`)
					: null))
			: null;
		// A struct value target (`var v V; errors.As(err, &v)`) matches the box a
		// value-typed error sits in; a pointer target matches the bare struct ref.
		const valueBox =
			sInfo && baseGoType?.kind !== "pointer"
				? this.mod.getIfaceBoxType(
						baseGoType?.kind === "named" ? baseGoType : concreteGoType,
					)
				: null;
		return { baseGoType, sInfo, valueBox };
	}

	_emitErrorsAs(args) {
		const errTmp = this.acquireTemp("anyref");
		const resLoc = this.acquireTemp("i32");
		this.emitExpr(args[0], "anyref");
		this.pushInstruction({ op: "local.set", index: errTmp });

		let targetLocal = null;
		if (
			args[1].kind === "UnaryExpr" &&
			args[1].op === "&" &&
			args[1].operand?.kind === "Ident"
		) {
			targetLocal = this.resolveLocal(args[1].operand.name);
		}

		const { baseGoType, sInfo, valueBox } = this._errorsAsTarget(args[1]);
		const matchIndex = valueBox ? valueBox.typeIndex : sInfo?.typeIndex;
		const pushMatched = () => {
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({ op: "ref.cast", typeIndex: matchIndex });
			if (valueBox)
				this.pushInstruction({
					op: "struct.get",
					typeIndex: valueBox.typeIndex,
					fieldIndex: 0,
				});
		};
		const box = this.mod.getBoxType(baseGoType);
		const boxWType = box
			? { kind: "ref", nullable: true, typeIndex: box.typeIndex }
			: null;

		let targetTmp = null;
		if (!targetLocal) {
			targetTmp = this.acquireTemp("anyref");
			this.emitExpr(args[1], boxWType ?? "anyref");
			this.pushInstruction({ op: "local.set", index: targetTmp });
		}

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		if (targetTmp !== null) {
			this.pushInstruction({ op: "local.get", index: targetTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "br_if", depth: 0 });
		}

		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: errTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 1 });

		if (!sInfo && isNonEmptyInterface(baseGoType, this.mod.checker)) {
			this._emitErrorsAsInterface(baseGoType, {
				targetLocal,
				targetTmp,
				box,
				errTmp,
				resLoc,
			});
		}
		if (sInfo) {
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({ op: "ref.test", typeIndex: matchIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			if (targetLocal) {
				if (targetLocal.isBoxed) {
					this.pushInstruction({ op: "local.get", index: targetLocal.index });
					pushMatched();
					this.pushInstruction({
						op: "struct.set",
						typeIndex: targetLocal.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					pushMatched();
					this.pushInstruction({ op: "local.set", index: targetLocal.index });
				}
			} else if (box && targetTmp !== null) {
				this.pushInstruction({ op: "local.get", index: targetTmp });
				this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
				pushMatched();
				this.pushInstruction({
					op: "struct.set",
					typeIndex: box.typeIndex,
					fieldIndex: 0,
				});
			}
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 2 });
			this.pushInstruction("end");
		}

		this.pushInstruction({ op: "local.get", index: errTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__errors_unwrap"),
		});
		this.pushInstruction({ op: "local.set", index: errTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
		if (targetTmp !== null) {
			this.releaseTemp(targetTmp, "anyref");
		}
		this.releaseTemp(errTmp, "anyref");
	}

	// `a == b` for two anyref operands (interface values).  `ref.eq` only
	// accepts eqref, so host strings (internalised externs) are compared via
	// `str_eq` and anything else by identity.
	_emitAnyEq() {
		const idx = this.mod.resolveFuncIndex("__any_eq");
		if (idx === null) {
			throw new Error(
				"internal: anyref equality emitted but __any_eq was not declared (usesAnyEq scan missed a site)",
			);
		}
		this.pushInstruction({ op: "call", funcIndex: idx });
	}

	// Whether `emitToExternref` can turn a value of this type into a host value.
	_isExternConvertible(goType, depth = 0) {
		if (!goType || depth > 4) return false;
		const checker = this.mod.checker;
		if (isAnyType(goType, checker)) return true;
		if (isSliceType(goType, checker) || isArrayType(goType, checker)) {
			return this._isExternConvertible(
				getSliceElemType(goType, checker),
				depth + 1,
			);
		}
		if (isMapType(goType, checker)) {
			const { keyType, valType } = getMapKeyValTypes(goType, checker);
			return (
				this._isExternConvertible(keyType, depth + 1) &&
				this._isExternConvertible(valType, depth + 1)
			);
		}
		return this._isExternLeaf(goType);
	}

	_isExternLeaf(goType) {
		const checker = this.mod.checker;
		if (
			isStructType(goType, checker, this.mod) ||
			isPointerToStruct(goType, checker, this.mod) ||
			isComplex(goType) ||
			_isPointerKind(goType)
		)
			return true;
		return ["i32", "i64", "f32", "f64", "externref", "v128"].includes(
			toWasmType(goType, checker, this.mod),
		);
	}

	// Body of `__any_fmt(a any) externref`: the dynamic type of `a` is found
	// with a `ref.test` chain over every type the module knows (like
	// `__any_eq`), and the value goes through `emitToExternref`, so
	// String/Error dispatch and nesting work as for statically typed operands.
	_emitAnyFmtHelper() {
		const done = new Set();
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "ref.null", heapType: "extern" });
		this.pushInstruction("return");
		this.pushInstruction("end");

		// Strings are host values; scalars are boxed by their dynamic type.
		this.pushInstruction({ op: "local.get", index: 0 });
		this._emitTypeTest({ kind: "basic", name: "string" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("extern.convert_any");
		this.pushInstruction("return");
		this.pushInstruction("end");

		this._emitAnyFmtError(done);
		for (let round = 0; round < 3; round++) {
			this._emitAnyFmtBoxes(done);
			this._emitAnyFmtStructs(done);
			// Containers share a wasm type across Go element types, so their
			// elements are formatted without scalar-backed Stringer dispatch.
			this._fmtNoScalarMethods = true;
			this._emitAnyFmtContainers(done);
			this._fmtNoScalarMethods = false;
		}
		this._emitAnyFmtNilMaps();
		this.pushInstruction({ op: "ref.null", heapType: "extern" });
		this.pushInstruction("return");
	}

	// A nil map in an interface prints as an empty map; nil pointers and funcs
	// fall through to `<nil>`.
	_emitAnyFmtNilMaps() {
		for (const nb of [...this.mod.nilBoxTypes.values()]) {
			if (!isMapType(nb.goType, this.mod.checker)) continue;
			const { keyType, valType } = getMapKeyValTypes(
				nb.goType,
				this.mod.checker,
			);
			const mapInfo = this.mod.getMapType(keyType, valType);
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction({ op: "ref.test", typeIndex: nb.typeIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "ref.null", heapType: mapInfo.typeIndex });
			this.emitToExternref(nb.goType);
			this.pushInstruction("return");
			this.pushInstruction("end");
		}
	}

	// One arm of the `__any_fmt` chain: if `a` is a `typeIndex`, format it as
	// `goType` (a box is unwrapped first) and return.
	_emitAnyFmtArm(done, typeIndex, goType, unbox) {
		if (done.has(typeIndex)) return;
		done.add(typeIndex);
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "ref.test", typeIndex });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "ref.cast", typeIndex });
		if (unbox) {
			this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 0 });
		}
		this.emitToExternref(goType);
		this.pushInstruction("return");
		this.pushInstruction("end");
	}

	// errors.New / fmt.Errorf values print their message.
	_emitAnyFmtError(done) {
		if (!this.mod.hasErrorType) return;
		const msgTmp = this.acquireTemp("externref");
		for (const name of [ERROR_STRUCT, WRAP_ERRORS_STRUCT]) {
			const errInfo = this.mod.getStructType(name);
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction({ op: "ref.test", typeIndex: errInfo.typeIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__error_str"),
			});
			this.pushInstruction({ op: "local.set", index: msgTmp });
			this.pushInstruction({ op: "local.get", index: msgTmp });
			this.pushInstruction({ op: "local.get", index: msgTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getFmtNewStringerIndex(),
			});
			this.pushInstruction("return");
			this.pushInstruction("end");
			done.add(errInfo.typeIndex);
		}
		this.releaseTemp(msgTmp, "externref");
	}

	_emitAnyFmtBoxes(done) {
		for (const box of [...this.mod.ifaceBoxTypes.values()]) {
			// `any(5)` boxes the untyped constant type; format it as its default type.
			const goType =
				box.goType?.kind === "untyped"
					? {
							kind: "basic",
							name:
								{ float: "float64", rune: "int32" }[box.goType.base] ??
								box.goType.base,
						}
					: box.goType;
			if (this._isExternConvertible(goType))
				this._emitAnyFmtArm(done, box.typeIndex, goType, true);
		}
	}

	// A bare struct ref in an `any` is a pointer.
	_emitAnyFmtStructs(done) {
		const checker = this.mod.checker;
		for (const [name, sInfo] of [...this.mod.structTypes.entries()]) {
			const named =
				name === ERROR_STRUCT || name === WRAP_ERRORS_STRUCT
					? null
					: checker?.types?.get(name);
			if (!named) continue;
			const ptrType = { kind: "pointer", base: named };
			const w = toWasmType(ptrType, checker, this.mod);
			if (w?.typeIndex === sInfo.typeIndex)
				this._emitAnyFmtArm(done, sInfo.typeIndex, ptrType, false);
		}
	}

	_emitAnyFmtContainers(done) {
		const groups = [
			[this.mod.sliceTypes, (i) => ({ kind: "slice", elem: i.elemGoType })],
			[this.mod.arrayTypes, (i) => ({ kind: "array", elem: i.elemGoType })],
			[
				this.mod.mapTypes,
				(i) => ({ kind: "map", key: i.keyGoType, value: i.valGoType }),
			],
		];
		for (const [infos, toGoType] of groups) {
			for (const info of [...infos.values()]) {
				const goType = toGoType(info);
				if (this._isExternConvertible(goType))
					this._emitAnyFmtArm(done, info.typeIndex, goType, false);
			}
		}
	}

	// Bodies of the synthetic runtime helpers declared in compileWasmModule.
	emitRuntimeHelper(fn) {
		const errInfo = this.mod.getStructType(ERROR_STRUCT);
		switch (fn._isRuntimeHelper) {
			case "any_eq": {
				const bothNull = () => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction("ref.is_null");
					this.pushInstruction({ op: "local.get", index: 1 });
					this.pushInstruction("ref.is_null");
				};
				bothNull();
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("return");
				this.pushInstruction("end");
				bothNull();
				this.pushInstruction("i32.or");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Check unhashable / uncomparable types
				const checkUncomparable = (typeIndex) => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction({ op: "local.get", index: 1 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction("i32.or");
					this.pushInstruction({ op: "if", blockType: "void" });
					this.emitPanic("runtime error: comparing uncomparable type");
					this.pushInstruction("end");
				};
				for (const s of this.mod.sliceTypes.values())
					checkUncomparable(s.typeIndex);
				for (const m of this.mod.mapTypes.values())
					checkUncomparable(m.typeIndex);
				for (const c of this.mod.closureTypes.values())
					checkUncomparable(c.typeIndex);
				for (const b of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(b.goType, this.mod.checker))
						checkUncomparable(b.typeIndex);
				}
				for (const a of this.mod.arrayTypes.values()) {
					if (isUnhashableGoType(a.elemGoType, this.mod.checker))
						checkUncomparable(a.typeIndex);
				}

				// Boxed values compare by value (Go: any(3) == any(3), struct values, etc.).
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker)) continue;
					for (const idx of [0, 1]) {
						this.pushInstruction({ op: "local.get", index: idx });
						this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					}
					this.pushInstruction("i32.and");
					this.pushInstruction({ op: "if", blockType: "void" });
					const f1 = this.allocLocal(null, box.wType);
					const f2 = this.allocLocal(null, box.wType);
					for (const [src, dst] of [
						[0, f1],
						[1, f2],
					]) {
						this.pushInstruction({ op: "local.get", index: src });
						this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
						this.pushInstruction({
							op: "struct.get",
							typeIndex: box.typeIndex,
							fieldIndex: 0,
						});
						this.pushInstruction({ op: "local.set", index: dst });
					}
					this.emitKeyEq(f1, f2, box.goType);
					this.pushInstruction("return");
					this.pushInstruction("end");
				}

				// Strings
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCmpImportIndex("=="),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Heap reference equality
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction("ref.eq");
				this.pushInstruction("return");
				this.pushInstruction("end");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				return;
			}
			case "any_hash": {
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Check unhashable types
				const checkUnhashable = (typeIndex) => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					this.emitPanic("runtime error: hash of unhashable type");
					this.pushInstruction("end");
				};
				for (const sliceInfo of this.mod.sliceTypes.values())
					checkUnhashable(sliceInfo.typeIndex);
				for (const mapInfo of this.mod.mapTypes.values())
					checkUnhashable(mapInfo.typeIndex);
				for (const closureInfo of this.mod.closureTypes.values())
					checkUnhashable(closureInfo.typeIndex);
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker))
						checkUnhashable(box.typeIndex);
				}
				for (const arrInfo of this.mod.arrayTypes.values()) {
					if (isUnhashableGoType(arrInfo.elemGoType, this.mod.checker))
						checkUnhashable(arrInfo.typeIndex);
				}

				// Check boxed values (scalars, struct values)
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker)) continue;
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					const valLoc = this.allocLocal(null, box.wType);
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: box.typeIndex,
						fieldIndex: 0,
					});
					this.pushInstruction({ op: "local.set", index: valLoc });
					this.pushInstruction({ op: "i32.const", value: box.typeIndex });
					this.pushInstruction({ op: "i32.const", value: 31 });
					this.pushInstruction("i32.mul");
					this.emitKeyHash(valLoc, box.goType);
					this.pushInstruction("i32.add");
					this.pushInstruction("return");
					this.pushInstruction("end");
				}

				// Check string
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringHashImportIndex(),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				return;
			}
			case "error_msg":
			case "error_cause":
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: errInfo.typeIndex,
					fieldIndex: fn._isRuntimeHelper === "error_msg" ? 0 : 1,
				});
				this.pushInstruction("return");
				return;
			case "wrap_msg":
			case "wrap_errs": {
				const wrapInfo = this.mod.getStructType(WRAP_ERRORS_STRUCT);
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: wrapInfo.typeIndex,
					fieldIndex: fn._isRuntimeHelper === "wrap_msg" ? 0 : 1,
				});
				this.pushInstruction("return");
				return;
			}
			case "mk_wrap_errors": {
				const wrapInfo = this.mod.getStructType(WRAP_ERRORS_STRUCT);
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: wrapInfo.typeIndex,
				});
				this.pushInstruction("return");
				return;
			}
			case "mk_error":
				// nil message (strconv success) → nil error
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("any.convert_extern");
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction("return");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: errInfo.typeIndex,
				});
				this.pushInstruction("return");
				return;
			case "any_fmt":
				this._emitAnyFmtHelper();
				return;
			case "error_str":
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({
					op: "i32.const",
					value: this.mod.internString("<nil>"),
				});
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringImportIndex(),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__dispatch_error_Error"),
				});
				this.pushInstruction("return");
				return;
			case "errors_is": {
				// for err != nil { if err == target || sameMsg(err, target) { return true }; err = unwrap(err) }
				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "br_if", depth: 1 });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "local.get", index: 1 });
				this._emitAnyEq();
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("return");
				this.pushInstruction("end");
				// both runtime errors with equal messages (mirrors the JS backend)
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.test", typeIndex: errInfo.typeIndex });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.test", typeIndex: errInfo.typeIndex });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				for (const idx of [0, 1]) {
					this.pushInstruction({ op: "local.get", index: idx });
					this.pushInstruction({
						op: "ref.cast",
						typeIndex: errInfo.typeIndex,
					});
					this.pushInstruction({
						op: "struct.get",
						typeIndex: errInfo.typeIndex,
						fieldIndex: 0,
					});
				}
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCmpImportIndex("=="),
				});
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("return");
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__errors_unwrap"),
				});
				this.pushInstruction({ op: "local.set", index: 0 });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				return;
			}
			case "testing_run_cb": {
				// (fn anyref, t externref): fn is a func(*testing.T) closure
				const closureInfo = this.mod.getTestingRunClosureType();
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "ref.cast",
					typeIndex: closureInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.get",
					typeIndex: closureInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "ref.cast",
					typeIndex: closureInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.get",
					typeIndex: closureInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction({
					op: "call_ref",
					typeIndex: closureInfo.funcTypeIndex,
				});
				this.pushInstruction("return");
				return;
			}
			case "testing_cleanup_cb": {
				// (fn anyref): fn is a func() closure
				const closureInfo = this.mod.getTestingCleanupClosureType();
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "ref.cast",
					typeIndex: closureInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.get",
					typeIndex: closureInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "ref.cast",
					typeIndex: closureInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.get",
					typeIndex: closureInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction({
					op: "call_ref",
					typeIndex: closureInfo.funcTypeIndex,
				});
				this.pushInstruction("return");
				return;
			}
			default:
				throw new Error(`Unknown runtime helper: ${fn._isRuntimeHelper}`);
		}
	}
}
