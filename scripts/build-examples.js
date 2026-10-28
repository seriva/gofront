// Builds every example under example/ that has a src/ directory:
//   node src/index.js example/<name>/src -o example/<name>/app.js
// A new example is picked up without editing package.json.
//
// Run: node scripts/build-examples.js   (exit code of the first failing build)

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
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

function main() {
	for (const name of listExamples(ROOT)) {
		const res = spawnSync(
			process.execPath,
			[
				join(ROOT, "src/index.js"),
				`example/${name}/src`,
				"-o",
				`example/${name}/app.js`,
			],
			{ cwd: ROOT, stdio: "inherit" },
		);
		if (res.status !== 0) process.exit(res.status ?? 1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main();
