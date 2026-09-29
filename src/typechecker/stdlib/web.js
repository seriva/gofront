// WebGL, WebGPU, and TypedArray standard library type definitions.

import {
	ANY,
	BOOL,
	FLOAT32,
	FLOAT64,
	INT,
	INT8,
	INT16,
	INT32,
	STRING,
	UINT8,
	UINT16,
	UINT32,
	VOID,
} from "../types.js";

const func = (params, returns = [VOID], variadic = false) => ({
	kind: "func",
	params,
	returns,
	variadic,
});

const WEBGL_CONSTANTS_LIST = {
	ARRAY_BUFFER: 0x8892,
	ELEMENT_ARRAY_BUFFER: 0x8893,
	UNIFORM_BUFFER: 0x8a11,
	STATIC_DRAW: 0x88e4,
	DYNAMIC_DRAW: 0x88e8,
	STREAM_DRAW: 0x88e0,
	FLOAT: 0x1406,
	UNSIGNED_SHORT: 0x1403,
	UNSIGNED_BYTE: 0x1401,
	UNSIGNED_INT: 0x1405,
	BYTE: 0x1400,
	SHORT: 0x1402,
	INT: 0x1404,
	HALF_FLOAT: 0x140b,
	TRIANGLES: 0x0004,
	TRIANGLE_STRIP: 0x0005,
	TRIANGLE_FAN: 0x0006,
	LINES: 0x0001,
	LINE_STRIP: 0x0003,
	LINE_LOOP: 0x0002,
	POINTS: 0x0000,
	COLOR_BUFFER_BIT: 0x00004000,
	DEPTH_BUFFER_BIT: 0x00000100,
	STENCIL_BUFFER_BIT: 0x00000400,
	DEPTH_TEST: 0x0b71,
	BLEND: 0x0be2,
	CULL_FACE: 0x0b44,
	VERTEX_SHADER: 0x8b31,
	FRAGMENT_SHADER: 0x8b30,
	COMPILE_STATUS: 0x8b81,
	LINK_STATUS: 0x8b82,
	VALIDATE_STATUS: 0x8b83,
	RGBA: 0x1908,
	RGB: 0x1907,
	ALPHA: 0x1906,
	LUMINANCE: 0x1909,
	RGBA8: 0x8058,
	RGBA32F: 0x8814,
	TEXTURE_2D: 0x0de1,
	TEXTURE_CUBE_MAP: 0x8513,
	TEXTURE0: 0x84c0,
	TEXTURE_MIN_FILTER: 0x2801,
	TEXTURE_MAG_FILTER: 0x2800,
	TEXTURE_WRAP_S: 0x2802,
	TEXTURE_WRAP_T: 0x2803,
	NEAREST: 0x2600,
	LINEAR: 0x2601,
	NEAREST_MIPMAP_NEAREST: 0x2700,
	LINEAR_MIPMAP_NEAREST: 0x2701,
	NEAREST_MIPMAP_LINEAR: 0x2702,
	LINEAR_MIPMAP_LINEAR: 0x2703,
	REPEAT: 0x2901,
	CLAMP_TO_EDGE: 0x812f,
	MIRRORED_REPEAT: 0x8370,
	BACK: 0x0405,
	FRONT: 0x0404,
	FRONT_AND_BACK: 0x0408,
	CW: 0x0900,
	CCW: 0x0901,
	LESS: 0x0201,
	LEQUAL: 0x0203,
	GREATER: 0x0204,
	GEQUAL: 0x0206,
	EQUAL: 0x0202,
	NOTEQUAL: 0x0205,
	ALWAYS: 0x0207,
	NEVER: 0x0200,
	SRC_ALPHA: 0x0302,
	ONE_MINUS_SRC_ALPHA: 0x0303,
	ONE: 1,
	ZERO: 0,
	FRAMEBUFFER: 0x8d40,
	RENDERBUFFER: 0x8d41,
	COLOR_ATTACHMENT0: 0x8ce0,
	DEPTH_ATTACHMENT: 0x8d00,
	FRAMEBUFFER_COMPLETE: 0x8cd5,
};

