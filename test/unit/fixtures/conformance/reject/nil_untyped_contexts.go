package main

func main() {
	_, x := nil, 1 // ERROR "use of untyped nil in assignment"
	y, _ := 1, nil // ERROR "use of untyped nil in assignment"
	_ = nil        // ERROR "use of untyped nil in assignment"
	println(nil)   // ERROR "use of untyped nil in argument to built-in println"
	switch nil {   // ERROR "use of untyped nil in switch expression"
	}
	_, _ = x, y
}
