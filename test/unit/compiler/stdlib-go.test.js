// Go-source stdlib: packages written in GoFront Go under stdlib/,
// compiled into the caller's target (js, wasm, or both).

import { JS_NATIVES } from "../../../src/backend/js/natives.js";
import { WASM_NATIVES } from "../../../src/backend/wasm/natives.js";
import { NATIVES, STDLIB_PACKAGES } from "../../../src/typechecker/types.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertFourWay,
	assertThrows,
	compile,
	compileDir,
	compileHybridProgram,
	compileHybridProject,
	join,
	section,
	test,
	withTempDir,
} from "../helpers.js";

// Builds `lib` once as `both` (JS code path) and once as `wasm` (linked
// module behind the facade), calls `lib.Run()` from a JS root, and returns the
// printed line of each.  Throws when the two backends disagree.  `extraFiles`
// adds more project files (e.g. a local package `lib` imports); `options` go
// to compileDir.
async function stdParity(libBody, extraFiles = {}, options = {}) {
	const run = async (target) => {
		const res = await compileHybridProject(
			{
				...extraFiles,
				"lib/lib.go": `//gofront:target ${target}\npackage lib\n\n${libBody}`,
				"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
			},
			options,
		);
		return res.lines.join("\n");
	};
	const js = await run("both");
	const wasm = await run("wasm");
	if (js !== wasm)
		throw new Error(
			`Output mismatch:\n  JS:   ${JSON.stringify(js)}\n  WASM: ${JSON.stringify(wasm)}`,
		);
	return js;
}

section("Go-source stdlib: loader (cmp)");

test("cmp has no hand-written checker entry", () => {
	assert(!STDLIB_PACKAGES.has("cmp"), "cmp must come from stdlib");
});

test("migrated packages have no STDLIB_PACKAGES entry", () => {
	for (const name of [
		"bytes",
		"cmp",
		"crypto/sha256",
		"encoding/base64",
		"encoding/hex",
		"hash",
		"html",
		"io",
		"iter",
		"maps",
		"math/bits",
		"math/rand",
		"path",
		"path/filepath",
		"slices",
		"sort",
		"strconv",
		"sync",
		"unicode/utf8",
	])
		assert(!STDLIB_PACKAGES.has(name), `${name} must come from stdlib`);
});

test("js package imports cmp", async () => {
	const res = await compileHybridProject({
		"main.go": `package main

import "cmp"

func main() {
	println(cmp.Compare(1, 2), cmp.Compare("b", "a"), cmp.Less(1.5, 2.5))
}
`,
	});
	assertEqual(res.lines.join("\n"), "-1 1 true");
	assert(res.wasm === null, "a js-only program must not link app.wasm");
});

test("wasm package imports cmp", async () => {
	const out = await stdParity(`import "cmp"

func Run() int { return cmp.Compare(3, 7)*10 + cmp.Compare(7, 3) }
`);
	assertEqual(out, "-9");
});

test("cmp.Compare(1.0, math.NaN()) parity", async () => {
	const out = await stdParity(`import (
	"cmp"
	"math"
)

func Run() int {
	nan := math.NaN()
	return cmp.Compare(1.0, nan)*100 + cmp.Compare(nan, 1.0)*10 + cmp.Compare(nan, nan)
}
`);
	assertEqual(out, "90");
});

test("both package uses cmp.Or", async () => {
	const out = await stdParity(`import "cmp"

func Run() string { return cmp.Or("x", "y") + cmp.Or("z") + "!" }
`);
	assertEqual(out, "xz!");
});

test("cmp.Or skips zero values", async () => {
	const out = await stdParity(`import "cmp"

func Run() string { return cmp.Or("", "", "x", "y") + cmp.Or("", "") + "!" }
`);
	assertEqual(out, "x!");
});

section("Go-source stdlib: overlays (errors.ErrUnsupported)");

test("errors.Is(err, errors.ErrUnsupported) parity", async () => {
	const out = await stdParity(`import (
	"errors"
	"fmt"
)

func Run() string {
	err := fmt.Errorf("open: %w", errors.ErrUnsupported)
	return fmt.Sprintf("%v %s", errors.Is(err, errors.ErrUnsupported), errors.ErrUnsupported.Error())
}
`);
	assertEqual(out, "true unsupported operation");
});

test("an overlay that redeclares an emitter member is rejected", () => {
	withTempDir(
		{
			"stdlib/encoding/json/overlay.go": `//go:build gofront

//gofront:target both

package json

func Valid(data []byte) bool { return false }
`,
			"app/main.go": `package main

import "encoding/json"

func main() { println(json.Valid(nil)) }
`,
		},
		(dir) => {
			assertThrows(
				() => compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") }),
				"overlay redeclares json.Valid",
			);
		},
	);
});

section("Go-source stdlib: name coexistence and diagnostics");

