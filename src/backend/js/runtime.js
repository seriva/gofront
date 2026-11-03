import { HELPER_FMT_LOOP, HELPER_FMT_UTIL } from "./fmt-runtime.js";

// Runtime helpers emitted by the code generator when the corresponding feature is used.
// Each export is a single JS statement (var __x = __x || function(...){...};) so that
// multiple compiled files bundled together can safely repeat the declaration.

export const HELPER_LEN = `var __len = __len || function(a) {
  if (a && typeof a === 'object' && !Array.isArray(a) && !ArrayBuffer.isView(a)) return Object.keys(a).length;
  return a?.length ?? 0;
};`;

// Slice views (Go's `b[lo:hi:max]` shares the backing store).  A view of a
// plain array is a Proxy over an empty `__SV` array that holds the backing
// array `b`, offset `o`, length `n` and capacity `c`: Array.isArray, length,
// indexing, iteration and the Array.prototype methods work through the traps,
// so the rest of the runtime and JS callers see an ordinary array (`__SV`
// makes Array.prototype methods return plain arrays and Node print the
// elements).  A view covering its whole backing array is that array.  A
// typed-array view is a `subarray`; a capacity beyond its length is kept in a
// WeakMap shared by every compiled module.  `__slice` also accepts strings
// (generic code).  `__reslice` is `x = x[lo:hi]`: within `len(x)` a plain
// array is copied instead (a Proxy is much slower to index, and the old
// value of `x` is usually dead), see docs/go-compatibility.md.
// The copy keeps the capacity of the old value: its `__rcap` symbol property
// (shared by every compiled module) is `{b, o, c, s, so, own}` (backing array,
// offset, capacity, snapshot of the copy, its offset in `s`, and false while
// `s` is shared with another copy).  An index
// write `x[i] = v` to a chain that the package self-reslices is followed by
// `__rcs(x, i)`, which writes the element through to `b` (and `s`), so it is
// ordered with writes through other slices of `b`.  A slice or `append`
// beyond the copy's length writes the remaining elements that differ from the
// snapshot (written through other references to the copy) back into `b`
// first and continues with a view over `b`.  `__mkslice` is `make([]T, n, cap)`.
// `__sv` is its own helper ("sv") so range loops can unwrap a view without
// pulling in the rest.
export const HELPER_SV = `var __sv = __sv || Symbol.for("gofront.sliceView");`;

export const HELPER_SLICE = `var __tcap = __tcap || (globalThis[Symbol.for("gofront.typedCap")] ??= new WeakMap());
var __SV = __SV || class extends Array {
  static get [Symbol.species]() { return Array; }
  [Symbol.for("nodejs.util.inspect.custom")]() { return Array.from(this); }
};
var __rcap = __rcap || Symbol.for("gofront.resliceCap");
var __svh = __svh || {
  get(t, k) {
    if (typeof k === "string") {
      const ch = k.charCodeAt(0);
      if (ch >= 48 && ch <= 57) { const i = +k; return i < t.n ? t.b[t.o + i] : undefined; }
      if (k === "length") return t.n;
    } else if (k === __sv) return t;
    return t[k];
  },
  set(t, k, v) {
    if (typeof k === "string") {
      const ch = k.charCodeAt(0);
      if (ch >= 48 && ch <= 57) { const i = +k; if (i < t.n) t.b[t.o + i] = v; return true; }
      if (k === "length") return true;
    }
    t[k] = v;
    return true;
  },
  has(t, k) {
    if (typeof k === "string") {
      const ch = k.charCodeAt(0);
      if (ch >= 48 && ch <= 57) return +k < t.n;
    }
    return k in t;
  },
  defineProperty(t, k, d) {
    if (typeof k === "string") {
      const ch = k.charCodeAt(0);
      if (ch >= 48 && ch <= 57) {
        const i = +k;
        if (i >= t.n || d.get || d.set || d.configurable === false) return false;
        if ("value" in d) t.b[t.o + i] = d.value;
        return true;
      }
    }
    return Reflect.defineProperty(t, k, d);
  },
  preventExtensions() { return false; },
  deleteProperty(t, k) {
    if (typeof k === "string" && k.charCodeAt(0) >= 48 && k.charCodeAt(0) <= 57) return true;
    return delete t[k];
  },
  ownKeys(t) {
    const ks = [];
    for (let i = 0; i < t.n; i++) ks.push(String(i));
    ks.push("length");
    return ks;
  },
  getOwnPropertyDescriptor(t, k) {
    if (typeof k === "string") {
      const ch = k.charCodeAt(0);
      if (ch >= 48 && ch <= 57) {
        const i = +k;
        return i < t.n ? { value: t.b[t.o + i], writable: true, enumerable: true, configurable: true } : undefined;
      }
      if (k === "length") return { value: t.n, writable: true, enumerable: false, configurable: false };
    }
    return Reflect.getOwnPropertyDescriptor(t, k);
  },
};
var __mkview = __mkview || function(b, o, n, c, f) {
  if (o === 0 && n === b.length && c === n && !f) return b;
  if (c === 0) return [];
  const t = new __SV();
  t.b = b; t.o = o; t.n = n; t.c = c;
  return new Proxy(t, __svh);
};
var __cap = __cap || function(a) {
  if (a == null) return 0;
  const s = a[__sv];
  if (s !== undefined) return s.c;
  if (ArrayBuffer.isView(a)) return __tcap.get(a) ?? a.length;
  return a[__rcap]?.c ?? a.length;
};
// A snapshot shared by a copy of a copy (e.own false) is cloned before it is
// updated, so the update does not reach the other copy's snapshot (whose
// write-back would then revert the element).
var __rcown = __rcown || function(e, a) {
  if (e.own === false) { e.s = e.s.slice(e.so, e.so + a.length); e.so = 0; e.own = true; }
  return e.s;
};
// Write back only the elements of a __reslice copy that changed since it was
// made (e.s from e.so is its snapshot, kept up to date by __rcs), so writes
// made meanwhile through other slices of the backing array are kept.
var __rcput = __rcput || function(e, a, from, to) {
  for (let i = from; i < to; i++) {
    const v = a[i];
    if (!Object.is(v, e.s[e.so + i])) { e.b[e.o + i] = v; __rcown(e, a)[e.so + i] = v; }
  }
};
// After an index write to a possible __reslice copy: write element i through.
var __rcs = __rcs || function(a, i) {
  const e = a?.[__rcap];
  if (e !== undefined && i >= 0 && i < e.c && i < a.length) { const v = a[i]; e.b[e.o + i] = v; __rcown(e, a)[e.so + i] = v; }
};
var __rcdef = __rcdef || function(r, e) {
  Object.defineProperty(r, __rcap, { value: e, writable: true });
};
var __rcflush = __rcflush || function(a) {
  const e = a[__rcap];
  if (e !== undefined) __rcput(e, a, 0, a.length);
  return e;
};
var __slice = __slice || function(a, lo, hi, max) {
  if (typeof a === "string") return a.slice(lo, hi);
  const s = a == null ? undefined : a[__sv];
  const n = s !== undefined ? s.n : a == null ? 0 : a.length;
  const c = s !== undefined ? s.c : __cap(a);
  const mx = max;
  if (hi === undefined) hi = n;
  if (max === undefined) max = c;
  if (!(lo >= 0 && lo <= hi && hi <= max && max <= c)) throw new Error("runtime error: slice bounds out of range");
  if (a == null) return a;
  if (s !== undefined) return __mkview(s.b, s.o + lo, hi - lo, max - lo);
  if (c > n && Array.isArray(a)) {
    // a is a __reslice copy (only those have cap > len): reach past its
    // length or capacity through the backing array, else stay on the copy
    // (an explicit max needs a view: the copy itself keeps the old cap).
    if (hi <= n && (mx === undefined || mx <= n)) return __mkview(a, lo, hi - lo, Math.min(max, n) - lo, mx !== undefined);
    else { const e = __rcflush(a); return __mkview(e.b, e.o + lo, hi - lo, max - lo); }
  }
  if (ArrayBuffer.isView(a)) {
    const r = hi <= n ? a.subarray(lo, hi) : new a.constructor(a.buffer, a.byteOffset + lo * a.BYTES_PER_ELEMENT, hi - lo);
    if (max - lo > hi - lo) __tcap.set(r, max - lo);
    return r;
  }
  return __mkview(a, lo, hi - lo, max - lo);
};
var __reslice = __reslice || function(a, lo, hi) {
  if (Array.isArray(a) && a[__sv] === undefined) {
    const n = a.length;
    if (hi === undefined) hi = n;
    if (lo >= 0 && lo <= hi && hi <= n) {
      if (lo === 0 && hi === n) return a;
      const e = a[__rcap];
      const r = a.slice(lo, hi);
      if (e === undefined) {
        __rcdef(r, { b: a, o: lo, c: n - lo, s: a.slice(lo, hi), so: 0 });
        return r;
      }
      // A copy of a copy: write back the changed elements it drops and share
      // the snapshot (copied on write, __rcown), so a pop costs no more than
      // the copy itself.
      if (lo > 0) __rcput(e, a, 0, lo);
      __rcput(e, a, hi, n);
      e.own = false;
      __rcdef(r, { b: e.b, o: e.o + lo, c: e.c - lo, s: e.s, so: e.so + lo, own: false });
      return r;
    }
  }
  return __slice(a, lo, hi);
};
var __mkslice = __mkslice || function(n, b) {
  if (!(n >= 0 && n <= b.length)) throw new Error("runtime error: makeslice: cap out of range");
  return __slice(b, 0, n);
};`;

export const HELPER_APPEND = `var __tn = __tn || function(c) {
  return Object.hasOwn(c, "__tnil") ? c.__tnil : Object.defineProperty(c, "__tnil", { value: Object.defineProperty(new c(0), "__nilt", { value: true }) }).__tnil;
};
var __append = __append || function(a, ...b) {
  if (b.length === 0) return a !== null && a !== undefined && a.__nilt === true ? null : a;
  if (a && ArrayBuffer.isView(a)) {
    const c = __tcap.get(a);
    if (c !== undefined && a.length + b.length <= c) {
      const r = new a.constructor(a.buffer, a.byteOffset, a.length + b.length);
      r.set(b, a.length);
      if (c > r.length) __tcap.set(r, c);
      return r;
    }
    const res = new a.constructor(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
  }
  const s = a ? a[__sv] : undefined;
  if (s !== undefined && s.n + b.length <= s.c) {
    for (let i = 0; i < b.length; i++) s.b[s.o + s.n + i] = b[i];
    return __mkview(s.b, s.o, s.n + b.length, s.c);
  }
  if (s === undefined && a) {
    const e = a[__rcap];
    if (e !== undefined && a.length + b.length <= e.c) {
      __rcflush(a);
      for (let i = 0; i < b.length; i++) e.b[e.o + a.length + i] = b[i];
      return __mkview(e.b, e.o, a.length + b.length, e.c);
    }
  }
  return a ? [...a, ...b] : b;
};`;

export const HELPER_S = "var __s = __s || function(a) { return a || []; };";

// Copy of a struct value whose class is not statically known.
export const HELPER_SCLONE = `var __sclone = __sclone || function(x) {
  if (x === null || typeof x !== "object") return x;
  if (typeof x.__clone === "function") return x.__clone();
  return Object.assign(Object.create(Object.getPrototypeOf(x)), x);
};`;

// Variadic prologue.  `f(xs...)` to a Go-compiled variadic function passes
// `{ __sp: xs }`, so the parameter is the caller's slice itself (or nil).
export const HELPER_VA = `var __va = __va || function(a, nilEmpty) {
  const f = a.length === 1 ? a[0] : undefined;
  if (a.length === 0 && nilEmpty) return null;
  return f !== null && typeof f === "object" && f.__sp !== undefined ? f.__sp : a;
};`;

