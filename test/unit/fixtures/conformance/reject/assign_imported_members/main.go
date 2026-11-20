package main

import "./sub"

func main() {
	sub.Fn = nil        // ERROR "cannot assign to sub.Fn (neither addressable nor a map index expression)"
	_ = &sub.Fn         // ERROR "cannot take address of sub.Fn"
	sub.Box = sub.Box{} // ERROR "cannot assign to sub.Box (neither addressable nor a map index expression)"
	_ = &sub.Box        // ERROR "cannot take address of sub.Box"
	sub.C = 2           // ERROR "cannot assign to sub.C (neither addressable nor a map index expression)"
}
