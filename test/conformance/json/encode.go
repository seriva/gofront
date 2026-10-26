package main

import (
	"errors"
	"fmt"
	"math"

	"encoding/json"
)

type Address struct {
	Street string `json:"street"`
	City   string `json:"city,omitempty"`
}

type Person struct {
	Name     string            `json:"name"`
	Age      int               `json:"age"`
	Email    string            `json:"email,omitempty"`
	Addr     Address           `json:"addr"`
	Home     *Address          `json:"home"`
	Tags     []string          `json:"tags"`
	Attrs    map[string]string `json:"attrs"`
	Score    float64           `json:"score"`
	Active   bool              `json:"active"`
	Skip     string            `json:"-"`
	Dash     string            `json:"-,"`
	hidden   int
	NoTag    int
	Renamed  int `json:"r_name"`
	Quoted   int `json:"quoted,string"`
	QuotedS  string `json:"qs,string"`
	QuotedB  bool   `json:"qb,string"`
	QuotedF  float64 `json:"qf,string"`
}

type Base struct {
	ID   int    `json:"id"`
	Kind string `json:"kind"`
}

type Derived struct {
	Extra string `json:"extra"`
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
	return []byte(fmt.Sprintf("\"color-%d\"", int(c))), nil
}

type Temp struct{ V int }

func (t *Temp) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf("{\"temp\": %d}", t.V)), nil
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
	b, err = json.Marshal("hello <b>&\"q\"\n\t\\")
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

	fmt.Println(json.Valid([]byte(`{"a":[1,2,{"b":null}]}`)), json.Valid([]byte(`{"a":`)), json.Valid([]byte(` 1 `)), json.Valid([]byte(`01`)))
}