// Copy of a value whose type is a type parameter.  `z` is the argument's
// zero-value factory: an object zero means a struct or array (copied by
// value); anything else (scalars, pointers, interfaces) is returned as is.
export const HELPER_VCLONE = `var __vclone = __vclone || function __vclone(z, x) {
  if (x === null || typeof x !== "object") return x;
  const zero = z?.();
  if (zero === null || zero === undefined || typeof zero !== "object") return x;
  const cp = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(cp);
    if (typeof v.__clone === "function") return v.__clone();
    return Object.assign(Object.create(Object.getPrototypeOf(v)), v);
  };
  return cp(x);
};`;

// == on type-parameter operands: structs and arrays compare by value, other
// type arguments with ===.  Decided at run time from the zero-value factory.
export const HELPER_GEQ = `var __geq = __geq || function(z, a, b) {
  if (a === b) return true;
  if (z?.k === "iface") return __ifeq(a, b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const zero = z?.();
  if (zero === null || zero === undefined || typeof zero !== "object") return false;
  return __equal(a, b);
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
        __ifp(c[f]);
      }
    }
  }
  for (const k of Object.keys(c)) {
    if (c[k] !== null && typeof c[k] === "object" && !Array.isArray(c[k]) && !ArrayBuffer.isView(c[k])) {
      if (!c[k].__v && !c[k].__p && Object.isExtensible(c[k]) && (!Array.isArray(ptrFields) || !ptrFields.includes(k))) {
        Object.defineProperty(c[k], "__v", { value: true, configurable: true });
      }
    }
  }
  return c;
};
var __builder_proto = __builder_proto || {
  Write(d) {
    this._buf += new TextDecoder().decode(new Uint8Array(d));
    return [d.length, null];
  },
  WriteString(s) {
    this._buf += s;
    return [new TextEncoder().encode(s).length, null];
  },
  String() {
    return this._buf;
  },
  Reset() {
    this._buf = "";
  }
};
var __ifp = __ifp || function(x, ptrFields, seen) {
  if (x === null || typeof x !== "object") return x;
  if (typeof x._buf === "string" && typeof x.WriteString !== "function") Object.assign(x, __builder_proto);
  if (x.__p !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__p", { value: true, configurable: true, writable: true });
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
var __mknil = __mknil || function(C) {
  const s = Object.create(C.prototype);
  Object.defineProperty(s, "__nilp", { value: true });
  Object.defineProperty(s, "__p", { value: true });
  const vm = C.__vm || [];
  for (const k of Object.getOwnPropertyNames(C.prototype)) {
    const f = C.prototype[k];
    if (k === "constructor" || k === "toString" || k.startsWith("__") || typeof f !== "function") continue;
    Object.defineProperty(s, k, { value: vm.includes(k)
      ? function() { throw new Error("runtime error: invalid memory address or nil pointer dereference"); }
      : function(...a) { return f.apply(null, a); } });
  }
  Object.defineProperty(C, "__nil", { value: s });
  return s;
};
var __ifn = __ifn || function(x, C) {
  return x === null ? (Object.hasOwn(C, "__nil") ? C.__nil : __mknil(C)) : x;
};
var __unnil = __unnil || function(x) {
  return x != null && x.__nilp === true ? null : x;
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
};`;

// fmt metadata: the Stringer/error element types of a slice, array or map
// converted to an interface (the elements are raw numbers/strings at run
// time), as a non-enumerable __fd descriptor that __sprintf reads.
export const HELPER_IFD = `var __ifd = __ifd || function(x, d) {
  if (x !== null && typeof x === "object" && Object.isExtensible(x))
    Object.defineProperty(x, "__fd", { value: d, configurable: true });
  return x;
};`;

// Nil-interface method call guard (strict mode only): matches Go's panic
// message instead of a JS TypeError.
// 64-bit shifts: count is converted to BigInt; negative count panics;
// wraps with BigInt.asIntN / BigInt.asUintN.
export const HELPER_SHIFT = `var __shl64 = __shl64 || function(x, n, u) {
  var b = BigInt(n);
  if (b < 0n) throw new Error("runtime error: negative shift amount");
  if (typeof x === "bigint") {
    if (b >= 64n) return 0n;
    var bx = u ? BigInt.asUintN(64, x) : BigInt.asIntN(64, x);
    var r = bx << b;
    return u ? BigInt.asUintN(64, r) : BigInt.asIntN(64, r);
  }
  if (b >= 64n) return 0;
  var nb = Number(b);
  var r = x * 2 ** nb;
  if (Number.isSafeInteger(r)) return r;
  var bxx = BigInt(Math.trunc(x)) << b;
  return Number(u ? BigInt.asUintN(64, bxx) : BigInt.asIntN(64, bxx));
};
var __shr64 = __shr64 || function(x, n, u) {
  var b = BigInt(n);
  if (b < 0n) throw new Error("runtime error: negative shift amount");
  if (typeof x === "bigint") {
    var bx = u ? BigInt.asUintN(64, x) : BigInt.asIntN(64, x);
    if (b >= 64n) return u || bx >= 0n ? 0n : -1n;
    var r = bx >> b;
    return u ? BigInt.asUintN(64, r) : BigInt.asIntN(64, r);
  }
  if (b >= 64n) return u || x >= 0 ? 0 : -1;
  return Math.floor(x / 2 ** Number(b));
};`;

export const HELPER_TO64 = `var __to_i64 = __to_i64 || function(v) {
  if (typeof v === "bigint") return BigInt.asIntN(64, v);
  return Number.isFinite(v) ? BigInt.asIntN(64, BigInt(Math.trunc(v))) : -9223372036854775808n;
};
var __to_u64 = __to_u64 || function(v) {
  if (typeof v === "bigint") return BigInt.asUintN(64, v);
  return Number.isFinite(v) ? BigInt.asUintN(64, BigInt(Math.trunc(v))) : 9223372036854775808n;
};`;

export const HELPER_NIL_CALL = `var __nilcall = __nilcall || function(x) {
  if (x == null) throw new Error("runtime error: invalid memory address or nil pointer dereference");
  return x;
};`;

// Strict-mode index checks (`both` packages): Go's out-of-range panic for
// slices, arrays and strings.  `__at` reads an element; `__ix` returns the
// checked index for writes, compound assignments and string reads.  A nil
// slice (`null`) has length 0.
export const HELPER_BOUNDS = `var __ixerr = __ixerr || function(i, n) {
  throw new Error(i < 0 ? "runtime error: index out of range [" + i + "]" : "runtime error: index out of range [" + i + "] with length " + n);
};
var __at = __at || function(a, i) {
  if (a != null && i >= 0 && i < a.length) return a[i];
  return __ixerr(i, a == null ? 0 : a.length);
};
var __ix = __ix || function(a, i) {
  if (a != null && i >= 0 && i < a.length) return i;
  return __ixerr(i, a == null ? 0 : a.length);
};
var __lv;`;

// Generic zero values (generics are erased in JS): a generic function takes
// one zero-value factory per type parameter as leading arguments, and an
// instance of a generic struct keeps its factories under the `__tz` symbol
// (a symbol, so field iteration, equality and JSON never see it).  Shared
// factories for the common zero values avoid a closure per call.
export const HELPER_GENERICS = `var __tz = __tz || Symbol.for("gofront.typeArgs");
var __zn = __zn || (() => null);
var __z0 = __z0 || (() => 0);
var __zs = __zs || (() => "");
var __zf = __zf || (() => false);
var __z64 = __z64 || Object.assign(() => 0n, { k: "int64" });
var __zu64 = __zu64 || Object.assign(() => 0n, { k: "uint64" });
var __ti = __ti || function(f, k, id, is, u, b, fb) {
  const g = () => f();
  g.k = k; g.id = id; g.is = is; g.u = u; g.b = b; g.fb = fb;
  return g;
};
var __tid = __tid || function(...ids) {
  return ids.every((i) => i !== undefined) ? ids.join(",") : undefined;
};
var __tconv = __tconv || function(f, v) {
  switch (f?.k) {
    case "int64": return typeof v === "bigint" ? BigInt.asIntN(64, v) : (typeof v === "number" ? BigInt.asIntN(64, BigInt(Math.trunc(v))) : v);
    case "uint64": return typeof v === "bigint" ? BigInt.asUintN(64, v) : (typeof v === "number" ? BigInt.asUintN(64, BigInt(Math.trunc(v))) : v);
    case "int": case "uint": case "uintptr": return Math.trunc(Number(typeof v === "bigint" ? Number(v) : v));
    case "int8": return (Number(typeof v === "bigint" ? Number(v) : v) << 24) >> 24;
    case "int16": return (Number(typeof v === "bigint" ? Number(v) : v) << 16) >> 16;
    case "int32": case "rune": return Number(typeof v === "bigint" ? Number(v) : v) | 0;
    case "uint8": case "byte": return Number(typeof v === "bigint" ? Number(v) : v) & 0xFF;
    case "uint16": return Number(typeof v === "bigint" ? Number(v) : v) & 0xFFFF;
    case "uint32": return Number(typeof v === "bigint" ? Number(v) : v) >>> 0;
    case "float32": return Math.fround(Number(typeof v === "bigint" ? Number(v) : v));
    case "float64": return Number(typeof v === "bigint" ? Number(v) : v);
    default: return typeof v === "number" && f && (f() === 0n || typeof f() === "bigint") ? BigInt(v) : v;
  }
};`;

// Strict-mode nil maps: the zero value of a map type is one frozen empty
// object, so reads, `len` and `range` behave as on an empty map, and every
// write goes through `__mw`, which panics with Go's message.
export const HELPER_NIL_MAP = `var __nilmap = __nilmap || Object.freeze(Object.defineProperties({}, { __map: { value: true }, __nilm: { value: true } }));
var __mw = __mw || function(m) {
  if (m == null || m === __nilmap) throw new Error("assignment to entry in nil map");
  return m;
};
var __isnm = __isnm || function(m) {
  return m == null || m.__nilm === true || (m.__nm === true && Object.keys(m).length === 0);
};`;

// js-package nil maps: the zero value is a fresh `{}` carrying a hidden tag;
// `m == nil` holds while it stays empty (writes are allowed, as in plain JS).
export const HELPER_NM = `var __nm = __nm || function() { return Object.defineProperty({}, "__nm", { value: true }); };
var __isnm = __isnm || function(m) {
  return m == null || m.__nilm === true || (m.__nm === true && Object.keys(m).length === 0);
};`;

