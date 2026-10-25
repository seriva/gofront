# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **`crypto` digests, `encoding/base32`, `unicode/utf16` and `sync/atomic`**: MD5, SHA-1, SHA-384/512 (including SHA-512/224 and /256), HMAC and `crypto/subtle` now give Go's results in both JavaScript and WebAssembly. They are for checksums, cache keys and HMAC checks, not hardened against side-channel attacks, so use Web Crypto for real cryptography. Also added: base32 and UTF-16 matching Go, and single-threaded `sync/atomic` (64-bit values are exact only up to 2^53 on JavaScript, and in WebAssembly `atomic.Value` does not panic when you store a different type). Fixed: WebAssembly programs no longer fail to build when two types have a method with the same name but different parameters.
- **`context`, `container`, and `hash` standard library packages**: `context` cancellation trees, deadlines, and value propagation, container data structures (`heap`, `list`, `ring`), and non-cryptographic hashes (`adler32`, `crc32`, `fnv`) are now available across both JavaScript and WebAssembly targets with exact Go parity.
- **`bufio` and `net/url` standard library packages**: `bufio` buffered I/O (`Reader`, `Writer`, `Scanner`, `ReadWriter`) and `net/url` URL parsing and query escaping are now available across both JavaScript and WebAssembly targets with exact Go parity.
- **`sync`, `testing`, and stdlib audit items (Phase 3.4, Tasks 3.5–3.7)**: Completed concurrency, test framework, and standard library audit items across JavaScript and WebAssembly backends. Implemented single-threaded `sync.Map`, `sync.Pool`, `OnceFunc`, `OnceValue`, and `OnceValues` in pure Go (`runtime/stdlib/sync/extra.go`), added `sync.RWMutex.RLocker()` returning `sync.Locker`, and added blocking wait exclusions for `sync.Cond` and goroutine start exclusion for `sync.WaitGroup.Go`. Expanded `testing` support: added `t.Cleanup` with LIFO cleanup order guaranteed in finally blocks (including after `Fatal`), `t.Setenv` with automatic environment restoration during cleanup, `t.Deadline`, `t.Context`, `t.Parallel` (no-op), `t.SkipNow`, `t.Attr`, and `t.Output`. Implemented `testing.B` with benchmark loop adaptivity (`b.Loop`, `b.N`), timer controls (`ResetTimer`, `StartTimer`, `StopTimer`), metric reporting (`ReportAllocs`, `ReportMetric`, `SetBytes`, `Elapsed`), `-bench` CLI flag parsing and runner execution, and `TestMain(m *testing.M)` lifecycle support honoring `m.Run()` exit codes. Excluded host file-system testing methods (`TempDir`, `Chdir`, `ArtifactDir`) and runtime concurrency (`RunParallel`, `SetParallelism`). Added WasmGC boundary and cleanup export helper `__testing_cleanup_cb`. Added conformance fixture `test/conformance/sync/extra.go` and verified stdlib coverage gate with zero missing members in `sync` and `testing`.
- **`math`, `time`, and `strings`/`bytes` buffer completion (Phase 3.3, Tasks 3.4a–3.4c)**: Completed core standard library gaps in `math`, `time`, `strings`, and `bytes` across JavaScript and WebAssembly backends. Added `math.Gamma`, `Lgamma`, `Erf`, `Erfc`, `J0`, `J1`, `Jn`, `Y0`, `Y1`, `Yn`, `FMA`, `RoundToEven`, `Nextafter`, `Nextafter32`, and exact 64-bit `bits` arithmetic and bitwise operations (`Add64`, `Sub64`, `Mul64`, `Div64`, `Rem64`, `LeadingZeros`, `TrailingZeros`, `OnesCount`, `Len`, `RotateLeft`, `Reverse`). Added `time.Duration` methods (`Truncate`, `Round`, `Abs`), `time.Time` methods (`AddDate`, `Truncate`, `Round`, `Compare`, `YearDay`, `ISOWeek`, `MarshalJSON`/`UnmarshalJSON`/`MarshalText`/`UnmarshalText` using integer nanoseconds), location constructor `FixedZone`, and stringers (`Month.String`, `Weekday.String`). Implemented `strings.ToValidUTF8`, `bytes.ToValidUTF8`, `bytes.NewBuffer`, `bytes.NewBufferString`, and completed `bytes.Buffer`, `strings.Reader`, and `bytes.Reader` method sets (`Read`, `ReadByte`, `UnreadByte`, `ReadRune`, `UnreadRune`, `ReadBytes`, `ReadString`, `ReadFrom`, `WriteTo`, `Next`, `Truncate`, `Available`, `AvailableBuffer`, `Peek`, `ReadAt`, `Seek`, `Size`). Resolved review follow-up P48: non-ASCII byte indexing in `bytes.Index`, `LastIndex`, `Contains`, and `Count` returns byte offsets matching Go, with fast non-naive subslice matching. Added conformance fixtures `math/extra.go`, `bits/wide.go`, `time/members.go`, `strings/members.go`, `bytes/buffer.go`, and `bytes/index.go`.
- **`io`, `sort`, `unicode`, and `strconv` completion (Phase 3.2, Tasks 3.1f, 3.2, 3.3a–3.3c)**: Completed core standard library packages across both JavaScript and WebAssembly backends. Added `fmt.Fscan`, `Fscanf`, `Fscanln` reading tokens, verbs, and lines from `io.Reader`. Implemented `sort.Slice`, `SliceStable`, `SliceIsSorted`, `Search`, `Ints`, `Float64s`, `Strings`, `IntsAreSorted`, `Float64sAreSorted`, `StringsAreSorted`, `SearchInts`, `SearchFloat64s`, `SearchStrings`, and `Interface` in pure Go (`runtime/stdlib/sort/sort.go`). Added `io.CopyBuffer`, `CopyN`, `ReadAll`, `LimitedReader`, `Discard`, `MultiReader`, `MultiWriter`, `TeeReader`, `SectionReader`, `NopCloser`, standard stream/scanner interfaces, and errors in pure Go (`runtime/stdlib/io/io.go`). Implemented `unicode/utf8` byte slice APIs (`EncodeRune`, `AppendRune`, `DecodeRune`, `DecodeLastRune`, `RuneCount`, `FullRune`, `Valid`, `RuneStart`, `RuneSelf`), compact general-category tables, predicate helpers (`Is`, `In`, `IsOneOf`, `IsNumber`, `IsSymbol`, `IsMark`, `IsTitle`), case mapping (`To`, `ToTitle`), and `SimpleFold` in pure Go (`runtime/stdlib/unicode/`), aligning whitespace predicates per review follow-up P16. Added `strconv.NumError` with `Error()` and `Unwrap()`, `IntSize`, quoting functions (`QuoteRune`, `QuoteToASCII`, `QuoteRuneToASCII`, `QuoteToGraphic`, `QuoteRuneToGraphic`, `AppendQuote*`), `CanBackquote`, `UnquoteChar`, `QuotedPrefix`, `IsPrint`, and `IsGraphic`, with `Parse*` functions across JS and WASM returning `*NumError` wrapping `ErrSyntax` or `ErrRange` with full `errors.Is` and `errors.As` support. All 6 new conformance fixtures match Go 1.26 on both backends.
- **`fmt` verbs, 64-bit integer formatting, and `os.Stdout` (Phase 3.1.3, Tasks 3.1c–3.1e)**: Complete implementation of Go format verbs across both JavaScript and WebAssembly backends. Added `%T` (static type or dynamic type on interface operands), `%U` (`U+%04X`), `%q` on runes, `%#v` (Go syntax literals including struct names, slices, maps, and typed nils), `%#x`/`%#X` (`0x`/`0X` prefix), sign flags (`%+d`, `% d`), explicit 1-based indexing (`%[n]`), dynamic width and precision (`%*d`, `%.*f`), `%x`/`%X` on byte slices with space flag support (`% x`), and `%p` printing `%!p(T=val)`. In WASM, 64-bit integers formatted with `%d`, `%x`, `%o`, `%b` preserve exact precision beyond 2⁵³ without `f64` truncation (e.g. `uint64(1<<63+5)` formats as `9223372036854775813`), and negative `int64` under `%x`/`%o`/`%b` formats with a leading sign rather than two's complement. Format errors match Go diagnostics: `%!s(MISSING)`, `%!(EXTRA T=v)`, `%!d(BADINDEX)`, and `%!(NOVERB)`. Added `os.Stdout`, `os.Stderr`, and `os.Stdin` as `*os.File` satisfying `io.Writer` and `io.Reader` across JS and WASM, writing through a shared line buffer (`__os_buf` in JS, console write buffer in WASM) that flushes on newline. Conformance fixtures `fmt/verbs.go` and `fmt/errors.go` match Go on both backends.
- **`fmt` on WASM: `any` operands and `Stringer`/`error` dispatch (Phase 3.1.2, Tasks 3.1b-any, 3.1b-wasm)**: In WebAssembly, `fmt.Println`, `Sprint`, `Printf` and friends now print values held in `any` or any interface type (numbers, strings, booleans, `nil`, slices, maps, structs, pointers, errors) the way Go does, accept a spread `[]any` (`fmt.Sprintf(format, args...)`, `fmt.Println(xs...)`), and print `<nil>` for `fmt.Sprintf("%v", nil)`. Values whose type has `String()` or `Error()` print through it, as on the JS backend, while `%d` still prints the number. A nil pointer whose `String` or `Error` has a pointer receiver now calls the method on both backends (`var p *C; fmt.Sprint(p)` prints `c`), and `fmt.Println(xs...)` and `fmt.Sprintf(f, xs...)` with a `[]any` now print the elements on the JS backend too. A named string type with a `String` method no longer breaks WebAssembly builds that use `errors`. Known limit: in WebAssembly a named string type with `String()` stored in an `any` still prints as the plain string.
- **Pointer stability and WASM leftovers (Phase 0.14, Tasks 0.33-0.36)**: Assigning a whole array or struct to a variable whose address was taken now updates the existing storage, so earlier pointers (`p := &a[1]; a = [3]int{4, 5, 6}`) see the new value on both backends. In WASM, a value method called through a pointer to a named number works, pointer-receiver methods on a named slice (and pointers to slices in general) update the variable, stdlib functions such as `fmt.Sprint` or `strings.ToUpper` can be stored and passed around as values (variadic ones accept up to 8 operands; `fmt` now formats `any` operands), you can range directly over a func literal, iterators that yield struct pointers compile, and `slices.Values` works over a slice of a generic struct. The same function-value support was added to the JS backend, where such values were previously undefined.
- **Parser and generics leftovers (Phase 0.13, Tasks 0.29-0.32)**: Map literals can leave out the key type (`map[P]int{{1}: 2}`), a type defined over a named array can be indexed and sliced, explicit instantiation works through a package name (`cmp.Compare[int](1, 2)`, `iter.Seq[int](f)`), generic types can refer to themselves, and generic structs can embed a struct, be defined over one (`type S[T any] Base`) and be told apart in a type switch on the JS backend.
- **`Stringer` and `error` dispatch for `%v`/`%s` on the JS backend (Phase 3.1.1, Task 3.1b-js)**: `fmt` now prints a value through its `Error() string` or `String() string` method, as Go does, in `Println`, `Printf`, `Sprint*`, `Errorf` and `Fprint*`: top-level, and nested in slices, arrays, maps and the exported fields of structs (`[]Color{Red}` prints `[red]`, `Holder{C: Green}` prints `{green}`; user types behind unexported fields are not dispatched, as in Go, while `errors.New`/`Errorf` values there still print their message; an embedded `error` or `fmt.Stringer` field is promoted, so `W{error; Code}` prints the error text; `%#v` does not call `String`). `Error` wins over `String`; a value-receiver method applies to a value and to a pointer, a pointer-receiver method only to a pointer (`fmt.Println(c)` prints `{5}` where `fmt.Println(&c)` prints `counter=5`), and taking the address of a slice element or struct field does not turn the value into a pointer when it is printed inside its slice or struct (`[]PS` prints `[{1} {2}]` after `&ps[0]`). `fmt.Stringer` is now a type. The conformance harness gained a JS-only fixture mode (first line `//conformance:js-only`) for fixtures that only the JS backend supports.
- **`maps` iterator members and `strings`/`bytes` sequence members (Phase 2.2, Tasks 2.3–2.5)**: New `maps.All`, `maps.Insert` and `maps.Collect`, and `maps.Keys` and `maps.Values` over `iter.Seq`, written in Go (overlay `runtime/stdlib/maps/iter.go`, both backends). New `strings.Lines`, `SplitSeq`, `SplitAfterSeq`, `FieldsSeq` and `FieldsFuncSeq`, and the same five in `bytes` (overlays `runtime/stdlib/strings/iter.go` and `runtime/stdlib/bytes/iter.go`, Go 1.24 signatures); the `bytes` versions yield sub-slices of the input with clipped capacity, and conformance fixtures `strings/seq.go` and `bytes/seq.go` match go1.26 output on both backends. As in `slices`, the functions take `map[K]V` rather than a `Map ~map[K]V` type parameter (no core types), so they are listed under `signature` in `stdlib-coverage.gaps.json`. `slices.Sorted(maps.Keys(m))` on a WASM map with `NaN` keys keeps each entry.
- **`iter` package and slices iterator members (Phase 2.1, Tasks 2.1–2.2b)**: `iter.Seq` and `iter.Seq2` are written in Go (`runtime/stdlib/iter`) and work on both backends, so a function can return `iter.Seq[int]` and callers range over it. `iter.Pull` and `iter.Pull2` report `requires coroutines; out of scope (no runtime)`. New `slices` members `All`, `Values`, `Backward`, `Collect`, `AppendSeq`, `Sorted`, `SortedFunc`, `SortedStableFunc` and `Chunk` (Go overlay `runtime/stdlib/slices/iter.go`); `Chunk` panics with `cannot be less than 1` for `n < 1`. Type inference now unifies instantiated generic types (`iter.Seq[E]` against `iter.Seq[int]`, or against a plain func type), a qualified generic type such as `iter.Seq[int]` counts as using its import and links in WASM, and substituting type arguments keeps those of a generic named type. The conformance runner now builds fixtures like a project, with the Go-source stdlib; new fixture `slices/iter.go`.
- **Conformance harness, generated stdlib docs and audit reconciliation (Phase 1.2, Tasks 1.3a–1.5)**: `npm run conformance` (part of `npm test`) compiles every `test/conformance/<pkg>/<name>.go` as a `both` package, runs `main` on JS and on WASM, and compares each stdout byte for byte with `<name>.out`; bootstrap fixtures cover `strings`, `strconv` and `fmt`. `npm run conformance:update` captures the `.out` files with `go run` (go1.26) and fails clearly when `go` is missing; CI needs no Go. The runner rejects fixtures that apply `len`, indexing or `range` to a non-ASCII string literal (GoFront counts UTF-16 code units, Go counts bytes). `npm run docs:stdlib` generates the stdlib coverage tables in `docs/language-support.md` and `docs/hybrid-wasm.md` from the manifest and the coverage gaps, and `npm run check` fails when they are stale. Every coverage-gate failure is now assigned to a task in the portable Go plan, with per-package supported/excluded counts.
- **Stdlib coverage gate by signature (Task 1.2b)**: `goSignature` (`src/typechecker/stdlib/signature.js`) prints checker types in Go's `api/*.txt` notation, and the coverage gate compares every implemented member's signature with Go's. The 163 known mismatches are listed in `stdlib-coverage.gaps.json` with GoFront's current signature.
- **Stdlib coverage gate by name (Task 1.2a)**: `test/unit/types/stdlib-coverage.test.js` checks every manifest member against the checker namespaces, `WASM_STDLIB_MEMBERS` and the Go-source packages, and checks that excluded packages and members report their exclusion reason. The current shortfall (1,245 missing members, 16 members missing in wasm packages, 691 exclusions without a diagnostic) is listed in `stdlib-coverage.gaps.json`; an unlisted gap or a listed gap that is fixed fails the test.
- **Stdlib manifest statuses (Task 1.1b)**: Every member in `runtime/stdlib/manifest.json` is classified by the scope rule (`both`, `js`, or `excluded:<category>` with a `note`) from `scripts/manifest-overrides.json`; no member is left `todo`. Examples: `time.Sleep` and `os.Getenv` are `js`, `time.After` and `sync.Cond` are `excluded:runtime`, `os.Open` is `excluded:host`, `unicode.Han` is `excluded:deferred`.
- **Stdlib coverage manifest (Task 1.1a)**: `scripts/stdlib-manifest.js` (`npm run manifest:update`) reads Go's `api/go1.*.txt` files up to go1.26 and writes `runtime/stdlib/manifest.json`, one entry per package member (`pkg`, `name`, `kind`, `signature` in Go's API notation, `status`). Members of the 52 in-scope packages start as `todo`; every other standard library package is recorded as `excluded:runtime`, `excluded:host`, `excluded:reflection` or `excluded:deferred`. The file is checked in, so tests and CI do not need a Go toolchain.
- **Method expressions on pointer receivers (Task 0.15)**: `(*C).Inc` is a `func(*C)` value on both backends, as in Go (it reported `cannot dereference non-pointer type C`). Method expressions also work on generic types (`(*Box[int]).Set`, `Box[int].Get`), and in WASM, where neither `(*T).M` nor `T.M` worked before (`Unknown field 'Get' on struct 'C'`): a call through a method expression becomes a direct method call and any other use a forwarding closure, including variadic and multi-value methods.
- **Generic type aliases (Task 0.14)**: `type Set[T comparable] = map[T]struct{}` and `type Alias[T any] = Box[T]` (Go 1.24) work on both backends. An instantiation substitutes its type arguments into the aliased type and is exactly that type (`Set[int]` is `map[int]struct{}`, `Alias[int]` is `Box[int]` with its methods), in composite literals, parameter types and other generics. Previously `Set[int]{}` failed with `Unknown struct in CompositeLit: undefined`. A wrong type-argument count reports `got 2 type arguments but Set has 1 type parameters`.
- **Reachability-based emission for Go-source stdlib (Task 0.7)**: Only the Go-source stdlib functions, methods, types and variables reachable from user code are emitted, in JS output and in `app.wasm` (including dev builds, where Binaryen does not run). An imported but unused Go-source package adds 0 bytes to `app.js` and `app.wasm`.
- **`//gofront:intrinsic` with the deadline timer (Task 0.6d)**: A body-less function preceded by `//gofront:intrinsic <name>` gets a backend-provided implementation. The only intrinsic is `deadline_timer(ns int64, fire func())`: JS output arms a `setTimeout`, WASM returns at once (cooperative model). Unknown names, a body, or a different signature are compile errors (`unknown intrinsic 'x'`).
- **Go-source stdlib name coexistence and diagnostics (Task 0.6c)**: A user package may share a name with a Go-source stdlib package (`./cmp` next to `cmp`) on both backends. A failure inside Go-source stdlib (a type error, an overlay collision, an import cycle) is reported at the user's import as `internal stdlib error in <path>; please report`, with the underlying message as a note and no location inside `runtime/stdlib/`.
- **Go-source overlays and `errors.ErrUnsupported` (Task 0.6b)**: A `runtime/stdlib/<path>/` directory for an existing emitter-backed package is an overlay: its Go declarations join that package's namespace on both backends, and inside the overlay unqualified references to emitter members (`New`) resolve to the emitter implementation. An overlay that redeclares an emitter member fails with `overlay redeclares errors.New`. First overlay: `errors.ErrUnsupported`.
- **Go-source stdlib loader and `cmp` (Task 0.6a)**: Standard library packages can now be written in GoFront Go under `runtime/stdlib/<import path>/`. An import resolves there before the built-in package list; the package is type-checked and compiled into its importer's target (JS for `js` importers, linked into `app.wasm` for `wasm` importers, both for `both`), with strict numerics and no boundary facade. Its top-level names are mangled (`Compare$$cmp`) so they never collide with user declarations, and diagnostics show them as `cmp.Ordered`. First package: `cmp` (`Ordered`, `Compare`, `Less`, `Or`), with no hand-written checker entry. The npm package now ships `runtime/`.
- **Parity matrix generator (Task 0.5b)**: Added `test/unit/language/parity-matrix.test.js` orchestrating automated conformance tests from the 52 rows of `docs/language-support.md`; compiles and executes each fixture as a `both` package using `compileHybrid`, verifying execution and diagnostic parity across JavaScript and WebAssembly backends; cleanly logs and skips accepted differences and pending items.
- **Language-support parity rows with fixture annotations (Task 0.5a)**: Annotated every row in the Core language, Types & data structures, Control flow, and Expressions & literals tables of `docs/language-support.md` with one-line fixture snippets (`<!-- fixture: … -->`) or explicit exclusion reasons (`<!-- no-fixture: … -->`); added rows for per-iteration loop variables, `min`/`max`/`clear`, `[]rune` conversions, constant expressions, generic type aliases, pointer-receiver method expressions, runtime panics, and `goto` diagnostic; corrected value-receiver method expressions.
- **Complex numbers: equality, map keys, and fmt (Task 0.4b)**: Implemented complex number equality (`==` and `!=`) with float semantics (`NaN` parts never match); map key hashing and comparison for `map[complex128]T` and `map[complex64]T` using IEEE float rules across real and imaginary parts; and composite argument conversion to externref JS objects for `fmt.Sprintf` (`%v`, `%g`, `%e`, `%f`), correctly formatting complex values like `(1+2i)` and `(1-2i)`.
- **Complex number representation and arithmetic in WASM (Task 0.4a)**: Added immutable WasmGC struct representation (`$complex64` with two `f32` fields and `$complex128` with two `f64` fields) for complex numbers; implemented `complex`, `real`, and `imag` builtins; arithmetic operators (`+`, `-`, `*`, `/`) matching Go semantics; unary `-` and `+`; complex literals (`3i`); width conversions (`complex128(c64)` and `complex64(c128)`); numeric scalar to complex conversions; compound assignments (`+=`, `-=`, `*=`, `/=`); and division by `0+0i` yielding `Inf`/`NaN` without traps.
- **Generic named func types in WASM (Task 0.3)**: Instantiated generic named func types (e.g. `type Seq[V any] func(yield func(V) bool)` specialized as `Seq[int]`) correctly resolve to their underlying closure signature during WebAssembly compilation, allowing generic iterators like `Map[A, B any]` and functions returning `Seq[T]` to type-check and execute with full JS/WASM parity.
- **Range-over-func control flow and error semantics (Task 0.2b)**: Implemented labeled `break` and `continue` across iterator boundaries, `return` from iterator body with enclosing function unwinding and defer execution, panic propagation through iterators with enclosing `recover()`, and re-yield panic detection with Go's standard message in both WASM and JS backends.
- **Range-over-func in WASM backend**: Implemented Go 1.23 range-over-func (`for v := range seq`, `for k, v := range seq2`, `for range seq0`) in the WebAssembly backend; synthesized yield callback closures with environment capture and state tracking for plain `break` and `continue`, achieving full parity with the JavaScript backend.
- **WASM accessor refs at the JS boundary and documentation**: Supported crossing accessor refs through the JS↔WASM boundary via copy-in/copy-out `{ value }` boxes with live getters and setters; updated `docs/go-compatibility.md` pointer documentation to reflect pointer identity and accessor ref semantics across JS and WASM.
- **WASM pointer dereference dispatch and accessor ref identity**: Dispatched pointer dereference expressions (`*p`) and assignments (`*p = v`) between box and accessor subtypes with getter/setter helpers; implemented scalar pointer identity comparisons (`==` and `!=`) comparing target references and indices across accessor refs, boxes, and struct equality fields in both WASM and JS.
- **WASM accessor refs for fields and elements**: Added subtype `$acc_T` implementing scalar pointers to struct fields (`&s.F`) and slice/array elements (`&xs[i]`) with getter/setter helpers; updated dereference assignment (`*p = v`) to dispatch between box and accessor refs.
- **WASM pointer type hierarchy**: Emitted abstract supertype `$ptr_T` with box struct `$box_T` as a subtype (`sub $ptr_T`) for scalar pointer types.

