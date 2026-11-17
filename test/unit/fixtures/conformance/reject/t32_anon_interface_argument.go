// pending: S3
package main

func use(b interface{ Bar() string }) {}

func main() {
	var a interface{ Foo() int }
	use(a) // ERROR "does not implement"
}
