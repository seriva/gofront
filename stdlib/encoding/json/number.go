//go:build gofront

//gofront:target both

package json

import (
	"strconv"
)

// A Number represents a JSON number literal.
type Number string

// String returns the literal text of the number.
func (n Number) String() string { return string(n) }

// Float64 returns the number as a float64.
func (n Number) Float64() (float64, error) {
	v, err := strconv.ParseFloat(string(n), 64)
	return v, err
}

// Int64 returns the number as an int64.
func (n Number) Int64() (int64, error) {
	v, err := strconv.ParseInt(string(n), 10, 64)
	return v, err
}
