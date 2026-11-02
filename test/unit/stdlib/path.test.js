// GoFront test suite — path (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("path (Go-source)");

test("Clean, Join, Split, Base, Dir, Ext, IsAbs and Match", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
	"path"
)

func main() {
	for _, p := range []string{"", ".", "/", "a/b/c", "a//b/./c/", "/a/../..", "../a/b/..", "a/b/../../..", "/../a", "a/./b/../c", "héllo/../wörld/日本", "//x///y"} {
		d, f := path.Split(p)
		fmt.Printf("%q clean=%q base=%q dir=%q ext=%q abs=%v split=%q,%q\\n", p, path.Clean(p), path.Base(p), path.Dir(p), path.Ext(p), path.IsAbs(p), d, f)
	}
	fmt.Printf("%q %q %q %q\\n", path.Join(), path.Join("", ""), path.Join("a", "", "b", "../c"), path.Join("/", "x", "..", "y"))
	fmt.Printf("%q %q %q\\n", path.Ext("a/b.txt"), path.Ext("a.b/c"), path.Ext(".gitignore"))
	for _, t := range [][2]string{
		{"*.go", "main.go"}, {"*.go", "a/main.go"}, {"a?c", "abc"}, {"a?c", "a/c"}, {"[a-c]x", "bx"}, {"[^a-c]x", "bx"},
		{"a\\\\*b", "a*b"}, {"a*b*c", "aXXbYYc"}, {"*", ""}, {"[", "a"}, {"[]a]", "]"}, {"a[", "a"}, {"\\\\", "a"}, {"日*", "日本"}, {"?", "日"}, {"[日-本]", "文"},
	} {
		m, err := path.Match(t[0], t[1])
		fmt.Println(t[0], t[1], m, err, errors.Is(err, path.ErrBadPattern))
	}
	fmt.Println(path.ErrBadPattern)
}
`,
		`"" clean="." base="." dir="." ext="" abs=false split="",""
"." clean="." base="." dir="." ext="." abs=false split="","."
"/" clean="/" base="/" dir="/" ext="" abs=true split="/",""
"a/b/c" clean="a/b/c" base="c" dir="a/b" ext="" abs=false split="a/b/","c"
"a//b/./c/" clean="a/b/c" base="c" dir="a/b/c" ext="" abs=false split="a//b/./c/",""
"/a/../.." clean="/" base=".." dir="/" ext="." abs=true split="/a/../",".."
"../a/b/.." clean="../a" base=".." dir="../a/b" ext="." abs=false split="../a/b/",".."
"a/b/../../.." clean=".." base=".." dir="." ext="." abs=false split="a/b/../../",".."
"/../a" clean="/a" base="a" dir="/" ext="" abs=true split="/../","a"
"a/./b/../c" clean="a/c" base="c" dir="a" ext="" abs=false split="a/./b/../","c"
"héllo/../wörld/日本" clean="wörld/日本" base="日本" dir="wörld" ext="" abs=false split="héllo/../wörld/","日本"
"//x///y" clean="/x/y" base="y" dir="/x" ext="" abs=true split="//x///","y"
"" "" "a/c" "/y"
".txt" "" ".gitignore"
*.go main.go true <nil> false
*.go a/main.go false <nil> false
a?c abc true <nil> false
a?c a/c false <nil> false
[a-c]x bx true <nil> false
[^a-c]x bx false <nil> false
a\\*b a*b true <nil> false
a*b*c aXXbYYc true <nil> false
*  true <nil> false
[ a false syntax error in pattern true
[]a] ] false syntax error in pattern true
a[ a false syntax error in pattern true
\\ a false syntax error in pattern true
日* 日本 true <nil> false
? 日 true <nil> false
[日-本] 文 false <nil> false
syntax error in pattern
`,
	);
});

test("path/filepath behaves as path", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
	"path/filepath"
)

func main() {
	for _, p := range []string{"", ".", "/", "a/b/c", "a//b/./c/", "/a/../..", "../a/b/..", "a/b/../../..", "/../a", "a/./b/../c", "héllo/../wörld/日本", "//x///y"} {
		d, f := filepath.Split(p)
		fmt.Printf("%q clean=%q base=%q dir=%q ext=%q abs=%v split=%q,%q\\n", p, filepath.Clean(p), filepath.Base(p), filepath.Dir(p), filepath.Ext(p), filepath.IsAbs(p), d, f)
	}
	fmt.Printf("%q %q %q %q\\n", filepath.Join(), filepath.Join("", ""), filepath.Join("a", "", "b", "../c"), filepath.Join("/", "x", "..", "y"))
	fmt.Printf("%q %q %q\\n", filepath.Ext("a/b.txt"), filepath.Ext("a.b/c"), filepath.Ext(".gitignore"))
	for _, t := range [][2]string{
		{"*.go", "main.go"}, {"*.go", "a/main.go"}, {"a?c", "abc"}, {"a?c", "a/c"}, {"[a-c]x", "bx"}, {"[^a-c]x", "bx"},
		{"a\\\\*b", "a*b"}, {"a*b*c", "aXXbYYc"}, {"*", ""}, {"[", "a"}, {"[]a]", "]"}, {"a[", "a"}, {"\\\\", "a"}, {"日*", "日本"}, {"?", "日"}, {"[日-本]", "文"},
	} {
		m, err := filepath.Match(t[0], t[1])
		fmt.Println(t[0], t[1], m, err, errors.Is(err, filepath.ErrBadPattern))
	}
	fmt.Println(filepath.ErrBadPattern)
}
`,
		`"" clean="." base="." dir="." ext="" abs=false split="",""
"." clean="." base="." dir="." ext="." abs=false split="","."
"/" clean="/" base="/" dir="/" ext="" abs=true split="/",""
"a/b/c" clean="a/b/c" base="c" dir="a/b" ext="" abs=false split="a/b/","c"
"a//b/./c/" clean="a/b/c" base="c" dir="a/b/c" ext="" abs=false split="a//b/./c/",""
"/a/../.." clean="/" base=".." dir="/" ext="." abs=true split="/a/../",".."
"../a/b/.." clean="../a" base=".." dir="../a/b" ext="." abs=false split="../a/b/",".."
"a/b/../../.." clean=".." base=".." dir="." ext="." abs=false split="a/b/../../",".."
"/../a" clean="/a" base="a" dir="/" ext="" abs=true split="/../","a"
"a/./b/../c" clean="a/c" base="c" dir="a" ext="" abs=false split="a/./b/../","c"
"héllo/../wörld/日本" clean="wörld/日本" base="日本" dir="wörld" ext="" abs=false split="héllo/../wörld/","日本"
"//x///y" clean="/x/y" base="y" dir="/x" ext="" abs=true split="//x///","y"
"" "" "a/c" "/y"
".txt" "" ".gitignore"
*.go main.go true <nil> false
*.go a/main.go false <nil> false
a?c abc true <nil> false
a?c a/c false <nil> false
[a-c]x bx true <nil> false
[^a-c]x bx false <nil> false
a\\*b a*b true <nil> false
a*b*c aXXbYYc true <nil> false
*  true <nil> false
[ a false syntax error in pattern true
[]a] ] false syntax error in pattern true
a[ a false syntax error in pattern true
\\ a false syntax error in pattern true
日* 日本 true <nil> false
? 日 true <nil> false
[日-本] 文 false <nil> false
syntax error in pattern
`,
	);
});