// Struct map keys: a JS object key is a string, so a struct key is coerced
// through `toString` to an injective encoding, and the key value is kept in
// a table so ranging and fmt can recover it.
export const HELPER_STRUCT_KEY = `var __kt = __kt || new Map();
var __sk = __sk || function(o) {
  const s = "\\u0001" + JSON.stringify(o, (k, v) => typeof v === "bigint" ? v.toString() + "n" : v);
  if (!__kt.has(s)) __kt.set(s, typeof o.__clone === "function" ? o.__clone() : o);
  return s;
};
var __ik = __ik || function(k) {
  const t = typeof k;
  if (t === "number" || t === "boolean" || t === "bigint") return "\\u0001" + t + ":" + String(k);
  if (k !== null && t === "object" && typeof k.__gfUnbox === "function" && !k.constructor.name.endsWith("$Ptr")) {
    const v = k.__gfUnbox(), vt = typeof v;
    if (vt === "string" || vt === "number" || vt === "boolean" || vt === "bigint") {
      const s = "\\u0001" + k.constructor.name + ":" + vt + ":" + String(v);
      if (!__kt.has(s)) __kt.set(s, k);
      return s;
    }
  }
  return k;
};
// A key typed by a type parameter whose factory is \`f\`: interface type
// arguments key by dynamic type; \`box\` (an \`any\`-keyed map) boxes a named
// basic value first, other keys are left as they are.
var __ikt = __ikt || function(f, k, box) {
  if (f?.k === "iface") return __ik(k);
  return box ? __ik(f?.b ? f.b(k) : k) : k;
};
var __kd = __kd || function(s, copy) {
  if (typeof s !== "string" || s.charCodeAt(0) !== 1) return s;
  const k = __kt.get(s);
  if (k === undefined) {
    if (s.startsWith("\\u0001number:")) return Number(s.slice(8));
    if (s.startsWith("\\u0001boolean:")) return s.slice(9) === "true";
    if (s.startsWith("\\u0001bigint:")) return BigInt(s.slice(8));
    return s;
  }
  return copy && typeof k.__clone === "function" ? k.__clone() : k;
};
var __kdt = __kdt || function(f, s) {
  if (typeof s !== "string") return s;
  const z = f?.();
  switch (typeof z) {
    case "number": return Number(s);
    case "bigint": return BigInt(s);
    case "boolean": return s === "true";
    case "string": return s;
    default: return __kd(s, true);
  }
};
var __kcmp = __kcmp || function(a, b) {
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    for (const f of Object.keys(a)) {
      const c = __kcmp(a[f], b[f]);
      if (c !== 0) return c;
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};`;

// Interface equality: named non-struct values are boxed in interfaces, so two
// boxes are equal when they share a type and hold the same value (as in Go).
export const HELPER_IFEQ = `var __ifeq = __ifeq || function(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return a == null && b == null;
  if (typeof a === "object" && typeof b === "object" && a.constructor === b.constructor && typeof a.__gfUnbox === "function") {
    return a.__gfUnbox() === b.__gfUnbox();
  }
  // Struct values boxed by __ifv compare field by field.
  if (typeof a === "object" && typeof b === "object" && a.__v === true && b.__v === true && a.constructor === b.constructor) {
    return __equal(a, b);
  }
  return false;
};`;

export const HELPER_EQUAL = `var __equal = __equal || function __equal(a, b) {
  if (a === b && !Array.isArray(a)) return true;
  if (a === null || b === null) return false;
  if (a.__target !== undefined && b.__target !== undefined) {
    return a.__target === b.__target && a.__index === b.__index;
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
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

export const HELPER_PTREQ = `var __ptreq = __ptreq || function __ptreq(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.__target !== undefined && b.__target !== undefined) {
    return a.__target === b.__target && a.__index === b.__index;
  }
  return false;
};`;

// Panic/defer runtime.  `stack` holds the in-flight panic of every frame
// currently running its defers; `armed` is set right before a deferred
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
  const e = top.err;
  // A JS TypeError from using null as a pointer is Go's nil dereference.
  if (e && e.name === "TypeError" && /of null|undefined or null/.test(e.message))
    return "runtime error: invalid memory address or nil pointer dereference";
  return e?.message ?? String(e);
};`;

export const HELPER_SPRINTF =
	HELPER_FMT_UTIL +
	`
var __sprintf = __sprintf || function(f, ...a) {
  let i = 0;
  const ptrMap = new WeakMap();
  const ptrSet = new WeakSet();
  let ptrCounter = 1;
  const getPtr = (o) => {
    let p = ptrMap.get(o);
    if (!p) {
      p = "0x" + (ptrCounter++).toString(16);
      ptrMap.set(o, p);
    }
    return p;
  };
  const markPtr = (o) => {
    if (o !== null && typeof o === "object") ptrSet.add(o);
  };
  // el: o is a value element of a slice, array or map or a struct value field
  // (per the static descriptor), so the __p tag left by an earlier &x does not
  // make it a pointer; only the container's own pointer marking does.
  const isPointer = (o, el) => {
    return o !== null && typeof o === "object" && ((o.__p === true && !el) || ptrSet.has(o));
  };
  const isExported = (k) => /^\\p{Lu}/u.test(k);
  // %#v never calls String (nor, in Go, Error); the Error dispatch stays as it
  // was before Stringer support.
  let sharp = false;
  // The method fmt calls on val: Error before String, and a pointer-receiver
  // method (listed in the class's __pr) only for a pointer, as Go's method sets.
  // __pe maps Error/String to the embedded interface field that provides it.
  const stringMethod = (val, el) => {
    for (const name of sharp ? ["Error"] : ["Error", "String"]) {
      if (typeof val[name] === "function") {
        if (val[name].length !== 0) continue;
        if (!sharp && val.__pr !== undefined && val.__pr.includes(name) && !isPointer(val, el)) continue;
        return name;
      }
      const pe = sharp ? undefined : val.__pe?.[name];
      if (pe !== undefined && typeof val[pe]?.[name] === "function") return name;
    }
    return "";
  };
  // A nil *T boxed in an interface (a named non-struct type) has no value to call
  // a value-receiver method on: fmt prints <nil>, as Go does after recovering.
  const callMethod = (val, name) => {
    if (val.__nilp === true) { try { return val[name](); } catch (e) { return "<nil>"; } }
    if (typeof val[name] !== "function") return val[val.__pe[name]][name]();
    if (typeof val.__gfUnbox !== "function" || val.__gfUnbox() !== null) return val[name]();
    try { return val[name](); } catch (e) { return "<nil>"; }
  };
  // Errors from errors.New/Errorf and the stdlib are plain runtime objects, not
  // instances of a user class; they print their message wherever they are.
  const isRuntimeError = (val) => {
    const proto = Object.getPrototypeOf(val);
    return (proto === null || Object.getPrototypeOf(proto) === null) && typeof val.Error === "function" && val.Error.length === 0;
  };
  // ro: val was reached through an unexported field, where Go cannot call
  // methods on user types. fd: descriptor of val's type when it is not carried
  // by val itself (raw named values and the elements of slices and maps).
  // el: val is a value element or value field, see isPointer.
  // A value can have two descriptors: the Stringer one (see _fmtDesc) and the
  // static type (fmt-types.js, set by __ft).  fd is either one, or { $both, t, s }
  // holding both, so typed formatting and Stringer dispatch compose.
  const both = __fmtu.both;
  const formatV = (val, isPlus, isTopLevel, ro, fd, el) => {
    if (typeof __FT !== "undefined" && val instanceof __FT) {
      return formatV(val.v, isPlus, isTopLevel, ro, both(val.t, val.v?.__fd), el);
    }
    const [td, sdesc] = __fmtu.split(fd);
    if (sdesc?.b && !ro && !(val instanceof sdesc.b)) val = new sdesc.b(val);
    if (sdesc?.m === 1 && (val === null || val === undefined)) return "map[]";
    if (sdesc?.s === 1 && (val === null || val === undefined)) return "[]";
    if (sdesc?.np !== undefined && (val === null || val === undefined)) val = sdesc.np;
    if (val === null || val === undefined) return "<nil>";
    if (val.__nilp === true) {
      const nm = ro ? "" : stringMethod(val, el);
      return nm ? String(callMethod(val, nm)) : "<nil>";
    }
    if (typeof val === "boolean") return String(val);
    if (typeof val === "number" && td) {
      const fb = __fmtu.baseOf(td);
      if (fb?.k === "b" && __fmtu.isFloatN(fb.n)) return __fmtu.fmtFloat(val, "g", {}, 0, false, -1, false, fb.n === "float32");
    }
    if (typeof val === "number" && Math.abs(val) >= 9007199254740992 && Math.abs(val) < 18446744073709551616 && Number.isInteger(val)) return BigInt(val).toString();
    if (typeof val === "number" || typeof val === "bigint") return Object.is(val, -0) ? "-0" : String(val);
    if (typeof val === "string") return val;
    if (typeof val === "object") {
      if ("re" in val && "im" in val) {
        const isNeg = val.im < 0 || Object.is(val.im, -0);
        const sign = isNeg ? "" : "+";
        const imStr = Object.is(val.im, -0) ? "-0" : String(val.im);
        const reStr = Object.is(val.re, -0) ? "-0" : String(val.re);
        return "(" + reStr + sign + imStr + "i)";
      }
      const sm = ro ? (isRuntimeError(val) ? "Error" : "") : stringMethod(val, el);
      if (sm) return String(callMethod(val, sm));
      if (typeof val.__gfUnbox === "function") return formatV(val.__gfUnbox(), isPlus, isTopLevel, ro);
      // fd is either a Stringer descriptor (see _fmtDesc) or, for operands that
      // carry their static type, a type descriptor (fmt-types.js); sd is the
      // latter with pointers and named types resolved.
      const sd = td ? __fmtu.baseOf(td.k === "ptr" ? td.e : td) : null;
      const cd = sdesc ?? val.__fd;
      if (Array.isArray(val) || ArrayBuffer.isView(val)) {
        const isElemPtr = val.__ptr_slice === true;
        const pf = val.__ptr_fields;
        const parts = [];
        for (let j = 0; j < val.length; j++) {
          const item = val[j];
          if (isElemPtr && item !== null && typeof item === "object") {
            markPtr(item);
          } else if (Array.isArray(pf) && item !== null && typeof item === "object") {
            for (const f of pf) {
              if (f.indexOf(".") !== -1) {
                const fparts = f.split(".");
                let cur = item;
                for (let k = 0; k < fparts.length - 1; k++) cur = cur?.[fparts[k]];
                const last = fparts[fparts.length - 1];
                if (cur?.[last] !== null && typeof cur?.[last] === "object") markPtr(cur[last]);
              } else if (item[f] !== null && typeof item[f] === "object") {
                markPtr(item[f]);
              }
            }
          }
          parts.push(formatV(item, isPlus, false, ro, both(sd?.e, cd?.e), cd?.e?.sv === 1));
        }
        return "[" + parts.join(" ") + "]";
      }
      if (val instanceof Map || val.__map === true || sdesc?.m === 1) {
        const isElemPtr = val.__ptr_map === true;
        const parts = [];
        if (val instanceof Map) {
          // Keys of a type with String()/Error() sort by their raw value, as in Go.
          const raw = (k) => (k !== null && typeof k === "object" && typeof k.__gfUnbox === "function" ? k.__gfUnbox() : k);
          const entries = Array.from(val.entries()).sort(([a], [b]) => {
            const k1 = raw(a), k2 = raw(b);
            if (typeof k1 === "number" && typeof k2 === "number") return k1 - k2;
            if (typeof k1 === "bigint" && typeof k2 === "bigint") return k1 < k2 ? -1 : k1 > k2 ? 1 : 0;
            // Struct and array keys compare field by field, as in Go.
            if (k1 !== null && k2 !== null && typeof k1 === "object" && typeof k2 === "object" && !k1.__p && !k2.__p) {
              const cmp = (x, y) => {
                if (x !== null && y !== null && typeof x === "object" && typeof y === "object") {
                  for (const f of Object.keys(x)) {
                    const c = cmp(x[f], y[f]);
                    if (c !== 0) return c;
                  }
                  return 0;
                }
                return x < y ? -1 : x > y ? 1 : 0;
              };
              return cmp(k1, k2);
            }
            const na = Number(k1), nb = Number(k2);
            if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
            return String(k1).localeCompare(String(k2));
          });
          for (const [k, v] of entries) {
            if (isElemPtr && v !== null && typeof v === "object") {
              markPtr(v);
            }
            parts.push(formatV(k, isPlus, false, ro, both(sd?.key, cd?.k), cd?.k?.sv === 1) + ":" + formatV(v, isPlus, false, ro, both(sd?.val, cd?.v), cd?.v?.sv === 1));
          }
        } else {
          const keys = Object.keys(val).sort((a, b) => {
            // Struct keys (encoded, see __sk) sort field by field, as in Go.
            if (a.charCodeAt(0) === 1 && b.charCodeAt(0) === 1 && typeof __kd === "function")
              return __kcmp(__kd(a), __kd(b));
            if (/^-?\\d+$/.test(a) && /^-?\\d+$/.test(b)) {
              try {
                const ba = BigInt(a), bb = BigInt(b);
                return ba < bb ? -1 : ba > bb ? 1 : 0;
              } catch (_) {}
            }
            const na = Number(a), nb = Number(b);
            if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
            if (a[0] === "{" && b[0] === "{") {
              // Struct keys (their %v text) sort field by field, as in Go.
              const ta = a.slice(1, -1).split(/[ {}]+/), tb = b.slice(1, -1).split(/[ {}]+/);
              for (let i = 0; i < ta.length && i < tb.length; i++) {
                if (ta[i] === tb[i]) continue;
                const x = Number(ta[i]), y = Number(tb[i]);
                if (ta[i] !== "" && tb[i] !== "" && !Number.isNaN(x) && !Number.isNaN(y)) return x - y;
                return ta[i].localeCompare(tb[i]);
              }
              return ta.length - tb.length;
            }
            return a.localeCompare(b);
          });
          for (const k of keys) {
            const v = val[k];
            if (isElemPtr && v !== null && typeof v === "object") {
              markPtr(v);
            }
            const bkd = sd ? __fmtu.baseOf(sd.key) : null;
            const is64 = bkd?.k === "b" && (bkd.n === "int64" || bkd.n === "uint64");
            const kv = k.charCodeAt(0) === 1 && typeof __kd === "function"
              ? __kd(k)
              : is64
                ? BigInt(k)
                : ((sd && __fmtu.isNumKey(sd.key)) || cd?.k?.n)
                  ? (/^-?\\d+$/.test(k) && (BigInt(k) > 9007199254740991n || BigInt(k) < -9007199254740991n) ? BigInt(k) : Number(k))
                  : k;
            parts.push(formatV(kv, isPlus, false, ro, both(sd?.key, cd?.k), cd?.k?.sv === 1) + ":" + formatV(v, isPlus, false, ro, both(sd?.val, cd?.v), cd?.v?.sv === 1));
          }
        }
        return "map[" + parts.join(" ") + "]";
      }
      if ("value" in val && (val.__box === true || (!val.__struct && !("__v" in val) && Object.keys(val).length === 1 && (val.constructor === Object || !val.constructor || val.constructor?.name === "Object")))) {
        return getPtr(val);
      }
      const isPtr = isPointer(val, el);
      if (isPtr) {
        if (!isTopLevel) {
          return getPtr(val);
        }
        getPtr(val);
      }
      const prefix = isPtr ? "&{" : "{";
      const keys = __fmtu.keys(val);
      const parts = [];
      const ff = typeof val.__ff === "function" ? val.__ff() : (sdesc?.ff ?? null);
      for (const k of keys) {
        const fk = both(sd?.f?.find((x) => x[0] === k)?.[1], ff?.[k]);
        const fv = formatV(val[k], isPlus, false, ro || !isExported(k), fk, ff?.[k]?.sv === 1);
        parts.push(isPlus ? k + ":" + fv : fv);
      }
      return prefix + parts.join(" ") + "}";
    }
    // A func value prints as an address; the targets share one fixed text.
    if (typeof val === "function") return "0x1";
    return String(val);
  };
` +
	HELPER_FMT_LOOP;

