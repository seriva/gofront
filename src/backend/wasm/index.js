// src/backend/wasm/index.js
// WASM Backend compiler entry point: lowered AST + types -> Module IR -> binary / WAT.

import { Lexer } from "../../lexer.js";
import { lower, lowerFunction } from "../../lower/index.js";
import {
	getOrCreateIteratorFuncLit,
	isIteratorRangeFor,
} from "../../lower/range.js";
import { Parser } from "../../parser/index.js";
import { foldConstExpr } from "../../typechecker/const-fold.js";
import { TypeChecker } from "../../typechecker/index.js";
import {
	addBoundaryHelpers,
	collectBoundaryMeta,
	generateFacade,
	scanBoundaryImports,
	wTypeKey,
} from "./boundary.js";
import { FunctionEmitter } from "./emit.js";
import { encodeModule, isGoFrontWasm } from "./encode.js";
import { desugarMethodExprs } from "./method-expr.js";
import { hasGenerics, monomorphise } from "./monomorph.js";
import { hasNativeWasmOpt, optimizeWasm } from "./optimize.js";
import { BINARY_MATH_IMPORTS } from "./stdlib/index.js";
import {
	anonIfaceName,
	ERROR_STRUCT,
	getFuncSignature,
	getInterfaceMethodList,
	getMapKeyValTypes,
	getReceiverTypeName,
	goTypeKey,
	isAnyType,
	isArrayType,
	isInterfaceType,
	isMapType,
	isNonEmptyInterface,
	isScalarType,
	isSliceType,
	isStructType,
	isTestingT,
	toWasmType,
	variadicAsSlice,
} from "./types.js";
import { desugarVariadics } from "./variadic.js";
import { emitWat } from "./wat.js";

export { hasNativeWasmOpt, isGoFrontWasm, optimizeWasm };

const ERROR_PRODUCING_PKGS = new Set([
	"errors",
	"fmt",
	"strconv",
	"path",
	"path/filepath",
	"io",
	"strings",
	"bytes",
	"time",
	"sync",
	"crypto/rand",
	"rand",
	"crypto/sha256",
	"sha256",
	"encoding/binary",
	"binary",
	"encoding/hex",
	"hex",
	"encoding/base64",
	"base64",
]);
// Packages whose calls lower to the `env.*` imports in STDLIB_IMPORTS (the
// matching JS lives in WASM_STDLIB_JS).  Only modules importing one of them
// declare the imports and ship that JS block.
const STDLIB_ENV_PKGS = new Set([
	"strings",
	"strconv",
	"unicode/utf8",
	"fmt",
	"testing",
	"unicode",
	"math/rand",
	"path",
	"path/filepath",
	"html",
	"bytes",
	"io",
	"time",
	"sync",
	"crypto/rand",
	"rand",
	"crypto/sha256",
	"sha256",
	"encoding/binary",
	"binary",
	"encoding/hex",
	"hex",
	"encoding/base64",
	"base64",
]);

function importsAnyOf(programs, pkgs) {
	const has = (p) => (pkgs instanceof Set ? pkgs.has(p) : pkgs.includes(p));
	return (programs ?? []).some((p) =>
		(p.imports ?? []).some((decl) =>
			(decl.imports ?? [decl]).some((imp) => has(imp.path)),
		),
	);
}

function hasErrorUsage(programs) {
	return (programs ?? []).some((p) => {
		let found = false;
		const scan = (n) => {
			if (!n || found || typeof n !== "object") return;
			if (Array.isArray(n)) {
				for (const x of n) scan(x);
				return;
			}
			if (
				(n.kind === "Ident" ||
					n.kind === "TypeName" ||
					n.kind === "basic" ||
					n.kind === "interface") &&
				n.name === "error"
			) {
				found = true;
				return;
			}
			for (const k of Object.keys(n)) {
				if (!k.startsWith("_")) scan(n[k]);
			}
		};
		scan(p);
		return found;
	});
}

// [name, params, results] for `env.*` imports backing stdlib calls; the JS
// side lives in WASM_STDLIB_JS (boundary.js).  All are registered eagerly
// (when any STDLIB_ENV_PKGS package is imported) because the import table is
// locked before function bodies are emitted.
const S = "externref";
const STDLIB_IMPORTS = [
	// strings
	["str_trim", [S, S], [S]],
	["str_trim_left", [S, S], [S]],
	["str_trim_right", [S, S], [S]],
	["str_trim_prefix", [S, S], [S]],
	["str_trim_suffix", [S, S], [S]],
	["str_cut", [S, S], ["i32"]],
	["str_cut_before", [], [S]],
	["str_cut_after", [], [S]],
	["str_cut_prefix", [S, S], ["i32"]],
	["str_cut_suffix", [S, S], ["i32"]],
	["str_replace", [S, S, S, "i32"], [S]],
	["str_contains_rune", [S, "i32"], ["i32"]],
	["str_contains_any", [S, S], ["i32"]],
	["str_index_byte", [S, "i32"], ["i32"]],
	["str_index_rune", [S, "i32"], ["i32"]],
	["str_index_any", [S, S], ["i32"]],
	["str_last_index_byte", [S, "i32"], ["i32"]],
	["str_last_index_any", [S, S], ["i32"]],
	["str_title", [S], [S]],
	["str_split", [S, S], ["i32"]],
	["str_split_n", [S, S, "i32"], ["i32"]],
	["str_split_after", [S, S], ["i32"]],
	["str_split_after_n", [S, S, "i32"], ["i32"]],
	["str_fields", [S], ["i32"]],
	["str_part", ["i32"], [S]],
	["str_replacer_init", [S], []],
	["str_replacer_add", [S, S], []],
	["str_replacer_run", [], [S]],
	// strconv
	["strconv_atoi", [S], ["i64"]],
	["strconv_parse_int", [S, "i32", "i32"], ["i64"]],
	["strconv_parse_float", [S], ["f64"]],
	["strconv_parse_bool", [S], ["i32"]],
	["strconv_err", [], [S]],
	["strconv_err_kind", [], ["i32"]],
	["strconv_format_float", ["f64", "i32", "i32", "i32"], [S]],
	["strconv_format_int", ["i64", "i32"], [S]],
	["strconv_format_uint", ["i64", "i32"], [S]],
	["strconv_parse_uint", [S, "i32", "i32"], ["i64"]],
	["strconv_quote", [S], [S]],
	["strconv_unquote", [S], [S]],
	// unicode/utf8
	["utf8_rune_count", [S], ["i32"]],
	["utf8_rune_len", ["i32"], ["i32"]],
	["utf8_valid_string", [S], ["i32"]],
	["utf8_decode_rune", [S, "i32"], ["i32"]],
	["utf8_decode_size", [], ["i32"]],
	["utf8_full_rune", [S], ["i32"]],
	// fmt (arguments travel through the testing_arg_* buffer)
	["fmt_sprintf", [S], [S]],
	["fmt_printf", [S], []],
	["fmt_sprint", ["i32"], [S]],
	["fmt_print", ["i32"], []],
	["fmt_format_v", [S], [S]],
	["fmt_sscan_init", [S, "i32"], ["i32"]],
	["fmt_sscanf_init", [S, S], ["i32"]],
	["fmt_sscan_has_err", [], ["i32"]],
	["fmt_sscan_err_msg", [], [S]],
	["fmt_sscan_token_str", ["i32"], [S]],
	["fmt_sscan_token_i64", ["i32"], ["i64"]],
	["fmt_sscan_token_f64", ["i32"], ["f64"]],
	["fmt_sscan_token_bool", ["i32"], ["i32"]],
	// testing.T.Run: the harness calls back into the exported __testing_run_cb
	["testing_run", [S, S, "anyref"], ["i32"]],
	// unicode
	["unicode_is_letter", ["i32"], ["i32"]],
	["unicode_is_digit", ["i32"], ["i32"]],
	["unicode_is_space", ["i32"], ["i32"]],
	["unicode_is_upper", ["i32"], ["i32"]],
	["unicode_is_lower", ["i32"], ["i32"]],
	["unicode_is_punct", ["i32"], ["i32"]],
	["unicode_is_control", ["i32"], ["i32"]],
	["unicode_is_print", ["i32"], ["i32"]],
	["unicode_is_graphic", ["i32"], ["i32"]],
	["unicode_to_upper", ["i32"], ["i32"]],
	["unicode_to_lower", ["i32"], ["i32"]],
	// html
	["html_escape", [S], [S]],
	["html_unescape", [S], [S]],
	// path
	["path_base", [S], [S]],
	["path_dir", [S], [S]],
	["path_ext", [S], [S]],
	["path_is_abs", [S], ["i32"]],
	["path_clean", [S], [S]],
	["path_split", [S], []],
	["path_split_dir", [], [S]],
	["path_split_file", [], [S]],
	["path_join_init", [], []],
	["path_join_push", [S], []],
	["path_join_run", [], [S]],
	["path_match", [S, S], ["i32"]],
	["path_match_has_err", [], ["i32"]],
	["bytes_trim", [S, S, "i32", "i32"], []],
	["bytes_trim_start", [], ["i32"]],
	["bytes_trim_end", [], ["i32"]],
	// time
	["time_now_ms", [], ["f64"]],
	["time_timezone_offset", ["f64"], ["i32"]],
	["time_parse", [S, S], ["f64"]],
	["time_parse_err", [], [S]],
	["time_parse_offset", [], ["i32"]],
	[
		"time_format",
		["i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", S],
		[S],
	],
	["time_duration_string", ["i64"], [S]],
	// raw binary buffer for crypto/rand, crypto/sha256, hex, base64
	["raw_bytes_init", ["i32"], []],
	["raw_bytes_push", ["i32"], []],
	["raw_bytes_len", [], ["i32"]],
	["raw_bytes_get", ["i32"], ["i32"]],
	// crypto/rand
	["crypto_rand_fill", ["i32"], ["i32"]],
	// crypto/sha256
	["crypto_sha256_sum", [], ["i32"]],
	// encoding/hex
	["hex_encode_to_string", [], [S]],
	["hex_decode_string", [S], ["i32"]],
	["hex_get_err", [], [S]],
	// encoding/base64
	["base64_encode_to_string", ["i32"], [S]],
	["base64_decode_string", ["i32", S], ["i32"]],
	["base64_get_err", [], [S]],
];

