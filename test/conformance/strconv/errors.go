package main

import (
	"errors"
	"fmt"
	"strconv"
)

func testAtoiErrors() {
	_, err := strconv.Atoi("123")
	fmt.Printf("Atoi valid err: %v\n", err)

	_, err = strconv.Atoi("abc")
	var numErr *strconv.NumError
	asNumErr := errors.As(err, &numErr)
	fmt.Printf("Atoi invalid: isSyntax=%v isRange=%v isUnsupported=%v asNumErr=%v\n",
		errors.Is(err, strconv.ErrSyntax),
		errors.Is(err, strconv.ErrRange),
		errors.Is(err, errors.ErrUnsupported),
		asNumErr,
	)
	if asNumErr {
		fmt.Printf("NumError fields: Func=%s Num=%s isErrSyntax=%v\n",
			numErr.Func, numErr.Num, errors.Is(numErr.Err, strconv.ErrSyntax))
	}
	fmt.Printf("Error string: %s\n", err.Error())

	_, err = strconv.Atoi("9999999999999999999999999999999999")
	fmt.Printf("Atoi range: isSyntax=%v isRange=%v\n",
		errors.Is(err, strconv.ErrSyntax),
		errors.Is(err, strconv.ErrRange),
	)
}

func testParseIntErrors() {
	_, err := strconv.ParseInt("xyz", 10, 64)
	fmt.Printf("ParseInt syntax: isSyntax=%v isRange=%v\n",
		errors.Is(err, strconv.ErrSyntax),
		errors.Is(err, strconv.ErrRange),
	)

	_, err = strconv.ParseInt("200", 10, 8)
	var numErr *strconv.NumError
	asNumErr := errors.As(err, &numErr)
	fmt.Printf("ParseInt range: isSyntax=%v isRange=%v asNumErr=%v Func=%s\n",
		errors.Is(err, strconv.ErrSyntax),
		errors.Is(err, strconv.ErrRange),
		asNumErr,
		numErr.Func,
	)
}

func testParseUintAndFloatAndBool() {
	_, err := strconv.ParseUint("300", 10, 8)
	fmt.Printf("ParseUint range: isSyntax=%v isRange=%v\n",
		errors.Is(err, strconv.ErrSyntax),
		errors.Is(err, strconv.ErrRange),
	)

	_, err = strconv.ParseFloat("notafloat", 64)
	fmt.Printf("ParseFloat syntax: isSyntax=%v isRange=%v\n",
		errors.Is(err, strconv.ErrSyntax),
		errors.Is(err, strconv.ErrRange),
	)

	_, err = strconv.ParseBool("maybe")
	fmt.Printf("ParseBool syntax: isSyntax=%v isRange=%v\n",
		errors.Is(err, strconv.ErrSyntax),
		errors.Is(err, strconv.ErrRange),
	)

	fmt.Printf("ErrUnsupported: isSelf=%v\n", errors.Is(errors.ErrUnsupported, errors.ErrUnsupported))
}

func testQuoting() {
	fmt.Printf("QuoteRune: %s %s %s\n",
		strconv.QuoteRune('a'),
		strconv.QuoteRune('\n'),
		strconv.QuoteRune('世'),
	)

	fmt.Printf("QuoteToASCII: %s\n", strconv.QuoteToASCII("hello 世界\n"))
	fmt.Printf("QuoteRuneToASCII: %s\n", strconv.QuoteRuneToASCII('世'))

	b := strconv.AppendQuote(nil, "abc")
	b = append(b, ' ')
	b = strconv.AppendQuoteToASCII(b, "世界")
	b = append(b, ' ')
	b = strconv.AppendQuoteRune(b, '\U0001F680')
	b = append(b, ' ')
	b = strconv.AppendQuoteRuneToASCII(b, '\U0001F680')
	fmt.Printf("Appends: %s\n", string(b))

	fmt.Printf("CanBackquote: %v %v %v\n",
		strconv.CanBackquote("hello world\t"),
		strconv.CanBackquote("hello\nworld"),
		strconv.CanBackquote("hello`world"),
	)

	v, mb, tail, err := strconv.UnquoteChar(`\n`, 0)
	fmt.Printf("UnquoteChar \\n: val=%U mb=%v tail=%q err=%v\n", v, mb, tail, err)

	v, mb, tail, err = strconv.UnquoteChar("abc", 0)
	fmt.Printf("UnquoteChar abc: val=%U mb=%v tail=%q err=%v\n", v, mb, tail, err)

	v, mb, tail, err = strconv.UnquoteChar(`\u4e16`, 0)
	fmt.Printf("UnquoteChar \\u4e16: val=%U mb=%v tail=%q err=%v\n", v, mb, tail, err)

	prefix, pErr := strconv.QuotedPrefix(`"hello" world`)
	fmt.Printf("QuotedPrefix: prefix=%q err=%v\n", prefix, pErr)

	fmt.Printf("IsPrint: a=%v newline=%v world=%v\n",
		strconv.IsPrint('a'),
		strconv.IsPrint('\n'),
		strconv.IsPrint('世'),
	)
}

func main() {
	testAtoiErrors()
	testParseIntErrors()
	testParseUintAndFloatAndBool()
	testQuoting()
}
