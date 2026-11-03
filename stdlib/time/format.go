//go:build gofront

//gofront:target both

// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package time

import "errors"

// These are predefined layouts for use in Time.Format and time.Parse. The
// reference time used in these layouts is the specific time stamp:
//
//	01/02 03:04:05PM '06 -0700
//
// (January 2, 15:04:05, 2006, in time zone seven hours west of GMT).
const (
	Layout      = "01/02 03:04:05PM '06 -0700" // The reference time, in numerical order.
	ANSIC       = "Mon Jan _2 15:04:05 2006"
	UnixDate    = "Mon Jan _2 15:04:05 MST 2006"
	RubyDate    = "Mon Jan 02 15:04:05 -0700 2006"
	RFC822      = "02 Jan 06 15:04 MST"
	RFC822Z     = "02 Jan 06 15:04 -0700" // RFC822 with numeric zone
	RFC850      = "Monday, 02-Jan-06 15:04:05 MST"
	RFC1123     = "Mon, 02 Jan 2006 15:04:05 MST"
	RFC1123Z    = "Mon, 02 Jan 2006 15:04:05 -0700" // RFC1123 with numeric zone
	RFC3339     = "2006-01-02T15:04:05Z07:00"
	RFC3339Nano = "2006-01-02T15:04:05.999999999Z07:00"
	Kitchen     = "3:04PM"
	// Handy time stamps.
	Stamp      = "Jan _2 15:04:05"
	StampMilli = "Jan _2 15:04:05.000"
	StampMicro = "Jan _2 15:04:05.000000"
	StampNano  = "Jan _2 15:04:05.000000000"
	DateTime   = "2006-01-02 15:04:05"
	DateOnly   = "2006-01-02"
	TimeOnly   = "15:04:05"
)

const (
	_                        = iota
	stdLongMonth             = iota + stdNeedDate  // "January"
	stdMonth                                       // "Jan"
	stdNumMonth                                    // "1"
	stdZeroMonth                                   // "01"
	stdLongWeekDay                                 // "Monday"
	stdWeekDay                                     // "Mon"
	stdDay                                         // "2"
	stdUnderDay                                    // "_2"
	stdZeroDay                                     // "02"
	stdUnderYearDay                                // "__2"
	stdZeroYearDay                                 // "002"
	stdHour                  = iota + stdNeedClock // "15"
	stdHour12                                      // "3"
	stdZeroHour12                                  // "03"
	stdMinute                                      // "4"
	stdZeroMinute                                  // "04"
	stdSecond                                      // "5"
	stdZeroSecond                                  // "05"
	stdLongYear              = iota + stdNeedDate  // "2006"
	stdYear                                        // "06"
	stdPM                    = iota + stdNeedClock // "PM"
	stdpm                                          // "pm"
	stdTZ                    = iota                // "MST"
	stdISO8601TZ                                   // "Z0700"  // prints Z for UTC
	stdISO8601SecondsTZ                            // "Z070000"
	stdISO8601ShortTZ                              // "Z07"
	stdISO8601ColonTZ                              // "Z07:00" // prints Z for UTC
	stdISO8601ColonSecondsTZ                       // "Z07:00:00"
	stdNumTZ                                       // "-0700"  // always numeric
	stdNumSecondsTz                                // "-070000"
	stdNumShortTZ                                  // "-07"    // always numeric
	stdNumColonTZ                                  // "-07:00" // always numeric
	stdNumColonSecondsTZ                           // "-07:00:00"
	stdFracSecond0                                 // ".0", ".00", ... , trailing zeros included
	stdFracSecond9                                 // ".9", ".99", ..., trailing zeros omitted

	stdNeedDate       = 1 << 8             // need month, day, year
	stdNeedClock      = 2 << 8             // need hour, minute, second
	stdArgShift       = 16                 // extra argument in high bits, above low stdArgShift
	stdSeparatorShift = 28                 // extra argument in high 4 bits for fractional second separators
	stdMask           = 1<<stdArgShift - 1 // mask out argument
)

// std0x records the std values for "01", "02", ..., "06".
var std0x = [6]int{stdZeroMonth, stdZeroDay, stdZeroHour12, stdZeroMinute, stdZeroSecond, stdYear}

// startsWithLowerCase reports whether the string has a lower-case letter at the beginning.
// Its purpose is to prevent matching strings like "Month" when looking for "Mon".
func startsWithLowerCase(str string) bool {
	if len(str) == 0 {
		return false
	}
	c := str[0]
	return 'a' <= c && c <= 'z'
}

