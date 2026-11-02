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

// ── strings ───────────────────────────────────────────────────
//
// Each native is one call of an `env.str_*` host import that gives the Go
// body's answer.  The imports live in the always-present part of the host
// table (`WASM_IMPORTS_JS`), so a Go-source package using one needs no
// `strings` import of its own.  Arguments are strings (`s`, an externref) or
// a byte or rune (`i`, an i32); results are a bool or int (`int` widens to
// the Go int) or a string.

const EXT = "externref";

function hostCall(name, argKinds, resultKind) {
	const params = argKinds.map((k) => (k === "s" ? EXT : "i32"));
	const results = [resultKind === "str" ? EXT : "i32"];
	return {
		imports: [[name, params, results]],
		emit(e, call, _typeArgs, target) {
			call.args.forEach((a, i) => {
				if (argKinds[i] === "s") e.emitExpr(a, EXT);
				else e._emitI32Arg(a);
			});
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport("env", name, params, results),
			});
			if (resultKind === "int" && (target ?? "i64") === "i64")
				e.pushInstruction("i64.extend_i32_s");
			return true;
		},
	};
}

// Repeat has no WASM native: a host import cannot raise the recoverable
// panic of a negative count, so the Go body runs.
const STRING_NATIVES = {
	"strings.Index": ["str_index", "ss", "int"],
	"strings.LastIndex": ["str_last_index", "ss", "int"],
	"strings.IndexByte": ["str_index_byte", "si", "int"],
	"strings.LastIndexByte": ["str_last_index_byte", "si", "int"],
	"strings.IndexRune": ["str_index_rune", "si", "int"],
	"strings.IndexAny": ["str_index_any", "ss", "int"],
	"strings.LastIndexAny": ["str_last_index_any", "ss", "int"],
	"strings.Contains": ["str_contains", "ss", "bool"],
	"strings.ContainsAny": ["str_contains_any", "ss", "bool"],
	"strings.ContainsRune": ["str_contains_rune", "si", "bool"],
	"strings.HasPrefix": ["str_has_prefix", "ss", "bool"],
	"strings.HasSuffix": ["str_has_suffix", "ss", "bool"],
	"strings.Count": ["str_count", "ss", "int"],
	"strings.Replace": ["str_replace", "sssi", "str"],
	"strings.ReplaceAll": ["str_replace_all", "sss", "str"],
	"strings.ToUpper": ["str_to_upper", "s", "str"],
	"strings.ToLower": ["str_to_lower", "s", "str"],
	"strings.TrimSpace": ["str_trim_space", "s", "str"],
	"strings.Trim": ["str_trim", "ss", "str"],
	"strings.TrimLeft": ["str_trim_left", "ss", "str"],
	"strings.TrimRight": ["str_trim_right", "ss", "str"],
	"strings.TrimPrefix": ["str_trim_prefix", "ss", "str"],
	"strings.TrimSuffix": ["str_trim_suffix", "ss", "str"],
};
for (const [native, [name, kinds, result]] of Object.entries(STRING_NATIVES))
	WASM_NATIVES.set(native, hostCall(name, [...kinds], result));
