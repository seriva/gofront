//go:build gofront

//gofront:target both

// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package time provides functionality for measuring and displaying time.
//
// A Time is an instant with nanosecond precision and a Location; there is no
// monotonic clock reading, so Since and Sub compare wall clock times. The
// Local location is the host's time zone. Sleep, AfterFunc and Timer are
// part of the JavaScript-only part of the package.
package time

// A Month specifies a month of the year (January = 1, ...).
type Month int

const (
	January Month = 1 + iota
	February
	March
	April
	May
	June
	July
	August
	September
	October
	November
	December
)

var longMonthNames = []string{
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
}

// String returns the English name of the month ("January", "February", ...).
func (m Month) String() string {
	if January <= m && m <= December {
		return longMonthNames[m-1]
	}
	return "%!Month(" + itoa(int(m)) + ")"
}

// A Weekday specifies a day of the week (Sunday = 0, ...).
type Weekday int

const (
	Sunday Weekday = iota
	Monday
	Tuesday
	Wednesday
	Thursday
	Friday
	Saturday
)

var longDayNames = []string{
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
}

// String returns the English name of the day ("Sunday", "Monday", ...).
func (d Weekday) String() string {
	if Sunday <= d && d <= Saturday {
		return longDayNames[d]
	}
	return "%!Weekday(" + itoa(int(d)) + ")"
}

// itoa formats a decimal integer.
func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	buf := make([]byte, 24)
	w := len(buf)
	neg := v < 0
	u := uint64(v)
	if neg {
		u = -u
	}
	w = fmtInt(buf, w, u)
	if neg {
		w--
		buf[w] = '-'
	}
	return string(buf[w:])
}

// A Location maps time instants to the zone in use at that time. The
// predefined UTC and Local locations are the only ones with a name other
// than the one FixedZone was given.
type Location struct {
	name   string
	offset int // seconds east of UTC, for a fixed zone
	kind   int
}

const (
	kindFixed = iota
	kindUTC
	kindLocal
)

// UTC represents Universal Coordinated Time (UTC).
var UTC *Location = &Location{name: "UTC", kind: kindUTC}

// Local represents the system's local time zone.
var Local *Location = &Location{name: "Local", kind: kindLocal}

// String returns a descriptive name for the time zone information.
func (l *Location) String() string {
	if l == nil {
		return "UTC"
	}
	return l.name
}

// FixedZone returns a Location that always uses the given zone name and
// offset (seconds east of UTC).
func FixedZone(name string, offset int) *Location {
	return &Location{name: name, offset: offset}
}

// hostNow returns the host clock as nanoseconds since the Unix epoch.
//
//gofront:intrinsic time_now
func hostNow() int64

// hostOffset returns the offset in seconds east of UTC of the host's time
// zone at the given Unix time.
//
//gofront:intrinsic time_zone_offset
func hostOffset(unix int64) int

// lookup returns the zone abbreviation and offset in effect at the given
// Unix time.
func lookupZone(l *Location, unix int64) (name string, offset int) {
	if l == nil || l.kind == kindUTC {
		return "UTC", 0
	}
	if l.kind == kindLocal {
		off := hostOffset(unix)
		if off == 0 {
			return "UTC", 0
		}
		return "", off
	}
	return l.name, l.offset
}

// A Time represents an instant in time with nanosecond precision.
//
// The zero value of type Time is January 1, year 1, 00:00:00.000000000 UTC.
// Programs using times should typically store and pass them as values, not
// pointers. Time values can be compared with Equal, Before and After; the ==
// operator also compares the Location pointer.
type Time struct {
	sec  int64 // seconds since January 1, year 1 00:00:00 UTC
	nsec int32 // nanoseconds within the second, in [0, 999999999]
	loc  *Location
}

