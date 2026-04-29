// CodeGen stdlib call generation methods — installed as a mixin on CodeGen.prototype.
// Handles all built-in package call codegen: fmt, strings, bytes, math, time, etc.

// ── Builder method dispatch tables ──────────────────────────────────
const BUILDER_STR = {
	WriteString: (b, a) => `(${b}._buf += ${a[0]}, [${a[0]}.length, null])`,
	WriteByte: (b, a) => `(${b}._buf += String.fromCodePoint(${a[0]}))`,
	Write: (b, a) => `(${b}._buf += String.fromCharCode(...${a[0]}))`,
	String: (b) => `${b}._buf`,
	Reset: (b) => `(${b}._buf = "")`,
};
const BUILDER_BYTES = {
	WriteString: (b, a) =>
		`(${b}._buf.push(...new TextEncoder().encode(${a[0]})), [${a[0]}.length, null])`,
	WriteByte: (b, a) => `${b}._buf.push(${a[0]})`,
	Write: (b, a) => `(${b}._buf.push(...${a[0]}), [${a[0]}.length, null])`,
	String: (b) => `new TextDecoder().decode(new Uint8Array(${b}._buf))`,
	Reset: (b) => `(${b}._buf = [])`,
};
const BUILDER_COMMON = {
	WriteRune: (b, a) => `(${b}._buf += String.fromCodePoint(${a[0]}))`,
	Bytes: (b) => `${b}._buf.slice()`,
	Len: (b) => `${b}._buf.length`,
	Grow: () => "undefined",
};

// ── Regexp method dispatch ───────────────────────────────────────────
const REGEXP_METHOD = {
	MatchString: (re, a) => `${re}.test(${a[0]})`,
	FindString: (re, a) => `(${re}.exec(${a[0]})?.[0] ?? "")`,
	FindStringIndex: (re, a) =>
		`((m => m ? [m.index, m.index + m[0].length] : null)(${re}.exec(${a[0]})))`,
	FindAllString: (re, a) =>
		`[...${a[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${a[1]} < 0 ? undefined : ${a[1]}).map(m => m[0])`,
	FindStringSubmatch: (re, a) => `[...(${re}.exec(${a[0]}) ?? [])]`,
	FindAllStringSubmatch: (re, a) =>
		`[...${a[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${a[1]} < 0 ? undefined : ${a[1]}).map(m => [...m])`,
	ReplaceAllString: (re, a) =>
		`${a[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${a[1]})`,
	ReplaceAllLiteralString: (re, a) =>
		`${a[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${a[1]}.replace(/\\$/g, '$$$$'))`,
	Split: (re, a) =>
		`${a[0]}.split(${re}).slice(0, ${a[1]} < 0 ? undefined : ${a[1]})`,
	String: (re) => `${re}.source`,
};

// ── Slices dispatch ──────────────────────────────────────────────────
const SLICES_DISPATCH = {
	Contains: (a) => `${a[0]}.includes(${a[1]})`,
	Index: (a) => `${a[0]}.indexOf(${a[1]})`,
	Compare: (a) =>
		`((a, b) => { for (let i = 0; i < a.length && i < b.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return a.length - b.length; })(${a[0]}, ${a[1]})`,
	Sort: (a) => `${a[0]}.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)`,
	SortFunc: (a) => `${a[0]}.sort(${a[1]})`,
	SortStableFunc: (a) => `${a[0]}.sort(${a[1]})`,
	IsSorted: (a) =>
		`((s) => { for (let i = 1; i < s.length; i++) { if (s[i] < s[i-1]) return false; } return true; })(${a[0]})`,
	IsSortedFunc: (a) =>
		`((s, f) => { for (let i = 1; i < s.length; i++) { if (f(s[i], s[i-1]) < 0) return false; } return true; })(${a[0]}, ${a[1]})`,
	Reverse: (a) => `${a[0]}.reverse()`,
	Max: (a) => `Math.max(...${a[0]})`,
	Min: (a) => `Math.min(...${a[0]})`,
	MaxFunc: (a) =>
		`((s, f) => s.reduce((m, x) => f(x, m) > 0 ? x : m))(${a[0]}, ${a[1]})`,
	MinFunc: (a) =>
		`((s, f) => s.reduce((m, x) => f(x, m) < 0 ? x : m))(${a[0]}, ${a[1]})`,
	Clone: (a) => `${a[0]}.slice()`,
	Compact: (a) =>
		`((s) => s.filter((v, i) => i === 0 || v !== s[i-1]))(${a[0]})`,
	CompactFunc: (a) =>
		`((s, f) => s.filter((v, i) => i === 0 || !f(v, s[i-1])))(${a[0]}, ${a[1]})`,
	Concat: (a) => `[].concat(${a.join(", ")})`,
	Delete: (a) => `[...${a[0]}.slice(0, ${a[1]}), ...${a[0]}.slice(${a[2]})]`,
	DeleteFunc: (a) => `${a[0]}.filter((v) => !${a[1]}(v))`,
	Insert: (a) =>
		`[...${a[0]}.slice(0, ${a[1]}), ${a.slice(2).join(", ")}, ...${a[0]}.slice(${a[1]})]`,
	Replace: (a) =>
		`[...${a[0]}.slice(0, ${a[1]}), ${a.slice(3).join(", ")}, ...${a[0]}.slice(${a[2]})]`,
	Grow: (a) => `${a[0]}.slice()`,
	Clip: (a) => `${a[0]}.slice()`,
};

