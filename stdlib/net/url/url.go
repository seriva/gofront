//go:build gofront
//gofront:target both

package url

import (
	"bytes"
	"errors"
	"fmt"
	"path"
	"strings"
)

type Error struct {
	Op  string
	URL string
	Err error
}

func (e *Error) Unwrap() error { return e.Err }
func (e *Error) Error() string { return fmt.Sprintf("%s %q: %s", e.Op, e.URL, e.Err) }

func (e *Error) Timeout() bool {
	t, ok := e.Err.(interface {
		Timeout() bool
	})
	return ok && t.Timeout()
}

func (e *Error) Temporary() bool {
	t, ok := e.Err.(interface {
		Temporary() bool
	})
	return ok && t.Temporary()
}

type Userinfo struct {
	username    string
	password    string
	passwordSet bool
}

func User(username string) *Userinfo {
	return &Userinfo{username: username}
}

func UserPassword(username, password string) *Userinfo {
	return &Userinfo{username: username, password: password, passwordSet: true}
}

func (u *Userinfo) Username() string {
	if u == nil {
		return ""
	}
	return u.username
}

func (u *Userinfo) Password() (string, bool) {
	if u == nil {
		return "", false
	}
	return u.password, u.passwordSet
}

func (u *Userinfo) String() string {
	if u == nil {
		return ""
	}
	s := escape(u.username, encodeUserPassword)
	if u.passwordSet {
		s += ":" + escape(u.password, encodeUserPassword)
	}
	return s
}

type URL struct {
	Scheme      string
	Opaque      string
	User        *Userinfo
	Host        string
	Path        string
	RawPath     string
	ForceQuery  bool
	RawQuery    string
	Fragment    string
	RawFragment string
	OmitHost    bool
}

func (u *URL) IsAbs() bool {
	return u.Scheme != ""
}

func (u *URL) Query() Values {
	v, _ := ParseQuery(u.RawQuery)
	return v
}

func (u *URL) Redacted() string {
	if u == nil {
		return ""
	}
	ru := *u
	if _, has := ru.User.Password(); has {
		ru.User = UserPassword(ru.User.Username(), "xxxxx")
	}
	return ru.String()
}

func (u *URL) Hostname() string {
	host, _ := splitHostPort(u.Host)
	return host
}

func (u *URL) Port() string {
	_, port := splitHostPort(u.Host)
	return port
}

func splitHostPort(hostPort string) (string, string) {
	host := hostPort
	colon := strings.LastIndexByte(host, ':')
	var port string
	if colon != -1 && validOptionalPort(host[colon:]) {
		host, port = host[:colon], host[colon+1:]
	}
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = host[1 : len(host)-1]
	}
	return host, port
}

func validOptionalPort(port string) bool {
	if port == "" {
		return true
	}
	if port[0] != ':' {
		return false
	}
	for i := 1; i < len(port); i++ {
		b := port[i]
		if b < '0' || b > '9' {
			return false
		}
	}
	return true
}

func (u *URL) setPath(p string) error {
	path, err := unescape(p, encodePath)
	if err != nil {
		return err
	}
	u.Path = path
	if escp := escape(path, encodePath); p == escp {
		u.RawPath = ""
	} else {
		u.RawPath = p
	}
	return nil
}

func (u *URL) EscapedPath() string {
	if u.RawPath != "" && validEncoded(u.RawPath, encodePath) {
		p, err := unescape(u.RawPath, encodePath)
		if err == nil && p == u.Path {
			return u.RawPath
		}
	}
	if u.Path == "*" {
		return "*"
	}
	return escape(u.Path, encodePath)
}

func (u *URL) setFragment(f string) error {
	frag, err := unescape(f, encodeFragment)
	if err != nil {
		return err
	}
	u.Fragment = frag
	if escf := escape(frag, encodeFragment); f == escf {
		u.RawFragment = ""
	} else {
		u.RawFragment = f
	}
	return nil
}

func (u *URL) EscapedFragment() string {
	if u.RawFragment != "" && validEncoded(u.RawFragment, encodeFragment) {
		f, err := unescape(u.RawFragment, encodeFragment)
		if err == nil && f == u.Fragment {
			return u.RawFragment
		}
	}
	return escape(u.Fragment, encodeFragment)
}

