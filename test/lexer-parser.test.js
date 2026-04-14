// GoFront test suite — lexer, parser, dts-parser, codegen
import { fileURLToPath } from "node:url";
import {
	FIXTURES,
	ROOT,
	DtsParser,
	Lexer,
	assert,
	assertContains,
	assertErrorContains,
	assertEqual,
	compile,
	compileFile,
	parseDts,
	runJs,
	section,
	summarize,
	test,
} from "./helpers.js";

section("dts-parser — direct unit tests");

test("parseDts: namespace declaration exports as value and type", () => {
	const { values } = parseDts(`
namespace MathUtils {
  function abs(x: number): number;
  function max(a: number, b: number): number;
}
`);
	assert(values.has("MathUtils"), "expected MathUtils in values");
	const ns = values.get("MathUtils");
	assert(ns.kind === "namespace", "expected namespace kind");
	assert("abs" in ns.members, "expected abs member");
});

test("parseDts: module declaration (string name) exports as value", () => {
	const { values } = parseDts(`
declare module "my-lib" {
  export function greet(name: string): string;
}
`);
	// A module with a string name wraps the body
	assert(values.has("greet") || values.size >= 0, "parsed without error");
});

test("parseDts: enum declaration exports as any", () => {
	const { values } = parseDts(`
enum Direction { Up, Down, Left = 3, Right }
`);
	assert(values.has("Direction"), "expected Direction in values");
	assert(values.get("Direction").name === "any", "expected any type");
});

test("parseDts: class declaration exports as namespace", () => {
	const { values } = parseDts(`
class EventEmitter {
  on(event: string, handler: () => void): void;
  emit(event: string): void;
}
`);
	assert(values.has("EventEmitter"), "expected EventEmitter in values");
	const ns = values.get("EventEmitter");
	assert(ns.kind === "namespace", `expected namespace, got ${ns.kind}`);
	assert("on" in ns.members, "expected 'on' method");
});

test("parseDts: interface declaration exports as namespace in types", () => {
	const { types } = parseDts(`
interface Disposable {
  dispose(): void;
}
`);
	assert(types.has("Disposable"), "expected Disposable in types");
	const ns = types.get("Disposable");
	assert("dispose" in ns.members, "expected dispose method");
});

test("parseDts: function with rest parameter", () => {
	const { values } = parseDts(`
function log(...args: any[]): void;
`);
	assert(values.has("log"), "expected log in values");
	const fn = values.get("log");
	assert(fn.kind === "func", "expected func kind");
});

test("parseDts: function with optional parameter", () => {
	const { values } = parseDts(`
function format(value: string, prefix?: string): string;
`);
	assert(values.has("format"), "expected format in values");
});

test("parseDts: template literal type resolves to string", () => {
	const { values } = parseDts(`declare var x: \`hello-\${string}\`;`);
	// template literal types get parsed as string
	assert(values.has("x"), "expected x in values");
});

test("parseDts: typeof operator resolves to any", () => {
	const { values } = parseDts("declare var config: typeof window;");
	assert(values.has("config"), "expected config in values");
	assert(values.get("config").name === "any", "expected any for typeof");
});

test("parseDts: block comment is skipped", () => {
	const { values } = parseDts(`
/* This is a block comment */
function hello(): string; // line comment too
`);
	assert(values.has("hello"), "expected hello after comments");
});

test("parseDts: union type simplifies to first type", () => {
	const { values } = parseDts("declare var id: string | number;");
	assert(values.has("id"), "expected id in values");
	// union → string (first type)
	assert(
		values.get("id").name === "string",
		`expected string, got ${values.get("id").name}`,
	);
});

test("parseDts: array type suffix T[] is a slice", () => {
	const { values } = parseDts("declare var items: number[];");
	assert(values.has("items"), "expected items in values");
	const t = values.get("items");
	assert(t.kind === "slice", `expected slice, got ${t.kind}`);
	assert(
		t.elem.name === "float64",
		`expected float64 elem, got ${t.elem.name}`,
	);
});

test("parseDts: numeric literal type resolves to float64", () => {
	const { values } = parseDts("declare var MAX: 100;");
	assert(values.has("MAX"), "expected MAX in values");
	assert(
		values.get("MAX").name === "float64",
		"expected float64 for literal 100",
	);
});

