package main

func main() {
	{
		type Q int
		_ = Q(1)
	}
	var q Q // ERROR "Unknown type 'Q'"
	_ = q
}
