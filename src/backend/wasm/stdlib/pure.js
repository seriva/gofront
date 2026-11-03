// src/backend/wasm/stdlib/pure.js
// FunctionEmitter mixin: pure utility stdlib packages:
// unicode, crypto/rand.Read.

export class PurePackagesEmitter {
	emitUnicodeCall(name, args, targetWasmType) {
		const rTmp = this.acquireTemp("i32");
		this._emitI32Arg(args[0]);
		this.pushInstruction({ op: "local.set", index: rTmp });

		// Inline ASCII check: 0 <= r < 128
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "i32.const", value: 128 });
		this.pushInstruction("i32.lt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });

		// Inline ASCII fast path
		switch (name) {
			case "IsLetter": {
				// (r - 'A' <= 25) || (r - 'a' <= 25)
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 65 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 25 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 97 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 25 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction("i32.or");
				break;
			}
			case "IsDigit": {
				// r - '0' <= 9
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 48 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 9 });
				this.pushInstruction("i32.le_u");
				break;
			}
			case "IsSpace": {
				// r == 32 || (r >= 9 && r <= 13)
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 32 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 9 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 4 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction("i32.or");
				break;
			}
			case "IsUpper": {
				// r - 'A' <= 25
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 65 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 25 });
				this.pushInstruction("i32.le_u");
				break;
			}
			case "IsLower": {
				// r - 'a' <= 25
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 97 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 25 });
				this.pushInstruction("i32.le_u");
				break;
			}
			case "IsControl": {
				// r <= 31 || r == 127
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 31 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 127 });
				this.pushInstruction("i32.eq");
				this.pushInstruction("i32.or");
				break;
			}
			case "IsPrint":
			case "IsGraphic": {
				// 32 <= r <= 126
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 32 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 94 });
				this.pushInstruction("i32.le_u");
				break;
			}
			case "ToUpper": {
				// if (r >= 'a' && r <= 'z') r - 32 else r
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 97 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 25 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 32 });
				this.pushInstruction("i32.sub");
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction("end");
				break;
			}
			case "ToLower": {
				// if (r >= 'A' && r <= 'Z') r + 32 else r
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 65 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "i32.const", value: 25 });
				this.pushInstruction("i32.le_u");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction({ op: "i32.const", value: 32 });
				this.pushInstruction("i32.add");
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: rTmp });
				this.pushInstruction("end");
				break;
			}
			case "IsPunct": {
				this.pushInstruction({ op: "local.get", index: rTmp });
				this._callStdlib("unicode_is_punct");
				break;
			}
			default:
				throw new Error(`Unsupported unicode function: unicode.${name}`);
		}

		this.pushInstruction("else");

		// Non-ASCII fallback via host JS import
		const hostName = {
			IsLetter: "unicode_is_letter",
			IsDigit: "unicode_is_digit",
			IsSpace: "unicode_is_space",
			IsUpper: "unicode_is_upper",
			IsLower: "unicode_is_lower",
			IsPunct: "unicode_is_punct",
			IsControl: "unicode_is_control",
			IsPrint: "unicode_is_print",
			IsGraphic: "unicode_is_graphic",
			ToUpper: "unicode_to_upper",
			ToLower: "unicode_to_lower",
		}[name];
		this.pushInstruction({ op: "local.get", index: rTmp });
		this._callStdlib(hostName);
		this.pushInstruction("end");

		if (
			(name === "ToUpper" || name === "ToLower") &&
			(targetWasmType ?? "i32") === "i64"
		) {
			this.pushInstruction("i64.extend_i32_s");
		}
		this.releaseTemp(rTmp, "i32");
	}

	// crypto/rand.Read; math/rand is Go source (stdlib/math/rand).
	emitRandCall(name, args, _targetWasmType) {
		if (name !== "Read") {
			throw new Error(`Unsupported rand function: rand.${name}`);
		}
		const sNode = args[0];
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
		this.emitExpr(sNode, sliceW);
		this.pushInstruction({ op: "local.set", index: sTmp });

		const arrTmp = this.acquireTemp(arrW);
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");
		this._emitSliceUnpack(sTmp, sliceInfo, {
			arr: arrTmp,
			off: offTmp,
			len: lenTmp,
		});

		// crypto_rand_fill(len)
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this._callStdlib("crypto_rand_fill");
		this.pushInstruction("drop");

		const iLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// arr[off + i] = raw_bytes_get(i)
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this._callStdlib("raw_bytes_get");

		this.pushInstruction({
			op: "array.set",
			typeIndex: arrInfo.typeIndex,
		});

		// i++
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// return (len, nil)
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction({ op: "ref.null", heapType: "any" });

		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, arrW);
		this.releaseTemp(sTmp, sliceW);
	}
}
