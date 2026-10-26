// src/backend/wasm/emit-maps.js
// FunctionEmitter mixin: map runtime helpers (key hash/eq, get/set/delete,
// iteration, clone) and zero values.

import {
	isArrayType,
	isComplex,
	isComplex64,
	isInterfaceType,
	isPointerToStruct,
	isSigned,
	isStringType,
	toWasmType,
} from "./types.js";

function _complexTypeFor(mod, t) {
	if (!isComplex(t)) return null;
	const is64 = isComplex64(t);
	return mod.getComplexType(is64 ? "complex64" : "complex128");
}

function _resolveStructType(mod, goType) {
	let t = goType;
	while (t && (t.kind === "TypeName" || t.kind === "Ident")) {
		const info = mod.getStructType(t.name);
		if (info) return info;
		const resolved = mod.checker?.types?.get(t.name);
		if (!resolved || resolved === t) break;
		t = resolved;
	}
	if (t?.kind === "named") return mod.getStructType(t.name) ?? null;
	if ((t?.kind === "struct" || t?.kind === "StructType") && t.name)
		return mod.getStructType(t.name) ?? null;
	return null;
}

export class MapsEmitter {
	emitMapHelper(fn) {
		const kind = fn._mapHelperKind;
		const mapInfo = fn._mapInfo;
		switch (kind) {
			case "make":
				this.emitMapMake(mapInfo);
				break;
			case "get":
				this.emitMapGet(mapInfo);
				break;
			case "get_ok":
				this.emitMapGetOk(mapInfo);
				break;
			case "set":
				this.emitMapSet(mapInfo);
				break;
			case "delete":
				this.emitMapDelete(mapInfo);
				break;
			case "len":
				this.emitMapLen(mapInfo);
				break;
			case "clear":
				this.emitMapClear(mapInfo);
				break;
			case "keys":
				this.emitMapKeys(mapInfo);
				break;
			case "values":
				this.emitMapValues(mapInfo);
				break;
			case "clone":
				this.emitMapClone(mapInfo);
				break;
		}
	}

	// Struct info for a Go type used as a map key (named struct, alias, or complex).
	_structInfoForGoType(goType) {
		return (
			_complexTypeFor(this.mod, goType) ?? _resolveStructType(this.mod, goType)
		);
	}

	_unsupportedMapKey(_keyGoType) {
		return null;
	}

