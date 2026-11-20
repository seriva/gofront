package main

import "encoding/binary"

func main() {
	_ = binary.ByteOrder // ERROR "binary.ByteOrder (type) is not an expression"
}
