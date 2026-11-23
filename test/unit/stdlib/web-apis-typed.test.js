// GoFront test suite — the generated `gofront/canvas`, `gofront/fetch` and
// `gofront/websocket` declarations
//
// Canvas drawing, Fetch responses and WebSocket connections are type-checked
// against the declarations generated from WebIDL, and the declarations emit
// no runtime code.

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compileDir,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

// Compiles `body` (the declarations of a `package main`) importing `pkgs`
// against the real stdlib.
function build(pkgs, body) {
	const imports = pkgs.map((p) => `import "gofront/${p}"`).join("\n");
	return withTempDir(
		{ "main.go": `package main\n\n${imports}\n\n${body}\n` },
		(dir) => toCompileResult(() => compileDir(dir)),
	);
}

section("gofront/canvas");

test("a 2D context draws without any", () => {
	const { errors } = build(
		["canvas"],
		`func draw(ctx canvas.CanvasRenderingContext2D, w float64) {
	ctx.clearRect(0, 0, w, 100)
	ctx.fillStyle = "red"
	ctx.beginPath()
	ctx.arc(50, 50, 10, 0, 6.28)
	ctx.fill()
	ctx.lineWidth = 2
	ctx.strokeRect(1, 2, 3, 4)
	ctx.fillText("hi", 10, 20)
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("getContext asserts to the 2D context", () => {
	const { errors } = build(
		["dom", "canvas"],
		`func ctxOf(c dom.HTMLCanvasElement) canvas.CanvasRenderingContext2D {
	return c.getContext("2d").(canvas.CanvasRenderingContext2D)
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("the context's canvas is a typed element", () => {
	const { errors } = build(
		["canvas"],
		`func f(ctx canvas.CanvasRenderingContext2D) int {
	var w int = ctx.canvas.width
	return w
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("a misspelled canvas member is rejected", () => {
	const { errors } = build(
		["canvas"],
		`func f(ctx canvas.CanvasRenderingContext2D) {
	ctx.fillRectangle(0, 0, 1, 1)
}

func main() {}`,
	);
	assertErrorContains(errors, "fillRectangle");
});

test("a canvas call with the wrong argument type is rejected", () => {
	const { errors } = build(
		["canvas"],
		`func f(ctx canvas.CanvasRenderingContext2D) {
	ctx.fillRect("a", 0, 1, 1)
}

func main() {}`,
	);
	assertErrorContains(errors, "string");
});

section("gofront/fetch");

test("a response is read through ok, status and text", () => {
	const { errors } = build(
		["fetch"],
		`func load(url string) string {
	resp := (await fetch(url)).(fetch.Response)
	if !resp.ok {
		return ""
	}
	var status int = resp.status
	_ = status
	return await resp.text()
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("var resp fetch.Response holds a response", () => {
	const { errors } = build(
		["fetch"],
		`func load(url string) bool {
	var resp fetch.Response = (await fetch(url)).(fetch.Response)
	return resp.ok
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("a response member that does not exist is rejected", () => {
	const { errors } = build(
		["fetch"],
		`func f(r fetch.Response) bool {
	return r.isOk
}

func main() {}`,
	);
	assertErrorContains(errors, "isOk");
});

test("the text of a response is a string", () => {
	const { errors } = build(
		["fetch"],
		`func f(r fetch.Response) int {
	var n int = await r.text()
	return n
}

func main() {}`,
	);
	assertErrorContains(errors, "string");
});

test("headers are read through get", () => {
	const { errors } = build(
		["fetch"],
		`func f(r fetch.Response) string {
	v := r.headers.get("content-type")
	if v == nil {
		return ""
	}
	return v
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("an unaliased import still lets the global fetch be called", () => {
	const { errors } = build(
		["fetch"],
		`func load(url string) fetch.Response {
	return (await fetch(url)).(fetch.Response)
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("an unaliased import emits the global fetch call", () => {
	const { res, errors } = withTempDir(
		{
			"main.go": `package main

import "gofront/fetch"

func load(url string) bool {
	resp := (await fetch(url)).(fetch.Response)
	return resp.ok
}

func main() {
	println(load("/x"))
}
`,
		},
		(dir) => toCompileResult(() => compileDir(dir)),
	);
	assertEqual(errors.length, 0);
	assert(/await fetch\(url\)/.test(res.js), res.js);
});

test("a member the unaliased fetch package lacks is rejected", () => {
	const { errors } = build(
		["fetch"],
		`func f() {
	var r fetch.NoSuchType
	_ = r
}

func main() {}`,
	);
	assertErrorContains(errors, "NoSuchType");
});

test("an aliased import keeps fetch as the global function", () => {
	const { errors } = withTempDir(
		{
			"main.go": `package main

import fapi "gofront/fetch"

func load(url string) fapi.Response {
	return (await fetch(url)).(fapi.Response)
}

func main() {}
`,
		},
		(dir) => toCompileResult(() => compileDir(dir)),
	);
	assertEqual(errors.length, 0);
});

section("gofront/websocket");

test("a socket sends and takes a typed listener", () => {
	const { errors } = build(
		["dom", "websocket"],
		`func f(ws websocket.WebSocket) {
	ws.send("hello")
	ws.addEventListener("message", func(e dom.MessageEvent) { _ = e.data })
	ws.addEventListener("close", func() {})
	ws.close()
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("a socket state is an int", () => {
	const { errors } = build(
		["websocket"],
		`func f(ws websocket.WebSocket) bool {
	return ws.readyState == ws.OPEN
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("a misspelled socket member is rejected", () => {
	const { errors } = build(
		["websocket"],
		`func f(ws websocket.WebSocket) {
	ws.sendMessage("x")
}

func main() {}`,
	);
	assertErrorContains(errors, "sendMessage");
});

test("a socket does not take a listener with an unrelated parameter", () => {
	const { errors } = build(
		["websocket"],
		`func f(ws websocket.WebSocket) {
	ws.addEventListener("message", func(n int) {})
}

func main() {}`,
	);
	assertErrorContains(errors, "as func(dom.Event) void value");
});

section("web packages — emitted code");

test("the declarations emit no runtime code", () => {
	const { res, errors } = build(
		["canvas", "fetch", "websocket"],
		`func f(ctx canvas.CanvasRenderingContext2D, r fetch.Response, ws websocket.WebSocket) bool {
	ctx.fillRect(0, 0, 1, 1)
	ws.send("x")
	return r.ok
}

func main() {
	println("ok")
}`,
	);
	assertEqual(errors.length, 0);
	assert(!/\bimport\b/.test(res.js), "emitted an import");
	assert(
		!/gofront|canvas\.|fetch\.|websocket\./.test(res.js),
		"mentions a package",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
