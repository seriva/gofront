// src/backend/wasm/index.js
// WASM Backend compiler entry point: lowered AST + types -> Module IR -> binary / WAT.

import { Lexer } from "../../lexer.js";
import { lower } from "../../lower/index.js";
import { Parser } from "../../parser/index.js";
import { TypeChecker } from "../../typechecker/index.js";
import {
	addBoundaryHelpers,
	collectBoundaryMeta,
	generateFacade,
	scanBoundaryImports,
} from "./boundary.js";
import { FunctionEmitter } from "./emit.js";
import { encodeModule, isGoFrontWasm } from "./encode.js";
import { getFuncSignature, isTestingT, toWasmType } from "./types.js";
import { emitWat } from "./wat.js";

export { isGoFrontWasm };

export class ModuleEmitter {
	constructor(checker, lowerResult = null, programs = [], options = {}) {
		this.checker = checker;
		this.lowerResult = lowerResult;
		// Local package names whose code is linked into this module; selectors
		// like `mathx.NewVec3` are de-qualified to `NewVec3` by the emitter.
		this.bundledPackages = options.bundledPackages ?? new Set();
		this.constCache = new Map(); // name -> BasicLit (package-level literal consts)
		this.nonLiteralConsts = new Set(); // package-level consts the backend cannot evaluate yet

		this.types = []; // type entries
		this.typeCache = new Map(); // signature string -> index
		this._openRec = null; // rec group receiving new types while structs are resolved

		this.structTypes = new Map(); // name -> struct info
		this.boxTypes = new Map(); // wType key -> box info
		this.arrayTypes = new Map(); // wType key -> array info
		this.sliceTypes = new Map(); // wType key -> slice info
		this.closureTypes = new Map(); // key -> closure info
		this.envTypes = new Map(); // key -> env info

		this.elements = []; // declarative elements for ref.func
		this.elementSet = new Set();

		this.imports = []; // import entries
		this.importCache = new Map(); // key -> func index

		this.tags = []; // exception tags
		this.globals = []; // global entries
		this.globalCache = new Map(); // name -> index

		this.funcs = []; // internal func definitions
		this.funcMap = new Map(); // name -> global func index
		this.funcParamTypes = new Map(); // name -> param types array
		this.funcParamGoTypes = new Map(); // name -> param Go types array

		this.exports = []; // export entries
		this.stringTable = []; // string literals
		this.stringCache = new Map();

		if (programs && programs.length > 0) {
			this.initTypes(programs);
		}

		this._importsLocked = false;
		this._initRuntimeImports();
	}

