// pending: S8
package main

func half(x float64) float64 { return x / 2 }

func main() {
	n := 3
	_ = half(n) // ERROR "cannot use n (variable of type int) as float64 value in argument"
}
