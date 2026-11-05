//go:build gofront

//gofront:target both

// Package strconv implements conversions to and from string representations
// of basic data types, written in Go over the real package's algorithms.
// Float formatting and parsing keep a host fast path as natives.
package strconv

import (
	"errors"
	"math/bits"
)

// IntSize is the size in bits of an int or uint value.
const IntSize = 64

const maxUint64 = 1<<64 - 1

// ErrRange indicates that a value is out of range for the target type.
var ErrRange = errors.New("value out of range")

// ErrSyntax indicates that a value does not have the right syntax for the target type.
var ErrSyntax = errors.New("invalid syntax")

// A NumError records a failed conversion.
type NumError struct {
	Func string // the failing function (ParseBool, ParseInt, ParseUint, ParseFloat, ParseComplex)
	Num  string // the input
	Err  error  // the reason the conversion failed (e.g. ErrRange, ErrSyntax, etc.)
}

func (e *NumError) Error() string {
	return "strconv." + e.Func + ": " + "parsing " + Quote(e.Num) + ": " + e.Err.Error()
}

func (e *NumError) Unwrap() error { return e.Err }

func syntaxError(fn, str string) *NumError {
	return &NumError{fn, str, ErrSyntax}
}

func rangeError(fn, str string) *NumError {
	return &NumError{fn, str, ErrRange}
}

func baseError(fn, str string, base int) *NumError {
	return &NumError{fn, str, errors.New("invalid base " + Itoa(base))}
}

func bitSizeError(fn, str string, bitSize int) *NumError {
	return &NumError{fn, str, errors.New("invalid bit size " + Itoa(bitSize))}
}

// The parsers report one of these codes; toError turns it into the
// *NumError the package's API promises.
type parseCode int

const (
	codeNone parseCode = iota
	codeRange
	codeSyntax
	codeBase
	codeBitSize
)

func toError(fn, s string, base, bitSize int, code parseCode) error {
	switch code {
	case codeNone:
		return nil
	case codeSyntax:
		return syntaxError(fn, s)
	case codeRange:
		return rangeError(fn, s)
	case codeBase:
		return baseError(fn, s, base)
	case codeBitSize:
		return bitSizeError(fn, s, bitSize)
	}
	return nil
}

// ParseBool returns the boolean value represented by the string.
// It accepts 1, t, T, TRUE, true, True, 0, f, F, FALSE, false, False.
// Any other value returns an error.
func ParseBool(str string) (bool, error) {
	switch str {
	case "1", "t", "T", "true", "TRUE", "True":
		return true, nil
	case "0", "f", "F", "false", "FALSE", "False":
		return false, nil
	}
	return false, syntaxError("ParseBool", str)
}

