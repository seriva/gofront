// Vendor dependency bundler for GoFront projects.
// Dynamically loads a bundler (rolldown or esbuild) from consumer devDependencies.

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function getExportNames(pkgName) {
	const base = pkgName.replace(/^@[^/]+\//, "");
	const clean = base.replace(/[^a-zA-Z0-9_]/g, "_");
	const names = new Set([pkgName, base, clean]);

	if (pkgName === "@emailjs/browser") names.add("emailjs");
	if (pkgName === "fuse.js") {
		names.add("Fuse");
		names.add("fuse");
	}
	if (pkgName === "prismjs") {
		names.add("Prism");
		names.add("prism");
	}
	if (pkgName === "marked") {
		names.add("marked");
	}

	return [...names];
}

export function generateVendorEntry(packages) {
	const imports = [];
	const assignments = [];
	const exports = [];

	packages.forEach((pkg, idx) => {
		const id = `_dep_${idx}`;
		imports.push(`import * as ${id} from ${JSON.stringify(pkg)};`);

		const names = getExportNames(pkg);
		for (const name of names) {
			assignments.push(
				`    window[${JSON.stringify(name)}] = ${id}.default || ${id};`,
			);
		}

		const cleanId = pkg
			.replace(/^@[^/]+\//, "")
			.replace(/[^a-zA-Z0-9_$]/g, "_");
		exports.push(`    ${id} as ${cleanId}`);
	});

	return `// Auto-generated GoFront vendor entry point
${imports.join("\n")}

if (typeof window !== "undefined") {
${assignments.join("\n")}
}

export {
${exports.join(",\n")}
};
`;
}

export function findBundler(projectDir) {
	const pkgPath = join(projectDir, "package.json");
	let req;
	if (existsSync(pkgPath)) {
		req = createRequire(pkgPath);
	} else {
		req = createRequire(join(projectDir, "dummy.js"));
	}

	try {
		const path = req.resolve("rolldown");
		return { name: "rolldown", path };
	} catch {}

	try {
		const path = req.resolve("esbuild");
		return { name: "esbuild", path };
	} catch {}

	return null;
}

export function loadVendorConfig(projectDir) {
	const pkgPath = join(projectDir, "package.json");
	let pkg = {};
	if (existsSync(pkgPath)) {
		try {
			pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		} catch {}
	}

	const gfjPath = join(projectDir, "gofront.json");
	let gfj = {};
	if (existsSync(gfjPath)) {
		try {
			gfj = JSON.parse(readFileSync(gfjPath, "utf8"));
		} catch {}
	}

	const vendorConfig = gfj.vendor ?? pkg.vendor ?? null;
	const dependencies = Object.keys(pkg.dependencies ?? {});

	let dest = null;
	let packages = dependencies;
	let minify = false;

	if (typeof vendorConfig === "string") {
		dest = vendorConfig;
	} else if (vendorConfig && typeof vendorConfig === "object") {
		if (vendorConfig.dest) dest = vendorConfig.dest;
		if (Array.isArray(vendorConfig.packages)) packages = vendorConfig.packages;
		if (typeof vendorConfig.minify === "boolean") minify = vendorConfig.minify;
	}

	if (!dest) {
		dest = existsSync(join(projectDir, "app")) ? "app/vendor.js" : "vendor.js";
	}

	return { dest, packages, minify };
}

export function resolveDestinationPaths(projectRoot, dest) {
	const destList = Array.isArray(dest) ? dest : [dest];
	if (destList.length === 0) {
		throw new Error(
			"gofront: at least one vendor destination must be specified",
		);
	}

	return destList.map((d) => {
		const fullPath = resolve(projectRoot, d);
		const relDest = relative(projectRoot, fullPath);
		if (relDest.startsWith("..") || isAbsolute(relDest)) {
			throw new Error(
				`gofront: vendor destination '${d}' is outside project directory`,
			);
		}
		return fullPath;
	});
}

async function runBundler(
	bundlerInfo,
	{ projectRoot, entryFile, destPath, minify },
) {
	if (bundlerInfo.name === "rolldown") {
		const rolldownModule =
			bundlerInfo.instance ??
			(await import(pathToFileURL(bundlerInfo.path).href));
		const rolldownFn =
			rolldownModule.rolldown ||
			rolldownModule.default?.rolldown ||
			rolldownModule.default;

		const bundle = await rolldownFn({
			input: entryFile,
			cwd: projectRoot,
		});
		await bundle.write({
			file: destPath,
			format: "esm",
			minify: Boolean(minify),
		});
		await bundle.close();
		return;
	}

	if (bundlerInfo.name === "esbuild") {
		const esbuildModule =
			bundlerInfo.instance ??
			(await import(pathToFileURL(bundlerInfo.path).href));
		const buildFn =
			esbuildModule.build || esbuildModule.default?.build || esbuildModule;

		await buildFn({
			entryPoints: [entryFile],
			bundle: true,
			format: "esm",
			outfile: destPath,
			absWorkingDir: projectRoot,
			minify: Boolean(minify),
		});
	}
}

export async function bundleVendor(projectDir = ".", options = {}) {
	const projectRoot = resolve(projectDir);
	const config = loadVendorConfig(projectRoot);

	const packages = options.packages ?? config.packages;
	const dest = options.dest ?? config.dest;
	const minify = options.minify ?? config.minify ?? false;

	if (!packages || packages.length === 0) {
		return {
			bundled: [],
			skipped: 0,
			dest,
			minify: Boolean(minify),
			message: "no external dependencies found",
		};
	}

	const destPaths = resolveDestinationPaths(projectRoot, dest);
	const bundlerInfo = options.bundler ?? findBundler(projectRoot);
	if (!bundlerInfo) {
		console.warn(
			"gofront: no bundler found (rolldown or esbuild). Run 'npm install --save-dev rolldown' to enable vendor bundling.",
		);
		return {
			bundled: [],
			skipped: packages.length,
			dest,
			bundler: null,
			minify: Boolean(minify),
			reason: "no bundler installed",
		};
	}

	for (const p of destPaths) {
		mkdirSync(dirname(p), { recursive: true });
	}

	if (typeof bundlerInfo.bundle === "function") {
		await bundlerInfo.bundle({
			projectRoot,
			packages,
			dest: destPaths.length === 1 ? destPaths[0] : destPaths,
			minify: Boolean(minify),
		});
		return {
			bundled: packages,
			bundler: bundlerInfo.name ?? "custom",
			dest,
			minify: Boolean(minify),
		};
	}

	const entryCode = generateVendorEntry(packages);
	const entryFile = join(
		projectRoot,
		`.gofront-vendor-entry-${Date.now()}.mjs`,
	);
	writeFileSync(entryFile, entryCode);

	try {
		await runBundler(bundlerInfo, {
			projectRoot,
			entryFile,
			destPath: destPaths[0],
			minify,
		});

		for (let i = 1; i < destPaths.length; i++) {
			copyFileSync(destPaths[0], destPaths[i]);
		}
	} finally {
		if (existsSync(entryFile)) {
			rmSync(entryFile, { force: true });
		}
	}

	return {
		bundled: packages,
		bundler: bundlerInfo.name,
		dest,
		minify: Boolean(minify),
	};
}
