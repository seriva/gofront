// Harness fixture: failing test with the footer used by most test files.
import { fileURLToPath } from "node:url";
import { assertEqual, summarize, test } from "../../helpers.js";

test("footer fails on purpose", () => assertEqual(1, 2));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
