package main

import (
	"errors"
	"fmt"
)

type I interface{ M() string }
type J interface{ N() string }

type S struct{}

func (S) M() string { return "S.M" }

type P struct{}

func (*P) M() string { return "P.M" }

type Base struct{}

func (Base) M() string { return "Base.M" }

type Wrap struct{ Base }

type MyErr struct{}

func (MyErr) Error() string { return "my error" }

type Box[T any] struct{ v T }

func (b Box[T]) M() string { return fmt.Sprint(b.v) }

func describe(i I) string {
	switch v := i.(type) {
	case S:
		return "S " + v.M()
	case *P:
		return "*P " + v.M()
	case Wrap:
		return "Wrap " + v.M()
	case Box[int]:
		return "Box " + v.M()
	case J:
		return "J"
	case nil:
		return "nil"
	}
	return "other"
}

func main() {
	var i I = S{}
	_ = i.(S)
	_, ok := i.(Wrap)
	var j I = &P{}
	_, ok2 := j.(*P)
	_, ok3 := i.(J)
	var a any = 1
	_, ok4 := a.(S)
	var e error = MyErr{}
	_, ok5 := e.(MyErr)
	var emp interface{} = S{}
	_, ok6 := emp.(*P)
	fmt.Println(ok, ok2, ok3, ok4, ok5, ok6)
	fmt.Println(describe(S{}), describe(&P{}), describe(Wrap{}), describe(Box[int]{v: 1}))
	fmt.Println(errors.Is(e, e))
}

// Output:
// false true false false true false
// S S.M *P P.M Wrap Base.M Box 1
// true