// fmt.Sprint/Print/Append: a space goes between two operands when neither is a
// string; `ln` (Sprintln, Println, Appendln) separates always and ends with a newline.
export const HELPER_SPRINT = `var __sprint = __sprint || function(ln, ...a) {
  const isStr = (x) => typeof x === "string" || (x !== null && typeof x === "object" && typeof x.__gfUnbox === "function" && typeof x.__gfUnbox() === "string");
  let f = "";
  for (let i = 0; i < a.length; i++) {
    if (i > 0 && (ln || (!isStr(a[i - 1]) && !isStr(a[i])))) f += " ";
    f += "%v";
  }
  return __sprintf(ln ? f + "\\n" : f, ...a);
};`;

// A runtime error value (\`fmt.Errorf\`, parse failures, io.EOF).  A wrapped
// cause is exposed through \`Unwrap() error\`; an array of causes (several %w
// verbs) through \`Unwrap() []error\`, tagged \`__multi\` so type assertions tell
// the two apart.
export const HELPER_ERROR = `var __error = __error || function(msg, cause) {
  const e = { Error() { return msg; }, toString() { return msg; }, _msg: msg, _cause: cause ?? null };
  if (Array.isArray(cause)) {
    e.Unwrap = function() { return cause; };
    e.Unwrap.__multi = true;
  } else if (cause !== undefined && cause !== null) {
    e.Unwrap = function() { return cause; };
  }
  return e;
};`;

export const HELPER_IO_EOF = `var __io_eof = __io_eof || __error("EOF");`;

export const HELPER_OS = `var __os_buf = "";
var __os_write = __os_write || function(s, isErr) {
  if (typeof process !== "undefined" && process?.stdout?.write) {
    process.stdout.write(s);
    return [s.length, null];
  }
  __os_buf += s;
  const nl = __os_buf.lastIndexOf(String.fromCharCode(10));
  if (nl >= 0) {
    const fn = (isErr && typeof console.error === "function") ? console.error : console.log;
    fn(__os_buf.slice(0, nl));
    __os_buf = __os_buf.slice(nl + 1);
  }
  return [s.length, null];
};
var __os_file = __os_file || class {
  constructor(fd) { this.fd = fd; }
  WriteString(s) { return __os_write(s, this.fd === 2); }
  Write(b) {
    const s = typeof b === "string" ? b : new TextDecoder().decode(b);
    __os_write(s, this.fd === 2);
    const n = typeof b === "string" ? s.length : (b?.byteLength ?? b?.length ?? s.length);
    return [n, null];
  }
  Read(b) { return [0, typeof __io_eof !== "undefined" ? __io_eof : __error("EOF")]; }
  Close() { return null; }
};
var __os_stdout = __os_stdout || new __os_file(1);
var __os_stderr = __os_stderr || new __os_file(2);
var __os_stdin = __os_stdin || new __os_file(0);
`;

export const HELPER_ERROR_AS = `var __errorAs = __errorAs || function(err, target, matcher, extract) {
  if (err === null || err === undefined || target === null || typeof target !== "object") return false;
  let cur = err;
  while (cur !== null && cur !== undefined) {
    const unboxed = cur?.value ?? cur;
    if (typeof cur.As === "function" && cur.As(target)) return true;
    if (matcher ? matcher(unboxed) : (unboxed !== err && typeof unboxed === "object" && !("_msg" in unboxed && "_cause" in unboxed))) {
      if ("value" in target) {
        const found = extract ? extract(unboxed) : unboxed;
        target.value = found != null && found.__nilp === true ? null : found;
      } else {
        Object.assign(target, unboxed);
      }
      return true;
    }
    if (typeof cur.Unwrap !== "function") return false;
    const unwrapped = cur.Unwrap();
    if (Array.isArray(unwrapped)) {
      for (const sub of unwrapped) {
        if (__errorAs(sub, target, matcher, extract)) return true;
      }
      return false;
    }
    cur = unwrapped;
  }
  return false;
};`;

export const HELPER_TIMER = `var __timeAfterFunc = __timeAfterFunc || function(d, f) {
  var timer = {
    _id: null,
    _active: true,
    _f: f,
    Stop: function() {
      var act = this._active;
      if (act) {
        clearTimeout(this._id);
        this._active = false;
      }
      return act;
    },
    Reset: function(newD) {
      var act = this._active;
      if (act) clearTimeout(this._id);
      var self = this;
      this._active = true;
      this._id = setTimeout(function() {
        self._active = false;
        self._f();
      }, Math.round(Number(newD) / 1000000));
      return act;
    }
  };
  timer._id = setTimeout(function() {
    timer._active = false;
    timer._f();
  }, Math.round(Number(d) / 1000000));
  return timer;
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
    this._cleanups = [];
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
  SkipNow() {
    this.skipped = true;
    throw new __GoFront_SkipNow();
  }
  Helper() {}
  Parallel() {}
  Attr(k, v) {}
  Output() {
    return {
      Write(p) {
        process.stdout.write(typeof p === "string" ? p : Buffer.from(p));
        return [p.length, null];
      }
    };
  }
  Deadline() {
    return [null, false];
  }
  Context() {
    if (!this._ctx) {
      let canceled = false;
      this._ctx = {
        Deadline() { return [null, false]; },
        Done() { return null; },
        Err() { return canceled ? new Error("context canceled") : null; },
        Value(k) { return null; },
      };
      this.Cleanup(() => { canceled = true; });
    }
    return this._ctx;
  }
  Setenv(key, val) {
    const prev = process.env[key];
    const hasPrev = Object.prototype.hasOwnProperty.call(process.env, key);
    process.env[key] = String(val);
    this.Cleanup(() => {
      if (hasPrev) process.env[key] = prev;
      else delete process.env[key];
    });
  }
  Cleanup(fn) {
    this._cleanups.push(fn);
  }
  _runCleanups() {
    while (this._cleanups.length > 0) {
      const fn = this._cleanups.pop();
      try {
        fn();
      } catch (e) {
        this.Fail();
        this.Log("panic in cleanup: " + (e?.message ?? String(e)));
      }
    }
  }
  Run(name, fn) {
    const subName = this._name ? \`\${this._name}/\${name}\` : name;
    const subT = new this.constructor(subName, this);
    if (typeof globalThis.__onSubtestStart === "function") globalThis.__onSubtestStart(subName);
    let isAsync = false;
    try {
      const res = fn(subT);
      if (res && typeof res.then === "function") {
        isAsync = true;
        return res.then(() => {
          subT._runCleanups();
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
          subT._runCleanups();
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
    } finally {
      if (!isAsync) {
        subT._runCleanups();
      }
    }
    if (typeof globalThis.__onSubtestEnd === "function") globalThis.__onSubtestEnd(subT);
    return !subT.failed;
  }
};
var __testing_T = __GoFront_T;
var __GoFront_B = __GoFront_B || class extends __GoFront_T {
  constructor(name = "", parent = null) {
    super(name, parent);
    this.N = 1;
    this._bytes = 0n;
    this._reportAllocs = false;
    this._timerStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    this._elapsedMs = 0;
    this._timerRunning = true;
    this._loopStarted = false;
  }
  ResetTimer() {
    this._timerStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    this._elapsedMs = 0;
  }
  StartTimer() {
    if (!this._timerRunning) {
      this._timerStart = typeof performance !== "undefined" ? performance.now() : Date.now();
      this._timerRunning = true;
    }
  }
  StopTimer() {
    if (this._timerRunning) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      this._elapsedMs += now - this._timerStart;
      this._timerRunning = false;
    }
  }
  ReportAllocs() {
    this._reportAllocs = true;
  }
  ReportMetric(n, unit) {}
  SetBytes(n) {
    this._bytes = BigInt(n);
  }
  Elapsed() {
    const ms = this._timerRunning
      ? this._elapsedMs + ((typeof performance !== "undefined" ? performance.now() : Date.now()) - this._timerStart)
      : this._elapsedMs;
    return BigInt(Math.round(ms * 1e6));
  }
  Loop() {
    if (!this._loopStarted) {
      this._loopStarted = true;
      this.ResetTimer();
      this._loopTargetNs = this._benchDurationNs || 1e9;
      this._loopIters = 0;
      this._nextCheck = 1;
    }
    if (this.failed || this.skipped) return false;
    this._loopIters++;
    this.N = this._loopIters;
    if (this._loopIters >= this._nextCheck) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsedNs = (now - this._timerStart) * 1e6;
      if (elapsedNs >= this._loopTargetNs || this._loopIters >= 1e9) {
        this.StopTimer();
        return false;
      }
      const nsPerOp = Math.max(1, elapsedNs / this._loopIters);
      const remainingNs = this._loopTargetNs - elapsedNs;
      const addIters = Math.max(1, Math.min(100000, Math.floor(remainingNs / (nsPerOp * 2))));
      this._nextCheck = this._loopIters + addIters;
    }
    return true;
  }
};
var __testing_B = __GoFront_B;
var __GoFront_M = __GoFront_M || class {
  constructor(runFn) {
    this._run = runFn;
    this._ran = false;
    this._exitCode = 0;
  }
  Run() {
    this._ran = true;
    const res = this._run();
    if (res && typeof res.then === "function") {
      this._promise = res.then(code => { this._exitCode = code; return code; });
      return 0;
    }
    this._exitCode = res ?? 0;
    return this._exitCode;
  }
};
var __testing_M = __GoFront_M;
var __GoFront_BenchmarkResult = __GoFront_BenchmarkResult || class {
  constructor(b = null) {
    this.N = b?.N ?? 0;
    this.T = b ? b.Elapsed() : 0n;
    this.Bytes = b?._bytes ?? 0n;
    this.MemAllocs = 0n;
    this.MemBytes = 0n;
    this.Extra = new Map();
  }
  AllocedBytesPerOp() { return this.N > 0 ? this.MemBytes / BigInt(this.N) : 0n; }
  AllocsPerOp() { return this.N > 0 ? this.MemAllocs / BigInt(this.N) : 0n; }
  MemString() { return \`\${this.AllocedBytesPerOp()} B/op\\t\${this.AllocsPerOp()} allocs/op\`; }
  NsPerOp() { return this.N > 0 ? this.T / BigInt(this.N) : 0n; }
  String() {
    const ns = this.NsPerOp();
    let s = \`\${this.N}\\t\${ns} ns/op\`;
    if (this.Bytes > 0n && this.T > 0n) {
      const mbPerSec = (Number(this.Bytes * BigInt(this.N)) / (Number(this.T) / 1e9) / (1024 * 1024)).toFixed(2);
      s += \`\\t\${mbPerSec} MB/s\`;
    }
    return s;
  }
};
var __testing_BenchmarkResult = __GoFront_BenchmarkResult;
var __testing_Benchmark = __testing_Benchmark || function(fn) {
  let b = new __GoFront_B("Benchmark");
  b._benchDurationNs = 1e9;
  b.N = 1;
  b.ResetTimer();
  fn(b);
  if (!b._loopStarted) {
    b.StopTimer();
    b._runCleanups();
    let n = 1;
    while (!b.failed && !b.skipped) {
      const elapsedNs = Number(b.Elapsed());
      if (elapsedNs >= 1e9 || n >= 1e9) break;
      let nextN;
      if (elapsedNs === 0) nextN = n * 100;
      else nextN = Math.max(n + 1, Math.min(1e9, Math.floor(n * (1e9 / elapsedNs) * 1.2)));
      if (nextN <= n) break;
      n = nextN;
      b = new __GoFront_B("Benchmark");
      b._benchDurationNs = 1e9;
      b.N = n;
      b.ResetTimer();
      fn(b);
      b.StopTimer();
      b._runCleanups();
    }
  } else {
    b._runCleanups();
  }
  return new __GoFront_BenchmarkResult(b);
};`;

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

