// test/unit/wasm/interfaces.test.js
// Tests for Phase H4 Task H4.1: Non-empty interfaces in WASM and JS-strict parity.

import {
	assertEqual,
	compileHybrid,
	runWasm,
	section,
	test,
} from "../helpers.js";

section("WASM Non-Empty Interfaces — Method Dispatch & Parity");

test("Interface method dispatch with value receiver and pointer receiver", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct {
	Name string
}

func (d Dog) Sound() string {
	return "woof:" + d.Name
}

type Cat struct {
	Name string
}

func (c *Cat) Sound() string {
	return "meow:" + c.Name
}

func Speak(a Animal) string {
	return a.Sound()
}

func Main() string {
	d := Dog{Name: "Rex"}
	c := &Cat{Name: "Whiskers"}
	dPtr := &Dog{Name: "Buddy"}
	return Speak(d) + " | " + Speak(c) + " | " + Speak(dPtr)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "woof:Rex | meow:Whiskers | woof:Buddy");
	assertEqual(wasmRes, jsRes);
});

test("Interface with multiple methods and arguments", () => {
	const src = `
package main

type Calculator interface {
	Add(a, b int64) int64
	Scale(val float32, factor float32) float32
}

type Engine struct {
	Offset int64
}

func (e *Engine) Add(a, b int64) int64 {
	return a + b + e.Offset
}

func (e *Engine) Scale(val float32, factor float32) float32 {
	return val * factor
}

func Compute(c Calculator) int64 {
	sum := c.Add(10, 20)
	scaled := c.Scale(5.0, 2.0)
	return sum + int64(scaled)
}

func Main() int64 {
	eng := &Engine{Offset: 5}
	return Compute(eng)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 45n);
	assertEqual(wasmRes, jsRes);
});

test("Interface method returning multiple values", () => {
	const src = `
package main

type Divider interface {
	DivMod(a, b int64) (int64, int64)
}

type IntMath struct{}

func (m *IntMath) DivMod(a, b int64) (int64, int64) {
	return a / b, a % b
}

func Main() int64 {
	var d Divider = &IntMath{}
	q, r := d.DivMod(27, 4)
	return q*100 + r
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 603n);
	assertEqual(wasmRes, jsRes);
});

test("Embedded struct promoted methods satisfy interface", () => {
	const src = `
package main

type Speaker interface {
	Speak() string
}

type BaseSpeaker struct {
	Prefix string
}

func (b *BaseSpeaker) Speak() string {
	return b.Prefix + " speaks"
}

type Robot struct {
	BaseSpeaker
	Model int64
}

func Announce(s Speaker) string {
	return s.Speak()
}

func Main() string {
	r := &Robot{
		BaseSpeaker: BaseSpeaker{Prefix: "Unit42"},
		Model:       9000,
	}
	return Announce(r)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Unit42 speaks");
	assertEqual(wasmRes, jsRes);
});

section("WASM Non-Empty Interfaces — Nil Semantics & Trapping");

test("Nil interface check == nil and != nil", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct{}

func (d *Dog) Sound() string {
	return "bark"
}

func Main() int64 {
	var a Animal
	var score int64
	if a == nil {
		score += 10
	}
	if a != nil {
		score += 100
	}

	a = &Dog{}
	if a != nil {
		score += 1000
	}
	if a == nil {
		score += 10000
	}
	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 1010n);
	assertEqual(wasmRes, jsRes);
});

test("Calling method on nil interface traps with runtime panic", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

func Main() string {
	var a Animal
	return a.Sound()
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(
			e.message.includes("nil pointer dereference") ||
				e.message.includes("invalid memory address"),
			true,
		);
	}
	assertEqual(caught, true);
});

section("WASM Non-Empty Interfaces — Type Assertions & Switches");

test("Concrete type assertion on non-empty interface (comma-ok and direct)", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct {
	Name string
}

func (d *Dog) Sound() string {
	return "bark"
}

type Cat struct {
	Name string
}

func (c *Cat) Sound() string {
	return "meow"
}

func Main() int64 {
	var a Animal = &Dog{Name: "Spike"}
	d := a.(*Dog)
	var score int64
	if d.Name == "Spike" {
		score += 10
	}

	d2, ok1 := a.(*Dog)
	if ok1 && d2.Name == "Spike" {
		score += 100
	}

	c, ok2 := a.(*Cat)
	if !ok2 && c == nil {
		score += 1000
	}

	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 1110n);
	assertEqual(wasmRes, jsRes);
});

test("Failed single-value concrete type assertion on interface traps with panic", () => {
	const src = `
package main

type Animal interface {
	Sound() string
}

type Dog struct{}
func (d *Dog) Sound() string { return "bark" }

type Cat struct{}
func (c *Cat) Sound() string { return "meow" }

func Main() string {
	var a Animal = &Dog{}
	c := a.(*Cat)
	return c.Sound()
}
`;
	const h = compileHybrid(src);
	let caught = false;
	try {
		const { exports } = runWasm(h.wasm, { stringTable: h.stringTable });
		exports.Main();
	} catch (e) {
		caught = true;
		assertEqual(e.message.includes("type assertion failed"), true);
	}
	assertEqual(caught, true);
});

test("Interface-to-interface type assertion (interface narrowing/conversion)", () => {
	const src = `
package main

type Reader interface {
	Read() string
}

type Closer interface {
	Close() int64
}

type ReadCloser interface {
	Read() string
	Close() int64
}

type MyFile struct {
	Content string
}

func (f *MyFile) Read() string {
	return f.Content
}

func (f *MyFile) Close() int64 {
	return 1
}

func Main() int64 {
	var rc ReadCloser = &MyFile{Content: "data"}
	r, ok1 := rc.(Reader)
	c, ok2 := rc.(Closer)

	var score int64
	if ok1 && r.Read() == "data" {
		score += 100
	}
	if ok2 && c.Close() == 1 {
		score += 20
	}
	return score
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 120n);
	assertEqual(wasmRes, jsRes);
});

