package main

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
	U  Up            `json:"u"`
	UP *Up           `json:"up"`
	L  []Up          `json:"l"`
	M  map[string]Up `json:"m"`
}

type Msg struct {
	ID      int               `json:"id"`
	Payload json.RawMessage   `json:"payload"`
	List    []json.RawMessage `json:"list"`
}

type Pt struct{ X, Y int }

func main() {
	var d Doc
	err := json.Unmarshal([]byte(`{"u":"ab","up":"cd","l":["ef",{"x":1}],"m":{"k":[1, 2]}}`), &d)
	fmt.Println(err, d.U.S, d.UP.S, d.L[0].S, d.L[1].S, d.M["k"].S)
	var d2 Doc
	d2.UP = &Up{S: "keep"}
	err = json.Unmarshal([]byte(`{"u":null,"up":null}`), &d2)
	fmt.Println(err, d2.U.S, d2.UP == nil)
	var top Up
	err = json.Unmarshal([]byte(` "top" `), &top)
	fmt.Println(err, top.S)
	var st Strict
	err = json.Unmarshal([]byte("0"), &st)
	fmt.Println(errors.Is(err, errStrict), err)
	var sts []Strict
	err = json.Unmarshal([]byte("[12, 0]"), &sts)
	fmt.Println(errors.Is(err, errStrict), err)

	var m Msg
	err = json.Unmarshal([]byte(`{"id":1,"payload": {"a" : [1, 2 ,3], "b":"x"} ,"list":[ 1 , "two" ,{"k":null}]}`), &m)
	fmt.Println(err, m.ID)
	fmt.Println(string(m.Payload))
	fmt.Println(string(m.List[0]) + "|" + string(m.List[1]) + "|" + string(m.List[2]))
	var lazy struct {
		Kind string          `json:"kind"`
		Data json.RawMessage `json:"data"`
	}
	err = json.Unmarshal([]byte(`{"kind":"point","data":{"X":1,"Y":2}}`), &lazy)
	var pt Pt
	fmt.Println(err, lazy.Kind, json.Unmarshal(lazy.Data, &pt), pt.X, pt.Y)
}