export const HELPER_CRYPTO_RAND = `var __crypto_rand_read = __crypto_rand_read || function(b) {
  if (!b || b.length === 0) return [0, null];
  const u8 = ArrayBuffer.isView(b) ? b : new Uint8Array(b.length);
  const c = typeof crypto !== "undefined" ? crypto : (typeof globalThis !== "undefined" ? globalThis.crypto : null);
  const CHUNK = 65536;
  if (c && typeof c.getRandomValues === "function") {
    for (let offset = 0; offset < u8.length; offset += CHUNK) {
      const slice = u8.subarray(offset, Math.min(offset + CHUNK, u8.length));
      c.getRandomValues(slice);
    }
  } else {
    for (let i = 0; i < u8.length; i++) u8[i] = Math.floor(Math.random() * 256);
  }
  if (!ArrayBuffer.isView(b)) {
    for (let i = 0; i < u8.length; i++) b[i] = u8[i];
  }
  return [b.length, null];
};
var __crypto_rand_reader = __crypto_rand_reader || {
  Read: function(b) { return __crypto_rand_read(b); }
};`;

export const HELPER_BINARY = `var __binary_size = __binary_size || function(v) {
  if (typeof v === "number" || typeof v === "bigint") return 8;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return v.length;
  if (v && typeof v === "object") {
    let s = 0;
    for (const k of Object.keys(v)) { if (!k.startsWith("_") && typeof v[k] !== "function") s += __binary_size(v[k]); }
    return s;
  }
  return -1;
};
var __binary_read = __binary_read || function(r, order, data, sz, typeTag) {
  const targetR = r?.value ?? r;
  const readChunk = function(buf) {
    if (typeof targetR?.Read === "function") return targetR.Read(buf);
    if (Array.isArray(targetR?._buf)) {
      const n = Math.min(buf.length, targetR._buf.length);
      for (let i = 0; i < n; i++) buf[i] = targetR._buf.shift();
      return [n, n < buf.length ? __io_eof : null];
    }
    return [0, __error("binary.Read: unsupported reader")];
  };
  const isBox = data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "value") && (data.__box === true || (Object.keys(data).length <= 2 && (data.constructor === Object || !data.constructor || data.constructor?.name === "Object")));
  const target = isBox ? data : null;
  if (!target && data && typeof data === "object" && !Array.isArray(data) && !ArrayBuffer.isView(data)) {
    for (const k of Object.keys(data)) {
      if (k.startsWith("_") || typeof data[k] === "function") continue;
      const fBox = { value: data[k], __box: true };
      const err = __binary_read(r, order, fBox);
      if (err) return err;
      data[k] = fBox.value;
    }
    return null;
  }
  const s = sz || (target ? (typeof target.value === "bigint" ? 8 : (typeof target.value === "number" ? 4 : 4)) : __binary_size(data?.value ?? data));
  if (s <= 0) return __error("binary.Read: invalid type");
  const buf = new Uint8Array(s);
  const [n, err] = readChunk(buf);
  if (err) return err;
  if (n < s) return __io_eof;
  if (target) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const isLe = order.String() === "LittleEndian";
    if (typeTag === "float32") target.value = view.getFloat32(0, isLe);
    else if (typeTag === "float64") target.value = view.getFloat64(0, isLe);
    else if (typeTag === "int8") target.value = view.getInt8(0);
    else if (typeTag === "uint8" || typeTag === "byte" || typeTag === "bool") target.value = view.getUint8(0);
    else if (typeTag === "int16") target.value = view.getInt16(0, isLe);
    else if (typeTag === "uint16") target.value = view.getUint16(0, isLe);
    else if (typeTag === "int32" || typeTag === "rune") target.value = view.getInt32(0, isLe);
    else if (typeTag === "uint32") target.value = view.getUint32(0, isLe);
    else if (typeTag === "int64") target.value = Number(view.getBigInt64(0, isLe));
    else if (typeTag === "uint64") target.value = Number(view.getBigUint64(0, isLe));
    else if (s === 1) target.value = buf[0];
    else if (s === 2) target.value = view.getUint16(0, isLe);
    else if (s === 4) target.value = view.getUint32(0, isLe);
    else if (s === 8) target.value = view.getBigUint64(0, isLe);
    return null;
  }
  if (Array.isArray(data) || ArrayBuffer.isView(data)) {
    for (let i = 0; i < s; i++) data[i] = buf[i];
    return null;
  }
  return null;
};
var __binary_write = __binary_write || function(w, order, data, sz, typeTag) {
  const targetW = w?.value ?? w;
  const writeChunk = function(chunk) {
    if (typeof targetW?.Write === "function") return targetW.Write(chunk);
    if (Array.isArray(targetW?._buf)) {
      for (let i = 0; i < chunk.length; i++) targetW._buf.push(chunk[i]);
      return [chunk.length, null];
    }
    if (typeof targetW?._buf === "string") {
      targetW._buf += new TextDecoder().decode(chunk);
      return [chunk.length, null];
    }
    return [0, __error("binary.Write: unsupported writer")];
  };
  const isBox = data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "value") && (data.__box === true || (Object.keys(data).length <= 2 && (data.constructor === Object || !data.constructor || data.constructor?.name === "Object")));
  const v = isBox ? data.value : data;
  if (!isBox && typeof data === "object" && data !== null && !Array.isArray(data) && !ArrayBuffer.isView(data)) {
    for (const k of Object.keys(data)) {
      if (k.startsWith("_") || typeof data[k] === "function") continue;
      const err = __binary_write(w, order, data[k]);
      if (err) return err;
    }
    return null;
  }
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") {
    const s = sz || (typeof v === "bigint" ? 8 : (typeTag === "float64" ? 8 : 4));
    const buf = new Uint8Array(s);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const isLe = order.String() === "LittleEndian";
    if (typeTag === "float32") view.setFloat32(0, Number(v), isLe);
    else if (typeTag === "float64") view.setFloat64(0, Number(v), isLe);
    else if (s === 1) buf[0] = Number(v) & 0xff;
    else if (s === 2) view.setUint16(0, Number(v), isLe);
    else if (s === 4) view.setUint32(0, Number(v), isLe);
    else view.setBigUint64(0, BigInt.asUintN(64, BigInt(v)), isLe);
    const [, err] = writeChunk(buf);
    return err;
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const [, err] = writeChunk(v);
    return err;
  }
  return __error("binary.Write: unsupported type");
};`;

