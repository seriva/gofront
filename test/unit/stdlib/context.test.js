// GoFront test suite — context (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("context (Go-source)");

test("WithValue wraps a parent and chains with WithCancel", async () => {
	await assertFourWay(
		`package main

import (
	"context"
	"fmt"
)

func main() {
	ctx := context.WithValue(context.Background(), "key", "val")
	fmt.Println(ctx.Value("key"), ctx.Value("other"), ctx.Err())
	_, ok := ctx.Deadline()
	fmt.Println(ok)

	cctx, cancel := context.WithCancel(ctx)
	fmt.Println(cctx.Value("key"), cctx.Err())
	cancel()
	fmt.Println(cctx.Err(), ctx.Err())

	vctx := context.WithValue(cctx, "k2", 2)
	fmt.Println(vctx.Value("k2"), vctx.Value("key"), vctx.Err())
}
`,
		"val <nil> <nil>\nfalse\nval <nil>\ncontext canceled <nil>\n2 val context canceled\n",
	);
});
