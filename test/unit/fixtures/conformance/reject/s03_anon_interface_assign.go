// pending: S3
package main

func main() {
	var a interface{ Foo() int }
	var b interface{ Bar() string } = a // ERROR "does not implement"
	_ = b
}
