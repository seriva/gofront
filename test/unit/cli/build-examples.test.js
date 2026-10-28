// GoFront test suite — example build script (scripts/build-examples.js)

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { listExamples } from "../../../scripts/build-examples.js";
import {
	assert,
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
