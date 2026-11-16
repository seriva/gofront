// Harness fixture: one passing test and one failing test, no summarize footer.
import { assertEqual, section, test } from "../../helpers.js";

section("harness fail");
test("gamma passes", () => assertEqual(1, 1));
test("delta fails on purpose", () => assertEqual(1, 2));