func validEncoded(s string, mode encoding) bool {
	b := []byte(s)
	for i := 0; i < len(b); i++ {
		c := b[i]
		switch c {
		case '!', '$', '&', '\'', '(', ')', '*', '+', ',', ';', '=', ':', '@':
		case '[', ']':
		case '%':
		default:
			if shouldEscape(c, mode) {
				return false
			}
		}
	}
	return true
}

func (u *URL) formatAuthority() string {
	if u.OmitHost && u.Host == "" && u.User == nil {
		return ""
	}
	var buf strings.Builder
	if u.Host != "" || u.Path != "" || u.User != nil {
		buf.WriteString("//")
	}
	if u.User != nil {
		buf.WriteString(u.User.String())
		buf.WriteByte('@')
	}
	if u.Host != "" {
		buf.WriteString(escape(u.Host, encodeHost))
	}
	return buf.String()
}

func (u *URL) String() string {
	var buf strings.Builder
	if u.Scheme != "" {
		buf.WriteString(u.Scheme)
		buf.WriteByte(':')
	}
	if u.Opaque != "" {
		buf.WriteString(u.Opaque)
	} else {
		if u.Scheme != "" || u.Host != "" || u.User != nil {
			buf.WriteString(u.formatAuthority())
		}
		path := u.EscapedPath()
		if path != "" && path[0] != '/' && u.Host != "" {
			buf.WriteByte('/')
		}
		if buf.Len() == 0 {
			if segment, _, _ := strings.Cut(path, "/"); strings.Contains(segment, ":") {
				buf.WriteString("./")
			}
		}
		buf.WriteString(path)
	}
	if u.ForceQuery || u.RawQuery != "" {
		buf.WriteByte('?')
		buf.WriteString(u.RawQuery)
	}
	if u.Fragment != "" {
		buf.WriteByte('#')
		buf.WriteString(u.EscapedFragment())
	}
	return buf.String()
}

func (u *URL) RequestURI() string {
	result := u.Opaque
	if result == "" {
		result = u.EscapedPath()
		if result == "" {
			result = "/"
		}
	} else if strings.HasPrefix(result, "//") {
		result = u.Scheme + ":" + result
	}
	if u.ForceQuery || u.RawQuery != "" {
		result += "?" + u.RawQuery
	}
	return result
}

func Parse(rawURL string) (*URL, error) {
	u, frag, _ := strings.Cut(rawURL, "#")
	parsedURL, err := parse(u, false)
	if err != nil {
		return nil, &Error{Op: "parse", URL: u, Err: err}
	}
	if frag == "" {
		return parsedURL, nil
	}
	if err = parsedURL.setFragment(frag); err != nil {
		return nil, &Error{Op: "parse", URL: rawURL, Err: err}
	}
	return parsedURL, nil
}

func ParseRequestURI(rawURL string) (*URL, error) {
	parsedURL, err := parse(rawURL, true)
	if err != nil {
		return nil, &Error{Op: "parse", URL: rawURL, Err: err}
	}
	return parsedURL, nil
}

func parseQueryPart(u *URL, rest string) string {
	if strings.HasSuffix(rest, "?") && strings.Count(rest, "?") == 1 {
		u.ForceQuery = true
		return rest[:len(rest)-1]
	}
	r, q, _ := strings.Cut(rest, "?")
	u.RawQuery = q
	return r
}

func parseAuthorityPart(u *URL, rest string, viaRequest bool) (string, error) {
	if (u.Scheme != "" || !viaRequest && !strings.HasPrefix(rest, "///")) && strings.HasPrefix(rest, "//") {
		authority := rest[2:]
		rest = ""
		if i := strings.Index(authority, "/"); i >= 0 {
			authority, rest = authority[:i], authority[i:]
		}
		user, host, err := parseAuthority(u.Scheme, authority)
		if err != nil {
			return "", err
		}
		u.User = user
		u.Host = host
	} else if u.Scheme != "" && strings.HasPrefix(rest, "/") {
		u.OmitHost = true
	}
	return rest, nil
}

func parse(rawURL string, viaRequest bool) (*URL, error) {
	if stringContainsCTLByte(rawURL) {
		return nil, errors.New("net/url: invalid control character in URL")
	}
	if rawURL == "" && viaRequest {
		return nil, errors.New("empty url")
	}
	u := &URL{}
	if rawURL == "*" {
		u.Path = "*"
		return u, nil
	}

	scheme, rest, err := getScheme(rawURL)
	if err != nil {
		return nil, err
	}
	u.Scheme = strings.ToLower(scheme)

	rest = parseQueryPart(u, rest)

	if !strings.HasPrefix(rest, "/") {
		if u.Scheme != "" {
			u.Opaque = rest
			return u, nil
		}
		if viaRequest {
			return nil, errors.New("invalid URI for request")
		}
		if segment, _, _ := strings.Cut(rest, "/"); strings.Contains(segment, ":") {
			return nil, errors.New("first path segment in URL cannot contain colon")
		}
	}

	rest, err = parseAuthorityPart(u, rest, viaRequest)
	if err != nil {
		return nil, err
	}

	if err := u.setPath(rest); err != nil {
		return nil, err
	}
	return u, nil
}

