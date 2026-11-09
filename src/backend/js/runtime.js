// Runtime helpers emitted by the code generator when the corresponding feature is used.
// Each export is a single JS statement (var __x = __x || function(...){...};) so that
// multiple compiled files bundled together can safely repeat the declaration.

export const HELPER_LEN = `var __len = __len || function(a) {
  if (a && typeof a === 'object' && !Array.isArray(a) && !ArrayBuffer.isView(a)) return Object.keys(a).length;
  return a?.length ?? 0;
};`;

// string -> []byte: UTF-8, except that a lone surrogate U+DC80-U+DCFF (a raw
// byte from a \xNN escape) encodes as that single byte.
export const HELPER_U8ENC = `var __u8e = __u8e || new TextEncoder();
var __u8enc = __u8enc || function(s) {
  const e = __u8e;
  if (s.isWellFormed()) return e.encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc80 && c <= 0xdcff && !(i > 0 && (s.charCodeAt(i - 1) & 0xfc00) === 0xd800)) { out.push(c - 0xdc00); continue; }
    const cp = s.codePointAt(i);
    if (cp > 0xffff) i++;
    for (const b of e.encode(String.fromCodePoint(cp))) out.push(b);
  }
  return Uint8Array.from(out);
};`;

// []byte -> string: UTF-8 with U+FFFD for invalid bytes. A typed array is
// decoded in place; anything else is copied into one first.
export const HELPER_U8DEC = `var __u8d = __u8d || null;
var __u8dec = __u8dec || function(b) {
  return (__u8d ??= new TextDecoder()).decode(ArrayBuffer.isView(b) ? b : new Uint8Array(b));
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

// `make([]T, n, cap)` argument checks with Go's messages: a negative length is
// a len panic, a negative capacity (or one below the length) a cap panic.
export const HELPER_MKLEN = `var __mkn = __mkn || function(n) {
  if (!(n >= 0)) throw new Error("runtime error: makeslice: len out of range");
  return n;
};
var __mkc = __mkc || function(c) {
  if (!(c >= 0)) throw new Error("runtime error: makeslice: cap out of range");
  return c;
};`;

// string(rune): an out-of-range rune or a surrogate is U+FFFD.
export const HELPER_RUNESTR = `var __rstr = __rstr || function(c) {
  return String.fromCodePoint(c >= 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? c : 0xfffd);
};`;

export const HELPER_APPEND = `var __tn = __tn || function(c) {
  return Object.hasOwn(c, "__tnil") ? c.__tnil : Object.defineProperty(c, "__tnil", { value: Object.defineProperty(new c(0), "__nilt", { value: true }) }).__tnil;
};
// Append the elements of the array-like b to a typed array.
var __tapp = __tapp || function(a, b) {
  const c = __tcap.get(a);
  if (c !== undefined && a.length + b.length <= c) {
    const r = new a.constructor(a.buffer, a.byteOffset, a.length + b.length);
    r.set(b, a.length);
    if (c > r.length) __tcap.set(r, c);
    return r;
  }
  // Grow with spare capacity so repeated appends cost O(1) amortized.
  const n = a.length + b.length;
  const cap = Math.max(n, a.length * 2);
  const res = new a.constructor(new a.constructor(cap).buffer, 0, n);
  res.set(a);
  res.set(b, a.length);
  __tcap.set(res, cap);
  return res;
};
var __append = __append || function(a, ...b) {
  if (b.length === 0) return a !== null && a !== undefined && a.__nilt === true ? null : a;
  if (a && ArrayBuffer.isView(a)) return __tapp(a, b);
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
};
// append(a, b...) of a typed array with one source: no argument spread.
var __appendv = __appendv || function(a, b) {
  if (b.length === 0) return a !== null && a !== undefined && a.__nilt === true ? null : a;
  return __tapp(a, b);
};`;

// `s = append(s, x)` in the json codecs, where the slice is a local that no
// other slice shares: a plain array grows in place.  A view with spare
// capacity, a reslice copy or a typed array takes the general __append.
export const HELPER_PUSHS =
	"var __pushs = __pushs || function(a, x) { if (a == null) return [x]; if (!Array.isArray(a) || a[__sv] !== undefined || a[__rcap] !== undefined) return __append(a, x); a.push(x); return a; };";

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
export const HELPER_IFACE_BOX = `var __ifv = __ifv || function(x, ptrFields, fresh) {
  if (x === null || typeof x !== "object") return x;
  const c = fresh === true ? x : typeof x.__clone === "function" ? x.__clone() : Object.assign(Object.create(Object.getPrototypeOf(x)), x);
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
  for (const k in c) {
    const v = c[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v)) {
      if (!v.__v && !v.__p && Object.isExtensible(v) && (!Array.isArray(ptrFields) || !ptrFields.includes(k))) {
        Object.defineProperty(v, "__v", { value: true, configurable: true });
      }
    }
  }
  return c;
};
var __ifp = __ifp || function(x, ptrFields, seen) {
  if (x === null || typeof x !== "object") return x;
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
var __pbs = __pbs || function(p) {
  var e = p !== null && typeof p === "object" ? p.value : undefined;
  return e !== null && typeof e === "object" && e.value === e ? e : p;
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
};
var __ity = __ity || function(x, t, ptr) {
  // The frozen nil map cannot carry a tag: a copy of it keeps its map type.
  if (x !== null && x !== undefined && x.__nilm === true && x.__t === undefined)
    return Object.freeze(Object.defineProperties({}, { __map: { value: true }, __nilm: { value: true }, __t: { value: t } }));
  if (x === null || x === undefined) {
    // A nil slice keeps its type as an empty tagged array (not a nil interface).
    if (!ptr && t.charCodeAt(0) !== 91) return x;
    const n = ptr ? {} : [];
    if (!ptr) Object.defineProperty(n, "__nils", { value: true });
    Object.defineProperty(n, "__nilp", { value: true });
    Object.defineProperty(n, "__t", { value: t });
    return n;
  }
  if ((typeof x === "object" || typeof x === "function") && Object.isExtensible(x))
    Object.defineProperty(x, "__t", { value: t, configurable: true, writable: true });
  return x;
};
var __isty = __isty || function(v, t, k, c, n) {
  if (v === null || v === undefined || (typeof v !== "object" && typeof v !== "function")) return false;
  if (k === "func") return typeof v === "function" && (v.__t === undefined || t === "" || v.__t === t);
  if (v.__t !== undefined && t !== "") return v.__t === t;
  if (v.__nilp === true) return false;
  if (k === "named" || k === "struct") return false;
  if (k === "ptr") {
    if (!(typeof v === "object" && "value" in v && v.value !== v && typeof v.__gfUnbox !== "function" && !(v instanceof Array))) return false;
    // An untagged pointer (to a type parameter's variable): the pointee's
    // shape picks the pointer type; a nil slice or map is decoded as an any.
    if (t.charCodeAt(0) === 42) {
      var pt = t.slice(1), pe = v.value;
      if (pe === null || pe === undefined) return pt === "interface {}";
      if (typeof pe === "number") return pt === "float64";
      if (typeof pe === "string") return pt === "string";
      if (typeof pe === "boolean") return pt === "bool";
      if (typeof pe === "bigint") return pt === "int64";
      if (ArrayBuffer.isView(pe)) return pt.startsWith("[]");
      if (typeof pe === "object" && !Array.isArray(pe)) return pt === "interface {}";
    }
    return true;
  }
  if (k === "map") return typeof v === "object" && (v.__map === true || Object.getPrototypeOf(v) === Object.prototype);
  if (k === "array") return Array.isArray(v) && v.length === n;
  if (c) return v instanceof c;
  if (!Array.isArray(v)) return false;
  // An untagged array (a value of a type parameter's type): its first element
  // must at least have the shape of the tag's element type.
  if (k === "slice" && v.length > 0 && t.startsWith("[]")) {
    var x = t.slice(2), e = v[0];
    if (x === "bool") return typeof e === "boolean";
    if (x === "string") return typeof e === "string";
    if (x === "int64" || x === "uint64") return typeof e === "bigint";
    if (/^(u?int(8|16|32)?|uintptr|float(32|64))$/.test(x)) return typeof e === "number";
  }
  return true;
};
var __dtn = __dtn || function(v) {
  if (v === null || v === undefined) return "nil";
  switch (typeof v) {
    case "string": return "string";
    case "boolean": return "bool";
    case "number": return Number.isInteger(v) ? "int" : "float64";
    case "bigint": return "int64";
  }
  if (v.__t !== undefined) return v.__t;
  if (Array.isArray(v)) return "[]interface {}";
  const c = v.constructor;
  if (c && c !== Object && typeof c.name === "string" && c.name !== "") {
    const ptr = c.name.endsWith("$Ptr");
    const n = ptr ? c.name.slice(0, -4) : c.name;
    const i = n.indexOf("$$");
    const q = i < 0 ? "main." + n : n.slice(i + 2) + "." + n.slice(0, i);
    return (ptr || v.__v !== true && typeof v.__gfUnbox !== "function" ? "*" : "") + q;
  }
  return typeof v === "function" ? "func()" : "map[string]interface {}";
};
var __tafail = __tafail || function(src, v, target, methods) {
  if (methods) {
    if (v === null || v === undefined) return new Error("interface conversion: interface is nil, not " + target);
    const m = methods.find((n) => typeof v[n] !== "function") ?? methods[0];
    return new Error("interface conversion: " + __dtn(v) + " is not " + target + ": missing method " + m);
  }
  return new Error("interface conversion: " + src + " is " + __dtn(v) + ", not " + target);
};`;

// Nil-interface method call guard (strict mode only): matches Go's panic
// message instead of a JS TypeError.
// 64-bit shifts: count is converted to BigInt; negative count panics;
// wraps with BigInt.asIntN / BigInt.asUintN.
export const HELPER_SHIFT = `var __shc = __shc || function(n) {
  if (n < 0) throw new Error("runtime error: negative shift amount");
  return n;
};
var __shl64 = __shl64 || function(x, n, u) {
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
var __tbox = __tbox || function(f, x) {
  return f && f.b ? f.b(x) : x;
};
var __ti = __ti || function(f, k, id, is, u, b, fb) {
  const g = () => f();
  g.k = k; g.id = id; g.is = is; g.u = u; g.b = b; g.fb = fb;
  return g;
};
var __tar = __tar || function(f, op, a, b) {
  const k = f?.k;
  const dz = () => { throw new Error("runtime error: integer divide by zero"); };
  const ns = () => { throw new Error("runtime error: negative shift amount"); };
  if (typeof a === "bigint") {
    const sh = op === "<<" || op === ">>";
    if (sh) { b = Number(b); if (b < 0) ns(); }
    else if (typeof b !== "bigint") b = BigInt(b);
    const w = k === "uint64" ? (v) => BigInt.asUintN(64, v) : (v) => BigInt.asIntN(64, v);
    switch (op) {
      case "+": return w(a + b);
      case "-": return w(a - b);
      case "*": return w(a * b);
      case "/": return b === 0n ? dz() : w(a / b);
      case "%": return b === 0n ? dz() : w(a % b);
      case "&": return w(a & b);
      case "|": return w(a | b);
      case "^": return w(a ^ b);
      case "&^": return w(a & ~b);
      case "<<": return b >= 64 ? 0n : w(a << BigInt(b));
      default: return b >= 64 ? (k === "uint64" || a >= 0n ? 0n : -1n) : w(a >> BigInt(b));
    }
  }
  let bits = 0, signed = true;
  switch (k) {
    case "int8": bits = 8; break;
    case "int16": bits = 16; break;
    case "int32": case "rune": bits = 32; break;
    case "uint8": case "byte": bits = 8; signed = false; break;
    case "uint16": bits = 16; signed = false; break;
    case "uint32": bits = 32; signed = false; break;
  }
  const w = bits === 0 ? (v) => v
    : bits === 32 ? (signed ? (v) => v | 0 : (v) => v >>> 0)
    : signed ? (v) => (v << (32 - bits)) >> (32 - bits)
    : (v) => v & ((1 << bits) - 1);
  const int = bits !== 0 || k === "int" || k === "uint" || k === "uintptr";
  switch (op) {
    case "+": return k === "float32" ? Math.fround(a + b) : w(a + b);
    case "-": return k === "float32" ? Math.fround(a - b) : w(a - b);
    case "*": return k === "float32" ? Math.fround(a * b) : bits === 0 ? a * b : w(Math.imul(a, b));
    case "/": return int ? (b === 0 ? dz() : w(Math.trunc(a / b))) : k === "float32" ? Math.fround(a / b) : a / b;
    case "%": return int && b === 0 ? dz() : w(a % b);
    case "&": return bits === 0 ? a & b : w(a & b);
    case "|": return bits === 0 ? a | b : w(a | b);
    case "^": return bits === 0 ? a ^ b : w(a ^ b);
    case "&^": return bits === 0 ? a & ~b : w(a & ~b);
  }
  b = Number(b);
  if (b < 0) ns();
  if (bits === 0) return op === "<<" ? a << b : a >> b;
  if (b >= bits) return op === ">>" && signed && a < 0 ? -1 : 0;
  return op === "<<" ? w(a << b) : signed ? a >> b : a >>> b;
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
  if (m == null || m.__nilm === true) throw new Error("assignment to entry in nil map");
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
var __kcl = __kcl || function(o) {
  if (o === null || typeof o !== "object") return o;
  if (typeof o.__clone === "function") return o.__clone();
  if (ArrayBuffer.isView(o)) return o.slice();
  if (Array.isArray(o)) return o.map(__kcl);
  const c = Object.create(Object.getPrototypeOf(o));
  for (const f of Object.keys(o)) c[f] = __kcl(o[f]);
  return c;
};
var __sk = __sk || function(o) {
  const s = "\\u0001" + JSON.stringify(o, (k, v) => typeof v === "bigint" ? v.toString() + "n" : typeof v === "number" && !Number.isFinite(v) ? { $f: String(v) } : v);
  if (!__kt.has(s)) __kt.set(s, __kcl(o));
  return s;
};
// Pointer keys compare by identity: a per-object id (a pointer to an element
// is its container plus index) keys the property, and the pointer is kept
// in the table so ranging and fmt can recover it.
var __pids = __pids || new WeakMap();
var __pidn = __pidn || { n: 0 };
var __pid = __pid || function(o) {
  let id = __pids.get(o);
  if (id === undefined) __pids.set(o, id = ++__pidn.n);
  return id;
};
var __pk = __pk || function(p) {
  if (p === null || p === undefined) return "\\u0001nil";
  const s = "\\u0001*" + (p.__target !== undefined && p.__target !== null ? __pid(p.__target) + ":" + p.__index : __pid(p));
  if (!__kt.has(s)) __kt.set(s, p);
  return s;
};
var __ik = __ik || function(k, tag) {
  const t = typeof k;
  if (k === null || k === undefined) return "\\u0001nil";
  if (tag !== undefined) {
    if (tag === "*") return __pk(k);
    if (tag.charCodeAt(0) === 33) throw new Error("runtime error: hash of unhashable type " + tag.slice(1));
    if (t === "number" || t === "bigint") {
      const s = "\\u0001" + tag + ":" + String(k);
      if (!__kt.has(s)) __kt.set(s, k);
      return s;
    }
  }
  if (t === "number" || t === "boolean" || t === "bigint") return "\\u0001" + t + ":" + String(k);
  // A slice, map or func in an \`any\` carries its type tag: Go cannot hash it.
  if ((t === "object" || t === "function") && typeof k.__t === "string" && /^(\\[\\]|map\\[|func\\()/.test(k.__t))
    throw new Error("runtime error: hash of unhashable type " + k.__t.replace(/ void$/, ""));
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
  if (s === "\\u0001nil") return null;
  if (k !== undefined && s.charCodeAt(1) === 42) return k;
  if (k === undefined) {
    if (s.startsWith("\\u0001number:")) return Number(s.slice(8));
    if (s.startsWith("\\u0001boolean:")) return s.slice(9) === "true";
    if (s.startsWith("\\u0001bigint:")) return BigInt(s.slice(8));
    return s;
  }
  return copy ? __kcl(k) : k;
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
// Interface keys of different dynamic types sort by type first: nil, named
// types, strings, bools, numbers.
var __krank = __krank || function(v) {
  if (v === null || v === undefined) return 0;
  const t = typeof v;
  if (t === "object" && typeof v.__gfUnbox === "function") return 1;
  return t === "string" ? 2 : t === "boolean" ? 3 : t === "number" || t === "bigint" ? 4 : 5;
};
var __kcmp = __kcmp || function(a, b) {
  const ra = __krank(a), rb = __krank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) {
    const na = a.constructor.name, nb = b.constructor.name;
    if (na !== nb) return na < nb ? -1 : 1;
    a = a.__gfUnbox();
    b = b.__gfUnbox();
  }
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
  if (a.__nilp === true && b.__nilp === true && a.__t !== undefined) return a.__t === b.__t;
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
// panic(v): a string panics with that message; any other value is kept in
// the thrown error's pv field so recover() returns it unchanged (an error's
// message is its Error()).
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
var __gopanicv = __gopanicv || function(v) {
  if (typeof v === "string") {
    // The value rides in pv so recover() returns the string itself, never a
    // runtime error value, however the message reads.
    const se = new Error(v);
    se.pv = { v };
    throw se;
  }
  let msg;
  try { msg = typeof v?.Error === "function" ? v.Error() : String(v); } catch { msg = String(v); }
  const e = new Error(msg);
  e.pv = { v };
  throw e;
};
var __recover = __recover || function(ok) {
  if (!ok) return null;
  const s = __gopanic.stack;
  const top = s.length > 0 ? s[s.length - 1] : null;
  if (top === null || top.recovered) return null;
  top.recovered = true;
  const e = top.err;
  if (e && e.pv) return e.pv.v;
  // A JS TypeError from using null as a pointer is Go's nil dereference.
  if (e && e.name === "TypeError" && /of null|undefined or null/.test(e.message))
    return __error("runtime error: invalid memory address or nil pointer dereference");
  const msg = e?.message ?? String(e);
  // A Go runtime panic recovers as an error value (runtime.Error).
  if (/^(runtime error: |assignment to entry in nil map$|interface conversion: )/.test(msg)) return __error(msg);
  return msg;
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

// internal/jsonrt's encoder writes into `e.buf[0:e.n]`; these helpers append
// to it directly (see the jsonrt natives in natives.js).
export const HELPER_JSONRT = `var __jte = __jte || new TextEncoder();
var __jroom = __jroom || function(e, k) {
  var need = e.n + k;
  if (need > e.buf.length) {
    var nb = new Uint8Array(Math.max(need, e.buf.length * 2));
    nb.set(e.buf.subarray(0, e.n));
    e.buf = nb;
  }
};
var __jput = __jput || function(e, s) {
  var l = s.length, i = 0;
  __jroom(e, l);
  var buf = e.buf, n = e.n;
  for (; i < l; i++) {
    var c = s.charCodeAt(i);
    if (c > 127) break;
    buf[n + i] = c;
  }
  e.n = n + i;
  if (i < l) {
    var u = __jte.encode(s.slice(i));
    __jroom(e, u.length);
    e.buf.set(u, e.n);
    e.n += u.length;
  }
};
var __jint = __jint || function(e, v) { __jput(e, String(v)); };
var __jfloat = __jfloat || function(e, f, bits) {
  if (bits === 32) {
    var g = Math.fround(f);
    for (var p = 1; p <= 9; p++) {
      var t = g.toPrecision(p);
      if (Math.fround(+t) === g) { f = +t; break; }
    }
  }
  __jput(e, String(f));
};
var __jescRe = __jescRe || /[\\u0000-\\u001f"\\\\<>&\\u2028\\u2029\\ud800-\\udfff]/;
var __jescRe2 = __jescRe2 || /[\\u0000-\\u001f"\\\\\\u2028\\u2029\\ud800-\\udfff]/;
var __jesc = __jesc || function(s, html) {
  var out = "", start = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i), r = null;
    if (c < 0x20) {
      r = c === 8 ? "\\\\b" : c === 12 ? "\\\\f" : c === 10 ? "\\\\n" : c === 13 ? "\\\\r" : c === 9 ? "\\\\t" : "\\\\u00" + (c < 16 ? "0" : "") + c.toString(16);
    } else if (c === 34) r = '\\\\"';
    else if (c === 92) r = "\\\\\\\\";
    else if (html && (c === 60 || c === 62 || c === 38)) r = "\\\\u00" + c.toString(16);
    else if (c === 0x2028 || c === 0x2029) r = "\\\\u202" + (c & 15).toString(16);
    else if (c >= 0xd800 && c <= 0xdfff) {
      var d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c < 0xdc00 && d >= 0xdc00 && d <= 0xdfff) { i++; continue; }
      r = "\\ufffd";
    }
    if (r !== null) { out += s.slice(start, i) + r; start = i + 1; }
  }
  return out + s.slice(start);
};
var __jtd = __jtd || new TextDecoder("utf-8", { ignoreBOM: true });
var __jrstr = __jrstr || function(d, unquote) {
  var data = d.data, p = d.pos + 1, start = p, n = data.length, esc = false;
  for (; p < n; p++) {
    var c = data[p];
    if (c === 34) break;
    if (c === 92) { esc = true; p++; }
  }
  d.pos = p + 1;
  if (esc) return unquote(data.subarray(start, p));
  if (p - start < 32) {
    var s = "";
    for (var i = start; i < p; i++) {
      var b = data[i];
      if (b > 127) return __jtd.decode(data.subarray(start, p));
      s += String.fromCharCode(b);
    }
    return s;
  }
  return __jtd.decode(data.subarray(start, p));
};
var __jrnum = __jrnum || function(d) {
  var data = d.data, p = d.pos, start = p, n = data.length, s = "";
  for (; p < n; p++) {
    var c = data[p];
    if (!((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46 || c === 101 || c === 69)) break;
    s += String.fromCharCode(c);
  }
  d.pos = p;
  return s;
};
var __jvalid = __jvalid || function(data) {
  if (data === null || data === undefined) return false;
  var n = data.length;
  if (n > 10000) {
    // encoding/json stops at a nesting depth of 10000.
    var depth = 0, inStr = false;
    for (var i = 0; i < n; i++) {
      var c = data[i];
      if (inStr) { if (c === 92) i++; else if (c === 34) inStr = false; }
      else if (c === 34) inStr = true;
      else if (c === 91 || c === 123) { if (++depth > 10000) return false; }
      else if (c === 93 || c === 125) depth--;
    }
  }
  try { JSON.parse(__jtd.decode(data)); return true; } catch (e) { return false; }
};
var __jquote = __jquote || function(e, s) {
  __jroom(e, 1);
  e.buf[e.n++] = 34;
  __jput(e, (e.EscapeHTML ? __jescRe : __jescRe2).test(s) ? __jesc(s, e.EscapeHTML) : s);
  __jroom(e, 1);
  e.buf[e.n++] = 34;
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