// nextStdChunk finds the first occurrence of a std string in
// layout and returns the text before, the std string, and the text after.
func nextStdChunk(layout string) (prefix string, std int, suffix string) {
	for i := 0; i < len(layout); i++ {
		switch c := int(layout[i]); c {
		case 'J': // January, Jan
			if len(layout) >= i+3 && layout[i:i+3] == "Jan" {
				if len(layout) >= i+7 && layout[i:i+7] == "January" {
					return layout[0:i], stdLongMonth, layout[i+7:]
				}
				if !startsWithLowerCase(layout[i+3:]) {
					return layout[0:i], stdMonth, layout[i+3:]
				}
			}

		case 'M': // Monday, Mon, MST
			if len(layout) >= i+3 {
				if layout[i:i+3] == "Mon" {
					if len(layout) >= i+6 && layout[i:i+6] == "Monday" {
						return layout[0:i], stdLongWeekDay, layout[i+6:]
					}
					if !startsWithLowerCase(layout[i+3:]) {
						return layout[0:i], stdWeekDay, layout[i+3:]
					}
				}
				if layout[i:i+3] == "MST" {
					return layout[0:i], stdTZ, layout[i+3:]
				}
			}

		case '0': // 01, 02, 03, 04, 05, 06, 002
			if len(layout) >= i+2 && '1' <= layout[i+1] && layout[i+1] <= '6' {
				return layout[0:i], std0x[layout[i+1]-'1'], layout[i+2:]
			}
			if len(layout) >= i+3 && layout[i+1] == '0' && layout[i+2] == '2' {
				return layout[0:i], stdZeroYearDay, layout[i+3:]
			}

		case '1': // 15, 1
			if len(layout) >= i+2 && layout[i+1] == '5' {
				return layout[0:i], stdHour, layout[i+2:]
			}
			return layout[0:i], stdNumMonth, layout[i+1:]

		case '2': // 2006, 2
			if len(layout) >= i+4 && layout[i:i+4] == "2006" {
				return layout[0:i], stdLongYear, layout[i+4:]
			}
			return layout[0:i], stdDay, layout[i+1:]

		case '_': // _2, _2006, __2
			if len(layout) >= i+2 && layout[i+1] == '2' {
				//_2006 is really a literal _, followed by stdLongYear
				if len(layout) >= i+5 && layout[i+1:i+5] == "2006" {
					return layout[0 : i+1], stdLongYear, layout[i+5:]
				}
				return layout[0:i], stdUnderDay, layout[i+2:]
			}
			if len(layout) >= i+3 && layout[i+1] == '_' && layout[i+2] == '2' {
				return layout[0:i], stdUnderYearDay, layout[i+3:]
			}

		case '3':
			return layout[0:i], stdHour12, layout[i+1:]

		case '4':
			return layout[0:i], stdMinute, layout[i+1:]

		case '5':
			return layout[0:i], stdSecond, layout[i+1:]

		case 'P': // PM
			if len(layout) >= i+2 && layout[i+1] == 'M' {
				return layout[0:i], stdPM, layout[i+2:]
			}

		case 'p': // pm
			if len(layout) >= i+2 && layout[i+1] == 'm' {
				return layout[0:i], stdpm, layout[i+2:]
			}

		case '-': // -070000, -07:00:00, -0700, -07:00, -07
			if len(layout) >= i+7 && layout[i:i+7] == "-070000" {
				return layout[0:i], stdNumSecondsTz, layout[i+7:]
			}
			if len(layout) >= i+9 && layout[i:i+9] == "-07:00:00" {
				return layout[0:i], stdNumColonSecondsTZ, layout[i+9:]
			}
			if len(layout) >= i+5 && layout[i:i+5] == "-0700" {
				return layout[0:i], stdNumTZ, layout[i+5:]
			}
			if len(layout) >= i+6 && layout[i:i+6] == "-07:00" {
				return layout[0:i], stdNumColonTZ, layout[i+6:]
			}
			if len(layout) >= i+3 && layout[i:i+3] == "-07" {
				return layout[0:i], stdNumShortTZ, layout[i+3:]
			}

		case 'Z': // Z070000, Z07:00:00, Z0700, Z07:00,
			if len(layout) >= i+7 && layout[i:i+7] == "Z070000" {
				return layout[0:i], stdISO8601SecondsTZ, layout[i+7:]
			}
			if len(layout) >= i+9 && layout[i:i+9] == "Z07:00:00" {
				return layout[0:i], stdISO8601ColonSecondsTZ, layout[i+9:]
			}
			if len(layout) >= i+5 && layout[i:i+5] == "Z0700" {
				return layout[0:i], stdISO8601TZ, layout[i+5:]
			}
			if len(layout) >= i+6 && layout[i:i+6] == "Z07:00" {
				return layout[0:i], stdISO8601ColonTZ, layout[i+6:]
			}
			if len(layout) >= i+3 && layout[i:i+3] == "Z07" {
				return layout[0:i], stdISO8601ShortTZ, layout[i+3:]
			}

		case '.', ',': // ,000, or .000, or ,999, or .999 - repeated digits for fractional seconds.
			if i+1 < len(layout) && (layout[i+1] == '0' || layout[i+1] == '9') {
				ch := layout[i+1]
				j := i + 1
				for j < len(layout) && layout[j] == ch {
					j++
				}
				// String of digits must end here - only fractional second if all digits.
				if !isDigit(layout, j) {
					code := stdFracSecond0
					if layout[i+1] == '9' {
						code = stdFracSecond9
					}
					std := stdFracSecond(code, j-(i+1), c)
					return layout[0:i], std, layout[j:]
				}
			}
		}
	}
	return layout, 0, ""
}

