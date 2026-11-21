package main

type I interface{ M() }

func floats() (float64, float64) { return 1, 2 }
func mixed() (string, int)       { return "", 1 }
func anyInt() (any, int)         { return "oops", 2 }
func slices() ([]int, int)       { return nil, 1 }

func takeInts(a int, b float64) {}
func takeStr(a int, b int)      {}
func takeSlice(a []string, b int) {}
func takeIface(a I, b int)      {}
func takeInt(a int, b int)      {}

func main() {
	takeInts(floats()) // ERROR "cannot use floats() (value of type float64) as int value in argument to takeInts"
	takeStr(mixed())   // ERROR "cannot use mixed() (value of type string) as int value in argument to takeStr"
	takeSlice(slices()) // ERROR "(value of type []int) as []string value in argument to takeSlice"
	takeIface(mixed())  // ERROR "string does not implement I"
	takeInt(anyInt())   // ERROR "cannot use anyInt() (value of type any) as int value in argument to takeInt: need type assertion"
	takeIface(anyInt()) // ERROR "cannot use anyInt() (value of type any) as I value in argument to takeIface: need type assertion"
}