// ── Strings dispatch ─────────────────────────────────────────────────
const STRINGS_M1 = {
	ToUpper: "toUpperCase",
	ToLower: "toLowerCase",
	TrimSpace: "trim",
	ToTitle: "toUpperCase",
};
const STRINGS_M2 = {
	Contains: "includes",
	HasPrefix: "startsWith",
	HasSuffix: "endsWith",
	Index: "indexOf",
	LastIndex: "lastIndexOf",
	Repeat: "repeat",
	Split: "split",
	Join: "join",
};
const STRINGS_DISPATCH = {
	Count: ([s, s2]) =>
		`((s, sep) => sep === "" ? s.length + 1 : s.split(sep).length - 1)(${s}, ${s2})`,
	Replace: ([s, s2, s3]) => `${s}.replace(${s2}, ${s3})`,
	ReplaceAll: ([s, s2, s3]) => `${s}.replaceAll(${s2}, ${s3})`,
	Trim: ([s, s2]) =>
		`${s}.replace(new RegExp(\`^[\${${s2}}]+|[\${${s2}}]+$\`, "g"), "")`,
	TrimPrefix: ([s, s2]) =>
		`((s, pre) => s.startsWith(pre) ? s.slice(pre.length) : s)(${s}, ${s2})`,
	TrimSuffix: ([s, s2]) =>
		`((s, suf) => !suf.length || !s.endsWith(suf) ? s : s.slice(0, -suf.length))(${s}, ${s2})`,
	TrimLeft: ([s, s2]) => `${s}.replace(new RegExp(\`^[\${${s2}}]+\`), "")`,
	TrimRight: ([s, s2]) => `${s}.replace(new RegExp(\`[\${${s2}}]+$\`), "")`,
	EqualFold: ([s, s2]) => `${s}.toLowerCase() === ${s2}.toLowerCase()`,
	Fields: ([s]) => `(${s}).trim() === '' ? [] : (${s}).trim().split(/\\s+/)`,
	Cut: ([s, s2]) =>
		`((s, sep) => { const i = s.indexOf(sep); return i < 0 ? [s, "", false] : [s.slice(0, i), s.slice(i + sep.length), true]; })(${s}, ${s2})`,
	CutPrefix: ([s, s2]) =>
		`(${s}).startsWith(${s2}) ? [(${s}).slice((${s2}).length), true] : [${s}, false]`,
	CutSuffix: ([s, s2]) =>
		`(${s}).endsWith(${s2}) ? [(${s}).slice(0, -(${s2}).length), true] : [${s}, false]`,
	SplitN: ([s, s2, s3]) =>
		`((s, sep, n) => { if (n === 0) return []; if (n < 0) return s.split(sep); const r = []; let cur = s; for (let i = 1; i < n && cur.length; i++) { const j = cur.indexOf(sep); if (j < 0) break; r.push(cur.slice(0, j)); cur = cur.slice(j + sep.length); } r.push(cur); return r; })(${s}, ${s2}, ${s3})`,
	SplitAfter: ([s, s2]) =>
		`((s, sep) => { if (sep === "") return [...s]; const r = []; let cur = s; while (cur.length) { const j = cur.indexOf(sep); if (j < 0) { r.push(cur); break; } r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } return r; })(${s}, ${s2})`,
	SplitAfterN: ([s, s2, s3]) =>
		`((s, sep, n) => { if (n === 0) return []; if (n < 0 || sep === "") return ((s, sep) => { if (sep === "") return [...s]; const r = []; let cur = s; while (cur.length) { const j = cur.indexOf(sep); if (j < 0) { r.push(cur); break; } r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } return r; })(s, sep); const r = []; let cur = s; for (let i = 1; i < n && cur.length; i++) { const j = cur.indexOf(sep); if (j < 0) break; r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } r.push(cur); return r; })(${s}, ${s2}, ${s3})`,
	IndexAny: ([s, s2]) =>
		`((s, chars) => { let m = -1; for (const c of chars) { const i = s.indexOf(c); if (i >= 0 && (m < 0 || i < m)) m = i; } return m; })(${s}, ${s2})`,
	LastIndexAny: ([s, s2]) =>
		`((s, chars) => { let m = -1; for (const c of chars) { const i = s.lastIndexOf(c); if (i > m) m = i; } return m; })(${s}, ${s2})`,
	ContainsAny: ([s, s2]) => `[...(${s2})].some(c => (${s}).includes(c))`,
	ContainsRune: ([s, s2]) => `(${s}).includes(String.fromCodePoint(${s2}))`,
	IndexRune: ([s, s2]) => `(${s}).indexOf(String.fromCodePoint(${s2}))`,
	IndexByte: ([s, s2]) => `(${s}).indexOf(String.fromCharCode(${s2}))`,
	LastIndexByte: ([s, s2]) => `(${s}).lastIndexOf(String.fromCharCode(${s2}))`,
	Map: ([s, s2]) =>
		`[...(${s2})].map(c => String.fromCodePoint((${s})(c.codePointAt(0)))).join("")`,
	Title: ([s]) => `(${s}).replace(/\\b\\w/g, c => c.toUpperCase())`,
	TrimFunc: ([s, s2]) =>
		`((s, f) => { let l = 0, r = s.length; while (l < r && f(s.codePointAt(l))) l++; while (r > l && f(s.codePointAt(r - 1))) r--; return s.slice(l, r); })(${s}, ${s2})`,
	TrimLeftFunc: ([s, s2]) =>
		`((s, f) => { let l = 0; while (l < s.length && f(s.codePointAt(l))) l++; return s.slice(l); })(${s}, ${s2})`,
	TrimRightFunc: ([s, s2]) =>
		`((s, f) => { let r = s.length; while (r > 0 && f(s.codePointAt(r - 1))) r--; return s.slice(0, r); })(${s}, ${s2})`,
	IndexFunc: ([s, s2]) =>
		`((s, f) => { for (let i = 0; i < s.length; i++) { const cp = s.codePointAt(i); if (f(cp)) return i; if (cp > 0xFFFF) i++; } return -1; })(${s}, ${s2})`,
	LastIndexFunc: ([s, s2]) =>
		`((s, f) => { for (let i = s.length - 1; i >= 0; i--) { const cp = s.codePointAt(i); if (f(cp)) return i; } return -1; })(${s}, ${s2})`,
	NewReader: ([s]) =>
		`{_src: ${s}, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src.charCodeAt(this._pos + i); this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(s) { this._src = s; this._pos = 0; }}`,
	NewReplacer: (args) =>
		`((...pairs) => { const p = []; for (let i = 0; i < pairs.length; i += 2) p.push([pairs[i], pairs[i+1]]); return { _p: p, Replace(s) { let r = s; for (const [o, n] of this._p) r = r.split(o).join(n); return r; } }; })(${args.join(", ")})`,
};