const (
	secondsPerMinute = 60
	secondsPerHour   = 60 * secondsPerMinute
	secondsPerDay    = 24 * secondsPerHour
	secondsPerWeek   = 7 * secondsPerDay
	daysPer400Years  = 365*400 + 97
	daysPer100Years  = 365*100 + 24
	daysPer4Years    = 365*4 + 1

	// Seconds between January 1, year 1 and January 1, 1970.
	unixToInternal int64 = (1969*365 + 1969/4 - 1969/100 + 1969/400) * secondsPerDay
	internalToUnix int64 = -unixToInternal
)

func (t Time) unixSec() int64 { return t.sec + internalToUnix }

// setLoc returns t in the location loc; the UTC location is stored as nil.
func (t Time) setLoc(loc *Location) Time {
	if loc != nil && loc.kind == kindUTC {
		loc = nil
	}
	t.loc = loc
	return t
}

// zone returns the zone abbreviation and offset in effect at t.
func (t Time) zone() (name string, offset int) {
	return lookupZone(t.loc, t.unixSec())
}

// abs returns the seconds since January 1, year 1 at t's location.
func (t Time) abs() int64 {
	_, off := t.zone()
	return t.sec + int64(off)
}

// floorDiv returns x/y rounded toward negative infinity (y > 0).
func floorDiv(x, y int64) int64 {
	q := x / y
	if x%y < 0 {
		q--
	}
	return q
}

// daysSinceEpoch returns the number of days between January 1, year 1 and
// January 1 of the given year.
func daysSinceEpoch(year int) int64 {
	y := int64(year) - 1
	n := floorDiv(y, 400)
	y -= 400 * n
	d := daysPer400Years * n

	n = y / 100
	y -= 100 * n
	d += daysPer100Years * n

	n = y / 4
	y -= 4 * n
	d += daysPer4Years * n

	d += 365 * y
	return d
}

func isLeap(year int) bool {
	return year%4 == 0 && (year%100 != 0 || year%400 == 0)
}

// daysBefore[m] counts the number of days in a non-leap year before month m
// begins. There is an entry for m=12, counting the number of days before
// January of next year (365).
var daysBefore = [13]int{
	0,
	31,
	31 + 28,
	31 + 28 + 31,
	31 + 28 + 31 + 30,
	31 + 28 + 31 + 30 + 31,
	31 + 28 + 31 + 30 + 31 + 30,
	31 + 28 + 31 + 30 + 31 + 30 + 31,
	31 + 28 + 31 + 30 + 31 + 30 + 31 + 31,
	31 + 28 + 31 + 30 + 31 + 30 + 31 + 31 + 30,
	31 + 28 + 31 + 30 + 31 + 30 + 31 + 31 + 30 + 31,
	31 + 28 + 31 + 30 + 31 + 30 + 31 + 31 + 30 + 31 + 30,
	31 + 28 + 31 + 30 + 31 + 30 + 31 + 31 + 30 + 31 + 30 + 31,
}

// absDate splits seconds since January 1, year 1 into the calendar date; yday
// is the zero-based day of the year.
func absDate(abs int64) (year int, month Month, day int, yday int) {
	d := floorDiv(abs, secondsPerDay)

	// Account for 400 year cycles.
	n := floorDiv(d, daysPer400Years)
	y := 400 * n
	c := int(d - daysPer400Years*n)

	// Cut off 100-year cycles.
	k := c / daysPer100Years
	k -= k >> 2
	y += int64(100 * k)
	c -= daysPer100Years * k

	// Cut off 4-year cycles.
	k = c / daysPer4Years
	y += int64(4 * k)
	c -= daysPer4Years * k

	// Cut off years within a 4-year cycle.
	k = c / 365
	k -= k >> 2
	y += int64(k)
	c -= 365 * k

	year = int(y) + 1
	yday = c
	day = c
	if isLeap(year) {
		// Leap year: February 29 is day 59 (zero-based).
		switch {
		case day > 31+29-1:
			// After leap day; pretend it wasn't there.
			day--
		case day == 31+29-1:
			// Leap day.
			return year, February, 29, yday
		}
	}

	// Estimate month on assumption that every month has 31 days. The estimate
	// may be too low by at most one month, so adjust.
	m := day / 31
	end := daysBefore[m+1]
	var begin int
	if day >= end {
		m++
		begin = end
	} else {
		begin = daysBefore[m]
	}
	return year, Month(m + 1), day - begin + 1, yday
}