class ModuleEmitter {
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
		this.complexTypes = new Map(); // key -> complex struct info
		this.ptrTypes = new Map(); // key -> ptr supertype info
		this.boxTypes = new Map(); // wType key -> box info
		this.accTypes = new Map(); // key -> acc info
		this.structAccessorHelpers = new Map(); // key -> helper info
		this.elemAccessorHelpers = new Map(); // key -> helper info
		this.ifaceBoxTypes = new Map(); // key -> iface box info
		this.arrayTypes = new Map(); // wType key -> array info
		this.sliceTypes = new Map(); // wType key -> slice info
		this.sliceTypesByIndex = new Map(); // typeIndex -> slice info
		this.mapTypes = new Map(); // wType key -> map info
		this.mapTypesByIndex = new Map(); // typeIndex -> map info
		this.mapBucketsType = null; // shared (array (mut i32))
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
		this.funcReturnTypesByIdx = new Map(); // global func index -> result wasm types

		this.exports = []; // export entries
		this.stringTable = []; // string literals
		this.stringCache = new Map();

		// `errors.New` / `fmt.Errorf` / strconv parse failures allocate the
		// runtime's own error struct; it joins the struct rec group so the
		// `error.Error` dispatcher can `ref.test` it like any user type.
		this.hasErrorType =
			importsAnyOf(programs, ERROR_PRODUCING_PKGS) || hasErrorUsage(programs);
		this.usesStdlibEnv = importsAnyOf(programs, STDLIB_ENV_PKGS);

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

		if (this.hasErrorType) {
			seen.add(ERROR_STRUCT);
			rawStructs.push({
				name: ERROR_STRUCT,
				structType: {
					kind: "struct",
					fields: new Map([
						["msg", { kind: "basic", name: "string" }],
						["cause", { kind: "basic", name: "any" }],
					]),
				},
			});
		}

