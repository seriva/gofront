//go:build gofront

//gofront:target both

package json

import (
	"errors"
	"internal/jsonrt"
)

// Marshal returns the JSON encoding of v.
//
// The compiler replaces every call with a function generated for the static
// type of v, so this body runs only when Marshal is used as a value, which
// the compiler rejects.
func Marshal(v any) ([]byte, error) {
	panic("json.Marshal: call sites are rewritten by the compiler")
}

// MarshalIndent is like Marshal but applies Indent to format the output.
//
// The compiler replaces every call with a generated function; see Marshal.
func MarshalIndent(v any, prefix, indent string) ([]byte, error) {
	panic("json.MarshalIndent: call sites are rewritten by the compiler")
}

// Unmarshal parses the JSON-encoded data and stores the result in the value
// pointed to by v.
//
// The compiler replaces every call with a function generated for the static
// type of v; see Marshal.
func Unmarshal(data []byte, v any) error {
	panic("json.Unmarshal: call sites are rewritten by the compiler")
}

// Valid reports whether data is a valid JSON encoding.
func Valid(data []byte) bool {
	return jsonrt.Valid(data)
}

// RawMessage is a raw encoded JSON value. It implements Marshaler and
// Unmarshaler and can be used to delay JSON decoding or precompute a JSON
// encoding.
type RawMessage []byte

// MarshalJSON returns m as the JSON encoding of m.
func (m RawMessage) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("null"), nil
	}
	return m, nil
}

// UnmarshalJSON sets *m to a copy of data.
func (m *RawMessage) UnmarshalJSON(data []byte) error {
	if m == nil {
		return errors.New("json.RawMessage: UnmarshalJSON on nil pointer")
	}
	*m = append((*m)[0:0], data...)
	return nil
}
