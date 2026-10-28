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
