// GoFront test suite — the package cache keys, hits and misses

import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	compileDir,
	compilePackageTests,
	compileSingleFile,
} from "../../../src/compiler.js";
import { PackageCache } from "../../../src/link/package-cache.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("compiler.js — package cache");

let clock = Date.now() + 10_000;

// Writes `rel` below `dir` with a modification time that differs from every
// earlier write, so a same-sized edit is still an edit.
function write(dir, rel, content) {
	const path = join(dir, rel);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	clock += 1000;
	utimesSync(path, new Date(clock), new Date(clock));
}

function remove(dir, rel) {
	rmSync(join(dir, rel));
}

// Compiles `dir` and returns what a build writes, as comparable strings.
function build(dir, options = {}) {
	const res = compileDir(dir, options);
	return {
		js: res.js,
		css: res.css,
		wasm: res.wasm ? Buffer.from(res.wasm).toString("hex") : "",
		mappings: JSON.stringify(res.mappings),
		sources: res.sourceFiles.join(),
	};
}

function assertSame(a, b, what) {
	for (const k of Object.keys(a))
		assert(a[k] === b[k], `${what}: ${k} differs`);
}

// Counts the units a build compiled afresh and the ones it reused.
function counted(cache, fn) {
	const before = { ...cache.stats };
	const out = fn();
	return {
		out,
		hits: cache.stats.unitHits - before.unitHits,
		misses: cache.stats.unitMisses - before.unitMisses,
	};
}

// A build with `options` on the shared `cache`, checked against a build from
// a cold cache. Returns the hit and miss counts of the cached build.
function checkedBuild(cache, dir, options = {}) {
	const { out, hits, misses } = counted(cache, () =>
		build(dir, { ...options, packageCache: cache }),
	);
	const cold = build(dir, { ...options, packageCache: new PackageCache() });
	assertSame(out, cold, "cached build equals a cold build");
	return { hits, misses };
}

const APP = {
	"main.go": `package main
import "./u"
func main() { println(u.Twice(2)) }
`,
	"u/u.go": `package u
func Twice(n int) int { return n * 2 }
`,
};

section("package cache — hits and misses");

test("an unchanged build is served from the cache", () => {
	withTempDir(APP, (dir) => {
		const cache = new PackageCache();
		const first = checkedBuild(cache, dir);
		assertEqual(first.hits, 0);
		assertEqual(first.misses, 2);
		const second = checkedBuild(cache, dir);
		assertEqual(second.hits, 2);
		assertEqual(second.misses, 0);
		assertEqual(cache.stats.packages.get(resolve(dir, "u")).hits, 1);
	});
});

test("editing a function body rebuilds that package, not its importer", () => {
	withTempDir(APP, (dir) => {
		const cache = new PackageCache();
		checkedBuild(cache, dir);
		write(dir, "u/u.go", `package u\nfunc Twice(n int) int { return n + n }\n`);
		const r = checkedBuild(cache, dir);
		assertEqual(r.misses, 1);
		assertEqual(r.hits, 1);
	});
});

test("changing an exported signature rebuilds importers", () => {
	withTempDir(APP, (dir) => {
		const cache = new PackageCache();
		checkedBuild(cache, dir);
		write(
			dir,
			"u/u.go",
			`package u\nfunc Twice(n int64) int64 { return n * 2 }\n`,
		);
		write(
			dir,
			"main.go",
			`package main\nimport "./u"\nfunc main() { println(u.Twice(2)) }\n`,
		);
		const r = checkedBuild(cache, dir);
		assertEqual(r.misses, 2);
		assertEqual(checkedBuild(cache, dir).misses, 0);
	});
});

