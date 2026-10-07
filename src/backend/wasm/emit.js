// src/backend/wasm/emit.js
// AST statements and expressions -> WebAssembly instructions.

import { hasDefer } from "../../lower/functions.js";
import { isIntRangeType, isRangeFor } from "../../lower/range.js";
import {
	getMapKeyValTypes,
	isAnyType,
	isArrayType,
	isFuncType,
	isInterfaceType,
	isMapType,
	isNonEmptyInterface,
	isPointerToStruct,
	isSigned,
	isSliceType,
	isStringType,
	isStructType,
	isTestingT,
	toWasmType,
} from "./types.js";

// Go `math` package constants; BigInt entries are integer-typed.  Float
// literals are the shortest decimal that round-trips to Go's float64 value.
const MATH_CONSTS = {
	E: Math.E,
	Pi: Math.PI,
	Phi: 1.618033988749895,
	Sqrt2: Math.SQRT2,
	SqrtE: 1.6487212707001282,
	SqrtPi: 1.7724538509055159,
	SqrtPhi: 1.272019649514069,
	Ln2: Math.LN2,
	Log2E: Math.LOG2E,
	Ln10: Math.LN10,
	Log10E: Math.LOG10E,
	MaxFloat32: 3.4028234663852886e38,
	SmallestNonzeroFloat32: 1.401298464324817e-45,
	MaxFloat64: Number.MAX_VALUE,
	SmallestNonzeroFloat64: Number.MIN_VALUE,
	MaxInt: 9223372036854775807n,
	MinInt: -9223372036854775808n,
	MaxInt8: 127n,
	MinInt8: -128n,
	MaxInt16: 32767n,
	MinInt16: -32768n,
	MaxInt32: 2147483647n,
	MinInt32: -2147483648n,
	MaxInt64: 9223372036854775807n,
	MinInt64: -9223372036854775808n,
	MaxUint8: 255n,
	MaxUint16: 65535n,
	MaxUint32: 4294967295n,
	MaxUint: 18446744073709551615n,
	MaxUint64: 18446744073709551615n,
};

export class FunctionEmitter {
	constructor(moduleEmitter, funcDecl, funcIndex) {
		this.mod = moduleEmitter;
		this.funcDecl = funcDecl;
		this.funcIndex = funcIndex;

		this.rootFuncDecl = this.funcDecl._rootFuncDecl ?? this.funcDecl;
		// Methods are normalized into synthetic FuncDecls; lower() keyed on the original MethodDecl.
		this.captureAnalysis =
			this.mod.lowerResult?.captures?.get(
				this.rootFuncDecl._sourceDecl ?? this.rootFuncDecl,
			) ?? null;
		this.mutatedCaptures = this.captureAnalysis?.mutatedCaptures ?? new Set();

		this.capturedNames = this.funcDecl._funcLit
			? Array.from(
					this.captureAnalysis?.capturesByClosure?.get(
						this.funcDecl._funcLit,
					) ?? [],
				).sort()
			: [];

		this.locals = new Map(); // name -> { index, type, goType, isParam, isBoxed, boxInfo }
		this.cachedGlobals = new Map(); // globalName -> { index, globalInfo }
		this.localTypes = []; // list of additional local types (beyond params)
		this.controlStack = []; // stack of { type: 'block'|'loop', label: string }
		this.body = []; // emitted instructions

		this.tempCounter = 0;

		this.returnTypes = [];
		if (this.funcDecl.returnType) {
			if (
				this.funcDecl.returnType.kind === "TupleType" ||
				this.funcDecl.returnType.kind === "tuple"
			) {
				for (const t of this.funcDecl.returnType.types) {
					const wt = this.toWasmType(t);
					if (wt) this.returnTypes.push(wt);
				}
			} else {
				const wt = this.toWasmType(this.funcDecl.returnType);
				if (wt) this.returnTypes.push(wt);
			}
		}

		this._initParams();

		this.hasDefer = false;
		this.namedReturnVars = null;
		this.returnTempLocals = null;
		this.defersLocalIndex = null;
		this.panicExnLocalIndex = null;
		this.hasPanicLocalIndex = null;
		this.curClosureLocalIndex = null;
	}

