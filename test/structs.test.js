// GoFront test suite — structs, embedded structs, methods

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	summarize,
	test,
} from "./helpers.js";

section("Pointer receivers");

test("new(T) zero-initialises struct fields", () => {
	const { js } = compile(`package main
type Counter struct { n int }
func main() {
  c := new(Counter)
  console.log(c.value.n)
}`);
	assertEqual(runJs(js), "0");
});

test("pointer receiver mutates through new(T)", () => {
	const { js } = compile(`package main
type Counter struct { N int }
func (c *Counter) Inc() { c.N = c.N + 1 }
func (c *Counter) Get() int { return c.N }
func main() {
  c := new(Counter)
  c.Inc()
  c.Inc()
  c.Inc()
  console.log(c.Get())
}`);
	assertEqual(runJs(js), "3");
});

// ═════════════════════════════════════════════════════════════
// Store functions (example app logic)
// ═════════════════════════════════════════════════════════════

section("Store functions (moveTodo / removeTodo / filters)");

test("moveTodo reorders the list", () => {
	const { js, errors } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func moveTodo(fromId int, toId int) {
  if fromId == toId { return }
  var item Todo
  var rest []Todo
  for _, t := range todos {
    if t.id == fromId { item = t } else { rest = append(rest, t) }
  }
  var result []Todo
  inserted := false
  for _, t := range rest {
    if t.id == toId { result = append(result, item); inserted = true }
    result = append(result, t)
  }
  if !inserted { result = append(result, item) }
  todos = result
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  moveTodo(0, 2)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "b\na\nc");
});

test("moveTodo to end when target not found", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func moveTodo(fromId int, toId int) {
  if fromId == toId { return }
  var item Todo
  var rest []Todo
  for _, t := range todos {
    if t.id == fromId { item = t } else { rest = append(rest, t) }
  }
  var result []Todo
  inserted := false
  for _, t := range rest {
    if t.id == toId { result = append(result, item); inserted = true }
    result = append(result, t)
  }
  if !inserted { result = append(result, item) }
  todos = result
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  moveTodo(0, 99)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "b\nc\na");
});

test("removeTodo removes by id", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func removeTodo(id int) {
  var next []Todo
  for _, t := range todos {
    if t.id != id { next = append(next, t) }
  }
  todos = next
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  removeTodo(1)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "a\nc");
});

test("clearCompleted removes only done todos", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func clearCompleted() {
  var next []Todo
  for _, t := range todos {
    if !t.done { next = append(next, t) }
  }
  todos = next
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  todos[1].done = true
  clearCompleted()
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "a\nc");
});

test("visibleTodos FilterActive returns only incomplete", () => {
	const { js } = compile(`package main
const (
  FilterAll = iota
  FilterActive
  FilterCompleted
)
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
var currentFilter int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func visibleTodos() []Todo {
  switch currentFilter {
  case FilterActive:
    var out []Todo
    for _, t := range todos { if !t.done { out = append(out, t) } }
    return out
  case FilterCompleted:
    var out []Todo
    for _, t := range todos { if t.done { out = append(out, t) } }
    return out
  default:
    return todos
  }
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  todos[0].done = true
  currentFilter = FilterActive
  for _, t := range visibleTodos() { console.log(t.text) }
}`);
	assertEqual(runJs(js), "b\nc");
});

// ═════════════════════════════════════════════════════════════
// CLI flags
// ═════════════════════════════════════════════════════════════

section("Embedded structs");

