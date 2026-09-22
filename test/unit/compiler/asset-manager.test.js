// GoFront test suite — asset-manager unit tests
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyAssets, loadAssetConfig } from "../../../src/asset-manager.js";
import {
	assert,
	assertContains,
	assertEqual,
	section,
	summarize,
	test,
} from "../helpers.js";

section("asset-manager — file and directory copying");

test("copies single file to explicit destination path", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-file-"));
	try {
		const srcFile = join(dir, "source.txt");
		writeFileSync(srcFile, "hello assets");

		const result = copyAssets(dir, [
			{ source: "source.txt", dest: "output/dest.txt" },
		]);

		assertEqual(result.copied, 1);
		assertEqual(result.skipped, 0);
		const copiedFile = join(dir, "output", "dest.txt");
		assert(existsSync(copiedFile), "expected copied file to exist");
		assertEqual(readFileSync(copiedFile, "utf8"), "hello assets");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("copies single file into destination directory ending with /", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-dirslash-"));
	try {
		const srcFile = join(dir, "font.woff2");
		writeFileSync(srcFile, "font-bytes");

		const result = copyAssets(dir, [
			{ source: "font.woff2", dest: "assets/fonts/" },
		]);

		assertEqual(result.copied, 1);
		const copiedFile = join(dir, "assets", "fonts", "font.woff2");
		assert(existsSync(copiedFile), "expected font to be placed in fonts/");
		assertEqual(readFileSync(copiedFile, "utf8"), "font-bytes");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("copies directory tree recursively", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-tree-"));
	try {
		const treeDir = join(dir, "node_modules", "pkg", "themes");
		mkdirSync(join(treeDir, "sub"), { recursive: true });
		writeFileSync(join(treeDir, "theme.css"), "/* theme */");
		writeFileSync(join(treeDir, "sub", "subtheme.css"), "/* subtheme */");

		const result = copyAssets(dir, [
			{ source: "node_modules/pkg/themes", dest: "dist/css/themes" },
		]);

		assertEqual(result.copied, 1);
		const destTheme = join(dir, "dist", "css", "themes", "theme.css");
		const destSub = join(dir, "dist", "css", "themes", "sub", "subtheme.css");
		assert(existsSync(destTheme), "expected theme.css to exist in dest");
		assert(existsSync(destSub), "expected subtheme.css to exist in dest");
		assertEqual(readFileSync(destTheme, "utf8"), "/* theme */");
		assertEqual(readFileSync(destSub, "utf8"), "/* subtheme */");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("asset-manager — edge cases & error handling");

test("gracefully skips non-existent source paths", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-missing-"));
	try {
		const result = copyAssets(dir, [
			{ source: "does/not/exist.png", dest: "app/img.png" },
		]);

		assertEqual(result.copied, 0);
		assertEqual(result.skipped, 1);
		assertEqual(result.items[0].status, "skipped");
		assertEqual(result.items[0].reason, "source not found");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("throws error when destination attempts directory traversal", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-trav-"));
	try {
		const srcFile = join(dir, "file.txt");
		writeFileSync(srcFile, "data");

		let threw = false;
		try {
			copyAssets(dir, [{ source: "file.txt", dest: "../outside.txt" }]);
		} catch (err) {
			threw = true;
			assertContains(err.message, "outside project directory");
		}
		assert(threw, "expected copyAssets to throw on traversal attempt");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("asset-manager — configuration loading");

test("reads assetCopy configuration from package.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-pkg-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				assetCopy: [{ source: "icon.svg", dest: "public/icon.svg" }],
			}),
		);
		writeFileSync(join(dir, "icon.svg"), "<svg></svg>");

		const config = loadAssetConfig(dir);
		assertEqual(config.length, 1);
		assertEqual(config[0].source, "icon.svg");

		const result = copyAssets(dir);
		assertEqual(result.copied, 1);
		assert(existsSync(join(dir, "public", "icon.svg")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("reads assetCopy configuration from gofront.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-gfj-"));
	try {
		writeFileSync(
			join(dir, "gofront.json"),
			JSON.stringify({
				assetCopy: [{ source: "logo.png", dest: "dist/logo.png" }],
			}),
		);
		writeFileSync(join(dir, "logo.png"), "png-data");

		const config = loadAssetConfig(dir);
		assertEqual(config.length, 1);
		assertEqual(config[0].source, "logo.png");

		const result = copyAssets(dir);
		assertEqual(result.copied, 1);
		assert(existsSync(join(dir, "dist", "logo.png")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns empty result when no assetCopy config is present", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-asset-empty-"));
	try {
		const result = copyAssets(dir);
		assertEqual(result.copied, 0);
		assertEqual(result.skipped, 0);
		assertEqual(result.items.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
