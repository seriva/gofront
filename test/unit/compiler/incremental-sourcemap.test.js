// GoFront test suite — source maps stay exact across incremental rebuilds

import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileDir } from "../../../src/compiler.js";
import { PackageCache } from "../../../src/link/package-cache.js";
import { assert, assertEqual, section, test, withTempDir } from "../helpers.js";

section("compiler.js — source maps across incremental rebuilds");

let clock = Date.now() + 10_000;

// Writes `rel` below `dir` with a modification time no earlier write had.
function write(dir, rel, content) {
	const path = join(dir, rel);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	clock += 1000;
	utimesSync(path, new Date(clock), new Date(clock));
}

function maps(res) {
	return {
		js: res.js,
		mappings: JSON.stringify(res.mappings),
		sourceFiles: res.sourceFiles.join(),
		sourcesContent: JSON.stringify(res.sourcesContent),
	};
}

// Compiles `dir` against `cache` and against a cold cache; both must agree on
// everything a debugger reads.
function checkedBuild(cache, dir, what) {
	const options = { sourceMap: true };
	const warm = maps(compileDir(dir, { ...options, packageCache: cache }));
	const cold = maps(
		compileDir(dir, { ...options, packageCache: new PackageCache() }),
	);
	for (const k of Object.keys(cold))
		assert(warm[k] === cold[k], `${what}: ${k} differs from a cold build`);
	return warm;
}

const APP = {
	"main.go": `package main
import (
	"fmt"
	"./a"
)
func main() {
	fmt.Println(a.Describe(3))
}
`,
	"a/a.go": `package a
import (
	"strings"
	"./b"
)
func Describe(n int) string {
	return strings.ToUpper(b.Label(n))
}
`,
	"a/b/b.go": `package b
import "sort"
func Label(n int) string {
	xs := []int{n, 1}
	sort.Ints(xs)
	return "n"
}
`,
};

test("mappings after three incremental edits equal a cold build's", () => {
	withTempDir(APP, (dir) => {
		const cache = new PackageCache();
		const first = checkedBuild(cache, dir, "first build");

		// 1. Lines are added to a leaf: every chunk after it shifts.
		write(
			dir,
			"a/b/b.go",
			`package b
import "sort"

// Label names n.
func Label(n int) string {
	xs := []int{n, 1}

	sort.Ints(xs)
	return "n"
}
`,
		);
		const afterLeaf = checkedBuild(cache, dir, "after the leaf edit");
		assert(
			afterLeaf.mappings !== first.mappings,
			"the leaf edit moved the mappings",
		);

		// 2. The middle package uses more of the standard library: the spliced
		// stdlib code grows and shifts the chunks that follow it.
		write(
			dir,
			"a/a.go",
			`package a
import (
	"strings"
	"sort"
	"./b"
)
func Describe(n int) string {
	names := []string{b.Label(n), "z", "a"}
	sort.Strings(names)
	return strings.ToUpper(strings.Join(names, ","))
}
`,
		);
		const afterMiddle = checkedBuild(cache, dir, "after the middle edit");
		assert(
			afterMiddle.mappings !== afterLeaf.mappings,
			"the middle edit moved the mappings",
		);

		// 3. The root changes.
		write(
			dir,
			"main.go",
			`package main
import (
	"fmt"
	"./a"
)

func main() {
	fmt.Println(a.Describe(3))
	fmt.Println(a.Describe(4))
}
`,
		);
		checkedBuild(cache, dir, "after the root edit");

		// Building again, with nothing edited, shifts nothing.
		const again = checkedBuild(cache, dir, "an unedited rebuild");
		const once = checkedBuild(cache, dir, "a second unedited rebuild");
		assertEqual(again.mappings, once.mappings);
	});
});

test("an edit that drops a stdlib package leaves no stale mappings", () => {
	withTempDir(APP, (dir) => {
		const cache = new PackageCache();
		checkedBuild(cache, dir, "first build");
		write(
			dir,
			"a/b/b.go",
			`package b
func Label(n int) string {
	return "n"
}
`,
		);
		checkedBuild(cache, dir, "after dropping sort");
		write(
			dir,
			"a/b/b.go",
			`package b
import "sort"
func Label(n int) string {
	xs := []int{n, 1}
	sort.Ints(xs)
	return "n"
}
`,
		);
		checkedBuild(cache, dir, "after bringing sort back");
	});
});