// absWeekday returns the weekday of the day abs falls in.
func absWeekday(abs int64) Weekday {
	// January 1 of the year 1 was a Monday.
	d := floorDiv(abs, secondsPerDay) + 1
	return Weekday(d - 7*floorDiv(d, 7))
}

// Date returns the year, month, and day in which t occurs.
func (t Time) Date() (year int, month Month, day int) {
	year, month, day, _ = absDate(t.abs())
	return
}

// Year returns the year in which t occurs.
func (t Time) Year() int {
	year, _, _, _ := absDate(t.abs())
	return year
}

// Month returns the month of the year specified by t.
func (t Time) Month() Month {
	_, month, _, _ := absDate(t.abs())
	return month
}

// Day returns the day of the month specified by t.
func (t Time) Day() int {
	_, _, day, _ := absDate(t.abs())
	return day
}

// Weekday returns the day of the week specified by t.
func (t Time) Weekday() Weekday {
	return absWeekday(t.abs())
}

// ISOWeek returns the ISO 8601 year and week number in which t occurs. Week
// ranges from 1 to 53. Jan 01 to Jan 03 of year n might belong to week 52 or
// 53 of year n-1, and Dec 29 to Dec 31 might belong to week 1 of year n+1.
func (t Time) ISOWeek() (year, week int) {
	// The first calendar week of a year is the week including its first
	// Thursday; weeks start on Monday, so move to the Thursday of this week.
	abs := t.abs()
	d := Thursday - absWeekday(abs)
	// handle Sunday
	if d == 4 {
		d = -3
	}
	abs += int64(d) * secondsPerDay
	year, _, _, yday := absDate(abs)
	return year, yday/7 + 1
}

// Clock returns the hour, minute, and second within the day specified by t.
func (t Time) Clock() (hour, min, sec int) {
	abs := t.abs()
	s := int(abs - floorDiv(abs, secondsPerDay)*secondsPerDay)
	hour = s / secondsPerHour
	s -= hour * secondsPerHour
	min = s / secondsPerMinute
	sec = s - min*secondsPerMinute
	return
}

// Hour returns the hour within the day specified by t, in the range [0, 23].
func (t Time) Hour() int {
	h, _, _ := t.Clock()
	return h
}

// Minute returns the minute offset within the hour specified by t, in the
// range [0, 59].
func (t Time) Minute() int {
	_, m, _ := t.Clock()
	return m
}

// Second returns the second offset within the minute specified by t, in the
// range [0, 59].
func (t Time) Second() int {
	_, _, s := t.Clock()
	return s
}

// Nanosecond returns the nanosecond offset within the second specified by t,
// in the range [0, 999999999].
func (t Time) Nanosecond() int { return int(t.nsec) }

// YearDay returns the day of the year specified by t, in the range [1,365]
// for non-leap years, and [1,366] in leap years.
func (t Time) YearDay() int {
	_, _, _, yday := absDate(t.abs())
	return yday + 1
}

// After reports whether the time instant t is after u.
func (t Time) After(u Time) bool {
	return t.sec > u.sec || t.sec == u.sec && t.nsec > u.nsec
}

// Before reports whether the time instant t is before u.
func (t Time) Before(u Time) bool {
	return t.sec < u.sec || t.sec == u.sec && t.nsec < u.nsec
}

// Compare compares the time instant t with u. If t is before u, it returns
// -1; if t is after u, it returns +1; if they're the same, it returns 0.
func (t Time) Compare(u Time) int {
	switch {
	case t.Before(u):
		return -1
	case t.After(u):
		return +1
	}
	return 0
}

// Equal reports whether t and u represent the same time instant. Two times
// can be equal even if they are in different locations.
func (t Time) Equal(u Time) bool {
	return t.sec == u.sec && t.nsec == u.nsec
}

