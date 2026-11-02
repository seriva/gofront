// GoFront test suite — time (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.  Times use UTC and
// fixed zones, so the results do not depend on the host's time zone.

import { assertFourWay, section, test } from "../helpers.js";

section("time (Go-source)");

test("Date, Clock, Compare, Stringer, JSON and zero values", async () => {
	await assertFourWay(
		`package main

import (
	"encoding/json"
	"fmt"
	"time"
)

type T struct {
	time.Duration
	N int
}

func main() {
	t := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	fmt.Println(t.Compare(t.Add(1)), t.Compare(t), t.Add(1).Compare(t))
	h, m, s := t.Clock()
	fmt.Println(h, m, s)
	var st fmt.Stringer = 3 * time.Second
	fmt.Println(st.String())
	fmt.Println(struct{ D time.Duration }{time.Second})
	fmt.Println(T{time.Second, 1})
	fmt.Printf("%v %d %s %T\\n", time.Minute, time.Minute, time.Minute, time.Minute)
	fmt.Printf("%v %T\\n", time.March, time.March)
	b, err := json.Marshal(t)
	fmt.Println(string(b), err)
	var back time.Time
	err = json.Unmarshal(b, &back)
	fmt.Println(back, err, back.Equal(t))
	fmt.Println(time.Time{}, time.Time{}.IsZero(), time.Time{}.Unix())
	y, w := time.Date(2021, 1, 3, 0, 0, 0, 0, time.UTC).ISOWeek()
	fmt.Println(y, w)
	loc := time.FixedZone("EST", -5*3600)
	t2 := t.In(loc)
	fmt.Println(t2, t2.Location(), t2.Hour())
	fmt.Println(t.Format(time.RFC1123), "|", t.Format(time.Kitchen), "|", t.Format(time.StampMilli))
	d, err := time.ParseDuration("1h15m30.5s")
	fmt.Println(d, err, d.Seconds())
	_, err = time.ParseDuration("abc")
	fmt.Println(err)
	fmt.Println(t.AddDate(0, 1, 30).Format(time.DateOnly), t.Truncate(time.Hour).Format(time.TimeOnly), t.Round(24*time.Hour))
	fmt.Println(time.Unix(1704067200, 0).UTC())
	fmt.Println(time.UnixMilli(1704067200123).UTC().Format(time.RFC3339Nano))
	m1 := map[time.Month]string{time.May: "m"}
	fmt.Println(m1)
	var tm time.Time
	fmt.Println(tm.Year(), tm.Month(), tm.Weekday())
}
`,
		`-1 0 1
3 4 5
3s
{1s}
1s
1m0s 60000000000 1m0s time.Duration
March time.Month
"2020-01-02T03:04:05Z" <nil>
2020-01-02 03:04:05 +0000 UTC <nil> true
0001-01-01 00:00:00 +0000 UTC true -62135596800
2020 53
2020-01-01 22:04:05 -0500 EST EST 22
Thu, 02 Jan 2020 03:04:05 UTC | 3:04AM | Jan  2 03:04:05.000
1h15m30.5s <nil> 4530.5
time: invalid duration "abc"
2020-03-03 03:00:00 2020-01-02 00:00:00 +0000 UTC
2024-01-01 00:00:00 +0000 UTC
2024-01-01T00:00:00.123Z
map[May:m]
1 January Monday
`,
	);
});

test("layout constants, normalisation, ISO weeks, zones and durations", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"time"
)

