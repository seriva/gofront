// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

//go:build gofront

//gofront:target both

// Package fmt formats values like the real package.
//
// Where Go's fmt asks reflection for the type of an operand, this package
// reads a description of it (fmtrt.Arg). The compiler writes the description
// for operands whose type it knows at the call and for the types a package
// stores in interfaces; see internal/fmtrt.
package fmt

import (
	"internal/fmtrt"
	"io"
	"os"
	"slices"
)

// Stringer is implemented by any value that has a String method, which
// defines the “native” format for that value.
type Stringer interface {
	String() string
}

// GoStringer is implemented by any value that has a GoString method, which
// defines the Go syntax for that value.
type GoStringer interface {
	GoString() string
}

const (
	commaSpaceString  = ", "
	nilAngleString    = "<nil>"
	nilParenString    = "(nil)"
	nilString         = "nil"
	mapString         = "map["
	percentBangString = "%!"
	missingString     = "(MISSING)"
	badIndexString    = "(BADINDEX)"
	panicString       = "(PANIC="
	extraString       = "%!(EXTRA "
	badWidthString    = "%!(BADWIDTH)"
	badPrecString     = "%!(BADPREC)"
	noVerbString      = "%!(NOVERB)"
	invReflectString  = "<invalid reflect.Value>"
)

// pp is the printer state.
type pp struct {
	fmt format

	// erroring is set when printing an error string to guard against calling handleMethods.
	erroring bool
	// panicking is set by catchPanic to avoid infinite panic, recover, panic, ... recursion.
	panicking bool
}

func newPrinter() *pp {
	p := &pp{}
	p.fmt.intbuf = make([]byte, 68)
	return p
}

func (p *pp) writeString(s string) {
	p.fmt.buf = append(p.fmt.buf, s...)
}

func (p *pp) writeByte(c byte) {
	p.fmt.buf = append(p.fmt.buf, c)
}

func (p *pp) writeRune(r rune) {
	p.fmt.buf = append(p.fmt.buf, string(r)...)
}

// Fprint formats using the default formats for its operands and writes to w.
// Spaces are added between operands when neither is a string.
func Fprint(w io.Writer, a ...any) (n int, err error) {
	p := newPrinter()
	p.doPrint(a)
	n, err = w.Write(p.fmt.buf)
	return
}

// Print formats using the default formats for its operands and writes to standard output.
func Print(a ...any) (n int, err error) {
	return Fprint(os.Stdout, a...)
}

// Sprint formats using the default formats for its operands and returns the resulting string.
func Sprint(a ...any) string {
	p := newPrinter()
	p.doPrint(a)
	return string(p.fmt.buf)
}

// Append formats using the default formats for its operands, appends the result to
// the byte slice, and returns the updated slice.
func Append(b []byte, a ...any) []byte {
	p := newPrinter()
	p.doPrint(a)
	return append(b, p.fmt.buf...)
}

// Fprintln formats using the default formats for its operands and writes to w.
// Spaces are always added between operands and a newline is appended.
func Fprintln(w io.Writer, a ...any) (n int, err error) {
	p := newPrinter()
	p.doPrintln(a)
	n, err = w.Write(p.fmt.buf)
	return
}

// Println formats using the default formats for its operands and writes to standard output.
func Println(a ...any) (n int, err error) {
	return Fprintln(os.Stdout, a...)
}

// Sprintln formats using the default formats for its operands and returns the resulting string.
func Sprintln(a ...any) string {
	p := newPrinter()
	p.doPrintln(a)
	return string(p.fmt.buf)
}

// Appendln formats using the default formats for its operands, appends the result
// to the byte slice, and returns the updated slice.
func Appendln(b []byte, a ...any) []byte {
	p := newPrinter()
	p.doPrintln(a)
	return append(b, p.fmt.buf...)
}

