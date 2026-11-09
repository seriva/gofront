// src/backend/wasm/stdlib/core.js
// FunctionEmitter mixin: core stdlib packages implemented natively (maps, slices, strings, strconv, errors, sort, unicode/utf8)
// plus the runtime helper bodies they rely on.

import { typeStr } from "../../../typechecker/types.js";
import { ERROR_STRUCT, isUnhashableGoType, toWasmType } from "../types.js";

// `unicode/utf8` package constants.
const UTF8_CONSTS = {
	RuneError: 0xfffd,
	MaxRune: 0x10ffff,
	UTFMax: 4,
	RuneSelf: 0x80,
};

export class StdlibCoreEmitter {
	_isUtf8Const(expr) {
		return (
			this._isPkgExpr(expr, "utf8") && UTF8_CONSTS[expr.field] !== undefined
		);
	}

	emitUtf8Const(name, targetWasmType) {
		const v = UTF8_CONSTS[name];
		if ((targetWasmType ?? "i32") === "i64") {
			this.pushInstruction({ op: "i64.const", value: BigInt(v) });
		} else {
			this.pushInstruction({ op: "i32.const", value: v });
		}
	}

	emitSliceClear(arg, argType) {
		const elemGoType = this._getSliceElemType(argType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(arg, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		const iLoc = this.acquireTemp("i32");

		this._emitSliceUnpack(sliceTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

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
		this.emitZeroValue(elemGoType, arrInfo.elemWType);
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end");
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	// Pushes an integer-ish argument as i32 (Go ints are i64 in this backend).
	_emitI32Arg(arg) {
		const wType = toWasmType(arg?._type, this.mod.checker);
		if (wType === "i64") {
			this.emitExpr(arg, "i64");
			this.pushInstruction("i32.wrap_i64");
		} else {
			this.emitExpr(arg, "i32");
		}
	}

	// `a == b` for two anyref operands (interface values).  `ref.eq` only
	// accepts eqref, so host strings (internalised externs) are compared via
	// `str_eq` and anything else by identity.
	_emitAnyEq() {
		const idx = this.mod.resolveFuncIndex("__any_eq");
		if (idx === null) {
			throw new Error(
				"internal: anyref equality emitted but __any_eq was not declared (usesAnyEq scan missed a site)",
			);
		}
		this.pushInstruction({ op: "call", funcIndex: idx });
	}

	emitRuntimeHelper(fn) {
		const errInfo = this.mod.getStructType(ERROR_STRUCT);
		switch (fn._isRuntimeHelper) {
			case "any_eq": {
				const bothNull = () => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction("ref.is_null");
					this.pushInstruction({ op: "local.get", index: 1 });
					this.pushInstruction("ref.is_null");
				};
				bothNull();
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("return");
				this.pushInstruction("end");
				bothNull();
				this.pushInstruction("i32.or");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Check unhashable / uncomparable types
				const checkUncomparable = (typeIndex) => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction({ op: "local.get", index: 1 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction("i32.or");
					this.pushInstruction({ op: "if", blockType: "void" });
					this.emitPanic("runtime error: comparing uncomparable type");
					this.pushInstruction("end");
				};
				for (const s of this.mod.sliceTypes.values())
					checkUncomparable(s.typeIndex);
				for (const m of this.mod.mapTypes.values())
					checkUncomparable(m.typeIndex);
				for (const c of this.mod.closureTypes.values())
					checkUncomparable(c.typeIndex);
				for (const b of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(b.goType, this.mod.checker))
						checkUncomparable(b.typeIndex);
				}
				for (const a of this.mod.arrayTypes.values()) {
					if (isUnhashableGoType(a.elemGoType, this.mod.checker))
						checkUncomparable(a.typeIndex);
				}

				// Boxed values compare by value (Go: any(3) == any(3), struct values, etc.).
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker)) continue;
					for (const idx of [0, 1]) {
						this.pushInstruction({ op: "local.get", index: idx });
						this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					}
					this.pushInstruction("i32.and");
					this.pushInstruction({ op: "if", blockType: "void" });
					const f1 = this.allocLocal(null, box.wType);
					const f2 = this.allocLocal(null, box.wType);
					for (const [src, dst] of [
						[0, f1],
						[1, f2],
					]) {
						this.pushInstruction({ op: "local.get", index: src });
						this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
						this.pushInstruction({
							op: "struct.get",
							typeIndex: box.typeIndex,
							fieldIndex: 0,
						});
						this.pushInstruction({ op: "local.set", index: dst });
					}
					this.emitKeyEq(f1, f2, box.goType);
					this.pushInstruction("return");
					this.pushInstruction("end");
				}

				// Strings
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCmpImportIndex("=="),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Heap reference equality
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.test", heapType: "eq" });
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction({ op: "local.get", index: 1 });
				this.pushInstruction({ op: "ref.cast", heapType: "eq" });
				this.pushInstruction("ref.eq");
				this.pushInstruction("return");
				this.pushInstruction("end");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				return;
			}
			case "any_hash": {
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				this.pushInstruction("end");

				// Check unhashable types
				const checkUnhashable = (typeIndex, goType) => {
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					this.emitPanic(
						goType
							? `runtime error: hash of unhashable type ${typeStr(goType)}`
							: "runtime error: hash of unhashable type",
					);
					this.pushInstruction("end");
				};
				// A slice type first built from source syntax (a `TypeName`) names
				// its element as written.
				const spelled = (t) =>
					t?.kind === "TypeName" ? { kind: "basic", name: t.name } : t;
				for (const sliceInfo of this.mod.sliceTypes.values())
					checkUnhashable(sliceInfo.typeIndex, {
						kind: "slice",
						elem: spelled(sliceInfo.elemGoType),
					});
				for (const mapInfo of this.mod.mapTypes.values())
					checkUnhashable(mapInfo.typeIndex, {
						kind: "map",
						key: mapInfo.keyGoType,
						value: mapInfo.valGoType,
					});
				for (const closureInfo of this.mod.closureTypes.values())
					checkUnhashable(closureInfo.typeIndex);
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker))
						checkUnhashable(box.typeIndex);
				}
				for (const arrInfo of this.mod.arrayTypes.values()) {
					if (isUnhashableGoType(arrInfo.elemGoType, this.mod.checker))
						checkUnhashable(arrInfo.typeIndex);
				}

