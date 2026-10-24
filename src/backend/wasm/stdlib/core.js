// src/backend/wasm/stdlib/core.js
// FunctionEmitter mixin: core stdlib packages implemented natively (math,
// math/bits, maps, slices, strings, strconv, fmt, errors, sort, unicode/utf8,
// testing) plus the runtime helper bodies they rely on.

import {
	ERROR_STRUCT,
	getMapKeyValTypes,
	goTypeKey,
	isArrayType,
	isComplex,
	isComplex64,
	isErrorType,
	isMapType,
	isPointerToStruct,
	isSigned,
	isSliceType,
	isStructType,
	isUnhashableGoType,
	toWasmType,
} from "../types.js";

function _isPointerKind(t) {
	return (
		t?.kind === "pointer" || t?.kind === "PointerType" || t?.kind === "StarExpr"
	);
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

	_isPathConst(expr) {
		return (
			(this._isPkgExpr(expr, "path") || this._isPkgExpr(expr, "filepath")) &&
			expr.field === "ErrBadPattern"
		);
	}

	emitPathConst(field, _targetWasmType) {
		this._emitLazyErrorGlobal(
			this.mod.getPathErrGlobalIndex(field),
			"syntax error in pattern",
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
			Log2: "log2",
			Log10: "log10",
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
		if (method === "Run") {
			this.emitExpr(func.expr, "externref");
			this.emitExpr(args[0], "externref");
			this.emitExpr(args[1], "anyref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStdlibImportIndex("testing_run"),
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
			isSliceType(goType, this.mod.checker) ||
			isArrayType(goType, this.mod.checker) ||
			isMapType(goType, this.mod.checker) ||
			isStructType(goType, this.mod.checker, this.mod) ||
			isPointerToStruct(goType, this.mod.checker, this.mod) ||
			_isPointerKind(goType)
		);
	}

	_emitScalarToExternref(goType, valTmp, valW) {
		if (goType?.name === "string" || goType === "string") {
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.releaseTemp(valTmp, valW);
			return true;
		}
		if (goType?.name === "bool" || goType === "bool") {
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

	_emitSliceToExternref(goType, valTmp, valW, inCycle, nextSeen) {
		const elemGoType = goType.elem ?? goType.underlying?.elem;
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
		this.pushInstruction("else");

		this._emitSliceUnpack(valTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

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

	_emitArrayToExternref(goType, valTmp, valW, inCycle, nextSeen) {
		const elemGoType = goType.elem ?? goType.underlying?.elem;
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

	_emitMapToExternref(goType, valTmp, valW, inCycle, nextSeen) {
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
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getFmtNewBoxIndex(),
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

	emitToExternref(goType, isNested = false, seen = new Set()) {
		const valW = toWasmType(goType, this.mod.checker, this.mod);
		const valTmp = this.acquireTemp(valW);
		this.pushInstruction({ op: "local.set", index: valTmp });

		if (this._emitScalarToExternref(goType, valTmp, valW)) return;

		const tKey = goType ? goTypeKey(goType) : null;
		const inCycle = tKey !== null && seen.has(tKey);
		const nextSeen = tKey !== null ? new Set(seen).add(tKey) : seen;

		if (isSliceType(goType, this.mod.checker)) {
			this._emitSliceToExternref(goType, valTmp, valW, inCycle, nextSeen);
			return;
		}

		if (isArrayType(goType, this.mod.checker)) {
			this._emitArrayToExternref(goType, valTmp, valW, inCycle, nextSeen);
			return;
		}

		if (isMapType(goType, this.mod.checker)) {
			this._emitMapToExternref(goType, valTmp, valW, inCycle, nextSeen);
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

		this.pushInstruction({ op: "local.get", index: valTmp });
		this.releaseTemp(valTmp, valW);
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
	_emitArgBuffer(args, markErrors = false) {
		const temps = [];
		for (const arg of args) {
			const goType = arg._type ?? this._resolveExprGoType(arg);
			const isBool =
				goType?.name === "bool" ||
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
			if (this._isCompositeGoType(goType)) {
				const tmp = this.acquireTemp("externref");
				this.emitExpr(arg, valW);
				this.emitToExternref(goType, false);
				this.pushInstruction({ op: "local.set", index: tmp });
				temps.push({ tmp, wType: "externref", isBool: false, errTmp: null });
				continue;
			}
			let wType = valW;
			if (!isSigned(goType)) {
				if (wType === "i32") {
					wType = "i64";
				} else if (wType === "i64") {
					wType = "f64";
				}
			}
			const tmp = this.acquireTemp(wType);
			this.emitExpr(arg, valW);
			if (!isSigned(goType)) {
				if (valW === "i32") {
					this.pushInstruction("i64.extend_i32_u");
				} else if (valW === "i64") {
					this.pushInstruction("f64.convert_i64_u");
				}
			}
			this.pushInstruction({ op: "local.set", index: tmp });
			temps.push({ tmp, wType, isBool, errTmp: null });
		}
		for (const { tmp, wType, isBool, markErr } of temps) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "call",
				funcIndex: markErr
					? this.mod.getTestingArgErrImportIndex()
					: this.mod.getTestingArgImportIndex(wType, isBool),
			});
		}
		return temps;
	}

	_releaseArgBuffer(temps) {
		for (let i = temps.length - 1; i >= 0; i--) {
			this.releaseTemp(temps[i].tmp, temps[i].wType);
			if (temps[i].errTmp !== null) this.releaseTemp(temps[i].errTmp, "anyref");
		}
	}

	emitBitsCall(name, args) {
		switch (name) {
			case "LeadingZeros32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.clz");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "TrailingZeros32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.ctz");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "OnesCount32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.popcnt");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "RotateLeft32": {
				this.emitExpr(args[0], "i32");
				const arg1WType = toWasmType(args[1]?._type, this.mod.checker);
				if (arg1WType === "i64") {
					this.emitExpr(args[1], "i64");
					this.pushInstruction("i32.wrap_i64");
				} else {
					this.emitExpr(args[1], "i32");
				}
				this.pushInstruction("i32.rotl");
				return;
			}

			case "LeadingZeros64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.clz");
				return;
			case "TrailingZeros64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.ctz");
				return;
			case "OnesCount64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.popcnt");
				return;
			case "RotateLeft64": {
				this.emitExpr(args[0], "i64");
				const arg1WType = toWasmType(args[1]?._type, this.mod.checker);
				if (arg1WType === "i32") {
					this.emitExpr(args[1], "i32");
					this.pushInstruction("i64.extend_i32_s");
				} else {
					this.emitExpr(args[1], "i64");
				}
				this.pushInstruction("i64.rotl");
				return;
			}

			case "Len32":
				this.pushInstruction({ op: "i32.const", value: 32 });
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.clz");
				this.pushInstruction("i32.sub");
				this.pushInstruction("i64.extend_i32_u");
				return;

			case "Len64":
				this.pushInstruction({ op: "i64.const", value: 64n });
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.clz");
				this.pushInstruction("i64.sub");
				return;

			case "ReverseBytes16": {
				const xTmp = this.acquireTemp("i32");
				this.emitExpr(args[0], "i32");
				this.pushInstruction({ op: "local.tee", index: xTmp });
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shr_u");
				this.pushInstruction({ op: "i32.const", value: 0xff });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction({ op: "i32.const", value: 0xff });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shl");
				this.pushInstruction("i32.or");
				this.releaseTemp(xTmp, "i32");
				return;
			}

			case "ReverseBytes32": {
				this.emitExpr(args[0], "i32");
				this._emitReverseBytes32Sequence();
				return;
			}

			case "ReverseBytes64": {
				const xTmp = this.acquireTemp("i64");
				this.emitExpr(args[0], "i64");
				this.pushInstruction({ op: "local.set", index: xTmp });

				// lo 32 bits -> ReverseBytes32 -> extend to i64 -> shl 32
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction("i32.wrap_i64");
				this._emitReverseBytes32Sequence();
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "i64.const", value: 32n });
				this.pushInstruction("i64.shl");

				// hi 32 bits -> ReverseBytes32 -> extend to i64
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction({ op: "i64.const", value: 32n });
				this.pushInstruction("i64.shr_u");
				this.pushInstruction("i32.wrap_i64");
				this._emitReverseBytes32Sequence();
				this.pushInstruction("i64.extend_i32_u");

				this.pushInstruction("i64.or");
				this.releaseTemp(xTmp, "i64");
				return;
			}

			case "Reverse32": {
				this.emitExpr(args[0], "i32");
				this._emitReverse32Sequence();
				return;
			}

			case "Reverse64": {
				const xTmp = this.acquireTemp("i64");
				this.emitExpr(args[0], "i64");
				this.pushInstruction({ op: "local.set", index: xTmp });

				// lo 32 bits -> Reverse32 -> extend to i64 -> shl 32
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction("i32.wrap_i64");
				this._emitReverse32Sequence();
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "i64.const", value: 32n });
				this.pushInstruction("i64.shl");

				// hi 32 bits -> Reverse32 -> extend to i64
				this.pushInstruction({ op: "local.get", index: xTmp });
				this.pushInstruction({ op: "i64.const", value: 32n });
				this.pushInstruction("i64.shr_u");
				this.pushInstruction("i32.wrap_i64");
				this._emitReverse32Sequence();
				this.pushInstruction("i64.extend_i32_u");

				this.pushInstruction("i64.or");
				this.releaseTemp(xTmp, "i64");
				return;
			}

			default:
				throw new Error(`Unsupported bits function: bits.${name}`);
		}
	}

	_emitReverseBytes32Sequence() {
		const v = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.set", index: v });
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 24 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 0xff00 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 8 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 8 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "i32.const", value: 0xff00 });
		this.pushInstruction("i32.and");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 24 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction("i32.or");
		this.releaseTemp(v, "i32");
	}

	_emitReverse32Sequence() {
		const v = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.set", index: v });
		// v = ((v >>> 1) & 0x55555555) | ((v & 0x55555555) << 1)
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "i32.const", value: 0x55555555 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 0x55555555 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: v });
		// v = ((v >>> 2) & 0x33333333) | ((v & 0x33333333) << 2)
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "i32.const", value: 0x33333333 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 0x33333333 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: v });
		// v = ((v >>> 4) & 0x0f0f0f0f) | ((v & 0x0f0f0f0f) << 4)
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "i32.const", value: 0x0f0f0f0f });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 0x0f0f0f0f });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: v });
		// v = ((v >>> 8) & 0x00ff00ff) | ((v & 0x00ff00ff) << 8)
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 8 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "i32.const", value: 0x00ff00ff });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 0x00ff00ff });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 8 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: v });
		// return (v >>> 16) | (v << 16)
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 16 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "local.get", index: v });
		this.pushInstruction({ op: "i32.const", value: 16 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.releaseTemp(v, "i32");
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

	emitMapsCall(name, args, _targetWasmType) {
		switch (name) {
			case "Clone": {
				const mArg = args[0];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.cloneFuncName),
				});
				return;
			}
			case "Copy":
				this.emitMapsCopy(args);
				return;
			case "Equal":
				this.emitMapsEqual(args, false);
				return;
			case "EqualFunc":
				this.emitMapsEqual(args, true);
				return;
			case "Delete": {
				const mArg = args[0];
				const kArg = args[1];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.emitExpr(kArg, mapInfo.keyWType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.deleteFuncName),
				});
				return;
			}
			case "DeleteFunc":
				this.emitMapsDeleteFunc(args);
				return;
			default:
				throw new Error(`Unsupported maps function: maps.${name}`);
		}
	}

	emitMapsCopy(args) {
		const dstNode = args[0];
		const srcNode = args[1];
		const dstType = dstNode._type ?? this._resolveExprGoType(dstNode);
		const { keyType, valType } = getMapKeyValTypes(dstType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		const dstTmp = this.acquireTemp(mapInfo.wType);
		const srcTmp = this.acquireTemp(mapInfo.wType);
		this.emitExpr(dstNode, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: dstTmp });
		this.emitExpr(srcNode, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: srcTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		// if src == null -> return
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// if dst == null -> panic
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic("assignment to entry in nil map");
		this.pushInstruction("end");

		const idxTmp = this.acquireTemp("i32");
		const entryTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});

		// idx = src.head
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxTmp });
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
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		// dst[k] = v
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
		});

		this.pushInstruction("end");

		// idx = entry.order_next
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(entryTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.releaseTemp(idxTmp, "i32");

		this.pushInstruction("end");
		this.releaseTemp(srcTmp, mapInfo.wType);
		this.releaseTemp(dstTmp, mapInfo.wType);
	}

	emitMapsEqual(args, isFunc = false) {
		const m1Node = args[0];
		const m2Node = args[1];
		const eqFn = isFunc ? args[2] : null;

		const m1Type = m1Node._type ?? this._resolveExprGoType(m1Node);
		const { keyType, valType } = getMapKeyValTypes(m1Type, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		const m1Tmp = this.acquireTemp(mapInfo.wType);
		const m2Tmp = this.acquireTemp(mapInfo.wType);
		this.emitExpr(m1Node, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: m1Tmp });
		this.emitExpr(m2Node, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: m2Tmp });

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "block", blockType: "void" }); // exit block 0

		// if m1 == m2 -> res = 1; br 0
		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end");

		// if m1 == null || m2 == null -> br 0
		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// if m1.len != m2.len -> br 0
		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// Loop m1 entries
		const idxTmp = this.acquireTemp("i32");
		const entryTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const val1Tmp = this.acquireTemp(mapInfo.valWType);
		const val2Tmp = this.acquireTemp(mapInfo.valWType);
		const okTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxTmp });
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
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		// val2, ok = getOk(m2, entry.key)
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.getOkFuncName),
		});
		this.pushInstruction({ op: "local.set", index: okTmp });
		this.pushInstruction({ op: "local.set", index: val2Tmp });

		// if !ok -> br 3 (exit outer block with res=0)
		this.pushInstruction({ op: "local.get", index: okTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 3 });

		// check entry.val == val2
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: val1Tmp });

		if (isFunc) {
			const eqClosureType = this._resolveExprGoType(eqFn);
			const closureInfo = this.mod.getClosureType(eqClosureType);
			const closureTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});
			this.emitExpr(eqFn, {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: closureTmp });

			// env
			this.pushInstruction({ op: "local.get", index: closureTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: closureInfo.typeIndex,
				fieldIndex: 1,
			});
			// arg 0: val1
			this.pushInstruction({ op: "local.get", index: val1Tmp });
			// arg 1: val2
			this.pushInstruction({ op: "local.get", index: val2Tmp });
			// funcref
			this.pushInstruction({ op: "local.get", index: closureTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: closureInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({
				op: "call_ref",
				typeIndex: closureInfo.funcTypeIndex,
			});
			this.releaseTemp(closureTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});

			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "br_if", depth: 3 });
		} else {
			this.emitKeyEq(val1Tmp, val2Tmp, valType);
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "br_if", depth: 3 });
		}

		this.pushInstruction("end"); // end if active

		// idx = entry.order_next
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// All matched: res = 1
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.releaseTemp(okTmp, "i32");
		this.releaseTemp(val2Tmp, mapInfo.valWType);
		this.releaseTemp(val1Tmp, mapInfo.valWType);
		this.releaseTemp(entryTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.releaseTemp(idxTmp, "i32");

		this.pushInstruction("end"); // end outer block 0

		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(m2Tmp, mapInfo.wType);
		this.releaseTemp(m1Tmp, mapInfo.wType);
	}

	emitMapsDeleteFunc(args) {
		const mNode = args[0];
		const delFn = args[1];
		const mType = mNode._type ?? this._resolveExprGoType(mNode);
		const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		const mTmp = this.acquireTemp(mapInfo.wType);
		this.emitExpr(mNode, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: mTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const idxTmp = this.acquireTemp("i32");
		const nextTmp = this.acquireTemp("i32");
		const entryTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const keyTmp = this.acquireTemp(mapInfo.keyWType);
		const valTmp = this.acquireTemp(mapInfo.valWType);

		const delClosureType = this._resolveExprGoType(delFn);
		const closureInfo = this.mod.getClosureType(delClosureType);
		const closureTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.emitExpr(delFn, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: closureTmp });

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: nextTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: keyTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: valTmp });

		// call delFn(key, val)
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: keyTmp });
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		// if delFn returned true -> delete(m, key)
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "local.get", index: keyTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.deleteFuncName),
		});
		this.pushInstruction("end");

		this.pushInstruction("end"); // end if active

		this.pushInstruction({ op: "local.get", index: nextTmp });
		this.pushInstruction({ op: "local.set", index: idxTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(closureTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.releaseTemp(valTmp, mapInfo.valWType);
		this.releaseTemp(keyTmp, mapInfo.keyWType);
		this.releaseTemp(entryTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.releaseTemp(nextTmp, "i32");
		this.releaseTemp(idxTmp, "i32");

		this.pushInstruction("end");
		this.releaseTemp(mTmp, mapInfo.wType);
	}

	emitSlicesCall(name, args, targetWasmType) {
		switch (name) {
			case "Sort":
				this.emitSlicesSort(args);
				return;
			case "Reverse":
				this.emitSlicesReverse(args);
				return;
			case "Contains":
				this.emitSlicesContains(args);
				return;
			case "ContainsFunc":
				this.emitSlicesContainsFunc(args);
				return;
			case "Index":
				this.emitSlicesIndex(args, targetWasmType);
				return;
			case "IndexFunc":
				this.emitSlicesIndexFunc(args, targetWasmType);
				return;
			case "BinarySearch":
				this.emitSlicesBinarySearch(args);
				return;
			case "BinarySearchFunc":
				this.emitSlicesBinarySearchFunc(args);
				return;
			case "Equal":
				this.emitSlicesEqual(args);
				return;
			case "Clone":
				this.emitSlicesClone(args);
				return;
			case "Compare":
				this.emitSlicesCompare(args, targetWasmType);
				return;
			case "SortFunc":
			case "SortStableFunc":
				this.emitSlicesSortFunc(args);
				return;
			case "IsSorted":
				this.emitSlicesIsSorted(args);
				return;
			case "IsSortedFunc":
				this.emitSlicesIsSortedFunc(args);
				return;
			case "Min":
				this.emitSlicesMinMax(args, targetWasmType, true);
				return;
			case "Max":
				this.emitSlicesMinMax(args, targetWasmType, false);
				return;
			case "MinFunc":
				this.emitSlicesMinMaxFunc(args, targetWasmType, true);
				return;
			case "MaxFunc":
				this.emitSlicesMinMaxFunc(args, targetWasmType, false);
				return;
			case "Compact":
				this.emitSlicesCompact(args, false);
				return;
			case "CompactFunc":
				this.emitSlicesCompact(args, true);
				return;
			case "Concat":
				this.emitSlicesConcat(args, targetWasmType);
				return;
			case "Delete":
				this.emitSlicesDelete(args);
				return;
			case "DeleteFunc":
				this.emitSlicesDeleteFunc(args);
				return;
			case "Insert":
				this.emitSlicesInsert(args);
				return;
			case "Replace":
				this.emitSlicesReplace(args);
				return;
			case "Grow":
				this.emitSlicesGrow(args);
				return;
			case "Clip":
				this.emitSlicesClip(args);
				return;
			default:
				throw new Error(`Unsupported slices function: slices.${name}`);
		}
	}

	emitSlicesSort(args) {
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

		this._emitSliceUnpack(sliceTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

		// if len <= 1 -> br 0
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const iLoc = this.acquireTemp("i32");
		const jLoc = this.acquireTemp("i32");
		const keyLoc = this.acquireTemp(arrInfo.elemWType);
		const testLoc = this.acquireTemp(arrInfo.elemWType);

		// i = 1
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		// Outer loop
		this.pushInstruction({ op: "loop", blockType: "void" });

		// key = arr[off + i]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: keyLoc });

		// j = i - 1
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		// Inner loop
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		// if j < 0 -> break inner loop
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// test = arr[off + j]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: testLoc });

		// if !(key < test) -> break inner loop
		this.emitElemLt(keyLoc, testLoc, elemGoType);
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// arr[off + j + 1] = test
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: testLoc });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// j--
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// arr[off + j + 1] = key
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: keyLoc });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// i++
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.tee", index: iLoc });

		// if i < len -> continue outer loop
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		this.pushInstruction("end"); // end outer loop

		this.releaseTemp(testLoc, arrInfo.elemWType);
		this.releaseTemp(keyLoc, arrInfo.elemWType);
		this.releaseTemp(jLoc, "i32");
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // end exit block
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	emitSlicesReverse(args) {
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

		this._emitSliceUnpack(sliceTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

		const iLoc = this.acquireTemp("i32");
		const jLoc = this.acquireTemp("i32");
		const tmp1 = this.acquireTemp(arrInfo.elemWType);
		const tmp2 = this.acquireTemp(arrInfo.elemWType);

		// i = 0, j = len - 1
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		// if i >= j -> break
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// tmp1 = arr[off + i]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: tmp1 });

		// tmp2 = arr[off + j]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: tmp2 });

		// arr[off + i] = tmp2
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: tmp2 });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// arr[off + j] = tmp1
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: tmp1 });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// i++, j--
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(tmp2, arrInfo.elemWType);
		this.releaseTemp(tmp1, arrInfo.elemWType);
		this.releaseTemp(jLoc, "i32");
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

	emitSlicesContains(args) {
		const sNode = args[0];
		const vNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		const vTmp = this.acquireTemp(arrInfo.elemWType);
		this.emitExpr(sNode, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });
		this.emitExpr(vNode, arrInfo.elemWType);
		this.pushInstruction({ op: "local.set", index: vTmp });

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });

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
		const itemTmp = this.acquireTemp(arrInfo.elemWType);

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
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: itemTmp });

		this.emitKeyEq(itemTmp, vTmp, elemGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(itemTmp, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // end exit block
		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(vTmp, arrInfo.elemWType);
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	emitSlicesIndex(args, targetWasmType) {
		const sNode = args[0];
		const vNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		const vTmp = this.acquireTemp(arrInfo.elemWType);
		this.emitExpr(sNode, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });
		this.emitExpr(vNode, arrInfo.elemWType);
		this.pushInstruction({ op: "local.set", index: vTmp });

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: resLoc });

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
		const itemTmp = this.acquireTemp(arrInfo.elemWType);

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
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: itemTmp });

		this.emitKeyEq(itemTmp, vTmp, elemGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(itemTmp, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // end exit block
		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
		this.releaseTemp(vTmp, arrInfo.elemWType);
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});

		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		}
	}

	emitSlicesIndexFunc(args, targetWasmType) {
		const sNode = args[0];
		const fnNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const closureGoType = this._resolveExprGoType(fnNode);
		const closureInfo = this.mod.getClosureType(closureGoType);

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};

		const sTmp = this.acquireTemp(sliceW);
		const clTmp = this.acquireTemp(closureW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: sTmp });
		this.emitExpr(fnNode, closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sTmp });
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
		const itemTmp = this.acquireTemp(arrInfo.elemWType);

		this._emitSliceUnpack(sTmp, sliceInfo, {
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
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: itemTmp });

		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: itemTmp });
		if (closureInfo.paramWTypes?.[0] === "i64" && arrInfo.elemWType === "i32") {
			this.pushInstruction("i64.extend_i32_s");
		}
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(itemTmp, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // end null block

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
		this.releaseTemp(clTmp, closureW);
		this.releaseTemp(sTmp, sliceW);

		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		}
	}

	emitSlicesContainsFunc(args) {
		this.emitSlicesIndexFunc(args, "i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ge_s");
	}

	emitSlicesBinarySearch(args) {
		const sNode = args[0];
		const targetNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const sTmp = this.acquireTemp(sliceW);
		const targetTmp = this.acquireTemp(arrInfo.elemWType);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: sTmp });
		this.emitExpr(targetNode, arrInfo.elemWType);
		this.pushInstruction({ op: "local.set", index: targetTmp });

		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const iTmp = this.acquireTemp("i32");
		const jTmp = this.acquireTemp("i32");
		const hTmp = this.acquireTemp("i32");
		const valTmp = this.acquireTemp(arrInfo.elemWType);
		const foundTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: foundTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "local.set", index: jTmp });

		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "local.set", index: hTmp });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: hTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: valTmp });

		this.emitElemLt(valTmp, targetTmp, elemGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: hTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: hTmp });
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end"); // if i < j
		this.pushInstruction("end"); // loop

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: valTmp });
		this.emitKeyEq(valTmp, targetTmp, elemGoType);
		this.pushInstruction({ op: "local.set", index: foundTmp });
		this.pushInstruction("end");

		this.pushInstruction("end"); // exit block

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.get", index: foundTmp });

		this.releaseTemp(foundTmp, "i32");
		this.releaseTemp(valTmp, arrInfo.elemWType);
		this.releaseTemp(hTmp, "i32");
		this.releaseTemp(jTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(targetTmp, arrInfo.elemWType);
		this.releaseTemp(sTmp, sliceW);
	}

	emitSlicesBinarySearchFunc(args) {
		const sNode = args[0];
		const targetNode = args[1];
		const cmpNode = args[2];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const closureGoType = this._resolveExprGoType(cmpNode);
		const closureInfo = this.mod.getClosureType(closureGoType);

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};
		const sTmp = this.acquireTemp(sliceW);
		const targetTmp = this.acquireTemp(
			closureInfo.paramWTypes?.[1] ?? arrInfo.elemWType,
		);
		const clTmp = this.acquireTemp(closureW);

		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: sTmp });
		this.emitExpr(
			targetNode,
			closureInfo.paramWTypes?.[1] ?? arrInfo.elemWType,
		);
		this.pushInstruction({ op: "local.set", index: targetTmp });
		this.emitExpr(cmpNode, closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const iTmp = this.acquireTemp("i32");
		const jTmp = this.acquireTemp("i32");
		const hTmp = this.acquireTemp("i32");
		const valTmp = this.acquireTemp(arrInfo.elemWType);
		const foundTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: foundTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "local.set", index: jTmp });

		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction({ op: "local.set", index: hTmp });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: hTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: valTmp });

		this._emitCallCmp(clTmp, closureInfo, valTmp, targetTmp, arrInfo);
		this._emitCmpIsNegative(closureInfo);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: hTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: hTmp });
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end"); // if i < j
		this.pushInstruction("end"); // loop

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: valTmp });
		this._emitCallCmp(clTmp, closureInfo, valTmp, targetTmp, arrInfo);
		if (closureInfo.returnWTypes?.[0] === "i32") {
			this.pushInstruction("i32.eqz");
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction("i64.eq");
		}
		this.pushInstruction({ op: "local.set", index: foundTmp });
		this.pushInstruction("end");

		this.pushInstruction("end"); // exit block

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.get", index: foundTmp });

		this.releaseTemp(foundTmp, "i32");
		this.releaseTemp(valTmp, arrInfo.elemWType);
		this.releaseTemp(hTmp, "i32");
		this.releaseTemp(jTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(clTmp, closureW);
		this.releaseTemp(
			targetTmp,
			closureInfo.paramWTypes?.[1] ?? arrInfo.elemWType,
		);
		this.releaseTemp(sTmp, sliceW);
	}

	emitSlicesEqual(args) {
		const s1Node = args[0];
		const s2Node = args[1];
		const sType = s1Node._type ?? this._resolveExprGoType(s1Node);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const s1Tmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		const s2Tmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(s1Node, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: s1Tmp });
		this.emitExpr(s2Node, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: s2Tmp });

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.pushInstruction({ op: "block", blockType: "void" });

		// if s1 == s2 -> 1
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end");

		// if s1 == null || s2 == null -> 0 (br 0)
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// if s1.len != s2.len -> 0 (br 0)
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const lenLoc = this.acquireTemp("i32");
		const iLoc = this.acquireTemp("i32");
		const item1 = this.acquireTemp(arrInfo.elemWType);
		const item2 = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenLoc });

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// item1 = s1.arr[s1.off + i]
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: item1 });

		// item2 = s2.arr[s2.off + i]
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: item2 });

		this.emitKeyEq(item1, item2, elemGoType);
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 2 }); // mismatch -> res 0

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.releaseTemp(item2, arrInfo.elemWType);
		this.releaseTemp(item1, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenLoc, "i32");

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
		this.releaseTemp(s2Tmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.releaseTemp(s1Tmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

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

	_emitCallCmp(clTmp, closureInfo, aLoc, bLoc, arrInfo) {
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: aLoc });
		if (closureInfo.paramWTypes?.[0] === "i64" && arrInfo.elemWType === "i32") {
			this.pushInstruction("i64.extend_i32_s");
		}
		this.pushInstruction({ op: "local.get", index: bLoc });
		if (closureInfo.paramWTypes?.[1] === "i64" && arrInfo.elemWType === "i32") {
			this.pushInstruction("i64.extend_i32_s");
		}
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});
	}

	_emitCmpIsNegative(closureInfo) {
		if (closureInfo.returnWTypes?.[0] === "i32") {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction("i64.lt_s");
		}
	}

	_emitCmpIsPositive(closureInfo) {
		if (closureInfo.returnWTypes?.[0] === "i32") {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.gt_s");
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction("i64.gt_s");
		}
	}

	emitSlicesCompare(args, targetWasmType) {
		const s1Node = args[0];
		const s2Node = args[1];
		const sType = s1Node._type ?? this._resolveExprGoType(s1Node);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const s1Tmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		const s2Tmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(s1Node, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: s1Tmp });
		this.emitExpr(s2Node, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: s2Tmp });

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const arr1 = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off1 = this.acquireTemp("i32");
		const len1 = this.acquireTemp("i32");
		const arr2 = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off2 = this.acquireTemp("i32");
		const len2 = this.acquireTemp("i32");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: len1 });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: off1 });
		this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: arr1 });
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this._emitSliceUnpack(s1Tmp, sliceInfo, {
			arr: arr1,
			off: off1,
			len: len1,
		});
		this.pushInstruction("end");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: len2 });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: off2 });
		this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: arr2 });
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this._emitSliceUnpack(s2Tmp, sliceInfo, {
			arr: arr2,
			off: off2,
			len: len2,
		});
		this.pushInstruction("end");

		const minLen = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: len1 });
		this.pushInstruction({ op: "local.get", index: len2 });
		this.pushInstruction({ op: "local.get", index: len1 });
		this.pushInstruction({ op: "local.get", index: len2 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction("select");
		this.pushInstruction({ op: "local.set", index: minLen });

		const iLoc = this.acquireTemp("i32");
		const item1 = this.acquireTemp(arrInfo.elemWType);
		const item2 = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: minLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr1 });
		this.pushInstruction({ op: "local.get", index: off1 });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: item1 });

		this.pushInstruction({ op: "local.get", index: arr2 });
		this.pushInstruction({ op: "local.get", index: off2 });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: item2 });

		if (arrInfo.elemWType === "f32" || arrInfo.elemWType === "f64") {
			const isF64 = arrInfo.elemWType === "f64";
			const neOp = isF64 ? "f64.ne" : "f32.ne";
			// Check if item1 is NaN
			this.pushInstruction({ op: "local.get", index: item1 });
			this.pushInstruction({ op: "local.get", index: item1 });
			this.pushInstruction(neOp);
			this.pushInstruction({ op: "if", blockType: "void" });
			// item1 is NaN: check if item2 is also NaN
			this.pushInstruction({ op: "local.get", index: item2 });
			this.pushInstruction({ op: "local.get", index: item2 });
			this.pushInstruction(neOp);
			this.pushInstruction({ op: "if", blockType: "void" });
			// both NaN -> equal, continue to next iteration
			this.pushInstruction("else");
			// item1 is NaN, item2 is not NaN -> item1 < item2 -> -1
			this.pushInstruction({ op: "i32.const", value: -1 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 3 });
			this.pushInstruction("end");
			this.pushInstruction("else");
			// item1 is not NaN: check if item2 is NaN
			this.pushInstruction({ op: "local.get", index: item2 });
			this.pushInstruction({ op: "local.get", index: item2 });
			this.pushInstruction(neOp);
			this.pushInstruction({ op: "if", blockType: "void" });
			// item1 not NaN, item2 is NaN -> item1 > item2 -> 1
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 3 });
			this.pushInstruction("else");
			// neither is NaN, do normal emitElemLt
			this.emitElemLt(item1, item2, elemGoType);
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: -1 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 4 });
			this.pushInstruction("end");

			this.emitElemLt(item2, item1, elemGoType);
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 4 });
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("end");
		} else {
			this.emitElemLt(item1, item2, elemGoType);
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: -1 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 2 });
			this.pushInstruction("end");

			this.emitElemLt(item2, item1, elemGoType);
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 2 });
			this.pushInstruction("end");
		}

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: len1 });
		this.pushInstruction({ op: "local.get", index: len2 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: len1 });
		this.pushInstruction({ op: "local.get", index: len2 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(item2, arrInfo.elemWType);
		this.releaseTemp(item1, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(minLen, "i32");
		this.releaseTemp(len2, "i32");
		this.releaseTemp(off2, "i32");
		this.releaseTemp(arr2, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(len1, "i32");
		this.releaseTemp(off1, "i32");
		this.releaseTemp(arr1, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // ref.eq block

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
		this.releaseTemp(s2Tmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.releaseTemp(s1Tmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});

		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		}
	}

	emitSlicesSortFunc(args) {
		const sNode = args[0];
		const cmpNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const closureGoType = this._resolveExprGoType(cmpNode);
		const closureInfo = this.mod.getClosureType(closureGoType);

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};

		const s = this.acquireTemp(sliceW);
		const cl = this.acquireTemp(closureW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });
		this.emitExpr(cmpNode, closureW);
		this.pushInstruction({ op: "local.set", index: cl });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const i = this.acquireTemp("i32");
		const j = this.acquireTemp("i32");
		const jm1 = this.acquireTemp("i32");
		const valJ = this.acquireTemp(arrInfo.elemWType);
		const valJm1 = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: i });

		this.pushInstruction({ op: "loop", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.set", index: j });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jm1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: valJ });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: jm1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: valJm1 });

		this._emitCallCmp(cl, closureInfo, valJ, valJm1, arrInfo);
		this._emitCmpIsNegative(closureInfo);
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// swap arr[off + j], arr[off + jm1]
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: valJm1 });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: jm1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: valJ });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: j });
		this.pushInstruction({ op: "br", depth: 0 });

		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.tee", index: i });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		this.pushInstruction("end"); // outer loop

		this.releaseTemp(valJm1, arrInfo.elemWType);
		this.releaseTemp(valJ, arrInfo.elemWType);
		this.releaseTemp(jm1, "i32");
		this.releaseTemp(j, "i32");
		this.releaseTemp(i, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // block s != null
		this.releaseTemp(cl, closureW);
		this.releaseTemp(s, sliceW);
	}

	emitSlicesIsSorted(args) {
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

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		this._emitSliceUnpack(sliceTmp, sliceInfo, { arr, off, len });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const iLoc = this.acquireTemp("i32");
		const prevLoc = this.acquireTemp(arrInfo.elemWType);
		const currLoc = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: prevLoc });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: currLoc });

		if (arrInfo.elemWType === "f32" || arrInfo.elemWType === "f64") {
			const isF64 = arrInfo.elemWType === "f64";
			const neOp = isF64 ? "f64.ne" : "f32.ne";
			// If curr or prev is NaN, IsSorted reports false
			this.pushInstruction({ op: "local.get", index: currLoc });
			this.pushInstruction({ op: "local.get", index: currLoc });
			this.pushInstruction(neOp);
			this.pushInstruction({ op: "local.get", index: prevLoc });
			this.pushInstruction({ op: "local.get", index: prevLoc });
			this.pushInstruction(neOp);
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: resLoc });
			this.pushInstruction({ op: "br", depth: 2 });
			this.pushInstruction("end");
		}

		this.emitElemLt(currLoc, prevLoc, elemGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.releaseTemp(currLoc, arrInfo.elemWType);
		this.releaseTemp(prevLoc, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // block sliceTmp != null
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
	}

	emitSlicesIsSortedFunc(args) {
		const sNode = args[0];
		const cmpNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const closureGoType = this._resolveExprGoType(cmpNode);
		const closureInfo = this.mod.getClosureType(closureGoType);

		const clTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.emitExpr(cmpNode, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: clTmp });

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

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		this._emitSliceUnpack(sliceTmp, sliceInfo, { arr, off, len });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const iLoc = this.acquireTemp("i32");
		const prevLoc = this.acquireTemp(arrInfo.elemWType);
		const currLoc = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: prevLoc });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: currLoc });

		this._emitCallCmp(clTmp, closureInfo, currLoc, prevLoc, arrInfo);
		this._emitCmpIsNegative(closureInfo);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.releaseTemp(currLoc, arrInfo.elemWType);
		this.releaseTemp(prevLoc, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // block sliceTmp != null
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.releaseTemp(clTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
	}

	emitSlicesMinMax(args, targetWasmType, isMin) {
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

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(isMin ? "slices.Min: empty list" : "slices.Max: empty list");
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		this._emitSliceUnpack(sliceTmp, sliceInfo, { arr, off, len });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(isMin ? "slices.Min: empty list" : "slices.Max: empty list");
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		const bestLoc = this.acquireTemp(arrInfo.elemWType);
		const candLoc = this.acquireTemp(arrInfo.elemWType);
		const iLoc = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: bestLoc });

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: candLoc });

		if (arrInfo.elemWType === "f32" || arrInfo.elemWType === "f64") {
			const isF64 = arrInfo.elemWType === "f64";
			this.pushInstruction({ op: "local.get", index: candLoc });
			this.pushInstruction({ op: "local.get", index: candLoc });
			this.pushInstruction(isF64 ? "f64.ne" : "f32.ne");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: candLoc });
			this.pushInstruction({ op: "local.set", index: bestLoc });
			this.pushInstruction("else");
		}

		if (isMin) {
			this.emitElemLt(candLoc, bestLoc, elemGoType);
		} else {
			this.emitElemLt(bestLoc, candLoc, elemGoType);
		}
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: candLoc });
		this.pushInstruction({ op: "local.set", index: bestLoc });
		this.pushInstruction("end");

		if (arrInfo.elemWType === "f32" || arrInfo.elemWType === "f64") {
			const isF64 = arrInfo.elemWType === "f64";
			const reinterpretOp = isF64
				? "i64.reinterpret_f64"
				: "i32.reinterpret_f32";
			const zeroConst = isF64
				? { op: "i64.const", value: 0n }
				: { op: "i32.const", value: 0 };
			const ltSOp = isF64 ? "i64.lt_s" : "i32.lt_s";
			const zeroF = isF64
				? { op: "f64.const", value: 0 }
				: { op: "f32.const", value: 0 };
			const eqF = isF64 ? "f64.eq" : "f32.eq";

			// if (cand == 0 && best == 0)
			this.pushInstruction({ op: "local.get", index: candLoc });
			this.pushInstruction(zeroF);
			this.pushInstruction(eqF);
			this.pushInstruction({ op: "local.get", index: bestLoc });
			this.pushInstruction(zeroF);
			this.pushInstruction(eqF);
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			if (isMin) {
				// if cand has signbit and best does not -> best = cand
				this.pushInstruction({ op: "local.get", index: candLoc });
				this.pushInstruction(reinterpretOp);
				this.pushInstruction(zeroConst);
				this.pushInstruction(ltSOp);
				this.pushInstruction({ op: "local.get", index: bestLoc });
				this.pushInstruction(reinterpretOp);
				this.pushInstruction(zeroConst);
				this.pushInstruction(ltSOp);
				this.pushInstruction("i32.eqz");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: candLoc });
				this.pushInstruction({ op: "local.set", index: bestLoc });
				this.pushInstruction("end");
			} else {
				// if best has signbit and cand does not -> best = cand
				this.pushInstruction({ op: "local.get", index: bestLoc });
				this.pushInstruction(reinterpretOp);
				this.pushInstruction(zeroConst);
				this.pushInstruction(ltSOp);
				this.pushInstruction({ op: "local.get", index: candLoc });
				this.pushInstruction(reinterpretOp);
				this.pushInstruction(zeroConst);
				this.pushInstruction(ltSOp);
				this.pushInstruction("i32.eqz");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: candLoc });
				this.pushInstruction({ op: "local.set", index: bestLoc });
				this.pushInstruction("end");
			}
			this.pushInstruction("end");
		}

		if (arrInfo.elemWType === "f32" || arrInfo.elemWType === "f64") {
			this.pushInstruction("end");
		}

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(candLoc, arrInfo.elemWType);
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: bestLoc });
		this.releaseTemp(bestLoc, arrInfo.elemWType);
		if (targetWasmType === "i64" && arrInfo.elemWType === "i32") {
			this.pushInstruction(
				isSigned(elemGoType) ? "i64.extend_i32_s" : "i64.extend_i32_u",
			);
		} else if (targetWasmType === "f64" && arrInfo.elemWType === "f32") {
			this.pushInstruction("f64.promote_f32");
		}
	}

	emitSlicesMinMaxFunc(args, targetWasmType, isMin) {
		const sNode = args[0];
		const cmpNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const closureGoType = this._resolveExprGoType(cmpNode);
		const closureInfo = this.mod.getClosureType(closureGoType);

		const clTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.emitExpr(cmpNode, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: clTmp });

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

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(
			isMin ? "slices.MinFunc: empty list" : "slices.MaxFunc: empty list",
		);
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		this._emitSliceUnpack(sliceTmp, sliceInfo, { arr, off, len });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(
			isMin ? "slices.MinFunc: empty list" : "slices.MaxFunc: empty list",
		);
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		const bestLoc = this.acquireTemp(arrInfo.elemWType);
		const candLoc = this.acquireTemp(arrInfo.elemWType);
		const iLoc = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: bestLoc });

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: candLoc });

		this._emitCallCmp(clTmp, closureInfo, candLoc, bestLoc, arrInfo);
		if (isMin) {
			this._emitCmpIsNegative(closureInfo);
		} else {
			this._emitCmpIsPositive(closureInfo);
		}
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: candLoc });
		this.pushInstruction({ op: "local.set", index: bestLoc });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(candLoc, arrInfo.elemWType);
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.releaseTemp(clTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: bestLoc });
		this.releaseTemp(bestLoc, arrInfo.elemWType);
		if (targetWasmType === "i64" && arrInfo.elemWType === "i32") {
			this.pushInstruction(
				isSigned(elemGoType) ? "i64.extend_i32_s" : "i64.extend_i32_u",
			);
		} else if (targetWasmType === "f64" && arrInfo.elemWType === "f32") {
			this.pushInstruction("f64.promote_f32");
		}
	}

	emitSlicesCompact(args, isFunc = false) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		let clTmp, closureInfo;
		if (isFunc) {
			const closureGoType = this._resolveExprGoType(args[1]);
			closureInfo = this.mod.getClosureType(closureGoType);
			clTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});
			this.emitExpr(args[1], {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: clTmp });
		}

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const sliceTmp = this.acquireTemp(sliceW);
		this.emitExpr(sNode, sliceW);
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

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const cap = this.acquireTemp("i32");
		this._emitSliceUnpack(sliceTmp, sliceInfo, { arr, off, len, cap });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({
			op: "if",
			blockType: {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			},
		});
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("else");

		const dst = this.acquireTemp("i32");
		const src = this.acquireTemp("i32");
		const curr = this.acquireTemp(arrInfo.elemWType);
		const prev = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: dst });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: src });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: src });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: prev });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: src });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: curr });

		if (isFunc) {
			this.pushInstruction({ op: "local.get", index: clTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: closureInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.get", index: curr });
			this.pushInstruction({ op: "local.get", index: prev });
			this.pushInstruction({ op: "local.get", index: clTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: closureInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({
				op: "call_ref",
				typeIndex: closureInfo.funcTypeIndex,
			});
		} else {
			this.emitKeyEq(curr, prev, elemGoType);
		}

		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: curr });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: dst });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: src });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: src });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(prev, arrInfo.elemWType);
		this.releaseTemp(curr, arrInfo.elemWType);
		this.releaseTemp(src, "i32");
		this.releaseTemp(dst, "i32");
		this.pushInstruction("end"); // end if len <= 1

		this.releaseTemp(cap, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction("end"); // end if sliceTmp == null

		this.releaseTemp(sliceTmp, sliceW);
		if (isFunc) {
			this.releaseTemp(clTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});
		}
	}

	emitSlicesConcat(args, targetWasmType) {
		if (args.length === 0) {
			const typeIndex =
				typeof targetWasmType === "object" && targetWasmType !== null
					? targetWasmType.typeIndex
					: null;
			const sliceInfo =
				typeIndex !== null ? this.mod.getSliceTypeByIndex(typeIndex) : null;
			if (sliceInfo) {
				this.pushInstruction({
					op: "global.get",
					index: sliceInfo.emptyGlobalIndex,
				});
				return;
			}
			this.pushInstruction({
				op: "ref.null",
				heapType: typeIndex ?? "any",
			});
			return;
		}

		const s0Node = args[0];
		const sType = s0Node._type ?? this._resolveExprGoType(s0Node);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const sTmps = args.map((argNode) => {
			const tmp = this.acquireTemp(sliceW);
			this.emitExpr(argNode, sliceW);
			this.pushInstruction({ op: "local.set", index: tmp });
			return tmp;
		});

		const totalLen = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: totalLen });

		for (const tmp of sTmps) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: totalLen });
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: totalLen });
			this.pushInstruction("end");
		}

		const newArr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: totalLen });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newArr });

		const dstOff = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: dstOff });

		const curLen = this.acquireTemp("i32");
		for (const tmp of sTmps) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.tee", index: curLen });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.gt_s");
			this.pushInstruction({ op: "if", blockType: "void" });

			this.pushInstruction({ op: "local.get", index: newArr });
			this.pushInstruction({ op: "local.get", index: dstOff });
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.get", index: curLen });
			this._emitArrayCopy(arrInfo, elemGoType);

			this.pushInstruction({ op: "local.get", index: dstOff });
			this.pushInstruction({ op: "local.get", index: curLen });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: dstOff });
			this.pushInstruction("end"); // if curLen > 0

			this.pushInstruction("end"); // if tmp != null
		}
		this.releaseTemp(curLen, "i32");
		this.releaseTemp(dstOff, "i32");

		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: totalLen });
		this.pushInstruction({ op: "local.get", index: totalLen });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newArr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(totalLen, "i32");

		for (const tmp of sTmps) {
			this.releaseTemp(tmp, sliceW);
		}
	}

	emitSlicesDelete(args) {
		const sNode = args[0];
		const iNode = args[1];
		const jNode = args[2];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const s = this.acquireTemp(sliceW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const cap = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: cap });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: off });
		this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: arr });
		this.pushInstruction("else");
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len, cap });
		this.pushInstruction("end");

		const iTmp = this.acquireTemp("i32");
		const jTmp = this.acquireTemp("i32");
		this.emitExpr(iNode, "i32");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.emitExpr(jNode, "i32");
		this.pushInstruction({ op: "local.set", index: jTmp });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.eq");
		this.pushInstruction({
			op: "if",
			blockType: {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			},
		});
		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("else");

		const dTmp = this.acquireTemp("i32");
		const newLen = this.acquireTemp("i32");
		const numToShift = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: dTmp });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: newLen });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.tee", index: numToShift });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: numToShift });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		const kTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.set", index: kTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");
		this.emitZeroValue(elemGoType, arrInfo.elemWType);
		this.pushInstruction({
			op: "array.set",
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(kTmp, "i32");
		this.releaseTemp(numToShift, "i32");
		this.releaseTemp(newLen, "i32");
		this.releaseTemp(dTmp, "i32");
		this.pushInstruction("end"); // end if i == j

		this.releaseTemp(jTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(cap, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(s, sliceW);
	}

	emitSlicesDeleteFunc(args) {
		const sNode = args[0];
		const delNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const closureGoType = this._resolveExprGoType(delNode);
		const closureInfo = this.mod.getClosureType(closureGoType);

		const clTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.emitExpr(delNode, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: clTmp });

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const s = this.acquireTemp(sliceW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });

		this.pushInstruction({ op: "local.get", index: s });
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

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const cap = this.acquireTemp("i32");
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len, cap });

		const dst = this.acquireTemp("i32");
		const src = this.acquireTemp("i32");
		const item = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: dst });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: src });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: src });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: src });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: item });

		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: item });
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: item });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: dst });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: src });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: src });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		const kTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction({ op: "local.set", index: kTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");
		this.emitZeroValue(elemGoType, arrInfo.elemWType);
		this.pushInstruction({
			op: "array.set",
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(kTmp, "i32");
		this.releaseTemp(item, arrInfo.elemWType);
		this.releaseTemp(src, "i32");
		this.releaseTemp(dst, "i32");
		this.releaseTemp(cap, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction("end"); // end if s == null

		this.releaseTemp(s, sliceW);
		this.releaseTemp(clTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
	}

	emitSlicesInsert(args) {
		const sNode = args[0];
		const iNode = args[1];
		const vNodes = args.slice(2);
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const s = this.acquireTemp(sliceW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const cap = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: cap });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: off });
		this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: arr });
		this.pushInstruction("else");
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len, cap });
		this.pushInstruction("end");

		const iTmp = this.acquireTemp("i32");
		this.emitExpr(iNode, "i32");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		const k = vNodes.length;
		if (k === 0) {
			this.pushInstruction({ op: "local.get", index: s });
			this.releaseTemp(iTmp, "i32");
			this.releaseTemp(cap, "i32");
			this.releaseTemp(len, "i32");
			this.releaseTemp(off, "i32");
			this.releaseTemp(arr, {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			});
			this.releaseTemp(s, sliceW);
			return;
		}

		const vTmps = vNodes.map((vNode) => {
			const tmp = this.acquireTemp(arrInfo.elemWType);
			this.emitExpr(vNode, arrInfo.elemWType);
			this._emitCopyIfValue(vNode, elemGoType, arrInfo.elemWType);
			this.pushInstruction({ op: "local.set", index: tmp });
			return tmp;
		});

		const newLen = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: k });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: newLen });

		const numToShift = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: numToShift });

		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction("i32.le_u");
		this.pushInstruction({
			op: "if",
			blockType: {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			},
		});

		this.pushInstruction({ op: "local.get", index: numToShift });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: k });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: numToShift });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		for (let m = 0; m < k; m++) {
			this.pushInstruction({ op: "local.get", index: arr });
			this.pushInstruction({ op: "local.get", index: off });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			if (m > 0) {
				this.pushInstruction({ op: "i32.const", value: m });
				this.pushInstruction("i32.add");
			}
			this.pushInstruction({ op: "local.get", index: vTmps[m] });
			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});
		}

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.pushInstruction("else");

		const newCap = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.set", index: newCap });

		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.set", index: newCap });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.lt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction({ op: "local.set", index: newCap });
		this.pushInstruction("end");

		const newArr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newArr });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		for (let m = 0; m < k; m++) {
			this.pushInstruction({ op: "local.get", index: newArr });
			this.pushInstruction({ op: "local.get", index: iTmp });
			if (m > 0) {
				this.pushInstruction({ op: "i32.const", value: m });
				this.pushInstruction("i32.add");
			}
			this.pushInstruction({ op: "local.get", index: vTmps[m] });
			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});
		}

		this.pushInstruction({ op: "local.get", index: numToShift });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: k });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: numToShift });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newArr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(newCap, "i32");
		this.pushInstruction("end"); // end if newLen <= cap

		this.releaseTemp(numToShift, "i32");
		this.releaseTemp(newLen, "i32");
		for (const tmp of vTmps) {
			this.releaseTemp(tmp, arrInfo.elemWType);
		}
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(cap, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(s, sliceW);
	}

	emitSlicesReplace(args) {
		const sNode = args[0];
		const iNode = args[1];
		const jNode = args[2];
		const vNodes = args.slice(3);
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const s = this.acquireTemp(sliceW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const cap = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: cap });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: off });
		this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: arr });
		this.pushInstruction("else");
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len, cap });
		this.pushInstruction("end");

		const iTmp = this.acquireTemp("i32");
		const jTmp = this.acquireTemp("i32");
		this.emitExpr(iNode, "i32");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.emitExpr(jNode, "i32");
		this.pushInstruction({ op: "local.set", index: jTmp });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		const k = vNodes.length;
		const vTmps = vNodes.map((vNode) => {
			const tmp = this.acquireTemp(arrInfo.elemWType);
			this.emitExpr(vNode, arrInfo.elemWType);
			this._emitCopyIfValue(vNode, elemGoType, arrInfo.elemWType);
			this.pushInstruction({ op: "local.set", index: tmp });
			return tmp;
		});

		const oldRangeLen = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: oldRangeLen });

		const delta = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: k });
		this.pushInstruction({ op: "local.get", index: oldRangeLen });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: delta });

		const newLen = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: delta });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: newLen });

		const tailCount = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: tailCount });

		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction("i32.le_u");
		this.pushInstruction({
			op: "if",
			blockType: {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			},
		});

		this.pushInstruction({ op: "local.get", index: tailCount });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "local.get", index: delta });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ne");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: k });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: tailCount });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		for (let m = 0; m < k; m++) {
			this.pushInstruction({ op: "local.get", index: arr });
			this.pushInstruction({ op: "local.get", index: off });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			if (m > 0) {
				this.pushInstruction({ op: "i32.const", value: m });
				this.pushInstruction("i32.add");
			}
			this.pushInstruction({ op: "local.get", index: vTmps[m] });
			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});
		}

		this.pushInstruction({ op: "local.get", index: delta });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		const mTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.set", index: mTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction("i32.add");
		this.emitZeroValue(elemGoType, arrInfo.elemWType);
		this.pushInstruction({
			op: "array.set",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: mTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block
		this.releaseTemp(mTmp, "i32");
		this.pushInstruction("end"); // if delta < 0

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.pushInstruction("else");

		const newCap = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.set", index: newCap });

		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.set", index: newCap });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.lt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction({ op: "local.set", index: newCap });
		this.pushInstruction("end");

		const newArr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newArr });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		for (let m = 0; m < k; m++) {
			this.pushInstruction({ op: "local.get", index: newArr });
			this.pushInstruction({ op: "local.get", index: iTmp });
			if (m > 0) {
				this.pushInstruction({ op: "i32.const", value: m });
				this.pushInstruction("i32.add");
			}
			this.pushInstruction({ op: "local.get", index: vTmps[m] });
			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});
		}

		this.pushInstruction({ op: "local.get", index: tailCount });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: k });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: tailCount });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newArr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(newCap, "i32");
		this.pushInstruction("end"); // end if newLen <= cap

		this.releaseTemp(tailCount, "i32");
		this.releaseTemp(newLen, "i32");
		this.releaseTemp(delta, "i32");
		this.releaseTemp(oldRangeLen, "i32");
		for (const tmp of vTmps) {
			this.releaseTemp(tmp, arrInfo.elemWType);
		}
		this.releaseTemp(jTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(cap, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(s, sliceW);
	}

	emitSlicesGrow(args) {
		const sNode = args[0];
		const nNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const s = this.acquireTemp(sliceW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });

		const nTmp = this.acquireTemp("i32");
		this.emitExpr(nNode, "i32");
		this.pushInstruction({ op: "local.set", index: nTmp });

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic("runtime error: makeslice: len out of range");
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const cap = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: cap });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: off });
		this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: arr });
		this.pushInstruction("else");
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len, cap });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.ge_u");
		this.pushInstruction({
			op: "if",
			blockType: {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			},
		});
		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("else");

		const targetCap = this.acquireTemp("i32");
		const newCap = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.tee", index: targetCap });
		this.pushInstruction({ op: "local.get", index: cap });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.tee", index: newCap });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: targetCap });
		this.pushInstruction({ op: "local.set", index: newCap });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.lt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction({ op: "local.set", index: newCap });
		this.pushInstruction("end");

		const newArr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newArr });

		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: len });
		this._emitArrayCopy(arrInfo, elemGoType);
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: newCap });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newArr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(newCap, "i32");
		this.releaseTemp(targetCap, "i32");
		this.pushInstruction("end"); // end if cap - len >= n

		this.releaseTemp(cap, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(nTmp, "i32");
		this.releaseTemp(s, sliceW);
	}

	emitSlicesClip(args) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const s = this.acquireTemp(sliceW);
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });

		this.pushInstruction({ op: "local.get", index: s });
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

		const arr = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len });

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction("end"); // end if null

		this.releaseTemp(s, sliceW);
	}

	emitStringsCall(name, args, targetWasmType) {
		switch (name) {
			case "ToUpper": {
				this.emitExpr(args[0], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringToUpperImportIndex(),
				});
				return;
			}
			case "ToLower": {
				this.emitExpr(args[0], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringToLowerImportIndex(),
				});
				return;
			}
			case "TrimSpace": {
				this.emitExpr(args[0], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringTrimSpaceImportIndex(),
				});
				return;
			}
			case "Contains": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringContainsImportIndex(),
				});
				return;
			}
			case "HasPrefix": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringHasPrefixImportIndex(),
				});
				return;
			}
			case "HasSuffix": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringHasSuffixImportIndex(),
				});
				return;
			}
			case "Index": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringIndexImportIndex(),
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "LastIndex": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringLastIndexImportIndex(),
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "Repeat": {
				this.emitExpr(args[0], "externref");
				const cntWType = toWasmType(args[1]?._type, this.mod.checker);
				if (cntWType === "i64") {
					this.emitExpr(args[1], "i64");
					this.pushInstruction("i32.wrap_i64");
				} else {
					this.emitExpr(args[1], "i32");
				}
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringRepeatImportIndex(),
				});
				return;
			}
			case "ReplaceAll": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.emitExpr(args[2], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringReplaceAllImportIndex(),
				});
				return;
			}
			case "EqualFold": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringEqualFoldImportIndex(),
				});
				return;
			}
			case "Count": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCountImportIndex(),
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "Trim":
			case "TrimLeft":
			case "TrimRight":
			case "TrimPrefix":
			case "TrimSuffix":
			case "ContainsAny":
			case "IndexAny": {
				const imp = {
					Trim: "str_trim",
					TrimLeft: "str_trim_left",
					TrimRight: "str_trim_right",
					TrimPrefix: "str_trim_prefix",
					TrimSuffix: "str_trim_suffix",
					ContainsAny: "str_contains_any",
					IndexAny: "str_index_any",
				}[name];
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._callStdlib(imp);
				if (name === "IndexAny" && (targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "ContainsRune":
			case "IndexByte":
			case "IndexRune":
			case "LastIndexByte": {
				const imp = {
					ContainsRune: "str_contains_rune",
					IndexByte: "str_index_byte",
					IndexRune: "str_index_rune",
					LastIndexByte: "str_last_index_byte",
				}[name];
				this.emitExpr(args[0], "externref");
				this._emitI32Arg(args[1]);
				this._callStdlib(imp);
				if (name !== "ContainsRune" && (targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "Title":
			case "ToTitle": {
				this.emitExpr(args[0], "externref");
				this._callStdlib(name === "Title" ? "str_title" : "str_to_upper");
				return;
			}
			case "Cut": {
				const foundTmp = this.acquireTemp("i32");
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._callStdlib("str_cut");
				this.pushInstruction({ op: "local.set", index: foundTmp });
				this._callStdlib("str_cut_before");
				this._callStdlib("str_cut_after");
				this.pushInstruction({ op: "local.get", index: foundTmp });
				this.releaseTemp(foundTmp, "i32");
				return;
			}
			case "CutPrefix": {
				const foundTmp = this.acquireTemp("i32");
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._callStdlib("str_cut_prefix");
				this.pushInstruction({ op: "local.set", index: foundTmp });
				this._callStdlib("str_cut_after");
				this.pushInstruction({ op: "local.get", index: foundTmp });
				this.releaseTemp(foundTmp, "i32");
				return;
			}
			case "CutSuffix": {
				const foundTmp = this.acquireTemp("i32");
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._callStdlib("str_cut_suffix");
				this.pushInstruction({ op: "local.set", index: foundTmp });
				this._callStdlib("str_cut_before");
				this.pushInstruction({ op: "local.get", index: foundTmp });
				this.releaseTemp(foundTmp, "i32");
				return;
			}
			case "Replace": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.emitExpr(args[2], "externref");
				this._emitI32Arg(args[3]);
				this._callStdlib("str_replace");
				return;
			}
			case "Split":
			case "Fields": {
				// JS splits and parks the parts; wasm pulls them into a []string.
				this.emitExpr(args[0], "externref");
				if (name === "Split") {
					this.emitExpr(args[1], "externref");
					this._callStdlib("str_split");
				} else {
					this._callStdlib("str_fields");
				}
				this._emitCollectStringParts();
				return;
			}
			case "FieldsFunc":
				this.emitStringsFieldsFunc(args);
				return;
			case "SplitN": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._emitI32Arg(args[2]);
				this._callStdlib("str_split_n");
				this._emitCollectStringParts(true);
				return;
			}
			case "SplitAfter": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._callStdlib("str_split_after");
				this._emitCollectStringParts();
				return;
			}
			case "SplitAfterN": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._emitI32Arg(args[2]);
				this._callStdlib("str_split_after_n");
				this._emitCollectStringParts(true);
				return;
			}
			case "LastIndexAny": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this._callStdlib("str_last_index_any");
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "IndexFunc":
				this.emitStringsIndexFunc(args, targetWasmType, false);
				return;
			case "LastIndexFunc":
				this.emitStringsIndexFunc(args, targetWasmType, true);
				return;
			case "TrimFunc":
			case "TrimLeftFunc":
			case "TrimRightFunc":
				this.emitStringsTrimFunc(name, args);
				return;
			case "Map":
				this.emitStringsMap(args);
				return;
			case "NewReplacer":
				this.emitStringsNewReplacer(args);
				return;
			case "Join":
				this.emitStringsJoin(args);
				return;
			default:
				throw new Error(`Unsupported strings function: strings.${name}`);
		}
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

	// Consumes the part count (i32) left by str_split/str_fields and builds a
	// `[]string` by calling `str_part(i)` for each index.
	_emitCollectStringParts(canBeNil = false) {
		const strGo = { kind: "basic", name: "string" };
		const sliceInfo = this.mod.getSliceType(strGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const n = this.acquireTemp("i32");
		const i = this.acquireTemp("i32");
		const arr = this.acquireTemp(arrW);

		this.pushInstruction({ op: "local.set", index: n });
		if (canBeNil) {
			this.pushInstruction({ op: "local.get", index: n });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "if", blockType: sliceW });
			this.pushInstruction({
				op: "global.get",
				index: sliceInfo.emptyGlobalIndex,
			});
			this.pushInstruction("else");
		}
		this.pushInstruction({ op: "local.get", index: n });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: arr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: i });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.get", index: n });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.get", index: i });
		this._callStdlib("str_part");
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: n });
		this.pushInstruction({ op: "local.get", index: n });
		this.pushInstruction({ op: "struct.new", typeIndex: sliceInfo.typeIndex });

		if (canBeNil) {
			this.pushInstruction("end");
		}

		this.releaseTemp(arr, arrW);
		this.releaseTemp(i, "i32");
		this.releaseTemp(n, "i32");
	}

	emitStringsJoin(args) {
		const strGo = { kind: "basic", name: "string" };
		const sliceInfo = this.mod.getSliceType(strGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const s = this.acquireTemp(sliceW);
		const arr = this.acquireTemp(arrW);
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const i = this.acquireTemp("i32");
		const sep = this.acquireTemp("externref");
		const acc = this.acquireTemp("externref");
		const concat = this.mod.getStringConcatImportIndex();

		this.emitExpr(args[0], sliceW);
		this.pushInstruction({ op: "local.set", index: s });
		this.emitExpr(args[1], "externref");
		this.pushInstruction({ op: "local.set", index: sep });
		// acc = ""
		this.pushInstruction({ op: "i32.const", value: this.mod.internString("") });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: acc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });
		// if i > 0: acc = acc + sep
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: acc });
		this.pushInstruction({ op: "local.get", index: sep });
		this.pushInstruction({ op: "call", funcIndex: concat });
		this.pushInstruction({ op: "local.set", index: acc });
		this.pushInstruction("end");
		// acc = acc + arr[off+i]
		this.pushInstruction({ op: "local.get", index: acc });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "call", funcIndex: concat });
		this.pushInstruction({ op: "local.set", index: acc });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: acc });

		this.releaseTemp(acc, "externref");
		this.releaseTemp(sep, "externref");
		this.releaseTemp(i, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, arrW);
		this.releaseTemp(s, sliceW);
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
				this.emitExpr(args[0], "externref");
				this._emitI32Arg(args[1]);
				this._emitI32Arg(args[2]);
				this._callStdlib("strconv_parse_uint");
				this._emitStrconvError();
				return;
			}
			case "Atoi":
			case "ParseInt":
			case "ParseFloat":
			case "ParseBool": {
				// (value, error): the JS side records a failure message that
				// `strconv_err` returns (null on success) → runtime error value.
				this.emitExpr(args[0], "externref");
				if (name === "Atoi") this._callStdlib("strconv_atoi");
				else if (name === "ParseInt") {
					this._emitI32Arg(args[1]);
					this._emitI32Arg(args[2]);
					this._callStdlib("strconv_parse_int");
				} else if (name === "ParseFloat")
					this._callStdlib("strconv_parse_float");
				else this._callStdlib("strconv_parse_bool");
				this._emitStrconvError();
				return;
			}
			default:
				throw new Error(`Unsupported strconv function: strconv.${name}`);
		}
	}

	_emitStrconvError() {
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

		this.pushInstruction({ op: "local.get", index: msgTmp });
		this.pushInstruction({ op: "local.get", index: causeTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});

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

	emitStringsIndexFunc(args, targetWasmType, isLast) {
		const sNode = args[0];
		const fNode = args[1];
		const sTmp = this.acquireTemp("externref");
		this.emitExpr(sNode, "externref");
		this.pushInstruction({ op: "local.set", index: sTmp });

		const closureGoType = this._resolveExprGoType(fNode);
		const closureInfo = this.mod.getClosureType(closureGoType);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};
		const clTmp = this.acquireTemp(closureW);
		this.emitExpr(fNode, closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		const lenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		const cpTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// cp = s.codePointAt(i)
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringCodePointAtImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: cpTmp });

		// call f(cp)
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: cpTmp });
		if (closureInfo.paramWTypes[0] === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		// if f(cp)
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.set", index: resTmp });
		if (!isLast) {
			this.pushInstruction({ op: "br", depth: 2 }); // break loop
		}
		this.pushInstruction("end");

		// advance i += (cp > 0xffff ? 2 : 1)
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: cpTmp });
		this.pushInstruction({ op: "i32.const", value: 65535 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("end");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });
		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		}

		this.releaseTemp(cpTmp, "i32");
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(clTmp, closureW);
		this.releaseTemp(sTmp, "externref");
	}

	emitStringsFieldsFunc(args) {
		const sNode = args[0];
		const fNode = args[1];
		const strGo = { kind: "basic", name: "string" };
		const sliceInfo = this.mod.getSliceType(strGo);
		const arrInfo = sliceInfo.arrInfo;

		const closureGoType = this._resolveExprGoType(fNode);
		const closureInfo = this.mod.getClosureType(closureGoType);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};

		const sTmp = this.acquireTemp("externref");
		const clTmp = this.acquireTemp(closureW);
		this.emitExpr(sNode, "externref");
		this.pushInstruction({ op: "local.set", index: sTmp });
		this.emitExpr(fNode, closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		const lenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

		// Pass 1: count fields
		const wordCntTmp = this.acquireTemp("i32");
		const inWordTmp = this.acquireTemp("i32");
		const iTmp = this.acquireTemp("i32");
		const cpTmp = this.acquireTemp("i32");
		const stepTmp = this.acquireTemp("i32");
		const isSepTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// cp = s.codePointAt(i)
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringCodePointAtImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: cpTmp });

		// step = cp > 0xffff ? 2 : 1
		this.pushInstruction({ op: "local.get", index: cpTmp });
		this.pushInstruction({ op: "i32.const", value: 0xffff });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: stepTmp });

		// isSep = f(cp)
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: cpTmp });
		if (closureInfo.paramWTypes[0] === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: isSepTmp });

		// if isSep: inWord = 0 else: if !inWord { inWord = 1; wordCnt++; }
		this.pushInstruction({ op: "local.get", index: isSepTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wordCntTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: stepTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// Allocate result slice
		const resArrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: resArrTmp });

		// Pass 2: fill array
		const wIdxTmp = this.acquireTemp("i32");
		const fieldStartTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: fieldStartTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringCodePointAtImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: cpTmp });

		this.pushInstruction({ op: "local.get", index: cpTmp });
		this.pushInstruction({ op: "i32.const", value: 0xffff });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: stepTmp });

		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: cpTmp });
		if (closureInfo.paramWTypes[0] === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: isSepTmp });

		this.pushInstruction({ op: "local.get", index: isSepTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		// isSep: if fieldStart != -1: emit slice and reset fieldStart = -1
		this.pushInstruction({ op: "local.get", index: fieldStartTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: fieldStartTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringSliceImportIndex(),
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: fieldStartTmp });
		this.pushInstruction("end");
		this.pushInstruction("else");
		// not sep: if fieldStart == -1: fieldStart = i
		this.pushInstruction({ op: "local.get", index: fieldStartTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.set", index: fieldStartTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: stepTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// If string ended inside a word: emit final slice
		this.pushInstruction({ op: "local.get", index: fieldStartTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: fieldStartTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringSliceImportIndex(),
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction("end");

		// Return slice struct: { arr, off: 0, len: wordCnt, cap: wordCnt }
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(fieldStartTmp, "i32");
		this.releaseTemp(wIdxTmp, "i32");
		this.releaseTemp(resArrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(isSepTmp, "i32");
		this.releaseTemp(stepTmp, "i32");
		this.releaseTemp(cpTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(inWordTmp, "i32");
		this.releaseTemp(wordCntTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(clTmp, closureW);
		this.releaseTemp(sTmp, "externref");
	}

	emitStringsTrimFunc(name, args) {
		const sNode = args[0];
		const fNode = args[1];
		const sTmp = this.acquireTemp("externref");
		this.emitExpr(sNode, "externref");
		this.pushInstruction({ op: "local.set", index: sTmp });

		const closureGoType = this._resolveExprGoType(fNode);
		const closureInfo = this.mod.getClosureType(closureGoType);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};
		const clTmp = this.acquireTemp(closureW);
		this.emitExpr(fNode, closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		const lenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		const lTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: lTmp });

		const rTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: rTmp });

		const cpTmp = this.acquireTemp("i32");
		const nextITmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// cp = s.codePointAt(i)
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringCodePointAtImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: cpTmp });

		// nextI = i + (cp > 0xffff ? 2 : 1)
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: cpTmp });
		this.pushInstruction({ op: "i32.const", value: 65535 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("end");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: nextITmp });

		// call f(cp)
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: cpTmp });
		if (closureInfo.paramWTypes[0] === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		// if !f(cp)
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		// if (l == -1) l = i;
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.set", index: lTmp });
		this.pushInstruction("end");
		// r = nextI;
		this.pushInstruction({ op: "local.get", index: nextITmp });
		this.pushInstruction({ op: "local.set", index: rTmp });
		if (name === "TrimLeftFunc") {
			this.pushInstruction({ op: "br", depth: 2 });
		}
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: nextITmp });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// if (l == -1) return "";
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "externref" });
		this.pushInstruction({ op: "i32.const", value: this.mod.internString("") });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this.pushInstruction("else");

		// str_slice(s, start, end)
		this.pushInstruction({ op: "local.get", index: sTmp });
		if (name === "TrimRightFunc") {
			this.pushInstruction({ op: "i32.const", value: 0 });
		} else {
			this.pushInstruction({ op: "local.get", index: lTmp });
		}
		if (name === "TrimLeftFunc") {
			this.pushInstruction({ op: "local.get", index: lenTmp });
		} else {
			this.pushInstruction({ op: "local.get", index: rTmp });
		}
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringSliceImportIndex(),
		});
		this.pushInstruction("end");

		this.releaseTemp(nextITmp, "i32");
		this.releaseTemp(cpTmp, "i32");
		this.releaseTemp(rTmp, "i32");
		this.releaseTemp(lTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(clTmp, closureW);
		this.releaseTemp(sTmp, "externref");
	}

	emitStringsMap(args) {
		const fNode = args[0];
		const sNode = args[1];
		const closureGoType = this._resolveExprGoType(fNode);
		const closureInfo = this.mod.getClosureType(closureGoType);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};
		const clTmp = this.acquireTemp(closureW);
		this.emitExpr(fNode, closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		const sTmp = this.acquireTemp("externref");
		this.emitExpr(sNode, "externref");
		this.pushInstruction({ op: "local.set", index: sTmp });

		const lenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

		const accTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "i32.const", value: this.mod.internString("") });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: accTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		const cpTmp = this.acquireTemp("i32");
		const resTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// cp = s.codePointAt(i)
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringCodePointAtImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: cpTmp });

		// call f(cp)
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: cpTmp });
		if (closureInfo.paramWTypes[0] === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});
		if (closureInfo.returnWTypes[0] === "i64") {
			this.pushInstruction("i32.wrap_i64");
		}
		this.pushInstruction({ op: "local.set", index: resTmp });

		// if res >= 0
		this.pushInstruction({ op: "local.get", index: resTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: accTmp });
		this.pushInstruction({ op: "local.get", index: resTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringFromCodePointImportIndex(),
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringConcatImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: accTmp });
		this.pushInstruction("end");

		// advance i += (cp > 0xffff ? 2 : 1)
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: cpTmp });
		this.pushInstruction({ op: "i32.const", value: 65535 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("end");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: accTmp });

		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(cpTmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(accTmp, "externref");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(sTmp, "externref");
		this.releaseTemp(clTmp, closureW);
	}

	emitStringsNewReplacer(args) {
		const strGo = { kind: "basic", name: "string" };
		const sliceInfo = this.mod.getSliceType(strGo);
		const arrInfo = sliceInfo.arrInfo;
		const replacerInfo = this.mod.getStructType("strings.Replacer");
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const arrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "i32.const", value: args.length });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		for (let i = 0; i < args.length; i++) {
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "i32.const", value: i });
			this.emitExpr(args[i], "externref");
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
		}

		// struct.new sliceInfo (arr, 0, len, len)
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: args.length });
		this.pushInstruction({ op: "i32.const", value: args.length });
		this.pushInstruction({ op: "struct.new", typeIndex: sliceInfo.typeIndex });

		// struct.new replacerInfo (pairs)
		this.pushInstruction({
			op: "struct.new",
			typeIndex: replacerInfo.typeIndex,
		});
		this.releaseTemp(arrTmp, arrW);
	}

	emitReplacerMethodCall(method, recvExpr, args, _targetWasmType) {
		if (method === "Replace") {
			const strGo = { kind: "basic", name: "string" };
			const sliceInfo = this.mod.getSliceType(strGo);
			const arrInfo = sliceInfo.arrInfo;
			const replacerInfo = this.mod.getStructType("strings.Replacer");
			const replacerW = {
				kind: "ref",
				nullable: true,
				typeIndex: replacerInfo.typeIndex,
			};
			const arrW = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};

			const rTmp = this.acquireTemp(replacerW);
			this.emitExpr(recvExpr, replacerW);
			this.pushInstruction({ op: "local.set", index: rTmp });

			const sTmp = this.acquireTemp("externref");
			this.emitExpr(args[0], "externref");
			this.pushInstruction({ op: "local.set", index: sTmp });

			this.pushInstruction({ op: "local.get", index: sTmp });
			this._callStdlib("str_replacer_init");

			const sliceW = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const pairsTmp = this.acquireTemp(sliceW);
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: replacerInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: pairsTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");
			const capTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(pairsTmp, sliceInfo, {
				arr: arrTmp,
				off: offTmp,
				len: lenTmp,
				cap: capTmp,
			});
			this.releaseTemp(capTmp, "i32");
			this.releaseTemp(pairsTmp, sliceW);

			const iTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iTmp });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this._callStdlib("str_replacer_add");

			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iTmp });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this._callStdlib("str_replacer_run");

			this.releaseTemp(iTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(sTmp, "externref");
			this.releaseTemp(rTmp, replacerW);
			return;
		}
		throw new Error(`Unsupported Replacer method: ${method}`);
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

	emitFmtCall(name, args) {
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
				const temps = this._emitArgBuffer(operands);
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
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				const isLast = i === args.length - 1 && isPrintln;
				const goType = arg._type ?? this._resolveExprGoType(arg);
				const isBool =
					goType?.name === "bool" ||
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
				if (this._isCompositeGoType(goType)) {
					const valW = toWasmType(goType, this.mod.checker, this.mod);
					this.emitExpr(arg, valW);
					this.emitToExternref(goType, false);
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
			const temps = this._emitArgBuffer(rest);
			this.emitExpr(format, "externref");
			if (name === "Printf") {
				this._callStdlib("fmt_printf");
				this._releaseArgBuffer(temps);
				return;
			}
			this._callStdlib("fmt_sprintf");
			if (name === "Errorf") {
				// `%w` wraps its operand as the cause (first %w only, like Go 1.13).
				const wIdx = _wrapVerbIndex(format);
				const cause = wIdx >= 0 ? temps[wIdx] : null;
				const causeTmp = cause?.errTmp ?? cause?.tmp ?? null;
				if (causeTmp !== null && causeTmp !== undefined) {
					this.pushInstruction({ op: "local.get", index: causeTmp });
				} else {
					this.pushInstruction({ op: "ref.null", heapType: "any" });
				}
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__mk_error"),
				});
			}
			this._releaseArgBuffer(temps);
			return;
		}
		throw new Error(`Unsupported fmt function: fmt.${name}`);
	}

	emitErrorsCall(name, args) {
		switch (name) {
			case "New":
				this.emitExpr(args[0], "externref");
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__mk_error"),
				});
				return;
			case "Unwrap":
				this.emitExpr(args[0], "anyref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__errors_unwrap"),
				});
				return;
			case "Is":
				this.emitExpr(args[0], "anyref");
				this.emitExpr(args[1], "anyref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__errors_is"),
				});
				return;
			case "As":
				this._emitErrorsAs(args);
				return;
			case "Join":
				this._emitErrorsJoin(args);
				return;
			default:
				throw new Error(`Unsupported errors function: errors.${name}`);
		}
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

		const targetGoType = args[1]._type ?? this._resolveExprGoType(args[1]);
		const baseGoType = targetGoType?.base ?? targetGoType;
		const concreteGoType = baseGoType?.base ?? baseGoType;
		const sName = concreteGoType?.name;
		const sInfo = sName
			? (this.mod.getStructType(sName) ??
				(concreteGoType.pkg
					? this.mod.getStructType(`${concreteGoType.pkg}.${sName}`)
					: null))
			: null;
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

		if (sInfo) {
			this.pushInstruction({ op: "local.get", index: errTmp });
			this.pushInstruction({ op: "ref.test", typeIndex: sInfo.typeIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			if (targetLocal) {
				if (targetLocal.isBoxed) {
					this.pushInstruction({ op: "local.get", index: targetLocal.index });
					this.pushInstruction({ op: "local.get", index: errTmp });
					this.pushInstruction({ op: "ref.cast", typeIndex: sInfo.typeIndex });
					this.pushInstruction({
						op: "struct.set",
						typeIndex: targetLocal.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: errTmp });
					this.pushInstruction({ op: "ref.cast", typeIndex: sInfo.typeIndex });
					this.pushInstruction({ op: "local.set", index: targetLocal.index });
				}
			} else if (box && targetTmp !== null) {
				this.pushInstruction({ op: "local.get", index: targetTmp });
				this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
				this.pushInstruction({ op: "local.get", index: errTmp });
				this.pushInstruction({ op: "ref.cast", typeIndex: sInfo.typeIndex });
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

	_emitErrorsJoin(args) {
		const errSliceInfo = this.mod.getSliceType({
			kind: "interface",
			name: "error",
		});
		if (
			args.length === 1 &&
			(args[0]._type?.kind === "slice" || args[0].kind === "SliceLit")
		) {
			const sTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: errSliceInfo.typeIndex,
			});
			this.emitExpr(args[0], {
				kind: "ref",
				nullable: true,
				typeIndex: errSliceInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: sTmp });

			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction("return");
			this.pushInstruction("end");

			const arrTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: errSliceInfo.arrInfo.typeIndex,
			});
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, errSliceInfo, {
				arr: arrTmp,
				off: offTmp,
				len: lenTmp,
			});

			const iTmp = this.acquireTemp("i32");
			const countTmp = this.acquireTemp("i32");
			const strAccTmp = this.acquireTemp("externref");
			const eTmp = this.acquireTemp("anyref");

			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: countTmp });
			this.pushInstruction({
				op: "i32.const",
				value: this.mod.internString(""),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: strAccTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iTmp });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({
				op: "array.get",
				typeIndex: errSliceInfo.arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: eTmp });

			this.pushInstruction({ op: "local.get", index: eTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: countTmp });
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: strAccTmp });
			this.pushInstruction({
				op: "i32.const",
				value: this.mod.internString("\n"),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringConcatImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: strAccTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: strAccTmp });
			this.pushInstruction({ op: "local.get", index: eTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__error_str"),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringConcatImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: strAccTmp });

			this.pushInstruction({ op: "local.get", index: countTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: countTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iTmp });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: countTmp });
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "anyref" });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: strAccTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__mk_error"),
			});
			this.pushInstruction("end");

			this.releaseTemp(eTmp, "anyref");
			this.releaseTemp(strAccTmp, "externref");
			this.releaseTemp(countTmp, "i32");
			this.releaseTemp(iTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: errSliceInfo.arrInfo.typeIndex,
			});
			this.releaseTemp(sTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: errSliceInfo.typeIndex,
			});
			return;
		}

		if (args.length === 0) {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			return;
		}

		const countTmp = this.acquireTemp("i32");
		const strAccTmp = this.acquireTemp("externref");
		const eTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: countTmp });
		this.pushInstruction({ op: "i32.const", value: this.mod.internString("") });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: strAccTmp });

		for (const arg of args) {
			this.emitExpr(arg, "anyref");
			this.pushInstruction({ op: "local.set", index: eTmp });

			this.pushInstruction({ op: "local.get", index: eTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: countTmp });
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: strAccTmp });
			this.pushInstruction({
				op: "i32.const",
				value: this.mod.internString("\n"),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringConcatImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: strAccTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: strAccTmp });
			this.pushInstruction({ op: "local.get", index: eTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__error_str"),
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringConcatImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: strAccTmp });

			this.pushInstruction({ op: "local.get", index: countTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: countTmp });
			this.pushInstruction("end");
		}

		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "anyref" });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: strAccTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
		this.pushInstruction("end");

		this.releaseTemp(eTmp, "anyref");
		this.releaseTemp(strAccTmp, "externref");
		this.releaseTemp(countTmp, "i32");
	}

	emitUtf8Call(name, args, targetWasmType) {
		const wide = (targetWasmType ?? "i64") === "i64";
		switch (name) {
			case "RuneCountInString":
				this.emitExpr(args[0], "externref");
				this._callStdlib("utf8_rune_count");
				if (wide) this.pushInstruction("i64.extend_i32_s");
				return;
			case "RuneLen":
				this._emitI32Arg(args[0]);
				this._callStdlib("utf8_rune_len");
				if (wide) this.pushInstruction("i64.extend_i32_s");
				return;
			case "ValidString":
				this.emitExpr(args[0], "externref");
				this._callStdlib("utf8_valid_string");
				return;
			case "FullRuneInString":
				this.emitExpr(args[0], "externref");
				this._callStdlib("utf8_full_rune");
				return;
			case "ValidRune": {
				// 0 <= r <= MaxRune && !(0xD800 <= r <= 0xDFFF)  ⇔  RuneLen(r) > 0
				this._emitI32Arg(args[0]);
				this._callStdlib("utf8_rune_len");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.gt_s");
				return;
			}
			case "DecodeRuneInString":
			case "DecodeLastRuneInString":
				// (rune, size): decode stores the size for the follow-up import.
				this.emitExpr(args[0], "externref");
				this.pushInstruction({
					op: "i32.const",
					value: name === "DecodeLastRuneInString" ? 1 : 0,
				});
				this._callStdlib("utf8_decode_rune");
				this.pushInstruction("i64.extend_i32_s");
				this._callStdlib("utf8_decode_size");
				this.pushInstruction("i64.extend_i32_s");
				return;
			default:
				throw new Error(`Unsupported utf8 function: utf8.${name}`);
		}
	}

	emitSortCall(name, args, targetWasmType) {
		switch (name) {
			case "Ints":
			case "Float64s":
			case "Strings":
				this.emitSlicesSort(args);
				return;
			case "IntsAreSorted":
			case "Float64sAreSorted":
			case "StringsAreSorted":
				this.emitSortIsSorted(args, null);
				return;
			case "Slice":
			case "SliceStable":
				this.emitSortSlice(args);
				return;
			case "SliceIsSorted":
				this.emitSortIsSorted(args, args[1]);
				return;
			case "Search":
				this.emitSortSearch(args, targetWasmType);
				return;
			default:
				throw new Error(`Unsupported sort function: sort.${name}`);
		}
	}

	// Calls `less(i, j)` (a `func(int, int) bool` closure held in a temp) with
	// two i32 index temps.
	_emitCallLess(closureTmp, closureInfo, iLoc, jLoc) {
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		for (const loc of [iLoc, jLoc]) {
			this.pushInstruction({ op: "local.get", index: loc });
			if (closureInfo.paramWTypes[0] === "i64")
				this.pushInstruction("i64.extend_i32_s");
		}
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});
	}

	// Stable insertion sort driven by `less(i, j)` on live indices: swaps
	// adjacent elements while less(j, j-1), so the closure always observes
	// the slice's current layout.
	emitSortSlice(args) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const closureInfo = this.mod.getClosureType(
			this._resolveExprGoType(args[1]),
		);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};

		const s = this.acquireTemp(sliceW);
		const cl = this.acquireTemp(closureW);
		const arr = this.acquireTemp(arrW);
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const i = this.acquireTemp("i32");
		const j = this.acquireTemp("i32");
		const jm1 = this.acquireTemp("i32");
		const tmp = this.acquireTemp(arrInfo.elemWType);

		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });
		this.emitExpr(args[1], closureW);
		this.pushInstruction({ op: "local.set", index: cl });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len });

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "loop", blockType: "void" }); // outer
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.set", index: j });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" }); // inner
		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 1 });
		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jm1 });
		this._emitCallLess(cl, closureInfo, j, jm1);
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 1 });
		// swap arr[off+j], arr[off+j-1]
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: tmp });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: j });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: jm1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.get", index: arr });
		this.pushInstruction({ op: "local.get", index: off });
		this.pushInstruction({ op: "local.get", index: jm1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: tmp });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.get", index: jm1 });
		this.pushInstruction({ op: "local.set", index: j });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // outer
		this.pushInstruction("end"); // block

		this.releaseTemp(tmp, arrInfo.elemWType);
		this.releaseTemp(jm1, "i32");
		this.releaseTemp(j, "i32");
		this.releaseTemp(i, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, arrW);
		this.releaseTemp(cl, closureW);
		this.releaseTemp(s, sliceW);
	}

	// sort.*AreSorted / sort.SliceIsSorted: true unless some adjacent pair is
	// out of order (`less(i, i-1)` or natural `<`).
	emitSortIsSorted(args, lessNode) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const closureInfo = lessNode
			? this.mod.getClosureType(this._resolveExprGoType(lessNode))
			: null;
		const closureW = closureInfo
			? { kind: "ref", nullable: true, typeIndex: closureInfo.typeIndex }
			: null;

		const s = this.acquireTemp(sliceW);
		const cl = closureInfo ? this.acquireTemp(closureW) : null;
		const arr = this.acquireTemp(arrW);
		const off = this.acquireTemp("i32");
		const len = this.acquireTemp("i32");
		const i = this.acquireTemp("i32");
		const im1 = this.acquireTemp("i32");
		const res = this.acquireTemp("i32");
		const a = lessNode ? null : this.acquireTemp(arrInfo.elemWType);
		const b = lessNode ? null : this.acquireTemp(arrInfo.elemWType);

		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: s });
		if (lessNode) {
			this.emitExpr(lessNode, closureW);
			this.pushInstruction({ op: "local.set", index: cl });
		}
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: res });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: s });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });
		this._emitSliceUnpack(s, sliceInfo, { arr, off, len });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: im1 });
		if (lessNode) {
			this._emitCallLess(cl, closureInfo, i, im1);
		} else {
			for (const [dst, idx] of [
				[a, i],
				[b, im1],
			]) {
				this.pushInstruction({ op: "local.get", index: arr });
				this.pushInstruction({ op: "local.get", index: off });
				this.pushInstruction({ op: "local.get", index: idx });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: dst });
			}
			this.emitElemLt(a, b, elemGoType);
		}
		// out of order → res = 0, exit
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: res });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: i });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: i });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: res });

		if (b !== null) this.releaseTemp(b, arrInfo.elemWType);
		if (a !== null) this.releaseTemp(a, arrInfo.elemWType);
		this.releaseTemp(res, "i32");
		this.releaseTemp(im1, "i32");
		this.releaseTemp(i, "i32");
		this.releaseTemp(len, "i32");
		this.releaseTemp(off, "i32");
		this.releaseTemp(arr, arrW);
		if (cl !== null) this.releaseTemp(cl, closureW);
		this.releaseTemp(s, sliceW);
	}

	// sort.Search(n, f): smallest i in [0, n) with f(i) true (binary search).
	emitSortSearch(args, targetWasmType) {
		const closureInfo = this.mod.getClosureType(
			this._resolveExprGoType(args[1]),
		);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};
		const cl = this.acquireTemp(closureW);
		const lo = this.acquireTemp("i32");
		const hi = this.acquireTemp("i32");
		const mid = this.acquireTemp("i32");

		this._emitI32Arg(args[0]);
		this.pushInstruction({ op: "local.set", index: hi });
		this.emitExpr(args[1], closureW);
		this.pushInstruction({ op: "local.set", index: cl });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: lo });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: lo });
		this.pushInstruction({ op: "local.get", index: hi });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });
		// mid = lo + (hi-lo)/2
		this.pushInstruction({ op: "local.get", index: lo });
		this.pushInstruction({ op: "local.get", index: hi });
		this.pushInstruction({ op: "local.get", index: lo });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shr_u");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: mid });
		// f(mid)
		this.pushInstruction({ op: "local.get", index: cl });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: mid });
		if (closureInfo.paramWTypes[0] === "i64")
			this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction({ op: "local.get", index: cl });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: mid });
		this.pushInstruction({ op: "local.set", index: hi });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: mid });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: lo });
		this.pushInstruction("end");
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: lo });
		if ((targetWasmType ?? "i64") === "i64")
			this.pushInstruction("i64.extend_i32_s");

		this.releaseTemp(mid, "i32");
		this.releaseTemp(hi, "i32");
		this.releaseTemp(lo, "i32");
		this.releaseTemp(cl, closureW);
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
			default:
				throw new Error(`Unknown runtime helper: ${fn._isRuntimeHelper}`);
		}
	}
}

// Index of the argument consumed by the first `%w` verb in a literal format
// string, or -1.
function _wrapVerbIndex(format) {
	if (format?.kind !== "BasicLit" || format.litKind !== "STRING") return -1;
	const re = /%([#+\- 0]*)([0-9]*)\.?([0-9]*)([sdvftxXqobeEgGw%])/g;
	let i = 0;
	for (const m of String(format.value ?? "").matchAll(re)) {
		if (m[4] === "%") continue;
		if (m[4] === "w") return i;
		i++;
	}
	return -1;
}

export { StdlibCoreEmitter as StdlibEmitter };