test("a user package named cmp coexists with the stdlib cmp", async () => {
	const out = await stdParity(
		`import (
	"cmp"
	mycmp "../cmp"
)

func Run() int { return cmp.Compare(1, 2)*1000 + mycmp.Compare(1, 2) }
`,
		{
			"cmp/cmp.go": `//gofront:target both
package cmp

func Compare(a, b int) int { return 7 }
`,
		},
	);
	assertEqual(out, "-993");
});

test("a type error in Go-source stdlib is reported at the import site", () => {
	withTempDir(
		{
			"stdlib/errors/overlay.go": `//go:build gofront

//gofront:target both

package errors

var ErrBroken = New(42)
`,
			"app/main.go": `package main

import "errors"

func main() { println(errors.ErrBroken != nil) }
`,
		},
		(dir) => {
			let msg = "";
			try {
				compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") });
			} catch (e) {
				msg = e.message;
			}
			assert(
				msg.includes("internal stdlib error in errors; please report"),
				`expected the internal stdlib note, got: ${msg}`,
			);
			assert(
				msg.includes("main.go at line 3"),
				`expected the import site: ${msg}`,
			);
			assert(!msg.includes("stdlib/errors"), `leaked a stdlib path: ${msg}`);
		},
	);
});

section("Go-source stdlib: //gofront:intrinsic");

const TIMER_PKG = `//go:build gofront

//gofront:target both

package timer

//gofront:intrinsic deadline_timer
func armDeadline(key any, ns int64, fire func())

//gofront:intrinsic deadline_stop
func stopDeadline(key any)

// After arms fire after ms milliseconds (JS); in WASM it returns at once.
func After(ms int, fire func()) {
	armDeadline(&ms, int64(ms)*1000000, fire)
}

// AfterStoppable is After plus a func that cancels the pending timer.
func AfterStoppable(ms int, fire func()) func() {
	armDeadline(&ms, int64(ms)*1000000, fire)
	return func() { stopDeadline(&ms) }
}
`;

test("an unknown intrinsic name is rejected", () => {
	withTempDir(
		{
			"stdlib/timer/timer.go": TIMER_PKG.replace(
				"deadline_timer",
				"sleep_forever",
			),
			"app/main.go": `package main\n\nimport "timer"\n\nfunc main() { timer.After(1, func() {}) }\n`,
		},
		(dir) => {
			assertThrows(
				() => compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") }),
				"unknown intrinsic 'sleep_forever'",
			);
		},
	);
});

section("Go-source stdlib: reachability");

// Compiles the same project with and without `import _ "cmp"` in its wasm
// package and returns both builds.
function buildWithAndWithout(importLine) {
	const project = (imp) => ({
		"lib/lib.go": `//gofront:target wasm
package lib

${imp}

func Run() int { return 1 }
`,
		"main.go": `package main

${imp}
import "./lib"

func main() { println(lib.Run()) }
`,
	});
	const build = (imp) =>
		withTempDir(project(imp), (dir) => {
			const res = compileDir(dir);
			return { js: res.js, wasm: res.wasm };
		});
	return { with: build(importLine), without: build("") };
}

test("an imported but unused Go-source package adds 0 bytes", () => {
	const r = buildWithAndWithout(`import _ "cmp"`);
	assertEqual(r.with.js.length, r.without.js.length);
	assertEqual(r.with.js, r.without.js);
	assertEqual(r.with.wasm.length, r.without.wasm.length);
	assert(
		Buffer.from(r.with.wasm).equals(Buffer.from(r.without.wasm)),
		"dev app.wasm must be byte-identical",
	);
});

test("only reachable Go-source declarations are emitted", async () => {
	const res = await compileHybridProject({
		"main.go": `package main

import "cmp"

func main() { println(cmp.Less(1, 2)) }
`,
	});
	assertEqual(res.lines.join("\n"), "true");
	assert(res.js.includes("Less$$cmp"), "Less must be emitted");
	assert(res.js.includes("isNaNValue$$cmp"), "its helper must be emitted");
	assert(!res.js.includes("Compare$$cmp"), "Compare is unreachable");
	assert(!res.js.includes("Or$$cmp"), "Or is unreachable");
});

section("Go-source stdlib: review regressions");

test("repeated builds and diamond imports reuse cached ASTs safely", () => {
	withTempDir(
		{
			"u/u.go": `//gofront:target both
package u

import "cmp"

func C(a, b int) int { return cmp.Compare(a, b) }
`,
			"w/w.go": `//gofront:target wasm
package w

import "../u"

func Run() int { return u.C(2, 1) }
`,
			"main.go": `package main

import (
	"./u"
	"./w"
)

func main() { println(u.C(1, 2), w.Run()) }
`,
		},
		(dir) => {
			const first = compileDir(dir);
			const second = compileDir(dir);
			assertEqual(second.js, first.js);
		},
	);
});

