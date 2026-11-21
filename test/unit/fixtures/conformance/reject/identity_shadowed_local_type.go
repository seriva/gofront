package main

type T struct{ A int }

func main() {
	var x T
	{
		type T struct{ B string }
		var y T
		x = y // ERROR ") as T value in assignment"
	}
	_ = x
}
