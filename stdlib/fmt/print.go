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
	"unicode/utf8"
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
	fmt fmtState

	// erroring is set when printing an error string to guard against calling handleMethods.
	erroring bool
	// panicking is set by catchPanic to avoid infinite panic, recover, panic, ... recursion.
	panicking bool
	// wrapErrs is set by Errorf: %w is valid only there.
	wrapErrs bool
	// reordered records whether the format used an explicit argument index.
	reordered bool
	// goodArgNum records whether the current verb's argument index was valid.
	goodArgNum bool
	// wrappedErrs holds the argument numbers of the %w verbs.
	wrappedErrs []int
}

func newPrinter() *pp {
	p := &pp{}
	p.fmt.buf = make([]byte, 64)
	return p
}

func (p *pp) writeString(s string) {
	p.fmt.putString(s)
}

func (p *pp) writeByte(c byte) {
	p.fmt.putByte(c)
}

func (p *pp) writeRune(r rune) {
	if r >= 0 && r < 0x80 {
		p.fmt.putByte(byte(r))
		return
	}
	p.fmt.putString(string(r))
}

// Fprintf formats according to a format specifier and writes to w.
func Fprintf(w io.Writer, format string, a ...any) (n int, err error) {
	p := newPrinter()
	p.doPrintf(format, a)
	n, err = w.Write(p.fmt.bytes())
	return
}

// Printf formats according to a format specifier and writes to standard output.
func Printf(format string, a ...any) (n int, err error) {
	return Fprintf(os.Stdout, format, a...)
}

// Sprintf formats according to a format specifier and returns the resulting string.
func Sprintf(format string, a ...any) string {
	p := newPrinter()
	p.doPrintf(format, a)
	return string(p.fmt.bytes())
}

// Appendf formats according to a format specifier, appends the result to the
// byte slice, and returns the updated slice.
func Appendf(b []byte, format string, a ...any) []byte {
	p := newPrinter()
	p.doPrintf(format, a)
	return append(b, p.fmt.bytes()...)
}

// Fprint formats using the default formats for its operands and writes to w.
// Spaces are added between operands when neither is a string.
func Fprint(w io.Writer, a ...any) (n int, err error) {
	p := newPrinter()
	p.doPrint(a)
	n, err = w.Write(p.fmt.bytes())
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
	return string(p.fmt.bytes())
}

// Append formats using the default formats for its operands, appends the result to
// the byte slice, and returns the updated slice.
func Append(b []byte, a ...any) []byte {
	p := newPrinter()
	p.doPrint(a)
	return append(b, p.fmt.bytes()...)
}

// Fprintln formats using the default formats for its operands and writes to w.
// Spaces are always added between operands and a newline is appended.
func Fprintln(w io.Writer, a ...any) (n int, err error) {
	p := newPrinter()
	p.doPrintln(a)
	n, err = w.Write(p.fmt.bytes())
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
	return string(p.fmt.bytes())
}

