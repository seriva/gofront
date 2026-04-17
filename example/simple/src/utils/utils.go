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

// HasText reports whether s contains at least one non-whitespace character.
func HasText(s string) bool {
    return strings.TrimSpace(s) != ""
}

// Filter returns a new slice containing only elements that satisfy pred.
func Filter[T any](items []T, pred func(T) bool) []T {
    var out []T
    for _, item := range items {
        if pred(item) {
            out = append(out, item)
        }
    }
    return out
}

// Map transforms each element of a slice using the given function.
func Map[T any, U any](items []T, f func(T) U) []U {
    var out []U
    for _, item := range items {
        out = append(out, f(item))
    }
    return out
}
