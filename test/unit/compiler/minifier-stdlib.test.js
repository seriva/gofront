// GoFront test suite — minified output of programs that import the Go-source
// standard library must parse and behave like the unminified output.

import { minify } from "../../../src/cli/minifier.js";
import {
	assertEqual,
	checkSyntax,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("Minifier — stdlib-importing programs");

const PROGRAMS = {
	fmt: `package main

import "fmt"

func main() {
	fmt.Println("hello", 42, 3.5)
	fmt.Println(fmt.Sprintf("%05d|%x|%q", 42, 255, "hi"))
}`,
	strings: `package main

import (
	"fmt"
	"strings"
)

func main() {
	fmt.Println(strings.ToUpper("abc"), strings.Split("a,b,c", ","))
	fmt.Println(strings.Repeat("ab", 3), strings.Contains("hello", "ell"))
}`,
	strconv: `package main

import (
	"fmt"
	"strconv"
)

func main() {
	n, err := strconv.Atoi("123")
	fmt.Println(n, err)
	fmt.Println(strconv.Itoa(-45), strconv.FormatFloat(1.5, 'f', 2, 64))
}`,
	"unicode/utf8": `package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	s := "héllo, 世界"
	fmt.Println(utf8.RuneCountInString(s), utf8.ValidString(s))
	r, size := utf8.DecodeRuneInString("世")
	fmt.Println(r, size)
}`,
	"encoding/json": `package main

import (
	"encoding/json"
	"fmt"
)

type P struct {
	Name string \`json:"name"\`
	Age  int    \`json:"age"\`
}

func main() {
	b, _ := json.Marshal(P{"Ann", 30})
	fmt.Println(string(b))
	var p P
	err := json.Unmarshal([]byte(\`{"name":"Bob","age":7}\`), &p)
	fmt.Println(p.Name, p.Age, err)
}`,
	sort: `package main

import (
	"fmt"
	"sort"
)

func main() {
	xs := []int{3, 1, 2}
	sort.Ints(xs)
	fmt.Println(xs)
}`,
	time: `package main

import (
	"fmt"
	"time"
)

func main() {
	d := 90 * time.Second
	fmt.Println(d.Minutes(), d)
}`,
	bytes: `package main

import (
	"bytes"
	"fmt"
)

func main() {
	var b bytes.Buffer
	b.WriteString("hello ")
	b.WriteString("world")
	fmt.Println(b.String(), b.Len())
}`,
};

for (const [pkg, source] of Object.entries(PROGRAMS)) {
	test(`minified ${pkg} program parses and matches unminified output`, () => {
		const { js, errors } = compile(source);
		assertEqual(errors.length, 0);
		const expected = runJs(js);
		for (const mangle of [false, true]) {
			const out = minify(js, { mangle });
			const syntax = checkSyntax(out, pkg.replace("/", "-"));
			assertEqual(syntax, null);
			assertEqual(runJs(out), expected);
		}
	});
}
