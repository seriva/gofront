package main

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func main() {
	var buf bytes.Buffer

	// Compact
	src1 := []byte(` { "name" : "Alice" , "nums" : [ 1 , 2 , 3 ] } `)
	err := json.Compact(&buf, src1)
	fmt.Printf("Compact: err=%v out=%s\n", err, buf.String())

	buf.Reset()
	err = json.Compact(&buf, []byte(` { "broken" `))
	fmt.Printf("Compact err: %v\n", err != nil)

	// Indent
	buf.Reset()
	src2 := []byte(`{"title":"GoFront","items":[1,2],"empty_obj":{},"empty_arr":[]}`)
	err = json.Indent(&buf, src2, "", "  ")
	fmt.Printf("Indent: err=%v\n%s\n", err, buf.String())

	buf.Reset()
	err = json.Indent(&buf, src2, ">> ", "  ")
	fmt.Printf("Indent with prefix: err=%v\n%s\n", err, buf.String())

	buf.Reset()
	err = json.Indent(&buf, []byte(`[1,`), "", "  ")
	fmt.Printf("Indent err: %v\n", err != nil)

	// HTMLEscape
	buf.Reset()
	src3 := []byte(`{"body":"<b>Hello & Welcome</b>"}`)
	json.HTMLEscape(&buf, src3)
	fmt.Printf("HTMLEscape: %s\n", buf.String())

	// Number
	var n json.Number = "42.5"
	f, err := n.Float64()
	fmt.Printf("Number Float64: %v, err=%v\n", f, err)
	var nInt json.Number = "123456"
	i, err := nInt.Int64()
	fmt.Printf("Number Int64: %v, err=%v\n", i, err)
	fmt.Printf("Number String: %s\n", n.String())

	var decodedNum json.Number
	err = json.Unmarshal([]byte("987.654"), &decodedNum)
	fmt.Printf("Unmarshal into Number: %s, err=%v\n", decodedNum, err)

	err = json.Unmarshal([]byte(`"987.654"`), &decodedNum)
	fmt.Printf("Unmarshal string into Number: %s, err=%v\n", decodedNum, err)

	b, err := json.Marshal(decodedNum)
	fmt.Printf("Marshal Number: %s, err=%v\n", string(b), err)

	b, err = json.Marshal(json.Number(""))
	fmt.Printf("Marshal empty Number: %s, err=%v\n", string(b), err)
}
