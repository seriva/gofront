//go:build gofront

//gofront:target both

// Package testing provides support for automated testing of Go packages.
//
// Tests and benchmarks run inside the compiled package, on either target: a
// generated driver (the runner writes it in memory next to the _test.go
// files) builds the tests table, calls GofrontMain and runs it. Output
// follows `go test`: "=== RUN", "--- PASS/FAIL/SKIP" lines, indented t.Log
// output, and a PASS or FAIL trailer with the package line.
//
// Tests run one at a time. Parallel, Helper, Attr and the allocation
// counters are accepted and do nothing.
package testing

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// nanotime returns a monotonic clock reading in nanoseconds.
//
//gofront:intrinsic testing_nanotime
func nanotime() int64

// match reports whether the regular expression pattern matches s anywhere.
//
//gofront:intrinsic testing_match
func match(pattern, s string) bool

// TB is the interface common to T and B.
type TB interface {
	Attr(key, value string)
	Cleanup(func())
	Context() context.Context
	Error(args ...any)
	Errorf(format string, args ...any)
	Fail()
	FailNow()
	Failed() bool
	Fatal(args ...any)
	Fatalf(format string, args ...any)
	Helper()
	Log(args ...any)
	Logf(format string, args ...any)
	Name() string
	Output() io.Writer
	Setenv(key, value string)
	Skip(args ...any)
	SkipNow()
	Skipf(format string, args ...any)
	Skipped() bool
}

// sentinel is what FailNow and SkipNow panic with; the test runner swallows
// it.
type sentinel struct {
	name string
}

var (
	failNowSentinel = &sentinel{"FailNow"}
	skipNowSentinel = &sentinel{"SkipNow"}
)

// settings are the flags of the current run, set by GofrontMain. They sit
// behind a pointer because a package for both targets may not assign its
// package-level variables.
type settings struct {
	verbose bool
	color   bool
	pats    []string
}

var cfg = &settings{}

func (s *settings) set(verbose, color bool, run string) {
	s.verbose = verbose
	s.color = color
	s.pats = nil
	if run != "" {
		s.pats = strings.Split(run, "/")
	}
}

// Short reports whether the -short flag is set. It never is.
func Short() bool { return false }

// Verbose reports whether the -v flag is set.
func Verbose() bool { return cfg.verbose }

// Testing reports whether the program is a test binary. It always is.
func Testing() bool { return true }

// Init registers testing flags. There are none.
func Init() {}

