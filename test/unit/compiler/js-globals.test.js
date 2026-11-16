// GoFront test suite -- JS global rename-set self-check
//
// Generated JS runs in one flat module scope, so a Go declaration named after
// a global the output reads (`func Map`, `NaN := 2.0`) would shadow it. The
// rename set (`shadowsJsGlobal`) must therefore name every host global that a
// runtime helper, inline template or facade template can reference. This test
// finds those references two ways, so a new helper that reaches for a new
// global fails here instead of in a user's bundle:
//   (a) the string and template text of the backend sources that emit code;
//   (b) the emitted JS of real programs on every target.
// It is modelled on natives.test.js.

import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDir } from "../../../src/compiler.js";
import {
	BROWSER_GLOBALS,
	JS_BUILTIN_CLASSES,
	JS_RESERVED_GLOBALS,
	shadowsJsGlobal,
} from "../../../src/typechecker/types.js";
import { FIXTURES } from "../../perf/bundle-size.js";
import { assert, assertEqual, section, test } from "../helpers.js";

section("JS global rename set");

const SRC_ROOT = fileURLToPath(new URL("../../../src", import.meta.url));

// Every global a Go declaration could shadow without a rename.
const HOST_GLOBALS = new Set([
	...Object.getOwnPropertyNames(globalThis),
	...BROWSER_GLOBALS,
]);

// Host-global names that appear in emitting backend source or emitted output
// but are never read as a global by the generated program.
const NOT_EMITTED = new Map([
	[
		"eval",
		"JS_RESERVED lists it as a keyword to suffix; no template calls eval",
	],
]);

// ── A small JS lexer: enough to tell code from string text ──────────────

const REGEX_AFTER = new Set([
	"return",
	"typeof",
	"case",
	"in",
	"of",
	"delete",
	"void",
	"throw",
	"new",
	"do",
	"else",
	"yield",
	"await",
]);