// ── Bytes dispatch ───────────────────────────────────────────────────
const __bs = `(b => String.fromCharCode(...b))`;
const __sb = `(s => [...s].map(c => c.charCodeAt(0)))`;
const BYTES_DISPATCH = {
	Contains: (a) => `${__bs}(${a[0]}).includes(${__bs}(${a[1]}))`,
	HasPrefix: (a) =>
		`((b, p) => { for (let i = 0; i < p.length; i++) if (b[i] !== p[i]) return false; return b.length >= p.length; })(${a[0]}, ${a[1]})`,
	HasSuffix: (a) =>
		`((b, s) => { const off = b.length - s.length; if (off < 0) return false; for (let i = 0; i < s.length; i++) if (b[off + i] !== s[i]) return false; return true; })(${a[0]}, ${a[1]})`,
	Index: (a) => `${__bs}(${a[0]}).indexOf(${__bs}(${a[1]}))`,
	Count: (a) =>
		`((b, sep) => sep.length === 0 ? b.length + 1 : ${__bs}(b).split(${__bs}(sep)).length - 1)(${a[0]}, ${a[1]})`,
	Repeat: (a) => `${__sb}(${__bs}(${a[0]}).repeat(${a[1]}))`,
	Replace: (a) =>
		`((b, o, n, cnt) => { let s = ${__bs}(b), os = ${__bs}(o), ns = ${__bs}(n); if (cnt < 0) return ${__sb}(s.replaceAll(os, ns)); for (let i = 0; i < cnt; i++) s = s.replace(os, ns); return ${__sb}(s); })(${a[0]}, ${a[1]}, ${a[2]}, ${a[3]})`,
	ToUpper: (a) => `${__sb}(${__bs}(${a[0]}).toUpperCase())`,
	ToLower: (a) => `${__sb}(${__bs}(${a[0]}).toLowerCase())`,
	TrimSpace: (a) => `${__sb}(${__bs}(${a[0]}).trim())`,
	Trim: (a) =>
		`${__sb}(${__bs}(${a[0]}).replace(new RegExp(\`^[\${${a[1]}}]+|[\${${a[1]}}]+$\`, "g"), ""))`,
	Equal: (a) =>
		`((a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; })(${a[0]}, ${a[1]})`,
	Split: (a) => `${__bs}(${a[0]}).split(${__bs}(${a[1]})).map(p => ${__sb}(p))`,
	Join: (a) => `${__sb}(${a[0]}.map(p => ${__bs}(p)).join(${__bs}(${a[1]})))`,
	ReplaceAll: (a) =>
		`((b, o, n) => { const r = []; let i = 0; while (i <= b.length - o.length) { if (o.every((v, j) => b[i + j] === v)) { r.push(...n); i += o.length; } else r.push(b[i++]); } return r.concat(b.slice(i)); })(${a[0]}, ${a[1]}, ${a[2]})`,
	TrimPrefix: (a) =>
		`((b, p) => p.every((v, i) => b[i] === v) ? b.slice(p.length) : b.slice())(${a[0]}, ${a[1]})`,
	TrimSuffix: (a) =>
		`((b, s) => s.length && s.every((v, i) => b[b.length - s.length + i] === v) ? b.slice(0, -s.length) : b.slice())(${a[0]}, ${a[1]})`,
	TrimLeft: (a) =>
		`((b, c) => { let i = 0; while (i < b.length && c.includes(String.fromCharCode(b[i]))) i++; return b.slice(i); })(${a[0]}, ${a[1]})`,
	TrimRight: (a) =>
		`((b, c) => { let i = b.length; while (i > 0 && c.includes(String.fromCharCode(b[i - 1]))) i--; return b.slice(0, i); })(${a[0]}, ${a[1]})`,
	TrimFunc: (a) =>
		`((b, f) => { let l = 0, r = b.length; while (l < r && f(b[l])) l++; while (r > l && f(b[r - 1])) r--; return b.slice(l, r); })(${a[0]}, ${a[1]})`,
	IndexByte: (a) => `(${a[0]}).indexOf(${a[1]})`,
	LastIndex: (a) =>
		`((b, s) => { for (let i = b.length - s.length; i >= 0; i--) if (s.every((v, j) => b[i + j] === v)) return i; return -1; })(${a[0]}, ${a[1]})`,
	LastIndexByte: (a) => `(${a[0]}).lastIndexOf(${a[1]})`,
	Fields: (a) =>
		`((b) => { const s = String.fromCharCode(...b).trim(); return s === '' ? [] : s.split(/\\s+/).map(w => [...w].map(c => c.charCodeAt(0))); })(${a[0]})`,
	Cut: (a) =>
		`((b, sep) => { for (let i = 0; i <= b.length - sep.length; i++) if (sep.every((v, j) => b[i + j] === v)) return [b.slice(0, i), b.slice(i + sep.length), true]; return [b.slice(), [], false]; })(${a[0]}, ${a[1]})`,
	ContainsAny: (a) =>
		`[...(${a[1]})].some(c => (${a[0]}).includes(c.charCodeAt(0)))`,
	ContainsRune: (a) => `(${a[0]}).includes(${a[1]})`,
	Map: (a) => `(${a[1]}).map(v => (${a[0]})(v))`,
	SplitN: (a) =>
		`((b, sep, n) => { if (n === 0) return []; if (n < 0) return ((b, sep) => { const r = []; let i = 0; while (i <= b.length) { const j = b.findIndex((_, k) => k >= i && sep.every((v, l) => b[k + l] === sep[l])); if (j < 0 || j >= b.length) break; r.push(b.slice(i, j)); i = j + sep.length; } r.push(b.slice(i)); return r; })(b, sep); const r = []; let i = 0; for (let c = 1; c < n; c++) { const j = b.findIndex((_, k) => k >= i && sep.every((v, l) => b[k + l] === sep[l])); if (j < 0) break; r.push(b.slice(i, j)); i = j + sep.length; } r.push(b.slice(i)); return r; })(${a[0]}, ${a[1]}, ${a[2]})`,
	NewReader: (a) =>
		`{_src: ${a[0]}, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src[this._pos + i]; this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(b) { this._src = b; this._pos = 0; }}`,
};

