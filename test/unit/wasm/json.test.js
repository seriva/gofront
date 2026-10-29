// encoding/json in wasm packages: the codecs generated for each call site.
// Each case is a wasm package whose Run() builds its output with the JSON
// calls under test; the expectation is what real Go (go1.26) prints for the
// same program.  Differences the JS backend still has (see
// plans/follow-ups.md) are why the expectations are Go's, not the JS output.

import { fileURLToPath } from "node:url";
import {
	assertContains,
	assertEqual,
	assertProgramOutput,
	compileHybridProject,
	section,
	summarize,
	test,
} from "../helpers.js";

// Compiles `lib` as a wasm package, calls lib.Run() from a JS root and
// returns the string it printed.
async function runLib(libSource) {
	const res = await compileHybridProject({
		"lib/lib.go": libSource,
		"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
	});
	return res.lines.join("\n");
}

section("encoding/json in wasm packages");

for (const target of ["wasm", "both"]) {
	test(`MarshalIndent encodes and indents in a ${target} package`, async () => {
		const src = `//gofront:target ${target}
package lib

import "encoding/json"

type Item struct {
	Name string \`json:"name"\`
	Tags []int  \`json:"tags"\`
}

func Run() string {
	b, err := json.MarshalIndent(Item{"a", []int{1, 2}}, ">", "  ")
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}
`;
		assertEqual(
			await runLib(src),
			'{\n>  "name": "a",\n>  "tags": [\n>    1,\n>    2\n>  ]\n>}',
		);
	});
}

test("Marshal primitives and HTML-safe escaping", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}



func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(42)))
	add(show(json.Marshal(-7)))
	add(show(json.Marshal(3.14)))
	add(show(json.Marshal("hello <b>&\\"q\\"\\n\\t\\\\")))
	add(show(json.Marshal(true)))
	add(show(json.Marshal(nil)))
	add(show(json.Marshal(uint8(255))))
	add(show(json.Marshal(int8(-128))))
	add(show(json.Marshal("\\u2028 and \\u2029 and \\x01")))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`42
-7
3.14
"hello \\u003cb\\u003e\\u0026\\"q\\"\\n\\t\\\\"
true
null
255
-128
"\\u2028 and \\u2029 and \\u0001"`,
	);
});

test("Marshal 64-bit integers keep every digit", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}



func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(int64(9007199254740993))))
	add(show(json.Marshal(int64(-9223372036854775808))))
	add(show(json.Marshal(uint64(18446744073709551615))))
	add(show(json.Marshal([]int64{1, 9223372036854775807})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`9007199254740993
-9223372036854775808
18446744073709551615
[1,9223372036854775807]`,
	);
});

test("Marshal floats: shortest form, exponents, float32, NaN and Inf", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
	"math"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}



func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(1e21)))
	add(show(json.Marshal(1e20)))
	add(show(json.Marshal(1e-6)))
	add(show(json.Marshal(1e-7)))
	add(show(json.Marshal(100.0)))
	add(show(json.Marshal(0.1)))
	add(show(json.Marshal(float32(0.1))))
	add(show(json.Marshal(float32(16777216))))
	add(show(json.Marshal(float32(3.4e38))))
	add(show(json.Marshal(float32(1e-7))))
	add(show(json.Marshal([]float32{0.5, 1.1, 2.2})))
	add(show(json.Marshal(math.NaN())))
	add(show(json.Marshal(math.Inf(1))))
	add(show(json.Marshal(math.Inf(-1))))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`1e+21
100000000000000000000
0.000001
1e-7
100
0.1
0.1
16777216
3.4e+38
1e-7
[0.5,1.1,2.2]
error: json: unsupported value: NaN
error: json: unsupported value: +Inf
error: json: unsupported value: -Inf`,
	);
});

test("Marshal slices and arrays: nil, empty, populated", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}



func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var sNil []int
	add(show(json.Marshal(sNil)))
	add(show(json.Marshal([]int{})))
	add(show(json.Marshal([]int{1, 2, 3})))
	add(show(json.Marshal([3]string{"a", "b", "c"})))
	add(show(json.Marshal([0]int{})))
	add(show(json.Marshal([][]int{{1}, nil, {}})))
	add(show(json.Marshal([]string{"<>", "&"})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`null
[]
[1,2,3]
["a","b","c"]
[]
[[1],null,[]]
["\\u003c\\u003e","\\u0026"]`,
	);
});

test("Marshal []byte as base64 and nil as null", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type MyBytes []byte

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal([]byte("hello"))))
	var nb []byte
	add(show(json.Marshal(nb)))
	add(show(json.Marshal([]byte{})))
	add(show(json.Marshal(MyBytes("hi"))))
	add(show(json.Marshal(struct{ B []byte }{[]byte{1, 2, 3}})))
	add(show(json.Marshal([][]byte{[]byte("a"), []byte("b")})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`"aGVsbG8="
null
""
"aGk="
{"B":"AQID"}
["YQ==","Yg=="]`,
	);
});

test("Marshal maps: nil, empty, sorted keys, integer keys", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type MyKey string

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var mNil map[string]int
	add(show(json.Marshal(mNil)))
	add(show(json.Marshal(map[string]int{})))
	add(show(json.Marshal(map[string]int{"z": 3, "a": 1, "m": 2})))
	add(show(json.Marshal(map[int]string{10: "ten", 2: "two", -1: "neg"})))
	add(show(json.Marshal(map[uint8]bool{200: true, 3: false})))
	add(show(json.Marshal(map[string][]int{"x": {1}, "y": nil})))
	add(show(json.Marshal(map[MyKey]int{"b": 1, "a": 2})))
	add(show(json.Marshal(map[string]map[string]int{"o": {"i": 1}})))
	add(show(json.Marshal(map[string]string{"<k>": "<v>"})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`null
{}
{"a":1,"m":2,"z":3}
{"-1":"neg","10":"ten","2":"two"}
{"200":true,"3":false}
{"x":[1],"y":null}
{"a":2,"b":1}
{"o":{"i":1}}
{"\\u003ck\\u003e":"\\u003cv\\u003e"}`,
	);
});

test("Marshal struct tags: rename, omitempty, dash, unexported", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type In struct{ A int }
type T struct {
	Name   string            \`json:"name"\`
	Count  int               \`json:"count,omitempty"\`
	Tags   []string          \`json:"tags,omitempty"\`
	Opt    *int              \`json:"opt,omitempty"\`
	Flag   bool              \`json:"flag,omitempty"\`
	Skip   string            \`json:"-"\`
	Dash   string            \`json:"-,"\`
	hidden int
	Plain  int
	M      map[string]int    \`json:"m,omitempty"\`
	Inner  In               \`json:"inner"\`
}

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(T{})))
	add(show(json.Marshal(T{Name: "n", Count: 2, Tags: []string{"t"}, Opt: new(int), Flag: true, Skip: "s", Dash: "d", hidden: 1, Plain: 9})))
	add(show(json.Marshal(&T{Name: "ptr"})))
	add(show(json.Marshal([]T{{Name: "a"}, {Name: "b"}})))
	add(show(json.Marshal(map[string]T{"k": {Name: "v"}})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"name":"","-":"","Plain":0,"inner":{"A":0}}
{"name":"n","count":2,"tags":["t"],"opt":0,"flag":true,"-":"d","Plain":9,"inner":{"A":0}}
{"name":"ptr","-":"","Plain":0,"inner":{"A":0}}
[{"name":"a","-":"","Plain":0,"inner":{"A":0}},{"name":"b","-":"","Plain":0,"inner":{"A":0}}]
{"k":{"name":"v","-":"","Plain":0,"inner":{"A":0}}}`,
	);
});

