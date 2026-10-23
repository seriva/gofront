// GoFront test suite — stdlib coverage manifest (runtime/stdlib/manifest.json)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildManifest,
	EXCLUDED_CATEGORIES,
	GO_VERSION,
	MANIFEST_PATH,
	parseFeature,
	serializeManifest,
} from "../../../scripts/stdlib-manifest.js";
import {
	assert,
	assertEqual,
	assertThrows,
	section,
	test,
	withTempDir,
} from "../helpers.js";

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const byKey = new Map(
	manifest.entries.map((e) => [`${e.pkg}.${e.name}:${e.kind}`, e]),
);
const entry = (pkg, name, kind) => byKey.get(`${pkg}.${name}:${kind}`);

// The Go API files, when a go1.26 toolchain is installed (CI has none).
function goApiDir() {
	try {
		const root = execFileSync("go", ["env", "GOROOT"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		const dir = join(root, "api");
		return existsSync(join(dir, `${GO_VERSION}.txt`)) ? dir : null;
	} catch {
		return null;
	}
}

section("Stdlib manifest: shape");

test("manifest parses and targets go1.26", () => {
	assertEqual(manifest.go, "go1.26");
	assert(manifest.entries.length > 2000, "manifest has too few entries");
});

test("every entry has pkg, name, kind, signature, status", () => {
	for (const e of manifest.entries)
		for (const field of ["pkg", "name", "kind", "signature", "status"])
			assert(
				typeof e[field] === "string",
				`${e.pkg}.${e.name} has no ${field}`,
			);
});

test("entries are unique", () => {
	assertEqual(byKey.size, manifest.entries.length);
});

test("statuses are todo, js, wasm, both or excluded:<category>", () => {
	const ok = new Set([
		"todo",
		"js",
		"wasm",
		"both",
		...EXCLUDED_CATEGORIES.map((c) => `excluded:${c}`),
	]);
	for (const e of manifest.entries)
		assert(ok.has(e.status), `${e.pkg}.${e.name}: bad status ${e.status}`);
});

section("Stdlib manifest: known members");

test("strconv.ParseInt carries Go's signature", () => {
	assertEqual(
		entry("strconv", "ParseInt", "func").signature,
		"func(string, int, int) (int64, error)",
	);
});

test("methods, fields, interface methods and generics", () => {
	const m = entry("strings", "Builder.WriteString", "method");
	assertEqual(m.recv, "*Builder");
	assertEqual(m.signature, "func(string) (int, error)");
	assertEqual(entry("net/url", "URL.Scheme", "field").signature, "string");
	assertEqual(
		entry("bufio", "ReadWriter.Reader", "field").signature,
		"embedded *Reader",
	);
	assertEqual(entry("sort", "Interface.Len", "method").signature, "func() int");
	assertEqual(
		entry("iter", "Seq", "type").signature,
		"[$0 interface{}] func(func($0) bool)",
	);
	assertEqual(
		entry("cmp", "Or", "func").signature,
		"func[$0 comparable](...$0) $0",
	);
	assertEqual(entry("math", "Pi", "const").signature, "ideal-float");
	assertEqual(entry("time", "UTC", "var").signature, "*Location");
});

test("excluded packages get one package entry with their category", () => {
	assertEqual(entry("reflect", "", "package").status, "excluded:runtime");
	assertEqual(entry("net/http", "", "package").status, "excluded:host");
	assertEqual(
		entry("text/template", "", "package").status,
		"excluded:reflection",
	);
	assertEqual(entry("math/big", "", "package").status, "excluded:deferred");
	assert(
		!manifest.entries.some((e) => e.pkg === "reflect" && e.kind !== "package"),
		"excluded package lists members",
	);
});

test("parseFeature skips const value lines and unexported markers", () => {
	assertEqual(parseFeature("const MaxInt64 = 9223372036854775807"), null);
	assertEqual(parseFeature("type Block interface, unexported methods"), null);
});

section("Stdlib manifest: statuses");

test("no todo entries remain (every in-scope package is scheduled)", () => {
	const todo = manifest.entries.filter((e) => e.status === "todo");
	assertEqual(todo.map((e) => `${e.pkg}.${e.name}`).join(", "), "");
});

test("every excluded: reason is a scope-rule category", () => {
	for (const e of manifest.entries) {
		if (!e.status.startsWith("excluded:")) continue;
		const category = e.status.slice("excluded:".length);
		assert(
			EXCLUDED_CATEGORIES.includes(category),
			`${e.pkg}.${e.name}: unknown category ${category}`,
		);
	}
});

test("member-level classification follows the scope rule tables", () => {
	const status = (pkg, name, kind = "func") => entry(pkg, name, kind)?.status;
	assertEqual(status("strings", "Cut"), "both");
	assertEqual(status("time", "Sleep"), "js");
	assertEqual(status("time", "After"), "excluded:runtime");
	assertEqual(status("time", "Ticker.Stop", "method"), "excluded:runtime");
	assertEqual(status("time", "LoadLocation"), "excluded:host");
	assertEqual(status("time", "Time.MarshalJSON", "method"), "both");
	assertEqual(status("sync", "Cond", "type"), "excluded:runtime");
	assertEqual(status("sync", "OnceValue"), "both");
	assertEqual(status("os", "Stdout", "var"), "both");
	assertEqual(status("os", "Getenv"), "js");
	assertEqual(status("os", "Open"), "excluded:host");
	assertEqual(status("regexp", "MustCompile"), "js");
	assertEqual(status("unicode", "Han", "var"), "excluded:deferred");
	assertEqual(status("unicode", "Letter", "var"), "both");
	assertEqual(status("unicode", "IsLetter"), "both");
	assertEqual(status("math/rand/v2", "NewChaCha8"), "excluded:deferred");
	assertEqual(status("testing", "T.TempDir", "method"), "excluded:host");
	assertEqual(status("testing", "T.Parallel", "method"), "both");
	assertEqual(
		entry("iter", "Pull", "func").note,
		"requires coroutines; out of scope (no runtime)",
	);
	assertEqual(entry("strings", "Cut", "func").note, undefined);
});

section("Stdlib manifest: generator");

// A one-package API tree and overrides file for generator unit tests.
function withFakeApi(overrides, fn) {
	withTempDir(
		{
			"api/go1.26.txt":
				"pkg strings, func Cut(string, string) (string, string, bool)\n" +
				"pkg strings, func Lines(string) iter.Seq[string] #61901\n",
		},
		(dir) => {
			const path = join(dir, "overrides.json");
			writeFileSync(path, JSON.stringify(overrides));
			fn(join(dir, "api"), path);
		},
	);
}

test("an in-scope package without a default status stays todo", () => {
	withFakeApi({ packages: {}, rules: {} }, (api, overrides) => {
		const m = buildManifest(api, overrides);
		assertEqual(m.entries.map((e) => e.status).join(","), "todo,todo");
	});
});

test("an override rule that matches nothing is an error", () => {
	const overrides = {
		packages: { strings: { status: "both" } },
		rules: { strings: [{ status: "js", members: ["Cutt"] }] },
	};
	withFakeApi(overrides, (api, path) =>
		assertThrows(() => buildManifest(api, path), "strings Cutt matches no"),
	);
});

test("regenerating the manifest is a no-op", () => {
	const apiDir = goApiDir();
	if (!apiDir) return; // no Go toolchain: nothing to compare against
	assert(
		serializeManifest(buildManifest(apiDir)) ===
			readFileSync(MANIFEST_PATH, "utf8"),
		"runtime/stdlib/manifest.json is stale; run npm run manifest:update",
	);
});
