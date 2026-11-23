package main

func main() {
	ArrayBuffer = nil // ERROR "cannot assign to ArrayBuffer"
	_ = &Uint8Array // ERROR "cannot take address of Uint8Array"
	_ = &WebGLRenderingContext // ERROR "cannot take address of WebGLRenderingContext"
}
