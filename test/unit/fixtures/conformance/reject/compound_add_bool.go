package main

func main() {
	b := true
	b += true // ERROR "operator + not defined on b (variable of type bool)"
}
