// test/unit/wasm/maps.test.js
// Tests for Phase H4 Task H4.3: Maps & stdlib in WASM and JS-strict parity.

import {
	assertEqual,
	assertProgramOutput,
	compile,
	compileHybrid,
	compileHybridProject,
	runJs,
	section,
	test,
} from "../helpers.js";

// maps.Keys/Values are Go-source (iter.Seq), which the single-file
// `compileHybrid` helper does not load: build `src` (a package with
// `Main() string`) as a project's lib, once as wasm and once as both.
async function runMapsProject(src) {
	const run = async (target) => {
		const res = await compileHybridProject({
			"lib/lib.go": `//gofront:target ${target}\n${src.replace("package main", "package lib")}`,
			"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Main()) }\n`,
		});
		return res.lines.join("\n");
	};
	return { wasmRes: await run("wasm"), jsRes: await run("both") };
}

section("WASM Maps — Basics & CRUD");

test("make(map[string]int) with index write, read, len and mutation", () => {
	const src = `
package main

func Main() string {
	m := make(map[string]int)
	if len(m) != 0 {
		return "fail len 0"
	}
	m["apple"] = 5
	m["banana"] = 12
	if len(m) != 2 {
		return "fail len 2"
	}
	if m["apple"] != 5 || m["banana"] != 12 {
		return "fail lookup"
	}
	if m["cherry"] != 0 {
		return "fail missing key zero"
	}
	m["apple"] = 42
	if m["apple"] != 42 || len(m) != 2 {
		return "fail update"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("make(map[int]string, hint) with integer keys", () => {
	const src = `
package main

func Main() string {
	m := make(map[int]string, 16)
	m[10] = "ten"
	m[20] = "twenty"
	m[-5] = "minus five"
	if m[10] != "ten" || m[20] != "twenty" || m[-5] != "minus five" {
		return "fail lookup"
	}
	if m[99] != "" {
		return "fail missing"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("Map composite literal map[string]int{...} and empty literal", () => {
	const src = `
package main

func Main() string {
	m1 := map[string]int{
		"alpha": 100,
		"beta":  200,
		"gamma": 300,
	}
	if len(m1) != 3 || m1["alpha"] != 100 || m1["gamma"] != 300 {
		return "fail m1"
	}
	m2 := map[string]int{}
	if len(m2) != 0 || m2["any"] != 0 {
		return "fail m2"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("Map compound assignment and inc/dec", () => {
	const src = `
package main

func Main() string {
	counts := make(map[string]int)
	counts["visits"]++
	counts["visits"]++
	counts["visits"] += 8
	counts["visits"]--
	if counts["visits"] != 9 {
		return "fail visits"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

section("WASM Maps — Comma-ok Lookups");

test("Comma-ok define and assign: v, ok := m[k]", () => {
	const src = `
package main

func Main() string {
	m := map[string]int{"x": 10}
	vx, okx := m["x"]
	if !okx || vx != 10 {
		return "fail present"
	}
	vy, oky := m["y"]
	if oky || vy != 0 {
		return "fail missing"
	}

	var v int
	var ok bool
	v, ok = m["x"]
	if !ok || v != 10 {
		return "fail assign present"
	}
	v, ok = m["y"]
	if ok || v != 0 {
		return "fail assign missing"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

section("WASM Maps — Deletion, Clear & Freelist");

test("delete(m, k) and clear(m)", () => {
	const src = `
package main

func Main() string {
	m := map[string]int{"a": 1, "b": 2, "c": 3}
	delete(m, "b")
	if len(m) != 2 || m["b"] != 0 {
		return "fail delete b"
	}
	delete(m, "nonexistent")
	if len(m) != 2 {
		return "fail delete missing"
	}
	// Slot reuse: insert new key into freed slot
	m["d"] = 4
	if len(m) != 3 || m["d"] != 4 || m["a"] != 1 || m["c"] != 3 {
		return "fail reuse"
	}
	clear(m)
	if len(m) != 0 || m["a"] != 0 || m["d"] != 0 {
		return "fail clear"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

section("WASM Maps — Nil Map Semantics");

test("Reading, len, delete, clear, and comma-ok on nil map", () => {
	const src = `
package main

func Main() string {
	var m map[string]int
	if len(m) != 0 {
		return "fail len nil"
	}
	if m["test"] != 0 {
		return "fail get nil"
	}
	v, ok := m["test"]
	if ok || v != 0 {
		return "fail comma-ok nil"
	}
	delete(m, "test")
	clear(m)
	count := 0
	for range m {
		count++
	}
	if count != 0 {
		return "fail range nil"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("Assignment to entry in nil map traps with runtime panic", () => {
	const src = `
package main

func Main() (res string) {
	defer func() {
		if r := recover(); r != nil { res = r.(string) }
	}()
	var m map[string]int
	m["key"] = 123
	return "nopanic"
}
`;
	// Both backends panic (strict mode in JS) with the same message.
	const res = compileHybrid(src).run("Main");
	assertEqual(res.wasmRes, "assignment to entry in nil map");
});

section("WASM Maps — Growth & Rehashing");

test("Large map insertions trigger bucket growth and preserve all entries", () => {
	const src = `
package main

func Main() string {
	m := make(map[int]int)
	for i := 0; i < 60; i++ {
		m[i] = i * 10
	}
	if len(m) != 60 {
		return "fail len 60"
	}
	for i := 0; i < 60; i++ {
		if m[i] != i*10 {
			return "fail entry lookup"
		}
	}
	// Delete even numbers
	for i := 0; i < 60; i += 2 {
		delete(m, i)
	}
	if len(m) != 30 {
		return "fail len 30"
	}
	for i := 0; i < 60; i++ {
		if i%2 == 0 {
			if m[i] != 0 {
				return "fail deleted key"
			}
		} else {
			if m[i] != i*10 {
				return "fail surviving key"
			}
		}
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

section("WASM Maps — Insertion-Order Iteration & Hybrid Parity");

test("for-range preserves exact insertion order matching JS Map", () => {
	const src = `
package main

func Main() string {
	m := make(map[string]int)
	m["first"] = 1
	m["second"] = 2
	m["third"] = 3
	m["fourth"] = 4

	res := ""
	for k, v := range m {
		if v > 0 {
			res += k + ":"
		}
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "first:second:third:fourth:");
	assertEqual(jsRes, wasmRes);
});

test("Key mutation preserves insertion order; delete-reinsert moves key to end", () => {
	const src = `
package main

func Main() string {
	m := make(map[string]int)
	m["a"] = 1
	m["b"] = 2
	m["c"] = 3
	// Update "b" in place
	m["b"] = 20
	// Delete "a" and re-insert "a" -> moves "a" to end
	delete(m, "a")
	m["a"] = 100

	res := ""
	for k := range m {
		res += k + ","
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "b,c,a,");
	assertEqual(jsRes, wasmRes);
});

test("Deleting current key during range loop iteration does not abort traversal", () => {
	const src = `
package main

func Main() string {
	m := make(map[string]int)
	m["one"] = 1
	m["two"] = 2
	m["three"] = 3

	res := ""
	for k := range m {
		res += k + " "
		delete(m, k)
	}
	if len(m) != 0 {
		return "fail len"
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "one two three ");
	assertEqual(jsRes, wasmRes);
});

section("WASM Stdlib — maps Package");

test("maps.Keys and maps.Values in insertion order", async () => {
	const src = `
package main

import (
	"maps"
	"slices"
)

func Main() string {
	m := map[string]int{"x": 10, "y": 20, "z": 30}
	keys := slices.Collect(maps.Keys(m))
	vals := slices.Collect(maps.Values(m))
	if len(keys) != 3 || len(vals) != 3 {
		return "fail len"
	}
	if keys[0] != "x" || keys[1] != "y" || keys[2] != "z" {
		return "fail keys order"
	}
	if vals[0] != 10 || vals[1] != 20 || vals[2] != 30 {
		return "fail vals order"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = await runMapsProject(src);
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("maps.Clone and maps.Copy", () => {
	const src = `
package main

import "maps"

func Main() string {
	src := map[string]int{"a": 1, "b": 2}
	c := maps.Clone(src)
	if c["a"] != 1 || c["b"] != 2 || len(c) != 2 {
		return "fail clone"
	}
	c["a"] = 99
	if src["a"] != 1 {
		return "fail clone isolation"
	}

	dst := map[string]int{"existing": 0}
	maps.Copy(dst, src)
	if dst["existing"] != 0 || dst["a"] != 1 || dst["b"] != 2 || len(dst) != 3 {
		return "fail copy"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("maps.Equal and maps.EqualFunc", () => {
	const src = `
package main

import "maps"

func Main() string {
	m1 := map[string]int{"a": 1, "b": 2}
	m2 := map[string]int{"b": 2, "a": 1}
	m3 := map[string]int{"a": 1, "b": 3}
	m4 := map[string]int{"a": 1}

	if !maps.Equal(m1, m2) {
		return "fail m1==m2"
	}
	if maps.Equal(m1, m3) {
		return "fail m1!=m3"
	}
	if maps.Equal(m1, m4) {
		return "fail m1!=m4"
	}

	// EqualFunc with absolute difference
	eq := func(v1 int, v2 int) bool {
		return v1 == v2 || v1+1 == v2
	}
	if !maps.EqualFunc(m1, m3, eq) {
		return "fail equalfunc"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("maps.DeleteFunc", () => {
	const src = `
package main

import "maps"

func Main() string {
	m := map[string]int{"a": 1, "b": 2, "c": 3, "d": 4}
	maps.DeleteFunc(m, func(k string, v int) bool {
		return v%2 == 0
	})
	if len(m) != 2 || m["a"] != 1 || m["c"] != 3 || m["b"] != 0 || m["d"] != 0 {
		return "fail deletefunc"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

section("WASM Stdlib — slices Package");

test("slices.Sort and slices.Reverse on integer slice", () => {
	const src = `
package main

import "slices"

func Main() string {
	nums := []int{5, 2, 9, 1, 5, 6}
	slices.Sort(nums)
	if nums[0] != 1 || nums[1] != 2 || nums[2] != 5 || nums[3] != 5 || nums[4] != 6 || nums[5] != 9 {
		return "fail sort"
	}
	slices.Reverse(nums)
	if nums[0] != 9 || nums[1] != 6 || nums[2] != 5 || nums[3] != 5 || nums[4] != 2 || nums[5] != 1 {
		return "fail reverse"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("slices.Sort on map keys", async () => {
	const src = `
package main

import (
	"maps"
	"slices"
)

func Main() string {
	m := map[string]int{"zebra": 1, "apple": 2, "monkey": 3}
	keys := slices.Collect(maps.Keys(m))
	slices.Sort(keys)
	if keys[0] != "apple" || keys[1] != "monkey" || keys[2] != "zebra" {
		return "fail sorted keys"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = await runMapsProject(src);
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("slices.Contains, Index, Equal, Clone", () => {
	const src = `
package main

import "slices"

func Main() string {
	s := []string{"red", "green", "blue"}
	if !slices.Contains(s, "green") || slices.Contains(s, "yellow") {
		return "fail contains"
	}
	if slices.Index(s, "blue") != 2 || slices.Index(s, "missing") != -1 {
		return "fail index"
	}
	c := slices.Clone(s)
	if !slices.Equal(s, c) {
		return "fail equal"
	}
	c[0] = "cyan"
	if s[0] != "red" || slices.Equal(s, c) {
		return "fail clone isolation"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("m == nil is true for a nil map, false for an empty one (P60)", () => {
	const res = compileHybrid(`package main

import "fmt"

func Main() string {
	var m map[string]int
	n := map[string]int{}
	k := make(map[string]int)
	return fmt.Sprint(m == nil, n == nil, k == nil, m != nil, len(m))
}
`).run("Main");
	assertEqual(res.jsRes, "true false false false 0");
	assertEqual(res.wasmRes, res.jsRes);
});

test("m == nil in a non-strict js package", () => {
	const { js, errors } = compile(`package main

type S struct{ m map[string]int }

func main() {
	var m map[string]int
	n := map[string]int{}
	var s S
	println(m == nil, n == nil, s.m == nil)
	m["a"] = 1
	println(m == nil)
}
`);
	assertEqual(errors.length, 0, errors.join("\n"));
	assertEqual(runJs(js), "true false true\nfalse");
});

test("struct map keys never collide and range yields struct keys", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

type T struct{ A, B string }
type K struct {
	S string
	N int
}
type P struct{ X, Y int }

func main() {
	m := map[T]int{T{"x y", "z"}: 1, T{"x", "y z"}: 2}
	fmt.Println(len(m), m[T{"x y", "z"}], m[T{"x", "y z"}], m[T{"x y z", ""}])
	m2 := map[K]int{K{"a", 5}: 1, K{"a 1", 0}: 2}
	fmt.Println(m2)
	n := 0
	for k := range m {
		n += len(k.A) + len(k.B)
	}
	fmt.Println(n)
	sum := 0
	for k, v := range m2 {
		sum += len(k.S) + k.N + v
	}
	fmt.Println(sum)
	fmt.Println(m2[K{"a", 5}], m2[K{"a 1", 0}], m2[K{"a", 6}])
	delete(m2, K{"a", 5})
	fmt.Println(len(m2), m2)
	m4 := map[P][]int{}
	m4[P{1, 2}] = append(m4[P{1, 2}], 5)
	m4[P{1, 2}] = append(m4[P{1, 2}], 6)
	fmt.Println(m4, len(m4))
	m6 := map[T]int{{"a", "b"}: 1}
	m6[T{"a", "b"}]++
	v, ok := m6[T{"a", "b"}]
	_, ok2 := m6[T{"b", "a"}]
	fmt.Println(m6, v, ok, ok2)
	var k2 K
	for k2 = range m2 {
	}
	fmt.Println(k2)
}
`,
		"2 1 2 0\nmap[{a 5}:1 {a 1 0}:2]\n8\n12\n1 2 0\n1 map[{a 1 0}:2]\nmap[{1 2}:[5 6]] 1\nmap[{a b}:2] 2 true false\n{a 1 0}\n",
	);
});

test("struct map keys print in Go order and decode in range (JS)", () => {
	const src = `package main

import (
	"fmt"
	"sort"
)

type K struct {
	S string
	N int
}
type In struct{ A, B int }
type Nest struct {
	I In
	T string
}
type G[T comparable] struct{ V T }


func main() {
	m := map[K]int{{"b", 1}: 1, {"a", 2}: 2, {"a", 10}: 3}
	fmt.Println(m)
	fmt.Println(fmt.Sprintf("%v|%+v|%#v", m, m, m))
	fmt.Println(fmt.Sprint(m), len(m))
	n := map[Nest]bool{{In{1, 2}, "x y"}: true, {In{1, 2}, "x"}: false, {In{0, 5}, "z"}: true}
	fmt.Println(n)
	total := 0
	for k, v := range n {
		total += k.I.A + len(k.T)
		if v {
			total += 100
		}
	}
	fmt.Println(total)
	g := map[G[string]]int{{"a b"}: 1, {"a"}: 2}
	fmt.Println(g, len(g))
	var a any = m
	fmt.Println(a)
	keys := []K{}
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].N < keys[j].N })
	fmt.Println(keys)
	for k := range m {
		k.N = 99
	}
	fmt.Println(m)
	var k2 K
	for k2 = range m {
	}
	fmt.Println(k2.S != "")
	two := map[In]string{{1, 2}: "x", {2, 1}: "y"}
	cnt := 0
	for k, v := range two {
		if (k == In{1, 2} && v == "x") || (k == In{2, 1} && v == "y") {
			cnt++
		}
	}
	fmt.Println(cnt, len(two))
	m[K{"z", 0}]++
	m[K{"z", 0}] += 4
	v, ok := m[K{"z", 0}]
	fmt.Println(v, ok)
	clear(m)
	fmt.Println(len(m), m)
}
`;
	for (const target of ["js", "both"]) {
		const { js, errors } = compile(src, { target });
		assertEqual(errors.length, 0);
		assertEqual(
			runJs(js),
			'map[{a 2}:2 {a 10}:3 {b 1}:1]\nmap[{a 2}:2 {a 10}:3 {b 1}:1]|map[{S:a N:2}:2 {S:a N:10}:3 {S:b N:1}:1]|map[main.K]int{main.K{S:"a", N:2}:2, main.K{S:"a", N:10}:3, main.K{S:"b", N:1}:1}\nmap[{a 2}:2 {a 10}:3 {b 1}:1] 3\nmap[{{0 5} z}:true {{1 2} x}:false {{1 2} x y}:true]\n207\nmap[{a}:2 {a b}:1] 2\nmap[{a 2}:2 {a 10}:3 {b 1}:1]\n[{b 1} {a 2} {a 10}]\nmap[{a 2}:2 {a 10}:3 {b 1}:1]\ntrue\n2 2\n5 true\n0 map[]',
		);
	}
});
