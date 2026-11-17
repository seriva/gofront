package main

type Celsius float64
type Fahrenheit float64

func main() {
	var c Celsius = 1
	var f Fahrenheit = 1
	_ = c == f // ERROR "mismatched types Celsius and Fahrenheit"
}