	initTypes(programs) {
		const progs = Array.isArray(programs) ? programs : [programs];
		const rawStructs = [];
		const seen = new Set();
		const aliases = []; // qualified key (pkg.T) -> unqualified struct name

		for (const p of progs) {
			for (const d of p.decls ?? []) {
				if (d.kind === "TypeDecl" && d.type?.kind === "StructType") {
					if (!seen.has(d.name)) {
						seen.add(d.name);
						rawStructs.push({
							name: d.name,
							astFields: d.type.fields ?? [],
							pkgName: p.pkg?.name ?? "main",
							pkgTarget: p.target ?? "wasm",
						});
					}
				}
			}
		}

		if (this.checker?.types) {
			for (const [key, t] of this.checker.types.entries()) {
				if (t.kind === "named" && t.underlying?.kind === "struct") {
					const name = t.name ?? key;
					if (!seen.has(name)) {
						seen.add(name);
						rawStructs.push({ name, structType: t.underlying });
					}
					if (key !== name) aliases.push([key, name]);
				}
			}
		}

		if (rawStructs.length === 0) return;

		// Field resolution may create array/slice/box types; they join this rec
		// group so struct indices (base + i) stay valid and may be referenced
		// from the auxiliary types in any order.
		const base = this._getTotalTypeCount();
		const structEntries = rawStructs.map(() => ({
			form: "struct",
			fields: [],
		}));
		this.types.push({ form: "rec", types: structEntries });
		this._openRec = structEntries;

		for (let i = 0; i < rawStructs.length; i++) {
			const s = rawStructs[i];
			this.structTypes.set(s.name, {
				name: s.name,
				typeIndex: base + i,
				fields: [],
				fieldIndexMap: new Map(),
				embeds: [],
				pkgName: s.pkgName ?? null,
				pkgTarget: s.pkgTarget ?? "wasm",
			});
		}
		// `mathx.Vec3` resolves to the same struct info as `Vec3` once linked.
		for (const [key, name] of aliases) {
			if (!this.structTypes.has(key))
				this.structTypes.set(key, this.structTypes.get(name));
		}

		for (let i = 0; i < rawStructs.length; i++) {
			const s = rawStructs[i];
			const info = this.structTypes.get(s.name);
			const resolvedStruct = this.checker?.types?.get(s.name)?.underlying;

			const fields = [];
			const fieldIndexMap = new Map();
			const embeds = [];

			if (s.astFields && s.astFields.length > 0) {
				let fIdx = 0;
				for (const f of s.astFields) {
					const names = f.embedded
						? [f.type.name]
						: f.names?.length
							? f.names
							: f.name
								? [f.name]
								: [];
					for (const n of names) {
						const wType = toWasmType(f.type, this.checker, this);
						fields.push({
							name: n,
							goType: f.type,
							wType,
							embedded: Boolean(f.embedded),
						});
						fieldIndexMap.set(n, fIdx);
						if (f.embedded) {
							embeds.push({
								name: n,
								fieldIndex: fIdx,
							});
						}
						fIdx++;
					}
				}
			} else if (resolvedStruct?.fields) {
				let fIdx = 0;
				for (const [fName, fType] of resolvedStruct.fields.entries()) {
					const wType = toWasmType(fType, this.checker, this);
					fields.push({ name: fName, goType: fType, wType });
					fieldIndexMap.set(fName, fIdx);
					fIdx++;
				}
				if (resolvedStruct?._embeds) {
					for (const embed of resolvedStruct._embeds) {
						const embedName = embed.kind === "named" ? embed.name : null;
						if (embedName && fieldIndexMap.has(embedName)) {
							embeds.push({
								name: embedName,
								fieldIndex: fieldIndexMap.get(embedName),
							});
						}
					}
				}
			}

			info.fields = fields;
			info.fieldIndexMap = fieldIndexMap;
			info.embeds = embeds;

			const typeEntry = structEntries[i];
			typeEntry.fields = fields.map((f) => ({ type: f.wType, mutable: true }));
			info.typeEntry = typeEntry;
		}

		this._openRec = null;
	}

	_pushType(typeEntry) {
		(this._openRec ?? this.types).push(typeEntry);
	}

	getStructType(name) {
		return this.structTypes.get(name) ?? null;
	}

