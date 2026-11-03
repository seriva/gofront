//go:build gofront

//gofront:target both

// Package filepath implements utility routines for manipulating filename
// paths. GoFront targets the browser and the JavaScript runtime, where paths
// are slash-separated, so every function is the one in package path.
package filepath

import "path"

// ErrBadPattern indicates a pattern was malformed.
var ErrBadPattern = path.ErrBadPattern

// Separator is the OS-specific path separator.
const Separator = '/'

// ListSeparator is the OS-specific path list separator.
const ListSeparator = ':'

// Join joins any number of path elements into a single path, separating them
// with a slash and cleaning the result.
func Join(elem ...string) string { return path.Join(elem...) }

// Clean returns the shortest path name equivalent to path by purely lexical
// processing.
func Clean(p string) string { return path.Clean(p) }

// Base returns the last element of path.
func Base(p string) string { return path.Base(p) }

// Dir returns all but the last element of path, typically the path's
// directory.
func Dir(p string) string { return path.Dir(p) }

// Ext returns the file name extension used by path.
func Ext(p string) string { return path.Ext(p) }

// Split splits path immediately following the final slash, separating it into
// a directory and file name component.
func Split(p string) (dir, file string) { return path.Split(p) }

// IsAbs reports whether the path is absolute.
func IsAbs(p string) bool { return path.IsAbs(p) }

// Match reports whether name matches the shell file name pattern.
func Match(pattern, name string) (matched bool, err error) { return path.Match(pattern, name) }
