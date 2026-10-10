// src/backend/wasm/emit-shared.js
// `gofront/shared` linear-memory buffers: a `(base i32, len i32)` struct that
// views the module's single exported memory.  Elements are read/written with
// plain loads/stores so JS can alias the same bytes through a TypedArray.

import { getSharedInfo } from "./types.js";

const LOAD_OP = {
	f32: "f32.load",
	f64: "f64.load",
	i8: "i32.load8_s",
	u8: "i32.load8_u",
	i16: "i32.load16_s",
	u16: "i32.load16_u",
	i32: "i32.load",
	u32: "i32.load",
};

const STORE_OP = {
	f32: "f32.store",
	f64: "f64.store",
	i8: "i32.store8",
	u8: "i32.store8",
	i16: "i32.store16",
	u16: "i32.store16",
	i32: "i32.store",
	u32: "i32.store",
};

const SHIFT = { 1: 0, 2: 1, 4: 2, 8: 3 };

export class SharedEmitter {
	_sharedInfo(goType) {
		return getSharedInfo(goType, this.mod.checker);
	}

	_sharedElemWType(info) {
		return info.key === "f32" ? "f32" : info.key === "f64" ? "f64" : "i32";
	}

	// Pushes the i32 byte address of `base[idx]` with a bounds check.
	_emitSharedElemAddr(baseNode, indexNode, info) {
		const { wType, typeIndex } = this.mod.getSharedType();
		const bufTmp = this.acquireTemp(wType);
		this.emitExpr(baseNode, wType);
		this.pushInstruction({ op: "local.tee", index: bufTmp });
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 0 });
		this._emitCheckedIndex(indexNode, () => {
			this.pushInstruction({ op: "local.get", index: bufTmp });
			this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
		});
		this._emitSharedScale(info);
		this.pushInstruction("i32.add");
		this.releaseTemp(bufTmp, wType);
	}

	_emitSharedScale(info) {
		const shift = SHIFT[info.bytes];
		if (shift) {
			this.pushInstruction({ op: "i32.const", value: shift });
			this.pushInstruction("i32.shl");
		}
	}

	// Loads the element at the address on the stack, widened to `target`.
	_emitSharedLoad(info, targetWasmType) {
		this.pushInstruction(LOAD_OP[info.key]);
		this._emitSharedWiden(info, targetWasmType);
	}

	_emitSharedWiden(info, targetWasmType) {
		const elemW = this._sharedElemWType(info);
		if (targetWasmType === "i64" && elemW === "i32") {
			this.pushInstruction(
				info.key.startsWith("u") ? "i64.extend_i32_u" : "i64.extend_i32_s",
			);
		} else if (targetWasmType === "f64" && elemW === "f32") {
			this.pushInstruction("f64.promote_f32");
		}
	}

	_emitSharedStore(info) {
		this.pushInstruction(STORE_OP[info.key]);
	}

	// `buf[i]` as an rvalue.
	emitSharedIndexExpr(expr, info, targetWasmType) {
		this._emitSharedElemAddr(expr.expr, expr.index, info);
		this._emitSharedLoad(info, targetWasmType);
	}

	// `buf[i] = v`
	emitSharedIndexAssign(lhs, rhsNode, info) {
		this._emitSharedElemAddr(lhs.expr, lhs.index, info);
		this.emitExpr(rhsNode, this._sharedElemWType(info));
		this._emitSharedStore(info);
	}

	// `buf[i] op= v` / `buf[i]++`: `emitRhs` must leave the new element value
	// (as the element's wasm type) given the old value already on the stack.
	emitSharedIndexUpdate(lhs, info, emitRhs) {
		const addrTmp = this.acquireTemp("i32");
		this._emitSharedElemAddr(lhs.expr, lhs.index, info);
		this.pushInstruction({ op: "local.tee", index: addrTmp });
		this.pushInstruction({ op: "local.get", index: addrTmp });
		this.pushInstruction(LOAD_OP[info.key]);
		emitRhs(this._sharedElemWType(info), info.elem);
		this._emitSharedStore(info);
		this.releaseTemp(addrTmp, "i32");
	}

	// `len(buf)`
	emitSharedLen(arg, targetWasmType) {
		const { wType, typeIndex } = this.mod.getSharedType();
		this.emitExpr(arg, wType);
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
	}

	// `shared.NewFloat32(n)` → `__shared_new(n, bytes)`
	emitSharedNew(field, args) {
		const info = getSharedInfo(
			{ kind: "shared", shared: field.slice(3) },
			this.mod.checker,
		);
		if (!info?.ctor) throw new Error(`Unsupported shared.${field}`);
		this._emitIndexArgI32(args[0]);
		this.pushInstruction({ op: "i32.const", value: info.bytes });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__shared_new"),
		});
	}

	// `buf.Subarray(lo, hi)` → `__shared_sub(buf, lo, hi, bytes)`
	emitSharedSubarray(recvNode, args, info) {
		const { wType } = this.mod.getSharedType();
		this.emitExpr(recvNode, wType);
		this._emitIndexArgI32(args[0]);
		this._emitIndexArgI32(args[1]);
		this.pushInstruction({ op: "i32.const", value: info.bytes });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__shared_sub"),
		});
	}

	_emitIndexArgI32(node) {
		if (this._isI32IndexExpr(node)) {
			this.emitExpr(node, "i32");
			return;
		}
		this.emitExpr(node, "i64");
		this.pushInstruction("i32.wrap_i64");
	}

	// `copy(dst, src)` where at least one side is a shared buffer. Returns the
	// number of elements copied as i64 (or i32 when `targetWasmType` is i32).
	emitSharedCopy(dstNode, srcNode, targetWasmType) {
		const dstInfo = this._sharedInfo(dstNode._type);
		const srcInfo = this._sharedInfo(srcNode._type);
		const info = dstInfo ?? srcInfo;
		const elemW = this._sharedElemWType(info);

		const nTmp = this.acquireTemp("i32");
		const iTmp = this.acquireTemp("i32");
		const dst = this._emitSharedCopyOperand(dstNode, dstInfo, info.elem);
		const src = this._emitSharedCopyOperand(srcNode, srcInfo, info.elem);

		// n = min(len(dst), len(src))
		dst.emitLen();
		src.emitLen();
		const tmpA = this.acquireTemp("i32");
		const tmpB = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.set", index: tmpB });
		this.pushInstruction({ op: "local.tee", index: tmpA });
		this.pushInstruction({ op: "local.get", index: tmpB });
		this.pushInstruction({ op: "local.get", index: tmpA });
		this.pushInstruction({ op: "local.get", index: tmpB });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction("select");
		this.pushInstruction({ op: "local.set", index: nTmp });
		this.releaseTemp(tmpB, "i32");
		this.releaseTemp(tmpA, "i32");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		dst.emitStore(iTmp, () => src.emitLoad(iTmp, elemW));

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		src.release();
		dst.release();
		this.pushInstruction({ op: "local.get", index: nTmp });
		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		}
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(nTmp, "i32");
	}

	// Evaluates one `copy` operand into temps and returns element accessors.
	_emitSharedCopyOperand(node, info, elemGoType) {
		if (info) {
			const { wType, typeIndex } = this.mod.getSharedType();
			const bufTmp = this.acquireTemp(wType);
			this.emitExpr(node, wType);
			this.pushInstruction({ op: "local.set", index: bufTmp });
			const emitAddr = (iTmp) => {
				this.pushInstruction({ op: "local.get", index: bufTmp });
				this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 0 });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this._emitSharedScale(info);
				this.pushInstruction("i32.add");
			};
			return {
				emitLen: () => {
					this.pushInstruction({ op: "local.get", index: bufTmp });
					this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
				},
				emitLoad: (iTmp) => {
					emitAddr(iTmp);
					this.pushInstruction(LOAD_OP[info.key]);
				},
				emitStore: (iTmp, emitVal) => {
					emitAddr(iTmp);
					emitVal();
					this._emitSharedStore(info);
				},
				release: () => this.releaseTemp(bufTmp, wType),
			};
		}

		// GC slice side.
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const sliceWType = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};
		const sliceTmp = this.acquireTemp(sliceWType);
		const arrTmp = this.acquireTemp(arrWType);
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		this.emitExpr(node, sliceWType);
		this.pushInstruction({ op: "local.set", index: sliceTmp });
		this._emitSliceUnpack(sliceTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});
		const emitIdx = (iTmp) => {
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
		};
		return {
			emitLen: () => this.pushInstruction({ op: "local.get", index: lenTmp }),
			emitLoad: (iTmp) => {
				emitIdx(iTmp);
				this.pushInstruction({
					op: "array.get",
					typeIndex: sliceInfo.arrInfo.typeIndex,
				});
			},
			emitStore: (iTmp, emitVal) => {
				emitIdx(iTmp);
				emitVal();
				this.pushInstruction({
					op: "array.set",
					typeIndex: sliceInfo.arrInfo.typeIndex,
				});
			},
			release: () => {
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrWType);
				this.releaseTemp(sliceTmp, sliceWType);
			},
		};
	}

	// `for i, v := range buf`
	_emitSharedRange(stmt, iterExpr, info, lhs, isAssign) {
		const { wType, typeIndex } = this.mod.getSharedType();
		const elemW = this._sharedElemWType(info);
		const bufTmp = this.acquireTemp(wType);
		const baseTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const idxTmp = this.acquireTemp("i32");

		this.emitExpr(iterExpr, wType);
		this.pushInstruction({ op: "local.tee", index: bufTmp });
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 0 });
		this.pushInstruction({ op: "local.set", index: baseTmp });
		this.pushInstruction({ op: "local.get", index: bufTmp });
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
		this.pushInstruction({ op: "local.set", index: lenTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: idxTmp });

		const bodyBlock = stmt.body ?? stmt.block;
		const bindVar = (node, wTypeNew, goTypeNew) => {
			if (!node || node.name === "_") return null;
			if (!isAssign) {
				const lIdx = this.allocLocal(node.name, wTypeNew, goTypeNew);
				return { index: lIdx, type: wTypeNew };
			}
			return this.resolveLocal(node.name) ?? this.mod.resolveGlobal(node.name);
		};
		let idxWType = "i64";
		if (lhs[0] && lhs[0].name !== "_" && !isAssign) {
			const isNonEscaping =
				!this.mutatedCaptures?.has(lhs[0].name) &&
				!this.capturedNames?.includes(lhs[0].name) &&
				!this._varMutatesOrEscapes(bodyBlock, lhs[0].name);
			idxWType = isNonEscaping ? "i32" : "i64";
		}
		const idxLocalInfo = bindVar(lhs[0], idxWType, {
			kind: "basic",
			name: "int",
		});
		const valLocalInfo = bindVar(lhs[1], elemW, info.elem);
		const store = (node, localInfo) => {
			if (this.resolveLocal(node.name)) {
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.set", index: localInfo.index });
			}
		};

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushControl("loop", stmt.label);

		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({
			op: "br_if",
			depth: this.resolveBranchDepth(stmt.label, false),
		});

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("continue", stmt.label);

		if (idxLocalInfo) {
			this.pushInstruction({ op: "local.get", index: idxTmp });
			if (idxLocalInfo.type === "i64") this.pushInstruction("i64.extend_i32_s");
			store(lhs[0], idxLocalInfo);
		}
		if (valLocalInfo) {
			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this._emitSharedScale(info);
			this.pushInstruction("i32.add");
			this.pushInstruction(LOAD_OP[info.key]);
			this._emitSharedWiden(info, valLocalInfo.type);
			store(lhs[1], valLocalInfo);
		}

		if (bodyBlock) this.emitBlock(bodyBlock);

		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: idxTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(idxTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(baseTmp, "i32");
		this.releaseTemp(bufTmp, wType);
	}

	// Bodies of the synthetic `__shared_new` / `__shared_sub` helpers.
	emitSharedHelper(fn) {
		const { typeIndex, topGlobalIndex } = this.mod.getSharedType();
		if (fn._isSharedHelper === "new") {
			// params: len=0, bytes=1
			const sizeTmp = this.acquireTemp("i32");
			const baseTmp = this.acquireTemp("i32");
			const pagesTmp = this.acquireTemp("i32");

			// len < 0 or len*bytes beyond the i32 address space → panic
			// (the byte size must stay representable after 8-byte rounding).
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction("i64.extend_i32_s");
			this.pushInstruction({ op: "local.get", index: 1 });
			this.pushInstruction("i64.extend_i32_s");
			this.pushInstruction("i64.mul");
			this.pushInstruction({ op: "i64.const", value: 0x7ffffff0 });
			this.pushInstruction("i64.gt_s");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__shared_len_panic"),
			});
			this.pushInstruction("unreachable");
			this.pushInstruction("end");

			// size = (len*bytes + 7) & ~7
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction({ op: "local.get", index: 1 });
			this.pushInstruction("i32.mul");
			this.pushInstruction({ op: "i32.const", value: 7 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: -8 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "local.set", index: sizeTmp });

			// base = top
			this.pushInstruction({ op: "global.get", index: topGlobalIndex });
			this.pushInstruction({ op: "local.set", index: baseTmp });

			// needed pages = ((base + size) - memory.size*65536 + 65535) >> 16
			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({ op: "local.get", index: sizeTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction("memory.size");
			this.pushInstruction({ op: "i32.const", value: 16 });
			this.pushInstruction("i32.shl");
			this.pushInstruction("i32.sub");
			this.pushInstruction({ op: "i32.const", value: 65535 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: 16 });
			this.pushInstruction("i32.shr_s");
			this.pushInstruction({ op: "local.tee", index: pagesTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.gt_s");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: pagesTmp });
			this.pushInstruction("memory.grow");
			this.pushInstruction({ op: "i32.const", value: -1 });
			this.pushInstruction("i32.eq");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction("unreachable");
			this.pushInstruction("end");
			this.pushInstruction("end");

			// top = base + size
			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({ op: "local.get", index: sizeTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "global.set", index: topGlobalIndex });

			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({ op: "local.get", index: 0 });
			this.pushInstruction({ op: "struct.new", typeIndex });
			this.pushInstruction("return");

			this.releaseTemp(pagesTmp, "i32");
			this.releaseTemp(baseTmp, "i32");
			this.releaseTemp(sizeTmp, "i32");
			return;
		}

		// sub: params buf=0, lo=1, hi=2, bytes=3
		// 0 <= lo <= hi <= len, else slice-bounds panic
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({ op: "local.get", index: 2 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "local.get", index: 2 });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 1 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		// base + lo*bytes
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "struct.get", typeIndex, fieldIndex: 0 });
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({ op: "local.get", index: 3 });
		this.pushInstruction("i32.mul");
		this.pushInstruction("i32.add");
		// hi - lo
		this.pushInstruction({ op: "local.get", index: 2 });
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "struct.new", typeIndex });
		this.pushInstruction("return");
	}
}