// describe turns an operand into its description. An operand the compiler
// described is returned as it is; any other is described by its dynamic
// type, through the lookups of the packages that registered one.
func describe(arg any) fmtrt.Arg {
	switch f := arg.(type) {
	case fmtrt.Arg:
		return f
	case nil:
		return fmtrt.Arg{K: fmtrt.KInterface}
	case bool:
		return fmtrt.Arg{K: fmtrt.KBool, T: "bool", B: f}
	case int:
		return fmtrt.Arg{K: fmtrt.KInt, T: "int", I: int64(f)}
	case int8:
		return fmtrt.Arg{K: fmtrt.KInt, T: "int8", Size: 8, I: int64(f)}
	case int16:
		return fmtrt.Arg{K: fmtrt.KInt, T: "int16", Size: 16, I: int64(f)}
	case int32:
		return fmtrt.Arg{K: fmtrt.KInt, T: "int32", Size: 32, I: int64(f)}
	case int64:
		return fmtrt.Arg{K: fmtrt.KInt, T: "int64", Size: 64, I: f}
	case uint:
		return fmtrt.Arg{K: fmtrt.KUint, T: "uint", U: uint64(f)}
	case uint8:
		return fmtrt.Arg{K: fmtrt.KUint, T: "uint8", Size: 8, U: uint64(f)}
	case uint16:
		return fmtrt.Arg{K: fmtrt.KUint, T: "uint16", Size: 16, U: uint64(f)}
	case uint32:
		return fmtrt.Arg{K: fmtrt.KUint, T: "uint32", Size: 32, U: uint64(f)}
	case uint64:
		return fmtrt.Arg{K: fmtrt.KUint, T: "uint64", Size: 64, U: f}
	case uintptr:
		return fmtrt.Arg{K: fmtrt.KUint, T: "uintptr", U: uint64(f)}
	case float32:
		return fmtrt.Arg{K: fmtrt.KFloat, T: "float32", Size: 32, R: float64(f)}
	case float64:
		return fmtrt.Arg{K: fmtrt.KFloat, T: "float64", Size: 64, R: f}
	case complex64:
		return fmtrt.Arg{K: fmtrt.KComplex, T: "complex64", Size: 64, R: float64(real(f)), Im: float64(imag(f))}
	case complex128:
		return fmtrt.Arg{K: fmtrt.KComplex, T: "complex128", Size: 128, R: real(f), Im: imag(f)}
	case string:
		return fmtrt.Arg{K: fmtrt.KString, T: "string", S: f}
	case []byte:
		return bytesArg(f, "[]uint8")
	}
	// A value with String, GoString or Error methods is formatted through
	// them for the verbs that call them; a verb that does not (%d) formats it
	// by its fields, which printDesc then asks the registered lookups for.
	e, isErr := arg.(error)
	s, isStr := arg.(Stringer)
	g, isGo := arg.(GoStringer)
	if isErr || isStr || isGo {
		a := fmtrt.Arg{K: fmtrt.KNone, V: arg}
		if isErr {
			a.Err = e
		}
		if isStr {
			a.Str = s
		}
		if isGo {
			a.GoStr = g
		}
		return a
	}
	if a, ok := fmtrt.Lookup(arg); ok {
		return a
	}
	return fmtrt.Arg{K: fmtrt.KNone, V: arg}
}

// bytesArg describes a []byte.
func bytesArg(b []byte, typ string) fmtrt.Arg {
	return fmtrt.Arg{
		K: fmtrt.KSlice, T: typ, Nil: b == nil, N: len(b), IsBytes: true, Bytes: b,
		Elem: func(i int) fmtrt.Arg {
			return fmtrt.Arg{K: fmtrt.KUint, T: "uint8", Size: 8, U: uint64(b[i])}
		},
	}
}

func (p *pp) doPrint(a []any) {
	prevString := false
	for argNum, arg := range a {
		d := describe(arg)
		isString := d.K == fmtrt.KString
		// Add a space between two non-string arguments.
		if argNum > 0 && !isString && !prevString {
			p.writeByte(' ')
		}
		p.printArg(d, 'v')
		prevString = isString
	}
}

// doPrintln is like doPrint but always adds a space between arguments
// and a newline after the last argument.
func (p *pp) doPrintln(a []any) {
	for argNum, arg := range a {
		if argNum > 0 {
			p.writeByte(' ')
		}
		p.printArg(describe(arg), 'v')
	}
	p.writeByte('\n')
}

func (p *pp) badVerb(verb rune, a fmtrt.Arg) {
	p.erroring = true
	p.writeString(percentBangString)
	p.writeRune(verb)
	p.writeByte('(')
	if a.K == fmtrt.KInterface && a.V == nil {
		p.writeString(nilAngleString)
	} else {
		p.writeString(a.T)
		p.writeByte('=')
		p.printDesc(a, 'v', 0, false)
	}
	p.writeByte(')')
	p.erroring = false
}