func getScheme(rawURL string) (string, string, error) {
	for i := 0; i < len(rawURL); i++ {
		c := rawURL[i]
		switch {
		case 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z':
		case '0' <= c && c <= '9' || c == '+' || c == '-' || c == '.':
			if i == 0 {
				return "", rawURL, nil
			}
		case c == ':':
			if i == 0 {
				return "", "", errors.New("missing protocol scheme")
			}
			return rawURL[:i], rawURL[i+1:], nil
		default:
			return "", rawURL, nil
		}
	}
	return "", rawURL, nil
}

func parseAuthority(scheme, authority string) (*Userinfo, string, error) {
	i := strings.LastIndex(authority, "@")
	if i < 0 {
		h, err := parseHost(scheme, authority)
		return nil, h, err
	}
	h, err := parseHost(scheme, authority[i+1:])
	if err != nil {
		return nil, "", err
	}
	userinfo := authority[:i]
	if !validUserinfo(userinfo) {
		return nil, "", errors.New("net/url: invalid userinfo")
	}
	if !strings.Contains(userinfo, ":") {
		unescapedUser, err := unescape(userinfo, encodeUserPassword)
		if err != nil {
			return nil, "", err
		}
		return User(unescapedUser), h, nil
	}
	username, password, _ := strings.Cut(userinfo, ":")
	unescapedUser, err := unescape(username, encodeUserPassword)
	if err != nil {
		return nil, "", err
	}
	unescapedPass, err := unescape(password, encodeUserPassword)
	if err != nil {
		return nil, "", err
	}
	return UserPassword(unescapedUser, unescapedPass), h, nil
}

func validIPv6(s string) bool {
	b := []byte(s)
	if len(b) < 2 {
		return false
	}
	colons := 0
	doubleColon := false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if c == ':' {
			colons++
			if i+1 < len(b) && b[i+1] == ':' {
				if doubleColon {
					return false
				}
				doubleColon = true
			}
		} else if !ishex(c) && c != '.' {
			return false
		}
	}
	return colons >= 2
}

func parseLiteralHost(host string) (string, error) {
	closeBracket := strings.LastIndex(host, "]")
	if closeBracket < 0 {
		return "", errors.New("missing ']' in host")
	}
	colonPort := host[closeBracket+1:]
	if !validOptionalPort(colonPort) {
		return "", fmt.Errorf("invalid port %q after host", colonPort)
	}
	unescapedColonPort, err := unescape(colonPort, encodeHost)
	if err != nil {
		return "", err
	}
	hostname := host[1 : closeBracket]
	var unescapedHostname string
	zoneIdx := strings.Index(hostname, "%25")
	if zoneIdx >= 0 {
		hostPart, err := unescape(hostname[:zoneIdx], encodeHost)
		if err != nil {
			return "", err
		}
		zonePart, err := unescape(hostname[zoneIdx:], encodeZone)
		if err != nil {
			return "", err
		}
		unescapedHostname = hostPart + zonePart
	} else {
		var err error
		unescapedHostname, err = unescape(hostname, encodeHost)
		if err != nil {
			return "", err
		}
	}
	if !validIPv6(unescapedHostname) {
		return "", errors.New("invalid IP-literal")
	}
	return "[" + unescapedHostname + "]" + unescapedColonPort, nil
}

func parseHost(scheme, host string) (string, error) {
	openBracket := strings.LastIndex(host, "[")
	if openBracket > 0 {
		return "", errors.New("invalid IP-literal")
	}
	if openBracket == 0 {
		h, err := parseLiteralHost(host)
		return h, err
	}
	if i := strings.Index(host, ":"); i != -1 {
		lastColon := strings.LastIndex(host, ":")
		if lastColon != i {
			i = lastColon
		}
		colonPort := host[i:]
		if !validOptionalPort(colonPort) {
			return "", fmt.Errorf("invalid port %q after host", colonPort)
		}
	}
	res, err := unescape(host, encodeHost)
	return res, err
}

