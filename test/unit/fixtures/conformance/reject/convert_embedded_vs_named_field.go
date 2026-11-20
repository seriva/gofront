package main

type E struct{ V int }

func main() {
	var a struct{ E }
	b := struct{ E E }(a) // ERROR "cannot convert a"
	_ = b
}