var shortMonthNames = []string{
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
}

// isDigit reports whether s[i] is in range and is a decimal digit.
func isDigit(s string, i int) bool {
	if len(s) <= i {
		return false
	}
	c := s[i]
	return '0' <= c && c <= '9'
}

// getnum parses s[0:1] or s[0:2] (fixed forces s[0:2])
// as a decimal integer and returns the integer and the
// remainder of the string.
func getnum(s string, fixed bool) (int, string, error) {
	if !isDigit(s, 0) {
		return 0, s, errBad
	}
	if !isDigit(s, 1) {
		if fixed {
			return 0, s, errBad
		}
		return int(s[0] - '0'), s[1:], nil
	}
	return int(s[0]-'0')*10 + int(s[1]-'0'), s[2:], nil
}

// getnum3 parses s[0:1], s[0:2], or s[0:3] (fixed forces s[0:3])
// as a decimal integer and returns the integer and the remainder
// of the string.
func getnum3(s string, fixed bool) (int, string, error) {
	var n, i int
	for i = 0; i < 3 && isDigit(s, i); i++ {
		n = n*10 + int(s[i]-'0')
	}
	if i == 0 || fixed && i != 3 {
		return 0, s, errBad
	}
	return n, s[i:], nil
}

var errBad = errors.New("bad value for field") // not passed to the user

// stdFracSecond returns the std for a fractional second with n digits and the
// separator sep.
func stdFracSecond(code, n, c int) int {
	// Use 0xfff to make the failure case even more absurd.
	if c == '.' {
		return code | ((n & 0xfff) << stdArgShift)
	}
	return code | ((n & 0xfff) << stdArgShift) | 1<<stdSeparatorShift
}

func digitsLen(std int) int {
	return (std >> stdArgShift) & 0xfff
}

func separator(std int) byte {
	if (std >> stdSeparatorShift) == 0 {
		return '.'
	}
	return ','
}

// appendInt appends the decimal form of x to b and returns the result.
// If the decimal form (excluding sign) is shorter than width, the result is padded with leading 0's.
// If x is negative, a leading '-' is added to the sign.
func appendInt(b []byte, x int, width int) []byte {
	u := uint(x)
	if x < 0 {
		b = append(b, '-')
		u = uint(-x)
	}

	// 2-digit and 4-digit fields are the most common in time formats.
	utod := func(u uint) byte { return '0' + byte(u) }
	switch {
	case width == 2 && u < 100:
		return append(b, utod(u/10), utod(u%10))
	case width == 4 && u < 10000:
		return append(b, utod(u/1000), utod(u/100%10), utod(u/10%10), utod(u%10))
	}

	// Compute the number of decimal digits.
	var n int
	if u == 0 {
		n = 1
	}
	for u2 := u; u2 > 0; u2 = u2 / 10 {
		n++
	}

	// Add 0-padding.
	for pad := width - n; pad > 0; pad-- {
		b = append(b, '0')
	}

	// Assemble the decimal in reverse order after the padding.
	start := len(b)
	b = append(b, make([]byte, n)...)
	i := len(b) - 1
	for u >= 10 && i > start {
		q := u / 10
		b[i] = utod(u - q*10)
		u = q
		i--
	}
	b[i] = utod(u)
	return b
}

