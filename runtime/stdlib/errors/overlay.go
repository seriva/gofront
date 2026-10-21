//go:build gofront

//gofront:target both

// Overlay on the emitter-backed errors package: these members are written
// in Go and merged into the errors namespace. Unqualified references to
// emitter members (New) resolve to the emitter implementation.
package errors

// ErrUnsupported indicates that a requested operation cannot be performed,
// because it is unsupported.
var ErrUnsupported = New("unsupported operation")
