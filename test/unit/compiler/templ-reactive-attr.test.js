// GoFront test suite — .templ attribute bindings that follow a gom.Signal
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

// Compiles a package whose main mounts View into #app and then runs `main`.
function run(decls, templ, main) {
	const { js } = withTempDir(
		{
			"main.go": `package main
${decls}
func main() {
	gom.Mount("#app", View())
${main}
}`,
			"view.templ": `package main
${templ}`,
		},
		(dir) => compileDir(dir),
	);
	return { js, ...runInDom(js, '<div id="app"></div>') };
}

section("templ reactive attributes — expr");

test("class={ sig.Get() } updates the class of the same element", () => {
	const { lines, js } = run(
		`var cls = gom.NewSignal("a")`,
		`templ View() {
	<div class={ cls.Get() }>x</div>
}`,
		`	d := document.querySelector("#app div")
	println(d.className)
	cls.Set("b")
	println(d.className, d == document.querySelector("#app div"))`,
	);
	assertEqual(lines.join("|"), "a|b true");
	assertContains(js, "Effect$$gom(");
});

test("a bare signal or computed in an attribute follows its value", () => {
	const { lines } = run(
		`var n = gom.NewSignal(1)
var big = gom.NewComputed(func() int { return n.Get() * 100 })`,
		`templ View() {
	<a class={ n } data-big={ big } title={ "t" }>x</a>
}`,
		`	a := document.querySelector("#app a")
	println(a.className, a.getAttribute("data-big"))
	n.Set(2)
	println(a.className, a.getAttribute("data-big"), a.getAttribute("title"))`,
	);
	assertEqual(lines.join("|"), "1 100|2 200 t");
});

test("a compound attribute expression re-evaluates as a whole", () => {
	const { lines } = run(
		`var on = gom.NewSignal(false)`,
		`templ View() {
	<p data-state={ map[bool]string{false: "off", true: "on"}[on.Get()] }>x</p>
}`,
		`	p := document.querySelector("#app p")
	println(p.getAttribute("data-state"))
	on.Set(true)
	println(p.getAttribute("data-state"))`,
	);
	assertEqual(lines.join("|"), "off|on");
});

test("class and other attributes of an SVG element update", () => {
	const { lines } = run(
		`var cls = gom.NewSignal("a")
var r = gom.NewSignal(1)`,
		`templ View() {
	<svg><circle class={ cls } r={ r.Get() }></circle></svg>
}`,
		`	c := document.querySelector("#app circle")
	println(c.namespaceURI, c.getAttribute("class"), c.getAttribute("r"))
	cls.Set("b")
	r.Set(5)
	println(c.getAttribute("class"), c.getAttribute("r"))`,
	);
	assertEqual(lines.join("|"), "http://www.w3.org/2000/svg a 1|b 5");
});

section("templ reactive attributes — cond-bool");

test("disabled?={ sig.Get() } toggles the attribute", () => {
	const { lines, js } = run(
		`var on = gom.NewSignal(true)`,
		`templ View() {
	<button disabled?={ on.Get() }>x</button>
}`,
		`	b := document.querySelector("#app button")
	println(b.hasAttribute("disabled"))
	on.Set(false)
	println(b.hasAttribute("disabled"))
	on.Set(true)
	println(b.hasAttribute("disabled"))`,
	);
	assertEqual(lines.join("|"), "true|false|true");
	assertContains(js, "toggleAttribute(");
});

test("disabled?={ boolSig } and disabled?={ boolComp } toggle", () => {
	const { lines } = run(
		`var s = gom.NewSignal(false)
var c = gom.NewComputed(func() bool { return !s.Get() })`,
		`templ View() {
	<input disabled?={ s } readonly?={ c }/>
}`,
		`	i := document.querySelector("#app input")
	println(i.hasAttribute("disabled"), i.hasAttribute("readonly"))
	s.Set(true)
	println(i.hasAttribute("disabled"), i.hasAttribute("readonly"))`,
	);
	assertEqual(lines.join("|"), "false true|true false");
});

section("templ reactive attributes — unchanged output");

test("attributes that read no signal keep their one-time output", () => {
	const { js } = run(
		`var n = gom.NewSignal(1)`,
		`templ View() {
	<p class={ "a" } title={ "t" } hidden?={ false }>{ n.Get() }</p>
}`,
		``,
	);
	assert(js.includes(`.className = "a";`), "class assigned once");
	assert(js.includes(`setAttribute("title", String("t"))`), "title set once");
	assert(js.includes(`if(false)`), "cond-bool keeps its if");
	assert(!js.includes("toggleAttribute"), "no toggleAttribute");
	assertEqual((js.match(/Effect\$\$gom\(function/g) ?? []).length, 1);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
