var __append = __append || function(a, ...b) {
  if (a && ArrayBuffer.isView(a)) {
    const res = new a.constructor(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
  }
  return a ? [...a, ...b] : b;
};

function Plural(n, word) {
  if (n === 1) {
    return String(n) + " " + word;
  }
  return String(n) + " " + word + "s";
}

function HasText(s) {
  return s.trim() !== "";
}

function Filter(items, pred) {
  let out = null;
  for (let __i0 = 0, __arr0 = items, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let item = __arr0[__i0];
    if (pred(item)) {
      out = __append(out, item);
    }
  }
  return out;
}

var __len = __len || function(a) {
  if (a && typeof a === 'object' && !Array.isArray(a) && !ArrayBuffer.isView(a)) return Object.keys(a).length;
  return a?.length ?? 0;
};
var __append = __append || function(a, ...b) {
  if (a && ArrayBuffer.isView(a)) {
    const res = new a.constructor(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
  }
  return a ? [...a, ...b] : b;
};
var __ifv = __ifv || function(x, ptrFields) {
  if (x === null || typeof x !== "object") return x;
  const c = typeof x.__clone === "function" ? x.__clone() : Object.assign(Object.create(Object.getPrototypeOf(x)), x);
  Object.defineProperty(c, "__v", { value: true, configurable: true });
  if (Array.isArray(ptrFields)) {
    for (const f of ptrFields) {
      if (f.indexOf(".") !== -1) {
        const parts = f.split(".");
        let cur = c;
        for (let j = 0; j < parts.length - 1; j++) cur = cur?.[parts[j]];
        const last = parts[parts.length - 1];
        if (cur?.[last] !== null && typeof cur?.[last] === "object") __ifp(cur[last]);
      } else if (c[f] !== null && typeof c[f] === "object") {
        __ifp(c[f]);
      }
    }
  }
  for (const k of Object.keys(c)) {
    if (c[k] !== null && typeof c[k] === "object" && !Array.isArray(c[k]) && !ArrayBuffer.isView(c[k])) {
      if (!c[k].__v && !c[k].__p && (!Array.isArray(ptrFields) || !ptrFields.includes(k))) {
        Object.defineProperty(c[k], "__v", { value: true, configurable: true });
      }
    }
  }
  return c;
};
var __ifp = __ifp || function(x, ptrFields, seen) {
  if (x === null || typeof x !== "object") return x;
  if (x.__p !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__p", { value: true, configurable: true });
  if (Array.isArray(ptrFields)) {
    seen = seen || new Set();
    if (seen.has(x)) return x;
    seen.add(x);
    for (const f of ptrFields) {
      if (f.indexOf(".") !== -1) {
        const parts = f.split(".");
        let cur = x;
        for (let j = 0; j < parts.length - 1; j++) cur = cur?.[parts[j]];
        const last = parts[parts.length - 1];
        if (cur?.[last] !== null && typeof cur?.[last] === "object") __ifp(cur[last]);
      } else if (x[f] !== null && typeof x[f] === "object") {
        __ifp(x[f]);
      }
    }
  }
  return x;
};
var __ifm = __ifm || function(x) {
  if (x === null || x === undefined) return x;
  if (typeof x !== "object") return x;
  if (x.__map !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__map", { value: true, configurable: true });
  return x;
};
var __ifpm = __ifpm || function(x) {
  if (x === null || x === undefined) return x;
  if (typeof x !== "object") return x;
  if (x.__map !== true && Object.isExtensible(x)) {
    Object.defineProperty(x, "__map", { value: true, configurable: true });
    Object.defineProperty(x, "__ptr_map", { value: true, configurable: true });
  }
  return x;
};
var __ifs = __ifs || function(x, ptrFields) {
  if (x === null || x === undefined) return x;
  if (x.__slice !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__slice", { value: true, configurable: true });
  if (Array.isArray(ptrFields) && Object.isExtensible(x))
    Object.defineProperty(x, "__ptr_fields", { value: ptrFields, configurable: true });
  return x;
};
var __ifps = __ifps || function(x) {
  if (x === null || x === undefined) return x;
  if (x.__slice !== true && Object.isExtensible(x)) {
    Object.defineProperty(x, "__slice", { value: true, configurable: true });
    Object.defineProperty(x, "__ptr_slice", { value: true, configurable: true });
  }
  return x;
};
var __error = __error || function(msg, cause) {
  return { Error() { return msg; }, toString() { return msg; }, _msg: msg, _cause: cause ?? null };
};
var __base64_make = __base64_make || function(alphabet, padChar) {
  const encMap = alphabet.split("");
  const decMap = {};
  for (let i = 0; i < 64; i++) decMap[alphabet[i]] = i;
  return {
    EncodeToString: function(src) {
      if (!src || src.length === 0) return "";
      let res = "";
      let i = 0;
      for (; i + 2 < src.length; i += 3) {
        const n = (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
        res += encMap[(n >> 18) & 63] + encMap[(n >> 12) & 63] + encMap[(n >> 6) & 63] + encMap[n & 63];
      }
      if (i < src.length) {
        if (src.length - i === 1) {
          const n = src[i] << 16;
          res += encMap[(n >> 18) & 63] + encMap[(n >> 12) & 63];
          if (padChar) res += padChar + padChar;
        } else {
          const n = (src[i] << 16) | (src[i + 1] << 8);
          res += encMap[(n >> 18) & 63] + encMap[(n >> 12) & 63] + encMap[(n >> 6) & 63];
          if (padChar) res += padChar;
        }
      }
      return res;
    },
    DecodeString: function(s) {
      let str = s.replace(/\s+/g, "");
      if (padChar) {
        if (str.length % 4 !== 0) return [new Uint8Array(0), __error("illegal base64 data at input byte " + str.length)];
        if (str.endsWith(padChar + padChar)) {
          if (str.endsWith(padChar + padChar + padChar)) return [new Uint8Array(0), __error("illegal base64 data at input byte " + (str.length - 3))];
          str = str.slice(0, -2);
          if (str.length % 4 !== 2) return [new Uint8Array(0), __error("illegal base64 data at input byte " + str.length)];
        } else if (str.endsWith(padChar)) {
          str = str.slice(0, -1);
          if (str.length % 4 !== 3) return [new Uint8Array(0), __error("illegal base64 data at input byte " + str.length)];
        }
      }
      const out = [];
      let i = 0;
      for (; i + 3 < str.length; i += 4) {
        const c0 = decMap[str[i]], c1 = decMap[str[i+1]], c2 = decMap[str[i+2]], c3 = decMap[str[i+3]];
        if (c0 === undefined || c1 === undefined || c2 === undefined || c3 === undefined) return [new Uint8Array(out), __error("illegal base64 data at input byte " + i)];
        const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
        out.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
      }
      const rem = str.length - i;
      if (rem === 2) {
        const c0 = decMap[str[i]], c1 = decMap[str[i+1]];
        if (c0 === undefined || c1 === undefined) return [new Uint8Array(out), __error("illegal base64 data at input byte " + i)];
        out.push((c0 << 2) | (c1 >> 4));
      } else if (rem === 3) {
        const c0 = decMap[str[i]], c1 = decMap[str[i+1]], c2 = decMap[str[i+2]];
        if (c0 === undefined || c1 === undefined || c2 === undefined) return [new Uint8Array(out), __error("illegal base64 data at input byte " + i)];
        out.push((c0 << 2) | (c1 >> 4), ((c1 & 15) << 4) | (c2 >> 2));
      } else if (rem === 1) {
        return [new Uint8Array(out), __error("illegal base64 data at input byte " + i)];
      }
      return [new Uint8Array(out), null];
    },
    Encode: function(dst, src) {
      const s = this.EncodeToString(src);
      for (let i = 0; i < s.length; i++) dst[i] = s.charCodeAt(i);
    },
    Decode: function(dst, src) {
      const str = String.fromCharCode(...src);
      const [res, err] = this.DecodeString(str);
      for (let i = 0; i < res.length; i++) dst[i] = res[i];
      return [res.length, err];
    },
    EncodedLen: function(n) { return padChar ? Math.ceil(n / 3) * 4 : Math.floor((n * 8 + 5) / 6); },
    DecodedLen: function(n) { return padChar ? Math.floor(n * 3 / 4) : Math.floor(n * 6 / 8); },
    WithPadding: function(p) { return __base64_make(alphabet, p === -1 ? "" : String.fromCharCode(p)); }
  };
};
var __base64_std = __base64_std || __base64_make("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", "=");
var __base64_url = __base64_url || __base64_make("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", "=");
var __base64_raw_std = __base64_raw_std || __base64_make("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", "");
var __base64_raw_url = __base64_raw_url || __base64_make("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", "");
var __json_esc = __json_esc || function(s) {
  if (typeof s !== "string") s = String(s);
  return JSON.stringify(s)
    .replace(/[<>&]/g, function(c) {
      return c === "<" ? "\\u003c" : (c === ">" ? "\\u003e" : "\\u0026");
    })
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
};
var __json_err = __json_err || function(msg) {
  return typeof __error === "function" ? __error("json: " + msg) : new Error("json: " + msg);
};
var __json_type = __json_type || function(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  var t = typeof v;
  if (t === "number" || t === "bigint") return "number";
  if (t === "string") return "string";
  if (t === "boolean") return "bool";
  if (t === "object") return "object";
  return t;
};
var __json_b64 = __json_b64 || function(u8) {
  if (u8 === null || u8 === undefined) return "null";
  if (typeof __base64_std !== "undefined") return '"' + __base64_std.EncodeToString(u8) + '"';
  var bstr = "";
  for (var i = 0; i < u8.length; i++) bstr += String.fromCharCode(u8[i]);
  return '"' + (typeof btoa !== "undefined" ? btoa(bstr) : Buffer.from(u8).toString("base64")) + '"';
};
var __json_b64_dec = __json_b64_dec || function(str) {
  if (typeof __base64_std !== "undefined") {
    var res = __base64_std.DecodeString(str);
    if (!res[1]) return res[0];
  }
  var bin = typeof atob !== "undefined" ? atob(str) : Buffer.from(str, "base64").toString("binary");
  var u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};
var __json_is_zero = __json_is_zero || function(val, isStruct) {
  if (isStruct) return false;
  if (val === null || val === undefined || val === false || val === 0 || val === "") return true;
  if (typeof val === "bigint") return val === 0n;
  if (Array.isArray(val) || (ArrayBuffer.isView(val) && !val.__raw)) return val.length === 0;
  if (val instanceof Map) return val.size === 0;
  if (val && val.__map) return Object.keys(val).filter(function(k) { return !k.startsWith("__"); }).length === 0;
  return false;
};
var __json_preserve_int64 = __json_preserve_int64 || function(str) {
  return str.replace(/"(?:\\.|[^"\\])*"|(?<=[,:\[{\s]|^)(-?\d{16,})(?=[,\]}\s]|$)/g, function(m, num) {
    if (num) {
      try {
        var b = BigInt(num);
        if (b > 9007199254740991n || b < -9007199254740991n) return '"' + num + '__bigint"';
      } catch (e) {}
    }
    return m;
  });
};
var __json_enc_any = __json_enc_any || function(v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") {
    if (!isFinite(v)) throw new Error("json: unsupported value: " + v);
    return String(v);
  }
  if (t === "bigint") return v.toString();
  if (t === "string") return __json_esc(v);
  if ((typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(v)) || v instanceof Uint8Array) {
    if (v.__raw) {
      var s = (typeof v === "string" ? v : new TextDecoder().decode(v)).trim();
      return s.length > 0 ? s : "null";
    }
    return __json_b64(v);
  }
  if (Array.isArray(v)) {
    var items = [];
    for (var i = 0; i < v.length; i++) items.push(__json_enc_any(v[i]));
    return "[" + items.join(",") + "]";
  }
  if (v instanceof Map) {
    var mkeys = Array.from(v.keys()).map(String).sort();
    var mentries = [];
    for (var mi = 0; mi < mkeys.length; mi++) {
      mentries.push(__json_esc(mkeys[mi]) + ":" + __json_enc_any(v.get(mkeys[mi])));
    }
    return "{" + mentries.join(",") + "}";
  }
  if (typeof v.__json_enc === "function") return v.__json_enc();
  if (typeof v === "object") {
    var okeys = Object.keys(v).filter(function(k) { return !k.startsWith("__"); });
    if (!v.__map && v.constructor && v.constructor !== Object && v.constructor.name !== "Object") {
      okeys = okeys.filter(function(k) { return !(k.length > 0 && k[0] >= "a" && k[0] <= "z"); });
    }
    okeys.sort();
    var oentries = [];
    for (var oi = 0; oi < okeys.length; oi++) {
      oentries.push(__json_esc(okeys[oi]) + ":" + __json_enc_any(v[okeys[oi]]));
    }
    return "{" + oentries.join(",") + "}";
  }
  return "null";
};
var __json_dec_any = __json_dec_any || function(parsed) {
  if (parsed === null) return null;
  if (typeof parsed === "string") {
    if (parsed.endsWith("__bigint")) return BigInt(parsed.slice(0, -8));
    return parsed;
  }
  if (typeof parsed === "number" || typeof parsed === "boolean") return parsed;
  if (Array.isArray(parsed)) {
    var outSlice = [];
    for (var i = 0; i < parsed.length; i++) outSlice.push(__json_dec_any(parsed[i]));
    return outSlice;
  }
  if (typeof parsed === "object") {
    var outMap = { __map: true };
    for (var k in parsed) {
      if (Object.prototype.hasOwnProperty.call(parsed, k)) {
        outMap[k] = __json_dec_any(parsed[k]);
      }
    }
    return outMap;
  }
  return parsed;
};
var __json_dec_any_target = __json_dec_any_target || function(parsed, target, box) {
  var out = __json_dec_any(parsed);
  if (box) box.value = out;
  else if (target && typeof target === "object") Object.assign(target, out);
  return null;
};
var __json_enc_slice = __json_enc_slice || function(slice, elemEnc) {
  if (slice === null || slice === undefined) return "null";
  var items = [];
  for (var i = 0; i < slice.length; i++) items.push(elemEnc(slice[i]));
  return "[" + items.join(",") + "]";
};
var __json_enc_map = __json_enc_map || function(m, valEnc) {
  if (m === null || m === undefined) return "null";
  if (m instanceof Map) {
    var mkeys = Array.from(m.keys()).map(String).sort();
    var mentries = [];
    for (var i = 0; i < mkeys.length; i++) {
      mentries.push(__json_esc(mkeys[i]) + ":" + valEnc(m.get(mkeys[i])));
    }
    return "{" + mentries.join(",") + "}";
  }
  var keys = Object.keys(m).filter(function(k) { return !k.startsWith("__"); }).sort();
  var entries = [];
  for (var j = 0; j < keys.length; j++) {
    entries.push(__json_esc(keys[j]) + ":" + valEnc(m[keys[j]]));
  }
  return "{" + entries.join(",") + "}";
};
var __json_marshal = __json_marshal || function(enc, val) {
  try {
    var str = enc(val);
    return [new TextEncoder().encode(str), null];
  } catch (e) {
    return [new Uint8Array(0), typeof __error === "function" ? __error(e.message) : e];
  }
};
var __json_indent = __json_indent || function(jsonStr, prefix, indent) {
  var out = "";
  var depth = 0;
  var inString = false;
  var escaped = false;
  for (var i = 0; i < jsonStr.length; i++) {
    var c = jsonStr[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "{" || c === "[") {
      out += c;
      depth++;
      var next = jsonStr[i + 1];
      if ((c === "{" && next === "}") || (c === "[" && next === "]")) {
        out += next;
        i++;
        depth--;
        continue;
      }
      out += "\n" + prefix + indent.repeat(depth);
    } else if (c === "}" || c === "]") {
      depth--;
      out += "\n" + prefix + indent.repeat(depth) + c;
    } else if (c === ",") {
      out += ",\n" + prefix + indent.repeat(depth);
    } else if (c === ":") {
      out += ": ";
    } else if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") {
      out += c;
    }
  }
  return out;
};
var __json_marshal_indent = __json_marshal_indent || function(enc, val, prefix, indent) {
  var res = __json_marshal(enc, val);
  if (res[1]) return res;
  var rawStr = new TextDecoder().decode(res[0]);
  var formatted = __json_indent(rawStr, prefix, indent);
  return [new TextEncoder().encode(formatted), null];
};
var __json_valid = __json_valid || function(data) {
  try {
    var s = typeof data === "string" ? data : new TextDecoder().decode(((typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) || data instanceof Uint8Array) ? data : new Uint8Array(data));
    JSON.parse(s);
    return true;
  } catch (e) {
    return false;
  }
};
var __json_unmarshal = __json_unmarshal || function(dec, data, target) {
  if (target === null || target === undefined) {
    return typeof __error === "function" ? __error("json: Unmarshal(nil)") : new Error("json: Unmarshal(nil)");
  }
  if (typeof target !== "object" || target.__v === true) {
    return typeof __error === "function" ? __error("json: Unmarshal(non-pointer " + typeof target + ")") : new Error("json: Unmarshal(non-pointer " + typeof target + ")");
  }
  var str;
  try {
    str = typeof data === "string" ? data : new TextDecoder().decode(((typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) || data instanceof Uint8Array) ? data : new Uint8Array(data));
  } catch (e) {
    return typeof __error === "function" ? __error("invalid UTF-8 data") : e;
  }
  var safeStr = __json_preserve_int64(str);
  var parsed;
  try {
    parsed = JSON.parse(safeStr);
  } catch (e) {
    return typeof __error === "function" ? __error(e.message) : e;
  }
  var isBox = target && typeof target === "object" && Object.prototype.hasOwnProperty.call(target, "value");
  var dest = isBox ? target.value : target;
  var err = dec(parsed, dest, isBox ? target : null, data);
  if (err) return err;
  return null;
};

class Todo {
  constructor(ID$ = 0, Text$ = "", Done$ = false, Priority$ = 0) {
    if (arguments.length === 1 && typeof ID$ === "object" && ID$ !== null && ID$.constructor === Object) ({ ID: ID$ = 0, Text: Text$ = "", Done: Done$ = false, Priority: Priority$ = 0 } = ID$);
    this.ID = ID$;
    this.Text = Text$;
    this.Done = Done$;
    this.Priority = Priority$;
  }

  isUrgent() {
    const t = this;
    return t.Priority === PriorityHigh && !t.Done;
  }

  withDone(done) {
    const t = this;
    return new Todo(t.ID, t.Text, done, t.Priority);
  }

  withText(text) {
    const t = this;
    return new Todo(t.ID, text, t.Done, t.Priority);
  }

  __clone() { return new Todo(this.ID, this.Text, this.Done, this.Priority); }
}
Object.defineProperty(Todo.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class Stats {
  constructor(remaining$ = 0, completed$ = 0) {
    if (arguments.length === 1 && typeof remaining$ === "object" && remaining$ !== null && remaining$.constructor === Object) ({ remaining: remaining$ = 0, completed: completed$ = 0 } = remaining$);
    this.remaining = remaining$;
    this.completed = completed$;
  }

  __clone() { return new Stats(this.remaining, this.completed); }
}
Object.defineProperty(Stats.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class TodoItemProps {
  constructor(Todo$ = new Todo(), OnToggle$ = null, OnDelete$ = null, OnEdit$ = null, OnDragStart$ = null, OnDragOver$ = null, OnDrop$ = null, OnDragEnd$ = null) {
    this.Todo = Todo$;
    this.OnToggle = OnToggle$;
    this.OnDelete = OnDelete$;
    this.OnEdit = OnEdit$;
    this.OnDragStart = OnDragStart$;
    this.OnDragOver = OnDragOver$;
    this.OnDrop = OnDrop$;
    this.OnDragEnd = OnDragEnd$;
  }

  __clone() { return new TodoItemProps(this.Todo.__clone(), this.OnToggle, this.OnDelete, this.OnEdit, this.OnDragStart, this.OnDragOver, this.OnDrop, this.OnDragEnd); }
}
Object.defineProperty(TodoItemProps.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class HeaderProps {
  constructor(UrgentCount$ = 0, SyncMsg$ = "", SyncCls$ = "") {
    if (arguments.length === 1 && typeof UrgentCount$ === "object" && UrgentCount$ !== null && UrgentCount$.constructor === Object) ({ UrgentCount: UrgentCount$ = 0, SyncMsg: SyncMsg$ = "", SyncCls: SyncCls$ = "" } = UrgentCount$);
    this.UrgentCount = UrgentCount$;
    this.SyncMsg = SyncMsg$;
    this.SyncCls = SyncCls$;
  }

  __clone() { return new HeaderProps(this.UrgentCount, this.SyncMsg, this.SyncCls); }
}
Object.defineProperty(HeaderProps.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class InputRowProps {
  constructor(Value$ = "", HighPriority$ = false, Saving$ = false, ErrorMsg$ = "", OnInput$ = null, OnKeyDown$ = null, OnTogglePriority$ = null, OnAdd$ = null) {
    if (arguments.length === 1 && typeof Value$ === "object" && Value$ !== null && Value$.constructor === Object) ({ Value: Value$ = "", HighPriority: HighPriority$ = false, Saving: Saving$ = false, ErrorMsg: ErrorMsg$ = "", OnInput: OnInput$ = null, OnKeyDown: OnKeyDown$ = null, OnTogglePriority: OnTogglePriority$ = null, OnAdd: OnAdd$ = null } = Value$);
    this.Value = Value$;
    this.HighPriority = HighPriority$;
    this.Saving = Saving$;
    this.ErrorMsg = ErrorMsg$;
    this.OnInput = OnInput$;
    this.OnKeyDown = OnKeyDown$;
    this.OnTogglePriority = OnTogglePriority$;
    this.OnAdd = OnAdd$;
  }

  __clone() { return new InputRowProps(this.Value, this.HighPriority, this.Saving, this.ErrorMsg, this.OnInput, this.OnKeyDown, this.OnTogglePriority, this.OnAdd); }
}
Object.defineProperty(InputRowProps.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class FooterProps {
  constructor(Total$ = 0, Remaining$ = 0, Completed$ = 0, Filter$ = 0, OnFilter$ = null, OnClearCompleted$ = null) {
    if (arguments.length === 1 && typeof Total$ === "object" && Total$ !== null && Total$.constructor === Object) ({ Total: Total$ = 0, Remaining: Remaining$ = 0, Completed: Completed$ = 0, Filter: Filter$ = 0, OnFilter: OnFilter$ = null, OnClearCompleted: OnClearCompleted$ = null } = Total$);
    this.Total = Total$;
    this.Remaining = Remaining$;
    this.Completed = Completed$;
    this.Filter = Filter$;
    this.OnFilter = OnFilter$;
    this.OnClearCompleted = OnClearCompleted$;
  }

  __clone() { return new FooterProps(this.Total, this.Remaining, this.Completed, this.Filter, this.OnFilter, this.OnClearCompleted); }
}
Object.defineProperty(FooterProps.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class StatsBarProps {
  constructor(Total$ = 0, OnClick$ = null) {
    if (arguments.length === 1 && typeof Total$ === "object" && Total$ !== null && Total$.constructor === Object) ({ Total: Total$ = 0, OnClick: OnClick$ = null } = Total$);
    this.Total = Total$;
    this.OnClick = OnClick$;
  }

  __clone() { return new StatsBarProps(this.Total, this.OnClick); }
}
Object.defineProperty(StatsBarProps.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

const maxTodoLen = 120;

const FilterAll = 0;
const FilterActive = 1;
const FilterCompleted = 2;

const PriorityNormal = 0;
const PriorityHigh = 1;

let currentTodos = null;
let nextId = 0;
let dragSrcId = 0;
let dropAfter = false;
let saveTimerSeq = 0;

function itemClass(t, editing) {
  let cls = "todo-item";
  if (t.Done) {
    cls += " done";
  } else if (t.isUrgent()) {
    cls += " high";
  }
  if (editing === true) {
    cls += " editing";
  }
  return cls;
}

function TodoItem(p) {
  let [editing, setEditing] = useState(false);
  let [editText, setEditText] = useState(p.Todo.Text);
  let itemCls = itemClass(p.Todo, editing);
  let idStr = String(p.Todo.ID);
  let badgeChild = null;
  if (p.Todo.isUrgent()) {
    badgeChild = h("span", __ifm({ "class": "badge" }), "urgent");
  }
  let textChild = null;
  if (editing === true) {
    textChild = h("input", __ifm({ "type": "text", "class": "edit-input", "value": editText, "autoFocus": true, "onInput": function(e) {
      setEditText(e.target.value);
    }, "onKeyDown": function(e) {
      if (e.key === "Enter") {
        if (p.OnEdit != null) {
          p.OnEdit(p.Todo.ID, String(editText));
        }
        setEditing(false);
      } else if (e.key === "Escape") {
        setEditText(p.Todo.Text);
        setEditing(false);
      }
    }, "onBlur": function(e) {
      if (p.OnEdit != null) {
        p.OnEdit(p.Todo.ID, String(editText));
      }
      setEditing(false);
    } }));
  } else {
    textChild = h("span", __ifm({ "class": "todo-text", "onDblClick": function(e) {
      setEditText(p.Todo.Text);
      setEditing(true);
    } }), p.Todo.Text);
  }
  return h("li", __ifm({ "class": itemCls, "draggable": "true", "data-id": idStr, "onDragStart": p.OnDragStart, "onDragOver": p.OnDragOver, "onDrop": p.OnDrop, "onDragEnd": p.OnDragEnd }), h("input", __ifm({ "type": "checkbox", "class": "todo-cb", "data-action": "toggle", "data-todo-id": idStr, "checked": p.Todo.Done, "onChange": function(e) {
    if (p.OnToggle != null) {
      p.OnToggle(p.Todo.ID);
    }
  } })), textChild, badgeChild, h("button", __ifm({ "type": "button", "class": "del-btn", "data-action": "delete", "data-todo-id": idStr, "onClick": function(e) {
    if (p.OnDelete != null) {
      p.OnDelete(p.Todo.ID);
    }
  } }), "✕"));
}

function Header(p) {
  let badgeStyle = "";
  let badgeText = "";
  if (p.UrgentCount > 0) {
    badgeStyle = "display: inline-block";
    badgeText = String(p.UrgentCount) + " urgent";
  } else {
    badgeStyle = "display: none";
  }
  let syncClass = "sync-status";
  if (p.SyncCls !== "") {
    syncClass = "sync-status " + p.SyncCls;
  }
  return h("header", __ifm({ "class": "header" }), h("div", __ifm({ "class": "header-top" }), h("div", __ifm({ "class": "header-icon" }), "✓"), h("h1", null, "Todos Preact"), h("span", __ifm({ "class": "high-badge", "style": badgeStyle }), badgeText), h("span", __ifm({ "class": syncClass, "data-ref": "syncStatus" }), p.SyncMsg)), h("p", __ifm({ "class": "tagline" }), "Built with ", h("a", __ifm({ "href": "https://github.com/seriva/gofront", "target": "_blank" }), h("strong", null, "GoFront")), " — Go compiled to JS"));
}

function InputRow(p) {
  let inputClass = "todo-input";
  let placeholder = "What needs to be done?";
  if (p.HighPriority) {
    inputClass += " high";
    placeholder = "What's urgent? (high priority)";
  }
  let priorityBtnClass = "priority-btn";
  let priorityLabel = "⚡ Normal";
  if (p.HighPriority) {
    priorityBtnClass += " on";
    priorityLabel = "⚡ High";
  }
  let priorityHint = null;
  if (p.HighPriority) {
    priorityHint = h("span", __ifm({ "class": "priority-hint", "style": "display: block" }), "⚡ High priority — task will be marked urgent");
  }
  let errorSpan = null;
  if (p.ErrorMsg !== "") {
    errorSpan = h("span", __ifm({ "class": "error-msg" }), p.ErrorMsg);
  }
  return h("div", __ifm({ "class": "input-row" }), h("input", __ifm({ "type": "text", "class": inputClass, "autocomplete": "off", "placeholder": placeholder, "value": p.Value, "disabled": p.Saving, "onInput": p.OnInput, "onKeyDown": p.OnKeyDown })), h("button", __ifm({ "type": "button", "class": priorityBtnClass, "onClick": function(e) {
    if (p.OnTogglePriority != null) {
      p.OnTogglePriority();
    }
  } }), priorityLabel), h("button", __ifm({ "type": "button", "class": "add-btn", "disabled": p.Saving, "onClick": function(e) {
    if (p.OnAdd != null) {
      p.OnAdd();
    }
  } }), "Add"), priorityHint, errorSpan);
}

function Footer(p) {
  let footerStyle = "";
  if (p.Total === 0) {
    footerStyle = "display: none";
  }
  let btnAll = "filter-btn";
  if (p.Filter === FilterAll) {
    btnAll += " active";
  }
  let btnActive = "filter-btn";
  if (p.Filter === FilterActive) {
    btnActive += " active";
  }
  let btnCompleted = "filter-btn";
  if (p.Filter === FilterCompleted) {
    btnCompleted += " active";
  }
  let clearBtn = null;
  if (p.Completed > 0) {
    clearBtn = h("button", __ifm({ "type": "button", "class": "clear-btn", "data-action": "clear-completed", "onClick": function(e) {
      if (p.OnClearCompleted != null) {
        p.OnClearCompleted();
      }
    } }), "Clear (" + String(p.Completed) + ")");
  }
  return h("footer", __ifm({ "class": "footer", "style": footerStyle }), h("span", __ifm({ "class": "count" }), Plural(p.Remaining, "task") + " left"), h("div", __ifm({ "class": "filter-area" }), h("div", __ifm({ "class": "filter-bar" }), h("button", __ifm({ "type": "button", "class": btnAll, "data-action": "filter", "data-filter": "0", "onClick": function(e) {
    if (p.OnFilter != null) {
      p.OnFilter(FilterAll);
    }
  } }), "All"), h("button", __ifm({ "type": "button", "class": btnActive, "data-action": "filter", "data-filter": "1", "onClick": function(e) {
    if (p.OnFilter != null) {
      p.OnFilter(FilterActive);
    }
  } }), "Active"), h("button", __ifm({ "type": "button", "class": btnCompleted, "data-action": "filter", "data-filter": "2", "onClick": function(e) {
    if (p.OnFilter != null) {
      p.OnFilter(FilterCompleted);
    }
  } }), "Completed")), clearBtn));
}

function StatsBar(p) {
  return h("div", __ifm({ "id": "stats-bar" }), h("div", null, h("span", __ifm({ "style": "cursor: pointer", "title": "Show active todos", "onClick": function(e) {
    if (p.OnClick != null) {
      p.OnClick();
    }
  } }), h("strong", null, String(p.Total)), " " + Plural(p.Total, "todo") + " in session")));
}

function validateTodo(text) {
  if (!HasText(text)) {
    return __error("todo text cannot be empty");
  }
  if ([...(text)].length > maxTodoLen) {
    return __error("todo text too long");
  }
  return null;
}

async function loadTodosFromStorage() {
  await sleep(200);
  let raw = localStorage.getItem("todos");
  if (raw == null) {
    return null;
  }
  let loaded = { value: null };
  let err = __json_unmarshal(__json_dec_slice_Todo, (typeof raw === "string" ? new TextEncoder().encode(raw) : new Uint8Array(raw)), loaded);
  if (err != null) {
    return null;
  }
  return loaded.value;
}

function defaultTodos() {
  return [new Todo(1, "Read the GoFront docs", false, PriorityNormal), new Todo(2, "Fix the critical production bug", false, PriorityHigh), new Todo(3, "Write tests", true, PriorityNormal), new Todo(4, "Deploy to staging", false, PriorityHigh), new Todo(5, "Send weekly update email", false, PriorityNormal)];
}

async function saveToStorage(todosToSave, setSaving, setSyncMsg, setSyncCls) {
  saveTimerSeq++;
  let seq = saveTimerSeq;
  setSaving(true);
  setSyncMsg("Saving…");
  setSyncCls("saving");
  await sleep(350);
  let [data, err] = __json_marshal(__json_enc_slice_Todo, todosToSave);
  if (err == null) {
    localStorage.setItem("todos", new TextDecoder().decode(new Uint8Array(data)));
  }
  if (seq !== saveTimerSeq) {
    return;
  }
  setSaving(false);
  setSyncMsg("Saved ✓");
  setSyncCls("saved");
  await sleep(1500);
  if (seq === saveTimerSeq) {
    setSyncMsg("");
    setSyncCls("");
  }
}

function moveTodo(cur, fromId, toId, after) {
  if (fromId === toId) {
    return cur;
  }
  let item = new Todo();
  let rest = null;
  for (let __i0 = 0, __arr0 = cur, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let t = __arr0[__i0];
    if (t.ID === fromId) {
      item = t.__clone();
    } else {
      rest = __append(rest, t.__clone());
    }
  }
  let result = null;
  let inserted = false;
  for (let __i0 = 0, __arr0 = rest, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let t = __arr0[__i0];
    if (!after && t.ID === toId) {
      result = __append(result, item.__clone());
      inserted = true;
    }
    result = __append(result, t.__clone());
    if (after && t.ID === toId) {
      result = __append(result, item.__clone());
      inserted = true;
    }
  }
  if (!inserted) {
    result = __append(result, item.__clone());
  }
  return result;
}

function App() {
  let [todos, setTodos] = useState([]);
  todos;
  let [loaded, setLoaded] = useState(false);
  let [filter, setFilter] = useState(FilterAll);
  let [highPriority, setHighPriority] = useState(false);
  let [inputValue, setInputValue] = useState("");
  let [errorMsg, setErrorMsg] = useState("");
  let [syncMsg, setSyncMsg] = useState("");
  let [syncCls, setSyncCls] = useState("");
  let [saving, setSaving] = useState(false);
  useEffect(function() {
    let initLoad = async function() {
      let loadedItems = await loadTodosFromStorage();
      if (loadedItems != null && __len(loadedItems) > 0) {
        let maxId = 0;
        for (let __i0 = 0, __arr0 = loadedItems, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
          let t = __arr0[__i0];
          if (t.ID > maxId) {
            maxId = t.ID;
          }
        }
        nextId = maxId + 1;
        currentTodos = loadedItems;
        setTodos(loadedItems);
      } else {
        let defaults = defaultTodos();
        nextId = 6;
        currentTodos = defaults;
        setTodos(defaults);
      }
      setLoaded(true);
    };
    initLoad();
  }, []);
  if (loaded !== true) {
    return h("div", __ifm({ "class": "loading-placeholder" }), h("div", __ifm({ "style": "font-size: 2rem; opacity: .4" }), "✓"), h("span", null, "Loading todos…"));
  }
  let doSave = function(newTodos) {
    currentTodos = newTodos;
    setTodos(newTodos);
    saveToStorage(newTodos, setSaving, setSyncMsg, setSyncCls);
  };
  let onToggle = function(id) {
    let next = null;
    for (let __i0 = 0, __arr0 = currentTodos, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
      let t = __arr0[__i0];
      if (t.ID === id) {
        next = __append(next, t.withDone(!t.Done));
      } else {
        next = __append(next, t.__clone());
      }
    }
    doSave(next);
  };
  let onDelete = function(id) {
    let next = null;
    for (let __i0 = 0, __arr0 = currentTodos, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
      let t = __arr0[__i0];
      if (t.ID !== id) {
        next = __append(next, t.__clone());
      }
    }
    doSave(next);
  };
  let onEdit = function(id, text) {
    let trimmed = text.trim();
    if (trimmed === "") {
      onDelete(id);
      return;
    }
    let next = null;
    for (let __i0 = 0, __arr0 = currentTodos, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
      let t = __arr0[__i0];
      if (t.ID === id) {
        next = __append(next, t.withText(trimmed));
      } else {
        next = __append(next, t.__clone());
      }
    }
    doSave(next);
  };
  let onAdd = function() {
    let val = String(inputValue);
    let err = validateTodo(val);
    if (err != null) {
      setErrorMsg(err.Error());
      let autoClear = async function() {
        await sleep(2500);
        setErrorMsg("");
      };
      autoClear();
      return;
    }
    setErrorMsg("");
    let prio = PriorityNormal;
    if (highPriority === true) {
      prio = PriorityHigh;
    }
    let newTodo = new Todo(nextId, val, false, prio);
    nextId++;
    let next = __append([], ...currentTodos);
    next = __append(next, newTodo.__clone());
    setInputValue("");
    if (highPriority === true) {
      setHighPriority(false);
    }
    doSave(next);
  };
  let onTogglePriority = function() {
    if (highPriority === true) {
      setHighPriority(false);
    } else {
      setHighPriority(true);
    }
  };
  let onFilter = function(f) {
    setFilter(f);
  };
  let onClearCompleted = function() {
    let next = null;
    for (let __i0 = 0, __arr0 = currentTodos, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
      let t = __arr0[__i0];
      if (!t.Done) {
        next = __append(next, t.__clone());
      }
    }
    doSave(next);
  };
  let onDragStart = function(t) {
    return function(e) {
      dragSrcId = t.ID;
      e.dataTransfer.effectAllowed = "move";
    };
  };
  let onDragOver = function(t) {
    return function(e) {
      if (dragSrcId !== t.ID) {
        e.preventDefault();
        let rect = e.currentTarget.getBoundingClientRect();
        dropAfter = e.clientY > rect.top + rect.height / 2;
      }
    };
  };
  let onDrop = function(t) {
    return function(e) {
      e.preventDefault();
      if (dragSrcId !== 0 && dragSrcId !== t.ID) {
        let next = moveTodo(currentTodos, dragSrcId, t.ID, dropAfter);
        dragSrcId = 0;
        doSave(next);
      }
    };
  };
  let onDragEnd = function(e) {
    dragSrcId = 0;
  };
  let remaining = 0;
  let completed = 0;
  let urgent = 0;
  for (let __i0 = 0, __arr0 = currentTodos, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let t = __arr0[__i0];
    if (t.Done) {
      completed++;
    } else {
      remaining++;
    }
    if (t.isUrgent()) {
      urgent++;
    }
  }
  let f = (typeof filter === "number" ? filter : (() => { throw new Error("interface conversion: type assertion failed"); })());
  let visible = null;
  for (let __i0 = 0, __arr0 = currentTodos, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let t = __arr0[__i0];
    if (f === FilterActive && t.Done) {
      continue;
    }
    if (f === FilterCompleted && !t.Done) {
      continue;
    }
    visible = __append(visible, t.__clone());
  }
  let itemElements = null;
  if (__len(visible) === 0) {
    itemElements = __append(itemElements, h("li", __ifm({ "class": "empty" }), "Nothing here."));
  } else {
    for (let __i0 = 0, __arr0 = visible, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
      let t = __arr0[__i0];
      itemElements = __append(itemElements, h(TodoItem, __ifv(new TodoItemProps(t.__clone(), onToggle, onDelete, onEdit, onDragStart(t), onDragOver(t), onDrop(t), onDragEnd))));
    }
  }
  return h("div", __ifm({ "class": "card" }), h(Header, __ifv(new HeaderProps(urgent, String(syncMsg), String(syncCls)))), h(InputRow, __ifv(new InputRowProps(String(inputValue), highPriority === true, saving === true, String(errorMsg), function(e) {
    setInputValue(e.target.value);
  }, function(e) {
    if (e.key === "Enter") {
      onAdd();
    }
  }, onTogglePriority, onAdd))), h("div", __ifm({ "class": "list-divider" })), h("ul", __ifm({ "class": "todo-list" }), ...itemElements), h(Footer, __ifv(new FooterProps(__len(currentTodos), remaining, completed, f, onFilter, onClearCompleted))), h(StatsBar, __ifv(new StatsBarProps(__len(currentTodos), function() {
    onFilter(FilterActive);
  }))));
}

function main() {
  let appEl = document.getElementById("app");
  render(h(App, null), appEl);
}

function filterLabel(f) {
  switch (f) {
    case FilterAll:
    {
      return "All";
    }
    case FilterActive:
    {
      return "Active";
    }
    case FilterCompleted:
    {
      return "Completed";
    }
    default:
    {
      return "";
    }
  }
}

var __json_dec_Todo = typeof __json_dec_Todo !== "undefined" ? __json_dec_Todo : function __json_dec_Todo(parsed, target, box) {
  if (parsed === null) { if (box) box.value = null; return null; }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return __json_err("cannot unmarshal " + __json_type(parsed) + " into Go value of type Todo");
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "id")) {
    var val = parsed["id"];
    if (val !== null) {
      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field Todo.ID of type int");
      target.ID = Math.trunc(val);
    } else {
      target.ID = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "text")) {
    var val = parsed["text"];
    if (val !== null) {
      if (typeof val !== "string") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field Todo.Text of type string");
      target.Text = val;
    } else {
      target.Text = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "done")) {
    var val = parsed["done"];
    if (val !== null) {
      if (typeof val !== "boolean") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field Todo.Done of type bool");
      target.Done = val;
    } else {
      target.Done = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "priority")) {
    var val = parsed["priority"];
    if (val !== null) {
      if (typeof val !== "number") return __json_err("cannot unmarshal " + __json_type(val) + " into Go struct field Todo.Priority of type int");
      target.Priority = Math.trunc(val);
    } else {
      target.Priority = null;
    }
  }
  return null;
};

var __json_dec_slice_Todo = typeof __json_dec_slice_Todo !== "undefined" ? __json_dec_slice_Todo : function __json_dec_slice_Todo(parsed, target, box) {
  if (parsed === null) { if (box) box.value = null; return null; }
  if (!Array.isArray(parsed)) return __json_err("cannot unmarshal " + __json_type(parsed) + " into Go value of type []" + "Todo");
  var out = [];
  for (var i = 0; i < parsed.length; i++) {
    var item = (() => { var inst = new Todo(); var err = __json_dec_Todo(parsed[i], inst); return err || inst; })();
    if (item && item._msg) return item;
    out.push(item);
  }
  if (box) box.value = out;
  return null;
};

var __json_enc_Todo = typeof __json_enc_Todo !== "undefined" ? __json_enc_Todo : function __json_enc_Todo(v) {
  if (v === null || v === undefined) return "null";
  var parts = [];
  { var val = v.ID; parts.push("\"id\":" + String(Math.trunc(val))); }
  { var val = v.Text; parts.push("\"text\":" + __json_esc(val)); }
  { var val = v.Done; parts.push("\"done\":" + (val ? "true" : "false")); }
  { var val = v.Priority; parts.push("\"priority\":" + String(Math.trunc(val))); }
  return "{" + parts.join(",") + "}";
};

var __json_enc_slice_Todo = typeof __json_enc_slice_Todo !== "undefined" ? __json_enc_slice_Todo : function __json_enc_slice_Todo(v) {
  return __json_enc_slice(v, __json_enc_Todo);
};

main();
