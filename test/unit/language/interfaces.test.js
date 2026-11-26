// GoFront test suite — interface assertions and nil checks

import { fileURLToPath } from "node:url";
import {
	assertAllTargetsOutput,
	assertJsProgramOutput,
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

test("generic defined func values boxed into any keep their instantiation tag and nil identity", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"fmt"
	"iter"
)

type GF[T any] func(T)
type MyGF = GF[int]

func boxAnyGF[T any](v T) any {
	return v
}

func boxGF[T any](f GF[T]) any {
	return f
}

func convGF[T any](f func(T)) any {
	return GF[T](f)
}

func assertOkGF[T any](v any) (T, bool) {
	x, ok := v.(T)
	return x, ok
}

func assertGFT[T any](v any) bool {
	_, ok := v.(GF[T])
	return ok
}

func switchGF(v any) string {
	switch f := v.(type) {
	case nil:
		return "nil"
	case GF[int]:
		if f == nil {
			return "nil-GF[int]"
		}
		return "GF[int]"
	case GF[string]:
		if f == nil {
			return "nil-GF[string]"
		}
		return "GF[string]"
	case func(int):
		if f == nil {
			return "nil-func(int)"
		}
		return "func(int)"
	default:
		return "other"
	}
}

func main() {
	var gf GF[int]
	var agf any = gf
	_, okAny := agf.(any)
	vInt, okInt := agf.(GF[int])
	_, okStr := agf.(GF[string])
	_, okFn := agf.(func(int))
	fmt.Println(okAny, agf == nil, okInt, vInt == nil, okStr, okFn)

	var live GF[int] = func(int) {}
	var alive any = live
	vLive, okLiveInt := alive.(GF[int])
	_, okLiveStr := alive.(GF[string])
	_, okLiveFn := alive.(func(int))
	fmt.Println(okLiveInt, vLive == nil, okLiveStr, okLiveFn)

	bgf := boxAnyGF(gf)
	_, bAny := bgf.(any)
	_, bInt := bgf.(GF[int])
	_, bStr := bgf.(GF[string])
	fmt.Println(bAny, bgf == nil, bInt, bStr)

	g1, gok1 := assertOkGF[GF[int]](agf)
	_, gok2 := assertOkGF[GF[string]](agf)
	g3, gok3 := assertOkGF[GF[int]](alive)
	_, gok4 := assertOkGF[GF[string]](alive)
	fmt.Println(gok1, g1 == nil, gok2, gok3, g3 == nil, gok4)

	bg := boxGF(gf)
	cg := convGF[int](nil)
	cl := convGF[int](func(int) {})
	fmt.Println(bg == nil, assertGFT[int](bg), assertGFT[string](bg))
	fmt.Println(cg == nil, assertGFT[int](cg), assertGFT[string](cg))
	fmt.Println(assertGFT[int](cl), assertGFT[string](cl))

	conv := GF[int](func(int) {})
	var aconv any = conv
	_, c1 := aconv.(GF[int])
	_, c2 := aconv.(GF[string])
	_, c3 := aconv.(func(int))
	pconv := (GF[int])(func(int) {})
	var apconv any = pconv
	_, pc1 := apconv.(GF[int])
	_, pc2 := apconv.(GF[string])
	_, pc3 := apconv.(func(int))
	fmt.Println(c1, c2, c3, pc1, pc2, pc3)

	var mgf MyGF
	var amgf any = mgf
	_, m1 := amgf.(GF[int])
	_, m2 := amgf.(MyGF)
	fmt.Println(amgf == nil, m1, m2)

	var gfn GF[func()]
	var agfn any = gfn
	_, f1 := agfn.(GF[func()])
	_, f2 := boxGF(gfn).(GF[func()])
	var gb GF[byte]
	var agb any = gb
	_, b1 := agb.(GF[uint8])
	_, b2 := boxGF(gb).(GF[uint8])
	fmt.Println(f1, f2, b1, b2)

	var seq iter.Seq[int]
	var aseq any = seq
	_, s1 := aseq.(any)
	_, s2 := aseq.(iter.Seq[int])
	_, s3 := aseq.(iter.Seq[string])
	_, s4 := aseq.(func(func(int) bool))
	fmt.Println(s1, aseq == nil, s2, s3, s4)

	fmt.Println(switchGF(nil), switchGF(agf), switchGF(alive))
	fmt.Println(agf, alive != nil)
	fmt.Printf("%T\\n", any(gf))
}
`,
		"true false true true false false\ntrue false false false\ntrue false true false\ntrue true false true false false\nfalse true false\nfalse true false\ntrue false\ntrue false false true false false\nfalse true true\ntrue true true true\ntrue false true false false\nnil nil-GF[int] GF[int]\n<nil> true\nmain.GF[int]\n",
	);
});

test("generic defined func tags match across concrete and open-generic type args", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type GF[T any] func(T)
type Outer[X any] func(X)

func boxGF[T any](f GF[T]) any { return f }
func assertGFT[T any](v any) bool { _, ok := v.(GF[T]); return ok }
func boxOuter[X any](o Outer[X]) any { return o }
func assertOuter[X any](v any) bool { _, ok := v.(Outer[X]); return ok }

func wrapOuterGF[T any]() any {
	var o Outer[GF[T]]
	return boxOuter[GF[T]](o)
}

func checkOuterGF[T any](v any) bool {
	return assertOuter[GF[T]](v)
}

func main() {
	var gi GF[interface{}]
	var agi any = gi
	bi := boxGF(gi)
	_, okI1 := agi.(GF[interface{}])
	_, okI2 := bi.(GF[interface{}])
	_, okI3 := bi.(GF[any])
	fmt.Println(okI1, assertGFT[interface{}](agi), assertGFT[any](agi), okI2, okI3, assertGFT[interface{}](bi))

	var gs GF[struct{ a, b int }]
	var ags any = gs
	bs := boxGF(gs)
	_, okS1 := ags.(GF[struct{ a, b int }])
	_, okS2 := ags.(GF[struct{ a int; b int }])
	_, okS3 := bs.(GF[struct{ a, b int }])
	_, okS4 := bs.(GF[struct{ a int; b int }])
	fmt.Println(okS1, okS2, assertGFT[struct{ a, b int }](ags), okS3, okS4, assertGFT[struct{ a, b int }](bs))

	var gv GF[[]func(...int)]
	var agv any = gv
	bv := boxGF(gv)
	_, okV1 := agv.(GF[[]func(...int)])
	_, okV2 := bv.(GF[[]func(...int)])
	_, okV3 := bv.(GF[[]func([]int)])
	fmt.Println(okV1, assertGFT[[]func(...int)](agv), okV2, okV3, assertGFT[[]func(...int)](bv))

	wo := wrapOuterGF[int]()
	_, okO1 := wo.(Outer[GF[int]])
	_, okO2 := wo.(Outer[GF[string]])
	fmt.Println(okO1, okO2, checkOuterGF[int](wo), checkOuterGF[string](wo))
}
`,
		"true true true true true true\ntrue true true true true true\ntrue true true false true\ntrue false true false\n",
	);
});

