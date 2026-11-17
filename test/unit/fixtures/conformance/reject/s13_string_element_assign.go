// pending: S13
package main

func main() {
	s := "abc"
	s[0] = 'x' // ERROR "cannot assign to s[0] (neither addressable nor a map index expression)"
	_ = s
}
