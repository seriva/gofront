// src/backend/wasm/index.js
// WASM Backend compiler entry point: lowered AST + types -> Module IR -> binary / WAT.

import { lower, lowerFunction } from "../../lower/index.js";
import {
	getOrCreateIteratorFuncLit,
	isIteratorRangeFor,
} from "../../lower/range.js";
import { ERROR } from "../../typechecker/types.js";
import {
	addBoundaryHelpers,
	collectBoundaryMeta,
	generateFacade,
	scanBoundaryImports,
} from "./boundary.js";
import { FunctionEmitter } from "./emit.js";
import { encodeModule, isGoFrontWasm } from "./encode.js";
import {
	_collectPackageConsts,
	_collectPackageGlobals,
	_makeGlobalInitFunc,
	_makeInterfaceDispatcher,
} from "./globals.js";
import { desugarMethodExprs } from "./method-expr.js";
import { ModuleEmitter } from "./module-emitter.js";
import { hasGenerics, monomorphise } from "./monomorph.js";
import { emitWasmIntrinsic, prepareWasmIntrinsic } from "./natives.js";
import { hasNativeWasmOpt, optimizeWasm } from "./optimize.js";
import {
	_scanFuncSigInterfaces,
	_scanImportsInBody,
	_scanInterfaceCallNodes,
	_scanInterfaceTypeDecls,
	_someNode,
	_usesAnyEq,
} from "./prescan.js";
import { pruneUnusedFuncs } from "./prune-funcs.js";
import {
	ERROR_STRUCT,
	getMapKeyValTypes,
	isInterfaceType,
	isMapType,
	toWasmType,
} from "./types.js";
import { desugarVariadics } from "./variadic.js";
import { emitWat } from "./wat.js";

export { hasNativeWasmOpt, isGoFrontWasm, optimizeWasm };

// Body of `__index_panic(i i64, n i32, unsigned i32)`: builds Go's message
// with the string imports and raises it like any other runtime panic.  A
// nonzero `unsigned` prints the index as an unsigned 64-bit number.
function emitIndexPanicBody(mod, emitter) {
	const str = (text) => {
		emitter.pushInstruction({ op: "i32.const", value: mod.internString(text) });
		emitter.pushInstruction({
			op: "call",
			funcIndex: mod.getStringImportIndex(),
		});
	};
	const concat = () =>
		emitter.pushInstruction({
			op: "call",
			funcIndex: mod.getStringConcatImportIndex(),
		});
	str("runtime error: index out of range [");
	emitter.pushInstruction({ op: "local.get", index: 0 });
	emitter.pushInstruction({ op: "local.get", index: 2 });
	emitter.pushInstruction({
		op: "call",
		funcIndex: mod.getFmtIntFuncIndex(),
	});
	concat();
	emitter.pushInstruction({ op: "local.get", index: 0 });
	emitter.pushInstruction({ op: "i64.const", value: 0n });
	emitter.pushInstruction("i64.lt_s");
	emitter.pushInstruction({ op: "local.get", index: 2 });
	emitter.pushInstruction("i32.eqz");
	emitter.pushInstruction("i32.and");
	emitter.pushInstruction({ op: "if", blockType: "externref" });
	str("]");
	emitter.pushInstruction("else");
	str("] with length ");
	emitter.pushInstruction({ op: "local.get", index: 1 });
	emitter.pushInstruction({
		op: "call",
		funcIndex: mod.getStrFromI32ImportIndex(),
	});
	concat();
	emitter.pushInstruction("end");
	concat();
	emitter.emitRuntimePanicThrow();
}

// Body of `__narrow_bound(v i64) i32`: `v` as an i32 when it is in
// 0..2^31-1, else a value no size or bounds check accepts (the i32 minimum
// for a negative `v`, an unsigned one at or above 2^63 included, the maximum
// otherwise).
function emitNarrowBoundBody(emitter) {
	const emit = (ins) => emitter.pushInstruction(ins);
	emit({ op: "local.get", index: 0 });
	emit({ op: "i64.const", value: 31n });
	emit("i64.shr_u");
	emit("i64.eqz");
	emit({ op: "if", blockType: "i32" });
	emit({ op: "local.get", index: 0 });
	emit("i32.wrap_i64");
	emit("else");
	// The sign of `v` spread over the word, flipped, is the minimum or maximum.
	emit({ op: "local.get", index: 0 });
	emit({ op: "i64.const", value: 63n });
	emit("i64.shr_s");
	emit("i32.wrap_i64");
	emit({ op: "i32.const", value: 0x7fffffff });
	emit("i32.xor");
	emit("end");
	emit("return");
}