test("embedded struct fields accessible on outer struct", () => {
	const { js, errors } = compile(`package main
type Animal struct {
  Name string
}
type Dog struct {
  Animal
  Breed string
}
func main() {
  d := Dog{Breed: "Lab"}
  d.Name = "Rex"
  console.log(d.Name)
  console.log(d.Breed)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Rex\nLab");
});

test("embedded struct initialised via type key in composite literal", () => {
	const { js, errors } = compile(`package main
type Animal struct {
  Name string
}
type Dog struct {
  Animal
  Breed string
}
func main() {
  d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Lab"}
  console.log(d.Name)
  console.log(d.Breed)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Rex\nLab");
});

test("embedded struct methods promoted to outer struct", () => {
	const { js, errors } = compile(`package main
type Greeter struct {
  prefix string
}
func (g Greeter) Greet(name string) string {
  return g.prefix + name
}
type Bot struct {
  Greeter
}
func main() {
  b := Bot{Greeter: Greeter{prefix: "Hello, "}}
  console.log(b.Greet("world"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hello, world");
});

test("unknown field on embedded struct errors", () => {
	const { errors } = compile(`package main
type Animal struct { Name string }
type Dog struct { Animal }
func main() {
  _ := Dog{BadField: "x"}
}`);
	assertErrorContains(errors, "BadField");
});

test("outer method overrides promoted embedded method", () => {
	const { js, errors } = compile(`package main
type Base struct {}
func (b Base) Speak() string { return "base" }
type Child struct {
  Base
}
func (c Child) Speak() string { return "child" }
func main() {
  c := Child{}
  console.log(c.Speak())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "child");
});

test("embedded struct zero-value initialisation", () => {
	const { js, errors } = compile(`package main
type Animal struct {
  Name string
  Age  int
}
type Dog struct {
  Animal
  Breed string
}
func main() {
  d := Dog{}
  console.log(d.Name)
  console.log(d.Age)
  console.log(d.Breed)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "\n0\n");
});

test("multiple embedded structs in one type", () => {
	const { js, errors } = compile(`package main
type Walker struct { Speed int }
type Talker struct { Volume int }
type Person struct {
  Walker
  Talker
  Name string
}
func main() {
  p := Person{Walker: Walker{Speed: 5}, Talker: Talker{Volume: 8}, Name: "Bob"}
  console.log(p.Speed)
  console.log(p.Volume)
  console.log(p.Name)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5\n8\nBob");
});

// ═════════════════════════════════════════════════════════════
// String formatting (fmt package)
// ═════════════════════════════════════════════════════════════

section("Struct tags");

test("struct tag is parsed and ignored", () => {
	const js = compile(`package main
type User struct {
	Name string \`json:"name"\`
	Age  int    \`json:"age"\`
}
func main() {
	u := User{Name: "Alice", Age: 30}
	console.log(u.Name)
	console.log(u.Age)
}`).js;
	assertEqual(runJs(js), "Alice\n30");
});

test("struct with mixed tagged and untagged fields", () => {
	const js = compile(`package main
type Point struct {
	X int \`json:"x"\`
	Y int
}
func main() {
	p := Point{X: 3, Y: 4}
	console.log(p.X + p.Y)
}`).js;
	assertEqual(runJs(js), "7");
});

// ── Bitwise compound assignments ──────────────────────────────

section("Struct tags — edge cases");

test("struct tag on embedded struct field", () => {
	const js = compile(`package main
type Base struct {
	ID int \`json:"id"\`
}
type User struct {
	Base
	Name string \`json:"name"\`
}
func main() {
	u := User{Base: Base{ID: 1}, Name: "Alice"}
	console.log(u.ID)
	console.log(u.Name)
}`).js;
	assertEqual(runJs(js), "1\nAlice");
});

test("multiple fields sharing a line with tag", () => {
	const js = compile(`package main
type T struct {
	X int \`json:"x"\`
	Y int \`json:"y"\`
	Z int \`json:"z"\`
}
func main() {
	t := T{X: 1, Y: 2, Z: 3}
	console.log(t.X + t.Y + t.Z)
}`).js;
	assertEqual(runJs(js), "6");
});

// ── recover() — additional scenarios ─────────────────────────

section("new() for struct types");

test("new(T) pointer — field access via .value", () => {
	// Pointer to struct is modelled as { value: T }; access fields via ptr.value.Field
	const js = compile(`package main
type Box struct { N int }
func main() {
	p := new(Box)
	p.value.N = 42
	console.log(p.value.N)
}`).js;
	assertEqual(runJs(js), "42");
});

test("new(T) pointer — multiple fields", () => {
	const js = compile(`package main
type Vec struct { X int; Y int }
func main() {
	p := new(Vec)
	p.value.X = 3
	p.value.Y = 4
	console.log(p.value.X + p.value.Y)
}`).js;
	assertEqual(runJs(js), "7");
});

// ── Local type declarations ───────────────────────────────────

section("Address-of & and dereference *");

test("& (address-of) is transparent — wraps as {value: T}", () => {
	// In GoFront, & on a variable is syntactically accepted; field access through
	// the pointer variable compiles and runs correctly.
	const { js, errors } = compile(`package main
type Box struct { N int }
func main() {
	b := Box{N: 42}
	p := &b
	console.log(p.N)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("* (dereference) in expression is transparent", () => {
	// Pointer receiver methods already test this path; verify no crash
	const { errors } = compile(`package main
type Node struct { Val int }
func (n *Node) Get() int { return n.Val }
func main() {
	n := Node{Val: 7}
	console.log(n.Get())
}`);
	assertEqual(errors.length, 0);
});

// ── Positional (unkeyed) struct literals ─────────────────────

section("Positional (unkeyed) struct literals");

test("Point{1, 2} generates correct struct fields", () => {
	const { js, errors } = compile(`package main
type Point struct {
  X int
  Y int
}
func main() {
  p := Point{1, 2}
  println(p.X, p.Y)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2");
});

test("positional struct literal in slice []Point{{1,2},{3,4}}", () => {
	const { js, errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
  pts := []Point{{1, 2}, {3, 4}}
  for _, p := range pts {
    println(p.X, p.Y)
  }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2\n3 4");
});

test("three-field struct positional literal", () => {
	const { js, errors } = compile(`package main
type RGB struct { R int; G int; B int }
func main() {
  c := RGB{255, 128, 0}
  println(c.R, c.G, c.B)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "255 128 0");
});

test("positional struct literal rejects wrong count", () => {
	const { errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
  _ = Point{1, 2, 3}
}`);
	assertErrorContains(errors, "too many values");
});

// ── Method values (.bind) ─────────────────────────────────────

section("Method values (.bind)");

test("bound method value retains receiver", () => {
	const { js, errors } = compile(`package main
type Counter struct { N int }
func (c Counter) Value() int { return c.N }
func main() {
  c := Counter{N: 42}
  f := c.Value
  println(f())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("bound method passed to higher-order function", () => {
	const { js, errors } = compile(`package main
type Greeter struct { Name string }
func (g Greeter) Greet() string { return "Hello " + g.Name }
func call(f func() string) string { return f() }
func main() {
  g := Greeter{Name: "World"}
  println(call(g.Greet))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hello World");
});

// ── Struct and array equality ─────────────────────────────────

section("Struct and array equality");

test("two structs with same fields are equal", () => {
	const { js, errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
  a := Point{X: 1, Y: 2}
  b := Point{X: 1, Y: 2}
  println(a == b)
  println(a != b)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("two structs with different fields are not equal", () => {
	const { js, errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
  a := Point{X: 1, Y: 2}
  b := Point{X: 1, Y: 3}
  println(a == b)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "false");
});

test("slice == nil is still valid (not struct equality)", () => {
	const { js, errors } = compile(`package main
func main() {
  var s []int
  println(s == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("comparing two non-nil slices is a type error", () => {
	const { errors } = compile(`package main
func main() {
  a := []int{1, 2}
  b := []int{1, 2}
  println(a == b)
}`);
	assertErrorContains(errors, "not defined on");
});

// ── Method expressions (T.Method) ────────────────────────────

section("Method expressions (T.Method)");

test("T.Method produces a function taking a receiver", () => {
	const { js, errors } = compile(`package main
type Point struct { X int; Y int }
func (p Point) Sum() int { return p.X + p.Y }
func main() {
  f := Point.Sum
  p := Point{X: 3, Y: 4}
  println(f(p))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7");
});

test("method expression passed to higher-order function", () => {
	const { js, errors } = compile(`package main
type Counter struct { N int }
func (c Counter) Value() int { return c.N }
func apply(f func(Counter) int, c Counter) int { return f(c) }
func main() {
  c := Counter{N: 10}
  println(apply(Counter.Value, c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

// ═════════════════════════════════════════════════════════════
// switch with init statement
// ═════════════════════════════════════════════════════════════

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
