package main

import (
	"fmt"
	"math"
	"math/cmplx"
)

func main() {
	zs := []complex128{
		complex(3, 4),
		complex(-1.5, 2.25),
		complex(0.5, -0.75),
		complex(2, 0),
		complex(0, 1),
		complex(-2, -3),
	}
	for _, z := range zs {
		fmt.Printf("z=%.6g\n", z)
		fmt.Printf("  Abs=%.6g Phase=%.6g Conj=%.6g\n", cmplx.Abs(z), cmplx.Phase(z), cmplx.Conj(z))
		r, th := cmplx.Polar(z)
		fmt.Printf("  Polar=%.6g,%.6g Rect=%.6g\n", r, th, cmplx.Rect(r, th))
		fmt.Printf("  Exp=%.6g Log=%.6g Log10=%.6g Sqrt=%.6g\n", cmplx.Exp(z), cmplx.Log(z), cmplx.Log10(z), cmplx.Sqrt(z))
		fmt.Printf("  Sin=%.6g Cos=%.6g Tan=%.6g Cot=%.6g\n", cmplx.Sin(z), cmplx.Cos(z), cmplx.Tan(z), cmplx.Cot(z))
		fmt.Printf("  Sinh=%.6g Cosh=%.6g Tanh=%.6g\n", cmplx.Sinh(z), cmplx.Cosh(z), cmplx.Tanh(z))
		fmt.Printf("  Asin=%.6g Acos=%.6g Atan=%.6g\n", cmplx.Asin(z), cmplx.Acos(z), cmplx.Atan(z))
		fmt.Printf("  Asinh=%.6g Acosh=%.6g Atanh=%.6g\n", cmplx.Asinh(z), cmplx.Acosh(z), cmplx.Atanh(z))
		fmt.Printf("  Pow(z,2)=%.6g Pow(z,0.5)=%.6g\n", cmplx.Pow(z, complex(2, 0)), cmplx.Pow(z, complex(0.5, 0)))
	}
	fmt.Println(cmplx.IsInf(cmplx.Inf()), cmplx.IsNaN(cmplx.NaN()), cmplx.IsNaN(complex(1, 2)), cmplx.IsInf(complex(1, 2)))
	fmt.Println(cmplx.IsInf(complex(math.Inf(-1), math.NaN())), cmplx.IsNaN(complex(math.Inf(1), math.NaN())))
	fmt.Printf("%.6g %.6g\n", cmplx.Pow(complex(0, 0), complex(0, 0)), cmplx.Pow(complex(0, 0), complex(2, 0)))
}
