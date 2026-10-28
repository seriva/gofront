// GoFront test suite — asset-manager unit tests
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyAssets, loadAssetConfig } from "../../../src/cli/asset-manager.js";
import {
	assert,
	assertEqual,
	assertThrows,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

section("asset-manager — file and directory copying");

test("copies single file to explicit destination path", () => {
	withTempDir({ "source.txt": "hello assets" }, (dir) => {
		const result = copyAssets(dir, [
			{ source: "source.txt", dest: "output/dest.txt" },
		]);

		assertEqual(result.copied, 1);
		assertEqual(result.skipped, 0);
		const copiedFile = join(dir, "output", "dest.txt");
		assert(existsSync(copiedFile), "expected copied file to exist");
		assertEqual(readFileSync(copiedFile, "utf8"), "hello assets");
	});
});

test("copies single file into destination directory ending with /", () => {
	withTempDir({ "font.woff2": "font-bytes" }, (dir) => {
		const result = copyAssets(dir, [
			{ source: "font.woff2", dest: "assets/fonts/" },
		]);

		assertEqual(result.copied, 1);
		const copiedFile = join(dir, "assets", "fonts", "font.woff2");
		assert(existsSync(copiedFile), "expected font to be placed in fonts/");
		assertEqual(readFileSync(copiedFile, "utf8"), "font-bytes");
	});
});

test("copies directory tree recursively", () => {
	withTempDir(
		{
			"node_modules/pkg/themes/theme.css": "/* theme */",
			"node_modules/pkg/themes/sub/subtheme.css": "/* subtheme */",
		},
		(dir) => {
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
		},
	);
});

section("asset-manager — edge cases & error handling");

test("gracefully skips non-existent source paths", () => {
	withTempDir((dir) => {
		const result = copyAssets(dir, [
			{ source: "does/not/exist.png", dest: "app/img.png" },
		]);

		assertEqual(result.copied, 0);
		assertEqual(result.skipped, 1);
		assertEqual(result.items[0].status, "skipped");
		assertEqual(result.items[0].reason, "source not found");
	});
});

test("throws error when destination attempts directory traversal", () => {
	withTempDir({ "file.txt": "data" }, (dir) => {
		assertThrows(
			() => copyAssets(dir, [{ source: "file.txt", dest: "../outside.txt" }]),
			"outside project directory",
		);
	});
});

section("asset-manager — configuration loading");

test('reads assetCopy configuration from package.json "gofront" key', () => {
	withTempDir(
		{
			"package.json": JSON.stringify({
				gofront: {
					assetCopy: [{ source: "icon.svg", dest: "public/icon.svg" }],
				},
			}),
			"icon.svg": "<svg></svg>",
		},
		(dir) => {
			const config = loadAssetConfig(dir);
			assertEqual(config.length, 1);
			assertEqual(config[0].source, "icon.svg");

			const result = copyAssets(dir);
			assertEqual(result.copied, 1);
			assert(existsSync(join(dir, "public", "icon.svg")));
		},
	);
});

test("reads assetCopy configuration from gofront.json", () => {
	withTempDir(
		{
			"gofront.json": JSON.stringify({
				assetCopy: [{ source: "logo.png", dest: "dist/logo.png" }],
			}),
			"logo.png": "png-data",
		},
		(dir) => {
			const config = loadAssetConfig(dir);
			assertEqual(config.length, 1);
			assertEqual(config[0].source, "logo.png");

			const result = copyAssets(dir);
			assertEqual(result.copied, 1);
			assert(existsSync(join(dir, "dist", "logo.png")));
		},
	);
});

test("returns empty result when no assetCopy config is present", () => {
	withTempDir((dir) => {
		const result = copyAssets(dir);
		assertEqual(result.copied, 0);
		assertEqual(result.skipped, 0);
		assertEqual(result.items.length, 0);
	});
});

test('ignores top-level assetCopy outside the package.json "gofront" key', () => {
	withTempDir(
		{
			"package.json": JSON.stringify({
				assetCopy: [{ source: "icon.svg", dest: "public/icon.svg" }],
			}),
			"icon.svg": "<svg/>",
		},
		(dir) => {
			assertEqual(loadAssetConfig(dir).length, 0);
			assertEqual(copyAssets(dir).copied, 0);
		},
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
