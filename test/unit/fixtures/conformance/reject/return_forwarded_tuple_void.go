package main

func pair() (int, string) { return 1, "a" }

func none() {
	return pair() // ERROR "too many return values (have (int, string), want ())"
}

func one() int {
	return pair() // ERROR "too many return values (have (int, string), want (int))"
}

func three() (int, string, bool) {
	return pair() // ERROR "not enough return values (have (int, string), want (int, string, bool))"
}

func main() {
	none()
	_ = one()
	_, _, _ = three()
}
