// Runtime helpers emitted by the code generator when the corresponding feature is used.
// Each export is a single JS statement (var __x = __x || function(...){...};) so that
// multiple compiled files bundled together can safely repeat the declaration.

export const HELPER_LEN = `var __len = __len || function(a) {
  if (a && typeof a === 'object' && !Array.isArray(a) && !ArrayBuffer.isView(a)) return Object.keys(a).length;
  return a?.length ?? 0;
};`;

export const HELPER_APPEND = `var __append = __append || function(a, ...b) {
  if (a && ArrayBuffer.isView(a)) {
    const res = new a.constructor(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
  }
  return a ? [...a, ...b] : b;
};`;

export const HELPER_S = "var __s = __s || function(a) { return a || []; };";

// In-place stable sort driven by Go's less(i, j) index comparator. The
// comparator reads the live slice, so elements are moved as it runs
// (binary insertion: O(n log n) compares, O(n^2) moves, fine for typed arrays).
export const HELPER_SORT_SLICE = `var __sortSlice = __sortSlice || function(s, less) {
  if (!s) return;
  for (let i = 1; i < s.length; i++) {
    let lo = 0, hi = i;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (less(i, mid)) hi = mid; else lo = mid + 1; }
    if (lo === i) continue;
    const v = s[i];
    for (let k = i; k > lo; k--) s[k] = s[k - 1];
    s[lo] = v;
  }
};`;

// Copy of a struct value whose class is not statically known.
export const HELPER_SCLONE = `var __sclone = __sclone || function(x) {
  if (x === null || typeof x !== "object") return x;
  if (typeof x.__clone === "function") return x.__clone();
  return Object.assign(Object.create(Object.getPrototypeOf(x)), x);
};`;

// Interface boxing: tag struct values (__v) vs struct pointers (__p) so type
// switches can tell T from *T; tags are non-enumerable so __equal/JSON ignore them.
export const HELPER_IFACE_BOX = `var __ifv = __ifv || function(x, ptrFields) {
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
        __ifp(c[f], ptrFields);
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
        __ifp(x[f], ptrFields, seen);
      }
    }
  }
  return x;
};
var __ifm = __ifm || function(x) {
  if (x === null || typeof x !== "object") x = {};
  if (x.__map !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__map", { value: true, configurable: true });
  return x;
};
var __ifpm = __ifpm || function(x) {
  if (x === null || typeof x !== "object") x = {};
  if (x.__map !== true && Object.isExtensible(x)) {
    Object.defineProperty(x, "__map", { value: true, configurable: true });
    Object.defineProperty(x, "__ptr_map", { value: true, configurable: true });
  }
  return x;
};
var __ifs = __ifs || function(x, ptrFields) {
  if (x === null || x === undefined) x = [];
  if (x.__slice !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__slice", { value: true, configurable: true });
  if (Array.isArray(ptrFields) && Object.isExtensible(x))
    Object.defineProperty(x, "__ptr_fields", { value: ptrFields, configurable: true });
  return x;
};
var __ifps = __ifps || function(x) {
  if (x === null || x === undefined) x = [];
  if (x.__slice !== true && Object.isExtensible(x)) {
    Object.defineProperty(x, "__slice", { value: true, configurable: true });
    Object.defineProperty(x, "__ptr_slice", { value: true, configurable: true });
  }
  return x;
};`;

// Nil-interface method call guard (strict mode only): matches Go's panic
// message instead of a JS TypeError.
export const HELPER_NIL_CALL = `var __nilcall = __nilcall || function(x) {
  if (x == null) throw new Error("runtime error: invalid memory address or nil pointer dereference");
  return x;
};`;

export const HELPER_EQUAL = `var __equal = __equal || function __equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.byteLength !== b.byteLength || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!__equal(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!__equal(a[k], b[k])) return false;
    return true;
  }
  return false;
};`;

export const HELPER_CMUL = `var __cmul = __cmul || function(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
};`;

