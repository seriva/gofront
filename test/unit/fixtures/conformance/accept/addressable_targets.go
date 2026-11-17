package main

import "fmt"

type P struct{ X int }
type C struct{ n int }

func (c *C) Inc() { c.n++ }
func (c C) Get() int { return c.n }

type Wrap struct{ *C }
type Holder struct{ c C }

func mkp() *C { return &C{} }

func main() {
	m := map[string]P{"a": {1}}
	m["a"] = P{2}
	mp := map[string]*P{"a": {1}}
	mp["a"].X = 5
	mp["a"].X++
	counts := map[string]int{}
	counts["k"]++
	counts["k"] += 2
	arr := map[string][2]int{}
	arr["k"] = [2]int{1, 2}
	nested := map[string]map[string]int{"a": {}}
	nested["a"]["b"] = 4
	nested["a"]["b"]++
	p := &P{1}
	p.X = 3
	xs := []P{{1}}
	xs[0].X = 9
	bs := []byte("abc")
	bs[0] = 'x'
	var c C
	c.Inc()
	mkp().Inc()
	pc := &c
	pc.Inc()
	(&c).Inc()
	w := Wrap{&C{}}
	w.Inc()
	var h Holder
	h.c.Inc()
	hs := []Holder{{}}
	hs[0].c.Inc()
	hp := &Holder{}
	hp.c.Inc()
	fmt.Println(m["a"].X, mp["a"].X, counts["k"], arr["k"], p.X, xs[0].X, string(bs), nested["a"]["b"], c.Get(), w.Get(), h.c.n, hs[0].c.n, hp.c.n)
	fmt.Println(C{n: 4}.Get(), mkp().Get())
}

// Output:
// 2 6 3 [1 2] 3 9 xbc 5 3 1 1 1 1
// 4 0