	getBoxType(goType) {
		const wType = toWasmType(goType, this.checker, this);
		const key = typeof wType === "string" ? wType : JSON.stringify(wType);
		if (this.boxTypes.has(key)) {
			return this.boxTypes.get(key);
		}
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			fields: [{ type: wType, mutable: true }],
		};
		this._pushType(typeEntry);
		const boxInfo = { typeIndex, typeEntry, wType };
		this.boxTypes.set(key, boxInfo);
		return boxInfo;
	}

	getArrayType(elemGoType) {
		const elemWType = toWasmType(elemGoType, this.checker, this);
		const key =
			typeof elemWType === "string" ? elemWType : JSON.stringify(elemWType);
		if (this.arrayTypes.has(key)) {
			return this.arrayTypes.get(key);
		}
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "array",
			elemType: elemWType,
			mutable: true,
		};
		this._pushType(typeEntry);
		const arrInfo = { typeIndex, typeEntry, elemWType, elemGoType };
		this.arrayTypes.set(key, arrInfo);
		return arrInfo;
	}

	getSliceType(elemGoType) {
		const elemWType = toWasmType(elemGoType, this.checker, this);
		const key =
			typeof elemWType === "string" ? elemWType : JSON.stringify(elemWType);
		if (this.sliceTypes.has(key)) {
			return this.sliceTypes.get(key);
		}
		const arrInfo = this.getArrayType(elemGoType);
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			fields: [
				{
					type: {
						kind: "ref",
						nullable: true,
						typeIndex: arrInfo.typeIndex,
					},
					mutable: true,
				},
				{ type: "i32", mutable: true }, // offset
				{ type: "i32", mutable: true }, // len
				{ type: "i32", mutable: true }, // cap
			],
		};
		this._pushType(typeEntry);
		const sliceInfo = {
			typeIndex,
			typeEntry,
			arrInfo,
			elemWType,
			elemGoType,
		};
		this.sliceTypes.set(key, sliceInfo);
		return sliceInfo;
	}

	getClosureType(goType) {
		const sig = getFuncSignature(goType, this.checker);
		const paramWTypes = sig.params
			.map((p) => toWasmType(p, this.checker, this))
			.filter(Boolean);
		const returnWTypes = sig.returns
			.map((r) => toWasmType(r, this.checker, this))
			.filter(Boolean);

		const key = `${paramWTypes.map((p) => (typeof p === "object" ? JSON.stringify(p) : p)).join(",")}=>${returnWTypes.map((r) => (typeof r === "object" ? JSON.stringify(r) : r)).join(",")}`;
		if (this.closureTypes.has(key)) {
			return this.closureTypes.get(key);
		}

		// 1. Function signature type index: (param anyref, ...paramWTypes) -> (...returnWTypes)
		const funcTypeIndex = this.getTypeIndex(
			["anyref", ...paramWTypes],
			returnWTypes,
		);

		// 2. Closure struct type index: struct { fn: (ref funcTypeIndex), env: anyref }
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			fields: [
				{
					type: {
						kind: "ref",
						nullable: false,
						typeIndex: funcTypeIndex,
					},
					mutable: false,
				},
				{
					type: "anyref",
					mutable: true,
				},
			],
		};
		this._pushType(typeEntry);

		const closureInfo = {
			typeIndex,
			typeEntry,
			funcTypeIndex,
			paramWTypes,
			returnWTypes,
			sig,
		};
		this.closureTypes.set(key, closureInfo);
		return closureInfo;
	}

	getEnvType(fieldTypes) {
		const key = fieldTypes
			.map((f) =>
				typeof f.wType === "object" ? JSON.stringify(f.wType) : f.wType,
			)
			.join(",");
		if (this.envTypes.has(key)) {
			return this.envTypes.get(key);
		}
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			fields: fieldTypes.map((f) => ({ type: f.wType, mutable: true })),
		};
		this._pushType(typeEntry);
		const envInfo = { typeIndex, typeEntry, fieldTypes };
		this.envTypes.set(key, envInfo);
		return envInfo;
	}

	addRefFuncElement(funcIdx) {
		if (!this.elementSet.has(funcIdx)) {
			this.elementSet.add(funcIdx);
			this.elements.push(funcIdx);
		}
	}

	_getTotalTypeCount() {
		let count = 0;
		for (const entry of this.types) {
			if (entry.form === "rec") count += entry.types.length;
			else count += 1;
		}
		return count;
	}

	_initRuntimeImports() {
		this._initPanicTag();
		this.getPanicImportIndex(); // env.panic

		// String built-ins
		this.getStringImportIndex(); // env.str
		this.getStringLenImportIndex(); // env.str_len
		this.getStringConcatImportIndex(); // env.str_concat
		this.getStringCmpImportIndex("=="); // env.str_eq
		this.getStringCmpImportIndex("!="); // env.str_ne
		this.getStringCmpImportIndex("<"); // env.str_lt
		this.getStringCmpImportIndex("<="); // env.str_le
		this.getStringCmpImportIndex(">"); // env.str_gt
		this.getStringCmpImportIndex(">="); // env.str_ge
		this.getStringGetImportIndex(); // env.str_get
		this.getStringSliceImportIndex(); // env.str_slice
		this.getStringFromCodePointImportIndex(); // env.str_from_code_point
		this.getStringCodePointAtImportIndex(); // env.str_code_point_at
		this.getIsStringImportIndex(); // env.is_string

		// Logging built-ins
		this.getPrintlnEmptyIndex(); // env.println_empty
		const logTypes = ["i32", "i64", "f32", "f64", "externref", "anyref"];
		for (const t of logTypes) {
			this.getLogImportIndex(t, false, false); // env.print_*
			this.getLogImportIndex(t, true, false); // env.println_*
		}
		this.getLogImportIndex("i32", false, true); // env.print_bool
		this.getLogImportIndex("i32", true, true); // env.println_bool

		// Math built-ins
		const unaryMath = [
			"sin",
			"cos",
			"tan",
			"asin",
			"acos",
			"atan",
			"exp",
			"log",
			"log2",
			"log10",
			"round",
		];
		for (const m of unaryMath) {
			this.getMathImportIndex(m, false);
		}
		const binaryMath = ["atan2", "pow"];
		for (const m of binaryMath) {
			this.getMathImportIndex(m, true);
		}
	}

	_initPanicTag() {
		// Type: (externref) -> ()
		const typeIdx = this.getTypeIndex(["externref"], []);
		// Tag 0
		this.tags.push({ typeIndex: typeIdx });
		// Export tag 0 as "panicTag"
		this.exports.push({ name: "panicTag", kind: "tag", index: 0 });
	}

	getTypeIndex(params, results) {
		const key = `${params.map((p) => (typeof p === "object" ? JSON.stringify(p) : p)).join(",")}=>${results.map((r) => (typeof r === "object" ? JSON.stringify(r) : r)).join(",")}`;
		if (this.typeCache.has(key)) {
			return this.typeCache.get(key);
		}
		const idx = this._getTotalTypeCount();
		this._pushType({ form: "func", params, results });
		this.typeCache.set(key, idx);
		return idx;
	}

	internString(str) {
		if (this.stringCache.has(str)) {
			return this.stringCache.get(str);
		}
		const idx = this.stringTable.length;
		this.stringTable.push(str);
		this.stringCache.set(str, idx);
		return idx;
	}

	getOrAddFuncImport(module, name, params, results) {
		const key = `${module}.${name}`;
		if (this.importCache.has(key)) {
			return this.importCache.get(key);
		}
		if (this._importsLocked) {
			throw new Error(`Unexpected import added after lock: ${key}`);
		}
		const typeIndex = this.getTypeIndex(params, results);
		const globalFuncIdx = this.imports.filter((i) => i.kind === "func").length;
		this.imports.push({
			module,
			name,
			kind: "func",
			typeIndex,
		});
		this.importCache.set(key, globalFuncIdx);
		return globalFuncIdx;
	}

	getStringImportIndex() {
		return this.getOrAddFuncImport("env", "str", ["i32"], ["externref"]);
	}

	// Panics are raised by a JS import that throws a plain `Error`, so wasm
	// frames unwind without a wasm `throw` and the JS caller needs no
	// try/catch guard around exports.  (V8 cannot inline JS→wasm calls made
	// inside a try block, and a non-inlined call boxes every float argument.)
	getPanicImportIndex() {
		return this.getOrAddFuncImport("env", "panic", ["externref"], []);
	}

	getPrintlnEmptyIndex() {
		return this.getOrAddFuncImport("env", "println_empty", [], []);
	}

	// `*testing.T` method calls: args are pushed one by one to a JS-side
	// buffer, then `testing_call(t, methodNameStrIdx)` invokes the method.
	getTestingArgImportIndex(wType, isBool = false) {
		if (isBool)
			return this.getOrAddFuncImport("env", "testing_arg_bool", ["i32"], []);
		const suffix =
			wType === "externref" ? "str" : wType === "anyref" ? "any" : wType;
		if (!["i32", "i64", "f32", "f64", "str", "any"].includes(suffix)) {
			throw new Error(
				"only primitive, string and any arguments are supported for testing.T methods in wasm packages",
			);
		}
		return this.getOrAddFuncImport(
			"env",
			`testing_arg_${suffix}`,
			[suffix === "str" ? "externref" : suffix === "any" ? "anyref" : wType],
			[],
		);
	}

	getTestingCallImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"testing_call",
			["externref", "i32"],
			[],
		);
	}

	getTestingNameImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"testing_name",
			["externref"],
			["externref"],
		);
	}

	getTestingFlagImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"testing_flag",
			["externref", "i32"],
			["i32"],
		);
	}

	getLogImportIndex(wType, isLast = false, isBool = false) {
		const prefix = isLast ? "println" : "print";
		if (isBool) {
			return this.getOrAddFuncImport("env", `${prefix}_bool`, ["i32"], []);
		}
		switch (wType) {
			case "i32":
				return this.getOrAddFuncImport("env", `${prefix}_i32`, ["i32"], []);
			case "i64":
				return this.getOrAddFuncImport("env", `${prefix}_i64`, ["i64"], []);
			case "f32":
				return this.getOrAddFuncImport("env", `${prefix}_f32`, ["f32"], []);
			case "f64":
				return this.getOrAddFuncImport("env", `${prefix}_f64`, ["f64"], []);
			case "externref":
				return this.getOrAddFuncImport(
					"env",
					`${prefix}_str`,
					["externref"],
					[],
				);
			case "anyref":
				return this.getOrAddFuncImport("env", `${prefix}_any`, ["anyref"], []);
			default:
				return this.getOrAddFuncImport("env", `${prefix}_i32`, ["i32"], []);
		}
	}

	getStringLenImportIndex() {
		return this.getOrAddFuncImport("env", "str_len", ["externref"], ["i32"]);
	}

	getStringConcatImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_concat",
			["externref", "externref"],
			["externref"],
		);
	}

	getStringCmpImportIndex(op) {
		const opMap = {
			"==": "str_eq",
			"!=": "str_ne",
			"<": "str_lt",
			"<=": "str_le",
			">": "str_gt",
			">=": "str_ge",
		};
		const fn = opMap[op] ?? "str_eq";
		return this.getOrAddFuncImport(
			"env",
			fn,
			["externref", "externref"],
			["i32"],
		);
	}

	getStringGetImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_get",
			["externref", "i32"],
			["i32"],
		);
	}

	getStringSliceImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_slice",
			["externref", "i32", "i32"],
			["externref"],
		);
	}

	getStringFromCodePointImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_from_code_point",
			["i32"],
			["externref"],
		);
	}

	getStringCodePointAtImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_code_point_at",
			["externref", "i32"],
			["i32"],
		);
	}

	getIsStringImportIndex() {
		return this.getOrAddFuncImport("env", "is_string", ["anyref"], ["i32"]);
	}

	getMathImportIndex(jsName, isBinary = false) {
		const params = isBinary ? ["f64", "f64"] : ["f64"];
		return this.getOrAddFuncImport("Math", jsName, params, ["f64"]);
	}

	resolveFuncIndex(name) {
		return this.funcMap.get(name) ?? null;
	}

	getFuncParamTypes(name) {
		return this.funcParamTypes.get(name) ?? [];
	}

	getFuncParamGoTypes(name) {
		return this.funcParamGoTypes.get(name) ?? [];
	}

	resolveGlobal(name) {
		return this.globalCache.get(name) ?? null;
	}

	resolveConst(name) {
		return this.constCache.get(name) ?? null;
	}

	isNonLiteralConst(name) {
		return this.nonLiteralConsts.has(name);
	}
}

