package main

import "js:dom_test.d.ts"

func main() {
	el := myDoc.getElementById("app")
	el.invalidProperty = 123
}
