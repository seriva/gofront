package main

import (
	"fmt"
	"math"
)

func main() {
	// Log1p, Expm1
	fmt.Printf("%.6f %.6f\n", math.Log1p(0.5), math.Log1p(0.0))
	fmt.Printf("%.6f %.6f\n", math.Expm1(0.5), math.Expm1(0.0))

	// Frexp, Ldexp
	frac, exp := math.Frexp(8.0)
	fmt.Printf("%.4f %d\n", frac, exp)
	frac, exp = math.Frexp(0.0)
	fmt.Printf("%.4f %d\n", frac, exp)
	fmt.Printf("%.4f\n", math.Ldexp(0.5, 4))
	fmt.Printf("%.4f\n", math.Ldexp(0.75, 2))

	// Modf
	i, f := math.Modf(3.25)
	fmt.Printf("%.2f %.2f\n", i, f)
	i, f = math.Modf(-3.25)
	fmt.Printf("%.2f %.2f\n", i, f)

	// FMA
	fmt.Printf("%.4f\n", math.FMA(2.0, 3.0, 4.0))
	fmt.Printf("%.4f\n", math.FMA(1.5, -2.0, 5.0))

	// RoundToEven
	fmt.Println(math.RoundToEven(0.5), math.RoundToEven(1.5), math.RoundToEven(2.5), math.RoundToEven(3.5))
	fmt.Println(math.RoundToEven(-0.5), math.RoundToEven(-1.5), math.RoundToEven(-2.5))

	// Nextafter, Nextafter32
	fmt.Println(math.Nextafter(1.0, 2.0) > 1.0)
	fmt.Println(math.Nextafter(1.0, 0.0) < 1.0)
	fmt.Println(math.Nextafter32(1.0, 2.0) > 1.0)
	fmt.Println(math.Nextafter32(1.0, 0.0) < 1.0)

	// Gamma, Erf
	fmt.Printf("%.6f %.6f %.6f\n", math.Gamma(1.0), math.Gamma(2.0), math.Gamma(5.0))
	fmt.Printf("%.6f %.6f %.6f\n", math.Erf(0.0), math.Erf(0.5), math.Erf(1.0))
}
