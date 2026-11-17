// pending: S9
package main

func main() {
	defer func() {
		_ = recover() + 1 // ERROR "operator + not defined on"
	}()
}