test("an aliased overlay import is rejected at the import", () => {
	withTempDir(
		{
			"stdlib/encoding/json/overlay.go": `//go:build gofront

//gofront:target both

package json

func Hello() {}
`,
			"app/main.go": `package main\n\nimport j "encoding/json"\n\nfunc main() { println(j.Valid(nil)) }\n`,
		},
		(dir) => {
			assertThrows(
				() => compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") }),
				"import alias for 'encoding/json' is not supported",
			);
		},
	);
});

const BOX_PKG = `//go:build gofront

//gofront:target both

package box

type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }

func (s *Stack[T]) Len() int { return len(s.items) }

func StackOf[T any](v T) *Stack[T] {
	s := &Stack[T]{}
	s.Push(v)
	return s
}

type Box struct{ n int }

func NewBox(n int) *Box { return &Box{n: n} }

func (b *Box) Get() int { return b.n }
`;

test("generic composite literals in Go-source packages", async () => {
	await withTempDir({ "box/box.go": BOX_PKG }, async (stdlib) => {
		const out = await stdParity(
			`import "box"

func Run() int {
	s := box.StackOf(1)
	s.Push(2)
	return s.Len()
}
`,
			{},
			{ stdlibRoot: stdlib },
		);
		assertEqual(out, "2");
	});
});

test("a wasm package may return a Go-source type to JS", async () => {
	await withTempDir({ "box/box.go": BOX_PKG }, async (stdlib) => {
		const res = await compileHybridProject(
			{
				"lib/lib.go": `//gofront:target wasm
package lib

import "box"

func Make() *box.Box { return box.NewBox(7) }
`,
				"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Make().Get()) }\n`,
			},
			{ stdlibRoot: stdlib },
		);
		assertEqual(res.lines.join("\n"), "7");
	});
});

section("Explicit instantiation through a package qualifier (Task 0.30)");

test("cmp.Compare[int](1, 2) on both backends (P11)", async () => {
	const out = await stdParity(`import "cmp"

func Run() int { return cmp.Compare[int](1, 2) }
`);
	assertEqual(out, "-1");
});

test("util.Id[string] instantiates a user package function with caller types", async () => {
	const util = `//gofront:target both
package util

type Box[T any] struct{ V T }

func Id[T any](x T) T { return x }
func Pair[A any, B any](a A, b B) A { return a }
`;
	const out = await stdParity(
		`import "./util"

type Pt struct{ X int }

func Run() int {
	b := util.Box[Pt]{V: Pt{3}}
	return len(util.Id[string]("x")) + util.Pair[Pt, string](Pt{5}, "s").X*10 + b.V.X*100
}
`,
		{ "lib/util/util.go": util },
	);
	assertEqual(out, "351");
});

test("util.Box[int]{...} as the only use counts as using the import", async () => {
	const util = `//gofront:target both
package util

type Box[T any] struct{ V T }
`;
	const out = await stdParity(
		`import "./util"

func Run() int {
	v := util.Box[int]{V: 2}
	return v.V
}
`,
		{ "lib/util/util.go": util },
	);
	assertEqual(out, "2");
});

test("slices.Sort/Index/Max with explicit instantiation (emitter-backed)", async () => {
	const out = await stdParity(`import "slices"

func Run() int {
	xs := []int{3, 1, 2}
	slices.Sort[[]int](xs)
	return xs[0]*100 + slices.Index[[]int, int](xs, 2)*10 + slices.Max[[]int](xs)
}
`);
	assertEqual(out, "113");
});

section("Portable Go Phase 3.2 review feedback: io fixes");

test("io.SectionReader.ReadAt does not leak bytes beyond section limit", async () => {
	const out = await stdParity(`import (
	"errors"
	"fmt"
	"io"
)

type stringReaderAt string

func (s stringReaderAt) ReadAt(p []byte, off int64) (n int, err error) {
	if off < 0 {
		return 0, errors.New("negative offset")
	}
	if off >= int64(len(s)) {
		return 0, io.EOF
	}
	sub := s[off:]
	n = copy(p, []byte(sub))
	if n < len(p) {
		err = io.EOF
	}
	return n, err
}

func Run() string {
	src := stringReaderAt("0123456789abcdef")
	sr := io.NewSectionReader(src, 4, 4)
	buf := make([]byte, 8)
	for i := range buf {
		buf[i] = 'X'
	}
	n, err := sr.ReadAt(buf, 0)
	return fmt.Sprintf("n=%d err=%v buf=%s", n, err, string(buf))
}
`);
	assertEqual(out, "n=4 err=EOF buf=4567XXXX");
});

