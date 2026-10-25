//go:build gofront

//gofront:target both

// Overlay on the emitter-backed sync package: single-threaded Map, Pool,
// and OnceFunc/OnceValue/OnceValues implementations.
package sync

// Pool is a set of temporary objects that may be individually saved and
// retrieved. In this single-threaded implementation, Get returns New()
// when the pool is empty (or nil if New is nil). Put ignores nil.
type Pool struct {
	New   func() any
	items []any
}

func (p *Pool) Put(x any) {
	if x == nil {
		return
	}
	p.items = append(p.items, x)
}

func (p *Pool) Get() any {
	if len(p.items) > 0 {
		x := p.items[0]
		p.items = p.items[1:]
		return x
	}
	if p.New != nil {
		return p.New()
	}
	return nil
}

// Map is like a Go map[any]any but safe for concurrent use (single-threaded
// in GoFront).
type Map struct {
	m map[any]any
}

func (m *Map) init() {
	if m.m == nil {
		m.m = make(map[any]any)
	}
}

func (m *Map) Load(key any) (any, bool) {
	if m.m == nil {
		return nil, false
	}
	v, ok := m.m[key]
	return v, ok
}

func (m *Map) Store(key, value any) {
	m.init()
	m.m[key] = value
}

func (m *Map) LoadOrStore(key, value any) (any, bool) {
	m.init()
	if v, ok := m.m[key]; ok {
		return v, true
	}
	m.m[key] = value
	return value, false
}

func (m *Map) LoadAndDelete(key any) (any, bool) {
	if m.m == nil {
		return nil, false
	}
	if v, ok := m.m[key]; ok {
		delete(m.m, key)
		return v, true
	}
	return nil, false
}

func (m *Map) Delete(key any) {
	if m.m == nil {
		return
	}
	delete(m.m, key)
}

func (m *Map) Swap(key, value any) (any, bool) {
	m.init()
	if v, ok := m.m[key]; ok {
		m.m[key] = value
		return v, true
	}
	m.m[key] = value
	return nil, false
}

func (m *Map) CompareAndSwap(key, old, newVal any) bool {
	m.init()
	if v, ok := m.m[key]; ok {
		if v == old {
			m.m[key] = newVal
			return true
		}
	}
	return false
}

func (m *Map) CompareAndDelete(key, old any) bool {
	if m.m == nil {
		return false
	}
	if v, ok := m.m[key]; ok {
		if v == old {
			delete(m.m, key)
			return true
		}
	}
	return false
}

func (m *Map) Range(f func(key, value any) bool) {
	if m.m == nil {
		return
	}
	for k, v := range m.m {
		if !f(k, v) {
			break
		}
	}
}

func (m *Map) Clear() {
	m.m = make(map[any]any)
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

type rlocker struct {
	rw *RWMutex
}

func (r *rlocker) Lock() {}

func (r *rlocker) Unlock() {}

func (rw *RWMutex) RLocker() Locker {
	return &rlocker{rw: rw}
}
