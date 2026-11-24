// GoFront test suite — `.d.ts` signatures
//
// Optional parameters, `T | null` / `T | undefined`, `Promise<T>`, function
// (callback) types and GoFront integer and float32 type names.

import { fileURLToPath } from "node:url";
import {
	assertContains,
	assertEqual,
	assertErrorContains,
	compileDts,
	parseDts,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

const DTS = `
interface Base { id: number; }
interface Child extends Base { name: string; }
interface Response { ok: boolean; text(): Promise<string>; }
declare function opt(a: number, b?: number): number;
declare function optRest(type: any, props?: any, ...children: any[]): void;
declare function get(key: string): string | null;
declare function getU(key: string): string | undefined;
declare function getN(key: string): null | string;
declare function both(key: string): string | null | undefined;
declare function nodes(): Base[] | null;
declare function takeNullable(s: string | null): void;
declare function fetchIt(url: string): Promise<Response>;
declare function wait(ms: number): Promise<void>;
declare function size(): Promise<number>;
declare function sized(a: int, b: uint32, c: float32, d: int64, e: uint8): int;
declare function ratio(): float32;
declare function listen(cb: (e: Base) => void): void;
declare function listenTwo(cb: (a: Base, b: string) => void): void;
declare function effect(fn: () => undefined | (() => void), deps?: any[]): void;
declare function later(cb: () => Promise<void>): void;
declare function laterNum(cb: () => Promise<number>): void;
declare function maybe(cb: (() => void) | null): void;
declare function produce(cb: () => string): void;
declare function anyArg(cb: (v: any) => void): void;
declare function ignore(cb: () => void): void;
`;

const compile = (body, dts = DTS) =>
	compileDts(
		dts,
		`package main

import "js:./types.d.ts"

${body}
`,
	);

section(".d.ts — optional parameters");

test("a call may omit optional parameters", () => {
	const { errors } = compile(`func main() {
	println(opt(1))
	println(opt(1, 2))
}`);
	assertEqual(errors.length, 0);
});

test("a call that leaves out a required parameter is rejected with its position", () => {
	const { errors } = compile(`func main() {
	println(opt())
}`);
	assertErrorContains(errors, "Too few arguments: expected at least 1, got 0");
	assertContains(errors[0].message, "at line 6:");
});

test("a call with too many arguments is rejected with its position", () => {
	const { errors } = compile(`func main() {
	println(opt(1, 2, 3))
}`);
	assertErrorContains(errors, "Too many arguments: expected at most 2, got 3");
	assertContains(errors[0].message, "at line 6:");
});

test("an optional parameter still has its type", () => {
	const { errors } = compile(`func main() {
	println(opt(1, "two"))
}`);
	assertErrorContains(errors, "as float64 value in argument to opt");
});

test("a rest parameter after an optional one", () => {
	const { errors } = compile(`func main() {
	optRest("div")
	optRest("div", nil)
	optRest("div", nil, 1, "x", true)
}`);
	assertEqual(errors.length, 0);
});

test("a rest parameter does not excuse a missing required parameter", () => {
	const { errors } = compile(`func main() {
	optRest()
}`);
	assertErrorContains(errors, "Too few arguments: expected at least 1, got 0");
});

test("a signature without optional parameters keeps its message", () => {
	const { errors } = compile(
		`func main() { f(1) }`,
		`declare function f(a: number, b: number): void;`,
	);
	assertErrorContains(errors, "Too few arguments: expected 2, got 1");
});

test("the optional marker is recorded on the func type", () => {
	const { values } = parseDts(DTS);
	assertEqual(values.get("opt").minArgs, 1);
	assertEqual(values.get("optRest").minArgs, 1);
	assertEqual(values.get("get").minArgs, undefined);
});

section(".d.ts — nullable types");

test("a string | null result compares to nil and works as a string", () => {
	const { js, errors } = compile(`func main() {
	raw := get("todos")
	if raw == nil {
		println("none")
		return
	}
	var s string = raw
	println(s + "!", len(raw))
}`);
	assertEqual(errors.length, 0);
	assertContains(js, "raw == null");
});

test("string | undefined, null | string and string | null | undefined are nullable", () => {
	const { errors } = compile(`func main() {
	println(getU("a") == nil, getN("a") == nil, both("a") == nil)
	var a string = getU("a")
	var b string = getN("a")
	var c string = both("a")
	println(a, b, c)
}`);
	assertEqual(errors.length, 0);
});

test("a nullable parameter accepts nil and a string", () => {
	const { errors } = compile(`func main() {
	takeNullable(nil)
	takeNullable("x")
}`);
	assertEqual(errors.length, 0);
});

test("a non-nullable string still rejects nil", () => {
	const { errors } = compile(
		`func main() { takeStr(nil) }`,
		`declare function takeStr(s: string): void;`,
	);
	assertErrorContains(errors, "cannot use nil as string value");
});

test("a nullable string is not a number", () => {
	const { errors } = compile(`func main() {
	var n float64 = get("a")
	println(n)
}`);
	assertErrorContains(errors, "as float64 value");
});

test("a nullable slice keeps its element type", () => {
	const { errors } = compile(`func main() {
	for _, n := range nodes() {
		var id float64 = n.id
		println(id)
	}
}`);
	assertEqual(errors.length, 0);
});

test("a result that is only null or undefined stays nil", () => {
	const { values } = parseDts(`declare function f(): null | undefined;`);
	assertEqual(values.get("f").returns[0].name, "nil");
});

section(".d.ts — Promise<T>");

test("await on Promise<Response> yields Response", () => {
	const { errors } = compile(`async func main() {
	r := await fetchIt("/x")
	var ok bool = r.ok
	text := await r.text()
	var s string = text
	println(ok, s)
}`);
	assertEqual(errors.length, 0);
});

test("await on Promise<number> yields float64", () => {
	const { errors } = compile(`async func main() {
	var n float64 = await size()
	println(n)
}`);
	assertEqual(errors.length, 0);
});

test("await on Promise<void> yields void", () => {
	const { errors } = compile(`async func main() {
	await wait(10)
	var n int = await wait(10)
	println(n)
}`);
	assertErrorContains(errors, "await wait(10) (value of type void) as int");
});

test("a Promise<T> is not a T before it is awaited", () => {
	const { errors } = compile(`async func main() {
	var r Response = fetchIt("/x")
	_ = r
}`);
	assertErrorContains(errors, "value of type Promise<Response>");
});

test("a wrongly typed await result is rejected", () => {
	const { errors } = compile(`async func main() {
	var s string = await size()
	println(s)
}`);
	assertErrorContains(errors, "as string value");
});

section(".d.ts — integer and float32 types");

test("int, uint32, float32, int64 and uint8 are accepted", () => {
	const { errors } = compile(`func main() {
	var a int = 1
	var b uint32 = 2
	var c float32 = 3
	var d int64 = 4
	var e uint8 = 5
	var r int = sized(a, b, c, d, e)
	var f float32 = ratio()
	println(r, f)
}`);
	assertEqual(errors.length, 0);
});

test("the declared integer type is strict", () => {
	const { errors } = compile(`func main() {
	var x float64 = 1
	println(sized(x, 1, 1, 1, 1))
}`);
	assertErrorContains(errors, "as int value in argument to sized");
});

test("number stays float64", () => {
	const { errors } = compile(`func main() {
	var n int = 1
	println(opt(n))
}`);
	assertErrorContains(errors, "as float64 value in argument to opt");
});

section(".d.ts — callback types");

test("an arrow function type parses to a func type", () => {
	const { values } = parseDts(DTS);
	const cb = values.get("listen").params[0];
	assertEqual(cb.kind, "func");
	assertEqual(cb.params.length, 1);
	assertEqual(cb.params[0].alias, "Base");
	assertEqual(values.get("effect").params[0].kind, "func");
	assertEqual(values.get("maybe").params[0].kind, "func");
	assertEqual(values.get("maybe").params[0]._nullable, true);
});

test("a callback accepts func(), func(any), func(Base) and func(Child)", () => {
	const { errors } = compile(`func main() {
	listen(func() {})
	listen(func(e any) {})
	listen(func(e Base) {})
	listen(func(e Child) {})
}`);
	assertEqual(errors.length, 0);
});

test("a callback rejects an unrelated parameter type", () => {
	const { errors } = compile(`func main() {
	listen(func(i int) {})
}`);
	assertErrorContains(errors, "as func(Base) void value in argument to listen");
});

test("a callback rejects more parameters than the caller passes", () => {
	const { errors } = compile(`func main() {
	listen(func(a, b Base) {})
}`);
	assertErrorContains(errors, "argument to listen");
});

test("a callback takes the leading parameters of a longer signature", () => {
	const { errors } = compile(`func main() {
	listenTwo(func() {})
	listenTwo(func(a Base) {})
	listenTwo(func(a Child, b string) {})
}`);
	assertEqual(errors.length, 0);
});

test("a callback rejects a wrong second parameter", () => {
	const { errors } = compile(`func main() {
	listenTwo(func(a Base, b int) {})
}`);
	assertErrorContains(errors, "argument to listenTwo");
});

test("a callback typed `() => undefined | (() => void)` takes func()", () => {
	const { errors } = compile(`func main() {
	effect(func() {})
	effect(func() {}, nil)
	effect(func() func() { return func() {} })
}`);
	assertEqual(errors.length, 0);
});

test("a callback returning Promise<void> takes an async func with no result", () => {
	const { errors } = compile(`func main() {
	later(func() {})
	later(async func() { await wait(1) })
}`);
	assertEqual(errors.length, 0);
});

test("a callback returning Promise<number> takes a func returning a number", () => {
	const { errors } = compile(`func main() {
	laterNum(func() float64 { return 1 })
}`);
	assertEqual(errors.length, 0);
});

test("a callback returning Promise<number> rejects a func with no result", () => {
	const { errors } = compile(`func main() {
	laterNum(func() {})
}`);
	assertErrorContains(errors, "argument to laterNum");
});

test("a callback returning Promise<void> rejects a func returning a value", () => {
	const { errors } = compile(`func main() {
	later(func() int { return 1 })
}`);
	assertErrorContains(errors, "argument to later");
});

test("a callback returning string rejects a func with no result", () => {
	const { errors } = compile(`func main() {
	produce(func() string { return "x" })
	produce(func() {})
}`);
	assertErrorContains(errors, "argument to produce");
});

test("a nullable callback accepts nil and a func", () => {
	const { errors } = compile(`func main() {
	maybe(nil)
	maybe(func() {})
}`);
	assertEqual(errors.length, 0);
});

test("a callback over any takes any parameter type", () => {
	const { errors } = compile(`func main() {
	anyArg(func(v int) {})
	anyArg(func(v string) {})
	anyArg(func(v any) {})
}`);
	assertEqual(errors.length, 0);
});

test("a void callback ignores the result of a func", () => {
	const { errors } = compile(`func main() {
	ignore(func() {})
	ignore(func() int { return 1 })
}`);
	assertEqual(errors.length, 0);
});

test("a callback value of a returned tuple is checked when called", () => {
	const { errors } = compile(
		`func main() {
	_, set := useState(1)
	set(2)
	set()
}`,
		`declare function useState(init: any): [state: any, setState: (value: any) => void];`,
	);
	assertErrorContains(errors, "Too few arguments: expected 1, got 0");
});

test("a Promise<T> and a .d.ts interface value reach json.Marshal", () => {
	const { js, errors } = compile(`import "encoding/json"
import "fmt"

func main() {
	p := size()
	b, err := json.Marshal(p)
	fmt.Println(string(b), err)
	var r Response = nil
	b, err = json.Marshal(r)
	fmt.Println(string(b), err)
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js, { size: () => Promise.resolve(1) });
	assertContains(out, "json: unsupported type");
	assertContains(out, "null <nil>");
});

test("a qualified type name keeps its qualifier", () => {
	const { values } = parseDts(`declare function f(t: dom.EventTarget): void;`);
	assertEqual(values.get("f").params[0].alias, "dom.EventTarget");
});

test("a type of a .d.ts namespace is named as ns.T", () => {
	const { errors } = compile(
		`func main() {
	var id float64 = mk().id
	println(id)
	println(mk().nope)
}`,
		`declare namespace N { interface T { id: number; } }
declare function mk(): N.T;`,
	);
	assertErrorContains(errors, "No member 'nope' in namespace T");
	assertEqual(errors.length, 1);
});

test("a parenthesized non-function type is the type it groups", () => {
	const { values } = parseDts(
		`declare function f(x: (string | number)[], y: string | number): void;`,
	);
	const { params } = values.get("f");
	assertEqual(params[0].kind, "slice");
	assertEqual(params[0].elem.name, params[1].name);
});

test("a parenthesized tuple in a return position stays a tuple", () => {
	const { values } = parseDts(`declare function g(): ([string, number]);`);
	assertEqual(
		JSON.stringify(values.get("g").returns),
		JSON.stringify([
			{ kind: "basic", name: "string" },
			{ kind: "basic", name: "float64" },
		]),
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