func (p *pp) fmtBool(v bool, verb rune, a fmtrt.Arg) {
	switch verb {
	case 't', 'v':
		p.fmt.fmtBoolean(v)
	default:
		p.badVerb(verb, a)
	}
}

// fmt0x64 formats a uint64 in hexadecimal and prefixes it with 0x or
// not, as requested, by temporarily setting the sharp flag.
func (p *pp) fmt0x64(v uint64, leading0x bool) {
	sharp := p.fmt.sharp
	p.fmt.sharp = leading0x
	p.fmt.fmtInteger(v, 16, unsigned, 'v', ldigits)
	p.fmt.sharp = sharp
}

// fmtInteger formats a signed or unsigned integer.
func (p *pp) fmtInteger(v uint64, isSigned bool, verb rune, a fmtrt.Arg) {
	switch verb {
	case 'v':
		if p.fmt.sharpV && !isSigned {
			p.fmt0x64(v, true)
		} else {
			p.fmt.fmtInteger(v, 10, isSigned, verb, ldigits)
		}
	case 'd':
		p.fmt.fmtInteger(v, 10, isSigned, verb, ldigits)
	case 'b':
		p.fmt.fmtInteger(v, 2, isSigned, verb, ldigits)
	case 'o', 'O':
		p.fmt.fmtInteger(v, 8, isSigned, verb, ldigits)
	case 'x':
		p.fmt.fmtInteger(v, 16, isSigned, verb, ldigits)
	case 'X':
		p.fmt.fmtInteger(v, 16, isSigned, verb, udigits)
	case 'c':
		p.fmt.fmtC(v)
	case 'q':
		p.fmt.fmtQc(v)
	case 'U':
		p.fmt.fmtUnicode(v)
	default:
		p.badVerb(verb, a)
	}
}

// fmtFloat formats a float. The format is the verb's default; the size is 32 or 64.
func (p *pp) fmtFloat(v float64, size int, verb rune, a fmtrt.Arg) {
	switch verb {
	case 'v':
		p.fmt.fmtFloat(v, size, 'g', -1)
	case 'b', 'g', 'G', 'x', 'X':
		p.fmt.fmtFloat(v, size, verb, -1)
	case 'f', 'e', 'E':
		p.fmt.fmtFloat(v, size, verb, 6)
	case 'F':
		p.fmt.fmtFloat(v, size, 'f', 6)
	default:
		p.badVerb(verb, a)
	}
}

// fmtComplex formats a complex number v with
// r = real(v) and j = imag(v) as (r+ji) using
// fmtFloat for r and j formatting.
func (p *pp) fmtComplex(re, im float64, size int, verb rune, a fmtrt.Arg) {
	// Make sure any unsupported verbs are found before the
	// calls to fmtFloat to not generate an incorrect error string.
	switch verb {
	case 'v', 'b', 'g', 'G', 'x', 'X', 'f', 'F', 'e', 'E':
		oldPlus := p.fmt.plus
		p.writeByte('(')
		p.fmtFloat(re, size/2, verb, a)
		// Imaginary part always has a sign.
		p.fmt.plus = true
		p.fmtFloat(im, size/2, verb, a)
		p.writeString("i)")
		p.fmt.plus = oldPlus
	default:
		p.badVerb(verb, a)
	}
}

func (p *pp) fmtString(v string, verb rune, a fmtrt.Arg) {
	switch verb {
	case 'v':
		if p.fmt.sharpV {
			p.fmt.fmtQ(v)
		} else {
			p.fmt.fmtS(v)
		}
	case 's':
		p.fmt.fmtS(v)
	case 'x':
		p.fmt.fmtSx(v, ldigits)
	case 'X':
		p.fmt.fmtSx(v, udigits)
	case 'q':
		p.fmt.fmtQ(v)
	default:
		p.badVerb(verb, a)
	}
}

