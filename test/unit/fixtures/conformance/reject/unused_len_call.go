package main

func main() {
	s := []int{1}
	len(s) // ERROR "len(s) (value of type int) is not used"
}
