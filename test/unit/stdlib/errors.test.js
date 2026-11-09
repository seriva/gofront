// GoFront test suite — errors (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import {
	assert,
	assertErrorContains,
	assertFourWay,
	compile,
	compileWasm,
	section,
	test,
} from "../helpers.js";

section("errors (Go-source)");

test("wrapping, Is, As, Join and Unwrap shapes", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
)

type E1 struct{ code int }

func (e *E1) Error() string { return fmt.Sprint("e1:", e.code) }

type V1 struct{ s string }

func (e V1) Error() string { return "v1:" + e.s }

type Is1 struct{}

func (Is1) Error() string        { return "is1" }
func (Is1) Is(t error) bool      { return t == errSent }

var errSent = errors.New("sentinel")

func Is2[T error](e T) bool { return errors.Is(e, e) }

func main() {
	base := errors.New("base")
	w := fmt.Errorf("wrap: %w", base)
	fmt.Println(w, errors.Is(w, base), errors.Unwrap(w) == base, errors.Unwrap(base) == nil)
	w2 := fmt.Errorf("a: %w, b: %w", base, errSent)
	fmt.Println(w2, errors.Is(w2, base), errors.Is(w2, errSent), errors.Unwrap(w2) == nil)
	j := errors.Join(base, nil, errSent)
	fmt.Println(j, errors.Is(j, errSent), errors.Is(j, errors.New("base")))
	fmt.Println(errors.Join(nil, nil) == nil)
	fmt.Println(errors.Is(nil, nil), errors.Is(base, nil), errors.Is(nil, base))
	fmt.Println(errors.Is(Is1{}, errSent), errors.Is(Is1{}, base))
	fmt.Printf("%T\\n", base)
	_, ok1 := w.(interface{ Unwrap() error })
	_, ok2 := j.(interface{ Unwrap() []error })
	_, ok3 := j.(interface{ Unwrap() error })
	_, ok4 := w2.(interface{ Unwrap() []error })
	_, ok5 := base.(interface{ Unwrap() error })
	fmt.Println(ok1, ok2, ok3, ok4, ok5)
	fmt.Println(Is2[error](errors.New("x")))
	var pe *E1
	we := fmt.Errorf("ctx: %w", &E1{7})
	fmt.Println(errors.As(we, &pe), pe.code)
	var ve V1
	we2 := fmt.Errorf("ctx: %w", V1{"q"})
	fmt.Println(errors.As(we2, &ve), ve.s)
	var pe2 *E1
	fmt.Println(errors.As(base, &pe2), pe2 == nil)
	var target error
	fmt.Println(errors.As(we, &target), target)
	fmt.Println(errors.Is(fmt.Errorf("x: %w", errors.ErrUnsupported), errors.ErrUnsupported), errors.ErrUnsupported)
	switch u := w.(type) {
	case interface{ Unwrap() error }:
		fmt.Println("single", u.Unwrap() == base)
	case interface{ Unwrap() []error }:
		fmt.Println("multi")
	}
	switch u := j.(type) {
	case interface{ Unwrap() error }:
		fmt.Println("single")
	case interface{ Unwrap() []error }:
		fmt.Println("multi", len(u.Unwrap()))
	}
}
`,
		`wrap: base true true true
a: base, b: sentinel true true true
base
sentinel true false
true
true false false
true false
*errors.errorString
true true false true false
true
true 7
true q
false true
true ctx: e1:7
true unsupported operation
single true
multi 2
`,
	);
});
test("Errorf wraps one, several, reordered and invalid %w operands like Go", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
)

type S struct{ A int }

func (S) String() string { return "s" }

type E struct{ N int }

func (e E) Error() string { return fmt.Sprint("E", e.N) }

func main() {
	base := errors.New("base")
	other := errors.New("other")
	w := fmt.Errorf("one: %w", base)
	fmt.Println(w, errors.Unwrap(w) == base, errors.Is(w, base))
	w2 := fmt.Errorf("two: %w and %w", base, other)
	fmt.Println(w2, errors.Unwrap(w2) == nil, errors.Is(w2, base), errors.Is(w2, other))
	w3 := fmt.Errorf("re: %[2]w %[1]w", base, other)
	fmt.Println(w3, errors.Is(w3, base), errors.Is(w3, other))
	w4 := fmt.Errorf("dup: %[1]w %[1]w", base)
	fmt.Println(w4, errors.Is(w4, base))
	w5 := fmt.Errorf("bad: %w", "x")
	fmt.Println(w5, errors.Unwrap(w5) == nil)
	w6 := fmt.Errorf("nil: %w", nil)
	fmt.Println(w6, errors.Unwrap(w6) == nil)
	var target E
	w7 := fmt.Errorf("typed: %w", E{9})
	fmt.Println(errors.As(w7, &target), target.N, w7)
	fmt.Printf("%T %T %T\\n", w, w2, fmt.Errorf("plain %d", 1))
	var st fmt.Stringer = S{3}
	var er error = E{4}
	fmt.Printf("%d|%+v|%v|%s\\n", st, st, st, st)
	fmt.Printf("%d|%+v|%v\\n", er, er, er)
	var a any = S{5}
	fmt.Printf("%d|%v\\n", a, a)
}
`,
		`one: base true true
two: base and other true true true
re: other base true true
dup: base base true
bad: %!w(string=x) true
nil: %!w(<nil>) true
true 9 typed: E9
*fmt.wrapError *fmt.wrapErrors *errors.errorString
{3}|s|s|s
{4}|E4|E4
{5}|s
`,
	);
});