// IsZero reports whether t represents the zero time instant, January 1, year
// 1, 00:00:00 UTC.
func (t Time) IsZero() bool {
	return t.sec == 0 && t.nsec == 0
}

// Add returns the time t+d.
func (t Time) Add(d Duration) Time {
	dsec := int64(d / 1000000000)
	nsec := t.nsec + int32(d%1000000000)
	if nsec >= 1000000000 {
		dsec++
		nsec -= 1000000000
	} else if nsec < 0 {
		dsec--
		nsec += 1000000000
	}
	t.sec += dsec
	t.nsec = nsec
	return t
}

// Sub returns the duration t-u. If the result exceeds the maximum (or
// minimum) value that can be stored in a Duration, the maximum (or minimum)
// duration will be returned.
func (t Time) Sub(u Time) Duration {
	d := Duration(t.sec-u.sec)*Second + Duration(t.nsec-u.nsec)
	// Check for overflow or underflow.
	switch {
	case u.Add(d).Equal(t):
		return d // d is correct
	case t.Before(u):
		return minDuration // t - u is negative out of range
	default:
		return maxDuration // t - u is positive out of range
	}
}

// Since returns the time elapsed since t.
func Since(t Time) Duration {
	return Now().Sub(t)
}

// Until returns the duration until t.
func Until(t Time) Duration {
	return t.Sub(Now())
}

// norm returns nhi, nlo such that
//
//	hi * base + lo == nhi * base + nlo
//	0 <= nlo < base
func norm(hi, lo, base int) (nhi, nlo int) {
	if lo < 0 {
		n := (-lo-1)/base + 1
		hi -= n
		lo += n * base
	}
	if lo >= base {
		n := lo / base
		hi += n
		lo -= n * base
	}
	return hi, lo
}

// Date returns the Time corresponding to
//
//	yyyy-mm-dd hh:mm:ss + nsec nanoseconds
//
// in the appropriate zone for that time in the given location.
//
// The month, day, hour, min, sec, and nsec values may be outside their usual
// ranges and will be normalized during the conversion. For example, October
// 32 converts to November 1.
//
// Date panics if loc is nil.
func Date(year int, month Month, day, hour, min, sec, nsec int, loc *Location) Time {
	if loc == nil {
		panic("time: missing Location in call to Date")
	}

	// Normalize month, overflowing into year.
	m := int(month) - 1
	year, m = norm(year, m, 12)
	month = Month(m) + 1

	// Normalize nsec, sec, min, hour, overflowing into day.
	sec, nsec = norm(sec, nsec, 1000000000)
	min, sec = norm(min, sec, 60)
	hour, min = norm(hour, min, 60)
	day, hour = norm(day, hour, 24)

	// Compute days since the epoch.
	d := daysSinceEpoch(year)
	d += int64(daysBefore[month-1])
	if isLeap(year) && month >= March {
		d++ // February 29
	}
	d += int64(day - 1)
	abs := d * secondsPerDay
	abs += int64(hour*secondsPerHour + min*secondsPerMinute + sec)

	// The wall clock reading is abs in loc; find the offset that was in
	// effect, first guessing with the reading itself as the UTC time.
	unix := abs + internalToUnix
	_, offset := lookupZone(loc, unix)
	if offset != 0 {
		_, offset = lookupZone(loc, unix-int64(offset))
	}
	t := Time{sec: abs - int64(offset), nsec: int32(nsec)}
	return t.setLoc(loc)
}

// Unix returns the local Time corresponding to the given Unix time, sec
// seconds and nsec nanoseconds since January 1, 1970 UTC. It is valid to pass
// nsec outside the range [0, 999999999].
func Unix(sec int64, nsec int64) Time {
	if nsec < 0 || nsec >= 1000000000 {
		n := nsec / 1000000000
		sec += n
		nsec -= n * 1000000000
		if nsec < 0 {
			nsec += 1000000000
			sec--
		}
	}
	return Time{sec: sec + unixToInternal, nsec: int32(nsec), loc: Local}
}

