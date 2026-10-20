// src/backend/wasm/stdlib/simd.js
// FunctionEmitter mixin: gofront/simd (F32x4 vector math, load/store, composite literals).

const SIMD_BINARY_OPS = {
	Add: "f32x4.add",
	Sub: "f32x4.sub",
	Mul: "f32x4.mul",
	Div: "f32x4.div",
	Min: "f32x4.min",
	Max: "f32x4.max",
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

	emitSimdMethodCall(method, recvExpr, args, _targetWasmType) {
		const op = SIMD_BINARY_OPS[method];
		if (op) {
			this.emitExpr(recvExpr, "v128");
			this.emitExpr(args[0], "v128");
			this.pushInstruction(op);
			return true;
		}
		if (method === "Dot3" || method === "Dot4") {
			this._emitSimdDot(recvExpr, args[0], method === "Dot3" ? 3 : 4);
			return true;
		}
		if (method === "Lane") {
			const laneIdx = this._constIntValue(args[0]) ?? 0;
			this.emitExpr(recvExpr, "v128");
			this.pushInstruction({ op: "f32x4.extract_lane", lane: laneIdx });
			return true;
		}
		if (method === "WithLane") {
			const laneIdx = this._constIntValue(args[0]) ?? 0;
			this.emitExpr(recvExpr, "v128");
			this.emitExpr(args[1], "f32");
			this.pushInstruction({ op: "f32x4.replace_lane", lane: laneIdx });
			return true;
		}
		if (method === "Splat") {
			this.emitExpr(args[0], "f32");
			this.pushInstruction("f32x4.splat");
			return true;
		}
		return false;
	}

	emitSimdPackageCall(fn, args, _targetWasmType) {
		switch (fn) {
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

	_constIntValue(node) {
		if (!node) return null;
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
