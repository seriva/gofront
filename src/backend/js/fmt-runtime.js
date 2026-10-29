// Runtime support for `fmt` verbs (Task 3.1c/3.1d): quoting, integer and float
// formatting, Go type names, Go-syntax (`%#v`) printing and the format-string
// scanner (flags, widths, `[n]` argument indexes, `*`, MISSING/EXTRA/BADINDEX
// forms).  Shared by the JS backend and the WASM host (`__sprintf` is the one
// format engine of both).  The text is plain JavaScript in String.raw so the
// regular expressions and escapes below are written as they run; it must not
// contain backticks or dollar-brace sequences.

// Utilities that need no access to the value formatter.  Operands whose
// static type matters (`%T`, `%#v`, unknown verbs, EXTRA) arrive wrapped by
// `__ft(value, typeDescriptor)` (descriptors: see fmt-types.js).
export const HELPER_FMT_UTIL = String.raw`var __FT = __FT || class FmtTyped { constructor(v, t) { this.v = v; this.t = t; } };
var __ft = __ft || function(v, t) { return new __FT(v, t); };
var __fmtu = __fmtu || (() => {
  const runes = (s) => { let n = 0; for (const _ of s) n++; return n; };
  const spaces = (n) => " ".repeat(Math.max(0, n));
  const pad = (s, fl, wid) => {
    const n = wid - runes(s);
    if (n <= 0) return s;
    return fl.minus ? s + spaces(n) : spaces(n) + s;
  };
  const hex = (c, w) => c.toString(16).padStart(w, "0");
  const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u;
  const ESC = { 7: "\\a", 8: "\\b", 12: "\\f", 10: "\\n", 13: "\\r", 9: "\\t", 11: "\\v" };
  const quote = (s, ascii, q) => {
    let out = q;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (ch === q || ch === "\\") out += "\\" + ch;
      else if (ESC[c]) out += ESC[c];
      else if (c < 0x20 || c === 0x7f) out += "\\x" + hex(c, 2);
      else if (c < 0x7f) out += ch;
      else if (ascii || !PRINTABLE.test(ch)) out += c < 0x10000 ? "\\u" + hex(c, 4) : "\\U" + hex(c, 8);
      else out += ch;
    }
    return out + q;
  };
  const validRune = (c) => c >= 0 && c <= 0x10ffff && !(c >= 0xd800 && c < 0xe000);
  const runeStr = (c) => String.fromCodePoint(validRune(c) ? c : 0xfffd);
  const quoteRune = (c, ascii) => quote(runeStr(c), ascii, "'");
  const toBig = (n) => (typeof n === "bigint" ? n : BigInt(Math.trunc(n)));
  const fmtInt = (n, base, upper, verbO, fl, wid, hasWid, prec, hasPrec) => {
    let b = toBig(n);
    const neg = b < 0n;
    if (neg) b = -b;
    let ds = b.toString(base);
    if (upper) ds = ds.toUpperCase();
    let pre = "";
    if (fl.sharp) {
      if (base === 16) pre = upper ? "0X" : "0x";
      else if (base === 2) pre = "0b";
      else if (base === 8 && ds[0] !== "0") pre = "0";
    }
    if (verbO) pre = "0o";
    if (hasPrec) {
      ds = prec === 0 && b === 0n ? "" : ds.padStart(prec, "0");
    } else if (fl.zero && !fl.minus && hasWid) {
      let p = wid - pre.length;
      if (neg || fl.plus || fl.space) p--;
      if (p > ds.length) ds = ds.padStart(p, "0");
    }
    const sign = neg ? "-" : fl.plus ? "+" : fl.space ? " " : "";
    return pad(sign + pre + ds, fl, wid);
  };
  const expParts = (s) => {
    const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
    return [m[1] + (m[2] ?? ""), Number(m[3])];
  };
  const expStr = (x, upper) => (upper ? "E" : "e") + (x < 0 ? "-" : "+") + String(Math.abs(x)).padStart(2, "0");
  const shortest32 = (v) => {
    for (let p = 1; p <= 9; p++) {
      const s = v.toExponential(p - 1);
      if (Math.fround(Number(s)) === v) return s;
    }
    return v.toExponential();
  };
  const fmtE = (abs, prec, upper) => {
    const [ds, x] = expParts(abs.toExponential(Math.min(prec, 100)));
    return ds[0] + (prec > 0 ? "." + ds.slice(1).padEnd(prec, "0") : "") + expStr(x, upper);
  };
  const fmtF = (abs, prec) => {
    if (abs >= 1e21) return BigInt(abs).toString() + (prec > 0 ? "." + "0".repeat(prec) : "");
    return abs.toFixed(Math.min(prec, 100));
  };
  const fmtG = (abs, prec, upper, f32) => {
    if (prec === 0) prec = 1;
    const [d0, x] = expParts(prec < 0 ? (f32 ? shortest32(abs) : abs.toExponential()) : abs.toExponential(Math.min(prec - 1, 100)));
    const ds = d0.replace(/0+$/, "") || "0";
    let eprec = prec < 0 ? 6 : prec;
    if (prec >= 0 && eprec > ds.length && ds.length >= x + 1) eprec = ds.length;
    if (abs !== 0 && (x < -4 || x >= eprec)) {
      return ds[0] + (ds.length > 1 ? "." + ds.slice(1) : "") + expStr(x, upper);
    }
    if (abs === 0) return "0";
    if (x >= 0) return ds.slice(0, x + 1).padEnd(x + 1, "0") + (ds.length > x + 1 ? "." + ds.slice(x + 1) : "");
    return "0." + "0".repeat(-x - 1) + ds;
  };
  // %x of a float: 0x1.8p+01, mantissa digits rounded to prec (shortest when absent).
  const fmtHexFloat = (abs, prec, upper, f32) => {
    let body;
    if (abs === 0) {
      body = "0x0" + (prec > 0 ? "." + "0".repeat(prec) : "") + "p+00";
    } else {
      const dv = new DataView(new ArrayBuffer(8));
      dv.setFloat64(0, abs);
      const bits = dv.getBigUint64(0);
      let e = Number((bits >> 52n) & 0x7ffn);
      let m = bits & 0xfffffffffffffn;
      if (e === 0) {
        // Subnormal: normalise so the leading bit is the implicit 1.
        e = -1022;
        while (m < (1n << 52n)) { m <<= 1n; e--; }
        m &= 0xfffffffffffffn;
      } else e -= 1023;
      let frac = m; // 52 bits = 13 hex digits
      let digits = 13;
      let lead = 1n;
      if (prec >= 0 && prec < 13) {
        const drop = BigInt((13 - prec) * 4);
        const full = (1n << 52n) | m;
        let q = full >> drop;
        const rem = full & ((1n << drop) - 1n);
        const half = 1n << (drop - 1n);
        if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
        if (q >> BigInt(prec * 4) >= 2n) { q >>= 1n; e++; }
        lead = q >> BigInt(prec * 4);
        frac = q & ((1n << BigInt(prec * 4)) - 1n);
        digits = prec;
      }
      let hs = digits > 0 ? frac.toString(16).padStart(digits, "0") : "";
      if (prec < 0) hs = hs.replace(/0+$/, "");
      else if (prec > 13) hs = hs.padEnd(prec, "0");
      body = "0x" + lead + (hs ? "." + hs : "") + "p" + (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
    }
    return upper ? body.toUpperCase() : body;
  };
  // %b of a float: mantissa "p" exponent, as strconv 'b'.
  const fmtBinFloat = (abs, f32) => {
    if (abs === 0) return "0p-" + (f32 ? 149 : 1074);
    const dv = new DataView(new ArrayBuffer(8));
    let mant, ex;
    if (f32) {
      dv.setFloat32(0, abs);
      const b = dv.getUint32(0);
      ex = (b >>> 23) & 0xff;
      mant = BigInt(b & 0x7fffff);
      if (ex === 0) ex++; else mant |= 1n << 23n;
      ex += -127 - 23;
    } else {
      dv.setFloat64(0, abs);
      const b = dv.getBigUint64(0);
      ex = Number((b >> 52n) & 0x7ffn);
      mant = b & 0xfffffffffffffn;
      if (ex === 0) ex++; else mant |= 1n << 52n;
      ex += -1023 - 52;
    }
    return mant.toString() + "p" + (ex >= 0 ? "+" : "") + ex;
  };
  const fmtFloat = (n, verb, fl, wid, hasWid, prec, hasPrec, f32) => {
    n = Number(n);
    if (Number.isNaN(n)) return pad(fl.plus ? "+NaN" : fl.space ? " NaN" : "NaN", fl, wid);
    const neg = n < 0 || Object.is(n, -0);
    const abs = Math.abs(n);
    if (abs === Infinity) return pad(neg ? "-Inf" : fl.space && !fl.plus ? " Inf" : "+Inf", fl, wid);
    const upper = verb === "E" || verb === "G";
    let body;
    if (verb === "x" || verb === "X") body = fmtHexFloat(abs, hasPrec ? prec : -1, verb === "X", f32);
    else if (verb === "b") body = fmtBinFloat(abs, f32);
    else if (verb === "e" || verb === "E") body = fmtE(abs, hasPrec ? prec : 6, upper);
    else if (verb === "f" || verb === "F") body = fmtF(abs, hasPrec ? prec : 6);
    else body = fmtG(abs, hasPrec ? prec : -1, upper, f32);
    const sign = neg ? "-" : fl.plus ? "+" : fl.space ? " " : "";
    if (fl.zero && !fl.minus && hasWid && wid > sign.length + body.length) {
      return sign + body.padStart(wid - sign.length, "0");
    }
    return pad(sign + body, fl, wid);
  };
  const utf8 = (s) => Array.from(new TextEncoder().encode(s));
  const fmtHex = (bytes, upper, fl, prec, hasPrec, wid) => {
    let n = bytes.length;
    if (hasPrec && prec < n) n = prec;
    const hs = bytes.slice(0, n).map((b) => {
      const h = (Number(b) & 255).toString(16).padStart(2, "0");
      return upper ? h.toUpperCase() : h;
    });
    const px = fl.sharp ? (upper ? "0X" : "0x") : "";
    return pad(hs.length === 0 ? "" : fl.space ? hs.map((h) => px + h).join(" ") : px + hs.join(""), fl, wid);
  };
  const baseOf = (t) => {
    while (t && t.k === "named") t = t.u;
    return t;
  };
  const isFloatN = (n) => n === "float32" || n === "float64";
  const isComplexN = (n) => n === "complex64" || n === "complex128";
  const IFACE = { k: "i", n: "interface {}" };
  const typeName = (t) => {
    if (t == null) return "<nil>";
    switch (t.k) {
      case "b": return t.n === "any" ? "interface {}" : t.n;
      case "named": case "i": return t.n;
      case "struct":
        if (t.n) return t.n;
        return !t.f || t.f.length === 0 ? "struct {}" : "struct { " + t.f.map(([k, ft]) => k + " " + typeName(ft ?? IFACE)).join("; ") + " }";
      case "ptr": return "*" + typeName(t.e ?? IFACE);
      case "slice": return "[]" + typeName(t.e ?? IFACE);
      case "array": return "[" + t.len + "]" + typeName(t.e ?? IFACE);
      case "map": return "map[" + typeName(t.key ?? IFACE) + "]" + typeName(t.val ?? IFACE);
      case "chan": return "chan " + typeName(t.e ?? IFACE);
      case "func": {
        const ps = (t.p ?? []).map((p) => typeName(p ?? IFACE));
        if (t.v && ps.length > 0) ps[ps.length - 1] = "..." + ps[ps.length - 1].slice(2);
        const rs = (t.r ?? []).map((r) => typeName(r ?? IFACE));
        return "func(" + ps.join(", ") + ")" + (rs.length === 0 ? "" : rs.length === 1 ? " " + rs[0] : " (" + rs.join(", ") + ")");
      }
      default: return "<nil>";
    }
  };
  const TYPED = [[Int8Array, "int8"], [Uint8Array, "uint8"], [Uint8ClampedArray, "uint8"], [Int16Array, "int16"], [Uint16Array, "uint16"], [Int32Array, "int32"], [Uint32Array, "uint32"], [Float32Array, "float32"], [Float64Array, "float64"], [BigInt64Array, "int64"], [BigUint64Array, "uint64"]];
  const isNumKey = (kd) => {
    kd = baseOf(kd);
    return kd?.k === "b" && /^(u?int|float|uintptr)/.test(kd.n);
  };
  // Best-effort type of a value that carries none (an any/interface operand).
  const descOf = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "boolean") return { k: "b", n: "bool" };
    if (typeof v === "string") return { k: "b", n: "string" };
    if (typeof v === "bigint") return { k: "b", n: "int64" };
    if (typeof v === "number") return { k: "b", n: Number.isInteger(v) ? "int" : "float64" };
    if (typeof v !== "object") return null;
    const ta = TYPED.find(([c]) => v instanceof c);
    if (ta) return { k: "slice", e: { k: "b", n: ta[1] } };
    if (Array.isArray(v)) return { k: "slice", e: v.length > 0 && v[0] != null ? descOf(v[0]) : IFACE };
    if (v instanceof Map || v.__map === true) {
      const ks = v instanceof Map ? Array.from(v.keys()) : Object.keys(v);
      const k0 = ks[0];
      const v0 = v instanceof Map ? v.get(k0) : v[k0];
      const kd = k0 === undefined ? IFACE : v instanceof Map ? descOf(k0) : k0.charCodeAt(0) === 1 && typeof __kd === "function" ? descOf(__kd(k0)) : /^-?\d+$/.test(k0) ? { k: "b", n: "int" } : { k: "b", n: "string" };
      return { k: "map", key: kd, val: k0 === undefined || v0 == null ? IFACE : descOf(v0) };
    }
    if (v._d instanceof Date) return { k: "struct", n: "time.Time", f: [] };
    if (v.re !== undefined && v.im !== undefined) return { k: "b", n: "complex128" };
    if (typeof v.__gfUnbox === "function") {
      const nm = v.constructor?.name ?? "";
      if (nm === "FmtStr" || nm === "FmtErr") return descOf(v.__gfUnbox());
      return { k: "named", n: "main." + nm.replace(/\$Ptr$/, ""), u: descOf(v.__gfUnbox()) };
    }
    const proto = Object.getPrototypeOf(v);
    if ((proto === null || Object.getPrototypeOf(proto) === null) && typeof v.Error === "function") {
      return { k: "ptr", e: { k: "struct", n: "errors.errorString", f: [] } };
    }
    if (v.constructor && v.constructor !== Object) {
      const st = { k: "struct", n: "main." + v.constructor.name.replace(/\$Ptr$/, ""), f: keys(v).map((k) => [k, descOf(v[k]) ?? IFACE]) };
      return v.__p === true ? { k: "ptr", e: st } : st;
    }
    const host = { k: "struct", n: v.__tn ?? "", f: Object.keys(v).map((k) => [k, descOf(v[k]) ?? IFACE]) };
    return v.__tn !== undefined && v.__p === true ? { k: "ptr", e: host } : host;
  };
  // The fields a struct value declares: a class that also keeps a copy of the
  // fields promoted from an embedded struct lists its own in __fk.
  const keys = (v) => v.__fk ?? Object.keys(v);
  const sortedEntries = (m, kd) => {
    const es = m instanceof Map
      ? Array.from(m.entries())
      : Object.keys(m).map((k) => [k.charCodeAt(0) === 1 && typeof __kd === "function" ? __kd(k) : isNumKey(kd) || (!kd && /^-?\d+$/.test(k)) ? Number(k) : k, m[k]]);
    const raw = (k) => (k !== null && typeof k === "object" && typeof k.__gfUnbox === "function" ? k.__gfUnbox() : k);
    return es.sort(([a], [b]) => {
      if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && typeof __kcmp === "function" && !a.__gfUnbox) return __kcmp(a, b);
      const x = raw(a), y = raw(b);
      if (typeof x === "number" && typeof y === "number") return x - y;
      const p = String(x), q = String(y);
      return p < q ? -1 : p > q ? 1 : 0;
    });
  };
  const gsBasic = (v, n) => {
    if (v === null || v === undefined) return "<nil>";
    if (typeof v === "string") return quote(v, false, '"');
    if (typeof v === "boolean") return String(v);
    if (typeof v === "object") return "(" + String(v.re) + "+" + String(v.im) + "i)";
    if (isFloatN(n)) return fmtFloat(v, "g", {}, 0, false, -1, false, n === "float32");
    if (/^u/.test(n)) return "0x" + toBig(v).toString(16);
    return String(v);
  };
  const gsComp = (v, t, nm, top, gs) => {
    if (t.k === "map") {
      const tn = nm ?? typeName(t);
      if (v == null) return tn + "(nil)";
      return tn + "{" + sortedEntries(v, t.key).map(([k, x]) => gs(k, t.key, false) + ":" + gs(x, t.val, false)).join(", ") + "}";
    }
    if (v == null) return (nm ?? typeName(t)) + "(nil)";
    const bytes = top && t.k === "slice" && t.e?.k === "b" && t.e.n === "uint8";
    const tn = nm ?? (bytes ? "[]byte" : typeName(t));
    return tn + "{" + Array.from(v).map((x) => gs(x, t.e, false)).join(", ") + "}";
  };
  // %#v: Go-syntax representation of v, whose static type is t (or unknown).
  const gs = (v, t, top) => {
    if (v !== null && typeof v === "object" && typeof v.__gfUnbox === "function") v = v.__gfUnbox();
    if (t == null) {
      if (v == null) return "<nil>";
      t = descOf(v);
    }
    switch (t.k) {
      case "i": return v == null ? typeName(t) + "(nil)" : gs(v, descOf(v), top);
      case "b": return gsBasic(v, t.n);
      case "named": {
        const u = t.u ?? descOf(v);
        return u && (u.k === "slice" || u.k === "array" || u.k === "map") ? gsComp(v, u, t.n, top, gs) : gs(v, u, top);
      }
      case "struct": {
        const f = t.f ?? keys(v ?? {}).map((k) => [k, null]);
        if (v == null) return typeName(t) + "{}";
        return typeName({ k: "struct", n: t.n, f }) + "{" + f.map(([k, ft]) => k + ":" + gs(v[k], ft, false)).join(", ") + "}";
      }
      case "ptr": {
        if (v == null) return "(" + typeName(t) + ")(nil)";
        const e = t.e;
        if (top && e && (e.k === "struct" || e.k === "slice" || e.k === "array" || e.k === "map")) return "&" + gs(v, e, false);
        return "(" + typeName(t) + ")(0xc000010000)";
      }
      case "slice": case "array": case "map": return gsComp(v, t, null, top, gs);
      default: return String(v);
    }
  };
  // both(t, s): the descriptor of a value with a static type descriptor t and a
  // Stringer descriptor s; split() undoes it.  A Stringer descriptor never has a
  // string "k", a type descriptor always does.
  const both = (t, s) => (t && s ? { $both: 1, t, s } : (t ?? s));
  const split = (fd) => (fd?.$both ? [fd.t, fd.s] : typeof fd?.k === "string" ? [fd, null] : [null, fd]);
  return { both, split, runes, pad, quote, quoteRune, runeStr, validRune, fmtInt, fmtFloat, utf8, fmtHex, baseOf, isFloatN, isComplexN, typeName, descOf, sortedEntries, gs, PRINTABLE, hex, keys, isNumKey };
})();`;