### Changed
- **BREAKING: `maps.Keys` and `maps.Values` return `iter.Seq` (Task 2.3)**: As in Go 1.23, they no longer return `[]K` and `[]V`. Range over the result (`for k := range maps.Keys(m)`) or collect it: `slices.Collect(maps.Keys(m))`, or `slices.Sorted(maps.Keys(m))` for a sorted slice. Code that passes the result where a slice is expected, such as `sort.Strings(maps.Keys(m))`, now reports `Cannot assign iter.Seq[string] to []string` with the hint `use slices.Collect(maps.Keys(m)) for a slice`. The same hint is reported for `len`/`cap`, spread (`append(a, maps.Keys(m)...)`) and slice conversion (`[]string(maps.Keys(m))`) of an `iter.Seq` value. The in-repo uses are migrated to `slices.Collect` (unit tests); nothing in `example/` used them, and a smoke build of SimpleFPS needs no change.
- **`goto` diagnostic (Task 0.17)**: `goto L` is now a keyword and is reported in every target as `goto is not supported; restructure with labeled break/continue` (it failed with `Undefined: 'goto'`). A `goto` counts as a terminating statement, so it does not also report a missing return.
- **Index-check elision in strict mode (Task 0.16b)**: The JS copy of a `both` package emits a plain `xs[i]` instead of a bounds-checked access for `for i := range xs` and `for i := K; i < len(xs); i++` loops whose body never reassigns, shadows or takes the address of `xs` or `i` (and no closure in the function writes them), and for constant indexes into arrays. WASM index checks report Go's message without slowing the hot path: a failing check branches to one handler per function that recomputes the length. The hybrid raycast benchmark is within 1% of v1.7.0.
- **Shared constant folder (Task 0.13a)**: Constant expressions are now evaluated once, by the checker, with a backend-independent folder (`src/typechecker/const-fold.js`, moved from the WASM backend): exact `BigInt` integers, `Number` floats (untyped integral floats such as `1e18 + 1` stay exact), all arithmetic, bitwise, shift and comparison operators, unary `- ^ !`, conversions, `len` of a constant string and `min`/`max` of constants. The value is attached to the AST node. Typed constants follow their type (`^uint8(0)` is `255`). New diagnostics with Go's wording: `constant 1099511627776 overflows int32` for conversions and typed constant arithmetic, `cannot use 200 (untyped int constant) as int8 value in variable declaration (overflows)` for assignments, and `invalid operation: division by zero` for constant division. The integer `math` limits (`math.MaxInt64`, `math.MaxUint64`, …) are untyped constants as in Go, so `var x int64 = math.MaxUint64 >> 1` compiles. Keyed array literal keys such as `len("abc")`, `min(3, 2)` and dot-imported constants resolve to their index. The WASM backend emits the checker's value, so `const big = 1 << 100; var x = big >> 98` gives `4` instead of `0` and expressions over package constants fold.
- **Clone elision for arrays in WASM (Task 0.8b)**: `b := a` (and `b = a`) between two local arrays, and `for _, v := range a` over a local array, share the array instead of copying it when the ownership analysis proves that neither variable is ever written in place, sliced, address-taken or used as a method receiver in the function (closures included). A copy always stays when the source is mutated after it.