const isIdStart = (c) => /[A-Za-z_$#]/.test(c);
const isIdPart = (c) => /[\w$]/.test(c);

// A `/` after one of these tokens divides; after anything else it opens a
// regular expression.
function slashDivides(p) {
	if (!p) return false;
	if (p.t === "id") return !REGEX_AFTER.has(p.v);
	if (p.t === "punct") return [")", "]", "}"].includes(p.v);
	return true;
}

function skipComment(st) {
	const { src } = st;
	if (src[st.i + 1] === "/") {
		while (st.i < src.length && src[st.i] !== "\n") st.i++;
	} else {
		const end = src.indexOf("*/", st.i + 2);
		st.i = end < 0 ? src.length : end + 2;
	}
}

function readString(st) {
	const { src } = st;
	const q = src[st.i];
	let j = st.i + 1;
	let buf = "";
	while (j < src.length && src[j] !== q && src[j] !== "\n") {
		if (src[j] === "\\") {
			buf += src.slice(j, j + 2);
			j += 2;
		} else buf += src[j++];
	}
	st.i = j + 1;
	st.out.push({ t: "text", v: buf });
}

function readRegex(st) {
	const { src } = st;
	let j = st.i + 1;
	let inClass = false;
	while (j < src.length && (src[j] !== "/" || inClass) && src[j] !== "\n") {
		if (src[j] === "\\") j++;
		else if (src[j] === "[") inClass = true;
		else if (src[j] === "]") inClass = false;
		j++;
	}
	j++;
	while (j < src.length && /[a-z]/.test(src[j])) j++;
	st.i = j;
	st.out.push({ t: "other", v: "regex" });
}

function readWord(st) {
	const { src, out } = st;
	let j = st.i + 1;
	while (j < src.length && isIdPart(src[j])) j++;
	const p = out[out.length - 1];
	out.push({
		t: "id",
		v: src.slice(st.i, j),
		afterDot: p?.t === "punct" && p.v === ".",
	});
	st.i = j;
}

function readNumber(st) {
	const { src } = st;
	let j = st.i + 1;
	while (j < src.length && /[\w.]/.test(src[j])) j++;
	st.i = j;
	st.out.push({ t: "other", v: "num" });
}

// `st.i` is just past the opening backtick. Each `${ ... }` is lexed as code.
function readTemplate(st) {
	const { src, out } = st;
	let buf = "";
	while (st.i < src.length) {
		const c = src[st.i];
		if (c === "\\") {
			buf += src.slice(st.i, st.i + 2);
			st.i += 2;
		} else if (c === "`") {
			st.i++;
			out.push({ t: "text", v: buf });
			return;
		} else if (c === "$" && src[st.i + 1] === "{") {
			out.push({ t: "text", v: buf });
			buf = "";
			st.i += 2;
			readInterpolation(st);
		} else {
			buf += c;
			st.i++;
		}
	}
}

function readInterpolation(st) {
	let depth = 1;
	while (st.i < st.src.length) {
		const before = st.out.length;
		const tok = step(st);
		if (tok === "{") depth++;
		else if (tok === "}" && --depth === 0) {
			st.out.length = before; // drop the closing brace
			return;
		}
	}
}

// Lexes one token; returns its punctuation text when it is punctuation.
function step(st) {
	const { src, out } = st;
	const c = src[st.i];
	const next = src[st.i + 1];
	if (/\s/.test(c)) st.i++;
	else if (c === "/" && (next === "/" || next === "*")) skipComment(st);
	else if (c === '"' || c === "'") readString(st);
	else if (c === "`") {
		st.i++;
		readTemplate(st);
	} else if (c === "/" && !slashDivides(out[out.length - 1])) readRegex(st);
	else if (isIdStart(c)) readWord(st);
	else if (/[0-9]/.test(c)) readNumber(st);
	else {
		const v = src.startsWith("...", st.i) ? "..." : c;
		st.i += v.length;
		out.push({ t: "punct", v });
		return v;
	}
	return null;
}

// Returns tokens: {t: "id"|"text"|"punct"|"other", v, afterDot}
function lex(src) {
	const st = { src, i: 0, out: [] };
	while (st.i < src.length) step(st);
	return st.out;
}

const IDENT_IN_TEXT = /(?<![.\w$])[A-Za-z_$][\w$]*/g;

// `{ Map: 1 }` and `, Map: 1` name a property, not the global.
function isPropertyKey(toks, k) {
	const prev = toks[k - 1];
	const next = toks[k + 1];
	return (
		next?.t === "punct" &&
		next.v === ":" &&
		prev?.t === "punct" &&
		(prev.v === "{" || prev.v === ",")
	);
}

function globalsInText(toks) {
	const found = new Set();
	for (const tok of toks) {
		if (tok.t !== "text") continue;
		for (const m of tok.v.matchAll(IDENT_IN_TEXT))
			if (HOST_GLOBALS.has(m[0])) found.add(m[0]);
	}
	return found;
}

function globalsInCode(toks) {
	const found = new Set();
	toks.forEach((tok, k) => {
		const reads = tok.t === "id" && !tok.afterDot && HOST_GLOBALS.has(tok.v);
		if (reads && !isPropertyKey(toks, k)) found.add(tok.v);
	});
	return found;
}

// Host-global names read as bare identifiers in emitted code. `code` mode
// walks a generated program; `text` mode walks the string and template
// segments of a backend source file, where emitted code lives.
function hostGlobalsIn(src, mode) {
	const toks = lex(src);
	return mode === "text" ? globalsInText(toks) : globalsInCode(toks);
}

function jsFilesUnder(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return jsFilesUnder(p);
		return e.name.endsWith(".js") ? [p] : [];
	});
}

function unreserved(names) {
	return [...names]
		.filter((n) => !shadowsJsGlobal(n) && !NOT_EMITTED.has(n))
		.sort();
}

// ── The set itself ──────────────────────────────────────────────────────

test("every built-in class a type may not shadow is in the rename set", () => {
	const missing = [...JS_BUILTIN_CLASSES].filter((n) => !shadowsJsGlobal(n));
	assertEqual(missing.join(","), "");
});

test("the rename set covers the globals generated code is known to read", () => {
	const known = [
		"Map",
		"Set",
		"WeakMap",
		"BigInt",
		"Proxy",
		"Reflect",
		"ArrayBuffer",
		"DataView",
		"Uint8Array",
		"Int32Array",
		"Float64Array",
		"BigUint64Array",
		"TypeError",
		"RangeError",
		"WebAssembly",
		"NaN",
		"Infinity",
		"undefined",
		"globalThis",
		"process",
		"Array",
		"Object",
	];
	const missing = known.filter((n) => !shadowsJsGlobal(n));
	assertEqual(missing.join(","), "");
});

test("the extra set never overlaps the predeclared browser globals", () => {
	// A name in both would be redundant; a name only in the extra set must
	// stay unpredeclared so the set cannot change what compiles.
	const both = [...JS_RESERVED_GLOBALS].filter((n) => BROWSER_GLOBALS.has(n));
	assertEqual(both.join(","), "");
});

