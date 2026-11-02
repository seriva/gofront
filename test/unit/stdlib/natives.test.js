// GoFront test suite — JS natives of slices and sort
//
// A native replaces the call with host code only where it agrees with the Go
// body; every other instantiation calls the Go function.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileFiles } from "../../../src/compiler.js";
import {
	assertContains,
	assertEqual,
	assertFourWay,
	section,
	test,
} from "../helpers.js";

function jsOf(source) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-native-"));
	try {
		writeFileSync(join(dir, "main.go"), source);
		return compileFiles([join(dir, "main.go")], { forceTarget: "both" }).js;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const count = (text, needle) => text.split(needle).length - 1;

section("slices and sort natives (JS)");

test("primitive slices use the host search, sort and reverse", () => {
	const js = jsOf(`package main

import (
	"slices"
	"sort"
)

func main() {
	xs := []int{3, 1, 2}
	ss := []string{"b", "a"}
	slices.Sort(xs)
	sort.Strings(ss)
	sort.Ints(xs)
	slices.Reverse(xs)
	println(slices.Index(xs, 2), slices.Contains(ss, "a"), len(slices.Clone(xs)))
}
`);
	assertContains(js, "(a, b) => a - b");
	assertContains(js, ".indexOf(2)");
	assertContains(js, ".reverse()");
	assertContains(js, "?.slice() ?? null");
});

test("floats, structs and other elements call the Go body", () => {
	const js = jsOf(`package main

import "slices"

type P struct{ A int }

func main() {
	f := []float64{2, 1}
	slices.Sort(f)
	ps := []P{{1}}
	println(slices.Index(ps, P{1}), slices.Contains(ps, P{2}))
}
`);
	assertEqual(count(js, "(a, b) => a - b"), 0);
	assertEqual(count(js, ".indexOf(__"), 0);
	assertContains(js, "Sort$$slices(");
	assertContains(js, "Index$$slices(");
});

test("a native agrees with its Go body on nil, empty and named slices", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
	"slices"
	"sort"
)

type IDs []int

func next() int { fmt.Print("."); return 1 }

func main() {
	var n []int
	var s []string
	sort.Ints(n)
	sort.Strings(s)
	slices.Sort(n)
	slices.Reverse(n)
	fmt.Println(slices.Contains(n, 1), slices.Index(s, "a"), slices.Clone(n) == nil, slices.Clone([]int{}) != nil)
	ids := IDs{3, 1, 2}
	slices.Sort(ids)
	fmt.Println(ids, slices.Index(ids, 2), slices.Contains(ids, 5))
	f := []float64{math.NaN(), 1}
	fmt.Println(slices.Contains(f, math.NaN()), slices.Index(f, 1))
	a, b := slices.Index([]int{1, 2}, next()), slices.Contains([]int{1}, next())
	fmt.Println(a, b)
}
`,
		`false -1 true true
[1 2 3] 1 false
false 1
..0 true
`,
	);
});
