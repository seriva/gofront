// GoFront test suite — sync (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("sync (Go-source)");

test("Mutex and RWMutex lock states", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sync"
)

type Counter struct {
	sync.Mutex
	n int
}

func (c *Counter) Inc() {
	c.Lock()
	defer c.Unlock()
	c.n++
}

type Store struct {
	mu   sync.RWMutex
	data map[string]int
}

func (s *Store) Get(k string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data[k]
}

func main() {
	var mu sync.Mutex
	fmt.Println(mu.TryLock(), mu.TryLock())
	mu.Unlock()
	mu.Lock()
	mu.Unlock()

	c := &Counter{}
	for i := 0; i < 5; i++ {
		c.Inc()
	}
	fmt.Println(c.n, c.TryLock())

	s := &Store{data: map[string]int{"a": 1}}
	fmt.Println(s.Get("a"), s.Get("b"))

	var rw sync.RWMutex
	rw.RLock()
	rw.RLock()
	fmt.Println(rw.TryLock(), rw.TryRLock())
	rw.RUnlock()
	rw.RUnlock()
	rw.RUnlock()
	fmt.Println(rw.TryLock(), rw.TryRLock())
	rw.Unlock()

	var l sync.Locker = &mu
	l.Lock()
	fmt.Println(mu.TryLock())
	l.Unlock()
	rl := rw.RLocker()
	rl.Lock()
	fmt.Println(rw.TryLock())
	rl.Unlock()
	fmt.Println(rw.TryLock())
}
`,
		`true false
5 true
1 0
false true
true false
false
false
true
`,
	);
});

// Go reports the three unlock errors as fatal errors that cannot be
// recovered; GoFront panics with the same text so the program can still be
// tested.  The WaitGroup message is an ordinary panic in Go too.
test("unlocking an unlocked mutex panics with Go's message", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sync"
)

func try(name string, f func()) {
	defer func() { fmt.Println(name, recover()) }()
	f()
}

func main() {
	var mu sync.Mutex
	try("Unlock", func() { mu.Unlock() })
	var rw sync.RWMutex
	try("RUnlock", func() { rw.RUnlock() })
	try("Unlock rw", func() { rw.Unlock() })
	var wg sync.WaitGroup
	try("negative", func() { wg.Add(-1) })
	wg.Add(2)
	wg.Done()
	wg.Done()
	wg.Wait()
	try("negative done", func() { wg.Done() })
}
`,
		`Unlock sync: unlock of unlocked mutex
RUnlock sync: RUnlock of unlocked RWMutex
Unlock rw sync: Unlock of unlocked RWMutex
negative sync: negative WaitGroup counter
negative done sync: negative WaitGroup counter
`,
	);
});

test("Once runs once, even when f panics", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sync"
)

func main() {
	var once sync.Once
	n := 0
	for i := 0; i < 3; i++ {
		once.Do(func() { n++ })
	}
	fmt.Println(n)

	var bad sync.Once
	func() {
		defer func() { fmt.Println("recovered", recover()) }()
		bad.Do(func() { panic("first") })
	}()
	bad.Do(func() { fmt.Println("not called") })

	f := sync.OnceFunc(func() { fmt.Println("once func") })
	f()
	f()

	calls := 0
	v := sync.OnceValue(func() int { calls++; return 42 })
	fmt.Println(v(), v(), calls)

	vs := sync.OnceValues(func() (string, error) { calls++; return "x", nil })
	a, err := vs()
	b, _ := vs()
	fmt.Println(a, err, b, calls)

	pf := sync.OnceFunc(func() { panic("boom") })
	for i := 0; i < 2; i++ {
		func() {
			defer func() { fmt.Println("again", recover()) }()
			pf()
		}()
	}
}
`,
		`1
recovered first
once func
42 42 1
x <nil> x 2
again boom
again boom
`,
	);
});

test("a Mutex field copied by value is an independent copy", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sync"
)

type Guarded struct {
	mu sync.Mutex
	n  int
}

func main() {
	a := Guarded{}
	a.mu.Lock()
	b := a // copies the locked state, as in Go (go vet would flag it)
	fmt.Println(b.mu.TryLock())
	a.mu.Unlock()
	fmt.Println(a.mu.TryLock(), b.mu.TryLock())
	var wg sync.WaitGroup
	wg.Add(3)
	for i := 0; i < 3; i++ {
		func() { defer wg.Done() }()
	}
	wg.Wait()
	fmt.Println("done")
}
`,
		`false
true false
done
`,
	);
});

test("an embedded Mutex promotes Lock and satisfies Locker", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"sync"
)

type Cache struct {
	sync.RWMutex
	m map[string]int
}

func (c *Cache) Get(k string) int {
	c.RLock()
	defer c.RUnlock()
	return c.m[k]
}

func (c *Cache) Set(k string, v int) {
	c.Lock()
	defer c.Unlock()
	c.m[k] = v
}

type Pair struct {
	sync.Mutex
	n int
}

func main() {
	c := &Cache{m: map[string]int{}}
	c.Set("a", 1)
	fmt.Println(c.Get("a"), c.Get("b"))
	var l sync.Locker = c
	l.Lock()
	fmt.Println(c.TryLock(), c.TryRLock())
	l.Unlock()
	fmt.Println(c.TryLock())
	p := Pair{n: 3}
	p.Lock()
	fmt.Println(p.TryLock(), p.n)
}
`,
		`1 0
false false
true
false 3
`,
	);
});
