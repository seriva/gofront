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
