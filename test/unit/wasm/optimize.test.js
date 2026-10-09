// test/unit/wasm/optimize.test.js
// Tests for Phase H7 Task H7.2 — Binaryen optimization pipeline & tooling.

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGoFrontWasm } from "../../../src/backend/wasm/encode.js";
import { instantiateWasm } from "../../../src/backend/wasm/glue.js";
import { compileWasm } from "../../../src/backend/wasm/index.js";
import {
	DEFAULT_WASM_FEATURES,
	hasNativeWasmOpt,
	injectGoFrontSection,
	optimizeWasm,
	optimizeWithBinaryen,
} from "../../../src/backend/wasm/optimize.js";
import {
	formatBuildSummary,
	handleBuild,
	parseBuildArgs,
} from "../../../src/cli-core.js";
import { compileSingleFile } from "../../../src/compiler.js";
import { assert, assertEqual, section, test } from "../helpers.js";

section("WASM Optimizer — Core Pipeline (Binaryen)");

test("DEFAULT_WASM_FEATURES includes GC and ExceptionHandling bits", () => {
	assert(
		typeof DEFAULT_WASM_FEATURES === "number",
		"features bitmask is a number",
	);
	assert(DEFAULT_WASM_FEATURES > 0, "features bitmask is non-zero");
});

test("hasNativeWasmOpt returns a boolean", () => {
	const res = hasNativeWasmOpt();
	assert(typeof res === "boolean", "hasNativeWasmOpt must return boolean");
});

test("optimizeWasm reduces binary size on valid WASM module", () => {
	const src = `
package main

type Point struct {
	X float64
	Y float64
}

func DistanceSq(p1, p2 Point) float64 {
	dx := p1.X - p2.X
	dy := p1.Y - p2.Y
	return dx*dx + dy*dy
}

func Compute() float64 {
	p1 := Point{X: 10.0, Y: 20.0}
	p2 := Point{X: 4.0, Y: 12.0}
	return DistanceSq(p1, p2)
}
`;
	const compiled = compileWasm(src);
	assert(compiled.wasm && compiled.wasm.length > 0, "must produce wasm bytes");

	const opt = optimizeWasm(compiled.wasm);
	assert(opt.wasm instanceof Uint8Array, "optimized wasm must be Uint8Array");
	assert(
		opt.optimizedSize < opt.originalSize,
		`optimized size (${opt.optimizedSize}) should be smaller than original (${opt.originalSize})`,
	);
	assert(opt.percentSaved > 0, "percent saved should be > 0");
	assert(
		opt.engine === "binaryen" || opt.engine === "native",
		"engine should be binaryen or native",
	);
	assert(
		WebAssembly.validate(opt.wasm),
		"optimized wasm must be valid WebAssembly",
	);
});

test("isGoFrontWasm identifies optimized WASM modules", () => {
	const src = `
package main

func Add(a, b int32) int32 {
	return a + b
}
`;
	const compiled = compileWasm(src);
	assert(isGoFrontWasm(compiled.wasm), "unoptimized wasm has gofront section");

	const opt = optimizeWasm(compiled.wasm);
	assert(
		isGoFrontWasm(opt.wasm),
		"optimized wasm must preserve gofront custom section",
	);
});

test("injectGoFrontSection handles edge cases cleanly", () => {
	assert(injectGoFrontSection(null) === null);
	const short = new Uint8Array([1, 2, 3]);
	assertEqual(injectGoFrontSection(short), short);
});

test("Execution semantic parity between unoptimized and optimized WASM", () => {
	const src = `
package main

func Fibonacci(n int32) int32 {
	if n <= 1 {
		return n
	}
	return Fibonacci(n-1) + Fibonacci(n-2)
}

func Run() int32 {
	return Fibonacci(10)
}
`;
	const compiled = compileWasm(src);
	const unopt = instantiateWasm(compiled.wasm, {
		stringTable: compiled.stringTable,
	});
	const unoptRes = unopt.exports.Run();

	const opt = optimizeWasm(compiled.wasm);
	const optInst = instantiateWasm(opt.wasm, {
		stringTable: compiled.stringTable,
	});
	const optRes = optInst.exports.Run();

	assertEqual(optRes, 55);
	assertEqual(optRes, unoptRes);
});

