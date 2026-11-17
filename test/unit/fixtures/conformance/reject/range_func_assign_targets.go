package main

type P struct{ X int }

func mk() P { return P{} }

func seq(yield func(int) bool)  { yield(1) }
func bseq(yield func(byte) bool) { yield(1) }

func main() {
	for mk().X = range seq { // ERROR "cannot assign to mk().X (neither addressable nor a map index expression)"
	}
	const k int = 1
	for k = range seq { // ERROR "cannot assign to k (neither addressable nor a map index expression)"
	}
	m := map[string]P{}
	for m["a"].X = range seq { // ERROR "cannot assign to struct field m[\"a\"].X in map"
	}
	s := "hi"
	for s[0] = range bseq { // ERROR "cannot assign to s[0] (neither addressable nor a map index expression)"
	}
}
