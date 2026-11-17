package main

import "fmt"

type A struct{ X int }

type H struct{ U struct{ X int } }

type G struct{ P A }

func take(u struct{ X int }) int { return u.X }

func takeA(a A) int { return a.X }

func ret(a A) struct{ X int } { return a }

func retA(u struct{ X int }) A { return u }

func main() {
	a := A{1}
	u := struct{ X int }{2}

	var v1 struct{ X int } = a
	var v2 A = u

	var as1 struct{ X int }
	as1 = a
	var as2 A
	as2 = u

	h1 := H{U: a}
	h2 := H{a}
	g1 := G{P: u}
	g2 := G{u}
	h1.U = a
	g1.P = u

	s := []struct{ X int }{a, A{3}}
	arr := [2]A{u, {4}}
	m := map[string]struct{ X int }{"k": a}

	fmt.Println(v1.X, v2.X, as1.X, as2.X)
	fmt.Println(h1.U.X, h2.U.X, g1.P.X, g2.P.X)
	fmt.Println(s[0].X, s[1].X, arr[0].X, arr[1].X, m["k"].X)
	fmt.Println(take(a), takeA(u), ret(a).X, retA(u).X)
}

// Output:
// 1 2 1 2
// 1 1 2 2
// 1 3 2 4 1
// 1 2 1 2
