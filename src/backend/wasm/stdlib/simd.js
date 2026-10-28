// src/backend/wasm/stdlib/simd.js
// FunctionEmitter mixin: gofront/simd (F32x4 vector math, load/store, composite literals).

// Methods lowered to one instruction over the receiver and its vector arguments.
const SIMD_LANEWISE_OPS = {
	Add: "f32x4.add",
	Sub: "f32x4.sub",
	Mul: "f32x4.mul",
	Div: "f32x4.div",
	Min: "f32x4.min",
	Max: "f32x4.max",
	Neg: "f32x4.neg",
	Abs: "f32x4.abs",
	Sqrt: "f32x4.sqrt",
	Floor: "f32x4.floor",
	Ceil: "f32x4.ceil",
	Trunc: "f32x4.trunc",
	RoundToEven: "f32x4.nearest",
	Equal: "f32x4.eq",
	NotEqual: "f32x4.ne",
	Less: "f32x4.lt",
	LessEqual: "f32x4.le",
	Greater: "f32x4.gt",
	GreaterEqual: "f32x4.ge",
};

const SIMD_MASK_OPS = {
	And: "v128.and",
	Or: "v128.or",
	Xor: "v128.xor",
	AndNot: "v128.andnot",
	Not: "v128.not",
	Any: "v128.any_true",
	All: "i32x4.all_true",
};

// Methods with their own emitter: name -> FunctionEmitter method.
const SIMD_SPECIAL_METHODS = {
	MulAdd: "_emitSimdMulAdd",
	Sum: "_emitSimdSum",
	Swizzle: "_emitSimdSwizzle",
	Dot3: "_emitSimdDot3",
	Dot4: "_emitSimdDot4",
	Lane: "_emitSimdLane",
	WithLane: "_emitSimdWithLane",
	Splat: "_emitSimdSplat",
};

const SIMD_MASK_SPECIAL_METHODS = {
	Bits: "_emitSimdMaskBits",
	Lane: "_emitSimdMaskLane",
};

export class SimdEmitter {
	emitSimdCompositeLit(lit) {
		const elems = lit.elems ?? [];
		if (elems.length === 0) {
			this.pushInstruction({ op: "v128.const", bytes: new Array(16).fill(0) });
			return;
		}

		const constVals = elems.map((e) => this._getConstFloatValue(e));
		const allConst = constVals.every((v) => v !== null);

		if (allConst) {
			const vals = [0, 0, 0, 0];
			for (let i = 0; i < Math.min(elems.length, 4); i++) {
				vals[i] = constVals[i];
			}
			this.pushInstruction({ op: "v128.const", values: vals });
			return;
		}

		// Runtime elements: splat lane 0, replace lanes 1, 2, 3
		this.emitExpr(elems[0], "f32");
		this.pushInstruction("f32x4.splat");
		for (let i = 1; i < 4; i++) {
			if (elems[i]) {
				this.emitExpr(elems[i], "f32");
			} else {
				this.pushInstruction({ op: "f32.const", value: 0.0 });
			}
			this.pushInstruction({ op: "f32x4.replace_lane", lane: i });
		}
	}

