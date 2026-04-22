# Plan: `time` package additions — formatting and parsing

## Goal

Extend the existing `time` shim with date formatting and parsing. The current shim covers
`time.Now()`, `time.Since()`, `time.Sleep()`, and duration constants. The missing piece
is converting between `time.Time` values and human-readable strings — a common need in
any app that displays dates or reads them from user input.

Go's time package uses a reference-time layout (`"2006-01-02"`) rather than format codes
(`"%Y-%m-%d"`). The shim translates Go layouts to JS `Intl.DateTimeFormat` / manual
string construction.

## Scope

| Symbol | Go signature | Notes |
|---|---|---|
| `time.Time` | named type | Backed by a JS `Date` object at runtime |
| `t.Format(layout)` | method on `time.Time` | Go layout → formatted string |
| `t.String()` | method | `t.Format(time.RFC3339)` |
| `t.Unix()` | method | seconds since epoch |
| `t.UnixMilli()` | method | milliseconds since epoch |
| `t.Year()`, `t.Month()`, `t.Day()` | methods | calendar components |
| `t.Hour()`, `t.Minute()`, `t.Second()` | methods | time-of-day components |
| `t.Weekday()` | method | `0` (Sunday) – `6` (Saturday) |
| `t.Add(d)` | method | returns new `time.Time` offset by duration |
| `t.Sub(u)` | method | returns duration between two times |
| `t.Before(u)`, `t.After(u)`, `t.Equal(u)` | methods | comparison |
| `time.Parse(layout, value)` | `func(string,string) (time.Time, error)` | Go layout → `Date` |
| `time.Unix(sec, nsec)` | `func(int64,int64) time.Time` | from epoch seconds |
| `time.Date(y,m,d,h,min,s,ns,loc)` | `func(...) time.Time` | construct specific date |
| `time.RFC3339` | `string` constant | `"2006-01-02T15:04:05Z07:00"` |
| `time.RFC3339Nano` | `string` constant | `"2006-01-02T15:04:05.999999999Z07:00"` |
| `time.DateOnly` | `string` constant | `"2006-01-02"` |
| `time.TimeOnly` | `string` constant | `"15:04:05"` |
| `time.DateTime` | `string` constant | `"2006-01-02 15:04:05"` |

## Approach

### `time.Time` at runtime

`time.Now()` already returns `Date.now()` — a number (millisecond epoch). This plan
changes the runtime representation to a proper `Date` object wrapped in a plain JS
object so methods can be called:

```js
{ _d: new Date() }   // time.Now()
{ _d: new Date(sec * 1000) }  // time.Unix(sec, 0)
```

The `_d` wrapper is needed because GoFront does not allow method calls on raw JS
primitives without a named type.

> **Note:** `time.Now()` currently returns `Date.now()` (a number). Changing this is a
> breaking change for code that passes the result to `time.Since()`. Both functions must
> be updated together.

### TypeChecker

Add a `time.Time` named type with its method set. Register as both a type and a namespace
member:

```js
const TIME_T = { kind: "named", name: "time.Time", underlying: ANY };
const timeMethods = new Map([
  ["Format",   { kind: "func", params: [STRING], returns: [STRING] }],
  ["String",   { kind: "func", params: [], returns: [STRING] }],
  ["Unix",     { kind: "func", params: [], returns: [INT] }],
  ["UnixMilli",{ kind: "func", params: [], returns: [INT] }],
  ["Year",     { kind: "func", params: [], returns: [INT] }],
  ["Month",    { kind: "func", params: [], returns: [INT] }],
  ["Day",      { kind: "func", params: [], returns: [INT] }],
  ["Hour",     { kind: "func", params: [], returns: [INT] }],
  ["Minute",   { kind: "func", params: [], returns: [INT] }],
  ["Second",   { kind: "func", params: [], returns: [INT] }],
  ["Weekday",  { kind: "func", params: [], returns: [INT] }],
  ["Add",      { kind: "func", params: [INT], returns: [TIME_T] }],
  ["Sub",      { kind: "func", params: [TIME_T], returns: [INT] }],
  ["Before",   { kind: "func", params: [TIME_T], returns: [BOOL] }],
  ["After",    { kind: "func", params: [TIME_T], returns: [BOOL] }],
  ["Equal",    { kind: "func", params: [TIME_T], returns: [BOOL] }],
]);
```

`time.Now`, `time.Since`, `time.Parse`, `time.Unix`, `time.Date` return `TIME_T` or
`(TIME_T, error)`.

### CodeGen — layout translation

Go's reference time: `Mon Jan 2 15:04:05 MST 2006`

Translate Go layout strings to a JS formatter at runtime. Emit a helper `__timeFmt`:

```js
function __timeFmt(d, layout) {
  const pad = (n, w=2) => String(n).padStart(w, "0");
  return layout
    .replace("2006", d.getFullYear())
    .replace("06",   String(d.getFullYear()).slice(-2))
    .replace("01",   pad(d.getMonth()+1))
    .replace("1",    String(d.getMonth()+1))
    .replace("02",   pad(d.getDate()))
    .replace("2",    String(d.getDate()))
    .replace("15",   pad(d.getHours()))
    .replace("3",    String(d.getHours() % 12 || 12))
    .replace("04",   pad(d.getMinutes()))
    .replace("4",    String(d.getMinutes()))
    .replace("05",   pad(d.getSeconds()))
    .replace("5",    String(d.getSeconds()))
    .replace("PM",   d.getHours() < 12 ? "AM" : "PM")
    .replace("Mon",  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()])
    .replace("Monday", ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()])
    .replace("Jan",  ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()])
    .replace("Z07:00", (() => { const o=-d.getTimezoneOffset(); return o===0?"Z":(o>0?"+":"-")+pad(Math.floor(Math.abs(o)/60))+":"+pad(Math.abs(o)%60); })())
    .replace(".000", "."+pad(d.getMilliseconds(),3))
    .replace(".999", d.getMilliseconds()>0?"."+String(d.getMilliseconds()).replace(/0+$/,""):"");
}
```

`t.Format(layout)` → `__timeFmt(t._d, layout)`

### CodeGen — `time.Parse`

Parse a Go layout string and value string into a `Date`. Emit a runtime parser `__timeParse`:

```js
function __timeParse(layout, value) {
  // Extract year, month, day, hour, min, sec from value using layout as a template.
  // For common layouts, use Date.parse or manual extraction.
  // Falls back to new Date(value) for RFC3339.
  try {
    if (layout === "2006-01-02T15:04:05Z07:00" || layout === "2006-01-02T15:04:05Z") {
      const d = new Date(value); if (isNaN(d)) throw 0; return [{_d:d}, null];
    }
    // ... pattern-based extraction for other layouts
    const d = new Date(value); if (isNaN(d)) throw 0; return [{_d:d}, null];
  } catch { return [{_d:new Date(0)}, "parsing time: invalid format"]; }
}
```

Full layout-to-regex translation is complex. For v0.0.8, handle the common named
constants (`RFC3339`, `DateOnly`, `DateTime`, `TimeOnly`) directly, and fall through
to `new Date(value)` for others.

### Method calls on `time.Time`

`t.Format(...)`, `t.Year()`, etc. emit as plain JS method calls on the shim object:
- `t.Year()` → `t._d.getFullYear()`
- `t.Month()` → `t._d.getMonth()+1`
- `t.Day()` → `t._d.getDate()`
- `t.Hour()` → `t._d.getHours()`
- `t.Unix()` → `Math.floor(t._d.getTime()/1000)`
- `t.UnixMilli()` → `t._d.getTime()`
- `t.Add(d)` → `{_d: new Date(t._d.getTime()+d)}`
- `t.Sub(u)` → `t._d.getTime() - u._d.getTime()`
- `t.Before(u)` → `t._d < u._d`
- `t.After(u)` → `t._d > u._d`
- `t.Equal(u)` → `t._d.getTime() === u._d.getTime()`

These are handled in the codegen method-call dispatch for the `time.Time` named type.

## Edge cases

- **Breaking change**: `time.Now()` changes from returning a number to `{_d: new Date()}`.
  `time.Since()` must be updated to accept `{_d}` and return milliseconds.
  `time.Sleep(time.Second)` etc. must still work — duration constants remain integers.
- **`time.Month`**: Go's `Month` type has named constants (`time.January = 1`). Add
  `January` through `December` as integer constants in the `time` namespace.
- **`time.Weekday`**: Add `Sunday` through `Saturday` as integer constants.
- **Location / timezone**: `time.UTC` and `time.Local` are accepted as arguments to
  `time.Date` but the shim ignores the location (JS `Date` uses the local timezone).
  Document as a known limitation.

## Constants to add

```
time.January=1 ... time.December=12
time.Sunday=0  ... time.Saturday=6
time.RFC3339, time.RFC3339Nano, time.DateOnly, time.TimeOnly, time.DateTime
time.UTC, time.Local  (typed as ANY, accepted by time.Date but ignored)
```

## JS output examples

```go
t := time.Now()
fmt.Println(t.Format("2006-01-02"))
fmt.Println(t.Year(), t.Month(), t.Day())

p, err := time.Parse("2006-01-02", "2024-12-25")
```

```js
let t = {_d: new Date()};
console.log(__timeFmt(t._d, "2006-01-02"));
console.log(__sprintf("%v %v %v", t._d.getFullYear(), t._d.getMonth()+1, t._d.getDate()));

let [p, err] = __timeParse("2006-01-02", "2024-12-25");
```

## Not in scope

- Monotonic clock readings (`time.Since` precision)
- Timezone-aware formatting beyond UTC offset
- `time.Ticker` / `time.Timer` (require goroutines)
- Full Go layout string parser for exotic layouts (deferred to v0.0.9)
