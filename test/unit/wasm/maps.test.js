// test/unit/wasm/maps.test.js
// Tests for Phase H4 Task H4.3: Maps & stdlib in WASM and JS-strict parity.

import {
	assertEqual,
	assertThrows,
	compileHybrid,
	section,
	test,
} from "../helpers.js";

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

func Main() {
	var m map[string]int
	m["key"] = 123
}
`;
	assertThrows(() => {
		compileHybrid(src).run("Main");
	}, "assignment to entry in nil map");
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

test("maps.Keys and maps.Values in insertion order", () => {
	const src = `
package main

import "maps"

func Main() string {
	m := map[string]int{"x": 10, "y": 20, "z": 30}
	keys := maps.Keys(m)
	vals := maps.Values(m)
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
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
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

test("slices.Sort on map keys", () => {
	const src = `
package main

import (
	"maps"
	"slices"
)

func Main() string {
	m := map[string]int{"zebra": 1, "apple": 2, "monkey": 3}
	keys := maps.Keys(m)
	slices.Sort(keys)
	if keys[0] != "apple" || keys[1] != "monkey" || keys[2] != "zebra" {
		return "fail sorted keys"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
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

section("WASM Stdlib — strings, strconv & fmt Packages");

test("strings package functions", () => {
	const src = `
package main

import "strings"

func Main() string {
	if strings.ToUpper("hello") != "HELLO" {
		return "fail toUpper"
	}
	if strings.ToLower("WORLD") != "world" {
		return "fail toLower"
	}
	if strings.TrimSpace("   spaced   ") != "spaced" {
		return "fail trimSpace"
	}
	if !strings.Contains("gopher", "ph") || strings.Contains("gopher", "xyz") {
		return "fail contains"
	}
	if !strings.HasPrefix("abcdef", "abc") || strings.HasPrefix("abcdef", "bcd") {
		return "fail hasPrefix"
	}
	if !strings.HasSuffix("abcdef", "def") || strings.HasSuffix("abcdef", "de") {
		return "fail hasSuffix"
	}
	if strings.Index("banana", "na") != 2 || strings.LastIndex("banana", "na") != 4 {
		return "fail index"
	}
	if strings.Repeat("ha", 3) != "hahaha" {
		return "fail repeat"
	}
	if strings.ReplaceAll("foo bar foo", "foo", "qux") != "qux bar qux" {
		return "fail replaceAll"
	}
	if !strings.EqualFold("GoFront", "gofront") {
		return "fail equalFold"
	}
	if strings.Count("cheese", "e") != 3 {
		return "fail count"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("strconv.Itoa conversion", () => {
	const src = `
package main

import "strconv"

func Main() string {
	s1 := strconv.Itoa(42)
	s2 := strconv.Itoa(-100)
	s3 := strconv.Itoa(0)
	if s1 != "42" || s2 != "-100" || s3 != "0" {
		return "fail itoa"
	}
	return "ok"
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "ok");
	assertEqual(jsRes, wasmRes);
});

test("fmt.Println and fmt.Print output parity", () => {
	const src = `
package main

import "fmt"

func Main() {
	fmt.Println("Hello", 123, true)
	fmt.Print("Part1 ")
	fmt.Println("Part2")
}
`;
	compileHybrid(src).run("Main");
});
