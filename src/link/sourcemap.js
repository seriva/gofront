// Source-map merging for the bundle: chunk concatenation with line-offset
// mappings, the inline JS source map and the function-level wasm map.

import { relative, resolve } from "node:path";
import { buildSourceMap, buildWasmSourceMap } from "../backend/js/index.js";

function normalizeChunk(c) {
	if (typeof c === "string") {
		return { js: c, sourceFiles: [], sourcesContent: [], mappings: [] };
	}
	return c;
}

function appendChunkMappings(dest, mappings, localToUnifiedIdx, lineOffset) {
	if (!mappings) return;
	for (const m of mappings) {
		dest.push({
			genLine: m.genLine + lineOffset,
			srcLine: m.srcLine,
			srcFileIdx: localToUnifiedIdx[m.srcFileIdx ?? 0] ?? 0,
		});
	}
}

export function mergeCompilationChunks(chunks) {
	const activeChunks = chunks
		.filter(Boolean)
		.map(normalizeChunk)
		.filter((c) => c.js.length > 0);

	if (activeChunks.length === 0) {
		return { js: "", sourceFiles: [], sourcesContent: [], mappings: [] };
	}

	const unifiedSources = [];
	const unifiedSourcesContent = [];
	const fileIdxMap = new Map();

	function getOrAddFile(filePath, content) {
		const key = resolve(filePath);
		let idx = fileIdxMap.get(key);
		if (idx === undefined) {
			idx = unifiedSources.length;
			fileIdxMap.set(key, idx);
			unifiedSources.push(key);
			unifiedSourcesContent.push(content);
		}
		return idx;
	}

	const combinedJsParts = [];
	const mergedMappings = [];
	let currentLineOffset = 0;

	for (const chunk of activeChunks) {
		combinedJsParts.push(chunk.js);
		const localToUnifiedIdx = (chunk.sourceFiles ?? []).map((file, i) =>
			getOrAddFile(file, chunk.sourcesContent?.[i] ?? ""),
		);
		appendChunkMappings(
			mergedMappings,
			chunk.mappings,
			localToUnifiedIdx,
			currentLineOffset,
		);
		currentLineOffset += chunk.js.split("\n").length;
	}

	return {
		js: combinedJsParts.join("\n"),
		sourceFiles: unifiedSources,
		sourcesContent: unifiedSourcesContent,
		mappings: mergedMappings,
	};
}

export function attachSourceMap(merged, outputDir) {
	const relativeSources = merged.sourceFiles.map((f) => relative(outputDir, f));
	const mapJson = buildSourceMap(
		relativeSources,
		merged.mappings,
		merged.sourcesContent,
	);
	const b64 = Buffer.from(mapJson).toString("base64");
	merged.js += `\n//# sourceMappingURL=data:application/json;base64,${b64}`;
}

export const WASM_MAP_URL = "app.wasm.map";

// Function-level `app.wasm.map` (sources relative to the output dir).
export function buildWasmMap(info, outputDir) {
	if (!info || info.mappings.length === 0) return null;
	return buildWasmSourceMap(
		info.sources.map((f) => relative(outputDir, f)),
		info.mappings,
	);
}
