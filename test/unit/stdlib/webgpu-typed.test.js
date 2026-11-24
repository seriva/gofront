// GoFront test suite — the generated `gofront/webgpu` declarations
//
// WebGPU code is type-checked against the declarations generated from WebIDL
// (the `GPU` prefix is dropped: `webgpu.Device`, `webgpu.CanvasContext`).
// Assertions to those types are pass-throughs: a standard browser device, or a
// test double with only some members, passes `x.(webgpu.Device)`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	assertErrorContains,
	compileDir,
	parseDts,
	runJs,
	section,
	summarize,
	test,
	toCompileResult,
	withTempDir,
} from "../helpers.js";

// Compiles `body` (the declarations of a `package main` that imports
// `gofront/webgpu`, and `gofront/dom` with `dom`) against the real stdlib.
function build(body, { dom = false } = {}) {
	const imports = `${dom ? 'import "gofront/dom"\n' : ""}import "gofront/webgpu"`;
	return withTempDir(
		{ "main.go": `package main\n\n${imports}\n\n${body}\n` },
		(dir) => toCompileResult(() => compileDir(dir)),
	);
}

section("gofront/webgpu — types");

test("the canvas context, buffer and texture are typed", () => {
	const { errors } = build(
		`func frame(ctx webgpu.CanvasContext, dev webgpu.Device) int {
	ctx.configure(map[string]any{"device": dev, "format": "bgra8unorm"})
	var tex webgpu.Texture = ctx.getCurrentTexture()
	view := tex.createView()
	_ = view
	var buf webgpu.Buffer = dev.createBuffer(map[string]any{"size": 64, "usage": 8})
	buf.destroy()
	return tex.width + buf.size
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("the parenthesised union lists parse to their element types", () => {
	const { types } = parseDts(
		readFileSync(
			new URL("../../../stdlib/gofront/webgpu/webgpu.d.ts", import.meta.url),
			"utf8",
		),
	);
	const elem = (iface, member) => {
		const t = types.get(iface).members[member];
		assertEqual(t.kind, "slice");
		return t.elem;
	};
	assertEqual(elem("FragmentState", "targets").alias, "ColorTargetState");
	assertEqual(
		elem("PipelineLayoutDescriptor", "bindGroupLayouts").alias,
		"BindGroupLayout",
	);
	assertEqual(
		elem("RenderPassDescriptor", "colorAttachments").alias,
		"RenderPassColorAttachment",
	);
	assertEqual(elem("RenderPassLayout", "colorFormats").name, "string");
	assertEqual(elem("VertexState", "buffers").alias, "VertexBufferLayout");
});

test("createRenderPipeline takes a dictionary", () => {
	const { errors } = build(
		`func pipeline(dev webgpu.Device, mod webgpu.ShaderModule) webgpu.RenderPipeline {
	return dev.createRenderPipeline(map[string]any{
		"layout": "auto",
		"vertex": map[string]any{"module": mod, "entryPoint": "vs"},
		"fragment": map[string]any{
			"module":  mod,
			"targets": []webgpu.ColorTargetState{map[string]any{"format": "bgra8unorm"}},
		},
	})
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("createRenderPipeline rejects targets that are a slice of any", () => {
	const { errors } = build(
		`func pipeline(dev webgpu.Device, mod webgpu.ShaderModule) webgpu.RenderPipeline {
	return dev.createRenderPipeline(map[string]any{
		"layout": "auto",
		"vertex": map[string]any{"module": mod, "entryPoint": "vs"},
		"fragment": map[string]any{
			"module":  mod,
			"targets": []any{map[string]any{"format": "bgra8unorm"}},
		},
	})
}

func main() {}`,
	);
	assertErrorContains(errors, "as []webgpu.ColorTargetState value");
});

test("createRenderPipeline checks the keys of each target", () => {
	const { errors } = build(
		`func pipeline(dev webgpu.Device, mod webgpu.ShaderModule) webgpu.RenderPipeline {
	return dev.createRenderPipeline(map[string]any{
		"layout": "auto",
		"vertex": map[string]any{"module": mod, "entryPoint": "vs"},
		"fragment": map[string]any{
			"module":  mod,
			"targets": []webgpu.ColorTargetState{map[string]any{"formt": "bgra8unorm"}},
		},
	})
}

func main() {}`,
	);
	assertErrorContains(errors, "formt");
});

test("queue.submit takes a slice of command buffers", () => {
	const { errors } = build(
		`func frame(dev webgpu.Device) {
	enc := dev.createCommandEncoder()
	dev.queue.submit([]webgpu.CommandBuffer{enc.finish()})
}

func main() {}`,
	);
	assertEqual(errors.map((e) => e.message).join(), "");
});

test("queue.submit rejects a slice of any", () => {
	const { errors } = build(
		`func frame(dev webgpu.Device) {
	enc := dev.createCommandEncoder()
	dev.queue.submit([]any{enc.finish()})
}

func main() {}`,
	);
	assertErrorContains(errors, "as []webgpu.CommandBuffer value");
});

test("createBindGroupLayout takes typed entries and rejects a slice of any", () => {
	const ok = build(
		`func f(dev webgpu.Device) {
	dev.createBindGroupLayout(map[string]any{
		"entries": []webgpu.BindGroupLayoutEntry{map[string]any{"binding": 0, "visibility": 1}},
	})
}

func main() {}`,
	);
	assertEqual(ok.errors.map((e) => e.message).join(), "");
	const bad = build(
		`func f(dev webgpu.Device) {
	dev.createBindGroupLayout(map[string]any{
		"entries": []any{map[string]any{"binding": 0}},
	})
}

func main() {}`,
	);
	assertErrorContains(bad.errors, "as []webgpu.BindGroupLayoutEntry value");
});

test("a dictionary member that does not exist is rejected", () => {
	const { errors } = build(
		`func pipeline(dev webgpu.Device, mod webgpu.ShaderModule) {
	dev.createRenderPipeline(map[string]any{
		"layout": "auto",
		"vertex": map[string]any{"module": mod, "entrypoint": "vs"},
	})
}

func main() {}`,
	);
	assertErrorContains(errors, "entrypoint");
});

test("a dictionary member of the wrong type is rejected", () => {
	const { errors } = build(
		`func f(dev webgpu.Device) {
	dev.createBuffer(map[string]any{"size": "big", "usage": 8})
}

func main() {}`,
	);
	assertErrorContains(errors, "member size");
});

test("the queue submits and writes buffers", () => {
	const { errors } = build(
		`func f(dev webgpu.Device, buf webgpu.Buffer, data any) {
	dev.queue.submit(nil)
	dev.queue.writeBuffer(buf, 0, data)
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("an adapter's device is awaited as a webgpu.Device", () => {
	const { errors } = build(
		`func f(a webgpu.Adapter) webgpu.Device {
	return await a.requestDevice()
}

func main() {}`,
	);
	assertEqual(errors.length, 0);
});

test("a device is an event target", () => {
	const { errors } = build(
		`func f(dev webgpu.Device) {
	dev.addEventListener("uncapturederror", func(e dom.Event) { _ = e.type })
}

func main() {}`,
		{ dom: true },
	);
	assertEqual(errors.length, 0);
});

test("a misspelled member fails the check", () => {
	const { errors } = build(
		`func f(dev webgpu.Device) {
	dev.createBufer(nil)
}

func main() {}`,
	);
	assertErrorContains(errors, "createBufer");
});

test("the PascalCase aliases of the old built-in types are gone", () => {
	const { errors } = build(
		`func f(dev webgpu.Device) {
	dev.CreateBuffer(nil)
}

func main() {}`,
	);
	assertErrorContains(errors, "CreateBuffer");
});

test("GPUDevice is an unknown type", () => {
	const { errors } = build(`func f(d GPUDevice) {}

func main() {}`);
	assertErrorContains(errors, "GPUDevice");
});

test("GPUQueue and GPUAdapter are unknown types", () => {
	for (const name of ["GPUQueue", "GPUAdapter"]) {
		const { errors } = build(`func f(d ${name}) {}

func main() {}`);
		assertErrorContains(errors, name);
	}
});

section("gofront/webgpu — assertions");

test("a test double with only standard members passes the assertion", () => {
	const { res, errors } = build(
		`func main() {
	var x any = JSON.parse("{\\"label\\": \\"double\\", \\"createBuffer\\": null}")
	dev := x.(webgpu.Device)
	println(dev.label)
}`,
	);
	assertEqual(errors.length, 0);
	assertEqual(runJs(res.js), "double");
});

test("the assertion emits no structural runtime check", () => {
	const { res, errors } = build(
		`func use(x any) webgpu.Device {
	return x.(webgpu.Device)
}

func main() {
	println("ok")
}`,
	);
	assertEqual(errors.length, 0);
	assert(!/typeof/.test(res.js), "emitted a runtime check");
	assert(!/\bimport\b/.test(res.js), "emitted an import");
	assert(!res.js.includes("gofront/webgpu"), "mentions the package");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