test("Marshal omitempty keeps empty struct values and zero-length arrays out", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type O2 struct{}
type O struct {
	I  int      \`json:",omitempty"\`
	F  float64  \`json:",omitempty"\`
	S  string   \`json:",omitempty"\`
	B  bool     \`json:",omitempty"\`
	P  *O2      \`json:",omitempty"\`
	St O2       \`json:",omitempty"\`
	Sl []int    \`json:",omitempty"\`
	A  [1]int   \`json:",omitempty"\`
	A0 [0]int   \`json:",omitempty"\`
	E  any      \`json:",omitempty"\`
}

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(O{})))
	add(show(json.Marshal(O{I: 1, F: 0.5, S: "x", B: true, P: &O2{}, Sl: []int{}, A: [1]int{0}})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"St":{},"A":[0]}
{"I":1,"F":0.5,"S":"x","B":true,"P":{},"St":{},"A":[0]}`,
	);
});

test("Marshal embedded structs: promotion, tags, shadowing, nil pointers", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Base struct {
	ID   int    \`json:"id"\`
	Name string \`json:"name"\`
}
type Extended struct {
	Base
	Title string \`json:"title"\`
}
type Named struct {
	Base \`json:"base"\`
	Name string \`json:"name"\`
}
type Outer struct {
	Base
	Name string \`json:"name"\`
}
type PE struct {
	*Base
	Z int
}
type L struct{ V int }
type R struct{ V int }
type Diamond struct {
	L
	R
	W int
}
type Mid struct{ Base }
type Deep struct {
	Mid
	X int
}

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(Extended{Base: Base{ID: 42}, Title: "Book"})))
	add(show(json.Marshal(Named{Base: Base{ID: 99}, Name: "Box"})))
	add(show(json.Marshal(Outer{Base: Base{Name: "inner"}, Name: "outer"})))
	add(show(json.Marshal(PE{Z: 4})))
	add(show(json.Marshal(PE{Base: &Base{ID: 2, Name: "k"}, Z: 3})))
	add(show(json.Marshal(Diamond{})))
	add(show(json.Marshal(Deep{Mid: Mid{Base: Base{ID: 5}}, X: 1})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"id":42,"name":"","title":"Book"}
{"base":{"id":99,"name":""},"name":"Box"}
{"id":0,"name":"outer"}
{"Z":4}
{"id":2,"name":"k","Z":3}
{"W":0}
{"id":5,"name":"","X":1}`,
	);
});

test("Marshal recursive types and pointers", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Node struct {
	Val  int
	Next *Node
}
type Tree struct {
	Name string
	Kids []Tree
}

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(Node{Val: 1, Next: &Node{Val: 2, Next: &Node{Val: 3}}})))
	var np *Node
	add(show(json.Marshal(np)))
	n := 7
	add(show(json.Marshal(&n)))
	add(show(json.Marshal([]*int{&n, nil})))
	add(show(json.Marshal(Tree{Kids: []Tree{{Name: "a"}, {Name: "b", Kids: []Tree{{Name: "c"}}}}})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"Val":1,"Next":{"Val":2,"Next":{"Val":3,"Next":null}}}
null
7
[7,null]
{"Name":"","Kids":[{"Name":"a","Kids":null},{"Name":"b","Kids":[{"Name":"c","Kids":null}]}]}`,
	);
});

test("Marshal named basic types", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Celsius float64
type Label string
type Level int8

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(Celsius(36.6))))
	add(show(json.Marshal([]Celsius{1, 2.5})))
	add(show(json.Marshal(Label("x<y"))))
	add(show(json.Marshal(Level(3))))
	add(show(json.Marshal(struct{ L Level; S Label }{4, "s"})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`36.6
[1,2.5]
"x\\u003cy"
3
{"L":4,"S":"s"}`,
	);
});

test("Marshal calls MarshalJSON on value and pointer receivers", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Color int
func (c Color) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf("\\"color-%d\\"", int(c))), nil
}
type Temp struct{ V int }
func (t *Temp) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf("{\\"temp\\": %d}", t.V)), nil
}
type Wrapper struct {
	C  Color
	T  Temp
	PT *Temp
}

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(Color(3))))
	add(show(json.Marshal(Wrapper{C: 1, T: Temp{2}, PT: &Temp{3}})))
	w := Wrapper{C: 1, T: Temp{2}}
	add(show(json.Marshal(&w)))
	add(show(json.Marshal([]Color{1, 2})))
	add(show(json.Marshal(map[string]Color{"a": 5})))
	var pc *Color
	add(show(json.Marshal(pc)))
	t := Temp{9}
	add(show(json.Marshal(&t)))
	add(show(json.Marshal(t)))
	add(show(json.Marshal([]Temp{{1}})))
	add(show(json.Marshal([]*Temp{{1}})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`"color-3"
{"C":"color-1","T":{"V":2},"PT":{"temp":3}}
{"C":"color-1","T":{"temp":2},"PT":null}
["color-1","color-2"]
{"a":"color-5"}
null
{"temp":9}
{"V":9}
[{"temp":1}]
[{"temp":1}]`,
	);
});

test("Marshal compacts and validates MarshalJSON output and wraps its errors", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
	"errors"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

var errBoom = errors.New("boom")
type Loose struct{}
func (Loose) MarshalJSON() ([]byte, error) { return []byte(" { \\"a\\" : [ 1 , 2 ] , \\"s\\" : \\"<&>\\" } "), nil }
type Invalid struct{}
func (Invalid) MarshalJSON() ([]byte, error) { return []byte("{oops"), nil }
type Failing struct{}
func (Failing) MarshalJSON() ([]byte, error) { return nil, errBoom }

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(Loose{})))
	add(show(json.Marshal(Invalid{})))
	add(show(json.Marshal(Failing{})))
	add(show(json.Marshal([]Failing{{}})))
	add(show(json.Marshal(struct{ F Failing }{})))
	_, err := json.Marshal(Failing{})
	add(fmt.Sprint(errors.Unwrap(err) == errBoom))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"a":[1,2],"s":"\\u003c\\u0026\\u003e"}
error: json: error calling MarshalJSON for type lib.Invalid: invalid character 'o' looking for beginning of object key string
error: json: error calling MarshalJSON for type lib.Failing: boom
error: json: error calling MarshalJSON for type lib.Failing: boom
error: json: error calling MarshalJSON for type lib.Failing: boom
true`,
	);
});

test("Marshal quoted fields (,string)", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Q struct {
	I int      \`json:"i,string"\`
	S string   \`json:"s,string"\`
	B bool     \`json:"b,string"\`
	F float64  \`json:"f,string"\`
	U uint8    \`json:"u,string"\`
	P *int     \`json:"p,string"\`
}

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	n := 5
	add(show(json.Marshal(Q{I: 12, S: "hi", B: true, F: 2.5, U: 7, P: &n})))
	add(show(json.Marshal(Q{})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"i":"12","s":"\\"hi\\"","b":"true","f":"2.5","u":"7","p":"5"}
{"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}`,
	);
});

