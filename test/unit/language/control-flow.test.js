// GoFront test suite — control flow, defer, async, scoping

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

section("defer and error");

test("defer runs after function body", () => {
	const { js } = compile(`package main
func main() {
  console.log("start")
  defer console.log("deferred")
  console.log("end")
}`);
	assertEqual(runJs(js), "start\nend\ndeferred");
});

test("defer runs in LIFO order", () => {
	const { js } = compile(`package main
func main() {
  defer console.log("first")
  defer console.log("second")
  defer console.log("third")
  console.log("body")
}`);
	assertEqual(runJs(js), "body\nthird\nsecond\nfirst");
});

test("defer inside called function", () => {
	const { js } = compile(`package main
func greet() {
  defer console.log("bye")
  console.log("hello")
}
func main() {
  greet()
  console.log("after")
}`);
	assertEqual(runJs(js), "hello\nbye\nafter");
});

test("defer inside if inside switch case", () => {
	const { js } = compile(`package main
func run() string {
  x := 1
  switch x {
  case 1:
    if true {
      defer console.log("deferred-in-if-in-switch")
    }
    console.log("case-body")
  }
  return "done"
}
func main() {
  result := run()
  console.log(result)
}`);
	assertEqual(runJs(js), "case-body\ndeferred-in-if-in-switch\ndone");
});

test("defer inside for inside switch case", () => {
	const { js } = compile(`package main
func run() {
  x := 1
  switch x {
  case 1:
    for i := 0; i < 1; i++ {
      defer console.log("deferred-in-for-in-switch")
    }
    console.log("after-for")
  }
}
func main() {
  run()
}`);
	assertEqual(runJs(js), "after-for\ndeferred-in-for-in-switch");
});

test("defer inside nested block inside switch case", () => {
	const { js } = compile(`package main
func run() {
  x := 1
  switch x {
  case 1:
    {
      defer console.log("deferred-in-block-in-switch")
    }
    console.log("case-end")
  }
}
func main() {
  run()
}`);
	assertEqual(runJs(js), "case-end\ndeferred-in-block-in-switch");
});

test("defer in closure does not add try/finally to parent", () => {
	// The _hasDefer flag must be scoped to each function body.
	// A defer inside a closure should NOT cause the outer function to emit try/finally.
	const { js } = compile(`package main
func main() {
  fn := func() {
    defer console.log("inner defer")
    console.log("inner body")
  }
  fn()
  console.log("outer done")
}`);
	assertEqual(runJs(js), "inner body\ninner defer\nouter done");
	// Outer function (main) should NOT have __defers — only the closure should
	const mainBody = js.split("function main()")[1];
	const closureStart = mainBody.indexOf("function()");
	const beforeClosure = mainBody.slice(0, closureStart);
	assert(
		!beforeClosure.includes("__defers"),
		"outer function should not have __defers",
	);
});

test("function without defer produces no try/finally wrapper", () => {
	const { js } = compile(`package main
func add(a int, b int) int {
  return a + b
}
func main() {
  console.log(add(1, 2))
}`);
	assertEqual(runJs(js), "3");
	assert(!js.includes("__defers"), "output should not contain __defers");
	assert(!js.includes("try {"), "output should not contain try/finally");
});

test("error() creates an error value", () => {
	const { js } = compile(`package main
func divide(a int, b int) (int, error) {
  if b == 0 {
    return 0, error("division by zero")
  }
  return a / b, nil
}
func main() {
  result, err := divide(10, 2)
  if err == nil {
    console.log(result)
  }
  _, err2 := divide(5, 0)
  if err2 != nil {
    console.log(err2.Error())
  }
}`);
	assertEqual(runJs(js), "5\ndivision by zero");
});

test("error as return type (nil success)", () => {
	const { js } = compile(`package main
func validate(x int) error {
  if x < 0 {
    return error("negative")
  }
  return nil
}
func main() {
  err := validate(5)
  if err == nil {
    console.log("ok")
  }
  err2 := validate(-1)
  if err2 != nil {
    console.log("invalid")
  }
}`);
	assertEqual(runJs(js), "ok\ninvalid");
});

// ═════════════════════════════════════════════════════════════

section("async/await");

test("async function compiles and resolves", () => {
	const { errors } = compile(`package main
async func fetchData() string {
  return "hello"
}
async func main() {
  result := await fetchData()
  console.log(result)
}`);
	assertEqual(errors.length, 0);
});

test("async function literal", () => {
	const { errors } = compile(`package main
func main() {
  fn := async func() string {
    return "world"
  }
  console.log(fn)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// Type error negative tests
// ═════════════════════════════════════════════════════════════

section("Edge cases");

test("empty struct compiles and is usable", () => {
	const { js } = compile(`package main
type Empty struct {}
func main() {
  e := Empty{}
  console.log(e)
}`);
	assertEqual(runJs(js), "[object Object]");
});

test("nil slice has zero length", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  console.log(len(xs))
}`);
	assertEqual(runJs(js), "0");
});

test("append to nil slice", () => {
	const { js } = compile(`package main
func main() {
  var xs []int
  xs = append(xs, 1)
  xs = append(xs, 2)
  console.log(len(xs))
  console.log(xs[0])
  console.log(xs[1])
}`);
	assertEqual(runJs(js), "2\n1\n2");
});

