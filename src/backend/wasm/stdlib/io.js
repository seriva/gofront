// src/backend/wasm/stdlib/io.js
// FunctionEmitter mixin: io, readers/writers, fmt.Fprint*, fmt.Sscan*.

import { toWasmType } from "../types.js";

export class IoEmitter {
	_isIoConst(expr) {
		return (
			expr.expr?.kind === "Ident" &&
			expr.expr.name === "io" &&
			!this.resolveLocal("io") &&
			!this.mod.resolveGlobal("io") &&
			(expr.field === "EOF" || expr.field === "Discard")
		);
	}

	emitIoConst(field, _targetWasmType) {
		if (field === "EOF") {
			const gIdx = this.mod.getIoErrGlobalIndex("EOF");
			this.pushInstruction({ op: "global.get", index: gIdx });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			const strIdx = this.mod.internString("EOF");
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
			return;
		}
		if (field === "Discard") {
			const gIdx = this.mod.getIoDiscardGlobalIndex();
			const discardInfo = this.mod.getStructType("io.discard");
			this.pushInstruction({ op: "global.get", index: gIdx });
			this.pushInstruction("ref.is_null");
			this.pushInstruction({ op: "if", blockType: "void" });
			if (discardInfo) {
				this.pushInstruction({
					op: "struct.new",
					typeIndex: discardInfo.typeIndex,
				});
			} else {
				this.pushInstruction({ op: "ref.null", heapType: "any" });
			}
			this.pushInstruction({ op: "global.set", index: gIdx });
			this.pushInstruction("end");
			this.pushInstruction({ op: "global.get", index: gIdx });
			return;
		}
		throw new Error(`Unsupported io constant: ${field}`);
	}

	emitIoCall(name, call, targetWasmType) {
		if (name === "WriteString") {
			this._emitIoWriteString(call, targetWasmType);
			return;
		}
		if (name === "ReadAll") {
			this._emitIoReadAll(call, targetWasmType);
			return;
		}
		throw new Error(`Unsupported io call: ${name}`);
	}

	_emitIoWriteString(call, _targetWasmType) {
		const wExpr = call.args[0];
		const strExpr = call.args[1];
		const strTmp = this.acquireTemp("externref");
		this.emitExpr(strExpr, "externref");
		this.pushInstruction({ op: "local.set", index: strTmp });
		this._emitWriterWrite(wExpr, strTmp);
		this.releaseTemp(strTmp, "externref");
	}