test("io.MultiWriter.WriteString succeeds on multibyte UTF-8 strings", async () => {
	const out = await stdParity(`import (
	"fmt"
	"io"
)

type memWriter struct {
	buf []byte
}

func (w *memWriter) Write(p []byte) (n int, err error) {
	w.buf = append(w.buf, p...)
	return len(p), nil
}

func Run() string {
	var out1, out2 memWriter
	mw := io.MultiWriter(&out1, &out2)
	n, err := io.WriteString(mw, "世界")
	return fmt.Sprintf("n=%d err=%v out1=%s out2=%s", n, err, string(out1.buf), string(out2.buf))
}
`);
	assertEqual(out, "n=6 err=<nil> out1=世界 out2=世界");
});

test("type assertion to a Go-source package struct pointer (JS and WASM parity)", async () => {
	const out = await stdParity(`import (
	"encoding/json"
	"io"
	"strconv"
)

func Run() string {
	var eof error = io.EOF
	_, isSyntax := eof.(*json.SyntaxError)
	var v any
	err := json.Unmarshal([]byte("{x"), &v)
	se, ok := err.(*json.SyntaxError)
	if !ok {
		return "not a SyntaxError"
	}
	if isSyntax {
		return "EOF reported as SyntaxError"
	}
	return "ok offset=" + strconv.Itoa(int(se.Offset))
}
`);
	assertEqual(out, "ok offset=2");
});

test("interface dispatch skips same-named methods with other parameters (WASM)", async () => {
	const out = await stdParity(`import "io"

type rows struct{ n int }

func (r *rows) Write(rec []string) error {
	r.n += len(rec)
	return nil
}

type sink struct{ buf []byte }

func (s *sink) Write(p []byte) (int, error) {
	s.buf = append(s.buf, p...)
	return len(p), nil
}

func Run() string {
	var w io.Writer = &sink{}
	w.Write([]byte("abc"))
	rs := &rows{}
	rs.Write([]string{"x", "y"})
	return string(w.(*sink).buf) + "," + string(rune('0'+rs.n))
}
`);
	assertEqual(out, "abc,2");
});

section("Go-source stdlib: slices.Repeat panics");

test("slices.Repeat panics with Go's messages on both backends", async () => {
	const out = await stdParity(`import (
	"fmt"
	"slices"
)

func try(count int) (msg string) {
	msg = "ok"
	defer func() {
		if r := recover(); r != nil {
			msg = fmt.Sprint(r)
		}
	}()
	_ = slices.Repeat([]int{1, 2}, count)
	return msg
}

func Run() string {
	return try(2) + "|" + try(-1) + "|" + try(9223372036854775807)
}
`);
	assertEqual(
		out,
		"ok|cannot be negative|the result of (len(x) * count) overflows",
	);
});

section("Go-source stdlib: pruned packages");

const PRUNED_PACKAGES = [
	"bufio",
	"net/url",
	"encoding/csv",
	"container/heap",
	"container/list",
	"container/ring",
	"hash/adler32",
	"hash/crc32",
	"hash/fnv",
	"crypto/hmac",
	"crypto/md5",
	"crypto/sha1",
	"crypto/sha512",
	"crypto/subtle",
	"encoding/base32",
	"log",
	"math/rand/v2",
	"unicode/utf16",
	"math/cmplx",
	"sync/atomic",
];

for (const pkg of PRUNED_PACKAGES) {
	test(`import "${pkg}" reports that the package is not available`, () => {
		withTempDir(
			{
				"main.go": `package main\n\nimport _ "${pkg}"\n\nfunc main() {}\n`,
			},
			(dir) => {
				let msg = "";
				try {
					compileDir(dir);
				} catch (err) {
					msg = err.message;
				}
				assertContains(msg, `package '${pkg}' is not available`);
			},
		);
	});
}

test("a pruned package gets no missing-types warning", () => {
	const realError = console.error;
	const logged = [];
	console.error = (m) => logged.push(String(m));
	try {
		compile(`package main\nimport _ "net/url"\nfunc main() {}\n`);
	} finally {
		console.error = realError;
	}
	assert(
		!logged.some((m) => m.includes("cannot find types")),
		`unexpected warning: ${logged.join("|")}`,
	);
});

test("an unknown third-party path still compiles with the missing-types warning", () => {
	const realError = console.error;
	const logged = [];
	console.error = (m) => logged.push(String(m));
	let errors;
	try {
		({ errors } = compile(
			`package main\nimport _ "nope/zzz"\nfunc main() {}\n`,
		));
	} finally {
		console.error = realError;
	}
	assertEqual(errors.length, 0);
	assert(
		logged.some((m) => m.includes("cannot find types for 'nope/zzz'")),
		`expected the warning, got: ${logged.join("|")}`,
	);
});

test("kept packages still compile on both backends", async () => {
	const out = await stdParity(`import (
	"encoding/json"
	"hash"
	"strconv"
	"unicode"
)

var _ hash.Hash

func Run() string {
	b, _ := json.Marshal([]int{1, 2})
	return strconv.Itoa(len(b)) + string(unicode.ToUpper('a'))
}
`);
	assertEqual(out, "5A");
});

