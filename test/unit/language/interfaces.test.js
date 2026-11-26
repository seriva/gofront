// GoFront test suite — interface assertions and nil checks

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Empty-interface nil assertions (J5.1)");

test("concrete and generic any / interface{} assertions reject nil", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type E interface{}
type E2 E
type A = any
type EAlias = interface{}

func assertOk[T any](v any) (T, bool) {
	x, ok := v.(T)
	return x, ok
}

func assertPanic[T any](v any) (panicked bool) {
	defer func() {
		if recover() != nil {
			panicked = true
		}
	}()
	_ = v.(T)
	return false
}

func checkConcretePanic(v any) (panicked bool) {
	defer func() {
		if recover() != nil {
			panicked = true
		}
	}()
	_ = v.(any)
	return false
}

func switchAny(v any) string {
	switch v.(type) {
	case any:
		return "any"
	default:
		return "nil"
	}
}

func switchGeneric[T any](v any) string {
	switch v.(type) {
	case T:
		return "T"
	default:
		return "nil"
	}
}

func switchEmptyIface(v any) string {
	switch v.(type) {
	case interface{}:
		return "iface"
	default:
		return "nil"
	}
}

func main() {
	var n any
	var m any = 3

	v1, ok1 := n.(any)
	v2, ok2 := assertOk[interface{}](n)
	v3, ok3 := assertOk[any](n)
	fmt.Println(v1, ok1)
	fmt.Println(v2, ok2)
	fmt.Println(v3, ok3)

	fmt.Println(checkConcretePanic(n))
	fmt.Println(assertPanic[interface{}](n))
	fmt.Println(assertPanic[any](n))

	// Controls
	v4, ok4 := m.(any)
	v5, ok5 := n.(interface{})
	v6, ok6 := n.(E)
	v7, ok7 := assertOk[any](m)
	v8, ok8 := assertOk[interface{}](m)
	v9, ok9 := n.(A)
	v10, ok10 := n.(EAlias)
	v11, ok11 := n.(E2)
	_, ok12 := n.(interface{ any })
	_, ok13 := n.(interface{ fmt.Stringer })
	fmt.Println(v4, ok4)
	fmt.Println(v5, ok5)
	fmt.Println(v6, ok6)
	fmt.Println(v7, ok7)
	fmt.Println(v8, ok8)
	fmt.Println(v9, ok9)
	fmt.Println(v10, ok10)
	fmt.Println(v11, ok11, ok12, ok13)
	fmt.Println(switchAny(n), switchAny(m), switchGeneric[any](n), switchGeneric[any](m), switchGeneric[interface{}](n), switchGeneric[interface{}](m), switchEmptyIface(n), switchEmptyIface(m))
}
`,
		"<nil> false\n<nil> false\n<nil> false\ntrue\ntrue\ntrue\n3 true\n<nil> false\n<nil> false\n3 true\n3 true\n<nil> false\n<nil> false\n<nil> false false false\nnil any nil T nil T nil iface\n",
	);
});

test("nil func values boxed into any keep their dynamic type and are non-nil interfaces", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type F func()
type FA = func()

func boxAny[T any](v T) any {
	return v
}

func wrapFuncT[T any](f func(T)) any {
	return f
}

func assertOkAny[T any](v any) (T, bool) {
	x, ok := v.(T)
	return x, ok
}

func switchFunc(v any) string {
	switch f := v.(type) {
	case nil:
		return "nil"
	case func():
		if f == nil {
			return "nil-func()"
		}
		return "func()"
	case F:
		if f == nil {
			return "nil-F"
		}
		return "F"
	default:
		return "other"
	}
}

func main() {
	var fn func()
	var af any = fn
	vAny, okAny := af.(any)
	f1, ok1 := af.(func())
	_, okWrongSig := af.(func(int))
	_, okWrongNamed := af.(F)

	var fnNamed F
	var afNamed any = fnNamed
	_, okNamedAny := afNamed.(any)
	f2, ok2 := afNamed.(F)
	_, okNamedAsUnnamed := afNamed.(func())

	var fnAlias FA
	var afAlias any = fnAlias
	f3, ok3 := afAlias.(FA)

	// Generic boxing and generic assertions
	g1 := boxAny(fn)
	g2 := boxAny(fnNamed)
	gw := wrapFuncT[int](nil)
	_, gwOkAny := gw.(any)
	gwf, gwOkFn := gw.(func(int))
	gf1, gok1 := assertOkAny[func()](af)
	gf2, gok2 := assertOkAny[F](afNamed)
	gvAny, gokAny := assertOkAny[any](af)
	_, gokNil := assertOkAny[func()](nil)

	// Non-nil func control
	live := func() {}
	var afLive any = live
	fl, okl := afLive.(func())
	liveNamed := F(live)
	var afLiveNamed any = liveNamed
	fln, okln := afLiveNamed.(F)
	_, okLiveNamedAsUnnamed := afLiveNamed.(func())

	// Concrete conversion F(nil) must stay nil
	convNil := F(nil)

	fmt.Println(okAny, af == nil, vAny == nil, ok1, f1 == nil, okWrongSig, okWrongNamed)
	fmt.Println(okNamedAny, afNamed == nil, ok2, f2 == nil, okNamedAsUnnamed, ok3, f3 == nil)
	fmt.Println(g1 == nil, g2 == nil, gw == nil, gwOkAny, gwOkFn, gwf == nil, gok1, gf1 == nil, gok2, gf2 == nil, gokAny, gvAny == nil, gokNil)
	fmt.Println(switchFunc(nil), switchFunc(af), switchFunc(afNamed), switchFunc(afLive), switchFunc(afLiveNamed))
	fmt.Println(okl, fl == nil, okln, fln == nil, okLiveNamedAsUnnamed, convNil == nil)
	fmt.Printf("%T %v\\n", af, af)
}
`,
		"true false false true true false false\ntrue false true true false true true\nfalse false false true true true true true true true true false false\nnil nil-func() nil-F func() F\ntrue false true false false true\nfunc() <nil>\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
