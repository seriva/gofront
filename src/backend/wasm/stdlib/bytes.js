// src/backend/wasm/stdlib/bytes.js
// FunctionEmitter mixin: bytes package functions and bytes.Buffer methods.

export class BytesEmitter {
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

				this.releaseTemp(nTmp, "i32");
				this.releaseTemp(bTmp, bufW);
				return;
			}
			default:
				throw new Error(`Unsupported bytes.Buffer method: ${method}`);
		}
	}

	emitBytesCall(name, args, targetWasmType) {
		switch (name) {
			case "Equal":
				return this._emitBytesEqual(name, args, targetWasmType);
			case "HasPrefix":
			case "HasSuffix":
				return this._emitBytesPrefixSuffix(name, args, targetWasmType);
			case "IndexByte":
			case "LastIndexByte":
			case "Index":
			case "LastIndex":
			case "Contains":
			case "ContainsRune":
			case "ContainsAny":
				return this._emitBytesSearch(name, args, targetWasmType);
			case "Count":
				return this._emitBytesCount(name, args, targetWasmType);
			case "Repeat":
				return this._emitBytesRepeat(name, args, targetWasmType);
			case "ToUpper":
			case "ToLower":
				return this._emitBytesCase(name, args, targetWasmType);
			case "TrimSpace":
			case "TrimPrefix":
			case "TrimSuffix":
			case "TrimLeft":
			case "TrimRight":
			case "Trim":
			case "TrimFunc":
				return this._emitBytesTrim(name, args, targetWasmType);
			case "Cut":
				return this._emitBytesCut(name, args, targetWasmType);
			case "Replace":
			case "ReplaceAll":
				return this._emitBytesReplace(name, args, targetWasmType);
			case "Map":
				return this._emitBytesMap(name, args, targetWasmType);
			case "Split":
			case "SplitN":
				return this._emitBytesSplit(name, args, targetWasmType);
			case "Fields":
				return this._emitBytesFields(name, args, targetWasmType);
			case "FieldsFunc":
				return this._emitBytesFieldsFunc(args, targetWasmType);
			case "Clone":
				return this.emitSlicesClone(args);
			case "Join":
				return this._emitBytesJoin(name, args, targetWasmType);
			default:
				throw new Error(`Unsupported bytes function: bytes.${name}`);
		}
	}

	_emitBytesEqual(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "Equal": {
				const aTmp = this.acquireTemp(sliceW);
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: aTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });

				const aArr = this.acquireTemp(arrW),
					aOff = this.acquireTemp("i32"),
					aLen = this.acquireTemp("i32");
				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32");
				this._emitSliceUnpack(aTmp, sliceInfo, {
					arr: aArr,
					off: aOff,
					len: aLen,
				});
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
				});
				this.releaseTemp(bTmp, sliceW);
				this.releaseTemp(aTmp, sliceW);

				const resTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction({ op: "local.set", index: resTmp });

				this.pushInstruction({ op: "local.get", index: aLen });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction("i32.ne");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: resTmp });
				this.pushInstruction("else");

				const iTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: aLen });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: aArr });
				this.pushInstruction({ op: "local.get", index: aOff });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction("i32.ne");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: resTmp });
				this.pushInstruction({ op: "br", depth: 2 });
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.releaseTemp(iTmp, "i32");
				this.pushInstruction("end"); // end if

				this.pushInstruction({ op: "local.get", index: resTmp });
				this.releaseTemp(resTmp, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				this.releaseTemp(aLen, "i32");
				this.releaseTemp(aOff, "i32");
				this.releaseTemp(aArr, arrW);
				return;
			}
		}
	}

	_emitBytesPrefixSuffix(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		switch (name) {
			case "HasPrefix": {
				const sTmp = this.acquireTemp(sliceW);
				const pTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: sTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: pTmp });
				this._emitInternalBytesHasPrefix(sTmp, pTmp);
				this.releaseTemp(pTmp, sliceW);
				this.releaseTemp(sTmp, sliceW);
				return;
			}
			case "HasSuffix": {
				const sTmp = this.acquireTemp(sliceW);
				const pTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: sTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: pTmp });
				this._emitInternalBytesHasSuffix(sTmp, pTmp);
				this.releaseTemp(pTmp, sliceW);
				this.releaseTemp(sTmp, sliceW);
				return;
			}
		}
	}

	_emitBytesSearch(name, args, targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "IndexByte":
			case "LastIndexByte": {
				const isLast = name === "LastIndexByte";
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				const cTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[1]);
				this.pushInstruction({ op: "local.set", index: cTmp });

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
				});
				this.releaseTemp(bTmp, sliceW);

				const resTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction({ op: "local.set", index: resTmp });

				const iTmp = this.acquireTemp("i32");
				if (isLast) {
					this.pushInstruction({ op: "local.get", index: bLen });
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction("i32.sub");
					this.pushInstruction({ op: "local.set", index: iTmp });
				} else {
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.pushInstruction({ op: "local.set", index: iTmp });
				}

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				if (isLast) {
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.pushInstruction("i32.lt_s");
				} else {
					this.pushInstruction({ op: "local.get", index: bLen });
					this.pushInstruction("i32.ge_s");
				}
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.get", index: cTmp });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.set", index: resTmp });
				this.pushInstruction({ op: "br", depth: 2 });
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				if (isLast) this.pushInstruction("i32.sub");
				else this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: resTmp });
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				this.releaseTemp(iTmp, "i32");
				this.releaseTemp(resTmp, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				this.releaseTemp(cTmp, "i32");
				return;
			}
			case "Index":
			case "LastIndex":
			case "Contains": {
				const isLast = name === "LastIndex";
				const isContains = name === "Contains";
				const sTmp = this.acquireTemp(sliceW);
				const sepTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: sTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: sepTmp });

				this._emitInternalBytesIndex(sTmp, sepTmp, isLast);

				if (isContains) {
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.pushInstruction("i32.ge_s");
				} else if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}

				this.releaseTemp(sepTmp, sliceW);
				this.releaseTemp(sTmp, sliceW);
				return;
			}
			case "ContainsRune": {
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				const rTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[1]);
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

				// Compute rLen (1, 2, 3, or 4)
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

				// Allocate array of rLen bytes
				const rArrTmp = this.acquireTemp(arrW);
				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: rArrTmp });

				const setByte = (offset, getValFn) => {
					this.pushInstruction({ op: "local.get", index: rArrTmp });
					this.pushInstruction({ op: "i32.const", value: offset });
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

				// Wrap in slice struct
				const rSliceTmp = this.acquireTemp(sliceW);
				this.pushInstruction({ op: "local.get", index: rArrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction({ op: "local.get", index: rLenTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: rSliceTmp });

				this._emitInternalBytesIndex(bTmp, rSliceTmp, false);
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.ge_s");

				this.releaseTemp(rSliceTmp, sliceW);
				this.releaseTemp(rArrTmp, arrW);
				this.releaseTemp(rLenTmp, "i32");
				this.releaseTemp(rTmp, "i32");
				this.releaseTemp(bTmp, sliceW);
				return;
			}
			case "ContainsAny": {
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
				});
				this.releaseTemp(bTmp, sliceW);

				this._emitBytesSliceToString(bArr, bOff, bLen, arrInfo.typeIndex);
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);

				this.emitExpr(args[1], "externref");
				this._callStdlib("str_contains_any");
				return;
			}
		}
	}

	_emitBytesCount(name, args, targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "Count": {
				const sTmp = this.acquireTemp(sliceW);
				const sepTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: sTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: sepTmp });

				const sArr = this.acquireTemp(arrW),
					sOff = this.acquireTemp("i32"),
					sLen = this.acquireTemp("i32");
				const sepArr = this.acquireTemp(arrW),
					sepOff = this.acquireTemp("i32"),
					sepLen = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: sArr,
					off: sOff,
					len: sLen,
				});
				this._emitSliceUnpack(sepTmp, sliceInfo, {
					arr: sepArr,
					off: sepOff,
					len: sepLen,
				});
				this.releaseTemp(sepTmp, sliceW);
				this.releaseTemp(sTmp, sliceW);

				const cntTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: sepLen });
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: sLen });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: cntTmp });
				this.pushInstruction("else");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: cntTmp });

				const iTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: sLen });
				this.pushInstruction({ op: "local.get", index: sepLen });
				this.pushInstruction("i32.sub");
				this.pushInstruction("i32.gt_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				// Match check
				const matchTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction({ op: "local.set", index: matchTmp });

				const jTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: jTmp });
				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: jTmp });
				this.pushInstruction({ op: "local.get", index: sepLen });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: sArr });
				this.pushInstruction({ op: "local.get", index: sOff });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: jTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

				this.pushInstruction({ op: "local.get", index: sepArr });
				this.pushInstruction({ op: "local.get", index: sepOff });
				this.pushInstruction({ op: "local.get", index: jTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction("i32.ne");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: matchTmp });
				this.pushInstruction({ op: "br", depth: 2 });
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: jTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: jTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.releaseTemp(jTmp, "i32");

				this.pushInstruction({ op: "local.get", index: matchTmp });
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: cntTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: sepLen });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction("end");

				this.releaseTemp(matchTmp, "i32");
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.releaseTemp(iTmp, "i32");
				this.pushInstruction("end"); // end else

				this.pushInstruction({ op: "local.get", index: cntTmp });
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				this.releaseTemp(cntTmp, "i32");
				this.releaseTemp(sepLen, "i32");
				this.releaseTemp(sepOff, "i32");
				this.releaseTemp(sepArr, arrW);
				this.releaseTemp(sLen, "i32");
				this.releaseTemp(sOff, "i32");
				this.releaseTemp(sArr, arrW);
				return;
			}
		}
	}

	_emitBytesRepeat(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "Repeat": {
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				const cntTmp = this.acquireTemp("i32");
				this._emitI32Arg(args[1]);
				this.pushInstruction({ op: "local.set", index: cntTmp });

				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("bytes: negative Repeat count");
				this.pushInstruction("end");

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
				});
				this.releaseTemp(bTmp, sliceW);

				const totLenTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction("i32.mul");
				this.pushInstruction({ op: "local.set", index: totLenTmp });

				const newArrTmp = this.acquireTemp(arrW);
				this.pushInstruction({ op: "local.get", index: totLenTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: newArrTmp });

				// if bLen > 0 && cnt > 0: copy in loop
				this.pushInstruction({ op: "local.get", index: totLenTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.gt_s");
				this.pushInstruction({ op: "if", blockType: "void" });

				const kTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: kTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "local.get", index: cntTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction("i32.mul");
				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: bLen });
				this._emitArrayCopy(arrInfo, byteGo);

				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: kTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.releaseTemp(kTmp, "i32");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: totLenTmp });
				this.pushInstruction({ op: "local.get", index: totLenTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(newArrTmp, arrW);
				this.releaseTemp(totLenTmp, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				this.releaseTemp(cntTmp, "i32");
				return;
			}
		}
	}

	_emitBytesCase(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "ToUpper":
			case "ToLower": {
				const isUpper = name === "ToUpper";
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
				});
				this.releaseTemp(bTmp, sliceW);

				const newArrTmp = this.acquireTemp(arrW);
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: newArrTmp });

				const iTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				const cTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: cTmp });

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				if (isUpper) {
					// if c >= 'a' && c <= 'z' c - 32
					this.pushInstruction({ op: "local.get", index: cTmp });
					this.pushInstruction({ op: "i32.const", value: 97 });
					this.pushInstruction("i32.sub");
					this.pushInstruction({ op: "i32.const", value: 25 });
					this.pushInstruction("i32.le_u");
					this.pushInstruction({ op: "if", blockType: "i32" });
					this.pushInstruction({ op: "local.get", index: cTmp });
					this.pushInstruction({ op: "i32.const", value: 32 });
					this.pushInstruction("i32.sub");
					this.pushInstruction("else");
					this.pushInstruction({ op: "local.get", index: cTmp });
					this.pushInstruction("end");
				} else {
					// if c >= 'A' && c <= 'Z' c + 32
					this.pushInstruction({ op: "local.get", index: cTmp });
					this.pushInstruction({ op: "i32.const", value: 65 });
					this.pushInstruction("i32.sub");
					this.pushInstruction({ op: "i32.const", value: 25 });
					this.pushInstruction("i32.le_u");
					this.pushInstruction({ op: "if", blockType: "i32" });
					this.pushInstruction({ op: "local.get", index: cTmp });
					this.pushInstruction({ op: "i32.const", value: 32 });
					this.pushInstruction("i32.add");
					this.pushInstruction("else");
					this.pushInstruction({ op: "local.get", index: cTmp });
					this.pushInstruction("end");
				}
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
				this.releaseTemp(cTmp, "i32");

				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(iTmp, "i32");
				this.releaseTemp(newArrTmp, arrW);
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				return;
			}
		}
	}

	_emitBytesTrim(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "TrimSpace": {
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32"),
					bCap = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
					cap: bCap,
				});
				this.releaseTemp(bTmp, sliceW);

				const startTmp = this.acquireTemp("i32");
				const endTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: startTmp });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({ op: "local.set", index: endTmp });

				// trim left
				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction({ op: "local.get", index: endTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				const cTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: cTmp });

				// isSpace: c == 32 || (c >= 9 && c <= 13)
				this.pushInstruction({ op: "local.get", index: cTmp });
				this.pushInstruction({ op: "i32.const", value: 32 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "local.get", index: cTmp });
				this.pushInstruction({ op: "i32.const", value: 9 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 4 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction("i32.or");
				this.pushInstruction({ op: "i32.eqz" });
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: startTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				// trim right
				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: endTmp });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.le_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: endTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: cTmp });

				this.pushInstruction({ op: "local.get", index: cTmp });
				this.pushInstruction({ op: "i32.const", value: 32 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "local.get", index: cTmp });
				this.pushInstruction({ op: "i32.const", value: 9 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 4 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction("i32.or");
				this.pushInstruction({ op: "i32.eqz" });
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: endTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.set", index: endTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.releaseTemp(cTmp, "i32");

				// return subslice
				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: endTmp });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: bCap });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(endTmp, "i32");
				this.releaseTemp(startTmp, "i32");
				this.releaseTemp(bCap, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				return;
			}
			case "TrimPrefix": {
				const bTmp = this.acquireTemp(sliceW);
				const pTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: pTmp });

				this._emitInternalBytesHasPrefix(bTmp, pTmp);
				this.pushInstruction({ op: "if", blockType: sliceW });

				// subslice b[pLen:]
				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32"),
					bCap = this.acquireTemp("i32");
				const pLen = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
					cap: bCap,
				});
				this._emitSliceUnpack(pTmp, sliceInfo, { len: pLen });

				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: pLen });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({ op: "local.get", index: pLen });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: bCap });
				this.pushInstruction({ op: "local.get", index: pLen });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(pLen, "i32");
				this.releaseTemp(bCap, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);

				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction("end");

				this.releaseTemp(pTmp, sliceW);
				this.releaseTemp(bTmp, sliceW);
				return;
			}
			case "TrimSuffix": {
				const bTmp = this.acquireTemp(sliceW);
				const pTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: pTmp });

				this._emitInternalBytesHasSuffix(bTmp, pTmp);
				this.pushInstruction({ op: "if", blockType: sliceW });

				// subslice b[:len - pLen]
				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32"),
					bCap = this.acquireTemp("i32");
				const pLen = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
					cap: bCap,
				});
				this._emitSliceUnpack(pTmp, sliceInfo, { len: pLen });

				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({ op: "local.get", index: pLen });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: bCap });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(pLen, "i32");
				this.releaseTemp(bCap, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);

				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: bTmp });
				this.pushInstruction("end");

				this.releaseTemp(pTmp, sliceW);
				this.releaseTemp(bTmp, sliceW);
				return;
			}
			case "TrimLeft":
			case "TrimRight":
			case "Trim": {
				const left = name === "TrimLeft" || name === "Trim";
				const right = name === "TrimRight" || name === "Trim";
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				const cutsetTmp = this.acquireTemp("externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({ op: "local.set", index: cutsetTmp });

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32"),
					bCap = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
					cap: bCap,
				});
				this.releaseTemp(bTmp, sliceW);

				// Convert b to string
				this._emitBytesSliceToString(bArr, bOff, bLen, arrInfo.typeIndex);
				this.pushInstruction({ op: "local.get", index: cutsetTmp });
				this.pushInstruction({ op: "i32.const", value: left ? 1 : 0 });
				this.pushInstruction({ op: "i32.const", value: right ? 1 : 0 });
				this._callStdlib("bytes_trim");
				this.releaseTemp(cutsetTmp, "externref");

				const startTmp = this.acquireTemp("i32");
				const endTmp = this.acquireTemp("i32");
				this._callStdlib("bytes_trim_start");
				this.pushInstruction({ op: "local.set", index: startTmp });
				this._callStdlib("bytes_trim_end");
				this.pushInstruction({ op: "local.set", index: endTmp });

				// Subslice: b[start:end]
				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.add");

				this.pushInstruction({ op: "local.get", index: endTmp });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.sub");

				this.pushInstruction({ op: "local.get", index: bCap });
				this.pushInstruction({ op: "local.get", index: startTmp });
				this.pushInstruction("i32.sub");

				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(endTmp, "i32");
				this.releaseTemp(startTmp, "i32");
				this.releaseTemp(bCap, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				return;
			}
			case "TrimFunc": {
				const closureInfo = this.mod.getClosureType(
					this._resolveExprGoType(args[1]),
				);
				const closureW = {
					kind: "ref",
					nullable: true,
					typeIndex: closureInfo.typeIndex,
				};
				const bTmp = this.acquireTemp(sliceW);
				const clTmp = this.acquireTemp(closureW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				this.emitExpr(args[1], closureW);
				this.pushInstruction({ op: "local.set", index: clTmp });

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32"),
					bCap = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
					cap: bCap,
				});
				this.releaseTemp(bTmp, sliceW);

				const firstByteTmp = this.acquireTemp("i32");
				const lastByteTmp = this.acquireTemp("i32");
				const iTmp = this.acquireTemp("i32");
				const cpTmp = this.acquireTemp("i32");
				const runeLenTmp = this.acquireTemp("i32");

				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction({ op: "local.set", index: firstByteTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: lastByteTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this._emitDecodeUtf8Rune({
					arrTmp: bArr,
					offTmp: bOff,
					idxTmp: iTmp,
					lenTmp: bLen,
					outRuneTmp: cpTmp,
					outLenTmp: runeLenTmp,
					arrTypeIndex: arrInfo.typeIndex,
				});

				// call f(cp)
				this.pushInstruction({ op: "local.get", index: clTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: closureInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.get", index: cpTmp });
				if (closureInfo.paramWTypes[0] === "i64")
					this.pushInstruction("i64.extend_i32_u");
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
				// if (firstByteTmp == -1) firstByteTmp = iTmp;
				this.pushInstruction({ op: "local.get", index: firstByteTmp });
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.set", index: firstByteTmp });
				this.pushInstruction("end");
				// lastByteTmp = iTmp + runeLenTmp;
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: runeLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: lastByteTmp });
				this.pushInstruction("end");

				// iTmp += runeLenTmp
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: runeLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				// If firstByteTmp == -1, return empty subslice b[0:0]
				this.pushInstruction({ op: "local.get", index: firstByteTmp });
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: sliceW });
				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: bCap });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction("else");
				// subslice b[firstByteTmp : lastByteTmp]
				this.pushInstruction({ op: "local.get", index: bArr });
				this.pushInstruction({ op: "local.get", index: bOff });
				this.pushInstruction({ op: "local.get", index: firstByteTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: lastByteTmp });
				this.pushInstruction({ op: "local.get", index: firstByteTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: bCap });
				this.pushInstruction({ op: "local.get", index: firstByteTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction("end");

				this.releaseTemp(runeLenTmp, "i32");
				this.releaseTemp(cpTmp, "i32");
				this.releaseTemp(iTmp, "i32");
				this.releaseTemp(lastByteTmp, "i32");
				this.releaseTemp(firstByteTmp, "i32");
				this.releaseTemp(bCap, "i32");
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				this.releaseTemp(clTmp, closureW);
				return;
			}
		}
	}

	_emitBytesCut(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "Cut": {
				const sTmp = this.acquireTemp(sliceW);
				const sepTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: sTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: sepTmp });

				const sArr = this.acquireTemp(arrW),
					sOff = this.acquireTemp("i32"),
					sLen = this.acquireTemp("i32"),
					sCap = this.acquireTemp("i32");
				const sepLen = this.acquireTemp("i32");
				this._emitSliceUnpack(sTmp, sliceInfo, {
					arr: sArr,
					off: sOff,
					len: sLen,
					cap: sCap,
				});
				this._emitSliceUnpack(sepTmp, sliceInfo, { len: sepLen });

				const idxTmp = this.acquireTemp("i32");
				this._emitInternalBytesIndex(sTmp, sepTmp, false);
				this.pushInstruction({ op: "local.set", index: idxTmp });

				const beforeTmp = this.acquireTemp(sliceW);
				const afterTmp = this.acquireTemp(sliceW);
				const foundTmp = this.acquireTemp("i32");

				this.pushInstruction({ op: "local.get", index: idxTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "if", blockType: "void" });

				// found = true
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction({ op: "local.set", index: foundTmp });

				// before = s[:idx]
				this.pushInstruction({ op: "local.get", index: sArr });
				this.pushInstruction({ op: "local.get", index: sOff });
				this.pushInstruction({ op: "local.get", index: idxTmp });
				this.pushInstruction({ op: "local.get", index: sCap });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: beforeTmp });

				// after = s[idx + sepLen:]
				this.pushInstruction({ op: "local.get", index: sArr });
				this.pushInstruction({ op: "local.get", index: sOff });
				this.pushInstruction({ op: "local.get", index: idxTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: sepLen });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.get", index: sLen });
				this.pushInstruction({ op: "local.get", index: idxTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: sepLen });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: sCap });
				this.pushInstruction({ op: "local.get", index: idxTmp });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.get", index: sepLen });
				this.pushInstruction("i32.sub");
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: afterTmp });

				this.pushInstruction("else");

				// found = false, before = s, after = empty
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: foundTmp });
				this.pushInstruction({ op: "local.get", index: sTmp });
				this.pushInstruction({ op: "local.set", index: beforeTmp });
				this.pushInstruction({
					op: "global.get",
					index: sliceInfo.emptyGlobalIndex,
				});
				this.pushInstruction({ op: "local.set", index: afterTmp });
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: beforeTmp });
				this.pushInstruction({ op: "local.get", index: afterTmp });
				this.pushInstruction({ op: "local.get", index: foundTmp });

				this.releaseTemp(foundTmp, "i32");
				this.releaseTemp(afterTmp, sliceW);
				this.releaseTemp(beforeTmp, sliceW);
				this.releaseTemp(idxTmp, "i32");
				this.releaseTemp(sepLen, "i32");
				this.releaseTemp(sCap, "i32");
				this.releaseTemp(sLen, "i32");
				this.releaseTemp(sOff, "i32");
				this.releaseTemp(sArr, arrW);
				this.releaseTemp(sepTmp, sliceW);
				this.releaseTemp(sTmp, sliceW);
				return;
			}
		}
	}

	_emitBytesReplace(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		switch (name) {
			case "Replace":
			case "ReplaceAll": {
				const isAll = name === "ReplaceAll";
				const bTmp = this.acquireTemp(sliceW);
				const oldTmp = this.acquireTemp(sliceW);
				const newTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: oldTmp });
				this.emitExpr(args[2], sliceW);
				this.pushInstruction({ op: "local.set", index: newTmp });

				const nTmp = this.acquireTemp("i32");
				if (isAll) {
					this.pushInstruction({ op: "i32.const", value: -1 });
					this.pushInstruction({ op: "local.set", index: nTmp });
				} else {
					this._emitI32Arg(args[3]);
					this.pushInstruction({ op: "local.set", index: nTmp });
				}

				this._emitInternalBytesReplace(bTmp, oldTmp, newTmp, nTmp);

				this.releaseTemp(nTmp, "i32");
				this.releaseTemp(newTmp, sliceW);
				this.releaseTemp(oldTmp, sliceW);
				this.releaseTemp(bTmp, sliceW);
				return;
			}
		}
	}

	_emitBytesMap(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		switch (name) {
			case "Map": {
				const closureInfo = this.mod.getClosureType(
					this._resolveExprGoType(args[0]),
				);
				const closureW = {
					kind: "ref",
					nullable: true,
					typeIndex: closureInfo.typeIndex,
				};
				const clTmp = this.acquireTemp(closureW);
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], closureW);
				this.pushInstruction({ op: "local.set", index: clTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });

				const bArr = this.acquireTemp(arrW),
					bOff = this.acquireTemp("i32"),
					bLen = this.acquireTemp("i32");
				this._emitSliceUnpack(bTmp, sliceInfo, {
					arr: bArr,
					off: bOff,
					len: bLen,
				});
				this.releaseTemp(bTmp, sliceW);

				// Initialize output slice: curArr with initial cap = max(bLen, 4)
				const curArrTmp = this.acquireTemp(arrW);
				const curOffTmp = this.acquireTemp("i32");
				const curLenTmp = this.acquireTemp("i32");
				const curCapTmp = this.acquireTemp("i32");

				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction({ op: "i32.const", value: 4 });
				this.pushInstruction("i32.gt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction("else");
				this.pushInstruction({ op: "i32.const", value: 4 });
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.set", index: curCapTmp });

				this.pushInstruction({ op: "local.get", index: curCapTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: curArrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: curOffTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: curLenTmp });

				const iTmp = this.acquireTemp("i32");
				const cpTmp = this.acquireTemp("i32");
				const runeLenTmp = this.acquireTemp("i32");
				const outRTmp = this.acquireTemp("i32");
				const outRLenTmp = this.acquireTemp("i32");
				const nextLenTmp = this.acquireTemp("i32");
				const growArrTmp = this.acquireTemp(arrW);
				const growOffTmp = this.acquireTemp("i32");
				const growCapTmp = this.acquireTemp("i32");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: bLen });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this._emitDecodeUtf8Rune({
					arrTmp: bArr,
					offTmp: bOff,
					idxTmp: iTmp,
					lenTmp: bLen,
					outRuneTmp: cpTmp,
					outLenTmp: runeLenTmp,
					arrTypeIndex: arrInfo.typeIndex,
				});

				// call f(cp)
				this.pushInstruction({ op: "local.get", index: clTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: closureInfo.typeIndex,
					fieldIndex: 1,
				});
				this.pushInstruction({ op: "local.get", index: cpTmp });
				if (closureInfo.paramWTypes[0] === "i64")
					this.pushInstruction("i64.extend_i32_u");
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
				if (closureInfo.returnWTypes[0] === "i64")
					this.pushInstruction("i32.wrap_i64");
				this.pushInstruction({ op: "local.set", index: outRTmp });

				// if (outRTmp >= 0)
				this.pushInstruction({ op: "local.get", index: outRTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "if", blockType: "void" });

				// compute outRLen: < 128 ? 1 : < 2048 ? 2 : < 65536 ? 3 : 4
				this.pushInstruction({ op: "local.get", index: outRTmp });
				this.pushInstruction({ op: "i32.const", value: 128 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: outRTmp });
				this.pushInstruction({ op: "i32.const", value: 2048 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 2 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: outRTmp });
				this.pushInstruction({ op: "i32.const", value: 65536 });
				this.pushInstruction("i32.lt_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: 3 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "i32.const", value: 4 });
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.set", index: outRLenTmp });

				// nextLen = curLen + outRLen
				this.pushInstruction({ op: "local.get", index: curLenTmp });
				this.pushInstruction({ op: "local.get", index: outRLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: nextLenTmp });

				// grow if nextLen > curCap
				this._emitGrowSlice({
					arrInfo,
					elemGoType: byteGo,
					oldArrTmp: curArrTmp,
					oldOffTmp: curOffTmp,
					oldLenTmp: curLenTmp,
					oldCapTmp: curCapTmp,
					newArrTmp: growArrTmp,
					newOffTmp: growOffTmp,
					newLenTmp: nextLenTmp,
					newCapTmp: growCapTmp,
				});

				this.pushInstruction({ op: "local.get", index: growArrTmp });
				this.pushInstruction({ op: "local.set", index: curArrTmp });
				this.pushInstruction({ op: "local.get", index: growOffTmp });
				this.pushInstruction({ op: "local.set", index: curOffTmp });
				this.pushInstruction({ op: "local.get", index: growCapTmp });
				this.pushInstruction({ op: "local.set", index: curCapTmp });

				const setByte = (offset, getValFn) => {
					this.pushInstruction({ op: "local.get", index: curArrTmp });
					this.pushInstruction({ op: "local.get", index: curOffTmp });
					this.pushInstruction({ op: "local.get", index: curLenTmp });
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

				this.pushInstruction({ op: "local.get", index: outRLenTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				setByte(0, () =>
					this.pushInstruction({ op: "local.get", index: outRTmp }),
				);
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: outRLenTmp });
				this.pushInstruction({ op: "i32.const", value: 2 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				setByte(0, () => {
					this.pushInstruction({ op: "i32.const", value: 0xc0 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 6 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction("i32.or");
				});
				setByte(1, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: outRLenTmp });
				this.pushInstruction({ op: "i32.const", value: 3 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "if", blockType: "void" });
				setByte(0, () => {
					this.pushInstruction({ op: "i32.const", value: 0xe0 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 12 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction("i32.or");
				});
				setByte(1, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 6 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				setByte(2, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				this.pushInstruction("else");
				setByte(0, () => {
					this.pushInstruction({ op: "i32.const", value: 0xf0 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 18 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction("i32.or");
				});
				setByte(1, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 12 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				setByte(2, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 6 });
					this.pushInstruction("i32.shr_u");
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				setByte(3, () => {
					this.pushInstruction({ op: "i32.const", value: 0x80 });
					this.pushInstruction({ op: "local.get", index: outRTmp });
					this.pushInstruction({ op: "i32.const", value: 0x3f });
					this.pushInstruction("i32.and");
					this.pushInstruction("i32.or");
				});
				this.pushInstruction("end");
				this.pushInstruction("end");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: nextLenTmp });
				this.pushInstruction({ op: "local.set", index: curLenTmp });
				this.pushInstruction("end"); // end if outRTmp >= 0

				// i += runeLenTmp
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: runeLenTmp });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				// return result slice
				this.pushInstruction({ op: "local.get", index: curArrTmp });
				this.pushInstruction({ op: "local.get", index: curOffTmp });
				this.pushInstruction({ op: "local.get", index: curLenTmp });
				this.pushInstruction({ op: "local.get", index: curCapTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(growCapTmp, "i32");
				this.releaseTemp(growOffTmp, "i32");
				this.releaseTemp(growArrTmp, arrW);
				this.releaseTemp(nextLenTmp, "i32");
				this.releaseTemp(outRLenTmp, "i32");
				this.releaseTemp(outRTmp, "i32");
				this.releaseTemp(runeLenTmp, "i32");
				this.releaseTemp(cpTmp, "i32");
				this.releaseTemp(iTmp, "i32");
				this.releaseTemp(curCapTmp, "i32");
				this.releaseTemp(curLenTmp, "i32");
				this.releaseTemp(curOffTmp, "i32");
				this.releaseTemp(curArrTmp, arrW);
				this.releaseTemp(bLen, "i32");
				this.releaseTemp(bOff, "i32");
				this.releaseTemp(bArr, arrW);
				this.releaseTemp(clTmp, closureW);
				return;
			}
		}
	}

	_emitBytesSplit(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		switch (name) {
			case "Split":
			case "SplitN": {
				const isAll = name === "Split";
				const bTmp = this.acquireTemp(sliceW);
				const sepTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: sepTmp });

				const nTmp = this.acquireTemp("i32");
				if (isAll) {
					this.pushInstruction({ op: "i32.const", value: -1 });
					this.pushInstruction({ op: "local.set", index: nTmp });
				} else {
					this._emitI32Arg(args[2]);
					this.pushInstruction({ op: "local.set", index: nTmp });
				}

				this._emitInternalBytesSplit(bTmp, sepTmp, nTmp);

				this.releaseTemp(nTmp, "i32");
				this.releaseTemp(sepTmp, sliceW);
				this.releaseTemp(bTmp, sliceW);
				return;
			}
		}
	}

	_emitBytesFields(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		switch (name) {
			case "Fields": {
				const bTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], sliceW);
				this.pushInstruction({ op: "local.set", index: bTmp });

				this._emitInternalBytesFields(bTmp);

				this.releaseTemp(bTmp, sliceW);
				return;
			}
		}
	}

	_emitBytesJoin(name, args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		switch (name) {
			case "Join": {
				const innerGo = { kind: "slice", elem: byteGo };
				const outerSliceInfo = this.mod.getSliceType(innerGo);
				const outerSliceW = {
					kind: "ref",
					nullable: true,
					typeIndex: outerSliceInfo.typeIndex,
				};
				const sTmp = this.acquireTemp(outerSliceW);
				const sepTmp = this.acquireTemp(sliceW);
				this.emitExpr(args[0], outerSliceW);
				this.pushInstruction({ op: "local.set", index: sTmp });
				this.emitExpr(args[1], sliceW);
				this.pushInstruction({ op: "local.set", index: sepTmp });

				this._emitInternalBytesJoin(sTmp, sepTmp);

				this.releaseTemp(sepTmp, sliceW);
				this.releaseTemp(sTmp, outerSliceW);
				return;
			}
		}
	}

	_emitInternalBytesHasPrefix(sTmp, pTmp) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const sArr = this.acquireTemp(arrW),
			sOff = this.acquireTemp("i32"),
			sLen = this.acquireTemp("i32");
		const pArr = this.acquireTemp(arrW),
			pOff = this.acquireTemp("i32"),
			pLen = this.acquireTemp("i32");
		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: sArr,
			off: sOff,
			len: sLen,
		});
		this._emitSliceUnpack(pTmp, sliceInfo, {
			arr: pArr,
			off: pOff,
			len: pLen,
		});

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "local.get", index: pLen });
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction("else");

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: pLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: sArr });
		this.pushInstruction({ op: "local.get", index: sOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: pArr });
		this.pushInstruction({ op: "local.get", index: pOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(iTmp, "i32");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(pLen, "i32");
		this.releaseTemp(pOff, "i32");
		this.releaseTemp(pArr, arrW);
		this.releaseTemp(sLen, "i32");
		this.releaseTemp(sOff, "i32");
		this.releaseTemp(sArr, arrW);
	}

	_emitInternalBytesHasSuffix(sTmp, pTmp) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const sArr = this.acquireTemp(arrW),
			sOff = this.acquireTemp("i32"),
			sLen = this.acquireTemp("i32");
		const pArr = this.acquireTemp(arrW),
			pOff = this.acquireTemp("i32"),
			pLen = this.acquireTemp("i32");
		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: sArr,
			off: sOff,
			len: sLen,
		});
		this._emitSliceUnpack(pTmp, sliceInfo, {
			arr: pArr,
			off: pOff,
			len: pLen,
		});

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "local.get", index: pLen });
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction("else");

		const offDiffTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction({ op: "local.get", index: pLen });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: offDiffTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: pLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: sArr });
		this.pushInstruction({ op: "local.get", index: sOff });
		this.pushInstruction({ op: "local.get", index: offDiffTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: pArr });
		this.pushInstruction({ op: "local.get", index: pOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(offDiffTmp, "i32");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(pLen, "i32");
		this.releaseTemp(pOff, "i32");
		this.releaseTemp(pArr, arrW);
		this.releaseTemp(sLen, "i32");
		this.releaseTemp(sOff, "i32");
		this.releaseTemp(sArr, arrW);
	}

	_emitInternalBytesIndex(sTmp, sepTmp, last = false) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const sArr = this.acquireTemp(arrW),
			sOff = this.acquireTemp("i32"),
			sLen = this.acquireTemp("i32");
		const sepArr = this.acquireTemp(arrW),
			sepOff = this.acquireTemp("i32"),
			sepLen = this.acquireTemp("i32");
		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: sArr,
			off: sOff,
			len: sLen,
		});
		this._emitSliceUnpack(sepTmp, sliceInfo, {
			arr: sepArr,
			off: sepOff,
			len: sepLen,
		});

		const resTmp = this.acquireTemp("i32");

		// if sepLen == 0
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		if (last) {
			this.pushInstruction({ op: "local.get", index: sLen });
			this.pushInstruction({ op: "local.set", index: resTmp });
		} else {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: resTmp });
		}
		this.pushInstruction("else");

		// default -1
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		const iTmp = this.acquireTemp("i32");
		if (last) {
			this.pushInstruction({ op: "local.get", index: sLen });
			this.pushInstruction({ op: "local.get", index: sepLen });
			this.pushInstruction("i32.sub");
			this.pushInstruction({ op: "local.set", index: iTmp });
		} else {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iTmp });
		}

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		if (last) {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
		} else {
			this.pushInstruction({ op: "local.get", index: sLen });
			this.pushInstruction({ op: "local.get", index: sepLen });
			this.pushInstruction("i32.sub");
			this.pushInstruction("i32.gt_s");
		}
		this.pushInstruction({ op: "br_if", depth: 1 });

		// Match loop
		const matchTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: matchTmp });

		const jTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: sArr });
		this.pushInstruction({ op: "local.get", index: sOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: sepArr });
		this.pushInstruction({ op: "local.get", index: sepOff });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: matchTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(jTmp, "i32");

		this.pushInstruction({ op: "local.get", index: matchTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");
		this.releaseTemp(matchTmp, "i32");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		if (last) this.pushInstruction("i32.sub");
		else this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(iTmp, "i32");
		this.pushInstruction("end"); // end if sepLen <= sLen
		this.pushInstruction("end"); // end else sepLen == 0

		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(sepLen, "i32");
		this.releaseTemp(sepOff, "i32");
		this.releaseTemp(sepArr, arrW);
		this.releaseTemp(sLen, "i32");
		this.releaseTemp(sOff, "i32");
		this.releaseTemp(sArr, arrW);
	}

	_emitInternalBytesReplace(bTmp, oldTmp, newTmp, nTmp) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const bArr = this.acquireTemp(arrW),
			bOff = this.acquireTemp("i32"),
			bLen = this.acquireTemp("i32");
		const oldArr = this.acquireTemp(arrW),
			oldOff = this.acquireTemp("i32"),
			oldLen = this.acquireTemp("i32");
		const newArr = this.acquireTemp(arrW),
			newOff = this.acquireTemp("i32"),
			newLen = this.acquireTemp("i32");
		this._emitSliceUnpack(bTmp, sliceInfo, {
			arr: bArr,
			off: bOff,
			len: bLen,
		});
		this._emitSliceUnpack(oldTmp, sliceInfo, {
			arr: oldArr,
			off: oldOff,
			len: oldLen,
		});
		this._emitSliceUnpack(newTmp, sliceInfo, {
			arr: newArr,
			off: newOff,
			len: newLen,
		});

		// Count occurrences
		const countTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: countTmp });

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "if", blockType: "void" });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// if n >= 0 && count >= n break
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// Check match
		const matchTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: matchTmp });

		const jTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: oldArr });
		this.pushInstruction({ op: "local.get", index: oldOff });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: matchTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(jTmp, "i32");

		this.pushInstruction({ op: "local.get", index: matchTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: countTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction("end");
		this.releaseTemp(matchTmp, "i32");

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(iTmp, "i32");
		this.pushInstruction("end"); // end if oldLen > 0

		// if count == 0 return b
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: sliceW });
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction("else");

		// allocate resArr of size bLen + count * (newLen - oldLen)
		const resLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.mul");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: resLenTmp });

		const resArrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "local.get", index: resLenTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: resArrTmp });

		// copy loop
		const srcPosTmp = this.acquireTemp("i32");
		const dstPosTmp = this.acquireTemp("i32");
		const repCntTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: srcPosTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: dstPosTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: repCntTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "local.get", index: repCntTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// Match check
		const mTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: mTmp });

		const kTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: oldArr });
		this.pushInstruction({ op: "local.get", index: oldOff });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: mTmp });
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

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		// match: copy newArr into resArr
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: dstPosTmp });
		this.pushInstruction({ op: "local.get", index: newArr });
		this.pushInstruction({ op: "local.get", index: newOff });
		this.pushInstruction({ op: "local.get", index: newLen });
		this._emitArrayCopy(arrInfo, byteGo);
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: dstPosTmp });
		this.pushInstruction({ op: "local.get", index: newLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: dstPosTmp });
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction({ op: "local.get", index: oldLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: srcPosTmp });
		this.pushInstruction({ op: "local.get", index: repCntTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: repCntTmp });
		this.pushInstruction("else");
		// no match: copy 1 byte
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: dstPosTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.get", index: dstPosTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: dstPosTmp });
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: srcPosTmp });
		this.pushInstruction("end");
		this.releaseTemp(mTmp, "i32");

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// Copy tail from srcPosTmp to bLen
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: dstPosTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: srcPosTmp });
		this.pushInstruction("i32.sub");
		this._emitArrayCopy(arrInfo, byteGo);
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: resLenTmp });
		this.pushInstruction({ op: "local.get", index: resLenTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(repCntTmp, "i32");
		this.releaseTemp(dstPosTmp, "i32");
		this.releaseTemp(srcPosTmp, "i32");
		this.releaseTemp(resArrTmp, arrW);
		this.releaseTemp(resLenTmp, "i32");
		this.pushInstruction("end"); // end else

		this.releaseTemp(countTmp, "i32");
		this.releaseTemp(newLen, "i32");
		this.releaseTemp(newOff, "i32");
		this.releaseTemp(newArr, arrW);
		this.releaseTemp(oldLen, "i32");
		this.releaseTemp(oldOff, "i32");
		this.releaseTemp(oldArr, arrW);
		this.releaseTemp(bLen, "i32");
		this.releaseTemp(bOff, "i32");
		this.releaseTemp(bArr, arrW);
	}

	_emitInternalBytesSplit(bTmp, sepTmp, nTmp) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const innerGo = { kind: "slice", elem: byteGo };
		const outerSliceInfo = this.mod.getSliceType(innerGo);
		const outerArrInfo = outerSliceInfo.arrInfo;
		const outerArrW = {
			kind: "ref",
			nullable: true,
			typeIndex: outerArrInfo.typeIndex,
		};
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const bArr = this.acquireTemp(arrW),
			bOff = this.acquireTemp("i32"),
			bLen = this.acquireTemp("i32"),
			bCap = this.acquireTemp("i32");
		const sepArr = this.acquireTemp(arrW),
			sepOff = this.acquireTemp("i32"),
			sepLen = this.acquireTemp("i32");
		this._emitSliceUnpack(bTmp, sliceInfo, {
			arr: bArr,
			off: bOff,
			len: bLen,
			cap: bCap,
		});
		this._emitSliceUnpack(sepTmp, sliceInfo, {
			arr: sepArr,
			off: sepOff,
			len: sepLen,
		});

		const outerSliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: outerSliceInfo.typeIndex,
		};

		// if n == 0 return empty
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: outerSliceW });
		this.pushInstruction({
			op: "global.get",
			index: outerSliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction("else");

		// Pass 1: count parts
		const countTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: countTmp });

		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// Match check
		const mTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: mTmp });

		const jTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: sepArr });
		this.pushInstruction({ op: "local.get", index: sepOff });
		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: mTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: jTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: jTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(jTmp, "i32");

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: countTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction("end");
		this.releaseTemp(mTmp, "i32");

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(iTmp, "i32");
		this.pushInstruction("end"); // end if sepLen > 0

		// Allocate outer array of size countTmp
		const outerArrTmp = this.acquireTemp(outerArrW);
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: outerArrTmp });

		// Pass 2: populate outer array
		const partIdxTmp = this.acquireTemp("i32");
		const startPosTmp = this.acquireTemp("i32");
		const kPosTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: partIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: startPosTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: kPosTmp });

		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kPosTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "local.get", index: partIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// Check match
		const m2Tmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: m2Tmp });

		const j2Tmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: j2Tmp });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: j2Tmp });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: kPosTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: j2Tmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: sepArr });
		this.pushInstruction({ op: "local.get", index: sepOff });
		this.pushInstruction({ op: "local.get", index: j2Tmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: m2Tmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: j2Tmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: j2Tmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(j2Tmp, "i32");

		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		// outerArr[partIdx] = struct.new sliceInfo (bArr, bOff + startPos, kPos - startPos, bCap - startPos)
		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "local.get", index: partIdxTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: startPosTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: kPosTmp });
		this.pushInstruction({ op: "local.get", index: startPosTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: bCap });
		this.pushInstruction({ op: "local.get", index: startPosTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: outerArrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: partIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: partIdxTmp });

		this.pushInstruction({ op: "local.get", index: kPosTmp });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.tee", index: startPosTmp });
		this.pushInstruction({ op: "local.set", index: kPosTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: kPosTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kPosTmp });
		this.pushInstruction("end");
		this.releaseTemp(m2Tmp, "i32");

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction("end"); // end if sepLen > 0

		// Final part: outerArr[partIdx] = s[startPos:]
		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "local.get", index: partIdxTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: startPosTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: startPosTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: bCap });
		this.pushInstruction({ op: "local.get", index: startPosTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: outerArrInfo.typeIndex,
		});

		// wrap in outer slice struct
		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: outerSliceInfo.typeIndex,
		});

		this.releaseTemp(kPosTmp, "i32");
		this.releaseTemp(startPosTmp, "i32");
		this.releaseTemp(partIdxTmp, "i32");
		this.releaseTemp(outerArrTmp, outerArrW);
		this.releaseTemp(countTmp, "i32");

		this.pushInstruction("end"); // end else n == 0

		this.releaseTemp(sepLen, "i32");
		this.releaseTemp(sepOff, "i32");
		this.releaseTemp(sepArr, arrW);
		this.releaseTemp(bCap, "i32");
		this.releaseTemp(bLen, "i32");
		this.releaseTemp(bOff, "i32");
		this.releaseTemp(bArr, arrW);
	}

	_emitInternalBytesFields(bTmp) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const innerGo = { kind: "slice", elem: byteGo };
		const outerSliceInfo = this.mod.getSliceType(innerGo);
		const outerArrInfo = outerSliceInfo.arrInfo;
		const outerArrW = {
			kind: "ref",
			nullable: true,
			typeIndex: outerArrInfo.typeIndex,
		};
		const outerSliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: outerSliceInfo.typeIndex,
		};
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const bArr = this.acquireTemp(arrW),
			bOff = this.acquireTemp("i32"),
			bLen = this.acquireTemp("i32"),
			bCap = this.acquireTemp("i32");
		this._emitSliceUnpack(bTmp, sliceInfo, {
			arr: bArr,
			off: bOff,
			len: bLen,
			cap: bCap,
		});

		// Pass 1: count words
		const wordCntTmp = this.acquireTemp("i32");
		const inWordTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		const cTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: cTmp });

		// isSp: c == 32 || (c >= 9 && c <= 13)
		const isSpTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: cTmp });
		this.pushInstruction({ op: "i32.const", value: 32 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "local.get", index: cTmp });
		this.pushInstruction({ op: "i32.const", value: 9 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.le_u");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: isSpTmp });

		this.pushInstruction({ op: "local.get", index: isSpTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(isSpTmp, "i32");
		this.releaseTemp(cTmp, "i32");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(iTmp, "i32");

		// if wordCnt == 0 return empty
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: outerSliceW });
		this.pushInstruction({
			op: "global.get",
			index: outerSliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction("else");

		// Allocate outer array
		const outerArrTmp = this.acquireTemp(outerArrW);
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: outerArrTmp });

		// Pass 2: store words
		const wIdxTmp = this.acquireTemp("i32");
		const startTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: startTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });

		const kTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: kTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		const c2Tmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: c2Tmp });

		const isSp2Tmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: c2Tmp });
		this.pushInstruction({ op: "i32.const", value: 32 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "local.get", index: c2Tmp });
		this.pushInstruction({ op: "i32.const", value: 9 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.le_u");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.set", index: isSp2Tmp });

		this.pushInstruction({ op: "local.get", index: isSp2Tmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		// store word: b[start:k]
		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: bCap });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("end");
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.set", index: startTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(isSp2Tmp, "i32");
		this.releaseTemp(c2Tmp, "i32");

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(kTmp, "i32");

		// Tail word if inWord
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: bCap });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: outerSliceInfo.typeIndex,
		});

		this.releaseTemp(startTmp, "i32");
		this.releaseTemp(wIdxTmp, "i32");
		this.releaseTemp(outerArrTmp, outerArrW);
		this.pushInstruction("end"); // end else

		this.releaseTemp(inWordTmp, "i32");
		this.releaseTemp(wordCntTmp, "i32");
		this.releaseTemp(bCap, "i32");
		this.releaseTemp(bLen, "i32");
		this.releaseTemp(bOff, "i32");
		this.releaseTemp(bArr, arrW);
	}

	_emitBytesFieldsFunc(args, _targetWasmType) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const innerGo = { kind: "slice", elem: byteGo };
		const outerSliceInfo = this.mod.getSliceType(innerGo);
		const outerArrInfo = outerSliceInfo.arrInfo;
		const outerArrW = {
			kind: "ref",
			nullable: true,
			typeIndex: outerArrInfo.typeIndex,
		};
		const outerSliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: outerSliceInfo.typeIndex,
		};
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const closureInfo = this.mod.getClosureType(
			this._resolveExprGoType(args[1]),
		);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};

		const bTmp = this.acquireTemp(sliceW);
		const clTmp = this.acquireTemp(closureW);
		this.emitExpr(args[0], sliceW);
		this.pushInstruction({ op: "local.set", index: bTmp });
		this.emitExpr(args[1], closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		const bArr = this.acquireTemp(arrW),
			bOff = this.acquireTemp("i32"),
			bLen = this.acquireTemp("i32"),
			bCap = this.acquireTemp("i32");
		this._emitSliceUnpack(bTmp, sliceInfo, {
			arr: bArr,
			off: bOff,
			len: bLen,
			cap: bCap,
		});
		this.releaseTemp(bTmp, sliceW);

		// Pass 1: count words
		const wordCntTmp = this.acquireTemp("i32");
		const inWordTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });

		const iTmp = this.acquireTemp("i32");
		const cpTmp = this.acquireTemp("i32");
		const runeLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this._emitDecodeUtf8Rune({
			arrTmp: bArr,
			offTmp: bOff,
			idxTmp: iTmp,
			lenTmp: bLen,
			outRuneTmp: cpTmp,
			outLenTmp: runeLenTmp,
			arrTypeIndex: arrInfo.typeIndex,
		});

		// Call f(cp)
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

		// Stack has boolean i32 (1 if delimiter, 0 if not)
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wordCntTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: runeLenTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(runeLenTmp, "i32");
		this.releaseTemp(cpTmp, "i32");
		this.releaseTemp(iTmp, "i32");

		// If wordCnt == 0 return empty
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: outerSliceW });
		this.pushInstruction({
			op: "global.get",
			index: outerSliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction("else");

		// Allocate outer array
		const outerArrTmp = this.acquireTemp(outerArrW);
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: outerArrTmp });

		// Pass 2: store words
		const wIdxTmp = this.acquireTemp("i32");
		const startTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: startTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });

		const kTmp = this.acquireTemp("i32");
		const cp2Tmp = this.acquireTemp("i32");
		const runeLen2Tmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: kTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this._emitDecodeUtf8Rune({
			arrTmp: bArr,
			offTmp: bOff,
			idxTmp: kTmp,
			lenTmp: bLen,
			outRuneTmp: cp2Tmp,
			outLenTmp: runeLen2Tmp,
			arrTypeIndex: arrInfo.typeIndex,
		});

		// Call f(cp2)
		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: cp2Tmp });
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

		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		// store word: b[start:k]
		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: bCap });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wIdxTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("end");
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.set", index: startTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: inWordTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: runeLen2Tmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(runeLen2Tmp, "i32");
		this.releaseTemp(cp2Tmp, "i32");
		this.releaseTemp(kTmp, "i32");

		// If still inWord at end, store last word: b[start:bLen]
		this.pushInstruction({ op: "local.get", index: inWordTmp });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "local.get", index: wIdxTmp });
		this.pushInstruction({ op: "local.get", index: bArr });
		this.pushInstruction({ op: "local.get", index: bOff });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: bLen });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: bCap });
		this.pushInstruction({ op: "local.get", index: startTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: outerArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({ op: "local.get", index: wordCntTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: outerSliceInfo.typeIndex,
		});

		this.releaseTemp(startTmp, "i32");
		this.releaseTemp(wIdxTmp, "i32");
		this.releaseTemp(outerArrTmp, outerArrW);
		this.pushInstruction("end"); // end else

		this.releaseTemp(inWordTmp, "i32");
		this.releaseTemp(wordCntTmp, "i32");
		this.releaseTemp(bCap, "i32");
		this.releaseTemp(bLen, "i32");
		this.releaseTemp(bOff, "i32");
		this.releaseTemp(bArr, arrW);
		this.releaseTemp(clTmp, closureW);
	}

	_emitInternalBytesJoin(sTmp, sepTmp) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const innerGo = { kind: "slice", elem: byteGo };
		const outerSliceInfo = this.mod.getSliceType(innerGo);
		const outerArrInfo = outerSliceInfo.arrInfo;
		const outerArrW = {
			kind: "ref",
			nullable: true,
			typeIndex: outerArrInfo.typeIndex,
		};
		const arrInfo = sliceInfo.arrInfo;
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const sArr = this.acquireTemp(outerArrW),
			sOff = this.acquireTemp("i32"),
			sLen = this.acquireTemp("i32");
		const sepArr = this.acquireTemp(arrW),
			sepOff = this.acquireTemp("i32"),
			sepLen = this.acquireTemp("i32");
		this._emitSliceUnpack(sTmp, outerSliceInfo, {
			arr: sArr,
			off: sOff,
			len: sLen,
		});
		this._emitSliceUnpack(sepTmp, sliceInfo, {
			arr: sepArr,
			off: sepOff,
			len: sepLen,
		});

		// if sLen == 0 return empty
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: sliceW });
		this.pushInstruction({
			op: "global.get",
			index: sliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction("else");

		// Pass 1: compute total length
		const totLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: totLenTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		const elemSliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: sArr });
		this.pushInstruction({ op: "local.get", index: sOff });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({
			op: "array.get",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: elemSliceTmp });

		this.pushInstruction({ op: "local.get", index: elemSliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: totLenTmp });
		this.pushInstruction({ op: "local.get", index: elemSliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: totLenTmp });
		this.pushInstruction("end");
		this.releaseTemp(elemSliceTmp, sliceW);

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(iTmp, "i32");

		// add (sLen - 1) * sepLen
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: totLenTmp });
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.mul");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: totLenTmp });
		this.pushInstruction("end");

		// allocate resArr
		const resArrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "local.get", index: totLenTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: resArrTmp });

		// Pass 2: copy parts
		const currPosTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: currPosTmp });

		const kTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: kTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "local.get", index: sLen });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// if k > 0 && sepLen > 0 copy sep
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: currPosTmp });
		this.pushInstruction({ op: "local.get", index: sepArr });
		this.pushInstruction({ op: "local.get", index: sepOff });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this._emitArrayCopy(arrInfo, byteGo);
		this.pushInstruction({ op: "local.get", index: currPosTmp });
		this.pushInstruction({ op: "local.get", index: sepLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: currPosTmp });
		this.pushInstruction("end");

		// copy s[k]
		const partSliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: sArr });
		this.pushInstruction({ op: "local.get", index: sOff });
		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({
			op: "array.get",
			typeIndex: outerArrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: partSliceTmp });

		this.pushInstruction({ op: "local.get", index: partSliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		const partArr = this.acquireTemp(arrW),
			partOff = this.acquireTemp("i32"),
			partLen = this.acquireTemp("i32");
		this._emitSliceUnpack(partSliceTmp, sliceInfo, {
			arr: partArr,
			off: partOff,
			len: partLen,
		});

		this.pushInstruction({ op: "local.get", index: partLen });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "local.get", index: currPosTmp });
		this.pushInstruction({ op: "local.get", index: partArr });
		this.pushInstruction({ op: "local.get", index: partOff });
		this.pushInstruction({ op: "local.get", index: partLen });
		this._emitArrayCopy(arrInfo, byteGo);
		this.pushInstruction({ op: "local.get", index: currPosTmp });
		this.pushInstruction({ op: "local.get", index: partLen });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: currPosTmp });
		this.pushInstruction("end");

		this.releaseTemp(partLen, "i32");
		this.releaseTemp(partOff, "i32");
		this.releaseTemp(partArr, arrW);
		this.pushInstruction("end"); // end else null
		this.releaseTemp(partSliceTmp, sliceW);

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(kTmp, "i32");
		this.releaseTemp(currPosTmp, "i32");

		this.pushInstruction({ op: "local.get", index: resArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: totLenTmp });
		this.pushInstruction({ op: "local.get", index: totLenTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(resArrTmp, arrW);
		this.releaseTemp(totLenTmp, "i32");
		this.pushInstruction("end"); // end else sLen == 0

		this.releaseTemp(sepLen, "i32");
		this.releaseTemp(sepOff, "i32");
		this.releaseTemp(sepArr, arrW);
		this.releaseTemp(sLen, "i32");
		this.releaseTemp(sOff, "i32");
		this.releaseTemp(sArr, outerArrW);
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
}