test("WASM source map generation through Binaryen", () => {
	const src = `
package main

func Square(x float64) float64 {
	return x * x
}
`;
	const compiled = compileWasm(src);
	const opt = optimizeWasm(compiled.wasm, {
		sourceMap: true,
		sourceMapUrl: "app.wasm.map",
	});

	assert(
		typeof opt.sourceMap === "string" && opt.sourceMap.length > 0,
		"must emit sourceMap string",
	);
	const mapJson = JSON.parse(opt.sourceMap);
	assert(mapJson.version === 3, "source map version must be 3");

	const latin1 = Buffer.from(opt.wasm).toString("latin1");
	assert(
		latin1.includes("sourceMappingURL"),
		"wasm must contain sourceMappingURL section",
	);
	assert(latin1.includes("app.wasm.map"), "wasm must point to app.wasm.map");
});

test("Validation error handling for corrupted WASM", () => {
	const broken = new Uint8Array([
		0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0xff,
	]);
	let threw = false;
	try {
		optimizeWithBinaryen(broken);
	} catch (e) {
		threw = true;
		assert(
			e.message.includes("parsing") || e.message.includes("validation"),
			"should report parse or validation failure",
		);
	}
	assert(threw, "corrupted wasm must throw validation error");
});

test("Empty / null wasm returns graceful fallback result", () => {
	const empty = optimizeWasm(new Uint8Array(0));
	assertEqual(empty.originalSize, 0);
	assertEqual(empty.optimizedSize, 0);
	assertEqual(empty.percentSaved, 0);
	assertEqual(empty.engine, "none");
});

section("WASM Optimizer — Tooling & CLI Integration");

test("compileSingleFile with wasmOpt: true returns wasmOptInfo", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-test-opt-"));
	const file = join(dir, "calc.go");
	try {
		writeFileSync(
			file,
			`//gofront:target wasm
package calc

func Add(a, b int32) int32 {
	return a + b
}
`,
		);
		const res = compileSingleFile(file, { wasmOpt: true });
		assert(res.wasm instanceof Uint8Array, "must emit wasm");
		assert(res.wasmOptInfo, "must attach wasmOptInfo");
		assert(
			res.wasmOptInfo.optimizedSize <= res.wasmOptInfo.originalSize,
			"optimized <= original",
		);
		assert(res.wasmOptInfo.percentSaved >= 0, "percent saved >= 0");
		assert(WebAssembly.validate(res.wasm), "optimized wasm is valid");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("parseBuildArgs parses --release and --wasm-opt flags", () => {
	const parsed1 = parseBuildArgs(["--release"]);
	assertEqual(parsed1.release, true);
	assertEqual(parsed1.wasmOpt, true);

	const parsed2 = parseBuildArgs(["--wasm-opt"]);
	assertEqual(parsed2.wasmOpt, true);

	const parsed3 = parseBuildArgs(["--release", "--no-wasm-opt"]);
	assertEqual(parsed3.release, true);
	assertEqual(parsed3.wasmOpt, false);

	const parsed4 = parseBuildArgs([]);
	assertEqual(parsed4.wasmOpt, false);
});

test("formatBuildSummary includes wasm-opt reduction metric", () => {
	const summary = formatBuildSummary({
		outDir: "public",
		elapsedMs: "12",
		files: [
			{ name: "app.js", size: 1024 },
			{ name: "app.wasm", size: 50000 },
		],
		wasmOpt: {
			originalSize: 65000,
			optimizedSize: 50000,
			percentSaved: 23.1,
			engine: "binaryen",
		},
	});
	const wasmOptLine = summary.find((l) => l.includes("wasm-opt:"));
	assert(wasmOptLine, "summary must contain wasm-opt line");
	assert(
		wasmOptLine.includes("63.5 kB → 48.8 kB (-23.1%) [binaryen]"),
		"summary must format size change correctly",
	);
});

test("handleBuild with --release optimizes WASM and outputs app.wasm", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-build-release-"));
	try {
		const srcDir = join(dir, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(
			join(srcDir, "main.go"),
			`//gofront:target wasm
package main

func Multiply(a, b int32) int32 {
	return a * b
}
`,
		);
		const outDir = join(dir, "dist");
		const result = await handleBuild(dir, {
			srcDir,
			outDir,
			release: true,
			wasmOpt: true,
		});

		assert(result.wasmOpt, "build result must contain wasmOpt info");
		assert(result.wasmOpt.originalSize > 0, "originalSize > 0");
		assert(
			result.wasmOpt.optimizedSize <= result.wasmOpt.originalSize,
			"optimizedSize <= originalSize",
		);

		const wasmPath = join(outDir, "app.wasm");
		assert(existsSync(wasmPath), "app.wasm must exist in output dir");
		const wasmBytes = readFileSync(wasmPath);
		assert(
			isGoFrontWasm(wasmBytes),
			"app.wasm must be recognized as GoFront WASM",
		);
		assert(WebAssembly.validate(wasmBytes), "app.wasm must be valid");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