// formatNano appends a fractional second, as nanoseconds, to b
// and returns the result. The nanosec must be within [0, 999999999].
func formatNano(b []byte, nanosec uint, std int) []byte {
	var (
		n         = digitsLen(std)
		separator = separator(std)
		trim      = std&stdMask == stdFracSecond9
	)
	u := nanosec
	var buf [9]byte
	for start := len(buf); start > 0; {
		start--
		buf[start] = byte(u%10 + '0')
		u /= 10
	}

	if n > 9 {
		n = 9
	}
	if trim {
		for n > 0 && buf[n-1] == '0' {
			n--
		}
		if n == 0 {
			return b
		}
	}
	b = append(b, separator)
	return append(b, buf[:n]...)
}

// String returns the time formatted using the format string
//
//	"2006-01-02 15:04:05.999999999 -0700 MST"
func (t Time) String() string {
	return t.Format("2006-01-02 15:04:05.999999999 -0700 MST")
}

// GoString implements fmt.GoStringer and formats t to be printed in Go source
// code.
func (t Time) GoString() string {
	abs := t.abs()
	year, month, day, _ := absDate(abs)
	hour, min, sec := t.Clock()

	buf := make([]byte, 0, len("time.Date(9999, time.September, 31, 23, 59, 59, 999999999, time.Local)"))
	buf = append(buf, "time.Date("...)
	buf = appendInt(buf, year, 0)
	if January <= month && month <= December {
		buf = append(buf, ", time."...)
		buf = append(buf, longMonthNames[month-1]...)
	} else {
		// It's difficult to construct a time.Time with a date outside the
		// standard range but we might as well try to handle the case.
		buf = appendInt(buf, int(month), 0)
	}
	buf = append(buf, ", "...)
	buf = appendInt(buf, day, 0)
	buf = append(buf, ", "...)
	buf = appendInt(buf, hour, 0)
	buf = append(buf, ", "...)
	buf = appendInt(buf, min, 0)
	buf = append(buf, ", "...)
	buf = appendInt(buf, sec, 0)
	buf = append(buf, ", "...)
	buf = appendInt(buf, t.Nanosecond(), 0)
	buf = append(buf, ", "...)
	switch loc := t.Location(); loc {
	case UTC:
		buf = append(buf, "time.UTC"...)
	case Local:
		buf = append(buf, "time.Local"...)
	default:
		// there are several options for how we could display this, none of
		// which are great:
		//
		// - use Location(loc.name), which is not technically valid syntax
		// - use LoadLocation(loc.name), which will cause a syntax error when
		// embedded and also would require us to escape the string without
		// importing fmt or strconv
		// - try to use FixedZone, which would also require escaping the name
		// and would represent e.g. "America/Los_Angeles" daylight saving time
		// shifts inaccurately
		// - use the pointer format, which is no worse than you'd get with the
		// old fmt.Sprintf("%#v", t) format.
		//
		// Of these, Location(loc.name) is the least disruptive. This is an edge
		// case we hope not to hit too often.
		buf = append(buf, `time.Location(`...)
		buf = append(buf, quote(loc.name)...)
		buf = append(buf, ')')
	}
	buf = append(buf, ')')
	return string(buf)
}

// Format returns a textual representation of the time value formatted according
// to the layout defined by the argument. See the documentation for the
// constant called Layout to see how to represent the layout format.
func (t Time) Format(layout string) string {
	const bufSize = 64
	var b []byte
	max := len(layout) + 10
	if max < bufSize {
		b = make([]byte, 0, bufSize)
	} else {
		b = make([]byte, 0, max)
	}
	b = t.AppendFormat(b, layout)
	return string(b)
}

// AppendFormat is like Format but appends the textual
// representation to b and returns the extended buffer.
func (t Time) AppendFormat(b []byte, layout string) []byte {
	name, offset := t.zone()
	abs := t.abs()
	return t.appendFormat(b, layout, name, offset, abs)
}

