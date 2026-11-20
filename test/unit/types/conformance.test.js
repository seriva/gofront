// GoFront test suite — conformance corpus
//
// test/unit/fixtures/conformance/{reject,accept}/ holds one program per case
// (a `.go` file, or a directory with `main.go` for multi-file, multi-package
// and `.d.ts` cases).
//
// Reject cases mark each offending line with Go's `// ERROR "substring"`
// convention. The compiler must throw a `CompileError` on `js`, `both` and
// `wasm` (through `forceTarget`) with an entry on that line whose message
// contains the substring.
//
// Accept cases end in a `// Output:` comment block with the text the program
// prints, checked on every target by `assertOutput`. A `// compile-only`
// header only requires that the program compiles, and `// targets: js`
// restricts the targets (for interop that cannot run under node).
//
// A `// pending: S<n>` header marks a case that a later change fixes: the
// runner then requires the case to still fail, so removing the marker is the
// failing test of the change that fixes it.

import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError, compileFiles } from "../../../src/compiler.js";
import {
	assertOutput,
	compileDir,
	FIXTURES,
	section,
	summarize,
	test,
} from "../helpers.js";

const CORPUS = join(FIXTURES, "conformance");
const TARGETS = ["js", "both", "wasm"];

function listCases(kind) {
	const dir = join(CORPUS, kind);
	return readdirSync(dir)
		.filter((f) => f.endsWith(".go") || statSync(join(dir, f)).isDirectory())
		.sort()
		.map((f) => {
			const isDir = !f.endsWith(".go");
			const path = join(dir, f);
			const mainFile = isDir ? join(path, "main.go") : path;
			return {
				name: isDir ? f : f.slice(0, -3),
				path,
				isDir,
				source: readFileSync(mainFile, "utf8"),
			};
		});
}

function headerValue(source, key) {
	const m = new RegExp(`^// ${key}:?[ \\t]*(.*)$`, "m").exec(source);
	return m ? m[1].trim() : null;
}

function hasHeader(source, key) {
	return new RegExp(`^// ${key}\\s*$`, "m").test(source);
}

// The `// ERROR "..."` markers: [{ line, text }] (1-based lines).
function expectedErrors(source) {
	const out = [];
	const lines = source.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /\/\/ ERROR "((?:[^"\\]|\\.)*)"/.exec(lines[i]);
		if (m) out.push({ line: i + 1, text: JSON.parse(`"${m[1]}"`) });
	}
	return out;
}

// The expected stdout of an accept case, from its trailing `// Output:` block.
function expectedOutput(source) {
	const lines = source.split("\n");
	const at = lines.findIndex((l) => l.trim() === "// Output:");
	if (at < 0) return null;
	const body = [];
	for (const l of lines.slice(at + 1)) {
		if (!l.startsWith("//")) break;
		body.push(l.replace(/^\/\/ ?/, ""));
	}
	return body.length > 0 ? `${body.join("\n")}\n` : "";
}

function targetsOf(source) {
	const t = headerValue(source, "targets");
	return t ? t.split(/[ ,]+/) : TARGETS;
}

function compileCase(c, target) {
	const options = { forceTarget: target };
	return c.isDir
		? compileDir(c.path, options)
		: compileFiles([c.path], options);
}

// A diagnostic without the code frame the lexer, parser and checker append
// (`  <line> | <source>` and the caret line under it). The frame repeats the
// source line, `// ERROR "..."` marker included, so matching against it would
// let any marker text pass.
function diagnosticText(message) {
	return message
		.split("\n")
		.filter((l) => !/^ {2}\d+ \| /.test(l) && !/^ +\^$/.test(l))
		.join("\n");
}

// What is wrong with a reject case, or [] when it behaves as marked.
function rejectProblems(c) {
	const wants = expectedErrors(c.source);
	if (wants.length === 0) return ["no // ERROR marker in the case"];
	const problems = [];
	for (const target of TARGETS) {
		let errors;
		try {
			compileCase(c, target);
			problems.push(`${target}: compiled without an error`);
			continue;
		} catch (e) {
			if (!(e instanceof CompileError)) {
				problems.push(
					`${target}: crashed: ${String(e.message).split("\n")[0]}`,
				);
				continue;
			}
			errors = e.errors;
		}
		for (const want of wants) {
			const hit = errors.some(
				(e) =>
					e.line === want.line && diagnosticText(e.message).includes(want.text),
			);
			if (!hit) {
				const got = errors
					.map((e) => `${e.line ?? "?"}:${e.message.split("\n")[0]}`)
					.join(" | ");
				problems.push(
					`${target}: no error at line ${want.line} containing ${JSON.stringify(want.text)}; got ${got}`,
				);
			}
		}
	}
	return problems;
}

async function acceptProblems(c) {
	const targets = targetsOf(c.source);
	try {
		if (hasHeader(c.source, "compile-only")) {
			for (const target of targets) compileCase(c, target);
		} else {
			const want = expectedOutput(c.source);
			if (want === null) return ["no // Output: block in the case"];
			await assertOutput(c.source, want, { targets });
		}
	} catch (e) {
		return [String(e.message).split("\n").slice(0, 3).join(" ")];
	}
	return [];
}

async function check(kind, c) {
	return kind === "reject" ? rejectProblems(c) : acceptProblems(c);
}

section("Conformance — harness");

test("an // ERROR marker does not match the source line echoed in the message", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-conformance-"));
	try {
		const source =
			'package main\n\nfunc main() {\n\tvar x int = "a" // ERROR "zzz-not-in-any-message"\n\t_ = x\n}\n';
		const path = join(dir, "self-match.go");
		writeFileSync(path, source);
		const problems = rejectProblems({
			name: "self-match",
			path,
			isDir: false,
			source,
		});
		if (problems.length !== TARGETS.length)
			throw new Error(
				`want one miss per target, got: ${JSON.stringify(problems)}`,
			);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const kind of ["reject", "accept"]) {
	section(`Conformance — ${kind}`);
	for (const c of listCases(kind)) {
		const pending = headerValue(c.source, "pending");
		test(`${kind}/${c.name}${pending ? ` (pending ${pending})` : ""}`, async () => {
			const problems = await check(kind, c);
			if (pending) {
				if (problems.length === 0)
					throw new Error(
						`the case now passes: delete its "// pending: ${pending}" header`,
					);
				return;
			}
			if (problems.length > 0) throw new Error(problems.join("\n"));
		});
	}
}

summarize();
