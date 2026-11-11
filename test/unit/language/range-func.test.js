// GoFront test suite — labeled break/continue on range-over-func loops

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertProgramOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Range-over-func: labeled break and continue");

test("break to the label of the range-over-func loop", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func main() {
outer:
	for x := range seq {
		fmt.Println(x)
		break outer
	}
	fmt.Println("done")
}
`,
		"0\ndone\n",
	);
});

test("continue to the label of the range-over-func loop", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func main() {
outer:
	for x := range seq {
		fmt.Println(x)
		continue outer
	}
	fmt.Println("done")
}
`,
		"0\n1\ndone\n",
	);
});

test("continue to the range-over-func label from a nested for", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func main() {
outer:
	for x := range seq {
		for y := 0; y < 2; y++ {
			fmt.Println(x, y)
			continue outer
		}
	}
	fmt.Println("done")
}
`,
		"0 0\n1 0\ndone\n",
	);
});

section("Range-over-func: labels of enclosing loops");

test("continue to an enclosing range-over-func label from a nested one", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	for i := 0; i < 2; i++ {
		if !yield(i) {
			return
		}
	}
}

func main() {
outer:
	for x := range seq {
		for y := range seq {
			fmt.Println(x, y)
			continue outer
		}
	}
	fmt.Println("done")
}
`,
		"0 0\n1 0\ndone\n",
	);
});

test("break to an enclosing range-over-func label from a nested one", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	for i := 0; i < 2; i++ {
		if !yield(i) {
			return
		}
	}
}

func main() {
outer:
	for x := range seq {
		for y := range seq {
			fmt.Println(x, y)
			break outer
		}
	}
	fmt.Println("done")
}
`,
		"0 0\ndone\n",
	);
});

test("labels across three nested loops and plain loops in callbacks", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	for i := 0; i < 2; i++ {
		if !yield(i) {
			return
		}
	}
}

func main() {
outer:
	for x := range seq {
		for y := range seq {
			for z := range seq {
				fmt.Println(x, y, z)
				continue outer
			}
		}
	}
	fmt.Println("a")
	for x := range seq {
	mid:
		for k := 0; k < 2; k++ {
			for y := range seq {
				fmt.Println(x, k, y)
				continue mid
			}
		}
	}
	fmt.Println("b")
	for x := range seq {
	mid2:
		for k := 0; k < 2; k++ {
			for y := range seq {
				for z := range seq {
					fmt.Println(x, k, y, z)
					break mid2
				}
			}
		}
	}
	fmt.Println("done")
}
`,
		"0 0 0\n1 0 0\na\n0 0 0\n0 1 0\n1 0 0\n1 1 0\nb\n0 0 0 0\n1 0 0 0\ndone\n",
	);
});

test("range-over-func in a closure inside a labeled loop", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	for i := 0; i < 2; i++ {
		if !yield(i) {
			return
		}
	}
}

func main() {
outer:
	for i := 0; i < 1; i++ {
		f := func() {
			for x := range seq {
				fmt.Println(x)
			}
		}
		f()
		switch i {
		case 0:
			break outer
		}
	}
	fmt.Println("done")
}
`,
		"0\n1\ndone\n",
	);
});

test("break to a labeled switch from a range-over-func loop", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	for i := 0; i < 3; i++ {
		if !yield(i) {
			return
		}
	}
}

func main() {
L:
	switch {
	default:
		for x := range seq {
			if x == 1 {
				break L
			}
			fmt.Println(x)
		}
		fmt.Println("not reached")
	}
	fmt.Println("done")
}
`,
		"0\ndone\n",
	);
});

section("Range-over-func: forwarded multi-value returns");

test("return f() inside a range-over-func body boxes a forwarded struct into any", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ A int }

func makePair() (T, int) { return T{1}, 1 }

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func get() (any, int) {
	for range seq {
		return makePair()
	}
	return nil, 0
}

func main() {
	v, n := get()
	_, ok := v.(T)
	fmt.Println(v, n, ok)
}
`,
		"{1} 1 true\n",
	);
});

test("a defer sees the named result forwarded from inside a range-over-func body", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ A int }

func makePair() (T, int) { return T{1}, 1 }

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func get() (v any, n int) {
	defer func() {
		_, ok := v.(T)
		fmt.Println("defer", v, n, ok)
	}()
	for range seq {
		return makePair()
	}
	return nil, 0
}

func main() {
	v, n := get()
	_, ok := v.(T)
	fmt.Println(v, n, ok)
}
`,
		"defer {1} 1 true\n{1} 1 true\n",
	);
});

test("a defer sees named results returned from inside a range-over-func body", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type T struct{ A int }

func makePair() (T, int) { return T{1}, 1 }

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func get() (v T, n int) {
	defer func() { fmt.Println("defer", v, n) }()
	for range seq {
		return makePair()
	}
	return T{}, 0
}

func one() (s string) {
	defer func() { fmt.Println("defer", s) }()
	for range seq {
		return "x"
	}
	return ""
}

func main() {
	v, n := get()
	fmt.Println(v, n)
	fmt.Println(one())
}
`,
		"defer {1} 1\n{1} 1\ndefer x\nx\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