test("a dependency that starts handing out element addresses rebuilds importers", () => {
	withTempDir(
		{
			"main.go": `package main
import "./u"
func main() {
	xs := []int{1, 2}
	u.Fill(xs)
	println(xs[0])
}
`,
			"u/u.go": `package u
func Fill(xs []int) { xs[0] = 7 }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			write(
				dir,
				"u/u.go",
				`package u
var keep *int
func Fill(xs []int) { xs[0] = 7; keep = &xs[1] }
`,
			);
			const r = checkedBuild(cache, dir);
			assertEqual(r.misses, 2);
		},
	);
});

test("a package that fails to compile is never stored", () => {
	withTempDir(APP, (dir) => {
		const cache = new PackageCache();
		checkedBuild(cache, dir);
		const stored = cache.units.size;
		write(dir, "u/u.go", `package u\nfunc Twice(n int) int { return "x" }\n`);
		for (let i = 0; i < 2; i++) {
			let message = "";
			try {
				build(dir, { packageCache: cache });
			} catch (e) {
				message = e.message;
			}
			assertErrorContains([{ message }], "cannot use");
		}
		assertEqual(cache.units.size, stored);
		write(dir, "u/u.go", `package u\nfunc Twice(n int) int { return n * 3 }\n`);
		const r = checkedBuild(cache, dir);
		assertEqual(r.misses, 1);
	});
});

section("package cache — what the key covers");

test("a file added to, removed from or renamed in a package", () => {
	withTempDir(APP, (dir) => {
		const cache = new PackageCache();
		checkedBuild(cache, dir);
		write(
			dir,
			"u/extra.go",
			`package u\nfunc thrice(n int) int { return n * 3 }\n`,
		);
		assertEqual(checkedBuild(cache, dir).misses, 1);
		write(
			dir,
			"u/more.go",
			`package u\nfunc four(n int) int { return n * 4 }\n`,
		);
		remove(dir, "u/extra.go");
		assertEqual(checkedBuild(cache, dir).misses, 1);
		write(
			dir,
			"u/renamed.go",
			`package u\nfunc four(n int) int { return n * 4 }\n`,
		);
		remove(dir, "u/more.go");
		assertEqual(checkedBuild(cache, dir).misses, 1);
		assertEqual(checkedBuild(cache, dir).misses, 0);
	});
});

test("an embedded file is part of the key", () => {
	withTempDir(
		{
			"main.go": `package main
import _ "embed"
//go:embed note.txt
var note string
func main() { println(note) }
`,
			"note.txt": "one",
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			assertEqual(checkedBuild(cache, dir).misses, 0);
			write(dir, "note.txt", "two");
			assertEqual(checkedBuild(cache, dir).misses, 1);
			assert(
				build(dir, { packageCache: cache }).js.includes("two"),
				"new text",
			);
			write(dir, "note.txt", "tw3");
			assertEqual(checkedBuild(cache, dir).misses, 1);
		},
	);
});

test("a js: .d.ts import is part of the key", () => {
	withTempDir(
		{
			"main.go": `package main
import "js:./h.d.ts"
func main() { println(helper()) }
`,
			"h.d.ts": "export declare function helper(): number;\n",
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			assertEqual(checkedBuild(cache, dir).misses, 0);
			write(dir, "h.d.ts", "export declare function helper(): string;\n");
			assertEqual(checkedBuild(cache, dir).misses, 1);
		},
	);
});

test("the typings of an npm import are part of the key", () => {
	withTempDir(
		{
			"main.go": `package main
import "mini"
func main() { println(hello()) }
`,
			"node_modules/mini/package.json": `{ "name": "mini", "types": "index.d.ts" }`,
			"node_modules/mini/index.d.ts":
				"export declare function hello(): string;\n",
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			assertEqual(checkedBuild(cache, dir).misses, 0);
			write(
				dir,
				"node_modules/mini/index.d.ts",
				"export declare function hello(): number;\n",
			);
			assertEqual(checkedBuild(cache, dir).misses, 1);
		},
	);
});

test("each output-changing option is part of the key", () => {
	withTempDir(
		{
			"main.go": `package main
import "./u"
func main() { println(u.Twice(2)) }
`,
			"u/u.go": `package u
func Twice(n int) int { return n * 2 }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			const variants = [
				{ sourceMap: true },
				{ strict: true },
				{ natives: false },
				{ forceTarget: "js" },
				{ targetOverrides: { u: "both" } },
				{ targetOverrides: { u: "wasm" } },
				{ stdlibRoot: join(dir, "nostdlib") },
			];
			for (const options of variants) {
				const r = checkedBuild(cache, dir, options);
				assert(r.misses > 0, `${JSON.stringify(options)} misses`);
				assertEqual(checkedBuild(cache, dir, options).misses, 0);
			}
			assertEqual(checkedBuild(cache, dir).misses, 0);
		},
	);
});

