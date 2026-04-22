package main

func sumPoints(pts []Point) int {
    total := 0
    for _, p := range pts {
        total += p.X + p.Y
    }
    return total
}

func main() {
    p := newPoint(3, 4)
    pts := []Point{p, {X: 1, Y: 2}}
    println(sumPoints(pts))
}