// Appendln formats using the default formats for its operands, appends the result
// to the byte slice, and returns the updated slice.
func Appendln(b []byte, a ...any) []byte {
	p := newPrinter()
	p.doPrintln(a)
	return append(b, p.fmt.bytes()...)
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
	// float64 first: on JS a float32 and a float64 are the same number, and a
	// float32 that reaches here without its description is far rarer.
	case float64:
		return fmtrt.Arg{K: fmtrt.KFloat, T: "float64", Size: 64, R: f}
	case float32:
		return fmtrt.Arg{K: fmtrt.KFloat, T: "float32", Size: 32, R: float64(f)}
	case complex128:
		return fmtrt.Arg{K: fmtrt.KComplex, T: "complex128", Size: 128, R: real(f), Im: imag(f)}
	case complex64:
		return fmtrt.Arg{K: fmtrt.KComplex, T: "complex64", Size: 64, R: float64(real(f)), Im: float64(imag(f))}
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

// typeName is the type %T prints: the one the operand was described with, else
// the one a registered lookup gives its value, else the one a value of the
// standard library names itself.
func typeName(a fmtrt.Arg) string {
	if a.T != "" || a.V == nil {
		return a.T
	}
	if d, ok := fmtrt.Lookup(a.V); ok && d.T != "" {
		return d.T
	}
	if n, ok := a.V.(interface{ GofrontTypeName() string }); ok {
		return n.GofrontTypeName()
	}
	return ""
}

// bytesArg describes a []byte.
func bytesArg(b []byte, typ string) fmtrt.Arg {
	return fmtrt.Arg{
		K: fmtrt.KSlice, T: typ, Nil: b == nil, Ptr: b, N: len(b), IsBytes: true, Bytes: b,
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
		p.writeString(typeName(a))
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
	case fmtrt.KChan, fmtrt.KFunc, fmtrt.KPtr, fmtrt.KUnsafePtr, fmtrt.KMap, fmtrt.KSlice:
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
	if method == "GoString" {
		p.fmt.fmtS(f())
		return
	}
	p.fmtString(f(), verb, a)
}

// handleMethods calls the String, GoString or Error method of the operand.
// A value reached through an unexported field (ro) answers only to Error:
// reflection cannot call its other methods.
func (p *pp) handleMethods(a fmtrt.Arg, verb rune, ro bool) (handled bool) {
	if p.erroring {
		return
	}
	if verb == 'w' {
		// It is invalid to use %w other than with Errorf or with a non-error arg.
		if a.Err == nil || !p.wrapErrs {
			p.badVerb(verb, a)
			return true
		}
		// Format the error as %v.
		verb = 'v'
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
		p.fmt.fmtS(typeName(a))
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
		// An operand held in an interface at the top level is the operand
		// itself: Go's printArg reflects on its dynamic value.
		if depth > 0 {
			depth++
		}
		p.printDesc(describe(a.V), verb, depth, ro)
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
		// The error errors.New returns is a pointer to a struct of a package
		// that fmt cannot spell: it prints itself.
		if f, ok := a.V.(interface{ GofrontFmt(rune) string }); ok && depth == 0 {
			p.writeString(f.GofrontFmt(verb))
			return
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
	return mergeEntries(es, make([]fmtrt.Entry, len(es)))
}

// mergeEntries is a stable merge sort of es using tmp as scratch space.  It
// keeps fmt from importing slices, whose source every fmt user would
// otherwise have to parse and check.
func mergeEntries(es, tmp []fmtrt.Entry) []fmtrt.Entry {
	if len(es) < 2 {
		return es
	}
	mid := len(es) / 2
	left := mergeEntries(es[:mid], tmp[:mid])
	right := mergeEntries(es[mid:], tmp[mid:])
	i, j, k := 0, 0, 0
	for i < len(left) && j < len(right) {
		if compareArgs(right[j].Key, left[i].Key) < 0 {
			tmp[k] = right[j]
			j++
		} else {
			tmp[k] = left[i]
			i++
		}
		k++
	}
	for i < len(left) {
		tmp[k] = left[i]
		i++
		k++
	}
	for j < len(right) {
		tmp[k] = right[j]
		j++
		k++
	}
	copy(es, tmp[:k])
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

// tooLarge reports whether the magnitude of the integer is
// too large to be used as a formatting width or precision.
func tooLarge(x int) bool {
	const max int = 1e6
	return x > max || x < -max
}

// parsenum converts ASCII to integer.  num is 0 (and isnum is false) if no number present.
func parsenum(s string, start, end int) (num int, isnum bool, newi int) {
	if start >= end {
		return 0, false, end
	}
	for newi = start; newi < end && '0' <= s[newi] && s[newi] <= '9'; newi++ {
		if tooLarge(num) {
			return 0, false, end // Overflow; crazy long number most likely.
		}
		num = num*10 + int(s[newi]-'0')
		isnum = true
	}
	return
}

// intFromArg reads the integer operand of a * width or precision.
func intFromArg(a []any, argNum int) (num int, isInt bool, newArgNum int) {
	newArgNum = argNum
	if argNum < len(a) {
		d := describe(a[argNum])
		switch d.K {
		case fmtrt.KInt:
			if int64(int(d.I)) == d.I {
				num = int(d.I)
				isInt = true
			}
		case fmtrt.KUint:
			if int64(d.U) >= 0 && uint64(int(d.U)) == d.U {
				num = int(d.U)
				isInt = true
			}
		}
		newArgNum = argNum + 1
		if tooLarge(num) {
			num = 0
			isInt = false
		}
	}
	return
}

// parseArgNumber returns the value of the bracketed number, minus 1
// (explicit argument numbers are one-indexed but we want zero-indexed).
// The opening bracket is known to be present at format[0].
// The returned values are the index, the number of bytes to consume
// up to the closing paren, if present, and whether the number parsed
// ok. The bytes to consume will be 1 if no closing paren is present.
func parseArgNumber(format string) (index int, wid int, ok bool) {
	// There must be at least 3 bytes: [n].
	if len(format) < 3 {
		return 0, 1, false
	}

	// Find closing bracket.
	for i := 1; i < len(format); i++ {
		if format[i] == ']' {
			width, ok, newi := parsenum(format, 1, i)
			if !ok || newi != i {
				return 0, i + 1, false
			}
			return width - 1, i + 1, true // arg numbers are one-indexed and skip paren.
		}
	}
	return 0, 1, false
}

// argNumber returns the next argument to evaluate, which is either the value of the passed-in
// argNum or the value of the bracketed integer that begins format[i:]. It also returns
// the new value of i, that is, the index of the next byte of the format to process.
func (p *pp) argNumber(argNum int, format string, i int, numArgs int) (newArgNum, newi int, found bool) {
	if len(format) <= i || format[i] != '[' {
		return argNum, i, false
	}
	p.reordered = true
	index, wid, ok := parseArgNumber(format[i:])
	if ok && 0 <= index && index < numArgs {
		return index, i + wid, true
	}
	p.goodArgNum = false
	return argNum, i + wid, ok
}

func (p *pp) badArgNum(verb rune) {
	p.writeString(percentBangString)
	p.writeRune(verb)
	p.writeString(badIndexString)
}

func (p *pp) missingArg(verb rune) {
	p.writeString(percentBangString)
	p.writeRune(verb)
	p.writeString(missingString)
}

func (p *pp) doPrintf(format string, a []any) {
	end := len(format)
	argNum := 0         // we process one argument per non-trivial format
	afterIndex := false // previous item in format was an index like [3].
	p.reordered = false
formatLoop:
	for i := 0; i < end; {
		p.goodArgNum = true
		lasti := i
		for i < end && format[i] != '%' {
			i++
		}
		if i > lasti {
			p.writeString(format[lasti:i])
		}
		if i >= end {
			// done processing format string
			break
		}

		// Process one verb
		i++

		// Do we have flags?
		p.fmt.clearflags()
	simpleFormat:
		for ; i < end; i++ {
			c := format[i]
			switch c {
			case '#':
				p.fmt.sharp = true
			case '0':
				p.fmt.zero = true
			case '+':
				p.fmt.plus = true
			case '-':
				p.fmt.minus = true
			case ' ':
				p.fmt.space = true
			default:
				// Fast path for common case of ascii lower case simple verbs
				// without precision or width or argument indices.
				if 'a' <= c && c <= 'z' && argNum < len(a) {
					switch c {
					case 'w':
						p.wrappedErrs = append(p.wrappedErrs, argNum)
						fallthrough
					case 'v':
						// Go syntax
						p.fmt.sharpV = p.fmt.sharp
						p.fmt.sharp = false
						// Struct-field syntax
						p.fmt.plusV = p.fmt.plus
						p.fmt.plus = false
					}
					p.printArg(describe(a[argNum]), rune(c))
					argNum++
					i++
					continue formatLoop
				}
				// Format is more complex than simple flags and a verb or is malformed.
				break simpleFormat
			}
		}

		// Do we have an explicit argument index?
		argNum, i, afterIndex = p.argNumber(argNum, format, i, len(a))

		// Do we have width?
		if i < end && format[i] == '*' {
			i++
			p.fmt.wid, p.fmt.widPresent, argNum = intFromArg(a, argNum)

			if !p.fmt.widPresent {
				p.writeString(badWidthString)
			}

			// We have a negative width, so take its value and ensure
			// that the minus flag is set
			if p.fmt.wid < 0 {
				p.fmt.wid = -p.fmt.wid
				p.fmt.minus = true
				p.fmt.zero = false // Do not pad with zeros to the right.
			}
			afterIndex = false
		} else {
			p.fmt.wid, p.fmt.widPresent, i = parsenum(format, i, end)
			if afterIndex && p.fmt.widPresent { // "%[3]2d"
				p.goodArgNum = false
			}
		}

		// Do we have precision?
		if i+1 <= end && format[i] == '.' {
			i++
			if afterIndex { // "%[3].2d"
				p.goodArgNum = false
			}
			argNum, i, afterIndex = p.argNumber(argNum, format, i, len(a))
			if i < end && format[i] == '*' {
				i++
				p.fmt.prec, p.fmt.precPresent, argNum = intFromArg(a, argNum)
				// Negative precision arguments don't make sense
				if p.fmt.prec < 0 {
					p.fmt.prec = 0
					p.fmt.precPresent = false
				}
				if !p.fmt.precPresent {
					p.writeString(badPrecString)
				}
				afterIndex = false
			} else {
				p.fmt.prec, p.fmt.precPresent, i = parsenum(format, i, end)
				if !p.fmt.precPresent {
					p.fmt.prec = 0
					p.fmt.precPresent = true
				}
			}
		}

		if !afterIndex {
			argNum, i, afterIndex = p.argNumber(argNum, format, i, len(a))
		}

		if i >= end {
			p.writeString(noVerbString)
			break
		}

		verb, size := rune(format[i]), 1
		if verb >= utf8.RuneSelf {
			verb, size = utf8.DecodeRuneInString(format[i:])
		}
		i += size

		switch {
		case verb == '%': // Percent does not absorb operands and ignores f.wid and f.prec.
			p.writeByte('%')
		case !p.goodArgNum:
			p.badArgNum(verb)
		case argNum >= len(a): // No argument left over to print for the current verb.
			p.missingArg(verb)
		case verb == 'w':
			p.wrappedErrs = append(p.wrappedErrs, argNum)
			fallthrough
		case verb == 'v':
			// Go syntax
			p.fmt.sharpV = p.fmt.sharp
			p.fmt.sharp = false
			// Struct-field syntax
			p.fmt.plusV = p.fmt.plus
			p.fmt.plus = false
			fallthrough
		default:
			p.printArg(describe(a[argNum]), verb)
			argNum++
		}
	}

	// Check for extra arguments unless the call accessed the arguments
	// out of order, in which case it's too expensive to detect if they've all
	// been used and arguably OK if they're not.
	if !p.reordered && argNum < len(a) {
		p.fmt.clearflags()
		p.writeString(extraString)
		for i, arg := range a[argNum:] {
			if i > 0 {
				p.writeString(commaSpaceString)
			}
			if arg == nil {
				p.writeString(nilAngleString)
			} else {
				d := describe(arg)
				p.writeString(d.T)
				p.writeByte('=')
				p.printArg(d, 'v')
			}
		}
		p.writeByte(')')
	}
}