func paint(code, s string) string {
	if !cfg.color {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}

func red(s string) string    { return paint("31", s) }
func green(s string) string  { return paint("32", s) }
func yellow(s string) string { return paint("33", s) }
func dim(s string) string    { return paint("2", s) }
func bold(s string) string   { return paint("1", s) }

func say(s string) {
	os.Stdout.WriteString(s + "\n")
}

// pendingSub is a subtest whose body returned a promise (js packages).
type pendingSub struct {
	sub *T
	res any
}

// common holds the state shared by T and B.
type common struct {
	name     string
	logs     []string
	failed   bool
	skipped  bool
	parent   *common
	cleanups []func()
	start    int64
	ctx      context.Context
	pending  []pendingSub
}

// T is a type passed to Test functions to manage test state and support
// formatted test logs.
type T struct {
	common
}

func (c *common) Name() string { return c.name }

// Fail marks the function as having failed but continues execution.
func (c *common) Fail() {
	c.failed = true
	if c.parent != nil {
		c.parent.Fail()
	}
}

// Failed reports whether the function has failed.
func (c *common) Failed() bool { return c.failed }

// FailNow marks the function as having failed and stops its execution.
func (c *common) FailNow() {
	c.Fail()
	panic(failNowSentinel)
}

func (c *common) log(s string) {
	c.logs = append(c.logs, s)
}

func sprintln(args []any) string {
	s := fmt.Sprintln(args...)
	return s[:len(s)-1]
}

// Log formats its arguments using default formatting, analogous to Println,
// and records the text in the error log.
func (c *common) Log(args ...any) { c.log(sprintln(args)) }

// Logf formats its arguments according to the format, analogous to Printf.
func (c *common) Logf(format string, args ...any) { c.log(fmt.Sprintf(format, args...)) }

// Error is equivalent to Log followed by Fail.
func (c *common) Error(args ...any) {
	c.Log(args...)
	c.Fail()
}

// Errorf is equivalent to Logf followed by Fail.
func (c *common) Errorf(format string, args ...any) {
	c.Logf(format, args...)
	c.Fail()
}

// Fatal is equivalent to Log followed by FailNow.
func (c *common) Fatal(args ...any) {
	c.Log(args...)
	c.FailNow()
}

// Fatalf is equivalent to Logf followed by FailNow.
func (c *common) Fatalf(format string, args ...any) {
	c.Logf(format, args...)
	c.FailNow()
}

// SkipNow marks the test as having been skipped and stops its execution.
func (c *common) SkipNow() {
	c.skipped = true
	panic(skipNowSentinel)
}

// Skip is equivalent to Log followed by SkipNow.
func (c *common) Skip(args ...any) {
	c.Log(args...)
	c.SkipNow()
}

// Skipf is equivalent to Logf followed by SkipNow.
func (c *common) Skipf(format string, args ...any) {
	c.Logf(format, args...)
	c.SkipNow()
}

// Skipped reports whether the test was skipped.
func (c *common) Skipped() bool { return c.skipped }

// Helper marks the calling function as a test helper function.
func (c *common) Helper() {}

// Attr emits a test attribute. It is not recorded.
func (c *common) Attr(key, value string) {}

// Output returns a Writer that writes to the standard output.
func (c *common) Output() io.Writer { return os.Stdout }

// Cleanup registers a function to be called when the test completes.
// Cleanup functions are called last added, first called.
func (c *common) Cleanup(f func()) {
	c.cleanups = append(c.cleanups, f)
}

// Setenv calls os.Setenv(key, value) and uses Cleanup to restore the
// environment variable to its original value after the test.
func (c *common) Setenv(key, value string) {
	prev := os.Getenv(key)
	os.Setenv(key, value)
	c.Cleanup(func() { os.Setenv(key, prev) })
}

// Context returns a context that is canceled just before Cleanup-registered
// functions are called.
func (c *common) Context() context.Context {
	if c.ctx == nil {
		ctx, cancel := context.WithCancel(context.Background())
		c.ctx = ctx
		c.Cleanup(cancel)
	}
	return c.ctx
}

// Guard is deferred around a test body: it turns a panic into a failed test
// and swallows the panics FailNow and SkipNow raise. The generated driver
// uses it; tests do not call it.
func (c *common) Guard() {
	r := recover()
	if r == nil {
		return
	}
	if s, ok := r.(*sentinel); ok && (s == failNowSentinel || s == skipNowSentinel) {
		return
	}
	c.Fail()
	c.log("panic: " + fmt.Sprint(r))
}

// runCleanups calls the cleanup functions, last added first. A panic in one
// fails the test.
func (c *common) runCleanups() {
	for len(c.cleanups) > 0 {
		n := len(c.cleanups) - 1
		f := c.cleanups[n]
		c.cleanups = c.cleanups[:n]
		c.runCleanup(f)
	}
}

func (c *common) runCleanup(f func()) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		if s, ok := r.(*sentinel); ok && (s == failNowSentinel || s == skipNowSentinel) {
			return
		}
		c.Fail()
		c.log("panic in cleanup: " + fmt.Sprint(r))
	}()
	f()
}

// Deadline reports the time at which the test binary will have exceeded the
// timeout. There is never one.
func (c *common) Deadline() (deadline time.Time, ok bool) {
	return
}

// Parallel does nothing: tests run one at a time.
func (t *T) Parallel() {}

// selected reports whether the -run patterns let the test with this full
// name run: each slash-separated element is matched at its level.
func selected(full string) bool {
	runPats := cfg.pats
	if len(runPats) == 0 {
		return true
	}
	elems := strings.Split(full, "/")
	for i, e := range elems {
		if i < len(runPats) && !match(runPats[i], e) {
			return false
		}
	}
	return true
}

// elapsed is the seconds since the test started, as Go prints it.
func (c *common) elapsed() string {
	return dim(fmt.Sprintf("(%.2fs)", float64(nanotime()-c.start)/1e9))
}

func (c *common) printLogs(paintLog func(string) string) {
	for _, l := range c.logs {
		lines := strings.Split(l, "\n")
		for i, line := range lines {
			if i == 0 {
				say("    " + paintLog(line))
			} else {
				say("        " + paintLog(line))
			}
		}
	}
}

func plain(s string) string { return s }

// begin announces the test (always when verbose; failing tests announce
// themselves when they report).
func (c *common) begin() {
	c.start = nanotime()
	if cfg.verbose {
		say(dim("=== RUN   ") + c.name)
	}
}

// report prints what a finished test produced.
func (c *common) report() {
	switch {
	case c.failed:
		if !cfg.verbose {
			say(dim("=== RUN   ") + c.name)
		}
		c.printLogs(red)
		say("--- " + bold(red("FAIL")) + ": " + c.name + " " + c.elapsed())
	case c.skipped:
		say("--- " + yellow("SKIP") + ": " + c.name + " " + c.elapsed())
		c.printLogs(plain)
	case cfg.verbose:
		c.printLogs(plain)
		say("--- " + green("PASS") + ": " + c.name + " " + c.elapsed())
	}
}

