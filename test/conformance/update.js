// Captures the expected output of every conformance fixture from real Go:
// `go run <pkg>/<name>.go` (go1.26) writes <pkg>/<name>.out. Needs `go` on
// PATH; the checked-in .out files mean `npm run conformance` and CI do not.
//
//   npm run conformance:update [-- <pkg-dir-or-fixture>...]

import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFORMANCE_DIR, findFixtures } from "./run.js";

export const GO_VERSION = "go1.26";
export const UPDATE_SCRIPT = fileURLToPath(import.meta.url);

// `go1.26.x`, or null when there is no usable go on PATH.
export function goVersion() {
	try {
		const out = execFileSync("go", ["env", "GOVERSION"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.trim() || null;
	} catch {
		return null;
	}
}

// The stdout of `go run` on one fixture. Throws with Go's stderr on failure.
export function goOutput(goPath) {
	try {
		return execFileSync("go", ["run", goPath], {
			cwd: dirname(goPath),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (e) {
		throw new Error(
			`go run ${relative(CONFORMANCE_DIR, goPath)} failed:\n${e.stderr || e.message}`,
		);
	}
}

function selectFixtures(args) {
	if (args.length === 0) return findFixtures(CONFORMANCE_DIR);
	const out = [];
	for (const arg of args) {
		const p = resolve(arg);
		if (statSync(p).isDirectory()) {
			out.push(...findFixtures(dirname(p)).filter((f) => dirname(f) === p));
		} else out.push(p);
	}
	return out;
}

function main(args) {
	const version = goVersion();
	if (!version) {
		process.stderr.write(
			`conformance:update needs the Go toolchain (${GO_VERSION}) on PATH: install it from https://go.dev/dl/\n`,
		);
		return 1;
	}
	if (!version.startsWith(GO_VERSION)) {
		process.stderr.write(
			`conformance:update needs ${GO_VERSION}.x, found ${version}\n`,
		);
		return 1;
	}
	let changed = 0;
	for (const f of selectFixtures(args)) {
		const outPath = f.replace(/\.go$/, ".out");
		const out = goOutput(f);
		let old = null;
		try {
			old = readFileSync(outPath, "utf8");
		} catch {}
		const name = relative(CONFORMANCE_DIR, outPath);
		if (old === out) {
			process.stdout.write(`  unchanged ${name}\n`);
			continue;
		}
		writeFileSync(outPath, out);
		changed++;
		process.stdout.write(`  ${old === null ? "created" : "updated"} ${name}\n`);
	}
	process.stdout.write(`conformance:update: ${changed} file(s) written\n`);
	return 0;
}

if (process.argv[1] === UPDATE_SCRIPT) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (e) {
		process.stderr.write(`${e.message}\n`);
		process.exitCode = 1;
	}
}
