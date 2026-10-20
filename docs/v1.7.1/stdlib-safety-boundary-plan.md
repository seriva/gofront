# Zero-Runtime Stdlib, WASM Safety & Boundary Polish — Design Plan

**Version:** v1.7.1  
**Status:** Draft (2026-10-19)  
**Complements:** [`docs/v1.7.1/simd-soa-plan.md`](simd-soa-plan.md)

---

## Goal

Complement the v1.7.1 SIMD promotion track with essential zero-runtime features and compiler safety:
1. **WASM Interior Pointer Diagnostic:** Prevent silent mutation bugs by reporting compile errors when taking the address of struct fields (`&s.Field`) or array/slice elements (`&arr[i]`) in `wasm` and `both` packages, where WasmGC lacks interior pointers.
2. **Pure Zero-Runtime Stdlib Packages:** Add in-memory standard library packages that operate without an OS, scheduler, or host runtime:
   - `net/url`: Standard Go URL parsing, query escaping, and `url.Values`.
   - `bufio`: In-memory buffered I/O (`bufio.Scanner`, `bufio.Reader`, `bufio.Writer`) over `io.Reader` and `io.Writer`.
   - `context`: Single-threaded cooperative cancellation and deadline tokens (`context.Context`, `WithCancel`, `WithTimeout`) designed for `async func` workflows in JavaScript.
3. **Boundary Polish (Read-Only Slice Borrowing):** Elide element-by-element slice cloning across the JS↔WASM boundary when lowering analysis verifies the callee neither retains nor mutates the slice.

---

## Out of Scope

- **Runtime Schedulers & Threads:** Goroutines (`go`), channels (`chan`), and `select` remain out of scope.
- **Dynamic Linear Memory Growth:** `gofront/shared` buffers remain fixed at startup (`var` or `init()`) to prevent WebAssembly `memory.grow` from detaching JavaScript `ArrayBuffer` views.
- **`BigInt` Lowering:** `int64` on the JS side remains standard `Number` to preserve fast DOM, Canvas, and WebGL integration without `TypeError` coercions.
- **Runtime Reflection:** No `reflect` package or dynamic runtime type metadata.
- **WASM `encoding/json`:** JSON parsing and serialization remain on the JS side (backed by browser C++ `JSON.parse` / `JSON.stringify`).

---

## Approach

### 1. WASM Interior Pointer Compile-Time Diagnostic

#### Problem
WasmGC types (`ref $struct`) only reference whole struct instances; WebAssembly GC does not support interior pointers into primitive fields or array slots.
- When `s.Field` is a struct (e.g. `&aabb.Min` where `Min` is `mathx.Vec3`), GoFront treats structs as reference types (`ref null $Vec3`), so taking its address passes the reference handle directly without issue.
- However, when `s.Field` or `arr[i]` is a **primitive/scalar** (e.g. `&p.X` where `X` is `float32`), `src/backend/wasm/emit-exprs.js:1344` evaluates the scalar and packs it into a newly allocated temporary box struct (`struct.new box`). Mutating `*p = value` alters the temporary box, leaving `s.Field` or `arr[i]` unmutated with zero compiler warnings.

#### Solution
In `src/typechecker/expressions.js`, intercept address-of operations (`&`) on non-ident operands (`SelectorExpr`, `IndexExpr`) whose resolved base type is a **scalar/primitive** (not a struct) when the package target is `wasm` or `both`:
- Emit a clear, actionable compile diagnostic:
  ```
  cannot take address of scalar struct field or array element in wasm packages: WebAssembly GC does not support interior pointers; mutate through pointer receiver methods or hold scalar locals
  ```
- Address-of struct-typed fields (`&s.SubStruct`), address-of identifier variables (`&x`), and composite literals (`&Point{...}`) remain fully supported.

---

### 2. Pure Zero-Runtime Stdlib Additions

#### `net/url`
Pure string parsing, query formatting, and path encoding:
- **Structs & Types:**
  - `url.URL`: `Scheme`, `Opaque`, `User`, `Host`, `Path`, `RawPath`, `ForceQuery`, `RawQuery`, `Fragment`.
  - `url.Values`: `map[string][]string` with methods `Get(key)`, `Set(key, val)`, `Add(key, val)`, `Del(key)`, `Has(key)`, and `Encode() string`.
