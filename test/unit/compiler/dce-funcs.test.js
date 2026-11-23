// GoFront test suite — unused functions, types, constants and variables are
// left out of the JS bundle

import { resolve } from "node:path";
import { compileDir } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	compile,
	runJs,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("JS output — unused declarations are pruned");

function jsOf(source) {
	const { js, errors } = compile(source);
	assert(js !== null, `compile failed: ${errors?.map((e) => e.message)}`);
	return js;
}

// The JS of the project `files` (compiled as a directory) and what it prints.
function project(files, options = {}) {
	return withTempDir(files, (dir) => {
		const res = compileDir(resolve(dir), options);
		return { js: res.js, css: res.css, out: runJs(res.js) };
	});
}

test("an unused function and an unused type are omitted", () => {
	const js = jsOf(`package main
type Box struct{ N int }
func (b *Box) Used() int { return b.N }
func (b *Box) UnusedMethod() int { return b.N }
type UnusedType struct{ N int }
func (u *UnusedType) M() int { return u.N }
func UnusedUserFunction() int { return 1 }
func main() { b := &Box{N: 2}; println(b.Used()) }
`);
	assert(js.includes("class Box"), "Box is kept");
	assert(!js.includes("UnusedUserFunction"), "the function is omitted");
	assert(!js.includes("UnusedType"), "the type is omitted");
	assertEqual(runJs(js), "2");
});

test("an unused constant and variable are omitted, a used one is kept", () => {
	const js = jsOf(`package main
const usedC = 3
const unusedC = 4
var usedV = usedC + 1
var unusedV = 7
func main() { println(usedV) }
`);
	assert(js.includes("usedV"), "the used variable is kept");
	assert(!js.includes("unusedV"), "the unused variable is omitted");
	assert(!js.includes("unusedC"), "the unused constant is omitted");
	assertEqual(runJs(js), "4");
});

test("a function reached only through a dead function is omitted", () => {
	const js = jsOf(`package main
func deep() int { return 1 }
func dead() int { return deep() }
func main() { println(2) }
`);
	assert(!js.includes("deep"), "deep is omitted");
	assert(!js.includes("dead"), "dead is omitted");
});

test("a multi-package build keeps what main uses and omits the rest", () => {
	const { js, out } = project({
		"main.go": `package main
import "./util"
func main() { println(util.Used()) }
`,
		"util/u.go": `package util
func helper() int { return 2 }
func Used() int { return helper() }
func Unused() int { return 3 }
`,
	});
	assert(js.includes("function Used"), "Used is kept");
	assert(js.includes("function helper"), "its helper is kept");
	assert(!js.includes("function Unused"), "Unused is omitted");
	assertEqual(out, "2");
});

test("dot-imported symbols that main uses are kept", () => {
	const { js, out } = project({
		"main.go": `package main
import . "./util"
func main() { println(Used(), Limit) }
`,
		"util/u.go": `package util
const Limit = 5
const Spare = 6
func Used() int { return 1 }
func Unused() int { return 2 }
`,
	});
	assert(js.includes("function Used"));
	assert(!js.includes("function Unused"));
	assert(!js.includes("Spare"), "an unused dot-imported constant is omitted");
	assertEqual(out, "1 5");
});

test("a qualified type and its methods in another package are kept when used", () => {
	const { js, out } = project({
		"main.go": `package main
import "./util"
func main() {
	b := util.Box{V: 4}
	println(b.Get())
}
`,
		"util/u.go": `package util
type Box struct{ V int }
func (b Box) Get() int { return b.V }
type Spare struct{ V int }
`,
	});
	assert(js.includes("class Box"));
	assert(!js.includes("class Spare"));
	assertEqual(out, "4");
});

