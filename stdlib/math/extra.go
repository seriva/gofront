package math

import "math/bits"

const (
	mask           = 0x7FF
	shift          = 52
	bias           = 1023
	signMask       uint64 = 1 << 63
	fracMask       uint64 = 1<<52 - 1
	maskShift      uint64 = 0x7FF0000000000000
	biasShift      uint64 = 0x3FE0000000000000
	SmallestNormal        = 2.2250738585072014e-308
	halfMinusULP   uint64 = (1 << (52 - 1)) - 1
	uvinf          uint64 = 0x7FF0000000000000
	SqrtTwoPi             = 2.506628274631000502417
	MaxStirling           = 143.01608
	Euler                 = 0.57721566490153286060651209008240243104215933593992
	VeryTiny              = 2.848094538889218e-306
	Small                 = 1.0 / (1 << 28)
)

func normalize(x float64) (y float64, exp int) {
	if Abs(x) < SmallestNormal {
		return x * (1 << 52), -52
	}
	return x, 0
}

func Frexp(f float64) (frac float64, exp int) {
	switch {
	case f == 0:
		return f, 0
	case IsInf(f, 0) || IsNaN(f):
		return f, 0
	}
	f, exp = normalize(f)
	x := Float64bits(f)
	exp += int((x>>shift)&mask) - bias + 1
	x = x &^ maskShift
	x |= biasShift
	frac = Float64frombits(x)
	return
}

func Ldexp(frac float64, exp int) float64 {
	switch {
	case frac == 0:
		return frac
	case IsInf(frac, 0) || IsNaN(frac):
		return frac
	}
	f, e := normalize(frac)
	exp += e
	x := Float64bits(f)
	exp += int(x>>shift)&mask - bias
	if exp < -1075 {
		return Copysign(0, f)
	}
	if exp > 1023 {
		if f < 0 {
			return Inf(-1)
		}
		return Inf(1)
	}
	var m float64 = 1
	if exp < -1022 {
		exp += 53
		m = 1.0 / (1 << 53)
	}
	x = x &^ maskShift
	x |= uint64(exp+bias) << 52
	return m * Float64frombits(x)
}

func Modf(f float64) (int float64, frac float64) {
	if IsInf(f, 0) {
		return f, NaN()
	}
	if IsNaN(f) {
		return NaN(), NaN()
	}
	int = Trunc(f)
	frac = Copysign(f-int, f)
	return
}

func RoundToEven(x float64) float64 {
	b := Float64bits(x)
	e := uint(b>>shift) & mask
	if e >= bias {
		e -= bias
		b += (halfMinusULP + (b>>(shift-e))&1) >> e
		b = b &^ (fracMask >> e)
	} else if e == bias-1 && b&fracMask != 0 {
		b = b&signMask | 0x3FF0000000000000
	} else {
		b &= signMask
	}
	return Float64frombits(b)
}

func Nextafter32(x, y float32) (r float32) {
	switch {
	case IsNaN(float64(x)) || IsNaN(float64(y)):
		r = float32(NaN())
	case x == y:
		r = x
	case x == 0:
		r = float32(Copysign(float64(Float32frombits(1)), float64(y)))
	case (y > x) == (x > 0):
		r = Float32frombits(Float32bits(x) + 1)
	default:
		r = Float32frombits(Float32bits(x) - 1)
	}
	return
}

func Nextafter(x, y float64) (r float64) {
	switch {
	case IsNaN(x) || IsNaN(y):
		r = NaN()
	case x == y:
		r = x
	case x == 0:
		r = Copysign(Float64frombits(1), y)
	case (y > x) == (x > 0):
		r = Float64frombits(Float64bits(x) + 1)
	default:
		r = Float64frombits(Float64bits(x) - 1)
	}
	return
}

// --- FMA ---

func fmaZero(x uint64) uint64 {
	if x == 0 {
		return 1
	}
	return 0
}

func fmaNonzero(x uint64) uint64 {
	if x != 0 {
		return 1
	}
	return 0
}

func fmaShl(u1, u2 uint64, n uint) (r1 uint64, r2 uint64) {
	r1 = u1<<n | u2>>(64-n) | u2<<(n-64)
	r2 = u2 << n
	return
}

func fmaShr(u1, u2 uint64, n uint) (r1 uint64, r2 uint64) {
	r2 = u2>>n | u1<<(64-n) | u1>>(n-64)
	r1 = u1 >> n
	return
}