// finish runs the cleanups and reports.
func (c *common) finish() {
	c.runCleanups()
	c.report()
}

// callHook calls a test body and returns what it returned, so a js package
// can wait for an async body (async_js.go). Without it a body is called
// directly.
var callHook func(f func(*T), t *T) any

// invoke runs the body of a test, turning a panic into a failure.
func (t *T) invoke(f func(*T)) any {
	defer t.Guard()
	if callHook != nil {
		return callHook(f, t)
	}
	f(t)
	return nil
}

// Run runs f as a subtest of t called name. It reports whether f succeeded
// (or has not finished yet, for an async subtest of a js package).
func (t *T) Run(name string, f func(t *T)) bool {
	full := name
	if t.name != "" {
		full = t.name + "/" + name
	}
	if !selected(full) {
		return true
	}
	sub := &T{common: common{name: full, parent: &t.common}}
	sub.begin()
	if res := sub.invoke(f); res != nil {
		t.pending = append(t.pending, pendingSub{sub, res})
		return true
	}
	sub.finish()
	return !sub.failed
}

// GofrontTest is an entry of the generated driver's table of tests.
type GofrontTest struct {
	Name string
	F    func(*T)
}

// GofrontBenchmark is an entry of the generated driver's table of
// benchmarks.
type GofrontBenchmark struct {
	Name string
	F    func(*B)
}

// M is a type passed to a TestMain function to run the actual tests.
type M struct {
	pkg        string
	run, bench string
	tests      []GofrontTest
	benches    []GofrontBenchmark
	failures   int
	startedAt  int64
	exit       int
	ran        bool
}

// GofrontMain makes the M the generated driver runs: the package's name, the
// -run and -bench patterns, -v, and the package's tests and benchmarks. The
// GOFRONT_TEST_LABEL and GOFRONT_TEST_COLOR environment variables name the
// package in the summary line and turn on colour.
func GofrontMain(pkg, run, bench string, v bool, tests []GofrontTest, benches []GofrontBenchmark) *M {
	cfg.set(v, os.Getenv("GOFRONT_TEST_COLOR") == "1", run)
	if label := os.Getenv("GOFRONT_TEST_LABEL"); label != "" {
		pkg = label
	}
	return &M{pkg: pkg, run: run, bench: bench, tests: tests, benches: benches}
}

// ExitCode is the status the test binary exits with once TestMain returns:
// the result of Run, or 0 when TestMain never called it.
func (m *M) ExitCode() int { return m.exit }

// plan returns the tests and benchmarks the patterns select, and warns when
// there are none.
func (m *M) plan() ([]GofrontTest, []GofrontBenchmark) {
	m.startedAt = nanotime()
	m.ran = true
	var tests []GofrontTest
	for _, tt := range m.tests {
		if selected(tt.Name) {
			tests = append(tests, tt)
		}
	}
	var benches []GofrontBenchmark
	if m.bench != "" {
		for _, bb := range m.benches {
			if match(m.bench, bb.Name) {
				benches = append(benches, bb)
			}
		}
	}
	if len(tests) == 0 && len(benches) == 0 {
		if len(m.tests) > 0 && m.run != "" {
			say(yellow(fmt.Sprintf("testing: warning: no tests to run matching %q", m.run)))
		}
		if len(m.benches) > 0 && m.bench != "" {
			say(yellow(fmt.Sprintf("testing: warning: no benchmarks to run matching %q", m.bench)))
		}
	}
	return tests, benches
}

// conclude prints the trailer and the package line and returns the exit
// code.
func (m *M) conclude() int {
	secs := dim(fmt.Sprintf("%.3fs", float64(nanotime()-m.startedAt)/1e9))
	code := 0
	if m.failures > 0 {
		say(bold(red("FAIL")))
		say(bold(red("FAIL")) + "\t" + m.pkg + "\t" + secs)
		code = 1
	} else {
		say(green("PASS"))
		say(green("ok  ") + "\t" + m.pkg + "\t" + secs)
	}
	m.exit = code
	return code
}

// Run runs the tests, then the selected benchmarks, and returns the exit
// code: 0 when everything passed.
func (m *M) Run() int {
	tests, benches := m.plan()
	for _, tt := range tests {
		t := &T{common: common{name: tt.Name}}
		t.begin()
		t.invoke(tt.F)
		t.finish()
		if t.failed {
			m.failures++
		}
	}
	for _, bb := range benches {
		m.runBenchmark(bb)
	}
	return m.conclude()
}