function buildArrayBufferType() {
	const fields = new Map([["byteLength", INT]]);
	const methods = new Map();
	const named = { kind: "named", name: "ArrayBuffer", underlying: null };
	const iface = {
		kind: "interface",
		name: "ArrayBuffer",
		fields,
		methods,
	};
	named.underlying = iface;
	methods.set("slice", func([INT, INT], [named]));
	return named;
}

function buildDataViewType(arrayBufferType) {
	const fields = new Map([
		["buffer", arrayBufferType],
		["byteLength", INT],
		["byteOffset", INT],
	]);
	const methods = new Map([
		["getInt8", func([INT], [INT8])],
		["getUint8", func([INT], [UINT8])],
		["getInt16", func([INT, BOOL], [INT16])],
		["getUint16", func([INT, BOOL], [UINT16])],
		["getInt32", func([INT, BOOL], [INT32])],
		["getUint32", func([INT, BOOL], [UINT32])],
		["getFloat32", func([INT, BOOL], [FLOAT32])],
		["getFloat64", func([INT, BOOL], [FLOAT64])],
		["setInt8", func([INT, INT8])],
		["setUint8", func([INT, UINT8])],
		["setInt16", func([INT, INT16, BOOL])],
		["setUint16", func([INT, UINT16, BOOL])],
		["setInt32", func([INT, INT32, BOOL])],
		["setUint32", func([INT, UINT32, BOOL])],
		["setFloat32", func([INT, FLOAT32, BOOL])],
		["setFloat64", func([INT, FLOAT64, BOOL])],
	]);
	const named = { kind: "named", name: "DataView", underlying: null };
	named.underlying = { kind: "interface", name: "DataView", fields, methods };
	return named;
}

function buildTypedArrayType(name, elemType, arrayBufferType) {
	const fields = new Map([
		["buffer", arrayBufferType],
		["byteLength", INT],
		["byteOffset", INT],
		["length", INT],
	]);
	const methods = new Map();
	const named = { kind: "named", name, underlying: null };
	const iface = {
		kind: "interface",
		name,
		fields,
		methods,
		_elemType: elemType,
		_isTypedArray: true,
	};
	named.underlying = iface;
	methods.set("subarray", func([INT, INT], [named]));
	methods.set("slice", func([INT, INT], [named]));
	methods.set("set", func([ANY, INT], [VOID]));
	return named;
}