func fmaShrcompress(u1, u2 uint64, n uint) (r1 uint64, r2 uint64) {
	switch {
	case n == 0:
		return u1, u2
	case n == 64:
		return 0, u1 | fmaNonzero(u2)
	case n >= 128:
		return 0, fmaNonzero(u1 | u2)
	case n < 64:
		r1, r2 = fmaShr(u1, u2, n)
		r2 |= fmaNonzero(u2 & (1<<n - 1))
	case n < 128:
		r1, r2 = fmaShr(u1, u2, n)
		r2 |= fmaNonzero(u1&(1<<(n-64)-1) | u2)
	}
	return
}

func fmaLz(u1, u2 uint64) (l int32) {
	l = int32(bits.LeadingZeros64(u1))
	if l == 64 {
		l += int32(bits.LeadingZeros64(u2))
	}
	return l
}

func fmaSplit(b uint64) (sign uint32, exp int32, mantissa uint64) {
	sign = uint32(b >> 63)
	exp = int32(b>>52) & mask
	mantissa = b & fracMask
	if exp == 0 {
		shift := uint(bits.LeadingZeros64(mantissa) - 11)
		mantissa <<= shift
		exp = 1 - int32(shift)
	} else {
		mantissa |= 1 << 52
	}
	return
}

func fmaSpecial(x, y, z float64, bx, by, bz uint64) (float64, bool) {
	if x == 0.0 || y == 0.0 || bx&uvinf == uvinf || by&uvinf == uvinf {
		return x*y + z, true
	}
	if z == 0.0 {
		return x * y, true
	}
	if bz&uvinf == uvinf {
		return z, true
	}
	return 0, false
}

func fmaRound(ps uint32, pe int32, m uint64) float64 {
	if pe > 1022+bias || pe == 1022+bias && (m+1<<9)>>63 == 1 {
		return Float64frombits(uint64(ps)<<63 | uvinf)
	}
	if pe < 0 {
		n := uint(-pe)
		m = m>>n | fmaNonzero(m&(1<<n-1))
		pe = 0
	}
	m = ((m + 1<<9) >> 10) & ^fmaZero((m&(1<<10-1))^1<<9)
	pe &= -int32(fmaNonzero(m))
	return Float64frombits(uint64(ps)<<63 + uint64(pe)<<52 + m)
}

func FMA(x, y, z float64) float64 {
	bx, by, bz := Float64bits(x), Float64bits(y), Float64bits(z)
	if val, ok := fmaSpecial(x, y, z, bx, by, bz); ok {
		return val
	}

	xs, xe, xm := fmaSplit(bx)
	ys, ye, ym := fmaSplit(by)
	zs, ze, zm := fmaSplit(bz)

	pe := xe + ye - bias + 1
	pm1, pm2 := bits.Mul64(xm<<10, ym<<11)
	zm1, zm2 := zm<<10, uint64(0)
	ps := xs ^ ys

	is62zero := uint((^pm1 >> 62) & 1)
	pm1, pm2 = fmaShl(pm1, pm2, is62zero)
	pe -= int32(is62zero)

	if pe < ze || pe == ze && pm1 < zm1 {
		ps, pe, pm1, pm2, zs, ze, zm1, zm2 = zs, ze, zm1, zm2, ps, pe, pm1, pm2
	}

	if ps != zs && pe == ze && pm1 == zm1 && pm2 == zm2 {
		return 0
	}

	zm1, zm2 = fmaShrcompress(zm1, zm2, uint(pe-ze))

	var m, c uint64
	if ps == zs {
		pm2, c = bits.Add64(pm2, zm2, 0)
		pm1, _ = bits.Add64(pm1, zm1, c)
		pe -= int32(^pm1 >> 63)
		pm1, m = fmaShrcompress(pm1, pm2, uint(64+pm1>>63))
	} else {
		pm2, c = bits.Sub64(pm2, zm2, 0)
		pm1, _ = bits.Sub64(pm1, zm1, c)
		nz := fmaLz(pm1, pm2)
		pe -= nz
		m, pm2 = fmaShl(pm1, pm2, uint(nz-1))
		m |= fmaNonzero(pm2)
	}

	return fmaRound(ps, pe, m)
}

// --- Gamma ---

