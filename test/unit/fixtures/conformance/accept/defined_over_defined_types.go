package main

import "fmt"

type Celsius float64
type Temp Celsius

func (t Temp) Double() Temp { return t * 2 }

type Name string
type Label Name

type Base struct{ X int }

func (b Base) Get() int { return b.X }

type D1 Base
type D2 D1

type Fn func(int) int
type Fn2 Fn

func (f Fn2) Call(x int) int { return f(x) }

type Arr [2]int
type Arr2 Arr
type Arr3 Arr2

type M1 map[string]int
type M2 M1

type I interface{ M() }

type S struct{}

func (S) M() {}

type A I

func main() {
	var t Temp = 1.5
	var l Label = "ab"
	d := D2{X: 4}
	var f Fn2 = func(x int) int { return x + 1 }
	a := Arr3{1, 2}
	b := a
	b[0] = 9
	m := M2{"k": 5}
	var i A = S{}
	_, ok := i.(S)
	fmt.Println(t.Double(), float64(t), l+"c", len(l), string(l))
	fmt.Println(d.X, Base(d).Get(), D1(d).X, f.Call(1), a[0], b[0], len(a))
	fmt.Println(m["k"], len(m), ok)
	fmt.Printf("%v %T\n", t, t)
}

// Output:
// 3 1.5 abc 2 ab
// 4 4 4 2 1 9 2
// 5 1 true
// 1.5 main.Temp