	emitKeyHash(keyLocal, keyGoType) {
		if (isStringType(keyGoType, this.mod.checker)) {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringHashImportIndex(),
			});
			return;
		}
		if (isInterfaceType(keyGoType, this.mod.checker)) {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			const hashIdx = this.mod.resolveFuncIndex("__any_hash");
			this.pushInstruction({ op: "call", funcIndex: hashIdx });
			return;
		}
		if (isArrayType(keyGoType, this.mod.checker)) {
			const size = this._getArraySize(keyGoType);
			if (size === 0) {
				this.pushInstruction({ op: "i32.const", value: 17 });
				return;
			}
			const elemGoType = this._getArrayElemType(keyGoType);
			const arrInfo = this.mod.getArrayType(elemGoType);
			const h = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "i32.const", value: 17 });
			this.pushInstruction({ op: "local.set", index: h });

			const idx = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: idx });

			const elemLoc = this.allocLocal(null, arrInfo.elemWType);

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({ op: "i32.const", value: size });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: elemLoc });

			this.pushInstruction({ op: "local.get", index: h });
			this.pushInstruction({ op: "i32.const", value: 31 });
			this.pushInstruction("i32.mul");
			this.emitKeyHash(elemLoc, elemGoType);
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: h });

			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: idx });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: h });
			return;
		}
		const wType = toWasmType(keyGoType, this.mod.checker, this.mod);
		if (wType === "i64") {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({ op: "i64.const", value: 32n });
			this.pushInstruction("i64.shr_u");
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction("i32.xor");
			const tmp = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "local.tee", index: tmp });
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({ op: "i32.const", value: 16 });
			this.pushInstruction("i32.shr_u");
			this.pushInstruction("i32.xor");
			this.pushInstruction({ op: "i32.const", value: 0x45d9f3b });
			this.pushInstruction("i32.mul");
			return;
		}
		if (wType === "i32") {
			const tmp = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({ op: "local.tee", index: tmp });
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({ op: "i32.const", value: 16 });
			this.pushInstruction("i32.shr_u");
			this.pushInstruction("i32.xor");
			this.pushInstruction({ op: "i32.const", value: 0x45d9f3b });
			this.pushInstruction("i32.mul");
			return;
		}
		if (wType === "v128") {
			// Lane-wise like a [4]float32 key: h = 17; h = h*31 + hash(lane).
			const isMask = this._isSimdMaskType(keyGoType);
			const laneType = {
				kind: "basic",
				name: isMask ? "int32" : "float32",
			};
			const h = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "i32.const", value: 17 });
			this.pushInstruction({ op: "local.set", index: h });
			for (let lane = 0; lane < 4; lane++) {
				const lt = this.allocLocal(null, isMask ? "i32" : "f32");
				this.pushInstruction({ op: "local.get", index: keyLocal });
				this.pushInstruction({
					op: isMask ? "i32x4.extract_lane" : "f32x4.extract_lane",
					lane,
				});
				this.pushInstruction({ op: "local.set", index: lt });
				this.pushInstruction({ op: "local.get", index: h });
				this.pushInstruction({ op: "i32.const", value: 31 });
				this.pushInstruction("i32.mul");
				this.emitKeyHash(lt, laneType);
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: h });
			}
			this.pushInstruction({ op: "local.get", index: h });
			return;
		}
		// Floats: `x + 0.0` folds -0 onto +0 (they are equal keys in Go) and
		// NaN elements never match (f32.eq/f64.eq returns false in key comparison).
		if (wType === "f32") {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction("f32.ne");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({ op: "f32.const", value: 0 });
			this.pushInstruction("f32.add");
			this.pushInstruction("i32.reinterpret_f32");
			this.pushInstruction("end");
			return;
		}
		if (wType === "f64") {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction("f64.ne");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({ op: "f64.const", value: 0 });
			this.pushInstruction("f64.add");
			this.pushInstruction("i64.reinterpret_f64");
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction("end");
			return;
		}
		const structInfo = this._structInfoForGoType(keyGoType);
		if (
			structInfo &&
			!isPointerToStruct(keyGoType, this.mod.checker, this.mod)
		) {
			// h = 17; for each field: h = h*31 + hash(field)
			const h = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "i32.const", value: 17 });
			this.pushInstruction({ op: "local.set", index: h });
			for (let i = 0; i < structInfo.fields.length; i++) {
				const f = structInfo.fields[i];
				const ft = this.allocLocal(null, f.wType);
				this.pushInstruction({ op: "local.get", index: keyLocal });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: structInfo.typeIndex,
					fieldIndex: i,
				});
				this.pushInstruction({ op: "local.set", index: ft });
				this.pushInstruction({ op: "local.get", index: h });
				this.pushInstruction({ op: "i32.const", value: 31 });
				this.pushInstruction("i32.mul");
				this.emitKeyHash(ft, f.goType);
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: h });
			}
			this.pushInstruction({ op: "local.get", index: h });
			return;
		}
		const unsupported = this._unsupportedMapKey(keyGoType);
		if (unsupported) throw new Error(unsupported);
		// Pointers/channels: identity equality via ref.eq; no stable hash is
		// available for GC references, so they share a single bucket.
		this.pushInstruction({ op: "i32.const", value: 0 });
	}

	emitKeyEq(k1Local, k2Local, keyGoType) {
		if (isStringType(keyGoType, this.mod.checker)) {
			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: k2Local });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringCmpImportIndex("=="),
			});
			return;
		}
		if (isInterfaceType(keyGoType, this.mod.checker)) {
			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: k2Local });
			this._emitAnyEq();
			return;
		}
		if (isArrayType(keyGoType, this.mod.checker)) {
			const size = this._getArraySize(keyGoType);
			if (size === 0) {
				this.pushInstruction({ op: "i32.const", value: 1 });
				return;
			}
			const elemGoType = this._getArrayElemType(keyGoType);
			const arrInfo = this.mod.getArrayType(elemGoType);

			const idx = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: idx });

			const eqRes = this.allocLocal(null, "i32");
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "local.set", index: eqRes });

			const f1 = this.allocLocal(null, arrInfo.elemWType);
			const f2 = this.allocLocal(null, arrInfo.elemWType);

			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({ op: "i32.const", value: size });
			this.pushInstruction("i32.ge_s");
			this.pushInstruction({ op: "br_if", depth: 1 });

			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: f1 });

			this.pushInstruction({ op: "local.get", index: k2Local });
			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: f2 });

			this.emitKeyEq(f1, f2, elemGoType);
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: eqRes });
			this.pushInstruction({ op: "br", depth: 2 });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: idx });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: idx });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: eqRes });
			return;
		}
		const wType = toWasmType(keyGoType, this.mod.checker, this.mod);
		if (wType === "i64") {
			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: k2Local });
			this.pushInstruction("i64.eq");
			return;
		}
		if (wType === "i32") {
			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: k2Local });
			this.pushInstruction("i32.eq");
			return;
		}
		if (wType === "f32") {
			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: k2Local });
			this.pushInstruction("f32.eq");
			return;
		}
		if (wType === "f64") {
			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: k2Local });
			this.pushInstruction("f64.eq");
			return;
		}
		if (wType === "v128") {
			this.pushInstruction({ op: "local.get", index: k1Local });
			this.pushInstruction({ op: "local.get", index: k2Local });
			this._emitSimdEq(keyGoType);
			return;
		}
		const structInfo = this._structInfoForGoType(keyGoType);
		if (
			structInfo &&
			!isPointerToStruct(keyGoType, this.mod.checker, this.mod)
		) {
			if (structInfo.fields.length === 0) {
				this.pushInstruction({ op: "i32.const", value: 1 });
				return;
			}
			for (let i = 0; i < structInfo.fields.length; i++) {
				const f = structInfo.fields[i];
				const f1 = this.allocLocal(null, f.wType);
				const f2 = this.allocLocal(null, f.wType);
				for (const [src, dst] of [
					[k1Local, f1],
					[k2Local, f2],
				]) {
					this.pushInstruction({ op: "local.get", index: src });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: structInfo.typeIndex,
						fieldIndex: i,
					});
					this.pushInstruction({ op: "local.set", index: dst });
				}
				this.emitKeyEq(f1, f2, f.goType);
				if (i > 0) this.pushInstruction("i32.and");
			}
			return;
		}
		const unsupported = this._unsupportedMapKey(keyGoType);
		if (unsupported) throw new Error(unsupported);
		this.pushInstruction({ op: "local.get", index: k1Local });
		this.pushInstruction({ op: "local.get", index: k2Local });
		this.pushInstruction("ref.eq");
	}

	emitElemLt(v1Loc, v2Loc, elemGoType) {
		if (isStringType(elemGoType, this.mod.checker)) {
			this.pushInstruction({ op: "local.get", index: v1Loc });
			this.pushInstruction({ op: "local.get", index: v2Loc });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringCmpImportIndex("<"),
			});
			return;
		}
		const wType = toWasmType(elemGoType, this.mod.checker, this.mod);
		if (wType === "i64") {
			this.pushInstruction({ op: "local.get", index: v1Loc });
			this.pushInstruction({ op: "local.get", index: v2Loc });
			this.pushInstruction(isSigned(elemGoType) ? "i64.lt_s" : "i64.lt_u");
			return;
		}
		if (wType === "i32") {
			this.pushInstruction({ op: "local.get", index: v1Loc });
			this.pushInstruction({ op: "local.get", index: v2Loc });
			this.pushInstruction(isSigned(elemGoType) ? "i32.lt_s" : "i32.lt_u");
			return;
		}
		if (wType === "f32") {
			this.pushInstruction({ op: "local.get", index: v1Loc });
			this.pushInstruction({ op: "local.get", index: v2Loc });
			this.pushInstruction("f32.lt");
			return;
		}
		if (wType === "f64") {
			this.pushInstruction({ op: "local.get", index: v1Loc });
			this.pushInstruction({ op: "local.get", index: v2Loc });
			this.pushInstruction("f64.lt");
			return;
		}
		this.pushInstruction({ op: "i32.const", value: 0 });
	}

	emitMapMake(mapInfo) {
		const nBucketsLoc = this.allocLocal(null, "i32");
		const cLoc = this.allocLocal(null, "i32");
		const bucketsLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		const entriesLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entriesTypeIndex,
		});

		// nBuckets = 16
		this.pushInstruction({ op: "i32.const", value: 16 });
		this.pushInstruction({ op: "local.set", index: nBucketsLoc });

		// while (nBuckets < cap * 2) { nBuckets <<= 1; }
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: nBucketsLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });
		this.pushInstruction({ op: "local.get", index: nBucketsLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.set", index: nBucketsLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// c = cap > 8 ? cap : 8
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "i32.const", value: 8 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 8 });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: cLoc });

		// buckets = array.new $map_buckets (-1, nBuckets)
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.get", index: nBucketsLoc });
		this.pushInstruction({
			op: "array.new",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bucketsLoc });

		// entries = array.new_default $map_entries (c)
		this.pushInstruction({ op: "local.get", index: cLoc });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entriesLoc });

		// struct.new $map_K_V
		this.pushInstruction({ op: "local.get", index: bucketsLoc });
		this.pushInstruction({ op: "local.get", index: entriesLoc });
		this.pushInstruction({ op: "i32.const", value: 0 }); // len
		this.pushInstruction({ op: "local.get", index: cLoc }); // cap
		this.pushInstruction({ op: "i32.const", value: 0 }); // count
		this.pushInstruction({ op: "i32.const", value: -1 }); // head
		this.pushInstruction({ op: "i32.const", value: -1 }); // tail
		this.pushInstruction({ op: "i32.const", value: -1 }); // free_head
		this.pushInstruction({ op: "local.get", index: nBucketsLoc }); // num_buckets
		this.pushInstruction({ op: "struct.new", typeIndex: mapInfo.typeIndex });
		this.pushInstruction({ op: "return" });
	}

	emitMapGet(mapInfo) {
		const hLoc = this.allocLocal(null, "i32");
		const bLoc = this.allocLocal(null, "i32");
		const idxLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const entryKeyLoc = this.allocLocal(null, mapInfo.keyWType);

		// If m == null -> return zero
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitZeroValue(mapInfo.valGoType, mapInfo.valWType);
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");

		// h = hash(key)
		this.emitKeyHash(1, mapInfo.keyGoType);
		this.pushInstruction({ op: "local.set", index: hLoc });

		// b = h & (m.num_buckets - 1)
		this.pushInstruction({ op: "local.get", index: hLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.set", index: bLoc });

		// idx = m.buckets[b]
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });

		// Loop while idx != -1
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: entryKeyLoc });

		this.emitKeyEq(1, entryKeyLoc, mapInfo.keyGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// Not found
		this.emitZeroValue(mapInfo.valGoType, mapInfo.valWType);
		this.pushInstruction({ op: "return" });
	}

	emitMapGetOk(mapInfo) {
		const hLoc = this.allocLocal(null, "i32");
		const bLoc = this.allocLocal(null, "i32");
		const idxLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const entryKeyLoc = this.allocLocal(null, mapInfo.keyWType);

		// If m == null -> return zero, false
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitZeroValue(mapInfo.valGoType, mapInfo.valWType);
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");

		this.emitKeyHash(1, mapInfo.keyGoType);
		this.pushInstruction({ op: "local.set", index: hLoc });

		this.pushInstruction({ op: "local.get", index: hLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.set", index: bLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: entryKeyLoc });

		this.emitKeyEq(1, entryKeyLoc, mapInfo.keyGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.emitZeroValue(mapInfo.valGoType, mapInfo.valWType);
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "return" });
	}

	emitMapSet(mapInfo) {
		const hLoc = this.allocLocal(null, "i32");
		const bLoc = this.allocLocal(null, "i32");
		const idxLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const newIdxLoc = this.allocLocal(null, "i32");
		const oldTailLoc = this.allocLocal(null, "i32");
		const tempLoc = this.allocLocal(null, "i32");
		const newEntriesLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entriesTypeIndex,
		});
		const newBucketsLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		const currLoc = this.allocLocal(null, "i32");
		const testKeyLoc = this.allocLocal(null, mapInfo.keyWType);

		// 1. Check nil
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic("assignment to entry in nil map");
		this.pushInstruction("end");

		// 2. Hash & bucket
		this.emitKeyHash(1, mapInfo.keyGoType);
		this.pushInstruction({ op: "local.set", index: hLoc });

		this.pushInstruction({ op: "local.get", index: hLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.set", index: bLoc });

		// 3. Search existing key
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: testKeyLoc });

		this.emitKeyEq(1, testKeyLoc, mapInfo.keyGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		// Key exists: update val in place
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({ op: "local.get", index: 2 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// 4. Key not found: insert
		// Check grow entries: count >= cap && free_head == -1
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 3,
		});
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 7,
		});
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 3,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.tee", index: tempLoc });

		this.pushInstruction({
			op: "array.new_default",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newEntriesLoc });

		this.pushInstruction({ op: "local.get", index: newEntriesLoc });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({
			op: "array.copy",
			typeIndexDst: mapInfo.entriesTypeIndex,
			typeIndexSrc: mapInfo.entriesTypeIndex,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: newEntriesLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: tempLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 3,
		});
		this.pushInstruction("end");

		// Check grow buckets: len >= num_buckets
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.shl");
		this.pushInstruction({ op: "local.set", index: tempLoc });

		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.get", index: tempLoc });
		this.pushInstruction({
			op: "array.new",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newBucketsLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: newBucketsLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: tempLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});

		// Rehash active entries: curr = m.head
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: currLoc });

		const rehashKeyLoc = this.allocLocal(null, mapInfo.keyWType);
		const rehashBLoc = this.allocLocal(null, "i32");

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: currLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: currLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: rehashKeyLoc });

		this.emitKeyHash(rehashKeyLoc, mapInfo.keyGoType);
		this.pushInstruction({ op: "local.get", index: tempLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.set", index: rehashBLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({ op: "local.get", index: newBucketsLoc });
		this.pushInstruction({ op: "local.get", index: rehashBLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});

		this.pushInstruction({ op: "local.get", index: newBucketsLoc });
		this.pushInstruction({ op: "local.get", index: rehashBLoc });
		this.pushInstruction({ op: "local.get", index: currLoc });
		this.pushInstruction({
			op: "array.set",
			typeIndex: mapInfo.bucketsTypeIndex,
		});

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: currLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// Recompute bLoc
		this.pushInstruction({ op: "local.get", index: hLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.set", index: bLoc });
		this.pushInstruction("end"); // end if len >= num_buckets

		// Slot index newIdx
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 7,
		});
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		// Pop free list
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 7,
		});
		this.pushInstruction({ op: "local.set", index: newIdxLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: newIdxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: tempLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: tempLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 7,
		});
		this.pushInstruction("else");
		// newIdx = count; count++
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: newIdxLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: newIdxLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction("end");

		// oldTail = m.tail
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 6,
		});
		this.pushInstruction({ op: "local.set", index: oldTailLoc });

		// new_entry = struct.new (key, val, next=buckets[b], order_prev=oldTail, order_next=-1, active=1)
		this.pushInstruction({ op: "local.get", index: 1 });
		this.pushInstruction({ op: "local.get", index: 2 });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({ op: "local.get", index: oldTailLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		// entries[newIdx] = new_entry
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: newIdxLoc });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "array.set",
			typeIndex: mapInfo.entriesTypeIndex,
		});

		// buckets[b] = newIdx
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bLoc });
		this.pushInstruction({ op: "local.get", index: newIdxLoc });
		this.pushInstruction({
			op: "array.set",
			typeIndex: mapInfo.bucketsTypeIndex,
		});

		// Link insertion order
		this.pushInstruction({ op: "local.get", index: oldTailLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: oldTailLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.get", index: newIdxLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: newIdxLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction("end");

		// m.tail = newIdx
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: newIdxLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 6,
		});

		// m.len++
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "return" });
	}

	emitMapDelete(mapInfo) {
		const hLoc = this.allocLocal(null, "i32");
		const bLoc = this.allocLocal(null, "i32");
		const idxLoc = this.allocLocal(null, "i32");
		const prevLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const orderPrevLoc = this.allocLocal(null, "i32");
		const orderNextLoc = this.allocLocal(null, "i32");
		const testKeyLoc = this.allocLocal(null, mapInfo.keyWType);

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");

		this.emitKeyHash(1, mapInfo.keyGoType);
		this.pushInstruction({ op: "local.set", index: hLoc });

		this.pushInstruction({ op: "local.get", index: hLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.and");
		this.pushInstruction({ op: "local.set", index: bLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });

		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: prevLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: testKeyLoc });

		this.emitKeyEq(1, testKeyLoc, mapInfo.keyGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		// Unlink bucket
		this.pushInstruction({ op: "local.get", index: prevLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: prevLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: bLoc });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: mapInfo.bucketsTypeIndex,
		});
		this.pushInstruction("end");

		// Unlink order
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 3,
		});
		this.pushInstruction({ op: "local.set", index: orderPrevLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: orderNextLoc });

		this.pushInstruction({ op: "local.get", index: orderPrevLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: orderPrevLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.get", index: orderNextLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: orderNextLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: orderNextLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: orderNextLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.get", index: orderPrevLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 3,
		});
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: orderPrevLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 6,
		});
		this.pushInstruction("end");

		// Mark inactive & free list
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 7,
		});
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 7,
		});

		// m.len--
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "local.set", index: prevLoc });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.pushInstruction({ op: "return" });
	}

	emitMapLen(mapInfo) {
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("end");
		this.pushInstruction({ op: "return" });
	}

	emitMapClear(mapInfo) {
		const iLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");

		// buckets[i] = -1
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 8,
		});
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({
			op: "array.set",
			typeIndex: mapInfo.bucketsTypeIndex,
		});

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// entries[i].active = 0
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.tee", index: entryLoc });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 6,
		});
		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 7,
		});
		this.pushInstruction({ op: "return" });
	}

	emitMapKeys(mapInfo) {
		const sliceInfo = this.mod.getSliceType(mapInfo.keyGoType);
		const lenLoc = this.allocLocal(null, "i32");
		const arrLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});
		const iLoc = this.allocLocal(null, "i32");
		const idxLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "global.get",
			index: sliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenLoc });

		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: arrLoc });

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: arrLoc });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: arrLoc });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "return" });
	}

	emitMapValues(mapInfo) {
		const sliceInfo = this.mod.getSliceType(mapInfo.valGoType);
		const lenLoc = this.allocLocal(null, "i32");
		const arrLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});
		const iLoc = this.allocLocal(null, "i32");
		const idxLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "global.get",
			index: sliceInfo.emptyGlobalIndex,
		});
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenLoc });

		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: arrLoc });

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: arrLoc });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({
			op: "array.set",
			typeIndex: sliceInfo.arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: arrLoc });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "return" });
	}

	emitMapClone(mapInfo) {
		const dstLoc = this.allocLocal(null, mapInfo.wType);
		const idxLoc = this.allocLocal(null, "i32");
		const entryLoc = this.allocLocal(null, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "ref.null", heapType: mapInfo.typeIndex });
		this.pushInstruction({ op: "return" });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.makeFuncName),
		});
		this.pushInstruction({ op: "local.set", index: dstLoc });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: 0 });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxLoc });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryLoc });

		this.pushInstruction({ op: "local.get", index: dstLoc });
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
		});

		this.pushInstruction({ op: "local.get", index: entryLoc });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: idxLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: dstLoc });
		this.pushInstruction({ op: "return" });
	}
}
