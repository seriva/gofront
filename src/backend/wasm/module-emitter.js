// src/backend/wasm/module-emitter.js
// ModuleEmitter: Module IR builder that registers types, imports, globals and functions.

import { wTypeKey } from "./boundary.js";
import { hasErrorUsage } from "./prescan.js";
import {
	ERROR_STRUCT,
	getFuncSignature,
	getSliceElemType,
	goTypeKey,
	isScalarType,
	isSliceType,
	toWasmType,
} from "./types.js";

export class ModuleEmitter {
	constructor(checker, lowerResult = null, programs = [], options = {}) {
		this.checker = checker;
		this.lowerResult = lowerResult;
		// Local package names whose code is linked into this module; selectors
		// like `mathx.NewVec3` are de-qualified to `NewVec3` by the emitter.
		this.bundledPackages = options.bundledPackages ?? new Set();
		this.natives = options.natives !== false; // replace native calls with host code
		this.constCache = new Map(); // name -> BasicLit (package-level literal consts)
		this.nonLiteralConsts = new Set(); // package-level consts the backend cannot evaluate yet

		this.types = []; // type entries
		this.typeCache = new Map(); // signature string -> index
		this._openRec = null; // rec group receiving new types while structs are resolved

		this.structTypes = new Map(); // name -> struct info
		this.complexTypes = new Map(); // key -> complex struct info
		this.ptrTypes = new Map(); // key -> ptr supertype info
		this.boxTypes = new Map(); // wType key -> box info
		this.ifaceBoxTypes = new Map(); // key -> iface box info
		this.nilBoxTypes = new Map(); // key -> typed-nil marker info
		this.arrayTypes = new Map(); // wType key -> array info
		this.sliceTypes = new Map(); // wType key -> slice info
		this.sliceTypesByIndex = new Map(); // typeIndex -> slice info
		this.taggedSliceTypes = new Map(); // Go slice type key -> tagged info
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
		this.hasErrorType = hasErrorUsage(programs);

		if (programs && programs.length > 0) {
			this.initTypes(programs);
		}

		this._importsLocked = false;
		this._initRuntimeImports();
	}

	// The runtime error struct is not declared in Go source: give the checker a
	// named type with its method set (`Error() string`) so type assertions to
	// `interface{ Error() string }` find it as a candidate.
	_registerRuntimeErrorType() {
		const types = this.checker?.types;
		if (!types || types.has(ERROR_STRUCT)) return;
		const STRING = { kind: "basic", name: "string" };
		types.set(ERROR_STRUCT, {
			kind: "named",
			name: ERROR_STRUCT,
			underlying: {
				kind: "struct",
				fields: new Map(),
				methods: new Map([
					["Error", { kind: "func", params: [], returns: [STRING] }],
				]),
			},
		});
	}

