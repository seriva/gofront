// GoFront test suite — bundle size budget logic (test/perf/bundle-size.js)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ceilingsFor, checkBudgets, FIXTURES } from "../../perf/bundle-size.js";
import {
	assert,
	assertContains,
	assertEqual,
	ROOT,
	section,
	test,
} from "../helpers.js";

section("Bundle size budgets");

test("a size within its ceiling passes", () => {
	assertEqual(checkBudgets({ a: 100 }, { a: 100 }).length, 0);
});

test("a size over its ceiling reports old and new bytes", () => {
	const problems = checkBudgets({ a: 101 }, { a: 100 });
	assertEqual(problems.length, 1);
	assertContains(problems[0], "a: 101 B exceeds its ceiling of 100 B (+1 B)");
});

test("a fixture without a ceiling is reported", () => {
	const problems = checkBudgets({ a: 1, b: 2 }, { a: 1 });
	assertEqual(problems.length, 1);
	assertContains(problems[0], "b: no ceiling");
});

test("a ceiling without a fixture is reported", () => {
	const problems = checkBudgets({ a: 1 }, { a: 1, gone: 5 });
	assertEqual(problems.length, 1);
	assertContains(problems[0], "gone: ceiling has no fixture");
});

test("ceilings are the measured size plus 5 percent, rounded up", () => {
	assertEqual(ceilingsFor({ a: 100, b: 1001 }).a, 105);
	assertEqual(ceilingsFor({ a: 100, b: 1001 }).b, 1052);
});

test("the baseline file has a ceiling for every fixture", () => {
	const baseline = JSON.parse(
		readFileSync(join(ROOT, "test/perf/bundle-size.baseline.json"), "utf8"),
	);
	assertEqual(
		Object.keys(baseline).sort().join(","),
		Object.keys(FIXTURES).sort().join(","),
	);
	for (const [name, ceiling] of Object.entries(baseline)) {
		assert(Number.isInteger(ceiling) && ceiling > 0, `${name} ceiling`);
	}
});
