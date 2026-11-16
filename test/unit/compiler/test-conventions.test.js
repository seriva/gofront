// GoFront test suite — conventions enforced on the test tree itself

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEqual, section, test } from "../helpers.js";

const UNIT_DIR = fileURLToPath(new URL("..", import.meta.url));

function testFiles(dir) {
	const out = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "fixtures" || e.name === "node_modules") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...testFiles(p));
		else if (e.name.endsWith(".test.js")) out.push(p);
	}
	return out;
}

// A negative test must check the message, not just that some error exists.
const WEAK_NEGATIVE = /assert\(\s*[A-Za-z_.]*errors\.length\s*(>|!==)\s*0/;

section("Test conventions");

test("negative tests check error messages, not just errors.length > 0", () => {
	const weak = [];
	for (const file of testFiles(UNIT_DIR)) {
		if (file.endsWith("test-conventions.test.js")) continue;
		readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, i) => {
				if (WEAK_NEGATIVE.test(line))
					weak.push(`${relative(UNIT_DIR, file)}:${i + 1}`);
			});
	}
	assertEqual(weak.join("\n"), "");
});
