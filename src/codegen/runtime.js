// Runtime helpers emitted by the code generator when the corresponding feature is used.
// Each export is a single JS statement (var __x = __x || function(...){...};) so that
// multiple compiled files bundled together can safely repeat the declaration.

export const HELPER_LEN = `var __len = __len || function(a) {
  if (a && typeof a === 'object' && !Array.isArray(a)) return Object.keys(a).length;
  return a?.length ?? 0;
};`;

export const HELPER_APPEND =
	"var __append = __append || function(a, ...b) { return a ? [...a, ...b] : b; };";

export const HELPER_S = "var __s = __s || function(a) { return a || []; };";

export const HELPER_EQUAL = `var __equal = __equal || function __equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
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

export const HELPER_SPRINTF = `var __sprintf = __sprintf || function(f, ...a) {
  let i = 0;
  return f.replace(/%([#+\\- 0]*)([0-9]*)\\.?([0-9]*)[sdvftxXqobeEgGw%]/g, (m) => {
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
      case "d": return pad(String(Math.trunc(Number(v))), width, zero);
      case "v": {
        if (typeof v === "object" && v !== null && "re" in v && "im" in v) {
          const sign = v.im >= 0 ? "+" : "";
          return pad("(" + v.re + sign + v.im + "i)", width, false);
        }
        return pad(String(v == null ? "<nil>" : v), width, false);
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
};`;

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
