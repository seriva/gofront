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
import { PurePackagesEmitter } from "./pure.js";
import { TimeEmitter } from "./time.js";

// Aliases for backwards compatibility
export {
	BINARY_MATH_IMPORTS,
	BytesEmitter,
	IoEmitter,
	IoEmitter as Phase7Emitter,
	PurePackagesEmitter,
	PurePackagesEmitter as Phase6Emitter,
	StdlibCoreEmitter,
	StdlibCoreEmitter as StdlibEmitter,
	TimeEmitter,
	TimeEmitter as Phase8Emitter,
};

export const stdlibEmitters = [
	StdlibCoreEmitter,
	BytesEmitter,
	PurePackagesEmitter,
	IoEmitter,
	TimeEmitter,
];