// Body of `__fmt_int(n i64, unsigned i32) string`: `n` as decimal text, the
// unsigned 64-bit value when `unsigned` is nonzero.
function emitFmtIntBody(mod, emitter) {
	const emit = (ins) => emitter.pushInstruction(ins);
	emit({ op: "local.get", index: 1 });
	emit({ op: "if", blockType: "externref" });
	emit({ op: "local.get", index: 0 });
	emit({ op: "call", funcIndex: mod.getStrFromU64ImportIndex() });
	emit("else");
	emit({ op: "local.get", index: 0 });
	emit({ op: "call", funcIndex: mod.getStrFromI64ImportIndex() });
	emit("end");
	emit("return");
}

// Body of `__slice_bounds_panic(lo, hi, max i64, cap, form i32)`: Go's
// `slice bounds out of range` text for the first failing bound, checked in
// Go's order (max, then hi, then lo; hi, then lo for a two-index slice).
// `form` bit 0 is a three-index slice, bit 1 words the limit as a length, and
// bits 2, 3 and 4 say `lo`, `hi` and `max` print as unsigned 64-bit numbers.
function emitSliceBoundsPanicBody(mod, emitter) {
	const LO = 0;
	const HI = 1;
	const MAX = 2;
	const CAP = 3;
	const FORM = 4;
	const UNSIGNED_BIT = { [LO]: 4, [HI]: 8, [MAX]: 16 };
	const emit = (ins) => emitter.pushInstruction(ins);
	const str = (text) => {
		emit({ op: "i32.const", value: mod.internString(text) });
		emit({ op: "call", funcIndex: mod.getStringImportIndex() });
	};
	const concat = () =>
		emit({ op: "call", funcIndex: mod.getStringConcatImportIndex() });
	// Pushes nonzero when `index` prints as unsigned.
	const unsigned = (index) => {
		emit({ op: "local.get", index: FORM });
		emit({ op: "i32.const", value: UNSIGNED_BIT[index] });
		emit("i32.and");
	};
	// The three bounds as text, in the locals `num` reads back.
	const text = [LO, HI, MAX].map(() => emitter.allocLocal(null, "externref"));
	for (const index of [LO, HI, MAX]) {
		emit({ op: "local.get", index });
		unsigned(index);
		emit({ op: "call", funcIndex: mod.getFmtIntFuncIndex() });
		emit({ op: "local.set", index: text[index] });
	}
	const num = (index) => emit({ op: "local.get", index: text[index] });
	// `with length n` or `with capacity n`, by the form's wording bit.
	const limit = () => {
		emit({ op: "local.get", index: FORM });
		emit({ op: "i32.const", value: 2 });
		emit("i32.and");
		emit({ op: "if", blockType: "externref" });
		str(" with length ");
		emit("else");
		str(" with capacity ");
		emit("end");
		emit({ op: "local.get", index: CAP });
		emit({ op: "call", funcIndex: mod.getStrFromI32ImportIndex() });
		concat();
	};
	// Pushes the message built from `parts` (strings, local indexes of the
	// i64 parameters, or `limit`) and raises it.
	const fail = (...parts) => {
		str("runtime error: slice bounds out of range ");
		for (const part of parts) {
			if (typeof part === "string") str(part);
			else if (typeof part === "number") num(part);
			else part();
			concat();
		}
		emitter.emitRuntimePanicThrow();
	};
	const negative = (index) => {
		emit({ op: "local.get", index });
		emit({ op: "i64.const", value: 0n });
		emit("i64.lt_s");
		unsigned(index);
		emit("i32.eqz");
		emit("i32.and");
	};
	// `index` is outside 0..bound, `bound` being a local or the capacity.
	const outside = (index, bound) => {
		emit({ op: "local.get", index });
		if (bound === CAP) {
			emit({ op: "local.get", index: CAP });
			emit("i64.extend_i32_u");
		} else {
			emit({ op: "local.get", index: bound });
		}
		emit("i64.gt_u");
	};
	const when = (cond, then, otherwise) => {
		cond();
		emit({ op: "if", blockType: "void" });
		then();
		if (otherwise) {
			emit("else");
			otherwise();
		}
		emit("end");
	};
	const bad = (index, bound, negParts, parts) =>
		when(
			() => outside(index, bound),
			() =>
				when(
					() => negative(index),
					() => fail(...negParts),
					() => fail(...parts),
				),
		);

	when(
		() => {
			emit({ op: "local.get", index: FORM });
			emit({ op: "i32.const", value: 1 });
			emit("i32.and");
		},
		() => {
			bad(MAX, CAP, ["[::", MAX, "]"], ["[::", MAX, "]", limit]);
			bad(HI, MAX, ["[:", HI, ":]"], ["[:", HI, ":", MAX, "]"]);
			when(
				() => negative(LO),
				() => fail("[", LO, "::]"),
				() => fail("[", LO, ":", HI, ":]"),
			);
		},
		() => {
			bad(HI, CAP, ["[:", HI, "]"], ["[:", HI, "]", limit]);
			when(
				() => negative(LO),
				() => fail("[", LO, ":]"),
				() => fail("[", LO, ":", HI, "]"),
			);
		},
	);
	emit("unreachable");
}

