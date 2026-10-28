// src/backend/wasm/index.js
// WASM Backend compiler entry point: lowered AST + types -> Module IR -> binary / WAT.

import { lower, lowerFunction } from "../../lower/index.js";
import {
	getOrCreateIteratorFuncLit,
	isIteratorRangeFor,
} from "../../lower/range.js";
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
import { hasNativeWasmOpt, optimizeWasm } from "./optimize.js";
import {
	_scanFuncSigInterfaces,
	_scanImportsInBody,
	_scanInterfaceCallNodes,
	_scanInterfaceTypeDecls,
	_usesAnyEq,
	_usesFmtAny,
	_usesTestingCleanup,
	_usesTestingRun,
	importsAnyOf,
} from "./prescan.js";
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

// Body of `__index_panic(i i64, n i32)`: builds Go's message with the string
// imports and raises it like any other runtime panic.
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
	emitter.pushInstruction({
		op: "call",
		funcIndex: mod.getStrFromI64ImportIndex(),
	});
	concat();
	emitter.pushInstruction({ op: "local.get", index: 0 });
	emitter.pushInstruction({ op: "i64.const", value: 0n });
	emitter.pushInstruction("i64.lt_s");
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
	emitter.pushInstruction("any.convert_extern");
	emitter.emitPanicThrow();
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
	// `index out of range [i]` for a negative index.
	funcDecls.push({
		kind: "FuncDecl",
		name: "__index_panic",
		params: [
			{ name: "i", type: { kind: "basic", name: "int64" } },
			{ name: "n", type: { kind: "basic", name: "int32" } },
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

	const sliceBoundsPanicFn = {
		kind: "FuncDecl",
		name: "__slice_bounds_panic",
		params: [],
		returnType: null,
		_isRuntimePanic: true,
		_panicMsg: "runtime error: slice bounds out of range",
	};
	funcDecls.push(sliceBoundsPanicFn);

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
		// clone
		funcDecls.push({
			kind: "FuncDecl",
			name: mapInfo.cloneFuncName,
			params: [{ name: "m", type: mapInfo.wType }],
			returnType: mapInfo.wType,
			body: { kind: "Block", stmts: [], list: [] },
			_isMapHelper: true,
			_mapHelperKind: "clone",
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

	// 1e3. Runtime helpers: error values, interface equality, t.Run callback.
	mod.usesTestingRun = funcDecls.some((fn) => _usesTestingRun(fn.body));
	mod.usesTestingCleanup = funcDecls.some((fn) => _usesTestingCleanup(fn.body));
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
			helper(
				`${ERROR_STRUCT}.Unwrap`,
				[{ name: "e", type: errPtr }],
				ANY_T,
				"error_cause",
				{
					_isMethod: true,
					_recvTypeName: ERROR_STRUCT,
					_methodName: "Unwrap",
				},
			),
			helper(
				"__mk_error",
				[
					{ name: "msg", type: STR_T },
					{ name: "cause", type: ANY_T },
				],
				ANY_T,
				"mk_error",
			),
			helper("__error_str", [{ name: "e", type: ANY_T }], STR_T, "error_str"),
			{
				kind: "FuncDecl",
				name: "__errors_unwrap",
				params: [{ name: "__recv", type: ANY_T }],
				returnType: ANY_T,
				body: { kind: "Block", stmts: [], list: [] },
				_isInterfaceDispatcher: true,
				_softDispatch: true,
				_ifaceName: "error",
				_ifaceType: null,
				_methodName: "Unwrap",
				_rootFuncDecl: null,
			},
			helper(
				"__errors_is",
				[
					{ name: "err", type: ANY_T },
					{ name: "target", type: ANY_T },
				],
				BOOL_T,
				"errors_is",
			),
		);
	}
	if (mod.usesTestingRun) {
		funcDecls.push(
			helper(
				"__testing_run_cb",
				[
					{ name: "fn", type: ANY_T },
					{
						name: "t",
						type: {
							kind: "pointer",
							base: { kind: "named", name: "testing.T" },
						},
					},
				],
				null,
				"testing_run_cb",
				{ _forceExport: true },
			),
		);
	}
	if (mod.usesTestingCleanup) {
		funcDecls.push(
			helper(
				"__testing_cleanup_cb",
				[{ name: "fn", type: ANY_T }],
				null,
				"testing_cleanup_cb",
				{ _forceExport: true },
			),
		);
	}
	_registerIoSyntheticMethods(funcDecls, mod, STR_T, progs);
	// `__any_fmt` turns an `any` operand of fmt into the host value; its body
	// is emitted last-but-one so every type registered by user code is seen.
	if (_usesFmtAny(funcDecls, mod)) {
		funcDecls.push(
			helper("__any_fmt", [{ name: "a", type: ANY_T }], STR_T, "any_fmt"),
		);
	}

	// 1f. Boundary metadata (exported surface of wasm packages)
	const boundaryMeta = options.boundary
		? collectBoundaryMeta(progs, funcDecls, mod)
		: null;

	// 2. Pre-scan for needed imports so import func indices are fixed
	for (const fn of funcDecls) {
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
				!fn._isIoHelper &&
				!fn._isPhase7Helper &&
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
		} else if (fn._isRuntimePanic) {
			const strIdx = mod.internString(fn._panicMsg);
			const funcIdx = mod.getStringImportIndex();
			emitter.pushInstruction({ op: "i32.const", value: strIdx });
			emitter.pushInstruction({ op: "call", funcIndex: funcIdx });
			emitter.pushInstruction("any.convert_extern");
			emitter.emitPanicThrow();
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
		} else if (fn._isIoHelper || fn._isPhase7Helper) {
			emitter.emitIoHelper(fn);
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
			stdlibEnv: mod.usesStdlibEnv,
		});
	}

	const moduleIR = {
		types: mod.types,
		imports: mod.imports,
		tags: mod.tags,
		globals: mod.globals,
		elements: mod.elements,
		funcs: mod.funcs,
		exports: mod.exports,
		memory: mod.memory ?? null,
		start: globalInitFn ? globalInitFn._globalFuncIndex : null,
		sourceMappingURL: options.sourceMappingURL ?? null,
	};

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
			ifaceType: checker?.types?.get("error") ?? {
				kind: "interface",
				name: "error",
			},
			methodName: "Error",
			methodSig: {
				kind: "func",
				params: [],
				returns: [{ kind: "basic", name: "string" }],
			},
		});
	}

	const hasIo = importsAnyOf(progs, [
		"io",
		"fmt",
		"strings",
		"bytes",
		"crypto/sha256",
		"sha256",
		"encoding/binary",
		"binary",
		"encoding/hex",
		"hex",
		"encoding/base64",
		"base64",
	]);
	if (hasIo) {
		const byteSliceType = {
			kind: "slice",
			elem: { kind: "basic", name: "byte" },
		};
		const intErrReturns = [
			{ kind: "basic", name: "int" },
			{ kind: "interface", name: "error" },
		];
		if (!interfaceCalls.has("io.Reader.Read")) {
			interfaceCalls.set("io.Reader.Read", {
				ifaceName: "io.Reader",
				ifaceType: checker?.types?.get("io.Reader"),
				methodName: "Read",
				methodSig: {
					kind: "func",
					params: [byteSliceType],
					returns: intErrReturns,
				},
			});
		}
		if (!interfaceCalls.has("io.Writer.Write")) {
			interfaceCalls.set("io.Writer.Write", {
				ifaceName: "io.Writer",
				ifaceType: checker?.types?.get("io.Writer"),
				methodName: "Write",
				methodSig: {
					kind: "func",
					params: [byteSliceType],
					returns: intErrReturns,
				},
			});
		}
	}

	for (const info of interfaceCalls.values()) {
		funcDecls.push(_makeInterfaceDispatcher(info, checker));
	}
}

