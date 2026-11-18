package main

type I interface{ M() }

func floats() (float64, float64) { return 1, 2 }
func mixed() (string, int)       { return "", 1 }
func slices() ([]int, int)       { return nil, 1 }

func takeInts(a int, b float64) {}
func takeStr(a int, b int)      {}
func takeSlice(a []string, b int) {}
func takeIface(a I, b int)      {}

func main() {
	takeInts(floats()) // ERROR "cannot use floats() (value of type float64) as int value in argument to takeInts"
	takeStr(mixed())   // ERROR "Cannot assign string to int"
	takeSlice(slices()) // ERROR "Cannot assign []int to []string"
	takeIface(mixed())  // ERROR "string does not implement I"
}
