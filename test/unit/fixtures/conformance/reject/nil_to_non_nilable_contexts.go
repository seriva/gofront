// pending: assign-message-text
package main

type Level int
type P struct{ X int }
type Flags struct{ on bool }

func take(n int) {}

func give() float64 {
	return nil // ERROR "cannot use nil as float64 value in return statement"
}

func main() {
	var l Level = nil // ERROR "cannot use nil as Level value in variable declaration"
	var p P = nil // ERROR "cannot use nil as P value in variable declaration"
	var arr [2]int = nil // ERROR "cannot use nil as [2]int value in variable declaration"
	var b bool
	b = nil // ERROR "cannot use nil as bool value in assignment"
	take(nil) // ERROR "cannot use nil as int value in argument"
	f := Flags{on: nil} // ERROR "cannot use nil as bool value in struct literal"
	_, _, _, _, _ = l, p, arr, b, f
}
