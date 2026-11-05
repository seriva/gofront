// src/backend/wasm/stdlib/io.js
// FunctionEmitter mixin: io, readers/writers, fmt.Fprint*, fmt.Sscan*.

import { toWasmType } from "../types.js";

export class IoEmitter {
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
			// With the Go-source io package linked, its value is io.EOF.
			const goEof = this.mod.resolveGlobal("EOF$$io");
			if (goEof) {
				this.pushInstruction({ op: "global.get", index: goEof.index });
				return;
			}
			this._emitLazyErrorGlobal(this.mod.getIoErrGlobalIndex("EOF"), "EOF");
			return;
		}
		throw new Error(`Unsupported io constant: ${field}`);
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
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction("i64.extend_i32_u");
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			return;
		}
		if (targetName === "os.File") {
			this.pushInstruction({ op: "local.get", index: strTmp });
			this._callStdlib("fmt_print_raw");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction("i64.extend_i32_u");
			this.pushInstruction({ op: "ref.null", heapType: "any" });
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

		// Copying nothing must not touch the (possibly null) arrays.
		this.pushInstruction({ op: "local.get", index: countTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: oldLenTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: countTmp });
		this._emitArrayCopy(arrInfo, byteGo);
		this.pushInstruction("end");

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

	emitFprintCall(fn, call, _targetWasmType) {
		const args = this._expandTupleFmtArgs(call.args);
		const wExpr = args[0];
		const strTmp = this.acquireTemp("externref");
		this._emitFprintFormatString(fn, args.slice(1));
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
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction("i64.extend_i32_u");
			this.pushInstruction({ op: "ref.null", heapType: "any" });
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
		if (fn === "Fprint") {
			// Sprint's spacing rule: a space only between two non-strings.
			const temps = this._emitArgBuffer(restArgs, true);
			this.pushInstruction({ op: "i32.const", value: 0 });
			this._callStdlib("fmt_sprint");
			this._releaseArgBuffer(temps);
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

	_emitHelperBuilderWrite(_fn) {
		this._emitBuilderWriteCore(0, 1);
		this.pushInstruction("return");
	}

	_emitHelperBuilderWriteString(_fn) {
		this._emitBuilderWriteStringCore(0, 1);
		this.pushInstruction("return");
	}

	// A nil []byte reaches a synthetic Write through an interface call; it
	// reads as the empty slice.
	_emitNilByteSliceGuard(pTmp, sliceInfo) {
		this.pushInstruction({ op: "local.get", index: pTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "struct.new", typeIndex: sliceInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: pTmp });
		this.pushInstruction("end");
	}

	_emitBuilderWriteCore(bTmp, pTmp) {
		const byteElemGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteElemGo);
		this._emitNilByteSliceGuard(pTmp, sliceInfo);
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
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction("return");
	}

	_emitHelperOsFileClose(_fn) {
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("return");
	}
}
