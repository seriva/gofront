// Harness fixture: a synchronous infinite loop, only when HARNESS_HANG=1.
import { test } from "../../helpers.js";

test("sync hangs", () => {
	if (process.env.HARNESS_HANG === "1") {
		while (true) {}
	}
});
