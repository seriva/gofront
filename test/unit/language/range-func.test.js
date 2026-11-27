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

test("stacked labels all name the range-over-func loop", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	for i := 1; i <= 3; i++ {
		if !yield(i) {
			return
		}
	}
}

func once(yield func(int) bool) { yield(1) }

func main() {
L0:
LA:
	for x := range once {
		_ = x
		if x == 2 {
			continue LA
		}
		continue L0
	}
	fmt.Println("done")
	n := 0
L1:
L2:
	for x := range seq {
		n += x
		if x == 2 {
			continue L2
		}
		continue L1
	}
	fmt.Println(n)
L3:
L4:
	for x := range seq {
		fmt.Println(x)
		if x == 2 {
			continue L4
		}
		break L3
	}
	fmt.Println("done")
L5:
L6:
	for x := range seq {
		for y := range seq {
			if y == 2 {
				continue L5
			}
			if y == 9 {
				break L6
			}
			fmt.Println(x, y)
		}
	}
	for x := range seq {
	L7:
	L8:
		for i := 0; i < 3; i++ {
			if i == 1 {
				continue L7
			}
			if i == 9 {
				continue L8
			}
			fmt.Println("in", x, i)
		}
		break
	}
}
`,
		"done\n6\n1\ndone\n1 1\n2 1\n3 1\nin 1 0\nin 1 2\n",
	);
});

section("Range-over-func: enclosing range indexes captured by the body");

const SEQ = `func seq(y func(int) bool) {
	for _, v := range []int{1, 2, 3} {
		if !y(v) {
			return
		}
	}
}
`;

test("continue to the label of an enclosing range n loop", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${SEQ}
func main() {
L5:
	for i := range 2 {
		for x := range seq {
			if x == 2 {
				continue L5
			}
			fmt.Println(i, x)
		}
	}
}
`,
		"0 1\n1 1\n",
	);
});

test("unlabeled break and break to the outer label with an enclosing range n", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${SEQ}
func main() {
	for i := range 2 {
		for x := range seq {
			if x == 2 {
				break
			}
			fmt.Println(i, x)
		}
	}
L5:
	for i := range 2 {
		for x := range seq {
			if x == 2 {
				break L5
			}
			fmt.Println(i, x)
		}
	}
}
`,
		"0 1\n1 1\n0 1\n",
	);
});

test("an enclosing range over a slice, and int32 and uint8 indexes", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

${SEQ}
func main() {
	for i := range []int{0, 1} {
		for x := range seq {
			if x == 2 {
				break
			}
			fmt.Println(i, x)
		}
	}
	for _, v := range []string{"a", "b"} {
		for x := range seq {
			fmt.Println(v, x)
			break
		}
	}
	for i := range int32(2) {
		for x := range seq {
			fmt.Println(i, x)
			break
		}
	}
	for i := range uint8(2) {
		for x := range seq {
			fmt.Println(i, x)
			break
		}
	}
}
`,
		"0 1\n1 1\na 1\nb 1\n0 1\n1 1\n0 1\n1 1\n",
	);
});

test("a closure in a range-over-func body returns from itself", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func nums(yield func(int) bool) {
	for i := 1; i <= 3; i++ {
		if !yield(i) {
			return
		}
	}
}

func main() {
	for v := range nums {
		g := func() int { return v * 10 }
		f := func() (s string) {
			defer func() { s += "!" }()
		L:
			for w := range nums {
				switch {
				case w == v:
					break L
				}
				s += fmt.Sprint(w)
			}
			switch v {
			case 3:
				return "three"
			}
			return
		}
		fmt.Println(g(), f())
		if v == 2 {
			func() {
				for range nums {
					return
				}
			}()
			continue
		}
	}
	fmt.Println("done")
}
`,
		"10 !\n20 1!\n30 three!\ndone\n",
	);
});

section("Range-over-func: yielded arrays are copies");

test("a yielded array is a copy", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	arr := [2]int{1, 2}
	seq := func(yield func([2]int) bool) { yield(arr) }
	for v := range seq {
		v[0] = 9
	}
	fmt.Println(arr)
}
`,
		"[1 2]\n",
	);
});

test("the assign form copies a yielded array", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	arr := [2]int{1, 2}
	seq := func(yield func([2]int) bool) { yield(arr) }
	var v [2]int
	for v = range seq {
		v[0] = 9
	}
	fmt.Println(arr, v)
}
`,
		"[1 2] [9 2]\n",
	);
});

test("a yielded nested array is a deep copy", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	arr := [2][2]int{{1, 2}, {3, 4}}
	seq := func(yield func([2][2]int) bool) { yield(arr) }
	for v := range seq {
		v[1][0] = 9
	}
	fmt.Println(arr)
}
`,
		"[[1 2] [3 4]]\n",
	);
});

section("Range-over-func: assignment targets");

const assignCase = (name, body, want) =>
	test(name, async () => {
		await assertAllTargetsOutput(
			`package main

import "fmt"

type S struct{ N int }

func main() {
${body}
}
`,
			want,
		);
	});

assignCase(
	"a range-over-func *p target stores into the pointee",
	`	s := S{1}
	p := &s
	seq := func(yield func(S) bool) { yield(S{5}) }
	for *p = range seq {
	}
	fmt.Println(s)`,
	"{5}\n",
);

assignCase(
	"a range-over-func target that is address-taken is updated in place",
	`	s := S{1}
	ps := &s
	seq := func(yield func(S) bool) { yield(S{2}) }
	for s = range seq {
	}
	fmt.Println(*ps, ps == &s)`,
	"{2} true\n",
);

assignCase(
	"a range-over-func array target keeps the slice view of the array",
	`	var arr [2]int
	sl := arr[:]
	seq := func(yield func([2]int) bool) { yield([2]int{7, 8}) }
	for arr = range seq {
	}
	fmt.Println(sl)`,
	"[7 8]\n",
);

assignCase(
	"a two-value range-over-func stores a *p value target",
	`	s := S{1}
	p := &s
	seq := func(yield func(int, S) bool) { yield(3, S{4}) }
	var k int
	for k, *p = range seq {
	}
	fmt.Println(k, s)`,
	"3 {4}\n",
);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