export function compileWasmModule(
	programs,
	checker,
	lowerResult = null,
	options = {},
) {
	const progs = Array.isArray(programs) ? programs : [programs];
	const mod = new ModuleEmitter(checker, lowerResult, progs, {
		bundledPackages: options.bundledPackages,
	});

	// 1. Collect all functions, methods, and package-level globals
	const funcDecls = [];
	for (const p of progs) {
		const pkgName = p.pkg?.name ?? "main";
		const pkgTarget = p.target ?? "wasm";
		for (const d of p.decls ?? []) {
			if (d.kind === "FuncDecl") {
				d._pkgName = pkgName;
				d._pkgTarget = pkgTarget;
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
				_funcLit: node,
				_rootFuncDecl: rootFn,
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

	const pendingInits = _collectPackageGlobals(progs, mod, checker);
	_collectPackageConsts(progs, mod);
	const globalInitFn =
		pendingInits.length > 0 ? _makeGlobalInitFunc(pendingInits) : null;
	if (globalInitFn) funcDecls.push(globalInitFn);

	// 1d. Boundary metadata (exported surface of wasm packages)
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

		// Export if public (capitalized) or main
		if (
			!fn._isGlobalInit &&
			(options.exportAll ||
				fn.name === "main" ||
				(fn.name[0] >= "A" && fn.name[0] <= "Z") ||
				(fn._isMethod && fn._methodName[0] >= "A" && fn._methodName[0] <= "Z"))
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
	}

	// 4. Emit function bodies
	for (const fn of funcDecls) {
		const emitter = new FunctionEmitter(mod, fn, fn._globalFuncIndex);
		if (fn.body) {
			emitter.emitFunctionBody(fn.body);
		}
		// If last instruction is not return, auto-emit return or unreachable
		const body = emitter.body;
		if (body.length === 0 || body[body.length - 1].op !== "return") {
			if (emitter.returnTypes.length === 0) {
				body.push({ op: "return" });
			} else {
				body.push({ op: "unreachable" });
			}
		}

		mod.funcs.push({
			typeIndex: fn._typeIndex,
			locals: emitter.localTypes,
			body,
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
		funcs: mod.funcs,
		exports: mod.exports,
		start: globalInitFn ? globalInitFn._globalFuncIndex : null,
	};

	const wasmBytes = encodeModule(moduleIR);
	const watText = options.emitWat ? emitWat(moduleIR) : null;

	return {
		wasm: wasmBytes,
		wat: watText,
		stringTable: mod.stringTable,
		moduleIR,
		facade,
	};
}

// Package-level `const` declarations with literal values (iota is already
// substituted by the parser). Non-literal constant expressions are not
// supported by the wasm backend yet.
function _collectPackageConsts(progs, mod) {
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind !== "ConstDecl") continue;
			for (const spec of d.decls ?? []) {
				for (let i = 0; i < spec.names.length; i++) {
					let lit = spec.value?.[i];
					if (
						lit?.kind === "UnaryExpr" &&
						lit.op === "-" &&
						lit.operand?.kind === "BasicLit"
					) {
						lit = { ...lit.operand, value: `-${lit.operand.value}` };
					}
					if (lit?.kind === "BasicLit") mod.constCache.set(spec.names[i], lit);
					else if (lit) mod.nonLiteralConsts.add(spec.names[i]);
				}
			}
		}
	}
}

function _scanImportsInBody(node, mod) {
	if (!node || typeof node !== "object") return;

	if (node.kind === "CallExpr") {
		const { func, args } = node;
		if (
			func.kind === "Ident" &&
			(func.name === "print" || func.name === "println")
		) {
			const isPrintln = func.name === "println";
			if (args.length === 0 && isPrintln) {
				mod.getPrintlnEmptyIndex();
			}
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				const isLast = i === args.length - 1 && isPrintln;
				const isBool =
					arg._type?.name === "bool" ||
					(arg.kind === "BasicLit" && arg.litKind === "BOOL");
				const wType = toWasmType(arg._type, mod.checker);
				mod.getLogImportIndex(wType, isLast, isBool);
			}
		} else if (
			func.kind === "SelectorExpr" &&
			func.expr?.name === "math" &&
			func.field
		) {
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
			if (jsMathMap[func.field]) {
				const isBinary = func.field === "Atan2" || func.field === "Pow";
				mod.getMathImportIndex(jsMathMap[func.field], isBinary);
			}
		} else if (
			func.kind === "SelectorExpr" &&
			isTestingT(func.expr?._type) &&
			func.field
		) {
			mod.internString(func.field);
			if (func.field === "Name") mod.getTestingNameImportIndex();
			else if (func.field === "Failed" || func.field === "Skipped")
				mod.getTestingFlagImportIndex();
			else if (func.field !== "Run") {
				mod.getTestingCallImportIndex();
				for (const arg of args) {
					mod.getTestingArgImportIndex(
						toWasmType(arg._type, mod.checker),
						arg._type?.name === "bool" ||
							(arg.kind === "BasicLit" && arg.litKind === "BOOL"),
					);
				}
			}
		}
	}

	if (node.kind === "BasicLit" && node.litKind === "STRING") {
		mod.getStringImportIndex();
		const strVal = String(node.value ?? "");
		mod.internString(strVal);
	}

	// Recurse child properties
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		const child = node[key];
		if (Array.isArray(child)) {
			for (const item of child) _scanImportsInBody(item, mod);
		} else if (child && typeof child === "object") {
			_scanImportsInBody(child, mod);
		}
	}
}

