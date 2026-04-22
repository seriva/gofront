package main

import "js:type_alias.d.ts"

func main() {
	var n int = s // s is MyString = string, should be error
	console.log(n)
}