export const HELPER_CDIV = `var __cdiv = __cdiv || function(a, b) {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};`;

// Panic/defer runtime.  \`stack\` holds the in-flight panic of every frame
// currently running its defers; \`armed\` is set right before a deferred
// function is invoked and consumed by that function's prologue, so recover()
// only takes effect when called directly by the deferred function (Go spec).
export const HELPER_PANIC = `var __gopanic = __gopanic || { stack: [], armed: false };
var __runDefers = __runDefers || function(defers, frame) {
  for (let i = defers.length - 1; i >= 0; i--) {
    __gopanic.armed = true;
    try { defers[i](); }
    catch (e) {
      if (frame.pn !== null) __gopanic.stack.pop();
      frame.pn = { err: e, recovered: false };
      __gopanic.stack.push(frame.pn);
    } finally { __gopanic.armed = false; }
  }
  if (frame.pn !== null) {
    __gopanic.stack.pop();
    if (!frame.pn.recovered) throw frame.pn.err;
  }
};
var __recover = __recover || function(ok) {
  if (!ok) return null;
  const s = __gopanic.stack;
  const top = s.length > 0 ? s[s.length - 1] : null;
  if (top === null || top.recovered) return null;
  top.recovered = true;
  return top.err?.message ?? String(top.err);
};`;