export function compileWasm(source, options = {}) {
	const filename = options.filename ?? "main.go";
	const tokens = new Lexer(source, filename).tokenize();
	const ast = new Parser(tokens, filename, source).parse();

	const checker = new TypeChecker();
	checker.target = "wasm";
	checker.pkgName = ast.pkg?.name ?? "main";

	const errors = checker.check(ast);
	if (errors.length > 0) {
		return { wasm: null, errors };
	}

	const lowerRes = lower([ast], checker);
	const res = compileWasmModule([ast], checker, lowerRes, {
		...options,
		exportAll: options.exportAll ?? true,
	});

	return { ...res, errors: [] };
}

function _collectPackageGlobals(progs, mod, checker) {
	const pending = []; // non-constant initializers, run by the start function
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind !== "VarDecl") continue;
			for (const spec of d.decls ?? d.specs ?? [d]) {
				const names = spec.names ?? (spec.name ? [spec.name] : []);
				const values = spec.value ?? (spec.init ? [spec.init] : []);
				for (let i = 0; i < names.length; i++) {
					const name = names[i];
					const rawType = spec.type ?? values[i]?._type;
					const wType = toWasmType(rawType, checker, mod);
					const gIdx = mod.globals.length;
					let initInsts = [{ op: `${wType}.const`, value: 0 }];
					if (wType === "i64") initInsts = [{ op: "i64.const", value: 0n }];
					else if (wType === "f32" || wType === "f64")
						initInsts = [{ op: `${wType}.const`, value: 0.0 }];
					else if (
						wType === "externref" ||
						wType === "anyref" ||
						typeof wType === "object"
					) {
						if (
							typeof wType === "object" &&
							typeof wType.typeIndex === "number" &&
							rawType?.kind !== "pointer"
						) {
							const structInfo = Array.from(mod.structTypes.values()).find(
								(s) => s.typeIndex === wType.typeIndex,
							);
							if (structInfo) {
								initInsts = [];
								for (const f of structInfo.fields) {
									if (f.wType === "i64")
										initInsts.push({ op: "i64.const", value: 0n });
									else if (f.wType === "f32" || f.wType === "f64")
										initInsts.push({ op: `${f.wType}.const`, value: 0.0 });
									else if (typeof f.wType === "object")
										initInsts.push({
											op: "ref.null",
											heapType: f.wType.typeIndex ?? "any",
										});
									else initInsts.push({ op: "i32.const", value: 0 });
								}
								initInsts.push({
									op: "struct.new",
									typeIndex: structInfo.typeIndex,
								});
							} else {
								initInsts = [
									{ op: "ref.null", heapType: wType.typeIndex ?? "any" },
								];
							}
						} else {
							initInsts = [
								{
									op: "ref.null",
									heapType:
										typeof wType === "object"
											? (wType.heapType ?? wType.typeIndex ?? "any")
											: wType.replace("ref", ""),
								},
							];
						}
					}

					let litNode = values?.[i];
					let sign = 1;
					if (
						litNode &&
						litNode.kind === "UnaryExpr" &&
						litNode.op === "-" &&
						litNode.operand?.kind === "BasicLit"
					) {
						litNode = litNode.operand;
						sign = -1;
					}

					let isConstInit = false;
					if (litNode && litNode.kind === "BasicLit") {
						if (litNode.litKind === "INT") {
							isConstInit = true;
							initInsts = [
								wType === "i64"
									? {
											op: "i64.const",
											value: BigInt(sign) * BigInt(litNode.value),
										}
									: {
											op: "i32.const",
											value: (sign * Number(litNode.value)) | 0,
										},
							];
						} else if (litNode.litKind === "FLOAT") {
							isConstInit = true;
							initInsts = [
								{
									op: `${wType}.const`,
									value: sign * Number(litNode.value),
								},
							];
						} else if (litNode.litKind === "BOOL") {
							isConstInit = true;
							initInsts = [
								{
									op: "i32.const",
									value: litNode.value === "true" ? 1 : 0,
								},
							];
						}
					}
					if (values[i] && !isConstInit && names.length === values.length) {
						pending.push({ name, expr: values[i] });
					}
					mod.globals.push({
						type: wType,
						mutable: true,
						init: initInsts,
					});
					mod.globalCache.set(name, {
						index: gIdx,
						type: wType,
						goType: rawType,
					});
				}
			}
		}
	}
	return pending;
}

// Synthesises `__init_globals()` assigning every non-constant package-level
// initializer in declaration order; registered as the module start function.
function _makeGlobalInitFunc(pending) {
	const stmts = pending.map(({ name, expr }) => ({
		kind: "AssignStmt",
		lhs: [{ kind: "Ident", name, _type: expr._type }],
		op: "=",
		rhs: [expr],
	}));
	stmts.push({ kind: "ReturnStmt", values: [] });
	return {
		kind: "FuncDecl",
		name: "__init_globals",
		params: [],
		returnType: null,
		body: { kind: "Block", stmts, list: stmts },
		_isGlobalInit: true,
	};
}
