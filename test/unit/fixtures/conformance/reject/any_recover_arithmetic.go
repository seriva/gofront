package main

func main() {
	defer func() {
		_ = recover() + 1 // ERROR "recover() + 1 (mismatched types"
	}()
}
