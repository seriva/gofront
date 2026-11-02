// src/backend/wasm/stdlib/packages.js
// FunctionEmitter mixin: sync and the encoding/binary members that walk an `any`
// (Read, Write, Size).

import { isSliceType, toWasmType } from "../types.js";

export class ExtendedPackagesEmitter {
	emitSyncMutexMethodCall(method, recvExpr, _args, _targetWasmType) {
		const recvW = toWasmType(
			recvExpr._type ?? this._resolveExprGoType(recvExpr),
			this.mod.checker,
			this.mod,
		);
		this.emitExpr(recvExpr, recvW);
		this.pushInstruction("drop");
		if (method === "TryLock" || method === "TryRLock") {
			this.pushInstruction({ op: "i32.const", value: 1 });
		} else if (method === "RLocker") {
			this.pushInstruction({ op: "ref.null", type: "any" });
		}
	}

	emitSyncOnceMethodCall(method, recvExpr, args, _targetWasmType) {
		if (method !== "Do") return;
		const structInfo = this.mod.getStructType("sync.Once");
		const onceW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const oTmp = this.acquireTemp(onceW);
		this.emitExpr(recvExpr, onceW);
		this.pushInstruction({ op: "local.set", index: oTmp });

		this.pushInstruction({ op: "local.get", index: oTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: oTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: structInfo.typeIndex,
			fieldIndex: 0,
		});

		const fnNode = args[0];
		const closureGoType = this._resolveExprGoType(fnNode);
		const closureInfo = this.mod.getClosureType(closureGoType);
		const closureW = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};
		const clTmp = this.acquireTemp(closureW);
		this.emitExpr(fnNode, closureW);
		this.pushInstruction({ op: "local.set", index: clTmp });

		this.pushInstruction({ op: "local.get", index: clTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
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

		this.releaseTemp(clTmp, closureW);
		this.pushInstruction("end");
		this.releaseTemp(oTmp, onceW);
	}

	emitSyncWaitGroupMethodCall(method, recvExpr, args, _targetWasmType) {
		const structInfo = this.mod.getStructType("sync.WaitGroup");
		const wgW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const wgTmp = this.acquireTemp(wgW);
		this.emitExpr(recvExpr, wgW);
		this.pushInstruction({ op: "local.set", index: wgTmp });

		if (method === "Add") {
			const deltaTmp = this.acquireTemp("i64");
			this.emitExpr(args[0], "i64");
			this.pushInstruction({ op: "local.set", index: deltaTmp });

			this.pushInstruction({ op: "local.get", index: wgTmp });
			this.pushInstruction({ op: "local.get", index: wgTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.get", index: deltaTmp });
			this.pushInstruction("i64.add");
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});
			this.releaseTemp(deltaTmp, "i64");
		} else if (method === "Done") {
			this.pushInstruction({ op: "local.get", index: wgTmp });
			this.pushInstruction({ op: "local.get", index: wgTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "i64.const", value: 1n });
			this.pushInstruction("i64.sub");
			this.pushInstruction({
				op: "struct.set",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});
		}
		this.releaseTemp(wgTmp, wgW);
	}

	// `binary.BigEndian`, or a value of its Go-source type (`bigEndian`).
	_isBigEndianExpr(orderExpr) {
		return (
			orderExpr?.field === "BigEndian" ||
			String(orderExpr?._type?.name ?? "")
				.toLowerCase()
				.includes("bigendian")
		);
	}

	emitBinaryCall(name, call, _targetWasmType) {
		const args = call.args;
		if (name === "Size") {
			this._emitBinarySize(args[0]);
			return;
		}
		if (name === "Read") {
			this._emitBinaryRead(args[0], args[1], args[2]);
			return;
		}
		if (name === "Write") {
			this._emitBinaryWrite(args[0], args[1], args[2]);
			return;
		}
		throw new Error(`Unsupported binary call: binary.${name}`);
	}

	_emitBinarySize(arg) {
		const t = arg._type ?? this._resolveExprGoType(arg);
		const sizeOf = (gt) => {
			if (!gt) return -1;
			if (gt.kind === "basic") {
				switch (gt.name) {
					case "bool":
					case "int8":
					case "uint8":
					case "byte":
						return 1;
					case "int16":
					case "uint16":
						return 2;
					case "int32":
					case "uint32":
					case "float32":
					case "rune":
						return 4;
					case "int64":
					case "uint64":
					case "float64":
					case "int":
					case "uint":
					case "uintptr":
						return 8;
					default:
						return -1;
				}
			}
			if (gt.kind === "array" || gt.kind === "ArrayType") {
				const es = sizeOf(gt.elem);
				const len = gt.len ?? gt.size ?? 0;
				return es > 0 ? es * len : -1;
			}
			if (
				gt.kind === "pointer" ||
				gt.kind === "PointerType" ||
				gt.kind === "StarExpr"
			) {
				return sizeOf(gt.base ?? gt.expr ?? gt.operand);
			}
			if (gt.kind === "struct" || gt.kind === "StructType") {
				let total = 0;
				if (gt.fields instanceof Map) {
					for (const fType of gt.fields.values()) {
						const s = sizeOf(fType);
						if (s < 0) return -1;
						total += s;
					}
					return total;
				}
			}
			if (gt.name && this.mod.checker?.types?.has(gt.name)) {
				const resolved = this.mod.checker.types.get(gt.name);
				return sizeOf(resolved.underlying ?? resolved);
			}
			return -1;
		};
		const s = sizeOf(t);
		if (s >= 0) {
			this.pushInstruction({ op: "i64.const", value: BigInt(s) });
		} else {
			this.pushInstruction({ op: "i64.const", value: -1n });
		}
	}

	_emitBinaryRead(rExpr, orderExpr, dataExpr) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};