func (p *pp) fmtBytes(v []byte, verb rune, a fmtrt.Arg) {
	switch verb {
	case 'v', 'd':
		if p.fmt.sharpV {
			p.writeString(a.T)
			if v == nil {
				p.writeString(nilParenString)
				return
			}
			p.writeByte('{')
			for i, c := range v {
				if i > 0 {
					p.writeString(commaSpaceString)
				}
				p.fmt0x64(uint64(c), true)
			}
			p.writeByte('}')
		} else {
			p.writeByte('[')
			for i, c := range v {
				if i > 0 {
					p.writeByte(' ')
				}
				p.fmt.fmtInteger(uint64(c), 10, unsigned, verb, ldigits)
			}
			p.writeByte(']')
		}
	case 's':
		p.fmt.fmtBs(v)
	case 'x':
		p.fmt.fmtBx(v, ldigits)
	case 'X':
		p.fmt.fmtBx(v, udigits)
	case 'q':
		p.fmt.fmtQ(string(v))
	default:
		p.printElems(a, verb, 0, false)
	}
}

func (p *pp) fmtPointer(a fmtrt.Arg, verb rune) {
	var u uint64
	switch a.K {
	case fmtrt.KChan, fmtrt.KFunc, fmtrt.KPtr, fmtrt.KUnsafePtr:
		if !a.Nil {
			u = fmtrt.ArgPtrID(a)
		}
	default:
		p.badVerb(verb, a)
		return
	}

	switch verb {
	case 'v':
		if p.fmt.sharpV {
			p.writeByte('(')
			p.writeString(a.T)
			p.writeString(")(")
			if u == 0 {
				p.writeString(nilString)
			} else {
				p.fmt0x64(u, true)
			}
			p.writeByte(')')
		} else {
			if u == 0 {
				p.fmt.padString(nilAngleString)
			} else {
				p.fmt0x64(u, !p.fmt.sharp)
			}
		}
	case 'p':
		p.fmt0x64(u, !p.fmt.sharp)
	case 'b', 'o', 'd', 'x', 'X':
		p.fmtInteger(u, unsigned, verb, a)
	default:
		p.badVerb(verb, a)
	}
}

// callMethod runs f, one of the String, GoString or Error methods of the
// operand, and writes the string it returns. A panic in the method is
// reported in the output; a nil receiver prints as <nil>.
func (p *pp) callMethod(a fmtrt.Arg, verb rune, method string, f func() string) {
	defer func() {
		if err := recover(); err != nil {
			// If it's a nil pointer, just say "<nil>". The likeliest causes are a
			// Stringer that fails to guard against nil or a nil pointer for a
			// value receiver, and in either case, "<nil>" is a nice result.
			if a.K == fmtrt.KPtr && a.Nil {
				p.writeString(nilAngleString)
				return
			}
			// Otherwise print a concise panic message. Most of the time the panic
			// value will print itself nicely.
			if p.panicking {
				// Nested panics; the recursion in printArg cannot succeed.
				panic(err)
			}

			oldFlags := p.fmt.saveFlags()
			// For this output we want default behavior.
			p.fmt.clearflags()

			p.writeString(percentBangString)
			p.writeRune(verb)
			p.writeString(panicString)
			p.writeString(method)
			p.writeString(" method: ")
			p.panicking = true
			p.printArg(describe(err), 'v')
			p.panicking = false
			p.writeByte(')')

			p.fmt.restoreFlags(oldFlags)
		}
	}()
	p.fmtString(f(), verb, a)
}

// handleMethods calls the String, GoString or Error method of the operand.
// A value reached through an unexported field (ro) answers only to Error:
// reflection cannot call its other methods.
func (p *pp) handleMethods(a fmtrt.Arg, verb rune, ro bool) (handled bool) {
	if p.erroring {
		return
	}
	// If we're doing Go syntax and the argument knows how to supply it, take care of it now.
	if p.fmt.sharpV {
		if a.GoStr != nil && !ro {
			handled = true
			p.callMethod(a, verb, "GoString", func() string { return a.GoStr.GoString() })
			return
		}
	} else {
		// If a string is acceptable according to the format, see if
		// the value satisfies one of the string-valued interfaces.
		// Println etc. set verb to %v, which is "stringable".
		switch verb {
		case 'v', 's', 'x', 'X', 'q':
			// Is it an error or Stringer?
			// The duplication in the bodies is necessary:
			// setting handled and deferring catchPanic
			// must happen before calling the method.
			if a.Err != nil {
				handled = true
				p.callMethod(a, verb, "Error", func() string { return a.Err.Error() })
				return
			}
			if a.Str != nil && !ro {
				handled = true
				p.callMethod(a, verb, "String", func() string { return a.Str.String() })
				return
			}
		}
	}
	return false
}