section("Go-source stdlib: trimmed overlays");

const TRIMMED_MEMBERS = [
	// [package, import path, member, how to mention it]
	...[
		"Is",
		"In",
		"IsOneOf",
		"IsMark",
		"IsNumber",
		"IsSymbol",
		"IsTitle",
		"To",
		"UpperCase",
		"LowerCase",
		"TitleCase",
		"MaxCase",
		"Letter",
		"Digit",
		"Space",
		"Upper",
		"Lower",
		"Punct",
		"Symbol",
		"Mark",
		"Number",
	].map((m) => ["unicode", "unicode", m, "value"]),
	...["RangeTable", "Range16", "Range32"].map((m) => [
		"unicode",
		"unicode",
		m,
		"type",
	]),
	["math", "math", "Gamma", "value"],
	["math", "math", "Erf", "value"],
	["sync", "sync", "Pool", "type"],
	["sync", "sync", "Map", "type"],
	["fmt", "fmt", "Fscan", "value"],
	["fmt", "fmt", "Fscanf", "value"],
	["fmt", "fmt", "Fscanln", "value"],
	["strconv", "strconv", "QuoteToGraphic", "value"],
	["strconv", "strconv", "QuoteRuneToGraphic", "value"],
	["strconv", "strconv", "AppendQuoteToGraphic", "value"],
	["strconv", "strconv", "AppendQuoteRuneToGraphic", "value"],
];

for (const [pkg, path, member, how] of TRIMMED_MEMBERS) {
	for (const target of ["js", "wasm"]) {
		test(`${pkg}.${member} is not supported in a ${target} package`, () => {
			const use =
				how === "type" ? `var _ ${pkg}.${member}` : `var _ = ${pkg}.${member}`;
			const { errors } = compile(
				`//gofront:target ${target}\npackage main\nimport "${path}"\n${use}\nfunc main() {}\n`,
				{ target },
			);
			assertErrorContains(errors, "not supported");
			assertErrorContains(errors, `${pkg}.${member} is not available`);
		});
	}
}

test("the trimmed overlays keep the members the emitters reach", async () => {
	const out = await stdParity(`import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
)

func Run() string {
	frac, exp := math.Frexp(8)
	ip, fp := math.Modf(3.25)
	get := sync.OnceValue(func() int { return 7 })
	return fmt.Sprint(
		strings.EqualFold("σ", "Σ"), " ",
		strings.ToTitle("héllo"), " ",
		strconv.Quote("\u00e9"), " ",
		frac, " ", exp, " ", math.Ldexp(frac, exp), " ", ip, " ", fp, " ",
		get(), get(),
	)
}
`);
	assertEqual(out, 'true HÉLLO "é" 0.5 4 8 3 0.25 7 7');
});

section("Go-source stdlib: //gofront:native");

// A test-only native name; the production set is closed (see NATIVES).
NATIVES.add("str.Index");

const STR_PKG = `//go:build gofront

//gofront:target both

package str

//gofront:native str.Index
func Index(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
`;

const STR_APP = `package main\n\nimport "str"\n\nfunc main() { println(str.Index("hello", "ll")) }\n`;

function compileWithStr(pkg, app = STR_APP) {
	return withTempDir({ "stdlib/str/str.go": pkg, "app/main.go": app }, (dir) =>
		compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") }),
	);
}

test("an unknown native name is rejected", () => {
	assertThrows(
		() => compileWithStr(STR_PKG.replace("str.Index\n", "x\n")),
		"unknown native 'x'",
	);
});

test("a native on a body-less func is rejected", () => {
	assertThrows(
		() =>
			compileWithStr(
				STR_PKG.replace(
					/func Index[\s\S]*$/,
					"func Index(s, sub string) int\n",
				),
			),
		"native 'str.Index' must have a Go body",
	);
});

test("a native outside the standard library is rejected", () => {
	const src = `package main

//gofront:native str.Index
func idx(s, sub string) int { return 0 }

func main() { println(idx("a", "b")) }
`;
	assertErrorContains(
		compile(src).errors,
		"//gofront:native is reserved for the standard library",
	);
});

test("a native on a method is rejected", () => {
	assertThrows(
		() =>
			compileWithStr(
				`${STR_PKG}
type T struct{}

//gofront:native str.Index
func (T) M() {}
`,
			),
		"must mark a function, not a method",
	);
});

test("a registered native name compiles", () => {
	const res = compileWithStr(STR_PKG);
	assert(res.js.includes("Index$$str"), "the Go body is still emitted");
});

section("Go-source stdlib: JS native call sites");

JS_NATIVES.set("str.Index", (a, targs) =>
	targs.length === 0 ? `${a[0]}.indexOf(${a[1]})` : null,
);

