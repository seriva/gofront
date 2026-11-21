//go:build gofront

//gofront:target both

// Package embed provides access to files embedded in the program at build
// time with //go:embed directives.
//
// The directives are resolved by the compiler (see src/compiler.js), so the
// package declares no names yet.
package embed
