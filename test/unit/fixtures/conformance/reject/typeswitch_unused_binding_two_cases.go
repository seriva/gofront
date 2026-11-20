package main

func main() {
	var v any = 1
	switch x := v.(type) { // ERROR "x' declared and not used"
	case int:
	case string:
	default:
	}
}