function _registerIoSyntheticMethods(funcDecls, mod, strType, programs) {
	const progs = Array.isArray(programs) ? programs : [programs];
	const hasStrings = importsAnyOf(progs, ["strings"]);
	const hasBytes = importsAnyOf(progs, ["bytes"]);
	const hasIo = importsAnyOf(progs, ["io"]);

	const BYTE_SLICE_T = {
		kind: "slice",
		elem: { kind: "basic", name: "byte" },
	};
	const INT_T = { kind: "basic", name: "int" };
	const ERR_T = { kind: "interface", name: "error" };
	const INT_ERR_RET = { kind: "tuple", types: [INT_T, ERR_T] };
	const ioHelper = (name, params, returnType, kind, extra = {}) => ({
		kind: "FuncDecl",
		name,
		params,
		returnType,
		body: { kind: "Block", stmts: [], list: [] },
		_isIoHelper: kind,
		_rootFuncDecl: null,
		...extra,
	});

	if (hasStrings && mod.structTypes.has("strings.Builder")) {
		const bPtr = {
			kind: "pointer",
			base: { kind: "named", name: "strings.Builder" },
		};
		funcDecls.push(
			ioHelper(
				"strings.Builder.Write",
				[
					{ name: "b", type: bPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"builder_write",
				{
					_isMethod: true,
					_recvTypeName: "strings.Builder",
					_methodName: "Write",
				},
			),
			ioHelper(
				"strings.Builder.WriteString",
				[
					{ name: "b", type: bPtr },
					{ name: "s", type: strType },
				],
				INT_ERR_RET,
				"builder_write_string",
				{
					_isMethod: true,
					_recvTypeName: "strings.Builder",
					_methodName: "WriteString",
				},
			),
		);
	}
	if (hasBytes && mod.structTypes.has("bytes.Buffer")) {
		const bPtr = {
			kind: "pointer",
			base: { kind: "named", name: "bytes.Buffer" },
		};
		funcDecls.push(
			ioHelper(
				"bytes.Buffer.Write",
				[
					{ name: "b", type: bPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"buffer_write",
				{
					_isMethod: true,
					_recvTypeName: "bytes.Buffer",
					_methodName: "Write",
				},
			),
			ioHelper(
				"bytes.Buffer.WriteString",
				[
					{ name: "b", type: bPtr },
					{ name: "s", type: strType },
				],
				INT_ERR_RET,
				"buffer_write_string",
				{
					_isMethod: true,
					_recvTypeName: "bytes.Buffer",
					_methodName: "WriteString",
				},
			),
			ioHelper(
				"bytes.Buffer.Read",
				[
					{ name: "b", type: bPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"buffer_read",
				{
					_isMethod: true,
					_recvTypeName: "bytes.Buffer",
					_methodName: "Read",
				},
			),
		);
	}
	if (hasStrings && mod.structTypes.has("strings.Reader")) {
		const rPtr = {
			kind: "pointer",
			base: { kind: "named", name: "strings.Reader" },
		};
		funcDecls.push(
			ioHelper(
				"strings.Reader.Read",
				[
					{ name: "r", type: rPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"strings_reader_read",
				{
					_isMethod: true,
					_recvTypeName: "strings.Reader",
					_methodName: "Read",
				},
			),
			ioHelper(
				"strings.Reader.Len",
				[{ name: "r", type: rPtr }],
				INT_T,
				"strings_reader_len",
				{
					_isMethod: true,
					_recvTypeName: "strings.Reader",
					_methodName: "Len",
				},
			),
			ioHelper(
				"strings.Reader.Reset",
				[
					{ name: "r", type: rPtr },
					{ name: "s", type: strType },
				],
				null,
				"strings_reader_reset",
				{
					_isMethod: true,
					_recvTypeName: "strings.Reader",
					_methodName: "Reset",
				},
			),
		);
	}
	if (hasBytes && mod.structTypes.has("bytes.Reader")) {
		const rPtr = {
			kind: "pointer",
			base: { kind: "named", name: "bytes.Reader" },
		};
		funcDecls.push(
			ioHelper(
				"bytes.Reader.Read",
				[
					{ name: "r", type: rPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"bytes_reader_read",
				{ _isMethod: true, _recvTypeName: "bytes.Reader", _methodName: "Read" },
			),
			ioHelper(
				"bytes.Reader.Len",
				[{ name: "r", type: rPtr }],
				INT_T,
				"bytes_reader_len",
				{ _isMethod: true, _recvTypeName: "bytes.Reader", _methodName: "Len" },
			),
			ioHelper(
				"bytes.Reader.Reset",
				[
					{ name: "r", type: rPtr },
					{ name: "b", type: BYTE_SLICE_T },
				],
				null,
				"bytes_reader_reset",
				{
					_isMethod: true,
					_recvTypeName: "bytes.Reader",
					_methodName: "Reset",
				},
			),
		);
	}
	if (hasIo && mod.structTypes.has("io.discard")) {
		const dPtr = {
			kind: "pointer",
			base: { kind: "named", name: "io.discard" },
		};
		funcDecls.push(
			ioHelper(
				"io.discard.Write",
				[
					{ name: "d", type: dPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"discard_write",
				{ _isMethod: true, _recvTypeName: "io.discard", _methodName: "Write" },
			),
			ioHelper(
				"io.discard.WriteString",
				[
					{ name: "d", type: dPtr },
					{ name: "s", type: strType },
				],
				INT_ERR_RET,
				"discard_write_string",
				{
					_isMethod: true,
					_recvTypeName: "io.discard",
					_methodName: "WriteString",
				},
			),
		);
	}
	if (hasIo && mod.structTypes.has("io.LimitedReader")) {
		const lrPtr = {
			kind: "pointer",
			base: { kind: "named", name: "io.LimitedReader" },
		};
		funcDecls.push(
			ioHelper(
				"io.LimitedReader.Read",
				[
					{ name: "l", type: lrPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"limited_reader_read",
				{
					_isMethod: true,
					_recvTypeName: "io.LimitedReader",
					_methodName: "Read",
				},
			),
		);
	}
	const hasOs = importsAnyOf(progs, ["os"]);
	if (hasOs && mod.structTypes.has("os.File")) {
		const fPtr = {
			kind: "pointer",
			base: { kind: "named", name: "os.File" },
		};
		funcDecls.push(
			ioHelper(
				"os.File.Write",
				[
					{ name: "f", type: fPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"os_file_write",
				{ _isMethod: true, _recvTypeName: "os.File", _methodName: "Write" },
			),
			ioHelper(
				"os.File.WriteString",
				[
					{ name: "f", type: fPtr },
					{ name: "s", type: strType },
				],
				INT_ERR_RET,
				"os_file_write_string",
				{
					_isMethod: true,
					_recvTypeName: "os.File",
					_methodName: "WriteString",
				},
			),
			ioHelper(
				"os.File.Read",
				[
					{ name: "f", type: fPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"os_file_read",
				{ _isMethod: true, _recvTypeName: "os.File", _methodName: "Read" },
			),
			ioHelper(
				"os.File.Close",
				[{ name: "f", type: fPtr }],
				ERR_T,
				"os_file_close",
				{ _isMethod: true, _recvTypeName: "os.File", _methodName: "Close" },
			),
		);
	}
	const hasSha256 = importsAnyOf(progs, ["crypto/sha256", "sha256"]);
	if (
		hasSha256 &&
		(mod.structTypes.has("sha256.digest") ||
			mod.structTypes.has("crypto/sha256.digest"))
	) {
		const dPtr = {
			kind: "pointer",
			base: { kind: "named", name: "sha256.digest" },
		};
		funcDecls.push(
			ioHelper(
				"sha256.digest.Write",
				[
					{ name: "d", type: dPtr },
					{ name: "p", type: BYTE_SLICE_T },
				],
				INT_ERR_RET,
				"sha256_write",
				{
					_isMethod: true,
					_recvTypeName: "sha256.digest",
					_methodName: "Write",
				},
			),
			ioHelper(
				"sha256.digest.Sum",
				[
					{ name: "d", type: dPtr },
					{ name: "b", type: BYTE_SLICE_T },
				],
				BYTE_SLICE_T,
				"sha256_sum",
				{ _isMethod: true, _recvTypeName: "sha256.digest", _methodName: "Sum" },
			),
			ioHelper(
				"sha256.digest.Reset",
				[{ name: "d", type: dPtr }],
				null,
				"sha256_reset",
				{
					_isMethod: true,
					_recvTypeName: "sha256.digest",
					_methodName: "Reset",
				},
			),
			ioHelper(
				"sha256.digest.Size",
				[{ name: "d", type: dPtr }],
				INT_T,
				"sha256_size",
				{
					_isMethod: true,
					_recvTypeName: "sha256.digest",
					_methodName: "Size",
				},
			),
			ioHelper(
				"sha256.digest.BlockSize",
				[{ name: "d", type: dPtr }],
				INT_T,
				"sha256_block_size",
				{
					_isMethod: true,
					_recvTypeName: "sha256.digest",
					_methodName: "BlockSize",
				},
			),
		);
	}
}
