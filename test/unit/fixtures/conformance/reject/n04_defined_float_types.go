// pending: S5
package main

type Meters float64
type Feet float64

func main() {
	var m Meters = 1
	var f Feet = 2
	_ = m + f // ERROR "mismatched types Meters and Feet"
}
