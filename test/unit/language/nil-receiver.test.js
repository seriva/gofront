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

test("a method that only calls another nil-safe method runs on nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ n int }

func (s *S) B() int { return 2 }

func (s *S) A() int { return s.B() + 1 }

func main() {
	var s *S
	fmt.Println(s.A())
}
`,
		"3\n",
	);
});

section("Nil receivers: method expressions");

test("(*MyInt).Ping on a nil pointer runs", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type MyInt int

func (m *MyInt) Ping() int { return 1 }

func main() {
	g := (*MyInt).Ping
	var p *MyInt
	fmt.Println(g(p))
}
`,
		"1\n",
	);
});

test("(*S).M on a nil pointer sees a nil receiver", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ n int }

func (s *S) M() string {
	if s == nil {
		return "nil"
	}
	return "set"
}

func main() {
	f := (*S).M
	var p *S
	fmt.Println(f(p))
	fmt.Println(f(&S{}))
}
`,
		"nil\nset\n",
	);
});

section("Nil receivers: promoted through embedded pointers");

test("a promoted pointer method runs through a nil embedded pointer", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Base struct{ n int }

func (b *Base) Ptr() int { return 1 }

type P struct{ *Base }

func main() {
	fmt.Println(P{}.Ptr())
}
`,
		"1\n",
	);
});

test("a promoted pointer method runs through two embedding levels", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Base struct{ n int }

func (b *Base) Ptr() int { return 1 }

type Mid struct{ *Base }

type Top struct{ Mid }

func main() {
	var t Top
	fmt.Println(t.Ptr())
	p := &t
	fmt.Println(p.Ptr())
}
`,
		"1\n1\n",
	);
});

section("Nil receivers: which methods take a nil receiver");

test("a method that shadows its receiver name runs on a nil receiver", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Other struct{ val int }

type S struct{ x int }

func (s *S) M() int {
	if true {
		s := &Other{val: 5}
		return s.val
	}
	return 0
}

func main() {
	var s *S
	fmt.Println(s.M())
}
`,
		"5\n",
	);
});

test("a method that reads its receiver only under a condition runs on nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ x int }

func (s *S) M(cond bool) int {
	if cond {
		return s.x
	}
	return 0
}

func main() {
	var s *S
	fmt.Println(s.M(false))
}
`,
		"0\n",
	);
});

test("a method that reads its receiver first panics on nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type S struct{ x int }

func (s *S) M() int {
	return s.x
}

func main() {
	defer func() { fmt.Println(recover()) }()
	fmt.Println((&S{x: 3}).M())
	var s *S
	fmt.Println(s.M())
}
`,
		"3\nruntime error: invalid memory address or nil pointer dereference\n",
	);
});

test("a method of a generic struct can test its receiver for nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Gen[T any] struct{ val T }

func (g *Gen[T]) Ping() string {
	if g == nil {
		return "nil"
	}
	return "ok"
}

func main() {
	var g *Gen[int]
	fmt.Println(g.Ping())
	fmt.Println((&Gen[int]{}).Ping())
	var h *Gen[string]
	fmt.Println(h.Ping())
}
`,
		"nil\nok\nnil\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
