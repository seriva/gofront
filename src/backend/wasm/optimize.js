// src/backend/wasm/optimize.js
// Binaryen optimization pipeline for GoFront WebAssembly modules.
//
// Supports:
// - Bundled Binaryen optimizer (binaryen npm package)
// - Native wasm-opt binary auto-detection with graceful fallback
// - WasmGC feature flag configuration (GC, ReferenceTypes, BulkMemory, Multivalue, ExceptionHandling, etc.)
// - Optimization levels (-O3 by default) + GUFA (Grand Unified Flow Analysis)
// - Post-optimization module validation (WebAssembly.validate)
// - WASM source map emission and GoFront custom section preservation

import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GOFRONT_SECTION_BYTES, isGoFrontWasm } from "./encode.js";

// Binaryen feature bitmask: GC (1024) | ReferenceTypes (256) | BulkMemory (16) | Multivalue (512) |
// ExceptionHandling (64) | MutableGlobals (2) | NontrappingFPToInt (4) | TailCall (128) = 2006
export const DEFAULT_WASM_FEATURES = 2006;

let _nativeWasmOptAvailable = null;
let _npmWasmOptPath = null;

const _require = createRequire(import.meta.url);

export function getNpmWasmOptPath() {
	if (_npmWasmOptPath === null) {
		try {
			_npmWasmOptPath = _require.resolve("binaryen/bin/wasm-opt");
		} catch {
			_npmWasmOptPath = "";
		}
	}
	return _npmWasmOptPath;
}

export function hasNativeWasmOpt() {
	if (_nativeWasmOptAvailable === null) {
		try {
			const res = spawnSync("wasm-opt", ["--version"], { stdio: "ignore" });
			_nativeWasmOptAvailable = res.status === 0;
		} catch {
			_nativeWasmOptAvailable = false;
		}
	}
	return _nativeWasmOptAvailable;
}

export function resetNativeWasmOptCheck() {
	_nativeWasmOptAvailable = null;
}

// Injects GoFront custom section right after the 8-byte WASM header so that
// isGoFrontWasm recognises the module for clean artifact cleanup.
export function injectGoFrontSection(bytes) {
	if (isGoFrontWasm(bytes)) return bytes;
	if (!bytes || bytes.length < 8) return bytes;
	const header = bytes.subarray(0, 8);
	const rest = bytes.subarray(8);
	const tagged = new Uint8Array(
		header.length + GOFRONT_SECTION_BYTES.length + rest.length,
	);
	tagged.set(header, 0);
	tagged.set(GOFRONT_SECTION_BYTES, header.length);
	tagged.set(rest, header.length + GOFRONT_SECTION_BYTES.length);
	return tagged;
}

function runWasmOpt(
	command,
	cmdArgs,
	wasmBytes,
	options = {},
	engine = "native",
) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-wasmopt-"));
	const input = join(dir, "in.wasm");
	const output = join(dir, "out.wasm");
	const mapOutput = join(dir, "out.wasm.map");
	const watOutput = join(dir, "out.wat");
	try {
		writeFileSync(input, wasmBytes);
		const level = options.level ?? 3;
		const shrinkLevel = options.shrinkLevel ?? 0;
		const args = [
			`-O${level}`,
			`--shrink-level=${shrinkLevel}`,
			"--enable-gc",
			"--enable-reference-types",
			"--enable-exception-handling",
			"--enable-multivalue",
			"--enable-bulk-memory",
			"--enable-mutable-globals",
			"--enable-nontrapping-float-to-int",
			"--enable-tail-call",
		];
		if (options.gufa !== false) {
			args.push("--gufa");
		}
		if (options.sourceMap) {
			args.push("-osm", mapOutput);
			if (options.sourceMapUrl) {
				args.push("-osu", options.sourceMapUrl);
			}
		}
		args.push(input, "-o", output);
		execFileSync(command, [...cmdArgs, ...args], { stdio: "pipe" });
		const optimizedBytes = new Uint8Array(readFileSync(output));
		let sourceMap = null;
		if (options.sourceMap && existsSync(mapOutput)) {
			sourceMap = readFileSync(mapOutput, "utf8");
		}
		let wat = null;
		if (options.emitWat) {
			try {
				const watArgs = [
					`-O${level}`,
					`--shrink-level=${shrinkLevel}`,
					"--enable-gc",
					"--enable-reference-types",
					"--enable-exception-handling",
					"--enable-multivalue",
					"--enable-bulk-memory",
					"--enable-mutable-globals",
					"--enable-nontrapping-float-to-int",
					"--enable-tail-call",
				];
				if (options.gufa !== false) watArgs.push("--gufa");
				watArgs.push(input, "-S", "-o", watOutput);
				execFileSync(command, [...cmdArgs, ...watArgs], { stdio: "pipe" });
				if (existsSync(watOutput)) {
					wat = readFileSync(watOutput, "utf8");
				}
			} catch {
				// Continue if WAT generation fails
			}
		}
		const tagged = injectGoFrontSection(optimizedBytes);
		if (typeof WebAssembly !== "undefined" && !WebAssembly.validate(tagged)) {
			throw new Error("WASM module validation failed after optimization");
		}
		return {
			wasm: tagged,
			wat,
			sourceMap,
			engine,
		};
	} catch (e) {
		const stderr = e.stderr ? e.stderr.toString() : e.message;
		throw new Error(`WASM optimization failed: ${stderr}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export function optimizeWithNative(wasmBytes, options = {}) {
	return runWasmOpt("wasm-opt", [], wasmBytes, options, "native");
}

export function optimizeWithBinaryen(wasmBytes, options = {}) {
	const npmPath = getNpmWasmOptPath();
	if (!npmPath) {
		throw new Error("Binaryen npm package wasm-opt binary not found");
	}
	return runWasmOpt(
		process.execPath,
		[npmPath],
		wasmBytes,
		options,
		"binaryen",
	);
}

export function optimizeWasm(wasmBytes, options = {}) {
	if (!wasmBytes || wasmBytes.length === 0) {
		return {
			wasm: wasmBytes,
			wat: null,
			sourceMap: null,
			originalSize: 0,
			optimizedSize: 0,
			savedBytes: 0,
			percentSaved: 0,
			engine: "none",
		};
	}

	const originalSize = wasmBytes.length;
	let res;
	if (options.preferNative !== false && hasNativeWasmOpt()) {
		try {
			res = optimizeWithNative(wasmBytes, options);
		} catch {
			res = optimizeWithBinaryen(wasmBytes, options);
		}
	} else {
		res = optimizeWithBinaryen(wasmBytes, options);
	}

	const optimizedSize = res.wasm.length;
	const savedBytes = originalSize - optimizedSize;
	const percentSaved =
		originalSize > 0
			? Number(((savedBytes / originalSize) * 100).toFixed(1))
			: 0;

	return {
		wasm: res.wasm,
		wat: res.wat ?? null,
		sourceMap: res.sourceMap ?? null,
		originalSize,
		optimizedSize,
		savedBytes,
		percentSaved,
		engine: res.engine,
	};
}
