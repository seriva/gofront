// pending: S16
package main

func main() {
	for {
		break missing // ERROR "break label not defined: missing"
	}
}
