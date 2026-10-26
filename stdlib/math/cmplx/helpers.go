//go:build gofront

//gofront:target both

package cmplx

import "math"

// sincos, asinh and atanh stand in for math.Sincos, math.Asinh and
// math.Atanh, which the math package does not provide yet.

const (
	asinhLn2   = 6.93147180559945286227e-01 // 0x3FE62E42FEFA39EF
	nearZero   = 1.0 / (1 << 28)            // 2**-28
	asinhLarge = 1 << 28                    // 2**28
)

func sincos(x float64) (s float64, c float64) {
	return math.Sin(x), math.Cos(x)
}

func asinh(x float64) float64 {
	// special cases
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	sign := false
	if x < 0 {
		x = -x
		sign = true
	}
	var temp float64
	switch {
	case x > asinhLarge:
		temp = math.Log(x) + asinhLn2 // |x| > 2**28
	case x > 2:
		temp = math.Log(2*x + 1/(math.Sqrt(x*x+1)+x)) // 2**28 > |x| > 2.0
	case x < nearZero:
		temp = x // |x| < 2**-28
	default:
		temp = math.Log1p(x + x*x/(1+math.Sqrt(1+x*x))) // 2.0 > |x| > 2**-28
	}
	if sign {
		temp = -temp
	}
	return temp
}
func atanh(x float64) float64 {
	// special cases
	switch {
	case x < -1 || x > 1 || math.IsNaN(x):
		return math.NaN()
	case x == 1:
		return math.Inf(1)
	case x == -1:
		return math.Inf(-1)
	}
	sign := false
	if x < 0 {
		x = -x
		sign = true
	}
	var temp float64
	switch {
	case x < nearZero:
		temp = x
	case x < 0.5:
		temp = x + x
		temp = 0.5 * math.Log1p(temp+temp*x/(1-x))
	default:
		temp = 0.5 * math.Log1p((x+x)/(1-x))
	}
	if sign {
		temp = -temp
	}
	return temp
}