test("sentinels, typed targets and joined trees", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
	"io"
	"strconv"
)

type NotFound struct{ Name string }

func (e NotFound) Error() string { return e.Name + " not found" }

type Temp interface{ Temporary() bool }

type tmpErr struct{}

func (tmpErr) Error() string   { return "tmp" }
func (tmpErr) Temporary() bool { return true }

func find(n string) error {
	return fmt.Errorf("find %q: %w", n, NotFound{n})
}

func main() {
	_, err := strconv.Atoi("99999999999999999999")
	fmt.Println(errors.Is(err, strconv.ErrRange), errors.Is(err, strconv.ErrSyntax))
	_, err = strconv.Atoi("x")
	fmt.Println(errors.Is(err, strconv.ErrSyntax))
	var ne *strconv.NumError
	fmt.Println(errors.As(err, &ne), ne.Func)
	err = find("bob")
	var nf NotFound
	fmt.Println(errors.As(err, &nf), nf.Name, err)
	var tm Temp
	fmt.Println(errors.As(fmt.Errorf("w: %w", tmpErr{}), &tm), tm != nil)
	fmt.Println(errors.Is(fmt.Errorf("r: %w", io.EOF), io.EOF))
	fmt.Println(errors.Is(io.ErrUnexpectedEOF, io.EOF))
	e1 := errors.New("same")
	e2 := errors.New("same")
	fmt.Println(e1 == e2, errors.Is(e1, e2), errors.Is(e1, e1))
	j := errors.Join(e1, fmt.Errorf("n: %w", NotFound{"z"}))
	fmt.Println(errors.Is(j, e1), errors.Is(j, e2))
	fmt.Printf("%q\\n", j.Error())
	fmt.Println(errors.Unwrap(errors.Unwrap(fmt.Errorf("a: %w", fmt.Errorf("b: %w", e1)))) == e1)
	fmt.Println(fmt.Errorf("no wrap %v", e1), errors.Unwrap(fmt.Errorf("no wrap %v", e1)) == nil)
}
`,
		`true false
true
true Atoi
true bob find "bob": bob not found
true true
true
false
false false true
true false
"same\\nn: z not found"
true
no wrap same true
`,
	);
});

test("errors.As walks Join trees and matches named basic error types", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
)

type NotFound struct{ Name string }

func (e NotFound) Error() string { return e.Name + " not found" }

type E byte

func (E) Error() string { return "E" }

func main() {
	var nf NotFound
	e1 := errors.New("a")
	fmt.Println(errors.As(errors.Join(e1, fmt.Errorf("n: %w", NotFound{"z"})), &nf), nf.Name)
	var t E
	fmt.Println(errors.As(error(E(7)), &t), byte(t))
}
`,
		`true z
true 7
`,
	);
});

test("errors.As fills every target shape and honours custom As methods", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
)

type NotFound struct{ Name string }

func (e *NotFound) Error() string { return e.Name + " not found" }

type Temp interface{ Temporary() bool }

type tmpErr struct{}

func (tmpErr) Error() string   { return "tmp" }
func (tmpErr) Temporary() bool { return true }

type Code int

func (c Code) Error() string { return fmt.Sprint("code ", int(c)) }

type Val struct{ N int }

func (v Val) Error() string { return fmt.Sprint("val ", v.N) }

// Custom As: fills **NotFound.
type Wrapper struct{ name string }

func (w Wrapper) Error() string { return "wrapper " + w.name }
func (w Wrapper) As(target any) bool {
	if t, ok := target.(**NotFound); ok {
		*t = &NotFound{w.name}
		return true
	}
	return false
}

