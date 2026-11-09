//go:build gofront

//gofront:target both

package testing

import (
	"fmt"
	"time"
)

// B is a type passed to Benchmark functions to manage benchmark timing and
// control the number of iterations.
type B struct {
	common
	// N is the number of iterations the benchmark function must run.
	N          int
	timerOn    bool
	timerStart int64
	elapsedNs  int64
	bytes      int64
	targetNs   int64

	// hasSub is set once b.Run has run a sub-benchmark: the parent then
	// reports no result of its own and is not grown.
	hasSub bool

	loopStarted bool
	loopIters   int
	nextCheck   int
}

func newB(name string, targetNs int64) *B {
	return &B{
		common:     common{name: name},
		N:          1,
		timerOn:    true,
		timerStart: nanotime(),
		targetNs:   targetNs,
	}
}

// ResetTimer zeroes the elapsed benchmark time.
func (b *B) ResetTimer() {
	b.timerStart = nanotime()
	b.elapsedNs = 0
}

// StartTimer starts timing a test.
func (b *B) StartTimer() {
	if !b.timerOn {
		b.timerStart = nanotime()
		b.timerOn = true
	}
}

// StopTimer stops timing a test.
func (b *B) StopTimer() {
	if b.timerOn {
		b.elapsedNs += nanotime() - b.timerStart
		b.timerOn = false
	}
}

// ReportAllocs enables malloc statistics. They are not collected.
func (b *B) ReportAllocs() {}

// ReportMetric adds a custom metric. It is not recorded.
func (b *B) ReportMetric(n float64, unit string) {}

// SetBytes records the number of bytes processed in a single operation.
func (b *B) SetBytes(n int64) { b.bytes = n }

// Elapsed returns the measured elapsed time of the benchmark.
func (b *B) Elapsed() time.Duration {
	ns := b.elapsedNs
	if b.timerOn {
		ns += nanotime() - b.timerStart
	}
	return time.Duration(ns)
}

// Loop returns true as long as the benchmark should continue running.
func (b *B) Loop() bool {
	if !b.loopStarted {
		b.loopStarted = true
		b.ResetTimer()
		if b.targetNs == 0 {
			b.targetNs = 1000000000
		}
		b.loopIters = 0
		b.nextCheck = 1
	}
	if b.failed || b.skipped {
		return false
	}
	b.loopIters++
	b.N = b.loopIters
	if b.loopIters >= b.nextCheck {
		elapsed := nanotime() - b.timerStart
		if elapsed >= b.targetNs || b.loopIters >= 1000000000 {
			// This call starts no iteration.
			b.loopIters--
			b.N = b.loopIters
			b.StopTimer()
			return false
		}
		nsPerOp := max(int64(1), elapsed/int64(b.loopIters))
		remaining := b.targetNs - elapsed
		add := max(int64(1), min(int64(100000), remaining/(nsPerOp*2)))
		b.nextCheck = b.loopIters + int(add)
	}
	return true
}

func (b *B) invoke(f func(*B)) {
	defer b.Guard()
	f(b)
}

// Run runs f as a sub-benchmark of b called name, growing b.N until the run
// takes the target time, and reports its result. It reports whether f
// succeeded.
func (b *B) Run(name string, f func(b *B)) bool {
	full := name
	if b.name != "" {
		full = b.name + "/" + name
	}
	if !selected(full) {
		return true
	}
	b.hasSub = true
	sub := newB(full, b.targetNs)
	sub.parent = &b.common
	sub.begin()
	sub.ResetTimer()
	sub.invoke(f)
	sub.grow(f)
	sub.StopTimer()
	sub.runCleanups()
	if sub.failed {
		// A failure in a regrown run did not reach the parent.
		b.Fail()
	}
	if !sub.onlyParent() {
		sub.reportBenchmark()
	}
	return !sub.failed
}

// BenchmarkResult contains the results of a benchmark run.
type BenchmarkResult struct {
	N         int
	T         time.Duration
	Bytes     int64
	MemAllocs uint64
	MemBytes  uint64
	Extra     map[string]float64
}

// NsPerOp returns the "ns/op" metric.
func (r BenchmarkResult) NsPerOp() int64 {
	if r.N <= 0 {
		return 0
	}
	return int64(r.T) / int64(r.N)
}

