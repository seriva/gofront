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

// Clamp keeps n within [lo, hi].
func Clamp(n int, lo int, hi int) int {
    return max(min(n, hi), lo)
}

// HasText reports whether s contains at least one non-whitespace character.
func HasText(s string) bool {
    for _, r := range s {
        if !unicode.IsSpace(r) {
            return true
        }
    }
    return false
}