		// If data is a slice ([]byte): read directly into data slice
		const dataType = dataExpr._type ?? this._resolveExprGoType(dataExpr);
		if (isSliceType(dataType, this.mod.checker)) {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(dataExpr, sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const rTmp = this.acquireTemp("anyref");
			this.emitExpr(rExpr, "anyref");
			this.pushInstruction({ op: "local.set", index: rTmp });

			this.pushInstruction({ op: "local.get", index: rTmp });
			this.pushInstruction({ op: "local.get", index: sTmp });
			const dispatchReadIdx = this.mod.resolveFuncIndex(
				"__dispatch_io.Reader_Read",
			);
			this.pushInstruction({ op: "call", funcIndex: dispatchReadIdx });

			// Drop n (int), return err
			const errTmp = this.acquireTemp("anyref");
			this.pushInstruction({ op: "local.set", index: errTmp });
			this.pushInstruction("drop"); // drop n
			this.pushInstruction({ op: "local.get", index: errTmp });

			this.releaseTemp(errTmp, "anyref");
			this.releaseTemp(rTmp, "anyref");
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		// Scalar pointer: determine sz (1, 2, 4, 8)
		let sz = 4;
		const baseType =
			dataType?.base ?? dataType?.expr ?? dataType?.operand ?? dataType;
		if (baseType?.name === "uint16" || baseType?.name === "int16") sz = 2;
		else if (
			baseType?.name === "uint64" ||
			baseType?.name === "int64" ||
			baseType?.name === "int" ||
			baseType?.name === "uint" ||
			baseType?.name === "float64"
		)
			sz = 8;
		else if (
			baseType?.name === "byte" ||
			baseType?.name === "uint8" ||
			baseType?.name === "int8" ||
			baseType?.name === "bool"
		)
			sz = 1;
		else if (baseType?.name === "float32") sz = 4;

		const arrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "i32.const", value: sz });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		const bufTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: sz });
		this.pushInstruction({ op: "i32.const", value: sz });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bufTmp });

		const rTmp = this.acquireTemp("anyref");
		this.emitExpr(rExpr, "anyref");
		this.pushInstruction({ op: "local.set", index: rTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: bufTmp });
		const dispatchReadIdx = this.mod.resolveFuncIndex(
			"__dispatch_io.Reader_Read",
		);
		this.pushInstruction({ op: "call", funcIndex: dispatchReadIdx });

		const errTmp = this.acquireTemp("anyref");
		const nTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.set", index: errTmp });
		this.pushInstruction({ op: "local.set", index: nTmp });

		// if err != nil -> return err
		this.pushInstruction({ op: "block", blockType: "anyref" });
		this.pushInstruction({ op: "local.get", index: errTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: errTmp });
		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end");

		// if n < sz -> return io.EOF
		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i64.const", value: BigInt(sz) });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitIoConst("EOF", "anyref");
		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end");

		// Decode scalar from arrTmp and write to target
		const isAddressOf = dataExpr.kind === "UnaryExpr" && dataExpr.op === "&";
		const targetNode = isAddressOf
			? (dataExpr.operand ?? dataExpr.expr)
			: {
					kind: "UnaryExpr",
					op: "*",
					operand: { ...dataExpr, _type: dataType },
					_type: baseType,
				};

		const isBig = this._isBigEndianExpr(orderExpr);

		let wType = "i32";
		if (sz === 8) {
			wType = baseType?.name === "float64" ? "f64" : "i64";
		} else if (sz === 4 && baseType?.name === "float32") {
			wType = "f32";
		}

		this._emitAssignToTarget(targetNode, wType, baseType, () => {
			if (sz === 1) {
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				if (baseType?.name === "int8") {
					this.pushInstruction("i32.extend8_s");
				}
			} else if (sz === 2) {
				if (isBig) {
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.pushInstruction({
						op: "array.get",
						typeIndex: arrInfo.typeIndex,
					});
					this.pushInstruction({ op: "i32.const", value: 8 });
					this.pushInstruction("i32.shl");
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction({
						op: "array.get",
						typeIndex: arrInfo.typeIndex,
					});
					this.pushInstruction("i32.or");
				} else {
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.pushInstruction({
						op: "array.get",
						typeIndex: arrInfo.typeIndex,
					});
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction({
						op: "array.get",
						typeIndex: arrInfo.typeIndex,
					});
					this.pushInstruction({ op: "i32.const", value: 8 });
					this.pushInstruction("i32.shl");
					this.pushInstruction("i32.or");
				}
				if (baseType?.name === "int16") {
					this.pushInstruction("i32.extend16_s");
				}
			} else if (sz === 4) {
				for (let i = 0; i < 4; i++) {
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction({
						op: "array.get",
						typeIndex: arrInfo.typeIndex,
					});
				}
				if (isBig) {
					const b3 = this.acquireTemp("i32");
					const b2 = this.acquireTemp("i32");
					const b1 = this.acquireTemp("i32");
					const b0 = this.acquireTemp("i32");
					this.pushInstruction({ op: "local.set", index: b3 });
					this.pushInstruction({ op: "local.set", index: b2 });
					this.pushInstruction({ op: "local.set", index: b1 });
					this.pushInstruction({ op: "local.set", index: b0 });
					this.pushInstruction({ op: "local.get", index: b0 });
					this.pushInstruction({ op: "i32.const", value: 24 });
					this.pushInstruction("i32.shl");
					this.pushInstruction({ op: "local.get", index: b1 });
					this.pushInstruction({ op: "i32.const", value: 16 });
					this.pushInstruction("i32.shl");
					this.pushInstruction("i32.or");
					this.pushInstruction({ op: "local.get", index: b2 });
					this.pushInstruction({ op: "i32.const", value: 8 });
					this.pushInstruction("i32.shl");
					this.pushInstruction("i32.or");
					this.pushInstruction({ op: "local.get", index: b3 });
					this.pushInstruction("i32.or");
					this.releaseTemp(b0, "i32");
					this.releaseTemp(b1, "i32");
					this.releaseTemp(b2, "i32");
					this.releaseTemp(b3, "i32");
				} else {
					const b3 = this.acquireTemp("i32");
					const b2 = this.acquireTemp("i32");
					const b1 = this.acquireTemp("i32");
					const b0 = this.acquireTemp("i32");
					this.pushInstruction({ op: "local.set", index: b3 });
					this.pushInstruction({ op: "local.set", index: b2 });
					this.pushInstruction({ op: "local.set", index: b1 });
					this.pushInstruction({ op: "local.set", index: b0 });
					this.pushInstruction({ op: "local.get", index: b0 });
					this.pushInstruction({ op: "local.get", index: b1 });
					this.pushInstruction({ op: "i32.const", value: 8 });
					this.pushInstruction("i32.shl");
					this.pushInstruction("i32.or");
					this.pushInstruction({ op: "local.get", index: b2 });
					this.pushInstruction({ op: "i32.const", value: 16 });
					this.pushInstruction("i32.shl");
					this.pushInstruction("i32.or");
					this.pushInstruction({ op: "local.get", index: b3 });
					this.pushInstruction({ op: "i32.const", value: 24 });
					this.pushInstruction("i32.shl");
					this.pushInstruction("i32.or");
					this.releaseTemp(b0, "i32");
					this.releaseTemp(b1, "i32");
					this.releaseTemp(b2, "i32");
					this.releaseTemp(b3, "i32");
				}
				if (baseType?.name === "float32") {
					this.pushInstruction("f32.reinterpret_i32");
				}
			} else if (sz === 8) {
				const bTmps = [];
				for (let i = 0; i < 8; i++) {
					this.pushInstruction({ op: "local.get", index: arrTmp });
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction({
						op: "array.get",
						typeIndex: arrInfo.typeIndex,
					});
					this.pushInstruction("i64.extend_i32_u");
					const bt = this.acquireTemp("i64");
					this.pushInstruction({ op: "local.set", index: bt });
					bTmps.push(bt);
				}
				this.pushInstruction({ op: "i64.const", value: 0n });
				for (let i = 0; i < 8; i++) {
					const shift = isBig ? (7 - i) * 8 : i * 8;
					this.pushInstruction({ op: "local.get", index: bTmps[i] });
					if (shift > 0) {
						this.pushInstruction({ op: "i64.const", value: BigInt(shift) });
						this.pushInstruction("i64.shl");
					}
					this.pushInstruction("i64.or");
				}
				for (const bt of bTmps) this.releaseTemp(bt, "i64");
				if (baseType?.name === "float64") {
					this.pushInstruction("f64.reinterpret_i64");
				}
			}
		});

		// return nil error
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction("end"); // end block

		this.releaseTemp(nTmp, "i64");
		this.releaseTemp(errTmp, "anyref");
		this.releaseTemp(rTmp, "anyref");
		this.releaseTemp(bufTmp, sliceW);
		this.releaseTemp(arrTmp, arrW);
	}

	_emitBinaryWrite(wExpr, orderExpr, dataExpr) {
		const byteGo = { kind: "basic", name: "byte" };
		const sliceInfo = this.mod.getSliceType(byteGo);
		const arrInfo = sliceInfo.arrInfo;
		const sliceW = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrW = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};

		const dataType = dataExpr._type ?? this._resolveExprGoType(dataExpr);
		if (isSliceType(dataType, this.mod.checker)) {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(dataExpr, sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const wTmp = this.acquireTemp("anyref");
			this.emitExpr(wExpr, "anyref");
			this.pushInstruction({ op: "local.set", index: wTmp });

			this.pushInstruction({ op: "local.get", index: wTmp });
			this.pushInstruction({ op: "local.get", index: sTmp });
			const dispatchWriteIdx = this.mod.resolveFuncIndex(
				"__dispatch_io.Writer_Write",
			);
			this.pushInstruction({ op: "call", funcIndex: dispatchWriteIdx });

			const errTmp = this.acquireTemp("anyref");
			this.pushInstruction({ op: "local.set", index: errTmp });
			this.pushInstruction("drop"); // drop n
			this.pushInstruction({ op: "local.get", index: errTmp });

			this.releaseTemp(errTmp, "anyref");
			this.releaseTemp(wTmp, "anyref");
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		let sz = 4;
		if (dataType?.name === "uint16" || dataType?.name === "int16") sz = 2;
		else if (
			dataType?.name === "uint64" ||
			dataType?.name === "int64" ||
			dataType?.name === "int" ||
			dataType?.name === "uint" ||
			dataType?.name === "float64"
		)
			sz = 8;
		else if (
			dataType?.name === "byte" ||
			dataType?.name === "uint8" ||
			dataType?.name === "int8" ||
			dataType?.name === "bool"
		)
			sz = 1;
		else if (dataType?.name === "float32") sz = 4;

		const isBig = this._isBigEndianExpr(orderExpr);

		const arrTmp = this.acquireTemp(arrW);
		this.pushInstruction({ op: "i32.const", value: sz });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		if (sz === 1) {
			const vTmp = this.acquireTemp("i32");
			this.emitExpr(dataExpr, "i32");
			this.pushInstruction({ op: "local.set", index: vTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: vTmp });
			this.pushInstruction({ op: "i32.const", value: 0xff });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
			this.releaseTemp(vTmp, "i32");
		} else if (sz === 2) {
			const vTmp = this.acquireTemp("i32");
			this.emitExpr(dataExpr, "i32");
			this.pushInstruction({ op: "local.set", index: vTmp });

			// byte 0
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: vTmp });
			if (isBig) {
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shr_u");
			}
			this.pushInstruction({ op: "i32.const", value: 0xff });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

			// byte 1
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.get", index: vTmp });
			if (!isBig) {
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shr_u");
			}
			this.pushInstruction({ op: "i32.const", value: 0xff });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
			this.releaseTemp(vTmp, "i32");
		} else if (sz === 4) {
			const vTmp = this.acquireTemp("i32");
			if (dataType?.name === "float32") {
				this.emitExpr(dataExpr, "f32");
				this.pushInstruction("i32.reinterpret_f32");
			} else {
				this.emitExpr(dataExpr, "i32");
			}
			this.pushInstruction({ op: "local.set", index: vTmp });

			for (let i = 0; i < 4; i++) {
				const shift = isBig ? (3 - i) * 8 : i * 8;
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "i32.const", value: i });
				this.pushInstruction({ op: "local.get", index: vTmp });
				if (shift > 0) {
					this.pushInstruction({ op: "i32.const", value: shift });
					this.pushInstruction("i32.shr_u");
				}
				this.pushInstruction({ op: "i32.const", value: 0xff });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
			}
			this.releaseTemp(vTmp, "i32");
		} else if (sz === 8) {
			const vTmp = this.acquireTemp("i64");
			if (dataType?.name === "float64") {
				this.emitExpr(dataExpr, "f64");
				this.pushInstruction("i64.reinterpret_f64");
			} else {
				this.emitExpr(dataExpr, "i64");
			}
			this.pushInstruction({ op: "local.set", index: vTmp });

			for (let i = 0; i < 8; i++) {
				const shift = isBig ? (7 - i) * 8 : i * 8;
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "i32.const", value: i });
				this.pushInstruction({ op: "local.get", index: vTmp });
				if (shift > 0) {
					this.pushInstruction({ op: "i64.const", value: BigInt(shift) });
					this.pushInstruction("i64.shr_u");
				}
				this.pushInstruction("i32.wrap_i64");
				this.pushInstruction({ op: "i32.const", value: 0xff });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
			}
			this.releaseTemp(vTmp, "i64");
		}

		const bufTmp = this.acquireTemp(sliceW);
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "i32.const", value: sz });
		this.pushInstruction({ op: "i32.const", value: sz });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bufTmp });

		const wTmp = this.acquireTemp("anyref");
		this.emitExpr(wExpr, "anyref");
		this.pushInstruction({ op: "local.set", index: wTmp });

		this.pushInstruction({ op: "local.get", index: wTmp });
		this.pushInstruction({ op: "local.get", index: bufTmp });
		const dispatchWriteIdx = this.mod.resolveFuncIndex(
			"__dispatch_io.Writer_Write",
		);
		this.pushInstruction({ op: "call", funcIndex: dispatchWriteIdx });

		const errTmp = this.acquireTemp("anyref");
		this.pushInstruction({ op: "local.set", index: errTmp });
		this.pushInstruction("drop"); // drop n
		this.pushInstruction({ op: "local.get", index: errTmp });

		this.releaseTemp(errTmp, "anyref");
		this.releaseTemp(wTmp, "anyref");
		this.releaseTemp(bufTmp, sliceW);
		this.releaseTemp(arrTmp, arrW);
	}
}
