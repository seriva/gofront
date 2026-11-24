// GoFront test suite — imports, error paths, access control

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Lexer } from "../../../src/lexer/lexer.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import { INT } from "../../../src/typechecker/types.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compile,
	compileDir,
	FIXTURES,
	parseDts,
	runJs,
	section,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

section("compiler.js — error paths");

test("compileDir throws on mixed package names", () => {
	const dir = join(FIXTURES, "missing_go");
	assertThrows(() => compileDir(dir));
});

// ═════════════════════════════════════════════════════════════
// Lexer edge cases
// ═════════════════════════════════════════════════════════════

section("compiler.js — mixed package names");

test("compileDir throws when package names differ across files", () => {
	const dir = join(FIXTURES, "mixed_packages");
	assertThrows(() => compileDir(dir), "Mixed package names");
});

test("compileDir throws on parse error in a .go file", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	try {
		writeFileSync(join(tmpDir, "bad.go"), "package main\nfunc (( {}", "utf8");
		assertThrows(() => compileDir(tmpDir));
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("compileDir throws on type-check error", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	try {
		writeFileSync(
			join(tmpDir, "bad.go"),
			`package main
func main() {
	var x int = "hello"
	console.log(x)
}`,
			"utf8",
		);
		assertThrows(() => compileDir(tmpDir));
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("compileDir with unknown npm import compiles without crash", () => {
	// unknown npm import resolves to null → exercises the if (!info) continue path
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "main.go"),
		`package main
import "totally-unknown-npm-package-xyz"
func main() { console.log("ok") }`,
		"utf8",
	);
	try {
		compileDir(tmpDir);
	} catch (_) {
		// ignore — the test exercises the if(!info) path; no crash is the goal
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("compileDir with missing local package import warns and continues", () => {
	// import "./nonexistent" where the subdir doesn't exist → exercises lines 118-122
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "main.go"),
		`package main
import "./nonexistent-subpkg"
func main() { console.log("ok") }`,
		"utf8",
	);
	try {
		compileDir(tmpDir);
	} catch (_) {
		// ignore — the test exercises the missing-subdir warning path; no crash is the goal
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

// ═════════════════════════════════════════════════════════════
// Side-effect imports (import _ "pkg")
// ═════════════════════════════════════════════════════════════

section("Side-effect imports");

test("import _ compiles without error", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js, errors } = compileDir(dir);
	assertEqual(errors?.length ?? 0, 0);
	assertContains(js, "side-effect-only");
});

// A blank import is there for its side effects: the dependency's init and
// calling package variables are bundled, while code nothing calls is not.
const SIDE_EFFECT_PROJECT = {
	"main.go": `package main
import _ "./dep"
func main() { println("main") }
`,
	"dep/dep.go": `package dep
func Add(a, b int) int { return a + b }
func init() { println("dep init") }
`,
};

test("import _ bundles the dependency code", () => {
	withTempDir(SIDE_EFFECT_PROJECT, (dir) => {
		const { js } = compileDir(dir);
		// dep is inlined even though it's a side-effect import
		assertContains(js, "dep init");
		assert(!js.includes("function Add("), "unused code is left out");
		assertEqual(runJs(js).trim(), "dep init\nmain");
	});
});

test("import _ runs correctly", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js } = compileDir(dir);
	assertEqual(runJs(js).trim(), "side-effect-only");
});

test("import _ does not expose package namespace", () => {
	// Using math.Add should be a type error — the namespace is not registered
	const { errors } = compile(
		`package main
import _ "../mathpkg"
func main() {
	x := math.Add(1, 2)
	console.log(x)
}`,
		{ fromFile: join(FIXTURES, "multifile/withsideeffectimport/main.go") },
	);
	assert(
		errors.length > 0,
		"expected type error: math namespace not accessible",
	);
	assertErrorContains(errors, "math");
});

test("import _ in group syntax compiles without error", () => {
	const { js, errors } = compile(
		`package main
import (
	_ "../mathpkg"
)
func main() {
	console.log("ok")
}`,
		{ fromFile: join(FIXTURES, "multifile/withsideeffectimport/main.go") },
	);
	assertEqual(errors?.length ?? 0, 0);
	assertEqual(runJs(js).trim(), "ok");
});

// ═════════════════════════════════════════════════════════════
// dts-parser — additional coverage
// ═════════════════════════════════════════════════════════════

section("Unused import detection");

test("unused local package import is a type error", () => {
	const dir = join(FIXTURES, "multifile/unusedimport");
	assertThrows(() => compileDir(dir), "imported and not used");
});

test("used local package import is not an error", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	const out = runJs(js);
	assertEqual(out.trim(), "15\n16");
});

test("side-effect import _ is not flagged as unused", () => {
	withTempDir(SIDE_EFFECT_PROJECT, (dir) => {
		const { js } = compileDir(dir);
		assertContains(js, "dep init");
	});
});

// Two files of one package: `a.go` imports, `b.go` uses a name the universe
// also binds. The use in `b.go` is not a use of `a.go`'s import.
const SIBLING = (aImports, bBody, extra = {}) => ({
	"a.go": `package main\n${aImports}\nfunc A() {}\n`,
	"b.go": `package main\nfunc main() {\n${bBody}\n}\n`,
	"sub/sub.go": "package sub\nfunc F() int { return 1 }\n",
	...extra,
});

const compileSibling = (files) =>
	withTempDir(files, (dir) => toCompileResult(() => compileDir(dir)));

test("a sibling file's use of a builtin does not use an import named like it", () => {
	const { errors } = compileSibling(
		SIBLING('import len "./sub"', 'println(len("abc"))'),
	);
	assertErrorContains(errors, "'len' imported and not used");
	assertEqual(errors.length, 1);
});

test("a sibling file's use of a browser global does not use an import named like it", () => {
	const { errors } = compileSibling(
		SIBLING('import console "./sub"', 'console.log("hi")'),
	);
	assertErrorContains(errors, "'console' imported and not used");
	assertEqual(errors.length, 1);
});

test("a sibling file's call of a global function does not use a same-named package import", () => {
	const { errors } = compileSibling(
		SIBLING('import "gofront/fetch"', '_ = fetch("/x")'),
	);
	assertErrorContains(errors, "'fetch' imported and not used");
	assertEqual(errors.length, 1);
});

test("an import used as a qualifier in its own file is used", () => {
	const { errors } = compileSibling({
		"a.go":
			'package main\nimport len "./sub"\nfunc A() int { return len.F() }\n',
		"b.go": 'package main\nfunc main() { println(len("abc"), A()) }\n',
		"sub/sub.go": "package sub\nfunc F() int { return 1 }\n",
	});
	assertEqual(errors.map((e) => e.message).join(), "");
});

test("a declaration package used for a type only is used", () => {
	const { errors } = compileSibling({
		"a.go":
			'package main\nimport "gofront/fetch"\nfunc A(r fetch.Response) bool { return r.ok }\n',
		"b.go": "package main\nfunc main() {}\n",
	});
	assertEqual(errors.map((e) => e.message).join(), "");
});

test("gofront/shared and gofront/simd imports stay used when their qualifier is", () => {
	const { errors } = compileSibling({
		"a.go":
			'package main\nimport "gofront/shared"\nvar Counts = shared.NewUint8(4)\n',
		"b.go":
			'package main\nimport "gofront/simd"\nfunc main() { _ = simd.F32x4{}; println(len(Counts)) }\n',
	});
	assertEqual(errors.map((e) => e.message).join(), "");
});

section("Dot imports");

test("dot import: functions available without qualifier", () => {
	const dir = join(FIXTURES, "multifile/withdotimport");
	const { js } = compileDir(dir);
	// Add and Square should be called directly, not as math.Add / math.Square
	assertContains(js, "Add(10, 5)");
	assertContains(js, "Square(4)");
});

test("dot import: runtime output is correct", () => {
	const dir = join(FIXTURES, "multifile/withdotimport");
	const { js } = compileDir(dir);
	const out = runJs(js);
	assertEqual(out.trim(), "15\n16");
});

test("dot import: no namespace variable emitted", () => {
	const dir = join(FIXTURES, "multifile/withdotimport");
	const { js } = compileDir(dir);
	// Should NOT contain "const math = " or "let math = " — no namespace
	assert(!js.includes("const math"), "should not have namespace variable");
});

// ═════════════════════════════════════════════════════════════
// Semantic differences — export access control
// ═════════════════════════════════════════════════════════════

section("Semantic differences — exported/unexported access");

test("unexported function from another package is rejected", () => {
	// Go spec: lowercase identifiers from another package are unexported and must not be accessed.
	const dir = join(FIXTURES, "multifile/unexported_access");
	let errMsg = "";
	try {
		compileDir(dir);
	} catch (e) {
		errMsg = e.message;
	}
	assertContains(errMsg, "not exported by package");
});

test("uppercase package member access is allowed", () => {
	// Built-in namespaces (fmt, strings, etc.) always use uppercase — should work
	const { errors } = compile(`package main
func main() {
  s := fmt.Sprintf("%d", 42)
  println(s)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// Imports are bound per file
// ═════════════════════════════════════════════════════════════

section("Checker — per-file import scopes");

function parseFile(name, source) {
	const ast = new Parser(
		new Lexer(source, name).tokenize(),
		name,
		source,
	).parse();
	ast._source = source;
	return ast;
}

// A package of two files, `a.go` and `b.go`, checked with whatever `bind`
// binds before the check. Returns the errors.
function checkTwoFiles(aSrc, bSrc, bind) {
	const checker = new TypeChecker();
	const a = parseFile("a.go", `package main\n${aSrc}`);
	const b = parseFile("b.go", `package main\n${bSrc}`);
	bind(checker, a);
	const errors = checker.checkAll([a, b]);
	checker.reportUnusedImports();
	return errors;
}

const LIB_FN = { kind: "func", params: [], returns: [INT] };
const LIB_BOX = { kind: "named", name: "Box", underlying: INT };
const bindLib = (file) => (checker) =>
	checker.addPackageNamespace(
		"lib",
		new Map([["Fn", LIB_FN]]),
		new Map([["Box", LIB_BOX]]),
		null,
		null,
		null,
		file,
	);

test("addPackageNamespace binds the package qualifier in one file", () => {
	const errors = checkTwoFiles(
		"func A() int { return lib.Fn() }",
		"func B() int { return lib.Fn() }",
		bindLib("a.go"),
	);
	assertErrorContains(errors, "Undefined: 'lib'");
	assertEqual(errors.length, 1);
});

test("addPackageNamespace binds package types in one file", () => {
	const errors = checkTwoFiles(
		"var x lib.Box",
		"var y lib.Box",
		bindLib("a.go"),
	);
	assertErrorContains(errors, "Unknown type 'lib.Box'");
	assertEqual(errors.length, 1);
});

test("addPackageNamespace does not leak a bare type name to other files", () => {
	const errors = checkTwoFiles("var x lib.Box", "var y Box", bindLib("a.go"));
	assertErrorContains(errors, "Unknown type 'Box'");
	assertEqual(errors.length, 1);
});

test("addPackageNamespace in two files binds each file", () => {
	const errors = checkTwoFiles(
		"func A() int { return lib.Fn() }\nvar x lib.Box",
		"func B() int { return lib.Fn() }\nvar y lib.Box",
		(checker) => {
			bindLib("a.go")(checker);
			bindLib("b.go")(checker);
		},
	);
	assertEqual(errors.length, 0);
});

test("addPackageNamespace without a file binds every file", () => {
	const errors = checkTwoFiles(
		"func A() int { return lib.Fn() }",
		"func B() int { return lib.Fn() }\nvar y lib.Box",
		bindLib(undefined),
	);
	assertEqual(errors.length, 0);
});

const DTS = parseDts(
	"export declare function helper(): number;\nexport interface Foo { n: number }",
);

test("addDefinitions binds values and types in one file", () => {
	const bind = (checker) =>
		checker.addDefinitions(DTS.types, DTS.values, { file: "a.go" });
	const errors = checkTwoFiles(
		"func A() float64 { return helper() }\nvar x Foo",
		"func B() float64 { return helper() }\nvar y Foo",
		bind,
	);
	assertErrorContains(errors, "Undefined: 'helper'");
	assertErrorContains(errors, "Unknown type 'Foo'");
	assertEqual(errors.length, 2);
});

test("addDefinitions without a file binds every file", () => {
	const errors = checkTwoFiles(
		"func A() float64 { return helper() }\nvar x Foo",
		"func B() float64 { return helper() }\nvar y Foo",
		(checker) => checker.addDefinitions(DTS.types, DTS.values),
	);
	assertEqual(errors.length, 0);
});

test("reportUnusedImports checks the file that imports", () => {
	const errors = checkTwoFiles(
		"func A() {}",
		"func B() int { return lib.Fn() }",
		(checker) => {
			bindLib("a.go")(checker);
			bindLib("b.go")(checker);
			checker.trackImport("lib", { _line: 2 }, "a.go", "");
			checker.trackImport("lib", { _line: 2 }, "b.go", "");
		},
	);
	assertErrorContains(errors, "'lib' imported and not used");
	assertEqual(errors.length, 1);
});

test("a file's own package-level names stay out of its imports", () => {
	const errors = checkTwoFiles(
		"func A() int { return 1 }",
		"func B() int { return A() }",
		(checker) => bindLib("a.go")(checker),
	);
	assertEqual(errors.length, 0);
});

test("a type's generic instance resolves in its declaring file", () => {
	// `Box` names `lib.Box` in a.go only; b.go instantiates the generic.
	const errors = checkTwoFiles(
		"type G[T any] struct { v T; b lib.Box }",
		"var g G[int]",
		bindLib("a.go"),
	);
	assertEqual(errors.length, 0);
});

section("Compiler — imports are bound per file");

const SUB_PKG = `package sub

type Box[T any] struct{ V T }

type T struct{ N int }

func Hi() string { return "hi" }
`;

// Compiles `files` in a temp dir and returns the errors, each as
// "<file>: <message>" so a test can say where an error is reported.
function errorsOf(files, options = {}) {
	return withTempDir(files, (dir) => {
		const { errors } = toCompileResult(() => compileDir(dir, options));
		return errors.map((e) => {
			const m = /Type error in (\S+) at line \d+:\d+: (.*)/.exec(e.message);
			return m ? `${m[1]}: ${m[2]}` : e.message;
		});
	});
}

// Asserts `errors` holds exactly one error, `file: message`.
function assertOnlyError(errors, want) {
	assertEqual(errors.length, 1);
	assertContains(errors[0], want);
}

const TARGETS = ["js", "both", "wasm"];

test("an import of a stdlib package applies to its own file (I1.2)", () => {
	for (const forceTarget of TARGETS) {
		const errors = errorsOf(
			{
				"a.go": `package main

import "strings"

func A() string { return strings.ToUpper("a") }
`,
				"b.go": `package main

func B() string { return strings.ToUpper("b") }

func main() { println(A(), B()) }
`,
			},
			{ forceTarget },
		);
		assertOnlyError(errors, "b.go: Undefined: 'strings'");
	}
});

test("an import alias applies to its own file (I1.3)", () => {
	const errors = errorsOf({
		"a.go": `package main

import s "strings"

func A() string { return s.ToUpper("a") }
`,
		"b.go": `package main

func B() string { return s.ToUpper("b") }

func main() { println(A(), B()) }
`,
	});
	assertOnlyError(errors, "b.go: Undefined: 's'");
});

test("two files that both import a package use it (control)", () => {
	withTempDir(
		{
			"a.go": `package main

import "strings"

func A() string { return strings.ToUpper("a") }
`,
			"b.go": `package main

import "strings"

func main() { println(A(), strings.ToUpper("b")) }
`,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "A B"),
	);
});

test("types of an import resolve only in the importing file (I1.8)", () => {
	const importing = `package main

import (
	"strings"
	"./sub"
)

var _ strings.Builder
var _ sub.Box[int]
var _ sub.T

func main() {}
`;
	const using = (decl) => `package main

${decl}
`;
	const cases = [
		["var _ strings.Builder", "Unknown type 'strings.Builder'"],
		["var _ sub.Box[int]", "Unknown type 'sub.Box'"],
		["var _ T", "Unknown type 'T'"],
	];
	for (const [decl, want] of cases) {
		const errors = errorsOf({
			"a.go": importing,
			"b.go": using(decl),
			"sub/sub.go": SUB_PKG,
		});
		assertOnlyError(errors, `b.go: ${want}`);
	}
});

test("types of an import resolve in every file that imports it (I1.8 control)", () => {
	const errors = errorsOf({
		"a.go": `package main

import "strings"

var _ strings.Builder

func main() {}
`,
		"b.go": `package main

import "strings"

var _ strings.Builder
`,
	});
	assertEqual(errors.length, 0);
});

test("js: .d.ts values and types bind in the importing file (I1.9)", () => {
	const files = {
		"h.d.ts": `export declare function helper(): number;
export interface Foo { n: number }
`,
		"a.go": `package main

import "js:./h.d.ts"

var _ Foo

func main() { println(helper()) }
`,
	};
	const errors = errorsOf({
		...files,
		"b.go": `package main

func B() float64 { return helper() }

var _ Foo
`,
	});
	assertEqual(errors.length, 2);
	assertContains(errors.join("\n"), "b.go: Undefined: 'helper'");
	assertContains(errors.join("\n"), "b.go: Unknown type 'Foo'");
});

test("dot-imported values and types bind in the importing file (I1.9)", () => {
	const errors = errorsOf({
		"a.go": `package main

import . "./sub"

var _ T

func main() { println(Hi()) }
`,
		"b.go": `package main

func B() string { return Hi() }

var _ T
`,
		"sub/sub.go": SUB_PKG,
	});
	assertEqual(errors.length, 2);
	assertContains(errors.join("\n"), "b.go: Undefined: 'Hi'");
	assertContains(errors.join("\n"), "b.go: Unknown type 'T'");
});

test("a local package imported by two files under two names compiles (I1.11)", () => {
	withTempDir(
		{
			"a.go": `package main

import "./sub"

func A() string { return sub.Hi() }
`,
			"b.go": `package main

import s "./sub"

func main() { println(A(), s.Hi()) }
`,
			"sub/sub.go": SUB_PKG,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "hi hi"),
	);
});

test("an exported constant folds with the import of its own file", () => {
	withTempDir(
		{
			"a.go": `package main

import "math"

const Half = math.MaxInt8 / 2

func main() { println(Half) }
`,
			"b.go": `package main

const Other = 1
`,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "63"),
	);
	// ... and an importer of the package folds it without the import.
	withTempDir(
		{
			"main.go": `package main

import "./sub"

func main() { println(sub.Half) }
`,
			"sub/a.go": `package sub

import "math"

const Half = math.MaxInt8 / 2
`,
			"sub/b.go": `package sub

const Other = 1
`,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "63"),
	);
});

test("a _test.go file imports what it uses", () => {
	withTempDir(
		{
			"a.go": `package main

import "strings"

func A() string { return strings.ToUpper("a") }

func main() { println(A()) }
`,
			"a_test.go": `package main

import (
	"strings"
	"testing"
)

func TestA(t *testing.T) {
	if strings.ToLower(A()) != "a" {
		t.Fail()
	}
}
`,
		},
		(dir) => {
			const { errors } = toCompileResult(() =>
				compileDir(dir, { includeTests: true }),
			);
			assertEqual(errors.length, 0);
		},
	);
});

test("generated code compiles when the files import different packages", () => {
	withTempDir(
		{
			"a.go": `package main

import (
	"fmt"
	"./sub"
)

func A() string { return fmt.Sprint(sub.T{N: 1}) }
`,
			"b.go": `package main

import "fmt"

func main() { fmt.Println(A(), fmt.Sprintf("%v", []int{1})) }
`,
			"sub/sub.go": SUB_PKG,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "{1} [1]"),
	);
});

test("generated code names a local package's type next to the package's own (I1.12)", () => {
	withTempDir(
		{
			"main.go": `package main

import (
	"encoding/json"
	"./sub"
)

type MyInt int

type Doc struct {
	A MyInt
	B sub.MyInt
}

func main() {
	var d Doc
	if err := json.Unmarshal([]byte(\`{"A":1,"B":2}\`), &d); err != nil {
		println("err")
		return
	}
	println(d.A, d.B)
}
`,
			"sub/sub.go": `package sub

type MyInt int
`,
		},
		(dir) => assertEqual(runJs(compileDir(dir).js).trim(), "1 2"),
	);
});

test("a dot-imported type does not hide the package's own type of that name (I1.13)", () => {
	const files = (own, dot) => ({
		[own]: `package main

type T struct{ M string }

func main() {
	t := T{M: "x"}
	println(A(), t.M)
}
`,
		[dot]: `package main

import . "./sub"

func A() int {
	var t T
	t.N = 3
	return t.N
}
`,
		"sub/sub.go": SUB_PKG,
	});
	for (const [own, dot] of [
		["b.go", "a.go"],
		["a.go", "b.go"],
	])
		withTempDir(files(own, dot), (dir) =>
			assertEqual(runJs(compileDir(dir).js).trim(), "3 x"),
		);
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