export const HELPER_SPRINTF = `var __sprintf = __sprintf || function(f, ...a) {
  let i = 0;
  const ptrMap = new WeakMap();
  let ptrCounter = 1;
  const getPtr = (o) => {
    let p = ptrMap.get(o);
    if (!p) {
      p = "0x" + (ptrCounter++).toString(16);
      ptrMap.set(o, p);
    }
    return p;
  };
  const formatV = (val, isPlus, isTopLevel) => {
    if (val === null || val === undefined) return "<nil>";
    if (typeof val === "boolean") return String(val);
    if (typeof val === "number" || typeof val === "bigint") return String(val);
    if (typeof val === "string") return val;
    if (typeof val === "object") {
      if ("re" in val && "im" in val) {
        const sign = val.im >= 0 ? "+" : "";
        return "(" + val.re + sign + val.im + "i)";
      }
      if (typeof val.Error === "function") {
        return String(val.Error());
      }
      if (Array.isArray(val) || ArrayBuffer.isView(val)) {
        const isElemPtr = val.__ptr_slice === true;
        const pf = val.__ptr_fields;
        const parts = [];
        for (let j = 0; j < val.length; j++) {
          const item = val[j];
          if (isElemPtr && item !== null && typeof item === "object" && item.__p !== true && Object.isExtensible(item)) {
            __ifp(item);
          } else if (Array.isArray(pf) && item !== null && typeof item === "object") {
            for (const f of pf) {
              if (f.indexOf(".") !== -1) {
                const fparts = f.split(".");
                let cur = item;
                for (let k = 0; k < fparts.length - 1; k++) cur = cur?.[fparts[k]];
                const last = fparts[fparts.length - 1];
                if (cur?.[last] !== null && typeof cur?.[last] === "object") __ifp(cur[last]);
              } else if (item[f] !== null && typeof item[f] === "object") {
                __ifp(item[f]);
              }
            }
          }
          parts.push(formatV(item, isPlus, false));
        }
        return "[" + parts.join(" ") + "]";
      }
      if (val instanceof Map || val.__map === true) {
        const isElemPtr = val.__ptr_map === true;
        const parts = [];
        if (val instanceof Map) {
          const entries = Array.from(val.entries()).sort(([k1], [k2]) => {
            if (typeof k1 === "number" && typeof k2 === "number") return k1 - k2;
            const na = Number(k1), nb = Number(k2);
            if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
            return String(k1).localeCompare(String(k2));
          });
          for (const [k, v] of entries) {
            if (isElemPtr && v !== null && typeof v === "object" && v.__p !== true && Object.isExtensible(v)) {
              __ifp(v);
            }
            parts.push(formatV(k, isPlus, false) + ":" + formatV(v, isPlus, false));
          }
        } else {
          const keys = Object.keys(val).sort((a, b) => {
            const na = Number(a), nb = Number(b);
            if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
            return a.localeCompare(b);
          });
          for (const k of keys) {
            const v = val[k];
            if (isElemPtr && v !== null && typeof v === "object" && v.__p !== true && Object.isExtensible(v)) {
              __ifp(v);
            }
            parts.push(formatV(k, isPlus, false) + ":" + formatV(v, isPlus, false));
          }
        }
        return "map[" + parts.join(" ") + "]";
      }
      if ("value" in val && (val.__box === true || (!val.__struct && !("__v" in val) && Object.keys(val).length === 1 && (val.constructor === Object || val.constructor?.name === "Object")))) {
        return getPtr(val);
      }
      const isPtr = val.__p === true;
      if (isPtr) {
        if (!isTopLevel) {
          return getPtr(val);
        }
        getPtr(val);
      }
      const prefix = isPtr ? "&{" : "{";
      const keys = Object.keys(val);
      const parts = [];
      for (const k of keys) {
        const fv = formatV(val[k], isPlus, false);
        parts.push(isPlus ? k + ":" + fv : fv);
      }
      return prefix + parts.join(" ") + "}";
    }
    return String(val);
  };
  return f.replace(/%([#+\\- 0]*)([0-9]*)\\.?([0-9]*)[sdvftxXqobeEgGwc%]/g, (m) => {
    if (m === "%%") return "%";
    const verb = m.slice(-1);
    const v = a[i++];
    const [, flags, width, prec] = m.match(/^%([#+\\- 0]*)([0-9]*)\\.?([0-9]*)/) || [];
    const zero = flags?.includes("0") && !flags?.includes("-");
    const pad = (s, w, z) => {
      w = parseInt(w) || 0;
      if (!w) return s;
      const p = (z ? "0" : " ").repeat(Math.max(0, w - s.length));
      return flags.includes("-") ? s + p : p + s;
    };
    switch (verb) {
      case "s": return pad(String(v == null ? "<nil>" : v), width, false);
      case "c": return pad(String.fromCodePoint(Number(v)), width, false);
      case "d": return pad(String(Math.trunc(Number(v))), width, zero);
      case "v": {
        const isPlus = flags?.includes("+") ?? false;
        return pad(formatV(v, isPlus, true), width, false);
      }
      case "f": { const n = Number(v), p = prec !== "" ? parseInt(prec) : 6; return pad(n.toFixed(p), width, zero); }
      case "t": return pad(String(!!v), width, false);
      case "x": return pad((Number(v) >>> 0).toString(16), width, zero);
      case "X": return pad((Number(v) >>> 0).toString(16).toUpperCase(), width, zero);
      case "o": return pad((Number(v) >>> 0).toString(8), width, zero);
      case "b": return pad((Number(v) >>> 0).toString(2), width, zero);
      case "q": return pad('"' + String(v == null ? "" : v).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"') + '"', width, false);
      case "e": case "E": { const n = Number(v), p = prec !== "" ? parseInt(prec) : 6; return pad(n.toExponential(p), width, zero); }
      case "g": case "G": { const n = Number(v); return pad(prec !== "" ? n.toPrecision(parseInt(prec)) : String(n), width, zero); }
      case "w": return pad(String(v == null ? "<nil>" : typeof v === "object" && v.Error ? v.Error() : v), width, false);
      default: return m;
    }
  });
};`;

export const HELPER_ERROR = `var __error = __error || function(msg, cause) {
  return { Error() { return msg; }, toString() { return msg; }, _msg: msg, _cause: cause ?? null };
};
var __strconv_err_syntax = __strconv_err_syntax || __error("invalid syntax");
var __strconv_err_range = __strconv_err_range || __error("value out of range");
var __path_err_bad_pattern = __path_err_bad_pattern || __error("syntax error in pattern");
var __io_eof = __io_eof || __error("EOF");`;

