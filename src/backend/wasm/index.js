// src/backend/wasm/index.js
// WASM Backend compiler entry point: lowered AST + types -> Module IR -> binary / WAT.

import { Lexer } from "../../lexer.js";
import { lower } from "../../lower/index.js";
import { Parser } from "../../parser/index.js";
import { TypeChecker } from "../../typechecker/index.js";
import { FunctionEmitter } from "./emit.js";
import { encodeModule } from "./encode.js";
import { toWasmType } from "./types.js";
import { emitWat } from "./wat.js";

export class ModuleEmitter {
	constructor(checker, lowerResult = null) {
		this.checker = checker;
		this.lowerResult = lowerResult;

		this.types = []; // type entries
		this.typeCache = new Map(); // signature string -> index

		this.imports = []; // import entries
		this.importCache = new Map(); // key -> func index

		this.tags = []; // exception tags
		this.globals = []; // global entries
		this.globalCache = new Map(); // name -> index

		this.funcs = []; // internal func definitions
		this.funcMap = new Map(); // name -> global func index
		this.funcParamTypes = new Map(); // name -> param types array

		this.exports = []; // export entries
		this.stringTable = []; // string literals
		this.stringCache = new Map();

		this._initPanicTag();
		this.getStringImportIndex(); // Pre-register env.str at index 0
	}

	_initPanicTag() {
		// Type 0: (externref) -> ()
		const typeIdx = this.getTypeIndex(["externref"], []);
		// Tag 0
		this.tags.push({ typeIndex: typeIdx });
		// Export tag 0 as "panicTag"
		this.exports.push({ name: "panicTag", kind: "tag", index: 0 });
	}

	getTypeIndex(params, results) {
		const key = `${params.join(",")}=>${results.join(",")}`;
		if (this.typeCache.has(key)) {
			return this.typeCache.get(key);
		}
		const idx = this.types.length;
		this.types.push({ form: "func", params, results });
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

	getPrintlnEmptyIndex() {
		return this.getOrAddFuncImport("env", "println_empty", [], []);
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
			default:
				return this.getOrAddFuncImport("env", `${prefix}_i32`, ["i32"], []);
		}
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

	resolveGlobal(name) {
		return this.globalCache.get(name) ?? null;
	}
}

export function compileWasmModule(
	programs,
	checker,
	lowerResult = null,
	options = {},
) {
	const progs = Array.isArray(programs) ? programs : [programs];
	const mod = new ModuleEmitter(checker, lowerResult);

	// 1. Collect all functions and package-level globals
	const funcDecls = [];
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind === "FuncDecl") {
				funcDecls.push(d);
			}
		}
	}
	_collectPackageGlobals(progs, mod, checker);

	// 2. Pre-scan for needed imports so import func indices are fixed
	for (const fn of funcDecls) {
		_scanImportsInBody(fn.body, mod);
	}

	const importFuncCount = mod.imports.filter((i) => i.kind === "func").length;

	// 3. Register all internal functions and their type signatures
	for (let i = 0; i < funcDecls.length; i++) {
		const fn = funcDecls[i];
		const globalIdx = importFuncCount + i;
		mod.funcMap.set(fn.name, globalIdx);

		const paramTypes = (fn.params ?? []).map((p) =>
			toWasmType(p.type, checker),
		);
		mod.funcParamTypes.set(fn.name, paramTypes);
		const returnTypes = [];
		if (fn.returnType) {
			if (fn.returnType.kind === "TupleType") {
				for (const t of fn.returnType.types) {
					const wt = toWasmType(t, checker);
					if (wt) returnTypes.push(wt);
				}
			} else {
				const wt = toWasmType(fn.returnType, checker);
				if (wt) returnTypes.push(wt);
			}
		}

		const typeIndex = mod.getTypeIndex(paramTypes, returnTypes);
		fn._typeIndex = typeIndex;
		fn._globalFuncIndex = globalIdx;

		// Export if public (capitalized) or main
		if (
			options.exportAll ||
			fn.name === "main" ||
			(fn.name[0] >= "A" && fn.name[0] <= "Z")
		) {
			mod.exports.push({ name: fn.name, kind: "func", index: globalIdx });
		}
	}

	// 4. Emit function bodies
	for (const fn of funcDecls) {
		const emitter = new FunctionEmitter(mod, fn, fn._globalFuncIndex);
		if (fn.body) {
			emitter.emitBlock(fn.body);
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

	const moduleIR = {
		types: mod.types,
		imports: mod.imports,
		tags: mod.tags,
		globals: mod.globals,
		funcs: mod.funcs,
		exports: mod.exports,
	};

	const wasmBytes = encodeModule(moduleIR);
	const watText = options.emitWat ? emitWat(moduleIR) : null;

	return {
		wasm: wasmBytes,
		wat: watText,
		stringTable: mod.stringTable,
		moduleIR,
	};
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
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind !== "VarDecl") continue;
			for (const spec of d.decls ?? d.specs ?? [d]) {
				const names = spec.names ?? (spec.name ? [spec.name] : []);
				const values = spec.value ?? (spec.init ? [spec.init] : []);
				for (let i = 0; i < names.length; i++) {
					const name = names[i];
					const rawType = spec.type ?? values[i]?._type;
					const wType = toWasmType(rawType, checker);
					const gIdx = mod.globals.length;
					let initInst = { op: `${wType}.const`, value: 0 };
					if (wType === "i64") initInst = { op: "i64.const", value: 0n };
					else if (wType === "f32" || wType === "f64")
						initInst = { op: `${wType}.const`, value: 0.0 };
					else if (
						wType === "externref" ||
						wType === "anyref" ||
						typeof wType === "object"
					) {
						initInst = {
							op: "ref.null",
							heapType:
								typeof wType === "object"
									? (wType.heapType ?? "any")
									: wType.replace("ref", ""),
						};
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

					if (litNode && litNode.kind === "BasicLit") {
						if (litNode.litKind === "INT") {
							initInst =
								wType === "i64"
									? {
											op: "i64.const",
											value: BigInt(sign) * BigInt(litNode.value),
										}
									: {
											op: "i32.const",
											value: (sign * Number(litNode.value)) | 0,
										};
						} else if (litNode.litKind === "FLOAT") {
							initInst = {
								op: `${wType}.const`,
								value: sign * Number(litNode.value),
							};
						} else if (litNode.litKind === "BOOL") {
							initInst = {
								op: "i32.const",
								value: litNode.value === "true" ? 1 : 0,
							};
						}
					}
					mod.globals.push({
						type: wType,
						mutable: true,
						init: [initInst],
					});
					mod.globalCache.set(name, { index: gIdx, type: wType });
				}
			}
		}
	}
}
