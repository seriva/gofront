// Harness fixture: every test passes.
import { assertEqual, section, test } from "../../helpers.js";

section("harness pass");
test("alpha passes", () => assertEqual(1, 1));
test("beta passes", () => assertEqual(2, 2));