function createWebGLMethods() {
	const methods = new Map();
	const add = (name, fn) => {
		methods.set(name, fn);
		const camel = name[0].toLowerCase() + name.slice(1);
		if (camel !== name) methods.set(camel, fn);
	};

	// Buffer operations
	add("BufferData", func([INT, ANY, INT]));
	add("BufferSubData", func([INT, INT, ANY]));
	add("CreateBuffer", func([], [ANY]));
	add("BindBuffer", func([INT, ANY]));
	add("DeleteBuffer", func([ANY]));
	add("VertexAttribPointer", func([INT, INT, INT, BOOL, INT, INT]));
	add("VertexAttribIPointer", func([INT, INT, INT, INT, INT]));
	add("EnableVertexAttribArray", func([INT]));
	add("DisableVertexAttribArray", func([INT]));

	// Shaders and programs
	add("CreateShader", func([INT], [ANY]));
	add("ShaderSource", func([ANY, STRING]));
	add("CompileShader", func([ANY]));
	add("GetShaderParameter", func([ANY, INT], [ANY]));
	add("GetShaderInfoLog", func([ANY], [STRING]));
	add("DeleteShader", func([ANY]));
	add("CreateProgram", func([], [ANY]));
	add("AttachShader", func([ANY, ANY]));
	add("DetachShader", func([ANY, ANY]));
	add("LinkProgram", func([ANY]));
	add("GetProgramParameter", func([ANY, INT], [ANY]));
	add("GetProgramInfoLog", func([ANY], [STRING]));
	add("UseProgram", func([ANY]));
	add("DeleteProgram", func([ANY]));

	// Uniforms and attributes
	add("GetUniformLocation", func([ANY, STRING], [ANY]));
	add("GetAttribLocation", func([ANY, STRING], [INT]));
	add("Uniform1f", func([ANY, FLOAT64]));
	add("Uniform2f", func([ANY, FLOAT64, FLOAT64]));
	add("Uniform3f", func([ANY, FLOAT64, FLOAT64, FLOAT64]));
	add("Uniform4f", func([ANY, FLOAT64, FLOAT64, FLOAT64, FLOAT64]));
	add("Uniform1i", func([ANY, INT]));
	add("Uniform2i", func([ANY, INT, INT]));
	add("Uniform3i", func([ANY, INT, INT, INT]));
	add("Uniform4i", func([ANY, INT, INT, INT, INT]));
	add("Uniform1fv", func([ANY, ANY]));
	add("Uniform2fv", func([ANY, ANY]));
	add("Uniform3fv", func([ANY, ANY]));
	add("Uniform4fv", func([ANY, ANY]));
	add("Uniform1iv", func([ANY, ANY]));
	add("Uniform2iv", func([ANY, ANY]));
	add("Uniform3iv", func([ANY, ANY]));
	add("Uniform4iv", func([ANY, ANY]));
	add("UniformMatrix2fv", func([ANY, BOOL, ANY]));
	add("UniformMatrix3fv", func([ANY, BOOL, ANY]));
	add("UniformMatrix4fv", func([ANY, BOOL, ANY]));

	// Viewport, clear, draw
	add("Viewport", func([INT, INT, INT, INT]));
	add("ClearColor", func([FLOAT64, FLOAT64, FLOAT64, FLOAT64]));
	add("ClearDepth", func([FLOAT64]));
	add("Clear", func([INT]));
	add("DrawArrays", func([INT, INT, INT]));
	add("DrawElements", func([INT, INT, INT, INT]));
	add("DrawArraysInstanced", func([INT, INT, INT, INT]));
	add("DrawElementsInstanced", func([INT, INT, INT, INT, INT]));
	add("Enable", func([INT]));
	add("Disable", func([INT]));
	add("CullFace", func([INT]));
	add("FrontFace", func([INT]));
	add("DepthFunc", func([INT]));
	add("DepthMask", func([BOOL]));
	add("BlendFunc", func([INT, INT]));
	add("BlendFuncSeparate", func([INT, INT, INT, INT]));
	add("Flush", func([]));
	add("Finish", func([]));

	// Textures
	add("CreateTexture", func([], [ANY]));
	add("BindTexture", func([INT, ANY]));
	add("DeleteTexture", func([ANY]));
	add("TexParameteri", func([INT, INT, INT]));
	add("TexParameterf", func([INT, INT, FLOAT64]));
	add(
		"TexImage2D",
		func([INT, INT, INT, INT, INT, INT, INT, INT, ANY], [VOID], true),
	);
	add("GenerateMipmap", func([INT]));
	add("ActiveTexture", func([INT]));

	// WebGL2 VAOs
	add("CreateVertexArray", func([], [ANY]));
	add("BindVertexArray", func([ANY]));
	add("DeleteVertexArray", func([ANY]));

	// Framebuffers
	add("CreateFramebuffer", func([], [ANY]));
	add("BindFramebuffer", func([INT, ANY]));
	add("DeleteFramebuffer", func([ANY]));
	add("FramebufferTexture2D", func([INT, INT, INT, ANY, INT]));
	add("CheckFramebufferStatus", func([INT], [INT]));

	return methods;
}