func main() {
	t := time.Date(2009, time.November, 10, 23, 4, 5, 123456789, time.UTC)
	for _, l := range []string{time.ANSIC, time.UnixDate, time.RubyDate, time.RFC822, time.RFC822Z, time.RFC850, time.RFC1123, time.RFC1123Z, time.RFC3339, time.RFC3339Nano, time.Kitchen, time.Stamp, time.StampMilli, time.StampMicro, time.StampNano, time.DateTime, time.DateOnly, time.TimeOnly} {
		fmt.Println(t.Format(l))
	}
	fmt.Println(t.Format("Monday, January 2, 2006 3:04:05 pm .000 .999 Z07:00 -07 002 __2"))
	fmt.Println(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format("3:04PM 03 15"), time.Date(2020, 1, 1, 12, 5, 0, 0, time.UTC).Format("3:04PM 03 15"))
	// leap years
	for _, y := range []int{1900, 2000, 2023, 2024} {
		fmt.Println(y, time.Date(y, 3, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1).Day(), time.Date(y, 12, 31, 0, 0, 0, 0, time.UTC).YearDay())
	}
	// normalisation
	fmt.Println(time.Date(2021, 14, 35, 25, 61, 61, 1500000000, time.UTC))
	// ISO weeks
	for _, d := range [][3]int{{2019, 12, 30}, {2021, 1, 1}, {2020, 12, 31}, {2016, 1, 3}, {2026, 12, 31}} {
		y, w := time.Date(d[0], time.Month(d[1]), d[2], 0, 0, 0, 0, time.UTC).ISOWeek()
		fmt.Println(d, y, w)
	}
	// zones
	est := time.FixedZone("EST", -5*3600)
	te := time.Date(2022, 6, 15, 12, 0, 0, 0, est)
	fmt.Println(te, te.UTC(), te.Unix(), te.Equal(te.UTC()), te == te.UTC())
	name, off := te.Zone()
	fmt.Println(name, off, te.Location(), te.UTC().Location())
	fmt.Println(te.Format(time.RFC3339), te.Format(time.RFC822Z))
	fmt.Println(time.Date(2022, 6, 15, 12, 0, 0, 0, time.FixedZone("", 19800)))
	// durations
	for _, d := range []time.Duration{0, 1, 999, 1000, 1500, 1500000, 1500000000, 90 * time.Minute, -2*time.Hour - 30*time.Second, 1<<63 - 1, -1 << 63} {
		fmt.Println(d, d.Round(time.Second), d.Truncate(time.Minute), d.Abs())
	}
	d := 3*time.Hour + 25*time.Minute + 45*time.Second + 500*time.Millisecond
	fmt.Println(d.Hours(), d.Minutes(), d.Seconds(), d.Milliseconds(), d.Microseconds(), d.Nanoseconds())
	// Sub/Add/Before/After
	a := time.Date(2020, 2, 28, 12, 0, 0, 0, time.UTC)
	b := a.Add(36 * time.Hour)
	fmt.Println(b, b.Sub(a), a.Sub(b), a.Before(b), a.After(b), b.Weekday(), b.YearDay())
	fmt.Println(a.Add(-1*time.Nanosecond).Format(time.RFC3339Nano))
	fmt.Println(a.UnixNano(), a.UnixMilli(), a.UnixMicro())
	fmt.Println(time.Date(1969, 12, 31, 23, 59, 59, 999999999, time.UTC).UnixNano())
	fmt.Println(time.Date(1600, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(1600, 1, 1, 0, 0, 0, 0, time.UTC).Weekday())
	fmt.Println(time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC).Year())
	fmt.Printf("%v|%s|%d\\n", time.July, time.Friday, time.Saturday)
	fmt.Println(time.Month(13), time.Weekday(8))
}
`,
		`Tue Nov 10 23:04:05 2009
