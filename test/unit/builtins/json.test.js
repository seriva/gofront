// GoFront test suite — encoding/json package

import { fileURLToPath } from "node:url";
import { compileDir } from "../../../src/compiler.js";
import {
	assert,
	assertAllTargetsOutput,
	assertContains,
	assertEqual,
	assertErrorContains,
	assertFourWay,
	assertJsProgramOutput,
	assertJsTargetsOutput,
	assertProgramOutput,
	compile,
	compileHybridProject,
	runJs,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

// ═════════════════════════════════════════════════════════════
// json.Marshal — Primitives, Slices, Maps
// ═════════════════════════════════════════════════════════════

section("encoding/json — basic Marshal");

test("json.Marshal primitives", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	b1, _ := json.Marshal(42)
	b2, _ := json.Marshal(3.14)
	b3, _ := json.Marshal("hello")
	b4, _ := json.Marshal(true)
	console.log(string(b1))
	console.log(string(b2))
	console.log(string(b3))
	console.log(string(b4))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '42\n3.14\n"hello"\ntrue');
});

test("json.Marshal HTML-safe escaping", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	b, _ := json.Marshal("<foo>&<bar>")
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '"\\u003cfoo\\u003e\\u0026\\u003cbar\\u003e"');
});

test("json.Marshal slices: nil vs empty vs populated", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	var sNil []int = nil
	sEmpty := []int{}
	sPop := []int{1, 2, 3}
	b1, _ := json.Marshal(sNil)
	b2, _ := json.Marshal(sEmpty)
	b3, _ := json.Marshal(sPop)
	console.log(string(b1))
	console.log(string(b2))
	console.log(string(b3))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "null\n[]\n[1,2,3]");
});

test("json.Marshal maps: nil vs empty vs sorted keys", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	var mNil map[string]int = nil
	mEmpty := map[string]int{}
	mPop := map[string]int{"z": 3, "a": 1, "m": 2}
	b1, _ := json.Marshal(mNil)
	b2, _ := json.Marshal(mEmpty)
	b3, _ := json.Marshal(mPop)
	console.log(string(b1))
	console.log(string(b2))
	console.log(string(b3))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), 'null\n{}\n{"a":1,"m":2,"z":3}');
});

// ═════════════════════════════════════════════════════════════
// json.Marshal — Structs, omitempty, tags
// ═════════════════════════════════════════════════════════════

section("encoding/json — struct Marshal & tags");

test("json.Marshal struct fields in declaration order with rename", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type User struct {
	ID    int    \`json:"id"\`
	Name  string \`json:"name"\`
	Email string \`json:"user_email"\`
}
func main() {
	u := User{ID: 101, Name: "Alice", Email: "alice@example.com"}
	b, _ := json.Marshal(u)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		'{"id":101,"name":"Alice","user_email":"alice@example.com"}',
	);
});

test("json.Marshal omitempty skips zero values but keeps empty struct values", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Address struct {
	City string \`json:"city,omitempty"\`
}
type Profile struct {
	Name    string   \`json:"name,omitempty"\`
	Age     int      \`json:"age,omitempty"\`
	Active  bool     \`json:"active,omitempty"\`
	Tags    []string \`json:"tags,omitempty"\`
	Addr    Address  \`json:"addr,omitempty"\`
	Extra   string   \`json:"extra"\`
}
func main() {
	p := Profile{Extra: "always"}
	b, _ := json.Marshal(p)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	// In Go stdlib, empty struct values are NOT omitted by omitempty
	assertEqual(runJs(js), '{"addr":{},"extra":"always"}');
});

test("json.Marshal '-' and '-,' tags and unexported fields", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Item struct {
	secret string
	Public string \`json:"public"\`
	Skip   string \`json:"-"\`
	Hyphen string \`json:"-,"\`
}
func main() {
	i := Item{secret: "hide", Public: "see", Skip: "no", Hyphen: "dash"}
	b, _ := json.Marshal(i)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"public":"see","-":"dash"}');
});

// ═════════════════════════════════════════════════════════════
// json.Marshal — Embedded Structs Promotion & Conflicts
// ═════════════════════════════════════════════════════════════

section("encoding/json — embedded structs");

test("json.Marshal promotes embedded struct fields", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Base struct {
	ID int \`json:"id"\`
}
type Extended struct {
	Base
	Title string \`json:"title"\`
}
func main() {
	e := Extended{Base: Base{ID: 42}, Title: "Book"}
	b, _ := json.Marshal(e)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"id":42,"title":"Book"}');
});

test("json.Marshal embedded struct with explicit tag name is not promoted", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Base struct {
	ID int \`json:"id"\`
}
type Container struct {
	Base \`json:"base"\`
	Name string \`json:"name"\`
}
func main() {
	c := Container{Base: Base{ID: 99}, Name: "Box"}
	b, _ := json.Marshal(c)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"base":{"id":99},"name":"Box"}');
});

test("json.Marshal shallower field shadows deeper embedded field", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Base struct {
	Name string \`json:"name"\`
}
type Outer struct {
	Base
	Name string \`json:"name"\`
}
func main() {
	o := Outer{Base: Base{Name: "inner"}, Name: "outer"}
	b, _ := json.Marshal(o)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"name":"outer"}');
});

// ═════════════════════════════════════════════════════════════
// json.Marshal — 64-bit Integers & RawMessage
// ═════════════════════════════════════════════════════════════

section("encoding/json — int64 and RawMessage");

test("json.Marshal 64-bit integers serialized as exact numbers", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Data struct {
	Big int64 \`json:"big"\`
}
func main() {
	d := Data{Big: 9007199254740991}
	b, _ := json.Marshal(d)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"big":9007199254740991}');
});

test("json.Marshal []byte base64 vs RawMessage verbatim", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Packet struct {
	Bytes []byte          \`json:"bytes"\`
	Raw   json.RawMessage \`json:"raw"\`
}
func main() {
	p := Packet{
		Bytes: []byte("hello"),
		Raw:   json.RawMessage(\`{"nested":123}\`),
	}
	b, _ := json.Marshal(p)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"bytes":"aGVsbG8=","raw":{"nested":123}}');
});

test("json.Marshal top-level RawMessage", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	raw := json.RawMessage(\`{"foo":"bar"}\`)
	b, _ := json.Marshal(raw)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"foo":"bar"}');
});

// ═════════════════════════════════════════════════════════════
// json.MarshalIndent & json.Valid
// ═════════════════════════════════════════════════════════════

section("encoding/json — MarshalIndent & Valid");

test("json.MarshalIndent produces formatted output", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Person struct {
	Name string \`json:"name"\`
	Age  int    \`json:"age"\`
}
func main() {
	p := Person{Name: "Bob", Age: 25}
	b, _ := json.MarshalIndent(p, "", "  ")
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	const expected = '{\n  "name": "Bob",\n  "age": 25\n}';
	assertEqual(runJs(js), expected);
});

test("json.Valid reports boolean validity", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	console.log(json.Valid([]byte(\`{"ok": true}\`)))
	console.log(json.Valid([]byte(\`{invalid json\`)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

// ═════════════════════════════════════════════════════════════
// json.Unmarshal
// ═════════════════════════════════════════════════════════════

section("encoding/json — Unmarshal");

test("json.Unmarshal target must be non-nil pointer", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type User struct { Name string }
func main() {
	err1 := json.Unmarshal([]byte("{}"), nil)
	console.log(err1.Error())

	var u User
	err2 := json.Unmarshal([]byte("{}"), u)
	console.log(err2.Error())
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js);
	assertContains(out, "json: Unmarshal(nil)");
	assertContains(out, "json: Unmarshal(non-pointer");
});

test("json.Unmarshal into struct pointer with tag matching", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type User struct {
	ID    int    \`json:"user_id"\`
	Name  string \`json:"name"\`
	Extra string
}
func main() {
	data := []byte(\`{"user_id": 42, "name": "Charlie", "Extra": "untagged", "ignored": 999}\`)
	var u User
	err := json.Unmarshal(data, &u)
	console.log(err == nil)
	console.log(u.ID)
	console.log(u.Name)
	console.log(u.Extra)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\n42\nCharlie\nuntagged");
});

test("json.Unmarshal into RawMessage target", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Message struct {
	Type    string          \`json:"type"\`
	Payload json.RawMessage \`json:"payload"\`
}
func main() {
	data := []byte(\`{"type":"event","payload":{"action":"click","x":10}}\`)
	var m Message
	err := json.Unmarshal(data, &m)
	console.log(err == nil)
	console.log(m.Type)
	console.log(string(m.Payload))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), 'true\nevent\n{"action":"click","x":10}');
});

test("json.Unmarshal type mismatch error message matches Go shape", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Data struct {
	Count int \`json:"count"\`
}
func main() {
	data := []byte(\`{"count": "not a number"}\`)
	var d Data
	err := json.Unmarshal(data, &d)
	console.log(err != nil)
	console.log(err.Error())
}`);
	assertEqual(errors.length, 0);
	const out = runJs(js);
	assertContains(out, "true");
	assertContains(
		out,
		"json: cannot unmarshal string into Go struct field Data.count of type int",
	);
});

// ═════════════════════════════════════════════════════════════
// Code Review Regression Probes
// ═════════════════════════════════════════════════════════════

section("encoding/json — code review regression probes");

test("Probe 1: Zero dynamic eval() and CSP safe", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Base struct { ID int \`json:"id"\` }
type Ext struct { Base; Name string \`json:"name"\` }
func main() {
	e := Ext{Base: Base{ID: 1}, Name: "test"}
	b, _ := json.Marshal(e)
	var out Ext
	_ = json.Unmarshal(b, &out)
	console.log(out.ID, out.Name)
}`);
	assertEqual(errors.length, 0);
	assert(!js.includes("eval("), "generated JS must not contain eval()");
	assertEqual(runJs(js), "1 test");
});

test("Probe 2: int64 / uint64 safe arithmetic preservation", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Counter struct {
	Count int64 \`json:"count"\`
}
func main() {
	var u Counter
	_ = json.Unmarshal([]byte(\`{"count": 5}\`), &u)
	res := u.Count + 1
	console.log(res)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "6");
});

test("Probe 3: Pointer to Slices, Maps, and RawMessage unmarshaling without data loss", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	var items []string
	_ = json.Unmarshal([]byte(\`["a", "b"]\`), &items)
	console.log(len(items), items[0], items[1])

	var raw json.RawMessage
	_ = json.Unmarshal([]byte(\`{"a": 1}\`), &raw)
	console.log(string(raw))

	var m map[string]int
	_ = json.Unmarshal([]byte(\`{"x": 10, "y": 20}\`), &m)
	console.log(m["x"], m["y"])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '2 a b\n{"a": 1}\n10 20');
});

test("Probe 4: Struct pointer fields *Inner instantiated with field mappings", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Inner struct {
	Val int \`json:"val"\`
}
type Outer struct {
	In *Inner \`json:"in"\`
}
func main() {
	var o Outer
	_ = json.Unmarshal([]byte(\`{"in": {"val": 10}}\`), &o)
	console.log(o.In != nil, o.In.Val)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true 10");
});

test("Probe 5: any Maps round-trip without field stripping", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	var v any
	_ = json.Unmarshal([]byte(\`{"a": 1, "b": "hello"}\`), &v)
	b, _ := json.Marshal(v)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"a":1,"b":"hello"}');
});

test("Probe 6: Prototype key collisions (toString, constructor)", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type ProtoColl struct {
	ToString    string \`json:"toString"\`
	Constructor string \`json:"constructor"\`
}
func main() {
	var p1 ProtoColl
	err1 := json.Unmarshal([]byte("{}"), &p1)
	console.log(err1 == nil, p1.ToString)

	var p2 ProtoColl
	err2 := json.Unmarshal([]byte(\`{"toString": "custom_str", "constructor": "custom_ctor"}\`), &p2)
	console.log(err2 == nil, p2.ToString, p2.Constructor)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true \ntrue custom_str custom_ctor");
});

test("Probe 7: Diamond embedding collision elimination at depth 2", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Common struct {
	ID int \`json:"id"\`
}
type Left struct {
	Common
}
type Right struct {
	Common
}
type Top struct {
	Left
	Right
	Name string \`json:"name"\`
}
func main() {
	t := Top{Name: "top"}
	b, _ := json.Marshal(t)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"name":"top"}');
});

test("Probe 8: Irreversible precision loss prevention for 64-bit integer > 2^53-1", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type BigData struct {
	Num int64 \`json:"num"\`
}
func main() {
	var d BigData
	_ = json.Unmarshal([]byte(\`{"num": 9223372036854775807}\`), &d)
	b, _ := json.Marshal(d)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"num":9223372036854775807}');
});

test("Probe 9: Boxed json.RawMessage inside any is compacted like Go", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	var x any = json.RawMessage(\`{"key": 123}\`)
	b, _ := json.Marshal(x)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"key":123}');
});

test("Probe 10: Defined byte slices type MyBytes []byte unmarshal from base64", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type MyBytes []byte
type Payload struct {
	B MyBytes \`json:"b"\`
}
func main() {
	var p Payload
	_ = json.Unmarshal([]byte(\`{"b": "aGVsbG8="}\`), &p)
	console.log(string(p.B))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("[]byte decodes Go's base64 error instead of throwing on invalid input", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type Payload struct {
	B []byte \`json:"b"\`
}

func main() {
	var b []byte
	fmt.Println(json.Unmarshal([]byte("\\"!!\\""), &b))
	fmt.Println(json.Unmarshal([]byte("\\"aGVsbG8=\\""), &b), string(b))
	var p Payload
	fmt.Println(json.Unmarshal([]byte("{\\"b\\":\\"aGk\\"}"), &p))
	fmt.Println(json.Unmarshal([]byte("{\\"b\\":\\"aGk=\\"}"), &p), string(p.B))
	out, err := json.Marshal(Payload{B: []byte("hi?")})
	fmt.Println(string(out), err)
}
`,
		`illegal base64 data at input byte 0
<nil> hello
illegal base64 data at input byte 0
<nil> hi
{"b":"aGk/"} <nil>
`,
	);
});

