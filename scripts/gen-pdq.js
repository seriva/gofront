// Generates the four pdqsort variants of the Go-source stdlib from one
// template, the way Go's sort/gen_sort_variants.go does.  The template
// (scripts/pdq-template.txt) is Go's, with the same substitutions:
//
//   stdlib/sort/zsort_iface.go      sort.Interface
//   stdlib/sort/zsort_func.go       sort lessSwap (sort.Slice)
//   stdlib/slices/zsort_ordered.go  slices ordered (cmp.Less)
//   stdlib/slices/zsort_cmp.go      slices with a cmp function
//
// Swaps and comparisons always go through the index (`data[a], data[b] =
// data[b], data[a]`), never `&data[i]`.  `node scripts/gen-pdq.js` rewrites
// the files, `--check` exits non-zero when one is out of date.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const swapIndex = (name, i, j) =>
	`${name}[${i}], ${name}[${j}] = ${name}[${j}], ${name}[${i}]`;

export const VARIANTS = [
	{
		path: "stdlib/sort/zsort_iface.go",
		Package: "sort",
		Imports: "",
		FuncSuffix: "",
		TypeParam: "",
		ExtraParam: "",
		ExtraArg: "",
		DataType: "Interface",
		Less: (n, i, j) => `${n}.Less(${i}, ${j})`,
		Swap: (n, i, j) => `${n}.Swap(${i}, ${j})`,
	},
	{
		path: "stdlib/sort/zsort_func.go",
		Package: "sort",
		Imports: "",
		FuncSuffix: "_func",
		TypeParam: "",
		ExtraParam: "",
		ExtraArg: "",
		DataType: "lessSwap",
		Less: (n, i, j) => `${n}.Less(${i}, ${j})`,
		Swap: (n, i, j) => `${n}.Swap(${i}, ${j})`,
	},
	{
		path: "stdlib/slices/zsort_ordered.go",
		Package: "slices",
		Imports: 'import "cmp"\n',
		FuncSuffix: "Ordered",
		TypeParam: "[E cmp.Ordered]",
		ExtraParam: "",
		ExtraArg: "",
		DataType: "[]E",
		Less: (n, i, j) => `cmp.Less(${n}[${i}], ${n}[${j}])`,
		Swap: swapIndex,
	},
	{
		path: "stdlib/slices/zsort_cmp.go",
		Package: "slices",
		Imports: "",
		FuncSuffix: "CmpFunc",
		TypeParam: "[E any]",
		ExtraParam: ", cmp func(a, b E) int",
		ExtraArg: ", cmp",
		DataType: "[]E",
		Less: (n, i, j) => `(cmp(${n}[${i}], ${n}[${j}]) < 0)`,
		Swap: swapIndex,
	},
];

// Expands the template for one variant and normalises the spacing the
// substitutions leave behind (what gofmt does for Go's generator).
export function generate(template, v) {
	const call = (fn) => (_, a, b, c) => v[fn](a, b, c);
	const text = template
		.replace(/\{\{Less "([^"]*)" "([^"]*)" "([^"]*)"\}\}/g, call("Less"))
		.replace(/\{\{Swap "([^"]*)" "([^"]*)" "([^"]*)"\}\}/g, call("Swap"))
		.replace(/\{\{\.(\w+)\}\}/g, (_, k) => v[k]);
	return `${text
		.replace(/ ([,)])/g, "$1")
		.replace(/\bif \((cmp\([^\n]*\) < 0)\) \{/g, "if $1 {")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/(\npackage \w+\n)\n+(import [^\n]*\n)\n+/, "$1\n$2\n")
		.replace(/(\npackage \w+\n)\n+(?=\/\/)/, "$1\n")
		.trimEnd()}\n`;
}

export function generateAll() {
	const template = readFileSync(join(ROOT, "scripts/pdq-template.txt"), "utf8");
	return VARIANTS.map((v) => ({
		path: v.path,
		content: generate(template, v),
	}));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const check = process.argv.includes("--check");
	let stale = 0;
	for (const { path, content } of generateAll()) {
		const file = join(ROOT, path);
		const current = existsSync(file) ? readFileSync(file, "utf8") : null;
		if (current === content) continue;
		stale++;
		if (check)
			console.error(`gen-pdq: ${path} is out of date; run npm run gen:pdq`);
		else writeFileSync(file, content);
	}
	if (check && stale > 0) process.exit(1);
}
