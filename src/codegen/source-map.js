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

export function buildSourceMap(sources, mappings) {
	// sources:  string[]
	// mappings: Array<{ genLine: number, srcLine: number, srcFileIdx?: number }>  (0-based)
	// Emits one segment per generated line, column 0 → source line (delta-encoded).
	const lines = [];
	let prevSrcLine = 0;
	let prevSrcFile = 0;
	const maxGen = mappings.reduce((m, e) => Math.max(m, e.genLine), -1);
	const byLine = new Map(mappings.map((e) => [e.genLine, e]));
	for (let g = 0; g <= maxGen; g++) {
		const entry = byLine.get(g);
		if (entry) {
			const fileIdx = entry.srcFileIdx ?? 0;
			const fileDelta = fileIdx - prevSrcFile;
			const srcDelta = entry.srcLine - prevSrcLine;
			// Segment: [genCol=0, srcFileIdxDelta, srcLineDelta, srcCol=0]
			lines.push(
				vlqEncode(0) + vlqEncode(fileDelta) + vlqEncode(srcDelta) + vlqEncode(0),
			);
			prevSrcFile = fileIdx;
			prevSrcLine = entry.srcLine;
		} else {
			lines.push(""); // no mapping for this generated line
		}
	}
	return JSON.stringify({
		version: 3,
		sources,
		names: [],
		mappings: lines.join(";"),
	});
}
