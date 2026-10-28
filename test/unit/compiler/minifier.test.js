// GoFront test suite — built-in minifier

import { minify } from "../../../src/cli/minifier.js";
import {
	assert,
	assertContains,
	assertEqual,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

// ── Stage 1: Comment and whitespace stripping ────────────────

section("Minifier — Stage 1: Comments & whitespace");

test("strips line comments", () => {
	const code = "let x = 1; // this is a comment\nlet y = 2; // another";
	const out = minify(code);
	assert(!out.includes("//"), "line comments should be removed");
	assertContains(out, "let x=1");
	assertContains(out, "let y=2");
});

test("strips block comments", () => {
	const code = "let x = /* block comment */ 1;";
	const out = minify(code);
	assert(!out.includes("/*"), "block comments should be removed");
	assert(!out.includes("*/"), "block comment end should be removed");
	assertContains(out, "let x=1");
});

test("strips multi-line block comments", () => {
	const code = "let x = 1;\n/* this\n   spans\n   lines */\nlet y = 2;";
	const out = minify(code);
	assert(!out.includes("/*"), "block comments should be removed");
	assertContains(out, "let x=1");
	assertContains(out, "let y=2");
});

test("collapses whitespace and newlines", () => {
	const code = "let   x   =   1;\n\n\n   let   y   =   2;";
	const out = minify(code);
	assert(!out.includes("\n"), "newlines should be collapsed");
	assert(!out.includes("  "), "double spaces should be collapsed");
});

// ── Stage 2: Token-level compression ─────────────────────────

section("Minifier — Stage 2: Token compression");

test("removes spaces around operators", () => {
	const code = "let x = a + b;";
	const out = minify(code);
	assertContains(out, "a+b");
});

test("removes spaces around braces and parens", () => {
	const code = "function f() { return 1; }";
	const out = minify(code);
	assertContains(out, "f(){return 1;}");
});

test("compresses else blocks", () => {
	const code = "if (x) { a(); } else { b(); }";
	const out = minify(code);
	assertContains(out, "}else{");
});

test("preserves string literal contents", () => {
	const code = 'let s = "hello   world  //  not a comment";';
	const out = minify(code);
	assertContains(out, '"hello   world  //  not a comment"');
});

test("preserves single-quote string contents", () => {
	const code = "let s = 'hello   world';";
	const out = minify(code);
	assertContains(out, "'hello   world'");
});

test("preserves template literal contents", () => {
	// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal template preservation
	const code = "let s = `hello   world  ${x}  `;";
	const out = minify(code);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal template preservation
	assertContains(out, "`hello   world  ${x}  `");
});

test("preserves regex literals", () => {
	const code = "let r = /\\p{L}+/u;";
	const out = minify(code);
	assertContains(out, "/\\p{L}+/u");
});

test("treats / after ) and ] as division", () => {
	const code =
		"let a = (x * Math.PI) / 180.0 * f;\nlet b = arr[0] / 2;\nlet c = 1;";
	const out = minify(code);
	assertContains(out, "(x*Math.PI)/180.0*f");
	assertContains(out, "arr[0]/2");
	assertContains(out, "let c=1");
});

test("preserves IIFE parens", () => {
	const code = "(function() { let x = 1; })();";
	const out = minify(code);
	assertContains(out, "(function(){");
	assertContains(out, "})()");
});

const keywordSpacingCases = [
	[
		"preserves keyword spacing: return x",
		"function f() { return x; }",
		"return x",
	],
	["preserves keyword spacing: let a", "{ let a = 1; }", "let a"],
	["preserves keyword spacing: const a", "{ const a = 1; }", "const a"],
	["preserves keyword spacing: typeof x", "let t = typeof x;", "typeof x"],
	["preserves keyword spacing: new X", "let o = new Point();", "new Point"],
	[
		"preserves keyword spacing: case value",
		"switch(x){ case 1: break; }",
		"case 1",
	],
	[
		"preserves keyword spacing: instanceof",
		"if (x instanceof Error) {}",
		"instanceof Error",
	],
	[
		"preserves keyword spacing: function name",
		"function myFunc() { return 1; }",
		"function myFunc",
	],
	[
		"preserves keyword spacing: class name",
		"class Point { constructor() {} }",
		"class Point",
	],
	[
		"preserves keyword spacing: extends",
		"class Dog extends Animal { constructor() { super(); } }",
		"extends Animal",
	],
];

for (const [name, code, expected] of keywordSpacingCases) {
	test(name, () => {
		assertContains(minify(code), expected);
	});
}

test("preserves keyword spacing: void, delete, in, of", () => {
	const out1 = minify("void 0;");
	assertContains(out1, "void 0");
	const out2 = minify("for (let k in obj) {}");
	assertContains(out2, "k in obj");
	const out3 = minify("for (const v of arr) {}");
	assertContains(out3, "v of arr");
});

test("preserves escaped quotes in strings", () => {
	const code = 'let s = "he said \\"hello\\"";';
	const out = minify(code);
	assertContains(out, '"he said \\"hello\\""');
});

test("preserves semicolons", () => {
	const code = "let x = 1; let y = 2;";
	const out = minify(code);
	assertContains(out, "let x=1;let y=2");
});

// ── Stage 3: Identifier mangling ─────────────────────────────

section("Minifier — Stage 3: Identifier mangling");

test("mangling renames local variables", () => {
	const code = "function f(){let result=1;let counter=2;return result+counter}";
	const out = minify(code, { mangle: true });
	// Should not contain original long names
	assert(!out.includes("result"), "should mangle 'result'");
	assert(!out.includes("counter"), "should mangle 'counter'");
	// Should still be valid: contains function f
	assertContains(out, "function f()");
});

test("mangling preserves class and method names", () => {
	const code =
		"class Point{constructor({X,Y}){this.X=X;this.Y=Y}GetX(){return this.X}}";
	const out = minify(code, { mangle: true });
	assertContains(out, "class Point");
	assertContains(out, "GetX");
});

test("mangling preserves property accesses", () => {
	const code =
		"function f(){let myVar=document.getElementById('x');return myVar.textContent}";
	const out = minify(code, { mangle: true });
	assertContains(out, "getElementById");
	assertContains(out, "textContent");
	assert(!out.includes("myVar"), "should mangle 'myVar'");
});

test("mangling disabled by default", () => {
	const code = "function f(){let result=1;return result}";
	const out = minify(code);
	assertContains(out, "result");
});

test("mangling does not collide with existing unrenamed identifiers", () => {
	const code = "let currentTheme='dark';function t(k){return k}";
	const out = minify(code, { mangle: true });
	assert(
		!out.includes("let t="),
		"should not mangle currentTheme to existing 't'",
	);
	assertContains(out, "function t(k)");
});

test("mangling does not treat call arguments as parameter declarations", () => {
	const code =
		"function f(){let img=Reflect.construct(Image,[]);let v=make(SomeGlobal,[img]);return v}";
	const out = minify(code, { mangle: true });
	assertContains(out, "Reflect.construct(Image,[");
	assertContains(out, "make(SomeGlobal,[");
	assert(!out.includes("let img="), "should still mangle locals");
});

test("mangling still renames method and arrow parameters", () => {
	const code =
		"class A{Run(firstArg,secondArg){return firstArg+secondArg}}const g=(alpha)=>{return alpha};";
	const out = minify(code, { mangle: true });
	assert(!out.includes("firstArg"), "method params should be mangled");
	assert(!out.includes("secondArg"), "method params should be mangled");
	assertContains(out, "class A{Run(");
});

// ── Stage 4: Literal folding ─────────────────────────────────

section("Minifier — Stage 4: Literal folding");

const foldingCases = [
	["folds constant numeric addition", "let x = 0 + 0;", "let x=0"],
	["folds constant numeric expressions", "let x = 1 + 2;", "let x=3"],
	["folds constant multiplication", "let x = 3 * 4;", "let x=12"],
	["does not fold non-constant expressions", "let x = a + 2;", "a+2"],
	[
		"preserves SVG path strings with minus-separated numbers",
		'let d = "M233.4 105.4c12.5-12.5 32.8-12.5 45.3 0l192-192c12.5-12.5";',
		'"M233.4 105.4c12.5-12.5 32.8-12.5 45.3 0l192-192c12.5-12.5"',
	],
	[
		"preserves template literals with minus-separated numbers",
		"let d = `M233.4 105.4c12.5-12.5 32.8-12.5`;",
		"`M233.4 105.4c12.5-12.5 32.8-12.5`",
	],
	["folds chained constant additions", "let x = 1 + 2 + 3;", "let x=6"],
	[
		"preserves operator precedence in literal expressions",
		"let x = 1 + 2 * 3;",
		"let x=1+2*3",
	],
	[
		"preserves unary minus with binary addition",
		"let x = -1 + 2;",
		"let x=-1+2",
	],
];

for (const [name, code, expected] of foldingCases) {
	test(name, () => {
		assertContains(minify(code), expected);
	});
}

// ── Round-trip tests ─────────────────────────────────────────

section("Minifier — Round-trip");

test("round-trip: compile GoFront → minify → eval produces same result", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 10
	y := 20
	console.log(x + y)
}`);
	assertEqual(errors.length, 0);
	const original = runJs(js);
	const minified = minify(js);
	const minifiedResult = runJs(minified);
	assertEqual(minifiedResult, original);
});

test("round-trip: struct with methods", () => {
	const { js, errors } = compile(`package main
type Point struct {
	X int
	Y int
}
func (p Point) Sum() int {
	return p.X + p.Y
}
func main() {
	p := Point{X: 3, Y: 4}
	console.log(p.Sum())
}`);
	assertEqual(errors.length, 0);
	const original = runJs(js);
	const minified = minify(js);
	const minifiedResult = runJs(minified);
	assertEqual(minifiedResult, original);
});

test("round-trip: string operations preserved", () => {
	const { js, errors } = compile(`package main
func main() {
	s := "hello   world"
	console.log(s)
}`);
	assertEqual(errors.length, 0);
	const original = runJs(js);
	assertEqual(original, "hello   world");
	const minified = minify(js);
	assertEqual(runJs(minified), original);
});

test("round-trip: for loop with iota-style patterns", () => {
	const { js, errors } = compile(`package main
func main() {
	sum := 0
	for i := 0; i < 5; i++ {
		sum = sum + i
	}
	console.log(sum)
}`);
	assertEqual(errors.length, 0);
	const original = runJs(js);
	const minified = minify(js);
	assertEqual(runJs(minified), original);
});

test("round-trip: switch statement", () => {
	const { js, errors } = compile(`package main
func main() {
	x := 2
	switch x {
	case 1:
		console.log("one")
	case 2:
		console.log("two")
	default:
		console.log("other")
	}
}`);
	assertEqual(errors.length, 0);
	const original = runJs(js);
	assertEqual(original, "two");
	const minified = minify(js);
	assertEqual(runJs(minified), original);
});

test("round-trip: multiple return values", () => {
	const { js, errors } = compile(`package main
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
}`);
	assertEqual(errors.length, 0);
	const original = runJs(js);
	assertEqual(original, "5");
	const minified = minify(js);
	assertEqual(runJs(minified), original);
});

test("round-trip with mangling produces same result", () => {
	const { js, errors } = compile(`package main
func main() {
	firstName := "John"
	lastName := "Doe"
	console.log(firstName + " " + lastName)
}`);
	assertEqual(errors.length, 0);
	const original = runJs(js);
	assertEqual(original, "John Doe");
	const mangled = minify(js, { mangle: true });
	assertEqual(runJs(mangled), original);
});

test("minified output is shorter than original", () => {
	const { js, errors } = compile(`package main
// Main function of the application
func main() {
	// Initialize variables
	x := 10
	y := 20
	// Compute sum
	result := x + y
	console.log(result)
}`);
	assertEqual(errors.length, 0);
	const minified = minify(js);
	assert(
		minified.length < js.length,
		`minified (${minified.length}) should be shorter than original (${js.length})`,
	);
});