test("Marshal any values: scalars, slices, maps and registered struct types", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Addr struct {
	Street string \`json:"street"\`
	City   string \`json:"city,omitempty"\`
}
type Color int
func (c Color) MarshalJSON() ([]byte, error) { return []byte(\`"c"\`), nil }
type Shape interface{ Area() float64 }
type Sq struct{ S float64 }
func (s Sq) Area() float64 { return s.S * s.S }
type Holder struct {
	V any
	S Shape
}

func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(map[string]any{"n": 1, "s": "x", "l": []any{1, "two", nil}, "m": map[string]any{"k": true}, "f": 2.5})))
	add(show(json.Marshal(map[string]any{"person": Addr{Street: "S"}, "ptr": &Addr{Street: "P", City: "C"}, "list": []Addr{{Street: "L"}}})))
	add(show(json.Marshal(Holder{V: 12, S: Sq{2}})))
	add(show(json.Marshal(Holder{})))
	var a any = []string{"a", "b"}
	add(show(json.Marshal(a)))
	a = Addr{Street: "dyn"}
	add(show(json.Marshal(a)))
	a = int64(1 << 60)
	add(show(json.Marshal(a)))
	add(show(json.Marshal([]any{Color(1), uint16(9), float32(1.5)})))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"f":2.5,"l":[1,"two",null],"m":{"k":true},"n":1,"s":"x"}
{"list":[{"street":"L"}],"person":{"street":"S"},"ptr":{"street":"P","city":"C"}}
{"V":12,"S":{"S":2}}
{"V":null,"S":null}
["a","b"]
{"street":"dyn"}
1152921504606846976
["c",9,1.5]`,
	);
});

test("Marshal unsupported types report Go's error", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}



func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(show(json.Marshal(func() {})))
	add(show(json.Marshal(struct{ F func() }{})))
	add(show(json.Marshal(map[bool]int{true: 1})))
	add(show(json.Marshal(complex(1, 2))))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`error: json: unsupported type: func()
error: json: unsupported type: func()
error: json: unsupported type: map[bool]int
error: json: unsupported type: complex128`,
	);
});

test("Valid", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}



