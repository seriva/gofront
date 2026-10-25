// src/backend/wasm/stdlib/io.js
// FunctionEmitter mixin: io, readers/writers, fmt.Fprint*, fmt.Sscan*.

import { toWasmType } from "../types.js";

export class IoEmitter {
	_isIoConst(expr) {
		return (
			this._isPkgExpr(expr, "io") &&
			(expr.field === "EOF" || expr.field === "Discard")
		);
	}

	_isOsConst(expr) {
		return (
			this._isPkgExpr(expr, "os") &&
			(expr.field === "Stdout" ||
				expr.field === "Stderr" ||
				expr.field === "Stdin")
		);
	}

	emitOsConst(field, targetWasmType) {
		const gIdx = this.mod.getOsGlobalIndex(field);
		const fileInfo = this.mod.getStructType("os.File");
		const fd = field === "Stdout" ? 1 : field === "Stderr" ? 2 : 0;
		this.pushInstruction({ op: "global.get", index: gIdx });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		if (fileInfo) {
			this.pushInstruction({ op: "i64.const", value: BigInt(fd) });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: fileInfo.typeIndex,
			});
		} else {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
		this.pushInstruction({ op: "global.set", index: gIdx });
		this.pushInstruction("end");
		this.pushInstruction({ op: "global.get", index: gIdx });
		if (fileInfo && targetWasmType && targetWasmType !== "anyref") {
			this.pushInstruction({
				op: "ref.cast",
				typeIndex: fileInfo.typeIndex,
			});
		}
	}

	emitIoConst(field, _targetWasmType) {
		if (field === "EOF") {
			this._emitLazyErrorGlobal(this.mod.getIoErrGlobalIndex("EOF"), "EOF");
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
		if (name === "LimitReader") {
			this._emitIoLimitReader(call, targetWasmType);
			return;
		}
		if (name === "Copy") {
			this._emitIoCopy(call, targetWasmType);
			return;
		}
		if (name === "CopyN") {
			this._emitIoCopyN(call, targetWasmType);
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
		const wType = wExpr._type ?? this._resolveExprGoType(wExpr);
		const targetName =
			wType?.name ?? (wType?.kind === "pointer" ? wType.base?.name : null);
		if (targetName === "strings.Builder") {
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
			return;
		}
		if (targetName === "os.File") {
			this.pushInstruction({ op: "local.get", index: strTmp });
			this._callStdlib("fmt_print_raw");
			return;
		}

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

	_emitIoLimitReader(call, _targetWasmType) {
		const lrInfo = this.mod.getStructType("io.LimitedReader");
		if (!lrInfo) {
			throw new Error("io.LimitedReader struct type not found");
		}
		this.emitExpr(call.args[0], "anyref");
		this.emitExpr(call.args[1], "i64");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: lrInfo.typeIndex,
		});
	}

	_emitIoCopy(call, _targetWasmType) {
		const dstTmp = this.acquireTemp("anyref");
		const srcTmp = this.acquireTemp("anyref");
		this.emitExpr(call.args[0], "anyref");
		this.pushInstruction({ op: "local.set", index: dstTmp });
		this.emitExpr(call.args[1], "anyref");
		this.pushInstruction({ op: "local.set", index: srcTmp });

		this._emitIoCopyCore(dstTmp, srcTmp);

		this.releaseTemp(srcTmp, "anyref");
		this.releaseTemp(dstTmp, "anyref");
	}

	_emitIoCopyN(call, _targetWasmType) {
		const lrInfo = this.mod.getStructType("io.LimitedReader");
		if (!lrInfo) {
			throw new Error("io.LimitedReader struct type not found");
		}
		const dstTmp = this.acquireTemp("anyref");
		const srcTmp = this.acquireTemp("anyref");
		const nTmp = this.acquireTemp("i64");
		this.emitExpr(call.args[0], "anyref");
		this.pushInstruction({ op: "local.set", index: dstTmp });
		this.emitExpr(call.args[1], "anyref");
		this.pushInstruction({ op: "local.set", index: srcTmp });
		this.emitExpr(call.args[2], "i64");
		this.pushInstruction({ op: "local.set", index: nTmp });

		const lrW = {
			kind: "ref",
			nullable: true,
			typeIndex: lrInfo.typeIndex,
		};
		const lrTmp = this.acquireTemp(lrW);
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: lrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: lrTmp });

		this._emitIoCopyCore(dstTmp, lrTmp);

		const resErrTmp = this.acquireTemp("anyref");
		const writtenTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction({ op: "local.set", index: writtenTmp });

		// if written == n: err = nil
		this.pushInstruction({ op: "local.get", index: writtenTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i64.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");
		// if written < n && resErr == nil: resErr = io.EOF
		this.pushInstruction({ op: "local.get", index: writtenTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "local.get", index: resErrTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: writtenTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(writtenTmp, "i64");
		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(lrTmp, lrW);
		this.releaseTemp(nTmp, "i64");
		this.releaseTemp(srcTmp, "anyref");
		this.releaseTemp(dstTmp, "anyref");
	}

	_emitIoCopyCore(dstTmp, srcTmp) {
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		// Buffer: 32KB
		const bufSize = 32768;
		const bufArrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "i32.const", value: bufSize });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bufArrTmp });

		const bufTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: bufArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: bufSize });
		this.pushInstruction({ op: "i32.const", value: bufSize });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bufTmp });

		const totalWrittenTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: totalWrittenTmp });

		const errTmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: errTmp });

		const readErrTmp = this.acquireTemp("anyref");
		const nrI32Tmp = this.acquireTemp("i32");
		const subsliceTmp = this.acquireTemp(sliceW);
		const writeErrTmp = this.acquireTemp("anyref");
		const nwTmp = this.acquireTemp("i64");

		const dispatchReadIdx = this.mod.resolveFuncIndex(
			"__dispatch_io.Reader_Read",
		);
		const dispatchWriteIdx = this.mod.resolveFuncIndex(
			"__dispatch_io.Writer_Write",
		);

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		// Read: src.Read(buf)
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({ op: "local.get", index: bufTmp });
		if (dispatchReadIdx !== null) {
			this.pushInstruction({ op: "call", funcIndex: dispatchReadIdx });
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
		this.pushInstruction({ op: "local.set", index: readErrTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: nrI32Tmp });

		// if nr > 0: write
		this.pushInstruction({ op: "local.get", index: nrI32Tmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		// subslice = slice(bufArrTmp, 0, nrI32Tmp, nrI32Tmp)
		this.pushInstruction({ op: "local.get", index: bufArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: nrI32Tmp });
		this.pushInstruction({ op: "local.get", index: nrI32Tmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: subsliceTmp });

		// dst.Write(subslice)
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: subsliceTmp });
		if (dispatchWriteIdx !== null) {
			this.pushInstruction({ op: "call", funcIndex: dispatchWriteIdx });
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
		this.pushInstruction({ op: "local.set", index: writeErrTmp });
		this.pushInstruction({ op: "local.set", index: nwTmp });

		// totalWritten += nw
		this.pushInstruction({ op: "local.get", index: nwTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: totalWrittenTmp });
		this.pushInstruction({ op: "local.get", index: nwTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: totalWrittenTmp });
		this.pushInstruction("end");

		// if writeErr != nil: err = writeErr; br 2 (break loop)
		this.pushInstruction({ op: "local.get", index: writeErrTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: writeErrTmp });
		this.pushInstruction({ op: "local.set", index: errTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction("end"); // end if nr > 0

		// if readErr != nil:
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
		this.pushInstruction({ op: "br", depth: 2 }); // break loop
		this.pushInstruction("end"); // end if readErr != nil

		this.pushInstruction({ op: "br", depth: 0 }); // continue
		this.pushInstruction("end"); // end loop
		this.pushInstruction("end"); // end block

		this.pushInstruction({ op: "local.get", index: totalWrittenTmp });
		this.pushInstruction({ op: "local.get", index: errTmp });

		this.releaseTemp(nwTmp, "i64");
		this.releaseTemp(writeErrTmp, "anyref");
		this.releaseTemp(subsliceTmp, sliceW);
		this.releaseTemp(nrI32Tmp, "i32");
		this.releaseTemp(readErrTmp, "anyref");
		this.releaseTemp(errTmp, "anyref");
		this.releaseTemp(totalWrittenTmp, "i64");
		this.releaseTemp(bufTmp, sliceW);
		this.releaseTemp(bufArrTmp, arrW);
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
		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "i64.const", value: -1n });
		}
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
		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "i64.const", value: -1n });
		}
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
		if (method === "ReadAt") {
			this._emitReaderReadAt(expr, args, "strings.Reader");
			return;
		}
		if (method === "ReadByte") {
			this._emitReaderReadByte(expr, "strings.Reader");
			return;
		}
		if (method === "UnreadByte") {
			this._emitReaderUnreadByte(expr, "strings.Reader");
			return;
		}
		if (method === "ReadRune") {
			this._emitReaderReadRune(expr, "strings.Reader");
			return;
		}
		if (method === "UnreadRune") {
			this._emitReaderUnreadRune(expr, "strings.Reader");
			return;
		}
		if (method === "Seek") {
			this._emitReaderSeek(expr, args, "strings.Reader");
			return;
		}
		if (method === "Size") {
			this._emitReaderSize(expr, targetWasmType, "strings.Reader");
			return;
		}
		if (method === "WriteTo") {
			this._emitReaderWriteTo(expr, args, "strings.Reader");
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

		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}

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
		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}
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
		if (method === "ReadAt") {
			this._emitReaderReadAt(expr, args, "bytes.Reader");
			return;
		}
		if (method === "ReadByte") {
			this._emitReaderReadByte(expr, "bytes.Reader");
			return;
		}
		if (method === "UnreadByte") {
			this._emitReaderUnreadByte(expr, "bytes.Reader");
			return;
		}
		if (method === "ReadRune") {
			this._emitReaderReadRune(expr, "bytes.Reader");
			return;
		}
		if (method === "UnreadRune") {
			this._emitReaderUnreadRune(expr, "bytes.Reader");
			return;
		}
		if (method === "Seek") {
			this._emitReaderSeek(expr, args, "bytes.Reader");
			return;
		}
		if (method === "Size") {
			this._emitReaderSize(expr, targetWasmType, "bytes.Reader");
			return;
		}
		if (method === "WriteTo") {
			this._emitReaderWriteTo(expr, args, "bytes.Reader");
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
		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}
	}

	_emitNewError(msg) {
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
	}

	_emitReaderReadAt(expr, args, typeName) {
		const structInfo = this.mod.getStructType(typeName);
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
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const pTmp = this.acquireTemp(sliceW);
		this.emitExpr(args[0], sliceW);
		this.pushInstruction({ op: "local.set", index: pTmp });

		const offTmp = this.acquireTemp("i64");
		this.emitExpr(args[1], "i64");
		this.pushInstruction({ op: "local.set", index: offTmp });

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

		const srcSliceTmp = this.acquireTemp(sliceW);
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
		this.releaseTemp(srcSliceTmp, sliceW);

		const resNTmp = this.acquireTemp("i64");
		const resErrTmp = this.acquireTemp("anyref");

		// if off < 0: return (0, errors.New("<typeName>.ReadAt: negative offset"))
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this._emitNewError(`${typeName}.ReadAt: negative offset`);
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		// if off >= srcLen: return (0, io.EOF)
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.ge_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		// avail = srcLen - int(off)
		const availTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: availTmp });

		// n = min(pLen, avail)
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

		// copy bytes: pArr[pOff] = srcArr[srcOff + off]
		this.pushInstruction({ op: "local.get", index: pArrTmp });
		this.pushInstruction({ op: "local.get", index: pOffTmp });
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: nTmp });
		this._emitArrayCopy(sliceInfo.arrInfo, byteElemGo);

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.set", index: resNTmp });

		// if n < pLen: io.EOF else nil
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "anyref" });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction("else");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.releaseTemp(nTmp, "i32");
		this.releaseTemp(availTmp, "i32");
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resNTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(resNTmp, "i64");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(srcArrTmp, arrW);
		this.releaseTemp(pLenTmp, "i32");
		this.releaseTemp(pOffTmp, "i32");
		this.releaseTemp(pArrTmp, arrW);
		this.releaseTemp(offTmp, "i64");
		this.releaseTemp(pTmp, sliceW);
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderReadByte(expr, typeName) {
		const structInfo = this.mod.getStructType(typeName);
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
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const srcSliceTmp = this.acquireTemp(sliceW);
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
		this.releaseTemp(srcSliceTmp, sliceW);

		const posTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: posTmp });

		const resByteTmp = this.acquireTemp("i32");
		const resErrTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.ge_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resByteTmp });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.add");
		this.pushInstruction({
			op: "array.get",
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: resByteTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "i64.const", value: 1n });
		this.pushInstruction("i64.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});

		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}

		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resByteTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(resByteTmp, "i32");
		this.releaseTemp(posTmp, "i64");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(srcArrTmp, arrW);
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderUnreadByte(expr, typeName) {
		const structInfo = this.mod.getStructType(typeName);
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const posTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: posTmp });

		const resErrTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		const targetKind = typeName.startsWith("strings") ? "string" : "slice";
		this._emitNewError(`${typeName}.UnreadByte: at beginning of ${targetKind}`);
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "i64.const", value: 1n });
		this.pushInstruction("i64.sub");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});

		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}

		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(posTmp, "i64");
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderReadRune(expr, typeName) {
		const structInfo = this.mod.getStructType(typeName);
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
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const srcSliceTmp = this.acquireTemp(sliceW);
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
		this.releaseTemp(srcSliceTmp, sliceW);

		const posTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: posTmp });

		const resRuneTmp = this.acquireTemp("i32");
		const resSizeTmp = this.acquireTemp("i64");
		const resErrTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.ge_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resRuneTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: resSizeTmp });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		const cpTmp = this.acquireTemp("i32");
		const runeLenTmp = this.acquireTemp("i32");
		const posI32Tmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: posI32Tmp });

		this._emitDecodeUtf8Rune({
			arrTmp: srcArrTmp,
			offTmp: srcOffTmp,
			idxTmp: posI32Tmp,
			lenTmp: srcLenTmp,
			outRuneTmp: cpTmp,
			outLenTmp: runeLenTmp,
			arrTypeIndex: sliceInfo.arrInfo.typeIndex,
		});

		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "local.get", index: posTmp });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: runeLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});

		this.pushInstruction({ op: "local.get", index: cpTmp });
		this.pushInstruction({ op: "local.set", index: resRuneTmp });
		this.pushInstruction({ op: "local.get", index: runeLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.set", index: resSizeTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.releaseTemp(posI32Tmp, "i32");
		this.releaseTemp(runeLenTmp, "i32");
		this.releaseTemp(cpTmp, "i32");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resRuneTmp });
		this.pushInstruction({ op: "local.get", index: resSizeTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(resSizeTmp, "i64");
		this.releaseTemp(resRuneTmp, "i32");
		this.releaseTemp(posTmp, "i64");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(srcArrTmp, arrW);
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderUnreadRune(expr, typeName) {
		const structInfo = this.mod.getStructType(typeName);
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const prevTmp = this.acquireTemp("i64");
		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: prevTmp });
		} else {
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({ op: "local.set", index: prevTmp });
		}

		const posTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: posTmp });

		const resErrTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "local.get", index: prevTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "local.get", index: prevTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i64.ge_s");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "if", blockType: "void" });
		this._emitNewError(
			`${typeName}.UnreadRune: previous operation was not ReadRune`,
		);
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: prevTmp });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});

		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}

		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(posTmp, "i64");
		this.releaseTemp(prevTmp, "i64");
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderSeek(expr, args, typeName) {
		const structInfo = this.mod.getStructType(typeName);
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const offTmp = this.acquireTemp("i64");
		this.emitExpr(args[0], "i64");
		this.pushInstruction({ op: "local.set", index: offTmp });

		const whenceTmp = this.acquireTemp("i32");
		this._emitI32Arg(args[1]);
		this.pushInstruction({ op: "local.set", index: whenceTmp });

		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const srcSliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: srcSliceTmp });

		const srcLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: srcSliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: srcLenTmp });
		this.releaseTemp(srcSliceTmp, sliceW);

		const posTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: posTmp });

		const newPosTmp = this.acquireTemp("i64");
		const resErrTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "local.get", index: whenceTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.set", index: newPosTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: whenceTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: newPosTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: whenceTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: newPosTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: newPosTmp });
		this._emitNewError(`${typeName}.Seek: invalid whence`);
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resErrTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newPosTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: newPosTmp });
		this._emitNewError(`${typeName}.Seek: negative position`);
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: newPosTmp });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newPosTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(newPosTmp, "i64");
		this.releaseTemp(posTmp, "i64");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(whenceTmp, "i32");
		this.releaseTemp(offTmp, "i64");
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderSize(expr, targetWasmType, typeName) {
		const structInfo = this.mod.getStructType(typeName);
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

		const srcSliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: srcSliceTmp });

		this.pushInstruction({ op: "local.get", index: srcSliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i64.extend_i32_u");

		if ((targetWasmType ?? "i64") === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}

		this.releaseTemp(srcSliceTmp, sliceW);
		this.releaseTemp(rTmp, readerW);
	}

	_emitReaderWriteTo(expr, args, typeName) {
		const structInfo = this.mod.getStructType(typeName);
		const readerW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(readerW);
		this.emitExpr(expr, readerW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const wTmp = this.acquireTemp("anyref");
		this.emitExpr(args[0], "anyref");
		this.pushInstruction({ op: "local.set", index: wTmp });

		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const srcSliceTmp = this.acquireTemp(sliceW);
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
		this.releaseTemp(srcSliceTmp, sliceW);

		const posTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: posTmp });

		const resNTmp = this.acquireTemp("i64");
		const resErrTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.ge_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");

		const remLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: remLenTmp });

		const subsliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: remLenTmp });
		this.pushInstruction({ op: "local.get", index: srcCapTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: subsliceTmp });

		const dispatchWriteIdx = this.mod.resolveFuncIndex(
			"__dispatch_io.Writer_Write",
		);
		this.pushInstruction({ op: "local.get", index: wTmp });
		this.pushInstruction({ op: "local.get", index: subsliceTmp });
		if (dispatchWriteIdx !== null) {
			this.pushInstruction({ op: "call", funcIndex: dispatchWriteIdx });
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction({ op: "local.set", index: resNTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: posTmp });
		this.pushInstruction({ op: "local.get", index: resNTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});

		if (structInfo.fields.length > 2) {
			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 2,
			});
		}

		this.releaseTemp(subsliceTmp, sliceW);
		this.releaseTemp(remLenTmp, "i32");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resNTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(resNTmp, "i64");
		this.releaseTemp(posTmp, "i64");
		this.releaseTemp(srcCapTmp, "i32");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(srcArrTmp, arrW);
		this.releaseTemp(wTmp, "anyref");
		this.releaseTemp(rTmp, readerW);
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
			const temps = this._emitArgBuffer(
				rest,
				false,
				this._fmtNeedsTypes(format, rest),
			);
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

		const isSpread = ptrs.length === 1 && (ptrs[0]._spread || ptrs[0].ellipsis);
		const sliceLenTmp = isSpread ? this.acquireTemp("i32") : null;

		if (isSpread) {
			this._emitSscanAssignSpread(ptrs[0], totTokensTmp, nTmp, sliceLenTmp);
		} else {
			for (let i = 0; i < ptrs.length; i++) {
				this._emitSscanAssignOne(ptrs[i], i, totTokensTmp, nTmp);
			}
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
		if (isSpread) {
			this.pushInstruction({ op: "local.get", index: sliceLenTmp });
			this.pushInstruction("i64.extend_i32_u");
		} else {
			this.pushInstruction({ op: "i64.const", value: BigInt(ptrs.length) });
		}
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

		if (sliceLenTmp !== null) this.releaseTemp(sliceLenTmp, "i32");
		this.releaseTemp(nTmp, "i64");
		this.releaseTemp(totTokensTmp, "i32");
	}

	_emitSscanAssignSpread(sliceNode, totTokensTmp, nTmp, sliceLenTmp) {
		const sliceGoType = sliceNode._type ?? {
			kind: "slice",
			elem: { kind: "basic", name: "any" },
		};
		const sliceWType = this.toWasmType(sliceGoType);
		const sliceInfo = this.mod.getSliceType(sliceGoType.elem);
		const arrInfo = this.mod.getArrayType(sliceGoType.elem);
		const sliceTmp = this.acquireTemp(sliceWType);
		this.emitExpr(sliceNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: sliceTmp });

		// Read slice.len (field 2)
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: sliceLenTmp });

		// Loop index i = 0
		const idxTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: idxTmp });

		// Loop: block $exit, loop $loop
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		// if i >= sliceLen, break $exit
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "local.get", index: sliceLenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// if i >= totTokens, break $exit
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "local.get", index: totTokensTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// check fmt_sscan_has_err
		this._callStdlib("fmt_sscan_has_err");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// Load ptr = slice.data[slice.offset + i]
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
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({
			op: "array.get",
			typeIndex: arrInfo.typeIndex,
		});

		const elemTmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "local.set", index: elemTmp });

		// Test and write to the box
		this._emitSscanWriteAny(elemTmp, idxTmp, nTmp);

		this.releaseTemp(elemTmp, "anyref");

		// i++
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: idxTmp });

		// loop again
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end"); // loop
		this.pushInstruction("end"); // block

		this.releaseTemp(idxTmp, "i32");
		this.releaseTemp(sliceTmp, sliceWType);
	}

	_emitSscanWriteAny(elemTmp, idxTmp, nTmp) {
		const types = [
			{
				goType: { kind: "basic", name: "int" },
				call: "fmt_sscan_token_i64",
				wrap: null,
			},
			{
				goType: { kind: "basic", name: "int64" },
				call: "fmt_sscan_token_i64",
				wrap: null,
			},
			{
				goType: { kind: "basic", name: "uint" },
				call: "fmt_sscan_token_i64",
				wrap: null,
			},
			{
				goType: { kind: "basic", name: "uint64" },
				call: "fmt_sscan_token_i64",
				wrap: null,
			},
			{
				goType: { kind: "basic", name: "uintptr" },
				call: "fmt_sscan_token_i64",
				wrap: null,
			},
			{
				goType: { kind: "basic", name: "int32" },
				call: "fmt_sscan_token_i64",
				wrap: "i32.wrap_i64",
			},
			{
				goType: { kind: "basic", name: "uint32" },
				call: "fmt_sscan_token_i64",
				wrap: "i32.wrap_i64",
			},
			{
				goType: { kind: "basic", name: "int16" },
				call: "fmt_sscan_token_i64",
				wrap: "i32.wrap_i64",
			},
			{
				goType: { kind: "basic", name: "uint16" },
				call: "fmt_sscan_token_i64",
				wrap: "i32.wrap_i64",
			},
			{
				goType: { kind: "basic", name: "int8" },
				call: "fmt_sscan_token_i64",
				wrap: "i32.wrap_i64",
			},
			{
				goType: { kind: "basic", name: "uint8" },
				call: "fmt_sscan_token_i64",
				wrap: "i32.wrap_i64",
			},
			{
				goType: { kind: "basic", name: "float64" },
				call: "fmt_sscan_token_f64",
				wrap: null,
			},
			{
				goType: { kind: "basic", name: "float32" },
				call: "fmt_sscan_token_f64",
				wrap: "f32.demote_f64",
			},
			{
				goType: { kind: "basic", name: "string" },
				call: "fmt_sscan_token_str",
				wrap: null,
			},
			{
				goType: { kind: "basic", name: "bool" },
				call: "fmt_sscan_token_bool",
				wrap: null,
			},
		];

		let ends = 0;
		for (const { goType, call, wrap } of types) {
			const ptrGoType = { kind: "pointer", base: goType };
			const ifaceBox = this.mod.getIfaceBoxType(ptrGoType);
			const scalarBox = this.mod.getBoxType(goType);

			// Arm 1: wrapped in ifaceBox
			this.pushInstruction({ op: "local.get", index: elemTmp });
			this.pushInstruction({ op: "ref.test", typeIndex: ifaceBox.typeIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: elemTmp });
			this.pushInstruction({ op: "ref.cast", typeIndex: ifaceBox.typeIndex });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: ifaceBox.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "ref.cast", typeIndex: scalarBox.typeIndex });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this._callStdlib(call);
			if (wrap) this.pushInstruction(wrap);
			this.pushInstruction({
				op: "struct.set",
				typeIndex: scalarBox.typeIndex,
				fieldIndex: 0,
			});
			this._emitIncrementN(nTmp);
			this.pushInstruction("else");
			ends++;

			// Arm 2: bare scalarBox
			this.pushInstruction({ op: "local.get", index: elemTmp });
			this.pushInstruction({ op: "ref.test", typeIndex: scalarBox.typeIndex });
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: elemTmp });
			this.pushInstruction({ op: "ref.cast", typeIndex: scalarBox.typeIndex });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this._callStdlib(call);
			if (wrap) this.pushInstruction(wrap);
			this.pushInstruction({
				op: "struct.set",
				typeIndex: scalarBox.typeIndex,
				fieldIndex: 0,
			});
			this._emitIncrementN(nTmp);
			this.pushInstruction("else");
			ends++;
		}

		for (let i = 0; i < ends; i++) {
			this.pushInstruction("end");
		}
	}

	_emitIncrementN(nTmp) {
		this._callStdlib("fmt_sscan_has_err");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i64.const", value: 1n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: nTmp });
		this.pushInstruction("end");
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
		const isAddressOf = pExpr.kind === "UnaryExpr" && pExpr.op === "&";
		const pType =
			pExpr._type ??
			(pExpr.kind === "Ident" ? this.resolveLocal(pExpr.name)?.goType : null) ??
			this._resolveExprGoType(pExpr);
		const pointeeType = pType?.base ?? pType;
		const targetNode = isAddressOf
			? (pExpr.operand ?? pExpr.expr)
			: {
					kind: "UnaryExpr",
					op: "*",
					operand: { ...pExpr, _type: pType },
					_type: pointeeType,
				};
		const effectivePointee = targetNode._type ?? pointeeType;
		const wType = toWasmType(effectivePointee, this.mod.checker, this.mod);

		this._emitAssignToTarget(targetNode, wType, effectivePointee, () => {
			this._emitSscanTokenValue(wType, effectivePointee, tokenIdx);
		});
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
			case "buffer_read":
				this._emitHelperBufferRead(fn);
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
			case "limited_reader_read":
				this._emitHelperLimitedReaderRead(fn);
				return;
			case "sha256_write":
				this._emitHelperSha256Write(fn);
				return;
			case "sha256_sum":
				this._emitHelperSha256Sum(fn);
				return;
			case "sha256_reset":
				this._emitHelperSha256Reset(fn);
				return;
			case "sha256_size":
				this._emitHelperSha256Size(fn);
				return;
			case "sha256_block_size":
				this._emitHelperSha256BlockSize(fn);
				return;
			case "os_file_write":
				this._emitHelperOsFileWrite(fn);
				return;
			case "os_file_write_string":
				this._emitHelperOsFileWriteString(fn);
				return;
			case "os_file_read":
				this._emitHelperOsFileRead(fn);
				return;
			case "os_file_close":
				this._emitHelperOsFileClose(fn);
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

	_emitBufferWriteCore(bTmp, pTmp, structName = "bytes.Buffer") {
		const structInfo = this.mod.getStructType(structName);
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
		if (structInfo.fields.length > 1) {
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 1,
			});
		}

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

	_emitHelperBufferRead(_fn) {
		this._emitBufferReadCore(0, 1);
		this.pushInstruction("return");
	}

	_emitBufferReadCore(bTmp, pTmp) {
		const structInfo = this.mod.getStructType("bytes.Buffer");
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
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

		// Get b.buf (field 0)
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

		const srcArrTmp = this.acquireTemp(arrW);
		const srcOffTmp = this.acquireTemp("i32");
		const srcLenTmp = this.acquireTemp("i32");
		const srcCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(bufSliceTmp, sliceInfo, {
			arr: srcArrTmp,
			off: srcOffTmp,
			len: srcLenTmp,
			cap: srcCapTmp,
		});
		this.releaseTemp(bufSliceTmp, sliceW);

		// if srcLen == 0:
		//   if pLen == 0: (0, nil) else: (0, io.EOF)
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "anyref" });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("else");
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		if (structInfo.fields.length > 1) {
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 1,
			});
		}
		this.pushInstruction("else");

		// n = min(p.len, srcLen)
		const nTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: nTmp });

		// copy: pArr[pOff .. pOff + n] = srcArr[srcOff .. srcOff + n]
		this.pushInstruction({ op: "local.get", index: pArrTmp });
		this.pushInstruction({ op: "local.get", index: pOffTmp });
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this._emitArrayCopy(sliceInfo.arrInfo, byteElemGo);

		// update b.buf: struct.new sliceInfo (srcArr, srcOff + n, srcLen - n, srcCap - n)
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: srcCapTmp });
		this.pushInstruction({ op: "local.get", index: nTmp });
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
		if (structInfo.fields.length > 1) {
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({ op: "i64.const", value: 1n });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 1,
			});
		}

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.set", index: resNTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.releaseTemp(nTmp, "i32");
		this.pushInstruction("end"); // end else

		this.releaseTemp(srcCapTmp, "i32");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(srcArrTmp, arrW);

		this.pushInstruction({ op: "local.get", index: resNTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(resNTmp, "i64");
		this.releaseTemp(pLenTmp, "i32");
		this.releaseTemp(pOffTmp, "i32");
		this.releaseTemp(pArrTmp, arrW);
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

	_emitHelperOsFileWriteString(_fn) {
		this.pushInstruction({ op: "local.get", index: 1 });
		this._callStdlib("fmt_print_raw");
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringLenImportIndex(),
		});
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("return");
	}

	_emitHelperOsFileWrite(_fn) {
		this.pushInstruction({ op: "local.get", index: 1 });
		this._emitByteSliceToString({ elem: { kind: "basic", name: "byte" } });
		this._callStdlib("fmt_print_raw");
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

	_emitHelperOsFileRead(_fn) {
		this.pushInstruction({ op: "i64.const", value: 0n });
		this._emitLazyErrorGlobal(this.mod.getIoErrGlobalIndex("EOF"), "EOF");
		this.pushInstruction("return");
	}

	_emitHelperOsFileClose(_fn) {
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("return");
	}

	_emitHelperLimitedReaderRead(_fn) {
		this._emitLimitedReaderReadCore(0, 1);
		this.pushInstruction("return");
	}

	_emitLimitedReaderReadCore(lTmp, pTmp) {
		const structInfo = this.mod.getStructType("io.LimitedReader");
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		};

		// 1. Check if l.N <= 0
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1, // N
		});
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction("return");
		this.pushInstruction("end");

		// 2. If int64(len(p)) > l.N, subslice p = p[0:l.N]
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

		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1, // N
		});
		this.pushInstruction("i64.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: pLenTmp });
		this.pushInstruction({ op: "local.get", index: pArrTmp });
		this.pushInstruction({ op: "local.get", index: pOffTmp });
		this.pushInstruction({ op: "local.get", index: pLenTmp });
		this.pushInstruction({ op: "local.get", index: pCapTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: pTmp });
		this.pushInstruction("end");

		this.releaseTemp(pCapTmp, "i32");
		this.releaseTemp(pLenTmp, "i32");
		this.releaseTemp(pOffTmp, "i32");
		this.releaseTemp(pArrTmp, arrW);

		// 3. Call l.R.Read(p)
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0, // R
		});
		this.pushInstruction({ op: "local.get", index: pTmp });

		const dispatchIdx = this.mod.resolveFuncIndex("__dispatch_io.Reader_Read");
		if (dispatchIdx !== null) {
			this.pushInstruction({ op: "call", funcIndex: dispatchIdx });
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}

		const resErrTmp = this.acquireTemp("anyref");
		const resNTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction({ op: "local.set", index: resNTmp });

		// 4. Update l.N -= n:
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({ op: "local.get", index: lTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1, // N
		});
		this.pushInstruction({ op: "local.get", index: resNTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 1, // N
		});

		// 5. Return (n, err)
		this.pushInstruction({ op: "local.get", index: resNTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });
		this.releaseTemp(resNTmp, "i64");
		this.releaseTemp(resErrTmp, "anyref");
	}

	emitIoLimitedReaderMethodCall(method, recvExpr, args, _targetWasmType) {
		if (method === "Read") {
			const structInfo = this.mod.getStructType("io.LimitedReader");
			const lrW = {
				kind: "ref",
				nullable: true,
				typeIndex: structInfo.typeIndex,
			};
			const lTmp = this.acquireTemp(lrW);
			this.emitExpr(recvExpr, lrW);
			this.pushInstruction({ op: "local.set", index: lTmp });

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

			this._emitLimitedReaderReadCore(lTmp, pTmp);
			this.releaseTemp(pTmp, sliceW);
			this.releaseTemp(lTmp, lrW);
			return;
		}
		throw new Error(`Unsupported io.LimitedReader method: ${method}`);
	}

	_emitHelperSha256Write(_fn) {
		this._emitBufferWriteCore(0, 1, "sha256.digest");
		this.pushInstruction("return");
	}

	_emitHelperSha256Reset(_fn) {
		const structInfo = this.mod.getStructType("sha256.digest");
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "global.get",
			index: sliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction("return");
	}

	_emitHelperSha256Size(_fn) {
		this.pushInstruction({ op: "i64.const", value: 32n });
		this.pushInstruction("return");
	}

	_emitHelperSha256BlockSize(_fn) {
		this.pushInstruction({ op: "i64.const", value: 64n });
		this.pushInstruction("return");
	}

	_emitHelperSha256Sum(_fn) {
		const structInfo = this.mod.getStructType("sha256.digest");
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = { kind: "ref", nullable: true, typeIndex: arrInfo.typeIndex };

		const bufSliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: 0 });
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

		const dArrTmp = this.acquireTemp(arrW);
		const dOffTmp = this.acquireTemp("i32");
		const dLenTmp = this.acquireTemp("i32");
		const dCapTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(bufSliceTmp, sliceInfo, {
			arr: dArrTmp,
			off: dOffTmp,
			len: dLenTmp,
			cap: dCapTmp,
		});
		this.releaseTemp(dCapTmp, "i32");

		this.pushInstruction({ op: "local.get", index: dLenTmp });
		this._callStdlib("raw_bytes_init");

		const iLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: dLenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: dArrTmp });
		this.pushInstruction({ op: "local.get", index: dOffTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this._callStdlib("raw_bytes_push");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this._callStdlib("crypto_sha256_sum");
		this.pushInstruction("drop");

		const outArrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "i32.const", value: 32 });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: outArrTmp });

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 32 });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: outArrTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this._callStdlib("raw_bytes_get");
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		const outSliceTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: outArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: 32 });
		this.pushInstruction({ op: "i32.const", value: 32 });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: outSliceTmp });

		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: outSliceTmp });
		this.pushInstruction("return");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: outSliceTmp });
		this.pushInstruction("return");
		this.pushInstruction("end");

		const countTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 32 });
		this.pushInstruction({ op: "local.set", index: countTmp });
		const bTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({ op: "local.set", index: bTmp });
		this._emitAppendSliceBytes(bTmp, outSliceTmp, countTmp, sliceInfo, arrW);
		this.pushInstruction({ op: "local.get", index: bTmp });
		this.pushInstruction("return");

		this.releaseTemp(bTmp, sliceW);
		this.releaseTemp(countTmp, "i32");
		this.releaseTemp(outSliceTmp, sliceW);
		this.releaseTemp(outArrTmp, arrW);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(dLenTmp, "i32");
		this.releaseTemp(dOffTmp, "i32");
		this.releaseTemp(dArrTmp, arrW);
		this.releaseTemp(bufSliceTmp, sliceW);
	}
}
