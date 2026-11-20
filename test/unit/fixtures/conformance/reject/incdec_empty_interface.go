// pending: type-text-elided
package main

func main() {
	var v interface{} = 2
	v++ // ERROR "non-numeric type interface{}"
}
