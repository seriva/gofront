// src/backend/wasm/emit-stdlib.js
// FunctionEmitter mixin: stdlib packages implemented natively (math, math/bits,
// maps, slices, strings, strconv, fmt, errors, sort, unicode/utf8, testing)
// plus the runtime helper bodies they rely on.

import {
	ERROR_STRUCT,
	getMapKeyValTypes,
	isErrorType,
	toWasmType,
} from "./types.js";

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

export class StdlibEmitter {
	_isMathConst(expr) {
		return (
			expr.expr?.kind === "Ident" &&
			expr.expr.name === "math" &&
			!this.resolveLocal("math") &&
			!this.mod.resolveGlobal("math") &&
			MATH_CONSTS[expr.field] !== undefined
		);
	}

	_isUtf8Const(expr) {
		return (
			expr.expr?.kind === "Ident" &&
			expr.expr.name === "utf8" &&
			!this.resolveLocal("utf8") &&
			!this.mod.resolveGlobal("utf8") &&
			UTF8_CONSTS[expr.field] !== undefined
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
	// so nothing may be pushed until every operand is fully evaluated.
	// Returns the temps so the caller can still read an argument (fmt.Errorf's
	// %w cause keeps the original error value in `errTmp`).
	_emitArgBuffer(args) {
		const temps = [];
		for (const arg of args) {
			const goType = arg._type ?? this._resolveExprGoType(arg);
			const isBool =
				goType?.name === "bool" ||
				(arg.kind === "BasicLit" && arg.litKind === "BOOL");
			const isErr = isErrorType(goType) && this.mod.hasErrorType;
			const valW = toWasmType(goType, this.mod.checker);
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
				temps.push({ tmp, wType: "externref", isBool: false, errTmp });
				continue;
			}
			const tmp = this.acquireTemp(valW);
			this.emitExpr(arg, valW);
			this.pushInstruction({ op: "local.set", index: tmp });
			temps.push({ tmp, wType: valW, isBool, errTmp: null });
		}
		for (const { tmp, wType, isBool } of temps) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingArgImportIndex(wType, isBool),
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

			default:
				throw new Error(`Unsupported bits function: bits.${name}`);
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

	emitMapsCall(name, args, _targetWasmType) {
		switch (name) {
			case "Keys": {
				const mArg = args[0];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.keysFuncName),
				});
				return;
			}
			case "Values": {
				const mArg = args[0];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.valuesFuncName),
				});
				return;
			}
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
			case "Index":
				this.emitSlicesIndex(args, targetWasmType);
				return;
			case "Equal":
				this.emitSlicesEqual(args);
				return;
			case "Clone":
				this.emitSlicesClone(args);
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
	_emitCollectStringParts() {
		const strGo = { kind: "basic", name: "string" };
		const sliceInfo = this.mod.getSliceType(strGo);
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const n = this.acquireTemp("i32");
		const i = this.acquireTemp("i32");
		const arr = this.acquireTemp(arrW);

		this.pushInstruction({ op: "local.tee", index: n });
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
				this._callStdlib("strconv_err");
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__mk_error"),
				});
				return;
			}
			default:
				throw new Error(`Unsupported strconv function: strconv.${name}`);
		}
	}

	emitFmtCall(name, args) {
		if (name === "Println" || name === "Print") {
			const isPrintln = name === "Println";
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
				const causeTmp =
					cause?.errTmp ?? (cause?.wType === "anyref" ? cause.tmp : null);
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
			default:
				throw new Error(`Unsupported errors function: errors.${name}`);
		}
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
				// Boxed scalars compare by value (Go: any(3) == any(3)).
				for (const wType of ["i32", "i64", "f32", "f64"]) {
					const box = this.mod.getBoxType(wType);
					for (const idx of [0, 1]) {
						this.pushInstruction({ op: "local.get", index: idx });
						this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					}
					this.pushInstruction("i32.and");
					this.pushInstruction({ op: "if", blockType: "void" });
					for (const idx of [0, 1]) {
						this.pushInstruction({ op: "local.get", index: idx });
						this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
						this.pushInstruction({
							op: "struct.get",
							typeIndex: box.typeIndex,
							fieldIndex: 0,
						});
					}
					this.pushInstruction(`${wType}.eq`);
					this.pushInstruction("return");
					this.pushInstruction("end");
				}
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction("ref.eq");
				this.pushInstruction("else");
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
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCmpImportIndex("=="),
				});
				this.pushInstruction("else");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
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
