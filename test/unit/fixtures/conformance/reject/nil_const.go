package main

const g = nil // ERROR "nil is not constant"

func main() {
	const c = nil // ERROR "nil is not constant"
}