function peepholeOptimize(instructions) {
	let changed = true;
	let current = instructions;
	while (changed) {
		changed = false;
		const next = [];
		for (let i = 0; i < current.length; i++) {
			const c = current[i];
			const n = current[i + 1];

			// Pattern 1: local.get X; local.set X -> nothing
			if (
				c?.op === "local.get" &&
				n?.op === "local.set" &&
				c.index === n.index
			) {
				changed = true;
				i++; // skip both
				continue;
			}

			// Pattern 2: local.set X; local.get X -> local.tee X
			if (
				c?.op === "local.set" &&
				n?.op === "local.get" &&
				c.index === n.index
			) {
				changed = true;
				next.push({ op: "local.tee", index: c.index });
				i++; // skip n (local.get)
				continue;
			}

			// Pattern 3: local.tee X; local.set X -> local.set X
			if (
				c?.op === "local.tee" &&
				n?.op === "local.set" &&
				c.index === n.index
			) {
				changed = true;
				next.push({ op: "local.set", index: c.index });
				i++;
				continue;
			}

			// Pattern 4: local.tee X; drop -> local.set X
			if (c?.op === "local.tee" && (n === "drop" || n?.op === "drop")) {
				changed = true;
				next.push({ op: "local.set", index: c.index });
				i++;
				continue;
			}

			next.push(c);
		}
		current = next;
	}
	return current;
}

