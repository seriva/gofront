//go:build gofront

//gofront:target js

package testing

// Async tests and subtests, for js packages. The body of an `async func`
// test returns a promise that the call through testing_call keeps; the
// driver awaits it before it reports the test.

// call calls f(t) and returns what the function returned: a promise when f
// is async, nil otherwise.
//
//gofront:intrinsic testing_call
func call(f any, t any) any

func jsCall(f func(*T), t *T) any {
	return call(f, t)
}

// settle waits for the async subtests of t, in the order they started, and
// reports them.
async func (t *T) settle() {
	for len(t.pending) > 0 {
		p := t.pending[0]
		t.pending = t.pending[1:]
		await p.sub.wait(p.res)
		await p.sub.settle()
		p.sub.finish()
	}
}

// wait waits for the promise of a test body, recording a rejection as a
// failure of the test.
async func (t *T) wait(res any) {
	defer t.Guard()
	await res
}

// RunAsync is Run for a js package: the bodies of async tests are awaited,
// in order, and so are the async subtests they start. TestMain cannot use
// it.
async func (m *M) RunAsync() int {
	callHook = jsCall
	tests, benches := m.plan()
	for _, tt := range tests {
		t := &T{common: common{name: tt.Name}}
		t.begin()
		await t.wait(t.invoke(tt.F))
		await t.settle()
		t.finish()
		if t.failed {
			m.failures++
		}
	}
	callHook = nil
	for _, bb := range benches {
		m.runBenchmark(bb)
	}
	return m.conclude()
}