// ── Strconv dispatch ──────────────────────────────────────────────────
const STRCONV_DISPATCH = {
	Itoa: (a) => `String(${a[0]})`,
	Atoi: (a) =>
		`(Number.isNaN(Number(${a[0]})) ? [0, "invalid syntax"] : [Number(${a[0]}) | 0, null])`,
	FormatBool: (a) => `String(${a[0]})`,
	FormatInt: (a) => `(${a[0]}).toString(${a[1]})`,
	FormatFloat: (a) => `String(${a[0]})`,
	ParseFloat: (a) =>
		`(Number.isNaN(Number(${a[0]})) ? [0, "invalid syntax"] : [Number(${a[0]}), null])`,
	ParseInt: (a) =>
		`(Number.isNaN(parseInt(${a[0]}, ${a[1]} || 10)) ? [0, "invalid syntax"] : [parseInt(${a[0]}, ${a[1]} || 10), null])`,
	ParseBool: (a) =>
		`(${a[0]} === "true" || ${a[0]} === "1" ? [true, null] : ${a[0]} === "false" || ${a[0]} === "0" ? [false, null] : [false, "invalid syntax"])`,
	Quote: (a) => `JSON.stringify(${a[0]})`,
	Unquote: (a) =>
		`((s) => { try { const v = JSON.parse(s); return [v, null]; } catch(e) { return ["", "invalid syntax"]; } })(${a[0]})`,
	AppendInt: (a) =>
		`[...(${a[0]}), ...new TextEncoder().encode((${a[1]}).toString(${a[2]}))]`,
	AppendFloat: (a) =>
		`[...(${a[0]}), ...new TextEncoder().encode(${a[1]}.toFixed(${a[3]} < 0 ? 6 : ${a[3]}))]`,
};

// ── Sort dispatch ─────────────────────────────────────────────────────
const SORT_DISPATCH = {
	Ints: (a) => `${a[0]}.sort((a, b) => a - b)`,
	Float64s: (a) => `${a[0]}.sort((a, b) => a - b)`,
	Strings: (a) => `${a[0]}.sort()`,
	Slice: (a) =>
		`${a[0]}.sort((a, b) => ${a[1]}(a, b) ? -1 : ${a[1]}(b, a) ? 1 : 0)`,
	SliceStable: (a) =>
		`${a[0]}.sort((a, b) => ${a[1]}(a, b) ? -1 : ${a[1]}(b, a) ? 1 : 0)`,
	SliceIsSorted: (a) =>
		`${a[0]}.every((v, i, a) => i === 0 || ${a[1]}(a[i - 1], v))`,
	Search: (a) =>
		`((n, f) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >>> 1; if (f(mid)) hi = mid; else lo = mid + 1; } return lo; })(${a[0]}, ${a[1]})`,
	IntsAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
	Float64sAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
	StringsAreSorted: (a) =>
		`(${a[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`,
};

// ── Math dispatch ─────────────────────────────────────────────────────
const MATH1 = {
	Abs: "abs",
	Floor: "floor",
	Ceil: "ceil",
	Round: "round",
	Sqrt: "sqrt",
	Cbrt: "cbrt",
	Log: "log",
	Log2: "log2",
	Log10: "log10",
	Sin: "sin",
	Cos: "cos",
	Tan: "tan",
	Atan: "atan",
	Asin: "asin",
	Acos: "acos",
	Exp: "exp",
	Trunc: "trunc",
};
const MATH2 = {
	Pow: "pow",
	Min: "min",
	Max: "max",
	Atan2: "atan2",
	Hypot: "hypot",
};
const MATH_EXTRA = {
	Mod: ([x, y]) => `${x} % ${y}`,
	Inf: ([x]) => `(${x} >= 0 ? Infinity : -Infinity)`,
	IsNaN: ([x]) => `Number.isNaN(${x})`,
	IsInf: ([x, y]) =>
		`(${y} > 0 ? ${x} === Infinity : ${y} < 0 ? ${x} === -Infinity : !Number.isFinite(${x}))`,
	NaN: () => "NaN",
	Exp2: ([x]) => `Math.pow(2, ${x})`,
	Signbit: ([x]) => `(${x} < 0 || Object.is(${x}, -0))`,
	Copysign: ([x, y]) =>
		`(Math.abs(${x}) * (${y} < 0 || Object.is(${y}, -0) ? -1 : 1))`,
	Dim: ([x, y]) => `Math.max(${x} - ${y}, 0)`,
	Remainder: ([x, y]) => `(${x} - Math.round(${x} / ${y}) * ${y})`,
};

// ── Unicode dispatch ──────────────────────────────────────────────────
// (built lazily per-call since values depend on the runtime arg expression)

// ── Time method dispatch ──────────────────────────────────────────────
const TIME_METHOD_DISPATCH = {
	Year: (r) => `${r}._d.getFullYear()`,
	Month: (r) => `${r}._d.getMonth() + 1`,
	Day: (r) => `${r}._d.getDate()`,
	Hour: (r) => `${r}._d.getHours()`,
	Minute: (r) => `${r}._d.getMinutes()`,
	Second: (r) => `${r}._d.getSeconds()`,
	Weekday: (r) => `${r}._d.getDay()`,
	Unix: (r) => `Math.floor(${r}._d.getTime() / 1000)`,
	UnixMilli: (r) => `${r}._d.getTime()`,
	Add: (r, a) => `{_d: new Date(${r}._d.getTime() + (${a[0]}))}`,
	Sub: (r, a) => `${r}._d.getTime() - (${a[0]})._d.getTime()`,
	Before: (r, a) => `${r}._d < (${a[0]})._d`,
	After: (r, a) => `${r}._d > (${a[0]})._d`,
	Equal: (r, a) => `${r}._d.getTime() === (${a[0]})._d.getTime()`,
};

