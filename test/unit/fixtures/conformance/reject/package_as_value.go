package main

import "strings"

func main() {
	_ = strings // ERROR "use of package strings not in selector"
	_ = strings.ToUpper("a")
}
