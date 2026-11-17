// pending: S9
package main

func get() any { return 2 }

func main() {
	_ = get() * 2 // ERROR "operator * not defined on"
}
