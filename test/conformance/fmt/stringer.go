//conformance:js-only
package main

import (
	"errors"
	"fmt"
)

type Celsius float64

func (c Celsius) String() string { return fmt.Sprintf("%.1fC", float64(c)) }

type Color int

const (
	Red Color = iota
	Green
)

func (c Color) String() string {
	if c == Red {
		return "red"
	}
	return "green"
}

type Point struct{ X, Y int }

func (p Point) String() string { return fmt.Sprintf("(%d,%d)", p.X, p.Y) }

type Counter struct{ N int }

func (c *Counter) String() string { return fmt.Sprintf("counter=%d", c.N) }

type MyErr struct{ Code int }

func (e *MyErr) Error() string { return fmt.Sprintf("myerr %d", e.Code) }

type ValErr struct{ Msg string }

func (e ValErr) Error() string { return "valerr " + e.Msg }

type Holder struct {
	P    Point
	C    Color
	Name string
}

type Level string

func (l Level) String() string { return "L:" + string(l) }

type Pair struct {
	A Color
	b Color
	P Point
	q Point
}

type Both struct{ N int }

func (b Both) Error() string  { return "both-error" }
func (b Both) String() string { return "both-string" }

type PtrHolder struct{ C *Counter }

type PS struct{ N int }

func (p *PS) String() string { return "ps" }

type PW struct{ V PS }

type EW struct {
	error
	Code int
}

func main() {
	fmt.Println(Celsius(36.6), Red, Green)
	fmt.Printf("%v|%s|%d\n", Green, Green, Green)
	fmt.Println(Point{1, 2})
	p := Point{3, 4}
	fmt.Println(&p)
	fmt.Printf("%v|%s|%+v\n", p, p, p)

	c := Counter{5}
	fmt.Println(&c)
	fmt.Printf("%v|%s\n", &c, &c)
	fmt.Println(c)

	var err error = &MyErr{7}
	fmt.Println(err)
	fmt.Printf("%v|%s\n", err, err)
	fmt.Println(ValErr{"x"}, &ValErr{"y"})
	wrapped := fmt.Errorf("wrap: %w", err)
	fmt.Println(wrapped, errors.Unwrap(wrapped))

	fmt.Println([]Color{Red, Green})
	fmt.Println([]Point{{1, 2}, {3, 4}})
	fmt.Println(map[string]Color{"a": Green, "b": Red})
	fmt.Println(map[Color]int{Green: 1, Red: 2})
	fmt.Println(Holder{Point{5, 6}, Green, "h"})
	fmt.Printf("%+v\n", Holder{Point{5, 6}, Red, "h"})
	fmt.Println([]error{err, ValErr{"z"}})
	fmt.Println(fmt.Sprint(Red, Green), fmt.Sprintln(Point{0, 0}))
	var a any = Point{9, 9}
	fmt.Println(a)
	var nilErr error
	fmt.Println(nilErr)

	fmt.Printf("[%6v][%-6s][%6s]\n", Green, Red, Point{1, 2})
	fmt.Println([]Level{"a", "b"}, [2]Color{Red, Green}, [][]Color{{Red}, {Green, Red}})
	fmt.Println(Pair{Red, Green, Point{1, 2}, Point{3, 4}})
	fmt.Printf("%+v\n", Pair{Green, Red, Point{1, 2}, Point{3, 4}})
	fmt.Println(Both{1}, []Both{{2}})
	fmt.Println([]Counter{{1}, {2}})
	fmt.Println(PtrHolder{&Counter{8}})
	fmt.Println(map[string][]Color{"x": {Green}})
	var s fmt.Stringer = &c
	fmt.Println(s)
	s = Red
	fmt.Println(s, s.String())

	fmt.Printf("%#v|%v\n", Green, Green)

	ps := []PS{{1}, {2}}
	fmt.Println(&ps[0])
	fmt.Println(ps)
	w := PW{PS{4}}
	pv := &w.V
	fmt.Println(pv)
	fmt.Println(w, &w)
	ws := []PW{{PS{5}}}
	fmt.Println(&ws[0].V, ws)

	fmt.Println(EW{errors.New("x"), 1}, &EW{errors.New("y"), 2})
	fmt.Println([]EW{{errors.New("z"), 3}})
	fmt.Printf("%v|%s\n", EW{errors.New("v"), 4}, EW{errors.New("s"), 5})
}
