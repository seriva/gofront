// test/unit/language/parity-matrix.test.js
// Conformance and parity matrix generated from docs/language-support.md.
// Walks the Core language, Types, Control flow, and Expressions tables,
// compiling and running each fixture as a `both` package.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileWasm } from "../../../src/backend/wasm/index.js";
import {
	assertEqual,
	compile,
	compileHybrid,
	section,
	test,
} from "../helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.resolve(__dirname, "../../../docs/language-support.md");

const docContent = fs.readFileSync(DOC_PATH, "utf8");

const startMarker = "### Core language";
const endMarker = "### Standard library shims";
const startIndex = docContent.indexOf(startMarker);
const endIndex = docContent.indexOf(endMarker);
if (startIndex === -1 || endIndex === -1) {
	throw new Error(
		"Could not find parity matrix tables in docs/language-support.md",
	);
}

const tableSection = docContent.slice(startIndex, endIndex);
const lines = tableSection.split("\n");

const parsedRows = [];
const skippedRows = [];
let currentTable = "";

for (const line of lines) {
	const trimmed = line.trim();
	if (trimmed.startsWith("### ")) {
		currentTable = trimmed.slice(4).trim();
		continue;
	}
	if (
		!trimmed.startsWith("|") ||
		trimmed.includes("|---|") ||
		trimmed.toLowerCase().includes("| feature | status |")
	) {
		continue;
	}

	const match = trimmed.match(
		/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*<!--\s*(fixture|no-fixture):\s*(.*?)\s*-->\s*\|$/,
	);
	if (!match) {
		throw new Error(`Unannotated row in ${currentTable}: ${trimmed}`);
	}

	const [, feature, status, kind, rawPayload] = match;
	const row = {
		table: currentTable,
		feature: feature.trim(),
		status: status.trim(),
		kind,
		payload: rawPayload.trim(),
	};
	parsedRows.push(row);
}

// Group rows by table for section headers
const tables = new Map();
for (const row of parsedRows) {
	if (!tables.has(row.table)) tables.set(row.table, []);
	tables.get(row.table).push(row);
}

for (const [tableName, rows] of tables) {
	section(`Parity Matrix — ${tableName}`);

	for (const row of rows) {
		if (row.kind === "no-fixture") {
			skippedRows.push({
				feature: row.feature,
				table: row.table,
				reason: row.payload || "no-fixture",
			});
			continue;
		}

		let payload = row.payload;
		let isPending = false;
		let pendingReason = "";

		if (payload.startsWith("pending:")) {
			isPending = true;
			const parts = payload.slice("pending:".length).split("|");
			pendingReason = parts[0].trim();
			payload = parts.slice(1).join("|").trim();
		}

		let isDiagnostic = false;
		let expectedDiag = "";
		let code = payload;

		if (code.startsWith("diagnostic:")) {
			isDiagnostic = true;
			const parts = code.slice("diagnostic:".length).split("=>");
			expectedDiag = parts[0].trim();
			code = parts.slice(1).join("=>").trim();
		}

		if (isPending) {
			skippedRows.push({
				feature: row.feature,
				table: row.table,
				reason: `pending (${pendingReason})`,
			});
			if (process.env.TEST_PENDING === "1") {
				test(`[PENDING] ${row.feature}`, () => {
					if (isDiagnostic) {
						const jsRes = compile(code, { strict: true });
						const wasmRes = compileWasm(code);
						const jsErrors = (jsRes.errors ?? [])
							.map((e) => e.message)
							.join("\n");
						const wasmErrors = (wasmRes.errors ?? [])
							.map((e) => e.message)
							.join("\n");
						if (
							!jsErrors.includes(expectedDiag) ||
							!wasmErrors.includes(expectedDiag)
						) {
							throw new Error(
								`Expected diagnostic "${expectedDiag}"\nJS: ${jsErrors}\nWASM: ${wasmErrors}`,
							);
						}
					} else {
						const h = compileHybrid(code);
						h.run("Main");
					}
				});
			}
			continue;
		}

		test(row.feature, () => {
			if (isDiagnostic) {
				const jsRes = compile(code, { strict: true });
				const wasmRes = compileWasm(code);
				const jsErrors = (jsRes.errors ?? []).map((e) => e.message).join("\n");
				const wasmErrors = (wasmRes.errors ?? [])
					.map((e) => e.message)
					.join("\n");
				if (!jsErrors.includes(expectedDiag)) {
					throw new Error(
						`JS did not produce expected diagnostic "${expectedDiag}": ${jsErrors}`,
					);
				}
				if (!wasmErrors.includes(expectedDiag)) {
					throw new Error(
						`WASM did not produce expected diagnostic "${expectedDiag}": ${wasmErrors}`,
					);
				}
				return;
			}

			const h = compileHybrid(code);
			h.run("Main");
		});
	}
}

section("Parity Matrix — Summary");

test("parity matrix completeness: all 52 rows parsed and covered", () => {
	assertEqual(parsedRows.length, 52);
	console.log(
		`\n── Parity Matrix: 52 rows parsed (39 active, ${skippedRows.length} skipped/pending) ──`,
	);
	for (const skip of skippedRows) {
		console.log(`  - [${skip.table}] ${skip.feature}: ${skip.reason}`);
	}
});