func (p *pp) printArg(a fmtrt.Arg, verb rune) {
	if a.K == fmtrt.KInterface && a.V == nil && a.T == "" {
		switch verb {
		case 'T', 'v':
			p.fmt.padString(nilAngleString)
		default:
			p.badVerb(verb, a)
		}
		return
	}

	// Special processing considerations.
	// %T (the value's type) and %p (its address) are special; we always do them first.
	switch verb {
	case 'T':
		p.fmt.fmtS(a.T)
		return
	case 'p':
		p.fmtPointer(a, 'p')
		return
	}
	p.printDesc(a, verb, 0, false)
}

// printDesc formats one described value. depth is how deeply it is nested in
// the operand: a pointer prints as the value it points to only at depth 0.
func (p *pp) printDesc(a fmtrt.Arg, verb rune, depth int, ro bool) {
	if a.K == fmtrt.KInterface {
		if a.V == nil {
			p.writeString(nilAngleString)
			return
		}
		p.printDesc(describe(a.V), verb, depth+1, ro)
		return
	}
	if p.handleMethods(a, verb, ro) {
		return
	}
	switch a.K {
	case fmtrt.KBool:
		p.fmtBool(a.B, verb, a)
	case fmtrt.KInt:
		p.fmtInteger(uint64(a.I), signed, verb, a)
	case fmtrt.KUint:
		p.fmtInteger(a.U, unsigned, verb, a)
	case fmtrt.KFloat:
		p.fmtFloat(a.R, a.Size, verb, a)
	case fmtrt.KComplex:
		p.fmtComplex(a.R, a.Im, a.Size, verb, a)
	case fmtrt.KString:
		p.fmtString(a.S, verb, a)
	case fmtrt.KMap:
		p.printMap(a, verb, depth, ro)
	case fmtrt.KStruct:
		p.printStruct(a, verb, depth, ro)
	case fmtrt.KArray, fmtrt.KSlice:
		if a.IsBytes {
			switch verb {
			case 's', 'q', 'x', 'X', 'v', 'd':
				p.fmtBytes(a.Bytes, verb, a)
				return
			}
		}
		p.printElems(a, verb, depth, ro)
	case fmtrt.KPtr:
		// pointer to array or slice or struct? ok at top level
		// but not embedded (avoid loops)
		if depth == 0 && !a.Nil && a.Inner != nil {
			p.writeByte('&')
			p.printDesc(a.Inner(), verb, depth+1, ro)
			return
		}
		p.fmtPointer(a, verb)
	case fmtrt.KChan, fmtrt.KFunc, fmtrt.KUnsafePtr:
		p.fmtPointer(a, verb)
	default:
		// A value whose methods did not apply: describe it by its fields.
		if a.K == fmtrt.KNone && a.V != nil && (a.Err != nil || a.Str != nil || a.GoStr != nil) {
			if d, ok := fmtrt.Lookup(a.V); ok {
				d.Err, d.Str, d.GoStr = a.Err, a.Str, a.GoStr
				p.printDesc(d, verb, depth, ro)
				return
			}
		}
		// A value of a type no generated description covers. What reaches
		// here is a nil func in an interface, which has no type to look up,
		// and prints as nil.
		if a.V == nil || verb == 'v' {
			p.writeString(nilAngleString)
			return
		}
		p.writeString(percentBangString)
		p.writeRune(verb)
		p.writeString("(unknown)")
	}
}

// isExported reports whether a field name is exported.
func isExported(name string) bool {
	return name != "" && name[0] >= 'A' && name[0] <= 'Z'
}

func (p *pp) printStruct(a fmtrt.Arg, verb rune, depth int, ro bool) {
	if p.fmt.sharpV {
		p.writeString(a.T)
	}
	p.writeByte('{')
	for i := 0; i < a.N; i++ {
		if i > 0 {
			if p.fmt.sharpV {
				p.writeString(commaSpaceString)
			} else {
				p.writeByte(' ')
			}
		}
		name, f := a.Field(i)
		if p.fmt.plusV || p.fmt.sharpV {
			if name != "" {
				p.writeString(name)
				p.writeByte(':')
			}
		}
		p.printDesc(f, verb, depth+1, ro || !isExported(name))
	}
	p.writeByte('}')
}