export function compileWasmModule(
	programs,
	checker,
	lowerResult = null,
	options = {},
) {
	let progs = Array.isArray(programs) ? programs : [programs];
	let resolvedChecker = checker;
	let resolvedLowerResult = lowerResult;

	if (hasGenerics(progs)) {
		const mono = monomorphise(progs, checker);
		progs = mono.programs;
		resolvedChecker = mono.checker;
		resolvedLowerResult = null;
	}
	// Variadic parameters become slices (after monomorphisation: concrete types).
	// Method expressions become method calls or forwarding func literals,
	// before variadics so a variadic method's forwarder packs its arguments.
	const methodExprs = desugarMethodExprs(progs, options.bundledPackages);
	if (desugarVariadics(progs) || methodExprs || !resolvedLowerResult) {
		resolvedLowerResult = lower(progs, resolvedChecker);
	}
	checker = resolvedChecker;
	lowerResult = resolvedLowerResult;

	const mod = new ModuleEmitter(resolvedChecker, resolvedLowerResult, progs, {
		bundledPackages: options.bundledPackages,
		natives: options.natives,
	});

	// 1. Collect all functions, methods, and package-level globals
	const funcDecls = [];
	let initCount = 0;
	const initNames = [];
	for (const p of progs) {
		const pkgName = p.pkg?.name ?? "main";
		const pkgTarget = p.target ?? "wasm";
		for (const d of p.decls ?? []) {
			if (d.kind === "FuncDecl") {
				d._pkgName = pkgName;
				d._pkgTarget = pkgTarget;
				d._srcFile = p._path ?? p._filename ?? null;
				if (d.name === "init" || d.name.startsWith("init$")) {
					const renamed = initCount === 0 ? "init" : `init$${initCount}`;
					d.name = renamed;
					initNames.push(renamed);
					initCount++;
				}
				funcDecls.push(d);
			} else if (d.kind === "MethodDecl") {
				const recvTypeName =
					d.recvType?.name ??
					(d.recvType?.kind === "TypeName" ? d.recvType.name : "Recv");
				const recvGoType = d.recvPointer
					? { kind: "pointer", base: { kind: "named", name: recvTypeName } }
					: { kind: "named", name: recvTypeName };
				const normFn = {
					kind: "FuncDecl",
					name: `${recvTypeName}.${d.name}`,
					params: [{ name: d.recvName, type: recvGoType }, ...(d.params ?? [])],
					returnType: d.returnType,
					body: d.body,
					_isMethod: true,
					_recvTypeName: recvTypeName,
					_methodName: d.name,
					_exportName: `${recvTypeName}_${d.name}`,
					_sourceDecl: d,
					_pkgName: pkgName,
					_pkgTarget: pkgTarget,
					_srcFile: p._path ?? p._filename ?? null,
					_line: d._line,
				};
				funcDecls.push(normFn);
			}
		}
	}

	// 1b. Scan and lift all closures (FuncLits)
	let closureCounter = 0;
	const closures = [];

	function scanClosures(node, rootFn) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) scanClosures(item, rootFn);
			return;
		}
		if (isIteratorRangeFor(node)) {
			const yieldFuncLit = getOrCreateIteratorFuncLit(node);
			scanClosures(yieldFuncLit, rootFn);
			// A func literal ranged over directly is a closure of its own.
			scanClosures(node.cond?.expr ?? node.init?.rhs?.[0]?.expr, rootFn);
			return;
		}
		if (node.kind === "FuncLit") {
			closureCounter++;
			const closureName = `_closure$${closureCounter}`;
			node._liftedName = closureName;
			node._rootFuncDecl = rootFn;

			const liftedFn = {
				kind: "FuncDecl",
				name: closureName,
				params: [
					{ name: "__env", type: { kind: "basic", name: "any" } },
					...(node.params ?? []),
				],
				returnType: node.returnType,
				body: node.body,
				_isClosure: true,
				_isYieldClosure: Boolean(node._isYieldClosure),
				_iterStateName: node._iterStateName ?? null,
				_forStmt: node._forStmt ?? null,
				_funcLit: node,
				_rootFuncDecl: rootFn,
				_srcFile: rootFn?._srcFile ?? null,
				_line: typeof node._line === "number" ? node._line : rootFn?._line,
			};
			node._liftedFn = liftedFn;
			closures.push(liftedFn);

			scanClosures(node.body, rootFn);
			return;
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			scanClosures(node[key], rootFn);
		}
	}

	for (const fn of funcDecls) {
		fn._rootFuncDecl = fn;
		if (fn.body) {
			scanClosures(fn.body, fn);
		}
	}
	funcDecls.push(...closures);

	// 1c. Add trampolines for named functions (for when they are passed as function values)
	const topLevelFuncs = new Map();
	for (const fn of funcDecls) {
		if (
			!fn._isClosure &&
			!fn._isMethod &&
			fn.name !== "main" &&
			!fn.name.startsWith("_")
		) {
			topLevelFuncs.set(fn.name, fn);
		}
	}
	mod.topLevelFuncMap = topLevelFuncs;

	const trampolines = [];
	for (const [name, targetFn] of topLevelFuncs.entries()) {
		const trampName = `_tramp$${name}`;
		const callExpr = {
			kind: "CallExpr",
			func: { kind: "Ident", name: targetFn.name },
			args: (targetFn.params ?? []).map((p) => ({
				kind: "Ident",
				name: p.name,
				_type: p.type,
			})),
			_type: targetFn.returnType ?? { kind: "basic", name: "void" },
		};
		const bodyStmts = targetFn.returnType
			? [
					{
						kind: "ReturnStmt",
						values: [callExpr],
					},
				]
			: [
					{ kind: "ExprStmt", expr: callExpr },
					{ kind: "ReturnStmt", values: [] },
				];

		const trampFn = {
			kind: "FuncDecl",
			name: trampName,
			params: [
				{ name: "__env", type: { kind: "basic", name: "any" } },
				...(targetFn.params ?? []),
			],
			returnType: targetFn.returnType,
			body: {
				kind: "Block",
				stmts: bodyStmts,
				list: bodyStmts,
			},
			_isClosure: true,
			_isTrampoline: true,
			_targetFuncName: name,
			_rootFuncDecl: targetFn,
		};
		trampolines.push(trampFn);
	}
	funcDecls.push(...trampolines);

	_collectPackageConsts(progs, mod, checker);
	if (checker?.errors?.length > 0) {
		if (options.boundary) {
			throw new Error(checker.errors.map((e) => e.message).join("\n"));
		}
		return {
			wasm: null,
			facade: null,
			stringTable: null,
			errors: checker.errors,
		};
	}
	const pendingInits = _collectPackageGlobals(progs, mod, checker);
	const globalInitFn =
		pendingInits.length > 0 || initNames.length > 0
			? _makeGlobalInitFunc(pendingInits, initNames)
			: null;
	if (globalInitFn) {
		// Func literals in package-level initializers are lifted like any other.
		globalInitFn._rootFuncDecl = globalInitFn;
		// Captured variables of those literals need the same analysis.
		lowerFunction(lowerResult, globalInitFn);
		const before = closures.length;
		scanClosures(globalInitFn.body, globalInitFn);
		funcDecls.push(globalInitFn, ...closures.slice(before));
	}

	const boundsPanicFn = {
		kind: "FuncDecl",
		name: "__bounds_panic",
		params: [],
		returnType: null,
		_isRuntimePanic: true,
		_panicMsg: "runtime error: index out of range",
	};
	funcDecls.push(boundsPanicFn);

	// Go's index panic: `index out of range [i] with length n`, or
	// `index out of range [i]` for a negative index; `unsigned` prints `i`
	// as an unsigned 64-bit number.
	funcDecls.push({
		kind: "FuncDecl",
		name: "__index_panic",
		params: [
			{ name: "i", type: { kind: "basic", name: "int64" } },
			{ name: "n", type: { kind: "basic", name: "int32" } },
			{ name: "unsigned", type: { kind: "basic", name: "int32" } },
		],
		returnType: null,
		_isIndexPanic: true,
	});

	// Target of the per-function `nil` block (`_openNilBlock` in emit.js).
	funcDecls.push({
		kind: "FuncDecl",
		name: "__nil_panic",
		params: [],
		returnType: null,
		_isRuntimePanic: true,
		_panicMsg:
			"runtime error: invalid memory address or nil pointer dereference",
	});

	// An i64 as decimal text, signed or unsigned, for the panic messages.
	funcDecls.push({
		kind: "FuncDecl",
		name: "__fmt_int",
		params: [
			{ name: "n", type: { kind: "basic", name: "int64" } },
			{ name: "unsigned", type: { kind: "basic", name: "int32" } },
		],
		returnType: { kind: "basic", name: "string" },
		_isFmtInt: true,
	});

	// An i64 size or bound narrowed to the i32 the runtime indexes with.
	funcDecls.push({
		kind: "FuncDecl",
		name: "__narrow_bound",
		params: [{ name: "v", type: { kind: "basic", name: "int64" } }],
		returnType: { kind: "basic", name: "int32" },
		_isNarrowBound: true,
	});

	// Go's slice-bounds panic from the failing bounds (`lo`, `hi`, `max` as
	// signed values), the capacity (the length of an array or string) and
	// `form`: bit 0 = three-index slice, bit 1 = limit worded as a length,
	// bits 2-4 = `lo`, `hi`, `max` print unsigned.
	funcDecls.push({
		kind: "FuncDecl",
		name: "__slice_bounds_panic",
		params: [
			{ name: "lo", type: { kind: "basic", name: "int64" } },
			{ name: "hi", type: { kind: "basic", name: "int64" } },
			{ name: "max", type: { kind: "basic", name: "int64" } },
			{ name: "cap", type: { kind: "basic", name: "int32" } },
			{ name: "form", type: { kind: "basic", name: "int32" } },
		],
		returnType: null,
		_isSliceBoundsPanic: true,
	});

	const pushPanicFn = {
		kind: "FuncDecl",
		name: "__push_panic",
		params: [{ name: "msg", type: { kind: "basic", name: "string" } }],
		returnType: null,
		_isPushPanic: true,
	};
	funcDecls.push(pushPanicFn);

	// 1d. Interface dispatchers
	_collectInterfaceDispatchers(progs, funcDecls, mod, checker);

	// 1e. Map helpers
	function scanMapTypes(node) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) scanMapTypes(item);
			return;
		}
		if (node._type && isMapType(node._type, checker)) {
			const { keyType, valType } = getMapKeyValTypes(node._type, checker);
			if (keyType && valType) {
				mod.getMapType(keyType, valType);
			}
		}
		if (node.kind === "MapType") {
			const keyGoType = node.key;
			const valGoType = node.value ?? node.elem;
			if (keyGoType && valGoType) {
				mod.getMapType(keyGoType, valGoType);
			}
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			scanMapTypes(node[key]);
		}
	}

	for (const fn of funcDecls) {
		if (fn.params) scanMapTypes(fn.params);
		if (fn.returnType) scanMapTypes(fn.returnType);
		if (fn.body) scanMapTypes(fn.body);
	}
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			scanMapTypes(d);
		}
	}

	for (const mapInfo of mod.mapTypes.values()) {
		// make
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.makeFuncName,
			params: [{ name: "cap", type: { kind: "basic", name: "int32" } }],
			returnType: mapInfo.wType,
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "make",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// get
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.getFuncName,
			params: [
				{ name: "m", type: mapInfo.wType },
				{ name: "k", type: mapInfo.keyGoType },
			],
			returnType: mapInfo.valGoType,
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "get",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// get_ok
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.getOkFuncName,
			params: [
				{ name: "m", type: mapInfo.wType },
				{ name: "k", type: mapInfo.keyGoType },
			],
			returnType: {
				kind: "tuple",
				types: [mapInfo.valGoType, { kind: "basic", name: "bool" }],
			},
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "get_ok",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// set
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.setFuncName,
			params: [
				{ name: "m", type: mapInfo.wType },
				{ name: "k", type: mapInfo.keyGoType },
				{ name: "v", type: mapInfo.valGoType },
			],
			returnType: null,
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "set",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// delete
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.deleteFuncName,
			params: [
				{ name: "m", type: mapInfo.wType },
				{ name: "k", type: mapInfo.keyGoType },
			],
			returnType: null,
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "delete",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// len
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.lenFuncName,
			params: [{ name: "m", type: mapInfo.wType }],
			returnType: { kind: "basic", name: "int32" },
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "len",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// clear
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.clearFuncName,
			params: [{ name: "m", type: mapInfo.wType }],
			returnType: null,
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "clear",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// keys
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.keysFuncName,
			params: [{ name: "m", type: mapInfo.wType }],
			returnType: { kind: "slice", elem: mapInfo.keyGoType },
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "keys",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
		// values
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.valuesFuncName,
			params: [{ name: "m", type: mapInfo.wType }],
			returnType: { kind: "slice", elem: mapInfo.valGoType },
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "values",
			_mapInfo: mapInfo,
			_rootFuncDecl: null,
		});
	}

	// 1e2. `gofront/shared` linear-memory helpers (only when imported).
	const usesShared = progs.some((p) =>
		(p.imports ?? []).some((decl) =>
			(decl.imports ?? [decl]).some((imp) => imp.path === "gofront/shared"),
		),
	);
	if (usesShared) {
		const sharedWType = mod.getSharedType().wType;
		const i32 = { kind: "basic", name: "int32" };
		funcDecls.push({
			kind: "FuncDecl",
			name: "__shared_len_panic",
			params: [],
			returnType: null,
			_isRuntimePanic: true,
			_panicMsg: "runtime error: shared buffer length out of range",
		});
		funcDecls.push({
			kind: "FuncDecl",
			name: "__shared_new",
			params: [
				{ name: "len", type: i32 },
				{ name: "bytes", type: i32 },
			],
			returnType: sharedWType,
			body: { kind: "Block", stmts: [], list: [] },
			_isSharedHelper: "new",
			_rootFuncDecl: null,
		});
		funcDecls.push({
			kind: "FuncDecl",
			name: "__shared_sub",
			params: [
				{ name: "buf", type: sharedWType },
				{ name: "lo", type: i32 },
				{ name: "hi", type: i32 },
				{ name: "bytes", type: i32 },
			],
			returnType: sharedWType,
			body: { kind: "Block", stmts: [], list: [] },
			_isSharedHelper: "sub",
			_rootFuncDecl: null,
		});
	}

	// 1e3. Runtime helpers: error values and interface equality.
	mod.usesAnyEq = _usesAnyEq(funcDecls, mod);
	const ANY_T = { kind: "basic", name: "any" };
	const STR_T = { kind: "basic", name: "string" };
	const BOOL_T = { kind: "basic", name: "bool" };
	const helper = (name, params, returnType, kind, extra = {}) => ({
		kind: "FuncDecl",
		name,
		params,
		returnType,
		body: { kind: "Block", stmts: [], list: [] },
		_isRuntimeHelper: kind,
		_rootFuncDecl: null,
		...extra,
	});
	if (mod.usesAnyEq) {
		funcDecls.push(
			helper(
				"__any_eq",
				[
					{ name: "a", type: ANY_T },
					{ name: "b", type: ANY_T },
				],
				BOOL_T,
				"any_eq",
			),
		);
	}
	// `x.(T)` outside comma-ok form panics with the dynamic type's name.
	mod.usesTypeAssertFail = funcDecls.some((fn) =>
		_someNode(fn.body, (n) => n.kind === "TypeAssertExpr" && !n._commaOk),
	);
	if (mod.usesTypeAssertFail) {
		funcDecls.push(
			helper(
				"__ta_fail",
				[
					{ name: "v", type: ANY_T },
					{ name: "src", type: STR_T },
					{ name: "target", type: STR_T },
					{ name: "iface", type: BOOL_T },
				],
				null,
				"ta_fail",
			),
		);
	}
	mod.usesAnyHash = false;
	for (const info of mod.mapTypes.values()) {
		if (isInterfaceType(info.keyGoType, checker)) {
			mod.usesAnyHash = true;
			break;
		}
	}
	if (mod.usesAnyHash) {
		funcDecls.push(
			helper(
				"__any_hash",
				[{ name: "a", type: ANY_T }],
				{ kind: "basic", name: "int32" },
				"any_hash",
			),
		);
	}
	// fmt's %p identity of a reference in an `any`: a defined map or func type
	// is boxed there, so the helper hands the host the boxed reference.
	if (funcDecls.some((fn) => fn.intrinsic === "fmt_ptr_id")) {
		funcDecls.push(
			helper("__any_ref", [{ name: "a", type: ANY_T }], ANY_T, "any_ref"),
		);
	}
	if (mod.hasErrorType) {
		const errPtr = {
			kind: "pointer",
			base: { kind: "named", name: ERROR_STRUCT },
		};
		funcDecls.push(
			helper(
				`${ERROR_STRUCT}.Error`,
				[{ name: "e", type: errPtr }],
				STR_T,
				"error_msg",
				{
					_isMethod: true,
					_recvTypeName: ERROR_STRUCT,
					_methodName: "Error",
				},
			),
			helper("__mk_error", [{ name: "msg", type: STR_T }], ANY_T, "mk_error"),
			helper("__error_str", [{ name: "e", type: ANY_T }], STR_T, "error_str"),
		);
	}

	// 1f. Boundary metadata (exported surface of wasm packages)
	const boundaryMeta = options.boundary
		? collectBoundaryMeta(progs, funcDecls, mod)
		: null;

	// 2. Pre-scan for needed imports so import func indices are fixed
	for (const fn of funcDecls) {
		if (fn.intrinsic) prepareWasmIntrinsic(mod, fn);
		_scanImportsInBody(fn.body, mod);
	}
	if (boundaryMeta) scanBoundaryImports(mod, boundaryMeta);

	const importFuncCount = mod.imports.filter((i) => i.kind === "func").length;
	mod._importsLocked = true;

	// 3. Register all internal functions and their type signatures
	for (let i = 0; i < funcDecls.length; i++) {
		const fn = funcDecls[i];
		const globalIdx = importFuncCount + i;
		mod.funcMap.set(fn.name, globalIdx);
		if (fn._isClosure) {
			if (fn._funcLit) {
				fn._funcLit._globalFuncIndex = globalIdx;
			}
			mod.addRefFuncElement(globalIdx);
		}

		const paramTypes = (fn.params ?? []).map((p) =>
			toWasmType(p.type, checker, mod),
		);
		mod.funcParamTypes.set(fn.name, paramTypes);
		mod.funcParamGoTypes.set(
			fn.name,
			(fn.params ?? []).map((p) => p.type),
		);
		const returnTypes = [];
		if (fn.returnType) {
			if (
				fn.returnType.kind === "TupleType" ||
				fn.returnType.kind === "tuple"
			) {
				for (const t of fn.returnType.types) {
					const wt = toWasmType(t, checker, mod);
					if (wt) returnTypes.push(wt);
				}
			} else {
				const wt = toWasmType(fn.returnType, checker, mod);
				if (wt) returnTypes.push(wt);
			}
		}

		const typeIndex = mod.getTypeIndex(paramTypes, returnTypes);
		fn._typeIndex = typeIndex;
		fn._globalFuncIndex = globalIdx;
		mod.funcReturnTypesByIdx.set(globalIdx, returnTypes);

		// Export if public (capitalized) or main
		if (
			fn._forceExport ||
			(!fn._isGlobalInit &&
				!fn._isRuntimeHelper &&
				!fn._isMapHelper &&
				!fn._isInterfaceDispatcher &&
				!fn._isSharedHelper &&
				!fn._isRuntimePanic &&
				!fn._isIndexPanic &&
				!fn._isSliceBoundsPanic &&
				!fn._isNarrowBound &&
				!fn._isFmtInt &&
				(options.exportAll ||
					fn.name === "main" ||
					(fn.name[0] >= "A" && fn.name[0] <= "Z") ||
					(fn._isMethod &&
						fn._methodName[0] >= "A" &&
						fn._methodName[0] <= "Z")))
		) {
			mod.exports.push({ name: fn.name, kind: "func", index: globalIdx });
			if (fn._isMethod && fn._exportName) {
				mod.exports.push({
					name: fn._exportName,
					kind: "func",
					index: globalIdx,
				});
			}
		}
		if (
			fn._isPushPanic &&
			!mod.exports.some((e) => e.name === "__push_panic")
		) {
			mod.exports.push({
				name: "__push_panic",
				kind: "func",
				index: globalIdx,
			});
		}
	}

	// 4. Emit function bodies
	for (const fn of funcDecls) {
		const emitter = new FunctionEmitter(mod, fn, fn._globalFuncIndex);
		if (fn._isIndexPanic) {
			emitIndexPanicBody(mod, emitter);
		} else if (fn._isSliceBoundsPanic) {
			emitSliceBoundsPanicBody(mod, emitter);
		} else if (fn._isNarrowBound) {
			emitNarrowBoundBody(emitter);
		} else if (fn._isFmtInt) {
			emitFmtIntBody(mod, emitter);
		} else if (fn._isRuntimePanic) {
			const strIdx = mod.internString(fn._panicMsg);
			const funcIdx = mod.getStringImportIndex();
			emitter.pushInstruction({ op: "i32.const", value: strIdx });
			emitter.pushInstruction({ op: "call", funcIndex: funcIdx });
			emitter.emitRuntimePanicThrow();
		} else if (fn._isPushPanic) {
			const panicNodeTypeIndex = mod.getPanicNodeTypeIndex();
			const panicGlobal = mod.getPanicGlobalIndex();
			emitter.pushInstruction({ op: "local.get", index: 0 });
			emitter.pushInstruction("any.convert_extern");
			emitter.pushInstruction({ op: "i32.const", value: 0 });
			emitter.pushInstruction({ op: "global.get", index: panicGlobal });
			emitter.pushInstruction({
				op: "struct.new",
				typeIndex: panicNodeTypeIndex,
			});
			emitter.pushInstruction({ op: "global.set", index: panicGlobal });
			emitter.pushInstruction("return");
		} else if (fn._isInterfaceDispatcher) {
			emitter.emitInterfaceDispatcher(fn);
		} else if (fn._isMapHelper) {
			emitter.emitMapHelper(fn);
		} else if (fn._isSharedHelper) {
			emitter.emitSharedHelper(fn);
		} else if (fn._isRuntimeHelper) {
			emitter.emitRuntimeHelper(fn);
		} else if (fn.intrinsic) {
			emitWasmIntrinsic(emitter, fn);
		} else if (fn.body) {
			emitter.emitFunctionBody(fn.body);
		}
		// If last instruction is not return or unreachable, auto-emit return or unreachable
		let body = emitter.body;
		if (
			body.length === 0 ||
			(body[body.length - 1].op !== "return" &&
				body[body.length - 1].op !== "unreachable")
		) {
			if (emitter.returnTypes.length === 0) {
				body.push({ op: "return" });
			} else {
				body.push({ op: "unreachable" });
			}
		}

		body = peepholeOptimize(body);

		mod.funcs.push({
			typeIndex: fn._typeIndex,
			locals: emitter.localTypes,
			body,
			src:
				fn._srcFile && typeof fn._line === "number"
					? { file: fn._srcFile, line: fn._line }
					: null,
		});
	}

	// 5. Boundary marshalling helpers + JS facade
	let facade = null;
	if (boundaryMeta) {
		addBoundaryHelpers(mod, boundaryMeta);
		facade = generateFacade(boundaryMeta, {
			stringTable: mod.stringTable,
			callMain: Boolean(options.callMain) && mod.funcMap.has("main"),
		});
	}

	const moduleIR = {
		types: mod.types,
		imports: mod.imports,
		tags: mod.tags,
		globals: mod.globals,
		elements: mod.elements,
		data: mod.data,
		funcs: mod.funcs,
		exports: mod.exports,
		memory: mod.memory ?? null,
		start: globalInitFn ? globalInitFn._globalFuncIndex : null,
		sourceMappingURL: options.sourceMappingURL ?? null,
	};

	pruneUnusedFuncs(moduleIR);
	const wasmBytes = encodeModule(moduleIR);
	const watText = options.emitWat ? emitWat(moduleIR) : null;

	// Function-level source positions: `sources` are the absolute Go files,
	// `mappings` pair each function body's byte offset with its 0-based line.
	const sources = [];
	const sourceIndex = new Map();
	const mappings = [];
	moduleIR.funcs.forEach((fn, i) => {
		if (!fn.src) return;
		let idx = sourceIndex.get(fn.src.file);
		if (idx === undefined) {
			idx = sources.length;
			sources.push(fn.src.file);
			sourceIndex.set(fn.src.file, idx);
		}
		mappings.push({
			offset: moduleIR.codeOffsets[i],
			srcFileIdx: idx,
			srcLine: Math.max(0, fn.src.line - 1),
		});
	});

	return {
		wasm: wasmBytes,
		wat: watText,
		stringTable: mod.stringTable,
		moduleIR,
		facade,
		sourceMapInfo: { sources, mappings },
	};
}

function _collectInterfaceDispatchers(progs, funcDecls, mod, checker) {
	const interfaceCalls = new Map();
	for (const fn of funcDecls) {
		if (fn.body) _scanInterfaceCallNodes(fn.body, interfaceCalls, checker);
	}
	_scanInterfaceTypeDecls(progs, interfaceCalls, checker);
	_scanFuncSigInterfaces(progs, funcDecls, interfaceCalls, checker, mod);

	// `error.Error()` is reached implicitly by fmt verbs and errors.Is, so
	// the dispatcher must exist even when user code never calls it.
	if (mod.hasErrorType && !interfaceCalls.has("error.Error")) {
		interfaceCalls.set("error.Error", {
			ifaceName: "error",
			ifaceType: ERROR,
			methodName: "Error",
			methodSig: {
				kind: "func",
				params: [],
				returns: [{ kind: "basic", name: "string" }],
			},
		});
	}

	for (const info of interfaceCalls.values()) {
		funcDecls.push(_makeInterfaceDispatcher(info, checker));
	}
}
