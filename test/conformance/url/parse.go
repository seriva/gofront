package main

import (
	"errors"
	"fmt"
	"net/url"
)

func main() {
	// 1. Basic URL parsing
	raw := "https://alice:secret123@example.com:8443/my%20path/sub?lang=en&v=2#details"
	u, err := url.Parse(raw)
	if err != nil {
		fmt.Printf("Parse err: %v\n", err)
		return
	}
	fmt.Printf("Scheme: %s\n", u.Scheme)
	fmt.Printf("Host: %s\n", u.Host)
	fmt.Printf("Hostname: %s\n", u.Hostname())
	fmt.Printf("Port: %s\n", u.Port())
	fmt.Printf("Path: %s\n", u.Path)
	fmt.Printf("EscapedPath: %s\n", u.EscapedPath())
	fmt.Printf("RawQuery: %s\n", u.RawQuery)
	fmt.Printf("Fragment: %s\n", u.Fragment)
	fmt.Printf("Query lang: %s\n", u.Query().Get("lang"))
	fmt.Printf("IsAbs: %v\n", u.IsAbs())
	fmt.Printf("String: %s\n", u.String())
	fmt.Printf("Redacted: %s\n", u.Redacted())

	// Userinfo methods
	if u.User != nil {
		pass, hasPass := u.User.Password()
		fmt.Printf("User Username: %s, pass: %s, hasPass: %v\n", u.User.Username(), pass, hasPass)
		fmt.Printf("User String: %s\n", u.User.String())
	}

	// 2. IPv6 Host and Port
	rawIPv6 := "http://[2001:db8::1]:8080/status"
	u6, err := url.Parse(rawIPv6)
	fmt.Printf("IPv6 err: %v\n", err)
	fmt.Printf("IPv6 Host: %s\n", u6.Host)
	fmt.Printf("IPv6 Hostname: %s\n", u6.Hostname())
	fmt.Printf("IPv6 Port: %s\n", u6.Port())
	fmt.Printf("IPv6 String: %s\n", u6.String())

	u6Bare, _ := url.Parse("http://[::1]/status")
	fmt.Printf("IPv6 bare Hostname: %s, Port: %q\n", u6Bare.Hostname(), u6Bare.Port())

	// 3. ResolveReference
	base, _ := url.Parse("http://example.com/dir/file")
	ref1, _ := url.Parse("extra")
	fmt.Printf("Resolve extra: %s\n", base.ResolveReference(ref1).String())

	ref2, _ := url.Parse("/root")
	fmt.Printf("Resolve root: %s\n", base.ResolveReference(ref2).String())

	ref3, _ := url.Parse("../sibling")
	fmt.Printf("Resolve sibling: %s\n", base.ResolveReference(ref3).String())

	ref4, _ := url.Parse("https://other.org/secure")
	fmt.Printf("Resolve absolute: %s\n", base.ResolveReference(ref4).String())

	// 4. RequestURI
	fmt.Printf("RequestURI: %s\n", u.RequestURI())

	// 5. JoinPath
	joined, err := url.JoinPath("https://example.com/base/", "sub1", "sub2/")
	fmt.Printf("JoinPath err: %v, out: %s\n", err, joined)

	uJoined := base.JoinPath("child", "leaf")
	fmt.Printf("URL.JoinPath: %s\n", uJoined.String())

	// 6. ParseRequestURI
	reqU, err := url.ParseRequestURI("/api/v1?test=ok")
	fmt.Printf("ParseRequestURI err: %v, path: %s, query: %s\n", err, reqU.Path, reqU.RawQuery)

	_, errReqRel := url.ParseRequestURI("relative/path")
	fmt.Printf("ParseRequestURI relative err: %v\n", errReqRel != nil)

	// 7. Error handling & *url.Error
	_, errBad := url.Parse("http://example.com/%ZZ")
	var urlErr *url.Error
	if errors.As(errBad, &urlErr) {
		fmt.Printf("url.Error Op: %s, URL: %s, Unwrap: %v\n", urlErr.Op, urlErr.URL, urlErr.Unwrap())
	}
}
