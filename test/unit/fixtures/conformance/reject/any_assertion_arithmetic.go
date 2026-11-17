package main

func main() {
	var v any = 2
	_ = v.(any) + 1 // ERROR "operator + not defined on"
}
