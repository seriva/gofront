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

const EXT = "externref";

export const WASM_NATIVES = new Map();

// Bodies of `//gofront:intrinsic` functions (names: INTRINSICS in
// typechecker/types.js).  An entry is `{ prepare?, emit }`: `prepare(mod)`
// registers the imports `emit(emitter)` calls (the import table is locked
// before bodies are emitted), and `emit` leaves the result on the stack.
const WASM_INTRINSICS = {
	// math/rand: the host's `Math.random`.
	rand_source: {
		prepare: (mod) => mod.getMathRandomImportIndex(),
		emit: (e) =>
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getMathRandomImportIndex(),
			}),
	},
	// time: the host clock (`env.time_now_ms`, milliseconds) as nanoseconds.
	time_now: {
		emit: (e) => {
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getStdlibImportIndex("time_now_ms"),
			});
			e.pushInstruction("i64.trunc_sat_f64_s");
			e.pushInstruction({ op: "i64.const", value: 1000000n });
			e.pushInstruction("i64.mul");
		},
	},
	// time: the host zone's offset at a Unix time (`env.time_timezone_offset`
	// takes milliseconds and returns seconds).
	time_zone_offset: {
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction("f64.convert_i64_s");
			e.pushInstruction({ op: "f64.const", value: 1000 });
			e.pushInstruction("f64.mul");
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getStdlibImportIndex("time_timezone_offset"),
			});
			e.pushInstruction("i64.extend_i32_s");
		},
	},
	// os: the host's output, exit and environment (`env.os_*`, always present
	// in the host table).  A file descriptor narrows to an i32.
	os_write: {
		prepare: (mod) =>
			mod.getOrAddFuncImport("env", "os_write", ["i32", EXT], []),
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction("i32.wrap_i64");
			e.pushInstruction({ op: "local.get", index: 1 });
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport(
					"env",
					"os_write",
					["i32", EXT],
					[],
				),
			});
		},
	},
	os_exit: {
		prepare: (mod) => mod.getOrAddFuncImport("env", "os_exit", ["i32"], []),
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction("i32.wrap_i64");
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport("env", "os_exit", ["i32"], []),
			});
		},
	},
	os_getenv: hostStrings("os_getenv", 1, [EXT]),
	os_setenv: hostStrings("os_setenv", 2, []),
	// unicode: the host's class tables and case mappings.
	unicode_is: {
		prepare: (mod) =>
			mod.getOrAddFuncImport("env", "unicode_is", ["i32", "i32"], ["i32"]),
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction({ op: "local.get", index: 1 });
			e.pushInstruction("i32.wrap_i64");
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport(
					"env",
					"unicode_is",
					["i32", "i32"],
					["i32"],
				),
			});
		},
	},
	unicode_to_upper: hostRune("unicode_to_upper"),
	unicode_to_lower: hostRune("unicode_to_lower"),
	// crypto/rand: four bytes of the host's secure source.
	crypto_rand_u32: {
		prepare: (mod) =>
			mod.getOrAddFuncImport("env", "crypto_rand_u32", [], ["i32"]),
		emit: (e) =>
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport(
					"env",
					"crypto_rand_u32",
					[],
					["i32"],
				),
			}),
	},
	// testing: the host clock in nanoseconds (`env.testing_nanotime` returns
	// a double) and the host's regular expressions for -run and -bench.
	testing_nanotime: {
		prepare: (mod) =>
			mod.getOrAddFuncImport("env", "testing_nanotime", [], ["f64"]),
		emit: (e) => {
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport(
					"env",
					"testing_nanotime",
					[],
					["f64"],
				),
			});
			e.pushInstruction("i64.trunc_sat_f64_s");
		},
	},
	testing_match: {
		prepare: (mod) =>
			mod.getOrAddFuncImport("env", "testing_match", [EXT, EXT], ["i32"]),
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction({ op: "local.get", index: 1 });
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport(
					"env",
					"testing_match",
					[EXT, EXT],
					["i32"],
				),
			});
		},
	},
	// fmt: the host's identity number for a reference held in an `any`.
	fmt_ptr_id: {
		prepare: (mod) =>
			mod.getOrAddFuncImport("env", "fmt_ptr_id", [EXT], ["i32"]),
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction("extern.convert_any");
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport(
					"env",
					"fmt_ptr_id",
					[EXT],
					["i32"],
				),
			});
			e.pushInstruction("i64.extend_i32_u");
		},
	},
	// math: IEEE-754 bit casts of the parameter.
	math_float64bits: reinterpret("i64.reinterpret_f64"),
	math_float64frombits: reinterpret("f64.reinterpret_i64"),
	math_float32bits: reinterpret("i32.reinterpret_f32"),
	math_float32frombits: reinterpret("f32.reinterpret_i32"),
	// math: the host's `Math.*` (`mod` is `%`); the import table is locked
	// before bodies are emitted, so `prepare` registers each.
	...Object.fromEntries(
		[
			["sin"],
			["cos"],
			["tan"],
			["asin"],
			["acos"],
			["atan"],
			["sinh"],
			["cosh"],
			["tanh"],
			["exp"],
			["expm1"],
			["log"],
			["log1p"],
			["log2"],
			["log10"],
			["cbrt"],
			["atan2", true],
			["pow", true],
			["hypot", true],
			["mod", true],
		].map(([f, binary]) => [`math_${f}`, hostMath(f, binary)]),
	),
};