func (t Time) appendFormat(b []byte, layout string, name string, offset int, abs int64) []byte {
	var (
		year  int = -1
		month Month
		day   int
		yday  int
		hour  int = -1
		min   int
		sec   int
	)

	// Each iteration generates one std value.
	for layout != "" {
		prefix, std, suffix := nextStdChunk(layout)
		if prefix != "" {
			b = append(b, prefix...)
		}
		if std == 0 {
			break
		}
		layout = suffix

		// Compute year, month, day if needed.
		if year < 0 && std&stdNeedDate != 0 {
			year, month, day, yday = absDate(abs)
			yday++
		}

		// Compute hour, minute, second if needed.
		if hour < 0 && std&stdNeedClock != 0 {
			s := int(abs - floorDiv(abs, secondsPerDay)*secondsPerDay)
			hour = s / secondsPerHour
			s -= hour * secondsPerHour
			min = s / secondsPerMinute
			sec = s - min*secondsPerMinute
		}

		switch std & stdMask {
		case stdYear:
			y := year
			if y < 0 {
				y = -y
			}
			b = appendInt(b, y%100, 2)
		case stdLongYear:
			b = appendInt(b, year, 4)
		case stdMonth:
			b = append(b, shortMonthNames[month-1]...)
		case stdLongMonth:
			m := month.String()
			b = append(b, m...)
		case stdNumMonth:
			b = appendInt(b, int(month), 0)
		case stdZeroMonth:
			b = appendInt(b, int(month), 2)
		case stdWeekDay:
			b = append(b, shortDayNames[absWeekday(abs)]...)
		case stdLongWeekDay:
			s := absWeekday(abs).String()
			b = append(b, s...)
		case stdDay:
			b = appendInt(b, day, 0)
		case stdUnderDay:
			if day < 10 {
				b = append(b, ' ')
			}
			b = appendInt(b, day, 0)
		case stdZeroDay:
			b = appendInt(b, day, 2)
		case stdUnderYearDay:
			if yday < 100 {
				b = append(b, ' ')
				if yday < 10 {
					b = append(b, ' ')
				}
			}
			b = appendInt(b, yday, 0)
		case stdZeroYearDay:
			b = appendInt(b, yday, 3)
		case stdHour:
			b = appendInt(b, hour, 2)
		case stdHour12:
			// Noon is 12PM, midnight is 12AM.
			hr := hour % 12
			if hr == 0 {
				hr = 12
			}
			b = appendInt(b, hr, 0)
		case stdZeroHour12:
			// Noon is 12PM, midnight is 12AM.
			hr := hour % 12
			if hr == 0 {
				hr = 12
			}
			b = appendInt(b, hr, 2)
		case stdMinute:
			b = appendInt(b, min, 0)
		case stdZeroMinute:
			b = appendInt(b, min, 2)
		case stdSecond:
			b = appendInt(b, sec, 0)
		case stdZeroSecond:
			b = appendInt(b, sec, 2)
		case stdPM:
			if hour >= 12 {
				b = append(b, "PM"...)
			} else {
				b = append(b, "AM"...)
			}
		case stdpm:
			if hour >= 12 {
				b = append(b, "pm"...)
			} else {
				b = append(b, "am"...)
			}
		case stdISO8601TZ, stdISO8601ColonTZ, stdISO8601SecondsTZ, stdISO8601ShortTZ, stdISO8601ColonSecondsTZ, stdNumTZ, stdNumColonTZ, stdNumSecondsTz, stdNumShortTZ, stdNumColonSecondsTZ:
			// Ugly special case. We cheat and take the "Z" variants
			// to mean "the time zone as formatted for ISO 8601".
			if offset == 0 && (std == stdISO8601TZ || std == stdISO8601ColonTZ || std == stdISO8601SecondsTZ || std == stdISO8601ShortTZ || std == stdISO8601ColonSecondsTZ) {
				b = append(b, 'Z')
				break
			}
			zone := offset / 60 // convert to minutes
			absoffset := offset
			if zone < 0 {
				b = append(b, '-')
				zone = -zone
				absoffset = -absoffset
			} else {
				b = append(b, '+')
			}
			b = appendInt(b, zone/60, 2)
			if std == stdISO8601ColonTZ || std == stdNumColonTZ || std == stdISO8601ColonSecondsTZ || std == stdNumColonSecondsTZ {
				b = append(b, ':')
			}
			if std != stdNumShortTZ && std != stdISO8601ShortTZ {
				b = appendInt(b, zone%60, 2)
			}

			// append seconds if appropriate
			if std == stdISO8601SecondsTZ || std == stdNumSecondsTz || std == stdNumColonSecondsTZ || std == stdISO8601ColonSecondsTZ {
				if std == stdNumColonSecondsTZ || std == stdISO8601ColonSecondsTZ {
					b = append(b, ':')
				}
				b = appendInt(b, absoffset%60, 2)
			}

		case stdTZ:
			// Ugly special case. We cheat and take the "MST" variant
			// to mean "the time zone abbreviation".
			if name != "" {
				b = append(b, name...)
				break
			}
			// No time zone known for this time, but we must print one.
			// Use the -0700 format.
			zone := offset / 60 // convert to minutes
			if zone < 0 {
				b = append(b, '-')
				zone = -zone
			} else {
				b = append(b, '+')
			}
			b = appendInt(b, zone/60, 2)
			b = appendInt(b, zone%60, 2)
		case stdFracSecond0, stdFracSecond9:
			b = formatNano(b, uint(t.nsec), std)
		}
	}
	return b
}

