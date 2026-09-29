// GoFront test suite — WebGL2, WebGPU, and TypedArray typings (Phase 5)

import {
	assert,
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("WebGL2 & WebGPU Typings (Phase 5)");

test("ArrayBuffer and DataView types and members compile without error", () => {
	const { errors, js } = compile(`package main

func main() {
	var ab ArrayBuffer
	bl := ab.byteLength
	ab2 := ab.slice(0, bl)
	_ = ab2

	var dv DataView
	buf := dv.buffer
	_ = buf
	val := dv.getFloat32(0, true)
	dv.setFloat32(0, val, true)
	i := dv.getInt32(0, false)
	dv.setInt32(0, i, false)
}`);
	assertEqual(errors.length, 0);
	assert(js.includes(".byteLength"));
	assert(js.includes(".getFloat32"));
});

test("Float32Array and other TypedArrays have standard members", () => {
	const { errors, js } = compile(`package main

func main() {
	var fa Float32Array
	l := fa.length
	bl := fa.byteLength
	buf := fa.buffer
	_ = l
	_ = bl
	_ = buf

	sub := fa.subarray(0, 2)
	_ = sub

	var u8 Uint8Array
	var u16 Uint16Array
	var u32 Uint32Array
	var i32 Int32Array
	_ = u8.length
	_ = u16.length
	_ = u32.length
	_ = i32.length
}`);
	assertEqual(errors.length, 0);
	assert(js.includes(".subarray"));
});

test("TypedArray slices have typed property and method access", () => {
	const { errors } = compile(`package main

func main() {
	s := make([]float32, 10)
	bl := s.byteLength
	_ = bl
	buf := s.buffer
	_ = buf
	sub := s.subarray(0, 5)
	_ = sub
}`);
	assertEqual(errors.length, 0);
});

test("Bidirectional assignability between []float32 and Float32Array", () => {
	const { errors } = compile(`package main

func main() {
	s := make([]float32, 4)
	var fa Float32Array = s
	var s2 []float32 = fa
	_ = s2
}`);
	assertEqual(errors.length, 0);
});

test("Type error when assigning mismatched TypedArray and slice", () => {
	const { errors } = compile(`package main

func main() {
	s := make([]float64, 4)
	var fa Float32Array = s
	_ = fa
}`);
	assert(errors.length > 0);
	assertErrorContains(errors, "Cannot assign []float64 to Float32Array");
});

test("WebGL constants are typed as int on context and global", () => {
	const { errors } = compile(`package main

func main() {
	var gl WebGLRenderingContext
	target := gl.ARRAY_BUFFER
	usage := gl.STATIC_DRAW
	mode := gl.TRIANGLES
	clearBit := gl.COLOR_BUFFER_BIT
	_ = target
	_ = usage
	_ = mode
	_ = clearBit

	c1 := WebGLRenderingContext.ARRAY_BUFFER
	c2 := WebGL2RenderingContext.STATIC_DRAW
	_ = c1
	_ = c2
}`);
	assertEqual(errors.length, 0);
});

test("WebGL2 rendering pipeline method calls typecheck cleanly", () => {
	const { errors, js } = compile(`package main

func main() {
	var gl WebGL2RenderingContext

	vShader := gl.CreateShader(gl.VERTEX_SHADER)
	gl.ShaderSource(vShader, "attribute vec4 a_pos; void main() { gl_Position = a_pos; }")
	gl.CompileShader(vShader)

	fShader := gl.CreateShader(gl.FRAGMENT_SHADER)
	gl.ShaderSource(fShader, "precision mediump float; void main() { gl_FragColor = vec4(1, 0, 0, 1); }")
	gl.CompileShader(fShader)

	prog := gl.CreateProgram()
	gl.AttachShader(prog, vShader)
	gl.AttachShader(prog, fShader)
	gl.LinkProgram(prog)
	gl.UseProgram(prog)

	vao := gl.CreateVertexArray()
	gl.BindVertexArray(vao)

	vbo := gl.CreateBuffer()
	gl.BindBuffer(gl.ARRAY_BUFFER, vbo)

	verts := []float32{-0.5, -0.5, 0.5, -0.5, 0.0, 0.5}
	gl.BufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW)

	posLoc := gl.GetAttribLocation(prog, "a_pos")
	gl.EnableVertexAttribArray(posLoc)
	gl.VertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

	gl.ClearColor(0.0, 0.0, 0.0, 1.0)
	gl.Clear(gl.COLOR_BUFFER_BIT)
	gl.DrawArrays(gl.TRIANGLES, 0, 3)
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("gl.createShader"), "PascalCase alias emits camelCase");
	assert(js.includes("gl.bufferData"));
	assert(js.includes("gl.drawArrays"));
	assert(!js.includes("gl.CreateShader"));
});

test("WebGL camelCase method aliases are supported", () => {
	const { errors } = compile(`package main

func main() {
	var gl WebGL2RenderingContext
	b := gl.createBuffer()
	gl.bindBuffer(gl.ARRAY_BUFFER, b)
	gl.clearColor(0.1, 0.2, 0.3, 1.0)
	gl.clear(gl.COLOR_BUFFER_BIT)
}`);
	assertEqual(errors.length, 0);
});

test("WebGL open interface allows unindexed extension methods without error", () => {
	const { errors } = compile(`package main

func main() {
	var gl WebGL2RenderingContext
	ext := gl.getExtension("WEBGL_compressed_texture_s3tc")
	_ = ext
}`);
	assertEqual(errors.length, 0);
});

test("WebGPU device and queue typings compile without error", () => {
	const { errors, js } = compile(`package main

func main() {
	var dev GPUDevice
	q := dev.queue
	q.Submit(nil)
	buf := dev.CreateBuffer(nil)
	_ = buf
}`);
	assertEqual(errors.length, 0);
	assert(js.includes("dev.queue"));
	assert(js.includes("q.submit"));
	assert(js.includes("dev.createBuffer"));
});

test("TypedArray buffer manipulation executes correctly at runtime", () => {
	const { js, errors } = compile(`package main

func main() {
	s := make([]float32, 4)
	s[0] = 1.5
	s[1] = 2.5
	sub := s.subarray(0, 2)
	println(int(s.byteLength), int(sub.length), int(s[0] + s[1]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "16 2 4");
});