func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	add(fmt.Sprint(json.Valid([]byte(\`{"a":[1,2,{"b":null}]}\`)), json.Valid([]byte(\`{"a":\`)), json.Valid([]byte(" 1 ")), json.Valid([]byte("01")), json.Valid([]byte("")), json.Valid([]byte(\`"\\\\ud800"\`)), json.Valid([]byte("nul"))))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(await runLib(src), `true false true false false true false`);
});

test("Unmarshal scalars into pointers", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}


func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var i int
	var i8 int8
	var u uint
	var u8 uint8
	var f float64
	var f32 float32
	var s string
	var b bool
	add(un("42", &i))
	add(un("-128", &i8))
	add(un("7", &u))
	add(un("255", &u8))
	add(un("2.5", &f))
	add(un("0.1", &f32))
	add(un(\`"h\\u00e9llo \\\\n \\\\u0041"\`, &s))
	add(un("true", &b))
	add(un("  [1, 2]  ", &s))
	var i64 int64
	var u64 uint64
	add(un("9223372036854775807", &i64))
	add(un("18446744073709551615", &u64))
	var big float64
	add(un("123456789012345678901234567890", &big))
	add(un("1e400", &big))
	add(un("-1.5E-3", &big))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`42
-128
7
255
2.5
0.1
"héllo \\\\n \\\\u0041"
true
error: json: cannot unmarshal array into Go value of type string | "héllo \\\\n \\\\u0041"
9223372036854775807
18446744073709551615
1.2345678901234568e+29
error: json: cannot unmarshal number 1e400 into Go value of type float64 | 1.2345678901234568e+29
-0.0015`,
	);
});

test("Unmarshal integer range and fraction errors", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}


func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var i8 int8
	var u8 uint8
	var i int
	var u uint
	add(un("128", &i8))
	add(un("-129", &i8))
	add(un("256", &u8))
	add(un("-1", &u8))
	add(un("1.5", &i))
	add(un("1e2", &i))
	add(un("-1", &u))
	add(un("9223372036854775808", &i))
	add(un("true", &i))
	add(un(\`"1"\`, &i))
	add(un("[1]", &i))
	add(un("{}", &i))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`error: json: cannot unmarshal number 128 into Go value of type int8 | 0
error: json: cannot unmarshal number -129 into Go value of type int8 | 0
error: json: cannot unmarshal number 256 into Go value of type uint8 | 0
error: json: cannot unmarshal number -1 into Go value of type uint8 | 0
error: json: cannot unmarshal number 1.5 into Go value of type int | 0
error: json: cannot unmarshal number 1e2 into Go value of type int | 0
error: json: cannot unmarshal number -1 into Go value of type uint | 0
error: json: cannot unmarshal number 9223372036854775808 into Go value of type int | 0
error: json: cannot unmarshal bool into Go value of type int | 0
error: json: cannot unmarshal string into Go value of type int | 0
error: json: cannot unmarshal array into Go value of type int | 0
error: json: cannot unmarshal object into Go value of type int | 0`,
	);
});

test("Unmarshal syntax errors", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}


func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var v any
	add(un("", &v))
	add(un("{", &v))
	add(un("[1,", &v))
	add(un("[1 2]", &v))
	add(un("{\\"a\\" 1}", &v))
	add(un("{\\"a\\":1,}", &v))
	add(un("nul", &v))
	add(un("tru", &v))
	add(un("'x'", &v))
	add(un("01", &v))
	add(un("1.", &v))
	add(un("-", &v))
	add(un("\\"abc", &v))
	add(un("\\"a\\\\qb\\"", &v))
	add(un("[1] x", &v))
	add(un("\\"\\\\u12\\"", &v))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`error: unexpected end of JSON input | null
error: unexpected end of JSON input | null
error: unexpected end of JSON input | null
error: invalid character '2' after array element | null
error: invalid character '1' after object key | null
error: invalid character '}' looking for beginning of object key string | null
error: invalid character ' ' in literal null (expecting 'l') | null
error: invalid character ' ' in literal true (expecting 'e') | null
error: invalid character '\\'' looking for beginning of value | null
error: invalid character '1' after top-level value | null
error: invalid character ' ' after decimal point in numeric literal | null
error: invalid character ' ' in numeric literal | null
error: unexpected end of JSON input | null
error: invalid character 'q' in string escape code | null
error: invalid character 'x' after top-level value | null
error: invalid character '"' in \\u hexadecimal character escape | null`,
	);
});

test("Unmarshal into struct: tags, case-insensitive match, unknown fields, null", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Addr struct {
	Street string \`json:"street"\`
	City   string \`json:"city,omitempty"\`
}
type P struct {
	Name  string         \`json:"name"\`
	Age   int            \`json:"age"\`
	Score float64
	OK    bool           \`json:"ok"\`
	Tags  []string       \`json:"tags"\`
	Addr  Addr           \`json:"addr"\`
	Home  *Addr          \`json:"home"\`
	M     map[string]int \`json:"m"\`
	Any   any            \`json:"any"\`
	skip  int
	Dash  string         \`json:"-"\`
}

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var p P
	add(un(\`{"name":"Ann","AGE":31,"Score":1.5,"ok":true,"tags":["a","b"],"extra":{"deep":[1,{"x":2}]},"nick":null}\`, &p))
	add(un(\`{"NAME":"Bob","Age":"x"}\`, &p))
	p2 := P{Name: "keep", Age: 9, Tags: []string{"old"}, Home: &Addr{Street: "S"}, M: map[string]int{"k": 1}, Any: 5}
	add(un(\`{"name":null,"age":null,"tags":null,"home":null,"m":null,"any":null}\`, &p2))
	var p3 P
	add(un(\`{"name":"a","name":"b"}\`, &p3))
	add(un(\`{"home":{"street":"H","city":"C"},"addr":{"street":"A"}}\`, &p3))
	add(un(\`[]\`, &p3))
	add(un("null", &p3))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"name":"Ann","age":31,"Score":1.5,"ok":true,"tags":["a","b"],"addr":{"street":""},"home":null,"m":null,"any":null}
error: json: cannot unmarshal string into Go struct field P.age of type int | {"name":"Bob","age":31,"Score":1.5,"ok":true,"tags":["a","b"],"addr":{"street":""},"home":null,"m":null,"any":null}
{"name":"keep","age":9,"Score":0,"ok":false,"tags":null,"addr":{"street":""},"home":null,"m":null,"any":null}
{"name":"b","age":0,"Score":0,"ok":false,"tags":null,"addr":{"street":""},"home":null,"m":null,"any":null}
{"name":"b","age":0,"Score":0,"ok":false,"tags":null,"addr":{"street":"A"},"home":{"street":"H","city":"C"},"m":null,"any":null}
error: json: cannot unmarshal array into Go value of type lib.P | {"name":"b","age":0,"Score":0,"ok":false,"tags":null,"addr":{"street":"A"},"home":{"street":"H","city":"C"},"m":null,"any":null}
{"name":"b","age":0,"Score":0,"ok":false,"tags":null,"addr":{"street":"A"},"home":{"street":"H","city":"C"},"m":null,"any":null}`,
	);
});

test("Unmarshal slices, arrays, maps and pointers", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Pt struct{ X, Y int }

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var s []int
	add(un("[1,2,3]", &s))
	add(un("[]", &s))
	add(un("null", &s))
	var s2 [][]string
	add(un(\`[["a"],[],null,["b","c"]]\`, &s2))
	var a [3]int
	add(un("[1,2]", &a))
	add(un("[1,2,3,4,5]", &a))
	var m map[string]int
	add(un(\`{"b":2,"a":1}\`, &m))
	add(un("{}", &m))
	add(un("null", &m))
	var m2 map[string][]Pt
	add(un(\`{"x":[{"X":1,"Y":2}],"y":[]}\`, &m2))
	var mi map[int]string
	add(un(\`{"10":"ten","-2":"neg"}\`, &mi))
	add(un(\`{"x":"bad"}\`, &mi))
	var mu map[uint8]bool
	add(un(\`{"7":true,"300":false}\`, &mu))
	var sp []*Pt
	add(un(\`[{"X":1},null,{"Y":2}]\`, &sp))
	var ex map[string]int = map[string]int{"keep": 1}
	add(un(\`{"new":2}\`, &ex))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`[1,2,3]
[]
null
[["a"],[],null,["b","c"]]
[1,2,0]
[1,2,3]
{"a":1,"b":2}
{"a":1,"b":2}
null
{"x":[{"X":1,"Y":2}],"y":[]}
{"-2":"neg","10":"ten"}
error: json: cannot unmarshal number x into Go value of type int | {"-2":"neg","10":"ten"}
error: json: cannot unmarshal number 300 into Go value of type uint8 | {"7":true}
[{"X":1,"Y":0},null,{"X":0,"Y":2}]
{"keep":1,"new":2}`,
	);
});

test("Unmarshal reports Go's type errors with the struct field path", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type In struct{ N int \`json:"n"\` }
type Outer struct {
	Name string            \`json:"name"\`
	In   In                \`json:"in"\`
	List []In              \`json:"list"\`
	M    map[string]In     \`json:"m"\`
	F    int8              \`json:"f"\`
	U    uint              \`json:"u"\`
	P    *int              \`json:"p"\`
	Tags []string          \`json:"tags"\`
}

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var o Outer
	add(un(\`{"name":5}\`, &o))
	add(un(\`{"in":{"n":"x"}}\`, &o))
	add(un(\`{"in":[1]}\`, &o))
	add(un(\`{"list":[{"n":1},{"n":"bad"}]}\`, &o))
	add(un(\`{"m":{"k":{"n":true}}}\`, &o))
	add(un(\`{"name":5,"in":{"n":"x"}}\`, &o))
	add(un(\`{"f":1.5}\`, &o))
	add(un(\`{"u":-1}\`, &o))
	add(un(\`{"p":"x"}\`, &o))
	add(un(\`{"tags":{"a":1}}\`, &o))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`error: json: cannot unmarshal number into Go struct field Outer.name of type string | {"name":"","in":{"n":0},"list":null,"m":null,"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal string into Go struct field In.in.n of type int | {"name":"","in":{"n":0},"list":null,"m":null,"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal array into Go struct field Outer.in of type lib.In | {"name":"","in":{"n":0},"list":null,"m":null,"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal string into Go struct field In.list.n of type int | {"name":"","in":{"n":0},"list":[{"n":1},{"n":0}],"m":null,"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal bool into Go struct field In.m.n of type int | {"name":"","in":{"n":0},"list":[{"n":1},{"n":0}],"m":{"k":{"n":0}},"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal number into Go struct field Outer.name of type string | {"name":"","in":{"n":0},"list":[{"n":1},{"n":0}],"m":{"k":{"n":0}},"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal number 1.5 into Go struct field Outer.f of type int8 | {"name":"","in":{"n":0},"list":[{"n":1},{"n":0}],"m":{"k":{"n":0}},"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal number -1 into Go struct field Outer.u of type uint | {"name":"","in":{"n":0},"list":[{"n":1},{"n":0}],"m":{"k":{"n":0}},"f":0,"u":0,"p":null,"tags":null}
error: json: cannot unmarshal string into Go struct field Outer.p of type int | {"name":"","in":{"n":0},"list":[{"n":1},{"n":0}],"m":{"k":{"n":0}},"f":0,"u":0,"p":0,"tags":null}
error: json: cannot unmarshal object into Go struct field Outer.tags of type []string | {"name":"","in":{"n":0},"list":[{"n":1},{"n":0}],"m":{"k":{"n":0}},"f":0,"u":0,"p":0,"tags":null}`,
	);
});

test("Unmarshal into any: maps, slices, float64, strings, bools, nil", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}


func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var v any
	add(un(\`{"a":[1,"two",true,null,{"b":2.5}],"c":"d"}\`, &v))
	add(un("12345678901234567890", &v))
	add(un("[]", &v))
	add(un("{}", &v))
	add(un("null", &v))
	add(un(\`"s"\`, &v))
	m, ok := v.(map[string]any)
	add(fmt.Sprint(m == nil, ok))
	add(un(\`{"x":{"y":[1,2]}}\`, &v))
	m = v.(map[string]any)
	inner := m["x"].(map[string]any)
	l := inner["y"].([]any)
	add(fmt.Sprint(len(m), len(inner), len(l), l[0].(float64)+l[1].(float64)))
	var ms map[string]any
	add(un(\`{"k":1,"j":[true]}\`, &ms))
	var ls []any
	add(un(\`[1,{"a":null}]\`, &ls))
	var st struct{ X any }
	add(un(\`{"X":{"deep":[1]}}\`, &st))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"a":[1,"two",true,null,{"b":2.5}],"c":"d"}
12345678901234567000
[]
{}
null
"s"
true false
{"x":{"y":[1,2]}}
1 1 2 3
{"j":[true],"k":1}
[1,{"a":null}]
{"X":{"deep":[1]}}`,
	);
});

test("Unmarshal []byte from base64 and number arrays", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type MyBytes []byte

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var b []byte
	add(un(\`"aGVsbG8="\`, &b))
	add(string(b))
	add(un("null", &b))
	add(un("[104,105]", &b))
	add(string(b))
	add(un("5", &b))
	var mb MyBytes
	add(un(\`"aGk="\`, &mb))
	var st struct{ B []byte \`json:"b"\` }
	add(un(\`{"b":"AQID"}\`, &st))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`"aGVsbG8="
hello
null
"aGk="
hi
error: json: cannot unmarshal number into Go value of type []uint8 | "aGk="
"aGk="
{"b":"AQID"}`,
	);
});

test("Unmarshal embedded structs", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Base struct {
	ID   int    \`json:"id"\`
	Name string \`json:"name"\`
}
type Extended struct {
	Base
	Title string \`json:"title"\`
}
type PE struct {
	*Base
	Z int
}
type Named struct {
	Base \`json:"base"\`
	Name string \`json:"name"\`
}
type Outer struct {
	Base
	Name string \`json:"name"\`
}

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var e Extended
	add(un(\`{"id":42,"title":"Book","name":"n"}\`, &e))
	var pe PE
	add(un(\`{"id":7,"Z":3}\`, &pe))
	add(fmt.Sprint(pe.Base != nil, pe.ID))
	var pe2 PE
	add(un(\`{"Z":3}\`, &pe2))
	add(fmt.Sprint(pe2.Base == nil))
	var n Named
	add(un(\`{"base":{"id":9},"name":"nm"}\`, &n))
	var o Outer
	add(un(\`{"name":"outer","id":1}\`, &o))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"id":42,"name":"n","title":"Book"}
{"id":7,"name":"","Z":3}
true 7
{"Z":3}
true
{"base":{"id":9,"name":""},"name":"nm"}
{"id":1,"name":"outer"}`,
	);
});

test("Unmarshal quoted fields (,string)", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Q struct {
	I int      \`json:"i,string"\`
	S string   \`json:"s,string"\`
	B bool     \`json:"b,string"\`
	F float64  \`json:"f,string"\`
	U uint8    \`json:"u,string"\`
	P *int     \`json:"p,string"\`
}

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var q Q
	add(un(\`{"i":"12","s":"\\\\"hi\\\\"","b":"true","f":"2.5","u":"7","p":"5"}\`, &q))
	add(un(\`{"i":12}\`, &q))
	add(un(\`{"i":"x"}\`, &q))
	add(un(\`{"b":"yes"}\`, &q))
	add(un(\`{"s":"hi"}\`, &q))
	add(un(\`{"i":null,"p":null}\`, &q))
	add(un(\`{"u":"300"}\`, &q))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`error: invalid character 'h' after object key:value pair | {"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}
error: json: invalid use of ,string struct tag, trying to unmarshal unquoted value into int | {"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}
error: json: invalid use of ,string struct tag, trying to unmarshal "x" into int | {"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}
error: json: invalid use of ,string struct tag, trying to unmarshal "yes" into bool | {"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}
error: json: invalid use of ,string struct tag, trying to unmarshal "hi" into string | {"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}
{"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}
error: json: cannot unmarshal number 300 into Go struct field Q.u of type uint8 | {"i":"0","s":"\\"\\"","b":"false","f":"0","u":"0","p":null}`,
	);
});

test("Unmarshal named types, float32 and large numbers", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Celsius float64
type Label string
type Level int8

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var c Celsius
	add(un("36.6", &c))
	var l Label
	add(un(\`"x"\`, &l))
	var lv Level
	add(un("3", &lv))
	var f32 []float32
	add(un("[0.1, 16777217, 3.4e38, 1e39]", &f32))
	var fs struct{ A float32 \`json:"a"\`; B *float32 \`json:"b"\` }
	add(un(\`{"a":0.1,"b":2.2}\`, &fs))
	var n []int
	add(un("[1e2, 0, -0, 12]", &n))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`36.6
"x"
3
error: json: cannot unmarshal number 1e39 into Go value of type float32 | [0.1,16777216,3.4e+38,0]
{"a":0.1,"b":2.2}
error: json: cannot unmarshal number 1e2 into Go value of type int | [0,0,0,12]`,
	);
});

test("Unmarshal needs a non-nil pointer", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}


func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var n int
	add(un("1", n))
	var pn *int
	add(un("1", pn))
	add(un("1", nil))
	add(un("{", pn))
	add(un("1", &n))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`error: json: Unmarshal(non-pointer int) | 0
error: json: Unmarshal(nil *int) | null
error: json: Unmarshal(nil) | null
error: unexpected end of JSON input | null
1`,
	);
});

test("Unmarshal calls UnmarshalJSON with the raw value bytes", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
	"errors"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Up struct{ S string }
func (u *Up) UnmarshalJSON(b []byte) error {
	u.S = strings.ToUpper(string(b))
	return nil
}
type Strict struct{ N int }
var errStrict = errors.New("strict says no")
func (s *Strict) UnmarshalJSON(b []byte) error {
	if string(b) == "0" {
		return errStrict
	}
	s.N = len(b)
	return nil
}
type Color int
func (c *Color) UnmarshalJSON(b []byte) error {
	*c = Color(len(b))
	return nil
}
type Colors []Color
type Doc struct {
	U  Up             \`json:"u"\`
	UP *Up            \`json:"up"\`
	L  []Up           \`json:"l"\`
	M  map[string]Up  \`json:"m"\`
	C  Color          \`json:"c"\`
	CS Colors         \`json:"cs"\`
}
type Base struct{ Raw string }
func (b *Base) UnmarshalJSON(data []byte) error {
	b.Raw = string(data)
	return nil
}
type Wrap struct {
	Base
	Z int
}

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var d Doc
	add(un(\`{"u":"ab","up":"cd","l":["ef",{"x":1}],"m":{"k":[1, 2]},"c":7,"cs":[1,2]}\`, &d))
	add(fmt.Sprint(d.U.S, d.UP.S, d.L[0].S, d.L[1].S, d.M["k"].S, int(d.C), int(d.CS[1])))
	d2 := Doc{UP: &Up{S: "keep"}}
	add(un(\`{"u":null,"up":null,"c":null}\`, &d2))
	add(fmt.Sprint(d2.U.S, d2.UP == nil))
	var top Up
	add(un(\` "top" \`, &top))
	add(top.S)
	var st Strict
	err := json.Unmarshal([]byte("0"), &st)
	add(fmt.Sprint(errors.Is(err, errStrict), err))
	var sts []Strict
	err = json.Unmarshal([]byte("[12, 0]"), &sts)
	add(fmt.Sprint(errors.Is(err, errStrict), err, err == errStrict))
	var w Wrap
	err = json.Unmarshal([]byte(\`{"Z": 3}\`), &w)
	add(fmt.Sprint(err, w.Raw, w.Z))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"u":{"S":"\\"AB\\""},"up":{"S":"\\"CD\\""},"l":[{"S":"\\"EF\\""},{"S":"{\\"X\\":1}"}],"m":{"k":{"S":"[1, 2]"}},"c":1,"cs":[1,1]}
"AB""CD""EF"{"X":1}[1, 2]1 1
{"u":{"S":"NULL"},"up":null,"l":null,"m":null,"c":4,"cs":null}
NULLtrue
{"S":"\\"TOP\\""}
"TOP"
true strict says no
true strict says no true
<nil>{"Z": 3}0`,
	);
});

test("Unmarshal keeps the exact bytes of a RawMessage", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Pt struct{ X, Y int }
type Msg struct {
	ID      int                        \`json:"id"\`
	Payload json.RawMessage            \`json:"payload"\`
	List    []json.RawMessage          \`json:"list"\`
	M       map[string]json.RawMessage \`json:"m"\`
	N       json.RawMessage            \`json:"n"\`
}
type Lazy struct {
	Kind string          \`json:"kind"\`
	Data json.RawMessage \`json:"data"\`
}

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var m Msg
	add(un(\`{"id":1,"payload": {"a" : [1, 2 ,3], "b":"x"} ,"list":[ 1 , "two" ,{"k":null}],"m":{"x": true ,"y":null},"n":null}\`, &m))
	add(string(m.Payload))
	add(string(m.List[0]) + "|" + string(m.List[1]) + "|" + string(m.List[2]))
	add(string(m.M["x"]) + "|" + string(m.M["y"]))
	add(string(m.N))
	var raw json.RawMessage
	add(un(\`  {"top" : [ ]}  \`, &raw))
	add(string(raw))
	add(un("null", &raw))
	add(string(raw))
	var m2 Msg
	add(un(\`{"payload":null}\`, &m2))
	add(string(m2.Payload))
	b, err := json.Marshal(Msg{ID: 2, Payload: json.RawMessage(\`{ "z" : 1 }\`), N: nil})
	add(string(b))
	add(fmt.Sprint(err))
	b, err = json.Marshal(json.RawMessage(\`[1, 2]\`))
	add(string(b))
	var nilRaw json.RawMessage
	b, err = json.Marshal(nilRaw)
	add(string(b))
	b, err = json.Marshal(Msg{Payload: json.RawMessage(\`{bad\`)})
	add(string(b))
	add(fmt.Sprint(err))
	var holder any
	add(un(\`{"x":[1]}\`, &holder))
	var lazy Lazy
	add(un(\`{"kind":"point","data":{"X":1,"Y":2}}\`, &lazy))
	var pt Pt
	add(fmt.Sprint(json.Unmarshal(lazy.Data, &pt), pt.X, pt.Y))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"id":1,"payload":{"a":[1,2,3],"b":"x"},"list":[1,"two",{"k":null}],"m":{"x":true,"y":null},"n":null}
{"a" : [1, 2 ,3], "b":"x"}
1|"two"|{"k":null}
true|null
null
{"top":[]}
{"top" : [ ]}
null
null
{"id":0,"payload":null,"list":null,"m":null,"n":null}
null
{"id":2,"payload":{"z":1},"list":null,"m":null,"n":null}
<nil>
[1,2]
null

json: error calling MarshalJSON for type json.RawMessage: invalid character 'b' looking for beginning of object key string
{"x":[1]}
{"kind":"point","data":{"X":1,"Y":2}}
<nil> 1 2`,
	);
});

test("Unmarshal decodes numbers in any as float64 and keeps nested structure", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}

type Holder struct{ A, B, C, D, E, F any }

func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var v any
	add(un(\`[1, 2.5, -3e2, 1e21, 0.1, 123456789.125, 9007199254740993]\`, &v))
	l := v.([]any)
	add(fmt.Sprint(len(l), l[0].(float64), l[3].(float64), l[6].(float64) == 9007199254740992))
	add(un(\`{"b":{"c":[true,false,null]},"a":"x\\u00e9\\ud83d\\ude00y"}\`, &v))
	m := v.(map[string]any)
	add(m["a"].(string))
	add(fmt.Sprint(len(m["a"].(string)) > 0))
	deep := m["b"].(map[string]any)["c"].([]any)
	add(fmt.Sprint(deep[0], deep[1], deep[2] == nil))
	var h Holder
	add(un(\`{"A":1,"B":"s","C":[1,2],"D":{"k":"v"},"E":null,"F":true}\`, &h))
	add(fmt.Sprint(h.A.(float64), h.B.(string), len(h.C.([]any)), h.D.(map[string]any)["k"], h.E == nil, h.F.(bool)))
	var sl []any
	add(un(\`[[1],[2,[3]],{}]\`, &sl))
	var mm map[string]any
	add(un(\`{"n":null,"x":[]}\`, &mm))
	add(fmt.Sprint(len(mm), mm["n"] == nil, mm["x"] != nil))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`[1,2.5,-300,1e+21,0.1,123456789.125,9007199254740992]
7 1 1e+21 true
{"a":"xé😀y","b":{"c":[true,false,null]}}
xé😀y
true
true false true
{"A":1,"B":"s","C":[1,2],"D":{"k":"v"},"E":null,"F":true}
1s2vtrue true
[[1],[2,[3]],{}]
{"n":null,"x":[]}
2 true true`,
	);
});

test("Unmarshal into any keeps an existing pointer target out of the way", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"strings"
)

var _ = fmt.Sprint
var _ = strings.Join

func show(b []byte, err error) string {
	if err != nil {
		return "error: " + err.Error()
	}
	return string(b)
}


func un(data string, v any) string {
	err := json.Unmarshal([]byte(data), v)
	b, _ := json.Marshal(v)
	if err != nil {
		return "error: " + err.Error() + " | " + string(b)
	}
	return string(b)
}


func Run() string {
	var out []string
	add := func(s string) { out = append(out, s) }

	var v any = 5
	add(un(\`{"a":1}\`, &v))
	var e any
	add(un("[]", &e))
	add(fmt.Sprint(e != nil))

	return strings.Join(out, "\\n")
}
`;
	assertEqual(
		await runLib(src),
		`{"a":1}
[]
true`,
	);
});

test("Unmarshal into a pointer to a pointer reports a diagnostic", async () => {
	let err = "";
	try {
		await runLib(`//gofront:target wasm
package lib

import "encoding/json"

type T struct{ A int }

func Run() string {
	var p *T
	_ = json.Unmarshal([]byte("{}"), &p)
	return ""
}
`);
	} catch (e) {
		err = e.message;
	}
	assertContains(
		err,
		"json.Unmarshal into a pointer to a pointer is not yet available in wasm packages",
	);
});

test("json round trip gives the same result in a both package on JS and WASM", async () => {
	const body = `package lib

import "encoding/json"

type Item struct {
	Name  string   \`json:"name"\`
	Qty   int      \`json:"qty,omitempty"\`
	Tags  []string \`json:"tags"\`
	Price float64
}

func Run() string {
	b, err := json.Marshal([]Item{{Name: "a<b", Qty: 2, Tags: []string{"x"}, Price: 1.5}, {Name: "c"}})
	if err != nil {
		return err.Error()
	}
	var back []Item
	if err := json.Unmarshal(b, &back); err != nil {
		return err.Error()
	}
	out, _ := json.Marshal(back)
	return string(b) + "\\n" + string(out)
}
`;
	const run = async (target) => {
		const res = await compileHybridProject({
			"lib/lib.go": `//gofront:target ${target}\n${body}`,
			"main.go": `package main\n\nimport "./lib"\n\nfunc main() { println(lib.Run()) }\n`,
		});
		return res.lines.join("\n");
	};
	const js = await run("both");
	const wasm = await run("wasm");
	assertEqual(wasm, js);
	assertEqual(
		wasm,
		'[{"name":"a\\u003cb","qty":2,"tags":["x"],"Price":1.5},{"name":"c","tags":null,"Price":0}]\n[{"name":"a\\u003cb","qty":2,"tags":["x"],"Price":1.5},{"name":"c","tags":null,"Price":0}]',
	);
});

// ── Real-Go conformance (expected output captured from go run) ──

test("real Go output: json/errors on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

type User struct {
	Name string \`json:"name"\`
	Age  int    \`json:"age"\`
}

type FailMarshal struct{}

func (FailMarshal) MarshalJSON() ([]byte, error) {
	return nil, errors.New("marshaler failed")
}

func main() {
	// 1. SyntaxError
	var synErr *json.SyntaxError
	var u User
	err := json.Unmarshal([]byte(\`{"name": "foo", "age": }\`), &u)
	if errors.As(err, &synErr) {
		fmt.Printf("SyntaxError: Offset=%d msg=%s\\n", synErr.Offset, synErr.Error())
	}

	err = json.Unmarshal([]byte(\`{"unclosed"\`), &u)
	if errors.As(err, &synErr) {
		fmt.Printf("SyntaxError EOF: Offset=%d msg=%s\\n", synErr.Offset, synErr.Error())
	}

	// 2. UnmarshalTypeError
	var typeErr *json.UnmarshalTypeError
	err = json.Unmarshal([]byte(\`{"name":"bar","age":"notanumber"}\`), &u)
	if errors.As(err, &typeErr) {
		fmt.Printf("UnmarshalTypeError struct: Value=%s Struct=%s Field=%s Offset=%d msg=%s\\n",
			typeErr.Value, typeErr.Struct, typeErr.Field, typeErr.Offset, typeErr.Error())
	}

	var num int
	err = json.Unmarshal([]byte(\`"notanumber"\`), &num)
	if errors.As(err, &typeErr) {
		fmt.Printf("UnmarshalTypeError scalar: Value=%s Struct=%s Field=%s msg=%s\\n",
			typeErr.Value, typeErr.Struct, typeErr.Field, typeErr.Error())
	}

	// 3. InvalidUnmarshalError
	var invErr *json.InvalidUnmarshalError
	err = json.Unmarshal([]byte(\`{"name":"foo"}\`), nil)
	if errors.As(err, &invErr) {
		fmt.Printf("InvalidUnmarshalError nil: msg=%s\\n", invErr.Error())
	}

	err = json.Unmarshal([]byte(\`{"name":"foo"}\`), u)
	if errors.As(err, &invErr) {
		fmt.Printf("InvalidUnmarshalError non-ptr: msg=%s\\n", invErr.Error())
	}

	// 4. UnsupportedValueError
	var valErr *json.UnsupportedValueError
	_, err = json.Marshal(math.NaN())
	if errors.As(err, &valErr) {
		fmt.Printf("UnsupportedValueError NaN: Str=%s msg=%s\\n", valErr.Str, valErr.Error())
	}

	// 5. MarshalerError
	var marshErr *json.MarshalerError
	_, err = json.Marshal(FailMarshal{})
	if errors.As(err, &marshErr) {
		fmt.Printf("MarshalerError: msg=%s unwrap=%v\\n", marshErr.Error(), errors.Unwrap(marshErr))
	}
}
`,
		`SyntaxError: Offset=24 msg=invalid character '}' looking for beginning of value
SyntaxError EOF: Offset=11 msg=unexpected end of JSON input
UnmarshalTypeError struct: Value=string Struct=User Field=age Offset=32 msg=json: cannot unmarshal string into Go struct field User.age of type int
UnmarshalTypeError scalar: Value=string Struct= Field= msg=json: cannot unmarshal string into Go value of type int
InvalidUnmarshalError nil: msg=json: Unmarshal(nil)
InvalidUnmarshalError non-ptr: msg=json: Unmarshal(non-pointer main.User)
UnsupportedValueError NaN: Str=NaN msg=json: unsupported value: NaN
MarshalerError: msg=json: error calling MarshalJSON for type main.FailMarshal: marshaler failed unwrap=marshaler failed
`,
	);
});

test("real Go output: json/indent on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func main() {
	var buf bytes.Buffer

	// Compact
	src1 := []byte(\` { "name" : "Alice" , "nums" : [ 1 , 2 , 3 ] } \`)
	err := json.Compact(&buf, src1)
	fmt.Printf("Compact: err=%v out=%s\\n", err, buf.String())

	buf.Reset()
	err = json.Compact(&buf, []byte(\` { "broken" \`))
	fmt.Printf("Compact err: %v\\n", err != nil)

	// Indent
	buf.Reset()
	src2 := []byte(\`{"title":"GoFront","items":[1,2],"empty_obj":{},"empty_arr":[]}\`)
	err = json.Indent(&buf, src2, "", "  ")
	fmt.Printf("Indent: err=%v\\n%s\\n", err, buf.String())

	buf.Reset()
	err = json.Indent(&buf, src2, ">> ", "  ")
	fmt.Printf("Indent with prefix: err=%v\\n%s\\n", err, buf.String())

	buf.Reset()
	err = json.Indent(&buf, []byte(\`[1,\`), "", "  ")
	fmt.Printf("Indent err: %v\\n", err != nil)

	// HTMLEscape
	buf.Reset()
	src3 := []byte(\`{"body":"<b>Hello & Welcome</b>"}\`)
	json.HTMLEscape(&buf, src3)
	fmt.Printf("HTMLEscape: %s\\n", buf.String())

	// Number
	var n json.Number = "42.5"
	f, err := n.Float64()
	fmt.Printf("Number Float64: %v, err=%v\\n", f, err)
	var nInt json.Number = "123456"
	i, err := nInt.Int64()
	fmt.Printf("Number Int64: %v, err=%v\\n", i, err)
	fmt.Printf("Number String: %s\\n", n.String())

	var decodedNum json.Number
	err = json.Unmarshal([]byte("987.654"), &decodedNum)
	fmt.Printf("Unmarshal into Number: %s, err=%v\\n", decodedNum, err)

	err = json.Unmarshal([]byte(\`"987.654"\`), &decodedNum)
	fmt.Printf("Unmarshal string into Number: %s, err=%v\\n", decodedNum, err)

	b, err := json.Marshal(decodedNum)
	fmt.Printf("Marshal Number: %s, err=%v\\n", string(b), err)

	b, err = json.Marshal(json.Number(""))
	fmt.Printf("Marshal empty Number: %s, err=%v\\n", string(b), err)
}
`,
		`Compact: err=<nil> out={"name":"Alice","nums":[1,2,3]}
Compact err: true
Indent: err=<nil>
{
  "title": "GoFront",
  "items": [
    1,
    2
  ],
  "empty_obj": {},
  "empty_arr": []
}
Indent with prefix: err=<nil>
{
>>   "title": "GoFront",
>>   "items": [
>>     1,
>>     2
>>   ],
>>   "empty_obj": {},
>>   "empty_arr": []
>> }
Indent err: true
HTMLEscape: {"body":"\\u003cb\\u003eHello \\u0026 Welcome\\u003c/b\\u003e"}
Number Float64: 42.5, err=<nil>
Number Int64: 123456, err=<nil>
Number String: 42.5
Unmarshal into Number: 987.654, err=<nil>
Unmarshal string into Number: 987.654, err=<nil>
Marshal Number: 987.654, err=<nil>
Marshal empty Number: 0, err=<nil>
`,
	);
});

test("real Go output: json/unmarshaler on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type Up struct{ S string }

func (u *Up) UnmarshalJSON(b []byte) error {
	u.S = strings.ToUpper(string(b))
	return nil
}

type Strict struct{ N int }

var errStrict = errors.New("strict says no")

func (s *Strict) UnmarshalJSON(b []byte) error {
	if string(b) == "0" {
		return errStrict
	}
	s.N = len(b)
	return nil
}

type Doc struct {
	U  Up            \`json:"u"\`
	UP *Up           \`json:"up"\`
	L  []Up          \`json:"l"\`
	M  map[string]Up \`json:"m"\`
}

type Msg struct {
	ID      int               \`json:"id"\`
	Payload json.RawMessage   \`json:"payload"\`
	List    []json.RawMessage \`json:"list"\`
}

type Pt struct{ X, Y int }

func main() {
	var d Doc
	err := json.Unmarshal([]byte(\`{"u":"ab","up":"cd","l":["ef",{"x":1}],"m":{"k":[1, 2]}}\`), &d)
	fmt.Println(err, d.U.S, d.UP.S, d.L[0].S, d.L[1].S, d.M["k"].S)
	var d2 Doc
	d2.UP = &Up{S: "keep"}
	err = json.Unmarshal([]byte(\`{"u":null,"up":null}\`), &d2)
	fmt.Println(err, d2.U.S, d2.UP == nil)
	var top Up
	err = json.Unmarshal([]byte(\` "top" \`), &top)
	fmt.Println(err, top.S)
	var st Strict
	err = json.Unmarshal([]byte("0"), &st)
	fmt.Println(errors.Is(err, errStrict), err)
	var sts []Strict
	err = json.Unmarshal([]byte("[12, 0]"), &sts)
	fmt.Println(errors.Is(err, errStrict), err)

	var m Msg
	err = json.Unmarshal([]byte(\`{"id":1,"payload": {"a" : [1, 2 ,3], "b":"x"} ,"list":[ 1 , "two" ,{"k":null}]}\`), &m)
	fmt.Println(err, m.ID)
	fmt.Println(string(m.Payload))
	fmt.Println(string(m.List[0]) + "|" + string(m.List[1]) + "|" + string(m.List[2]))
	var lazy struct {
		Kind string          \`json:"kind"\`
		Data json.RawMessage \`json:"data"\`
	}
	err = json.Unmarshal([]byte(\`{"kind":"point","data":{"X":1,"Y":2}}\`), &lazy)
	var pt Pt
	fmt.Println(err, lazy.Kind, json.Unmarshal(lazy.Data, &pt), pt.X, pt.Y)
}
`,
		`<nil> "AB" "CD" "EF" {"X":1} [1, 2]
<nil> NULL true
<nil> "TOP"
true strict says no
true strict says no
<nil> 1
{"a" : [1, 2 ,3], "b":"x"}
1|"two"|{"k":null}
<nil> point <nil> 1 2
`,
	);
});

test("Decoder reads a multi-value stream from a one-byte reader", async () => {
	const out = await runLib(`//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type oneByte struct{ r io.Reader }

func (o oneByte) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	n, err := o.r.Read(p[:1])
	return n, err
}

type Item struct {
	A int
	B string
}

func Run() string {
	dec := json.NewDecoder(oneByte{strings.NewReader(\`{"A":1,"B":"x"} {"A":2,"B":"y"}  {"B":"end"}\`)})
	out := ""
	for dec.More() {
		var it Item
		err := dec.Decode(&it)
		out += fmt.Sprint(it.A, it.B, err, dec.InputOffset(), ";")
	}
	var v Item
	return out + fmt.Sprint(dec.Decode(&v) == io.EOF)
}
`);
	assertEqual(out, "1x<nil> 15;2y<nil> 31;0end<nil> 44;true");
});

test("Types that reach `any` only through a function result or variable encode", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
)

type T struct{ A int }

func get() []T            { return nil }
func getm() map[string]T  { return nil }
func geta() [2]T          { return [2]T{{1}, {2}} }
func gets() []string      { return []string{"x"} }
func getmi() map[int]bool { return map[int]bool{2: true, 1: false} }

func Run() string {
	out := ""
	for _, v := range []any{get(), getm(), geta(), gets(), getmi()} {
		b, err := json.Marshal(v)
		out += fmt.Sprint(string(b), " ", err, ";")
	}
	var a any = get()
	b, err := json.Marshal(a)
	return out + fmt.Sprint(string(b), " ", err)
}
`;
	assertEqual(
		await runLib(src),
		'null <nil>;null <nil>;[{"A":1},{"A":2}] <nil>;["x"] <nil>;{"1":false,"2":true} <nil>;null <nil>',
	);
});

test("A []byte conversion does not change how an int32 slice in any encodes", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
)

func Run() string {
	var v any = []int32{1, 2}
	in := []byte("[1]")
	var out []int32
	err := json.Unmarshal(in, &out)
	b, merr := json.Marshal(v)
	return fmt.Sprint(string(b), " ", merr, " ", err, " ", out)
}
`;
	assertEqual(await runLib(src), "[1,2] <nil> <nil> [1]");
});

test("Negative zero float64 encodes as -0", async () => {
	const src = `//gofront:target wasm
package lib

import (
	"encoding/json"
	"fmt"
	"math"
)

type W struct{ A float64 }

func Run() string {
	z := math.Copysign(0, -1)
	a, _ := json.Marshal(W{A: z})
	b, _ := json.Marshal(z)
	c, _ := json.Marshal([]float32{float32(z), 1})
	return fmt.Sprint(string(a), string(b), string(c))
}
`;
	assertEqual(await runLib(src), '{"A":-0}-0[-0,1]');
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
