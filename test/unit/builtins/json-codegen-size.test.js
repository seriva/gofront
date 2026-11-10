// GoFront test suite — encoding/json codec count for dynamic marshal sites

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFiles } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	assertProgramOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

// The number of generated JSON codec functions in the js output of `source`.
function codecCount(source) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-json-size-"));
	try {
		const goPath = join(dir, "main.go");
		writeFileSync(goPath, source);
		const { js } = compileFiles([goPath], { forceTarget: "js" });
		return (js.match(/function gfj_\w+/g) ?? []).length;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const unusedTypes = (n) =>
	Array.from(
		{ length: n },
		(_, i) =>
			`type T${i} struct{ X int; Y []float32; Z map[string]int }\nfunc (t T${i}) Get() int { return t.X }`,
	).join("\n");

const DYNAMIC = `
type Cfg struct{ A int; B string }
func main() {
	var v any = Cfg{1, "x"}
	b, _ := json.Marshal(v)
	console.log(string(b))
}`;

section("encoding/json — dynamic codec reachability");

test("declared but never boxed types add no codecs", () => {
	const head = 'package main\nimport "encoding/json"\n';
	const base = codecCount(head + DYNAMIC);
	assert(base > 0, "expected generated codecs for the dynamic site");
	assertEqual(codecCount(head + unusedTypes(20) + DYNAMIC), base);
});

test("a declared type boxed through a variable still encodes", async () => {
	await assertProgramOutput(
		`package main
import "encoding/json"
import "fmt"
type T struct{ A int }
func main() {
	var t T
	t.A = 1
	var v any = t
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
}`,
		'{"A":1} <nil>\n',
	);
});

test("a pointer boxed into an interface still encodes", async () => {
	await assertProgramOutput(
		`package main
import "encoding/json"
import "fmt"
type T struct{ A int }
func main() {
	var v any = &T{1}
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
}`,
		'{"A":1} <nil>\n',
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