test("a name outside the set is not renamed", () => {
	assert(!shadowsJsGlobal("Widget"), "Widget");
	assert(!shadowsJsGlobal("map"), "map");
});

// ── (a) Backend source text ─────────────────────────────────────────────

test("backend emit templates only reference globals in the rename set", () => {
	const files = [
		...jsFilesUnder(join(SRC_ROOT, "backend/js")),
		...jsFilesUnder(join(SRC_ROOT, "backend/shared")),
		join(SRC_ROOT, "backend/wasm/boundary.js"),
	];
	const bad = [];
	for (const f of files) {
		const names = unreserved(hostGlobalsIn(readFileSync(f, "utf8"), "text"));
		if (names.length > 0)
			bad.push(`${f.slice(SRC_ROOT.length + 1)}: ${names.join(" ")}`);
	}
	assertEqual(bad.join("\n"), "");
});

// ── (b) Emitted JS ──────────────────────────────────────────────────────

const EXTRA_PROGRAMS = {
	"struct-key-map": `package main

type K struct{ A, B int }

func main() {
	m := map[K]int{{1, 2}: 3}
	m[K{4, 5}] = 6
	delete(m, K{1, 2})
	println(len(m))
}
`,
	int64: `package main

func main() {
	var a int64 = 1 << 40
	var b uint64 = 7
	a *= 3
	println(a, b<<3, a/int64(b))
}
`,
	"typed-slices": `package main

func main() {
	b := make([]byte, 4)
	f := make([]float64, 2)
	i := make([]int32, 3)
	u := []uint16{1, 2}
	b = append(b, 9)
	println(len(b), len(f), len(i), u[1])
}
`,
	"slice-views": `package main

func main() {
	xs := []int{1, 2, 3, 4, 5}
	ys := xs[1:3]
	ys = append(ys, 9)
	zs := xs[:2:3]
	copy(zs, ys)
	println(len(ys), cap(ys), len(zs), xs[2])
}
`,
	math: `package main

import "math"

func main() {
	println(math.IsNaN(math.NaN()), math.Inf(1), math.Sqrt(2), math.MaxInt64)
}
`,
	time: `package main

import "time"

func main() {
	t := time.Now()
	println(time.Since(t) >= 0, time.Duration(1500)*time.Millisecond)
}
`,
	os: `package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "x")
	println(len(os.Args) > 0)
}
`,
	json: `package main

import "encoding/json"

type T struct {
	A int     \`json:"a"\`
	B []byte  \`json:"b"\`
	C float64 \`json:"c"\`
}

func main() {
	b, _ := json.Marshal(T{1, []byte("x"), 2.5})
	var t T
	_ = json.Unmarshal(b, &t)
	println(string(b), t.A)
}
`,
	"strict-ints": `//gofront:target both
package main

func main() {
	var a int32 = 1 << 30
	var b uint8 = 200
	a *= 4
	b += 100
	println(a, b, a/3, b>>1)
}
`,
	"wasm-export": `//gofront:target wasm
package main

type P struct{ X, Y int }

func Add(a, b int) int { return a + b }
func Mk(x int) P { return P{x, x} }
func Sum(xs []int) int {
	s := 0
	for _, x := range xs {
		s += x
	}
	return s
}
func main() {}
`,
};

function compileProgram(files, forceTarget) {
	const root = mkdtempSync(join(tmpdir(), "gofront-jsglobals-"));
	try {
		for (const [rel, src] of Object.entries(files)) {
			mkdirSync(dirname(join(root, rel)), { recursive: true });
			writeFileSync(join(root, rel), src);
		}
		return compileDir(root, { forceTarget });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const PROGRAMS = {
	...Object.fromEntries(
		Object.entries(FIXTURES).map(([name, files]) => [`fixture ${name}`, files]),
	),
	...Object.fromEntries(
		Object.entries(EXTRA_PROGRAMS).map(([name, src]) => [
			name,
			{ "main.go": src },
		]),
	),
};

for (const target of ["js", "both", "wasm"]) {
	test(`emitted JS (${target}) only reads globals in the rename set`, () => {
		const bad = [];
		for (const [name, files] of Object.entries(PROGRAMS)) {
			let res;
			try {
				res = compileProgram(files, target);
			} catch (e) {
				throw new Error(`${name} (${target}): ${e.message}`);
			}
			if (!res.js) continue;
			const names = unreserved(hostGlobalsIn(res.js, "code"));
			if (names.length > 0) bad.push(`${name}: ${names.join(" ")}`);
		}
		assertEqual(bad.join("\n"), "");
	});
}
