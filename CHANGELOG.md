# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added
- **Expanded standard library and Go 1.23 iterators**: Added `iter` and `cmp` on both backends, alongside the Go 1.23 iterator functions in `slices`, `maps`, `strings`, and `bytes` and broader coverage across `math`, `math/bits`, `time`, `io`, `sort`, `unicode`, `unicode/utf8`, `strconv`, `sync`, and `os` (`Stdout`, `Stderr`, and `Stdin` as `io.Writer`/`io.Reader`). Only the standard library functions your code reaches are emitted into the bundle; see [the compatibility notes](docs/go-compatibility.md) and [the coverage tables](docs/language-support.md#standard-library-shims) for details.
- **Complete `fmt` formatting and scanning**: All Go format verbs and flags now work on both backends, including `%T`, `%#v`, `%p`, `%U`, argument indexes (`%[1]d`), dynamic width and precision, `Sprint`/`Sprintln`/`Append*`, and `Sscan`/`Sscanf`/`Sscanln`, with Go's error output for bad verbs or missing arguments. Values implementing `fmt.Stringer` or `error` format through `String()` or `Error()` (including inside slices, maps, and exported struct fields), and WebAssembly now formats `any` values and exact 64-bit integers.
- **`encoding/json` on both backends and streaming APIs**: `encoding/json` now works in `wasm` and `both` packages as well as `js` packages, and adds `Encoder`, `Decoder`, `Number`, `Compact`, `Indent`, `HTMLEscape`, typed error values (`*json.SyntaxError`, `*json.UnmarshalTypeError`, `*json.InvalidUnmarshalError`), and `time.Time`/`time.Duration` JSON marshaling across both backends. In `wasm` and `both` packages, codecs compile directly into WebAssembly without calling the host's `JSON` and preserve exact 64-bit integers; see [the compatibility notes](docs/go-compatibility.md#semantic-differences).
- **Benchmarks and test lifecycle in `gofront test`**: `gofront test` now runs `BenchmarkXxx(*testing.B)` benchmarks with `-bench` (supporting `b.N`, `b.Loop()`, `ResetTimer`, and `ReportAllocs`) and supports `TestMain(m *testing.M)`, `t.Cleanup`, `t.Context`, `t.Setenv`, and `t.Deadline` across `js`, `wasm`, and `both` packages.
- **Language parity and generics across both backends**: `wasm` and `both` packages now support `for … range` over iterator functions (with `break`, `return`, `defer`, and panics), `complex64`/`complex128`, `min`/`max`, `[]rune` conversions, variadic functions, and method values. Both backends also support generic type aliases (`type Set[T comparable] = map[T]struct{}`), pointer-receiver and generic method expressions (`(*T).M`, `Box[int].Get`), package-qualified generic instantiation (`cmp.Compare[int](1, 2)`), recursive generic types, conversions to a type parameter (`T(n)`), map literals with elided key types, and declarations that shadow predeclared names (`len`, `Array`, `document`, emitted with a `$` suffix for JavaScript callers; see [shadowed names](docs/go-compatibility.md#names-that-shadow-js-globals)).
- **Expanded `gofront/simd` (experimental)**: `simd.F32x4` and `simd.Mask32x4` now work as ordinary values (in struct fields, arrays, slices, map keys, `==`, `fmt`, generics, and across the JS↔WASM boundary) and add rounding, `MulAdd`, `Sum`, `Swizzle`/`Shuffle`, lane comparisons, `Select`, `LoadF32x4Slice`/`StoreF32x4Slice`, and `Pad4`. A 65,536-particle step runs about 1.6× faster than scalar WebAssembly, and the package remains experimental; see [the hybrid guide](docs/hybrid-wasm.md#wasm-simd-gofrontsimd).

### Changed
- **Breaking: `maps.Keys` and `maps.Values` return `iter.Seq`**: As in Go 1.23, they now return an `iter.Seq` iterator instead of a slice. Range over the result directly, or wrap it in `slices.Collect(...)` or `slices.Sorted(...)` where you need a slice.
- **Breaking: `strconv.ParseInt` returns `int64` and parse errors use `*strconv.NumError`**: `strconv.ParseInt` now returns `(int64, error)` to match Go, and `strconv` parse functions return `*strconv.NumError` values wrapping `strconv.ErrSyntax` or `strconv.ErrRange`. Convert the result with `int(...)` where an `int` is expected, and use `errors.Is` or `errors.As` to inspect parse errors.
- **Breaking: `[]simd.F32x4` crosses the WASM boundary as one `Float32Array`**: Exported `wasm` functions and struct fields now pass and return `[]simd.F32x4` as a single flat `Float32Array` (4 floats per vector) instead of an array of 4-element arrays. Pass and read flat `Float32Array` data at the JavaScript boundary.
- **Breaking: runtime panics in `both` packages**: Out-of-range slice, array, and string indexes, writes to nil maps, and field accesses through nil struct pointers in `both` packages now panic with Go's messages on both backends (with loop bounds checks elided when provably safe) instead of reading `undefined` or trapping. Fix out-of-bounds or nil accesses in calling code, or catch expected panics with `recover()`.
- **Breaking: no pointers to scalar fields, elements or package-level variables in `wasm` and `both` packages**: `&s.X`, `&xs[i]`, `&pkgVar` and pointer-receiver calls on such operands (`s.Count.Inc()` where `Count` is a named `int`) are now compile errors in `wasm` and `both` packages, where they previously gave stale or lost writes. Pass the parent struct pointer or the index instead, or copy the value to a local; `js` packages are unchanged, see [pointers in `wasm` and `both` packages](docs/hybrid-wasm.md#pointers-in-wasm-and-both-packages).
- **Breaking: stricter constant expressions and composite literals**: Constant expressions that overflow their target type (such as `int32(1 << 40)`), negative shift counts, constant division by zero, and duplicate or non-constant array and slice literal keys are now compile errors as in Go (and constants outside ±2⁵³ in JS emit a precision warning). Adjust constant values, target types, or literal keys to fit.
- **Breaking: type declarations named after JavaScript built-ins are rejected**: Structs and method-bearing types in `js` and `both` packages can no longer share a name with JavaScript built-in constructors used by generated code (`Array`, `Object`, `Error`, `Map`, `Set`, `Number`, …). Rename the type (for example to `ArrayData` or `AppError`); see [shadowed names](docs/go-compatibility.md#names-that-shadow-js-globals).
- **Breaking: unknown escape sequences in string literals are rejected**: Unknown escape sequences in interpreted string literals (such as `\c` or `\8`) are now compile-time lexer errors instead of being kept verbatim. Use valid Go escape sequences or raw string literals (`` `...` ``).
- **Targeted diagnostics for `goto` and unsupported standard library APIs**: `goto`, `//go:embed`, and excluded Go packages or members (`reflect`, `net/http`, `math/big`, `iter.Pull`) now report why they are unavailable and suggest supported alternatives.

### Fixed
- **Pointer, array, and loop semantics in WebAssembly**: Fixed-size arrays now copy by value, three-clause `for` loops allocate per-iteration variables when captured by closures, inner `:=` declarations stay block-scoped, multi-value assignments evaluate all right-hand sides first, and package-level arrays, named array types, pointers to arrays, and same-named methods with different signatures work properly. Pointers to scalar struct fields and slice or array elements are available in `js` packages only; see the breaking change below.
- **Slice views, constants, generics, and value semantics in JavaScript**: Slicing (`b[i:j]`, `b[i:j:k]`) and variadic spreads (`f(xs...)`) now share the backing array and honour `cap`, constant expressions fold with exact integer precision (`1 << 40`), unsigned `^` and `-` wrap to width, and 64-bit shifts by 32 or more bits match Go. Generic zero values (`cmp.Or(0, 3)`), struct equality and copying on type parameters, runtime type switches across generic instantiations (`*Stack[int]` vs `*Stack[string]`), keyed and anonymous composite literals, promoted field writes, nil map comparisons, and struct-pointer type assertions now match Go; see [the compatibility notes](docs/go-compatibility.md#semantic-differences).
- **WebAssembly interfaces, boundary variables, and string escapes**: Anonymous struct variables initialize to zero structs instead of nil, named strings and maps stored in `any` support type assertions, nil maps can be populated through pointers, and JavaScript callers can read exported package variables from `wasm` packages. Interpreted string literals now decode all Go `\x`, octal, `\u`, `\U`, and control escapes on both backends.
- **Standard library and JSON edge cases**: `encoding/json` now serializes promoted fields at the embedded struct's declaration position, `fmt.Print` spaces non-string arguments like Go and formats structs with named slice fields in WebAssembly, and `unicode.IsSpace`, `strings.Fields`, and `bytes.Index` on non-ASCII UTF-8 bytes match Go on both backends. In JavaScript, `math.IsInf(math.NaN(), 0)` returns `false`, and `slices.Contains` and `slices.Index` compare struct and array elements by value and accept nil slices.

## [1.7.0] - 2026-10-20

### Added
- **`encoding/json` in `js` packages**: `json.Marshal`, `json.MarshalIndent`, `json.Unmarshal`, and `json.Valid` now work in `js` packages without runtime reflection, supporting struct tags (`omitempty`, `string`, `-`), embedded structs, `json.RawMessage`, and `MarshalJSON`/`UnmarshalJSON` methods. See [standard library support](docs/language-support.md#standard-library-shims) for details.
- **TypeScript tuple returns and variadic declarations**: `.d.ts` functions that return tuples (`[A, B]`) now map to Go multi-value returns, and rest parameters (`...args`) work as variadic parameters when calling JavaScript libraries.
- **Subpath vendor imports and named globals**: `gofront.vendor` now supports package subpaths such as `preact/hooks` and binds named exports directly onto `window`.
- **Preact TodoMVC example**: Added a Preact TodoMVC example app using function components, hooks, and Go struct props.
- **Experimental WebAssembly SIMD (`gofront/simd`)**: Opt-in `simd.F32x4` 4-wide float32 vector operations and shared-buffer load/store helpers compile to native WebAssembly SIMD instructions with a JavaScript scalar fallback.

### Fixed
- **Named non-struct types with methods**: Values of types such as `type Celsius float64` or `type Names []string` now keep their underlying representation in `js` packages, so arithmetic, comparisons, map keys, pointer receivers, type switches, and `errors.Is`/`errors.As` work without wrapper-object bugs.
- **Interface type assertions**: `v.(SomeInterface)` and interface cases in type switches now check at runtime that the value implements the interface's methods instead of always succeeding.
- **Address-taken variables and multi-value declarations**: Taking the address of a variable declared alongside another (`a, b := 1, 2; &a`) or a function parameter no longer crashes at runtime, and `var a, b = f()` destructures multi-value returns properly.
- **Assignability of unnamed slice, map, and function types**: Assigning an unnamed composite type such as `[]string` to a named type with the same underlying type (`type Names []string`) is now accepted, matching Go.

### Removed
- **Reactive example**: Retired the legacy `reactive.js` example in favor of the Preact example.

## [1.6.1] - 2026-10-18

### Added
- **Expanded standard library across `wasm` and `js` packages**: Added `encoding/binary`, `encoding/hex`, `encoding/base64`, `crypto/rand`, `crypto/sha256`, and single-threaded `sync` primitives (`Mutex`, `RWMutex`, `Once`, `WaitGroup`) on both backends, and brought `strings`, `bytes`, `strconv`, `math`, `math/bits`, `math/rand`, `slices`, `fmt`, `unicode`, `io`, `path`, `html`, `time`, and `errors` (`As`, `Join`) to `wasm` packages. See the [coverage tables](docs/language-support.md#standard-library-shims).
- **Richer `wasm` language and boundary support**: `wasm` packages now support package-level non-literal constants and array or interface map keys, and the JS↔WASM boundary now passes `error`, `map`, pointers to primitives, anonymous structs, anonymous interfaces, `time.Time`, and `time.Duration`. See [hybrid WebAssembly](docs/hybrid-wasm.md).
- **Faster and smaller WebAssembly output**: Release builds optimize more aggressively while preserving nil-pointer traps, and avoid redundant struct copies and bounds checks on fixed-size arrays.

### Fixed
- **Generic structs and package-qualified conversions**: Instantiated generic structs keep their type arguments across calls, and package-qualified conversions (`time.Duration(x)`) validate their argument count and type on both backends.
- **Standard library and WebAssembly edge cases**: Byte-slice functions consistently return `Uint8Array`, 64-bit unsigned functions return plain numbers, `crypto/rand.Read` handles buffers larger than 64 KiB, and compound assignments (`/=`, `%=`, `<<=`, `>>=`), `fmt.Sscan*`, and `time` formatting and parsing match Go across both backends.

### Removed
- **`fmt.Scan`**: Removed `fmt.Scan` because browser environments do not have a synchronous standard input stream.

## [1.6.0] - 2026-10-10

### Added
- **Interfaces, generics, ordered maps, and `defer`/`recover` in `wasm` packages**: `wasm` packages now support non-empty interfaces (including across the JS↔WASM boundary), generic functions and structs, insertion-ordered maps, `defer`/`recover`, subtests (`t.Run`), and a wider set of standard library packages (`errors`, `fmt`, `strings`, `strconv`, `unicode/utf8`, `slices`, `maps`, `sort`, `math`).
- **Zero-copy shared buffers (`gofront/shared`)**: `wasm` packages can allocate typed linear-memory buffers (`shared.NewFloat32`, `NewUint8`, and friends) that JavaScript reads and writes directly as TypedArray views without copying; see [hybrid WebAssembly](docs/hybrid-wasm.md).
- **Release WebAssembly optimization and source maps**: `gofront build --release` (or `--wasm-opt`) shrinks and speeds up `app.wasm` with Binaryen when available, and `--source-map` emits `app.wasm.map` for browser debugging.
- **Per-package target configuration and `--js-only`**: Package targets are now configured under `"targets"` in `gofront.json` (or overridden with `--js-only` / `--target js` on any CLI command), and the compiler warns when a `js` loop crosses into `wasm` on every iteration.

### Changed
- **Breaking: `fmt.Print`, `fmt.Println`, and `print` no longer format `%` verbs**: They now join their arguments like Go instead of treating the first argument as a format string; use `fmt.Printf` or `fmt.Sprintf` when you need format verbs.
- **Go-compliant `defer`, `recover`, and nil interface calls**: `recover()` now catches a panic only when called directly inside a deferred function, `defer` evaluates its arguments when the statement runs, and calling a method on a nil interface panics on both backends.

### Fixed
- **JS↔WASM boundary calls and loader URLs**: Methods on exported `wasm` types now accept and return `int` values from JavaScript without `BigInt` errors, and `app.wasm` is loaded relative to `app.js` so subpath and CDN deployments work.
- **`strconv`, `strings`, `utf8`, and `math.Round` parity**: `strconv` parse functions return Go-style `error` values on both backends, `strings.Split(s, "")` splits on Unicode code points in `wasm`, and `math.Round` rounds half away from zero in `wasm`.
- **WebAssembly structs, maps, and generics**: Package-level structs with string, interface, or nested struct fields initialize cleanly in `wasm`, struct and float map keys compare by value, and generic struct literals work inside generic functions.
- **`gofront dev` default output**: Running `gofront dev` without `-o` now writes the configured development bundle instead of serving stale output.

## [1.5.1] - 2026-10-06

### Added
- **Experimental WebAssembly (WasmGC) backend and hybrid builds**: Packages can target `js`, `wasm`, or `both`, and `gofront build` / `dev` links all `wasm` and `both` packages into a single `app.wasm` with a generated JavaScript facade (`--emit-wat` also writes `app.wat`). `gofront test` runs `wasm` tests inside WebAssembly and runs `both` packages against both backends.
- **Strict Go numeric semantics in `both` packages**: Sized integers and `float32` wrap and truncate with Go semantics, integer division by zero panics, and large shifts return 0 so code behaves identically in JS and WebAssembly.

### Changed
- **`cap(nil)` returns `0`**: Calling `cap` on a `nil` slice now returns `0` instead of throwing a runtime error, matching `len`.

### Fixed
- **WebAssembly struct types, float literals, and `BigInt` minification**: Structs with slice, array, or closure fields and integer literals used in float expressions now emit valid WebAssembly modules, and the minifier preserves `BigInt` literals (`123n`).

## [1.4.0] - 2026-10-02

### Added
- **Scoped `css` blocks in `.templ` files**: `css Name() { ... }` declarations generate scoped class names and inject their stylesheet into `<head>` automatically, supporting nested selectors, media queries, and keyframes.
- **Template-only local packages**: Local packages that contain only `.templ` files are now discovered and bundled, and imports used only inside templates are recognized as used.

## [1.3.12] - 2026-10-02

### Added
- **Element `ref` attributes in `.templ` templates**: Adding `ref="name"` to an element captures the live DOM node into the optional `refs` map passed to `gom.Mount` or `gom.MountTo`, without querying the DOM by selector.
- **Multi-package source maps**: Source maps now map line numbers and embed source text across all bundled local packages, not only the entry package.

## [1.3.11] - 2026-10-01

### Added
- **Colored CLI diagnostics**: Terminal output for `check`, `build`, `dev`, `prep`, and `test` now highlights pass/fail status and points to error columns with a caret when writing to a terminal, respecting `NO_COLOR` and `FORCE_COLOR`.

### Fixed
- **Untyped constants and interface-to-interface assignments**: String and numeric literals can now be assigned to named basic types (`type Mode string`), and an interface value can be assigned to any narrower interface whose methods it implements.

## [1.3.10] - 2026-10-01

### Added
- **Custom static asset extensions (`assetExtensions`)**: Configure `"assetExtensions": [".bmesh", ".mat"]` in `gofront.json` so `gofront build` and PWA precaching include project-specific binary or data files from `serveDir`.

### Changed
- **Breaking: `vendor` and `assetCopy` must live under `"gofront"`**: Top-level `"vendor"` and `"assetCopy"` keys in `package.json` are no longer read; move them into `gofront.json` or the `"gofront"` block in `package.json`.

### Fixed
- **Minifier `--mangle` with global variables**: Mangling no longer mistakes function call arguments for parameter declarations or renames free globals used inside functions.

## [1.3.9] - 2026-10-01

### Fixed
- **Minifier division after `)` or `]`**: Division following a closing parenthesis or bracket (such as `(x * Math.PI) / 180`) is no longer misread as the start of a regular expression, so the rest of the bundle is minified properly.
- **Inline `<svg>` in `.templ` templates**: `<svg>` elements and their children are now created in the SVG namespace so they render in the browser and accept `class` attributes.

## [1.3.8] - 2026-10-01

### Added
- **Recursive `./...` package patterns**: `gofront check ./...` and `gofront test ./...` (or `<dir>/...`) now check or test every GoFront package under the target directory in one command.

### Fixed
- **Cross-package structs, pointers, and diamond imports**: Shared local packages in diamond import graphs are bundled only once, pointer types `*T` satisfy interfaces implemented by `T`, and qualified types (`pkg.T{}`, `[]pkg.T{...}`) resolve and initialize properly.
- **`sort.Slice`, `math.Round`, and `rand.Float32`**: `sort.Slice` and `sort.SliceStable` now pass `(i, j)` indices to the comparator instead of elements, `math.Round` rounds half away from zero, and `rand.Float32()` has type `float32`.
- **Indexing with qualified names and repeated blank assignments**: Indexing a slice or map with `pkg.Const` or `obj.Field` is no longer misparsed as a generic type argument, `_, x = f()` can be used multiple times in one scope, and `f().(T)` evaluates `f()` only once.

## [1.3.7] - 2026-09-30

### Fixed
- **Pointer receivers and imported struct fields**: Method receivers declared as `(n *Node)` now have pointer type `*Node` inside the method body, and omitted struct fields whose type comes from another local package are zero-initialized instead of left `null`.

## [1.3.6] - 2026-09-29

### Changed
- **Go value semantics for structs, arrays, runes, and sized integers**: Assigning or passing a struct or array now copies it, `rune` aliases `int32`, and conversions to `int8`/`uint8`/`int16`/`uint16`/`int32`/`uint32` wrap to the target bit width. `[]float64` is a plain JavaScript array again so it works with standard Web APIs, while other sized numeric slices stay TypedArrays.
- **WebGL, WebGPU, and DOM method calls**: PascalCase calls on browser graphics and DOM types (`gl.BindBuffer`, `gl.Uniform1F`) automatically compile to their camelCase JavaScript methods, and optional trailing arguments may be omitted.
- **Safer `gofront dev` and `gofront build` defaults**: `gofront dev` binds to `localhost` by default and prints startup compile errors in the terminal, `gofront build` copies static assets from `serveDir` into the output directory, and `gofront init` adds `gofront` to `devDependencies`.

### Fixed
- **Operator precedence, reserved words, and `range` loops**: Bitwise and shift expressions parenthesize with Go precedence in generated JavaScript, Go identifiers that are reserved words in JavaScript (`in`, `class`, `delete`) compile cleanly, and `for i, v = range s` preserves the final iteration values.
- **TypedArray `len`/`append`, rune conversions, and type aliases**: `len()` and `append()` work on `nil` and populated TypedArrays, `[]rune(s)` decodes Unicode code points instead of `NaN`, forward-referenced type aliases resolve regardless of declaration order, and `fmt.Fprint*` evaluates its writer argument once.
- **Build output cleaning, dev error overlay, and PWA offline fallback**: `gofront build` refuses to clean outside the project directory, reconnecting browsers immediately see active compile errors, and the `--pwa` service worker serves cached `index.html` when offline.

## [1.3.5] - 2026-09-29

### Fixed
- **Multi-file type resolution, named function types, and package constants**: Types and constants referenced across files in the same package now resolve regardless of filename order, and function literals can be assigned directly to named function types.

## [1.3.4] - 2026-09-29

### Fixed
- **Unary operator precedence**: Negated binary expressions such as `-(a + b)` keep their grouping parentheses in generated JavaScript instead of evaluating as `-a + b`.

## [1.3.3] - 2026-09-29

### Fixed
- **Binary operator precedence**: Parenthesized sub-expressions such as `2 * (3 + 4)` keep their grouping parentheses in generated JavaScript.

## [1.3.2] - 2026-09-29

### Added
- **Static asset live reload in `gofront dev`**: Editing `.css` or `.html` files in `serveDir` now hot-reloads styles or refreshes the page automatically.

### Fixed
- **Multi-file `main` packages and `gofront test` defaults**: `gofront check` and builds now include sibling `.go` files alongside `main.go`, and running `gofront test` with no arguments automatically uses the configured `src` directory.

## [1.3.1] - 2026-09-29

### Fixed
- **`gofront dev` startup**: `gofront dev` now stays running to serve and watch your project instead of exiting after initial startup.

## [1.3.0] - 2026-09-29

### Added
- **`gofront init`, `gofront dev`, and `gofront build` (`--pwa`)**: New CLI subcommands scaffold a project, run a live-reloading dev server with an in-browser error overlay, and build production bundles with optional offline PWA service-worker generation (`--pwa`).
- **WebGL2 and WebGPU typings and zero-copy TypedArray slicing**: Built-in browser typings now cover `WebGLRenderingContext`, `WebGL2RenderingContext`, `GPUDevice`, `ArrayBuffer`, `DataView`, and TypedArrays, and sub-slicing a TypedArray (`s[lo:hi]`) uses `.subarray` for zero-copy views.
- **Zero-allocation `for range` loops and struct pointers**: Ranging over slices and arrays and taking pointers to structs no longer allocate per-iteration tuples or wrapper objects.

### Changed
- **Breaking: sized numeric slices compile to JavaScript TypedArrays**: Slices of `float32`, `int8`, `int16`, `int32`, `uint8`/`byte`, `uint16`, and `uint32` now compile to their matching JavaScript TypedArrays (`Float32Array`, `Uint8Array`, and so on) instead of plain arrays; convert them if you pass them to JavaScript APIs that require `Array`.

## [1.2.3] - 2026-09-24

### Fixed
- **Minifier string preservation**: Constant folding during `--minify` no longer alters hyphenated numbers inside string literals such as SVG path data.

## [1.2.2] - 2026-09-24

### Fixed
- **Minifier identifier mangling, struct field names, and single-variable map `range`**: `--mangle` no longer collides with existing top-level names, struct fields named after their own type no longer crash at startup, and `for k := range m` yields keys instead of `[key, value]` pairs.

## [1.2.1] - 2026-09-23

### Changed
- **Breaking: custom vendor globals use `vendor.globals`**: Package-specific `window` aliases are no longer hardcoded; configure custom global names in `"vendor": { "globals": { "fuse.js": ["Fuse"] } }`.

### Fixed
- **Dev server path containment, `--dom` test lookup, and `*_test.go` discovery**: The dev server blocks sibling-prefix path traversal, `gofront test --dom` finds `jsdom` when GoFront is installed globally or run via `npx`, and `gofront test` only runs `Test*` functions from `*_test.go` files.

## [1.2.0] - 2026-09-23

### Added
- **Built-in test runner (`gofront test`)**: Run unit and DOM tests in `*_test.go` files with the standard `testing` package (`testing.T`, subtests, `-v`, `-run`, and `--dom`), while excluding test files from normal builds.
- **Vendor bundle minification and multiple outputs (`gofront prep --minify`)**: `gofront prep` now supports `--minify` and accepts an array of output paths in `vendor.dest`.

### Changed
- **`nil` comparisons match `undefined`**: Comparing against `nil` (`x == nil`, `x != nil`) now treats JavaScript `undefined` as `nil` so missing JS properties and unset fields behave as expected.

### Fixed
- **Cross-file package variable types**: Functions that reference a package-level `var` or `const` declared in another file now see its inferred type instead of `any`.

## [1.1.0] - 2026-09-22

### Added
- **Vendor bundling (`gofront prep`) and static asset copying (`--copy-assets`)**: Bundle npm dependencies for the browser using your project's `rolldown` or `esbuild` install and copy static files configured in `assetCopy`.
- **SPA route fallback in `--serve`**: Extensionless URLs such as `/blog` now fall back to `index.html` so client-side routers work on page reload during development.

## [1.0.1] - 2026-05-04

### Changed
- **Fewer cascading type errors**: An undefined variable or type error no longer triggers a flood of follow-on type errors on every expression that uses that variable.

### Fixed
- **Union type constraints on named interfaces**: Generic functions constrained by a union interface such as `type Pet interface { Cat | Dog }` now reject type arguments that do not match the union.

## [1.0.0] - 2026-04-30

### Changed
- **Fault-tolerant `.d.ts` parsing**: An unsupported declaration in a TypeScript `.d.ts` file now logs a warning and is skipped instead of aborting compilation of the rest of the file.

### Fixed
- **Multi-argument `fmt.Fprintln`/`fmt.Fprint`, generic type arguments, and complex assignments**: `fmt.Fprintln` and `fmt.Fprint` now write all arguments instead of only the first, user-defined types work as explicit type arguments in function calls (`Identity[MyType](x)`), and unsupported compound operators on complex numbers are rejected instead of silently dropping the operator.

## [0.0.9] - 2026-04-24

### Added
- **`else if`, `switch`, and `@templ.Raw` in `.templ` files**: Templates now support `else if` chains, `switch` statements, and raw HTML injection with `@templ.Raw(html)`.
- **Column carets in type errors and faster `--watch` rebuilds**: Type errors now show the exact column and source line, and watch mode caches unchanged files so rebuilds only re-parse edited files.

### Fixed
- **Void HTML elements and `switch` text in `.templ` files**: Void tags (`<br>`, `<img>`, `<input>`) no longer require a trailing `/`, and text inside `switch` cases no longer swallows the next `case` or `default` branch.

## [0.0.8] - 2026-04-22

### Added
- **Expanded standard library (`math/rand`, `unicode/utf8`, `path`, `time`, `io`, `fmt`)**: Added `math/rand`, `unicode/utf8`, `path` (`path/filepath`), `io.Reader` helpers, `fmt.Sscan*`, `time.Time` formatting and parsing, and additional functions across `math`, `sort`, `strings`, `bytes`, and `strconv`.

### Changed
- **Breaking: `time.Now()` returns a `time.Time` value**: `time.Now()` no longer returns a raw millisecond number; call `.UnixMilli()` or `.Unix()` when you need a numeric timestamp.

### Fixed
- **`time.Format` token replacement and stdlib import warnings**: Formatting dates can no longer corrupt values that happen to match another layout token, and importing built-in stdlib packages no longer prints a missing-types warning.

## [0.0.7] - 2026-04-22

### Added
- **Built-in `gom` DOM builder and `io.Writer` support**: `gom.*` is now built into the compiler with HTML element and attribute helpers (`gom.Div`, `gom.El`, `gom.If`, `gom.Map`, `gom.Mount`), and `io.Writer` / `io.WriteString` work with `strings.Builder` and `bytes.Buffer`.
- **Methods on named non-struct types and cross-package type names**: You can now declare methods on named function and slice types (`type Handler func()`), and reference exported types from other packages as `pkg.Type`.

## [0.0.6] - 2026-04-20

### Added
- **`html`, `maps`, `slices`, `regexp`, `strings.Builder`, and `bytes.Buffer`**: Added Go's `maps`, `slices`, `regexp`, and `html` packages, `strings.Builder`, `bytes.Buffer`, and `fmt.Fprint*`.
- **Live-reloading dev server (`--serve`)**: Passing `--serve` (and optional `--port`) starts a local static server that reloads the browser whenever watch mode finishes a build.

### Fixed
- **Directory source maps and shared runtime helpers**: `--source-map` now works for multi-file directory builds with per-file mappings in browser DevTools, and bundling sub-packages no longer duplicates runtime helpers.

## [0.0.5] - 2026-04-17

### Added
- **Generics, complex numbers, iterator functions, and `bytes`**: Added generic functions and structs with type inference and union constraints, `complex64`/`complex128` arithmetic, Go 1.23 `for range` over iterator functions, slice-to-array conversions (`[N]T(s)`), fixed-size array bounds checking, and the `bytes` package.
- **Value pointers (`&x`, `*p`) and built-in minifier (`--minify`, `--mangle`)**: Taking the address of a local variable now allows mutating it through the pointer, and `--minify` uses a built-in zero-dependency minifier with optional identifier mangling (`--mangle`).

### Changed
- **Breaking: `error` is now an interface with `.Error()`**: `errors.New` and `fmt.Errorf` (including `%w` wrapping, `errors.Is`, and `errors.Unwrap`) return objects implementing `error` instead of plain strings, and custom structs with `Error() string` satisfy `error`; replace `err == "msg"` with `err.Error() == "msg"` or `errors.Is`.

## [0.0.4] - 2026-04-17

### Added
- **Method values, method expressions, and struct/array `==`**: Methods can be passed as values (`p.Dist`) or called as expressions (`Point.Dist(p)`), structs and arrays compare by value with `==` and `!=`, multi-return calls forward directly into `f(g())`, and `unicode` and basic `os` helpers are available.
- **Stricter Go checks**: Missing return statements, accessing unexported `pkg.name` symbols across packages, and comparing two slices or maps are now compile errors, `iota` expressions repeat across `const` blocks, and indexing a string (`s[i]`) returns a byte code.

### Fixed
- **Assignments, positional struct literals, `interface{}`, and string `range`**: Blank assignments (`_ = f()`), comma-ok assignments with `=`, positional struct literals (`Point{1, 2}`), and `interface{}` variables now work as in Go, and `for i, r := range s` yields integer rune code points.

## [0.0.3] - 2026-04-16

### Added
- **Core standard library (`strings`, `strconv`, `sort`, `math`, `errors`, `time`) and richer `fmt` verbs**: Added built-in support for common Go standard library packages and width, precision, hex, octal, binary, and scientific `fmt.Sprintf` verbs.
- **Untyped constants, anonymous structs, dot imports, and Go numeric literals**: Added Go untyped constant rules, inline `struct { ... }` types, grouped `type (...)` blocks, `import . "pkg"`, `&^` bit-clear, and binary, octal, hex-float, and underscore-separated number literals; unused local variables and imports are now reported as errors.

### Changed
- **Breaking: type assertions check types at runtime**: `x.(T)` now requires an interface or `any` operand and panics when the dynamic type does not match, and `v, ok := x.(T)` returns the zero value of `T` on failure instead of `x`.

### Fixed
- **Nested `defer`, integer division on named types, and map key evaluation**: `defer` inside nested `if` or `for` blocks inside a `switch` now runs on return, integer division on named integer types truncates toward zero, and indexing a map with a function call (`m[getKey()]`) evaluates the call only once.

## [0.0.2] - 2026-04-14

### Added
- **Type switches, interface embedding, rune literals, and Go 1.22 loop features**: Added `switch x.(type)`, embedded interfaces, rune literals (`'a'`), `[]byte(s)` and `[]rune(s)` conversions, `[...]T` array length inference, `for i := range n`, `min`/`max`/`clear`, labeled `break`/`continue`, bitwise compound assignments, type aliases, sized integer types, struct tags, and import aliases.

### Fixed
- **`new(T)` on basic types, `[]int` conversions, and anonymous IIFEs**: `new(int)` and `new(string)` no longer fail type checking, converting a numeric slice with `[]int(s)` no longer treats elements as strings, and immediately invoked `func(){}()()` literals emit valid JavaScript.

## [0.0.1] - 2026-04-12

### Added
- **Initial release**: Compiles Go-inspired `.go` packages to JavaScript ES modules with structs, interfaces, methods, closures, multiple returns, `defer`/`panic`/`recover`, `async`/`await`, `.d.ts` TypeScript interop, source maps, watch mode, and `gofront init`.

<!-- How to write entries:
- Write for someone upgrading, not for the reviewer reading the diff.
- At most two plain sentences per entry: what is different for them and why it matters.
- Name only the APIs or flags the reader needs to act on; link to docs for full lists.
- Never task, phase, or follow-up IDs, file paths, test fixture names, or internal identifiers.
- One entry per feature or plan: rewrite it as later work lands instead of appending.
- Breaking changes go under Changed, start with **Breaking:**, and say what to do.

  Good: Collision checks are about twice as fast on large maps.
  Bad:  Add 4-wide SIMD triangle-packet kernel in `collision/packet.go` behind `useSIMD` gate (Task 2.3).
-->
