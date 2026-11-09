// src/backend/wasm/stdlib/index.js
// Standard library emitters for the WebAssembly backend.
//
// Organized by domain:
// - core.js:   maps, strings, strconv, testing
// - io.js:     io.Writer helpers

import { StdlibCoreEmitter } from "./core.js";
import { IoEmitter } from "./io.js";
import { SimdEmitter } from "./simd.js";

export { IoEmitter, SimdEmitter, StdlibCoreEmitter };

export const stdlibEmitters = [StdlibCoreEmitter, IoEmitter, SimdEmitter];
