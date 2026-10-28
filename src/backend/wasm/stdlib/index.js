// src/backend/wasm/stdlib/index.js
// Standard library emitters for the WebAssembly backend.
//
// Organized by domain:
// - core.js:   math, math/bits, maps, slices, strings, strconv, fmt, errors, sort, unicode/utf8, testing
// - bytes.js:  bytes package functions and bytes.Buffer methods
// - pure.js:   stateless utilities (unicode, math/rand, html, path/filepath)
// - io.js:     io constants/functions, readers/writers, fmt Fprint/Sscan, synthetic IO methods
// - time.js:   time package (Duration, Time struct, components, Format/Parse, clock)

import { BytesEmitter } from "./bytes.js";
import { BINARY_MATH_IMPORTS, StdlibCoreEmitter } from "./core.js";
import { IoEmitter } from "./io.js";
import { ExtendedPackagesEmitter } from "./packages.js";
import { PurePackagesEmitter } from "./pure.js";
import { SimdEmitter } from "./simd.js";
import { TimeEmitter } from "./time.js";

export {
	BINARY_MATH_IMPORTS,
	BytesEmitter,
	ExtendedPackagesEmitter,
	IoEmitter,
	PurePackagesEmitter,
	SimdEmitter,
	StdlibCoreEmitter,
	TimeEmitter,
};

export const stdlibEmitters = [
	StdlibCoreEmitter,
	BytesEmitter,
	PurePackagesEmitter,
	IoEmitter,
	TimeEmitter,
	ExtendedPackagesEmitter,
	SimdEmitter,
];
