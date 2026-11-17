package main

func few() (int, string) {
	return 1 // ERROR "not enough return values"
}

func none() {
	return 1 // ERROR "too many return values"
}

func many() (int, error) {
	return 1, nil, 3 // ERROR "too many return values"
}

func main() {
	_, _ = few()
	none()
	_, _ = many()
}