// UnixMilli returns the local Time corresponding to the given Unix time, msec
// milliseconds since January 1, 1970 UTC.
func UnixMilli(msec int64) Time {
	return Unix(msec/1000, (msec%1000)*1000000)
}

// UnixMicro returns the local Time corresponding to the given Unix time, usec
// microseconds since January 1, 1970 UTC.
func UnixMicro(usec int64) Time {
	return Unix(usec/1000000, (usec%1000000)*1000)
}

// Now returns the current local time.
func Now() Time {
	n := hostNow()
	return Time{sec: n/1000000000 + unixToInternal, nsec: int32(n % 1000000000), loc: Local}
}

// Unix returns t as a Unix time, the number of seconds elapsed since January
// 1, 1970 UTC.
func (t Time) Unix() int64 { return t.unixSec() }

// UnixMilli returns t as a Unix time, the number of milliseconds elapsed since
// January 1, 1970 UTC.
func (t Time) UnixMilli() int64 {
	return t.unixSec()*1000 + int64(t.nsec)/1000000
}

// UnixMicro returns t as a Unix time, the number of microseconds elapsed since
// January 1, 1970 UTC.
func (t Time) UnixMicro() int64 {
	return t.unixSec()*1000000 + int64(t.nsec)/1000
}

// UnixNano returns t as a Unix time, the number of nanoseconds elapsed since
// January 1, 1970 UTC. The result is undefined if the Unix time in
// nanoseconds cannot be represented by an int64 (a date before the year 1678
// or after 2262).
func (t Time) UnixNano() int64 {
	return t.unixSec()*1000000000 + int64(t.nsec)
}

// UTC returns t with the location set to UTC.
func (t Time) UTC() Time { return t.setLoc(UTC) }

// Local returns t with the location set to local time.
func (t Time) Local() Time { return t.setLoc(Local) }

// In returns a copy of t representing the same time instant, but with the
// copy's location information set to loc for display purposes.
//
// In panics if loc is nil.
func (t Time) In(loc *Location) Time {
	if loc == nil {
		panic("time: missing Location in call to Time.In")
	}
	return t.setLoc(loc)
}

// Location returns the time zone information associated with t.
func (t Time) Location() *Location {
	l := t.loc
	if l == nil {
		l = UTC
	}
	return l
}

// Zone computes the time zone in effect at time t, returning the abbreviated
// name of the zone (such as "CET") and its offset in seconds east of UTC.
func (t Time) Zone() (name string, offset int) {
	return t.zone()
}

// AddDate returns the time corresponding to adding the given number of years,
// months, and days to t. For example, AddDate(-1, 2, 3) applied to January 1,
// 2011 returns March 4, 2010.
//
// AddDate normalizes its result in the same way that Date does, so, for
// example, adding one month to October 31 yields December 1, the normalized
// form for November 31.
func (t Time) AddDate(years int, months int, days int) Time {
	year, month, day := t.Date()
	hour, min, sec := t.Clock()
	return Date(year+years, month+Month(months), day+days, hour, min, sec, int(t.nsec), t.Location())
}