		for (const p of progs) {
			for (const d of p.decls ?? []) {
				if (
					d.kind === "TypeDecl" &&
					!d.isAlias &&
					d.type?.kind === "StructType"
				) {
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
			const resolvedStruct =
				s.structType ?? this.checker?.types?.get(s.name)?.underlying;

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

	getAnonStructType(fields) {
		const key = fields.map((f) => `${f.name}:${goTypeKey(f.goType)}`).join(";");
		const name = `__anon_${key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
		if (this.structTypes.has(name)) {
			return this.structTypes.get(name);
		}
		const fieldWTypes = fields.map((f) =>
			toWasmType(f.goType, this.checker, this),
		);
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			fields: fieldWTypes.map((t) => ({ type: t, mutable: true })),
		};
		this._pushType(typeEntry);
		const info = {
			name,
			typeIndex,
			typeEntry,
			fields: fields.map((f, i) => ({
				name: f.name,
				wType: fieldWTypes[i],
				goType: f.goType,
				fieldIndex: i,
			})),
			fieldIndexMap: new Map(fields.map((f, i) => [f.name, i])),
			embeds: [],
			pkgName: null,
			pkgTarget: "wasm",
			isAnon: true,
		};
		this.structTypes.set(name, info);
		return info;
	}

	getComplexType(name = "complex128") {
		const key = name === "complex64" ? "complex64" : "complex128";
		if (this.complexTypes.has(key)) {
			return this.complexTypes.get(key);
		}
		const isF32 = key === "complex64";
		const elemWType = isF32 ? "f32" : "f64";
		const elemGoType = { kind: "basic", name: isF32 ? "float32" : "float64" };
		const typeName = `$${key}`;
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			name: typeName,
			fields: [
				{ type: elemWType, mutable: false },
				{ type: elemWType, mutable: false },
			],
		};
		this._pushType(typeEntry);
		const fields = [
			{ name: "re", fieldIndex: 0, wType: elemWType, goType: elemGoType },
			{ name: "im", fieldIndex: 1, wType: elemWType, goType: elemGoType },
		];
		const info = {
			name: typeName,
			typeIndex,
			typeEntry,
			fields,
			fieldIndexMap: new Map([
				["re", 0],
				["im", 1],
			]),
			embeds: [],
			pkgName: null,
			pkgTarget: "wasm",
			isComplex: true,
			elemWType,
			elemGoType,
		};
		this.complexTypes.set(key, info);
		this.structTypes.set(key, info);
		this.structTypes.set(typeName, info);
		return info;
	}

	getPtrType(goType) {
		const key = goTypeKey(goType);
		if (this.ptrTypes.has(key)) {
			return this.ptrTypes.get(key);
		}
		const typeIndex = this._getTotalTypeCount();
		const name = `$ptr_${key}`;
		const typeEntry = {
			form: "struct",
			name,
			sub: true,
			fields: [],
		};
		this._pushType(typeEntry);
		const ptrInfo = { key, name, typeIndex, typeEntry, goType };
		this.ptrTypes.set(key, ptrInfo);
		return ptrInfo;
	}

	getBoxType(goType) {
		const key = goTypeKey(goType);
		if (this.boxTypes.has(key)) {
			return this.boxTypes.get(key);
		}
		const ptrInfo = this.getPtrType(goType);
		const wType = toWasmType(goType, this.checker, this);
		const typeIndex = this._getTotalTypeCount();
		const name = `$box_${key}`;
		const typeEntry = {
			form: "struct",
			name,
			sub: true,
			superType: ptrInfo.name,
			superTypeIndex: ptrInfo.typeIndex,
			fields: [{ type: wType, mutable: true }],
		};
		this._pushType(typeEntry);
		const boxInfo = {
			key,
			name,
			typeIndex,
			typeEntry,
			ptrType: ptrInfo,
			ptrTypeIndex: ptrInfo.typeIndex,
			wType,
			goType,
		};
		this.boxTypes.set(key, boxInfo);
		return boxInfo;
	}

	getAccType(goType) {
		const key = goTypeKey(goType);
		if (this.accTypes.has(key)) {
			return this.accTypes.get(key);
		}
		const ptrInfo = this.getPtrType(goType);
		const wType = toWasmType(goType, this.checker, this);
		const getFuncTypeIndex = this.getTypeIndex(["anyref", "i32"], [wType]);
		const setFuncTypeIndex = this.getTypeIndex(["anyref", "i32", wType], []);

		const typeIndex = this._getTotalTypeCount();
		const name = `$acc_${key}`;
		const typeEntry = {
			form: "struct",
			name,
			sub: true,
			superType: ptrInfo.name,
			superTypeIndex: ptrInfo.typeIndex,
			fields: [
				{ type: "anyref", mutable: false },
				{ type: "i32", mutable: false },
				{
					type: {
						kind: "ref",
						nullable: false,
						typeIndex: getFuncTypeIndex,
					},
					mutable: false,
				},
				{
					type: {
						kind: "ref",
						nullable: false,
						typeIndex: setFuncTypeIndex,
					},
					mutable: false,
				},
			],
		};
		this._pushType(typeEntry);
		const accInfo = {
			key,
			name,
			typeIndex,
			typeEntry,
			ptrType: ptrInfo,
			ptrTypeIndex: ptrInfo.typeIndex,
			getFuncTypeIndex,
			setFuncTypeIndex,
			wType,
			goType,
		};
		this.accTypes.set(key, accInfo);
		return accInfo;
	}

	getStructAccessorHelpers(structInfo, fieldIndex) {
		const field = structInfo.fields[fieldIndex];
		const key = `${structInfo.name}.${field.name}`;
		if (this.structAccessorHelpers.has(key)) {
			return this.structAccessorHelpers.get(key);
		}
		const fieldGoType = field.goType;
		const accInfo = this.getAccType(fieldGoType);
		const safeStructName = structInfo.name.replace(/[^a-zA-Z0-9_]/g, "_");
		const getterName = `__gf_acc_get_${safeStructName}_${field.name}`;
		const setterName = `__gf_acc_set_${safeStructName}_${field.name}`;
		const getterFn = {
			kind: "FuncDecl",
			name: getterName,
			params: [
				{ name: "target", type: "anyref" },
				{ name: "index", type: "i32" },
			],
			returnType: fieldGoType,
			body: { kind: "Block", stmts: [], list: [] },
			_isAccessorHelper: true,
			_accessorKind: "struct_get",
			_structInfo: structInfo,
			_fieldIndex: fieldIndex,
			_fieldType: fieldGoType,
			_rootFuncDecl: null,
		};
		const setterFn = {
			kind: "FuncDecl",
			name: setterName,
			params: [
				{ name: "target", type: "anyref" },
				{ name: "index", type: "i32" },
				{ name: "val", type: fieldGoType },
			],
			returnType: null,
			body: { kind: "Block", stmts: [], list: [] },
			_isAccessorHelper: true,
			_accessorKind: "struct_set",
			_structInfo: structInfo,
			_fieldIndex: fieldIndex,
			_fieldType: fieldGoType,
			_rootFuncDecl: null,
		};
		const helperInfo = {
			key,
			getterName,
			setterName,
			getterFn,
			setterFn,
			accInfo,
			structInfo,
			fieldIndex,
			fieldGoType,
		};
		this.structAccessorHelpers.set(key, helperInfo);
		return helperInfo;
	}

	getElemAccessorHelpers(elemGoType) {
		const key = goTypeKey(elemGoType);
		if (this.elemAccessorHelpers.has(key)) {
			return this.elemAccessorHelpers.get(key);
		}
		const arrInfo = this.getArrayType(elemGoType);
		const accInfo = this.getAccType(elemGoType);
		const getterName = `__gf_acc_get_elem_${key}`;
		const setterName = `__gf_acc_set_elem_${key}`;
		const getterFn = {
			kind: "FuncDecl",
			name: getterName,
			params: [
				{ name: "target", type: "anyref" },
				{ name: "index", type: "i32" },
			],
			returnType: elemGoType,
			body: { kind: "Block", stmts: [], list: [] },
			_isAccessorHelper: true,
			_accessorKind: "elem_get",
			_arrInfo: arrInfo,
			_elemGoType: elemGoType,
			_rootFuncDecl: null,
		};
		const setterFn = {
			kind: "FuncDecl",
			name: setterName,
			params: [
				{ name: "target", type: "anyref" },
				{ name: "index", type: "i32" },
				{ name: "val", type: elemGoType },
			],
			returnType: null,
			body: { kind: "Block", stmts: [], list: [] },
			_isAccessorHelper: true,
			_accessorKind: "elem_set",
			_arrInfo: arrInfo,
			_elemGoType: elemGoType,
			_rootFuncDecl: null,
		};
		const helperInfo = {
			key,
			getterName,
			setterName,
			getterFn,
			setterFn,
			arrInfo,
			accInfo,
			elemGoType,
		};
		this.elemAccessorHelpers.set(key, helperInfo);
		return helperInfo;
	}

	getIfaceBoxType(goType) {
		const key = goTypeKey(goType);
		if (this.ifaceBoxTypes.has(key)) {
			return this.ifaceBoxTypes.get(key);
		}
		const wType = toWasmType(goType, this.checker, this);
		const tagIndex = this.ifaceBoxTypes.size;
		const tagTypeIndex = this._getTotalTypeCount();
		const tagFields = [];
		for (let i = 0; i < tagIndex; i++) {
			tagFields.push({ type: "i32", mutable: false });
		}
		this._pushType({
			form: "struct",
			fields: tagFields,
		});
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			fields: [
				{ type: wType, mutable: true },
				{
					type: {
						kind: "ref",
						nullable: true,
						typeIndex: tagTypeIndex,
					},
					mutable: false,
				},
			],
		};
		this._pushType(typeEntry);
		const boxInfo = { key, typeIndex, typeEntry, wType, goType, tagTypeIndex };
		this.ifaceBoxTypes.set(key, boxInfo);
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
					mutable: false,
				},
				{ type: "i32", mutable: false }, // offset
				{ type: "i32", mutable: false }, // len
				{ type: "i32", mutable: false }, // cap
			],
		};
		this._pushType(typeEntry);

		const emptyGlobalIndex = this.globals.length;
		this.globals.push({
			type: {
				kind: "ref",
				nullable: true,
				typeIndex,
			},
			mutable: false,
			init: [
				{ op: "ref.null", heapType: arrInfo.typeIndex },
				{ op: "i32.const", value: 0 },
				{ op: "i32.const", value: 0 },
				{ op: "i32.const", value: 0 },
				{ op: "struct.new", typeIndex },
			],
		});

		const sliceInfo = {
			typeIndex,
			typeEntry,
			arrInfo,
			elemWType,
			elemGoType,
			emptyGlobalIndex,
		};
		this.sliceTypes.set(key, sliceInfo);
		this.sliceTypesByIndex.set(typeIndex, sliceInfo);
		return sliceInfo;
	}

	getSliceTypeByIndex(typeIndex) {
		return this.sliceTypesByIndex?.get(typeIndex) ?? null;
	}

	getMapType(keyGoType, valGoType) {
		const keyWType = toWasmType(keyGoType, this.checker, this);
		const valWType = toWasmType(valGoType, this.checker, this);
		const key = `${wTypeKey(keyWType)}:${wTypeKey(valWType)}`;
		if (this.mapTypes.has(key)) {
			return this.mapTypes.get(key);
		}

		if (!this.mapBucketsType) {
			const typeIndex = this._getTotalTypeCount();
			this._pushType({
				form: "array",
				elemType: "i32",
				mutable: true,
			});
			this.mapBucketsType = { typeIndex };
		}

		const entryTypeIndex = this._getTotalTypeCount();
		this._pushType({
			form: "struct",
			fields: [
				{ type: keyWType, mutable: true }, // 0: key
				{ type: valWType, mutable: true }, // 1: val
				{ type: "i32", mutable: true }, // 2: next (bucket chain)
				{ type: "i32", mutable: true }, // 3: order_prev (insertion order)
				{ type: "i32", mutable: true }, // 4: order_next (insertion order)
				{ type: "i32", mutable: true }, // 5: active (1 = active, 0 = deleted)
			],
		});

		const entriesTypeIndex = this._getTotalTypeCount();
		this._pushType({
			form: "array",
			elemType: { kind: "ref", nullable: true, typeIndex: entryTypeIndex },
			mutable: true,
		});

		const mapTypeIndex = this._getTotalTypeCount();
		this._pushType({
			form: "struct",
			fields: [
				{
					type: {
						kind: "ref",
						nullable: true,
						typeIndex: this.mapBucketsType.typeIndex,
					},
					mutable: true,
				}, // 0: buckets
				{
					type: {
						kind: "ref",
						nullable: true,
						typeIndex: entriesTypeIndex,
					},
					mutable: true,
				}, // 1: entries
				{ type: "i32", mutable: true }, // 2: len
				{ type: "i32", mutable: true }, // 3: cap
				{ type: "i32", mutable: true }, // 4: count
				{ type: "i32", mutable: true }, // 5: head
				{ type: "i32", mutable: true }, // 6: tail
				{ type: "i32", mutable: true }, // 7: free_head
				{ type: "i32", mutable: true }, // 8: num_buckets
			],
		});

		const suffix = key.replace(/[^a-zA-Z0-9_]/g, "_");
		const mapInfo = {
			key,
			suffix,
			typeIndex: mapTypeIndex,
			entryTypeIndex,
			entriesTypeIndex,
			bucketsTypeIndex: this.mapBucketsType.typeIndex,
			keyWType,
			valWType,
			keyGoType,
			valGoType,
			wType: { kind: "ref", nullable: true, typeIndex: mapTypeIndex },
			makeFuncName: `__map_make_${suffix}`,
			getFuncName: `__map_get_${suffix}`,
			getOkFuncName: `__map_get_ok_${suffix}`,
			setFuncName: `__map_set_${suffix}`,
			deleteFuncName: `__map_delete_${suffix}`,
			lenFuncName: `__map_len_${suffix}`,
			clearFuncName: `__map_clear_${suffix}`,
			keysFuncName: `__map_keys_${suffix}`,
			valuesFuncName: `__map_values_${suffix}`,
			cloneFuncName: `__map_clone_${suffix}`,
		};
		this.mapTypes.set(key, mapInfo);
		this.mapTypesByIndex.set(mapTypeIndex, mapInfo);
		return mapInfo;
	}

	getMapTypeByIndex(typeIndex) {
		return this.mapTypesByIndex?.get(typeIndex) ?? null;
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
		this._initPanicGlobal();
		this.getPanicImportIndex(); // env.panic
		this.internString("runtime error: index out of range");
		this.internString("runtime error: slice bounds out of range");
		this.internString("assignment to entry in nil map");

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
		this.getStringHashImportIndex(); // env.str_hash
		this.getStringToUpperImportIndex();
		this.getStringToLowerImportIndex();
		this.getStringTrimSpaceImportIndex();
		this.getStringContainsImportIndex();
		this.getStringHasPrefixImportIndex();
		this.getStringHasSuffixImportIndex();
		this.getStringIndexImportIndex();
		this.getStringLastIndexImportIndex();
		this.getStringRepeatImportIndex();
		this.getStringReplaceAllImportIndex();
		this.getStringEqualFoldImportIndex();
		this.getStringCountImportIndex();
		this.getStrFromI64ImportIndex();
		this.getStrFromI32ImportIndex();
		this.getStrFromF64ImportIndex();
		this.getIsStringImportIndex(); // env.is_string
		this.getStrToBytesImportIndex();
		this.getStrByteAtImportIndex();
		this.getBytesToStrInitImportIndex();
		this.getBytesToStrPushImportIndex();
		this.getBytesToStrFinishImportIndex();
		this.getTestingCallImportIndex();
		this.getTestingNameImportIndex();
		this.getTestingFlagImportIndex();
		for (const t of ["i32", "i64", "f32", "f64", "externref", "anyref"]) {
			this.getTestingArgImportIndex(t, false);
		}
		this.getTestingArgImportIndex("i32", true);
		this.getTestingArgErrImportIndex();
		this.getTestingArgSpreadImportIndex();
		this.getFmtNewArrayIndex();
		this.getFmtArrayPushIndex();
		this.getFmtNewMapIndex();
		this.getFmtMapSetIndex();
		this.getFmtNewStructIndex();
		this.getFmtStructSetIndex();
		this.getFmtBoxI32Index();
		this.getFmtBoxI64Index();
		this.getFmtBoxF64Index();
		this.getFmtBoxBoolIndex();
		this.getFmtNewBoxIndex();
		this.getFmtNewStringerIndex();
		if (this.usesStdlibEnv) {
			for (const [name, params, results] of STDLIB_IMPORTS) {
				this.getOrAddFuncImport("env", name, params, results);
			}
		}

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
			"cbrt",
		];
		for (const m of unaryMath) {
			this.getMathImportIndex(m, false);
		}
		for (const m of BINARY_MATH_IMPORTS) {
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

	getPanicNodeTypeIndex() {
		if (this.panicNodeTypeIndex !== undefined) {
			return this.panicNodeTypeIndex;
		}
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "rec",
			types: [
				{
					form: "struct",
					fields: [
						{
							type: "anyref",
							mutable: true,
						},
						{
							type: "i32",
							mutable: true,
						},
						{
							type: {
								kind: "ref",
								nullable: true,
								typeIndex,
							},
							mutable: true,
						},
					],
				},
			],
		};
		this._pushType(typeEntry);
		this.panicNodeTypeIndex = typeIndex;
		return typeIndex;
	}

	_initPanicGlobal() {
		const pType = this.getPanicNodeTypeIndex();
		const gIdx = this.globals.length;
		this.globals.push({
			type: { kind: "ref", nullable: true, typeIndex: pType },
			mutable: true,
			init: [{ op: "ref.null", typeIndex: pType }],
		});
		this.panicGlobalIndex = gIdx;
		this.exports.push({ name: "__panic", kind: "global", index: gIdx });
	}

	getPanicGlobalIndex() {
		return this.panicGlobalIndex;
	}

	// `__deferArmed` is set to 1 immediately before a deferred closure is
	// invoked and cleared by that closure's prologue.  recover() only takes
	// effect when the current frame observed the flag, which gives Go's
	// "recover must be called directly by the deferred function" rule.
	getDeferArmedGlobalIndex() {
		if (this.deferArmedGlobalIndex !== undefined) {
			return this.deferArmedGlobalIndex;
		}
		const gIdx = this.globals.length;
		this.globals.push({
			type: "i32",
			mutable: true,
			init: [{ op: "i32.const", value: 0 }],
		});
		this.deferArmedGlobalIndex = gIdx;
		return gIdx;
	}

	getRandStateGlobalIndex() {
		if (this.randStateGlobalIndex !== undefined) {
			return this.randStateGlobalIndex;
		}
		const gIdx = this.globals.length;
		this.globals.push({
			type: "i64",
			mutable: true,
			init: [{ op: "i64.const", value: 1n }],
		});
		this.randStateGlobalIndex = gIdx;
		return gIdx;
	}

	getStrconvErrGlobalIndex(field) {
		if (!this.strconvErrGlobals) this.strconvErrGlobals = new Map();
		if (this.strconvErrGlobals.has(field)) {
			return this.strconvErrGlobals.get(field);
		}
		const gIdx = this.globals.length;
		this.globals.push({
			type: "anyref",
			mutable: true,
			init: [{ op: "ref.null", heapType: "any" }],
		});
		this.strconvErrGlobals.set(field, gIdx);
		return gIdx;
	}

	getPathErrGlobalIndex(field) {
		if (!this.pathErrGlobals) this.pathErrGlobals = new Map();
		if (this.pathErrGlobals.has(field)) {
			return this.pathErrGlobals.get(field);
		}
		const gIdx = this.globals.length;
		this.globals.push({
			type: "anyref",
			mutable: true,
			init: [{ op: "ref.null", heapType: "any" }],
		});
		this.pathErrGlobals.set(field, gIdx);
		return gIdx;
	}

	getIoErrGlobalIndex(field) {
		if (!this.ioErrGlobals) this.ioErrGlobals = new Map();
		if (this.ioErrGlobals.has(field)) {
			return this.ioErrGlobals.get(field);
		}
		const gIdx = this.globals.length;
		this.globals.push({
			type: "anyref",
			mutable: true,
			init: [{ op: "ref.null", heapType: "any" }],
		});
		this.ioErrGlobals.set(field, gIdx);
		return gIdx;
	}

	getIoDiscardGlobalIndex() {
		if (this.ioDiscardGlobalIndex !== undefined) {
			return this.ioDiscardGlobalIndex;
		}
		this.getStructType("io.discard");
		const gIdx = this.globals.length;
		this.globals.push({
			type: "anyref",
			mutable: true,
			init: [{ op: "ref.null", heapType: "any" }],
		});
		this.ioDiscardGlobalIndex = gIdx;
		return gIdx;
	}

	getDeferNodeTypeIndex() {
		if (this.deferNodeTypeIndex !== undefined) {
			return this.deferNodeTypeIndex;
		}
		const deferClosureSig = { kind: "Signature", params: [], results: [] };
		const deferClosureInfo = this.getClosureType(deferClosureSig);
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "rec",
			types: [
				{
					form: "struct",
					fields: [
						{
							type: {
								kind: "ref",
								nullable: true,
								typeIndex: deferClosureInfo.typeIndex,
							},
							mutable: false,
						},
						{
							type: {
								kind: "ref",
								nullable: true,
								typeIndex,
							},
							mutable: true,
						},
					],
				},
			],
		};
		this._pushType(typeEntry);
		this.deferNodeTypeIndex = typeIndex;
		return typeIndex;
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

	getBoundsPanicFuncIndex() {
		return this.resolveFuncIndex("__bounds_panic");
	}

	getIndexPanicFuncIndex() {
		return this.resolveFuncIndex("__index_panic");
	}

	getNilPanicFuncIndex() {
		return this.resolveFuncIndex("__nil_panic");
	}

	// `gofront/shared` buffers are `(base i32, len i32)` views over the single
	// exported linear memory, bump-allocated by `__shared_new` during start.
	getSharedType() {
		if (this.sharedType) return this.sharedType;
		const typeIndex = this._getTotalTypeCount();
		const typeEntry = {
			form: "struct",
			fields: [
				{ type: "i32", mutable: false }, // byte base
				{ type: "i32", mutable: false }, // element count
			],
		};
		this._pushType(typeEntry);
		this.memory = { min: 1 };
		this.exports.push({ name: "memory", kind: "memory", index: 0 });
		const topGlobalIndex = this.globals.length;
		this.globals.push({
			type: "i32",
			mutable: true,
			init: [{ op: "i32.const", value: 0 }],
		});
		const wType = { kind: "ref", nullable: true, typeIndex };
		this.sharedType = { typeIndex, typeEntry, wType, topGlobalIndex };
		return this.sharedType;
	}

	getSliceBoundsPanicFuncIndex() {
		return this.resolveFuncIndex("__slice_bounds_panic");
	}

	getPrintlnEmptyIndex() {
		return this.getOrAddFuncImport("env", "println_empty", [], []);
	}

	getFmtNewArrayIndex() {
		return this.getOrAddFuncImport("env", "fmt_new_array", [], ["externref"]);
	}

	getFmtArrayPushIndex() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_array_push",
			["externref", "externref"],
			[],
		);
	}

	getFmtNewMapIndex() {
		return this.getOrAddFuncImport("env", "fmt_new_map", [], ["externref"]);
	}

	getFmtMapSetIndex() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_map_set",
			["externref", "externref", "externref"],
			[],
		);
	}

	getFmtNewStringerIndex() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_new_stringer",
			["externref", "externref", "i32"],
			["externref"],
		);
	}

	getFmtNewStructIndex() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_new_struct",
			["anyref", "i32"],
			["externref"],
		);
	}

	getFmtStructSetIndex() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_struct_set",
			["externref", "i32", "externref"],
			[],
		);
	}

	getFmtBoxI32Index() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_box_i32",
			["i32"],
			["externref"],
		);
	}

	getFmtBoxI64Index() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_box_i64",
			["i64"],
			["externref"],
		);
	}

	getFmtBoxF64Index() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_box_f64",
			["f64"],
			["externref"],
		);
	}

	getFmtBoxBoolIndex() {
		return this.getOrAddFuncImport(
			"env",
			"fmt_box_bool",
			["i32"],
			["externref"],
		);
	}

	getFmtNewBoxIndex() {
		return this.getOrAddFuncImport("env", "fmt_new_box", [], ["externref"]);
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
				"only primitive, string, error and any arguments are supported for fmt and testing.T calls in wasm packages (format slices/structs field by field)",
			);
		}
		return this.getOrAddFuncImport(
			"env",
			`testing_arg_${suffix}`,
			[suffix === "str" ? "externref" : suffix === "any" ? "anyref" : wType],
			[],
		);
	}

	// Error operands of fmt.Sprint/Print/Append: a non-string for the host.
	getTestingArgSpreadImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"testing_arg_spread",
			["externref"],
			[],
		);
	}

	getTestingArgErrImportIndex() {
		return this.getOrAddFuncImport("env", "testing_arg_err", ["externref"], []);
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
			default:
				if (typeof wType === "object") {
					return this.getOrAddFuncImport(
						"env",
						`${prefix}_any`,
						["anyref"],
						[],
					);
				}
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

	getStringHashImportIndex() {
		return this.getOrAddFuncImport("env", "str_hash", ["externref"], ["i32"]);
	}

	getStringToUpperImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_to_upper",
			["externref"],
			["externref"],
		);
	}

	getStringToLowerImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_to_lower",
			["externref"],
			["externref"],
		);
	}

	getStringTrimSpaceImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_trim_space",
			["externref"],
			["externref"],
		);
	}

	getStringContainsImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_contains",
			["externref", "externref"],
			["i32"],
		);
	}

	getStringHasPrefixImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_has_prefix",
			["externref", "externref"],
			["i32"],
		);
	}

	getStringHasSuffixImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_has_suffix",
			["externref", "externref"],
			["i32"],
		);
	}

	getStringIndexImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_index",
			["externref", "externref"],
			["i32"],
		);
	}

	getStringLastIndexImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_last_index",
			["externref", "externref"],
			["i32"],
		);
	}

	getStringRepeatImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_repeat",
			["externref", "i32"],
			["externref"],
		);
	}

	getStringReplaceAllImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_replace_all",
			["externref", "externref", "externref"],
			["externref"],
		);
	}

	getStringEqualFoldImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_equal_fold",
			["externref", "externref"],
			["i32"],
		);
	}

	getStringCountImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_count",
			["externref", "externref"],
			["i32"],
		);
	}

	getStrFromI64ImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_from_i64",
			["i64"],
			["externref"],
		);
	}

	getStrFromI32ImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_from_i32",
			["i32"],
			["externref"],
		);
	}

	getStrFromF64ImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_from_f64",
			["f64"],
			["externref"],
		);
	}

	getStrToBytesImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"str_to_bytes",
			["externref"],
			["i32"],
		);
	}

	getStrByteAtImportIndex() {
		return this.getOrAddFuncImport("env", "str_byte_at", ["i32"], ["i32"]);
	}

	getBytesToStrInitImportIndex() {
		return this.getOrAddFuncImport("env", "bytes_to_str_init", ["i32"], []);
	}

	getBytesToStrPushImportIndex() {
		return this.getOrAddFuncImport("env", "bytes_to_str_push", ["i32"], []);
	}

	getBytesToStrFinishImportIndex() {
		return this.getOrAddFuncImport(
			"env",
			"bytes_to_str_finish",
			[],
			["externref"],
		);
	}

	getMathImportIndex(jsName, isBinary = false) {
		const params = isBinary ? ["f64", "f64"] : ["f64"];
		return this.getOrAddFuncImport("Math", jsName, params, ["f64"]);
	}

	getMathRandomImportIndex() {
		return this.getOrAddFuncImport("Math", "random", [], ["f64"]);
	}

	// Imports from the STDLIB_IMPORTS table (strings/strconv/utf8/fmt/testing.Run).
	getStdlibImportIndex(name) {
		const idx = this.importCache.get(`env.${name}`);
		if (idx === undefined) throw new Error(`Unknown runtime import: ${name}`);
		return idx;
	}

	getTimezoneOffsetImportIndex() {
		return this.getStdlibImportIndex("time_timezone_offset");
	}

	// Closure type of `func(*testing.T)` (the t.Run body).
	getTestingRunClosureType() {
		return this.getClosureType({
			kind: "func",
			params: [{ kind: "pointer", base: { kind: "named", name: "testing.T" } }],
			returns: [],
		});
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

	// Interface method dispatch is a `ref.test` chain over every concrete type
	// that declares `methodName` (no itabs); the static interface type is not
	// needed to build the candidate list.
	findInterfaceCandidates(_ifaceType, methodName) {
		const candidates = [];
		const seenKeys = new Set();

		// 1. Struct types
		for (const [sName, sInfo] of this.structTypes.entries()) {
			const directMethodName = `${sName}.${methodName}`;
			if (this.funcMap.has(directMethodName)) {
				const fIdx = this.resolveFuncIndex(directMethodName);
				const paramGoTypes = this.getFuncParamGoTypes(directMethodName);
				const paramWTypes = this.getFuncParamTypes(directMethodName);
				const recvGoType = paramGoTypes[0];
				const isPtrRecv = recvGoType?.kind === "pointer";

				if (isPtrRecv) {
					const key = `ptr:${sName}`;
					if (!seenKeys.has(key)) {
						seenKeys.add(key);
						candidates.push({
							recvTypeName: sName,
							testTypeIndex: sInfo.typeIndex,
							isBoxedValue: false,
							needsValueDeref: false,
							embedPath: null,
							funcIndex: fIdx,
							targetParamTypes: paramWTypes,
							structInfo: sInfo,
						});
					}
				} else {
					// Value receiver: both *sName and sName match
					const ptrKey = `ptr:${sName}`;
					if (!seenKeys.has(ptrKey)) {
						seenKeys.add(ptrKey);
						candidates.push({
							recvTypeName: sName,
							testTypeIndex: sInfo.typeIndex,
							isBoxedValue: false,
							needsValueDeref: true,
							embedPath: null,
							funcIndex: fIdx,
							targetParamTypes: paramWTypes,
							targetRecvWType: paramWTypes[0],
							structInfo: sInfo,
						});
					}
					const box = this.getIfaceBoxType({ kind: "named", name: sName });
					const valKey = `val:${sName}`;
					if (box && !seenKeys.has(valKey)) {
						seenKeys.add(valKey);
						candidates.push({
							recvTypeName: sName,
							testTypeIndex: box.typeIndex,
							isBoxedValue: true,
							needsValueDeref: false,
							embedPath: null,
							funcIndex: fIdx,
							targetParamTypes: paramWTypes,
							targetRecvWType: paramWTypes[0],
							structInfo: sInfo,
						});
					}
				}
			}

			// Promoted methods on sName
			if (sInfo.embeds && sInfo.embeds.length > 0) {
				for (const embed of sInfo.embeds) {
					const embedMethodName = `${embed.name}.${methodName}`;
					if (this.funcMap.has(embedMethodName)) {
						const fIdx = this.resolveFuncIndex(embedMethodName);
						const paramGoTypes = this.getFuncParamGoTypes(embedMethodName);
						const paramWTypes = this.getFuncParamTypes(embedMethodName);
						const isPtrRecv = paramGoTypes[0]?.kind === "pointer";
						const embedSInfo = this.getStructType(embed.name);

						const ptrKey = `ptr:${sName}`;
						if (!seenKeys.has(ptrKey)) {
							seenKeys.add(ptrKey);
							candidates.push({
								recvTypeName: sName,
								testTypeIndex: sInfo.typeIndex,
								isBoxedValue: false,
								needsValueDeref: !isPtrRecv,
								embedPath: [
									{
										parentTypeIndex: sInfo.typeIndex,
										fieldIndex: embed.fieldIndex,
									},
								],
								funcIndex: fIdx,
								targetParamTypes: paramWTypes,
								targetRecvWType: paramWTypes[0],
								structInfo: embedSInfo,
							});
						}

						if (!isPtrRecv) {
							const box = this.getIfaceBoxType({ kind: "named", name: sName });
							const valKey = `val:${sName}`;
							if (box && !seenKeys.has(valKey)) {
								seenKeys.add(valKey);
								candidates.push({
									recvTypeName: sName,
									testTypeIndex: box.typeIndex,
									isBoxedValue: true,
									needsValueDeref: false,
									embedPath: [
										{
											parentTypeIndex: sInfo.typeIndex,
											fieldIndex: embed.fieldIndex,
										},
									],
									funcIndex: fIdx,
									targetParamTypes: paramWTypes,
									targetRecvWType: paramWTypes[0],
									structInfo: embedSInfo,
								});
							}
						}
					}
				}
			}
		}

		// 2. Named non-struct types
		for (const [fnName, fIdx] of this.funcMap.entries()) {
			if (fnName.endsWith(`.${methodName}`)) {
				const rName = fnName.slice(0, fnName.length - methodName.length - 1);
				if (!this.structTypes.has(rName)) {
					const box = this.getIfaceBoxType({ kind: "named", name: rName });
					const key = `named:${rName}`;
					if (box && !seenKeys.has(key)) {
						seenKeys.add(key);
						const paramWTypes = this.getFuncParamTypes(fnName);
						candidates.push({
							recvTypeName: rName,
							testTypeIndex: box.typeIndex,
							isBoxedValue: true,
							needsValueDeref: false,
							embedPath: null,
							funcIndex: fIdx,
							targetParamTypes: paramWTypes,
						});
					}
				}
			}
		}

		return candidates;
	}

	getTypesImplementingInterface(ifaceType) {
		const candidates = [];
		const seen = new Set();
		const ifaceResolved =
			this.checker?.resolveType?.(
				ifaceType?.kind === "named" ? ifaceType.underlying : ifaceType,
			) ?? ifaceType;

		// 1. Struct types
		for (const [sName, sInfo] of this.structTypes.entries()) {
			const namedType = this.checker?.types?.get(sName) ?? {
				kind: "named",
				name: sName,
			};
			const ptrType = { kind: "pointer", base: namedType };

			// Check pointer to struct
			if (this.checker?.implements?.(ptrType, ifaceResolved)) {
				if (!seen.has(sInfo.typeIndex)) {
					seen.add(sInfo.typeIndex);
					candidates.push({ name: `*${sName}`, typeIndex: sInfo.typeIndex });
				}
			}

			// Check struct value (boxed)
			if (this.checker?.implements?.(namedType, ifaceResolved)) {
				const box = this.getIfaceBoxType(namedType);
				if (box && !seen.has(box.typeIndex)) {
					seen.add(box.typeIndex);
					candidates.push({ name: sName, typeIndex: box.typeIndex });
				}
			}
		}

		// 2. Named non-struct types that have methods
		if (this.checker?.types) {
			for (const [tName, tVal] of this.checker.types.entries()) {
				if (
					tVal?.kind === "named" &&
					tVal.underlying?.kind !== "struct" &&
					tVal.underlying?.kind !== "interface"
				) {
					if (this.checker.implements(tVal, ifaceResolved)) {
						const box = this.getIfaceBoxType(tVal);
						if (box && !seen.has(box.typeIndex)) {
							seen.add(box.typeIndex);
							candidates.push({ name: tName, typeIndex: box.typeIndex });
						}
					}
				}
			}
		}

		return candidates;
	}
}

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
	_registerIoSyntheticMethods(funcDecls, mod, STR_T, progs);
	// `__any_fmt` turns an `any` operand of fmt into the host value; its body
	// is emitted last-but-one so every type registered by user code is seen.
	if (_usesFmtAny(funcDecls, mod)) {
		funcDecls.push(
			helper("__any_fmt", [{ name: "a", type: ANY_T }], STR_T, "any_fmt"),
		);
	}

	// 1e4. Accessor helpers for &s.F and &xs[i] / &arr[i]
	_collectAccessorHelpers(progs, funcDecls, mod, checker);

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
		if (fn._isClosure || fn._isAccessorHelper) {
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
		} else if (fn._isAccessorHelper) {
			emitter.emitAccessorHelper(fn);
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

// Package-level `const` declarations (iota is already substituted by the
// parser).  Literals and expressions the folder can reduce become BasicLits in
// `constCache`; whatever is left is recorded in `nonLiteralConsts` and later
// becomes a global initialised by the start function.
function _collectPackageConsts(progs, mod, checker = null) {
	const entries = [];
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind !== "ConstDecl") continue;
			for (const spec of d.decls ?? []) {
				for (let i = 0; i < spec.names.length; i++) {
					if (spec.value?.[i])
						entries.push({
							name: spec.names[i],
							expr: spec.value[i],
							filename: p._filename,
							source: p._source,
						});
				}
			}
		}
	}
	const resolve = (name) => mod.constCache.get(name) ?? null;
	// Iterate to a fixpoint so a constant may refer to one declared later.
	let pending = entries;
	let progress = true;
	while (progress && pending.length > 0) {
		progress = false;
		const rest = [];
		for (const entry of pending) {
			let lit = null;
			try {
				lit = foldConstExpr(entry.expr, resolve);
			} catch (err) {
				if (checker?.err) {
					const savedFile = checker._currentFile;
					const savedSource = checker._currentSource;
					if (entry.filename) checker._currentFile = entry.filename;
					if (entry.source) checker._currentSource = entry.source;
					checker.err(err.message, entry.expr);
					checker._currentFile = savedFile;
					checker._currentSource = savedSource;
				} else {
					throw new Error(
						`Constant expression error for '${entry.name}': ${err.message}`,
					);
				}
				continue;
			}
			if (lit) {
				mod.constCache.set(entry.name, lit);
				progress = true;
			} else {
				rest.push(entry);
			}
		}
		pending = rest;
	}
	for (const entry of pending) mod.nonLiteralConsts.add(entry.name);
}

// Depth-first search over AST nodes (skipping `_`-prefixed annotations).
function _someNode(node, pred) {
	if (!node || typeof node !== "object") return false;
	if (Array.isArray(node)) return node.some((n) => _someNode(n, pred));
	if (pred(node)) return true;
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		if (_someNode(node[key], pred)) return true;
	}
	return false;
}

function _usesTestingRun(node) {
	return _someNode(
		node,
		(n) =>
			n.kind === "CallExpr" &&
			n.func?.kind === "SelectorExpr" &&
			n.func.field === "Run" &&
			isTestingT(n.func.expr?._type),
	);
}

// `__any_eq` is only needed when some `==`/`!=` (or switch case) compares
// anyref operands, a struct with an anyref field is compared, or the error
// runtime (`errors.Is`) is present.  `_emitAnyEq` throws if this misses a
// site, so a gap surfaces as a compile error rather than a bad module.
function _usesAnyEq(funcDecls, mod) {
	if (mod.hasErrorType) return true;
	for (const info of mod.mapTypes.values()) {
		if (isInterfaceType(info.keyGoType, mod.checker)) return true;
	}
	for (const info of mod.structTypes.values()) {
		if (info.fields?.some((f) => f.wType === "anyref")) return true;
	}
	const isAnyRef = (n) =>
		Boolean(n?._type) && toWasmType(n._type, mod.checker, mod) === "anyref";
	return funcDecls.some((fn) =>
		_someNode(fn.body, (n) => {
			if (n.kind === "BinaryExpr" && (n.op === "==" || n.op === "!="))
				return isAnyRef(n.left) || isAnyRef(n.right);
			if (n.kind === "SwitchStmt" && n.tag) return isAnyRef(n.tag);
			return false;
		}),
	);
}

// An `fmt` call with an `any`/interface operand or a `xs...` spread needs
// `__any_fmt`.  `emitFmtCall` falls back to scalar-only dispatch without it.
function _usesFmtAny(funcDecls, mod) {
	return funcDecls.some((fn) =>
		_someNode(
			fn.body,
			(n) =>
				n.kind === "CallExpr" &&
				n.func?.kind === "SelectorExpr" &&
				n.func.expr?.kind === "Ident" &&
				n.func.expr.name === "fmt" &&
				n.args?.some(
					(a) =>
						a._spread ||
						isAnyType(a._type, mod.checker) ||
						isInterfaceType(a._type, mod.checker),
				),
		),
	);
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
				Mod: "mod",
				Hypot: "hypot",
				Cbrt: "cbrt",
				Exp: "exp",
				Log: "log",
				Log2: "log2",
				Log10: "log10",
				Round: "round",
				Sinh: "sinh",
				Cosh: "cosh",
				Tanh: "tanh",
			};
			if (jsMathMap[func.field]) {
				const isBinary = BINARY_MATH_IMPORTS.has(jsMathMap[func.field]);
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
			else if (func.field === "Run") {
				// closure type for func(*testing.T) must exist before bodies are emitted
				mod.getTestingRunClosureType();
			} else {
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

	if (checker.errors?.length > 0) {
		return { wasm: null, errors: checker.errors };
	}

	return { ...res, errors: [] };
}

function _isPointerGoType(t, mod) {
	if (!t) return false;
	if (t.kind === "pointer" || t.kind === "PointerType" || t.kind === "StarExpr")
		return true;
	// `type P *T` used as a field type: look through the name.
	const named =
		t.kind === "named" || t.kind === "TypeName" || t.kind === "Ident";
	const under = named
		? (t.underlying ?? mod.checker?.types?.get(t.name)?.underlying)
		: null;
	return under ? _isPointerGoType(under, mod) : false;
}

// Constant-expression zero value of a struct global. Nested struct values are
// built in place: a null ref would trap on the first field access.
function _zeroStructConst(structInfo, mod) {
	const out = [];
	for (const f of structInfo.fields) out.push(..._zeroFieldConst(f, mod));
	out.push({ op: "struct.new", typeIndex: structInfo.typeIndex });
	return out;
}

function _zeroFieldConst(f, mod) {
	const w = f.wType;
	if (w === "i64") return [{ op: "i64.const", value: 0n }];
	if (w === "f32" || w === "f64") return [{ op: `${w}.const`, value: 0 }];
	if (w === "externref") return [{ op: "ref.null", heapType: "extern" }];
	if (w === "anyref") return [{ op: "ref.null", heapType: "any" }];
	if (typeof w !== "object" || w === null)
		return [{ op: "i32.const", value: 0 }];
	const ti = w.typeIndex;
	const slice = typeof ti === "number" ? mod.getSliceTypeByIndex(ti) : null;
	if (slice) return [{ op: "global.get", index: slice.emptyGlobalIndex }];
	if (typeof ti === "number" && !_isPointerGoType(f.goType, mod)) {
		for (const s of mod.structTypes.values())
			if (s.typeIndex === ti) return _zeroStructConst(s, mod);
	}
	return [{ op: "ref.null", heapType: ti ?? "any" }];
}

// Length and element type of an array type (checker type, AST node or name).
function _arrayShape(t, checker) {
	if (!t) return null;
	if (t.kind === "array" || t.kind === "ArrayType") {
		const size = typeof t.size === "number" ? t.size : Number(t.size?.value);
		return Number.isInteger(size) ? { size, elem: t.elem } : null;
	}
	if (t.kind === "named" && t.underlying)
		return _arrayShape(t.underlying, checker);
	if (t.kind === "TypeName" || t.kind === "Ident")
		return _arrayShape(checker?.types?.get(t.name), checker);
	return null;
}

// Constant-expression zero value of a package-level array global (a null ref
// would trap on the first element access); null when it cannot be built.
function _zeroArrayConst(goType, mod, depth = 0) {
	const checker = mod.checker;
	if (!goType || goType.kind === "pointer" || depth > 4) return null;
	const shape = _arrayShape(goType, checker);
	if (!shape) return null;
	const { size, elem } = shape;
	const arrInfo = mod.getArrayType(elem);
	const elemW = toWasmType(elem, checker, mod);
	let one = null;
	if (_arrayShape(elem, checker)) {
		one = _zeroArrayConst(elem, mod, depth + 1);
		if (!one) return null;
	} else if (
		elem?.kind !== "pointer" &&
		elem?.kind !== "StarExpr" &&
		typeof elemW === "object" &&
		isStructType(elem, checker, mod)
	) {
		const info = Array.from(mod.structTypes.values()).find(
			(x) => x.typeIndex === elemW.typeIndex,
		);
		if (!info) return null;
		one = _zeroStructConst(info, mod);
	}
	if (!one)
		return [
			{ op: "i32.const", value: size },
			{ op: "array.new_default", typeIndex: arrInfo.typeIndex },
		];
	if (size > 64) return null;
	const out = [];
	for (let i = 0; i < size; i++) out.push(...one);
	out.push({ op: "array.new_fixed", typeIndex: arrInfo.typeIndex, size });
	return out;
}

function _collectPackageGlobals(progs, mod, checker) {
	const pending = []; // non-constant initializers, run by the start function
	const pendingConsts = []; // unfoldable consts; they run before any var
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			const isConst = d.kind === "ConstDecl";
			if (d.kind !== "VarDecl" && !isConst) continue;
			for (const spec of d.decls ?? d.specs ?? [d]) {
				const names = spec.names ?? (spec.name ? [spec.name] : []);
				const values = spec.value ?? (spec.init ? [spec.init] : []);
				for (let i = 0; i < names.length; i++) {
					const name = names[i];
					// Foldable consts live in `constCache`, not in a global.
					if (isConst && !mod.isNonLiteralConst(name)) continue;
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
						const sliceInfo =
							typeof wType === "object" && typeof wType.typeIndex === "number"
								? mod.getSliceTypeByIndex(wType.typeIndex)
								: null;
						if (sliceInfo) {
							initInsts = [
								{ op: "global.get", index: sliceInfo.emptyGlobalIndex },
							];
						} else if (
							typeof wType === "object" &&
							typeof wType.typeIndex === "number" &&
							rawType?.kind !== "pointer"
						) {
							const structInfo = Array.from(mod.structTypes.values()).find(
								(s) => s.typeIndex === wType.typeIndex,
							);
							const arrZero = structInfo ? null : _zeroArrayConst(rawType, mod);
							if (structInfo) {
								initInsts = _zeroStructConst(structInfo, mod);
							} else if (arrZero) {
								initInsts = arrZero;
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
							const s = String(litNode.value);
							const clean = /^0[0-7]+$/.test(s) ? `0o${s.slice(1)}` : s;
							initInsts = [
								wType === "i64"
									? {
											op: "i64.const",
											value: BigInt(sign) * BigInt(clean),
										}
									: {
											op: "i32.const",
											value: (sign * Number(clean)) | 0,
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
						(isConst ? pendingConsts : pending).push({
							name,
							expr: values[i],
						});
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
	return [..._orderConstInits(pendingConsts), ...pending];
}

// Orders runtime-initialised consts so each runs after the consts it
// references (Go allows a constant to use one declared later).
function _orderConstInits(entries) {
	const byName = new Map(entries.map((e) => [e.name, e]));
	const ordered = [];
	const state = new Map();
	const visit = (entry) => {
		if (state.has(entry.name)) return;
		state.set(entry.name, true);
		_someNode(entry.expr, (n) => {
			if (n.kind === "Ident" && byName.has(n.name)) visit(byName.get(n.name));
			return false;
		});
		ordered.push(entry);
	};
	for (const e of entries) visit(e);
	return ordered;
}

// Synthesises `__init_globals()` assigning every non-constant package-level
// initializer in declaration order and invoking package `init()` functions;
// registered as the module start function.
function _makeGlobalInitFunc(pending, initNames = []) {
	const stmts = pending.map(({ name, expr }) => ({
		kind: "AssignStmt",
		lhs: [{ kind: "Ident", name, _type: expr._type }],
		op: "=",
		rhs: [expr],
	}));
	for (const initName of initNames) {
		stmts.push({
			kind: "ExprStmt",
			expr: {
				kind: "CallExpr",
				func: { kind: "Ident", name: initName },
				args: [],
			},
		});
	}
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

function _scanInterfaceCallNodes(node, interfaceCalls, checker) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node)
			_scanInterfaceCallNodes(item, interfaceCalls, checker);
		return;
	}
	if (node.kind === "CallExpr" && node.func?.kind === "SelectorExpr") {
		const recvType = node.func.expr?._type;
		if (isNonEmptyInterface(recvType, checker)) {
			const ifaceName = getReceiverTypeName(recvType, node.func.expr) || "anon";
			const methodName = node.func.field;
			const key = `${ifaceName}.${methodName}`;
			if (!interfaceCalls.has(key)) {
				interfaceCalls.set(key, {
					ifaceName,
					ifaceType: recvType,
					methodName,
					callNode: node,
				});
			}
		}
	}
	for (const key of Object.keys(node)) {
		if (!key.startsWith("_"))
			_scanInterfaceCallNodes(node[key], interfaceCalls, checker);
	}
}

function _scanInterfaceTypeDecls(progs, interfaceCalls, checker) {
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind !== "TypeDecl") continue;
			const resolved = checker?.types?.get(d.name) ?? d.type;
			const underlying =
				resolved?.kind === "named"
					? resolved.underlying
					: d.type?.kind === "InterfaceType"
						? d.type
						: resolved;
			if (!isNonEmptyInterface(underlying, checker)) continue;
			const methods =
				underlying.methods instanceof Map
					? Array.from(underlying.methods.entries())
					: Array.isArray(underlying.methods)
						? underlying.methods.map((m) => [m.name ?? m, m])
						: [];
			for (const [mName, mSig] of methods) {
				const key = `${d.name}.${mName}`;
				if (!interfaceCalls.has(key)) {
					interfaceCalls.set(key, {
						ifaceName: d.name,
						ifaceType: resolved,
						methodName: mName,
						methodSig: mSig,
					});
				}
			}
		}
	}
}

function _makeInterfaceDispatcher(info, checker) {
	let methodSig = info.methodSig;
	if (!methodSig) {
		const ifaceResolved =
			checker?.resolveType?.(
				info.ifaceType?.kind === "named"
					? info.ifaceType.underlying
					: info.ifaceType,
			) ?? info.ifaceType;
		if (ifaceResolved?.methods instanceof Map) {
			methodSig = ifaceResolved.methods.get(info.methodName);
		}
	}

	const params = [{ name: "__recv", type: { kind: "basic", name: "any" } }];
	if (methodSig?.params) {
		const sigParams = variadicAsSlice(methodSig.params, methodSig.variadic);
		for (let p = 0; p < sigParams.length; p++) {
			params.push({ name: `__arg${p}`, type: sigParams[p] });
		}
	} else if (info.callNode?.args) {
		for (let p = 0; p < info.callNode.args.length; p++) {
			params.push({
				name: `__arg${p}`,
				type: info.callNode.args[p]._type ?? {
					kind: "basic",
					name: "any",
				},
			});
		}
	}

	let returnType = info.callNode?._type ?? null;
	if (methodSig?.returns) {
		returnType =
			methodSig.returns.length === 1
				? methodSig.returns[0]
				: methodSig.returns.length > 1
					? { kind: "tuple", types: methodSig.returns }
					: null;
	}

	return {
		kind: "FuncDecl",
		name: `__dispatch_${info.ifaceName}_${info.methodName}`,
		params,
		returnType,
		body: { kind: "Block", stmts: [], list: [] },
		_isInterfaceDispatcher: true,
		_ifaceName: info.ifaceName,
		_ifaceType: info.ifaceType,
		_methodName: info.methodName,
		_rootFuncDecl: null,
	};
}

function _scanFuncSigInterfaces(
	progs,
	funcDecls,
	interfaceCalls,
	checker,
	mod,
) {
	const scanType = (t) => {
		if (!t) return;
		if (t.kind === "InterfaceType" || (t.kind === "interface" && !t.name)) {
			const mList = getInterfaceMethodList(t);
			if (mList.length === 0) return;
			const ifaceName = anonIfaceName(t, checker, mod);
			for (const m of mList) {
				const key = `${ifaceName}.${m.name}`;
				if (!interfaceCalls.has(key)) {
					interfaceCalls.set(key, {
						ifaceName,
						ifaceType: t,
						methodName: m.name,
						methodSig: {
							kind: "func",
							params: m.params,
							returns: m.returns,
						},
					});
				}
			}
		}
	};
	for (const fn of funcDecls) {
		for (const p of fn.params ?? []) scanType(p.type);
		scanType(fn.returnType);
	}
	for (const p of progs) {
		for (const d of p.decls ?? []) {
			if (d.kind === "FuncDecl") {
				for (const param of d.params ?? []) scanType(param.type);
				scanType(d.returnType);
			}
		}
	}
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

function _unwrapPointer(t) {
	let curr = t;
	while (
		curr &&
		(curr.kind === "pointer" ||
			curr.kind === "PointerType" ||
			curr.kind === "StarExpr")
	) {
		curr = curr.base ?? curr.expr ?? curr.operand;
	}
	return curr;
}

function _resolveIdentType(name, fn, mod) {
	if (fn) {
		for (const p of fn.params ?? []) {
			if (p.name === name) return p.type;
		}
	}
	const global = mod.resolveGlobal(name);
	return global?.goType ?? null;
}

function _resolveAnonStruct(t, mod) {
	if (!mod.getAnonStructType) return null;
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
	return rawFields.length > 0 ? mod.getAnonStructType(rawFields) : null;
}

function _resolveStructInfoForAccessor(node, mod, _checker, fn = null) {
	if (!node) return null;
	let t = node._type;
	if (!t && node.kind === "Ident") {
		t = _resolveIdentType(node.name, fn, mod);
	}
	t = _unwrapPointer(t);
	if (!t) return null;
	const name = t.name ?? (t.kind === "named" ? t.name : null);
	if (name && mod.structTypes.has(name)) {
		return mod.structTypes.get(name);
	}
	if (t.kind === "TypeName" || t.kind === "Ident") {
		if (mod.structTypes.has(t.name)) return mod.structTypes.get(t.name);
	}
	if (t.kind === "struct" || t.kind === "StructType") {
		return _resolveAnonStruct(t, mod);
	}
	return null;
}

function _resolveFieldPathForAccessor(structInfo, fieldName, mod) {
	if (!structInfo) return null;
	if (structInfo.fieldIndexMap?.has(fieldName)) {
		const idx = structInfo.fieldIndexMap.get(fieldName);
		return [{ structInfo, fieldIndex: idx, field: structInfo.fields[idx] }];
	}
	for (const embed of structInfo.embeds ?? []) {
		const embedInfo = mod.structTypes.get(embed.name);
		if (embedInfo) {
			const sub = _resolveFieldPathForAccessor(embedInfo, fieldName, mod);
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

function _checkSelectorAccessor(operand, currentFn, mod, checker, funcDecls) {
	const sInfo = _resolveStructInfoForAccessor(operand, mod, checker, currentFn);
	if (sInfo) return;

	const baseStructInfo = _resolveStructInfoForAccessor(
		operand.expr,
		mod,
		checker,
		currentFn,
	);
	if (!baseStructInfo) return;

	const path = _resolveFieldPathForAccessor(baseStructInfo, operand.field, mod);
	if (!path || path.length === 0) return;

	const lastStep = path[path.length - 1];
	if (!isScalarType(lastStep.field.goType, checker, mod)) return;

	const h = mod.getStructAccessorHelpers(
		lastStep.structInfo,
		lastStep.fieldIndex,
	);
	if (!funcDecls.includes(h.getterFn)) {
		funcDecls.push(h.getterFn, h.setterFn);
	}
}

function _resolveBaseTypeForIndex(baseNode, currentFn, mod) {
	const baseType = baseNode?._type;
	if (!baseType && baseNode?.kind === "Ident") {
		if (currentFn) {
			for (const p of currentFn.params ?? []) {
				if (p.name === baseNode.name) return p.type;
			}
		}
		const global = mod.resolveGlobal(baseNode.name);
		if (global?.goType) return global.goType;
	}
	return baseType;
}

function _checkIndexAccessor(operand, currentFn, mod, checker, funcDecls) {
	const sInfo = _resolveStructInfoForAccessor(operand, mod, checker, currentFn);
	if (sInfo) return;

	const baseType = _resolveBaseTypeForIndex(operand.expr, currentFn, mod);
	const isSlice = isSliceType(baseType, checker);
	const isArr = isArrayType(baseType, checker);
	const isPtrToArr =
		baseType?.kind === "pointer" && isArrayType(baseType.base, checker);
	if (!isSlice && !isArr && !isPtrToArr) return;

	const container = isPtrToArr ? baseType.base : baseType;
	const elemGoType = container.elem ?? container.underlying?.elem;
	if (!elemGoType || !isScalarType(elemGoType, checker, mod)) return;

	const h = mod.getElemAccessorHelpers(elemGoType);
	if (!funcDecls.includes(h.getterFn)) {
		funcDecls.push(h.getterFn, h.setterFn);
	}
}

function _collectAccessorHelpers(progs, funcDecls, mod, checker) {
	function scan(node, currentFn) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) scan(item, currentFn);
			return;
		}
		if (node.kind === "UnaryExpr" && node.op === "&" && node.operand) {
			if (node.operand.kind === "SelectorExpr") {
				_checkSelectorAccessor(
					node.operand,
					currentFn,
					mod,
					checker,
					funcDecls,
				);
			} else if (node.operand.kind === "IndexExpr") {
				_checkIndexAccessor(node.operand, currentFn, mod, checker, funcDecls);
			}
		}
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			scan(node[key], currentFn);
		}
	}

	for (const fn of funcDecls) {
		if (fn.body) scan(fn.body, fn);
	}
	for (const p of progs) {
		for (const d of p.decls ?? []) scan(d, null);
	}
}