test("a function called only from a templ body is kept", () => {
	const { js } = project({
		"main.go": `package main
func fromTempl() string { return "hi" }
func dead() string { return "no" }
func main() { _ = Page() }
`,
		"v.templ": `package main

templ Page() {
	<p>{ fromTempl() }</p>
}

templ DeadPage() {
	<p>{ dead() }</p>
}
`,
	});
	assert(js.includes("function fromTempl"), "fromTempl is kept");
	assert(!js.includes("function dead"), "dead is omitted");
	assert(!js.includes("function DeadPage"), "DeadPage is omitted");
});

test("a pruned css declaration emits no CSS", () => {
	const { js, css } = project({
		"main.go": `package main
func main() { _ = Page() }
`,
		"v.templ": `package main

css used() {
	color: red;
}

css unused() {
	color: blue;
}

templ Page() {
	<p class={ used() }>x</p>
}
`,
	});
	assert(css.includes("red"), "the used css is emitted");
	assert(!css.includes("blue"), "the unused css is not");
	assert(!js.includes("blue"));
});

test("an iota block keeps its values when one name is used", () => {
	const js = jsOf(`package main
const (
	A = iota
	B
	C
)
func main() { println(C, B) }
`);
	assertEqual(runJs(js), "2 1");
});

test("a package-level variable that calls runs in the entry and imported packages", () => {
	const { out } = project({
		"main.go": `package main
import "./util"
var _ = say("main var")
func say(s string) int { println(s); return 1 }
func main() { println("main", util.Used()) }
`,
		"util/u.go": `package util
func say(s string) int { println(s); return 1 }
var unused = say("util var")
func init() { println("util init") }
func Used() int { return 1 }
`,
	});
	assertEqual(out, "util var\nutil init\nmain var\nmain 1");
});

test("a blank-imported package still runs its side effects", () => {
	const { out } = project({
		"main.go": `package main
import _ "./side"
func main() { println("main") }
`,
		"side/s.go": `package side
func init() { println("side init") }
`,
	});
	assertEqual(out, "side init\nmain");
});

test("a package without main keeps its exported declarations", () => {
	const { js } = project({
		"lib.go": `package lib
type Shape struct{ W int }
func Area(s Shape) int { return s.W * 2 }
func internalHelper() int { return 1 }
func Uses() int { return viaExport() }
func viaExport() int { return 2 }
`,
	});
	assert(js.includes("function Area"));
	assert(js.includes("class Shape"));
	assert(js.includes("function viaExport"));
	assert(!js.includes("internalHelper"));
});

test("json.Marshal of an any value still encodes a type of another package", () => {
	const { out } = project({
		"main.go": `package main
import (
	"encoding/json"
	"./util"
)
func main() {
	var v any = util.Pt{X: 3}
	b, _ := json.Marshal(v)
	println(string(b))
	println(util.Show(util.Pt{X: 4}))
}
`,
		"util/u.go": `package util
import "encoding/json"
type Pt struct{ X int }
func Show(p Pt) string { b, _ := json.Marshal(p); return string(b) }
`,
	});
	assertEqual(out, '{"X":3}\n{"X":4}');
});

test("fmt function values and Stringers still print", () => {
	const js = jsOf(`package main
import "fmt"
type T struct{ N int }
func (t T) String() string { return fmt.Sprint("T", t.N) }
func dead() { fmt.Println("dead-println") }
func main() {
	f := fmt.Sprintf
	var v any = T{2}
	fmt.Println(f("%v|%d", v, 5))
}
`);
	assertEqual(runJs(js), "T2|5");
	assert(!js.includes("dead-println"));
});

test("a dead function does not keep unused stdlib code alive", () => {
	const live = jsOf(`package main
import "strings"
func main() { println(strings.ToUpper("a")) }
`);
	const dead = jsOf(`package main
import "strings"
func dead() string { return strings.ToUpper("a") }
func main() { println(1) }
`);
	assert(live.includes("ToUpper"));
	assert(!dead.includes("ToUpper"), "dead code reaches no stdlib");
});
