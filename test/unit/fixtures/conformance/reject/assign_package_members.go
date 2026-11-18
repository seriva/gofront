package main

import (
	"fmt"
	"strings"
)

func main() {
	fmt.Println = nil                   // ERROR "cannot assign to fmt.Println (neither addressable nor a map index expression)"
	_ = &fmt.Println                    // ERROR "cannot take address of fmt.Println"
	strings.Builder = strings.Builder{} // ERROR "cannot assign to strings.Builder (neither addressable nor a map index expression)"
	_ = &strings.Builder                // ERROR "cannot take address of strings.Builder"
	shared.Float32 = nil                // ERROR "cannot assign to shared.Float32"
	_ = &shared.Float32                 // ERROR "cannot take address of shared.Float32"
	shared.NewFloat32 = nil             // ERROR "cannot assign to shared.NewFloat32"
	simd.F32x4 = nil                    // ERROR "cannot assign to simd.F32x4"
	simd.NewF32x4 = nil                 // ERROR "cannot assign to simd.NewF32x4"
	_ = &simd.Splat                     // ERROR "cannot take address of simd.Splat"
}