func main() {
	base := &NotFound{"a"}
	var nf *NotFound
	fmt.Println(errors.As(fmt.Errorf("w: %w", base), &nf), nf.Name)

	nf = nil
	j := errors.Join(errors.New("x"), fmt.Errorf("y: %w", &NotFound{"joined"}))
	fmt.Println(errors.As(j, &nf), nf.Name)

	nf = nil
	fmt.Println(errors.As(fmt.Errorf("c: %w", Wrapper{"viaAs"}), &nf), nf.Name)

	var tm Temp
	fmt.Println(errors.As(fmt.Errorf("t: %w", tmpErr{}), &tm), tm.Temporary())

	var e error
	fmt.Println(errors.As(fmt.Errorf("t: %w", Code(4)), &e), e)

	var c Code
	fmt.Println(errors.As(fmt.Errorf("t: %w", Code(404)), &c), int(c))

	var v Val
	fmt.Println(errors.As(errors.Join(nil, Val{3}), &v), v.N)

	var typedNil *NotFound
	var chain error = typedNil
	nf = nil
	fmt.Println(errors.As(chain, &nf), nf == nil)

	fmt.Println(errors.As(nil, &nf))
	var other *NotFound
	fmt.Println(errors.As(errors.New("plain"), &other), other == nil)

	func() {
		defer func() { fmt.Println("recovered:", recover()) }()
		var np *Code
		errors.As(Code(1), np)
	}()
}
`,
		`true a
true joined
true viaAs
true true
true t: code 4
true 404
true 3
true true
false
false true
recovered: errors: target must be a non-nil pointer
`,
	);
});

test("errors.As in a generic function and through a method value", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
)

type NotFound struct{ Name string }

func (e *NotFound) Error() string { return e.Name }

func Find[T error](err error) (T, bool) {
	var t T
	ok := errors.As(err, &t)
	return t, ok
}

func main() {
	err := fmt.Errorf("w: %w", &NotFound{"g"})
	nf, ok := Find[*NotFound](err)
	fmt.Println(ok, nf.Name)
	_, ok = Find[*NotFound](errors.New("x"))
	fmt.Println(ok)
}
`,
		`true g
false
`,
	);
});

test("errors.As needs a pointer target", () => {
	for (const call of [
		"errors.As(err, nf)",
		"errors.As(err, 3)",
		"errors.As(err, nil)",
	]) {
		const { errors: errs } = compile(`package main

import "errors"

type NF struct{}

func (NF) Error() string { return "" }

func main() {
	var err error
	var nf NF
	_ = nf
	_ = ${call}
}
`);
		assertErrorContains(
			errs,
			"errors.As: second argument must be a non-nil pointer",
		);
	}
});

test("errors.As through an import alias", async () => {
	await assertFourWay(
		`package main

import (
	e "errors"
	"fmt"
)

type Code int

func (c Code) Error() string { return fmt.Sprint("code ", int(c)) }

func main() {
	var c Code
	fmt.Println(e.As(fmt.Errorf("w: %w", Code(7)), &c), int(c))
}
`,
		`true 7
`,
	);
});

test("errors.As cannot be used as a value", () => {
	const { errors: errs } = compile(
		`package main

import "errors"

func main() {
	f := errors.As
	_ = f
}
`,
		{ target: "both" },
	);
	assertErrorContains(errs, "errors.As cannot be used as a value");
});

test("a local named errors is not the errors package", () => {
	const { errors: errs } = compile(
		`package main

import "errors"

type Config struct{ As int }

type Runner struct{}

func (Runner) As(n int) bool { return n > 0 }

func main() {
	var errors Config
	_ = errors.As
	var r Runner
	errors2 := r
	_ = errors2.As(1)
	{
		errors := Runner{}
		_ = errors.As(1)
	}
	_ = errors
}

var _ = errors.New
`,
		{ target: "both" },
	);
	if (errs.length > 0) throw new Error(errs.map((e) => e.message).join("; "));
});

test("errors.As rejects an anonymous interface target", () => {
	const { errors: errs } = compile(
		`package main

import "errors"

func main() {
	var t interface{ Temporary() bool }
	_ = errors.As(errors.New("x"), &t)
}
`,
		{ target: "both" },
	);
	assertErrorContains(
		errs,
		"errors.As with a target of an anonymous interface type is not yet available",
	);
});

test("wasm output carries no dead errors.Is / errors.Unwrap helpers", () => {
	const { wat, errors } = compileWasm(
		`package main

import "errors"

var e = errors.New("x")

func Main() bool {
	return errors.Is(errors.Unwrap(e), e)
}
`,
		{ emitWat: true },
	);
	assert(errors.length === 0, "compiles");
	assert(!wat.includes("$__errors_is"), "no __errors_is");
	assert(!wat.includes("$__errors_unwrap"), "no __errors_unwrap");
});
