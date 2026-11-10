// GoFront test suite — pointer-receiver methods called through nil pointers

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Nil receivers: calls through *T");

test("a method call through a nil *T runs", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ n int }

func (s *S) Ping() {}

func main() {
	var s *S
	s.Ping()
	fmt.Println("ok")
}
`,
		"ok\n",
	);
});

test("a method can test its receiver for nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ n int }

func (s *S) Name() string {
	if s == nil {
		return "nil"
	}
	return "set"
}

func main() {
	var s *S
	fmt.Println(s.Name())
	s = &S{}
	fmt.Println(s.Name())
}
`,
		"nil\nset\n",
	);
});

test("the receiver expression is evaluated once", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ n int }

func (t *T) M() int { return 7 }

func newT(calls *int) *T {
	*calls++
	return &T{}
}

func main() {
	calls := 0
	fmt.Println(newT(&calls).M())
	fmt.Println(calls)
}
`,
		"7\n1\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