test("Type switch on non-empty interface", () => {
	const src = `
package main

type Shape interface {
	Area() int64
}

type Square struct {
	Side int64
}

func (s *Square) Area() int64 {
	return s.Side * s.Side
}

type Circle struct {
	Radius int64
}

func (c *Circle) Area() int64 {
	return 3 * c.Radius * c.Radius
}

func Describe(s Shape) int64 {
	switch v := s.(type) {
	case *Square:
		return 1000 + v.Side
	case *Circle:
		return 2000 + v.Radius
	default:
		return 0
	}
}

func Main() int64 {
	s := &Square{Side: 5}
	c := &Circle{Radius: 10}
	return Describe(s) + Describe(c)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 3015n);
	assertEqual(wasmRes, jsRes);
});

section("WASM Non-Empty Interfaces — Aggregates: Struct Fields & Slices");

test("Interface stored in struct field (like physics.RaycastProvider)", () => {
	const src = `
package main

type RaycastProvider interface {
	Raycast(from, to float32) float32
}

type FlatFloor struct {
	FloorY float32
}

func (f *FlatFloor) Raycast(from, to float32) float32 {
	return f.FloorY
}

type DynamicBody struct {
	Raycast RaycastProvider
	Height  float32
}

func (b *DynamicBody) Step() float32 {
	if b.Raycast != nil {
		return b.Raycast.Raycast(10.0, 0.0) + b.Height
	}
	return 0.0
}

func Main() float32 {
	floor := &FlatFloor{FloorY: 1.5}
	body := &DynamicBody{
		Raycast: floor,
		Height:  2.0,
	}
	return body.Step()
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, 3.5);
	assertEqual(wasmRes, jsRes);
});

test("Slice of interfaces iterating and dispatching dynamically", () => {
	const src = `
package main

type Greeter interface {
	Greet() string
}

type Person struct {
	Name string
}

func (p *Person) Greet() string {
	return "Hi " + p.Name
}

type Alien struct {
	Planet string
}

func (a *Alien) Greet() string {
	return "Greetings from " + a.Planet
}

func Main() string {
	list := []Greeter{
		&Person{Name: "Alice"},
		&Alien{Planet: "Mars"},
		&Person{Name: "Bob"},
	}

	var res string
	for i := 0; i < len(list); i++ {
		if i > 0 {
			res = res + ", "
		}
		res = res + list[i].Greet()
	}
	return res
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, "Hi Alice, Greetings from Mars, Hi Bob");
	assertEqual(wasmRes, jsRes);
});
