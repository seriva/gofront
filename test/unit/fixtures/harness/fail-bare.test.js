// Harness fixture: failing test with a bare summarize() call and no exit.
import { assertEqual, summarize, test } from "../../helpers.js";

test("bare fails on purpose", () => assertEqual(1, 2));

await summarize();