func (u *URL) Parse(ref string) (*URL, error) {
	refURL, err := Parse(ref)
	if err != nil {
		return nil, err
	}
	return u.ResolveReference(refURL), nil
}

func (u *URL) ResolveReference(ref *URL) *URL {
	url := *ref
	if ref.Scheme == "" {
		url.Scheme = u.Scheme
	}
	if ref.Scheme != "" || ref.Host != "" || ref.User != nil {
		url.setPath(resolvePath(ref.EscapedPath(), ""))
		return &url
	}
	if ref.Opaque != "" {
		url.User = nil
		url.Host = ""
		url.Path = ""
		return &url
	}
	if ref.Path == "" && !ref.ForceQuery && ref.RawQuery == "" {
		url.RawQuery = u.RawQuery
		if ref.Fragment == "" {
			url.Fragment = u.Fragment
			url.RawFragment = u.RawFragment
		}
	}
	if ref.Path == "" && u.Opaque != "" {
		url.Opaque = u.Opaque
		url.User = nil
		url.Host = ""
		url.Path = ""
		return &url
	}
	url.Host = u.Host
	url.User = u.User
	url.setPath(resolvePath(u.EscapedPath(), ref.EscapedPath()))
	return &url
}

func resolvePath(base, ref string) string {
	var full string
	if ref == "" {
		full = base
	} else if ref[0] != '/' {
		i := strings.LastIndex(base, "/")
		full = base[:i+1] + ref
	} else {
		full = ref
	}
	if full == "" {
		return ""
	}

	dst := make([]byte, 0, len(full)+1)
	dst = append(dst, '/')
	elem := ""
	remaining := full
	found := true
	first := true
	for found {
		elem, remaining, found = strings.Cut(remaining, "/")
		switch elem {
		case ".":
			first = false
			continue
		case "..":
			if i := bytes.LastIndexByte(dst[1:], '/'); i >= 0 {
				dst = dst[:i+1]
			} else {
				dst = dst[:1]
			}
			first = len(dst) == 1
		default:
			if !first {
				dst = append(dst, '/')
			}
			b := []byte(elem)
			dst = append(dst, b...)
			first = false
		}
	}
	if elem == "." || elem == ".." {
		dst = append(dst, '/')
	}
	if len(dst) > 1 && dst[1] == '/' {
		return string(dst[1:])
	}
	return string(dst)
}

func (u *URL) JoinPath(elem ...string) *URL {
	url, _ := u.joinPath(elem...)
	return url
}

func (u *URL) joinPath(elem ...string) (*URL, error) {
	elem = append([]string{u.EscapedPath()}, elem...)
	var p string
	if !strings.HasPrefix(elem[0], "/") {
		elem[0] = "/" + elem[0]
		p = path.Join(elem...)[1:]
	} else {
		p = path.Join(elem...)
	}
	if strings.HasSuffix(elem[len(elem)-1], "/") && !strings.HasSuffix(p, "/") {
		p += "/"
	}
	url := *u
	err := url.setPath(p)
	return &url, err
}

func JoinPath(base string, elem ...string) (string, error) {
	url, err := Parse(base)
	if err != nil {
		return "", err
	}
	res, err := url.joinPath(elem...)
	if err != nil {
		return "", err
	}
	return res.String(), nil
}

func (u *URL) MarshalBinary() ([]byte, error) {
	b, err := u.AppendBinary(nil)
	return b, err
}

func (u *URL) AppendBinary(b []byte) ([]byte, error) {
	strBytes := []byte(u.String())
	return append(b, strBytes...), nil
}

func (u *URL) UnmarshalBinary(text []byte) error {
	u1, err := Parse(string(text))
	if err != nil {
		return err
	}
	*u = *u1
	return nil
}

func validUserinfo(s string) bool {
	for i := 0; i < len(s); i++ {
		r := s[i]
		if 'A' <= r && r <= 'Z' || 'a' <= r && r <= 'z' || '0' <= r && r <= '9' {
			continue
		}
		switch r {
		case '-', '.', '_', ':', '~', '!', '$', '&', '\'',
			'(', ')', '*', '+', ',', ';', '=', '%', '@':
			continue
		default:
			return false
		}
	}
	return true
}

func stringContainsCTLByte(s string) bool {
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b < ' ' || b == 0x7f {
			return true
		}
	}
	return false
}
