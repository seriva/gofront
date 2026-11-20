package main

const k = 1

func main() {
	k++ // ERROR "cannot assign to k (neither addressable nor a map index expression)"
	k-- // ERROR "cannot assign to k (neither addressable nor a map index expression)"
	k = 2 // ERROR "cannot assign to k (neither addressable nor a map index expression)"
	k += 2 // ERROR "cannot assign to k (neither addressable nor a map index expression)"
}
