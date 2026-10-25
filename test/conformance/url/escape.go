package main

import (
	"fmt"
	"net/url"
)

func main() {
	// 1. QueryEscape with ASCII and non-ASCII
	q1 := "hello world!"
	eq1 := url.QueryEscape(q1)
	fmt.Printf("QueryEscape ascii: %s\n", eq1)

	q2 := "héllo 世界"
	eq2 := url.QueryEscape(q2)
	fmt.Printf("QueryEscape non-ascii: %s\n", eq2)

	q3 := "?&=#+"
	eq3 := url.QueryEscape(q3)
	fmt.Printf("QueryEscape reserved: %s\n", eq3)

	// 2. QueryUnescape
	uq1, err := url.QueryUnescape(eq1)
	fmt.Printf("QueryUnescape ascii: %s, err: %v\n", uq1, err)

	uq2, err := url.QueryUnescape(eq2)
	fmt.Printf("QueryUnescape non-ascii: %s, err: %v\n", uq2, err)

	_, errBad := url.QueryUnescape("%2")
	fmt.Printf("QueryUnescape bad short: %v\n", errBad)

	_, errHex := url.QueryUnescape("%ZZ")
	fmt.Printf("QueryUnescape bad hex: %v\n", errHex)

	// 3. PathEscape and PathUnescape
	p1 := "path/with/slashes and spaces?#"
	ep1 := url.PathEscape(p1)
	fmt.Printf("PathEscape: %s\n", ep1)

	up1, err := url.PathUnescape(ep1)
	fmt.Printf("PathUnescape: %s, err: %v\n", up1, err)

	// PathUnescape preserves '+'
	upPlus, _ := url.PathUnescape("a+b%20c")
	fmt.Printf("PathUnescape plus: %s\n", upPlus)

	// 4. Values methods
	v := make(url.Values)
	v.Set("name", "alice")
	v.Add("tag", "go")
	v.Add("tag", "wasm")
	v.Add("tag", "web")
	fmt.Printf("Get name: %s\n", v.Get("name"))
	fmt.Printf("Get tag: %s\n", v.Get("tag"))
	fmt.Printf("Get missing: %q\n", v.Get("missing"))
	fmt.Printf("Has tag: %v, Has missing: %v\n", v.Has("tag"), v.Has("missing"))

	v.Del("name")
	fmt.Printf("After Del name, Has name: %v\n", v.Has("name"))

	// Values.Encode() sorts keys
	vEncode := url.Values{
		"z": []string{"last"},
		"a": []string{"first", "second"},
		"m": []string{"middle with spaces", "é"},
	}
	fmt.Printf("Encode: %s\n", vEncode.Encode())

	// 5. ParseQuery
	rawQuery := "a=first&a=second&m=middle+with+spaces&m=%C3%A9&z=last&empty=&novalue"
	parsed, err := url.ParseQuery(rawQuery)
	fmt.Printf("ParseQuery err: %v\n", err)
	fmt.Printf("Parsed a: %v\n", parsed["a"])
	fmt.Printf("Parsed m: %v\n", parsed["m"])
	fmt.Printf("Parsed z: %v\n", parsed["z"])
	fmt.Printf("Parsed empty: %q\n", parsed.Get("empty"))
	fmt.Printf("Parsed novalue: %q\n", parsed.Get("novalue"))

	// Semicolon rejected in query
	_, errSemi := url.ParseQuery("a=1;b=2")
	fmt.Printf("ParseQuery semicolon err: %v\n", errSemi != nil)
}
