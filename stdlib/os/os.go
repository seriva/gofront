//go:build gofront

//gofront:target both

// Package os provides the process-level part of the real package: the
// standard streams, Exit and the environment. Files, directories and
// processes are not supported.
//
// Writes to Stdout and Stderr go through the host's output; Stdin is always
// at end of input.
package os

import "io"

// File represents an open file descriptor.
type File struct {
	fd int
}

// Stdin, Stdout and Stderr are open Files pointing to the standard input,
// standard output, and standard error file descriptors.
var (
	Stdin  = &File{0}
	Stdout = &File{1}
	Stderr = &File{2}
)

// Args hold the command-line arguments. It is always empty.
var Args []string

// hostWrite writes s to the host's output for the file descriptor fd.
//
//gofront:intrinsic os_write
func hostWrite(fd int, s string)

// hostExit terminates the process with the given status code.
//
//gofront:intrinsic os_exit
func hostExit(code int)

// hostGetenv returns the value of the host environment variable key, or
// the empty string.
//
//gofront:intrinsic os_getenv
func hostGetenv(key string) string

// hostSetenv sets the host environment variable key to value.
//
//gofront:intrinsic os_setenv
func hostSetenv(key, value string)

// Write writes len(b) bytes from b to the File.
func (f *File) Write(b []byte) (n int, err error) {
	hostWrite(f.fd, string(b))
	return len(b), nil
}

// WriteString is like Write, but writes the contents of string s rather
// than a slice of bytes. It reports the bytes written, not the characters.
func (f *File) WriteString(s string) (n int, err error) {
	hostWrite(f.fd, s)
	// The JavaScript backend counts a string in UTF-16 units; the bytes are
	// what Go reports.
	return len([]byte(s)), nil
}

// Read reads up to len(b) bytes from the File. Standard input is always at
// end of input, so it returns 0, io.EOF.
func (f *File) Read(b []byte) (n int, err error) {
	return 0, io.EOF
}

// Close closes the File. It has no effect on the standard streams.
func (f *File) Close() error {
	return nil
}

// Exit causes the current program to exit with the given status code.
func Exit(code int) {
	hostExit(code)
}

// Getenv retrieves the value of the environment variable named by the key.
// It returns the value, which will be empty if the variable is not present.
func Getenv(key string) string {
	return hostGetenv(key)
}

// Setenv sets the value of the environment variable named by the key.
func Setenv(key, value string) error {
	hostSetenv(key, value)
	return nil
}