const callJs = (body) =>
	compileWithStr(
		STR_PKG,
		`package main\n\nimport "str"\n\nfunc main() {\n${body}\n}\n`,
	).js;

test("a native call site emits the host code", () => {
	const js = callJs(`println(str.Index("hello", "ll"))`);
	assertContains(js, `"hello".indexOf("ll")`);
});

test("a native used as a value calls the Go body", () => {
	const js = callJs(`f := str.Index\nprintln(f("hello", "ll"))`);
	assert(!js.includes(".indexOf("), "a function value must not be inlined");
	assertContains(js, "f(");
});

test("a deferred native call runs the Go body", () => {
	const js = callJs(`defer str.Index("hello", "ll")`);
	assert(!js.includes(".indexOf("), "defer must call the Go body");
});

test("a native that declines calls the Go body", () => {
	JS_NATIVES.set("str.Index", () => null);
	try {
		const js = callJs(`println(str.Index("hello", "ll"))`);
		assert(!js.includes(".indexOf("), "a declined call must not be inlined");
		assertContains(js, "Index$$str(");
	} finally {
		JS_NATIVES.set("str.Index", (a) => `${a[0]}.indexOf(${a[1]})`);
	}
});

test("a native evaluates each argument once, in order", async () => {
	// The template repeats its second argument.
	JS_NATIVES.set(
		"str.Index",
		(a) => `(${a[0]}.indexOf(${a[1]}) + ${a[1]}.length * 0)`,
	);
	try {
		await withTempDir({ "str/str.go": STR_PKG }, async (stdlib) => {
			const res = await compileHybridProject(
				{
					"main.go": `package main

import "str"

var log string

func next(s string) string {
	log += s
	return s
}

func main() {
	println(str.Index(next("hello"), next("ll")), log)
}
`,
				},
				{ stdlibRoot: stdlib },
			);
			assertEqual(res.lines.join("\n"), "2 helloll");
		});
	} finally {
		JS_NATIVES.set("str.Index", (a) => `${a[0]}.indexOf(${a[1]})`);
	}
});

test("a generic native that declines one instantiation calls the Go body", () => {
	NATIVES.add("str.IndexOf");
	JS_NATIVES.set("str.IndexOf", (a, targs) =>
		targs[0]?.name === "float64" ? null : `${a[0]}.indexOf(${a[1]})`,
	);
	const pkg = `${STR_PKG}
//gofront:native str.IndexOf
func IndexOf[T comparable](xs []T, v T) int {
	for i, x := range xs {
		if x == v {
			return i
		}
	}
	return -1
}
`;
	const js = compileWithStr(
		pkg,
		`package main

import "str"

func main() {
	println(str.IndexOf([]int{1, 2}, 2))
	println(str.IndexOf([]float64{1, 2}, 2))
}
`,
	).js;
	assertContains(js, "[1, 2]");
	assertEqual(js.split(".indexOf(").length - 1, 1);
	assertContains(js, "IndexOf$$str(");
});

section("Go-source stdlib: natives off and assertFourWay");

const FOUR_PKG = `//go:build gofront

//gofront:target both

package four

//gofront:native four.Agree
func Agree(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

//gofront:native four.Disagree
func Disagree(s, sub string) int { return Agree(s, sub) }

//gofront:native four.WasmDisagree
func WasmDisagree(s, sub string) int { return Agree(s, sub) }
`;
for (const n of ["Agree", "Disagree", "WasmDisagree"]) NATIVES.add(`four.${n}`);

JS_NATIVES.set("four.Agree", (a) => `${a[0]}.indexOf(${a[1]})`);
JS_NATIVES.set("four.Disagree", (a) => `(${a[0]}.indexOf(${a[1]}) + 1)`);
WASM_NATIVES.set("four.WasmDisagree", {
	emit(e, call, _typeArgs, target) {
		e.emitExpr(call.args[0], "externref");
		e.emitExpr(call.args[1], "externref");
		e.pushInstruction("drop");
		e.pushInstruction("drop");
		e.pushInstruction({ op: "i32.const", value: 41 });
		if ((target ?? "i64") === "i64") e.pushInstruction("i64.extend_i32_s");
		return true;
	},
});

const fourProgram = (fn) => `package main

import "four"

func main() { println(four.${fn}("hello", "ll")) }
`;

test("assertFourWay passes when a native agrees with its Go body", async () => {
	await withTempDir({ "four/four.go": FOUR_PKG }, (stdlib) =>
		assertFourWay(fourProgram("Agree"), "2\n", { stdlibRoot: stdlib }),
	);
});