test("a package's resolved target is part of the key", () => {
	withTempDir(
		{
			"main.go": `package main
import "./u"
func main() { println(u.Twice(2)) }
`,
			"u/u.go": `package u
func Twice(n int) int { return n * 2 }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			write(
				dir,
				"u/u.go",
				`//gofront:target both\npackage u\nfunc Twice(n int) int { return n * 2 }\n`,
			);
			const r = checkedBuild(cache, dir);
			assert(r.misses >= 1, "the package is rebuilt");
		},
	);
});

test("test options are part of the key", () => {
	withTempDir(
		{
			"p.go": `package p
func Add(a, b int) int { return a + b }
`,
			"p_test.go": `package p
import "testing"
func TestAdd(t *testing.T) { if Add(1, 2) != 3 { t.Fail() } }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			const run = (options) => {
				const { hits, misses } = counted(cache, () =>
					compilePackageTests(dir, { ...options, packageCache: cache }),
				);
				return { hits, misses };
			};
			assertEqual(run({}).misses, 1);
			assertEqual(run({}).hits, 1);
			assertEqual(run({ wasmTests: true }).misses, 1);
			assertEqual(run({ wasmTests: true }).hits, 1);
			const driver = (n) => () =>
				`package p\nfunc driverValue() int { return ${n} }\n`;
			assertEqual(run({ testDriver: driver(1) }).misses, 1);
			assertEqual(run({ testDriver: driver(1) }).hits, 1);
			assertEqual(run({ testDriver: driver(2) }).misses, 1);
		},
	);
});

test("a single-file build is cached too", () => {
	withTempDir(
		{ "one.go": `package main\nfunc main() { println(1) }\n` },
		(dir) => {
			const cache = new PackageCache();
			const file = join(dir, "one.go");
			compileSingleFile(file, { packageCache: cache });
			const { hits } = counted(cache, () =>
				compileSingleFile(file, { packageCache: cache }),
			);
			assertEqual(hits, 1);
		},
	);
});

section("package cache — shared names and build state");

const SHARED_NAMES = {
	"a/a.go": `package a
type Pt struct{ X int }
func New() Pt { return Pt{X: 1} }
`,
	"b/b.go": `package b
type Pt struct{ Y int }
func New() Pt { return Pt{Y: 2} }
`,
};

test("types two packages declare keep their names across cached builds", () => {
	withTempDir(
		{
			...SHARED_NAMES,
			"main.go": `package main
import (
	"./a"
	"./b"
)
func main() { println(a.New().X, b.New().Y) }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			const warm = checkedBuild(cache, dir);
			assertEqual(warm.misses, 0);
			assert(
				build(dir, { packageCache: cache }).js.includes("Pt$$b"),
				"the later package's type is renamed",
			);
			// The imports swap places: `a` now meets `b`'s type and is renamed.
			write(
				dir,
				"main.go",
				`package main
import (
	"./b"
	"./a"
)
func main() { println(a.New().X, b.New().Y) }
`,
			);
			checkedBuild(cache, dir);
			assert(
				build(dir, { packageCache: cache }).js.includes("Pt$$a"),
				"the renamed type follows the import order",
			);
		},
	);
});

