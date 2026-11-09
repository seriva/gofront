// GoFront test suite — package testing (Go source) on the JS and wasm targets
//
// Each fixture is a `_test.go` file compiled and run through the test runner
// (a `js` package, and the same code as a `wasm` package).

import { runTests } from "../../../src/cli/test-runner.js";
import {
	assert,
	assertContains,
	assertEqual,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

const WASM = "//gofront:target wasm\n";

// Runs `body` (the contents of a _test.go file, without its package clause)
// as a package of each target and hands the result of each to `check`.
async function onBothTargets(body, options, check) {
	for (const [target, header] of [
		["js", ""],
		["wasm", WASM],
	]) {
		await withTempDir(
			{ "fix_test.go": `${header}package fix\n${body}` },
			async (dir) => {
				const result = await runTests(dir, {
					captureOutput: true,
					...options,
				});
				check(result, target);
			},
		);
	}
}

const normalize = (s) =>
	s.replace(/\(\d+\.\d+s\)/g, "(T)").replace(/\t\d+\.\d+s/g, "\tT");

section("testing — output format");

test("pass, fail and skip report like go test", async () => {
	await onBothTargets(
		`import "testing"
func TestPass(t *testing.T) { t.Log("pass log") }
func TestFail(t *testing.T) { t.Errorf("failed with %d", 7) }
func TestSkip(t *testing.T) { t.Skipf("skipped %s", "here") }
`,
		{ verbose: true },
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			assertEqual(
				normalize(r.stdout),
				[
					"=== RUN   TestPass",
					"    pass log",
					"--- PASS: TestPass (T)",
					"=== RUN   TestFail",
					"    failed with 7",
					"--- FAIL: TestFail (T)",
					"=== RUN   TestSkip",
					"--- SKIP: TestSkip (T)",
					"    skipped here",
					"FAIL",
					"FAIL\tfix\tT",
					"",
				].join("\n"),
			);
		},
	);
});

test("a passing run prints PASS and the package line, quietly without -v", async () => {
	await onBothTargets(
		`import "testing"
func TestPass(t *testing.T) { t.Log("hidden") }
`,
		{},
		(r, target) => {
			assertEqual(r.exitCode, 0, target);
			assertEqual(normalize(r.stdout), "PASS\nok  \tfix\tT\n");
		},
	);
});

test("t.Log formats its operands like Println and Logf like Printf", async () => {
	await onBothTargets(
		`import "testing"
type P struct{ X, Y int }
func TestLog(t *testing.T) {
	t.Log("a", 1, 2.5, true, P{1, 2}, []int{3, 4})
	t.Logf("%v %+v %d %s", P{1, 2}, P{3, 4}, 7, "s")
	t.Error("e1", "e2")
}
`,
		{ verbose: true },
		(r, target) => {
			assertContains(r.stdout, "    a 1 2.5 true {1 2} [3 4]");
			assertContains(r.stdout, "    {1 2} {X:3 Y:4} 7 s");
			assertContains(r.stdout, "    e1 e2");
			assertEqual(r.exitCode, 1, target);
		},
	);
});

test("a panic fails the test with its value and the run goes on", async () => {
	await onBothTargets(
		`import "testing"
func TestBoom(t *testing.T) { panic("boom") }
func TestAfter(t *testing.T) {}
`,
		{ verbose: true },
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			assertContains(r.stdout, "panic: boom");
			assertContains(r.stdout, "--- FAIL: TestBoom");
			assertContains(r.stdout, "--- PASS: TestAfter");
		},
	);
});

section("testing — failing, skipping and cleanup");

test("t.Fatal stops the test; under recover the test still fails", async () => {
	await onBothTargets(
		`import "testing"
func TestFatal(t *testing.T) {
	t.Fatal("stop")
	t.Log("not reached")
}
func TestRecovered(t *testing.T) {
	defer func() { recover() }()
	t.Fatal("swallowed")
}
func TestAfter(t *testing.T) {}
`,
		{ verbose: true },
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			assert(!r.stdout.includes("not reached"), target);
			assertContains(r.stdout, "--- FAIL: TestFatal");
			assertContains(r.stdout, "--- FAIL: TestRecovered");
			assertContains(r.stdout, "--- PASS: TestAfter");
		},
	);
});

test("t.Skip after t.Error reports FAIL", async () => {
	await onBothTargets(
		`import "testing"
func TestBoth(t *testing.T) {
	t.Error("bad")
	t.Skip("late")
}
`,
		{},
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			assertContains(r.stdout, "--- FAIL: TestBoth");
			assert(!r.stdout.includes("SKIP"), target);
		},
	);
});