test("assertFourWay names a JS native that disagrees with its Go body", async () => {
	await withTempDir({ "four/four.go": FOUR_PKG }, async (stdlib) => {
		let msg = null;
		try {
			await assertFourWay(fourProgram("Disagree"), "2\n", {
				stdlibRoot: stdlib,
			});
		} catch (e) {
			msg = e.message;
		}
		assert(msg !== null, "a disagreeing native must fail");
		assertContains(msg, "js (natives on)");
	});
});

test("assertFourWay names a WASM native that disagrees with its Go body", async () => {
	await withTempDir({ "four/four.go": FOUR_PKG }, async (stdlib) => {
		let msg = null;
		try {
			await assertFourWay(fourProgram("WasmDisagree"), "2\n", {
				stdlibRoot: stdlib,
			});
		} catch (e) {
			msg = e.message;
		}
		assert(msg !== null, "a disagreeing native must fail");
		assertContains(msg, "wasm (natives on)");
	});
});

const FX_PKG = `//go:build gofront

//gofront:target both

package fx

//gofront:native fx.Hit
func Hit() int {
	println("body")
	return 1
}
`;
NATIVES.add("fx.Hit");
JS_NATIVES.set("fx.Hit", () => "1");
WASM_NATIVES.set("fx.Hit", {
	emit(e) {
		e.pushInstruction({ op: "i64.const", value: 1n });
		return true;
	},
});

test("a deferred native call runs the Go body on both backends", async () => {
	await withTempDir({ "fx/fx.go": FX_PKG }, async (stdlib) => {
		const res = await compileHybridProgram(
			`package main

import "fx"

func main() {
	defer fx.Hit()
}
`,
			{ stdlibRoot: stdlib },
		);
		assertEqual(`wasm:${res.wasm}`, "wasm:body\n");
		assertEqual(`js:${res.js}`, "js:body\n");
	});
});

test("a package-level variable holding a native is not a native call", async () => {
	await withTempDir({ "fx/fx.go": FX_PKG }, async (stdlib) => {
		const res = await compileHybridProgram(
			`package main

import "fx"

var F = fx.Hit

func main() {
	F()
}
`,
			{ stdlibRoot: stdlib },
		);
		assertEqual(res.js, "body\n");
		assertEqual(res.wasm, "body\n");
	});
});

test("natives off runs the Go body on both backends", async () => {
	await withTempDir({ "four/four.go": FOUR_PKG }, async (stdlib) => {
		for (const fn of ["Disagree", "WasmDisagree"]) {
			const off = await compileHybridProgram(fourProgram(fn), {
				natives: false,
				stdlibRoot: stdlib,
			});
			assertEqual(off.js, "2\n");
			assertEqual(off.wasm, "2\n");
		}
	});
});

section("Go-source stdlib: lazy body checking");

// A Go-source package of `count` functions of 14 lines each (about 5,600
// lines for 400): Fn returns a distinct value, so the bodies are checkable
// but never call one another.
function bigPackage(count, extra = "") {
	const fns = [];
	for (let i = 0; i < count; i++)
		fns.push(`func F${i}(x int) int {
	total := 0
	for i := 0; i < x; i++ {
		if i%2 == 0 {
			total += i * ${i + 1}
		} else {
			total -= ${i}
		}
	}
	return total
}
`);
	return `//go:build gofront

//gofront:target both

package big

${fns.join("\n")}
${extra}
`;
}

// Compiles `main` against a temp stdlib holding `big`; returns the build and
// the stdlib cache (to read the checker's statistics).
function compileBig(pkg, mainBody) {
	const stdlibCache = new Map();
	const res = withTempDir(
		{
			"stdlib/big/big.go": pkg,
			"app/main.go": `package main\n\nimport "big"\n\nfunc main() {\n${mainBody}\n}\n`,
		},
		(dir) =>
			compileDir(join(dir, "app"), {
				stdlibRoot: join(dir, "stdlib"),
				stdlibCache,
			}),
	);
	return { res, checker: stdlibCache.get("big").checker };
}

test("a large package checks only the bodies a call reaches", () => {
	const pkg = bigPackage(480);
	assert(pkg.split("\n").length >= 5600, "the package is about 5,600 lines");
	const { checker } = compileBig(pkg, "println(big.F7(3))");
	assert(
		checker.stats.bodiesChecked <= 10,
		`checked ${checker.stats.bodiesChecked} bodies`,
	);
	assertEqual(checker.stats.bodiesChecked, 1);
});

test("a type error in an unreached body is not reported", () => {
	const pkg = bigPackage(3, `func Broken() int { return "x" }`);
	const { res } = compileBig(pkg, "println(big.F1(3))");
	assertContains(res.js, "F1$$big");
	assert(!res.js.includes("Broken"), "an unreached function is not emitted");
});

test("a type error in a reached body is reported at the call", () => {
	const pkg = bigPackage(3, `func Broken() int { return "x" }`);
	assertThrows(
		() => compileBig(pkg, "println(big.Broken())"),
		"internal stdlib error in big; please report",
	);
	assertThrows(
		() => compileBig(pkg, "println(big.Broken())"),
		"Type error in main.go",
	);
});