// FormatBool returns "true" or "false" according to the value of b.
func FormatBool(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// AppendBool appends "true" or "false", according to the value of b,
// to dst and returns the extended buffer.
func AppendBool(dst []byte, b bool) []byte {
	if b {
		return append(dst, "true"...)
	}
	return append(dst, "false"...)
}

// lower(c) is a lower-case letter if and only if
// c is either that lower-case letter or the equivalent upper-case letter.
// Instead of writing c == 'x' || c == 'X' one can write lower(c) == 'x'.
// Note that lower of non-letters can produce other non-letters.
func lowerS(c byte) byte {
	return c | ('x' - 'X')
}

func lower(c byte) byte {
	return c | ('x' - 'X')
}

// ParseUint is like [ParseInt] but for unsigned numbers.
//
// A sign prefix is not permitted.
func ParseUint(s string, base int, bitSize int) (uint64, error) {
	x, code := parseUint(s, base, bitSize)
	if code != codeNone {
		return x, toError("ParseUint", s, base, bitSize, code)
	}
	return x, nil
}

// ParseInt interprets a string s in the given base (0, 2 to 36) and
// bit size (0 to 64) and returns the corresponding value i.
//
// The string may begin with a leading sign: "+" or "-".
//
// If the base argument is 0, the true base is implied by the string's
// prefix following the sign (if present): 2 for "0b", 8 for "0" or "0o",
// 16 for "0x", and 10 otherwise. Also, for argument base 0 only,
// underscore characters are permitted as defined by the Go syntax for
// integer literals.
//
// The bitSize argument specifies the integer type
// that the result must fit into. Bit sizes 0, 8, 16, 32, and 64
// correspond to int, int8, int16, int32, and int64.
// If bitSize is below 0 or above 64, an error is returned.
//
// The errors that ParseInt returns have concrete type [*NumError]
// and include err.Num = s. If s is empty or contains invalid
// digits, err.Err = [ErrSyntax] and the returned value is 0;
// if the value corresponding to s cannot be represented by a
// signed integer of the given size, err.Err = [ErrRange] and the
// returned value is the maximum magnitude integer of the
// appropriate bitSize and sign.
func ParseInt(s string, base int, bitSize int) (i int64, err error) {
	x, code := parseInt(s, base, bitSize)
	if code != codeNone {
		return x, toError("ParseInt", s, base, bitSize, code)
	}
	return x, nil
}

// Atoi is equivalent to ParseInt(s, 10, 0), converted to type int.
func Atoi(s string) (int, error) {
	x, code := atoi(s)
	if code != codeNone {
		return x, toError("Atoi", s, 0, 0, code)
	}
	return x, nil
}

func parseUint(s string, base int, bitSize int) (uint64, parseCode) {
	if s == "" {
		return 0, codeSyntax
	}

	base0 := base == 0

	s0 := s
	switch {
	case 2 <= base && base <= 36:
		// valid base; nothing to do

	case base == 0:
		// Look for octal, hex prefix.
		base = 10
		if s[0] == '0' {
			switch {
			case len(s) >= 3 && lowerS(s[1]) == 'b':
				base = 2
				s = s[2:]
			case len(s) >= 3 && lowerS(s[1]) == 'o':
				base = 8
				s = s[2:]
			case len(s) >= 3 && lowerS(s[1]) == 'x':
				base = 16
				s = s[2:]
			default:
				base = 8
				s = s[1:]
			}
		}

	default:
		return 0, codeBase
	}

	if bitSize == 0 {
		bitSize = IntSize
	} else if bitSize < 0 || bitSize > 64 {
		return 0, codeBitSize
	}

	// Cutoff is the smallest number such that cutoff*base > maxUint64.
	// Use compile-time constants for common cases.
	var cutoff uint64
	switch base {
	case 10:
		cutoff = maxUint64/10 + 1
	case 16:
		cutoff = maxUint64/16 + 1
	default:
		cutoff = ^uint64(0)/uint64(base) + 1
	}

	maxVal := uint64(1)<<uint(bitSize) - 1

	underscores := false
	var n uint64
	for _, c := range []byte(s) {
		var d byte
		switch {
		case c == '_' && base0:
			underscores = true
			continue
		case '0' <= c && c <= '9':
			d = c - '0'
		case 'a' <= lower(c) && lower(c) <= 'z':
			d = lower(c) - 'a' + 10
		default:
			return 0, codeSyntax
		}

		if d >= byte(base) {
			return 0, codeSyntax
		}

		if n >= cutoff {
			// n*base overflows
			return maxVal, codeRange
		}
		n *= uint64(base)

		n1 := n + uint64(d)
		if n1 < n || n1 > maxVal {
			// n+d overflows
			return maxVal, codeRange
		}
		n = n1
	}

	if underscores && !underscoreOK(s0) {
		return 0, codeSyntax
	}

	return n, codeNone
}

func parseInt(s string, base int, bitSize int) (i int64, code parseCode) {
	if s == "" {
		return 0, codeSyntax
	}

	// Pick off leading sign.
	neg := false
	switch s[0] {
	case '+':
		s = s[1:]
	case '-':
		s = s[1:]
		neg = true
	}

	// Convert unsigned and check range.
	var un uint64
	un, code = parseUint(s, base, bitSize)
	if code != codeNone && code != codeRange {
		return 0, code
	}

	if bitSize == 0 {
		bitSize = IntSize
	}

	cutoff := uint64(1 << uint(bitSize-1))
	if !neg && un >= cutoff {
		return int64(cutoff - 1), codeRange
	}
	if neg && un > cutoff {
		return -int64(cutoff), codeRange
	}
	n := int64(un)
	if neg {
		n = -n
	}
	return n, codeNone
}

func atoi(s string) (int, parseCode) {
	sLen := len(s)
	if 0 < sLen && sLen < 19 {
		// Fast path for small integers that fit int type.
		s0 := s
		if s[0] == '-' || s[0] == '+' {
			s = s[1:]
			if len(s) < 1 {
				return 0, codeSyntax
			}
		}

		n := 0
		for _, ch := range []byte(s) {
			ch -= '0'
			if ch > 9 {
				return 0, codeSyntax
			}
			n = n*10 + int(ch)
		}
		if s0[0] == '-' {
			n = -n
		}
		return n, codeNone
	}

	// Slow path for invalid, big, or underscored integers.
	i64, code := parseInt(s, 10, 0)
	return int(i64), code
}

// underscoreOK reports whether the underscores in s are allowed.
// Checking them in this one function lets all the parsers skip over them simply.
// Underscore must appear only between digits or between a base prefix and a digit.
func underscoreOK(s string) bool {
	// saw tracks the last character (class) we saw:
	// ^ for beginning of number,
	// 0 for a digit or base prefix,
	// _ for an underscore,
	// ! for none of the above.
	saw := '^'
	i := 0

	// Optional sign.
	if len(s) >= 1 && (s[0] == '-' || s[0] == '+') {
		s = s[1:]
	}

	// Optional base prefix.
	hex := false
	if len(s) >= 2 && s[0] == '0' && (lowerS(s[1]) == 'b' || lowerS(s[1]) == 'o' || lowerS(s[1]) == 'x') {
		i = 2
		saw = '0' // base prefix counts as a digit for "underscore as digit separator"
		hex = lowerS(s[1]) == 'x'
	}

	// Number proper.
	for ; i < len(s); i++ {
		// Digits are always okay.
		if '0' <= s[i] && s[i] <= '9' || hex && 'a' <= lowerS(s[i]) && lowerS(s[i]) <= 'f' {
			saw = '0'
			continue
		}
		// Underscore must follow digit.
		if s[i] == '_' {
			if saw != '0' {
				return false
			}
			saw = '_'
			continue
		}
		// Underscore must also be followed by digit.
		if saw == '_' {
			return false
		}
		// Saw non-digit, non-underscore.
		saw = '!'
	}
	return saw != '_'
}

// FormatUint returns the string representation of i in the given base,
// for 2 <= base <= 36. The result uses the lower-case letters 'a' to 'z'
// for digit values >= 10.
func FormatUint(i uint64, base int) string {
	if base == 10 {
		if i < nSmalls {
			return small(int(i))
		}
		var a [24]byte
		j := formatBase10(a[:], i)
		return string(a[j:])
	}
	_, s := formatBits(nil, i, base, false, false)
	return s
}

// FormatInt returns the string representation of i in the given base,
// for 2 <= base <= 36. The result uses the lower-case letters 'a' to 'z'
// for digit values >= 10.
func FormatInt(i int64, base int) string {
	if base == 10 {
		if 0 <= i && i < nSmalls {
			return small(int(i))
		}
		var a [24]byte
		u := uint64(i)
		if i < 0 {
			u = -u
		}
		j := formatBase10(a[:], u)
		if i < 0 {
			j--
			a[j] = '-'
		}
		return string(a[j:])
	}
	_, s := formatBits(nil, uint64(i), base, i < 0, false)
	return s
}

// Itoa is equivalent to [FormatInt](int64(i), 10).
func Itoa(i int) string {
	return FormatInt(int64(i), 10)
}

// AppendInt appends the string form of the integer i,
// as generated by [FormatInt], to dst and returns the extended buffer.
func AppendInt(dst []byte, i int64, base int) []byte {
	u := uint64(i)
	if i < 0 {
		dst = append(dst, '-')
		u = -u
	}
	return AppendUint(dst, u, base)
}

// AppendUint appends the string form of the unsigned integer i,
// as generated by [FormatUint], to dst and returns the extended buffer.
func AppendUint(dst []byte, i uint64, base int) []byte {
	if base == 10 {
		if i < nSmalls {
			return append(dst, small(int(i))...)
		}
		var a [24]byte
		j := formatBase10(a[:], i)
		return append(dst, a[j:]...)
	}
	dst, _ = formatBits(dst, i, base, false, true)
	return dst
}

func digitAt(i uint) byte {
	return byte(digits[i])
}

const digits = "0123456789abcdefghijklmnopqrstuvwxyz"

// formatBits computes the string representation of u in the given base.
// If neg is set, u is treated as negative int64 value. If append_ is
// set, the string is appended to dst and the resulting byte slice is
// returned as the first result value; otherwise the string is returned
// as the second result value.
// The caller is expected to have handled base 10 separately for speed.
func formatBits(dst []byte, u uint64, base int, neg, append_ bool) (d []byte, s string) {
	if base < 2 || base == 10 || base > len(digits) {
		panic("strconv: illegal AppendInt/FormatInt base")
	}
	// 2 <= base && base <= len(digits)

	var a [64 + 1]byte // +1 for sign of 64bit value in base 2
	i := len(a)
	if neg {
		u = -u
	}

	// convert bits
	// We use uint values where we can because those will
	// fit into a single register even on a 32bit machine.
	if isPowerOfTwo(base) {
		// Use shifts and masks instead of / and %.
		shift := uint(bits.TrailingZeros(uint(base)))
		b := uint64(base)
		m := b - 1 // == 1<<shift - 1
		for u >= b {
			i--
			a[i] = digitAt(uint(u & m))
			u >>= shift
		}
		// u < base
		i--
		a[i] = digitAt(uint(u))
	} else {
		// general case
		b := uint64(base)
		for u >= b {
			i--
			// Avoid using r = a%b in addition to q = a/b
			// since 64bit division and modulo operations
			// are calculated by runtime functions on 32bit machines.
			q := u / b
			a[i] = digitAt(uint(u-q*b))
			u = q
		}
		// u < base
		i--
		a[i] = digitAt(uint(u))
	}

	// add sign, if any
	if neg {
		i--
		a[i] = '-'
	}

	if append_ {
		d = append(dst, a[i:]...)
		return
	}
	s = string(a[i:])
	return
}

func isPowerOfTwo(x int) bool {
	return x&(x-1) == 0
}

const nSmalls = 100

// smalls is the formatting of 00..99 concatenated.
// It is then padded out with 56 x's to 256 bytes,
// so that smalls[x&0xFF] has no bounds check.
const smalls = "00010203040506070809" +
	"10111213141516171819" +
	"20212223242526272829" +
	"30313233343536373839" +
	"40414243444546474849" +
	"50515253545556575859" +
	"60616263646566676869" +
	"70717273747576777879" +
	"80818283848586878889" +
	"90919293949596979899"

// small returns the string for an i with 0 <= i < nSmalls.
func small(i int) string {
	if i < 10 {
		return digits[i : i+1]
	}
	return smalls[i*2 : i*2+2]
}

// formatBase10 formats the decimal representation of u into the tail of a
// and returns the offset of the first byte written to a. That is, after
//
//	i := formatBase10(a, u)
//
// the decimal representation is in a[i:].
func formatBase10(a []byte, u uint64) int {
	// Split into 9-digit chunks that fit in uint32s
	// and convert each chunk using uint32 math instead of uint64 math.
	// The obvious way to write the outer loop is "for u >= 1e9", but most numbers are small,
	// so the setup for the comparison u >= 1e9 is usually pure overhead.
	// Instead, we approximate it by u>>29 != 0, which is usually faster and good enough.
	i := len(a)
	for u>>29 != 0 {
		var lo uint32
		u, lo = u/1000000000, uint32(u%1000000000)

		// Convert 9 digits.
		for range 4 {
			var dd uint32
			lo, dd = lo/100, (lo%100)*2
			i -= 2
			a[i+0], a[i+1] = byte(smalls[dd+0]), byte(smalls[dd+1])
		}
		i--
		a[i] = byte(smalls[lo*2+1])

		// If we'd been using u >= 1e9 then we would be guaranteed that u/1e9 > 0,
		// but since we used u>>29 != 0, u/1e9 might be 0, so we might be done.
		// (If u is now 0, then at the start we had 2²⁹ ≤ u < 10⁹, so it was still correct
		// to write 9 digits; we have not accidentally written any leading zeros.)
		if u == 0 {
			return i
		}
	}

	// Convert final chunk, at most 8 digits.
	lo := uint32(u)
	for lo >= 100 {
		var dd uint32
		lo, dd = lo/100, (lo%100)*2
		i -= 2
		a[i+0], a[i+1] = byte(smalls[dd+0]), byte(smalls[dd+1])
	}
	i--
	dd := lo * 2
	a[i] = byte(smalls[dd+1])
	if lo >= 10 {
		i--
		a[i] = byte(smalls[dd+0])
	}
	return i
}
