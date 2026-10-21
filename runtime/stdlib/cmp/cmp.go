//go:build gofront

//gofront:target both

// Package cmp provides types and functions related to comparing ordered
// values. Same API as Go's cmp package.
package cmp

// Ordered is a constraint that permits any ordered type: any type that
// supports the operators < <= >= >.
type Ordered interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
		~float32 | ~float64 |
		~string
}

// Less reports whether x is less than y. A NaN is less than any non-NaN,
// and -0.0 is not less than 0.0.
func Less[T Ordered](x, y T) bool {
	return (isNaNValue(x) && !isNaNValue(y)) || x < y
}

// Compare returns -1 if x is less than y, 0 if x equals y, and +1 if x is
// greater than y. A NaN is less than any non-NaN, a NaN equals a NaN, and
// -0.0 equals 0.0.
func Compare[T Ordered](x, y T) int {
	xNaN := isNaNValue(x)
	yNaN := isNaNValue(y)
	if xNaN {
		if yNaN {
			return 0
		}
		return -1
	}
	if yNaN {
		return +1
	}
	if x < y {
		return -1
	}
	if x > y {
		return +1
	}
	return 0
}

// isNaNValue reports whether x is a NaN without requiring the math package
// (named so it does not collide with the browser global isNaN until Task 0.9).
// This will always return false if T is not floating-point.
func isNaNValue[T Ordered](x T) bool {
	return x != x
}

// Or returns the first of its arguments that is not equal to the zero
// value. If no argument is non-zero, it returns the zero value.
func Or[T comparable](vals ...T) T {
	var zero T
	for _, v := range vals {
		if v != zero {
			return v
		}
	}
	return zero
}