function hostStrings(name, count, results) {
	const params = Array(count).fill(EXT);
	return {
		prepare: (mod) => mod.getOrAddFuncImport("env", name, params, results),
		emit: (e) => {
			for (let i = 0; i < count; i++)
				e.pushInstruction({ op: "local.get", index: i });
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport("env", name, params, results),
			});
		},
	};
}

function hostRune(name) {
	return {
		prepare: (mod) => mod.getOrAddFuncImport("env", name, ["i32"], ["i32"]),
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getOrAddFuncImport("env", name, ["i32"], ["i32"]),
			});
		},
	};
}

function reinterpret(op) {
	return {
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			e.pushInstruction(op);
		},
	};
}

function hostMath(name, binary = false) {
	return {
		prepare: (mod) => mod.getMathImportIndex(name, binary),
		emit: (e) => {
			e.pushInstruction({ op: "local.get", index: 0 });
			if (binary) e.pushInstruction({ op: "local.get", index: 1 });
			e.pushInstruction({
				op: "call",
				funcIndex: e.mod.getMathImportIndex(name, binary),
			});
		},
	};
}

function wasmIntrinsic(fn) {
	const entry = WASM_INTRINSICS[fn.intrinsic];
	if (!entry) throw new Error(`no WASM body for intrinsic '${fn.intrinsic}'`);
	return entry;
}

export function prepareWasmIntrinsic(mod, fn) {
	wasmIntrinsic(fn).prepare?.(mod);
}

export function emitWasmIntrinsic(emitter, fn) {
	wasmIntrinsic(fn).emit(emitter);
	emitter.pushInstruction("return");
}

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

