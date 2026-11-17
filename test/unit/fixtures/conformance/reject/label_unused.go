package main

func main() {
L: // ERROR "label L defined and not used"
	for i := 0; i < 1; i++ {
	}
}