var _gamP = [...]float64{
	1.60119522476751861407e-04,
	1.19135147006586384913e-03,
	1.04213797561761569935e-02,
	4.76367800457137231464e-02,
	2.07448227648435975150e-01,
	4.94214826801497100753e-01,
	9.99999999999999996796e-01,
}
var _gamQ = [...]float64{
	-2.31581873324120129819e-05,
	5.39605580493303397842e-04,
	-4.45641913851797240494e-03,
	1.18139785222060435552e-02,
	3.58236398605498653373e-02,
	-2.34591795718243348568e-01,
	7.14304917030273074085e-02,
	1.00000000000000000320e+00,
}
var _gamS = [...]float64{
	7.87311395793093628397e-04,
	-2.29549961613378126380e-04,
	-2.68132617805781232825e-03,
	3.47222221605458667310e-03,
	8.33333333333482257126e-02,
}

func stirling(x float64) (float64, float64) {
	if x > 200 {
		return Inf(1), 1
	}
	w := 1 / x
	w = 1 + w*((((_gamS[0]*w+_gamS[1])*w+_gamS[2])*w+_gamS[3])*w+_gamS[4])
	y1 := Exp(x)
	y2 := 1.0
	if x > MaxStirling {
		v := Pow(x, 0.5*x-0.25)
		y1, y2 = v, v/y1
	} else {
		y1 = Pow(x, x-0.5) / y1
	}
	return y1, SqrtTwoPi * w * y2
}

func gammaSmall(x, z float64) float64 {
	if x == 0 {
		return Inf(1)
	}
	return z / ((1 + Euler*x) * x)
}

func gammaSpecial(x float64) (float64, bool) {
	switch {
	case isNegInt(x) || IsInf(x, -1) || IsNaN(x):
		return NaN(), true
	case IsInf(x, 1):
		return Inf(1), true
	case x == 0:
		if Signbit(x) {
			return Inf(-1), true
		}
		return Inf(1), true
	}
	return 0, false
}

func gammaNegLarge(q, p float64) float64 {
	signgam := 1
	if ip := int64(p); ip&1 == 0 {
		signgam = -1
	}
	z := q - p
	if z > 0.5 {
		p = p + 1
		z = q - p
	}
	z = q * Sin(Pi*z)
	if z == 0 {
		return Inf(signgam)
	}
	sq1, sq2 := stirling(q)
	absz := Abs(z)
	d := absz * sq1 * sq2
	if IsInf(d, 0) {
		z = Pi / absz / sq1 / sq2
	} else {
		z = Pi / d
	}
	return float64(signgam) * z
}

func Gamma(x float64) float64 {
	if val, ok := gammaSpecial(x); ok {
		return val
	}
	q := Abs(x)
	p := Floor(q)
	if q > 33 {
		if x >= 0 {
			y1, y2 := stirling(x)
			return y1 * y2
		}
		return gammaNegLarge(q, p)
	}

	z := 1.0
	for x >= 3 {
		x = x - 1
		z = z * x
	}
	for x < 0 {
		if x > -1e-09 {
			return gammaSmall(x, z)
		}
		z = z / x
		x = x + 1
	}
	for x < 2 {
		if x < 1e-09 {
			return gammaSmall(x, z)
		}
		z = z / x
		x = x + 1
	}

	if x == 2 {
		return z
	}

	x = x - 2
	p = (((((x*_gamP[0]+_gamP[1])*x+_gamP[2])*x+_gamP[3])*x+_gamP[4])*x+_gamP[5])*x + _gamP[6]
	q = ((((((x*_gamQ[0]+_gamQ[1])*x+_gamQ[2])*x+_gamQ[3])*x+_gamQ[4])*x+_gamQ[5])*x+_gamQ[6])*x + _gamQ[7]
	return z * p / q
}

func isNegInt(x float64) bool {
	if x < 0 {
		_, xf := Modf(x)
		return xf == 0
	}
	return false
}

// --- Erf ---

