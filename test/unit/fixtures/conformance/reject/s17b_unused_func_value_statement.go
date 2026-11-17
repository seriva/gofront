package main

func f() {}

func main() {
	f // ERROR "is not used"
}
