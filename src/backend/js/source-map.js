// Minimal VLQ / source-map helpers for GoFront code generation.

// ── Minimal VLQ / source-map helpers ─────────────────────────
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlqEncode(value) {
	// Signed VLQ: sign bit in LSB of first group, then 5-bit continuation chunks
	let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
	let result = "";
	do {
		let digit = vlq & 0x1f;
		vlq >>>= 5;
		if (vlq > 0) digit |= 0x20; // continuation bit
		result += B64[digit];
	} while (vlq > 0);
	return result;
}

export function buildSourceMap(sources, mappings, sourcesContent) {
	// sources:         string[]
	// mappings:        Array<{ genLine: number, srcLine: number, srcFileIdx?: number }>  (0-based)
	// sourcesContent:  string[] | undefined — original file contents, embedded for DevTools
	// Emits one segment per generated line, column 0 → source line (delta-encoded).
	const lines = [];
	let prevSrcLine = 0;
	let prevSrcFile = 0;
	const maxGen = mappings.reduce((m, e) => Math.max(m, e.genLine), -1);
	const byLine = new Map();
	for (const m of mappings) {
		if (!byLine.has(m.genLine)) byLine.set(m.genLine, m);
	}
	for (let g = 0; g <= maxGen; g++) {
		const entry = byLine.get(g);
		if (entry) {
			const fileIdx = entry.srcFileIdx ?? 0;
			const fileDelta = fileIdx - prevSrcFile;
			const srcDelta = entry.srcLine - prevSrcLine;
			// Segment: [genCol=0, srcFileIdxDelta, srcLineDelta, srcCol=0]
			lines.push(
				vlqEncode(0) +
					vlqEncode(fileDelta) +
					vlqEncode(srcDelta) +
					vlqEncode(0),
			);
			prevSrcFile = fileIdx;
			prevSrcLine = entry.srcLine;
		} else {
			lines.push(""); // no mapping for this generated line
		}
	}
	const map = {
		version: 3,
		sources: sources.map((s) => s.replace(/\\/g, "/")),
		names: [],
		mappings: lines.join(";"),
	};
	if (sourcesContent) map.sourcesContent = sourcesContent;
	return JSON.stringify(map);
}

// WASM source maps use the convention "generated line 0, generated column =
// byte offset into the module".  `mappings` is Array<{ offset, srcFileIdx,
// srcLine }> (0-based line), one segment per function body (function-level
// granularity); DevTools shows the Go file/line for each wasm function.
export function buildWasmSourceMap(sources, mappings, sourcesContent) {
	const sorted = [...mappings].sort((a, b) => a.offset - b.offset);
	const segments = [];
	let prevOffset = 0;
	let prevSrcFile = 0;
	let prevSrcLine = 0;
	for (const m of sorted) {
		const fileIdx = m.srcFileIdx ?? 0;
		segments.push(
			vlqEncode(m.offset - prevOffset) +
				vlqEncode(fileIdx - prevSrcFile) +
				vlqEncode(m.srcLine - prevSrcLine) +
				vlqEncode(0),
		);
		prevOffset = m.offset;
		prevSrcFile = fileIdx;
		prevSrcLine = m.srcLine;
	}
	const map = {
		version: 3,
		sources: sources.map((s) => s.replace(/\\/g, "/")),
		names: [],
		mappings: segments.join(","),
	};
	if (sourcesContent) map.sourcesContent = sourcesContent;
	return JSON.stringify(map);
}
