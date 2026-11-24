// GoFront test suite — .templ text bindings that follow a gom.Signal
import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	compileDir,
	runInDom,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

// Compiles a package whose main is `main` (after the mount of View into #app)
// and returns the printed lines and the JS.
function run(decls, templ, main, imports = {}) {
	const { js } = withTempDir(
		{
			"main.go": `package main
${imports.go ?? ""}
${decls}
func main() {
	gom.Mount("#app", View())
${main}
}`,
			"view.templ": `package main
${imports.templ ?? ""}
${templ}`,
		},
		(dir) => compileDir(dir),
	);
	return { js, ...runInDom(js, '<div id="app"></div>') };
}

section("templ reactive text — Get calls");

test("{ sig.Get() } updates the same text node on Set", () => {
	const { lines, js } = run(
		`var count = gom.NewSignal(1)`,
		`templ View() {
	<p>n={ count.Get() }</p>
}`,
		`	p := document.querySelector("#app p")
	t := p.lastChild
	println(p.textContent)
	count.Set(2)
	println(p.textContent, t == p.lastChild, p == document.querySelector("#app p"))
	count.Set(3)
	println(p.textContent)`,
	);
	assertEqual(lines.join("|"), "n=1|n=2 true true|n=3");
	assertContains(js, "Effect$$gom(");
});

test("a compound expression re-evaluates as a whole", () => {
	const { lines } = run(
		`var count = gom.NewSignal(1)
var unit = gom.NewSignal("item")`,
		`templ View() {
	<p>{ fmt.Sprintf("%d %ss", count.Get(), unit.Get()) }</p>
}`,
		`	p := document.querySelector("#app p")
	println(p.textContent)
	count.Set(4)
	unit.Set("box")
	println(p.textContent)`,
		{ templ: 'import "fmt"' },
	);
	assertEqual(lines.join("|"), "1 items|4 boxs");
});

test("sibling reactive text nodes update independently", () => {
	const { lines } = run(
		`var a = gom.NewSignal("a")
var b = gom.NewSignal("b")`,
		`templ View() {
	<p>{ a.Get() }-{ b.Get() }</p>
}`,
		`	p := document.querySelector("#app p")
	println(p.textContent, p.childNodes.length)
	a.Set("A")
	println(p.textContent, p.childNodes.length)
	b.Set("B")
	println(p.textContent, p.childNodes.length)`,
	);
	assertEqual(lines.join("|"), "a-b 3|A-b 3|A-B 3");
});

test("a Computed read follows its signals", () => {
	const { lines } = run(
		`var n = gom.NewSignal(2)
var double = gom.NewComputed(func() int { return n.Get() * 2 })`,
		`templ View() {
	<p>{ double.Get() }</p>
}`,
		`	p := document.querySelector("#app p")
	println(p.textContent)
	n.Set(5)
	println(p.textContent)`,
	);
	assertEqual(lines.join("|"), "4|10");
});

section("templ reactive text — bare values");

test("{ sig } and { comp } show and follow the value", () => {
	const { lines } = run(
		`var n = gom.NewSignal(1)
var label = gom.NewComputed(func() string { return fmt.Sprint("#", n.Get()) })`,
		`templ View() {
	<p>{ n }</p>
	<span>{ label }</span>
}`,
		`	p := document.querySelector("#app p")
	s := document.querySelector("#app span")
	t := p.firstChild
	println(p.textContent, s.textContent)
	n.Set(7)
	println(p.textContent, s.textContent, t == p.firstChild)`,
		{ go: 'import "fmt"' },
	);
	assertEqual(lines.join("|"), "1 #1|7 #7 true");
});

section("templ reactive text — unchanged output");

test("an expression that reads no signal keeps its one-time text node", () => {
	const { js } = run(
		`var n = gom.NewSignal(1)`,
		`templ View() {
	<p>{ n.Get() }</p>
	<i>{ "x" }</i>
}`,
		``,
	);
	assert(
		js.includes(`document.createTextNode(String("x"))`),
		"static text expression keeps createTextNode(String(...))",
	);
});

test("a templ without signals emits no Effect", () => {
	const { js } = run(
		``,
		`templ View() {
	<p>{ 1 }{ "a" }</p>
}`,
		``,
	);
	assert(!js.includes("Effect$$gom"), "no Effect");
});

test("the effects of a re-mounted root stop updating its old text", () => {
	const { lines } = run(
		`var n = gom.NewSignal(1)`,
		`templ View() {
	<p>{ n.Get() }</p>
}`,
		`	old := document.querySelector("#app p")
	gom.Mount("#app", View())
	n.Set(2)
	println(old.textContent, document.querySelector("#app p").textContent)`,
	);
	assertEqual(lines.join("|"), "1 2");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
