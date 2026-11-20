package main

func main() {
	var v any = 1
	switch _ := v.(type) { // ERROR "no new variable on left side of :="
	case int:
	}
}