	_emitSimdDot(recvExpr, otherExpr, count) {
		this.emitExpr(recvExpr, "v128");
		this.emitExpr(otherExpr, "v128");
		this.pushInstruction("f32x4.mul");
		const tmp = this.acquireTemp("v128");
		this.pushInstruction({ op: "local.set", index: tmp });
		this.pushInstruction({ op: "local.get", index: tmp });
		this.pushInstruction({ op: "f32x4.extract_lane", lane: 0 });
		for (let i = 1; i < count; i++) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({ op: "f32x4.extract_lane", lane: i });
			this.pushInstruction("f32.add");
		}
		this.releaseTemp(tmp, "v128");
	}

	_isSimdMaskType(goType) {
		return (
			goType?.name === "simd.Mask32x4" ||
			goType?.name === "Mask32x4" ||
			goType?.simd === "Mask32x4" ||
			goType?.underlying?.simd === "Mask32x4"
		);
	}

	// Lane-wise equality of two vectors on the stack -> i32 (Go array `==`:
	// NaN != NaN, -0 == +0).
	_emitSimdEq(goType) {
		this.pushInstruction(
			this._isSimdMaskType(goType) ? "i32x4.eq" : "f32x4.eq",
		);
		this.pushInstruction("i32x4.all_true");
	}

	_emitSimdSum(recvExpr) {
		this.emitExpr(recvExpr, "v128");
		const tmp = this.acquireTemp("v128");
		this.pushInstruction({ op: "local.set", index: tmp });
		this.pushInstruction({ op: "local.get", index: tmp });
		this.pushInstruction({ op: "f32x4.extract_lane", lane: 0 });
		for (let i = 1; i < 4; i++) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({ op: "f32x4.extract_lane", lane: i });
			this.pushInstruction("f32.add");
		}
		this.releaseTemp(tmp, "v128");
	}

	// Lane i (0-3 from a, 4-7 from b) as the four byte indices of an i8x16.shuffle.
	_simdShuffleBytes(lanes) {
		const out = [];
		for (const lane of lanes) {
			for (let k = 0; k < 4; k++) out.push(lane * 4 + k);
		}
		return out;
	}

	_simdLaneConsts(nodes, max) {
		return nodes.map((n) => {
			const v = this._constIntValue(n);
			if (v === null || v < 0 || v > max)
				throw new Error(`simd: lane index must be a constant in [0, ${max}]`);
			return v;
		});
	}

	_emitSimdSwizzle(recvExpr, args) {
		const lanes = this._simdLaneConsts(args, 3);
		const tmp = this.acquireTemp("v128");
		this.emitExpr(recvExpr, "v128");
		this.pushInstruction({ op: "local.tee", index: tmp });
		this.pushInstruction({ op: "local.get", index: tmp });
		this.pushInstruction({
			op: "i8x16.shuffle",
			lanes: this._simdShuffleBytes(lanes),
		});
		this.releaseTemp(tmp, "v128");
	}

	_emitSimdSelect(args) {
		const maskTmp = this.acquireTemp("v128");
		this.emitExpr(args[0], "v128");
		this.pushInstruction({ op: "local.set", index: maskTmp });
		this.emitExpr(args[1], "v128");
		this.emitExpr(args[2], "v128");
		this.pushInstruction({ op: "local.get", index: maskTmp });
		this.pushInstruction("v128.bitselect");
		this.releaseTemp(maskTmp, "v128");
	}

	_emitSimdShuffle(args) {
		const lanes = this._simdLaneConsts(args.slice(2, 6), 7);
		this.emitExpr(args[0], "v128");
		this.emitExpr(args[1], "v128");
		this.pushInstruction({
			op: "i8x16.shuffle",
			lanes: this._simdShuffleBytes(lanes),
		});
	}

	_emitSimdOp(op, recvExpr, args) {
		this.emitExpr(recvExpr, "v128");
		for (const arg of args) this.emitExpr(arg, "v128");
		this.pushInstruction(op);
	}

	_emitSimdMaskBits(recvExpr) {
		this._emitSimdOp("i32x4.bitmask", recvExpr, []);
		this.pushInstruction("i64.extend_i32_u");
	}

	_emitSimdMaskLane(recvExpr, args) {
		const [lane] = this._simdLaneConsts([args[0]], 3);
		this.emitExpr(recvExpr, "v128");
		this.pushInstruction({ op: "i32x4.extract_lane", lane });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ne");
	}

	_emitSimdMulAdd(recvExpr, args) {
		// Two roundings (mul, then add), not fused.
		this._emitSimdOp("f32x4.mul", recvExpr, [args[0]]);
		this.emitExpr(args[1], "v128");
		this.pushInstruction("f32x4.add");
	}

	_emitSimdDot3(recvExpr, args) {
		this._emitSimdDot(recvExpr, args[0], 3);
	}

	_emitSimdDot4(recvExpr, args) {
		this._emitSimdDot(recvExpr, args[0], 4);
	}

	_emitSimdLane(recvExpr, args) {
		const lane = this._constIntValue(args[0]) ?? 0;
		this.emitExpr(recvExpr, "v128");
		this.pushInstruction({ op: "f32x4.extract_lane", lane });
	}

	_emitSimdWithLane(recvExpr, args) {
		const lane = this._constIntValue(args[0]) ?? 0;
		this.emitExpr(recvExpr, "v128");
		this.emitExpr(args[1], "f32");
		this.pushInstruction({ op: "f32x4.replace_lane", lane });
	}

	_emitSimdSplat(_recvExpr, args) {
		this.emitExpr(args[0], "f32");
		this.pushInstruction("f32x4.splat");
	}

	emitSimdMethodCall(method, recvExpr, args, _targetWasmType, isMask = false) {
		const ops = isMask ? SIMD_MASK_OPS : SIMD_LANEWISE_OPS;
		const specials = isMask ? SIMD_MASK_SPECIAL_METHODS : SIMD_SPECIAL_METHODS;
		if (ops[method]) {
			this._emitSimdOp(ops[method], recvExpr, args);
			return true;
		}
		if (!specials[method]) return false;
		this[specials[method]](recvExpr, args);
		return true;
	}

	emitSimdPackageCall(fn, args, _targetWasmType) {
		switch (fn) {
			case "Select":
				this._emitSimdSelect(args);
				return true;
			case "Shuffle":
				this._emitSimdShuffle(args);
				return true;
			case "Splat":
				this.emitExpr(args[0], "f32");
				this.pushInstruction("f32x4.splat");
				return true;
			case "NewF32x4":
				this.emitExpr(args[0], "f32");
				this.pushInstruction("f32x4.splat");
				this.emitExpr(args[1], "f32");
				this.pushInstruction({ op: "f32x4.replace_lane", lane: 1 });
				this.emitExpr(args[2], "f32");
				this.pushInstruction({ op: "f32x4.replace_lane", lane: 2 });
				this.emitExpr(args[3], "f32");
				this.pushInstruction({ op: "f32x4.replace_lane", lane: 3 });
				return true;
			case "LoadF32x4":
				this.emitSimdLoad(args[0], args[1]);
				return true;
			case "StoreF32x4":
				this.emitSimdStore(args[0], args[1], args[2]);
				return true;
			case "LoadF32x4Slice":
				this.emitSimdSliceAccess(args[0], args[1], null);
				return true;
			case "StoreF32x4Slice":
				this.emitSimdSliceAccess(args[0], args[1], args[2]);
				return true;
			case "Pad4":
				this._emitSimdPad4(args[0]);
				return true;
			default:
				return false;
		}
	}

	_emitSharedFloat32Address(bufNode, indexNode) {
		const { wType, typeIndex } = this.mod.getSharedType();
		const bufTmp = this.acquireTemp(wType);
		const iTmp = this.acquireTemp("i32");

		this.emitExpr(bufNode, wType);
		this.pushInstruction({ op: "local.set", index: bufTmp });

		// Bounds check 1: if unsigned(len) < 4 branch to OOB
		this.pushInstruction({ op: "local.get", index: bufTmp });
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.lt_u");
		this._emitBoundsBranch();

		if (this._isI32IndexExpr(indexNode)) {
			this.emitExpr(indexNode, "i32");
			this.pushInstruction({ op: "local.set", index: iTmp });

			// Bounds check: if unsigned(i) > len - 4 branch to OOB
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "local.get", index: bufTmp });
			this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
			this.pushInstruction({ op: "i32.const", value: 4 });
			this.pushInstruction("i32.sub");
			this.pushInstruction("i32.gt_u");
			this._emitBoundsBranch();
		} else {
			const idx64 = this.acquireTemp("i64");
			this.emitExpr(indexNode, "i64");
			this.pushInstruction({ op: "local.set", index: idx64 });

			// Bounds check in 64-bit: if unsigned(idx64) > unsigned(len - 4) branch to OOB
			this.pushInstruction({ op: "local.get", index: idx64 });
			this.pushInstruction({ op: "local.get", index: bufTmp });
			this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
			this.pushInstruction({ op: "i32.const", value: 4 });
			this.pushInstruction("i32.sub");
			this.pushInstruction("i64.extend_i32_u");
			this.pushInstruction("i64.gt_u");
			this._emitBoundsBranch();

			this.pushInstruction({ op: "local.get", index: idx64 });
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction({ op: "local.set", index: iTmp });
			this.releaseTemp(idx64, "i64");
		}

		// Address: buf.base + (i << 2)
		this.pushInstruction({ op: "local.get", index: bufTmp });
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 0 });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.add");

		this.releaseTemp(bufTmp, wType);
		this.releaseTemp(iTmp, "i32");
	}

	emitSimdLoad(bufNode, indexNode) {
		this._emitSharedFloat32Address(bufNode, indexNode);
		this.pushInstruction({ op: "v128.load", align: 2, offset: 0 });
	}

	emitSimdStore(bufNode, indexNode, valNode) {
		this._emitSharedFloat32Address(bufNode, indexNode);
		this.emitExpr(valNode, "v128");
		this.pushInstruction({ op: "v128.store", align: 2, offset: 0 });
	}

	// Pad4(n) = (n + 3) &^ 3; a Go int, so always computed as i64.
	_emitSimdPad4(nNode) {
		this.emitExpr(nNode, "i64");
		this.pushInstruction({ op: "i64.const", value: 3n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "i64.const", value: -4n });
		this.pushInstruction("i64.and");
	}

	// LoadF32x4Slice (valNode null) and StoreF32x4Slice on a []float32: a
	// GC array cannot be read as v128, so each lane is moved on its own.
	emitSimdSliceAccess(sliceNode, indexNode, valNode) {
		const sliceType = sliceNode._type ?? this._resolveExprGoType(sliceNode);
		const elemGoType = this._getArrayElemType(sliceType);
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const sTI = sliceInfo.typeIndex;
		const sliceWType = { kind: "ref", nullable: true, typeIndex: sTI };
		const sliceTmp = this.acquireTemp(sliceWType);
		const idx64 = this.acquireTemp("i64");
		const baseTmp = this.acquireTemp("i32");
		const vecTmp = valNode ? this.acquireTemp("v128") : null;
		const lenOf = () => {
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({ op: "struct.get", typeIndex: sTI, fieldIndex: 2 });
		};

		this.emitExpr(sliceNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: sliceTmp });
		if (this._isI32IndexExpr(indexNode)) {
			this.emitExpr(indexNode, "i32");
			this.pushInstruction("i64.extend_i32_s");
		} else {
			this.emitExpr(indexNode, "i64");
		}
		this.pushInstruction({ op: "local.set", index: idx64 });
		if (valNode) {
			this.emitExpr(valNode, "v128");
			this.pushInstruction({ op: "local.set", index: vecTmp });
		}

		// Out of range when len < 4 or unsigned(i) > len - 4 (negative i wraps).
		lenOf();
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.lt_u");
		this._emitBoundsBranch();
		this.pushInstruction({ op: "local.get", index: idx64 });
		lenOf();
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.gt_u");
		this._emitBoundsBranch();

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({ op: "struct.get", typeIndex: sTI, fieldIndex: 1 });
		this.pushInstruction({ op: "local.get", index: idx64 });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: baseTmp });

		const elemAt = (lane) => {
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({ op: "struct.get", typeIndex: sTI, fieldIndex: 0 });
			this.pushInstruction({ op: "local.get", index: baseTmp });
			if (lane) {
				this.pushInstruction({ op: "i32.const", value: lane });
				this.pushInstruction("i32.add");
			}
		};
		if (valNode) {
			for (let lane = 0; lane < 4; lane++) {
				elemAt(lane);
				this.pushInstruction({ op: "local.get", index: vecTmp });
				this.pushInstruction({ op: "f32x4.extract_lane", lane });
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
			}
		} else {
			elemAt(0);
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction("f32x4.splat");
			for (let lane = 1; lane < 4; lane++) {
				elemAt(lane);
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "f32x4.replace_lane", lane });
			}
		}
		if (vecTmp !== null) this.releaseTemp(vecTmp, "v128");
		this.releaseTemp(baseTmp, "i32");
		this.releaseTemp(idx64, "i64");
		this.releaseTemp(sliceTmp, sliceWType);
	}

	_constIntValue(node) {
		if (!node) return null;
		if (typeof node._constInt === "number") return node._constInt;
		if (node.kind === "BasicLit" && node.litKind === "INT") {
			return Number(node.value);
		}
		if (node.kind === "Ident") {
			const c = this.mod?.resolveConst?.(node.name);
			if (c && c.kind === "BasicLit") {
				return Number(c.value);
			}
		}
		if (node.kind === "ParenExpr") {
			return this._constIntValue(node.expr);
		}
		if (node.kind === "UnaryExpr" && node.op === "+") {
			return this._constIntValue(node.operand);
		}
		return null;
	}

	_getConstFloatValue(e) {
		if (!e) return null;
		if (
			e.kind === "BasicLit" &&
			(e.litKind === "FLOAT" || e.litKind === "INT")
		) {
			return Number(e.value);
		}
		if (e.kind === "UnaryExpr" && (e.op === "-" || e.op === "+")) {
			const v = this._getConstFloatValue(e.operand);
			return v !== null ? (e.op === "-" ? -v : v) : null;
		}
		if (e.kind === "Ident") {
			const c = this.mod?.resolveConst?.(e.name);
			if (c) return this._getConstFloatValue(c);
		}
		if (e.kind === "ParenExpr") {
			return this._getConstFloatValue(e.expr);
		}
		return null;
	}
}