	emitFunctionBody(body) {
		if (
			this.funcDecl._isClosure &&
			!this.funcDecl._isTrampoline &&
			this.capturedNames.length > 0
		) {
			this._unpackClosureEnv();
		}

		this._boxMutatedParams();

		this._cacheScratchGlobals();

		const hasDef = hasDefer(body);
		this.hasDefer = hasDef;

		if (hasDef) {
			this._emitFunctionBodyWithDefer(body);
			return;
		}

		const namedReturns = this.funcDecl.returnType?._namedReturns;
		if (namedReturns && namedReturns.length > 0) {
			this.namedReturnVars = [];
			for (let i = 0; i < namedReturns.length; i++) {
				const r = namedReturns[i];
				const isBlank = !r.name || r.name === "_";
				const varName = isBlank ? `__ret_blank$${i}` : r.name;
				const wType = this.toWasmType(r.type);
				const localIdx = this.allocLocal(varName, wType, r.type, isBlank);
				this.namedReturnVars.push({
					name: varName,
					localIdx,
					type: wType,
					goType: r.type,
					isBlank,
				});
				this.emitZeroValue(r.type, wType);
				const localInfo = this.locals.get(varName);
				if (localInfo?.isBoxed) {
					this.pushInstruction({
						op: "struct.new",
						typeIndex: localInfo.boxInfo.typeIndex,
					});
				}
				this.pushInstruction({ op: "local.set", index: localIdx });
			}
		}

		const needsOobBlock = this._needsOobBlock(body);
		if (needsOobBlock) {
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("oob");
		}

		this.emitBlock(body);

		if (needsOobBlock) {
			const lastOp = this.body[this.body.length - 1]?.op;
			if (lastOp !== "return" && lastOp !== "unreachable") {
				if (this.returnTypes.length === 0) {
					this.pushInstruction({ op: "return" });
				} else {
					this.pushInstruction({ op: "unreachable" });
				}
			}
			this.pushInstruction("end");

			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getBoundsPanicFuncIndex(),
			});
			this.pushInstruction("unreachable");
		}
	}

	_emitFunctionBodyWithDefer(body) {
		const namedReturns = this.funcDecl.returnType?._namedReturns;
		if (namedReturns && namedReturns.length > 0) {
			this.namedReturnVars = [];
			for (let i = 0; i < namedReturns.length; i++) {
				const r = namedReturns[i];
				const isBlank = !r.name || r.name === "_";
				const varName = isBlank ? `__ret_blank$${i}` : r.name;
				const wType = this.toWasmType(r.type);
				const localIdx = this.allocLocal(varName, wType, r.type, isBlank);
				this.namedReturnVars.push({
					name: varName,
					localIdx,
					type: wType,
					goType: r.type,
					isBlank,
				});
				this.emitZeroValue(r.type, wType);
				const localInfo = this.locals.get(varName);
				if (localInfo?.isBoxed) {
					this.pushInstruction({
						op: "struct.new",
						typeIndex: localInfo.boxInfo.typeIndex,
					});
				}
				this.pushInstruction({ op: "local.set", index: localIdx });
			}
		} else if (this.returnTypes.length > 0) {
			this.returnTempLocals = [];
			for (let i = 0; i < this.returnTypes.length; i++) {
				const wType = this.returnTypes[i];
				const localIdx = this.allocLocal(`__ret$${i}`, wType, null, true);
				this.returnTempLocals.push(localIdx);
				this.emitZeroValue(null, wType);
				this.pushInstruction({ op: "local.set", index: localIdx });
			}
		}

		const deferNodeTypeIndex = this.mod.getDeferNodeTypeIndex();
		const deferClosureSig = { kind: "Signature", params: [], results: [] };
		const deferClosureInfo = this.mod.getClosureType(deferClosureSig);

		this.defersLocalIndex = this.allocLocal(
			"__defers",
			{ kind: "ref", nullable: true, typeIndex: deferNodeTypeIndex },
			null,
			true,
		);
		this.pushInstruction({ op: "ref.null", typeIndex: deferNodeTypeIndex });
		this.pushInstruction({ op: "local.set", index: this.defersLocalIndex });

		this.panicExnLocalIndex = this.allocLocal(
			"__panicExn",
			"exnref",
			null,
			true,
		);

		this.hasPanicLocalIndex = this.allocLocal("__hasPanic", "i32", null, true);
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: this.hasPanicLocalIndex });

		this.curClosureLocalIndex = this.allocLocal(
			"__curClosure",
			{ kind: "ref", nullable: true, typeIndex: deferClosureInfo.typeIndex },
			null,
			true,
		);

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("runDefers");

		this.pushInstruction({ op: "block", blockType: "exnref" });
		this.pushControl("catchHandler");

		this.pushInstruction({
			op: "try_table",
			blockType: "void",
			catches: [{ kind: "catch_all_ref", label: 0 }],
		});
		this.pushControl("try_table");

		const needsOobBlock = this._needsOobBlock(body);
		if (needsOobBlock) {
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("oob");
		}

		this.emitBlock(body);

		if (needsOobBlock) {
			const lastOp = this.body[this.body.length - 1]?.op;
			if (lastOp !== "return" && lastOp !== "unreachable") {
				this.pushInstruction({
					op: "br",
					depth: this.resolveBranchDepthToRole("runDefers"),
				});
			}
			this.pushInstruction("end");

			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getBoundsPanicFuncIndex(),
			});
			this.pushInstruction("unreachable");
		}

		// Close try_table
		this.pushInstruction("end");

		// If execution reached end of try_table without return, jump to runDefers
		this.pushInstruction({
			op: "br",
			depth: this.resolveBranchDepthToRole("runDefers"),
		});

		// Close catchHandler
		this.pushInstruction("end"); // stack has exnref!

		// Catch handler body:
		this.pushInstruction({ op: "local.set", index: this.panicExnLocalIndex });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: this.hasPanicLocalIndex });

		// Close runDefers block
		this.pushInstruction("end");

		// Run defers loop
		this.emitRunDefers();

		// Check if unrecovered panic
		this.emitCheckUnrecoveredPanic();

		// Return values
		if (this.namedReturnVars?.length > 0) {
			for (const nr of this.namedReturnVars) {
				const loc = this.locals.get(nr.name);
				if (loc.isBoxed) {
					this.pushInstruction({ op: "local.get", index: loc.index });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: loc.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: loc.index });
				}
			}
			this.pushInstruction("return");
		} else if (this.returnTempLocals?.length > 0) {
			for (const retLoc of this.returnTempLocals) {
				this.pushInstruction({ op: "local.get", index: retLoc });
			}
			this.pushInstruction("return");
		} else {
			this.pushInstruction("return");
		}
	}

	emitRunDefers() {
		const deferNodeTypeIndex = this.mod.getDeferNodeTypeIndex();
		const deferClosureSig = { kind: "Signature", params: [], results: [] };
		const deferClosureInfo = this.mod.getClosureType(deferClosureSig);

		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushControl("deferLoop");
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("exitDefers");

		// If defers is null -> break out of loop
		this.pushInstruction({ op: "local.get", index: this.defersLocalIndex });
		this.pushInstruction({ op: "ref.is_null" });
		this.pushInstruction({ op: "br_if", depth: 0 }); // break to exitDefers

		// curClosure = defers.fn (field 0)
		this.pushInstruction({ op: "local.get", index: this.defersLocalIndex });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: deferNodeTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: this.curClosureLocalIndex });

		// defers = defers.next (field 1)
		this.pushInstruction({ op: "local.get", index: this.defersLocalIndex });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: deferNodeTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: this.defersLocalIndex });

		// Call curClosure: curClosure.fn(curClosure.env)
		this.pushInstruction({ op: "local.get", index: this.curClosureLocalIndex });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: deferClosureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: this.curClosureLocalIndex });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: deferClosureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: deferClosureInfo.funcTypeIndex,
		});

		// Continue loop (br 1 = deferLoop)
		this.pushInstruction({ op: "br", depth: 1 });

		this.pushInstruction("end");
		this.pushInstruction("end");
	}

	emitCheckUnrecoveredPanic() {
		const panicNodeTypeIndex = this.mod.getPanicNodeTypeIndex();
		const panicGlobal = this.mod.getPanicGlobalIndex();

		// if (hasPanic)
		this.pushInstruction({ op: "local.get", index: this.hasPanicLocalIndex });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifHasPanic");

		// if (__panic != null)
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({ op: "ref.is_null" });
		this.pushInstruction({ op: "i32.eqz" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifHasNode");

		// if (__panic.recovered == 1)
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 1, // recovered
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "i32.eq" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifRecovered");

		// Pop recovered node: __panic = __panic.prev
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 2, // prev
		});
		this.pushInstruction({ op: "global.set", index: panicGlobal });

		this.pushInstruction("else");

		// Still unrecovered! Rethrow!
		this.pushInstruction({ op: "local.get", index: this.panicExnLocalIndex });
		this.pushInstruction({ op: "throw_ref" });

		this.pushInstruction("end"); // ifRecovered

		this.pushInstruction("else");

		// __panic is null but hasPanic was 1 (e.g. unhandled host exception)
		this.pushInstruction({ op: "local.get", index: this.panicExnLocalIndex });
		this.pushInstruction({ op: "throw_ref" });

		this.pushInstruction("end"); // ifHasNode

		this.pushInstruction("end"); // ifHasPanic
	}

	emitDeferStmt(stmt) {
		const funcLit = stmt.call.func;
		this.emitFuncLit(funcLit);
		// Stack has closure struct: (ref $deferClosure)
		this.pushInstruction({ op: "local.get", index: this.defersLocalIndex });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: this.mod.getDeferNodeTypeIndex(),
		});
		this.pushInstruction({ op: "local.set", index: this.defersLocalIndex });
	}

	_cacheScratchGlobals() {
		if (this.funcDecl._isTrampoline) return;
		const byFunc = this.mod.lowerResult?.cachedGlobalsByFunc;
		const names =
			byFunc?.get(this.rootFuncDecl) ??
			byFunc?.get(this.rootFuncDecl._sourceDecl) ??
			[];
		// The list is per root function and covers nested closures; each body
		// only pays for the globals it reads itself.
		for (const name of names) {
			if (!this._bodyReadsIdent(this.funcDecl.body, name)) continue;
			const globalInfo = this.mod.resolveGlobal(name);
			if (!globalInfo) continue;

			const localIdx = this.allocLocal(
				`__cache$${name}`,
				globalInfo.type,
				globalInfo.goType,
				true,
			);
			this.cachedGlobals.set(name, { index: localIdx, globalInfo });
			this.pushInstruction({ op: "global.get", index: globalInfo.index });
			this.pushInstruction({ op: "local.set", index: localIdx });
		}
	}

	// Like _findIdentInAST but stops at FuncLit boundaries (closures are emitted
	// as separate functions with their own entry).
	_bodyReadsIdent(node, name) {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) {
			return node.some((item) => this._bodyReadsIdent(item, name));
		}
		if (node.kind === "FuncLit") return false;
		if (node.kind === "Ident") return node.name === name;
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (this._bodyReadsIdent(node[key], name)) return true;
		}
		return false;
	}

	_needsOobBlock(node) {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) {
			return node.some((item) => this._needsOobBlock(item));
		}
		if (node.kind === "FuncLit") return false;
		if (node.kind === "IndexExpr") {
			const baseGoType = node.expr?._type ?? this._resolveExprGoType(node.expr);
			if (
				baseGoType &&
				(baseGoType.kind === "map" || baseGoType.name === "map")
			) {
				return false;
			}
			return true;
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (this._needsOobBlock(node[key])) return true;
		}
		return false;
	}

	_findCapturedVarGoType(name) {
		for (const p of this.rootFuncDecl.params ?? []) {
			if (p.name === name) return p.type;
		}
		if (this.rootFuncDecl.recvName === name) {
			return this.rootFuncDecl.recvType;
		}
		for (const r of this.rootFuncDecl.returnType?._namedReturns ?? []) {
			if (r.name === name) return r.type;
		}
		const found = this._findGoTypeInAST(this.rootFuncDecl.body, name);
		if (found) return found;
		const global = this.mod.resolveGlobal(name);
		if (global?.goType) return global.goType;
		return { kind: "basic", name: "int" };
	}

	_findGoTypeInAST(node, varName) {
		if (!node || typeof node !== "object") return null;
		if (Array.isArray(node)) {
			for (const item of node) {
				const t = this._findGoTypeInAST(item, varName);
				if (t) return t;
			}
			return null;
		}
		if (node.kind === "VarDecl" || node.kind === "ConstDecl") {
			for (const spec of node.decls ?? node.specs ?? [node]) {
				const names = spec.names ?? (spec.name ? [spec.name] : []);
				const idx = names.indexOf(varName);
				if (idx !== -1) {
					if (spec.type) return spec.type;
					if (spec.value?.[idx]?._type) return spec.value[idx]._type;
					if (spec.init?.[idx]?._type) return spec.init[idx]._type;
				}
			}
		}
		if (node.kind === "DefineStmt") {
			const lhs = node.lhs ?? [];
			for (let i = 0; i < lhs.length; i++) {
				if (lhs[i].name === varName) {
					if (lhs[i]._type) return lhs[i]._type;
					if (node.rhs?.[i]?._type) return node.rhs[i]._type;
				}
			}
		}
		if (node.kind === "Ident" && node.name === varName && node._type) {
			return node._type;
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			const t = this._findGoTypeInAST(node[key], varName);
			if (t) return t;
		}
		return null;
	}

	_unpackClosureEnv() {
		const envFields = [];
		for (const name of this.capturedNames) {
			const isBoxed = this.mutatedCaptures.has(name);
			const goType = this._findCapturedVarGoType(name);
			if (isBoxed) {
				const boxInfo = this.mod.getBoxType(goType);
				envFields.push({
					name,
					goType,
					isBoxed: true,
					boxInfo,
					wType: {
						kind: "ref",
						nullable: true,
						typeIndex: boxInfo.typeIndex,
					},
				});
			} else {
				const wType = this.toWasmType(goType);
				envFields.push({
					name,
					goType,
					isBoxed: false,
					boxInfo: null,
					wType,
				});
			}
		}

		const envInfo = this.mod.getEnvType(envFields);
		this.envInfo = envInfo;
		this.envFields = envFields;

		const envCastTmp = this.allocLocal(
			null,
			{
				kind: "ref",
				nullable: true,
				typeIndex: envInfo.typeIndex,
			},
			null,
			true,
		);

		this.pushInstruction({ op: "local.get", index: 0 }); // __env
		this.pushInstruction({
			op: "ref.cast_null",
			typeIndex: envInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: envCastTmp });

		for (let i = 0; i < envFields.length; i++) {
			const f = envFields[i];
			const locIdx = this.allocLocal(f.name, f.wType, f.goType, true);
			this.pushInstruction({ op: "local.get", index: envCastTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: envInfo.typeIndex,
				fieldIndex: i,
			});
			this.pushInstruction({ op: "local.set", index: locIdx });

			this.locals.set(f.name, {
				index: locIdx,
				type: f.wType,
				goType: f.goType,
				isParam: false,
				isBoxed: f.isBoxed,
				boxInfo: f.boxInfo,
			});
		}
	}

	_boxMutatedParams() {
		for (const param of this.funcDecl.params ?? []) {
			if (
				param.name &&
				param.name !== "_" &&
				param.name !== "__env" &&
				this.mutatedCaptures.has(param.name)
			) {
				const pInfo = this.locals.get(param.name);
				if (!pInfo || pInfo.isBoxed) continue;
				const boxInfo = this.mod.getBoxType(pInfo.goType);
				const boxWType = {
					kind: "ref",
					nullable: true,
					typeIndex: boxInfo.typeIndex,
				};
				const boxLocalIdx = this.allocLocal(null, boxWType, pInfo.goType, true);

				this.pushInstruction({ op: "local.get", index: pInfo.index });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: boxInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: boxLocalIdx });

				this.locals.set(param.name, {
					index: boxLocalIdx,
					type: boxWType,
					goType: pInfo.goType,
					isParam: false,
					isBoxed: true,
					boxInfo,
				});
			}
		}
	}

	toWasmType(t) {
		return toWasmType(t, this.mod.checker, this.mod);
	}

	_initParams() {
		for (const param of this.funcDecl.params ?? []) {
			const wType = this.toWasmType(param.type);
			const idx = this.locals.size;
			this.locals.set(param.name, {
				index: idx,
				type: wType,
				goType: param.type,
				isParam: true,
				isBoxed: false,
			});
		}
	}

	allocLocal(name, wasmType, goType = null, forceRaw = false) {
		const isMutatedCapture =
			!forceRaw &&
			Boolean(name && name !== "_" && this.mutatedCaptures.has(name));
		let finalWasmType = wasmType;
		let boxInfo = null;

		if (isMutatedCapture) {
			boxInfo = this.mod.getBoxType(goType ?? { kind: "basic", name: "int" });
			finalWasmType = {
				kind: "ref",
				nullable: true,
				typeIndex: boxInfo.typeIndex,
			};
		}

		const idx = (this.funcDecl.params?.length ?? 0) + this.localTypes.length;
		this.localTypes.push(finalWasmType);
		if (name && name !== "_") {
			this.locals.set(name, {
				index: idx,
				type: finalWasmType,
				goType,
				isParam: false,
				isBoxed: isMutatedCapture,
				boxInfo,
			});
		}
		return idx;
	}

	// `pkg.Name` where `pkg` is a linked local package -> `Name` (the module is
	// flat, like the JS bundle). Returns a replacement Ident or null.
	_dequalify(expr) {
		if (
			expr?.kind === "SelectorExpr" &&
			expr.expr?.kind === "Ident" &&
			this.mod.bundledPackages?.has(expr.expr.name) &&
			!this.resolveLocal(expr.expr.name) &&
			!this.mod.resolveGlobal(expr.expr.name)
		) {
			return {
				kind: "Ident",
				name: expr.field,
				_type: expr._type,
				_line: expr._line,
				_col: expr._col,
			};
		}
		return null;
	}

	_resolveStructInfo(expr) {
		if (!expr) return null;
		let t = expr._type;
		if (!t && expr.kind === "Ident") {
			const local = this.resolveLocal(expr.name);
			if (local) t = local.goType;
			if (!t && this.cachedGlobals.has(expr.name)) {
				t = this.cachedGlobals.get(expr.name).globalInfo.goType;
			}
			if (!t) {
				const global = this.mod.resolveGlobal(expr.name);
				if (global) t = global.goType;
			}
		}
		if (!t) return null;
		while (
			t.kind === "pointer" ||
			t.kind === "PointerType" ||
			t.kind === "StarExpr"
		) {
			t = t.base ?? t.expr ?? t.operand;
		}
		const name = t.name ?? (t.kind === "named" ? t.name : null);
		if (name && this.mod.structTypes.has(name)) {
			return this.mod.structTypes.get(name);
		}
		if (t.kind === "TypeName" || t.kind === "Ident") {
			if (this.mod.structTypes.has(t.name))
				return this.mod.structTypes.get(t.name);
		}
		return null;
	}

	_resolveFieldPath(structInfo, fieldName) {
		if (!structInfo) return null;
		if (structInfo.fieldIndexMap.has(fieldName)) {
			const idx = structInfo.fieldIndexMap.get(fieldName);
			return [{ structInfo, fieldIndex: idx, field: structInfo.fields[idx] }];
		}
		for (const embed of structInfo.embeds) {
			const embedInfo = this.mod.structTypes.get(embed.name);
			if (embedInfo) {
				const sub = this._resolveFieldPath(embedInfo, fieldName);
				if (sub) {
					return [
						{
							structInfo,
							fieldIndex: embed.fieldIndex,
							field: structInfo.fields[embed.fieldIndex],
						},
						...sub,
					];
				}
			}
		}
		return null;
	}

	emitCloneStruct(structInfo, baseWType) {
		const tmp = this.acquireTemp(baseWType);
		this.pushInstruction({ op: "local.set", index: tmp });
		for (let i = 0; i < structInfo.fields.length; i++) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: i,
			});
		}
		this.pushInstruction({
			op: "struct.new",
			typeIndex: structInfo.typeIndex,
		});
		this.releaseTemp(tmp, baseWType);
	}

	_getReceiverTypeName(recvType, node = null) {
		if (recvType) {
			let t = recvType;
			while (t.kind === "pointer") t = t.base;
			if (t.name) return t.name;
			if (t.kind === "named") return t.name;
			if (t.kind === "TypeName" || t.kind === "Ident") return t.name;
		}
		if (node && node.kind === "Ident") {
			const loc = this.resolveLocal(node.name);
			if (loc?.goType) {
				return this._getReceiverTypeName(loc.goType);
			}
		}
		return null;
	}

	emitInterfaceDispatcher(fn) {
		const candidates = this.mod.findInterfaceCandidates(
			fn._ifaceType,
			fn._methodName,
		);
		const recvLocal = 0; // __recv is local 0

		// 1. Nil check
		this.pushInstruction({ op: "local.get", index: recvLocal });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(
			"runtime error: invalid memory address or nil pointer dereference",
		);
		this.pushInstruction("end");

		// 2. Iterate candidates
		for (const cand of candidates) {
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: recvLocal });
			this.pushInstruction({ op: "ref.test", typeIndex: cand.testTypeIndex });
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "br_if", depth: 0 });

			// Matched! Cast receiver
			this.pushInstruction({ op: "local.get", index: recvLocal });
			this.pushInstruction({
				op: "ref.cast_null",
				typeIndex: cand.testTypeIndex,
			});

			if (cand.isBoxedValue) {
				this.pushInstruction({
					op: "struct.get",
					typeIndex: cand.testTypeIndex,
					fieldIndex: 0,
				});
				if (cand.embedPath) {
					for (const step of cand.embedPath) {
						this.pushInstruction({
							op: "struct.get",
							typeIndex: step.parentTypeIndex,
							fieldIndex: step.fieldIndex,
						});
					}
				}
			} else {
				if (cand.embedPath) {
					for (const step of cand.embedPath) {
						this.pushInstruction({
							op: "struct.get",
							typeIndex: step.parentTypeIndex,
							fieldIndex: step.fieldIndex,
						});
					}
				}
				if (cand.needsValueDeref && cand.structInfo) {
					this.emitCloneStruct(cand.structInfo, cand.targetRecvWType);
				}
			}

			// Push method arguments: __arg0 (local 1), __arg1 (local 2), ...
			for (let p = 1; p < fn.params.length; p++) {
				this.pushInstruction({ op: "local.get", index: p });
			}

			this.pushInstruction({ op: "call", funcIndex: cand.funcIndex });
			this.pushInstruction("return");
			this.pushInstruction("end");
		}

		this.emitPanic(
			"interface conversion: nil or unmatched type for method call",
		);
	}

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

	emitKeyHash(keyLocal, keyGoType) {
		if (isStringType(keyGoType, this.mod.checker)) {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringHashImportIndex(),
			});
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
		if (wType === "f32") {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction("i32.reinterpret_f32");
			return;
		}
		if (wType === "f64") {
			this.pushInstruction({ op: "local.get", index: keyLocal });
			this.pushInstruction("i64.reinterpret_f64");
			this.pushInstruction("i32.wrap_i64");
			return;
		}
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
			this.pushInstruction("i64.lt_s");
			return;
		}
		if (wType === "i32") {
			this.pushInstruction({ op: "local.get", index: v1Loc });
			this.pushInstruction({ op: "local.get", index: v2Loc });
			this.pushInstruction("i32.lt_s");
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

	_getArraySize(t, defaultSize = 0) {
		if (!t) return defaultSize;
		if (typeof t.size === "number") return t.size;
		if (t.size?.value !== undefined) return Number(t.size.value);
		if (typeof t.len === "number") return t.len;
		if (t.len?.value !== undefined) return Number(t.len.value);
		if (t.underlying) return this._getArraySize(t.underlying, defaultSize);
		return defaultSize;
	}

	emitZeroValue(goType, wType) {
		if (wType === "i32") {
			this.pushInstruction({ op: "i32.const", value: 0 });
		} else if (wType === "i64") {
			this.pushInstruction({ op: "i64.const", value: 0n });
		} else if (wType === "f32") {
			this.pushInstruction({ op: "f32.const", value: 0.0 });
		} else if (wType === "f64") {
			this.pushInstruction({ op: "f64.const", value: 0.0 });
		} else if (
			typeof wType === "object" &&
			wType !== null &&
			wType.kind === "ref"
		) {
			if (
				goType &&
				goType.kind !== "pointer" &&
				isStructType(goType, this.mod.checker)
			) {
				const sName =
					goType.name ?? (goType.kind === "named" ? goType.name : null);
				const structInfo = this.mod.getStructType(sName);
				if (structInfo) {
					for (const f of structInfo.fields) {
						this.emitZeroValue(f.goType, f.wType);
					}
					this.pushInstruction({
						op: "struct.new",
						typeIndex: structInfo.typeIndex,
					});
					return;
				}
			}
			if (
				goType &&
				goType.kind !== "pointer" &&
				isArrayType(goType, this.mod.checker)
			) {
				const elemType = goType.elem;
				const arrInfo = this.mod.getArrayType(elemType);
				const size = this._getArraySize(goType);
				if (isStructType(elemType, this.mod.checker, this.mod)) {
					for (let i = 0; i < size; i++) {
						this.emitZeroValue(elemType, arrInfo.elemWType);
					}
					this.pushInstruction({
						op: "array.new_fixed",
						typeIndex: arrInfo.typeIndex,
						size,
					});
				} else {
					this.pushInstruction({ op: "i32.const", value: size });
					this.pushInstruction({
						op: "array.new_default",
						typeIndex: arrInfo.typeIndex,
					});
				}
				return;
			}
			if (
				(goType &&
					goType.kind !== "pointer" &&
					isSliceType(goType, this.mod.checker)) ||
				(typeof wType.typeIndex === "number" &&
					this.mod.getSliceTypeByIndex(wType.typeIndex))
			) {
				const elemType = goType ? this._getSliceElemType(goType) : null;
				const sliceInfo = elemType
					? this.mod.getSliceType(elemType)
					: this.mod.getSliceTypeByIndex(wType.typeIndex);
				if (sliceInfo) {
					this.pushInstruction({
						op: "global.get",
						index: sliceInfo.emptyGlobalIndex,
					});
					return;
				}
			}
			this.pushInstruction({
				op: "ref.null",
				heapType: wType.typeIndex ?? "any",
			});
		} else if (
			wType === "externref" ||
			isStringType(goType, this.mod?.checker)
		) {
			const strIdx = this.mod.internString("");
			const funcIdx = this.mod.getStringImportIndex();
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
		} else if (wType === "anyref") {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		} else {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
	}

	allocTemp(wasmType) {
		return this.acquireTemp(wasmType);
	}

	// Temps are keyed by a canonical string so ref-typed temps (fresh object
	// literals at every call site) are actually recycled across sites.
	_tempKey(wasmType) {
		if (typeof wasmType === "string") return wasmType;
		const nn = wasmType.nullable === false ? "!" : "";
		if (typeof wasmType.typeIndex === "number")
			return `r${wasmType.typeIndex}${nn}`;
		return `h${wasmType.heapType ?? "any"}${nn}`;
	}

	acquireTemp(wasmType) {
		if (!this.freeTemps) this.freeTemps = new Map();
		const list = this.freeTemps.get(this._tempKey(wasmType));
		if (list && list.length > 0) {
			return list.pop();
		}
		return this.allocLocal(null, wasmType);
	}

	releaseTemp(idx, wasmType) {
		if (!this.freeTemps) this.freeTemps = new Map();
		const key = this._tempKey(wasmType);
		let list = this.freeTemps.get(key);
		if (!list) {
			list = [];
			this.freeTemps.set(key, list);
		}
		list.push(idx);
	}

	resolveLocal(name) {
		return this.locals.get(name) ?? null;
	}

	// The control stack mirrors every block/loop/if so `br_if` depths to the
	// function-level out-of-bounds block stay correct inside nested structures
	// that never call pushControl (struct equality, string slicing, ...).
	pushInstruction(inst) {
		const op = typeof inst === "string" ? inst : inst.op;
		if (op === "block" || op === "loop" || op === "if" || op === "try_table") {
			this.controlStack.push({ op, role: null, label: null });
		} else if (op === "end") {
			this.controlStack.pop();
		}
		this.body.push(typeof inst === "string" ? { op: inst } : inst);
	}

	// ── Control Stack ──────────────────────────────────────────

	// Tags the innermost open block as a break/continue/oob target.
	pushControl(role, label = null) {
		const top = this.controlStack[this.controlStack.length - 1];
		if (top) {
			top.role = role;
			top.label = label;
		}
	}

	resolveBranchDepth(targetLabel, isContinue = false) {
		const targetRole = isContinue ? "continue" : "break";
		if (!targetLabel) {
			// Innermost break or continue
			for (let i = this.controlStack.length - 1; i >= 0; i--) {
				const ctrl = this.controlStack[i];
				if (ctrl.role === targetRole) {
					return this.controlStack.length - 1 - i;
				}
			}
			return 0;
		}

		for (let i = this.controlStack.length - 1; i >= 0; i--) {
			const ctrl = this.controlStack[i];
			if (ctrl.label === targetLabel && ctrl.role === targetRole) {
				return this.controlStack.length - 1 - i;
			}
		}
		return 0;
	}

	resolveBranchDepthToOob() {
		for (let i = this.controlStack.length - 1; i >= 0; i--) {
			const ctrl = this.controlStack[i];
			if (ctrl.role === "oob") {
				return this.controlStack.length - 1 - i;
			}
		}
		return null;
	}

	resolveBranchDepthToRole(targetRole) {
		for (let i = this.controlStack.length - 1; i >= 0; i--) {
			const ctrl = this.controlStack[i];
			if (ctrl.role === targetRole) {
				return this.controlStack.length - 1 - i;
			}
		}
		return null;
	}

	// ── Statements ─────────────────────────────────────────────

	emitBlock(block) {
		for (const stmt of block.stmts ?? []) {
			this.emitStmt(stmt);
		}
	}

	emitStmt(stmt) {
		if (!stmt) return;
		switch (stmt.kind) {
			case "Block":
				this.emitBlock(stmt);
				break;

			case "VarDecl":
				this.emitVarDecl(stmt);
				break;

			case "DefineStmt":
				this.emitDefineStmt(stmt);
				break;

			case "AssignStmt":
				this.emitAssignStmt(stmt);
				break;

			case "IncDecStmt":
				this.emitIncDecStmt(stmt);
				break;

			case "IfStmt":
				this.emitIfStmt(stmt);
				break;

			case "ForStmt":
				this.emitForStmt(stmt);
				break;

			case "ReturnStmt":
				this.emitReturnStmt(stmt);
				break;

			case "BranchStmt":
				this.emitBranchStmt(stmt);
				break;

			case "DeferStmt":
				this.emitDeferStmt(stmt);
				break;

			case "ExprStmt":
				this.emitExprStmt(stmt);
				break;

			case "LabeledStmt":
				if (stmt.body) {
					if (stmt.body.kind === "ForStmt") {
						stmt.body.label = stmt.label;
					}
					this.emitStmt(stmt.body);
				}
				break;

			case "SwitchStmt":
				this.emitSwitchStmt(stmt);
				break;

			case "TypeSwitchStmt":
				this.emitTypeSwitchStmt(stmt);
				break;

			default:
				// ignore comments or unsupported stmts
				break;
		}
	}

	emitVarDecl(stmt) {
		const decls = stmt.decls ?? stmt.specs ?? [stmt];
		for (const spec of decls) {
			const names = spec.names ?? (spec.name ? [spec.name] : []);
			const values = spec.value ?? (spec.init ? [spec.init] : []);

			for (let i = 0; i < names.length; i++) {
				const name = names[i];
				const rawType = spec.type ?? values[i]?._type;
				const wType = this.toWasmType(rawType);
				const localIdx = this.allocLocal(name, wType, rawType);
				const localInfo = this.locals.get(name);
				if (values?.[i]) {
					const r = values[i];
					const isValStruct =
						isStructType(rawType, this.mod.checker, this.mod) &&
						!isPointerToStruct(rawType, this.mod.checker, this.mod);
					const isFresh =
						r.kind === "CompositeLit" ||
						(r.kind === "UnaryExpr" && r.op === "*");
					this.emitExpr(r, wType);
					if (isValStruct && !isFresh) {
						const sInfo =
							this._resolveStructInfo(r) ??
							this.mod.getStructType(rawType?.name);
						if (sInfo) {
							this.emitCloneStruct(sInfo, wType);
						}
					}
					if (localInfo?.isBoxed) {
						this.pushInstruction({
							op: "struct.new",
							typeIndex: localInfo.boxInfo.typeIndex,
						});
					}
					this.pushInstruction({ op: "local.set", index: localIdx });
				} else {
					this.emitZeroValue(rawType, wType);
					if (localInfo?.isBoxed) {
						this.pushInstruction({
							op: "struct.new",
							typeIndex: localInfo.boxInfo.typeIndex,
						});
					}
					this.pushInstruction({ op: "local.set", index: localIdx });
				}
			}
		}
	}

	emitDefineStmt(stmt) {
		const lhsNodes = Array.isArray(stmt.lhs) ? stmt.lhs : [stmt.lhs];
		const rhsNodes = Array.isArray(stmt.rhs) ? stmt.rhs : [stmt.rhs];

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "TypeAssertExpr"
		) {
			this._emitCommaOkTypeAssert(lhsNodes[0], lhsNodes[1], rhsNodes[0], true);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "IndexExpr" &&
			isMapType(
				rhsNodes[0].expr._type ?? this._resolveExprGoType(rhsNodes[0].expr),
				this.mod.checker,
			)
		) {
			this._emitCommaOkMapIndex(lhsNodes[0], lhsNodes[1], rhsNodes[0], true);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length > 1 &&
			rhsNodes[0]._type?.kind === "tuple"
		) {
			this._emitTupleDefine(lhsNodes, rhsNodes[0]);
			return;
		}

		for (let i = 0; i < lhsNodes.length; i++) {
			this._emitDefineSingle(lhsNodes[i], rhsNodes[i]);
		}
	}

	_emitDefineSingle(l, r) {
		if (!r || l.kind !== "Ident") return;
		if (l.name === "_") {
			this.emitExpr(r);
			this.pushInstruction("drop");
			return;
		}
		const wType = this.toWasmType(r._type);
		const idx = this.allocLocal(l.name, wType, r._type);
		const localInfo = this.locals.get(l.name);
		const isValStruct =
			isStructType(r._type, this.mod.checker, this.mod) &&
			!isPointerToStruct(r._type, this.mod.checker, this.mod);
		const isFresh =
			r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");
		this.emitExpr(r, wType);
		if (isValStruct && !isFresh) {
			const sInfo = this._resolveStructInfo(r);
			if (sInfo) {
				this.emitCloneStruct(sInfo, wType);
			}
		}
		if (localInfo?.isBoxed) {
			this.pushInstruction({
				op: "struct.new",
				typeIndex: localInfo.boxInfo.typeIndex,
			});
		}
		this.pushInstruction({ op: "local.set", index: idx });
	}

	_emitTupleDefine(lhsNodes, rhsNode) {
		const tupleTypes = rhsNode._type.types;
		const localIndices = [];
		for (let i = 0; i < lhsNodes.length; i++) {
			const l = lhsNodes[i];
			const wType = this.toWasmType(tupleTypes[i]);
			const idx =
				l.kind === "Ident" && l.name !== "_"
					? this.allocLocal(l.name, wType, tupleTypes[i])
					: null;
			localIndices.push(idx);
		}

		this.emitExpr(rhsNode);

		for (let i = lhsNodes.length - 1; i >= 0; i--) {
			const idx = localIndices[i];
			if (idx !== null) {
				const localInfo = this.locals.get(lhsNodes[i].name);
				if (localInfo?.isBoxed) {
					this.pushInstruction({
						op: "struct.new",
						typeIndex: localInfo.boxInfo.typeIndex,
					});
				}
				this.pushInstruction({ op: "local.set", index: idx });
			} else {
				this.pushInstruction("drop");
			}
		}
	}

	emitAssignStmt(stmt) {
		const { lhs, rhs, op } = stmt;
		if (op === ":=" || op === "=") {
			this._emitAssign(lhs, rhs, op);
		} else {
			this._emitCompoundAssign(lhs, rhs, op);
		}
	}

	_emitAssign(lhs, rhs, op) {
		const lhsNodes = Array.isArray(lhs) ? lhs : [lhs];
		const rhsNodes = Array.isArray(rhs) ? rhs : [rhs];

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "TypeAssertExpr"
		) {
			this._emitCommaOkTypeAssert(
				lhsNodes[0],
				lhsNodes[1],
				rhsNodes[0],
				op === ":=",
			);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length === 2 &&
			rhsNodes[0].kind === "IndexExpr" &&
			isMapType(
				rhsNodes[0].expr._type ?? this._resolveExprGoType(rhsNodes[0].expr),
				this.mod.checker,
			)
		) {
			this._emitCommaOkMapIndex(
				lhsNodes[0],
				lhsNodes[1],
				rhsNodes[0],
				op === ":=",
			);
			return;
		}

		if (
			rhsNodes.length === 1 &&
			lhsNodes.length > 1 &&
			rhsNodes[0]._type?.kind === "tuple"
		) {
			this._emitTupleAssign(lhsNodes, rhsNodes[0], op);
			return;
		}

		for (let i = 0; i < lhsNodes.length; i++) {
			this._emitAssignSingle(lhsNodes[i], rhsNodes[i], op);
		}
	}

	_emitAssignSingle(l, r, op) {
		if (!r) return;
		if (l.kind === "Ident") {
			if (l.name === "_") {
				this.emitExpr(r);
				this.pushInstruction("drop");
				return;
			}
			let localInfo = this.resolveLocal(l.name);
			if (!localInfo && op === ":=") {
				const wType = this.toWasmType(r._type);
				this.allocLocal(l.name, wType, r._type);
				localInfo = this.locals.get(l.name);
			}
			if (localInfo) {
				if (localInfo.isBoxed) {
					this.pushInstruction({ op: "local.get", index: localInfo.index });
					this.emitExpr(r, localInfo.boxInfo.wType);
					this.pushInstruction({
						op: "struct.set",
						typeIndex: localInfo.boxInfo.typeIndex,
						fieldIndex: 0,
					});
					return;
				}
				const isValStruct =
					isStructType(localInfo.goType, this.mod.checker, this.mod) &&
					!isPointerToStruct(localInfo.goType, this.mod.checker, this.mod);
				const isFresh =
					r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");
				this.emitExpr(r, localInfo.type);
				if (isValStruct && !isFresh) {
					const sInfo =
						this._resolveStructInfo(r) ?? this._resolveStructInfo(l);
					if (sInfo) {
						this.emitCloneStruct(sInfo, localInfo.type);
					}
				}
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				const globalInfo = this.mod.resolveGlobal(l.name);
				if (globalInfo) {
					const isValStruct =
						isStructType(globalInfo.goType, this.mod.checker, this.mod) &&
						!isPointerToStruct(globalInfo.goType, this.mod.checker, this.mod);
					const isFresh =
						r.kind === "CompositeLit" ||
						(r.kind === "UnaryExpr" && r.op === "*");
					this.emitExpr(r, globalInfo.type);
					if (isValStruct && !isFresh) {
						const sInfo =
							this._resolveStructInfo(r) ?? this._resolveStructInfo(l);
						if (sInfo) {
							this.emitCloneStruct(sInfo, globalInfo.type);
						}
					}
					this.pushInstruction({
						op: "global.set",
						index: globalInfo.index,
					});
				}
			}
			return;
		}

		if (l.kind === "SelectorExpr") {
			const structInfo = this._resolveStructInfo(l.expr);
			if (!structInfo) {
				throw new Error(
					`Cannot resolve struct for selector assignment: ${l.field}`,
				);
			}
			const path = this._resolveFieldPath(structInfo, l.field);
			if (!path) {
				throw new Error(
					`Unknown field '${l.field}' on struct '${structInfo.name}'`,
				);
			}
			const lastStep = path[path.length - 1];
			const baseWType = this.toWasmType(l.expr._type);

			this.emitExpr(l.expr, baseWType);
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			const isValStruct =
				isStructType(lastStep.field.goType, this.mod.checker, this.mod) &&
				!isPointerToStruct(lastStep.field.goType, this.mod.checker, this.mod);
			const isFresh =
				r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");
			this.emitExpr(r, lastStep.field.wType);
			if (isValStruct && !isFresh) {
				const sInfo =
					this._resolveStructInfo(r) ??
					this.mod.getStructType(lastStep.field.goType?.name);
				if (sInfo) {
					this.emitCloneStruct(sInfo, lastStep.field.wType);
				}
			}
			this.pushInstruction({
				op: "struct.set",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			return;
		}

		if (l.kind === "UnaryExpr" && l.op === "*") {
			const structInfo = this._resolveStructInfo(l.operand);
			if (structInfo) {
				const baseWType = this.toWasmType(l.operand._type);
				const tmpL = this.acquireTemp(baseWType);
				const tmpR = this.acquireTemp(baseWType);
				this.emitExpr(l.operand, baseWType);
				this.pushInstruction({ op: "local.set", index: tmpL });
				this.emitExpr(r, baseWType);
				this.pushInstruction({ op: "local.set", index: tmpR });
				for (let i = 0; i < structInfo.fields.length; i++) {
					this.pushInstruction({ op: "local.get", index: tmpL });
					this.pushInstruction({ op: "local.get", index: tmpR });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: structInfo.typeIndex,
						fieldIndex: i,
					});
					this.pushInstruction({
						op: "struct.set",
						typeIndex: structInfo.typeIndex,
						fieldIndex: i,
					});
				}
				this.releaseTemp(tmpR, baseWType);
				this.releaseTemp(tmpL, baseWType);
				return;
			}
			const box = this.mod.getBoxType(l.operand._type?.base ?? l.operand._type);
			const baseWType = {
				kind: "ref",
				nullable: true,
				typeIndex: box.typeIndex,
			};
			const boxTmp = this.acquireTemp(baseWType);
			this.emitExpr(l.operand, baseWType);
			this.pushInstruction({ op: "local.set", index: boxTmp });
			this.pushInstruction({ op: "local.get", index: boxTmp });
			this.emitExpr(r, box.wType);
			this.pushInstruction({
				op: "struct.set",
				typeIndex: box.typeIndex,
				fieldIndex: 0,
			});
			this.releaseTemp(boxTmp, baseWType);
			return;
		}

		if (l.kind === "IndexExpr") {
			const baseNode = l.expr;
			const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
			if (isMapType(baseType, this.mod.checker)) {
				const { keyType, valType } = getMapKeyValTypes(
					baseType,
					this.mod.checker,
				);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(baseNode, mapInfo.wType);
				this.emitExpr(l.index, mapInfo.keyWType);
				const isValStruct =
					isStructType(valType, this.mod.checker, this.mod) &&
					!isPointerToStruct(valType, this.mod.checker, this.mod);
				const isFresh =
					r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");
				this.emitExpr(r, mapInfo.valWType);
				if (isValStruct && !isFresh) {
					const sInfo =
						this._resolveStructInfo(r) ??
						this._resolveStructInfo({ _type: valType });
					if (sInfo) {
						this.emitCloneStruct(sInfo, mapInfo.valWType);
					}
				}
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = isSlice
				? baseType.elem
				: isPtrToArr
					? baseType.base.elem
					: baseType.elem;
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

			this._emitElemAddr(baseNode, l.index, sliceInfo, arrInfo);

			const isValStruct =
				isStructType(elemGoType, this.mod.checker, this.mod) &&
				!isPointerToStruct(elemGoType, this.mod.checker, this.mod);
			const isFresh =
				r.kind === "CompositeLit" || (r.kind === "UnaryExpr" && r.op === "*");

			this.emitExpr(r, arrInfo.elemWType);
			if (isValStruct && !isFresh) {
				const sInfo = this._resolveStructInfo(r) ?? this._resolveStructInfo(l);
				if (sInfo) {
					this.emitCloneStruct(sInfo, arrInfo.elemWType);
				}
			}

			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});
			return;
		}
	}

	_emitTupleAssign(lhsNodes, rhsNode, op) {
		const tupleTypes = rhsNode._type.types;
		const dests = [];
		for (let i = 0; i < lhsNodes.length; i++) {
			const l = lhsNodes[i];
			if (l.kind === "Ident" && l.name !== "_") {
				let localInfo = this.resolveLocal(l.name);
				if (!localInfo && op === ":=") {
					const wType = this.toWasmType(tupleTypes[i]);
					this.allocLocal(l.name, wType, tupleTypes[i]);
					localInfo = this.locals.get(l.name);
				}
				dests.push(localInfo ?? this.mod.resolveGlobal(l.name) ?? null);
			} else {
				dests.push(null);
			}
		}

		this.emitExpr(rhsNode);

		for (let i = lhsNodes.length - 1; i >= 0; i--) {
			const dest = dests[i];
			if (dest && typeof dest.index === "number") {
				if (dest.isBoxed) {
					const valTmp = this.acquireTemp(dest.boxInfo.wType);
					this.pushInstruction({ op: "local.set", index: valTmp });
					this.pushInstruction({ op: "local.get", index: dest.index });
					this.pushInstruction({ op: "local.get", index: valTmp });
					this.pushInstruction({
						op: "struct.set",
						typeIndex: dest.boxInfo.typeIndex,
						fieldIndex: 0,
					});
					this.releaseTemp(valTmp, dest.boxInfo.wType);
				} else if (this.resolveLocal(lhsNodes[i].name)) {
					this.pushInstruction({ op: "local.set", index: dest.index });
				} else {
					this.pushInstruction({ op: "global.set", index: dest.index });
				}
			} else {
				this.pushInstruction("drop");
			}
		}
	}

	_emitCommaOkTypeAssert(valLhs, okLhs, assertExpr, isDefine) {
		const targetGoType = assertExpr._type ?? assertExpr.type;
		const targetWType = this.toWasmType(targetGoType);
		const anyTmp = this.acquireTemp("anyref");
		this.emitExpr(assertExpr.expr, "anyref");
		this.pushInstruction({ op: "local.set", index: anyTmp });

		const okTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: anyTmp });
		this._emitTypeTest(targetGoType);
		this.pushInstruction({ op: "local.set", index: okTmp });

		const valTmp = this.acquireTemp(targetWType);
		this.pushInstruction({ op: "local.get", index: okTmp });
		this.pushInstruction({ op: "if", blockType: targetWType });
		this.pushInstruction({ op: "local.get", index: anyTmp });
		this._emitTypeCast(targetGoType, targetWType);
		this.pushInstruction("else");
		this.emitZeroValue(targetGoType, targetWType);
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: valTmp });

		this.releaseTemp(anyTmp, "anyref");

		// Assign val to valLhs
		if (isDefine && valLhs.kind === "Ident" && valLhs.name !== "_") {
			const idx = this.allocLocal(valLhs.name, targetWType, targetGoType);
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction({ op: "local.set", index: idx });
		} else if (valLhs.kind === "Ident" && valLhs.name !== "_") {
			const local = this.resolveLocal(valLhs.name);
			this.pushInstruction({ op: "local.get", index: valTmp });
			if (local) {
				this.pushInstruction({ op: "local.set", index: local.index });
			} else {
				const global = this.mod.resolveGlobal(valLhs.name);
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		// Assign ok to okLhs
		if (isDefine && okLhs.kind === "Ident" && okLhs.name !== "_") {
			const idx = this.allocLocal(okLhs.name, "i32", {
				kind: "basic",
				name: "bool",
			});
			this.pushInstruction({ op: "local.get", index: okTmp });
			this.pushInstruction({ op: "local.set", index: idx });
		} else if (okLhs.kind === "Ident" && okLhs.name !== "_") {
			const local = this.resolveLocal(okLhs.name);
			this.pushInstruction({ op: "local.get", index: okTmp });
			if (local) {
				this.pushInstruction({ op: "local.set", index: local.index });
			} else {
				const global = this.mod.resolveGlobal(okLhs.name);
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		this.releaseTemp(valTmp, targetWType);
		this.releaseTemp(okTmp, "i32");
	}

	_emitCommaOkMapIndex(valLhs, okLhs, indexExpr, isDefine) {
		const baseNode = indexExpr.expr;
		const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
		const { keyType, valType } = getMapKeyValTypes(baseType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		this.emitExpr(baseNode, mapInfo.wType);
		this.emitExpr(indexExpr.index, mapInfo.keyWType);
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.getOkFuncName),
		});

		const okTmp = this.acquireTemp("i32");
		const valTmp = this.acquireTemp(mapInfo.valWType);
		this.pushInstruction({ op: "local.set", index: okTmp });
		this.pushInstruction({ op: "local.set", index: valTmp });

		// Assign val to valLhs
		if (isDefine && valLhs.kind === "Ident" && valLhs.name !== "_") {
			const idx = this.allocLocal(valLhs.name, mapInfo.valWType, valType);
			const local = this.locals.get(valLhs.name);
			if (local?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: valTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: local.boxInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: idx });
			} else {
				this.pushInstruction({ op: "local.get", index: valTmp });
				this.pushInstruction({ op: "local.set", index: idx });
			}
		} else if (valLhs.kind === "Ident" && valLhs.name !== "_") {
			const local = this.resolveLocal(valLhs.name);
			if (local) {
				if (local.isBoxed) {
					this.pushInstruction({ op: "local.get", index: local.index });
					this.pushInstruction({ op: "local.get", index: valTmp });
					this.pushInstruction({
						op: "struct.set",
						typeIndex: local.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: valTmp });
					this.pushInstruction({ op: "local.set", index: local.index });
				}
			} else {
				const global = this.mod.resolveGlobal(valLhs.name);
				this.pushInstruction({ op: "local.get", index: valTmp });
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		// Assign ok to okLhs
		if (isDefine && okLhs.kind === "Ident" && okLhs.name !== "_") {
			const idx = this.allocLocal(okLhs.name, "i32", {
				kind: "basic",
				name: "bool",
			});
			const local = this.locals.get(okLhs.name);
			if (local?.isBoxed) {
				this.pushInstruction({ op: "local.get", index: okTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: local.boxInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: idx });
			} else {
				this.pushInstruction({ op: "local.get", index: okTmp });
				this.pushInstruction({ op: "local.set", index: idx });
			}
		} else if (okLhs.kind === "Ident" && okLhs.name !== "_") {
			const local = this.resolveLocal(okLhs.name);
			if (local) {
				if (local.isBoxed) {
					this.pushInstruction({ op: "local.get", index: local.index });
					this.pushInstruction({ op: "local.get", index: okTmp });
					this.pushInstruction({
						op: "struct.set",
						typeIndex: local.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: okTmp });
					this.pushInstruction({ op: "local.set", index: local.index });
				}
			} else {
				const global = this.mod.resolveGlobal(okLhs.name);
				this.pushInstruction({ op: "local.get", index: okTmp });
				this.pushInstruction({ op: "global.set", index: global.index });
			}
		}

		this.releaseTemp(valTmp, mapInfo.valWType);
		this.releaseTemp(okTmp, "i32");
	}

	_structNameOf(goType) {
		if (!goType) return null;
		if (goType.kind === "PointerType" || goType.kind === "pointer")
			return this._structNameOf(goType.base);
		if (goType.kind === "StarExpr")
			return this._structNameOf(goType.expr ?? goType.operand);
		return goType.name ?? null;
	}

	_emitTypeTest(targetGoType) {
		if (!targetGoType) {
			this.pushInstruction("drop");
			this.pushInstruction({ op: "i32.const", value: 1 });
			return;
		}

		if (targetGoType.name === "nil" || targetGoType.kind === "nil") {
			this.pushInstruction("ref.is_null");
			return;
		}

		if (targetGoType.name === "any" || targetGoType.name === "interface{}") {
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");
			return;
		}

		if (isNonEmptyInterface(targetGoType, this.mod.checker)) {
			const candidates = this.mod.getTypesImplementingInterface(targetGoType);
			if (candidates.length === 0) {
				this.pushInstruction("drop");
				this.pushInstruction({ op: "i32.const", value: 0 });
				return;
			}
			const anyTmp = this.acquireTemp("anyref");
			this.pushInstruction({ op: "local.set", index: anyTmp });

			this.pushInstruction({ op: "local.get", index: anyTmp });
			this.pushInstruction("ref.is_null");
			this.pushInstruction("i32.eqz");

			for (let i = 0; i < candidates.length; i++) {
				this.pushInstruction({ op: "local.get", index: anyTmp });
				this.pushInstruction({
					op: "ref.test",
					typeIndex: candidates[i].typeIndex,
				});
				if (i > 0) {
					this.pushInstruction("i32.or");
				}
			}
			this.pushInstruction("i32.and");
			this.releaseTemp(anyTmp, "anyref");
			return;
		}

		if (isStringType(targetGoType, this.mod.checker)) {
			const isStrIdx = this.mod.getIsStringImportIndex();
			this.pushInstruction({ op: "call", funcIndex: isStrIdx });
			return;
		}

		if (isFuncType(targetGoType, this.mod.checker)) {
			const closureInfo = this.mod.getClosureType(targetGoType);
			this.pushInstruction({
				op: "ref.test",
				typeIndex: closureInfo.typeIndex,
			});
			return;
		}

		// `*T` lives in `any` as the bare struct ref; a `T` value as a boxed
		// clone (see emitExpr).  Fall through to the scalar box for values.
		if (isPointerToStruct(targetGoType, this.mod.checker, this.mod)) {
			const sInfo = this.mod.getStructType(this._structNameOf(targetGoType));
			if (sInfo) {
				this.pushInstruction({ op: "ref.test", typeIndex: sInfo.typeIndex });
				return;
			}
		}

		if (isSliceType(targetGoType, this.mod.checker)) {
			const elem = this._getSliceElemType(targetGoType);
			const sInfo = this.mod.getSliceType(elem);
			if (sInfo) {
				this.pushInstruction({ op: "ref.test", typeIndex: sInfo.typeIndex });
				return;
			}
		}

		if (isArrayType(targetGoType, this.mod.checker)) {
			const elem = this._getArrayElemType(targetGoType);
			const aInfo = this.mod.getArrayType(elem);
			if (aInfo) {
				this.pushInstruction({ op: "ref.test", typeIndex: aInfo.typeIndex });
				return;
			}
		}

		// Scalar types
		const box = this.mod.getBoxType(targetGoType);
		if (box) {
			this.pushInstruction({ op: "ref.test", typeIndex: box.typeIndex });
			return;
		}

		this.pushInstruction("drop");
		this.pushInstruction({ op: "i32.const", value: 1 });
	}

	_emitTypeCast(targetGoType, targetWType) {
		if (isInterfaceType(targetGoType, this.mod.checker)) {
			return;
		}

		if (isStringType(targetGoType, this.mod.checker)) {
			this.pushInstruction("extern.convert_any");
			return;
		}

		if (isFuncType(targetGoType, this.mod.checker)) {
			const closureInfo = this.mod.getClosureType(targetGoType);
			this.pushInstruction({
				op: "ref.cast_null",
				typeIndex: closureInfo.typeIndex,
			});
			return;
		}

		if (isPointerToStruct(targetGoType, this.mod.checker, this.mod)) {
			const sInfo = this.mod.getStructType(this._structNameOf(targetGoType));
			if (sInfo) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: sInfo.typeIndex,
				});
				return;
			}
		}
		if (isStructType(targetGoType, this.mod.checker, this.mod)) {
			const sInfo = this.mod.getStructType(this._structNameOf(targetGoType));
			const box = this.mod.getBoxType(targetGoType);
			if (sInfo && box) {
				this.pushInstruction({ op: "ref.cast_null", typeIndex: box.typeIndex });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: box.typeIndex,
					fieldIndex: 0,
				});
				this.emitCloneStruct(sInfo, targetWType);
				return;
			}
		}

		if (isSliceType(targetGoType, this.mod.checker)) {
			const elem = this._getSliceElemType(targetGoType);
			const sInfo = this.mod.getSliceType(elem);
			if (sInfo) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: sInfo.typeIndex,
				});
				return;
			}
		}

		if (isArrayType(targetGoType, this.mod.checker)) {
			const elem = this._getArrayElemType(targetGoType);
			const aInfo = this.mod.getArrayType(elem);
			if (aInfo) {
				this.pushInstruction({
					op: "ref.cast_null",
					typeIndex: aInfo.typeIndex,
				});
				return;
			}
		}

		// Scalar types
		const box = this.mod.getBoxType(targetGoType);
		if (box) {
			this.pushInstruction({
				op: "ref.cast_null",
				typeIndex: box.typeIndex,
			});
			this.pushInstruction({
				op: "struct.get",
				typeIndex: box.typeIndex,
				fieldIndex: 0,
			});
			return;
		}
	}

	_emitCompoundAssign(lhs, rhs, op) {
		const baseOp = op.slice(0, -1);
		const l = Array.isArray(lhs) ? lhs[0] : lhs;
		const r = Array.isArray(rhs) ? rhs[0] : rhs;

		if (l.kind === "SelectorExpr") {
			const structInfo = this._resolveStructInfo(l.expr);
			if (!structInfo) {
				throw new Error(
					`Cannot resolve struct for compound selector: ${l.field}`,
				);
			}
			const path = this._resolveFieldPath(structInfo, l.field);
			if (!path) {
				throw new Error(
					`Unknown field '${l.field}' on struct '${structInfo.name}'`,
				);
			}
			const lastStep = path[path.length - 1];
			const targetType = lastStep.field.wType;
			const baseWType = this.toWasmType(l.expr._type);

			const baseTmp = this.acquireTemp(baseWType);
			this.emitExpr(l.expr, baseWType);
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			this.pushInstruction({ op: "local.set", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			this.emitExpr(r, targetType);
			this.emitBinaryOp(baseOp, targetType, l._type);

			this.pushInstruction({
				op: "struct.set",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			this.releaseTemp(baseTmp, baseWType);
			return;
		}

		if (l.kind === "IndexExpr") {
			const baseNode = l.expr;
			const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
			if (isMapType(baseType, this.mod.checker)) {
				const { keyType, valType } = getMapKeyValTypes(
					baseType,
					this.mod.checker,
				);
				const mapInfo = this.mod.getMapType(keyType, valType);
				const mTmp = this.acquireTemp(mapInfo.wType);
				const kTmp = this.acquireTemp(mapInfo.keyWType);
				this.emitExpr(baseNode, mapInfo.wType);
				this.pushInstruction({ op: "local.set", index: mTmp });
				this.emitExpr(l.index, mapInfo.keyWType);
				this.pushInstruction({ op: "local.set", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.getFuncName),
				});

				this.emitExpr(r, mapInfo.valWType);
				this.emitBinaryOp(baseOp, mapInfo.valWType, valType);

				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});

				this.releaseTemp(kTmp, mapInfo.keyWType);
				this.releaseTemp(mTmp, mapInfo.wType);
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = isSlice
				? baseType.elem
				: isPtrToArr
					? baseType.base.elem
					: baseType.elem;
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;
			const targetType = arrInfo.elemWType;
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};

			this._emitElemAddr(baseNode, l.index, sliceInfo, arrInfo);
			const arrTmp = this.acquireTemp(arrWType);
			const targetIdxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: targetIdxTmp });
			this.pushInstruction({ op: "local.tee", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});

			this.emitExpr(r, targetType);
			this.emitBinaryOp(baseOp, targetType, elemGoType);

			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});

			this.releaseTemp(targetIdxTmp, "i32");
			this.releaseTemp(arrTmp, arrWType);
			return;
		}

		if (l.kind !== "Ident") return;

		const localInfo = this.resolveLocal(l.name);
		const globalInfo = !localInfo ? this.mod.resolveGlobal(l.name) : null;
		if (!localInfo && !globalInfo) return;

		if (localInfo?.isBoxed) {
			const boxInfo = localInfo.boxInfo;
			const targetType = boxInfo.wType;
			if (baseOp === "/" || baseOp === "%") {
				const resTmp = this.acquireTemp(targetType);
				this.emitDivRem(baseOp, l, r, targetType);
				this.pushInstruction({ op: "local.set", index: resTmp });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: resTmp });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				this.releaseTemp(resTmp, targetType);
			} else if (baseOp === "<<" || baseOp === ">>") {
				const resTmp = this.acquireTemp(targetType);
				this.emitShift(baseOp, l, r, targetType);
				this.pushInstruction({ op: "local.set", index: resTmp });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: resTmp });
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				this.releaseTemp(resTmp, targetType);
			} else {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				this.emitExpr(r, targetType);
				this.emitBinaryOp(baseOp, targetType, l._type);
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
			}
			return;
		}

		const targetType = localInfo ? localInfo.type : globalInfo.type;

		if (baseOp === "/" || baseOp === "%") {
			this.emitDivRem(baseOp, l, r, targetType);
		} else if (baseOp === "<<" || baseOp === ">>") {
			this.emitShift(baseOp, l, r, targetType);
		} else {
			if (localInfo) {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.get", index: globalInfo.index });
			}
			this.emitExpr(r, targetType);
			this.emitBinaryOp(baseOp, targetType, l._type);
		}

		if (localInfo) {
			this.pushInstruction({ op: "local.set", index: localInfo.index });
		} else {
			this.pushInstruction({ op: "global.set", index: globalInfo.index });
		}
	}

	emitIncDecStmt(stmt) {
		const { expr, op } = stmt;

		if (expr.kind === "SelectorExpr") {
			const structInfo = this._resolveStructInfo(expr.expr);
			if (!structInfo) return;
			const path = this._resolveFieldPath(structInfo, expr.field);
			if (!path) return;
			const lastStep = path[path.length - 1];
			const targetType = lastStep.field.wType;
			const baseWType = this.toWasmType(expr.expr._type);

			const baseTmp = this.acquireTemp(baseWType);
			this.emitExpr(expr.expr, baseWType);
			for (let i = 0; i < path.length - 1; i++) {
				const step = path[i];
				this.pushInstruction({
					op: "struct.get",
					typeIndex: step.structInfo.typeIndex,
					fieldIndex: step.fieldIndex,
				});
			}
			this.pushInstruction({ op: "local.set", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });

			this.pushInstruction({ op: "local.get", index: baseTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});

			if (targetType === "i64") {
				this.pushInstruction({ op: "i64.const", value: 1n });
				this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
			} else if (targetType === "f32") {
				this.pushInstruction({ op: "f32.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
			} else if (targetType === "f64") {
				this.pushInstruction({ op: "f64.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
			} else {
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
				this.emitNarrowIntWrap(expr._type);
			}

			this.pushInstruction({
				op: "struct.set",
				typeIndex: lastStep.structInfo.typeIndex,
				fieldIndex: lastStep.fieldIndex,
			});
			this.releaseTemp(baseTmp, baseWType);
			return;
		}

		if (expr.kind === "IndexExpr") {
			const baseNode = expr.expr;
			const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);
			if (isMapType(baseType, this.mod.checker)) {
				const { keyType, valType } = getMapKeyValTypes(
					baseType,
					this.mod.checker,
				);
				const mapInfo = this.mod.getMapType(keyType, valType);
				const mTmp = this.acquireTemp(mapInfo.wType);
				const kTmp = this.acquireTemp(mapInfo.keyWType);
				this.emitExpr(baseNode, mapInfo.wType);
				this.pushInstruction({ op: "local.set", index: mTmp });
				this.emitExpr(expr.index, mapInfo.keyWType);
				this.pushInstruction({ op: "local.set", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });

				this.pushInstruction({ op: "local.get", index: mTmp });
				this.pushInstruction({ op: "local.get", index: kTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.getFuncName),
				});

				if (mapInfo.valWType === "i64") {
					this.pushInstruction({ op: "i64.const", value: 1n });
					this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
				} else if (mapInfo.valWType === "f32") {
					this.pushInstruction({ op: "f32.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
				} else if (mapInfo.valWType === "f64") {
					this.pushInstruction({ op: "f64.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
				} else {
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
					this.emitNarrowIntWrap(valType);
				}

				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
				});

				this.releaseTemp(kTmp, mapInfo.keyWType);
				this.releaseTemp(mTmp, mapInfo.wType);
				return;
			}

			const isSlice = isSliceType(baseType, this.mod.checker);
			const isPtrToArr =
				baseType?.kind === "pointer" &&
				isArrayType(baseType.base, this.mod.checker);

			const elemGoType = isSlice
				? baseType.elem
				: isPtrToArr
					? baseType.base.elem
					: baseType.elem;
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;
			const targetType = arrInfo.elemWType;
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};

			this._emitElemAddr(baseNode, expr.index, sliceInfo, arrInfo);
			const arrTmp = this.acquireTemp(arrWType);
			const targetIdxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.set", index: targetIdxTmp });
			this.pushInstruction({ op: "local.tee", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });

			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: targetIdxTmp });
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});

			if (targetType === "i64") {
				this.pushInstruction({ op: "i64.const", value: 1n });
				this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
			} else if (targetType === "f32") {
				this.pushInstruction({ op: "f32.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
			} else if (targetType === "f64") {
				this.pushInstruction({ op: "f64.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
			} else {
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
				this.emitNarrowIntWrap(elemGoType);
			}

			this.pushInstruction({
				op: "array.set",
				typeIndex: arrInfo.typeIndex,
			});

			this.releaseTemp(targetIdxTmp, "i32");
			this.releaseTemp(arrTmp, arrWType);
			return;
		}

		if (expr.kind === "Ident") {
			const localInfo = this.resolveLocal(expr.name);
			const globalInfo = !localInfo ? this.mod.resolveGlobal(expr.name) : null;
			if (!localInfo && !globalInfo) return;

			if (localInfo?.isBoxed) {
				const boxInfo = localInfo.boxInfo;
				const innerWType = boxInfo.wType;
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				if (innerWType === "i64") {
					this.pushInstruction({ op: "i64.const", value: 1n });
					this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
				} else if (innerWType === "f32") {
					this.pushInstruction({ op: "f32.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
				} else if (innerWType === "f64") {
					this.pushInstruction({ op: "f64.const", value: 1.0 });
					this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
				} else {
					this.pushInstruction({ op: "i32.const", value: 1 });
					this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
					this.emitNarrowIntWrap(localInfo.goType);
				}
				this.pushInstruction({
					op: "struct.set",
					typeIndex: boxInfo.typeIndex,
					fieldIndex: 0,
				});
				return;
			}

			const targetType = localInfo ? localInfo.type : globalInfo.type;

			if (localInfo) {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.get", index: globalInfo.index });
			}

			if (targetType === "i64") {
				this.pushInstruction({ op: "i64.const", value: 1n });
				this.pushInstruction(op === "++" ? "i64.add" : "i64.sub");
			} else if (targetType === "f32") {
				this.pushInstruction({ op: "f32.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f32.add" : "f32.sub");
			} else if (targetType === "f64") {
				this.pushInstruction({ op: "f64.const", value: 1.0 });
				this.pushInstruction(op === "++" ? "f64.add" : "f64.sub");
			} else {
				this.pushInstruction({ op: "i32.const", value: 1 });
				this.pushInstruction(op === "++" ? "i32.add" : "i32.sub");
				this.emitNarrowIntWrap(expr._type);
			}

			if (localInfo) {
				this.pushInstruction({ op: "local.set", index: localInfo.index });
			} else {
				this.pushInstruction({ op: "global.set", index: globalInfo.index });
			}
		}
	}

	emitIfStmt(stmt) {
		if (stmt.init) this.emitStmt(stmt.init);

		this.emitExpr(stmt.cond, "i32");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("if");

		const thenBlock = stmt.body ?? stmt.then;
		if (thenBlock) this.emitBlock(thenBlock);
		const elseBlock = stmt.elseBody ?? stmt.else;
		if (elseBlock) {
			this.pushInstruction("else");
			if (elseBlock.kind === "Block") {
				this.emitBlock(elseBlock);
			} else {
				this.emitStmt(elseBlock);
			}
		}
		this.pushInstruction("end");
	}

	emitRangeForStmt(stmt) {
		const rangeExpr =
			stmt.cond?.kind === "RangeExpr" ? stmt.cond : stmt.init.rhs[0];
		const isAssign = stmt.init?.kind === "AssignStmt";
		const lhs = stmt.init?.lhs ?? [];
		const iterExpr = rangeExpr.expr;
		const iterType = iterExpr._type;

		// `for i := range` shadows any outer `i`; restore the outer binding afterwards.
		const shadowed = isAssign
			? []
			: lhs
					.filter((l) => l && l.name !== "_")
					.map((l) => [l.name, this.locals.get(l.name)]);
		const restoreShadowed = () => {
			for (const [name, prev] of shadowed) {
				if (prev) this.locals.set(name, prev);
				else this.locals.delete(name);
			}
		};

		if (isIntRangeType(iterType)) {
			const limitTmp = this.acquireTemp("i32");
			this._emitIndexExprToI32(iterExpr, limitTmp);

			const idxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: idxTmp });

			let idxLocalInfo = null;
			if (lhs[0] && lhs[0].name !== "_") {
				if (!isAssign) {
					const bodyBlock = stmt.body ?? stmt.block;
					const isNonEscaping =
						!this.mutatedCaptures?.has(lhs[0].name) &&
						!this.capturedNames?.includes(lhs[0].name) &&
						!this._varMutatesOrEscapes(bodyBlock, lhs[0].name);
					const wType = isNonEscaping ? "i32" : "i64";
					const lIdx = this.allocLocal(lhs[0].name, wType, {
						kind: "basic",
						name: "int",
					});
					idxLocalInfo = { index: lIdx, type: wType };
				} else {
					idxLocalInfo =
						this.resolveLocal(lhs[0].name) ??
						this.mod.resolveGlobal(lhs[0].name);
				}
			}

			// Outer block for break
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("break", stmt.label);

			// Middle loop
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushControl("loop", stmt.label);

			// Condition: idx >= limit -> break
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "local.get", index: limitTmp });
			this.pushInstruction("i32.ge_s");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });

			// Inner block for continue
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("continue", stmt.label);

			// Assign loop var if present
			if (idxLocalInfo) {
				this.pushInstruction({ op: "local.get", index: idxTmp });
				if (idxLocalInfo.type === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				if (this.resolveLocal(lhs[0].name)) {
					this.pushInstruction({
						op: "local.set",
						index: idxLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: idxLocalInfo.index,
					});
				}
			}

			// Emit body
			const bodyBlock = stmt.body ?? stmt.block;
			if (bodyBlock) {
				this.emitBlock(bodyBlock);
			}

			// End continue
			this.pushInstruction("end");

			// Post: idx++
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: idxTmp });

			// Loop back
			this.pushInstruction({ op: "br", depth: 0 });

			// End loop
			this.pushInstruction("end");

			// End break
			this.pushInstruction("end");

			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(limitTmp, "i32");
			restoreShadowed();
			return;
		}

		if (isStringType(iterType, this.mod.checker)) {
			const strTmp = this.acquireTemp("externref");
			this.emitExpr(iterExpr, "externref");
			this.pushInstruction({ op: "local.set", index: strTmp });

			const lenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: lenTmp });

			const idxTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: idxTmp });

			let idxLocalInfo = null;
			if (lhs[0] && lhs[0].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[0].name, "i64", {
						kind: "basic",
						name: "int",
					});
					idxLocalInfo = { index: lIdx, type: "i64" };
				} else {
					idxLocalInfo =
						this.resolveLocal(lhs[0].name) ??
						this.mod.resolveGlobal(lhs[0].name);
				}
			}

			let valLocalInfo = null;
			if (lhs[1] && lhs[1].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[1].name, "i32", {
						kind: "basic",
						name: "rune",
					});
					valLocalInfo = { index: lIdx, type: "i32" };
				} else {
					valLocalInfo =
						this.resolveLocal(lhs[1].name) ??
						this.mod.resolveGlobal(lhs[1].name);
				}
			}

			// Outer block for break
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("break", stmt.label);

			// Middle loop
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushControl("loop", stmt.label);

			// Condition: idx >= len -> break
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction("i32.ge_s");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });

			// Inner block for continue
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("continue", stmt.label);

			const runeTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringCodePointAtImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: runeTmp });

			// Assign index variable
			if (idxLocalInfo) {
				this.pushInstruction({ op: "local.get", index: idxTmp });
				this.pushInstruction("i64.extend_i32_s");
				if (this.resolveLocal(lhs[0].name)) {
					this.pushInstruction({
						op: "local.set",
						index: idxLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: idxLocalInfo.index,
					});
				}
			}

			// Assign rune variable
			if (valLocalInfo) {
				this.pushInstruction({ op: "local.get", index: runeTmp });
				if (valLocalInfo.type === "i64") {
					this.pushInstruction("i64.extend_i32_u");
				}
				if (this.resolveLocal(lhs[1].name)) {
					this.pushInstruction({
						op: "local.set",
						index: valLocalInfo.index,
					});
				} else {
					this.pushInstruction({
						op: "global.set",
						index: valLocalInfo.index,
					});
				}
			}

			// Body
			const bodyBlock = stmt.body ?? stmt.block;
			if (bodyBlock) {
				this.emitBlock(bodyBlock);
			}

			// End continue block
			this.pushInstruction("end");

			// Advance idxTmp: idx += (rune > 0xffff ? 2 : 1)
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction({ op: "local.get", index: runeTmp });
			this.pushInstruction({ op: "i32.const", value: 65535 });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("else");
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("end");
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: idxTmp });

			// Repeat loop
			this.pushInstruction({ op: "br", depth: 0 });

			// End loop
			this.pushInstruction("end");

			// End break block
			this.pushInstruction("end");

			this.releaseTemp(runeTmp, "i32");
			this.releaseTemp(idxTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
			this.releaseTemp(strTmp, "externref");
			restoreShadowed();
			return;
		}

		if (isMapType(iterType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(
				iterType,
				this.mod.checker,
			);
			const mapInfo = this.mod.getMapType(keyType, valType);

			const mapTmp = this.acquireTemp(mapInfo.wType);
			this.emitExpr(iterExpr, mapInfo.wType);
			this.pushInstruction({ op: "local.set", index: mapTmp });

			// Outer block for break
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("break", stmt.label);

			// If map is nil: break immediately
			this.pushInstruction({ op: "local.get", index: mapTmp });
			this.pushInstruction("ref.is_null");
			const earlyBreakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: earlyBreakDepth });

			const currIdxTmp = this.acquireTemp("i32");
			const nextIdxTmp = this.acquireTemp("i32");
			const entryTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: mapInfo.entryTypeIndex,
			});

			// currIdx = map.head (field 5)
			this.pushInstruction({ op: "local.get", index: mapTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.typeIndex,
				fieldIndex: 5,
			});
			this.pushInstruction({ op: "local.set", index: currIdxTmp });

			let keyLocalInfo = null;
			if (lhs[0] && lhs[0].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[0].name, mapInfo.keyWType, keyType);
					keyLocalInfo = { index: lIdx, type: mapInfo.keyWType };
				} else {
					keyLocalInfo =
						this.resolveLocal(lhs[0].name) ??
						this.mod.resolveGlobal(lhs[0].name);
				}
			}

			let valLocalInfo = null;
			if (lhs[1] && lhs[1].name !== "_") {
				if (!isAssign) {
					const lIdx = this.allocLocal(lhs[1].name, mapInfo.valWType, valType);
					valLocalInfo = { index: lIdx, type: mapInfo.valWType };
				} else {
					valLocalInfo =
						this.resolveLocal(lhs[1].name) ??
						this.mod.resolveGlobal(lhs[1].name);
				}
			}

			// Loop block
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushControl("loop", stmt.label);

			// Condition: currIdx == -1 -> break
			this.pushInstruction({ op: "local.get", index: currIdxTmp });
			this.pushInstruction({ op: "i32.const", value: -1 });
			this.pushInstruction("i32.eq");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });

			// entry = map.entries[currIdx]
			this.pushInstruction({ op: "local.get", index: mapTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.get", index: currIdxTmp });
			this.pushInstruction({
				op: "array.get",
				typeIndex: mapInfo.entriesTypeIndex,
			});
			this.pushInstruction({ op: "local.set", index: entryTmp });

			// nextIdx = entry.order_next (field 4)
			this.pushInstruction({ op: "local.get", index: entryTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.entryTypeIndex,
				fieldIndex: 4,
			});
			this.pushInstruction({ op: "local.set", index: nextIdxTmp });

			// If entry.active == 0 (field 5): currIdx = nextIdx; br 0 (continue next iteration)
			this.pushInstruction({ op: "local.get", index: entryTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: mapInfo.entryTypeIndex,
				fieldIndex: 5,
			});
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.eq");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: nextIdxTmp });
			this.pushInstruction({ op: "local.set", index: currIdxTmp });
			this.pushInstruction({ op: "br", depth: 1 });
			this.pushInstruction("end");

			// Inner block for continue
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushControl("continue", stmt.label);

			// Assign key variable
			if (keyLocalInfo) {
				this.pushInstruction({ op: "local.get", index: entryTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: mapInfo.entryTypeIndex,
					fieldIndex: 0,
				});
				if (this.resolveLocal(lhs[0].name)) {
					this.pushInstruction({ op: "local.set", index: keyLocalInfo.index });
				} else {
					this.pushInstruction({
						op: "global.set",
						index: keyLocalInfo.index,
					});
				}
			}

			// Assign val variable
			if (valLocalInfo) {
				this.pushInstruction({ op: "local.get", index: entryTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: mapInfo.entryTypeIndex,
					fieldIndex: 1,
				});
				const isValStruct =
					isStructType(valType, this.mod.checker, this.mod) &&
					!isPointerToStruct(valType, this.mod.checker, this.mod);
				if (isValStruct) {
					const sInfo = this._resolveStructInfo({ _type: valType });
					if (sInfo) {
						this.emitCloneStruct(sInfo, mapInfo.valWType);
					}
				}
				if (this.resolveLocal(lhs[1].name)) {
					this.pushInstruction({ op: "local.set", index: valLocalInfo.index });
				} else {
					this.pushInstruction({
						op: "global.set",
						index: valLocalInfo.index,
					});
				}
			}

			// Body
			const bodyBlock = stmt.body ?? stmt.block;
			if (bodyBlock) {
				this.emitBlock(bodyBlock);
			}

			// End continue block
			this.pushInstruction("end");

			// Advance: currIdx = nextIdx
			this.pushInstruction({ op: "local.get", index: nextIdxTmp });
			this.pushInstruction({ op: "local.set", index: currIdxTmp });

			// Loop back
			this.pushInstruction({ op: "br", depth: 0 });

			// End loop
			this.pushInstruction("end");

			// End break
			this.pushInstruction("end");

			this.releaseTemp(entryTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: mapInfo.entryTypeIndex,
			});
			this.releaseTemp(nextIdxTmp, "i32");
			this.releaseTemp(currIdxTmp, "i32");
			this.releaseTemp(mapTmp, mapInfo.wType);
			restoreShadowed();
			return;
		}

		// Slice or Array range
		const isSlice = isSliceType(iterType, this.mod.checker);
		const isPtrToArr =
			iterType?.kind === "pointer" &&
			isArrayType(iterType.base, this.mod.checker);

		const elemGoType = isSlice
			? iterType.elem
			: isPtrToArr
				? iterType.base.elem
				: iterType.elem;
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const arrTmp = this.acquireTemp(arrWType);
		const offTmp = this.acquireTemp("i32");
		const lenTmp = this.acquireTemp("i32");

		if (isSlice) {
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const sliceTmp = this.acquireTemp(sliceWType);
			this.emitExpr(iterExpr, sliceWType);
			this.pushInstruction({ op: "local.set", index: sliceTmp });

			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.set", index: offTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: lenTmp });
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			this.emitExpr(iterExpr, arrWType);
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: offTmp });
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("array.len");
			this.pushInstruction({ op: "local.set", index: lenTmp });
		}

		const idxTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: idxTmp });

		let idxLocalInfo = null;
		if (lhs[0] && lhs[0].name !== "_") {
			if (!isAssign) {
				const bodyBlock = stmt.body ?? stmt.block;
				const isNonEscaping =
					!this.mutatedCaptures?.has(lhs[0].name) &&
					!this.capturedNames?.includes(lhs[0].name) &&
					!this._varMutatesOrEscapes(bodyBlock, lhs[0].name);
				const wType = isNonEscaping ? "i32" : "i64";
				const lIdx = this.allocLocal(lhs[0].name, wType, {
					kind: "basic",
					name: "int",
				});
				idxLocalInfo = { index: lIdx, type: wType };
			} else {
				idxLocalInfo =
					this.resolveLocal(lhs[0].name) ?? this.mod.resolveGlobal(lhs[0].name);
			}
		}

		let valLocalInfo = null;
		if (lhs[1] && lhs[1].name !== "_") {
			if (!isAssign) {
				const lIdx = this.allocLocal(
					lhs[1].name,
					arrInfo.elemWType,
					elemGoType,
				);
				valLocalInfo = { index: lIdx, type: arrInfo.elemWType };
			} else {
				valLocalInfo =
					this.resolveLocal(lhs[1].name) ?? this.mod.resolveGlobal(lhs[1].name);
			}
		}

		// Outer block for break
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		// Middle loop
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushControl("loop", stmt.label);

		// Condition: idx >= len -> break
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		const breakDepth = this.resolveBranchDepth(stmt.label, false);
		this.pushInstruction({ op: "br_if", depth: breakDepth });

		// Inner block for continue
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("continue", stmt.label);

		// Assign idx
		if (idxLocalInfo) {
			this.pushInstruction({ op: "local.get", index: idxTmp });
			if (idxLocalInfo.type === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			}
			if (this.resolveLocal(lhs[0].name)) {
				this.pushInstruction({ op: "local.set", index: idxLocalInfo.index });
			} else {
				this.pushInstruction({
					op: "global.set",
					index: idxLocalInfo.index,
				});
			}
		}

		// Assign val
		if (valLocalInfo) {
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: offTmp });
			this.pushInstruction({ op: "local.get", index: idxTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({
				op: "array.get",
				typeIndex: arrInfo.typeIndex,
			});
			if (
				isStructType(elemGoType, this.mod.checker, this.mod) &&
				!isPointerToStruct(elemGoType, this.mod.checker, this.mod)
			) {
				const sInfo = this._resolveStructInfo({ _type: elemGoType });
				if (sInfo) {
					this.emitCloneStruct(sInfo, arrInfo.elemWType);
				}
			}
			if (this.resolveLocal(lhs[1].name)) {
				this.pushInstruction({ op: "local.set", index: valLocalInfo.index });
			} else {
				this.pushInstruction({
					op: "global.set",
					index: valLocalInfo.index,
				});
			}
		}

		// Body
		const bodyBlock = stmt.body ?? stmt.block;
		if (bodyBlock) {
			this.emitBlock(bodyBlock);
		}

		// End continue
		this.pushInstruction("end");

		// Post: idx++
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: idxTmp });

		// Loop back
		this.pushInstruction({ op: "br", depth: 0 });

		// End loop
		this.pushInstruction("end");

		// End break
		this.pushInstruction("end");

		this.releaseTemp(idxTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, arrWType);

		restoreShadowed();
	}

	emitForStmt(stmt) {
		if (isRangeFor(stmt) || stmt.cond?.kind === "RangeExpr") {
			this.emitRangeForStmt(stmt);
			return;
		}

		const iv = this._detectInductionVar(stmt);
		let prevLocal = null;
		let ivLocalInfo = null;

		if (iv) {
			prevLocal = this.locals.get(iv.name);
			const lIdx = this.allocLocal(
				iv.name,
				"i32",
				{ kind: "basic", name: "int" },
				false,
			);
			ivLocalInfo = this.locals.get(iv.name);
			ivLocalInfo.isInductionVar = true;
			this.emitExpr(iv.initExpr, "i32");
			this.pushInstruction({ op: "local.set", index: lIdx });
		} else if (stmt.init) {
			this.emitStmt(stmt.init);
		}

		// Outer block for break
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		// Middle loop for repeating iterations
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushControl("loop", stmt.label);

		if (stmt.cond) {
			this.emitExpr(stmt.cond, "i32");
			this.pushInstruction("i32.eqz");
			const breakDepth = this.resolveBranchDepth(stmt.label, false);
			this.pushInstruction({ op: "br_if", depth: breakDepth });
		}

		// Inner block for continue
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("continue", stmt.label);

		const bodyBlock = stmt.body ?? stmt.block;
		if (bodyBlock) {
			this.emitBlock(bodyBlock);
		}

		// End inner continue block
		this.pushInstruction("end");

		if (iv) {
			this.pushInstruction({ op: "local.get", index: ivLocalInfo.index });
			this.pushInstruction({ op: "i32.const", value: iv.step });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: ivLocalInfo.index });
		} else if (stmt.post) {
			this.emitStmt(stmt.post);
		}

		// Repeat loop: branch back to loop block
		this.pushInstruction({ op: "br", depth: 0 });

		// End loop
		this.pushInstruction("end");

		// End outer break block
		this.pushInstruction("end");

		if (iv) {
			if (prevLocal) {
				this.locals.set(iv.name, prevLocal);
			} else {
				this.locals.delete(iv.name);
			}
		}
	}

	_detectInductionVar(stmt) {
		if (stmt.init?.kind !== "DefineStmt") return null;
		const lhs = stmt.init.lhs ?? [];
		if (lhs.length !== 1 || lhs[0].kind !== "Ident") return null;
		const varName = lhs[0].name;
		if (!varName || varName === "_") return null;

		const rhs = stmt.init.rhs ?? [];
		if (rhs.length !== 1) return null;
		const initRhs = rhs[0];

		// Initial value must be a non-negative integer literal < 2^31 or i32 expr
		let initOk = false;
		if (initRhs.kind === "BasicLit" && initRhs.litKind === "INT") {
			const val = BigInt(initRhs.value);
			if (val >= 0n && val < 2147483648n) initOk = true;
		} else if (this.toWasmType(initRhs._type) === "i32") {
			initOk = true;
		}
		if (!initOk) return null;

		// Post statement must increment varName by a constant > 0
		let step = null;
		if (stmt.post) {
			if (
				stmt.post.kind === "IncDecStmt" &&
				stmt.post.expr?.kind === "Ident" &&
				stmt.post.expr.name === varName &&
				stmt.post.op === "++"
			) {
				step = 1;
			} else if (
				stmt.post.kind === "CompoundAssignStmt" &&
				stmt.post.lhs?.length === 1 &&
				stmt.post.lhs[0].kind === "Ident" &&
				stmt.post.lhs[0].name === varName &&
				stmt.post.op === "+=" &&
				stmt.post.rhs?.length === 1 &&
				stmt.post.rhs[0].kind === "BasicLit" &&
				stmt.post.rhs[0].litKind === "INT"
			) {
				const sVal = BigInt(stmt.post.rhs[0].value);
				if (sVal > 0n && sVal < 2147483648n) step = Number(sVal);
			}
		}
		if (step === null) return null;

		// Condition must bound varName (< bound or <= bound) where bound < 2^31
		const boundNode = this._findInductionBound(stmt.cond, varName);
		if (!boundNode) return null;
		// The last `i += step` must not wrap i32: i can reach bound + step - 1.
		if (
			boundNode.kind === "BasicLit" &&
			BigInt(boundNode.value) + BigInt(step) > 2147483647n
		) {
			return null;
		}

		// Check escaping and mutation in body
		if (this.mutatedCaptures?.has(varName)) return null;
		if (this.capturedNames?.includes(varName)) return null;

		const bodyBlock = stmt.body ?? stmt.block;
		if (bodyBlock && this._varMutatesOrEscapes(bodyBlock, varName)) {
			return null;
		}

		return { name: varName, initExpr: initRhs, step };
	}

	_findInductionBound(cond, varName) {
		if (!cond) return null;
		if (cond.kind === "BinaryExpr") {
			if (
				(cond.op === "<" || cond.op === "<=") &&
				cond.left?.kind === "Ident" &&
				cond.left.name === varName
			) {
				const right = cond.right;
				if (
					right?.kind === "CallExpr" &&
					right.func?.kind === "Ident" &&
					(right.func.name === "len" || right.func.name === "cap")
				) {
					return right;
				}
				if (right?.kind === "BasicLit" && right.litKind === "INT") {
					const val = BigInt(right.value);
					if (val >= 0n && val < 2147483648n) return right;
					return null;
				}
				if (this.toWasmType(right?._type) === "i32") {
					return right;
				}
				return null;
			}
			if (cond.op === "&&") {
				return (
					this._findInductionBound(cond.left, varName) ??
					this._findInductionBound(cond.right, varName)
				);
			}
		}
		return null;
	}

	_varMutatesOrEscapes(node, varName) {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) {
			return node.some((item) => this._varMutatesOrEscapes(item, varName));
		}
		if (
			node.kind === "UnaryExpr" &&
			node.op === "&" &&
			node.operand?.kind === "Ident" &&
			node.operand.name === varName
		) {
			return true;
		}
		if (node.kind === "FuncLit") {
			if (this._findIdentInAST(node, varName)) return true;
		}
		if (node.kind === "AssignStmt" || node.kind === "CompoundAssignStmt") {
			const lhs = node.lhs ?? [];
			for (const l of lhs) {
				if (l.kind === "Ident" && l.name === varName) return true;
			}
		}
		if (node.kind === "IncDecStmt") {
			if (node.expr?.kind === "Ident" && node.expr.name === varName)
				return true;
		}
		if (node.kind === "DefineStmt") {
			const lhs = node.lhs ?? [];
			for (const l of lhs) {
				if (l.kind === "Ident" && l.name === varName) return true;
			}
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (this._varMutatesOrEscapes(node[key], varName)) return true;
		}
		return false;
	}

	_findIdentInAST(node, name) {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) {
			return node.some((item) => this._findIdentInAST(item, name));
		}
		if (node.kind === "Ident" && node.name === name) return true;
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (this._findIdentInAST(node[key], name)) return true;
		}
		return false;
	}

	emitSwitchStmt(stmt) {
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		if (stmt.init) this.emitStmt(stmt.init);

		const getCaseVals = (c) => c.list ?? c.values ?? [];

		if (stmt.tag) {
			const tagGoType = stmt.tag._type ?? this._resolveExprGoType(stmt.tag);
			const tagWType = this.toWasmType(tagGoType);
			const tagTmp = this.acquireTemp(tagWType);
			this.emitExpr(stmt.tag, tagWType);
			this.pushInstruction({ op: "local.set", index: tagTmp });

			const nonDefaultCases = (stmt.cases ?? []).filter(
				(c) => getCaseVals(c).length > 0,
			);
			const defaultCase = (stmt.cases ?? []).find(
				(c) => getCaseVals(c).length === 0,
			);

			let ifCount = 0;
			for (const c of nonDefaultCases) {
				const vals = getCaseVals(c);
				for (let i = 0; i < vals.length; i++) {
					this.pushInstruction({ op: "local.get", index: tagTmp });
					this.emitExpr(vals[i], tagWType);
					this.emitBinaryOp("==", tagWType, tagGoType);
					if (i > 0) this.pushInstruction("i32.or");
				}
				this.pushInstruction({ op: "if", blockType: "void" });
				ifCount++;

				for (const s of c.stmts ?? []) this.emitStmt(s);
				this.pushInstruction("else");
			}

			if (defaultCase) {
				for (const s of defaultCase.stmts ?? []) this.emitStmt(s);
			}

			for (let i = 0; i < ifCount; i++) {
				this.pushInstruction("end");
			}
			this.releaseTemp(tagTmp, tagWType);
		} else {
			const nonDefaultCases = (stmt.cases ?? []).filter(
				(c) => getCaseVals(c).length > 0,
			);
			const defaultCase = (stmt.cases ?? []).find(
				(c) => getCaseVals(c).length === 0,
			);

			let ifCount = 0;
			for (const c of nonDefaultCases) {
				const vals = getCaseVals(c);
				for (let i = 0; i < vals.length; i++) {
					this.emitExpr(vals[i], "i32");
					if (i > 0) this.pushInstruction("i32.or");
				}
				this.pushInstruction({ op: "if", blockType: "void" });
				ifCount++;

				for (const s of c.stmts ?? []) this.emitStmt(s);
				this.pushInstruction("else");
			}

			if (defaultCase) {
				for (const s of defaultCase.stmts ?? []) this.emitStmt(s);
			}

			for (let i = 0; i < ifCount; i++) {
				this.pushInstruction("end");
			}
		}

		this.pushInstruction("end");
	}

	emitTypeSwitchStmt(stmt) {
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("break", stmt.label);

		const prevAssignLocal = stmt.assign ? this.locals.get(stmt.assign) : null;

		const tswTmp = this.acquireTemp("anyref");
		this.emitExpr(stmt.expr, "anyref");
		this.pushInstruction({ op: "local.set", index: tswTmp });

		const getCaseTypes = (c) => c.types ?? c.list ?? [];

		const nonDefaultCases = (stmt.cases ?? []).filter(
			(c) => getCaseTypes(c).length > 0,
		);
		const defaultCase = (stmt.cases ?? []).find(
			(c) => getCaseTypes(c).length === 0,
		);

		let ifCount = 0;
		for (const c of nonDefaultCases) {
			const types = getCaseTypes(c);
			for (let i = 0; i < types.length; i++) {
				this.pushInstruction({ op: "local.get", index: tswTmp });
				this._emitTypeTest(types[i]._type ?? types[i]);
				if (i > 0) {
					this.pushInstruction("i32.or");
				}
			}
			this.pushInstruction({ op: "if", blockType: "void" });
			ifCount++;

			if (stmt.assign) {
				const targetGoType =
					types.length === 1
						? (types[0]._type ?? types[0])
						: { kind: "basic", name: "any" };
				const targetWType = this.toWasmType(targetGoType);
				const assignLocal = this.allocLocal(
					stmt.assign,
					targetWType,
					targetGoType,
				);
				if (types.length === 1) {
					this.pushInstruction({ op: "local.get", index: tswTmp });
					this._emitTypeCast(targetGoType, targetWType);
				} else {
					this.pushInstruction({ op: "local.get", index: tswTmp });
				}
				this.pushInstruction({ op: "local.set", index: assignLocal });
			}

			for (const s of c.stmts ?? []) {
				this.emitStmt(s);
			}

			this.pushInstruction("else");
		}

		if (defaultCase) {
			if (stmt.assign) {
				const assignLocal = this.allocLocal(stmt.assign, "anyref", {
					kind: "basic",
					name: "any",
				});
				this.pushInstruction({ op: "local.get", index: tswTmp });
				this.pushInstruction({ op: "local.set", index: assignLocal });
			}
			for (const s of defaultCase.stmts ?? []) {
				this.emitStmt(s);
			}
		}

		for (let i = 0; i < ifCount; i++) {
			this.pushInstruction("end");
		}

		this.releaseTemp(tswTmp, "anyref");

		if (prevAssignLocal) {
			this.locals.set(stmt.assign, prevAssignLocal);
		} else if (stmt.assign) {
			this.locals.delete(stmt.assign);
		}

		this.pushInstruction("end");
	}

	emitBranchStmt(stmt) {
		const isContinue = stmt.keyword === "continue";
		const depth = this.resolveBranchDepth(stmt.label, isContinue);
		this.pushInstruction({ op: "br", depth });
	}

	emitReturnStmt(stmt) {
		const values = stmt.values ?? [];
		if (this.hasDefer) {
			if (this.namedReturnVars?.length > 0) {
				if (values.length === 0) {
					// Naked return: named return vars already hold their values
				} else if (values.length === 1 && this.namedReturnVars.length > 1) {
					// Multi-value call: leaves results on stack
					this.emitExpr(values[0]);
					for (let i = this.namedReturnVars.length - 1; i >= 0; i--) {
						this._assignToNamedReturnVar(this.namedReturnVars[i]);
					}
				} else {
					// Evaluate all values into temporary locals first
					const temps = [];
					for (let i = 0; i < values.length; i++) {
						const val = values[i];
						const targetWType = this.returnTypes[i] ?? null;
						const isValStruct =
							isStructType(val._type, this.mod.checker, this.mod) &&
							!isPointerToStruct(val._type, this.mod.checker, this.mod);
						const isFresh =
							val.kind === "CompositeLit" ||
							(val.kind === "UnaryExpr" && val.op === "*");
						this.emitExpr(val, targetWType);
						if (isValStruct && !isFresh) {
							const sInfo = this._resolveStructInfo(val);
							if (sInfo) {
								this.emitCloneStruct(sInfo, targetWType);
							}
						}
						const tmp = this.acquireTemp(targetWType);
						this.pushInstruction({ op: "local.set", index: tmp });
						temps.push({ tmp, type: targetWType });
					}
					for (let i = 0; i < temps.length; i++) {
						this.pushInstruction({ op: "local.get", index: temps[i].tmp });
						this._assignToNamedReturnVar(this.namedReturnVars[i]);
						this.releaseTemp(temps[i].tmp, temps[i].type);
					}
				}
			} else if (this.returnTempLocals?.length > 0) {
				if (values.length === 1 && this.returnTempLocals.length > 1) {
					this.emitExpr(values[0]);
					for (let i = this.returnTempLocals.length - 1; i >= 0; i--) {
						this.pushInstruction({
							op: "local.set",
							index: this.returnTempLocals[i],
						});
					}
				} else {
					for (let i = 0; i < values.length; i++) {
						const val = values[i];
						const targetWType = this.returnTypes[i] ?? null;
						const isValStruct =
							isStructType(val._type, this.mod.checker, this.mod) &&
							!isPointerToStruct(val._type, this.mod.checker, this.mod);
						const isFresh =
							val.kind === "CompositeLit" ||
							(val.kind === "UnaryExpr" && val.op === "*");
						this.emitExpr(val, targetWType);
						if (isValStruct && !isFresh) {
							const sInfo = this._resolveStructInfo(val);
							if (sInfo) {
								this.emitCloneStruct(sInfo, targetWType);
							}
						}
						this.pushInstruction({
							op: "local.set",
							index: this.returnTempLocals[i],
						});
					}
				}
			}
			const depth = this.resolveBranchDepthToRole("runDefers");
			this.pushInstruction({ op: "br", depth });
			return;
		}

		if (values.length === 0 && this.namedReturnVars?.length > 0) {
			for (const nr of this.namedReturnVars) {
				const loc = this.locals.get(nr.name);
				if (loc.isBoxed) {
					this.pushInstruction({ op: "local.get", index: loc.index });
					this.pushInstruction({
						op: "struct.get",
						typeIndex: loc.boxInfo.typeIndex,
						fieldIndex: 0,
					});
				} else {
					this.pushInstruction({ op: "local.get", index: loc.index });
				}
			}
			this.pushInstruction("return");
			return;
		}

		for (let i = 0; i < values.length; i++) {
			const val = values[i];
			const targetWType = this.returnTypes[i] ?? null;
			const isValStruct =
				isStructType(val._type, this.mod.checker, this.mod) &&
				!isPointerToStruct(val._type, this.mod.checker, this.mod);
			const isFresh =
				val.kind === "CompositeLit" ||
				(val.kind === "UnaryExpr" && val.op === "*");
			this.emitExpr(val, targetWType);
			if (isValStruct && !isFresh) {
				const sInfo = this._resolveStructInfo(val);
				if (sInfo) {
					this.emitCloneStruct(sInfo, targetWType);
				}
			}
		}
		this.pushInstruction("return");
	}

	_assignToNamedReturnVar(nr) {
		const loc = this.locals.get(nr.name);
		if (loc.isBoxed) {
			const valTmp = this.acquireTemp(loc.boxInfo.wType);
			this.pushInstruction({ op: "local.set", index: valTmp });
			this.pushInstruction({ op: "local.get", index: loc.index });
			this.pushInstruction({ op: "local.get", index: valTmp });
			this.pushInstruction({
				op: "struct.set",
				typeIndex: loc.boxInfo.typeIndex,
				fieldIndex: 0,
			});
			this.releaseTemp(valTmp, loc.boxInfo.wType);
		} else {
			this.pushInstruction({ op: "local.set", index: loc.index });
		}
	}

	emitExprStmt(stmt) {
		this.emitExpr(stmt.expr);
		const goType = stmt.expr._type;
		if (!goType || goType.name === "void") return;
		if (goType.kind === "tuple" || goType.kind === "TupleType") {
			for (const _ of goType.types ?? []) {
				this.pushInstruction("drop");
			}
			return;
		}
		const wType = this.toWasmType(goType);
		if (wType) {
			this.pushInstruction("drop");
		}
	}

	// ── Expressions ────────────────────────────────────────────

	emitExpr(expr, targetWasmType = null) {
		if (!expr) return;

		if (targetWasmType === "anyref") {
			if (
				(expr.kind === "Ident" && expr.name === "nil") ||
				(expr.kind === "BasicLit" && expr.litKind === "NIL")
			) {
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				return;
			}

			const goType = this._resolveExprGoType(expr);
			if (isAnyType(goType, this.mod.checker)) {
				this._emitRawExpr(expr, "anyref");
				return;
			}

			if (
				isStringType(goType, this.mod.checker) ||
				(expr.kind === "BasicLit" && expr.litKind === "STRING")
			) {
				this._emitRawExpr(expr, "externref");
				this.pushInstruction("any.convert_extern");
				return;
			}

			// `*T` in an interface is the struct ref itself (no allocation: the
			// hot Go pattern `var c Collider = &tm`).  A struct *value* is a
			// cloned ref wrapped in a one-field box so T and *T stay distinct
			// for type switches and assertions.
			if (isPointerToStruct(goType, this.mod.checker, this.mod)) {
				this._emitRawExpr(expr, this.toWasmType(goType));
				return;
			}
			if (isStructType(goType, this.mod.checker, this.mod)) {
				const structWType = this.toWasmType(goType);
				this._emitRawExpr(expr, structWType);
				const isFresh =
					expr.kind === "CompositeLit" ||
					(expr.kind === "UnaryExpr" && expr.op === "*");
				if (!isFresh) {
					const sInfo =
						this._resolveStructInfo(expr) ??
						this.mod.getStructType(goType?.name);
					if (sInfo) {
						this.emitCloneStruct(sInfo, structWType);
					}
				}
				const box = this.mod.getBoxType(goType);
				this.pushInstruction({ op: "struct.new", typeIndex: box.typeIndex });
				return;
			}

			if (
				isSliceType(goType, this.mod.checker) ||
				isArrayType(goType, this.mod.checker) ||
				isFuncType(goType, this.mod.checker) ||
				isMapType(goType, this.mod.checker)
			) {
				const refWType = this.toWasmType(goType);
				this._emitRawExpr(expr, refWType);
				return;
			}

			// Scalar type -> box into struct
			const scalarType = goType ?? { kind: "basic", name: "int" };
			const box = this.mod.getBoxType(scalarType);
			this._emitRawExpr(expr, box.wType);
			this.pushInstruction({ op: "struct.new", typeIndex: box.typeIndex });
			return;
		}

		this._emitRawExpr(expr, targetWasmType);
	}

	_resolveExprGoType(expr) {
		if (expr._type) return expr._type;
		if (expr.kind === "BasicLit") {
			switch (expr.litKind) {
				case "INT":
					return { kind: "basic", name: "int" };
				case "FLOAT":
					return { kind: "basic", name: "float64" };
				case "STRING":
					return { kind: "basic", name: "string" };
				case "BOOL":
					return { kind: "basic", name: "bool" };
				case "NIL":
					return { kind: "nil", name: "nil" };
			}
		}
		if (expr.kind === "Ident") {
			const local = this.resolveLocal(expr.name);
			if (local) return local.goType;
			if (this.cachedGlobals.has(expr.name)) {
				return this.cachedGlobals.get(expr.name).globalInfo.goType;
			}
			const global = this.mod.resolveGlobal(expr.name);
			if (global) return global.goType;
		}
		return null;
	}

	_emitRawExpr(expr, targetWasmType = null) {
		switch (expr.kind) {
			case "BasicLit":
				this.emitBasicLit(expr, targetWasmType);
				break;

			case "Ident":
				this.emitIdent(expr, targetWasmType);
				break;

			case "UnaryExpr":
				this.emitUnaryExpr(expr, targetWasmType);
				break;

			case "BinaryExpr":
				this.emitBinaryExpr(expr, targetWasmType);
				break;

			case "CallExpr":
				this.emitCallExpr(expr, targetWasmType);
				break;

			case "TypeConversion":
				this.emitTypeConversion(expr);
				break;

			case "CompositeLit":
				this.emitCompositeLit(expr);
				break;

			case "SelectorExpr": {
				const deq = this._dequalify(expr);
				if (deq) this.emitIdent(deq, targetWasmType);
				else if (this._isMathConst(expr))
					this.emitMathConst(expr.field, targetWasmType);
				else this.emitSelectorExpr(expr);
				break;
			}

			case "IndexExpr":
				this.emitIndexExpr(expr, targetWasmType);
				break;

			case "SliceExpr":
				this.emitSliceExpr(expr);
				break;

			case "ParenExpr":
				this.emitExpr(expr.expr, targetWasmType);
				break;

			case "FuncLit":
				this.emitFuncLit(expr, targetWasmType);
				break;

			case "TypeAssertExpr": {
				const targetGoType = expr._type ?? expr.type;
				const targetWType = targetWasmType ?? this.toWasmType(targetGoType);
				const anyTmp = this.acquireTemp("anyref");
				this.emitExpr(expr.expr, "anyref");
				this.pushInstruction({ op: "local.set", index: anyTmp });

				this.pushInstruction({ op: "local.get", index: anyTmp });
				this._emitTypeTest(targetGoType);
				this.pushInstruction("i32.eqz");
				this.pushInstruction({ op: "if", blockType: "void" });
				this.emitPanic("interface conversion: type assertion failed");
				this.pushInstruction("end");

				this.pushInstruction({ op: "local.get", index: anyTmp });
				this._emitTypeCast(targetGoType, targetWType);
				this.releaseTemp(anyTmp, "anyref");
				break;
			}

			default:
				throw new Error(`Unsupported expression kind: ${expr.kind}`);
		}
	}

	emitFuncLit(funcLit) {
		const liftedFn = funcLit._liftedFn;
		const globalFuncIdx = liftedFn._globalFuncIndex;
		const closureInfo = this.mod.getClosureType(funcLit._type ?? funcLit);

		// 1. Function reference
		this.pushInstruction({ op: "ref.func", funcIndex: globalFuncIdx });

		// 2. Environment reference
		const capturedNames = Array.from(
			this.captureAnalysis?.capturesByClosure?.get(funcLit) ?? [],
		).sort();

		if (capturedNames.length === 0) {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		} else {
			const envFields = [];
			for (const name of capturedNames) {
				const isBoxed = this.mutatedCaptures.has(name);
				const goType = this._findCapturedVarGoType(name);
				if (isBoxed) {
					const boxInfo = this.mod.getBoxType(goType);
					envFields.push({
						name,
						goType,
						isBoxed: true,
						boxInfo,
						wType: {
							kind: "ref",
							nullable: true,
							typeIndex: boxInfo.typeIndex,
						},
					});
				} else {
					const wType = this.toWasmType(goType);
					envFields.push({
						name,
						goType,
						isBoxed: false,
						boxInfo: null,
						wType,
					});
				}
			}

			const envInfo = this.mod.getEnvType(envFields);

			for (const field of envFields) {
				const local = this.resolveLocal(field.name);
				if (!local) {
					throw new Error(
						`Captured variable '${field.name}' not found in locals`,
					);
				}
				this.pushInstruction({ op: "local.get", index: local.index });
			}

			this.pushInstruction({
				op: "struct.new",
				typeIndex: envInfo.typeIndex,
			});
		}

		// 3. Closure struct
		this.pushInstruction({
			op: "struct.new",
			typeIndex: closureInfo.typeIndex,
		});
	}

	emitCompositeLit(lit) {
		const litType = lit._type ?? lit.typeExpr?._type ?? lit.typeExpr;
		if (isMapType(litType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(litType, this.mod.checker);
			const mapInfo = this.mod.getMapType(keyType, valType);
			const count = lit.elems?.length ?? 0;
			this.pushInstruction({ op: "i32.const", value: count });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.makeFuncName),
			});
			if (count > 0) {
				const mTmp = this.acquireTemp(mapInfo.wType);
				this.pushInstruction({ op: "local.set", index: mTmp });
				for (const elem of lit.elems) {
					this.pushInstruction({ op: "local.get", index: mTmp });
					this.emitExpr(elem.key, mapInfo.keyWType);
					const isValStruct =
						isStructType(valType, this.mod.checker, this.mod) &&
						!isPointerToStruct(valType, this.mod.checker, this.mod);
					const isFresh =
						elem.value.kind === "CompositeLit" ||
						(elem.value.kind === "UnaryExpr" && elem.value.op === "*");
					this.emitExpr(elem.value, mapInfo.valWType);
					if (isValStruct && !isFresh) {
						const sInfo =
							this._resolveStructInfo(elem.value) ??
							this._resolveStructInfo({ _type: valType });
						if (sInfo) {
							this.emitCloneStruct(sInfo, mapInfo.valWType);
						}
					}
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
					});
				}
				this.pushInstruction({ op: "local.get", index: mTmp });
				this.releaseTemp(mTmp, mapInfo.wType);
			}
			return;
		}

		if (isSliceType(litType, this.mod.checker)) {
			const elemType = litType.elem;
			const sliceInfo = this.mod.getSliceType(elemType);
			const count = lit.elems?.length ?? 0;
			if (count === 0) {
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: sliceInfo.arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "i32.const", value: 0 }); // offset
				this.pushInstruction({ op: "i32.const", value: 0 }); // len
				this.pushInstruction({ op: "i32.const", value: 0 }); // cap
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				return;
			}
			for (const elem of lit.elems) {
				const isValStruct =
					isStructType(elem._type, this.mod.checker, this.mod) &&
					!isPointerToStruct(elem._type, this.mod.checker, this.mod);
				const isFresh =
					elem.kind === "CompositeLit" ||
					(elem.kind === "UnaryExpr" && elem.op === "*");
				this.emitExpr(elem, sliceInfo.elemWType);
				if (isValStruct && !isFresh) {
					const sInfo = this._resolveStructInfo(elem);
					if (sInfo) {
						this.emitCloneStruct(sInfo, sliceInfo.elemWType);
					}
				}
			}
			this.pushInstruction({
				op: "array.new_fixed",
				typeIndex: sliceInfo.arrInfo.typeIndex,
				size: count,
			});
			this.pushInstruction({ op: "i32.const", value: 0 }); // offset
			this.pushInstruction({ op: "i32.const", value: count }); // len
			this.pushInstruction({ op: "i32.const", value: count }); // cap
			this.pushInstruction({
				op: "struct.new",
				typeIndex: sliceInfo.typeIndex,
			});
			return;
		}

		if (isArrayType(litType, this.mod.checker)) {
			const elemType = litType.elem;
			const arrInfo = this.mod.getArrayType(elemType);
			const count = lit.elems?.length ?? 0;
			const targetSize = this._getArraySize(litType, count);
			for (const elem of lit.elems ?? []) {
				const isValStruct =
					isStructType(elem._type, this.mod.checker, this.mod) &&
					!isPointerToStruct(elem._type, this.mod.checker, this.mod);
				const isFresh =
					elem.kind === "CompositeLit" ||
					(elem.kind === "UnaryExpr" && elem.op === "*");
				this.emitExpr(elem, arrInfo.elemWType);
				if (isValStruct && !isFresh) {
					const sInfo = this._resolveStructInfo(elem);
					if (sInfo) {
						this.emitCloneStruct(sInfo, arrInfo.elemWType);
					}
				}
			}
			for (let i = count; i < targetSize; i++) {
				this.emitZeroValue(elemType, arrInfo.elemWType);
			}
			this.pushInstruction({
				op: "array.new_fixed",
				typeIndex: arrInfo.typeIndex,
				size: targetSize,
			});
			return;
		}

		const typeName =
			lit.typeExpr?.name ??
			(litType?.kind === "named" ? litType.name : litType?.name);
		const structInfo = this.mod.getStructType(typeName);
		if (!structInfo) {
			throw new Error(`Unknown struct in CompositeLit: ${typeName}`);
		}

		const fields = structInfo.fields;
		const map = new Map();
		let isKeyed = false;

		for (const elem of lit.elems ?? []) {
			if (elem.kind === "KeyValueExpr") {
				isKeyed = true;
				map.set(elem.key.name, elem.value);
			}
		}

		for (let i = 0; i < fields.length; i++) {
			const f = fields[i];
			if (isKeyed) {
				if (map.has(f.name)) {
					this.emitExpr(map.get(f.name), f.wType);
				} else {
					this.emitZeroValue(f.goType, f.wType);
				}
			} else {
				if (i < (lit.elems?.length ?? 0)) {
					this.emitExpr(lit.elems[i], f.wType);
				} else {
					this.emitZeroValue(f.goType, f.wType);
				}
			}
		}

		this.pushInstruction({ op: "struct.new", typeIndex: structInfo.typeIndex });
	}

	emitSelectorExpr(expr) {
		const structInfo = this._resolveStructInfo(expr.expr);
		if (!structInfo) {
			throw new Error(`Cannot resolve struct for selector: ${expr.field}`);
		}
		const path = this._resolveFieldPath(structInfo, expr.field);
		if (!path) {
			throw new Error(
				`Unknown field '${expr.field}' on struct '${structInfo.name}'`,
			);
		}

		const baseWType = this.toWasmType(expr.expr._type);
		this.emitExpr(expr.expr, baseWType);

		for (let i = 0; i < path.length; i++) {
			const step = path[i];
			this.pushInstruction({
				op: "struct.get",
				typeIndex: step.structInfo.typeIndex,
				fieldIndex: step.fieldIndex,
			});
		}
	}

	emitIndexExpr(expr, targetWasmType = null) {
		const baseNode = expr.expr;
		const baseType = baseNode._type ?? this._resolveExprGoType(baseNode);

		if (isMapType(baseType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(
				baseType,
				this.mod.checker,
			);
			const mapInfo = this.mod.getMapType(keyType, valType);
			this.emitExpr(baseNode, mapInfo.wType);
			this.emitExpr(expr.index, mapInfo.keyWType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.getFuncName),
			});
			return;
		}

		const isSlice = isSliceType(baseType, this.mod.checker);
		const isArr = isArrayType(baseType, this.mod.checker);
		const isPtrToArr =
			baseType?.kind === "pointer" &&
			isArrayType(baseType.base, this.mod.checker);

		const isStr = isStringType(baseType, this.mod.checker);

		if (isStr) {
			const strTmp = this.acquireTemp("externref");
			this.emitExpr(baseNode, "externref");
			this.pushInstruction({ op: "local.tee", index: strTmp });

			this._emitCheckedIndex(expr.index, () => {
				this.pushInstruction({ op: "local.get", index: strTmp });
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringLenImportIndex(),
				});
			});
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringGetImportIndex(),
			});

			this.releaseTemp(strTmp, "externref");

			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}

		if (!isSlice && !isArr && !isPtrToArr) {
			throw new Error(
				`Unsupported IndexExpr on type: ${JSON.stringify(baseType)}`,
			);
		}

		const elemGoType = isSlice
			? baseType.elem
			: isPtrToArr
				? baseType.base.elem
				: baseType.elem;
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = isSlice ? this.mod.getSliceType(elemGoType) : null;

		this._emitElemAddr(baseNode, expr.index, sliceInfo, arrInfo);
		this.pushInstruction({
			op: "array.get",
			typeIndex: arrInfo.typeIndex,
		});
	}

	emitSliceExpr(expr) {
		const baseNode = expr.expr;
		const baseType = baseNode._type;
		const isSlice = isSliceType(baseType, this.mod.checker);
		const isArr = isArrayType(baseType, this.mod.checker);
		const isPtrToArr =
			baseType?.kind === "pointer" &&
			isArrayType(baseType.base, this.mod.checker);

		const isStr = isStringType(baseType, this.mod.checker);

		if (isStr) {
			const strTmp = this.acquireTemp("externref");
			this.emitExpr(baseNode, "externref");
			this.pushInstruction({ op: "local.set", index: strTmp });

			const srcLenTmp = this.acquireTemp("i32");
			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringLenImportIndex(),
			});
			this.pushInstruction({ op: "local.set", index: srcLenTmp });

			const lowTmp = this.acquireTemp("i32");
			const highTmp = this.acquireTemp("i32");

			if (expr.low) {
				this._emitIndexExprToI32(expr.low, lowTmp);
			} else {
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: lowTmp });
			}

			if (expr.high) {
				this._emitIndexExprToI32(expr.high, highTmp);
			} else {
				this.pushInstruction({ op: "local.get", index: srcLenTmp });
				this.pushInstruction({ op: "local.set", index: highTmp });
			}

			// Bounds check: 0 <= low <= high <= srcLenTmp
			this.pushInstruction({ op: "local.get", index: lowTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction({ op: "local.get", index: highTmp });
			this.pushInstruction({ op: "local.get", index: lowTmp });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "local.get", index: highTmp });
			this.pushInstruction({ op: "local.get", index: srcLenTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction("i32.or");

			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
			});
			this.pushInstruction("unreachable");
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: strTmp });
			this.pushInstruction({ op: "local.get", index: lowTmp });
			this.pushInstruction({ op: "local.get", index: highTmp });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringSliceImportIndex(),
			});

			this.releaseTemp(highTmp, "i32");
			this.releaseTemp(lowTmp, "i32");
			this.releaseTemp(srcLenTmp, "i32");
			this.releaseTemp(strTmp, "externref");
			return;
		}

		if (!isSlice && !isArr && !isPtrToArr) {
			throw new Error(
				`Unsupported SliceExpr on type: ${JSON.stringify(baseType)}`,
			);
		}

		const elemGoType = isSlice
			? baseType.elem
			: isPtrToArr
				? baseType.base.elem
				: baseType.elem;
		const arrInfo = this.mod.getArrayType(elemGoType);
		const sliceInfo = this.mod.getSliceType(elemGoType);

		const arrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const srcOffTmp = this.acquireTemp("i32");
		const srcLenTmp = this.acquireTemp("i32");
		const srcCapTmp = this.acquireTemp("i32");

		if (isSlice) {
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const sliceTmp = this.acquireTemp(sliceWType);
			this.emitExpr(baseNode, sliceWType);
			this.pushInstruction({ op: "local.set", index: sliceTmp });

			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: srcLenTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 3,
			});
			this.pushInstruction({ op: "local.set", index: srcCapTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.set", index: srcOffTmp });
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.releaseTemp(sliceTmp, sliceWType);
		} else {
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			this.emitExpr(baseNode, arrWType);
			this.pushInstruction({ op: "local.set", index: arrTmp });
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("array.len");
			this.pushInstruction({ op: "local.tee", index: srcLenTmp });
			this.pushInstruction({ op: "local.set", index: srcCapTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: srcOffTmp });
		}

		const lowTmp = this.acquireTemp("i32");
		if (expr.low) {
			this._emitIndexExprToI32(expr.low, lowTmp);
		} else {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: lowTmp });
		}

		const highTmp = this.acquireTemp("i32");
		if (expr.high) {
			this._emitIndexExprToI32(expr.high, highTmp);
		} else {
			this.pushInstruction({ op: "local.get", index: srcLenTmp });
			this.pushInstruction({ op: "local.set", index: highTmp });
		}

		const maxTmp = this.acquireTemp("i32");
		if (expr.max) {
			this._emitIndexExprToI32(expr.max, maxTmp);
		} else {
			this.pushInstruction({ op: "local.get", index: srcCapTmp });
			this.pushInstruction({ op: "local.set", index: maxTmp });
		}

		// Bounds check: 0 <= low <= high <= max <= srcCap
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction({ op: "local.get", index: highTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "local.get", index: highTmp });
		this.pushInstruction({ op: "local.get", index: maxTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "local.get", index: maxTmp });
		this.pushInstruction({ op: "local.get", index: srcCapTmp });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction("i32.or");

		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getSliceBoundsPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction("i32.add");

		this.pushInstruction({ op: "local.get", index: highTmp });
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction("i32.sub");

		this.pushInstruction({ op: "local.get", index: maxTmp });
		this.pushInstruction({ op: "local.get", index: lowTmp });
		this.pushInstruction("i32.sub");

		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(maxTmp, "i32");
		this.releaseTemp(highTmp, "i32");
		this.releaseTemp(lowTmp, "i32");
		this.releaseTemp(srcCapTmp, "i32");
		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
	}

	_emitArrayCopy(arrInfo, elemGoType) {
		const isValStruct =
			isStructType(elemGoType, this.mod.checker, this.mod) &&
			!isPointerToStruct(elemGoType, this.mod.checker, this.mod);

		if (!isValStruct) {
			this.pushInstruction({
				op: "array.copy",
				typeIndexDst: arrInfo.typeIndex,
				typeIndexSrc: arrInfo.typeIndex,
			});
			return;
		}

		const sInfo =
			this._resolveStructInfo({ _type: elemGoType }) ??
			this.mod.getStructType(
				elemGoType?.name ??
					(elemGoType?.kind === "named" ? elemGoType.name : null),
			);

		const lenTmp = this.acquireTemp("i32");
		const srcOffTmp = this.acquireTemp("i32");
		const srcArrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		const dstOffTmp = this.acquireTemp("i32");
		const dstArrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.set", index: lenTmp });
		this.pushInstruction({ op: "local.set", index: srcOffTmp });
		this.pushInstruction({ op: "local.set", index: srcArrTmp });
		this.pushInstruction({ op: "local.set", index: dstOffTmp });
		this.pushInstruction({ op: "local.set", index: dstArrTmp });

		const iTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: dstArrTmp });
		this.pushInstruction({ op: "local.get", index: dstOffTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");

		this.pushInstruction({ op: "local.get", index: srcArrTmp });
		this.pushInstruction({ op: "local.get", index: srcOffTmp });
		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });

		if (sInfo) {
			this.emitCloneStruct(sInfo, arrInfo.elemWType);
		}

		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		this.pushInstruction({ op: "local.get", index: iTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(iTmp, "i32");
		this.releaseTemp(dstArrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(dstOffTmp, "i32");
		this.releaseTemp(srcArrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(srcOffTmp, "i32");
		this.releaseTemp(lenTmp, "i32");
	}

	// True when `expr` can be evaluated as an i32 without losing information:
	// i32-backed locals (induction variables, narrow ints), small literals,
	// `len`/`cap`, +/-/* over such operands, or any expression whose Go type
	// already lowers to i32. Everything else goes through the i64 path.
	_isI32IndexExpr(expr) {
		if (!expr) return false;
		switch (expr.kind) {
			case "Ident": {
				const local = this.resolveLocal(expr.name);
				if (local) return local.type === "i32";
				break;
			}
			case "BasicLit":
				if (expr.litKind === "INT") {
					const v = BigInt(expr.value);
					return v >= 0n && v < 2147483648n;
				}
				break;
			case "ParenExpr":
				return this._isI32IndexExpr(expr.expr);
			case "BinaryExpr":
				if (
					(expr.op === "+" || expr.op === "-" || expr.op === "*") &&
					this._isI32IndexExpr(expr.left) &&
					this._isI32IndexExpr(expr.right)
				) {
					return true;
				}
				break;
			case "CallExpr":
				if (
					expr.func?.kind === "Ident" &&
					(expr.func.name === "len" || expr.func.name === "cap")
				) {
					return true;
				}
				break;
		}
		return this.toWasmType(expr._type) === "i32";
	}

	_emitBoundsBranch() {
		const oobDepth = this.resolveBranchDepthToOob();
		if (oobDepth !== null) {
			this.pushInstruction({ op: "br_if", depth: oobDepth });
		} else {
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getBoundsPanicFuncIndex(),
			});
			this.pushInstruction("unreachable");
			this.pushInstruction("end");
		}
	}

	// Pushes the bounds-checked i32 index onto the stack. `emitLen` must push
	// the i32 length. Constant and plain-local indexes are re-emitted instead
	// of spilled; everything else goes through one temp.
	_emitCheckedIndex(indexNode, emitLen) {
		const simple =
			(indexNode.kind === "BasicLit" && indexNode.litKind === "INT") ||
			(indexNode.kind === "Ident" && this.resolveLocal(indexNode.name));
		if (this._isI32IndexExpr(indexNode)) {
			this.emitExpr(indexNode, "i32");
			let tmp = null;
			if (simple) {
				this.emitExpr(indexNode, "i32");
			} else {
				tmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "local.tee", index: tmp });
				this.pushInstruction({ op: "local.get", index: tmp });
			}
			emitLen();
			this.pushInstruction("i32.ge_u");
			this._emitBoundsBranch();
			if (tmp !== null) this.releaseTemp(tmp, "i32");
			return;
		}

		const idx64 = this.acquireTemp("i64");
		this.emitExpr(indexNode, "i64");
		this.pushInstruction({ op: "local.tee", index: idx64 });
		emitLen();
		this.pushInstruction("i64.extend_i32_u");
		this.pushInstruction("i64.ge_u");
		this._emitBoundsBranch();
		this.pushInstruction({ op: "local.get", index: idx64 });
		this.pushInstruction("i32.wrap_i64");
		this.releaseTemp(idx64, "i64");
	}

	// Leaves `[arr, off+idx]` on the stack for `base[idx]` over a slice or
	// (pointer to) array, with the bounds check already emitted.
	_emitElemAddr(baseNode, indexNode, sliceInfo, arrInfo) {
		if (sliceInfo) {
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			const sliceTmp = this.acquireTemp(sliceWType);
			this.emitExpr(baseNode, sliceWType);
			this.pushInstruction({ op: "local.tee", index: sliceTmp });
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
			this._emitCheckedIndex(indexNode, () => {
				this.pushInstruction({ op: "local.get", index: sliceTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 2,
				});
			});
			this.pushInstruction("i32.add");
			this.releaseTemp(sliceTmp, sliceWType);
			return;
		}

		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const arrTmp = this.acquireTemp(arrWType);
		this.emitExpr(baseNode, arrWType);
		this.pushInstruction({ op: "local.tee", index: arrTmp });
		this._emitCheckedIndex(indexNode, () => {
			this.pushInstruction({ op: "local.get", index: arrTmp });
			this.pushInstruction("array.len");
		});
		this.releaseTemp(arrTmp, arrWType);
	}

	_emitIndexExprToI32(node, tmp32) {
		if (this._isI32IndexExpr(node)) {
			this.emitExpr(node, "i32");
			this.pushInstruction({ op: "local.set", index: tmp32 });
			return;
		}
		const wType = this.toWasmType(node._type);
		if (wType === "i64") {
			this.emitExpr(node, "i64");
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction({ op: "local.set", index: tmp32 });
		} else {
			this.emitExpr(node, "i32");
			this.pushInstruction({ op: "local.set", index: tmp32 });
		}
	}

	emitBasicLit(lit, targetWasmType) {
		const wType =
			targetWasmType ??
			toWasmType(lit._type, this.mod.checker) ??
			(lit.litKind === "INT" ? "i64" : lit.litKind === "FLOAT" ? "f64" : "i32");

		if (lit.litKind === "INT") {
			const n = Number(lit.value);
			if (wType === "i32") {
				this.pushInstruction({ op: "i32.const", value: n | 0 });
			} else if (wType === "f64" || wType === "f32") {
				// Untyped integer constant in a float context (`x * 2`).
				this.pushInstruction({ op: `${wType}.const`, value: n });
			} else {
				this.pushInstruction({ op: "i64.const", value: BigInt(lit.value) });
			}
			return;
		}

		if (lit.litKind === "FLOAT") {
			const n = Number(lit.value);
			if (wType === "f32") {
				this.pushInstruction({ op: "f32.const", value: n });
			} else {
				this.pushInstruction({ op: "f64.const", value: n });
			}
			return;
		}

		if (lit.litKind === "BOOL") {
			this.pushInstruction({
				op: "i32.const",
				value: lit.value === "true" ? 1 : 0,
			});
			return;
		}

		if (lit.litKind === "NIL") {
			const effectiveType = targetWasmType ?? this.toWasmType(lit._type);
			if (
				(lit._type && isSliceType(lit._type, this.mod.checker)) ||
				(effectiveType &&
					typeof effectiveType === "object" &&
					typeof effectiveType.typeIndex === "number" &&
					this.mod.getSliceTypeByIndex(effectiveType.typeIndex))
			) {
				const elemType = lit._type ? this._getSliceElemType(lit._type) : null;
				const sliceInfo = elemType
					? this.mod.getSliceType(elemType)
					: this.mod.getSliceTypeByIndex(effectiveType.typeIndex);
				if (sliceInfo) {
					this.pushInstruction({
						op: "global.get",
						index: sliceInfo.emptyGlobalIndex,
					});
					return;
				}
			}
			const heapType =
				typeof effectiveType === "object" && effectiveType !== null
					? (effectiveType.typeIndex ?? effectiveType.heapType ?? "any")
					: "any";
			this.pushInstruction({ op: "ref.null", heapType });
			return;
		}

		if (lit.litKind === "STRING") {
			// Intern string in module string table
			const strVal = String(lit.value ?? "");
			const strIdx = this.mod.internString(strVal);
			const funcIdx = this.mod.getStringImportIndex();
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			return;
		}
	}

	emitIdent(ident, targetWasmType = null) {
		if (ident.name === "true") {
			this.pushInstruction({ op: "i32.const", value: 1 });
			return;
		}
		if (ident.name === "false") {
			this.pushInstruction({ op: "i32.const", value: 0 });
			return;
		}
		if (ident.name === "nil") {
			const effectiveType = targetWasmType ?? this.toWasmType(ident._type);
			if (
				(ident._type && isSliceType(ident._type, this.mod.checker)) ||
				(effectiveType &&
					typeof effectiveType === "object" &&
					typeof effectiveType.typeIndex === "number" &&
					this.mod.getSliceTypeByIndex(effectiveType.typeIndex))
			) {
				const elemType = ident._type
					? this._getSliceElemType(ident._type)
					: null;
				const sliceInfo = elemType
					? this.mod.getSliceType(elemType)
					: this.mod.getSliceTypeByIndex(effectiveType.typeIndex);
				if (sliceInfo) {
					this.pushInstruction({
						op: "global.get",
						index: sliceInfo.emptyGlobalIndex,
					});
					return;
				}
			}
			const heapType =
				typeof effectiveType === "object" && effectiveType !== null
					? (effectiveType.typeIndex ?? effectiveType.heapType ?? "any")
					: "any";
			this.pushInstruction({ op: "ref.null", heapType });
			return;
		}

		const localInfo = this.resolveLocal(ident.name);
		if (localInfo) {
			if (localInfo.isBoxed) {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: localInfo.boxInfo.typeIndex,
					fieldIndex: 0,
				});
			} else {
				this.pushInstruction({ op: "local.get", index: localInfo.index });
			}
			if (localInfo.type === "i32" && targetWasmType === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			} else if (localInfo.type === "i64" && targetWasmType === "i32") {
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}

		if (this.cachedGlobals.has(ident.name)) {
			const cached = this.cachedGlobals.get(ident.name);
			this.pushInstruction({ op: "local.get", index: cached.index });
			if (cached.globalInfo.type === "i32" && targetWasmType === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			} else if (cached.globalInfo.type === "i64" && targetWasmType === "i32") {
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}

		const globalInfo = this.mod.resolveGlobal(ident.name);
		if (globalInfo) {
			this.pushInstruction({ op: "global.get", index: globalInfo.index });
			if (globalInfo.type === "i32" && targetWasmType === "i64") {
				this.pushInstruction("i64.extend_i32_s");
			} else if (globalInfo.type === "i64" && targetWasmType === "i32") {
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}

		const constLit = this.mod.resolveConst(ident.name);
		if (constLit) {
			this.emitBasicLit(
				constLit,
				targetWasmType ?? this.toWasmType(ident._type),
			);
			return;
		}
		if (this.mod.isNonLiteralConst(ident.name)) {
			throw new Error(
				`constant '${ident.name}' has a non-literal value, which the wasm backend does not support yet (planned)`,
			);
		}

		const trampName = `_tramp$${ident.name}`;
		const trampFuncIdx = this.mod.resolveFuncIndex(trampName);
		if (trampFuncIdx !== null) {
			const targetFn = this.mod.topLevelFuncMap?.get(ident.name);
			const goType =
				ident._type ??
				(targetFn
					? {
							kind: "func",
							params: (targetFn.params ?? []).map((p) => p.type ?? p),
							returns: targetFn.returnType
								? targetFn.returnType.kind === "TupleType" ||
									targetFn.returnType.kind === "tuple"
									? targetFn.returnType.types
									: [targetFn.returnType]
								: [],
						}
					: null);
			const closureInfo = this.mod.getClosureType(goType);
			this.pushInstruction({ op: "ref.func", funcIndex: trampFuncIdx });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
			this.pushInstruction({
				op: "struct.new",
				typeIndex: closureInfo.typeIndex,
			});
			return;
		}

		throw new Error(`Unresolved identifier: ${ident.name}`);
	}

	emitUnaryExpr(expr, targetWasmType = null) {
		const { op, operand } = expr;

		// Optimize negative numeric literals directly
		if (op === "-" && operand.kind === "BasicLit") {
			if (operand.litKind === "INT" || operand.litKind === "FLOAT") {
				this.emitBasicLit(
					{ ...operand, value: `-${operand.value}` },
					targetWasmType,
				);
				return;
			}
		}

		const wType =
			targetWasmType ??
			toWasmType(expr._type, this.mod.checker) ??
			toWasmType(operand._type, this.mod.checker);

		switch (op) {
			case "+":
				this.emitExpr(operand, wType);
				break;

			case "-":
				if (wType === "i32") {
					this.pushInstruction({ op: "i32.const", value: 0 });
					this.emitExpr(operand, wType);
					this.pushInstruction("i32.sub");
					this.emitNarrowIntWrap(operand._type);
				} else if (wType === "i64") {
					this.pushInstruction({ op: "i64.const", value: 0n });
					this.emitExpr(operand, wType);
					this.pushInstruction("i64.sub");
				} else if (wType === "f32") {
					this.emitExpr(operand, wType);
					this.pushInstruction("f32.neg");
				} else if (wType === "f64") {
					this.emitExpr(operand, wType);
					this.pushInstruction("f64.neg");
				}
				break;

			case "!":
				this.emitExpr(operand, "i32");
				this.pushInstruction("i32.eqz");
				break;

			case "^": // bitwise NOT
				this.emitExpr(operand, wType);
				if (wType === "i32") {
					this.pushInstruction({ op: "i32.const", value: -1 });
					this.pushInstruction("i32.xor");
					this.emitNarrowIntWrap(operand._type);
				} else if (wType === "i64") {
					this.pushInstruction({ op: "i64.const", value: -1n });
					this.pushInstruction("i64.xor");
				}
				break;

			case "&": {
				if (operand.kind === "CompositeLit") {
					this.emitExpr(operand);
					return;
				}
				const structInfo = this._resolveStructInfo(operand);
				if (structInfo) {
					this.emitExpr(operand);
					return;
				}
				const opWType = this.toWasmType(operand._type);
				const box = this.mod.getBoxType(operand._type);
				this.emitExpr(operand, opWType);
				this.pushInstruction({ op: "struct.new", typeIndex: box.typeIndex });
				return;
			}

			case "*": {
				const structInfo = this._resolveStructInfo(operand);
				if (structInfo) {
					const baseWType = this.toWasmType(operand._type);
					this.emitExpr(operand, baseWType);
					this.emitCloneStruct(structInfo, baseWType);
					return;
				}
				const box = this.mod.getBoxType(operand._type?.base ?? operand._type);
				const baseWType = {
					kind: "ref",
					nullable: true,
					typeIndex: box.typeIndex,
				};
				this.emitExpr(operand, baseWType);
				this.pushInstruction({
					op: "struct.get",
					typeIndex: box.typeIndex,
					fieldIndex: 0,
				});
				return;
			}

			default:
				throw new Error(`Unsupported unary operator: ${op}`);
		}
	}

	emitBinaryExpr(expr, targetWasmType = null) {
		const { op, left, right } = expr;

		// Short-circuiting logical operators
		if (op === "&&") {
			this.emitExpr(left, "i32");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.emitExpr(right, "i32");
			this.pushInstruction("else");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("end");
			return;
		}

		if (op === "||") {
			this.emitExpr(left, "i32");
			this.pushInstruction({ op: "if", blockType: "i32" });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("else");
			this.emitExpr(right, "i32");
			this.pushInstruction("end");
			return;
		}

		// Division & Modulo with zero-guard and overflow-guard
		if (op === "/" || op === "%") {
			this.emitDivRem(op, left, right, targetWasmType);
			return;
		}

		// Shifts with Go semantics
		if (op === "<<" || op === ">>") {
			this.emitShift(op, left, right, targetWasmType);
			return;
		}

		// Standard binary operators
		const isCmp =
			op === "==" ||
			op === "!=" ||
			op === "<" ||
			op === "<=" ||
			op === ">" ||
			op === ">=";

		const isNil = (n) =>
			(n.kind === "BasicLit" && n.litKind === "NIL") ||
			(n.kind === "Ident" && n.name === "nil");

		if ((op === "==" || op === "!=") && (isNil(left) || isNil(right))) {
			const nonNil = isNil(right) ? left : right;
			if (isSliceType(nonNil._type, this.mod.checker)) {
				const elemType = this._getSliceElemType(nonNil._type);
				const sliceInfo = this.mod.getSliceType(elemType);
				const sliceWType = {
					kind: "ref",
					nullable: true,
					typeIndex: sliceInfo.typeIndex,
				};
				this.emitExpr(nonNil, sliceWType);
				this.pushInstruction({
					op: "struct.get",
					typeIndex: sliceInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction("ref.is_null");
				if (op === "!=") {
					this.pushInstruction("i32.eqz");
				}
				return;
			}
			const nonNilWType = this.toWasmType(nonNil._type);
			this.emitExpr(nonNil, nonNilWType);
			this.pushInstruction("ref.is_null");
			if (op === "!=") {
				this.pushInstruction("i32.eqz");
			}
			return;
		}

		const leftType = left._type;
		const isLeftI32 = this._isI32IndexExpr(left);
		const isRightI32 = this._isI32IndexExpr(right);
		const leftGoType = left._type ?? this._resolveExprGoType(left);
		const isIntType =
			!leftGoType ||
			(leftGoType.kind === "basic" &&
				(leftGoType.name === "int" ||
					leftGoType.name === "untyped int" ||
					leftGoType.name === "int32" ||
					leftGoType.name === "uint32"));
		const cmpI32 = isIntType && isLeftI32 && isRightI32;

		const wType = isCmp
			? cmpI32
				? "i32"
				: this.toWasmType(leftType)
			: (targetWasmType ?? this.toWasmType(leftType));

		this.emitExpr(left, wType);
		this.emitExpr(right, wType);

		if (
			(op === "==" || op === "!=") &&
			isStructType(leftType, this.mod.checker, this.mod) &&
			!isPointerToStruct(leftType, this.mod.checker, this.mod)
		) {
			const sInfo =
				this._resolveStructInfo({ _type: leftType }) ??
				this.mod.getStructType(
					leftType?.name ?? (leftType?.kind === "named" ? leftType.name : null),
				);
			if (sInfo) {
				this._emitStructEq(sInfo);
				if (op === "!=") {
					this.pushInstruction("i32.eqz");
				}
				return;
			}
		}

		this.emitBinaryOp(op, wType, leftType);
	}

	_emitStructEq(structInfo) {
		const bTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
		const aTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: bTmp });
		this.pushInstruction({ op: "local.set", index: aTmp });

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "block", blockType: "void" });

		for (let i = 0; i < structInfo.fields.length; i++) {
			const f = structInfo.fields[i];
			this.pushInstruction({ op: "local.get", index: aTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: i,
			});
			this.pushInstruction({ op: "local.get", index: bTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: i,
			});

			if (
				isStructType(f.goType, this.mod.checker, this.mod) &&
				!isPointerToStruct(f.goType, this.mod.checker, this.mod)
			) {
				const sInfo =
					this._resolveStructInfo({ _type: f.goType }) ??
					this.mod.getStructType(
						f.goType?.name ??
							(f.goType?.kind === "named" ? f.goType.name : null),
					);
				this._emitStructEq(sInfo);
			} else if (isStringType(f.goType, this.mod.checker)) {
				const cmpIdx = this.mod.getStringCmpImportIndex("==");
				this.pushInstruction({ op: "call", funcIndex: cmpIdx });
			} else if (
				f.wType === "anyref" ||
				(typeof f.wType === "object" && f.wType !== null)
			) {
				this.pushInstruction("ref.eq");
			} else {
				this.pushInstruction(`${f.wType}.eq`);
			}

			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: resTmp });
			this.pushInstruction({ op: "br", depth: 1 });
			this.pushInstruction("end");
		}
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTmp });

		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(aTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
		this.releaseTemp(bTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: structInfo.typeIndex,
		});
	}

	emitBinaryOp(op, wType, goType) {
		const signed = isSigned(goType);

		switch (op) {
			case "+":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const concatIdx = this.mod.getStringConcatImportIndex();
					this.pushInstruction({ op: "call", funcIndex: concatIdx });
					return;
				}
				this.pushInstruction(`${wType}.add`);
				this.emitNarrowIntWrap(goType);
				break;
			case "-":
				this.pushInstruction(`${wType}.sub`);
				this.emitNarrowIntWrap(goType);
				break;
			case "*":
				this.pushInstruction(`${wType}.mul`);
				this.emitNarrowIntWrap(goType);
				break;

			case "&":
				this.pushInstruction(`${wType}.and`);
				break;
			case "|":
				this.pushInstruction(`${wType}.or`);
				break;
			case "^":
				this.pushInstruction(`${wType}.xor`);
				break;
			case "&^": // AND NOT: a &^ b -> a & (~b)
				if (wType === "i32") {
					this.pushInstruction({ op: "i32.const", value: -1 });
					this.pushInstruction("i32.xor");
					this.pushInstruction("i32.and");
				} else if (wType === "i64") {
					this.pushInstruction({ op: "i64.const", value: -1n });
					this.pushInstruction("i64.xor");
					this.pushInstruction("i64.and");
				}
				break;

			// Comparisons
			case "==":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("==");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (
					wType === "anyref" ||
					(typeof wType === "object" && wType !== null)
				) {
					this.pushInstruction("ref.eq");
				} else {
					this.pushInstruction(`${wType}.eq`);
				}
				break;
			case "!=":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("!=");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (
					wType === "anyref" ||
					(typeof wType === "object" && wType !== null)
				) {
					this.pushInstruction("ref.eq");
					this.pushInstruction("i32.eqz");
				} else {
					this.pushInstruction(`${wType}.ne`);
				}
				break;
			case "<":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("<");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.lt`);
				} else {
					this.pushInstruction(`${wType}.lt_${signed ? "s" : "u"}`);
				}
				break;
			case "<=":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex("<=");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.le`);
				} else {
					this.pushInstruction(`${wType}.le_${signed ? "s" : "u"}`);
				}
				break;
			case ">":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex(">");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.gt`);
				} else {
					this.pushInstruction(`${wType}.gt_${signed ? "s" : "u"}`);
				}
				break;
			case ">=":
				if (isStringType(goType, this.mod.checker) || wType === "externref") {
					const cmpIdx = this.mod.getStringCmpImportIndex(">=");
					this.pushInstruction({ op: "call", funcIndex: cmpIdx });
				} else if (wType === "f32" || wType === "f64") {
					this.pushInstruction(`${wType}.ge`);
				} else {
					this.pushInstruction(`${wType}.ge_${signed ? "s" : "u"}`);
				}
				break;

			default:
				throw new Error(`Unsupported binary operator: ${op}`);
		}
	}

	emitNarrowIntWrap(goType) {
		if (!goType) return;
		if (goType.kind === "TypeName" || goType.kind === "Ident") {
			return this.emitNarrowIntWrap({ kind: "basic", name: goType.name });
		}
		if (goType.kind === "named" && goType.underlying) {
			return this.emitNarrowIntWrap(goType.underlying);
		}
		if (goType.kind === "basic") {
			switch (goType.name) {
				case "int8":
					this.pushInstruction("i32.extend8_s");
					break;
				case "int16":
					this.pushInstruction("i32.extend16_s");
					break;
				case "uint8":
				case "byte":
					this.pushInstruction({ op: "i32.const", value: 0xff });
					this.pushInstruction("i32.and");
					break;
				case "uint16":
					this.pushInstruction({ op: "i32.const", value: 0xffff });
					this.pushInstruction("i32.and");
					break;
			}
		}
	}

	emitDivRem(op, left, right, targetWasmType = null) {
		const goType = left._type;
		const wType = targetWasmType ?? toWasmType(goType, this.mod.checker);

		if (wType === "f32" || wType === "f64") {
			this.emitExpr(left, wType);
			this.emitExpr(right, wType);
			this.pushInstruction(`${wType}.div`);
			return;
		}

		const signed = isSigned(goType);
		const tmpA = this.acquireTemp(wType);
		const tmpB = this.acquireTemp(wType);

		this.emitExpr(left, wType);
		this.pushInstruction({ op: "local.set", index: tmpA });

		this.emitExpr(right, wType);
		this.pushInstruction({ op: "local.set", index: tmpB });

		// Zero check
		this.pushInstruction({ op: "local.get", index: tmpB });
		this.pushInstruction(`${wType}.eqz`);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic("runtime error: integer divide by zero");
		this.pushInstruction("end");

		if (wType === "i32") {
			if (signed) {
				// MinInt32 / -1 wrap guard
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "i32.const", value: -2147483648 });
				this.pushInstruction("i32.eq");
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction("i32.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "i32" });
				if (op === "/") {
					this.pushInstruction({ op: "i32.const", value: -2147483648 });
				} else {
					this.pushInstruction({ op: "i32.const", value: 0 });
				}
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i32.div_s" : "i32.rem_s");
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i32.div_u" : "i32.rem_u");
			}
			this.emitNarrowIntWrap(goType);
		} else if (wType === "i64") {
			if (signed) {
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({
					op: "i64.const",
					value: -9223372036854775808n,
				});
				this.pushInstruction("i64.eq");
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction({ op: "i64.const", value: -1n });
				this.pushInstruction("i64.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "if", blockType: "i64" });
				if (op === "/") {
					this.pushInstruction({
						op: "i64.const",
						value: -9223372036854775808n,
					});
				} else {
					this.pushInstruction({ op: "i64.const", value: 0n });
				}
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i64.div_s" : "i64.rem_s");
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "local.get", index: tmpA });
				this.pushInstruction({ op: "local.get", index: tmpB });
				this.pushInstruction(op === "/" ? "i64.div_u" : "i64.rem_u");
			}
		}

		this.releaseTemp(tmpB, wType);
		this.releaseTemp(tmpA, wType);
	}

	emitShift(op, left, right, targetWasmType = null) {
		const goType = left._type;
		const wType = targetWasmType ?? toWasmType(goType, this.mod.checker);
		const signed = isSigned(goType);
		const rightWType = toWasmType(right._type, this.mod.checker);

		const tmpVal = this.acquireTemp(wType);
		const tmpShift = this.acquireTemp(wType);

		this.emitExpr(left, wType);
		this.pushInstruction({ op: "local.set", index: tmpVal });

		this.emitExpr(right, rightWType);
		if (wType === "i64" && rightWType === "i32") {
			this.pushInstruction("i64.extend_i32_u");
		} else if (wType === "i32" && rightWType === "i64") {
			this.pushInstruction("i32.wrap_i64");
		}
		this.pushInstruction({ op: "local.set", index: tmpShift });

		if (wType === "i32") {
			this.pushInstruction({ op: "local.get", index: tmpShift });
			this.pushInstruction({ op: "i32.const", value: 32 });
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "if", blockType: "i32" });

			if (op === ">>" && signed) {
				this.pushInstruction({ op: "local.get", index: tmpVal });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("i32.lt_s");
				this.pushInstruction({ op: "if", blockType: "i32" });
				this.pushInstruction({ op: "i32.const", value: -1 });
				this.pushInstruction("else");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "i32.const", value: 0 });
			}

			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: tmpVal });
			this.pushInstruction({ op: "local.get", index: tmpShift });
			if (op === "<<") {
				this.pushInstruction("i32.shl");
			} else {
				this.pushInstruction(signed ? "i32.shr_s" : "i32.shr_u");
			}

			this.pushInstruction("end");
			this.emitNarrowIntWrap(goType);
		} else {
			this.pushInstruction({ op: "local.get", index: tmpShift });
			this.pushInstruction({ op: "i64.const", value: 64n });
			this.pushInstruction("i64.ge_u");
			this.pushInstruction({ op: "if", blockType: "i64" });

			if (op === ">>" && signed) {
				this.pushInstruction({ op: "local.get", index: tmpVal });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.lt_s");
				this.pushInstruction({ op: "if", blockType: "i64" });
				this.pushInstruction({ op: "i64.const", value: -1n });
				this.pushInstruction("else");
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("end");
			} else {
				this.pushInstruction({ op: "i64.const", value: 0n });
			}

			this.pushInstruction("else");

			this.pushInstruction({ op: "local.get", index: tmpVal });
			this.pushInstruction({ op: "local.get", index: tmpShift });
			if (op === "<<") {
				this.pushInstruction("i64.shl");
			} else {
				this.pushInstruction(signed ? "i64.shr_s" : "i64.shr_u");
			}

			this.pushInstruction("end");
		}

		this.releaseTemp(tmpShift, wType);
		this.releaseTemp(tmpVal, wType);
	}

	emitPanic(msg) {
		const strIdx = this.mod.internString(msg);
		const funcIdx = this.mod.getStringImportIndex();
		this.pushInstruction({ op: "i32.const", value: strIdx });
		this.pushInstruction({ op: "call", funcIndex: funcIdx });
		this.pushInstruction("any.convert_extern");
		this.emitPanicThrow();
	}

	// Consumes the anyref message on the stack, pushes a PanicNode, and raises the panic via
	// `env.panic`; `unreachable` tells the validator control never returns.
	emitPanicThrow() {
		const panicNodeTypeIndex = this.mod.getPanicNodeTypeIndex();
		const panicGlobal = this.mod.getPanicGlobalIndex();
		const tmpVal = this.acquireTemp("anyref");
		this.pushInstruction({ op: "local.set", index: tmpVal });

		// Push PanicNode: (struct.new $PanicNode val (i32.const 0) (global.get panicGlobal))
		this.pushInstruction({ op: "local.get", index: tmpVal });
		this.pushInstruction({ op: "i32.const", value: 0 }); // recovered = 0
		this.pushInstruction({ op: "global.get", index: panicGlobal }); // prev
		this.pushInstruction({
			op: "struct.new",
			typeIndex: panicNodeTypeIndex,
		});
		this.pushInstruction({ op: "global.set", index: panicGlobal });

		// Prepare externref for env.panic
		this.pushInstruction({ op: "local.get", index: tmpVal });
		this.pushInstruction("extern.convert_any");
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getPanicImportIndex(),
		});
		this.pushInstruction("unreachable");
		this.releaseTemp(tmpVal, "anyref");
	}

	_getSliceElemType(t) {
		if (!t) return null;
		if (t.elem) return t.elem;
		if (t.underlying?.elem) return t.underlying.elem;
		if (t.kind === "SliceType") return t.elem;
		if (t.name && this.mod.checker?.types?.has(t.name)) {
			const resolved = this.mod.checker.types.get(t.name);
			return this._getSliceElemType(resolved);
		}
		return null;
	}

	_getArrayElemType(t) {
		if (!t) return null;
		if (t.elem) return t.elem;
		if (t.underlying?.elem) return t.underlying.elem;
		if (t.kind === "ArrayType") return t.elem;
		if (t.name && this.mod.checker?.types?.has(t.name)) {
			const resolved = this.mod.checker.types.get(t.name);
			return this._getArrayElemType(resolved);
		}
		return null;
	}

	_emitBuiltinLen(call, targetWasmType) {
		const arg = call.args[0];
		const argType = arg._type ?? this._resolveExprGoType(arg);
		if (isMapType(argType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(argType, this.mod.checker);
			const mapInfo = this.mod.getMapType(keyType, valType);
			this.emitExpr(arg, mapInfo.wType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.lenFuncName),
			});
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (isSliceType(argType, this.mod.checker)) {
			const elemType = this._getSliceElemType(argType);
			const sliceInfo = this.mod.getSliceType(elemType);
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			this.emitExpr(arg, sliceWType);
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (
			isArrayType(argType, this.mod.checker) ||
			(argType?.kind === "pointer" &&
				isArrayType(argType.base, this.mod.checker))
		) {
			const elemType = this._getArrayElemType(argType?.base ?? argType);
			const arrInfo = this.mod.getArrayType(elemType);
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			this.emitExpr(arg, arrWType);
			this.pushInstruction("array.len");
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (isStringType(argType, this.mod.checker)) {
			this.emitExpr(arg, "externref");
			const lenIdx = this.mod.getStringLenImportIndex();
			this.pushInstruction({ op: "call", funcIndex: lenIdx });
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
	}

	_emitBuiltinString(call) {
		const arg = call.args[0];
		const argType = arg._type;
		const argWType = toWasmType(argType, this.mod.checker);
		if (argWType === "i64") {
			this.emitExpr(arg, "i64");
			this.pushInstruction("i32.wrap_i64");
		} else {
			this.emitExpr(arg, "i32");
		}
		const funcIdx = this.mod.getStringFromCodePointImportIndex();
		this.pushInstruction({ op: "call", funcIndex: funcIdx });
	}

	_emitBuiltinCap(call, targetWasmType) {
		const arg = call.args[0];
		const argType = arg._type;
		if (isSliceType(argType, this.mod.checker)) {
			const elemType = this._getSliceElemType(argType);
			const sliceInfo = this.mod.getSliceType(elemType);
			const sliceWType = {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
			this.emitExpr(arg, sliceWType);
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 3,
			});
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
		if (
			isArrayType(argType, this.mod.checker) ||
			(argType?.kind === "pointer" &&
				isArrayType(argType.base, this.mod.checker))
		) {
			const elemType = this._getArrayElemType(argType?.base ?? argType);
			const arrInfo = this.mod.getArrayType(elemType);
			const arrWType = {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
			this.emitExpr(arg, arrWType);
			this.pushInstruction("array.len");
			if ((targetWasmType ?? "i64") === "i64") {
				this.pushInstruction("i64.extend_i32_u");
			}
			return;
		}
	}

	_emitBuiltinMake(call) {
		const { args } = call;
		const typeArg = args[0];
		const targetMapType =
			call._type ??
			(typeArg.kind === "TypeExpr" ? typeArg.type : typeArg._type) ??
			typeArg;
		if (isMapType(targetMapType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(
				targetMapType,
				this.mod.checker,
			);
			const mapInfo = this.mod.getMapType(keyType, valType);
			if (args[1]) {
				const hintTmp = this.acquireTemp("i32");
				this._emitIndexExprToI32(args[1], hintTmp);
				this.pushInstruction({ op: "local.get", index: hintTmp });
				this.releaseTemp(hintTmp, "i32");
			} else {
				this.pushInstruction({ op: "i32.const", value: 0 });
			}
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.makeFuncName),
			});
			return;
		}
		const elemGoType =
			this._getSliceElemType(call._type) ??
			this._getSliceElemType(
				typeArg.kind === "TypeExpr" ? typeArg.type : typeArg,
			) ??
			this._getSliceElemType(typeArg._type);
		if (elemGoType) {
			const arrInfo = this.mod.getArrayType(elemGoType);
			const sliceInfo = this.mod.getSliceType(elemGoType);

			const lenTmp = this.acquireTemp("i32");
			this._emitIndexExprToI32(args[1], lenTmp);

			const capTmp = this.acquireTemp("i32");
			if (args[2]) {
				this._emitIndexExprToI32(args[2], capTmp);
			} else {
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.set", index: capTmp });
			}

			this.pushInstruction({ op: "local.get", index: lenTmp });
			this.pushInstruction({ op: "local.get", index: capTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "local.get", index: capTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.lt_s");
			this.pushInstruction("i32.or");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.emitPanic("runtime error: makeslice: len out of range");
			this.pushInstruction("end");

			if (isStructType(elemGoType, this.mod.checker, this.mod)) {
				const arrTmp = this.acquireTemp({
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.set", index: arrTmp });

				const iTmp = this.acquireTemp("i32");
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.set", index: iTmp });

				this.pushInstruction({ op: "block", blockType: "void" });
				this.pushInstruction({ op: "loop", blockType: "void" });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction("i32.ge_s");
				this.pushInstruction({ op: "br_if", depth: 1 });

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "local.get", index: iTmp });
				this.emitZeroValue(elemGoType, arrInfo.elemWType);
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
				this.releaseTemp(iTmp, "i32");

				this.pushInstruction({ op: "local.get", index: arrTmp });
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
				this.releaseTemp(arrTmp, {
					kind: "ref",
					nullable: true,
					typeIndex: arrInfo.typeIndex,
				});
			} else {
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "array.new_default",
					typeIndex: arrInfo.typeIndex,
				});
				this.pushInstruction({ op: "i32.const", value: 0 });
				this.pushInstruction({ op: "local.get", index: lenTmp });
				this.pushInstruction({ op: "local.get", index: capTmp });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: sliceInfo.typeIndex,
				});
			}

			this.releaseTemp(capTmp, "i32");
			this.releaseTemp(lenTmp, "i32");
		}
	}

	_emitBuiltinAppend(call) {
		const { args } = call;
		const sNode = args[0];
		const sliceGoType = sNode._type ?? call._type;
		const elemGoType = this._getSliceElemType(sliceGoType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const sliceWType = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};
		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};

		const sTmp = this.acquireTemp(sliceWType);
		this.emitExpr(sNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: sTmp });

		const oldArrTmp = this.acquireTemp(arrWType);
		const oldOffTmp = this.acquireTemp("i32");
		const oldLenTmp = this.acquireTemp("i32");
		const oldCapTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: oldArrTmp });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: oldOffTmp });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: oldLenTmp });
		this.pushInstruction({ op: "local.get", index: sTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 3,
		});
		this.pushInstruction({ op: "local.set", index: oldCapTmp });
		this.releaseTemp(sTmp, sliceWType);

		const newArrTmp = this.acquireTemp(arrWType);
		const newOffTmp = this.acquireTemp("i32");
		const newCapTmp = this.acquireTemp("i32");
		const newLenTmp = this.acquireTemp("i32");

		if (args.length === 2 && args[1]._spread) {
			const s2Tmp = this.acquireTemp(sliceWType);
			this.emitExpr(args[1], sliceWType);
			this.pushInstruction({ op: "local.set", index: s2Tmp });

			const s2ArrTmp = this.acquireTemp(arrWType);
			const s2OffTmp = this.acquireTemp("i32");
			const s2LenTmp = this.acquireTemp("i32");

			this.pushInstruction({ op: "local.get", index: s2Tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({ op: "local.set", index: s2ArrTmp });
			this.pushInstruction({ op: "local.get", index: s2Tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction({ op: "local.set", index: s2OffTmp });
			this.pushInstruction({ op: "local.get", index: s2Tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex: 2,
			});
			this.pushInstruction({ op: "local.set", index: s2LenTmp });
			this.releaseTemp(s2Tmp, sliceWType);

			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "local.get", index: s2LenTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: newLenTmp });

			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.get", index: oldCapTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });

			this.pushInstruction({ op: "local.get", index: oldCapTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.shl");
			this.pushInstruction({ op: "local.set", index: newCapTmp });

			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.set", index: newCapTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.lt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction({ op: "local.set", index: newCapTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction({
				op: "array.new_default",
				typeIndex: arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: newArrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: newOffTmp });

			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: newArrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: oldArrTmp });
			this.pushInstruction({ op: "local.get", index: oldOffTmp });
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this._emitArrayCopy(arrInfo, elemGoType);
			this.pushInstruction("end");

			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: oldArrTmp });
			this.pushInstruction({ op: "local.set", index: newArrTmp });
			this.pushInstruction({ op: "local.get", index: oldOffTmp });
			this.pushInstruction({ op: "local.set", index: newOffTmp });
			this.pushInstruction({ op: "local.get", index: oldCapTmp });
			this.pushInstruction({ op: "local.set", index: newCapTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: s2LenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: newArrTmp });
			this.pushInstruction({ op: "local.get", index: newOffTmp });
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.get", index: s2ArrTmp });
			this.pushInstruction({ op: "local.get", index: s2OffTmp });
			this.pushInstruction({ op: "local.get", index: s2LenTmp });
			this._emitArrayCopy(arrInfo, elemGoType);
			this.pushInstruction("end");

			this.releaseTemp(s2LenTmp, "i32");
			this.releaseTemp(s2OffTmp, "i32");
			this.releaseTemp(s2ArrTmp, arrWType);
		} else {
			const k = args.length - 1;
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "i32.const", value: k });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: newLenTmp });

			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.get", index: oldCapTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });

			this.pushInstruction({ op: "local.get", index: oldCapTmp });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.shl");
			this.pushInstruction({ op: "local.set", index: newCapTmp });

			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: newLenTmp });
			this.pushInstruction({ op: "local.set", index: newCapTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction("i32.lt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "i32.const", value: 2 });
			this.pushInstruction({ op: "local.set", index: newCapTmp });
			this.pushInstruction("end");

			this.pushInstruction({ op: "local.get", index: newCapTmp });
			this.pushInstruction({
				op: "array.new_default",
				typeIndex: arrInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: newArrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: newOffTmp });

			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction("i32.gt_u");
			this.pushInstruction({ op: "if", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: newArrTmp });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: oldArrTmp });
			this.pushInstruction({ op: "local.get", index: oldOffTmp });
			this.pushInstruction({ op: "local.get", index: oldLenTmp });
			this._emitArrayCopy(arrInfo, elemGoType);
			this.pushInstruction("end");

			this.pushInstruction("else");
			this.pushInstruction({ op: "local.get", index: oldArrTmp });
			this.pushInstruction({ op: "local.set", index: newArrTmp });
			this.pushInstruction({ op: "local.get", index: oldOffTmp });
			this.pushInstruction({ op: "local.set", index: newOffTmp });
			this.pushInstruction({ op: "local.get", index: oldCapTmp });
			this.pushInstruction({ op: "local.set", index: newCapTmp });
			this.pushInstruction("end");

			for (let i = 0; i < k; i++) {
				const elemNode = args[1 + i];
				const isValStruct =
					isStructType(elemGoType, this.mod.checker, this.mod) &&
					!isPointerToStruct(elemGoType, this.mod.checker, this.mod);
				const isFresh =
					elemNode.kind === "CompositeLit" ||
					(elemNode.kind === "UnaryExpr" && elemNode.op === "*");

				this.pushInstruction({ op: "local.get", index: newArrTmp });
				this.pushInstruction({ op: "local.get", index: newOffTmp });
				this.pushInstruction({ op: "local.get", index: oldLenTmp });
				this.pushInstruction("i32.add");
				if (i > 0) {
					this.pushInstruction({ op: "i32.const", value: i });
					this.pushInstruction("i32.add");
				}
				this.emitExpr(elemNode, arrInfo.elemWType);
				if (isValStruct && !isFresh) {
					const sInfo = this._resolveStructInfo(elemNode);
					if (sInfo) {
						this.emitCloneStruct(sInfo, arrInfo.elemWType);
					}
				}
				this.pushInstruction({
					op: "array.set",
					typeIndex: arrInfo.typeIndex,
				});
			}
		}

		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "local.get", index: newOffTmp });
		this.pushInstruction({ op: "local.get", index: newLenTmp });
		this.pushInstruction({ op: "local.get", index: newCapTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newLenTmp, "i32");
		this.releaseTemp(newCapTmp, "i32");
		this.releaseTemp(newOffTmp, "i32");
		this.releaseTemp(newArrTmp, arrWType);
		this.releaseTemp(oldCapTmp, "i32");
		this.releaseTemp(oldLenTmp, "i32");
		this.releaseTemp(oldOffTmp, "i32");
		this.releaseTemp(oldArrTmp, arrWType);
	}

	_emitBuiltinCopy(call, targetWasmType) {
		const { args } = call;
		const dstNode = args[0];
		const srcNode = args[1];
		const elemGoType =
			this._getSliceElemType(dstNode._type) ??
			this._getSliceElemType(srcNode._type);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;
		const sliceWType = {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		};

		const dstTmp = this.acquireTemp(sliceWType);
		this.emitExpr(dstNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: dstTmp });

		const srcTmp = this.acquireTemp(sliceWType);
		this.emitExpr(srcNode, sliceWType);
		this.pushInstruction({ op: "local.set", index: srcTmp });

		const nTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: nTmp });

		const dstLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: dstLenTmp });

		const srcLenTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: srcLenTmp });

		this.pushInstruction({ op: "local.get", index: dstLenTmp });
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("i32.lt_u");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: dstLenTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: srcLenTmp });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: nTmp });

		this.releaseTemp(srcLenTmp, "i32");
		this.releaseTemp(dstLenTmp, "i32");

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.gt_u");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: nTmp });
		this._emitArrayCopy(arrInfo, elemGoType);

		this.pushInstruction("end");

		this.releaseTemp(srcTmp, sliceWType);
		this.releaseTemp(dstTmp, sliceWType);

		this.pushInstruction({ op: "local.get", index: nTmp });
		this.releaseTemp(nTmp, "i32");
		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_u");
		}
	}

	_emitBuiltinDelete(call) {
		const { args } = call;
		const mArg = args[0];
		const kArg = args[1];
		const mType = mArg._type ?? this._resolveExprGoType(mArg);
		const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);
		this.emitExpr(mArg, mapInfo.wType);
		this.emitExpr(kArg, mapInfo.keyWType);
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.deleteFuncName),
		});
	}

	_emitBuiltinClear(call) {
		const { args } = call;
		const arg = args[0];
		const argType = arg._type ?? this._resolveExprGoType(arg);
		if (isMapType(argType, this.mod.checker)) {
			const { keyType, valType } = getMapKeyValTypes(argType, this.mod.checker);
			const mapInfo = this.mod.getMapType(keyType, valType);
			this.emitExpr(arg, mapInfo.wType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.resolveFuncIndex(mapInfo.clearFuncName),
			});
			return;
		}
		if (isSliceType(argType, this.mod.checker)) {
			this.emitSliceClear(arg, argType);
			return;
		}
	}

	_emitBuiltinPrint(call) {
		const { func, args } = call;
		const isPrintln = func.name === "println";
		if (args.length === 0 && isPrintln) {
			const logIdx = this.mod.getPrintlnEmptyIndex();
			this.pushInstruction({ op: "call", funcIndex: logIdx });
			return;
		}
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const isLast = i === args.length - 1 && isPrintln;
			const isBool =
				arg._type?.name === "bool" ||
				(arg.kind === "BasicLit" && arg.litKind === "BOOL");
			const wType = toWasmType(arg._type, this.mod.checker);
			this.emitExpr(arg, wType);
			const logFuncIdx = this.mod.getLogImportIndex(wType, isLast, isBool);
			this.pushInstruction({ op: "call", funcIndex: logFuncIdx });
		}
	}

	_emitBuiltinPanic(call) {
		const { args } = call;
		const arg = args?.[0];
		if (!arg) {
			const strIdx = this.mod.internString("");
			const funcIdx = this.mod.getStringImportIndex();
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			this.pushInstruction("any.convert_extern");
		} else {
			const goType = this._resolveExprGoType(arg);
			const wType = toWasmType(goType, this.mod.checker);
			if (
				isStringType(goType, this.mod.checker) ||
				(arg.kind === "BasicLit" && arg.litKind === "STRING") ||
				wType === "externref"
			) {
				this.emitExpr(arg, "externref");
				this.pushInstruction("any.convert_extern");
			} else if (wType === "i64") {
				this.emitExpr(arg, "i64");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrFromI64ImportIndex(),
				});
				this.pushInstruction("any.convert_extern");
			} else if (wType === "i32") {
				this.emitExpr(arg, "i32");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrFromI32ImportIndex(),
				});
				this.pushInstruction("any.convert_extern");
			} else if (wType === "f64" || wType === "f32") {
				if (wType === "f32") {
					this.emitExpr(arg, "f32");
					this.pushInstruction("f64.promote_f32");
				} else {
					this.emitExpr(arg, "f64");
				}
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStrFromF64ImportIndex(),
				});
				this.pushInstruction("any.convert_extern");
			} else {
				this.emitExpr(arg, "anyref");
			}
		}
		this.emitPanicThrow();
	}

	_emitBuiltinRecover(_call, targetWasmType) {
		const panicNodeTypeIndex = this.mod.getPanicNodeTypeIndex();
		const panicGlobal = this.mod.getPanicGlobalIndex();
		const tmp = this.acquireTemp("anyref");

		// tmp = null
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: tmp });

		// if (__panic != null)
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({ op: "ref.is_null" });
		this.pushInstruction({ op: "i32.eqz" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifHasPanicNode");

		// if (__panic.recovered == 0)
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 1, // recovered
		});
		this.pushInstruction({ op: "i32.eqz" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifNotYetRecovered");

		// __panic.recovered = 1
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 1,
		});

		// tmp = __panic.val
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 0, // val
		});
		this.pushInstruction({ op: "local.set", index: tmp });

		this.pushInstruction("end"); // ifNotYetRecovered

		this.pushInstruction("end"); // ifHasPanicNode

		this.pushInstruction({ op: "local.get", index: tmp });
		this.releaseTemp(tmp, "anyref");

		if (targetWasmType === "externref") {
			this.pushInstruction("extern.convert_any");
		}
	}

	_emitBuiltinCall(call, targetWasmType) {
		const { func } = call;
		if (func.kind !== "Ident") return false;
		switch (func.name) {
			case "len":
				this._emitBuiltinLen(call, targetWasmType);
				return true;
			case "string":
				this._emitBuiltinString(call);
				return true;
			case "cap":
				this._emitBuiltinCap(call, targetWasmType);
				return true;
			case "make":
				this._emitBuiltinMake(call);
				return true;
			case "append":
				this._emitBuiltinAppend(call);
				return true;
			case "copy":
				this._emitBuiltinCopy(call, targetWasmType);
				return true;
			case "delete":
				this._emitBuiltinDelete(call);
				return true;
			case "clear":
				this._emitBuiltinClear(call);
				return true;
			case "print":
			case "println":
				this._emitBuiltinPrint(call);
				return true;
			case "panic":
				this._emitBuiltinPanic(call);
				return true;
			case "recover":
				this._emitBuiltinRecover(call, targetWasmType);
				return true;
			default:
				return false;
		}
	}

	_emitPackageCall(call, targetWasmType) {
		const { func, args } = call;
		if (func.kind !== "SelectorExpr") return false;
		if (isTestingT(func.expr?._type)) {
			this.emitTestingCall(func, args);
			return true;
		}
		const pkgName = func.expr?.name;
		switch (pkgName) {
			case "math":
				this.emitMathCall(func.field, args);
				return true;
			case "bits":
				this.emitBitsCall(func.field, args);
				return true;
			case "maps":
				this.emitMapsCall(func.field, args, targetWasmType);
				return true;
			case "slices":
				this.emitSlicesCall(func.field, args, targetWasmType);
				return true;
			case "strings":
				this.emitStringsCall(func.field, args, targetWasmType);
				return true;
			case "strconv":
				this.emitStrconvCall(func.field, args, targetWasmType);
				return true;
			case "fmt":
				this.emitFmtCall(func.field, args);
				return true;
			default:
				return false;
		}
	}

	_emitMethodCall(call) {
		const { func, args } = call;
		if (func.kind !== "SelectorExpr") return false;

		const recvType = func.expr._type ?? this._resolveExprGoType(func.expr);
		const recvTypeName = this._getReceiverTypeName(recvType, func.expr);
		if (isNonEmptyInterface(recvType, this.mod.checker)) {
			const ifaceName = recvTypeName ?? "anon";
			const dispatchName = `__dispatch_${ifaceName}_${func.field}`;
			const targetFuncIdx = this.mod.resolveFuncIndex(dispatchName);
			if (targetFuncIdx !== null) {
				const targetParamTypes = this.mod.getFuncParamTypes(dispatchName);
				const paramGoTypes = this.mod.getFuncParamGoTypes(dispatchName);
				this.emitExpr(func.expr, "anyref");
				for (let i = 0; i < args.length; i++) {
					const pType = targetParamTypes[i + 1] ?? null;
					const pGoType = paramGoTypes[i + 1] ?? null;
					const isValParam =
						isStructType(pGoType, this.mod.checker, this.mod) &&
						!isPointerToStruct(pGoType, this.mod.checker, this.mod);
					const isFreshArg =
						args[i].kind === "CompositeLit" ||
						(args[i].kind === "UnaryExpr" && args[i].op === "*");
					this.emitExpr(args[i], pType);
					if (isValParam && !isFreshArg) {
						const sInfo = this._resolveStructInfo(args[i]);
						if (sInfo) {
							this.emitCloneStruct(sInfo, pType);
						}
					}
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		if (recvTypeName) {
			const methodName = `${recvTypeName}.${func.field}`;
			let targetFuncIdx = this.mod.resolveFuncIndex(methodName);
			let targetParamTypes = this.mod.getFuncParamTypes(methodName);

			// If not found directly, check embedded structs
			if (targetFuncIdx === null) {
				const structInfo = this.mod.getStructType(recvTypeName);
				if (structInfo) {
					for (const embed of structInfo.embeds) {
						const embedMethodName = `${embed.name}.${func.field}`;
						const subIdx = this.mod.resolveFuncIndex(embedMethodName);
						if (subIdx !== null) {
							targetFuncIdx = subIdx;
							targetParamTypes = this.mod.getFuncParamTypes(embedMethodName);
							const baseWType = this.toWasmType(recvType);
							this.emitExpr(func.expr, baseWType);
							this.pushInstruction({
								op: "struct.get",
								typeIndex: structInfo.typeIndex,
								fieldIndex: embed.fieldIndex,
							});
							for (let i = 0; i < args.length; i++) {
								const pType = targetParamTypes[i + 1] ?? null;
								this.emitExpr(args[i], pType);
							}
							this.pushInstruction({
								op: "call",
								funcIndex: targetFuncIdx,
							});
							return true;
						}
					}
				}
			}

			if (targetFuncIdx !== null) {
				const recvWType = targetParamTypes[0] ?? null;
				const recvGoType = this.mod.getFuncParamGoTypes(methodName)[0] ?? null;
				const isValRecv =
					isStructType(recvGoType, this.mod.checker, this.mod) &&
					!isPointerToStruct(recvGoType, this.mod.checker, this.mod);
				const isFreshRecv =
					func.expr.kind === "CompositeLit" ||
					(func.expr.kind === "UnaryExpr" && func.expr.op === "*");
				this.emitExpr(func.expr, recvWType);
				if (isValRecv && !isFreshRecv) {
					const sInfo = this._resolveStructInfo(func.expr);
					if (sInfo) {
						this.emitCloneStruct(sInfo, recvWType);
					}
				}
				const paramGoTypes = this.mod.getFuncParamGoTypes(methodName);
				for (let i = 0; i < args.length; i++) {
					const pType = targetParamTypes[i + 1] ?? null;
					const pGoType = paramGoTypes[i + 1] ?? null;
					const isValParam =
						isStructType(pGoType, this.mod.checker, this.mod) &&
						!isPointerToStruct(pGoType, this.mod.checker, this.mod);
					const isFreshArg =
						args[i].kind === "CompositeLit" ||
						(args[i].kind === "UnaryExpr" && args[i].op === "*");
					this.emitExpr(args[i], pType);
					if (isValParam && !isFreshArg) {
						const sInfo = this._resolveStructInfo(args[i]);
						if (sInfo) {
							this.emitCloneStruct(sInfo, pType);
						}
					}
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		return false;
	}

	_emitStaticCall(call) {
		const { func, args } = call;
		if (func.kind !== "Ident") return false;

		const isLocal = this.resolveLocal(func.name) !== null;
		if (!isLocal) {
			const targetFuncIdx = this.mod.resolveFuncIndex(func.name);
			if (targetFuncIdx !== null) {
				const paramTypes = this.mod.getFuncParamTypes(func.name);
				const paramGoTypes = this.mod.getFuncParamGoTypes(func.name);
				for (let i = 0; i < args.length; i++) {
					const arg = args[i];
					const pType = paramTypes[i] ?? null;
					const pGoType = paramGoTypes[i] ?? null;
					const isValParam =
						isStructType(pGoType, this.mod.checker, this.mod) &&
						!isPointerToStruct(pGoType, this.mod.checker, this.mod);
					const isFreshArg =
						arg.kind === "CompositeLit" ||
						(arg.kind === "UnaryExpr" && arg.op === "*");
					this.emitExpr(arg, pType);
					if (isValParam && !isFreshArg) {
						const sInfo = this._resolveStructInfo(arg);
						if (sInfo) {
							this.emitCloneStruct(sInfo, pType);
						}
					}
				}
				this.pushInstruction({ op: "call", funcIndex: targetFuncIdx });
				return true;
			}
		}
		return false;
	}

	_emitClosureCall(call) {
		const { func, args } = call;
		const funcGoType = this._resolveExprGoType(func) ?? func._type;
		const closureInfo = this.mod.getClosureType(funcGoType);
		const closureWType = {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		};

		const closureTmp = this.acquireTemp(closureWType);
		this.emitExpr(func, closureWType);
		this.pushInstruction({ op: "local.set", index: closureTmp });

		// Push param 0: env (anyref)
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});

		// Push user arguments
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			const pWType = closureInfo.paramWTypes[i] ?? null;
			const pGoType = closureInfo.sig.params[i] ?? null;
			const isValParam =
				isStructType(pGoType, this.mod.checker, this.mod) &&
				!isPointerToStruct(pGoType, this.mod.checker, this.mod);
			const isFreshArg =
				arg.kind === "CompositeLit" ||
				(arg.kind === "UnaryExpr" && arg.op === "*");
			this.emitExpr(arg, pWType);
			if (isValParam && !isFreshArg) {
				const sInfo = this._resolveStructInfo(arg);
				if (sInfo) {
					this.emitCloneStruct(sInfo, pWType);
				}
			}
		}

		// Push funcref
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});

		// Call via call_ref
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		this.releaseTemp(closureTmp, closureWType);
	}

	emitCallExpr(call, targetWasmType = null) {
		const deqFunc = this._dequalify(call.func);
		if (deqFunc) {
			this.emitCallExpr({ ...call, func: deqFunc }, targetWasmType);
			return;
		}

		if (this._emitBuiltinCall(call, targetWasmType)) {
			return;
		}

		if (this._emitPackageCall(call, targetWasmType)) {
			return;
		}

		if (this._emitMethodCall(call)) {
			return;
		}

		if (this._emitStaticCall(call)) {
			return;
		}

		this._emitClosureCall(call);
	}

	_isMathConst(expr) {
		return (
			expr.expr?.kind === "Ident" &&
			expr.expr.name === "math" &&
			!this.resolveLocal("math") &&
			!this.mod.resolveGlobal("math") &&
			MATH_CONSTS[expr.field] !== undefined
		);
	}

	emitMathConst(name, targetWasmType) {
		const v = MATH_CONSTS[name];
		const wType = targetWasmType ?? (typeof v === "bigint" ? "i64" : "f64");
		switch (wType) {
			case "i32":
				this.pushInstruction({ op: "i32.const", value: Number(v) | 0 });
				return;
			case "i64":
				this.pushInstruction({
					op: "i64.const",
					value: BigInt.asIntN(
						64,
						typeof v === "bigint" ? v : BigInt(Math.trunc(v)),
					),
				});
				return;
			case "f32":
				this.pushInstruction({
					op: "f32.const",
					value: Math.fround(Number(v)),
				});
				return;
			default:
				this.pushInstruction({ op: "f64.const", value: Number(v) });
		}
	}

	emitMathCall(name, args) {
		// Native WASM instructions
		switch (name) {
			case "Sqrt":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.sqrt");
				return;
			case "Floor":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.floor");
				return;
			case "Ceil":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.ceil");
				return;
			case "Trunc":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.trunc");
				return;
			case "Abs":
				this.emitExpr(args[0], "f64");
				this.pushInstruction("f64.abs");
				return;
			case "Min":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.min");
				return;
			case "Max":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.max");
				return;
			case "Copysign":
				this.emitExpr(args[0], "f64");
				this.emitExpr(args[1], "f64");
				this.pushInstruction("f64.copysign");
				return;
			case "Inf":
				// Go: Inf(sign) is +Inf when sign >= 0; copysign with the converted
				// sign gives exactly that (0 converts to +0.0).
				this.pushInstruction({ op: "f64.const", value: Infinity });
				this.emitExpr(args[0], "i64");
				this.pushInstruction("f64.convert_i64_s");
				this.pushInstruction("f64.copysign");
				return;
			case "NaN":
				this.pushInstruction({ op: "f64.const", value: NaN });
				return;
			case "IsNaN": {
				const tmp = this.acquireTemp("f64");
				this.emitExpr(args[0], "f64");
				this.pushInstruction({ op: "local.tee", index: tmp });
				this.pushInstruction({ op: "local.get", index: tmp });
				this.pushInstruction("f64.ne");
				this.releaseTemp(tmp, "f64");
				return;
			}
			case "IsInf": {
				// IsInf(f, sign): sign > 0 → f == +Inf, sign < 0 → f == -Inf, else |f| == Inf.
				const f = this.acquireTemp("f64");
				const s = this.acquireTemp("i64");
				this.emitExpr(args[0], "f64");
				this.pushInstruction({ op: "local.set", index: f });
				this.emitExpr(args[1], "i64");
				this.pushInstruction({ op: "local.set", index: s });
				// (s >= 0 && f == +Inf) || (s <= 0 && f == -Inf)
				this.pushInstruction({ op: "local.get", index: s });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.ge_s");
				this.pushInstruction({ op: "local.get", index: f });
				this.pushInstruction({ op: "f64.const", value: Infinity });
				this.pushInstruction("f64.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction({ op: "local.get", index: s });
				this.pushInstruction({ op: "i64.const", value: 0n });
				this.pushInstruction("i64.le_s");
				this.pushInstruction({ op: "local.get", index: f });
				this.pushInstruction({ op: "f64.const", value: -Infinity });
				this.pushInstruction("f64.eq");
				this.pushInstruction("i32.and");
				this.pushInstruction("i32.or");
				this.releaseTemp(s, "i64");
				this.releaseTemp(f, "f64");
				return;
			}
		}

		// Imported JS Math functions
		const jsMathMap = {
			Sin: "sin",
			Cos: "cos",
			Tan: "tan",
			Asin: "asin",
			Acos: "acos",
			Atan: "atan",
			Atan2: "atan2",
			Pow: "pow",
			Exp: "exp",
			Log: "log",
			Log2: "log2",
			Log10: "log10",
			Round: "round",
		};

		if (jsMathMap[name]) {
			const jsName = jsMathMap[name];
			const isBinary = name === "Atan2" || name === "Pow";
			this.emitExpr(args[0], "f64");
			if (isBinary) this.emitExpr(args[1], "f64");
			const funcIdx = this.mod.getMathImportIndex(jsName, isBinary);
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			return;
		}

		throw new Error(`Unsupported math function: math.${name}`);
	}

	// `t.Method(args...)` on a `*testing.T`: the receiver is a JS object held
	// as externref.  Arguments are pushed to a JS-side buffer one at a time
	// (typed imports), then `testing_call(t, nameIdx)` dispatches by name.
	emitTestingCall(func, args) {
		const method = func.field;
		const nameIdx = this.mod.internString(method);
		if (method === "Run") {
			throw new Error(
				"t.Run is not yet supported in wasm test packages (planned)",
			);
		}
		if (method === "Name") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingNameImportIndex(),
			});
			return;
		}
		if (method === "Failed" || method === "Skipped") {
			this.emitExpr(func.expr, "externref");
			this.pushInstruction({ op: "i32.const", value: nameIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingFlagImportIndex(),
			});
			return;
		}
		for (const arg of args) {
			const isBool =
				arg._type?.name === "bool" ||
				(arg.kind === "BasicLit" && arg.litKind === "BOOL");
			const wType = toWasmType(arg._type, this.mod.checker);
			this.emitExpr(arg, wType);
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getTestingArgImportIndex(wType, isBool),
			});
		}
		this.emitExpr(func.expr, "externref");
		this.pushInstruction({ op: "i32.const", value: nameIdx });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getTestingCallImportIndex(),
		});
	}

	emitBitsCall(name, args) {
		switch (name) {
			case "LeadingZeros32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.clz");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "TrailingZeros32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.ctz");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "OnesCount32":
				this.emitExpr(args[0], "i32");
				this.pushInstruction("i32.popcnt");
				this.pushInstruction("i64.extend_i32_u");
				return;
			case "RotateLeft32": {
				this.emitExpr(args[0], "i32");
				const arg1WType = toWasmType(args[1]?._type, this.mod.checker);
				if (arg1WType === "i64") {
					this.emitExpr(args[1], "i64");
					this.pushInstruction("i32.wrap_i64");
				} else {
					this.emitExpr(args[1], "i32");
				}
				this.pushInstruction("i32.rotl");
				return;
			}

			case "LeadingZeros64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.clz");
				return;
			case "TrailingZeros64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.ctz");
				return;
			case "OnesCount64":
				this.emitExpr(args[0], "i64");
				this.pushInstruction("i64.popcnt");
				return;
			case "RotateLeft64": {
				this.emitExpr(args[0], "i64");
				const arg1WType = toWasmType(args[1]?._type, this.mod.checker);
				if (arg1WType === "i32") {
					this.emitExpr(args[1], "i32");
					this.pushInstruction("i64.extend_i32_s");
				} else {
					this.emitExpr(args[1], "i64");
				}
				this.pushInstruction("i64.rotl");
				return;
			}

			default:
				throw new Error(`Unsupported bits function: bits.${name}`);
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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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

	emitMapsCall(name, args, _targetWasmType) {
		switch (name) {
			case "Keys": {
				const mArg = args[0];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.keysFuncName),
				});
				return;
			}
			case "Values": {
				const mArg = args[0];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.valuesFuncName),
				});
				return;
			}
			case "Clone": {
				const mArg = args[0];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.cloneFuncName),
				});
				return;
			}
			case "Copy":
				this.emitMapsCopy(args);
				return;
			case "Equal":
				this.emitMapsEqual(args, false);
				return;
			case "EqualFunc":
				this.emitMapsEqual(args, true);
				return;
			case "Delete": {
				const mArg = args[0];
				const kArg = args[1];
				const mType = mArg._type ?? this._resolveExprGoType(mArg);
				const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
				const mapInfo = this.mod.getMapType(keyType, valType);
				this.emitExpr(mArg, mapInfo.wType);
				this.emitExpr(kArg, mapInfo.keyWType);
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.resolveFuncIndex(mapInfo.deleteFuncName),
				});
				return;
			}
			case "DeleteFunc":
				this.emitMapsDeleteFunc(args);
				return;
			default:
				throw new Error(`Unsupported maps function: maps.${name}`);
		}
	}

	emitMapsCopy(args) {
		const dstNode = args[0];
		const srcNode = args[1];
		const dstType = dstNode._type ?? this._resolveExprGoType(dstNode);
		const { keyType, valType } = getMapKeyValTypes(dstType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		const dstTmp = this.acquireTemp(mapInfo.wType);
		const srcTmp = this.acquireTemp(mapInfo.wType);
		this.emitExpr(dstNode, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: dstTmp });
		this.emitExpr(srcNode, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: srcTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		// if src == null -> return
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// if dst == null -> panic
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic("assignment to entry in nil map");
		this.pushInstruction("end");

		const idxTmp = this.acquireTemp("i32");
		const entryTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});

		// idx = src.head
		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: srcTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		// dst[k] = v
		this.pushInstruction({ op: "local.get", index: dstTmp });
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.setFuncName),
		});

		this.pushInstruction("end");

		// idx = entry.order_next
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(entryTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.releaseTemp(idxTmp, "i32");

		this.pushInstruction("end");
		this.releaseTemp(srcTmp, mapInfo.wType);
		this.releaseTemp(dstTmp, mapInfo.wType);
	}

	emitMapsEqual(args, isFunc = false) {
		const m1Node = args[0];
		const m2Node = args[1];
		const eqFn = isFunc ? args[2] : null;

		const m1Type = m1Node._type ?? this._resolveExprGoType(m1Node);
		const { keyType, valType } = getMapKeyValTypes(m1Type, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		const m1Tmp = this.acquireTemp(mapInfo.wType);
		const m2Tmp = this.acquireTemp(mapInfo.wType);
		this.emitExpr(m1Node, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: m1Tmp });
		this.emitExpr(m2Node, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: m2Tmp });

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.pushInstruction({ op: "block", blockType: "void" }); // exit block 0

		// if m1 == m2 -> res = 1; br 0
		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end");

		// if m1 == null || m2 == null -> br 0
		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// if m1.len != m2.len -> br 0
		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// Loop m1 entries
		const idxTmp = this.acquireTemp("i32");
		const entryTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const val1Tmp = this.acquireTemp(mapInfo.valWType);
		const val2Tmp = this.acquireTemp(mapInfo.valWType);
		const okTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: m1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		// val2, ok = getOk(m2, entry.key)
		this.pushInstruction({ op: "local.get", index: m2Tmp });
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.getOkFuncName),
		});
		this.pushInstruction({ op: "local.set", index: okTmp });
		this.pushInstruction({ op: "local.set", index: val2Tmp });

		// if !ok -> br 3 (exit outer block with res=0)
		this.pushInstruction({ op: "local.get", index: okTmp });
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 3 });

		// check entry.val == val2
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: val1Tmp });

		if (isFunc) {
			const eqClosureType = this._resolveExprGoType(eqFn);
			const closureInfo = this.mod.getClosureType(eqClosureType);
			const closureTmp = this.acquireTemp({
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});
			this.emitExpr(eqFn, {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});
			this.pushInstruction({ op: "local.set", index: closureTmp });

			// env
			this.pushInstruction({ op: "local.get", index: closureTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: closureInfo.typeIndex,
				fieldIndex: 1,
			});
			// arg 0: val1
			this.pushInstruction({ op: "local.get", index: val1Tmp });
			// arg 1: val2
			this.pushInstruction({ op: "local.get", index: val2Tmp });
			// funcref
			this.pushInstruction({ op: "local.get", index: closureTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: closureInfo.typeIndex,
				fieldIndex: 0,
			});
			this.pushInstruction({
				op: "call_ref",
				typeIndex: closureInfo.funcTypeIndex,
			});
			this.releaseTemp(closureTmp, {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			});

			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "br_if", depth: 3 });
		} else {
			this.emitKeyEq(val1Tmp, val2Tmp, valType);
			this.pushInstruction("i32.eqz");
			this.pushInstruction({ op: "br_if", depth: 3 });
		}

		this.pushInstruction("end"); // end if active

		// idx = entry.order_next
		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// All matched: res = 1
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });

		this.releaseTemp(okTmp, "i32");
		this.releaseTemp(val2Tmp, mapInfo.valWType);
		this.releaseTemp(val1Tmp, mapInfo.valWType);
		this.releaseTemp(entryTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.releaseTemp(idxTmp, "i32");

		this.pushInstruction("end"); // end outer block 0

		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(m2Tmp, mapInfo.wType);
		this.releaseTemp(m1Tmp, mapInfo.wType);
	}

	emitMapsDeleteFunc(args) {
		const mNode = args[0];
		const delFn = args[1];
		const mType = mNode._type ?? this._resolveExprGoType(mNode);
		const { keyType, valType } = getMapKeyValTypes(mType, this.mod.checker);
		const mapInfo = this.mod.getMapType(keyType, valType);

		const mTmp = this.acquireTemp(mapInfo.wType);
		this.emitExpr(mNode, mapInfo.wType);
		this.pushInstruction({ op: "local.set", index: mTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const idxTmp = this.acquireTemp("i32");
		const nextTmp = this.acquireTemp("i32");
		const entryTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		const keyTmp = this.acquireTemp(mapInfo.keyWType);
		const valTmp = this.acquireTemp(mapInfo.valWType);

		const delClosureType = this._resolveExprGoType(delFn);
		const closureInfo = this.mod.getClosureType(delClosureType);
		const closureTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.emitExpr(delFn, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: closureTmp });

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "local.set", index: idxTmp });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "br_if", depth: 1 });

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: idxTmp });
		this.pushInstruction({
			op: "array.get",
			typeIndex: mapInfo.entriesTypeIndex,
		});
		this.pushInstruction({ op: "local.set", index: entryTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 4,
		});
		this.pushInstruction({ op: "local.set", index: nextTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 5,
		});
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: keyTmp });

		this.pushInstruction({ op: "local.get", index: entryTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: mapInfo.entryTypeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: valTmp });

		// call delFn(key, val)
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: keyTmp });
		this.pushInstruction({ op: "local.get", index: valTmp });
		this.pushInstruction({ op: "local.get", index: closureTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: closureInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({
			op: "call_ref",
			typeIndex: closureInfo.funcTypeIndex,
		});

		// if delFn returned true -> delete(m, key)
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "local.get", index: keyTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex(mapInfo.deleteFuncName),
		});
		this.pushInstruction("end");

		this.pushInstruction("end"); // end if active

		this.pushInstruction({ op: "local.get", index: nextTmp });
		this.pushInstruction({ op: "local.set", index: idxTmp });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(closureTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: closureInfo.typeIndex,
		});
		this.releaseTemp(valTmp, mapInfo.valWType);
		this.releaseTemp(keyTmp, mapInfo.keyWType);
		this.releaseTemp(entryTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: mapInfo.entryTypeIndex,
		});
		this.releaseTemp(nextTmp, "i32");
		this.releaseTemp(idxTmp, "i32");

		this.pushInstruction("end");
		this.releaseTemp(mTmp, mapInfo.wType);
	}

	emitSlicesCall(name, args, targetWasmType) {
		switch (name) {
			case "Sort":
				this.emitSlicesSort(args);
				return;
			case "Reverse":
				this.emitSlicesReverse(args);
				return;
			case "Contains":
				this.emitSlicesContains(args);
				return;
			case "Index":
				this.emitSlicesIndex(args, targetWasmType);
				return;
			case "Equal":
				this.emitSlicesEqual(args);
				return;
			case "Clone":
				this.emitSlicesClone(args);
				return;
			default:
				throw new Error(`Unsupported slices function: slices.${name}`);
		}
	}

	emitSlicesSort(args) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(sNode, {
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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

		// if len <= 1 -> br 0
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const iLoc = this.acquireTemp("i32");
		const jLoc = this.acquireTemp("i32");
		const keyLoc = this.acquireTemp(arrInfo.elemWType);
		const testLoc = this.acquireTemp(arrInfo.elemWType);

		// i = 1
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		// Outer loop
		this.pushInstruction({ op: "loop", blockType: "void" });

		// key = arr[off + i]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: keyLoc });

		// j = i - 1
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		// Inner loop
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		// if j < 0 -> break inner loop
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// test = arr[off + j]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: testLoc });

		// if !(key < test) -> break inner loop
		this.emitElemLt(keyLoc, testLoc, elemGoType);
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// arr[off + j + 1] = test
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: testLoc });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// j--
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		// arr[off + j + 1] = key
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: keyLoc });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// i++
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.tee", index: iLoc });

		// if i < len -> continue outer loop
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "br_if", depth: 0 });

		this.pushInstruction("end"); // end outer loop

		this.releaseTemp(testLoc, arrInfo.elemWType);
		this.releaseTemp(keyLoc, arrInfo.elemWType);
		this.releaseTemp(jLoc, "i32");
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // end exit block
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	emitSlicesReverse(args) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(sNode, {
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

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

		const iLoc = this.acquireTemp("i32");
		const jLoc = this.acquireTemp("i32");
		const tmp1 = this.acquireTemp(arrInfo.elemWType);
		const tmp2 = this.acquireTemp(arrInfo.elemWType);

		// i = 0, j = len - 1
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });

		// if i >= j -> break
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// tmp1 = arr[off + i]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: tmp1 });

		// tmp2 = arr[off + j]
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: tmp2 });

		// arr[off + i] = tmp2
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: tmp2 });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// arr[off + j] = tmp1
		this.pushInstruction({ op: "local.get", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: tmp1 });
		this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });

		// i++, j--
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "local.get", index: jLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: jLoc });

		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(tmp2, arrInfo.elemWType);
		this.releaseTemp(tmp1, arrInfo.elemWType);
		this.releaseTemp(jLoc, "i32");
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

	emitSlicesContains(args) {
		const sNode = args[0];
		const vNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		const vTmp = this.acquireTemp(arrInfo.elemWType);
		this.emitExpr(sNode, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });
		this.emitExpr(vNode, arrInfo.elemWType);
		this.pushInstruction({ op: "local.set", index: vTmp });

		const resTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resTmp });

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
		const itemTmp = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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
		this.pushInstruction({ op: "local.set", index: itemTmp });

		this.emitKeyEq(itemTmp, vTmp, elemGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resTmp });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(itemTmp, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // end exit block
		this.pushInstruction({ op: "local.get", index: resTmp });
		this.releaseTemp(resTmp, "i32");
		this.releaseTemp(vTmp, arrInfo.elemWType);
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	emitSlicesIndex(args, targetWasmType) {
		const sNode = args[0];
		const vNode = args[1];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		const vTmp = this.acquireTemp(arrInfo.elemWType);
		this.emitExpr(sNode, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });
		this.emitExpr(vNode, arrInfo.elemWType);
		this.pushInstruction({ op: "local.set", index: vTmp });

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction({ op: "local.set", index: resLoc });

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
		const itemTmp = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: arrTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });
		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenTmp });

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
		this.pushInstruction({ op: "local.set", index: itemTmp });

		this.emitKeyEq(itemTmp, vTmp, elemGoType);
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 2 });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(itemTmp, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenTmp, "i32");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(arrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction("end"); // end exit block
		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
		this.releaseTemp(vTmp, arrInfo.elemWType);
		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});

		if ((targetWasmType ?? "i64") === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		}
	}

	emitSlicesEqual(args) {
		const s1Node = args[0];
		const s2Node = args[1];
		const sType = s1Node._type ?? this._resolveExprGoType(s1Node);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const s1Tmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		const s2Tmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(s1Node, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: s1Tmp });
		this.emitExpr(s2Node, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: s2Tmp });

		const resLoc = this.acquireTemp("i32");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.pushInstruction({ op: "block", blockType: "void" });

		// if s1 == s2 -> 1
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction("ref.eq");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });
		this.pushInstruction({ op: "br", depth: 1 });
		this.pushInstruction("end");

		// if s1 == null || s2 == null -> 0 (br 0)
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction("i32.or");
		this.pushInstruction({ op: "br_if", depth: 0 });

		// if s1.len != s2.len -> 0 (br 0)
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("i32.ne");
		this.pushInstruction({ op: "br_if", depth: 0 });

		const lenLoc = this.acquireTemp("i32");
		const iLoc = this.acquireTemp("i32");
		const item1 = this.acquireTemp(arrInfo.elemWType);
		const item2 = this.acquireTemp(arrInfo.elemWType);

		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.set", index: lenLoc });

		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.set", index: iLoc });

		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushInstruction({ op: "loop", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "local.get", index: lenLoc });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "br_if", depth: 1 });

		// item1 = s1.arr[s1.off + i]
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: s1Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: item1 });

		// item2 = s2.arr[s2.off + i]
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: s2Tmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: item2 });

		this.emitKeyEq(item1, item2, elemGoType);
		this.pushInstruction("i32.eqz");
		this.pushInstruction({ op: "br_if", depth: 2 }); // mismatch -> res 0

		this.pushInstruction({ op: "local.get", index: iLoc });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: iLoc });
		this.pushInstruction({ op: "br", depth: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: resLoc });

		this.releaseTemp(item2, arrInfo.elemWType);
		this.releaseTemp(item1, arrInfo.elemWType);
		this.releaseTemp(iLoc, "i32");
		this.releaseTemp(lenLoc, "i32");

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resLoc });
		this.releaseTemp(resLoc, "i32");
		this.releaseTemp(s2Tmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.releaseTemp(s1Tmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	emitSlicesClone(args) {
		const sNode = args[0];
		const sType = sNode._type ?? this._resolveExprGoType(sNode);
		const elemGoType = this._getSliceElemType(sType);
		const sliceInfo = this.mod.getSliceType(elemGoType);
		const arrInfo = sliceInfo.arrInfo;

		const sliceTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.emitExpr(sNode, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: sliceTmp });

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({
			op: "if",
			blockType: {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			},
		});
		this.pushInstruction({ op: "ref.null", heapType: sliceInfo.typeIndex });
		this.pushInstruction("else");

		const lenTmp = this.acquireTemp("i32");
		const newArrTmp = this.acquireTemp({
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});

		this.pushInstruction({ op: "local.get", index: sliceTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: sliceInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.tee", index: lenTmp });
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: newArrTmp });

		// array.copy (newArr, 0, srcArr, srcOff, len)
		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
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
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this._emitArrayCopy(arrInfo, elemGoType);

		// struct.new slice (newArr, 0, len, len)
		this.pushInstruction({ op: "local.get", index: newArrTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({ op: "local.get", index: lenTmp });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: sliceInfo.typeIndex,
		});

		this.releaseTemp(newArrTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		});
		this.releaseTemp(lenTmp, "i32");
		this.pushInstruction("end"); // end if

		this.releaseTemp(sliceTmp, {
			kind: "ref",
			nullable: true,
			typeIndex: sliceInfo.typeIndex,
		});
	}

	emitStringsCall(name, args, targetWasmType) {
		switch (name) {
			case "ToUpper": {
				this.emitExpr(args[0], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringToUpperImportIndex(),
				});
				return;
			}
			case "ToLower": {
				this.emitExpr(args[0], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringToLowerImportIndex(),
				});
				return;
			}
			case "TrimSpace": {
				this.emitExpr(args[0], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringTrimSpaceImportIndex(),
				});
				return;
			}
			case "Contains": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringContainsImportIndex(),
				});
				return;
			}
			case "HasPrefix": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringHasPrefixImportIndex(),
				});
				return;
			}
			case "HasSuffix": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringHasSuffixImportIndex(),
				});
				return;
			}
			case "Index": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringIndexImportIndex(),
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "LastIndex": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringLastIndexImportIndex(),
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			case "Repeat": {
				this.emitExpr(args[0], "externref");
				const cntWType = toWasmType(args[1]?._type, this.mod.checker);
				if (cntWType === "i64") {
					this.emitExpr(args[1], "i64");
					this.pushInstruction("i32.wrap_i64");
				} else {
					this.emitExpr(args[1], "i32");
				}
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringRepeatImportIndex(),
				});
				return;
			}
			case "ReplaceAll": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.emitExpr(args[2], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringReplaceAllImportIndex(),
				});
				return;
			}
			case "EqualFold": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringEqualFoldImportIndex(),
				});
				return;
			}
			case "Count": {
				this.emitExpr(args[0], "externref");
				this.emitExpr(args[1], "externref");
				this.pushInstruction({
					op: "call",
					funcIndex: this.mod.getStringCountImportIndex(),
				});
				if ((targetWasmType ?? "i64") === "i64") {
					this.pushInstruction("i64.extend_i32_s");
				}
				return;
			}
			default:
				throw new Error(`Unsupported strings function: strings.${name}`);
		}
	}

	emitStrconvCall(name, args, _targetWasmType) {
		switch (name) {
			case "Itoa": {
				const argWType = toWasmType(args[0]?._type, this.mod.checker);
				if (argWType === "i64") {
					this.emitExpr(args[0], "i64");
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getStrFromI64ImportIndex(),
					});
				} else {
					this.emitExpr(args[0], "i32");
					this.pushInstruction({
						op: "call",
						funcIndex: this.mod.getStrFromI32ImportIndex(),
					});
				}
				return;
			}
			default:
				throw new Error(`Unsupported strconv function: strconv.${name}`);
		}
	}

	emitFmtCall(name, args) {
		if (name === "Println" || name === "Print") {
			const isPrintln = name === "Println";
			if (args.length === 0 && isPrintln) {
				const logIdx = this.mod.getPrintlnEmptyIndex();
				this.pushInstruction({ op: "call", funcIndex: logIdx });
				return;
			}
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				const isLast = i === args.length - 1 && isPrintln;
				const isBool =
					arg._type?.name === "bool" ||
					(arg.kind === "BasicLit" && arg.litKind === "BOOL");
				const wType = toWasmType(arg._type, this.mod.checker);
				this.emitExpr(arg, wType);
				const logFuncIdx = this.mod.getLogImportIndex(wType, isLast, isBool);
				this.pushInstruction({ op: "call", funcIndex: logFuncIdx });
			}
			return;
		}
		throw new Error(`Unsupported fmt function: fmt.${name}`);
	}

	emitTypeConversion(conv) {
		const { targetType, expr } = conv;
		const fromType = expr._type;
		const fromWType = toWasmType(fromType, this.mod.checker);
		const toWType = toWasmType(targetType, this.mod.checker);

		this.emitExpr(expr, fromWType);

		if (fromWType === toWType) {
			this.emitNarrowIntWrap(targetType);
			return;
		}

		if (toWType === "externref") {
			if (fromWType === "i64") {
				this.pushInstruction("i32.wrap_i64");
			}
			const funcIdx = this.mod.getStringFromCodePointImportIndex();
			this.pushInstruction({ op: "call", funcIndex: funcIdx });
			return;
		}

		if (toWType === "anyref") {
			if (fromWType === "externref") {
				this.pushInstruction("any.convert_extern");
			}
			return;
		}

		if (fromWType === "i32" && toWType === "i64") {
			this.pushInstruction(
				isSigned(fromType) ? "i64.extend_i32_s" : "i64.extend_i32_u",
			);
		} else if (fromWType === "i64" && toWType === "i32") {
			this.pushInstruction("i32.wrap_i64");
			this.emitNarrowIntWrap(targetType);
		} else if (fromWType === "i32" && toWType === "f32") {
			this.pushInstruction(
				isSigned(fromType) ? "f32.convert_i32_s" : "f32.convert_i32_u",
			);
		} else if (fromWType === "i32" && toWType === "f64") {
			this.pushInstruction(
				isSigned(fromType) ? "f64.convert_i32_s" : "f64.convert_i32_u",
			);
		} else if (fromWType === "i64" && toWType === "f32") {
			this.pushInstruction(
				isSigned(fromType) ? "f32.convert_i64_s" : "f32.convert_i64_u",
			);
		} else if (fromWType === "i64" && toWType === "f64") {
			this.pushInstruction(
				isSigned(fromType) ? "f64.convert_i64_s" : "f64.convert_i64_u",
			);
		} else if (fromWType === "f32" && toWType === "f64") {
			this.pushInstruction("f64.promote_f32");
		} else if (fromWType === "f64" && toWType === "f32") {
			this.pushInstruction("f32.demote_f64");
		} else if (fromWType === "f64" && toWType === "i32") {
			this.pushInstruction(
				isSigned(targetType) ? "i32.trunc_sat_f64_s" : "i32.trunc_sat_f64_u",
			);
			this.emitNarrowIntWrap(targetType);
		} else if (fromWType === "f32" && toWType === "i32") {
			this.pushInstruction(
				isSigned(targetType) ? "i32.trunc_sat_f32_s" : "i32.trunc_sat_f32_u",
			);
			this.emitNarrowIntWrap(targetType);
		} else if (fromWType === "f64" && toWType === "i64") {
			this.pushInstruction(
				isSigned(targetType) ? "i64.trunc_sat_f64_s" : "i64.trunc_sat_f64_u",
			);
		} else if (fromWType === "f32" && toWType === "i64") {
			this.pushInstruction(
				isSigned(targetType) ? "i64.trunc_sat_f32_s" : "i64.trunc_sat_f32_u",
			);
		}
	}
}
