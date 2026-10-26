package main

import (
	"encoding/json"
	"fmt"
)

type Address struct {
	Street string `json:"street"`
	City   string `json:"city"`
}

type Person struct {
	Name   string         `json:"name"`
	Age    int            `json:"age"`
	Score  float64        `json:"score"`
	Active bool           `json:"active"`
	Tags   []string       `json:"tags"`
	Addr   Address        `json:"addr"`
	Home   *Address       `json:"home"`
	Attrs  map[string]int `json:"attrs"`
	Extra  any            `json:"extra"`
	Count  int8           `json:"count"`
}

type Base struct {
	ID int `json:"id"`
}

type Extended struct {
	Base
	Title string `json:"title"`
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
	err := json.Unmarshal([]byte(`{"name":"Ann","AGE":31,"Score":1.5,"active":true,"tags":["a","b"],"addr":{"street":"S","city":"C"},"home":{"street":"H"},"attrs":{"x":1,"y":2},"extra":[1,"two",{"k":null}],"unknown":5}`), &p)
	report("person", err)
	fmt.Println(p.Name, p.Age, p.Score, p.Active, p.Tags, p.Addr, *p.Home, p.Attrs["x"], p.Attrs["y"])
	extra := p.Extra.([]any)
	fmt.Println(len(extra), extra[0].(float64), extra[1].(string), extra[2].(map[string]any)["k"] == nil)

	var n int
	report("int", json.Unmarshal([]byte("42"), &n))
	fmt.Println(n)
	report("int from string", json.Unmarshal([]byte(`"x"`), &n))
	report("int fraction", json.Unmarshal([]byte("1.5"), &n))
	var i8 int8
	report("int8 range", json.Unmarshal([]byte("200"), &i8))
	var u8 uint8
	report("uint8 negative", json.Unmarshal([]byte("-1"), &u8))

	var q Person
	report("field type", json.Unmarshal([]byte(`{"name":5}`), &q))
	report("nested field type", json.Unmarshal([]byte(`{"addr":{"street":1}}`), &q))
	report("count range", json.Unmarshal([]byte(`{"count":300}`), &q))

	var keep Person
	keep.Name = "keep"
	keep.Age = 9
	keep.Tags = []string{"old"}
	keep.Home = &Address{Street: "S"}
	keep.Attrs = map[string]int{"k": 1}
	keep.Extra = 5
	report("null", json.Unmarshal([]byte(`{"name":null,"age":null,"tags":null,"home":null,"attrs":null,"extra":null}`), &keep))
	fmt.Println(keep.Name, keep.Age, keep.Tags == nil, keep.Home == nil, keep.Attrs == nil, keep.Extra == nil)

	var xs []int
	report("slice", json.Unmarshal([]byte("[1,2,3]"), &xs))
	fmt.Println(xs, len(xs))
	report("empty slice", json.Unmarshal([]byte("[]"), &xs))
	fmt.Println(xs == nil, len(xs))
	var m map[string]int
	report("map", json.Unmarshal([]byte(`{"b":2,"a":1}`), &m))
	fmt.Println(m["a"], m["b"])
	var mi map[int]string
	report("int keys", json.Unmarshal([]byte(`{"10":"ten","2":"two"}`), &mi))
	fmt.Println(mi[10], mi[2])
	var pts []*Point
	report("pointers", json.Unmarshal([]byte(`[{"X":1},null,{"Y":2}]`), &pts))
	fmt.Println(len(pts), *pts[0], pts[1] == nil, *pts[2])

	var e Extended
	report("embedded", json.Unmarshal([]byte(`{"id":42,"title":"Book"}`), &e))
	fmt.Println(e.ID, e.Title)

	var v any
	report("any", json.Unmarshal([]byte(`{"a":[1,2.5,"x",true,null],"b":{"c":"d"}}`), &v))
	obj := v.(map[string]any)
	list := obj["a"].([]any)
	fmt.Println(len(list), list[0].(float64), list[1].(float64), list[2], list[3], list[4] == nil, obj["b"].(map[string]any)["c"])
	report("any number", json.Unmarshal([]byte("12345.5"), &v))
	fmt.Println(v.(float64))

	var bs []byte
	report("bytes", json.Unmarshal([]byte(`"aGVsbG8="`), &bs))
	fmt.Println(string(bs))

	var f32 float32
	report("float32", json.Unmarshal([]byte("0.1"), &f32))
	fmt.Println(f32 > 0.09 && f32 < 0.11)

	var str string
	report("string escapes", json.Unmarshal([]byte(`"a\n\t\"b\\ A"`), &str))
	fmt.Println(str)
}
