// GoFront test suite — native unit testing and test runner
// Tests for file filtering (*_test.go), testing package stdlib, discovery,
// harness generation, and test execution.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { handleCheck, handleTest } from "../../../src/cli-core.js";
import {
	compileDir,
	compilePackageTests,
	gwFilesIn,
} from "../../../src/compiler.js";
import {
	checkWasmRuntime,
	discoverTests,
	generateTestHarness,
	isTestFunc,
	MIN_WASM_NODE_MAJOR,
	resolveJsdomPath,
	runTests,
} from "../../../src/test-runner.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertThrows,
	compile,
	section,
	test,
} from "../helpers.js";

section("test-runner — file filtering");

test("gwFilesIn excludes *_test.go by default", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-test-filter-"));
	try {
		writeFileSync(join(dir, "app.go"), "package mypkg\n");
		writeFileSync(join(dir, "app_test.go"), "package mypkg\n");
		writeFileSync(join(dir, "helper.templ"), "package mypkg\n");

		const defaultFiles = gwFilesIn(dir);
		assertEqual(defaultFiles.length, 2);
		assert(!defaultFiles.some((f) => f.endsWith("_test.go")));

		const testFiles = gwFilesIn(dir, { includeTests: true });
		assertEqual(testFiles.length, 3);
		assert(testFiles.some((f) => f.endsWith("_test.go")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("compileDir excludes *_test.go from production bundle", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-prod-bundle-"));
	try {
		writeFileSync(
			join(dir, "main.go"),
			`package main
func ProdSecret() string { return "production-code" }
func main() {}
`,
		);
		writeFileSync(
			join(dir, "main_test.go"),
			`package main
import "testing"
func TestSecret(t *testing.T) {
  _ = "test-only-secret-key"
}
`,
		);

		const { js } = compileDir(dir);
		assertContains(js, "production-code");
		assert(!js.includes("test-only-secret-key"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("test-runner — testing package stdlib & type checking");

test("type-checks testing.T methods without errors", () => {
	const { errors } = compile(`package main
import "testing"

func TestMethods(t *testing.T) {
  t.Log("logging", 42)
  t.Logf("hello %s", "world")
  t.Error("error occurred")
  t.Errorf("expected %d, got %d", 1, 2)
  if t.Failed() {
    t.Fail()
  }
  t.Helper()
  name := t.Name()
  _ = name
  if testing.Short() {
    t.Skip("skipping in short mode")
  }
}
`);
	assertEqual(errors.length, 0);
});

test("type-checks subtests with t.Run", () => {
	const { errors } = compile(`package main
import "testing"

func TestSub(t *testing.T) {
  t.Run("subtest_a", func(t *testing.T) {
    t.Log("in subtest")
  })
}
`);
	assertEqual(errors.length, 0);
});

test("rejects invalid method call on testing.T", () => {
	const { errors } = compile(`package main
import "testing"

func TestBad(t *testing.T) {
  t.NonExistentMethod()
}
`);
	assert(errors.length > 0);
	assertErrorContains(errors, "No field 'NonExistentMethod' on testing.T");
});

section("test-runner — test discovery");

test("isTestFunc accurately identifies test functions", () => {
	assert(
		isTestFunc({
			kind: "FuncDecl",
			name: "TestAdd",
			params: [
				{
					type: {
						kind: "PointerType",
						base: { kind: "TypeName", name: "testing.T" },
					},
				},
			],
		}),
	);

	// Wrong prefix
	assert(
		!isTestFunc({
			kind: "FuncDecl",
			name: "testAdd",
			params: [
				{
					type: {
						kind: "PointerType",
						base: { kind: "TypeName", name: "testing.T" },
					},
				},
			],
		}),
	);

	// Wrong param count
	assert(
		!isTestFunc({
			kind: "FuncDecl",
			name: "TestAdd",
			params: [],
		}),
	);
});

test("discoverTests extracts matching test names from programs", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-disc-"));
	try {
		writeFileSync(
			join(dir, "calc.go"),
			`package calc
import "testing"
func Add(a, b int) int { return a + b }
func TestNotInTestFile(t *testing.T) {}
`,
		);
		writeFileSync(
			join(dir, "calc_test.go"),
			`package calc
import "testing"
func HelperFunc() {}
func TestAdd(t *testing.T) {}
func TestSubtract(t *testing.T) {}
`,
		);

		const { programs } = compilePackageTests(dir);
		const names = discoverTests(programs);
		assertEqual(names.length, 2);
		assert(names.includes("TestAdd"));
		assert(names.includes("TestSubtract"));
		assert(
			!names.includes("TestNotInTestFile"),
			"Test funcs outside *_test.go must not be discovered",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("discoverTests treats programs without _filename as test files", () => {
	const decl = {
		kind: "FuncDecl",
		name: "TestBare",
		params: [{ type: { kind: "PointerType", base: { name: "testing.T" } } }],
	};
	assert(isTestFunc(decl), "fixture must be a valid test func");
	assertEqual(discoverTests([{ decls: [decl] }]).length, 1);
});

test("generateTestHarness produces executable runner module", () => {
	const harness = generateTestHarness("function TestDemo(t) {}", ["TestDemo"], {
		pkgName: "demopkg",
		verbose: true,
	});
	assertContains(harness, "TestDemo");
	assertContains(harness, "__runGoFrontSuite");
	assertContains(harness, "demopkg");
});

section("test-runner — test execution");

test("runTests passes with exitCode 0 on passing assertions", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-pass-"));
	try {
		writeFileSync(
			join(dir, "math.go"),
			`package mathpkg
func Multiply(a, b int) int { return a * b }
`,
		);
		writeFileSync(
			join(dir, "math_test.go"),
			`package mathpkg
import "testing"
func TestMultiply(t *testing.T) {
  if Multiply(3, 4) != 12 {
    t.Errorf("expected 12, got %d", Multiply(3, 4))
  }
}
`,
		);

		const result = await runTests(dir, { captureOutput: true });
		assertEqual(result.exitCode, 0);
		assertContains(result.stdout, "PASS");
		assertContains(result.stdout, "ok  \tmathpkg");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests verbose mode outputs RUN and PASS lines", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-verbose-"));
	try {
		writeFileSync(
			join(dir, "greet.go"),
			`package greet
func Hello() string { return "hello" }
`,
		);
		writeFileSync(
			join(dir, "greet_test.go"),
			`package greet
import "testing"
func TestHello(t *testing.T) {
  t.Log("greeting checked")
  if Hello() != "hello" {
    t.Error("unexpected greeting")
  }
}
`,
		);

		const result = await runTests(dir, {
			captureOutput: true,
			verbose: true,
		});
		assertEqual(result.exitCode, 0);
		assertContains(result.stdout, "=== RUN   TestHello");
		assertContains(result.stdout, "--- PASS: TestHello");
		assertContains(result.stdout, "greeting checked");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests fails with exitCode 1 on t.Error and prints logs", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-fail-"));
	try {
		writeFileSync(
			join(dir, "fail.go"),
			`package failpkg
func Value() int { return 100 }
`,
		);
		writeFileSync(
			join(dir, "fail_test.go"),
			`package failpkg
import "testing"
func TestFailure(t *testing.T) {
  t.Errorf("something broke: got %d", Value())
}
`,
		);

		const result = await runTests(dir, { captureOutput: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "=== RUN   TestFailure");
		assertContains(result.stdout, "something broke: got 100");
		assertContains(result.stdout, "--- FAIL: TestFailure");
		assertContains(result.stdout, "FAIL\tfailpkg");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests isolates fatal abort with t.Fatal", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-fatal-"));
	try {
		writeFileSync(
			join(dir, "fatal_test.go"),
			`package fatalpkg
import "testing"

func TestFatal(t *testing.T) {
  t.Fatal("critical error")
  t.Log("THIS_SHOULD_NEVER_BE_LOGGED")
}

func TestSubsequent(t *testing.T) {
  t.Log("subsequent test ran")
}
`,
		);

		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "--- FAIL: TestFatal");
		assertContains(result.stdout, "critical error");
		assert(!result.stdout.includes("THIS_SHOULD_NEVER_BE_LOGGED"));
		assertContains(result.stdout, "--- PASS: TestSubsequent");
		assertContains(result.stdout, "subsequent test ran");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests handles subtests via t.Run", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-subtest-"));
	try {
		writeFileSync(
			join(dir, "sub_test.go"),
			`package subpkg
import "testing"

func TestGroup(t *testing.T) {
  t.Run("child_pass", func(t *testing.T) {
    t.Log("child a ok")
  })
  t.Run("child_fail", func(t *testing.T) {
    t.Error("child b failed")
  })
}
`,
		);

		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "=== RUN   TestGroup/child_pass");
		assertContains(result.stdout, "--- PASS: TestGroup/child_pass");
		assertContains(result.stdout, "=== RUN   TestGroup/child_fail");
		assertContains(result.stdout, "--- FAIL: TestGroup/child_fail");
		assertContains(result.stdout, "child b failed");
		assertContains(result.stdout, "--- FAIL: TestGroup");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests filters tests by -run regex", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-filter-"));
	try {
		writeFileSync(
			join(dir, "filter_test.go"),
			`package filterpkg
import "testing"

func TestOne(t *testing.T) {
  t.Log("test one ran")
}

func TestTwo(t *testing.T) {
  t.Log("test two ran")
}
`,
		);

		const result = await runTests(dir, {
			captureOutput: true,
			verbose: true,
			run: "Two",
		});
		assertEqual(result.exitCode, 0);
		assert(!result.stdout.includes("TestOne"));
		assertContains(result.stdout, "TestTwo");
		assertContains(result.stdout, "test two ran");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests supports DOM manipulation with --dom flag", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-dom-"));
	try {
		writeFileSync(
			join(dir, "dom_test.go"),
			`package dompkg
import "testing"

func TestDOM(t *testing.T) {
  btn := document.createElement("button")
  btn.textContent = "Click Me"
  document.body.appendChild(btn)
  if document.body.children.length != 1 {
    t.Error("expected 1 child")
  }
}
`,
		);

		const result = await runTests(dir, {
			captureOutput: true,
			dom: true,
		});
		assertEqual(result.exitCode, 0);
		assertContains(result.stdout, "PASS");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTest reports [no test files] for directories without tests", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-no-tests-"));
	try {
		writeFileSync(join(dir, "util.go"), "package util\n");
		const result = await handleTest(dir, { captureOutput: true });
		assertEqual(result.exitCode, 0);
		assertContains(result.stdout, "[no test files]");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTest with dir/... runs every package below the root", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-recursive-tests-"));
	try {
		mkdirSync(join(dir, "a"));
		mkdirSync(join(dir, "b", "deep"), { recursive: true });
		mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
		writeFileSync(join(dir, "root.go"), "package root\n");
		writeFileSync(
			join(dir, "a", "a_test.go"),
			`package a
import "testing"
func TestA(t *testing.T) {}
`,
		);
		writeFileSync(
			join(dir, "b", "deep", "deep_test.go"),
			`package deep
import "testing"
func TestDeep(t *testing.T) { t.Error("deep failure") }
`,
		);
		writeFileSync(join(dir, "node_modules", "x", "x.go"), "package x\n");

		const result = await handleTest(`${dir}/...`, { captureOutput: true });
		assertEqual(result.exitCode, 1);
		assertEqual(result.packages.length, 3);
		assert(!result.packages.some((p) => p.includes("node_modules")));
		assertContains(result.stdout, "[no test files]");
		assertContains(result.stdout, "ok");
		assertContains(result.stdout, "deep failure");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleCheck with dir/... type-checks every package below the root", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-recursive-check-"));
	try {
		mkdirSync(join(dir, "ok"));
		mkdirSync(join(dir, "bad"));
		writeFileSync(
			join(dir, "ok", "ok.go"),
			"package ok\nfunc F() int { return 1 }\n",
		);

		const good = handleCheck(`${dir}/...`);
		assertEqual(good.packages.length, 1);

		writeFileSync(
			join(dir, "bad", "bad.go"),
			'package bad\nfunc F() int { return "x" }\n',
		);
		assertThrows(() => handleCheck(`${dir}/...`));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests handles t.Skip and t.Skipf marking test as skipped", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-skip-"));
	try {
		writeFileSync(
			join(dir, "skip_test.go"),
			`package skippkg
import "testing"

func TestSkip(t *testing.T) {
  t.Skip("skipping this test")
  t.Error("THIS_SHOULD_NEVER_RUN")
}

func TestSkipf(t *testing.T) {
  t.Skipf("skipping %s %d", "item", 42)
}
`,
		);

		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 0);
		assertContains(result.stdout, "--- SKIP: TestSkip");
		assertContains(result.stdout, "skipping this test");
		assert(!result.stdout.includes("THIS_SHOULD_NEVER_RUN"));
		assertContains(result.stdout, "--- SKIP: TestSkipf");
		assertContains(result.stdout, "skipping item 42");
		assertContains(result.stdout, "PASS");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests handles t.FailNow stopping execution immediately", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-failnow-"));
	try {
		writeFileSync(
			join(dir, "failnow_test.go"),
			`package failnowpkg
import "testing"

func TestFailNow(t *testing.T) {
  t.Log("before FailNow")
  t.FailNow()
  t.Log("THIS_SHOULD_NOT_EXECUTE")
}
`,
		);

		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "before FailNow");
		assert(!result.stdout.includes("THIS_SHOULD_NOT_EXECUTE"));
		assertContains(result.stdout, "--- FAIL: TestFailNow");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests respects testing.Verbose() flag", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-verbflag-"));
	try {
		writeFileSync(
			join(dir, "verb_test.go"),
			`package verbpkg
import "testing"

func TestVerb(t *testing.T) {
  if !testing.Verbose() {
    t.Error("expected testing.Verbose() to be true")
  }
}
`,
		);

		// With verbose: true -> should pass
		const resVerb = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(resVerb.exitCode, 0);

		// Without verbose -> should fail
		const resNonVerb = await runTests(dir, {
			captureOutput: true,
			verbose: false,
		});
		assertEqual(resNonVerb.exitCode, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests supports async test functions", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-async-"));
	try {
		writeFileSync(
			join(dir, "async_test.go"),
			`package asyncpkg
import "testing"
import "time"

async func delayedSuccess() int {
  time.Sleep(5 * time.Millisecond)
  return 42
}

async func TestAsyncSuccess(t *testing.T) {
  val := await delayedSuccess()
  if val != 42 {
    t.Errorf("expected 42, got %d", val)
  }
}

async func TestAsyncFailure(t *testing.T) {
  time.Sleep(5 * time.Millisecond)
  t.Errorf("async error after delay")
}
`,
		);

		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "--- PASS: TestAsyncSuccess");
		assertContains(result.stdout, "--- FAIL: TestAsyncFailure");
		assertContains(result.stdout, "async error after delay");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests marks parent test failed if any subtest fails", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-subfail-"));
	try {
		writeFileSync(
			join(dir, "subfail_test.go"),
			`package subfailpkg
import "testing"

func TestParent(t *testing.T) {
  t.Run("sub_fails", func(t *testing.T) {
    t.Fail()
  })
  if !t.Failed() {
    t.Error("expected parent to be failed after subtest failed")
  }
}
`,
		);

		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "--- FAIL: TestParent");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("compilePackageTests throws on invalid test code and runTests reports compile error", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-err-test-"));
	try {
		writeFileSync(
			join(dir, "main.go"),
			`package main
func Value() int { return 42 }
`,
		);
		writeFileSync(
			join(dir, "main_test.go"),
			`package main
import "testing"
func TestInvalid(t *testing.T) {
  var x int = "type mismatch"
}
`,
		);

		assertThrows(
			() => compilePackageTests(dir),
			"Cannot assign untyped string to int",
		);

		const result = await runTests(dir, { captureOutput: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stderr, "[build failed]");
		assertContains(result.stderr, "Cannot assign untyped string to int");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests rejects invalid regex for -run", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-badreg-"));
	try {
		writeFileSync(
			join(dir, "demo_test.go"),
			`package demo
import "testing"
func TestDemo(t *testing.T) {}
`,
		);
		let err = null;
		try {
			await runTests(dir, { run: "[" });
		} catch (e) {
			err = e;
		}
		assert(err !== null, "expected invalid regex to throw");
		assertContains(err.message, "invalid regex for -run");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("generateTestHarness uses static __testRegistry and avoids eval", () => {
	const harness = generateTestHarness("function TestOne(t) {}", ["TestOne"]);
	assertContains(harness, "__testRegistry");
	assert(!harness.includes("eval("), "harness should not contain eval");
});

test("generateTestHarness imports jsdom via resolved file:// URL, not bare specifier", () => {
	const jsdomPath = "/some where/node_modules/jsdom/lib/api.js";
	const harness = generateTestHarness("function TestOne(t) {}", ["TestOne"], {
		dom: true,
		jsdomPath,
	});
	assertContains(
		harness,
		`from ${JSON.stringify(pathToFileURL(jsdomPath).href)}`,
	);
	assert(
		!harness.includes('from "jsdom"'),
		"harness must not import jsdom by bare specifier",
	);
});

test("resolveJsdomPath finds jsdom from a directory without local node_modules", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-jsdom-res-"));
	try {
		const path = resolveJsdomPath(dir);
		assert(typeof path === "string" && path.length > 0, "expected a path");
		assertContains(path, "jsdom");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests --dom works from a project dir with no local jsdom", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-exec-dom-global-"));
	try {
		writeFileSync(
			join(dir, "dom_test.go"),
			`package dompkg
import "testing"

func TestDOM(t *testing.T) {
  el := document.createElement("div")
  if el == nil {
    t.Error("expected element")
  }
}
`,
		);
		const result = await runTests(dir, { captureOutput: true, dom: true });
		assertEqual(result.exitCode, 0, result.stderr);
		assertContains(result.stdout, "PASS");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests safely logs circular structures in t.Log", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-test-circular-"));
	try {
		writeFileSync(
			join(dir, "circ_test.go"),
			`package circ
import "testing"

type Node struct {
  Name string
}

func TestCircular(t *testing.T) {
  n := Node{Name: "root"}
  t.Log("node:", n)
}
`,
		);
		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 0);
		assertContains(result.stdout, "--- PASS: TestCircular");
		assertContains(result.stdout, `{"Name":"root"}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests filters tests with -run=Pattern equals syntax", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-test-runeq-"));
	try {
		writeFileSync(
			join(dir, "filter_test.go"),
			`package filterpkg
import "testing"

func TestAlpha(t *testing.T) {
  t.Log("alpha ran")
}

func TestBeta(t *testing.T) {
  t.Log("beta ran")
}
`,
		);

		const result = await runTests(dir, {
			captureOutput: true,
			verbose: true,
			run: "^TestBeta$",
		});
		assertEqual(result.exitCode, 0);
		assert(!result.stdout.includes("alpha ran"));
		assertContains(result.stdout, "beta ran");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("test-runner — output format snapshot");

const SNAPSHOT_SRC = `package snap
import "testing"

func TestPassWithLog(t *testing.T) {
  t.Log("pass log")
}

func TestFailTop(t *testing.T) {
  t.Error("top failure")
}

func TestSkipTop(t *testing.T) {
  t.Skip("skip reason")
}

func TestGroup(t *testing.T) {
  t.Run("ok", func(t *testing.T) { t.Log("sub ok log") })
  t.Run("bad", func(t *testing.T) { t.Errorf("sub bad %d", 1) })
  t.Run("skipped", func(t *testing.T) { t.Skip("sub skip") })
}
`;

// Timing values differ per run; normalise them so the snapshot is stable.
const normalizeTiming = (s) =>
	s.replace(/\(\d+\.\d+s\)/g, "(T)").replace(/\t\d+\.\d+s/g, "\tT");

const SNAPSHOT_VERBOSE = [
	"=== RUN   TestPassWithLog",
	"    pass log",
	"--- PASS: TestPassWithLog (T)",
	"=== RUN   TestFailTop",
	"    top failure",
	"--- FAIL: TestFailTop (T)",
	"=== RUN   TestSkipTop",
	"--- SKIP: TestSkipTop (T)",
	"    skip reason",
	"=== RUN   TestGroup",
	"=== RUN   TestGroup/ok",
	"    sub ok log",
	"--- PASS: TestGroup/ok (T)",
	"=== RUN   TestGroup/bad",
	"    sub bad 1",
	"--- FAIL: TestGroup/bad (T)",
	"=== RUN   TestGroup/skipped",
	"--- SKIP: TestGroup/skipped (T)",
	"    sub skip",
	"--- FAIL: TestGroup (T)",
	"FAIL",
	"FAIL\tsnap\tT",
	"",
].join("\n");

const SNAPSHOT_QUIET = [
	"=== RUN   TestFailTop",
	"    top failure",
	"--- FAIL: TestFailTop (T)",
	"--- SKIP: TestSkipTop (T)",
	"    skip reason",
	"=== RUN   TestGroup/bad",
	"    sub bad 1",
	"--- FAIL: TestGroup/bad (T)",
	"--- SKIP: TestGroup/skipped (T)",
	"    sub skip",
	"=== RUN   TestGroup",
	"--- FAIL: TestGroup (T)",
	"FAIL",
	"FAIL\tsnap\tT",
	"",
].join("\n");

test("runTests verbose output matches Go-style snapshot", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-snap-v-"));
	try {
		writeFileSync(join(dir, "snap_test.go"), SNAPSHOT_SRC);
		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertEqual(normalizeTiming(result.stdout), SNAPSHOT_VERBOSE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests non-verbose output matches Go-style snapshot", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-snap-q-"));
	try {
		writeFileSync(join(dir, "snap_test.go"), SNAPSHOT_SRC);
		const result = await runTests(dir, { captureOutput: true });
		assertEqual(result.exitCode, 1);
		assertEqual(normalizeTiming(result.stdout), SNAPSHOT_QUIET);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("test-runner — dual-target (wasm / both packages)");

test("checkWasmRuntime rejects Node versions without WasmGC with a clear hint", () => {
	checkWasmRuntime(`v${MIN_WASM_NODE_MAJOR}.0.0`);
	checkWasmRuntime(process.version);
	assertThrows(
		() => checkWasmRuntime("v20.11.1"),
		`running wasm packages requires Node ${MIN_WASM_NODE_MAJOR}+ (WasmGC); found v20.11.1`,
	);
	assertThrows(() => checkWasmRuntime("v18.0.0"), "--js-only");
});

test("runTests runs a wasm package's tests inside app.wasm", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-wasm-test-"));
	try {
		writeFileSync(
			join(dir, "calc.go"),
			`//gofront:target wasm
package calc
func Add(a, b int) int { return a + b }
`,
		);
		writeFileSync(
			join(dir, "calc_test.go"),
			`package calc
import "testing"
func TestAdd(t *testing.T) {
  if Add(1, 2) != 3 {
    t.Errorf("Add(1,2) = %d, want 3", Add(1, 2))
  }
  t.Log("name:", t.Name())
}
func TestFails(t *testing.T) {
  t.Errorf("got %v and %s and %t", 2.5, "str", true)
  if !t.Failed() {
    t.Fatal("Failed() should be true")
  }
}
func TestSkips(t *testing.T) {
  t.Skip("not today")
}
`,
		);
		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "--- PASS: TestAdd");
		assertContains(result.stdout, "name: TestAdd");
		assertContains(result.stdout, "got 2.5 and str and true");
		assertContains(result.stdout, "--- FAIL: TestFails");
		assertContains(result.stdout, "--- SKIP: TestSkips");
		assertContains(result.stdout, "not today");
		assert(!result.stdout.includes("Failed() should be true"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests runs a both package's tests on JS and wasm", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-both-test-"));
	try {
		writeFileSync(
			join(dir, "vec.go"),
			`//gofront:target both
package vec
type V struct{ X, Y float64 }
func (v V) Dot(o V) float64 { return v.X*o.X + v.Y*o.Y }
func Scale(v V, k float64) V { return V{v.X * k, v.Y * k} }
`,
		);
		writeFileSync(
			join(dir, "vec_test.go"),
			`package vec
import "testing"
func TestDot(t *testing.T) {
  v := V{1, 2}
  if v.Dot(V{3, 4}) != 11 {
    t.Fatalf("dot = %v", v.Dot(V{3, 4}))
  }
  s := Scale(v, 2)
  if s.X != 2 || s.Y != 4 {
    t.Errorf("scale = %v,%v", s.X, s.Y)
  }
}
`,
		);
		const result = await runTests(dir, { captureOutput: true });
		assertEqual(result.exitCode, 0);
		assertEqual(result.testCount, 2);
		assertContains(result.stdout, "ok  \tvec [js]");
		assertContains(result.stdout, "ok  \tvec [wasm]");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runTests reports a both package failing on either target", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-both-fail-"));
	try {
		writeFileSync(
			join(dir, "n.go"),
			`//gofront:target both
package n
func Twice(x int) int { return x * 2 }
`,
		);
		writeFileSync(
			join(dir, "n_test.go"),
			`package n
import "testing"
func TestTwice(t *testing.T) {
  if Twice(4) != 9 {
    t.Errorf("Twice(4) = %d", Twice(4))
  }
}
`,
		);
		const result = await runTests(dir, { captureOutput: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "FAIL\tn [js]");
		assertContains(result.stdout, "FAIL\tn [wasm]");
		assertEqual(result.stdout.split("Twice(4) = 8").length, 3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("wasm test packages support t.Run subtests", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-wasm-run-"));
	try {
		writeFileSync(
			join(dir, "r.go"),
			`//gofront:target wasm
package r
func One() int { return 1 }
`,
		);
		writeFileSync(
			join(dir, "r_test.go"),
			`package r
import "testing"
func TestSub(t *testing.T) {
  ok := t.Run("inner", func(t *testing.T) { if One() != 1 { t.Fail() } })
  if !ok { t.Error("inner should pass") }
  t.Run("bad", func(t *testing.T) { t.Errorf("one is %d", One()) })
}
`,
		);
		const result = await runTests(dir, { captureOutput: true, verbose: true });
		assertEqual(result.exitCode, 1);
		assertContains(result.stdout, "--- PASS: TestSub/inner");
		assertContains(result.stdout, "--- FAIL: TestSub/bad");
		assertContains(result.stdout, "one is 1");
		assert(!result.stdout.includes("inner should pass"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
