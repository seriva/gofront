// Harness fixture: an async test that never settles, next to a passing one.
import { test } from "../../helpers.js";

test("async hangs", () => new Promise(() => {}));
test("still reports", () => {});
