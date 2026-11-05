// Package math: constants, IEEE-754 bit access and the elementary functions.
//
// The bit-level functions are plain Go over Float64bits; the transcendental
// ones call the host's Math.* through intrinsics.  Functions marked
// //gofront:native keep their Go body as the specification and compile to a
// single host expression or instruction when natives are enabled.
package math

// Mathematical constants.
const (
	E       = 2.71828182845904523536028747135266249775724709369995957496696763
	Pi      = 3.14159265358979323846264338327950288419716939937510582097494459
	Phi     = 1.61803398874989484820458683436563811772030917980576286213544862
	Sqrt2   = 1.41421356237309504880168872420969807856967187537694807317667974
	SqrtE   = 1.64872127070012814684865078781416357165377610071014801157507931
	SqrtPi  = 1.77245385090551602729816748334114518279754945612238712821380779
	SqrtPhi = 1.27201964951406896425242246173749149171560804184009624861664038
	Ln2     = 0.693147180559945309417232121458176568075500134360255254120680009
	Log2E   = 1.44269504088896340735992468100189213742664595415298593413544940
	Ln10    = 2.30258509299404568401799145468436420760110148862877297603332790
	Log10E  = 0.43429448190325182765112891891660508229439700580366656611445378
)

// Floating-point limits.
const (
	MaxFloat32             = 3.40282346638528859811704183484516925440e+38
	SmallestNonzeroFloat32 = 1.401298464324817070923729583289916131280e-45
	MaxFloat64             = 1.79769313486231570814527423731704356798070e+308
	SmallestNonzeroFloat64 = 4.9406564584124654417656879286822137236505980e-324
)

// Integer limits.  MaxInt, MinInt and MaxUint are typed: `int` is 64 bits.
const (
	MaxInt    int = 1<<63 - 1
	MinInt    int = -1 << 63
	MaxInt8       = 1<<7 - 1
	MinInt8       = -1 << 7
	MaxInt16      = 1<<15 - 1
	MinInt16      = -1 << 15
	MaxInt32      = 1<<31 - 1
	MinInt32      = -1 << 31
	MaxInt64      = 1<<63 - 1
	MinInt64      = -1 << 63
	MaxUint   uint = 1<<64 - 1
	MaxUint8      = 1<<8 - 1
	MaxUint16     = 1<<16 - 1
	MaxUint32     = 1<<32 - 1
	MaxUint64     = 1<<64 - 1
)

const (
	uvnan    uint64 = 0x7FF8000000000001
	uvneginf uint64 = 0xFFF0000000000000
	uvone    uint64 = 0x3FF0000000000000
	halfShift uint64 = 1 << (shift - 1)
)

// ── IEEE-754 bit access ───────────────────────────────────────

// Float64bits returns the IEEE 754 binary representation of f.
//
//gofront:intrinsic math_float64bits
func Float64bits(f float64) uint64

// Float64frombits returns the float64 with binary representation b.
//
//gofront:intrinsic math_float64frombits
func Float64frombits(b uint64) float64

// Float32bits returns the IEEE 754 binary representation of f.
//
//gofront:intrinsic math_float32bits
func Float32bits(f float32) uint32

// Float32frombits returns the float32 with binary representation b.
//
//gofront:intrinsic math_float32frombits
func Float32frombits(b uint32) float32

// ── classification and sign ───────────────────────────────────

// IsNaN reports whether f is an IEEE 754 "not-a-number" value.
//
//gofront:native math.IsNaN
func IsNaN(f float64) (is bool) {
	return f != f
}

// IsInf reports whether f is an infinity, according to sign.
//
//gofront:native math.IsInf
func IsInf(f float64, sign int) bool {
	return sign >= 0 && f > MaxFloat64 || sign <= 0 && f < -MaxFloat64
}

// Inf returns positive infinity if sign >= 0, negative infinity if sign < 0.
//
//gofront:native math.Inf
func Inf(sign int) float64 {
	var v uint64
	if sign >= 0 {
		v = 0x7FF0000000000000
	} else {
		v = uvneginf
	}
	return Float64frombits(v)
}

