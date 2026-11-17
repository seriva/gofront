package main

type MyByte uint8

func main() {
	copy(make([]MyByte, 2), "ab") // ERROR "invalid copy"
}
