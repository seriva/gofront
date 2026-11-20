package main

type I interface{ M() }
type F func()
type Ptr *int

func g[T ~int]() {
	_ = T{} // ERROR "invalid composite literal type T"
}

func main() {
	_ = error{} // ERROR "invalid composite literal type error"
	_ = I{}     // ERROR "invalid composite literal type I"
	_ = F{}     // ERROR "invalid composite literal type F"
	_ = Ptr{}   // ERROR "invalid composite literal type Ptr"
	g[int]()
}
