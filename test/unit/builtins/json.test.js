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
		"json: cannot unmarshal string into Go struct field Data.Count of type int",
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
	nan := 0.0 / 0.0
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
		"json: cannot unmarshal string into Go value of type uint64\njson: cannot unmarshal string into Go value of type float32",
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
