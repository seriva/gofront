package main

import "js:dom_test.d.ts"

func main() {
	el := myDoc.getElementById("app")
	el.textContent = "Hello"
}