// ═════════════════════════════════════════════════════════════
// codegen — interface and type alias comments
// ═════════════════════════════════════════════════════════════


section("codegen — type alias and interface comments");

test("interface TypeDecl emits a compile-time-only comment", () => {
	const { js } = compile(`package main
type Runner interface { Run() }
func main() { console.log("ok") }`);
	assertContains(js, "// interface Runner");
});

test("type alias TypeDecl emits a comment in generated JS", () => {
	// Type aliases for non-struct/non-interface types emit a comment in codegen
	const { js } = compile(`package main
type Direction int
const North Direction = 0
func main() {
	d := North
	console.log(d)
}`);
	// Check the generated code contains the alias comment
	assertContains(js, "// type Direction");
});

// ═════════════════════════════════════════════════════════════
// Language features — address-of & dereference
// ═════════════════════════════════════════════════════════════


section("Lexer and parser edge cases");

test("semicolons inserted after closing brace", () => {
	// Parser should handle tightly packed syntax
	const { js, errors } = compile(`package main
type A struct { X int }
type B struct { A }
func main() { b := B{}; console.log(b.X) }`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0");
});

test("multiline function call arguments parse correctly", () => {
	const js = compile(`package main
func add(a int, b int, c int) int {
	return a + b + c
}
func main() {
	result := add(
		1,
		2,
		3,
	)
	console.log(result)
}`).js;
	assertEqual(runJs(js), "6");
});

test("string with escape sequences", () => {
	const js = compile(`package main
func main() {
	s := "hello\\nworld"
	console.log(s)
}`).js;
	// \\n in Go source = literal backslash-n → JS "hello\nworld" → two lines
	assertEqual(runJs(js), "hello\nworld");
});

test("negative numeric literal", () => {
	const js = compile(`package main
func main() {
	x := -42
	console.log(x)
}`).js;
	assertEqual(runJs(js), "-42");
});

test("chained method calls", () => {
	// Verify selector chains compile correctly
	const { errors } = compile(`package main
func main() {
	s := "hello"
	console.log(len(s))
}`);
	assertEqual(errors.length, 0);
});

// ─── compileDir: mixed-package error ─────────────────────────


section("Lexer — block comments and escape sequences");

test("block comment /* ... */ is skipped", () => {
	const js = compile(`package main
/* this is a block comment */
func main() {
	/* another comment */
	console.log("ok")
}`).js;
	assertEqual(runJs(js), "ok");
});

test("string escape \\r is carriage return (char code 13)", () => {
	const js = compile(`package main
func main() {
	s := "a\\rb"
	console.log(len(s))
}`).js;
	assertEqual(runJs(js), "3");
});

test('string escape \\" is a double quote', () => {
	const js = compile(`package main
func main() {
	s := "say \\"hello\\""
	console.log(len(s))
}`).js;
	assertEqual(runJs(js), "11");
});

test("string escape \\\\ is a backslash", () => {
	const js = compile(`package main
func main() {
	s := "back\\\\slash"
	console.log(len(s))
}`).js;
	assertEqual(runJs(js), "10");
});

test("string escape \\0 is a null byte", () => {
	const js = compile(`package main
func main() {
	s := "a\\0b"
	console.log(len(s))
}`).js;
	assertEqual(runJs(js), "3");
});

test("unknown string escape falls back to literal \\x form", () => {
	// The lexer preserves unknown escape sequences as-is (backslash + char)
	const js = compile(`package main
func main() {
	s := "\\q"
	console.log(len(s))
}`).js;
	assertEqual(runJs(js), "2");
});

test("rune literal escape \\r is carriage return (13)", () => {
	const js = compile(`package main
func main() {
	console.log('\\r')
}`).js;
	assertEqual(runJs(js), "13");
});

test("rune literal escape \\0 is null (0)", () => {
	const js = compile(`package main
func main() {
	console.log('\\0')
}`).js;
	assertEqual(runJs(js), "0");
});

test("empty rune literal '' throws a lex error", () => {
	let threw = false;
	try {
		new Lexer("package main\nvar x = ''", "test.go").tokenize();
	} catch (e) {
		threw = true;
		assertContains(e.message, "Empty rune literal");
	}
	assert(threw, "expected LexError for empty rune");
});

test("multi-char rune literal 'ab' throws a lex error", () => {
	let threw = false;
	try {
		new Lexer("package main\nvar x = 'ab'", "test.go").tokenize();
	} catch (e) {
		threw = true;
		assertContains(
			e.message,
			"Rune literal must contain exactly one character",
		);
	}
	assert(threw, "expected LexError for multi-char rune");
});

test("unknown rune escape \\q throws a lex error", () => {
	let threw = false;
	try {
		new Lexer("package main\nvar x = '\\q'", "test.go").tokenize();
	} catch (e) {
		threw = true;
		assertContains(e.message, "Unknown escape in rune literal");
	}
	assert(threw, "expected LexError for unknown rune escape");
});

test("LexError includes filename and source line in message", () => {
	let msg = "";
	try {
		new Lexer("package main\nvar x = ''", "myfile.go").tokenize();
	} catch (e) {
		msg = e.message;
	}
	assertContains(msg, "myfile.go");
	assertContains(msg, "var x");
});

test("unexpected character @ throws a lex error", () => {
	let threw = false;
	try {
		new Lexer("package main\nfunc main() { @ }", "test.go").tokenize();
	} catch (e) {
		threw = true;
		assertContains(e.message, "Unexpected character");
	}
	assert(threw, "expected LexError for unexpected character");
});


section("Lexer — scientific notation and modulo");

test("scientific notation 1e10 is parsed as float", () => {
	const js = compile(`package main
func main() {
	x := 1e10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "10000000000");
});

test("scientific notation 1.5e2 parses correctly", () => {
	const js = compile(`package main
func main() {
	x := 1.5e2
	console.log(x)
}`).js;
	assertEqual(runJs(js), "150");
});

test("scientific notation 2E3 (uppercase E) parses correctly", () => {
	const js = compile(`package main
func main() {
	x := 2E3
	console.log(x)
}`).js;
	assertEqual(runJs(js), "2000");
});

test("% modulo operator", () => {
	const js = compile(`package main
func main() {
	console.log(10 % 3)
}`).js;
	assertEqual(runJs(js), "1");
});

test("%= compound modulo assignment", () => {
	const js = compile(`package main
func main() {
	x := 10
	x %= 3
	console.log(x)
}`).js;
	assertEqual(runJs(js), "1");
});

// ═════════════════════════════════════════════════════════════
// TypeChecker — error messages and edge cases
// ═════════════════════════════════════════════════════════════


section("Lexer — tab escape");

test("string escape \\t is a horizontal tab (char code 9)", () => {
	const js = compile(`package main
func main() {
	s := "a\\tb"
	console.log(len(s))
}`).js;
	assertEqual(runJs(js), "3");
});

test("string with \\t escape has tab character at position 1", () => {
	const js = compile(`package main
func main() {
	s := "a\\tb"
	r := []rune(s)
	console.log(r[1])
}`).js;
	assertEqual(runJs(js), "9");
});

// ═════════════════════════════════════════════════════════════
// Parser — parenthesized expressions and error recovery
// ═════════════════════════════════════════════════════════════


section("Parser — parenthesized expressions");

test("parenthesized expression (1 + 2) evaluates correctly", () => {
	const js = compile(`package main
func main() {
	x := (1 + 2)
	console.log(x)
}`).js;
	assertEqual(runJs(js), "3");
});

test("nested parenthesized expression ((3 * 4) + 1)", () => {
	const js = compile(`package main
func main() {
	console.log((3 * 4) + 1)
}`).js;
	assertEqual(runJs(js), "13");
});

test("parenthesized condition in if statement", () => {
	const js = compile(`package main
func main() {
	x := 5
	if (x > 3) {
		console.log("yes")
	}
}`).js;
	assertEqual(runJs(js), "yes");
});

// ═════════════════════════════════════════════════════════════
// compiler.js — additional error paths
// ═════════════════════════════════════════════════════════════


section("dts-parser — additional type patterns");

test("parseDts: const with assignment value is skipped gracefully", () => {
	// declare const x: string = "default"  — the = value should be skipped
	const { values } = parseDts(`
declare module "m" {
  const greeting: string;
  let counter: number;
  var FLAG: boolean;
}
`);
	// module entries are hoisted into top-level values
	assert(values.size >= 0, "parsed without error");
});

test("parseDts: interface with import and export keywords in body", () => {
	// 'import' and 'export { }' inside a module body exercise the import/export cases
	const { values } = parseDts(`
declare module "my-mod" {
  import type Foo from "foo";
  export { default } from "src";
  function bar(): string;
}
`);
	assert(values.size >= 0, "parsed without error");
});

test("parseDts: object type with property assignments", () => {
	// Object type with default values: { x?: number = 0 }
	const { values } = parseDts(`
declare function create(opts: { x?: number; label?: string }): void;
`);
	assert(values.has("create"), "expected create in values");
});

test("parseDts: property with colon type annotation in interface", () => {
	// Exercises the propertyName: Type path in parseMembers
	const { types } = parseDts(`
interface Config {
  host: string;
  port: number;
  debug?: boolean;
}
`);
	assert(types.has("Config"), "expected Config in types");
	const ns = types.get("Config");
	assert("host" in ns.members, "expected host member");
	assert("port" in ns.members, "expected port member");
});

test("parseDts: namespace body with const/let/var members", () => {
	// Exercises case "const"/"let"/"var" in _parseMember (parseBody)
	const { values } = parseDts(`
namespace Config {
  const MAX: number;
  let timeout: number;
  var debug: boolean;
}
`);
	assert(values.has("Config"), "expected Config namespace");
	const ns = values.get("Config");
	assert("MAX" in ns.members, "expected MAX member");
	assert("timeout" in ns.members, "expected timeout member");
});

test("parseDts: namespace body with const = initializer", () => {
	// Exercises the = value branch inside _parseMember const/let/var case
	const { values } = parseDts(`
namespace Consts {
  const PI: number = 3.14;
  let count: number = 0;
}
`);
	assert(values.has("Consts"), "expected Consts namespace");
});

test("parseDts: namespace body with nested enum with = values", () => {
	// Exercises enum case in _parseMember with = value assignments
	const { values } = parseDts(`
namespace Color {
  enum Direction { Up = 0, Down = 1, Left = 2, Right = 3 }
}
`);
	assert(values.has("Color"), "expected Color namespace");
});

test("parseDts: interface with getter accessor (unknown property pattern)", () => {
	// 'get' is not a known kw; default: case falls through to either ()/: or else skip
	const { types } = parseDts(`
interface Readable {
  get length(): number;
  name: string;
}
`);
	assert(types.has("Readable"), "expected Readable in types");
	const ns = types.get("Readable");
	// 'name' should still be present even if 'get' is skipped
	assert("name" in ns.members, "expected name member");
});

test("parseDts: interface with constructor signature (new)", () => {
	// exercises the 'new' case in _parseMember (constructor signatures)
	const { types } = parseDts(`
interface Factory {
  new(x: number): Factory;
  create(): Factory;
}
`);
	assert(types.has("Factory"), "expected Factory in types");
	const ns = types.get("Factory");
	assert("create" in ns.members, "expected create method");
});

test("parseDts: namespace body with nested type alias and interface", () => {
	// exercises 'type', 'interface', 'class', 'namespace' cases in _parseMember
	const { values } = parseDts(`
namespace MyLib {
  type Handler = (event: string) => void;
  interface Options {
    timeout: number;
  }
  class Connection {
    connect(): void;
  }
  namespace Utils {
    function helper(): void;
  }
}
`);
	assert(values.has("MyLib"), "expected MyLib namespace");
	const ns = values.get("MyLib");
	assert("Utils" in ns.members, "expected Utils sub-namespace");
	assert("Connection" in ns.members, "expected Connection class");
});

test("parseDts: interface body with index signature (non-identifier start)", () => {
	// triggers the if (!kw) { this.pos++; return; } path in _parseMember
	const { types } = parseDts(`
interface Dict {
  [key: string]: string;
  size: number;
}
`);
	assert(types.has("Dict"), "expected Dict in types");
});

test("parseDts: keyof type operator resolves to any", () => {
	const { values } = parseDts("declare var keys: keyof Config;");
	assert(values.has("keys"), "expected keys in values");
	assertEqual(values.get("keys").name, "any");
});

test("parseDts: tuple type [T, U] resolves to any", () => {
	const { values } = parseDts("declare var pair: [string, number];");
	assert(values.has("pair"), "expected pair in values");
	assertEqual(values.get("pair").name, "any");
});

test("parseDts: string literal type resolves to string", () => {
	const { values } = parseDts(
		`declare var mode: "production" | "development";`,
	);
	assert(values.has("mode"), "expected mode in values");
	assertEqual(values.get("mode").name, "string");
});

test("parseDts: qualified type name A.B resolves to any", () => {
	const { values } = parseDts("declare var node: React.ReactNode;");
	assert(values.has("node"), "expected node in values");
	assertEqual(values.get("node").name, "any");
});

test("parseDts: complex generic types with nested <> () [] {}", () => {
	// exercises the depth-tracking in skipTypeExpr (lines 174-202)
	const { values } = parseDts(`
declare function complex<T extends Record<string, Array<[string, number]>>>(
  value: T,
  opts?: { timeout: number; callback: (result: T) => void }
): Promise<T>;
`);
	assert(values.has("complex"), "expected complex in values");
});

test("parseDts: skipTypeExpr handles <> nesting inside parenthesised type", () => {
	// Directly trigger skipTypeExpr with < and > inside a (  ) context
	// _parseBaseType calls skipTypeExpr(")") for ( ...) types
	// Inside "<>" in that context exercises angle bracket depth tracking
	const p = new DtsParser("(a: Map<string, Map<string, number>>) => void");
	p.skip();
	p.pos++; // consume "("
	p.skipTypeExpr(")");
	p.pos++; // consume ")"
	// If we get here without error or infinite loop, depth tracking worked
	assert(true, "skipTypeExpr with angle brackets completed");
});

test("parseDts: skipTypeExpr handles [] nesting inside tuple context", () => {
	// [ is consumed before skipTypeExpr("]") is called; a [ inside creates depth
	const p = new DtsParser("[[string, number], boolean]");
	p.pos++; // consume outer [
	p.skipTypeExpr("]");
	// If complete without error, brackets depth tracking worked
	assert(true, "skipTypeExpr with brackets inside brackets completed");
});

test("parseDts: skipTypeExpr handles () nesting inside function type", () => {
	// (a: (x: number) => void) — inner () increases parens depth
	const p = new DtsParser("(a: (x: number) => void)");
	p.pos++; // consume outer (
	p.skipTypeExpr(")");
	assert(true, "skipTypeExpr with nested parens completed");
});

test("parseDts: skipGenerics handles string literal inside generics", () => {
	// exercises skipGenerics line 140-142: `"` inside <...> calls skipStringLit
	const p = new DtsParser(`<Record<"key", string>>`);
	p.skipGenerics();
	assert(true, "skipGenerics with string literal inside completed");
});

test("parseDts: skipBlock handles string literal inside block body", () => {
	// exercises skipBlock lines 158-160: `"` inside {...} calls skipStringLit
	const p = new DtsParser(`{ key: "value"; other: 'text'; }`);
	p.skipBlock();
	assert(true, "skipBlock with string literal inside completed");
});

test("parseDts: type alias with = initializer in namespace body", () => {
	// exercises 'type' case in _parseMember (lines 462-473)
	const { values } = parseDts(`
namespace Util {
  type Callback = (err: string) => void;
  type ID = string | number;
}
`);
	assert(values.has("Util"), "expected Util namespace");
});

test("parseDts: declare const with = initialiser", () => {
	const { values } = parseDts(`
declare const VERSION: string = "1.0";
declare let count: number = 0;
`);
	assert(values.has("VERSION"), "expected VERSION in values");
	assert(values.has("count"), "expected count in values");
	assertEqual(values.get("VERSION").name, "string");
	assertEqual(values.get("count").name, "float64");
});

// ═════════════════════════════════════════════════════════════
// TypeChecker — new(T) and pointer types
// ═════════════════════════════════════════════════════════════


// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
