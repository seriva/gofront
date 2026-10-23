# Conformance fixtures

Each `test/conformance/<pkg>/<name>.go` is a small, plain Go program whose `main` prints results with `fmt`. Next to it, `<name>.out` holds the output of the same program under real Go.

`npm run conformance` (part of `npm test`) compiles every fixture as a `both` package, runs `main` on the JS backend and on the WASM backend, and compares each output with `<name>.out` byte for byte. A failure names the backend and the first line that differs. A fixture without an `.out` file fails with a hint to run `npm run conformance:update`.

To run a different directory of fixtures: `node test/conformance/run.js <dir>`.

## Writing a fixture

- Keep it a valid Go program: `package main`, a `main` function, standard imports only. No `//gofront:` directives are needed; the runner compiles the file as `both`.
- Put it under the directory of the package it tests (`strings/`, `strconv/`, `fmt/`, …).
- End the output with a newline. WASM stdout is line-buffered, so an unterminated last line is not written.
- Do not panic and do not write to stderr; only stdout is compared.
- Follow the string rules in the [portable Go plan §1.1](../../docs/v1.8.0/portable-go-plan.md#11-string-semantics-both-backends): GoFront strings are JavaScript strings, so `len`, indexing and `range` count UTF-16 code units on both backends while Go counts UTF-8 bytes. Do not apply them to non-ASCII strings; use `[]byte(s)` or `[]rune(s)` instead.