function createWebGPUMethods() {
	const queueMethods = new Map();
	const addQueue = (name, fn) => {
		queueMethods.set(name, fn);
		const camel = name[0].toLowerCase() + name.slice(1);
		if (camel !== name) queueMethods.set(camel, fn);
	};
	addQueue("Submit", func([ANY]));
	addQueue("WriteBuffer", func([ANY, INT, ANY]));

	const deviceMethods = new Map();
	const addDev = (name, fn) => {
		deviceMethods.set(name, fn);
		const camel = name[0].toLowerCase() + name.slice(1);
		if (camel !== name) deviceMethods.set(camel, fn);
	};
	addDev("CreateBuffer", func([ANY], [ANY]));
	addDev("CreateShaderModule", func([ANY], [ANY]));
	addDev("CreateRenderPipeline", func([ANY], [ANY]));
	addDev("CreateComputePipeline", func([ANY], [ANY]));
	addDev("CreateCommandEncoder", func([ANY], [ANY]));
	addDev("CreateBindGroup", func([ANY], [ANY]));
	addDev("CreateBindGroupLayout", func([ANY], [ANY]));
	addDev("CreatePipelineLayout", func([ANY], [ANY]));

	const adapterMethods = new Map();
	const addAdapt = (name, fn) => {
		adapterMethods.set(name, fn);
		const camel = name[0].toLowerCase() + name.slice(1);
		if (camel !== name) adapterMethods.set(camel, fn);
	};
	addAdapt("RequestDevice", func([ANY], [ANY]));

	return { queueMethods, deviceMethods, adapterMethods };
}

export function setupWebGlobals(globals, types) {
	const arrayBuffer = buildArrayBufferType();
	const dataView = buildDataViewType(arrayBuffer);

	const typedArrays = [
		["Float32Array", FLOAT32],
		["Float64Array", FLOAT64],
		["Int8Array", INT8],
		["Int16Array", INT16],
		["Int32Array", INT32],
		["Uint8Array", UINT8],
		["Uint16Array", UINT16],
		["Uint32Array", UINT32],
		["Uint8ClampedArray", UINT8],
	].map(([name, elem]) => buildTypedArrayType(name, elem, arrayBuffer));

	types.set("ArrayBuffer", arrayBuffer);
	types.set("DataView", dataView);
	globals.define("ArrayBuffer", arrayBuffer);
	globals.define("DataView", dataView);

	for (const ta of typedArrays) {
		types.set(ta.name, ta);
		globals.define(ta.name, ta);
	}

	// WebGL constants map
	const constFields = new Map();
	for (const [k] of Object.entries(WEBGL_CONSTANTS_LIST)) {
		constFields.set(k, INT);
	}

	const webglMethods = createWebGLMethods();
	const webglContext = {
		kind: "named",
		name: "WebGLRenderingContext",
		underlying: {
			kind: "interface",
			name: "WebGLRenderingContext",
			fields: constFields,
			methods: webglMethods,
			_isOpen: true,
		},
	};
	const webgl2Context = {
		kind: "named",
		name: "WebGL2RenderingContext",
		underlying: {
			kind: "interface",
			name: "WebGL2RenderingContext",
			fields: constFields,
			methods: webglMethods,
			_isOpen: true,
		},
	};

	types.set("WebGLRenderingContext", webglContext);
	types.set("WebGL2RenderingContext", webgl2Context);
	globals.define("WebGLRenderingContext", webglContext);
	globals.define("WebGL2RenderingContext", webgl2Context);

	// WebGPU types
	const { queueMethods, deviceMethods, adapterMethods } = createWebGPUMethods();
	const gpuQueue = {
		kind: "named",
		name: "GPUQueue",
		underlying: {
			kind: "interface",
			name: "GPUQueue",
			fields: new Map(),
			methods: queueMethods,
			_isOpen: true,
		},
	};
	const gpuDevice = {
		kind: "named",
		name: "GPUDevice",
		underlying: {
			kind: "interface",
			name: "GPUDevice",
			fields: new Map([["queue", gpuQueue]]),
			methods: deviceMethods,
			_isOpen: true,
		},
	};
	const gpuAdapter = {
		kind: "named",
		name: "GPUAdapter",
		underlying: {
			kind: "interface",
			name: "GPUAdapter",
			fields: new Map(),
			methods: adapterMethods,
			_isOpen: true,
		},
	};

	types.set("GPUQueue", gpuQueue);
	types.set("GPUDevice", gpuDevice);
	types.set("GPUAdapter", gpuAdapter);
	globals.define("GPUQueue", gpuQueue);
	globals.define("GPUDevice", gpuDevice);
	globals.define("GPUAdapter", gpuAdapter);
}