### Fixed
- **JS value semantics now match Go in more places (Phase 0.12, Tasks 0.24-0.28)**: Comparing and copying values inside generic code treats struct and array type arguments as values, `f(xs...)` passes the caller's slice (and a nil slice stays nil), `m == nil` is true for a nil map and false for an empty one, `fmt.Append(nil)` stays nil, and an elided `&T` in `[]*T{{1}}` builds the pointer. Writes through a promoted field and calls to promoted pointer-receiver methods reach the embedded struct, struct map keys print and sort as in Go, package-level arrays and named scalars can have their address taken, and `[N]T` with a named constant `N` has length `N` on both backends.
- **String escapes and integer semantics (Phase 0.11, Tasks 0.21-0.23)**: String literals now decode every Go escape (`"\x00"` is one character instead of four, and `\a`, `\v`, `\u00e9` and octal escapes work), and an unknown escape such as `"\q"` is a compile error as in Go. `\xNN` above `\x7f` is the character U+00NN, so `[]byte("\xc3")` has two bytes where Go has one. In packages that run on both targets, `^x` and `-x` on small unsigned integers wrap to the unsigned range, and 64-bit shifts by 32 or more bits give Go's result instead of wrapping the count. A shift count may now be any integer type (`x <<= n` with a `uint` count compiles), and a negative constant shift count is an error.
- **`strconv.ParseInt` returns `int64` (Task 1.2b)**: It was declared as returning `(int, error)`; Go returns `(int64, error)`. Code that assigned the result to an `int` must now convert it, as in Go.
- **Slice views in JS (Task 0.20)**: In `js` packages `b[i:]`, `b[:n]`, `b[i:j]` and `b[i:j:k]` copied the elements of a plain array, so writes through the slice were lost and `append` within capacity did not write into the shared store; they now share the backing store as in Go, including slices of arrays and of pointers to arrays (`q := p[:2]; q[0] = 9` changes `v`). A partial view of a plain array is a `Proxy` that still behaves as a JS array for callers; typed-array slices stay `subarray` views. `cap` now reports a view's capacity, the three-index form `b[i:j:k]` limits it, `make([]T, n, cap)` allocates the capacity, and slice bounds beyond the capacity panic with `slice bounds out of range`. `x = x[i:j]` within `len(x)` on a plain local or field still copies, to keep indexing fast, but keeps its capacity (`x = x[:2]; x = x[:4]` works), writes `x[i] = v` through to the old array in program order, and is not applied to parameters or named results (see `docs/go-compatibility.md`). `range` over a view reads its backing array directly. A view handed to JS is a fixed-length array (`Object.freeze` throws a `TypeError`, `Object.defineProperty` of an index writes through); the raycast benchmark is unchanged (within 3%).
- **Interop and naming leftovers (Task 0.19d)**: A struct type or a named type with methods named after a JavaScript built-in (`type Array struct{}`, `type Error struct{…}`, `type Set map[string]bool` with methods) compiled to a class that shadowed the global and broke generated helpers at runtime (`Array.isArray is not a function`); `js` and `both` packages now report `type Array shadows the JavaScript global Array; rename the type`. Exported non-shared vars of a `wasm` package (`var Limit = 40`, `var Default = Item{…}`) were missing from the JS facade, so JS code reading `cfg.Limit` got `undefined`; they are now read once when the module loads. `slices.Contains` and `slices.Index` compared struct and array elements by identity in JS (always `false`/`-1`) and threw on a nil slice. `func mk() (Box[int], *Box[int])` failed to parse with `Expected type, got ','`.
- **WASM scoping and method values (Task 0.19c)**: In `wasm`/`both` packages an inner `x := 5` overwrote the outer `x` for the rest of the function, and `x := x * 2` in an inner block read the new, zero `x`; locals are now block-scoped. A range key or value that a closure captures and mutates (`for _, v := range xs { f := func() { v *= 10 } … }`) produced an invalid module and now gets a fresh variable per iteration. Method values (`f := p.Get`, `f := c.Inc` on an addressable value, promoted pointer-receiver methods such as `o.Bump` on a loop variable) failed with `Unknown field 'Inc' on struct 'C'`; they now bind their receiver when evaluated, and a value receiver is copied then on both backends (JS bound the live struct). `o.N++` and `o.N += 2` on a promoted field produced an invalid module.
- **Array type completion (Task 0.19b)**: Named array types (`type V [3]int`) produced invalid WASM modules for literals, copies, indexing and methods; they now work on both backends, including value and pointer receivers and `==`. Pointers to arrays (`p := &a; p[i]; len(p); range p; p[:]`) failed in the checker with `Cannot index type *[3]int`, and in WASM `p := &a` was an invalid module and `*p = v` was dropped; `p` now aliases `a` on both backends, including after `a` is reassigned. Keyed slice literals (`[]int{2: 7}`) failed in WASM with `Unsupported expression kind: KeyValueExpr` and threw `index out of range` in JS; they now place elements by index, and duplicate or non-constant keys report the array-literal errors. `[2][3]int{1: {2: 5}}` built an object for the inner literal in JS. Keyed elements are evaluated in source order on both backends (they ran in index order), and WASM array literals with more than 10000 elements no longer exceed the `array.new_fixed` limit.
- **Slice aliasing and multi-value assignment (Task 0.19a)**: In `js` packages `b[:]`, `b[0:]` and `a[:]` copied the elements, so `s := b[:]; s[0] = 9` left `b[0]` unchanged; they now share the backing store as in Go (other bounds still copy, see `docs/go-compatibility.md`). In WASM, `x, y = y, x`, `a, b = b, a` on arrays and `xs[0], xs[1] = xs[1], xs[0]` assigned the first value before reading the second (`2, 2`), and `x, y := 2, x` on a redeclared `x` read the new `x` on both backends; every right-hand side is now evaluated before any assignment. `for i, j := 0, 10; i < j; i, j = i+1, j-1` emitted invalid JS (`let i, j = 0, 10`), and a post statement ending in an identifier (`i, j = j, i+j {`) failed to parse.
- **Generic zero values in JS (Task 0.18)**: JS output erases generics, so the zero value of a type parameter was `null`: `cmp.Or("", "x")` returned `""` and `cmp.Or(0, 3)` returned `0` in JS (`"x"` and `3` in WASM and Go), and `Pop` on an empty `Stack[int]` returned `null`. A generic function now takes one zero-value factory per type parameter as leading arguments (shared `__z0`/`__zs`/`__zf`/`__zn` factories for the common cases, `F[int]` as a value passes them too), and an instance of a generic struct keeps its factories under a symbol, so its methods see them even through an interface. `var z T`, `*new(T)`, named results of type `T` (which failed with `Unknown type 'T'`), recovered results, `[N]T` and `make([]T, n)` all get the instantiated type's zero value, and fields of type `T` start at it (`var b Box[int]; b.V` is `0`; `var s Stack[string]` was `null`). Unary `-` and `+` on a type parameter whose constraint is all numeric (`Abs[T Number]` returning `-x`) no longer report `- requires numeric`, and `^x` on a type parameter reports `^ requires integer` unless every type in its constraint is an integer.
- **Runtime panics in `both` packages (Task 0.16a)**: The JS copy of a `both` package now panics where Go (and WASM) do, instead of reading `undefined` or writing silently: out-of-range slice, array and string indexing (reads, writes, compound assignments, `++`/`--`, `&xs[i]`) panics with `runtime error: index out of range [5] with length 3` (`[-1]` for a negative index); a write to a nil map (including a nil map field or a missing inner map) panics with `assignment to entry in nil map`, while reads, comma-ok, `len`, `range` and `delete` still see an empty map; and a field access through a nil struct pointer panics with `runtime error: invalid memory address or nil pointer dereference`. `recover()` returns these messages. WASM index panics now carry the same index and length (they said only `runtime error: index out of range`). `js` packages are unchanged. In WASM, a field access through a nil pointer is now a Go panic (`recover()` catches it and deferred calls run) where it used to be a trap.
- **Anonymous struct literals**: `struct{ A, B int }{3, 4}` produced a JS array and `struct{ A, B int }{A: 3}` left `B` undefined in `js` packages; a literal of a struct alias (`type P = struct{ A, B int }; P{3, 4}`) built an empty object in JS and an invalid module in WASM; and `struct{}{}` failed in WASM with `Unknown struct in CompositeLit`. All of these now build the struct with every field set, on both backends.
- **JS backend emits folded constants (Task 0.13b)**: Constant expressions in JS output used JavaScript's 32-bit operators, so `1 << 40` gave `256`, `^uint8(0)` gave `-1` and `a[^uint8(0)]` read `undefined`. The JS backend now emits the checker's folded value as a literal (`1099511627776`, `255`), so `float64(x * 1000)` with `x = 1 << 40` gives `1099511627776000` on both backends. An integer constant outside ±2⁵³ emits the nearest `Number` and a compile warning, e.g. `main.go at line 4:17: constant 9223372036854775813 exceeds JS Number precision`, in `js` packages and in the JS copy of `both` packages.
- **`[]rune` conversions in WASM (Task 0.12)**: `r := []rune(s); string(r[1])` produced an invalid module (`local.tee expected (ref null 21)`) in `wasm`/`both` packages. `[]rune(s)` now builds an `int32` slice of the string's code points (surrogate pairs decode to one rune, `cap == len`), and `string(r)` concatenates them back. `len`, indexing, `append`, slicing and `range` work on the result as on any slice.
- **`min`/`max` builtins in WASM (Task 0.11)**: `min(3, 1, 2)` failed with `Unresolved identifier: min` in `wasm`/`both` packages. Integers now fold left with `select` on signed or unsigned comparisons, floats use `f32`/`f64.min`/`max` (`NaN` propagates, `min(-0.0, 0.0)` is `-0`), and strings compare through the string import. On both backends the result type is the first typed operand (`min(1, f)` with `f float64` is a `float64`), and in JS `min`/`max` over strings no longer return `NaN`.
- **Array literals are zero-filled**: In `js` packages `[3]int{1}` produced a one-element JS array and `[3]int{}` an empty one, so `a[2]` was `undefined` (arithmetic gave `NaN`, struct elements threw) and `[3]int{} == b` with `var b [3]int` was `false`. Array literals, including nested arrays, named array types and arrays of structs, strings, bools and floats, now fill every slot not given with the element zero value. Keyed array literals (`[5]int{2: 7}`, `[5]int{1, 3: 4, 5}`) place each element at its index on both backends (WASM rejected them with `Unsupported expression kind: KeyValueExpr`, JS ignored the keys), and `[...]T{...}` counts elements after a key when computing the length. Keys may be named constants or constant expressions (`[5]int{K: 7}`, `[5]int{1 + 1: 7}`, `[...]int{K: 7}`); these were treated as positional elements, putting the value at index 0 and getting `[...]` lengths wrong. A non-constant (`index k must be integer constant`), negative or duplicate array index is now a compile error, as in Go. Large array literals that leave most slots zero (`[100000]byte{}`, `[65536]int{1: 2}`) are emitted as the zero array plus the given elements instead of listing every slot, which had added hundreds of KB to the JS output.
- **Address-taken loop variables are per-iteration**: Taking the address of a three-clause `for` variable inside the loop (`ps = append(ps, &i)`, `&p`, `&p.X`) gave every iteration the same variable in WASM (`3, 3, 3` instead of Go 1.22's `0, 1, 2`), and in JS the loop variable was never boxed, so the loop did not run and later code threw `Cannot read properties of null`. An address-taken loop variable now gets a fresh copy per iteration on both backends, like a closure-captured one; loop variables that are neither captured nor address-taken stay plain locals. Implicit address-taking counts too: a pointer-receiver method call or method value on the loop variable (`p.Self()`, `p.Get`) and slicing an array loop variable (`a[:]`) gave `3, 3, 3` (JS for the method cases, WASM for the slice) instead of `0, 1, 2`.
- **Struct arguments to generic and variadic parameters are copies in JS**: Passing a struct value to a type-parameter argument (`func Push[T any](s []T, v T)`) or as a variadic element (`f(xs ...P)`) passed the caller's object, so a later `a.X = 9` changed the stored value and a callee writing `xs[0].X` changed the caller's struct (including array fields). Struct arguments are now copied at those call sites, as array arguments already were; `f(s...)` still passes the caller's slice.
- **Per-iteration loop variables in WASM (Task 0.10)**: Closures created in a three-clause `for` shared one captured variable in `wasm`/`both` packages (`fs[0]()*100 + fs[1]()*10 + fs[2]()` gave `333` instead of `12`). A captured loop variable now gets a fresh box before each post statement (Go 1.22 semantics, as in JS): each iteration's closures keep their own copy, and a write through a closure is seen by the post statement. Uncaptured loop variables stay plain locals. Only variables captured by a closure in that loop are copied, and struct and array loop variables are cloned per iteration on both backends.
- **Predeclared-name shadowing (Task 0.9)**: Builtins, browser globals and built-in package namespaces now live in a universe scope below the package scope, so a package-level `func Array()` or `var document int` and a local `len := 3` shadow them as in Go, in `js`, `wasm` and `both` packages (previously `Array redeclared in this block`). In JS output and in the WASM boundary facade such a binding is emitted with a `$` suffix (`Array$`), because the bundle is one flat module scope and generated code (`Array.from`, `Object.keys`) must keep reaching the real global; references from importing packages use the same name.
- **Array value semantics in WASM (Task 0.8a)**: Fixed-size arrays aliased instead of copying in `wasm`/`both` packages, so `b := a; b[0] = 9` changed `a` and a callee could mutate its caller's array. Arrays now copy (deeply for nested arrays and arrays of structs) on assignment, parameter passing, return, struct-field copies and literals, stores into slices, maps and interfaces, loads from them, `append` and `copy`. Zero values of nested arrays and `make([][N]T, n)` elements are real zero arrays instead of null. On both backends, `for i, v := range arr` now ranges over a copy and a map range value of array type is a copy; `copy()` between slices of arrays copies the elements in JS. Array `==`/`!=` in WASM compares elements (it compared references). Comma-ok map loads, comma-ok type assertions and type-switch bindings copy arrays on both backends. JS also copies array arguments to generic and variadic parameters, `append(dst, xs...)` elements, `[N]T(a)` conversions, and struct values in map ranges. WASM struct copies clone nested value-struct fields, and arrays of anonymous structs copy deeply.
- **Generic calls inside generic bodies in WASM**: A generic function calling another generic function with its own type parameter (`Max[T]` calling `less[T]`) failed with `Undefined: 'less'`, because monomorphisation dropped the inferred type arguments when it copied the body.
- **Generics in multi-package WASM builds**: A linked `app.wasm` with any generic declaration failed on every cross-package reference (`Undefined: 'util'`), because the monomorphisation re-check had no package namespaces. Package-qualified references are now resolved on the link's own copy of the ASTs, so linking also no longer rewrites the cached ASTs that JS code generation reuses.
- **Variadic functions in WASM**: `func f(xs ...T)` produced an invalid `.wasm` module. A variadic parameter is now a `[]T` in WASM: calls pack their trailing arguments into a slice, `f(s...)` passes `s` through, and this works for functions, methods, interface methods, closures, func values and generics. Exported variadic `wasm` functions and methods keep a rest parameter in the JS facade. The checker now types `xs` as `[]T` inside the body (ranging over a variadic parameter used to yield its elements' runes or fail), and JS output keeps the rest parameter on methods and func literals.

## [1.7.0] - 2026-10-20

### Added
- **`encoding/json` standard library package (reflection-free compile-time codegen)**:
  - `json.Marshal`, `json.MarshalIndent`, `json.Unmarshal` and `json.Valid` implemented for `js` packages via static compile-time code generation without a runtime reflection engine.
  - Struct field tag parsing and preservation: honors `json:"fieldName"`, `,omitempty`, `,string` (strings, numbers and booleans encoded/decoded as JSON strings, with Go's `invalid use of ,string struct tag` errors), `-` and `-,`, and excludes unexported lowercase struct fields.
  - Supports embedded struct field promotion with shallow field priority (conflicts at the same depth cancel each other).
  - Specialized codecs for structs, maps, slices, primitives, pointers (including pointer-to-scalar fields), and `json.RawMessage` (exact source bytes, including nested values).
  - `MarshalJSON() ([]byte, error)` methods are called on any named type with a value receiver, and with a pointer receiver only on addressable values (pointers, slice elements, fields of addressable structs), as in Go; their output is validated, compacted and HTML-escaped, and failures report `json: error calling MarshalJSON for type T: …`. `UnmarshalJSON([]byte) error` methods (pointer or value receivers, on struct and named non-struct types) receive the exact raw value bytes (including `null` for non-pointer fields); errors they return are passed through unchanged.
  - Go decoding semantics: exact, then case-insensitive field-name matching; JSON `null` leaves scalars unchanged and sets pointers, slices, maps and interfaces to `nil`; integer targets reject fractional, exponent-form and out-of-range numbers (also for top-level targets and `[]byte` arrays); error messages match Go, including the number literal, the JSON field path (`Go struct field Inner.in.n`) and the element type of pointer fields.
  - Go formatting parity: RFC 8259 string escaping with Go's HTML-safe escapes (`\u003c`, `\u003e`, `\u0026`), Go `strconv` shortest float representation (including `float32`), and Go-shaped error messages. Errors are plain `error` values; the typed `*json.SyntaxError`/`*json.UnmarshalTypeError`, `Encoder`/`Decoder` and `Number` are not implemented.
  - Diagnostic rejection for `wasm` and `both` packages pointing to `js` packages.
- **TypeScript `.d.ts` tuple return signatures to Go multi-value returns**:
  - `src/dts-parser.js` parses TypeScript tuple types `[A, B]` (including labelled `[state: S, setState: Dispatch]`).
  - In return position, maps to Go multi-value returns `(A, B)`.
  - Typechecker enforces multi-value destination count matching Go compile rules (`assignment mismatch: 1 variable but returns 2 values`).
  - JS backend codegen lowers multi-value returns directly to array destructuring (`let [a, b] = fn()`).
- **Rest-parameter variadic propagation**:
  - Fixed `_parseFuncDecl` and `_parseMemberDefault` in `src/dts-parser.js` to propagate `isRest` as `{ variadic: true }` to function types, enabling seamless calls to variadic library functions like `h(tag, props, ...children)`.
- **Submodule vendor packaging and named global exports in `src/vendor.js`**:
  - `gofront.vendor` supports subpath entries (e.g. `preact/hooks`) and named export global bindings (`window.h = preact.h`, `window.useState = preact_hooks.useState`).
  - Preact and `preact/hooks` vendored with ambient `.d.ts` typings.
- **`example/preact` TodoMVC application**:
  - Complete TodoMVC example app using Preact function components, hooks (`useState`, `useEffect`), and Go struct props, replacing the retired `example/reactive`.
  - Full feature parity with existing examples (filters, urgent priorities, localStorage async persistence, sync status, drag-and-drop).
- **Experimental WASM SIMD (`gofront/simd`)**:
  - Opt-in `gofront/simd` standard library package providing 4-wide 32-bit floating-point vector type `simd.F32x4` with Go value semantics: `simd.F32x4{a, b, c, d}`, `Splat`, `Add`, `Sub`, `Mul`, `Div`, `Min`, `Max`, `Dot3`, `Dot4`, `Lane(i)` (constant index $0 \le i \le 3$), `WithLane(i, f)`.
  - Zero value zero-initialization: `(0, 0, 0, 0)` (`v128.const` zeros in WASM, frozen `[0, 0, 0, 0]` in JS).
  - Direct linear memory buffer access: `simd.LoadF32x4(buf shared.Float32, i)` and `simd.StoreF32x4(buf, i, v)` with element offset calculation and bounds checking ($i + 4 \le \text{len}(buf)$) trapping on out-of-bounds.
  - Native WebAssembly `0xFD` opcode encoding with unsigned LEB128 sub-opcodes for SIMD instructions; WAT printing support.
  - Binaryen feature flag integration: bitmask 2014 ($2006 \mid 8$) with `--enable-simd` for release and optimization passes.
  - JS scalar fallback using `Math.fround` for bit-level 32-bit float parity.
  - JS↔WASM boundary diagnostic preventing direct `F32x4` parameter/return crossing (suggesting `gofront/shared.Float32`). In `wasm`/`both` packages this also rejects `F32x4` in exported struct fields and exported function signatures; `==` on `F32x4` and `fmt` formatting of `F32x4` are not yet supported there.
  - Raycast benchmark gating evaluated: 1.02× over scalar hybrid (below $\ge 1.30\times$ promotion gate); groundwork retained as experimental and promotion deferred to v1.8.0.

### Fixed
- **Named non-struct types with methods** (`type Celsius float64`, `type Names []string`, `type Op func(int) int`, …) in `js` packages. Values were sometimes wrapper objects and sometimes raw values, so method calls threw `TypeError`, `==`/`<`, arithmetic and map keys compared objects, zero values were `null`, and pointer-receiver methods crashed. Values now stay raw everywhere: methods dispatch statically (`Celsius.$F(c)`), pointer receivers update the variable, field or element, and values are boxed only inside interfaces. Type assertions and type switches to these types (and to `*T`) are checked at runtime, interface comparisons and `switch` on interface values compare boxed values by type and value (`err == ErrNotFound` for `type MyErr string` sentinels), and `errors.Is`/`errors.As` handle them.
- **Type assertions to interface types** — `v.(SomeInterface)` (user-declared or anonymous) and the matching type-switch cases now check that the dynamic value has the interface's methods instead of always succeeding.
- **Address-taken variables declared together** — `a, b := 1, 2` followed by `&a`, `var a, b = …`, `var v = 3` with `&v`, and `&param` on a function parameter crashed with `Cannot create property 'value'`; `var a, b = f()` with a multi-value call destructured the wrong value.
- **Assignability of identical underlying types** — `var n Names = []string{…}` and passing `[]string` where `Names` is expected were rejected; Go allows them when one side is an unnamed type literal.

### Removed
- **`example/reactive`** — retired in favor of `example/preact`, demonstrating standard ecosystem component and hook patterns with type-safe Go bindings.

## [1.6.1] - 2026-10-18

### Added
- **Language completeness in `wasm` packages** — package-level non-literal constants (`const X = len("abc") * 2` folded at compile time; runtime folded expressions initialized as module globals in the WASM `start` function); array-typed map keys (`map[[N]T]V`) hashed and compared element-wise; interface-typed map keys (`map[any]V`, `map[Interface]V`) hashed on dynamic type id plus value hash with dynamic type equality, raising Go's panic (`runtime error: hash of unhashable type ...`) on unhashable keys (slice, map, func).
- **Expanded JS ↔ WASM boundary types** —
  - `error`: crosses WASM → JS as an `Error` subclass carrying `.message` and WASM handle (`__ref`) so `errors.Is`/`Unwrap` retain identity; nil errors cross as `null`; JS → WASM accepts only WASM-owned error instances.
  - `map[K]V` (K = string, number, bool): copied bidirectionally as a fresh JS `Map` in insertion order; accepts plain JS objects or `Map`s as parameters without mutating WASM state.
  - Pointers to non-structs (`*float64`, `*int`, etc.): copy-in/copy-out box `{ value }` written back after call (write-back skipped on panic).
  - Anonymous structs: copied as plain JS objects `{ [field]: value }` with matching field names.
  - Anonymous interfaces (`interface{ ... }`): synthesized internal facade keyed on sorted method set with shared facade classes.
  - Exported non-literal constants: exposed on the JS facade as module constants read once after module initialization.
  - `time.Time` & `time.Duration`: `Duration` crosses as `Number` (`int64`); `Time` copies into the JS `time.Time` object via Unix milliseconds (preserving timezone offset).
- **Wider stdlib in `wasm` packages** —
  - `strings`: added `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `LastIndexAny`, `Map`, `IndexFunc`, `LastIndexFunc`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `NewReplacer` (+ `Replace`), and `Builder` (`WriteString`, `WriteByte`, `WriteRune`, `String`, `Len`, `Reset`, `Grow`) as an in-WASM struct.
  - `strconv`: added `Unquote` (returns Go's `ErrSyntax`), `AppendInt`, `AppendFloat`.
  - `math`: added `Remainder`.
  - `slices`: added `Compare`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Min`, `Max`, `MinFunc`, `MaxFunc`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip`; all `*Func` callbacks run inline via `call_ref`.
  - `fmt`: composite `%v` and `%+v` formatting for slices, arrays, maps, and structs matching JS backend format output; `Fprintf`, `Fprintln`, `Fprint` writing to `io.Writer`; `Sscan`, `Sscanln`, `Sscanf` scanning into pointers inside WASM.
  - `unicode`: `IsLetter`, `IsDigit`, `IsSpace`, `IsUpper`, `IsLower`, `IsPunct`, `IsControl`, `IsPrint`, `IsGraphic`, `ToUpper`, `ToLower` (inline ASCII fast path with JS Unicode table fallback).
  - `math/rand`: full pure set (`Intn`, `Float64`, `Float32`, `Int`, `Int63`, `Int63n`, `Int31`, `Int31n`, `Shuffle`, `Perm`, `Seed` as no-op) backed by `Math.random` host import.
  - `bytes`: WASM implementation of byte-slice operations and `bytes.Buffer`, with native byte loops and host JS helper delegation for string cutset operations (`Trim`, `TrimLeft`, `TrimRight`, `ContainsAny`).
  - `io`: `Reader`, `Writer`, `ReadWriter`, `Closer` interfaces, `EOF` sentinel error value, `ReadAll`, `Discard`, `WriteString`; `strings.NewReader` and `bytes.NewReader` returning native in-WASM `io.Reader`.
  - `path` & `path/filepath`: `Base`, `Dir`, `Ext`, `Join`, `Clean`, `IsAbs`, `Split`, `Match` via host JS runtime shims in `boundary.js`.
  - `html`: `EscapeString`, `UnescapeString` via host JS runtime shims in `boundary.js`.
  - `time`: `Duration` and its constants, `Time` struct and 16 methods (`Format`, `String`, `Year` .. `Second`, `Weekday`, `Unix`, `UnixMilli`, `Add`, `Sub`, `Before`, `After`, `Equal`), `Parse`, `Unix`, `Date`, layout/duration/calendar constants; `Now` and `Since` reading host clock (`Date.now`) and timezone offset imports.
- **New WASM & JS stdlib packages** —
  - `encoding/binary`: `LittleEndian`, `BigEndian` decoding (`Uint16`, `Uint32`, `Uint64`, `PutUint16`, `PutUint32`, `PutUint64`, `AppendUint16`, `AppendUint32`, `AppendUint64`), `Read`, `Write`, and `Size`. Enables fast binary data parsing (3D meshes, models, audio, networking) across JS and WASM.
  - `sync`: lightweight single-threaded concurrency shims (`sync.Mutex`, `sync.RWMutex`, `sync.Once` with `.Do()`, `sync.WaitGroup` with `.Add()`, `.Done()`, `.Wait()`).
  - `crypto/rand` & `crypto/sha256`: `crypto/rand.Read` backed by host `crypto.getRandomValues()`; `crypto/sha256.Sum256` and `crypto/sha256.New` for asset caching and integrity checks.
  - `encoding/hex`: `EncodeToString`, `DecodeString`, `EncodedLen`, `DecodedLen`, `Encode`, `Decode`.
  - `encoding/base64`: `StdEncoding`, `URLEncoding`, `RawStdEncoding`, `RawURLEncoding` (`EncodeToString`, `DecodeString`, `EncodedLen`, `DecodedLen`), `NewEncoding`.
- **Expanded standard library methods and functions** —
  - `time`: `Duration` methods (`Seconds`, `Milliseconds`, `Microseconds`, `Nanoseconds`, `Minutes`, `Hours`, `String`); `time.Time` methods (`IsZero`, `UnixNano`, `Nanosecond`, `UTC`, `Local`).
  - `slices`: `IndexFunc`, `ContainsFunc`, `BinarySearch`, `BinarySearchFunc`.
  - `strconv`: `ParseUint`, `FormatUint`, `AppendUint`, `AppendBool`.
  - `io`: `Copy`, `CopyN`, `LimitReader`.
  - `math`: IEEE-754 bit reinterpretations (`Float64bits`, `Float64frombits`, `Float32bits`, `Float32frombits` as single-opcode WASM instructions), hyperbolic functions (`Sinh`, `Cosh`, `Tanh`), and 24 math constants (`MaxInt32`, `MinInt32`, `MaxInt64`, `MinInt64`, `MaxUint32`, `MaxFloat32`, `SmallestNonzeroFloat32`, `Phi`, `Sqrt2`, `SqrtE`, `SqrtPi`, `SqrtPhi`, `Ln2`, `Log2E`, `Ln10`, `Log10E`, etc.).
  - `math/bits`: byte reversals (`ReverseBytes16`, `ReverseBytes32`, `ReverseBytes64`), `Len32`, `Len64`, `Reverse32`, `Reverse64`.
  - `math/rand`: pure inline 64-bit PRNG in WASM with deterministic `rand.Seed` and `rand.Read` (eliminating host boundary overhead).
  - `errors`: `errors.As` (chain traversal with dynamic type matching) and `errors.Join`.
  - `strings` & `bytes`: `strings.FieldsFunc`, `bytes.FieldsFunc`, `bytes.Clone`.
- **WASM codegen and optimizer improvements** —
  - Disassemble optimized binary directly in single pass on `--emit-wat` without duplicate GUFA analysis.
  - Enabled `--closed-world` and pass convergence (`--converge`) in release builds while preserving hardware nil-pointer dereference traps by default.
  - Eliminated duplicate struct allocations on function call returns (`_emitCopyIfValueStruct`).
  - Eliminated zero and overflow guards for constant divisors in `emitDivRem`, specializing powers-of-two to shifts and bitwise masks.
  - Eliminated compile-time bounds checks for fixed-size arrays with constant in-bounds indices.
  - Function-body compile-time constant folding via `foldConstExpr`.
  - Direct `WriteString` dispatch on `strings.Builder` and `bytes.Buffer` in `io.WriteString` and `fmt.Fprint*`.
  - Index-only slice range loop unpacking (omitting unused array and offset unpacks).
- **Performance & code minimization** —
  - Compiler pipeline: slice-once scanning in `Lexer` and `TemplLexer`; pooled scratch buffers and single-pass sizing in WASM module encoder; eliminated redundant AST traversals in lowering analysis (`fnMutates`, `closureMutates`).
  - Parser optimizations: module-level `ASSIGN_OPS` and `UNARY_OPS` Sets eliminating statement/expression array allocations; deduplicated identifier list parsing across struct and variable declarations.
  - Runtime zero-allocation: indexed `codePointAt` string iteration without intermediate substring allocations; fast-path positional struct instantiation; consolidated JS iterator loops; deduplicated stdlib and WASM emitter helpers.
- **Targeted diagnostics** — `time.Sleep` in `wasm`/`both` packages reports `'time.Sleep' is not yet available in wasm packages` with a hint to keep the call in a JS package, preserving the boundary between synchronous WASM and async JS event loop.

### Removed
- **`fmt.Scan`** — removed from typechecker stdlib definitions due to lack of standard input streams (`os.Stdin`) in frontend environments.

### Fixed
- **Generic struct type argument preservation** — fixed `resolveType()` clobbering instantiated generic types (e.g. `Box[int]`) with uninstantiated template types from `this.types`, restoring type safety and value-copy semantics in JS codegen.
- **Interface boxing nil preservation & recursive ptrFields** — preserved `null` for nil slices and maps in `__ifs`/`__ifps`; prevented fixed-size arrays from being marked as slices in assignability; removed recursive `__ifp` mutation of child value struct fields.
- **`[]byte` representation parity** — ensured stdlib methods (`sha256.Sum256`, `hex.DecodeString`, `base64.*.DecodeString`, `strconv.Append*`, `bytes.Buffer.Bytes()`, `bytes.*`) return `Uint8Array` rather than plain JS `Array` so `.subarray(...)` slicing succeeds.
- **`uint64` scalar Number representation** — aligned `strconv.ParseUint`, `math.Float64bits`, `binary.*.Uint64`, and `bits.RotateLeft64` with Number representation, eliminating BigInt mixing errors and restoring `x.(uint64)` assertions.
- **Helper dependencies in `useHelper`** — registered `"error"` and `"ioEOF"` in `useHelper` on `encoding/base64`, `encoding/hex`, and `encoding/binary` error code paths to prevent runtime `ReferenceError`.
- **`errors.As` & `errors.Join`** — supported interface targets in `errors.As` without `instanceof error` crash; recursively inspected slice `_errs` produced by `errors.Join`; removed `interface` from `isReferenceType` in `src/lower/boxing.js` so address-taken interface targets box properly.
- **`binary.Read` & `binary.Write`** — supported signed integers and float bitcasts in JS and WASM; implemented 1-byte integer branches, signed extension, pointer parameter targets (`p *uint32`, `p *int`), struct fields, and slice indices in WASM; implemented accessor box for struct fields and index targets in JS; registered `bytes.Buffer.Read` for `io.Reader` compliance in WASM.
- **WASM stdlib integration** — fixed `time.Time.Local()` timezone lookup; registered `sha256.digest` methods with synthetic method dispatch; registered `binary.BigEndian`/`LittleEndian` struct types; implemented `sync.Locker`, `rand.Reader`, `hex`, and `base64` members.
- **WASM optimizer nil-pointer traps** — removed `--traps-never-happen` from default optimization flags so nil pointer struct access triggers WebAssembly traps as expected in Go.
- **WASM compound assignments** — routed `/=`, `%=`, `<<=`, `>>=` through specialized arithmetic/shift emitters for pointer dereferences `*p`, struct fields `s.f`, and index expressions `a[i]`.
- **Qualified type conversions** — enforced arity and convertibility checks on `pkg.Type(...)` conversions, rejecting zero-argument calls (`time.Duration()`) and non-convertible types (`sync.Mutex(123)`).
- **`time.Time` struct equality** — ensured `t1 == t2` and `fmt.Sprintf("%v", t)` compare and format Date objects without crashing in JS.
- **Large random buffers** — chunked calls to `crypto.getRandomValues()` into 65,536-byte segments across JS runtime and WASM boundary shims.
- **Multi-return forwarding into `any`** — permitted multi-return function calls to forward directly into function parameters of type `any` / `interface{}`.
- **WASM `fmt.Sscan*` target writes** — routed `fmt.Sscan` writes through `_emitAssignToTarget` and included address-taken locals in WASM boxing analysis.
- **JS `fmt.Sscanf` format verbs** — added handling for `%x`, `%X`, `%o`, `%b`, and `%c` runes and integers in JS `_SSCAN_LOOP`.
- **Subsecond time formatting** — added support for subsecond format tokens (`.000`, `.999`, `.000000`) in JS and WASM time layout formatters.
- **Edge cases in stdlib** — fixed empty separator handling in `bytes.Split`/`Replace`; implemented character class range matching in `path.Match`; corrected `base64.RawStdEncoding.EncodedLen`; prevented double evaluation in JS stdlib inline templates (`strings.TrimSpace`, `slices.Compact`).
- **`sync.RWMutex` zero value & `strings.Builder.Len()`** — initialized `sync.RWMutex` zero values safely; updated nested anonymous struct formatting in `__sprintf`; fixed `strings.Builder.Len()` to return UTF-8 byte lengths in JS.
- **Test runner & worker pool reliability** — added `await waitForPending()` to `TEST_PARALLEL=0` to ensure async tests settle deterministically; isolated CLI test temporary directories with symlinked `node_modules`; added worker recovery on exit/error in parallel pool.
- **Layout token alternation order** — resolved two-digit layout tokens (`15`, `01`, `02`, `04`, `05`) matching after single-digit tokens (`1`, `2`, `3`, `4`, `5`) in `time.Format` and `time.Parse` layout regex.
- **Operator precedence under negation** — wrapped `Before`, `After`, and `Equal` expressions in grouping parentheses in the JS backend `time` stdlib to ensure correct evaluation when negated with `!`.
- **Selector type conversions** — fixed typechecker `_isTypeRef` resolution on namespace selectors (such as `time.Duration(x)`) and added `call._isTypeConversion` handler in WASM emitter.

## [1.6.0] - 2026-10-10

### Added
- **Language completeness in `wasm` packages (H4.1–H4.4)** — non-empty interfaces with `ref.test` dynamic dispatch over static candidate sets; generic function and struct monomorphisation; insertion-ordered map runtime matching JS `Map` order; and full `defer`/`recover` exception handling (`try_table` + `exnref`).
- **Binaryen optimization pipeline (H7.2)** — `gofront build --release` (or `--wasm-opt`) optimizes `app.wasm` through Binaryen (`-O3` + `--gufa`), preferring a native `wasm-opt` on `PATH` with fallback to the optional `binaryen` npm package, validating the result with `WebAssembly.validate`, and reporting binary size reduction (~19–23%).
- **Wider stdlib in `wasm` packages** — `errors` (`New`, `Is`, `Unwrap`), `fmt` (`Sprintf`/`Printf`/`Println`/`Errorf` with primitive, string, `error` and `any` operands), `strings`, `strconv`, `unicode/utf8`, `slices`, `maps` and `sort` join `math`, `math/bits` and `testing`. `error` values are real wasm structs with `Error()`/`Unwrap()`, and `any == any` compares boxed scalars by value (by dynamic type first, so `any(3) == any(3.0)` is `false` in wasm but `true` in the JS backend — see `docs/go-compatibility.md`). Members the backend does not implement report `'strings.Map' is not yet available in wasm packages` with a hint to move the call to a JS package; unsupported `fmt`/`testing.T` operand types explain that slices and structs must be formatted field by field.
- **`t.Run` in wasm test packages** — subtests run inside `app.wasm` with the subtest `*testing.T` routed back to the harness (`--- PASS: TestSub/inner`).
- **WASM source maps** — `gofront build --source-map` also writes `app.wasm.map` (function-level mappings, resolved `sources`) and stamps a `sourceMappingURL` custom section into the module; with `--wasm-opt`/`--release` the map is passed through Binaryen (`-ism`) so offsets stay correct after optimisation.
- **Boundary-call-in-loop hint** — a `js` package calling into a `wasm` package from inside a `for`/`range` body gets a non-fatal warning (`'phys.Step' crosses the JS→WASM boundary inside a loop`) with the suggestion to move the loop into the wasm package or pass `gofront/shared` buffers.
- **Node version check for wasm tests** — `gofront test` on a `wasm`/`both` package reports `running wasm packages requires Node 22+ (WasmGC); found vX` (with a `--js-only` hint) instead of an opaque `CompileError`.
- **WASM test hardening** — every compiled module in the unit suite is run through `WebAssembly.validate`; a golden WAT test (`test/unit/fixtures/wasm/golden.wat`, refresh with `UPDATE_GOLDEN=1`) pins the emitted shape of a small program, and size-budget tests fail when the runtime baseline (≤ 3 KiB) or the golden program (≤ 6 KiB) grow.
- **`math.Mod`, `math.Hypot`, `math.Cbrt` in `wasm` packages** — imported from JS `Math` like `Atan2`/`Pow`, with Go sign semantics for `Mod`.
- **Target guide (H7.3)** — README gains a step-by-step "choosing a target" checklist and a whole-application benchmark table from simplefps (`physics` and `animation` as `wasm`: raycasts 1.11–1.15× JS, FPS-controller fixed step 2.4× at 0.2 B/frame, 64-joint skinning 1.27× via a `gofront/shared` palette; `app.wasm` 98.5 → 79.7 kB with `--release`). `docs/hybrid-wasm.md` adds the matching rules of thumb about slice results copied per call.
- **`gofront/shared` linear-memory buffers (H6.1)** — `wasm` packages can allocate `shared.NewFloat32(n)` (and `Float64`/`Int8`/`Int16`/`Int32`/`Uint8`/`Uint16`/`Uint32`) buffers that cross the boundary as **zero-copy** TypedArray views over the module memory. Buffers support indexing, `len`, `range`, `copy` and `Subarray(lo, hi)`; allocation is restricted to package-level initialisers and `init()` so the memory is sized once and views never detach. Shared↔slice conversions, slicing, `append`/`cap`, negative constant indexes, `copy` with differing element types, and importing the package from a `both` package are compile errors; oversized allocations panic with `shared buffer length out of range`; the facade rejects foreign views with a `TypeError`. In JS-only builds the buffers lower to plain TypedArrays.
- **`example/hybrid` (H6.2)** — a particle simulation stepped in a `wasm` package and drawn to a canvas from JS through `sim.Positions`, with `.templ` controls and a Playwright E2E test (`npm run test:e2e`, project `hybrid`).
- **Target overrides (H6.3)** — `gofront build --js-only` / `--target js` (also for `dev`, `check`, `test` and `gofront <src> -o`) compiles every package to JavaScript, and `gofront.json` `"targets": { "engine/physics": "wasm" }` pins per-package targets (keyed by directory relative to the source root), replacing the `//gofront:target` directive. `build`, `dev`, `check` (including `dir/...`) and `test` all resolve the keys against the same source root.
- **Interfaces across the wasm boundary (H5.2)** — named non-empty interfaces can appear in exported signatures, struct fields, slices and callbacks. WASM values reach JS as their handle class when the dynamic type is an exported `*T`, otherwise as a facade whose methods call the wasm dispatchers. Only WASM-owned values cross back in. A `js`/`both` type converted to a `wasm` interface is a compile error, and the facade throws a `TypeError` for JS-implemented values (no cross-boundary itab proxies).

### Changed
- **`recover()` follows Go's scoping rules in both backends** — `recover()` only stops a panic when called directly by a deferred function (including `defer handlePanic()` and deferred method calls whose body calls `recover()`); a `recover()` reached through a helper or nested closure returns `nil`. A panic raised inside a deferred function replaces the in-flight panic. Earlier the JS backend's `recover()` returned the panic value from anywhere in the deferred call chain and the wasm backend disagreed.
- **Deferred call evaluation** — receivers and arguments of a deferred call are evaluated at the `defer` statement, except for pointer-receiver methods on addressable values (`defer b.Add(1)`, `defer s.b.Add(1)`), which observe later mutations exactly as in Go. `defer` normalisation now runs once in `lower/` for both backends.
- **`fmt.Print`/`fmt.Println`/`print`** — no longer treat the first operand as a format string; operands are joined like Go (`Println` with spaces, `Print` with spaces only between non-string operands). Use `Printf`/`Sprintf` for formatting.
- **Nil interface method calls (strict / `both`)** — `x.Method()` on a nil interface value now panics with `runtime error: invalid memory address or nil pointer dereference` in the JS backend, matching wasm.
- **Codebase consolidation (H8, no functional change)** — legacy `--watch`/`--serve` delegates to `handleDev`; legacy flags parsed by `parseLegacyArgs` in `cli-core`; WASM emitter gained `_emitGrowSlice`, `_emitCopyIfValueStruct`, `_emitSliceUnpack` and a `MATH_F64_UNARY` table; `src/lower/` passes share `forEachChild`/`someChild`; the JS backend tracks runtime helpers through `useHelper(name)` and one ordered `HELPER_MAP`; 47 unused `export`s dropped and dead `resetNativeWasmOptCheck`/`isInt`/`isNarrowInt` removed; `.npmignore` and empty `gen/`/`dist/` removed (`files: ["src/"]` is the npm whitelist). Example and simplefps JS/`.wasm` output is byte-identical.

### Fixed
- **`strconv` parse errors (JS backend)** — `Atoi`, `ParseInt`, `ParseFloat`, `ParseBool` and `Unquote` now return Go-style `error` values (`strconv.Atoi: parsing "x": invalid syntax`) instead of plain strings, and `FormatFloat` honours the format character and precision. `strings.Replace` honours its `n` argument (`-1` replaces all). Both backends share one parsing helper, so `ParseInt("12abc")`, base-0 prefixes (`"0x1F"`), `ParseFloat(" 1")`, `ParseBool("t")` and out-of-range `Atoi` behave like Go in `js` and `wasm` packages alike.
- **`gofront dev` without `-o` wrote no bundle** — `parseDevArgs` reported a missing `-o` as `null`, which `handleDev` reads as "skip writing `app.js`", so a plain `gofront dev` served stale output. The flag's absence now falls through to the project's `devOutputFile`.
- **`fmt.Sprintf` with `error` operands in wasm** — formatting an error whose `Error()` method itself calls `Sprintf`/`Errorf` corrupted the outer call's argument buffer (`NaN|z|<nil>` instead of the message). Error operands are now stringified before any argument is pushed.
- **`strings.Split(s, "")` in wasm** splits into code points like Go (and the JS backend) instead of UTF-16 units.
- **Hybrid bundle size** — the `fmt`/`strings`/`strconv` import shims and `__any_eq` are only emitted when a `wasm` package actually uses them, and `__sprintf` is no longer defined twice in hybrid bundles.
- **Boundary-call-in-loop warning** now prints as `warning: main.go at line N:C: …` (it previously read `warning: Warning in main.go:` with no position).
- **`utf8.DecodeRune*` in wasm** — results are `rune, int` (the size was emitted as `i32`), and the size counts UTF-16 code units like the JS backend, since strings are JS strings in both.
- **Methods on wasm handles with `int` parameters/results** — the boundary never generated trampolines for methods (they are keyed `T.M` in the function map but exported as `T_M`), so calling e.g. `pose.SetJointTransform(0, …)` from JS threw `Cannot convert 0 to a BigInt`. Methods now get the same `i64`↔`Number` trampolines as functions; as a side effect every method signature is now plain numbers/externrefs, which lets V8 inline the calls (simplefps's controller loop dropped from ~48 B/frame to 0.2 B/frame).
- **`math.Round` parity** — the WASM import now rounds half away from zero like Go and the JS backend (`Math.round(-2.5)` is `-2`, Go gives `-3`).
- **Parse cache vs. target overrides** — compiling a directory with `forceTarget`/`targets` after a normal compile (or vice versa) in one process reused cached ASTs whose `target` had been overwritten; the declared target is now kept separately, so `--js-only` A/B runs in the same process are no longer poisoned.
- **`app.wasm` loader URL** — the bundle now resolves `app.wasm` relative to `app.js` (`import.meta.url`) instead of the page, so sub-path routes and CDN-hosted bundles no longer 404.
- **Wasm package-level struct zero values** — a `var x T` global whose struct has `any`/interface or `string` fields no longer produces an invalid module (`struct.new expected anyref, found i32.const`), and nested struct-value fields are built in place instead of left `null` (which trapped on first access, e.g. `scratch.Point.X = 1`).
- **Wasm map keys** — struct keys hash and compare field-wise, `-0.0` and `+0.0` share a key, and `NaN` keys never match (Go semantics). Array and interface keys report a `(planned)` diagnostic instead of silently comparing by reference.
- **Generic struct literals inside generic functions** — `Pair[K, V]{...}` inside a generic body is now monomorphised; the type-parameter substitution map was dropped on nested AST nodes.
- **Type lookup shadowing** — a local *value* named like a type (`T := 5; var x T`) now reports `Unknown type 'T'` instead of resolving to the value's type.
- **`maps.Keys`/`maps.Values`/`maps.Clone` and `slices.*` return types** are derived from the argument type instead of hardcoded lookups.

## [1.5.1] - 2026-10-06

### Added
- **`src/lower/` analysis layer** — ownership/clone elision, address-taken boxing, range shape, function structure (named returns, `defer`), embedded-method stubs, closure captures and pointer escape analysis now live in `src/lower/` as side tables keyed by AST node. JS output is unchanged; the WASM backend consumes the tables.
- **Package targets** — `//gofront:target js|wasm|both` before the `package` clause selects a compilation target per package.
  - `wasm` packages may only import `wasm`/`both` packages and the stdlib subset the backend implements (`math`, `math/bits`, `testing`).
  - `both` packages may only import `both` packages, may not use `gom`, and may not mutate package-level variables (direct assignment, `++`/`--`, `&x`, and pointer-receiver method calls are all detected, with shadowing respected).
  - Violations end with a summary line such as `package 'p' cannot be both: 3 blockers — …`. Unknown target values and directives placed after the `package` clause are rejected.
- **Strict numeric mode for `both` packages** — arithmetic on sized integer and `float32` types is emitted with Go wrap/`Math.fround`/`Math.imul` semantics, integer division by zero panics, and shift counts ≥ width yield 0. Compound assignment and `++`/`--` are covered for any lvalue (locals, struct fields, slice/array elements) with the index expression evaluated exactly once.
- **WasmGC backend (experimental)** — `src/backend/wasm/` compiles `wasm` packages to WebAssembly GC modules with JS glue: structs, pointers, arrays/slices (`append`), strings, maps, interfaces, closures (including closures inside methods), `defer`/`panic`/`recover`, and `math`. Requires a WasmGC-capable runtime (Node ≥ 22 / recent Chrome, Firefox, Safari).
- **Hybrid builds: single `app.wasm` + JS facade (boundary v1)** — every `wasm`/`both` package reached by a build is linked into one `app.wasm` written next to `app.js` by `build`, `dev` and `-o`. The facade spliced into the bundle exposes exported functions, methods, literal constants and structs:
  - Primitives convert directly (`int`/`int64` are `Number` on the JS side); strings and `any` pass through.
  - `both`-package struct values are copied into their JS class (with write-back for `*T` parameters); `wasm`-package structs become opaque handle classes with stable identity. Aggregate fields read through a handle (`b.Pos.X = 1`, `b.Tags[0] = 2`) are live views so writes reach wasm.
  - Slices/arrays are copied element-wise (TypedArray inputs accepted) and func values are wrapped in both directions.
  - Maps, `error`, non-empty interfaces, pointers to non-structs and exported non-literal constants are rejected with a `… is not yet supported across the wasm boundary (planned)` diagnostic.
  - Linked `wasm` packages share one namespace; a top-level name declared in two of them is a compile error.
  - `--emit-wat` (build / `-o`) also writes `app.wat`. Emitted modules carry a `gofront` custom section, and stale `app.wasm`/`app.wat` files are only removed when they carry it.
- **Dual-target `gofront test`** — tests in a `wasm` package run inside the linked `app.wasm` (`*testing.T` stays a JS object and `t.Errorf`, `t.Fatal`, `t.Log`, `t.Skip`, `t.Name`, `t.Failed`, … are routed back to the harness); tests in a `both` package run twice, reported as `pkg [js]` and `pkg [wasm]`, so both backends must agree. `t.Run` is not yet available in wasm test packages.
- **Package-level initialisers in wasm** — non-literal package variable initialisers run from a wasm `start` function; literal package constants are inlined. Referencing a non-literal constant from wasm code reports `constant 'X' has a non-literal value, which the wasm backend does not support yet (planned)` instead of a confusing lookup failure.
- **Raycast go/no-go benchmark** — `npm run bench:raycast` (`test/e2e/perf/raycast-bench.js`) compiles a snapshot of simplefps `engine/mathx` + `engine/collision` twice (all-JS and hybrid), casts the same 100k rays through 131k triangles and reports rays/s and allocation per run. `--wasm-opt <path-to-wasm-opt>` optionally runs Binaryen over the emitted module to measure the optimisation ceiling; Binaryen is not a dependency.
  - Codegen optimisations in this release: immutable slice headers with a shared empty header, i32 bounds checks and induction variables, trap-based nil dereference, leaf function size reduction for engine inlining, and scratch globals cached in locals.
  - Result: hybrid reaches **31,293 rays/s (1.17× JS)** with **0.86 B/ray** allocation. **Outcome: GO.** The hybrid architecture is validated.

### Changed
- **`cap(x)` on a nil slice** — now emits `(x?.length ?? 0)` so `cap` of a nil slice returns 0 instead of throwing, matching `len`.
- **`src/codegen/` → `src/backend/js/`** — the JS code generator now lives beside the wasm backend; the `src/codegen/` directory is gone. Each backend's `index.js` is the only import surface (`buildSourceMap`, `isGoFrontWasm` are re-exported from there).

### Fixed
- **Struct type indices in wasm modules** — structs whose fields needed auxiliary types (slices, arrays, boxes, closures) were assigned stale type indices, producing invalid modules; all struct and auxiliary types now live in one recursive type group.
- **Integer literals in float context (wasm)** — `x * 2` with `x float64` emitted an `i64.const`, producing an invalid module; the literal now takes the float type of its context.
- **Minifier rejected BigInt literals** — `123n` is now tokenised as a single numeric literal.

## [1.4.0] - 2026-10-02

### Added
- **`css` declarations in `.templ` files** — `css Name() { ... }` declarations colocate scoped CSS rules alongside `.templ` components matching the [templ.guide](https://templ.guide/syntax-and-usage/css-style-management) specification. Declarations compile to zero-overhead functions returning deterministic scoped class names (`gfc_<name>_<hash>`) and automatically inject the scoped CSS into `<head>` via a `<style id="gofront-styles">` element at app initialization. Nested selectors (`&`, media queries, keyframes) and comments are supported.
- **`.templ` files in local packages** — package resolution (`resolver.js`) now discovers packages containing only `.templ` files, and the typechecker marks package imports referenced within `.templ` templates as used.

## [1.3.12] - 2026-10-02

### Added
- **`ref` attribute in `.templ` templates** — elements in `.templ` files can now specify `ref="name"` to capture direct DOM element references at mount time without runtime DOM querying. The captured elements are populated into an optional `refs map[string]any` parameter passed to `gom.Mount(selector, node, [refs])` or `gom.MountTo(selector, node, [refs])`. `ref` attributes are stripped from output HTML and forwarded through nested `@Component()` invocations.
- **Multi-package source-map resolution** — source maps for builds that inline subpackage dependencies now correctly map line numbers and embed sources for all bundled packages instead of only the entry package.

## [1.3.11] - 2026-10-01

### Added
- **Colored CLI output** — `gofront check`, `build`, `dev`, `prep`, `test` and the raw compile/watch modes now color their terminal output: green `OK`/`PASS`, red `ERROR`/`FAIL`, yellow `SKIP`/warnings, dimmed timings and source gutters, and a red caret under the offending column in `Type error`/`Parse error`/`Lex error` diagnostics. Colors are enabled only when writing to a TTY and honour `NO_COLOR` / `FORCE_COLOR`; captured or piped output stays plain.

### Fixed
- **Untyped constants were rejected for named basic types** — `type Mode string` followed by `var m Mode = "all"`, `m == "opaque"`, or passing a string literal to a `Mode` parameter reported `Cannot assign untyped string to Mode`. Untyped constant assignability now unwraps named types to their underlying basic type, matching Go.
- **Interface values did not satisfy narrower interfaces** — the typechecker only inspected struct and pointer-to-struct types when checking interface implementation, so assigning an interface value to a narrower interface (e.g. `var d Drawable = e` where `Entity` includes all of `Drawable`'s methods) or passing it to a function accepting a narrower interface reported `<SourceInterface> does not implement <TargetInterface>`. The assignability check now verifies that the source interface's method set covers the target interface's method set, matching standard Go interface satisfaction.

## [1.3.10] - 2026-10-01

### Added
- **`assetExtensions` project option** — `gofront build` only mirrored files from `serveDir` whose extension was on a built-in web-asset whitelist, so projects shipping custom binary formats (`.bmesh`, `.mat`, `.arena`, …) silently lost them from the release output and the PWA precache. `gofront.json` / `package.json` `"gofront"` now accept `"assetExtensions": [".bmesh", "mat"]` (dot optional, case-insensitive) to extend the whitelist.

### Changed
- **Single project-config location** — `vendor` and `assetCopy` are now read exclusively from the gofront project config (`gofront.json` or the `"gofront"` object in `package.json`), alongside `src`, `serveDir`, `outDir`, `output`, `port` and `assetExtensions`. Top-level `"vendor"` / `"assetCopy"` keys in `package.json` are no longer consulted; move them under `"gofront": { … }`.

### Fixed
- **Minifier `--mangle` renamed free globals used as call arguments** — the parameter-declaration scan treated any `(…)` following an identifier as a parameter list, so `foo(bar, baz)` registered `bar` and `baz` as "parameters" of the enclosing function and renamed only some of their occurrences, producing `ReferenceError: j47 is not defined` in release builds. Only parenthesised lists directly followed by `{` or `=>` (functions, methods, arrows) are treated as parameter declarations now.

## [1.3.9] - 2026-10-01

### Fixed
- **Minifier treated `/` after `)` or `]` as the start of a regex literal** — an expression such as `(x * Math.PI) / 180.0` made the tokenizer scan a "regex" that ran to the end of the file, so everything after the first such division was emitted verbatim: `gofront build` produced a bundle that was only minified up to that point and the remainder was unminified, unmangled source. `/` following `)`, `]`, `++` or `--` is now a division operator, and a regex literal scan stops at a newline so a misdetection can no longer swallow the rest of the bundle.
- **`<svg>` in `.templ` files was created in the HTML namespace** — `<svg>` and its descendants (`<path>`, `<circle>`, …) were emitted with `document.createElement`, producing inert `HTMLUnknownElement`s that never rendered. Elements inside an `<svg>` subtree are now created with `document.createElementNS("http://www.w3.org/2000/svg", …)`, and `class` attributes on them are set via `setAttribute("class", …)` since `SVGElement.className` is a read-only `SVGAnimatedString`.

## [1.3.8] - 2026-10-01

### Added
- **Recursive package patterns for `check` and `test`** — `gofront check app/src/...` and `gofront test app/src/...` (also `./...`) walk every directory under the root that contains `.go`/`.templ` files and run it as a separate package, skipping hidden directories, `node_modules`, `dist` and `public`. `check` prints one `OK` line per package plus a total; `test` prints Go-style `ok` / `?  [no test files]` / `FAIL` per package and exits non-zero if any package fails. Replaces hand-maintained `&&` chains of per-package commands in `package.json`.

### Fixed
- **`*T` did not satisfy interfaces** — passing or assigning a pointer-to-struct variable (`s := &Shape{}`, `use(s)`) to an interface parameter reported `*Shape does not implement Sizer` even when `Shape` had every method. The satisfaction check now looks through the pointer to the struct's method set, as in Go (`*T` has both value- and pointer-receiver methods).
- **Diamond local imports bundled the shared package multiple times** — when `main` imported `./a` and `./b`, and both imported `../base`, the `base` package was inlined once per import path, producing `Identifier 'X' has already been declared` at runtime. Local packages are now tracked by resolved directory across the recursive compile and emitted exactly once.
- **Imported struct literals emitted plain objects** — `pkg.T{}`, `&pkg.T{X: 1}`, and `var v pkg.T` for a struct type from a bundled local package produced `{ X: 1 }` / `null` instead of `new T(…)`, so methods were missing and address-taken values crashed with `Cannot set properties of undefined`. Codegen now de-qualifies bundled package names when resolving struct classes and zero values.
- **Type-only use of an import reported "imported and not used"** — a package referenced solely through `pkg.T` in type positions (parameters, `var`, composite literals) was flagged unused. Resolving a qualified type name now marks the package as used.
- **`sort.Slice` / `sort.SliceStable` / `sort.SliceIsSorted` passed elements to `less`** — the comparator received `(a, b)` values instead of Go's `(i, j)` indices, so the idiomatic `func(i, j int) bool { return s[i] < s[j] }` read `undefined`. `Slice`/`SliceStable` now use an in-place, stable, index-driven sort (`__sortSlice` helper) and `SliceIsSorted` checks adjacent indices.
- **`math.Round` rounded halves toward +Infinity** — `math.Round(-3.5)` returned `-3` because it mapped straight to `Math.round`. It now rounds half away from zero (`-4`), matching Go.
- **`xs[d.Field]` with an uppercase selector was parsed as a generic instantiation** — indexing a slice, array, map or string with a qualified name such as `pose.Positions[j.Index]` or `list[cfg.Count]` hit the parser's type-argument heuristic and type-checked as `Generic[TypeArg]`, reporting a bogus error or silently returning the base type. The typechecker now recognises an indexable base with a single plain/qualified "type arg" and rewrites the node into an `IndexExpr`.
- **`[]pkg.Type{…}` as a call argument failed to parse** — the composite-literal lookahead in call arguments stopped at the `.` in a qualified element type, so `f([]other.Item{…})` or `New([]*anim.Pose{p})` reported `expected ')' (got {`. The lookahead now skips `.` tokens.
- **`rand.Float32()` was typed as `float64`** — assigning its result to a `float32` variable or field reported a type mismatch. It now returns `float32` as in Go.
- **Repeated blank multi-assignment redeclared `__t`** — two or more statements such as `_, n = f()` (or comma-ok type assertions `v, ok = x.(T)`) in the same scope each emitted `let __t = …`, producing `Identifier '__t' has already been declared` at runtime. Codegen now emits a unique `const __tN` per statement.
- **Type assertion on a call expression evaluated the call twice** — `f().(T)` and `v, ok := f().(T)` emitted the call once inside the runtime type check and again for the result (`typeof f() === "number" ? f() : …`), so side effects ran twice and the two values could differ (e.g. `performance.now().(float64)`). When the operand contains a call it is now evaluated once via an IIFE parameter.
- **`v := pkg.T{}` was typed `any`** — a short-variable declaration initialised from a qualified composite literal left `v` untyped (the parser keeps `pkg.T` as a `SelectorExpr`), so `&v` was boxed as `{value}` and writes made through the pointer were lost; `var v pkg.T` was unaffected. Type resolution now treats a `SelectorExpr` type node like a qualified type name.

## [1.3.7] - 2026-09-30

### Fixed
- **Pointer receivers were typed as `T` instead of `*T`** — inside `func (n *Node) M()`, the receiver `n` was given the struct value type, so `append(q, n)` with `q []*Node` emitted `n.__clone()` (breaking aliasing and allocating per call) and `[]*Node{n}` was a type error. The receiver is now typed `*Node`.
- **Omitted fields of imported struct types were `null`** — a composite literal `C{N: 1}` where `C` has a field of a struct type from another bundled package (`P geo.V`) left `P` as `null` instead of `new V()`. Codegen now recognises struct types from bundled packages as classes when emitting zero values.

## [1.3.6] - 2026-09-29

### Changed
- **`[]float64` is a plain JavaScript array again** — 1.3.0 mapped every sized numeric slice to a TypedArray, including `[]float64` → `Float64Array`. `float64` is Go's default float type and the mapping made `[]float64` incompatible with plain arrays, `Array.prototype` helpers, and the `any` return values of most Web APIs. `[]float64` now compiles to a plain `Array`; `[]float32`, `[]int8`/`[]int16`/`[]int32`, `[]uint8`/`[]byte`/`[]uint16`/`[]uint32`, and `[]rune` keep their TypedArray mapping. Note that the TypedArray mapping introduced in 1.3.0 is itself a **breaking change** for code that relied on `[]byte` or other sized slices being plain arrays (e.g. passing them to `JSON.stringify` or spreading into `Array` methods); the 1.3.0 entry below has been corrected accordingly.
- **`rune` is an alias of `int32`** — `rune` and `int32` are now the same type, as in Go: `[]rune` ↔ `[]int32` conversions are no-ops, `rune` values are assignable to `int32` parameters, and `[]rune` compiles to `Int32Array`. Ranging over a string yields `(int, rune)` rather than `(int, int)`.
- **Sized integer conversions wrap** — `int8(x)`, `uint8(x)`, `int16(x)`, `uint16(x)`, `int32(x)`, and `uint32(x)` now truncate to the target width like Go (`uint8(300) == 44`, `int8(200) == -56`) instead of emitting the operand unchanged.
- **Struct values have Go copy semantics** — assigning, passing, returning, appending, or ranging over a struct *value* now copies it (via a generated `__clone()` method), so mutating the copy no longer mutates the original. Pointers (`*T`) still alias as before. Arrays are copied on assignment as well. Struct/array values stored in interface values are wrapped so a type switch distinguishes `case T` from `case *T` — previously both cases matched whichever came first.
- **Struct constructors zero-fill omitted fields** — the legacy `new T({ X: 1 })` options-bag form is still accepted when the first field is primitive, but omitted fields now get their Go zero value instead of `undefined`.
- **WebGL / DOM method emission** — PascalCase calls on Web API types (`gl.BindBuffer(...)`, `gl.Uniform1F(...)`) compile to the real camelCase JavaScript members (`gl.bindBuffer(...)`, `gl.uniform1f(...)`). Previously they were emitted verbatim and failed at runtime. `WebGLRenderingContext` (WebGL1) no longer exposes WebGL2-only methods and constants; `WebGL2RenderingContext` has the full set. Trailing optional parameters on `DataView`/TypedArray/`ArrayBuffer`/WebGPU methods may be omitted.
- **`gofront dev` binds `localhost` by default** — the dev server no longer listens on all interfaces unless a `host` is configured. The configured port (`--port`/`dev.port`) is what is printed, instead of a hard-coded fallback, and a compile error present at startup is printed to the terminal instead of only appearing in the browser overlay.
- **`gofront build` copies static assets** — non-generated files in `serveDir` (images, CSS, fonts, JSON, …) and configured `assets` are copied into the output directory, so `dist/` is a complete deployable site.
- **`gofront init`** writes `gofront` into `devDependencies` of the generated `package.json`.

### Fixed
- **Operator precedence in generated JavaScript** — 1.3.3 and 1.3.4 parenthesised sub-expressions based on *Go* precedence, which still produced wrong JavaScript wherever Go and JavaScript precedence differ: `a&b == 2` (Go: `(a&b) == 2`; JS: `a & (b == 2)`), `a<<1 + 1`, `a | b ^ c`, `a &^ b`, `x == y == z`, and `- -a` / `+ +a` (emitted as `--a` / `++a`). Operands are now parenthesised according to a JavaScript precedence table and the operator actually emitted (`&^` → `& ~`, integer `/` → `Math.trunc`), and adjacent unary operators are separated.
- **Struct field named `value` broke pointer unboxing** — the struct prototype's `value` accessor (used to make `&s` and `s` interchangeable) shadowed a user-declared field `Value`/`value`. The accessor is now only emitted when the struct has no field of that name.
- **Assignment-form `for i, v = range s` loops** — two consecutive `for i, v = range s` loops in one function emitted a duplicate `const __arr0` declaration (`SyntaxError`), and after the loop `i` held `len(s)` rather than the last index. Hidden loop registers are now used and the user variables are assigned per iteration, so `i` and `v` hold their last-iteration values afterwards exactly as in Go. A loop variable that is modified inside the body (`i++`, `i = …`) no longer affects the iteration count.
- **`append` to a nil typed slice** — `var fs []float32; fs = append(fs, 1)` produced a plain array (`[1]`) instead of a `Float32Array`, so subsequent `fs[1:]` (`.subarray`) crashed. A nil receiver now starts as an empty typed array.
- **`[]int32(str)` / `[]rune(str)`** produced a byte-length typed array filled with `NaN`; both now decode Unicode code points (`len([]rune("héllo")) == 5`). `[]byte(str)` continues to UTF-8 encode.
- **`len()` on TypedArrays** — `__len` treated typed arrays as objects and counted own keys (`O(n)` and wrong for `Float32Array` with holes). Typed arrays now use `.length` directly.
- **JavaScript reserved words as identifiers** — Go identifiers that are reserved in JavaScript but not in Go (`in`, `new`, `class`, `this`, `delete`, `typeof`, `instanceof`, `void`, `with`, `let`, `yield`, `await`, `enum`, `export`, `extends`, `super`, `try`, `catch`, `finally`, `throw`, `function`, `while`, `do`, `null`, `undefined`, `arguments`, `eval`, …) are renamed (`in` → `in$`) throughout the generated code instead of producing a `SyntaxError`.
- **`gofront build` `cleanOutputDir` safety** — the output directory is only cleaned when it lies inside the project root and is not the root, `srcDir`, or `serveDir`; previously `-o ..` or a misconfigured `outDir` could wipe unrelated directories.
- **`gofront dev` error replay** — a browser that connects (or reconnects) after a compile error now receives the current error overlay immediately instead of a blank page until the next save; a successful rebuild clears it.
- **PWA offline fallback** — the generated service worker's `fetch` handler returned a pending `Promise` object instead of the cached `index.html` when the network was unavailable (a `.then` chain was not returned). Navigation requests now fall back correctly.
- **Vendor polyfill plugin** — `@rolldown/plugin-node-polyfills` was activated for the `esbuild` bundler as well, where it is not a valid plugin. It is now only used with `rolldown`/custom bundlers, and only when the loaded module actually exports a plugin factory.
- **Type alias forward references** — `type A = B` before `type B struct{…}` in the same file/package failed with an undefined-type error; type declarations are now collected in dependency order.
- **Builder/Writer receivers evaluated twice** — `fmt.Fprint*`, `io.WriteString`, and `strings.Builder`/`bytes.Buffer` method calls emitted the receiver expression twice (`(f()?.value ?? f())`), calling a receiver function twice. The receiver is now bound once.

## [1.3.5] - 2026-09-29

### Fixed
- **Multi-file forward type reference resolution** — Pre-registered named type declarations (`!decl.isAlias`) in Pass 0 across package compilation units before resolving underlying types and generic type parameters. Struct fields referencing types defined in subsequent or alphabetically later source files (e.g. `Transform` referencing `Vec3` across `transform.go` and `vec3.go`) now resolve cleanly without undefined type errors. Single-file typechecking now unifies with `checkAll` for consistent declaration resolution semantics across both single- and multi-file packages.
- **Function assignability to named function types** — Implemented `_checkFuncAssignable` in assignability analysis, allowing function literals and closures to be assigned directly to named function types (e.g. `type RayFilter func(...) bool` and `var GlobalFilter RayFilter = func(...) bool { ... }`), validating parameter types, arity, and return types against the target signature.
- **Constant declaration hoisting in code generation** — Updated `_emitVarConstDecls` in `src/codegen/index.js` to emit package-level `const` declarations before `var` declarations in generated JavaScript. This ensures package-level variables initialized using constants (including constants declared in sibling files or later in the source) evaluate safely at module evaluation time without JavaScript Temporal Dead Zone (`ReferenceError: Cannot access '...' before initialization`) runtime crashes.

## [1.3.4] - 2026-09-29

### Fixed
- **Operator precedence parenthesis preservation in unary expression codegen** — `_genUnaryExpr` in `src/codegen/expressions.js` previously emitted unary expressions (such as unary minus `-` or bitwise NOT `~`) directly concatenated with operand expressions without checking if the operand is a binary expression. Because unary operators have higher precedence than binary operators in JavaScript, compound negations like `-(a + b)` were emitted as `-a + b` and evaluated incorrectly. Unary expression codegen now wraps child binary expression operands in parentheses (`-(a + b)`). *Incomplete: `- -a` still emitted `--a`; fixed in 1.3.6.*

## [1.3.3] - 2026-09-29

### Fixed
- **Operator precedence parenthesis preservation in binary expression codegen** — `_genBinaryExpr` in `src/codegen/expressions.js` previously emitted left and right operands without considering operator precedence, causing parenthesized subexpressions with lower precedence (such as `2 * (3 + 4)` or `a + t * (b - a)`) to be emitted without grouping parentheses and evaluated incorrectly under JavaScript operator precedence rules. It now checks the operator precedence table and wraps child binary expressions in parentheses when required. *Incomplete: the table used Go precedence, so expressions where Go and JavaScript differ (`a&b == 2`, `a<<1 + 1`, `a | b ^ c`) were still wrong; fixed in 1.3.6.*

## [1.3.2] - 2026-09-29

### Fixed
- **Multi-file package compilation in directory checks and project resolution** — `resolveSrcDir` in `src/cli-core.js` previously collapsed any directory containing `main.go` into single-file compilation (`main.go`). It now checks whether other `.go` files exist in that directory, compiling the complete package directory when multiple Go files are present so symbols across sibling files are properly resolved during `gofront check` and compilation.
- **`gofront test` auto-detection from project root** — `handleTest` in `src/cli-core.js` now auto-detects `project.srcDir` when executed without explicit target arguments from a project root, eliminating the need to pass `src` explicitly to find test suites.

### Added
- **`serveDir` file watching for live reloads in `gofront dev`** — when `serveDir` is distinct from the watch target directory, `handleDev` now also watches `serveDir` for `.css` (triggering hot-reload without page refresh) and `.html` (triggering full page reload).

## [1.3.1] - 2026-09-29

### Fixed
- **`gofront dev` CLI fall-through to single-shot compilation** — `gofront dev` in `src/index.js` previously executed without an unresolved wait state, falling through to legacy single-shot compilation which attempted to stat the string `"dev"` as a directory (`cannot access 'dev': ENOENT`). The dev command now awaits a pending promise while running the server and watcher, properly holding the process until SIGINT/SIGTERM triggers graceful shutdown.

## [1.3.0] - 2026-09-29

### Added
- **Zero-allocation `for range` loops** — slice and array ranges now compile directly to classic indexed loops (`for (let i = 0, __arr0 = slice, __len0 = __arr0 ? __arr0.length : 0; i < __len0; i++)`) rather than allocating `.entries()` iterator tuples per iteration. The generated code safely guards against `nil` slices without runtime crashes, suffixes registers (`__arr${d}`, `__len${d}`) to prevent collisions in nested loops, and supports value variable reassignment (`let v`) and assignment-form ranges (`for i, v = range slice`).
- **First-class JavaScript TypedArray support** (**breaking**, see 1.3.6) — sized numeric types (`float32`, `uint8`, `byte`, `uint16`, `uint32`, `int8`, `int16`, `int32`) are decoupled in the typechecker as distinct basic singletons. `make([]float32, n)` allocates `new Float32Array(n)` (and corresponding TypedArrays for other sized numeric types), and composite slice literals (`[]float32{...}`) emit typed array constructors. Slices of these types are no longer plain JavaScript arrays; `[]float64` and `[]int` remain plain arrays (`[]float64` was briefly mapped to `Float64Array` in 1.3.0–1.3.5, reverted in 1.3.6).
- **Zero-copy TypedArray sub-slicing (`.subarray`)** — sub-slicing a TypedArray slice (`s[lo:hi]`) compiles to `.subarray(lo, hi)`, delivering true Go zero-copy mutable slice semantics instead of cloning memory via `.slice()`. `copy()` compiles to `.set()` on TypedArrays, and `append()` preserves TypedArray identity via `.set()` buffer transfer.
- **Positional struct constructors & pointer unboxing** — struct declarations generate clean positional constructors (`constructor(X$ = 0, Y$ = 0)`), precomputing zero values for omitted fields and eliminating options-bag heap allocations. Struct pointers unbox directly (`&s` -> `s`, `*ptr` -> `ptr`, `ptr.X` -> `ptr.X`), avoiding `{ value: s }` boxing wrappers while preserving boxed wrappers strictly for address-taken primitives. Pointer dereference assignments (`*ptr = other`) compile to in-place mutation via `Object.assign()`.
- **WebGL2 & WebGPU static typings in standard library** — added comprehensive standard library interfaces in `src/typechecker/stdlib/web.js` for `ArrayBuffer`, `DataView`, TypedArrays (`Float32Array`, `Uint8Array`, etc.), `WebGLRenderingContext`, `WebGL2RenderingContext`, `GPUDevice`, `GPUQueue`, and `GPUAdapter`, including over 40 WebGL constants, camelCase/PascalCase method aliases, and open interface fallback.
- **Bidirectional slice ↔ TypedArray assignability** — Go numeric slices can be passed directly to APIs expecting TypedArrays (e.g. `[]float32` <-> `Float32Array`), with compile-time type validation against mismatched element types.
- **Project scaffolding (`gofront init`)** — scaffolds a minimal frontend project: `app/index.html`, `app/src/main.go`, `.gitignore`, and a `package.json` with `dev`/`build`/`test`/`check` scripts.
- **Semantic CLI subcommands (`gofront dev` & `gofront build`)** — added `gofront dev` (integrated watch, compile, asset sync, and dev server with live reload) and `gofront build` (clean, compile, minify, and vendor bundling).
- **Resilient live-reload & compiler error overlay** — HTML-injected SSE live reload with heartbeat pings that survive compile errors, paired with an interactive in-browser error modal displaying compiler and typecheck diagnostics with source code carets.
- **Node polyfills for Rolldown vendor bundling** — automatically detects and activates `@rolldown/plugin-node-polyfills` to bundle npm dependencies requiring Node built-ins.
- **Offline PWA service worker generation (`gofront build --pwa`)** — automated pre-cache manifest generation and `sw.js` creation with cache-first asset strategy and HTML registration snippet.
- **Reference showcase & zero-allocation benchmark** — added 3D rotating colored cube demo in `example/webgl/` with WebGL2 shader pipeline and continuous 60+ FPS animation loop, verified with Playwright E2E. Added a 100,000-iteration ray-triangle intersection benchmark (`test/e2e/perf/zero-alloc.js`) and `npm run test:perf` verifying 0 per-iteration heap allocations.

### Changed
- **Optimized `__equal` runtime helper** — `__equal` checks `ArrayBuffer.isView()` to perform fast element-by-element comparisons on TypedArrays without object key allocations.
- **Removed redundant placeholder types** — removed redundant `ANY` declarations for `ArrayBuffer`, `Uint8Array`, `WebGLRenderingContext`, and `GPUDevice` from `src/typechecker/stdlib/core.js` in favor of full typings in `src/typechecker/stdlib/web.js`.
- **E2E global setup** — updated `test/e2e/global-setup.js` to execute `npm run build:all`.

## [1.2.3] - 2026-09-24

### Fixed
- **Literal folding in minifier corrupted SVG paths and string constants** — `foldLiterals()` in `src/minifier.js` previously executed a global regular expression over raw code, mistakenly matching hyphen-delimited numbers inside string literals (e.g. SVG path coordinate sequences like `12.5-12.5` were folded to `12.-7.5`). Literal folding now operates safely on tokenized code, completely preserving strings, template literals, and regexes while respecting operator precedence, unary minus, and floating-point expansion limits.

## [1.2.2] - 2026-09-24

### Fixed
- **Identifier collision in `--mangle`** — `mangle()` in `src/minifier.js` now collects all occupied and unrenamed identifiers from source tokens into an `occupied` set and skips them during short-name generation. This prevents mangled variable names from colliding with existing functions, classes, single-character variables, or globals (e.g. `let t = ...` colliding with `function t(key)` in module scope).
- **Struct field named after a struct type crashed at load** — a field whose name matched a type used in any field default (e.g. `type View struct { Project Project }`) compiled to `constructor({ Project = new Project() })`, so the destructuring binding shadowed the class and threw `Cannot access 'Project' before initialization`. Such bindings are now aliased (`Project: Project$ = new Project()`); output for other structs is unchanged.
- **Single-variable `range` over a map yielded entries instead of keys** — `for k := range m` compiled to `for (const k of Object.entries(m))`, so `k` was a `[key, value]` pair. It now emits `Object.keys(m)`; the two-variable form is unchanged.

## [1.2.1] - 2026-09-23

### Fixed
- **Dev server path traversal** — `handleDevRequest` in `src/dev-server.js` guarded the resolved path with a plain string-prefix check (`startsWith(serveDir)`), so a sibling directory sharing the prefix (e.g. serving `app/` while `app-secret/` exists) was reachable via `/../app-secret/...`. Containment is now checked with `path.relative()` + `isAbsolute()`, matching only `..` / `../…` so files legitimately named `..foo` inside the serve dir are still served. The same exact check is applied to `assetCopy` destinations.
- **`gofront test --dom` under global / `npx` installs** — the jsdom availability check accepted a jsdom found next to GoFront's own installation, but the spawned harness imported the bare specifier `"jsdom"` from the project directory and crashed with `ERR_MODULE_NOT_FOUND` when the project had no local copy. The harness now imports jsdom via the resolved `file://` URL (`resolveJsdomPath()`); project-local jsdom still takes precedence.
- **Test discovery restricted to `*_test.go`** — `discoverTests()` previously scanned every program in the package, so a `TestXxx(t *testing.T)` declared in a non-test file was executed. Only programs whose filename ends in `_test.go` are considered now, matching Go. Programs without a `_filename` (constructed programmatically) are still scanned.
- **Unit test harness never awaited async tests** — `test()` in `test/unit/helpers.js` called `fn()` synchronously and reported `✓` immediately; promises returned by `async` tests were never awaited and `run.js` exited before their rejections could surface. 25 async tests (test runner, vendor bundler) were vacuously green. `test()` now tracks pending promises and `summarize()` awaits them; results are printed in registration order so async results stay under their own section header; all `process.exit(summarize())` call sites updated. One latent failure surfaced and was corrected (`[build failed]` assertion).

### Changed
- **CLI parsing moved to `cli-core.js`** — `gofront test` / `gofront prep` argument parsing and the prep summary formatting now live in `parseTestArgs()`, `parsePrepArgs()`, and `formatPrepSummary()` in `src/cli-core.js`, with direct unit coverage. Both parsers now treat any `-`-prefixed argument as a flag. `src/index.js` shrinks from 340 to ~300 lines and is back to routing, I/O, and watch mode only.
- **`vendor.globals` replaces hardcoded aliases** — `getExportNames()` no longer special-cases `@emailjs/browser`, `fuse.js`, `prismjs`, and `marked`. Projects that need extra `window` names declare them in `vendor.globals` (`{ "fuse.js": ["Fuse"] }`); generic derivations (full name, unscoped name, sanitised identifier) are unchanged. Invalid shapes produce a clear `vendor.globals[...]` config error.
- **Test harness reporting deduplicated** — the emitted runner uses a single `report(t)` for top-level tests and subtests; output is byte-identical to 1.2.0 and now locked by verbose and non-verbose snapshot tests.

## [1.2.0] - 2026-09-23

### Added
- **Native unit testing & test runner (`gofront test`)** — added built-in unit testing framework and CLI runner. Excludes `*_test.go` files from standard compilation (`compileDir`, `gofront .`), including them during test mode (`compilePackageTests`, `gofront test`). Provides standard library `testing` package with `testing.T` (`t.Error`, `t.Errorf`, `t.Fatal`, `t.Fatalf`, `t.Fail`, `t.Failed`, `t.FailNow`, `t.Log`, `t.Logf`, `t.Skip`, `t.Skipf`, `t.Skipped`, `t.Helper`, `t.Run`, `t.Name`), `testing.Short()`, and `testing.Verbose()`. Detects test functions matching `func TestXxx(t *testing.T)` and executes an inline test harness with Go-idiomatic terminal reporting (`=== RUN`, `--- PASS`, `--- FAIL`, subtests, timing, and exit codes). Supports `-v` (verbose), `-run <regex>` (test filter), and `--dom` (JSDOM environment for DOM/gom/templ component testing).
- **Vendor minification & multi-destination output (`gofront prep --minify`)** — added native minification support to the vendor bundler (`src/vendor.js`), forwarding `minify` option to `rolldown` and `esbuild`. Supports multi-destination destination arrays (`vendor.dest: ["app/vendor.js", "public/vendor.js"]`) to seamlessly emit both development and production bundles. Added `--minify` CLI flag to `gofront prep [dir] [--minify]`.
- **Example app unit test suites (`npm run test:examples`)** — added native `*_test.go` suites across `example/simple/src`, `example/reactive/src/utils`, `example/gom/src/utils`, and `example/templ/src/utils`. Wired `test:examples` into `package.json` and integrated it with `test:all`.

### Changed
- **`== nil` / `!= nil` compile to loose equality** *(entry added retroactively in 1.2.1)* — comparisons where either operand is `nil` now emit `== null` / `!= null` instead of `=== null` / `!== null`, so JavaScript `undefined` (unset struct fields, missing JS interop values) is treated as nil. Struct/array comparisons via `__equal` are unaffected.

### Fixed
- **Multi-file package-level variable inference** *(entry added retroactively in 1.2.1)* — `checkAll()` now type-checks all package-level `var`/`const` initializers across every file before checking any function body. Previously a function in `a.go` referencing `var cache = map[string]string{...}` declared in `z.go` saw the pre-declared placeholder type (`any`) and, for example, emitted array destructuring instead of a map comma-ok lookup.

## [1.1.0] - 2026-09-22

### Added
- **Native static asset copying (`assetCopy`)** — zero-dependency file and recursive directory copier in `src/asset-manager.js` using Node.js `node:fs`. Reads `"assetCopy"` configuration array from `package.json` or `gofront.json` (`source`, `dest`). Supports single files, destination directory mapping, and full recursive directory trees with directory traversal protection and graceful warnings on missing source paths.
- **Vendor dependency bundler (`gofront prep`)** — built-in vendor dependency packager in `src/vendor.js`. Dynamically detects `rolldown` or `esbuild` from the consuming project's `devDependencies` without adding dependencies to GoFront. Generates browser-compatible ESM bundles that set global `window` properties while preserving ES module exports.
- **SPA route fallback in dev server** — enhanced `gofront --serve` in `src/dev-server.js` to automatically fall back to serving `index.html` with `200 OK` for extensionless clean URL paths (e.g. `/blog`, `/projects`), enabling client-side SPA routers out of the box during development. Static assets with extensions correctly return 404 if missing. URL query strings and hash fragments are stripped before path resolution.
- **CLI subcommands and compiler flags** — `gofront prep [dir]` (and `gofront vendor [dir]`) runs asset copying and vendor dependency bundling via `handlePrep()` in `src/cli-core.js`. `--copy-assets` compiler flag synchronizes static assets during single-shot compilation and watch mode.
- **Unit test suite expansion** — 30 new unit tests covering dev server SPA fallback, static asset copying, vendor entry generation, configuration resolution, and CLI integration (`test/unit/compiler/dev-server.test.js`, `test/unit/compiler/asset-manager.test.js`, `test/unit/compiler/prep.test.js`), bringing total passing unit tests to 1,183.

### Changed
- **Dependencies & CI** — updated `@biomejs/biome` to 2.5.14, `@playwright/test` to 1.63.0, `c8` to 12.0.0, `jsdom` to 30.1.0, `lefthook` to 2.1.14, and `actions/setup-node` to `v7` in GitHub Actions workflow.

### Fixed
- **Playwright webServer hang in WSL2** — switched `playwright.config.js` `baseURL` and `webServer.url` targets from `localhost` to `127.0.0.2` and passed `-n` (`--no-clipboard`) to `npx serve`. Under WSL2 mirrored networking mode, TCP SYN probes to inactive ports on `127.0.0.1` are routed through the Windows host and silently dropped, triggering a 127-second TCP SYN retransmission timeout during Playwright server availability checks.

## [1.0.1] - 2026-05-04

### Added
- **Type system coverage tests** — 10 new unit tests targeting previously-uncovered code paths in the type checker and parser: infinite `for {}` loop termination, `for { break }` non-termination, labeled return statement termination, switch-case-with-break non-termination, `IncDecStmt` non-termination (`termination.js`); interface body union constraint (`Foo | Bar`) parsing and pkg.TypeName embed parsing (`parser/types.js`); named-type union constraint satisfaction and violation, approx constraint (`~int`) pass-through, and `No method` error on interface variable (`resolve.js`, `expressions.js`).

### Fixed
- **Union constraint enforcement for named types** — `_resolveInterfaceType` now copies `unionConstraint` from the parsed AST node to the resolved interface type. Previously, `type Pet interface { Cat | Dog }` silently accepted any type argument because the constraint was dropped during resolution. Type arguments that do not match any term in the union now correctly produce `"does not satisfy constraint"` errors.

### Changed
- **CLI core extraction** — compile/minify/init logic extracted from `src/index.js` into `src/cli-core.js`, exporting `runCompile`, `maybeMinify`, and `handleInit`. Single-file compilation logic consolidated into `compileSingleFile()` in `compiler.js`, reducing `cli-core.js` fan-out to 2 source deps (`compiler`, `minifier`). `index.js` is now ~130 lines covering only arg parsing, file I/O, watch mode, and `process.exit`. Direct-import test coverage added in `test/unit/compiler/cli-core.test.js` (15 new tests); `compileFiles` sourceMap branch and `--source-map --minify` conflict path covered by 3 additional tests (`packages.test.js`, `cli.test.js`). `compiler.js` reaches 100% statement coverage. Sentrux baseline reset to 6358 (prior 7049 save was a measurement artifact — new files were not yet tracked by git when it was recorded; prior v1.0.0 floor of 6447 is not directly comparable as it was measured with 3 fewer files).
- **Parser: declarations split** — `src/parser/index.js` (504 lines) is now a 155-line file containing only the constructor, primitives, and entry points (`parse`, `parsePackage`, `parseImport`). All top-level declaration methods (`parseTopDecl`, `parseFuncOrMethod`, `parseTypeDecl`, `parseVarDecl`, `parseConstDecl`, and helpers) are extracted into `src/parser/declarations.js` as `declarationParseMethods`, following the same mixin pattern as `statements.js`, `expressions.js`, and `types.js`.
- **ANY error cascade suppression** — `TAINTED_ANY` (`{ kind: "basic", name: "any", _tainted: true }`) is returned from all error-recovery paths (`err()` return value). Taint propagates through binary ops, selector expressions, call expressions, index expressions, and slice expressions, short-circuiting before any further error emission. User-declared `var x any` returns plain `ANY` (not tainted) and remains permissive. Eliminates cascading false-positive errors from a single undefined identifier.
- **Mixin `@this` JSDoc annotations** — all TypeChecker and CodeGen sub-module mixin objects (`statementCheckMethods`, `expressionCheckMethods`, `assignabilityMethods`, `resolveMethods`, `terminationMethods`, `statementGenMethods`, `expressionGenMethods`, `templGenMethods`, and all 20 stdlib codegen modules) are now annotated with `/** @typedef ... */` + `/** @type {ThisType<TypeChecker|CodeGen>} */`. IDE tools (VS Code, etc.) can now resolve `this.*` calls inside mixin methods to the correct class type without any runtime change.

## [1.0.0] - 2026-04-30

### Fixed
- **CodeGen: `fmt.Fprintln` / `fmt.Fprint` dropped arguments beyond the first** — when writing to a `strings.Builder`, `bytes.Buffer`, or generic `io.Writer` with more than one value argument (e.g. `fmt.Fprintln(&b, "hello", "world")`), only the first argument was formatted. A new `_buildFprintSprintfCall` helper now constructs the correct `__sprintf` call with one `%v` placeholder per argument (space-joined for `Fprintln`/`Fprint`, newline-appended for `Fprintln`).
- **Parser: generic instantiation with user-defined type arg in argument position** — `Identity[MyType]` (where `MyType` is an uppercase, non-builtin identifier) is now correctly recognised as a generic type instantiation rather than an index expression when it appears as a function argument before `,` or `)`. `looksLikeTypeArgList()` now tracks uppercase-starting identifiers as a third disambiguation signal alongside built-in type keywords and comma-separated arg lists.
- **CodeGen: silent wrong output on unsupported complex compound assignment** — `_genComplexCompoundAssign` previously emitted `lhs = rhs` (dropping the operator) for any compound assignment operator other than `+=`, `-=`, `*=`, `/=`. The `default` branch now throws an internal error, ensuring unsupported operators are caught loudly rather than producing silently incorrect JS.

### Changed
- **CodeGen: `gom` property-setter dispatch** — `Class`, `Type`, `Href`, `Src`, and `Placeholder` are now resolved via a `GOM_PROP_SETTERS` lookup table instead of five identical switch cases, consistent with the existing `GOM_ATTR_HELPERS` and `GOM_BOOL_ATTRS` tables.
- **dts-parser: per-declaration error recovery** — a malformed declaration in a `.d.ts` file no longer aborts the entire parse. The parser now wraps each top-level declaration in a try/catch, skips to the next `;` or `}` on failure, and emits a `console.warn` with the offending keyword and error message. Well-formed declarations after the bad one are still parsed.
- **CodeGen: `fmt.Sscan` / `Sscanln` / `Sscanf` deduplication** — the shared scanning loop (type-coercion and pointer-write logic) is extracted into a module-level `_SSCAN_LOOP` constant, eliminating the three near-identical inline lambda bodies.
- **TypeChecker: stdlib split** — `src/typechecker/stdlib.js` (previously ~1050 lines) is now a 16-line orchestrator that delegates to two focused modules: `stdlib/core.js` (browser globals, fmt, strings, bytes, strconv, sort, math, errors, time, unicode, os, slices, html, io) and `stdlib/extended.js` (gom, maps, regexp, rand, utf8, path, strings.Builder/bytes.Buffer, built-in functions). This improves cohesion without adding cross-layer import edges.
- **Architectural quality gate (Sentrux)** — adopted [Sentrux](https://sentrux.dev) for structural quality enforcement. Layer boundaries, coupling, cyclomatic complexity, and import cycles are checked on every `npm run check` run via `.sentrux/rules.toml`. A regression floor is stored in `.sentrux/baseline.json` (current quality signal: 6447/10000). The layer model is: `cli(0) → support(1) → codegen(2) → typechecker(3) → parser(4) → lexer(5) → types(6)`.

## [0.0.9] - 2026-04-24

### Added
- **Column numbers in type error messages** — type errors now include a `line:col` coordinate and a caret line pointing at the offending token, e.g. `Type error in main.go at line 3:15: Cannot assign untyped string to int` followed by `  3 |   var x int = "hello"` and `              ^`. The `_col` field is propagated from lexer tokens through `parsePrimary()` and `parseStmt()`; the `Program` node now carries `_source` so the typechecker can render the source context.
- **Incremental parse cache in watch mode** — `compiler.js` maintains a module-level `Map<filePath, {mtime, ast}>` cache. On each rebuild, files whose `mtime` is unchanged are reused without re-reading from disk or re-parsing. `clearParseCache()` and `parseCacheSize()` are exported for testing. The watch log now includes the name of the changed file.
- **`else if` chains in `.templ` bodies** — arbitrary-depth `if / else if / else` is now supported inside templ declarations; codegen recursively emits chained JS `else if` blocks.
- **`switch` in `.templ` bodies** — `switch expr { case v: ... default: ... }` inside template bodies compiles to a JS `switch` block, with each case body rendered as DOM nodes.
- **`@templ.Raw(htmlStr)`** — injects a trusted raw HTML string via `insertAdjacentHTML("beforeend", ...)`. Detected by matching the `templ.Raw(...)` call pattern in `TemplComponent` tokens.

### Fixed
- **Void elements without self-close slash** — `<br>`, `<hr>`, `<img>` etc. used without a trailing `/` in templ bodies now parse correctly instead of throwing "unclosed tag" errors. The parser short-circuits on void element open tags before attempting to collect children or a close tag.
- **`_lexHtmlText` swallowed `case`/`default` keywords** — text nodes inside `switch` case bodies incorrectly consumed subsequent `case` and `default` lines. Fixed by adding them to the break-keyword list alongside `if`, `for`, and `switch`.

### Changed
- **templ example** — updated to exercise all three new features: `switch` replaces the `filterLabel` Go helper in `FilterButton`; `else if` is used in `InputRow` so error messages take precedence over the priority hint; `@templ.Raw` injects the app CSS via a new `AppStyles` templ component (replacing `gom.Style`).
- **`src/templ-lexer.js` refactor** — extracted `_goTokens(src)` and `_lexGoExprBeforeBrace()` helpers, removing seven instances of the repeated `new Lexer(src).tokenize().filter(t => t.type !== T.EOF)` pattern and the duplicated 4-line "lex expression before `{`" block in `_lexTemplIf`, `_lexTemplFor`, and `_lexTemplSwitch`.
- **Test suite** — fixed five issues: weak `assertEqual(js !== null, true)` in the async compile test; `os.Exit` test body now actually calls `os.Exit`; "chained method calls" test rewritten with real struct method chaining and a runtime assertion; three duplicate `cap`/`copy` tests removed; `assert(...includes...)` replaced with `assertContains` in the type-assertion test.

## [0.0.8] - 2026-04-22

### Added
- **`math` additions** — `Atan`, `Atan2`, `Asin`, `Acos`, `Exp`, `Exp2`, `Trunc`, `Hypot`, `Signbit`, `Copysign`, `Dim`, `Remainder`.
- **`math/rand` package** — `Intn`, `Float64`, `Float32`, `Int`, `Int63`, `Int63n`, `Int31`, `Int31n`, `Seed` (no-op), `Shuffle`, `Perm`. Import `"math/rand"`.
- **`sort` additions** — `Search` (binary search), `IntsAreSorted`, `Float64sAreSorted`, `StringsAreSorted`.
- **`strings` additions** — `Fields`, `Cut`, `CutPrefix`, `CutSuffix`, `SplitN`, `SplitAfter`, `SplitAfterN`, `IndexAny`, `LastIndexAny`, `ContainsAny`, `ContainsRune`, `IndexRune`, `IndexByte`, `LastIndexByte`, `Map`, `Title`, `ToTitle`, `TrimFunc`, `TrimLeftFunc`, `TrimRightFunc`, `IndexFunc`, `LastIndexFunc`, `NewReplacer`.
- **`bytes` additions** — `ReplaceAll`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `TrimFunc`, `IndexByte`, `LastIndex`, `LastIndexByte`, `Fields`, `Cut`, `ContainsAny`, `ContainsRune`, `Map`, `SplitN`.
- **`strconv` additions** — `Quote`, `Unquote`, `AppendInt`, `AppendFloat`.
- **`unicode/utf8` package** — `RuneCountInString`, `RuneLen`, `ValidString`, `ValidRune`, `DecodeRuneInString`, `DecodeLastRuneInString`, `FullRuneInString`; constants `RuneError`, `MaxRune`, `UTFMax`. Import `"unicode/utf8"`.
- **`path` package** — `Base`, `Dir`, `Ext`, `Join`, `Clean`, `IsAbs`, `Split`, `Match`. `"path/filepath"` is an alias. Tree-shaken `__pathClean` helper.
- **`time` additions** — `time.Time` named type with methods: `Format`, `String`, `Year`, `Month`, `Day`, `Hour`, `Minute`, `Second`, `Weekday`, `Unix`, `UnixMilli`, `Add`, `Sub`, `Before`, `After`, `Equal`. New functions: `time.Parse`, `time.Unix`, `time.Date`. Layout constants: `RFC3339`, `RFC3339Nano`, `DateOnly`, `TimeOnly`, `DateTime`. Month/weekday constants. Tree-shaken `__timeFmt`/`__timeParse` helpers. **Breaking**: `time.Now()` now returns `{_d: new Date()}` instead of a plain number.
- **`io.Reader` shim** — `strings.NewReader`, `bytes.NewReader`, `io.ReadAll`.
- **`fmt` scanning** — `Sscan`, `Sscanln`, `Sscanf`.
- **E2E tests (Playwright)** — 74 end-to-end tests covering all three example apps
  (Simple, Reactive, Gom). Shared suite tests CRUD, filtering, priority mode,
  persistence (reload), drag-and-drop, and sync status. Per-app suites verify
  app-specific behaviour: scoped styles, stats bar, loading placeholder, `gom.If`
  conditional rendering. Infrastructure: `playwright.config.js` at root,
  `test/e2e/` with `global-setup.js` (builds all apps), `selectors.js`, `helpers.js`,
  and four spec files. New npm scripts: `test:e2e`, `test:e2e:ui`,
  `test:e2e:simple`, `test:e2e:reactive`, `test:e2e:gom`.

### Fixed
- **`__timeFmt` correctness** — replaced chained `.replace()` calls with a single
  regex pass so substituted year/month/day values can't be re-matched by later
  tokens (e.g. year `2015` no longer corrupts when `15` is also the hour token).

### Changed
- **Test suite** — removed 48 redundant `assert(errors.length > 0)` lines that
  immediately preceded `assertErrorContains` calls; the latter already reports a
  clear failure when the errors array is empty. Cleaned up four unused `assert`
  imports that became dead after the removal.
- **Example apps** — `removeTodo` and `clearCompleted` now use `slices.DeleteFunc`
  instead of the local `utils.Filter` generic; `validateTodo` uses
  `utf8.RuneCountInString` instead of `len([]rune(text))` across all three apps.
- **Resolver** — built-in stdlib package paths (`fmt`, `strings`, `unicode/utf8`,
  `path`, `math/rand`, etc.) are now silently skipped during import resolution
  instead of emitting a spurious "cannot find types" warning.

## [0.0.7] - 2026-04-22

### Added
- **Methods on named non-struct types** — methods can now be declared on any named type,
  not just structs. Named func and slice types with methods are emitted as ES6 wrapper
  classes (`class T { constructor(_fn) {...} }` / `class T { constructor(_items) {...} }`).
  - `type NodeFunc func(parent any)` with `func (n NodeFunc) Mount(parent any)` works
  - `type Group []Node` with `func (g Group) Mount(parent any)` works
  - Named non-struct types satisfy interfaces via their method sets
  - Composite literals: `Group{a, b}` → `new Group([a, b])`
  - Type conversions: `NodeFunc(fn)` → `new NodeFunc(fn)`
  - `append` on a named slice type returns the same named type (re-wraps the result)
  - `len`, `range`, and index access on named slice type variables correctly unwrap
  - Inside method bodies the receiver is automatically unwrapped to the underlying value
- **`gom` built-in namespace** — `gom` is now a first-class built-in namespace (like
  `fmt` or `strings`) registered in the typechecker and emitted inline by codegen. No
  source package to vendor — `import "gom"` is not needed; `gom.*` calls are available
  globally in any GoFront file. Every call compiles to an inline DOM object literal with
  a `Mount(parent)` method; zero runtime overhead. Provides: `El`, `Text`, `Attr`,
  `Class`, `Type`, `Href`, `Src`, `Placeholder`, `DataAttr`, `If`, `Map`, `Style`,
  `Mount`, `MountTo`. All HTML element helpers (`Div`, `Span`, `Button`, `Input`, `Li`,
  `Ul`, `Header`, `Footer`, `H1`–`H6`, `A`, `Strong`, `P`, `Form`, `Table`, `Tr`, `Th`,
  `Td`, and 30+ more) and attribute shorthands (`Class`, `For`, `Name`, `Value`,
  `Target`, `Draggable`, `AriaLabel`, `StyleAttr`, `Checked`, `Disabled`, `Selected`,
  `Readonly`, etc.) are all built in. Types `gom.Node`, `gom.NodeFunc`, and `gom.Group`
  are registered and usable in type annotations. The `example/gom/gom/` source directory
  is removed — the example app imports nothing and uses `gom.*` directly.
- **`gom` todo example** — `example/gom/` is a fully featured todo app with full parity
  to the simple and reactive examples: priority mode, input validation, localStorage
  persistence, sync-status indicator, urgent badge, filter bar, clear-completed,
  drag-and-drop reordering, and dark theme. All rendering uses pure gom nodes
  (`gom.El`, `gom.Map`, `gom.If`) — no `innerHTML`. Build with `npm run build:gom`.
- **`io` package shim** — `io.Writer` (accepted as a parameter/field type), `io.EOF`
  (sentinel error string), `io.Discard`, and `io.WriteString(w, s)`. `WriteString`
  dispatches to `strings.Builder`, `bytes.Buffer`, or any writer with a `WriteString`
  method, auto-dereferencing GoFront pointer wrappers. Enables shared Go code that
  accepts `io.Writer` to compile in GoFront unchanged.
- **Drag-and-drop: insert-before/after by cursor position** — all three examples now
  detect which half of the drop target the cursor is in. Hovering the top half shows a
  top accent border and inserts before; hovering the bottom half shows a bottom accent
  border and inserts after. Items can now be placed at any position including the very
  top and very bottom of the list.
- **Qualified type names in imports** — cross-package type annotations like `gom.Node`
  in function signatures now resolve correctly. `addPackageNamespace` registers exported
  types under both the simple name and the `pkg.TypeName` qualified form.

### Changed
- **`typechecker.js` split** — the built-in namespace and browser-global registration
  (`_setupGlobals`, ~800 lines) has been extracted into a new
  `src/typechecker/stdlib.js` sub-module, exported as `setupGlobals(globals, types)`.
  `typechecker.js` now delegates to it in a one-liner. No behaviour change; purely a
  code-organisation improvement. `src/typechecker.js` drops from ~2033 to ~1272 lines.
- **Reactive example** — overhauled to cover the full reactive.js API surface.
  The app shell is now a `Reactive.Component` using the complete lifecycle (`state`,
  `template`, `styles`, `mount`, `mountTo`, `refs`), eliminating all `querySelector`
  and `getElementById` calls from application code. New features demonstrated:
  `html` tagged template (via `htmlTag` wrapper), `data-html`, `data-visible`,
  `data-attr-*`, `data-bool-*`, `data-ref`, `Component.state()` auto-computed
  conversion, `Component.mount()` post-render hook, and `comp.refs.*` element access.
  The `ScanScope` struct and `setupScanBindings` function are removed — the Component
  itself is the scan scope. Inline validation errors use `data-if` (DOM removal);
  a priority hint uses `data-visible` (display toggle); the input placeholder and
  disabled state are driven reactively via `data-attr-placeholder` and
  `data-bool-disabled`.


## [0.0.6] - 2026-04-20

### Added
- **`html` package** — `EscapeString` and `UnescapeString`, compiling to inline `replace` chains. The hand-rolled `esc()` helpers in the example apps have been replaced with `html.EscapeString`.
- **`maps` package (Go 1.21)** — `Keys`, `Values`, `Clone`, `Copy`, `Equal`, `EqualFunc`, `Delete`, `DeleteFunc`. All map to inline `Object.*` calls. Also fixed `len()` on `any`-typed map values — `__len` now falls back to `Object.keys().length` for plain objects.
- **`slices` package (Go 1.21)** — `Contains`, `Index`, `Equal`, `Compare`, `Sort`, `SortFunc`, `SortStableFunc`, `IsSorted`, `IsSortedFunc`, `Reverse`, `Max`, `Min`, `MaxFunc`, `MinFunc`, `Clone`, `Compact`, `CompactFunc`, `Concat`, `Delete`, `DeleteFunc`, `Insert`, `Replace`, `Grow`, `Clip`. All map to inline JS array methods with no runtime overhead.
- **`regexp` package** — pattern matching via JS `RegExp`. Package-level: `MustCompile`, `Compile` (returns `(*Regexp, error)`), `MatchString`, `QuoteMeta`. Instance methods on `*Regexp`: `MatchString`, `FindString`, `FindStringIndex`, `FindAllString` (with `n` limit), `FindStringSubmatch`, `FindAllStringSubmatch`, `ReplaceAllString`, `ReplaceAllLiteralString`, `Split`, `String`. The global flag is automatically added for `matchAll`-based methods. Inline flags (`(?i)`, `(?m)`, `(?s)`) in the pattern string are extracted into the JS `RegExp` constructor's flags argument automatically.
- **`strings.Builder` and `bytes.Buffer`** — idiomatic string/byte building types. `strings.Builder` supports `WriteString`, `WriteByte`, `WriteRune`, `Write`, `String`, `Len`, `Reset`, and `Grow`; `bytes.Buffer` supports `WriteString`, `WriteByte`, `Write`, `String`, `Bytes`, `Len`, and `Reset`. Both compile to lightweight inline JS (no class generation). `fmt.Fprintf`, `fmt.Fprintln`, and `fmt.Fprint` are also now supported, accepting any writer (including `*strings.Builder` and `*bytes.Buffer`).
- **Dev server with live reload (`--serve`)** — new flag that starts a static file server
  and automatically reloads the browser after each successful recompile. Implies `--watch`.
  Serves files from the directory of the output file (`-o` is required). Default port is
  3000; use `--port <n>` to override. A small SSE-based reload client is injected into the
  compiled output — no extra dependencies, uses Node's built-in `http` module only.
  Can be combined with `--source-map`; the source map comment is always kept as the last
  line of the output.

### Fixed
- **`--source-map` now works for directory builds** — previously the flag was silently
  ignored when compiling a directory with `-o`; the inline source map is now correctly
  appended to the output file.
- **Per-file source maps for multi-file packages** — the `sources` array in the generated
  source map now lists each `.go` file individually (e.g. `src/main.go`, `src/store.go`)
  with paths relative to the output file, instead of a single directory entry. DevTools
  will show each source file separately and map breakpoints correctly.
- **Duplicate runtime helper declarations** — when a sub-package and its importer both
  used the same helper (e.g. `__append`), the bundled output contained two `function`
  declarations with the same name, which is a `SyntaxError` in ES module context. Helpers
  are now emitted as `var __name = __name || function(...) { ... };`, which is safe to
  appear multiple times.

## [0.0.5] - 2026-04-17

### Added
- **Generics (type parameters)** — Go-style generic functions and types:
  - Generic function declarations: `func Map[T any, U any](items []T, f func(T) U) []U`
  - Generic struct declarations: `type Box[T any] struct { Value T }`
  - Type inference: `Map(nums, fn)` infers T and U from argument types
  - Explicit type arguments: `Identity[int](42)`, `Box[string]{Value: "hi"}`
  - Constraints: `any`, `comparable`, named interfaces, union constraints (`~int | ~string`)
  - Methods on generic types: `func (s *Stack[T]) Push(v T)`
  - Generic functions as values: `Apply(Identity[int], 99)`
  - Type erasure to JavaScript — no runtime overhead, all complexity in the front-end
  - New `TILDE` token in lexer for `~` operator in union constraints
- **Better pointer model** — `&x` and `*p` now produce real pointer semantics instead
  of being no-ops:
  - `&x` on scalar locals (int, float64, string, bool) boxes the variable as `{ value: x }`
    and returns the box reference. All reads/writes to the variable go through `.value`.
  - `*p` dereferences a pointer by emitting `p.value`
  - Shared mutation through pointers works correctly: multiple pointers to the same
    variable see each other's changes
  - `swap(&x, &y)` pattern works as expected
  - Pointer comparison (`==`, `!=`) uses reference equality on box objects
  - `var p *int` initializes to `null`; `p == nil` compiles to `p === null`
  - `new(T)` continues to produce `{ value: zeroOf(T) }` as before
  - Structs, slices, and maps are reference types and skip boxing when `&` is applied
  - Closures capturing address-taken variables work correctly (JS captures the box object)
  - Type error for dereferencing non-pointer types: `*x` where `x` is not a pointer
  - `isPointer()` predicate added to type system utilities
- **Richer error values** — `error` is now an interface type `{ Error() string }` instead
  of a basic type (plain string). This is a **breaking change** at runtime:
  - `error("msg")`, `errors.New("msg")`, and `fmt.Errorf(...)` now return `__error` objects
    with `.Error()` and `.toString()` methods (tree-shaken runtime helper)
  - Custom error types: any struct with `Error() string` method satisfies the `error` interface
  - Type assertions on error values (`err.(MyError)`, comma-ok form) work naturally
  - `errors.Is(err, target)` — walks the error chain comparing by identity or `_msg`
  - `errors.Unwrap(err)` — returns the wrapped cause error or `nil`
  - `fmt.Errorf("...: %w", err)` — wraps errors with a cause chain; `%w` verb supported
    in `__sprintf` helper
  - Sentinel errors: package-level `var ErrX = errors.New("...")` work with `errors.Is`
  - `toString()` on error objects provides backward compatibility for `console.log(err)`
    and string interpolation contexts
  - **Migration**: `err === "msg"` string comparisons no longer work — use `err.Error() === "msg"`
    or `errors.Is(err, sentinel)` instead
- **Slice → array conversion** — `[N]T(slice)` converts a slice to a fixed-size array
  (Go 1.20 feature). Emits `.slice(0, N)` in JS. Array → slice `[]T(arr)` also supported.
- **Complex number types** — full support for `complex64`, `complex128`, and untyped complex constants:
  - Imaginary literals (`3i`, `1.5i`, `0i`) as `IMAG` tokens with semicolon insertion
  - `complex(r, i)`, `real(z)`, `imag(z)` builtins with correct type inference
  - Complex arithmetic (`+`, `-`, `*`, `/`) with tree-shaken `__cmul`/`__cdiv` helpers
  - Complex comparison (`==`, `!=` only; ordering operators rejected)
  - Numeric-to-complex promotion in mixed expressions (`3 * z`)
  - Type conversions: `complex128(x)`, `complex64(x)` from numeric types
  - `float64(complexVal)` rejected with "use real() or imag()" guidance
  - Compound assignment (`+=`, `-=`, `*=`, `/=`) on complex variables
  - `fmt.Sprintf("%v", z)` formats complex as `(a+bi)`
  - Zero value `{ re: 0, im: 0 }` for complex types
  - Unary `-`/`+` on complex values
  - Runtime representation: `{ re: number, im: number }` objects
- **Built-in minifier** (`src/minifier.js`) — replaces the `terser` dependency with a
  purpose-built minifier that understands GoFront's output:
  - Stage 1: comment and whitespace stripping
  - Stage 2: token-level compression (preserves strings, templates, regexes)
  - Stage 3: identifier mangling (opt-in via `--mangle` flag)
  - Stage 4: constant numeric literal folding
  - `--source-map` and `--minify` combined now emit a clear error
- **Better array semantics** — compile-time enforcement for fixed-size arrays:
  - `[...]T` size inference from composite literal element count
  - Reject `append()` on array types (type error)
  - Compile-time bounds checking for constant array indices
  - Composite literal element count validation against declared array size
  - Array assignment size matching (`[3]int` ≠ `[4]int`, `[]int` ≠ `[3]int`)
  - Compile-time `len()` for fixed arrays emits constant instead of `__len()`
  - Slicing arrays produces slice types (`arr[1:3]` on `[5]int` → `[]int`)
- **Range over iterator functions** (Go 1.23) — `func(yield func(V) bool)` and
  `func(yield func(K, V) bool)` iterator protocols:
  - `for v := range iterFunc` and `for k, v := range iterFunc` syntax
  - `break`, `continue`, and `return` inside iterator loops propagate correctly via
    yield return value
  - Iterator functions can be stored in variables or returned from other functions
  - Works with all existing `for range` features (labels, blank identifiers)
- **`bytes` stdlib shim** — `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `Join`,
  `Split`, `Replace`, `ToUpper`, `ToLower`, `TrimSpace`, `Equal`, `Count`, `Repeat` —
  parallel to the `strings` shim but operating on `[]byte` slices

### Changed
- **`terser` removed** — replaced by the built-in minifier; `terser` is no longer a
  devDependency. The `--minify` flag now uses `src/minifier.js` directly.

## [0.0.4] - 2026-04-17

### Added
- **Method expressions** (`T.Method`) — `TypeName.MethodName` now produces a first-class function whose first argument is the receiver, e.g. `f := Point.Dist; f(p)` (Go spec §Method expressions)
- **Method values** (`.bind()`) — `p.Dist` stored in a variable now binds the receiver via `.bind(p)`, so calling the stored function later behaves correctly (Go spec §Method values)
- **Struct and array equality** — `==` and `!=` on struct and array types now perform deep value comparison via a tree-shaken `__equal` helper; comparing two non-nil slices or maps is now a type error (Go spec §Comparison operators)
- **Terminating statement analysis** — non-void functions that lack a return on some path now produce a `missing return` compile error (Go spec §Terminating statements). Handles `if/else`, `switch` with `default`, `TypeSwitchStmt`, and `panic()` calls.
- **Const expression repetition** — in a `const (...)` block, omitting the expression on subsequent specs now correctly repeats the previous expression with the updated `iota` value, e.g. `Read = 1 << iota; Write; Exec` gives 1, 2, 4 (Go spec §Constant declarations §Iota)
- **Exported/unexported identifier enforcement** — accessing a lowercase-named symbol from a GoFront package via `pkg.name` is now a type error (`cannot refer to unexported name`). External `.d.ts` / npm namespaces are exempt. (Go spec §Exported identifiers)
- **String indexing returns byte** — `s[i]` on a string now compiles to `s.charCodeAt(i)`, returning an integer byte value instead of a JS character (Go spec §Index expressions)
- **`unicode` package** — `IsLetter`, `IsDigit`, `IsSpace`, `IsUpper`, `IsLower`, `IsPunct`, `IsControl`, `IsPrint`, `IsGraphic`, `ToUpper`, `ToLower` — implemented using Unicode-aware JS regex and `codePointAt`/`fromCodePoint`
- **`os` package** (partial) — `Exit` (→ `process.exit`), `Args` (→ `process.argv`), `Getenv` (→ `process.env[...]`)
- **Multi-value function forwarding** — `f(g())` where `g()` returns multiple values is now valid and compiles to `f(...g())` (Go spec §Calls)

### Fixed
- **Blank identifier `_ = expr`** in regular `=` assignments — `_ = someFunc()` and `x, _ = f()` no longer produce `Undefined: '_'` errors
- **Positional (unkeyed) struct literals** — `Point{1, 2}` now correctly generates `new Point({ X: 1, Y: 2 })` instead of an empty struct; also works inside slices (`[]Point{{1, 2}, {3, 4}}`)
- **`interface{}` assignability** — assigning any concrete value to an `interface{}`-typed variable or parameter is now accepted (previously only the `any` alias worked)
- **Comma-ok with `=`** — `v, ok = m["key"]` (map index) and `v, ok = x.(T)` (type assertion) now work with regular `=` assignment, not just `:=`; missing map keys return the zero value
- **`for range` string yields rune integers** — the value variable in `for i, r := range s` is now an integer code point (`r == 65`) rather than a JS character string
- **Type switch multi-case capture variable** — `switch v := x.(type) { case int: ...; case string: ... }` no longer spuriously reports `'v' declared and not used`
- **Slice/map `== nil`** comparison is still valid — the new incomparable-type check correctly allows `slice == nil` while rejecting `slice1 == slice2`

### Tests
- Added 49 tests covering all new features and bug fixes, distributed across the existing test files
- Updated `test/language/core.test.js`: `range over string` test updated to expect rune integers (correct Go behavior)
- Updated `test/builtins/operators.test.js`: `s[i]` test updated to expect `charCodeAt` integer result
- Updated `test/compiler/imports.test.js`: unexported-access test now asserts the error is emitted rather than silently accepted

## [0.0.3] - 2026-04-16

### Added
- Built-in `strings` package — `Contains`, `HasPrefix`, `HasSuffix`, `Index`, `LastIndex`, `Count`, `Repeat`, `Replace`, `ReplaceAll`, `ToUpper`, `ToLower`, `TrimSpace`, `Trim`, `TrimPrefix`, `TrimSuffix`, `TrimLeft`, `TrimRight`, `Split`, `Join`, `EqualFold`
- Built-in `strconv` package — `Itoa`, `Atoi`, `FormatBool`, `FormatInt`, `FormatFloat`, `ParseFloat`, `ParseInt`, `ParseBool` (multi-return with error for parse functions)
- Built-in `sort` package — `Ints`, `Float64s`, `Strings`, `Slice`, `SliceStable`, `SliceIsSorted`
- Built-in `math` package — `Abs`, `Floor`, `Ceil`, `Round`, `Sqrt`, `Cbrt`, `Pow`, `Log`, `Log2`, `Log10`, `Sin`, `Cos`, `Tan`, `Min`, `Max`, `Mod`, `Inf`, `IsNaN`, `IsInf`, `NaN` + constants `Pi`, `E`, `MaxFloat64`, `SmallestNonzeroFloat64`, `MaxInt`, `MinInt`
- Built-in `errors` package — `errors.New` (returns a plain string, consistent with GoFront's error model)
- Built-in `time` package (partial) — `time.Now` (→ `Date.now()`), `time.Since`, `time.Sleep` (async, ms conversion) + duration constants `Millisecond`, `Second`, `Minute`, `Hour`
- Expanded `fmt.Sprintf` format verbs — `%t` (bool), `%x`/`%X` (hex), `%o` (octal), `%b` (binary), `%q` (quoted string), `%e`/`%E` (scientific), `%g`/`%G` (general float), width specifiers (`%8d`), zero-padding (`%04d`), and precision (`%.2f`)
- Grouped `type (...)` declarations — multiple type definitions can be grouped in parentheses, matching Go syntax for `var (...)` and `const (...)`; works at top-level and inside function bodies
- Go Compatibility section in README — documents what matches Go, GoFront extensions, unimplemented features, and 16 semantic differences in one place
- Semantic difference tests — explicit tests encoding GoFront-specific behaviour for: `len()` on multi-byte strings, `range` over multi-byte strings (sequential indices vs byte offsets), `[n]T` as plain JS arrays, unchecked plain type assertions, comma-ok assertion semantics, and cross-package unexported symbol access
- ROADMAP.md updated against Go spec go1.26 — added 13 new rows to core language section, 5 to type system, 3 to builtins, and 3 new items to the implementation roadmap (range-over-func, complex types, grouped type declarations)
- Bit clear operator `&^` (AND NOT) — compiles to `& ~` in JavaScript
- Numeric literal separators (`1_000_000`, `0xFF_FF`) — underscores stripped at lex time
- Binary literals (`0b1010`, `0B1010`) and explicit octal literals (`0o777`, `0O777`)
- Hex float literals (`0x1.8p1`, `0xAp-2`) — evaluated at lex time to decimal values
- Three-index slice expressions (`s[lo:hi:max]`) — parsed and type-checked; `max` is ignored at runtime (JS has no slice capacity)
- `string(int)` conversion now produces the Unicode code point character (matching Go) — `string(65)` → `"A"` via `String.fromCodePoint`
- `fallthrough` inside type switch is now a compile error (matching Go spec)
- Unused local import detection — importing a cross-package dependency without using it is a type error (matching Go); `import _` side-effect imports are exempt
- Anonymous struct types — `struct { Name string; Age int }` can now be used as inline type expressions, composite literals, function return types, and variable declarations. Compiled to plain JS objects (no class emitted).
- Dot imports (`import . "pkg"`) — merges a package's exported symbols into the current scope so they can be used without a qualifier
- Untyped constants (Go spec §Constants) — constants declared without an explicit type (`const x = 5`) now carry an untyped type (`untyped int`, `untyped float64`, `untyped string`, `untyped bool`) that coerces to any compatible typed context. Literals also produce untyped types; variables and `:=` declarations materialize to the default type. Arithmetic between untyped constants stays untyped; mixing with typed values adopts the typed side. Iota constants are untyped.
- Unused variable detection — local variables declared with `:=` or `var` that are never referenced are now type errors (matching Go semantics). Function parameters, constants, and `_` are exempt.
- `go`, `chan`, `select` are now recognized keywords — using goroutines, channels, or select produces clear parse errors (e.g. "goroutines are not supported in GoFront") instead of confusing "Undefined" messages
- Split `parser.js` (1,237 lines) into `parser/types.js`, `parser/statements.js`, and `parser/expressions.js` sub-modules using the mixin pattern
- Split `typechecker.js` (1,346 lines) into `typechecker/types.js`, `typechecker/statements.js`, and `typechecker/expressions.js` sub-modules
- Split `codegen.js` (1,348 lines) into `codegen/source-map.js`, `codegen/statements.js`, and `codegen/expressions.js` sub-modules
- Edge-case tests for map iteration order semantics (insertion order preserved after delete+re-add, non-alphabetical key insertion order)
- Edge-case tests for integer overflow / float64 semantics (no 32-bit wrapping, precision loss at 2^53, integer division truncation, float64 division by zero)
- Tests verifying `defer` in closures does not leak try/finally to parent function, and functions without `defer` produce no try/finally wrapper
- Two example apps: `example/simple/` (vanilla DOM, zero dependencies) and `example/reactive/` (signals-based using [reactive.js](https://github.com/seriva/microtastic) with `.d.ts` type imports). Both implement the same todo app to showcase different aspects of GoFront.

### Fixed
- Node.js version requirement in README corrected from "25+" to "20+" (matching `package.json` `engines` field)
- `defer` inside nested control flow within `switch` cases (e.g. `defer` inside an `if`, `for`, or block inside a `case`) — the `_hasDefer` detection was only checking one level deep, so the try/finally wrapper was not emitted and `__defers` was undefined at runtime
- Unterminated block comments (`/* without */`) now throw a `LexError` with line/column context instead of being silently swallowed
- `genStmt` in codegen now throws on unhandled AST statement kinds instead of silently dropping them (matches `genExpr` behaviour)
- `isIntType()` in codegen now unwraps named types (`type MyInt = int`) so integer division correctly emits `Math.trunc()`
- Labeled `break`/`continue` now validate loop/switch depth — `continue MyLabel` outside a loop is now a compile error even when a label is present

### Changed
- Type assertions (`x.(T)`) now require the source expression to be an interface or `any` type — asserting from a concrete type is a compile error (matching Go)
- Plain type assertions (`x.(T)`) now panic at runtime on type mismatch (matching Go) — previously the value passed through unchecked
- Comma-ok type assertions (`v, ok := x.(T)`) now return the zero value of `T` on failure (matching Go) — previously the original value was returned
- Interface satisfaction checks now verify full method signatures — parameter types, parameter count, variadic flags, and all return types must match exactly (previously only method name and first return type were checked)
- Interface method declarations now preserve the variadic flag from the parser
- Source-map `buildSourceMap` uses a `Map` lookup instead of linear `.find()` scan — O(n) instead of O(n²)
- `isTypeKeyword()` / `isBuiltinKeyword()` in the parser now use module-level `Set`s instead of allocating arrays on every call
- Removed redundant `.includes()` check in `looksLikeType()` — the `T.IDENT` branch already covers type keyword values
- Simplified dead `if` guard in `_parsePrimary()` type-conversion path
- Removed unused `_label` parameter from watch-mode `buildOnce()`
- `defer` detection moved from codegen to type-checking phase — the typechecker now sets `body._hasDefer` on function body AST nodes during `checkFuncDecl`/`checkMethodDecl`/`FuncLit`, replacing the recursive `_hasDefer()` AST walk that ran on every function emit in codegen
- Map access with side-effecting key expressions (e.g. `m[getKey()]`) no longer double-evaluates the key — when the index contains a call expression, codegen now emits an IIFE `((__m, __k) => __m[__k] ?? zero)(m, getKey())` instead of the inline `(m[getKey()] ?? zero)` pattern; simple literal/variable keys still use the lean inline form
- `isIntType()` in codegen now recognises all sized integer types (`int8`–`int64`, `uint`–`uint64`, `uintptr`, `byte`, `rune`) via a `Set` lookup, not just `int` — ensures `Math.trunc` is emitted for integer division regardless of the declared type
- Test suite restructured: `language.test.js`, `builtins.test.js`, `types.test.js`, and `compiler.test.js` split into subdirectories (`test/language/`, `test/builtins/`, `test/types/`, `test/compiler/`) with 3–4 focused files each, mirroring the `src/` submodule pattern
- Removed `ROADMAP.md` — condensed roadmap is now an inline section in `README.md`

## [0.0.2] - 2026-04-14

### Added
- Test suite split into focused files (`language.test.js`, `types.test.js`,
  `structs.test.js`, `builtins.test.js`, `compiler.test.js`, `dom.test.js`,
  `lexer-parser.test.js`) with shared helpers in `test/helpers.js`; `test/run.js`
  is now a thin orchestrator. Each file can be run standalone with
  `node test/<file>.test.js`.
- Expanded CLI coverage tests: `--watch` mode (initial build, error path, `-o`
  output), `init` failure paths (mkdir/write errors), single-file unreadable input,
  output file write failure, npm import resolution, and local package bundling.
- Labeled `break` and `continue` statements — labels on `for` loops compile to native JS labeled statements, enabling `break Label` and `continue Label` across nested loops or from within a `switch` inside a `for`
- Rune / char literals (`'a'`, `'\n'`, `'\t'`, `'\\'`, `'\''`, `'\0'`) — tokenized by the lexer and emitted as integer char codes; fully usable in arithmetic and comparisons
- Variadic spread: `append(a, b...)` and `f(slice...)` now compile correctly to JS spread syntax (`...slice`)
- Import aliases (`import m "./pkg"`) — the alias is used as the namespace name for type checking and the bundled package qualifier, so `m.Func()` works identically to the inferred name
- `recover()` built-in: `defer`/`panic`/`recover()` now work together — `defer` compiles to try/catch/finally, and `recover()` inside a deferred closure captures and clears the panic value, preventing it from propagating
- Bug fix: calling an anonymous function literal directly (`func(){}()`) now emits valid JS `(function(){})()`
- Sized integer types (`uint`, `int8`, `int16`, `int32`, `int64`, `uint8`, `uint16`, `uint32`, `uint64`, `uintptr`, `float32`) — accepted as type annotations and mapped to `int` / `float64` at runtime
- Struct field tags (`` `json:"name"` ``) — parsed and silently ignored; no reflection, but code using standard Go tags now compiles without errors
- Bitwise compound assignments (`&=`, `|=`, `^=`, `<<=`, `>>=`) — lexer, parser, and codegen extended to match the existing arithmetic compound assignments
- Type switch (`switch x.(type)` and `switch v := x.(type)`) — compiles to an `if/else if` chain using `typeof`, `instanceof`, and `=== null` checks; supports `int`, `float64`, `string`, `bool`, `nil`, `error`, all sized integer aliases, and struct types
- `[]byte(s)` conversion — produces a plain JS array of UTF-8 byte values via `Array.from(new TextEncoder().encode(s))`
- `[]rune(s)` conversion — produces a plain JS array of Unicode code points via `Array.from(s, c => c.codePointAt(0))`
- Interface embedding — `type ReadWriter interface { Reader; Writer }` flattens embedded interface methods into the parent interface for satisfaction checks; diamond embedding is deduped; embedding non-interface types is a compile error
- `[...]T{...}` array length inference — the parser accepts `[...]` in array type position and the type checker infers the length from the composite literal
- Side-effect imports (`import _ "pkg"`) — the dependency is compiled and bundled but the package namespace is not exposed to the importer
- `min()` / `max()` builtins — compile to `Math.min` / `Math.max`
- `clear()` builtin — zeroes slice length (`.length = 0`) or deletes all map keys
- `range` over integer (`for i := range n`, `for range n`) — Go 1.22 integer range; compiles to a C-style `for` loop
- Type aliases (`type A = B`) — transparent alias in the type checker; the alias and original type are freely interchangeable without conversion

### Fixed
- `new(T)` for basic types (`new(int)`, `new(string)`, `new(bool)`, `new(float64)`) — the type-checker was incorrectly evaluating the type-name argument as a value expression, producing a false "Undefined" error; the argument is now treated as a type node
- Array type notation in error messages — `[3]int` was displayed as `[object Object]int`; the size AST node is now converted to a number when building the type object
- `[]int(slice)` generic slice conversion — when converting a non-string slice (e.g. `[]int(src)`) the codegen was applying the `.codePointAt(0)` string-rune path to all `[]int` conversions; it now only applies that path when the source expression is a `string`
- `LexError` messages now include the source line context for all error sites (unterminated strings, empty rune literals, multi-character rune literals, unknown rune escapes)

## [0.0.1] - 2026-04-12

### Added
- Initial release of the GoFront compiler
- Go-inspired syntax compiling to JavaScript
- Structs, interfaces, methods, closures
- Multiple return values and named returns
- Variadic parameters
- `init()` functions with FIFO execution before `main`
- Short variable re-declaration (`:=` where at least one LHS name is new)
- Slices, maps, `make`, `append`, `len`, `cap`, `copy`
- `for` loops: C-style, `for range`, `while`-style, infinite
- `range` over strings
- `switch` / `case` / `fallthrough` / `default`
- `defer` with LIFO execution and try/finally semantics
- `error` type as plain strings; `error("msg")` / `.Error()`
- `async func` and `await` expressions
- Embedded structs: field access, composite-literal initialisation via embedded type key, and method promotion to the outer struct
- `fmt` package: `fmt.Sprintf`, `fmt.Printf`, `fmt.Println`, `fmt.Print`, `fmt.Errorf` with `%s`, `%d`, `%v`, `%f`, `%%` format verbs
- Type checking with interfaces, struct fields, and basic types
- Interface satisfaction checks return type as well as method presence
- Type checks: `break`/`continue` outside loop, `fallthrough` outside switch, reassigning a `const` are now compile errors
- External `.d.ts` type definitions (`js:` prefix)
- npm package type resolution via `@types/` and `package.json` `types` field
- Multi-file packages and cross-package imports
- Source maps via `--source-map` flag
- `--check` (type-check only), `--ast`, `--tokens` debug flags
- `--watch` mode with debounced recompilation
- `--minify` flag — minifies output with terser (`module: true, compress: true, mangle: true`)
- `gofront init [dir]` to scaffold a new project
- `--version` / `-v` flag
- `--help` output
- Source files use `.go` extension for automatic editor syntax highlighting
- 422 tests covering language features, type errors, edge cases, DOM (jsdom), external `.d.ts`, npm resolver, multi-file compilation, embedded structs, string formatting, and the example app
- CI via GitHub Actions (Node 25)
- Example todo app demonstrating structs, iota constants, named returns, closures, slices, maps, `for range`, `switch`, cross-package imports, `async`/`await`, localStorage persistence, and HTML5 drag-and-drop