// NaN returns an IEEE 754 "not-a-number" value.
//
//gofront:native math.NaN
func NaN() float64 { return Float64frombits(uvnan) }

// Signbit reports whether x is negative or negative zero.
//
//gofront:native math.Signbit
func Signbit(x float64) bool {
	return Float64bits(x)&(1<<63) != 0
}

// Copysign returns a value with the magnitude of f and the sign of sign.
//
//gofront:native math.Copysign
func Copysign(f, sign float64) float64 {
	const signBit = 1 << 63
	return Float64frombits(Float64bits(f)&^signBit | Float64bits(sign)&signBit)
}

// Abs returns the absolute value of x.
//
//gofront:native math.Abs
func Abs(x float64) float64 {
	return Float64frombits(Float64bits(x) &^ (1 << 63))
}

// Max returns the larger of x or y.
//
//gofront:native math.Max
func Max(x, y float64) float64 {
	switch {
	case IsInf(x, 1) || IsInf(y, 1):
		return Inf(1)
	case IsNaN(x) || IsNaN(y):
		return NaN()
	case x == 0 && x == y:
		if Signbit(x) {
			return y
		}
		return x
	}
	if x > y {
		return x
	}
	return y
}

// Min returns the smaller of x or y.
//
//gofront:native math.Min
func Min(x, y float64) float64 {
	switch {
	case IsInf(x, -1) || IsInf(y, -1):
		return Inf(-1)
	case IsNaN(x) || IsNaN(y):
		return NaN()
	case x == 0 && x == y:
		if Signbit(x) {
			return x
		}
		return y
	}
	if x < y {
		return x
	}
	return y
}

// Dim returns the maximum of x-y or 0.
func Dim(x, y float64) float64 {
	v := x - y
	if v <= 0 {
		return 0
	}
	return v
}

// ── rounding ──────────────────────────────────────────────────

// Modf returns integer and fractional floating-point numbers that sum to f.
func Modf(f float64) (int float64, frac float64) {
	if f < 1 {
		switch {
		case f < 0:
			int, frac = Modf(-f)
			return -int, -frac
		case f == 0:
			return f, f
		}
		return 0, f
	}
	x := Float64bits(f)
	e := uint(x>>shift)&mask - bias
	if e < 64-12 {
		x &^= 1<<(64-12-e) - 1
	}
	int = Float64frombits(x)
	frac = f - int
	return
}

// Trunc returns the integer value of x.
//
//gofront:native math.Trunc
func Trunc(x float64) float64 {
	if x == 0 || IsNaN(x) || IsInf(x, 0) {
		return x
	}
	d, _ := Modf(x)
	return d
}

// Floor returns the greatest integer value less than or equal to x.
//
//gofront:native math.Floor
func Floor(x float64) float64 {
	if x == 0 || IsNaN(x) || IsInf(x, 0) {
		return x
	}
	if x < 0 {
		d, fract := Modf(-x)
		if fract != 0.0 {
			d = d + 1
		}
		return -d
	}
	d, _ := Modf(x)
	return d
}

// Ceil returns the least integer value greater than or equal to x.
//
//gofront:native math.Ceil
func Ceil(x float64) float64 {
	return -Floor(-x)
}

// Round returns the nearest integer, rounding half away from zero.
//
//gofront:native math.Round
func Round(x float64) float64 {
	bits := Float64bits(x)
	e := uint(bits>>shift) & mask
	if e < bias {
		bits &= signMask
		if e == bias-1 {
			bits |= uvone
		}
	} else if e < bias+shift {
		e -= bias
		bits += halfShift >> e
		bits &^= fracMask >> e
	}
	return Float64frombits(bits)
}

