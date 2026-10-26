// src/backend/js/stdlib/json.js
// CodeGen for Go encoding/json package with compile-time static encoders and decoders.

import { typedArrayConstructorForElem } from "../../../typechecker/types.js";

function safeIdent(name) {
	return String(name || "").replace(/[^a-zA-Z0-9_$]/g, "_");
}

function declareCodec(fnName, params, body) {
	return `var ${fnName} = typeof ${fnName} !== "undefined" ? ${fnName} : function ${fnName}(${params}) {\n${body}\n};`;
}

function typeCodecName(t, fallback = "val") {
	if (!t) return fallback;
	if (t.kind === "pointer" && t.base) {
		return `${typeCodecName(t.base, fallback)}_ptr`;
	}
	if (t.name) return t.name;
	if (t.kind === "slice") return `slice_${typeCodecName(t.elem, "elem")}`;
	if (t.kind === "map")
		return `map_${typeCodecName(t.value ?? t.elem, "elem")}`;
	return fallback;
}

function unwrapNamed(t) {
	return t?.kind === "named" ? t.underlying : t;
}

function isRawMessageType(t) {
	return (
		t?.name === "json.RawMessage" || t?.name === "encoding/json.RawMessage"
	);
}

const NUMBER_NAMES = new Set(["json.Number", "encoding/json.Number"]);

function isNumberType(t) {
	if (!t) return false;
	const name = t.name ?? "";
	if (NUMBER_NAMES.has(name)) return true;
	if (name.startsWith("Number$$") || name.endsWith(".Number")) return true;
	return (
		t.kind === "named" && name === "Number" && unwrapNamed(t)?.name === "string"
	);
}

function isByteSliceType(t) {
	const base = unwrapNamed(t);
	return (
		base?.kind === "slice" &&
		(base.elem?.name === "byte" || base.elem?.name === "uint8") &&
		!isRawMessageType(t)
	);
}

function isJsonNullAssignable(type) {
	const base = unwrapNamed(type);
	return (
		base?.kind === "pointer" ||
		base?.kind === "slice" ||
		base?.kind === "map" ||
		base?.kind === "interface" ||
		(base?.kind === "basic" && base.name === "any")
	);
}

// Field kinds the `,string` tag option applies to (Go: bool, ints, uints, floats, string).
const QUOTABLE_KINDS = new Set([
	"string",
	"bool",
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
	"byte",
	"rune",
	"float32",
	"float64",
]);

// reflect's names for GoFront's basic aliases, used in decode error messages.
const BASIC_DISPLAY = { any: "interface {}", byte: "uint8", rune: "int32" };

// Basic kinds decoded by the typed scalar decoders.
const SCALAR_KINDS = QUOTABLE_KINDS;

// Methods live on the named type, or on its underlying struct for struct types.
function lookupMethod(type, name) {
	if (type?.kind !== "named") return null;
	return type.methods?.get(name) ?? type.underlying?.methods?.get(name) ?? null;
}