// ── Time function dispatch ────────────────────────────────────────────
const TIME_DISPATCH = {
	Now: () => "{_d: new Date()}",
	Since: (a) => `(Date.now() - (${a[0]})._d.getTime())`,
	Sleep: (a) => `await new Promise(r => setTimeout(r, ${a[0]} / 1000000))`,
	Unix: (a) => `{_d: new Date((${a[0]}) * 1000)}`,
	Date: (a) =>
		`{_d: new Date(${a[0]}, ${a[1]} - 1, ${a[2]}, ${a[3]}, ${a[4]}, ${a[5]})}`,
};

// ── Rand dispatch ─────────────────────────────────────────────────────
const RAND_DISPATCH = {
	Intn: (a) => `Math.floor(Math.random() * ${a[0]})`,
	Int63n: (a) => `Math.floor(Math.random() * ${a[0]})`,
	Int31n: (a) => `Math.floor(Math.random() * ${a[0]})`,
	Float64: () => "Math.random()",
	Float32: () => "Math.random()",
	Int: () => "Math.floor(Math.random() * 2147483647)",
	Int31: () => "Math.floor(Math.random() * 2147483647)",
	Int63: () => "Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)",
	Seed: () => "(void 0)",
	Shuffle: (a) =>
		`((n, f) => { for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); f(i, j); } })(${a[0]}, ${a[1]})`,
	Perm: (a) =>
		`((n) => { const a = Array.from({length: n}, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; })(${a[0]})`,
};

// ── Utf8 dispatch ─────────────────────────────────────────────────────
const UTF8_DISPATCH = {
	RuneCountInString: (a) => `[...(${a[0]})].length`,
	RuneLen: (a) =>
		`((r) => r < 0 ? -1 : r <= 0x7F ? 1 : r <= 0x7FF ? 2 : r <= 0xFFFF ? (r >= 0xD800 && r <= 0xDFFF ? -1 : 3) : r <= 0x10FFFF ? 4 : -1)(${a[0]})`,
	ValidString: (a) =>
		`/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/.test(${a[0]}) === false`,
	ValidRune: (a) =>
		`(${a[0]}) >= 0 && (${a[0]}) <= 0x10FFFF && !((${a[0]}) >= 0xD800 && (${a[0]}) <= 0xDFFF)`,
	DecodeRuneInString: (a) =>
		`((s) => { if (!s) return [0xFFFD, 0]; const cp = s.codePointAt(0); return [cp, cp > 0xFFFF ? 2 : 1]; })(${a[0]})`,
	DecodeLastRuneInString: (a) =>
		`((s) => { if (!s) return [0xFFFD, 0]; const i = s.length > 1 && s.charCodeAt(s.length - 1) >= 0xDC00 && s.charCodeAt(s.length - 1) <= 0xDFFF ? s.length - 2 : s.length - 1; const cp = s.codePointAt(i); return [cp, cp > 0xFFFF ? 2 : 1]; })(${a[0]})`,
	FullRuneInString: (a) => `(${a[0]}).length > 0`,
};

// ── Path dispatch ─────────────────────────────────────────────────────
const PATH_DISPATCH = {
	Base: (a) =>
		`((p) => { if (!p) return "."; const stripped = p.replace(/\\/+$/, ""); if (!stripped) return "/"; const i = stripped.lastIndexOf("/"); return i < 0 ? stripped : stripped.slice(i + 1) || "/"; })(${a[0]})`,
	Dir: (a) =>
		`((p) => { const i = p.lastIndexOf("/"); if (i < 0) return "."; if (i === 0) return "/"; return p.slice(0, i); })(${a[0]})`,
	Ext: (a) =>
		`((p) => { const b = p.slice(p.lastIndexOf("/") + 1); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); })(${a[0]})`,
	IsAbs: (a) => `(${a[0]}).startsWith("/")`,
	Split: (a) =>
		`((p) => { const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)]; })(${a[0]})`,
	Match: (a) =>
		`((pat, name) => { try { const sp=/[.+^$()|[\\]\\\\]/g; const re = new RegExp("^" + pat.replace(sp, "\\\\$&").replace(/\\*/g, "[^/]*").replace(/\\?/g, "[^/]") + "$"); return [re.test(name), null]; } catch(e) { return [false, "syntax error in pattern"]; } })(${a[0]}, ${a[1]})`,
};

// ── Stdlib namespace → handler method name ───────────────────────────
// Used by _genStdlibCall to dispatch dynamically without creating static call edges.
const STDLIB_METHOD_MAP = {
	fmt: "_genFmt",
	strings: "_genStrings",
	bytes: "_genBytes",
	strconv: "_genStrconv",
	sort: "_genSort",
	math: "_genMath",
	unicode: "_genUnicode",
	os: "_genOs",
	errors: "_genErrors",
	time: "_genTime",
	regexp: "_genRegexp",
	slices: "_genSlices",
	maps: "_genMaps",
	html: "_genHtml",
	io: "_genIo",
	rand: "_genRand",
	utf8: "_genUtf8",
	path: "_genPath",
};
const GOM_ELEMENT_TAGS = {
	Div: "div",
	Section: "section",
	Article: "article",
	Aside: "aside",
	Header: "header",
	Footer: "footer",
	Main: "main",
	Nav: "nav",
	Figure: "figure",
	H1: "h1",
	H2: "h2",
	H3: "h3",
	H4: "h4",
	H5: "h5",
	H6: "h6",
	Span: "span",
	A: "a",
	Strong: "strong",
	Em: "em",
	Code: "code",
	Pre: "pre",
	Small: "small",
	Mark: "mark",
	P: "p",
	Br: "br",
	Hr: "hr",
	Ul: "ul",
	Ol: "ol",
	Li: "li",
	Dl: "dl",
	Dt: "dt",
	Dd: "dd",
	Form: "form",
	Input: "input",
	Button: "button",
	Textarea: "textarea",
	Select: "select",
	Option: "option",
	Label: "label",
	Fieldset: "fieldset",
	Legend: "legend",
	Img: "img",
	Video: "video",
	Audio: "audio",
	Canvas: "canvas",
	Table: "table",
	Thead: "thead",
	Tbody: "tbody",
	Tfoot: "tfoot",
	Tr: "tr",
	Th: "th",
	Td: "td",
};
const GOM_ATTR_HELPERS = {
	For: "for",
	Name: "name",
	Value: "value",
	Target: "target",
	Rel: "rel",
	Alt: "alt",
	Title: "title",
	Lang: "lang",
	Action: "action",
	Method: "method",
	AutoComplete: "autocomplete",
	Draggable: "draggable",
	Role: "role",
	StyleAttr: "style",
	AriaLabel: "aria-label",
};
const GOM_BOOL_ATTRS = {
	Disabled: "disabled",
	Checked: "checked",
	Selected: "selected",
	Readonly: "readonly",
};

