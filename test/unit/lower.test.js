// test/unit/lower.test.js
// Unit tests for lowering analyses: captures, escape analysis, boxing, and side-tables.

import assert from "node:assert";
import { Lexer } from "../../src/lexer.js";
import {
	analyzeCaptures,
	lower,
	paramEscapes,
	scanAddressTaken,
} from "../../src/lower/index.js";
import { Parser } from "../../src/parser/index.js";
import { TypeChecker } from "../../src/typechecker/index.js";
import { test } from "./helpers.js";

function parseSnippet(code) {
	const source = `package main\n${code}`;
	const tokens = new Lexer(source, "test.go").tokenize();
	const ast = new Parser(tokens, "test.go", source).parse();
	const checker = new TypeChecker();
	checker.check(ast);
	return { ast, checker };
}

// ── Captures Analysis ────────────────────────────────────────

test("lower/captures: detects read-only variable capture", () => {
	const { ast } = parseSnippet(`
func main() {
	x := 42
	f := func() int {
		return x
	}
	_ = f
}
`);
	const fn = ast.decls.find((d) => d.name === "main");
	const analysis = analyzeCaptures(fn);
	assert.strictEqual(analysis.capturesByClosure.size, 1);
	const captured = [...analysis.capturesByClosure.values()][0];
	assert.ok(captured.has("x"));
	assert.strictEqual(analysis.mutatedCaptures.has("x"), false);
});

test("lower/captures: detects mutated variable captured in closure", () => {
	const { ast } = parseSnippet(`
func main() {
	count := 0
	inc := func() {
		count++
	}
	inc()
}
`);
	const fn = ast.decls.find((d) => d.name === "main");
	const analysis = analyzeCaptures(fn);
	assert.strictEqual(analysis.capturesByClosure.size, 1);
	const captured = [...analysis.capturesByClosure.values()][0];
	assert.ok(captured.has("count"));
	assert.ok(analysis.mutatedCaptures.has("count"));
});

test("lower/captures: detects variable mutated in outer scope after closure creation", () => {
	const { ast } = parseSnippet(`
func main() {
	x := 10
	f := func() int { return x }
	x = 20
	_ = f
}
`);
	const fn = ast.decls.find((d) => d.name === "main");
	const analysis = analyzeCaptures(fn);
	assert.ok(analysis.mutatedCaptures.has("x"));
});

// ── Escape Analysis (Boundary Rules) ────────────────────────

test("lower/escape: in-place mutations do not escape", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func Update(v *Vec) {
	v.X = 10
	v.Y = 20
}
`);
	const fn = ast.decls.find((d) => d.name === "Update");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, false);
});

test("lower/escape: returning pointer is flagged as escaping", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func PassThrough(v *Vec) *Vec {
	return v
}
`);
	const fn = ast.decls.find((d) => d.name === "PassThrough");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

test("lower/escape: storing pointer into struct field escapes", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
type Holder struct { P *Vec }
func Store(h *Holder, v *Vec) {
	h.P = v
}
`);
	const fn = ast.decls.find((d) => d.name === "Store");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

test("lower/escape: appending pointer to slice escapes", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func Collect(list []*Vec, v *Vec) {
	list = append(list, v)
}
`);
	const fn = ast.decls.find((d) => d.name === "Collect");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

test("lower/escape: capturing pointer in escaping closure escapes", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func DeferUse(v *Vec) func() {
	return func() {
		v.X = 99
	}
}
`);
	const fn = ast.decls.find((d) => d.name === "DeferUse");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

// ── Boxing Analysis ──────────────────────────────────────────

test("lower/boxing: scalar address taken is marked for boxing", () => {
	const { ast } = parseSnippet(`
func main() {
	a := 10
	p := &a
	_ = p
}
`);
	const fn = ast.decls.find((d) => d.name === "main");
	const boxed = scanAddressTaken(fn.body);
	assert.ok(boxed.has("a"));
});

test("lower/boxing: struct pointer does not box the struct variable itself", () => {
	const { ast } = parseSnippet(`
type Point struct { X, Y int }
func main() {
	pt := Point{X: 1, Y: 2}
	p := &pt
	_ = p
}
`);
	const fn = ast.decls.find((d) => d.name === "main");
	const boxed = scanAddressTaken(fn.body);
	assert.strictEqual(boxed.has("pt"), false);
});

test("lower/escape: returning scalar field does not escape", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func GetX(v *Vec) float64 {
	return v.X
}
`);
	const fn = ast.decls.find((d) => d.name === "GetX");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, false);
});

test("lower/escape: copying struct field does not escape", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func CopyField(v *Vec, other *Vec) {
	other.X = v.X
}
`);
	const fn = ast.decls.find((d) => d.name === "CopyField");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, false);
});

test("lower/escape: returning interior pointer &v.X escapes", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func GetPtr(v *Vec) *float64 {
	return &v.X
}
`);
	const fn = ast.decls.find((d) => d.name === "GetPtr");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

