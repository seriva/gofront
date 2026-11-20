package main

func pair() (string, string) { return "a", "b" }

func main() {
	_ = len(pair()) // ERROR "too many arguments for len(pair()) (expected 1, found 2)"
}
