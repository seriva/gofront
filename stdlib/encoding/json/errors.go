//go:build gofront

//gofront:target both

package json

import (
	"internal/jsonrt"
)

// A SyntaxError is a description of a JSON syntax error.
// [Unmarshal] will return a SyntaxError if the JSON can't be parsed.
type SyntaxError = jsonrt.SyntaxError

// An UnmarshalTypeError describes a JSON value that was not appropriate for
// a value of a specific Go type.
type UnmarshalTypeError = jsonrt.UnmarshalTypeError

// An InvalidUnmarshalError describes an invalid argument passed to Unmarshal.
type InvalidUnmarshalError = jsonrt.InvalidUnmarshalError

// An UnsupportedValueError is returned by Marshal when attempting to encode
// an unsupported value.
type UnsupportedValueError = jsonrt.UnsupportedValueError

// UnsupportedTypeError is returned by Marshal when attempting to encode an
// unsupported value type.
type UnsupportedTypeError = jsonrt.UnsupportedTypeError

// A MarshalerError represents an error from calling a MarshalJSON method.
type MarshalerError = jsonrt.MarshalerError