export const HELPER_ERROR_IS = `var __errorIs = __errorIs || function(err, target) {
  while (err !== null && err !== undefined) {
    if (err === target) return true;
    if (typeof err === "object" && typeof target === "object" &&
        err._msg !== undefined && target._msg !== undefined &&
        err._msg === target._msg) return true;
    err = err?._cause ?? null;
  }
  return false;
};`;

// Go-semantics strconv parsers shared by the JS backend and the wasm runtime
// imports (boundary.js), so both targets agree.  Each parser returns
// [value, errorMessage | null]; integer values are BigInt (the wasm side
// needs i64, the JS side converts with Number()).
export const HELPER_STRCONV = `var __strconv_atoi = __strconv_atoi || function(s) {
  if (!/^[+-]?[0-9]+$/.test(s)) return [0n, 'strconv.Atoi: parsing "' + s + '": invalid syntax'];
  const v = BigInt(s);
  if (v > 9223372036854775807n || v < -9223372036854775808n) {
    return [v > 0n ? 9223372036854775807n : -9223372036854775808n, 'strconv.Atoi: parsing "' + s + '": value out of range'];
  }
  return [v, null];
};
var __strconv_parse_int = __strconv_parse_int || function(s, base, bits) {
  let str = s, neg = false;
  if (str[0] === "-" || str[0] === "+") { neg = str[0] === "-"; str = str.slice(1); }
  if (base === 0) {
    if (/^0[xX]/.test(str)) { base = 16; str = str.slice(2); }
    else if (/^0[bB]/.test(str)) { base = 2; str = str.slice(2); }
    else if (/^0[oO]/.test(str)) { base = 8; str = str.slice(2); }
    else if (/^0[0-9]/.test(str)) { base = 8; str = str.slice(1); }
    else base = 10;
    str = str.replaceAll("_", "");
  }
  if (base < 2 || base > 36) return [0n, 'strconv.ParseInt: parsing "' + s + '": invalid base ' + base];
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, base);
  if (str === "" || [...str.toLowerCase()].some((c) => !digits.includes(c))) {
    return [0n, 'strconv.ParseInt: parsing "' + s + '": invalid syntax'];
  }
  let v = 0n; const B = BigInt(base);
  for (const c of str.toLowerCase()) v = v * B + BigInt(digits.indexOf(c));
  if (neg) v = -v;
  const w = bits === 0 ? 64 : bits;
  const max = (1n << BigInt(w - 1)) - 1n, min = -(1n << BigInt(w - 1));
  if (v > max || v < min) return [v > max ? max : min, 'strconv.ParseInt: parsing "' + s + '": value out of range'];
  return [v, null];
};
var __strconv_parse_float = __strconv_parse_float || function(s) {
  const str = s.replaceAll("_", "");
  if (/^[+-]?(inf|infinity)$/i.test(str)) return [str[0] === "-" ? -Infinity : Infinity, null];
  if (/^[+-]?nan$/i.test(str)) return [NaN, null];
  if (str === "" || !/^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$|^[+-]?0[xX][0-9a-fA-F]+$/.test(str)) {
    return [0, 'strconv.ParseFloat: parsing "' + s + '": invalid syntax'];
  }
  return [Number(str), null];
};
var __strconv_parse_bool = __strconv_parse_bool || function(s) {
  if (["1", "t", "T", "TRUE", "true", "True"].includes(s)) return [true, null];
  if (["0", "f", "F", "FALSE", "false", "False"].includes(s)) return [false, null];
  return [false, 'strconv.ParseBool: parsing "' + s + '": invalid syntax'];
};
var __strconv_format_float = __strconv_format_float || function(f, fmtc, prec) {
  const c = String.fromCharCode(fmtc);
  if (!Number.isFinite(f)) return f !== f ? "NaN" : (f > 0 ? "+Inf" : "-Inf");
  if (c === "f") return prec < 0 ? String(f) : f.toFixed(prec);
  if (c === "e" || c === "E") {
    const r = prec < 0 ? f.toExponential() : f.toExponential(prec);
    const o = r.replace(/e([+-])(\\d)$/, "e$10$2");
    return c === "E" ? o.toUpperCase() : o;
  }
  if (c === "g" || c === "G") {
    const r = prec < 0 ? String(f) : f.toPrecision(prec);
    return c === "G" ? r.toUpperCase() : r;
  }
  return String(f);
};`;

