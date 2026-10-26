package main

import (
	"fmt"
	"log"
	"os"
)

// sink collects what the loggers write. A bytes.Buffer cannot stand in: on
// JavaScript it has no methods once it is converted to an io.Writer.
type sink struct{ buf []byte }

func (s *sink) Write(p []byte) (int, error) {
	s.buf = append(s.buf, p...)
	return len(p), nil
}

func (s *sink) String() string { return string(s.buf) }
func (s *sink) Reset()         { s.buf = s.buf[:0] }
func (s *sink) Len() int       { return len(s.buf) }

func main() {
	var buf sink
	l := log.New(&buf, "", 0)
	l.Print("hello", 1, 2, "x", "y")
	l.Printf("n=%d s=%q", 42, "q")
	l.Println("a", "b", 3)
	l.Print("already newline\n")
	fmt.Print(buf.String())
	fmt.Println(l.Flags(), l.Prefix() == "", l.Writer() == &buf)

	buf.Reset()
	l.SetPrefix("[app] ")
	l.Println("with prefix")
	l.SetFlags(log.Lmsgprefix)
	l.Println("msgprefix")
	fmt.Print(buf.String())
	fmt.Printf("%d %q\n", l.Flags(), l.Prefix())

	// Date and time depend on the clock; check their shape only.
	buf.Reset()
	l.SetPrefix("")
	l.SetFlags(log.LstdFlags | log.LUTC)
	l.Print("stamped")
	s := buf.String()
	fmt.Println(len(s), s[4], s[7], s[10], s[13], s[16], s[19], s[len(s)-8:])
	buf.Reset()
	l.SetFlags(log.Ltime | log.Lmicroseconds)
	l.Print("micro")
	s = buf.String()
	fmt.Println(len(s), s[2], s[5], s[8], s[len(s)-6:])

	// Standard logger.
	log.SetOutput(&buf)
	buf.Reset()
	log.SetFlags(0)
	log.SetPrefix("std: ")
	log.Print("one")
	log.Printf("two %d", 2)
	log.Println("three")
	fmt.Print(buf.String())
	fmt.Printf("%d %q %v %q\n", log.Flags(), log.Prefix(), log.Writer() == &buf, log.Default().Prefix())
	log.SetOutput(os.Stderr)

	buf.Reset()
	func() {
		defer func() { fmt.Printf("recovered: %v\n", recover()) }()
		l.SetPrefix("")
		l.SetFlags(0)
		l.Panicf("bad %d", 7)
	}()
	func() {
		defer func() { fmt.Printf("recovered: %v\n", recover()) }()
		log.SetOutput(&buf)
		log.Panicln("std", "panic")
	}()
	fmt.Print(buf.String())
	fmt.Println(l.Output(1, "direct"), buf.Len())
}
