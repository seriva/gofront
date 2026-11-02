// src/backend/wasm/stdlib/bytes.js
// FunctionEmitter mixin: bytes package functions and bytes.Buffer methods.

export class BytesEmitter {
	emitBytesNewBuffer(call, _targetWasmType) {
		const structInfo = this.mod.getStructType("bytes.Buffer");
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		this.emitExpr(call.args[0], sliceW);
		if (structInfo.fields.length > 1) {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "i64.const", value: 0n });
		}
		this.pushInstruction({
			op: "struct.new",
			typeIndex: structInfo.typeIndex,
		});
	}

	emitBytesNewBufferString(call, _targetWasmType) {
		const structInfo = this.mod.getStructType("bytes.Buffer");
		const sTmp = this.acquireTemp("externref");
		this.emitExpr(call.args[0], "externref");
		this.pushInstruction({ op: "local.set", index: sTmp });

		this.pushInstruction({ op: "local.get", index: sTmp });
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });
		this.releaseTemp(sTmp, "externref");
		if (structInfo.fields.length > 1) {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "i64.const", value: 0n });
		}
		this.pushInstruction({
			op: "struct.new",
			typeIndex: structInfo.typeIndex,
		});
	}

	emitBytesBufferMethodCall(method, recvExpr, args, targetWasmType) {
		const structInfo = this.mod.getStructType("bytes.Buffer");
		const bufW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const bTmp = this.acquireTemp(bufW);
		this.emitExpr(recvExpr, bufW);
		this.pushInstruction({ op: "local.set", index: bTmp });

		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const getBufSlice = () => {
			const sTmp = this.acquireTemp(sliceW);
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: sTmp });
			this.pushInstruction({ op: "local.get", index: sTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({
				op: "global.get",
				index: sliceInfo.emptyGlobalIndex,
			});
			this.pushInstruction({ op: "local.set", index: sTmp });
			this.pushInstruction("end");
			return sTmp;
		};

		const setLastOp = (opVal) => {
			if (structInfo.fields.length > 1) {
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "i64.const", value: BigInt(opVal) });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 1,
				});
			}
		};
		const setLastRuneLen = (lenLocal) => {
			if (structInfo.fields.length > 2) {
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: lenLocal });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 2,
				});
			}
		};

		switch (method) {
			case "Len": {
				const sTmp = getBufSlice();
				this.pushInstruction({ op: "local.get", index: sTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_u");
				}
				this.releaseTemp(sTmp, sliceW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Cap": {
				const sTmp = getBufSlice();
				this.pushInstruction({ op: "local.get", index: sTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 3,
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_u");
				}
				this.releaseTemp(sTmp, sliceW);
				this.releaseTemp(bTmp, bufW);
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
				setLastOp(0);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Bytes": {
				const sTmp = getBufSlice();
				this.pushInstruction({ op: "local.get", index: sTmp });
				this.releaseTemp(sTmp, sliceW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "String": {
				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "externref" });
				const emptyStrIdx = this.mod.internString("");
				this.pushInstruction({ op: "i32.const", value: emptyStrIdx });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringImportIndex(),
				});
				this.pushInstruction("else");

				this.pushInstruction({ op: "local.get", index: lenTmp });
				this._callStdlib("bytes_to_str_init");

				const kTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: kTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this._callStdlib("bytes_to_str_push");

				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: kTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				this._callStdlib("bytes_to_str_finish");
				this.pushInstruction("end");

				this.releaseTemp(kTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "WriteByte": {
				const sTmp = getBufSlice();
				const oldArrTmp = this.acquireTemp(arrW);
				const oldOffTmp = this.acquireTemp("i32");
				const oldLenTmp = this.acquireTemp("i32");
				const oldCapTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: oldArrTmp,
					off: oldOffTmp,
					len: oldLenTmp,
					cap: oldCapTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const newLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
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

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: newOffTmp });
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction("i32.add");
				this._emitI32Arg(args[0]);
				this.pushInstruction({
					op: "array.set",
					typeIndex: arrInfo.typeIndex,
				});

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

				this.pushInstruction({ op: "ref.null", heapType: "any" });
				setLastOp(0);

				this.releaseTemp(newCapTmp, "i32");
				this.releaseTemp(newOffTmp, "i32");
				this.releaseTemp(newArrTmp, arrW);
				this.releaseTemp(newLenTmp, "i32");
				this.releaseTemp(oldCapTmp, "i32");
				this.releaseTemp(oldLenTmp, "i32");
				this.releaseTemp(oldOffTmp, "i32");
				this.releaseTemp(oldArrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Write": {
				const sTmp = getBufSlice();
				const oldArrTmp = this.acquireTemp(arrW);
				const oldOffTmp = this.acquireTemp("i32");
				const oldLenTmp = this.acquireTemp("i32");
				const oldCapTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: oldArrTmp,
					off: oldOffTmp,
					len: oldLenTmp,
					cap: oldCapTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const pTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: pTmp });

				const pArrTmp = this.acquireTemp(arrW);
				const pOffTmp = this.acquireTemp("i32");
				const pLenTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(pTmp, sliceInfo, {
					arr: pArrTmp,
					off: pOffTmp,
					len: pLenTmp,
				});
				this.releaseTemp(pTmp, sliceW);

				const newLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction({ op: "local.get", index: pLenTmp });
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

				this.pushInstruction({ op: "local.get", index: pLenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.gt_u");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: newOffTmp });
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: pArrTmp });
				this.pushInstruction({ op: "local.get", index: pOffTmp });
				this.pushInstruction({ op: "local.get", index: pLenTmp });
				this._emitArrayCopy(arrInfo, byteGo);
				this.pushInstruction("end");

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

				this.pushInstruction({ op: "local.get", index: pLenTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				setLastOp(0);

				this.releaseTemp(newCapTmp, "i32");
				this.releaseTemp(newOffTmp, "i32");
				this.releaseTemp(newArrTmp, arrW);
				this.releaseTemp(newLenTmp, "i32");
				this.releaseTemp(pLenTmp, "i32");
				this.releaseTemp(pOffTmp, "i32");
				this.releaseTemp(pArrTmp, arrW);
				this.releaseTemp(oldCapTmp, "i32");
				this.releaseTemp(oldLenTmp, "i32");
				this.releaseTemp(oldOffTmp, "i32");
				this.releaseTemp(oldArrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "WriteString": {
				const strTmp = this.acquireTemp("externref");
				this.emitExpr(args[0], "externref");
				this.pushInstruction({ op: "local.set", index: strTmp });

				const sByteLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: strTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrToBytesImportIndex(),
				});
				this.pushInstruction({ op: "local.set", index: sByteLenTmp });

				const sTmp = getBufSlice();
				const oldArrTmp = this.acquireTemp(arrW);
				const oldOffTmp = this.acquireTemp("i32");
				const oldLenTmp = this.acquireTemp("i32");
				const oldCapTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: oldArrTmp,
					off: oldOffTmp,
					len: oldLenTmp,
					cap: oldCapTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const newLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction({ op: "local.get", index: sByteLenTmp });
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
				this.pushInstruction({ op: "local.get", index: sByteLenTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: newOffTmp });
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction("i32.add");

				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrByteAtImportIndex(),
				});
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: kTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

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

				this.pushInstruction({ op: "local.get", index: sByteLenTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "ref.null", heapType: "any" });

				this.releaseTemp(kTmp, "i32");
				this.releaseTemp(newCapTmp, "i32");
				this.releaseTemp(newOffTmp, "i32");
				this.releaseTemp(newArrTmp, arrW);
				this.releaseTemp(newLenTmp, "i32");
				this.releaseTemp(oldCapTmp, "i32");
				this.releaseTemp(oldLenTmp, "i32");
				this.releaseTemp(oldOffTmp, "i32");
				this.releaseTemp(oldArrTmp, arrW);
				this.releaseTemp(sByteLenTmp, "i32");
				this.releaseTemp(strTmp, "externref");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "WriteRune": {
				const rTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: rTmp });

				// Validate rune: if r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF), r = 0xFFFD
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 0x10ffff });
				this.pushInstruction("i32.gt_u");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 0xd800 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 0x7ff });
				this.pushInstruction("i32.le_u");
				this.pushInstruction("i32.or");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0xfffd });
				this.pushInstruction({ op: "local.set", index: rTmp });
				this.pushInstruction("end");

				const rLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 128 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 2048 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 2 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: rTmp });
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

				const sTmp = getBufSlice();
				const oldArrTmp = this.acquireTemp(arrW);
				const oldOffTmp = this.acquireTemp("i32");
				const oldLenTmp = this.acquireTemp("i32");
				const oldCapTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: oldArrTmp,
					off: oldOffTmp,
					len: oldLenTmp,
					cap: oldCapTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const newLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction({ op: "local.get", index: rLenTmp });
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

				const setByte = (offset, getValFn) => {
					this.pushInstruction({ op: "local.get", index: newArrTmp });
					this.pushInstruction({ op: "local.get", index: newOffTmp });
					this.pushInstruction({ op: "local.get", index: oldLenTmp });
					this.pushInstruction("i32.add");
					if (offset > 0) {
						this.pushInstruction({ op: "i32.const", value: offset });
						this.pushInstruction("i32.add");
					}
					getValFn();
					this.pushInstruction({
						op: "array.set",
						typeIndex: arrInfo.typeIndex,
					});
				};

				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				setByte(0, () =>
					this.pushInstruction({ op: "local.get", index: rTmp }),
				);
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction({ op: "i32.const", value: 2 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				setByte(0, () => {
					this.pushInstruction({ op: "i32.const", value: 0xc0 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 6 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction("i32.or");
				});
				setByte(1, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction({ op: "i32.const", value: 3 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				setByte(0, () => {
					this.pushInstruction({ op: "i32.const", value: 0xe0 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 12 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction("i32.or");
				});
				setByte(1, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 6 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				setByte(2, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				this.pushInstruction("else");
				setByte(0, () => {
					this.pushInstruction({ op: "i32.const", value: 0xf0 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 18 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction("i32.or");
				});
				setByte(1, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 12 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				setByte(2, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 6 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				setByte(3, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: rTmp });
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction("end");

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

				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				setLastOp(0);

				this.releaseTemp(newCapTmp, "i32");
				this.releaseTemp(newOffTmp, "i32");
				this.releaseTemp(newArrTmp, arrW);
				this.releaseTemp(newLenTmp, "i32");
				this.releaseTemp(oldCapTmp, "i32");
				this.releaseTemp(oldLenTmp, "i32");
				this.releaseTemp(oldOffTmp, "i32");
				this.releaseTemp(oldArrTmp, arrW);
				this.releaseTemp(rLenTmp, "i32");
				this.releaseTemp(rTmp, "i32");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Grow": {
				const nTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: nTmp });

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("bytes.Buffer.Grow: negative count");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.gt_s");
				this.pushInstruction({ op: "if", blockType: "void" });

				const sTmp = getBufSlice();
				const oldArrTmp = this.acquireTemp(arrW);
				const oldOffTmp = this.acquireTemp("i32");
				const oldLenTmp = this.acquireTemp("i32");
				const oldCapTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: oldArrTmp,
					off: oldOffTmp,
					len: oldLenTmp,
					cap: oldCapTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const targetCapTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: targetCapTmp });

				this.pushInstruction({ op: "local.get", index: targetCapTmp });
				this.pushInstruction({ op: "local.get", index: oldCapTmp });
				this.pushInstruction("i32.gt_u");
				this.pushInstruction({ op: "if", blockType: "void" });

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
					newLenTmp: targetCapTmp,
					newCapTmp,
				});

				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: newOffTmp });
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
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

				this.releaseTemp(newCapTmp, "i32");
				this.releaseTemp(newOffTmp, "i32");
				this.releaseTemp(newArrTmp, arrW);
				this.pushInstruction("end");

				this.releaseTemp(targetCapTmp, "i32");
				this.releaseTemp(oldCapTmp, "i32");
				this.releaseTemp(oldLenTmp, "i32");
				this.releaseTemp(oldOffTmp, "i32");
				this.releaseTemp(oldArrTmp, arrW);
				this.pushInstruction("end");

				setLastOp(0);
				this.releaseTemp(nTmp, "i32");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Read": {
				const pTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: pTmp });

				this._emitBufferReadCore(bTmp, pTmp);
				this.releaseTemp(pTmp, sliceW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "ReadByte": {
				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const resByteTmp = this.acquireTemp("i32");
				const resErrTmp = this.acquireTemp("anyref");

				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: resByteTmp });
				this.emitIoConst("EOF", "anyref");
				this.pushInstruction({ op: "local.set", index: resErrTmp });
				setLastOp(0);
				this.pushInstruction("else");

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: resByteTmp });

				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({ op: "local.set", index: resErrTmp });

				// update b.buf: (arrTmp, offTmp + 1, lenTmp - 1, capTmp - 1)
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});
				setLastOp(1);
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: resByteTmp });
				this.pushInstruction({ op: "local.get", index: resErrTmp });

				this.releaseTemp(resErrTmp, "anyref");
				this.releaseTemp(resByteTmp, "i32");
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "UnreadByte": {
				const resErrTmp = this.acquireTemp("anyref");
				if (structInfo.fields.length > 1) {
					this.pushInstruction({ op: "local.get", index: bTmp });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: structInfo.typeIndex,
						fieldIndex: 1,
					});
					this.pushInstruction({ op: "i64.const", value: 1n });
					this.pushInstruction("i64.ne");
					this.pushInstruction({ op: "if", blockType: "void" });
					this._emitNewError(
						"bytes.Buffer: UnreadByte: previous operation was not a successful read",
					);
					this.pushInstruction({ op: "local.set", index: resErrTmp });
					this.pushInstruction("else");

					const sTmp = getBufSlice();
					const arrTmp = this.acquireTemp(arrW);
					const offTmp = this.acquireTemp("i32");
					const lenTmp = this.acquireTemp("i32");
					const capTmp = this.acquireTemp("i32");
					this._emitSliceUnpack(sTmp, sliceInfo, {
						arr: arrTmp,
						off: offTmp,
						len: lenTmp,
						cap: capTmp,
					});
					this.releaseTemp(sTmp, sliceW);

					// update b.buf: (arrTmp, offTmp - 1, lenTmp + 1, capTmp + 1)
					this.pushInstruction({ op: "local.get", index: bTmp });
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "local.get", index: offTmp });
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction("i32.sub");
					this.pushInstruction({ op: "local.get", index: lenTmp });
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction("i32.add");
					this.pushInstruction({ op: "local.get", index: capTmp });
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction("i32.add");
					this.pushInstruction({
						op: "struct.new",
						typeIndex: sliceInfo.typeIndex,
					});
					this.pushInstruction({
						op: "struct.set",
						typeIndex: structInfo.typeIndex,
						fieldIndex: 0,
					});
					setLastOp(0);

					this.pushInstruction({ op: "ref.null", heapType: "any" });
					this.pushInstruction({ op: "local.set", index: resErrTmp });

					this.releaseTemp(capTmp, "i32");
					this.releaseTemp(lenTmp, "i32");
					this.releaseTemp(offTmp, "i32");
					this.releaseTemp(arrTmp, arrW);
					this.pushInstruction("end");
				} else {
					this._emitNewError(
						"bytes.Buffer: UnreadByte: previous operation was not a successful read",
					);
					this.pushInstruction({ op: "local.set", index: resErrTmp });
				}

				this.pushInstruction({ op: "local.get", index: resErrTmp });
				this.releaseTemp(resErrTmp, "anyref");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "ReadRune": {
				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const resRuneTmp = this.acquireTemp("i32");
				const resSizeTmp = this.acquireTemp("i64");
				const resErrTmp = this.acquireTemp("anyref");

				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: resRuneTmp });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction({ op: "local.set", index: resSizeTmp });
				this.emitIoConst("EOF", "anyref");
				this.pushInstruction({ op: "local.set", index: resErrTmp });
				setLastOp(0);
				this.pushInstruction("else");

				const cpTmp = this.acquireTemp("i32");
				const runeLenTmp = this.acquireTemp("i32");
				const zeroTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: zeroTmp });

				this._emitDecodeUtf8Rune({
					arrTmp,
					offTmp,
					idxTmp: zeroTmp,
					lenTmp,
					outRuneTmp: cpTmp,
					outLenTmp: runeLenTmp,
					arrTypeIndex: arrInfo.typeIndex,
				});
				this.releaseTemp(zeroTmp, "i32");

				// update b.buf: (arrTmp, offTmp + runeLenTmp, lenTmp - runeLenTmp, capTmp - runeLenTmp)
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: runeLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: runeLenTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({ op: "local.get", index: runeLenTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});

				setLastOp(2);
				setLastRuneLen(runeLenTmp);

				this.pushInstruction({ op: "local.get", index: cpTmp });
				this.pushInstruction({ op: "local.set", index: resRuneTmp });
				this.pushInstruction({ op: "local.get", index: runeLenTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction({ op: "local.set", index: resSizeTmp });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({ op: "local.set", index: resErrTmp });

				this.releaseTemp(runeLenTmp, "i32");
				this.releaseTemp(cpTmp, "i32");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: resRuneTmp });
				this.pushInstruction({ op: "local.get", index: resSizeTmp });
				this.pushInstruction({ op: "local.get", index: resErrTmp });

				this.releaseTemp(resErrTmp, "anyref");
				this.releaseTemp(resSizeTmp, "i64");
				this.releaseTemp(resRuneTmp, "i32");
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "UnreadRune": {
				const resErrTmp = this.acquireTemp("anyref");
				if (structInfo.fields.length > 2) {
					this.pushInstruction({ op: "local.get", index: bTmp });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: structInfo.typeIndex,
						fieldIndex: 1,
					});
					this.pushInstruction({ op: "i64.const", value: 2n });
					this.pushInstruction("i64.ne");
					this.pushInstruction({ op: "if", blockType: "void" });
					this._emitNewError(
						"bytes.Buffer: UnreadRune: previous operation was not a successful ReadRune",
					);
					this.pushInstruction({ op: "local.set", index: resErrTmp });
					this.pushInstruction("else");

					const lastRuneLenTmp = this.acquireTemp("i32");
					this.pushInstruction({ op: "local.get", index: bTmp });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: structInfo.typeIndex,
						fieldIndex: 2,
					});
					this.pushInstruction("i32.wrap_i64");
					this.pushInstruction({ op: "local.set", index: lastRuneLenTmp });

					const sTmp = getBufSlice();
					const arrTmp = this.acquireTemp(arrW);
					const offTmp = this.acquireTemp("i32");
					const lenTmp = this.acquireTemp("i32");
					const capTmp = this.acquireTemp("i32");
					this._emitSliceUnpack(sTmp, sliceInfo, {
						arr: arrTmp,
						off: offTmp,
						len: lenTmp,
						cap: capTmp,
					});
					this.releaseTemp(sTmp, sliceW);

					// update b.buf: (arrTmp, offTmp - lastRuneLenTmp, lenTmp + lastRuneLenTmp, capTmp + lastRuneLenTmp)
					this.pushInstruction({ op: "local.get", index: bTmp });
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "local.get", index: offTmp });
					this.pushInstruction({ op: "local.get", index: lastRuneLenTmp });
					this.pushInstruction("i32.sub");
					this.pushInstruction({ op: "local.get", index: lenTmp });
					this.pushInstruction({ op: "local.get", index: lastRuneLenTmp });
					this.pushInstruction("i32.add");
					this.pushInstruction({ op: "local.get", index: capTmp });
					this.pushInstruction({ op: "local.get", index: lastRuneLenTmp });
					this.pushInstruction("i32.add");
					this.pushInstruction({
						op: "struct.new",
						typeIndex: sliceInfo.typeIndex,
					});
					this.pushInstruction({
						op: "struct.set",
						typeIndex: structInfo.typeIndex,
						fieldIndex: 0,
					});
					setLastOp(0);

					this.pushInstruction({ op: "ref.null", heapType: "any" });
					this.pushInstruction({ op: "local.set", index: resErrTmp });

					this.releaseTemp(capTmp, "i32");
					this.releaseTemp(lenTmp, "i32");
					this.releaseTemp(offTmp, "i32");
					this.releaseTemp(arrTmp, arrW);
					this.releaseTemp(lastRuneLenTmp, "i32");
					this.pushInstruction("end");
				} else {
					this._emitNewError(
						"bytes.Buffer: UnreadRune: previous operation was not a successful ReadRune",
					);
					this.pushInstruction({ op: "local.set", index: resErrTmp });
				}

				this.pushInstruction({ op: "local.get", index: resErrTmp });
				this.releaseTemp(resErrTmp, "anyref");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "ReadBytes":
			case "ReadString": {
				const isStr = method === "ReadString";
				const delimTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: delimTmp });

				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				// Find delim
				const kTmp = this.acquireTemp("i32");
				const matchTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: kTmp });
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction({ op: "local.set", index: matchTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.get", index: delimTmp });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "local.set", index: matchTmp });
				this.pushInstruction({ op: "br", depth: 2 });
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: kTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.releaseTemp(kTmp, "i32");
				this.releaseTemp(delimTmp, "i32");

				const resLineTmp = isStr ? null : this.acquireTemp(sliceW);
				const resStrTmp = isStr ? this.acquireTemp("externref") : null;
				const resErrTmp = this.acquireTemp("anyref");

				this.pushInstruction({ op: "local.get", index: matchTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "if", blockType: "void" });

				const lineLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: matchTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: lineLenTmp });

				if (isStr) {
					this._emitBytesSliceToString(
						arrTmp,
						offTmp,
						lineLenTmp,
						arrInfo.typeIndex,
					);
					this.pushInstruction({ op: "local.set", index: resStrTmp });
				} else {
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "local.get", index: offTmp });
					this.pushInstruction({ op: "local.get", index: lineLenTmp });
					this.pushInstruction({ op: "local.get", index: lineLenTmp });
					this.pushInstruction({
						op: "struct.new",
						typeIndex: sliceInfo.typeIndex,
					});
					this.pushInstruction({ op: "local.set", index: resLineTmp });
				}
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({ op: "local.set", index: resErrTmp });

				// update b.buf: (arrTmp, offTmp + lineLenTmp, lenTmp - lineLenTmp, capTmp - lineLenTmp)
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: lineLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: lineLenTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({ op: "local.get", index: lineLenTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});
				setLastOp(1);
				this.releaseTemp(lineLenTmp, "i32");

				this.pushInstruction("else");

				// Not found
				if (isStr) {
					this._emitBytesSliceToString(
						arrTmp,
						offTmp,
						lenTmp,
						arrInfo.typeIndex,
					);
					this.pushInstruction({ op: "local.set", index: resStrTmp });
				} else {
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "local.get", index: offTmp });
					this.pushInstruction({ op: "local.get", index: lenTmp });
					this.pushInstruction({ op: "local.get", index: lenTmp });
					this.pushInstruction({
						op: "struct.new",
						typeIndex: sliceInfo.typeIndex,
					});
					this.pushInstruction({ op: "local.set", index: resLineTmp });
				}
				this.emitIoConst("EOF", "anyref");
				this.pushInstruction({ op: "local.set", index: resErrTmp });

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
				setLastOp(0);
				this.pushInstruction("end");

				if (isStr) {
					this.pushInstruction({ op: "local.get", index: resStrTmp });
					this.releaseTemp(resStrTmp, "externref");
				} else {
					this.pushInstruction({ op: "local.get", index: resLineTmp });
					this.releaseTemp(resLineTmp, sliceW);
				}
				this.pushInstruction({ op: "local.get", index: resErrTmp });

				this.releaseTemp(resErrTmp, "anyref");
				this.releaseTemp(matchTmp, "i32");
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "ReadFrom": {
				const rTmp = this.acquireTemp("anyref");
				this.emitExpr(args[0], "anyref");
				this.pushInstruction({ op: "local.set", index: rTmp });

				const chunkLen = 4096;
				const chunkArrTmp = this.acquireTemp(arrW);
				this.pushInstruction({ op: "i32.const", value: chunkLen });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: chunkArrTmp });

				const chunkSliceTmp = this.acquireTemp(sliceW);
				this.pushInstruction({ op: "local.get", index: chunkArrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "i32.const", value: chunkLen });
				this.pushInstruction({ op: "i32.const", value: chunkLen });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: chunkSliceTmp });

				const totalTmp = this.acquireTemp("i64");
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction({ op: "local.set", index: totalTmp });

				const errTmp = this.acquireTemp("anyref");
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({ op: "local.set", index: errTmp });

				const readErrTmp = this.acquireTemp("anyref");
				const nrTmp = this.acquireTemp("i32");
				const subsliceTmp = this.acquireTemp(sliceW);

				const dispatchReadIdx = this.mod.resolveFuncIndex(
					"__dispatch_io.Reader_Read",
				);

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });

				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "local.get", index: chunkSliceTmp });
				if (dispatchReadIdx !== null) {
					this.pushInstruction({ op: "call", funcIndex: dispatchReadIdx });
				} else {
					this.pushInstruction({ op: "i64.const", value: 0n });
					this.pushInstruction({ op: "ref.null", heapType: "any" });
				}
				this.pushInstruction({ op: "local.set", index: readErrTmp });
				this.pushInstruction("i32.wrap_i64");
				this.pushInstruction({ op: "local.set", index: nrTmp });

				this.pushInstruction({ op: "local.get", index: nrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.gt_s");
				this.pushInstruction({ op: "if", blockType: "void" });

				this.pushInstruction({ op: "local.get", index: chunkArrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: nrTmp });
				this.pushInstruction({ op: "local.get", index: nrTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: subsliceTmp });

				this._emitBufferWriteCore(bTmp, subsliceTmp);
				this.pushInstruction("drop");
				this.pushInstruction("drop");

				this.pushInstruction({ op: "local.get", index: totalTmp });
				this.pushInstruction({ op: "local.get", index: nrTmp });
				this.pushInstruction("i64.extend_i32_u");
				this.pushInstruction("i64.add");
				this.pushInstruction({ op: "local.set", index: totalTmp });
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: readErrTmp });
				this.pushInstruction("ref.is_null");
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: readErrTmp });
				this.emitIoConst("EOF", "anyref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__errors_is"),
				});
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({ op: "local.set", index: errTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: readErrTmp });
				this.pushInstruction({ op: "local.set", index: errTmp });
				this.pushInstruction("end");
				this.pushInstruction({ op: "br", depth: 2 });
				this.pushInstruction("end");

				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				setLastOp(0);

				this.pushInstruction({ op: "local.get", index: totalTmp });
				this.pushInstruction({ op: "local.get", index: errTmp });

				this.releaseTemp(subsliceTmp, sliceW);
				this.releaseTemp(nrTmp, "i32");
				this.releaseTemp(readErrTmp, "anyref");
				this.releaseTemp(errTmp, "anyref");
				this.releaseTemp(totalTmp, "i64");
				this.releaseTemp(chunkSliceTmp, sliceW);
				this.releaseTemp(chunkArrTmp, arrW);
				this.releaseTemp(rTmp, "anyref");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "WriteTo": {
				const wTmp = this.acquireTemp("anyref");
				this.emitExpr(args[0], "anyref");
				this.pushInstruction({ op: "local.set", index: wTmp });

				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});

				const resNTmp = this.acquireTemp("i64");
				const resErrTmp = this.acquireTemp("anyref");

				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction({ op: "local.set", index: resNTmp });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({ op: "local.set", index: resErrTmp });
				this.pushInstruction("else");

				const dispatchWriteIdx = this.mod.resolveFuncIndex(
					"__dispatch_io.Writer_Write",
				);
				this.pushInstruction({ op: "local.get", index: wTmp });
				this.pushInstruction({ op: "local.get", index: sTmp });
				if (dispatchWriteIdx !== null) {
					this.pushInstruction({ op: "call", funcIndex: dispatchWriteIdx });
				} else {
					this.pushInstruction({ op: "i64.const", value: 0n });
					this.pushInstruction({ op: "ref.null", heapType: "any" });
				}
				this.pushInstruction({ op: "local.set", index: resErrTmp });
				this.pushInstruction({ op: "local.set", index: resNTmp });

				const nwI32Tmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: resNTmp });
				this.pushInstruction("i32.wrap_i64");
				this.pushInstruction({ op: "local.set", index: nwI32Tmp });

				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: nwI32Tmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: nwI32Tmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({ op: "local.get", index: nwI32Tmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});
				setLastOp(0);
				this.releaseTemp(nwI32Tmp, "i32");
				this.pushInstruction("end");

				this.releaseTemp(sTmp, sliceW);
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);

				this.pushInstruction({ op: "local.get", index: resNTmp });
				this.pushInstruction({ op: "local.get", index: resErrTmp });

				this.releaseTemp(resErrTmp, "anyref");
				this.releaseTemp(resNTmp, "i64");
				this.releaseTemp(wTmp, "anyref");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Next": {
				const nTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: nTmp });

				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				const cntTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.gt_s");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.set", index: cntTmp });
				this.releaseTemp(nTmp, "i32");

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});
				setLastOp(0);

				this.releaseTemp(cntTmp, "i32");
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Truncate": {
				const nTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: nTmp });

				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.gt_s");
				this.pushInstruction("i32.or");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("bytes.Buffer: truncation out of range");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({
					op: "struct.set",
					typeIndex: structInfo.typeIndex,
					fieldIndex: 0,
				});
				setLastOp(0);

				this.releaseTemp(nTmp, "i32");
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Available": {
				const sTmp = getBufSlice();
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: sTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
				this.pushInstruction({ op: "local.set", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: sTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 3,
				});
				this.pushInstruction({ op: "local.set", index: capTmp });
				this.releaseTemp(sTmp, sliceW);

				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.sub");
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_u");
				}
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "AvailableBuffer": {
				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(bTmp, bufW);
				return;
			}
			case "Peek": {
				const nTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: nTmp });

				const sTmp = getBufSlice();
				const arrTmp = this.acquireTemp(arrW);
				const offTmp = this.acquireTemp("i32");
				const lenTmp = this.acquireTemp("i32");
				const capTmp = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: arrTmp,
					off: offTmp,
					len: lenTmp,
					cap: capTmp,
				});
				this.releaseTemp(sTmp, sliceW);

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("runtime error: slice bounds out of range");
				this.pushInstruction("end");

				const resSliceTmp = this.acquireTemp(sliceW);
				const resErrTmp = this.acquireTemp("anyref");

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.gt_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: resSliceTmp });
				this.emitIoConst("EOF", "anyref");
				this.pushInstruction({ op: "local.set", index: resErrTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: resSliceTmp });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction({ op: "local.set", index: resErrTmp });
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: resSliceTmp });
				this.pushInstruction({ op: "local.get", index: resErrTmp });

				this.releaseTemp(resErrTmp, "anyref");
				this.releaseTemp(resSliceTmp, sliceW);
				this.releaseTemp(capTmp, "i32");
				this.releaseTemp(lenTmp, "i32");
				this.releaseTemp(offTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(nTmp, "i32");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			default:
				throw new Error(`Unsupported bytes.Buffer method: ${method}`);
		}
	}
	_emitBytesSliceToString(arrTmp, offTmp, lenTmp, arrTypeIndex) {
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "externref" });
		const emptyStrIdx = this.mod.internString("");
		this.pushInstruction({ op: "i32.const", value: emptyStrIdx });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: lenTmp });
		this._callStdlib("bytes_to_str_init");

		const kTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: kTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this._callStdlib("bytes_to_str_push");

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this._callStdlib("bytes_to_str_finish");
		this.pushInstruction("end");
		this.releaseTemp(kTmp, "i32");
	}

	_emitDecodeUtf8Rune({
		arrTmp,
		offTmp,
		idxTmp,
		lenTmp,
		outRuneTmp,
		outLenTmp,
		arrTypeIndex,
	}) {
		const b0Tmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this.pushInstruction({ op: "local.set", index: b0Tmp });

		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "local.set", index: outRuneTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: outLenTmp });

		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "i32.const", value: 0x80 });
		this.pushInstruction("i32.ge_u");
		this.pushInstruction({ op: "if", blockType: "void" });

		// 2-byte: (b0 & 0xe0) == 0xc0
		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "i32.const", value: 0xe0 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 0xc0 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction({ op: "local.set", index: outLenTmp });
		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "i32.const", value: 0x1f });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 6 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this.pushInstruction({ op: "i32.const", value: 0x3f });
		this.pushInstruction("i32.and");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: outRuneTmp });
		this.pushInstruction("end");
		this.pushInstruction("else");

		// 3-byte: (b0 & 0xf0) == 0xe0
		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "i32.const", value: 0xf0 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 0xe0 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 3 });
		this.pushInstruction({ op: "local.set", index: outLenTmp });
		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "i32.const", value: 0x0f });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 12 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this.pushInstruction({ op: "i32.const", value: 0x3f });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 6 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this.pushInstruction({ op: "i32.const", value: 0x3f });
		this.pushInstruction("i32.and");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: outRuneTmp });
		this.pushInstruction("end");
		this.pushInstruction("else");

		// 4-byte: (b0 & 0xf8) == 0xf0
		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "i32.const", value: 0xf8 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 0xf0 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 3 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction({ op: "local.set", index: outLenTmp });
		this.pushInstruction({ op: "local.get", index: b0Tmp });
		this.pushInstruction({ op: "i32.const", value: 0x07 });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 18 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this.pushInstruction({ op: "i32.const", value: 0x3f });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 12 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this.pushInstruction({ op: "i32.const", value: 0x3f });
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "i32.const", value: 6 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 3 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrTypeIndex });
		this.pushInstruction({ op: "i32.const", value: 0x3f });
		this.pushInstruction("i32.and");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: outRuneTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(b0Tmp, "i32");
	}

	_emitBytesToValidUTF8(args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const bTmp = this.acquireTemp(sliceW);
		const replTmp = this.acquireTemp(sliceW);
		this.emitExpr(args[0], sliceW);
		this.pushInstruction({ op: "local.set", index: bTmp });
		this.emitExpr(args[1], sliceW);
		this.pushInstruction({ op: "local.set", index: replTmp });

		const bArr = this.acquireTemp(arrW),
			bOff = this.acquireTemp("i32"),
			bLen = this.acquireTemp("i32");
		const replArr = this.acquireTemp(arrW),
			replOff = this.acquireTemp("i32"),
			replLen = this.acquireTemp("i32");

		this._emitSliceUnpack(bTmp, sliceInfo, {
			arr: bArr,
			off: bOff,
			len: bLen,
		});
		this._emitSliceUnpack(replTmp, sliceInfo, {
			arr: replArr,
			off: replOff,
			len: replLen,
		});

		// Pass 1: compute outLen
		const outLenTmp = this.acquireTemp("i32");
		const inInvalidTmp = this.acquireTemp("i32");
		const iTmp = this.acquireTemp("i32");
		const b0Tmp = this.acquireTemp("i32");
		const szTmp = this.acquireTemp("i32");
		const validTmp = this.acquireTemp("i32");
		const b1Tmp = this.acquireTemp("i32");
		const b2Tmp = this.acquireTemp("i32");
		const b3Tmp = this.acquireTemp("i32");
		const rTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: outLenTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inInvalidTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		const emitValidateStep = () => {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: szTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: validTmp });

			this.pushInstruction({ op: "local.get", index: bArr });
			this.pushInstruction({ op: "local.get", index: bOff });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: b0Tmp });

			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x80 });
			this.pushInstruction("i32.lt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: szTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: validTmp });
			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xc2 });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xdf });
			this.pushInstruction("i32.le_u");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: bLen });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: bArr });
			this.pushInstruction({ op: "local.get", index: bOff });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "i32.const", value: 0xc0 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 0x80 });
			this.pushInstruction("i32.eq");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction({ op: "local.set", index: szTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: validTmp });
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xe0 });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xef });
			this.pushInstruction("i32.le_u");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: bLen });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: bArr });
			this.pushInstruction({ op: "local.get", index: bOff });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: b1Tmp });

			this.pushInstruction({ op: "local.get", index: bArr });
			this.pushInstruction({ op: "local.get", index: bOff });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: b2Tmp });

			this.pushInstruction({ op: "local.get", index: b1Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xc0 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 0x80 });
			this.pushInstruction("i32.eq");
			this.pushInstruction({ op: "local.get", index: b2Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xc0 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 0x80 });
			this.pushInstruction("i32.eq");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x0f });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 12 });
			this.pushInstruction("i32.shl");
			this.pushInstruction({ op: "local.get", index: b1Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x3f });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 6 });
			this.pushInstruction("i32.shl");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.get", index: b2Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x3f });
			this.pushInstruction("i32.and");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.set", index: rTmp });

			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i32.const", value: 0x800 });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i32.const", value: 0xd800 });
			this.pushInstruction("i32.lt_u");
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i32.const", value: 0xdfff });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction("i32.or");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 3 });
			this.pushInstruction({ op: "local.set", index: szTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: validTmp });
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xf0 });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xf4 });
			this.pushInstruction("i32.le_u");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction({ op: "i32.const", value: 3 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: bLen });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: bArr });
			this.pushInstruction({ op: "local.get", index: bOff });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: b1Tmp });

			this.pushInstruction({ op: "local.get", index: bArr });
			this.pushInstruction({ op: "local.get", index: bOff });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: b2Tmp });

			this.pushInstruction({ op: "local.get", index: bArr });
			this.pushInstruction({ op: "local.get", index: bOff });
			this.pushInstruction({ op: "local.get", index: iTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "i32.const", value: 3 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.set", index: b3Tmp });

			this.pushInstruction({ op: "local.get", index: b1Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xc0 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 0x80 });
			this.pushInstruction("i32.eq");
			this.pushInstruction({ op: "local.get", index: b2Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xc0 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 0x80 });
			this.pushInstruction("i32.eq");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "local.get", index: b3Tmp });
			this.pushInstruction({ op: "i32.const", value: 0xc0 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 0x80 });
			this.pushInstruction("i32.eq");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: b0Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x07 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 18 });
			this.pushInstruction("i32.shl");
			this.pushInstruction({ op: "local.get", index: b1Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x3f });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 12 });
			this.pushInstruction("i32.shl");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.get", index: b2Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x3f });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 6 });
			this.pushInstruction("i32.shl");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.get", index: b3Tmp });
			this.pushInstruction({ op: "i32.const", value: 0x3f });
			this.pushInstruction("i32.and");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.set", index: rTmp });

			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i32.const", value: 0x10000 });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i32.const", value: 0x10ffff });
			this.pushInstruction("i32.le_u");
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 4 });
			this.pushInstruction({ op: "local.set", index: szTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: validTmp });
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.pushInstruction("end");
		};

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		emitValidateStep();

		this.pushInstruction({ op: "local.get", index: validTmp });
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: inInvalidTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: outLenTmp });
		this.pushInstruction({ op: "local.get", index: replLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: outLenTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inInvalidTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: outLenTmp });
		this.pushInstruction({ op: "local.get", index: szTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: outLenTmp });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: szTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction("else");

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: inInvalidTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction("end");

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: inInvalidTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: outLenTmp });
		this.pushInstruction({ op: "local.get", index: replLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: outLenTmp });
		this.pushInstruction("end");

		const resArrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "local.get", index: outLenTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: resArrTmp });

		const dstTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: dstTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inInvalidTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		emitValidateStep();

		this.pushInstruction({ op: "local.get", index: validTmp });
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: inInvalidTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: replLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: replArr });
		this.pushInstruction({ op: "local.get", index: replOff });
		this.pushInstruction({ op: "local.get", index: replLen });
		this._emitArrayCopy(arrInfo, byteGo);
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: replLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: dstTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inInvalidTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: szTmp });
		this._emitArrayCopy(arrInfo, byteGo);

		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: szTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: dstTmp });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: szTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction("else");

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: inInvalidTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction("end");

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: inInvalidTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: replLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: replArr });
		this.pushInstruction({ op: "local.get", index: replOff });
		this.pushInstruction({ op: "local.get", index: replLen });
		this._emitArrayCopy(arrInfo, byteGo);
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: outLenTmp });
		this.pushInstruction({ op: "local.get", index: outLenTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(dstTmp, "i32");
		this.releaseTemp(resArrTmp, arrW);
		this.releaseTemp(rTmp, "i32");
		this.releaseTemp(b3Tmp, "i32");
		this.releaseTemp(b2Tmp, "i32");
		this.releaseTemp(b1Tmp, "i32");
		this.releaseTemp(validTmp, "i32");
		this.releaseTemp(szTmp, "i32");
		this.releaseTemp(b0Tmp, "i32");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(inInvalidTmp, "i32");
		this.releaseTemp(outLenTmp, "i32");

		this.releaseTemp(replLen, "i32");
		this.releaseTemp(replOff, "i32");
		this.releaseTemp(replArr, arrW);
		this.releaseTemp(bLen, "i32");
		this.releaseTemp(bOff, "i32");
		this.releaseTemp(bArr, arrW);
		this.releaseTemp(replTmp, sliceW);
		this.releaseTemp(bTmp, sliceW);
	}
}