export const HELPER_PATH_CLEAN = `var __pathClean = __pathClean || function(p) {
  if (!p) return ".";
  const abs = p.startsWith("/");
  const parts = p.split("/").reduce((acc, s) => {
    if (s === "" || s === ".") return acc;
    if (s === "..") {
      if (acc.length && acc[acc.length - 1] !== "..") acc.pop();
      else if (!abs) acc.push("..");
    } else acc.push(s);
    return acc;
  }, []);
  return (abs ? "/" : "") + (parts.join("/") || ".");
};
var __pathMatch = __pathMatch || function(pat, name) {
  let rx = "^";
  let inClass = false;
  let hasErr = false;
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (inClass) {
      if (c === "\\\\") {
        if (i + 1 >= pat.length) { hasErr = true; break; }
        rx += "\\\\" + pat[++i];
      } else if (c === "]") {
        inClass = false;
        rx += "]";
      } else {
        if (/[.^$*+?()|{}\\[\\]\\\\]/.test(c) && c !== "-") {
          rx += "\\\\" + c;
        } else {
          rx += c;
        }
      }
    } else {
      if (c === "\\\\") {
        if (i + 1 >= pat.length) { hasErr = true; break; }
        rx += "\\\\" + pat[++i];
      } else if (c === "*") {
        rx += "[^/]*";
      } else if (c === "?") {
        rx += "[^/]";
      } else if (c === "[") {
        inClass = true;
        rx += "[";
      } else if (/[.^$*+?()|{}\\[\\]\\\\]/.test(c)) {
        rx += "\\\\" + c;
      } else {
        rx += c;
      }
    }
  }
  if (inClass || hasErr) return [false, true];
  try {
    const re = new RegExp(rx + "$");
    return [re.test(name), false];
  } catch (e) {
    return [false, true];
  }
};`;

export const HELPER_TIME_FMT = `var __timeFmt = __timeFmt || function(d, layout) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return layout.replace(/2006|06|Monday|Mon|January|Jan|01|1|02|2|15|PM|3|04|4|05|5|Z07:00|\\.000|\\.999/g, t => {
    switch (t) {
      case "2006": return d.getFullYear();
      case "06":   return String(d.getFullYear()).slice(-2);
      case "Monday": return DAYS[d.getDay()];
      case "Mon":    return DAYS[d.getDay()].slice(0, 3);
      case "January": return MONTHS[d.getMonth()];
      case "Jan":     return MONTHS[d.getMonth()].slice(0, 3);
      case "01": return pad(d.getMonth() + 1);
      case "1":  return String(d.getMonth() + 1);
      case "02": return pad(d.getDate());
      case "2":  return String(d.getDate());
      case "15": return pad(d.getHours());
      case "PM": return d.getHours() < 12 ? "AM" : "PM";
      case "3":  return String(d.getHours() % 12 || 12);
      case "04": return pad(d.getMinutes());
      case "4":  return String(d.getMinutes());
      case "05": return pad(d.getSeconds());
      case "5":  return String(d.getSeconds());
      case "Z07:00": {
        const o = -d.getTimezoneOffset();
        return o === 0 ? "Z" : (o > 0 ? "+" : "-") + pad(Math.floor(Math.abs(o) / 60)) + ":" + pad(Math.abs(o) % 60);
      }
      case ".000": return "." + pad(d.getMilliseconds(), 3);
      case ".999": return d.getMilliseconds() > 0 ? "." + String(d.getMilliseconds()).replace(/0+$/, "") : "";
      default: return t;
    }
  });
};`;

