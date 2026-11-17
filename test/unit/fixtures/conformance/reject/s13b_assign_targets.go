package main

type P struct{ X int }
type Grid struct{ cells [2]int }

func (g *Grid) Set(i int) { g.cells[0] = i }

func mk() Grid { return Grid{} }

func main() {
	s := "abc"
	s[1]++ // ERROR "cannot assign to s[1] (neither addressable nor a map index expression)"
	s[0] += 'x' // ERROR "cannot assign to s[0] (neither addressable nor a map index expression)"
	m := map[string]P{"a": {1}}
	m["a"].X++ // ERROR "cannot assign to struct field m[\"a\"].X in map"
	m["a"].X += 2 // ERROR "cannot assign to struct field m[\"a\"].X in map"
	mg := map[string]Grid{}
	mg["a"].cells[0] = 1 // ERROR "cannot assign to mg[\"a\"].cells[0] (neither addressable nor a map index expression)"
	Grid{}.Set(1) // ERROR "cannot call pointer method Set on Grid"
}
