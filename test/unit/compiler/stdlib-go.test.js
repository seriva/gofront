// Go-source stdlib: packages written in GoFront Go under runtime/stdlib/,
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
// adds more project files (e.g. a local package `lib` imports).
async function stdParity(libBody, extraFiles = {}) {
	const run = async (target) => {
		const res = await compileHybridProject({
			...extraFiles,
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

section("Go-source stdlib: loader (cmp)");

test("cmp has no hand-written checker entry", () => {
	assert(!STDLIB_PACKAGES.has("cmp"), "cmp must come from runtime/stdlib");
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

// JS output erases generics, so the zero value of T is null there and
// cmp.Or cannot skip "" or 0 in JS yet (plan Task 0.18, JS generic zero
// values).  WASM is monomorphised and already matches Go.
test("cmp.Or skips zero values in wasm", async () => {
	const res = await compileHybridProject({
		"lib/lib.go": `//gofront:target wasm
package lib

import "cmp"

func Run() string { return cmp.Or("", "", "x", "y") + cmp.Or("", "") + "!" }
`,
		"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
	});
	assertEqual(res.lines.join("\n"), "x!");
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
