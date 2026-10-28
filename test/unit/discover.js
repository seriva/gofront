// GoFront test suite — test file discovery
// Kept apart from run.js so a test can import the list without starting the suite.

import { readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const UNIT_DIR = fileURLToPath(new URL(".", import.meta.url));

// Every *.test.js below `dir` (skipping fixtures/ directories), as sorted
// "./relative/path.test.js" specifiers.
export function discoverTestFiles(dir = UNIT_DIR) {
	const found = [];
	const walk = (rel) => {
		for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (entry.name !== "fixtures") walk(posix.join(rel, entry.name));
			} else if (entry.name.endsWith(".test.js")) {
				found.push(`./${posix.join(rel, entry.name)}`);
			}
		}
	};
	walk("");
	return found.sort();
}

export function assertHeaviestPresent(testFiles, heaviest) {
	for (const f of heaviest) {
		if (!testFiles.includes(f)) {
			throw new Error(`HEAVIEST_TEST_FILES entry not found: ${f}`);
		}
	}
}

export const TEST_FILES = discoverTestFiles();

// Scheduling hint: the slowest files start first. An entry that no longer
// exists fails at startup instead of silently losing its slot.
export const HEAVIEST_TEST_FILES = [
	"./wasm/optimize.test.js",
	"./compiler/optimize-build.test.js",
	"./builtins/gom.test.js",
	"./compiler/templ.test.js",
	"./builtins/dom.test.js",
	"./compiler/test-runner.test.js",
	"./compiler/prep.test.js",
	"./wasm/boundary.test.js",
	"./compiler/cli.test.js",
	"./wasm/stdlib.test.js",
	"./compiler/cli-core.test.js",
	"./builtins/stdlib.test.js",
	"./compiler/packages.test.js",
];

assertHeaviestPresent(TEST_FILES, HEAVIEST_TEST_FILES);
