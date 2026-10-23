package main

import (
	"fmt"
	"strings"
)

func main() {
	fmt.Println(strings.ToUpper("hello"), strings.ToLower("WORLD"))
	fmt.Println(strings.Contains("seafood", "foo"), strings.Contains("seafood", "bar"))
	fmt.Println(strings.HasPrefix("golang", "go"), strings.HasSuffix("golang", "ng"))
	fmt.Println(strings.Index("chicken", "ken"), strings.Index("chicken", "dmr"))
	fmt.Println(strings.LastIndex("go gopher", "go"))
	fmt.Println(strings.Repeat("ab", 3))
	fmt.Println(strings.Replace("oink oink oink", "k", "ky", 2))
	fmt.Println(strings.ReplaceAll("oink oink oink", "oink", "moo"))
	fmt.Println(strings.Split("a,b,c", ","), len(strings.Split("a,b,c", ",")))
	fmt.Println(strings.Fields("  foo bar  baz   "), len(strings.Fields(" x  y ")))
	fmt.Println(strings.Join([]string{"x", "y", "z"}, "-"))
	fmt.Printf("[%s]\n", strings.TrimSpace("  \t padded \n "))
	fmt.Println(strings.Trim("xxhixx", "x"), strings.TrimPrefix("prefix-body", "prefix-"))
	fmt.Println(strings.Count("cheese", "e"), strings.Count("five", ""))
	fmt.Println(strings.EqualFold("Go", "GO"))
}