// AllocsPerOp returns the "allocs/op" metric.
func (r BenchmarkResult) AllocsPerOp() int64 {
	if r.N <= 0 {
		return 0
	}
	return int64(r.MemAllocs) / int64(r.N)
}

// AllocedBytesPerOp returns the "B/op" metric.
func (r BenchmarkResult) AllocedBytesPerOp() int64 {
	if r.N <= 0 {
		return 0
	}
	return int64(r.MemBytes) / int64(r.N)
}

// MemString returns r.AllocedBytesPerOp and r.AllocsPerOp in the same format
// as 'go test'.
func (r BenchmarkResult) MemString() string {
	return fmt.Sprintf("%d B/op\t%d allocs/op", r.AllocedBytesPerOp(), r.AllocsPerOp())
}

// String returns a summary of the benchmark results.
func (r BenchmarkResult) String() string {
	s := fmt.Sprintf("%d\t%d ns/op", r.N, r.NsPerOp())
	if r.Bytes > 0 && r.T > 0 {
		mbPerSec := float64(r.Bytes*int64(r.N)) / (float64(r.T) / 1e9) / (1024 * 1024)
		s += fmt.Sprintf("\t%.2f MB/s", mbPerSec)
	}
	return s
}

// grow reruns f with a larger b.N until the run takes the target time. A
// benchmark that calls b.Loop sizes itself.
func (b *B) grow(f func(*B)) {
	if b.loopStarted || b.hasSub || b.failed || b.skipped {
		return
	}
	b.StopTimer()
	b.runCleanups()
	n := 1
	for !b.failed && !b.skipped {
		elapsed := int64(b.Elapsed())
		if elapsed >= b.targetNs || n >= 1000000000 {
			break
		}
		var next int
		if elapsed == 0 {
			next = n * 100
		} else {
			next = max(n+1, min(1000000000, int(float64(n)*(float64(b.targetNs)/float64(elapsed))*1.2)))
		}
		if next <= n {
			break
		}
		n = next
		nb := newB(b.name, b.targetNs)
		nb.N = n
		nb.ResetTimer()
		nb.invoke(f)
		nb.StopTimer()
		nb.runCleanups()
		b.N = nb.N
		b.elapsedNs = nb.elapsedNs
		b.timerOn = false
		b.failed = nb.failed
		b.skipped = nb.skipped
		b.logs = nb.logs
	}
}

// Benchmark benchmarks a single function.
func Benchmark(f func(b *B)) BenchmarkResult {
	b := newB("Benchmark", 1000000000)
	b.ResetTimer()
	b.invoke(f)
	b.grow(f)
	b.runCleanups()
	return BenchmarkResult{N: b.N, T: b.Elapsed(), Bytes: b.bytes}
}

// runBenchmark runs one benchmark of the table and prints its line.
func (m *M) runBenchmark(bb GofrontBenchmark) {
	if cfg.verbose {
		say(dim("=== RUN   ") + bb.Name)
	}
	b := newB(bb.Name, 100000000)
	b.ResetTimer()
	b.invoke(bb.F)
	b.grow(bb.F)
	b.runCleanups()
	if b.failed {
		m.failures++
	}
	if !b.onlyParent() {
		b.reportBenchmark()
	}
}

// onlyParent reports whether b just ran sub-benchmarks, which reported their
// own results, so it has none of its own.
func (b *B) onlyParent() bool {
	return b.hasSub && !b.failed && !b.skipped
}

func (b *B) reportBenchmark() {
	if b.skipped {
		say("--- " + yellow("SKIP") + ": " + b.name)
		b.printLogs(plain)
		return
	}
	if b.failed {
		say("--- " + bold(red("FAIL")) + ": " + b.name)
		b.printLogs(red)
		return
	}
	elapsed := int64(b.Elapsed())
	nsPerOp := 0.0
	if b.N > 0 {
		nsPerOp = float64(elapsed) / float64(b.N)
	}
	line := fmt.Sprintf("%-20s\t%8d\t%10.0f ns/op", b.name, b.N, nsPerOp)
	if b.bytes > 0 && elapsed > 0 {
		mbPerSec := float64(b.bytes*int64(b.N)) / (float64(elapsed) / 1e9) / (1024 * 1024)
		line += fmt.Sprintf("\t%8.2f MB/s", mbPerSec)
	}
	say(line)
	b.printLogs(plain)
}