export const jsonMethods = {
	_genJson(fn, a, expr) {
		this.useHelper("json");
		this.useHelper("base64");
		this.useHelper("error");
		this._markJsonPtrRecvMarshalers();
		const args = a();
		if (fn === "Marshal") {
			const argType = expr.args[0]?._type;
			const enc = this._getJsonEncoder(argType);
			return `__json_marshal(${enc}, ${args[0]})`;
		}
		if (fn === "MarshalIndent") {
			const argType = expr.args[0]?._type;
			const enc = this._getJsonEncoder(argType);
			return `__json_marshal_indent(${enc}, ${args[0]}, ${args[1]}, ${args[2]})`;
		}
		if (fn === "Unmarshal") {
			const targetType = expr.args[1]?._type;
			const dec = this._getJsonDecoder(targetType);
			const typeName = targetType ? this._jsonTypeName(targetType) : "";
			return `__json_unmarshal(${dec}, ${args[0]}, ${args[1]}, ${JSON.stringify(typeName)})`;
		}
		if (fn === "Valid") {
			return `__json_valid(${args[0]})`;
		}
		return undefined;
	},

	_getJsonEncoder(type, addr = false) {
		if (!type) return "__json_enc_any";
		if (isNumberType(type)) return "__json_enc_number";
		if (isRawMessageType(type)) {
			const fnName = "__json_enc_RawMessage";
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"v",
						`  if (v === null || v === undefined) return "null";\n  var s = (typeof v === "string" ? v : new TextDecoder().decode(v)).trim();\n  return s.length > 0 ? s : "null";`,
					),
				);
			}
			return fnName;
		}

		// Go calls a pointer-receiver MarshalJSON only on addressable values.
		const marshaler = this._jsonMarshalerInfo(type);
		if (marshaler && (!marshaler.ptrRecv || addr)) {
			return this._getMarshalerEncoder(type, marshaler);
		}

		const base = unwrapNamed(type);
		if (isByteSliceType(type)) return "__json_b64";

		if (base?.kind === "struct") {
			const needsAddr = addr && this._jsonNeedsAddr(type);
			const typeName = safeIdent((type.name ?? "AnonStruct").split(".").pop());
			const fnName = `__json_enc_${typeName}${needsAddr ? "_addr" : ""}`;
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(fnName, "");
				const code = this._buildStructEncoder(type, fnName, needsAddr);
				this._jsonCodecs.set(fnName, code);
			}
			return fnName;
		}

		if (type.kind === "pointer" && type.base) {
			const innerEnc = this._getJsonEncoder(type.base, true);
			// Pointers to structs are the struct object; other pointers are { value } boxes.
			const deref = unwrapNamed(type.base)?.kind === "struct" ? "v" : "v.value";
			const fnName = `__json_enc_ptr_${safeIdent(typeCodecName(type.base, "val").split(".").pop())}`;
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"v",
						`  return (v === null || v === undefined) ? "null" : ${innerEnc}(${deref});`,
					),
				);
			}
			return fnName;
		}

		if (base?.kind === "slice") {
			const elemEnc = this._getJsonEncoder(base.elem, true);
			const fnName = `__json_enc_slice_${safeIdent(typeCodecName(base.elem, "elem").split(".").pop())}`;
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"v",
						`  return __json_enc_slice(v, ${elemEnc});`,
					),
				);
			}
			return fnName;
		}

		if (base?.kind === "map") {
			const valType = base.value ?? base.elem;
			const valEnc = this._getJsonEncoder(valType, false);
			const fnName = `__json_enc_map_${safeIdent(typeCodecName(valType, "val").split(".").pop())}`;
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(
					fnName,
					declareCodec(fnName, "v", `  return __json_enc_map(v, ${valEnc});`),
				);
			}
			return fnName;
		}

		if (base?.kind === "basic") {
			return this._getBasicEncoder(base.name);
		}

		return "__json_enc_any";
	},

	// Tags pointer-receiver MarshalJSON methods so the dynamic `any` encoder can skip
	// them for non-addressable values, as Go does.
	_markJsonPtrRecvMarshalers() {
		if (this._jsonPtrRecvMarked) return;
		this._jsonPtrRecvMarked = true;
		for (const [name, type] of this.checker?.types ?? []) {
			if (name.includes(".") || type?.kind !== "named") continue;
			if (!lookupMethod(type, "MarshalJSON")?._ptrRecv) continue;
			const cls = safeIdent(name);
			this._jsonCodecs.set(
				`__json_ptrrecv_${cls}`,
				`if (typeof ${cls} === "function" && ${cls}.prototype.MarshalJSON) ${cls}.prototype.MarshalJSON.__ptrRecv = true;`,
			);
		}
	},

	_jsonTypeName(type) {
		const name = type?.name ?? "value";
		const at = name.indexOf("$$");
		if (at >= 0) {
			const orig = name.slice(0, at);
			const modPath = name.slice(at + 2).replaceAll("$", "/");
			return `${modPath}.${orig}`;
		}
		if (name.includes(".")) return name;
		const pkg = this.checker?.pkgName;
		return pkg ? `${pkg}.${name}` : name;
	},

	_jsonClassName(type) {
		return String(type?.name ?? "Object")
			.split(".")
			.pop();
	},

	// How to call `name` (MarshalJSON / UnmarshalJSON) on values of `type`, or null.
	// Struct types dispatch on the instance; named non-struct types (raw values)
	// call the static `T.$name(recv, ...)` with a { value } box for pointer receivers.
	_jsonMethodInfo(type, name) {
		const method = lookupMethod(type, name);
		if (!method || isRawMessageType(type)) return null;
		const isStruct = type.underlying?.kind === "struct";
		if (!isStruct && !this._namedBoxInfo(type)) return null;
		return {
			ptrRecv: Boolean(method._ptrRecv),
			isStruct,
			cls: this._jsonClassName(type),
		};
	},

	_jsonMarshalerInfo(type) {
		return this._jsonMethodInfo(type, "MarshalJSON");
	},

	_jsonUnmarshalerInfo(type) {
		return this._jsonMethodInfo(type, "UnmarshalJSON");
	},

	// UnmarshalJSON call for a target reachable through `addrExpr`: the struct
	// instance for struct types, a { value } box otherwise.
	_jsonUnmarshalCall(info, addrExpr, bytesExpr) {
		if (info.isStruct) return `${addrExpr}.UnmarshalJSON(${bytesExpr})`;
		const recv = info.ptrRecv ? addrExpr : `${addrExpr}.value`;
		return `${info.cls}.$UnmarshalJSON(${recv}, ${bytesExpr})`;
	},

	// True when encoding an addressable `type` differs from a non-addressable one,
	// i.e. it (or a value field inside it) has a pointer-receiver MarshalJSON.
	_jsonNeedsAddr(type, seen = new Set()) {
		if (!type || seen.has(type)) return false;
		seen.add(type);
		const marshaler = this._jsonMarshalerInfo(type);
		if (marshaler) return marshaler.ptrRecv;
		const base = unwrapNamed(type);
		if (base?.kind !== "struct") return false;
		const fields = this.checker?.resolveJsonFields(base) ?? [];
		return fields.some((f) => this._jsonNeedsAddr(f.type, seen));
	},

	_getMarshalerEncoder(type, info) {
		const fnName = `__json_enc_${safeIdent(info.cls)}_marshal`;
		if (!this._jsonCodecs.has(fnName)) {
			let call;
			if (info.isStruct) {
				call = `  if (v === null || v === undefined) return "null";\n  var res = v.MarshalJSON();`;
			} else {
				const recv = info.ptrRecv ? "{ value: v }" : "v";
				call = `  var res = ${info.cls}.$MarshalJSON(${recv});`;
			}
			this._jsonCodecs.set(
				fnName,
				declareCodec(
					fnName,
					"v",
					`${call}\n  return __json_marshaler_out(res, ${JSON.stringify(this._jsonTypeName(type))});`,
				),
			);
		}
		return fnName;
	},

	_getUnmarshalerDecoder(type) {
		const info = this._jsonUnmarshalerInfo(type);
		const fnName = `__json_dec_${safeIdent(info.cls)}_unmarshal`;
		if (!this._jsonCodecs.has(fnName)) {
			const bytes =
				"__json_raw_bytes(rawStr !== undefined ? rawStr : JSON.stringify(parsed))";
			const body = info.isStruct
				? `  var inst = target && typeof target === "object" ? target : new ${info.cls}();\n  var err = ${this._jsonUnmarshalCall(info, "inst", bytes)};\n  if (err) return __json_user_err(err);\n  if (box) box.value = inst;\n  return null;`
				: `  var addr = box || { value: target };\n  var err = ${this._jsonUnmarshalCall(info, "addr", bytes)};\n  if (err) return __json_user_err(err);\n  return null;`;
			this._jsonCodecs.set(
				fnName,
				declareCodec(fnName, "parsed, target, box, rawData, rawStr", body),
			);
		}
		return fnName;
	},

	_unmarshalerElemDecoder(elemType) {
		const isPtr = elemType?.kind === "pointer";
		const valueType = isPtr ? elemType.base : elemType;
		const info = this._jsonUnmarshalerInfo(valueType);
		if (!info) return null;
		let make;
		if (info.isStruct) {
			make = (rawExpr) =>
				`(() => { var inst = new ${info.cls}(); var uerr = ${this._jsonUnmarshalCall(info, "inst", `__json_raw_bytes(${rawExpr})`)}; return uerr ? __json_user_err(uerr) : inst; })()`;
		} else {
			// Pointer elements are the { value } box itself; value elements its value.
			const zero = this.zeroValueForType(valueType);
			const result = isPtr ? "__b" : "__b.value";
			make = (rawExpr) =>
				`(() => { var __b = { value: ${zero} }; var uerr = ${this._jsonUnmarshalCall(info, "__b", `__json_raw_bytes(${rawExpr})`)}; return uerr ? __json_user_err(uerr) : ${result}; })()`;
		}
		if (isPtr)
			return (v, rawExpr) => `(${v} === null ? null : ${make(rawExpr)})`;
		return (_v, rawExpr) => make(rawExpr);
	},

	// Returns the basic kind a `,string` field is quoted as, or null if the option does not apply.
	_jsonQuotedKind(f) {
		if (!f.quoted) return null;
		const t = f.type?.kind === "pointer" ? f.type.base : f.type;
		if (this._jsonMarshalerInfo(t)) return null;
		const base = unwrapNamed(t);
		return base?.kind === "basic" && QUOTABLE_KINDS.has(base.name)
			? base.name
			: null;
	},

	_genQuotedFieldEncoderExpr(f, kind) {
		const isPtr = f.type?.kind === "pointer";
		const basic = this._genBasicFieldExpr(kind);
		const quote = (x) => {
			const inner = basic(x);
			return kind === "string"
				? `__json_esc_noh(${inner})`
				: `('"' + ${inner} + '"')`;
		};
		if (!isPtr) return quote;
		return (v) =>
			`(${v} === null || ${v} === undefined ? "null" : ${quote(`${v}.value`)})`;
	},

	_getBasicEncoder(basicName) {
		switch (basicName) {
			case "string":
				return "__json_esc";
			case "bool":
				return "(v => v ? 'true' : 'false')";
			case "int":
			case "int8":
			case "int16":
			case "int32":
			case "uint":
			case "uint8":
			case "uint16":
			case "uint32":
			case "byte":
			case "rune":
				return "(v => String(Math.trunc(v)))";
			case "int64":
			case "uint64":
				return "(v => typeof v === 'bigint' ? v.toString() : String(v))";
			case "float32":
				return "__json_float32";
			case "float64":
				return "(v => { if (!isFinite(v)) throw __json_unsupported_value(String(v)); return String(v); })";
			default:
				return "__json_enc_any";
		}
	},

	_buildStructEncoder(structType, fnName, addr = false) {
		const underlying = unwrapNamed(structType);
		const fields = this.checker?.resolveJsonFields(underlying) ?? [];
		const lines = [];
		lines.push(
			`var ${fnName} = typeof ${fnName} !== "undefined" ? ${fnName} : function ${fnName}(v) {`,
		);
		lines.push(`  if (v === null || v === undefined) return "null";`);
		lines.push(`  var parts = [];`);

		for (const f of fields) {
			const keyLiteral = JSON.stringify(`${JSON.stringify(f.jsonKey)}:`);
			const encodeVal = this._genFieldEncoderExpr(f, addr);
			const isStruct = unwrapNamed(f.type)?.kind === "struct";

			this._emitFieldEncoderAccess(f, lines, (valName) => {
				const encoded = encodeVal(valName);
				if (f.omitempty) {
					return `if (!__json_is_zero(${valName}, ${isStruct})) parts.push(${keyLiteral} + ${encoded});`;
				}
				return `parts.push(${keyLiteral} + ${encoded});`;
			});
		}

		lines.push(`  return "{" + parts.join(",") + "}";`);
		lines.push(`};`);
		return lines.join("\n");
	},

	_emitFieldEncoderAccess(f, lines, onVal) {
		const path = f.path ?? [{ name: f.goName, isPtr: false }];
		if (f.isEmbedded && f.tagged) {
			lines.push(
				`  { var val = (v.${f.goName} !== undefined ? v.${f.goName} : v); ${onVal("val")} }`,
			);
			return;
		}
		if (path.length === 1) {
			lines.push(`  { var val = v.${path[0].name}; ${onVal("val")} }`);
			return;
		}

		// Promoted fields from embedded struct
		const ptrSegs = path.slice(0, -1).filter((s) => s.isPtr);
		const nilChecks = ptrSegs.map((s) => `v.${s.name} === null`);

		let cur = "v";
		const conds = [];
		for (let i = 0; i < path.length - 1; i++) {
			const seg = path[i];
			conds.push(`${cur}.${seg.name} != null`);
			cur = `${cur}.${seg.name}`;
		}
		const leaf = `${cur}.${path[path.length - 1].name}`;

		if (nilChecks.length > 0) {
			lines.push(`  if (!(${nilChecks.join(" || ")})) {`);
			lines.push(
				`    var val = (v.${f.goName} !== undefined ? v.${f.goName} : (${conds.join(" && ")} ? ${leaf} : undefined));`,
			);
			lines.push(`    if (val !== undefined) { ${onVal("val")} }`);
			lines.push(`  }`);
		} else {
			lines.push(
				`  { var val = (v.${f.goName} !== undefined ? v.${f.goName} : (${conds.join(" && ")} ? ${leaf} : undefined)); if (val !== undefined) { ${onVal("val")} } }`,
			);
		}
	},

	_genFieldEncoderExpr(f, addr = false) {
		const quotedKind = this._jsonQuotedKind(f);
		if (quotedKind) return this._genQuotedFieldEncoderExpr(f, quotedKind);
		if (isNumberType(f.type)) return (v) => `__json_enc_number(${v})`;
		if (isRawMessageType(f.type)) {
			return (v) =>
				`((typeof ${v} === "string" ? ${v} : new TextDecoder().decode(${v})).trim() || "null")`;
		}
		// Marshalers and pointers go through the shared encoders.
		const special =
			f.type?.kind === "pointer" ||
			(f.type?.kind === "named" && this._jsonMarshalerInfo(f.type));
		if (special) {
			const enc = this._getJsonEncoder(f.type, addr);
			return (v) => `${enc}(${v})`;
		}
		if (isByteSliceType(f.type)) {
			return (v) => `__json_b64(${v})`;
		}
		const base = unwrapNamed(f.type);
		if (base?.kind === "basic") {
			return this._genBasicFieldExpr(base.name);
		}
		if (base?.kind === "struct") {
			const enc = this._getJsonEncoder(f.type, addr);
			return (v) => `${enc}(${v})`;
		}
		if (base?.kind === "slice") {
			const enc = this._getJsonEncoder(base.elem, true);
			return (v) => `__json_enc_slice(${v}, ${enc})`;
		}
		if (base?.kind === "map") {
			const enc = this._getJsonEncoder(base.value ?? base.elem, false);
			return (v) => `__json_enc_map(${v}, ${enc})`;
		}
		return (v) => `__json_enc_any(${v})`;
	},

	_genBasicFieldExpr(name) {
		switch (name) {
			case "string":
				return (v) => `__json_esc(${v})`;
			case "bool":
				return (v) => `(${v} ? "true" : "false")`;
			case "int":
			case "int8":
			case "int16":
			case "int32":
			case "uint":
			case "uint8":
			case "uint16":
			case "uint32":
			case "byte":
			case "rune":
				return (v) => `String(Math.trunc(${v}))`;
			case "int64":
			case "uint64":
				return (v) =>
					`(typeof ${v} === "bigint" ? ${v}.toString() : String(${v}))`;
			case "float32":
				return (v) => `__json_float32(${v})`;
			case "float64":
				return (v) =>
					`(!isFinite(${v}) ? (() => { throw __json_unsupported_value(String(${v})); })() : String(${v}))`;
			default:
				return (v) => `__json_enc_any(${v})`;
		}
	},

	_getJsonDecoder(targetType) {
		if (!targetType) return "__json_dec_any_target";
		const baseType =
			targetType.kind === "pointer" ? targetType.base : targetType;
		if (!baseType) return "__json_dec_any_target";

		if (isNumberType(baseType)) {
			return "__json_dec_number";
		}

		if (this._jsonUnmarshalerInfo(baseType)) {
			return this._getUnmarshalerDecoder(baseType);
		}

		if (isRawMessageType(baseType)) {
			const fnName = "__json_dec_RawMessage";
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"parsed, target, box, rawData",
						`  var u8 = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);\n  u8.__raw = true;\n  if (box) box.value = u8;\n  return null;`,
					),
				);
			}
			return fnName;
		}

		if (isByteSliceType(baseType)) {
			const fnName = "__json_dec_byte_slice";
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"parsed, target, box",
						`  if (parsed === null) { if (box) box.value = null; return null; }\n  var u8 = __json_bytes_decode(parsed);\n  if (u8 && u8._msg) return u8;\n  if (box) box.value = u8;\n  return null;`,
					),
				);
			}
			return fnName;
		}

		const base = unwrapNamed(baseType);
		if (base?.kind === "struct") {
			const typeName = safeIdent(
				(baseType.name ?? "AnonStruct").split(".").pop(),
			);
			const fnName = `__json_dec_${typeName}`;
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(fnName, "");
				const code = this._buildStructDecoder(baseType, fnName);
				this._jsonCodecs.set(fnName, code);
			}
			return fnName;
		}

		if (base?.kind === "slice") return this._getSliceDecoder(base);
		if (base?.kind === "map") return this._getMapDecoder(base);
		// Top-level scalar targets (`json.Unmarshal(b, &n)`) are type-checked too.
		if (base?.kind === "basic" && SCALAR_KINDS.has(base.name))
			return this._getScalarDecoder(baseType, base);

		return "__json_dec_any_target";
	},

	_getSliceDecoder(base) {
		const elemTypeName = typeCodecName(base.elem, "elem");
		const fnName = `__json_dec_slice_${safeIdent(elemTypeName.split(".").pop())}`;
		if (!this._jsonCodecs.has(fnName)) {
			const elemDec = this._genElemDecoder(base.elem);
			const typedCtor = typedArrayConstructorForElem(base.elem);
			const initOut = typedCtor ? `new ${typedCtor}(parsed.length)` : `[]`;
			const setElem = typedCtor ? `out[i] = item;` : `out.push(item);`;
			const display = JSON.stringify(`[]${this._jsonDisplayType(base.elem)}`);
			this._jsonCodecs.set(
				fnName,
				declareCodec(
					fnName,
					"parsed, target, box",
					`  if (parsed === null) { if (box) box.value = null; return null; }\n  if (!Array.isArray(parsed)) return __json_err("cannot unmarshal " + __json_type(parsed) + " into " + __json_ctx(${display}));\n  var out = ${initOut};\n  for (var i = 0; i < parsed.length; i++) {\n    var item = ${elemDec("parsed[i]", "__json_raw_child(parsed, i)")};\n    if (item && item._msg) return item;\n    ${setElem}\n  }\n  if (box) box.value = out;\n  return null;`,
				),
			);
		}
		return fnName;
	},

	_getMapDecoder(base) {
		const valType = base.value ?? base.elem;
		const valTypeName = typeCodecName(valType, "val");
		const fnName = `__json_dec_map_${safeIdent(valTypeName.split(".").pop())}`;
		if (!this._jsonCodecs.has(fnName)) {
			const valDec = this._genElemDecoder(valType);
			const display = JSON.stringify(
				`map[string]${this._jsonDisplayType(valType)}`,
			);
			this._jsonCodecs.set(
				fnName,
				declareCodec(
					fnName,
					"parsed, target, box",
					`  if (parsed === null) { if (box) box.value = null; return null; }\n  if (typeof parsed !== "object" || Array.isArray(parsed)) return __json_err("cannot unmarshal " + __json_type(parsed) + " into " + __json_ctx(${display}));\n  var out = Object.create(null); out.__map = true;\n  for (var k in parsed) {\n    if (Object.prototype.hasOwnProperty.call(parsed, k)) {\n      var item = ${valDec("parsed[k]", "__json_raw_child(parsed, k)")};\n      if (item && item._msg) return item;\n      out[k] = item;\n    }\n  }\n  if (box) box.value = out;\n  return null;`,
				),
			);
		}
		return fnName;
	},

	_getScalarDecoder(baseType, base) {
		const display = this._jsonDisplayType(baseType);
		const fnName = `__json_dec_scalar_${safeIdent(display)}`;
		if (!this._jsonCodecs.has(fnName)) {
			this._jsonCodecs.set(
				fnName,
				declareCodec(
					fnName,
					"parsed, target, box, rawData, rawStr",
					`  if (parsed === null) return null;\n  var dv = ${this._jsonScalarDecodeExpr(base.name, display, "parsed", "rawStr")};\n  if (dv && dv._msg) return dv;\n  if (box) box.value = dv;\n  return null;`,
				),
			);
		}
		return fnName;
	},

	// Go-style display of a type in decode error messages (reflect's Type.String()).
	_jsonDisplayType(t) {
		if (!t) return "interface {}";
		if (t.kind === "pointer") return `*${this._jsonDisplayType(t.base)}`;
		if (t.kind === "named") return this._jsonTypeName(t);
		if (t.kind === "basic") return BASIC_DISPLAY[t.name] ?? t.name;
		if (t.kind === "slice") return `[]${this._jsonDisplayType(t.elem)}`;
		if (t.kind === "map")
			return `map[${this._jsonDisplayType(t.key)}]${this._jsonDisplayType(t.value ?? t.elem)}`;
		return "interface {}";
	},

	// Decodes one parsed JSON scalar into `kind`; yields the value or an error (`_msg`).
	_jsonScalarDecodeExpr(kind, display, v, rawExpr) {
		const d = JSON.stringify(display);
		const raw = rawExpr ?? "undefined";
		switch (kind) {
			case "string":
				return `(typeof ${v} === "string" && !${v}.endsWith("__bigint") ? ${v} : __json_err("cannot unmarshal " + __json_type(${v}) + " into " + __json_ctx(${d})))`;
			case "bool":
				return `(typeof ${v} === "boolean" ? ${v} : __json_err("cannot unmarshal " + __json_type(${v}) + " into " + __json_ctx(${d})))`;
			case "float32":
				return `__json_float_decode(${v}, 32, ${d}, ${raw})`;
			case "float64":
				return `__json_float_decode(${v}, 64, ${d}, ${raw})`;
			default:
				return `__json_int_decode(${v}, ${JSON.stringify(kind)}, ${d}, ${raw})`;
		}
	},

	_genElemDecoder(elemType) {
		if (!elemType) return (v) => `__json_dec_any(${v})`;
		if (isNumberType(elemType))
			return (v, rawExpr) =>
				`__json_number_decode(${v}, "json.Number", ${rawExpr})`;
		const unmarshaler = this._unmarshalerElemDecoder(elemType);
		if (unmarshaler) return unmarshaler;
		if (isRawMessageType(elemType)) {
			return (_v, rawExpr) => `__json_raw_bytes(${rawExpr})`;
		}
		if (isByteSliceType(elemType)) {
			return (v) => `(${v} === null ? null : __json_bytes_decode(${v}))`;
		}
		const base = unwrapNamed(elemType);
		if (base?.kind === "basic" && SCALAR_KINDS.has(base.name)) {
			const display = this._jsonDisplayType(elemType);
			return (v, rawExpr) =>
				this._jsonScalarDecodeExpr(base.name, display, v, rawExpr);
		}
		if (elemType?.kind === "pointer" && elemType.base) {
			const innerBase = unwrapNamed(elemType.base);
			if (innerBase?.kind === "struct") {
				const dec = this._getJsonDecoder(elemType.base);
				const structName = elemType.base.name?.split(".").pop() ?? "Object";
				return (v) =>
					`(${v} === null ? null : (() => { var inst = new ${structName}(); var err = ${dec}(${v}, inst); return err || inst; })())`;
			}
			if (innerBase?.kind === "basic") {
				const basicDec = this._genElemDecoder(elemType.base);
				return (v, rawExpr) =>
					`(${v} === null ? null : (() => { var item = ${basicDec(v, rawExpr)}; return item && item._msg ? item : { value: item, __p: true }; })())`;
			}
		}
		if (base?.kind === "struct") {
			const dec = this._getJsonDecoder(elemType);
			const structName = elemType.name?.split(".").pop() ?? "Object";
			return (v) =>
				`(() => { var inst = new ${structName}(); var err = ${dec}(${v}, inst); return err || inst; })()`;
		}
		return (v) => `__json_dec_any(${v})`;
	},

	_buildStructDecoder(structType, fnName) {
		const underlying = unwrapNamed(structType);
		const fields = this.checker?.resolveJsonFields(underlying) ?? [];
		const structName = structType.name?.split(".").pop() ?? "T";
		const lines = [];
		lines.push(
			`var ${fnName} = typeof ${fnName} !== "undefined" ? ${fnName} : function ${fnName}(parsed, target, box) {`,
		);
		lines.push(
			`  if (parsed === null) { if (box) box.value = null; return null; }`,
		);
		lines.push(`  if (typeof parsed !== "object" || Array.isArray(parsed)) {`);
		lines.push(
			`    return __json_err("cannot unmarshal " + __json_type(parsed) + " into " + __json_ctx(${JSON.stringify(this._jsonDisplayType(structType))}));`,
		);
		lines.push(`  }`);
		const knownKeys = fields.flatMap((f) => [f.jsonKey, f.goName]);
		lines.push(
			`  var disallowErr = __json_check_unknown(parsed, ${JSON.stringify(knownKeys)});`,
		);
		lines.push(`  if (disallowErr) return disallowErr;`);
		// Go reports errors as "Go struct field <innermost struct>.<json key path>".
		lines.push(`  __json_structs.push(${JSON.stringify(structName)});`);
		lines.push(`  try {`);

		for (const f of fields) {
			const key = JSON.stringify(f.jsonKey);
			const goName = JSON.stringify(f.goName);
			lines.push(
				`  { var fieldKey = __json_match_field(parsed, ${key}, ${goName}); if (fieldKey !== null) {`,
			);
			lines.push(`    __json_path.push(${key});`);
			lines.push(`    try {`);
			lines.push(`    var val = parsed[fieldKey];`);
			lines.push(`    var raw = __json_raw_child(parsed, fieldKey);`);
			lines.push(
				`    __json_current_offset = __json_raw_end(parsed, fieldKey) || 0;`,
			);
			const quotedKind = this._jsonQuotedKind(f);
			if (quotedKind) {
				const valueType = f.type?.kind === "pointer" ? f.type.base : f.type;
				const typeStr = this._jsonDisplayType(valueType);
				lines.push(
					`    var q = __json_unquote(val, ${JSON.stringify(quotedKind)}, ${JSON.stringify(typeStr)}); if (q && q._msg) return q; val = q.v; raw = q.lit;`,
				);
			}
			lines.push(`    if (val !== null) {`);
			this._emitFieldDecoder(f, structName, lines, "raw");
			lines.push(`    } else {`);
			this._emitFieldNull(f, lines, "raw");
			lines.push(`    }`);
			lines.push(`    } finally { __json_path.pop(); }`);
			lines.push(`  }`);
			lines.push(`  }`);
		}

		lines.push(`  } finally { __json_structs.pop(); }`);
		lines.push(`  return null;`);
		lines.push(`};`);
		return lines.join("\n");
	},

	_emitUnmarshalerField(f, lines, rawExpr) {
		const isPtr = f.type?.kind === "pointer";
		const valueType = isPtr ? f.type.base : f.type;
		const info = this._jsonUnmarshalerInfo(valueType);
		const bytes = `__json_raw_bytes(${rawExpr})`;
		if (info.isStruct) {
			lines.push(`      var sub = target.${f.goName};`);
			lines.push(
				`      if (!sub) { sub = new ${info.cls}(); target.${f.goName} = sub; }`,
			);
			lines.push(
				`      var uerr = ${this._jsonUnmarshalCall(info, "sub", bytes)};`,
			);
		} else if (isPtr) {
			lines.push(`      var sub = target.${f.goName};`);
			lines.push(
				`      if (!sub) { sub = { value: ${this.zeroValueForType(valueType)} }; target.${f.goName} = sub; }`,
			);
			lines.push(
				`      var uerr = ${this._jsonUnmarshalCall(info, "sub", bytes)};`,
			);
		} else {
			lines.push(
				`      var addr = { get value() { return target.${f.goName}; }, set value(__v) { target.${f.goName} = __v; } };`,
			);
			lines.push(
				`      var uerr = ${this._jsonUnmarshalCall(info, "addr", bytes)};`,
			);
		}
		lines.push(`      if (uerr) return __json_user_err(uerr);`);
		if (f.isEmbedded && info.isStruct) {
			lines.push(`      Object.assign(target, sub);`);
		}
	},

	_emitNumberFieldDecoder(f, lines, rawExpr) {
		lines.push(
			`      var nv = __json_number_decode(val, "json.Number", ${rawExpr}); if (nv && nv._msg) return nv;`,
		);
		const val = f.type?.kind === "pointer" ? "{ value: nv }" : "nv";
		this._emitAssign(f, val, lines);
	},

	_emitFieldDecoder(f, structName, lines, rawExpr) {
		const valueType = f.type?.kind === "pointer" ? f.type.base : f.type;
		if (this._jsonUnmarshalerInfo(valueType)) {
			this._emitUnmarshalerField(f, lines, rawExpr);
			return;
		}
		if (isNumberType(valueType)) {
			this._emitNumberFieldDecoder(f, lines, rawExpr);
			return;
		}
		if (isRawMessageType(f.type)) {
			lines.push(
				`      var rawBytes = __json_raw_bytes(${rawExpr}); rawBytes.__raw = true;`,
			);
			this._emitAssign(f, "rawBytes", lines);
			return;
		}
		if (isByteSliceType(f.type)) {
			lines.push(`      var u8v = __json_bytes_decode(val);`);
			lines.push(`      if (u8v && u8v._msg) return u8v;`);
			this._emitAssign(f, "u8v", lines);
			return;
		}

		const base = unwrapNamed(f.type);
		if (base?.kind === "basic") {
			this._emitBasicFieldDecoder(f, base.name, structName, lines);
			return;
		}

		if (f.type?.kind === "pointer" && f.type.base) {
			const innerBase = unwrapNamed(f.type.base);
			if (innerBase?.kind === "basic") {
				this._emitPointerBasicFieldDecoder(
					f,
					innerBase.name,
					structName,
					lines,
				);
				return;
			}
			if (innerBase?.kind === "struct") {
				const innerName = f.type.base.name?.split(".").pop() ?? "Object";
				const dec = this._getJsonDecoder(f.type.base);
				lines.push(`      var sub = target.${f.goName};`);
				lines.push(
					`      if (!sub) { sub = new ${innerName}(); target.${f.goName} = sub; }`,
				);
				lines.push(`      var err = ${dec}(val, sub);`);
				lines.push(`      if (err) return err;`);
				if (f.isEmbedded) {
					lines.push(`      Object.assign(target, sub);`);
				}
				return;
			}
		}

		if (base?.kind === "struct") {
			const innerName = f.type.name?.split(".").pop() ?? "Object";
			const dec = this._getJsonDecoder(f.type);
			lines.push(`      var sub = target.${f.goName};`);
			lines.push(
				`      if (!sub) { sub = new ${innerName}(); target.${f.goName} = sub; }`,
			);
			lines.push(`      var err = ${dec}(val, sub);`);
			lines.push(`      if (err) return err;`);
			if (f.isEmbedded) {
				lines.push(`      Object.assign(target, sub);`);
			}
			return;
		}

		if (base?.kind === "slice") {
			const dec = this._getJsonDecoder(f.type);
			lines.push(`      var box = { value: null };`);
			lines.push(`      var err = ${dec}(val, null, box);`);
			lines.push(`      if (err) return err;`);
			this._emitAssign(f, "box.value", lines);
			return;
		}

		if (base?.kind === "map") {
			const dec = this._getJsonDecoder(f.type);
			lines.push(`      var box = { value: null };`);
			lines.push(`      var err = ${dec}(val, null, box);`);
			lines.push(`      if (err) return err;`);
			this._emitAssign(f, "box.value", lines);
			return;
		}

		this._emitAssign(f, "__json_dec_any(val)", lines);
	},

	// `*T` scalar fields: Go reports the element type in errors.
	_emitPointerBasicFieldDecoder(f, basicName, _structName, lines) {
		if (!SCALAR_KINDS.has(basicName)) {
			this._emitAssign(f, "__json_dec_any(val)", lines);
			return;
		}
		const display = this._jsonDisplayType(f.type.base);
		lines.push(
			`      var dv = ${this._jsonScalarDecodeExpr(basicName, display, "val", "raw")};`,
		);
		lines.push(`      if (dv && dv._msg) return dv;`);
		this._emitAssign(f, "{ value: dv, __p: true }", lines);
	},

	_emitBasicFieldDecoder(f, basicName, _structName, lines) {
		if (!SCALAR_KINDS.has(basicName)) {
			this._emitAssign(f, "__json_dec_any(val)", lines);
			return;
		}
		const display = this._jsonDisplayType(f.type);
		lines.push(
			`      var dv = ${this._jsonScalarDecodeExpr(basicName, display, "val", "raw")};`,
		);
		lines.push(`      if (dv && dv._msg) return dv;`);
		this._emitAssign(f, "dv", lines);
	},

	_emitAssign(f, expr, lines) {
		const path = f.path ?? [{ name: f.goName, isPtr: false }];
		if (path.length === 1) {
			lines.push(`      target.${f.goName} = ${expr};`);
			return;
		}

		for (let i = 0; i < path.length - 1; i++) {
			const seg = path[i];
			const curPath = `target.${path
				.slice(0, i + 1)
				.map((p) => p.name)
				.join(".")}`;
			const ctor = seg.typeName || seg.name;
			const initVal = ctor && ctor !== "Object" ? `new ${ctor}()` : `{}`;
			lines.push(`      if (${curPath} == null) ${curPath} = ${initVal};`);
		}
		lines.push(`      target.${path.map((p) => p.name).join(".")} = ${expr};`);
		lines.push(`      target.${f.goName} = ${expr};`);
	},

	_emitFieldNull(f, lines, rawExpr) {
		// Go hands JSON null to UnmarshalJSON for non-pointer fields; nil pointers stay nil.
		if (f.type?.kind !== "pointer" && this._jsonUnmarshalerInfo(f.type)) {
			this._emitUnmarshalerField(f, lines, `"null"`);
			return;
		}
		if (isRawMessageType(f.type)) {
			lines.push(
				`      var rawNull = __json_raw_bytes(${rawExpr}); rawNull.__raw = true;`,
			);
			this._emitAssign(f, "rawNull", lines);
			return;
		}
		if (!isJsonNullAssignable(f.type)) return;
		const path = f.path ?? [{ name: f.goName, isPtr: false }];
		if (path.length === 1) {
			lines.push(`      target.${f.goName} = null;`);
			return;
		}
		lines.push(
			`      target.${path.map((p) => p.name).join(".")} = null; target.${f.goName} = null;`,
		);
	},
};
