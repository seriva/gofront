# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added
- **Signals for `gom` and `.templ`**: `gom.NewSignal`, `gom.NewComputed` and `gom.Effect` hold values that notify what depends on them, and `.templ` text and attributes bound to a signal (`{ count.Get() }`, `{ count }`, `class={ cls }`, `disabled?={ busy }`) update in place when it changes, without re-rendering the page ([details](docs/compilation-mapping.md#signals-in-templ)).

- **`//go:embed` for `string`, `[]byte` and `embed.FS`**: a package-level variable under `//go:embed` (with `import _ "embed"`, or `import "embed"` for `embed.FS`) holds the matched files, from single files, globs and directories, on JavaScript and WebAssembly alike, so shaders, templates and data load with no network request. An `embed.FS` reads them with `ReadFile`; `ReadDir` and `Open` are not available ([details](docs/go-compatibility.md#embedding-files-with-goembed)).

- **Faster `gofront dev` rebuilds**: after a save, `gofront dev` re-checks only the edited package and the packages that import something it changed, and `dev` now also rebuilds when an embedded file or a `.d.ts` file changes ([details](docs/usage.md#the-dev-loop)).

- **Typed DOM, Canvas, Fetch, WebSocket and WebGPU**: `import "gofront/dom"` (and `gofront/canvas`, `gofront/fetch`, `gofront/websocket`, `gofront/webgpu`) type-checks elements, events, drawing calls, responses, sockets and GPU objects against the browser's own API, so a misspelled member is a compile error, and `x.(webgpu.Device)` accepts a standard browser device. The packages are for `js` packages only and add nothing to the emitted code.

### Changed
- **Breaking:** `document`, `window`, `fetch`, `console`, `localStorage` and the other browser globals are typed, so a misspelled member is a compile error and reading a property that only a specific element type has (`document.querySelector(".todo-input").value`) needs a type assertion first. Assert the element type (`.(dom.HTMLInputElement)`) and convert numbers (`float64(e.clientX)`, `int(delay)` for a timer) where the compiler points; `Math`, `JSON` and the other ECMAScript built-ins stay dynamic ([migration guide](docs/usage.md#typed-browser-globals)).
- **Breaking:** Like Go, numeric types no longer mix implicitly: `int + float64`, `float64 == int`, `%` or `&` on floats, and passing an `int` as a `float64` argument or assigning it to a `float64` variable are compile errors. Convert where the error points, for example `float64(n)`; these programs used to print wrong values or build a WebAssembly module the browser refused to load ([rules](docs/go-compatibility.md#numeric-operands-need-identical-types)).
- **Breaking:** Like Go, different anonymous struct types, different anonymous interface types, and a local type that shadows an outer type of the same name are no longer assignable to each other. Make the two types identical or convert the value explicitly ([rules](docs/go-compatibility.md#type-identity)).
- **Breaking:** Like Go, a Go `any` value no longer supports arithmetic, `++`, calls, indexing, slicing, `range`, use as a condition, or as an argument to `len`, `append`, `copy`, `min` and similar builtins. Assert its type first (`v.(int) * 2`); ECMAScript built-ins and `.d.ts` values stay dynamic ([rules](docs/go-compatibility.md#go-any-versus-javascript-values)).
- **Breaking:** Like Go, `nil` can no longer be assigned to a number, string, bool or array, and a function can no longer return more values than it declares. Use the zero value, or fix the return statement where the compiler reports it ([rules](docs/go-compatibility.md#nil)).
- **Breaking:** Like Go, `range` over a float (including constants such as `1e3`), bool, struct, interface or `any`, and two iteration variables over an integer, are compile errors. Range over an integer, string, slice, array, map or iterator function, with at most one variable for an integer ([rules](docs/go-compatibility.md#statements-and-assignments)).
- **Breaking:** Like Go, assigning to, taking the address of, or calling a pointer method on something that is not addressable (a string element, a map entry's field, a call result, a constant, an imported package's function) is a compile error. Assign the whole map entry, convert the string to `[]byte`, or store the value in a variable first ([rules](docs/go-compatibility.md#statements-and-assignments)).
- **Breaking:** Like Go, `break` or `continue` with an undefined label, a label that nothing uses, a repeated label, and a statement that computes a value and discards it (`x + 1`, `x == 2`, a function name, `len(s)`) are compile errors. Remove the label or statement, or use the result ([rules](docs/go-compatibility.md#statements-and-assignments)).
- **Breaking:** Like Go, a positional struct literal that omits fields, duplicate integer, float or string `case` constants in a `switch`, and duplicate keys in a map literal are compile errors. List every field or use keyed fields, and remove the duplicate ([rules](docs/go-compatibility.md#literals-and-duplicates)).
- **Breaking:** Like Go, a type assertion or type switch case to a concrete type that can never match the interface (`i.(S)` when `S` lacks a method of `I`) is a compile error. Add the missing method, or assert to a different type ([rules](docs/go-compatibility.md#type-assertions)).
- **Breaking:** Like Go, a generic function used as a value must be instantiated: `f := Id` and `fmt.Println(slices.Reverse)` are compile errors. Write `Id[int]` instead ([rules](docs/go-compatibility.md#generic-functions-as-values)).
- **Breaking:** Like Go, comparing or combining a value with a constant or `nil` of the wrong kind (`s == 'a'`, `n == nil`), untyped `nil` (`x := nil`), and invalid compound or `++`/`--` operations (`f <<= 1`, `s++`) are compile errors instead of miscompiling or failing on WebAssembly. A pointer to a defined empty interface is no longer assignable to `*any`, and a Go `any` is not a `templ` condition; fix each reported line as Go would ([rules](docs/go-compatibility.md#nil)).
- **Breaking:** Like Go, a generic function body is checked against its constraint where it is defined, even if never called: `a % b` with `T ~int | ~float64`, `a + b` with `T any`, or `len(v)` with `T any` are compile errors. Narrow the constraint (for example to `cmp.Ordered`) or convert the operand to `T` ([rules](docs/go-compatibility.md#generic-function-bodies)).
- **Breaking:** Like Go, a type-parameter value converts or assigns only as its type set allows (`var t T = n`, `string(t)` with `T any`), `range` and field access work only through a core type, and a constraint with several union elements or embedded constraints intersects them. Convert through `any(t)`, constrain `T` further, or fix the type argument the compiler points at ([rules](docs/go-compatibility.md#constraints)).
- **Breaking:** Like Go, a builtin called with the wrong number of arguments (`len()`, `delete(m)`) and `min` or `max` over arguments that do not unify (`min(1, "a")`, an `int` with a `float64`) are compile errors instead of crashing the compiler or producing a rejected WebAssembly module. Pass the right arguments or convert one operand ([rules](docs/go-compatibility.md#builtin-argument-counts)).
- **Breaking:** Like Go, a type declared inside a function or block is visible only there, and a type, builtin or package name used as a value (`_ = len`, `fmt.Println(int)`) or a composite literal of a basic type (`int{}`) is a compile error. Declare the type at package level if other functions need it, and call or convert with the name instead ([rules](docs/go-compatibility.md#names-used-as-values)).
- **Breaking:** Like Go, `switch x := v.(type)` is rejected when no clause uses `x`, and `switch _ := v.(type)` has no new variable. Use `x` in a clause or write `switch v.(type)`.
- **Breaking:** Like Go, ordering (`<`) on booleans, pointers, structs or interfaces, `&&`, `||` and `!` on non-booleans, `^` on a non-integer, unary `-` or `+` on a non-number, and comparing an interface with a value that does not implement it are compile errors. Use operands the operator accepts, as in Go ([rules](docs/go-compatibility.md#operators-and-comparisons)).
- **Breaking:** Like Go, shifting a float, string or complex value (including `var f float64 = 1 << s`) and a constant too large for its type (`var f float32 = 1e40`, `for range 1 << 63`) are compile errors. Convert the operand to an integer first, or use a type that can hold the constant ([rules](docs/go-compatibility.md#operators-and-comparisons)).
- **Breaking:** Like Go, assigning between pointer, array, slice, map or function types whose elements differ (`*int` to `*any`, `[]int` to `[]any`) and invalid conversions (`[]MyInt(ints)`, `string(f)` of a float, `bool(n)`, `int(1.5)`, `[]int(array)`) are compile errors. Convert element by element, or use matching types ([rules](docs/go-compatibility.md#operators-and-comparisons)).
- **Breaking:** Like Go, methods on an interface, pointer, predeclared or imported type, a `switch` or `case` whose values cannot be compared, and a map key or `==` operand that holds a slice, map or func (`map[[]int]int`, a struct with a slice field) are compile errors. Declare methods on your own defined type, and compare or key by a comparable value such as a string or an index ([rules](docs/go-compatibility.md#operators-and-comparisons)).
- **Breaking:** Like Go, passing `xs...` to a function that is not variadic, to a builtin other than `append`, or to a type conversion, and passing extra arguments next to a spread (`f(1, 2, xs...)`), are compile errors. Pass the slice itself, or drop the `...` ([rules](docs/go-compatibility.md#builtin-operands)).
- **Breaking:** Like Go, a method or promoted method selected through a defined pointer type (`type P *S`, then `p.Method()`), a field that does not exist, and a field selected on an unnamed pointer to a non-struct (`var p *int; p.Y`) are compile errors. Call the method through the base type (`(*p).Method()`), or fix the field name.
- **Breaking:** Like Go, an import now applies only to the file that declares it, a package exports only the names it declares (never what it imports), an unused import of an npm package is an error, and a type from an npm package named in a WebAssembly package reports a clear error. Add the import to each file that uses the package, remove the ones a file does not use, and import a dependency's package directly rather than through another package.
- **Breaking:** Like Go, a package can no longer use another package's unexported names, types, fields or methods, including positional struct literals that set them and names bound by a dot import, on every target (`util.secret()`, `v.count`, `util.Rec{1, 2}`). Export the name by capitalizing it, or move the code into the package that owns it ([rules](docs/usage.md#visibility-between-packages)); the examples and standard library needed no changes.
- **Compiler errors point at the offending expression**: errors on operators, calls, field selections, indexing, literals and type assertions report a line and column, and `declared and not used` points at the variable. A failure inside the compiler, or a WebAssembly module that would be invalid, stops the build with an `internal compiler error` that links to the issue tracker instead of writing a broken `app.wasm` ([details](docs/go-compatibility.md#internal-compiler-errors)).
- Compile errors now describe your code in Go's words: operands appear as written (`[2]int{…}[0]`), constants show their value (`constant 2 of type float64`), types are spelled out (`struct{X int}`), a value that cannot be assigned reads `cannot use b (variable of type []string) as []int value in argument to append` instead of `Cannot assign []string to []int`, and an operator on an `any` value reads `invalid operation: v * 2 (mismatched types any and untyped int)`. Messages match Go's documentation, so they are easier to search for.
- **Smaller JavaScript bundles**: functions, types, constants, variables and methods that your program never uses are left out of the JavaScript output, and each runtime helper is defined once per bundle, so a `fmt` hello world is about a third smaller. A package without `main` keeps its exported declarations, and code that only a script outside the bundle calls by name is no longer included.
- **Breaking:** The built-in `GPUDevice`, `GPUQueue` and `GPUAdapter` types are removed, along with their PascalCase methods (`CreateBuffer`). Import `gofront/webgpu` and use `webgpu.Device`, `webgpu.Queue` and `webgpu.Adapter` with the standard member names (`createBuffer`).
- **Breaking:** Browser and WebGPU parameters and descriptor members that take a list now need a slice of their element type, so write `queue.submit([]webgpu.CommandBuffer{cmd})` and `"targets": []webgpu.ColorTargetState{map[string]any{...}}` instead of `[]any{...}`. Indexing, calling, ranging over, testing, or doing arithmetic on a browser value (`el[0]`, `for range el`, `if el`, `window + 1`) is now a compile error, so use `== nil`, a type assertion or its API.
- **Breaking:** A browser or `.d.ts` type is no longer a value: `fetch.Response{}`, `fetch.Response.clone`, `(*MyEl).id` and a type defined from one are compile errors, and an options object such as `RequestInit{...}` or `webgpu.BufferDescriptor{...}` is now written `map[string]any{...}`. As in Go, an elided `{}` is rejected in a struct field and where its type cannot be a composite literal (a basic, browser, func or interface element, or a pointer to a pointer), and the fields and elements of one under a pointer or type parameter (`[]*T{{a: "x"}}`) are checked like any other literal's, so write `S{t: T{a: 1}}`.

### Fixed
- **WebAssembly package variables, `new` of a func type, defined complex types and local types in generic functions**: package-level `any`, float and complex variables with literal initializers (`var a any = 1`, `var f float64 = 1`, `var c complex128 = 1`), `new(F)` for a defined func type, pointers to, arrays of and `any` values holding a defined complex type (`type C complex128`), and a type declared inside a generic function that is called with more than one type argument now build and give Go's output instead of failing with an invalid-module error.
- **Typed browser slices, type names and stored functions**: slices of browser and WebGPU values such as `[]webgpu.CommandBuffer` and `[]dom.Node` now type-check, `fmt.Sprintf("%T", el)` and failed type assertions print the real type name (`dom.Element`, `[]dom.Node`) instead of an empty string or `[]interface {}`, and a browser function stored in a variable (`fn := console.log`) keeps its receiver, copies nothing and spreads `fn(xs...)`.
- **Unused imports are checked per file**: an import that is never used in its file is reported even when another file uses a browser global of the same name.
- **Converting to a type from an imported package**: `sub.MyInt(5)` now compiles instead of failing with `No member 'MyInt' in namespace sub`, and a type you dot-import in one file no longer hides your own type of the same name in another file.
- **JavaScript statements with a discarded map literal and `for range` over a string**: `_ = map[string]int{"a": 1}` no longer fails with a syntax error, and `for range s` runs once per character instead of once per UTF-16 unit.
- **WebAssembly comparisons with an interface**: `n == v` and `s != v` with an `int`, `string`, array, pointer, struct or complex value against an interface, and `switch x { case v: }` with an interface `v`, now build and give Go's result instead of an invalid module.
- **WebAssembly type switches and assertions on empty interfaces**: `case interface{}:`, a case naming a defined empty interface (`type B interface{}`), and `x.(interface{})` or `x.(B)` (single-value or comma-ok) now succeed for any non-nil value instead of never matching.
- **Defined pointer types work**: `type P *int`, `type PS *S` and `type PA *[3]int` now build and run: `*p`, `*p = v`, `*p += v`, `*p++`, `p.X` and `p[i]` read and write through the pointer on WebAssembly and JavaScript instead of failing with an invalid module, an internal error or wrong values.
- **WebAssembly packages that name a function, variable, constant or type like a builtin**: `func append(...)`, `var copy = 1`, `const min = 2` or `type make int` in one package no longer break generic or helper code in another linked package, which now keeps calling the real builtin.
- **Complex constants, interface comparisons and tagless `switch` follow Go**: `var n int = 1 + 0i` and `real(c)` of a constant as an array length compile, `switch { case v: }` with an interface `v` holding a bool works, and comparing an interface with a struct or array value is `true` when type and value match. `c++` and `c--` on a complex number also work for variables, fields, map elements and `for` loops on every target.
- **Multi-value calls as builtin arguments:** `min(f())`, `max(f())`, `append(f())` and similar accept a call returning several values, as in Go.
- **Partly instantiated generic functions work as values**: `f := slices.Sort[[]int]` and user generics whose remaining type parameters follow from their constraints now compile and run.
- **`gofront check` reports every package and its test files**: `gofront check <dir>/...` now lists the errors of all failing packages in one run, covers `_test.go` files, marks dependents of a failed package as skipped, and exits 1 when anything failed ([details](docs/usage.md#checking-packages)).
- **Predeclared names can be shadowed like in Go**: your own `func len`, a local `max := 3`, `type error int` or a type named like an import now behave as written instead of crashing the compiler or calling the built-in ([details](docs/go-compatibility.md#names-that-shadow-predeclared-types)).
- **Valid Go type rules the compiler used to reject now compile**: a defined struct type and an unnamed struct with the same fields assign to each other, and a type declared over another defined type (`type Temp Celsius`) takes constants, operators and conversions like its underlying type ([rules](docs/go-compatibility.md#type-identity)).
- **Assignments keep Go's value semantics in more places**: a struct or array reassigned inside a closure stays visible through earlier pointers, `p, *p = &b, x` stores through the old pointer, and comma-ok lookups and type assertions into a `*p` of a concrete type no longer crash in JavaScript. Arrays yielded by a range-over-func loop are copies, a call in a comma-ok `:=` map lookup or on the right side of a complex compound assignment now runs once, and storing a struct variable through a pointer on WebAssembly copies its array and struct fields.
- **Valid Go no longer breaks or misbehaves in the generated JavaScript**: functions, variables, local types and `templ` or `css` components named after JavaScript built-ins (`Map`, `BigInt`, `NaN`), and names starting with `__`, now work; a call in a divisor, shift count or multiple assignment runs once and in Go's order; and anonymous structs copy their array and struct fields and work in literals that omit the type. `recover()` on WebAssembly now returns the panic value with its type and slice-bounds panics report the bounds as Go does; hand-written JavaScript reaches a renamed function through a `$`-suffixed name such as `Map$` ([details](docs/go-compatibility.md#names-that-shadow-js-globals)).
- **More valid Go compiles and runs correctly**: aliases and conversions of anonymous structs, generic types over different anonymous structs, local types and variables that share a name with package-level ones or their own type, and `range` over a defined string type in JavaScript now work, and evaluation order in comma-ok, multiple and `x += f()` assignments follows Go. Imports of npm packages without type declarations also compile, with the existing missing-types warning; WebAssembly packages reject using them ([details](docs/usage.md#vendoring-npm-packages)).
- **`iota` works in a single `const` declaration**: `const A = iota` outside parentheses is `0`, as in Go.
- **Anonymous structs work in more WebAssembly programs**: structs with embedded fields, anonymous structs as map keys and as type arguments of generic functions, and conversions between named and anonymous struct types now read the right fields and find their map entries instead of returning wrong values or stopping the build with an `internal compiler error`. Generic functions that use `(*T)(nil)` and method expressions called with a `nil` receiver (`(*U).IsNil(nil)`) also compile, and `%T` of a generic type instantiated with an anonymous struct prints Go's `struct { ... }` spelling.
- **Types named after JavaScript built-ins and reserved words, type expressions, and WebAssembly integer bounds and panics now work**: a type called `Map`, `Symbol` or `WeakMap` and a WebAssembly struct called `let` or `yield` run as written (hand-written JavaScript sees a `$$` suffix such as `Map$$main`, [details](docs/go-compatibility.md#names-that-shadow-js-globals)), and conversions through type aliases, struct tags in type arguments, parenthesised type literals, and calls to functions or variables named after predeclared types (`func bool()`, `int := ...`) work. On WebAssembly, slice bounds, `make` sizes and integer `range` counts of 2³² or more are no longer truncated, and panics show Go's message for `panic(nil)`, unsigned indexes and `bool`, unsigned, complex, `error`, `Stringer` and defined-type values, also when the value is held in an interface.
- **Assignment targets are evaluated once, in Go's order, and stored in place**: `p.F, *p.F = &b, 99` stores through the old pointer, complex compound assignments (`m[k()] += z`, `c += f()`) evaluate each operand once, and `for x = range seq`, comma-ok lookups, type assertions and multi-value calls update a variable whose address was taken, a slice-viewed array, a `*p` or a generic `*T` in place on JavaScript and WebAssembly, also in `for` initializers and post statements. On WebAssembly, a struct stored into a captured variable, a composite literal field, or a range or comma-ok target is now a copy, so it no longer shares arrays or embedded structs with its source. `(*p).Inc()` and `&(*p)` on a named number, slice or string type now act on the value `p` points to.
- **Import cycles are compile errors**: a local package that imports itself, directly or through other packages, now reports `import cycle not allowed` with the packages involved and the import that starts the cycle, in `check`, `build`, `dev` and `test`, instead of crashing the compiler.
- **Methods on a defined type held in a generic struct**: calling or taking a method of a non-struct defined type stored in a field of a generic struct (`h.c.Double()` with `Counter int` in `Holder[T]`) no longer fails at run time with "is not a function".

## [1.9.2] - 2026-11-13

### Fixed
- **Minified builds that import the standard library work again**: `gofront build` and `--minify` no longer emit a bundle with a syntax error when a program imports `fmt`, `strings`, `strconv` or other standard library packages. The [usage guide](docs/usage.md#bundle-size) now lists what common imports add to a release bundle.

## [1.9.1] - 2026-11-12

### Fixed
- **Go programs behave more consistently across JavaScript and WebAssembly**: nil-pointer method calls, labeled loops, 64-bit constant arithmetic, interface type assertions and generic map formatting now match Go, and invalid switch cases and negative array lengths are rejected with Go's errors. In JavaScript output, `encoding/json` no longer fails on JavaScript-interop (`.d.ts`) types and generates leaner code, `float32` constants are rounded as in Go, and `fmt` calls in `.templ` files format by type; WebAssembly packages now accept package-level struct variables that hold SIMD vectors.
- **More valid Go compiles and behaves like Go**: conversions to interface types such as `I(v)` and `interface{ M() }(v)` and slices of funcs written directly as call arguments now compile, and `gofront dev` no longer reports a package used only in an array length as unused. Nil-pointer method calls, labeled `break` and `continue` across nested range-over-func loops, range loops that assign to address-taken variables, multi-value calls such as `return f()` into `any`, 64-bit loop updates, `complex64` constants, templ `case a, b:` lists and several map-key, `%T`, embedded-method and `encoding/json` edge cases now give Go's results on JavaScript and WebAssembly alike ([details](docs/go-compatibility.md)).
- **Constraints embedding `comparable`, embedded pointers and arrays in an `any` work as in Go**: constraints such as `interface{ ~int; comparable }` compile, a struct that embeds `*T` satisfies interfaces through `T`'s pointer methods, a `complex64` variable can be set from a named complex constant, and arrays in an `any` compare equal (and work as `map[any]` keys on WebAssembly) when their elements are equal. A `switch` on a nil map matches `case nil`, `break` and `continue` work with any of several stacked labels on a range-over-func loop, `%T` prints func types such as `[]func()` like Go, on WebAssembly a multi-value call passed to `any` parameters keeps its values' types and a nil pointer behind an interface panics with Go's nil-dereference error, and an unparenthesized composite literal in an `if`, `switch` or `for` header is reported as needing parentheses.
- **Structs that embed an interface work as in Go**: a struct that embeds an interface (`struct{ error }`) now gets its methods, and a method promoted from an embedded type wins over a same-named field embedded deeper.
- **Deferred calls accept more arguments**: `defer` now takes `nil`, untyped constants and variadic arguments, including constants for generic or defined-type parameters and spread arguments in JavaScript. A non-constant untyped argument takes the parameter's type.
- **Range assignments store the right value**: assigning a `range` or range-over-func value into an element, field, pointer or interface now works on JavaScript and WebAssembly, and an interface target keeps a named type's methods. WebAssembly builds no longer produce invalid modules for a range assignment into an `any` or a range-over-func loop nested in a `range` loop.
- **Arrays, slices and maps in an `any` keep their types**: on WebAssembly, named array and slice types and their element types survive boxing into an `any`, and `fmt` prints them, including maps and arrays of `bool` or small integers and func values. In JavaScript, generic code that boxes a slice, an array or several maps or arrays into an `any` keeps each one's own type, and a nil defined slice asserted out of an `any` stays nil.
- **Complex numbers match Go more closely**: in JavaScript, `complex64` arithmetic and typed constants keep float32 precision, `append` of untyped constants to `[]complex128` works, and comparing complex values evaluates each operand once. WebAssembly builds accept untyped constants where a complex value is stored through a pointer, switched on or passed to a deferred call.
- **Generic code and defined bools work as in Go**: `f[func(int)]()` compiles, type arguments are inferred from array parameters, `len` and `cap` of an array can size another array, and generic JavaScript code that boxes a struct value after a pointer keeps the value's own type. A comparison such as `x == 1` and `&&` or `||` of defined bool values fit a defined bool type.

### Changed
- **Breaking:** Like Go, assigning an `any` to `error`, `fmt.Stringer` or any other interface with methods now needs a type assertion. Add the assertion (`e = v.(error)`) where the compiler reports `need type assertion`.
- **Breaking:** Like Go, the compiler now rejects `case nil` in a `switch` whose tag cannot be nil, `cap` of a value that is not a slice, array or pointer to an array, and constraint interfaces such as `interface{ ~int | ~string }` or `comparable` used as ordinary types. Remove the `nil` case, use `len` or a slice for `cap`, and keep such interfaces in type-parameter constraints.
- **Breaking:** Like Go, converting an `any` to an interface with methods (`I(v)`) now needs a type assertion. Write `I(v.(I))` where the compiler reports `need type assertion`.
- **Breaking:** Like Go, a rune literal such as `'a'` now has type `rune`, and `rune` and `int` no longer convert implicitly. Convert with `int(r)` or `rune(n)` where the compiler reports `Cannot assign int32 to int`.
- **Breaking:** Like Go, the index of a `range` over a string, slice or array can only be assigned to an `int` variable. Declare such index variables as `int`.
- **Breaking:** Like Go, a method or field that two embedded fields declare at the same depth is no longer promoted: using it reports `ambiguous selector`, and the struct does not satisfy interfaces that need a method like that. Declare the member on the outer struct or select it through the embedded field you mean (`c.A.X`).
- **Breaking:** Like Go, an array length must be an integer constant, so `[1 == 1]int` or a variable length such as `[n]int` is now a compile error. Use an integer constant for the length.
- **Breaking:** Like Go, an index, slice bound or `make` size must be an integer, so a non-integer constant or a value of another type (`s["a"]`, a `float64`, a struct, pointer, slice, map, func or interface, or a type parameter such as `T any`) is now a compile error. Convert the value to an integer type (`int(f)`) or constrain the type parameter to integers (`T ~int`).
- **Breaking:** Like Go, `&&` or `||` that mixes a defined bool type with `bool` is now rejected. Convert the `bool` operand to the defined type.
- **Breaking:** Like Go, a type argument must match a `~int`-style term of its constraint, so `f("a")` for `T ~int | ~uint` is now rejected. Pass an argument whose type matches the constraint.
- **Breaking:** Like Go, a range-over-func assignment now checks the yielded type against its target, so `for s = range seq` with `s string` and `seq` yielding `int` is rejected. Declare the target with the yielded type.

## [1.9.0] - 2026-11-09

### Added
- **Standard library that matches Go**: `slices`, `sort`, `maps`, `errors`, `io`, `strings`, `bytes`, `strconv`, `time`, `sync`, `math/bits`, `math/rand` and the `encoding` and `crypto/sha256` packages now follow Go's signatures and results on every target, so sorting orders ties and `NaN` like Go, `slices` and `maps` accept named types such as `type IDs []int`, `errors.Is` walks `errors.Join` trees, and `io.Copy` and `io.ReadAll` work with `bytes.Buffer`. `time` keeps nanoseconds and parses every layout, `strconv` formats and parses floats exactly as Go does, and `encoding/binary` gains varints and `sha256` gains `Sum224` and `New224` ([details](docs/go-compatibility.md#standard-library-behaviour)).
- **Exact 64-bit integers**: `int64` and `uint64` are now exact in JavaScript output, including across the WebAssembly boundary, while `int` stays a JavaScript number that is exact up to 2⁵³. Prefer `int` in hot loops, because 64-bit arithmetic is slower in JavaScript.
- **Generic code over named slice and map types**: type parameters such as `[S ~[]E, E any]` and `[M ~map[K]V, K comparable, V any]` support indexing, slicing, `range`, `len`, `append` and `make`, and type arguments can be written as `[]int`, `map[K]V` or `func(…)`.
- **`--no-natives` flag**: runs the Go code of standard library functions instead of host fast paths, which helps when comparing results.
- **More of the standard library is written in Go**: `fmt`, `testing`, `os`, `unicode`, `regexp`, `crypto/rand`, the timers in `time` and `gom` now compile from Go source, so WebAssembly packages format values and run their tests inside the module instead of calling back into JavaScript. `os.Setenv` is new, `os.File.WriteString` reports byte counts, and a minimal `context` package backs `t.Context()`.
- **`testing` follows `go test` more closely**: `Skip` after `Error` reports FAIL, `-run` matches each `/`-separated level of a test name with its own pattern, and `t.Log` formats structs like Go. Tests in WebAssembly packages run inside the module, subtests included.
- **`encoding/json` and smaller output**: `encoding/json` can now be imported under an alias (`import myjson "encoding/json"`), `json.RawMessage` has its `MarshalJSON` and `UnmarshalJSON` methods, and single-file builds work with `encoding/json` and `errors.As`. Programs that use `encoding/json` produce smaller JavaScript, and WebAssembly packages that import `time` ship less JavaScript glue.

### Fixed
- **Go programs behave like Go on every target**: many programs that failed to compile, built an invalid WebAssembly module, or printed different results on JavaScript and WebAssembly now match Go, including nil pointers in interfaces, map keys, runtime panics recovered as `error` values, `fmt` verbs (`%p` now prints a stable id such as `0x1`), `encoding/json` values stored in `any`, and generic types exported from WebAssembly packages. Templ components accept every Go `for` form, a `switch` without a tag and a `{ children... }` spread under any parameter name ([details](docs/go-compatibility.md)).
- **`strings.Builder`, `math` and `encoding/json` match Go on every target**: a `strings.Builder` can now be a field of an exported WebAssembly struct, `math` follows Go's special cases such as `math.Pow(1, NaN)` and `math.Round`, and `encoding/json` gives the same results and error messages in JavaScript and WebAssembly while encoding and decoding about twice as fast in JavaScript.
- **`errors.As` and JavaScript-only packages**: custom `As` methods are honoured on JavaScript and WebAssembly alike, and importing a JavaScript-only package such as `regexp` or using `time.Sleep` from a WebAssembly package reports a clear error instead of crashing the compiler.
- **More Go programs match Go on JavaScript and WebAssembly**: same-named types in different functions, cross-package type aliases, `%p` of maps and slices, generic values stored in `any`, `fmt` verbs applied to `errors.New` values, `range` over a nil map, `os.Stderr` under Node.js and templ `case a, b:` now work like Go, and `b.Run` sub-benchmarks run to the target duration and report their own result line ([details](docs/go-compatibility.md)).

### Changed
- **Breaking:** An `async` test function cannot be combined with `TestMain` in the same package, and the build now reports an error. Remove `TestMain` or make the tests synchronous.
- **Breaking:** `gom.Node` is now `Mount(parent any, refs any)`, and `gom.Map` is generic over the slice's element type. Add the `refs any` parameter to your own `Mount` methods.
- **Breaking:** Like Go, the `unicode` functions take and return `rune` rather than `int`. Convert an `int` argument with `rune(x)`.
- **Breaking:** Like Go, the compiler now rejects assigning a `float64` variable or a fractional constant to an `int`, assigning an `any` to a concrete type without a type assertion, a `switch` case of the wrong type or whose constant does not fit the tag's type, `:=` that declares no new variable, `cap` of a string, and constants or package variables that depend on themselves. Convert explicitly (`int(y)`), add the assertion (`x.(A)`), or fix the case value or circular definition.
- **Breaking:** Like Go, indexing a string (`s[i]`) gives a `byte` rather than an `int`, `strings.Builder.WriteByte` takes a `byte`, and `cap` on a map is rejected. Convert with `int(s[i])` where an `int` is needed and use `len` for maps.
- **Breaking:** `\xNN` and octal escapes in string literals are now raw bytes as in Go, so `"\xe9"` is one byte rather than `é`. Write the character itself or a `\u` escape such as `"\u00e9"` when you mean text.
- **Breaking:** In `.templ` files a conditional attribute `name?={ expr }` must be a `bool`, and tokens left after a `{ }` expression (as in `{ name ) }`) are a parse error. Fix the expression.
- **Breaking:** Like Go, standard library packages such as `errors`, `sort`, `strings`, `os`, `unicode` and `crypto/rand` must now be imported before use. Add the missing `import` line wherever the compiler reports `No member … in namespace`.
- **Breaking:** `maps.Delete` and the top-level `binary.AppendUint16`, `AppendUint32` and `AppendUint64` are removed because Go has no such functions. Use the built-in `delete` and `binary.LittleEndian.AppendUint16` (or `binary.BigEndian`).
- **Breaking:** `binary.Read`, `binary.Write` and `binary.Size` are removed and report a compile error. Use the `binary.LittleEndian` or `binary.BigEndian` methods to encode and decode bytes.
- **Breaking:** `fmt.Sscan`, `fmt.Sscanf` and `fmt.Sscanln` are removed and report a compile error. Split the text with `strings.Fields` and parse each part with `strconv`.
- **Breaking:** Copying a `strings.Builder` that has been written to and then writing to the copy now panics, as in Go. Pass the builder by pointer instead of copying it.
- **Breaking:** `sort.Slice`, `slices.SortFunc` and similar sorts now order equal elements as Go does, which can change output that depended on the old order. Use `sort.SliceStable` or `slices.SortStableFunc` when equal elements must keep their input order.
- **Breaking:** `errors.New` values with equal text no longer match each other under `errors.Is`; compare against the same error value instead.
- **Breaking:** Locking a locked `sync.Mutex`, or calling `WaitGroup.Wait` with a positive counter, now panics instead of carrying on. Fix the lock or counter logic that the program was silently skipping.
- **Breaking:** `rand.Seed` no longer repeats the top-level `math/rand` sequence in WebAssembly. Use `rand.New(rand.NewSource(seed))` for repeatable numbers.
- **Breaking:** `strconv.FormatFloat` takes its format as a `byte`, so pass `'f'` rather than an `int` variable.
- **Breaking:** In JavaScript, `time.Time` is a struct rather than a plain object, and across the WebAssembly boundary `_d` is a read-only `Date`. Read fields through `Time` methods or `_d` instead of building or mutating the object by hand.
- **Breaking:** `math/bits` functions on a `uint` are exact only below 2⁵³ in JavaScript. Convert to `uint64` and use the `*64` forms for wider values.
- **Breaking:** Exported JavaScript functions and the WebAssembly facade now take and return `BigInt` for `int64` and `uint64`, including `time.Duration`. Pass `BigInt(n)` from hand-written JavaScript and convert results with `Number(…)` where a plain number is needed.

## [1.8.0] - 2026-10-30

### Added
- **Iterators and a wider standard library**: `iter` and `cmp`, the Go 1.23 iterator functions in `slices`, `maps`, `strings` and `bytes`, `os.Stdout`/`Stderr`/`Stdin` as `io.Writer`/`io.Reader`, and many more functions in `math`, `math/bits`, `time`, `io`, `sort`, `unicode`, `unicode/utf8`, `strconv` and `sync` now work on both backends. Only the functions your code reaches end up in the bundle; see [the package list](docs/language-support.md#standard-library-shims).
- **`fmt` behaves like Go**: Nearly every format verb and flag, except `%p`, now formats as in Go on both backends, including `%T`, `%#v` for most types, argument indexes, floats in hex and shortest form, and Go's error output; `Sprint`, `Sprintln` and the `Append` functions are new, and `Print`, `Println` and `Sprint` accept a call that returns several values (in WebAssembly, an `any` result holding a struct, pointer, map or slice still prints `<nil>`). Your own `String()` and `Error()` methods are used for plain values, slices, maps and struct fields, and WebAssembly now prints `any` values, signed and unsigned 64-bit integers, `Println` spacing and struct map-key order like Go, except that a `float32` inside an `any` still prints with `float64` digits and a func value passed directly prints a placeholder address.
- **`encoding/json` in WebAssembly, with streaming**: `encoding/json` now works in `wasm` and `both` packages, compiled into the module with exact 64-bit integers, and both backends add `Encoder`, `Decoder`, `Number`, `Compact`, `Indent`, `HTMLEscape`, typed errors such as `*json.SyntaxError`, and JSON support for `time.Duration` (and for `time.Time` in `wasm` packages). In `js` and `both` packages `Marshal` and `Unmarshal` now match Go for nil and empty maps, `omitempty` maps, struct tags on named structs held in `any`, `json.RawMessage`, infinities, `-0` and invalid `Unmarshal` targets, and in `wasm` packages slices, arrays and maps that reach `any` through a function result or variable now encode too; see [the compatibility notes](docs/go-compatibility.md#semantic-differences) for what still differs.
- **Benchmarks and test lifecycle**: `gofront test -bench` runs `BenchmarkXxx(*testing.B)` functions (with `b.N`, `b.Loop()`, `ResetTimer` and `ReportAllocs`), and tests can use `TestMain`, `t.Cleanup`, `t.Context`, `t.Setenv` and `t.Deadline` in `js`, `wasm` and `both` packages.
- **More of Go on both backends**: `wasm` and `both` packages now support range-over-func iterators, complex numbers, `min`/`max`, `[]rune` conversions, variadic functions and method values, and both backends add generic type aliases, method expressions on pointer and generic receivers, package-qualified generic calls (`cmp.Compare[int]`), recursive generic types and map literals with elided key types. Declarations may shadow predeclared names such as `len` or `document`; JavaScript callers see browser-global names with a `$` suffix (see [shadowed names](docs/go-compatibility.md#names-that-shadow-js-globals)).
- **SIMD vectors as ordinary values (experimental)**: `simd.F32x4` and the new comparison mask `simd.Mask32x4` work in struct fields, slices, map keys, `==`, `fmt` and generics and can cross the JS↔WASM boundary (a `[]simd.F32x4` in a `wasm` package arrives as one flat `Float32Array`), with new rounding, `MulAdd`, `Sum`, shuffle, lane comparison and `Select`, slice load/store and `Pad4` operations. A 65,536-particle step runs about 1.6× faster than scalar WebAssembly; see [the hybrid guide](docs/hybrid-wasm.md#wasm-simd-gofrontsimd).
- **More valid Go compiles**: Floats like `.5`, Unicode identifiers such as `θ`, parameters named `new`, trailing labels, grouped result names such as `(r, theta float64)`, `return f()` forwarding every result, `interface{}` matching `any` in method signatures, embedded generic types, array type arguments in type assertions, `case nil` with a bound variable and `type S Base` over a non-generic struct now work. A composite literal with an elided key of a non-composite type and shifting a non-integer value are compile errors.
- **Stricter generic checks**: Instantiated generic functions can be used as values (`f := Id[int]`) and a method can return a copy of its own receiver. Too many type arguments, type arguments on a non-generic function, converting an integer to an unconstrained type parameter and a type that instantiates itself with ever larger arguments are now compile errors.
- **Known gaps in generics and defined types**: Methods of an embedded generic type are promoted only through a generic wrapper in `js` and `both` packages and not at all in `wasm` packages, and fields of an embedded `*Inner[T]` are not yet promoted in `wasm` packages. `case nil` does not yet work in `wasm` packages when the same switch has an interface case, and in `js` and `both` packages a defined type over a generic instance (`type S Base[int]`) cannot be constructed and an alias of a struct cannot be used with positional literals, methods, copies or embedding.

### Changed
- **Breaking:** `maps.Keys` and `maps.Values` return an `iter.Seq`, as in Go 1.23, instead of a slice. Range over the result, or wrap it in `slices.Collect(...)` or `slices.Sorted(...)` where you need a slice.
- **Breaking:** `strconv.ParseInt` returns `int64`, and `strconv` parse errors are `*strconv.NumError` values wrapping `strconv.ErrSyntax` or `strconv.ErrRange`. Convert with `int(...)` where you need an `int`, and inspect errors with `errors.Is` or `errors.As` rather than their text.
- **Breaking:** In `js` packages, sub-slices (`a[i:j]`, `a[i:j:k]`) and variadic spreads now share the original backing array and capacity as in Go instead of copying, and a partial slice handed to JavaScript is a fixed-length array proxy that cannot be resized, frozen, cloned or posted. Copy with `slices.Clone` where Go code relied on the copy, and with `Array.from(v)` in JavaScript before those operations ([details](docs/go-compatibility.md#semantic-differences)).
- **Breaking:** In `wasm` and `both` packages, out-of-range indexes, writes to a nil map and field access through a nil struct pointer now panic with Go's messages on both backends instead of reading `undefined` or trapping. Fix the out-of-range or nil access, or `recover()` where you expect the panic.
- **Breaking:** In `wasm` and `both` packages, taking the address of a value that is not a struct or array (a number, string, bool, slice, map, interface such as `error`, pointer, func or SIMD vector) held in a struct field, slice or array element or package-level variable (`&s.X`, `&xs[i]`, `&pkgVar`, or a pointer-receiver call such as `s.Count.Inc()`) is now a compile error, where it used to lose writes silently, and so is taking the address of any func-typed variable, including a local (`&f`, or a pointer-receiver call on a named func type). Pass the parent struct pointer or the index, copy the value to a local, or return the new func; `js` packages are unaffected ([details](docs/hybrid-wasm.md#pointers-in-wasm-and-both-packages)).
- **Breaking:** Package-level variables whose initialisers depend on each other in a cycle, directly or through the functions and methods they call, are now a compile error as in Go. Break the cycle, for example by assigning one of the variables in `init`.
- **Breaking:** Constants that overflow their type (`int32(1 << 40)`), negative shift counts, constant division by zero, and duplicate or non-constant array and slice literal keys are now compile errors as in Go, and integer constants and literals beyond ±2⁵³ in JavaScript output give a precision warning. Change the value, its type or the literal keys so they fit.
- **Breaking:** Taking the address of a map element (`&m[k]`, `&m[k].Field`) or calling a pointer method on one (`m[k].Inc()`) is now a compile error on every target, as in Go. Copy the element to a local variable, change it and store it back, or keep pointers in the map.
- **Breaking:** In `js` and `both` packages, a struct type or a named type with methods can no longer be named after a JavaScript built-in that generated code uses (`Array`, `Object`, `Error`, `Map`, …). Rename the type, for example to `ArrayData` or `AppError`.
- **Breaking:** Unknown escape sequences in interpreted string literals, such as `\c` or `\8`, are now compile errors instead of being kept as written. Use a valid Go escape or a raw string literal.
- **Breaking:** Go expressions in `.templ` files are now type-checked like Go code, so undefined names, mismatched types and unused `for` loop variables fail the build. Fix the expression, or write `_` for a loop variable you do not use.
- **Clearer errors for unsupported Go**: `goto`, `//go:embed` and Go packages or functions GoFront does not provide (such as `reflect`, `unsafe`, `net/http`, `math/big` or `iter.Pull`) now say why they are not available in every target, and suggest an alternative where there is one.
- **Faster constant slice indexes in `both` packages**: Indexes like `m[0]` through `m[15]` skip the bounds check once the function has shown the length, with `_ = m[15]` or an `if len(m) > 15` guard, so matrix and vector code runs closer to plain JavaScript.
- **Examples are built on demand**: The compiler's behaviour and output are unchanged, but the examples are no longer committed pre-built, so run `npm run build` before opening one in a browser.

### Fixed
- **Calls with nested indexing parse again**: Arguments such as `f(s.Items[s.Idx[i].N])` no longer fail with `expected ']'`.
- **WebAssembly semantics**: Fixed-size arrays copy by value, closures capture a fresh variable per iteration of a three-clause `for`, inner `:=` stays block-scoped, multi-value assignments evaluate every right-hand side first, assignments from a multi-value call may target indexes, fields, dereferences and redeclared names, `fallthrough` runs the next clause, and package-level arrays, named array types, pointers to arrays, pointers to pointers, pointer-receiver methods on named maps and same-named methods with different signatures work. Anonymous struct variables start as zero structs, named strings and maps stored in `any` support type assertions, nil maps can be filled through pointers, and JavaScript can read exported package variables of `wasm` packages. In `wasm` packages, `append` and `copy` accept a string, constants can be declared inside functions, integer widths can be compared, and a nil map, pointer or func stored in `any` is no longer equal to `nil`. Reading through a nil pointer (`*p`, field access, value-receiver calls) and calling a nil func are panics that `recover()` catches, and generic types of generic types, named results in generic methods, pointers to named numbers behind interfaces and qualified type names in exported signatures now work. Package variables now initialise in dependency order.
- **JavaScript semantics**: In `both` packages, integer arithmetic on narrow types, shifts and negation now follows Go, and 64-bit shifts wrap and panic on a negative count. 64-bit arithmetic is exact only while values fit in 53 bits, and spreading slices into variadic functions, tuple assignments, generics and stores into elements whose address was taken in the same function now behave as in Go.
- **Exact constants**: Constant expressions fold with exact integer precision instead of floating point.
- **Generics behave as in Go**: Zero values, struct equality and copies on type parameters, and type switches across generic instantiations now give Go's results. In JavaScript, type assertions to a type parameter follow the instantiated type except that all numeric types still match each other, conversions to a type parameter truncate and wrap, and instantiations of a generic type differ at run time.
- **Literals, fields and maps**: Keyed and anonymous composite literals, writes to promoted fields and comparisons of a map with `nil` now behave as in Go. In JavaScript, maps keyed by `any` now tell apart strings, numbers, booleans and your own defined string, number and bool types, including in generic code, and maps keyed by a named struct type compare keys field by field, print in Go's order and return the struct when ranged over.
- **Pointers and assertions**: Type assertions to struct pointers and writes through a pointer to a func variable now behave as in Go, and a named string, number or bool stored in an `any` no longer matches its underlying type in JavaScript, while a type switch can tell a single-error `Unwrap` from a multi-error one. In WebAssembly, `errors.Join` results do not yet match either form.
- **Valid Go no longer crashes in JavaScript output**: Several valid constructs that used to fail now run like Go, including keyed struct literals with embedded values, `i := i` and `x := f(x)` in loops and blocks, and `make` and `new` of named slice and array types. A pointer method that checks its receiver for nil can be called directly on a nil pointer in the same package, reading through `*p` on a nil struct pointer panics with Go's message, and `clear` on a slice zeroes its elements.
- **String escapes and standard library edge cases**: Interpreted strings decode every Go `\x`, octal, `\u`, `\U` and control escape on both backends, `encoding/json` writes promoted fields where Go does, and `fmt.Print` spaces operands like Go and prints structs with named slice fields in WebAssembly. `unicode.IsSpace`, `strings.Fields` and `bytes.Index` handle non-ASCII UTF-8 like Go, and in JavaScript `math.IsInf(math.NaN(), 0)` is `false` and `slices.Contains`/`slices.Index` compare structs and arrays by value.
- **Templ fixes**: A malformed `for` loop in a `.templ` file is now reported instead of silently dropped, and templ parameters named like JavaScript keywords or browser globals, such as `class` or `document`, now work.
- **CLI fixes**: `-o` pointing at a directory that cannot be created now fails with an error instead of hanging, and `gofront prep` writes the same `vendor.js` on every run.

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