test("zero value int is 0", () => {
	const { js } = compile(`package main
func main() {
  var n int
  console.log(n)
}`);
	assertEqual(runJs(js), "0");
});

test("zero value string is empty", () => {
	const { js } = compile(`package main
func main() {
  var s string
  console.log(s == "")
}`);
	assertEqual(runJs(js), "true");
});

test("zero value bool is false", () => {
	const { js } = compile(`package main
func main() {
  var b bool
  console.log(b)
}`);
	assertEqual(runJs(js), "false");
});

test("struct zero value fields", () => {
	const { js } = compile(`package main
type Point struct { X int; Y int }
func main() {
  var p Point
  console.log(p.X)
  console.log(p.Y)
}`);
	assertEqual(runJs(js), "0\n0");
});

test("defer runs even when function returns early", () => {
	const { js } = compile(`package main
func check(x int) {
  defer console.log("cleanup")
  if x < 0 {
    console.log("negative")
    return
  }
  console.log("positive")
}
func main() {
  check(-1)
  check(1)
}`);
	assertEqual(runJs(js), "negative\ncleanup\npositive\ncleanup");
});

test("multiple defers in LIFO order with early return", () => {
	const { js } = compile(`package main
func run() {
  defer console.log("a")
  defer console.log("b")
  return
  defer console.log("never")
}
func main() {
  run()
}`);
	assertEqual(runJs(js), "b\na");
});

test("nil error comparison", () => {
	const { js } = compile(`package main
func ok() error { return nil }
func bad() error { return error("boom") }
func main() {
  e1 := ok()
  e2 := bad()
  console.log(e1 == nil)
  console.log(e2 == nil)
  console.log(e2.Error())
}`);
	assertEqual(runJs(js), "true\nfalse\nboom");
});

test("empty switch falls through to default", () => {
	const { js } = compile(`package main
func label(n int) string {
  switch n {
  case 1:
    return "one"
  case 2:
    return "two"
  default:
    return "other"
  }
}
func main() {
  console.log(label(1))
  console.log(label(2))
  console.log(label(99))
}`);
	assertEqual(runJs(js), "one\ntwo\nother");
});

test("map with missing key returns zero value", () => {
	const { js } = compile(`package main
func main() {
  m := map[string]int{"a": 1}
  console.log(m["a"])
  console.log(m["missing"])
}`);
	assertEqual(runJs(js), "1\n0");
});

test("iota in const block", () => {
	const { js } = compile(`package main
const (
  A = iota
  B
  C
)
func main() {
  console.log(A)
  console.log(B)
  console.log(C)
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("variadic function receives all args", () => {
	const { js } = compile(`package main
func sum(nums ...int) int {
  total := 0
  for _, n := range nums {
    total += n
  }
  return total
}
func main() {
  console.log(sum(1, 2, 3, 4))
}`);
	assertEqual(runJs(js), "10");
});

// ═════════════════════════════════════════════════════════════
// Example app compilation tests
// ═════════════════════════════════════════════════════════════

section("Scoping and closures");

test("inner scope variable shadows outer", () => {
	const { js } = compile(`package main
func main() {
  x := "outer"
  {
    x := "inner"
    console.log(x)
  }
  console.log(x)
}`);
	assertEqual(runJs(js), "inner\nouter");
});

test("if-init variable scoped to if block", () => {
	const { js } = compile(`package main
func div(a int, b int) (int, bool) {
  if b == 0 { return 0, false }
  return a / b, true
}
func main() {
  if result, ok := div(10, 2); ok {
    console.log(result)
  }
  if result, ok := div(10, 0); !ok {
    console.log("zero division")
    console.log(result)
  }
}`);
	assertEqual(runJs(js), "5\nzero division\n0");
});

test("closure over loop variable via capture", () => {
	const { js } = compile(`package main
func main() {
  fns := []any{}
  for i := 0; i < 3; i++ {
    captured := i
    fns = append(fns, func() int { return captured })
  }
  for _, f := range fns {
    console.log(f())
  }
}`);
	assertEqual(runJs(js), "0\n1\n2");
});

test("nested closures share captured variable", () => {
	const { js } = compile(`package main
func counter() (func(), func() int) {
  n := 0
  inc := func() { n++ }
  get := func() int { return n }
  return inc, get
}
func main() {
  inc, get := counter()
  inc()
  inc()
  inc()
  console.log(get())
}`);
	assertEqual(runJs(js), "3");
});

// ═════════════════════════════════════════════════════════════
// Named returns
// ═════════════════════════════════════════════════════════════

section("Named returns");

test("named return modified before bare return", () => {
	const { js } = compile(`package main
func clamp(n int, lo int, hi int) (result int) {
  result = n
  if result < lo { result = lo }
  if result > hi { result = hi }
  return
}
func main() {
  console.log(clamp(5, 0, 10))
  console.log(clamp(-3, 0, 10))
  console.log(clamp(15, 0, 10))
}`);
	assertEqual(runJs(js), "5\n0\n10");
});

test("named returns in loop accumulation", () => {
	const { js } = compile(`package main
func sum(xs []int) (total int) {
  for _, x := range xs {
    total += x
  }
  return
}
func main() {
  console.log(sum([]int{1, 2, 3, 4, 5}))
}`);
	assertEqual(runJs(js), "15");
});

// ═════════════════════════════════════════════════════════════
// Pointer receivers
// ═════════════════════════════════════════════════════════════

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