test("[]byte in a js package reports Go's base64 error and round-trips", () => {
	const { js, errors } = compile(`package main
import (
	"encoding/json"
	"fmt"
)
func main() {
	var b []byte
	fmt.Println(json.Unmarshal([]byte("\\"!!\\""), &b))
	fmt.Println(json.Unmarshal([]byte("\\"aGVsbG8=\\""), &b), string(b))
	out, _ := json.Marshal(b)
	fmt.Println(string(out))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js).trim(),
		'illegal base64 data at input byte 0\n<nil> hello\n"aGVsbG8="',
	);
});

test("Probe 11: Defined string types type MyString string in []byte(s)", () => {
	const { js, errors } = compile(`package main
type MyString string
func main() {
	s := MyString("hello")
	b := []byte(s)
	console.log(string(b), len(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello 5");
});

test("Probe 12: Float NaN / Infinity returns unsupported value error", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	zero := 0.0
	nan := zero / zero
	_, err := json.Marshal(nan)
	console.log(err != nil, err.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true json: unsupported value: NaN");
});

test("Probe 13: Nil pointer-embedded struct Extended{Base: nil} omits promoted fields", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Base struct {
	ID int \`json:"id"\`
}
type Extended struct {
	*Base
	Title string \`json:"title"\`
}
func main() {
	e1 := Extended{Base: nil, Title: "Book"}
	b1, _ := json.Marshal(e1)
	console.log(string(b1))

	e2 := Extended{Base: &Base{ID: 42}, Title: "Book"}
	b2, _ := json.Marshal(e2)
	console.log(string(b2))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"title":"Book"}\n{"id":42,"title":"Book"}');
});

test("Probe 14: Numeric slices decode to typed arrays and []byte accepts number arrays", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Mesh struct {
	Verts []float32 \`json:"verts"\`
	Idx   []uint32  \`json:"idx"\`
	Bytes []byte    \`json:"bytes"\`
}
func main() {
	var m Mesh
	_ = json.Unmarshal([]byte(\`{"verts":[1.5, 2.5],"idx":[10, 20],"bytes":[65, 66, 67]}\`), &m)
	console.log(len(m.Verts), m.Verts[0], m.Verts[1])
	console.log(len(m.Idx), m.Idx[0], m.Idx[1])
	console.log(string(m.Bytes))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2 1.5 2.5\n2 10 20\nABC");
});

test("Probe: High-precision floating point numbers unmarshal cleanly without syntax error", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type FloatContainer struct {
	F1 float64 \`json:"f1"\`
	F2 float64 \`json:"f2"\`
	LargeInt int64 \`json:"large_int"\`
}
func main() {
	var c FloatContainer
	err := json.Unmarshal([]byte(\`{"f1": 9007199254740992.5, "f2": 0.12345678901234567, "large_int": 9007199254740993}\`), &c)
	console.log(err == nil, c.F1 > 9007199254740990.0, c.LargeInt)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true true 9007199254740993");
});

test("Probe: float32 fields, pointers, and slices decoded with Math.fround for exact equality", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type StructF32 struct {
	V float32 \`json:"v"\`
	P *float32 \`json:"p"\`
	S []float32 \`json:"s"\`
}
func main() {
	var s StructF32
	_ = json.Unmarshal([]byte(\`{"v": 0.3, "p": 0.3, "s": [0.3]}\`), &s)
	eqVal := s.V == float32(0.3)
	eqPtr := s.P != nil && *s.P == float32(0.3)
	eqSlice := len(s.S) == 1 && s.S[0] == float32(0.3)
	console.log(eqVal, eqPtr, eqSlice)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true true true");
});

test("Probe: Embedded pointer struct unmarshaling preserves prototype chain for method calls", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Base struct {
	X int \`json:"x"\`
}
func (b *Base) Double() int {
	return b.X * 2
}
type Outer struct {
	*Base
}
func main() {
	var o Outer
	err := json.Unmarshal([]byte(\`{"x": 10}\`), &o)
	console.log(err == nil, o.Base != nil, o.Base.Double(), o.Double())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true true 20 20");
});

test("Probe: Accurate target type in decoder error messages", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type UBox struct {
	Items []uint64 \`json:"items"\`
}
type FBox struct {
	Items []float32 \`json:"items"\`
}
func main() {
	var u UBox
	err1 := json.Unmarshal([]byte(\`{"items": ["not_num"]}\`), &u)
	var f FBox
	err2 := json.Unmarshal([]byte(\`{"items": ["not_float"]}\`), &f)
	console.log(err1.Error())
	console.log(err2.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		"json: cannot unmarshal string into Go struct field UBox.items of type uint64\njson: cannot unmarshal string into Go struct field FBox.items of type float32",
	);
});

test("json.Unmarshal preserves scalar values on null and nils reference fields", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Payload struct {
	Count int \`json:"count"\`
	Name string \`json:"name"\`
	Ptr *int \`json:"ptr"\`
	Items []int \`json:"items"\`
}
func main() {
	n := 9
	p := Payload{Count: 7, Name: "keep", Ptr: &n, Items: []int{1}}
	err := json.Unmarshal([]byte(\`{"count":null,"name":null,"ptr":null,"items":null}\`), &p)
	console.log(err == nil, p.Count, p.Name, p.Ptr == nil, p.Items == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true 7 keep true true");
});

test("json.Unmarshal matches tagged fields case-insensitively", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type User struct { Name string \`json:"displayName"\` }
func main() {
	var u User
	err := json.Unmarshal([]byte(\`{"DISPLAYNAME":"Ada"}\`), &u)
	console.log(err == nil, u.Name)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true Ada");
});

test("json.Unmarshal rejects fractional and out-of-range integers", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Payload struct { Count int8 \`json:"count"\` }
func main() {
	p := Payload{Count: 7}
	err1 := json.Unmarshal([]byte(\`{"count":300}\`), &p)
	err2 := json.Unmarshal([]byte(\`{"count":1.5}\`), &p)
	console.log(err1 != nil, err2 != nil, p.Count)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true true 7");
});

test("json.Unmarshal reports Go's number literal, JSON field path and element type", () => {
	// Expected output from Go (GOEXPERIMENT=nojsonv2, go1.26 semantics).
	const { js, errors } = compile(`package main
import (
	"encoding/json"
	"fmt"
)
type Inner struct {
	N int8 \`json:"n"\`
}
type Outer struct {
	U8  uint8   \`json:"u8"\`
	In  Inner   \`json:"in"\`
	L   []Inner \`json:"l"\`
	F32 float32 \`json:"f32"\`
	I   int     \`json:"i"\`
	P   *int    \`json:"p"\`
	S   string  \`json:"s"\`
}
func try(s string) {
	var o Outer
	fmt.Println(json.Unmarshal([]byte(s), &o))
}
func main() {
	try(\`{"u8":300}\`)
	try(\`{"u8":-1}\`)
	try(\`{"i":1.5}\`)
	try(\`{"i":1e2}\`)
	try(\`{"i":"x"}\`)
	try(\`{"in":{"n":200}}\`)
	try(\`{"l":[{"n":1},{"n":999}]}\`)
	try(\`{"f32":1e40}\`)
	try(\`{"p":2.5}\`)
	try(\`{"s":5}\`)
	var n int
	fmt.Println(json.Unmarshal([]byte(\`3.5\`), &n))
	var xs []uint8
	fmt.Println(json.Unmarshal([]byte(\`[1,256]\`), &xs))
	var m map[string]int16
	fmt.Println(json.Unmarshal([]byte(\`{"a":40000}\`), &m))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			"json: cannot unmarshal number 300 into Go struct field Outer.u8 of type uint8",
			"json: cannot unmarshal number -1 into Go struct field Outer.u8 of type uint8",
			"json: cannot unmarshal number 1.5 into Go struct field Outer.i of type int",
			"json: cannot unmarshal number 1e2 into Go struct field Outer.i of type int",
			"json: cannot unmarshal string into Go struct field Outer.i of type int",
			"json: cannot unmarshal number 200 into Go struct field Inner.in.n of type int8",
			"json: cannot unmarshal number 999 into Go struct field Inner.l.n of type int8",
			"json: cannot unmarshal number 1e40 into Go struct field Outer.f32 of type float32",
			"json: cannot unmarshal number 2.5 into Go struct field Outer.p of type int",
			"json: cannot unmarshal number into Go struct field Outer.s of type string",
			"json: cannot unmarshal number 3.5 into Go value of type int",
			"json: cannot unmarshal number 256 into Go value of type uint8",
			"json: cannot unmarshal number 40000 into Go value of type int16",
		].join("\n"),
	);
});

test("json.Unmarshal decodes large JSON numbers as float64 in float and any targets", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Payload struct { Number float64 \`json:"number"\` }
func main() {
	var p Payload
	var value any
	err1 := json.Unmarshal([]byte(\`{"number":9007199254740993}\`), &p)
	err2 := json.Unmarshal([]byte(\`9007199254740993\`), &value)
	console.log(err1 == nil, err2 == nil, p.Number == 9007199254740992.0, value == 9007199254740992.0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true true true true");
});

test("json.Unmarshal preserves exact RawMessage values in structs, slices, and maps", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Payload struct {
	Raw json.RawMessage \`json:"raw"\`
	Items []json.RawMessage \`json:"items"\`
	Values map[string]json.RawMessage \`json:"values"\`
}
func main() {
	var p Payload
	err := json.Unmarshal([]byte(\`{"raw": { "n" : 1.00 }, "items":[ { "a" : 2.00 } ], "values":{"x": [ 3.00 ]}}\`), &p)
	console.log(err == nil, string(p.Raw), string(p.Items[0]), string(p.Values["x"]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), 'true { "n" : 1.00 } { "a" : 2.00 } [ 3.00 ]');
});

test("json.Unmarshal of __proto__ map keys does not alter decoded map prototypes", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	var m map[string]any
	err := json.Unmarshal([]byte(\`{"__proto__":{"injected":"yes"}}\`), &m)
	console.log(err == nil, m["injected"] == nil, m["__proto__"] != nil)
	b, _ := json.Marshal(m)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), 'true true true\n{"__proto__":{"injected":"yes"}}');
});

test("json.Marshal formats float32 using Go shortest-round-trip formatting", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
type Values struct {
	Small float32 \`json:"small"\`
	Normal float32 \`json:"normal"\`
	Large float32 \`json:"large"\`
	Tiny float32 \`json:"tiny"\`
}
func main() {
	b, _ := json.Marshal(Values{Small: 0.00001, Normal: 1.23456789, Large: 1000000, Tiny: 0.0000001})
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		'{"small":0.00001,"normal":1.2345679,"large":1000000,"tiny":1e-7}',
	);
});

// ═════════════════════════════════════════════════════════════
// json.Marshaler / json.Unmarshaler / ,string
// Expected output captured from Go (GOEXPERIMENT=nojsonv2, i.e. go1.26 semantics).
// ═════════════════════════════════════════════════════════════

section("encoding/json — Marshaler, Unmarshaler and ,string");

// Struct tag literal for Go sources written with String.raw.
const tag = (s) => `\`${s}\``;

test("json.Marshal calls value-receiver MarshalJSON on named basic, slice and struct types", () => {
	const { js, errors } = compile(String.raw`package main
import (
	"encoding/json"
	"fmt"
	"strconv"
)
type Celsius float64
func (c Celsius) MarshalJSON() ([]byte, error) {
	return []byte("\"" + strconv.FormatFloat(float64(c), 'f', -1, 64) + "C\""), nil
}
type Temp struct {
	V Celsius  ${tag('json:"v"')}
	P *Celsius ${tag('json:"p"')}
}
type Tags []string
func (t Tags) MarshalJSON() ([]byte, error) { return []byte(strconv.Itoa(len(t))), nil }
type Inner struct{ A int }
func (Inner) MarshalJSON() ([]byte, error) { return []byte("\"inner\""), nil }
type Outer struct {
	Inner
	B int
}
func show(b []byte, err error) {
	if err != nil {
		fmt.Println("err:", err)
		return
	}
	fmt.Println(string(b))
}
func main() {
	p := Celsius(2.5)
	show(json.Marshal(Temp{V: 3, P: &p}))
	show(json.Marshal(Temp{}))
	show(json.Marshal(Tags{"a", "b"}))
	show(json.Marshal([]Celsius{1, 2}))
	show(json.Marshal(Outer{Inner{1}, 2}))
	var vals []any = []any{Celsius(7)}
	show(json.Marshal(vals))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			'{"v":"3C","p":"2.5C"}',
			'{"v":"0C","p":null}',
			"2",
			'["1C","2C"]',
			'"inner"',
			'["7C"]',
		].join("\n"),
	);
});

test("json.Marshal calls pointer-receiver MarshalJSON only on addressable values", () => {
	const { js, errors } = compile(String.raw`package main
import (
	"encoding/json"
	"fmt"
	"strconv"
)
type PtrM struct{ N int }
func (p *PtrM) MarshalJSON() ([]byte, error) {
	return []byte("\"ptr" + strconv.Itoa(p.N) + "\""), nil
}
type Holder struct {
	Val PtrM            ${tag('json:"val"')}
	Ptr *PtrM           ${tag('json:"ptr"')}
	S   []PtrM          ${tag('json:"s"')}
	M   map[string]PtrM ${tag('json:"m"')}
}
func main() {
	h := Holder{Val: PtrM{1}, Ptr: &PtrM{2}, S: []PtrM{{3}}, M: map[string]PtrM{"k": {4}}}
	b1, _ := json.Marshal(h)
	b2, _ := json.Marshal(&h)
	b3, _ := json.Marshal(PtrM{5})
	b4, _ := json.Marshal(&PtrM{6})
	var vals []any = []any{&PtrM{7}, PtrM{8}}
	b5, _ := json.Marshal(vals)
	fmt.Println(string(b1))
	fmt.Println(string(b2))
	fmt.Println(string(b3))
	fmt.Println(string(b4))
	fmt.Println(string(b5))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			'{"val":{"N":1},"ptr":"ptr2","s":["ptr3"],"m":{"k":{"N":4}}}',
			'{"val":"ptr1","ptr":"ptr2","s":["ptr3"],"m":{"k":{"N":4}}}',
			'{"N":5}',
			'"ptr6"',
			'["ptr7",{"N":8}]',
		].join("\n"),
	);
});

test("json.Marshal compacts and validates MarshalJSON output and wraps its errors", () => {
	const { js, errors } = compile(String.raw`package main
import (
	"encoding/json"
	"errors"
	"fmt"
)
type Spaced struct{}
func (Spaced) MarshalJSON() ([]byte, error) {
	return []byte("{ \"a\" : [1, 2],\n \"h\": \"<b>&\" }"), nil
}
type Bad struct{}
func (Bad) MarshalJSON() ([]byte, error) { return []byte("xyz"), nil }
type Fails struct{}
var errBoom = errors.New("boom")
func (Fails) MarshalJSON() ([]byte, error) { return nil, errBoom }
func main() {
	b, _ := json.Marshal(Spaced{})
	fmt.Println(string(b))
	_, err := json.Marshal(Bad{})
	fmt.Println(err)
	_, err = json.Marshal(Fails{})
	fmt.Println(err)
	b, _ = json.MarshalIndent(map[string]any{"s": Spaced{}}, "", "  ")
	fmt.Println(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			String.raw`{"a":[1,2],"h":"\u003cb\u003e\u0026"}`,
			"json: error calling MarshalJSON for type main.Bad: invalid character 'x' looking for beginning of value",
			"json: error calling MarshalJSON for type main.Fails: boom",
			"{",
			'  "s": {',
			'    "a": [',
			"      1,",
			"      2",
			"    ],",
			String.raw`    "h": "\u003cb\u003e\u0026"`,
			"  }",
			"}",
		].join("\n"),
	);
});

test("json.Unmarshal calls UnmarshalJSON with the raw value bytes", () => {
	const { js, errors } = compile(String.raw`package main
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
	U  Up            ${tag('json:"u"')}
	UP *Up           ${tag('json:"up"')}
	L  []Up          ${tag('json:"l"')}
	M  map[string]Up ${tag('json:"m"')}
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
func main() {
	var d Doc
	err := json.Unmarshal([]byte("{\"u\":\"ab\",\"up\":\"cd\",\"l\":[\"ef\",{\"x\":1}],\"m\":{\"k\":[1, 2]}}"), &d)
	fmt.Println(err, d.U.S, d.UP.S, d.L[0].S, d.L[1].S, d.M["k"].S)
	var d2 Doc
	d2.UP = &Up{S: "keep"}
	err = json.Unmarshal([]byte("{\"u\":null,\"up\":null}"), &d2)
	fmt.Println(err, d2.U.S, d2.UP == nil)
	var top Up
	err = json.Unmarshal([]byte(" \"top\" "), &top)
	fmt.Println(err, top.S)
	var st Strict
	err = json.Unmarshal([]byte("0"), &st)
	fmt.Println(errors.Is(err, errStrict), err)
	var sts []Strict
	err = json.Unmarshal([]byte("[12, 0]"), &sts)
	fmt.Println(errors.Is(err, errStrict), err)
	var w Wrap
	err = json.Unmarshal([]byte("{\"Z\": 3}"), &w)
	fmt.Println(err, w.Raw, w.Z)
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			'<nil> "AB" "CD" "EF" {"X":1} [1, 2]',
			"<nil> NULL true",
			'<nil> "TOP"',
			"true strict says no",
			"true strict says no",
			'<nil> {"Z": 3} 0',
		].join("\n"),
	);
});

test("json MarshalJSON/UnmarshalJSON pointer methods on a named non-struct type", () => {
	const { js, errors } = compile(String.raw`package main
import (
	"encoding/json"
	"errors"
	"fmt"
)
type Level int
var errLevel = errors.New("bad level")
func (l *Level) UnmarshalJSON(b []byte) error {
	switch string(b) {
	case "\"low\"":
		*l = 1
	case "\"high\"":
		*l = 2
	case "null":
		*l = -1
	default:
		return errLevel
	}
	return nil
}
func (l *Level) MarshalJSON() ([]byte, error) {
	if *l == 2 {
		return []byte("\"high\""), nil
	}
	return []byte("\"low\""), nil
}
type Cfg struct {
	L  Level            ${tag('json:"l"')}
	P  *Level           ${tag('json:"p"')}
	LS []Level          ${tag('json:"ls"')}
	M  map[string]Level ${tag('json:"m"')}
	N  Level            ${tag('json:"n"')}
}
func main() {
	var c Cfg
	err := json.Unmarshal([]byte("{\"l\":\"high\",\"p\":\"low\",\"ls\":[\"low\",\"high\"],\"m\":{\"k\":\"high\"},\"n\":null}"), &c)
	fmt.Println(err, int(c.L), int(*c.P), int(c.LS[0]), int(c.LS[1]), int(c.M["k"]), int(c.N))
	var top Level
	err = json.Unmarshal([]byte("\"high\""), &top)
	fmt.Println(err, int(top))
	err = json.Unmarshal([]byte("\"mid\""), &top)
	fmt.Println(errors.Is(err, errLevel), int(top))
	b, _ := json.Marshal(&c)
	fmt.Println(string(b))
	b, _ = json.Marshal(c)
	fmt.Println(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			"<nil> 2 1 1 2 2 -1",
			"<nil> 2",
			"true 2",
			'{"l":"high","p":"low","ls":["low","high"],"m":{"k":2},"n":"low"}',
			'{"l":2,"p":"low","ls":["low","high"],"m":{"k":2},"n":-1}',
		].join("\n"),
	);
});

test("json ,string tag option quotes and unquotes scalar fields", () => {
	const { js, errors } = compile(String.raw`package main
import (
	"encoding/json"
	"fmt"
)
type Level int
func (l Level) String() string { return "lvl" }
type Quoted struct {
	I  int     ${tag('json:"i,string"')}
	B  bool    ${tag('json:"b,string"')}
	F  float64 ${tag('json:"f,string"')}
	S  string  ${tag('json:"s,string"')}
	P  *int    ${tag('json:"p,string"')}
	PN *int    ${tag('json:"pn,string"')}
	L  Level   ${tag('json:"l,string"')}
	Bg int64   ${tag('json:"bg,string"')}
}
type QI struct {
	I int ${tag('json:"i,string"')}
}
type QB struct {
	B bool ${tag('json:"b,string"')}
}
func main() {
	n := 9
	b, _ := json.Marshal(Quoted{I: 5, B: true, F: 1.5, S: "a<b", P: &n, L: Level(4), Bg: 4503599627370497})
	fmt.Println(string(b))
	var q Quoted
	err := json.Unmarshal([]byte("{\"i\":\"42\",\"b\":\"true\",\"f\":\"2.25\",\"s\":\"\\\"hi\\\"\",\"p\":\"7\",\"pn\":\"null\",\"l\":\"6\",\"bg\":\"-12\"}"), &q)
	fmt.Println(err, q.I, q.B, q.F, q.S, *q.P, q.PN == nil, int(q.L), q.Bg)
	var qi QI
	fmt.Println(json.Unmarshal([]byte("{\"i\":42}"), &qi))
	fmt.Println(json.Unmarshal([]byte("{\"i\":\"abc\"}"), &qi))
	fmt.Println(json.Unmarshal([]byte("{\"i\":\"30x\"}"), &qi))
	fmt.Println(json.Unmarshal([]byte("{\"i\":null}"), &qi), qi.I)
	var qb QB
	fmt.Println(json.Unmarshal([]byte("{\"b\":\"yes\"}"), &qb))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			String.raw`{"i":"5","b":"true","f":"1.5","s":"\"a\\u003cb\"","p":"9","pn":null,"l":"4","bg":"4503599627370497"}`,
			"<nil> 42 true 2.25 hi 7 true 6 -12",
			"json: invalid use of ,string struct tag, trying to unmarshal unquoted value into int",
			'json: invalid use of ,string struct tag, trying to unmarshal "abc" into int',
			"json: cannot unmarshal number 30x into Go struct field QI.i of type int",
			"<nil> 0",
			'json: invalid use of ,string struct tag, trying to unmarshal "yes" into bool',
		].join("\n"),
	);
});

test("json.Marshal encodes pointer-to-scalar fields and wrapper-class named types", () => {
	const { js, errors } = compile(String.raw`package main
import (
	"encoding/json"
	"fmt"
)
type Level int
func (l Level) String() string { return "lvl" }
type Names []string
func (n Names) Count() int { return len(n) }
type PtrFields struct {
	A *int    ${tag('json:"a"')}
	S *string ${tag('json:"s,omitempty"')}
	E *string ${tag('json:"e,omitempty"')}
}
type Opt struct {
	L  Level   ${tag('json:"l"')}
	LS []Level ${tag('json:"ls"')}
	N  Names   ${tag('json:"n"')}
	NN Names   ${tag('json:"nn"')}
	E  Level   ${tag('json:"e,omitempty"')}
}
func main() {
	x := 5
	s := "hi"
	b, _ := json.Marshal(PtrFields{A: &x, S: &s})
	fmt.Println(string(b))
	var pf PtrFields
	err := json.Unmarshal([]byte("{\"a\":9,\"s\":\"yo\"}"), &pf)
	b, _ = json.Marshal(pf)
	fmt.Println(err, string(b))
	a := 1
	c := 2
	b, _ = json.Marshal([]*int{&a, nil, &c})
	fmt.Println(string(b))
	b, _ = json.Marshal(map[string]*int{"x": &a, "y": nil})
	fmt.Println(string(b))
	b, _ = json.Marshal(Opt{L: Level(3), LS: []Level{1, 2}, N: Names{"a"}})
	fmt.Println(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		[
			'{"a":5,"s":"hi"}',
			'<nil> {"a":9,"s":"yo"}',
			"[1,null,2]",
			'{"x":1,"y":null}',
			'{"l":3,"ls":[1,2],"n":["a"],"nn":null}',
		].join("\n"),
	);
});

// ═════════════════════════════════════════════════════════════
// WASM Diagnostic (Task 1.5)
// ═════════════════════════════════════════════════════════════

section("encoding/json — wasm enablement");

test("json.MarshalIndent accepted in wasm target", () => {
	const res = compile(`//gofront:target wasm
package main
import "encoding/json"
func main() {
	_, _ = json.MarshalIndent(42, "", "  ")
}`);
	assertEqual(res.errors.length, 0);
});

test("json.MarshalIndent accepted in both target", () => {
	const res = compile(`//gofront:target both
package main
import "encoding/json"
func main() {
	_, _ = json.MarshalIndent(42, "", "  ")
}`);
	assertEqual(res.errors.length, 0);
});

// ── Real-Go conformance (expected output captured from go run) ──

test("real Go output: json/decode on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type Address struct {
	Street string \`json:"street"\`
	City   string \`json:"city"\`
}

type Person struct {
	Name   string         \`json:"name"\`
	Age    int            \`json:"age"\`
	Score  float64        \`json:"score"\`
	Active bool           \`json:"active"\`
	Tags   []string       \`json:"tags"\`
	Addr   Address        \`json:"addr"\`
	Home   *Address       \`json:"home"\`
	Attrs  map[string]int \`json:"attrs"\`
	Extra  any            \`json:"extra"\`
	Count  int8           \`json:"count"\`
}

type Base struct {
	ID int \`json:"id"\`
}

type Extended struct {
	Base
	Title string \`json:"title"\`
}

type Point struct{ X, Y int }

func report(label string, err error) {
	if err != nil {
		fmt.Println(label, "error:", err)
	} else {
		fmt.Println(label, "ok")
	}
}

func main() {
	var p Person
	err := json.Unmarshal([]byte(\`{"name":"Ann","AGE":31,"Score":1.5,"active":true,"tags":["a","b"],"addr":{"street":"S","city":"C"},"home":{"street":"H"},"attrs":{"x":1,"y":2},"extra":[1,"two",{"k":null}],"unknown":5}\`), &p)
	report("person", err)
	fmt.Println(p.Name, p.Age, p.Score, p.Active, p.Tags, p.Addr, *p.Home, p.Attrs["x"], p.Attrs["y"])
	extra := p.Extra.([]any)
	fmt.Println(len(extra), extra[0].(float64), extra[1].(string), extra[2].(map[string]any)["k"] == nil)

	var n int
	report("int", json.Unmarshal([]byte("42"), &n))
	fmt.Println(n)
	report("int from string", json.Unmarshal([]byte(\`"x"\`), &n))
	report("int fraction", json.Unmarshal([]byte("1.5"), &n))
	var i8 int8
	report("int8 range", json.Unmarshal([]byte("200"), &i8))
	var u8 uint8
	report("uint8 negative", json.Unmarshal([]byte("-1"), &u8))

	var q Person
	report("field type", json.Unmarshal([]byte(\`{"name":5}\`), &q))
	report("nested field type", json.Unmarshal([]byte(\`{"addr":{"street":1}}\`), &q))
	report("count range", json.Unmarshal([]byte(\`{"count":300}\`), &q))

	var keep Person
	keep.Name = "keep"
	keep.Age = 9
	keep.Tags = []string{"old"}
	keep.Home = &Address{Street: "S"}
	keep.Attrs = map[string]int{"k": 1}
	keep.Extra = 5
	report("null", json.Unmarshal([]byte(\`{"name":null,"age":null,"tags":null,"home":null,"attrs":null,"extra":null}\`), &keep))
	fmt.Println(keep.Name, keep.Age, keep.Tags == nil, keep.Home == nil, keep.Attrs == nil, keep.Extra == nil)

	var xs []int
	report("slice", json.Unmarshal([]byte("[1,2,3]"), &xs))
	fmt.Println(xs, len(xs))
	report("empty slice", json.Unmarshal([]byte("[]"), &xs))
	fmt.Println(xs == nil, len(xs))
	var m map[string]int
	report("map", json.Unmarshal([]byte(\`{"b":2,"a":1}\`), &m))
	fmt.Println(m["a"], m["b"])
	var mi map[int]string
	report("int keys", json.Unmarshal([]byte(\`{"10":"ten","2":"two"}\`), &mi))
	fmt.Println(mi[10], mi[2])
	var pts []*Point
	report("pointers", json.Unmarshal([]byte(\`[{"X":1},null,{"Y":2}]\`), &pts))
	fmt.Println(len(pts), *pts[0], pts[1] == nil, *pts[2])

	var e Extended
	report("embedded", json.Unmarshal([]byte(\`{"id":42,"title":"Book"}\`), &e))
	fmt.Println(e.ID, e.Title)

	var v any
	report("any", json.Unmarshal([]byte(\`{"a":[1,2.5,"x",true,null],"b":{"c":"d"}}\`), &v))
	obj := v.(map[string]any)
	list := obj["a"].([]any)
	fmt.Println(len(list), list[0].(float64), list[1].(float64), list[2], list[3], list[4] == nil, obj["b"].(map[string]any)["c"])
	report("any number", json.Unmarshal([]byte("12345.5"), &v))
	fmt.Println(v.(float64))

	var bs []byte
	report("bytes", json.Unmarshal([]byte(\`"aGVsbG8="\`), &bs))
	fmt.Println(string(bs))

	var f32 float32
	report("float32", json.Unmarshal([]byte("0.1"), &f32))
	fmt.Println(f32 > 0.09 && f32 < 0.11)

	var str string
	report("string escapes", json.Unmarshal([]byte(\`"a\\n\\t\\"b\\\\ A"\`), &str))
	fmt.Println(str)
}
`,
		`person ok
Ann 31 1.5 true [a b] {S C} {H } 1 2
3 1 two true
int ok
42
int from string error: json: cannot unmarshal string into Go value of type int
int fraction error: json: cannot unmarshal number 1.5 into Go value of type int
int8 range error: json: cannot unmarshal number 200 into Go value of type int8
uint8 negative error: json: cannot unmarshal number -1 into Go value of type uint8
field type error: json: cannot unmarshal number into Go struct field Person.name of type string
nested field type error: json: cannot unmarshal number into Go struct field Address.addr.street of type string
count range error: json: cannot unmarshal number 300 into Go struct field Person.count of type int8
null ok
keep 9 true true true true
slice ok
[1 2 3] 3
empty slice ok
false 0
map ok
1 2
int keys ok
ten two
pointers ok
3 {1 0} true {0 2}
embedded ok
42 Book
any ok
5 1 2.5 x true true d
any number ok
12345.5
bytes ok
hello
float32 ok
true
string escapes ok
a
	"b\\ A
`,
	);
});

test("real Go output: json/encode on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"errors"
	"fmt"
	"math"

	"encoding/json"
)

type Address struct {
	Street string \`json:"street"\`
	City   string \`json:"city,omitempty"\`
}

type Person struct {
	Name     string            \`json:"name"\`
	Age      int               \`json:"age"\`
	Email    string            \`json:"email,omitempty"\`
	Addr     Address           \`json:"addr"\`
	Home     *Address          \`json:"home"\`
	Tags     []string          \`json:"tags"\`
	Attrs    map[string]string \`json:"attrs"\`
	Score    float64           \`json:"score"\`
	Active   bool              \`json:"active"\`
	Skip     string            \`json:"-"\`
	Dash     string            \`json:"-,"\`
	hidden   int
	NoTag    int
	Renamed  int \`json:"r_name"\`
	Quoted   int \`json:"quoted,string"\`
	QuotedS  string \`json:"qs,string"\`
	QuotedB  bool   \`json:"qb,string"\`
	QuotedF  float64 \`json:"qf,string"\`
}

type Base struct {
	ID   int    \`json:"id"\`
	Kind string \`json:"kind"\`
}

type Derived struct {
	Extra string \`json:"extra"\`
	Base
}

type PtrEmbed struct {
	*Base
	Z int
}

type Level struct {
	Name  string
	Child *Level
}

type Celsius float64

type Color int

func (c Color) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf("\\"color-%d\\"", int(c))), nil
}

type Temp struct{ V int }

func (t *Temp) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf("{\\"temp\\": %d}", t.V)), nil
}

type Bad struct{}

func (Bad) MarshalJSON() ([]byte, error) { return nil, errors.New("boom") }

type Wrapper struct {
	C  Color
	T  Temp
	PT *Temp
}

type Shape interface{ Area() float64 }

type Sq struct{ S float64 }

func (s Sq) Area() float64 { return s.S * s.S }

type Holder struct {
	V any
	S Shape
}

func show(v any, b []byte, err error) {
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Println(string(b))
}

func main() {
	b, err := json.Marshal(42)
	show(nil, b, err)
	b, err = json.Marshal(3.14)
	show(nil, b, err)
	b, err = json.Marshal("hello <b>&\\"q\\"\\n\\t\\\\")
	show(nil, b, err)
	b, err = json.Marshal(true)
	show(nil, b, err)
	b, err = json.Marshal(nil)
	show(nil, b, err)
	b, err = json.Marshal(int64(9007199254740991))
	show(nil, b, err)
	b, err = json.Marshal(uint8(255))
	show(nil, b, err)
	b, err = json.Marshal(float32(0.1))
	show(nil, b, err)
	b, err = json.Marshal(1e21)
	show(nil, b, err)
	b, err = json.Marshal(1e-7)
	show(nil, b, err)
	b, err = json.Marshal(100.0)
	show(nil, b, err)
	b, err = json.Marshal(math.NaN())
	show(nil, b, err)

	var sNil []int
	b, err = json.Marshal(sNil)
	show(nil, b, err)
	b, err = json.Marshal([]int{})
	show(nil, b, err)
	b, err = json.Marshal([]int{1, 2, 3})
	show(nil, b, err)
	b, err = json.Marshal([3]string{"a", "b", "c"})
	show(nil, b, err)
	b, err = json.Marshal([]byte("hello"))
	show(nil, b, err)
	var bNil []byte
	b, err = json.Marshal(bNil)
	show(nil, b, err)

	b, err = json.Marshal(map[string]int{})
	show(nil, b, err)
	b, err = json.Marshal(map[string]int{"z": 3, "a": 1, "m": 2})
	show(nil, b, err)
	b, err = json.Marshal(map[int]string{10: "ten", 2: "two", -1: "neg"})
	show(nil, b, err)
	b, err = json.Marshal(map[string][]int{"x": {1}, "y": nil})
	show(nil, b, err)

	p := Person{
		Name: "Ann <A&B>", Age: 30, Addr: Address{Street: "Main"},
		Tags: []string{"a", "b"}, Attrs: map[string]string{}, Score: 1.5, Active: true,
		Skip: "skipped", Dash: "dashed", hidden: 9, NoTag: 7, Renamed: 8,
		Quoted: 12, QuotedS: "hi", QuotedB: true, QuotedF: 2.5,
	}
	b, err = json.Marshal(p)
	show(nil, b, err)
	b, err = json.Marshal(&p)
	show(nil, b, err)
	p.Home = &Address{Street: "Elm", City: "Paris"}
	p.Attrs = map[string]string{"k": "v"}
	p.Email = "a@b.c"
	b, err = json.Marshal(p)
	show(nil, b, err)
	b, err = json.Marshal([]Person{})
	show(nil, b, err)

	b, err = json.Marshal(Derived{Extra: "x", Base: Base{ID: 1}})
	show(nil, b, err)

	b, err = json.Marshal(Level{Name: "a", Child: &Level{Name: "b", Child: &Level{Name: "c"}}})
	show(nil, b, err)

	b, err = json.Marshal(Celsius(36.6))
	show(nil, b, err)
	b, err = json.Marshal([]Celsius{1, 2.5})
	show(nil, b, err)

	b, err = json.Marshal(Color(3))
	show(nil, b, err)
	b, err = json.Marshal(Wrapper{C: 1, T: Temp{2}, PT: &Temp{3}})
	show(nil, b, err)
	w := Wrapper{C: 1, T: Temp{2}}
	b, err = json.Marshal(&w)
	show(nil, b, err)
	b, err = json.Marshal(Bad{})
	show(nil, b, err)
	b, err = json.Marshal([]Bad{{}})
	show(nil, b, err)

	var np *Address
	b, err = json.Marshal(np)
	show(nil, b, err)
	n7 := 7
	b, err = json.Marshal(&n7)
	show(nil, b, err)
	b, err = json.Marshal([]*int{&n7, nil})
	show(nil, b, err)

	b, err = json.Marshal(map[string]any{"n": 1, "s": "x", "l": []any{1, "two", nil}, "m": map[string]any{"k": true}, "f": 2.5})
	show(nil, b, err)
	b, err = json.Marshal(Holder{V: 12, S: Sq{2}})
	show(nil, b, err)
	b, err = json.Marshal(Holder{})
	show(nil, b, err)
	var anyV any = []string{"a", "b"}
	b, err = json.Marshal(anyV)
	show(nil, b, err)

	fmt.Println(json.Valid([]byte(\`{"a":[1,2,{"b":null}]}\`)), json.Valid([]byte(\`{"a":\`)), json.Valid([]byte(\` 1 \`)), json.Valid([]byte(\`01\`)))
}
`,
		`42
3.14
"hello \\u003cb\\u003e\\u0026\\"q\\"\\n\\t\\\\"
true
null
9007199254740991
255
0.1
1e+21
1e-7
100
error: json: unsupported value: NaN
null
[]
[1,2,3]
["a","b","c"]
"aGVsbG8="
null
{}
{"a":1,"m":2,"z":3}
{"-1":"neg","10":"ten","2":"two"}
{"x":[1],"y":null}
{"name":"Ann \\u003cA\\u0026B\\u003e","age":30,"addr":{"street":"Main"},"home":null,"tags":["a","b"],"attrs":{},"score":1.5,"active":true,"-":"dashed","NoTag":7,"r_name":8,"quoted":"12","qs":"\\"hi\\"","qb":"true","qf":"2.5"}
{"name":"Ann \\u003cA\\u0026B\\u003e","age":30,"addr":{"street":"Main"},"home":null,"tags":["a","b"],"attrs":{},"score":1.5,"active":true,"-":"dashed","NoTag":7,"r_name":8,"quoted":"12","qs":"\\"hi\\"","qb":"true","qf":"2.5"}
{"name":"Ann \\u003cA\\u0026B\\u003e","age":30,"email":"a@b.c","addr":{"street":"Main"},"home":{"street":"Elm","city":"Paris"},"tags":["a","b"],"attrs":{"k":"v"},"score":1.5,"active":true,"-":"dashed","NoTag":7,"r_name":8,"quoted":"12","qs":"\\"hi\\"","qb":"true","qf":"2.5"}
[]
{"extra":"x","id":1,"kind":""}
{"Name":"a","Child":{"Name":"b","Child":{"Name":"c","Child":null}}}
36.6
[1,2.5]
"color-3"
{"C":"color-1","T":{"V":2},"PT":{"temp":3}}
{"C":"color-1","T":{"temp":2},"PT":null}
error: json: error calling MarshalJSON for type main.Bad: boom
error: json: error calling MarshalJSON for type main.Bad: boom
null
7
[7,null]
{"f":2.5,"l":[1,"two",null],"m":{"k":true},"n":1,"s":"x"}
{"V":12,"S":{"S":2}}
{"V":null,"S":null}
["a","b"]
true false true false
`,
	);
});

test("real Go output: json/stream on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
)

type Item struct {
	ID   int    \`json:"id"\`
	Name string \`json:"name"\`
}

type StrictItem struct {
	ID int \`json:"id"\`
}

type FailItem struct{}

func (FailItem) MarshalJSON() ([]byte, error) {
	return nil, errors.New("cannot marshal item")
}

func main() {
	// --- 1. Encoder basic & multiple values ---
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	err := enc.Encode(Item{ID: 1, Name: "apple"})
	fmt.Printf("Encode 1 err=%v: %s", err, buf.String())

	err = enc.Encode(Item{ID: 2, Name: "banana"})
	fmt.Printf("Encode 2 err=%v: %s", err, buf.String())

	// --- 2. Encoder SetIndent ---
	buf.Reset()
	enc = json.NewEncoder(&buf)
	enc.SetIndent(">>", "  ")
	err = enc.Encode(Item{ID: 3, Name: "cherry"})
	fmt.Printf("Encode indented err=%v:\\n%s", err, buf.String())

	// --- 3. Encoder SetEscapeHTML ---
	buf.Reset()
	enc = json.NewEncoder(&buf)
	enc.SetEscapeHTML(true)
	err = enc.Encode("<b>test & ' \\"</b>")
	fmt.Printf("Encode escapeHTML true: %s", buf.String())

	buf.Reset()
	enc = json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	err = enc.Encode("<b>test & ' \\"</b>")
	fmt.Printf("Encode escapeHTML false: %s", buf.String())

	// --- 4. Decoder basic & multiple values ---
	input := \`{"id":10,"name":"ten"} {"id":20,"name":"twenty"}\`
	dec := json.NewDecoder(strings.NewReader(input))

	for dec.More() {
		var it Item
		offsetBefore := dec.InputOffset()
		err := dec.Decode(&it)
		fmt.Printf("Decode item: id=%d name=%s err=%v offsetBefore=%d offsetAfter=%d\\n",
			it.ID, it.Name, err, offsetBefore, dec.InputOffset())
	}

	// Next decode at EOF
	var it Item
	err = dec.Decode(&it)
	fmt.Printf("Decode at EOF: err=%v (isEOF=%v)\\n", err, err == io.EOF)

	// --- 5. Decoder ErrUnexpectedEOF on truncated stream ---
	truncDec := json.NewDecoder(strings.NewReader(\`{"id": 100\`))
	err = truncDec.Decode(&it)
	fmt.Printf("Decode truncated: err=%v (isUnexpectedEOF=%v)\\n", err, err == io.ErrUnexpectedEOF)

	// --- 6. Decoder UseNumber ---
	numInput := \`{"val": 1234567890123456789}\`
	numDec := json.NewDecoder(strings.NewReader(numInput))
	numDec.UseNumber()
	var anyMap map[string]any
	err = numDec.Decode(&anyMap)
	val := anyMap["val"]
	_, isNum := val.(json.Number)
	fmt.Printf("Decode UseNumber: val=%v isNumber=%v err=%v\\n", val, isNum, err)

	// --- 7. Decoder DisallowUnknownFields ---
	unknownInput := \`{"id": 42, "unknown": "extra"}\`
	strictDec := json.NewDecoder(strings.NewReader(unknownInput))
	strictDec.DisallowUnknownFields()
	var sItem StrictItem
	err = strictDec.Decode(&sItem)
	fmt.Printf("Decode DisallowUnknownFields: err=%v\\n", err)

	// --- 8. Decoder Buffered ---
	bufInput := \`{"id": 1} trailing data\`
	bufDec := json.NewDecoder(strings.NewReader(bufInput))
	var itBuf Item
	err = bufDec.Decode(&itBuf)
	rest, _ := io.ReadAll(bufDec.Buffered())
	fmt.Printf("Decode Buffered: id=%d rest=%q\\n", itBuf.ID, string(rest))

	// --- 9. Encoder error handling ---
	buf.Reset()
	enc = json.NewEncoder(&buf)
	err = enc.Encode(math.NaN())
	var valErr *json.UnsupportedValueError
	if errors.As(err, &valErr) {
		fmt.Printf("Encode UnsupportedValueError NaN: Str=%s msg=%s\\n", valErr.Str, valErr.Error())
	} else {
		fmt.Printf("Encode NaN unexpected: err=%v\\n", err)
	}

	err = enc.Encode(FailItem{})
	var marshErr *json.MarshalerError
	if errors.As(err, &marshErr) {
		fmt.Printf("Encode MarshalerError: msg=%s unwrap=%v\\n", marshErr.Error(), errors.Unwrap(marshErr))
	} else {
		fmt.Printf("Encode FailItem unexpected: err=%v\\n", err)
	}
}
`,
		`Encode 1 err=<nil>: {"id":1,"name":"apple"}
Encode 2 err=<nil>: {"id":1,"name":"apple"}
{"id":2,"name":"banana"}
Encode indented err=<nil>:
{
>>  "id": 3,
>>  "name": "cherry"
>>}
Encode escapeHTML true: "\\u003cb\\u003etest \\u0026 ' \\"\\u003c/b\\u003e"
Encode escapeHTML false: "<b>test & ' \\"</b>"
Decode item: id=10 name=ten err=<nil> offsetBefore=0 offsetAfter=22
Decode item: id=20 name=twenty err=<nil> offsetBefore=23 offsetAfter=48
Decode at EOF: err=EOF (isEOF=true)
Decode truncated: err=unexpected EOF (isUnexpectedEOF=true)
Decode UseNumber: val=1234567890123456789 isNumber=true err=<nil>
Decode DisallowUnknownFields: err=json: unknown field "unknown"
Decode Buffered: id=1 rest=" trailing data"
Encode UnsupportedValueError NaN: Str=NaN msg=json: unsupported value: NaN
Encode MarshalerError: msg=json: error calling MarshalJSON for type main.FailItem: cannot marshal item unwrap=cannot marshal item
`,
	);
});

test("json.Decoder reads a multi-value stream from a one-byte reader", async () => {
	await assertProgramOutput(
		`package main

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

func main() {
	dec := json.NewDecoder(oneByte{strings.NewReader(\`{"A":1,"B":"x"} {"A":2,"B":"y"}  {"B":"end"}\`)})
	for dec.More() {
		var it Item
		err := dec.Decode(&it)
		fmt.Println(it.A, it.B, err, dec.InputOffset())
	}
	var v Item
	fmt.Println(dec.Decode(&v) == io.EOF)
}
`,
		`1 x <nil> 15
2 y <nil> 31
0 end <nil> 44
true
`,
	);
});

// ── JS parity: Marshal and Unmarshal forms (expected output is real Go's) ──

section("encoding/json — Marshal parity with Go");

test("real Go output: json/marshal parity on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
	"math"
)

type P struct {
	M map[string]int
}

type Q struct {
	M map[string]int \`json:",omitempty"\`
}

type Addr struct {
	Street string \`json:"street"\`
	Zip    int    \`json:"zip,omitempty"\`
}

type In struct{ Z int }

type Emb struct {
	In
	Y int \`json:"y,omitempty"\`
}

type W struct {
	A float64
	B []float32
	C [2]float32
	D json.RawMessage
}

func show(name string, v any) {
	b, err := json.Marshal(v)
	fmt.Println(name, string(b), err)
}

func emit(name string, f func() ([]byte, error)) {
	b, err := f()
	fmt.Println(name, string(b), err)
}

func main() {
	var nilMap map[string]int
	show("nil map", nilMap)
	show("nil map field", P{})
	show("empty map field", P{M: map[string]int{}})
	show("omitempty nil map", Q{})
	show("omitempty empty map", Q{M: map[string]int{}})
	show("omitempty map", Q{M: map[string]int{"a": 1}})
	show("struct in any", map[string]any{"p": Addr{"S", 0}})
	show("struct ptr in any", []any{&Addr{"T", 2}})
	show("embedded in any", Emb{In{1}, 2})
	emit("+Inf", func() ([]byte, error) { return json.Marshal(math.Inf(1)) })
	emit("-Inf", func() ([]byte, error) { return json.Marshal(math.Inf(-1)) })
	emit("NaN", func() ([]byte, error) { return json.Marshal(math.NaN()) })
	emit("float32 +Inf", func() ([]byte, error) { return json.Marshal(float32(math.Inf(1))) })
	emit("raw", func() ([]byte, error) { return json.Marshal(json.RawMessage("[1, 2]")) })
	show("raw in struct", W{D: json.RawMessage(\`{ "a" : [1, 2] }\`)})
	var rawNil json.RawMessage
	emit("raw nil", func() ([]byte, error) { return json.Marshal(rawNil) })
	emit("raw invalid", func() ([]byte, error) { return json.Marshal(json.RawMessage(\`{"a":\`)) })
	show("float arrays", W{B: []float32{0.1, 2}, C: [2]float32{0.1, 0.2}})
	show("array", [3]int{1, 2, 3})
}
`,
		`nil map null <nil>
nil map field {"M":null} <nil>
empty map field {"M":{}} <nil>
omitempty nil map {} <nil>
omitempty empty map {} <nil>
omitempty map {"M":{"a":1}} <nil>
struct in any {"p":{"street":"S"}} <nil>
struct ptr in any [{"street":"T","zip":2}] <nil>
embedded in any {"Z":1,"y":2} <nil>
+Inf  json: unsupported value: +Inf
-Inf  json: unsupported value: -Inf
NaN  json: unsupported value: NaN
float32 +Inf  json: unsupported value: +Inf
raw [1,2] <nil>
raw in struct {"A":0,"B":null,"C":[0,0],"D":{"a":[1,2]}} <nil>
raw nil null <nil>
raw invalid  json: error calling MarshalJSON for type json.RawMessage: unexpected end of JSON input
float arrays {"A":0,"B":[0.1,2],"C":[0.1,0.2],"D":null} <nil>
array [1,2,3] <nil>
`,
	);
});

test("float64 negative zero encodes as -0", () => {
	const { js, errors } = compile(`package main
import ("encoding/json"; "math")
type W struct { A float64; B *float64 }
func main() {
	z := math.Copysign(0, -1)
	b, _ := json.Marshal(W{z, &z})
	c, _ := json.Marshal([]float64{z, 1})
	d, _ := json.Marshal(map[string]float64{"a": z})
	console.log(string(b), string(c), string(d))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"A":-0,"B":-0} [-0,1] {"a":-0}');
});

test('[]byte("null") is the bytes of the string, not nil', () => {
	const { js, errors } = compile(`package main
import ("encoding/json"; "fmt")
func main() {
	var x int
	fmt.Println(json.Valid([]byte("null")), json.Unmarshal([]byte("null"), &x), len([]byte("null")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true <nil> 4");
});

section("encoding/json — Unmarshal parity with Go");

test("real Go output: json/unmarshal parity on JS and WASM", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type Item struct{ A int }

type S struct {
	Arr  [3]int
	F    [2]float32
	Grid [][2]int
	Nest [][]int
	M    map[string][]int
}

func main() {
	var m map[string]int
	fmt.Println(json.Unmarshal([]byte(\`{"a":1,"b":2}\`), &m), len(m), m)
	var ma map[string]any
	fmt.Println(json.Unmarshal([]byte(\`{"a":1}\`), &ma), len(ma), ma)
	var arr [3]int
	fmt.Println(json.Unmarshal([]byte(\`[1,2]\`), &arr), arr)
	fmt.Println(json.Unmarshal([]byte(\`[7,8,9,10]\`), &arr), arr)
	fmt.Println(json.Unmarshal([]byte(\`null\`), &arr), arr)
	fmt.Println(json.Unmarshal([]byte(\`"x"\`), &arr), arr)
	var ip *Item
	fmt.Println(json.Unmarshal([]byte(\`{}\`), ip))
	var sl []int
	fmt.Println(json.Unmarshal([]byte(\`[1]\`), sl))
	fmt.Println(json.Unmarshal([]byte(\`{\`), sl))
	fmt.Println(json.Unmarshal([]byte(\`{}\`), nil))
	fmt.Println(json.Unmarshal([]byte(\`{}\`), Item{}))
	var s S
	err := json.Unmarshal([]byte(\`{"Arr":[1],"F":[1.5,2.5,3],"Grid":[[1,2],[3]],"Nest":[[1],[2,3]],"M":{"a":[1,2]}}\`), &s)
	fmt.Println(err, s.Arr, s.F, s.Grid, s.Nest, len(s.M["a"]))
	var nested map[string]map[string]int
	fmt.Println(json.Unmarshal([]byte(\`{"a":{"b":1},"c":{}}\`), &nested), len(nested), len(nested["c"]), nested["a"]["b"])
	var null1 any
	fmt.Println(json.Unmarshal([]byte(\`null\`), &null1), null1 == nil)
}
`,
		`<nil> 2 map[a:1 b:2]
<nil> 1 map[a:1]
<nil> [1 2 0]
<nil> [7 8 9]
<nil> [7 8 9]
json: cannot unmarshal string into Go value of type [3]int [7 8 9]
json: Unmarshal(nil *main.Item)
json: Unmarshal(non-pointer []int)
unexpected end of JSON input
json: Unmarshal(nil)
json: Unmarshal(non-pointer main.Item)
<nil> [1 0 0] [1.5 2.5] [[1 2] [3 0]] [[1] [2 3]] 2
<nil> 2 0 1
<nil> true
`,
	);
});

test("decoded maps have no marker key in JS", () => {
	const { js, errors } = compile(
		`package main
import ("encoding/json"; "fmt")
func main() {
	var m map[string]any
	fmt.Println(json.Unmarshal([]byte(` +
			"`" +
			`{"a":{"b":1}}` +
			"`" +
			`), &m), len(m), m)
	for k := range m { fmt.Println(k) }
}`,
	);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "<nil> 1 map[a:map[b:1]]\na");
});

section("encoding/json — review feedback regressions");

test("Unmarshal into a pointer held in a type-parameter value (js)", async () => {
	await assertJsProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Item struct{ A int }
type Box[T any] struct{ P T }
type Any interface{}
type Cfg struct{ N int }

func Load[P any](b []byte, p P) error { return json.Unmarshal(b, p) }
func LoadBox[T any](b []byte, bx Box[T]) error { return json.Unmarshal(b, bx.P) }
func LoadNamed(b []byte, p Any) error { return json.Unmarshal(b, p) }
func Dec[P any](s string, p P) error { return json.NewDecoder(strings.NewReader(s)).Decode(p) }

func main() {
	it := &Item{}
	fmt.Println(Load([]byte(\`{"A":3}\`), it), it.A)
	bx := Box[*Item]{&Item{}}
	fmt.Println(LoadBox([]byte(\`{"A":4}\`), bx), bx.P.A)
	i2 := &Item{}
	fmt.Println(LoadNamed([]byte(\`{"A":5}\`), i2), i2.A)
	i3 := &Item{}
	fmt.Println(Dec(\`{"A":6}\`, i3), i3.A)
	fmt.Println(json.Unmarshal([]byte(\`[1]\`), []int{1}))
}
`,
		`<nil> 3
<nil> 4
<nil> 5
<nil> 6
json: Unmarshal(non-pointer []int)
`,
	);
});

test("function-local structs with tags marshal in js, methods, closures and generics", () => {
	const { js, errors } = compile(`package main

import (
	"encoding/json"
	"fmt"
)

type Top struct{ Q int \`json:"qq"\` }
type W[T any] struct{ V T }

func (w W[T]) M() {
	type InM struct{ Z int \`json:"zm"\` }
	b, _ := json.Marshal(InM{4})
	fmt.Println(string(b))
	b, _ = json.Marshal(any(InM{5}))
	fmt.Println(string(b))
}

func gen[T any](x T) {
	type InG struct{ Z int \`json:"zg"\`; O int \`json:",omitempty"\` }
	b, _ := json.Marshal(InG{6, 0})
	fmt.Println(string(b))
	var a any = InG{7, 1}
	b, _ = json.Marshal(a)
	fmt.Println(string(b))
}

func f() {
	type Dup struct{ X int }
	b, _ := json.Marshal(Dup{1})
	fmt.Println(string(b))
}

func main() {
	type Local struct{ Z int \`json:"zz"\` }
	b, _ := json.Marshal(Local{1})
	fmt.Println(string(b))
	var a any = Local{2}
	b, _ = json.Marshal(a)
	fmt.Println(string(b))
	b, _ = json.Marshal([]any{Local{3}, Top{4}})
	fmt.Println(string(b))
	func() {
		type InC struct{ Z int \`json:"zc"\` }
		var a any = InC{8}
		b, _ := json.Marshal(a)
		fmt.Println(string(b))
	}()
	W[int]{}.M()
	gen(1)
	f()
	b, _ = json.Marshal(any(Top{9}))
	fmt.Println(string(b))
}
`);
	assertEqual(errors.length, 0);
	assertEqual(
		runJs(js),
		`{"zz":1}
{"zz":2}
[{"zz":3},{"qq":4}]
{"zc":8}
{"zm":4}
{"zm":5}
{"zg":6}
{"zg":7,"O":1}
{"X":1}
{"qq":9}
`.trimEnd(),
	);
});

test("function-local structs with tags marshal in both and wasm", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type Top struct{ Q int \`json:"qq"\` }
func f() {
	type Dup struct{ X int }
	b, _ := json.Marshal(Dup{1})
	fmt.Println(string(b))
}

func main() {
	type Local struct{ Z int \`json:"zz"\` }
	b, _ := json.Marshal(Local{1})
	fmt.Println(string(b))
	var a any = Local{2}
	b, _ = json.Marshal(a)
	fmt.Println(string(b))
	b, _ = json.Marshal([]any{Local{3}, Top{4}})
	fmt.Println(string(b))
	func() {
		type InC struct{ Z int \`json:"zc"\` }
		var a any = InC{8}
		b, _ := json.Marshal(a)
		fmt.Println(string(b))
	}()
	f()
	b, _ = json.Marshal(any(Top{9}))
	fmt.Println(string(b))
}
`,
		`{"zz":1}
{"zz":2}
[{"zz":3},{"qq":4}]
{"zc":8}
{"X":1}
{"qq":9}
`,
	);
});

test("string literals next to function-local structs are emitted unchanged", async () => {
	await assertProgramOutput(
		`package main

import "fmt"

func main() {
	type Local struct{ Z int }
	l := Local{1}
	fmt.Println(l, "/*__gf_json_hook_0__*/")
}
`,
		"{1} /*__gf_json_hook_0__*/\n",
	);
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	type Local struct{ Z int \`json:"zz"\` }
	l := Local{1}
	fmt.Println(l, "/*__gf_json_hook_0__*/")
	b, _ := json.Marshal(any(Local{3}))
	fmt.Println(string(b))
}
`,
		'{1} /*__gf_json_hook_0__*/\n{"zz":3}\n',
	);
});

test("a package variable initialised by a function with a local struct marshals", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

var x = helper()

func helper() string {
	type Local struct {
		A int \`json:"a"\`
	}
	b, _ := json.Marshal(Local{A: 42})
	return string(b)
}

func main() { fmt.Println(x) }
`,
		'{"a":42}\n',
	);
});

test("same-named local structs in different functions marshal", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

func f1() {
	type Config struct {
		A int \`json:"a"\`
	}
	b, _ := json.Marshal(Config{A: 1})
	fmt.Println(string(b))
}

func f2() {
	type Config struct {
		A int \`json:"a"\`
	}
	b, _ := json.Marshal(Config{A: 2})
	fmt.Println(string(b))
}

func main() { f1(); f2() }
`,
		'{"a":1}\n{"a":2}\n',
	);
});

test("function-local structs add no lines to programs that do not marshal", () => {
	const { js, errors } = compile(`package main

import "fmt"

func main() {
	type Local struct{ Z int }
	fmt.Println(Local{1})
}
`);
	assertEqual(errors.length, 0);
	const lines = js.split("\n");
	const at = lines.findIndex((l) =>
		l.includes('Object.defineProperty(Local.prototype, "value"'),
	);
	assert(at >= 0, "local struct class emitted");
	assert(
		/^ {2}gff_main_Println_\d+\(new Local\(1\)\);$/.test(lines[at + 1]),
		"the statement after the local struct follows directly",
	);
	assert(!js.includes("__json_enc"), "no json hook without encoding/json");
});

test("a json.Encoder in main reaches local structs declared in earlier functions", async () => {
	await assertProgramOutput(
		`package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

func mk() any {
	type Early struct{ Z int \`json:"ze"\` }
	return Early{5}
}

func main() {
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(mk())
	fmt.Println(strings.TrimSpace(buf.String()))
}
`,
		'{"ze":5}\n',
	);
});

test("Encoder.SetEscapeHTML(false) keeps RawMessage and Marshaler output unescaped", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type M struct{}

func (M) MarshalJSON() ([]byte, error) { return []byte(\`"<m>&"\`), nil }

func main() {
	e := json.NewEncoder(os.Stdout)
	e.SetEscapeHTML(false)
	e.Encode(json.RawMessage(\`"<a>"\`))
	e.Encode(M{})
	e.Encode("<s>")
	e.Encode(map[string]any{"k": json.RawMessage(\`"<b>"\`), "m": M{}})
	e2 := json.NewEncoder(os.Stdout)
	e2.Encode(json.RawMessage(\`"<a>"\`))
	e2.Encode(M{})
	b, _ := json.Marshal(json.RawMessage(\`"<a>"\`))
	fmt.Println(string(b))
}
`,
		`"<a>"
"<m>&"
"<s>"
{"k":"<b>","m":"<m>&"}
"\\u003ca\\u003e"
"\\u003cm\\u003e\\u0026"
"\\u003ca\\u003e"
`,
	);
});

test("negative zero: -0.0 constant is 0, computed -0 is kept in any", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
	"math"
)

type S struct{ F float64 }

func main() {
	z := 0.0
	z = -z
	b, _ := json.Marshal(any(z))
	fmt.Println(string(b))
	b, _ = json.Marshal(S{-0.0})
	fmt.Println(string(b))
	fmt.Println(-0.0, math.Copysign(0, -1), 1/math.Inf(-1))
	x := -0.0
	fmt.Println(x, -0, S{-0.0})
	const c = -0.0
	fmt.Println(c)
}
`,
		`-0
{"F":0}
0 -0 -0
0 0 {0}
0
`,
	);
});

test("Unmarshal into a pointer to a pointer works in a js package", () => {
	const { js, errors } = compile(`package main

import (
	"encoding/json"
	"fmt"
)

type T struct{ A int }

func main() {
	var p *T
	err := json.Unmarshal([]byte(\`{"A":3}\`), &p)
	fmt.Println(p.A, err)
	var n *int
	err = json.Unmarshal([]byte("7"), &n)
	fmt.Println(*n, err)
}
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3 <nil>\n7 <nil>");
});

section("encoding/json — host fast paths");

// The encoder's buffer writes and the decoder's string, number and validity
// reads have JS natives; with natives off they run their Go bodies.  Both
// must print what real Go printed, on the JS and WASM backends.
test("JSON strings, numbers, floats and errors agree with Go with natives on and off", async () => {
	await assertFourWay(
		'package main\n\nimport (\n\t"encoding/json"\n\t"fmt"\n\t"math"\n\t"strings"\n)\n\ntype Rec struct {\n\tS   string            `json:"s"`\n\tI   int64             `json:"i"`\n\tU   uint64            `json:"u"`\n\tF   float64           `json:"f"`\n\tG   float32           `json:"g"`\n\tB   bool              `json:"b"`\n\tL   []string          `json:"l"`\n\tM   map[string]float64 `json:"m"`\n\tSub *Rec              `json:"sub,omitempty"`\n}\n\nfunc main() {\n\tstrs := []string{"plain", "a\\"b\\\\c", "<tag>&amp;", "line\\nbreak\\ttab\\r\\b\\f", "\\x01\\x1f", "caf\u00e9 \u4e16\u754c", "emoji \\U0001F600", "sep\u2028\u2029", ""}\n\tfor _, s := range strs {\n\t\tb, err := json.Marshal(s)\n\t\tfmt.Println(string(b), err)\n\t\tvar back string\n\t\terr = json.Unmarshal(b, &back)\n\t\tfmt.Println(back == s, err)\n\t}\n\tnums := []float64{0, 1, -1, 0.1, 0.5, 1.5e-7, 1e-6, 123456789012345680000, 1e21, 1.7976931348623157e308, 5e-324, math.Copysign(0, -1), 100, 12345.6789}\n\tfor _, f := range nums {\n\t\tb, err := json.Marshal(f)\n\t\tfmt.Println(string(b), err)\n\t}\n\tfor _, f := range []float32{0.1, 1.0 / 3, 3.4e38, 1e-8, 16777216, 0.3} {\n\t\tb, _ := json.Marshal(f)\n\t\tfmt.Println(string(b))\n\t}\n\tb, _ := json.Marshal([]any{int64(math.MinInt64), uint64(math.MaxUint64), int8(-5), uint16(7), 2.5})\n\tfmt.Println(string(b))\n\tr := Rec{S: "x<y", I: math.MaxInt64, U: math.MaxUint64, F: 1e21, G: 0.1, B: true, L: []string{"a", "b\\n"}, M: map[string]float64{"k": 2.5, "a": 1e-7}, Sub: &Rec{S: "inner"}}\n\tb, _ = json.Marshal(r)\n\tfmt.Println(string(b))\n\tvar r2 Rec\n\terr := json.Unmarshal(b, &r2)\n\tfmt.Println(err, r2.S, r2.I, r2.U, r2.F, r2.G, r2.B, r2.L, r2.M, r2.Sub.S)\n\tvar r3 Rec\n\terr = json.Unmarshal([]byte(` { "s" : "\u00e9\ud83d\ude00\\n\\/" , "i" : -9223372036854775808 , "f" : 1E2 , "l" : [ ] } `), &r3)\n\tfmt.Printf("%v %q %d %v %v\\n", err, r3.S, r3.I, r3.F, r3.L == nil)\n\tbad := []string{``, `{`, `{"s":}`, `[1,]`, `{"s":"a" "b"}`, `{"a":1}x`, `tru`, `"\\x"`, `{"i":1.5}`, `{"i":99999999999999999999}`, `{"s":1}`, `{"g":1e40}`}\n\tfor _, s := range bad {\n\t\tvar x Rec\n\t\terr := json.Unmarshal([]byte(s), &x)\n\t\tfmt.Println(err, json.Valid([]byte(s)))\n\t}\n\tdeep := strings.Repeat("[", 10001) + strings.Repeat("]", 10001)\n\tvar d any\n\tfmt.Println(json.Unmarshal([]byte(deep), &d), json.Valid([]byte(deep)))\n\tok := strings.Repeat("[", 10000) + strings.Repeat("]", 10000)\n\tfmt.Println(json.Valid([]byte(ok)))\n\te := json.NewEncoder(&strings.Builder{})\n\te.SetEscapeHTML(false)\n\tvar sb strings.Builder\n\te = json.NewEncoder(&sb)\n\te.SetEscapeHTML(false)\n\te.Encode("<&>")\n\te.Encode(map[string]string{"<k>": "\u2028"})\n\tfmt.Print(sb.String())\n}\n',
		'"plain" <nil>\ntrue <nil>\n"a\\"b\\\\c" <nil>\ntrue <nil>\n"\\u003ctag\\u003e\\u0026amp;" <nil>\ntrue <nil>\n"line\\nbreak\\ttab\\r\\b\\f" <nil>\ntrue <nil>\n"\\u0001\\u001f" <nil>\ntrue <nil>\n"caf\u00e9 \u4e16\u754c" <nil>\ntrue <nil>\n"emoji \ud83d\ude00" <nil>\ntrue <nil>\n"sep\\u2028\\u2029" <nil>\ntrue <nil>\n"" <nil>\ntrue <nil>\n0 <nil>\n1 <nil>\n-1 <nil>\n0.1 <nil>\n0.5 <nil>\n1.5e-7 <nil>\n0.000001 <nil>\n123456789012345680000 <nil>\n1e+21 <nil>\n1.7976931348623157e+308 <nil>\n5e-324 <nil>\n-0 <nil>\n100 <nil>\n12345.6789 <nil>\n0.1\n0.33333334\n3.4e+38\n1e-8\n16777216\n0.3\n[-9223372036854775808,18446744073709551615,-5,7,2.5]\n{"s":"x\\u003cy","i":9223372036854775807,"u":18446744073709551615,"f":1e+21,"g":0.1,"b":true,"l":["a","b\\n"],"m":{"a":1e-7,"k":2.5},"sub":{"s":"inner","i":0,"u":0,"f":0,"g":0,"b":false,"l":null,"m":null}}\n<nil> x<y 9223372036854775807 18446744073709551615 1e+21 0.1 true [a b\n] map[a:1e-07 k:2.5] inner\n<nil> "\u00e9\ud83d\ude00\\n/" -9223372036854775808 100 false\nunexpected end of JSON input false\nunexpected end of JSON input false\ninvalid character \'}\' looking for beginning of value false\ninvalid character \']\' looking for beginning of value false\ninvalid character \'"\' after object key:value pair false\ninvalid character \'x\' after top-level value false\ninvalid character \' \' in literal true (expecting \'e\') false\ninvalid character \'x\' in string escape code false\njson: cannot unmarshal number 1.5 into Go struct field Rec.i of type int64 true\njson: cannot unmarshal number 99999999999999999999 into Go struct field Rec.i of type int64 true\njson: cannot unmarshal number into Go struct field Rec.s of type string true\njson: cannot unmarshal number 1e40 into Go struct field Rec.g of type float32 true\ninvalid character \'[\' exceeded max depth false\ntrue\n"<&>"\n{"<k>":"\\u2028"}\n',
	);
});

// ═════════════════════════════════════════════════════════════
// JS-interop (.d.ts) types in structs
// ═════════════════════════════════════════════════════════════

section("encoding/json — JS-interop struct fields");

const GPU_DTS =
	"declare interface GPUBuffer { label: string; destroy(): void; }\n";

// Compiles `main.go` next to a `go.d.ts` declaring GPUBuffer; returns the run
// output, or the compile error message.
function runWithGpu(body, globals = {}) {
	return withTempDir(
		{
			"go.d.ts": `${GPU_DTS}declare function makeBuf(): GPUBuffer;\n`,
			"main.go": `package main
import "encoding/json"
import "js:go.d.ts"
${body}`,
		},
		(dir) => {
			try {
				return { out: runJs(compileDir(dir).js, globals), error: "" };
			} catch (e) {
				return { out: "", error: e.message };
			}
		},
	);
}

test("dynamic json.Marshal site with an interop-field struct compiles", () => {
	const { out, error } = runWithGpu(`
type Holder struct {
	Name string
	Buf  GPUBuffer
}
type Plain struct{ A int }
func main() {
	var v any = Plain{7}
	b, err := json.Marshal(v)
	console.log(string(b), err == nil)
	_ = Holder{}
}`);
	assertEqual(error, "");
	assertEqual(out, '{"A":7} true');
});

test("typed json.Marshal writes a nil interop field as null", () => {
	const { out, error } = runWithGpu(`
type Holder struct {
	Name string
	Buf  GPUBuffer
}
func main() {
	b, err := json.Marshal(Holder{Name: "x"})
	console.log(string(b), err == nil)
}`);
	assertEqual(error, "");
	assertEqual(out, '{"Name":"x","Buf":null} true');
});

test("typed json.Marshal rejects a non-nil interop field by name", () => {
	const { out, error } = runWithGpu(
		`
type Holder struct {
	Name string
	Buf  GPUBuffer
}
func main() {
	_, err := json.Marshal(Holder{Name: "x", Buf: makeBuf()})
	console.log(err.Error())
}`,
		{ makeBuf: () => ({ label: "b" }) },
	);
	assertEqual(error, "");
	assertEqual(out, "json: unsupported type: GPUBuffer");
});

test("interop pointer, slice and map fields compile and encode nil as null", () => {
	const { out, error } = runWithGpu(`
type Holder struct {
	P *GPUBuffer
	S []GPUBuffer
	M map[string]GPUBuffer
	N int \`json:"n,omitempty"\`
}
func main() {
	b, err := json.Marshal(Holder{})
	console.log(string(b), err == nil)
}`);
	assertEqual(error, "");
	assertEqual(out, '{"P":null,"S":null,"M":null} true');
});

test("json.Unmarshal into a struct with an interop field is a compile error", () => {
	const { error } = runWithGpu(`
type Holder struct {
	Name string
	Buf  GPUBuffer
}
func main() {
	var h Holder
	err := json.Unmarshal([]byte("{}"), &h)
	console.log(err == nil)
}`);
	assertContains(error, "cannot unmarshal into GPUBuffer");
});

test("json.Unmarshal into a map keyed by an interop type is a compile error", () => {
	const { error } = runWithGpu(`
type Holder struct {
	M map[GPUBuffer]int
}
func main() {
	var h Holder
	err := json.Unmarshal([]byte("{}"), &h)
	console.log(err == nil)
}`);
	assertContains(error, "cannot unmarshal into GPUBuffer");
});

test("json.Marshal of a map keyed by an interop type names the key type", () => {
	const { out, error } = runWithGpu(
		`
type Holder struct {
	M map[GPUBuffer]int
}
func main() {
	b, err := json.Marshal(Holder{})
	console.log(string(b), err == nil)
	_, err = json.Marshal(Holder{M: map[GPUBuffer]int{makeBuf(): 1}})
	console.log(err.Error())
}`,
		{ makeBuf: () => ({ label: "b" }) },
	);
	assertEqual(error, "");
	assertEqual(out, '{"M":null} true\njson: unsupported type: GPUBuffer');
});

// ── Entry point ───────────────────────────────────────────────
test("json.Marshal and Unmarshal with int64 Math.MaxInt64 (Task 1.3)", async () => {
	const src = `package main

import (
	"encoding/json"
	"fmt"
	"math"
)

type S struct {
	N int64
}

func main() {
	b, _ := json.Marshal(S{N: math.MaxInt64})
	fmt.Println(string(b))

	var out S
	_ = json.Unmarshal(b, &out)
	fmt.Println(out.N == math.MaxInt64)
}
`;
	await assertProgramOutput(src, '{"N":9223372036854775807}\ntrue\n');
});

section("encoding/json — decoding on the JS backend");

test("Unmarshal keeps decoding after a type error and reports the first (js)", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type R struct {
	F  float64
	B  bool
	Sl []int
}

func main() {
	var r R
	err := json.Unmarshal([]byte(\`{"F":"x","B":true,"Sl":[1,"y"]}\`), &r)
	fmt.Println(err, r.B, r.Sl)
}
`,
		`json: cannot unmarshal string into Go struct field R.F of type float64 true [1 0]
`,
	);
});

test("Unmarshal rejects map keys that do not fit the key type (js)", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	var m map[int]string
	err := json.Unmarshal([]byte(\`{"x":"a"}\`), &m)
	fmt.Println(err, len(m))
	var ok map[int]string
	fmt.Println(json.Unmarshal([]byte(\`{"7":"a"}\`), &ok), ok)
}
`,
		`json: cannot unmarshal number x into Go value of type int 0
<nil> map[7:a]
`,
	);
});

test("Unmarshal into an existing map adds to it (js)", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type H struct{ M map[string]int }

func main() {
	m := map[string]int{"keep": 1}
	fmt.Println(json.Unmarshal([]byte(\`{"a":1}\`), &m), m)
	h := H{M: map[string]int{"keep": 2}}
	fmt.Println(json.Unmarshal([]byte(\`{"M":{"b":3}}\`), &h), h.M)
}
`,
		`<nil> map[a:1 keep:1]
<nil> map[b:3 keep:2]
`,
	);
});

test("Unmarshal into RawMessage trims surrounding whitespace (js)", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	var rm json.RawMessage
	fmt.Println(json.Unmarshal([]byte(" 1 "), &rm))
	fmt.Printf("%q\\n", string(rm))
}
`,
		`<nil>
"1"
`,
	);
});

section("encoding/json — values in interfaces (js)");

test("values in an interface encode from their static type (js)", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

func show(v any) {
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
}

func main() {
	show([3]byte{1, 2, 3})
	n := 5
	show(&n)
	show(float32(0.1))
	show(json.Number("12"))
	rm := json.RawMessage("[1]")
	show(&rm)
	show([][2]byte{{1, 2}})
	show(map[string]*int{"a": &n})
	show(map[string]any{"k": [2]byte{3, 4}, "f": float32(0.3), "n": json.Number("7")})
	show([]any{&n, float32(2.5), [1]byte{9}})
}
`,
		`[1,2,3] <nil>
5 <nil>
0.1 <nil>
12 <nil>
[1] <nil>
[[1,2]] <nil>
{"a":5} <nil>
{"f":0.3,"k":[3,4],"n":7} <nil>
[5,2.5,[9]] <nil>
`,
	);
});

test("MarshalText encodes values, fields and elements (every target)", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type T string

func (t T) MarshalText() ([]byte, error) { return []byte("t-" + string(t)), nil }

type P struct{ N int }

func (p *P) MarshalText() ([]byte, error) { return []byte(fmt.Sprint("p", p.N)), nil }

type Rec struct {
	A T
	B []T
	C P
	D *P
}

func main() {
	var v any = T("x")
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
	b, err = json.Marshal(T("y"))
	fmt.Println(string(b), err)
	b, err = json.Marshal(Rec{"a", []T{"b", "c"}, P{1}, &P{2}})
	fmt.Println(string(b), err)
	b, err = json.Marshal(&Rec{"a", nil, P{1}, nil})
	fmt.Println(string(b), err)
	b, err = json.Marshal(map[string]T{"k": "v"})
	fmt.Println(string(b), err)
}
`,
		`"t-x" <nil>
"t-y" <nil>
{"A":"t-a","B":["t-b","t-c"],"C":{"N":1},"D":"p2"} <nil>
{"A":"t-a","B":null,"C":"p1","D":null} <nil>
{"k":"t-v"} <nil>
`,
	);
});

test("func, chan, complex and unsupported map keys report an unsupported type (js)", async () => {
	await assertJsTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type Holder struct {
	Name string
	F    func()
}

func show(v any) {
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
}

func main() {
	show(func() {})
	fs := []func(){nil}
	show(fs)
	empty := []func(){}
	show(empty)
	var nilFns []func()
	show(nilFns)
	show(map[bool]int{true: 1})
	fm := map[string]func(){"a": nil}
	show(fm)
	show(Holder{Name: "h"})
	show(&Holder{Name: "h"})
	show(struct{ M map[bool]int }{})
	show(func(a int, b ...string) (int, error) { return 0, nil })
	b, err := json.Marshal(func() {})
	fmt.Println(string(b), err)
	var c complex128 = complex(1, 2)
	b, err = json.Marshal(c)
	fmt.Println(string(b), err)
	show(c)
	b, err = json.MarshalIndent(map[int8]bool{3: true}, "", " ")
	fmt.Println(string(b), err)
}
`,
		` json: unsupported type: func()
 json: unsupported type: func()
[] <nil>
null <nil>
 json: unsupported type: map[bool]int
 json: unsupported type: func()
 json: unsupported type: func()
 json: unsupported type: func()
 json: unsupported type: map[bool]int
 json: unsupported type: func(int, ...string) (int, error)
 json: unsupported type: func()
 json: unsupported type: complex128
 json: unsupported type: complex128
{
 "3": true
} <nil>
`,
	);
});

section("encoding/json — anonymous struct types");

test("anonymous struct types encode, decode and report errors like Go", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type T struct {
	Nest struct{ X int }
}

type Outer struct {
	In   struct{ A, B int }
	List []struct{ N string }
	M    map[string]struct{ V float64 }
}

func main() {
	var t T
	fmt.Println(json.Unmarshal([]byte(\`{"Nest":{"X":"s"}}\`), &t))
	b, _ := json.Marshal(struct {
		A int \`json:"a"\`
	}{1})
	fmt.Println(string(b))
	var t2 struct{ Nest struct{ X int } }
	fmt.Println(json.Unmarshal([]byte(\`{"Nest":{"X":3}}\`), &t2), t2)
	var t3 struct{ Nest struct{ X int } }
	fmt.Println(json.Unmarshal([]byte(\`{"Nest":{"X":"q"}}\`), &t3), t3)
	var v any = struct {
		A int \`json:"a"\`
		B []struct{ Z bool }
	}{2, []struct{ Z bool }{{true}}}
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
	x1, _ := json.Marshal(struct{ A *int }{})
	x2, _ := json.Marshal(struct{ S int }{1})
	fmt.Println(string(x1), string(x2))
	var o Outer
	err = json.Unmarshal([]byte(\`{"In":{"A":1,"B":2},"List":[{"N":"a"},{"N":"b"}],"M":{"k":{"V":1.5}}}\`), &o)
	fmt.Println(err, o)
	b, _ = json.Marshal(o)
	fmt.Println(string(b))
	var s []struct{ K int }
	fmt.Println(json.Unmarshal([]byte(\`[{"K":1},{"K":"x"}]\`), &s), s)
}
`,
		`json: cannot unmarshal string into Go struct field .Nest.X of type int
{"a":1}
<nil> {{3}}
json: cannot unmarshal string into Go struct field .Nest.X of type int {{0}}
{"a":2,"B":[{"Z":true}]} <nil>
{"A":null} {"S":1}
<nil> {{1 2} [{a} {b}] map[k:{1.5}]}
{"In":{"A":1,"B":2},"List":[{"N":"a"},{"N":"b"}],"M":{"k":{"V":1.5}}}
json: cannot unmarshal string into Go struct field .K of type int [{1} {0}]
`,
	);
});

test("a field of a pointer to an anonymous struct keeps its type", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func g(q *struct{ X int }) { q.X = 5 }

func f(p *struct{ Nest struct{ X int } }) { g(&p.Nest) }

func main() {
	var t struct{ Nest struct{ X int } }
	f(&t)
	fmt.Println(t)
}
`,
		`{{5}}
`,
	);
});

section("encoding/json — error messages");

test("invalid Number literal and Unmarshal argument errors match Go on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Item struct{ A int }

func viaParam(b []byte, v any) error { return json.Unmarshal(b, v) }

func main() {
	var n json.Number
	fmt.Println(json.Unmarshal([]byte(\`"x"\`), &n))
	var rs struct{ N json.Number }
	fmt.Println(json.Unmarshal([]byte(\`{"N":"x"}\`), &rs))
	fmt.Println(json.Unmarshal([]byte(\`1\`), any(5)))
	fmt.Println(json.Unmarshal([]byte(\`1\`), any("s")))
	fmt.Println(json.Unmarshal([]byte(\`1\`), any(2.5)))
	var ip *Item
	fmt.Println(json.Unmarshal([]byte(\`{}\`), any(ip)))
	fmt.Println(json.Unmarshal([]byte(\`{}\`), ip))
	fmt.Println(viaParam([]byte(\`{}\`), ip))
	fmt.Println(viaParam([]byte(\`1\`), 7))
	fmt.Println(viaParam([]byte(\`1\`), "s"))
	fmt.Println(viaParam([]byte(\`1\`), []int{1}))
	fmt.Println(viaParam([]byte(\`1\`), nil))
	fmt.Println(json.NewDecoder(strings.NewReader(\`1\`)).Decode(any(5)))
	fmt.Println(json.NewDecoder(strings.NewReader(\`{}\`)).Decode(any(ip)))
}
`,
		`json: invalid number literal, trying to unmarshal "\\"x\\"" into Number
json: invalid number literal, trying to unmarshal "\\"x\\"" into Number
json: Unmarshal(non-pointer int)
json: Unmarshal(non-pointer string)
json: Unmarshal(non-pointer float64)
json: Unmarshal(nil *main.Item)
json: Unmarshal(nil *main.Item)
json: Unmarshal(nil *main.Item)
json: Unmarshal(non-pointer int)
json: Unmarshal(non-pointer string)
json: Unmarshal(non-pointer []int)
json: Unmarshal(nil)
json: Unmarshal(non-pointer int)
json: Unmarshal(nil *main.Item)
`,
	);
});

section("encoding/json — generics and nested pointers");

test("generic struct instances and generic decode targets encode and decode on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Box[T any] struct {
	V T
	L []T
}

func Dec[P any](p P) error {
	return json.NewDecoder(strings.NewReader("1")).Decode(p)
}

func Enc[T any](v T) string {
	b, err := json.Marshal(v)
	return fmt.Sprint(string(b), err)
}

func Load[T any](s string) (T, error) {
	var v T
	err := json.Unmarshal([]byte(s), &v)
	return v, err
}

func main() {
	b, err := json.Marshal(Box[int]{2, []int{1}})
	fmt.Println(string(b), err)
	var x int
	fmt.Println(Dec(&x), x)
	fmt.Println(Enc(3), Enc("s"), Enc([]bool{true}))
	n, e1 := Load[int]("5")
	bx, e2 := Load[Box[string]](\`{"V":"x","L":["a","b"]}\`)
	fmt.Println(n, e1, bx, e2)
}
`,
		`{"V":2,"L":[1]} <nil>
<nil> 1
3<nil> "s"<nil> [true]<nil>
5 <nil> {x [a b]} <nil>
`,
	);
});

test("pointer-to-pointer struct fields decode on every target", async () => {
	await assertAllTargetsOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

type In struct{ N int }

type S struct {
	P  **int
	Q  ***string
	R  **In
	Z  **int
	Pp *int
}

func main() {
	var s S
	err := json.Unmarshal([]byte(\`{"P":1,"Q":"x","R":{"N":4},"Z":null,"Pp":3}\`), &s)
	fmt.Println(err, **s.P, ***s.Q, (**s.R).N, s.Z == nil, *s.Pp)
	var t S
	err = json.Unmarshal([]byte(\`{"P":"bad"}\`), &t)
	fmt.Println(err)
	b, err := json.Marshal(s)
	fmt.Println(string(b), err)
}
`,
		`<nil> 1 x 4 true 3
json: cannot unmarshal string into Go struct field S.P of type int
{"P":1,"Q":"x","R":{"N":4},"Z":null,"Pp":3} <nil>
`,
	);
});

section("encoding/json — RawMessage methods and import alias");

test("json.RawMessage MarshalJSON / UnmarshalJSON", async () => {
	await assertAllTargetsOutput(
		`package main
import (
	"encoding/json"
	"fmt"
)

type W struct {
	R json.RawMessage
}

func main() {
	b, err := json.RawMessage("true").MarshalJSON()
	fmt.Println(string(b), err)
	b, err = json.RawMessage(nil).MarshalJSON()
	fmt.Println(string(b), err)
	var rm json.RawMessage
	src := []byte("[1,2]")
	err = (&rm).UnmarshalJSON(src)
	src[1] = '9'
	fmt.Println(string(rm), err)
	err = (*json.RawMessage)(nil).UnmarshalJSON(src)
	fmt.Println(err)
	var w W
	err = json.Unmarshal([]byte(\`{"R":{"a": 1}}\`), &w)
	fmt.Println(string(w.R), err)
	out, err := json.Marshal(w)
	fmt.Println(string(out), err)
}
`,
		`true <nil>
null <nil>
[1,2] <nil>
json.RawMessage: UnmarshalJSON on nil pointer
{"a": 1} <nil>
{"R":{"a":1}} <nil>
`,
	);
});

test("json import alias", async () => {
	await assertAllTargetsOutput(
		`package main
import (
	"fmt"
	myjson "encoding/json"
)

func main() {
	b, err := myjson.Marshal(map[string]int{"a": 1})
	fmt.Println(string(b), err)
	var m map[string]int
	err = myjson.Unmarshal(b, &m)
	fmt.Println(m["a"], err)
	fmt.Println(myjson.Valid(b), myjson.Valid([]byte("{")))
	r := myjson.RawMessage("1")
	fmt.Println(string(r))
}
`,
		`{"a":1} <nil>
1 <nil>
true false
1
`,
	);
});

section("encoding/json — call-site matching");

test("a local variable named json is not a json call", async () => {
	await assertAllTargetsOutput(
		`package main
import (
	"encoding/json"
	"fmt"
)

type S struct{}

func (S) Marshal() int { return 7 }

func main() {
	fmt.Println(json.Valid(nil))
	var json S
	fmt.Println(json.Marshal())
}
`,
		`false
7
`,
	);
});

test("json.Valid works as a value", async () => {
	await assertAllTargetsOutput(
		`package main
import (
	"encoding/json"
	"fmt"
)

func main() {
	f := json.Valid
	fmt.Println(f([]byte("1")), f([]byte("{")))
}
`,
		`true false
`,
	);
});

test("json.Marshal and json.Unmarshal cannot be used as values", () => {
	for (const [fn, expr] of [
		["Marshal", "json.Marshal"],
		["MarshalIndent", "json.MarshalIndent"],
		["Unmarshal", "json.Unmarshal"],
	]) {
		const { errors } = compile(`package main
import "encoding/json"
func main() {
	f := ${expr}
	_ = f
}`);
		assertErrorContains(errors, `json.${fn} cannot be used as a value`);
	}
});

section("encoding/json — types named through another file's import alias");

// `a.go` names time.Time as `t.Time`; `b.go` marshals it without importing time.
async function marshalAcrossFiles(target, dyn, extraFiles = {}) {
	const res = await compileHybridProject({
		"lib/a.go": `//gofront:target ${target}
package lib

import t "time"

func Make() t.Time { return t.Date(2020, 1, 2, 3, 4, 5, 0, t.UTC) }

type W struct{ D t.Time }

func MakeW() W { return W{D: Make()} }
`,
		...extraFiles,
		"lib/b.go": `package lib

import "encoding/json"

func Run() string {
	b, _ := json.Marshal(${dyn ? "any(Make())" : "Make()"})
	c, _ := json.Marshal(${dyn ? "any(MakeW())" : "MakeW()"})
	return string(b) + " " + string(c)
}
`,
		"main.go": `package main

import "./lib"

func main() { println(lib.Run()) }
`,
	});
	return res.lines.join("\n");
}

const TIME_JSON = '"2020-01-02T03:04:05Z" {"D":"2020-01-02T03:04:05Z"}';

for (const target of ["both", "wasm"]) {
	for (const dyn of [false, true]) {
		const kind = dyn ? "dynamic" : "static";
		test(`json.Marshal of an aliased time.Time in another file (${kind}, ${target})`, async () => {
			assertEqual(await marshalAcrossFiles(target, dyn), TIME_JSON);
		});
		test(`json.Marshal of time.Time beside a package-level 'time' (${kind}, ${target})`, async () => {
			assertEqual(
				await marshalAcrossFiles(target, dyn, {
					"lib/c.go": "package lib\n\nvar time = 5\n",
				}),
				TIME_JSON,
			);
		});
	}
}

section("encoding/json — dynamic values and typed nils");

async function runProject(files) {
	return (await compileHybridProject(files)).lines.join("\n");
}

for (const target of ["js", "both", "wasm"]) {
	test(`json.Marshal of a nil unsupported map in any reports its type (${target})`, async () => {
		assertEqual(
			await runProject({
				"main.go": `//gofront:target ${target}
package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	var m map[float64]int
	var v any = m
	_, err := json.Marshal(v)
	fmt.Println(err)
	var ok map[string]int
	v = ok
	b, err := json.Marshal(v)
	fmt.Println(string(b), err)
}
`,
			}),
			"json: unsupported type: map[float64]int\nnull <nil>",
		);
	});

	test(`json.Unmarshal into a typed nil pointer names the declaring package (${target})`, async () => {
		assertEqual(
			await runProject({
				"main.go": `//gofront:target ${target}
package main

import (
	"encoding/json"
	"fmt"
	"./sub"
)

func main() {
	var v any = sub.NewNil()
	fmt.Println(json.Unmarshal([]byte("{}"), v))
	fmt.Printf("%T\\n", v)
}
`,
				"sub/s.go": `//gofront:target ${target}
package sub

type OtherItem struct{ A int }

func NewNil() *OtherItem { return nil }
`,
			}),
			"json: Unmarshal(nil *sub.OtherItem)\n*sub.OtherItem",
		);
	});

	test(`json.Marshal of a type from a package that does not import encoding/json (${target})`, async () => {
		assertEqual(
			await runProject({
				"main.go": `//gofront:target ${target}
package main

import (
	"fmt"
	"./pkg"
)

type TextVal struct{ S string }

func (t TextVal) MarshalJSON() ([]byte, error) { return []byte("\\"text-" + t.S + "\\""), nil }

type Plain struct {
	A int    \`json:"a"\`
	B string \`json:"b"\`
}

func main() {
	fmt.Println(pkg.Encode(any(TextVal{"hello"})))
	fmt.Println(pkg.Encode(Plain{1, "x"}))
	fmt.Println(pkg.Encode(&Plain{2, "y"}))
}
`,
				"pkg/p.go": `//gofront:target ${target}
package pkg

import "encoding/json"

func Encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return err.Error()
	}
	return string(b)
}
`,
			}),
			'"text-hello"\n{"a":1,"b":"x"}\n{"a":2,"b":"y"}',
		);
	});
}

section("encoding/json — reachability");

test("json use in a WASM package does not leak codecs into JS output", async () => {
	const { js } = await compileHybridProject({
		"main.go": `//gofront:target js
package main

import (
	"fmt"
	"./sim"
)

func main() { fmt.Println(sim.Enc(1)) }
`,
		"sim/sim.go": `//gofront:target wasm
package sim

import "encoding/json"

func Enc(v int) string {
	b, _ := json.Marshal(v)
	return string(b)
}
`,
	});
	assert(!js.includes("RegisterEncoder"), "RegisterEncoder in JS output");
});

test("json.Valid alone keeps the codec runtime out of the output", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	_ = json.Valid(nil)
}`);
	assertEqual(errors.length, 0);
	assert(!js.includes("UnmarshalTypeError"), "UnmarshalTypeError in output");
	assert(!js.includes("EncodeBytes"), "EncodeBytes in output");
});

test("same-named local types marshal with their own fields and tags", async () => {
	await assertProgramOutput(
		`package main

import (
	"encoding/json"
	"fmt"
)

func f1() {
	type Config struct{ A int \`json:"a"\` }
	b, _ := json.Marshal(Config{1})
	fmt.Println(string(b))
}

func f2() {
	type Config struct{ B string }
	b, _ := json.Marshal(Config{"x"})
	fmt.Println(string(b))
}

func main() {
	f1()
	f2()
}
`,
		'{"a":1}\n{"B":"x"}\n',
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