	_emitWriterWrite(wExpr, strTmp) {
		const wTmp = this.acquireTemp("anyref");
		this.emitExpr(wExpr, "anyref");
		this.pushInstruction({ op: "local.set", index: wTmp });

		this.pushInstruction({ op: "local.get", index: wTmp });
		this.pushInstruction({ op: "local.get", index: strTmp });
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });

		const dispatchIdx = this.mod.resolveFuncIndex("__dispatch_io.Writer_Write");
		if (dispatchIdx !== null) {
			this.pushInstruction({ op: "call", funcIndex: dispatchIdx });
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
		this.releaseTemp(wTmp, "anyref");
	}

	_emitIoReadAll(call, _targetWasmType) {
		const rExpr = call.args[0];
		const rTmp = this.acquireTemp("anyref");
		this.emitExpr(rExpr, "anyref");
		this.pushInstruction({ op: "local.set", index: rTmp });

		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		// chunks slice (len: 0, cap: 512)
		const chunksTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "i32.const", value: 512 });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: 512 });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: chunksTmp });

		// buf slice (len: 512, cap: 512)
		const bufTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "i32.const", value: 512 });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: 512 });
		this.pushInstruction({ op: "i32.const", value: 512 });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bufTmp });

		const errTmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: errTmp });

		const dispatchIdx = this.mod.resolveFuncIndex("__dispatch_io.Reader_Read");

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: bufTmp });
		if (dispatchIdx !== null) {
			this.pushInstruction({ op: "call", funcIndex: dispatchIdx });
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}

		// (n: i64, e: anyref)
		this.pushInstruction({ op: "local.set", index: errTmp });
		const nTmp = this.acquireTemp("i32");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: nTmp });

		// if n > 0, append buf[0:n] to chunks
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this._emitAppendSliceBytes(chunksTmp, bufTmp, nTmp, sliceInfo, arrW);
		this.pushInstruction("end");
		this.releaseTemp(nTmp, "i32");

		// if err != nil: if errors.Is(err, io.EOF) err = nil; break loop
		this.pushInstruction({ op: "local.get", index: errTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: errTmp });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__errors_is"),
		});
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: errTmp });
		this.pushInstruction("end");
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: chunksTmp });
		this.pushInstruction({ op: "local.get", index: errTmp });

		this.releaseTemp(errTmp, "anyref");
		this.releaseTemp(bufTmp, sliceW);
		this.releaseTemp(chunksTmp, sliceW);
		this.releaseTemp(rTmp, "anyref");
	}

	_emitAppendSliceBytes(dstSliceTmp, srcSliceTmp, countTmp, sliceInfo, arrW) {
		const arrInfo = sliceInfo.arrInfo;
		const byteGo = { kind: "basic", name: "byte" };

		const oldArrTmp = this.acquireTemp(arrW);
		const oldOffTmp = this.acquireTemp("i32");
		const oldLenTmp = this.acquireTemp("i32");
		const oldCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(dstSliceTmp, sliceInfo, {
			arr: oldArrTmp,
			off: oldOffTmp,
			len: oldLenTmp,
			cap: oldCapTmp,
		});

		const newLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: oldLenTmp });
		this.pushInstruction({ op: "local.get", index: countTmp });
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

		const srcArrTmp = this.acquireTemp(arrW);
		const srcOffTmp = this.acquireTemp("i32");
		const srcLenTmp = this.acquireTemp("i32");
		const srcCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(srcSliceTmp, sliceInfo, {
			arr: srcArrTmp,
			off: srcOffTmp,
			len: srcLenTmp,
			cap: srcCapTmp,
		});
		this.releaseTemp(srcCapTmp, "i32");
		this.releaseTemp(srcLenTmp, "i32");

		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: oldLenTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: countTmp });
		this._emitArrayCopy(arrInfo, byteGo);

		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(srcArrTmp, arrW);

		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: newLenTmp });
		this.pushInstruction({ op: "local.get", index: newCapTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: dstSliceTmp });

		this.releaseTemp(newCapTmp, "i32");
		this.releaseTemp(newOffTmp, "i32");
		this.releaseTemp(newArrTmp, arrW);
		this.releaseTemp(newLenTmp, "i32");
		this.releaseTemp(oldCapTmp, "i32");
		this.releaseTemp(oldLenTmp, "i32");
		this.releaseTemp(oldOffTmp, "i32");
		this.releaseTemp(oldArrTmp, arrW);
	}

	emitStringsNewReader(call, _targetWasmType) {
		const structInfo = this.mod.getStructType("strings.Reader");
		this.emitExpr(call.args[0], "externref");
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: structInfo.typeIndex,
		});
	}

	emitBytesNewReader(call, _targetWasmType) {
		const structInfo = this.mod.getStructType("bytes.Reader");
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		this.emitExpr(call.args[0], sliceW);
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: structInfo.typeIndex,
		});
	}

	emitStringsReaderMethodCall(method, expr, args, targetWasmType) {
		if (method === "Read") {
			this._emitStringsReaderRead(expr, args);
			return;
		}
		if (method === "Len") {
			this._emitStringsReaderLen(expr, targetWasmType);
			return;
		}
		if (method === "Reset") {
			this._emitStringsReaderReset(expr, args);
			return;
		}
		throw new Error(`Unsupported strings.Reader method: ${method}`);
	}

	_emitStringsReaderRead(expr, args) {
		const structInfo = this.mod.getStructType("strings.Reader");
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const pTmp = this.acquireTemp(sliceW);
		this.emitExpr(args[0], sliceW);
		this.pushInstruction({ op: "local.set", index: pTmp });

		this._emitStringsReaderReadCore(rTmp, pTmp);
		this.releaseTemp(pTmp, sliceW);
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderReadCore(typeName, rTmp, pTmp) {
		const structInfo = this.mod.getStructType(typeName);
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};

		const pArrTmp = this.acquireTemp(arrW);
		const pOffTmp = this.acquireTemp("i32");
		const pLenTmp = this.acquireTemp("i32");
		const pCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(pTmp, sliceInfo, {
			arr: pArrTmp,
			off: pOffTmp,
			len: pLenTmp,
			cap: pCapTmp,
		});
		this.releaseTemp(pCapTmp, "i32");

		const resNTmp = this.acquireTemp("i64");
		const resErrTmp = this.acquireTemp("anyref");

		// if p.len == 0: (0, nil)
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		const srcSliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const srcSliceTmp = this.acquireTemp(srcSliceW);
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: srcSliceTmp });

		const srcArrTmp = this.acquireTemp(arrW);
		const srcOffTmp = this.acquireTemp("i32");
		const srcLenTmp = this.acquireTemp("i32");
		const srcCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(srcSliceTmp, sliceInfo, {
			arr: srcArrTmp,
			off: srcOffTmp,
			len: srcLenTmp,
			cap: srcCapTmp,
		});
		this.releaseTemp(srcCapTmp, "i32");
		this.releaseTemp(srcSliceTmp, srcSliceW);

		const posTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: posTmp });

		// if pos >= srcLen: (0, io.EOF)
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.ge_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		// avail = srcLen - pos
		const availTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: availTmp });

		// n = min(p.len, avail)
		const nTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction({ op: "local.get", index: availTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: availTmp });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: nTmp });

		// copy bytes: p.arr[p.off] = src.arr[src.off + pos]
		this.pushInstruction({ op: "local.get", index: pArrTmp });
		this.pushInstruction({ op: "local.get", index: pOffTmp });
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: nTmp });
		this._emitArrayCopy(sliceInfo.arrInfo, byteElemGo);

		// r._pos += n
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.releaseTemp(nTmp, "i32");
		this.releaseTemp(availTmp, "i32");
		this.pushInstruction("end");
		this.releaseTemp(posTmp, "i64");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(srcArrTmp, arrW);
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resNTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(resNTmp, "i64");
		this.releaseTemp(pLenTmp, "i32");
		this.releaseTemp(pOffTmp, "i32");
		this.releaseTemp(pArrTmp, arrW);
	}

	_emitReaderLenCore(typeName, rTmp, targetWasmType) {
		const structInfo = this.mod.getStructType(typeName);
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction("i64.sub");
		const resTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "local.get", index: resTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: resTmp });
		this.pushInstruction("end");
		if ((targetWasmType ?? "i64") === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
		this.releaseTemp(resTmp, "i64");
	}

	_emitStringsReaderReadCore(rTmp, pTmp) {
		this._emitReaderReadCore("strings.Reader", rTmp, pTmp);
	}

	_emitStringsReaderLen(expr, targetWasmType) {
		const structInfo = this.mod.getStructType("strings.Reader");
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		this._emitStringsReaderLenCore(rTmp, targetWasmType);
		this.releaseTemp(rTmp, readerW);
	}

	_emitStringsReaderLenCore(rTmp, targetWasmType) {
		this._emitReaderLenCore("strings.Reader", rTmp, targetWasmType);
	}

	_emitStringsReaderReset(expr, args) {
		const structInfo = this.mod.getStructType("strings.Reader");
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const sTmp = this.acquireTemp("externref");
		this.emitExpr(args[0], "externref");
		this.pushInstruction({ op: "local.set", index: sTmp });

		this._emitStringsReaderResetCore(rTmp, sTmp);
		this.releaseTemp(sTmp, "externref");
		this.releaseTemp(rTmp, readerW);
	}

	_emitStringsReaderResetCore(rTmp, sTmp) {
		const structInfo = this.mod.getStructType("strings.Reader");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
	}

	emitBytesReaderMethodCall(method, expr, args, targetWasmType) {
		if (method === "Read") {
			this._emitBytesReaderRead(expr, args);
			return;
		}
		if (method === "Len") {
			this._emitBytesReaderLen(expr, targetWasmType);
			return;
		}
		if (method === "Reset") {
			this._emitBytesReaderReset(expr, args);
			return;
		}
		throw new Error(`Unsupported bytes.Reader method: ${method}`);
	}

	_emitBytesReaderRead(expr, args) {
		const structInfo = this.mod.getStructType("bytes.Reader");
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const pTmp = this.acquireTemp(sliceW);
		this.emitExpr(args[0], sliceW);
		this.pushInstruction({ op: "local.set", index: pTmp });

		this._emitBytesReaderReadCore(rTmp, pTmp);
		this.releaseTemp(pTmp, sliceW);
		this.releaseTemp(rTmp, readerW);
	}

	_emitBytesReaderReadCore(rTmp, pTmp) {
		this._emitReaderReadCore("bytes.Reader", rTmp, pTmp);
	}

	_emitBytesReaderLen(expr, targetWasmType) {
		const structInfo = this.mod.getStructType("bytes.Reader");
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		this._emitBytesReaderLenCore(rTmp, targetWasmType);
		this.releaseTemp(rTmp, readerW);
	}

	_emitBytesReaderLenCore(rTmp, targetWasmType) {
		this._emitReaderLenCore("bytes.Reader", rTmp, targetWasmType);
	}

	_emitBytesReaderReset(expr, args) {
		const structInfo = this.mod.getStructType("bytes.Reader");
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const bTmp = this.acquireTemp(sliceW);
		this.emitExpr(args[0], sliceW);
		this.pushInstruction({ op: "local.set", index: bTmp });

		this._emitBytesReaderResetCore(rTmp, bTmp);
		this.releaseTemp(bTmp, sliceW);
		this.releaseTemp(rTmp, readerW);
	}

	_emitBytesReaderResetCore(rTmp, bTmp) {
		const structInfo = this.mod.getStructType("bytes.Reader");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
	}

	emitFprintCall(fn, call, _targetWasmType) {
		const wExpr = call.args[0];
		const strTmp = this.acquireTemp("externref");
		this._emitFprintFormatString(fn, call.args.slice(1));
		this.pushInstruction({ op: "local.set", index: strTmp });

		const wType = wExpr._type;
		const targetName =
			wType?.name ?? (wType?.kind === "pointer" ? wType.base?.name : null);
		if (targetName === "strings.Builder") {
			// Builder.WriteString
			const builderInfo = this.mod.getStructType("strings.Builder");
			const builderW = {
				kind: "ref",
				nullable: true,
				typeIndex: builderInfo.typeIndex,
			};
			const bTmp = this.acquireTemp(builderW);
			this.emitExpr(wExpr, builderW);
			this.pushInstruction({ op: "local.set", index: bTmp });
			this._emitBuilderWriteStringCore(bTmp, strTmp);
			this.releaseTemp(bTmp, builderW);
			this.releaseTemp(strTmp, "externref");
			return;
		}
		if (targetName === "bytes.Buffer") {
			const bufInfo = this.mod.getStructType("bytes.Buffer");
			const bufW = {
				kind: "ref",
				nullable: true,
				typeIndex: bufInfo.typeIndex,
			};
			const bTmp = this.acquireTemp(bufW);
			this.emitExpr(wExpr, bufW);
			this.pushInstruction({ op: "local.set", index: bTmp });
			this._emitBufferWriteStringCore(bTmp, strTmp);
			this.releaseTemp(bTmp, bufW);
			this.releaseTemp(strTmp, "externref");
			return;
		}

		this._emitWriterWrite(wExpr, strTmp);
		this.releaseTemp(strTmp, "externref");
	}

	_emitFprintFormatString(fn, restArgs) {
		if (fn === "Fprintf") {
			const [format, ...rest] = restArgs;
			const temps = this._emitArgBuffer(rest);
			this.emitExpr(format, "externref");
			this._callStdlib("fmt_sprintf");
			this._releaseArgBuffer(temps);
			return;
		}
		const argc = restArgs.length;
		if (argc === 0) {
			const s = fn === "Fprintln" ? "\n" : "";
			const strIdx = this.mod.internString(s);
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			return;
		}
		const sep = fn === "Fprintln" ? " " : "";
		const suffix = fn === "Fprintln" ? "\n" : "";
		const fmt = Array(argc).fill("%v").join(sep) + suffix;
		const temps = this._emitArgBuffer(restArgs);
		const strIdx = this.mod.internString(fmt);
		this.pushInstruction({ op: "i32.const", value: strIdx });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this._callStdlib("fmt_sprintf");
		this._releaseArgBuffer(temps);
	}

	emitSscanCall(fn, call, _targetWasmType) {
		const strArg = call.args[0];
		const mode = fn === "Sscanln" ? 1 : 0;
		const ptrs = fn === "Sscanf" ? call.args.slice(2) : call.args.slice(1);

		if (fn === "Sscanf") {
			this.emitExpr(strArg, "externref");
			this.emitExpr(call.args[1], "externref");
			this._callStdlib("fmt_sscanf_init");
		} else {
			this.emitExpr(strArg, "externref");
			this.pushInstruction({ op: "i32.const", value: mode });
			this._callStdlib("fmt_sscan_init");
		}
		const totTokensTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.set", index: totTokensTmp });

		const nTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: nTmp });

		for (let i = 0; i < ptrs.length; i++) {
			this._emitSscanAssignOne(ptrs[i], i, totTokensTmp, nTmp);
		}

		// return (n: i64, err: anyref)
		this.pushInstruction({ op: "local.get", index: nTmp });

		this._callStdlib("fmt_sscan_has_err");
		this.pushInstruction({ op: "if", blockType: "anyref" });
		this._callStdlib("fmt_sscan_err_msg");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i64.const", value: BigInt(ptrs.length) });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "anyref" });
		const strIdx = this.mod.internString("unexpected EOF");
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
		this.pushInstruction("else");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(nTmp, "i64");
		this.releaseTemp(totTokensTmp, "i32");
	}

	_emitSscanAssignOne(pExpr, tokenIdx, totTokensTmp, nTmp) {
		this.pushInstruction({ op: "i32.const", value: tokenIdx });
		this.pushInstruction({ op: "local.get", index: totTokensTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		this._callStdlib("fmt_sscan_has_err");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");

		this._emitSscanWriteToken(pExpr, tokenIdx);

		this._callStdlib("fmt_sscan_has_err");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i64.const", value: 1n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: nTmp });
		this.pushInstruction("end");

		this.pushInstruction("end");
		this.pushInstruction("end");
	}

	_emitSscanWriteToken(pExpr, tokenIdx) {
		const pointeeType = pExpr._type?.base ?? pExpr._type;
		const wType = toWasmType(pointeeType, this.mod.checker, this.mod);

		// If &Ident: directly write to variable
		if (
			pExpr.kind === "UnaryExpr" &&
			pExpr.op === "&" &&
			pExpr.operand?.kind === "Ident"
		) {
			const loc = this.resolveLocal(pExpr.operand.name);
			if (loc) {
				if (loc.isBoxed) {
					this.pushInstruction({ op: "local.get", index: loc.index });
					this._emitSscanTokenValue(wType, pointeeType, tokenIdx);
					this.pushInstruction({
						op: "struct.set",
						typeIndex: loc.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this._emitSscanTokenValue(wType, pointeeType, tokenIdx);
					this.pushInstruction({ op: "local.set", index: loc.index });
				}
				return;
			}
		}

		// Otherwise write to box
		const box = this.mod.getBoxType(pointeeType);
		const baseWType = {
			kind: "ref",
			nullable: true,
			typeIndex: box.typeIndex,
		};
		const boxTmp = this.acquireTemp(baseWType);
		this.emitExpr(pExpr, baseWType);
		this.pushInstruction({ op: "local.set", index: boxTmp });

		this.pushInstruction({ op: "local.get", index: boxTmp });
		this._emitSscanTokenValue(wType, pointeeType, tokenIdx);
		this.pushInstruction({
			op: "struct.set",
			typeIndex: box.typeIndex,
			fieldIndex: 0,
		});
		this.releaseTemp(boxTmp, baseWType);
	}

	_emitSscanTokenValue(wType, pointeeType, tokenIdx) {
		this.pushInstruction({ op: "i32.const", value: tokenIdx });
		if (wType === "i64") {
			this._callStdlib("fmt_sscan_token_i64");
			return;
		}
		if (wType === "i32") {
			if (pointeeType?.name === "bool") {
				this._callStdlib("fmt_sscan_token_bool");
			} else {
				this._callStdlib("fmt_sscan_token_i64");
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}
		if (wType === "f64") {
			this._callStdlib("fmt_sscan_token_f64");
			return;
		}
		if (wType === "f32") {
			this._callStdlib("fmt_sscan_token_f64");
			this.pushInstruction("f32.demote_f64");
			return;
		}
		if (wType === "externref") {
			this._callStdlib("fmt_sscan_token_str");
			return;
		}
		this._callStdlib("fmt_sscan_token_str");
	}

	emitIoHelper(fn) {
		const kind = fn._isIoHelper ?? fn._isPhase7Helper;
		switch (kind) {
			case "builder_write":
				this._emitHelperBuilderWrite(fn);
				return;
			case "builder_write_string":
				this._emitHelperBuilderWriteString(fn);
				return;
			case "buffer_write":
				this._emitHelperBufferWrite(fn);
				return;
			case "buffer_write_string":
				this._emitHelperBufferWriteString(fn);
				return;
			case "strings_reader_read":
				this._emitHelperStringsReaderRead(fn);
				return;
			case "strings_reader_len":
				this._emitHelperStringsReaderLen(fn);
				return;
			case "strings_reader_reset":
				this._emitHelperStringsReaderReset(fn);
				return;
			case "bytes_reader_read":
				this._emitHelperBytesReaderRead(fn);
				return;
			case "bytes_reader_len":
				this._emitHelperBytesReaderLen(fn);
				return;
			case "bytes_reader_reset":
				this._emitHelperBytesReaderReset(fn);
				return;
			case "discard_write":
				this._emitHelperDiscardWrite(fn);
				return;
			case "discard_write_string":
				this._emitHelperDiscardWriteString(fn);
				return;
			default:
				throw new Error(`Unknown io helper: ${kind}`);
		}
	}

	emitPhase7Helper(fn) {
		return this.emitIoHelper(fn);
	}

	_emitHelperBuilderWrite(_fn) {
		this._emitBuilderWriteCore(0, 1);
		this.pushInstruction("return");
	}

	_emitHelperBuilderWriteString(_fn) {
		this._emitBuilderWriteStringCore(0, 1);
		this.pushInstruction("return");
	}

	_emitBuilderWriteCore(bTmp, pTmp) {
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};

		const pArrTmp = this.acquireTemp(arrW);
		const pOffTmp = this.acquireTemp("i32");
		const pLenTmp = this.acquireTemp("i32");
		const pCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(pTmp, sliceInfo, {
			arr: pArrTmp,
			off: pOffTmp,
			len: pLenTmp,
			cap: pCapTmp,
		});
		this.releaseTemp(pCapTmp, "i32");

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
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});
		this._callStdlib("bytes_to_str_push");

		this.pushInstruction({ op: "local.get", index: kTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: kTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this._callStdlib("bytes_to_str_finish");
		const strTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.set", index: strTmp });

		this._emitBuilderWriteStringCore(bTmp, strTmp);
		this.releaseTemp(strTmp, "externref");
		this.releaseTemp(kTmp, "i32");
		this.releaseTemp(pLenTmp, "i32");
		this.releaseTemp(pOffTmp, "i32");
		this.releaseTemp(pArrTmp, arrW);
	}

	_emitBuilderWriteStringCore(bTmp, strTmp) {
		const structInfo = this.mod.getStructType("strings.Builder");
		const strGo = { kind: "basic", name: "string" };
		const sliceInfo = this.mod.getSliceType(strGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const lenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: strTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

		// copy check
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
		this.emitPanic("strings: illegal use of non-zero Builder copied by value");
		this.pushInstruction("end");
		this.pushInstruction("end");

		// append string to b._buf
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
		this.pushInstruction({ op: "local.get", index: strTmp });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

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

		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});

		// return (len, nil)
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "ref.null", heapType: "any" });

		this.releaseTemp(newLenTmp, "i32");
		this.releaseTemp(newCapTmp, "i32");
		this.releaseTemp(newOffTmp, "i32");
		this.releaseTemp(newArrTmp, arrW);
		this.releaseTemp(oldCapTmp, "i32");
		this.releaseTemp(oldLenTmp, "i32");
		this.releaseTemp(oldOffTmp, "i32");
		this.releaseTemp(oldArrTmp, arrW);
		this.releaseTemp(lenTmp, "i32");
	}

	_emitHelperBufferWrite(_fn) {
		this._emitBufferWriteCore(0, 1);
		this.pushInstruction("return");
	}

	_emitHelperBufferWriteString(_fn) {
		this._emitBufferWriteStringCore(0, 1);
		this.pushInstruction("return");
	}

	_emitBufferWriteCore(bTmp, pTmp) {
		const structInfo = this.mod.getStructType("bytes.Buffer");
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};

		const bufSliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: bufSliceTmp });
		this.pushInstruction({ op: "local.get", index: bufSliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "global.get",
			index: sliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction({ op: "local.set", index: bufSliceTmp });
		this.pushInstruction("end");

		const pArrTmp = this.acquireTemp(arrW);
		const pOffTmp = this.acquireTemp("i32");
		const pLenTmp = this.acquireTemp("i32");
		const pCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(pTmp, sliceInfo, {
			arr: pArrTmp,
			off: pOffTmp,
			len: pLenTmp,
			cap: pCapTmp,
		});
		this.releaseTemp(pCapTmp, "i32");

		this._emitAppendSliceBytes(bufSliceTmp, pTmp, pLenTmp, sliceInfo, arrW);

		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({ op: "local.get", index: bufSliceTmp });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});

		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "ref.null", heapType: "any" });

		this.releaseTemp(bufSliceTmp, sliceW);
		this.releaseTemp(pLenTmp, "i32");
		this.releaseTemp(pOffTmp, "i32");
		this.releaseTemp(pArrTmp, arrW);
	}

	_emitBufferWriteStringCore(bTmp, strTmp) {
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: this.mod.getSliceType({ kind: "basic", name: "byte" })
				.typeIndex,
		};
		const pTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: strTmp });
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });
		this.pushInstruction({ op: "local.set", index: pTmp });

		this._emitBufferWriteCore(bTmp, pTmp);
		this.releaseTemp(pTmp, sliceW);
	}

	_emitHelperStringsReaderRead(_fn) {
		this._emitStringsReaderReadCore(0, 1);
		this.pushInstruction("return");
	}

	_emitHelperStringsReaderLen(_fn) {
		this._emitStringsReaderLenCore(0, "i64");
		this.pushInstruction("return");
	}

	_emitHelperStringsReaderReset(_fn) {
		this._emitStringsReaderResetCore(0, 1);
		this.pushInstruction("return");
	}

	_emitHelperBytesReaderRead(_fn) {
		this._emitBytesReaderReadCore(0, 1);
		this.pushInstruction("return");
	}

	_emitHelperBytesReaderLen(_fn) {
		this._emitBytesReaderLenCore(0, "i64");
		this.pushInstruction("return");
	}

	_emitHelperBytesReaderReset(_fn) {
		this._emitBytesReaderResetCore(0, 1);
		this.pushInstruction("return");
	}

	_emitHelperDiscardWrite(_fn) {
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("return");
	}

	_emitHelperDiscardWriteString(_fn) {
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("return");
	}
}
