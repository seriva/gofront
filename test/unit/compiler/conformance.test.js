// GoFront test suite — conformance runner (test/conformance/run.js)

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFORMANCE_DIR,
	checkFixture,
	findFixtures,
	lintFixture,
	runFixture,
} from "../../conformance/run.js";
import {
	goOutput,
	goVersion,
	UPDATE_SCRIPT,
} from "../../conformance/update.js";
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

test("runs a fixture on JS and WASM with byte-exact stdout", async () => {
	await withTempDir({ "fmt/hello.go": HELLO }, async (dir) => {
		const { js, wasm } = await runFixture(join(dir, "fmt/hello.go"));
		assertEqual(js, "hi 3\nab\n");
		assertEqual(wasm, "hi 3\nab\n");
	});
});

test("a fixture may import a Go-source stdlib package", async () => {
	const src = `package main

import (
	"cmp"
	"fmt"
	"slices"
)

func main() {
	fmt.Println(cmp.Compare(1, 2), slices.Collect(slices.Values([]int{4, 5})))
}
`;
	await withTempDir({ "slices/std.go": src }, async (dir) => {
		const { js, wasm } = await runFixture(join(dir, "slices/std.go"));
		assertEqual(js, "-1 [4 5]\n");
		assertEqual(wasm, "-1 [4 5]\n");
	});
});

test("a fixture matching its .out passes", async () => {
	await withTempDir(
		{ "fmt/hello.go": HELLO, "fmt/hello.out": "hi 3\nab\n" },
		async (dir) => {
			const res = await checkFixture(join(dir, "fmt/hello.go"));
			assert(res.ok, res.message);
		},
	);
});

test("a missing .out fails with the conformance:update hint", async () => {
	await withTempDir({ "fmt/hello.go": HELLO }, async (dir) => {
		const res = await checkFixture(join(dir, "fmt/hello.go"));
		assert(!res.ok, "expected failure");
		assertContains(res.message, "missing fmt/hello.out");
		assertContains(res.message, "npm run conformance:update");
	});
});

test("an output difference fails and names the backend and line", async () => {
	await withTempDir(
		{ "fmt/hello.go": HELLO, "fmt/hello.out": "hi 4\nab\n" },
		async (dir) => {
			const res = await checkFixture(join(dir, "fmt/hello.go"));
			assert(!res.ok, "expected failure");
			assertContains(res.message, "JS output differs from fmt/hello.out");
			assertContains(res.message, "WASM output differs from fmt/hello.out");
			assertContains(res.message, 'line 1: want "hi 4", got "hi 3"');
		},
	);
});

test("a trailing newline difference is a failure (byte for byte)", async () => {
	await withTempDir(
		{ "fmt/hello.go": HELLO, "fmt/hello.out": "hi 3\nab" },
		async (dir) => {
			const res = await checkFixture(join(dir, "fmt/hello.go"));
			assert(!res.ok, "expected failure");
			assertContains(res.message, "JS output differs");
		},
	);
});

test("a compile error fails with the diagnostic", async () => {
	await withTempDir(
		{
			"fmt/bad.go": `package main

import "fmt"

func main() {
	fmt.Println(undefinedName)
}
`,
			"fmt/bad.out": "",
		},
		async (dir) => {
			const res = await checkFixture(join(dir, "fmt/bad.go"));
			assert(!res.ok, "expected failure");
			assertContains(res.message, "undefinedName");
		},
	);
});

section("Conformance fixture lint (string semantics)");

const wrap = (body) =>
	`package main\n\nimport "fmt"\n\nfunc main() {\n${body}\n}\n`;

test("len, index and range on a non-ASCII string literal are rejected", () => {
	const src = wrap(
		[
			'\tfmt.Println(len("h\u00e9llo"))',
			'\tfmt.Println("héllo"[1])',
			'\tfmt.Println("héllo"[1:])',
			"\tfor i := range `héllo` {",
			"\t\tfmt.Println(i)",
			"\t}",
			'\tfmt.Println(len("\\xc3"))',
		].join("\n"),
	);
	const errs = lintFixture(src, "fmt/bad.go");
	assertEqual(errs.length, 5);
	assertContains(errs[0], "fmt/bad.go:6: len() of a non-ASCII string literal");
	assertContains(errs[1], "fmt/bad.go:7: indexing a non-ASCII string literal");
	assertContains(
		errs[3],
		"fmt/bad.go:9: range over a non-ASCII string literal",
	);
	assertContains(errs[4], "fmt/bad.go:12: len()");
	assertContains(errs[0], "UTF-16 code units");
	assertContains(errs[0], "[]byte(s)");
});

test("ASCII literals and []byte/[]rune forms are allowed", () => {
	const src = wrap(
		[
			'\tfmt.Println(len("hello"), "abc"[1], len([]byte("héllo")))',
			'\tfmt.Println(len([]rune("héllo")), "héllo", `raw \\xc3`)',
			'\tfor _, r := range []rune("héllo") {',
			"\t\tfmt.Println(r)",
			"\t}",
			'\tfmt.Println(len("\\\\xc3"), len("\\u0041"), "\\x41"[0])',
		].join("\n"),
	);
	assertEqual(lintFixture(src, "fmt/ok.go").join("\n"), "");
});

test("a fixture failing the lint is rejected before it runs", async () => {
	await withTempDir(
		{
			"strings/bad.go": wrap('\tfmt.Println(len("é"))'),
			"strings/bad.out": "1\n",
		},
		async (dir) => {
			const res = await checkFixture(join(dir, "strings/bad.go"));
			assert(!res.ok, "expected failure");
			assertContains(res.message, "strings/bad.go:6: len() of a non-ASCII");
		},
	);
});

test("a fixture the lexer rejects fails instead of throwing", async () => {
	await withTempDir(
		{
			"strings/unlexable.go": wrap('\tfmt.Println(len("é))'),
			"strings/unlexable.out": "1\n",
		},
		async (dir) => {
			const res = await checkFixture(join(dir, "strings/unlexable.go"));
			assert(!res.ok, "expected failure");
			assertContains(res.message, "strings/unlexable.go: ");
			assertContains(res.message, "Unterminated");
		},
	);
});

section("Conformance update (real Go)");

test("conformance:update fails clearly when go is missing", () => {
	withTempDir((dir) => {
		const res = spawnSync(process.execPath, [UPDATE_SCRIPT], {
			encoding: "utf8",
			env: { PATH: dir },
		});
		assertEqual(res.status, 1);
		assertContains(res.stderr, "needs the Go toolchain (go1.26)");
	});
});

test("regenerating the checked-in fixtures leaves them unchanged", () => {
	const version = goVersion();
	if (!version?.startsWith("go1.26")) return; // no go1.26: CI has no Go
	for (const f of findFixtures(CONFORMANCE_DIR)) {
		const want = readFileSync(f.replace(/\.go$/, ".out"), "utf8");
		assertEqual(goOutput(f), want);
	}
});
