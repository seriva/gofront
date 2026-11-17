// pending: S9
package main

func main() {
	_ = any(2) + 1 // ERROR "operator + not defined on"
}
