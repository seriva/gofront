// GoFront test suite — the reachability closure over user and stdlib packages

import { resolve } from "node:path";
import { compileDir, compilePackageTests } from "../../../src/compiler.js";
import { reachOfBuild } from "../../../src/link/stdlib.js";
import { assert, assertEqual, section, test, withTempDir } from "../helpers.js";

section("reachability.js — closure over user and stdlib packages");

// Compiles `dir` (its tests when `tests`, with `driver` as the generated
// driver source) and returns the closure the root compile computes, plus a
// lookup of the reached names of each package directory below `dir`.
function reachOf(dir, { tests = false, driver } = {}) {
	const root = resolve(dir);
	const options = {
		isTest: tests,
		userUnits: [],
		stdlibCache: new Map(),
		packageCache: null,
		rootKey: root,
		...(driver && { testDriver: () => driver }),
	};
	if (tests) compilePackageTests(root, options);
	else compileDir(root, options);
	const std = [...options.stdlibCache.values()]
		.filter((p) => p && !(p instanceof Error))
		.flatMap((p) => p.unit.programs);
	const reach = reachOfBuild(options, std, { prune: true });
	const names = (sub = "") => reach.namesOf(resolve(root, sub));
	const stdNames = () =>
		new Set(
			[...reach.reached].map((d) => d.name).filter((n) => n?.includes("$$")),
		);
	return { reach, names, stdNames, units: options.userUnits };
}

function reached(files, options) {
	return withTempDir(files, (dir) => reachOf(dir, options).names());
}

test("main reaches what it calls and nothing else", () => {
	const names = reached({
		"main.go": `package main
type Used struct{ N int }
type Unused struct{ N int }
func (u *Used) Get() int { return u.N }
func (u *Unused) Get() int { return u.N }
func usedFn() *Used { return &Used{} }
func UnusedFn() int { return 1 }
var usedVar = 1
var unusedVar = 2
const usedConst = 3
const unusedConst = 4
func main() { println(usedFn().Get(), usedVar, usedConst) }
`,
	});
	assertEqual(names.join(), "Used,Used.Get,main,usedConst,usedFn,usedVar");
});

test("an iota block is reached whole", () => {
	const names = reached({
		"main.go": `package main
const (
	A = iota
	B
	C
)
func main() { println(B) }
`,
	});
	assertEqual(names.join(), "A,B,C,main");
});

test("a var block is reached spec by spec", () => {
	const names = reached({
		"main.go": `package main
var (
	a = 1
	b = 2
)
func main() { println(a) }
`,
	});
	assertEqual(names.join(), "a,main");
});

test("a package-level initializer that calls is a root, a plain one is not", () => {
	const names = reached({
		"main.go": `package main
func side() int { println("side"); return 1 }
func pure() int { return 2 }
var ran = side()
var _ = side()
var callback = func() { pure() }
var plain = 3
func init() { println("init") }
func main() {}
`,
	});
	assertEqual(names.join(), "_,init,main,ran,side");
});

test("a package without main roots its exported declarations", () => {
	const names = reached({
		"lib.go": `package lib
type Shape struct{ W int }
type hidden struct{ W int }
func Area(s Shape) int { return s.W }
func internalHelper() int { return 1 }
func Uses() int { return viaExport() }
func viaExport() int { return 2 }
func unused() int { return 3 }
var Config = 1
`,
	});
	assertEqual(names.join(), "Area,Config,Shape,Uses,viaExport");
});

test("a local package selector reaches the member of the imported package", () => {
	withTempDir(
		{
			"main.go": `package main
import "./util"
func main() { println(util.Used()) }
`,
			"util/u.go": `package util
func helper() int { return 2 }
func Used() int { return helper() }
func Unused() int { return 3 }
`,
		},
		(dir) => {
			const { names } = reachOf(dir);
			assertEqual(names().join(), "main");
			assertEqual(names("util").join(), "Used,helper");
		},
	);
});

