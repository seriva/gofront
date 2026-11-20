package main

func main() {
	var f float64 = 1e400 // ERROR "cannot use 1e400 (untyped float constant 1e+400) as float64 value in variable declaration (overflows)"
	_ = f
	_ = +1e400 // ERROR "cannot use +1e400 (untyped float constant 1e+400) as float64 value in assignment to _ identifier (overflows)"
	switch 1e400 { // ERROR "cannot use 1e400 (untyped float constant 1e+400) as float64 value in switch expression (overflows)"
	}
}
