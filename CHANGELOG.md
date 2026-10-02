# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
