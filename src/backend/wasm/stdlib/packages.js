// src/backend/wasm/stdlib/packages.js
// FunctionEmitter mixin: sync, encoding/binary, crypto/sha256, encoding/hex, encoding/base64.

import { isSliceType, toWasmType } from "../types.js";

const EXT_PKG_CONSTS = {
	sha256: { Size: 32, BlockSize: 64 },
	base64: { StdPadding: 61, NoPadding: -1 },
};
const EXT_PKG_SPECIAL = new Set([
	"hex.ErrLength",
	"base64.StdEncoding",
	"base64.URLEncoding",
	"base64.RawStdEncoding",
	"base64.RawURLEncoding",
	"binary.LittleEndian",
	"binary.BigEndian",
]);

export class ExtendedPackagesEmitter {
	_isExtendedPkgConst(expr) {
		if (!this._isPkgExpr(expr)) return false;
		const pkg = expr.expr.name;
		return (
			EXT_PKG_CONSTS[pkg]?.[expr.field] !== undefined ||
			EXT_PKG_SPECIAL.has(`${pkg}.${expr.field}`)
		);
	}

	emitExtendedPkgConst(expr, targetWasmType) {
		const pkg = expr.expr.name;
		const field = expr.field;
		const scalarVal = EXT_PKG_CONSTS[pkg]?.[field];
		if (scalarVal !== undefined) {
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction({ op: "i64.const", value: BigInt(scalarVal) });
			} else {
				this.pushInstruction({ op: "i32.const", value: scalarVal });
			}
			return;
		}
		if (pkg === "hex" && field === "ErrLength") {
			const strIdx = this.mod.internString(
				"encoding/hex: odd length hex string",
			);
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
			return;
		}
		if (pkg === "base64") {
			const mode =
				field === "URLEncoding"
					? 1
					: field === "RawStdEncoding"
						? 2
						: field === "RawURLEncoding"
							? 3
							: 0;
			const structInfo = this.mod.getStructType("base64.Encoding");
			this.pushInstruction({ op: "i32.const", value: mode });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: structInfo.typeIndex,
			});
			return;
		}
		if (pkg === "binary") {
			const isBig = field === "BigEndian";
			const structInfo = this.mod.getStructType(
				isBig ? "binary.BigEndian" : "binary.LittleEndian",
			);
			this.pushInstruction({ op: "i32.const", value: isBig ? 1 : 0 });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: structInfo.typeIndex,
			});
			return;
		}
	}

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

	emitBinaryCall(name, call, targetWasmType) {
		const args = call.args;
		if (name === "Size") {
			this._emitBinarySize(args[0]);
			return;
		}
		if (
			name === "AppendUint16" ||
			name === "AppendUint32" ||
			name === "AppendUint64"
		) {
			this.emitBinaryOrderMethodCall(
				"binary.LittleEndian",
				name,
				null,
				args,
				targetWasmType,
			);
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

		const isBig =
			orderExpr?._type?.name?.includes("BigEndian") ||
			orderExpr?.field === "BigEndian";

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

		const isBig =
			orderExpr?._type?.name?.includes("BigEndian") ||
			orderExpr?.field === "BigEndian";

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

	emitBinaryOrderMethodCall(
		recvTypeName,
		method,
		recvExpr,
		args,
		targetWasmType,
	) {
		const isBig =
			recvTypeName?.includes("BigEndian") ||
			recvExpr?.field === "BigEndian" ||
			false;

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

		if (method === "String") {
			const strIdx = this.mod.internString(
				isBig ? "BigEndian" : "LittleEndian",
			);
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			return;
		}

		if (method === "Uint16") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, {
				arr: arrTmp,
				off: offTmp,
				len: lenTmp,
			});

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

			if (isBig) {
				// (b0 << 8) | b1
				this.pushInstruction({ op: "local.set", index: lenTmp }); // b1
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shl"); // b0 << 8
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction("i32.or");
			} else {
				// b0 | (b1 << 8)
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shl");
				this.pushInstruction("i32.or");
			}

			if ((targetWasmType ?? "i32") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (method === "Uint32") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, { arr: arrTmp, off: offTmp });

			const bTmps = [];
			for (let i = 0; i < 4; i++) {
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				if (i > 0) {
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction("i32.add");
				}
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				const bt = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.set", index: bt });
				bTmps.push(bt);
			}

			this.pushInstruction({ op: "i32.const", value: 0 });
			for (let i = 0; i < 4; i++) {
				const shift = isBig ? (3 - i) * 8 : i * 8;
				this.pushInstruction({ op: "local.get", index: bTmps[i] });
				if (shift > 0) {
					this.pushInstruction({ op: "i32.const", value: shift });
					this.pushInstruction("i32.shl");
				}
				this.pushInstruction("i32.or");
			}
			for (const bt of bTmps) this.releaseTemp(bt, "i32");

			if ((targetWasmType ?? "i32") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (method === "Uint64") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, { arr: arrTmp, off: offTmp });

			const bTmps = [];
			for (let i = 0; i < 8; i++) {
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				if (i > 0) {
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction("i32.add");
				}
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
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

			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (method === "PutUint16") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const vTmp = this.acquireTemp("i32");
			this.emitExpr(args[1], "i32");
			this.pushInstruction({ op: "local.set", index: vTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, { arr: arrTmp, off: offTmp });

			// b[0]
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: vTmp });
			if (isBig) {
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shr_u");
			}
			this.pushInstruction({ op: "i32.const", value: 0xff });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

			// b[1]
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: vTmp });
			if (!isBig) {
				this.pushInstruction({ op: "i32.const", value: 8 });
				this.pushInstruction("i32.shr_u");
			}
			this.pushInstruction({ op: "i32.const", value: 0xff });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(vTmp, "i32");
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (method === "PutUint32") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const vTmp = this.acquireTemp("i32");
			this.emitExpr(args[1], "i32");
			this.pushInstruction({ op: "local.set", index: vTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, { arr: arrTmp, off: offTmp });

			for (let i = 0; i < 4; i++) {
				const shift = isBig ? (3 - i) * 8 : i * 8;
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				if (i > 0) {
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction("i32.add");
				}
				this.pushInstruction({ op: "local.get", index: vTmp });
				if (shift > 0) {
					this.pushInstruction({ op: "i32.const", value: shift });
					this.pushInstruction("i32.shr_u");
				}
				this.pushInstruction({ op: "i32.const", value: 0xff });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
			}

			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(vTmp, "i32");
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (method === "PutUint64") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const vTmp = this.acquireTemp("i64");
			this.emitExpr(args[1], "i64");
			this.pushInstruction({ op: "local.set", index: vTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, { arr: arrTmp, off: offTmp });

			for (let i = 0; i < 8; i++) {
				const shift = isBig ? (7 - i) * 8 : i * 8;
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: offTmp });
				if (i > 0) {
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction("i32.add");
				}
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

			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(vTmp, "i64");
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (
			method === "AppendUint16" ||
			method === "AppendUint32" ||
			method === "AppendUint64"
		) {
			const byteCount =
				method === "AppendUint16" ? 2 : method === "AppendUint32" ? 4 : 8;
			const sNode = args[0];
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(sNode, sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

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

			const newArrTmp = this.acquireTemp(arrW);
			const newOffTmp = this.acquireTemp("i32");
			const newCapTmp = this.acquireTemp("i32");
			const newLenTmp = this.acquireTemp("i32");

			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "i32.const", value: byteCount });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: newLenTmp });

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

			if (byteCount === 2) {
				const vTmp = this.acquireTemp("i32");
				this.emitExpr(args[1], "i32");
				this.pushInstruction({ op: "local.set", index: vTmp });

				for (let i = 0; i < 2; i++) {
					const shift = isBig ? (1 - i) * 8 : i * 8;
					this.pushInstruction({ op: "local.get", index: newArrTmp });
					this.pushInstruction({ op: "local.get", index: newOffTmp });
					this.pushInstruction({ op: "local.get", index: oldLenTmp });
					this.pushInstruction("i32.add");
					if (i > 0) {
						this.pushInstruction({ op: "i32.const", value: i });
						this.pushInstruction("i32.add");
					}
					this.pushInstruction({ op: "local.get", index: vTmp });
					if (shift > 0) {
						this.pushInstruction({ op: "i32.const", value: shift });
						this.pushInstruction("i32.shr_u");
					}
					this.pushInstruction({ op: "i32.const", value: 0xff });
					this.pushInstruction("i32.and");
					this.pushInstruction({
						op: "array.set",
						typeIndex: arrInfo.typeIndex,
					});
				}
				this.releaseTemp(vTmp, "i32");
			} else if (byteCount === 4) {
				const vTmp = this.acquireTemp("i32");
				this.emitExpr(args[1], "i32");
				this.pushInstruction({ op: "local.set", index: vTmp });

				for (let i = 0; i < 4; i++) {
					const shift = isBig ? (3 - i) * 8 : i * 8;
					this.pushInstruction({ op: "local.get", index: newArrTmp });
					this.pushInstruction({ op: "local.get", index: newOffTmp });
					this.pushInstruction({ op: "local.get", index: oldLenTmp });
					this.pushInstruction("i32.add");
					if (i > 0) {
						this.pushInstruction({ op: "i32.const", value: i });
						this.pushInstruction("i32.add");
					}
					this.pushInstruction({ op: "local.get", index: vTmp });
					if (shift > 0) {
						this.pushInstruction({ op: "i32.const", value: shift });
						this.pushInstruction("i32.shr_u");
					}
					this.pushInstruction({ op: "i32.const", value: 0xff });
					this.pushInstruction("i32.and");
					this.pushInstruction({
						op: "array.set",
						typeIndex: arrInfo.typeIndex,
					});
				}
				this.releaseTemp(vTmp, "i32");
			} else {
				const vTmp = this.acquireTemp("i64");
				this.emitExpr(args[1], "i64");
				this.pushInstruction({ op: "local.set", index: vTmp });

				for (let i = 0; i < 8; i++) {
					const shift = isBig ? (7 - i) * 8 : i * 8;
					this.pushInstruction({ op: "local.get", index: newArrTmp });
					this.pushInstruction({ op: "local.get", index: newOffTmp });
					this.pushInstruction({ op: "local.get", index: oldLenTmp });
					this.pushInstruction("i32.add");
					if (i > 0) {
						this.pushInstruction({ op: "i32.const", value: i });
						this.pushInstruction("i32.add");
					}
					this.pushInstruction({ op: "local.get", index: vTmp });
					if (shift > 0) {
						this.pushInstruction({ op: "i64.const", value: BigInt(shift) });
						this.pushInstruction("i64.shr_u");
					}
					this.pushInstruction("i32.wrap_i64");
					this.pushInstruction({ op: "i32.const", value: 0xff });
					this.pushInstruction("i32.and");
					this.pushInstruction({
						op: "array.set",
						typeIndex: arrInfo.typeIndex,
					});
				}
				this.releaseTemp(vTmp, "i64");
			}

			this.pushInstruction({ op: "local.get", index: newArrTmp });
			this.pushInstruction({ op: "local.get", index: newOffTmp });
			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});

			this.releaseTemp(newCapTmp, "i32");
			this.releaseTemp(newLenTmp, "i32");
			this.releaseTemp(newOffTmp, "i32");
			this.releaseTemp(newArrTmp, arrW);
			this.releaseTemp(oldCapTmp, "i32");
			this.releaseTemp(oldLenTmp, "i32");
			this.releaseTemp(oldOffTmp, "i32");
			this.releaseTemp(oldArrTmp, arrW);
			return;
		}

		throw new Error(`Unsupported binary method: ${method}`);
	}

	emitSha256Call(name, call, _targetWasmType) {
		const args = call.args;
		if (name === "Sum256") {
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

			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, {
				arr: arrTmp,
				off: offTmp,
				len: lenTmp,
			});

			// raw_bytes_init(len)
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this._callStdlib("raw_bytes_init");

			const iLoc = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			// raw_bytes_push(arr[off + i])
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
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

			// crypto_sha256_sum()
			this._callStdlib("crypto_sha256_sum");
			this.pushInstruction("drop"); // 32

			// allocate [32]byte array
			const arr32Info = this.mod.getArrayType(byteGo);
			const outArrTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: arr32Info.typeIndex,
			});
			this.pushInstruction({ op: "i32.const", value: 32 });
			this.pushInstruction({
				op: "array.new_default",
				typeIndex: arr32Info.typeIndex,
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
			this.pushInstruction({ op: "array.set", typeIndex: arr32Info.typeIndex });

			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iLoc });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: outArrTmp });

			this.releaseTemp(outArrTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: arr32Info.typeIndex,
			});
			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (name === "New") {
			const structInfo = this.mod.getStructType("sha256.digest");
			const byteGo = { kind: "basic", name: "byte" };
			const sliceInfo = this.mod.getSliceType(byteGo);
			const arrInfo = sliceInfo.arrInfo;

			this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			this.pushInstruction({
				op: "struct.new",
				typeIndex: structInfo.typeIndex,
			});
			return;
		}

		throw new Error(`Unsupported sha256 call: sha256.${name}`);
	}

	emitHexCall(name, call, _targetWasmType) {
		const args = call.args;
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

		if (name === "EncodedLen") {
			this.emitExpr(args[0], "i64");
			this.pushInstruction({ op: "i64.const", value: 2n });
			this.pushInstruction("i64.mul");
			return;
		}

		if (name === "DecodedLen") {
			this.emitExpr(args[0], "i64");
			this.pushInstruction({ op: "i64.const", value: 2n });
			this.pushInstruction("i64.div_s");
			return;
		}

		if (name === "EncodeToString") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, {
				arr: arrTmp,
				off: offTmp,
				len: lenTmp,
			});

			this.pushInstruction({ op: "local.get", index: lenTmp });
			this._callStdlib("raw_bytes_init");

			const iLoc = this.acquireTemp("i32");
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
			this._callStdlib("raw_bytes_push");

			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iLoc });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this._callStdlib("hex_encode_to_string");

			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(sTmp, sliceW);
			return;
		}

		if (name === "DecodeString") {
			this.emitExpr(args[0], "externref");
			this._callStdlib("hex_decode_string");
			const nTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: nTmp });

			this._callStdlib("hex_get_err");
			const errStrTmp = this.acquireTemp("externref");
			this.pushInstruction({ op: "local.set", index: errStrTmp });

			const retSliceTmp = this.acquireTemp(sliceW);
			const retErrTmp = this.acquireTemp("anyref");

			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });

			// Error case: return nil slice, err
			this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: retSliceTmp });

			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__mk_error"),
			});
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.pushInstruction("else");

			// Success case: allocate slice and copy bytes
			const outArrTmp = this.acquireTemp(arrW);
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({
				op: "array.new_default",
				typeIndex: arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: outArrTmp });

			const iLoc = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: nTmp });
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

			this.pushInstruction({ op: "local.get", index: outArrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: retSliceTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(outArrTmp, arrW);
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: retSliceTmp });
			this.pushInstruction({ op: "local.get", index: retErrTmp });

			this.releaseTemp(retSliceTmp, sliceW);
			this.releaseTemp(retErrTmp, "anyref");
			this.releaseTemp(errStrTmp, "externref");
			this.releaseTemp(nTmp, "i32");
			return;
		}

		if (name === "Encode") {
			const dstTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: dstTmp });

			const srcTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[1], sliceW);
			this.pushInstruction({ op: "local.set", index: srcTmp });

			const srcArr = this.acquireTemp(arrW);
			const srcOff = this.acquireTemp("i32");
			const srcLen = this.acquireTemp("i32");
			this._emitSliceUnpack(srcTmp, sliceInfo, {
				arr: srcArr,
				off: srcOff,
				len: srcLen,
			});

			this.pushInstruction({ op: "local.get", index: srcLen });
			this._callStdlib("raw_bytes_init");

			const iLoc = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: srcLen });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: srcArr });
			this.pushInstruction({ op: "local.get", index: srcOff });
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

			this._callStdlib("hex_encode_to_string");
			const strTmp = this.acquireTemp("externref");
			this.pushInstruction({ op: "local.set", index: strTmp });

			const dstArr = this.acquireTemp(arrW);
			const dstOff = this.acquireTemp("i32");
			const dstLen = this.acquireTemp("i32");
			this._emitSliceUnpack(dstTmp, sliceInfo, {
				arr: dstArr,
				off: dstOff,
				len: dstLen,
			});

			const hexLenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: hexLenTmp });

			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: hexLenTmp });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: dstArr });
			this.pushInstruction({ op: "local.get", index: dstOff });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringCodePointAtImportIndex(),
			});
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iLoc });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: hexLenTmp });
			this.pushInstruction("i64.extend_i32_s");

			this.releaseTemp(hexLenTmp, "i32");
			this.releaseTemp(dstLen, "i32");
			this.releaseTemp(dstOff, "i32");
			this.releaseTemp(dstArr, arrW);
			this.releaseTemp(strTmp, "externref");
			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(srcLen, "i32");
			this.releaseTemp(srcOff, "i32");
			this.releaseTemp(srcArr, arrW);
			this.releaseTemp(srcTmp, sliceW);
			this.releaseTemp(dstTmp, sliceW);
			return;
		}

		if (name === "Decode") {
			const dstTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: dstTmp });

			const srcTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[1], sliceW);
			this.pushInstruction({ op: "local.set", index: srcTmp });

			const srcArr = this.acquireTemp(arrW);
			const srcOff = this.acquireTemp("i32");
			const srcLen = this.acquireTemp("i32");
			this._emitSliceUnpack(srcTmp, sliceInfo, {
				arr: srcArr,
				off: srcOff,
				len: srcLen,
			});

			this.pushInstruction({ op: "local.get", index: srcLen });
			this._callStdlib("bytes_to_str_init");

			const iLoc = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: srcLen });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: srcArr });
			this.pushInstruction({ op: "local.get", index: srcOff });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this._callStdlib("bytes_to_str_push");

			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iLoc });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this._callStdlib("bytes_to_str_finish");
			this._callStdlib("hex_decode_string");
			const nTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: nTmp });

			this._callStdlib("hex_get_err");
			const errStrTmp = this.acquireTemp("externref");
			this.pushInstruction({ op: "local.set", index: errStrTmp });

			const retNTmp = this.acquireTemp("i64");
			const retErrTmp = this.acquireTemp("anyref");

			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });

			// Error case
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "local.set", index: retNTmp });
			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__mk_error"),
			});
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.pushInstruction("else");

			// Success case: copy bytes into dst
			const dstArr = this.acquireTemp(arrW);
			const dstOff = this.acquireTemp("i32");
			const dstLen = this.acquireTemp("i32");
			this._emitSliceUnpack(dstTmp, sliceInfo, {
				arr: dstArr,
				off: dstOff,
				len: dstLen,
			});

			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: dstArr });
			this.pushInstruction({ op: "local.get", index: dstOff });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction("i32.add");
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

			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction("i64.extend_i32_s");
			this.pushInstruction({ op: "local.set", index: retNTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.releaseTemp(dstLen, "i32");
			this.releaseTemp(dstOff, "i32");
			this.releaseTemp(dstArr, arrW);
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: retNTmp });
			this.pushInstruction({ op: "local.get", index: retErrTmp });

			this.releaseTemp(retErrTmp, "anyref");
			this.releaseTemp(retNTmp, "i64");
			this.releaseTemp(errStrTmp, "externref");
			this.releaseTemp(nTmp, "i32");
			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(srcLen, "i32");
			this.releaseTemp(srcOff, "i32");
			this.releaseTemp(srcArr, arrW);
			this.releaseTemp(srcTmp, sliceW);
			this.releaseTemp(dstTmp, sliceW);
			return;
		}

		throw new Error(`Unsupported hex call: hex.${name}`);
	}

	emitBase64Call(name, call, _targetWasmType) {
		if (name === "NewEncoding") {
			const structInfo = this.mod.getStructType("base64.Encoding");
			this.emitExpr(call.args[0], "externref");
			this._callStdlib("base64_new_encoding");
			this.pushInstruction({
				op: "struct.new",
				typeIndex: structInfo.typeIndex,
			});
			return;
		}
		throw new Error(`Unsupported base64 call: base64.${name}`);
	}

	emitBase64EncodingMethodCall(method, recvExpr, args, _targetWasmType) {
		const structInfo = this.mod.getStructType("base64.Encoding");
		const encW = {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		};
		const modeTmp = this.acquireTemp("i32");

		if (recvExpr?.field === "URLEncoding") {
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: modeTmp });
		} else if (recvExpr?.field === "RawStdEncoding") {
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction({ op: "local.set", index: modeTmp });
		} else if (recvExpr?.field === "RawURLEncoding") {
			this.pushInstruction({ op: "i32.const", value: 3 });
			this.pushInstruction({ op: "local.set", index: modeTmp });
		} else if (recvExpr?.field === "StdEncoding") {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: modeTmp });
		} else {
			const eTmp = this.acquireTemp(encW);
			this.emitExpr(recvExpr, encW);
			this.pushInstruction({ op: "local.tee", index: eTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: modeTmp });
			this.releaseTemp(eTmp, encW);
		}

		if (method === "EncodedLen") {
			const nTmp = this.acquireTemp("i64");
			this.emitExpr(args[0], "i64");
			this.pushInstruction({ op: "local.set", index: nTmp });

			this.pushInstruction({ op: "local.get", index: modeTmp });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "if", blockType: "i64" });
			// (n * 8 + 5) / 6
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({ op: "i64.const", value: 8n });
			this.pushInstruction("i64.mul");
			this.pushInstruction({ op: "i64.const", value: 5n });
			this.pushInstruction("i64.add");
			this.pushInstruction({ op: "i64.const", value: 6n });
			this.pushInstruction("i64.div_s");
			this.pushInstruction("else");
			// (n + 2) / 3 * 4
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({ op: "i64.const", value: 2n });
			this.pushInstruction("i64.add");
			this.pushInstruction({ op: "i64.const", value: 3n });
			this.pushInstruction("i64.div_s");
			this.pushInstruction({ op: "i64.const", value: 4n });
			this.pushInstruction("i64.mul");
			this.pushInstruction("end");

			this.releaseTemp(nTmp, "i64");
			this.releaseTemp(modeTmp, "i32");
			return;
		}

		if (method === "DecodedLen") {
			this.emitExpr(args[0], "i64");
			this.pushInstruction({ op: "i64.const", value: 3n });
			this.pushInstruction("i64.mul");
			this.pushInstruction({ op: "i64.const", value: 4n });
			this.pushInstruction("i64.div_s");
			this.releaseTemp(modeTmp, "i32");
			return;
		}

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

		if (method === "EncodeToString") {
			const sTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: sTmp });

			const arrTmp = this.acquireTemp(arrW);
			const offTmp = this.acquireTemp("i32");
			const lenTmp = this.acquireTemp("i32");
			this._emitSliceUnpack(sTmp, sliceInfo, {
				arr: arrTmp,
				off: offTmp,
				len: lenTmp,
			});

			this.pushInstruction({ op: "local.get", index: lenTmp });
			this._callStdlib("raw_bytes_init");

			const iLoc = this.acquireTemp("i32");
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
			this._callStdlib("raw_bytes_push");

			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iLoc });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: modeTmp });
			this._callStdlib("base64_encode_to_string");

			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(offTmp, "i32");
			this.releaseTemp(arrTmp, arrW);
			this.releaseTemp(sTmp, sliceW);
			this.releaseTemp(modeTmp, "i32");
			return;
		}

		if (method === "DecodeString") {
			this.pushInstruction({ op: "local.get", index: modeTmp });
			this.emitExpr(args[0], "externref");
			this._callStdlib("base64_decode_string");
			const nTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: nTmp });

			this._callStdlib("base64_get_err");
			const errStrTmp = this.acquireTemp("externref");
			this.pushInstruction({ op: "local.set", index: errStrTmp });

			const retSliceTmp = this.acquireTemp(sliceW);
			const retErrTmp = this.acquireTemp("anyref");

			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });

			// Error case
			this.pushInstruction({ op: "ref.null", heapType: arrInfo.typeIndex });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: retSliceTmp });

			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__mk_error"),
			});
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.pushInstruction("else");

			// Success case
			const outArrTmp = this.acquireTemp(arrW);
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({
				op: "array.new_default",
				typeIndex: arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: outArrTmp });

			const iLoc = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: nTmp });
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

			this.pushInstruction({ op: "local.get", index: outArrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: retSliceTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(outArrTmp, arrW);
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: retSliceTmp });
			this.pushInstruction({ op: "local.get", index: retErrTmp });

			this.releaseTemp(retSliceTmp, sliceW);
			this.releaseTemp(retErrTmp, "anyref");
			this.releaseTemp(errStrTmp, "externref");
			this.releaseTemp(nTmp, "i32");
			this.releaseTemp(modeTmp, "i32");
			return;
		}

		if (method === "Encode") {
			const dstTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: dstTmp });

			const srcTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[1], sliceW);
			this.pushInstruction({ op: "local.set", index: srcTmp });

			const srcArr = this.acquireTemp(arrW);
			const srcOff = this.acquireTemp("i32");
			const srcLen = this.acquireTemp("i32");
			this._emitSliceUnpack(srcTmp, sliceInfo, {
				arr: srcArr,
				off: srcOff,
				len: srcLen,
			});

			this.pushInstruction({ op: "local.get", index: srcLen });
			this._callStdlib("raw_bytes_init");

			const iLoc = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: srcLen });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: srcArr });
			this.pushInstruction({ op: "local.get", index: srcOff });
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

			this.pushInstruction({ op: "local.get", index: modeTmp });
			this._callStdlib("base64_encode_to_string");
			const strTmp = this.acquireTemp("externref");
			this.pushInstruction({ op: "local.set", index: strTmp });

			const dstArr = this.acquireTemp(arrW);
			const dstOff = this.acquireTemp("i32");
			const dstLen = this.acquireTemp("i32");
			this._emitSliceUnpack(dstTmp, sliceInfo, {
				arr: dstArr,
				off: dstOff,
				len: dstLen,
			});

			const b64LenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: b64LenTmp });

			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: b64LenTmp });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: dstArr });
			this.pushInstruction({ op: "local.get", index: dstOff });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringCodePointAtImportIndex(),
			});
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iLoc });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this.releaseTemp(b64LenTmp, "i32");
			this.releaseTemp(dstLen, "i32");
			this.releaseTemp(dstOff, "i32");
			this.releaseTemp(dstArr, arrW);
			this.releaseTemp(strTmp, "externref");
			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(srcLen, "i32");
			this.releaseTemp(srcOff, "i32");
			this.releaseTemp(srcArr, arrW);
			this.releaseTemp(srcTmp, sliceW);
			this.releaseTemp(dstTmp, sliceW);
			this.releaseTemp(modeTmp, "i32");
			return;
		}

		if (method === "Decode") {
			const dstTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[0], sliceW);
			this.pushInstruction({ op: "local.set", index: dstTmp });

			const srcTmp = this.acquireTemp(sliceW);
			this.emitExpr(args[1], sliceW);
			this.pushInstruction({ op: "local.set", index: srcTmp });

			const srcArr = this.acquireTemp(arrW);
			const srcOff = this.acquireTemp("i32");
			const srcLen = this.acquireTemp("i32");
			this._emitSliceUnpack(srcTmp, sliceInfo, {
				arr: srcArr,
				off: srcOff,
				len: srcLen,
			});

			this.pushInstruction({ op: "local.get", index: srcLen });
			this._callStdlib("bytes_to_str_init");

			const iLoc = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: srcLen });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: srcArr });
			this.pushInstruction({ op: "local.get", index: srcOff });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			this._callStdlib("bytes_to_str_push");

			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: iLoc });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this._callStdlib("bytes_to_str_finish");
			const srcStrTmp = this.acquireTemp("externref");
			this.pushInstruction({ op: "local.set", index: srcStrTmp });

			this.pushInstruction({ op: "local.get", index: modeTmp });
			this.pushInstruction({ op: "local.get", index: srcStrTmp });
			this._callStdlib("base64_decode_string");
			const nTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: nTmp });

			this._callStdlib("base64_get_err");
			const errStrTmp = this.acquireTemp("externref");
			this.pushInstruction({ op: "local.set", index: errStrTmp });

			const retNTmp = this.acquireTemp("i64");
			const retErrTmp = this.acquireTemp("anyref");

			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });

			// Error case
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "local.set", index: retNTmp });
			this.pushInstruction({ op: "local.get", index: errStrTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex("__mk_error"),
			});
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.pushInstruction("else");

			// Success case: copy bytes into dst
			const dstArr = this.acquireTemp(arrW);
			const dstOff = this.acquireTemp("i32");
			const dstLen = this.acquireTemp("i32");
			this._emitSliceUnpack(dstTmp, sliceInfo, {
				arr: dstArr,
				off: dstOff,
				len: dstLen,
			});

			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: iLoc });

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: dstArr });
			this.pushInstruction({ op: "local.get", index: dstOff });
			this.pushInstruction({ op: "local.get", index: iLoc });
			this.pushInstruction("i32.add");
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

			this.pushInstruction({ op: "local.get", index: nTmp });
			this.pushInstruction("i64.extend_i32_s");
			this.pushInstruction({ op: "local.set", index: retNTmp });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({ op: "local.set", index: retErrTmp });

			this.releaseTemp(dstLen, "i32");
			this.releaseTemp(dstOff, "i32");
			this.releaseTemp(dstArr, arrW);
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: retNTmp });
			this.pushInstruction({ op: "local.get", index: retErrTmp });

			this.releaseTemp(retErrTmp, "anyref");
			this.releaseTemp(retNTmp, "i64");
			this.releaseTemp(errStrTmp, "externref");
			this.releaseTemp(nTmp, "i32");
			this.releaseTemp(srcStrTmp, "externref");
			this.releaseTemp(iLoc, "i32");
			this.releaseTemp(srcLen, "i32");
			this.releaseTemp(srcOff, "i32");
			this.releaseTemp(srcArr, arrW);
			this.releaseTemp(srcTmp, sliceW);
			this.releaseTemp(dstTmp, sliceW);
			this.releaseTemp(modeTmp, "i32");
			return;
		}

		if (method === "WithPadding") {
			const padTmp = this.acquireTemp("i64");
			this.emitExpr(args[0], "i64");
			this.pushInstruction({ op: "local.set", index: padTmp });

			const newModeTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: padTmp });
			this.pushInstruction({ op: "i64.const", value: -1n });
			this.pushInstruction("i64.eq");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: modeTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.set", index: newModeTmp });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: modeTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.and");
			this.pushInstruction({ op: "local.set", index: newModeTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: newModeTmp });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: structInfo.typeIndex,
			});

			this.releaseTemp(newModeTmp, "i32");
			this.releaseTemp(padTmp, "i64");
			this.releaseTemp(modeTmp, "i32");
			return;
		}

		throw new Error(`Unsupported base64 method: ${method}`);
	}
}
