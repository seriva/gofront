// targets: js, both
package main

import "fmt"

// A type parameter's map key type still decides how `delete` boxes the key
// (map[any] is not yet supported on wasm).
func DeleteAny[M ~map[any]int](m M) { delete(m, 1) }

func main() {
	m := map[any]int{1: 10, "1": 20}
	DeleteAny(m)
	fmt.Println(len(m), m["1"])
}

// Output:
// 1 20
