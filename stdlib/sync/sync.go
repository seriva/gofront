//go:build gofront

//gofront:target both

// Package sync provides the basic synchronization primitives for a single
// thread of execution.
//
// GoFront has no goroutines, so nothing here ever blocks: a lock that would
// have to wait for another goroutine can never be released, and reports the
// deadlock Go's runtime would. Like Go, a Mutex, RWMutex, Once or WaitGroup
// must not be copied after first use; a copy is an independent value that
// starts in the state of the original (this is not diagnosed).
package sync

// deadlock is the message of Go's runtime when every goroutine is blocked.
const deadlock = "fatal error: all goroutines are asleep - deadlock!"

// A Locker represents an object that can be locked and unlocked.
type Locker interface {
	Lock()
	Unlock()
}

// A Mutex is a mutual exclusion lock. The zero value is an unlocked mutex.
type Mutex struct {
	locked bool
}

// Lock locks m. Locking a mutex that is already locked can never succeed
// without another goroutine, so it reports a deadlock.
func (m *Mutex) Lock() {
	if m.locked {
		panic(deadlock)
	}
	m.locked = true
}

// TryLock tries to lock m and reports whether it succeeded.
func (m *Mutex) TryLock() bool {
	if m.locked {
		return false
	}
	m.locked = true
	return true
}

// Unlock unlocks m. It is a run-time error if m is not locked on entry.
func (m *Mutex) Unlock() {
	if !m.locked {
		panic("sync: unlock of unlocked mutex")
	}
	m.locked = false
}

// A RWMutex is a reader/writer mutual exclusion lock. The zero value is an
// unlocked mutex.
type RWMutex struct {
	writer  bool
	readers int
}

// Lock locks rw for writing. It reports a deadlock when rw is already locked
// for reading or writing.
func (rw *RWMutex) Lock() {
	if rw.writer || rw.readers > 0 {
		panic(deadlock)
	}
	rw.writer = true
}

// TryLock tries to lock rw for writing and reports whether it succeeded.
func (rw *RWMutex) TryLock() bool {
	if rw.writer || rw.readers > 0 {
		return false
	}
	rw.writer = true
	return true
}

// Unlock unlocks rw for writing. It is a run-time error if rw is not locked
// for writing on entry.
func (rw *RWMutex) Unlock() {
	if !rw.writer {
		panic("sync: Unlock of unlocked RWMutex")
	}
	rw.writer = false
}

// RLock locks rw for reading. It reports a deadlock when rw is locked for
// writing.
func (rw *RWMutex) RLock() {
	if rw.writer {
		panic(deadlock)
	}
	rw.readers++
}

// TryRLock tries to lock rw for reading and reports whether it succeeded.
func (rw *RWMutex) TryRLock() bool {
	if rw.writer {
		return false
	}
	rw.readers++
	return true
}

// RUnlock undoes a single RLock call. It is a run-time error if rw is not
// locked for reading on entry.
func (rw *RWMutex) RUnlock() {
	if rw.readers <= 0 {
		panic("sync: RUnlock of unlocked RWMutex")
	}
	rw.readers--
}

type rlocker struct {
	rw *RWMutex
}

func (r *rlocker) Lock() { r.rw.RLock() }

func (r *rlocker) Unlock() { r.rw.RUnlock() }

// RLocker returns a Locker interface that implements the Lock and Unlock
// methods by calling rw.RLock and rw.RUnlock.
func (rw *RWMutex) RLocker() Locker {
	return &rlocker{rw: rw}
}

// Once is an object that will perform exactly one action.
type Once struct {
	done bool
	m    Mutex
}

// Do calls the function f if and only if Do is being called for the first
// time for this instance of Once. If f panics, Do considers it to have
// returned; future calls of Do return without calling f. Calling Do from
// within f reports a deadlock, as in Go.
func (o *Once) Do(f func()) {
	if !o.done {
		o.doSlow(f)
	}
}

func (o *Once) doSlow(f func()) {
	o.m.Lock()
	defer o.m.Unlock()
	if !o.done {
		defer func() { o.done = true }()
		f()
	}
}

// A WaitGroup waits for a collection of goroutines to finish. Without
// goroutines the counter only moves with Add and Done.
type WaitGroup struct {
	n int
}

// Add adds delta, which may be negative, to the WaitGroup counter.
// If the counter becomes negative, Add panics.
func (wg *WaitGroup) Add(delta int) {
	n := wg.n + delta
	if n < 0 {
		panic("sync: negative WaitGroup counter")
	}
	wg.n = n
}

// Done decrements the WaitGroup counter by one.
func (wg *WaitGroup) Done() {
	wg.Add(-1)
}

// Wait returns when the counter is zero. With a positive counter nothing
// could ever call Done, so it reports a deadlock.
func (wg *WaitGroup) Wait() {
	if wg.n > 0 {
		panic(deadlock)
	}
}

// OnceFunc returns a function that invokes f only once. The returned function
// may be called concurrently.
//
// If f panics, the returned function will panic with the same value on every call.
func OnceFunc(f func()) func() {
	var (
		once  Once
		valid bool
		p     any
	)
	return func() {
		once.Do(func() {
			defer func() {
				p = recover()
				if !valid {
					panic(p)
				}
			}()
			f()
			valid = true
		})
		if !valid {
			panic(p)
		}
	}
}

// OnceValue returns a function that invokes f only once and returns the value
// returned by f. The returned function may be called concurrently.
//
// If f panics, the returned function will panic with the same value on every call.
func OnceValue[T any](f func() T) func() T {
	var (
		once   Once
		valid  bool
		p      any
		result T
	)
	return func() T {
		once.Do(func() {
			defer func() {
				p = recover()
				if !valid {
					panic(p)
				}
			}()
			result = f()
			valid = true
		})
		if !valid {
			panic(p)
		}
		return result
	}
}

// OnceValues returns a function that invokes f only once and returns the values
// returned by f. The returned function may be called concurrently.
//
// If f panics, the returned function will panic with the same value on every call.
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2) {
	var (
		once  Once
		valid bool
		p     any
		r1    T1
		r2    T2
	)
	return func() (T1, T2) {
		once.Do(func() {
			defer func() {
				p = recover()
				if !valid {
					panic(p)
				}
			}()
			r1, r2 = f()
			valid = true
		})
		if !valid {
			panic(p)
		}
		return r1, r2
	}
}
