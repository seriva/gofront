package main

type P struct{ X int }

func main() {
	var pv P
	_ = pv.X{} // ERROR "pv.X is not a type"
}