				// Check boxed values (scalars, struct values)
				for (const box of this.mod.ifaceBoxTypes.values()) {
					if (isUnhashableGoType(box.goType, this.mod.checker)) continue;
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
					this.pushInstruction({ op: "if", blockType: "void" });
					const valLoc = this.allocLocal(null, box.wType);
					this.pushInstruction({ op: "local.get", index: 0 });
					this.pushInstruction({ op: "ref.cast", typeIndex: box.typeIndex });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: box.typeIndex,
						fieldIndex: 0,
					});
					this.pushInstruction({ op: "local.set", index: valLoc });
					this.pushInstruction({ op: "i32.const", value: box.typeIndex });
					this.pushInstruction({ op: "i32.const", value: 31 });
					this.pushInstruction("i32.mul");
					this.emitKeyHash(valLoc, box.goType);
					this.pushInstruction("i32.add");
					this.pushInstruction("return");
					this.pushInstruction("end");
				}

				// Check string
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getIsStringImportIndex(),
				});
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("extern.convert_any");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringHashImportIndex(),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");

				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("return");
				return;
			}
			case "error_msg":
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: errInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction("return");
				return;
			case "mk_error":
				// nil message (strconv success) → nil error
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("any.convert_extern");
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction("return");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: errInfo.typeIndex,
				});
				this.pushInstruction("return");
				return;
			case "error_str":
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.pushInstruction({
					op: "i32.const",
					value: this.mod.internString("<nil>"),
				});
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringImportIndex(),
				});
				this.pushInstruction("return");
				this.pushInstruction("end");
				this.pushInstruction({ op: "local.get", index: 0 });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex("__dispatch_error_Error"),
				});
				this.pushInstruction("return");
				return;
			default:
				throw new Error(`Unknown runtime helper: ${fn._isRuntimeHelper}`);
		}
	}
}
