// GoFront test suite — `iter` package and the slices iterator members
// (runtime/stdlib/iter, runtime/stdlib/slices/iter.go overlay).

import { compileDir } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compileHybridProject,
	section,
	test,
	withTempDir,
} from "../helpers.js";

// Builds `lib` once as `both` (JS code path) and once as `wasm` (linked
// module behind the facade), calls `lib.Run()` from a JS root, and returns the
// printed line.  Throws when the two backends disagree.
async function iterParity(libBody) {
	const run = async (target) => {
		const res = await compileHybridProject({
			"lib/lib.go": `//gofront:target ${target}\npackage lib\n\n${libBody}`,
			"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
		});
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

// Same as iterParity for one target only ("wasm" or "both").
async function iterRun(target, libBody) {
	const res = await compileHybridProject({
		"lib/lib.go": `//gofront:target ${target}\npackage lib\n\n${libBody}`,
		"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
	});
	return res.lines.join("\n");
}

// The error message of compiling `main.go` as a js package ("" on success).
function compileError(source) {
	return withTempDir({ "main.go": source }, (dir) => {
		try {
			compileDir(dir);
			return "";
		} catch (e) {
			return e.message;
		}
	});
}

section("iter: Seq and Seq2");

const COUNT = `func count(n int) iter.Seq[int] {
	return func(yield func(int) bool) {
		for i := 0; i < n; i++ {
			if !yield(i) {
				return
			}
		}
	}
}
`;

test("range over iter.Seq[int] returned from a user function", async () => {
	const out = await iterParity(`import (
	"fmt"
	"iter"
)

${COUNT}
func Run() string {
	s := ""
	for v := range count(4) {
		s += fmt.Sprintf("%d,", v)
	}
	return s
}
`);
	assertEqual(out, "0,1,2,3,");
});

test("break out of a range over iter.Seq stops the sequence", async () => {
	const out = await iterParity(`import (
	"fmt"
	"iter"
)

${COUNT}
func Run() string {
	s := ""
	for v := range count(100) {
		if v == 3 {
			break
		}
		s += fmt.Sprintf("%d", v)
	}
	return s
}
`);
	assertEqual(out, "012");
});

test("range over iter.Seq2 and a func literal assigned to iter.Seq2", async () => {
	const out = await iterParity(`import (
	"fmt"
	"iter"
)

func pairs(keys []string) iter.Seq2[string, int] {
	return func(yield func(string, int) bool) {
		for i, k := range keys {
			if !yield(k, i*10) {
				return
			}
		}
	}
}

func Run() string {
	s := ""
	for k, v := range pairs([]string{"a", "b"}) {
		s += fmt.Sprintf("%s=%d ", k, v)
	}
	var seq iter.Seq2[string, int] = func(yield func(string, int) bool) {
		yield("z", 1)
	}
	for k, v := range seq {
		s += fmt.Sprintf("%s=%d", k, v)
	}
	return s
}
`);
	assertEqual(out, "a=0 b=10 z=1");
});

test("iter.Seq as a parameter type", async () => {
	const out = await iterParity(`import "iter"

${COUNT}
func sum(seq iter.Seq[int]) int {
	t := 0
	for v := range seq {
		t += v
	}
	return t
}

func Run() int { return sum(count(5)) }
`);
	assertEqual(out, "10");
});

test("a js package uses iter.Seq only in type positions", async () => {
	const res = await compileHybridProject({
		"main.go": `package main

import "iter"

${COUNT}
func main() {
	n := 0
	for range count(3) {
		n++
	}
	println(n)
}
`,
	});
	assertEqual(res.lines.join("\n"), "3");
	assert(res.wasm === null, "a js-only program must not link app.wasm");
});

test("iter.Pull reports that it needs coroutines", () => {
	const msg = compileError(`package main

import "iter"

func main() {
	var seq iter.Seq[int] = func(yield func(int) bool) {}
	next, stop := iter.Pull(seq)
	_, _ = next, stop
}
`);
	assert(
		msg.includes(
			"iter.Pull is not available: requires coroutines; out of scope (no runtime)",
		),
		`expected the Pull diagnostic, got: ${msg}`,
	);
});

test("iter.Pull2 reports that it needs coroutines", () => {
	const msg = compileError(`package main

import "iter"

func main() { _ = iter.Pull2 }
`);
	assert(
		msg.includes(
			"iter.Pull2 is not available: requires coroutines; out of scope (no runtime)",
		),
		`expected the Pull2 diagnostic, got: ${msg}`,
	);
});

test("an unknown iter member is still a plain missing-member error", () => {
	assertThrows(
		() =>
			withTempDir(
				{
					"main.go": `package main\n\nimport "iter"\n\nfunc main() { _ = iter.Push }\n`,
				},
				(dir) => compileDir(dir),
			),
		"No member 'Push' in namespace iter",
	);
});

section("slices: All, Values, Backward, Collect, AppendSeq");

test("slices.All, Values and Backward", async () => {
	const out = await iterParity(`import (
	"fmt"
	"slices"
)

func Run() string {
	xs := []string{"a", "b", "c"}
	s := ""
	for i, v := range slices.All(xs) {
		s += fmt.Sprintf("%d%s", i, v)
	}
	s += " "
	for v := range slices.Values(xs) {
		s += v
	}
	s += " "
	for i, v := range slices.Backward(xs) {
		s += fmt.Sprintf("%d%s", i, v)
	}
	return s
}
`);
	assertEqual(out, "0a1b2c abc 2c1b0a");
});

test("early break from slices.All and slices.Backward", async () => {
	const out = await iterParity(`import (
	"fmt"
	"slices"
)

func Run() string {
	xs := []int{5, 6, 7, 8}
	s := ""
	for i, v := range slices.All(xs) {
		if i == 2 {
			break
		}
		s += fmt.Sprintf("%d", v)
	}
	for _, v := range slices.Backward(xs) {
		if v == 6 {
			break
		}
		s += fmt.Sprintf("%d", v)
	}
	return s
}
`);
	assertEqual(out, "5687");
});

test("slices.Collect and slices.AppendSeq", async () => {
	const out = await iterParity(`import (
	"fmt"
	"slices"
)

func Run() string {
	xs := []float64{1.5, 2.5}
	ys := slices.Collect(slices.Values(xs))
	ys[0] = 9
	zs := slices.AppendSeq([]float64{0}, slices.Values(xs))
	var none []int
	empty := slices.Collect(slices.Values(none))
	return fmt.Sprintf("%v %v %v %d %v", xs, ys, zs, len(empty), empty == nil)
}
`);
	assertEqual(out, "[1.5 2.5] [9 2.5] [0 1.5 2.5] 0 true");
});

test("slices.Collect of a user sequence of structs", async () => {
	const out = await iterParity(`import (
	"iter"
	"slices"
)

type P struct {
	Name string
	Age  int
}

func adults(ps []P) iter.Seq[P] {
	return func(yield func(P) bool) {
		for _, p := range ps {
			if p.Age >= 18 && !yield(p) {
				return
			}
		}
	}
}

func Run() string {
	got := slices.Collect(adults([]P{{"a", 20}, {"b", 3}, {"c", 40}}))
	s := ""
	for _, p := range got {
		s += p.Name
	}
	return s
}
`);
	assertEqual(out, "ac");
});

test("slices.Values over a named slice type", async () => {
	const out = await iterParity(`import (
	"slices"
	"strings"
)

type Names []string

func Run() string {
	ns := Names{"x", "y"}
	return strings.Join(slices.Collect(slices.Values(ns)), "+")
}
`);
	assertEqual(out, "x+y");
});

section("slices: Sorted, SortedFunc, SortedStableFunc, Chunk");

test("slices.Sorted and slices.SortedFunc", async () => {
	const out = await iterParity(`import (
	"fmt"
	"slices"
	"strings"
)

func Run() string {
	xs := []int{3, 1, 2}
	a := slices.Sorted(slices.Values(xs))
	b := slices.SortedFunc(slices.Values(xs), func(x, y int) int { return y - x })
	c := slices.Sorted(slices.Values([]string{"b", "c", "a"}))
	return fmt.Sprintf("%v %v %v %s", xs, a, b, strings.Join(c, ""))
}
`);
	assertEqual(out, "[3 1 2] [1 2 3] [3 2 1] abc");
});

test("slices.SortedStableFunc keeps the order of equal elements", async () => {
	const out = await iterParity(`import "slices"

type P struct {
	Name string
	Age  int
}

func Run() string {
	ps := []P{{"d", 2}, {"b", 1}, {"a", 2}, {"c", 1}, {"e", 2}}
	got := slices.SortedStableFunc(slices.Values(ps), func(x, y P) int { return x.Age - y.Age })
	s := ""
	for _, p := range got {
		s += p.Name
	}
	return s
}
`);
	assertEqual(out, "bcdae");
});

test("slices.Chunk yields clipped sub-slices", async () => {
	const out = await iterParity(`import (
	"fmt"
	"slices"
)

func Run() string {
	s := ""
	for c := range slices.Chunk([]int{1, 2, 3, 4, 5}, 2) {
		s += fmt.Sprintf("%v/%d ", c, cap(c))
	}
	var none []int
	n := 0
	for range slices.Chunk(none, 3) {
		n++
	}
	for c := range slices.Chunk([]int{1, 2, 3}, 5) {
		s += fmt.Sprintf("%v ", c)
	}
	return fmt.Sprintf("%s%d", s, n)
}
`);
	assertEqual(out, "[1 2]/2 [3 4]/2 [5]/1 [1 2 3] 0");
});

test("appending to a chunk does not modify the original slice", async () => {
	const out = await iterParity(`import (
	"fmt"
	"slices"
)

func Run() string {
	xs := []int{1, 2, 3, 4}
	for c := range slices.Chunk(xs, 2) {
		c = append(c, 0)
		_ = c
		break
	}
	return fmt.Sprintf("%v", xs)
}
`);
	assertEqual(out, "[1 2 3 4]");
});

test("slices.Chunk panics on n < 1 with Go's message", async () => {
	const out = await iterParity(`import (
	"fmt"
	"slices"
)

func Run() (s string) {
	defer func() { s = fmt.Sprintf("%v", recover()) }()
	slices.Chunk([]int{1}, 0)
	return "no panic"
}
`);
	assertEqual(out, "cannot be less than 1");
});

section("maps: iterator members");

test("for k := range maps.Keys(m) and maps.Values", async () => {
	const out = await iterParity(`import (
	"fmt"
	"maps"
	"slices"
)

func Run() string {
	m := map[string]int{"a": 1, "b": 2, "c": 3}
	var ks []string
	for k := range maps.Keys(m) {
		ks = append(ks, k)
	}
	slices.Sort(ks)
	sum := 0
	for v := range maps.Values(m) {
		sum += v
	}
	return fmt.Sprintf("%v %d", ks, sum)
}
`);
	assertEqual(out, "[a b c] 6");
});

test("maps.All yields every pair and stops on break", async () => {
	const out = await iterParity(`import (
	"fmt"
	"maps"
)

func Run() string {
	m := map[int]string{1: "x", 2: "y", 3: "z"}
	s := ""
	n := 0
	for k, v := range maps.All(m) {
		s += fmt.Sprintf("%d%s", k, v)
		n++
	}
	seen := 0
	for range maps.All(m) {
		seen++
		break
	}
	return fmt.Sprintf("%d %d %d", n, len(s), seen)
}
`);
	assertEqual(out, "3 6 1");
});

test("maps.Insert and maps.Collect over sequences", async () => {
	const out = await iterParity(`import (
	"fmt"
	"maps"
	"slices"
)

func Run() string {
	src := map[string]int{"a": 1, "b": 2}
	dst := map[string]int{"a": 9, "z": 26}
	maps.Insert(dst, maps.All(src))
	c := maps.Collect(maps.All(dst))
	c["q"] = 5
	ks := slices.Sorted(maps.Keys(c))
	return fmt.Sprintf("%v %d %d %d %d", ks, dst["a"], dst["b"], dst["z"], len(c))
}
`);
	assertEqual(out, "[a b q z] 1 2 26 4");
});

test("slices.Sorted(maps.Keys(m)) and slices.Collect(maps.Values(m))", async () => {
	const out = await iterParity(`import (
	"fmt"
	"maps"
	"slices"
)

type P struct{ X int }

func Run() string {
	m := map[int]P{3: {30}, 1: {10}, 2: {20}}
	ks := slices.Sorted(maps.Keys(m))
	vs := slices.Collect(maps.Values(m))
	slices.SortFunc(vs, func(a, b P) int { return a.X - b.X })
	return fmt.Sprintf("%v %v", ks, vs)
}
`);
	assertEqual(out, "[1 2 3] [{10} {20} {30}]");
});

test("slices.Sorted(maps.Keys(m)) on a WASM map with NaN keys keeps each entry", async () => {
	const out = await iterRun(
		"wasm",
		`import (
	"fmt"
	"maps"
	"math"
	"slices"
)

func Run() string {
	m := map[float64]int{}
	m[math.NaN()] = 1
	m[math.NaN()] = 2
	m[1.5] = 3
	keys := slices.Sorted(maps.Keys(m))
	nan := 0
	for _, k := range keys {
		if k != k {
			nan++
		}
	}
	sum := 0
	for v := range maps.Values(m) {
		sum += v
	}
	return fmt.Sprintf("%d %d %d %d", len(m), len(keys), nan, sum)
}
`,
	);
	assertEqual(out, "3 3 2 6");
});

test("sort.Strings(maps.Keys(m)) reports the slices.Collect hint", () => {
	const msg = compileError(`package main

import (
	"maps"
	"sort"
)

func main() {
	m := map[string]int{"a": 1}
	sort.Strings(maps.Keys(m))
}
`);
	assert(
		msg.includes("use slices.Collect(maps.Keys(m)) for a slice"),
		`missing hint: ${msg}`,
	);
	assert(msg.includes("iter.Seq[string]"), `missing type: ${msg}`);
});

test("assigning maps.Values(m) to a slice reports the hint", () => {
	const msg = compileError(`package main

import "maps"

func main() {
	m := map[string]int{"a": 1}
	var vs []int = maps.Values(m)
	_ = vs
}
`);
	assert(
		msg.includes("use slices.Collect(maps.Values(m)) for a slice"),
		`missing hint: ${msg}`,
	);
});

// compileError wrapped as the `errors` array assertErrorContains expects.
function compileErrors(source) {
	return [{ message: compileError(source) }];
}

const SEQ_SLICE_HINT = "use slices.Collect(maps.Keys(m)) for a slice";

test("len(maps.Keys(m)) is rejected with the slices.Collect hint", () => {
	const errors = compileErrors(`package main

import "maps"

func main() {
	m := map[string]int{"a": 1}
	_ = len(maps.Keys(m))
}
`);
	assertErrorContains(errors, "iter.Seq[string]");
	assertErrorContains(errors, SEQ_SLICE_HINT);
});

test("append(a, maps.Keys(m)...) is rejected with the slices.Collect hint", () => {
	const errors = compileErrors(`package main

import "maps"

func main() {
	m := map[string]int{"a": 1}
	a := []string{}
	a = append(a, maps.Keys(m)...)
	_ = a
}
`);
	assertErrorContains(errors, "iter.Seq[string]");
	assertErrorContains(errors, SEQ_SLICE_HINT);
});

test("[]string(maps.Keys(m)) is rejected with the slices.Collect hint", () => {
	const errors = compileErrors(`package main

import "maps"

func main() {
	m := map[string]int{"a": 1}
	ks := []string(maps.Keys(m))
	_ = ks
}
`);
	assertErrorContains(errors, "iter.Seq[string]");
	assertErrorContains(errors, SEQ_SLICE_HINT);
});

test("cap, spread and conversion of a plain iter.Seq value use the generic hint", () => {
	const errors = compileErrors(`package main

import "iter"

func f(xs ...int) {}

func main() {
	var s iter.Seq[int]
	_ = cap(s)
	f(s...)
	_ = []int(s)
}
`);
	assertErrorContains(errors, "use slices.Collect(seq) for a slice");
});

test("plain func types keep len/cap/spread leniency", () => {
	const errors = compileErrors(`package main

func main() {
	f := func() {}
	_ = len(f)
}
`);
	assertEqual(errors[0].message, "");
});

section("strings and bytes: sequence members");

test("strings sequence members in a js-only program", async () => {
	const res = await compileHybridProject({
		"main.go": `package main

import (
	"slices"
	"strings"
)

func main() {
	println(len(slices.Collect(strings.SplitSeq("a,b,c", ","))))
	n := 0
	for range strings.Lines("x\\ny\\n") {
		n++
	}
	println(n)
	for f := range strings.FieldsSeq(" p  q ") {
		println(f)
	}
}
`,
	});
	assertEqual(res.lines.join("|"), "3|2|p|q");
	assert(res.wasm === null, "a js-only program must not link app.wasm");
});

test("strings.SplitSeq with a non-ASCII separator agrees on both backends", async () => {
	const out = await iterParity(
		`import (
	"slices"
	"strings"
)

func Run() string {
	parts := slices.Collect(strings.SplitSeq("héllo wörld", "ö"))
	return strings.Join(parts, "|")
}
`,
	);
	assertEqual(out, "héllo w|rld");
});

test("bytes sequence members agree on both backends", async () => {
	const out = await iterParity(
		`import (
	"bytes"
	"fmt"
	"slices"
)

func Run() string {
	n := 0
	for p := range bytes.SplitSeq([]byte("héllo wörld"), []byte("ö")) {
		n += len(p)
	}
	lines := slices.Collect(bytes.Lines([]byte("a\\nbb\\n")))
	return fmt.Sprintf("%d %d %d", n, len(lines), cap(lines[0]))
}
`,
	);
	assertEqual(out, "11 2 2");
});

test("strings.FieldsFuncSeq stops when the loop breaks", async () => {
	const out = await iterParity(
		`import "strings"

func Run() string {
	seen := 0
	isDigit := func(r rune) bool { return r >= '0' && r <= '9' }
	for range strings.FieldsFuncSeq("a1b2c3d", isDigit) {
		seen++
		if seen == 2 {
			break
		}
	}
	return string(rune('0' + seen))
}
`,
	);
	assertEqual(out, "2");
});