// The format-string scanner and per-verb dispatch, spliced into `__sprintf`
// after its value formatter (`formatV`) so it can use it.
export const HELPER_FMT_LOOP = String.raw`
  const U = __fmtu;
  const unbox = (v, verb) => {
    if (v && typeof v.__gfUnbox === "function" && !(typeof v.Error === "function" && "vsqxXw".includes(verb)) && !("vsqxX".includes(verb) && stringMethod(v))) return v.__gfUnbox();
    return v;
  };
  const bad = (verb, v, t) => "%!" + verb + "(" + (v === null || v === undefined ? "<nil>" : U.typeName(t ?? U.descOf(v)) + "=" + formatV(v, false, true)) + ")";
  const elemOf = (t) => {
    t = U.baseOf(t);
    return t && (t.k === "slice" || t.k === "array") ? t.e : null;
  };
  const fieldOf = (t, k) => {
    t = U.baseOf(t);
    if (t?.k === "ptr") t = U.baseOf(t.e);
    return t?.k === "struct" ? t.f?.find((x) => x[0] === k)?.[1] : null;
  };
  const fmtStr = (verb, s, fl, wid, prec, hasPrec) => {
    if (verb === "x" || verb === "X") return U.fmtHex(U.utf8(s), verb === "X", fl, prec, hasPrec, wid);
    if (hasPrec && (verb === "s" || verb === "q")) s = Array.from(s).slice(0, prec).join("");
    if (verb === "s") return U.pad(s, fl, wid);
    if (verb === "q") return U.pad(fl.sharp && !/[\x60\x00-\x08\x0a-\x1f\x7f]/.test(s) ? "\x60" + s + "\x60" : U.quote(s, fl.plus, '"'), fl, wid);
    return null;
  };
  const fmtNum = (verb, v, t, fl, wid, hasWid, prec, hasPrec) => {
    const bt = U.baseOf(t);
    const bn = bt?.k === "b" ? bt.n : "";
    const isFloatT = U.isFloatN(bn);
    const isIntT = bn !== "" && !isFloatT && !U.isComplexN(bn);
    // A number that is not an integer (or is typed as a float) is a float.
    const isFloatV = isFloatT || (!isIntT && typeof v === "number" && !Number.isInteger(v));
    if (isFloatV && (verb === "x" || verb === "X" || verb === "b")) return U.fmtFloat(v, verb, fl, wid, hasWid, prec, hasPrec, bn === "float32");
    if (isFloatV && "cqUdoO".includes(verb)) return null;
    switch (verb) {
      case "d": case "b": case "o": case "O": case "x": case "X": {
        const base = verb === "d" ? 10 : verb === "b" ? 2 : verb === "o" || verb === "O" ? 8 : 16;
        return U.fmtInt(v, base, verb === "X", verb === "O", fl, wid, hasWid, prec, hasPrec);
      }
      case "v": return isFloatV ? U.fmtFloat(v, "g", fl, wid, hasWid, prec, hasPrec, bn === "float32") : U.fmtInt(v, 10, false, false, fl, wid, hasWid, prec, hasPrec);
      case "c": return U.pad(U.runeStr(Number(v)), fl, wid);
      case "q": return U.pad(U.quoteRune(Number(v), fl.plus), fl, wid);
      case "U": {
        const c = Number(v);
        // A negative value prints as its 64-bit two's complement, as Go's uint64 conversion.
        const hx = c < 0 ? BigInt.asUintN(64, BigInt(c)).toString(16) : U.hex(c, 1);
        let s = "U+" + hx.toUpperCase().padStart(Math.max(4, hasPrec ? prec : 0), "0");
        if (fl.sharp && U.validRune(c) && U.PRINTABLE.test(String.fromCodePoint(c))) s += " '" + String.fromCodePoint(c) + "'";
        return U.pad(s, fl, wid);
      }
      case "e": case "E": case "f": case "F": case "g": case "G":
        if (isIntT) return null;
        return U.fmtFloat(v, verb, fl, wid, hasWid, prec, hasPrec, bn === "float32");
      default: return null;
    }
  };
  // A nil *T element whose Error/String has a pointer receiver is still asked
  // for its text under %s, %q, %x and %X: the descriptor carries its stand-in.
  const nilStand = (e, d, verb) => (e == null && d?.np !== undefined && "sqxX".includes(verb) ? d.np : e);
  // Applies a non-%v verb to v; composites apply it to each element, as Go does.
  // sd: Stringer descriptor of v when it is not carried by v itself (see formatV).
  const fmtv = (verb, v, t, fl, wid, hasWid, prec, hasPrec, top, sd) => {
    sd = sd ?? v?.__fd;
    if (sd?.b && v != null && !(v instanceof sd.b)) v = new sd.b(v);
    v = unbox(v, verb);
    const bt = U.baseOf(t);
    if (v === null || v === undefined) {
      if (bt?.k === "slice") v = [];
      else if (bt?.k === "map") v = {};
      // A nil *T with a String/Error method prints <nil> under %s (Go recovers
      // the nil-dereference panic); a bare null cannot tell it from a nil interface.
      else return verb === "s" || verb === "v" ? U.pad("<nil>", fl, wid) : bad(verb, v, t);
    }
    if (t?.n === "time.Duration" && "vs".includes(verb)) {
      return typeof __durationString === "function" ? __durationString(v) : String(v);
    }
    switch (typeof v) {
      case "boolean": return verb === "t" || verb === "v" ? U.pad(String(v), fl, wid) : bad(verb, v, t);
      case "string": {
        // Integer-keyed object maps hand their keys over as numeric strings.
        if (verb === "d" && (bt == null || bt.k !== "b") && /^-?\d+$/.test(v)) return fmtNum(verb, BigInt(v), null, fl, wid, hasWid, prec, hasPrec);
        return fmtStr(verb === "v" ? "s" : verb, v, fl, wid, prec, hasPrec) ?? bad(verb, v, t);
      }
      case "number": case "bigint": return fmtNum(verb, v, t, fl, wid, hasWid, prec, hasPrec) ?? bad(verb, v, t);
      default: break;
    }
    if ("vsqxX".includes(verb)) {
      const sm = stringMethod(v);
      if (sm) return fmtStr(verb === "v" ? "s" : verb, String(callMethod(v, sm)), fl, wid, prec, hasPrec);
    }
    if ("re" in v && "im" in v) {
      if (verb === "v") verb = "g";
      if (!"eEfFgG".includes(verb)) return bad(verb, v, t);
      const one = (n, pl) => U.fmtFloat(n, verb, pl ? { ...fl, plus: true } : fl, wid, hasWid, prec, hasPrec, false);
      return "(" + one(v.re, false) + one(v.im, true) + "i)";
    }
    if (v._d instanceof Date) return formatV(v, false, true);
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const items = Array.from(v);
      // The WASM host hands []byte over as a plain array, so an array of byte-sized
      // numbers of unknown element type is taken for bytes under %s, %x and %X.
      const et0 = elemOf(t);
      const bn0 = U.baseOf(et0);
      const isBytes = v instanceof Uint8Array || (et0 == null && "sqxX".includes(verb) && items.every((e) => Number.isInteger(e) && e >= 0 && e < 256)) || (bn0?.k === "b" && bn0.n === "uint8" && "sqxX".includes(verb));
      if (isBytes && "sqxX".includes(verb)) {
        if (verb === "x" || verb === "X") return U.fmtHex(items, verb === "X", fl, prec, hasPrec, wid);
        return fmtStr(verb, new TextDecoder().decode(Uint8Array.from(items)), fl, wid, prec, hasPrec);
      }
      const et = elemOf(t);
      if (v.__ptr_slice === true) items.forEach(markPtr);
      return "[" + items.map((e) => fmtv(verb, nilStand(e, sd?.e, verb), et, fl, wid, hasWid, prec, hasPrec, false, sd?.e)).join(" ") + "]";
    }
    if (v instanceof Map || v.__map === true || U.baseOf(t)?.k === "map") {
      const bm = U.baseOf(t);
      const kt = bm?.k === "map" ? bm.key : null;
      const vt = bm?.k === "map" ? bm.val : null;
      const entries = U.sortedEntries(v, kt);
      if (v.__ptr_map === true) entries.forEach(([, x]) => markPtr(x));
      return "map[" + entries.map(([k, x]) => fmtv(verb, k, kt, fl, wid, hasWid, prec, hasPrec, false, sd?.k) + ":" + fmtv(verb, nilStand(x, sd?.v, verb), vt, fl, wid, hasWid, prec, hasPrec, false, sd?.v)).join(" ") + "]";
    }
    if (isPointer(v) && !top) return getPtr(v);
    const ff = typeof v.__ff === "function" ? v.__ff() : (sd?.ff ?? null);
    const body = U.keys(v).map((k) => fmtv(verb, nilStand(v[k], ff?.[k], verb), fieldOf(t, k), fl, wid, hasWid, prec, hasPrec, false, ff?.[k])).join(" ");
    return (isPointer(v) ? "&{" : "{") + body + "}";
  };
  const typedArg = (x) => (x instanceof __FT ? { v: x.v, t: x.t } : { v: x, t: null });
  let out = "";
  let argNum = 0;
  let reordered = false;
  let good = true;
  const argIndex = (p, afterIdx) => {
    if (f[p] !== "[") return [p, false];
    reordered = true;
    const m = /^\[(\d+)\]/.exec(f.slice(p));
    if (!m) {
      const close = f.indexOf("]", p);
      good = false;
      return [close < 0 ? p + 1 : close + 1, true];
    }
    const n = Number(m[1]);
    if (n < 1 || n > a.length) good = false;
    else argNum = n - 1;
    return [p + m[0].length, true];
  };
  const intArg = () => {
    if (argNum >= a.length) return null;
    const x = typedArg(a[argNum++]).v;
    return typeof x === "number" && Number.isInteger(x) && Math.abs(x) <= 1e6 ? x : null;
  };
  for (let p = 0; p < f.length;) {
    const pct = f.indexOf("%", p);
    if (pct < 0) { out += f.slice(p); break; }
    out += f.slice(p, pct);
    p = pct + 1;
    const fl = { plus: false, minus: false, sharp: false, space: false, zero: false };
    for (; p < f.length; p++) {
      const c = f[p];
      if (c === "#") fl.sharp = true;
      else if (c === "0") fl.zero = true;
      else if (c === "+") fl.plus = true;
      else if (c === "-") fl.minus = true;
      else if (c === " ") fl.space = true;
      else break;
    }
    good = true;
    let after;
    [p, after] = argIndex(p, false);
    let wid = 0, hasWid = false, prec = 0, hasPrec = false;
    if (f[p] === "*") {
      p++;
      const w = intArg();
      if (w === null) out += "%!(BADWIDTH)";
      else { wid = w; hasWid = true; }
      if (wid < 0) { wid = -wid; fl.minus = true; }
      after = false;
    } else {
      const m = /^\d+/.exec(f.slice(p));
      if (m) { wid = Number(m[0]); hasWid = true; p += m[0].length; if (after) good = false; }
    }
    if (f[p] === ".") {
      p++;
      if (after) good = false;
      [p, after] = argIndex(p, false);
      if (f[p] === "*") {
        p++;
        const q = intArg();
        if (q === null) out += "%!(BADPREC)";
        else if (q >= 0) { prec = q; hasPrec = true; }
        after = false;
      } else {
        const m = /^\d+/.exec(f.slice(p));
        if (m) { prec = Number(m[0]); p += m[0].length; }
        hasPrec = true;
      }
    }
    if (!after) [p, after] = argIndex(p, false);
    if (p >= f.length) { out += "%!(NOVERB)"; break; }
    const cp = f.codePointAt(p);
    const verb = String.fromCodePoint(cp);
    p += verb.length;
    if (verb === "%") { out += "%"; continue; }
    if (!good) { out += "%!" + verb + "(BADINDEX)"; continue; }
    if (argNum >= a.length) { out += "%!" + verb + "(MISSING)"; continue; }
    let { v, t } = typedArg(a[argNum++]);
    if (v === null || v === undefined) {
      const bt0 = U.baseOf(t);
      if (bt0?.k === "slice" && verb === "v" && fl.sharp) { out += U.typeName(t) + "(nil)"; continue; }
    }
    sharp = verb === "v" && fl.sharp;
    // The stand-in for a nil pointer with a pointer-receiver String/Error only serves %v and %s.
    if (v && v.__nilp === true && !(verb === "s" || verb === "q" || (verb === "v" && !sharp))) v = null;
    if (verb === "T") { out += U.pad(U.typeName(t ?? U.descOf(unbox(v, "T"))), fl, wid); continue; }
    if (verb === "v" && hasPrec && !sharp) {
      // A precision applies to each scalar (%.3v of 3.14159 is 3.14, of "abc" is abc cut to 3 runes).
      out += fmtv("v", v, t, fl, wid, hasWid, prec, hasPrec, true);
      continue;
    }
    if (verb === "v") {
      if (v === null || v === undefined) {
        const bt0 = U.baseOf(t);
        v = bt0?.k === "slice" ? [] : v;
      }
      const vStr = t?.n === "time.Duration" && typeof __durationString === "function" ? __durationString(v) : formatV(unbox(v, "v"), fl.plus, true, false, U.both(t, v?.__fd));
      out += U.pad(sharp ? U.gs(v, t, true) : vStr, fl, wid);
      continue;
    }
    if (verb === "w") {
      out += U.pad(String(v == null ? "<nil>" : typeof v === "object" && v.Error ? v.Error() : v), fl, wid);
      continue;
    }
    if (verb === "p") { out += bad("p", v, t); continue; }
    if (!"bcdoOqxXUeEfFgGstp".includes(verb)) { out += bad(verb, v, t); continue; }
    out += fmtv(verb, v, t, fl, wid, hasWid, prec, hasPrec, true);
  }
  if (!reordered && argNum < a.length) {
    out += "%!(EXTRA " + a.slice(argNum).map((x) => {
      const y = typedArg(x);
      return y.v === null || y.v === undefined ? "<nil>" : U.typeName(y.t ?? U.descOf(y.v)) + "=" + formatV(y.v, false, true);
    }).join(", ") + ")";
  }
  return out;
};`;
