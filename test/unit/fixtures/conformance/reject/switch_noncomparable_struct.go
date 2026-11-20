package main

type P struct{ S []int }

func main() {
	var p P
	switch p { // ERROR "cannot switch on p (variable of struct type P) (P is not comparable)"
	}
}