// div divides t by d and returns the remainder, and whether the quotient is
// odd. The quotient is not needed beyond its parity.
func div(t Time, d Duration) (qmod2 int, r Duration) {
	neg := false
	nsec := t.nsec
	sec := t.sec
	if sec < 0 {
		// Operate on absolute value.
		neg = true
		sec = -sec
		nsec = -nsec
		if nsec < 0 {
			nsec += 1000000000
			sec-- // sec >= 1 before the -- so safe
		}
	}

	switch {
	// Special case: 2d divides 1 second.
	case d < Second && Second%(d+d) == 0:
		qmod2 = int(nsec/int32(d)) & 1
		r = Duration(nsec % int32(d))

	// Special case: d is a multiple of 1 second.
	case d%Second == 0:
		d1 := int64(d / Second)
		qmod2 = int(sec/d1) & 1
		r = Duration(sec%d1)*Second + Duration(nsec)

	// General case.
	// This could be faster if more cleverness were applied,
	// but it's really only here to avoid special case restrictions in the API.
	// No one will care about these cases.
	default:
		// Compute nanoseconds as 128-bit number.
		usec := uint64(sec)
		tmp := (usec >> 32) * 1000000000
		u1 := tmp >> 32
		u0 := tmp << 32
		tmp = (usec & 0xFFFFFFFF) * 1000000000
		u0x := u0
		u0 = u0 + tmp
		if u0 < u0x {
			u1++
		}
		u0x = u0
		u0 = u0 + uint64(nsec)
		if u0 < u0x {
			u1++
		}

		// Compute remainder by subtracting r<<k for decreasing k.
		// Quotient parity is whether we subtract on last round.
		d1 := uint64(d)
		for d1>>63 != 1 {
			d1 <<= 1
		}
		d0 := uint64(0)
		for {
			qmod2 = 0
			if u1 > d1 || u1 == d1 && u0 >= d0 {
				// subtract
				qmod2 = 1
				u0x = u0
				u0 = u0 - d0
				if u0 > u0x {
					u1--
				}
				u1 -= d1
			}
			if d1 == 0 && d0 == uint64(d) {
				break
			}
			d0 >>= 1
			d0 |= (d1 & 1) << 63
			d1 >>= 1
		}
		r = Duration(u0)
	}

	if neg && r != 0 {
		// If input was negative and not an exact multiple of d, we computed q, r such that
		//	q*d + r = -t
		// But the right answers are given by -(q-1), d-r:
		//	q*d + r = -t
		//	-q*d - r = t
		//	-(q-1)*d + (d - r) = t
		qmod2 ^= 1
		r = d - r
	}
	return
}

// Truncate returns the result of rounding t down to a multiple of d (since
// the zero time). If d <= 0, Truncate returns t unchanged.
func (t Time) Truncate(d Duration) Time {
	if d <= 0 {
		return t
	}
	_, r := div(t, d)
	return t.Add(-r)
}

// Round returns the result of rounding t to the nearest multiple of d (since
// the zero time). The rounding behavior for halfway values is to round up. If
// d <= 0, Round returns t unchanged.
func (t Time) Round(d Duration) Time {
	if d <= 0 {
		return t
	}
	_, r := div(t, d)
	if lessThanHalf(r, d) {
		return t.Add(-r)
	}
	return t.Add(d - r)
}

// ParseError describes a problem parsing a time string.
type ParseError struct {
	Layout     string
	Value      string
	LayoutElem string
	ValueElem  string
	Message    string
}

// Error returns the string representation of a ParseError.
func (e *ParseError) Error() string {
	if e.Message == "" {
		return "parsing time " +
			quote(e.Value) + " as " +
			quote(e.Layout) + ": cannot parse " +
			quote(e.ValueElem) + " as " +
			quote(e.LayoutElem)
	}
	return "parsing time " +
		quote(e.Value) + e.Message
}

// quote returns s as a double-quoted string, escaping what Go's strconv.Quote
// escapes for the characters a layout or value can hold.
func quote(s string) string {
	const lowerhex = "0123456789abcdef"
	buf := make([]byte, 1, len(s)+2) // slice will be at least len(s) + quotes
	buf[0] = '"'
	for i := 0; i < len(s); i++ {
		c := byte(s[i])
		switch {
		case c >= 0x80:
			// Pass multi-byte characters through unchanged.
			buf = append(buf, c)
		case c == '"' || c == '\\':
			buf = append(buf, '\\', c)
		case c == '\n':
			buf = append(buf, '\\', 'n')
		case c == '\r':
			buf = append(buf, '\\', 'r')
		case c == '\t':
			buf = append(buf, '\\', 't')
		case c < ' ' || c == 0x7f:
			buf = append(buf, '\\', 'x', lowerhex[c>>4], lowerhex[c&0xF])
		default:
			buf = append(buf, c)
		}
	}
	buf = append(buf, '"')
	return string(buf)
}
