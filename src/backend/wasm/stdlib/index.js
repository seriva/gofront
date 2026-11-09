// src/backend/wasm/stdlib/index.js
// Standard library emitters for the WebAssembly backend.

import { SimdEmitter } from "./simd.js";

export { SimdEmitter };

export const stdlibEmitters = [SimdEmitter];
