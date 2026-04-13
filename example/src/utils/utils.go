package utils

// Plural formats a count with the correct singular/plural noun.
//   Plural(1, "task") → "1 task"
//   Plural(3, "task") → "3 tasks"
func Plural(n int, word string) string {
    if n == 1 {
        return String(n) + " " + word
    }
    return String(n) + " " + word + "s"
}

// Max returns the larger of two ints.
func Max(a int, b int) int {
    if a > b {
        return a
    }
    return b
}

// Clamp keeps n within [lo, hi].
func Clamp(n int, lo int, hi int) int {
    if n < lo {
        return lo
    }
    if n > hi {
        return hi
    }
    return n
}
