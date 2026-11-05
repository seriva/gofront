// src/backend/wasm/stdlib/index.js
// Standard library emitters for the WebAssembly backend.
//
// Organized by domain:
// - core.js:   math, maps, strings, strconv, fmt, errors (As), testing
// - pure.js:   stateless utilities (unicode, crypto/rand)
// - io.js:     io constants/functions, readers/writers, fmt Fprint, synthetic IO methods

import { BINARY_MATH_IMPORTS, StdlibCoreEmitter } from "./core.js";
import { IoEmitter } from "./io.js";
import { PurePackagesEmitter } from "./pure.js";
import { SimdEmitter } from "./simd.js";

export {
	BINARY_MATH_IMPORTS,
	IoEmitter,
	PurePackagesEmitter,
	SimdEmitter,
	StdlibCoreEmitter,
};

export const stdlibEmitters = [
	StdlibCoreEmitter,
	PurePackagesEmitter,
	IoEmitter,
	SimdEmitter,
];
