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

function isByteSliceType(t) {
	const base = unwrapNamed(t);
	return (
		base?.kind === "slice" &&
		(base.elem?.name === "byte" || base.elem?.name === "uint8") &&
		!isRawMessageType(t)
	);
}

export const jsonMethods = {
	_genJson(fn, a, expr) {
		this.useHelper("json");
		this.useHelper("base64");
		this.useHelper("error");
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
			return `__json_unmarshal(${dec}, ${args[0]}, ${args[1]})`;
		}
		if (fn === "Valid") {
			return `__json_valid(${args[0]})`;
		}
		return undefined;
	},

	_getJsonEncoder(type) {
		if (!type) return "__json_enc_any";
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

		const base = unwrapNamed(type);
		if (isByteSliceType(type)) return "__json_b64";

		if (base?.kind === "struct") {
			const typeName = safeIdent((type.name ?? "AnonStruct").split(".").pop());
			const fnName = `__json_enc_${typeName}`;
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(fnName, "");
				const code = this._buildStructEncoder(type, fnName);
				this._jsonCodecs.set(fnName, code);
			}
			return fnName;
		}

		if (type.kind === "pointer" && type.base) {
			const innerEnc = this._getJsonEncoder(type.base);
			if (innerEnc === "__json_enc_any") return "__json_enc_any";
			const fnName = `${innerEnc}_ptr`;
			if (!this._jsonCodecs.has(fnName)) {
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"v",
						`  return (v === null || v === undefined) ? "null" : ${innerEnc}(v);`,
					),
				);
			}
			return fnName;
		}

		if (base?.kind === "slice") {
			const elemEnc = this._getJsonEncoder(base.elem);
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
			const valEnc = this._getJsonEncoder(valType);
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
			case "float64":
				return "(v => { if (!isFinite(v)) throw new Error('json: unsupported value: ' + v); return String(v); })";
			default:
				return "__json_enc_any";
		}
	},

	_buildStructEncoder(structType, fnName) {
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
			const encodeVal = this._genFieldEncoderExpr(f);
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

	_genFieldEncoderExpr(f) {
		if (isRawMessageType(f.type)) {
			return (v) =>
				`((typeof ${v} === "string" ? ${v} : new TextDecoder().decode(${v})).trim() || "null")`;
		}
		if (isByteSliceType(f.type)) {
			return (v) => `__json_b64(${v})`;
		}
		const base = unwrapNamed(f.type);
		if (base?.kind === "basic") {
			return this._genBasicFieldExpr(base.name);
		}
		if (base?.kind === "struct") {
			const enc = this._getJsonEncoder(f.type);
			return (v) => `${enc}(${v})`;
		}
		if (f.type?.kind === "pointer" && f.type.base) {
			const enc = this._getJsonEncoder(f.type.base);
			return (v) =>
				`(${v} === null || ${v} === undefined ? "null" : ${enc}(${v}))`;
		}
		if (base?.kind === "slice") {
			const enc = this._getJsonEncoder(base.elem);
			return (v) => `__json_enc_slice(${v}, ${enc})`;
		}
		if (base?.kind === "map") {
			const enc = this._getJsonEncoder(base.value ?? base.elem);
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
			case "float64":
				return (v) =>
					`(!isFinite(${v}) ? (() => { throw new Error("json: unsupported value: " + ${v}); })() : String(${v}))`;
			default:
				return (v) => `__json_enc_any(${v})`;
		}
	},

	_getJsonDecoder(targetType) {
		if (!targetType) return "__json_dec_any_target";
		const baseType =
			targetType.kind === "pointer" ? targetType.base : targetType;
		if (!baseType) return "__json_dec_any_target";

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
						`  if (parsed === null) { if (box) box.value = null; return null; }\n  if (Array.isArray(parsed)) {\n    var u8 = new Uint8Array(parsed.length);\n    for (var i = 0; i < parsed.length; i++) {\n      if (typeof parsed[i] !== "number") return __json_err("cannot unmarshal " + __json_type(parsed[i]) + " into Go value of type byte");\n      u8[i] = Math.trunc(parsed[i]);\n    }\n    if (box) box.value = u8;\n    return null;\n  }\n  if (typeof parsed !== "string") return __json_err("cannot unmarshal " + __json_type(parsed) + " into Go value of type []byte");\n  var u8 = __json_b64_dec(parsed);\n  if (box) box.value = u8;\n  return null;`,
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

		if (base?.kind === "slice") {
			const elemTypeName = typeCodecName(base.elem, "elem");
			const fnName = `__json_dec_slice_${safeIdent(elemTypeName.split(".").pop())}`;
			if (!this._jsonCodecs.has(fnName)) {
				const elemDec = this._genElemDecoder(base.elem);
				const typedCtor = typedArrayConstructorForElem(base.elem);
				const initOut = typedCtor ? `new ${typedCtor}(parsed.length)` : `[]`;
				const setElem = typedCtor ? `out[i] = item;` : `out.push(item);`;
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"parsed, target, box",
						`  if (parsed === null) { if (box) box.value = null; return null; }\n  if (!Array.isArray(parsed)) return __json_err("cannot unmarshal " + __json_type(parsed) + " into Go value of type []" + ${JSON.stringify(elemTypeName)});\n  var out = ${initOut};\n  for (var i = 0; i < parsed.length; i++) {\n    var item = ${elemDec("parsed[i]")};\n    if (item && item._msg) return item;\n    ${setElem}\n  }\n  if (box) box.value = out;\n  return null;`,
					),
				);
			}
			return fnName;
		}

		if (base?.kind === "map") {
			const valType = base.value ?? base.elem;
			const valTypeName = typeCodecName(valType, "val");
			const fnName = `__json_dec_map_${safeIdent(valTypeName.split(".").pop())}`;
			if (!this._jsonCodecs.has(fnName)) {
				const valDec = this._genElemDecoder(valType);
				this._jsonCodecs.set(
					fnName,
					declareCodec(
						fnName,
						"parsed, target, box",
						`  if (parsed === null) { if (box) box.value = null; return null; }\n  if (typeof parsed !== "object" || Array.isArray(parsed)) return __json_err("cannot unmarshal " + __json_type(parsed) + " into Go value of type map[string]" + ${JSON.stringify(valTypeName)});\n  var out = { __map: true };\n  for (var k in parsed) {\n    if (Object.prototype.hasOwnProperty.call(parsed, k)) {\n      var item = ${valDec("parsed[k]")};\n      if (item && item._msg) return item;\n      out[k] = item;\n    }\n  }\n  if (box) box.value = out;\n  return null;`,
					),
				);
			}
			return fnName;
		}

		return "__json_dec_any_target";
	},

	_genElemDecoder(elemType) {
		if (!elemType) return (v) => `__json_dec_any(${v})`;
		const base = unwrapNamed(elemType);
		if (base?.kind === "basic") {
			switch (base.name) {
				case "string":
					return (v) =>
						`(typeof ${v} === "string" ? ${v} : __json_err("cannot unmarshal " + __json_type(${v}) + " into Go value of type string"))`;
				case "bool":
					return (v) =>
						`(typeof ${v} === "boolean" ? ${v} : __json_err("cannot unmarshal " + __json_type(${v}) + " into Go value of type bool"))`;
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
					return (v) =>
						`(typeof ${v} === "number" ? Math.trunc(${v}) : __json_err("cannot unmarshal " + __json_type(${v}) + " into Go value of type int"))`;
				case "int64":
				case "uint64":
					return (v) =>
						`(typeof ${v} === "string" && ${v}.endsWith("__bigint") ? BigInt(${v}.slice(0, -8)) : (typeof ${v} === "number" ? Math.trunc(${v}) : __json_err("cannot unmarshal " + __json_type(${v}) + " into Go value of type " + ${JSON.stringify(base.name)})))`;
				case "float32":
					return (v) =>
						`(typeof ${v} === "number" ? Math.fround(Number(${v})) : __json_err("cannot unmarshal " + __json_type(${v}) + " into Go value of type float32"))`;
				case "float64":
					return (v) =>
						`(typeof ${v} === "number" ? Number(${v}) : __json_err("cannot unmarshal " + __json_type(${v}) + " into Go value of type float64"))`;
			}
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
				return (v) =>
					`(${v} === null ? null : (() => { var item = ${basicDec(v)}; return item && item._msg ? item : { value: item, __p: true }; })())`;
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
			`    return __json_err("cannot unmarshal " + __json_type(parsed) + " into Go value of type ${structName}");`,
		);
		lines.push(`  }`);

		for (const f of fields) {
			const key = JSON.stringify(f.jsonKey);
			lines.push(
				`  if (Object.prototype.hasOwnProperty.call(parsed, ${key})) {`,
			);
			lines.push(`    var val = parsed[${key}];`);
			lines.push(`    if (val !== null) {`);
			this._emitFieldDecoder(f, structName, lines);
			lines.push(`    } else {`);
			this._emitFieldNull(f, lines);
			lines.push(`    }`);
			lines.push(`  }`);
		}

		lines.push(`  return null;`);
		lines.push(`};`);
		return lines.join("\n");
	},

	_emitFieldDecoder(f, structName, lines) {
		if (isRawMessageType(f.type)) {
			lines.push(
				`      var rawBytes = new TextEncoder().encode(JSON.stringify(val)); rawBytes.__raw = true;`,
			);
			this._emitAssign(f, "rawBytes", lines);
			return;
		}
		if (isByteSliceType(f.type)) {
			lines.push(
				`      if (Array.isArray(val)) {\n        var u8arr = new Uint8Array(val.length);\n        for (var i = 0; i < val.length; i++) {\n          if (typeof val[i] !== "number") return __json_err("cannot unmarshal " + __json_type(val[i]) + " into Go struct field ${structName}.${f.goName} of type []byte");\n          u8arr[i] = Math.trunc(val[i]);\n        }\n        target.${f.goName} = u8arr;\n      } else if (typeof val === "string") {\n        var b64dec = __json_b64_dec(val); if (b64dec && b64dec._msg) return b64dec;\n        target.${f.goName} = b64dec;\n      } else if (val === null) {\n        target.${f.goName} = null;\n      } else {\n        return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type []byte");\n      }`,
			);
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

	_emitPointerBasicFieldDecoder(f, basicName, structName, lines) {
		const typeName = f.type.base?.name ?? basicName;
		switch (basicName) {
			case "string":
				lines.push(
					`      if (typeof val !== "string") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type *string");`,
				);
				this._emitAssign(f, "{ value: val, __p: true }", lines);
				break;
			case "bool":
				lines.push(
					`      if (typeof val !== "boolean") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type *bool");`,
				);
				this._emitAssign(f, "{ value: val, __p: true }", lines);
				break;
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
				lines.push(
					`      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type *${typeName}");`,
				);
				this._emitAssign(f, "{ value: Math.trunc(val), __p: true }", lines);
				break;
			case "int64":
			case "uint64":
				lines.push(
					`      var bVal; if (typeof val === "string" && val.endsWith("__bigint")) bVal = BigInt(val.slice(0, -8)); else if (typeof val === "number") bVal = BigInt(Math.trunc(val)); else return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type *${typeName}");`,
				);
				this._emitAssign(f, "{ value: bVal, __p: true }", lines);
				break;
			case "float32":
				lines.push(
					`      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type *${typeName}");`,
				);
				this._emitAssign(
					f,
					"{ value: Math.fround(Number(val)), __p: true }",
					lines,
				);
				break;
			case "float64":
				lines.push(
					`      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type *${typeName}");`,
				);
				this._emitAssign(f, "{ value: Number(val), __p: true }", lines);
				break;
		}
	},

	_emitBasicFieldDecoder(f, basicName, structName, lines) {
		const typeName = f.type.name ?? basicName;
		switch (basicName) {
			case "string":
				lines.push(
					`      if (typeof val !== "string") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type string");`,
				);
				this._emitAssign(f, "val", lines);
				break;
			case "bool":
				lines.push(
					`      if (typeof val !== "boolean") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type bool");`,
				);
				this._emitAssign(f, "val", lines);
				break;
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
				lines.push(
					`      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type ${typeName}");`,
				);
				this._emitAssign(f, "Math.trunc(val)", lines);
				break;
			case "int64":
			case "uint64":
				lines.push(
					`      if (typeof val === "string" && val.endsWith("__bigint")) {`,
				);
				this._emitAssign(f, "BigInt(val.slice(0, -8))", lines);
				lines.push(`      } else if (typeof val === "number") {`);
				this._emitAssign(f, "Math.trunc(val)", lines);
				lines.push(
					`      } else { return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type ${typeName}"); }`,
				);
				break;
			case "float32":
				lines.push(
					`      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type ${typeName}");`,
				);
				this._emitAssign(f, "Math.fround(Number(val))", lines);
				break;
			case "float64":
				lines.push(
					`      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field ${structName}.${f.goName} of type ${typeName}");`,
				);
				this._emitAssign(f, "Number(val)", lines);
				break;
			default:
				this._emitAssign(f, "__json_dec_any(val)", lines);
				break;
		}
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

	_emitFieldNull(f, lines) {
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
