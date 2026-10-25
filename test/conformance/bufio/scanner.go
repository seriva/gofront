package main

import (
	"bufio"
	"errors"
	"fmt"
	"strings"
)

func main() {
	// 1. MaxScanTokenSize constant
	fmt.Printf("MaxScanTokenSize: %d\n", bufio.MaxScanTokenSize)

	// 2. ScanLines: newlines, CRLF, and final line without newline
	input := "line1\nline2\r\nline3 without newline"
	s := bufio.NewScanner(strings.NewReader(input))
	count := 0
	for s.Scan() {
		count++
		fmt.Printf("Line %d: %q (bytes=%d)\n", count, s.Text(), len(s.Bytes()))
	}
	fmt.Printf("ScanLines err: %v\n", s.Err())

	// 3. ScanWords
	inputWords := "  foo   bar\tbaz\nqux  "
	sWords := bufio.NewScanner(strings.NewReader(inputWords))
	sWords.Split(bufio.ScanWords)
	for sWords.Scan() {
		fmt.Printf("Word: %q\n", sWords.Text())
	}
	fmt.Printf("ScanWords err: %v\n", sWords.Err())

	// 4. ScanBytes
	inputBytes := "abc"
	sBytes := bufio.NewScanner(strings.NewReader(inputBytes))
	sBytes.Split(bufio.ScanBytes)
	for sBytes.Scan() {
		fmt.Printf("Byte: %q\n", sBytes.Bytes())
	}
	fmt.Printf("ScanBytes err: %v\n", sBytes.Err())

	// 5. ScanRunes
	inputRunes := "a世b"
	sRunes := bufio.NewScanner(strings.NewReader(inputRunes))
	sRunes.Split(bufio.ScanRunes)
	for sRunes.Scan() {
		fmt.Printf("Rune: %q\n", sRunes.Text())
	}
	fmt.Printf("ScanRunes err: %v\n", sRunes.Err())

	// 6. ErrFinalToken
	inputFinal := "one,two,STOP,three"
	sFinal := bufio.NewScanner(strings.NewReader(inputFinal))
	sFinal.Split(func(data []byte, atEOF bool) (advance int, token []byte, err error) {
		for i := 0; i < len(data); i++ {
			if data[i] == ',' {
				tok := data[:i]
				if string(tok) == "STOP" {
					return i + 1, tok, bufio.ErrFinalToken
				}
				return i + 1, tok, nil
			}
		}
		if atEOF && len(data) > 0 {
			return len(data), data, nil
		}
		return 0, nil, nil
	})
	for sFinal.Scan() {
		fmt.Printf("FinalToken scan: %q\n", sFinal.Text())
	}
	fmt.Printf("FinalToken err: %v\n", sFinal.Err())

	// 7. ErrTooLong via small buffer
	inputLong := "this line is way too long for a 10 byte buffer"
	sLong := bufio.NewScanner(strings.NewReader(inputLong))
	buf := make([]byte, 5)
	sLong.Buffer(buf, 10)
	for sLong.Scan() {
		fmt.Printf("Long scan: %q\n", sLong.Text())
	}
	fmt.Printf("ErrTooLong is: %v (match=%v)\n", sLong.Err(), errors.Is(sLong.Err(), bufio.ErrTooLong))

	// 8. ErrNegativeAdvance
	sNeg := bufio.NewScanner(strings.NewReader("hello"))
	sNeg.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		return -1, nil, nil
	})
	sNeg.Scan()
	fmt.Printf("ErrNegativeAdvance match: %v\n", errors.Is(sNeg.Err(), bufio.ErrNegativeAdvance))

	// 9. ErrAdvanceTooFar
	sFar := bufio.NewScanner(strings.NewReader("hello"))
	sFar.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		return len(data) + 10, nil, nil
	})
	sFar.Scan()
	fmt.Printf("ErrAdvanceTooFar match: %v\n", errors.Is(sFar.Err(), bufio.ErrAdvanceTooFar))
}
