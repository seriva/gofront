// Native static asset manager for GoFront projects.
// Zero-dependency file and directory copier using node:fs.

import { copyFileSync, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { log } from "./colors.js";
import { loadProjectConfig } from "./project-config.js";

export function loadAssetConfig(projectDir) {
	const entries = loadProjectConfig(projectDir).assetCopy;
	return Array.isArray(entries) ? entries : [];
}

function copyFileAsset(srcPath, destPath, dest) {
	let targetFile = destPath;
	if (
		dest.endsWith("/") ||
		(existsSync(destPath) && statSync(destPath).isDirectory())
	) {
		targetFile = join(destPath, basename(srcPath));
	}
	mkdirSync(dirname(targetFile), { recursive: true });
	copyFileSync(srcPath, targetFile);
	return targetFile;
}

function copyAssetEntry(entry, projectRoot) {
	if (!entry || typeof entry !== "object") return null;
	const { source, dest } = entry;
	if (!source || !dest) return null;

	const destPath = resolve(projectRoot, dest);
	const relDest = relative(projectRoot, destPath);
	if (
		relDest === ".." ||
		relDest.startsWith(`..${sep}`) ||
		isAbsolute(relDest)
	) {
		throw new Error(
			`gofront: asset destination '${dest}' is outside project directory`,
		);
	}

	const srcPath = resolve(projectRoot, source);
	if (!existsSync(srcPath)) {
		log.warn(`asset source '${source}' not found — skipping`);
		return {
			status: "skipped",
			item: { source, dest, status: "skipped", reason: "source not found" },
		};
	}

	try {
		const stat = statSync(srcPath);
		if (stat.isDirectory()) {
			mkdirSync(destPath, { recursive: true });
			cpSync(srcPath, destPath, { recursive: true, force: true });
			return {
				status: "copied",
				item: { source, dest, type: "directory", status: "copied" },
			};
		}
		const targetFile = copyFileAsset(srcPath, destPath, dest);
		return {
			status: "copied",
			item: { source, dest: targetFile, type: "file", status: "copied" },
		};
	} catch (err) {
		log.warn(`failed to copy asset '${source}': ${err.message}`);
		return {
			status: "failed",
			item: { source, dest, status: "failed", reason: err.message },
		};
	}
}

export function copyAssets(projectDir = ".", config = null) {
	const projectRoot = resolve(projectDir);
	let entries;

	if (Array.isArray(config)) {
		entries = config;
	} else if (config && Array.isArray(config.assetCopy)) {
		entries = config.assetCopy;
	} else {
		entries = loadAssetConfig(projectRoot);
	}

	const items = [];
	let copied = 0;
	let skipped = 0;

	for (const entry of entries) {
		const result = copyAssetEntry(entry, projectRoot);
		if (!result) continue;
		if (result.status === "copied") copied++;
		else skipped++;
		items.push(result.item);
	}

	return { copied, skipped, items };
}