Tue Nov 10 23:04:05 UTC 2009
Tue Nov 10 23:04:05 +0000 2009
10 Nov 09 23:04 UTC
10 Nov 09 23:04 +0000
Tuesday, 10-Nov-09 23:04:05 UTC
Tue, 10 Nov 2009 23:04:05 UTC
Tue, 10 Nov 2009 23:04:05 +0000
2009-11-10T23:04:05Z
2009-11-10T23:04:05.123456789Z
11:04PM
Nov 10 23:04:05
Nov 10 23:04:05.123
Nov 10 23:04:05.123456
Nov 10 23:04:05.123456789
2009-11-10 23:04:05
2009-11-10
23:04:05
Tuesday, November 10, 2009 11:04:05 pm .123 .123 Z +00 314 314
12:00AM 12 00 12:05PM 12 12
1900 28 365
2000 29 366
2023 28 365
2024 29 366
2022-03-08 02:02:02.5 +0000 UTC
[2019 12 30] 2020 1
[2021 1 1] 2020 53
[2020 12 31] 2020 53
[2016 1 3] 2015 53
[2026 12 31] 2026 53
2022-06-15 12:00:00 -0500 EST 2022-06-15 17:00:00 +0000 UTC 1655312400 true false
EST -18000 EST UTC
2022-06-15T12:00:00-05:00 15 Jun 22 12:00 -0500
2022-06-15 12:00:00 +0530 +0530
0s 0s 0s 0s
1ns 0s 0s 1ns
999ns 0s 0s 999ns
1µs 0s 0s 1µs
1.5µs 0s 0s 1.5µs
1.5ms 0s 0s 1.5ms
1.5s 2s 0s 1.5s
1h30m0s 1h30m0s 1h30m0s 1h30m0s
-2h0m30s -2h0m30s -2h0m0s 2h0m30s
2562047h47m16.854775807s 2562047h47m16.854775807s 2562047h47m0s 2562047h47m16.854775807s
-2562047h47m16.854775808s -2562047h47m16.854775808s -2562047h47m0s 2562047h47m16.854775807s
3.4293055555555556 205.75833333333333 12345.5 12345500 12345500000 12345500000000
2020-03-01 00:00:00 +0000 UTC 36h0m0s -36h0m0s true false Sunday 61
2020-02-28T11:59:59.999999999Z
1582891200000000000 1582891200000 1582891200000000
-1
1600-01-01 00:00:00 +0000 UTC Saturday
-1
July|Friday|6
%!Month(13) %!Weekday(8)
`,
	);
});

test("Parse, ParseInLocation, ParseDuration, JSON and text round trips", async () => {
	await assertFourWay(
		`package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Event struct {
	At   time.Time     \`json:"at"\`
	Wait time.Duration \`json:"wait"\`
}

func main() {
	cases := [][2]string{
		{time.RFC3339, "2024-01-15T10:30:00Z"},
		{time.RFC3339, "2024-01-15T10:30:00+02:00"},
		{time.RFC3339Nano, "2024-01-15T10:30:00.123456789-07:00"},
		{time.RFC3339, "2024-01-15T10:30:00.5Z"},
		{time.DateTime, "2024-02-29 23:59:59"},
		{time.Kitchen, "3:04PM"},
		{time.RFC1123, "Mon, 15 Jan 2024 10:30:00 UTC"},
		{time.RFC1123Z, "Mon, 15 Jan 2024 10:30:00 -0500"},
		{time.ANSIC, "Mon Jan  1 02:03:04 2024"},
		{"2006-01-02 3:04:05 PM", "2024-03-05 12:00:01 AM"},
		{"Jan 2 2006", "Mar 7 2023"},
		{"2006-002", "2024-060"},
		{"2006-01-02", "2023-02-29"},
		{time.RFC3339, "2024-13-15T10:30:00Z"},
		{time.RFC3339, "2024-01-15T25:30:00Z"},
		{time.RFC3339, "not a time"},
		{time.DateOnly, "2024-01-15 extra"},
		{time.TimeOnly, "10:30"},
	}
	for _, c := range cases {
		t, err := time.Parse(c[0], c[1])
		if err != nil {
			var pe *time.ParseError
			fmt.Println("error:", err, errors.As(err, &pe))
			continue
		}
		fmt.Println(t, t.Unix())
	}
	t, err := time.ParseInLocation(time.DateTime, "2024-05-06 07:08:09", time.FixedZone("X", 3600))
	fmt.Println(t, err, t.UTC())
	for _, s := range []string{"300ms", "-1.5h", "2h45m", "1us", "1µs", "0", "+5s", "1.5", "", "3x", "10000000h", ".s", "9223372036854775807ns", "9223372036854775808ns"} {
		d, err := time.ParseDuration(s)
		fmt.Println(d, err)
	}
	ev := Event{time.Date(2024, 1, 15, 10, 30, 0, 500, time.UTC), 90 * time.Second}
	b, err := json.Marshal(ev)
	fmt.Println(string(b), err)
	var back Event
	err = json.Unmarshal(b, &back)
	fmt.Println(back.At, back.Wait, err, back.At.Equal(ev.At))
	err = json.Unmarshal([]byte(\`{"at":"nope"}\`), &back)
	fmt.Println(err)
	mt, err := ev.At.MarshalText()
	fmt.Println(string(mt), err)
	var tt time.Time
	fmt.Println(tt.UnmarshalText([]byte("2024-01-15T10:30:00+05:30")), tt)
	_, err = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC).MarshalJSON()
	fmt.Println(err)
}
`,
		`2024-01-15 10:30:00 +0000 UTC 1705314600
2024-01-15 10:30:00 +0200 +0200 1705307400
2024-01-15 10:30:00.123456789 -0700 -0700 1705339800
2024-01-15 10:30:00.5 +0000 UTC 1705314600
2024-02-29 23:59:59 +0000 UTC 1709251199
0000-01-01 15:04:00 +0000 UTC -62167164960
2024-01-15 10:30:00 +0000 UTC 1705314600
2024-01-15 10:30:00 -0500 -0500 1705332600
2024-01-01 02:03:04 +0000 UTC 1704074584
2024-03-05 00:00:01 +0000 UTC 1709596801
2023-03-07 00:00:00 +0000 UTC 1678147200
2024-02-29 00:00:00 +0000 UTC 1709164800
error: parsing time "2023-02-29": day out of range true
error: parsing time "2024-13-15T10:30:00Z": month out of range true
error: parsing time "2024-01-15T25:30:00Z": hour out of range true
error: parsing time "not a time" as "2006-01-02T15:04:05Z07:00": cannot parse "not a time" as "2006" true
error: parsing time "2024-01-15 extra": extra text: " extra" true
error: parsing time "10:30" as "15:04:05": cannot parse "" as ":" true
2024-05-06 07:08:09 +0100 X <nil> 2024-05-06 06:08:09 +0000 UTC
300ms <nil>
-1h30m0s <nil>
2h45m0s <nil>
1µs <nil>
1µs <nil>
0s <nil>
5s <nil>
0s time: missing unit in duration "1.5"
0s time: invalid duration ""
0s time: unknown unit "x" in duration "3x"
0s time: invalid duration "10000000h"
0s time: invalid duration ".s"
2562047h47m16.854775807s <nil>
0s time: invalid duration "9223372036854775808ns"
{"at":"2024-01-15T10:30:00.0000005Z","wait":90000000000} <nil>
2024-01-15 10:30:00.0000005 +0000 UTC 1m30s <nil> true
parsing time "nope" as "2006-01-02T15:04:05Z07:00": cannot parse "nope" as "2006"
2024-01-15T10:30:00.0000005Z <nil>
<nil> 2024-01-15 10:30:00 +0530 +0530
Time.MarshalJSON: year outside of range [0,9999]
`,
	);
});

test("embedded Duration promotes String", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"time"
)

type D int64

func (d D) String() string { return "D!" }

type T struct {
	D
	N int
}
type U struct {
	time.Duration
	N int
}

func main() {
	var s fmt.Stringer = T{5, 1}
	fmt.Println(s.String(), s)
	var u fmt.Stringer = U{time.Second, 1}
	fmt.Println(u.String(), u)
	fmt.Println(U{time.Second, 1}, &U{time.Minute, 2})
}
`,
		`D! D!
1s 1s
1s 1m0s
`,
	);
});

test("Now, Since and Until follow the host clock", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"time"
)

func main() {
	t0 := time.Now()
	fmt.Println(time.Since(t0) >= 0, time.Until(t0) <= 0, t0.Year() >= 2024)
	fmt.Println(time.Now().Sub(t0) >= 0, !t0.IsZero(), t0.Location() == time.Local)
	u := time.Unix(1700000000, 0)
	fmt.Println(u.Unix(), u.UTC().Format(time.RFC3339), u.Equal(u.UTC()))
}
`,
		`true true true
true true true
1700000000 2023-11-14T22:13:20Z true
`,
	);
});
