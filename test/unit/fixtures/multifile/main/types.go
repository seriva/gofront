package main

type Point struct {
    X int
    Y int
}

func newPoint(x int, y int) Point {
    return Point{X: x, Y: y}
}
