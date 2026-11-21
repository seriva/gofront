package main

type A struct{ X int }

func main() {
	a := A{42}
	u := struct{ X int }{42}
	m := map[struct{ X int }]int{a: 10} // ERROR "Cannot assign A to struct{X int} here"
	m[a] = 11                           // ERROR "Cannot assign A to struct{X int} here"
	_ = m[a]                            // ERROR "Cannot assign A to struct{X int} here"
	_, ok := m[a]                       // ERROR "Cannot assign A to struct{X int} here"
	delete(m, a)                        // ERROR "Cannot assign A to struct{X int} here"
	_ = ok
	n := map[A]int{u: 1} // ERROR "Cannot assign struct{X int} to A here"
	_ = n[u]             // ERROR "Cannot assign struct{X int} to A here"
	delete(n, u)         // ERROR "Cannot assign struct{X int} to A here"
}