- **Functions:**
  - `url.Parse(rawURL string) (*URL, error)`
  - `url.ParseRequestURI(rawURL string) (*URL, error)`
  - `url.QueryEscape(s string) string`
  - `url.QueryUnescape(s string) (string, error)`
  - `url.PathEscape(s string) string`
  - `url.PathUnescape(s string) (string, error)`
- **Target Availability:** `js`, `wasm`, and `both`.

#### `bufio` (In-Memory Buffered I/O)
Operates entirely on `io.Reader` and `io.Writer` interfaces (such as `strings.Reader` and `bytes.Buffer`):
- **`bufio.Scanner`:**
  - Methods: `Scan() bool`, `Text() string`, `Bytes() []byte`, `Err() error`, `Split(fn SplitFunc)`.
  - Split functions: `bufio.ScanLines`, `bufio.ScanWords`, `bufio.ScanBytes`, `bufio.ScanRunes`.
- **`bufio.Reader`:**
  - Methods: `Read(p []byte) (int, error)`, `ReadByte() (byte, error)`, `ReadString(delim byte) (string, error)`, `ReadBytes(delim byte) (type []byte, error)`, `ReadLine() (line []byte, isPrefix bool, err error)`.
- **`bufio.Writer`:**
  - Methods: `Write(p []byte) (int, error)`, `WriteString(s string) (int, error)`, `WriteByte(c byte) error`, `Flush() error`.
- **Target Availability:** `js`, `wasm`, and `both`.

#### `context` (Cooperative Cancellation for Frontend & Async)
Provides standard Go cancellation tokens for asynchronous workflows (`async func`) without requiring a scheduler:
- **Interface & Types:**
  - `context.Context` interface:
    - `Err() error`
    - `Done() bool` (true when canceled or expired)
    - `Deadline() (deadline time.Time, ok bool)`
    - `Value(key any) any`
    - `Signal() any` (returns browser `AbortSignal` in JS packages for direct interop with `fetch` / DOM event listeners)
- **Functions:**
  - `context.Background() Context`
  - `context.TODO() Context`
  - `context.WithCancel(parent Context) (ctx Context, cancel func())`
  - `context.WithTimeout(parent Context, timeout time.Duration) (ctx Context, cancel func())`
  - `context.WithValue(parent Context, key, val any) Context`
- **Errors:**
  - `context.Canceled` (`"context canceled"`)
  - `context.DeadlineExceeded` (`"context deadline exceeded"`)
- **Integration:** Enables cancelling ongoing asynchronous tasks, fetch requests, or animation timers cleanly.
- **Target Availability:** `js` (with timeout timers), and pure cancellation in `wasm`/`both`.

---

### 3. Boundary Polish: Read-Only Slice Borrowing

#### Problem
Passing `[]T` or `[N]T` across the JS ↔ WASM boundary currently performs a deep element-wise copy on every invocation. For functions that inspect but do not retain or mutate slices, this creates unnecessary garbage collection churn.

#### Solution
- Reuse the existing lowering pass in `src/lower/escape.js` (`paramEscapes()`) to detect parameters marked read-only (no `append`, no element assignment, no escape to package globals, struct fields, or return handles).
- For pure numeric slices (`[]float32`, `[]int32`), borrow a temporary view into the module's linear scratch memory or direct array buffer without element copying.
- For non-escaping struct slices, avoid re-instantiating intermediate wrapper objects.
- **On-Demand Dev Tree-Shaking:** Ensure newly added stdlib functions are only emitted into `app.wasm` when directly referenced, preventing code bloat in `gofront dev` where Binaryen `-O3` dead-code elimination is bypassed for sub-10ms rebuilds.
- **Sentrux Layer Compliance:** Strictly isolate type signatures in `src/typechecker/stdlib/` without back-referencing `backend`, preserving downward architectural flow (`backend → lower → typechecker → parser → lexer → types`).

---

## Edge Cases

1. **Sub-struct Selectors:**
   - Expressions like `&s.Inner.Field` or `&arr[0].X` must both be caught and rejected by the WASM interior pointer diagnostic.
2. **URL Port and IPv6 Hostnames:**
   - Parsing bracketed IPv6 addresses `[::1]:8080` must correctly extract Hostname `::1` and Port `8080`.
3. **Custom `bufio.SplitFunc` Semantics:**
   - `Scanner` must conform strictly to Go's EOF handling: if final token has data without trailing delimiter, return token on final `Scan()` step before terminating.
4. **Context Hierarchy Propagation:**
   - Cancelling a parent context must immediately cancel all child contexts derived via `WithCancel` or `WithTimeout`.