export const HELPER_TIME_PARSE = `var __timeParse = __timeParse || function(layout, value) {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw 0;
    return [{ _d: d }, null];
  } catch {
    return [{ _d: new Date(0) }, "parsing time: cannot parse"];
  }
};`;

export const HELPER_TESTING = `var __GoFront_FailNow = __GoFront_FailNow || class extends Error {
  constructor() { super("FailNow"); this.name = "__GoFront_FailNow"; }
};
var __GoFront_SkipNow = __GoFront_SkipNow || class extends Error {
  constructor() { super("SkipNow"); this.name = "__GoFront_SkipNow"; }
};
var __GoFront_T = __GoFront_T || class {
  constructor(name = "", parent = null) {
    this._name = name;
    this._parent = parent;
    this.failed = false;
    this.skipped = false;
    this._logs = [];
    this._start = typeof performance !== "undefined" ? performance.now() : Date.now();
  }
  Name() { return this._name; }
  Fail() {
    this.failed = true;
    if (this._parent) this._parent.Fail();
  }
  Failed() { return this.failed; }
  FailNow() {
    this.Fail();
    throw new __GoFront_FailNow();
  }
  Log(...args) {
    const msg = args.map(a => {
      if (typeof a === "object" && a !== null) {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    }).join(" ");
    this._logs.push(msg);
  }
  Logf(format, ...args) {
    const msg = typeof __sprintf === "function" ? __sprintf(format, ...args) : format;
    this._logs.push(msg);
  }
  Error(...args) {
    this.Fail();
    this.Log(...args);
  }
  Errorf(format, ...args) {
    this.Fail();
    this.Logf(format, ...args);
  }
  Fatal(...args) {
    this.Log(...args);
    this.FailNow();
  }
  Fatalf(format, ...args) {
    this.Logf(format, ...args);
    this.FailNow();
  }
  Skip(...args) {
    this.skipped = true;
    if (args.length > 0) this.Log(...args);
    throw new __GoFront_SkipNow();
  }
  Skipf(format, ...args) {
    this.skipped = true;
    this.Logf(format, ...args);
    throw new __GoFront_SkipNow();
  }
  Skipped() { return this.skipped; }
  Helper() {}
  Run(name, fn) {
    const subName = this._name ? \`\${this._name}/\${name}\` : name;
    const subT = new __GoFront_T(subName, this);
    if (typeof globalThis.__onSubtestStart === "function") globalThis.__onSubtestStart(subName);
    try {
      const res = fn(subT);
      if (res && typeof res.then === "function") {
        return res.then(() => {
          if (typeof globalThis.__onSubtestEnd === "function") globalThis.__onSubtestEnd(subT);
          return !subT.failed;
        }).catch(e => {
          if (e instanceof __GoFront_FailNow) {
            // expected
          } else if (e instanceof __GoFront_SkipNow) {
            // expected
          } else {
            subT.Fail();
            subT.Log("panic: " + (e?.message ?? String(e)));
          }
          if (typeof globalThis.__onSubtestEnd === "function") globalThis.__onSubtestEnd(subT);
          return false;
        });
      }
    } catch (e) {
      if (e instanceof __GoFront_FailNow) {
        // expected on FailNow
      } else if (e instanceof __GoFront_SkipNow) {
        // expected on Skip
      } else {
        subT.Fail();
        subT.Log("panic: " + (e?.message ?? String(e)));
      }
    }
    if (typeof globalThis.__onSubtestEnd === "function") globalThis.__onSubtestEnd(subT);
    return !subT.failed;
  }
};
var __testing_T = __GoFront_T;`;

export const HELPER_INJECT_STYLES = `var __injectStyles = __injectStyles || function(css) {
  if (typeof document === "undefined" || !document || !document.head || !css) return;
  let s = document.getElementById("gofront-styles");
  if (!s) {
    s = document.createElement("style");
    s.id = "gofront-styles";
    document.head.appendChild(s);
  }
  s.textContent += "\\n" + css;
};`;
