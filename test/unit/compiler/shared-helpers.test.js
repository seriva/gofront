// GoFront test suite — each runtime helper is defined once per JS bundle

import { join } from "node:path";
import { CodeGen } from "../../../src/backend/js/index.js";
import { compileDir } from "../../../src/compiler.js";
import { Lexer } from "../../../src/lexer/lexer.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	assert,
	assertEqual,
	runJs,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("JS output — runtime helpers are defined once per bundle");

// How often each runtime helper (`var __name = ...` at the top level) is
// defined in `js`.
function helperDefinitions(js) {
	const counts = new Map();
	for (const line of js.split("\n")) {
		const m = line.match(/^var (__\w+) = /);
		if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
	}
	return counts;
}

function assertEachOnce(js, what) {
	const counts = helperDefinitions(js);
	assert(counts.size > 0, `${what}: the bundle defines helpers`);
	for (const [name, n] of counts)
		assertEqual(n, 1, `${what}: ${name} is defined ${n} times`);
}

function build(files, options = {}) {
	return withTempDir(files, (dir) => compileDir(dir, options));
}

test("a fmt hello world defines every helper once", () => {
	const res = build({
		"main.go": `package main
import "fmt"
func main() { fmt.Println("hello") }
`,
	});
	assertEachOnce(res.js, "fmt hello");
	assertEqual(runJs(res.js), "hello");
});

const MULTI = {
	"main.go": `package main
import (
	"fmt"
	"./a"
	"./b"
)
func main() {
	s := []int{1}
	s = append(s, 2)
	fmt.Println(len(s), a.Sum([]int{1, 2, 3}), b.Join("x", "y"))
}
`,
	"a/a.go": `package a
func Sum(xs []int) int {
	t := 0
	xs = append(xs, 0)
	for _, x := range xs {
		t += x
	}
	return t
}
`,
	"b/b.go": `package b
import "strings"
func Join(a, b string) string {
	parts := []string{a}
	parts = append(parts, b)
	return strings.Join(parts, "-")
}
`,
};

test("a multi-package program defines every helper once", () => {
	const res = build(MULTI);
	assertEachOnce(res.js, "multi-package");
	assertEqual(runJs(res.js), "2 6 x-y");
});

test("a helper only a dependency or only the stdlib needs is still emitted", () => {
	const dep = build({
		"main.go": `package main
import "./a"
func main() { println(a.Grow()) }
`,
		"a/a.go": `package a
func Grow() int {
	s := []int{}
	s = append(s, 1, 2, 3)
	return len(s)
}
`,
	});
	assert(helperDefinitions(dep.js).has("__append"), "append helper present");
	assertEachOnce(dep.js, "dependency-only helper");
	assertEqual(runJs(dep.js), "3");

	const std = build({
		"main.go": `package main
import "strings"
func main() { println(strings.Join(strings.Split("a,b,c", ","), "+")) }
`,
	});
	assertEachOnce(std.js, "stdlib-only helper");
	assertEqual(runJs(std.js), "a+b+c");
});

test("a helper that nothing uses is not emitted", () => {
	const res = build({
		"main.go": `package main\nfunc main() { println(1) }\n`,
	});
	assertEqual(helperDefinitions(res.js).size, 0);
});

test("styles are injected by one helper definition", () => {
	const res = build({
		"main.go": `package main
func main() { println(1) }
`,
		"ui.templ": `package main

css boxStyle() {
	color: red;
}

templ Box() {
	<div class={ boxStyle() }>x</div>
}
`,
		"use.go": `package main
func init() { _ = Box }
`,
	});
	assert(res.css.includes("color: red"), "the css is collected");
	assertEqual((res.js.match(/^var __injectStyles = /gm) ?? []).length, 1);
});

test("the preact example builds with one set of helpers", () => {
	const dir = join(import.meta.dirname, "../../../example/preact/src");
	const res = compileDir(dir, { sourceMap: true });
	assertEachOnce(res.js, "example/preact");
});

test("source maps of every chunk still point at their lines", () => {
	const res = build(
		{
			"main.go": `package main
import (
	"fmt"
	"./a"
)
func main() {
	fmt.Println(a.Say())
	println("from main")
}
`,
			"a/a.go": `package a
func Say() string {
	println("from a")
	return "said"
}
`,
		},
		{ sourceMap: true },
	);
	const lines = res.js.split("\n");
	const sources = res.sourcesContent.map((c) => c.split("\n"));
	let checked = 0;
	for (const m of res.mappings) {
		const js = lines[m.genLine];
		if (!js?.includes("console.log(")) continue;
		const src = sources[m.srcFileIdx][m.srcLine] ?? "";
		if (!src.includes("println")) continue;
		checked++;
		assert(
			js.includes(src.includes("from a") ? '"from a"' : '"from main"'),
			`line ${m.genLine} (${js}) maps to ${src}`,
		);
	}
	assertEqual(checked, 2);
});

test("a warm rebuild of the bundle equals a cold build", async () => {
	const { PackageCache } = await import("../../../src/link/package-cache.js");
	withTempDir(MULTI, (dir) => {
		const cache = new PackageCache();
		compileDir(dir, { sourceMap: true, packageCache: cache });
		const warm = compileDir(dir, { sourceMap: true, packageCache: cache });
		const cold = compileDir(dir, {
			sourceMap: true,
			packageCache: new PackageCache(),
		});
		assertEqual(warm.js, cold.js);
		assertEqual(JSON.stringify(warm.mappings), JSON.stringify(cold.mappings));
	});
});

test("a direct code generator call still carries its own helpers", () => {
	const source = `package main
func main() {
	s := []int{}
	s = append(s, 1)
	println(len(s))
}
`;
	const ast = new Parser(
		new Lexer(source, "main.go").tokenize(),
		"main.go",
		source,
	).parse();
	const checker = new TypeChecker();
	checker.checkAll([ast]);
	const js = new CodeGen(checker, new Map(), new Set(), {}).generate(ast);
	assert(helperDefinitions(js).has("__append"), "helpers are prepended");
});
