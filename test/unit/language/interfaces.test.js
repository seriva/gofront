// GoFront test suite — interface assertions and nil checks

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Empty-interface nil assertions (J5.1)");

test("concrete and generic any / interface{} assertions reject nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type E interface{}
type A = any
type EAlias = interface{}

func assertOk[T any](v any) (T, bool) {
	x, ok := v.(T)
	return x, ok
}

func assertPanic[T any](v any) (panicked bool) {
	defer func() {
		if recover() != nil {
			panicked = true
		}
	}()
	_ = v.(T)
	return false
}

func checkConcretePanic(v any) (panicked bool) {
	defer func() {
		if recover() != nil {
			panicked = true
		}
	}()
	_ = v.(any)
	return false
}

func switchAny(v any) string {
	switch v.(type) {
	case any:
		return "any"
	default:
		return "nil"
	}
}

func main() {
	var n any
	var m any = 3

	v1, ok1 := n.(any)
	v2, ok2 := assertOk[interface{}](n)
	v3, ok3 := assertOk[any](n)
	fmt.Println(v1, ok1)
	fmt.Println(v2, ok2)
	fmt.Println(v3, ok3)

	fmt.Println(checkConcretePanic(n))
	fmt.Println(assertPanic[interface{}](n))
	fmt.Println(assertPanic[any](n))

	// Controls
	v4, ok4 := m.(any)
	v5, ok5 := n.(interface{})
	v6, ok6 := n.(E)
	v7, ok7 := assertOk[any](m)
	v8, ok8 := assertOk[interface{}](m)
	v9, ok9 := n.(A)
	v10, ok10 := n.(EAlias)
	fmt.Println(v4, ok4)
	fmt.Println(v5, ok5)
	fmt.Println(v6, ok6)
	fmt.Println(v7, ok7)
	fmt.Println(v8, ok8)
	fmt.Println(v9, ok9)
	fmt.Println(v10, ok10)
	fmt.Println(switchAny(n), switchAny(m))
}
`,
		"<nil> false\n<nil> false\n<nil> false\ntrue\ntrue\ntrue\n3 true\n<nil> false\n<nil> false\n3 true\n3 true\n<nil> false\n<nil> false\nnil any\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
