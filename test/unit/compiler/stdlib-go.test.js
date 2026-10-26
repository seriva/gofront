// Go-source stdlib: packages written in GoFront Go under stdlib/,
// compiled into the caller's target (js, wasm, or both).

import { STDLIB_PACKAGES } from "../../../src/typechecker/types.js";
import {
	assert,
	assertEqual,
	assertThrows,
	compileDir,
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
			"stdlib/errors/overlay.go": `//go:build gofront

//gofront:target both

package errors

func New(text string) error { return nil }
`,
			"app/main.go": `package main

import "errors"

func main() { println(errors.New("x") != nil) }
`,
		},
		(dir) => {
			assertThrows(
				() => compileDir(join(dir, "app"), { stdlibRoot: join(dir, "stdlib") }),
				"overlay redeclares errors.New",
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

test("deadline_timer arms setTimeout in JS and is a no-op in wasm", async () => {
	const project = (target) => ({
		"lib/lib.go": `//gofront:target ${target}
package lib

import "timer"

func Run() string {
	timer.After(1, func() { println("fired") })
	return "armed"
}
`,
		"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
	});
	await withTempDir({ "timer/timer.go": TIMER_PKG }, async (stdlib) => {
		const js = await compileHybridProject(project("both"), {
			stdlibRoot: stdlib,
		});
		const wasm = await compileHybridProject(project("wasm"), {
			stdlibRoot: stdlib,
		});
		assert(wasm.wasm instanceof Uint8Array, "expected linked wasm");
		await new Promise((r) => setTimeout(r, 20));
		assertEqual(js.lines.join("\n"), "armed\nfired");
		assertEqual(wasm.lines.join("\n"), "armed");
	});
});

test("the deadline_timer stop func clears the JS timer", async () => {
	const project = (target) => ({
		"lib/lib.go": `//gofront:target ${target}
package lib

import "timer"

func Run() string {
	stop := timer.AfterStoppable(1, func() { println("fired") })
	stop()
	return "stopped"
}
`,
		"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
	});
	await withTempDir({ "timer/timer.go": TIMER_PKG }, async (stdlib) => {
		const js = await compileHybridProject(project("both"), {
			stdlibRoot: stdlib,
		});
		const wasm = await compileHybridProject(project("wasm"), {
			stdlibRoot: stdlib,
		});
		assert(wasm.wasm instanceof Uint8Array, "expected linked wasm");
		await new Promise((r) => setTimeout(r, 20));
		assertEqual(js.lines.join("\n"), "stopped");
		assertEqual(wasm.lines.join("\n"), "stopped");
	});
});

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
			"main.go": `package main\n\nimport e "errors"\n\nfunc main() { println(e.New("x").Error()) }\n`,
		},
		(dir) => {
			assertThrows(
				() => compileDir(dir),
				"import alias for 'errors' is not supported",
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

section("Portable Go Phase 3.2 review feedback: io & fmt.Fscan fixes");

test("fmt.Fscan returns n=0 on parse failure (JS and WASM parity)", async () => {
	const out = await stdParity(`import (
	"fmt"
	"strings"
)

func Run() string {
	r := strings.NewReader("xyz")
	var a int
	n, err := fmt.Fscan(r, &a)
	return fmt.Sprintf("n=%d err=%t a=%d", n, err != nil, a)
}
`);
	assertEqual(out, "n=0 err=true a=0");
});

test("fmt.Fscan with all integer pointer types (JS and WASM parity)", async () => {
	const out = await stdParity(`import (
	"fmt"
	"strings"
)

func Run() string {
	var (
		i64 int64
		u   uint
		u64 uint64
		u32 uint32
		u16 uint16
		u8  uint8
		i16 int16
		i8  int8
	)
	r := strings.NewReader("10 20 30 40 50 60 70 80")
	n, err := fmt.Fscan(r, &i64, &u, &u64, &u32, &u16, &u8, &i16, &i8)
	return fmt.Sprintf("n=%d err=%t vals=%d,%d,%d,%d,%d,%d,%d,%d",
		n, err != nil, i64, u, u64, u32, u16, u8, i16, i8)
}
`);
	assertEqual(out, "n=8 err=false vals=10,20,30,40,50,60,70,80");
});

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

test("context.Context.Done reports exclusion diagnostic", () => {
	withTempDir(
		{
			"main.go": `package main

import "context"

func use(ctx context.Context) {
	_ = ctx.Done()
}

func main() {}
`,
		},
		(dir) => {
			let threw = false;
			try {
				compileDir(dir);
			} catch (err) {
				threw = true;
				assert(
					err.message.includes("Done() returns a channel"),
					`expected channel diagnostic, got: ${err.message}`,
				);
			}
			assert(threw, "expected compile error for ctx.Done()");
		},
	);
});

test("type assertion to a Go-source package struct pointer (JS and WASM parity)", async () => {
	const out = await stdParity(`import (
	"encoding/csv"
	"io"
	"strings"
)

func Run() string {
	var eof error = io.EOF
	_, isParse := eof.(*csv.ParseError)
	r := csv.NewReader(strings.NewReader("a\\"b,c\\n"))
	_, err := r.Read()
	pe, ok := err.(*csv.ParseError)
	if !ok {
		return "not a ParseError"
	}
	if isParse {
		return "EOF reported as ParseError"
	}
	return "ok line=" + string(rune('0'+pe.Line))
}
`);
	assertEqual(out, "ok line=1");
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