test("a diamond keeps one copy of the shared package in every build", () => {
	withTempDir(
		{
			"main.go": `package main
import (
	"./a"
	"./b"
)
func main() { println(a.A(), b.B()) }
`,
			"a/a.go": `package a
import "../c"
func A() int { return c.C() + 1 }
`,
			"b/b.go": `package b
import "../c"
func B() int { return c.C() + 2 }
`,
			"c/c.go": `package c
func C() int { return 40 }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			assertEqual(checkedBuild(cache, dir).misses, 0);
			write(dir, "c/c.go", `package c\nfunc C() int { return 41 }\n`);
			const r = checkedBuild(cache, dir);
			assertEqual(r.misses, 1);
			assertEqual(
				build(dir, { packageCache: cache }).js.split("function C(").length,
				2,
			);
		},
	);
});

test("a package that uses json keeps its codecs across cached builds", () => {
	withTempDir(
		{
			"main.go": `package main
import (
	"encoding/json"
	"./u"
)
type Doc struct{ N int }
func main() {
	b, _ := json.Marshal(Doc{N: 1})
	println(string(b), u.Name())
}
`,
			"u/u.go": `package u
type Item struct{ A int }
func Name() string { return "u" }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			const warm = checkedBuild(cache, dir);
			assertEqual(warm.misses, 0);
		},
	);
});

test("wasm and both packages build the same from the cache", () => {
	withTempDir(
		{
			"main.go": `package main
import "./u"
func main() { println(u.Twice(2)) }
`,
			"u/u.go": `//gofront:target both
package u
func Twice(n int) int { return n * 2 }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			assertEqual(checkedBuild(cache, dir).misses, 0);
			write(
				dir,
				"u/u.go",
				`//gofront:target wasm
package u
func Twice(n int) int { return n * 2 }
`,
			);
			checkedBuild(cache, dir);
			assertEqual(checkedBuild(cache, dir).misses, 0);
		},
	);
});

section("package cache — Go-source stdlib units");

test("stdlib packages are built once per cache and rebuilt when their source changes", () => {
	withTempDir(
		{
			"stdlib/big/big.go": `//go:build gofront

//gofront:target both

package big

func F(n int) int { return n + 1 }
`,
			"app/main.go": `package main
import "big"
func main() { println(big.F(1)) }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			const options = { stdlibRoot: join(dir, "stdlib") };
			const app = join(dir, "app");
			checkedBuild(cache, app, options);
			const before = cache.stats.stdlibMisses;
			checkedBuild(cache, app, options);
			assertEqual(cache.stats.stdlibMisses, before);
			assert(cache.stats.stdlibHits > 0, "the stdlib package is reused");
			write(
				dir,
				"stdlib/big/big.go",
				`//go:build gofront

//gofront:target both

package big

func F(n int) int { return n + 2 }
`,
			);
			checkedBuild(cache, app, options);
			assert(cache.stats.stdlibMisses > before, "a changed source rebuilds");
		},
	);
});

test("stdlib JS is memoized across cached builds", () => {
	withTempDir(
		{
			"main.go": `package main
import (
	"fmt"
	"sort"
)
func main() { xs := []int{2, 1}; sort.Ints(xs); fmt.Println(xs) }
`,
		},
		(dir) => {
			const cache = new PackageCache();
			build(dir, { packageCache: cache });
			const misses = cache.stats.stdlibJsMisses;
			assert(misses > 0, "the first build emits");
			assertEqual(cache.stats.stdlibJsHits, 0);
			write(
				dir,
				"main.go",
				`package main
import (
	"fmt"
	"sort"
)
func main() { xs := []int{3, 1}; sort.Ints(xs); fmt.Println(xs, 1) }
`,
			);
			build(dir, { packageCache: cache });
			assertEqual(cache.stats.stdlibJsMisses, misses);
			assertEqual(cache.stats.stdlibJsHits, misses);
		},
	);
});

test("a wasm package whose generated Go names another package's types is served from the cache", () => {
	withTempDir(
		{
			"main.go": `//gofront:target wasm
package main
import (
	"fmt"
	"./u"
)
func main() { fmt.Println(u.Pair[int]{1, 2}, u.Num(3)) }
`,
			"u/u.go": `//gofront:target wasm
package u
type Pair[T any] struct{ A, B T }
type Num int
`,
		},
		(dir) => {
			const cache = new PackageCache();
			checkedBuild(cache, dir);
			const again = checkedBuild(cache, dir);
			assertEqual(again.misses, 0);
			assertEqual(again.hits, 2);
		},
	);
});