	initTypes(programs) {
		const progs = Array.isArray(programs) ? programs : [programs];
		const rawStructs = [];
		const seen = new Set();
		const aliases = []; // qualified key (pkg.T) -> unqualified struct name

		if (this.hasErrorType) {
			this._registerRuntimeErrorType();
			seen.add(ERROR_STRUCT);
			rawStructs.push({
				name: ERROR_STRUCT,
				structType: {
					kind: "struct",
					fields: new Map([["msg", { kind: "basic", name: "string" }]]),
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
						? [
								(
									f.embeddedName ??
									(f.type?.kind === "PointerType"
										? f.type.base?.name
										: f.type?.name)
								)
									?.split(".")
									.pop(),
							]
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
							// The embedded type, when it differs from the field
							// name (`Mutex$$sync` for the field `Mutex`).
							const ref =
								f.type?.kind === "PointerType"
									? f.type.base?.name
									: f.type?.name;
							const typeName = this.checker?.types?.get(ref)?.name;
							embeds.push({
								name: n,
								...(typeName && typeName !== n && { typeName }),
								fieldIndex: fIdx,
							});
						}
						fIdx++;
					}
				}
			} else if (resolvedStruct?.fields) {
				let fIdx = 0;
				// `fields` also holds promoted fields; the declared fields
				// (`_structFields`) give the real layout of a defined struct.
				const declared = resolvedStruct._structFields
					? resolvedStruct._structFields.flatMap((sf) => {
							if (!sf.embedded) return sf.names.map((n) => [n, sf.type]);
							const inner = sf.type.kind === "pointer" ? sf.type.base : sf.type;
							const n = (inner?.name ?? "").split(".").pop();
							return n ? [[n, sf.type]] : [];
						})
					: [...resolvedStruct.fields.entries()];
				for (const [fName, fType] of declared) {
					const wType = toWasmType(fType, this.checker, this);
					fields.push({ name: fName, goType: fType, wType });
					fieldIndexMap.set(fName, fIdx);
					fIdx++;
				}
				if (resolvedStruct?._embeds) {
					for (const embed of resolvedStruct._embeds) {
						const inner = embed.kind === "pointer" ? embed.base : embed;
						const embedName = inner?.kind === "named" ? inner.name : null;
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
			// Mutable so the facade's per-field setters for an exported struct
			// that holds a complex value validate.
			fields: [
				{ type: elemWType, mutable: true },
				{ type: elemWType, mutable: true },
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

	// The value a nil map, func or `*T` takes inside an interface: a marker
	// object per Go type, so `any(nilMap) != nil` and a type switch still sees
	// the dynamic type.  Struct types are structural, so each marker gets a
	// distinct field count to keep them apart.
	getNilBoxType(goType) {
		const key = goTypeKey(goType);
		if (this.nilBoxTypes.has(key)) return this.nilBoxTypes.get(key);
		const n = this.nilBoxTypes.size + 1;
		const typeIndex = this._getTotalTypeCount();
		this._pushType({
			form: "struct",
			fields: Array.from({ length: n }, () => ({
				type: "i32",
				mutable: true,
			})),
		});
		const globalIndex = this.globals.length;
		this.globals.push({
			type: { kind: "ref", nullable: true, typeIndex },
			mutable: false,
			init: [
				...Array.from({ length: n }, () => ({ op: "i32.const", value: 0 })),
				{ op: "struct.new", typeIndex },
			],
		});
		const info = { key, goType, typeIndex, globalIndex };
		this.nilBoxTypes.set(key, info);
		return info;
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
			// Slice types are open: each defined slice type, and each Go type among
			// the 32-bit-or-smaller elements, gets a tagged subtype when it
			// reaches an interface.
			sub: true,
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

	// The subtype of the slice struct a value of Go slice type `sliceGoType`
	// takes inside an interface.  Slices of booleans and small integers share
	// one WebAssembly type, so the extra tag field (a nullable ref to a struct
	// with one immutable i32 field per tag index) is what tells `[]byte` from
	// `[]bool` and `json.RawMessage` from `[]byte` in a type test.
	getTaggedSliceType(sliceGoType, elemGoType) {
		const key = goTypeKey(sliceGoType);
		const known = this.taggedSliceTypes.get(key);
		if (known) return known;
		const base = this.getSliceType(elemGoType);
		const root = this.getTaggedSliceRoot(base);
		const tagIndex = this.taggedSliceTypes.size + 1;
		const tagTypeIndex = this._getTotalTypeCount();
		this._pushType({
			form: "struct",
			fields: Array.from({ length: tagIndex }, () => ({
				type: "i32",
				mutable: false,
			})),
		});
		const typeIndex = this._getTotalTypeCount();
		this._pushType({
			form: "struct",
			sub: true,
			superTypeIndex: root.typeIndex,
			fields: [
				...base.typeEntry.fields,
				{
					type: { kind: "ref", nullable: true, typeIndex: tagTypeIndex },
					mutable: false,
				},
			],
		});
		const info = { key, typeIndex, tagTypeIndex, base, goType: sliceGoType };
		this.taggedSliceTypes.set(key, info);
		return info;
	}

	// The common supertype of every tagged subtype of the slice type `base`.  An
	// unnamed `[]int` in an interface is the bare slice type, which every
	// tagged subtype (`type S []int`) also passes `ref.test` for; testing
	// "base and not root" is what keeps `any(S{}).([]int)` from matching.
	getTaggedSliceRoot(base) {
		if (base.tagRoot) return base.tagRoot;
		const typeIndex = this._getTotalTypeCount();
		this._pushType({
			form: "struct",
			sub: true,
			superTypeIndex: base.typeIndex,
			fields: [...base.typeEntry.fields],
		});
		base.tagRoot = { typeIndex };
		return base.tagRoot;
	}

	getSliceTypeByIndex(typeIndex) {
		return this.sliceTypesByIndex?.get(typeIndex) ?? null;
	}

	getMapType(keyGoType, valGoType) {
		const keyWType = toWasmType(keyGoType, this.checker, this);
		const valWType = toWasmType(valGoType, this.checker, this);
		// Vector keys share one wasm type but compare differently (floats vs
		// mask words), so the Go type is part of the key.
		const keyPart =
			keyWType === "v128" ? `v128_${goTypeKey(keyGoType)}` : wTypeKey(keyWType);
		const key = `${keyPart}:${wTypeKey(valWType)}`;
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
		};
		this.mapTypes.set(key, mapInfo);
		this.mapTypesByIndex.set(mapTypeIndex, mapInfo);
		return mapInfo;
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
		this.getStrFromI64ImportIndex();
		this.getStrFromI32ImportIndex();
		this.getStrFromF64ImportIndex();
		this.getIsStringImportIndex(); // env.is_string
		this.getStrToBytesImportIndex();
		this.getStrByteAtImportIndex();
		this.getBytesToStrInitImportIndex();
		this.getBytesToStrPushImportIndex();
		this.getBytesToStrFinishImportIndex();

		// Logging built-ins
		this.getPrintlnEmptyIndex(); // env.println_empty
		const logTypes = ["i32", "i64", "f32", "f64", "externref", "anyref"];
		for (const t of logTypes) {
			this.getLogImportIndex(t, false, false); // env.print_*
			this.getLogImportIndex(t, true, false); // env.println_*
		}
		this.getLogImportIndex("i32", false, true); // env.print_bool
		this.getLogImportIndex("i32", true, true); // env.println_bool
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

	getPrintResetIndex() {
		return this.getOrAddFuncImport("env", "print_reset", [], []);
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
			case "u64":
				return this.getOrAddFuncImport("env", `${prefix}_u64`, ["i64"], []);
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
			const promoted = this._findPromotedMethod(sInfo, methodName);
			if (promoted?.iface) {
				this._addIfaceEmbedCandidates(
					candidates,
					seenKeys,
					sName,
					sInfo,
					promoted.embedPath,
				);
			} else if (promoted) {
				const { embedType, embedPath, viaPointer } = promoted;
				const embedMethodName = `${embedType}.${methodName}`;
				const fIdx = this.resolveFuncIndex(embedMethodName);
				const paramGoTypes = this.getFuncParamGoTypes(embedMethodName);
				const paramWTypes = this.getFuncParamTypes(embedMethodName);
				const isPtrRecv = paramGoTypes[0]?.kind === "pointer";
				const embedSInfo = this.getStructType(embedType);

				const ptrKey = `ptr:${sName}`;
				if (!seenKeys.has(ptrKey)) {
					seenKeys.add(ptrKey);
					candidates.push({
						recvTypeName: sName,
						testTypeIndex: sInfo.typeIndex,
						isBoxedValue: false,
						needsValueDeref: !isPtrRecv,
						embedPath,
						nilCheckLast: !isPtrRecv,
						funcIndex: fIdx,
						targetParamTypes: paramWTypes,
						targetRecvWType: paramWTypes[0],
						structInfo: embedSInfo,
					});
				}

				// A pointer-receiver method is in the value's method set only
				// when it is reached through an embedded pointer.
				if (!isPtrRecv || viaPointer) {
					const box = this.getIfaceBoxType({ kind: "named", name: sName });
					const valKey = `val:${sName}`;
					if (box && !seenKeys.has(valKey)) {
						seenKeys.add(valKey);
						candidates.push({
							recvTypeName: sName,
							testTypeIndex: box.typeIndex,
							isBoxedValue: true,
							needsValueDeref: false,
							embedPath,
							nilCheckLast: !isPtrRecv,
							funcIndex: fIdx,
							targetParamTypes: paramWTypes,
							targetRecvWType: paramWTypes[0],
							structInfo: embedSInfo,
						});
					}
				}
			}
		}

		// 2. Named non-struct types
		for (const [fnName, fIdx] of this.funcMap.entries()) {
			if (fnName.endsWith(`.${methodName}`)) {
				const rName = fnName.slice(0, fnName.length - methodName.length - 1);
				if (!this.structTypes.has(rName)) {
					const rType = this.checker?.types?.get(rName) ?? {
						kind: "named",
						name: rName,
					};
					const paramGoTypes = this.getFuncParamGoTypes(fnName);
					const paramWTypes = this.getFuncParamTypes(fnName);
					const isPtrRecv = paramGoTypes[0]?.kind === "pointer";
					const isSlice = isSliceType(rType, this.checker);

					if (isSlice) {
						const elemType = getSliceElemType(rType, this.checker);
						const sliceInfo = this.getSliceType(elemType);
						const ptrIfaceBox = this.getIfaceBoxType({
							kind: "pointer",
							base: rType,
						});
						const box = this.getBoxType(rType);
						if (isPtrRecv) {
							const ptrKey = `ptr:${rName}`;
							if (ptrIfaceBox && !seenKeys.has(ptrKey)) {
								seenKeys.add(ptrKey);
								candidates.push({
									recvTypeName: rName,
									testTypeIndex: ptrIfaceBox.typeIndex,
									isBoxedValue: true,
									needsValueDeref: false,
									embedPath: null,
									funcIndex: fIdx,
									targetParamTypes: paramWTypes,
								});
							}
						} else {
							const ptrKey = `ptr:${rName}`;
							if (ptrIfaceBox && box && !seenKeys.has(ptrKey)) {
								seenKeys.add(ptrKey);
								candidates.push({
									recvTypeName: rName,
									testTypeIndex: ptrIfaceBox.typeIndex,
									isBoxedValue: true,
									nilPtrPanic: true,
									needsValueDeref: false,
									embedPath: [
										{
											castTypeIndex: box.typeIndex,
											parentTypeIndex: box.typeIndex,
											fieldIndex: 0,
										},
									],
									funcIndex: fIdx,
									targetParamTypes: paramWTypes,
								});
							}
							const key = `slice:${rName}`;
							if (sliceInfo && !seenKeys.has(key)) {
								seenKeys.add(key);
								candidates.push({
									recvTypeName: rName,
									testTypeIndex: sliceInfo.typeIndex,
									isBoxedValue: false,
									needsValueDeref: false,
									embedPath: null,
									funcIndex: fIdx,
									targetParamTypes: paramWTypes,
								});
							}
						}
					} else {
						const box = isPtrRecv
							? this.getIfaceBoxType({ kind: "pointer", base: rType })
							: this.getIfaceBoxType(rType);
						const key = `${isPtrRecv ? "ptr" : "named"}:${rName}`;
						if (box && !seenKeys.has(key)) {
							seenKeys.add(key);
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
						if (!isPtrRecv)
							this._addPtrScalarCandidate(
								candidates,
								seenKeys,
								rName,
								rType,
								fIdx,
								paramWTypes,
							);
					}
				}
			}
		}

		return candidates;
	}

	// Whether `goType`, the type of an embedded field, is an interface whose
	// method set has `methodName`.
	embeddedInterfaceHas(goType, methodName) {
		let t = goType;
		for (let i = 0; i < 8 && t; i++) {
			if (t.kind === "TypeName" || t.kind === "Ident") {
				const named = this.checker?.types?.get(t.name);
				if (!named) return t.name === "error" && methodName === "Error";
				t = named;
			} else if (t.kind === "named") {
				t = t.underlying ?? this.checker?.types?.get(t.name)?.underlying;
			} else if (t.kind === "interface") {
				return t.methods?.has?.(methodName) ?? false;
			} else if (t.kind === "InterfaceType") {
				return (t.methods ?? []).some((m) => (m.name ?? m) === methodName);
			} else {
				return false;
			}
		}
		return false;
	}

	// Dispatch candidates for a method `sName` promotes from an embedded
	// interface: the embedded value is loaded and dispatched again through the
	// same dispatcher (`selfDispatch`).
	_addIfaceEmbedCandidates(candidates, seenKeys, sName, sInfo, embedPath) {
		const base = {
			recvTypeName: sName,
			needsValueDeref: false,
			embedPath,
			selfDispatch: true,
			structInfo: sInfo,
		};
		const ptrKey = `ptr:${sName}`;
		if (!seenKeys.has(ptrKey)) {
			seenKeys.add(ptrKey);
			candidates.push({
				...base,
				testTypeIndex: sInfo.typeIndex,
				isBoxedValue: false,
			});
		}
		const box = this.getIfaceBoxType({ kind: "named", name: sName });
		const valKey = `val:${sName}`;
		if (box && !seenKeys.has(valKey)) {
			seenKeys.add(valKey);
			candidates.push({
				...base,
				testTypeIndex: box.typeIndex,
				isBoxedValue: true,
			});
		}
	}

	// The shallowest embedded type of `sInfo` (any depth) that declares
	// `methodName`: its name, the field path to reach it from an `sInfo`
	// struct, and whether that path goes through an embedded pointer. Null
	// when two embeds at that depth declare it (ambiguous, as in Go).
	_findPromotedMethod(sInfo, methodName) {
		let level = [{ info: sInfo, path: [], viaPointer: false }];
		const seen = new Set([sInfo]);
		while (level.length > 0) {
			const next = [];
			const hits = [];
			for (const { info, path, viaPointer } of level) {
				for (const embed of info.embeds ?? []) {
					const embedType = embed.typeName ?? embed.name;
					const goType = info.fields?.[embed.fieldIndex]?.goType;
					const isPtr =
						goType?.kind === "PointerType" || goType?.kind === "pointer";
					const step = {
						path: [
							...path,
							{
								parentTypeIndex: info.typeIndex,
								fieldIndex: embed.fieldIndex,
								// An embedded pointer may be nil: reading through it
								// is a recoverable nil dereference.
								...(isPtr && {
									ptrWType: info.fields[embed.fieldIndex].wType,
								}),
							},
						],
						viaPointer: viaPointer || isPtr,
					};
					if (this.embeddedInterfaceHas(goType, methodName)) {
						hits.push({ iface: true, embedPath: step.path, viaPointer: false });
						continue;
					}
					if (this.funcMap.has(`${embedType}.${methodName}`)) {
						hits.push({
							embedType,
							embedPath: step.path,
							viaPointer: step.viaPointer,
						});
						continue;
					}
					// A type reached twice at one depth stays twice in the next
					// level, so a diamond's method is ambiguous there too.
					const inner = this.structTypes.get(embedType);
					if (inner && !seen.has(inner)) next.push({ info: inner, ...step });
				}
			}
			if (hits.length > 0) return hits.length === 1 ? hits[0] : null;
			for (const n of next) seen.add(n.info);
			level = next;
		}
		return null;
	}

	// A value-receiver method of a named scalar is also in the method set of
	// the pointer: `var g Getter = &x` holds a pointer box whose target is read
	// before the call.
	_addPtrScalarCandidate(
		candidates,
		seenKeys,
		rName,
		rType,
		fIdx,
		paramWTypes,
	) {
		if (!isScalarType(rType, this.checker, this)) return;
		const ptrBox = this.getIfaceBoxType({ kind: "pointer", base: rType });
		const target = this.getBoxType(rType);
		const ptrKey = `ptr:${rName}`;
		if (!ptrBox || seenKeys.has(ptrKey)) return;
		seenKeys.add(ptrKey);
		candidates.push({
			recvTypeName: rName,
			testTypeIndex: ptrBox.typeIndex,
			isBoxedValue: true,
			nilPtrPanic: true,
			needsValueDeref: false,
			embedPath: [
				{
					castTypeIndex: target.typeIndex,
					parentTypeIndex: target.typeIndex,
					fieldIndex: 0,
				},
			],
			funcIndex: fIdx,
			targetParamTypes: paramWTypes,
		});
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
					// A typed nil `*S` is a marker object, which also satisfies it.
					candidates.push({
						name: `*${sName}`,
						typeIndex: sInfo.typeIndex,
						nilTypeIndex: this.getNilBoxType(ptrType).typeIndex,
					});
				}
			}

			// Check struct value (boxed)
			if (this._valueImplements(namedType, ifaceResolved)) {
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
					if (this.checker?.implements?.(tVal, ifaceResolved)) {
						const box = this._namedValueBox(tVal);
						if (box && !seen.has(box.typeIndex)) {
							seen.add(box.typeIndex);
							candidates.push({ name: tName, typeIndex: box.typeIndex });
						}
					}
					this._addPtrNamedImplementor(
						tVal,
						tName,
						ifaceResolved,
						seen,
						candidates,
					);
				}
			}
		}

		return candidates;
	}

	// The WebAssembly type a value of the named non-struct type `tVal` takes
	// inside an interface: a defined slice type is a tagged slice (see
	// getTaggedSliceType), anything else an interface box.
	_namedValueBox(tVal) {
		if (!isSliceType(tVal, this.checker)) return this.getIfaceBoxType(tVal);
		const elem = getSliceElemType(tVal, this.checker);
		return elem ? this.getTaggedSliceType(tVal, elem) : null;
	}

	// Whether the struct value `namedType` implements `iface`, including when its
	// pointer-receiver methods are promoted through an embedded pointer, which
	// puts them in the value's method set (`struct{ *Inner }`).
	_valueImplements(namedType, iface) {
		const checker = this.checker;
		if (checker?.implements?.(namedType, iface)) return true;
		const ptr = { kind: "pointer", base: namedType };
		if (!checker?.implements?.(ptr, iface)) return false;
		const st = checker.resolveType(namedType.underlying);
		const methods = st?.methods?.size ? st.methods : namedType.methods;
		const names = [...(iface.methods?.keys() ?? [])];
		return names.every(
			(n) =>
				!methods?.get(n)?._ptrRecv ||
				checker._promotedThroughPointer(namedType, n),
		);
	}

	// `*T` of a named scalar or slice is boxed apart from `T`.
	_addPtrNamedImplementor(tVal, tName, ifaceResolved, seen, candidates) {
		const ptrType = { kind: "pointer", base: tVal };
		if (
			!isScalarType(tVal, this.checker, this) &&
			!isSliceType(tVal, this.checker)
		)
			return;
		if (!this.checker?.implements?.(ptrType, ifaceResolved)) return;
		const box = this.getIfaceBoxType(ptrType);
		if (!box || seen.has(box.typeIndex)) return;
		seen.add(box.typeIndex);
		candidates.push({ name: `*${tName}`, typeIndex: box.typeIndex });
	}
}
