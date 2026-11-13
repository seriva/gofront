// Builds every example under example/ that has a src/ directory:
//   node src/index.js example/<name>/src -o example/<name>/app.js
// A new example is picked up without editing package.json.
//
// It then builds each example a second time the way `gofront build` ships it
// (minified) into a temporary directory and parse-checks every emitted `.js`
// file, so a minifier bug that produces invalid JavaScript fails the build.
//
// Run: node scripts/build-examples.js   (exit code of the first failing build)

import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Names of the example directories under <root>/example that have a src/ dir.
export function listExamples(root) {
	const dir = join(root, "example");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => {
			const p = join(dir, name);
			return statSync(p).isDirectory() && existsSync(join(p, "src"));
		})
		.sort();
}

// Parses `source` as an ES module with `node --check`. Returns null when it
// parses, else the `SyntaxError: ...` line. The source is written to a temp
// `.mjs` so `import`/`export` are accepted exactly as a browser accepts them.
export function checkSyntax(source, name = "bundle") {
	const dir = mkdtempSync(join(tmpdir(), "gofront-syntax-"));
	try {
		const file = join(dir, `${name}.mjs`);
		writeFileSync(file, source);
		// stderr goes to a file: node echoes the whole offending source line and a
		// piped stderr can be cut short when the process exits.
		const errFile = join(dir, "stderr.txt");
		const fd = openSync(errFile, "w");
		let status;
		try {
			status = spawnSync(process.execPath, ["--check", file], {
				stdio: ["ignore", "ignore", fd],
			}).status;
		} finally {
			closeSync(fd);
		}
		if (status === 0) return null;
		const err = /^SyntaxError:.*$/m.exec(readFileSync(errFile, "utf8"));
		return err ? err[0] : "SyntaxError: unknown";
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Parse-checks every `.js` file below `dir`. Returns the checked file paths and
// throws on the first file that does not parse, naming the file and the error.
export function checkBundle(dir) {
	const checked = [];
	const walk = (d) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (entry.name.endsWith(".js")) {
				const err = checkSyntax(readFileSync(p, "utf8"), "bundle");
				if (err) throw new Error(`${p}: ${err}`);
				checked.push(p);
			}
		}
	};
	walk(dir);
	return checked;
}

function run(args) {
	const res = spawnSync(
		process.execPath,
		[join(ROOT, "src/index.js"), ...args],
		{
			cwd: ROOT,
			stdio: "inherit",
		},
	);
	if (res.status !== 0) process.exit(res.status ?? 1);
}

function main() {
	const names = listExamples(ROOT);
	for (const name of names) {
		run([`example/${name}/src`, "-o", `example/${name}/app.js`]);
	}
	const tmp = mkdtempSync(join(tmpdir(), "gofront-examples-"));
	try {
		for (const name of names) {
			const out = join(tmp, name);
			mkdirSync(out, { recursive: true });
			run(["build", `example/${name}`, "-o", out]);
			try {
				checkBundle(out);
			} catch (e) {
				console.error(
					`minified build of example/${name} is invalid: ${e.message}`,
				);
				process.exit(1);
			}
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main();
