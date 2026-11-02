// WASM natives: host code that replaces a call to a `//gofront:native` stdlib
// function.  The Go body is the specification and is always emitted when
// reachable; an implementation either emits the call and returns `true`, or
// returns `false` having emitted nothing, in which case the call goes to the
// Go body.
//
// An entry is `{ imports?, emit }`:
//   imports  `[name, params, results]` of the `env.*` imports `emit` calls.
//            The import table is locked before function bodies are emitted,
//            so the pre-scan registers them for every call site it finds.
//   emit     `(emitter, call, typeArgs, targetWasmType) => boolean`; pushes the
//            arguments (`emitter.emitExpr`, in order) and then the
//            instructions or the import call, leaving the call's result.

export const WASM_NATIVES = new Map();

// Registers the imports of the native a call site names, if any.
export function prepareWasmNative(mod, call) {
	if (!mod.natives || !call._native) return;
	for (const [name, params, results] of WASM_NATIVES.get(call._native)
		?.imports ?? [])
		mod.getOrAddFuncImport("env", name, params, results);
}

// Emits the call as host code; false (nothing emitted) calls the Go body.
export function emitWasmNative(emitter, call, targetWasmType) {
	if (!emitter.mod.natives || !call._native || call._noNative) return false;
	if (call.args.some((a) => a._spread)) return false;
	const entry = WASM_NATIVES.get(call._native);
	if (!entry) return false;
	const typeArgs = call._typeArgs ?? call.func?._typeArgs ?? [];
	return entry.emit(emitter, call, typeArgs, targetWasmType);
}
