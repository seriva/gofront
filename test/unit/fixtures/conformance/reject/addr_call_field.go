package main

type P struct{ X int }

func mk() P { return P{} }

func main() {
	_ = &mk().X // ERROR "cannot take address of mk().X"
}