test("Cleanup functions run last-in first-out, also after Fatal, and a panic in one fails", async () => {
	await onBothTargets(
		`import (
	"fmt"
	"testing"
)
func TestOrder(t *testing.T) {
	t.Cleanup(func() { fmt.Println("cleanup 1") })
	t.Cleanup(func() { fmt.Println("cleanup 2") })
	t.Fatal("stop")
}
func TestCleanupPanic(t *testing.T) {
	t.Cleanup(func() { panic("in cleanup") })
}
`,
		{ verbose: true },
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			const at1 = r.stdout.indexOf("cleanup 1");
			const at2 = r.stdout.indexOf("cleanup 2");
			assert(at2 >= 0 && at1 > at2, `${target}: ${r.stdout}`);
			assertContains(r.stdout, "panic in cleanup: in cleanup");
			assertContains(r.stdout, "--- FAIL: TestCleanupPanic");
		},
	);
});

test("Setenv restores the variable, Context is canceled on cleanup", async () => {
	await onBothTargets(
		`import (
	"context"
	"os"
	"testing"
)
var saved context.Context
func TestEnv(t *testing.T) {
	t.Run("set", func(t *testing.T) {
		t.Setenv("GOFRONT_TESTING_FIXTURE", "on")
		if os.Getenv("GOFRONT_TESTING_FIXTURE") != "on" {
			t.Error("not set")
		}
		saved = t.Context()
		if saved.Err() != nil {
			t.Error("canceled too early")
		}
	})
	if os.Getenv("GOFRONT_TESTING_FIXTURE") != "" {
		t.Error("not restored")
	}
	if saved.Err() == nil {
		t.Error("not canceled")
	}
}
`,
		{},
		(r, target) => {
			assertEqual(r.exitCode, 0, `${target}: ${r.stdout}`);
		},
	);
});

test("Context is canceled before cleanups registered after it run", async () => {
	await onBothTargets(
		`import (
	"testing"
)
func TestCtx(t *testing.T) {
	ctx := t.Context()
	t.Cleanup(func() {
		if ctx.Err() == nil {
			t.Error("context not canceled before cleanup")
		}
	})
}
`,
		{},
		(r, target) => {
			assertEqual(r.exitCode, 0, `${target}: ${r.stdout}`);
		},
	);
});

section("testing — subtests and -run");

const SUBTESTS = `import "testing"
func TestGroup(t *testing.T) {
	ok := t.Run("alpha", func(t *testing.T) { t.Log("a") })
	if !ok {
		t.Error("alpha should pass")
	}
	t.Run("beta", func(t *testing.T) { t.Log("b") })
}
func TestOther(t *testing.T) { t.Log("other") }
`;

test("subtests are named Parent/sub and a failing one fails the parent", async () => {
	await onBothTargets(
		`import "testing"
func TestGroup(t *testing.T) {
	t.Run("ok", func(t *testing.T) {})
	t.Run("bad", func(t *testing.T) { t.Error("sub bad") })
}
`,
		{ verbose: true },
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			assertContains(r.stdout, "--- PASS: TestGroup/ok");
			assertContains(r.stdout, "--- FAIL: TestGroup/bad");
			assertContains(r.stdout, "--- FAIL: TestGroup (");
		},
	);
});

test("-run matches each slash-separated level of a subtest name", async () => {
	await onBothTargets(
		SUBTESTS,
		{ verbose: true, run: "TestGroup/beta" },
		(r) => {
			assertContains(r.stdout, "--- PASS: TestGroup/beta");
			assert(!r.stdout.includes("TestGroup/alpha"), r.stdout);
			assert(!r.stdout.includes("TestOther"), r.stdout);
		},
	);
	await onBothTargets(SUBTESTS, { verbose: true, run: "Other" }, (r) => {
		assertContains(r.stdout, "--- PASS: TestOther");
		assert(!r.stdout.includes("TestGroup"), r.stdout);
	});
});

test("-run with no match warns and passes", async () => {
	await onBothTargets(SUBTESTS, { run: "Nothing" }, (r, target) => {
		assertEqual(r.exitCode, 0, target);
		assertContains(
			r.stdout,
			'testing: warning: no tests to run matching "Nothing"',
		);
		assertContains(r.stdout, "PASS");
	});
});

section("testing — TB, benchmarks and the package-level functions");

