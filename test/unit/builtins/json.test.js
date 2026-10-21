// GoFront test suite — encoding/json package

import { fileURLToPath } from "node:url";
import { compileSingleFile } from "../../../src/compiler.js";
import {
	assert,
	assertContains,
	assertEqual,
	compile,
	join,
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
	assertEqual(runJs(js), '{"title":"Book","id":42}');
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

test("Probe 9: Boxed json.RawMessage inside any marshaled verbatim", () => {
	const { js, errors } = compile(`package main
import "encoding/json"
func main() {
	var x any = json.RawMessage(\`{"key": 123}\`)
	b, _ := json.Marshal(x)
	console.log(string(b))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '{"key": 123}');
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
	assertEqual(runJs(js), '{"title":"Book"}\n{"title":"Book","id":42}');
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

section("encoding/json — wasm diagnostic");

test("json.Marshal rejected in wasm target", () => {
	const res = compile(`//gofront:target wasm
package main
import "encoding/json"
func main() {
	_, _ = json.Marshal(42)
}`);
	assert(res.errors.length > 0, "expected compile error in wasm package");
	assertContains(
		res.errors[0].message,
		"'json.Marshal' is not yet available in wasm packages",
	);
});

test("json.Marshal rejected in both target", () => {
	const res = compile(`//gofront:target both
package main
import "encoding/json"
func main() {
	_, _ = json.Marshal(42)
}`);
	assert(res.errors.length > 0, "expected compile error in both package");
	assertContains(
		res.errors[0].message,
		"'json.Marshal' is not yet available in wasm packages",
	);
});

test("encoding/json import rejected in wasm package", () => {
	withTempDir(
		{
			"main.go": `//gofront:target wasm
package main
import "encoding/json"
func main() {}`,
		},
		(dir) => {
			let err = "";
			try {
				compileSingleFile(join(dir, "main.go"));
			} catch (e) {
				err = e.message;
			}
			assertContains(
				err,
				"'encoding/json' is not yet available in wasm packages",
			);
		},
	);
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