const (
	erx  = 8.45062911510467529297e-01
	efx  = 1.28379167095512586316e-01
	efx8 = 1.02703333676410069053e+00
	pp0  = 1.28379167095512558561e-01
	pp1  = -3.25042107247001499370e-01
	pp2  = -2.84817495755985104766e-02
	pp3  = -5.77027029648944159157e-03
	pp4  = -2.37630166566501626084e-05
	qq1  = 3.97917223959155352819e-01
	qq2  = 6.50222499887672944485e-02
	qq3  = 5.08130628187576562776e-03
	qq4  = 1.32494738004321644526e-04
	qq5  = -3.96022827877536812320e-06
	pa0  = -2.36211856075265944077e-03
	pa1  = 4.14856118683748331666e-01
	pa2  = -3.72207876035701323847e-01
	pa3  = 3.18346619901161753674e-01
	pa4  = -1.10894694282396677476e-01
	pa5  = 3.54783043256182359371e-02
	pa6  = -2.16637559486879084300e-03
	qa1  = 1.06420880400844228286e-01
	qa2  = 5.40397917702171048937e-01
	qa3  = 7.18286544141962662868e-02
	qa4  = 1.26171219808761642112e-01
	qa5  = 1.36370839120290507362e-02
	qa6  = 1.19844998467991074170e-02
	ra0  = -9.86494403484714822705e-03
	ra1  = -6.93858572707181764372e-01
	ra2  = -1.05586262253232909814e+01
	ra3  = -6.23753324503260060396e+01
	ra4  = -1.62396669462573470355e+02
	ra5  = -1.84605092906711035994e+02
	ra6  = -8.12874355063065934246e+01
	ra7  = -9.81432934416914548592e+00
	sa1  = 1.96512716674392571292e+01
	sa2  = 1.37657754143519042600e+02
	sa3  = 4.34565877475229228821e+02
	sa4  = 6.45387271733267880336e+02
	sa5  = 4.29008140027567833386e+02
	sa6  = 1.08635005541779435134e+02
	sa7  = 6.57024977031928170135e+00
	sa8  = -6.04244152148580987438e-02
	rb0  = -9.86494292470009928597e-03
	rb1  = -7.99283237680523006574e-01
	rb2  = -1.77579549177547519889e+01
	rb3  = -1.60636384855821916062e+02
	rb4  = -6.37566443368389627722e+02
	rb5  = -1.02509513161107724954e+03
	rb6  = -4.83519191608651397019e+02
	sb1  = 3.03380607434824582924e+01
	sb2  = 3.25792512996573918826e+02
	sb3  = 1.53672958608443695994e+03
	sb4  = 3.19985821950859553908e+03
	sb5  = 2.55305040643316442583e+03
	sb6  = 4.74528541206955367215e+02
	sb7  = -2.24409524465858183362e+01
)

func Erf(x float64) float64 {
	switch {
	case IsNaN(x):
		return NaN()
	case IsInf(x, 1):
		return 1
	case IsInf(x, -1):
		return -1
	}
	sign := false
	if x < 0 {
		x = -x
		sign = true
	}
	if x < 0.84375 {
		var temp float64
		if x < Small {
			if x < VeryTiny {
				temp = 0.125 * (8.0*x + efx8*x)
			} else {
				temp = x + efx*x
			}
		} else {
			z := x * x
			r := pp0 + z*(pp1+z*(pp2+z*(pp3+z*pp4)))
			s := 1 + z*(qq1+z*(qq2+z*(qq3+z*(qq4+z*qq5))))
			y := r / s
			temp = x + x*y
		}
		if sign {
			return -temp
		}
		return temp
	}
	if x < 1.25 {
		s := x - 1
		P := pa0 + s*(pa1+s*(pa2+s*(pa3+s*(pa4+s*(pa5+s*pa6)))))
		Q := 1 + s*(qa1+s*(qa2+s*(qa3+s*(qa4+s*(qa5+s*qa6)))))
		if sign {
			return -erx - P/Q
		}
		return erx + P/Q
	}
	if x >= 6 {
		if sign {
			return -1
		}
		return 1
	}
	s := 1 / (x * x)
	var R, S float64
	if x < 1/0.35 {
		R = ra0 + s*(ra1+s*(ra2+s*(ra3+s*(ra4+s*(ra5+s*(ra6+s*ra7))))))
		S = 1 + s*(sa1+s*(sa2+s*(sa3+s*(sa4+s*(sa5+s*(sa6+s*(sa7+s*sa8)))))))
	} else {
		R = rb0 + s*(rb1+s*(rb2+s*(rb3+s*(rb4+s*(rb5+s*rb6)))))
		S = 1 + s*(sb1+s*(sb2+s*(sb3+s*(sb4+s*(sb5+s*(sb6+s*sb7))))))
	}
	z := Float64frombits(Float64bits(x) & 0xffffffff00000000)
	r := Exp(-z*z-0.5625) * Exp((z-x)*(z+x)+R/S)
	if sign {
		return r/x - 1
	}
	return 1 - r/x
}