export const stdlibGenMethods = {
	_genBuilderCall(typeName, method, expr) {
		const recv = expr.func.expr;
		const isPtr = recv._type?.kind === "pointer";
		const base = isPtr ? `${this.genExpr(recv)}.value` : this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		const isStr = typeName === "strings.Builder";
		const table = isStr ? BUILDER_STR : BUILDER_BYTES;
		const gen = table[method] ?? BUILDER_COMMON[method];
		return gen ? gen(base, args) : undefined;
	},

	_genRegexp(fn, a) {
		// Converts a Go regexp pattern string (which may contain inline flags like (?i))
		// into a JS RegExp, extracting the flags into the second constructor argument.
		const makeRegExp = (pat) =>
			`((p) => { const m = /^\\(\\?([gimsuy]+)\\)/.exec(p); return m ? new RegExp(p.slice(m[0].length), m[1]) : new RegExp(p); })(${pat})`;
		switch (fn) {
			case "MustCompile":
				return makeRegExp(a()[0]);
			case "Compile":
				return `[${makeRegExp(a()[0])}, null]`;
			case "MatchString": {
				const [pat, s] = a();
				return `[new RegExp(${pat}).test(${s}), null]`;
			}
			case "QuoteMeta":
				return `${a()[0]}.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')`;
		}
		return undefined;
	},

	_genRegexpMethodCall(method, expr) {
		const recv = expr.func.expr;
		// *Regexp is a plain JS RegExp — no .value boxing needed
		const re = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		const gen = REGEXP_METHOD[method];
		return gen ? gen(re, args) : undefined;
	},

	_genSlices(fn, a) {
		if (fn === "Equal") {
			this._usesEqual = true;
			const [a1, b1] = a();
			return `__equal(${a1}, ${b1})`;
		}
		const gen = SLICES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},

	_genIo(fn, _a, expr) {
		switch (fn) {
			case "WriteString": {
				const writerArg = expr.args[0];
				const writerType = writerArg._type;
				const typeName =
					writerType?.name ??
					(writerType?.kind === "pointer" ? writerType.base?.name : null);
				const w = this.genExpr(writerArg);
				const s = this.genExpr(expr.args[1]);
				const isPtr = writerType?.kind === "pointer";
				const base = isPtr ? `${w}.value` : w;
				if (typeName === "strings.Builder") {
					return `((b,s) => { b._buf += s; return [s.length, null]; })(${base}, ${s})`;
				}
				if (typeName === "bytes.Buffer") {
					return `((b,s) => { b._buf.push(...new TextEncoder().encode(s)); return [s.length, null]; })(${base}, ${s})`;
				}
				// Generic: auto-dereference pointer, then dispatch on concrete writer type.
				// strings.Builder has { _buf: string }, bytes.Buffer has { _buf: [] }.
				return `((b,s) => { const w = b?.value ?? b; if (typeof w.WriteString === "function") return [w.WriteString(s), null]; if (typeof w._buf === "string") { w._buf += s; return [s.length, null]; } if (Array.isArray(w._buf)) { w._buf.push(...new TextEncoder().encode(s)); return [s.length, null]; } return [0, "io.WriteString: unsupported writer"]; })(${w}, ${s})`;
			}
			case "ReadAll": {
				const r = this.genExpr(expr.args[0]);
				return `((r) => { const w = r?.value ?? r; if (typeof w._src === "string") { const s = w._src.slice(w._pos); w._pos = w._src.length; return [[...s].map(c => c.charCodeAt(0)), null]; } if (Array.isArray(w._src)) { const b = w._src.slice(w._pos); w._pos = w._src.length; return [b, null]; } const chunks = []; const buf = new Array(4096); let err = null; while (!err) { const [n, e] = w.Read(buf); if (n > 0) chunks.push(...buf.slice(0, n)); err = e; } return [chunks, err === "EOF" ? null : err]; })(${r})`;
			}
		}
		return undefined;
	},

	_genHtml(fn, a) {
		switch (fn) {
			case "EscapeString": {
				const [s] = a();
				return `${s}.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;")`;
			}
			case "UnescapeString": {
				const [s] = a();
				return `${s}.replace(/&#39;/g,"'").replace(/&#34;/g,'"').replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&")`;
			}
		}
		return undefined;
	},

	_genMaps(fn, a) {
		if (fn === "Equal") {
			this._usesEqual = true;
			const [a1, b1] = a();
			return `__equal(${a1}, ${b1})`;
		}
		switch (fn) {
			case "Keys": {
				const [m] = a();
				return `Object.keys(${m})`;
			}
			case "Values": {
				const [m] = a();
				return `Object.values(${m})`;
			}
			case "Clone": {
				const [m] = a();
				return `({...${m}})`;
			}
			case "Copy": {
				const [dst, src] = a();
				return `Object.assign(${dst}, ${src})`;
			}
			case "EqualFunc": {
				const [m1, m2, eq] = a();
				return `((a, b, f) => { const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false; return ka.every(k => k in b && f(a[k], b[k])); })(${m1}, ${m2}, ${eq})`;
			}
			case "Delete": {
				const [m, k] = a();
				return `(delete ${m}[${k}], undefined)`;
			}
			case "DeleteFunc": {
				const [m, fn2] = a();
				return `Object.keys(${m}).forEach(k => { if (${fn2}(k, ${m}[k])) delete ${m}[k]; })`;
			}
		}
		return undefined;
	},

	typeComment(typeNode) {
		if (!typeNode) return "unknown";
		switch (typeNode.kind) {
			case "TypeName":
				return typeNode.name;
			case "SliceType":
				return `[]${this.typeComment(typeNode.elem)}`;
			case "MapType":
				return `map[${this.typeComment(typeNode.key)}]${this.typeComment(typeNode.value)}`;
			default:
				return typeNode.kind;
		}
	},

	// Dispatch table for stdlib namespace calls (pkg.Func → inline JS).
	// Returns the generated JS string, or undefined if not handled.
	_genStdlibCall(ns, fn, expr) {
		const a = () => expr.args.map((e) => this.genExpr(e));
		if (ns === "gom") return this._genGom(fn, expr);
		const method = STDLIB_METHOD_MAP[ns];
		return method ? this[method](fn, a, expr) : undefined;
	},

	_genGom(fn, expr) {
		const a = () =>
			expr.args.map((e) =>
				e._spread ? `...${this.genExpr(e)}` : this.genExpr(e),
			);

		if (GOM_ELEMENT_TAGS[fn]) {
			const tag = GOM_ELEMENT_TAGS[fn];
			const args = a();
			if (args.length === 0)
				return `(()=>({Mount(p){const e=document.createElement("${tag}");p.appendChild(e);}}))()`;
			return (
				`((...c)=>({Mount(p){const e=document.createElement("${tag}");c.forEach(n=>n?.Mount?.(e));p.appendChild(e);}}))` +
				`(${args.join(",")})`
			);
		}

		if (GOM_ATTR_HELPERS[fn]) {
			const [v] = a();
			return `((v)=>({Mount(e){e.setAttribute("${GOM_ATTR_HELPERS[fn]}",v)}}))(${v})`;
		}

		if (GOM_BOOL_ATTRS[fn])
			return `({Mount(e){e.setAttribute("${GOM_BOOL_ATTRS[fn]}","")}})`;

		const args = a();
		switch (fn) {
			case "El": {
				const [tag, ...children] = args;
				if (children.length === 0)
					return `((t)=>({Mount(p){const e=document.createElement(t);p.appendChild(e);}})) (${tag})`;
				return (
					`((t,...c)=>({Mount(p){const e=document.createElement(t);c.forEach(n=>n?.Mount?.(e));p.appendChild(e);}}))` +
					`(${tag},${children.join(",")})`
				);
			}
			case "Text": {
				const [s] = args;
				return `((s)=>({Mount(p){p.appendChild(document.createTextNode(s))}}))(${s})`;
			}
			case "Attr": {
				const [name, value] = args;
				return `((n,v)=>({Mount(e){e.setAttribute(n,v)}}))(${name},${value})`;
			}
			case "Class":
				return `((v)=>({Mount(e){e.className=v}}))(${args[0]})`;
			case "Type":
				return `((v)=>({Mount(e){e.type=v}}))(${args[0]})`;
			case "Href":
				return `((v)=>({Mount(e){e.href=v}}))(${args[0]})`;
			case "Src":
				return `((v)=>({Mount(e){e.src=v}}))(${args[0]})`;
			case "Placeholder":
				return `((v)=>({Mount(e){e.placeholder=v}}))(${args[0]})`;
			case "DataAttr":
				return `((k,v)=>({Mount(e){e.setAttribute("data-"+k,v)}}))(${args[0]},${args[1]})`;
			case "If":
				return `((c,n)=>c?n:{Mount(){}})(${args[0]},${args[1]})`;
			case "Map":
				return `((s,f)=>{const c=s.map(f);return{_items:c,Mount(p){c.forEach(n=>n.Mount(p))}}})(${args[0]},${args[1]})`;
			case "Style":
				return `((s)=>({Mount(p){const e=document.createElement("style");e.textContent=s;p.appendChild(e);}})) (${args[0]})`;
			case "Mount":
				return `((sel,n)=>{const e=document.querySelector(sel);e.innerHTML="";n.Mount(e)})(${args[0]},${args[1]})`;
			case "MountTo":
				return `((sel,n)=>{const e=document.querySelector(sel);n.Mount(e)})(${args[0]},${args[1]})`;
		}
		return undefined;
	},

	_genFmt(fn, _a, expr) {
		const fmtArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
		switch (fn) {
			case "Sprintf":
				this._usesSprintf = true;
				return `__sprintf(${fmtArgs})`;
			case "Errorf": {
				this._usesSprintf = true;
				this._usesError = true;
				const fmtStr = expr.args[0];
				if (fmtStr?.kind === "BasicLit" && fmtStr.value?.includes("%w")) {
					const lastArg = this.genExpr(expr.args[expr.args.length - 1]);
					return `__error(__sprintf(${fmtArgs}), ${lastArg})`;
				}
				return `__error(__sprintf(${fmtArgs}))`;
			}
			case "Printf":
			case "Print":
				this._usesSprintf = true;
				return `process?.stdout?.write(__sprintf(${fmtArgs}))`;
			case "Println":
				this._usesSprintf = true;
				return `console.log(__sprintf(${fmtArgs}))`;
			case "Fprintf":
			case "Fprintln":
			case "Fprint":
				return this._genFmtFprint(fn, expr);
			case "Sscan": {
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { const t = tokens[i]; const p = ptrs[i]; if (typeof p.value === "number") p.value = Number(t); else if (typeof p.value === "boolean") p.value = t === "true"; else p.value = t; n++; } return [n, n < ptrs.length ? "unexpected EOF" : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanln": {
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const line = str.split("\\n")[0]; const tokens = line.trim().split(/\\s+/).filter(Boolean); let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { const t = tokens[i]; const p = ptrs[i]; if (typeof p.value === "number") p.value = Number(t); else if (typeof p.value === "boolean") p.value = t === "true"; else p.value = t; n++; } return [n, n < ptrs.length ? "unexpected EOF" : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanf": {
				const strArg = this.genExpr(expr.args[0]);
				const fmtArg = this.genExpr(expr.args[1]);
				const restArgs = expr.args
					.slice(2)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, _fmt, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { const t = tokens[i]; const p = ptrs[i]; if (typeof p.value === "number") p.value = Number(t); else if (typeof p.value === "boolean") p.value = t === "true"; else p.value = t; n++; } return [n, n < ptrs.length ? "input does not match format" : null]; })(${strArg}, ${fmtArg}, ${restArgs})`;
			}
			default:
				return undefined;
		}
	},

	_genFmtFprint(fn, expr) {
		this._usesSprintf = true;
		const writerArg = expr.args[0];
		const rest = expr.args.slice(1);
		const restJs = rest.map((e) => this.genExpr(e)).join(", ");
		const writerType = writerArg._type;
		const targetTypeName =
			writerType?.name ??
			(writerType?.kind === "pointer" ? writerType.base?.name : null);
		if (targetTypeName === "strings.Builder") {
			const w = this.genExpr(writerArg);
			const buf =
				writerType?.kind === "pointer" ? `${w}.value._buf` : `${w}._buf`;
			if (fn === "Fprintf") return `(${buf} += __sprintf(${restJs}))`;
			if (fn === "Fprintln") return `(${buf} += __sprintf("%v\\n", ${restJs}))`;
			return `(${buf} += __sprintf("%v", ${restJs}))`;
		}
		if (targetTypeName === "bytes.Buffer") {
			const w = this.genExpr(writerArg);
			const base = writerType?.kind === "pointer" ? `${w}.value` : w;
			if (fn === "Fprintf") {
				return `((__b,__s)=>{ __b._buf.push(...new TextEncoder().encode(__s)); })(${base}, __sprintf(${restJs}))`;
			}
			const valJs =
				fn === "Fprintln"
					? `__sprintf("%v\\n", ${restJs})`
					: `__sprintf("%v", ${restJs})`;
			return `((__b,__s)=>{ __b._buf.push(...new TextEncoder().encode(__s)); })(${base}, ${valJs})`;
		}
		// Generic io.Writer fallback — call .WriteString if available
		const w = this.genExpr(writerArg);
		const formatted =
			fn === "Fprintf"
				? `__sprintf(${restJs})`
				: fn === "Fprintln"
					? `__sprintf("%v\\n", ${restJs})`
					: `__sprintf("%v", ${restJs})`;
		return `${w}.WriteString(${formatted})`;
	},

	_genStrings(fn, a) {
		const args = a();
		const [s, s2] = args;
		if (STRINGS_M1[fn]) return `${s}.${STRINGS_M1[fn]}()`;
		if (STRINGS_M2[fn]) return `${s}.${STRINGS_M2[fn]}(${s2})`;
		const gen = STRINGS_DISPATCH[fn];
		return gen ? gen(args) : undefined;
	},

	_genBytes(fn, a) {
		const gen = BYTES_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},

	_genStrconv(fn, a) {
		const gen = STRCONV_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},

	_genSort(fn, a) {
		const gen = SORT_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},

	_genMath(fn, a) {
		const args = a();
		const [x, y] = args;
		if (MATH1[fn]) return `Math.${MATH1[fn]}(${x})`;
		if (MATH2[fn]) return `Math.${MATH2[fn]}(${x}, ${y})`;
		const gen = MATH_EXTRA[fn];
		return gen ? gen(args) : undefined;
	},

	_genUnicode(fn, a) {
		const [arg] = a();
		const cp = `String.fromCodePoint(${arg})`;
		const UNICODE_TEST = {
			IsLetter: `/\\p{L}/u.test(${cp})`,
			IsDigit: `/\\p{Nd}/u.test(${cp})`,
			IsSpace: `/\\s/.test(${cp})`,
			IsUpper: `((__c) => __c === __c.toUpperCase() && /\\p{L}/u.test(__c))(${cp})`,
			IsLower: `((__c) => __c === __c.toLowerCase() && /\\p{L}/u.test(__c))(${cp})`,
			IsPunct: `/\\p{P}/u.test(${cp})`,
			IsControl: `/\\p{Cc}/u.test(${cp})`,
			IsPrint: `!/\\p{Cc}/u.test(${cp})`,
			IsGraphic: `!/\\p{Cc}/u.test(${cp})`,
			ToUpper: `${cp}.toUpperCase().codePointAt(0)`,
			ToLower: `${cp}.toLowerCase().codePointAt(0)`,
		};
		return UNICODE_TEST[fn] ?? undefined;
	},

	_genOs(fn, a) {
		const args = a();
		if (fn === "Exit") return `process.exit(${args[0]})`;
		if (fn === "Getenv") return `(process.env[${args[0]}] ?? "")`;
		return undefined;
	},

	_genErrors(fn, a) {
		const args = a();
		if (fn === "New") {
			this._usesError = true;
			return `__error(${args[0]})`;
		}
		if (fn === "Is") {
			this._usesErrorIs = true;
			return `__errorIs(${args[0]}, ${args[1]})`;
		}
		if (fn === "Unwrap") return `(${args[0]}?._cause ?? null)`;
		return undefined;
	},

	_genTimeMethodCall(method, expr) {
		const recv = expr.func.expr;
		const recvJs = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		if (method === "Format") {
			this._usesTimeFmt = true;
			return `__timeFmt(${recvJs}._d, ${args[0]})`;
		}
		if (method === "String") {
			this._usesTimeFmt = true;
			return `__timeFmt(${recvJs}._d, "2006-01-02T15:04:05Z07:00")`;
		}
		const gen = TIME_METHOD_DISPATCH[method];
		return gen ? gen(recvJs, args) : undefined;
	},

	_genTime(fn, a) {
		if (fn === "Parse") {
			this._usesTimeParse = true;
			return `__timeParse(${a()[0]}, ${a()[1]})`;
		}
		const gen = TIME_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},

	_genRand(fn, a) {
		const gen = RAND_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},

	_genUtf8(fn, a) {
		const gen = UTF8_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},

	_genPath(fn, a, expr) {
		if (fn === "Join") {
			this._usesPathClean = true;
			const allArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
			return `__pathClean([${allArgs}].filter(x => x !== "").join("/"))`;
		}
		if (fn === "Clean") {
			this._usesPathClean = true;
			return `__pathClean(${a()[0]})`;
		}
		const gen = PATH_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
