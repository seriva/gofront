package main

func main() {
	var dst []struct{ X int }
	var src []struct{ Y string }
	copy(dst, src) // ERROR "invalid copy: arguments dst (variable of type []struct{"
}