test("a body reached through another body is checked and reported", () => {
	const pkg = bigPackage(
		3,
		`func Outer() int { return inner() }\nfunc inner() int { return "x" }`,
	);
	assertThrows(
		() => compileBig(pkg, "println(big.Outer())"),
		"internal stdlib error in big; please report",
	);
});

test("a wasm package checks the Go-source bodies it reaches", async () => {
	const pkg = bigPackage(3, `func Broken() int { return "x" }`);
	await withTempDir({ "big/big.go": pkg }, async (stdlib) => {
		const res = await compileHybridProject(
			{
				"lib/lib.go": `//gofront:target wasm
package lib

import "big"

func Run() int { return big.F2(4) }
`,
				"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
			},
			{ stdlibRoot: stdlib },
		);
		assertEqual(res.lines.join("\n"), "2");
	});
});

test("diagnostics for an existing package are unchanged", () => {
	withTempDir(
		{
			"main.go": `package main

import "cmp"

func main() { println(cmp.Compare(1, "a")) }
`,
		},
		(dir) =>
			assertThrows(
				() => compileDir(dir),
				`Type error in main.go at line 5:38: Cannot assign untyped string to int`,
			),
	);
});

section("Go-source stdlib: per-file targets");

const DUAL_FILES = {
	"stdlib/dual/dual.go": `//go:build gofront

//gofront:target both

package dual

func Common() int { return 40 }
`,
	"stdlib/dual/dual_js.go": `//go:build gofront

//gofront:target js

package dual

type Handle struct{ id any }

var pending = 0

// A js file may use browser globals and async functions.
async func Sleepish() int {
	await Promise.resolve(1)
	pending++
	return Common() + pending
}

func Arm(f func()) *Handle { return &Handle{id: setTimeout(f, 0)} }
`,
	"stdlib/onlyjs/onlyjs.go": `//go:build gofront

//gofront:target js

package onlyjs

func Name() string { return "js" }
`,
};

test("a js importer sees every file of a mixed package", async () => {
	await withTempDir(DUAL_FILES, async (dir) => {
		const res = await compileHybridProject(
			{
				"main.go": `package main

import "dual"

async func main() {
	println(dual.Common(), await dual.Sleepish())
	var h *dual.Handle = dual.Arm(func() { println("armed") })
	_ = h
}
`,
			},
			{ stdlibRoot: join(dir, "stdlib") },
		);
		assertEqual(res.lines.join("\n"), "40 41");
	});
});

test("a wasm or both importer gets the shared files and a diagnostic for the rest", () => {
	for (const target of ["wasm", "both"]) {
		withTempDir(
			{
				...DUAL_FILES,
				"app/main.go": `//gofront:target ${target}
package main

import "dual"

func F() int { return dual.Common() }
`,
				"bad/main.go": `//gofront:target ${target}
package main

import "dual"

func F() { dual.Sleepish() }
`,
				"badtype/main.go": `//gofront:target ${target}
package main

import "dual"

func F(h *dual.Handle) {}
`,
			},
			(dir) => {
				const stdlibRoot = join(dir, "stdlib");
				compileDir(join(dir, "app"), { stdlibRoot });
				assertThrows(
					() => compileDir(join(dir, "bad"), { stdlibRoot }),
					"'dual.Sleepish' is only available in js packages",
				);
				assertThrows(
					() => compileDir(join(dir, "badtype"), { stdlibRoot }),
					"'dual.Handle' is only available in js packages",
				);
			},
		);
	}
});

test("a package whose files are all js is rejected at the import of a wasm or both package", () => {
	for (const target of ["wasm", "both"]) {
		withTempDir(
			{
				...DUAL_FILES,
				"app/main.go": `//gofront:target ${target}
package main

import "onlyjs"

func F() string { return onlyjs.Name() }
`,
			},
			(dir) => {
				let msg = "";
				try {
					compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") });
				} catch (e) {
					msg = e.message;
				}
				assertContains(
					msg,
					"package 'onlyjs' is only available in js packages",
				);
				assert(!msg.includes("Undefined: 'onlyjs'"), msg);
			},
		);
	}
});

test("js and wasm importers of one mixed package share a build", async () => {
	await withTempDir(DUAL_FILES, async (dir) => {
		const res = await compileHybridProject(
			{
				"lib/lib.go": `//gofront:target wasm
package lib

import "dual"

func Run() int { return dual.Common() }
`,
				"main.go": `package main

import (
	"./lib"
	"dual"
)

async func main() {
	println(lib.Run(), await dual.Sleepish())
}
`,
			},
			{ stdlibRoot: join(dir, "stdlib") },
		);
		assertEqual(res.lines.join("\n"), "40 41");
	});
});
