package main

import "fmt"

type P struct {
	X int
	Y string
}

type Color int

func (c Color) String() string { return "color" }

type Celsius float64

type Pair struct {
	A, B int
}

func main() {
	// %T on static types
	var i int = 1
	var i8 int8 = 2
	var u uint = 3
	var u64 uint64 = 4
	var f float64 = 1.5
	var f32 float32 = 2.5
	var r rune = 'x'
	var b byte = 7
	fmt.Printf("%T %T %T %T %T %T %T %T\n", i, i8, u, u64, f, f32, r, b)
	fmt.Printf("%T %T %T\n", "s", true, nil)
	fmt.Printf("%T %T %T %T\n", P{}, &P{}, Color(1), Celsius(2))
	fmt.Printf("%T %T %T\n", []int{1}, map[string]int{}, []string{})
	fmt.Printf("%T %T\n", [2]int{}, []P{})
	var a any = 5
	var s any = "s"
	var p any = P{1, "a"}
	var pp any = &P{1, "a"}
	fmt.Printf("%T %T %T %T\n", a, s, p, pp)

	// %U and %c
	fmt.Printf("%U %U %U\n", 'A', 0x1F600, r)
	fmt.Printf("%#U\n", 'A')
	fmt.Printf("%c%c\n", 72, 'i')

	// %q on runes, strings
	fmt.Printf("%q %q %q\n", 'x', '\n', r)
	fmt.Printf("%q %q\n", "hi", "a\"b")
	fmt.Printf("%q\n", i)

	// %#v
	fmt.Printf("%#v %#v %#v %#v\n", 1, "s", 2.5, true)
	fmt.Printf("%#v\n", P{1, "a"})
	fmt.Printf("%#v\n", &P{1, "a"})
	fmt.Printf("%#v %#v\n", []int{1, 2}, []string{"a", "b"})
	fmt.Printf("%#v\n", map[string]int{"a": 1})
	fmt.Printf("%#v\n", [2]int{1, 2})
	fmt.Printf("%#v %#v\n", Color(3), Celsius(2))
	fmt.Printf("%#v\n", []P{{1, "a"}})
	fmt.Printf("%#v\n", Pair{1, 2})

	// %#x %#o %#b and friends
	fmt.Printf("%#x %#X %#o %#b\n", 255, 255, 8, 5)
	fmt.Printf("%x %X %o %b\n", 255, 255, 8, 5)
	fmt.Printf("%#x\n", "hi")
	fmt.Printf("% x|%# x\n", "hi", "hi")

	// %+d and "% d"
	fmt.Printf("%+d %+d %+d\n", 5, -5, 0)
	fmt.Printf("% d|% d|% d\n", 5, -5, 0)
	fmt.Printf("%+5d|%-+5d|%+05d\n", 5, 5, 5)
	fmt.Printf("%+.2f %+.1f\n", 1.5, -1.5)

	// %x on byte slices and strings
	bs := []byte("hello")
	fmt.Printf("%x %X\n", bs, bs)
	fmt.Printf("% x\n", bs)
	fmt.Printf("%x\n", "hello")
	fmt.Printf("%s %v\n", bs, bs)

	// %e %E %G
	fmt.Printf("%e %E\n", 1234.5678, 1234.5678)
	fmt.Printf("%.2e\n", 1234.5678)
	fmt.Printf("%g %G\n", 1e21, 1e-7)

	// explicit argument indexes
	fmt.Printf("%[2]d %[1]d\n", 1, 2)
	fmt.Printf("%[1]d %[1]x %[1]o\n", 10)
	fmt.Printf("%[2]s %s\n", "a", "b")

	// width and precision from arguments
	fmt.Printf("%*d|\n", 5, 42)
	fmt.Printf("%-*d|\n", 5, 42)
	fmt.Printf("%.*f|\n", 2, 3.14159)
	fmt.Printf("%*.*f|\n", 8, 3, 3.14159)

	// %p text is covered by a unit test (addresses differ per run)
	fmt.Printf("%v %d\n", true, []int{1, 2})
	fmt.Printf("%5t|%-7t|\n", true, false)
	fmt.Printf("%6.2f|%-8.3f|%08.3f\n", 3.14159, 2.5, -2.5)
	fmt.Printf("%5s|%-5s|%.2s\n", "ab", "ab", "abcdef")
	fmt.Printf("%5c|%-3c|\n", 'x', 'y')
}