func (p *pp) printElems(a fmtrt.Arg, verb rune, depth int, ro bool) {
	if p.fmt.sharpV {
		p.writeString(a.T)
		if a.K == fmtrt.KSlice && a.Nil {
			p.writeString(nilParenString)
			return
		}
		p.writeByte('{')
		for i := 0; i < a.N; i++ {
			if i > 0 {
				p.writeString(commaSpaceString)
			}
			p.printDesc(a.Elem(i), verb, depth+1, ro)
		}
		p.writeByte('}')
		return
	}
	p.writeByte('[')
	for i := 0; i < a.N; i++ {
		if i > 0 {
			p.writeByte(' ')
		}
		p.printDesc(a.Elem(i), verb, depth+1, ro)
	}
	p.writeByte(']')
}

func (p *pp) printMap(a fmtrt.Arg, verb rune, depth int, ro bool) {
	if p.fmt.sharpV {
		p.writeString(a.T)
		if a.Nil {
			p.writeString(nilParenString)
			return
		}
		p.writeByte('{')
	} else {
		p.writeString(mapString)
	}
	entries := sortedEntries(a.Entries())
	for i, e := range entries {
		if i > 0 {
			if p.fmt.sharpV {
				p.writeString(commaSpaceString)
			} else {
				p.writeByte(' ')
			}
		}
		p.printDesc(e.Key, verb, depth+1, ro)
		p.writeByte(':')
		p.printDesc(e.Val, verb, depth+1, ro)
	}
	if p.fmt.sharpV {
		p.writeByte('}')
	} else {
		p.writeByte(']')
	}
}

// sortedEntries orders map entries like internal/fmtsort: by key, with
// structs and arrays compared field by field.
func sortedEntries(es []fmtrt.Entry) []fmtrt.Entry {
	if len(es) < 2 {
		return es
	}
	slices.SortStableFunc(es, func(a, b fmtrt.Entry) int {
		return compareArgs(a.Key, b.Key)
	})
	return es
}

func compareInt(a, b int64) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func compareUint(a, b uint64) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func compareFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	case a == b:
		return 0
	}
	// NaN compares less than non-NaN floats.
	switch {
	case a != a && b != b:
		return 0
	case a != a:
		return -1
	}
	return 1
}

// compareArgs is the order fmt prints map keys in.
func compareArgs(a, b fmtrt.Arg) int {
	if a.K == fmtrt.KInterface || b.K == fmtrt.KInterface {
		// nil sorts before everything else.
		if a.V == nil || b.V == nil {
			return compareInt(boolInt(a.V != nil), boolInt(b.V != nil))
		}
		x, y := describe(a.V), describe(b.V)
		if x.T != y.T {
			// Values of different types: the order of Go's type descriptors,
			// which this mirrors for the common cases, a named type before its
			// underlying type and strings before numbers.
			if x.K != y.K {
				return compareInt(int64(y.K), int64(x.K))
			}
			if x.T < y.T {
				return -1
			}
			return 1
		}
		return compareArgs(x, y)
	}
	if a.K != b.K {
		return compareInt(int64(a.K), int64(b.K))
	}
	switch a.K {
	case fmtrt.KBool:
		return compareInt(boolInt(a.B), boolInt(b.B))
	case fmtrt.KInt:
		return compareInt(a.I, b.I)
	case fmtrt.KUint:
		return compareUint(a.U, b.U)
	case fmtrt.KFloat:
		return compareFloat(a.R, b.R)
	case fmtrt.KComplex:
		if c := compareFloat(a.R, b.R); c != 0 {
			return c
		}
		return compareFloat(a.Im, b.Im)
	case fmtrt.KString:
		if a.S < b.S {
			return -1
		}
		if a.S > b.S {
			return 1
		}
		return 0
	case fmtrt.KPtr, fmtrt.KChan, fmtrt.KUnsafePtr:
		return compareUint(fmtrt.ArgPtrID(a), fmtrt.ArgPtrID(b))
	case fmtrt.KStruct:
		for i := 0; i < a.N; i++ {
			_, x := a.Field(i)
			_, y := b.Field(i)
			if c := compareArgs(x, y); c != 0 {
				return c
			}
		}
	case fmtrt.KArray:
		for i := 0; i < a.N; i++ {
			if c := compareArgs(a.Elem(i), b.Elem(i)); c != 0 {
				return c
			}
		}
	}
	return 0
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
