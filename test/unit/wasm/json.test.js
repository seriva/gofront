// encoding/json in wasm packages: the codecs generated for each call site.
// Each case is a wasm package whose Run() builds its output with the JSON
// calls under test; the expectation is what real Go (go1.26) prints for the
// same program.  Differences the JS backend still has (see
// plans/follow-ups.md) are why the expectations are Go's, not the JS output.

import { fileURLToPath } from "node:url";
import {
	assertEqual,
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
