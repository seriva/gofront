// src/backend/wasm/emit-stdlib.js
// Backwards compatibility re-export.
// WASM stdlib implementations have moved to src/backend/wasm/stdlib/.

export {
	BINARY_MATH_IMPORTS,
	BytesEmitter,
	IoEmitter,
	PurePackagesEmitter,
	StdlibCoreEmitter,
	StdlibCoreEmitter as StdlibEmitter,
	TimeEmitter,
} from "./stdlib/index.js";