test("an unexported name does not collide across packages", () => {
	withTempDir(
		{
			"main.go": `package main
import "./util"
func helper() int { return 1 }
func main() { println(util.Used()) }
`,
			"util/u.go": `package util
func helper() int { return 2 }
func Used() int { return helper() }
`,
		},
		(dir) => {
			const { names } = reachOf(dir);
			assertEqual(names().join(), "main");
			assertEqual(names("util").join(), "Used,helper");
		},
	);
});

test("an import alias and a qualified type name resolve to the package", () => {
	withTempDir(
		{
			"main.go": `package main
import u "./util"
func main() {
	var b u.Box
	b.V = 1
	println(b.V)
}
`,
			"util/u.go": `package util
type Box struct{ V int }
type Other struct{ V int }
func Unused() int { return 1 }
`,
		},
		(dir) => {
			const { names } = reachOf(dir);
			assertEqual(names("util").join(), "Box");
		},
	);
});

test("a generic qualified type reaches the generic declaration", () => {
	withTempDir(
		{
			"main.go": `package main
import "./util"
func main() {
	b := util.Box[int]{V: 1}
	println(b.V)
}
`,
			"util/u.go": `package util
type Box[T any] struct{ V T }
type Unused[T any] struct{ V T }
`,
		},
		(dir) => {
			assertEqual(reachOf(dir).names("util").join(), "Box");
		},
	);
});

test("a dot import resolves bare names against the imported package", () => {
	withTempDir(
		{
			"main.go": `package main
import . "./util"
func main() { println(Used()) }
`,
			"util/u.go": `package util
func Used() int { return 1 }
func Unused() int { return 2 }
`,
		},
		(dir) => {
			assertEqual(reachOf(dir).names("util").join(), "Used");
		},
	);
});

test("a blank import reaches init and calling initializers only", () => {
	withTempDir(
		{
			"main.go": `package main
import _ "./side"
func main() {}
`,
			"side/s.go": `package side
func register() int { println("registered"); return 1 }
var _ = register()
func init() { println("init") }
func Exported() int { return 1 }
func unused() int { return 2 }
`,
		},
		(dir) => {
			assertEqual(reachOf(dir).names("side").join(), "_,init,register");
		},
	);
});

test("a reached JSON call site reaches its generated codec, a dead one does not", () => {
	withTempDir(
		{
			"main.go": `package main
import "encoding/json"
type Live struct{ N int }
type Dead struct{ N int }
func dead() { json.Marshal(Dead{1}) }
func main() { json.Marshal(Live{1}) }
`,
		},
		(dir) => {
			const names = reachOf(dir).names();
			assert(names.includes("Live"), "Live is reached");
			assert(!names.includes("Dead"), "Dead is not reached");
			assert(
				names.some((n) => n.startsWith("gfj_main_marshal")),
				"a marshal entry is reached",
			);
			assertEqual(
				names.filter((n) => n.startsWith("gfj_main_marshal")).length,
				1,
			);
		},
	);
});

test("a codec of another package keeps that package's type", () => {
	withTempDir(
		{
			"main.go": `package main
import (
	"encoding/json"
	"./util"
)
func main() { json.Marshal(util.Pt{X: 1}) }
`,
			"util/u.go": `package util
type Pt struct{ X int }
type Other struct{ X int }
`,
		},
		(dir) => {
			assertEqual(reachOf(dir).names("util").join(), "Pt");
		},
	);
});

test("fmt formatters are registered only when fmt is reached", () => {
	withTempDir(
		{
			"main.go": `package main
import "fmt"
type T struct{ N int }
func main() {
	var v any = T{1}
	fmt.Println(v)
}
`,
		},
		(dir) => {
			const { names, stdNames } = reachOf(dir);
			assert(
				stdNames().has("Register$$internal$fmtrt"),
				"fmtrt.Register is reached",
			);
			assert(names().includes("_"), "the registering var is reached");
		},
	);
	withTempDir(
		{
			"main.go": `package main
import "fmt"
type T struct{ N int }
func dead() {
	var v any = T{1}
	fmt.Println(v)
}
func main() { println(T{1}.N) }
`,
		},
		(dir) => {
			const { names, stdNames } = reachOf(dir);
			assertEqual(names().join(), "T,main");
			assertEqual(stdNames().size, 0);
		},
	);
});

