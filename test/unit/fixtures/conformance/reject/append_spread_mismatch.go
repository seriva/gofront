// pending: assign-message-text
package main

func main() {
	a := []int{1}
	b := []string{"x"}
	_ = append(a, b...) // ERROR "cannot use b (variable of type []string) as []int value in argument to append"
}
