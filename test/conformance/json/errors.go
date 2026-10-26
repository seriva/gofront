package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

type User struct {
	Name string `json:"name"`
	Age  int    `json:"age"`
}

type FailMarshal struct{}

func (FailMarshal) MarshalJSON() ([]byte, error) {
	return nil, errors.New("marshaler failed")
}

func main() {
	// 1. SyntaxError
	var synErr *json.SyntaxError
	var u User
	err := json.Unmarshal([]byte(`{"name": "foo", "age": }`), &u)
	if errors.As(err, &synErr) {
		fmt.Printf("SyntaxError: Offset=%d msg=%s\n", synErr.Offset, synErr.Error())
	}

	err = json.Unmarshal([]byte(`{"unclosed"`), &u)
	if errors.As(err, &synErr) {
		fmt.Printf("SyntaxError EOF: Offset=%d msg=%s\n", synErr.Offset, synErr.Error())
	}

	// 2. UnmarshalTypeError
	var typeErr *json.UnmarshalTypeError
	err = json.Unmarshal([]byte(`{"name":"bar","age":"notanumber"}`), &u)
	if errors.As(err, &typeErr) {
		fmt.Printf("UnmarshalTypeError struct: Value=%s Struct=%s Field=%s Offset=%d msg=%s\n",
			typeErr.Value, typeErr.Struct, typeErr.Field, typeErr.Offset, typeErr.Error())
	}

	var num int
	err = json.Unmarshal([]byte(`"notanumber"`), &num)
	if errors.As(err, &typeErr) {
		fmt.Printf("UnmarshalTypeError scalar: Value=%s Struct=%s Field=%s msg=%s\n",
			typeErr.Value, typeErr.Struct, typeErr.Field, typeErr.Error())
	}

	// 3. InvalidUnmarshalError
	var invErr *json.InvalidUnmarshalError
	err = json.Unmarshal([]byte(`{"name":"foo"}`), nil)
	if errors.As(err, &invErr) {
		fmt.Printf("InvalidUnmarshalError nil: msg=%s\n", invErr.Error())
	}

	err = json.Unmarshal([]byte(`{"name":"foo"}`), u)
	if errors.As(err, &invErr) {
		fmt.Printf("InvalidUnmarshalError non-ptr: msg=%s\n", invErr.Error())
	}

	// 4. UnsupportedValueError
	var valErr *json.UnsupportedValueError
	_, err = json.Marshal(math.NaN())
	if errors.As(err, &valErr) {
		fmt.Printf("UnsupportedValueError NaN: Str=%s msg=%s\n", valErr.Str, valErr.Error())
	}

	// 5. MarshalerError
	var marshErr *json.MarshalerError
	_, err = json.Marshal(FailMarshal{})
	if errors.As(err, &marshErr) {
		fmt.Printf("MarshalerError: msg=%s unwrap=%v\n", marshErr.Error(), errors.Unwrap(marshErr))
	}
}
