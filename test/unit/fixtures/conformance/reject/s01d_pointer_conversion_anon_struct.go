package main

type X = struct{ X int }

func main() {
	var p *struct{ Y string }
	q := (*X)(p) // ERROR "cannot convert"
	_ = q
}