---

## Implementation Tasks

### Phase 1: WASM Pointer Safety Diagnostic
- [ ] **Task 1.1** — In `src/typechecker/expressions.js`, add validation inside `_checkAddressOfExpr` rejecting `SelectorExpr` and `IndexExpr` operands when target is `wasm` or `both`.
- [ ] **Task 1.2** — Add targeted diagnostic tests verifying clear error message and hints in `test/unit/wasm/pointers.test.js`.

### Phase 2: `net/url` Implementation
- [ ] **Task 2.1** — Add `net/url` type definitions to `src/typechecker/stdlib/` and register in `WASM_SUPPORTED_STDLIB` / `STDLIB_PACKAGES`.
- [ ] **Task 2.2** — Implement JS code generator in `src/backend/js/stdlib/url.js`.
- [ ] **Task 2.3** — Implement WASM emitter in `src/backend/wasm/stdlib/packages.js`.
- [ ] **Task 2.4** — Add dual-target parity test suite in `test/unit/stdlib/url.test.js`.

### Phase 3: `bufio` Implementation
- [ ] **Task 3.1** — Add `bufio` type signatures (`Scanner`, `Reader`, `Writer`, split functions) to `src/typechecker/stdlib/`.
- [ ] **Task 3.2** — Implement JS runtime helpers and codegen in `src/backend/js/stdlib/bufio.js`.
- [ ] **Task 3.3** — Implement WASM emitter helpers in `src/backend/wasm/stdlib/io.js`.
- [ ] **Task 3.4** — Add scanning and buffered reading tests in `test/unit/stdlib/bufio.test.js`.

### Phase 4: `context` Package
- [ ] **Task 4.1** — Add `context.Context` interface and constructor signatures to `src/typechecker/stdlib/`.
- [ ] **Task 4.2** — Implement JS context helpers with `setTimeout` cancellation in `src/backend/js/stdlib/context.js`.
- [ ] **Task 4.3** — Implement pure WASM context helpers in `src/backend/wasm/stdlib/pure.js`.
- [ ] **Task 4.4** — Add cancellation hierarchy tests in `test/unit/stdlib/context.test.js`.

### Phase 5: Boundary Slice Optimization & Documentation
- [ ] **Task 5.1** — Update `src/backend/wasm/boundary.js` to avoid redundant copy-in when slice parameter is verified read-only.
- [ ] **Task 5.2** — Update `docs/language-support.md` and `docs/hybrid-wasm.md` with new packages and diagnostic rules.
- [ ] **Task 5.3** — Run full verification suite (`npm test`, `npm run check`, `npm run build`, `npm run test:e2e`).

---

## Test Plan

### Unit & Parity Tests
- **`test/unit/wasm/pointers.test.js`:**
  - Verify `&s.ScalarField` and `&arr[i]` on primitive types produce actionable compile errors in `wasm` and `both` packages.
  - Verify `&s.StructField` (nested struct references) and `&x` (scalar identifiers) continue to compile and pass tests without error.
- **`test/unit/stdlib/url.test.js`:**
  - Verify `url.Parse` extracts scheme, userinfo, host, path, query, and fragment identically in JS and WASM.
  - Verify `url.Values` sorting, escaping, and unescaping match Go standard library byte-for-byte in `both` package suites.
- **`test/unit/stdlib/bufio.test.js`:**
  - Verify `Scanner` line, word, and custom split scanning against `strings.Reader` and `bytes.Buffer`.
  - Verify `Reader` and `Writer` buffer boundaries, delimiter searching (`ReadString`), and flush behavior across both backends.
- **`test/unit/stdlib/context.test.js`:**
  - Verify parent-to-child cancellation propagation with `WithCancel`.
  - Verify timer expiration with `WithTimeout` in JS packages.
  - Verify `.Signal()` returns an active/aborted browser `AbortSignal` in JS packages.

### Negative & Diagnostic Tests
- Taking the address of a scalar field in a `wasm` package reports:
  `cannot take address of scalar struct field or array element in wasm packages: WebAssembly GC does not support interior pointers; ...`
- Malformed URLs in `url.Parse` return non-nil error values conforming to `*url.Error`.

### Performance & Memory Tests
- **Boundary Slice Borrowing:**
  - Benchmark passing 100k-element `[]float32` to read-only WASM kernel; verify zero JS heap allocation per call.
