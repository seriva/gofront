package main

type MySlice []int

func A1[S ~[]int](s S) S {
	return append(s, "a") // ERROR "cannot use \"a\" (untyped string constant) as int value in argument to append"
}

func A2[S ~[]int](s S) S {
	return append(s, 1.5) // ERROR "cannot use 1.5 (untyped float constant) as int value in argument to append (truncated)"
}

func A3[S ~[]int](s S) S {
	return append(s, nil) // ERROR "cannot use nil as int value in argument to append"
}

func A4[S ~[]int](s S) S {
	return append(s, []string{"a"}...) // ERROR "(value of type []string) as []int value in argument to append"
}

func A5[S interface{ []int | MySlice }](s S) S {
	return append(s, "a") // ERROR "cannot use \"a\" (untyped string constant) as int value in argument to append"
}

func main() {}