export const HELPER_JSON = `var __json_esc = __json_esc || function(s) {
  if (typeof s !== "string") s = String(s);
  var out = JSON.stringify(s);
  var escHtml = typeof OptEscapeHTML$$internal$jsonrt === "undefined" || OptEscapeHTML$$internal$jsonrt;
  if (escHtml) {
    out = out
      .replace(/[<>&]/g, function(c) {
        return c === "<" ? "\\\\u003c" : (c === ">" ? "\\\\u003e" : "\\\\u0026");
      })
      .replace(/\\u2028/g, "\\\\u2028")
      .replace(/\\u2029/g, "\\\\u2029");
  }
  return out;
};
var __json_check_unknown = __json_check_unknown || function(parsed, knownKeys) {
  var disallow = typeof OptDisallowUnknownFields$$internal$jsonrt !== "undefined" && OptDisallowUnknownFields$$internal$jsonrt;
  if (!disallow || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  var lowerSet = new Set(knownKeys.map(function(k) { return k.toLowerCase(); }));
  for (var k in parsed) {
    if (Object.prototype.hasOwnProperty.call(parsed, k) && !k.startsWith("__")) {
      if (!lowerSet.has(k.toLowerCase())) {
        var msg = "json: unknown field " + JSON.stringify(k);
        return typeof __error === "function" ? __error(msg) : new Error(msg);
      }
    }
  }
  return null;
};
var __json_err = __json_err || function(msg, valKind, targetType) {
  var fullMsg = "json: " + msg;
  var valDesc = valKind || "";
  var typeDesc = targetType || "";
  if (!valDesc && msg.startsWith("cannot unmarshal ")) {
    var parts = msg.slice(17).split(" into ");
    valDesc = parts[0];
    var rest = parts[1] || "";
    var idx = rest.indexOf(" of type ");
    if (idx >= 0) typeDesc = rest.slice(idx + 9);
    else if (rest.startsWith("Go value of type ")) typeDesc = rest.slice(17);
  }
  var structName = __json_structs.length > 0 ? __json_structs[__json_structs.length - 1] : "";
  var fieldPath = __json_path.join(".");
  var offset = typeof __json_current_offset === "number" ? __json_current_offset : 0;
  var e;
  if (typeof UnmarshalTypeError$$internal$jsonrt === "function") {
    e = new UnmarshalTypeError$$internal$jsonrt(valDesc, typeDesc, BigInt(offset), structName, fieldPath);
    if (e.__p !== true && Object.isExtensible(e)) Object.defineProperty(e, "__p", { value: true, configurable: true, writable: true });
  } else {
    e = typeof __error === "function" ? __error(fullMsg) : new Error(fullMsg);
    e.Value = valDesc;
    e.Type = typeDesc;
    e.Offset = BigInt(offset);
    e.Struct = structName;
    e.Field = fieldPath;
    if (e.__p !== true && Object.isExtensible(e)) Object.defineProperty(e, "__p", { value: true, configurable: true, writable: true });
  }
  e.Error = function() { return fullMsg; };
  e._msg = fullMsg;
  e.__struct = "UnmarshalTypeError$$internal$jsonrt";
  return e;
};
// Decode error context, as in Go: innermost struct being decoded plus the path
// of JSON field names from the root. Reset by every __json_unmarshal call.
var __json_structs = __json_structs || [];
var __json_path = __json_path || [];
var __json_current_offset = __json_current_offset || 0;
var __json_ctx = __json_ctx || function(typeName) {
  if (__json_path.length > 0 && __json_structs.length > 0) {
    return "Go struct field " + __json_structs[__json_structs.length - 1] + "." + __json_path.join(".") + " of type " + typeName;
  }
  return "Go value of type " + typeName;
};
// The JSON source text of a number, for "cannot unmarshal number <literal>" messages.
var __json_lit = __json_lit || function(v, raw) {
  if (raw !== undefined && raw !== null) return String(raw).trim();
  return typeof v === "string" ? v.replace(/__bigint$/, "") : String(v);
};
var __json_is_valid_number = __json_is_valid_number || function(s) {
  return typeof s === "string" && /^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(s);
};
var __json_enc_number = __json_enc_number || function(v) {
  var s = typeof v === "string" ? v : (v != null ? String(v) : "");
  if (s === "") return "0";
  if (!__json_is_valid_number(s)) {
    throw new Error("json: invalid number literal " + JSON.stringify(s));
  }
  return s;
};
var __json_number_decode = __json_number_decode || function(v, ctxType, raw) {
  if (typeof v === "number" || (typeof v === "string" && v.endsWith("__bigint"))) {
    return __json_lit(v, raw);
  }
  if (typeof v === "string") {
    if (!__json_is_valid_number(v)) {
      return __json_err("invalid number literal, trying to unmarshal " + JSON.stringify(v) + " into Number");
    }
    return v;
  }
  return __json_err("cannot unmarshal " + __json_type(v) + " into " + __json_ctx(ctxType));
};
var __json_dec_number = __json_dec_number || function(parsed, target, box, rawData, rawStr) {
  if (parsed === null) return null;
  var nv = __json_number_decode(parsed, "json.Number", rawStr);
  if (nv && nv._msg) return nv;
  if (box) box.value = nv;
  return null;
};
var __json_float_decode = __json_float_decode || function(v, bits, ctxType, raw) {
  var n = __json_number_value(v);
  if (typeof n !== "number") return __json_err("cannot unmarshal " + __json_type(v) + " into " + __json_ctx(ctxType));
  var f = bits === 32 ? Math.fround(n) : n;
  if (!isFinite(f)) return __json_err("cannot unmarshal number " + __json_lit(v, raw) + " into " + __json_ctx(ctxType));
  return f;
};
// []byte accepts a base64 string or (like Go) an array of uint8 values.
var __json_bytes_decode = __json_bytes_decode || function(v) {
  if (Array.isArray(v)) {
    var u8 = new Uint8Array(v.length);
    for (var i = 0; i < v.length; i++) {
      var b = __json_int_decode(v[i], "uint8", "uint8", __json_raw_child(v, i));
      if (b && b._msg) return b;
      u8[i] = b;
    }
    return u8;
  }
  if (typeof v !== "string") return __json_err("cannot unmarshal " + __json_type(v) + " into " + __json_ctx("[]uint8"));
  return __json_b64_dec(v);
};
var __json_esc_noh = __json_esc_noh || function(s) {
  return JSON.stringify(String(s)).replace(/\\u2028/g, "\\\\u2028").replace(/\\u2029/g, "\\\\u2029");
};
var __json_syntax_msg = __json_syntax_msg || function(s) {
  if (typeof CheckValid$$internal$jsonrt === "function") {
    var se = CheckValid$$internal$jsonrt(new TextEncoder().encode(String(s)));
    if (se && typeof se.Error === "function") return se.Error();
  }
  var t = String(s).trim();
  if (t === "") return "unexpected end of JSON input";
  var m;
  try { JSON.parse(t); } catch (e) { m = String(e && e.message); }
  if (m && /end of JSON input|Unterminated/.test(m)) return "unexpected end of JSON input";
  var pos = m && /after JSON at position (\\d+)/.exec(m);
  if (pos) return "invalid character '" + t[Number(pos[1])] + "' after top-level value";
  if ("{[\\"-0123456789tfn".indexOf(t[0]) < 0) return "invalid character '" + t[0] + "' looking for beginning of value";
  return "invalid character in JSON value";
};
// Validates and compacts JSON text, escaping <, >, & and U+2028/U+2029 inside strings.
var __json_compact = __json_compact || function(s) {
  try { JSON.parse(s); } catch (e) { return null; }
  var out = "", inStr = false, esc = false;
  var escHtml = typeof OptEscapeHTML$$internal$jsonrt === "undefined" || OptEscapeHTML$$internal$jsonrt;
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (inStr) {
      if (esc) { esc = false; out += c; continue; }
      if (c === "\\\\") { esc = true; out += c; continue; }
      if (c === '"') inStr = false;
      if (!escHtml) out += c;
      else if (c === "<") out += "\\\\u003c";
      else if (c === ">") out += "\\\\u003e";
      else if (c === "&") out += "\\\\u0026";
      else if (c === "\\u2028") out += "\\\\u2028";
      else if (c === "\\u2029") out += "\\\\u2029";
      else out += c;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === " " || c === "\\t" || c === "\\n" || c === "\\r") continue;
    out += c;
  }
  return out;
};
var __json_unsupported_value = __json_unsupported_value || function(str) {
  str = str === "Infinity" ? "+Inf" : (str === "-Infinity" ? "-Inf" : str);
  if (typeof UnsupportedValueError$$internal$jsonrt === "function") {
    var e = new UnsupportedValueError$$internal$jsonrt(null, str);
    e.Str = str;
    if (e.__p !== true && Object.isExtensible(e)) Object.defineProperty(e, "__p", { value: true, configurable: true, writable: true });
    e.__struct = "UnsupportedValueError$$internal$jsonrt";
    return e;
  }
  var e = new Error("json: unsupported value: " + str);
  e.Str = str;
  e.__struct = "UnsupportedValueError$$internal$jsonrt";
  return e;
};
var __json_marshaler_out = __json_marshaler_out || function(res, typeName) {
  var err = res && res[1];
  if (err) {
    var merr;
    if (typeof MarshalerError$$internal$jsonrt === "function") {
      merr = new MarshalerError$$internal$jsonrt(typeName, err, "MarshalJSON");
      if (merr.__p !== true && Object.isExtensible(merr)) Object.defineProperty(merr, "__p", { value: true, configurable: true, writable: true });
      merr.__struct = "MarshalerError$$internal$jsonrt";
    } else {
      merr = new Error("json: error calling MarshalJSON for type " + typeName + ": " + (typeof err.Error === "function" ? err.Error() : String(err)));
    }
    throw merr;
  }
  var b = res ? res[0] : null;
  var s = b === null || b === undefined ? "" : (typeof b === "string" ? b : new TextDecoder().decode(b));
  var c = __json_compact(s);
  if (c === null) throw new Error("json: error calling MarshalJSON for type " + typeName + ": " + __json_syntax_msg(s));
  return c;
};
// Keeps user errors returned by UnmarshalJSON intact while fitting the decoders'
// "_msg"-tagged error protocol; __json_unmarshal unwraps __userErr.
var __json_user_err = __json_user_err || function(e) {
  if (e && e._msg !== undefined) return e;
  return { _msg: e && typeof e.Error === "function" ? e.Error() : String(e), __userErr: e };
};
// Decodes the JSON string payload of a ,string field. Returns { v } or an error.
var __json_unquote = __json_unquote || function(val, kind, typeStr) {
  if (val === null) return { v: null, lit: "null" };
  if (typeof val !== "string" || val.endsWith("__bigint")) {
    return __json_err("invalid use of ,string struct tag, trying to unmarshal unquoted value into " + typeStr);
  }
  var invalid = function() {
    return __json_err("invalid use of ,string struct tag, trying to unmarshal " + JSON.stringify(val) + " into " + typeStr);
  };
  var inner;
  try { inner = JSON.parse(__json_preserve_int64(val)); } catch (e) {
    if (kind !== "string" && kind !== "bool" && /^-?[0-9]/.test(val)) return __json_err("cannot unmarshal number " + val + " into " + __json_ctx(typeStr));
    return invalid();
  }
  if (inner === null) return { v: null, lit: val };
  if (kind === "string") return typeof inner === "string" ? { v: inner, lit: val } : invalid();
  if (kind === "bool") return typeof inner === "number" ? invalid() : { v: inner, lit: val };
  return typeof inner === "boolean" ? invalid() : { v: inner, lit: val };
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
var __json_raw_index = __json_raw_index || new WeakMap();
var __json_parse_raw_node = __json_parse_raw_node || function(s) {
  var i = 0;
  function ws() { while (i < s.length && /[\\t\\n\\r ]/.test(s[i])) i++; }
  function stringEnd() {
    i++;
    while (i < s.length) {
      if (s[i] === "\\\\") i += 2;
      else if (s[i++] === '"') break;
    }
  }
  function value() {
    ws();
    var start = i;
    var node = { children: null };
    if (s[i] === "{") {
      i++;
      node.children = new Map();
      ws();
      while (s[i] !== "}") {
        var keyStart = i;
        stringEnd();
        var key = JSON.parse(s.slice(keyStart, i));
        ws();
        i++;
        var child = value();
        node.children.set(key, child);
        ws();
        if (s[i] === ",") { i++; ws(); }
        else break;
      }
      i++;
    } else if (s[i] === "[") {
      i++;
      node.children = new Map();
      ws();
      var index = 0;
      while (s[i] !== "]") {
        node.children.set(String(index++), value());
        ws();
        if (s[i] === ",") { i++; ws(); }
        else break;
      }
      i++;
    } else if (s[i] === '"') {
      stringEnd();
    } else {
      while (i < s.length && !/[\\t\\n\\r ,}\\]]/.test(s[i])) i++;
    }
    node.raw = s.slice(start, i);
    node.start = start;
    node.end = i;
    return node;
  }
  return value();
};
var __json_bind_raw = __json_bind_raw || function(value, node) {
  if (value === null || typeof value !== "object" || !node?.children) return;
  __json_raw_index.set(value, node.children);
  for (const [key, child] of node.children) __json_bind_raw(value[key], child);
};
var __json_raw_child = __json_raw_child || function(parent, key) {
  return __json_raw_index.get(parent)?.get(String(key))?.raw;
};
var __json_raw_end = __json_raw_end || function(parent, key) {
  return __json_raw_index.get(parent)?.get(String(key))?.end;
};
var __json_raw_bytes = __json_raw_bytes || function(raw) {
  return new TextEncoder().encode(raw ?? "null");
};
var __json_match_field = __json_match_field || function(obj, tagName, fieldName) {
  if (Object.prototype.hasOwnProperty.call(obj, tagName)) return tagName;
  if (Object.prototype.hasOwnProperty.call(obj, fieldName)) return fieldName;
  var tagFold = tagName.toLowerCase();
  var fieldFold = fieldName.toLowerCase();
  for (const key of Object.keys(obj)) {
    var keyFold = key.toLowerCase();
    if (keyFold === tagFold || keyFold === fieldFold) return key;
  }
  return null;
};
var __json_float64 = __json_float64 || function(v) {
  if (!isFinite(v)) throw __json_unsupported_value(String(v));
  return Object.is(v, -0) ? "-0" : String(v);
};
var __json_float32 = __json_float32 || function(v) {
  var f = Math.fround(v);
  if (!isFinite(f)) throw __json_unsupported_value(String(f));
  if (Object.is(f, -0)) return "-0";
  var candidate;
  for (var precision = 1; precision <= 9; precision++) {
    candidate = f.toPrecision(precision);
    if (Math.fround(Number(candidate)) === f) break;
  }
  var n = Number(candidate);
  var expText = n.toExponential();
  var match = /e([+-]?)(\\d+)$/.exec(expText);
  var exponent = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  if (exponent < -6 || exponent >= 21) {
    var mantissa = expText.slice(0, expText.indexOf("e"));
    var sign = exponent >= 0 ? "+" : "-";
    return mantissa + "e" + sign + String(Math.abs(exponent));
  }
  return n.toString();
};
var __json_number_value = __json_number_value || function(v) {
  return typeof v === "string" && v.endsWith("__bigint") ? Number(v.slice(0, -8)) : v;
};
var __json_int_decode = __json_int_decode || function(v, typeName, ctxType, raw) {
  var type = typeof v === "string" && v.endsWith("__bigint") ? "number" : typeof v === "bigint" ? "number" : __json_type(v);
  var fail = function() {
    return __json_err("cannot unmarshal " + (type === "number" ? "number " + __json_lit(v, raw) : type) + " into " + __json_ctx(ctxType));
  };
  if (type !== "number") return fail();
  // Go parses integers with strconv.ParseInt: "1.0" and "1e2" are not integers.
  if (raw !== undefined && raw !== null && !/^-?(0|[1-9][0-9]*)$/.test(String(raw).trim())) return fail();
  var integer;
  var signed = typeName === "int" || typeName.startsWith("int");
  if (typeName === "int64" || typeName === "uint64") {
    if (typeof v === "bigint") {
      integer = v;
    } else if (typeof v === "string" && v.endsWith("__bigint")) {
      try { integer = BigInt(v.slice(0, -8)); } catch (_) {}
    } else if (typeof v === "number" && Number.isSafeInteger(v)) {
      integer = BigInt(v);
    }
    if (integer !== undefined) {
      var min64 = typeName === "int64" ? -(1n << 63n) : 0n;
      var max64 = typeName === "int64" ? (1n << 63n) - 1n : (1n << 64n) - 1n;
      if (integer >= min64 && integer <= max64) return integer;
    }
    return fail();
  }
  if (typeof v === "bigint") {
    integer = v;
  } else if (typeof v === "string" && v.endsWith("__bigint")) {
    try { integer = BigInt(v.slice(0, -8)); } catch (_) {}
  } else if (typeof v === "number" && Number.isSafeInteger(v)) {
    integer = BigInt(v);
  }
  if (integer !== undefined) {
    if (typeName === "int") {
      if (integer >= -9007199254740991n && integer <= 9007199254740991n) return Number(integer);
      return fail();
    }
    var bits = typeName === "uint" ? 53 : Number(typeName.replace(/^(u?int|byte|rune)/, ""));
    if (!bits) bits = typeName === "byte" ? 8 : typeName === "rune" ? 32 : 53;
    var min = signed ? -(1n << BigInt(bits - 1)) : 0n;
    var max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
    if (integer >= min && integer <= max) return Number(integer);
  }
  return fail();
};
var __json_b64 = __json_b64 || function(u8) {
  if (u8 === null || u8 === undefined) return "null";
  return '"' + EncodeBytes$$internal$jsonrt(u8) + '"';
};
var __json_b64_dec = __json_b64_dec || function(str) {
  var res = DecodeBytes$$internal$jsonrt(str);
  if (res[1]) return { _msg: res[1].Error(), __userErr: res[1] };
  return res[0];
};
var __json_is_zero = __json_is_zero || function(val, isStruct, isMap) {
  if (isStruct) return false;
  if (isMap) return __json_nilmap(val) || (val instanceof Map ? val.size === 0 : Object.keys(val).length === 0);
  if (val === null || val === undefined || val === false || val === 0 || val === "") return true;
  if (typeof val === "bigint") return val === 0n;
  if (Array.isArray(val) || (ArrayBuffer.isView(val) && !val.__raw)) return val.length === 0;
  if (val instanceof Map) return val.size === 0;
  if (val && val.__map) return Object.keys(val).filter(function(k) { return !k.startsWith("__"); }).length === 0;
  return false;
};
var __json_preserve_int64 = __json_preserve_int64 || function(str) {
  return str.replace(/"(?:\\\\.|[^"\\\\])*"|(?<=[,:\\[{\\s]|^)(-?\\d{16,})(?=[,\\]}\\s]|$)/g, function(m, num) {
    if (num) {
      try {
        var b = BigInt(num);
        if (b > 9007199254740991n || b < -9007199254740991n) return '"' + num + '__bigint"';
      } catch (e) {}
    }
    return m;
  });
};
// Go maps: a nil map is the __nm()/__nilmap marker, an empty one a plain object.
var __json_nilmap = __json_nilmap || function(m) {
  return m === null || m === undefined || m.__nilm === true || m.__nm === true;
};
// Decoded maps carry a hidden marker so fmt and json treat them as maps.
var __json_newmap = __json_newmap || function() {
  return Object.defineProperty(Object.create(null), "__map", { value: true, configurable: true });
};
// json.RawMessage is compacted (and validated) like any Marshaler output; nil is null.
var __json_enc_raw = __json_enc_raw || function(v) {
  if (v === null || v === undefined) return "null";
  return __json_marshaler_out([v, null], "json.RawMessage");
};
var __json_enc_any = __json_enc_any || function(v) {
  if (v === null || v === undefined || v.__nilp === true) return "null";
  var t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") {
    if (!isFinite(v)) throw __json_unsupported_value(String(v));
    return Object.is(v, -0) ? "-0" : String(v);
  }
  if (t === "bigint") return v.toString();
  if (t === "string") return __json_esc(v);
  if (Object.prototype.toString.call(v) === "[object Uint8Array]") {
    if (v.__raw) return __json_enc_raw(v);
    return __json_b64(v);
  }
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(v)) {
    var titems = [];
    for (var ti = 0; ti < v.length; ti++) titems.push(v instanceof Float32Array ? __json_float32(v[ti]) : (typeof v[ti] === "bigint" ? v[ti].toString() : String(v[ti])));
    return "[" + titems.join(",") + "]";
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
  if (typeof v.MarshalJSON === "function" && !(v.__v === true && v.MarshalJSON.__ptrRecv)) {
    return __json_marshaler_out(v.MarshalJSON(), v.constructor && v.constructor.name ? v.constructor.name : "value");
  }
  // Boxed named values (from an interface) encode as their value; *T boxes as the pointee.
  if (typeof v.__gfUnbox === "function") {
    var inner = v.__gfUnbox();
    if (Object.prototype.hasOwnProperty.call(v, "_p")) inner = inner == null ? null : inner.value;
    return __json_enc_any(inner);
  }
  if (typeof v === "object") {
    if (__json_nilmap(v)) return "null";
    var okeys = Object.keys(v).filter(function(k) { return !k.startsWith("__") || k === "__proto__"; });
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
  var useNum = typeof OptUseNumber$$internal$jsonrt !== "undefined" && OptUseNumber$$internal$jsonrt;
  if (typeof parsed === "string") {
    if (parsed.endsWith("__bigint")) {
      var rawBig = parsed.slice(0, -8);
      if (useNum) return typeof Number$$internal$jsonrt === "function" ? new Number$$internal$jsonrt(rawBig) : rawBig;
      return Number(rawBig);
    }
    return parsed;
  }
  if (typeof parsed === "number") {
    if (useNum) {
      var rawNum = String(parsed);
      return typeof Number$$internal$jsonrt === "function" ? new Number$$internal$jsonrt(rawNum) : rawNum;
    }
    return parsed;
  }
  if (typeof parsed === "boolean") return parsed;
  if (Array.isArray(parsed)) {
    var outSlice = [];
    for (var i = 0; i < parsed.length; i++) outSlice.push(__json_dec_any(parsed[i]));
    return outSlice;
  }
  if (typeof parsed === "object") {
    var outMap = __json_newmap();
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
  else if (target && typeof target === "object") {
    for (const k of Object.keys(out)) Object.defineProperty(target, k, { value: out[k], writable: true, enumerable: true, configurable: true });
  }
  return null;
};
var __json_enc_slice = __json_enc_slice || function(slice, elemEnc) {
  if (slice === null || slice === undefined) return "null";
  var items = [];
  for (var i = 0; i < slice.length; i++) items.push(elemEnc(slice[i]));
  return "[" + items.join(",") + "]";
};
var __json_enc_map = __json_enc_map || function(m, valEnc) {
  if (__json_nilmap(m)) return "null";
  if (m instanceof Map) {
    var mkeys = Array.from(m.keys()).map(String).sort();
    var mentries = [];
    for (var i = 0; i < mkeys.length; i++) {
      mentries.push(__json_esc(mkeys[i]) + ":" + valEnc(m.get(mkeys[i])));
    }
    return "{" + mentries.join(",") + "}";
  }
  var keys = Object.keys(m).filter(function(k) { return !k.startsWith("__") || k === "__proto__"; }).sort();
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
    if (e && typeof e.Error === "function") return [new Uint8Array(0), e];
    return [new Uint8Array(0), typeof __error === "function" ? __error(e.message || String(e)) : e];
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
      else if (c === "\\\\") escaped = true;
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
      out += "\\n" + prefix + indent.repeat(depth);
    } else if (c === "}" || c === "]") {
      depth--;
      out += "\\n" + prefix + indent.repeat(depth) + c;
    } else if (c === ",") {
      out += ",\\n" + prefix + indent.repeat(depth);
    } else if (c === ":") {
      out += ": ";
    } else if (c !== " " && c !== "\\t" && c !== "\\n" && c !== "\\r") {
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
// The static type of the target decides the argument errors, as in Go:
// targetKind is "ptr" (a pointer), "val" (neither pointer nor interface) or
// empty (an interface, judged by the dynamic value).
var __json_invalid_target = __json_invalid_target || function(name, isPtr) {
  if (typeof InvalidUnmarshalError$$internal$jsonrt === "function") {
    var e = new InvalidUnmarshalError$$internal$jsonrt(name, isPtr);
    if (e.__p !== true && Object.isExtensible(e)) Object.defineProperty(e, "__p", { value: true, configurable: true, writable: true });
    e.__struct = "InvalidUnmarshalError$$internal$jsonrt";
    return e;
  }
  var msg = name === "" ? "json: Unmarshal(nil)" : (isPtr ? "json: Unmarshal(nil " + name + ")" : "json: Unmarshal(non-pointer " + name + ")");
  return typeof __error === "function" ? __error(msg) : new Error(msg);
};
var __json_unmarshal = __json_unmarshal || function(dec, data, target, targetTypeName, targetKind) {
  if (target?.__nilp === true) target = null;
  __json_structs.length = 0;
  __json_path.length = 0;
  __json_current_offset = 0;
  var u8data = ((typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) || data instanceof Uint8Array) ? data : new Uint8Array(data);
  if (typeof CheckValid$$internal$jsonrt === "function") {
    var syntaxErr = CheckValid$$internal$jsonrt(u8data);
    if (syntaxErr) {
      if (typeof syntaxErr === "object" && syntaxErr !== null) {
        if (syntaxErr.__p !== true && Object.isExtensible(syntaxErr)) {
          Object.defineProperty(syntaxErr, "__p", { value: true, configurable: true, writable: true });
        }
        syntaxErr.__struct = "SyntaxError$$internal$jsonrt";
      }
      return syntaxErr;
    }
  }
  if (targetKind === "val") return __json_invalid_target(targetTypeName, false);
  if (target === null || target === undefined) {
    return targetKind === "ptr" ? __json_invalid_target(targetTypeName, true) : __json_invalid_target("", false);
  }
  if (typeof target !== "object" || target.__v === true) {
    var tname = targetTypeName || (target && target.constructor && target.constructor.name && target.constructor.name !== "Object" ? target.constructor.name : typeof target);
    return __json_invalid_target(tname, false);
  }
  var str;
  try {
    str = typeof data === "string" ? data : new TextDecoder().decode(u8data);
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
  var rootRaw = __json_parse_raw_node(str);
  __json_bind_raw(parsed, rootRaw);
  __json_current_offset = str.length;
  var isBox = target && typeof target === "object" && (Object.prototype.hasOwnProperty.call(target, "value") || typeof target.__gfUnbox === "function");
  var dest = isBox ? target.value : target;
  var err = dec(parsed, dest, isBox ? target : null, data, rootRaw.raw);
  if (err) return err.__userErr || err;
  return null;
};
var __json_encoder_encode = __json_encoder_encode || function(enc, codec, v) {
  var e = enc?.value ?? enc;
  if (e.err != null) return e.err;
  OptEscapeHTML$$internal$jsonrt = e.escapeHTML;
  var jsonStr;
  try {
    jsonStr = codec(v);
  } catch (err) {
    if (err && typeof err.Error === "function") return err;
    return typeof __error === "function" ? __error(err.message || String(err)) : err;
  } finally {
    OptEscapeHTML$$internal$jsonrt = true;
  }
  if (e.indent !== "" || e.prefix !== "") {
    var indented = __json_indent(jsonStr, e.prefix, e.indent);
    if (indented != null) jsonStr = indented;
  }
  var bytes = new TextEncoder().encode(jsonStr + "\\n");
  var res = e.w.Write(bytes);
  var err = Array.isArray(res) ? res[1] : null;
  if (err != null) {
    e.err = err;
    return err;
  }
  return null;
};
var __json_decoder_decode = __json_decoder_decode || function(dec, decFn, target, targetTypeName, targetKind) {
  if (target?.__nilp === true) target = null;
  var d = dec?.value ?? dec;
  var res = ScanNext$$internal$jsonrt(d.r);
  var data = res[0], skipped = res[1], err = res[2];
  d.offset += typeof d.offset === "bigint" ? BigInt(skipped) : skipped;
  if (err != null) return err;
  d.offset += typeof d.offset === "bigint" ? BigInt(data.length) : data.length;
  OptUseNumber$$internal$jsonrt = d.useNumber;
  OptDisallowUnknownFields$$internal$jsonrt = d.disallowUnknownFields;
  var uerr;
  try {
    uerr = __json_unmarshal(decFn, data, target, targetTypeName, targetKind);
  } finally {
    OptUseNumber$$internal$jsonrt = false;
    OptDisallowUnknownFields$$internal$jsonrt = false;
  }
  return uerr;
};`;

