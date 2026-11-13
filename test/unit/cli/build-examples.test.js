// GoFront test suite — example build script (scripts/build-examples.js)

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkBundle, listExamples } from "../../../scripts/build-examples.js";
import {
	assert,
	assertContains,
	assertEqual,
	ROOT,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("Example build — listExamples");

test("returns exactly the example directories that have src/", () => {
	withTempDir((dir) => {
		mkdirSync(join(dir, "example/beta/src"), { recursive: true });
		mkdirSync(join(dir, "example/alpha/src"), { recursive: true });
		mkdirSync(join(dir, "example/no-src"), { recursive: true });
		assertEqual(listExamples(dir).join(","), "alpha,beta");
	});
});

test("skips plain files and returns [] without an example directory", () => {
	withTempDir({ "example/readme.txt": "hi" }, (dir) => {
		assertEqual(listExamples(dir).length, 0);
	});
	withTempDir((dir) => {
		assertEqual(listExamples(dir).length, 0);
	});
});

test("the repository examples are all listed", () => {
	assertEqual(
		listExamples(ROOT).join(","),
		"gom,hybrid,preact,simple,templ,webgl",
	);
});

section("Example build — compiled outputs are not tracked");

const trackedExampleFiles = () =>
	execFileSync("git", ["ls-files", "example"], {
		cwd: ROOT,
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean);

test("git does not track example app.js or app.wasm", () => {
	const built = trackedExampleFiles().filter((f) =>
		/^example\/[^/]+\/app\.(js|wasm)$/.test(f),
	);
	assertEqual(built.join(","), "");
});

test("git still tracks the committed preact vendor bundle", () => {
	assert(
		trackedExampleFiles().includes("example/preact/vendor.js"),
		"example/preact/vendor.js should stay tracked",
	);
});

section("Example build — minified bundles parse");

test("checkBundle throws with the file path and SyntaxError for an invalid bundle", () => {
	withTempDir(
		{
			"ok/app.js": "const a = 0b11;\nexport { a };\n",
			"bad/app.js": "const a=0 b00000000;\n",
		},
		(dir) => {
			let thrown = null;
			try {
				checkBundle(join(dir, "bad"));
			} catch (e) {
				thrown = e;
			}
			assert(thrown, "checkBundle should throw for an invalid bundle");
			assertContains(thrown.message, join(dir, "bad", "app.js"));
			assertContains(thrown.message, "SyntaxError");
			assertContains(thrown.message, "b00000000");
			assertEqual(checkBundle(join(dir, "ok")).length, 1);
		},
	);
});

test("checkBundle accepts ES module syntax and ignores non-js files", () => {
	withTempDir(
		{
			"app.js": 'import { x } from "./x.js";\nexport const y = x;\n',
			"index.html": "<script>not js {{</script>",
		},
		(dir) => {
			assertEqual(checkBundle(dir).length, 1);
		},
	);
});

test("every repository example builds minified and parses", () => {
	withTempDir((tmp) => {
		for (const name of listExamples(ROOT)) {
			const out = join(tmp, name);
			execFileSync(
				process.execPath,
				[join(ROOT, "src/index.js"), "build", `example/${name}`, "-o", out],
				{ cwd: ROOT, stdio: "pipe" },
			);
			assert(checkBundle(out).length > 0, `${name}: no bundle emitted`);
		}
	});
});
