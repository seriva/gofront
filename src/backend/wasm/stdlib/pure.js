// src/backend/wasm/stdlib/pure.js
// FunctionEmitter mixin: pure utility stdlib packages:
// unicode, math/rand, html, path/filepath.

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

	emitRandCall(name, args, targetWasmType) {
		const randIdx = this.mod.getMathRandomImportIndex();
		switch (name) {
			case "Float64":
				this.pushInstruction({ op: "call", funcIndex: randIdx });
				return;
			case "Float32":
				this.pushInstruction({ op: "call", funcIndex: randIdx });
				this.pushInstruction("f32.demote_f64");
				return;
			case "Int":
			case "Int31": {
				this.pushInstruction({ op: "call", funcIndex: randIdx });
				this.pushInstruction({ op: "f64.const", value: 2147483647.0 });
				this.pushInstruction("f64.mul");
				if (targetWasmType === "i32") {
					this.pushInstruction("i32.trunc_f64_s");
				} else {
					this.pushInstruction("i64.trunc_f64_s");
				}
				return;
			}
			case "Int63": {
				this.pushInstruction({ op: "call", funcIndex: randIdx });
				this.pushInstruction({ op: "f64.const", value: 9007199254740991.0 });
				this.pushInstruction("f64.mul");
				if (targetWasmType === "i32") {
					this.pushInstruction("i32.trunc_f64_s");
				} else {
					this.pushInstruction("i64.trunc_f64_s");
				}
				return;
			}
			case "Intn":
			case "Int31n":
			case "Int63n": {
				const nTmp = this.acquireTemp("i64");
				this.emitExpr(args[0], "i64");
				this.pushInstruction({ op: "local.set", index: nTmp });

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.le_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic(`invalid argument to ${name}`);
				this.pushInstruction("end");

				this.pushInstruction({ op: "call", funcIndex: randIdx });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction("f64.convert_i64_s");
				this.pushInstruction("f64.mul");
				if (targetWasmType === "i32") {
					this.pushInstruction("i32.trunc_f64_s");
				} else {
					this.pushInstruction("i64.trunc_f64_s");
				}
				this.releaseTemp(nTmp, "i64");
				return;
			}
			case "Seed": {
				this.emitExpr(args[0]);
				this.pushInstruction("drop");
				return;
			}
			case "Shuffle": {
				const closureInfo = this.mod.getClosureType(
					this._resolveExprGoType(args[1]),
				);
				const closureW = {
					kind: "ref",
					nullable: true,
					typeIndex: closureInfo.typeIndex,
				};
				const nTmp = this.acquireTemp("i32");
				const clTmp = this.acquireTemp(closureW);
				const iTmp = this.acquireTemp("i32");
				const jTmp = this.acquireTemp("i32");

				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: nTmp });

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("invalid argument to Shuffle");
				this.pushInstruction("end");

				this.emitExpr(args[1], closureW);
				this.pushInstruction({ op: "local.set", index: clTmp });

				// i = n - 1
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.le_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				// j = floor(random() * (i + 1))
				this.pushInstruction({ op: "call", funcIndex: randIdx });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction("f64.convert_i32_s");
				this.pushInstruction("f64.mul");
				this.pushInstruction("i32.trunc_f64_s");
				this.pushInstruction({ op: "local.set", index: jTmp });

				// swap(i, j)
				this.pushInstruction({ op: "local.get", index: clTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: closureInfo.typeIndex,
					fieldIndex: 1,
				});
				for (const loc of [iTmp, jTmp]) {
					this.pushInstruction({ op: "local.get", index: loc });
					if (closureInfo.paramWTypes[0] === "i64")
						this.pushInstruction("i64.extend_i32_s");
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

				// i--
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				this.releaseTemp(jTmp, "i32");
				this.releaseTemp(iTmp, "i32");
				this.releaseTemp(clTmp, closureW);
				this.releaseTemp(nTmp, "i32");
				return;
			}
			case "Perm": {
				const elemGo = { kind: "basic", name: "int" };
				const sliceInfo = this.mod.getSliceType(elemGo);
				const arrInfo = sliceInfo.arrInfo;
				const arrW = {
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				};

				const nTmp = this.acquireTemp("i32");
				const arrTmp = this.acquireTemp(arrW);
				const iTmp = this.acquireTemp("i32");
				const jTmp = this.acquireTemp("i32");
				const valITmp = this.acquireTemp("i64");
				const valJTmp = this.acquireTemp("i64");

				this._emitI32Arg(args[0]);
				this.pushInstruction({ op: "local.set", index: nTmp });

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("invalid argument to Perm");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: arrTmp });

				// initialize arr[i] = i
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction("i64.extend_i32_s");
				this.pushInstruction({
					op: "array.set",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				// shuffle: for i = n - 1 down to 1
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.le_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "call", funcIndex: randIdx });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.add");
				this.pushInstruction("f64.convert_i32_s");
				this.pushInstruction("f64.mul");
				this.pushInstruction("i32.trunc_f64_s");
				this.pushInstruction({ op: "local.set", index: jTmp });

				// swap arr[i], arr[j]
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: valITmp });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: jTmp });
				this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.set", index: valJTmp });

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: valJTmp });
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: jTmp });
				this.pushInstruction({ op: "local.get", index: valITmp });
				this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction("i32.sub");
				this.pushInstruction({ op: "local.set", index: iTmp });
				this.pushInstruction({ op: "br", depth: 0 });
				this.pushInstruction("end");
				this.pushInstruction("end");

				// wrap in slice struct
				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({ op: "local.get", index: nTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});

				this.releaseTemp(valJTmp, "i64");
				this.releaseTemp(valITmp, "i64");
				this.releaseTemp(jTmp, "i32");
				this.releaseTemp(iTmp, "i32");
				this.releaseTemp(arrTmp, arrW);
				this.releaseTemp(nTmp, "i32");
				return;
			}
			default:
				throw new Error(`Unsupported rand function: rand.${name}`);
		}
	}

	emitHtmlCall(name, args) {
		this.emitExpr(args[0], "externref");
		if (name === "EscapeString") {
			this._callStdlib("html_escape");
		} else if (name === "UnescapeString") {
			this._callStdlib("html_unescape");
		} else {
			throw new Error(`Unsupported html function: html.${name}`);
		}
	}

	emitPathCall(name, args) {
		switch (name) {
			case "Base":
				this.emitExpr(args[0], "externref");
				this._callStdlib("path_base");
				return;
			case "Dir":
				this.emitExpr(args[0], "externref");
				this._callStdlib("path_dir");
				return;
			case "Ext":
				this.emitExpr(args[0], "externref");
				this._callStdlib("path_ext");
				return;
			case "Clean":
				this.emitExpr(args[0], "externref");
				this._callStdlib("path_clean");
				return;
			case "IsAbs":
				this.emitExpr(args[0], "externref");
				this._callStdlib("path_is_abs");
				return;
			case "Join": {
				this._callStdlib("path_join_init");
				for (const a of args) {
					const isSpread =
						a._spread ||
						(args.length === 1 && this._resolveExprGoType(a)?.kind === "slice");
					if (isSpread) {
						const elemGo = { kind: "basic", name: "string" };
						const sliceInfo = this.mod.getSliceType(elemGo);
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
						this.emitExpr(a, sliceW);
						this.pushInstruction({ op: "local.set", index: sTmp });

						const arrTmp = this.acquireTemp(arrW);
						const offTmp = this.acquireTemp("i32");
						const lenTmp = this.acquireTemp("i32");
						this._emitSliceUnpack(sTmp, sliceInfo, {
							arr: arrTmp,
							off: offTmp,
							len: lenTmp,
						});
						this.releaseTemp(sTmp, sliceW);

						const iTmp = this.acquireTemp("i32");
						this.pushInstruction({ op: "i32.const", value: 0 });
						this.pushInstruction({ op: "local.set", index: iTmp });

						this.pushInstruction({ op: "block", blockType: "void" });
						this.pushInstruction({ op: "loop", blockType: "void" });
						this.pushInstruction({ op: "local.get", index: iTmp });
						this.pushInstruction({ op: "local.get", index: lenTmp });
						this.pushInstruction("i32.ge_s");
						this.pushInstruction({ op: "br_if", depth: 1 });

						this.pushInstruction({ op: "local.get", index: arrTmp });
						this.pushInstruction({ op: "local.get", index: offTmp });
						this.pushInstruction({ op: "local.get", index: iTmp });
						this.pushInstruction("i32.add");
						this.pushInstruction({
							op: "array.get",
							typeIndex: arrInfo.typeIndex,
						});
						this._callStdlib("path_join_push");

						this.pushInstruction({ op: "local.get", index: iTmp });
						this.pushInstruction({ op: "i32.const", value: 1 });
						this.pushInstruction("i32.add");
						this.pushInstruction({ op: "local.set", index: iTmp });
						this.pushInstruction({ op: "br", depth: 0 });
						this.pushInstruction("end");
						this.pushInstruction("end");

						this.releaseTemp(iTmp, "i32");
						this.releaseTemp(lenTmp, "i32");
						this.releaseTemp(offTmp, "i32");
						this.releaseTemp(arrTmp, arrW);
					} else {
						this.emitExpr(a, "externref");
						this._callStdlib("path_join_push");
					}
				}
				this._callStdlib("path_join_run");
				return;
			}
			case "Split":
				this.emitExpr(args[0], "externref");
				this._callStdlib("path_split");
				this._callStdlib("path_split_dir");
				this._callStdlib("path_split_file");
				return;
			case "Match": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				const matchedTmp = this.acquireTemp("i32");
				this._callStdlib("path_match");
				this.pushInstruction({ op: "local.set", index: matchedTmp });

				this._callStdlib("path_match_has_err");
				this.pushInstruction({ op: "if", blockType: "anyref" });
				this.emitPathConst("ErrBadPattern");
				this.pushInstruction("else");
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction("end");
				const errTmp = this.acquireTemp("anyref");
				this.pushInstruction({ op: "local.set", index: errTmp });

				this.pushInstruction({ op: "local.get", index: matchedTmp });
				this.pushInstruction({ op: "local.get", index: errTmp });
				this.releaseTemp(errTmp, "anyref");
				this.releaseTemp(matchedTmp, "i32");
				return;
			}
			default:
				throw new Error(`Unsupported path function: path.${name}`);
		}
	}
}
