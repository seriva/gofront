// src/backend/wasm/emit.js
// FunctionEmitter core: function prologue/epilogue, defer/recover frames,
// locals, control stack and shared helpers.  Statement, expression, builtin,
// map and stdlib emission live in the emit-*.js mixins composed at the bottom.

import { hasDefer, hasDirectRecover } from "../../lower/functions.js";
import { BuiltinsEmitter } from "./emit-builtins.js";
import { ExprsEmitter } from "./emit-exprs.js";
import { MapsEmitter } from "./emit-maps.js";
import { SharedEmitter } from "./emit-shared.js";
import { StmtsEmitter } from "./emit-stmts.js";
import { stdlibEmitters } from "./stdlib/index.js";
import {
	isArrayType,
	isComplex,
	isComplex64,
	isPointerToStruct,
	isSliceType,
	isStringType,
	isStructType,
	toWasmType,
} from "./types.js";

// The emitter is one class split over several files by concern. Methods from
// the emit-*.js modules are assigned to FunctionEmitter.prototype below; `this`
// is shared, so cross-file calls are plain method calls.
const SCOPED_STMTS = new Set([
	"Block",
	"IfStmt",
	"ForStmt",
	"SwitchStmt",
	"TypeSwitchStmt",
]);

// A same-named method with another arity (strings.Reader.Reset(s) vs
// hash.Hash.Reset()) cannot satisfy this interface method.  Neither can one
// whose parameters or results have other types (csv.Writer.Write(record
// []string) error vs io.Writer.Write(p []byte) (int, error)).
function sameTypes(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

function sameParams(c, params, paramTypes) {
	if (c.targetParamTypes.length !== params.length) return false;
	if (paramTypes?.length !== params.length) return true;
	return c.targetParamTypes.every(
		(t, i) => i === 0 || sameTypes(t, paramTypes[i]),
	);
}

function sameSignature(c, params, paramTypes, want, got) {
	if (!Array.isArray(c.targetParamTypes)) return true;
	if (!sameParams(c, params, paramTypes)) return false;
	return want === undefined || got === undefined || sameTypes(got, want);
}

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
		this.mutatedCaptures = new Set(this.captureAnalysis?.mutatedCaptures ?? []);
		const lowerBoxed =
			this.mod.lowerResult?.boxedVars?.get(
				this.rootFuncDecl._sourceDecl ?? this.rootFuncDecl,
			) ?? [];
		for (const name of lowerBoxed) {
			this.mutatedCaptures.add(name);
		}

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
		// Local holding the `__deferArmed` snapshot taken in the prologue; null
		// when this frame can never legitimately recover().
		this.recoverOkLocalIndex = null;
	}

	// Go only honours recover() when it is called directly by a deferred
	// function.  The defer loop sets `__deferArmed` right before invoking a
	// deferred closure; the closure's prologue copies the flag into a local and
	// clears the global, so any further callee sees it unset.  Synthesized
	// wrappers (`defer f(x)` lowered to `func(){ f(__defarg$1) }`) that forward
	// to a callee which may itself call recover() leave the flag armed.
	_emitRecoverArmPrologue(body) {
		const lit = this.funcDecl._funcLit;
		const isTarget = Boolean(lit?._isDeferTarget);
		const forwards = isTarget && Boolean(lit._deferForward);
		if (forwards) return;
		if (!isTarget && !hasDirectRecover(body)) return;
		const armed = this.mod.getDeferArmedGlobalIndex();
		const local = this.allocLocal("__recoverOk", "i32", null, true);
		this.pushInstruction({ op: "global.get", index: armed });
		this.pushInstruction({ op: "local.set", index: local });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "global.set", index: armed });
		this.recoverOkLocalIndex = local;
	}

	_checkYieldClosureReentry() {
		if (!this.funcDecl._isYieldClosure || !this.funcDecl._iterStateName) return;
		const stateLoc = this.resolveLocal(this.funcDecl._iterStateName);
		if (!stateLoc?.isBoxed) return;
		this.pushInstruction({ op: "local.get", index: stateLoc.index });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: stateLoc.boxInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.ne");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.emitPanic(
			"range function continued iteration after function for loop body returned false",
		);
		this.pushInstruction("end");
	}

	_finishYieldClosureBody() {
		if (!this.funcDecl._isYieldClosure) return false;
		const lastOp = this.body[this.body.length - 1]?.op;
		if (lastOp !== "return" && lastOp !== "unreachable") {
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction({ op: "return" });
		}
		return true;
	}

	_collectLabelTargets(body) {
		const targets = new Map();
		let nextTag = 3;
		const scan = (node) => {
			if (!node || typeof node !== "object") return;
			if (Array.isArray(node)) {
				for (const item of node) scan(item);
				return;
			}
			if (node.kind === "LabeledStmt" && node.label) {
				const bTag = nextTag++;
				const cTag = nextTag++;
				targets.set(bTag, { tag: bTag, label: node.label, role: "break" });
				targets.set(cTag, { tag: cTag, label: node.label, role: "continue" });
			} else if (node.kind === "ForStmt" && node.label) {
				const bTag = nextTag++;
				const cTag = nextTag++;
				targets.set(bTag, { tag: bTag, label: node.label, role: "break" });
				targets.set(cTag, { tag: cTag, label: node.label, role: "continue" });
			}
			for (const k of Object.keys(node)) {
				if (k.startsWith("_")) continue;
				scan(node[k]);
			}
		};
		scan(body);
		return targets;
	}

	_findLabelTarget(label, role) {
		for (const target of this.rootFuncDecl?._labelTargets?.values() ?? []) {
			if (target.label === label && target.role === role) return target;
		}
		return null;
	}

	emitFunctionBody(body) {
		if (!this.funcDecl._isClosure && !this.funcDecl._labelTargets) {
			this.funcDecl._labelTargets = this._collectLabelTargets(body);
		}
		if (
			this.funcDecl._isClosure &&
			!this.funcDecl._isTrampoline &&
			this.capturedNames.length > 0
		) {
			this._unpackClosureEnv();
		}

		this._boxMutatedParams();

		this._cacheScratchGlobals();

		this._emitRecoverArmPrologue(body);
		this._checkYieldClosureReentry();

		const hasDef = hasDefer(body);
		this.hasDefer = hasDef;

		if (hasDef) {
			this._emitFunctionBodyWithDefer(body);
			return;
		}

		this._initNamedReturns();

		const closeChecks = this._openCheckBlocks(body);

		this.emitBlock(body);
		if (this._finishYieldClosureBody()) {
			closeChecks?.(() => {});
			return;
		}

		closeChecks?.(() =>
			this.pushInstruction({
				op: this.returnTypes.length === 0 ? "return" : "unreachable",
			}),
		);
	}

	// Opens the nil and index-check blocks `body` needs and returns the
	// function that closes them (null when none are needed).  The closer runs
	// `terminate` first unless the body already ends in a return or trap.
	_openCheckBlocks(body) {
		const nil = this._needsNilBlock(body);
		const oob = this._needsOobBlock(body);
		if (!nil && !oob) return null;
		if (nil) this._openNilBlock();
		if (oob) this._openOobBlocks();
		return (terminate) => {
			const lastOp = this.body[this.body.length - 1]?.op;
			if (lastOp !== "return" && lastOp !== "unreachable") terminate();
			if (oob) this._closeOobBlocks();
			if (nil) this._closeNilBlock();
		};
	}

	// Field access through a nil struct pointer branches (`br_on_null`) out
	// of the body to a block wrapped around it, whose handler raises Go's
	// panic, so `recover()` sees it where a trap would skip the defers.
	_openNilBlock() {
		this.pushInstruction({ op: "block", blockType: "void" });
		this.pushControl("nil");
	}

	// Closes the block opened by _openNilBlock; the body must already end in
	// a branch, return or unreachable.
	_closeNilBlock() {
		this.pushInstruction("end");
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getNilPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
	}

	// Index checks branch out of the body to one of two blocks wrapped around
	// it, `oob32` for i32 indexes and `oob64` for i64 indexes, carrying the
	// index and the check's site id as block results (`_pushOobSite`).  The
	// handlers after the blocks recompute that site's length and raise Go's
	// `index out of range [i] with length n`.  Nothing extra stays live in
	// the hot path: a site id is an immediate.
	_openOobBlocks() {
		this.pushInstruction({
			op: "block",
			blockType: this.mod.getTypeIndex([], ["i64", "i32"]),
		});
		this.pushControl("oob64");
		this.pushInstruction({
			op: "block",
			blockType: this.mod.getTypeIndex([], ["i32", "i32"]),
		});
		this.pushControl("oob32");
	}

	// Closes the blocks opened by _openOobBlocks; the body must already end
	// in a branch, return or unreachable.
	_closeOobBlocks() {
		const site = this.acquireTemp("i32");
		const idx = this.acquireTemp("i64");
		const len = this.acquireTemp("i32");
		// oob32 lands here with [i32 index, site]: widen the index and fall
		// through to the oob64 handler.
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: site });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction({ op: "local.get", index: site });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.set", index: site });
		this.pushInstruction({ op: "local.set", index: idx });
		// Sites whose length code is identical (same temp, same field) share
		// one br_table target.
		const codes = [];
		const target = (this.oobSites ?? []).map((emitLen) => {
			const saved = this.body;
			this.body = [];
			emitLen();
			const code = this.body;
			this.body = saved;
			const key = JSON.stringify(code);
			let k = codes.findIndex((c) => c.key === key);
			if (k < 0) k = codes.push({ key, code }) - 1;
			return k;
		});
		const sites = codes.map(({ code }) => () => {
			for (const inst of code) this.pushInstruction(inst);
		});
		if (sites.length === 0) {
			this.pushInstruction({ op: "i32.const", value: 0 });
		} else {
			// block $len (result i32) { block … block { br_table } emitLen_0; br $len … }
			this.pushInstruction({ op: "block", blockType: "i32" });
			for (let k = 0; k < sites.length; k++)
				this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: site });
			this.pushInstruction({
				op: "br_table",
				targets: target,
				defaultTarget: sites.length - 1,
			});
			for (let k = 0; k < sites.length; k++) {
				this.pushInstruction("end");
				sites[k]();
				this.pushInstruction({ op: "br", depth: sites.length - 1 - k });
			}
			this.pushInstruction("end");
		}
		this.pushInstruction({ op: "local.set", index: len });
		this.pushInstruction({ op: "local.get", index: idx });
		this.pushInstruction({ op: "local.get", index: len });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getIndexPanicFuncIndex(),
		});
		this.pushInstruction("unreachable");
		this.releaseTemp(site, "i32");
		this.releaseTemp(idx, "i64");
		this.releaseTemp(len, "i32");
	}

	_initNamedReturns() {
		const namedReturns = this.funcDecl.returnType?._namedReturns;
		if (!namedReturns?.length) return false;
		this.namedReturnVars = [];
		for (let i = 0; i < namedReturns.length; i++) {
			const r = namedReturns[i];
			const isBlank = !r.name || r.name === "_";
			const varName = isBlank ? `__ret_blank$${i}` : r.name;
			const wType = this.toWasmType(r.type);
			const localIdx = this.allocLocal(varName, wType, r.type, isBlank);
			this.emitZeroValue(r.type, wType);
			const localInfo = this.locals.get(varName);
			if (localInfo?.isBoxed) {
				this.pushInstruction({
					op: "struct.new",
					typeIndex: localInfo.boxInfo.typeIndex,
				});
			}
			this.pushInstruction({ op: "local.set", index: localIdx });
			this.namedReturnVars.push({
				name: varName,
				localIdx,
				type: wType,
				goType: r.type,
				isBlank,
			});
		}
		return true;
	}

	_emitFunctionBodyWithDefer(body) {
		if (!this._initNamedReturns() && this.returnTypes.length > 0) {
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

		const closeChecks = this._openCheckBlocks(body);

		this.emitBlock(body);

		closeChecks?.(() =>
			this.pushInstruction({
				op: "br",
				depth: this.resolveBranchDepthToRole("runDefers"),
			}),
		);

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

		// Call curClosure: curClosure.fn(curClosure.env) with recover armed.
		// The call is wrapped in its own try_table: a panic raised by a deferred
		// function replaces the in-flight panic (Go spec) and the remaining
		// defers still run.
		const armedGlobal = this.mod.getDeferArmedGlobalIndex();
		const panicNodeTypeIndex = this.mod.getPanicNodeTypeIndex();
		const panicGlobal = this.mod.getPanicGlobalIndex();

		this.pushInstruction({ op: "block", blockType: "exnref" });
		this.pushControl("deferCatch");
		this.pushInstruction({
			op: "try_table",
			blockType: "void",
			catches: [{ kind: "catch_all_ref", label: 0 }],
		});
		this.pushControl("deferTry");

		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "global.set", index: armedGlobal });
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
		// Clear in case the deferred function had no prologue (e.g. a
		// trampoline) and never consumed the flag.
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "global.set", index: armedGlobal });
		this.pushInstruction("end"); // deferTry
		// Normal completion: next defer.
		this.pushInstruction({
			op: "br",
			depth: this.resolveBranchDepthToRole("deferLoop"),
		});
		this.pushInstruction("end"); // deferCatch — stack: exnref

		// Panic inside the deferred function.
		this.pushInstruction({ op: "local.set", index: this.panicExnLocalIndex });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "global.set", index: armedGlobal });
		// If this frame was already panicking, the older panic is aborted:
		// unlink it from under the new top node (__panic.prev = __panic.prev.prev).
		this.pushInstruction({ op: "local.get", index: this.hasPanicLocalIndex });
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({ op: "ref.is_null" });
		this.pushInstruction({ op: "i32.eqz" });
		this.pushInstruction({ op: "i32.and" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifNestedPanic");
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 2, // prev
		});
		this.pushInstruction({ op: "ref.is_null" });
		this.pushInstruction({ op: "i32.eqz" });
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushControl("ifHasPrev");
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({ op: "global.get", index: panicGlobal });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({
			op: "struct.set",
			typeIndex: panicNodeTypeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction("end"); // ifHasPrev
		this.pushInstruction("end"); // ifNestedPanic
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: this.hasPanicLocalIndex });

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

	// True when the body reads or writes a field through a pointer.
	_needsNilBlock(node) {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) return node.some((n) => this._needsNilBlock(n));
		if (node.kind === "FuncLit") return false;
		if (node.kind === "SelectorExpr" && node.expr?._type?.kind === "pointer")
			return true;
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (this._needsNilBlock(node[key])) return true;
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
					// `for k, v := range x`: the range expression is a tuple.
					const rt = node.rhs?.[0]?._type;
					if (node.rhs?.[0]?.kind === "RangeExpr" && rt?.kind === "tuple")
						return rt.types?.[i] ?? null;
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

	_buildEnvFields(capturedNames) {
		const envFields = [];
		for (const name of capturedNames) {
			const isBoxed = this.mutatedCaptures.has(name);
			const goType = this._findCapturedVarGoType(name);
			const boxInfo = isBoxed ? this.mod.getBoxType(goType) : null;
			envFields.push({
				name,
				goType,
				isBoxed,
				boxInfo,
				wType: isBoxed
					? { kind: "ref", nullable: true, typeIndex: boxInfo.typeIndex }
					: this.toWasmType(goType),
			});
		}
		return envFields;
	}

	_unpackClosureEnv() {
		const envFields = this._buildEnvFields(this.capturedNames);
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
		if (t.kind === "struct" || t.kind === "StructType") {
			const rawFields = [];
			if (t.fields instanceof Map) {
				for (const [k, v] of t.fields.entries())
					rawFields.push({ name: k, goType: v });
			} else if (Array.isArray(t.fields)) {
				for (const f of t.fields) {
					const names = f.names ?? (f.name ? [f.name] : []);
					for (const n of names) rawFields.push({ name: n, goType: f.type });
				}
			}
			if (this.mod.getAnonStructType) {
				return this.mod.getAnonStructType(rawFields);
			}
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
			// A generic instance is registered under its specialised name
			// (`Inner$int`), which the field's type carries.
			const ft = structInfo.fields[embed.fieldIndex]?.goType;
			const instName = (ft?.kind === "PointerType" ? ft.base : ft)?.name;
			const embedInfo =
				(instName && this.mod.structTypes.get(instName)) ??
				this.mod.structTypes.get(embed.name);
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

	emitCloneStruct(structInfo, baseWType, dstInfo = structInfo) {
		const tmp = this.acquireTemp(baseWType);
		this.pushInstruction({ op: "local.set", index: tmp });
		for (let i = 0; i < structInfo.fields.length; i++) {
			this.pushInstruction({ op: "local.get", index: tmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: structInfo.typeIndex,
				fieldIndex: i,
			});
			// Array and value-struct fields are values: copy them with the struct.
			const f = structInfo.fields[i];
			if (!f.goType || f.goType.kind === "pointer") continue;
			if (isArrayType(f.goType, this.mod.checker)) {
				this.emitCopyArray(f.goType);
			} else if (
				isStructType(f.goType, this.mod.checker, this.mod) &&
				!isPointerToStruct(f.goType, this.mod.checker, this.mod)
			) {
				const inner = this._resolveStructInfo({ _type: f.goType });
				if (inner) this.emitCloneStruct(inner, f.wType);
			}
		}
		this.pushInstruction({
			op: "struct.new",
			typeIndex: dstInfo.typeIndex,
		});
		this.releaseTemp(tmp, baseWType);
	}

	// Copies the fixed-size array on top of the stack into a fresh array.
	// Elements that are themselves arrays or value structs are copied deeply.
	// A null source (an array slot that was never written, e.g. an element of
	// `make([][2]int, n)`) yields the zero array, so every copy is non-null.
	emitCopyArray(goType) {
		const elemType = this._getArrayElemType(goType);
		const arrInfo = this.mod.getArrayType(elemType);
		const arrWType = {
			kind: "ref",
			nullable: true,
			typeIndex: arrInfo.typeIndex,
		};
		const src = this.acquireTemp(arrWType);
		const dst = this.acquireTemp(arrWType);
		this.pushInstruction({ op: "local.tee", index: src });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: arrWType });
		this.emitZeroValue(goType, arrWType);
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: src });
		this.pushInstruction("array.len");
		this.pushInstruction({
			op: "array.new_default",
			typeIndex: arrInfo.typeIndex,
		});
		this.pushInstruction({ op: "local.set", index: dst });
		const elemIsArray =
			elemType?.kind !== "pointer" && isArrayType(elemType, this.mod.checker);
		const elemStruct =
			!elemIsArray &&
			isStructType(elemType, this.mod.checker, this.mod) &&
			!isPointerToStruct(elemType, this.mod.checker, this.mod)
				? (this._resolveStructInfo({ _type: elemType }) ??
					this.mod.getStructType(elemType?.name))
				: null;
		if (elemIsArray || elemStruct) {
			const i = this.acquireTemp("i32");
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: i });
			this.pushInstruction({ op: "block", blockType: "void" });
			this.pushInstruction({ op: "loop", blockType: "void" });
			this.pushInstruction({ op: "local.get", index: i });
			this.pushInstruction({ op: "local.get", index: dst });
			this.pushInstruction("array.len");
			this.pushInstruction("i32.ge_u");
			this.pushInstruction({ op: "br_if", depth: 1 });
			this.pushInstruction({ op: "local.get", index: dst });
			this.pushInstruction({ op: "local.get", index: i });
			this.pushInstruction({ op: "local.get", index: src });
			this.pushInstruction({ op: "local.get", index: i });
			this.pushInstruction({ op: "array.get", typeIndex: arrInfo.typeIndex });
			if (elemIsArray) this.emitCopyArray(elemType);
			else this.emitCloneStruct(elemStruct, arrInfo.elemWType);
			this.pushInstruction({ op: "array.set", typeIndex: arrInfo.typeIndex });
			this.pushInstruction({ op: "local.get", index: i });
			this.pushInstruction({ op: "i32.const", value: 1 });
			this.pushInstruction("i32.add");
			this.pushInstruction({ op: "local.set", index: i });
			this.pushInstruction({ op: "br", depth: 0 });
			this.pushInstruction("end");
			this.pushInstruction("end");
			this.releaseTemp(i, "i32");
		} else {
			this.pushInstruction({ op: "local.get", index: dst });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: src });
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.get", index: src });
			this.pushInstruction("array.len");
			this.pushInstruction({
				op: "array.copy",
				typeIndex: arrInfo.typeIndex,
			});
		}
		this.pushInstruction({ op: "local.get", index: dst });
		this.pushInstruction("end");
		this.releaseTemp(dst, arrWType);
		this.releaseTemp(src, arrWType);
	}

	// Go copies structs and arrays on assignment.  After `node` has been
	// emitted (value on the stack), copy it unless it is already a fresh
	// temporary (composite literal, call result, or a struct `*p` deref) or not
	// a value type at all.
	_emitCopyIfValue(node, goType, wType) {
		if (goType?.kind !== "pointer" && isArrayType(goType, this.mod.checker)) {
			if (node.kind === "CompositeLit" || node._freshArray) return;
			if (node.kind === "CallExpr" && !node._isTypeConversion) return;
			this.emitCopyArray(goType);
			return;
		}
		if (
			!isStructType(goType, this.mod.checker, this.mod) ||
			isPointerToStruct(goType, this.mod.checker, this.mod)
		)
			return;
		if (
			node.kind === "CompositeLit" ||
			node.kind === "CallExpr" ||
			(node.kind === "UnaryExpr" && node.op === "*")
		)
			return;
		const sInfo =
			this._resolveStructInfo(node) ?? this.mod.getStructType(goType?.name);
		if (sInfo) this.emitCloneStruct(sInfo, wType);
	}

	// Unpacks slice header fields (0 arr, 1 off, 2 len, 3 cap) from the slice
	// held in `sliceTmp` into the given temps; fields without a temp are skipped.
	_emitSliceUnpack(sliceTmp, sliceInfo, { arr, off, len, cap }) {
		const parts = [arr, off, len, cap];
		for (let fieldIndex = 0; fieldIndex < parts.length; fieldIndex++) {
			const tmp = parts[fieldIndex];
			if (tmp === undefined || tmp === null) continue;
			this.pushInstruction({ op: "local.get", index: sliceTmp });
			this.pushInstruction({
				op: "struct.get",
				typeIndex: sliceInfo.typeIndex,
				fieldIndex,
			});
			this.pushInstruction({ op: "local.set", index: tmp });
		}
	}

	_getReceiverTypeName(recvType, node = null) {
		if (recvType) {
			let t = recvType;
			while (t.kind === "pointer") t = t.base;
			if (t.kind === "SelectorExpr") {
				const pkg = t.expr?.name;
				if (pkg) return `${pkg}.${t.field}`;
			}
			if (t.kind === "simd")
				return t.simd === "Mask32x4" ? "simd.Mask32x4" : "simd.F32x4";
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
		if (node && node.kind === "SelectorExpr") {
			const pkg = node.expr?.name;
			if (pkg) return `${pkg}.${node.field}`;
		}
		return null;
	}

	// Concrete methods the dispatcher `fn` can call: same name, same signature.
	_dispatchCandidates(fn) {
		const candidates = this.mod.findInterfaceCandidates(
			fn._ifaceType,
			fn._methodName,
		);
		if (!Array.isArray(fn.params)) return candidates;
		const paramTypes = this.mod.getFuncParamTypes(fn.name);
		const results = this.mod.funcReturnTypesByIdx;
		const want = results.get(fn._globalFuncIndex);
		return candidates.filter((c) =>
			sameSignature(c, fn.params, paramTypes, want, results.get(c.funcIndex)),
		);
	}

	emitInterfaceDispatcher(fn) {
		let candidates = this._dispatchCandidates(fn);
		const recvLocal = 0; // __recv is local 0
		// Soft dispatchers (errors.Unwrap) return nil instead of panicking when
		// the receiver is nil or has no such method.
		const soft = Boolean(fn._softDispatch);
		if (soft) {
			// Only methods with the dispatcher's own result shape are callable
			// (e.g. `Unwrap() []error` is not an `Unwrap() error`).
			const want = this.mod.funcReturnTypesByIdx.get(fn._globalFuncIndex);
			const key = (ts) =>
				ts
					.map((t) => (typeof t === "object" ? JSON.stringify(t) : t))
					.join(",");
			candidates = candidates.filter((c) => {
				const got = this.mod.funcReturnTypesByIdx.get(c.funcIndex);
				return (
					got !== undefined && want !== undefined && key(got) === key(want)
				);
			});
		}
		const emitMiss = (msg) => {
			if (soft) {
				this.pushInstruction({ op: "ref.null", heapType: "any" });
				this.pushInstruction("return");
			} else {
				this.emitPanic(msg);
			}
		};

		// 1. Nil check
		this.pushInstruction({ op: "local.get", index: recvLocal });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		emitMiss(
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
						if (step.castTypeIndex) {
							this.pushInstruction({
								op: "ref.cast",
								typeIndex: step.castTypeIndex,
							});
						}
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

		emitMiss("interface conversion: nil or unmatched type for method call");
	}

	_getArraySize(t, defaultSize = 0) {
		if (!t) return defaultSize;
		if (typeof t.size === "number") return t.size;
		if (t.size?.value !== undefined) return Number(t.size.value);
		if (typeof t.len === "number") return t.len;
		if (t.len?.value !== undefined) return Number(t.len.value);
		if (t.underlying) return this._getArraySize(t.underlying, defaultSize);
		if (t.name && this.mod.checker?.types?.has(t.name)) {
			const resolved = this.mod.checker.types.get(t.name);
			if (resolved !== t) return this._getArraySize(resolved, defaultSize);
		}
		return defaultSize;
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

	emitZeroValue(goType, wType) {
		if (wType === "i32") {
			this.pushInstruction({ op: "i32.const", value: 0 });
		} else if (wType === "i64") {
			this.pushInstruction({ op: "i64.const", value: 0n });
		} else if (wType === "f32") {
			this.pushInstruction({ op: "f32.const", value: 0.0 });
		} else if (wType === "f64") {
			this.pushInstruction({ op: "f64.const", value: 0.0 });
		} else if (wType === "v128") {
			this.pushInstruction({ op: "v128.const", bytes: new Array(16).fill(0) });
		} else if (
			typeof wType === "object" &&
			wType !== null &&
			wType.kind === "ref"
		) {
			if (
				(goType && isComplex(goType)) ||
				wType.typeName === "$complex64" ||
				wType.typeName === "$complex128"
			) {
				const is64 = isComplex64(goType) || wType.typeName === "$complex64";
				const info = this.mod.getComplexType(is64 ? "complex64" : "complex128");
				this.pushInstruction({ op: `${info.elemWType}.const`, value: 0.0 });
				this.pushInstruction({ op: `${info.elemWType}.const`, value: 0.0 });
				this.pushInstruction({
					op: "struct.new",
					typeIndex: info.typeIndex,
					typeName: info.name,
				});
				return;
			}
			if (
				goType &&
				goType.kind !== "pointer" &&
				isStructType(goType, this.mod.checker)
			) {
				const sName =
					goType.name ?? (goType.kind === "named" ? goType.name : null);
				// An anonymous struct type has no name to look up.
				const structInfo =
					this.mod.getStructType(sName) ??
					this._resolveStructInfo({ _type: goType });
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
				const elemType = this._getArrayElemType(goType);
				const arrInfo = this.mod.getArrayType(elemType);
				const size = this._getArraySize(goType);
				if (
					isStructType(elemType, this.mod.checker, this.mod) ||
					isComplex(elemType) ||
					(elemType?.kind !== "pointer" &&
						isArrayType(elemType, this.mod.checker))
				) {
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

	// Depth of the index-check block for i32 or i64 indexes, or null.
	resolveBranchDepthToOob(width = 64) {
		return this.resolveBranchDepthToRole(width === 32 ? "oob32" : "oob64");
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

	// Go scopes: a block, `if`, `for` and `switch` (with their init
	// statements) end the names they declare, so an inner `x := 5` does not
	// rebind the outer `x` for the code after it.
	emitStmt(stmt) {
		if (!stmt) return;
		if (!SCOPED_STMTS.has(stmt.kind)) {
			this._emitStmtKind(stmt);
			return;
		}
		const saved = new Map(this.locals);
		try {
			this._emitStmtKind(stmt);
		} finally {
			this.locals = saved;
		}
	}

	_emitStmtKind(stmt) {
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

	_isPkgExpr(expr, pkgName) {
		if (expr.expr?.kind !== "Ident") return false;
		const name = expr.expr.name;
		if (pkgName !== undefined && name !== pkgName) return false;
		return !this.resolveLocal(name) && !this.mod.resolveGlobal(name);
	}
}

export function copyMethods(target, source) {
	const descriptors = Object.getOwnPropertyDescriptors(source.prototype);
	delete descriptors.constructor;
	for (const key of Object.keys(descriptors)) {
		if (key in target.prototype) {
			throw new Error(
				`Duplicate method "${key}" found while mixing ${source.name} into ${target.name}`,
			);
		}
	}
	Object.defineProperties(target.prototype, descriptors);
}

copyMethods(FunctionEmitter, MapsEmitter);
copyMethods(FunctionEmitter, StmtsEmitter);
copyMethods(FunctionEmitter, ExprsEmitter);
copyMethods(FunctionEmitter, BuiltinsEmitter);
for (const emitter of stdlibEmitters) copyMethods(FunctionEmitter, emitter);
copyMethods(FunctionEmitter, SharedEmitter);
