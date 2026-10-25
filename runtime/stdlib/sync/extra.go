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

// OnceFunc returns a function that invokes f only once.
func OnceFunc(f func()) func() {
	var once Once
	return func() {
		once.Do(func() {
			f()
		})
	}
}

// OnceValue returns a function that invokes f only once and returns the value
// returned by f.
func OnceValue[T any](f func() T) func() T {
	var once Once
	var val T
	return func() T {
		once.Do(func() {
			val = f()
		})
		return val
	}
}

// OnceValues returns a function that invokes f only once and returns the values
// returned by f.
func OnceValues[T1, T2 any](f func() (T1, T2)) func() (T1, T2) {
	var once Once
	var v1 T1
	var v2 T2
	return func() (T1, T2) {
		once.Do(func() {
			v1, v2 = f()
		})
		return v1, v2
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
