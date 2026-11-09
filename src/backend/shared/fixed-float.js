// The host half of strconv's fixed-point float formatting: a JS function,
// as source text, that both backends embed (src/backend/js/natives.js and the
// WASM host imports in src/backend/wasm/boundary.js).
//
// `toFixed` is exact except that it rounds a tie (a value whose decimal
// expansion ends in a 5 right after the digits kept) up, where Go rounds it
// to even; the extra digits of a second call tell the two apart. "" declines.
export const FIXED_FLOAT_JS = `(x, p) => {
  if (!(x < 1e21)) return "";
  const s = x.toFixed(p);
  const t = x.toFixed(p + 30);
  const dot = t.indexOf(".");
  if (/^50*$/.test(t.slice(dot + 1 + p))) {
    const down = t.slice(0, p === 0 ? dot : dot + 1 + p);
    return (down.charCodeAt(down.length - 1) - 48) % 2 === 0 ? down : s;
  }
  return s;
}`;