test("distinct local types with the same name do not collide in GF or composite tags", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type GF[T any] func(T)

func boxGF[T any](f GF[T]) any { return f }
func assertGFT[T any](v any) bool { _, ok := v.(GF[T]); return ok }

func makeLocalGF() any {
	type L struct{ X int }
	var g GF[L]
	return g
}

func checkLocalGF(v any) bool {
	type L struct{ Y string }
	_, ok := v.(GF[L])
	return ok
}

func makeLocalGFBoxed() any {
	type L struct{ X int }
	var g GF[L]
	return boxGF(g)
}

func checkLocalGFGeneric(v any) bool {
	type L struct{ Y string }
	return assertGFT[L](v)
}

func makeLocalSlice() any {
	type L struct{ X int }
	var s []L
	return s
}

func checkLocalSlice(v any) bool {
	type L struct{ Y string }
	_, ok := v.([]L)
	return ok
}

func makeLocalNested() (any, any, any, any) {
	type L struct{ X int }
	var a GF[[]L]
	var b GF[map[string]L]
	var c GF[func(L)]
	var d GF[struct{ f L }]
	return boxGF(a), boxGF(b), boxGF(c), boxGF(d)
}

func checkLocalNested(a, b, c, d any) (bool, bool, bool, bool) {
	type L struct{ Y string }
	return assertGFT[[]L](a), assertGFT[map[string]L](b), assertGFT[func(L)](c), assertGFT[struct{ f L }](d)
}

func sameScopeLocal() (bool, bool) {
	type L struct{ X int }
	var g GF[L]
	b := boxGF(g)
	_, ok := b.(GF[L])
	return ok, assertGFT[L](any(g))
}

func localNonGenericFunc() bool {
	makeF := func() any {
		type F func()
		var f F
		return f
	}
	type F func(int)
	_, ok := makeF().(F)
	return ok
}

func main() {
	fmt.Println(checkLocalGF(makeLocalGF()), checkLocalGFGeneric(makeLocalGFBoxed()), checkLocalGF(makeLocalGFBoxed()), checkLocalGFGeneric(makeLocalGF()))
	fmt.Println(checkLocalSlice(makeLocalSlice()), localNonGenericFunc())
	a, b, c, d := makeLocalNested()
	fmt.Println(checkLocalNested(a, b, c, d))
	fmt.Println(sameScopeLocal())
}
`,
		"false false false false\nfalse false\nfalse false false false\ntrue true\n",
	);
	await assertJsProgramOutput(
		`package main

import "fmt"

func makeLocalSelf() any {
	type GL[T any] func(T)
	var g GL[int]
	return g
}

func checkLocalSelf(v any) bool {
	type GL[T any] func(T)
	_, ok := v.(GL[int])
	return ok
}

func main() {
	fmt.Println(checkLocalSelf(makeLocalSelf()))
}
`,
		"false\n",
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
