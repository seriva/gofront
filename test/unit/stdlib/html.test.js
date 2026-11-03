// GoFront test suite — html (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("html (Go-source)");

test("EscapeString and UnescapeString", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"html"
)

func main() {
	for _, s := range []string{"", "plain", \`<a href="x">'T&C'</a>\`, "日本 & <é>"} {
		e := html.EscapeString(s)
		fmt.Printf("%q %q %v\\n", s, e, html.UnescapeString(e) == s)
	}
	for _, s := range []string{
		"&lt;b&gt; &amp; &quot;q&quot; &#39;s&#39; &apos;", "&#65;&#x42;&#X43; &#x1F600; &#128512;", "&#0; &#xD800; &#x110000; &#128; &#x9F; &#150;",
		"&nbsp;|&copy;|&eacute;|&Eacute;|&yuml;|&frac12;", "&copy &amp &lt &notanentity; &amp;amp; &ampx", "&euro; &hellip; &mdash; &hearts;",
		"& &# &#; &#x; &; &&amp;", "&#65 &#x41 a&b", "&lt;&gt;&lt", "&unknown; &Aacute;x", "&#12345678901234567890;",
	} {
		fmt.Printf("%q\\n", html.UnescapeString(s))
	}
}
`,
		`"" "" true
"plain" "plain" true
"<a href=\\"x\\">'T&C'</a>" "&lt;a href=&#34;x&#34;&gt;&#39;T&amp;C&#39;&lt;/a&gt;" true
"日本 & <é>" "日本 &amp; &lt;é&gt;" true
"<b> & \\"q\\" 's' '"
"ABC 😀 😀"
"� � � € Ÿ –"
"\\u00a0|©|é|É|ÿ|½"
"© & < ¬anentity; &amp; &x"
"€ … — ♥"
"& &# &#; � &; &&"
"A A a&b"
"<><"
"&unknown; Áx"
"�"
`,
	);
});
