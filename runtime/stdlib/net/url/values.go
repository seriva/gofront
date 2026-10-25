//go:build gofront
//gofront:target both

package url

import (
	"fmt"
	"slices"
	"strings"
)

type Values map[string][]string

func (v Values) Get(key string) string {
	vs := v[key]
	if len(vs) == 0 {
		return ""
	}
	return vs[0]
}

func (v Values) Set(key, value string) {
	v[key] = []string{value}
}

func (v Values) Add(key, value string) {
	v[key] = append(v[key], value)
}

func (v Values) Del(key string) {
	delete(v, key)
}

func (v Values) Has(key string) bool {
	_, ok := v[key]
	return ok
}

func (v Values) Encode() string {
	if len(v) == 0 {
		return ""
	}
	var buf strings.Builder
	keys := make([]string, len(v))
	var i int
	for k := range v {
		keys[i] = k
		i++
	}
	slices.Sort(keys)
	for _, k := range keys {
		vs := v[k]
		keyEscaped := QueryEscape(k)
		for _, val := range vs {
			if buf.Len() > 0 {
				buf.WriteByte('&')
			}
			buf.WriteString(keyEscaped)
			buf.WriteByte('=')
			buf.WriteString(QueryEscape(val))
		}
	}
	return buf.String()
}

func ParseQuery(query string) (Values, error) {
	m := make(Values)
	err := parseQuery(m, query)
	return m, err
}

func parseQuery(m Values, query string) (err error) {
	for query != "" {
		var rawKey string
		rawKey, query, _ = strings.Cut(query, "&")
		if strings.Contains(rawKey, ";") {
			err = fmt.Errorf("invalid semicolon separator in query")
			continue
		}
		if rawKey == "" {
			continue
		}
		k, v, _ := strings.Cut(rawKey, "=")
		key, err1 := QueryUnescape(k)
		if err1 != nil {
			if err == nil {
				err = err1
			}
			continue
		}
		value, err1 := QueryUnescape(v)
		if err1 != nil {
			if err == nil {
				err = err1
			}
			continue
		}
		m[key] = append(m[key], value)
	}
	return err
}