export const HELPER_SIMD = `var __simd_f32x4 = __simd_f32x4 || function(a, b, c, d) {
  return Object.freeze([Math.fround(Number(a ?? 0)), Math.fround(Number(b ?? 0)), Math.fround(Number(c ?? 0)), Math.fround(Number(d ?? 0))]);
};
var __simd_splat = __simd_splat || function(v) {
  var s = Math.fround(Number(v ?? 0));
  return Object.freeze([s, s, s, s]);
};
var __simd_add = __simd_add || function(a, b) {
  return Object.freeze([Math.fround(a[0] + b[0]), Math.fround(a[1] + b[1]), Math.fround(a[2] + b[2]), Math.fround(a[3] + b[3])]);
};
var __simd_sub = __simd_sub || function(a, b) {
  return Object.freeze([Math.fround(a[0] - b[0]), Math.fround(a[1] - b[1]), Math.fround(a[2] - b[2]), Math.fround(a[3] - b[3])]);
};
var __simd_mul = __simd_mul || function(a, b) {
  return Object.freeze([Math.fround(a[0] * b[0]), Math.fround(a[1] * b[1]), Math.fround(a[2] * b[2]), Math.fround(a[3] * b[3])]);
};
var __simd_div = __simd_div || function(a, b) {
  return Object.freeze([Math.fround(a[0] / b[0]), Math.fround(a[1] / b[1]), Math.fround(a[2] / b[2]), Math.fround(a[3] / b[3])]);
};
var __simd_min = __simd_min || function(a, b) {
  return Object.freeze([Math.fround(Math.min(a[0], b[0])), Math.fround(Math.min(a[1], b[1])), Math.fround(Math.min(a[2], b[2])), Math.fround(Math.min(a[3], b[3]))]);
};
var __simd_max = __simd_max || function(a, b) {
  return Object.freeze([Math.fround(Math.max(a[0], b[0])), Math.fround(Math.max(a[1], b[1])), Math.fround(Math.max(a[2], b[2])), Math.fround(Math.max(a[3], b[3]))]);
};
var __simd_dot3 = __simd_dot3 || function(a, b) {
  return Math.fround(Math.fround(Math.fround(a[0] * b[0]) + Math.fround(a[1] * b[1])) + Math.fround(a[2] * b[2]));
};
var __simd_dot4 = __simd_dot4 || function(a, b) {
  return Math.fround(Math.fround(Math.fround(Math.fround(a[0] * b[0]) + Math.fround(a[1] * b[1])) + Math.fround(a[2] * b[2])) + Math.fround(a[3] * b[3]));
};
var __simd_with_lane = __simd_with_lane || function(a, i, v) {
  var r = [a[0], a[1], a[2], a[3]];
  r[i] = Math.fround(v);
  return Object.freeze(r);
};
var __simd_map = __simd_map || function(a, f) {
  return Object.freeze([Math.fround(f(a[0])), Math.fround(f(a[1])), Math.fround(f(a[2])), Math.fround(f(a[3]))]);
};
var __simd_neg = __simd_neg || function(a) { return __simd_map(a, function(x) { return -x; }); };
var __simd_abs = __simd_abs || function(a) { return __simd_map(a, Math.abs); };
var __simd_sqrt = __simd_sqrt || function(a) { return __simd_map(a, Math.sqrt); };
var __simd_floor = __simd_floor || function(a) { return __simd_map(a, Math.floor); };
var __simd_ceil = __simd_ceil || function(a) { return __simd_map(a, Math.ceil); };
var __simd_trunc = __simd_trunc || function(a) { return __simd_map(a, Math.trunc); };
var __simd_nearest = __simd_nearest || function(a) {
  return __simd_map(a, function(x) {
    if (!isFinite(x)) return x;
    var f = Math.floor(x), d = x - f, r;
    if (d < 0.5) r = f; else if (d > 0.5) r = f + 1; else r = (f % 2 === 0) ? f : f + 1;
    return (r === 0 && (x < 0 || Object.is(x, -0))) ? -0 : r;
  });
};
var __simd_muladd = __simd_muladd || function(a, b, c) {
  return Object.freeze([Math.fround(Math.fround(a[0] * b[0]) + c[0]), Math.fround(Math.fround(a[1] * b[1]) + c[1]), Math.fround(Math.fround(a[2] * b[2]) + c[2]), Math.fround(Math.fround(a[3] * b[3]) + c[3])]);
};
var __simd_sum = __simd_sum || function(a) {
  return Math.fround(Math.fround(Math.fround(a[0] + a[1]) + a[2]) + a[3]);
};
var __simd_cmp = __simd_cmp || function(a, b, f) {
  return Object.freeze([f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2]), f(a[3], b[3])]);
};
var __simd_eq = __simd_eq || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x === y; }); };
var __simd_ne = __simd_ne || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x !== y; }); };
var __simd_lt = __simd_lt || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x < y; }); };
var __simd_le = __simd_le || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x <= y; }); };
var __simd_gt = __simd_gt || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x > y; }); };
var __simd_ge = __simd_ge || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x >= y; }); };
var __simd_equal = __simd_equal || function(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
};
var __simd_mask_and = __simd_mask_and || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x && y; }); };
var __simd_mask_or = __simd_mask_or || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x || y; }); };
var __simd_mask_xor = __simd_mask_xor || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x !== y; }); };
var __simd_mask_andnot = __simd_mask_andnot || function(a, b) { return __simd_cmp(a, b, function(x, y) { return x && !y; }); };
var __simd_mask_not = __simd_mask_not || function(a) { return Object.freeze([!a[0], !a[1], !a[2], !a[3]]); };
var __simd_mask_any = __simd_mask_any || function(a) { return a[0] || a[1] || a[2] || a[3]; };
var __simd_mask_all = __simd_mask_all || function(a) { return a[0] && a[1] && a[2] && a[3]; };
var __simd_mask_bits = __simd_mask_bits || function(a) { return (a[0] ? 1 : 0) | (a[1] ? 2 : 0) | (a[2] ? 4 : 0) | (a[3] ? 8 : 0); };
var __simd_select = __simd_select || function(m, a, b) {
  return Object.freeze([m[0] ? a[0] : b[0], m[1] ? a[1] : b[1], m[2] ? a[2] : b[2], m[3] ? a[3] : b[3]]);
};
var __simd_shuffle = __simd_shuffle || function(a, b, i0, i1, i2, i3) {
  var c = [a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]];
  return Object.freeze([c[i0], c[i1], c[i2], c[i3]]);
};
var __simd_swizzle = __simd_swizzle || function(a, i0, i1, i2, i3) {
  return Object.freeze([a[i0], a[i1], a[i2], a[i3]]);
};
var __simd_load = __simd_load || function(buf, i) {
  if (i < 0 || i + 4 > buf.length) throw new Error("panic: runtime error: index out of range");
  return Object.freeze([Math.fround(buf[i]), Math.fround(buf[i + 1]), Math.fround(buf[i + 2]), Math.fround(buf[i + 3])]);
};
var __simd_store = __simd_store || function(buf, i, v) {
  if (i < 0 || i + 4 > buf.length) throw new Error("panic: runtime error: index out of range");
  buf[i] = v[0]; buf[i + 1] = v[1]; buf[i + 2] = v[2]; buf[i + 3] = v[3];
};
var __simd_load_slice = __simd_load_slice || function(xs, i) {
  if (xs == null || i < 0 || i + 4 > xs.length) throw new Error("panic: runtime error: index out of range");
  return Object.freeze([xs[i], xs[i + 1], xs[i + 2], xs[i + 3]]);
};
var __simd_store_slice = __simd_store_slice || function(xs, i, v) {
  if (xs == null || i < 0 || i + 4 > xs.length) throw new Error("panic: runtime error: index out of range");
  xs[i] = v[0]; xs[i + 1] = v[1]; xs[i + 2] = v[2]; xs[i + 3] = v[3];
};`;
