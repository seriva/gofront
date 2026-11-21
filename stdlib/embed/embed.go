//go:build gofront

//gofront:target both

// Package embed provides access to files embedded in the program at build
// time with //go:embed directives.
//
// A string or []byte variable is initialised by the compiler (see
// src/compiler.js and src/lower/globals.js). An FS holds the files its
// directives matched, sorted by path, and the compiler fills it in the same
// way. Only ReadFile is available: ReadDir and Open need io/fs.
package embed

import "errors"

// An FS is a read-only collection of files, usually initialized with a
// //go:embed directive. The zero value is an empty file system.
//
// The compiler fills names (sorted) and datas (the contents of each name)
// for a variable with a directive; a program never builds an FS itself.
type FS struct {
	names []string
	datas [][]byte
}

// ReadFile reads and returns the content of the named file. The result is a
// fresh copy: changing it does not change the embedded file.
func (f FS) ReadFile(name string) ([]byte, error) {
	lo, hi := 0, len(f.names)
	for lo < hi {
		mid := lo + (hi-lo)/2
		if f.names[mid] < name {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo == len(f.names) || f.names[lo] != name {
		return nil, errors.New("open " + name + ": file does not exist")
	}
	data := f.datas[lo]
	out := make([]byte, len(data))
	copy(out, data)
	return out, nil
}
