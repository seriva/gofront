// src/backend/wasm/stdlib/index.js
// Standard library emitters for the WebAssembly backend.
//
// Organized by domain:
// - core.js:   math, maps, strings, strconv, fmt, errors (As), testing
// - pure.js:   stateless utilities (unicode, crypto/rand)
// - io.js:     io constants/functions, readers/writers, fmt Fprint/Sscan, synthetic IO methods
// - time.js:   time package (Duration, Time struct, components, Format/Parse, clock)

import { BINARY_MATH_IMPORTS, StdlibCoreEmitter } from "./core.js";
import { IoEmitter } from "./io.js";
import { ExtendedPackagesEmitter } from "./packages.js";
import { PurePackagesEmitter } from "./pure.js";
import { SimdEmitter } from "./simd.js";
import { TimeEmitter } from "./time.js";

export {
	BINARY_MATH_IMPORTS,
	ExtendedPackagesEmitter,
	IoEmitter,
	PurePackagesEmitter,
	SimdEmitter,
	StdlibCoreEmitter,
	TimeEmitter,
};

export const stdlibEmitters = [
	StdlibCoreEmitter,
	PurePackagesEmitter,
	IoEmitter,
	TimeEmitter,
	ExtendedPackagesEmitter,
	SimdEmitter,
];
