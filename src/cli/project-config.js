// Project configuration loader shared by the CLI, asset manager and vendor bundler.
// Settings live in `gofront.json` at the project root, or under `"gofront"` in `package.json`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadProjectConfig(projectRoot) {
	const gofrontJson = join(projectRoot, "gofront.json");
	if (existsSync(gofrontJson)) {
		try {
			const parsed = JSON.parse(readFileSync(gofrontJson, "utf8"));
			if (parsed && typeof parsed === "object") return parsed;
		} catch {}
	}
	const pkgJson = join(projectRoot, "package.json");
	if (existsSync(pkgJson)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
			if (pkg.gofront && typeof pkg.gofront === "object") return pkg.gofront;
		} catch {}
	}
	return {};
}
