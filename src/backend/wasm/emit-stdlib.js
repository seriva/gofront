// src/backend/wasm/emit-stdlib.js
// FunctionEmitter mixin: stdlib packages implemented natively (math, math/bits,
// maps, slices, strings, strconv, fmt, testing).

import { getMapKeyValTypes, toWasmType } from "./types.js";

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
		switch (name) {
			case "Sqrt":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.sqrt");
				return;
			case "Floor":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.floor");
				return;
			case "Ceil":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.ceil");
				return;
			case "Trunc":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.trunc");
				return;
			case "Abs":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.abs");
				return;
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
			Exp: "exp",
			Log: "log",
			Log2: "log2",
			Log10: "log10",
			Round: "round",
		};

		if (jsMathMap[name]) {
			const jsName = jsMathMap[name];
			const isBinary = name === "Atan2" || name === "Pow";
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
			throw new Error(
				"t.Run is not yet supported in wasm test packages (planned)",
			);
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
		for (const arg of args) {
			const isBool =
				arg._type?.name === "bool" ||
				(arg.kind === "BasicLit" && arg.litKind === "BOOL");
			const wType = toWasmType(arg._type, this.mod.checker);
			this.emitExpr(arg, wType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingArgImportIndex(wType, isBool),
			});
		}
		this.emitExpr(func.expr, "externref");
		this.pushInstruction({ op: "i32.const", value: nameIdx });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getTestingCallImportIndex(),
		});
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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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
			default:
				throw new Error(`Unsupported strings function: strings.${name}`);
		}
	}

	emitStrconvCall(name, args, _targetWasmType) {
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
				const isBool =
					arg._type?.name === "bool" ||
					(arg.kind === "BasicLit" && arg.litKind === "BOOL");
				const wType = toWasmType(arg._type, this.mod.checker);
				this.emitExpr(arg, wType);
				const logFuncIdx = this.mod.getLogImportIndex(wType, isLast, isBool);
				this.pushInstruction({ op: "call", funcIndex: logFuncIdx });
			}
			return;
		}
		throw new Error(`Unsupported fmt function: fmt.${name}`);
	}
}
