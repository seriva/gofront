package main

import (
	"fmt"
	"time"
)

func main() {
	// 1. Duration: ParseDuration, Truncate, Round, Abs
	for _, s := range []string{"10s", "-1.5h", "300ms", "20us", "20µs", "50ns", "2h45m", "0", "1h2m3.456s"} {
		d, err := time.ParseDuration(s)
		if err != nil {
			fmt.Printf("err: %v\n", err)
		} else {
			fmt.Printf("%s: %d\n", s, int64(d))
		}
	}
	_, err := time.ParseDuration("invalid")
	fmt.Println("invalid err:", err != nil)

	d := 123456789 * time.Nanosecond
	fmt.Println(d.Truncate(time.Millisecond))
	fmt.Println(d.Round(time.Millisecond))
	fmt.Println((-d).Truncate(time.Millisecond))
	fmt.Println((-d).Round(time.Millisecond))
	fmt.Println((-d).Abs())

	// 2. Time: AddDate, Truncate, Round, Compare, YearDay, ISOWeek
	t := time.Date(2026, time.April, 15, 12, 34, 56, 789123456, time.UTC)
	fmt.Println(t.AddDate(1, 2, 3).Format(time.RFC3339))
	fmt.Println(t.Truncate(time.Hour).Format(time.RFC3339Nano))
	fmt.Println(t.Truncate(time.Minute).Format(time.RFC3339Nano))
	fmt.Println(t.Truncate(time.Second).Format(time.RFC3339Nano))
	fmt.Println(t.Round(time.Hour).Format(time.RFC3339Nano))
	fmt.Println(t.Round(time.Minute).Format(time.RFC3339Nano))
	fmt.Println(t.Round(time.Second).Format(time.RFC3339Nano))

	t2 := time.Date(2026, time.April, 15, 12, 34, 56, 789123456, time.UTC)
	tEarly := time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC)
	tLate := time.Date(2027, time.December, 31, 0, 0, 0, 0, time.UTC)
	fmt.Println(t.Compare(t2), t.Compare(tEarly), t.Compare(tLate))

	fmt.Println(t.YearDay())
	fmt.Println(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC).YearDay())
	fmt.Println(time.Date(2024, time.December, 31, 0, 0, 0, 0, time.UTC).YearDay())

	yw, w := t.ISOWeek()
	fmt.Println(yw, w)
	yw, w = time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC).ISOWeek()
	fmt.Println(yw, w)
	yw, w = time.Date(2024, time.December, 30, 0, 0, 0, 0, time.UTC).ISOWeek()
	fmt.Println(yw, w)

	// 3. FixedZone, Location
	loc := time.FixedZone("EST", -5*3600)
	tLoc := time.Date(2026, time.April, 15, 12, 0, 0, 0, loc)
	zoneName, zoneOffset := tLoc.Zone()
	fmt.Println(loc.String(), zoneName, zoneOffset)

	// 4. Month.String, Weekday.String
	fmt.Println(time.January.String(), time.December.String(), time.Month(0).String())
	fmt.Println(time.Sunday.String(), time.Saturday.String(), time.Weekday(7).String())
	fmt.Println(t.Month().String(), t.Weekday().String())

	// 5. MarshalJSON, UnmarshalJSON, MarshalText, UnmarshalText
	mj, _ := t.MarshalJSON()
	fmt.Println(string(mj))
	mt, _ := t.MarshalText()
	fmt.Println(string(mt))

	var tUnmarshaled time.Time
	_ = tUnmarshaled.UnmarshalJSON(mj)
	fmt.Println(tUnmarshaled.Equal(t))

	var tTextUnmarshaled time.Time
	_ = tTextUnmarshaled.UnmarshalText(mt)
	fmt.Println(tTextUnmarshaled.Equal(t))
}
