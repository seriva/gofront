// GoFront test suite — conformance runner (test/conformance/run.js)

import { join } from "node:path";
import {
	checkFixture,
	findFixtures,
	runFixture,
} from "../../conformance/run.js";
import {
	assert,
	assertContains,
	assertEqual,
	section,
	test,
	withTempDir,
} from "../helpers.js";

const HELLO = `package main

import "fmt"

func main() {
	fmt.Println("hi", 1+2)
	fmt.Printf("%s%s\\n", "a", "b")
}
`;

section("Conformance runner");

test("finds fixtures as <pkg>/<name>.go, sorted", () => {
	withTempDir(
		{
			"strings/b.go": HELLO,
			"strings/a.go": HELLO,
			"fmt/x.go": HELLO,
			"README.md": "",
			"run.js": "",
		},
		(dir) => {
			const rel = findFixtures(dir).map((p) => p.slice(dir.length + 1));
			assertEqual(rel.join(","), "fmt/x.go,strings/a.go,strings/b.go");
		},
	);
});

test("runs a fixture on JS and WASM with byte-exact stdout", () => {
	withTempDir({ "fmt/hello.go": HELLO }, (dir) => {
		const { js, wasm } = runFixture(join(dir, "fmt/hello.go"));
		assertEqual(js, "hi 3\nab\n");
		assertEqual(wasm, "hi 3\nab\n");
	});
});

test("a fixture matching its .out passes", () => {
	withTempDir(
		{ "fmt/hello.go": HELLO, "fmt/hello.out": "hi 3\nab\n" },
		(dir) => {
			const res = checkFixture(join(dir, "fmt/hello.go"));
			assert(res.ok, res.message);
		},
	);
});

test("a missing .out fails with the conformance:update hint", () => {
	withTempDir({ "fmt/hello.go": HELLO }, (dir) => {
		const res = checkFixture(join(dir, "fmt/hello.go"));
		assert(!res.ok, "expected failure");
		assertContains(res.message, "missing fmt/hello.out");
		assertContains(res.message, "npm run conformance:update");
	});
});

test("an output difference fails and names the backend and line", () => {
	withTempDir(
		{ "fmt/hello.go": HELLO, "fmt/hello.out": "hi 4\nab\n" },
		(dir) => {
			const res = checkFixture(join(dir, "fmt/hello.go"));
			assert(!res.ok, "expected failure");
			assertContains(res.message, "JS output differs from fmt/hello.out");
			assertContains(res.message, "WASM output differs from fmt/hello.out");
			assertContains(res.message, 'line 1: want "hi 4", got "hi 3"');
		},
	);
});

test("a trailing newline difference is a failure (byte for byte)", () => {
	withTempDir({ "fmt/hello.go": HELLO, "fmt/hello.out": "hi 3\nab" }, (dir) => {
		const res = checkFixture(join(dir, "fmt/hello.go"));
		assert(!res.ok, "expected failure");
		assertContains(res.message, "JS output differs");
	});
});

test("a compile error fails with the diagnostic", () => {
	withTempDir(
		{
			"fmt/bad.go": `package main

import "fmt"

func main() {
	fmt.Println(undefinedName)
}
`,
			"fmt/bad.out": "",
		},
		(dir) => {
			const res = checkFixture(join(dir, "fmt/bad.go"));
			assert(!res.ok, "expected failure");
			assertContains(res.message, "undefinedName");
		},
	);
});
