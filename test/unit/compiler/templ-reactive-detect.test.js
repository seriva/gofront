// GoFront test suite — which .templ expressions are reactive, and that the
// code they need (Signal.Get, Effect) survives pruning
import { fileURLToPath } from "node:url";
import { CodeGen } from "../../../src/backend/js/index.js";
import { templReactivity } from "../../../src/backend/js/templ.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertThrows,
	compileDir,
	runInDom,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

const MAIN = `func main() {
	gom.Mount("#app", View())
}`;

// Compiles the package and returns the emitted JS plus, for every templ
// expression the code generator visited, its source text and reactivity.
function probe(files) {
	const seen = [];
	const gen = CodeGen.prototype._genTemplExpr;
	CodeGen.prototype._genTemplExpr = function (node, emptyJs) {
		const toks = node.tokens ?? node.condTokens ?? node.exprTokens ?? [];
		seen.push({
			src: toks
				.map((t) => t.value)
				.join("")
				.replace(/;$/, ""),
			reactivity: node.expr ? templReactivity(node.expr) : null,
		});
		return gen.call(this, node, emptyJs);
	};
	try {
		const { js } = withTempDir(files, (dir) => compileDir(dir));
		return { js, seen };
	} finally {
		CodeGen.prototype._genTemplExpr = gen;
	}
}

function reactivityOf(seen, src) {
	const hit = seen.find((s) => s.src === src);
	if (!hit)
		throw new Error(
			`templ expression ${src} was not generated: ${JSON.stringify(seen.map((s) => s.src))}`,
		);
	return hit.reactivity;
}

section("templ reactivity — detection");

test("a Get call on a signal or computed is reactive, other Get calls are not", () => {
	const { seen } = probe({
		"main.go": `package main
type Box struct{ v int }
func (b Box) Get() int { return b.v }
type Alias = gom.Signal[int]
var sig = gom.NewSignal(1)
var comp = gom.NewComputed(func() int { return sig.Get() * 2 })
var val Alias
var box = Box{3}
${MAIN}`,
		"view.templ": `package main
templ View() {
	<p>{ sig.Get() }{ comp.Get() }{ val.Get() }{ box.Get() }{ 7 }</p>
}`,
	});
	assertEqual(reactivityOf(seen, "sig.Get()"), "reads");
	assertEqual(reactivityOf(seen, "comp.Get()"), "reads");
	assertEqual(reactivityOf(seen, "val.Get()"), "reads");
	assertEqual(reactivityOf(seen, "box.Get()"), null);
	assertEqual(reactivityOf(seen, "7"), null);
});

test("a compound expression that reads a signal is reactive", () => {
	const { seen } = probe({
		"main.go": `package main
var count = gom.NewSignal(1)
${MAIN}`,
		"view.templ": `package main
import "fmt"
templ View() {
	<p>{ fmt.Sprintf("%d items", count.Get()) }{ fmt.Sprintf("%d", 1) }</p>
}`,
	});
	assertEqual(reactivityOf(seen, `fmt.Sprintf(%d items,count.Get())`), "reads");
	assertEqual(reactivityOf(seen, `fmt.Sprintf(%d,1)`), null);
});

test("a bare signal or computed value is reactive and read through Get", () => {
	const { seen } = probe({
		"main.go": `package main
var sig = gom.NewSignal(1)
var on = gom.NewSignal(true)
var comp = gom.NewComputed(func() bool { return sig.Get() > 1 })
${MAIN}`,
		"view.templ": `package main
templ View() {
	<input class={ sig } disabled?={ on } checked?={ comp }/>
	<p>{ sig }{ comp }</p>
}`,
	});
	assertEqual(reactivityOf(seen, "sig"), "bare");
	assertEqual(reactivityOf(seen, "on"), "bare");
	assertEqual(reactivityOf(seen, "comp"), "bare");
});

test("a Get inside a function literal is not a read of the expression", () => {
	const { seen } = probe({
		"main.go": `package main
var sig = gom.NewSignal(1)
${MAIN}`,
		"view.templ": `package main
templ View() {
	<p>{ func() int { return sig.Get() }() }</p>
}`,
	});
	assertEqual(reactivityOf(seen, "func()int{returnsig.Get()}()"), null);
});

section("templ reactivity — reachability");

test("a bare signal keeps Signal.Get and Effect when .go never calls Get", () => {
	const { js } = probe({
		"main.go": `package main
var sig = gom.NewSignal(1)
func main() {
	sig.Set(2)
	gom.Mount("#app", View())
}`,
		"view.templ": `package main
templ View() {
	<p>{ sig }</p>
}`,
	});
	assertContains(js, "function Effect$$gom(");
	assert(/\n\s+Get\(\) \{/.test(js), "Signal.Get is emitted");
});

test("a bare computed keeps Computed.Get and Effect", () => {
	const { js } = probe({
		"main.go": `package main
var sig = gom.NewSignal(1)
var comp = gom.NewComputed(func() int { return 2 })
func main() {
	sig.Set(2)
	gom.Mount("#app", View())
}`,
		"view.templ": `package main
templ View() {
	<p>{ comp }</p>
}`,
	});
	assertContains(js, "function Effect$$gom(");
	assertContains(js, "class Computed$$gom");
	const computed = js.slice(js.indexOf("class Computed$$gom"));
	assert(
		/\n\s+Get\(\) \{/.test(computed.slice(0, 600)),
		"Computed.Get is emitted",
	);
});

test("a method called only inside a .templ is kept", () => {
	const { js } = probe({
		"main.go": `package main\n${MAIN}`,
		"view.templ": `package main
import "strconv"
templ View() {
	<p>{ strconv.Itoa(3) }</p>
}`,
	});
	assertContains(js, "function Itoa$$strconv(");
	const { document } = runInDom(js, '<div id="app"></div>');
	assertEqual(document.querySelector("#app p").textContent, "3");
});

test("a program without signals emits no Effect", () => {
	const { js } = probe({
		"main.go": `package main\n${MAIN}`,
		"view.templ": `package main
templ View() {
	<p class={ "a" }>{ 1 }</p>
}`,
	});
	assert(!js.includes("Effect$$gom"), "no Effect in a signal-free program");
	assert(!js.includes("Signal$$gom"), "no Signal in a signal-free program");
});

section("templ reactivity — conditional attributes");

test("a bool signal or computed is accepted by a conditional attribute", () => {
	probe({
		"main.go": `package main
var on = gom.NewSignal(true)
var comp = gom.NewComputed(func() bool { return on.Get() })
${MAIN}`,
		"view.templ": `package main
templ View() {
	<input disabled?={ on } checked?={ comp }/>
}`,
	});
});

test("a non-bool signal in a conditional attribute is rejected", () => {
	assertThrows(
		() =>
			probe({
				"main.go": `package main
var n = gom.NewSignal(1)
${MAIN}`,
				"view.templ": `package main
templ View() {
	<input disabled?={ n }/>
}`,
			}),
		"Conditional attribute 'disabled' must be bool",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
