// Slice BCE verification (v1.8.0): compiles the `mathx` snapshot under
// ./raycast/ as a `both` package, once as written and once with Go's
// `_ = m[15]` hint added to every function taking a Mat4, and counts the
// `__at`/`__ix` bounds-check calls left in the matrix functions.  The hinted
// build must emit none; the plain build must still emit them.
//
//   node test/perf/bce-mathx.js

import assert from "node:assert";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDir } from "../../src/compiler.js";

const FIXTURE = fileURLToPath(new URL("./raycast/mathx", import.meta.url));

// Adds `_ = p[15]` as the first statement of every function with Mat4 params.
export function addHints(source) {
	return source.replace(
		/^func [^\n]*\(([^)]*)\)[^\n]*\{$/gm,
		(head, params) => {
			const names = [];
			let pending = [];
			for (const part of params.split(",").map((p) => p.trim())) {
				const [name, type] = part.split(/\s+/);
				pending.push(name);
				if (type) {
					if (type === "Mat4") names.push(...pending);
					pending = [];
				}
			}
			return names.length === 0
				? head
				: `${head}\n${names.map((n) => `\t_ = ${n}[15]`).join("\n")}`;
		},
	);
}

// Bounds-check calls in the emitted body of each top-level function
// `name(...)` or method whose name contains "Mat4".  The hints themselves
// (`_ = m[15]`, emitted as a bare `__at(m, 15);`) keep their check by design
// and are not counted.
function matrixChecks(js) {
	const heads = [
		...js.matchAll(/^(?:export )?function ([\w$]*Mat4[\w$]*)\(/gm),
	];
	const counts = {};
	for (const [i, m] of heads.entries()) {
		const end = heads[i + 1]?.index ?? js.length;
		const body = js.slice(m.index, end).replace(/^\s*__at\(\w+, 15\);$/gm, "");
		counts[m[1]] = (body.match(/__at\(|__ix\(/g) ?? []).length;
	}
	return counts;
}

function build(hinted) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-bce-"));
	try {
		cpSync(FIXTURE, dir, { recursive: true });
		if (hinted) {
			const p = join(dir, "mat4.go");
			writeFileSync(p, addHints(readFileSync(p, "utf8")));
		}
		return compileDir(dir, { forceTarget: "both" }).js;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const plain = matrixChecks(build(false));
const hinted = matrixChecks(build(true));
const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

assert(
	Object.keys(hinted).length > 10,
	"expected the Mat4 functions in the output",
);
assert(total(plain) > 0, "unhinted build should still emit bounds checks");
// Functions without a Mat4 parameter take no hint and keep their checks.
const offenders = Object.entries(hinted).filter(
	([name, n]) => n > 0 && n !== plain[name],
);
assert.deepStrictEqual(offenders, [], "hinted matrix functions emit __at/__ix");
console.log(
	`bce-mathx: ${total(plain)} bounds checks without hints, ${total(hinted)} with hints across ${Object.keys(hinted).length} Mat4 functions`,
);
