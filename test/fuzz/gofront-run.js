// Shared by the fuzzers: compiles one program with GoFront and says how the
// compiler answered.

import { CompileError, compileFiles } from "../../src/compiler.js";

export function firstLine(s) {
	return (
		String(s)
			.split("\n")
			.find((l) => l.trim()) ?? ""
	);
}

const INVALID_WASM = "the generated WebAssembly is invalid";

// Compiles the program whose entry file is `goPath` for `target`.
//   ok            { res, wasm }  (`wasm` only for the `wasm` target)
//   compile       the compiler reported the program: { err, errors }
//   ice           the compiler crashed: { err }
//   invalid-wasm  the emitted module does not validate: { err }
export function compileProgram(goPath, target) {
	let res;
	try {
		res = compileFiles([goPath], { forceTarget: target });
	} catch (e) {
		const message = String(e?.message ?? e);
		if (e instanceof CompileError)
			return { kind: "compile", err: firstLine(message), errors: e.errors };
		if (message.includes(INVALID_WASM))
			return { kind: "invalid-wasm", err: firstLine(message) };
		return { kind: "ice", err: firstLine(message) };
	}
	const wasm = target === "wasm" ? res.wasm : null;
	if (wasm && !WebAssembly.validate(wasm))
		return { kind: "invalid-wasm", err: "WebAssembly.validate failed" };
	return { kind: "ok", res, wasm };
}
