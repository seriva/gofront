// GoFront test suite — labeled break/continue on range-over-func loops

import { fileURLToPath } from "node:url";
import { assertProgramOutput, section, summarize, test } from "../helpers.js";

section("Range-over-func: labeled break and continue");

test("break to the label of the range-over-func loop", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func main() {
outer:
	for x := range seq {
		fmt.Println(x)
		break outer
	}
	fmt.Println("done")
}
`,
		"0\ndone\n",
	);
});

test("continue to the label of the range-over-func loop", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func main() {
outer:
	for x := range seq {
		fmt.Println(x)
		continue outer
	}
	fmt.Println("done")
}
`,
		"0\n1\ndone\n",
	);
});

test("continue to the range-over-func label from a nested for", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func seq(yield func(int) bool) {
	_ = yield(0) && yield(1)
}

func main() {
outer:
	for x := range seq {
		for y := 0; y < 2; y++ {
			fmt.Println(x, y)
			continue outer
		}
	}
	fmt.Println("done")
}
`,
		"0 0\n1 0\ndone\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