var errAppendBadYear = errors.New("year outside of range [0,9999]")
var errAppendBadZone = errors.New("timezone hour outside of range [0,23]")

// appendStrictRFC3339 formats t as RFC 3339, rejecting what that format can
// not represent.
func (t Time) appendStrictRFC3339(b []byte) ([]byte, error) {
	if y := t.Year(); y < 0 || y >= 10000 {
		return b, errAppendBadYear
	}
	_, offset := t.zone()
	if offset <= -24*3600 || offset >= 24*3600 {
		return b, errAppendBadZone
	}
	b = t.AppendFormat(b, RFC3339Nano)
	return b, nil
}

// MarshalJSON implements the encoding/json.Marshaler interface. The time is a
// quoted string in the RFC 3339 format with sub-second precision. If the
// timestamp cannot be represented as valid RFC 3339 (e.g., the year is out of
// range), then an error is reported.
func (t Time) MarshalJSON() ([]byte, error) {
	b := make([]byte, 0, len(RFC3339Nano)+len(`""`))
	b = append(b, '"')
	b, err := t.appendStrictRFC3339(b)
	b = append(b, '"')
	if err != nil {
		return nil, errors.New("Time.MarshalJSON: " + err.Error())
	}
	return b, nil
}

// UnmarshalJSON implements the encoding/json.Unmarshaler interface. The time
// must be a quoted string in the RFC 3339 format.
func (t *Time) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}
	if len(data) < 2 || data[0] != '"' || data[len(data)-1] != '"' {
		return errors.New("Time.UnmarshalJSON: input is not a JSON string")
	}
	data = data[len(`"`) : len(data)-len(`"`)]
	parsed, err := parseStrictRFC3339(data)
	*t = parsed
	return err
}

// MarshalText implements the encoding.TextMarshaler interface. The time is
// formatted in RFC 3339 format with sub-second precision. If the timestamp
// cannot be represented as valid RFC 3339 (e.g., the year is out of range),
// then an error is returned.
func (t Time) MarshalText() ([]byte, error) {
	b := make([]byte, 0, len(RFC3339Nano))
	b, err := t.appendStrictRFC3339(b)
	if err != nil {
		return nil, errors.New("Time.MarshalText: " + err.Error())
	}
	return b, nil
}

// UnmarshalText implements the encoding.TextUnmarshaler interface. The time
// must be in the RFC 3339 format.
func (t *Time) UnmarshalText(data []byte) error {
	parsed, err := parseStrictRFC3339(data)
	*t = parsed
	return err
}

func parseStrictRFC3339(b []byte) (Time, error) {
	t, err := Parse(RFC3339, string(b))
	if err != nil {
		return Time{}, err
	}

	// The parse template syntax cannot correctly validate RFC 3339.
	// Explicitly check for cases that Parse is unable to validate for.
	// See https://go.dev/issue/54580.
	num2 := func(b []byte) byte { return 10*(b[0]-'0') + (b[1] - '0') }
	switch {
	case b[len("2006-01-02T")+1] == ':': // hour must be two digits
		return Time{}, &ParseError{RFC3339, string(b), "15", string(b[len("2006-01-02T"):][:1]), ""}
	case b[len("2006-01-02T15:04:05")] == ',': // sub-second separator must be a period
		return Time{}, &ParseError{RFC3339, string(b), ".", ",", ""}
	case b[len(b)-1] != 'Z':
		switch {
		case num2(b[len(b)-len("07:00"):]) >= 24: // timezone hour must be in range
			return Time{}, &ParseError{RFC3339, string(b), "Z07:00", string(b[len(b)-len("Z07:00"):]), ": timezone hour out of range"}
		case num2(b[len(b)-len("00"):]) >= 60: // timezone minute must be in range
			return Time{}, &ParseError{RFC3339, string(b), "minute", string(b[len(b)-len("00"):]), ""}
		}
	}
	return t, nil
}
