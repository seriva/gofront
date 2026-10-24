# Conformance fixtures

Each `test/conformance/<pkg>/<name>.go` is a small, plain Go program whose `main` prints results with `fmt`. Next to it, `<name>.out` holds the output of the same program under real Go.

`npm run conformance` (part of `npm test`) compiles every fixture as a `both` package (with the Go-source stdlib under `runtime/stdlib/`, like a project build), runs `main` on the JS backend and on the WASM backend, and compares each output with `<name>.out` byte for byte. A failure names the backend and the first line that differs. A fixture without an `.out` file fails with a hint to run `npm run conformance:update`.

To run a different directory of fixtures: `node test/conformance/run.js <dir>`.

## Workflow

1. Write `<pkg>/<name>.go` (see the rules below).
2. Capture the expected output from real Go: `npm run conformance:update`. It runs `go run` on every fixture and writes each `.out`; pass paths to limit it (`npm run conformance:update -- test/conformance/fmt` or a single `.go` file). It needs the Go toolchain (go1.26, the version the stdlib manifest targets) on `PATH` and fails with an explanation when `go` is missing or has another version.
3. Review the `.out` diff and commit both files.
4. `npm run conformance` checks both GoFront backends against it.

Only step 2 needs Go. The `.out` files are checked in, so `npm test` and CI run without a Go toolchain. The unit test that regenerates the checked-in fixtures and expects no change runs only when go1.26 is installed.

## JS-only fixtures

A fixture whose first line is `//conformance:js-only` covers only what the JS backend supports so far: it is compared on JS and not run on WASM. It is a temporary state. When the WASM backend catches up, delete the line and the fixture is checked on both backends (`fmt/stringer.go` was promoted that way by Task 3.1b-wasm). The `.out` file is still captured from real Go.

## Writing a fixture

- Keep it a valid Go program: `package main`, a `main` function, standard imports only. No `//gofront:` directives are needed; the runner compiles the file as `both`.
- Put it under the directory of the package it tests (`strings/`, `strconv/`, `fmt/`, …).
- End the output with a newline. WASM stdout is line-buffered, so an unterminated last line is not written.
- Do not panic and do not write to stderr; only stdout is compared.
- Follow the string rules in the [portable Go plan §1.1](../../plans/v1.8.0/portable-go-plan.md#11-string-semantics-both-backends): GoFront strings are JavaScript strings, so `len`, indexing and `range` count UTF-16 code units on both backends while Go counts UTF-8 bytes. Do not apply them to non-ASCII strings; use `[]byte(s)` or `[]rune(s)` instead.