// Remainder returns the IEEE 754 floating-point remainder of x/y.
func Remainder(x, y float64) float64 {
	const (
		Tiny    = 4.45014771701440276618e-308
		HalfMax = MaxFloat64 / 2
	)
	switch {
	case IsNaN(x) || IsNaN(y) || IsInf(x, 0) || y == 0:
		return NaN()
	case IsInf(y, 0):
		return x
	}
	sign := false
	if x < 0 {
		x = -x
		sign = true
	}
	if y < 0 {
		y = -y
	}
	if x == y {
		if sign {
			return Copysign(0, -1)
		}
		return 0
	}
	if y <= HalfMax {
		x = Mod(x, y+y)
	}
	if y < Tiny {
		if x+x > y {
			x -= y
			if x+x >= y {
				x -= y
			}
		}
	} else {
		yHalf := 0.5 * y
		if x > yHalf {
			x -= y
			if x >= yHalf {
				x -= y
			}
		}
	}
	if sign {
		x = -x
	}
	return x
}

// ── square root ───────────────────────────────────────────────

// Sqrt returns the square root of x.
//
//gofront:native math.Sqrt
func Sqrt(x float64) float64 {
	switch {
	case x == 0 || IsNaN(x) || IsInf(x, 1):
		return x
	case x < 0:
		return NaN()
	}
	ix := Float64bits(x)
	exp := int((ix >> shift) & mask)
	if exp == 0 {
		for ix&(1<<shift) == 0 {
			ix <<= 1
			exp--
		}
		exp++
	}
	exp -= bias
	ix &^= mask << shift
	ix |= 1 << shift
	if exp&1 == 1 {
		ix <<= 1
	}
	exp >>= 1
	ix <<= 1
	var q, s uint64
	r := uint64(1 << (shift + 1))
	for r != 0 {
		t := s + r
		if t <= ix {
			s = t + r
			ix -= t
			q += r
		}
		ix <<= 1
		r >>= 1
	}
	if ix != 0 {
		q += q & 1
	}
	ix = q>>1 + uint64(exp-1+bias)<<shift
	return Float64frombits(ix)
}

// Exp2 returns 2**x.
func Exp2(x float64) float64 { return Pow(2, x) }

// ── host functions ────────────────────────────────────────────
//
// Each is the host's Math.* of the same name; Mod is JavaScript's `%`.

//gofront:intrinsic math_sin
func Sin(x float64) float64

//gofront:intrinsic math_cos
func Cos(x float64) float64

//gofront:intrinsic math_tan
func Tan(x float64) float64

//gofront:intrinsic math_asin
func Asin(x float64) float64

//gofront:intrinsic math_acos
func Acos(x float64) float64

//gofront:intrinsic math_atan
func Atan(x float64) float64

//gofront:intrinsic math_atan2
func Atan2(y, x float64) float64

//gofront:intrinsic math_sinh
func Sinh(x float64) float64

//gofront:intrinsic math_cosh
func Cosh(x float64) float64

//gofront:intrinsic math_tanh
func Tanh(x float64) float64

//gofront:intrinsic math_exp
func Exp(x float64) float64

//gofront:intrinsic math_expm1
func Expm1(x float64) float64

//gofront:intrinsic math_log
func Log(x float64) float64

//gofront:intrinsic math_log1p
func Log1p(x float64) float64

//gofront:intrinsic math_log2
func Log2(x float64) float64

//gofront:intrinsic math_log10
func Log10(x float64) float64

//gofront:intrinsic math_cbrt
func Cbrt(x float64) float64

//gofront:intrinsic math_pow
func hostPow(x, y float64) float64

// Pow returns x**y.  JavaScript's Math.pow gives NaN for 1 and -1 to an
// infinite or NaN power where Go gives 1.
func Pow(x, y float64) float64 {
	if x == 1 || x == -1 && IsInf(y, 0) {
		return 1
	}
	return hostPow(x, y)
}

//gofront:intrinsic math_hypot
func Hypot(p, q float64) float64

//gofront:intrinsic math_mod
func Mod(x, y float64) float64
