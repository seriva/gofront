// GoFront test suite — `gofront dev` rebuilds only what an edit changed

import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runDevBuild } from "../../../src/cli/cli-core.js";
import { PackageCache } from "../../../src/link/package-cache.js";
import { assert, assertEqual, section, test, withTempDir } from "../helpers.js";

section("dev — incremental rebuilds");

let clock = Date.now() + 10_000;

// Writes `rel` below `dir` with a modification time no earlier write had, so
// an edit that keeps the file's size is still seen.
function write(dir, rel, content) {
	const path = join(dir, rel);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	clock += 1000;
	utimesSync(path, new Date(clock), new Date(clock));
}

// main -> a -> b, with a stdlib package in each layer.
const APP = {
	"src/main.go": `package main
import (
	"fmt"
	"./a"
)
func main() { fmt.Println(a.Describe(3)) }
`,
	"src/a/a.go": `package a
import (
	"strings"
	"./b"
)
func Describe(n int) string { return strings.ToUpper(b.Label(n)) }
`,
	"src/a/b/b.go": `package b
import "sort"
func Label(n int) string {
	xs := []int{n, 1}
	sort.Ints(xs)
	return "n"
}
`,
};

function setup(dir) {
	const config = {
		srcDir: join(dir, "src"),
		isDir: true,
		outputFile: join(dir, "out", "app.js"),
		sourceMap: true,
		minify: false,
		mangle: false,
		forceTarget: null,
		packageCache: new PackageCache(),
	};
	return config;
}

// The counters of one build: package directories that were compiled, those
// the cache served, and the stdlib packages it had to build.
function counted(config, dir) {
	const cache = config.packageCache;
	const before = new Map(
		[...cache.stats.packages].map(([k, v]) => [k, { ...v }]),
	);
	const stdlibBefore = cache.stats.stdlibMisses;
	const info = runDevBuild(config, "edit");
	const rebuilt = [];
	const reused = [];
	for (const [path, now] of cache.stats.packages) {
		const was = before.get(path) ?? { hits: 0, misses: 0 };
		const name = path.slice(resolve(dir, "src").length + 1) || ".";
		if (now.misses > was.misses) rebuilt.push(name);
		else if (now.hits > was.hits) reused.push(name);
	}
	return {
		info,
		rebuilt: rebuilt.sort(),
		reused: reused.sort(),
		stdlibBuilt: cache.stats.stdlibMisses - stdlibBefore,
	};
}

// A build from nothing, of the sources as they are now.
function cold(config) {
	return runDevBuild({
		...config,
		outputFile: join(dirname(dirname(config.outputFile)), "cold", "app.js"),
		packageCache: new PackageCache(),
	});
}

function assertSameBuild(warm, coldInfo) {
	assertEqual(warm.js, coldInfo.js);
	assertEqual(warm.result.css, coldInfo.result.css);
	assertEqual(
		JSON.stringify(warm.result.mappings),
		JSON.stringify(coldInfo.result.mappings),
	);
	assertEqual(
		warm.result.sourceFiles.join(),
		coldInfo.result.sourceFiles.join(),
	);
	assertEqual(
		readFileSync(warm.outputFile, "utf8"),
		readFileSync(coldInfo.outputFile, "utf8"),
	);
}

test("a body edit in a leaf package rebuilds only that package", () => {
	withTempDir(APP, (dir) => {
		const config = setup(dir);
		const first = counted(config, dir);
		assertEqual(first.rebuilt.join(), ".,a,a/b");
		write(
			dir,
			"src/a/b/b.go",
			`package b
import "sort"
func Label(n int) string {
	xs := []int{n, 2}
	sort.Ints(xs)
	return "m"
}
`,
		);
		const second = counted(config, dir);
		assertEqual(second.rebuilt.join(), "a/b");
		assertEqual(second.reused.join(), ".,a");
		assertEqual(second.stdlibBuilt, 0);
		assertSameBuild(second.info, cold(config));
	});
});

test("an exported change rebuilds the importer, which stops where its own exports are unchanged", () => {
	withTempDir(APP, (dir) => {
		const config = setup(dir);
		counted(config, dir);
		write(
			dir,
			"src/a/b/b.go",
			`package b
import "sort"
func Label(n int64) string {
	xs := []int{int(n), 1}
	sort.Ints(xs)
	return "n"
}
`,
		);
		write(
			dir,
			"src/a/a.go",
			`package a
import (
	"strings"
	"./b"
)
func Describe(n int) string { return strings.ToUpper(b.Label(int64(n))) }
`,
		);
		const second = counted(config, dir);
		assertEqual(second.rebuilt.join(), "a,a/b");
		assertEqual(second.reused.join(), ".");
		assertEqual(second.stdlibBuilt, 0);
		assertSameBuild(second.info, cold(config));
	});
});

test("an exported change that reaches the root rebuilds every importer", () => {
	withTempDir(APP, (dir) => {
		const config = setup(dir);
		counted(config, dir);
		write(
			dir,
			"src/a/a.go",
			`package a
import (
	"strings"
	"./b"
)
func Describe(n int) string { return strings.ToUpper(b.Label(n)) }
func Extra() int { return 1 }
`,
		);
		const second = counted(config, dir);
		assertEqual(second.rebuilt.join(), ".,a");
		assertEqual(second.reused.join(), "a/b");
		assertSameBuild(second.info, cold(config));
	});
});

test("editing the root package rebuilds only the root", () => {
	withTempDir(APP, (dir) => {
		const config = setup(dir);
		counted(config, dir);
		write(
			dir,
			"src/main.go",
			`package main
import (
	"fmt"
	"./a"
)
func main() { fmt.Println(a.Describe(4), "!") }
`,
		);
		const second = counted(config, dir);
		assertEqual(second.rebuilt.join(), ".");
		assertEqual(second.reused.join(), "a,a/b");
		assertEqual(second.stdlibBuilt, 0);
		assertSameBuild(second.info, cold(config));
	});
});

test("a rebuild with no edit builds nothing", () => {
	withTempDir(APP, (dir) => {
		const config = setup(dir);
		counted(config, dir);
		const second = counted(config, dir);
		assertEqual(second.rebuilt.length, 0);
		assertEqual(second.reused.join(), ".,a,a/b");
		assertEqual(second.stdlibBuilt, 0);
	});
});

test("a failed edit is reported and the fix rebuilds only the edited package", () => {
	withTempDir(APP, (dir) => {
		const config = setup(dir);
		counted(config, dir);
		const leaf = APP["src/a/b/b.go"];
		write(dir, "src/a/b/b.go", leaf.replace('return "n"', "return n"));
		let message = "";
		try {
			runDevBuild(config, "edit");
		} catch (e) {
			message = e.message;
		}
		assert(message.includes("cannot use"), `unexpected error: ${message}`);
		write(dir, "src/a/b/b.go", leaf.replace('return "n"', 'return "ok"'));
		const fixed = counted(config, dir);
		assertEqual(fixed.rebuilt.join(), "a/b");
		assertEqual(fixed.stdlibBuilt, 0);
		assertSameBuild(fixed.info, cold(config));
	});
});
