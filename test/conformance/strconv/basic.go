package main

import (
	"fmt"
	"strconv"
)

func main() {
	fmt.Println(strconv.Itoa(-42), strconv.Itoa(0))
	n, err := strconv.Atoi("123")
	fmt.Println(n, err)
	_, err = strconv.Atoi("12a")
	fmt.Println(err)
	i, err := strconv.ParseInt("-ff", 16, 64)
	fmt.Println(i, err)
	b, err := strconv.ParseBool("true")
	fmt.Println(b, err)
	fmt.Println(strconv.FormatInt(255, 2), strconv.FormatInt(-255, 16))
	fmt.Println(strconv.FormatBool(false))
	fmt.Println(strconv.Quote("tab\there"))
	f, err := strconv.ParseFloat("3.25", 64)
	fmt.Println(f, err)
}
