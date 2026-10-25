package main

import (
	"fmt"
	"slices"
	"sync"
)

func main() {
	// ── sync.Pool ──
	p := sync.Pool{
		New: func() any {
			return "new-item"
		},
	}
	fmt.Println(p.Get())
	p.Put("first")
	p.Put("second")
	fmt.Println(p.Get())
	fmt.Println(p.Get())
	fmt.Println(p.Get())

	pNil := sync.Pool{}
	fmt.Println(pNil.Get())
	pNil.Put("val")
	fmt.Println(pNil.Get())
	pNil.Put(nil)
	fmt.Println(pNil.Get())

	// ── sync.Map ──
	var m sync.Map
	v, ok := m.Load("k1")
	fmt.Println(v, ok)

	m.Store("k1", "v1")
	m.Store("k2", "v2")
	v, ok = m.Load("k1")
	fmt.Println(v, ok)
	v, ok = m.Load("k2")
	fmt.Println(v, ok)

	act, loaded := m.LoadOrStore("k1", "new_v1")
	fmt.Println(act, loaded)
	act, loaded = m.LoadOrStore("k3", "v3")
	fmt.Println(act, loaded)

	v, loaded = m.LoadAndDelete("k2")
	fmt.Println(v, loaded)
	v, loaded = m.LoadAndDelete("k2")
	fmt.Println(v, loaded)

	prev, loaded := m.Swap("k1", "v1_swapped")
	fmt.Println(prev, loaded)
	prev, loaded = m.Swap("k4", "v4")
	fmt.Println(prev, loaded)

	cas := m.CompareAndSwap("k1", "wrong", "v1_new")
	fmt.Println(cas)
	cas = m.CompareAndSwap("k1", "v1_swapped", "v1_new")
	fmt.Println(cas)

	cad := m.CompareAndDelete("k1", "wrong")
	fmt.Println(cad)
	cad = m.CompareAndDelete("k1", "v1_new")
	fmt.Println(cad)

	m.Delete("k4")
	v, ok = m.Load("k4")
	fmt.Println(v, ok)

	// Range deterministic check on a clean map
	var m2 sync.Map
	m2.Store("10", 10)
	m2.Store("20", 20)
	m2.Store("30", 30)

	var keys []string
	var sum int
	m2.Range(func(k, v any) bool {
		keys = append(keys, k.(string))
		sum += v.(int)
		return true
	})
	slices.Sort(keys)
	fmt.Println(keys, sum)

	// Range early stop check
	earlyCount := 0
	m2.Range(func(k, v any) bool {
		earlyCount++
		return false
	})
	fmt.Println(earlyCount)

	// Clear check
	m2.Clear()
	clearCount := 0
	m2.Range(func(k, v any) bool {
		clearCount++
		return true
	})
	fmt.Println(clearCount)

	// ── OnceFunc ──
	cnt1 := 0
	f1 := sync.OnceFunc(func() {
		cnt1++
	})
	f1()
	f1()
	f1()
	fmt.Println(cnt1)

	// ── OnceValue ──
	cnt2 := 0
	f2 := sync.OnceValue(func() int {
		cnt2++
		return 42
	})
	res1 := f2()
	res2 := f2()
	fmt.Println(res1, res2, cnt2)

	// ── OnceValues ──
	cnt3 := 0
	f3 := sync.OnceValues(func() (string, int) {
		cnt3++
		return "result", 99
	})
	s1, n1 := f3()
	s2, n2 := f3()
	fmt.Println(s1, n1, s2, n2, cnt3)
}