function hostCall(name, argKinds, resultKind) {
	const params = argKinds.map((k) =>
		k === "s" ? EXT : k === "f" ? "f64" : "i32",
	);
	const results = [
		resultKind === "str" ? EXT : resultKind === "float" ? "f64" : "i32",
	];
	return {
		imports: [[name, params, results]],
		emit(e, call, _typeArgs, target) {
			call.args.forEach((a, i) => {
				if (argKinds[i] === "s") e.emitExpr(a, EXT);
				else if (argKinds[i] === "f") e.emitExpr(a, "f64");
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
// strconv: the shortest digits of a float64 (a string) and a decimal's
// float64 (`f` is an f64 argument).
STRING_NATIVES["strconv.shortest"] = ["strconv_shortest", "f", "str"];
STRING_NATIVES["strconv.fixed"] = ["strconv_fixed", "fi", "str"];
STRING_NATIVES["strconv.parseDecimal"] = [
	"strconv_parse_decimal",
	"s",
	"float",
];
for (const [native, [name, kinds, result]] of Object.entries(STRING_NATIVES))
	WASM_NATIVES.set(native, hostCall(name, [...kinds], result));

// ── math/bits ─────────────────────────────────────────────────
//
// `clz`, `ctz` and `popcnt` of the operand's width.  Operands narrower than 32
// bits are already zero-extended in their i32; `TrailingZeros` sets a bit
// above the operand so that a zero input counts its width.

function bitsNative(family, width) {
	const wide = width === 64;
	const ty = wide ? "i64" : "i32";
	const constant = (value) => ({
		op: `${ty}.const`,
		value: wide ? BigInt(value) : value,
	});
	return {
		emit(e, call, _typeArgs, target) {
			if (family === "Len") e.pushInstruction(constant(wide ? 64 : 32));
			if (wide) e.emitExpr(call.args[0], "i64");
			else e._emitI32Arg(call.args[0]);
			switch (family) {
				case "Len":
					e.pushInstruction(`${ty}.clz`);
					e.pushInstruction(`${ty}.sub`);
					break;
				case "LeadingZeros":
					e.pushInstruction(`${ty}.clz`);
					if (width < 32) {
						e.pushInstruction(constant(32 - width));
						e.pushInstruction("i32.sub");
					}
					break;
				case "TrailingZeros":
					if (width < 32) {
						e.pushInstruction(constant(1 << width));
						e.pushInstruction("i32.or");
					}
					e.pushInstruction(`${ty}.ctz`);
					break;
				case "OnesCount":
					e.pushInstruction(`${ty}.popcnt`);
					break;
			}
			if (wide) {
				if (target === "i32") e.pushInstruction("i32.wrap_i64");
			} else if ((target ?? "i64") === "i64") {
				e.pushInstruction("i64.extend_i32_u");
			}
			return true;
		},
	};
}

for (const family of ["Len", "LeadingZeros", "TrailingZeros", "OnesCount"]) {
	for (const [suffix, width] of [
		["", 64],
		["8", 8],
		["16", 16],
		["32", 32],
		["64", 64],
	])
		WASM_NATIVES.set(`bits.${family}${suffix}`, bitsNative(family, width));
}

// ── math ──────────────────────────────────────────────────────
//
// One f64 instruction where it gives Go's answer.  `Round` rounds half away
// from zero (`f64.nearest` rounds half to even) and `Min`/`Max` return an
// infinity even beside a NaN (`f64.min`/`f64.max` return the NaN), so those
// three add the fix-up around the instruction.

const f64Unary = (op) => ({
	emit(e, call) {
		e.emitExpr(call.args[0], "f64");
		e.pushInstruction(op);
		return true;
	},
});
WASM_NATIVES.set("math.Abs", f64Unary("f64.abs"));
WASM_NATIVES.set("math.Floor", f64Unary("f64.floor"));
WASM_NATIVES.set("math.Ceil", f64Unary("f64.ceil"));
WASM_NATIVES.set("math.Trunc", f64Unary("f64.trunc"));
WASM_NATIVES.set("math.Sqrt", f64Unary("f64.sqrt"));
WASM_NATIVES.set("math.Copysign", {
	emit(e, call) {
		e.emitExpr(call.args[0], "f64");
		e.emitExpr(call.args[1], "f64");
		e.pushInstruction("f64.copysign");
		return true;
	},
});

// min/max of two f64, except that `inf` wins over a NaN.
function infWins(op, inf) {
	return {
		emit(e, call) {
			const a = e.acquireTemp("f64");
			const b = e.acquireTemp("f64");
			e.emitExpr(call.args[0], "f64");
			e.pushInstruction({ op: "local.set", index: a });
			e.emitExpr(call.args[1], "f64");
			e.pushInstruction({ op: "local.set", index: b });
			e.pushInstruction({ op: "f64.const", value: inf });
			e.pushInstruction({ op: "local.get", index: a });
			e.pushInstruction({ op: "local.get", index: b });
			e.pushInstruction(op);
			for (const t of [a, b]) {
				e.pushInstruction({ op: "local.get", index: t });
				e.pushInstruction({ op: "f64.const", value: inf });
				e.pushInstruction("f64.eq");
			}
			e.pushInstruction("i32.or");
			e.pushInstruction("select");
			e.releaseTemp(b, "f64");
			e.releaseTemp(a, "f64");
			return true;
		},
	};
}
WASM_NATIVES.set("math.Max", infWins("f64.max", Infinity));
WASM_NATIVES.set("math.Min", infWins("f64.min", -Infinity));

WASM_NATIVES.set("math.Round", {
	emit(e, call) {
		const x = e.acquireTemp("f64");
		const t = e.acquireTemp("f64");
		const get = (i) => e.pushInstruction({ op: "local.get", index: i });
		e.emitExpr(call.args[0], "f64");
		e.pushInstruction({ op: "local.set", index: x });
		get(x);
		e.pushInstruction("f64.trunc");
		e.pushInstruction({ op: "local.set", index: t });
		// t + copysign(1, x) when |x - t| >= 0.5, else t
		get(t);
		e.pushInstruction({ op: "f64.const", value: 1 });
		get(x);
		e.pushInstruction("f64.copysign");
		e.pushInstruction("f64.add");
		get(t);
		get(x);
		get(t);
		e.pushInstruction("f64.sub");
		e.pushInstruction("f64.abs");
		e.pushInstruction({ op: "f64.const", value: 0.5 });
		e.pushInstruction("f64.ge");
		e.pushInstruction("select");
		e.releaseTemp(t, "f64");
		e.releaseTemp(x, "f64");
		return true;
	},
});

WASM_NATIVES.set("math.IsNaN", {
	emit(e, call) {
		const x = e.acquireTemp("f64");
		e.emitExpr(call.args[0], "f64");
		e.pushInstruction({ op: "local.tee", index: x });
		e.pushInstruction({ op: "local.get", index: x });
		e.pushInstruction("f64.ne");
		e.releaseTemp(x, "f64");
		return true;
	},
});

// IsInf(f, sign): (sign >= 0 && f == +Inf) || (sign <= 0 && f == -Inf)
WASM_NATIVES.set("math.IsInf", {
	emit(e, call) {
		const f = e.acquireTemp("f64");
		const s = e.acquireTemp("i64");
		e.emitExpr(call.args[0], "f64");
		e.pushInstruction({ op: "local.set", index: f });
		e.emitExpr(call.args[1], "i64");
		e.pushInstruction({ op: "local.set", index: s });
		for (const [cmp, inf] of [
			["i64.ge_s", Infinity],
			["i64.le_s", -Infinity],
		]) {
			e.pushInstruction({ op: "local.get", index: s });
			e.pushInstruction({ op: "i64.const", value: 0n });
			e.pushInstruction(cmp);
			e.pushInstruction({ op: "local.get", index: f });
			e.pushInstruction({ op: "f64.const", value: inf });
			e.pushInstruction("f64.eq");
			e.pushInstruction("i32.and");
		}
		e.pushInstruction("i32.or");
		e.releaseTemp(s, "i64");
		e.releaseTemp(f, "f64");
		return true;
	},
});

// Inf(sign): +Inf copysigned with the sign (0 converts to +0.0).
WASM_NATIVES.set("math.Inf", {
	emit(e, call) {
		e.pushInstruction({ op: "f64.const", value: Infinity });
		e.emitExpr(call.args[0], "i64");
		e.pushInstruction("f64.convert_i64_s");
		e.pushInstruction("f64.copysign");
		return true;
	},
});
WASM_NATIVES.set("math.NaN", {
	emit(e) {
		e.pushInstruction({ op: "f64.const", value: NaN });
		return true;
	},
});
WASM_NATIVES.set("math.Signbit", {
	emit(e, call) {
		e.emitExpr(call.args[0], "f64");
		e.pushInstruction("i64.reinterpret_f64");
		e.pushInstruction({ op: "i64.const", value: 0n });
		e.pushInstruction("i64.lt_s");
		return true;
	},
});