test("lower/escape: assigning to package global escapes", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
var GlobalVec *Vec
func Retain(v *Vec) {
	GlobalVec = v
}
`);
	const fn = ast.decls.find((d) => d.name === "Retain");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

test("lower/escape: returning via local alias escapes", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
func Alias(v *Vec) *Vec {
	tmp := v
	return tmp
}
`);
	const fn = ast.decls.find((d) => d.name === "Alias");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

test("lower/escape: returning via composite literal escapes", () => {
	const { ast } = parseSnippet(`
type Vec struct { X, Y float64 }
type Holder struct { P *Vec }
func Wrap(v *Vec) *Holder {
	return &Holder{ P: v }
}
`);
	const fn = ast.decls.find((d) => d.name === "Wrap");
	const escapes = paramEscapes(fn.body, "v");
	assert.strictEqual(escapes, true);
});

// ── Captures Scoping Edge Cases ──────────────────────────────

test("lower/captures: nested closure captures from intermediate scope", () => {
	const { ast } = parseSnippet(`
func outer() {
	a := 1
	_ = func() {
		b := 2
		f := func() int {
			return a + b
		}
		_ = f
	}
}
`);
	const fn = ast.decls.find((d) => d.name === "outer");
	const analysis = analyzeCaptures(fn);
	assert.strictEqual(analysis.capturesByClosure.size, 2);

	// Find the innermost closure
	const innermost = [...analysis.capturesByClosure.entries()].find(([_, set]) =>
		set.has("b"),
	);
	assert.ok(innermost);
	assert.ok(innermost[1].has("a"));
	assert.ok(innermost[1].has("b"));
});

test("lower/captures: method receiver is captured and tracked for mutation", () => {
	const { ast } = parseSnippet(`
type Counter struct { val int }
func (c *Counter) Step() func() {
	return func() {
		c.val++
	}
}
`);
	const fn = ast.decls.find((d) => d.name === "Step");
	const analysis = analyzeCaptures(fn);
	assert.strictEqual(analysis.capturesByClosure.size, 1);
	const captured = [...analysis.capturesByClosure.values()][0];
	assert.ok(captured.has("c"));
	assert.ok(analysis.mutatedCaptures.has("c"));
});

test("lower/captures: struct literal field does not trigger false capture", () => {
	const { ast } = parseSnippet(`
type Point struct { X, Y int }
func check() {
	X := 100
	f := func() Point {
		return Point{ X: 1, Y: 2 }
	}
	X = 200
	_ = f
}
`);
	const fn = ast.decls.find((d) => d.name === "check");
	const analysis = analyzeCaptures(fn);
	const captured = [...analysis.capturesByClosure.values()][0];
	assert.strictEqual(captured.has("X"), false);
	assert.strictEqual(analysis.mutatedCaptures.has("X"), false);
});

// ── Full Lower Integration ───────────────────────────────────

test("lower: produces valid side-tables for programs", () => {
	const { ast, checker } = parseSnippet(`
type Inner struct{}
func (i Inner) Method() int { return 1 }

type Outer struct {
	Inner
}

func Compute(x int) (res int) {
	defer func() {}()
	res = x * 2
	return
}
`);
	const res = lower(ast, checker);
	assert.ok(res.embeddedStubs.has("Outer"));
	const outerStubs = res.embeddedStubs.get("Outer");
	assert.strictEqual(outerStubs.length, 1);
	assert.strictEqual(outerStubs[0].methodName, "Method");

	const computeFn = ast.decls.find((d) => d.name === "Compute");
	const fnMeta = res.functions.get(computeFn);
	assert.ok(fnMeta.hasDefer);
	assert.deepStrictEqual(fnMeta.namedReturns.names, ["res"]);
	assert.ok(res.captures.has(computeFn));
	assert.ok(res.escapes.has(computeFn));
});

test("lower: aggregates methods across multiple files in a package for embedded stubs", () => {
	const source1 = `package main
type Inner struct{}
type Outer struct {
	Inner
}
`;
	const source2 = `package main
func (i Inner) SharedMethod() int { return 42 }
`;
	const t1 = new Lexer(source1, "f1.go").tokenize();
	const ast1 = new Parser(t1, "f1.go", source1).parse();
	const t2 = new Lexer(source2, "f2.go").tokenize();
	const ast2 = new Parser(t2, "f2.go", source2).parse();

	const checker = new TypeChecker();
	checker.checkAll([ast1, ast2]);

	const res = lower([ast1, ast2], checker);
	assert.ok(res.embeddedStubs.has("Outer"));
	const outerStubs = res.embeddedStubs.get("Outer");
	assert.strictEqual(outerStubs.length, 1);
	assert.strictEqual(outerStubs[0].methodName, "SharedMethod");
});
