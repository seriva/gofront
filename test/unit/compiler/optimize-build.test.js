// test/unit/compiler/optimize-build.test.js
// Tests for WASM Optimizer tooling & CLI integration (handleBuild, compileSingleFile, build summary).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isGoFrontWasm } from "../../../src/backend/wasm/encode.js";
import {
	formatBuildSummary,
	handleBuild,
	parseBuildArgs,
} from "../../../src/cli/cli-core.js";
import { compileSingleFile } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	compileHybrid,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("WASM Optimizer — Tooling & CLI Integration");

test("compileSingleFile with wasmOpt: true returns wasmOptInfo", () => {
	withTempDir(
		{
			"calc.go": `//gofront:target wasm
package calc

func Add(a, b int32) int32 {
	return a + b
}
`,
		},
		(dir) => {
			const file = join(dir, "calc.go");
			const res = compileSingleFile(file, { wasmOpt: true });
			assert(res.wasm instanceof Uint8Array, "must emit wasm");
			assert(res.wasmOptInfo, "must attach wasmOptInfo");
			assert(
				res.wasmOptInfo.optimizedSize <= res.wasmOptInfo.originalSize,
				"optimized <= original",
			);
			assert(res.wasmOptInfo.percentSaved >= 0, "percent saved >= 0");
			assert(WebAssembly.validate(res.wasm), "optimized wasm is valid");
		},
	);
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
	await withTempDir(
		{
			"src/main.go": `//gofront:target wasm
package main

func Multiply(a, b int32) int32 {
	return a * b
}
`,
		},
		async (dir) => {
			const srcDir = join(dir, "src");
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
		},
	);
});

section("WASM codegen & optimization improvements");

test("Section 4 optimizations: constant folding, constant divisors, constant array indexing, index-only range", () => {
	const src = `
package main

import (
	"bytes"
	"fmt"
	"io"
	"strings"
)

type Point struct {
	X int
	Y int
}

func makePoint(x, y int) Point {
	return Point{X: x, Y: y}
}

func Main() string {
	// Function-body constant folding
	foldedInt := 24 * 60 * 60
	foldedShift := 1 << 8

	// Constant divisors (signed and unsigned powers-of-two and general)
	u := uint32(100)
	uDiv := u / 16
	uRem := u % 16
	s := int32(-105)
	sDiv := s / 10
	sRem := s % 10

	// Constant-indexed fixed-size array
	var coords [4]int
	coords[0] = 10
	coords[1] = 20
	coords[2] = 30
	coords[3] = 40
	c0 := coords[0]
	c2 := coords[2]

	// CallExpr struct return (skip copy)
	pt := makePoint(c0, c2)

	// Direct WriteString on Builder and Buffer via io.WriteString & fmt.Fprintf
	var sb strings.Builder
	io.WriteString(&sb, "hello-")
	fmt.Fprintf(&sb, "%d", pt.X)

	var buf bytes.Buffer
	io.WriteString(&buf, "world-")
	fmt.Fprintf(&buf, "%d", pt.Y)

	// Index-only slice range loop
	slice := []int{100, 200, 300, 400}
	sumIdx := 0
	for i := range slice {
		sumIdx += i
	}

	return fmt.Sprintf("%d:%d|%d:%d:%d:%d|%d:%d|%d:%d|%s|%s|%d",
		foldedInt, foldedShift,
		uDiv, uRem, sDiv, sRem,
		c0, c2,
		pt.X, pt.Y,
		sb.String(), buf.String(),
		sumIdx,
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "86400:256|6:4:-10:-5|10:30|10:30|hello-10|world-30|6");
});
