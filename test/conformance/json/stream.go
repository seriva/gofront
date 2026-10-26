package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type Item struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type StrictItem struct {
	ID int `json:"id"`
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
	fmt.Printf("Encode indented err=%v:\n%s", err, buf.String())

	// --- 3. Encoder SetEscapeHTML ---
	buf.Reset()
	enc = json.NewEncoder(&buf)
	enc.SetEscapeHTML(true)
	err = enc.Encode("<b>test & ' \"</b>")
	fmt.Printf("Encode escapeHTML true: %s", buf.String())

	buf.Reset()
	enc = json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	err = enc.Encode("<b>test & ' \"</b>")
	fmt.Printf("Encode escapeHTML false: %s", buf.String())

	// --- 4. Decoder basic & multiple values ---
	input := `{"id":10,"name":"ten"} {"id":20,"name":"twenty"}`
	dec := json.NewDecoder(strings.NewReader(input))

	for dec.More() {
		var it Item
		offsetBefore := dec.InputOffset()
		err := dec.Decode(&it)
		fmt.Printf("Decode item: id=%d name=%s err=%v offsetBefore=%d offsetAfter=%d\n",
			it.ID, it.Name, err, offsetBefore, dec.InputOffset())
	}

	// Next decode at EOF
	var it Item
	err = dec.Decode(&it)
	fmt.Printf("Decode at EOF: err=%v (isEOF=%v)\n", err, err == io.EOF)

	// --- 5. Decoder ErrUnexpectedEOF on truncated stream ---
	truncDec := json.NewDecoder(strings.NewReader(`{"id": 100`))
	err = truncDec.Decode(&it)
	fmt.Printf("Decode truncated: err=%v (isUnexpectedEOF=%v)\n", err, err == io.ErrUnexpectedEOF)

	// --- 6. Decoder UseNumber ---
	numInput := `{"val": 1234567890123456789}`
	numDec := json.NewDecoder(strings.NewReader(numInput))
	numDec.UseNumber()
	var anyMap map[string]any
	err = numDec.Decode(&anyMap)
	val := anyMap["val"]
	_, isNum := val.(json.Number)
	fmt.Printf("Decode UseNumber: val=%v isNumber=%v err=%v\n", val, isNum, err)

	// --- 7. Decoder DisallowUnknownFields ---
	unknownInput := `{"id": 42, "unknown": "extra"}`
	strictDec := json.NewDecoder(strings.NewReader(unknownInput))
	strictDec.DisallowUnknownFields()
	var sItem StrictItem
	err = strictDec.Decode(&sItem)
	fmt.Printf("Decode DisallowUnknownFields: err=%v\n", err)

	// --- 8. Decoder Buffered ---
	bufInput := `{"id": 1} trailing data`
	bufDec := json.NewDecoder(strings.NewReader(bufInput))
	var itBuf Item
	err = bufDec.Decode(&itBuf)
	rest, _ := io.ReadAll(bufDec.Buffered())
	fmt.Printf("Decode Buffered: id=%d rest=%q\n", itBuf.ID, string(rest))
}