test("T and B satisfy TB and the flags have their fixed values", async () => {
	await onBothTargets(
		`import "testing"
func helper(tb testing.TB) {
	tb.Helper()
	tb.Log("helped", tb.Name())
}
func TestTB(t *testing.T) {
	helper(t)
	if testing.Short() || !testing.Testing() || testing.Verbose() {
		t.Error("flags")
	}
	if _, ok := t.Deadline(); ok {
		t.Error("deadline")
	}
	t.Parallel()
	t.Attr("k", "v")
}
func BenchmarkTB(b *testing.B) { helper(b) }
`,
		{ verbose: false, bench: "TB" },
		(r, target) => {
			assertEqual(r.exitCode, 0, `${target}: ${r.stdout}`);
		},
	);
});

test("b.Loop, b.N, Elapsed, SetBytes and BenchmarkResult.String", async () => {
	await onBothTargets(
		`import (
	"fmt"
	"testing"
)
func BenchmarkLoop(b *testing.B) {
	b.SetBytes(8)
	n := 0
	for b.Loop() {
		n++
	}
	if b.N != n || b.Elapsed() <= 0 {
		b.Fatalf("N=%d n=%d elapsed=%v", b.N, n, b.Elapsed())
	}
}
func BenchmarkN(b *testing.B) {
	for i := 0; i < b.N; i++ {
	}
}
func TestResult(t *testing.T) {
	res := testing.Benchmark(func(b *testing.B) {
		for i := 0; i < b.N; i++ {
		}
	})
	if res.N <= 0 || res.NsPerOp() < 0 {
		t.Errorf("result %+v", res)
	}
	t.Log(res.String())
	fmt.Println(res.MemString())
}
`,
		{ bench: "." },
		(r, target) => {
			assertEqual(r.exitCode, 0, `${target}: ${r.stdout}`);
			assertContains(r.stdout, "BenchmarkLoop");
			assertContains(r.stdout, "BenchmarkN");
			assertContains(r.stdout, "ns/op");
			assertContains(r.stdout, "MB/s");
		},
	);
});

test("benchmarks run only with -bench and a failing one fails the run", async () => {
	await onBothTargets(
		`import "testing"
func TestOne(t *testing.T) {}
func BenchmarkBad(b *testing.B) { b.Fatal("bench failed") }
`,
		{},
		(r, target) => {
			assertEqual(r.exitCode, 0, target);
			assert(!r.stdout.includes("BenchmarkBad"), target);
		},
	);
	await onBothTargets(
		`import "testing"
func BenchmarkBad(b *testing.B) { b.Fatal("bench failed") }
`,
		{ bench: "Bad" },
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			assertContains(r.stdout, "--- FAIL: BenchmarkBad");
			assertContains(r.stdout, "bench failed");
		},
	);
});

test("b.Run sub-benchmarks grow N and report their own result row", async () => {
	await onBothTargets(
		`import (
	"fmt"
	"testing"
)
func BenchmarkX(b *testing.B) {
	b.Run("sub", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
		}
		if b.N > 1 {
			fmt.Println("grew")
		}
	})
	b.Run("inner", func(b *testing.B) {
		b.Run("leaf", func(b *testing.B) {
			for i := 0; i < b.N; i++ {
			}
		})
	})
}
`,
		{ bench: "X", verbose: true },
		(r, target) => {
			assertEqual(r.exitCode, 0, `${target}: ${r.stdout}`);
			assertContains(r.stdout, "=== RUN   BenchmarkX/sub");
			assertContains(r.stdout, "grew");
			const rows = r.stdout
				.split("\n")
				.filter((l) => /^Benchmark\S*\s+\d+\s+\d+ ns\/op/.test(l))
				.map((l) => l.split(/\s+/)[0]);
			assertEqual(
				rows.join(","),
				"BenchmarkX/sub,BenchmarkX/inner/leaf",
				`${target}: ${r.stdout}`,
			);
		},
	);
});

test("a failing b.Run sub-benchmark fails the run", async () => {
	await onBothTargets(
		`import "testing"
func BenchmarkX(b *testing.B) {
	b.Run("sub", func(b *testing.B) { b.Fatal("sub failed") })
}
`,
		{ bench: "X" },
		(r, target) => {
			assertEqual(r.exitCode, 1, target);
			assertContains(r.stdout, "--- FAIL: BenchmarkX/sub");
			assertContains(r.stdout, "sub failed");
		},
	);
});

await summarize();
