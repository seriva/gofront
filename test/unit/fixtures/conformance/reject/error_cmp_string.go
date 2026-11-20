package main

func main() {
	var e error
	_ = e == "x" // ERROR "cannot convert \"x\" (untyped string constant) to type interface{Error() string}"
}