test("the JSON encoder is registered once dynamic encoding is reached", () => {
	withTempDir(
		{
			"main.go": `package main
import "encoding/json"
func main() {
	var v any = 1
	b, _ := json.Marshal(v)
	println(string(b))
}
`,
		},
		(dir) => {
			const { reach, names } = reachOf(dir);
			assert(names().includes("_"), "the registering var is reached");
			assert(
				[...reach.reached].some(
					(d) => d.kind === "MethodDecl" && d.name === "EncodeDynamic",
				),
				"dynamic encoding is reached",
			);
		},
	);
});

test("a function used only in a templ body is reached", () => {
	const names = reached({
		"main.go": `package main
func fromAttr() string { return "a" }
func fromText() string { return "b" }
func fromIf() bool { return true }
func fromFor() int { return 2 }
func fromSwitch() int { return 1 }
func fromCase() int { return 1 }
func dead() string { return "c" }
func main() { _ = Page() }
`,
		"v.templ": `package main

css box() {
	color: red;
}

css unusedBox() {
	color: blue;
}

templ Sub() {
	<b>sub</b>
}

templ Unused() {
	<i>{ dead() }</i>
}

templ Page() {
	<div class={ box() } id={ fromAttr() }>
		<p>{ fromText() }</p>
		if fromIf() {
			<i>yes</i>
		}
		for i := range fromFor() {
			<span>{ i }</span>
		}
		switch fromSwitch() {
			case fromCase():
				@Sub()
			default:
		}
	</div>
}
`,
	});
	assertEqual(
		names.join(),
		"Page,Sub,box,fromAttr,fromCase,fromFor,fromIf,fromSwitch,fromText,main",
	);
});

test("a test build roots GofrontRunTests, even when it tests package main", () => {
	withTempDir(
		{
			"main.go": `package main
func Add(a, b int) int { return a + b }
func unused() int { return 1 }
func main() {}
`,
			"main_test.go": `package main
import "testing"
func TestAdd(t *testing.T) { if Add(1, 2) != 3 { t.Fail() } }
func TestNever(t *testing.T) { unused() }
`,
		},
		(dir) => {
			const driver = `package main
import "testing"
func GofrontRunTests(run, bench string, verbose bool) int {
	m := testing.GofrontMain("main", run, bench, verbose, []testing.GofrontTest{{Name: "TestAdd", F: TestAdd}}, []testing.GofrontBenchmark{})
	return m.Run()
}
`;
			const { names } = reachOf(dir, { tests: true, driver });
			assertEqual(names().join(), "Add,GofrontRunTests,TestAdd");
		},
	);
});

test("the signatures a wasm package exports reach the types they name", () => {
	withTempDir(
		{
			"main.go": `package main
import "./geo"
func main() { println(geo.Area(geo.Rect{W: 1, H: 2})) }
`,
			"geo/g.go": `//gofront:target wasm
package geo
type Rect struct{ W, H int }
func Area(r Rect) int { return r.W * r.H }
`,
		},
		(dir) => {
			const { units, names } = reachOf(dir);
			assertEqual(
				units.find((u) => u.programs[0].pkg.name === "geo").emitted,
				false,
			);
			assertEqual(names().join(), "main");
		},
	);
});

test("every declaration is reached when nothing is pruned", () => {
	withTempDir(
		{
			"main.go": `package main
func dead() {}
func main() {}
`,
		},
		(dir) => {
			const root = resolve(dir);
			const options = {
				userUnits: [],
				stdlibCache: new Map(),
				packageCache: null,
				rootKey: root,
			};
			compileDir(root, options);
			const reach = reachOfBuild(options, []);
			assertEqual(reach.namesOf(root).join(), "dead,main");
		},
	);
});
